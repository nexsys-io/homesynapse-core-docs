# HomeSynapse Core — Event Model & Event Bus

**Document type:** Subsystem design
**Status:** Draft
**Subsystem:** Event Model & Event Bus
**Dependencies:** None (foundational)
**Dependents:** Device Model & Capability System (§4.3 event type taxonomy, §3.1 producer boundaries), State Store (§3.2 state event lifecycle, §3.4 subscription model), Persistence Layer (§3.3 retention tiers, §3.5 telemetry boundary, §4.2 domain event store schema, §6.5 emergency retention, §9 retention configuration), Integration Runtime (§3.1 producer boundaries, §3.9 origin model), Automation Engine (§3.2 state_changed subscription, §3.7 processing modes), Configuration System (§9 YAML schema), REST API (§4.1 event envelope, §4.3 event type taxonomy), WebSocket API (§3.4 subscription model), Observability & Debugging (§11 metrics and health), Startup, Lifecycle & Shutdown (§3.7 processing modes, §6 failure recovery)
**Author:** HomeSynapse Core Architecture
**Date:** 2026-03-04

---

## 0. Purpose

The Event Model & Event Bus subsystem defines the foundational data structure (the event), the append-only persistence mechanism (the event log), and the internal distribution mechanism (the event bus) that every other HomeSynapse subsystem depends on. It is the nervous system of the platform. Every device state change, every automation execution, every configuration modification, and every system lifecycle transition is recorded as an immutable event in the event log before any subscriber is notified of its existence.

This subsystem exists because HomeSynapse's core architectural differentiator is event sourcing — the principle that the event log is the single source of truth, and all observable state is derived from it (INV-ES-02). If the event model is imprecise, downstream subsystems inherit that imprecision. If the event bus loses or reorders events, the entire system's correctness guarantee collapses. If the persistence layer cannot sustain the event write rate on constrained hardware, the platform degrades under load. No other subsystem can compensate for failures at this layer.

The design draws on cross-platform research across eight smart home systems (Home Assistant, OpenHAB, SmartThings, Hubitat, Apple HomeKit/HAP, Matter, Eclipse Ditto, Mozilla WebThings/WoT) and four non-smart-home event-sourced architectures (Axon Framework, EventStoreDB, Marten, Eventuous). It adopts Matter's per-entity monotonic sequencing and priority tiers, OpenHAB's command/state event taxonomy (adapted to an event-sourced context), Eclipse Ditto's single-writer persistence model, and Home Assistant's causality tracking (with corrections to its known implementation gaps). The event log is not hidden infrastructure — it is a primary interface element that makes the system transparent and debuggable. Every event persisted today may serve as evidence for energy audits, insurance attestations, care monitoring, or regulatory compliance tomorrow. The event model records facts faithfully so that the full range of current and future query patterns can be served without schema redesign.

---

## 1. Design Principles

**Raw facts in, derived knowledge out.** Integrations produce raw observations. The core derives meaning. This separation ensures that a misbehaving integration cannot corrupt the system's interpretation of state — only the core's projection logic determines what "changed," what "confirmed," and what "went offline." This principle governs the entire event taxonomy and the producer boundary rules in §3.1.

**Persistence before notification.** No subscriber ever processes an event that could be lost to a crash. The write-ahead discipline (INV-ES-04, LTD-06) means the event log is always at least as current as any subscriber's state. Recovery is replay, not reconstruction. This principle governs the event bus delivery model in §3.4.

**Causality is structural, not optional.** Every event is either a root (an external stimulus with no prior event cause) or a consequence (caused by a specific prior event). The API enforces this distinction at compile time. Broken causal chains are not a runtime debugging exercise — they are prevented by the type system. This principle governs the EventPublisher interface in §8.

**Priority is a delivery and retention property, not a correctness property.** All events are persisted with identical write-ahead guarantees regardless of priority. Priority governs how long an event is retained before eligible for purging and how urgently subscribers are notified of its existence. A DIAGNOSTIC event that is purged after seven days was still persisted with the same durability guarantee as a CRITICAL event at write time. This prevents the system from silently losing events that "seemed unimportant" at write time but prove critical during forensic analysis.

**The event model does not enforce policy — it records facts.** Automation loop detection, trigger depth limits, and rate limiting are the responsibility of the subsystems that consume events (Automation Engine, Integration Runtime). The event model records what happened faithfully, including runaway loops, so that the evidence exists for diagnosis. Subsystem-level safety valves operate independently.

**Event categories support scoped access without structural change.** The event type namespace is organized so that future access-control policies can grant or restrict access to event categories (energy events, presence events, device events) without requiring event schema modifications. This accommodates the Data Sovereignty API pattern where third parties receive scoped, time-limited access to specific event categories with the homeowner's explicit consent.

---

## 2. Scope and Boundaries

### 2.1 This Subsystem Owns

- The event envelope schema — field definitions, required/optional semantics, serialization format
- The event type taxonomy — the core set of event types, their naming conventions, and the rules for integration-defined extensions
- The event priority model — tier definitions, static assignment rules, and elevation constraints
- The event origin model — the semantic enum and evidence-based assignment rules
- The causality model — correlation_id, causation_id, and actor_ref propagation rules
- The event bus — in-process publish-subscribe notification after persistence
- The subscription model — registration, filtering, checkpointing, catch-up, and gap handling
- The schema versioning model — per-type version numbering and upcaster architecture
- The processing mode model — LIVE, REPLAY, PROJECTION, and DRY_RUN semantics
- The domain event store schema — the SQLite table structure for the append-only event log
- Producer boundary rules — which components may produce which event types

### 2.2 This Subsystem Does Not Own

- Durable event persistence mechanics (WAL tuning, fsync behavior, VACUUM scheduling) — owned by the **Persistence Layer**
- State materialized views and checkpoint management — owned by the **State Store**
- Telemetry ring store schema and aggregation engine — owned by the **Persistence Layer** (this document defines the boundary; the Persistence Layer defines the implementation)
- Automation trigger evaluation and loop detection — owned by the **Automation Engine**
- Device capability definitions and command type declarations — owned by the **Device Model & Capabilities**
- Integration lifecycle and fault isolation — owned by the **Integration Runtime**
- REST/WebSocket event query API — owned by the **API Layer** (this document defines the data shapes; the API Layer defines the endpoints)
- Retention policy execution — owned by the **Persistence Layer** (this document defines priority-based eviction order; the Persistence Layer executes it)

---

## 3. Architecture

### 3.1 Event Lifecycle and Producer Boundaries

The event lifecycle follows a three-phase model: production, persistence, and distribution. The critical design rule is that production responsibilities are strictly partitioned between integrations and core services.

```
┌─────────────────────────────────────────────────────────────────┐
│                        PRODUCTION                               │
│                                                                 │
│  Integration Adapters          Core Services                    │
│  ┌──────────────────┐         ┌──────────────────────────────┐  │
│  │ state_reported    │         │ state_changed (State Proj.)  │  │
│  │ command_result    │         │ state_confirmed (Cmd Ledger) │  │
│  │ availability_     │         │ command_issued (API/Auto)    │  │
│  │   changed         │         │ command_dispatched (Dispatch)│  │
│  │ device_discovered │         │ presence_changed (Pres Proj.)│  │
│  │ presence_signal   │         │ automation_triggered (Auto)  │  │
│  └────────┬─────────┘         │ system_* (Runtime)           │  │
│           │                    └──────────────┬───────────────┘  │
│           │                                   │                  │
└───────────┼───────────────────────────────────┼──────────────────┘
            │                                   │
            ▼                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                       PERSISTENCE                               │
│                                                                 │
│  EventPublisher.publish() / publishRoot()                       │
│      │                                                          │
│      ▼                                                          │
│  SQLite WAL commit (event durable on disk)                      │
│      │                                                          │
│      ▼                                                          │
│  global_position assigned (rowid)                               │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DISTRIBUTION                               │
│                                                                 │
│  Event Bus: notify subscribers via LockSupport.unpark()         │
│      │                                                          │
│      ├──▶ State Projection (derives state_changed)              │
│      ├──▶ Pending Command Ledger (derives state_confirmed)      │
│      ├──▶ Automation Engine (evaluates triggers)                │
│      ├──▶ Presence Projection (derives presence_changed)        │
│      ├──▶ Causal Chain Projection (indexes causality)           │
│      ├──▶ WebSocket relay (pushes to connected clients)         │
│      └──▶ Observability collector (updates metrics)             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Producer boundary rules:**

Rule T1: Integration adapters produce only `state_reported` for attribute observations, `command_result` for protocol acknowledgments, `availability_changed` for reachability transitions, `device_discovered` for new device detection, and `presence_signal` for raw presence data. Integrations must not produce `state_changed`, `state_confirmed`, or any other derived event type.

Rule T2: `state_changed`, `state_confirmed`, and `command_dispatched` are emitted exclusively by core projections and services. The State Projection produces `state_changed` and `state_confirmed`. The command dispatch service produces `command_dispatched`.

Rule T3: System lifecycle events (`system_started`, `system_stopped`, `migration_applied`, `snapshot_created`, `config_changed`) are produced exclusively by the core runtime. Integrations must not produce these types.

The core runtime also produces `entity_enabled` and `entity_disabled` events when a user or automation enables or disables an entity. These are entity lifecycle events, not state events — they do not flow through the state event lifecycle (§3.2). Automations may trigger enable/disable as an action (e.g., "disable the outdoor camera entity when the privacy mode automation activates"). The enable/disable state is stored as a registry property on the entity record, not as a state attribute — it is not observable through the `state_reported` → `state_changed` pathway.

These rules ensure that interpretation is centralized. A Zigbee adapter's responsibility ends at "I observed brightness = 74% at time T." Whether that constitutes a change, confirms a pending command, or is a redundant report is the core's determination.

### 3.2 State Event Lifecycle

The state event lifecycle is a three-level model derived from OpenHAB's four-event taxonomy, adapted for event sourcing.

**Level 1 — Raw observation:**

`state_reported` is the atom. An integration observed a device attribute value. The event carries the entity reference, the attribute key, the observed value, and an optional source timestamp. It does not carry a previous value — the integration does not track or compare state. Every `state_reported` event is persisted to the domain event log regardless of whether the value changed. `state_reported` is always appended at DIAGNOSTIC priority and remains DIAGNOSTIC — even when it causes a state change. The significance of the observation is expressed through the derived `state_changed` event (NORMAL priority), which carries a `triggered_by` reference back to the causal `state_reported`. This means filtering by NORMAL priority will find state transitions (`state_changed`) but not the raw observations that caused them; consumers that need the raw observation follow the `triggered_by` reference.

**Level 2 — Derived transition:**

`state_changed` is produced by the State Projection when a `state_reported` event contains a value that differs from the canonical state for that entity and attribute. It carries `old_value`, `new_value`, and `triggered_by` — the `event_id` of the `state_reported` event that caused the transition. The automation engine subscribes to `state_changed`, not to `state_reported`. This prevents automations from firing on redundant reports.

**Level 3 — Intent closure:**

`state_confirmed` is produced by the Pending Command Ledger when a `state_reported` value matches the expected outcome of an in-flight command. It carries references to both the originating `command_issued` event and the confirming `state_reported` event. This closes the intent-to-observation loop: the user said "set brightness to 75%," the device reported "brightness = 74%," and the Pending Command Ledger determined this falls within the command's declared tolerance band. See §3.8 for the Pending Command Ledger's matching semantics.

### 3.3 Event Priority Model

Every event carries a priority tier that affects delivery urgency and retention lifetime. Priority does not affect append-time durability — all events are persisted with identical write-ahead guarantees (INV-ES-04).

Three tiers:

**CRITICAL.** Events that represent safety concerns, system integrity boundaries, or operational state transitions that must be retained for the maximum configured period. Examples: `availability_changed` (to offline), `command_result` (timeout or failure), `system_started`, `system_stopped`, `migration_applied`, `snapshot_created`, `subscriber_checkpoint_expired`. Default retention: 365 days. The event bus notifies subscribers of CRITICAL events with no coalescing under any backpressure condition.

**NORMAL.** Events that represent meaningful state transitions, successful command outcomes, and automation activity. Examples: `state_changed`, `state_confirmed`, `command_issued`, `command_result` (success), `automation_triggered`, `automation_completed`, `device_adopted`, `device_removed`, `presence_changed`, `config_changed`. Default retention: 90 days. The event bus delivers NORMAL events individually; they are never coalesced.

**DIAGNOSTIC.** Events that provide observability data for debugging and performance analysis. Examples: `state_reported` (when no change detected), `command_dispatched`, `presence_signal`, `telemetry_summary`, `subscriber_falling_behind`, `causality_depth_warning`. Default retention: 7 days. Under backpressure, the event bus may coalesce DIAGNOSTIC events per §3.6.

**Priority assignment is static by default.** Each event type in the taxonomy (§4.3) has a default priority. Integration adapters may elevate a specific event instance from DIAGNOSTIC to NORMAL — but not to CRITICAL, and never downward. This one-level elevation accommodates integrations that can detect significance at production time (for example, a Zigbee adapter may elevate a `command_dispatched` to NORMAL if the protocol exchange revealed an unusual routing condition, or elevate a `state_reported` to NORMAL if the protocol frame indicates a physical button press rather than a periodic poll). Elevation is declared per-event at production time and recorded in the persisted event. Elevation does not change the system's derivation logic — the State Projection still produces `state_changed` based on value comparison, regardless of the source event's priority.

### 3.4 Subscription Model

Subscribers are pull-based with notification. Each subscriber registers with an identifier, a filter, and an initial checkpoint. The event bus notifies subscribers when matching events exist beyond their checkpoint; subscribers then poll the event store for batches.

```
┌────────────┐    register(filter)   ┌────────────────┐
│ Subscriber │ ──────────────────▶  │   Event Bus    │
│            │                       │                │
│            │  ◀── unpark() ──────  │  (on matching  │
│            │                       │   event append)│
│            │                       └────────────────┘
│            │    readFrom(pos,n)    ┌────────────────┐
│            │ ──────────────────▶  │  Event Store   │
│            │  ◀── List<Envelope>   │                │
│            │                       └────────────────┘
│            │    write checkpoint
│            │ ──────────────────▶  checkpoint table
└────────────┘
```

**Subscriber registration:**

```java
public record SubscriptionFilter(
    Set<String> eventTypes,          // empty = all types
    EventPriority minimumPriority,   // DIAGNOSTIC = receive everything
    @Nullable String entityTypePrefix // e.g., "light" for light entities only
) {}
```

The bus maintains per-subscriber filters and only notifies a subscriber when events matching its filter have been appended. This prevents waking the automation engine for `state_reported` events that did not result in `state_changed`.

**`entity_type_prefix` filter semantics.** The `entity_type_prefix` field enables a subscriber to receive events only for entities whose `entity_type` starts with a given prefix. This is useful for subsystem-scoped subscriptions: a lighting dashboard subscribes with prefix `light` to receive events for `light` entities without processing `sensor`, `switch`, or `climate` events.

The filter operates on the `entity_type` field stored in the entity registry, not on any field within the event envelope. When the Event Bus evaluates a subscription filter, it resolves the event's `subject_ref` to its entity type via the entity registry and applies the prefix match. Events whose `subject_ref` refers to a non-entity subject (Device, Automation, Person, System) are **not matched** by entity type prefix filters — they pass through only if the filter's `entity_type_prefix` is null (meaning "all subjects").

This resolution requires that the Event Bus has read access to the entity registry, establishing a runtime dependency from the Event Bus to the Device Model's `EntityRegistry` interface (§7). The dependency is read-only and uses an in-memory cache with no write path, so it does not create a circular dependency with the Device Model's subscription to the Event Bus.

**Subscriber lifecycle:**

1. Register with `subscriberId` (stable string), `SubscriptionFilter`, and initial `lastCheckpoint` (0 for new subscribers, loaded from checkpoint store for existing ones).
2. Subscriber runs on a dedicated virtual thread (per LTD-01 / LTD-11).
3. Bus notifies via `LockSupport.unpark()` when matching events exist beyond the subscriber's checkpoint.
4. Subscriber polls: `List<EventEnvelope> batch = eventStore.readFrom(lastCheckpoint, batchSize, filter)`.
5. Subscriber processes each event, then acknowledges by writing checkpoint.
6. Checkpoint is stored in the domain event store database (same file, different table — atomic with the same SQLite connection).

**Re-entrant event production.** Core subscribers — specifically the State Projection and the Pending Command Ledger — produce derived events (`state_changed`, `state_confirmed`, `state_report_rejected`) in response to events they consume. This creates a re-entrant write path: a subscriber's event handler calls `EventPublisher.publish()`, which appends to the event store and triggers notification of other subscribers (and potentially the same subscriber, if the derived event matches its filter).

The single-writer model (LTD-03, LTD-11) serializes all writes through one thread. Re-entrant writes are safe because:

1. The producing subscriber holds no lock on the event store during its processing — it calls `publish()`, which acquires the write lock, appends, releases, and returns.
2. The derived event is assigned the next `global_position` and `subject_sequence` values, maintaining monotonicity.
3. Notification of the derived event to other subscribers happens asynchronously after the `publish()` call returns.

However, re-entrant production means a single incoming `state_reported` event may produce zero, one, or two additional events (a `state_changed` and/or a `state_confirmed`) within the same processing cycle. Throughput calculations must account for this amplification factor. At steady state with 50 devices reporting every 30 seconds, the amplification is modest (roughly 1.3× — most reports either change state or confirm commands, not both). During event storms (many simultaneous changes), the amplification approaches 2× in the worst case.

The `EventPublisher` implementation must not notify the producing subscriber synchronously about the event it just produced during the same `publish()` call. Derived events are appended to the store and picked up by subscribers in the next polling cycle. This prevents unbounded recursive chains within a single call stack.

**Delivery gap handling:**

If retention purges events that a subscriber has not yet processed, the subscriber's next poll returns a `CheckpointExpired` signal. The subscriber must:

1. Emit a `subscriber_checkpoint_expired` CRITICAL event.
2. Attempt to reinitialize from the latest snapshot (if one exists for its projection).
3. If no snapshot exists, report degraded status via the health system (§11).

This is a configuration error (retention is more aggressive than subscriber processing speed) and should be rare in practice. The system surfaces it explicitly rather than silently skipping events.

### 3.5 Telemetry Boundary

The domain event store receives all events in the §4.3 taxonomy at all priority tiers. High-frequency data sources that would overwhelm the domain event log are routed to a separate persistence path.

**Domain Event Store** (`homesynapse-events.db`): receives all events in the event envelope format. Ordering via per-entity sequences and global position. Full causality metadata. Subscriber delivery via the event bus. Retention per priority tier.

**Telemetry Ring Store** (`homesynapse-telemetry.db`): a separate SQLite database for high-frequency raw samples that would overwhelm the domain event store if treated as full events. This store is not covered by INV-ES-01 through INV-ES-05 — telemetry samples are measurements, not immutable domain events. They carry no event envelope, no sequence numbers, no causality metadata, and no subscriber delivery.

The boundary criterion: if a data source produces more than one sample per 10 seconds sustained for a single entity, it is a telemetry stream candidate. The integration adapter declares at registration time whether its data flows through the domain path or the telemetry path. A temperature sensor reporting every 30 seconds flows through the domain path as `state_reported` events. An energy monitor reporting every second flows through the telemetry path.

An aggregation engine (owned by the Persistence Layer subsystem) reads from the telemetry ring store on configurable intervals and produces domain events when meaningful thresholds are crossed. This is the only path from telemetry to domain events. Examples of promotion: a 5-minute energy consumption summary becomes a `telemetry_summary` event at DIAGNOSTIC priority; a power draw anomaly becomes a `state_changed` event at NORMAL priority.

The telemetry ring store uses a separate SQLite file to isolate its write pressure, WAL checkpoint behavior, and VACUUM lifecycle from the domain event store. Backup policy treats the domain event store as mandatory and the telemetry ring store as optional — losing telemetry means losing raw granularity within the retention window, not losing canonical state.

See **Persistence Layer** (when written) for the telemetry ring store schema, aggregation engine design, and retention execution mechanics.

### 3.6 Backpressure and Coalescing

The event bus implements backpressure to prevent subscriber overload during event storms (for example, Zigbee mesh recovery after a power outage, where dozens of devices simultaneously report state).

**Backpressure is subscriber-local.** There is no global throttle on event production — the event log accepts all events at the rate they arrive (bounded by SQLite's write throughput, which far exceeds HomeSynapse's requirements per LTD-03). Backpressure applies only to the delivery path when a subscriber falls behind.

**Coalescing rules (specific DIAGNOSTIC event types only):**

When a subscriber's unprocessed backlog exceeds a configurable threshold (default: 1,000 events), the bus may coalesce events of the following types in the subscriber's pending batch: `state_reported`, `presence_signal`, and `telemetry_summary`. These are the only coalescable event types. All other DIAGNOSTIC events (such as `command_dispatched`, `subscriber_falling_behind`, `causality_depth_warning`) are delivered individually regardless of backpressure.

Coalescing means: if multiple coalescable events for the same `(subject_ref, attribute_key)` exist in the unprocessed backlog, only the most recent one is delivered. The subscriber's checkpoint advances past the coalesced events. This means coalescable DIAGNOSTIC events have weaker delivery semantics than CRITICAL and NORMAL events — a subscriber may never process an intermediate `state_reported` value that was superseded by a newer report during backpressure.

NORMAL and CRITICAL events are never coalesced under any condition.

**Coalescing exemption for the Pending Command Ledger.** The Pending Command Ledger subscription is exempt from DIAGNOSTIC coalescing. The Ledger requires every `state_reported` event — including DIAGNOSTIC-priority reports that did not change state — to evaluate whether a pending command's expected outcome has been reached. If coalescing drops intermediate `state_reported` events for an entity with a pending command, the Ledger may incorrectly time out or miss the confirming report.

Implementation: the Pending Command Ledger registers its subscription with coalescing disabled. The Event Bus respects this per-subscriber setting. Other subscribers (Trace Viewer, observability dashboards) may use coalescing freely.

### 3.7 Processing Modes

The processing mode is a property of the subscriber's execution context, not of individual events. It governs whether side effects are permitted during event processing.

| Mode | When Active | Actuator Commands | Derived Events | External Notifications |
|---|---|---|---|---|
| LIVE | Subscriber has reached the log head during normal operation | Permitted | Emitted normally | Permitted |
| REPLAY | Subscriber catching up from a checkpoint that is behind the log head (startup recovery) | Suppressed | Emitted (projections need them in the log) | Suppressed |
| PROJECTION | Subscriber rebuilding a materialized view from scratch (manual rebuild or snapshot invalidation) | Suppressed | Not emitted (projection is consuming, not producing) | Suppressed |
| DRY_RUN | Automation testing or what-if analysis | Logged to dry-run audit, not executed | Recorded to dry-run audit, not the event store | Suppressed |

**REPLAY to LIVE transition:** A subscriber transitions from REPLAY to LIVE when its checkpoint reaches within a configurable threshold of the log head (default: within 10 events). The transition is logged as a diagnostic event. The brief overlap window (events arriving during transition) is safe because at-least-once delivery tolerates reprocessing.

**Replay does not produce new events.** During REPLAY processing (catch-up subscription from a checkpoint behind the log head), subscribers process historical events to rebuild their state. Subscribers operating in REPLAY mode must not produce new derived events — the derived events already exist in the log from the original live processing. Specifically:

- The State Projection does not re-emit `state_changed` events during replay. It applies the stored `state_changed` events to rebuild state.
- The Pending Command Ledger does not re-emit `state_confirmed` events during replay. It applies the stored confirmations to rebuild its pending command map.
- Integration adapters do not re-issue commands during replay (this was already specified).

The processing mode transition from REPLAY to LIVE occurs when the subscriber's checkpoint reaches within a configurable distance of the log head (default: 10 events). Events processed after the transition are in LIVE mode and may produce new derived events.

If a subscriber discovers during replay that its previously-produced derived events are inconsistent with a re-derivation (e.g., after an upcaster changes how a payload is interpreted), this is a snapshot invalidation scenario. The subscriber discards its snapshot, replays from position zero, and the new derived events replace the old ones. This is a rare recovery path, not normal operation.

**Command idempotency for crash recovery:**

When the system restarts and finds `command_issued` events without corresponding `command_result` events (pending commands at crash time), the behavior depends on the command type's declared idempotency:

| Idempotency | Behavior on Restart | Examples |
|---|---|---|
| IDEMPOTENT | Re-issued automatically after subscriber reaches LIVE mode | set_level(75%), lock_door(), set_temperature(72) |
| NOT_IDEMPOTENT | Marked as EXPIRED with `command_result` status `expired_on_restart` | toggle(), increment(), cycle_color() |
| CONDITIONAL | Offered to the integration adapter, which decides based on current device state | Protocol-specific commands |

The integration adapter declares idempotency per command type at registration. This is the split between platform mechanism and integration policy.

### 3.8 Pending Command Ledger

The Pending Command Ledger is a core subscriber that tracks in-flight commands and correlates them with incoming state reports. It exists to answer the question: "did the command work?"

**Lifecycle of a pending command:**

1. A `command_issued` event is appended. The ledger records the command's target entity, target attribute, desired value, and a tolerance band.
2. The integration adapter processes the command and reports the outcome as `command_result` (acknowledged, rejected, or timed_out).
3. If acknowledged, the ledger waits for a `state_reported` event from the target entity where the reported value falls within the tolerance band of the desired value.
4. When a matching report arrives, the ledger emits `state_confirmed` with references to both the `command_issued` and `state_reported` events.
5. If no matching report arrives within a configurable timeout (default: 30 seconds), the ledger emits a `command_confirmation_timed_out` event at DIAGNOSTIC priority, referencing the `command_issued` event and any received `command_result`. This is not treated as an error — the command was acknowledged at the protocol level and the device may simply be slow or may have rounded the value outside the tolerance band. But the timeout must exist as evidence in the event log, consistent with the principle that the system records facts for diagnosis rather than discarding them silently.

**Tolerance band:** The tolerance band is declared per command type by the Device Model & Capabilities subsystem. For a `set_level(75%)` command, a device reporting 74% or 76% is a confirmation. For a `lock_door()` command, only `locked` is a confirmation. The Pending Command Ledger does not define tolerance bands — it consumes them.

### 3.9 Event Origin Model

The `origin` field records the semantic source category of an event. It uses an evidence-based enum — the value is set only when the producer has direct evidence of the origin.

| Value | Meaning | Evidence Required |
|---|---|---|
| PHYSICAL | A human physically interacted with a device | Protocol-level indicator (Zigbee: ZCL frame type, Z-Wave: button press notification) |
| USER_COMMAND | A user issued a command through the HomeSynapse UI or API | API request carries authenticated user identity |
| AUTOMATION | An automation rule produced this event | Automation engine sets this when executing actions |
| DEVICE_AUTONOMOUS | The device generated this event without external stimulus | Device-initiated reports (battery level, firmware update, scheduled report) |
| INTEGRATION | The integration adapter generated this event during its own processing | Adapter self-identifies (initialization, polling cycle, error handling) |
| SYSTEM | The HomeSynapse core runtime generated this event | Core services self-identify (startup, shutdown, migration, retention) |
| UNKNOWN | The origin cannot be determined with confidence | Default. Assigned when none of the above can be established with evidence |

**UNKNOWN is the default.** The system never guesses origin from heuristics. If a Zigbee adapter receives a `report_attributes` frame and cannot determine whether it was triggered by a physical button press or a periodic report, the origin is UNKNOWN. Hubitat's physical/digital distinction proved that attempting to infer physical interaction without protocol evidence leads to unreliable metadata.

**There is no REPLAY origin value.** The processing mode (§3.7) governs replay behavior, not event-level tagging. A replayed event retains its original origin — the physical button press that caused a `state_reported` event at 3:00 AM is still `PHYSICAL` when replayed at 6:00 AM. The subscriber's processing mode determines whether side effects execute, not the event's origin.

### 3.10 Schema Versioning and Upcasters

Event payload schemas evolve over time. The event envelope's `schema_version` field (§4.1) records which version of the payload schema was used when the event was written. The system supports reading events written with older schemas through a chain of upcasters.

**Rules:**

1. Every event type starts at `schema_version = 1`.
2. Additive changes (new optional fields with defaults) increment the version: v1 → v2.
3. Non-additive changes (renaming fields, changing types, removing fields) are new event types, not new versions. Following Greg Young's guidance: if the change is not backward-compatible, it represents a different fact.
4. Upcasters transform event payloads from version N to version N+1 at read time. They are pure functions: `JsonNode upcaster(JsonNode payload)`. They operate on the raw JSON before deserialization into Java types.
5. Upcasters are chained: reading a v1 event when the current version is v3 applies the v1→v2 upcaster followed by the v2→v3 upcaster.
6. Upcasting is lazy — events stored as v1 remain as v1 on disk. Only the read path applies transformation.

**Strict and lenient modes:**

Core projections (State Store, Automation Engine, Pending Command Ledger) run in strict mode. If an upcaster fails, the event is not delivered — the projection reports an error and enters degraded state. This prevents corrupted state from propagating.

Diagnostic tools (Trace Viewer, export utilities) run in lenient mode. Failed upcasts produce a `DegradedEvent` wrapper containing the raw JSON and a description of the failure. This supports forensic investigation without blocking the UI.

**Snapshot invalidation:** Snapshots record the event type schema versions at snapshot creation time. If the system starts with newer schema versions than the snapshot was built from, the snapshot is invalid. The projection rebuilds from events, applying upcasters during replay. This prevents stale snapshots from containing outdated interpretations.

---

## 4. Data Model

### 4.1 Event Envelope

The event envelope is the standard wrapper structure for every event in the domain event store. Envelope fields are owned by the core. Integration-specific data lives in the `payload` field.

**Required fields:**

| Field | Wire Name | Type | Description |
|---|---|---|---|
| Event ID | `event_id` | ULID | Globally unique, monotonic within millisecond (LTD-04). Generated by the EventPublisher at append time. |
| Event Type | `event_type` | String | Dotted category key identifying the event's type. See §4.3 for the taxonomy. |
| Schema Version | `schema_version` | Integer | Positive integer identifying the payload schema version for this event type. Starts at 1. |
| Ingest Time | `ingest_time` | Timestamp | System clock at the moment the event was appended to the log. Always present. Always system-derived. Storage: integer microseconds since Unix epoch (§4.2). Java: `java.time.Instant`. Wire/API: ISO 8601 string (LTD-08). |
| Event Time | `event_time` | Timestamp, nullable | When the real-world occurrence happened, as reported by the event source. Null if the source has no reliable clock. Same three-layer representation as `ingest_time`: integer microseconds in storage, `Instant` in Java, ISO 8601 on the wire. See INV-ES-08 for the distinction between event time and ingest time. |
| Subject Reference | `subject_ref` | ULID | The entity, device, automation, person, or system component this event is about. |
| Subject Sequence | `subject_sequence` | Integer | Monotonically increasing within the subject's event stream. Used for optimistic concurrency: `(subject_ref, subject_sequence)` is a unique constraint. The name reflects that subjects may be Entities, Devices, Automations, Persons, or System components — not exclusively Entities. |
| Global Position | `global_position` | Integer | SQLite rowid. Monotonic across all entities. Subscribers checkpoint against this value. |
| Priority | `priority` | Enum string | One of: `CRITICAL`, `NORMAL`, `DIAGNOSTIC`. See §3.3. |
| Origin | `origin` | Enum string | One of: `PHYSICAL`, `USER_COMMAND`, `AUTOMATION`, `DEVICE_AUTONOMOUS`, `INTEGRATION`, `SYSTEM`, `UNKNOWN`. See §3.9. |
| Payload | `payload` | JSON object | Event-type-specific data. Structure varies by `(event_type, schema_version)`. |

**Causality fields:**

| Field | Wire Name | Type | Description |
|---|---|---|---|
| Correlation ID | `correlation_id` | ULID, non-null | The root event's `event_id`, propagated unchanged through all downstream events in the same causal chain. For root events, set to the event's own `event_id` at append time. Non-null for all events — trace queries never need to special-case roots. |
| Causation ID | `causation_id` | ULID, nullable | The `event_id` of the immediately preceding event in the causal chain. Null for root events only. |
| Actor Reference | `actor_ref` | ULID, nullable | The user identity attributable to this event. See INV-MU-01 for semantics. Null when no user is attributable. |

**Invariant alignment:** INV-ES-01 (immutable once persisted), INV-ES-03 (per-subject ordering via subject_sequence), INV-ES-04 (write-ahead via global_position), INV-ES-06 (explainable via correlation_id + causation_id + actor_ref + origin), INV-ES-07 (schema evolution via schema_version), INV-ES-08 (event_time vs ingest_time distinction), LTD-04 (ULID format), LTD-05 (dual ordering), LTD-08 (Jackson JSON serialization).

### 4.2 Domain Event Store Schema

```sql
CREATE TABLE events (
    global_position   INTEGER PRIMARY KEY,  -- SQLite rowid, auto-increment
    event_id          BLOB(16) NOT NULL,     -- ULID as 16-byte binary
    event_type        TEXT     NOT NULL,
    schema_version    INTEGER  NOT NULL DEFAULT 1,
    ingest_time       INTEGER  NOT NULL,     -- Unix microseconds
    event_time        INTEGER,               -- Unix microseconds, nullable
    subject_ref       BLOB(16) NOT NULL,
    subject_sequence  INTEGER  NOT NULL,
    priority          TEXT     NOT NULL DEFAULT 'NORMAL',
    origin            TEXT     NOT NULL DEFAULT 'UNKNOWN',
    actor_ref         BLOB(16),
    correlation_id    BLOB(16) NOT NULL,     -- ULID; equals event_id for root events
    causation_id      BLOB(16),
    payload           TEXT     NOT NULL,      -- JSON
    UNIQUE(subject_ref, subject_sequence)
);

CREATE INDEX idx_events_subject     ON events(subject_ref, subject_sequence);
CREATE INDEX idx_events_type        ON events(event_type, global_position);
CREATE INDEX idx_events_correlation ON events(correlation_id, global_position);
CREATE INDEX idx_events_ingest_time ON events(ingest_time);
CREATE INDEX idx_events_event_time  ON events(event_time);
```

**Design notes:**

Timestamps are stored as integer microseconds since epoch, not ISO 8601 strings. This saves approximately 12 bytes per event compared to string representation and enables efficient range queries. Conversion to ISO 8601 occurs at the API boundary (LTD-08).

ULID fields are stored as BLOB(16) per LTD-04. SQLite byte-comparison on BLOB(16) preserves ULID lexicographic ordering without encoding overhead.

The `UNIQUE(subject_ref, subject_sequence)` constraint enforces optimistic concurrency. An attempt to append an event with a sequence number that already exists for that subject is a conflict, indicating a concurrent modification.

The `payload` field stores the event-type-specific JSON object. The full envelope is not stored as a single JSON blob — envelope fields are promoted to columns for indexed querying. The payload is the only unstructured column.

**Event time index.** The `idx_events_event_time` index supports retention queries in the Persistence Layer (§3.4), which determine retention eligibility using `COALESCE(event_time, ingest_time)` per INV-ES-08. Since `event_time` is nullable, SQLite includes NULL values in the index by default. The retention query's use of `COALESCE` means both the `event_time` index and the `ingest_time` index contribute to query planning depending on whether the column is NULL for a given row. Rows where `event_time IS NULL` fall through to the `ingest_time` index path.

**Subscriber checkpoint table (same database file):**

```sql
CREATE TABLE subscriber_checkpoints (
    subscriber_id     TEXT    PRIMARY KEY,
    last_position     INTEGER NOT NULL,      -- global_position
    last_updated      INTEGER NOT NULL       -- Unix microseconds
);
```

Storing checkpoints in the same SQLite file as events means a subscriber can atomically update its checkpoint and query the event store within a single connection, avoiding distributed state consistency issues.

**Per-subject-type sequence integrity.** The `(subject_ref, subject_sequence)` unique constraint is universal — it applies regardless of subject type. However, the integrity guarantee it provides has practical differences across subject types:

- **Entity subjects** (the most common case): The sequence enforces optimistic concurrency for state projections. A concurrent modification to the same entity is detected immediately by the constraint violation.
- **Device subjects:** Device-level events (e.g., `device_adopted`, `device_removed`) are infrequent and single-sourced (core runtime). Sequence conflicts are unexpected; if one occurs, it indicates a bug in the core lifecycle management.
- **Automation subjects:** Automation events (e.g., `automation_triggered`, `automation_completed`) are produced by the Automation Engine. Sequences track the execution history of a single automation definition.
- **System subjects:** System events use a well-known system subject reference. Sequences order system lifecycle events (startup, shutdown, migration, snapshot).
- **Person subjects:** Presence events use person references. Sequences order presence state transitions for a single person.

All subject types share the same SQLite table and the same `UNIQUE` constraint. No subject-type-specific tables or indexes are needed for MVP.

### 4.3 Event Type Taxonomy

The `event_type` field carries a string identifier. Core event types use underscored names (e.g., `state_reported`, `device_adopted`). Integration-defined types follow a dotted namespace convention: `{integration_name}.{event_type}` (e.g., `zigbee.network_map_updated`).

**Command lifecycle:**

| Event Type | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `command_issued` | Entity | API Layer / Automation Engine | NORMAL | A command was dispatched toward the entity. Carries target attribute, desired value, and actor reference. |
| `command_dispatched` | Entity | Command Dispatch Service | DIAGNOSTIC | The integration adapter accepted the command for protocol delivery. Carries integration_id and protocol metadata. |
| `command_result` | Entity | Integration Adapter | NORMAL (success) / CRITICAL (failure, timeout) | The protocol-level outcome: acknowledged, rejected, or timed_out. |
| `command_confirmation_timed_out` | Entity | Pending Command Ledger (core) | DIAGNOSTIC | The expected state report did not arrive within the confirmation timeout. References the command_issued and any command_result. Not an error — evidence for diagnosis. |

**State lifecycle:**

| Event Type | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `state_reported` | Entity | Integration Adapter | DIAGNOSTIC | Raw attribute observation. Carries attribute_key and value. Always DIAGNOSTIC; significance is expressed through derived state_changed (NORMAL). |
| `state_changed` | Entity | State Projection (core) | NORMAL | Derived: the reported value differs from canonical state. Carries old_value, new_value, and triggered_by (event_id of the state_reported). |
| `state_confirmed` | Entity | Pending Command Ledger (core) | NORMAL | Derived: the reported value matches a pending command's expected outcome. Carries command_event_id and report_event_id. |

**Device lifecycle:**

| Event Type | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `device_discovered` | Device | Integration Adapter | NORMAL | A new device was detected on the protocol network. |
| `device_adopted` | Device | Core (user-initiated) | NORMAL | A discovered device was accepted into the system. |
| `device_removed` | Device | Core (user-initiated) | NORMAL | A device was removed from the system. |
| `entity_transferred` | Entity | Core (user-initiated) | NORMAL | Physical hardware was swapped behind a stable entity identity. |
| `entity_type_changed` | Entity | Core (migration) | NORMAL | Entity type was migrated via governed type migration. |
| `availability_changed` | Entity/Device | Integration Adapter / Core | CRITICAL (to offline) / NORMAL (to online) | Reachability status changed. |

**Device and entity profile events:**

| Event Type | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `entity_profile_changed` | Entity | Core (Device Model) | NORMAL | An entity's capability set, feature map, or type classification changed. Carries the capability diff (added, removed, modified capabilities). Produced after firmware updates, user-initiated capability changes, or entity type migration. |
| `device_metadata_changed` | Device | Core (Device Model) | DIAGNOSTIC | A device's mutable metadata changed (firmware version, configuration parameters reported by the device). Does not cover identity fields (manufacturer, model, serial) which are immutable registry properties. |
| `entity_enabled` | Entity | Core (user-initiated or automation) | NORMAL | An entity was enabled. The entity resumes participation in state projections, automation evaluation, and command dispatch. |
| `entity_disabled` | Entity | Core (user-initiated or automation) | NORMAL | An entity was disabled. The entity stops participating in state projections and automation evaluation. Commands targeting a disabled entity are rejected at dispatch time. Disabling is distinct from unavailability — a disabled entity is deliberately excluded, not unreachable. |
| `state_report_rejected` | Entity | Core (Device Model validation) | DIAGNOSTIC | An integration produced a `state_reported` event with a value that failed attribute validation. Carries the integration ID, rejected value, and structured validation error. The rejected value does not reach the State Store. |

**Automation lifecycle:**

| Event Type | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `automation_triggered` | Automation | Automation Engine | NORMAL | A trigger condition was met, beginning a run. |
| `automation_completed` | Automation | Automation Engine | NORMAL | A run finished with a terminal status (success, failure, aborted). |

**Presence:**

| Event Type | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `presence_signal` | Person | Integration Adapter | DIAGNOSTIC | A raw presence signal was received (Wi-Fi probe, BLE beacon, GPS geofence). |
| `presence_changed` | Person | Presence Projection (core) | NORMAL | Derived presence state was updated (home, away, unknown). |

**System:**

| Event Type | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `system_started` | System | Core Runtime | CRITICAL | HomeSynapse process started. |
| `system_stopped` | System | Core Runtime | CRITICAL | HomeSynapse process is shutting down. |
| `config_changed` | System | Core Runtime | NORMAL | Configuration was modified. |
| `migration_applied` | System | Core Runtime | CRITICAL | A schema migration completed. |
| `snapshot_created` | System | Core Runtime | CRITICAL | A backup snapshot was created. |
| `system_storage_critical` | System | Core Runtime | CRITICAL | Disk space has fallen below the emergency threshold. |

**Persistence and storage health:**

| Event Type | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `system_integrity_failure` | System | Core (Persistence Layer) | CRITICAL | Database integrity check failed. Carries file name, check type, error detail, and recovery action taken. |
| `system_backup_failed` | System | Core (Persistence Layer) | CRITICAL | Backup creation or validation failed. Carries reason, backup path, and last valid backup timestamp. |
| `telemetry_store_rebuilt` | System | Core (Persistence Layer) | NORMAL | Telemetry ring store was recreated due to corruption or missing file. Carries reason and previous max sequence if known. |
| `persistence_vacuum_failed` | System | Core (Persistence Layer) | NORMAL | Full VACUUM operation failed or was cancelled. Carries database file, reason, and fragmentation ratio. |
| `persistence_retention_incomplete` | System | Core (Persistence Layer) | NORMAL | Retention pass could not complete within its maintenance window. Carries tier, counts, and reason. |

**Cross-subsystem diagnostic events:**

| Event Type | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `automation_capability_mismatch` | Automation | Automation Engine | NORMAL | An automation references a capability that no longer exists on one or more of its target entities (typically after a device replacement that reduced capabilities). Carries the automation ID, affected entity IDs, and missing capability IDs. |
| `system_registry_rebuilt` | System | Core (Device Model) | CRITICAL | The device/entity registry was rebuilt from the event log due to corruption or data loss. Carries the rebuild trigger, duration, and entity count. |
| `system_storage_critical` | System | Core (Persistence Layer) | CRITICAL | Disk usage has exceeded a critical threshold. The system may begin emergency retention to preserve operability. |

**Telemetry:**

| Event Type | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `telemetry_summary` | Entity | Aggregation Engine (core) | DIAGNOSTIC | A periodic summary of telemetry data promoted from the telemetry ring store. |

**Health / Subscriber:**

| Event Type | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `subscriber_checkpoint_expired` | System | Event Bus | CRITICAL | A subscriber's checkpoint has fallen behind the retention boundary. |
| `subscriber_falling_behind` | System | Event Bus | NORMAL | A subscriber's checkpoint is more than a configurable threshold behind the log head. |
| `causality_depth_warning` | System | Causal Chain Projection | DIAGNOSTIC | A causal chain has exceeded the configured depth threshold. |

**Integration-defined event types** follow the namespace convention `{integration_name}.{event_type}`. For example, a Zigbee adapter might define `zigbee.network_map_updated` or `zigbee.ota_progress`. Integration-defined types must not collide with core type names. The integration runtime validates uniqueness at registration time.

### 4.4 Causal Chain Projection

The causal chain projection is a core subscriber that indexes causality relationships for efficient querying. It maintains an in-memory index (rebuilt from events on startup) that maps `correlation_id` to the ordered list of `event_id` values in that chain.

This supports the "why did this happen?" query: given any event, follow its `correlation_id` to retrieve the complete chain from root cause to final effect. The API Layer exposes this as a trace query endpoint.

The projection also monitors chain depth. When a chain exceeds the configurable threshold (default: 50 events), it emits a `causality_depth_warning` DIAGNOSTIC event. This serves as an early indicator of potential automation loops — a well-behaved automation chain rarely exceeds 10 events.

**Memory bound.** The causal chain projection maintains an in-memory index of active causal chains (chains with at least one event within the last N minutes, where N is configurable, default 60). Chains older than the configured window are evicted from the in-memory index. Historical chain queries beyond the window fall back to a database query on the `idx_events_correlation` index, which is slower but correct.

The memory bound is: one entry per active `correlation_id`, each carrying a chain depth counter and the `event_id` of the chain's most recent event. At 50 devices with typical automation activity, the active chain count is estimated at 200–500 chains, consuming less than 100 KB. The configured maximum chain depth (default: 50 events) triggers a `causality_depth_warning` event (DIAGNOSTIC) when exceeded. This prevents runaway automation loops from consuming unbounded memory in the projection.

Configuration:
```yaml
event_bus:
  causality:
    active_chain_window_minutes: 60
    max_chain_depth: 50
```

### 4.5 Core Event Payload Schemas

This section defines payload schemas for event types where the structure is owned by the Event Model. Event types whose payloads are owned by other subsystems (e.g., `entity_profile_changed` payload is owned by the Device Model) are defined in those subsystem documents and referenced here by event type name.

**`command_issued` payload:**
```json
{
  "target_entity_ref": "01HV...",
  "command_type": "set_level",
  "parameters": {
    "level": 75,
    "transition_ms": 500
  },
  "confirmation_timeout_ms": 5000,
  "idempotency_class": "IDEMPOTENT"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `target_entity_ref` | ULID | Yes | The entity receiving the command. Always equals the envelope's `subject_ref`. Explicit in the payload for self-documentation. |
| `command_type` | String | Yes | The command identifier as defined by the entity's capability (e.g., `set_level`, `toggle`, `lock`). |
| `parameters` | JSON Object | Yes | Command parameters as defined by the capability's `CommandDefinition`. May be empty (`{}`) for parameterless commands (e.g., `toggle`). |
| `confirmation_timeout_ms` | Integer | Yes | The timeout for the Pending Command Ledger to wait for a confirming `state_reported`. Sourced from the capability's `CommandDefinition.default_timeout`, potentially overridden by the adapter. |
| `idempotency_class` | String | Yes | One of `IDEMPOTENT`, `NOT_IDEMPOTENT`, `CONDITIONAL`. Sourced from the capability's `CommandDefinition`. Governs replay behavior (§3.7). |

**`state_reported` payload:**
```json
{
  "attribute_key": "brightness",
  "value": 74,
  "unit": "percent",
  "raw_protocol_value": 189,
  "raw_protocol_unit": "zigbee_level"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `attribute_key` | String | Yes | The attribute being reported, as defined by the entity's capability schema. |
| `value` | Any (typed per schema) | Yes | The canonical value in SI or standard units. |
| `unit` | String | Conditional | Required for physical quantities. The canonical unit. |
| `raw_protocol_value` | Any | No | The value as received from the protocol, before canonical conversion. Present when the integration performs unit conversion. |
| `raw_protocol_unit` | String | No | The protocol-native unit. Present alongside `raw_protocol_value`. |

**`state_changed` payload:**
```json
{
  "attribute_key": "brightness",
  "old_value": 50,
  "new_value": 74,
  "triggered_by": "01HV..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `attribute_key` | String | Yes | The attribute that changed. |
| `old_value` | Any (typed per schema) | Yes | The previous canonical value. |
| `new_value` | Any (typed per schema) | Yes | The new canonical value. |
| `triggered_by` | ULID | Yes | The `event_id` of the `state_reported` event that caused this state change. |

**`state_confirmed` payload:**
```json
{
  "command_event_id": "01HV...",
  "report_event_id": "01HV...",
  "attribute_key": "brightness",
  "expected_value": 75,
  "actual_value": 74,
  "match_type": "within_tolerance"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `command_event_id` | ULID | Yes | The `event_id` of the `command_issued` event that is being confirmed. |
| `report_event_id` | ULID | Yes | The `event_id` of the `state_reported` event that matched the expectation. |
| `attribute_key` | String | Yes | The attribute that was confirmed. |
| `expected_value` | Any | Yes | The value the command intended to achieve. |
| `actual_value` | Any | Yes | The value the device actually reported. |
| `match_type` | String | Yes | One of: `exact`, `within_tolerance`, `enum_transition`, `any_change`. |

---

## 5. Contracts and Invariants

**Every event is immutable once persisted.** The event store does not support UPDATE or DELETE operations on the events table (INV-ES-01). Retention policies remove events by deleting rows, but no event is modified in place. The event_id, payload, and all envelope fields are permanent from the moment of append.

**Per-entity event ordering is gap-free and monotonic.** Within a single entity stream, `subject_sequence` values form a contiguous, monotonically increasing sequence starting at 1. Gaps indicate data loss and are treated as a system integrity failure (INV-ES-03). The EventPublisher is the sole sequencing authority: it assigns `subject_sequence` by reading the current maximum sequence for the subject_ref and incrementing within the same SQLite transaction as the event INSERT. The `UNIQUE(subject_ref, subject_sequence)` constraint serves as a safety net — a constraint violation indicates a sequencing bug, not a normal concurrency condition. Because HomeSynapse uses a single-writer model (LTD-03, LTD-11), concurrent sequence assignment does not arise during normal operation. If a constraint violation does occur, the EventPublisher must re-read the current sequence and retry (§6.7).

**Events are durable before any subscriber processes them.** The WAL commit completes before `EventPublisher.publish()` returns to the caller. No subscriber is notified until the event is on disk (INV-ES-04, LTD-06).

**Every subscriber processes every matching CRITICAL and NORMAL event at least once.** Subscribers that crash and restart resume from their last checkpoint. Events between the checkpoint and the log head are redelivered. Subscribers must be idempotent (INV-ES-05, LTD-06). DIAGNOSTIC events are also delivered at least once under normal conditions, but during backpressure, specific DIAGNOSTIC event types (`state_reported`, `presence_signal`, `telemetry_summary`) may be coalesced per §3.6 — the subscriber receives the most recent value and its checkpoint advances past intermediate events. Coalescing never applies to CRITICAL or NORMAL events under any condition.

**Every state change is explainable through the causal chain.** Given any `state_changed` event, following the `triggered_by` reference leads to the `state_reported` event. Following the causal chain (via `correlation_id`) leads to the root cause — a physical interaction, a user command, an automation trigger, or a system event (INV-ES-06).

**Schema evolution never breaks existing readers.** Events written with schema version N are readable by code that expects version M (where M >= N) through the upcaster chain. Unknown fields in JSON payloads are silently ignored (INV-ES-07, LTD-08 Jackson `FAIL_ON_UNKNOWN_PROPERTIES=false`).

**Ingest time and event time are always distinguishable.** `ingest_time` is the system clock at append. `event_time` is the source-reported time. Consumers that need ordering guarantees use `global_position` or `subject_sequence`, never timestamps (INV-ES-08).

**Derived event production is bounded.** A single incoming event produces at most two derived events in the same processing cycle (one `state_changed` from the State Projection and one `state_confirmed` from the Pending Command Ledger). No derived event may itself trigger further derived events within the Event Model subsystem. This bound exists to prevent unbounded amplification and to keep throughput calculations predictable.

---

## 6. Failure Modes and Recovery

### 6.1 Process Crash During Event Append

**Trigger:** Process killed (OOM, SIGKILL, power failure) between SQLite WAL write and subscriber notification.

**Impact:** The event is durable on disk (WAL guarantees this for `synchronous=NORMAL`). Subscribers have not been notified. No data loss.

**Recovery:** On restart, subscribers resume from their checkpoints. They discover and process the event that was appended but not delivered. Standard catch-up processing in REPLAY mode.

**Events produced:** `system_started` (CRITICAL) on restart.

### 6.2 Process Crash During Subscriber Processing

**Trigger:** Process killed while a subscriber is processing an event but before checkpoint update.

**Impact:** The subscriber's checkpoint still points to the position before the event. The event will be redelivered on restart.

**Recovery:** At-least-once delivery (INV-ES-05). The subscriber must be idempotent — processing the same event twice produces the same result.

**Events produced:** `system_started` (CRITICAL) on restart.

### 6.3 Subscriber Falls Behind Log Head

**Trigger:** A subscriber processes events slower than they are appended. Common during event storms (mesh recovery, bulk import).

**Impact:** Subscriber state is stale. DIAGNOSTIC events may be coalesced (§3.6). No data loss — events remain in the log.

**Recovery:** The subscriber catches up naturally. If backlog exceeds the threshold, the bus activates DIAGNOSTIC coalescing to reduce load.

**Events produced:** `subscriber_falling_behind` (NORMAL) when backlog exceeds the configured threshold.

### 6.4 Subscriber Checkpoint Expired (Retention Purge)

**Trigger:** Retention policy purges events that a subscriber has not yet processed. The subscriber's checkpoint points to a non-existent position.

**Impact:** The subscriber cannot catch up — events are permanently lost from its perspective. Projection integrity is compromised.

**Recovery:** If a snapshot exists for the subscriber's projection, reinitialize from the snapshot and resume from the snapshot's position. If no snapshot exists, the subscriber enters DEGRADED health state and requires manual intervention (projection rebuild or configuration correction).

**Events produced:** `subscriber_checkpoint_expired` (CRITICAL).

### 6.5 Disk Space Exhaustion

**Trigger:** Available disk space falls below the emergency threshold (configurable, default: 500 MB).

**Impact:** If not addressed, SQLite will fail to write. Event appends will fail. The system is non-functional.

**Recovery:** Emergency retention activates (owned by Persistence Layer, see **Persistence Layer** §3.5 for the complete escalation protocol). The Persistence Layer first disables telemetry ring store writes, then purges events in order: DIAGNOSTIC first (progressively reducing retention to 1 day, then 1 hour), then backup generations beyond the most recent, then NORMAL events (progressively reducing retention to 7 days, then 1 day). CRITICAL events are never subject to emergency retention — the append-only guarantee (INV-ES-01) holds even under storage pressure. If the threshold cannot be reached after purging all DIAGNOSTIC and NORMAL events, the system enters a degraded state where only CRITICAL events are accepted. Committed events are never overwritten or replaced.

**Events produced:** `system_storage_critical` (CRITICAL) when emergency threshold is breached.

### 6.6 Upcaster Failure

**Trigger:** An event's payload cannot be transformed from its stored schema version to the current version. Possible causes: corrupted payload, missing upcaster in the chain, upcaster bug.

**Impact in strict mode:** The subscriber that requested the event receives an error. Core projections enter DEGRADED state for the affected entity stream.

**Impact in lenient mode:** The event is wrapped in a `DegradedEvent` container and delivered with the raw JSON payload. Diagnostic tools can display it but cannot interpret the structured fields.

**Recovery:** Deploy a corrected upcaster. Rebuild the affected projection.

**Events produced:** None (upcaster failures are logged via structured logging, not as domain events, to avoid infinite loops).

### 6.7 Optimistic Concurrency Conflict

**Trigger:** Two concurrent producers attempt to append events with the same `(subject_ref, subject_sequence)`. In a single-writer system, this should not occur under normal operation — it indicates a bug in sequence assignment.

**Impact:** The SQLite UNIQUE constraint rejects the second insert. The producing component receives an error.

**Recovery:** The producing component should re-read the current sequence number and retry. This is a defensive mechanism, not a normal operating path.

**Events produced:** None (the failed event was never persisted).

---

## 7. Interaction with Other Subsystems

| Subsystem | Direction | Mechanism | Data | Constraints |
|---|---|---|---|---|
| Integration Runtime | Produces events via | EventPublisher.publish() | state_reported, command_result, availability_changed, device_discovered, presence_signal | Producer boundary rules (§3.1) enforced at compile time |
| State Store | Subscribes to | Event Bus subscription | state_reported, state_changed | State Store rebuilds from events on startup (REPLAY mode) |
| State Projection | Produces events via | EventPublisher.publish() | state_changed, state_confirmed | Derived from state_reported; carries triggered_by reference |
| Automation Engine | Subscribes to | Event Bus subscription | state_changed, automation_triggered, availability_changed, presence_changed | Subscribes to NORMAL+ priority only. Side effects suppressed in REPLAY mode. |
| Pending Command Ledger | Subscribes to / Produces | Event Bus subscription + EventPublisher | Reads command_issued, command_result, state_reported. Produces state_confirmed. | Tolerance band definitions consumed from Device Model |
| Persistence Layer | Manages | Direct SQLite access | Domain event store and telemetry ring store files | Owns WAL tuning, VACUUM scheduling, retention execution. This subsystem owns the schema; Persistence owns the operational mechanics. |
| REST API | Reads from | EventStore query interface | Event envelopes by position, entity, type, correlation, time range | API Layer defines endpoints; this subsystem defines the data shapes and query capabilities. |
| WebSocket API | Subscribes to | Event Bus subscription | Real-time event stream for connected clients | Client-facing subscriber with bus-side filtering by event type |
| Configuration System | Provides | YAML configuration (§9) | Retention policy, bus tuning, telemetry boundary | Configuration changes produce config_changed events |
| Observability & Debugging | Reads from / Subscribes to | EventStore + Event Bus | Metrics, health indicators, trace queries | Causal chain projection enables trace viewer |
| Startup, Lifecycle & Shutdown | Produces events via | EventPublisher.publishRoot() | system_started, system_stopped | Processing mode transitions (REPLAY→LIVE) coordinated during startup |
| Device Model & Capability System | Reads from | `EntityRegistry` query | Entity type for subscription filter resolution | Read-only, in-memory lookup. No write dependency. |

---

## 8. Key Interfaces

### 8.1 Interfaces

| Interface | Responsibility | Primary Consumers |
|---|---|---|
| `EventPublisher` | Append events to the domain event store with compile-time causality enforcement | Integration adapters, Automation Engine, core services |
| `EventStore` | Read events by global position, entity stream, event type, correlation, or time range | Subscribers, REST API, diagnostic tools |
| `EventBus` | Register subscribers, manage notification lifecycle, handle backpressure | All subscriber components |
| `SubscriberLifecycle` | Manage subscriber registration, checkpoint persistence, health reporting | Event bus (internal), health system |
| `UpcasterRegistry` | Register and chain schema upcasters per (event_type, from_version, to_version) | EventStore deserialization layer |

### 8.2 Key Types

| Type | Kind | Responsibility |
|---|---|---|
| `EventEnvelope` | Record | Immutable wrapper carrying all envelope fields plus the deserialized payload |
| `DomainEvent` | Sealed interface | Root of the event type hierarchy; all event payload types implement this |
| `EventPriority` | Enum | CRITICAL, NORMAL, DIAGNOSTIC |
| `EventOrigin` | Enum | PHYSICAL, USER_COMMAND, AUTOMATION, DEVICE_AUTONOMOUS, INTEGRATION, SYSTEM, UNKNOWN |
| `CausalContext` | Record | Carries correlation_id, causation_id, actor_ref for propagation through event chains |
| `ProcessingMode` | Enum | LIVE, REPLAY, PROJECTION, DRY_RUN |
| `CommandIdempotency` | Enum | IDEMPOTENT, NOT_IDEMPOTENT, CONDITIONAL |
| `SubscriptionFilter` | Record | Specifies event_types, minimum_priority, and optional entity_type_prefix for bus-side filtering |
| `DegradedEvent` | Record | Wrapper for events that could not be upcasted in lenient mode; carries raw JSON and failure description |

### 8.3 EventPublisher Method Summary

Two methods, no overloads. Causality is mandatory by API shape.

`publish(DomainEvent event, CausalContext cause)` — Append an event caused by a prior event. The correlation_id is inherited from the cause. The causation_id is set to the cause event's event_id. The actor_ref is inherited through the chain.

`publishRoot(DomainEvent event, @Nullable ULID actorRef)` — Append a root event (external stimulus with no prior event cause). The correlation_id is set to the new event's own event_id (non-null, enabling uniform trace queries). The causation_id is null.

Both methods are synchronous from the caller's perspective: the event is persisted to SQLite and the method returns only after the WAL commit. Subscriber notification happens asynchronously after the method returns.

---

## 9. Configuration

All configuration follows YAML 1.2 (LTD-09) with JSON Schema validation. The event subsystem runs correctly with zero configuration — all values have sensible defaults.

```yaml
event_model:
  # Domain event store
  store:
    path: "${HS_DATA_DIR}/homesynapse-events.db"  # Default: /var/lib/homesynapse/homesynapse-events.db
    wal_size_limit_mb: 6                           # SQLite journal_size_limit (LTD-03)
    page_cache_mb: 128                             # SQLite cache_size (LTD-03)

  # Retention policies (per priority tier)
  retention:
    critical_days: 365          # Minimum: 30. Maximum: unlimited (0 = never purge).
    normal_days: 90             # Minimum: 7.
    diagnostic_days: 7          # Minimum: 1.
    overrides:                  # Per-event-type overrides (optional)
      command_result: 180       # Keep command outcomes longer than default normal
      state_reported: 3         # Aggressive pruning of raw observations
    emergency_threshold_mb: 500 # Trigger emergency retention when free space drops below this

  # Event bus
  bus:
    coalesce_backlog_threshold: 1000    # Start coalescing DIAGNOSTIC events when subscriber backlog exceeds this
    falling_behind_threshold: 10000     # Emit subscriber_falling_behind when backlog exceeds this
    subscriber_batch_size: 100          # Events per poll batch

  # Priority
  priority:
    elevation_enabled: true             # Allow DIAGNOSTIC → NORMAL elevation by integrations

  # Pending command ledger
  pending_commands:
    confirmation_timeout_seconds: 30    # Time to wait for state_confirmed before expiring
    max_pending_per_entity: 10          # Prevent unbounded pending command accumulation

  # Causality
  causality:
    depth_warning_threshold: 50         # Emit causality_depth_warning when causal chain exceeds this depth

  # Processing modes
  processing:
    replay_to_live_threshold: 10        # Switch from REPLAY to LIVE when within this many events of log head

  # Telemetry boundary
  telemetry:
    domain_path_max_rate_seconds: 10    # Data sources faster than 1 per N seconds are telemetry stream candidates
```

---

## 10. Performance Targets

All targets are specified for the primary deployment target: Raspberry Pi 5, 4 GB RAM, NVMe SSD storage, running the JVM configuration in LTD-01.

| Metric | Target | Rationale | Test Method |
|---|---|---|---|
| Event append latency (p99) | < 10 ms | Device state changes must be recorded within the time budget that makes automation trigger-to-action feel instant. This is the write-path contribution to the 50 ms trigger-to-action budget. | Benchmark: append 10,000 events in sequence, measure p99 latency. |
| Event append throughput (sustained) | > 500 events/sec | 10x expected peak for a 50-device home. Provides headroom for event storms during mesh recovery. | Benchmark: sustain 500 events/sec for 60 seconds, verify no events lost and no subscriber falls behind. |
| Subscriber notification latency (p99) | < 5 ms after persistence | The time from WAL commit to subscriber wake-up. Combined with append latency, this determines the total event-to-subscriber latency budget. | Benchmark: measure time between EventPublisher return and subscriber's onEvent() invocation. |
| Full event log replay | > 10,000 events/sec | One year of data from a 50-device home (~1.5M domain events) replayed in under 3 minutes. Critical for startup recovery and projection rebuilds. | Benchmark: replay a 1.5M-event database, measure throughput including upcaster application. |
| Causal chain query latency (p99) | < 20 ms for chains up to 50 events | The trace viewer must render "why did this happen?" results without perceptible delay. | Benchmark: query the causal chain projection for a 50-event chain, measure response time. |
| Subscriber count | 20+ concurrent subscribers without throughput degradation | The system will have approximately 10 core subscribers (State Store, Automation Engine, Causal Chain Projection, Observability, WebSocket clients). 20 provides 2x headroom. | Benchmark: register 20 subscribers, sustain 500 events/sec, verify all subscribers keep pace. |
| Memory overhead per subscriber | < 5 MB | Virtual threads have minimal stack overhead (~1 KB default). The per-subscriber cost is dominated by the poll batch buffer (100 events at ~500 bytes = ~50 KB) plus filter state. 5 MB ceiling provides margin for subscriber-specific caches. | Profile: measure RSS contribution of each registered subscriber under load. |
| Domain event store size (1 year, 50 devices) | < 2 GB | With retention defaults (DIAGNOSTIC 7d, NORMAL 90d, CRITICAL 365d) and a typical 50-device home generating ~4,000 domain events/day. | Calculation: validate against actual event size measurements during integration testing. |

---

## 11. Observability

### 11.1 Metrics

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `hs_events_appended_total` | Counter | `event_type`, `priority` | Total events appended to the domain event store. |
| `hs_events_append_latency_ms` | Histogram | — | Event append latency distribution (write path). |
| `hs_events_subscriber_lag` | Gauge | `subscriber_id` | Number of events between subscriber's checkpoint and log head. |
| `hs_events_subscriber_process_latency_ms` | Histogram | `subscriber_id` | Per-event processing latency per subscriber. |
| `hs_events_coalesced_total` | Counter | `subscriber_id` | Total DIAGNOSTIC events coalesced due to backpressure. |
| `hs_events_delivery_gaps_total` | Counter | `subscriber_id` | Total delivery gaps (checkpoint expirations). |
| `hs_events_store_size_bytes` | Gauge | `store` (`domain`, `telemetry`) | Current size of each SQLite database file. |
| `hs_events_pending_commands` | Gauge | — | Current number of pending commands in the ledger. |
| `hs_events_causal_chain_max_depth` | Gauge | — | Maximum causal chain depth observed across all active correlation IDs. |
| `hs_events_upcaster_applied_total` | Counter | `event_type`, `from_version`, `to_version` | Total upcaster invocations during deserialization. |

All metrics are collected via JFR custom events (LTD-15). No Prometheus or OpenTelemetry dependency in MVP.

### 11.2 Structured Logging

Key log events (JSON format per LTD-15):

| Log Event | Level | Fields | Condition |
|---|---|---|---|
| Event appended | DEBUG | `event_id`, `event_type`, `subject_ref`, `priority`, `global_position` | Every event append (disabled by default; enabled for debugging) |
| Subscriber registered | INFO | `subscriber_id`, `filter`, `initial_checkpoint` | Subscriber registration at startup |
| Subscriber reached LIVE | INFO | `subscriber_id`, `position`, `replay_duration_ms` | REPLAY to LIVE transition |
| Subscriber falling behind | WARN | `subscriber_id`, `lag`, `threshold` | Subscriber backlog exceeds threshold |
| Checkpoint expired | ERROR | `subscriber_id`, `checkpoint_position`, `oldest_available_position` | Subscriber checkpoint behind retention boundary |
| Upcaster failure | ERROR | `event_id`, `event_type`, `schema_version`, `target_version`, `error` | Upcaster chain failed (strict mode) |
| Coalescing activated | WARN | `subscriber_id`, `coalesced_count`, `backlog_size` | DIAGNOSTIC coalescing triggered |
| Emergency retention | WARN | `purged_count`, `free_space_mb`, `threshold_mb` | Emergency retention triggered by low disk space |

### 11.3 Health Indicators

| Health State | Condition | Impact |
|---|---|---|
| HEALTHY | All subscribers within threshold of log head. Disk space above emergency threshold. No checkpoint expirations. | Normal operation. |
| DEGRADED | One or more subscribers falling behind (backlog > threshold). OR one or more upcaster failures in lenient mode. OR disk space above emergency threshold but below 2x threshold. | System functional but with stale views or reduced observability. Dashboard displays warning indicator. |
| CRITICAL | Any subscriber checkpoint expired. OR disk space below emergency threshold. OR domain event store inaccessible. | System integrity compromised. Immediate operator attention required. Dashboard displays error with diagnostic guidance. |

---

## 12. Security Considerations

**Event payload sensitivity.** The event log records every state change in the home. This includes occupancy patterns (presence events), access patterns (lock events), energy usage patterns (telemetry summaries), and behavioral patterns (automation triggers). On a local-first system, this data is protected by the physical security of the device. The event model does not encrypt individual payloads — the SQLite database file is the encryption boundary, handled by the Persistence Layer if at-rest encryption is enabled.

**Event category scoping for future access control.** The event type namespace uses dotted notation (§4.3) organized by functional domain. This structure enables future access-control policies that grant scoped access to event categories without structural changes. For example, a utility company participating in a virtual power plant program might receive read access to `telemetry_summary` events for energy entities, while an insurance attestation service might receive read access to `availability_changed` events for water sensors. The event model defines the namespace structure; the API Layer and a future Data Sovereignty module define the access-control policies.

**Actor attribution.** The `actor_ref` field provides non-repudiation for user-initiated actions. When a user issues a command through the API, their authenticated identity is recorded in every event in the resulting causal chain. This supports audit requirements for commercial deployments where accountability for actions matters.

**Causal chain integrity.** The compile-time causality enforcement (§8.3) prevents events from being published without proper causal attribution. This means every event can be traced to its root cause. For forensic or compliance scenarios, the causal chain provides a complete, tamper-evident record of why any given state change occurred. The event log's append-only nature (INV-ES-01) means historical causal chains cannot be retroactively modified.

---

## 13. Testing Strategy

### 13.1 Unit Tests

**Event envelope serialization round-trip.** Create an EventEnvelope with all fields populated. Serialize to JSON via Jackson. Deserialize. Verify all fields match, including ULID binary encoding and microsecond timestamp precision.

**Upcaster chain application.** Register a chain of upcasters (v1 to v2 to v3). Feed a v1 event JSON through the chain. Verify the output matches the expected v3 structure. Test with missing fields, extra fields, and null values.

**Upcaster failure in strict mode.** Register an upcaster that fails for a specific input. Verify that the deserialization layer throws a specific, descriptive exception rather than a generic Jackson error.

**Upcaster failure in lenient mode.** Register a failing upcaster. Verify that the deserialization layer returns a DegradedEvent wrapper with the raw JSON and failure description.

**CausalContext propagation.** Create a root event via `publishRoot()`. Create a caused event via `publish()` with the root's CausalContext. Verify correlation_id, causation_id, and actor_ref are correctly propagated.

**Subscription filter matching.** Create events of various types and priorities. Verify that a SubscriptionFilter correctly includes/excludes events per its configured event_types, minimum_priority, and entity_type_prefix.

**Event priority assignment.** Verify that each event type in the taxonomy is assigned the correct default priority per §4.3.

**Origin enum defaulting.** Verify that events produced without an explicit origin default to UNKNOWN, not to any other value.

### 13.2 Integration Tests

**Write-ahead guarantee.** Append an event, crash the process (kill -9) before subscriber notification, restart, and verify the event is present in the log and delivered to subscribers.

**Subscriber catch-up from checkpoint.** Append 1,000 events. Start a subscriber with a checkpoint at position 500. Verify it processes events 501 through 1000 in order.

**Checkpoint expiration.** Configure aggressive retention (1 minute). Append events. Wait for retention to purge. Start a subscriber with a checkpoint in the purged range. Verify it receives the CheckpointExpired signal.

**DIAGNOSTIC coalescing under backpressure.** Register a deliberately slow subscriber. Flood the log with `state_reported` events (DIAGNOSTIC) for the same entity. Verify the subscriber receives only the most recent value per entity after coalescing.

**Processing mode transition.** Start the system with a subscriber checkpoint 100 events behind the head. Verify the subscriber processes in REPLAY mode (actuator commands suppressed). Verify it transitions to LIVE mode within the configured threshold. Verify subsequent events are processed in LIVE mode (actuator commands permitted).

**State lifecycle integration.** Append a `state_reported` event with a value that differs from current state. Verify the State Projection emits `state_changed` with correct old_value, new_value, and triggered_by. Append another `state_reported` with the same value. Verify no `state_changed` is emitted.

**Pending command confirmation.** Issue `command_issued` for SetLevel(75%). Append `state_reported` with brightness=74%. Verify the Pending Command Ledger emits `state_confirmed` within the tolerance band.

**Causal chain query.** Create a chain: user presses button, automation triggers, command issued, state changed. Query the causal chain projection by correlation_id. Verify the complete chain is returned in order.

**Command idempotency on restart.** Issue a `command_issued` with IDEMPOTENT declaration. Kill the process before `command_result` arrives. Restart. Verify the command is re-issued after the subscriber reaches LIVE mode. Repeat with NOT_IDEMPOTENT. Verify the command is expired with `expired_on_restart` status.

### 13.3 Performance Tests

**Append throughput.** Sustain 500 events/sec for 60 seconds on Raspberry Pi 5 with NVMe. Verify p99 latency stays below 10 ms.

**Replay throughput.** Load a 1.5M-event database. Replay all events through the State Projection. Verify throughput exceeds 10,000 events/sec.

**Subscriber scalability.** Register 20 subscribers with varied filters. Sustain 500 events/sec. Verify all subscribers maintain pace (lag < 100 events).

**Retention under load.** Append events at 100 events/sec for 24 simulated hours with 7-day DIAGNOSTIC retention. Verify the retention process runs without impacting append latency.

---

## 14. Future Considerations

**Energy event category for VPP settlement.** The event type namespace accommodates energy-specific event types (for example, `energy.generation_reported`, `energy.storage_state`, `energy.grid_export`) as integration-defined types under a reserved `energy.*` namespace. The event log's sub-minute timestamp resolution and append-only guarantees meet the audit requirements for wholesale market settlement under programs like California's DSGS or FERC Order 2222. The aggregation engine (§3.5) path from telemetry to domain events is the mechanism for capturing high-frequency energy data at sub-second granularity while promoting meaningful transitions to the domain log. This is not implemented in MVP, but the architecture does not prevent it.

**Insurance attestation derivation.** The event log contains the raw data needed to generate "home health attestations" — cryptographically signed summaries that confirm sensor operational status without exposing raw behavioral data. For example, a daily attestation might confirm: "All 6 water sensors were operational for the past 24 hours. No leak events detected. Shutoff valve test passed." The State Projection and the event type taxonomy provide the inputs; a future attestation service would be a subscriber that reads `availability_changed` and `state_reported` events for designated sensor categories and produces signed summaries. The event model's category-scoped namespace (§4.3) and the `origin` field (§3.9) provide the metadata needed to distinguish sensor-health events from other traffic.

**Aging-in-place activity pattern analysis.** The event log naturally captures the activity data needed for care monitoring: motion sensor events, contact sensor events (doors, cabinets, refrigerator), presence state transitions. A future care monitoring subscriber would consume these events locally, build behavioral baselines, and generate anomaly alerts — all without transmitting raw event data outside the home. The processing mode model (§3.7) ensures such a subscriber can rebuild its baseline by replaying historical events. The `event_time` vs `ingest_time` distinction (§4.1) ensures accurate activity timing even when events are batched.

**Data Sovereignty API.** The event type namespace is structured to support scoped, time-limited, revocable access grants to specific event categories. A future Data Sovereignty module would use the `event_type` prefix and `subject_ref` to filter events for authorized third parties, producing derived data products (summaries, attestations, settlement records) without exposing the raw event stream. The event model's existing filtering infrastructure (SubscriptionFilter in §3.4) provides the mechanism; the sovereignty layer adds the authorization policy. This is beyond MVP scope, but the namespace structure and filtering model are designed to accommodate it.

**Cryptographic integrity for the event log.** For commercial deployments requiring tamper-evidence, the event log can be extended with hash-chaining (each event's hash includes the previous event's hash) without changing the event envelope schema — a `log_hash` column can be added to the events table as an additive schema change. This is not implemented in MVP because the local-first deployment model and the physical security of the device provide adequate integrity for consumer use. Commercial and regulatory use cases may require it.

**Multi-instance event synchronization.** The event model is designed for a single-process, single-writer architecture (LTD-03, LTD-11). Future multi-instance deployments (active-passive replication, multi-home coordination) would require event synchronization across instances. The ULID event_id (globally unique by construction) and per-entity sequences (conflict-detectable) provide the primitives for merge resolution. The `ingest_time` vs `event_time` distinction becomes critical in multi-instance scenarios where events may be ingested at different times on different instances.

---

## 15. Open Questions

1. **[RESOLVED] Where should tolerance-band declaration live?**
   Resolution: **Device Model & Capabilities owns the tolerance-band semantics** — the rules for what constitutes a "match" are inherently part of what a capability means (for example, "what does set_level(75%) mean within ±2%?"). This document defines only the minimal, capability-agnostic contract the Pending Command Ledger consumes: a command produces an `Expectation` that can evaluate a `state_reported` value and return confirmed/not-yet/failed. The `Expectation` interface shape is specified in §3.8; the concrete implementations per capability are specified in Device Model & Capabilities.

2. **[RESOLVED] Should `state_reported` priority be retroactively adjusted?**
   Resolution: **No.** `state_reported` is always appended at DIAGNOSTIC priority and remains DIAGNOSTIC (INV-ES-01 immutability). The derived `state_changed` event (NORMAL priority) carries the `triggered_by` reference to locate the causal report. The API Layer should provide a convenience query ("get causal report for this state change") to make retrieval ergonomic without violating immutability.

3. **Should the telemetry ring store boundary threshold (10 seconds) be validated empirically before locking?**
   Options: (a) Lock at 10 seconds based on typical smart home sensor reporting intervals; (b) Conduct a prototype spike measuring SQLite write throughput for `state_reported` events at various rates on Pi 5 hardware.
   Recommendation: Run the spike (the development process explicitly allows this). However, 10 seconds should be treated as a default heuristic, not a locked constant. The design already supports per-integration override (the integration declares its path at registration). A future adaptive rule — adjusting the boundary based on measured append latency and backlog growth — is a reasonable post-MVP enhancement but is not required now.
   Status: **[NON-BLOCKING]** — the threshold is configurable (§9) and per-integration overridable, so the default can be adjusted based on empirical data without changing the architecture.

---

## 16. Summary of Key Decisions

| Decision | Choice | Rationale | Section |
|---|---|---|---|
| D1 | Three-level state events: state_reported → state_changed / state_confirmed | Separates raw observation (integration) from derived transition (core) from intent closure (core). Prevents integrations from inventing change-detection semantics. Adopted from OpenHAB's command/state separation, adapted for event sourcing. | §3.2 |
| D2 | Seven-value evidence-based origin enum with UNKNOWN default | Adapted from Hubitat's physical/digital distinction with richer semantics. UNKNOWN is honest — the system never guesses origin from heuristics. No REPLAY value; processing mode handles that. | §3.9 |
| D3 | Three-tier priority (CRITICAL / NORMAL / DIAGNOSTIC) with static assignment and one-level elevation | Adopted from Matter's three-tier priority model. Static defaults per event type with optional DIAGNOSTIC-to-NORMAL elevation by integrations. Priority governs retention and delivery urgency, never append-time durability. | §3.3 |
| D4 | Dual-track persistence: domain event store + telemetry ring store in separate SQLite files | Prevents Home Assistant's recorder bloat pattern. Isolates write pressure. Makes backup policy explicit: domain is mandatory, telemetry is optional. Telemetry is not covered by ES invariants. Promotion boundary via aggregation engine. | §3.5 |
| D5 | Schema evolution via per-type version with JSON-level upcasters | Follows Axon Framework's upcasting pattern. Preserves INV-ES-01 (immutable storage) and INV-ES-07 (forward-compatible schemas). Greg Young's rule: non-additive changes are new types, not new versions. Strict mode for core projections, lenient for diagnostics. | §3.10 |
| D6 | Two-method EventPublisher with compile-time causality enforcement and non-null correlation_id | Makes broken causal chains a compile-time error. Fixes Home Assistant's Context implementation gaps (missing parent_ids). correlation_id is non-null for all events (root events set it to their own event_id), eliminating NULL special-casing in trace queries. | §3.1, §4.1, §4.4, §8.3 |
| D7 | Pull-based subscribers with bus-side filtering and checkpointed virtual threads | Combines Eclipse Ditto's single-writer principle with Matter's catch-up semantics. Virtual threads (LTD-01) enable many concurrent subscribers. Bus filters by event_type + priority + entity_type_prefix. Explicit gap handling via CheckpointExpired signal. | §3.4, §3.6 |
| D8 | Four processing modes (LIVE / REPLAY / PROJECTION / DRY_RUN) with integration-declared command idempotency | Solves the "replaying a toggle event should not toggle the light" problem. Processing mode is the safety gate, not event-level tagging. Command idempotency is integration-declared, not platform-assumed. | §3.7 |
| D9 | Entity as the aggregate root (not device) | Aligns with the glossary (entity is the addressable unit). Multi-entity devices use correlation_id for cross-entity coordination, not aggregate-level transactions. Per-entity sequence numbers order events within an entity stream. | §4.1, §4.2 |
| D10 | Coalescing limited to specific DIAGNOSTIC event types under backpressure | Only `state_reported`, `presence_signal`, and `telemetry_summary` are coalescable. All other DIAGNOSTIC events (command_dispatched, subscriber_falling_behind, causality_depth_warning) are delivered individually. NORMAL and CRITICAL never coalesced. The at-least-once guarantee is explicitly narrowed: CRITICAL and NORMAL events are unconditionally at-least-once; coalescable DIAGNOSTIC types may be superseded during backpressure. | §3.6, §5 |
| D11 | Telemetry boundary at 10 seconds sustained rate (configurable default, per-integration overridable) | Prevents high-frequency energy/sensor data from overwhelming the domain event log. The 10-second threshold is a configurable heuristic, not an invariant. Integration declares path at registration. Per-integration override supported. | §3.5 |
| D12 | Event type namespace supports category-scoped access | Dotted namespace organized by functional domain enables future access-control policies for Data Sovereignty API, insurance attestation, utility settlement, and care monitoring — without requiring event schema changes. | §4.3, §12 |
| D13 | Pending command timeout emits explicit event, never expires silently | command_confirmation_timed_out (DIAGNOSTIC) is emitted when a pending command's expected state report does not arrive within the timeout. Consistent with the principle that the event log records facts for diagnosis — silent expiry would create evidence gaps. | §3.8, §4.3 |
| D14 | EventPublisher is the sole sequencing authority; sequence assigned within append transaction | subject_sequence is assigned by reading the current max and incrementing within the same SQLite transaction as the INSERT. The UNIQUE constraint is a safety net, not a concurrency mechanism. Single-writer model (LTD-03) prevents concurrent assignment during normal operation. | §5 |

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It is governed by the Design Document Template and will be reviewed during architecture review.*