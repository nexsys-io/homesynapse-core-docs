# HomeSynapse Core — Zigbee Adapter

**Document type:** Subsystem design
**Status:** Draft
**Subsystem:** Zigbee Adapter
**Dependencies:** Event Model & Event Bus (§3.1 producer boundaries, §3.3 priority model, §3.5 telemetry boundary, §3.9 origin model, §4.3 event type taxonomy, §8.3 EventPublisher two-method API), Device Model & Capability System (§3.5–§3.6 capability definitions and standard capability set, §3.7 attribute type system, §3.8 command confirmation model and ExpectationFactory, §3.10 entity type compositions, §3.11 multi-function device modeling, §3.12 discovery/adoption/deduplication pipeline), Integration Runtime (§3.2 hybrid thread architecture with IoType.SERIAL, §3.3 adapter lifecycle 8-state model, §3.4 OTP-style supervision, §3.5 health checking mechanisms, §3.7 exception classification, §3.8 IntegrationContext composed API surface, §4.1 IntegrationDescriptor with IoType.SERIAL and DataPath.DOMAIN + TELEMETRY, §4.4 integration lifecycle events), Identity and Addressing Model (§6 hardware identifier mapping rules), Glossary v1 (§2 Device Model vocabulary)
**Dependents:** None yet
**Author:** HomeSynapse Core Architecture
**Date:** 2026-03-08

---

## 0. Purpose

The Zigbee Adapter is HomeSynapse's first protocol integration — the concrete implementation that validates every abstract interface defined by the Integration Runtime, Device Model, and Event Model against real hardware behavior. It translates between the Zigbee Cluster Library (ZCL) protocol world of endpoints, clusters, and attribute reports and the HomeSynapse world of entities, capabilities, and domain events.

Without this subsystem, HomeSynapse has no path from physical devices to the event log. The Integration Runtime defines how adapters are supervised; the Device Model defines what devices look like; the Event Model defines what events carry. This adapter is the first code that exercises all three simultaneously, discovering devices on a Zigbee mesh, mapping their ZCL clusters to HomeSynapse capabilities, publishing attribute observations as `state_reported` events, and dispatching commands as ZCL frames.

The adapter communicates with a Zigbee coordinator (Texas Instruments CC2652 or Silicon Labs EFR32) over USB serial. Two fundamentally different serial protocols — Z-Stack ZNP and EmberZNet EZSP — require distinct transport implementations behind a common coordinator abstraction. Beyond the protocol layer, roughly 60% of consumer Zigbee devices follow standard ZCL closely enough for generic cluster handling. The remaining 40% require manufacturer-specific translation: Tuya devices tunnel a proprietary datapoint protocol through cluster 0xEF00, and Xiaomi/Aqara devices embed battery and sensor data in a custom TLV structure on the Basic cluster. The adapter's architecture must handle all three categories through a single extensible pipeline.

---

## 1. Design Principles

**Transport is an implementation detail; protocol semantics are the contract.** The difference between ZNP and EZSP is a transport concern — byte framing, acknowledgment, and serial timing. Above the transport layer, both protocols express the same ZCL operations: read attributes, write attributes, configure reporting, send cluster commands. The adapter separates transport from protocol so that adding a new coordinator requires only a new transport implementation, not changes to device handling or capability mapping. This is the adapter-level expression of INV-CE-04 (protocol agnosticism).

**Devices declare themselves; the adapter interprets.** The adapter does not hardcode device behavior. It reads the device's Simple Descriptors during interview, matches clusters to capability definitions, and applies device profile overrides only when the device's actual protocol behavior diverges from the ZCL standard. A new device that follows ZCL correctly works without any adapter changes. This principle minimizes the maintenance surface for the ~60% of devices in the standard-compliant category.

**Every frame produces an event or a log entry.** No Zigbee frame is silently consumed. Attribute reports become `state_reported` events. Command acknowledgments become `command_result` events. Network telemetry becomes integration-namespaced telemetry events or `TelemetryWriter` samples. Unrecognized frames produce structured DEBUG log entries with the raw hex payload for diagnostic analysis. This satisfies INV-ES-06 (every state change is explainable) and INV-TO-01 (system behavior is observable) at the protocol boundary.

**Manufacturer codecs are isolated subsystems, not special cases.** Tuya 0xEF00 and Xiaomi 0xFF01/0xFCC0 are not quirks patched onto generic handling — they are distinct codec pipelines with their own parsing, validation, and mapping logic. Treating them as isolated subsystems prevents the "quirk accumulation" pattern observed in both zigbee2mqtt and ZHA, where device-specific fixes create an unmaintainable tangle of conditional paths.

**The adapter initializes without device connectivity.** Consistent with Integration Runtime principle P3 (INV-RF-03), the adapter's `initialize()` method completes without waiting for the serial port to open or the coordinator to respond. Serial connection and network formation happen in the `run()` phase. A coordinator that is powered off at system start does not block the dashboard, other integrations, or automation execution for unaffected devices.

---

## 2. Scope and Boundaries

### 2.1 This Subsystem Owns

- Serial communication with ZNP and EZSP coordinator firmware, including frame parsing, acknowledgment handling, and protocol-level error recovery
- The coordinator abstraction layer that presents a unified interface above both serial protocols
- The device interview pipeline: Node Descriptor, Active Endpoints, Simple Descriptors, Basic cluster attribute reads, cluster binding, and reporting configuration
- The declarative cluster-to-capability mapping registry that translates ZCL clusters and attributes into HomeSynapse capabilities and attribute values
- The device profile registry that stores per-model overrides for devices requiring non-standard handling
- Manufacturer-specific codec subsystems: Tuya datapoint codec (cluster 0xEF00) and Xiaomi TLV codec (attributes 0xFF01 on Basic cluster and 0x00F7 on cluster 0xFCC0)
- ZCL command construction and dispatch for outbound commands (on/off, level, color temperature, etc.)
- Network telemetry collection: per-frame RSSI and LQI extraction, periodic topology scans via ZDO Mgmt_Lqi_req
- Coordinator health monitoring: serial port liveness, firmware ping, network formation state
- Permit-join lifecycle management with automatic timeout enforcement
- Zigbee network key generation and storage coordination with the secrets infrastructure

### 2.2 This Subsystem Does Not Own

- Adapter lifecycle management (start, stop, restart, health state transitions) — owned by **Integration Runtime** (§3.3, §3.4)
- Device and entity record persistence, hardware identifier deduplication, and the discovery-to-adoption pipeline — owned by **Device Model & Capability System** (§3.12). This adapter produces `device_discovered` events; the Device Model manages adoption.
- Capability definitions (standard sealed interfaces, attribute schemas, command definitions) — owned by **Device Model & Capability System** (§3.5, §3.6). This adapter maps ZCL clusters to those definitions; it does not define them.
- Event persistence and subscriber delivery — owned by **Event Model & Event Bus** (§3.4). This adapter publishes events via `EventPublisher`; the event bus handles everything after persistence.
- State materialization from events — owned by **State Store & State Projection**. This adapter does not maintain a view of current device state. When it needs current state (e.g., to determine whether a level change requires an OnOff transition), it queries `StateQueryService`.
- Configuration schema validation and file watching — owned by **Configuration System**. This adapter declares its configuration schema; the Configuration System validates and delivers it.
- OTA firmware updates — explicitly deferred from MVP (§14). Users use zigbee2mqtt or manufacturer apps for firmware updates.

---

## 3. Architecture

### 3.1 Subsystem Position

The Zigbee Adapter sits inside the Integration Runtime as the first `IntegrationAdapter` implementation. It communicates downward to the coordinator over USB serial and upward to HomeSynapse's core through the `IntegrationContext` API surface.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         HomeSynapse Core                            │
│                                                                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ Event Bus  │  │ State Store│  │ Device     │  │ Automation  │  │
│  │            │  │            │  │ Model      │  │ Engine      │  │
│  └─────▲──────┘  └─────▲──────┘  └─────▲──────┘  └─────────────┘  │
│        │               │               │                           │
│  ┌─────┴───────────────┴───────────────┴────────────────────────┐  │
│  │              IntegrationContext (scoped)                      │  │
│  │  EventPublisher │ EntityRegistry │ StateQueryService          │  │
│  │  ConfigAccess   │ SchedulerSvc   │ HealthReporter             │  │
│  │  CommandHandler │ TelemetryWriter                             │  │
│  └─────────────────────────┬────────────────────────────────────┘  │
│                            │                                       │
│  ┌─────────────────────────▼────────────────────────────────────┐  │
│  │                    Zigbee Adapter                             │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │              Protocol Layer (Virtual Threads)            │  │  │
│  │  │                                                         │  │  │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │  │  │
│  │  │  │ Device       │  │ Command      │  │ Network      │  │  │  │
│  │  │  │ Interview    │  │ Dispatcher   │  │ Telemetry    │  │  │  │
│  │  │  │ Pipeline     │  │              │  │ Collector    │  │  │  │
│  │  │  └──────────────┘  └──────────────┘  └──────────────┘  │  │  │
│  │  │                                                         │  │  │
│  │  │  ┌──────────────────────────────────────────────────┐   │  │  │
│  │  │  │          Cluster-to-Capability Mapper             │   │  │  │
│  │  │  │                                                   │   │  │  │
│  │  │  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │   │  │  │
│  │  │  │  │ Standard │  │ Device   │  │ Manufacturer  │  │   │  │  │
│  │  │  │  │ ZCL      │  │ Profile  │  │ Codecs        │  │   │  │  │
│  │  │  │  │ Handlers │  │ Registry │  │ (Tuya/Xiaomi) │  │   │  │  │
│  │  │  │  └──────────┘  └──────────┘  └───────────────┘  │   │  │  │
│  │  │  └──────────────────────────────────────────────────┘   │  │  │
│  │  │                                                         │  │  │
│  │  │  ┌──────────────────────────────────────────────────┐   │  │  │
│  │  │  │       Coordinator Abstraction                     │   │  │  │
│  │  │  │  sendZclFrame() · permitJoin() · interview()      │   │  │  │
│  │  │  │  formNetwork() · topologyScan() · ping()          │   │  │  │
│  │  │  └──────────────────────┬───────────────────────────┘   │  │  │
│  │  └─────────────────────────┼───────────────────────────────┘  │  │
│  │                            │                                   │  │
│  │  ┌─────────────────────────▼───────────────────────────────┐  │  │
│  │  │       Transport Layer (Dedicated Platform Thread)        │  │  │
│  │  │                                                          │  │  │
│  │  │  ┌────────────────┐        ┌─────────────────────────┐  │  │  │
│  │  │  │ ZNP Transport  │   OR   │ EZSP/ASH Transport      │  │  │  │
│  │  │  │ (UNPI framing, │        │ (ASH framing, CRC,      │  │  │  │
│  │  │  │  XOR checksum) │        │  randomization,         │  │  │  │
│  │  │  │                │        │  byte stuffing, ACK/NAK) │  │  │  │
│  │  │  └────────┬───────┘        └──────────┬──────────────┘  │  │  │
│  │  └───────────┼───────────────────────────┼─────────────────┘  │  │
│  └──────────────┼───────────────────────────┼────────────────────┘  │
└─────────────────┼───────────────────────────┼──────────────────────┘
                  │                           │
                  ▼                           ▼
           ┌─────────────┐            ┌─────────────┐
           │ /dev/ttyUSB0│            │ /dev/ttyACM0│
           │ CC2652 USB  │            │ EFR32 USB   │
           └─────────────┘            └─────────────┘
```

### 3.2 Two-Layer Coordinator Architecture

The adapter separates serial communication into two layers with distinct threading models, following Integration Runtime §3.2 (IoType.SERIAL → dedicated platform thread for serial I/O).

**Transport layer (platform thread).** A single dedicated platform thread owns the serial port file descriptor via jSerialComm. This thread performs all `readBytes()` and `writeBytes()` calls, isolating JNI-induced carrier thread pinning from the virtual thread pool. The transport layer is responsible for byte-level framing: UNPI framing for ZNP (SOF detection, length extraction, XOR checksum validation), or ASH framing for EZSP (byte destuffing, data derandomization, CRC-CCITT validation, ACK/NAK generation). Parsed frames are placed on an inbound `BlockingQueue<ZigbeeFrame>`. Outbound frames are consumed from a write queue and serialized to bytes.

For EZSP, the transport layer also manages the ASH state machine (CONNECTED, FAILED) and handles ACK/NAK/retransmission directly. ASH timing requirements (adaptive ACK timeout, 0.4–3.2 second range per bellows) preclude delegating acknowledgment decisions to the protocol layer through a queue.

**Protocol layer (virtual threads).** A virtual thread drains the inbound frame queue and processes each frame: correlating SREQ/SRSP pairs for ZNP, dispatching AREQ notifications to registered handlers, interpreting ZDO responses during interview, and parsing ZCL attribute reports through the cluster-to-capability mapper. The protocol layer uses `CompletableFuture<T>` for synchronous request-response correlation: the caller creates a future, registers it in a `ConcurrentHashMap<CorrelationKey, CompletableFuture<?>>`, submits the outbound frame to the write queue, and blocks on `future.get(timeout)`. The transport layer completes the matching future when the response frame arrives.

This separation produces a clean division: the transport layer handles bytes and timing; the protocol layer handles semantics and state.

### 3.3 Transport Implementations

**ZNP transport.** Frame format: `SOF(0xFE) | Length(1B) | CMD0(1B) | CMD1(1B) | Data(0–250B) | FCS(1B XOR)`. Command types identified by CMD0 bits 7–5: SREQ (0x20), SRSP (0x60), AREQ (0x40). The transport validates FCS on every frame and discards corrupt frames with a structured log entry. ZNP has no built-in retransmission; the protocol layer must handle timeouts on SREQ/SRSP correlation (6000 ms timeout, consistent with zigbee-herdsman).

A `Semaphore` limits concurrent in-flight SREQ operations. CC2652-based coordinators support up to 16 concurrent operations; CC2531 (legacy, not a recommended target but may appear in the field) supports 2. The semaphore count is derived from the coordinator model detected during initialization.

**EZSP/ASH transport.** The ASH layer is substantially more complex than UNPI. Key implementation concerns: byte destuffing (escape 0x7E, 0x7D, 0x11, 0x13, 0x18, 0x1A with XOR 0x20 prefix), data derandomization (LFSR seeded at 0x42: `if bit0==0: next=val>>1; if bit0==1: next=(val>>1)^0xB8`), CRC-CCITT (polynomial 0x1021, init 0xFFFF, big-endian output), 3-bit sliding window sequence numbers, and piggyback acknowledgments. The EZSP version negotiation command (0x0000) always uses legacy single-byte frame ID format for backward compatibility. The transport supports EZSP versions 8 through the current version for EFR32 hardware.

ASH window size is 1 (stop-and-wait), consistent with bellows. The adaptive ACK timeout starts at 1.6 seconds, with a minimum of 0.4 seconds and maximum of 3.2 seconds. Five consecutive timeouts transition the ASH state machine to FAILED, which propagates to the protocol layer as a transport failure.

**Transport selection.** The adapter auto-detects the coordinator type during initialization by probing the serial port. It sends a ZNP `SYS_PING` SREQ and an EZSP RST frame in sequence. The first valid response determines the transport type. If neither responds within 10 seconds, the adapter throws a `PermanentIntegrationException` with a user-readable message identifying the serial port and suggesting the user verify the coordinator is connected and the port permissions are correct.

### 3.4 Device Interview Pipeline

When a device joins the network (detected via ZDO Device Announce or triggered by permit-join), the adapter executes an interview sequence that gathers the device's structural metadata and maps it to HomeSynapse's device model.

**Interview sequence:**

1. **Device Announce** received (IEEE address, network address, capability flags)
2. **Node Descriptor Request** (ZDO 0x0002) — determines manufacturer code, max buffer size, and whether the device is a coordinator, router, or end device
3. **Active Endpoints Request** (ZDO 0x0005) — enumerates application endpoints (1–240)
4. **Simple Descriptor Request** per endpoint (ZDO 0x0004) — retrieves profile ID, device type ID, input/output cluster lists
5. **Read Basic Cluster attributes** (cluster 0x0000) on the first application endpoint — ManufacturerName (0x0004), ModelIdentifier (0x0005), PowerSource (0x0007), SWBuildID (0x4000)
6. **Match device profile** — look up `(manufacturerName, modelIdentifier)` in the device profile registry. If found, apply profile overrides. If not found, use generic ZCL handling.
7. **Produce `device_discovered` event** — includes IEEE address as the hardware identifier (namespace `zigbee`, value is the 64-bit IEEE address formatted as `0x00158D00012345AB`), the cluster list per endpoint, manufacturer/model strings, and the matched device profile identifier (if any)
8. **Await adoption** — the Device Model's discovery pipeline (Doc 02 §3.12) processes the `device_discovered` event, performs deduplication, and either adopts the device (producing `device_adopted`) or links it to an existing device record
9. **Bind clusters** (ZDO 0x0021) — bind each input cluster on each endpoint to the coordinator, enabling attribute reports to flow to the adapter
10. **Configure Reporting** (ZCL 0x06) — set min/max intervals and reportable change thresholds per the cluster's default reporting configuration (§3.7). Xiaomi/Aqara devices are excluded from reporting configuration (they report on their own schedule and reject configuration attempts).

Interview steps 2–5 execute as sequential ZDO/ZCL request-response pairs, each with a 10-second timeout. The entire interview has a 60-second timeout. If any step fails, the adapter retries the entire interview up to 3 times with exponential backoff (5s, 15s, 30s). Persistent interview failure produces a structured WARN log entry and a `device_discovered` event with an `interview_status: PARTIAL` flag, carrying whatever metadata was successfully gathered. The Device Model's adoption pipeline decides whether a partially-interviewed device is adoptable.

**Sleepy device interview.** Zigbee end devices (battery-powered sensors) sleep between transmissions and may not respond to interview requests. The adapter maintains a pending interview queue. When a sleepy device sends any frame (including the initial Device Announce), the adapter checks the queue and resumes the interview. Pending interviews expire after 24 hours with a structured log entry.

### 3.5 Cluster-to-Capability Mapping

The mapping between ZCL clusters and HomeSynapse capabilities is the adapter's central translation function. The design follows zigbee2mqtt's converter composition pattern, adapted to HomeSynapse's sealed capability interfaces.

**Standard cluster handlers.** Each supported ZCL cluster has a handler that translates attribute reports into HomeSynapse attribute values and constructs ZCL commands from HomeSynapse command definitions. Standard handlers cover the MVP cluster set:

| ZCL Cluster | ID | HomeSynapse Capability | Attribute Mapping |
|---|---|---|---|
| OnOff | 0x0006 | `on_off` | `onOff` (Bool) → `state` (BooleanValue) |
| LevelControl | 0x0008 | `brightness` | `currentLevel` (Uint8, 0–254) → `brightness` (IntValue, 0–254; percentage derived at query time) |
| ColorControl (CT) | 0x0300 | `color_temperature` | `colorTemperatureMireds` (Uint16) → `color_temp_mireds` (IntValue); K = 1,000,000 / mireds computed at query time |
| TemperatureMeasurement | 0x0402 | `temperature` | `measuredValue` (Int16, 0.01°C) → `temperature` (QuantityValue, °C, value/100.0) |
| RelativeHumidity | 0x0405 | `humidity` | `measuredValue` (Uint16, 0.01%) → `humidity` (QuantityValue, %, value/100.0) |
| IlluminanceMeasurement | 0x0400 | `illuminance` | `measuredValue` (Uint16) → `illuminance` (QuantityValue, lx). Log conversion or direct pass-through per device profile. |
| OccupancySensing | 0x0406 | `occupancy` | `occupancy` (Bitmap8, bit 0) → `occupancy` (BooleanValue) |
| IAS Zone | 0x0500 | Per zone type: `motion`, `contact`, `water_leak`, `smoke`, `vibration` | `zoneStatus` (Bitmap16) → boolean alarm state. Zone type (0x0001) determines capability selection. |
| ElectricalMeasurement | 0x0B04 | `power_meter` | `activePower` (Int16) × multiplier / divisor → `power` (QuantityValue, W) |
| Metering | 0x0702 | `energy_meter` | `currentSummationDelivered` (Uint48) × multiplier / divisor → `energy` (QuantityValue, kWh) |
| PowerConfiguration | 0x0001 | `battery` | `batteryPercentageRemaining` (Uint8, 0.5% units) → `battery_level` (IntValue, percentage = raw/2) |

**Value normalization contracts.** Every value flowing from ZCL to HomeSynapse passes through a normalization step that converts protocol-specific units to the canonical units defined by the Device Model's attribute type system (Doc 02 §3.7). Temperature in 0.01°C becomes a `QuantityValue` in °C. Battery percentage remaining in 0.5% units becomes a standard percentage integer. Electrical measurement values are scaled by their cluster-specific multiplier/divisor ratios. The adapter reads multiplier/divisor attributes from ElectricalMeasurement and Metering clusters during reporting configuration and caches them per entity for use during value normalization.

**Entity type classification.** The adapter classifies each endpoint into a HomeSynapse entity type based on the ZCL device type ID from the Simple Descriptor and the cluster composition. The mapping follows Doc 02 §3.10 entity type compositions:

| ZCL Device Type | Cluster Composition | HomeSynapse Entity Type |
|---|---|---|
| On/Off Light (0x0100) | OnOff | `light` |
| Dimmable Light (0x0101) | OnOff + LevelControl | `light` |
| Color Temperature Light (0x010C) | OnOff + LevelControl + ColorControl(CT) | `light` |
| Extended Color Light (0x010D) | OnOff + LevelControl + ColorControl(full) | `light` |
| On/Off Light Switch (0x0103) | OnOff (client) | `button` |
| Dimmer Switch (0x0104) | LevelControl (client) | `button` |
| Occupancy Sensor (0x0107) | OccupancySensing | `binary_sensor` |
| Temperature Sensor (0x0302) | TemperatureMeasurement | `sensor` |
| IAS Zone (0x0402) | IAS Zone | Per zone type: `binary_sensor` or `sensor` |
| Smart Plug (0x0051) | OnOff + ElectricalMeasurement + Metering | `switch` (with energy capabilities) |

When the device type ID is absent or unrecognized, the adapter falls back to cluster-based classification: if the endpoint has OnOff server and LevelControl server, it is a `light`; if it has OnOff server without LevelControl, it is a `switch`; if it has only measurement clusters, it is a `sensor`.

**Multi-endpoint devices.** A physical Zigbee device with multiple application endpoints (e.g., a 3-gang switch with endpoints 1, 2, 3 each carrying OnOff server) produces one HomeSynapse entity per endpoint, each with its own entity ID and capabilities. The `device_discovered` event carries the full endpoint list, and the Device Model creates the entity-per-endpoint structure during adoption (Doc 02 §3.11).

### 3.6 Device Profile Registry

The device profile registry stores per-model overrides that adjust the adapter's behavior for devices that deviate from standard ZCL. A profile is keyed by `(manufacturerName, modelIdentifier)` — exact string match, with optional wildcard prefix matching for manufacturer families.

**Profile contents:**

```java
public record DeviceProfile(
    String profileId,                   // e.g., "ikea_tradfri_bulb"
    Set<ManufacturerModelPair> matches, // {("IKEA of Sweden", "TRADFRI*")}
    DeviceCategory category,            // STANDARD_ZCL, MINOR_QUIRKS, MIXED_CUSTOM, FULLY_CUSTOM
    Map<Integer, ClusterOverride> clusterOverrides,   // Per-cluster adjustments
    Map<Integer, ReportingOverride> reportingOverrides, // Per-cluster reporting config
    String manufacturerCodec,           // null, "tuya_ef00", "xiaomi_ff01", "xiaomi_fcc0"
    Set<String> interviewSkips,         // e.g., {"configure_reporting"} for Xiaomi
    Map<String, Object> properties      // Profile-specific flags
) {}
```

Profiles are loaded from a bundled JSON resource file (`zigbee-profiles.json`) at adapter initialization and from an optional user override file at `integrations.zigbee.profiles_path`. User profiles take precedence over bundled profiles for the same manufacturer/model pair. This supports the ~40% of devices in the minor-quirks and manufacturer-custom categories without code changes.

**Category distribution** (from competitive research):

| Category | Devices | Handling |
|---|---|---|
| D: Standard ZCL | Sonoff SNZB, Philips Hue, generic Zigbee 3.0 | Generic cluster handlers. No profile needed. |
| C: Minor quirks | IKEA TRÅDFRI, some Tuya standard-mode | Profile overrides: reporting intervals, attribute ranges, transition constraints |
| B: Mixed standard + custom | Xiaomi/Aqara | Profile activates Xiaomi TLV codec. Standard reporting configuration skipped. |
| A: Fully custom protocol | Tuya 0xEF00 (modelID `TS0601`) | Profile activates Tuya DP codec. Cluster-to-capability mapping replaced by DP-to-capability mapping. |

### 3.7 Reporting Configuration

After a device is adopted and its entities are created, the adapter configures attribute reporting for each bound cluster. The Configure Reporting command (ZCL 0x06) sets minimum interval, maximum interval, and reportable change threshold per attribute.

**Default reporting intervals:**

| Cluster | Attribute | Min Interval | Max Interval | Reportable Change |
|---|---|---|---|---|
| OnOff | onOff | 0 s | 3600 s | — (discrete) |
| LevelControl | currentLevel | 5 s | 3600 s | 1 |
| ColorControl | colorTemperatureMireds | 5 s | 3600 s | 1 |
| TemperatureMeasurement | measuredValue | 10 s | 3600 s | 10 (0.1°C) |
| RelativeHumidity | measuredValue | 10 s | 3600 s | 100 (1%) |
| PowerConfiguration | batteryPercentageRemaining | 3600 s | 62000 s | 0 |
| ElectricalMeasurement | activePower | 5 s | 3600 s | 10 |
| Metering | currentSummationDelivered | 5 s | 3600 s | 5 |

These defaults are overridable per device profile (§3.6) and per installation via the YAML configuration (§9). The adapter re-configures reporting when a device re-announces after a power cycle or network rejoin.

**Reporting configuration exclusions.** Devices whose profile sets `interviewSkips: ["configure_reporting"]` skip this step entirely. This applies to all Xiaomi/Aqara devices, which report on their own firmware-defined schedule (~30–60 minutes for environmental sensors) and silently reject or disconnect when they receive Configure Reporting commands.

### 3.8 Manufacturer Codec: Tuya Datapoint Protocol

Tuya devices that use cluster 0xEF00 bypass standard ZCL. The entire ZCL payload is a proprietary datapoint (DP) structure that tunnels between the Zigbee radio and an internal MCU. All Tuya 0xEF00 devices report modelID `TS0601`; differentiation is by `manufacturerName` (e.g., `_TZE200_auin8mzr`).

**DP frame parsing.** The frame structure is:

```
[Sequence Number (2B, big-endian)] [DP1] [DP2] ... [DPN]

Each DP:
[DPID (1B)] [Type (1B)] [Length (2B, big-endian)] [Value (N bytes, big-endian)]
```

DP types: RAW (0x00), BOOL (0x01, 1 byte), VALUE (0x02, 4 bytes uint32 big-endian), STRING (0x03), ENUM (0x04, 1 byte), BITMAP (0x05). A single frame can contain multiple concatenated DPs — the parser must exhaust the buffer by reading DPs until no bytes remain.

**DP-to-capability mapping.** Each Tuya device profile contains a `tuyaDatapoints` map that translates DPID/type pairs to HomeSynapse attribute values with an optional conversion function:

```java
public record TuyaDatapointMapping(
    int dpId,
    String attributeKey,           // HomeSynapse attribute key
    TuyaDpType expectedType,
    ValueConverter converter       // e.g., divideBy10, divideBy100, raw, booleanInvert
) {}
```

**Outbound DP construction.** When the adapter receives a `CommandEnvelope` targeting a Tuya entity, it reverses the mapping: looks up the command's attribute key in the profile's DP map, converts the HomeSynapse value to the DP type and value bytes, and wraps the DP in a 0xEF00 cluster-specific command (command ID 0x00, TY_DATA_REQUEST).

**Tuya-specific protocol obligations.** The adapter must respond to two Tuya-initiated requests: time synchronization (command 0x24, which requires the adapter to echo the sequence number and provide UTC and local timestamps as uint32 epoch seconds) and MCU version query (command 0x10 on join, which the adapter sends proactively as part of the Tuya interview extension). Both are handled by dedicated handlers registered on the 0xEF00 cluster.

### 3.9 Manufacturer Codec: Xiaomi/Aqara TLV

Older Xiaomi/Mijia devices report sensor data and battery voltage via a manufacturer-specific attribute 0xFF01 on the Basic cluster (0x0000), with manufacturer code 0x115F. Despite being declared as CharString in the cluster schema, the payload is a binary Tag-Type-Value structure.

**TLV parsing:**

```java
while (buffer.hasRemaining()) {
    int tag = Byte.toUnsignedInt(buffer.get());
    int zclType = Byte.toUnsignedInt(buffer.get());
    Object value = ZclTypeCodec.decode(buffer, zclType);
    tagValues.put(tag, value);
}
```

Tags use standard ZCL type IDs for the value encoding, so the parser reuses the adapter's ZCL type codec. Documented tags: 0x01 = battery voltage (Uint16, mV), 0x03 = device temperature (Int8, °C), 0x64 = primary measurement (type varies by model — temperature as Int16/100 for weather sensors, on/off as Bool for switches), 0x65 = humidity (Uint16/100), 0x66 = pressure (Int32/100, hPa), 0x95 = energy (Float, kWh), 0x96 = voltage (Float, mV), 0x97 = current (Float, mA), 0x98 = power (Float, W).

**Tag 0x64 is model-dependent.** The TLV parser requires the device's model identifier (from the Basic cluster read during interview) to correctly interpret tag 0x64. The device profile carries a `tag64Type` field specifying the interpretation.

**Newer Aqara migration.** Aqara E1/P1/T1 devices use cluster 0xFCC0, attribute 0x00F7 with the same TLV format and tag semantics. Cluster 0xFCC0 also hosts configuration attributes (0x0009 for Opple multi-click mode, 0x0200 for decoupled mode, 0x0201 for power-on behavior). All 0xFCC0 operations require manufacturer code 0x115F in the ZCL frame control.

**Battery voltage to percentage conversion.** Xiaomi devices do not use the standard PowerConfiguration cluster. The adapter extracts battery voltage from tag 0x01 and converts to a percentage using a CR2032 lookup table: 3000 mV = 100%, 2900 mV → 42%, 2740 mV → 18%, 2440 mV → 6%, 2100 mV → 0%. Linear interpolation between breakpoints. The resulting percentage is published as a `state_reported` event targeting the entity's `battery` capability.

### 3.10 Command Dispatch

When the Automation Engine or REST API issues a command targeting a Zigbee entity, the command flows through the event pipeline: `command_issued` → Command Dispatch Service (Doc 07 §3.11.1) → `command_dispatched` → Integration Runtime `CommandHandler` callback → this adapter.

**Command handling flow:**

1. The `CommandHandler.handle(CommandEnvelope)` callback is invoked on the adapter's virtual thread
2. The adapter resolves the target entity to a Zigbee address (IEEE + endpoint) via `EntityRegistry`
3. The adapter maps the HomeSynapse command to a ZCL frame using the cluster handler for the entity's capability (e.g., `on_off.turn_on` → OnOff cluster command 0x01)
4. For Tuya entities, the command is mapped to a DP frame via the Tuya DP mapping
5. The ZCL frame is sent to the device via the coordinator abstraction (`sendZclFrame()`)
6. The adapter waits for the ZCL Default Response or cluster-specific response (timeout: 10 seconds)
7. The adapter publishes a `command_result` event with `SUCCESS` or `FAILURE` status, including the ZCL status code on failure

**Command result and expectations.** For each supported command, the adapter registers expectations with the Pending Command Ledger (Doc 02 §3.8, Doc 07 §3.11.2) via the `ExpectationFactory`. The expectations define what state change confirms the command succeeded. For example, `on_off.turn_on` registers an `ExactMatch` expectation for `state = true` with a 5-second timeout. `brightness.set_brightness(128)` registers a `WithinTolerance` expectation for `brightness` within ±2 of 128 with a 5-second timeout. The tolerance values account for rounding differences between the 0–254 ZCL range and protocol-specific precision.

**Transition time handling.** LevelControl and ColorControl commands accept an optional `transition_time` parameter (in seconds, converted to ZCL's 1/10-second units). When a transition is active, the adapter adjusts the expectation timeout to `transition_time + 2 seconds` to avoid premature timeout declarations. IKEA TRÅDFRI devices require separate commands for brightness and color temperature transitions — the adapter sends them sequentially with a 50 ms delay when both are present in a single command.

### 3.11 Network Telemetry

The adapter collects per-frame and periodic network health data to satisfy INV-MN-01 (protocol-agnostic network telemetry) and INV-MN-02 (mesh health as observable state).

**Per-frame telemetry.** Every incoming ZCL frame carries signal quality metadata: RSSI (int8, dBm) from `AF_INCOMING_MSG` on ZNP or `lastHopRssi` on EZSP, and LQI (uint8, 0–255) from the same source. The adapter records the most recent RSSI and LQI per device and publishes updates as `state_reported` events targeting a synthetic `signal_quality` capability on each entity. High-frequency signal quality updates from energy monitors (reporting every 5–10 seconds) are routed through `TelemetryWriter` to avoid flooding the domain event store. The boundary criterion follows Event Model §3.5: devices reporting more than once per 10 seconds sustained use the telemetry path.

**Periodic topology scan.** The adapter performs on-demand mesh topology discovery via ZDO Mgmt_Lqi_req (cluster 0x0031). The scan uses BFS from the coordinator: query the coordinator's neighbor table, then for each discovered router, query its neighbor table. End devices are not queried (they are sleeping). Each neighbor table entry provides: IEEE address, network address, device type, relationship (parent/child/sibling), depth, and LQI.

The topology scan runs on-demand (triggered via the REST API or scheduled task) and optionally at a configurable periodic interval (default: disabled; recommended 1–4 hours if enabled). A network with 20 routers requires 20–40 ZDO messages taking 2–10 seconds. The scan results are published as an integration-namespaced event `zigbee.topology_scanned` carrying the full neighbor graph.

**Availability tracking.** The adapter maintains per-device availability state using two strategies based on power source. Mains-powered devices (routers) are checked via an active ping (read OnOff attribute) if no frame has been received within 10 minutes. Battery-powered devices (end devices) use passive tracking: if no frame is received within 25 hours (slightly more than the maximum reporting interval for battery sensors), the device is marked offline. Availability transitions produce `availability_changed` events with CRITICAL priority for transitions to offline and NORMAL priority for transitions to online.

### 3.12 IAS Zone Enrollment

IAS Zone devices (motion sensors, contact sensors, water leak detectors, smoke detectors) require a handshake before they report zone events:

1. The adapter writes its own IEEE address to the device's `IAS_CIE_Address` attribute (0x0010) on the IAS Zone cluster
2. The device sends a `ZoneEnrollRequest` command (0x01) with its zone type
3. The adapter responds with `ZoneEnrollResponse` (0x00) containing a zone ID (assigned sequentially, 0–255) and success status

Zone type determines capability mapping: 0x000D → motion, 0x0015 → contact, 0x002A → water_leak, 0x0028 → fire/smoke, 0x002D → vibration. After enrollment, the device sends `ZoneStatusChangeNotification` (command 0x00) carrying a Bitmap16 where bit 0 is Alarm1 (primary alarm), bit 1 is Alarm2, bit 2 is Tamper, and bit 3 is BatteryLow. The adapter publishes each notification as a `state_reported` event.

### 3.13 Network Formation and Security

On first run, the adapter forms a new Zigbee network. Network formation involves:

1. Energy scan across channels 11–26 to measure interference
2. Channel selection prioritizing channels 15, 20, and 25 (minimal Wi-Fi overlap with channels 1, 6, and 11)
3. Random PAN ID generation
4. AES-128 network key generation using `java.security.SecureRandom`
5. Trust Center configuration using the well-known TC link key (`ZigBeeAlliance09`, 0x5A6967426565416C6C69616E63653039)

The network key is stored encrypted at rest (INV-SE-03) via the secrets infrastructure. The PAN ID, channel, extended PAN ID, and encrypted network key are persisted in the adapter's configuration state so that the network resumes on restart without re-formation.

On subsequent starts, the adapter resumes the existing network by loading the stored network parameters and instructing the coordinator to restore the network state.

---

## 4. Data Model

### 4.1 IntegrationDescriptor

The Zigbee adapter's descriptor, declared by `ZigbeeAdapterFactory.descriptor()`:

```java
new IntegrationDescriptor(
    "zigbee",                                    // integrationType
    "Zigbee",                                    // displayName
    IoType.SERIAL,                               // ioType — platform thread for serial I/O
    Set.of(RequiredService.SCHEDULER,            // for periodic ping, availability checks
           RequiredService.TELEMETRY_WRITER),    // for high-frequency energy telemetry
    Set.of(DataPath.DOMAIN, DataPath.TELEMETRY), // dataPaths
    new HealthParameters(
        Duration.ofSeconds(600),                 // heartbeatTimeout — serial hub, conservative
        20,                                      // healthWindowSize
        Duration.ofMinutes(5),                   // maxDegradedDuration
        Duration.ofHours(1),                     // maxSuspendedDuration
        5,                                       // maxSuspensionCycles
        3,                                       // maxRestarts
        Duration.ofSeconds(60),                  // restartWindow
        Duration.ofSeconds(30),                  // probeInitialDelay
        Duration.ofMinutes(5),                   // probeMaxDelay
        3,                                       // probeCount
        2                                        // probeSuccessThreshold
    ),
    1                                            // schemaVersion
)
```

The 600-second heartbeat timeout accommodates quiet networks where no device reports for extended periods. The coordinator watchdog ping (§3.2) runs every 30 seconds on the `SchedulerService`, ensuring the adapter reports heartbeats to the supervisor even when no device traffic is flowing.

### 4.2 ZigbeeFrame

The common frame representation shared between transport and protocol layers:

```java
public sealed interface ZigbeeFrame {
    record ZnpFrame(int subsystem, int commandId, CommandType type, byte[] data) implements ZigbeeFrame {}
    record EzspFrame(int frameId, boolean isCallback, byte[] parameters) implements ZigbeeFrame {}
}
```

### 4.3 Device Profile Schema

Device profiles are stored as JSON and loaded into `DeviceProfile` records at initialization:

```json
{
  "profileId": "tuya_ts0601_temp_humidity",
  "matches": [{"manufacturer": "_TZE200_auin8mzr", "model": "TS0601"}],
  "category": "FULLY_CUSTOM",
  "manufacturerCodec": "tuya_ef00",
  "tuyaDatapoints": [
    {"dpId": 18, "attributeKey": "temperature", "type": "VALUE", "converter": "divideBy10"},
    {"dpId": 19, "attributeKey": "humidity", "type": "VALUE", "converter": "raw"},
    {"dpId": 4, "attributeKey": "battery_level", "type": "VALUE", "converter": "raw"}
  ]
}
```

```json
{
  "profileId": "aqara_weather_sensor",
  "matches": [{"manufacturer": "LUMI", "model": "lumi.weather"}],
  "category": "MIXED_CUSTOM",
  "manufacturerCodec": "xiaomi_ff01",
  "interviewSkips": ["configure_reporting"],
  "xiaomiTags": {
    "0x01": {"attributeKey": "battery_voltage_mv", "type": "Uint16"},
    "0x64": {"attributeKey": "temperature", "type": "Int16", "converter": "divideBy100"},
    "0x65": {"attributeKey": "humidity", "type": "Uint16", "converter": "divideBy100"},
    "0x66": {"attributeKey": "pressure", "type": "Int32", "converter": "divideBy100"}
  }
}
```

### 4.4 Event Payloads

Events produced by the adapter follow the Event Model's envelope schema (Doc 01 §4.1) with adapter-specific payloads:

**state_reported** — carries `entity_ref`, `attribute_key`, `value` (typed per Doc 02 §3.7), `event_time` (Zigbee frame timestamp or best approximation per INV-ES-08), and `origin` (`PHYSICAL` when the frame indicates a physical interaction, `DEVICE_AUTONOMOUS` for scheduled reports, `INTEGRATION` as fallback).

**command_result** — carries `entity_ref`, `command_type`, `status` (SUCCESS/FAILURE), `zcl_status_code` (uint8, present on failure), `round_trip_ms` (time from command send to protocol acknowledgment).

**device_discovered** — carries `hardware_identifier` (namespace=`zigbee`, value=IEEE address), `manufacturer_name`, `model_identifier`, `endpoints` (list of `{endpoint_id, profile_id, device_type_id, input_clusters, output_clusters}`), `power_source`, `interview_status` (COMPLETE/PARTIAL), `matched_profile_id` (nullable).

**availability_changed** — carries `entity_ref`, `available` (boolean), `reason` (FIRST_CONTACT, PING_SUCCESS, FRAME_RECEIVED, PING_TIMEOUT, SILENCE_TIMEOUT, LEAVE).

**zigbee.topology_scanned** (integration-namespaced) — carries `coordinator_ieee`, `channel`, `pan_id`, `neighbors` (list of `{ieee, nwk, device_type, lqi, depth, parent_ieee}`).

---

## 5. Contracts and Invariants

**Every ZCL attribute report produces exactly one `state_reported` event.** The adapter does not batch, debounce, or suppress attribute reports. Each report is an independent observation. Deduplication, if needed, is the responsibility of downstream subscribers using the event's entity sequence number (INV-ES-05).

**The adapter never produces derived events.** Consistent with Event Model §3.1 Rule T1, the adapter produces only `state_reported`, `command_result`, `availability_changed`, `device_discovered`, and `presence_signal`. It does not produce `state_changed`, `state_confirmed`, or any other derived event type. Whether an attribute report constitutes a change is the State Projection's determination.

**Hardware identifiers are stable across adapter restarts.** A device's IEEE address (64-bit) is its permanent hardware identifier. The adapter uses namespace `zigbee` with the IEEE address as the value, consistent with Identity and Addressing Model §6. Network addresses (16-bit) are transient and not used for identity. A device that rejoins the network with a new network address but the same IEEE address is recognized as the same device.

**Command dispatch is at-most-once at the protocol level.** The adapter sends each ZCL command exactly once per `CommandEnvelope`. If the coordinator does not receive a protocol-level acknowledgment within the timeout, the adapter reports `command_result` with FAILURE status. Retry logic, if desired, is the responsibility of the Automation Engine or the user. This prevents the adapter from silently retrying commands that may have been received but not acknowledged (e.g., a light that turned on but the ACK was lost).

**The transport layer never reorders frames.** Frames are processed in the order they are received from the serial port. The inbound `BlockingQueue` is a FIFO structure. No priority-based reordering occurs between transport and protocol layers.

**Network key confidentiality.** The Zigbee network key is stored encrypted at rest (INV-SE-03) and is never logged, included in event payloads, or exposed through the API. The well-known Trust Center link key is used only for initial pairing; the network key distributed during pairing is the confidential material.

**Coordinator type is an internal detail.** The choice between ZNP and EZSP transport is invisible to the rest of HomeSynapse. No event payload, configuration option, or API response exposes which coordinator firmware is in use. The coordinator is an implementation detail of this adapter, consistent with INV-CE-04 (protocol agnosticism applies within the Zigbee adapter itself, not only across protocols).

---

## 6. Failure Modes and Recovery

### 6.1 Serial Port Disconnection

**Trigger:** USB coordinator unplugged, USB hub power loss, kernel driver error.

**Impact:** All Zigbee devices become unavailable. No new attribute reports, no command dispatch.

**Recovery:** The transport layer detects the disconnection via jSerialComm's port status check or IOException on read. The adapter's health score drops (stale heartbeat, error window fills), transitioning through DEGRADED to SUSPENDED. The Integration Runtime's probe mechanism attempts to reopen the serial port on the backoff schedule. If the coordinator is reconnected, the probe succeeds, the adapter re-initializes the coordinator protocol, resumes the network, and transitions back to HEALTHY. Devices re-announce and the adapter reconciles their state.

**Events produced:** `availability_changed` (offline) for all devices. `integration_health_changed` (DEGRADED, then SUSPENDED). Structured WARN log: `zigbee.serial_disconnected` with port path.

### 6.2 Coordinator Firmware Crash

**Trigger:** Hardware fault, firmware bug, power brownout.

**Impact:** Identical to serial disconnection — the serial port may remain open but the coordinator stops responding to commands.

**Recovery:** Detected by the coordinator watchdog ping (SYS_PING for ZNP, nop() for EZSP). Three consecutive failed pings trigger a coordinator reset attempt. ZNP: the adapter closes and reopens the serial port (the CC2652 auto-resets on port reopen). EZSP: the adapter sends an ASH RST frame and waits for RSTACK. If reset succeeds, the network resumes automatically (the coordinator retains network parameters in NVM). If reset fails, the adapter transitions to FAILED and requires manual intervention (power-cycle the coordinator or restart the adapter via the REST API).

**Events produced:** Structured WARN log: `zigbee.coordinator_unresponsive`. `integration_health_changed` on state transitions.

### 6.3 Device Interview Failure

**Trigger:** Device is a sleepy end device that went to sleep before interview completed. Device firmware bug preventing descriptor responses. Radio interference during interview.

**Impact:** Single device affected. The device may appear as partially interviewed with limited capabilities.

**Recovery:** The adapter retries the interview 3 times with exponential backoff. For sleepy devices, the pending interview queue (§3.4) resumes the interview on the next wake-up frame. If all retries fail, the adapter publishes `device_discovered` with `interview_status: PARTIAL` and whatever metadata was gathered. The Device Model decides whether to adopt a partial device. The user can trigger a re-interview via the REST API.

**Events produced:** Structured DEBUG logs for each failed step. `device_discovered` with partial metadata on final failure.

### 6.4 ZCL Command Failure

**Trigger:** Device unreachable (moved out of range, battery dead), command not supported by device firmware, ZCL status error (UNSUPPORTED_ATTRIBUTE, INVALID_VALUE, etc.).

**Impact:** Single command affected. The device's state may not change as expected.

**Recovery:** The adapter publishes `command_result` with FAILURE status and the ZCL status code. The Pending Command Ledger detects the unconfirmed expectation and produces appropriate events. No automatic retry at the adapter level.

**Events produced:** `command_result` with failure details.

### 6.5 Permit-Join Timeout

**Trigger:** Permit-join enabled but no device joins within the allowed duration.

**Impact:** None — this is normal operation.

**Recovery:** Permit-join is automatically disabled after the configured timeout (maximum 254 seconds per Zigbee specification). The adapter produces a `zigbee.permit_join_changed` event with `enabled: false`.

**Events produced:** `zigbee.permit_join_changed`.

### 6.6 Network Formation Failure

**Trigger:** All channels congested. Coordinator hardware fault during formation. Corrupt stored network parameters.

**Impact:** No Zigbee network. No devices can join or communicate.

**Recovery:** The adapter retries formation on the next-best channel from the energy scan. If all channels fail, the adapter throws `PermanentIntegrationException` with a user-readable message suggesting the user check for Wi-Fi interference and coordinator hardware. If stored network parameters are corrupt, the adapter detects the failure on resume and falls back to forming a new network (existing devices will need to re-pair).

**Events produced:** Structured ERROR log: `zigbee.network_formation_failed` with channel scan results.

### 6.7 Manufacturer Codec Parse Failure

**Trigger:** Unexpected DP type in Tuya frame, unrecognized tag in Xiaomi TLV, truncated payload.

**Impact:** Single attribute report lost for the affected device. Other attributes in the same frame (for Tuya multi-DP frames) are still processed if parseable.

**Recovery:** The codec logs the parse failure at WARN level with the raw hex payload for diagnostic analysis. A `state_report_rejected` event is not produced (that is the Device Model's responsibility for validation failures). The adapter's health score is not affected by occasional parse failures — they are expected for unsupported DP IDs on new Tuya firmware.

**Events produced:** Structured WARN log: `zigbee.codec_parse_error` with device IEEE, codec type, raw payload hex.

---

## 7. Interaction with Other Subsystems

| Subsystem | Direction | Mechanism | Data | Constraints |
|---|---|---|---|---|
| Integration Runtime | Managed by | `IntegrationSupervisor` lifecycle | Lifecycle signals, health state transitions, thread allocation | IoType.SERIAL: platform thread for transport, virtual thread for protocol. 3/60s restart intensity. |
| Event Model & Event Bus | Produces via | `EventPublisher.publish()` and `publishRoot()` | `state_reported`, `command_result`, `availability_changed`, `device_discovered`, `presence_signal`, integration-namespaced telemetry events | Rule T1 enforced: no derived event types. Origin model: PHYSICAL for button presses, DEVICE_AUTONOMOUS for scheduled reports. |
| Device Model | Queries via | `EntityRegistry` (integration-scoped) | Entity records, capability schemas, hardware identifier mappings | Read-only, filtered by integration_id. Used during command dispatch and availability tracking. |
| Device Model | Triggers via | `device_discovered` events | Proposed devices with endpoints, clusters, manufacturer/model | Discovery pipeline (Doc 02 §3.12) manages adoption. Adapter does not perform deduplication. |
| State Store | Queries via | `StateQueryService` (integration-scoped) | Current entity state | Read-only. Used for LevelControl MoveToLevelWithOnOff logic (needs current on/off state). |
| Persistence Layer | Writes via | `TelemetryWriter.writeSamples()` | High-frequency numeric telemetry (energy monitoring, signal quality for frequent reporters) | Numeric values only. Boundary: > 1 sample per 10 seconds sustained per entity (Event Model §3.5). |
| Configuration System | Reads via | `ConfigurationAccess` (integration-scoped) | `integrations.zigbee:` subtree | Read-only. Schema validated at startup. |
| Automation Engine | Receives from (indirectly) | `CommandHandler` callback | `CommandEnvelope` targeting this integration's devices | Invoked on the adapter's virtual thread by the supervisor. |
| Observability | Exposes | JFR events, structured logs, health indicators | Per-device RSSI/LQI, interview duration, command round-trip, coordinator type | All via LTD-15 (JFR + structured JSON logs). |

---

## 8. Key Interfaces

### 8.1 Interfaces

| Interface | Responsibility |
|---|---|
| `ZigbeeAdapterFactory` | `IntegrationFactory` implementation. Produces `IntegrationDescriptor` and creates `ZigbeeAdapter` given an `IntegrationContext`. |
| `ZigbeeAdapter` | `IntegrationAdapter` implementation. Lifecycle: `initialize()`, `run()`, `close()`. Owns the coordinator connection and device management. |
| `CoordinatorTransport` | Abstraction over serial protocol framing. Implementations: `ZnpTransport`, `EzspAshTransport`. Methods: `open(SerialPort)`, `close()`, `sendFrame(byte[])`, `receiveFrame()` (blocking). |
| `CoordinatorProtocol` | Abstraction over Zigbee protocol operations above transport. Methods: `formNetwork(NetworkParameters)`, `resumeNetwork()`, `permitJoin(duration)`, `sendZclFrame(ZclFrame)`, `interview(ieeeAddress)`, `topologyScan()`, `ping()`. |
| `ClusterHandler` | Translates between ZCL cluster operations and HomeSynapse capabilities. Per-cluster implementations. Methods: `handleAttributeReport(endpoint, clusterId, attributes)` → `List<AttributeReport>`, `buildCommand(commandType, parameters)` → `ZclFrame`. |
| `DeviceProfileRegistry` | Manages device profile loading, lookup by manufacturer/model, and user override merging. |
| `ManufacturerCodec` | Sealed interface for manufacturer-specific codecs. Implementations: `TuyaDpCodec`, `XiaomiTlvCodec`. Methods: `decode(ZclFrame)` → `List<AttributeReport>`, `encode(commandType, parameters)` → `ZclFrame`. |
| `AvailabilityTracker` | Per-device availability state machine with power-source-aware timeout logic. |

### 8.2 Key Types

| Type | Kind | Responsibility |
|---|---|---|
| `ZigbeeFrame` | Sealed interface | Transport-level frame: `ZnpFrame` or `EzspFrame` |
| `ZclFrame` | Record | Protocol-level ZCL frame: endpoint, cluster, command/attribute, payload, manufacturer code |
| `DeviceProfile` | Record | Per-model device behavior overrides |
| `TuyaDatapointMapping` | Record | DP ID → HomeSynapse attribute mapping with conversion |
| `XiaomiTagMapping` | Record | TLV tag → attribute mapping with type and conversion |
| `NetworkParameters` | Record | Channel, PAN ID, extended PAN ID, encrypted network key reference |
| `InterviewResult` | Record | Collected device metadata: node descriptor, endpoints, simple descriptors, basic attributes |
| `AttributeReport` | Record | Normalized attribute observation: entity_ref, attribute_key, value (typed), event_time |
| `NeighborTableEntry` | Record | Topology scan result per neighbor: IEEE, NWK, device_type, relationship, LQI, depth |
| `ManufacturerModelPair` | Record | `(manufacturerName, modelIdentifier)` key for profile matching |
| `DeviceCategory` | Enum | STANDARD_ZCL, MINOR_QUIRKS, MIXED_CUSTOM, FULLY_CUSTOM |
| `ValueConverter` | Functional interface | `Object convert(Object rawValue)` — divideBy10, divideBy100, raw, booleanInvert, batteryVoltageToPercent |

---

## 9. Configuration

All configuration follows YAML 1.2 (LTD-09) with JSON Schema validation. The adapter runs correctly with zero configuration — all values have sensible defaults (INV-CE-02). Configuration lives under the `integrations.zigbee:` namespace per Integration Runtime §3.8.

```yaml
integrations:
  zigbee:
    # Serial port path. Auto-detected if omitted.
    # serial_port: /dev/ttyUSB0

    # Baud rate. Auto-detected based on coordinator type.
    # baud_rate: 115200

    # Network channel. Auto-selected via energy scan on first run.
    # channel: 15

    # Permit join default duration in seconds (max 254 per spec).
    permit_join_duration: 120

    # Coordinator watchdog ping interval.
    watchdog_interval_seconds: 30

    # Availability tracking.
    availability:
      mains_timeout_minutes: 10        # Active ping after silence
      battery_timeout_hours: 25        # Passive timeout for sleepy devices

    # Topology scan schedule. Set to 0 to disable periodic scans.
    topology_scan_interval_hours: 0

    # Reporting configuration overrides (per cluster ID, hex string keys).
    reporting_overrides:
      # Example: increase temperature reporting frequency
      # "0x0402":
      #   min_interval: 5
      #   max_interval: 1800
      #   reportable_change: 5

    # Path to user device profiles JSON (merged over bundled profiles).
    # profiles_path: /etc/homesynapse/zigbee-profiles-custom.json

    # Telemetry routing threshold. Entities reporting faster than this
    # use TelemetryWriter instead of domain events.
    telemetry_threshold_seconds: 10
```

**Configuration option details:**

| Option | Type | Default | Valid Range | Rationale |
|---|---|---|---|---|
| `serial_port` | String | auto-detect | Valid device path | Auto-detection probes `/dev/ttyUSB*` and `/dev/ttyACM*`. Explicit path avoids ambiguity with multiple USB devices. |
| `baud_rate` | Integer | auto-detect | 57600, 115200 | CC2652: 115200. CC2531: 115200. EFR32: 115200. |
| `channel` | Integer | auto-select | 11–26 | Auto-selection via energy scan on first formation. Fixed channel avoids re-pairing. |
| `permit_join_duration` | Integer | 120 | 1–254 | Zigbee spec maximum is 254 seconds. 120 is sufficient for most pairing workflows. |
| `watchdog_interval_seconds` | Integer | 30 | 10–300 | Frequent enough to detect crashes within one health window cycle. |
| `availability.mains_timeout_minutes` | Integer | 10 | 1–60 | Active ping after 10 minutes of silence. Lower values increase Zigbee traffic. |
| `availability.battery_timeout_hours` | Integer | 25 | 1–168 | Slightly above the maximum ZCL reporting interval (18 hours) plus margin for sleepy devices. |
| `topology_scan_interval_hours` | Integer | 0 (disabled) | 0–24 | Periodic scans add 2–10 seconds of ZDO traffic per scan. On-demand is sufficient for most users. |
| `telemetry_threshold_seconds` | Integer | 10 | 1–60 | Per Event Model §3.5. Entities exceeding this rate use TelemetryWriter. |

---

## 10. Performance Targets

All targets measured on Raspberry Pi 4 (4 GB RAM) as the validation floor (LTD-02). Pi 5 performance is expected to be 2–3× better.

| Metric | Target | Rationale |
|---|---|---|
| Adapter initialization time (to RUNNING state) | < 5 s (CC2652), < 10 s (EFR32) | EZSP version negotiation and ASH initialization add overhead. Must not block system startup (INV-RF-03). |
| Attribute report processing latency (serial frame → `state_reported` event persisted), p99 | < 15 ms | Includes transport framing, ZCL parsing, value normalization, and EventPublisher.publish() with SQLite WAL commit. The 15 ms budget allocates ~2 ms for parsing, ~3 ms for normalization and mapping, and ~10 ms for SQLite persistence. |
| Command dispatch latency (CommandEnvelope received → ZCL frame transmitted), p99 | < 10 ms | Excludes device response time and radio propagation. Measures only the adapter's internal processing. |
| Command round-trip (CommandEnvelope → command_result), p99 | < 500 ms | Includes radio propagation, device processing, and protocol acknowledgment. Zigbee mesh typically adds 50–200 ms per hop. 500 ms accommodates 2-hop routes. |
| Device interview duration (Device Announce → device_discovered event), p95 | < 15 s | 5 sequential ZDO/ZCL exchanges at 10 s timeout each, but typical response times are 200–500 ms. |
| Sustained event throughput | > 200 events/sec | A 50-device home produces ~4 events/sec at typical reporting intervals. 200 events/sec provides 50× headroom for burst scenarios (e.g., group commands triggering simultaneous reports). |
| Steady-state memory (50 devices, ~150 entities) | < 30 MB adapter heap | Includes device profile registry, cluster handler state, pending interview queue, and coordinator protocol state. Must leave room within the 1536 MB total JVM budget (LTD-01) for core subsystems. |
| Coordinator watchdog ping round-trip, p99 | < 100 ms | SYS_PING/nop() round-trip over USB serial is typically 1–5 ms. 100 ms provides margin for USB latency spikes. |
| Topology scan duration (20 routers) | < 15 s | 20 ZDO Mgmt_Lqi_req with typical 200–500 ms response times. Failed queries (10 s timeout) are the long tail. |

---

## 11. Observability

### 11.1 Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `hs.zigbee.frames.received` | Counter | `frame_type` (zcl_report, zcl_response, zdo, areq) | Total frames received from coordinator |
| `hs.zigbee.frames.sent` | Counter | `frame_type` (zcl_command, zdo_request, config_reporting) | Total frames sent to coordinator |
| `hs.zigbee.frames.corrupt` | Counter | — | Frames discarded due to checksum/CRC failure |
| `hs.zigbee.commands.dispatched` | Counter | `command_type`, `result` (success, failure, timeout) | Commands dispatched to devices |
| `hs.zigbee.commands.round_trip_ms` | Histogram | — | End-to-end command round-trip time |
| `hs.zigbee.interview.completed` | Counter | `status` (complete, partial, failed) | Device interviews completed |
| `hs.zigbee.interview.duration_ms` | Histogram | — | Interview duration from Device Announce to completion |
| `hs.zigbee.devices.available` | Gauge | — | Currently reachable devices |
| `hs.zigbee.devices.total` | Gauge | — | Total adopted Zigbee devices |
| `hs.zigbee.network.channel` | Gauge | — | Current operating channel |
| `hs.zigbee.codec.tuya.parsed` | Counter | — | Tuya DP frames successfully parsed |
| `hs.zigbee.codec.tuya.errors` | Counter | — | Tuya DP frame parse failures |
| `hs.zigbee.codec.xiaomi.parsed` | Counter | — | Xiaomi TLV frames successfully parsed |
| `hs.zigbee.codec.xiaomi.errors` | Counter | — | Xiaomi TLV frame parse failures |
| `hs.zigbee.transport.queue_depth` | Gauge | `direction` (inbound, outbound) | Current BlockingQueue depth |

### 11.2 Structured Logging

| Log Event | Level | Key Fields | Description |
|---|---|---|---|
| `zigbee.coordinator_connected` | INFO | `port`, `coordinator_type` (znp/ezsp), `firmware_version` | Coordinator serial connection established |
| `zigbee.network_formed` | INFO | `channel`, `pan_id`, `extended_pan_id` | New Zigbee network formed |
| `zigbee.network_resumed` | INFO | `channel`, `pan_id`, `device_count` | Existing network resumed on startup |
| `zigbee.device_joined` | INFO | `ieee_address`, `nwk_address`, `device_type` | Device sent Device Announce |
| `zigbee.interview_completed` | INFO | `ieee_address`, `manufacturer`, `model`, `endpoint_count`, `duration_ms`, `status` | Device interview finished |
| `zigbee.interview_failed` | WARN | `ieee_address`, `failed_step`, `attempt`, `error` | Interview step failed |
| `zigbee.command_sent` | DEBUG | `ieee_address`, `endpoint`, `cluster`, `command_id`, `correlation_id` | ZCL command transmitted |
| `zigbee.command_result` | DEBUG | `ieee_address`, `endpoint`, `cluster`, `status`, `round_trip_ms`, `correlation_id` | ZCL command response received |
| `zigbee.serial_disconnected` | WARN | `port`, `error` | Serial port connection lost |
| `zigbee.coordinator_unresponsive` | WARN | `consecutive_failures`, `last_success` | Watchdog ping failed |
| `zigbee.permit_join_changed` | INFO | `enabled`, `duration_seconds` | Permit-join state changed |
| `zigbee.codec_parse_error` | WARN | `ieee_address`, `codec_type`, `raw_hex`, `error` | Manufacturer codec failed to parse frame |
| `zigbee.availability_changed` | INFO | `ieee_address`, `entity_id`, `available`, `reason` | Device reachability changed |
| `zigbee.unrecognized_frame` | DEBUG | `ieee_address`, `cluster`, `command_id`, `raw_hex` | Frame received with no matching handler |

### 11.3 Health Indicator

| State | Condition |
|---|---|
| **HEALTHY** | Serial port open, coordinator responding to pings, network formed, at least one successful frame in last 60 seconds (or no devices paired) |
| **DEGRADED** | Coordinator ping latency elevated (> 1 second), or error rate in health window exceeds threshold, or serial port intermittently failing |
| **SUSPENDED** | Serial port disconnected, or coordinator not responding to pings. Probes attempt reconnection on backoff schedule. |
| **FAILED** | Restart intensity exhausted (3 restarts in 60 seconds), or `PermanentIntegrationException` thrown (wrong port, incompatible coordinator, corrupt network state). Requires manual intervention. |

---

## 12. Security Considerations

This section is included because the Zigbee adapter handles cryptographic material (network key), manages a wireless network that devices join, and exposes a trust boundary (the permit-join window).

**Network key management.** The AES-128 network key is the primary secret protecting Zigbee communication. It is generated using `java.security.SecureRandom` during initial network formation, stored encrypted at rest via the secrets infrastructure (INV-SE-03), loaded into memory only when needed for coordinator configuration, and never logged, serialized in events, or returned via the API. On coordinator replacement, the adapter migrates the network key to the new hardware. On network reset, a new key is generated.

**Permit-join exposure.** Enabling permit-join opens a 254-second window during which any device can join the network using the well-known Trust Center link key. This is a design limitation of the Zigbee protocol, not a HomeSynapse design choice. The adapter mitigates the risk by enforcing automatic timeout (no permanent permit-join), logging every permit-join activation with the requesting actor (user or automation), and producing a `zigbee.permit_join_changed` event for audit trail purposes. A future Zigbee 3.0 Install Code mechanism could restrict pairing to pre-authorized devices, but this is not implemented in MVP.

**Serial port access.** The systemd service unit (LTD-13) restricts device access to `/dev/ttyUSB0` and `/dev/ttyACM0` via `DeviceAllow`. The `homesynapse` service user has no other device access. If the coordinator is on a different device path, the user must configure it explicitly in the YAML and update the systemd unit.

**ZCL frame validation.** The adapter validates every incoming ZCL frame's structural integrity (correct frame control, valid data types, consistent lengths) before processing. Malformed frames are discarded with a structured log entry. This prevents a compromised device on the Zigbee network from injecting frames that cause parsing errors or unexpected behavior in the adapter.

**Event data scope.** The adapter does not include raw ZCL frames in domain events. Event payloads contain only the normalized, typed attribute values needed by the state pipeline. Raw protocol data is available only through structured DEBUG logging, which is disabled by default (LTD-15).

---

## 13. Testing Strategy

### 13.1 Unit Tests

**Transport layer parsing.** Each transport implementation (ZNP, EZSP/ASH) has a dedicated test suite exercising frame parsing against byte-level test vectors. ZNP: valid frames, corrupt FCS, truncated frames, SREQ/SRSP/AREQ identification. EZSP/ASH: byte destuffing, data derandomization, CRC validation, ACK/NAK generation, sequence number management, version negotiation (legacy and current format).

**ZCL type codec.** Test encoding and decoding of every ZCL data type the adapter supports: Bool, Uint8, Uint16, Uint24, Uint32, Uint48 (using Java long), Int8, Int16, Int24, Enum8, Enum16, Bitmap8, Bitmap16, Bitmap32, CharString, OctetString, IEEEAddress, Float. Edge cases: maximum values, minimum values, the 0x8000/0xFFFF invalid markers for temperature and humidity.

**Value normalization.** Test every cluster handler's attribute-to-capability conversion: temperature 0.01°C → °C, humidity 0.01% → %, illuminance log scale and direct-lux modes, battery 0.5% units → percentage, electrical measurement with multiplier/divisor application, metering with Uint48 handling.

**Manufacturer codec parsing.** Tuya DP codec: single-DP frames, multi-DP concatenated frames, each DP type (BOOL, VALUE, ENUM, BITMAP, RAW, STRING), big-endian value decoding, unknown DPID handling. Xiaomi TLV codec: each documented tag, model-dependent tag 0x64 interpretation, battery voltage-to-percentage lookup table with interpolation, partial TLV buffers, unknown tags.

**Device profile matching.** Exact manufacturer/model match, wildcard prefix match, no-match fallback to generic, user profile override precedence.

**SREQ/SRSP correlation.** CompletableFuture-based correlation with matching responses, mismatched responses, timeout behavior, concurrent in-flight requests up to the semaphore limit.

### 13.2 Integration Tests

**Full device discovery and adoption.** Simulated coordinator producing a Device Announce, followed by mock responses to all interview steps. Verify: `device_discovered` event contains correct metadata, Device Model adoption pipeline creates device and entity records, cluster binding and reporting configuration commands are sent.

**Attribute report end-to-end.** Simulated coordinator producing a ZCL attribute report (e.g., temperature 2550 = 25.50°C). Verify: the adapter publishes a `state_reported` event with `temperature = 25.50` as a QuantityValue in °C, the event carries correct entity_ref and event_time, the State Store processes the event and updates the entity's state.

**Command dispatch end-to-end.** Produce a `command_dispatched` event targeting a Zigbee light entity with `on_off.turn_on`. Verify: the adapter constructs and sends a ZCL OnOff On command (0x01), the simulated coordinator returns a Default Response with success, the adapter publishes `command_result` with SUCCESS, the Pending Command Ledger receives the expectation.

**Tuya device end-to-end.** Simulated Tuya 0xEF00 device reporting temperature via DP 18 (VALUE type, raw 225 = 22.5°C). Verify: the Tuya DP codec parses the frame, the DP-to-capability mapping produces `temperature = 22.5`, the `state_reported` event carries the correct value.

**Xiaomi device end-to-end.** Simulated Xiaomi device reporting via 0xFF01 TLV with battery (tag 0x01 = 3000 mV) and temperature (tag 0x64 = 2550). Verify: the TLV codec parses both tags, battery voltage converts to 100%, temperature converts to 25.50°C, two `state_reported` events are produced.

**Multi-endpoint device.** Simulated 3-gang switch with endpoints 1, 2, 3 each carrying OnOff server. Verify: `device_discovered` carries all three endpoints, adoption creates three entities, attribute reports on endpoint 2 target the correct entity.

### 13.3 Performance Tests

**Attribute report throughput.** Sustained 200 simulated attribute reports per second through the full pipeline (transport parse → ZCL decode → value normalize → EventPublisher.publish()). Measure p99 latency and throughput ceiling on RPi 4.

**Command dispatch throughput.** 50 concurrent command dispatches targeting different devices. Measure p99 dispatch latency (adapter internal) and verify semaphore limits are respected.

**Interview pipeline under load.** 5 simultaneous device interviews while 50 devices are producing attribute reports at typical rates. Verify interviews complete within the 60-second timeout and attribute report processing is not degraded.

**Memory under sustained operation.** 50 simulated devices producing reports at typical intervals for the equivalent of 24 hours. Measure heap usage, verify no memory growth trends, verify GC pause times remain within LTD-01 targets (< 100 ms).

### 13.4 Failure Tests

**Serial disconnection during command.** Disconnect the simulated serial port while a ZCL command is in-flight. Verify: the CompletableFuture times out, `command_result` with FAILURE is published, the adapter transitions to DEGRADED, other in-flight operations time out cleanly without deadlock.

**Coordinator reset recovery.** Simulate a coordinator crash (stop responding to pings). Verify: the watchdog detects the failure within 3 ping intervals, the adapter attempts reset, on successful reset the network resumes, device availability is reconciled.

**Interview interruption.** Disconnect the serial port mid-interview. Verify: the interview times out, the pending interview is re-queued, on serial reconnection the interview resumes.

**Corrupt frame flood.** Send 1,000 frames with invalid checksums in rapid succession. Verify: all frames are discarded, the adapter's health score is not affected (corrupt frames are a transport concern, not an application error), no memory growth from accumulated corrupt frame data.

**Tuya time sync under load.** Simulate 10 Tuya devices sending time sync requests simultaneously during a burst of attribute reports. Verify: all time sync responses are sent, attribute report processing is not blocked.

---

## 14. Future Considerations

**OTA firmware updates.** The ZCL OTA Upgrade cluster (0x0019) implements a block-transfer protocol that can update device firmware over the Zigbee mesh. A typical 200 KB firmware image requires ~3,000 50-byte blocks at ~250 ms per block, taking 13–25 minutes per device. The adapter's architecture accommodates OTA by reserving the extension point in the coordinator abstraction (`CoordinatorProtocol` can expose block-transfer methods) and the device profile registry (profiles can declare OTA image sources). OTA is deferred from MVP because: users can update firmware via zigbee2mqtt or manufacturer apps, the implementation is substantial (image repository, per-device transfer state machine, rate limiting, retry logic), and the risk of deferral is low (most devices ship with functional firmware). The `ClusterHandler` registry can accept an OTA handler without changes to the adapter's core architecture.

**Green Power proxy.** Green Power devices (endpoint 242) are battery-free devices that use energy harvesting (e.g., EnOcean switches). They require a Green Power Proxy running on the coordinator to translate their ultra-low-power frames into standard ZCL. Adding Green Power support requires a Green Power Proxy Table management component and translation between GP frames and standard cluster commands. The coordinator abstraction and cluster handler registry accommodate this without architectural changes.

**Touchlink factory reset.** Some ZLL-profile devices (older Philips Hue bulbs) require Touchlink commissioning at close proximity (~10 cm) for factory reset before pairing with a new coordinator. This requires specific ZCL inter-PAN commands that the adapter does not implement in MVP. Adding Touchlink requires a dedicated commissioning flow but does not affect the core adapter architecture.

**Color modes beyond color temperature.** The MVP supports color temperature (mireds) for ColorControl. Full color support (hue/saturation, CIE x/y, enhanced hue) requires additional cluster handler logic and corresponding HomeSynapse capability extensions. The ClusterHandler interface and device profile system support this addition without architectural changes.

**Matter bridge mode.** A future version could expose Zigbee devices as Matter-compatible endpoints via a Matter bridge, enabling HomeKit and Google Home interoperability. This would be a separate adapter that reads entity state from HomeSynapse and translates to Matter's data model. The protocol-agnostic device model (INV-CE-04) and the entity-first architecture (Doc 02 §1) make this feasible without changes to the Zigbee adapter.

---

## 15. Open Questions

1. **Should the adapter maintain a local device database independent of the Device Model registry?**
   Options: (a) The adapter maintains a lightweight cache of Zigbee-specific metadata (IEEE→NWK mapping, endpoint→cluster lists, last-seen timestamps) for protocol-level operations, separate from the Device Model's authoritative registry. (b) The adapter relies entirely on `EntityRegistry` queries for all device metadata, with no local cache.
   Needed: Performance profiling of `EntityRegistry` query frequency during sustained attribute report processing. If the adapter queries the registry on every frame to resolve IEEE→entity mapping, a local cache avoids the overhead.
   Status: **[NON-BLOCKING]** — option (a) is the recommended position based on zigbee-herdsman and zigpy precedent. Both maintain a local device database. The cache is a performance optimization and does not affect the adapter's external contracts.

2. **Should the adapter support coordinator backup and restore for seamless hardware migration?**
   Options: (a) The adapter exports coordinator state (network parameters, device table, link keys) to a JSON backup file that can be restored on a new coordinator. (b) Hardware migration requires re-pairing all devices on the new coordinator.
   Needed: Assessment of coordinator backup format compatibility between ZNP and EZSP. zigbee-herdsman supports backup/restore within the same firmware family; cross-family migration requires re-pairing.
   Status: **[NON-BLOCKING]** — the adapter's architecture supports backup/restore through the `CoordinatorProtocol` interface. Implementation can follow initial release based on user demand. Network key migration (§3.13) is the critical piece; device table migration is additive.

3. **Should illuminance values always be converted to lux, or should the adapter expose the raw log-scale value alongside the converted value?**
   Options: (a) Always convert to lux, applying the log formula for compliant devices and pass-through for devices known to report direct lux. (b) Expose both raw and converted values as separate attributes.
   Needed: Verification of which devices in the MVP target set (Sonoff, IKEA, Aqara) report log-scale vs. direct lux. The research indicates many devices report direct lux despite the ZCL spec requiring log scale.
   Status: **[NON-BLOCKING]** — option (a) with device-profile-driven mode selection is the recommended position. The device profile's `clusterOverrides` can specify `illuminance_mode: direct_lux` or `illuminance_mode: log_scale` per model.

---

## 16. Summary of Key Decisions

| Decision | Choice | Rationale | Section |
|---|---|---|---|
| Coordinator architecture | Two-layer: platform thread transport + virtual thread protocol | JNI pinning isolation per Integration Runtime §3.2 (IoType.SERIAL). ASH timing requires transport-layer ACK handling. | §3.2 |
| Transport abstraction | `CoordinatorTransport` interface with ZNP and EZSP implementations | zigbee-herdsman proves the abstraction is viable. Separating transport from protocol allows adding coordinator types without touching device handling. | §3.3 |
| Cluster-to-capability mapping | Declarative per-cluster handlers composed per device | Follows zigbee2mqtt's converter composition pattern. Translates naturally to Java sealed interfaces. Covers ~60% of devices generically. | §3.5 |
| Device profile system | JSON-based registry with bundled + user override profiles | Covers the ~40% of devices requiring non-standard handling without code changes. User profiles support new devices without adapter updates. | §3.6 |
| Manufacturer codec isolation | Separate codec subsystems for Tuya DP and Xiaomi TLV | Prevents quirk accumulation. Each codec has its own parsing, validation, and mapping pipeline. | §3.8, §3.9 |
| Command dispatch model | At-most-once with explicit command_result | No silent retries prevents duplicate physical actions (lights toggling twice). Retry responsibility delegated to automation layer. | §3.10 |
| Availability strategy | Power-source-aware: active ping for mains, passive timeout for battery | Battery devices sleep and cannot be pinged. Mains devices that stop reporting are actively checked. | §3.11 |
| Reporting configuration | Skip for Xiaomi/Aqara devices | These devices reject reporting configuration and may disconnect. Profile-based exclusion prevents silent failures. | §3.7 |
| Network key storage | Encrypted at rest via secrets infrastructure | AES-128 network key is the primary Zigbee security material. Never logged or serialized in events. INV-SE-03. | §3.13 |
| OTA firmware updates | Deferred from MVP | Substantial implementation (image repo, block transfer, state machine). Users can use zigbee2mqtt or manufacturer apps. Architecture accommodates future addition. | §14 |
| Topology scan schedule | On-demand by default, optional periodic | Periodic scans add traffic with diminishing returns. On-demand covers diagnostic use cases. | §3.11 |
| Transport auto-detection | Probe for ZNP then EZSP on startup | Eliminates coordinator type configuration. User does not need to know which firmware their dongle runs. | §3.3 |
| Interview retry strategy | 3 retries with exponential backoff, 60 s total timeout | Accommodates transient radio interference. Sleepy device queue handles end devices that sleep mid-interview. | §3.4 |
| IAS Zone enrollment | Adapter-managed zone ID assignment | IAS Zone requires the CIE address handshake before reporting. Zone type determines capability mapping. | §3.12 |
| Telemetry routing | High-frequency entities use TelemetryWriter, others use domain events | Prevents energy monitors from flooding the event store. Boundary follows Event Model §3.5 (> 1 sample per 10 seconds). | §3.11 |

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It is governed by the Design Document Template and will be reviewed during architecture review.*