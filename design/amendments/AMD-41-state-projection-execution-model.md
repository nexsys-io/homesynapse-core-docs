# AMD-41: State Projection Execution Model

**Amendment ID:** AMD-41
**Tier:** Tier-1 (architectural invariant)
**Status:** APPLIED
**Date Applied:** 2026-05-16
**Target Document:** Doc 03 — State Materialization and Read Path
**Target Sections:** §3.2 (State Projection runtime model), new §3.2.4 (Reconciliation pass), §12.5 Q5 (resolved)
**Refines:** INV-PROJ-01 (projection determinism), INV-PROJ-04 (checkpoint-position monotonicity), INV-WRITER-01 (single-writer invariant from AMD-26)
**Source:** DEC-M3-01, DEC-M3-02, DEC-M3-04 (modified), DEC-M3-10

## Problem statement

The Phase 2 design of State Projection inherits the writer's single-thread discipline (AMD-26) by accident rather than design. The projection performs reads against `EventStore` (implemented by `SqliteEventStore`), derives state-changed events, and publishes them back via `EventPublisher`, but the ordering between the read transaction, the derived-event publish, and the AMD-26/27 handoff to the writer's platform thread has never been pinned. Three concrete failure modes are possible:

1. **Read-during-write deadlock.** If the read transaction is held open across an `EventPublisher.publish()` call and the publish path parks on the writer's platform thread to perform a derived write, SQLite WAL can promote the read to a `BEGIN IMMEDIATE` if a checkpoint coincides, blocking the writer's next acquire.
2. **Reentrant filter blindness.** Without a self-produced-event filter, a `state_changed` event derived from `device_observed` is re-delivered to the same `StateProjection` subscriber, which then attempts to derive a second `state_changed` from the first one. The cycle terminates only when the filter logic happens to short-circuit on idempotent state.
3. **Version-upgrade lossage.** When `projectionVersion` is bumped (a derivation rule change), the existing checkpoint references a position that was processed under the old rules. Replay-from-zero is the only safe recovery, but the design as of M2→M3 has no formal reconciliation pass.

## Change specification

Replace Doc 03 §3.2 in its entirety with the following text (additions and replacements):

**§3.2.1 — Execution model (replaces existing §3.2.1).** The `StateProjection` subscriber runs on a per-subscriber virtual thread (see AMD-42 §3.4). Each event delivery executes as the following strict sequence:

1. **READ phase.** Open a read transaction on the subscriber's dedicated SQLite read connection via the `ProjectionAdvancer` (whose `advance` method invokes the per-event processor inside the read transaction — see Deliverable 0 / §3 of the implementation plan). The processor computes the derivation: load the prior state for the affected entity from `EntityState` cache, apply the event, produce zero or more derived `state_changed` `EventDraft` instances **into an in-memory buffer**. **The read transaction closes when `advance` returns; the buffer holds the derived drafts.**
2. **PUBLISH phase.** For each buffered `EventDraft`, call `EventPublisher.publish(draft, causalContext)` sequentially on the projection's virtual thread. **No separate WriteBatcher thread exists.** Each `publish()` call parks the virtual thread on the writer's platform thread through the standard AMD-26 / AMD-27 handoff. The next `publish()` does not begin until the current one returns.
3. **CHECKPOINT phase.** After all derived publishes return, the projection records the source event's `globalPosition` via `ViewCheckpointStore.writeCheckpoint(viewName, position, data)`. Checkpoint cadence remains governed by AMD-38 (200 events or 2 seconds, whichever first).

The sequence is single-threaded per subscriber and produces a total order on the subscriber's derived publishes. The `WriteBatcher` thread referenced in earlier drafts is **not** introduced; the projection's own virtual thread is the only orchestrator.

**§3.2.2 — Self-produced filter (replaces existing §3.2.2).** The `StateProjection` maintains an in-memory `SelfProducedFilter` keyed by `EventEnvelope.eventId` (`Ulid`). On every successful `EventPublisher.publish()` from the projection, the resulting envelope's `eventId` is inserted into the set with a 60-second TTL (clock from injected `Clock`). On every inbound delivery, the projection checks the filter; matches return immediately without re-derivation.

- **Eviction is lazy.** Expiry is checked on `isSelfProduced()`; expired entries are removed inline. No background sweeper thread exists.
- **No hard cap at MVP.** Memory envelope is bounded by event throughput × 60s. With the M3.4 throughput floor of 100 events/sec, the set holds at most ~6000 ULIDs (≈ 96 KB at 16 bytes per ULID plus map overhead). A hard cap is deferred until empirical evidence justifies the complexity.
- **`stateVersion` defence-in-depth.** If the filter misses (e.g. process restart loses the in-memory set), the projection's derivation logic compares the candidate derived event's `stateVersion` to the current materialized state. Equal-or-lower versions are discarded.
- **REPLAY/TRANSITION bypass.** During `SubscriberMode.REPLAY` and `SubscriberMode.TRANSITION` (AMD-42 §3.4.1), `isSelfProduced()` returns `false` unconditionally. Replay must re-derive deterministically from the log; the in-memory filter from the previous process is gone and cannot be trusted.

**§3.2.3 — MVP checkpoint mechanism (replaces existing §3.2.3).** State Projection checkpoints through the existing `ViewCheckpointStore`. No per-entity snapshot store is introduced at MVP. The V003 migration that creates the `snapshots` table was authored during the M2→M3 bridge (2026-05-15) and is wired into `SqlitePersistenceLifecycle.EVENTS_MIGRATION_FILES` by M3.5b (the migration file lives on disk today but is not yet enrolled in the manifest — see plan §1.1 source-verification correction). The `SqliteSnapshotStore` implementation is deferred until empirical evidence justifies it: when full replay from `position = 0` exceeds **5 seconds** wall-clock on the Pi 4 reference hardware, M3.5b's deferred work is unblocked.

**§3.2.4 — Reconciliation pass (NEW section, resolves §12.5 Q5).** When the projection observes `projectionVersion(persisted_checkpoint) ≠ projectionVersion(current_code)`, the projection enters a **reconciliation pass**:

1. The operator flag `homesynapse.projection.allow_stale_snapshots` is read. If `true`, the projection logs a WARN and proceeds with the stale checkpoint (escape hatch only).
2. If `false` (default), the projection discards the checkpoint, resets its in-memory state to empty, and replays from `position = 0` under `SubscriberMode.REPLAY`. The reconciliation timestamp (from injected `Clock`) is recorded on the new checkpoint as `reconciledAt`.
3. During reconciliation, the self-produced filter is bypassed (REPLAY mode); the writer is not invoked because the projection emits derived events only after exiting REPLAY (see AMD-42 §3.4.2).
4. On completion, `onCaughtUp()` fires exactly once (AMD-42 §3.4.3) and the projection transitions to LIVE.

The reconciliation pass is the **only** mechanism for handling projection-code version drift in M3. Schema-level migrations (writer-side) are out of scope for AMD-41 and remain governed by AMD-36.

Reconciliation metadata (`reconciledAt`, `fromVersion`, `toVersion`) is serialized into the existing opaque `CheckpointRecord.data` byte slot via the Jackson codec (AMD-36). No schema migration is required — `CheckpointRecord` is a 5-field record with `byte[] data` and `int projectionVersion` already present from Phase 2.

## Invariant alignment

- **INV-PROJ-01** (projection determinism): strengthened. The two-phase discipline guarantees that derived publishes are produced only after the read transaction commits, eliminating read-write interleaving as a source of non-determinism.
- **INV-PROJ-04** (checkpoint monotonicity): preserved. Checkpoint writes happen only after derived publishes return; partial-publish-then-checkpoint cannot occur.
- **INV-WRITER-01** (single-writer): preserved. All derived publishes route through `EventPublisher` and thus through the AMD-26/27 handoff; no second writer is introduced.
- **INV-PROJ-NEW-01** (self-produced isolation): introduced. A subscriber must not re-derive from its own publishes during LIVE mode.

## Downstream dependencies

- AMD-42 (subscriber lifecycle) depends on AMD-41's `SubscriberMode` reference.
- AMD-43 (backpressure) depends on AMD-41's confirmation that `publish()` is sequential on the projection VT (no separate batcher to coalesce against).
- M3.5a (vertical slice) is the first executable validation of AMD-41.
- The existing `StateQueryService` interface in `core/state-store` (AMD-03) reads the materialized state produced by AMD-41's projection; no contract change to AMD-03.

## Validation gate

- ArchUnit rule `PROJECTION_NO_WRITE_BATCHER_THREAD`: no class in `core/state-store` named `*WriteBatcher*` or extending `Thread`/`Runnable` outside the subscriber's own VT factory.
- Contract test `StateProjectionContractTest#readTxClosesBeforePublish` (in `core/state-store/src/testFixtures/java/com/homesynapse/state/test/`): instruments the `ProjectionAdvancer.advance()` and `EventPublisher.publish()` call boundaries and asserts the read tx is closed before publish executes.
- Contract test `StateProjectionContractTest#selfProducedFilterBypassedInReplay`: verifies `isSelfProduced()` returns `false` during REPLAY/TRANSITION.
- Contract test `StateProjectionContractTest#reconciliationOnVersionMismatch`: simulates a checkpoint with `projectionVersion = 1` while code reports `projectionVersion = 2` and asserts replay-from-zero.
