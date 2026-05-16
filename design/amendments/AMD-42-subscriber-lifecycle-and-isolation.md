# AMD-42: Subscriber Lifecycle and Isolation

**Amendment ID:** AMD-42
**Tier:** Tier-1 (architectural invariant)
**Status:** APPLIED
**Date Applied:** 2026-05-16
**Target Documents:** Doc 01 — Event Model & Event Bus; Doc 03 — State Materialization
**Target Sections:** Doc 01 §3.4 (Event bus subscriber model); Doc 03 §3.2 (cross-reference)
**Refines:** INV-BUS-01 (delivery exactly-once per subscriber), INV-BUS-03 (subscriber isolation), AMD-26 (writer single-thread), `NO_DIRECT_TIME_ACCESS` ArchUnit rule (clock injection — extended to M3 per DEC-M3-09)
**Source:** DEC-M3-03, DEC-M3-06 (augmented), DEC-M3-09

> **Citation note (source-verification correction, 2026-05-16):** Earlier drafts of this amendment attributed clock-injection authority to "AMD-39 (clock injection)." AMD-39 (`AMD-39_Journal_Size_Limit_Revision.md`) was WITHDRAWN on 2026-05-15 and concerns `journal_size_limit`, not clock discipline. The actual clock-injection enforcement surface is the `NO_DIRECT_TIME_ACCESS` ArchUnit rule in `app/homesynapse-app/src/test/java/com/homesynapse/app/HomeSynapseArchRules.java` together with the locked decision DEC-M3-09. All clock references in this amendment have been corrected accordingly.

## Problem statement

The Phase 2 design declares "in-process bus, per-subscriber delivery" without specifying:

- How subscribers transition from cold-start (no in-memory state, persisted checkpoint may exist) to LIVE delivery without losing events arriving during the catch-up read.
- Whether subscribers share SQLite read connections (they must not — connection-level transaction isolation collapses under sharing).
- What happens when a subscriber throws repeatedly — silent re-delivery loops would corrupt downstream views.
- How `onCaughtUp()` fires deterministically when catch-up is itself producing publishes that arrive on the same bus.

## Change specification

Add the following text as Doc 01 §3.4.1 (replacing the existing §3.4.1 placeholder) and reference it from Doc 03 §3.2.

**§3.4.1 — Subscriber mode state machine.** Every subscriber registered with `EventBus` exposes a mode in `{ COLD, REPLAY, TRANSITION, LIVE, SUSPENDED }` via `SubscriberInfo.mode()`. Transitions are atomic (single `AtomicReference<SubscriberMode>` per subscriber) and observable to operators through the bus's introspection API.

```
COLD ──register()──▶ REPLAY ──reachedLiveTail()──▶ TRANSITION ──drainComplete()──▶ LIVE
                                                                                    │
                                                                                    │ circuitBreaker.trip()
                                                                                    ▼
                                                                                SUSPENDED
```

**§3.4.2 — Three-phase REPLAY→LIVE transition.**

1. **COLD.** Initial state on `EventBus.subscribe(subscriberInfo)`. No reads, no writes. The bus has accepted the registration but not started delivery.
2. **REPLAY.** The bus reads the subscriber's persisted checkpoint (via `CheckpointStore`), opens the subscriber's dedicated read connection (§3.4.4), and begins delivering events from `checkpoint + 1` forward in pages of `MAX_REPLAY_PAGE = 500` (bounded-window per AMD-38). During REPLAY:
   - The subscriber receives events strictly in `globalPosition` order.
   - Events newly published during REPLAY are captured in the subscriber's `ReplayWindowQueue` (bounded at 10000) and drained in TRANSITION.
   - The subscriber MUST NOT call `EventPublisher.publish()` from `onEvent()` during REPLAY — defence-in-depth check rejects with `IllegalStateException`. `StateProjection` is REPLAY-mode-aware and defers derivation publishes until LIVE.
3. **TRANSITION.** When `ProjectionAdvancer.advance()` reports tail reached (`hasMore == false && eventsProcessed == 0`), the bus transitions the subscriber to TRANSITION and runs the `drainAndPromote` procedure (§3.4.3). Drains the `ReplayWindowQueue` in `globalPosition` order, skipping events already delivered during REPLAY (gap detection).
4. **LIVE.** After drain completes, `onCaughtUp()` fires exactly once (single-shot per subscriber lifetime per process — see §3.4.3) and the mode atomically transitions to LIVE. From this point, events are delivered via standard notification: `EventBus.notifyEvent(globalPosition)` wakes the subscriber's VT, which polls `EventStore.readFrom(checkpoint, batch)` for the new events.
5. **SUSPENDED.** Entered when the supervisor's circuit breaker trips (§3.4.5). No deliveries. Operator-recoverable via `EventBus.resume(subscriberId)`.

**§3.4.3 — `onCaughtUp()` semantics.** Fires exactly once per process lifetime per subscriber, after the TRANSITION → LIVE atomic mode CAS succeeds and before any LIVE-mode delivery. Implementations may use it to log "ready", flush warm caches, or emit a readiness signal. The default implementation in `Subscriber` is a no-op. Exceptions thrown from `onCaughtUp()` are caught by the supervisor and treated as a synthetic-event delivery failure (DLQ logged with a synthetic `CAUGHT_UP_TRANSITION` event-position marker).

**§3.4.4 — Per-subscriber resources (INV-SUB-ISO-01..06).**

- **INV-SUB-ISO-01** — One virtual thread per subscriber, named `hs-sub-<subscriberId>`. Created on `subscribe()`, terminated on `unsubscribe()` (or SUSPENDED → resume cycle).
- **INV-SUB-ISO-02** — One dedicated SQLite read connection per subscriber, held for the lifetime of the subscriber. Connection allocation via `DatabaseExecutor.readExecutor()` round-robin pool (AMD-27); the subscriber binds one slot through a `ThreadLocal<Connection>`.
- **INV-SUB-ISO-03** — One `SubscriberDlq` instance per subscriber. DLQ entries are per-`subscriberId` in the `subscriber_dead_letters` table (V002, AMD-36).
- **INV-SUB-ISO-04** — One `AtomicReference<SubscriberMode>` per subscriber.
- **INV-SUB-ISO-05** — One `ReplayWindowQueue` per subscriber (lifetime: REPLAY entry → drain complete). Garbage-collected after LIVE transition.
- **INV-SUB-ISO-06** — One `SelfProducedFilter` per subscriber (only for derivation-producing subscribers, e.g. `StateProjection`).

**§3.4.5 — `SubscriberSupervisor` (per-subscriber).**

The supervisor wraps `subscriber.onEvent(envelope)` calls in a try/catch:

- On success: increment the subscriber's `deliveryCount` metric; reset the consecutive-failure counter on this subscriber.
- On exception: append to the subscriber's in-memory DLQ ring (cap 1024); persist to `subscriber_dead_letters` (per AMD-36 — note that AMD-36 has no `status` column; row presence IS the parked state); increment `crashCount` within the rolling 10-minute window; schedule retry via the bus's shared `ScheduledExecutorService` with backoff `MIN = 3s, MAX = 30s, jitter = 0.2`. After 5 retries (AMD-36 default) OR `crashCount >= 5` within 10 minutes, the circuit breaker trips: `mode → SUSPENDED`, emit CRITICAL on health channel `subscriber.<id>.suspended`.
- `EventBus.resume(subscriberId)` clears the crash window, transitions SUSPENDED → REPLAY (re-bootstrap from last checkpoint), and re-attempts delivery.

The supervisor's backoff scheduler uses the injected `Clock` (DEC-M3-09 clock propagation, enforced by the `NO_DIRECT_TIME_ACCESS` ArchUnit rule).

**§3.4.6 — Cross-subscriber isolation guarantees.** A failure in subscriber A (exception, DLQ overflow, circuit trip) MUST NOT affect subscriber B's mode, queue, connection, DLQ, or delivery cadence. The bus implementation MUST be tested with a contract test method per INV-SUB-ISO-01..06 demonstrating no cross-contamination.

## Invariant alignment

- **INV-BUS-01** (exactly-once per subscriber): preserved. The REPLAY → TRANSITION → LIVE handoff prevents duplicate delivery at the transition boundary by tracking `lastReplayedPosition` and using it as the drain gate.
- **INV-BUS-03** (subscriber isolation): strengthened by the explicit INV-SUB-ISO-01..06 catalog.
- **AMD-26 (writer single-thread)**: preserved. The bus has no writer; all writes go through `EventPublisher` which routes through the writer's platform thread.
- **DEC-M3-09 (clock injection)**: extended. The supervisor's backoff scheduler joins the propagation surface enforced by `NO_DIRECT_TIME_ACCESS`.

## Validation gate

- Contract tests `EventBusContractTest#subscriberLifecycle_*` (extension of existing 18-method base): cover state machine transitions, atomicity, single-shot `onCaughtUp`, isolation guarantees (one method per INV-SUB-ISO-01..06).
- `ReplayTransitionIT` integration test (M3.2 §6.6).
