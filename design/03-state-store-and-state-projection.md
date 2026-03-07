# HomeSynapse Core — State Store & State Projection

**Document type:** Subsystem design
**Status:** Draft
**Subsystem:** State Store & State Projection
**Dependencies:** Event Model & Event Bus (§3.1 producer boundaries, §3.5 telemetry boundary, §3.9 origin model, §4.3 event type taxonomy, §8.3 EventPublisher interface), Device Model & Capability System (§3.12 discovery pipeline, §8.1 DeviceRegistry/EntityRegistry interfaces, §8.2 HardwareIdentifier type), State Store & State Projection (§8.1 StateQueryService interface), Persistence Layer (§3.6 telemetry ring store write path, §8.3 TelemetryWriter interface), Identity and Addressing Model (§6 hardware identifier mapping rules), Glossary v1 (§2.9 Integration, §2.7 Discovery)
**Dependents:** Persistence Layer (§3.12 view_checkpoints table, §8.1 CheckpointStore implementation, §3.2 same-transaction atomicity guarantee), Automation Engine (state queries for trigger evaluation and condition checking), REST API (current state endpoints, entity listing), WebSocket API (state change push notifications), Observability & Debugging (state health indicators, staleness monitoring), Web UI (dashboard state rendering, entity history graphs), Persistence Layer (§3.12 view_checkpoints table, §8.1 CheckpointStore implementation, §3.2 same-transaction atomicity guarantee)
**Author:** HomeSynapse Core Architecture
**Date:** 2026-03-05

---

## 0. Purpose

The State Store is the primary materialized view of the HomeSynapse event-sourced architecture. It consumes events from the Event Bus, maintains the current state of all enabled entities in memory, and provides the query interface that the REST API, WebSocket API, Automation Engine, and Web UI depend on for responsive state lookups. Without this subsystem, every query for "what is the temperature in the living room?" would require scanning the entity's event stream from the most recent checkpoint — a latency model incompatible with responsive dashboards and sub-100ms automation evaluation.

The State Store also contains the State Projection — the core subscriber that compares incoming `state_reported` events against canonical state and produces `state_changed` events when a reported value differs from the current value. This subscriber is the bridge between raw integration observations and meaningful state transitions. It is the sole producer of `state_changed` events; integrations never produce this type directly (see **Event Model & Event Bus** §3.1 producer boundaries). The State Projection's dual role — maintaining the in-memory view and producing derived events — is an intentional coupling: the canonical state against which incoming reports are compared is the same state that the view exposes to query consumers. Separating these into independent subscribers would create a consistency gap where the projection and the view disagree about current state.

The State Store is a projection, never the source of truth. If the in-memory state or its checkpoint is lost, corrupted, or invalidated by a schema change, the system rebuilds it from the event log. This is the subsystem-level expression of INV-ES-02: state is always derivable from events.

---

## 1. Design Principles

**Derived state is always rebuildable.** If the State Store's in-memory state is lost or its checkpoint is corrupted, replaying the event log from the beginning reconstructs identical state. Correctness depends on the event log, not on the State Store's persistence. This principle governs the checkpoint design: checkpoints accelerate recovery but are never authoritative. Informs decisions in §3.3 and §6.1.

**Current state is a thin layer over the event log.** The State Store maintains only the latest value for each attribute of each enabled entity. It does not maintain historical state, aggregated state, or computed state beyond what the event stream directly provides. Historical and analytical queries are served by the event log or by future dedicated projections. This principle constrains scope and prevents the State Store from accumulating complexity that belongs elsewhere. Informs decisions in §2.2 and §3.1.

**Reads must never block writes.** The State Store serves many concurrent readers (REST API handlers, WebSocket push, Automation Engine queries) and a single writer (the projection subscriber). The concurrency model must ensure that query latency is independent of event processing load, and that event processing throughput is independent of query volume. Informs decisions in §3.5.

**Staleness is visible, not hidden.** Every query response includes the `view_position` — the `global_position` of the last event the State Store has processed. Consumers can determine how current the data is and make their own decisions about whether to wait, retry, or proceed. This is the subsystem-level expression of INV-TO-03: no hidden state. Informs decisions in §5 and §8.

**The entity registry is the structural authority.** The State Store does not duplicate entity metadata, capability schemas, area assignments, labels, or type classifications. The Device Model's `EntityRegistry` (see **Device Model & Capability System** §8) owns structural queries. The State Store owns attribute values, availability, and temporal metadata. Composite queries join both sources at the caller. Informs decisions in §2.2 and §3.1.

**Attribute state is applied from `state_changed`, never directly from `state_reported`.** In LIVE mode, the State Projection compares a `state_reported` value against canonical state, and if the value differs, appends a `state_changed` event and then applies that derived event to the in-memory view. The `state_changed` event is the authoritative source of the attribute mutation, not the `state_reported` event that triggered it. In REPLAY mode, the State Store rebuilds by consuming existing `state_changed` events — it does not re-derive them from `state_reported`. This principle ensures that the invariant "every attribute value traces to a `state_changed` event" is mechanically true, not just logically true. Informs decisions in §3.2 and §5.

---

## 2. Scope and Boundaries

### 2.1 This Subsystem Owns

- In-memory materialized view of current entity state (attribute values, availability, temporal metadata).
- The State Projection subscriber: comparing `state_reported` values against canonical state in LIVE mode, producing `state_changed` events when values differ, consuming existing `state_changed` events during REPLAY to rebuild state, and tracking `last_reported` timestamps for freshness monitoring.
- Checkpoint content definition: what data is serialized, what triggers a checkpoint write, and what schema version the checkpoint uses.
- State query interface for other subsystems: single-entity lookup, batch lookup, full snapshot, and view position reporting.
- Processing of `availability_changed`, `entity_enabled`, `entity_disabled`, `entity_profile_changed`, and `entity_transferred` events to maintain consistency between the state view and the entity lifecycle.

### 2.2 This Subsystem Does Not Own

- Durable event storage and event log indexes — owned by the **Persistence Layer** (doc 04). The State Store defines checkpoint content; the Persistence Layer defines checkpoint storage mechanics and SQLite schema.
- Event subscription, delivery, and backpressure — owned by the **Event Model & Event Bus** (doc 01). The State Store is a subscriber; it does not implement the subscription machinery.
- Entity metadata, capability schemas, area assignments, labels, and type classifications — owned by the **Device Model & Capability System** (doc 02). Filtered queries ("all entities in area X that are on") are served by combining State Store lookups with entity registry queries at the caller.
- Historical state queries ("what was the temperature at 3 AM?") — served by scanning `state_changed` events in the event log via the Persistence Layer's query interface. The State Store owns only current state.
- Automation state (enabled/disabled, last run, last trigger) — owned by the **Automation Engine** (doc 07) as an internal projection.
- Person presence state — a future dedicated projection. Not modeled in the entity state view.
- Pending command tracking and `state_confirmed` production — owned by the **Pending Command Ledger** within the Event Model subsystem (doc 01 §3.8). The State Store does not track in-flight commands.
- Raw telemetry streams (sustained rate > 1 sample per 10 seconds, per **Event Model & Event Bus** §3.5) — routed to the Telemetry Ring Store, not to the domain event path. The State Store processes only domain events. Telemetry influences entity state only through promoted domain events (`state_reported` produced by the aggregation engine after crossing the telemetry boundary). The `lastReported` field reflects domain-path `state_reported` events, not raw telemetry samples.

---

## 3. Architecture

### 3.1 Subsystem Position

The State Store sits between the Event Bus (which delivers events) and the downstream consumers that query state. It also has a write-back relationship with the Event Bus: in LIVE mode, the State Projection produces `state_changed` events by calling `EventPublisher.publish()`. In REPLAY mode, it consumes existing `state_changed` events without producing new ones (see **Event Model & Event Bus** §3.7).

```
┌─────────────────────────────────────────────────────┐
│                    Event Bus                         │
│                                                      │
│  state_reported ─────┐  availability_changed ────┐   │
│  state_changed ──────┤  entity_enabled ──────────┤   │
│  entity_profile_     │  entity_disabled ─────────┤   │
│    changed ──────────┘  entity_transferred ──────┘   │
└───────────────────────────────────────────┬──────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────┐
│              State Store Subsystem                      │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │         State Projection Subscriber              │   │
│  │  (subscriber_id: state_projection)               │   │
│  │                                                  │   │
│  │  LIVE mode:                                      │   │
│  │    state_reported ──▶ compare canonical           │   │
│  │      differs? ──▶ append state_changed ──────────┼─▶ Bus
│  │                      then apply to view          │   │
│  │    state_changed ──▶ (skip: self-produced)       │   │
│  │                                                  │   │
│  │  REPLAY mode:                                    │   │
│  │    state_changed ──▶ apply to view               │   │
│  │    state_reported ──▶ update lastReported only   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │         In-Memory State View                     │   │
│  │                                                  │   │
│  │  ConcurrentHashMap<EntityRef, EntityState>       │   │
│  │  (immutable EntityState records, volatile        │   │
│  │   viewPosition for staleness tracking)           │   │
│  └──────────────────────────────────────────────────┘   │
│                        │                                │
│           ┌────────────┼────────────┐                   │
│           ▼            ▼            ▼                   │
│     REST API    Automation    WebSocket                 │
│     (doc 09)    Engine        API                      │
│                 (doc 07)      (doc 10)                  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │         Checkpoint Writer                        │   │
│  │                                                  │   │
│  │  Triggered by time interval OR event count       │   │
│  │  (with minimum spacing to avoid storm churn)     │   │
│  │  Serializes snapshot + view_position             │   │
│  │  Delegates write to CheckpointStore (§8.3)       │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Event Subscription and Processing

The State Projection registers as a single subscriber with the Event Bus using subscriber ID `state_projection`. The subscription filter is:

```java
new SubscriptionFilter(
    Set.of(
        "state_reported",
        "state_changed",
        "availability_changed",
        "entity_enabled",
        "entity_disabled",
        "entity_profile_changed",
        "entity_transferred"
    ),
    EventPriority.DIAGNOSTIC,   // state_reported is DIAGNOSTIC
    "entity."                   // entity-type subjects only
)
```

The subscription includes `state_changed` because the State Projection must consume existing `state_changed` events during REPLAY to rebuild state (see **Event Model & Event Bus** §3.7 and §7 interaction table). In LIVE mode, `state_changed` events produced by this subscriber are delivered back to it by the Event Bus, but the subscriber skips them — it already applied the state mutation when it produced the event.

The minimum priority is `DIAGNOSTIC` because `state_reported` events are DIAGNOSTIC (see **Event Model & Event Bus** §3.3). The `entityTypePrefix` filter restricts the subscription to entity subjects — device, automation, person, and system subjects are not processed by this subscriber.

One exception to the entity-only filter: `availability_changed` events may have either entity or device subjects (see **Event Model & Event Bus** §4.3). When the subject is a device, the State Store resolves the device's entities via the entity registry and updates availability for each. When the subject is an entity, the update applies directly. The subscription filter uses `entity.` prefix, so device-subject `availability_changed` events require a separate handling path — see §3.4 for the resolution.

**Coalescing exemption.** The State Projection registers its subscription with coalescing disabled, following the same pattern as the Pending Command Ledger (see **Event Model & Event Bus** §3.6). The rationale is identical in kind: the State Projection is a correctness-critical subscriber. If `state_reported` events are coalesced before the projection processes them, intermediate value transitions that would have produced `state_changed` events are lost. The `state_changed` event log — which downstream consumers and historical queries depend on — would be incomplete exactly during the moments users care about (event storms, mesh recoveries, flapping devices). The raw `state_reported` events remain in the event log regardless of coalescing, but the derived `state_changed` facts would have gaps.

The cost of disabling coalescing is that the State Projection may fall further behind during event storms. This is acceptable: the projection processes events quickly (< 2 ms per event, §10) and catches up once the storm subsides. During the catch-up period, the `subscriber_falling_behind` event fires (§6.2) and queries return data with a lagging `viewPosition`, which is the designed staleness-visibility mechanism.

**Processing dispatch per event type:**

Processing behavior depends on the subscriber's current processing mode (LIVE or REPLAY). The idempotency check is universal: for every event, if the event's `subject_sequence` ≤ the entity's `stateVersion`, the event is a duplicate and is skipped entirely.

**LIVE mode processing:**

| Event Type | Priority | Processing Action | State Mutation | Derived Event |
|---|---|---|---|---|
| `state_reported` | DIAGNOSTIC | Validate entity is enabled. Compare reported value against canonical state for the attribute. Update `lastReported` and `lastUpdated` unconditionally. Advance `stateVersion`. | If value differs: append `state_changed` via `EventPublisher`, then apply the derived event's values to attributes, update `lastChanged`. If value matches: no attribute change. | `state_changed` if value differs. None if value matches. |
| `state_changed` | NORMAL | Skip. In LIVE mode, `state_changed` events in the subscription are self-produced — the state mutation was already applied when the event was derived from `state_reported`. The subscriber recognizes self-produced events by checking whether `stateVersion` already reflects this event. | None (already applied). | None. |
| `availability_changed` | CRITICAL/NORMAL | Update the entity's `availability` field. Update `lastUpdated`. Advance `stateVersion`. | Availability enum updated. | None. |
| `entity_enabled` | NORMAL | Mark entity as enabled in the processing set. Begin projecting incoming events for this entity. Advance `stateVersion`. | No attribute changes. Entity becomes eligible for projection. | None. |
| `entity_disabled` | NORMAL | Mark entity as disabled in the processing set. Freeze current attribute state. Advance `stateVersion`. | No attribute changes. Entity remains in the view with frozen attribute values. | None. |
| `entity_profile_changed` | NORMAL | The entity's capability set changed. Add attributes for newly added capabilities (initialized to null). Remove attributes for removed capabilities. Preserve attributes for unchanged capabilities. Advance `stateVersion`. | Attribute map may grow or shrink. | None. |
| `entity_transferred` | NORMAL | The entity was transferred to a new device. State is preserved (entity identity is stable across device replacement per **Identity and Addressing Model** §5). If the transfer includes a capability diff with removed capabilities, handle as `entity_profile_changed`. Advance `stateVersion`. | Attribute map may change if capabilities differ. | None. |

**REPLAY mode processing:**

During REPLAY (startup catch-up from a checkpoint behind the log head), the State Projection does not produce new derived events. The derived events already exist in the log from the original LIVE processing. This conforms to the processing mode contract in **Event Model & Event Bus** §3.7: "The State Projection does not re-emit `state_changed` events during replay. It applies the stored `state_changed` events to rebuild state."

| Event Type | Priority | Processing Action | State Mutation | Derived Event |
|---|---|---|---|---|
| `state_reported` | DIAGNOSTIC | Update `lastReported` and `lastUpdated` timestamps. Advance `stateVersion`. Do not compare against canonical state. Do not produce `state_changed`. | Timestamps only. No attribute mutation. | None. |
| `state_changed` | NORMAL | Apply the attribute change carried in the event's payload (`new_value`) to the entity's state. Update `lastChanged`, `lastUpdated`. Advance `stateVersion`. | Attribute updated from `new_value`. | None (already in the log). |
| `availability_changed` | CRITICAL/NORMAL | Same as LIVE mode. Advance `stateVersion`. | Availability enum updated. | None. |
| `entity_enabled` | NORMAL | Same as LIVE mode. Advance `stateVersion`. | Same as LIVE. | None. |
| `entity_disabled` | NORMAL | Same as LIVE mode. Advance `stateVersion`. | Same as LIVE. | None. |
| `entity_profile_changed` | NORMAL | Same as LIVE mode. Advance `stateVersion`. | Same as LIVE. | None. |
| `entity_transferred` | NORMAL | Same as LIVE mode. Advance `stateVersion`. | Same as LIVE. | None. |

**Key invariant across both modes:** `stateVersion` advances on every processed event for the entity, regardless of whether state mutated. This ensures the idempotency cursor tracks *processing*, not just *mutations*. A `state_reported` event that matches canonical state still advances `stateVersion`, so if it is redelivered (at-least-once semantics), the duplicate is correctly detected.

**Disabled entity processing.** When an entity is in the `disabledEntities` set:

- `state_reported` events update `lastReported` and `lastUpdated` timestamps and advance `stateVersion`, but do not trigger value comparison or `state_changed` derivation. Attribute values remain frozen. This preserves freshness monitoring — a disabled entity that is still actively reporting is distinguishable from one that has gone silent. The `lastReported` timestamp continues to reflect device communication regardless of administrative state.
- `state_changed` events (encountered during REPLAY for an entity that was disabled mid-stream) are applied normally to attribute state if they precede the `entity_disabled` event in the log. After the `entity_disabled` event is processed, subsequent `state_changed` events in the log (which should not exist for that entity — they would not have been produced while disabled in LIVE mode) are treated as a consistency warning.
- `availability_changed` events are always processed, regardless of disabled status.

**REPLAY gap for in-flight `state_reported` events.** If the process crashes after a `state_reported` event is persisted but before the State Projection produces the corresponding `state_changed` event, the derived event will not be produced during REPLAY. In REPLAY mode, the State Projection consumes existing `state_changed` events from the log — it does not re-derive them from `state_reported`. This means the state gap for that entity and attribute persists until the integration next reports a value that differs from the (now stale) canonical state. For most smart home integrations (reporting every 30–300 seconds), the gap is seconds to minutes. For infrequent reporters (door sensors, leak detectors that report only on physical events), the gap persists until the next physical event. This is an accepted design trade-off: re-deriving during REPLAY would require the State Projection to maintain and compare state during replay, substantially increasing REPLAY complexity and violating the principle that REPLAY mode consumes existing events rather than producing new ones. The event log remains the source of truth — the `state_reported` event is in the log and available for diagnostic queries — but the derived `state_changed` is absent for that specific report.

### 3.3 Checkpoint Strategy

Checkpoints are full snapshots of the in-memory state view. A checkpoint contains the serialized entity state map, the `view_position` (the `global_position` of the last event processed), and a checkpoint schema version.

**Checkpoint format:**

```json
{
  "schema_version": 1,
  "view_position": 48523,
  "checkpoint_time": "2026-03-05T14:30:00.000000Z",
  "disabled_entities": ["01HV...abc", "01HV...def"],
  "entities": {
    "01HV...123": {
      "attributes": {
        "brightness": { "value": 75, "type": "int" },
        "on_off": { "value": true, "type": "boolean" }
      },
      "availability": "AVAILABLE",
      "state_version": 142,
      "last_changed": "2026-03-05T14:29:55.123456Z",
      "last_updated": "2026-03-05T14:29:58.654321Z",
      "last_reported": "2026-03-05T14:29:58.654321Z"
    }
  }
}
```

The `disabled_entities` set records which entities were disabled at checkpoint time. On recovery, these entities are restored as disabled and their attribute state remains frozen (though freshness timestamps continue updating) until `entity_enabled` is processed during replay.

**Checkpoint triggers.** A checkpoint is written when either condition is met, subject to a minimum spacing constraint:

- **Time interval:** 5 minutes since the last checkpoint (configurable: `state_store.checkpoint.interval_minutes`).
- **Event count:** 1,000 events processed since the last checkpoint (configurable: `state_store.checkpoint.event_threshold`).
- **Minimum spacing:** No checkpoint is written less than 30 seconds after the previous one (configurable: `state_store.checkpoint.min_interval_seconds`), except during graceful shutdown.

Whichever of the time interval or event count conditions fires first triggers the write, provided the minimum spacing has elapsed. A checkpoint is also written during graceful shutdown regardless of the minimum spacing, to minimize replay on the next startup.

The minimum spacing constraint prevents checkpoint churn during event storms. At 500 events/sec sustained, the event count threshold of 1,000 would trigger a checkpoint every 2 seconds without the minimum spacing — constant serialization and disk I/O at exactly the moments the system is already under load. With a 30-second minimum, the worst-case events to replay after a crash during a storm is 500 events/sec × 30 sec = 15,000 events, replayed at > 10,000 events/sec = ~1.5 seconds. This is a small startup cost for substantially reduced I/O pressure during high activity.

**Checkpoint sizing.** At MVP scale (50 devices, ~150 entities), each `EntityState` serializes to approximately 200–500 bytes depending on attribute count and value types. The full checkpoint is 30–75 KB. At the scale target (1,000 devices, ~3,000 entities), the checkpoint grows to 600 KB–1.5 MB. Both are well within the 2-second checkpoint write budget (INV-PR-02 operational budget).

**Checkpoint write is non-blocking.** The checkpoint writer creates a consistent snapshot of the entity state map (see §3.5 for the snapshot mechanics), then delegates the serialized byte array to the `CheckpointStore` interface (§8.3) for SQLite persistence. The projection subscriber continues processing events during checkpoint serialization.

**Schema version and invalidation.** The checkpoint carries a `schema_version` field. If the runtime's `EntityState` schema version is higher than the checkpoint's (e.g., after a software upgrade that adds a field to `EntityState`), the checkpoint is discarded and the system rebuilds from the event log. This follows the snapshot invalidation rule established in **Event Model & Event Bus** §3.10: checkpoints that were built with an older schema version are not trustworthy because they may lack fields that the new code expects. Full rebuild through the upcaster chain ensures correctness.

### 3.4 Device-Subject Availability Resolution

The `availability_changed` event can have either an entity subject or a device subject. Entity-subject events are processed directly. Device-subject events require resolution: when a device goes offline, all of its entities become unavailable.

The State Projection handles this by querying the entity registry (`EntityRegistry.getEntitiesByDevice(deviceRef)`) to resolve the device reference to its set of entity references, then applying the availability update to each entity.

This creates a dependency on the entity registry's startup order: the registry must be populated before the State Projection processes device-subject availability events. The startup sequence (§3.6) enforces this ordering.

The subscription filter (`entity.` prefix) does not match device-subject events. To receive `availability_changed` events for both entity and device subjects, the State Projection registers a supplementary filter:

```java
new SubscriptionFilter(
    Set.of("availability_changed"),
    EventPriority.NORMAL,    // CRITICAL when going offline, NORMAL when online
    null                     // no subject type filter — accept all subjects
)
```

The Event Bus merges these filters for notification purposes: the subscriber is notified when any event matching either filter is appended. The subscriber's polling logic handles both entity and device subjects in a single processing loop.

### 3.5 Concurrency Model

The State Store has a single writer (the projection subscriber's virtual thread) and many concurrent readers (REST API handler threads, WebSocket push threads, Automation Engine evaluation threads). The concurrency model uses a `ConcurrentHashMap` with immutable `EntityState` records and a `volatile` view position.

**Write path.** The projection subscriber processes events sequentially on its dedicated virtual thread. On each event, it creates a new immutable `EntityState` record for the affected entity and replaces the entry in the `ConcurrentHashMap` via `put()`. The `viewPosition` is published via a `volatile` field after each event.

```java
// Conceptual model — not the final implementation
private final ConcurrentHashMap<EntityRef, EntityState> states =
    new ConcurrentHashMap<>();
private volatile long viewPosition;
private volatile boolean replaying;

void onEvent(EventEnvelope event) {
    EntityState current = states.get(event.subjectRef());
    EntityState updated = applyEvent(current, event);
    states.put(event.subjectRef(), updated);
    viewPosition = event.globalPosition();
}
```

**Read path.** Single-entity reads (`getState()`) are a `ConcurrentHashMap.get()` followed by reading the immutable `EntityState` record. This is lock-free and returns a consistent per-entity view. Batch reads (`getStates()`) perform multiple `get()` calls — each individual entity read is consistent, but the batch as a whole is weakly consistent across entities (entity A's state may reflect a slightly different point in time than entity B's). For home automation dashboards and automation evaluation, this weak cross-entity consistency is acceptable: a dashboard that reads entity A at position 1000 and entity B at position 1002 shows data that is at most milliseconds apart.

**`getSnapshot()` for bulk endpoints.** When a caller needs a point-in-time consistent view across all entities (e.g., the REST API's full entity listing, or the WebSocket API's initial state sync), `getSnapshot()` creates an immutable copy of the map at call time:

```java
StateSnapshot getSnapshot() {
    // Snapshot creation copies the map — O(N) but infrequent
    return new StateSnapshot(
        Map.copyOf(states),
        viewPosition,
        Instant.now(),
        replaying,
        Set.copyOf(disabledEntities)
    );
}
```

This is an O(N) copy, but `getSnapshot()` is called infrequently (initial page loads, bulk API requests) rather than on every event. At 150 entities, the copy takes < 1 ms. At 3,000 entities, it takes < 5 ms. These costs are paid only when the caller explicitly requests a full snapshot.

**Cost model.** Each event replaces one `EntityState` record in the map — an allocation of ~500 bytes. At 500 events/sec, this is ~250 KB/sec of young-gen allocation, trivially handled by G1GC. Compared to the previous full-map-copy design (~48 MB/sec at 3,000 entities and 500 events/sec), this reduces allocation pressure by two orders of magnitude and eliminates the scaling concern entirely.

**Checkpoint serialization.** The checkpoint writer calls `getSnapshot()` to obtain a consistent copy, then serializes it. This ensures the checkpoint represents a coherent point-in-time view even though the projection subscriber continues processing events during serialization.

**Alternative considered: full-map immutable snapshot per event.** Creating a new `Map<EntityRef, EntityState>` for every state-altering event guarantees perfect point-in-time consistency for all reads, but the O(N) copy per event creates unsustainable GC pressure at scale (3,000 entities × 500 events/sec = ~48 MB/sec of young-gen allocation). The ConcurrentHashMap approach trades cross-entity atomicity on `getState()`/`getStates()` reads for dramatically lower allocation pressure, while still providing full consistency for `getSnapshot()` callers that explicitly need it.

### 3.6 Startup Sequence

Startup proceeds in three phases:

**Phase 1: Checkpoint load.** The State Store requests the most recent checkpoint from `CheckpointStore.readLatestCheckpoint("entity_state")`. If a checkpoint exists and its `schema_version` matches the runtime's expected version, the in-memory state is populated from the checkpoint data and the `disabled_entities` set is restored. If the checkpoint is absent, corrupted (deserialization failure), or has a mismatched schema version, the State Store starts with empty state and position 0, falling through to a full replay.

**Phase 2: Replay.** The subscriber registers with the Event Bus at the checkpoint's `view_position` (or 0 if no checkpoint). The Event Bus delivers all events from that position to the log head. The subscriber processes these events in REPLAY mode (see **Event Model & Event Bus** §3.7).

During REPLAY, the State Projection does not produce new derived events. This is the explicit contract from **Event Model & Event Bus** §3.7: "The State Projection does not re-emit `state_changed` events during replay. It applies the stored `state_changed` events to rebuild state." The processing logic during REPLAY differs from LIVE mode as documented in §3.2:

- `state_changed` events in the log are applied to the in-memory view (attribute updates, timestamp updates).
- `state_reported` events update freshness timestamps (`lastReported`, `lastUpdated`) and advance `stateVersion` but do not trigger value comparison or derivation.
- Lifecycle events (`availability_changed`, `entity_enabled`, `entity_disabled`, `entity_profile_changed`, `entity_transferred`) are processed identically to LIVE mode.

The subscriber transitions from REPLAY to LIVE when its checkpoint reaches within the configurable threshold of the log head (default: 10 events, see **Event Model & Event Bus** §3.7). After the transition, `state_reported` events are processed in LIVE mode: compared against canonical state, producing `state_changed` events when values differ.

**Phase 3: Ready signal.** When the subscriber transitions to LIVE mode, the State Store publishes a readiness signal. The implementation is a `CompletableFuture<Void>` that completes when the view is current. The Startup & Lifecycle subsystem (doc 12) uses this future to gate dependent subsystem initialization and REST API availability.

**Query behavior during replay.** During phases 1 and 2, the State Store is not yet current. Queries against the state view during this window return data from the checkpoint (if loaded) plus any events processed so far. The `replaying` flag (a `volatile boolean`) is set to `true` during replay and `false` after the ready signal. Query responses include this flag so consumers can distinguish between current and catching-up state.

The REST API (doc 09) should return HTTP 503 during replay unless the caller explicitly accepts stale data (via an `Accept-Stale: true` header or equivalent). This is a REST API design decision, not a State Store decision — the State Store provides the `replaying` flag; the API layer decides how to use it.

**Startup time budget.** The 10-second startup target (INV-PR-02 constitutional) constrains the total time from process start to functional dashboard. The State Store's share of this budget includes checkpoint load, replay, and ready signal. With a 30-second minimum checkpoint interval (§3.3) and a replay rate > 10,000 events/sec (**Event Model & Event Bus** §10), the worst case is replaying 30 seconds of events at peak throughput: 500 events/sec × 30 sec = 15,000 events, replayed at 10,000/sec = 1.5 seconds. Combined with checkpoint deserialization (< 100 ms for a 75 KB JSON document), the State Store's startup contribution is well under 2 seconds in practice.

If the system starts with no checkpoint (first boot or checkpoint invalidated by schema change), full replay is required. At 1.5 million events (one year, 50 devices), replay takes ~150 seconds at 10,000 events/sec. This exceeds the startup target. The State Store reports its replay progress via the `hs_state_store_replay_progress` gauge (§11.1) and the system transitions to functional-with-stale-state rather than blocking the dashboard entirely. This is an acceptable degradation for a rare event (first boot, version upgrade with schema change).

### 3.7 Disabled Entity Behavior

When the State Store processes an `entity_disabled` event:

1. The entity's current `EntityState` is preserved in the view. Attribute values are frozen.
2. The entity is added to the `disabled_entities` set.
3. Subsequent `state_reported` events for this entity update `lastReported`, `lastUpdated`, and `stateVersion` but do not trigger value comparison or `state_changed` derivation. This preserves freshness monitoring: a disabled entity that is still actively reporting is distinguishable from one that has gone silent. The `lastReported` timestamp continues to reflect device communication regardless of administrative state.
4. `availability_changed` events for a disabled entity are still processed. Availability reflects reachability, which is independent of the administrative decision to disable. A disabled entity that goes offline is both disabled and unavailable.
5. Commands targeting a disabled entity are rejected at dispatch time by the command dispatch service, not by the State Store. The State Store does not participate in command validation.

When the State Store processes an `entity_enabled` event:

1. The entity is removed from the `disabled_entities` set.
2. The entity's attribute state remains at its frozen values from before disabling.
3. The State Projection resumes full processing of `state_reported` events for this entity (value comparison and `state_changed` derivation).
4. The next `state_reported` event that arrives is compared against the frozen canonical state. If the value differs (likely, if the device continued operating while the entity was disabled), a `state_changed` event is produced. If the value matches, only `lastReported` and `lastUpdated` are updated.

The State Store does not replay events that were produced during the disabled period. Those events are in the log and are available for historical queries, but the State Projection treats re-enablement as a "resume from here" operation. The rationale: replaying missed events would produce a burst of `state_changed` events for intermediate values that no longer represent current state. The first `state_reported` after re-enablement brings the entity up to date.

**REPLAY mode behavior.** During REPLAY, the State Projection does not re-derive `state_changed` events from `state_reported`. Instead, it consumes existing `state_changed` events already in the log and applies them to the in-memory view. This is consistent with Event Model §3.7's detailed specification (the authoritative text) and prevents duplicate derived events in the log. The Event Model §3.7 processing modes table should be read in conjunction with its detailed prose — the prose governs where the table is ambiguous.

**Tradeoff acknowledged:** Between disable and re-enable, the entity shows stale attribute values but current freshness timestamps. A dashboard displaying this entity can show the frozen value alongside a `lastReported` that indicates the device is still communicating. The entity registry's `enabled` field (see **Device Model & Capability System** §3.3) is the signal for the UI to indicate that the displayed state values may be stale.

---

## 4. Data Model

### 4.1 EntityState Record

The `EntityState` record is the unit of state stored for each entity in the in-memory view. Every field is derived from events — no field contains information that cannot be reconstructed by replaying the entity's event stream.

```java
public record EntityState(
    EntityRef entityRef,
    Map<String, AttributeValue> attributes,
    Availability availability,
    long stateVersion,
    Instant lastChanged,
    Instant lastUpdated,
    Instant lastReported
) {}
```

| Field | Type | Derived From | Description |
|---|---|---|---|
| `entityRef` | `EntityRef` (ULID wrapper) | Entity adoption event | The entity this state belongs to. Immutable for the lifetime of the record. |
| `attributes` | `Map<String, AttributeValue>` | `state_changed` events | Current value of each attribute, keyed by `attribute_key`. Attribute mutations are applied exclusively from `state_changed` events — never directly from `state_reported`. The `AttributeValue` type is defined by the Device Model's attribute type system (see **Device Model & Capability System** §3.5). Null values indicate an attribute that exists in the capability schema but has never received a report. |
| `availability` | `Availability` enum | `availability_changed` events | One of `AVAILABLE`, `UNAVAILABLE`, `UNKNOWN`. Initialized to `UNKNOWN` at adoption. |
| `stateVersion` | `long` | `subject_sequence` of last processed event | The `subject_sequence` from the most recent event processed for this entity, regardless of whether the event mutated state. This is the idempotency cursor: if an incoming event's `subject_sequence` is ≤ `stateVersion`, it is a duplicate and is skipped (see Glossary §3.12). Tracking processing rather than just mutations ensures that non-mutating events (e.g., a `state_reported` that matches canonical state) are correctly deduplicated on redelivery. |
| `lastChanged` | `Instant` | `state_changed` or `availability_changed` event timestamp | The `event_time` (falling back to `ingest_time` if `event_time` is null) of the most recent event that altered an attribute value or availability. Updated only when state actually changes. |
| `lastUpdated` | `Instant` | Any processed event's timestamp | The `event_time` (falling back to `ingest_time`) of the most recent event processed for this entity, including events that did not alter state (e.g., a `state_reported` whose value matched canonical state). |
| `lastReported` | `Instant` | `state_reported` event timestamp | The `event_time` (falling back to `ingest_time`) of the most recent `state_reported` event for this entity, whether or not the reported value differed from canonical state. This field answers "when did the device last send a reading?" — distinct from `lastChanged` ("when did the value last change?") and `lastUpdated` ("when did we last process any event for this entity?"). Updated even when the entity is disabled, because freshness is independent of administrative state. |

**Why `lastReported`?** Home Assistant added `last_reported` in 2024 to solve a specific diagnostic problem: a temperature sensor that reports 72°F every 5 minutes has `last_changed` hours ago (the temperature has been stable), but `last_reported` updates on every report. Without `last_reported`, determining "is this sensor still alive?" requires checking availability events or scanning the event log. With it, the answer is in the state record. `lastReported` is updated by the State Projection when it processes `state_reported` events, regardless of whether a `state_changed` event is produced and regardless of whether the entity is disabled.

### 4.2 StateSnapshot Record

The `StateSnapshot` record is the immutable point-in-time copy created by `getSnapshot()` for bulk consumers.

```java
public record StateSnapshot(
    Map<EntityRef, EntityState> states,
    long viewPosition,
    Instant snapshotTime,
    boolean replaying,
    Set<EntityRef> disabledEntities
) {}
```

| Field | Type | Description |
|---|---|---|
| `states` | `Map<EntityRef, EntityState>` | Immutable copy of all entity states at snapshot time. Includes enabled entities with active state and disabled entities with frozen attribute state. |
| `viewPosition` | `long` | The `global_position` of the last event processed at snapshot time. Monotonically increasing. |
| `snapshotTime` | `Instant` | The wall-clock time when this snapshot was created. Used for checkpoint metadata, not for state semantics. |
| `replaying` | `boolean` | `true` during startup replay, `false` after the ready signal. Included in query responses so consumers can detect catching-up state. |
| `disabledEntities` | `Set<EntityRef>` | The set of entities currently in disabled state. Maintained here so that query consumers can distinguish disabled-with-frozen-state from enabled-with-current-state without consulting the entity registry. |

### 4.3 Checkpoint Content

The checkpoint is a serialized `StateSnapshot` plus a schema version header. The State Store owns the serialization format (JSON via Jackson per LTD-08). The Persistence Layer receives the serialized byte array through the `CheckpointStore` interface and stores it opaquely — it does not interpret the content.

The checkpoint schema version is an integer that starts at 1 and increments whenever the `EntityState` record shape changes in a way that affects serialization (e.g., adding a field, changing a type). The version is written into the checkpoint JSON (§3.3) and compared against the runtime's expected version during checkpoint load.

**Checkpoint retention.** The Persistence Layer manages checkpoint retention (how many old checkpoints to keep, when to prune them). The State Store writes checkpoints; it does not manage their lifecycle on disk.

---

## 5. Contracts and Invariants

**State is consistent with the event log up to `viewPosition`.** If the State Store reports an entity's brightness as 75, there exists a `state_changed` event at or before `viewPosition` in the event log with `new_value: 75`, and no subsequent `state_changed` event for that entity and attribute has been processed. This is the materialized view consistency guarantee.

**Every attribute value traces to a `state_changed` event.** Attribute mutations are applied exclusively from `state_changed` events. In LIVE mode, the State Projection appends a `state_changed` event via `EventPublisher` (which persists durably before returning) and then applies the mutation. In REPLAY mode, the projection applies existing `state_changed` events from the log. In both modes, the attribute value entered the in-memory view via a `state_changed` event. No attribute value in the State Store exists without a corresponding `state_changed` event in the event log. This is the subsystem-level enforcement of INV-TO-03 (no hidden state). Null attribute values (capability exists, no report received) are not violations — they indicate the absence of a `state_changed` event, not the presence of an untraceable value.

**Checkpoint creation never blocks event processing.** Checkpoints are created by calling `getSnapshot()` (which copies the ConcurrentHashMap) and then serializing. The copy and serialization run without holding any lock that would block the projection subscriber. The projection subscriber continues processing events during checkpoint creation.

**Disabled entities: frozen attributes, live freshness.** An entity in the `disabledEntities` set has its attribute values frozen at the moment `entity_disabled` was processed. No `state_changed` events are produced for disabled entities. However, `lastReported` and `lastUpdated` continue to be updated from `state_reported` events, and `stateVersion` advances. This ensures freshness monitoring remains accurate regardless of administrative state. Availability is always processed. This guarantee is testable: disable an entity, produce `state_reported` events with different values, verify that `state_changed` is never produced, attribute values do not change, but `lastReported` does update.

**Idempotent processing via `stateVersion`.** `stateVersion` tracks the `subject_sequence` of the last event processed for the entity, regardless of whether that event mutated state. If an event's `subject_sequence` is less than or equal to the entity's `stateVersion`, the event is a duplicate (delivered due to at-least-once semantics) and is skipped. No state mutation occurs, no `state_changed` event is produced, no timestamps are updated. This implements the idempotency contract defined in Glossary §3.12 and ensures that non-mutating events (e.g., a `state_reported` that matched canonical state) are correctly deduplicated on redelivery.

**`lastReported` updates on every processed `state_reported`.** Even when the reported value matches canonical state, when the entity is disabled, and when no `state_changed` event is produced, `lastReported` is updated to the event's timestamp. This guarantees that `lastReported` always reflects the most recent communication from the device, providing a freshness signal independent of value changes and independent of administrative state.

**REPLAY does not produce derived events.** During REPLAY processing, the State Projection rebuilds state by consuming existing `state_changed` events from the log. It does not re-derive `state_changed` from `state_reported`. This prevents duplicate derived facts, preserves causality chain integrity, and conforms to the processing mode contract in **Event Model & Event Bus** §3.7.

**View position is monotonically increasing.** The `viewPosition` never decreases. Consumers that track `viewPosition` can rely on this for position-comparison logic (e.g., "wait until `viewPosition >= targetPosition`").

---

## 6. Failure Modes and Recovery

### 6.1 Checkpoint Corruption or Missing

**Trigger:** The checkpoint file is corrupted (invalid JSON, truncated write), missing (first boot, manual deletion), or has a schema version mismatch (software upgrade).

**Impact:** Startup takes longer because the State Store must replay from the event log's beginning instead of from the checkpoint position.

**Recovery:** Automatic. The State Store falls back to full replay from position 0. At 1.5 million events and > 10,000 events/sec replay, this takes approximately 150 seconds. The system is functional during replay (queries return partial state with `replaying: true`). A new checkpoint is written once replay completes.

**Events produced:** `system_checkpoint_invalid` (NORMAL) recording the reason (corruption, schema mismatch, or missing), the expected schema version, and the found schema version if applicable.

### 6.2 State Store Subscriber Falling Behind

**Trigger:** Event production rate temporarily exceeds the State Projection's processing rate (event storm during mesh recovery, large automation cascade). The subscriber's checkpoint falls behind the log head by more than the configurable threshold (default: 5,000 events).

**Impact:** State queries return stale data. The `viewPosition` in query responses lags the log head. The Event Bus produces a `subscriber_falling_behind` event (NORMAL, see **Event Model & Event Bus** §4.3). Because the State Projection's subscription has coalescing disabled (§3.2), the subscriber processes every `state_reported` event individually and catches up at its native processing rate without shortcuts.

**Recovery:** Automatic. The subscriber catches up as the event production rate returns to normal. With coalescing disabled, no intermediate `state_reported` events are skipped, ensuring complete `state_changed` derivation. The staleness gap closes without manual intervention.

**Events produced:** `subscriber_falling_behind` (NORMAL) by the Event Bus. The State Store does not produce its own event for this condition.

### 6.3 Out-of-Memory During State Growth

**Trigger:** The number of entities or the size of attribute values exceeds the JVM heap budget allocated for the State Store. Theoretically possible if an integration produces entities without bound or if attribute values are unexpectedly large.

**Impact:** JVM heap pressure increases, GC pauses lengthen, and eventually an `OutOfMemoryError` terminates the process.

**Recovery:** The system relies on bounded entity count (INV-PR-04 architectural constraint: system must accommodate 1,000 devices but is not required to accommodate unbounded growth). JFR continuous recording (LTD-15) captures heap allocation trends for post-mortem analysis. On restart, the system recovers from checkpoint + replay normally.

**Mitigation:** The State Store monitors heap contribution via the `hs_state_store_memory_bytes` gauge (§11.1). If the entity count exceeds the configured maximum (default: 5,000 entities, configurable), the State Store logs a warning and stops accepting new entity state until existing entities are removed. This is a defensive bound, not a normal operating condition.

**Events produced:** If the entity count limit is reached, `system_storage_critical` (CRITICAL). On process restart after OOM, `system_started` (CRITICAL) with the `restart_reason: oom_kill` metadata.

### 6.4 Event Log Gap During Replay

**Trigger:** During replay, the subscriber encounters a gap in an entity's `subject_sequence` — the expected next sequence number is not present in the event log. This indicates data loss in the event log, which is a system integrity failure (see Glossary §3.3 and **Event Model & Event Bus** §5).

**Impact:** The entity's state may be incorrect because one or more events are missing. The State Store cannot know what the missing event contained.

**Recovery:** The State Store flags the affected entity as having `integrity: degraded` in its `EntityState` metadata. It continues processing subsequent events for that entity, but the state is potentially stale. The system produces a `system_integrity_failure` (CRITICAL) event identifying the entity, the expected sequence, and the gap size. The observability UI surfaces this as a critical health indicator requiring investigation.

No automatic remediation exists for event log gaps. The operator must investigate the cause (disk corruption, software bug, backup restoration from an older snapshot) and may need to manually reset the entity's state or reintegrate the device.

**Events produced:** `system_integrity_failure` (CRITICAL).

### 6.5 Entity Registry Unavailable During Startup

**Trigger:** The State Projection needs to process `availability_changed` events with device subjects during startup, but the entity registry has not finished rebuilding.

**Impact:** Device-to-entity resolution fails. The State Store cannot determine which entities belong to the device.

**Recovery:** The startup sequence (§3.6) enforces ordering: the entity registry must complete its rebuild before the State Projection begins processing. If the registry is still rebuilding, device-subject `availability_changed` events are buffered until the registry signals readiness. Entity-subject events can be processed immediately (no registry lookup needed for direct entity references).

**Events produced:** None specific to this condition. The startup sequencing prevents it from occurring during normal operation.

---

## 7. Interaction with Other Subsystems

| Subsystem | Direction | Mechanism | Data | Constraints |
|---|---|---|---|---|
| Event Model & Event Bus | Receives from | Event subscription (`state_projection` subscriber) | `state_reported`, `state_changed`, `availability_changed`, `entity_enabled`, `entity_disabled`, `entity_profile_changed`, `entity_transferred` events | Subscription filter defined in §3.2. Coalescing disabled (like Pending Command Ledger). |
| Event Model & Event Bus | Produces to (LIVE mode only) | `EventPublisher.publish()` | `state_changed` events | Producer boundary: State Projection is the sole producer of `state_changed` (Event Model §3.1). Not produced during REPLAY. |
| Device Model & Capability System | Queries | `EntityRegistry` read interface | Entity-to-device mapping (for device-subject `availability_changed` resolution), entity `enabled` status, capability schemas (for attribute initialization on `entity_profile_changed`) | Registry must be available before State Projection processes device-subject events. |
| Persistence Layer | Delegates to | `CheckpointStore` interface (§8.3) | Serialized checkpoint byte array, `view_position`, `view_name` | Persistence Layer stores and retrieves checkpoint data opaquely. |
| REST API | Called by | `StateQueryService` interface (§8.1) | Entity states, `viewPosition`, `replaying` flag | API Layer may combine with entity registry data for filtered queries. |
| WebSocket API | Called by | `StateQueryService` interface (§8.1) | Same as REST API, plus the WebSocket API subscribes to state changes for push notifications | WebSocket API subscribes to `state_changed` events on the Event Bus, not to the State Store directly. |
| Automation Engine | Called by | `StateQueryService` interface (§8.1) | Entity state for trigger evaluation and condition checking. Batch lookups for multi-entity automation conditions. | Automation Engine evaluates against `state_changed` events (subscribed via Event Bus) and uses State Store for initial state load and condition queries. |
| Observability & Debugging | Called by | Metrics, health indicator | State Store health status, memory usage, checkpoint age, view position lag | Health indicator defined in §11.3. |

---

## 8. Key Interfaces

### 8.1 StateQueryService

The primary read interface for all state consumers. Returns immutable data.

```java
public interface StateQueryService {

    /**
     * Returns the current state of a single entity, or empty if the
     * entity has no state (never received a report, or not tracked).
     * Lock-free: reads directly from ConcurrentHashMap.
     */
    Optional<EntityState> getState(EntityRef entityRef);

    /**
     * Returns the current state of multiple entities. Entities not
     * found in the view are absent from the result map.
     * Weakly consistent across entities: each entity read is
     * individually consistent, but the batch may span a small
     * window of event processing.
     */
    Map<EntityRef, EntityState> getStates(Set<EntityRef> entityRefs);

    /**
     * Returns a point-in-time consistent snapshot: all entity states,
     * view position, replay status, and disabled entity set. Creates
     * an immutable copy of the state map — O(N) cost. Used by the
     * REST API for bulk entity listing and by the WebSocket API for
     * initial state sync. Not intended for high-frequency polling.
     */
    StateSnapshot getSnapshot();

    /**
     * Returns the view position — the global_position of the last
     * event processed. Lightweight alternative to getSnapshot() when
     * only position information is needed (e.g., for read-after-write
     * position comparison).
     */
    long getViewPosition();

    /**
     * Returns true if the State Store has completed startup replay and
     * is processing events in LIVE mode.
     */
    boolean isReady();
}
```

All methods are non-blocking. `getState()` and `getStates()` read from the `ConcurrentHashMap` with no locking. `getSnapshot()` creates an immutable map copy, which is more expensive but guarantees cross-entity consistency.

**Filtered queries.** The `StateQueryService` does not support filtered queries (by area, label, type, capability). These queries combine state data with structural metadata from the entity registry. The API Layer (doc 09) is responsible for this join:

```java
// Example: "all entities in area X that are on"
// Performed by the REST API handler, not by the State Store
Set<EntityRef> areaEntities = entityRegistry.getEntitiesByArea(areaRef);
Map<EntityRef, EntityState> states = stateQueryService.getStates(areaEntities);
List<EntityState> onEntities = states.values().stream()
    .filter(s -> Boolean.TRUE.equals(s.attributes().get("on_off").value()))
    .toList();
```

This design keeps the State Store free of secondary indexes and prevents it from duplicating the entity registry's structural knowledge.

### 8.2 StateStoreLifecycle

The lifecycle interface consumed by the Startup & Lifecycle subsystem (doc 12).

```java
public interface StateStoreLifecycle {

    /**
     * Starts the State Store: loads checkpoint, begins replay, returns
     * a future that completes when replay is finished and the view is
     * current.
     */
    CompletableFuture<Void> start();

    /**
     * Writes a final checkpoint and stops the projection subscriber.
     * Called during graceful shutdown.
     */
    void stop();
}
```

### 8.3 CheckpointStore (consumed, not owned)

The State Store depends on this interface, which is implemented by the Persistence Layer (doc 04).

```java
public interface CheckpointStore {

    /**
     * Writes a checkpoint for the named view.
     *
     * @param viewName   stable identifier (e.g., "entity_state")
     * @param position   the global_position at checkpoint time
     * @param data       opaque serialized checkpoint content
     */
    void writeCheckpoint(String viewName, long position, byte[] data);

    /**
     * Reads the most recent checkpoint for the named view.
     * Returns empty if no checkpoint exists.
     */
    Optional<CheckpointRecord> readLatestCheckpoint(String viewName);
}

public record CheckpointRecord(
    String viewName,
    long position,
    byte[] data,
    Instant writtenAt
) {}
```

The `viewName` parameter supports multiple materialized views sharing the same checkpoint infrastructure. The State Store uses `"entity_state"` as its view name. Future projections (automation history, energy analytics) would use different view names.

---

## 9. Configuration

```yaml
state_store:
  # Checkpoint behavior
  checkpoint:
    interval_minutes: 5            # Time-based checkpoint trigger
    event_threshold: 1000          # Event-count-based checkpoint trigger
    min_interval_seconds: 30       # Minimum spacing between checkpoints (storm protection)
    schema_version: 1              # Current EntityState schema version

  # Defensive bounds
  max_entity_count: 5000           # Warn and stop accepting new entities above this count

  # Startup behavior
  accept_stale_during_replay: true # Whether to serve stale checkpoint data during replay
                                   # If false, getSnapshot() returns empty during replay

  # Monitoring thresholds
  staleness_warning_ms: 5000       # Emit warning if viewPosition lags log head by more than this
```

All options have sensible defaults. HomeSynapse runs correctly with zero configuration for this subsystem (INV-CE-02). The `schema_version` field is managed by the build, not by the user — it is included in the configuration schema for transparency and for the checkpoint invalidation logic (§3.3), but is not user-configurable.

---

## 10. Performance Targets

All targets are specified for the primary deployment target: Raspberry Pi 5, 4 GB RAM, NVMe SSD storage, running the JVM configuration in LTD-01.

| Metric | Target (RPi4 4GB) | Rationale | Test Method |
|---|---|---|---|
| State query latency, single entity (p99) | < 1 ms | ConcurrentHashMap get + immutable record read. Must be effectively free. Constitutional target INV-PR-02 sets < 10 ms for state queries; this subsystem's contribution is a fraction of that budget. | Benchmark: 10,000 sequential `getState()` calls against a populated view, measure p99. |
| State query latency, full snapshot (p99) | < 5 ms | Creates an immutable copy of the map — O(N) at 150 entities. The 5 ms budget accounts for map copy overhead and GC jitter. Matches the MVP project document's state query target (§8.2). | Benchmark: 10,000 sequential `getSnapshot()` calls, measure p99. |
| State query latency, batch of 50 entities (p99) | < 2 ms | Automation Engine evaluating a multi-entity condition. 50 CHM lookups. | Benchmark: 10,000 sequential `getStates(50)` calls, measure p99. |
| Event processing throughput (sustained) | > 500 events/sec | The State Projection must keep pace with the Event Bus's sustained throughput target (**Event Model & Event Bus** §10). Falling behind triggers the `subscriber_falling_behind` alert. | Benchmark: sustain 500 `state_reported` events/sec for 60 seconds, verify `viewPosition` keeps pace with log head. |
| State change derivation latency (p99) | < 2 ms | The time from receiving a `state_reported` event to publishing the derived `state_changed` event (LIVE mode only). This is the State Projection's contribution to the subscriber notification latency budget (< 5 ms, Event Model §10). | Benchmark: measure time between `state_reported` delivery and `state_changed` append for 10,000 events. |
| Checkpoint write duration (p99) | < 500 ms | Map copy + serialization of the state at MVP scale (75 KB). Well within the 2-second checkpoint write budget (INV-PR-02 operational budget). The budget is for copy + serialization only — SQLite write latency is the Persistence Layer's responsibility. | Benchmark: create snapshot and serialize a 150-entity state 1,000 times, measure p99. |
| Startup from checkpoint (replay < 1,000 events) | < 1 second | Normal startup with a recent checkpoint. Checkpoint load + replay of ~1,000 events at > 10,000 events/sec. | Benchmark: start with a checkpoint 1,000 events behind, measure time to ready signal. |
| Memory usage (50 devices, ~150 entities) | < 10 MB | EntityState records in ConcurrentHashMap + overhead. Must not contribute meaningfully to the 512 MB steady-state budget (INV-PR-02). | Profile: measure heap contribution of the State Store under load using JFR. |
| Memory usage (1,000 devices, ~3,000 entities) | < 100 MB | Linear scaling from MVP. At 3,000 entities × ~500 bytes per EntityState + CHM overhead. | Profile: measure heap contribution at scale target using JFR. |

---

## 11. Observability

### 11.1 Metrics

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `hs_state_store_view_position` | Gauge | — | The `global_position` of the last event processed. Compared against `hs_events_appended_total` to detect lag. |
| `hs_state_store_entity_count` | Gauge | `status` (`enabled`, `disabled`) | Number of entities in the state view, split by enabled/disabled status. |
| `hs_state_store_memory_bytes` | Gauge | — | Estimated heap contribution of the State Store (entity states + map overhead). Sampled from JFR allocation data. |
| `hs_state_store_events_processed_total` | Counter | `event_type` | Total events processed by the State Projection, labeled by event type. |
| `hs_state_store_state_changes_produced_total` | Counter | — | Total `state_changed` events produced (LIVE mode only). The ratio of `state_changed` to `state_reported` processed indicates the "novelty rate" — how often device reports carry new information. |
| `hs_state_store_checkpoint_duration_ms` | Histogram | — | Duration of checkpoint creation (map copy + serialization, not including the Persistence Layer's write time). |
| `hs_state_store_checkpoint_size_bytes` | Gauge | — | Size of the most recent serialized checkpoint. Tracks growth over time. |
| `hs_state_store_replay_progress` | Gauge | — | During startup replay, the fraction of events replayed (0.0 to 1.0). Set to 1.0 after replay completes. |
| `hs_state_store_query_latency_ms` | Histogram | `operation` (`get_state`, `get_states`, `get_snapshot`) | Query latency distribution, labeled by operation type. |
| `hs_state_store_stale_entities` | Gauge | — | Number of enabled entities whose `lastReported` is older than the staleness warning threshold. Indicates devices that have stopped communicating. Counts only enabled entities — disabled entities with stale `lastReported` are expected if the device is truly offline. |

### 11.2 Structured Logging

| Log Event | Level | Fields | Description |
|---|---|---|---|
| `state_store.started` | INFO | `checkpoint_position`, `replay_events_count`, `replay_duration_ms` | Emitted after startup replay completes and LIVE mode begins. |
| `state_store.checkpoint_written` | DEBUG | `position`, `entity_count`, `size_bytes`, `duration_ms` | Emitted after each successful checkpoint write. |
| `state_store.checkpoint_invalid` | WARN | `reason`, `expected_version`, `found_version` | Emitted when a checkpoint is discarded during startup. |
| `state_store.entity_disabled` | INFO | `entity_ref`, `frozen_state_version` | Emitted when an entity is disabled and its attribute state frozen. |
| `state_store.entity_enabled` | INFO | `entity_ref`, `resume_state_version` | Emitted when an entity is re-enabled. |
| `state_store.integrity_gap` | ERROR | `entity_ref`, `expected_sequence`, `found_sequence`, `gap_size` | Emitted when a sequence gap is detected during replay. |
| `state_store.entity_limit_reached` | WARN | `current_count`, `max_count` | Emitted when the entity count defensive bound is reached. |
| `state_store.mode_transition` | INFO | `from_mode`, `to_mode`, `position` | Emitted when the subscriber transitions from REPLAY to LIVE. |

All log entries are structured JSON with JFR correlation (LTD-15) and include the `subscriber_id: state_projection` field for filtering.

### 11.3 Health Indicator

The State Store reports one of four health states:

| State | Condition | Description |
|---|---|---|
| `HEALTHY` | Replay complete, `viewPosition` within staleness threshold of log head, no integrity gaps. | Normal operation. |
| `STARTING` | Startup replay in progress. | The State Store is catching up. Queries may return stale data. |
| `DEGRADED` | `viewPosition` lags log head by more than `staleness_warning_ms`, or one or more entities have `integrity: degraded` due to sequence gaps. | The State Store is functional but not current. Investigation recommended. |
| `UNHEALTHY` | Entity count limit reached, or persistent inability to keep pace with event production (subscriber continually falling behind). | The State Store cannot serve reliable data. Operator intervention required. |

The health state is reported via the system health API (see **Observability & Debugging** doc 11) and is visible in the dashboard's system status panel.

---

## 12. Security Considerations

This subsystem has no direct external interface. All access to the state view flows through the REST API (doc 09) and WebSocket API (doc 10), which enforce authentication and authorization per INV-SE-02 and INV-SE-04. The State Store does not make trust decisions — it processes events from the Event Bus, which are already persisted and validated.

The state view may contain attribute values that are privacy-sensitive (presence state, lock status, camera activity indicators). The State Store does not apply per-attribute access control; that responsibility belongs to the API Layer, which filters state responses based on the authenticated user's permissions. The State Store provides the complete state to internal consumers and trusts the API Layer to enforce visibility boundaries.

---

## 13. Testing Strategy

### 13.1 Unit Tests

- **LIVE mode state mutation per event type:** For each event type in the LIVE mode processing dispatch table (§3.2), verify that the correct fields on `EntityState` are updated and that the correct derived events (if any) are produced. Test: `state_reported` with differing value → `state_changed` appended first, then attributes updated from the `state_changed` payload, `lastChanged`/`lastUpdated`/`lastReported` updated, `stateVersion` advanced. `state_reported` with matching value → no `state_changed`, `lastReported`/`lastUpdated` updated, `lastChanged` unchanged, `stateVersion` still advanced. `availability_changed` → availability field updated, `stateVersion` advanced. `entity_profile_changed` with added capability → new attributes initialized to null, `stateVersion` advanced. `entity_profile_changed` with removed capability → attributes removed, `stateVersion` advanced.
- **REPLAY mode state rebuild:** Populate an event log with a sequence of `state_reported` and `state_changed` events. Process them in REPLAY mode. Verify: state is rebuilt from `state_changed` events only (not re-derived from `state_reported`). Verify: no new `state_changed` events are appended to the log during replay. Verify: `lastReported` is updated from `state_reported` events.
- **REPLAY to LIVE transition:** Replay a sequence of events, then transition to LIVE mode. Produce a new `state_reported` with a different value. Verify: a `state_changed` event is now produced (LIVE mode behavior restored).
- **Idempotency.** Deliver the same event twice (same `subject_sequence`). Verify: no state mutation on the second delivery, no `state_changed` produced, no timestamps updated.
- **stateVersion advances on non-mutating events.** Deliver a `state_reported` with a value that matches canonical state. Verify: `stateVersion` is advanced to the event's `subject_sequence`. Deliver the same event again. Verify: it is correctly detected as a duplicate.
- **Disabled entity contract.** Disable an entity. Deliver `state_reported` events with different values. Verify: no `state_changed` produced, attributes unchanged, but `lastReported` and `lastUpdated` are updated and `stateVersion` is advanced. Enable the entity. Deliver a `state_reported` with a new value. Verify: `state_changed` produced, attributes updated.
- **Availability for disabled entities.** Disable an entity. Deliver `availability_changed` to `UNAVAILABLE`. Verify: availability updated to `UNAVAILABLE` (availability is processed even for disabled entities).
- **Self-produced `state_changed` skipped in LIVE mode.** In LIVE mode, produce a `state_reported` that triggers a `state_changed`. When the `state_changed` is delivered back to the subscriber, verify it is skipped (not double-applied).
- **Checkpoint serialization round-trip.** Serialize a `StateSnapshot` to JSON. Deserialize it. Verify: all fields match, including `disabledEntities`, all `EntityState` records, and all attribute values with correct types.
- **Checkpoint schema version mismatch.** Attempt to load a checkpoint with a different `schema_version`. Verify: checkpoint is rejected, startup falls through to full replay.

### 13.2 Integration Tests

- **End-to-end state projection.** Produce `state_reported` events via an integration adapter. Verify: `state_changed` events appear in the event log with correct `triggered_by` references. Query the State Store via `StateQueryService`. Verify: attribute values match the most recent `state_changed`.
- **Checkpoint recovery.** Populate state with 100 entities, write a checkpoint, append 500 more events, restart the process. Verify: state after restart matches state before restart. Verify: replay consumed existing `state_changed` events without producing new ones.
- **Full replay (no checkpoint).** Populate state with 100 entities and 10,000 events. Delete the checkpoint. Restart. Verify: state after replay matches state before restart. Verify: no new `state_changed` events were appended during replay.
- **Disabled entity across restart.** Disable an entity. Write a checkpoint. Restart. Verify: entity is still disabled after restart. Produce `state_reported` events. Verify: no `state_changed` produced, but `lastReported` is updated.
- **Device-subject availability resolution.** Produce an `availability_changed` event with a device subject. Verify: all entities belonging to that device have their availability updated.
- **Concurrent read/write.** Spawn 10 reader threads performing continuous `getState()` and `getSnapshot()` calls. Spawn a writer producing 500 events/sec. Verify: no exceptions, no torn reads, all per-entity reads are consistent.

### 13.3 Performance Tests

- **Query latency benchmarks.** Populate 150 entities. Measure p99 latency for `getState()`, `getStates(50)`, and `getSnapshot()` over 10,000 calls. Verify: within targets (§10).
- **Event processing throughput.** Sustain 500 `state_reported` events/sec for 60 seconds. Verify: `viewPosition` keeps pace with the log head (lag < 100 events). Repeat at 1,000 events/sec on RPi5 hardware.
- **GC pressure under load.** Sustain 500 events/sec for 300 seconds (150,000 events). Monitor GC pause times via JFR. Verify: no G1GC pauses > 200 ms. Monitor young-gen allocation rate and verify it stabilizes (no memory leak).
- **Checkpoint serialization at scale.** Populate 3,000 entities. Create snapshot and serialize. Verify: total duration < 2 seconds, size < 5 MB.
- **Startup time with checkpoint.** Create a checkpoint, append 1,000 events, restart. Measure time from process start to ready signal. Verify: < 1 second for the State Store's contribution.
- **Full replay at scale.** Populate 1.5 million events (simulating one year, 50 devices). Delete checkpoint. Measure full replay time. Verify: < 180 seconds (> 10,000 events/sec effective throughput).

### 13.4 Failure Tests

- **Checkpoint corruption recovery.** Write a checkpoint. Corrupt the checkpoint data (truncate, invalid JSON, flip bytes). Restart. Verify: system detects corruption, logs `state_store.checkpoint_invalid`, falls through to full replay, reaches correct state.
- **Sequence gap detection.** During replay, introduce a gap in an entity's `subject_sequence` (delete an event from the test database). Verify: system logs `state_store.integrity_gap`, flags the entity as `integrity: degraded`, produces `system_integrity_failure` event, continues processing remaining events.
- **Entity count limit.** Configure `max_entity_count: 10`. Adopt 15 entities. Verify: the 11th entity triggers a warning log, state is not tracked for entities beyond the limit, system remains functional for the first 10 entities.
- **Subscriber restart after crash.** Process 5,000 events, kill the process mid-event (simulate SIGKILL). Restart. Verify: state is consistent (no partial mutations), replay does not produce duplicate `state_changed` events, checkpoint + replay produces correct state.
- **Checkpoint minimum spacing under storm.** Sustain 500 events/sec. Verify: checkpoints are not written more frequently than `min_interval_seconds` (30s default), even though the event_threshold (1,000) is reached every 2 seconds.

---

## 14. Future Considerations

**Time-bucketed history projection.** The MVP serves historical state queries ("what was the temperature at 3 AM?") by scanning `state_changed` events in the event log using the `idx_events_subject` and `idx_events_ingest_time` indexes. At MVP scale (50 devices, ~100K `state_changed` events per 90-day NORMAL retention), indexed scans return results in single-digit milliseconds on NVMe storage.

Home Assistant's experience validates that this approach has limits. HA's original architecture scanned raw state records for history graph rendering. At modest entity counts with 10-day retention, users reported 30–40 second load times — leading HA to introduce 5-minute short-term statistics and hourly long-term statistics as pre-aggregated summaries. HA's performance problems were compounded by SD card I/O, lack of proper indexing, and SQLite's single-writer contention under concurrent dashboard loads. HomeSynapse avoids the worst of these factors (NVMe storage per LTD-02, proper indexes, WAL mode for concurrent reads), but the underlying scaling challenge remains: as entity count and retention period grow, graph rendering that scans raw events becomes impractical.

If history graph latency exceeds 100 ms for a single-entity, 24-hour graph on RPi4 hardware, introduce a time-bucketed summary projection as a new materialized view subscriber. The projection would consume `state_changed` events and maintain 5-minute summary records (min, max, mean for numeric attributes; time-in-state for discrete attributes) in a dedicated SQLite table. The `view_name` model (Glossary §3.5) and the `CheckpointStore` interface (§8.3) already support additional materialized views without architectural change. The event log remains the authoritative source; the summary projection is a read optimization.

**Distributed state replication.** MVP runs as a single instance. Future versions may support active-passive replication for high availability. The State Store's checkpoint format is designed to be transferable — a checkpoint can be shipped to another instance and used as a starting point for replay. The checkpoint JSON format deliberately avoids instance-specific references (no host identifiers, no absolute file paths, no thread-local state). This is not implemented in MVP, but the checkpoint schema accommodates it.

**Per-attribute change tracking.** The current `lastChanged` field tracks the most recent change to any attribute on the entity. Some dashboard use cases benefit from per-attribute `lastChanged` (e.g., "temperature was last updated 5 minutes ago but humidity was last updated 2 hours ago"). This can be added by extending the `AttributeValue` wrapper to include a `changedAt` timestamp, populated from the `state_changed` event's `event_time`. The `EntityState` record shape would not change (the map value type would be extended), but the checkpoint schema version would increment, triggering a rebuild on upgrade.

---

## 15. Open Questions

1. **[RESOLVED] Should the State Store maintain state for entities that have been removed (via `device_removed`)?**
   **Resolution:** Device removal cascade behavior is now specified in **Device Model & Capability System** §3.14 (Device Removal Cascade). On device removal, all owned Entities are soft-deleted. The State Projection processes `entity_deleted` events by setting `availability: unavailable` on each affected EntityState. The `lastReported` timestamp is preserved. During the soft-delete retention window, restoration reverses these changes. After purge, the EntityState entry is removed from the in-memory map during the next checkpoint cycle.

2. **Should `entity_profile_changed` trigger re-validation of existing attribute values?**
   When a capability profile changes (e.g., a firmware update narrows the valid range of a brightness attribute from 0–100 to 0–75), existing attribute values in the State Store may now be outside the valid range. Should the State Store re-validate existing values against the new schema and mark invalid ones?
   Options: (a) Yes — on `entity_profile_changed`, re-validate all attributes of affected capabilities and produce `state_report_rejected` events for values that no longer conform. (b) No — existing values are retained as-is; the next `state_reported` event will be validated against the new schema.
   Needed: Clarity on whether this is a realistic scenario at MVP scale and whether it introduces unacceptable complexity.
   Status: **[NON-BLOCKING]** — option (b) is safe and simple. The state may show a technically invalid value until the next report, but the system remains consistent.

3. **Should the Event Model's processing mode table (§3.7) be amended to resolve its internal contradiction on REPLAY behavior?**
   The Event Model §3.7 contains a table that says REPLAY: "Derived Events: Emitted (projections need them in the log)." The detailed text immediately following the table says: "Replay does not produce new derived events... The State Projection does not re-emit `state_changed` events during replay." This State Store document follows the detailed text (which is more explicit, more recent in the document, and more correct from an event-sourcing perspective). However, the table should be amended to avoid confusion for future subsystem authors.
   Status: **[NON-BLOCKING]** — this State Store document is consistent with the authoritative detailed text. The table amendment is a housekeeping item for the Event Model doc.

---

## 16. Summary of Key Decisions

| Decision | Choice | Rationale | Section |
|---|---|---|---|
| Projection architecture | Single projection, single subscriber (`state_projection`) | Composite queries join state with registry data at the caller. Multiple projections add subscriber count, checkpoint complexity, and coordination overhead for no MVP gain. (Principle: "current state is a thin layer") | §3.1 |
| In-memory data structure | `ConcurrentHashMap<EntityRef, EntityState>` with immutable records, no secondary indexes | Per-entity reads are lock-free and consistent. Cross-entity snapshot via `getSnapshot()` only when needed. Linear scan is sub-millisecond at 3,000 entities. Secondary indexes add mutation complexity for query patterns that don't need them at MVP scale. (Principle: "reads must never block writes") | §3.5, §8.1 |
| REPLAY behavior | Consume existing `state_changed`, do not re-derive | Conforms to Event Model §3.7 detailed specification. Prevents duplicate derived facts, preserves causality chain integrity. LIVE mode produces `state_changed` from `state_reported`; REPLAY mode rebuilds from existing `state_changed`. (Principle: "attribute state applied from `state_changed`") | §3.2, §3.6 |
| Coalescing | Disabled for State Projection subscription | Same rationale as Pending Command Ledger exemption (Event Model §3.6): the State Projection is a correctness-critical subscriber. Coalesced `state_reported` events would create gaps in the `state_changed` event log. (Principle: "attribute state applied from `state_changed`") | §3.2 |
| stateVersion semantics | Advances on every processed event, not just mutations | Idempotency cursor must track processing, not just mutations. A non-mutating `state_reported` must be recognized as a duplicate on redelivery. Classic event-sourcing pattern. | §3.2, §4.1, §5 |
| State mutation source | Attributes updated from `state_changed` events, not directly from `state_reported` | Makes the "every attribute traces to `state_changed`" invariant mechanically true. In LIVE mode: compare, append `state_changed`, then apply. In REPLAY: consume existing `state_changed`. (Principle: "attribute state applied from `state_changed`") | §3.2, §5 |
| Historical state queries | Event log scan, not a dedicated projection | The event log's `idx_events_subject` and `idx_events_ingest_time` indexes serve historical queries at MVP scale. A dedicated history projection is deferred until latency exceeds 100 ms on RPi4. (Principle: "current state is a thin layer") | §2.2, §14 |
| Checkpoint strategy | Full snapshot, triggered by 5-min interval OR 1,000-event count, with 30-second minimum spacing | At MVP scale, full snapshot is 30–75 KB. Minimum spacing prevents checkpoint churn during storms (would otherwise checkpoint every 2 seconds at 500 events/sec). | §3.3 |
| Consistency model | `viewPosition` on all responses, no blocking reads | Staleness is visible to consumers via position tracking. Blocking reads add complexity for a lag that is typically < 10 ms. Consumers that need read-after-write can poll with position comparison. (Principle: "staleness is visible, not hidden") | §5, §8.1 |
| Availability modeling | Parallel field on EntityState, not a special attribute | Availability has different semantics (three-value enum, derived from `availability_changed`, not from `state_reported → state_changed` pipeline). Making it a regular attribute would require fake capability schemas. | §4.1 |
| Entity scope | Entity-only for MVP | Device metadata → registry. Automation state → Automation Engine projection. Person presence → future projection. Keeping scope tight prevents the State Store from becoming a catch-all data store. (Principle: "entity registry is the structural authority") | §2.2 |
| Disabled entity behavior | Freeze attributes, continue freshness tracking, do not replay on re-enable | Attributes frozen, but `lastReported`/`lastUpdated` continue updating from `state_reported` to preserve diagnostic freshness signal. Replaying missed events would produce stale `state_changed` burst. "Wait for next report" is simpler and consistent. | §3.7 |
| `lastReported` field | Include on EntityState, update even when disabled | Answers "is this sensor still alive?" without scanning the event log. Updated regardless of administrative state to avoid ambiguous staleness signal. | §4.1 |
| Startup behavior during replay | Serve stale checkpoint data with `replaying: true` flag | Blocking the dashboard during replay would violate the 10-second startup target for full-replay scenarios. Stale-with-flag lets consumers make informed decisions. | §3.6 |
| State Store / Persistence Layer boundary | State Store defines what and when; Persistence Layer defines how | `CheckpointStore` interface accepts opaque byte arrays. Persistence Layer does not interpret checkpoint content. Clean separation prevents circular dependencies between docs 03 and 04. | §8.3 |

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It is governed by the Design Document Template and will be reviewed during architecture review.*