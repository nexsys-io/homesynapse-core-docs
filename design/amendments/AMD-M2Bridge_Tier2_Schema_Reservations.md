# M2-Bridge Tier 2 Schema Reservations

**Document type:** INFORMATIONAL (not a contract-level amendment)
**Date:** 2026-05-02
**Target document:** Doc 04 (Persistence Layer)
**Target sections:** §4 (Data Model — events table schema)
**Applied alongside:** AMD-34, AMD-35, AMD-36, AMD-37
**Source:** Retrofit Research deep analysis, Independent Validation Report (2026-05-02)

## Purpose

This document records six zero-cost schema column reservations added to the V001 events table during the M2-bridge pass. These columns have no Java API impact — they do not appear on `EventEnvelope` or `EventDraft`. They are populated with defaults (or computed values) at INSERT time by `SqliteEventStore` and will be wired through the Java event model when their respective features are implemented in future milestones.

The reservation pattern: add nullable or defaulted columns to the events table while the database is empty and `ALTER TABLE` is free. Activate them in the Java API when the feature ships and the API surface change is justified by real feature delivery. This avoids the catastrophic `ALTER TABLE ADD COLUMN` on a populated multi-GB event log that repeatedly caused Home Assistant recorder failures in 2024–2025 (issues #115765, #123348, #124186, #125339).

## Column Reservations

| Column | SQL Type | Default | Computed at INSERT? | Future Feature | Activation Milestone |
|---|---|---|---|---|---|
| `payload_size` | `INTEGER NOT NULL` | *(computed)* | Yes — `payloadBytes.length` | Database growth metrics, storage forecasting, payload size alerting — all without scanning BLOB contents | Observability (Doc 11) |
| `batch_id` | `BLOB(16)` | `NULL` | No — reserved | Atomic scene activation, Matter Groupcast, bulk device operations. Links per-device `command_issued` events to a single batch command. | Matter integration |
| `external_ref` | `TEXT` | `NULL` | No — reserved | Content-addressed blob references for large payloads that should not live in the event log (camera frames, video clips, firmware images). Format: `sha256:{hex}` URI pointing to a content store. | Matter 1.5 cameras, media integration |
| `intent_kind` | `TEXT NOT NULL` | `'UNSPECIFIED'` | No — default | Matter attribute/event/command trichotomy: `DESIRED` (command intent), `REPORTED` (device state observation), `ACK` (command acknowledgment), `EVENT_TRANSITION` (device-initiated event). Enables reconciliation of offline-queued desired state against reported state. | Matter integration |
| `logical_time` | `INTEGER NOT NULL` | `0` | No — default | Hybrid Logical Clock (HLC) counter for cross-protocol and cross-instance event ordering (DC-01). Combines physical time with a logical counter to produce a total order even when wall clocks disagree. | Multi-instance sync (INV-LF-05) |
| `node_id` | `INTEGER NOT NULL` | `0` | No — default | HLC node identifier distinguishing events produced by different instances in a multi-hub deployment. Combined with `logical_time`, provides a globally unique ordering tuple `(logical_time, node_id)`. | Multi-instance sync (INV-LF-05) |

## Design Notes

### Type Conventions

`intent_kind` uses `TEXT` rather than `SMALLINT` to match the existing convention established by V001's `priority` and `origin` columns, which store Java enum names as human-readable strings (e.g., `NORMAL`, `CRITICAL`, `PHYSICAL`, `USER_COMMAND`). This consistency provides two benefits:

1. **Debuggability:** Developers inspecting the SQLite database directly on Pi hardware (a common diagnostic workflow) can read `SELECT intent_kind FROM events` without looking up integer-to-enum mappings.

2. **Schema self-documentation:** The column values are self-describing. A database dump is readable without the Java source code.

The storage overhead of TEXT vs SMALLINT is approximately 10 bytes/row (average TEXT length ~14 characters vs 2 bytes for SMALLINT). At 182,500 events/year (50 devices, 10 events/device/day), this is ~1.8 MB/year — negligible against the existing ~200–500 bytes/row for the full event.

### Computation Path for `payload_size`

`payload_size` is the only Tier 2 column that is actively computed rather than defaulted. In `SqliteEventStore.doAppend()`, the serialized payload byte array (`payloadBytes`) is already available at line 285:

```java
byte[] payloadBytes = codec.encode(draft.payload());
```

The payload size is `payloadBytes.length`. This value is bound in the INSERT at zero additional computation cost — the byte array length is already known. No BLOB scanning, no secondary query, no post-hoc update needed.

### Java API Non-Impact

None of these six columns appear on `EventEnvelope` (14 fields) or `EventDraft` (9 fields after AMD-35). They are invisible to the Java event model. Subscribers, the Event Bus, the State Store, and all downstream consumers are unaware of their existence.

When a feature is activated and its column carries meaningful data, the corresponding field will be added to `EventEnvelope` and/or `EventDraft` at that time. This approach minimizes API surface churn — fields are added to the Java model only when they carry value that subscribers or producers actually use.

The `SqliteEventStore` SELECT_COLS query does not read these columns. The `fromRow()` method constructs `EventEnvelope` from the 14 fields it currently reads. New columns are ignored on the read path until `EventEnvelope` is expanded.

### Storage Overhead Estimate

Per-row overhead for all six columns combined:

| Column | Bytes per row (typical) |
|---|---|
| `payload_size` | 4 (INTEGER, always populated) |
| `batch_id` | 1 (NULL indicator, usually NULL) |
| `external_ref` | 1 (NULL indicator, usually NULL) |
| `intent_kind` | ~14 (TEXT, e.g., `UNSPECIFIED`) |
| `logical_time` | 8 (INTEGER, zero) |
| `node_id` | 2–4 (INTEGER, zero) |

**Total: ~30 bytes/row.** At 182,500 events/year (50 devices, 10 events/device/day): ~5.5 MB/year additional storage. This is under 3% overhead against the existing row size and negligible in the context of SQLite's page-level storage overhead.

### INSERT Binding Summary

The following bind positions are added to `SqliteEventStore.INSERT_SQL` for Tier 2 columns:

```java
// Tier 2 reservations
ps.setInt(N,   payloadBytes.length);                // payload_size
ps.setNull(N+1, Types.BLOB);                        // batch_id — reserved
ps.setNull(N+2, Types.VARCHAR);                      // external_ref — reserved
ps.setString(N+3, "UNSPECIFIED");                    // intent_kind — reserved
ps.setLong(N+4, 0L);                                // logical_time — reserved
ps.setInt(N+5, 0);                                   // node_id — reserved
```

Where `N` is the bind position after the AMD-34/35/37 columns. The exact positions depend on the final column ordering in the amended V001 schema.

## Reserved Event-Type Namespace

As a naming convention (not a schema change), the namespace `com.system.*` is reserved for self-monitoring health, storage, and security events. This prevents collision with user-defined automations and integration event types that might match loose patterns.

Examples of future reserved event types:
- `com.system.storage.health_check`
- `com.system.integrity.chain_verified`
- `com.system.integrity.chain_violation`
- `com.system.startup.unclean_shutdown_detected`

This reservation is documented here and should be reflected in the event type taxonomy (Doc 01 §4.3) and communicated to integration developers.

## Invariant Alignment

- **INV-ES-01 (Immutability):** No existing events are modified. Columns added to an empty table.
- **INV-ES-04 (Write-ahead persistence):** All columns are bound in the same INSERT as the event payload. No additional writes.
- **INV-LF-05 (Convergent sync):** `logical_time` and `node_id` reserve the HLC foundation for future cross-instance ordering.
- **INV-PR-02 (Performance targets):** Storage overhead is under 3% per row. INSERT overhead is negligible (6 additional bind operations, 5 of which are constants).
