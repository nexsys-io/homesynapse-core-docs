# AMD-36: Subscriber Dead-Letter Queue Table

**Amendment ID:** AMD-36
**Tier:** CONTRACT-LEVEL (M2-bridge — pre-M3 structural hardening)
**Status:** APPLIED
**Date applied:** 2026-05-02
**Target document:** Doc 01 (Event Model & Event Bus), Doc 04 (Persistence Layer)
**Target sections:** Doc 01 §3.5 (subscriber contract), Doc 04 §4 (Data Model)
**Refines:** INV-ES-05 (At-Least-Once Delivery with Subscriber Idempotency)
**Source:** Retrofit Research deep analysis (Axon DLQ, EventStoreDB #2748), Independent Validation Report (2026-05-02)

## Problem

No mechanism exists for parking poison events that a subscriber cannot process. Under the current contract (at-least-once delivery with subscriber idempotency, INV-ES-05, LTD-06), a single malformed event causes the subscriber to retry indefinitely, blocking all subsequent events in the subscriber's stream. Concrete failure scenarios:

1. **Schema version mismatch:** An integration publishes an event with `schemaVersion=2` before the subscriber's upcaster chain is updated. The `EventPayloadCodec` returns a `DegradedEvent` (DECIDE-M2-06/07), but the subscriber's business logic cannot process it and throws. Every retry produces the same exception.

2. **Corrupt payload:** A misbehaving integration adapter produces an event with syntactically valid but semantically corrupt JSON (e.g., a numeric field containing a string). Deserialization succeeds but processing throws a `ClassCastException` on every attempt.

3. **State conflict:** A subscriber encounters an event that references an entity in a state the subscriber considers invalid (e.g., a `command_result` for a command the subscriber never saw, due to a gap in its subscription filter). The subscriber throws and retries, but the underlying state never changes.

In all three cases, the subscriber stalls at the poison event's `global_position`, blocking delivery of all subsequent events. The State Projection, automation engine subscribers, and every downstream consumer are blocked. The system appears operational but state materialization has silently stopped.

This is a known failure mode in production event stores. EventStoreDB's persistent subscriptions had bug #2748 in 20.6.x where poison events retried indefinitely without auto-parking. Axon Framework added a formal DLQ (`dead_letter_entry` table with `EnqueuePolicy` interface) in 4.6 specifically to address this.

## Refinement of INV-ES-05

This amendment **refines** the at-least-once delivery guarantee. It does not weaken it. The refined contract:

> After N failed processing attempts for a single event, a subscriber MAY park the event in the dead-letter queue and advance its checkpoint. The event is NOT lost — it is durably recorded in the DLQ with full diagnostic context (exception class, message, stack trace, attempt count) for operator investigation and manual replay. The subscriber continues processing subsequent events.

The DLQ is a safety valve for exceptional failures, not a normal processing path. The value of N (maximum retry attempts before parking) is a per-subscriber configuration with a system default of 5. The retry count includes the initial attempt — an event that fails on first processing and then fails 4 retries is parked on the 5th total attempt.

**What the DLQ is NOT:**

- It is not a retry mechanism. Retries happen in-line before parking.
- It is not a message queue. Parked events are not automatically re-delivered.
- It is not a skip mechanism. The event is durably recorded — operator tooling (future milestone) can replay parked events after the root cause is fixed.

## Schema

New migration file: `V002__subscriber_dead_letter_queue.sql`

This is a new table, not a column amendment to the `events` table. It is placed in a separate V002 migration to maintain clean separation between V001 (event log schema) and operational infrastructure tables. The migration framework (MigrationRunner, completed M2.9) supports ordered multi-file migrations.

```sql
-- HomeSynapse Core / V002 — Subscriber Dead-Letter Queue
-- Provides durable parking for poison events that a subscriber cannot process
-- after exhausting retry attempts. See AMD-36.
--
-- Sync scope: LOCAL-ONLY. This table does not participate in cross-instance
-- CRDT sync (INV-LF-05). DLQ state is specific to a hub's processing
-- history and has no meaning in another instance.

CREATE TABLE IF NOT EXISTS subscriber_dead_letters (
    dlq_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_id     TEXT    NOT NULL,
    sequence_key      TEXT    NOT NULL,
    event_position    INTEGER NOT NULL,
    event_id          BLOB(16) NOT NULL,
    cause_class       TEXT    NOT NULL,
    cause_message     TEXT    NOT NULL,
    attempt_count     INTEGER NOT NULL DEFAULT 1,
    first_seen_at     INTEGER NOT NULL,
    last_attempt_at   INTEGER NOT NULL,
    diagnostics       TEXT,
    UNIQUE(subscriber_id, event_position)
);
```

### Field Rationale

| Field | Purpose |
|---|---|
| `dlq_id` | Auto-incrementing primary key for DLQ-internal ordering |
| `subscriber_id` | Identifies the subscriber that failed (e.g., `"state-projection"`, `"automation-engine"`). Same identifier used in `subscriber_checkpoints.subscriber_id`. |
| `sequence_key` | Preserves per-aggregate ordering context. Typically the hex-encoded `subject_ref` ULID. Enables future per-aggregate DLQ replay without cross-aggregate interference (Axon's `maxSequences` pattern). |
| `event_position` | The `global_position` of the failed event. Enables joining to the `events` table for full event context. |
| `event_id` | The event's ULID (`BLOB(16)` per LTD-04). Included for human-friendly diagnostic display — positions are opaque numbers, event IDs are recognizable ULIDs. |
| `cause_class` | Fully qualified Java exception class name (e.g., `java.lang.ClassCastException`). Enables automated categorization of failure modes. |
| `cause_message` | The exception's `getMessage()` output. Capped at application level — not by schema — to prevent unbounded TEXT growth. |
| `attempt_count` | Total number of processing attempts (including the initial attempt). Documents retry effort for operator triage. |
| `first_seen_at` | Unix microseconds (per LTD-08 time representation) when the event first failed. Enables staleness detection. |
| `last_attempt_at` | Unix microseconds of the most recent failed attempt. Enables retry interval analysis. |
| `diagnostics` | Optional TEXT field for stack traces, subscriber state snapshots, or structured JSON context. NULL when no additional diagnostics are captured. |
| `UNIQUE(subscriber_id, event_position)` | Prevents the same subscriber from parking the same event twice. If a parked event is replayed and fails again, the existing row is updated (attempt_count incremented), not duplicated. |

### Design Decisions

**`home_id` is deliberately omitted.** The home identity is derivable from the event at `event_position` via a join to the `events` table. The DLQ is queried rarely — operator investigation and manual replay are low-frequency diagnostic operations where a join is acceptable. Denormalizing `home_id` into the DLQ would create a maintenance coupling (the DLQ must track schema changes to the events table's identity model) without practical benefit.

**Sync scope is LOCAL-ONLY.** DLQ state records a specific hub's processing failures against its local event log. Another hub processing the same replicated events may not encounter the same failures (different software version, different subscriber configuration). Syncing DLQ state would create confusion, not value.

## AtomicCheckpointWriter Interaction

When a subscriber parks an event, two operations must be atomic:

1. INSERT into `subscriber_dead_letters` (park the event)
2. UPDATE `subscriber_checkpoints` (advance past the parked event)

If the checkpoint advances but the DLQ INSERT fails, the event is silently lost — the subscriber has moved past it and no record exists. This violates the "event is NOT lost" guarantee.

The existing `AtomicCheckpointWriter` wraps subscriber checkpoint + view checkpoint updates in a single SQLite transaction. For M3, this pattern must be extended to support a three-way atomic write:

- Subscriber checkpoint update
- View checkpoint update (when applicable — state projection)
- DLQ INSERT (when parking an event)

The extension is an M3 implementation concern — the method signature and transaction scope changes are specified when the subscriber retry/park logic is implemented. The V002 schema established by this amendment provides the durable table that the atomic write targets.

## Operator Tooling (Future)

DLQ management operations — replay a parked event, drop a parked event, inspect diagnostics, count parked events by subscriber, purge stale entries — are deferred to a future milestone. The schema supports all of these operations. No operator tooling ships in M2-bridge or M3.

## Invariant Alignment

- **INV-ES-01 (Immutability):** The events table is not modified. The DLQ is a separate table recording processing failures, not event mutations.
- **INV-ES-05 (At-least-once delivery):** Refined, not weakened. Every event is delivered at least once and processed at least once (the initial attempt). Events that fail processing after N attempts are durably parked, not silently dropped. The DLQ is the audit trail proving the event was received and attempted.
- **INV-RF-04 (Crash safety):** The atomic checkpoint+DLQ write ensures crash consistency. A crash during the transaction leaves both tables in their pre-transaction state.
- **LTD-06 (Write-ahead persistence):** The DLQ write happens within the same SQLite WAL as the checkpoint advance. Both are durable before the method returns.

## Downstream Dependencies

- **MigrationRunner:** Must discover and apply V002 in order after V001. The migration framework (M2.9) already supports ordered multi-file migrations — no framework changes needed.
- **MigrationRunnerTest:** Must verify V002 applies cleanly after V001 and that the `subscriber_dead_letters` table exists with the expected columns.
- **EventBus (M3):** The subscriber dispatch loop must implement retry counting and the park-and-advance decision. This is the primary M3 consumer of the DLQ table.
- **AtomicCheckpointWriter (M3):** Must be extended for three-way atomic writes (see above).
- **core/event-bus/MODULE_CONTEXT.md:** Must be updated to document the DLQ contract and its interaction with subscriber checkpoints.
