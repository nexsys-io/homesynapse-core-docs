# AMD-34: Home Identity Schema Reservation on Events Table

**Amendment ID:** AMD-34
**Tier:** CONTRACT-LEVEL (M2-bridge — pre-M3 structural hardening)
**Status:** APPLIED
**Date applied:** 2026-05-02
**Target document:** Doc 04 (Persistence Layer)
**Target sections:** §4 (Data Model — events table schema)
**Source:** Retrofit Research deep analysis, Independent Validation Report (2026-05-02), Portability Architecture §6.5–6.6, Cloud Scalability Analysis Part 5

## Problem

The V001 events table has no `home_id` column. The `HomeId` typed wrapper already exists in `platform/platform-api/src/main/java/com/homesynapse/platform/identity/HomeId.java` as a `record HomeId(Ulid value)` per LTD-04. However, the event schema has no mechanism to associate events with the home (site, dwelling) that produced them.

The Portability Architecture §6.6 anticipates NexSys Enterprise multi-site deployments where a server aggregates events from multiple homes. The Cloud Scalability Analysis Part 5 identifies `home_id` as a "Prepare Now" decision. Concrete future scenarios requiring per-home event partitioning include: user moves house (new HomeId, same hub hardware), vacation home addition, GDPR per-home data erasure (Art. 17 scoped to a single dwelling), and INV-LF-05 convergent sync where replicated event logs from multiple homes must be distinguishable.

Adding `home_id` to a populated multi-GB event log later requires a full-table `ALTER TABLE` rewrite — the exact operation that repeatedly destroyed Home Assistant user databases in 2024–2025 (recorder issues #115765, #123348, #124186, #125339). Axon Framework's published guidance (multi-tenancy extension, added only in 4.6) explicitly rules out retrofitting row-level tenancy after events exist in the log.

## Resolution of Language Evaluation §8.5 Conflict

The Language Evaluation research §8.5 states: *"The event model stays single-home. Events do not carry `home_id`. Each hub produces and stores its own events. Multi-home correlation happens in the cloud service and client apps, not in the hub core."*

This amendment resolves the apparent conflict by distinguishing between the event **model** (Java API) and the event **schema** (SQLite storage):

- The event model (`EventEnvelope`, `EventDraft`) remains single-home per §8.5. No Java-layer type carries `homeId`. Subscribers, the Event Bus, and the State Store are unaware of the column. The local-authority model (INV-LF-01) is preserved — the hub does not store events from other homes and does not route events by home identity.

- The event schema (SQLite `events` table) carries `home_id` as a storage-plane column, populated at INSERT time from hub configuration. This is an internal persistence concern invisible to the Java event API. The column exists so that future multi-home or cloud-sync features can activate it without a catastrophic schema migration.

When multi-home support is implemented in a future milestone, `homeId` will be promoted to `EventEnvelope` as a non-null `HomeId` field. This future expansion is authorized by this amendment and does not require further governance action — only the implementing milestone needs to be specified.

## Schema Change

Amend V001 in-place (same pattern as the M2.5 `subject_type` addition — V001 has not shipped to any production database; all existing databases are empty test instances):

**Add column to the `events` table:**

```sql
home_id           BLOB(16) NOT NULL,
```

Position: after `event_id`, before `event_type`. This groups identity-tier columns (`global_position`, `event_id`, `home_id`) at the top of the table definition.

**Population:** `SqliteEventStore` receives an injected `HomeId` (from hub configuration) at construction time. Every INSERT binds `home_id` from `homeId.value().toBytes()`. First-boot generates a `HomeId` via `UlidFactory.generate()` and persists it in the configuration store. Every event written by the hub thereafter carries the same `home_id` value.

## What Is NOT Changed

- **UNIQUE constraint remains `UNIQUE(subject_ref, subject_sequence)`.** In single-home mode, every event has the same `home_id`, making a composite `UNIQUE(home_id, subject_ref, subject_sequence)` constraint redundant. The composite UNIQUE is deferred to the milestone that implements multi-home.

- **No new standalone index on `home_id`.** An `idx_events_home_position ON events(home_id, global_position)` index would be useful for multi-home queries but has no benefit in single-home mode. Deferred.

- **EventEnvelope stays at 14 fields.** No `homeId` field is added. The Java event model is unchanged.

- **EventDraft is unchanged.** `home_id` is not caller-supplied metadata; it is infrastructure-injected by the persistence layer.

**One index does reference `home_id`:** The partial unique index for idempotency dedup introduced by AMD-35:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_idempotency
    ON events(home_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
```

This is the only index that references `home_id` at launch. Its purpose is per-home idempotency scoping for future multi-home remote management.

## Future Expansion Authorization

When multi-home or cloud sync is implemented in a future milestone, the following changes are authorized by this amendment without requiring further governance action:

1. Add `homeId` (non-null `HomeId`) to `EventEnvelope` and `EventDraft`
2. Change UNIQUE constraint to `UNIQUE(home_id, subject_ref, subject_sequence)`
3. Add `idx_events_home_position ON events(home_id, global_position)` index
4. These changes require only the implementing milestone to be specified — the governance authorization is established here

## Invariant Alignment

- **INV-LF-01 (Core functionality without internet):** Preserved. The hub generates its own `HomeId` locally. No external service is needed.
- **INV-LF-05 (Convergent sync):** Supported. Per-home `home_id` enables future event log partitioning by home during cross-instance sync without schema migration.
- **INV-ES-01 (Immutability):** No existing events are modified. The column is added to an empty table.
- **INV-PD-07 (Crypto-shredding):** `home_id` enables future per-home data erasure scope without requiring payload inspection.
- **LTD-04 (ULID identity):** `HomeId` wraps `Ulid`, stored as `BLOB(16)` — consistent with all other identity columns.

## Downstream Dependencies

- **SqliteEventStore:** Must accept `HomeId` as a constructor parameter and bind it in the INSERT statement. The `fromRow` SELECT does not need to read `home_id` until EventEnvelope is expanded.
- **Configuration module:** Must generate and persist a `HomeId` on first boot. The configuration loading path must surface it for injection into the persistence layer.
- **AMD-35 (Persistent Idempotency Key):** References `home_id` in its partial unique index.
