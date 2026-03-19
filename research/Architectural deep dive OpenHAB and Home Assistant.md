# Architectural deep dive: OpenHAB and Home Assistant internals

**Both dominant open-source smart home platforms carry significant architectural debt that constrains their evolution.** OpenHAB's three-layer Thing-Channel-Item model provides elegant device abstraction at the cost of crushing configuration verbosity, while Home Assistant's string-typed state system and entity_id coupling create brittleness that pervades every subsystem. Neither platform has solved backpressure, reliable state restoration, or the command-vs-feedback problem at an architectural level. ioBroker's `ack` flag pattern and quality codes offer the most architecturally interesting alternative approaches to these unsolved problems.

This analysis covers four core subsystems — event bus, device/integration model, state system, and persistence — drawing from source code in `openhab-core` and `home-assistant/core`, GitHub issues, architecture decision records, and community reports. Each subsystem section concludes with a synthesis of the most critical flaws.

---

## 1. Event system: the nervous system that neither platform got right

### OpenHAB's per-subscriber threaded event bus

OpenHAB's event bus sits atop the **OSGi EventAdmin service** with a custom typed-event layer. The key classes live in `org.openhab.core.internal.events`:

**`OSGiEventManager`** bridges OSGi raw events to OpenHAB's typed system. **`ThreadedEventHandler`** wraps each `EventSubscriber` in a dedicated Java thread backed by a `LinkedBlockingQueue`. **`EventPublisher`** exposes a single `post(Event)` method injected via OSGi Declarative Services. The **`AbstractEventFactory`** pattern deserializes JSON payloads into strongly-typed event objects.

Every event carries four fields: a hierarchical **`topic`** (e.g., `openhab/items/{itemName}/command`), a **`type`** string (class name like `ItemCommandEvent`), a JSON **`payload`**, and a **`source`** chain encoding provenance as `bundle$actor=>bundle$actor` (e.g., `org.openhab.ui.basic$default:03=>org.openhab.core.io.rest$admin`). The source field is explicitly documented as informational-only — it cannot be relied upon programmatically and users can inject arbitrary strings.

The event taxonomy is well-structured. **Item events** include `ItemCommandEvent`, `ItemStateEvent` (fires on every update including unchanged), `ItemStateChangedEvent` (fires only on actual change), `ItemStatePredictedEvent`, and registry mutation events. **Thing events** mirror this with `ThingStatusInfoEvent` and `ThingStatusInfoChangedEvent`. Trigger channels fire `ChannelTriggeredEvent` for stateless events like button presses.

**Threading model**: Each subscriber gets its own thread and queue, providing natural isolation — a slow subscriber blocks only itself. The system logs a warning when any subscriber's queue exceeds **1,000 elements** (issue #3690 showed `CommunicationManager` hitting this during startup) and when dispatch takes over **5,000ms** (issue #3531). Event ordering is FIFO-guaranteed per subscriber via `LinkedBlockingQueue`, but not across subscribers.

**Causality tracking is weak.** The source chain provides delegation provenance but no correlation ID or transaction grouping. You cannot query "all events caused by this single button press" without manual log analysis.

### Home Assistant's single-threaded event loop

HA's event system lives in `homeassistant/core.py`. The `EventBus` class offers `async_fire()` and `async_listen()`. The `Event` dataclass carries `event_type` (string), `data` (untyped dict), `origin` (LOCAL/REMOTE enum), `time_fired` (datetime), and a `Context` object.

The **`Context`** object provides HA's causality mechanism with three fields: `id` (ULID), `parent_id` (one-hop parent reference), and `user_id`. When an automation triggers from a `state_changed` event, it creates a new Context with `parent_id` pointing to the triggering event's context. All subsequent service calls and state changes inherit this context.

**Context limitations are severe.** Only `parent_id` exists — **one level of ancestry**. For a chain like device_tracker → automation → service call → light state → second automation, tracing from the final context back to the original device_tracker requires multiple database JOINs across the `states` and `events` tables. Context is not stored in its own table; `context_id_bin`, `context_user_id_bin`, and `context_parent_id_bin` are columns on both tables. The HA data documentation acknowledges: "Currently, there is no native way to retrieve the original cause of a context in automations or templates." Community reports confirm context propagation bugs where old context IDs leak into new events within ~5-second windows.

**Event firing** uses `call_soon` on the asyncio event loop for each registered listener. There is **no backpressure mechanism** — `async_fire` schedules all listener callbacks without throttling. Architecture Discussion #1062 revealed this directly: core developer @bdraco noted that adding `state_reported` (which fires on every state write, **20-30x more frequent** than `state_changed`) would overwhelm the event bus. The solution was routing `state_reported` through the dispatcher instead, explicitly avoiding event bus overhead — an admission that the event bus cannot handle the platform's own internal event volume.

The **single-threaded event loop** means any blocking listener freezes the entire system — all events, state updates, UI responses, and automations stall. Issue #115071 shows `RuntimeError: Cannot enter into task` when the loop gets overwhelmed. Issue #88505 documents the event loop dying during recorder startup. HA added `verify_event_loop_thread()` to detect integrations calling async functions from wrong threads.

**Concurrency guarantees are essentially undocumented.** A detailed community analysis ("Home Assistant: Concurrency Model," thecandidstartup.org, October 2025) found that asking about HA's concurrency model yielded responses like "it does what it does" and "use an `input_boolean` as a mutex." Only same-automation concurrency is controlled (modes: single, restart, queued, parallel). Cross-automation concurrency has no guarantees.

### Biggest flaws in the event system

**Neither platform has backpressure.** OpenHAB's `LinkedBlockingQueue` is unbounded — the 1,000-element warning is detection without enforcement, and the system can OOM if a subscriber permanently stalls. HA has no detection at all; `async_fire` is fire-and-forget into an unbounded callback schedule. A production event bus needs bounded queues with overflow policies (drop-oldest, drop-newest, block-producer), which neither implements.

**OpenHAB's failure mode is gradual memory exhaustion; HA's is sudden total system freeze.** OpenHAB's per-subscriber threads mean slow consumers queue up independently — the system degrades gracefully until OOM. HA's single-threaded model means one blocked handler freezes everything instantly, but there's no queue accumulation risk.

**Causality tracking is shallow in both.** OpenHAB's source chain is informational-only with no correlation ID. HA's Context has a single `parent_id` hop. Neither can answer "what was the complete causal chain that led to this event?" without expensive reconstruction. No transaction grouping, no replay capability, no event sourcing.

**HA's polling-driven event storms** compound the problem. The `Timer` fires `time_changed` every second, driving all polling integrations. Wildcard subscribers (`MATCH_ALL`) receive every event, and @bdraco noted there's no way to subscribe to "all events except X" — a missing negative filter that forces over-subscription.

---

## 2. Device and integration model: the identity crisis

### OpenHAB's Thing-Channel-Item architecture

OpenHAB uses a deliberate **three-layer abstraction** separating physical devices from application logic:

**Things** represent physical devices, identified by `ThingUID` (format: `bindingId:thingTypeId:thingId`). Each `ThingType` is declared in XML (`ESH-INF/thing/`) specifying supported channels, configuration parameters, and a `<representation-property>` (e.g., serial number or MAC address) for matching re-discovered devices to existing Things.

**Channels** represent individual device capabilities — a thermostat has separate channels for current temperature, target setpoint, humidity, mode, and fan. **`ChannelType`** definitions specify accepted Item types, state descriptions (min/max/step/readonly), and semantic categories. Two channel varieties exist: **state channels** (bidirectional, update Item state and accept commands) and **trigger channels** (event-only, for stateless actions like button presses). **Channel Groups** organize multiple channels on complex devices, with UIDs containing a `#` separator (e.g., `binding:device:id:group#channel`).

**Items** are the application-layer state holders used by UIs, rules, and persistence. Items know nothing about physical devices — they only track state and type. The critical design: **Items and Channels are connected by explicit Link objects**, which are first-class persistent entities with optional Profile configurations (e.g., `rawbutton-toggle-switch`, `offset`) that transform data flowing between Channel and Item. This is a many-to-many relationship — one Channel can link to multiple Items, and one Item can receive from multiple Channels.

**Binding lifecycle** is managed through `ThingHandlerFactory` (creates handlers for supported ThingTypes) and `BaseThingHandler` with methods: `initialize()` (must be non-blocking for initial status), `dispose()` (must return quickly — issue #2454 documents widespread violations), `handleCommand(ChannelUID, Command)`, and `channelLinked()`/`channelUnlinked()`. Handlers communicate back through `ThingHandlerCallback` methods: `updateState()`, `updateStatus()`, `triggerChannel()`.

**Discovery** uses `AbstractDiscoveryService` with active scanning (`startScan()`) and optional background discovery. Results include a `representationProperty` that prevents duplicate discovery. Protocol-specific helpers (`UpnpDiscoveryParticipant`, `MDNSDiscoveryParticipant`) standardize common discovery patterns.

### Home Assistant's entity-centric model and its pain points

HA's model uses **Device Registry → Entity Registry → Entity Platforms**. The central architectural debt is **entity_id string coupling**.

**entity_id** (format `<domain>.<object_id>`, e.g., `light.kitchen_ceiling`) is simultaneously the human-readable name, the programmatic reference in automations/scripts/dashboards, and — for entities without `unique_id` — the identity itself. The `object_id` is generated by slugifying the entity name. Duplicates get `_2`, `_3` suffixes that persist even after the original is removed.

**This triple duty causes cascading breakage.** When a device is renamed externally, re-paired after hardware swap, or an integration changes its naming scheme, entity_ids change and all automations, scripts, and dashboard cards referencing them silently break. Issue #138953 documents this directly. **There is no automatic cascade update** — changing an entity_id in the UI does not update references elsewhere. Architecture Discussion #741 proposes but doesn't implement auto-updating. The device automation editor sometimes uses opaque `device_id` (hex UUID) instead of entity_id for triggers/actions, but device_id also changes on device re-addition, breaking automations all the same.

**The entity type system is rigid.** `Entity` subclasses (`SensorEntity`, `ClimateEntity`, `LightEntity`, etc.) define required properties and supported features as bitmasks. If a device capability doesn't fit an existing platform, integration authors must either force-fit it or contribute a new entity type to core. Capabilities that don't map to dedicated properties end up in `extra_state_attributes` — an untyped dict that's harder to use in automations, not tracked by the recorder by default, and doesn't generate events on change.

**Multi-function devices shatter across platforms.** A thermostat becomes 5+ entities across 3+ platforms: `ClimateEntity` for HVAC control, `SensorEntity` for temperature/humidity, `BinarySensorEntity` for occupancy, `NumberEntity` for setpoint offset. The `DeviceRegistry` groups these by `device_info` identifiers, but there's no composite entity concept.

**Orphaned entities accumulate relentlessly.** The entity registry persists all known entities in `core.entity_registry` JSON. When an integration stops claiming an entity, it gets an `orphaned_timestamp`, but its unique_id→entity_id mapping blocks reuse. Issue #153511 reports **999+ orphaned entries**. Standard UI can't always delete them; the third-party tool "Spook" provides `homeassistant.delete_orphaned_entities` but users report it doesn't always work (Spook issue #827). Manual registry file editing is sometimes required.

**Config flow limitations** constrain complex integrations. ADR-0010 requires all new integrations to use config flows, but the `data_entry_flow` system only supports simple key-value forms — **no dynamic lists, tables, or nested structures**. Many integrations don't implement `async_step_reconfigure`, forcing users to delete and re-add integrations to change settings, losing all entity customizations.

### OpenHAB's configuration verbosity versus HA's naming fragility

OpenHAB's strength — the decoupled Item layer that lets you swap physical devices without touching rules — is also its biggest adoption barrier. Setting up a single multi-function device requires: install binding → create Thing → identify Channels → create Items (choosing types, names, groups, tags) → create Links. A thermostat with 5 capabilities means 5 Items + 5 Links + the Thing. The `representation-property` handles re-discovery of the same device, but replacing a device with a different serial requires manual Thing deletion, Inbox acceptance, and re-linking.

OpenHAB also lacks a **first-class Device concept** above Things — there's no device registry, no grouping mechanism for multiple Things representing one physical device, no centralized manufacturer/model/firmware metadata.

HA creates entities automatically on integration setup, which is dramatically simpler for users. But the entity_id becomes load-bearing infrastructure that breaks under any identity change. OpenHAB's explicit linking is verbose but stable; HA's automatic entity creation is convenient but fragile.

### ioBroker's compositional alternative

ioBroker uses a **hierarchical object tree** with dot-separated IDs (e.g., `hue.0.Living_Room_Lamp.light.brightness`). Instead of fixed entity platforms, every state object has a `common.role` string (e.g., `switch.power`, `level.color.temperature`, `value.temperature`) that semantically describes its function. A "Type-detector" repository provides templates for detecting device types from role combinations — compositional rather than inheritance-based. This avoids HA's platform rigidity but trades compile-time type safety for runtime role interpretation.

### Biggest flaws in the device model

**HA's entity_id string coupling** is the deepest architectural debt in either platform. The entity_id serves as human label, programmatic reference, and (often) identity simultaneously. Any change cascades through automations, dashboards, and scripts with no automated migration. This will only worsen as installations grow.

**OpenHAB's configuration ceremony** (Thing→Channel→Item→Link) is an adoption killer. The model is architecturally sound — the indirection layer is genuinely valuable for long-term maintainability — but the setup cost drives users to HA despite HA's inferior abstraction.

**Neither platform has solved device replacement.** OpenHAB requires manual re-linking when a device with a new serial appears. HA generates new entity_ids (with `_2` suffixes) that break everything. ioBroker's hierarchical IDs have the same rebinding problem. No platform treats "replace device X with compatible device Y, preserving all references" as a first-class operation.

---

## 3. State system: strings, types, and the command-feedback gap

### OpenHAB's strongly-typed state hierarchy

OpenHAB implements a **Java type hierarchy** rooted in two marker interfaces: `State` and `Command`, both extending `Type`. Many concrete types implement both — `OnOffType`, `PercentType`, `QuantityType`, `DecimalType`, `HSBType`, `StringType`, and `DateTimeType` are simultaneously valid as states and commands.

This dual nature is architecturally intentional. The package documentation states: "Due to the duality of some types (which can be states and commands at the same time), we need to be able to differentiate what the meaning of a message on the bus is — does 'item ON' mean that its state has changed to ON or that it should turn itself ON?" The distinction is enforced through separate API methods: **`postUpdate(State)`** reports state from a device, while **`sendCommand(Command)`** issues a command to a device.

Each Item type declares ordered lists of `acceptedDataTypes` and `acceptedCommandTypes` — a `DimmerItem` prefers `PercentType` over `OnOffType` because percent carries more information. Some Items are state-only: `ContactItem` accepts `OpenClosedType` as state but cannot receive commands, modeling a read-only sensor at the type level.

**Units of Measurement** use `QuantityType<T extends javax.measure.Quantity<T>>` built on **JSR-385 with the Indriya reference implementation**. This provides first-class unit conversion (`toUnit()`, `toUnitRelative()`), arithmetic operations, and automatic locale-based display conversion. However, issue #2205 documents **false precision problems**: converting `0.1 mm` to inches yields a BigDecimal with scale 36 (`0.003937007874015748031496062992125984 in`) because Indriya doesn't scale after conversion. The issue was closed as "solvable via state descriptions" rather than fixed in the type system.

**UNDEF and NULL** are modeled as an enum `UnDefType` implementing `PrimitiveType, State`:
- `NULL`: Item has never received a state update (the default initial state for all `GenericItem` instances)
- `UNDEF`: State was known but became ambiguous (device communication lost, dimmed light state indeterminate as ON/OFF)

Users consistently confuse these two. Rules must check for both: `if (item.state == NULL || item.state == UNDEF)`. The `expire` metadata defaults to `UNDEF` when timers expire. String items can contain the literal strings "NULL" or "UNDEF", requiring single-quoting in configuration.

### Home Assistant's state-as-string and its consequences

HA's `State` class stores state as **always a Python `str`, max 255 characters**. The `StateMachine` maintains an in-memory dict mapping entity_id to State objects. Each State also carries an untyped `attributes` dict, `last_changed`/`last_updated`/`last_reported` timestamps, and a `Context`.

**The state-as-string design is the foundational type system flaw.** A temperature of 22.5 is stored as `"22.5"`. Templates must parse it: `{{ states('sensor.temp') | float }}`. Binary sensors are `"on"`/`"off"` with string comparison. Special states are string sentinels — `"unknown"` and `"unavailable"` — that must be filtered in every template: `{{ states('sensor.x') | float(0) }}` silently yields 0 for unavailable sensors. There is no compile-time or schema-level type safety.

**Attributes are equally unschematized.** `unit_of_measurement`, `device_class`, `supported_features`, and `friendly_name` all live in the same untyped dict. Accessing a capability requires runtime dict lookups with no validation.

**Command/state separation exists only by convention**, not type enforcement. Commands are service calls dispatched through `ServiceRegistry`; states are entries in the `StateMachine`. There's no equivalent of OpenHAB's `ContactItem` that can receive states but not commands. The absence of formal separation causes the **"UI flipflop" problem**: a user turns on a light, the UI shows ON (optimistic update), then briefly flips to OFF (old state from device poll), then back to ON (device confirmation). Architecture Discussion #740 documents three inconsistent approaches used across integrations (fully optimistic, source-based, hybrid) and proposes unifying optimistic state handling at the StateMachine level. Issue #90399 notes this blocked Z-Wave certification.

**Units of Measurement were retrofitted** onto the string state system. `native_unit_of_measurement` (integration-reported) and `unit_of_measurement` (display) live as attributes, not type metadata. Conversion happens in the entity platform layer. Issue #87123 documents that **changing UoM doesn't rewrite history** — converting from Wh to kWh makes old value `5711 Wh` display as `5711 kWh`. Issue #155586 shows Unicode encoding conflicts (two different Unicode encodings of ㎡) triggering false "unit changed" warnings that suppress long-term statistics.

### State persistence across restarts

**OpenHAB does not persist state by default.** The `restoreOnStartup` strategy requires installing a persistence add-on and explicitly configuring per-item strategies. The documented race condition is severe: "Persistence services and the Rule engine are started in parallel... Rules that rely on persisted Item states may not work correctly on a consistent basis." Rules may execute while items still hold `UnDefType.NULL`. The recommended workaround — a sentinel item with a delay timer — is a documented hack.

**HA's state restoration is fragile.** The `core.restore_state` JSON file is written periodically and read on startup by entities extending `RestoreEntity`. Multiple issues document failures:
- Issue #16837: The recorder saved an entity's default state ("off") before restoration completed, permanently corrupting the restore chain
- Issue #36814: Restore file overwrites correct values with "unknown" seconds after update
- Issue #164802 (March 2026): Docker container lifecycle (SIGTERM → exit) combined with changed `.storage` flush timing leaves stale restore data
- Issue #124931: A bad template sensor inflated `core.restore_state` from 1MB to **981MB**, blocking the event loop and crashing ZHA
- Discussion #797: **All running automations lose state on restart** — wait timers, "for" conditions, and interrupted sequences are not persisted

### ioBroker's ack flag: the most elegant command/state solution

ioBroker embeds the command/feedback distinction directly in the state data structure. Every state carries `ack: boolean` — `false` means "command from user/rule" (desired state), `true` means "confirmed by device" (actual state). The flow: user sets `{val: true, ack: false}` → adapter sees `ack=false`, sends command to device → device confirms → adapter publishes `{val: true, ack: true}`. Additionally, a **quality code** (`q`) field provides an 8-bit degradation indicator (good, general problem, no connection, substitute values) — richer than HA's binary available/unavailable and absent entirely from OpenHAB. An `expire` field enables automatic state invalidation on timeout — neither OpenHAB nor HA has this natively.

### Biggest flaws in the state system

**HA's state-as-string forces constant marshaling** between string representation and typed values, losing precision and type safety at every boundary. The 255-character limit, string sentinel special states, and untyped attributes dict mean that the entire state system operates without schema enforcement. Every consumer must independently handle parsing, type checking, and unavailable/unknown filtering.

**Neither platform solves the command/feedback gap cleanly.** OpenHAB separates command and state at the API level (`sendCommand` vs `postUpdate`) but conflates them at the type level (same `OnOffType` for both). HA has no type-level separation at all. ioBroker's `ack` flag is the only approach that makes the distinction structural and queryable. The absence of this pattern in both major platforms causes optimistic update inconsistencies, UI flipflops, and difficulty detecting stale or unacknowledged commands.

**State restoration is unreliable in both platforms.** OpenHAB's restore-on-startup races with rule engine initialization. HA's restore mechanism has multiple documented failure modes across Docker lifecycles, file corruption, and recorder race conditions. Neither platform persists automation execution state — long-running automations with waits or delays are lost on restart in both systems.

---

## 4. Persistence: bloat versus configuration burden

### OpenHAB's pluggable persistence SPI

OpenHAB defines a three-tier interface hierarchy: `PersistenceService` (base: `store(Item)`), `QueryablePersistenceService` (adds `query(FilterCriteria)`), and `ModifiablePersistenceService` (adds `store(Item, ZonedDateTime, State)` and `remove(FilterCriteria)`). Persistence services register as OSGi services and are called via the event bus — **events drive persistence**, not the reverse.

Available backends include **rrd4j** (round-robin, numeric-only, fixed-size), **MapDB** (key-value, current-state-only, used for `restoreOnStartup`), **JDBC** (MySQL, MariaDB, PostgreSQL, H2 — one table per item), **InfluxDB** (v1 and v2), **MongoDB**, and **DynamoDB**. No persistence is enabled by default — users must explicitly install and configure add-ons.

Configuration uses `.persist` files or the Main UI, specifying **strategies per item group**: `everyChange`, `everyUpdate`, `restoreOnStartup`, cron expressions, and (new in OH 5.x) **filters** for threshold-based deduplication, range inclusion/exclusion, and time-based suppression. OpenHAB 5.1 removed default strategies entirely — every Items definition now requires explicit strategy declarations, a significant breaking change.

**Only Item states are persisted** — not events. You cannot answer "who turned on the light at 3 PM?" from persistence alone. There is no event log, no audit trail, no event replay capability.

The **query API** (`PersistenceExtensions`) is remarkably rich: `persistedState()`, `previousState()`, `maximumSince/Until/Between()`, `minimumSince/Until/Between()`, `averageSince()` with configurable Riemann approximation types (LEFT, RIGHT, MIDPOINT, TRAPEZOIDAL), `medianSince()`, `varianceSince()`, `deviationSince()`, `deltaSince()`, `evolutionRate()`, `countSince()`, and more. All are usable from DSL rules, JavaScript/Blockly rules, and the REST API.

**rrd4j's consolidation permanently destroys granular data** as it ages — you lose the ability to query exact values beyond the 8-hour high-resolution window. NaN gaps from system downtime can corrupt entire consolidation periods when the proportion exceeds the `xff` threshold. The numeric-only limitation forces users to run multiple persistence services simultaneously (rrd4j for charts + MapDB for non-numeric restore), adding configuration overhead.

A critical performance flaw: **query methods load all data into memory** for computation. Methods like `maximumSince()` iterate over `getAllStatesSince()` in Java — large datasets cause memory pressure because computation happens in the OH process, not in the database.

### Home Assistant's monolithic recorder

HA's recorder is a **single SQLAlchemy-based component** running in a dedicated background thread, defaulting to SQLite (`home-assistant_v2.db`). The `Recorder` class extends `threading.Thread`. Events flow from the main thread's `EventBus` through an async callback that filters and enqueues them onto a `SimpleQueue`, which the recorder thread processes in batches committed per `commit_interval` (default **5 seconds**).

The schema (version 48+) has three data domains:

**State tables**: `states` (per-state-change rows with foreign keys to `states_meta` for entity_id mapping and `state_attributes` for deduplicated JSON attribute blobs), linked as a **linked list** via `old_state_id`. Numerous `CHAR(0)` legacy columns (entity_id, attributes, context_id, etc.) remain because SQLite cannot drop columns without full table rebuilds.

**Event tables**: `events` with foreign keys to `event_types` (string→int mapping) and `event_data` (deduplicated JSON blobs). Historically, every `state_changed` event was recorded in both the states AND events tables — community members reported a **30GB events table** largely from this duplication. This was later fixed by not recording `state_changed` in the events table, but the schema legacy remains.

**Statistics tables**: `statistics` (hourly aggregates: mean, min, max, sum — **never automatically purged**) and `statistics_short_term` (5-minute aggregates, purged after ~10 days), both linked to `statistics_meta`. Only sensors with `state_class` get statistics compiled. The compilation pipeline runs every 5 minutes for short-term and hourly for long-term.

**Database bloat is the most complained-about issue in Home Assistant.** Community reports include **95GB** databases (70-day retention), **30GB** events tables from power monitoring, and **8GB** spikes from single misbehaving integrations. Root causes: record-everything default (every entity's every state change), JSON attribute blobs from entities with frequently changing attributes (cameras, media players, weather forecasts), and no per-entity retention policies — `purge_keep_days` is global only.

The **purge mechanism** runs nightly, deleting in batches of 10,000 rows. Issue #117263 (2024.7.x) documents purge causing the recorder to **stop writing entirely** until restart — databases over ~6GB with 7-day retention couldn't complete purge, pegging one CPU core at 100%. After purge, SQLite requires `VACUUM` (repack) to reclaim space, which needs **free disk space equal to the database size**. Auto-repack runs only every 2nd Sunday.

**Schema migrations** have caused data loss. Issue #92650: migration from 2023.3.x to 2023.5.2 failed with `UNIQUE constraint failed: event_types.event_type`, **corrupting the database and losing all history**. Issue #59002: migration 21→22 referenced a column only added in migration 22→23 (ordering bug). Non-live migrations block startup — users report waiting 30+ minutes.

The **recorder queue** has a maximum of 30,000 events. Issue #69508 documents the queue filling when DB writes can't keep up; issue #121854 shows **118,092 events** queued before overflow. When the queue overflows, **data is silently dropped**.

**Query capabilities are severely limited compared to OpenHAB.** There is no Jinja filter equivalent to `sensor.temperature.history(hours=24).average()`. Automations must use the `sql.query` action with raw SQL or the WebSocket `recorder/statistics_during_period` API. The statistics system only works for sensors with `state_class`, excluding binary sensors, text-based entities, and many other data types.

### How the two approaches trade off

OpenHAB's philosophy is **opt-in persistence** — nothing records unless configured, avoiding bloat but requiring significant upfront effort. HA's philosophy is **record everything by default** — history graphs work out of the box, but storage growth is unsustainable without intervention. Neither approach is correct: the ideal is recording by default with intelligent per-entity retention policies and automatic downsampling — essentially what HA is slowly evolving toward with its states/statistics split, but with architecture inverted to make time-series storage the primary engine rather than an afterthought.

### Biggest flaws in persistence

**HA's monolithic recorder is not pluggable.** Unlike OpenHAB's multi-service SPI where different backends serve different data types simultaneously, HA has one recorder writing to one database. You cannot natively route temperature data to InfluxDB and door sensor data to SQLite. The InfluxDB integration is a data export, not a recorder replacement.

**HA has no per-entity retention policies.** Global `purge_keep_days` means you cannot keep 30 days of climate data while keeping only 3 days of motion sensor history. The only granularity is excluding entities entirely from recording.

**OpenHAB's query API loads data into memory** for aggregation — acceptable for small datasets but a memory bomb for large time ranges. HA's limited query API forces raw SQL for anything beyond pre-compiled statistics.

**Neither platform supports event replay or event sourcing.** OpenHAB doesn't persist events at all. HA persists events but provides no replay mechanism — the events table is an audit log, not an event store. This means neither platform can reconstruct system state from its persistence layer or answer counterfactual questions.

**SQLite on Raspberry Pi is architecturally incompatible with HA's record-everything default.** The recorder is the primary cause of SD card failure in HA installations. HA 2025.11 acknowledged duplicate log writes contributing to SD card wear, but the fundamental problem — continuous SQLite writes to flash storage — remains structural.

---

## 5. Cross-cutting concerns: how the subsystems interact and where they break

### Subsystem coupling patterns

In OpenHAB, the event bus is the **primary integration point** between subsystems. The canonical flow is: binding receives device data → Channel-to-Item link propagates update → Item state updates → `ItemStateEvent`/`ItemStateChangedEvent` fires on event bus → persistence services (as event subscribers) persist based on configured strategies → rules engine (as event subscriber) evaluates triggers. The Thing-Channel-Item model provides an explicit indirection layer that keeps subsystems loosely coupled through the event bus. You can swap persistence backends, add new rules engines, or replace UI components without modifying other subsystems.

In Home Assistant, coupling is tighter. The `StateMachine` directly fires events on the `EventBus`. The `Recorder` has deep knowledge of State objects, manages its own table schemas (`StatesMetaManager`, `StateAttributesManager`), and cannot be replaced without modifying core code. The `ServiceRegistry` listens for `call_service` events to dispatch integration handlers. While the event bus is conceptually the integration layer, the subsystems share concrete implementations rather than abstract interfaces.

### Performance on constrained hardware

**OpenHAB on Raspberry Pi** faces JVM-fundamental constraints. GitHub issue openhab-distro#10 was titled "Performance issues on embedded ARM" with the maintainer calling it "**A SEVERE BLOCKER FOR MOVING AHEAD WITH OPENHAB 2**" — Karaf 4 startup took several minutes vs. 30 seconds without Karaf. Community reports include:

- OH3 on RPi3 (1GB RAM): "memory is very tight" — JVM consumes nearly all available RAM
- OH4 on RPi4 (4GB RAM): OOM after 20-30 minutes, suggesting memory leaks
- **70+ minute startup times** on RPi3
- OH5 on RPi5 (8GB): intermittent 100% CPU on all 4 cores

**Home Assistant on Raspberry Pi** suffers primarily from recorder I/O. The default SQLite writes every state change to flash storage. Community reports: after 3 months, "history graphs take 5-10 seconds to load, RPi CPU consistently high due to I/O waits." After 6 months: "startup takes several minutes." HA 2025.11 fixed duplicate log file writes, but the fundamental recorder-to-flash-storage problem remains structural.

### Acknowledged architectural mistakes

**Home Assistant ADRs and architecture discussions** document several reversals: Discussion #1062 acknowledged that silently discarding unchanged state writes was an architectural mistake. The `force_update` flag was a band-aid; the fix required adding `state_reported` and `last_reported` with careful performance engineering to avoid overwhelming the event bus. ADR-0010 (mandatory config flows) addressed YAML fragmentation but created the gap documented in issue #377 — config entries aren't easily editable. Architecture issue #143 identified YAML vs. UI configuration fragmentation as a systematic problem.

**OpenHAB's acknowledged issues** include the Thing lifecycle model's problems with dynamic channels (issue #4048) — channels not created on restart, battery devices stuck in `CONFIG_PENDING` for weeks, channels disappearing. The OH1→OH2 backward compatibility layer was called out in architectural analysis as having "caused a lot of added complexity." Each major version transition (OH2→3→4→5) required Java version changes, scripting engine migrations, and binding API updates.

### The breaking changes tax

**HA's monthly release cycle** includes 20-50 backward-incompatible changes per release. Community frustration is pervasive: "Not a single release which did not include any breaking changes"; "I should not be afraid to update"; "I've just registered this account to tell you that I am so breaking-update tired." The 2026.3 release broke light automations by removing attributes (kelvin, color_temp) without deprecation repair notifications.

**OpenHAB's breaking changes** are less frequent but more severe — major version jumps (OH2→3→4→5) each require significant migration effort. The tradeoff: HA breaks things often in small ways; OpenHAB breaks things rarely but catastrophically.

### Alternative platform insights worth noting

**ioBroker's process isolation model** — each adapter runs as a separate Node.js process communicating via Redis pub/sub — provides natural fault isolation that neither OpenHAB (in-process OSGi bundles) nor HA (in-process Python integrations) achieves. A crashed adapter cannot take down the core system.

**Domoticz's C++ implementation** delivers dramatically lower resource usage on constrained hardware — it runs comfortably on original Raspberry Pi hardware where both HA and OpenHAB struggle. The architectural lesson: a smart home platform's runtime overhead directly constrains its deployment footprint, and neither Python nor JVM is ideal for embedded use cases.

**Hubitat's Capability model** provides a more formalized version of HA's entity domains — devices declare capabilities (e.g., "Switch", "TemperatureMeasurement") that standardize commands and attributes. The sandboxed Groovy execution environment prevents malicious or buggy community code from crashing the hub — a safety mechanism neither HA nor OpenHAB implements.

## Conclusion

The four subsystems reveal a fundamental architectural tension in both platforms. **OpenHAB made the right abstractions but the wrong tradeoffs on complexity** — its Thing-Channel-Item indirection, strongly-typed state system, and pluggable persistence are architecturally superior, but the configuration burden drives users away. **Home Assistant made the right tradeoffs on usability but the wrong abstractions** — its entity_id string coupling, state-as-string typing, and monolithic recorder create debt that compounds with installation size and age.

Three genuinely unsolved problems span both platforms. First, **the command-feedback loop** has no clean architectural model — ioBroker's `ack` flag is the closest any platform comes, and it's merely a convention, not an enforced protocol. Second, **state restoration across restarts** is unreliable in both systems due to race conditions between persistence restore and rule/automation engine initialization. Third, **neither platform has backpressure or bounded resource consumption** in its event bus — both can be overwhelmed by event storms with no graceful degradation.

For a competing platform's architecture, the key lessons are: embed command/state semantics in the data model (ioBroker's insight), provide pluggable persistence with per-entity strategies (OpenHAB's insight), make entity identity stable and separate from human-readable names (neither platform has solved this), implement bounded event queues with explicit overflow policies (neither platform has this), and treat time-series data as a first-class storage concern rather than an afterthought bolted onto a relational schema.