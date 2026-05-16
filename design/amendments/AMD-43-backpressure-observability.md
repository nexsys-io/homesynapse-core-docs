# AMD-43: Backpressure and Observability

**Amendment ID:** AMD-43
**Tier:** Tier-1 (architectural invariant)
**Status:** APPLIED
**Date Applied:** 2026-05-16
**Target Documents:** Doc 01 — Event Model & Event Bus; Doc 11 — Observability
**Target Sections:** Doc 01 §3.6 (backpressure), Doc 11 §3.X (bus metrics — new sub-section "Event bus and writer metrics")
**Refines:** INV-BUS-02 (publish is non-blocking on backpressure), AMD-26 (writer single-thread), `NO_DIRECT_TIME_ACCESS` ArchUnit rule (clock injection — DEC-M3-09)
**Source:** DEC-M3-07 (deferred), DEC-M3-08 (replaced), DEC-M3-12 (modified)

> **Observability surface caveat (source-verification, 2026-05-16):** The phrase "core/observability adapter" in §3.6.2 refers to the existing `observability/observability` module. That module's M2 metrics surface is JFR-centric (`MetricsRegistry` for custom JFR event types, `MetricsStreamBridge` for `RecordingStream` consumption, `MetricSnapshot` for aggregated min/max/count/sum windows). It does **not** currently expose typed counter / gauge / histogram primitives. M3.3 must therefore either (a) emit JFR events for each of the seven canonical metrics and reshape `BusMetrics` around event emission rather than typed primitive calls, or (b) extend `observability/observability` with new typed primitive types. This decision is open for M3.3 and should be resolved before the M3.3 Cowork prompt is generated.

## Problem statement

The Phase 2 design specifies pull-based bus delivery and per-subscriber checkpoints, but does not specify:

- What happens when the writer's queue is saturated (>5000 enqueued writes pending).
- Whether `EventPublisher.publish` blocks the caller, fails-fast, or coalesces.
- Which metrics operators can rely on to detect saturation before it becomes a user-facing latency spike.
- How a derivation-producing subscriber (`StateProjection`) limits its own contribution to the writer's backlog.

## Change specification

Add the following text as Doc 01 §3.6 (replacing existing placeholder) and reference from Doc 11 §3.X (new sub-section "Event bus and writer metrics").

**§3.6.1 — `EventPublisher.publish()` is non-blocking on backpressure (INV-BUS-02 normative).** The publisher MUST NOT block on writer queue depth. Natural backpressure arises from the single-thread write executor (AMD-26): callers park on their handoff future, which completes only when the writer drains to their slot. The publisher MUST NOT introduce additional blocking via `Semaphore.acquire`, `wait`, `Lock.lock` keyed on queue depth, or any other depth-gated mechanism. Saturation manifests as elevated per-call latency, never as `publish()` hanging.

**§3.6.2 — Required metrics (seven canonical names).** The bus implementation MUST emit these exact metric names through the project's existing `observability/observability` module (see caveat above for the JFR vs typed-primitive resolution path):

| Metric name | Type | Sampled when |
|---|---|---|
| `homesynapse.bus.publish.latency` | histogram (microseconds) | After every `EventPublisher.publish()` returns. |
| `homesynapse.bus.publisher.blocked.count` | counter | Incremented at `publish()` entry whenever observed writer queue depth > 5000. No debounce. |
| `homesynapse.bus.writer.queue.depth` | gauge (int) | Sampled on every enqueue AND every dequeue (guaranteed-fresh value). |
| `homesynapse.bus.subscriber.lag.events` | gauge per subscriberId (long) | Sampled after every `onEvent` returns. Lag of most-recently-delivered event vs writer tail. |
| `homesynapse.bus.subscriber.lag.millis` | gauge per subscriberId (Duration) | Sampled after every `onEvent` returns. Wall-clock between event ingest and subscriber observation. |
| `homesynapse.bus.subscriber.derived_writes.accepted` | counter per subscriberId | Incremented on each `EventPublisher.publish` from the subscriber that succeeded without rate-limit park. |
| `homesynapse.bus.subscriber.derived_writes.parked` | counter per subscriberId | Incremented when the rate-limit bucket was empty and the call parked. |

These are the literal names. Renames are governed by Doc 11's metrics-stability policy.

**§3.6.3 — Health-signal mechanics.** A `QueueSaturationHealthCheck` runs on a 1-second scheduled tick (shared with the supervisor scheduler). It reads `homesynapse.bus.writer.queue.depth` and maintains two consecutive-tick counters:

- `criticalTicks`: incremented when `depth > critical_depth` (default 10000), reset otherwise.
- `warnTicks`: incremented when `depth > warn_depth` (default 5000), reset otherwise.
- On `criticalTicks >= 5`: emit `CRITICAL` on channel `writer.queue.saturating`. Re-emit at 10-second intervals while sustained.
- On `warnTicks >= 5` AND no current critical: emit `WARN` on channel `writer.queue.saturating`. Re-emit at 30-second intervals while sustained.
- When depth drops below thresholds for ≥ 5 consecutive ticks, emit `INFO` `writer.queue.recovered`.

Operator-tunable via `application.properties`:
- `homesynapse.bus.queue.warn_depth` (default 5000)
- `homesynapse.bus.queue.critical_depth` (default 10000)
- `homesynapse.bus.queue.saturation_ticks` (default 5)

**§3.6.4 — Per-subscriber derived-write rate limit.** Derivation-producing subscribers (currently only `StateProjection`) wrap their `EventPublisher.publish()` calls in a `DerivedWriteRateLimit` token bucket:

- Bucket capacity: 200 tokens (default for `StateProjection`; constructor parameter).
- Refill rate: 200 tokens/sec via a single scheduled task on the supervisor scheduler ticking every 50ms (refill of 10 tokens per tick). Refill ticks use the injected `Clock` (DEC-M3-09 clock propagation, enforced by `NO_DIRECT_TIME_ACCESS`).
- `acquire()` semantics: poll first; if available, decrement and return immediately. If not, `BusMetrics.recordDerivedWriteParked(subscriberId)` and park on a `Semaphore` until the refill releases a permit.
- The rate limit is per-subscriber (one bucket instance per `StateProjection`); other future derived-publishing subscribers carry their own defaults.

**§3.6.5 — Coalescing deferred past M3 (DEC-M3-07).** No coalescing of subscriber notifications or publish calls is implemented in M3. The `coalesceExempt` flag on `SubscriberInfo` (existing field from Phase 2) is retained in the contract but is not exercised: M3 treats all subscribers as if `coalesceExempt = true`. Post-M3 work may activate coalescing for non-exempt subscribers under a future amendment.

**§3.6.6 — Pi 4 platform envelope (DEC-M3-12 modified).** The above defaults are universal across the Pi 4 → x86 server deployment spectrum at MVP. The `Pi4SustainedLoadIT` and `Pi4D1SpikeIT` integration tests (M3.4) are the empirical gates that determine whether platform-specific tuning is required. If observed saturation occurs at Pi 4's natural throughput, follow-up amendment AMD-44 may introduce platform-aware defaults; this is not a M3 deliverable.

## Invariant alignment

- **INV-BUS-02** (non-blocking publish on backpressure): formalized and enforced by ArchUnit rule `EVENT_PUBLISHER_HAS_NO_DEPTH_GATED_LOCK` (added in M3.3): no class in `core/persistence` or `core/event-bus` may import `java.util.concurrent.Semaphore`, `java.util.concurrent.locks.Lock`, or call `Object.wait()` in a code path reachable from `EventPublisher.publish()`. (Exceptions: the writer's own work queue uses internal synchronization; this is allowed because it's not depth-gated on the caller.)
- **AMD-26 (single-writer)**: preserved. Backpressure is a writer-derived consequence, not a separate mechanism.

## Validation gate

- `BackpressureMetricsIT` (M3.3 §7): drives writer queue to 6000 depth via a slow writer fixture; asserts publish latency p99 within 2× steady-state; asserts `homesynapse.bus.publisher.blocked.count` increments.
- Contract tests `EventBusContractTest#publishDoesNotBlockAt5000` and related (M3.3).
- ArchUnit rule `EVENT_PUBLISHER_HAS_NO_DEPTH_GATED_LOCK`.
