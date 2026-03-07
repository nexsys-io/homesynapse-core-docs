# HomeSynapse Core — Device Model & Capability System

**Document type:** Subsystem design
**Status:** Locked
**Subsystem:** Device Model & Capability System
**Dependencies:** Event Model & Event Bus (§3.1 producer boundaries, §3.3 priority model, §3.8 Pending Command Ledger, §4.1 event envelope, §4.3 event type taxonomy), Identity and Addressing Model (§2 three-layer identity, §5 Device Replacement, §6 Hardware Identifier mapping), Glossary v1 (§2 Device Model vocabulary)
**Dependents:** State Store (entity state shape), Persistence Layer (registry snapshot storage via CheckpointStore §8.1), Integration Runtime (Integration API surface), Automation Engine (capability-based targeting), Zigbee Adapter (capability mapping from ZCL), REST API (device/entity endpoints), WebSocket API (state change streaming), Web UI (capability-driven control rendering)
**Author:** HomeSynapse Core Architecture
**Date:** 2026-03-05

---

## 0. Purpose

The Device Model & Capability System defines what a device is, what an entity is, what capabilities they expose, what attributes they carry, what commands they accept, and how the system represents device type, entity type, and metadata. It is the semantic layer between the protocol-specific world of integrations and the protocol-agnostic world of automations, APIs, and user interfaces.

Without this subsystem, HomeSynapse has no shared vocabulary for device behavior. Integrations would invent ad hoc representations, automations could not generalize across protocols, UI rendering would require per-device code, and the Pending Command Ledger (Event Model §3.8) would have no way to determine whether a command succeeded. Every subsystem downstream of device discovery — state projection, automation evaluation, API serialization, dashboard rendering — depends on the contracts established here.

This document defines the canonical data structures, behavioral contracts, and extensibility model for device representation. It is the single authority for what constitutes a valid device, entity, capability, attribute, and command in HomeSynapse Core.

---

## 1. Design Principles

**Entity-first modeling.** The entity — not the device — is the atomic unit of behavior, state, and automation targeting. A device is a physical container; an entity is a functional surface. Automations, events, state queries, and API operations reference entities. This prevents the confusion observed in platforms where "device" is an ambiguous grouping and automations silently break when a multi-function device's internal structure changes. This is the subsystem-level expression of the Identity and Addressing Model's principle P4 (hierarchy is organization, not identity).

**Capability is a contract, not a hint.** A capability is a typed, versioned behavioral contract that defines what attributes an entity exposes, what commands it accepts, and what confirmation semantics apply. Capabilities are not UI rendering hints, not bitmask flags, and not protocol-specific metadata. They are the platform's primary extensibility surface and the foundation for generated UI, automation validation, and command confirmation. The distinction between declared capabilities (what the entity can do), enabled features (optional sub-features currently active), and availability (whether the capability is currently actionable) must be maintained at all times.

**Strict typing at the model boundary.** Integrations communicate with the outside world in protocol-specific formats. The model boundary accepts only typed, validated attribute values with explicit units and constraints. If an integration cannot produce a valid typed value, it must emit evidence of failure rather than passing through raw protocol data. This prevents the stringly-typed state problems documented across Home Assistant, where arbitrary Python dicts accumulate without schema enforcement.

**Composable over monolithic.** Capabilities are fine-grained and composable. A dimmable light is `OnOff` + `Brightness`, not a monolithic `DimmableLight` capability. Device types are compositions of required and optional capabilities, following Matter's proven cluster composition model. This prevents the SmartThings monolithic-capability splitting problem where an overly broad capability definition must be decomposed later, forcing device re-profiling across the entire ecosystem.

**Protocol is implementation, not identity.** The device model presents a unified abstraction above protocol-specific details. A Zigbee bulb and a Matter bulb exposing the same capabilities are indistinguishable to automations, the API, and the UI. Protocol-specific features are accessible but never required for standard operations. This is the subsystem-level expression of INV-CE-04 and Identity Model principle P5.

**Energy is a first-class domain.** Energy production, consumption, storage, and grid interaction are modeled through dedicated capability families with the same fidelity as lighting or climate entities. Energy devices are not sensors with special hints — they are distinct capability contracts with domain-specific semantics for metering direction, cumulative rollover, tariff awareness, and grid interaction. This satisfies INV-EI-01 from day one.

---

## 2. Scope and Boundaries

### 2.1 This Subsystem Owns

- Definition of the `Device` record and its metadata fields (manufacturer, model, firmware, hardware identifiers)
- Definition of the `Entity` record, its relationship to devices, and its lifecycle
- The capability type system: standard sealed capability interfaces, custom capability registration, and capability composition rules
- The attribute type system: primitive types, constraints (min/max/step/valid values), units (JSR 385 integration), nullability, and permission model
- The command type system: command definitions, parameter schemas, and expected outcome declarations (tolerance bands, confirmation semantics, timeout defaults)
- Entity type definitions and the mapping between entity types and required/optional capabilities
- Device type definitions and the mapping between device types and their constituent entity structures
- The `CapabilityRegistry` service that manages standard and custom capability definitions
- The `DeviceRegistry` and `EntityRegistry` that maintain the authoritative catalog of devices and entities
- Tolerance-band semantics and concrete `Expectation` implementations consumed by the Pending Command Ledger (resolved OQ1 from Event Model §3.8)
- The discovery-to-adoption pipeline data structures (proposed device, proposed entities, capability matching)
- The device replacement workflow data structures (entity transfer validation, capability compatibility checking)

### 2.2 This Subsystem Does Not Own

- Event persistence and delivery — owned by Event Model & Event Bus and Persistence Layer
- Current state materialization from events — owned by State Store
- Protocol-specific device communication — owned by Integration Runtime and protocol adapters (Zigbee Adapter, etc.)
- Automation selector vocabulary and trigger evaluation — owned by Automation Engine
- REST/WebSocket API endpoint design — owned by REST API and WebSocket API
- Database table layouts for device/entity storage — owned by Persistence Layer
- UI rendering logic — owned by Web UI (this subsystem provides the metadata that enables generated UI, but does not render it)
- Hardware identifier matching and deduplication logic — owned jointly with Integration Runtime (this subsystem defines the data structures; the runtime executes the matching)

---

## 3. Architecture

### 3.1 Structural Overview

The device model is organized in four layers: physical identity (Device), functional surface (Entity), behavioral contract (Capability), and state atoms (Attribute/Command). This structure is informed by cross-platform research and directly maps to the Glossary v1 §2 vocabulary.

```
┌─────────────────────────────────────────────────────────────────┐
│                       DEVICE REGISTRY                           │
│                                                                 │
│  Device                                                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ device_id (ULID)        manufacturer    model              │ │
│  │ device_slug             serial_number   firmware_version   │ │
│  │ integration_id          area_id         labels[]           │ │
│  │ hardware_identifiers[]  via_device_id   display_name       │ │
│  │                                                            │ │
│  │  Entity (1..N per Device)                                  │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │ entity_id (ULID)    entity_type    entity_slug       │  │ │
│  │  │ device_id           area_id        display_name      │  │ │
│  │  │ endpoint_index      enabled        labels[]          │  │ │
│  │  │                                                      │  │ │
│  │  │  Capabilities (1..N per Entity)                      │  │ │
│  │  │  ┌────────────────────────────────────────────────┐  │  │ │
│  │  │  │ capability_id    feature_map    version        │  │  │ │
│  │  │  │                                                │  │  │ │
│  │  │  │  Attributes (0..N per Capability)              │  │  │ │
│  │  │  │  ┌──────────────────────────────────────────┐  │  │  │ │
│  │  │  │  │ attribute_key   type   unit   constraints│  │  │  │ │
│  │  │  │  │ permissions     nullable   persistent    │  │  │  │ │
│  │  │  │  └──────────────────────────────────────────┘  │  │  │ │
│  │  │  │                                                │  │  │ │
│  │  │  │  Commands (0..N per Capability)                │  │  │ │
│  │  │  │  ┌──────────────────────────────────────────┐  │  │  │ │
│  │  │  │  │ command_type   parameters   required_    │  │  │  │ │
│  │  │  │  │               features     expected_     │  │  │  │ │
│  │  │  │  │               outcomes     timeout       │  │  │  │ │
│  │  │  │  └──────────────────────────────────────────┘  │  │  │ │
│  │  │  └────────────────────────────────────────────────┘  │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Device

A Device is a representation of a physical product. It is a container that groups one or more Entities and carries metadata that is hardware-specific. The Device does not carry state — state lives on its child Entities.

**Device metadata fields:**

| Field | Type | Source | Mutability |
|---|---|---|---|
| `device_id` | ULID | Generated at adoption | Immutable |
| `device_slug` | String | Derived from display_name | Mutable (rename) |
| `display_name` | String | User-assigned or integration-proposed | Mutable |
| `manufacturer` | String | Integration discovery | Immutable after adoption |
| `model` | String | Integration discovery | Immutable after adoption |
| `serial_number` | String, nullable | Integration discovery | Immutable after adoption |
| `firmware_version` | String, nullable | Integration report | Mutable (firmware update) |
| `hardware_version` | String, nullable | Integration discovery | Immutable after adoption |
| `integration_id` | ULID | Set at adoption | Mutable (re-adoption) |
| `area_id` | ULID, nullable | User-assigned | Mutable |
| `via_device_id` | ULID, nullable | Integration topology | Mutable |
| `labels` | String[] | User-assigned | Mutable |
| `hardware_identifiers` | Map<String, String> | Integration discovery | Mutable (replacement) |

**Immutable metadata vs mutable diagnostic state.** Manufacturer, model, and serial number are set at adoption and never change — they describe the physical product. Firmware version is mutable because it changes with updates. Rather than modeling firmware as a Device-level attribute (which would put it in the event stream), firmware version is a registry property that is updated via a `device_metadata_changed` event when an integration reports a new version. This keeps the event stream focused on behavioral state while still providing auditability for metadata changes.

**Hardware identifiers.** Hardware identifiers are stored as `(namespace, value)` tuples per the Identity and Addressing Model §6. They are internal to the system — never exposed in slugs, paths, or automation bindings. They are mutable because device replacement changes the protocol-level identity while preserving the HomeSynapse identity.

### 3.3 Entity

An Entity is the smallest addressable unit of state and control. It represents a single logical function: a light channel, a relay, a temperature sensor, a battery charge level, a lock actuator. Every Entity belongs to exactly one Device (or is a Helper Entity with null `device_id`).

**Entity structural fields:**

| Field | Type | Source | Mutability |
|---|---|---|---|
| `entity_id` | ULID | Generated at adoption | Immutable |
| `entity_slug` | String | Derived from display_name | Mutable (rename) |
| `entity_type` | String (enum) | Set at adoption | Governed migration only |
| `display_name` | String | User-assigned or integration-proposed | Mutable |
| `device_id` | ULID, nullable | Set at adoption | Null for helpers |
| `endpoint_index` | Integer | Integration-assigned | Immutable |
| `area_id` | ULID, nullable | User-assigned (overrides device area) | Mutable |
| `capabilities` | CapabilityInstance[] | Set at adoption, profile changes | Governed migration only |
| `enabled` | Boolean | User-controlled | Mutable |
| `labels` | String[] | User-assigned | Mutable |

**Entity enable/disable.** An entity can be enabled or disabled. Disabling an entity means it stops participating in state projections, automation evaluation, and command dispatch. A disabled entity's `state_reported` events are still persisted to the event log (they are facts about the physical world), but the State Projection ignores them — the entity's state is frozen at its last value before disabling. Commands targeting a disabled entity are rejected at dispatch time with a structured error.

Enabling and disabling produce `entity_enabled` and `entity_disabled` events respectively (see Event Model §4.3). The enabled/disabled state is stored as a boolean property on the entity record in the registry, not as a state attribute — it is an administrative property of the entity's participation in the system, not an observation about the physical world.

Disabling is distinct from unavailability. An unavailable entity is one that the integration cannot reach (network failure, device powered off). A disabled entity is one that the user or an automation has deliberately excluded from processing. The two states are orthogonal: an entity can be both disabled and unavailable, both disabled and available, or any other combination.

**The `endpoint_index` field.** Every entity on a device carries an integer `endpoint_index` that identifies its position within the device's functional structure. This maps directly to Matter's endpoint numbering, Zigbee's endpoint IDs, and Z-Wave's multi-channel endpoint IDs. For single-function devices, the sole entity has `endpoint_index = 1`. For multi-function devices, the integration assigns indices during discovery. Endpoint index 0 is reserved — it is not materialized as a separate entity but represents device-level metadata (the Matter Root Node concept). The `endpoint_index` is stable for the lifetime of the entity and is used in protocol-level communication but never in automation bindings (which use `entity_ref`).

**Entity-first targeting.** Automations, API operations, and state queries always target entities, never devices. A "turn off all devices in the kitchen" automation resolves to a set of entity references via the addressing system (Identity and Addressing Model §7). This prevents the ambiguity of device-level operations on multi-function devices. To act on all entities of a device, use label-based or device-based entity resolution — the automation targets the resolved entity set, not the device directly.

### 3.4 Capability Contract Model

A Capability is a typed contract that defines what an entity can do or report. The capability system uses a three-level model that separates static declaration from dynamic state:

**Level 1 — Declared Capabilities.** The set of capability contracts an entity supports. Declared capabilities are stable — they change only through an explicit `entity_profile_changed` event, never silently as a side effect of runtime state. When an integration discovers a device, it proposes a set of capabilities per entity. After adoption, these are locked. If a firmware update adds or removes capabilities, the integration must emit an `entity_profile_changed` event, which triggers re-validation and optionally requires user confirmation.

**Level 2 — Enabled Features (Feature Map).** Each capability instance carries a `feature_map` bitmask declaring which optional features of that capability are supported. Feature maps are stable per-entity but may differ across entities of the same capability type (one light supports color temperature, another does not). Feature map changes also require an `entity_profile_changed` event.

**Level 3 — Availability.** Runtime truth about whether a declared capability is currently actionable. Availability is a function of device reachability (the `availability` state per Glossary §8.6), transient error conditions (e.g., a lock is jammed), and integration health. Availability is dynamic and does not affect the declared capability set. An unavailable entity still has its declared capabilities — it just cannot act on them right now.

**Availability scope.** **Availability scope.** Availability (`available`, `unavailable`, `unknown`) is tracked at the Entity level, not the Capability level. An Entity is either reachable or not — individual capabilities within an Entity do not have independent availability. This reflects the physical reality: if a Zigbee multi-sensor is unreachable, all of its capabilities (temperature, humidity, motion) are simultaneously unreachable because they share a single radio link.

If a device has a partial hardware failure where some capabilities work but others do not (e.g., a sensor's temperature reading is valid but its humidity reading is stuck), this is modeled as the Entity being `available` with specific attributes producing `state_report_rejected` events for the failing capability. The Entity's availability reflects protocol-level reachability; attribute-level health is tracked through validation outcomes.

This design choice is deliberate. Per-capability availability would require the integration to report individual capability reachability — information that most protocols (Zigbee, Z-Wave, Matter) do not provide at that granularity. A Zigbee endpoint is either reachable or not; individual clusters within an endpoint do not have independent reachability. Modeling per-capability availability would create false precision.

Post-MVP, if protocols emerge that provide per-capability health (e.g., Matter's cluster-level status attributes), a `capability_health` concept may be introduced as an extension of the availability model. The current entity-level availability does not prevent this addition.

**Why this separation matters.** Discovery, UI rendering, and voice assistant integration all need static capability information to function. If capabilities change silently with runtime state (as Home Assistant's `supported_features` bitmask permits), controllers cannot reliably generate UIs, voice assistants discover incorrect capabilities, and automations that depend on capability presence break unpredictably. The three-level separation ensures that anything querying "what can this entity do?" gets a stable answer, while "can it do it right now?" is a separate, dynamic query.

### 3.5 Capability Definition Structure

Each capability definition declares:

```
┌─────────────────────────────────────────────────────┐
│ Capability Definition                                │
│                                                      │
│ capability_id:  "brightness"                         │
│ version:        1                                    │
│ namespace:      "core"  (or integration namespace)   │
│                                                      │
│ Features (optional sub-capabilities):                │
│   TRANSITION = 0x01  (supports transition_time arg)  │
│                                                      │
│ Attributes:                                          │
│ ┌──────────────────────────────────────────────────┐ │
│ │ key: "brightness"                                │ │
│ │ type: INT                                        │ │
│ │ minimum: 0    maximum: 100    step: 1            │ │
│ │ unit: PERCENT                                    │ │
│ │ permissions: [READ, WRITE, NOTIFY]               │ │
│ │ nullable: false    persistent: true              │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ Commands:                                            │
│ ┌──────────────────────────────────────────────────┐ │
│ │ command_type: "set_brightness"                   │ │
│ │ parameters:                                      │ │
│ │   brightness: INT (0-100, required)              │ │
│ │   transition_ms: INT (0-65535, optional,         │ │
│ │                       requires TRANSITION feat)  │ │
│ │ expected_outcomes:                               │ │
│ │   brightness → WithinTolerance(target, ±2)       │ │
│ │ default_timeout: 5s                              │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ Confirmation Semantics:                              │
│ ┌──────────────────────────────────────────────────┐ │
│ │ confirmation_mode: TOLERANCE                     │ │
│ │ authoritative_attributes: ["brightness"]         │ │
│ │ default_tolerance: ±2 (absolute)                 │ │
│ │ default_timeout: 5000ms                          │ │
│ └──────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 3.6 Standard Capability Set (MVP)

The MVP ships with a sealed set of standard capabilities sufficient to exercise the Zigbee adapter across common device categories. Each capability is a Java sealed interface implementation (see §3.9 for the extensibility model).

**Actuation capabilities:**

| capability_id | Attributes | Commands | Confirmation Mode |
|---|---|---|---|
| `on_off` | `on` (boolean) | `turn_on`, `turn_off`, `toggle` | EXACT_MATCH |
| `brightness` | `brightness` (int 0–100, %) | `set_brightness` | TOLERANCE (±2) |
| `color_temperature` | `color_temp_kelvin` (int, K) | `set_color_temperature` | TOLERANCE (±50K) |

**Measurement capabilities:**

| capability_id | Attributes | Commands | Confirmation Mode |
|---|---|---|---|
| `temperature_measurement` | `temperature_c` (float, °C) | *(read-only)* | N/A |
| `humidity_measurement` | `humidity_pct` (float, %) | *(read-only)* | N/A |
| `illuminance_measurement` | `illuminance_lux` (float, lux) | *(read-only)* | N/A |
| `power_measurement` | `power_w` (float, W) | *(read-only)* | N/A |

**Binary sensor capabilities:**

| capability_id | Attributes | Commands | Confirmation Mode |
|---|---|---|---|
| `binary_state` | `active` (boolean) | *(read-only)* | N/A |
| `contact` | `open` (boolean) | *(read-only)* | N/A |
| `motion` | `detected` (boolean) | *(read-only)* | N/A |
| `occupancy` | `occupied` (boolean) | *(read-only)* | N/A |

**Registry property:**

| capability_id | Attributes | Commands | Confirmation Mode |
|---|---|---|---|
| `battery` | `battery_pct` (int 0–100, %), `battery_low` (boolean) | *(read-only)* | N/A |
| `device_health` | `rssi_dbm` (int, dBm), `lqi` (int 0–255) | *(read-only)* | N/A |

**Energy capabilities (first-class per INV-EI-01):**

| capability_id | Attributes | Commands | Confirmation Mode |
|---|---|---|---|
| `energy_meter` | `energy_wh` (float, Wh), `direction` (enum: IMPORT/EXPORT/BIDIRECTIONAL), `cumulative` (boolean) | `reset_meter` (where supported) | EXACT_MATCH |
| `power_meter` | `power_w` (float, W), `voltage_v` (float, V, optional), `current_a` (float, A, optional) | *(read-only)* | N/A |

**Post-MVP capabilities (reserved, schema-accommodated):**

`color_hs`, `color_xy`, `lock`, `thermostat_control`, `hvac_mode`, `fan_mode`, `cover`, `media_player`, `battery_storage`, `solar_inverter`, `ev_charger`, `valve`, `siren`.

### 3.7 Attribute Type System

Every attribute value in HomeSynapse is typed at the model boundary. Integrations must produce values conforming to the attribute's declared schema. The type system combines Matter's formal primitive types, HomeKit's constraint metadata, and OpenHAB's JSR 385 quantity type model.

**Primitive types:**

| Type | Java Representation | JSON Wire Format | Notes |
|---|---|---|---|
| BOOLEAN | `boolean` | `true`/`false` | |
| INT | `int` / `long` | number | For constrained integers (brightness 0–100, battery 0–100) |
| FLOAT | `double` | number | For continuous measurements (temperature, power) |
| STRING | `String` | string | For free-form values (firmware version, device label) |
| ENUM | `String` (validated) | string | Value must be in `valid_values` set |

**Attribute schema record:**

```
AttributeSchema {
    attribute_key:    String          -- scoped within capability
    type:             AttributeType   -- BOOLEAN, INT, FLOAT, STRING, ENUM
    minimum:          Number?         -- for INT, FLOAT
    maximum:          Number?         -- for INT, FLOAT
    step:             Number?         -- for INT, FLOAT (UI slider granularity)
    valid_values:     String[]?       -- for ENUM
    unit:             Unit<?>?        -- JSR 385 unit (for physical quantities)
    canonical_unit:   Unit<?>?        -- SI canonical for storage
    permissions:      Set<Permission> -- READ, WRITE, NOTIFY
    nullable:         boolean         -- whether null/unknown is a valid state
    persistent:       boolean         -- survives device restart
}
```

**Physical quantity handling (the moat decision).** All physical quantities are stored as `(value, unit)` pairs with explicit unit identity. The capability definition specifies a `canonical_unit` in SI (temperature in °C, energy in Wh, power in W, illuminance in lux). Protocol adapters convert to canonical units at ingestion time. The event payload carries both the canonical value and the original protocol value for auditability:

```json
{
    "event_type": "state_reported",
    "payload": {
        "attribute_key": "temperature_c",
        "value": 22.5,
        "unit": "°C",
        "raw_protocol_value": 2250,
        "raw_protocol_unit": "0.01°C"
    }
}
```

Presentation conversion (°C → °F for US users) is exclusively a query/view concern, never a storage concern. Historical data is never reinterpreted through a different unit lens. This directly prevents the Home Assistant unit-change data corruption problem where changing `native_unit_of_measurement` corrupts historical graphs.

**Processing order for `state_reported` events.** When an integration produces a `state_reported` event, the following processing order applies:

1. **Persistence.** The event is appended to the domain event store by the EventPublisher (INV-ES-04 — write-ahead). The event is now durable.
2. **Bus delivery.** The Event Bus notifies subscribers that a new event is available.
3. **State Projection processing.** The State Projection subscriber receives the event and performs attribute validation against the Entity's capability schema (type checking, range checking, unit conformance). If validation fails, a `state_report_rejected` event is produced and the `state_reported` event does not update canonical state. If validation passes, the projection compares the reported value against canonical state and, if different, produces a `state_changed` event.

The critical ordering property: persistence happens before validation. An invalid `state_reported` event is still persisted in the event log — it is a fact about what the integration reported, even if the value is invalid. The `state_report_rejected` event records the validation failure. This preserves the event log's role as a complete record of system activity and enables diagnosis of misbehaving integrations by querying rejected reports.

### 3.8 Command Model and Expected Outcomes

Commands are typed intents to change an entity's state through a capability. They are not direct state mutations — they are requests that produce events. The command model directly feeds the Pending Command Ledger (Event Model §3.8).

**Command definition structure:**

```
CommandDefinition {
    command_type:       String              -- scoped within capability
    parameters:         ParameterSchema[]   -- typed, constrained
    required_features:  int                 -- feature_map bits required
    expected_outcomes:  ExpectedOutcome[]   -- what should change
    default_timeout:    Duration            -- confirmation deadline
    idempotency_class:  IdempotencyClass    -- IDEMPOTENT, NOT_IDEMPOTENT, TOGGLE
}
```

**Expected outcome types (the Expectation interface implementations):**

The Pending Command Ledger consumes an `Expectation` interface that can evaluate a `state_reported` value and return `CONFIRMED`, `NOT_YET`, or `FAILED`. The Device Model owns the concrete implementations:

| Expectation Type | Semantics | Example |
|---|---|---|
| `ExactMatch` | Reported value must equal target | `turn_on` → `on == true` |
| `WithinTolerance` | Reported numeric value within ±band of target | `set_brightness(75)` → `brightness ∈ [73, 77]` |
| `EnumTransition` | Reported enum value must match target | `set_mode("heat")` → `mode == "heat"` |
| `AnyChange` | Any change from the pre-command value | `toggle` → `on != previous_on` |

**Tolerance band ownership.** The capability defines default tolerance bands and timeouts. Protocol adapters may override tolerance when the protocol or hardware requires it (e.g., a specific dimmer that rounds to nearest 5%). Automations never invent tolerance semantics ad hoc — they consume the capability-defined defaults or explicit adapter overrides. This prevents inconsistent confirmation behavior across different parts of the system.

**Command parameter validation.** Every command parameter is validated against its schema before the command is dispatched to the integration. Type mismatches, out-of-range values, and missing required parameters produce synchronous validation errors. The integration never sees an invalid command. This is a hard contract: the integration API guarantees that any command received has passed schema validation.

### 3.9 Extensibility: Standard and Custom Capabilities

The capability system uses a hybrid approach: Java sealed interfaces for standard capabilities (compile-time safety, exhaustive pattern matching) with a `CustomCapability` implementation for runtime-registered capabilities defined via JSON schema.

**Standard capabilities** are defined as sealed interface implementations in the `integration-api` module. They ship with the HomeSynapse distribution and are versioned with the Integration API (per LTD-16). Standard capabilities support exhaustive `switch` expressions in Java, enabling the compiler to flag missing cases when new standard capabilities are added.

**Custom capabilities** are registered at runtime through the `CapabilityRegistry` service. They are defined via JSON schema (per LTD-08, Jackson serialization) and carry a namespace prefix: `{integration_type}.{capability_name}` (e.g., `zigbee_tuya.datapoint_102`). Custom capabilities are validated at registration time against the attribute type system.

**Custom capability governance rules:**

1. Custom capabilities must declare a stability level: `EXPERIMENTAL`, `STABLE`, or `DEPRECATED`. The UI clearly labels non-standard capabilities to prevent portability illusions.
2. Custom capabilities may not shadow standard capability IDs. A registration attempt for `on_off` in any namespace is rejected.
3. Custom capabilities participate in the event system identically to standard capabilities — `state_reported`, `state_changed`, `command_issued` events carry custom capability attributes with the same envelope structure.
4. Custom capabilities may participate in automations, but automation templates and UI helpers prioritize standard capabilities. A custom capability trigger requires explicit user acknowledgment that the automation depends on a non-standard contract.

**Future path:** As custom capabilities prove stable across the ecosystem, they become candidates for promotion to standard capabilities in future major versions. This is the "paved path" model: start custom, prove value, standardize.

### 3.10 Entity Types and Capability Composition

Entity type determines the required and optional capabilities for an entity, following Matter's device type composition model. Entity type is set at adoption and changes only through governed type migration (`entity_type_changed` event per Glossary §2.11).

**Entity type composition rules:**

- Each entity type declares a set of **required capabilities** that must be present for the entity type to be valid.
- Each entity type declares a set of **optional capabilities** that may be present.
- Any capability not in the required or optional set is permitted but generates a validation warning (it may indicate a misclassified entity type).
- An entity that presents capabilities matching a known entity type's required set may be auto-classified if no explicit type is provided by the integration.

**MVP entity type compositions:**

| entity_type | Required Capabilities | Optional Capabilities |
|---|---|---|
| `light` | `on_off` | `brightness`, `color_temperature`, `color_hs`, `color_xy` |
| `switch` | `on_off` | — |
| `plug` | `on_off` | `power_measurement`, `energy_meter` |
| `sensor` | *(at least one measurement capability)* | `battery`, `device_health` |
| `binary_sensor` | *(at least one binary capability)* | `battery`, `device_health` |
| `energy_meter` | `energy_meter` | `power_meter`, `battery` |

**Post-MVP entity types (reserved):** `lock`, `climate`, `cover`, `media_player`, `fan`, `valve`, `siren`, `inverter`, `battery_storage`, `ev_charger`, plus helper types: `input_boolean`, `input_number`, `input_text`, `input_select`, `template_sensor`, `counter`, `timer`.

### 3.11 Multi-Function Device Modeling

A single physical device may expose multiple entities, each with independent capabilities and state. The canonical examples: a smart power strip with 4 individually controllable outlets plus aggregate energy monitoring; a thermostat with temperature sensing, humidity sensing, HVAC control, and fan control.

**Modeling rule:** Each independently controllable or independently reportable function becomes a separate entity on the device. The integration proposes entity structure during discovery; the system validates that each proposed entity's capabilities match a valid entity type composition.

**Example: 4-outlet power strip with energy monitoring.**

```
Device: "Kitchen Power Strip" (device_id: 01HWXYZ...)
├── Entity: "Outlet 1"  (endpoint_index: 1, entity_type: plug)
│   └── Capabilities: on_off, power_measurement
├── Entity: "Outlet 2"  (endpoint_index: 2, entity_type: plug)
│   └── Capabilities: on_off, power_measurement
├── Entity: "Outlet 3"  (endpoint_index: 3, entity_type: plug)
│   └── Capabilities: on_off, power_measurement
├── Entity: "Outlet 4"  (endpoint_index: 4, entity_type: plug)
│   └── Capabilities: on_off, power_measurement
└── Entity: "Total Energy" (endpoint_index: 5, entity_type: energy_meter)
    └── Capabilities: energy_meter, power_meter
```

Each entity has its own `entity_id`, its own event stream, its own state, and is independently addressable in automations. The `device_id` groups them for UI organization and metadata inheritance (area assignment, manufacturer info).

### 3.12 Discovery, Adoption, and Deduplication

Device discovery follows a staged pipeline: detection → proposal → adoption. Only adopted devices receive HomeSynapse identity.

**Stage 1: Detection.** An integration detects a device on its protocol network. It produces a `device_discovered` event (Event Model §4.3) carrying the protocol-specific identity, hardware identifiers, proposed capabilities, and proposed entity structure.

**Stage 2: Proposal.** The discovered device enters a "proposed" state in the discovery queue. The system checks hardware identifiers against the `DeviceIdentifiers` registry:

- **Match found:** The device is recognized as an existing device (re-pairing after power loss, network reconfiguration). The integration re-links to the existing `device_id` without user intervention. No new adoption event is produced; an `availability_changed` event marks the device as available.
- **No match:** The device is proposed for user adoption. It carries only protocol-level identity until the user accepts it.

**Stage 3: Adoption.** The user accepts a proposed device. The system generates `device_id` and `entity_id` values, registers hardware identifiers, validates capability compositions against entity type rules, and produces a `device_adopted` event.

**Deduplication.** The `DeviceIdentifiers` registry maintains a mapping from `(namespace, value)` tuples to `device_id`. Matching is integration-scoped (a Zigbee IEEE address is only compared against other Zigbee devices). Cross-integration matching is always user-initiated (for device replacement scenarios).

### 3.13 Device Removal

Device removal is user-initiated. When a Device is removed from the system (by user via the API or UI), the following cascade executes atomically within a single event transaction:

1. **All Entities owned by the Device are soft-deleted.** Each Entity produces an `entity_deleted` event (NORMAL priority) with `reason: device_removed` and `actor_ref` from the initiating user. Soft-deleted Entities enter the retention window defined in the Identity and Addressing Model §4.4 (default: 30 days).

2. **The Device itself is soft-deleted.** The Device produces a `device_removed` event (NORMAL priority) with `actor_ref` from the initiating user.

3. **Hardware Identifiers are released.** The Device's Hardware Identifier tuples are disassociated from the Device record. This allows a re-paired device with the same protocol addresses to be proposed as a new adoption rather than matched to the removed Device. The previous mapping is recorded in the `device_removed` event payload for audit purposes.

4. **Automations referencing removed Entities are not modified.** Automation bindings reference Entity References, which remain valid (soft-deleted). The Automation Engine's resolution logic treats soft-deleted Entities as "target unavailable" — the automation logs a warning and skips the action, per Identity and Addressing Model §7.5 (resolution-time eligibility). The user receives a notification that automations reference unavailable entities. No automation is silently broken or silently modified.

5. **State Store entries are marked unavailable.** The State Projection processes the `entity_deleted` events and sets `availability: unavailable` on each affected EntityState. The `lastReported` timestamp is preserved for diagnostic purposes.

**Atomicity guarantee.** Steps 1–3 are wrapped in a single `EventPublisher` transaction (all events share a single `correlation_id` rooted in the user's removal request). If any event in the cascade fails to persist, none are persisted. The Device remains in its pre-removal state.

**Restore behavior.** During the soft-delete retention window, a removed Device can be restored. Restoration produces `device_restored` and `entity_restored` events, re-activates Hardware Identifier mappings, and transitions State Store entries back to their pre-removal availability. Automations that were logging "target unavailable" resume normal operation without modification.

**Purge behavior.** After the retention window, soft-deleted objects are permanently purged. Their References are retired (never reused, per Identity and Addressing Model §4.3). Their events remain in the Event Log subject to standard retention policy.

### 3.14 Device Replacement

Device replacement preserves entity identity when physical hardware is swapped. The workflow is defined in the Identity and Addressing Model §5; this subsystem provides the capability compatibility validation.

**Compatibility checking.** Before a replacement is executed, the system validates that the new device's proposed entities can satisfy the existing entities' capability contracts. The validation produces one of three results:

- **Compatible:** The new device exposes a superset of the existing capabilities. Replacement proceeds automatically.
- **Partially compatible:** The new device is missing some optional capabilities. Replacement proceeds with a warning; automations referencing missing capabilities are flagged for review.
- **Incompatible:** The new device cannot satisfy the required capabilities of one or more existing entities. Replacement is blocked unless the user explicitly accepts the capability loss.

Replacement produces an `entity_transferred` event per transferred entity, recording the old device, new device, capability diff, and user confirmation status.

---

## 4. Data Model

### 4.1 Device Record

```json
{
    "device_id": "01HWX4N2B3Y5K7M9P1Q3R5T7V9",
    "device_slug": "kitchen-power-strip",
    "display_name": "Kitchen Power Strip",
    "manufacturer": "Sonoff",
    "model": "S31-ZB-4",
    "serial_number": "SN-20240115-0042",
    "firmware_version": "2.1.3",
    "hardware_version": "1.0",
    "integration_id": "01HWX4N2B3Y5K7M9P1Q3R5T7VA",
    "area_id": "01HWX4N2B3Y5K7M9P1Q3R5T7VB",
    "via_device_id": null,
    "labels": ["kitchen", "appliances"],
    "hardware_identifiers": {
        "zigbee_ieee": "00:11:22:33:44:55:66:77",
        "zigbee_nwk": "0x1A2B"
    },
    "created_at": "2026-03-01T10:30:00Z"
}
```

### 4.2 Entity Record

```json
{
    "entity_id": "01HWX4N2B3Y5K7M9P1Q3R5T7VC",
    "entity_slug": "kitchen-power-strip-outlet-1",
    "entity_type": "plug",
    "display_name": "Outlet 1",
    "device_id": "01HWX4N2B3Y5K7M9P1Q3R5T7V9",
    "endpoint_index": 1,
    "area_id": null,
    "enabled": true,
    "labels": [],
    "capabilities": [
        {
            "capability_id": "on_off",
            "version": 1,
            "feature_map": 0,
            "namespace": "core"
        },
        {
            "capability_id": "power_measurement",
            "version": 1,
            "feature_map": 0,
            "namespace": "core"
        }
    ],
    "created_at": "2026-03-01T10:30:00Z"
}
```

### 4.3 Capability Instance (on an Entity)

```json
{
    "capability_id": "brightness",
    "version": 1,
    "namespace": "core",
    "feature_map": 1,
    "attributes": {
        "brightness": {
            "type": "INT",
            "minimum": 0,
            "maximum": 100,
            "step": 1,
            "unit": "%",
            "permissions": ["READ", "WRITE", "NOTIFY"],
            "nullable": false,
            "persistent": true
        }
    },
    "commands": {
        "set_brightness": {
            "parameters": {
                "brightness": { "type": "INT", "minimum": 0, "maximum": 100, "required": true },
                "transition_ms": { "type": "INT", "minimum": 0, "maximum": 65535, "required": false, "required_features": 1 }
            },
            "expected_outcomes": [
                { "attribute_key": "brightness", "expectation": "WITHIN_TOLERANCE", "tolerance": 2 }
            ],
            "default_timeout_ms": 5000,
            "idempotency": "IDEMPOTENT"
        }
    },
    "confirmation": {
        "mode": "TOLERANCE",
        "authoritative_attributes": ["brightness"],
        "default_tolerance": 2,
        "default_timeout_ms": 5000
    }
}
```

### 4.4 Event Payloads (Integration with Event Model)

This subsystem defines the payload schemas for device-related event types declared in Event Model §4.3.

**`state_reported` payload (integration → core):**

```json
{
    "attribute_key": "brightness",
    "value": 74,
    "unit": "%",
    "capability_id": "brightness",
    "raw_protocol_value": 189,
    "raw_protocol_unit": "zigbee_level_0_254"
}
```

**`device_discovered` payload:**

```json
{
    "integration_id": "01HWX...",
    "protocol": "zigbee",
    "hardware_identifiers": { "zigbee_ieee": "00:11:22:33:44:55:66:77" },
    "proposed_manufacturer": "IKEA",
    "proposed_model": "TRADFRI bulb E27 CWS 806lm",
    "proposed_entities": [
        {
            "endpoint_index": 1,
            "proposed_entity_type": "light",
            "proposed_capabilities": ["on_off", "brightness", "color_temperature"]
        }
    ]
}
```

**`entity_profile_changed` payload:**

```json
{
    "change_type": "CAPABILITY_ADDED",
    "capability_id": "color_temperature",
    "previous_capabilities": ["on_off", "brightness"],
    "new_capabilities": ["on_off", "brightness", "color_temperature"],
    "reason": "firmware_update",
    "requires_user_confirmation": false
}
```

---

## 5. Contracts and Invariants

**C1: Declared capabilities are stable across normal operation.** An entity's capability set changes only through explicit `entity_profile_changed` events, never as a side effect of state changes, availability transitions, or integration restarts. A consumer that queries "what capabilities does this entity have?" receives the same answer regardless of the entity's current state or availability.

**C2: Every attribute value at the model boundary is typed and validated.** The system rejects attribute values that do not conform to the attribute's declared schema (type, range, valid values, unit). An integration that cannot produce a valid typed value must emit a diagnostic event rather than pass through raw data. No untyped or stringly-typed state reaches the State Store.

**C3: Physical quantities are stored as (value, unit) pairs.** No bare numbers for physical quantities. Every measurement event carries an explicit unit. Historical data is never reinterpreted through a different unit lens. Presentation conversion is a view concern.

**C4: Commands are validated before dispatch.** Any command received by an integration has passed type validation, range validation, and required-parameter checks. Integrations may assume valid input and are not required to re-validate.

**C5: Tolerance bands and confirmation semantics are capability-owned.** The Pending Command Ledger consumes `Expectation` objects produced by capability definitions. Protocol adapters may override defaults; automations and users do not define ad hoc tolerance behavior.

**C6: Entity type constrains valid capability sets.** An entity's declared capabilities must satisfy its entity type's required-capability set. Capability additions or removals that violate this constraint are rejected unless the entity type is simultaneously migrated.

**C7: Device identity and entity identity survive device replacement.** When physical hardware is replaced, entity ULIDs, automation bindings, historical events, area assignments, labels, and display names are preserved. Only hardware identifiers and protocol bindings change.

**C8: Custom capabilities are namespace-isolated and stability-declared.** Custom capabilities operate in integration-prefixed namespaces and carry explicit stability levels. They participate in the event system identically to standard capabilities but are labeled as non-standard in UI and automation tooling.

**Invariant alignment:**

| Contract | Invariants Served |
|---|---|
| C1 | INV-CE-05 (extension model stability), INV-CS-04 (integration API stability) |
| C2 | INV-RF-01 (integration isolation — malformed data cannot corrupt core), INV-TO-03 (no hidden state) |
| C3 | INV-ES-06 (explainable state — unit is part of the fact), INV-EI-01 (energy data fidelity) |
| C4 | INV-RF-01 (integration isolation), INV-SE-04 (least privilege) |
| C5 | INV-TO-02 (automation determinism), INV-ES-06 (explainable state) |
| C6 | INV-CE-04 (protocol agnosticism — entity types are protocol-independent) |
| C7 | INV-CS-02 (stable identifiers), INV-CE-04 (protocol agnosticism) |
| C8 | INV-CE-05 (extension model with stability guarantees) |

---

## 6. Failure Modes and Recovery

### 6.1 Integration Produces Invalid Attribute Value

**Trigger:** An integration emits a `state_reported` event with a value that fails schema validation (wrong type, out of range, unknown attribute key, missing unit for a physical quantity).

**Impact:** The invalid value does not reach the State Store. The entity's state remains at its previous value. The UI shows stale data until a valid report arrives.

**Recovery:** The system logs a structured warning with the integration ID, entity ID, attribute key, invalid value, and the validation failure reason. The invalid event is persisted as a DIAGNOSTIC event with an `invalid_report` marker for observability. The integration's health indicator increments an error counter. If the error rate exceeds a configurable threshold, the integration is flagged as unhealthy.

**Processing order for incoming `state_reported` events:**

1. **Persistence.** The `state_reported` event is appended to the event log with write-ahead guarantees (INV-ES-04). The event is an immutable fact — the integration reported this value. Persistence happens unconditionally, regardless of validation outcome.
2. **Validation.** The Device Model's `AttributeValidator` checks the reported value against the entity's capability-defined attribute schema (type, range, unit, constraints). If validation fails, a `state_report_rejected` event is produced (see §6.1), and the value does not proceed to step 3.
3. **State projection.** If validation passes, the State Projection receives the `state_reported` event and compares the value against canonical state. If the value differs, a `state_changed` event is produced. If the value matches a pending command's expectation, a `state_confirmed` event is produced by the Pending Command Ledger.

This order is critical. Persisting before validation means the raw fact is never lost — even invalid reports are available for forensic analysis. Validating before projection means invalid values never corrupt the state model. The `state_report_rejected` event provides an auditable record of rejected values, enabling integration developers to diagnose bugs and users to understand why a device's state appears stale.

**Events produced:** `state_report_rejected` (DIAGNOSTIC priority) carrying the integration ID, entity ID, rejected value, and validation error.

### 6.2 Capability Profile Change During Active Automation

**Trigger:** An `entity_profile_changed` event removes a capability that an active automation references.

**Impact:** The automation's next evaluation for that entity may fail because the referenced capability no longer exists.

**Recovery:** The system produces an `automation_capability_mismatch` event (NORMAL priority) identifying the automation, entity, and missing capability. The automation continues to execute for entities that still have the capability. The affected binding is marked as "stale" in the automation's metadata, visible in the observability UI. User intervention is required to update the automation.

**Events produced:** `entity_profile_changed` (NORMAL), `automation_capability_mismatch` (NORMAL).

### 6.3 Discovery Proposes Duplicate Device

**Trigger:** An integration discovers a device whose hardware identifiers match an existing device in the `DeviceIdentifiers` registry.

**Impact:** None — the system silently re-links to the existing device. No user-visible change.

**Recovery:** Automatic. The system updates the device's availability to `available` and refreshes any stale hardware identifiers (e.g., updated Zigbee network address after re-pairing). No new `device_adopted` event is produced; an `availability_changed` event records the re-link.

**Events produced:** `availability_changed` (NORMAL or CRITICAL depending on previous state).

### 6.4 Device Replacement with Incompatible Capabilities

**Trigger:** A user initiates device replacement, but the new device cannot satisfy the existing entities' required capabilities.

**Impact:** Replacement is blocked. The user is informed of the capability mismatch with specific details about which capabilities are missing.

**Recovery:** User must either choose a compatible replacement device or accept capability loss (which flags affected automations for review). The system provides a compatibility report listing matched, missing, and new capabilities.

**Events produced:** None until the user acts. If the user proceeds with capability loss, `entity_transferred` events include the capability diff.

### 6.5 Custom Capability Registration Conflict

**Trigger:** An integration attempts to register a custom capability with an ID that conflicts with a standard capability or an already-registered custom capability in the same namespace.

**Impact:** Registration is rejected. The integration cannot use the conflicting capability ID.

**Recovery:** The integration must use a different capability ID. The rejection is logged with a structured error.

**Events produced:** None (registration is synchronous, not event-sourced).

### 6.6 Registry Corruption or Loss

**Trigger:** The device/entity registry data is corrupted or lost (disk failure, software bug).

**Impact:** The system has no record of devices and entities. State events in the event log reference entity IDs that the registry cannot resolve.

**Recovery:** The registry is rebuilt by replaying the following event types from the event log: `device_adopted`, `device_removed`, `entity_profile_changed`, `entity_type_changed`, `entity_transferred`, `device_metadata_changed`, `entity_enabled`, and `entity_disabled`. The event log is the source of truth (INV-ES-02); the registry is a materialized view. Rebuilding produces identical registry state because every mutable property of the registry (device metadata, entity capability profiles, entity type, entity enabled/disabled status, and device-entity associations) is captured by at least one of these event types.

- `device_metadata_changed` — restores device metadata (manufacturer, model, firmware, display name)
- `entity_enabled` / `entity_disabled` — restores administrative state
- `entity_profile_changed` — restores capability set modifications
- `device_removed` / `entity_deleted` — restores soft-delete state

**Events produced:** `system_registry_rebuilt` (CRITICAL) recording the rebuild trigger, duration, and entity count.

---

## 7. Interaction with Other Subsystems

| Subsystem | Direction | Mechanism | Data | Constraints |
|---|---|---|---|---|
| Event Model & Event Bus | Produces events via | `EventPublisher.publish()` | `device_adopted`, `device_removed`, `entity_profile_changed`, `entity_type_changed`, `entity_transferred`, `device_metadata_changed`, `entity_enabled`, `entity_disabled`, `state_report_rejected` | Producer boundary rules: device lifecycle events are core-produced (Event Model §3.1) |
| Event Model & Event Bus | Consumes events via | Event subscription | `device_discovered`, `state_reported`, `command_result`, `availability_changed` | Subscribes to integration-produced events for registry updates and validation |
| State Store | Provides to | `EntityRegistry` query interface | Entity records, capability definitions, attribute schemas | State Store uses capability schemas to validate incoming state and structure materialized views |
| Pending Command Ledger | Provides to | `ExpectationFactory` interface | Concrete `Expectation` implementations per capability/command | Ledger consumes expectations to evaluate command confirmation (Event Model §3.8) |
| Integration Runtime | Provides to | `DeviceRegistry`, `CapabilityRegistry` interfaces | Device/entity records for protocol mapping; capability definitions for discovery validation | Integrations query the registry during discovery and command dispatch |
| Integration Runtime | Receives from | `IntegrationAdapter` interface | Proposed devices, proposed entities, reported attribute values, capability registration requests | Integration boundary enforced at build time (LTD-17) |
| Automation Engine | Provides to | `EntityRegistry`, `CapabilityRegistry` query interfaces | Entity capability metadata for trigger/condition/action validation and selector resolution | Automation Engine validates that referenced capabilities exist before accepting automation definitions |
| REST API | Provides to | `DeviceRegistry`, `EntityRegistry`, `CapabilityRegistry` read interfaces | Device/entity records, capability schemas for API serialization | API Layer shapes are derived from the data model defined here |
| Configuration System | Receives from | YAML configuration | Custom capability overrides, default tolerance tuning, discovery behavior | Configuration changes produce `config_changed` events |
| Persistence Layer | Implements interface | `CheckpointStore` interface with `viewName = "device_registry"` | Device and entity registry snapshot data (opaque byte arrays) | Persistence stores and retrieves without interpreting registry content. Same-transaction semantics with subscriber checkpoints. Uses the same checkpoint infrastructure as the State Store. |
| Web UI | Provides to | API (via REST/WebSocket) | Capability metadata for control rendering, attribute constraints for input validation | UI generates controls from capability definitions — no per-device UI code |

---

## 8. Key Interfaces

### 8.1 Interfaces

| Interface | Responsibility |
|---|---|
| `DeviceRegistry` | CRUD for device records; hardware identifier mapping; discovery deduplication |
| `EntityRegistry` | CRUD for entity records; capability composition validation; entity type enforcement |
| `CapabilityRegistry` | Standard capability definitions; custom capability registration and lookup; schema retrieval |
| `ExpectationFactory` | Produces `Expectation` instances for the Pending Command Ledger given a capability, command, and parameters |
| `AttributeValidator` | Validates attribute values against capability-defined schemas; rejects invalid values with structured errors |
| `CommandValidator` | Validates command parameters against capability-defined command schemas; rejects invalid commands before dispatch |
| `DeviceReplacementService` | Capability compatibility checking and entity transfer orchestration |
| `DiscoveryPipeline` | Manages the detection → proposal → adoption lifecycle |

### 8.2 Key Types

| Type | Kind | Responsibility |
|---|---|---|
| `DeviceId`, `EntityId` | Value (ULID wrapper) | Typed identity per LTD-04 |
| `Device` | Record | Device metadata container |
| `Entity` | Record | Entity record with capabilities, type, and metadata |
| `Capability` | Sealed interface | Standard capability contract; `CustomCapability` as one permitted subtype |
| `CapabilityInstance` | Record | A capability as instantiated on a specific entity (with feature_map) |
| `AttributeSchema` | Record | Type, constraints, unit, permissions for a single attribute |
| `CommandDefinition` | Record | Command parameters, required features, expected outcomes, timeout |
| `Expectation` | Sealed interface | Evaluation contract for Pending Command Ledger: `ExactMatch`, `WithinTolerance`, `EnumTransition`, `AnyChange` |
| `ExpectedOutcome` | Record | Maps an attribute to an Expectation with tolerance and timeout |
| `EntityType` | Enum | Functional domain classification with required/optional capability sets |
| `HardwareIdentifier` | Record | `(namespace, value)` tuple for protocol-level identity |
| `ProposedDevice` | Record | Integration-proposed device during discovery, before adoption |
| `CapabilityCompatibilityReport` | Record | Result of replacement compatibility checking |
| `AttributeValue` | Sealed interface | Typed attribute value: `BooleanValue`, `IntValue`, `FloatValue`, `StringValue`, `EnumValue` |
| `QuantityValue` | Record | `(value, unit)` pair for physical quantities, wrapping JSR 385 `Quantity<?>` |

---

## 9. Configuration

```yaml
device_model:
  # Discovery behavior
  discovery:
    auto_adopt: false               # If true, discovered devices are adopted without user confirmation
    proposal_ttl_hours: 168         # How long unadopted proposals persist (7 days)
    dedup_match_threshold: 1        # Minimum matching hardware identifiers for dedup

  # Capability system
  capabilities:
    allow_custom: true              # Whether custom capability registration is permitted
    custom_stability_minimum: experimental  # Minimum stability level for custom caps
    profile_change_requires_confirmation: true  # User must confirm capability changes

  # Validation
  validation:
    reject_untyped_values: true     # Hard reject values without schema conformance
    max_string_attribute_length: 4096  # Maximum string attribute value length
    invalid_report_rate_limit: 100  # Max invalid reports per entity per hour before health flag

  # Tolerance defaults (overridable per capability)
  confirmation:
    default_timeout_ms: 5000        # Default command confirmation timeout
    boolean_tolerance: exact        # Boolean confirmation mode (always exact)
    numeric_default_tolerance_pct: 3  # Default ±% for numeric attributes when not specified
    enum_tolerance: exact           # Enum confirmation mode (always exact)

  # Energy-specific
  energy:
    cumulative_reset_detection: true   # Auto-detect meter resets/rollovers
    cumulative_max_gap_factor: 0.5     # Value drop > 50% of previous triggers reset detection
```

All options have sensible defaults. HomeSynapse runs correctly with zero configuration for this subsystem (INV-CE-02).

---

## 10. Performance Targets

All targets are specified for the primary deployment target: Raspberry Pi 5, 4 GB RAM, NVMe SSD storage, running the JVM configuration in LTD-01.

| Metric | Target (Raspberry Pi 5, 4 GB RAM) | Rationale |
|---|---|---|
| Attribute validation latency (p99) | < 0.5 ms | Validation is on the hot path for every `state_reported` event. Must not measurably impact event processing throughput. |
| Command validation latency (p99) | < 1 ms | Command validation includes parameter schema checking and expectation construction. Slightly more work than attribute validation but still on the command dispatch path. |
| Device registry lookup by ID (p99) | < 0.5 ms | Lookups happen on every event for entity resolution. Must be effectively free at 100 events/sec. |
| Entity registry lookup by ID (p99) | < 0.5 ms | Same rationale as device lookup. |
| Hardware identifier dedup lookup (p99) | < 2 ms | Happens only during discovery, not on the hot path. May involve scanning a small map. |
| Capability compatibility check | < 10 ms | Happens only during device replacement, not on the hot path. |
| Device/entity registry memory (50 devices, ~150 entities) | < 5 MB | Registry is an in-memory materialized view. Must not contribute meaningfully to the 512 MB steady-state memory budget (INV-PR-02). |
| Device/entity registry memory (1,000 devices, ~3,000 entities) | < 50 MB | At scale target (INV-PR-04). Linear growth is acceptable. |

---

## 11. Observability

### 11.1 Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `hs.device.count` | Gauge | — | Total adopted devices |
| `hs.entity.count` | Gauge | `entity_type` | Total entities by type |
| `hs.capability.registration.count` | Counter | `namespace` | Custom capability registrations |
| `hs.validation.attribute.rejected` | Counter | `entity_id`, `capability_id`, `reason` | Attribute values rejected by validation |
| `hs.validation.command.rejected` | Counter | `entity_id`, `capability_id`, `reason` | Commands rejected by validation |
| `hs.discovery.proposed` | Counter | `integration_id` | Devices proposed for adoption |
| `hs.discovery.adopted` | Counter | `integration_id` | Devices adopted |
| `hs.discovery.dedup_matched` | Counter | `integration_id` | Discovery dedup matches (re-links) |
| `hs.replacement.attempted` | Counter | — | Device replacements attempted |
| `hs.replacement.compatibility` | Counter | `result` (compatible/partial/incompatible) | Replacement compatibility results |

### 11.2 Structured Logging

| Log Event | Level | Key Fields | Description |
|---|---|---|---|
| `device.adopted` | INFO | `device_id`, `integration_id`, `manufacturer`, `model`, `entity_count` | A device was adopted into the system |
| `device.removed` | INFO | `device_id`, `entity_count` | A device was removed |
| `device.metadata_changed` | INFO | `device_id`, `changed_fields`, `integration_id` | Device mutable metadata updated (firmware version, configuration) |
| `entity.enabled` | INFO | `entity_id`, `actor_ref` | An entity was enabled |
| `entity.disabled` | INFO | `entity_id`, `actor_ref` | An entity was disabled |
| `entity.profile_changed` | INFO | `entity_id`, `change_type`, `capability_id` | Entity capability profile changed |
| `validation.attribute_rejected` | WARN | `entity_id`, `attribute_key`, `rejected_value`, `reason` | An attribute value failed validation |
| `validation.command_rejected` | WARN | `entity_id`, `command_type`, `reason` | A command failed validation |
| `discovery.dedup_matched` | DEBUG | `device_id`, `hardware_identifier`, `integration_id` | Discovery re-linked to existing device |
| `replacement.compatibility_check` | INFO | `old_device_id`, `new_device_id`, `result` | Device replacement compatibility result |
| `capability.custom_registered` | INFO | `capability_id`, `namespace`, `stability` | A custom capability was registered |
| `registry.rebuilt` | WARN | `trigger`, `duration_ms`, `device_count`, `entity_count` | Registry rebuilt from event log |

### 11.3 Health Indicator

| State | Condition |
|---|---|
| **HEALTHY** | All registries loaded, no validation errors in the last 60 seconds |
| **DEGRADED** | Validation error rate exceeds threshold for one or more integrations, or registry rebuild in progress |
| **UNHEALTHY** | Registry cannot be loaded or rebuilt; device/entity data is unavailable |

---

## 12. Security Considerations

**Trust boundary at the model boundary.** Integration adapters are untrusted producers — they run in isolated virtual thread groups (LTD-17) and communicate through the Integration API. The Device Model enforces validation at this boundary: every attribute value, every command parameter, and every discovery proposal is validated before it affects the registry or event stream. A malicious or buggy integration cannot inject invalid data into the core model.

**Permission model for capabilities.** The capability model supports a `permissions` field per attribute (READ, WRITE, NOTIFY). The Automation Engine and API Layer enforce these permissions. An integration that exposes a read-only sensor cannot have write commands issued against it. This serves INV-SE-04 (least privilege for integrations).

**No secrets in the device model.** Device credentials, API keys, and protocol-level security material (Zigbee network keys, Z-Wave S2 keys) are owned by the Integration Runtime and encrypted per INV-PD-03. The Device Model stores only non-sensitive metadata. Hardware identifiers (IEEE addresses, node IDs) are internal and not exposed in user-facing paths or API responses by default.

---

## 13. Testing Strategy

### 13.1 Unit Tests

- **Attribute validation:** Test every attribute type against valid values, boundary values, out-of-range values, wrong types, null when non-nullable, and missing units for physical quantities.
- **Command validation:** Test parameter schema enforcement, required-feature gating, and expected outcome construction for every standard capability's commands.
- **Entity type composition:** Test that required-capability validation accepts valid compositions and rejects invalid ones.
- **Entity disable/enable lifecycle:** Disable an entity. Verify: `entity_disabled` event produced, State Projection stops updating the entity's state, commands targeting the entity are rejected with structured error, entity still appears in registry with `enabled = false`. Enable the entity. Verify: `entity_enabled` event produced, State Projection resumes, commands are accepted.
- **Disabled entity state_reported handling:** Disable an entity. Produce `state_reported` events. Verify: events are persisted to the log, but the State Projection does not update the entity's state, no `state_changed` events are produced for the disabled entity.
- **Expectation evaluation:** Test each `Expectation` implementation (`ExactMatch`, `WithinTolerance`, `EnumTransition`, `AnyChange`) against matching, non-matching, and edge-case values.
- **Hardware identifier dedup:** Test single-match, multi-match, no-match, and cross-integration isolation.
- **Capability compatibility checking:** Test compatible, partially compatible, and incompatible replacement scenarios.

### 13.2 Integration Tests

- **Discovery-to-adoption pipeline:** Simulate integration producing `device_discovered`, validate proposal, execute adoption, verify registry state and events produced.
- **State reporting with validation:** Integration produces `state_reported` with valid and invalid values; verify that valid values reach State Store and invalid values are rejected with proper events.
- **Command lifecycle with expectations:** Issue a command, verify expectation is registered with Pending Command Ledger, simulate `state_reported` matching the expectation, verify `state_confirmed` is produced.
- **Device replacement end-to-end:** Adopt device A, create automations referencing its entities, replace with device B, verify automations still reference the same entity IDs and function correctly.

### 13.3 Performance Tests

- **Validation throughput:** Sustain 100 `state_reported` events/sec through attribute validation on RPi4. Measure p99 latency.
- **Registry lookup throughput:** Sustain 1,000 entity lookups/sec (representing 100 events/sec each touching ~10 registry lookups). Measure p99 latency.
- **Registry memory:** Load 50 devices / 150 entities and measure heap usage. Load 1,000 devices / 3,000 entities and measure heap usage. Verify linear scaling.

### 13.4 Failure Tests

- **Invalid attribute flood:** An integration rapidly produces invalid attribute values. Verify: invalid values do not reach State Store, error rate limiting engages, integration health degrades, system performance is not impacted.
- **Registry loss and rebuild:** Delete registry data. Verify: registry rebuilds from event log, all devices and entities are restored, no events are lost, rebuild completes within performance targets.
- **Concurrent discovery and replacement:** Simultaneously discover a new device and attempt replacement of an existing device with the same hardware identifiers. Verify: system reaches a consistent state without deadlock or duplicate devices.

---

## 14. Future Considerations

**Structured attribute types.** The MVP type system supports primitives (boolean, int, float, string, enum). Post-MVP, structured types (color as `{hue, saturation, brightness}`, climate as `{current_temp, target_temp, mode}`) may be needed for capabilities where multiple attributes are semantically coupled. The attribute schema record includes a `type` field that can be extended to `STRUCT` with a nested schema definition without breaking the existing primitive types.

**Capability versioning and evolution.** The MVP capability definitions are version 1. When a standard capability needs to evolve (add an attribute, add a command, change a constraint), the `version` field enables schema negotiation. Integrations compiled against capability version 1 continue to function; new features are available only to integrations compiled against version 2+. The schema evolution rules from Event Model §3.10 (additive-only within major version per LTD-16) apply to capabilities as well.

**Dynamic feature maps.** The MVP treats feature maps as stable (changed only via `entity_profile_changed`). Some devices genuinely change capabilities dynamically (Spotify Connect changing available controls based on playback source). Post-MVP, a `feature_map_changed` event type could support truly dynamic features without conflating them with static capabilities.

**AI-driven entity classification.** Post-MVP, the entity type inference system could use ML models to classify unknown devices based on their reported attribute patterns and protocol metadata. The typed attribute system and capability composition model provide the structured input features such a classifier needs.

**Capability marketplace.** As the community ecosystem develops, custom capabilities that achieve `STABLE` status across multiple integrations become candidates for standardization. The namespace isolation and stability-level system is designed to support this promotion path.

---

## 15. Open Questions

1. **Should JSR 385 (javax.measure) be a direct dependency, or should HomeSynapse define its own unit type system?**
   Options: (a) Use JSR 385 directly via the `tech.units:indriya` implementation (~1.5 MB); (b) Define a lightweight HomeSynapse `Unit` enum covering the ~30 units needed for smart home use cases; (c) Use JSR 385 internally but expose a simplified unit model at the Integration API boundary.
   Needed: Dependency size analysis on Pi 4, evaluation of JSR 385's serialization compatibility with Jackson (LTD-08).
   Status: **[BLOCKING]** — The unit representation affects the attribute type system, event payload format, and Integration API. Must be resolved before Phase 2 interface specs.

2. **Should entity type be required at adoption, or can entities exist in an "unclassified" state?**
   Options: (a) Required — integration must propose an entity type; if none matches, adoption fails until the integration is updated; (b) Optional — entities may be adopted without a type and classified later; auto-classification is attempted from capabilities.
   Needed: Analysis of how often Zigbee device fingerprints fail to map to a known entity type in the initial adapter.
   Status: **[NON-BLOCKING]** — The composition validation logic works regardless; this question affects the UX of the adoption flow.

3. **How should the system handle cumulative energy meter rollovers?**
   Options: (a) The `energy_meter` capability includes explicit reset detection logic (compare new value < previous value × threshold); (b) Rollover detection is delegated to the State Store's aggregation logic; (c) The protocol adapter handles rollover and always reports monotonically increasing values.
   Needed: Analysis of how Zigbee Metering cluster and Z-Wave Meter CC report rollovers in practice.
   Status: **[NON-BLOCKING]** — The energy capability schema accommodates all three approaches. The detection logic location is an implementation detail that does not affect the data model.

4. **Should the CapabilityRegistry support hot-reload of custom capability definitions?**
   Options: (a) Custom capabilities are registered at integration startup and immutable for the integration's lifetime; (b) Custom capabilities can be updated at runtime via the registry API, triggering `entity_profile_changed` events for affected entities.
   Needed: Clarity on whether firmware updates that change custom capability schemas are a realistic scenario for MVP.
   Status: **[NON-BLOCKING]** — MVP integrations are compiled-in (LTD-17), so runtime registration happens at startup. Hot-reload is a future consideration.

---

## 16. Summary of Key Decisions

| Decision | Choice | Rationale | Section |
|---|---|---|---|
| Atomic unit of behavior | Entity, not Device | Prevents ambiguous device-level operations; aligns with Matter endpoint model and existing Glossary | §3.3 |
| Capability stability model | Three-level: declared / features / availability | Prevents HA's `supported_features` conflation; keeps discovery, UI, and automations stable | §3.4 |
| Capability definition approach | Sealed interfaces (standard) + CustomCapability (runtime) | Compile-time safety for standard caps; extensibility for protocol-specific features | §3.9 |
| Attribute type system | Rich types with constraints and JSR 385 units | Prevents stringly-typed state; enables generated UI and validation | §3.7 |
| Physical quantity storage | (value, unit) pairs with canonical SI storage | Prevents unit-change data corruption; presentation conversion at query time only | §3.7 |
| Command confirmation model | Capability-owned tolerance bands and timeouts | Feeds Pending Command Ledger; prevents ad hoc tolerance in automations | §3.8 |
| Capability granularity | Fine-grained, composable (OnOff + Brightness, not DimmableLight) | Prevents monolithic-capability splitting pain; safe evolution | §3.6 |
| Entity type relationship | Type determines required capabilities (with auto-classification fallback) | Enables validation, UI generation, and automation templates | §3.10 |
| Multi-function device modeling | Multiple entities per device with endpoint_index | Maps cleanly to Matter, Zigbee, Z-Wave multi-endpoint devices | §3.11 |
| Device metadata location | Registry properties (immutable identity) + device-reported mutable metadata via events | Separates identification (manufacturer, model, serial — immutable) from observable metadata (firmware version, configuration — mutable, updated via `device_metadata_changed` events). Keeps the event stream focused on state changes rather than metadata churn. | §3.2 |
| Energy device modeling | Dedicated capability families (energy_meter, power_meter, etc.) | First-class per INV-EI-01; not generic sensors with hints | §3.6 |
| Custom capability governance | Namespace isolation + stability levels + UI labeling | Prevents ecosystem fragmentation while enabling innovation | §3.9 |
| Discovery deduplication | Hardware identifier registry with integration-scoped matching | Prevents duplicate devices on re-pairing; cross-integration matching is user-initiated | §3.12 |
| Device replacement validation | Capability compatibility checking with three outcomes | Prevents silent breakage; informs user of automation impact | §3.13 |
| Tolerance band ownership | Capability definition, with adapter override | Deterministic confirmation; no ad hoc automation tolerance | §3.8 |

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It is governed by the Design Document Template and will be reviewed during architecture review.*