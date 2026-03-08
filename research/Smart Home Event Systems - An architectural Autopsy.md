# Event systems in smart home platforms: an architectural autopsy

**No major smart home platform uses event sourcing — and most pay dearly for it.** Across Home Assistant, OpenHAB, SmartThings, Hubitat, HomeKit, and Matter, only Eclipse Ditto and the Matter specification treat events as first-class, ordered, persistent records. Every other platform treats events as ephemeral notifications, with state held independently in memory or databases. This creates a consistent pattern of failure: database bloat from storing state snapshots, lost causality chains, inability to replay or audit, and event storms that overwhelm systems with no backpressure. The good news for HomeSynapse: Matter's event model, Eclipse Ditto's persistence patterns, and Java 21's sealed interfaces with virtual threads provide a clear blueprint for doing this right on constrained hardware.

This report dissects the internal event architectures of eight platforms and four non-smart-home event systems across eleven technical dimensions, drawing from source code, specifications, GitHub issues, and community battle scars.

---

## How each platform structures its events

Event schema design reveals a platform's architectural philosophy. The range spans from HomeKit's three-field notifications to Matter's richly typed, prioritized event records.

**Home Assistant** fires `Event` objects with five fields: `event_type` (string), `data` (dict), `origin` (LOCAL or REMOTE enum), `time_fired` (UTC datetime), and `context` (a Context object containing `id`, `parent_id`, and `user_id`). The most important event type is `state_changed`, carrying `entity_id`, `old_state`, and `new_state`. Context IDs migrated from UUID4 strings to **ULID format** in 2023, reducing recorder storage by ~55%. The EventBus class in `homeassistant/core.py` dispatches events via `async_fire()` on a single asyncio event loop, with listeners registered per `event_type` string or via the `MATCH_ALL` constant.

**OpenHAB** has the most sophisticated event taxonomy of any smart home platform. Its base `Event` interface carries `type`, `topic`, `payload` (JSON string), and `source`. The topic follows a hierarchical structure — `openhab/items/{itemName}/statechanged` — enabling regex-based filtering. The critical design achievement is the **four-way distinction** between `ItemCommandEvent` (a request to change state), `ItemStateEvent` (an instruction to update state), `ItemStateUpdatedEvent` (confirmation that state was set), and `ItemStateChangedEvent` (notification that state actually changed from a previous value). This distinction, refined in OpenHAB 4 via PR #3141, cleanly separates intent from outcome.

**SmartThings** events in the modern REST API carry `eventId`, `deviceId`, `componentId`, `capability`, `attribute`, `value`, `valueType`, `stateChange` (boolean), `commandId`, and `sensitive` flag. The `stateChange` field explicitly indicates whether the value actually differs from the previous state. Edge drivers (Lua-based, running on the hub) emit events via `device:emit_event()`, which validates against capability schemas enforcing min/max values and allowed enums.

**Matter** defines the richest event structure at the specification level: `EventNumber` (per-node monotonic uint64), `Priority` (Debug/Info/Critical), `Path` (EndpointId + ClusterId + EventId), timestamp (system or epoch with delta compression), and TLV-encoded data. **Matter is the only smart home protocol that treats events as a historical journal distinct from current state.** Attributes represent current state; events record transitions with context that attributes cannot capture — who locked the door, with what credential, and why.

**HomeKit/HAP** sits at the opposite extreme: event notifications carry only `aid` (accessory ID), `iid` (instance ID), and `value`. No timestamps, no sequence numbers, no event ID. Events are anonymous state-change notifications over a persistent TCP connection using a custom `EVENT/1.0` protocol line.

| Platform | Event fields | Typing | Timestamps | Sequence numbers | Priority levels |
|----------|-------------|--------|------------|-----------------|----------------|
| Home Assistant | 5 (type, data, origin, time, context) | String event_type | Wall-clock | None | None |
| OpenHAB | 4 (type, topic, payload, source) | Class hierarchy | None in event | None | None |
| SmartThings | 12+ (eventId, deviceId, capability...) | Capability schema | eventTime | eventId (UUID) | None |
| Hubitat | 10+ (name, value, type, source...) | String-based | getDate()/getUnixTime() | None | None |
| HomeKit/HAP | 3 (aid, iid, value) | Characteristic type | None | None | immediateDelivery flag |
| Matter | 6+ (number, priority, path, timestamp, data) | TLV + cluster spec | System/Epoch with delta | Per-node monotonic uint64 | Debug, Info, Critical |
| Eclipse Ditto | 6+ (topic, path, value, revision, timestamp, headers) | JSON with definition refs | ISO 8601 | Per-thing monotonic revision | None (custom ACK labels) |
| WoT/WebThings | Defined by Thing Description | JSON Schema (DataSchema) | Recommended, not required | None | None |

---

## Ordering guarantees: what platforms claim versus what they deliver

**The most important finding across all platforms is that ordering guarantees are weaker than users assume.** Only Matter and Eclipse Ditto provide formal, specification-level ordering primitives.

**Home Assistant** achieves implicit ordering through its **single-threaded asyncio event loop**. Events fired via `async_fire` are dispatched to listeners in listener-registration order within a single event loop tick. This provides natural per-entity ordering as long as integrations don't use threads — but many do. Integrations performing blocking I/O use `hass.async_add_executor_job()` to run in a `SyncWorker` thread pool, with state changes marshaled back via `call_soon_threadsafe()`. Since 2024.7.0, HA actively detects blocking calls in the event loop (file I/O, `time.sleep()`, module imports) and logs warnings. The formal concurrency documentation is nearly nonexistent. Tim Wiegand's analysis concluded: *"There's very little in the way of formal documentation about what behavior you can rely on. Nothing about overlapping execution or race conditions."*

**OpenHAB** uses OSGi EventAdmin with a **single dispatch thread** delivering events to per-subscriber `ThreadedEventHandler` queues. Events within a single subscriber's queue are FIFO-ordered, but **processing across different subscribers is concurrent** — each subscriber gets its own thread. This means two rules responding to the same state change may execute in unpredictable order. A binding updating multiple items from a single device message generates separate events with no atomicity guarantee — rules triggered by individual item changes may see inconsistent intermediate states.

**Matter** provides the strongest ordering guarantee: a **per-node monotonic uint64 EventNumber** that sequences all events across all endpoints and clusters. Subscribers can detect gaps by tracking EventNumbers, and the `MinEventNumber` field in subscribe requests enables reliable catch-up. This is the model HomeSynapse should emulate.

**Eclipse Ditto** guarantees per-thing ordering via Apache Pekko's Cluster Sharding, which enforces the **single-writer principle** — exactly one actor instance per Thing processes commands sequentially, generating monotonically increasing `revision` numbers. Cross-thing ordering is not guaranteed, which is the correct tradeoff for IoT systems.

**Wireless protocol realities undermine all ordering claims.** Zigbee messages can arrive out of order during mesh recovery. Z-Wave's sequential command queuing introduces variable latency. WiFi devices face network jitter. No platform exposes these transport-level ordering violations to the application layer, and no platform uses logical clocks or vector clocks to compensate.

---

## Persistence: the graveyard of good intentions

Smart home platforms split into two camps: those that persist events (and struggle with storage) and those that don't (and struggle with auditability).

**Home Assistant's recorder** runs as a dedicated Python `threading.Thread` consuming from an in-memory queue and persisting via SQLAlchemy. The default backend is SQLite (`home-assistant_v2.db`), with optional MySQL/MariaDB/PostgreSQL support. The current schema (version 48) uses heavily normalized tables: `states_meta` for entity IDs, `event_types` for type strings, `state_attributes` for deduplicated JSON blobs, and `event_data` for deduplicated event payloads. Events are batched with a default **5-second commit interval** to prevent disk thrashing during event storms.

**Database bloat is Home Assistant's most documented failure mode.** Users report databases growing to 5–95 GB. One user documented **500 MB/day growth** from energy monitoring sensors. The purge mechanism runs daily at 4:12 AM, deleting in batches of 10,000 rows, but has critical bugs: GitHub issue #117263 documented the purge causing the recorder to stop writing entirely until restart. Issue #121909 found the purge getting stuck after a failed rebuild exhausted disk space. SQLite's `VACUUM` operation requires **2.5x the database size in free space** — devastating on SD cards.

**OpenHAB** uses pluggable persistence services, with **rrd4j** (round-robin database) as the default. This is an elegant choice for constrained hardware: rrd4j databases have a **fixed maximum size** with automatic data compression for older values. The tradeoff is that it only supports numerical data and loses granularity over time. For full-fidelity storage, users deploy InfluxDB, JDBC, or MongoDB as external services.

**Eclipse Ditto is truly event-sourced**, using MongoDB as its journal store via Apache Pekko Persistence. Every state mutation generates an event appended to the `things_journal` collection. Snapshots stored in `things_snaps` reduce recovery time — configurable via `snapshot-after` (typically 200 events). Background cleanup uses a **credit-based system** to avoid overwhelming MongoDB during retention enforcement. Ditto demonstrates that event sourcing is production-viable for IoT digital twins, but it requires MongoDB's storage capacity — not suitable for bare Raspberry Pi.

**Hubitat** uses an embedded Java database (likely H2) with configurable per-device retention via "Event History Size" and "Max Event/State Days" (recently defaulted to 365 days). Database growth is the community's top concern, with the hub displaying "Your database is growing" alerts when storage pressure increases.

**Matter** specifies **circular TLV buffers per priority level** on the device itself. When buffers fill, oldest events of that priority are evicted, with higher-priority events "promoted" to the next buffer before eviction. Buffer sizes are implementation-defined. The `connectedhomeip` SDK's `EventManagement.cpp` implements this with explicit logging: *"Dropped 1 event from buffer with priority 0... due to overflow."* This is the right model for constrained devices — bounded memory, graceful degradation by priority.

---

## The event storm problem nobody has solved

**No major smart home platform implements explicit backpressure or rate-limiting on inbound events.** This is the most consistent architectural gap across the ecosystem.

The canonical event storm scenario is **Zigbee/Z-Wave mesh recovery after a power outage**. All devices attempt to rejoin simultaneously, flooding the coordinator with rejoin requests and state reports. Home Assistant GitHub issue #115642 documents that with 35+ Zigbee devices, switches become unresponsive for ~5 minutes post-outage, sometimes requiring ZHA integration reload. The coordinator gets overwhelmed processing MAC-layer acknowledgments while devices simultaneously report their states.

**Automation loops** represent the other storm vector. Home Assistant provides per-automation `mode` settings (`single`, `restart`, `queued`, `parallel`) but has **no built-in protection against cross-automation loops**. Users resort to checking `trigger.to_state.context.parent_id` or using `input_boolean` helpers as makeshift mutexes — what one critic called *"massively over-complicated... hard enough implementing your own low-level concurrency primitives in a real programming language."*

**OpenHAB** has a documented design flaw where syncing two instances via MQTT causes infinite ping-pong: Instance A updates item → publishes to MQTT → Instance B receives → updates → publishes back. The community discussion thread was titled *"MQTT plays ping-pong and floods my event bus."*

OpenHAB's per-subscriber `ThreadedEventHandler` uses an **unbounded `LinkedBlockingQueue`**. When the queue exceeds 1,000 elements, it logs a warning but takes no corrective action — events continue accumulating, potentially causing OutOfMemoryError. The 5,000ms dispatch timeout can trigger OSGi EventAdmin blacklisting (in OpenHAB 2.x), permanently disabling event delivery until restart.

**For HomeSynapse, event storm handling must be a first-class design concern.** Proven patterns from event streaming systems include: per-entity buffering with configurable limits, debouncing (only emit domain events when changes exceed a threshold), priority-based eviction (Matter's model), and circuit breakers that shed load gracefully during mesh recovery.

---

## Causality tracking: Home Assistant leads, everyone else trails

**Home Assistant is the only smart home platform with explicit causality tracking**, via its `Context` object containing `id` (ULID), `parent_id`, and `user_id`. When an automation triggers, resulting service calls and state changes share the same context, allowing the logbook and trace system to reconstruct causal chains. For example: a device tracker changing to `home` creates context A; the "Paulus is home" automation creates context B with `parent_id = A`; the resulting `light.turn_on` service call and state change both carry context B.

However, the implementation has significant gaps. GitHub issue #68047 reports that **sun triggers don't generate parent contexts** — automations triggered by sunrise/sunset have `parent_id: null`, breaking the chain. Issue #128229 documents missing parent_ids for climate-triggered automations. Architecture Discussion #978 proposes adding `device_id` to context for voice assistant tracing, but this hasn't shipped. Most critically, **there is no native API to query context chains** — users must write raw SQL against the recorder database.

**OpenHAB** offers only an optional `source` string on events, identifying the sender but without structured chaining. **SmartThings** includes a `commandId` field on device events but no formal correlation mechanism. **Hubitat** shows a Source column (typically "DEVICE") in the events UI — minimal provenance tracking. **Matter and HomeKit** provide no causality tracking at the protocol level.

**Eclipse Ditto** includes a `correlation-id` header on all protocol messages, enabling request-response correlation, but does not implement causal chaining.

**For HomeSynapse**, the design should embed both `correlationId` (the entire business flow) and `causationId` (the specific event that caused this event) in every event's metadata, following the EventStoreDB pattern. EventStoreDB even provides a built-in `$by_correlation_id` system projection for querying causal chains. Greg Young's guidance: *"Never use timestamps as sequence numbers. Time is not absolute across systems. Use sequential numbers."*

---

## Commands versus events: OpenHAB got it right

The distinction between "something happened" (observation) and "make something happen" (intent) is fundamental to correct event modeling. Platforms handle this with varying sophistication.

**OpenHAB's four-event model** is the gold standard. `ItemCommandEvent` is a request/intent ("turn the light on"). `ItemStateEvent` is an instruction to update state (input). `ItemStateUpdatedEvent` confirms the state was set (output — the dimmer that received "ON" may now report "100%"). `ItemStateChangedEvent` fires only when the value actually differs from the previous state. This refactoring in OpenHAB 4 solved a real problem: a DimmerItem receiving an "ON" command should update its state to "100%" — the input and output carry **semantically different values**.

**Home Assistant** conflates observation and confirmation into a single `state_changed` event. A `call_service` event represents intent, but the resulting device state change is indistinguishable from a device autonomously reporting its state. HA added an `event` entity type for stateless events (button presses, doorbell rings) because discrete events don't map to the state machine model — but issue #123347 documents that repeated identical button presses don't trigger automations because the state attribute doesn't change between presses.

**Hubitat** distinguishes `type: "physical"` (manual device interaction) from `type: "digital"` (hub-triggered command) as a first-class event property. This enables apps like Rule Machine to differentiate user actions from automated responses.

**Matter** achieves the cleanest architectural separation at the protocol level: **Attributes** hold current state, **Commands** are RPC-style actions, and **Events** are historical records of transitions. A `LockOperation` event captures who locked the door, with what credential, and the outcome — information that the `LockState` attribute alone cannot express.

---

## High-frequency telemetry versus semantic domain events

Every platform struggles with the impedance mismatch between high-frequency sensor readings and meaningful state changes. The proven pattern is **tiered storage with domain event extraction**.

**Home Assistant's three-tier statistics architecture** is the most mature approach in the smart home space. Tier 1 stores raw state changes (purged after 10 days by default). Tier 2 stores **5-minute aggregates** (mean, min, max for measurements; sum for totals) in the `statistics_short_term` table, purged after ~10 days. Tier 3 stores **hourly aggregates** in the `statistics` table, never automatically purged. The architecture discussion estimated that 10 years of hourly data produces ~88,000 data points per sensor, growing the database ~1.6 MB/year per sensor — manageable for home use. However, this only works for numeric sensors with a `state_class` attribute. **Binary sensors have no long-term statistics support** — Architecture Discussion #1268 concluded that numeric aggregation is inappropriate for binary data, where transitions are the most valuable information.

**OpenHAB's rrd4j** default persistence handles this elegantly through round-robin design: fixed-size databases with configurable archives where older data is automatically averaged/compressed. A sensor reporting every second generates no more storage than one reporting every hour — rrd4j simply averages higher-frequency data into its configured intervals.

**The event sourcing community** provides the clearest architectural guidance. Oskar Dudycz recommends: *"Save measurements using lightweight storage. Then group and process into events that are understandable for business."* For HomeSynapse, this means a **two-tier architecture**: raw telemetry goes into a lightweight time-series store (Chronicle Queue or a rotating SQLite table), while domain events (`TemperatureThresholdExceeded`, `EnergyUsageAnomalyDetected`) flow into the event-sourced aggregate store only when meaningful state transitions occur.

**ESPHome** demonstrates effective device-level filtering: `throttle`, `throttle_average`, `sliding_window_moving_average`, and `heartbeat` filters process data on the microcontroller before it reaches the hub. HomeSynapse should support declaring similar filter pipelines per device binding.

---

## Schema evolution: the hardest unsolved problem

**No smart home platform has a clean schema evolution story.** Home Assistant uses sequential integer-versioned migrations, OpenHAB uses breaking namespace changes across major versions, and most others simply don't version their events.

**Home Assistant's migration history is instructive as a cautionary tale.** Schema v32 (2023.2) was a massive refactoring: entity IDs normalized into `states_meta`, timestamps changed from DATETIME to FLOAT, attributes deduplicated by hash. This migration requires significant time on large databases and has caused numerous failures. Issue #59002 documents a migration referencing a column that doesn't exist until the next migration step. Issue #92650 finds duplicate event types causing UNIQUE constraint failures. Issue #123179 reports MariaDB migrations taking **days** for large databases. The lesson: sequential, imperative migrations are fragile at scale.

**The event sourcing world offers better patterns.** Axon Framework's **upcasting** system transforms old event versions to new versions at read time, chaining transformations (v1→v2→v3) via `SingleEventUpcaster` classes that operate on `IntermediateEventRepresentation`. Events are immutable in storage; transformation happens lazily during deserialization. The `@Revision` annotation on event classes enables version tracking, and old snapshots are automatically invalidated when the revision changes.

**Greg Young's principle is definitive**: *"A new version of an event must be convertible from the old version. If not, it is not a new version but a new event."* For HomeSynapse, every event type should carry a schema version, with upcasters registered per version pair. Java 21's sealed interfaces provide compile-time exhaustiveness checking — adding a new event variant forces handling everywhere.

**Matter's approach** is pragmatic: each cluster has a `ClusterRevision` attribute, new specification revisions can add events/attributes but cannot remove or change existing semantics, and newer device versions must interoperate with older revision levels.

---

## Event sourcing patterns that work on constrained hardware

Building a true event-sourced system on Raspberry Pi requires careful adaptation of enterprise patterns to resource constraints.

**The "event sourcing in the small" pattern** applies ES principles within a single process using an embedded database. The core benefits — audit trail, temporal queries, state reconstruction — are preserved without distributed consistency concerns. For HomeSynapse on Raspberry Pi, the recommended stack combines **SQLite in WAL mode** as the primary event store, **Java 21 sealed interfaces and records** for event modeling, and **virtual threads** for per-device subscription processing.

A minimal SQLite event store schema needs only:

```sql
CREATE TABLE events (
    global_position INTEGER PRIMARY KEY AUTOINCREMENT,
    stream_id TEXT NOT NULL,
    stream_position INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    data TEXT NOT NULL,
    metadata TEXT,
    timestamp TEXT NOT NULL,
    UNIQUE(stream_id, stream_position)
);
```

**Java 21's type system is remarkably well-suited for event sourcing.** Sealed interfaces enumerate all possible event types with compiler-enforced exhaustiveness. Records provide immutable value semantics with automatic `equals`, `hashCode`, and serialization. Pattern matching enables clean event-handler dispatch:

```java
public sealed interface SmartHomeEvent permits
    DeviceRegistered, TemperatureChanged, LightSwitched, MotionDetected {
    UUID deviceId();
    Instant timestamp();
}
```

**Virtual threads** (Project Loom) eliminate the traditional thread-pool bottleneck. Each device subscription, each projection, and each automation can run on its own virtual thread — thousands of concurrent lightweight threads without resource pressure. When a thread blocks on database I/O, the JVM unmounts it from the carrier thread, which serves other virtual threads. The caveat: avoid `synchronized` blocks (causes thread pinning); use `ReentrantLock` instead.

**Snapshot optimization is critical for startup time on Pi hardware.** Axon Framework's `EventCountSnapshotTriggerDefinition` pattern — snapshot every N events per aggregate — should be adapted. Eclipse Ditto uses `snapshot-after: 200` as a default. For a smart home device with ~10 events/day, this means monthly snapshots. On aggregate recovery, load the latest snapshot and replay only subsequent events.

**Chronicle Queue** deserves special mention for high-frequency telemetry. It is a pure-Java, GC-free, off-heap persisted message queue achieving millions of events per second. It runs as a library (no separate server) and persists directly to memory-mapped files. For HomeSynapse's telemetry tier, Chronicle Queue handles raw sensor data while the domain event store (SQLite) handles meaningful state transitions.

**EventStoreDB (now KurrentDB) is too heavy for Raspberry Pi** — it requires ~1 GB RAM minimum and uses V8 for projections, which lacks full ARM support. Axon Server has similar resource requirements. The embedded approach (SQLite + in-process event bus) is the right choice.

---

## What no platform does well — and what HomeSynapse should fix

Across all platforms researched, several critical gaps emerge consistently.

**No platform provides replay-safe event processing.** Martin Fowler identified the core challenge: *"One of the tricky elements to Event Sourcing is how to deal with external systems... if these events cause update messages to be sent to external systems, then things will go wrong because those external systems don't know the difference between real processing and replays."* In smart homes, this is acute — replaying a "turn on light" event has physical consequences. HomeSynapse should implement a **live/replay flag** (like Axon's `AggregateLifecycle.isLive()`) that suppresses actuator commands during replay, and record external system responses as events for replay fidelity.

**No platform cleanly separates telemetry from domain events at the architectural level.** HA's statistics system is a bolt-on; OpenHAB delegates to external persistence services; SmartThings throttles to ~1 event/minute. HomeSynapse should treat these as **distinct subsystems from day one**: a telemetry ring buffer (Chronicle Queue) feeding a domain event extractor that applies configurable filters (threshold, debounce, sliding window) before emitting events into the sourced aggregate store.

**Backpressure remains universally absent.** Home Assistant's event bus, OpenHAB's unbounded queues, and Hubitat's single-threaded processing all fail under event storms with no graceful degradation. HomeSynapse should implement **bounded per-entity event buffers** with configurable overflow policies (drop oldest, drop newest, merge/coalesce) and **priority-based eviction** following Matter's three-tier model.

**Causality tracking is either absent or incomplete everywhere.** Home Assistant's Context is the right idea but has implementation gaps (missing parent_ids on sun triggers, no query API). HomeSynapse should embed `correlationId` and `causationId` in every event from the start, with a dedicated projection for causal chain queries. Every automation trigger, every service call, every device state change should be traceable to its root cause.

**Matter's event model is the closest to correct.** Its combination of per-node monotonic numbering, priority levels, timestamp options (system/epoch with delta compression), explicit separation from attributes/commands, and catch-up-on-reconnect via MinEventNumber represents the state of the art in smart home event design. HomeSynapse should adopt this model's core principles: monotonic per-entity sequence numbers, event priority tiers, and subscriber catch-up from last-known position.

---

## Conclusion: design principles for HomeSynapse

Ten engineering principles emerge from this cross-platform analysis, ranked by importance.

**First, separate commands, state updates, and state-change events** following OpenHAB's four-event model. This is the single most impactful architectural decision — every platform that conflates these concepts suffers from ambiguity in automation logic and event handling.

**Second, implement per-entity monotonic event numbering** following Matter's model. This enables gap detection, subscriber catch-up, and causal ordering without the overhead of global ordering. Use SQLite's `AUTOINCREMENT` for global position and maintain a per-stream counter for entity-level ordering.

**Third, build tiered storage from day one.** Raw telemetry in Chronicle Queue (bounded, high-throughput, GC-free). Domain events in SQLite event store (append-only, snapshotted). Aggregated statistics in a separate table (5-minute and hourly rollups). Each tier with independent retention policies.

**Fourth, make backpressure a first-class concern.** Bounded per-entity queues with priority-based eviction. Debounce filters configurable per device type. Circuit breakers for mesh-recovery scenarios. The event bus should never have unbounded queues.

**Fifth, embed causality metadata in every event.** `correlationId`, `causationId`, `userId`, `sourceDeviceId`, and `schemaVersion` in standardized event metadata. Build the causal-chain query projection before you need it.

**Sixth, use Java 21's type system aggressively.** Sealed interfaces for event hierarchies with compiler-enforced exhaustiveness. Records for immutable event data. Pattern matching for handler dispatch. Virtual threads for per-device and per-projection processing.

**Seventh, design schema evolution into the event store.** Every event carries a version. Upcasters transform old events at read time. New event versions must be constructible from old versions — or they're new events. Never mutate stored events.

**Eighth, implement replay with side-effect guards.** An `isLive()` flag on the processing context suppresses actuator commands during replay. Record external system responses as events. Support projection rebuilds from event history as a core feature, not an afterthought.

**Ninth, learn from Home Assistant's recorder failures.** Don't use SQLite on SD cards without WAL mode and aggressive `PRAGMA` tuning. Implement incremental purging (not bulk DELETE + VACUUM). Offer database-size monitoring and automatic retention adjustment. Avoid the 2.5x free-space VACUUM requirement by using incremental vacuuming.

**Tenth, apply event sourcing selectively.** Greg Young's most important advice: *"The single biggest bad thing is building a whole system based on Event Sourcing."* Use ES for device state aggregates, automation execution history, and scene management. Use simple CRUD for user configuration, UI preferences, and integration settings. The bounded context is the unit of architectural decision, not the entire system.