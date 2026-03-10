# HomeSynapse Core — Persistence Layer

**Document type:** Subsystem design
**Status:** Locked
**Subsystem:** Persistence Layer
**Dependencies:** Event Model & Event Bus (§3.5 telemetry boundary, §4.2 domain event store schema, §4.3 event type taxonomy, §3.3 retention tiers, §3.4 subscription model, §6.5 emergency retention), State Store & State Projection (§8.3 CheckpointStore interface, §3.3 checkpoint strategy), Device Model & Capability System (§3.1 entity registry structure, §6.6 registry rebuild logic), Identity and Addressing Model (§2.1 ULID references in storage), Glossary v1 (§3.19 Telemetry Ring Store)
**Dependents:** REST API (§8.5 telemetry query interface for telemetry history endpoints per Doc 09 §3.2 Plane 4), Observability & Debugging (Doc 11: §11 health indicator for health aggregation per Doc 11 §7.1, §3.10 migration framework for trace query indexes per Doc 11 §3.4, §3.9 storage pressure monitoring for storage metrics per Doc 11 §3.5), Startup, Lifecycle & Shutdown (Doc 12 — Phase 2 database opening, PRAGMA application, migrations, integrity check)
**Author:** HomeSynapse Core Architecture
**Date:** 2026-03-05

---

## 0. Purpose

The Persistence Layer is the operational backbone of HomeSynapse Core. It owns *how* data is stored, managed, protected, and maintained across years of continuous operation on Raspberry Pi hardware with NVMe storage. Every other subsystem in the platform produces or consumes persistent data — events, checkpoints, telemetry samples, device registry snapshots, configuration state — and every one of those data flows depends on this subsystem to keep that data durable, bounded, recoverable, and healthy.

This subsystem exists because the gap between "SQLite in WAL mode" and "a database that runs reliably for five years on a single-board computer" is enormous. Home Assistant's twelve-year struggle with its Recorder component demonstrates the cost of treating persistence as an implementation detail rather than a first-class design concern. Their experience — unbounded database growth, VACUUM operations that take the system offline for hours, schema migrations that fail mid-flight on embedded hardware, SD card corruption as the most common catastrophic failure mode — provides a detailed catalog of the specific mistakes this subsystem is designed to prevent.

The Persistence Layer does not define what data means. The Event Model owns the event envelope schema. The State Store owns checkpoint content. The Device Model owns registry structure. This subsystem owns the physical storage mechanics: SQLite operational tuning, WAL checkpoint scheduling, retention execution, space reclamation, corruption detection, the telemetry ring store implementation, the aggregation engine that promotes telemetry to domain events, the backup and restore lifecycle, and the multi-file coordination that keeps all of HomeSynapse's persistent state consistent and recoverable.

---

## 1. Design Principles

**Storage commitments are bounded at design time.** Every persistent data structure in the system has a calculable maximum size. The domain event store is bounded by retention policy. The telemetry ring store is bounded by its fixed-size ring buffer. Checkpoint storage is bounded by the number of materialized views (small and enumerable). No data path is permitted to grow without limit. This principle exists because unbounded growth is the root cause of every major persistence failure observed in competitive platforms (INV-RF-05, INV-PR-03).

**Maintenance never blocks recording for extended or unbounded periods.** Retention execution, space reclamation, integrity checks, and backup operations run on separate virtual threads with separate database connections. They yield to the write path by operating in small batches with explicit pauses. The single-writer model (LTD-03, LTD-11) means maintenance and recording compete for the write lock, but maintenance acquires it in short bursts rather than holding it for extended operations. Two operations create bounded blocking windows: weekly WAL TRUNCATE checkpoint (milliseconds to low seconds) and opt-in full VACUUM (administrator-triggered, with pre-verified disk space and duration estimates). Both are scheduled during low-activity windows and are bounded — they cannot run indefinitely. Home Assistant's critical failure — purge and recording sharing a single thread, causing silent event loss when the queue overflows — is the specific failure mode this principle prevents.

**The write path is the durability boundary.** An event is durable when SQLite confirms the INSERT. A checkpoint is durable when the same SQLite transaction commits both the checkpoint data and the subscriber position update. A telemetry sample is written with weaker guarantees — its loss means losing raw granularity, not losing facts. Each store's durability contract is explicit and distinct. This principle operationalizes INV-ES-04 (write-ahead persistence) and INV-PD-06 (offline integrity).

**Backup is continuous and validated, not periodic and assumed.** The system does not depend on users remembering to back up. Pre-upgrade snapshots are mandatory (LTD-14). Routine backups run on a configurable schedule with post-backup integrity verification. A backup that fails validation is discarded and the failure is surfaced. Restore is a first-class operation with post-restore consistency verification. Correctness is atomic within the domain event store; the telemetry ring store backup is best-effort and may lag or lead backup boundaries without affecting replay correctness.

**Degrade visibly, never silently.** When storage pressure rises, the system accelerates retention, drops telemetry before domain events, and surfaces the degradation through health indicators and CRITICAL events. It never silently drops domain events, never silently skips retention, and never allows a maintenance failure to go unreported. This is the persistence-level expression of INV-RF-06 (graceful degradation under partial failure).

---

## 2. Scope and Boundaries

### 2.1 This Subsystem Owns

- SQLite operational configuration for all database files (WAL tuning, PRAGMA settings, checkpoint scheduling, busy timeout management)
- Domain event store file management (`homesynapse-events.db`) — physical operations only; schema is owned by **Event Model & Event Bus** §4.2
- Telemetry ring store file management, schema, and write path (`homesynapse-telemetry.db`)
- The aggregation engine that reads telemetry samples and produces domain events (`telemetry_summary`)
- Retention policy execution — batch deletion by priority tier, subscriber checkpoint safety checks, space reclamation via incremental vacuum
- Storage pressure monitoring and emergency retention escalation
- The `view_checkpoints` table implementing the `CheckpointStore` interface defined by **State Store & State Projection** §8.3
- Backup creation, validation, retention, and restore orchestration
- Database integrity monitoring (`quick_check`, `integrity_check` scheduling)
- VACUUM strategy — incremental vacuum after retention, quarterly full VACUUM as an opt-in maintenance operation
- Storage media detection and adaptive configuration (NVMe vs. SD card behavior)
- Schema migration execution via the migration runner (LTD-07) — the runner mechanics, not individual migration content
- First-run database initialization satisfying INV-CE-02 (zero-configuration first run)
- The domain-vs-telemetry routing decision framework

### 2.2 This Subsystem Does Not Own

- Event envelope schema and event type taxonomy — owned by **Event Model & Event Bus** (§4.2, §4.3). This subsystem executes retention against the schema but does not define it.
- Event bus subscription model and delivery mechanics — owned by **Event Model & Event Bus** (§3.4). This subsystem stores subscriber checkpoints but does not manage subscriptions.
- Checkpoint content interpretation — owned by **State Store & State Projection** (§4.3). This subsystem stores and retrieves opaque byte arrays via the `CheckpointStore` interface.
- Entity registry data structure and rebuild logic — owned by **Device Model & Capability System** (§3.1). This subsystem provides storage but does not interpret registry content.
- Individual migration file content — owned by the subsystem whose schema is being migrated. This subsystem owns the runner that executes migrations.
- Configuration file format and validation — owned by the **Configuration System** (future doc). This subsystem reads its own configuration section from the validated YAML.
- Event production and subscriber notification — owned by **Event Model & Event Bus** (§3.4, §3.5). The aggregation engine produces events via `EventPublisher`, not by direct database insertion.

---

## 3. Architecture

### 3.1 Database File Topology and Initialization

HomeSynapse maintains two SQLite database files under `/var/lib/homesynapse/` (LTD-13):

```
/var/lib/homesynapse/
├── homesynapse-events.db          # Domain event store + subscriber checkpoints + view checkpoints
├── homesynapse-events.db-wal      # WAL file (managed by SQLite)
├── homesynapse-events.db-shm      # Shared memory file (managed by SQLite)
├── homesynapse-telemetry.db       # Telemetry ring store + aggregation high-water marks
├── homesynapse-telemetry.db-wal
├── homesynapse-telemetry.db-shm
└── backups/
    ├── 2026-03-05T14:30:00Z/      # Timestamped backup directory
    │   ├── homesynapse-events.db
    │   ├── homesynapse-telemetry.db
    │   ├── config/                 # Copy of /etc/homesynapse/
    │   └── snapshot.json           # Backup metadata
    ├── 2026-03-04T14:30:00Z/
    └── 2026-03-03T14:30:00Z/
```

The domain event store (`homesynapse-events.db`) contains: the `events` table (schema owned by **Event Model & Event Bus** §4.2), the `subscriber_checkpoints` table (**Event Model & Event Bus** §4.2), the `view_checkpoints` table (§3.12 of this document), the `hs_schema_version` table (LTD-07), and any indexes defined by the Event Model. Materialized view checkpoints are co-located in this file to enable same-transaction updates with subscriber progress — this is the universal recommendation from the event-sourcing community (Marten, Axon, Eventuous) and the strongest correctness story for exactly-once projection semantics.

The telemetry ring store (`homesynapse-telemetry.db`) contains: the `telemetry_samples` table (§3.6), the `aggregation_cursors` table (§3.7), and its own `hs_schema_version` table. This file has a separate migration track from the domain event store.

**First-run initialization sequence** (satisfies INV-CE-02):

1. Detect whether `/var/lib/homesynapse/homesynapse-events.db` exists.
2. If absent, create the database file and set creation-time PRAGMAs: `PRAGMA auto_vacuum = INCREMENTAL` and `PRAGMA page_size = 4096`. These cannot be changed after tables exist.
3. Set connection PRAGMAs (§3.3) on every connection open.
4. Execute pending schema migrations via the migration runner (LTD-07). On first run, this applies all migrations from `V001` through the current version.
5. Repeat steps 1–4 for `homesynapse-telemetry.db`.
6. The Persistence Layer signals readiness. Other subsystems (Event Bus, State Store, Integration Runtime) initialize in dependency order per the Startup & Lifecycle subsystem.

No user configuration is required for first run. Default retention periods, checkpoint intervals, ring store sizes, and maintenance schedules apply. The system is fully operational with defaults on a fresh installation.

### 3.2 Durability Contracts

Each persistent store provides a distinct durability guarantee. These contracts are the physical implementation of INV-ES-04 (write-ahead persistence) and INV-PD-06 (offline integrity).

**Domain event store — full write-ahead durability.**

An event is durable when `sqlite3_step()` returns `SQLITE_DONE` for the INSERT statement and the enclosing transaction commits. With `journal_mode = WAL` and `synchronous = NORMAL` (LTD-03), SQLite guarantees that committed transactions survive process crashes. The data loss window under power loss is limited to the last uncommitted WAL frame — at most one in-flight event append. Since the EventPublisher serializes all writes through a single thread (LTD-11), at most one event can be in flight at any instant. An event that has not been committed was never "persisted" and therefore was never promised to any subscriber.

**Startup recovery sequence for the domain event store:**

1. Open the database file. SQLite automatically replays valid WAL frames (WAL recovery). This is transparent and requires no application logic.
2. Read the `subscriber_checkpoints` table. Each subscriber's `last_position` reflects the last event it successfully processed and checkpointed.
3. Subscribers register with the Event Bus and replay from their respective `last_position` values. Events that were persisted but not yet delivered before the crash are replayed to all subscribers. This satisfies INV-ES-04: no subscriber ever processes an unpersisted event, and every persisted event is eventually delivered.
4. Read the `view_checkpoints` table. Each materialized view loads its checkpoint and replays events from its `position` value.

**View checkpoint — same-transaction atomicity.**

The `CheckpointStore.writeCheckpoint()` implementation wraps the checkpoint data write and the view's position update in a single SQLite transaction on the domain event store database. If the process crashes between computing the checkpoint and committing it, the checkpoint write is lost and the view rebuilds from its previous checkpoint on restart. This guarantees that the view's persisted position never exceeds the data it has processed. The State Store writes checkpoints as opaque byte arrays (§3.12); the Persistence Layer stores them without interpretation.

**Subscriber checkpoint — position-only atomicity.**

Subscriber checkpoints update `last_position` in the `subscriber_checkpoints` table. Because this table is in the same database as the events, a subscriber that wraps its projection update + checkpoint update in a single transaction achieves exactly-once processing semantics. Subscribers that cannot use same-transaction updates (because their projection target is external) fall back to at-least-once semantics with idempotency checks, per INV-ES-05.

**Telemetry ring store — best-effort durability with explicit loss semantics.**

The telemetry ring store is not covered by INV-ES-01 through INV-ES-05 (**Event Model & Event Bus** §3.5, Glossary §3.19). Telemetry samples are written with `synchronous = NORMAL` in WAL mode, providing the same per-transaction crash safety as the domain event store. However, the ring buffer's overwrite semantics mean that old samples are replaced by new ones regardless of whether they have been aggregated. Losing telemetry samples — whether from crash, ring overwrite, or file loss — means losing raw granularity within the retention window. It does not mean losing canonical state, because meaningful state transitions are promoted to domain events by the aggregation engine.

If the telemetry database file is lost or corrupted, it is recreated empty. The aggregation engine's high-water marks (stored in the telemetry database) reset to zero, and aggregation resumes from whatever data accumulates in the new ring buffer. No domain events are lost. No subscriber checkpoints are affected. No state store rebuild is required.

**Startup recovery sequence for the telemetry ring store:**

1. Open the database file. SQLite WAL recovery runs automatically.
2. Read `aggregation_cursors` to resume aggregation from each entity's last-processed sequence.
3. If the file is absent or corrupt, create a fresh database and start with empty cursors. Log a NORMAL event (`telemetry_store_rebuilt`).

### 3.3 Domain Event Store Operations

The domain event store is the most important file in the system. Its operational health determines whether HomeSynapse can record events, serve history queries, and recover from crashes.

**Connection PRAGMAs** (set on every connection open, per LTD-03):

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -128000;          -- 128 MB page cache (LTD-03)
PRAGMA mmap_size = 1073741824;        -- 1 GB mmap (LTD-03)
PRAGMA temp_store = MEMORY;
PRAGMA busy_timeout = 5000;
PRAGMA journal_size_limit = 6144000;  -- 6 MB WAL cap (LTD-03)
PRAGMA cell_size_check = ON;          -- Early corruption detection
```

These values are authoritative per LTD-03. Operational tuning notes: with mmap active at 1 GB, the 128 MB page cache provides a secondary cache layer for pages not yet in the mmap region. On systems where total memory pressure is a concern, reducing `cache_size` while relying on mmap for read caching is a viable optimization — but this requires empirical validation against the specific workload before changing the locked configuration. The `journal_size_limit` at 6 MB allows the WAL to grow slightly beyond the auto-checkpoint threshold (default 1,000 pages ≈ 4 MB) before being truncated, preventing unnecessary truncation churn during normal write patterns.

**WAL checkpoint scheduling:**

SQLite's auto-checkpoint triggers after every COMMIT when the WAL exceeds approximately 1,000 pages (~4 MB), using PASSIVE mode. PASSIVE checkpointing never blocks readers or writers but may leave un-checkpointed frames if readers hold transactions open. This is the normal steady-state behavior and requires no intervention.

The Persistence Layer supplements auto-checkpoint with scheduled operations:

- **Daily:** `PRAGMA wal_checkpoint(PASSIVE)` during the low-activity maintenance window (default: 04:00 local time). This opportunistically moves WAL frames to the database file without blocking any operations.
- **Weekly:** `PRAGMA wal_checkpoint(TRUNCATE)` to reclaim WAL disk space. TRUNCATE resets the WAL file to zero bytes, reclaiming any disk space accumulated from WAL growth. This briefly blocks writers and waits for active readers to finish. Scheduled during the same maintenance window, after the daily PASSIVE checkpoint has already reduced the WAL size.

If the WAL file exceeds 50 MB at any time (indicating checkpoint stalls, likely from long-running read transactions), the Persistence Layer logs a warning and schedules an immediate TRUNCATE checkpoint. The 50 MB threshold is configurable. WAL growth beyond this level indicates a reader is holding a transaction open for an extended period — a condition that must be diagnosed, not ignored.

**Space reclamation strategy:**

The domain event store grows as events are appended and shrinks as retention deletes old events. Without space reclamation, deleted pages accumulate on SQLite's freelist, and the database file never shrinks.

The reclamation strategy uses two tiers:

**Tier 1 — Incremental vacuum (routine, low-impact).** The database is created with `auto_vacuum = INCREMENTAL` (set at creation time, before any tables exist). After each retention pass completes, the Persistence Layer runs `PRAGMA incremental_vacuum(500)` in a loop, processing 500 freelist pages per iteration, until the freelist count drops below a configurable threshold (default: 1,000 pages, approximately 4 MB). Each iteration holds the write lock briefly, then yields. This returns freed pages to the operating system without a full database rebuild.

**Tier 2 — Full VACUUM (quarterly, opt-in).** Incremental vacuum does not defragment the database. Over months of delete-and-append cycles, sequential scan performance degrades as logically adjacent rows become physically scattered. The Persistence Layer monitors the freelist-to-page-count ratio after each incremental vacuum pass. If the ratio exceeds 25% after incremental vacuum has run (indicating significant internal fragmentation that incremental vacuum cannot address), the system flags the condition in its health status and recommends a full VACUUM during the next maintenance window.

Full VACUUM is an opt-in operation, triggered by the administrator via CLI (`homesynapse maintenance vacuum`) or by a configurable automatic schedule (default: disabled). The operation requires 2× the database size in free disk space. Before executing, the system verifies sufficient disk space, creates a backup via `VACUUM INTO` (which produces a compacted copy), and validates the backup with `PRAGMA quick_check`. If verification passes, the backup replaces the original and a TRUNCATE checkpoint follows. If verification fails or disk space is insufficient, the operation is cancelled and the condition is logged. The system continues operating with the fragmented database — fragmentation degrades read performance but does not affect correctness.

### 3.4 Retention Execution

Retention removes events that have exceeded their priority-tier lifetime. The priority tiers, default retention periods, and per-event-type overrides are defined by **Event Model & Event Bus** §3.3 and §9. The Persistence Layer reads retention configuration from the `event_model.retention` namespace — it does not define retention periods independently.

| Priority | Default Retention | Configurable Range |
|---|---|---|
| DIAGNOSTIC | 7 days | 1–365 days |
| NORMAL | 90 days | 7–3,650 days |
| CRITICAL | 365 days | 30–3,650 days |

Per-event-type overrides (e.g., `command_result: 180`, `state_reported: 3`) take precedence over the priority-tier default for matching event types. The Persistence Layer loads these overrides from `event_model.retention.overrides` at startup and applies them during retention execution.

Retention runs on a dedicated virtual thread during a configurable low-activity window (default: 04:12 local time, selected as a typical lowest-activity period for residential households). The time is configurable via `persistence.retention.schedule_time`.

**Retention uses event time, not ingest time.** Per INV-ES-08, retention policies operate on `event_time` to prevent delayed events from being retained longer than intended because they arrived late. Since `event_time` is nullable in the event schema (Doc 01 §4.2), the retention query uses `COALESCE(event_time, ingest_time)` as the timestamp for retention eligibility. Events whose source cannot provide `event_time` have it set equal to `ingest_time` with an `estimated` flag per INV-ES-08, so in practice the COALESCE is a safety net for schema correctness, not a common path. An index on `event_time` (`idx_events_event_time`) is required as an initial schema migration to support efficient retention queries.

**Execution mechanics:**

The retention thread opens its own read-write SQLite connection (separate from the EventPublisher's write connection). It acquires the single-writer lock via `busy_timeout` for each batch operation, releasing it between batches.

1. **Per-event-type override pass.** For each entry in `event_model.retention.overrides`, query eligible events: `SELECT MIN(global_position), MAX(global_position) FROM events WHERE event_type = ? AND COALESCE(event_time, ingest_time) < ?` where the timestamp threshold is `now - override_period`. Process deletions for each override type before the tier-based pass. This ensures that a `state_reported` event with a 3-day override is deleted at 3 days even though its DIAGNOSTIC tier default is 7 days, and a `command_result` event with a 180-day override survives past the NORMAL tier's 90-day default.
2. **Per-priority-tier pass.** For each priority tier, starting with DIAGNOSTIC: query `SELECT MIN(global_position), MAX(global_position) FROM events WHERE priority = ? AND COALESCE(event_time, ingest_time) < ? AND event_type NOT IN (?)` where the NOT IN clause excludes event types already handled by the override pass, and the timestamp threshold is `now - tier_retention_period`.
3. If no eligible events exist for a tier, skip to the next.
4. **Subscriber checkpoint safety check:** query `SELECT MIN(last_position) FROM subscriber_checkpoints WHERE subscriber_id IN (SELECT subscriber_id FROM subscriber_checkpoints WHERE last_position > 0)`. If any active subscriber's `last_position` falls within the deletion range, the behavior depends on the subscriber's activity:
   - If the subscriber's `last_updated` is within the grace period (default: 24 hours, configurable via `persistence.retention.subscriber_grace_period`), skip the events between the subscriber's checkpoint and the retention boundary. Emit `subscriber_falling_behind` (NORMAL). These events are retained until the subscriber catches up or the grace period expires.
   - If the subscriber's `last_updated` exceeds the grace period, the subscriber is considered stalled. Emit `subscriber_checkpoint_expired` (CRITICAL) and proceed with deletion. This is a degraded durability condition for that specific subscriber — the subscriber's at-least-once delivery guarantee is weakened, but this is acceptable because subscribers are idempotent by contract (INV-ES-05). The alternative — allowing a stalled subscriber to prevent all retention indefinitely — would violate INV-RF-05 (bounded storage).
5. Delete in batches of 1,000 rows per transaction: `DELETE FROM events WHERE global_position BETWEEN ? AND ? LIMIT 1000`. After each batch, yield for 50 ms (`Thread.sleep(50)` or virtual thread park) to allow the EventPublisher's write transactions to proceed. This interleaving prevents the retention thread from holding the write lock long enough to cause observable append latency.
6. After all tiers are processed, run incremental vacuum (§3.3, Tier 1).
7. Log a structured summary: events deleted per tier, events deleted per override, duration, freelist pages reclaimed.

**Retention never deletes events newer than the oldest active view checkpoint.** Before beginning any deletion pass, the retention thread queries `SELECT MIN(position) FROM view_checkpoints`. Events at or after this position are exempt from retention regardless of their age and priority, because deleting them would invalidate a materialized view's ability to rebuild from its checkpoint. This check is in addition to the subscriber checkpoint safety check and provides a second layer of protection for the State Store and future projections.


### 3.5 Storage Pressure Management

HomeSynapse operates on hardware with finite storage. The Persistence Layer monitors disk usage and takes progressively aggressive action as free space decreases. This section defines the escalation protocol that prevents the system from filling the disk and becoming non-functional.

**Monitoring cadence.** A storage monitor virtual thread checks available disk space every 60 seconds under normal conditions. When any threshold is breached, the cadence increases to every 10 seconds until the condition clears.

**Three-threshold escalation:**

The emergency retention mechanism uses an absolute free-space threshold as the primary trigger, consistent with **Event Model & Event Bus** §6.5 and §9 (`emergency_threshold_mb: 500`). The percentage-based thresholds below provide earlier warning and graduated response before the absolute threshold is reached.

| Threshold | Name | Trigger | Action |
|---|---|---|---|
| 80% of storage budget used | WARNING | Structured log `persistence.storage_pressure` (WARN) | Accelerate next scheduled retention to run immediately. Log storage breakdown per database file. No domain event produced — this is an operational signal, not a system state change. |
| Free space < `emergency_threshold_mb` (default: 500 MB, per Event Model §9) | CRITICAL | `system_storage_critical` (CRITICAL, per Event Model §4.3) | Run emergency retention: delete DIAGNOSTIC events older than 1 day (overriding the configured default). Disable telemetry ring store writes (telemetry samples are silently dropped; the aggregation engine produces partial or empty summaries). |
| Free space < 50% of `emergency_threshold_mb` | EMERGENCY | `system_storage_critical` (CRITICAL, same event type with `severity: emergency` in payload) | Run emergency retention against NORMAL events: reduce NORMAL retention to 7 days. If still below threshold, reduce to 1 day. CRITICAL events are never subject to emergency retention — if the system cannot store a CRITICAL event, the underlying hardware has failed, not the software. |

The storage budget calculation (80% of partition capacity by default, configurable via `persistence.storage.budget_bytes`) determines the WARNING threshold. The CRITICAL and EMERGENCY thresholds use the absolute MB value from `event_model.retention.emergency_threshold_mb` to maintain consistency with **Event Model & Event Bus** §6.5.

**Cross-document reconciliation note.** **Event Model & Event Bus** §6.5 states that if emergency retention cannot free sufficient space, "the system logs an error and continues operating in a degraded mode where new events replace the oldest events." This document's position differs: CRITICAL events are never automatically purged, and the system never silently overwrites committed domain events. Overwriting committed events would violate INV-ES-01 (events are immutable facts, removed only by explicit retention). If the system reaches a point where CRITICAL facts cannot be persisted, the correct behavior is to enter an explicit degraded state, not to mutate history. **Event Model & Event Bus** §6.5 should be amended to match this position. Until that amendment is applied, this document's behavior is authoritative for the Persistence Layer's implementation.

**Per-store budgets.** Within the total budget, the Persistence Layer tracks per-file usage:

| Store | Typical Size (50 devices, 1 year) | Growth Pattern |
|---|---|---|
| Domain event store | 500 MB – 2 GB | Grows with event volume, shrinks with retention |
| Telemetry ring store | 3 – 50 MB (fixed by `max_rows`) | Fixed size — does not grow |
| Backups (3 generations) | 1.5 – 6 GB | Proportional to domain event store size |

The telemetry ring store's fixed-size property means it never contributes to storage pressure growth. If the domain event store is the pressure source, retention addresses it. If backups are the pressure source (because the domain event store grew and backup generations reflect the larger size), the system can reduce backup retention from 3 to 2 generations before escalating to event retention.

**Drop order under emergency retention:**

1. Telemetry raw samples (ring store writes disabled — zero-cost, immediate)
2. DIAGNOSTIC domain events older than 1 day
3. DIAGNOSTIC domain events older than 1 hour
4. Backup generations beyond the most recent 1
5. NORMAL domain events older than 7 days
6. NORMAL domain events older than 1 day

CRITICAL domain events are never dropped by emergency retention. The system continues operating in degraded mode, recording only CRITICAL events if necessary, until the operator addresses the storage situation.

**Visibility.** The `hs_persistence_storage_*` metrics (§11.1) report per-file sizes, freelist counts, and the current pressure level. The health indicator (§11.3) transitions from HEALTHY to DEGRADED at the WARNING threshold and to UNHEALTHY at the CRITICAL threshold. The REST API health endpoint includes the pressure level and a human-readable explanation of what the system is doing about it.

### 3.6 Telemetry Ring Store

The telemetry ring store (`homesynapse-telemetry.db`) is a separate SQLite file for high-frequency numeric samples that would overwhelm the domain event store if treated as full events. It uses a modular-rowid ring buffer pattern that provides a fixed-size storage guarantee with zero DELETE operations.

**Schema:**

```sql
-- Creation-time PRAGMAs (set before any tables)
PRAGMA auto_vacuum = NONE;  -- Ring buffer is fixed-size; no vacuum needed
PRAGMA page_size = 4096;

-- Telemetry samples ring buffer
CREATE TABLE telemetry_samples (
    slot          INTEGER PRIMARY KEY,   -- sequence % max_rows
    entity_ref    BLOB(16) NOT NULL,
    attribute_key TEXT     NOT NULL,
    value         REAL     NOT NULL,     -- Numeric only
    ts            INTEGER  NOT NULL,     -- Unix microseconds
    seq           INTEGER  NOT NULL      -- Monotonic write counter
);
CREATE INDEX idx_telemetry_entity_ts ON telemetry_samples(entity_ref, ts);
CREATE INDEX idx_telemetry_entity_seq ON telemetry_samples(entity_ref, seq);
CREATE INDEX idx_telemetry_seq ON telemetry_samples(seq);

-- Schema version tracking (separate migration track)
CREATE TABLE hs_schema_version (
    version     INTEGER PRIMARY KEY,
    checksum    TEXT NOT NULL,
    description TEXT NOT NULL,
    applied_at  TEXT NOT NULL,
    success     INTEGER NOT NULL DEFAULT 1
);
```

**Ring buffer mechanics:**

The ring buffer uses `INSERT OR REPLACE` with `slot = sequence % max_rows`. The `sequence` is a monotonically increasing counter maintained in application memory and persisted as the maximum `seq` value in the table. On startup, the counter is initialized from `SELECT MAX(seq) FROM telemetry_samples` (or 0 if the table is empty).

Each write computes `slot = next_seq % max_rows` and executes `INSERT OR REPLACE INTO telemetry_samples (slot, entity_ref, attribute_key, value, ts, seq) VALUES (?, ?, ?, ?, ?, ?)`. The `INSERT OR REPLACE` overwrites the existing row at that slot, replacing old data with new data. No DELETE operations occur. No freelist pages accumulate. The B-tree structure remains stable. The database file size is fixed at approximately `max_rows × row_size + index_overhead`.

**`INSERT OR REPLACE` semantics note.** In SQLite, `INSERT OR REPLACE` (equivalently `REPLACE`) performs a delete-then-insert when a conflict occurs on the PRIMARY KEY. This is safe for the telemetry ring store because the table has no triggers, no autoincrement, no foreign keys, and no dependent rows in other tables. The alternative — `INSERT INTO ... ON CONFLICT(slot) DO UPDATE SET ...` (UPSERT) — is semantically equivalent for this table and avoids the implicit delete. Either implementation satisfies the design; the key constraint is that the `slot` primary key is the only conflict target and no cascading side effects exist.

The `max_rows` parameter is configurable via `persistence.telemetry.max_rows` (default: 100,000). At 30 bytes per row plus index entries, the default produces a database file of approximately 5–8 MB. At 1 sample/second from 8 energy circuits (691,200 samples/day), a 100,000-row ring holds approximately 3.5 hours of data per circuit. For deployments with fewer high-frequency sources, the effective retention per entity is proportionally longer.

**Sizing recommendation for energy-focused deployments.** The `max_rows` value should be at least `2 × aggregation_interval_seconds × max_write_rate × source_count` to ensure the aggregation engine has a full interval of headroom before the ring buffer wraps. For example, with a 5-minute aggregation interval, 1 Hz write rate, and 8 energy circuits: `2 × 300 × 1 × 8 = 4,800` rows minimum. The 100,000 default provides substantial headroom at this scale. Deployments with more sources or higher rates should increase `max_rows` proportionally. The formula ensures the aggregation engine can tolerate one full missed cycle (due to stall, GC pause, or backpressure) without losing data.

**Non-numeric data exclusion.** The telemetry ring store accepts only numeric (`REAL`) values. Non-numeric telemetry (string states, enum values, complex objects) flows through the domain event path as `state_reported` events at DIAGNOSTIC priority. The `value REAL NOT NULL` constraint enforces this at the schema level. The rationale: aggregation operations (min, max, mean, sum) are meaningful only for numeric data. Non-numeric state changes are inherently semantic events and belong in the domain event store.

**Write path:** Integration adapters declare at registration time whether their data flows through the domain path or the telemetry path (**Event Model & Event Bus** §3.5). The Integration Runtime routes samples to the telemetry ring store's write interface, which batches writes into transactions of up to 100 samples (configurable) for throughput efficiency. Batched transactions reduce WAL overhead and fsync frequency.

**Connection PRAGMAs** for the telemetry database:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -8192;            -- 8 MB (small file, less cache needed)
PRAGMA mmap_size = 0;                 -- Disabled; file is small enough for page cache
PRAGMA temp_store = MEMORY;
PRAGMA busy_timeout = 2000;
PRAGMA journal_size_limit = 2097152;  -- 2 MB WAL cap
```

The telemetry database uses a smaller page cache and no mmap because the file is small (< 10 MB typically) and fits comfortably in the page cache. WAL auto-checkpoint at 1,000 pages is sufficient for this file size.

### 3.7 Aggregation Engine

The aggregation engine reads raw samples from the telemetry ring store and produces domain events that represent meaningful summaries. It is the only path from telemetry data to the domain event store (**Event Model & Event Bus** §3.5).

**Execution model:** A dedicated virtual thread wakes on a configurable interval (default: 5 minutes, configurable via `persistence.aggregation.interval_minutes`, range: 1–60). On each cycle:

1. Read the `aggregation_cursors` table to determine the last-processed `seq` value for each registered telemetry entity.
2. For each entity with a cursor, query `SELECT * FROM telemetry_samples WHERE entity_ref = ? AND seq > ? ORDER BY seq` to find unprocessed samples.
3. If no unprocessed samples exist for an entity, skip it.
4. Compute aggregates over the unprocessed samples: `min`, `max`, `mean`, `sum`, `count`, and the time range (`first_ts`, `last_ts`).
5. Produce a `telemetry_summary` event at DIAGNOSTIC priority via `EventPublisher.publish()`. The event payload carries the computed aggregates, the entity reference, the attribute key, and the time range.
6. Update the entity's cursor in `aggregation_cursors` to the highest `seq` value processed.

**High-water mark storage:**

```sql
CREATE TABLE aggregation_cursors (
    entity_ref    BLOB(16) NOT NULL,
    attribute_key TEXT     NOT NULL,
    last_seq      INTEGER  NOT NULL,
    last_run      INTEGER  NOT NULL,     -- Unix microseconds
    PRIMARY KEY (entity_ref, attribute_key)
);
```

The cursor table is stored in the telemetry database file (`homesynapse-telemetry.db`), not the domain event store. This keeps the telemetry file self-contained: if the telemetry file is lost and recreated, the cursors reset to zero and aggregation resumes from fresh data. Storing cursors in the domain event store would preserve stale high-water marks pointing at data that no longer exists.

**Ring overwrite detection:** Because the ring buffer overwrites old data, the aggregation engine may encounter a gap between its cursor and the oldest data in the ring. This happens when the aggregation engine is slower than the write rate (the ring has wrapped around since the last aggregation cycle). Detection: after querying for unprocessed samples, compare the minimum `seq` value in the result set against `last_seq + 1`. If there is a gap:

1. Log a warning: `aggregation.samples_lost`, including the entity reference, the gap size, and the estimated number of samples lost.
2. Produce a partial `telemetry_summary` event with a `partial: true` flag in the payload and the actual time range covered.
3. Advance the cursor past the gap to the minimum available `seq`.

This condition indicates that either the aggregation interval is too long for the write rate or the ring buffer is too small for the number of entities. The health indicator transitions to DEGRADED, and the structured log includes recommendations (increase `max_rows` or decrease `aggregation.interval_minutes`).

**Entity registration for aggregation:** Entities are registered for telemetry aggregation when their integration adapter declares a telemetry path at registration time. The Integration Runtime communicates this to the Persistence Layer, which creates or updates the corresponding `aggregation_cursors` entry. If an entity is deregistered (device removed), its cursor row remains in the table but is ignored by the aggregation cycle (no matching samples will appear). A periodic cleanup task removes cursors for entities that have had no samples for 30 days.

### 3.8 Domain vs. Telemetry Routing

The Event Model defines the boundary criterion as "> 1 sample per 10 seconds sustained per entity" (**Event Model & Event Bus** §3.5). This is a rate-based heuristic. The Persistence Layer extends this with semantic criteria that govern routing decisions when rate alone is ambiguous.

**The routing decision question:** "If this single data point were lost, would an automation produce a different result on replay?"

If the answer is yes, the data is a domain event. If the answer is no — the meaningful signal is the trend or aggregate, not any individual sample — the data is a telemetry candidate.

**Routing decision table:**

| Data Type | Example | Store | Rationale |
|---|---|---|---|
| Discrete state transition | Door open/close, lock/unlock, motion detected | Domain (state_reported) | Loss breaks automation replay, audit trail, and causal chain integrity. Every transition is a fact. |
| Command and result | set_brightness(75%), command acknowledged | Domain (command_issued, command_result) | Loss breaks the intent-to-observation loop. |
| Availability change | Device online/offline | Domain (availability_changed) | Loss breaks monitoring and uptime history. |
| Continuous numeric measurement at low rate | Temperature every 30s, humidity every 60s | Domain (state_reported) | Rate is within domain store capacity. Individual readings may trigger automations. |
| Continuous numeric measurement at high rate | Energy power draw every 1s, current every 500ms | Telemetry ring store | Rate exceeds domain store capacity. Meaningful signal is the 5-minute aggregate (min/max/mean), not individual samples. |
| Binary sensor rapid transitions | Vibration sensor, rapid motion sensor | Domain (state_reported) | Each transition is semantically meaningful even if frequent. Rate limiting at the integration level, not the persistence level. |

**The integration adapter declares the path at registration time.** The Persistence Layer does not inspect data to determine routing — the integration's declaration is authoritative. However, the Persistence Layer validates the declaration against the routing criteria above and logs a warning if an integration declares a domain path for data that exceeds the sustained rate threshold, or declares a telemetry path for data that is semantically discrete (non-numeric).

**What telemetry loss means:** Losing telemetry samples means losing raw granularity within the ring buffer's retention window. The 5-minute aggregation summaries (promoted to domain events) preserve the trend. Historical queries for periods older than the ring buffer's capacity return aggregated data, not raw samples. This is equivalent to RRD4j's resolution hierarchy — recent data is high-resolution, older data is lower-resolution. The difference is that HomeSynapse's boundary is explicit and documented, while RRD's is implicit in its archive definitions.

### 3.9 Storage Detection and Adaptation

LTD-02 mandates NVMe storage for production. The Persistence Layer operationalizes this requirement by detecting the storage medium at startup and adapting its behavior accordingly.

**Detection mechanism:** At startup, before opening database files, the Persistence Layer inspects the block device underlying `/var/lib/homesynapse/` via `/sys/block/`. SD cards are identifiable as `mmcblk*` devices. NVMe devices appear as `nvme*`. USB storage appears as `sd*` with rotational flag inspection.

| Detected Storage | Classification | Behavior |
|---|---|---|
| NVMe (`nvme*`) | Production | Full configuration per LTD-03. mmap enabled. All maintenance operations enabled. |
| USB SSD (`sd*`, rotational = 0) | Acceptable | Full configuration. mmap enabled. Log INFO noting USB SSD detected. |
| SD card (`mmcblk*`) | Degraded | Emit `system_storage_critical` (CRITICAL, per Event Model §4.3) at startup with `reason: degraded_storage_media` in payload. Disable mmap (`PRAGMA mmap_size = 0`) to avoid SIGBUS crashes on failing sectors. Increase `commit_interval` recommendation in logs. System operates but with degraded performance and reduced durability confidence. |
| USB HDD (`sd*`, rotational = 1) | Degraded | Same as SD card behavior. Rotational storage has acceptable endurance but poor random I/O. |
| Unknown | Default | Treat as NVMe (full configuration). Log a DEBUG message noting the storage type could not be determined. |

The system does not refuse to start on SD card storage — that would violate INV-CE-02 (zero-configuration first run). A user's first experience may be on an SD card. The system operates correctly but warns visibly that the configuration is not suitable for long-term production use.

**mmap and SIGBUS risk:** When SQLite maps the database into memory via mmap, I/O errors on the mapped pages become SIGBUS signals instead of error codes that SQLite can handle gracefully. On NVMe, sector-level failures are extremely rare and typically preceded by SMART warnings. On SD cards, sector failures are common and unpredictable. Disabling mmap on SD card storage prevents an unrecoverable process crash from a storage I/O error, at the cost of reduced read performance (the page cache provides the only caching layer).

**Startup integrity validation:**

The startup integrity strategy balances thoroughness against the 30-second startup target (MVP §8.2). A 1–2 GB event store makes unconditional `quick_check` on every startup incompatible with fast restart — the same startup-time failure mode that Home Assistant's RPi users experience.

On every startup, regardless of storage type:

1. WAL recovery runs automatically when SQLite opens the database file. No application logic required. This handles the most common corruption vector (incomplete WAL writes from unclean shutdown).
2. Verify the `hs_schema_version` table is consistent (no failed migrations recorded). If a migration was recorded as failed, halt startup and direct the operator to restore from the pre-migration backup.
3. **Unclean shutdown detection.** On startup, the Persistence Layer checks for a marker file (`/var/lib/homesynapse/.running`). If the marker exists, the previous shutdown was unclean (crash, power loss, SIGKILL). The Persistence Layer writes this marker on successful startup and deletes it during graceful shutdown.
   - **After clean shutdown:** No integrity check. Startup proceeds immediately.
   - **After unclean shutdown:** Run `PRAGMA quick_check` on the domain event store. If quick_check passes, log an INFO message and continue. If quick_check fails, log a CRITICAL error, emit `system_integrity_failure`, and attempt to open the most recent backup as a fallback (§3.10).

`PRAGMA quick_check` also runs on a daily schedule during the maintenance window (§3.3) for proactive detection of silent corruption. `PRAGMA integrity_check` (full O(N log N) verification including index-to-table consistency) runs on a configurable schedule — default monthly — via the maintenance scheduler. Both scheduled checks run without blocking startup.

### 3.10 Backup and Restore Lifecycle

Backup and restore are first-class operations, not power-user features. The Persistence Layer implements backup creation, validation, retention, and restore in coordination with the upgrade workflow defined by LTD-14.

**Backup creation:**

Backups are created in three scenarios: pre-upgrade snapshots (mandatory per LTD-14), scheduled routine backups (configurable, default: daily at 03:00), and manual backups via CLI (`homesynapse backup create`).

The backup process for each scenario:

1. Create the timestamped backup directory under `/var/lib/homesynapse/backups/`.
2. Back up the domain event store using the SQLite backup API: `sqlite3_backup_init()` on a separate read connection, then `sqlite3_backup_step(pBackup, -1)` to copy all pages in one call. The `-1` step size avoids the restart-on-modification problem that occurs with small step sizes — in WAL mode, this copies the entire database without blocking the write path and without restarting if the source is modified during the copy. Estimated duration on NVMe: 1–4 seconds for a 2 GB database.
3. Back up the telemetry ring store using the same mechanism. This is optional for routine backups (configurable via `persistence.backup.include_telemetry`, default: true) but mandatory for pre-upgrade snapshots.
4. Copy the configuration directory (`/etc/homesynapse/`) into the backup.
5. Write `snapshot.json` metadata:
   ```json
   {
     "version": "1.0",
     "created_at": "2026-03-05T14:30:00.000000Z",
     "homesynapse_version": "0.1.0",
     "events_global_position": 48523,
     "events_file_size_bytes": 524288000,
     "telemetry_included": true,
     "telemetry_max_seq": 615234,
     "schema_version_events": 3,
     "schema_version_telemetry": 1,
     "storage_type": "nvme",
     "integrity_check": "quick_check_passed"
   }
   ```
6. Validate the backup: run `PRAGMA quick_check` on the backed-up database files. If validation fails, discard the backup directory, log a CRITICAL error, and emit `system_backup_failed`. A backup that fails validation is never counted toward the retention limit.
7. Prune old backups: retain the most recent N valid backups (default: 3, per LTD-14, configurable via `persistence.backup.retention_count`).

**Backup sequencing and consistency.** The domain event store and telemetry ring store are backed up sequentially, not simultaneously — there is no cross-file atomic snapshot. Events appended between the two backup operations create a minor inconsistency — the telemetry backup may contain samples that are slightly newer than the event store backup. This is acceptable because correctness is atomic within the domain event store (the single file that contains events, subscriber checkpoints, and view checkpoints), and the telemetry ring store is explicitly non-canonical (its loss does not affect domain correctness). The `events_global_position` in the snapshot metadata records the exact position at backup time, enabling the restore process to reason about what was captured.

**Restore process:**

Restore replaces all persistent state atomically and restarts the system. It is triggered via CLI (`homesynapse restore --from <backup-directory>`) or automatically during a failed upgrade rollback (LTD-14).

1. Validate the target backup: verify `snapshot.json` exists and is parseable. Run `PRAGMA quick_check` on both database files in the backup.
2. If validation fails, refuse the restore and report which file failed and why.
3. Stop the HomeSynapse service (if running).
4. Move current database files to a temporary "pre-restore" directory (safety net).
5. Copy backup database files to `/var/lib/homesynapse/`.
6. Restore configuration files to `/etc/homesynapse/`.
7. Start the HomeSynapse service.
8. The startup sequence (§3.2) handles recovery: WAL replay, subscriber checkpoint loading, materialized view catch-up from their checkpointed positions. Events ingested between the backup and the restore are lost — this is documented in LTD-14 and is the expected behavior for a restore operation.
9. If startup succeeds (health check passes), remove the "pre-restore" temporary directory. If startup fails, restore from the pre-restore directory and report the failure.

**Corruption decision tree:**

When corruption is detected (via `quick_check` failure, SQLite error codes, or application-level inconsistency):

| Condition | Recovery |
|---|---|
| Event store corrupt, checkpoints valid | Restore event store from backup. Subscriber checkpoints in the backup are older — subscribers replay from their backup positions. Events between backup and corruption are lost. |
| Checkpoints corrupt, event store intact | Materialized views rebuild from the event log. Startup takes longer (full replay) but no data is lost. |
| Both corrupt | Restore from the most recent validated backup. All data between backup and corruption is lost. |
| No valid backup exists | Create a fresh database. All history is lost. Emit `system_data_loss` (CRITICAL). Device state re-syncs from physical devices on the next report cycle. This is the scenario HomeSynapse must minimize through validated backup discipline. |

### 3.11 Schema Compatibility Guarantees

The Persistence Layer manages schema evolution for multiple database files, each with its own migration track.

**Index independence from event payloads.** The domain event store indexes operate on envelope fields (`global_position`, `subject_ref`, `subject_sequence`, `event_type`, `correlation_id`, `ingest_time`) — never on JSON payload content. Event payload schema versions change over time as event types evolve (**Event Model & Event Bus** §3.7, INV-ES-07), but these changes are invisible to the persistence layer's indexes. Payload fields are queryable only through application-level JSON extraction after the event is loaded, or via full-table scan with `json_extract()`. This constraint is intentional: coupling indexes to payload content would require index rebuilds on every payload schema change, replicating HA's painful migration experience.

**Checkpoint schema versioning.** Each checkpoint stored in the `view_checkpoints` table carries a `schema_version` integer (included in the checkpoint byte array by the producing subsystem — see **State Store & State Projection** §3.3). The Persistence Layer stores this as part of the opaque data and does not interpret it. On startup, the consuming subsystem (e.g., the State Store) reads its checkpoint, inspects the `schema_version`, and decides whether it can use the checkpoint or must discard it and rebuild from events. This is the event-sourcing safety net: any materialized view can be rebuilt from the event log at any time. A checkpoint schema version mismatch triggers a full replay, not a migration — checkpoints are an optimization, not a source of truth.

**Multi-file migration mechanics.** The domain event store and telemetry ring store have independent `hs_schema_version` tables and independent migration tracks. Migration files are organized by target database:

```
src/main/resources/db/migration/
├── events/
│   ├── V001__initial_event_store_schema.sql
│   ├── V002__add_view_checkpoints.sql
│   └── V003__add_retention_indexes.sql
└── telemetry/
    ├── V001__initial_telemetry_schema.sql
    └── V002__add_aggregation_cursors.sql
```

The migration runner (LTD-07) executes against each database independently. If the events database migration succeeds but the telemetry migration fails, the system halts startup with a clear error identifying which file and which migration failed. The pre-migration backup (mandatory per LTD-07) enables recovery by restoring both files to their pre-migration state.

**Version conflict detection.** If the system opens a database whose `hs_schema_version` is ahead of the application's expected version (for example, after a rollback to an older HomeSynapse version), the migration runner refuses to execute and halts startup. The operator must either upgrade to a version that matches the database schema or restore from a backup taken before the forward migration.

### 3.12 View Checkpoint Store

The `view_checkpoints` table implements the `CheckpointStore` interface defined by **State Store & State Projection** §8.3. It is stored in the domain event store database (`homesynapse-events.db`) to enable same-transaction updates with event processing.

**Schema:**

```sql
CREATE TABLE view_checkpoints (
    view_name   TEXT    PRIMARY KEY,
    position    INTEGER NOT NULL,       -- global_position at checkpoint time
    data        BLOB    NOT NULL,       -- Opaque checkpoint content
    updated_at  INTEGER NOT NULL        -- Unix microseconds
);
```

The `view_name` parameter supports multiple materialized views sharing the same checkpoint infrastructure. The State Store uses `"entity_state"` as its view name. Future projections (automation history, energy analytics, causal chain index) use different view names. The table stores only the latest checkpoint per view — there is no checkpoint history. Writes use `INSERT OR REPLACE` semantics.

**Same-transaction semantics.** When a materialized view writes a checkpoint, the implementation wraps the checkpoint write and the subscriber's position update in a single SQLite transaction:

```java
// Pseudocode — actual implementation in Phase 2
connection.setAutoCommit(false);
try {
    // Update the subscriber's position
    updateSubscriberCheckpoint(subscriberId, position);
    // Write the view checkpoint
    insertOrReplaceViewCheckpoint(viewName, position, data);
    connection.commit();
} catch (Exception e) {
    connection.rollback();
    throw e;
}
```

Both the `subscriber_checkpoints` and `view_checkpoints` tables are in the same SQLite file. The single-transaction guarantee means: if the process crashes after the checkpoint data is computed but before the transaction commits, neither the checkpoint nor the subscriber position is updated. On restart, the view replays from its previous position and recomputes the checkpoint. No state can advance beyond its durable checkpoint.

**Checkpoint size expectations.** The State Store's checkpoint for 150 entities (a large home) is approximately 75 KB of JSON (**State Store & State Projection** §3.3). At the maximum checkpoint frequency (every 30 seconds), this produces ~216 MB/day of checkpoint writes — negligible on NVMe, manageable on USB SSD. The `data BLOB` column stores the serialized byte array directly; no compression is applied at the persistence layer because the checkpoint write budget (< 2 seconds, INV-PR-02) must not be consumed by compression overhead.

**Checkpoint retention.** Only the latest checkpoint per view is retained in the database. Old checkpoints are overwritten by `INSERT OR REPLACE`. The Persistence Layer does not maintain checkpoint history. If checkpoint history is needed for debugging, the structured logs capture checkpoint metadata (position, size, duration) on each write.

---

## 4. Data Model

### 4.1 Tables Owned by This Subsystem

The Persistence Layer owns the following tables. Tables owned by other subsystems (the `events` table, `subscriber_checkpoints`) are documented in their respective design documents and are not redefined here.

**`view_checkpoints`** (in `homesynapse-events.db`):

| Column | Type | Constraints | Description |
|---|---|---|---|
| `view_name` | TEXT | PRIMARY KEY | Stable identifier for the materialized view (e.g., `"entity_state"`) |
| `position` | INTEGER | NOT NULL | The `global_position` at checkpoint time |
| `data` | BLOB | NOT NULL | Opaque serialized checkpoint content |
| `updated_at` | INTEGER | NOT NULL | Unix microseconds of the checkpoint write |

**`telemetry_samples`** (in `homesynapse-telemetry.db`):

| Column | Type | Constraints | Description |
|---|---|---|---|
| `slot` | INTEGER | PRIMARY KEY | `sequence % max_rows` — the ring buffer position |
| `entity_ref` | BLOB(16) | NOT NULL | Entity ULID (LTD-04) |
| `attribute_key` | TEXT | NOT NULL | Attribute identifier within the entity's capability |
| `value` | REAL | NOT NULL | Numeric measurement value |
| `ts` | INTEGER | NOT NULL | Unix microseconds of the sample |
| `seq` | INTEGER | NOT NULL | Monotonic write counter for ordering and aggregation cursor tracking |

Indexes: `(entity_ref, ts)` for time-range queries per entity, `(entity_ref, seq)` for the aggregation engine's primary query pattern (`WHERE entity_ref = ? AND seq > ? ORDER BY seq`), `(seq)` for global sequence queries.

**`aggregation_cursors`** (in `homesynapse-telemetry.db`):

| Column | Type | Constraints | Description |
|---|---|---|---|
| `entity_ref` | BLOB(16) | NOT NULL, composite PK | Entity ULID |
| `attribute_key` | TEXT | NOT NULL, composite PK | Attribute identifier |
| `last_seq` | INTEGER | NOT NULL | Highest `seq` value processed by the aggregation engine |
| `last_run` | INTEGER | NOT NULL | Unix microseconds of the last aggregation cycle for this entity |

### 4.2 Tables Referenced but Not Owned

| Table | Owner | Database File | Persistence Layer Role |
|---|---|---|---|
| `events` | Event Model & Event Bus §4.2 | `homesynapse-events.db` | Executes retention deletes, runs integrity checks, manages WAL/VACUUM. Does not modify schema. |
| `subscriber_checkpoints` | Event Model & Event Bus §4.2 | `homesynapse-events.db` | Reads during retention (subscriber safety check). Does not write directly — subscribers write their own checkpoints. |
| `hs_schema_version` | LTD-07 (cross-cutting) | Both database files | Migration runner reads and writes version tracking. |

### 4.3 Identity References in Persistence

All identity references in persistence tables use ULID stored as BLOB(16) per LTD-04. Entity references in the telemetry ring store (`entity_ref`) and view checkpoints (`view_name` is a string, not a ULID) follow the identity model established by the Identity and Addressing Model §2.

**Rejected pattern: metadata-ID compression.** Home Assistant's `states_meta` pattern — mapping string entity IDs to integer IDs for storage efficiency — was evaluated and rejected for MVP. The pattern saved HA significant space because their entity IDs were 255-character VARCHAR strings. HomeSynapse stores 16-byte BLOB(16) ULIDs, which are already compact. Integer compression would save approximately 10 bytes per row (replacing a 16-byte BLOB with a 4-byte integer plus a lookup table) at the cost of maintaining a metadata cache, handling cache invalidation on entity lifecycle changes, and managing tombstones for soft-deleted entities. The complexity cost exceeds the space benefit for the expected database sizes (< 2 GB at one year with 50 devices).

**Reversal criteria:** If the domain event store consistently exceeds 5 GB and profiling shows that BLOB(16) comparisons are a measurable bottleneck in index lookups, evaluate metadata-ID compression as a transparent storage optimization. The logical data model (ULID references everywhere) would not change — the compression would be internal to the persistence layer.

---

## 5. Contracts and Invariants

**Every committed event survives process crash.** With `journal_mode = WAL` and `synchronous = NORMAL`, SQLite guarantees that committed transactions are durable across process crashes. Under power loss, the data loss window is limited to the last uncommitted WAL frame — at most one in-flight event. This satisfies INV-ES-04 (write-ahead persistence) and INV-RF-04 (crash safety). The Persistence Layer does not weaken this guarantee under any condition including storage pressure.

**Retention removes, never modifies.** Events deleted by retention are removed via `DELETE` statements. No event is ever updated in place (INV-ES-01). Retention eligibility is determined by `COALESCE(event_time, ingest_time)` per INV-ES-08, which requires retention policies to operate on event time. Per-event-type overrides (defined in `event_model.retention.overrides`) take precedence over priority-tier defaults.

**Retention never deletes events referenced by an active checkpoint.** The minimum `position` across all entries in `view_checkpoints` establishes a floor below which no events are deleted. This guarantees that any materialized view can rebuild from its checkpoint without encountering gaps in the event log. This is a hard constraint, not a best-effort policy.

**View checkpoint and subscriber position are atomically consistent.** The `writeCheckpoint()` implementation wraps both updates in a single SQLite transaction. On crash recovery, either both are updated or neither is. This prevents the "state advanced but checkpoint didn't" inconsistency.

**Telemetry loss does not affect domain correctness.** The telemetry ring store is explicitly outside the scope of INV-ES-01 through INV-ES-05. Loss of telemetry samples (from ring overwrite, file corruption, or file deletion) means losing raw numeric granularity. Aggregated summaries that were promoted to domain events remain in the event log. State derived from domain events is unaffected. Automations that depend on domain events continue to produce correct results on replay.

**The domain event store database is self-contained for correctness.** All data required for system correctness — events, subscriber checkpoints, view checkpoints, schema version tracking — is in a single SQLite file. No cross-file transaction is required for correctness guarantees. The telemetry ring store is an independent optimization; its absence does not degrade domain correctness.

**Backup integrity is verified before acceptance.** Every backup file is validated with `PRAGMA quick_check` after creation. A backup that fails validation is discarded and the failure is reported. The system never counts an unvalidated backup toward its retention limit.

---

## 6. Failure Modes and Recovery

### 6.1 Domain Event Store Corruption

**Trigger:** `PRAGMA quick_check` fails on startup or during scheduled integrity check. Possible causes: power loss during WAL checkpoint (rare on NVMe, common on SD card), storage media failure, kernel bug.

**Impact:** If corruption is in the B-tree structure, reads may return incorrect results or crash. If corruption is in leaf data pages, specific events may contain garbled payloads. If corruption is in index pages, queries may return incomplete results.

**Recovery:** Restore from the most recent validated backup (§3.10). Events between the backup and the corruption are lost. Subscriber checkpoints in the backup are older — all subscribers replay from their backup positions, which may cause duplicate event delivery (safe due to INV-ES-05 idempotency). Emit `system_integrity_failure` (CRITICAL).

**Events produced:** `system_integrity_failure` (CRITICAL) with fields: `file_name`, `check_type` (quick_check or integrity_check), `error_detail`, `recovery_action` (restored_from_backup, started_fresh).

### 6.2 Telemetry Ring Store Corruption or Loss

**Trigger:** Telemetry database file is missing, corrupt, or fails `quick_check`.

**Impact:** High-frequency raw samples are unavailable. Aggregation engine produces no summaries until new data accumulates.

**Recovery:** Automatic. Create a fresh telemetry database. Aggregation cursors reset to zero. New samples begin accumulating immediately. No domain events are lost. No subscriber checkpoints are affected.

**Events produced:** `telemetry_store_rebuilt` (NORMAL) with fields: `reason` (corruption, missing_file), `previous_max_seq` (if known).

### 6.3 Disk Full During Event Append

**Trigger:** SQLite returns `SQLITE_FULL` during an INSERT into the events table.

**Impact:** The current event append fails. The EventPublisher cannot persist the event, which means it cannot be delivered to subscribers (INV-ES-04 — persist before notify).

**Recovery:** The storage pressure management system (§3.5) should prevent this condition through proactive retention. If it occurs despite proactive management, the Persistence Layer immediately executes emergency retention (§3.5, EMERGENCY level): disable telemetry writes, aggressively purge DIAGNOSTIC and then NORMAL events, and retry the failed append. If the append still fails after emergency retention, the system enters a degraded state where only CRITICAL events are accepted. CRITICAL events are never purged — the system does not silently overwrite committed domain events (INV-ES-01). Emit `system_storage_critical` (CRITICAL).

**Events produced:** `system_storage_critical` (CRITICAL, per Event Model §4.3) with fields: `available_bytes`, `events_file_size`, `telemetry_file_size`, `retention_action_taken`, `severity: emergency`.

### 6.4 VACUUM Failure

**Trigger:** Full VACUUM fails due to insufficient disk space (requires 2× database size) or is interrupted by power loss.

**Impact:** If VACUUM fails before completing, the original database is unchanged (VACUUM is atomic — it creates a new file and replaces the original only on success). If power is lost during the file replacement, SQLite's hot journal recovery resolves the state on next open.

**Recovery:** Automatic. The system continues with the original (fragmented) database. The fragmentation condition persists but does not affect correctness. The health indicator reports the fragmentation level and the VACUUM failure.

**Events produced:** `persistence_vacuum_failed` (NORMAL) with fields: `database_file`, `reason` (insufficient_space, interrupted, error), `freelist_ratio`.

### 6.5 Migration Failure

**Trigger:** A schema migration fails mid-execution. Possible causes: SQL syntax error in migration file, constraint violation on data migration, power loss during DDL execution.

**Impact:** The database is in an indeterminate state (SQLite does not support transactional DDL rollback for all operations). The `hs_schema_version` table records the migration as failed.

**Recovery:** Restore from the mandatory pre-migration backup (LTD-07). The migration runner refuses to execute without a backup, so a valid pre-migration state always exists. After restoration, the operator can retry with a corrected migration or roll back to the previous HomeSynapse version.

**Events produced:** None (the system is halted; events cannot be written to a potentially corrupt database). The failure is reported via structured logging and CLI output.

### 6.6 Backup Creation Failure

**Trigger:** The SQLite backup API returns an error during backup, or `quick_check` fails on the backup file, or disk space is insufficient for the backup.

**Impact:** No new backup is created. The most recent valid backup remains the recovery point. If the failure occurs during a pre-upgrade backup, the upgrade is aborted (LTD-14 — migration runner refuses to execute without a backup).

**Recovery:** The system continues operating. The backup failure is logged and surfaced via the health indicator. The next scheduled backup attempt proceeds normally.

**Events produced:** `system_backup_failed` (CRITICAL) with fields: `reason`, `backup_path`, `last_valid_backup_time`.

### 6.7 Retention Thread Stall

**Trigger:** The retention thread is unable to complete its work within the maintenance window due to lock contention, slow I/O, or an unexpectedly large volume of eligible events.

**Impact:** Retention is incomplete. Some events that should have been deleted remain. Storage pressure may increase.

**Recovery:** The retention thread logs its progress and resumes at the next scheduled window, picking up where it left off (it tracks the last-deleted position per priority tier). If the stall is caused by lock contention (the write path is unusually active during the maintenance window), the retention thread backs off and reschedules for 1 hour later.

**Events produced:** `persistence_retention_incomplete` (NORMAL) with fields: `tier`, `deleted_count`, `remaining_count`, `reason` (lock_contention, timeout, large_volume).

### 6.8 Aggregation Engine Falls Behind Ring Buffer

**Trigger:** The ring buffer wraps around before the aggregation engine processes all samples. See §3.7 for detection mechanics.

**Impact:** Some telemetry samples are lost before aggregation. The `telemetry_summary` event for the affected period is partial or missing.

**Recovery:** Automatic. The aggregation engine advances its cursor past the gap, produces a partial summary (or no summary if all samples were overwritten), and logs the gap. The health indicator transitions to DEGRADED with a recommendation to increase `max_rows` or decrease the aggregation interval.

**Events produced:** `telemetry_summary` with `partial: true` in the payload (if any samples remain), plus structured log warning `aggregation.samples_lost`.

---

## 7. Interaction with Other Subsystems

| Subsystem | Direction | Mechanism | Data | Constraints |
|---|---|---|---|---|
| Event Model & Event Bus | Reads/Writes | Direct SQLite access | `events` table, `subscriber_checkpoints` table | Schema owned by Event Model. Persistence executes retention, WAL tuning, VACUUM. Single-writer lock shared with EventPublisher. |
| State Store & State Projection | Implements interface | `CheckpointStore` interface (§8.1) | Opaque checkpoint byte arrays, `view_name`, `position` | Persistence stores and retrieves without interpreting checkpoint content. Same-transaction semantics with subscriber checkpoints. |
| Device Model & Capability System | Provides storage | `CheckpointStore` interface (§8.1) with `viewName = "device_registry"` | Device and entity registry snapshot data | Registry is a materialized view; its snapshot uses the same checkpoint infrastructure as the State Store. |
| Integration Runtime | Receives telemetry | Telemetry write interface (§8.3) | Raw numeric samples: entity_ref, attribute_key, value, timestamp | Numeric values only. Non-numeric data uses the domain event path. |
| Aggregation Engine (internal) | Produces domain events | `EventPublisher.publish()` | `telemetry_summary` events at DIAGNOSTIC priority | The aggregation engine is internal to this subsystem but produces domain events via the standard event publication mechanism. |
| Startup, Lifecycle & Shutdown | Called by | Lifecycle interface (§8.4) | Initialization, shutdown, backup triggers | Persistence initializes before Event Bus and State Store. Persistence shuts down after all subscribers have checkpointed. |
| Configuration System | Reads from | YAML configuration (§9) | Retention periods, maintenance schedule, ring store sizing, backup schedule | Configuration changes require restart for most settings. |
| Observability & Debugging | Exposes | Metrics and health indicators (§11) | Database sizes, freelist counts, WAL size, retention statistics, backup status | All metrics exposed via JFR (LTD-15). |
| REST API | Called by | Query interfaces | Event history queries, telemetry data access | API Layer uses `EventStore` query interface (owned by Event Model) and telemetry query interface (§8.5). |

---

## 8. Key Interfaces

### 8.1 CheckpointStore (implements State Store §8.3)

```java
public interface CheckpointStore {

    /**
     * Writes a checkpoint for the named view. The write is wrapped
     * in the same SQLite transaction as the subscriber checkpoint
     * update, providing atomic rollback on failure.
     *
     * @param viewName   stable identifier (e.g., "entity_state")
     * @param position   the global_position at checkpoint time
     * @param data       opaque serialized checkpoint content
     */
    void writeCheckpoint(String viewName, long position, byte[] data);

    /**
     * Reads the most recent checkpoint for the named view.
     * Returns empty if no checkpoint exists (first boot, post-wipe).
     */
    Optional<CheckpointRecord> readLatestCheckpoint(String viewName);
}
```

### 8.2 Registry Storage via CheckpointStore

The Device Model's entity registry is an in-memory materialized view rebuilt from events (**Device Model & Capability System** §3.1). For faster startup, the registry can persist a snapshot using the same `CheckpointStore` interface (§8.1) with `viewName = "device_registry"`. This eliminates the need for a separate interface or table — the `view_checkpoints` table already supports multiple view names, and a registry snapshot is conceptually identical to a materialized view checkpoint: an opaque byte array keyed by a view name with a position marker. The Device Model writes and reads its snapshot through `CheckpointStore.writeCheckpoint("device_registry", position, data)` and `CheckpointStore.readLatestCheckpoint("device_registry")`, receiving the same same-transaction atomicity guarantees as the State Store's checkpoint.

### 8.3 TelemetryWriter

```java
public interface TelemetryWriter {

    /**
     * Writes a batch of telemetry samples to the ring store.
     * Samples are assigned monotonic sequence numbers internally.
     * Non-numeric values are rejected with IllegalArgumentException.
     *
     * @param samples batch of samples to write (max 100 per call)
     */
    void writeSamples(List<TelemetrySample> samples);
}

public record TelemetrySample(
    EntityRef entityRef,
    String attributeKey,
    double value,
    Instant timestamp
) {}
```

### 8.4 PersistenceLifecycle

```java
public interface PersistenceLifecycle {

    /**
     * Initializes all database files, sets PRAGMAs, runs pending
     * migrations, and starts maintenance threads. Called during
     * startup before the Event Bus and State Store initialize.
     *
     * @return a future that completes when all databases are ready
     */
    CompletableFuture<Void> start();

    /**
     * Runs a final WAL checkpoint, stops maintenance threads,
     * and closes all database connections. Called during graceful
     * shutdown after all subscribers have written their final
     * checkpoints.
     */
    void stop();

    /**
     * Creates a backup of all database files and configuration.
     * Used by the upgrade workflow (LTD-14) and scheduled backups.
     *
     * @return metadata about the created backup
     */
    BackupResult createBackup(BackupOptions options);

    /**
     * Restores from a validated backup. Requires the system to be
     * stopped (enforced by the caller).
     */
    void restoreFromBackup(Path backupDirectory);
}

public record BackupResult(
    Path backupDirectory,
    Instant createdAt,
    long eventsGlobalPosition,
    boolean telemetryIncluded,
    boolean integrityVerified
) {}

public record BackupOptions(
    boolean includeTelemetry,
    boolean preUpgrade           // If true, abort on any failure
) {}
```

### 8.5 TelemetryQueryService

```java
public interface TelemetryQueryService {

    /**
     * Queries raw telemetry samples for an entity within a time range.
     * Returns only samples currently in the ring buffer — older data
     * is available only as aggregated telemetry_summary events in the
     * domain event store.
     */
    List<TelemetrySample> querySamples(
        EntityRef entityRef,
        String attributeKey,
        Instant from,
        Instant to,
        int maxResults
    );

    /**
     * Returns the current ring buffer statistics for monitoring.
     */
    RingBufferStats getRingStats();
}

public record RingBufferStats(
    int maxRows,
    long currentSeq,
    long oldestSeqInRing,
    int distinctEntities,
    Instant oldestTimestamp,
    Instant newestTimestamp
) {}
```

### 8.6 MaintenanceService

```java
public interface MaintenanceService {

    /**
     * Triggers a retention pass immediately. Used by the storage
     * pressure management system and for testing.
     */
    RetentionResult runRetention();

    /**
     * Triggers a full VACUUM on the domain event store. Verifies
     * disk space before proceeding. Returns failure if space is
     * insufficient.
     */
    VacuumResult runVacuum();

    /**
     * Returns the current storage health status including per-file
     * sizes, freelist counts, pressure level, and next scheduled
     * maintenance time.
     */
    StorageHealth getStorageHealth();
}
```

---

## 9. Configuration

All Persistence Layer configuration lives under the `persistence:` key in the HomeSynapse YAML configuration file (`/etc/homesynapse/homesynapse.yaml`).

```yaml
persistence:

  # --- Retention execution ---
  # Retention period values (diagnostic_days, normal_days, critical_days) and
  # per-event-type overrides are read from event_model.retention (Event Model §9).
  # This section configures only the execution mechanics.
  retention:
    schedule_time: "04:12"      # Local time, HH:MM. Default: "04:12"
    batch_size: 1000            # Rows per delete transaction. Range: 100-10000. Default: 1000
    yield_ms: 50                # Milliseconds to yield between batches. Range: 10-1000. Default: 50
    subscriber_grace_period_hours: 24  # Range: 1-168. Default: 24

  # --- Telemetry ring store ---
  telemetry:
    max_rows: 100000            # Ring buffer capacity. Range: 10000-10000000. Default: 100000
    write_batch_size: 100       # Samples per transaction. Range: 1-1000. Default: 100

  # --- Aggregation engine ---
  aggregation:
    interval_minutes: 5         # Range: 1-60. Default: 5
    enabled: true               # Default: true

  # --- Backup ---
  backup:
    schedule_time: "03:00"      # Local time, HH:MM. Default: "03:00"
    schedule_enabled: true      # Default: true
    include_telemetry: true     # Include telemetry DB in routine backups. Default: true
    retention_count: 3          # Backup generations to keep. Range: 1-10. Default: 3

  # --- Storage pressure ---
  # The emergency_threshold_mb is read from event_model.retention.emergency_threshold_mb
  # (Event Model §9, default: 500 MB). This section configures the warning-level budget.
  storage:
    budget_bytes: 0             # 0 = auto (80% of partition). Explicit value overrides auto.
    warning_percent: 80         # Percentage of budget that triggers WARNING. Default: 80

  # --- Maintenance ---
  maintenance:
    wal_truncate_schedule: "weekly"   # "daily", "weekly", "monthly". Default: "weekly"
    quick_check_schedule: "daily"     # "daily", "weekly", "monthly", "never". Default: "daily"
    integrity_check_schedule: "monthly"  # "weekly", "monthly", "quarterly", "never". Default: "monthly"
    analyze_schedule: "weekly"        # "daily", "weekly", "monthly", "never". Default: "weekly"
    vacuum_auto_enabled: false        # Auto quarterly VACUUM. Default: false (opt-in)
    vacuum_fragmentation_threshold: 0.25  # Trigger recommendation at this ratio. Default: 0.25
```

All settings take effect at startup. Changes require a restart. Future versions may support runtime reconfiguration for retention periods and maintenance schedules; this is deferred for MVP.

---

## 10. Performance Targets

All targets are specified for the primary deployment target: Raspberry Pi 5, 4 GB RAM, NVMe SSD storage, running the JVM configuration in LTD-01.

| Metric | Target | Context | Justification |
|---|---|---|---|
| Checkpoint write latency (p99) | < 500 ms | 150 entities, ~75 KB checkpoint | Well within the 2-second budget from State Store §3.3. Includes SQLite transaction commit. |
| Telemetry write throughput | > 1,000 samples/sec sustained | Batched transactions (100 samples/tx) | Supports 8 energy circuits at 1 Hz with 10× headroom. |
| Retention pass duration | < 10 minutes | 100,000 eligible events, batch size 1,000 | Must complete within the maintenance window. With 50 ms yield per batch: 100 batches × (delete time + 50 ms) ≈ 100 × 60 ms = 6 seconds for deletes, plus incremental vacuum. |
| Incremental vacuum throughput | > 5,000 pages/sec | 500-page batches | At 4 KB/page, this is 20 MB/s — well within NVMe capability. |
| Backup duration (2 GB event store) | < 10 seconds | SQLite backup API, single-step, NVMe | Research benchmark: 1–4 seconds for 2 GB on NVMe. Allow 10 seconds for safety margin. |
| `quick_check` duration (2 GB) | < 5 minutes | Cold cache, NVMe | Research benchmark: 1–5 minutes per GB on SSD. Daily check must not overlap with retention window. |
| Aggregation cycle duration | < 30 seconds | 50 entities, 5-minute window, 100K samples total | Query + compute + event publish for each entity. |
| Storage monitor check | < 100 ms | `df` equivalent + per-file stat | Must not introduce observable latency. |
| Domain event store size (1 year, 50 devices) | < 2 GB | Default retention: DIAG 7d, NORMAL 90d, CRITICAL 365d | Per Event Model §10. Retention keeps the steady-state size bounded. |

---

## 11. Observability

### 11.1 Metrics

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `hs_persistence_events_file_bytes` | Gauge | — | Size of `homesynapse-events.db` in bytes. |
| `hs_persistence_events_wal_bytes` | Gauge | — | Size of the events database WAL file. |
| `hs_persistence_events_freelist_pages` | Gauge | — | Number of free pages in the events database. Indicates space reclaimable by incremental vacuum. |
| `hs_persistence_events_page_count` | Gauge | — | Total page count in the events database. Ratio with freelist indicates fragmentation. |
| `hs_persistence_telemetry_file_bytes` | Gauge | — | Size of `homesynapse-telemetry.db` in bytes. |
| `hs_persistence_telemetry_current_seq` | Gauge | — | Current monotonic sequence counter for the telemetry ring store. |
| `hs_persistence_telemetry_distinct_entities` | Gauge | — | Number of distinct entities with samples in the ring buffer. |
| `hs_persistence_storage_budget_bytes` | Gauge | — | Configured storage budget. |
| `hs_persistence_storage_used_bytes` | Gauge | — | Total bytes used across all database files and backups. |
| `hs_persistence_storage_pressure_level` | Gauge | — | Current pressure level: 0 (normal), 1 (warning), 2 (critical), 3 (emergency). |
| `hs_persistence_retention_events_deleted` | Counter | `priority` | Total events deleted by retention, labeled by priority tier. |
| `hs_persistence_retention_duration_ms` | Histogram | — | Duration of each retention pass. |
| `hs_persistence_vacuum_incremental_pages` | Counter | — | Total pages reclaimed by incremental vacuum. |
| `hs_persistence_backup_duration_ms` | Histogram | — | Duration of each backup creation. |
| `hs_persistence_backup_last_success` | Gauge | — | Unix timestamp of the most recent successful backup. |
| `hs_persistence_checkpoint_write_ms` | Histogram | `view_name` | Duration of each checkpoint write, labeled by view name. |
| `hs_persistence_aggregation_duration_ms` | Histogram | — | Duration of each aggregation cycle. |
| `hs_persistence_aggregation_samples_lost` | Counter | — | Total samples lost due to ring buffer overwrite before aggregation. |
| `hs_persistence_quick_check_duration_ms` | Gauge | — | Duration of the most recent `quick_check`. |

### 11.2 Structured Logging

| Log Event | Level | Key Fields | Description |
|---|---|---|---|
| `persistence.started` | INFO | `events_db_size`, `telemetry_db_size`, `storage_type`, `schema_version_events`, `schema_version_telemetry` | Emitted after all databases are initialized and ready. |
| `persistence.retention_completed` | INFO | `diagnostic_deleted`, `normal_deleted`, `critical_deleted`, `duration_ms`, `freelist_pages_reclaimed` | Emitted after each retention pass. |
| `persistence.retention_incomplete` | WARN | `tier`, `deleted_count`, `remaining_count`, `reason` | Retention could not complete within its window. |
| `persistence.vacuum_completed` | INFO | `database_file`, `duration_ms`, `size_before`, `size_after` | Emitted after successful VACUUM. |
| `persistence.vacuum_failed` | ERROR | `database_file`, `reason`, `freelist_ratio` | VACUUM failed or was skipped. |
| `persistence.backup_completed` | INFO | `backup_path`, `duration_ms`, `events_position`, `integrity_check` | Emitted after successful backup. |
| `persistence.backup_failed` | ERROR | `reason`, `backup_path` | Backup creation or validation failed. |
| `persistence.storage_pressure` | WARN/ERROR | `level`, `used_bytes`, `budget_bytes`, `action_taken` | Storage pressure threshold breached. |
| `persistence.integrity_check` | INFO/ERROR | `check_type`, `database_file`, `result`, `duration_ms` | Result of `quick_check` or `integrity_check`. |
| `persistence.unclean_shutdown_detected` | WARN | `marker_file`, `running_since` | Previous shutdown was unclean; triggering `quick_check`. |
| `persistence.migration_applied` | INFO | `database_file`, `version`, `description`, `duration_ms` | Schema migration completed successfully. |
| `persistence.migration_failed` | ERROR | `database_file`, `version`, `description`, `error` | Schema migration failed. |
| `aggregation.cycle_completed` | DEBUG | `entities_processed`, `summaries_produced`, `duration_ms` | Each aggregation cycle. |
| `aggregation.samples_lost` | WARN | `entity_ref`, `attribute_key`, `gap_size`, `last_processed_seq`, `oldest_available_seq` | Ring buffer wrapped before aggregation. |
| `telemetry.store_rebuilt` | WARN | `reason`, `previous_max_seq` | Telemetry database was recreated. |

### 11.3 Health Indicator

The Persistence Layer reports a composite health status derived from its component health signals:

| Component | HEALTHY | DEGRADED | UNHEALTHY |
|---|---|---|---|
| Domain event store | `quick_check` passed, WAL < 50 MB, no failed migrations | Fragmentation > 25%, WAL > 50 MB, retention incomplete | `quick_check` failed, database corrupt, migration failed |
| Telemetry ring store | File exists, writes succeeding | Aggregation falling behind (samples lost) | File missing or corrupt (auto-recreated, so UNHEALTHY is transient) |
| Storage pressure | Below WARNING threshold | At WARNING or CRITICAL threshold | At EMERGENCY threshold |
| Backup status | Last backup < 25 hours old and validated | Last backup > 25 hours old or last attempt failed | No valid backup exists |

The composite status is the worst of the component statuses. The health endpoint returns JSON with per-component detail and the composite status. This subsystem implements the `HealthContributor` interface (Doc 11 §8.1, §8.2) to report the composite health state to the HealthAggregator. The Persistence Layer is classified as CRITICAL_INFRASTRUCTURE tier (Doc 11 §7.1) with a 15-second startup grace period. Health state changes are reported via `HealthContributor.reportHealth(status, reason)` when any component transitions, recomputing the composite before reporting.

---

## 12. Security Considerations

The Persistence Layer handles the most sensitive data in the system: the complete event log containing all device state changes, user actions, presence data, and automation history.

**File permissions.** Database files in `/var/lib/homesynapse/` are owned by the `homesynapse` service user with permissions `0600` (owner read/write only). The systemd service runs as this dedicated user with `ProtectSystem=strict` and explicit `ReadWritePaths` for the data directory (LTD-13). No other user or process on the system can read the database files.

**Backup file permissions.** Backup files inherit the same `0600` permissions. Backup directories are `0700`. Backup encryption is deferred to post-MVP — the current design relies on filesystem permissions and the assumption that physical access to the Pi implies full access (a reasonable assumption for a device inside the user's home). When encryption is added, it will use the key management infrastructure established by INV-PD-03 and INV-PD-07 (crypto-shredding).

**SQLite injection.** All queries use parameterized statements. No SQL string concatenation is used anywhere in the Persistence Layer. The migration runner executes SQL from versioned files with SHA-256 checksum verification (LTD-07) — migration files are part of the application distribution, not user input.

**Telemetry data sensitivity.** High-frequency energy monitoring data can reveal occupancy patterns, appliance usage, and daily routines. The telemetry ring store's bounded retention (hours, not months) limits the exposure window. Aggregated summaries in the domain event store are lower-resolution and subject to standard retention policies. When INV-PD-07 (crypto-shredding) is implemented, energy telemetry falls under the behavioral data encryption scope.

---

## 13. Testing Strategy

### 13.1 Unit Tests

- **Ring buffer slot computation.** Verify `slot = seq % max_rows` produces correct slots across wrap boundaries. Verify that `INSERT OR REPLACE` overwrites the correct row. Verify that the `seq` column is monotonically increasing.
- **Retention batch boundary calculation.** Given a set of events with known priorities and timestamps, verify the retention engine identifies the correct deletion ranges. Verify the subscriber checkpoint safety check correctly identifies events that must be skipped.
- **Storage pressure threshold transitions.** Feed the storage monitor with synthetic disk usage values. Verify it transitions through WARNING → CRITICAL → EMERGENCY at the configured thresholds and fires the correct events.
- **Aggregation engine aggregates.** Given a known set of telemetry samples, verify min/max/mean/sum/count are computed correctly. Verify the time range in the produced `telemetry_summary` event matches the input samples.
- **Aggregation gap detection.** Set a cursor at `seq = 100`. Insert samples with `seq` starting at `200`. Verify the engine detects the gap, logs a warning, produces a partial summary, and advances the cursor.
- **Checkpoint store round-trip.** Write a checkpoint with arbitrary byte data and a position. Read it back. Verify all fields match. Overwrite with new data at a higher position. Read again. Verify the new data is returned.
- **Backup metadata generation.** Create a backup and verify `snapshot.json` contains the correct `events_global_position`, schema versions, and file sizes.

### 13.2 Integration Tests

- **End-to-end retention cycle.** Populate the event store with 10,000 events across all three priority tiers with varied timestamps. Run a retention pass. Verify: DIAGNOSTIC events older than 7 days are deleted, NORMAL and CRITICAL events are retained, incremental vacuum reclaimed freelist pages, the subscriber checkpoint safety check prevented deletion of events referenced by an active subscriber.
- **Checkpoint atomicity on crash.** Write events, then initiate a checkpoint write. Kill the process (SIGKILL) during the checkpoint transaction. Restart. Verify: the view checkpoint is either at its pre-crash position or fully updated — never partially updated. Verify the subscriber checkpoint is consistent with the view checkpoint.
- **Telemetry ring buffer wrap-around.** Configure a ring with `max_rows = 100`. Write 250 samples. Verify: the ring contains only the most recent 100 samples. Query by entity and time range. Verify correct results. Run the aggregation engine. Verify it produces summaries covering only the available samples and logs the gap for overwritten samples.
- **Backup and restore round-trip.** Populate the event store with 5,000 events, several checkpoints, and a populated telemetry ring. Create a backup. Append 100 more events. Restore from the backup. Verify: the event store is at the backup's position (the 100 extra events are gone), subscriber checkpoints are at the backup's values, the telemetry ring is restored, and the system starts normally with views replaying from the restored checkpoints.
- **Storage pressure emergency retention.** Populate the event store until the storage pressure reaches CRITICAL. Verify: emergency retention fires automatically, DIAGNOSTIC events are purged below normal retention limits, telemetry writes are disabled, `system_storage_critical` event is produced.
- **Multi-file migration.** Create databases at schema version N. Deploy migrations for version N+1 for both databases. Verify: the migration runner executes both migration tracks, updates both `hs_schema_version` tables, and the system starts normally. Repeat with a failing telemetry migration: verify the system halts with a clear error, and the pre-migration backup allows recovery.
- **SD card detection.** Mock the `/sys/block/` filesystem to simulate an SD card device. Verify: mmap is disabled, `system_storage_critical` is emitted with `reason: degraded_storage_media`, and all other functionality operates normally.

### 13.3 Performance Tests

- **Checkpoint write latency.** Write checkpoints of 75 KB (150 entities) in a loop on Raspberry Pi 5. Verify p99 latency < 500 ms.
- **Telemetry write throughput.** Sustain 1,000 samples/sec for 60 seconds on Raspberry Pi 5. Verify no write failures and WAL size remains bounded.
- **Retention under write load.** Run retention (deleting 50,000 events) while sustaining 100 events/sec append rate. Verify append p99 latency remains < 20 ms (2× the normal 10 ms target to account for lock contention during retention).
- **Backup duration.** Back up a 2 GB event store database on Raspberry Pi 5 with NVMe. Verify completion in < 10 seconds.
- **Aggregation cycle duration.** Run aggregation across 50 entities with 100,000 total samples on Raspberry Pi 5. Verify completion in < 30 seconds.
- **Full VACUUM duration.** VACUUM a 2 GB database on Raspberry Pi 5 with NVMe. Record duration. Verify < 5 minutes. This establishes the baseline for the quarterly maintenance window.

### 13.4 Failure Tests

- **Kill -9 during event append.** Kill the process at random points during event writes. Restart. Verify: all committed events are intact, the WAL recovers automatically, subscribers replay from their checkpoints, no data corruption detected by `quick_check`.
- **Kill -9 during retention.** Kill during a retention batch delete. Restart. Verify: the database is consistent (SQLite transaction rollback handled the partial batch), retention resumes from the correct position on the next scheduled run.
- **Kill -9 during VACUUM.** Kill during a full VACUUM. Verify: the original database is intact (VACUUM is atomic — the replacement file is incomplete and discarded by SQLite recovery).
- **Kill -9 during backup.** Kill during a backup API call. Verify: the partial backup file is incomplete and would fail `quick_check`. The system's backup retention logic should discard it on the next successful backup.
- **Corrupt event store.** Inject a byte-level corruption into the database file (flip bits in a data page). Run `quick_check`. Verify: corruption is detected. Verify the system restores from backup and emits the appropriate events.
- **Remove telemetry database.** Delete `homesynapse-telemetry.db` while the system is running. Verify: on next telemetry write attempt, the system detects the missing file, recreates it, and resumes operation. Domain event processing is unaffected.

---

## 14. Future Considerations

**Litestream-style continuous WAL shipping.** The current backup strategy creates periodic snapshots. A future enhancement could implement continuous WAL page replication to a secondary storage location (USB drive, NAS, cloud bucket), providing near-real-time disaster recovery with sub-second data loss windows. The architecture supports this: the WAL file is the replication source, and the Persistence Layer already manages WAL checkpoint timing. Adding WAL page shipping requires intercepting checkpoint operations and copying WAL frames before they are checkpointed into the main database. This does not require architectural changes — it is an additive feature on top of the existing WAL management infrastructure.

**Checksum VFS for per-page integrity.** SQLite's Checksum VFS extension (`cksumvfs`) adds 8-byte checksums to every database page, detecting silent bit-flips on read. Enabling this requires `reserve_bytes = 8` set at database creation time — it cannot be retrofitted onto existing databases without a migration (VACUUM INTO a new file with the VFS enabled). The known gap (checksums are not verified during WAL checkpointing) is a concern but not a blocker. If adopted, it must be a day-one decision for new installations. Existing installations could migrate via the backup-restore path (create backup without checksums, restore into a new database with checksums enabled). This is deferred for MVP because the `quick_check`/`integrity_check` scheduling combined with validated backups provides an adequate integrity story for consumer deployments.

**sqlite3_rsync for incremental backup.** SQLite 3.47.0 introduced `sqlite3_rsync`, which transfers only changed pages between databases using cryptographic hash comparison. Protocol v2 (SQLite 3.50.0) adds hierarchical hashing for further efficiency. This could replace the full-copy backup for routine backups, reducing backup time from seconds to milliseconds for large databases with small daily changes. The tool is too new (shipped 2024) for a five-year commitment, but the backup interface is designed to accommodate it as a drop-in replacement for the backup API call.

**Multi-tier aggregation pipeline.** The MVP aggregation engine produces 5-minute summaries. Future versions could implement a full resolution hierarchy: 5-minute → 1-hour → 1-day, each tier computed from the previous. InfluxDB's continuous query model maps directly to this pattern. The `aggregation_cursors` table already supports per-entity tracking; extending it with per-tier cursors is a schema addition, not a redesign. Estimated storage for 1,000 sensors with the full hierarchy: < 1 GB for 10 years of aggregated data.

**Encrypted backups.** When INV-PD-03 (encrypted storage) is implemented, backup files should be encrypted with a user-owned key. The backup creation process would add an encryption step after `quick_check` validation and before writing to the backup directory. Restore would require the decryption key. Key management follows the infrastructure established for INV-PD-07 (crypto-shredding).

**PostgreSQL backend for Enhanced tier.** LTD-03 specifies the `EventStore` interface abstraction allows H2 or PostgreSQL for advanced users. The Persistence Layer's design — separate concerns for storage operations, retention execution, backup management, and telemetry — maps cleanly to a PostgreSQL backend where retention becomes `DELETE` with `RETURNING`, VACUUM is managed by PostgreSQL's autovacuum, and backup uses `pg_dump` or WAL archiving. The telemetry ring store pattern translates to a PostgreSQL table with `ON CONFLICT DO UPDATE` or a TimescaleDB hypertable. This is beyond MVP scope but the interface boundaries are designed to accommodate it.

---

## 15. Open Questions

1. **Should the Checksum VFS be a day-one decision for MVP?**
   Options: (a) Enable `cksumvfs` with `reserve_bytes = 8` from the initial database creation, accepting the 8-byte-per-page storage overhead (~0.2%) and the known gap during checkpointing. (b) Defer to post-MVP and rely on `quick_check`/`integrity_check` scheduling plus validated backups for integrity assurance, with the understanding that retrofitting checksums requires a database migration.
   Needed: Empirical assessment of SIGBUS frequency on NVMe under sustained multi-year operation. Community data on silent bit-flip rates for consumer NVMe drives. Compatibility testing of `cksumvfs` with the `org.xerial:sqlite-jdbc` JDBC driver.
   Status: **[NON-BLOCKING]** — the integrity story is adequate without checksums. The decision affects storage efficiency and detection latency for a class of failures (silent bit-flips) that are rare on NVMe.
   **Recommended resolution:** Defer to post-MVP (option b). The combination of `PRAGMA quick_check` / `integrity_check` scheduling, validated backups, and NVMe storage (which has substantially lower corruption risk than SD cards) provides adequate integrity assurance for MVP consumer deployments. Retrofitting checksums later requires a database migration via the backup-restore path, which is a supported operation. The 0.2% storage overhead of `cksumvfs` is negligible, but the known gap during WAL checkpointing (pages written by the checkpointer do not receive checksums until the next write to that page) means the protection is not complete, reducing the value proposition for day-one adoption. This remains a candidate for post-MVP hardening once the backup infrastructure is proven in production.

2. **Should `ANALYZE` run automatically or only on explicit trigger?**
   Options: (a) Run `ANALYZE` weekly on a schedule, updating SQLite's query planner statistics to ensure optimal index usage as the data distribution changes over time. (b) Run `ANALYZE` only when query latency metrics indicate degradation, reducing unnecessary I/O on constrained hardware.
   Needed: Measurement of `ANALYZE` duration on a representative 2 GB database with the event store schema. Assessment of whether SQLite's query planner makes materially different choices as the events table grows.
   Status: **[NON-BLOCKING]** — the default is weekly per §9 configuration. The schedule can be adjusted based on empirical evidence without changing the design.

3. **Should the Persistence Layer expose a query interface for historical state reconstruction?**
   The State Store §3 notes that historical state queries scan `state_changed` events using existing indexes. The REST API will need an endpoint for "entity state at time T." Options: (a) The Persistence Layer provides an optimized query method that combines index scans with checkpoint data for efficient point-in-time reconstruction. (b) The API Layer performs this query directly against the `EventStore` read interface, with the Persistence Layer providing no special support.
   Needed: Performance profiling of historical state queries on a 1-year event log. Assessment of whether the existing indexes (`idx_events_subject`, `idx_events_ingest_time`) are sufficient or whether a purpose-built index is needed.
   Status: **[NON-BLOCKING]** — the existing indexes support the query pattern. Optimization can be added transparently behind the existing interface if profiling shows it is needed.

---

## 16. Summary of Key Decisions

| Decision | Choice | Rationale | Section |
|---|---|---|---|
| Database file topology | Domain events + subscriber checkpoints + view checkpoints in one SQLite file; telemetry in a separate file | Same-database checkpointing enables atomic rollback of projection + checkpoint updates. Separate telemetry file isolates write pressure and allows independent maintenance schedules. | §3.1 |
| Durability contract | Full write-ahead for domain events; best-effort for telemetry with explicit loss semantics | Domain events satisfy INV-ES-04 via SQLite WAL + synchronous=NORMAL. Telemetry loss means losing raw granularity, not facts. Each store's contract is explicit. | §3.2 |
| Space reclamation | Incremental vacuum (routine) + full VACUUM (quarterly, opt-in) | Incremental vacuum is low-impact and runs after every retention pass. Full VACUUM requires 2× disk space and creates a bounded blocking window — unsuitable as routine maintenance on constrained hardware. HA's VACUUM-as-routine-maintenance is the specific failure mode avoided. | §3.3 |
| Retention timestamp | `COALESCE(event_time, ingest_time)` per INV-ES-08 | INV-ES-08 requires retention to operate on event time to prevent delayed events from being retained longer than intended. COALESCE handles nullable event_time defensively. Requires `idx_events_event_time` index. | §3.4 |
| Retention mechanics | Per-type overrides first, then per-tier batch deletes on a dedicated virtual thread with yield intervals and subscriber checkpoint safety checks | Per-type overrides (from `event_model.retention.overrides`) take precedence. Separate thread prevents retention from blocking event recording (HA's critical failure). Subscriber safety check with grace-period escape hatch balances bounded storage against at-least-once delivery. | §3.4 |
| Storage pressure | MB-based emergency threshold (from Event Model §9) with percentage-based warning | Consistent with Event Model §6.5. CRITICAL events are never automatically purged — the system enters degraded state rather than overwriting committed events (INV-ES-01). Aligned with Doc 01 §6.5. CRITICAL events are never automatically purged — the system enters degraded state rather than overwriting committed events (INV-ES-01). | §3.5 |
| Telemetry ring store | Modular-rowid ring buffer (INSERT OR REPLACE with slot = seq % max_rows), single table with composite indexes including (entity_ref, seq) | Zero DELETE operations, fixed file size, stable B-tree. The (entity_ref, seq) index supports the aggregation engine's dominant query pattern. Per-entity tables rejected due to SQLite schema parsing overhead above ~500 tables. | §3.6 |
| Aggregation engine | Batch aggregation on timer (5-minute default), not trigger-based | Trigger-based adds 20–50% overhead per insert at high write rates. Batch concentrates I/O in scheduled windows. High-water mark per entity detects ring overwrite gaps. | §3.7 |
| Domain vs. telemetry routing | Semantic decision table extending the rate-based threshold | Rate alone is insufficient. "If this data point were lost, would automation replay produce a different result?" is the deciding question. Discrete state transitions always use domain path regardless of rate. | §3.8 |
| Storage detection | Detect media type at startup; disable mmap on SD card | mmap converts I/O errors to SIGBUS on failing sectors. NVMe sector failures are rare; SD card failures are common. Conditional mmap prevents unrecoverable crashes on degraded storage. | §3.9 |
| Startup integrity | Unclean-shutdown-triggered `quick_check`, not unconditional on every boot | Unconditional quick_check at 1–5 min/GB conflicts with the 30-second startup target. WAL recovery is automatic; unclean shutdown detection via marker file triggers quick_check only when crash risk is real. Scheduled daily quick_check provides ongoing coverage. | §3.9 |
| Backup strategy | SQLite backup API with single-step copy, post-backup validation, 3-generation retention | Single-step avoids restart-on-modification. Post-backup `quick_check` catches corrupt backups. Correctness is atomic within the domain event store; telemetry backup is best-effort and sequenced, not simultaneously captured. | §3.10 |
| Schema compatibility | Indexes independent of payload content; checkpoint versioning via consuming subsystem; multi-file migration tracks | Payload-independent indexes prevent HA-style migration pain. Checkpoint version mismatch triggers rebuild from events (the ES safety net), not migration. | §3.11 |
| View checkpoint storage | `view_checkpoints` table in the domain event store database, shared by State Store and Device Registry | Same-database transaction with subscriber checkpoint update provides strongest correctness guarantee. Multi-view support via `view_name` key. Device registry uses `view_name = "device_registry"` — no separate interface needed. | §3.12 |
| Metadata-ID compression | Rejected for MVP | 16-byte BLOB(16) ULIDs are already compact. Integer compression saves ~10 bytes/row but adds cache management complexity. Reversal criteria: event store consistently exceeds 5 GB. | §4.3 |
| Maintenance operations | Scheduled tasks (ANALYZE, REINDEX), not schema migrations | Maintenance operations are idempotent and periodic. The migration runner (LTD-07) is for forward-only schema changes. Conflating them would prevent re-running maintenance when needed. | §3.3 |

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It is governed by the Design Document Template and will be reviewed during architecture review.*