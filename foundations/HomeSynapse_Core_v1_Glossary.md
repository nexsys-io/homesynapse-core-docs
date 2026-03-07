# HomeSynapse Core — Glossary

**Document type:** Governance (Foundations Layer)
**Status:** Locked
**Version:** 1.0
**Effective date:** 2026-02-22
**Owner:** nick@nexsys.io
**Register:** A (Senior Engineer)
**Companion document:** Identity and Addressing Model v1

---

## 0. About This Document

This document defines the canonical vocabulary for HomeSynapse Core. Every design document, API specification, configuration schema, event schema, and user-interface label produced during any development phase must use terms as defined here. Deviations require a formal amendment.

The glossary defines *what terms mean*. The companion Identity and Addressing Model defines *how addressable objects are identified, referenced, and resolved* — identifier formats, slug generation rules, path composition, device replacement semantics, and the three-layer identity architecture. Where a glossary entry touches identity concerns, it states the concept and points to the Identity and Addressing Model for the specification.

### 0.1 Relationship to other artifacts

| Artifact | Relationship |
|---|---|
| Identity and Addressing Model v1 | Specifies identifier formats, addressing rules, and operational semantics for the vocabulary defined here. |
| Architecture Invariants v1 | Glossary entries operationalize invariant requirements. Cited by INV-XX-NN. |
| Locked Technical Decisions Register v1 | Technology choices constrain storage formats and serialization. Cited by LTD-NN. |
| Design Document Template | Subsystem designs reference this glossary for all terminology. |
| DAS Consolidated Reference v1 | Governs general writing vocabulary (§2). This glossary governs domain-specific terms. |
| MVP Scope | §4 tiered approach determines which terms are MVP-active vs. reserved. |
| Event Model & Event Bus (Design Doc 01) | Defines the event envelope schema, event type taxonomy, event bus architecture, and processing modes. This glossary defines the vocabulary; the Event Model defines the operational contracts. Where this glossary and the Event Model overlap, the Event Model is authoritative for envelope field semantics, event type definitions, and delivery guarantees. |
| Device Model & Capability System (Design Doc 02) | Defines device, entity, and capability data structures, lifecycle events, and validation contracts. This glossary defines the vocabulary; the Device Model defines the behavioral contracts. Where this glossary and the Device Model overlap, the Device Model is authoritative for capability schemas, entity type composition rules, and discovery pipeline semantics. |

### 0.2 The three-layer contract

Every glossary entry specifies three layers:

**Concept term.** The precise, durable definition used in design documents and architecture discussions. Concept terms rarely change; when they do, the old term becomes a documented alias with a migration note.

**UI term.** The user-facing label in dashboards, configuration wizards, error messages, and documentation. UI terms may be friendlier or more context-specific than concept terms, but each UI term maps to exactly one concept term. UI terms may evolve through copy changes and localization without affecting the concept or API layers.

**API token.** The stable, code-facing name used in wire formats: configuration files (YAML keys), event schemas (JSON field names), REST/WebSocket API payloads, and published JSON Schema definitions. API tokens are hard contracts. They change only through a formal deprecation process: deprecated tokens continue to function for at least one major version (INV-CS-06), and the deprecation is documented in release notes, configuration validation warnings, and this glossary.

API tokens are wire-format names, not Java field names. In Java source code, fields and methods use standard `camelCase` naming (`entityRef`, `homeId`, `displayName`). The mapping between Java `camelCase` and wire-format `snake_case` is handled globally by Jackson's `PropertyNamingStrategy.SNAKE_CASE` (LTD-08). Explicit `@JsonProperty` annotations are reserved for the rare edge cases where the automatic mapping produces the wrong result.`

### 0.3 Naming conventions

All API tokens use `snake_case`. Dotted notation (`capability.attribute`) is used for hierarchical addressing within payloads. Hyphenated `kebab-case` is used for slugs (see Identity and Addressing Model §3). Java domain fields corresponding to API tokens use standard `camelCase` (`entityRef`, `homeId`, `displayName`); the `snake_case` form is the serialized wire representation, mapped automatically by Jackson (LTD-08).

The `*_id` suffix denotes a ULID-format stable identifier. The `*_ref` suffix is an alias for `*_id` used in contexts where the term "reference" clarifies intent — event payloads, automation bindings, permission targets. The `*_slug` suffix denotes a human-readable, mutable key. These conventions are specified in full in the Identity and Addressing Model.

### 0.4 Term selection principle

Prefer the market-common noun where it reduces friction for users migrating from other platforms. Coin HomeSynapse-specific terms only when the concept is genuinely distinct from what existing platforms offer. The research basis for this principle spans Home Assistant, Google Home, Apple HomeKit, SmartThings, Amazon Alexa, Matter, W3C WoT, and OpenHAB. §10 documents every rejected alternative and the rationale.

### 0.5 Amendment process

Amendments to concept terms or API tokens require:

1. A pull request modifying this document with a rationale section.
2. An impact analysis identifying every design document, schema, and API surface affected.
3. Review by the architecture owner.
4. A migration note in this document and in the relevant changelog.

UI term changes require a pull request with rationale and a DAS consistency check.

---

## 1. Core Topology

These terms define the spatial and organizational hierarchy of a HomeSynapse installation.

### 1.1 Home

**Concept.** A single HomeSynapse installation. The Home is the top-level administrative and data boundary: one SQLite database, one event log, one configuration tree, one set of users and permissions. A Home corresponds to a running HomeSynapse process and its persistent state directory (`/var/lib/homesynapse/`).

A physical household with one HomeSynapse instance has one Home. Multi-instance deployments (post-MVP) each constitute a separate Home; coordination between Homes is a future capability that the identity model does not prevent (INV-PR-04).

**UI term.** Home

**API tokens.**
- `home_id` — ULID (LTD-04). Assigned at first run. Immutable.
- `home_slug` — Defaults to `home`; user-configurable.

**Invariants.** INV-LF-01 (operates without internet), INV-CE-02 (zero-configuration first run — a Home is created automatically).

### 1.2 Area

**Concept.** A named physical zone used for spatial organization and automation targeting. Areas typically correspond to rooms but may represent any user-defined physical region: a floor segment, yard section, garage bay, or building wing.

Areas are flat within a Home — they do not nest. Grouping across Areas is handled by Labels (§1.5). This model aligns with Home Assistant, Google Home, HomeKit, and SmartThings, all of which use flat room structures. For the rationale behind rejecting nested Areas, see §10.1.

Devices and Entities are assigned to Areas. An Entity may optionally override its parent Device's Area assignment when physical placement differs from the Device's primary location — a wireless temperature sensor Entity assigned to a different room than its parent hub Device, for example.

**UI term.** Area (with "Room" accepted as a contextual alias in user-facing copy where it improves clarity)

**API tokens.**
- `area_id` — ULID. Immutable.
- `area_slug` — Unique within the Home. Mutable via rename.
- `area_ref` — Alias for `area_id` in event payloads and automation bindings.

**Invariants.** INV-CS-02 (stable identifiers — `area_id` does not change on rename).

### 1.3 Floor

**Concept.** An optional grouping of Areas representing a physical level of a building. Floors have a display order (integer) enabling vertical spatial representation in the UI. An Area belongs to at most one Floor. Areas without a Floor assignment remain valid; Floors without Areas are valid but serve no function.

**UI term.** Floor

**API tokens.**
- `floor_id` — ULID. Immutable.
- `floor_slug` — Unique within the Home.
- `floor_order` — Integer. Determines vertical display order (lower values = lower floors). Negative values represent below-grade levels.

**MVP status.** Tier 2. The Area data model includes a nullable `floor_id` field from day one to avoid schema migration when Floors are introduced.

### 1.4 Zone (reserved)

**Concept.** A logical or geometric region that does not necessarily correspond to a physical room boundary. Zones enable spatial targeting that overlaps or subdivides Areas: a "couch zone" within a living room, a "driveway zone" defined by a camera's field of view, or a geofence around the property. Zone boundaries may be defined by coordinates, by presence sensor coverage, or by arbitrary logical grouping.

**UI term.** Zone

**API tokens.** `zone_id`, `zone_slug`, `zone_ref` — reserved; not implemented in MVP.

**MVP status.** Reserved for Tier 2+. The Area and Presence models must not prevent Zone introduction. The presence system must support sub-Area resolution so that Zones can refine spatial targeting without replacing the Area model.

### 1.5 Label

**Concept.** A cross-cutting organizational tag applicable to any addressable object: Devices, Entities, Areas, Automations. Labels serve two purposes: UI organization (filtering, grouping) and automation targeting (an action can target "all Entities with label `outdoor-lights`"). Labels are not hierarchical and carry no inherent semantics — they are user-defined strings. Operational semantics defined in Identity & Addressing Model §7.

This concept follows the same pattern as Home Assistant's Labels (2024.4) — a cross-cutting primitive separate from the spatial hierarchy.

**UI term.** Label

**API tokens.**
- `label_id` — ULID. Immutable.
- `label_slug` — Unique within the Home.
- `labels[]` — Array of `label_id` values on any addressable object.

**Invariants.** INV-TO-02 (deterministic evaluation requires Labels to resolve to a stable set of Entities at evaluation time). **Operational rule:** Label membership is resolved once, at the moment the Trigger fires. Entities added to or removed from a Label after the Trigger fires but before that Run's Actions complete are not included in that Run's target set.

---

## 2. Device Model

These terms define how physical hardware and its logical capabilities are represented. The separation between Device (physical container), Entity (logical function), and Capability (behavioral contract) is the core structural decision of the device model.

### 2.1 Device

**Concept.** A representation of a physical product that participates in a protocol network. A Device is a container: it groups one or more Entities that expose the product's capabilities. A single Zigbee smart plug is one Device exposing an on/off Entity and possibly a power-monitoring Entity. A Hue bridge is one Device that also acts as a Bridge (§2.8) for the bulbs it manages.

The Device carries metadata that is hardware-specific: manufacturer, model, serial number, firmware version, and Hardware Identifiers (§8.7) for protocol-level matching. The Device does not carry state — state lives on its child Entities. A Device always belongs to exactly one Integration (§2.9).

This concept maps to: Home Assistant's "Device" in the device registry, Google Home's "HomeDevice," Apple HomeKit's "Accessory," SmartThings' "Device," Matter's "Node," and OpenHAB's "Thing." HomeSynapse uses "Device" because it is the most widely understood term across platforms and among end users.

**UI term.** Device

**API tokens.**
- `device_id` — ULID (LTD-04). Immutable. Assigned by HomeSynapse at Discovery or manual creation, not derived from protocol addresses.
- `device_slug` — Derived from Display Name. Mutable via rename.
- `device_ref` — Alias for `device_id`.

**Key properties (metadata).**
- `manufacturer` — String. From Discovery or manual entry.
- `model` — String. From Discovery or manual entry.
- `serial_number` — String. Optional.
- `firmware_version` — String. Optional.
- `hardware_identifiers` — Set of `(namespace, value)` tuples. See §8.7 and Identity and Addressing Model.
- `area_id` — Nullable. Spatial assignment.
- `integration_id` — Required. Owning Integration.
- `labels[]` — Optional. Cross-cutting tags.

**Invariants.** INV-CE-04 (protocol agnosticism — `device_id` does not embed protocol information), INV-CS-02 (stable identifiers — `device_id` survives renames, moves, and firmware updates).

### 2.2 Entity

**Concept.** The smallest addressable unit of state and control in HomeSynapse. An Entity represents a single logical function: a light channel, a relay, a temperature sensor, a battery charge level, a lock actuator. Entities are the primary subjects of Events, automation references, dashboard widgets, and API operations.

Every Entity belongs to exactly one Device, or is a standalone Helper Entity (§2.10) with no backing hardware. Every Entity exposes one or more Capabilities (§2.3). A simple on/off switch exposes `on_off`; a dimmable light exposes `on_off` and `dimmable`; an HVAC unit might expose `climate`, `temperature_measurement`, and `humidity_measurement` on a single Entity. The `entity_type` (§2.11) determines which Capability combinations are valid. The Entity is the level at which state is tracked, events are emitted, and commands are accepted.

This concept maps to: Home Assistant's "Entity," SmartThings' "Component + Capability," Apple HomeKit's "Service," Matter's "Endpoint," and OpenHAB's "Channel → Item" (with the Channel-to-Item indirection collapsed). HomeSynapse uses "Entity" because it is already the dominant term in the local-first smart home ecosystem and avoids the confusion of "Endpoint" (overloaded in networking) or "Service" (overloaded in software architecture).

**UI term.** Entity (the UI typically displays the Entity's Display Name and Capability-appropriate controls rather than the word "Entity" itself)

**API tokens.**
- `entity_id` — ULID (LTD-04). Immutable. The primary binding key for automations, event streams, materialized views, and all internal references. Never derived from names, areas, or protocols.
- `entity_slug` — Unique within the Home. Derived from the Entity's Display Name at creation. Mutable via rename.
- `entity_ref` — Alias for `entity_id`.
- `entity_type` — See §2.11.

**Key properties.**
- `display_name` — See §8.5.
- `device_id` — Nullable. Parent Device. Null for Helper Entities.
- `capabilities[]` — Required. One or more Capability IDs.
- `area_id` — Nullable. Overrides parent Device's area if set.
- `labels[]` — Optional.
- `enabled` — Boolean. Disabled Entities do not receive Commands or emit state-change Events.
- `availability` — See §8.6.

**Invariants.** INV-CS-02 (stable identifiers), INV-CE-04 (protocol-agnostic), INV-MU-01 (entity identifier scheme accommodates user-scoped state without breaking shared state model).

### 2.3 Capability

**Concept.** A typed contract describing what an Entity can do or report. A Capability defines: a set of Attributes (§2.4) representing observable state, a set of Commands (§2.5) representing actions that can be taken, and the semantic relationship between them (the `turn_on` Command sets the `on` Attribute to `true`).

Capabilities are the platform's extensibility surface for device behavior. HomeSynapse core defines a standard Capability set covering common device functions. Integrations may define custom Capabilities for device-specific features, subject to extension API stability guarantees (INV-CE-05).

This concept aligns with the capability/trait/interface pattern used across the industry: Google Home's "Traits," SmartThings' "Capabilities," Alexa's "Interfaces," Matter's "Clusters," and OpenHAB's "Channel Types." HomeSynapse uses "Capability" because it is more widely understood than Google's "Trait" and avoids Java's `interface` keyword overloading.

**UI term.** Capability (often implicit — the UI renders Capability-appropriate controls rather than displaying the word)

**API tokens.**
- `capability_id` — String key (e.g., `on_off`, `dimmable`, `temperature_measurement`, `energy_meter`). Namespaced: core Capabilities use bare names; Integration-defined Capabilities use `integration_name.capability_name`.
- `capabilities[]` — Array of `capability_id` values on an Entity.

**Standard Capability set (MVP / Tier 1).**

| `capability_id` | Attributes | Commands | Typical Entity Types |
|---|---|---|---|
| `on_off` | `on` (boolean) | `turn_on`, `turn_off`, `toggle` | light, switch, plug |
| `dimmable` | `brightness` (0–100 integer) | `set_brightness` | light |
| `color_temperature` | `color_temp_kelvin` (integer) | `set_color_temperature` | light |
| `temperature_measurement` | `temperature_c` (float) | *(read-only)* | sensor |
| `humidity_measurement` | `humidity_pct` (float) | *(read-only)* | sensor |
| `illuminance_measurement` | `illuminance_lux` (float) | *(read-only)* | sensor |
| `binary_state` | `active` (boolean) | *(read-only)* | binary_sensor |
| `battery` | `battery_pct` (0–100 integer), `battery_low` (boolean) | *(read-only)* | sensor |
| `contact` | `open` (boolean) | *(read-only)* | binary_sensor |
| `motion` | `detected` (boolean) | *(read-only)* | binary_sensor |
| `occupancy` | `occupied` (boolean) | *(read-only)* | binary_sensor |
| `power_measurement` | `watts` (float) | *(read-only)* | sensor |

Additional Capabilities (color_xy, color_hs, lock, climate, cover, energy_meter, media_player) are defined in Tier 2+ but the Capability registry and schema accommodate them without changes.

**Invariants.** INV-CE-04 (Capabilities describe behavior, not wire format), INV-CE-05 (extension model with stability guarantees).

### 2.4 Attribute

**Concept.** A named piece of state within a Capability. An Attribute has a key, a data type, optional constraints (range, enum values, units), and a current value. Attributes are the atomic unit of observable state. Every state-change Event references the Attribute(s) that changed.

**UI term.** *(Usually hidden. The UI displays Attribute values contextually: "72°F," "85%," "On.")*

**API tokens.**
- `attribute_key` — String key, scoped within a Capability (e.g., `on`, `brightness`, `temperature_c`).
- `attributes{}` — Map of `attribute_key` → value in state representations and event payloads.

### 2.5 Command

**Concept.** A named intent to change an Entity's state through a Capability. A Command has a type, optional arguments, and a target Entity. Commands are **not** direct state mutations — they are requests that produce Events, which in turn update state. This distinction is foundational to the event-sourced model: a Command may be rejected (device unreachable), delayed (queued for retry), or produce unexpected state (firmware disagreement). The Event records what actually happened; the Command records what was requested.

**UI term.** *(Actions — buttons, toggles, sliders. The word "Command" does not appear in the UI.)*

**API tokens.**
- `command_type` — String key, scoped within a Capability (e.g., `turn_on`, `set_brightness`).
- `command_args{}` — Map of argument key → value (e.g., `{"brightness": 75}`).
- `command_target` — `entity_ref` identifying the target Entity.

### 2.6 Protocol Binding

**Concept.** The protocol-specific configuration that connects an Entity's abstract Capability model to a physical device's wire-level interface. A Protocol Binding maps Capability Attributes to protocol-specific data points (Zigbee cluster attributes, Matter cluster attributes, MQTT topics) and Capability Commands to protocol-specific operations.

Protocol Bindings are internal to the Integration that manages a Device. They are not exposed in the public API or user-facing configuration. When a Device changes protocol — a Zigbee bulb replaced with a Matter equivalent, for instance — the Protocol Binding changes but the Entity's `entity_id`, Capability model, and all automation references remain stable. This is the mechanism that delivers protocol agnosticism (INV-CE-04).

**UI term.** *(Not user-facing. May appear in advanced diagnostics as "Protocol details.")*

**API tokens.**
- `protocol` — Enum string: `zigbee`, `zwave`, `matter`, `mqtt`, `wifi_lan`, `ble`, `thread`, `http`, `virtual`.
- `protocol_address` — Opaque string specific to the protocol (e.g., Zigbee IEEE address, Matter fabric-scoped Node ID + Endpoint ID).
- `protocol_binding{}` — Internal structure. Owned by the Integration.

**Invariants.** INV-CE-04 (Protocol Bindings are an implementation detail, never part of the identity or addressing model).

### 2.7 Discovery

**Concept.** The process by which an Integration detects Devices on a protocol network and proposes their creation in HomeSynapse. Discovery may be automatic (Zigbee permit-join, mDNS browsing), manual (user enters an IP address or serial number), or hybrid (scan finds candidates, user confirms). Discovery produces a proposed Device with its Hardware Identifiers and candidate Entities. The user or system policy decides whether to adopt the proposed Device.

Discovered Devices receive HomeSynapse-assigned `device_id` values at adoption, not at discovery. A discovered-but-not-adopted device carries only protocol-level identity. This separation prevents phantom Devices from accumulating in the system.

**UI term.** *(Exposed through the "Add Device" flow. The word "Discovery" may appear as "Searching for devices..." during scanning.)*

**API tokens.**
- `discovery_event` — Event type `device_discovered`. Payload includes protocol, Hardware Identifiers, and proposed Capabilities.
- `adoption_event` — Event type `device_adopted`. Records the assignment of `device_id` and Entity creation.

### 2.8 Bridge

**Concept.** A Device that exposes other Devices through itself. A Bridge is a network intermediary: a Zigbee coordinator, a Hue bridge, a Matter bridge. The Bridge Device has its own `device_id` and may have its own Entities (a coordinator's link quality Entity, for instance). Devices reachable through a Bridge carry a `via_device_id` referencing the Bridge, establishing the physical topology. HomeKit, Matter, and Home Assistant all model bridges as first-class concepts, consistent with this definition.

**UI term.** Bridge

**API tokens.**
- `via_device_id` — On a bridged Device, the `device_id` of its Bridge. Nullable (null for directly connected Devices).
- `bridged_device_ids[]` — On a Bridge Device, the list of `device_id` values it hosts.

### 2.9 Integration

**Concept.** A software component that connects HomeSynapse to an external protocol, service, or data source. An Integration manages Device Discovery, Entity creation, Protocol Binding, Command dispatch, and Event ingestion for all Devices it owns. Each Integration instance corresponds to a single configuration entry and a single protocol connection (one Zigbee coordinator, one MQTT broker).

Integrations run within the Integration Runtime (design document #05), which provides fault isolation (INV-RF-01), resource bounds (INV-PR-03), and lifecycle management. An Integration that crashes does not affect other Integrations or the core system.

This concept maps to: Home Assistant's "Integration" + "Config Entry," SmartThings' "Edge Driver" or "Connected Service," OpenHAB's "Binding." HomeSynapse uses "Integration" because it is the most widely understood term and accurately describes the function.

**UI term.** Integration

**API tokens.**
- `integration_id` — ULID. The identity of a specific installed instance.
- `integration_type` — String key identifying the Integration software (e.g., `zigbee`, `hue`, `mqtt`).
- `integration_operation` — A named function exposed by an Integration that can be invoked from Automation Actions via `invoke_integration`. Integration Operations extend the Action vocabulary beyond Entity Commands — triggering a Zigbee network scan, requesting a firmware update, or initiating a protocol-specific pairing sequence, for example. Each operation is namespaced by `integration_type` (e.g., `zigbee.permit_join`, `hue.activate_entertainment_mode`).

**Invariants.** INV-CE-05 (extension model with stability guarantees), INV-RF-01 (integration isolation), INV-CS-04 (integration API stability).

### 2.10 Helper Entity

**Concept.** An Entity that exists without a backing physical Device. Helpers are user-created logical Entities for use in automations and dashboards: input booleans (virtual switches), input numbers (adjustable thresholds), template sensors (computed values), counters, and timers.

Helpers participate in the event-sourced model identically to device-backed Entities: state changes produce Events, state is derived from the Event Log, and automations reference Helpers by `entity_ref`. A Helper's `device_id` is null. Its `entity_type` identifies it as a specific helper kind.

**UI term.** Helper

**API tokens.**
- Same identity model as Entity (`entity_id`, `entity_slug`, `entity_ref`).
- `device_id` is null.
- `entity_type` includes helper-specific values: `input_boolean`, `input_number`, `input_text`, `input_select`, `template_sensor`, `counter`, `timer`.

### 2.11 Entity Type

**Concept.** An enum string identifying an Entity's functional domain. Entity Type determines which Capabilities are valid for the Entity, how the UI renders it, and which default icon and behavior to apply. Entity Type is set at creation and expected to be stable — casual changes undermine the Capability contract and confuse users.

However, Entity Type is not absolutely immutable. A governed type migration operation (analogous to Device Replacement, §8.4) can change an Entity's type while preserving its `entity_id`, Automation bindings, and Event history. Type migration appends an `entity_type_changed` Event to the Entity Stream, validates the new Capability set against the target type, and may require the user to confirm or adjust Automation references that depend on Capabilities removed by the migration. The identity model's stable Reference guarantee applies: the Entity survives the type change.

**UI term.** *(Implicit. The UI uses Entity Type to select appropriate display widgets, icons, and controls. Users see "Light," "Sensor," "Switch" — the Entity Type presented as a natural label.)*

**API token.** `entity_type`

**Core values (MVP).**

| `entity_type` | Description | Typical Capabilities |
|---|---|---|
| `light` | Controllable light source | `on_off`, `dimmable`, `color_temperature` |
| `switch` | Binary on/off control | `on_off` |
| `plug` | Switchable outlet, often with power monitoring | `on_off`, `power_measurement` |
| `sensor` | Continuous measurement (temperature, humidity, power, illuminance, battery) | `temperature_measurement`, `humidity_measurement`, `illuminance_measurement`, `power_measurement`, `battery` |
| `binary_sensor` | Two-state detection (motion, contact, occupancy) | `motion`, `contact`, `occupancy`, `binary_state` |

**Post-MVP values (reserved).**

`lock`, `climate`, `cover`, `media_player`, `camera`, `vacuum`, `fan`, `valve`, `siren`, `input_boolean`, `input_number`, `input_text`, `input_select`, `template_sensor`, `counter`, `timer`, `energy_meter`, `inverter`, `battery_storage`, `ev_charger`.

---

## 3. Event-Sourced Model

These terms define the event-sourcing architecture. The Event Log is the source of truth. State is derived, not stored directly.

### 3.1 Event

**Concept.** An immutable fact recorded by the system. An Event describes something that happened: a sensor reported a temperature, a user issued a Command, an Automation evaluated a Condition, a Device went offline, a configuration changed. Events are never modified or deleted (INV-ES-01). They are the atoms of the Event Log.

Events carry a defined Event Envelope (§3.9) containing identity, ordering, causality, and payload fields. The payload structure varies by Event Type but is always serialized as JSON (LTD-08).

**UI term.** Event (in diagnostics, audit views, and the trace viewer)

**API tokens.**
- `event_id` — ULID, monotonic within millisecond (LTD-04: `UlidCreator.getMonotonicUlid()`).
- `event_type` — String key identifying the event category. See §3.10 for the core taxonomy.
- `event_time` — Timestamp. The time the fact occurred at its source. May be null for devices without reliable clocks.
- `ingest_time` — Timestamp. The time HomeSynapse appended the Event to the log. Always present, always system-clock-derived.
- `payload{}` — JSON object containing event-type-specific data.

**Timestamp representation.** Timestamps exist in three forms across the system. Storage: integer microseconds since epoch in SQLite columns (efficient range queries, compact storage). Internal Java: `java.time.Instant` (nanosecond-capable, timezone-free). Wire/API: ISO 8601 string at the REST/WebSocket API boundary and in JSON log output (LTD-08 Jackson serialization). The Event Model §4.2 is authoritative for the storage format; LTD-08 governs API serialization.

**Invariants.** INV-ES-01 (immutable events), INV-ES-04 (write-ahead persistence — durable before subscriber delivery), INV-ES-07 (schema evolution — payloads tolerate unknown fields via Jackson `FAIL_ON_UNKNOWN_PROPERTIES=false`, per LTD-08).

### 3.2 Event Log

**Concept.** The append-only, ordered record of all Events. The Event Log is the single source of truth for the entire system. All state — current device values, Automation execution history, system health — is derived from the Event Log either by direct query or through Materialized Views.

The Event Log is stored in SQLite (LTD-03) in WAL mode for concurrent read access during writes. The log supports two ordering dimensions: per-Entity sequences for aggregate consistency, and a global position (SQLite rowid) for cross-Entity subscriptions (LTD-05).

**UI term.** Event Log

**API tokens.**
- `event_log` — The logical name of the log.
- `append()` — The write operation. Internal; not directly exposed via public API.
- `global_position` — SQLite `INTEGER PRIMARY KEY` (rowid). Monotonic across all Entities. Subscribers checkpoint against this value to resume after restart.

**Invariants.** INV-ES-01 (append-only, immutable), INV-ES-04 (write-ahead), INV-RF-04 (crash safety via WAL), INV-RF-05 (bounded storage via Retention Policies).

### 3.3 Entity Stream

**Concept.** The ordered subsequence of Events belonging to a single subject, extracted from the Event Log by filtering on `subject_ref`. The subject may be an Entity, a Device, an Automation, a Person, or a System component — any addressable object that produces or receives Events. Each Event carries a monotonically increasing `subject_sequence` number scoped to its subject, and a write whose sequence already exists is a conflict (LTD-05).

The Entity Stream — a Subject Stream where the subject is an Entity — is the primary and most common variant. Entity Streams are the basis for computing an Entity's current State and for optimistic concurrency control. Device Streams carry lifecycle events (`device_adopted`, `device_removed`, `device_metadata_changed`). Automation Streams carry execution events (`automation_triggered`, `automation_completed`). Person Streams carry presence events (`presence_signal`, `presence_changed`). System Streams carry lifecycle and health events (`system_started`, `config_changed`).

The gap-free integrity guarantee (INV-ES-03) is strongest for Entity Streams: a gap in an Entity's sequence indicates data loss and is treated as a system integrity failure. For other subject types, the sequence provides ordering but gaps are treated as warnings, not integrity failures, because system and lifecycle events may be produced by multiple independent services.

**Subject Stream.** A generalization of the Entity Stream concept: the ordered subsequence of Events belonging to any single addressable subject (Entity, Device, Automation, Person, or System component), extracted from the Event Log by filtering on `subject_ref`. When the subject is an Entity, the Subject Stream is identical to the Entity Stream. The term "Subject Stream" is used in design documents and schemas; "Entity Stream" remains the user-facing concept in the History view. See Identity and Addressing Model §9 for uniqueness scope semantics.

**UI term.** History (when exposed in the Entity detail view as an Entity Stream)

**API tokens.**
- `stream_id` — Equivalent to the subject's Reference (`entity_ref`, `device_id`, `automation_id`, etc.).
- `subject_sequence` — Monotonically increasing integer within the Subject Stream. Part of the unique constraint `(subject_ref, subject_sequence)`. The name reflects that subjects may be Entities, Devices, Automations, Persons, or System components — not exclusively Entities. See Identity and Addressing Model §9. See Glossary §3.3 (Subject Stream).

**Invariants.** INV-ES-03 (per-entity ordering — strongest guarantee for Entity Streams), INV-ES-06 (explainable state changes — every state transition has a corresponding Event in the stream).

### 3.4 State

**Concept.** A derived view of an Entity's current condition, computed from its Entity Stream. State is never stored as the authoritative record — it is always reconstructable from Events. In practice, State is maintained in memory as a Materialized View for performance, but the Event Log remains the source of truth.

State for an Entity includes: current Attribute values, Availability (§8.6), last-change timestamp, and a `state_version` that corresponds to the latest `entity_sequence` processed.

**UI term.** Current state (or the displayed value itself: "72°F," "On," "Locked")

**API tokens.**
- `state{}` — Map of `attribute_key` → current value.
- `state_version` — The `entity_sequence` of the last Event applied to this State.
- `last_changed` — Timestamp of the most recent state-altering Event.
- `last_updated` — Timestamp of the most recent Event (including non-state-altering Events like heartbeats).

**Invariants.** INV-TO-03 (no hidden state — every State value is traceable to an Event).

### 3.5 Materialized View

**Concept.** A persisted, query-optimized projection of data derived from the Event Log. Materialized Views trade storage for read performance: instead of replaying an Entity's full Event Stream to answer a query, the system maintains a pre-computed view that is incrementally updated as new Events arrive.

Materialized Views are always rebuildable from the Event Log. If a view is corrupted, it can be dropped and reconstructed without data loss. The State Store (design document #03) is the primary Materialized View; others may exist for analytics, dashboards, or energy monitoring.

**UI term.** *(Not user-facing. May appear in diagnostics as "View status.")*

**API tokens.**
- `view_name` — String identifying the view (e.g., `entity_state`, `automation_history`, `energy_daily`).
- `view_version` — Schema version of the view's structure.
- `view_position` — The `global_position` of the last Event processed into this view.

### 3.6 Checkpoint

**Concept.** A snapshot of a Materialized View at a specific point in the Event Log, used to accelerate recovery. Instead of replaying the entire Event Log from the beginning after a restart, the system loads the most recent Checkpoint and replays only Events after the Checkpoint's position.

Checkpoints are periodically written to SQLite (LTD-03). They are non-authoritative — if a Checkpoint is missing or corrupted, the system falls back to full replay. Checkpoint frequency is a tunable tradeoff between recovery time and write overhead on constrained hardware (INV-PR-01).

**UI term.** *(Not user-facing.)*

**API tokens.**
- `checkpoint_id` — ULID.
- `checkpoint_position` — The `global_position` at which the Checkpoint was taken.
- `checkpoint_time` — Timestamp.

### 3.7 Causality Chain

**Concept.** The linked sequence of Events that explains why something happened. Every Event optionally carries a `correlation_id` (tracing an entire causal conversation from initiating action through all downstream effects) and a `causation_id` (identifying the immediate preceding Event that caused this one). These fields enable "why did this happen?" queries that traverse from a device state change back through Automation evaluation, through the triggering Event, to the original user action or sensor reading.

This pattern follows Greg Young's correlation/causation model for event-sourced systems (LTD-05).

**UI term.** "Caused by..." (in trace/audit views), "Trace" (in Automation debugging)

**API tokens.**
- `correlation_id` — ULID. Non-null. The root Event's `event_id`, propagated unchanged to all downstream Events in the same causal chain. For root Events (external stimuli with no prior Event cause), `correlation_id` equals the Event's own `event_id`. This non-null invariant means trace queries never need to special-case root Events — every Event participates in a traceable chain. See Event Model §4.1 for the authoritative specification.
- `causation_id` — ULID. Nullable. The `event_id` of the immediately preceding Event in the chain. Null for root Events only.

**Invariants.** INV-ES-06 (explainable state changes), INV-TO-01 (system behavior is observable).

### 3.8 Event Bus

**Concept.** The internal publish-subscribe mechanism that distributes Events to Subscribers after they are persisted to the Event Log. The Event Bus is not a separate message broker — it is an in-process notification layer built on top of the Event Log (LTD-11: no external message broker dependency). Persistence happens first (write-ahead, INV-ES-04); the Event Bus then notifies Subscribers that new Events are available.

The Event Bus supports one subscription mode: global (receive all Events by `global_position`). Subscribers maintain their own checkpoint and request Events from their last-processed position forward. Per-Entity reads (Events for a specific `subject_ref` by `subject_sequence`) are served by the `EventStore` query interface, not by a bus subscription mode. See Event Model §3.4 for the authoritative subscription specification.

**UI term.** *(Not user-facing. Operational concept only.)*

**API tokens.**
- `event_bus` — The logical name. Internal subsystem.
- `subscribe()`, `poll()` — Internal operations. Not exposed via public API.

**Invariants.** INV-ES-04 (write-ahead — bus delivers only after persistence), INV-ES-05 (at-least-once delivery), LTD-11 (no external message broker).

### 3.9 Event Envelope

**Concept.** The standard wrapper structure carried by every Event in the Event Log. The Envelope defines the fields that the core system requires for routing, ordering, storage, querying, and causality tracing. Integration-specific data lives in the `payload{}` field; Envelope fields are owned by the core. The Event Model & Event Bus (Design Doc 01) §4.1 is the authoritative specification for envelope semantics; this entry provides the vocabulary definition.

**Required fields (non-null on every Event):**

| Field | Type | Description |
|---|---|---|
| `event_id` | ULID | Globally unique, monotonic within millisecond (LTD-04). |
| `event_type` | String | Category key identifying the Event's type (§3.10). |
| `schema_version` | Integer | Positive integer identifying the payload schema version for this Event type. Starts at 1. Drives the upcaster chain for schema evolution (INV-ES-07). |
| `ingest_time` | Timestamp | System clock at append time. Always present. See §3.1 for timestamp representation layers. |
| `subject_ref` | ULID | The Entity, Device, Automation, Person, or System component this Event is about. |
| `subject_sequence` | Integer | Monotonically increasing within the subject's event stream. Used for optimistic concurrency: `(subject_ref, subject_sequence)` is a unique constraint. See §3.3 for Subject Stream semantics. |
| `global_position` | Integer | SQLite rowid. Monotonic across all subjects. Subscribers checkpoint against this value. |
| `priority` | Enum | One of: `CRITICAL`, `NORMAL`, `DIAGNOSTIC`. Governs retention lifetime and delivery urgency. Does not affect append-time durability — all Events are persisted with identical write-ahead guarantees (INV-ES-04). See Event Model §3.3. |
| `origin` | Enum | One of: `PHYSICAL`, `USER_COMMAND`, `AUTOMATION`, `DEVICE_AUTONOMOUS`, `INTEGRATION`, `SYSTEM`, `UNKNOWN`. Default: `UNKNOWN`. See §8.9 for semantics. |
| `correlation_id` | ULID | The root Event's `event_id`, propagated unchanged through all downstream Events in the same causal chain. For root Events, equals the Event's own `event_id`. Non-null for all Events — trace queries never need to special-case roots. See §3.7. |
| `payload` | JSON Object | Event-type-specific data. Structure varies by `(event_type, schema_version)`. |

**Nullable fields (present on the envelope but may be null):**

| Field | Type | Description |
|---|---|---|
| `event_time` | Timestamp (nullable) | When the real-world occurrence happened, as reported by the Event source. Null if the source has no reliable clock. See INV-ES-08. |
| `causation_id` | ULID (nullable) | The `event_id` of the immediately preceding Event in the causal chain. Null for root Events only. See §3.7. |
| `actor_ref` | ULID (nullable) | The User identity attributable to this Event, per INV-MU-01 semantics (§5.4). Null when no User is attributable. |

**Invariants.** INV-ES-01 (immutable once persisted), INV-ES-03 (per-subject ordering via `subject_sequence`), INV-ES-04 (write-ahead via `global_position`), INV-ES-06 (explainable via `correlation_id` + `causation_id` + `actor_ref` + `origin`), INV-ES-07 (schema evolution via `schema_version`), INV-ES-08 (event_time vs ingest_time distinction), INV-MU-01 (optional user identity with defined semantics), LTD-04 (ULID format), LTD-05 (dual ordering), LTD-08 (Jackson JSON serialization).

### 3.10 Event Type Taxonomy (MVP Core)

**Concept.** The `event_type` field carries a string key identifying the Event's category. The core system defines the types below for MVP. Integrations may define additional types namespaced as `{integration_name}.{event_type}` (e.g., `zigbee.network_map_updated`). The Event Model & Event Bus (Design Doc 01) §4.3 is the authoritative specification for event type definitions, producer boundaries, and priority assignments.

**State lifecycle:**

| `event_type` | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `state_reported` | Entity | Integration Adapter | DIAGNOSTIC | Raw attribute observation from an integration. Carries `attribute_key` and `value`. Always DIAGNOSTIC — significance is expressed through derived `state_changed`. |
| `state_changed` | Entity | State Projection (core) | NORMAL | Derived: the reported value differs from canonical state. Carries `old_value`, `new_value`, and `triggered_by` (the `event_id` of the causal `state_reported`). Automations subscribe to this, not to `state_reported`. |
| `state_confirmed` | Entity | Pending Command Ledger (core) | NORMAL | Derived: the reported value matches a pending Command's expected outcome within the Capability's tolerance band. Closes the intent-to-observation loop. |
| `state_report_rejected` | Entity | Device Model Validator (core) | DIAGNOSTIC | An integration produced an attribute value that failed validation against the Capability's attribute schema. |

**Command lifecycle:**

| `event_type` | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `command_issued` | Entity | API Layer / Automation Engine | NORMAL | A Command was dispatched toward the Entity. Carries command type, parameters, desired value, and actor reference. |
| `command_dispatched` | Entity | Command Dispatch Service (core) | DIAGNOSTIC | The Integration adapter accepted the Command for protocol delivery. |
| `command_result` | Entity | Integration Adapter | NORMAL (success) / CRITICAL (failure, timeout) | The protocol-level outcome: acknowledged, rejected, or timed out. |
| `command_confirmation_timed_out` | Entity | Pending Command Ledger (core) | DIAGNOSTIC | The expected state report did not arrive within the confirmation timeout. Evidence for diagnosis, not an error. |

**Device lifecycle:**

| `event_type` | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `device_discovered` | Device | Integration Adapter | NORMAL | A new Device was detected on the protocol network. |
| `device_adopted` | Device | Core (user-initiated) | NORMAL | A discovered Device was accepted into the system. |
| `device_removed` | Device | Core (user-initiated) | NORMAL | A Device was removed from the system. |
| `device_metadata_changed` | Device | Core | DIAGNOSTIC | Mutable Device metadata changed (firmware version, configuration parameters reported by the device). Does not cover identity fields (manufacturer, model, serial) which are immutable registry properties. |
| `entity_profile_changed` | Entity | Core | NORMAL | An Entity's declared Capability set or feature map changed. |
| `entity_transferred` | Entity | Core (user-initiated) | NORMAL | Physical hardware was swapped behind a stable Entity identity (see Identity and Addressing Model §5). |
| `entity_type_changed` | Entity | Core (migration) | NORMAL | Entity Type was migrated via governed type migration (§2.11). |
| `availability_changed` | Entity/Device | Integration Adapter / Core | CRITICAL (to offline) / NORMAL (to online) | Reachability status changed. |

**Automation lifecycle:**

| `event_type` | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `automation_triggered` | Automation | Automation Engine | NORMAL | A Trigger condition was met, beginning a Run. |
| `automation_completed` | Automation | Automation Engine | NORMAL | A Run finished with a terminal status (success, failure, aborted). |
| `automation_capability_mismatch` | Automation | Core | NORMAL | An Automation references a Capability that no longer exists on a target Entity. |

**Presence:**

| `event_type` | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `presence_signal` | Person | Integration Adapter | DIAGNOSTIC | A raw Presence Signal was received (Wi-Fi probe, BLE beacon, GPS geofence). |
| `presence_changed` | Person | Presence Projection (core) | NORMAL | Derived Presence state was updated (home, away, unknown). |

**System:**

| `event_type` | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `system_started` | System | Core Runtime | CRITICAL | HomeSynapse process started. |
| `system_stopped` | System | Core Runtime | CRITICAL | HomeSynapse process is shutting down. |
| `config_changed` | System | Core Runtime | NORMAL | Configuration was modified. |
| `migration_applied` | System | Core Runtime | CRITICAL | A schema migration completed. |
| `snapshot_created` | System | Core Runtime | CRITICAL | A backup Snapshot was created. |
| `system_storage_critical` | System | Core Runtime | CRITICAL | Disk space has fallen below the emergency threshold. |
| `system_registry_rebuilt` | System | Core Runtime | CRITICAL | The Device/Entity registry was rebuilt from the Event Log. |

**Telemetry:**

| `event_type` | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `telemetry_summary` | Entity | Aggregation Engine (core) | DIAGNOSTIC | A periodic summary of telemetry data promoted from the Telemetry Ring Store. |

**Health / Subscriber:**

| `event_type` | Subject | Producer | Default Priority | Description |
|---|---|---|---|---|
| `subscriber_checkpoint_expired` | System | Event Bus | CRITICAL | A Subscriber's checkpoint has fallen behind the retention boundary. |
| `subscriber_falling_behind` | System | Event Bus | NORMAL | A Subscriber's checkpoint is more than a configurable threshold behind the log head. |
| `causality_depth_warning` | System | Causal Chain Projection | DIAGNOSTIC | A causal chain has exceeded the configured depth threshold. |

**Producer boundary rules.** Integration adapters produce only: `state_reported`, `command_result`, `availability_changed`, `device_discovered`, and `presence_signal`. All derived and lifecycle event types are produced exclusively by core services. This separation ensures that interpretation is centralized — an integration's responsibility ends at raw observation; whether that constitutes a change, confirms a command, or triggers an automation is the core's determination. See Event Model §3.1 for the full producer boundary specification.

### 3.11 Subscriber

**Concept.** A component that consumes Events from the Event Bus to perform work: updating a Materialized View, evaluating Automation Triggers, dispatching notifications, computing analytics. Subscribers maintain their own checkpoint (the `global_position` or `entity_sequence` of the last Event they successfully processed) and are responsible for Idempotency (§3.12) — the ability to safely reprocess an Event they have already seen.

Subscribers resume from their checkpoint after restart. The combination of persistent checkpoints and at-least-once delivery (INV-ES-05) guarantees that no Event is lost, at the cost of requiring Subscribers to handle duplicates.

**UI term.** *(Not user-facing. Internal architecture concept.)*

**API tokens.**
- `subscriber_id` — String identifying the Subscriber (e.g., `state_store`, `automation_engine`, `energy_view`).
- `subscriber_position` — The checkpoint: `global_position` or `entity_sequence` last processed.

### 3.12 Idempotency

**Concept.** The property that processing the same Event more than once produces the same result as processing it exactly once. Idempotency is required of all Subscribers (§3.11) because the Event Bus guarantees at-least-once delivery (INV-ES-05, LTD-06). After a crash and restart, a Subscriber may reprocess Events between its last persisted checkpoint and the actual last-processed Event. Idempotent handling ensures this reprocessing is safe.

For state-projecting Subscribers (the State Store), idempotency is achieved by checking `entity_sequence`: if the Event's sequence is less than or equal to the view's `state_version`, the Event is a duplicate and is skipped. For side-effecting Subscribers (notification dispatch), idempotency requires deduplication by `event_id`.

**UI term.** *(Not user-facing. Engineering concept.)*

**API tokens.** No dedicated token. Idempotency is a behavioral contract on Subscriber implementations, enforced through testing (design document #01, testing strategy).

### 3.13 State Projection

**Concept.** A core Subscriber that compares incoming `state_reported` Events against canonical State and produces `state_changed` Events when a reported value differs from the current value. The State Projection is the bridge between raw integration observations and meaningful state transitions. It is the sole producer of `state_changed` Events — integrations never produce this type directly.

The State Projection also interacts with the Device Model's validation layer: only `state_reported` Events that pass attribute validation (type, range, unit conformance) are eligible to produce `state_changed` Events. Invalid reports produce `state_report_rejected` Events instead.

**UI term.** *(Not user-facing. Internal architecture concept.)*

**API tokens.** No dedicated token. The State Projection is identified by its Subscriber ID (`state_projection`) in checkpoint and health systems.

**Invariants.** INV-ES-02 (state derivable from events — the State Projection is the mechanism), INV-ES-06 (explainable state — `state_changed` carries `triggered_by` linking to the causal `state_reported`), INV-TO-03 (no hidden state — every value in the State Store traces to a `state_changed` Event).

### 3.14 Pending Command Ledger

**Concept.** A core Subscriber that tracks in-flight Commands and correlates them with incoming state reports. The Ledger exists to answer the question: "did the command work?"

When a `command_issued` Event is appended, the Ledger records the command's target Entity, target attribute, desired value, and a tolerance band (provided by the Capability definition via the Device Model's `ExpectationFactory`). When a subsequent `state_reported` Event carries a value within the tolerance band, the Ledger produces a `state_confirmed` Event linking the original command to the confirming report. If no matching report arrives within the confirmation timeout, the Ledger produces a `command_confirmation_timed_out` Event.

**UI term.** *(Not directly user-facing. Effects are visible in the command status indicator: "Confirmed," "Pending," "Timed out.")*

**API tokens.** No dedicated token. The Ledger is identified by its Subscriber ID (`pending_command_ledger`) in checkpoint and health systems.

**Invariants.** INV-ES-06 (explainable state — the Ledger closes the intent-to-observation loop), INV-TO-01 (observable — command confirmation status is visible in the trace viewer).

### 3.15 Event Priority

**Concept.** A required field on every Event that governs retention lifetime and delivery urgency without affecting append-time durability. All Events are persisted with identical write-ahead guarantees (INV-ES-04) regardless of priority.

| Priority | Retention (default) | Delivery | Examples |
|---|---|---|---|
| `CRITICAL` | 365 days | Never coalesced | `system_started`, `availability_changed` (to offline), `subscriber_checkpoint_expired` |
| `NORMAL` | 90 days | Never coalesced | `state_changed`, `command_issued`, `device_adopted`, `automation_triggered` |
| `DIAGNOSTIC` | 7 days | May be coalesced under Backpressure (§3.17) | `state_reported`, `command_dispatched`, `presence_signal`, `telemetry_summary` |

Priority assignment is static by default — each Event type has a default priority defined in the taxonomy (§3.10). Integration adapters may elevate a specific Event instance from DIAGNOSTIC to NORMAL but not to CRITICAL, and never downward.

**UI term.** *(Not directly user-facing. The retention policy settings reference priority tiers.)*

**API tokens.**
- `priority` — Enum: `CRITICAL`, `NORMAL`, `DIAGNOSTIC`.

**Invariants.** INV-ES-04 (write-ahead — priority does not affect durability), INV-RF-05 (bounded storage — priority-based retention prevents unbounded growth).

### 3.16 Processing Mode

**Concept.** A property of a Subscriber's execution context that governs whether side effects are permitted during Event processing. Processing Mode is not an Event-level tag — a replayed Event retains its original Origin (§8.9) and payload.

| Mode | When Active | Side Effects |
|---|---|---|
| `LIVE` | Subscriber has reached the log head during normal operation. | Actuator commands permitted; derived Events emitted; external notifications permitted. |
| `REPLAY` | Subscriber catching up from a checkpoint behind the log head (startup recovery). | Actuator commands suppressed; derived Events emitted (projections need them in the log); notifications suppressed. |
| `PROJECTION` | Subscriber rebuilding a Materialized View from scratch. | All side effects suppressed — projection is consuming, not producing. |
| `DRY_RUN` | Automation testing or what-if analysis. | Logged to dry-run audit, not executed. |

**UI term.** *(May appear in diagnostics as "Subscriber mode" or "Replay in progress.")*

**API tokens.**
- `processing_mode` — Enum: `LIVE`, `REPLAY`, `PROJECTION`, `DRY_RUN`.

**Invariants.** INV-TO-02 (automation determinism — REPLAY mode suppresses actuator commands to prevent unintended physical effects during catch-up).

### 3.17 Backpressure and Coalescing

**Concept.** Backpressure is a Subscriber-local mechanism that activates when a Subscriber's unprocessed backlog exceeds a configurable threshold. During backpressure, the Event Bus may coalesce specific DIAGNOSTIC Event types — delivering only the most recent value per `(subject_ref, attribute_key)` and advancing the Subscriber's checkpoint past intermediate Events.

Only the following DIAGNOSTIC Event types are coalescable: `state_reported`, `presence_signal`, and `telemetry_summary`. All other DIAGNOSTIC Events and all NORMAL and CRITICAL Events are delivered individually regardless of backpressure.

Coalescing means that a Subscriber may never process an intermediate `state_reported` value that was superseded by a newer report during an Event storm (e.g., mesh recovery after a power outage). The Events are still persisted in the Event Log — coalescing affects only the delivery path.

**UI term.** *(Not user-facing.)*

**API tokens.** No dedicated token. Coalescing activation is reported via the `hs_events_coalesced_total` metric and `subscriber_falling_behind` Events.

**Invariants.** INV-ES-05 (at-least-once delivery — the guarantee is unconditional for CRITICAL and NORMAL Events; coalescable DIAGNOSTIC types have weaker delivery semantics under backpressure).

### 3.18 Causal Chain Projection

**Concept.** A core Subscriber that indexes Causality relationships for efficient querying. It maintains an index mapping `correlation_id` to the ordered list of `event_id` values in that chain, enabling the "why did this happen?" trace query.

The projection also monitors chain depth. When a chain exceeds a configurable threshold (default: 50 Events), it produces a `causality_depth_warning` DIAGNOSTIC Event, serving as an early indicator of potential Automation loops.

**UI term.** *(Powers the "Trace" view in the observability UI.)*

**API tokens.** No dedicated token. Exposed through the trace query API endpoint.

**Invariants.** INV-ES-06 (explainable state — the projection is the query mechanism), INV-TO-01 (observable — makes causal chains navigable).

### 3.19 Telemetry Ring Store

**Concept.** A separate persistence path for high-frequency raw samples that would overwhelm the domain Event Log if treated as full Events. The Telemetry Ring Store is a separate SQLite database (`homesynapse-telemetry.db`) that stores raw measurements without the full Event Envelope — no sequence numbers, no causality metadata, no Subscriber delivery.

The boundary criterion: if a data source produces more than one sample per 10 seconds sustained for a single Entity, it is a telemetry stream candidate. An aggregation engine (owned by the Persistence Layer) reads from the ring store on configurable intervals and produces domain Events (`telemetry_summary`) when meaningful thresholds are crossed.

Telemetry data is not covered by INV-ES-01 through INV-ES-05. Losing telemetry means losing raw granularity within the retention window, not losing canonical state.

**UI term.** *(Not directly user-facing. May appear in storage diagnostics.)*

**API tokens.** No dedicated token. Telemetry data is accessed through the unified query API.

**Invariants.** INV-RF-05 (bounded storage — separate file isolates write pressure), INV-EI-01 (energy as first-class domain — energy monitoring at per-second frequency uses the telemetry path).

### 3.20 Capability Instance

**Concept.** A Capability (§2.3) as instantiated on a specific Entity, including its `version`, `namespace`, and `feature_map`. A Capability Instance represents what a particular Entity actually supports — which may be a subset of the Capability's full contract. For example, the `brightness` Capability defines a `transition_ms` parameter guarded by feature bit 1; a specific bulb's Capability Instance may have `feature_map = 0` (transition not supported).

**Feature Map.** A bitmask declaring which optional features of the Capability are supported on this Entity. Feature maps are stable per Entity — changes require an `entity_profile_changed` Event. Feature maps may differ across Entities sharing the same Capability type.

**UI term.** *(Implicit. The UI uses the feature map to show or hide optional controls.)*

**API tokens.**
- `capability_id` — String key identifying the Capability type.
- `feature_map` — Integer bitmask.
- `version` — Integer. The Capability schema version this Entity was adopted against.
- `namespace` — String. `core` for standard Capabilities; `{integration_type}.{name}` for custom.

### 3.21 Attribute Schema

**Concept.** The type, constraints, unit, permissions, and nullability definition for a single attribute within a Capability. Attribute schemas enable generated UI controls, automated validation, and deterministic Pending Command Ledger behavior.

| Schema Property | Description |
|---|---|
| `type` | One of: `BOOLEAN`, `INT`, `FLOAT`, `STRING`, `ENUM`. |
| `minimum`, `maximum`, `step` | Numeric constraints. |
| `valid_values` | Enum constraint: the set of permitted string values. |
| `unit` | Physical unit (per JSR 385 or lightweight equivalent). Present for physical quantities. |
| `permissions` | Set of: `READ`, `WRITE`, `NOTIFY`. |
| `nullable` | Whether the attribute may carry a null value. |
| `persistent` | Whether the attribute's value survives device power cycles. |

**Tolerance Band and Expected Outcome.** Each Command defined by a Capability declares expected outcomes: the attribute changes it should produce, with tolerance bands. A tolerance band defines the range within which a reported value is considered to match a commanded value. For example, `set_brightness(75%)` with tolerance `±2` considers brightness values 73–77 as confirmation. Tolerance bands are Capability-owned — they are not defined ad hoc by automations or users. The Pending Command Ledger (§3.14) consumes tolerance bands via `Expectation` objects to evaluate command confirmation.

**UI term.** *(Implicit. Attribute schemas drive control rendering: sliders for numeric ranges, toggles for booleans, dropdowns for enums.)*

**API tokens.**
- `attribute_key` — String identifying the attribute within a Capability.
- `type`, `minimum`, `maximum`, `step`, `valid_values`, `unit`, `permissions`, `nullable`, `persistent` — Schema properties.

### 3.22 Custom Capability

**Concept.** A Capability registered at runtime through the `CapabilityRegistry` service, defined via JSON schema rather than as a compiled sealed interface. Custom Capabilities enable Integrations to expose protocol-specific features that are not covered by standard Capabilities.

Custom Capabilities are namespaced: `{integration_type}.{capability_name}` (e.g., `zigbee_tuya.datapoint_102`). They must declare a stability level (`EXPERIMENTAL`, `STABLE`, or `DEPRECATED`), may not shadow standard Capability IDs, and participate in the Event system identically to standard Capabilities.

**UI term.** *(Labeled with the stability level in the UI to prevent portability illusions.)*

**API tokens.**
- `capability_id` — String key with namespace prefix.
- `stability` — Enum: `EXPERIMENTAL`, `STABLE`, `DEPRECATED`.
- `namespace` — String. Always matches the Integration type.

### 3.23 Discovery Pipeline

**Concept.** The staged process by which a physical device becomes a managed Device with Entities in HomeSynapse. The pipeline has three stages:

**Stage 1 — Detection.** An Integration detects a device on its protocol network and produces a `device_discovered` Event carrying protocol-specific identity, hardware identifiers, proposed Capabilities, and proposed Entity structure.

**Stage 2 — Proposal.** The discovered device enters a "proposed" state. The system checks hardware identifiers against the `DeviceIdentifiers` registry for deduplication: if a match is found, the device is recognized as an existing device (re-pairing) and re-linked without user intervention.

**Stage 3 — Adoption.** The user accepts a proposed device. The system generates `device_id` and `entity_id` values, registers hardware identifiers, validates Capability compositions, and produces a `device_adopted` Event.

Discovery does not create identity. Until adoption, the device carries only Hardware Identifiers. References (§8.1) are assigned at adoption time.

**UI term.** *(The proposal stage is surfaced as "New devices found" in the dashboard.)*

**API tokens.** No dedicated tokens beyond the Event types: `device_discovered`, `device_adopted`.

**Invariants.** INV-CS-02 (stable identifiers — identity assigned at adoption, not discovery), INV-CE-04 (protocol agnosticism — hardware identifiers are internal).

### 3.24 Entity Type Composition

**Concept.** The rules governing which Capabilities are required and optional for a given Entity Type (§2.11). Entity Type composition follows Matter's device type model: each Entity Type declares a set of required Capabilities that must be present for the type to be valid, and a set of optional Capabilities that may be present. Capabilities not in either set are permitted but generate a validation warning.

Entity Type determines required Capabilities. If an Integration proposes an Entity with Capabilities that match a known type's required set, the system auto-classifies. If the Capabilities do not match any known type, the Entity requires explicit type assignment.

**UI term.** *(Implicit. The UI uses Entity Type composition to validate device setup and surface warnings.)*

**API tokens.** No dedicated tokens. Entity Type composition is defined in the Device Model & Capability System design document §3.10.

**Invariants.** INV-CE-04 (protocol agnosticism — Entity Types are protocol-independent classifications).

---

## 4. Automation Model

These terms define the Trigger-Condition-Action (TCA) automation framework. TCA is the dominant automation model across the smart home industry: Home Assistant, SmartThings, Google Home, Alexa, and OpenHAB all use variants of it. HomeSynapse adopts TCA because it is well-understood by users migrating from other platforms and maps to the event-sourced model without friction — Triggers subscribe to Events, Conditions query State, Actions issue Commands that produce Events.

### 4.1 Automation

**Concept.** A named, declarative rule that reacts to Events or State conditions and issues Commands or emits Events. An Automation consists of one or more Triggers, zero or more Conditions, and one or more Actions. Automations are first-class citizens in the event-sourced model: their creation, modification, execution, and deletion produce Events in the Event Log.

Automations bind to Entities by stable `entity_ref` values, never by slugs, Display Names, or Paths. See the Identity and Addressing Model for the full binding specification.

**UI term.** Automation

**API tokens.**
- `automation_id` — ULID. Immutable.
- `automation_slug` — Mutable.
- `automation_ref` — Alias for `automation_id`.

**Invariants.** INV-TO-02 (automation determinism — same inputs produce same outputs), INV-CS-02 (automations survive Entity renames because they bind to stable refs).

### 4.2 Trigger

**Concept.** A predicate that initiates an Automation evaluation. A Trigger watches for a specific pattern: an Event of a given type, a State transition (`on` → `off`), a time schedule (cron expression), a numeric threshold crossing, or a Presence change. When the Trigger fires, the Automation's Conditions are evaluated.

Triggers subscribe to the Event Bus, not to polled State. State changes always produce Events, and Triggers react to those Events. This is a consequence of the event-sourced architecture, not a design choice that could go either way.

**UI term.** Trigger (or "When..." in guided automation builders)

**API tokens.**
- `trigger{}` — JSON object defining the trigger predicate.
- `trigger_type` — Enum: `state_change`, `state`, `event`, `availability`, `numeric_threshold`, `time`, `sun`, `presence`, `webhook`. The first five types are implemented in Tier 1; `time`, `sun`, `presence`, and `webhook` are Tier 2 (schema defined, implementation deferred). See Automation Engine §3.4 for the full trigger type specification.

### 4.3 Condition

**Concept.** A boolean guard evaluated during Automation execution, after the Trigger fires but before Actions execute. Conditions check current State (not Events): "is the sun below the horizon," "is the living room temperature below 20°C," "is Alice home." If any Condition evaluates to false, the Automation's Actions are skipped for this Run.

Conditions and Triggers serve different temporal roles. Triggers answer "did something happen?" (event-reactive). Conditions answer "is something true right now?" (state-evaluative).

**UI term.** Condition (or "Only if..." in guided builders)

**API tokens.**
- `condition{}` — JSON object defining the boolean predicate.
- `condition_type` — Enum: `state`, `numeric`, `time`, `and`, `or`, `not`, `zone`. The first six types are implemented in Tier 1; `zone` is Tier 2 (requires presence infrastructure and zone definition model). See Automation Engine §3.8 for the full condition type specification.

### 4.4 Action

**Concept.** A step executed when an Automation's Trigger fires and all Conditions pass. Actions issue Commands to Entities, wait for durations or conditions, branch on State, emit custom Events, or invoke Integration Operations (§2.9). Actions execute in sequence by default; parallel execution is opt-in and explicitly declared.

**UI term.** Action (or "Then..." in guided builders)

**API tokens.**
- `action{}` — JSON object defining the step.
- `action_type` — Enum: `command`, `delay`, `wait_for`, `condition_branch`, `emit_event`, `invoke_integration`, `activate_scene`, `parallel`. The first five types are implemented in Tier 1; `invoke_integration`, `activate_scene`, and `parallel` are Tier 2+ (schema defined, implementation deferred). See Automation Engine §3.9 for the full action type specification.

### 4.5 Run

**Concept.** A single execution instance of an Automation, from Trigger evaluation through Action completion or failure. Every Run produces Events in the Event Log that record: the Trigger that fired, the Condition evaluation results, each Action attempted and its outcome, and the final Run status. Runs enable the Trace viewer — a complete "why did this happen" narrative for every Automation execution.

**UI term.** Run

**API tokens.**
- `run_id` — ULID.
- `run_status` — Enum: `running`, `completed`, `failed`, `aborted`, `condition_not_met`.
- `trace{}` — Structured record of the Run's execution path (§7.1).

**Invariants.** INV-TO-01 (observable), INV-TO-02 (deterministic), INV-ES-06 (explainable).

### 4.6 Scene (reserved)

**Concept.** A named, user-defined snapshot of desired Entity states that can be activated as a single Action. A Scene captures "living room movie mode" as a set of target Attribute values across multiple Entities. Activating a Scene issues Commands to each participating Entity.

Scenes are syntactic sugar over Automation Actions — they compile down to a set of Commands. Google Home, Alexa, and HomeKit all treat scenes as named command batches.

**UI term.** Scene

**API tokens.** `scene_id`, `scene_slug`, `scene_ref` — reserved for Tier 2+.

---

## 5. User Identity, Permissions, and Presence

These terms define the human identity model. HomeSynapse distinguishes between system accounts (Users), household members (Persons), and their spatial context (Presence). This separation acknowledges a reality that most platforms ignore: not every household member has or wants a login account, yet the system must still support identity-aware behavior for them (INV-MU-01).

### 5.1 User

**Concept.** An authenticated account that can log in, issue Commands, configure the system, and be attributed as an Actor in the Event Log. Users authenticate via credentials managed by HomeSynapse (INV-SE-01 — no default credentials; INV-SE-02 — authentication required for all interfaces).

A User is always linked to exactly one Person. Multiple Users may link to the same Person in edge cases (a household member with both a local account and an SSO account), though the common case is one-to-one.

**UI term.** User

**API tokens.**
- `user_id` — ULID. Immutable.
- `user_ref` — Alias for `user_id`.
- `username` — String. Unique within the Home. Mutable.

### 5.2 Person

**Concept.** A household member identity used for preferences, Presence, and identity-aware Automation. A Person may or may not have a corresponding User account. A child tracked by presence sensors but without a login account is a Person. A guest with temporary physical access but no system account is a Person.

The Person concept exists because the identity-aware device model (INV-MU-01) and spatial presence system (INV-MU-02) require a notion of "who is here" that is broader than "who is logged in." Preference profiles, Presence State, and Automation Conditions reference Persons, not Users.

**UI term.** Person

**API tokens.**
- `person_id` — ULID. Immutable.
- `person_ref` — Alias for `person_id`.
- `person_slug` — Human-readable slug.
- `user_ids[]` — Linked User accounts. May be empty.

**MVP status.** The Person entity and its link to User are MVP. Preference profiles and arbitration algorithms are post-MVP (INV-MU-01 MVP scope).

### 5.3 Role

**Concept.** A named permission scope assigned to a User, defining what actions are permitted on what targets. The MVP implements two roles; the permission infrastructure is designed for the full taxonomy specified in INV-MU-04.

| Role | Scope | MVP |
|---|---|---|
| `admin` | Full control and configuration | Yes |
| `member` | Device control, limited configuration | Yes |
| `restricted` | Constrained device control, no configuration | Post-MVP |
| `guest` | Temporary, scoped, auto-expiring access | Post-MVP |

**UI term.** Role

**API tokens.**
- `role_id` — String key (e.g., `admin`, `member`).
- `roles[]` — Array of `role_id` values assigned to a User.

**Invariants.** INV-MU-04 (household role model), INV-SE-02 (authentication and authorization on all interfaces).

### 5.4 Actor

**Concept.** The identity attributable to an Event or Command. The Actor field in the Event Envelope (§3.9) follows the semantics defined in INV-MU-01:

- **Present and populated:** The Event is directly attributable to a specific User action (dashboard interaction, API call, voice command associated with an identity).
- **Present and set to a causal reference:** The Event was produced by an Automation or system process triggered by a user-originated Event. The Actor carries the originating User's identity, enabling "who caused this?" traces through Automation chains back to the initiating human.
- **Null:** The Event has no meaningful user identity. Most sensor readings, protocol-level updates, and system maintenance Events carry a null Actor. The system does not require producers to fabricate identity where none exists.

The Actor always references a `user_ref`, not a `person_ref`. Attribution flows through authenticated accounts; the Person model handles preference and presence, not audit trails.

**UI term.** "Performed by" (in event detail views)

**API tokens.**
- `actor_ref` — ULID (nullable). References a `user_id`. Carried in the Event Envelope.

### 5.5 Permission

**Concept.** A grant defining what actions a subject (User/Role) may perform on what targets (Entities, Devices, Areas, system functions). Permissions are evaluated at every API call, Command dispatch, and UI interaction. The permission model is subject-action-object: "User X may execute Commands on Entities in Area Y."

**UI term.** Permissions

**API tokens.**
- `permission{}` — Structure: `{subject_ref, action, object_ref, object_type}`.
- `action` — Enum: `read`, `control`, `configure`, `admin`.

**Invariants.** INV-MU-04 (role enforcement consistent across all interfaces).

### 5.6 Presence

**Concept.** A first-class fact about where a Person is or is not, maintained as derived State with explicit confidence and freshness metadata. Presence is not a sensor value — it is a system-level assertion synthesized from one or more Presence Signals and subject to defined degradation behavior (§5.8).

Presence at the Area level ("Alice is in the living room") is the primary granularity. Zone-level Presence ("Alice is on the couch") is a future refinement that the model accommodates without structural change (§1.4).

Home Assistant, Google Home, Alexa, and SmartThings treat presence as a derived or integration-specific concept. HomeSynapse treats it as a core architectural primitive (INV-MU-02).

**MVP status.** Tier 1 includes: Presence as a data model concept, the `presence_state` / `presence_changed` event types, and basic home/away Presence derived from a single source (geofence or device tracker). Room-level Presence (Area-scoped), multi-source sensor fusion, and confidence/freshness scoring are Tier 2. The API tokens below are defined for the full model; MVP implementations may omit `presence_confidence` and `presence_freshness_ms`.

**UI term.** Presence

**API tokens.**
- `presence_state` — Per-Person, per-Area: `present`, `absent`, `unknown`.
- `presence_confidence` — Float (0.0–1.0). Reflects sensor reliability and recency.
- `presence_freshness_ms` — Milliseconds since the last supporting Presence Signal.

### 5.7 Presence Signal

**Concept.** A raw input from a presence-detection source, before synthesis into Presence State. Presence Signals are Events in the Event Log with source-specific data: a BLE beacon detection, a UWB coordinate update, a mmWave radar occupancy reading, a Wi-Fi probe request, a device interaction inference.

The Presence system consumes Presence Signals from multiple sources, applies sensor fusion logic, and produces Presence State updates. Signal sources have different accuracy, latency, and cost profiles (INV-MU-02: BLE at approximately $5–10 per node for room-level resolution, UWB at approximately $15 per module for sub-meter accuracy).

**MVP status.** Tier 1 supports a single Presence Signal source per Person (geofence or device tracker), producing binary home/away state without sensor fusion. Multi-source ingestion and fusion algorithms are Tier 2. The `presence_signal_type` enum is defined for the full model; MVP implementations may support only `geofence` and `device_interaction`.

**UI term.** *(Not directly user-facing. May appear in Presence diagnostics as "Signal sources.")*

**API tokens.**
- `presence_signal_type` — Enum: `ble_beacon`, `uwb_coordinate`, `mmwave_occupancy`, `wifi_probe`, `device_interaction`, `geofence`, `manual`.
- Carried in standard Event Envelope with `event_type` = `presence_signal`.

### 5.8 Identity Degradation

**Concept.** The defined fallback behavior when the identity or presence system is degraded. Degradation follows a strict hierarchy specified in INV-MU-05:

1. **Identity uncertain** (Person detected but not identified): Apply the most permissive common preference set, or the explicitly configured house default preferences.
2. **Presence unknown** (no recent Presence Signals): Maintain last known Presence State until a staleness threshold is exceeded, then transition to `unknown`.
3. **Identity subsystem offline** (presence sensors down, identity service unavailable): Fall back to non-identity-aware operation. The system behaves as if all registered Persons are present. Physical controls remain functional.

Identity Degradation never locks anyone out of their home or prevents physical device control (INV-HO-01).

**UI term.** *(Surfaced as warnings: "Presence detection unavailable" or "Identity system degraded.")*

**API tokens.**
- `degradation_mode` — Enum: `normal`, `identity_uncertain`, `presence_unknown`, `identity_offline`.
- `identity_confidence` — Float (0.0–1.0). System-level assessment of identity reliability.

---

## 6. System and Operations

### 6.1 Configuration

**Concept.** The set of YAML files (LTD-09) that define a Home's setup: Integrations, Devices, Entities, Automations, Users, Areas, and system parameters. Configuration is canonical and human-readable (INV-CE-01), versioned (INV-CE-03), and zero-configuration for first run (INV-CE-02). Configuration files reside in `/etc/homesynapse/` (LTD-13).

**UI term.** Configuration (or "Settings" for specific configuration pages)

**API tokens.**
- `config_version` — Integer. Schema version of the configuration format.

### 6.2 Retention Policy

**Concept.** Rules governing how long Events are retained in the Event Log before compaction or archival. Retention Policies balance storage constraints (INV-RF-05) against the value of historical data. Policies may differ by Event Type: sensor readings might retain for 30 days with downsampling, while audit Events might retain indefinitely.

Retention does not violate the immutability invariant (INV-ES-01): expired Events are removed from the log, not modified. The event log after retention still constitutes a valid — truncated — event stream. Subscribers whose checkpoints reference removed Events will fast-forward to the earliest available position.

**UI term.** Retention Policy

**API tokens.**
- `retention_policy{}` — Structure defining rules per Event Type or Entity Type.
- `retention_days` — Integer. Default retention period.

### 6.3 Migration

**Concept.** A forward-only schema transformation applied to the SQLite database, configuration files, or event schemas during system upgrades (LTD-07). Migrations run automatically during the startup sequence, after the mandatory pre-update Snapshot (INV-CS-05). Migrations are never backward — rolling back requires restoring from the Snapshot.

**UI term.** *(Not user-facing during normal operation. Appears in upgrade progress as "Applying updates...")*

**API tokens.**
- `migration_version` — Integer. Monotonically increasing.
- `migration_status` — Enum: `pending`, `applied`, `failed`.

### 6.4 Snapshot

**Concept.** A complete, restorable backup of the system state taken before an upgrade or on demand. Snapshots include the SQLite database file (Event Log + Materialized Views), configuration directory, and metadata. They are the foundation of update safety (INV-CS-05). Snapshots include the SQLite database files (the domain Event Log with Materialized View checkpoints, and optionally the Telemetry Ring Store), the configuration directory, and metadata. The domain Event Log backup is mandatory for correctness; the Telemetry Ring Store backup is optional — its absence means losing raw telemetry granularity, not domain state.

The Telemetry Ring Store (§3.19) is not included in the standard Snapshot/Checkpoint scope. Loss of telemetry samples means losing raw numeric granularity, not canonical state. The backup system treats telemetry inclusion as optional (see Persistence Layer §3.10).

**UI term.** Backup

**API tokens.**
- `snapshot_id` — ULID.
- `snapshot_path` — Filesystem path in `/var/lib/homesynapse/backups/` (LTD-13).
- `snapshot_time` — Timestamp.

---

## 7. Observability

### 7.1 Trace

**Concept.** A structured record of an Automation Run's execution path, capturing every decision point: which Trigger fired, what each Condition evaluated to and why, what each Action did and whether it succeeded. Traces are the user-facing manifestation of the Causality Chain (§3.7) applied to Automation execution. They enable a complete "why did this happen?" narrative viewable in the UI.

**UI term.** Trace (in the automation debugging view)

**API tokens.**
- `trace{}` — Structured object within a Run Event.
- `trace_id` — The `correlation_id` of the Automation Run's causal chain.

### 7.2 Health

**Concept.** A subsystem's self-reported operational status, used to build the system-wide health dashboard. Each subsystem — Event Bus, State Store, Integration Runtime, each Integration instance — reports one of three states.

| State | Meaning |
|---|---|
| `healthy` | Operating normally within performance targets |
| `degraded` | Operating but outside normal parameters (high latency, intermittent failures) |
| `unhealthy` | Not operating or operating with data loss risk |

**UI term.** System Health

**API tokens.**
- `health_status` — Enum: `healthy`, `degraded`, `unhealthy`.
- `health_details{}` — Subsystem-specific diagnostic information.

**Invariants.** INV-TO-01 (observable), INV-HO-04 (self-explaining errors).

---

## 8. Cross-Cutting Vocabulary

These terms appear across multiple sections and subsystems. Identity-related terms are defined here at the concept level; the Identity and Addressing Model specifies their formats, generation rules, uniqueness scopes, and operational semantics.

### 8.1 Reference

**Concept.** A ULID-based identifier that serves as the immutable, opaque, internal identity of any addressable object in HomeSynapse. References are the **only** identifiers used for machine-to-machine binding: Automations reference Entities by `entity_ref`, Events reference their subjects by `subject_ref`, Permissions reference targets by `object_ref`.

References are immutable (assigned once, never changed), opaque (not derived from names, areas, or protocols), and time-ordered (ULIDs sort lexicographically by creation time). The `*_ref` suffix in API tokens is a **contextual alias** for the corresponding `*_id` — they carry the same ULID value. `entity_id` and `entity_ref` are identical; the `_ref` form is used in event payloads, automation bindings, and permission targets to signal "this field is a stable binding key," while the `_id` form is used in the Entity's own record as its primary key. No system should ever store or compare them differently.

For identifier format specification (ULID encoding, storage as BLOB(16), Crockford Base32 at API boundaries), see the Identity and Addressing Model.

**Invariants.** INV-CS-02 (stable identifiers), LTD-04 (ULID format and storage).

### 8.2 Slug

**Concept.** A human-readable, URL-safe string derived from a Display Name, used for Paths, configuration file references, and debugging output. Slugs are mutable — they update when the user renames the object. Slugs use lowercase ASCII alphanumeric characters and hyphens.

For slug generation algorithm, uniqueness scope rules, collision resolution, and maximum length, see the Identity and Addressing Model.

**API tokens.** The `*_slug` suffix: `entity_slug`, `device_slug`, `area_slug`, `automation_slug`.

### 8.3 Path

**Concept.** A human-readable, hierarchical string composed from Slugs that locates an object within the Home's organizational structure. Paths are **display addresses** — useful for UI breadcrumbs, log messages, debugging, and optional manual configuration entry. Paths are never used as binding keys for Automations, Event Streams, or internal references. When a user renames an Entity or moves it to a different Area, the Path changes; the Reference does not.

For path format specification and composition rules, see the Identity and Addressing Model.

### 8.4 Entity Transferring

**Concept.** The operation of transferring a logical identity (an Entity and its history) from one physical device to another. When a physical device fails and is replaced with compatible hardware, Device Replacement preserves the Entity's `entity_id`, all Automation bindings, all historical Events, Area assignment, Labels, and Display Name. Only the Protocol Binding and Hardware Identifiers change.

For the operational specification (step-by-step semantics, event recording, cross-Integration replacement), see the Identity and Addressing Model.

**UI term.** Replace Device

**API tokens.**
- `entity_transferred` — Event type. Named from the system's perspective: the Entity is the continuity unit, and the operation transfers that continuity to new backing hardware. See Identity and Addressing Model §5.4 for the event payload specification.

**Invariants.** INV-CS-02 (stable identity survives replacement), INV-CE-04 (protocol change does not affect identity), INV-ES-06 (replacement is an auditable Event).

### 8.5 Display Name

**Concept.** The user-visible, mutable name assigned to any addressable object: "Living Room Lamp," "Front Door Sensor," "Morning Routine." Display Names are free-form strings with no uniqueness constraint — two Entities in the same Area may share a Display Name, though the UI should discourage this.

Display Names are the source from which Slugs are derived. Changing a Display Name triggers Slug regeneration (if the user opts in) but never affects the object's Reference.

**UI term.** Name

**API tokens.**
- `display_name` — String. Present on Entity, Device, Area, Automation, Person, Label.

### 8.6 Availability

**Concept.** An Entity's reachability status, maintained as part of its derived State. Availability reflects whether the system can currently communicate with the Entity's backing Device. It is updated by the Integration that owns the Device, based on protocol-level connectivity checks (heartbeats, message acknowledgments, link quality).

| Value | Meaning |
|---|---|
| `available` | The Entity's backing Device is reachable and responding to commands/queries. |
| `unavailable` | The Device is not reachable. Commands will queue or fail. State may be stale. |
| `unknown` | The system has not yet determined reachability (startup, first discovery). |

Availability transitions produce `availability_changed` Events. Automations can use Availability as a Condition (e.g., skip an Action if the target Entity is unavailable). The UI displays Availability as a visual indicator alongside the Entity's current State.

**UI term.** *(Displayed as an icon or status badge: a warning indicator for `unavailable`, no indicator for `available`.)*

**API tokens.**
- `availability` — Enum: `available`, `unavailable`, `unknown`.

### 8.7 Hardware Identifier

**Concept.** A protocol-level identifier used to match a Device to its physical counterpart across restarts, re-pairings, and network changes. Hardware Identifiers are stored as a set of `(namespace, value)` tuples on the Device, where the namespace identifies the protocol or identifier type and the value is an opaque string.

Examples: `("zigbee_ieee", "00:11:22:33:44:55:66:77")`, `("matter_unique_id", "ABCD1234")`, `("serial", "SN-12345678")`.

Hardware Identifiers are internal to the Integration layer. They are never exposed as primary identifiers, never used in Automation bindings, and never appear in user-facing configuration. When a Device is replaced, the Hardware Identifiers update while the `device_id` remains stable. See the Identity and Addressing Model for the full specification of how Hardware Identifiers interact with the three-layer identity architecture.

**UI term.** *(Not user-facing. May appear in advanced Device diagnostics.)*

**API tokens.**
- `hardware_identifiers` — Set of `(namespace, value)` tuples on Device.

**Invariants.** INV-CE-04 (protocol identifiers never leak into the application-level identity model).

### 8.8 URN Form

**Concept.** A URI-scheme address for unambiguous identification in API responses, webhook payloads, and external integrations. The URN form uses the `hs:` scheme with stable References, not mutable Slugs. URN forms are deterministic and globally unambiguous.

For the format specification, see the Identity and Addressing Model.

**API tokens.** Pattern: `hs:<home_id>/<type>/<object_id>` (e.g., `hs:01HQX.../entity/01HQY...`).

### 8.9 Origin

**Concept.** A required field in the Event Envelope (§3.9) recording the semantic source category of an Event. Origin uses an evidence-based enum — the value is set only when the producer has direct evidence of the origin. Origin enables queries like "show me all Events caused by Automations" or "show me all physical interactions" without parsing the Causality Chain. The Event Model §3.9 is the authoritative specification for origin semantics.

| Value | Meaning | Evidence Required |
|---|---|---|
| `PHYSICAL` | A human physically interacted with a Device. | Protocol-level indicator (Zigbee: ZCL frame type, Z-Wave: button press notification). |
| `USER_COMMAND` | A User issued a Command through the HomeSynapse UI or API. | API request carries authenticated User identity. |
| `AUTOMATION` | An Automation rule produced this Event. | Automation Engine sets this when executing Actions. |
| `DEVICE_AUTONOMOUS` | The Device generated this Event without external stimulus. | Device-initiated reports (battery level, firmware update, scheduled report). |
| `INTEGRATION` | The Integration adapter generated this Event during its own processing. | Adapter self-identifies (initialization, polling cycle, error handling). |
| `SYSTEM` | The HomeSynapse core runtime generated this Event. | Core services self-identify (startup, shutdown, migration, retention). |
| `UNKNOWN` | The origin cannot be determined with confidence. | Default. Assigned when none of the above can be established with evidence. |

`UNKNOWN` is the default. The system never guesses origin from heuristics. If an Integration receives a protocol frame and cannot determine whether it was triggered by a physical button press or a periodic report, the origin is `UNKNOWN`.

There is no `REPLAY` origin value. The Processing Mode (Event Model §3.7) governs replay behavior, not event-level tagging. A replayed Event retains its original origin.

**UI term.** *(Displayed as a source indicator in event detail views: "Physical," "By user," "By automation," "Device," "System.")*

**API tokens.**
- `origin` — Enum (non-null, default `UNKNOWN`): `PHYSICAL`, `USER_COMMAND`, `AUTOMATION`, `DEVICE_AUTONOMOUS`, `INTEGRATION`, `SYSTEM`, `UNKNOWN`.

**Invariants.** INV-ES-06 (explainable state — origin provides classification without requiring full causal chain traversal), INV-HO-01 (physical control — `PHYSICAL` origin enables distinguishing physical interactions from all other sources).

---

## 9. Reserved Terms

These terms are defined at the concept level for forward compatibility. Their API tokens are reserved — they must not be used for other purposes — but are not implemented in MVP.

| Term | Intended Meaning | Target Tier |
|---|---|---|
| **Zone** | Sub-Area or cross-Area geometric region (§1.4) | Tier 2 |
| **Scene** | Named Entity state snapshot, activatable as a single Action (§4.6) | Tier 2 |
| **Script** | Reusable sequence of Actions callable from Automations or manually | Tier 2 |
| **Blueprint** | Parameterized Automation template shareable between users | Tier 3 |
| **Preference** | Per-Person desired state or behavior setting (e.g., preferred temperature) | Tier 2 (INV-MU-01) |
| **Arbitration** | Algorithm for resolving conflicting Preferences when multiple Persons are present | Tier 3 (INV-MU-03) |
| **Device Profile** | Reusable schema defining a Device's expected Entity and Capability structure | Tier 2 |
| **Addon** | Separately deployable software package extending HomeSynapse functionality | Tier 3 |
| **Companion** | Mobile application for remote access and notifications | Tier 3 |
| **Fabric** | Matter trust domain (1:1 with Matter spec usage) | Tier 2 (Matter integration) |
| **Energy Meter** | Entity representing a utility-grade or sub-circuit energy measurement point | Tier 2 (INV-EI-01) |
| **Inverter** | Entity representing a solar inverter or hybrid inverter | Tier 2 (INV-EI-01) |
| **Battery Storage** | Entity representing a stationary battery system (state-of-charge, charge/discharge) | Tier 2 (INV-EI-01) |
| **EV Charger** | Entity representing an electric vehicle charging station | Tier 2 (INV-EI-01) |
| **Tariff** | Time-varying energy pricing structure used in energy optimization Automations | Tier 2 (INV-EI-01) |
| **Grid Signal** | External signal (OpenADR, utility API) indicating grid conditions or demand response events | Tier 3 (INV-EI-01) |

---

## 10. Rejected and Avoided Terms

These terms were evaluated during competitive research across eight platforms and deliberately not adopted.

### 10.1 Rejected core terms

| Rejected Term | Used By | Why Rejected |
|---|---|---|
| **Nested Areas** | *(no platform uses)* | Every major platform (Home Assistant, Google Home, HomeKit, SmartThings) uses flat room models. Home Assistant's 2024.4 release added Floors as a separate flat concept rather than nesting Areas, indicating that the largest open-source smart home community found hierarchical nesting creates more UX complexity than it resolves. HomeSynapse uses flat Areas with optional Floor grouping and cross-cutting Labels. |
| **Thing** | OpenHAB, W3C WoT | Ambiguous in everyday English. "Device" is more precise. OpenHAB's own documentation frequently requires clarifying "Thing (as in device)." |
| **Accessory** | Apple HomeKit | Apple-ecosystem-specific. Users outside the Apple ecosystem do not use this term for smart home hardware. |
| **Endpoint** (as primary device term) | Amazon Alexa, Matter | Overloaded in networking and web development. Acceptable in protocol-specific contexts (Matter endpoint, REST API endpoint) but not as the primary term for a controllable thing. |
| **Channel** (as user-facing term) | OpenHAB | Introduces unnecessary indirection. OpenHAB's Thing → Channel → Link → Item pipeline is flexible but adds configuration overhead that HomeSynapse avoids by collapsing the mapping into the Entity concept. |
| **Item** (as the primary state-bearing unit) | OpenHAB | Requires explaining the Thing/Channel/Item distinction. "Entity" is clearer because it maps directly to "a thing you can see and control." |
| **Trait** | Google Home | Google-specific branding for what the broader industry calls a Capability or Interface. "Capability" is more widely understood and aligns with SmartThings' vocabulary. |
| **Interface** (as the capability type) | Amazon Alexa | Too overloaded in Java and software engineering contexts. "Capability" avoids confusion with Java `interface` declarations. |
| **Cluster** (as user-facing term) | Matter | Matter-protocol-specific. Useful in Protocol Binding internals but too technical for the application-level model. |
| **Routine** | Google Home, Alexa | Both platforms use "Routine" for their automation equivalent. "Automation" is more descriptive and avoids confusion with the time-of-day connotation of "routine." Follows Home Assistant's precedent. |
| **Rule** | OpenHAB | "Rule" implies conditional logic only, missing the reactive/event-driven nature of automations. |
| **Platform** (as HA uses it) | Home Assistant | In HA, "Platform" means "the implementation of a domain within an integration." This term causes widespread confusion even within the HA community. HomeSynapse handles this through Capability registration within Integrations. |
| **Domain** (as HA uses it) | Home Assistant | In HA, "Domain" means the entity type namespace (light, switch, sensor). HomeSynapse uses `entity_type` for this concept, which is self-describing. |
| **Component** (as HA formerly used it) | Home Assistant (pre-2021) | Renamed to "Integration" by HA itself because "component" was too generic. HomeSynapse follows the renamed term. |

### 10.2 Avoided API patterns

These patterns were observed in competing platforms and deliberately avoided. Detailed rationale for the alternative approaches is in the Identity and Addressing Model.

| Pattern | Used By | Why Avoided |
|---|---|---|
| `entity_id` as `domain.object_id` string | Home Assistant | Mutable, name-derived, used as automation binding key. The single most documented pain point in the HA community. |
| `call_service` as action type name | Home Assistant | "Service" is overloaded in Java (`@Service`), REST APIs, and systemd. Importing HA's terminology into a Java codebase creates immediate ambiguity. HomeSynapse uses `invoke_integration` and defines Integration Operation as the named function an Integration exposes. |
| IP address as device identity | Early SmartThings, various | IP addresses change on DHCP lease renewal. SmartThings documentation explicitly warns against this. |
| UUID v4 for event identity | Various | Not time-ordered. ULIDs provide lexicographic time ordering that aids debugging without sacrificing uniqueness (LTD-04). |
| `roomHint` string for room assignment | Google Home | Name-based, not ID-based. Fragile under rename. |
| Opaque developer-assigned IDs | Google, Alexa | Shifts identity management to third-party developers, leading to inconsistent formats and deduplication problems. |
| Single `state_changed` without raw `state_reported` separation | Home Assistant | Conflates raw observation with derived transition. Prevents the core from determining significance — integrations would need to track and compare state, duplicating core logic and creating divergent interpretations across protocols. |
| Global event sequence without per-entity ordering | N/A (anti-pattern) | Creates a single serialization bottleneck on constrained hardware. Per-subject sequences with global position (LTD-05) provide both aggregate consistency and cross-subject ordering without contention. |
| Mutable events or event deletion for correction | N/A (anti-pattern) | Violates append-only immutability (INV-ES-01). Corrections are modeled as new events that supersede previous facts, preserving the complete audit trail. |
| External message broker for internal event dispatch | Enterprise event systems | Anti-pattern for event-sourced systems where the event store IS the durable log (LTD-11). Adds operational complexity with no benefit at HomeSynapse's scale. |
| Nullable `correlation_id` requiring NULL special-casing in trace queries | Home Assistant (Context) | Root events set `correlation_id` to their own `event_id`, making the field non-null for all events. Trace queries never need to special-case roots. |

---

## 11. Invariant and LTD Cross-Reference

Every glossary term that participates in an architectural invariant or locked technical decision.

| Invariant / LTD | Relevant Terms |
|---|---|
| **INV-CS-02** (Stable identifiers) | Reference (§8.1), Entity (§2.2), Device (§2.1), Automation (§4.1), Device Replacement (§8.4) |
| **INV-CE-04** (Protocol agnosticism) | Protocol Binding (§2.6), Entity (§2.2), Device (§2.1), Capability (§2.3), Hardware Identifier (§8.7) |
| **INV-CE-05** (Extension model) | Integration (§2.9), Capability (§2.3) |
| **INV-ES-01** (Immutable events) | Event (§3.1), Event Log (§3.2), Retention Policy (§6.2) |
| **INV-ES-03** (Per-entity ordering) | Entity Stream (§3.3), Event Envelope (§3.9) |
| **INV-ES-04** (Write-ahead persistence) | Event (§3.1), Event Bus (§3.8), Event Envelope (§3.9), State Projection (§3.13), Pending Command Ledger (§3.14) |
| **INV-ES-05** (At-least-once delivery) | Event Bus (§3.8), Subscriber (§3.11), Idempotency (§3.12) |
| **INV-ES-06** (Explainable state) | Causality Chain (§3.7), Trace (§7.1), Run (§4.5), Actor (§5.4) |
| **INV-ES-07** (Schema evolution) | Event (§3.1), Event Envelope (§3.9) |
| **INV-ES-08** (Event time vs ingest time) | Event (§3.1), Event Envelope (§3.9) |
| **INV-MU-01** (Identity-aware model) | Actor (§5.4), Person (§5.2), Entity (§2.2), Event Envelope (§3.9) |
| **INV-MU-02** (Spatial presence) | Presence (§5.6), Presence Signal (§5.7), Area (§1.2), Zone (§1.4) |
| **INV-MU-05** (Graceful degradation) | Identity Degradation (§5.8) |
| **INV-EI-01** (Energy as first-class domain) | Entity Type (§2.11), Capability (§2.3), Reserved Terms (§9) |
| **INV-TO-01** (Observable) | Trace (§7.1), Health (§7.2), Causality Chain (§3.7) |
| **INV-TO-02** (Automation determinism) | Automation (§4.1), Run (§4.5), Label (§1.5) |
| **INV-TO-03** (No hidden state) | State (§3.4) |
| **INV-HO-01** (Physical control never blocked) | Identity Degradation (§5.8) |
| **INV-RF-01** (Integration isolation) | Integration (§2.9) |
| **INV-RF-05** (Bounded storage) | Event Log (§3.2), Retention Policy (§6.2), Event Priority (§3.15), Telemetry Ring Store (§3.16) |
| **INV-PR-03** (Bounded resources) | Subject Stream (§3.3), Event Priority (§3.15), Causal Chain Projection (§3.18) |
| **LTD-03** (SQLite WAL) | Event Log (§3.2), Checkpoint (§3.6), Materialized View (§3.5) |
| **LTD-04** (ULID) | Reference (§8.1), Event (§3.1), all `*_id` fields |
| **LTD-05** (Per-entity sequences) | Subject Stream (§3.3), Event Envelope (§3.9), Causality Chain (§3.7) |
| **LTD-06** (Write-ahead persistence) | Event Bus (§3.8), Subscriber (§3.11), Idempotency (§3.12) |
| **LTD-08** (Jackson JSON) | Event (§3.1), Event Envelope (§3.9) |
| **LTD-09** (YAML 1.2) | Configuration (§6.1) |
| **LTD-11** (No external broker) | Event Bus (§3.8) |
| **LTD-13** (jlink + systemd) | Configuration (§6.1), Snapshot (§6.4) |

---

## 12. Alphabetical Term Index

Quick-reference lookup. Section numbers point to the primary definition.

| Term | Section |
|---|---|
| Action | §4.4 |
| Actor | §5.4 |
| Area | §1.2 |
| Attribute | §2.4 |
| Attribute Schema | §3.20 |
| Automation | §4.1 |
| Availability | §8.6 |
| Backpressure | §3.17 |
| Bridge | §2.8 |
| Capability | §2.3 |
| Capability Instance | §3.20 |
| Causal Chain Projection | §3.18 |
| Causality Chain | §3.7 |
| Checkpoint | §3.6 |
| Command | §2.5 |
| Condition | §4.3 |
| Configuration | §6.1 |
| Custom Capability | §3.22 |
| Device | §2.1 |
| Device Replacement | §8.4 |
| Discovery | §2.7 |
| Discovery Pipeline | §3.23 |
| Display Name | §8.5 |
| Entity | §2.2 |
| Entity Stream | §3.3 |
| Entity Type | §2.11 |
| Entity Type Composition | §3.24 |
| Event | §3.1 |
| Event Bus | §3.8 |
| Event Envelope | §3.9 |
| Event Log | §3.2 |
| Event Priority | §3.15 |
| Event Type | §3.10 |
| Expected Outcome | §3.21 |
| Feature Map | §3.19 |
| Floor | §1.3 |
| Hardware Identifier | §8.7 |
| Health | §7.2 |
| Helper Entity | §2.10 |
| Home | §1.1 |
| Idempotency | §3.12 |
| Identity Degradation | §5.8 |
| Integration | §2.9 |
| Integration Operation | §2.9 |
| Label | §1.5 |
| Materialized View | §3.5 |
| Migration | §6.3 |
| Origin | §8.9 |
| Path | §8.3 |
| Pending Command Ledger | §3.14 |
| Permission | §5.5 |
| Person | §5.2 |
| Presence | §5.6 |
| Presence Signal | §5.7 |
| Processing Mode | §3.16 |
| Protocol Binding | §2.6 |
| Reference | §8.1 |
| Retention Policy | §6.2 |
| Role | §5.3 |
| Run | §4.5 |
| Scene | §4.6 |
| Slug | §8.2 |
| Snapshot | §6.4 |
| State | §3.4 |
| State Projection | §3.13 |
| Subject Stream | §3.3 |
| Subscriber | §3.11 |
| Telemetry Ring Store | §3.19 |
| Tolerance Band | §3.21 |
| Trace | §7.1 |
| Trigger | §4.2 |
| URN Form | §8.8 |
| User | §5.1 |
| Zone | §1.4 |

---

*This document is part of the HomeSynapse Core foundations layer. It governs terminology across all Phase 1 design documents, Phase 2 interface specifications, and Phase 3 implementation. The companion Identity and Addressing Model governs identifier formats, addressing rules, and operational semantics. Amendments follow the process defined in §0.5.*