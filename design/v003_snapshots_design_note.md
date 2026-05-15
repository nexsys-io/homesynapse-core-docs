# V003 Migration — Snapshots Table and Index Redundancy

**Date:** 2026-05-15
**Author:** NexSys Coder (M2→M3 bridge work unit)
**Status:** Design note — accompanies `V003__add_snapshots_and_drop_redundant_index.sql`
**Related amendments:** AMD-37 (chain_hash), AMD-38, AMD-39, AMD-40
**Phase:** M2→M3 bridge structural hardening (pre-M3 gate)

## Purpose

V003 adds the `snapshots` table needed by the M3 State Projection's rebuild-performance design and drops a redundant explicit index on the `events` table. This note documents the rationale behind both changes, the relationship to AMD-37's locked decision on `chain_hash`, and a forward-looking section on data contribution readiness so downstream design choices do not inadvertently preclude that capability.

## 1. Snapshots Table — Rebuild Performance for the State Projection

### The replay-cost problem

The State Projection (M3 deliverable) materializes per-entity state by consuming events from the event log. On a clean startup with a freshly-restored checkpoint, the projection resumes from its last known `global_position` and replays everything more recent. On a cold start with no usable checkpoint — which happens after a checkpoint corruption, a projection-schema upgrade that invalidates the existing snapshot, or a restore from backup older than the most recent checkpoint — the projection must replay from `global_position = 1`.

The Typical Home reference workload (defined in the M2→M3 Storage Efficiency Research) is 50 devices reporting at a rate that produces about 29.2M events per year. At that rate, the event log crosses 1M events in approximately 12 days. By the end of the first month of operation, a cold replay is reading more than 2.5M events.

Empirical measurements during the V3 platform-thread executor spike (2026-04-02) put the read-and-apply cost on Pi 5 NVMe at roughly 50,000 events per second when the projection is doing trivial state updates. A 1M-event cold replay takes about 20 seconds. A 2.5M-event cold replay takes about 50 seconds. For a system that boots, restores its state, and resumes accepting writes within an SLO of "fast enough that the user does not notice", this is the wrong order of magnitude.

### Snapshots bound the replay window

Snapshots are per-aggregate point-in-time captures of the projection's materialized state. Each snapshot covers events up through a specific `global_position` and per-subject `subject_sequence`. On restart, the projection loads the most recent snapshot for each aggregate and resumes replay from that aggregate's `last_subject_seq + 1`. The replay window per aggregate is bounded by the snapshot cadence rather than the lifetime of the event log.

At a snapshot cadence of 200 events per aggregate, the worst-case per-aggregate replay is 200 events (~4 ms on Pi 5 NVMe). For 50 aggregates, the worst-case total replay is 200 ms even on a multi-year-old event log. This is well within the boot SLO and removes the cold-start cost as a function of log size.

The 200-event cadence is intentionally aligned with the AMD-38 `event_threshold = 200` checkpoint default. The two cadences serve different purposes — checkpoints flush projection state to durable storage, snapshots capture point-in-time aggregate state for replay-bound purposes — but using the same cadence keeps the operational mental model simple and aligns the cost model.

### Schema choices

| Column | Type | Rationale |
|---|---|---|
| `snapshot_id` | `BLOB(16) NOT NULL PRIMARY KEY` | ULID per LTD-04. Typed `SnapshotId` wrapper added in Phase 3. |
| `subject_ref` | `BLOB(16) NOT NULL` | Column name matches the events table convention exactly. ULID body without the type discriminator. |
| `subject_type` | `TEXT NOT NULL` | Subject type discriminator. Matches the events-table column added during M2.5. |
| `last_position` | `INTEGER NOT NULL` | The global_position of the last event covered by this snapshot. Lets the projection answer "is this snapshot newer than position X" without unpacking the payload. |
| `last_subject_seq` | `INTEGER NOT NULL` | The subject_sequence of the last event covered. Used by the per-aggregate replay loop to know where to resume reading the events table. |
| `schema_version` | `INTEGER NOT NULL DEFAULT 1` | Projection schema version. A bump invalidates existing snapshots and forces a rebuild from the events table. |
| `taken_at` | `INTEGER NOT NULL` | Unix microseconds — matches the events table's `ingest_time` / `event_time` storage convention. Not ISO-8601 TEXT. |
| `payload_size` | `INTEGER NOT NULL` | Computed from serialized payload bytes. Same field shape as the events table. Enables size-based observability without reading the payload BLOB. |
| `payload` | `BLOB NOT NULL` | Jackson-serialized aggregate state snapshot. Encoded through the persistence module's existing `EventPayloadCodec` path, preserving the Jackson isolation invariant. |

`UNIQUE INDEX idx_snapshots_subject ON snapshots(subject_ref, subject_type, last_subject_seq DESC)` provides the load-bearing query for cold start: "the most recent snapshot for this aggregate." The DESC on `last_subject_seq` means the most recent snapshot is the first row returned for any `WHERE subject_ref = ? AND subject_type = ?` lookup.

## 2. Index Redundancy — Dropping `idx_events_subject`

### The redundancy

V001 declares two structures that index the same column pair:

```sql
UNIQUE(subject_ref, subject_sequence)                                    -- inline constraint
CREATE INDEX IF NOT EXISTS idx_events_subject
    ON events(subject_ref, subject_sequence);                            -- explicit index
```

SQLite implements the inline `UNIQUE` constraint as an autoindex (`sqlite_autoindex_events_1`). The autoindex and the explicit `idx_events_subject` index the same columns in the same order. SQLite's query planner considers both during planning but uses only one for any given query. Every query the explicit index could serve, the autoindex serves equivalently — including range scans, equality lookups, and ORDER BY-supported scans.

The explicit index is a duplicate. It costs disk space, page cache memory, and write amplification on every insert, with zero query-plan benefit.

### The cost

The events table is the high-volume table. At the Typical Home rate of 29.2M events per year, every byte of per-row index overhead costs approximately 29 MB of disk per year. SQLite's B-tree index overhead is roughly 25 bytes per row for a two-column composite index covering BLOB(16) + INTEGER (the page header overhead amortizes well at large scale, but per-leaf-row overhead remains).

725 MB per year of redundant index data, growing linearly with the event log, on hardware where the baseline storage target ranges from 16 GB (STUDIO) to 256 GB (HOME) to 1 TB (PERFORMANCE). At the STUDIO scale this is 4.5% of total storage per year of redundancy. The HOME scale is more forgiving but the redundancy is still a measurable fraction of the rotation budget defined by retention.

### The change

`DROP INDEX IF EXISTS idx_events_subject` removes the redundant explicit index. The autoindex remains and continues to serve every query that referenced the dropped index. The query plan is verified equivalent because both indexes have the same `(subject_ref, subject_sequence)` shape.

This is safe because V001 has not shipped to any production database — all existing databases are empty `@TempDir` test instances. Future production deployments start with V003 already applied, so the redundant index never exists in their event log.

## 3. Why chain_hash Is Not Relaxed in V003

AMD-37 (Chain Hash NOT NULL with Zero-Hash Default, APPLIED 2026-05-02) is the authoritative decision on `chain_hash`. The column is `BLOB(32) NOT NULL DEFAULT x'00...'`. The 8.4% per-row overhead from the 32-byte fixed-width column is governance-locked and explicitly accepted as the cost of avoiding a future chain epoch break.

V003 does not modify `chain_hash`. The temptation might arise — for example, "the column is always written as zero until the crypto milestone activates, why not defer it?" — and this section exists to head off that argument.

**Why deferring is wrong.** Two outcomes when chain computation activates without a NOT NULL constraint:

1. **Full-table backfill.** Every pre-activation row with `chain_hash = NULL` must be updated to the zero-hash before chain computation can begin. On a multi-GB event log on Pi hardware, this is a minutes-to-hours operation that monopolizes the single-writer thread. All concurrent writes wait. The same WriteCoordinator serialization that makes the system fast under normal load makes this backfill a write-availability outage.

2. **Chain epoch break.** If backfill is skipped, the chain starts at the first post-activation event. All pre-activation events have NULL chain hashes. Auditors and tamper-evidence verification systems cannot verify continuity from genesis to head. The chain has a gap that is functionally equivalent to "we don't know if the log was tampered with before this date." This undermines the trust guarantee the chain is designed to provide.

AMD-37's NOT NULL with zero-hash default eliminates both outcomes. Every row has a valid chain hash from day one. When chain computation is enabled, the genesis chain hash is calculated over `(zero_hash || event_metadata || payload)` — the zero-hash is a known, deterministic starting value, not an absence of data. The 8.4% storage cost is the price of avoiding both outcomes, and it is the locked decision. V003 carries it forward unchanged.

## 4. Future: Data Contribution Readiness

The HomeSynapse design has consistently emphasized local-first operation and user data sovereignty. A natural extension — opt-in, user-controlled — is anonymized data contribution to NexSys for product analytics, anomaly detection across the install base, and aggregate research output. This section is a forward-looking note, not a commitment to ship that capability; it exists to ensure downstream design work does not inadvertently preclude it.

The existing schema, as of V003, already supports the technical foundation for anonymized export without further schema changes:

- **`event_category` (TEXT NOT NULL)** — already populated on every event by the static `event_type → category` mapping in `EventCategoryMapping`. Enables category-filtered export ("contribute DEVICE_HEALTH events but not PRESENCE events") at row granularity without needing to reverse-derive category from event_type at export time. The category vocabulary (`DEVICE_STATE`, `ENERGY`, `PRESENCE`, `ENVIRONMENTAL`, `SECURITY`, `AUTOMATION`, `DEVICE_HEALTH`, `SYSTEM`) is exactly the consent-scope vocabulary the design has always intended to use for crypto-shredding; the same vocabulary serves contribution scoping.

- **`home_id` (BLOB(16) NOT NULL, AMD-34)** — the home identity column. Anonymization is straightforward: hash with a contribution-specific salt or strip entirely depending on the contribution model. Per-home aggregation can be preserved (preserving the row's relationship to other rows from the same home) while removing the ability to correlate back to the originating installation.

- **`actor_ref` (BLOB(16) nullable)** — the PII anchor. Personal identity flows through this column (PersonId for user-initiated commands) or is `NULL` (system/autonomous events). Redaction rules at export time are simple: events with non-null `actor_ref` either have it hashed-with-salt or get dropped entirely depending on the contribution scope.

What this section asks of future design work is **not** to introduce new columns or constraints that would require schema changes to enable contribution. Specifically:

- Do not store personal identifiers in columns other than `actor_ref` without making the design explicit (today, `home_id` is per-installation and `actor_ref` is per-user; that boundary is clean).
- Do not lose the `event_category` column by collapsing it into `event_type` or moving it into the payload — it must remain queryable for contribution filtering.
- Do not assume `home_id` is always present in payloads — it is in the column, and the column is the authoritative source for the home identity dimension.

If a future amendment introduces a column that captures personal information (e.g., free-text user comments, location names, contact details), that amendment should explicitly call out its contribution implications.

## 5. Migration Operational Notes

- **Resource path:** `core/persistence/src/main/resources/db/migration/events/V003__add_snapshots_and_drop_redundant_index.sql`
- **Migration order:** Flyway/MigrationRunner executes in version order: V001 → V002 → V003. V003 references no columns or tables that V001/V002 did not create. The `DROP INDEX` references `idx_events_subject` which V001 created.
- **Wiring:** `SqlitePersistenceLifecycle.EVENTS_MIGRATION_FILES` is the authoritative manifest of migration filenames. V003 must be added to this list when M3 Phase 3 work wires it into the lifecycle. The current list is `List.of("V001__initial_event_store_schema.sql")` — V002 is already known to be missing per the M2.9 MODULE_CONTEXT.md note, and V003 will be added in the same lifecycle update.
- **Idempotency:** All DDL uses `IF NOT EXISTS` / `IF EXISTS`. Re-running V003 on a database that already has it produces no effect. The `MigrationRunner.hs_schema_version` tracking table is the authoritative idempotency layer; the DDL idempotency is the belt-and-braces safety layer.
- **No backfill required:** The snapshots table is empty at V003 application time. Snapshot creation is a runtime operation performed by the M3 State Projection. The DROP INDEX is a metadata-only operation in SQLite — no row scan, no rewrite.

## 6. Phase 3 Follow-Up

Phase 3 work that will follow this design note:

- **`SqliteSnapshotStore` (M3 scope):** Persistence implementation that writes and reads against the `snapshots` table. Routes writes through `DatabaseExecutor.writeCoordinator().submit(WritePriority.STATE_PROJECTION, ...)` per AMD-26/27. Public interface is `SnapshotStore` (defined in state-store, similar to `ViewCheckpointStore`).
- **State Projection snapshot trigger logic:** The projection writes a snapshot every 200 events per aggregate. Snapshot writes are bounded — a snapshot pass for one aggregate is one transaction.
- **Typed `SnapshotId` wrapper:** Per LTD-04, a `record SnapshotId(Ulid value)` wrapper in state-store. The schema's `BLOB(16)` column already accommodates it.
- **`EVENTS_MIGRATION_FILES` update:** Add `"V003__add_snapshots_and_drop_redundant_index.sql"` to the constant when M3 wires V003 into `SqlitePersistenceLifecycle.start()`.
