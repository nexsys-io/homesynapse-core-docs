# AMD-35: Persistent Idempotency Key on EventDraft and Events Table

**Amendment ID:** AMD-35
**Tier:** CONTRACT-LEVEL (M2-bridge — pre-M3 structural hardening)
**Status:** APPLIED
**Date applied:** 2026-05-02
**Target document:** Doc 01 (Event Model & Event Bus), Doc 04 (Persistence Layer)
**Target sections:** Doc 01 §4.1 (EventDraft), Doc 04 §4 (Data Model — events table schema)
**Extends:** AMD-08 (REST API Idempotency Keys for Command Endpoints)
**Source:** Retrofit Research deep analysis, Independent Validation Report (2026-05-02)

## Problem

AMD-08 specifies idempotency keys at the REST API level only: an in-memory LRU cache (`ConcurrentHashMap`, 10,000 entries, 24-hour TTL) that maps `Idempotency-Key` headers to `command_id` values. The cache is lost on process restart. The current implementation (`IdempotencyEntry` record in `api/rest-api/`) carries the key as a `String idempotencyKey` field (max 128 characters per Javadoc).

The `idempotency_key` value appears inside `command_issued` event payloads for forensic tracing, but does NOT exist as a column in the `events` table or as a field on `EventDraft` or `EventEnvelope`. This is insufficient for three scenarios that emerge in M3 and beyond:

1. **Cloud bridge dedup (INV-LF-05):** When events are replicated to a cloud aggregator or synced between hubs, the idempotency key enables cross-instance dedup at the event store level. An in-memory cache that dies on restart cannot serve this purpose.

2. **Integration adapter retry dedup:** Zigbee and Z-Wave adapters retry commands on mesh failures. An adapter restart between the original command and the retry loses the in-memory cache, producing duplicate `command_issued` events. A persistent idempotency key enables SQL-level dedup that survives restarts.

3. **Automation run dedup:** An automation rule that fires during a sensor flap period may produce the same logical command multiple times. Tagging each automation run with an idempotency key and persisting it in the events table enables the persistence layer to reject true duplicates.

## Relationship to AMD-08

This amendment **extends** AMD-08 — it does not replace it. The REST API idempotency mechanism (in-memory cache, 24-hour TTL, `Idempotency-Key` header) remains as specified. This amendment adds a persistent layer beneath it:

- The idempotency key is stored in the `events` table and indexed for SQL-level dedup queries
- The persistent key survives process restarts and enables cross-instance dedup via cloud bridge
- The REST API cache remains the fast path; the SQL unique index is the durable backstop

## Schema Change

Amend V001 in-place (same rationale as AMD-34 — V001 has not shipped to production):

**Add column to the `events` table:**

```sql
idempotency_key   TEXT,
```

The type is `TEXT`, not `BLOB(16)`. Rationale: the REST API's `Idempotency-Key` header accepts arbitrary client-generated strings up to 128 characters — UUIDs, random strings, content hashes, human-readable identifiers. Using `BLOB(16)` would silently reject or truncate valid client keys that are not 16-byte ULIDs. `TEXT` matches the `IdempotencyEntry.idempotencyKey` field type (`String`) and the wire format.

**Add partial unique index:**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_idempotency
    ON events(home_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
```

The index is scoped per `home_id` (AMD-34) so that the same idempotency key used for different homes in a future multi-home remote management scenario does not collide. In single-home MVP, this effectively degenerates to `UNIQUE(idempotency_key)` since all events share the same `home_id`.

The `WHERE idempotency_key IS NOT NULL` filter ensures that the vast majority of events (state_reported, presence_signal, telemetry — all with NULL idempotency keys) pay no index maintenance cost.

## Java API Change

**Add to `EventDraft`:**

```java
public record EventDraft(
        String eventType,
        int schemaVersion,
        Instant eventTime,
        SubjectRef subjectRef,
        EventPriority priority,
        EventOrigin origin,
        DomainEvent payload,
        Ulid actorRef,
        String idempotencyKey    // NEW — nullable, max 128 characters
) { ... }
```

`idempotencyKey` is added as field #9 (after `actorRef`). It is nullable — most events do not carry an idempotency key.

**Validation in compact constructor:** If non-null, `idempotencyKey` must be non-blank and at most 128 characters. This matches the REST API constraint from AMD-08.

**EventEnvelope is NOT changed.** The idempotency key is producer-side metadata used for write-path dedup. Subscribers do not need it for event processing. If a future subscriber (e.g., cloud bridge sync) needs access to the idempotency key, EventEnvelope can be expanded at that time — this amendment authorizes that future expansion.

## Binding Path

- **REST API command handlers:** Populate `EventDraft.idempotencyKey` from the `Idempotency-Key` HTTP header (already parsed per AMD-08). The in-memory cache check happens first; the SQL unique index is the durable backstop.
- **Automation engine:** Populate from the automation run ID when deterministic dedup is desired, or leave null for automations where duplicate execution is acceptable.
- **Integration adapters:** Populate from protocol-specific retry tokens (e.g., Matter transaction IDs) or leave null.
- **System/telemetry events:** Leave null. Sensor telemetry (`state_reported`), presence signals, and diagnostic events have no meaningful idempotency semantics.
- **SqliteEventStore:** Reads `draft.idempotencyKey()` and binds it in the INSERT. If non-null, binds as `ps.setString(N, key)`; if null, binds as `ps.setNull(N, Types.VARCHAR)`.

## Invariant Alignment

- **INV-ES-01 (Immutability):** No existing events are modified. Column added to an empty table.
- **INV-ES-05 (At-least-once delivery):** Strengthened. The persistent idempotency key provides a durable dedup mechanism beyond the in-memory cache, supporting the "subscriber idempotency" requirement at the store level.
- **INV-LF-05 (Convergent sync):** The idempotency key enables cross-instance dedup when events are replicated between hubs or to a cloud aggregator.
- **LTD-06 (Write-ahead persistence):** The idempotency key is persisted with the event in the same WAL commit. No separate dedup store is needed.

## Downstream Dependencies

- **EventDraft:** Field count changes from 8 to 9. All `new EventDraft(` call sites must be updated. This is a smaller blast radius than an EventEnvelope change (EventDraft has fewer construction sites — primarily in REST API handlers, automation engine, and test fixtures).
- **SqliteEventStore:** INSERT_SQL must add `idempotency_key` to the column list and bind position.
- **TestEventFactory:** Must accept optional `idempotencyKey` parameter (default null for backward compatibility in tests).
- **AMD-08 (REST API):** The REST API command handlers must populate the new `EventDraft.idempotencyKey` field from the parsed header value. The `IdempotencyEntry` cache continues to operate as specified.
- **AMD-34 (Home Identity):** The partial unique index references `home_id` from AMD-34.
