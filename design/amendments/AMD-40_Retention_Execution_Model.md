# AMD-40: Retention Execution Model

**Amendment ID:** AMD-40
**Tier:** CONTRACT-LEVEL (M2→M3 bridge — pre-M3 hardening)
**Status:** APPLIED
**Date applied:** 2026-05-15
**Target document:** Doc 04 (Persistence Layer)
**Target sections:** §3.4 (Retention and Purge)
**Implements:** AMD-26/27 compliance for retention path; M2→M3 Storage Efficiency Research recommendation
**Source:** Retrofit Research (2026-04-28); Home Assistant `recorder` issues #88780, #94134, #115765, #123348

## Problem

Doc 04 §3.4 specifies two design decisions for retention that predate the AMD-26/27 platform-thread-executor mandate and that match the failure pattern of Home Assistant's `recorder` integration:

**Decision 1 — separate connection.** Doc 04 §3.4 says: *"The retention thread opens its own read-write SQLite connection (separate from the EventPublisher's write connection). It acquires the single-writer lock via `busy_timeout` for each batch operation, releasing it between batches."*

AMD-26 and AMD-27 mandate that **all** sqlite-jdbc calls — reads and writes alike — route through bounded platform thread executors because the xerial sqlite-jdbc driver's `NativeDB.java` declares every JDBC method as `synchronized native`, which produces double-pinning of virtual thread carriers on every Java version (JNI pinning persists even after JEP 491 in Java 25). The persistence module's `WriteCoordinator` and `ReadExecutor` exist specifically to confine this pinning to dedicated platform threads.

A retention thread that opens its own connection and executes JDBC calls on an arbitrary thread bypasses this entire mechanism. It re-introduces the exact JNI carrier pinning problem AMD-26/27 was designed to eliminate. Worse, the second connection contends with the WriteCoordinator's `hs-write-0` thread for SQLite's single writer lock — the WriteCoordinator's priority ordering becomes meaningless because retention now races outside it.

**Decision 2 — nightly cron.** Doc 04 §3.4 says: *"Default schedule: 04:12 local time."*

The Retrofit Research (2026-04-28) documents this as the same pattern that produces recurring database lockups in Home Assistant's `recorder`: a nightly bulk DELETE during sustained sensor writes. The HA failure mechanism is exactly the one described above — long-running DELETE transaction holds the write lock, all concurrent writes accumulate behind it, and the WAL grows. HA users report multi-hour lockups (issues #88780, #94134, #115765, #123348). The 04:12 default merely picks a time when sensor writes are statistically lower, which does not eliminate the pathology, only reduces its frequency.

Both decisions need to be revised before M3 ships retention. AMD-40 makes the revision explicit and locks the corrected execution model into the design.

## Change

**Before (Doc 04 §3.4):**
> The retention thread opens its own read-write SQLite connection (separate from the EventPublisher's write connection). It acquires the single-writer lock via `busy_timeout` for each batch operation, releasing it between batches. Default schedule: 04:12 local time.

**After:**
> The retention subscriber submits all write operations to the persistence layer's write executor (AMD-26/27 compliance). It does not open its own database connection. Scheduling is interval-based (default: every 6 hours), not cron-based. Each purge transaction deletes at most 1,000 rows and holds the write lock for at most 2 seconds. Between purge transactions, the subscriber yields the write executor to allow event appends to proceed. Storage-pressure-triggered purge (when free disk drops below 2× database size) may run outside the normal interval.

## Rationale

**Single-executor architecture.** Every SQLite write in HomeSynapse routes through one of:
- `WriteCoordinator.submit(EVENT_PUBLISH, ...)` — rank 1, foreground event publishes
- `WriteCoordinator.submit(STATE_PROJECTION, ...)` — rank 2, view/subscriber checkpoint writes
- `WriteCoordinator.submit(WAL_CHECKPOINT, ...)` — rank 3, WAL release
- `WriteCoordinator.submit(RETENTION, ...)` — rank 4, retention purges (this amendment)
- `WriteCoordinator.submit(BACKUP, ...)` — rank 5, backup snapshots

The `RETENTION` rank already exists in the `WritePriority` enum specifically for this. The maintenance subscriber must submit its DELETE statements as `RETENTION`-priority callables. This puts retention behind event publishes and checkpoint writes in the queue, so a purge cannot starve foreground operations, but allows retention to make forward progress whenever the writer has spare capacity.

**Interval-based scheduling.** The nightly cron pattern concentrates destructive I/O during a single window. If that window overlaps with sustained sensor writes (e.g., the user has automations scheduled at the cron time), the resulting lock contention can stall foreground operations for many minutes. Interval-based scheduling at 6 hours spreads the same total purge work across four daily windows, each shorter and lower-impact. Combined with the bounded-chunk discipline below, this prevents any single purge from monopolizing the write lock.

**Bounded chunks.** A `DELETE FROM events WHERE ingest_time < ?` with no LIMIT acquires the write lock for the duration of the delete and walks the entire matching subset. On a multi-GB events table, this can take minutes. The bounded-chunk pattern (`DELETE FROM events WHERE ingest_time < ? ORDER BY global_position LIMIT 1000`) breaks the deletion into small transactions, each holding the lock for ≤2 seconds. Between chunks, the WriteCoordinator can drain queued event publishes. This is the same pattern Home Assistant adopted in their post-pathology recorder fixes.

**Pressure-triggered exception.** Storage pressure (free disk < 2× database size) is the one condition that justifies running retention outside the normal interval. The bounded-chunk discipline still applies — pressure-triggered retention runs more frequently, not in larger chunks.

## Implementation Impact

- **`MaintenanceSubscriber` (this work unit):** Phase 2 interface explicitly specifies writer-executor submission, interval-based scheduling, and bounded-chunk discipline in the Javadoc contract. The `DEFAULT_PURGE_BATCH_SIZE = 1_000` and `DEFAULT_MAINTENANCE_INTERVAL = Duration.ofHours(6)` constants are the operational defaults.
- **`MaintenanceResult` (this work unit):** Carries `eventsDeleted`, `batchesExecuted`, `walCheckpointTriggered`, `durationMs` — these are the fields required for operational observability of a purge pass.
- **Phase 3 implementation:** Implements `MaintenanceSubscriber` against `DatabaseExecutor.writeCoordinator()`. Each `DELETE` statement is a `Callable<Integer>` submitted with `WritePriority.RETENTION`. Between submissions, the subscriber waits an implementation-defined yield interval to allow the queue to drain.
- **No existing code is affected.** No Phase 3 retention implementation exists yet. This amendment shapes the interface contract that Phase 3 will be built against.

## Invariant Alignment

- **AMD-26/AMD-27 (Platform thread executor compliance):** This amendment is the explicit alignment of retention with the existing executor mandate. Compliance is non-negotiable: any future deviation from writer-executor submission re-introduces JNI carrier pinning on the retention path.
- **INV-ES-01 (Events are immutable facts):** Retention deletes events past configured retention periods but never modifies them. Bounded-chunk DELETE preserves this invariant — each chunk is a complete delete of N rows, not a partial modification.
- **INV-ES-04 (Write-ahead persistence):** Retention does not interfere with write-ahead durability. Events become candidates for deletion only after they are durable; the durability guarantee is unaffected by the deletion path.
- **INV-RF-05 (Bounded storage):** Retention is the load-bearing mechanism for INV-RF-05. AMD-40 ensures retention can actually run without blocking foreground operations, which is what makes the bounded-storage guarantee operationally achievable.

## Downstream Dependencies

- **MaintenanceSubscriber Phase 3 implementation (M3 or later):** Implements the contract this amendment locks. Routes all DELETE statements through `DatabaseExecutor.writeCoordinator().submit(WritePriority.RETENTION, ...)`. Implements interval scheduling and bounded chunks.
- **RetentionPolicy (this work unit):** Provides the per-priority retention durations consumed by `MaintenanceSubscriber.runMaintenance()`. Defaults are `SOURCE_DEFAULT = (7, 90, 365)` matching `EventPriority` Javadoc.
- **Subscriber checkpoint safety check:** Retention must not delete events past the oldest active subscriber's checkpoint. This is unchanged from Doc 04 §3.4 — only the execution model is amended, not the safety constraint.
- **Doc 04 §3.4 prose:** Should be updated in-place to reflect the new execution model. Until that prose update lands, this amendment is the authoritative reference.

## Why APPLIED Now (Not DRAFT)

Unlike AMD-38 and AMD-39 (which depend on D1 empirical validation), AMD-40 is a structural correction: separate-connection retention violates AMD-26/27 which are already-applied governance amendments. There is no empirical question — the JNI pinning behavior is documented in the xerial sqlite-jdbc source, the executor mandate already exists, and retention must comply. The nightly-cron-to-interval change is also a structural correction: the failure mode is documented in HA's issue history, not a theoretical concern.

This amendment is APPLIED immediately so M3 retention work has a locked execution-model contract to implement against.
