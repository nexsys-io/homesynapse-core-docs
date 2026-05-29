# AMD-45: Atomic Subscriber+View Checkpoint Coupling

**Amendment ID:** AMD-45
**Tier:** Tier-1 (architectural invariant)
**Status:** RATIFIED
**Date drafted:** 2026-05-27
**Date applied:** 2026-05-29
**Target documents:** Doc 03 (State Store & State Projection); Doc 04 (Event Bus & Subscription Management)
**Target sections:** Doc 03 §9 (checkpoint settings); Doc 04 §3.12 (subscriber checkpoint semantics)
**Refines:** AMD-38 (Checkpoint Policy Revision); INV-ES-05 (at-least-once delivery with subscriber idempotency)
**Source:** M3.7 crash-recovery debugging — CrashRecoveryHttpIT failure analysis (2026-05-27)
**Scope:** Pre-M4.0 prerequisite. Slot as M4.0's first work unit.

---

## 1. Problem

Two independent checkpoint domains exist in the production path today:

1. **Bus subscriber checkpoint** (`subscriber_checkpoints` table). Written by `InProcessEventBus` after every successful LIVE delivery (`InProcessEventBus` line 500, unconditional). Records the subscriber's last-delivered `globalPosition`.

2. **View checkpoint** (`view_checkpoints` table). Written by `StateProjection` on checkpoint-policy cadence (`FixedCheckpointPolicy` — 200 events OR 2 seconds for HOME_DEFAULT). Records the projection's `cursorPosition` and the serialized state snapshot.

These two checkpoint writes are **independent**: different code paths, different timing, different transactions. The bus subscriber checkpoint races ahead of the view checkpoint because the bus writes after every delivery while the projection writes on policy cadence.

### The crash window

When the process crashes between the bus subscriber checkpoint and the next view checkpoint write, the following state exists on disk:

- `subscriber_checkpoints` says: "state_projection has been delivered through position N."
- `view_checkpoints` says: "state_projection's snapshot is at position M" (where M < N, or M = 0 if the view checkpoint has never fired).

On restart:

1. The bus reads the subscriber checkpoint (position N) and begins delivering from N+1.
2. The projection creates a fresh `StateProjection`, which calls `loadFromCheckpoint()` against `view_checkpoints`.
3. If M < N, the projection rehydrates state at position M. Events between M+1 and N are **never replayed** — the bus believes they were already delivered.
4. If M = 0 (no view checkpoint exists), the projection starts empty. All state from positions 1..N is lost.

The M3.7 checkpoint-fix work unit (key mismatch + TESTING policy) closes this gap for tests but not for production. Under `FixedCheckpointPolicy.HOME_DEFAULT` (200 events / 2 seconds), any crash within the first 200 events or 2 seconds of a checkpoint cycle loses state that the bus believes was delivered.

### Production impact

M4's automation engine consumes durable state from the `StateQueryService`. If entity state is silently lost on crash recovery, automations see stale or missing device states and fire incorrect actions — or fail to fire correct ones. This is a **data integrity issue**, not merely a performance concern.

---

## 2. Change Specification

### §2.1 — Couple subscriber and view checkpoint writes atomically

**Invariant (new, AMD-45-INV-01):** The bus subscriber checkpoint and the projection view checkpoint for the `state_projection` subscriber MUST be written in the same SQLite transaction. Neither advances without the other.

**Implementation mechanism:** `AtomicCheckpointWriter` (already exists in `com.homesynapse.persistence`, 285 lines) provides `writeAtomicCheckpoint(subscriberId, position, viewName, viewData)` which writes both `subscriber_checkpoints` and `view_checkpoints` in a single transaction with rollback on failure. This class is fully implemented and tested (`AtomicCheckpointWriterTest`, `AtomicCheckpointWriterDlqTest`) but is not wired into the production checkpoint path.

**Wiring change:** The `StateProjection`'s `writeCheckpoint()` method (state-store module, line ~591) currently writes only to `ViewCheckpointStore`. It must instead write through `AtomicCheckpointWriter`, which writes both stores atomically. The bus's per-delivery subscriber checkpoint write (`InProcessEventBus` line 500) must be **removed** for the `state_projection` subscriber — the subscriber checkpoint is now written by the projection on policy cadence, not by the bus on every delivery.

### §2.2 — Remove per-delivery bus subscriber checkpoint for projection subscribers

**Before:** `InProcessEventBus` unconditionally writes `checkpointStore.writeCheckpoint(subscriberId, position)` after every successful LIVE delivery (line 500).

**After:** The bus writes a per-delivery subscriber checkpoint only for subscribers that do NOT use atomic checkpoint coupling. The `state_projection` subscriber opts out of per-delivery bus checkpointing because its checkpoint is written atomically by the projection on policy cadence.

**Mechanism (two options — decide during implementation):**

- **Option A — SubscriberInfo flag.** Add an `atomicCheckpoint` boolean to `SubscriberInfo`. The bus skips per-delivery checkpoint writes for subscribers where `atomicCheckpoint == true`. Clean, explicit.
- **Option B — CheckpointStore delegation.** The bus continues to call `checkpointStore.writeCheckpoint()` for all subscribers, but the `CheckpointStore` implementation for projection subscribers is a no-op wrapper that suppresses the write. The real write happens through `AtomicCheckpointWriter`. Less invasive to bus code but adds an indirection layer.

The PM should evaluate both options during implementation planning and choose the one that minimizes cross-module coupling.

### §2.3 — Behavioral consequence: replay window on crash recovery

With this change, the bus subscriber checkpoint for `state_projection` advances on **policy cadence** (every 200 events or 2 seconds under HOME_DEFAULT), not on every delivery. On crash recovery, the bus delivers from the last coupled checkpoint — which may be up to `eventThreshold` events behind the store head.

This means `StateProjection` will re-process up to `eventThreshold` events (200 for HOME_DEFAULT) on recovery. This is **correct by design** — INV-ES-05 requires subscriber idempotency for exactly this reason. `StateProjection.onEvent()` applies `StateReported` events to the in-memory `ConcurrentHashMap` via `put()`, which is naturally idempotent (same entity + same state = same map entry). The `DerivationRule` must also be idempotent for derived event publication; the no-op `MINIMAL_DERIVATION_RULE` lambda (M3.7) satisfies this trivially (it derives nothing).

**Worst-case replay cost (HOME_DEFAULT):** 200 events × ~20µs/event = ~4ms. Well within the Pi 5's startup budget.

---

## 3. Regression Test Specification

A new integration test must demonstrate the fix:

**Test: `CrashRecoveryReplayIT`** (or equivalent name)

1. Configure with `HomeSynapseConfig.HOME_DEFAULT` (200-event / 2-second policy, NOT the TESTING policy).
2. Publish N events where N < 200 (e.g., 5 entities).
3. Wait for LIVE mode and verify all entities are queryable via HTTP.
4. Call `abandon()` — simulates `kill -9`. The view checkpoint has NOT fired (N < 200, Clock.systemUTC() with < 2 seconds elapsed).
5. Restart on the same database path.
6. Wait for LIVE mode.
7. Assert all N entities are queryable via HTTP.

**Before AMD-45:** This test fails at step 7 — entities are lost because the bus subscriber checkpoint (at position N) causes the bus to skip replay, and no view checkpoint exists.

**After AMD-45:** This test passes — the bus subscriber checkpoint is coupled to the view checkpoint. Since neither was written (policy didn't fire), the bus replays from position 0, the projection processes all N events, and state is fully rebuilt.

> **Note:** This test uses `Clock.systemUTC()` (not `Clock.fixed()`) because it must exercise the real-clock time threshold path. The test relies on completing within 2 seconds wall-clock, which is reliable on CI hardware. If flakiness emerges, the test can inject a `TestClock` that doesn't advance past the 2-second threshold.

---

## 4. Invariant Alignment

| Invariant | Impact |
|---|---|
| **INV-ES-04** (Write-ahead persistence) | Unaffected. Event durability is unchanged — events are still WAL-durable before `publish()` returns. |
| **INV-ES-05** (At-least-once, subscriber idempotency) | **Load-bearing.** The replay window on crash recovery (up to `eventThreshold` events) depends on projection idempotency. `StateProjection.onEvent()` → `StateStore.put()` is naturally idempotent. Future subscribers consuming from the bus must maintain this guarantee. |
| **AMD-38** (Checkpoint policy values) | **Refined.** AMD-38 established the 200/2s values for WAL release and recovery cost bounding. AMD-45 adds a second purpose: the policy cadence now also governs the subscriber checkpoint write frequency. The values remain appropriate — 200 events of replay is ~4ms on Pi 5. |
| **INV-RF-04** (DLQ atomicity) | Unaffected. `AtomicCheckpointWriter.writeAtomicCheckpointWithDlqPark()` already handles the three-way atomic write for DLQ scenarios. AMD-45's two-way path is a subset. |

---

## 5. Implementation Impact

### Files likely modified

| Module | File | Change |
|---|---|---|
| `state-store` | `StateProjection.java` | `writeCheckpoint()` writes through an `AtomicCheckpointWriter`-shaped interface instead of `ViewCheckpointStore` alone. New dependency injected via `create()`. |
| `event-bus` | `InProcessEventBus.java` | Line 500: conditional — skip per-delivery checkpoint for atomic-checkpoint subscribers (§2.2). |
| `event-bus` | `SubscriberInfo.java` | Possibly add `atomicCheckpoint` flag (Option A). |
| `persistence` | `AtomicCheckpointWriter.java` | No changes — already implements the required API. |
| `persistence` | `SqlitePersistenceLifecycle.java` | Expose `AtomicCheckpointWriter` (or a wrapped form) so the lifecycle module can inject it into `StateProjection`. |
| `lifecycle` | `HomeSynapseCore.java` | Wire `AtomicCheckpointWriter` into `StateProjection.create()`. |
| `integration-tests` | New: `CrashRecoveryReplayIT.java` | Regression test per §3. |

### Cross-module boundary

`AtomicCheckpointWriter` is currently package-private in `com.homesynapse.persistence`. The `StateProjection` in `com.homesynapse.state` cannot call it directly across JPMS boundaries. Two approaches:

- **Interface in state-store, implementation in persistence.** Define an `AtomicCheckpointSink` interface in state-store that `StateProjection` depends on. `PersistenceFactory` provides an implementation backed by `AtomicCheckpointWriter`. This follows the existing pattern where `ViewCheckpointStore` and `CheckpointStore` are interfaces in their respective modules with SQLite implementations in persistence.
- **Expose through PersistenceFactory.** `PersistenceFactory` already exposes `viewCheckpointStore()`, `checkpointStore()`, etc. Add an `atomicCheckpointWriter()` accessor that returns a public-facing type. Simpler but couples the state-store module's API to the persistence module's type.

The PM should choose during implementation planning based on the module coupling cost.

---

## 6. Downstream Dependencies

- **M4.0 Automation Engine:** Depends on durable state surviving all crash scenarios. AMD-45 is a hard prerequisite — without it, automations may see stale state after any crash within the checkpoint window.
- **AdaptiveCheckpointPolicy (post-MVP):** The adaptive policy inherits this coupling automatically — it implements the same `CheckpointPolicy` interface and its `shouldCheckpoint()` decision gates the same atomic write.
- **Future subscribers:** Any new bus subscriber that maintains materialized state should evaluate whether it needs atomic checkpoint coupling. The pattern established here (projection owns its checkpoint write, bus skips per-delivery writes) is the template.
