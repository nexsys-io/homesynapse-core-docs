# Device model architectures across smart home platforms

**The most critical insight for HomeSynapse's design is that every successful platform converges on a composition-based capability model — but they diverge sharply on where to place the boundary between type rigidity and runtime flexibility, and this single decision cascades into nearly every architectural success or failure.** Matter's cluster composition and HomeKit's constrained characteristic metadata represent the strongest foundations for a Java-based system. Home Assistant's entity model offers cautionary lessons about string-referenced identifiers and conflated state semantics. OpenHAB, as the closest architectural peer (Java, local-first), provides the most directly applicable patterns — its three-layer Thing/Channel/Item separation and JSR 385 quantity types are well-proven — but its XML configuration burden and conceptual complexity demonstrate the cost of excessive indirection.

This report synthesizes internal architecture details from 11 platforms across 10 dimensions, then applies findings directly to HomeSynapse's design questions.

---

## How platforms represent devices: identity, composition, and survival

Every platform must answer a deceptively hard question: what *is* a device? The answers reveal deep architectural commitments.

**Home Assistant** uses a three-tier model: `ConfigEntry` → `DeviceEntry` → `Entity`. A `DeviceEntry` carries dual identity via `identifiers` (domain-specific tuples like `("hue", "SERIAL123")`) and `connections` (hardware-level tuples like `(CONNECTION_NETWORK_MAC, "aa:bb:cc")`). Matching uses OR-logic — any single identifier or connection match links to the existing device. This is robust for re-discovery but creates orphan problems: re-pairing a factory-reset Zigbee device with a new network address but same IEEE address re-links correctly, but replacing a broken device creates a new `DeviceEntry` with no migration path for the hundreds of `entity_id` string references scattered across automations, dashboards, and scripts.

**OpenHAB** separates device identity more cleanly. A `Thing` carries a `ThingUID` (format: `bindingId:thingTypeId:bridgeId:thingId`), a `ThingTypeUID` for type classification, a `Configuration` map for connection parameters, and a `Properties` map for read-only metadata (firmware, serial, model). The `representation-property` field in `ThingType` XML identifies which property should be used for deduplication during discovery. Items — the application-facing state holders — are intentionally decoupled from Things. Replace a Z-Wave switch with Zigbee, re-link the Item to the new Thing's Channel, and all rules and UIs continue unchanged.

**Matter** defines the most formal hierarchy: `Node → Endpoint → Cluster → Attribute/Command/Event`. A node is a physical device with an operational node ID per fabric. Endpoints (numbered 0–65534) are virtual sub-devices. **Endpoint 0** is always the Root Node, hosting utility clusters like Basic Information (vendor name, product name, serial number, hardware/software version) and the Descriptor cluster whose `PartsList` attribute enumerates all other endpoints. This design makes multi-function devices first-class: a smart power strip is simply endpoints 1–4, each hosting an On/Off Plug-in Unit device type.

**SmartThings** assigns a platform UUID `deviceId` at provisioning, maintaining identity through radio-level identifiers (Zigbee EUI, Z-Wave network ID). Its **Component model** handles multi-function devices by allowing the same capability to appear on separate named components — a 4-gang switch has components `main`, `switchTwo`, `switchThree`, `switchFour`, each with the `switch` capability. However, voice assistants historically only see the `main` component, a significant abstraction leak.

**For HomeSynapse**: Adopt a composite identity model inspired by HA's dual-identity approach and OpenHAB's `representation-property`, but with referential integrity. Device identity should be a `DeviceId` value object (UUID), with a separate `DeviceIdentifiers` registry mapping protocol-specific identifiers to it. Multi-function devices should use Matter's endpoint concept rather than SmartThings' component naming, since numbered endpoints are protocol-native and avoid the voice-assistant visibility problem.

---

## The capability contract: how platforms define what devices can do

This is the central architectural question, and platforms take four distinct approaches:

**Approach 1 — Bitmask flags (Home Assistant).** HA uses `supported_features` as an `IntFlag` bitmask on each entity domain. `LightEntityFeature.EFFECT = 4`, `LightEntityFeature.FLASH = 8`, `LightEntityFeature.TRANSITION = 32`. The frontend checks `if (features & PAUSE)` to show controls. This was Architecture Issue #1 on the HA architecture repo: the bitmask conflates static capabilities (what the device *could* support) with dynamic availability (what it *currently* supports given its state). Spotify changes features based on which Connect device is active; ESPHome changes capabilities when firmware is reflashed. The issue was never fully resolved — integrations implement dynamic `supported_features` inconsistently. Lights eventually moved to a separate `supported_color_modes` / `color_mode` enum system, acknowledging the bitmask pattern's inadequacy for complex capability spaces.

**Approach 2 — Named capability contracts (SmartThings, Hubitat).** SmartThings defines capabilities as named contracts containing attributes and commands with JSON Schema v4 validation. The `switch` capability has attribute `switch` (enum: `["on", "off"]`) and commands `on()`, `off()`. The `switchLevel` capability has attribute `level` (integer 0–100) with `setter: setLevel` linking it to the `setLevel(level, rate?)` command. This is architecturally clean — capabilities are composable, typed, and validated. But **versioning is frozen at v1** despite a `version` field, and custom capabilities under developer namespaces cannot achieve WWST certification.

**Approach 3 — Cluster/service composition (Matter, HomeKit, Zigbee ZCL).** Matter defines clusters as reusable interfaces: the On/Off cluster (0x0006) has attributes `OnOff` (bool), `GlobalSceneControl` (bool), `OnTime` (uint16), and commands `Off`, `On`, `Toggle`. A device type is a *composition* of mandatory and optional clusters. A Dimmable Light (0x0101) requires Identify + Groups + Scenes + On/Off + Level Control + Descriptor. The **FeatureMap** attribute (32-bit bitmap per cluster) declares which optional features are supported. Combined with **ClusterRevision**, a client knows the exact specification text governing the cluster instance — this is the strongest capability contract in the ecosystem. HomeKit's Service/Characteristic model is similarly rigid: a Thermostat Service requires Current Heating Cooling State, Target Heating Cooling State, Current Temperature, Target Temperature, and Temperature Display Units, each with formal metadata (format, unit, min/max/step, permissions).

**Approach 4 — Three-layer typed channels (OpenHAB).** OpenHAB separates capability definition into `ThingType` XML (what channels a device has), `ChannelType` XML (what each channel accepts/produces, including `StateDescription` with min/max/step/pattern/options and `CommandDescription` with command options), and `Item` type (the application-layer data type: Switch, Dimmer, Number:Temperature, etc.). The binding author implements `handleCommand(ChannelUID, Command)` and calls `updateState(ChannelUID, State)`. This is the most explicit contract system — everything is declared in machine-readable XML — but the **configuration burden is substantial**. Community complaints consistently cite needing 3–4 more steps than HA to get a device operational.

**For HomeSynapse**: Use Matter's cluster composition pattern adapted to Java sealed interfaces. Define capabilities as sealed interfaces (e.g., `sealed interface OnOffCapability`) with associated attribute records and command records. Use a FeatureMap-equivalent bitmap per capability for optional features. This gives compile-time safety, composition, and extensibility (new capabilities can be added as new sealed interface implementations).

---

## Attribute type systems: from stringly-typed to formally constrained

The quality of a platform's attribute type system directly determines validation quality, UI generation accuracy, and unit conversion reliability.

**Home Assistant's type system is effectively untyped at the state machine level.** `state.state` is always a string (max **255 characters**, stored as VARCHAR(255) in the database). This limit generates persistent community frustration — GitHub issues document Zigbee2MQTT devices sending schedules that exceed it, REST sensors truncating data, and a "Month of WTH" complaint thread. Attributes in `state.attributes` are arbitrary Python dicts. Type safety comes from the entity class hierarchy: `SensorEntity` defines `native_value` (returns `StateType = str | int | float | None`), `native_unit_of_measurement`, `device_class`, and `state_class`. The `device_class` determines valid units — setting `device_class: volume` expects units from `['gal', 'fl. oz.', 'L', 'mL', 'm³', 'ft³', 'CCF']`, and using `kl` generates a warning.

**Matter's type system is the most rigorous.** Primitive types include `bool`, `uint8` through `uint64`, `int8` through `int64`, `float32`, `float64`, `octstr`, and `string`. Derived types add `enum8`, `enum16`, `bitmap8/16/32`. Composite types include `struct` and `list`. Each attribute has formal qualities: **N** (Nullable — highest value reserved for null, e.g., 0xFF for nullable uint8), **S** (Scene — participates in scene storage), **P** (Persistent — survives restart but not factory reset), **C** (Changes Omitted — reports may skip), **F** (Fabric-scoped). Constraints are expressed per attribute: min, max, minLength, maxLength. Access control is explicit: Read, Write, Fabric-Scoped, with timed writes for security-critical operations.

**HomeKit provides the best constraint metadata model for UI generation.** Each characteristic declares `format` (bool, uint8, uint16, uint32, uint64, int, float, string, tlv8, data), `unit` (celsius, percentage, arcdegrees, lux, seconds), `minValue`, `maxValue`, `minStep`, `validValues` (array of allowed values), `validValueRanges` (array of [min, max] pairs), and `permissions` (paired read, paired write, events/notify, additional authorization, timed write, hidden, write response). This metadata enables any HomeKit controller to generate appropriate UI controls without device-specific code.

**OpenHAB's JSR 385 QuantityType is the strongest unit handling system.** `QuantityType<Temperature>` wraps a `BigDecimal` value with a `javax.measure.Unit<T>`, enabling type-safe dimensional analysis and automatic locale-based conversion (US→Imperial, others→SI). The `StateDescription` in ChannelType XML adds `min`, `max`, `step`, `pattern` (Java NumberFormat string with `%unit%` placeholder), and `options` for discrete values.

**SmartThings uses JSON Schema v4 for attribute schemas**, supporting `type` (string, integer, number, boolean, object, array), `minimum`/`maximum`, `enum`, `pattern` (regex), `maxLength`, and structured `object` types with typed properties. The platform **rejects events and commands with values outside constraints** at the API level — genuine runtime validation.

**For HomeSynapse**: Build a rich type system modeled on Matter's primitives + HomeKit's constraint metadata + OpenHAB's QuantityType. Define attribute types as Java records:

```java
record AttributeSchema(
    AttributeType type,           // BOOLEAN, INT, FLOAT, STRING, ENUM, STRUCT
    @Nullable Number minimum,
    @Nullable Number maximum,
    @Nullable Number step,
    @Nullable List<String> validValues,
    @Nullable Unit<?> unit,       // JSR 385
    Set<Permission> permissions,  // READ, WRITE, NOTIFY
    boolean nullable,
    boolean persistent
)
```

---

## Commands, acknowledgments, and the desired-state problem

Command modeling reveals a critical split between fire-and-forget and confirmation-aware architectures.

**Home Assistant services are historically fire-and-forget.** Service calls (`light.turn_on`, `climate.set_temperature`) follow a `domain.action` pattern with target resolution (entity_id, device_id, area_id, floor_id, label_id → expanded to concrete entity IDs). Parameter validation uses the Voluptuous library. Until ~2023, service calls had **no return value**. The `SupportsResponse` enum now enables optional responses, but the confirmation lifecycle — did the device actually change? — is still not modeled at the platform level. Multi-entity targeting with return values remains under development.

**Matter's Invoke interaction is the most formal command model.** Commands are defined with typed parameters, sent via `InvokeRequest` containing `CommandPath` (endpoint, cluster, command) and TLV-encoded fields. Responses come as `InvokeResponse` with per-command status codes (`SUCCESS`, `CONSTRAINT_ERROR`, `UNSUPPORTED_ACCESS`, etc.). **Timed Commands** add a security-critical confirmation: client sends `TimedRequest` with timeout, server acknowledges, client must send actual `InvokeRequest` within timeout — designed to prevent replay attacks on door locks and garage openers.

**The desired-vs-reported state pattern** from cloud IoT platforms provides the most robust command-confirmation model. AWS IoT Device Shadow automatically computes a **delta** between `state.desired` and `state.reported` — fields in desired that don't match reported appear in the delta, published to a dedicated MQTT topic. When the device applies changes and reports back, the delta empties. Eclipse Ditto takes a different approach: `desiredProperties` and `properties` coexist on each Feature, but **no automatic delta is computed** — the desired properties *are* the delta, and cleanup is left to the application. Azure IoT Device Twin uses a convention-based acknowledgment pattern where devices report status (`"success"`, `"error"`, `"pending"`) and `lastDesiredVersion` in reported properties, but this is recommended practice, not platform-enforced.

**Key design insight**: None of the three cloud platforms implement built-in timeouts for desired-state convergence. If a device never responds, the desired state persists indefinitely. For HomeSynapse's Pending Command Ledger, this is a critical gap to fill.

**For HomeSynapse**: Model commands as typed records with expected outcomes:

```java
record PendingCommand(
    CommandId id,
    Instant issuedAt,
    Duration timeout,
    Map<AttributeRef, ExpectedOutcome> expectedOutcomes
)

sealed interface ExpectedOutcome {
    record ExactMatch(Object value) implements ExpectedOutcome {}
    record WithinTolerance(Number target, Number tolerance) implements ExpectedOutcome {}
    record AnyChange() implements ExpectedOutcome {}
    record EnumTransition(String targetValue) implements ExpectedOutcome {}
}
```

Compute convergence like AWS's delta: `pending = diff(desired, reported)`. Auto-resolve when reported matches expected within tolerance. Fire timeout events when convergence doesn't occur.

---

## Multi-function devices demand first-class sub-device modeling

A smart power strip with 4 individually controllable outlets plus aggregate energy monitoring is the canonical hard case. Platforms handle it in four ways:

- **Matter**: 5 endpoints (EP0=Root, EP1–4=On/Off Plug-in Unit each with On/Off + Electrical Measurement clusters). Endpoint 0's Descriptor.PartsList = [1, 2, 3, 4]. Each endpoint is independently addressable.
- **OpenHAB**: One Thing with Channel Groups (`relay1#switch`, `relay1#power`, `relay2#switch`, etc.) or a Bridge Thing with 4 child Things. Constraint: **a Thing can have EITHER direct channels OR channel groups, but not both**.
- **SmartThings**: One device with 4 Components (`main`, `switchTwo`, `switchThree`, `switchFour`), each carrying the `switch` capability. Limitation: voice assistants only see `main`.
- **Home Assistant**: 4+ entities (`switch.strip_outlet_1` through `switch.strip_outlet_4` plus `sensor.strip_energy`) all linked to one `DeviceEntry` via `device_id`.

**For HomeSynapse**: Use a Matter-inspired endpoint model. A `Device` contains `Endpoint[]`. Each endpoint has a `DeviceType`, a set of capabilities, and its own attribute state. Endpoint 0 holds device-level metadata (manufacturer, model, firmware). Application endpoints (1+) hold functional capabilities. This naturally handles power strips, multi-sensor devices, and complex appliances like thermostats (temperature sensing + HVAC control + fan control + humidity sensing as separate logical units on one device).

---

## Where device metadata belongs: registry vs attributes vs twin

Platforms diverge on whether manufacturer name, firmware version, and model number are attributes (queryable state), registry properties (static metadata), or something else entirely.

**Home Assistant** puts metadata in the `DeviceEntry`: `manufacturer`, `model`, `model_id`, `sw_version`, `hw_version`, `serial_number`, `configuration_url`. These are set by the integration via `DeviceInfo` TypedDict and stored in `.storage/core.device_registry`. They are NOT entity state — you cannot trigger automations on firmware version changes.

**OpenHAB** uses Thing `Properties` (read-only `Map<String, String>` set by the handler at runtime) for metadata and `Configuration` (mutable `Map<String, Object>`) for connection parameters. Properties are distinct from Channel state.

**Matter** uses the **Basic Information cluster** on Endpoint 0 for device metadata: `VendorName`, `VendorID`, `ProductName`, `ProductID`, `NodeLabel`, `HardwareVersion`, `SoftwareVersion`, `SerialNumber`. These are formal cluster attributes — readable, subscribable, versioned — but on a special endpoint separate from application endpoints.

**Azure IoT Device Twin** introduces **tags** — server-side-only metadata invisible to the device, used for fleet management and queries. This is architecturally clean: the device never sees its organizational metadata, avoiding circular dependency.

**For HomeSynapse**: Place metadata in a `DeviceRegistry` (like HA) for static fields (manufacturer, model, serial), but model firmware version as a diagnostic capability attribute (like Matter's Basic Information cluster) since it can change and should be event-sourced. Add Azure-style tags for user-defined organizational metadata (room, floor, labels) that the device itself doesn't need to know about.

---

## Unit of measurement: the graveyard of breaking changes

Unit handling is where platforms most frequently break backward compatibility.

**Home Assistant's UoM disaster** is well-documented. When `device_class` is specified, the unit must be from an allowed set — `device_class: volume` enforces `['gal', 'fl. oz.', 'L', 'mL', 'm³', 'ft³', 'CCF']`. Changing `native_unit_of_measurement` in an integration update corrupts historical data visualization because old data is reinterpreted with the new unit assumption. Templates using `states('sensor.x')` return the converted value, not the native value, so a sensor changing from seconds to minutes silently breaks automations. The `state_class` interaction compounds this: removing `state_class` from an entity destroys all future statistics and creates repair notices suggesting deletion of historical long-term statistics data.

**OpenHAB's JSR 385 approach is architecturally superior.** `QuantityType<Temperature>` carries both value and unit as an inseparable pair. Arithmetic operations automatically handle conversion. Locale-based conversion is automatic (US→Imperial, others→SI). Per-item unit override via metadata: `Number:Speed "Rainfall" { unit="mm/h" }`. But edge cases persist: linking a dimensional channel to a non-dimensional `Number` item silently strips the unit, and changing an item's `unit` metadata corrupts already-persisted data.

**Zigbee and Z-Wave handle units differently at the protocol level.** Zigbee Temperature Measurement uses **0.01°C units (int16)** — always Celsius, always hundredths. Z-Wave Sensor Multilevel uses a **scale field** per reading: temperature scale 0 = Celsius, scale 1 = Fahrenheit. This means a platform-level abstraction must normalize: Zigbee `2350` → `23.50°C`; Z-Wave `(value=72, scale=1)` → `72°F` → `22.22°C`.

**For HomeSynapse**: Use JSR 385 (javax.measure) as the foundation, storing all values as `QuantityType<Dimension>` with explicit units. **Never store bare numbers for physical quantities.** Protocol adapters must convert to canonical SI units at ingestion time. Store the original protocol value and unit alongside the normalized value in events for auditability. Define a `UnitConversionService` that protocol adapters register with. For the event store, persist the raw `(value, unit)` tuple — never reinterpret historical data through a different unit lens.

---

## Extensibility: sealed types vs open registries vs schema-based definitions

The extensibility question maps directly to Java 21 design choices.

**Matter's approach is "specification-first with vendor escape hatches."** Standard clusters occupy IDs 0x0000–0x7FFF; manufacturer-specific clusters use 0xFC00–0xFFFE with a manufacturer code. New interoperable behaviors require CSA specification changes. This ensures interoperability at the cost of innovation speed.

**SmartThings uses an open registry with namespace isolation.** Standard capabilities are in the `smartthings` namespace; custom capabilities use auto-generated developer namespaces (e.g., `perfectlife6617.customGarageDoor`). Custom capabilities are full JSON Schema definitions with attributes, commands, and constraints. But custom capabilities can't achieve WWST certification and have sync bugs with local Edge execution.

**OpenHAB uses Java interfaces and OSGi services.** `ThingTypeProvider` and `ChannelTypeProvider` are registered as OSGi components. The XML reader is one built-in provider; bindings can implement dynamic providers programmatically. This is the most Java-idiomatic extensibility model.

**W3C WoT uses JSON-LD context extensions.** New vocabularies are added via `@context` references, and `@type` annotations link to external ontologies (SAREF, iotschema.org). Maximum flexibility, minimum enforcement.

**For HomeSynapse**: Use a **hybrid approach** — sealed interfaces for standard capabilities (compile-time safety, exhaustive pattern matching) with a `CustomCapability` escape hatch for runtime-registered capabilities defined via JSON schema:

```java
sealed interface Capability permits
    OnOff, Brightness, ColorTemperature, ColorHS,
    TemperatureMeasurement, ThermostatControl,
    EnergyMeter, PowerMeter, BatteryLevel,
    /* ~30-50 standard capabilities */
    CustomCapability { }

record CustomCapability(
    CapabilityId id,
    String namespace,
    List<AttributeDefinition> attributes,
    List<CommandDefinition> commands
) implements Capability { }
```

This gives exhaustive `switch` expressions for standard capabilities while allowing protocol adapters to register manufacturer-specific capabilities at runtime.

---

## Energy devices need dedicated modeling, not sensor afterthoughts

Most platforms treat energy monitoring as generic sensors, losing critical domain semantics.

**Home Assistant** handles energy via `SensorDeviceClass.ENERGY` (kWh) and `SensorDeviceClass.POWER` (W) with `SensorStateClass.TOTAL_INCREASING` for cumulative meter readings that auto-detect resets. The Energy Dashboard aggregates these sensors but requires correct `state_class` — removing it permanently breaks statistics tracking. There's no formal model for energy flow direction (grid import vs export vs solar production vs battery charge/discharge).

**Matter 1.2+** added dedicated device types for energy management: Electrical Energy Measurement cluster, Electrical Power Measurement cluster, and Device Energy Management cluster. These define attributes for active/reactive/apparent power, energy consumed/produced, and power quality metrics.

**Zigbee's Metering cluster (0x0702)** provides `CurrentSummationDelivered`, `CurrentSummationReceived`, `InstantaneousDemand` with configurable units. **Z-Wave's Meter CC (0x32)** defines meter types (Electric, Gas, Water) with scales (kWh, W, V, A, Power Factor, kVAr, kVArh).

**For HomeSynapse**: Model energy devices with dedicated capabilities:

- `EnergyMeter` — cumulative kWh with direction (import/export), reset support
- `PowerMeter` — instantaneous W/VA/VAr with phase support
- `BatteryStorage` — state of charge, charge/discharge rate, capacity
- `SolarInverter` — DC input, AC output, daily yield, lifetime yield
- `EVCharger` — session energy, charge rate, connector state, vehicle connection

These should be first-class sealed interface implementations, not generic sensors with device_class hints.

---

## Protocol-agnostic identity requires a translation registry

The protocol abstraction challenge is real: Zigbee uses IEEE addresses (64-bit, permanent) + network addresses (16-bit, dynamic), Z-Wave uses Home ID + Node ID (both assigned at inclusion with no permanent hardware ID in older devices), Matter uses operational node IDs per fabric. These identity models are fundamentally incompatible.

**Existing platforms solve this via adapter-generated unique IDs.** HA's ZHA integration uses `zigbee:{ieee_address}:{endpoint_id}` as `unique_id`. Z-Wave JS uses the DSK (Device Specific Key) when available, falling back to `{home_id}-{node_id}`. OpenHAB's Z-Wave binding maintains a device database of 802+ devices from 114 manufacturers, mapping Command Class IDs to Channel definitions.

**The critical mapping challenge**: protocol-level primitives don't cleanly map to platform capabilities. Z-Wave's `Multilevel Switch` CC (0x26) can be a dimmer, a cover motor, or a fan — the protocol alone is insufficient. Zigbee's `On/Off` cluster on a device with `device_type: 0x0100` (On/Off Light) is a light; on `device_type: 0x0103` (On/Off Output) it's a switch. Both platforms require **device signature databases** — ZHA calls them "quirks," OpenHAB uses XML device databases — to map correctly.

**Information lost in abstraction is significant**: Zigbee transition times, Z-Wave continuous dimming (Start/StopLevelChange), attribute reporting configuration, peer-to-peer associations, manufacturer-specific clusters, and Z-Wave configuration parameters are all commonly dropped or inaccessible through platform abstractions.

**For HomeSynapse**: Build a three-layer translation architecture:

1. **Protocol Transport** — raw protocol communication (zigpy, zwave-js equivalent)
2. **Protocol Adapter** — maps protocol primitives to platform capabilities using device signature databases, normalizes value ranges (Zigbee 0–254 → 0.0–1.0, Z-Wave 0–99 → 0.0–1.0), converts units to SI
3. **Platform Model** — protocol-agnostic capabilities, attributes, commands

Store the original protocol identity alongside the platform `DeviceId`. Preserve protocol-specific features as `CustomCapability` instances when no standard capability maps. Build a quirks/override system from day one.

---

## Lessons from failure: the architectural anti-pattern catalog

The most valuable findings are the failure modes, because these are what will bite HomeSynapse if not proactively avoided.

**Anti-pattern 1: String-referenced entity identifiers.** Home Assistant's `entity_id` is used as a string reference throughout automations, dashboards, scripts, and templates with **zero referential integrity**. Renaming `light.kitchen` to `light.kitchen_main` silently breaks every automation referencing it. GitHub issue #138953 documents this. *Mitigation*: Use opaque UUIDs internally; use human-readable names only for display. All references should use typed ID objects, not strings.

**Anti-pattern 2: Conflating static capabilities with dynamic availability.** HA's `supported_features` bitmask tries to express both "what the device can do" and "what it can do right now." This breaks Alexa/HomeKit/Google discovery, which needs static capabilities at setup time. *Mitigation*: Separate `declaredCapabilities` (static, set at pairing) from `activeFeatures` (dynamic, can change with state).

**Anti-pattern 3: Mutable units on historical data.** Changing `native_unit_of_measurement` in HA corrupts historical graphs because old data is reinterpreted with new unit assumptions. *Mitigation*: Store `(value, unit)` tuples in events. Never reinterpret. Convert at query time, not storage time.

**Anti-pattern 4: Destructive statistics migration.** HA's removal of `state_class` from an entity permanently stops statistics and suggests deleting historical data as the "fix." *Mitigation*: Event-sourced architecture inherently preserves history. Statistics projections should gracefully degrade when metadata changes, not destroy data.

**Anti-pattern 5: Monolithic capability definitions.** SmartThings' original monolithic `thermostat` capability contained 7 attributes and 12 commands. It was deprecated and split into 5 separate capabilities, forcing device re-modeling. *Mitigation*: Start with fine-grained capabilities and compose them, never the reverse.

**Anti-pattern 6: Excessive indirection without automation.** OpenHAB's Thing→Channel→Link→Item pipeline requires manual configuration for each hop. *Mitigation*: If using a layered model, auto-generate the default mapping. Only require manual configuration for non-standard cases.

---

## Answering HomeSynapse's design questions

**Q1: How should capabilities be defined?** Hybrid: Java sealed interfaces for ~30–50 standard capabilities (compile-time exhaustiveness, pattern matching), plus a `CustomCapability` class for runtime-registered capabilities defined via JSON schema. Standard capabilities should use Matter's composition pattern — a `DimmableLight` device type requires `OnOff` + `Brightness` capabilities. Use a `FeatureMap` bitmap per capability for optional features (like Matter's approach). Register custom capabilities through a `CapabilityRegistry` service (like OpenHAB's OSGi providers).

**Q2: What attribute type system?** Rich types with constraints, modeled as Java records. Every attribute needs: type (boolean, int, float, string, enum, struct), constraints (min, max, step, validValues), unit (JSR 385 `Unit<?>` for physical quantities), permissions (READ, WRITE, NOTIFY), and qualities (nullable, persistent, reportable). This combines Matter's formal type system, HomeKit's constraint metadata, and OpenHAB's QuantityType. Structured types like color should be modeled as records: `record HSBColor(float hue, float saturation, float brightness)`.

**Q3: How should commands declare expected outcomes?** Each command should carry an `ExpectedOutcome` specification for the Pending Command Ledger. For `setBrightness(75)`, the expected outcome is `WithinTolerance(attributeRef=brightness, target=75, tolerance=2, timeout=5s)`. For `setThermostatMode("heat")`, it's `ExactMatch(attributeRef=mode, value="heat", timeout=30s)`. For `toggle()`, it's `AnyChange(attributeRef=onOff, timeout=3s)`. Tolerance bands should be type-aware: numeric attributes use absolute or percentage tolerance; enum attributes use exact match; boolean attributes use exact match. This is inspired by AWS Shadow's delta computation but adds the timeout dimension none of the cloud platforms implement natively.

**Q4: How should multi-function devices be modeled?** Use Matter's endpoint model. A `Device` contains a list of `Endpoint` objects. Each endpoint declares a `DeviceType` and carries its own set of capability instances with independent state. Endpoint 0 holds device-level metadata (Basic Information equivalent). A power strip with energy monitoring: EP0=DeviceInfo, EP1–4=SwitchableOutlet(OnOff+EnergyMeter), EP5=AggregateEnergyMeter. A thermostat: EP0=DeviceInfo, EP1=Thermostat(TemperatureMeasurement+ThermostatControl+HumiditySensor+FanControl). Endpoints are independently addressable in the event store.

**Q5: Where should device metadata live?** Three tiers: (1) **DeviceRegistry** for immutable identification (manufacturer, model, serial number — set at pairing, never changes), (2) **Diagnostic capability attributes** for mutable device info (firmware version, signal strength, uptime — event-sourced, triggerable), (3) **Tags** (Azure-style) for user-defined organizational metadata (room assignment, labels, floor — not visible to the device, mutable by user). This separates concerns cleanly: the registry is for identification, attributes are for observable state, tags are for organization.

**Q6: Should entity type determine required capabilities, or emerge from them?** **Entity type should determine required capabilities** (Matter's approach), not the reverse. Define device types as compositions: `DeviceType.DIMMABLE_LIGHT` requires `OnOff` + `Brightness`, optionally `ColorTemperature` or `ColorHS`. This enables validation (reject a device claiming to be a dimmable light without brightness capability), UI generation (know what controls to show), and automation templates (know what actions are possible). However, also support emergent typing: if a device presents `OnOff` + `Brightness` without declaring a device type, infer `DIMMABLE_LIGHT`. This handles the Zigbee/Z-Wave case where protocol metadata may be insufficient.

**Q7: How should energy devices be modeled as first-class citizens?** Define dedicated sealed interface capabilities: `EnergyMeter` (cumulative kWh, direction: IMPORT/EXPORT/BIDIRECTIONAL), `PowerMeter` (instantaneous W, optional VA/VAr/PF), `BatteryStorage` (SoC%, capacity Wh, charge/discharge rate W, state: CHARGING/DISCHARGING/IDLE), `SolarInverter` (DC input W, AC output W, daily yield kWh, lifetime yield kWh), `EVCharger` (session kWh, charge rate W, connector state, max current A). These should compose onto device types: an EV charger is `EVCharger` + `EnergyMeter` + `PowerMeter`. Use `SensorStateClass.TOTAL_INCREASING` semantics from HA for cumulative meters (auto-detect resets), but implement it as a capability trait rather than a sensor classification.

**Q8: How to maintain protocol-agnostic identity while enabling protocol-specific features?** Use a layered identity model: `PlatformDeviceId` (UUID, stable forever) → `ProtocolIdentity` (protocol-specific, stored in registry: `ZigbeeIdentity(ieee, endpoint)`, `ZWaveIdentity(homeId, nodeId, endpoint)`, `MatterIdentity(fabricId, nodeId, endpoint)`). Protocol-specific features that don't map to standard capabilities should be exposed as `CustomCapability` instances with a protocol namespace (e.g., `zigbee:tuya:datapoint_102`). Build a `DeviceSignatureDatabase` (like ZHA quirks + OpenHAB's device DB) that maps `(protocol, manufacturer, model)` → `(deviceType, capabilityOverrides, quirks)`. Preserve raw protocol access for advanced users through a `ProtocolChannel` interface.

---

## Conclusion: the architectural blueprint

The research reveals a clear convergence across 11 platforms toward **composition-based capability modeling with rich attribute constraints**. The strongest architectural foundations come from Matter (cluster composition, FeatureMap, endpoint model), HomeKit (constraint metadata, permission model), and OpenHAB (JSR 385 units, three-layer separation, Java idioms). The most important lessons come from failures: HA's string-referenced entity IDs, conflated supported_features, and unit-change data corruption; SmartThings' monolithic-capability splitting pain; and OpenHAB's configuration overhead.

For HomeSynapse specifically, the event-sourced architecture provides a natural advantage over all surveyed platforms: storing `(value, unit)` tuples as immutable events eliminates the unit-reinterpretation problem, `desiredProperties` vs `properties` maps directly to the command/event separation in CQRS, and device identity can use the event log as the source of truth for identity continuity across re-pairing. The key novelty opportunity is the Pending Command Ledger with typed tolerance bands and timeouts — no surveyed platform implements this natively, yet every platform's users complain about the "did my command actually work?" uncertainty.