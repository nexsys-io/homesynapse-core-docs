# HomeSynapse Core — Integration Runtime

**Document type:** Subsystem design
**Status:** Locked
**Subsystem:** Integration Runtime
**Dependencies:** Event Model & Event Bus (§3.1 producer boundaries, §3.5 telemetry boundary, §3.9 origin model, §4.3 event type taxonomy, §8.3 EventPublisher interface), Device Model & Capability System (§3.12 discovery pipeline, §8.1 DeviceRegistry/EntityRegistry interfaces, §8.2 HardwareIdentifier type), Persistence Layer (§3.6 telemetry ring store write path, §8.3 TelemetryWriter interface), Identity and Addressing Model (§6 hardware identifier mapping rules), Glossary v1 (§2.9 Integration, §2.7 Discovery)
**Dependents:** Zigbee Adapter (§3.2 hybrid thread architecture with IoType.SERIAL per Doc 08 §3.2, §3.3 adapter lifecycle 8-state model per Doc 08 §3.3, §3.4 OTP-style supervision per Doc 08 §3.9, §3.5 health checking mechanisms per Doc 08 §3.9, §3.7 exception classification per Doc 08 §3.10, §3.8 IntegrationContext composed API surface per Doc 08 §3.3, §4.1 IntegrationDescriptor with IoType.SERIAL and DataPath per Doc 08 §3.1, §4.4 integration lifecycle events per Doc 08 §3.3), Configuration System (integration-scoped configuration access), Automation Engine (command dispatch to integrations), REST API (§8.1 IntegrationSupervisor health interface for integration health endpoints per Doc 09 §3.2 and §7), Startup, Lifecycle & Shutdown (supervisor initialization order, shutdown sequence), Observability & Debugging (Doc 11: §11.3 composite health indicator for health aggregation per Doc 11 §7.1, §11.1 per-integration metrics for JFR event emission per Doc 11 §7.2, §11.2 structured logging per Doc 11 §7.3), WebSocket API (§8.1 IntegrationSupervisor health interface for health status streaming per Doc 10 §7)
**Author:** HomeSynapse Core Architecture
**Date:** 2026-03-06

---

## 0. Purpose

The Integration Runtime is the supervisory subsystem that loads, isolates, monitors, and lifecycle-manages every integration adapter within the HomeSynapse process. It is the boundary between protocol-specific code (Zigbee coordinators, MQTT brokers, cloud APIs) and the event-sourced core. Without this subsystem, a misbehaving integration could starve the event bus of CPU, leak memory until the JVM crashes, or block system startup indefinitely — the exact failure modes that Home Assistant users experience when a single integration degrades the entire platform.

This subsystem solves three problems simultaneously. First, it provides fault isolation within a single JVM process: an integration that crashes, hangs, or consumes excessive resources is contained and restarted without affecting the core or other integrations (INV-RF-01). Second, it defines the typed API surface through which integrations interact with HomeSynapse — a narrow set of interfaces that replaces the "god object" pattern where integrations receive a reference to the entire system (the anti-pattern behind Home Assistant's `hass` object). Third, it manages the thread architecture required by the hardware reality that serial I/O via JNI pins virtual thread carrier threads, while network I/O does not.

The design draws on cross-platform research across Home Assistant (integration lifecycle, `async_setup_entry`/`async_unload_entry`, `DataUpdateCoordinator`), OpenHAB (OSGi bundle lifecycle, binding Thing handler model), SmartThings Edge (Lua sandbox, capability-scoped API), Hubitat (Groovy class-whitelist sandbox), and Erlang/OTP (supervision tree model, restart intensity semantics). It also incorporates engineering research into Java 21 virtual thread behavior — specifically JEP 444's carrier thread unmounting for `java.net.Socket` operations and the permanent pinning behavior of JNI native methods that affects jSerialComm-based serial adapters.

---

## 1. Design Principles

**P1 — The API boundary is the investment; the isolation mechanism is swappable.** The Integration API — the set of interfaces an adapter receives at construction — is the stable contract that integration authors build against. Whether that API is backed by in-process method dispatch (MVP), IPC over Unix domain sockets, or gRPC to a sidecar process is an implementation detail invisible to the adapter. This principle derives from INV-RF-01 (integration isolation boundary is an implementation detail, not an API contract) and LTD-16 (in-process compiled modules with virtual-thread supervision).

**P2 — Supervisors restart; adapters connect.** An integration module must initialize successfully (register its identity, declare its capabilities, allocate its resources) even when its external device is unreachable. Connection to the external device is a separate concern handled by the adapter's internal reconnection logic. The supervisor manages the module lifecycle; the adapter manages the protocol connection. This principle derives from INV-RF-03 (startup independence) and directly addresses Home Assistant's fatal-error-on-boot anti-pattern.

**P3 — Health is a first-class observable state, not a log message.** Every integration maintains a health state (HEALTHY, DEGRADED, SUSPENDED, FAILED) that is tracked by the supervisor, recorded as events, and visible in the dashboard. The system never silently tolerates degradation. This principle derives from INV-TO-01 (observable behavior) and INV-RF-06 (graceful degradation under partial failure).

**P4 — No god object.** Integrations receive a composed set of narrow, typed interfaces — each exposing the minimum surface needed for a specific concern. An integration cannot access another integration's entities, cannot read global configuration, and cannot call core-internal methods. This principle derives from INV-CS-04 (integration API stability) and LTD-17 (build-enforced API boundaries).

**P5 — Thread architecture follows I/O physics.** Serial I/O via JNI pins the carrier thread; network I/O via `java.net.Socket` releases it. The runtime selects platform threads or virtual threads based on the adapter's declared I/O type. Correctness depends on this distinction. This principle derives from LTD-01 (Java 21 virtual threads).

---

## 2. Scope and Boundaries

### 2.1 This Subsystem Owns

- Integration discovery via ServiceLoader and the `IntegrationFactory` / `IntegrationDescriptor` contract
- Thread allocation for integration adapters: platform threads for serial/JNI I/O, virtual threads for network I/O
- The `IntegrationSupervisor` component: one-for-one restart strategy, restart intensity tracking, health state machine management
- The four-state health model (HEALTHY → DEGRADED → SUSPENDED → FAILED) with transition thresholds and the weighted health score algorithm
- Health checking: protocol-level keepalive delegation, application-level heartbeat monitoring, JFR pinning event detection
- The `IntegrationContext` — the composed API surface injected into each adapter at construction
- Exception classification at the integration→core boundary (transient vs permanent)
- Shutdown orchestration for integration adapters: interrupt-based for virtual threads, resource-close-based for platform threads
- Integration-scoped `ManagedHttpClient` instances for cloud-connected adapters
- Routing of high-frequency telemetry samples to the `TelemetryWriter` interface (**Persistence Layer** §8.3)
- Integration-scoped event production enforcement: adapters produce only the event types permitted by **Event Model & Event Bus** §3.1 producer boundaries

### 2.2 This Subsystem Does Not Own

- Protocol-specific communication logic — owned by individual adapters (Zigbee Adapter, MQTT Adapter, etc.)
- Device and entity record creation and management — owned by **Device Model & Capability System** (§3.12 discovery pipeline). This subsystem routes discovery events from adapters; the Device Model validates and persists them.
- Event persistence and delivery mechanics — owned by **Event Model & Event Bus** (§3.4, §4.2). Adapters publish via `EventPublisher`; this subsystem does not intercept or transform events.
- State materialization and query — owned by **State Store & State Projection** (§3). This subsystem provides a read-only `StateQueryService` to adapters; the State Store owns the data.
- Telemetry ring store schema and aggregation engine — owned by **Persistence Layer** (§3.6, §3.7). This subsystem routes samples to the write interface.
- Integration-specific configuration schema — owned by each integration module and validated by the **Configuration System** (doc 06). This subsystem provides the `ConfigurationAccess` interface for retrieving validated configuration.
- System startup sequencing — owned by **Startup, Lifecycle & Shutdown** (doc 12). This subsystem exposes a lifecycle interface; doc 12 determines when to call it.
- Global resource budgets (heap sizing, carrier thread pool sizing) — these are JVM-level concerns configured at deployment time per LTD-01. This subsystem operates within those budgets, not controls them.

---

## 3. Architecture

### 3.1 Structural Overview

The Integration Runtime sits between protocol-specific adapters and the HomeSynapse core. It provides a supervisory layer that manages adapter lifecycle and a typed API surface that mediates all adapter-to-core interactions.

```
┌─────────────────────────────────────────────────────────────────────┐
│                      HomeSynapse Core Process                       │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                   Integration Runtime                         │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │              IntegrationSupervisor                      │  │  │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐             │  │  │
│  │  │  │ Health   │  │ Restart  │  │ Shutdown │             │  │  │
│  │  │  │ Monitor  │  │ Tracker  │  │ Manager  │             │  │  │
│  │  │  └──────────┘  └──────────┘  └──────────┘             │  │  │
│  │  └──────────┬──────────────────────────┬──────────────────┘  │  │
│  │             │                          │                      │  │
│  │  ┌──────────▼──────────┐  ┌───────────▼─────────────────┐   │  │
│  │  │ Platform Thread     │  │ Virtual Thread Pool          │   │  │
│  │  │ (Serial I/O)        │  │ (Network I/O)               │   │  │
│  │  │                     │  │                              │   │  │
│  │  │  ┌───────────────┐  │  │  ┌──────────┐ ┌──────────┐  │   │  │
│  │  │  │ Zigbee Serial │  │  │  │ MQTT     │ │ Hue Cloud│  │   │  │
│  │  │  │ Reader        │  │  │  │ Adapter  │ │ Adapter  │  │   │  │
│  │  │  └───────┬───────┘  │  │  └──────────┘ └──────────┘  │   │  │
│  │  │          │          │  │                              │   │  │
│  │  │  BlockingQueue      │  │                              │   │  │
│  │  │          │          │  │                              │   │  │
│  │  │  ┌───────▼───────┐  │  │                              │   │  │
│  │  │  │ Zigbee Event  │  │  │                              │   │  │
│  │  │  │ Processor(VT) │  │  │                              │   │  │
│  │  │  └───────────────┘  │  │                              │   │  │
│  │  └─────────────────────┘  └──────────────────────────────┘   │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │              IntegrationContext (per adapter)            │  │  │
│  │  │  EventPublisher │ EntityRegistry │ StateQueryService     │  │  │
│  │  │  ConfigAccess   │ SchedulerSvc   │ HealthReporter        │  │  │
│  │  │  ManagedHttpClient (optional)    │ TelemetryWriter       │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Event Bus│  │ State    │  │ Device   │  │ Persistence      │   │
│  │          │  │ Store    │  │ Model    │  │ Layer            │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Hybrid Thread Architecture

The thread model is dictated by a fundamental behavioral divergence in Java 21's virtual thread implementation (JEP 444, LTD-01).

**Network I/O releases the carrier thread.** JEP 444 reimplemented `java.net.Socket`, `ServerSocket`, and `DatagramSocket` so that virtual threads unmount from their carrier thread when blocked on I/O. A virtual thread waiting on `socket.getInputStream().read()` consumes only its heap-stored continuation (~1–2 KB) and zero carrier thread capacity. This covers MQTT over TCP, WebSocket connections, HTTP polling, and all cloud API communication.

**Serial I/O via JNI pins the carrier thread permanently.** jSerialComm uses JNI native calls for `readBytes()`, `writeBytes()`, `openPort()`, and `closePort()`. JEP 444 specifies that a virtual thread executing a native method or foreign function pins its carrier thread for the entire duration of the call. jSerialComm's `SerialPort.java` (verified against v2.10.4) also contains synchronized blocks that cause additional pinning on Java 21. On a Raspberry Pi 5 with 4 CPU cores, the default `ForkJoinPool` provides approximately 4 carrier threads. One pinned carrier is a 25% capacity reduction for all other virtual threads in the system.

**The hybrid model isolates the pinning.** Serial I/O runs on a dedicated platform thread that reads from the serial port and feeds inbound data to a `BlockingQueue`. A separate virtual thread drains the queue and processes events through the normal adapter pipeline. This confines the pinning to a single dedicated thread that does not participate in the virtual thread carrier pool.

| I/O category | Thread type | Carrier impact | Shutdown mechanism |
|---|---|---|---|
| Serial port (jSerialComm) | Platform thread | Not applicable — dedicated thread | `serialPort.closePort()` from supervisor |
| TCP socket (MQTT, HTTP) | Virtual thread | Released on block | `Thread.interrupt()` — closes socket, throws `SocketException` |
| WebSocket | Virtual thread | Released on block | `Thread.interrupt()` — closes socket, throws `SocketException` |
| `BlockingQueue.take()` | Virtual thread | Released on block | `Thread.interrupt()` — throws `InterruptedException` |

The supervisor determines thread allocation from the `IntegrationDescriptor.ioType()` field declared by each integration at registration time. An adapter that declares `IoType.NETWORK` but performs JNI calls is detected by JFR `jdk.VirtualThreadPinned` events and flagged in health monitoring (§11).

Compute-intensive adapters (heavy JSON parsing, cryptographic operations) are not a separate I/O category — they run on virtual threads like network adapters. CPU-intensive behavior is detected by JFR `jdk.ThreadCPULoad` events attributed by thread name (§3.5 mechanism 3) and reflected in the `resourceComplianceScore` component of the health score.

### 3.3 Adapter Lifecycle

Every integration adapter passes through a defined lifecycle managed by the `IntegrationSupervisor`. The lifecycle has eight states organized in three phases.

**Discovery phase:**

```
DISCOVERED ──▶ LOADING
```

The ServiceLoader discovers `IntegrationFactory` implementations via JPMS `provides`/`uses` (LTD-16, L12). Each factory produces an `IntegrationDescriptor` containing the integration's identity, I/O type, required services, health parameters, and capability declarations. Discovery is synchronous at startup; all factories are enumerated before any adapter is loaded.

**Operational phase:**

```
LOADING ──▶ INITIALIZING ──▶ RUNNING ──▶ STOPPING
```

LOADING: The supervisor allocates the adapter's thread (platform or virtual per §3.2), constructs the `IntegrationContext` (§3.8), and invokes the `IntegrationFactory.create(IntegrationContext)` method. The factory returns an `IntegrationAdapter` instance. If the factory throws, the supervisor classifies the exception (§3.7) and transitions to FAILED or retries.

INITIALIZING: The supervisor calls `IntegrationAdapter.initialize()`. This method must complete within a configurable timeout (default: 30 seconds). Initialization must succeed independently of external device connectivity (P2, INV-RF-03). The adapter registers its identity, declares the devices it manages, and sets up internal data structures. It does not block on serial port open or network connection. If initialization throws, the exception is classified and the adapter transitions to FAILED (permanent) or back to LOADING (transient, with backoff). If initialization times out, the supervisor treats it as a transient failure.

RUNNING: The adapter's main loop executes on its allocated thread. For network adapters, this is a virtual thread running the event loop. For serial adapters, the platform thread reader and the virtual thread processor both run concurrently. The supervisor monitors the adapter via the health mechanisms described in §3.5. The adapter publishes events via `EventPublisher`, receives commands via an event subscription, and reports health via `HealthReporter`.

STOPPING: Initiated by the supervisor during shutdown, health-triggered suspension, or restart. The supervisor signals the adapter to stop — via `Thread.interrupt()` for virtual threads, or `serialPort.closePort()` for serial threads (L3). The adapter's `close()` method is called to release resources. A configurable grace period (default: 10 seconds) allows the adapter to complete in-flight operations before forced termination.

**Supervisory phase:**

```
           ┌────────────────────────────────────────────────┐
           │                                                │
           ▼                                                │
RUNNING ──▶ DEGRADED ──▶ SUSPENDED ──▶ FAILED             │
           │    ▲          │    ▲                           │
           │    │          │    │                           │
           └────┘          └────┘                           │
         recovery        probe success                      │
                                                            │
FAILED ──▶ LOADING  (manual restart only) ─────────────────┘
```

Transitions between RUNNING, DEGRADED, SUSPENDED, and FAILED are governed by the health state machine (§3.4). The supervisor manages all transitions; adapters do not self-transition except by reporting health signals via `HealthReporter`.

### 3.4 Supervisor Health State Machine

The `IntegrationSupervisor` owns a health state machine per integration. The state machine drives the four-state health model (L5) using a weighted health score and specific transition guards.

**Health score calculation:**

```
healthScore = 0.30 × (1 - errorRate)
            + 0.20 × (1 - timeoutRate)
            + 0.15 × (1 - slowCallRate)
            + 0.20 × dataFreshnessScore
            + 0.15 × resourceComplianceScore
```

Where:
- `errorRate` = exceptions in the last 20 calls / 20
- `timeoutRate` = timeouts in the last 20 calls / 20
- `slowCallRate` = calls exceeding 2× expected duration in the last 20 calls / 20
- `dataFreshnessScore` = 1.0 if last heartbeat is within threshold, decaying linearly to 0.0 at 3× threshold
- `resourceComplianceScore` = 1.0 if within all quotas; 0.5 if within 80–100% of any quota; 0.0 if any quota exceeded

The sliding window of 20 calls provides stability against individual outliers while remaining responsive to genuine degradation patterns. The window size is configurable per integration via `IntegrationDescriptor.healthWindowSize()`.

**Scope of the health model.** The four-state health model operates at the integration level — the entire adapter is HEALTHY, DEGRADED, SUSPENDED, or FAILED. Device-level health (individual device availability) is modeled by `availability_changed` events and tracked by the Device Model (Doc 02). Capability-level health (e.g., a Zigbee adapter can discover but not command) is not modeled by this subsystem. If Doc 08 (Zigbee Adapter) identifies the need for per-capability health signals, the `HealthReporter` interface can be extended with a `reportCapabilityDegraded(String capabilityId, String reason)` method. This is tracked as a dependency for OQ-4.

**State transitions:**

| From | To | Guard | Action |
|---|---|---|---|
| HEALTHY | DEGRADED | (`healthScore < 0.80` for 3 consecutive evaluations) OR 3 consecutive timeouts | Produce `integration_health_changed` event (NORMAL priority). Increase monitoring frequency to 2× baseline. |
| DEGRADED | HEALTHY | `healthScore > 0.80` for 20 consecutive evaluations AND zero timeouts in last 10 evaluations | Produce `integration_health_changed` event. Restore baseline monitoring frequency. |
| DEGRADED | SUSPENDED | `healthScore < 0.40` OR 5 consecutive failures OR time in DEGRADED exceeds `maxDegradedDuration` (default: 5 minutes) | Produce `integration_health_changed` event (CRITICAL priority). Stop the adapter. Begin exponential backoff probe cycle. |
| SUSPENDED | DEGRADED | Probe cycle: 3 probes at backoff intervals (30s initial, 5m max), ≥ 2 succeed | Produce `integration_health_changed` event. Restart adapter in DEGRADED state with elevated monitoring. |
| SUSPENDED | FAILED | 5 consecutive suspension cycles without reaching DEGRADED, OR total SUSPENDED time exceeds `maxSuspendedDuration` (default: 1 hour), OR adapter reports permanent failure | Produce `integration_health_changed` event (CRITICAL priority). Unload adapter. Require manual restart. |
| FAILED | LOADING | Manual restart via REST API or configuration reload | Produce `integration_restarted` event. Reset all health counters. |

**Flapping prevention.** The 3-consecutive-evaluation requirement on the HEALTHY→DEGRADED transition and the 20-consecutive-evaluation requirement on the DEGRADED→HEALTHY transition create asymmetric hysteresis. A transient score dip below 0.80 for one or two evaluation cycles does not trigger degradation. Once degraded, recovery requires sustained stability. This prevents rapid state oscillation when the health score hovers near the 0.80 boundary.

**Restart intensity tracking (L4):**

The supervisor maintains a restart counter per integration using a sliding window: a `ConcurrentLinkedDeque<Instant>` of restart timestamps. Before each restart, the supervisor counts entries within the `restartWindow` (default: 60 seconds). If the count equals `maxRestarts` (default: 3), the supervisor transitions the integration to FAILED instead of restarting. This implements Erlang/OTP's `intensity`/`period` model with a one-for-one strategy — only the failed integration is affected; all other integrations continue operating.

**Exponential backoff between restarts:**

When a restart is permitted, the supervisor waits `min(200ms × 2^consecutiveFailures, 30_000ms)` before starting the adapter, producing a backoff sequence of 200ms, 400ms, 800ms, 1.6s, 3.2s, 6.4s, 12.8s, 25.6s, 30s (cap). The consecutive failure counter resets to zero when the adapter remains in RUNNING state for longer than `stableUptimeThreshold` (default: 5 seconds of stable operation). This prevents the backoff from escalating during brief transient failures while maintaining protection against rapid crash loops.

### 3.5 Health Checking

Health checking uses three complementary mechanisms (L6), each addressing a different failure mode.

**Mechanism 1: Protocol-level keepalives.** The adapter is responsible for configuring and monitoring protocol-level heartbeats appropriate to its protocol: MQTT `PINGREQ`/`PINGRESP` with configurable keep-alive intervals, WebSocket ping/pong frames, Zigbee link-quality indicators and periodic neighbor table updates. The adapter reports keepalive status to the supervisor via `HealthReporter.reportKeepalive(Instant lastSuccess)`. Protocol-level keepalives verify end-to-end connectivity without requiring application-level probes.

**Mechanism 2: Application-level heartbeat.** Each adapter updates a heartbeat timestamp on every iteration of its main loop — including iterations where no data arrived (after a read timeout or poll cycle completes with no new messages). The supervisor stores these timestamps in a `ConcurrentHashMap<IntegrationId, Instant>` and scans on a configurable interval (default: 30 seconds). An adapter whose heartbeat exceeds its declared threshold is flagged as unresponsive.

Heartbeat thresholds are per-integration-type, declared in `IntegrationDescriptor.heartbeatTimeout()`:
- Serial/hub coordinators (Zigbee): 600 seconds. Hub-style coordinators may receive no traffic during quiet periods. A 10-minute threshold avoids false alarms.
- Network polling integrations: 3× the declared poll interval. A poller with a 30-second interval has a 90-second heartbeat threshold.
- Event-driven/streaming integrations (MQTT, WebSocket): 120 seconds. Streaming protocols should produce keepalive events even during quiet periods.

**Mechanism 3: JFR event streaming.** A dedicated virtual thread runs a `RecordingStream` monitoring three JFR event types:
- `jdk.VirtualThreadPinned` (threshold: 20ms): Detects carrier thread pinning. Sustained pinning from an adapter declared as `IoType.NETWORK` indicates a developer error — the adapter is performing JNI or entering `synchronized` blocks. The health monitor increments the `resourceComplianceScore` penalty.
- `jdk.VirtualThreadSubmitFailed`: Detects carrier thread pool exhaustion. This is a system-level alarm indicating that pinning or thread count is starving the scheduler.
- `jdk.ThreadCPULoad` attributed by thread name: Detects CPU-intensive integrations. Thread names follow the convention `hs-{integration_type}-{n}` (e.g., `hs-zigbee-0`, `hs-mqtt-1`), enabling per-integration attribution (LTD-15).

### 3.6 Shutdown Orchestration

Shutdown proceeds in two phases with distinct mechanisms per thread type (L3).

**Phase 1: Graceful stop.** The supervisor signals each adapter to stop. For virtual thread adapters, `Thread.interrupt()` unparks the thread and closes the underlying socket (JEP 444 behavioral divergence on virtual threads), causing the blocked `read()` to throw `SocketException`. For platform thread serial adapters, the supervisor calls `serialPort.closePort()` from the supervisor thread, causing the blocked `readBytes()` to return. In both cases, the adapter's `close()` method is called to release resources.

**Phase 2: Forced termination.** If an adapter does not exit within the grace period (default: 10 seconds, configurable per integration), the supervisor logs a warning, abandons the thread, and proceeds. On a clean JVM shutdown, abandoned threads are terminated by the JVM. The grace period is intentionally generous to allow adapters to flush in-flight data and close protocol-level connections cleanly.

Shutdown order is the reverse of startup order. Adapters that were loaded last are stopped first. This ensures that bridge adapters (which may host other adapters' devices) stop after their dependents.

### 3.7 Exception Classification at the Module Boundary

Every exception that escapes an adapter's main loop or lifecycle method is intercepted by the supervisor and classified before any restart or state transition decision (L10).

**Classification rules:**

| Exception type | Classification | Supervisor action |
|---|---|---|
| `IOException`, `SocketException`, `SocketTimeoutException` | Transient | Restart with backoff. These indicate network or serial connectivity loss. |
| `InterruptedException` | Shutdown signal | Do not restart. The supervisor initiated the stop. |
| `ClosedByInterruptException` | Shutdown signal | Do not restart. NIO-layer manifestation of interrupt on virtual thread socket I/O. |
| `ConfigurationException` (integration-defined) | Permanent | Transition to FAILED. Configuration must be corrected before retry. |
| `AuthenticationException` (integration-defined) | Permanent | Transition to FAILED. Credentials must be updated. |
| `UnsupportedOperationException` | Permanent | Transition to FAILED. Adapter incompatible with current environment. |
| `OutOfMemoryError` | Permanent | Transition to FAILED. Log at CRITICAL. Produce `integration_resource_exceeded` event. |
| All other `RuntimeException` | Transient (default) | Restart with backoff. Unknown exceptions default to transient to avoid permanent failure on recoverable bugs. |
| All other `Error` | Permanent | Transition to FAILED. `Error` subclasses (other than `OutOfMemoryError`) indicate JVM-level problems. |

**Shutdown-aware classification.** During an active shutdown sequence, the supervisor sets a per-integration `shuttingDown` flag before signaling the adapter. When this flag is set, `SocketException` and `IOException` are reclassified as shutdown signals rather than transient failures. This prevents the supervisor from attempting a restart when the exception was caused by the shutdown signal itself.

The default-to-transient policy for unknown `RuntimeException` prevents the scenario observed in Home Assistant where an unexpected exception type causes permanent integration death with no automatic recovery. If a transient-classified exception recurs rapidly, the restart intensity limit (§3.4) escalates to FAILED after 3 restarts in 60 seconds — providing the same protection as permanent classification, but with an automatic recovery attempt first.

Adapters may throw `PermanentIntegrationException` (a subclass provided by the Integration API) to explicitly signal a permanent failure with a user-readable message. The supervisor attaches this message to the `integration_health_changed` event and surfaces it through the REST API and dashboard (INV-HO-04).

### 3.8 IntegrationContext — The Typed API Surface

Each adapter receives an `IntegrationContext` at construction. This context is a composed object containing narrow, typed interfaces — each scoped to the minimum access the adapter needs (P4, L11, LTD-17). The context is the complete API surface available to the adapter; no other entry point into the core exists.

**Context composition:**

| Interface | Scope | Purpose |
|---|---|---|
| `EventPublisher` | Write-only | Publish events to the domain event store. Two methods: `publish(DomainEvent, CausalContext)` and `publishRoot(DomainEvent, @Nullable ULID actorRef)`. Adapters may only produce event types permitted by **Event Model & Event Bus** §3.1: `state_reported`, `command_result`, `availability_changed`, `device_discovered`, `presence_signal`. |
| `EntityRegistry` | Read-only, integration-scoped | Query entity records owned by this integration. Returns only records where `integration_id` matches the adapter's identity. Cannot access other integrations' entities. During discovery, the adapter produces `device_discovered` events; hardware identifier deduplication is performed by the Device Model's discovery pipeline (Doc 02 §3.12), not by the adapter. The adapter does not need `DeviceRegistry` access because it never performs dedup lookups directly. |
| `StateQueryService` | Read-only, integration-scoped | Query current state for entities owned by this integration. Backed by the **State Store** in-memory view. Scoped identically to `EntityRegistry`. |
| `ConfigurationAccess` | Read-only, integration-scoped | Retrieve validated configuration for this integration. Returns only the subtree under `integrations.{integration_type}:` in the YAML configuration. Cannot access global or other-integration configuration. |
| `SchedulerService` | Integration-scoped | Schedule periodic tasks (polling loops, retry timers, keepalive checks). Executes callbacks on the integration's virtual thread group. Replaces ad-hoc `Timer`/`ScheduledExecutorService` usage. |
| `CommandHandler` | Integration-scoped, callback | Receives `command_dispatched` events targeting this integration's devices. The supervisor subscribes to `command_dispatched` on the adapter's behalf, filtered by `integration_id`, and invokes the adapter's registered `CommandHandler.handle(CommandEnvelope)` callback on the adapter's thread. The adapter processes the command and produces a `command_result` event via `EventPublisher`. |
| `HealthReporter` | Integration-scoped | Report health signals to the supervisor: heartbeat updates, keepalive status, self-assessed health transitions, error counts. The adapter calls `reportHeartbeat()` on every loop iteration and `reportError(Throwable)` on handled exceptions. |
| `TelemetryWriter` | Write-only | Route high-frequency numeric samples to the telemetry ring store (**Persistence Layer** §3.6, §8.3). Only available to integrations that declare `DataPath.TELEMETRY` in their descriptor. |
| `ManagedHttpClient` | Integration-scoped, optional | A `java.net.http.HttpClient` wrapper with concurrency limits and rate limiting (L8). Provided only to integrations that declare `RequiredService.HTTP_CLIENT` in their descriptor. Each integration receives its own instance with isolated connection pool, configurable timeouts, and lifecycle tied to the adapter. |

**Scoping enforcement:** The `EntityRegistry` and `StateQueryService` implementations filter by `integration_id` at the query level. The adapter never receives a reference to the full registry or state store. Build-time enforcement (Gradle module dependencies, ArchUnit tests) prevents integration modules from importing `core.internal` packages. Runtime enforcement (JPMS module boundaries) prevents reflective access to unexported core packages (L7).

**What the context does not provide:** Direct access to the Event Bus subscription model. Command delivery is handled by the supervisor via the `CommandHandler` callback — the adapter does not subscribe to the event bus directly.

### 3.9 Managed HTTP Client

Cloud-connected integrations (Hue Bridge, Tuya, weather services) require HTTP access to external APIs. Each such integration receives its own `ManagedHttpClient` instance (L8) wrapping Java 21's `java.net.http.HttpClient`.

**Per-integration isolation rationale:** A shared HTTP client pool creates noisy-neighbor risk — one integration's slow responses block another's pool slots. Per-integration clients provide isolation (separate connection pools, separate timeout configuration), clean lifecycle (close the client when the integration unloads), and trivial metrics attribution.

**Resource controls:**

| Parameter | Default | Configurable | Purpose |
|---|---|---|---|
| `maxConcurrentRequests` | 10 | Per integration | Semaphore-guarded. Prevents a single integration from exhausting system-level connection capacity. |
| `requestsPerMinute` | 120 | Per integration | Token-bucket rate limiter. Protects external APIs from excessive polling. |
| `connectTimeout` | 10 seconds | Per integration | Maximum time to establish a connection. |
| `requestTimeout` | 30 seconds | Per integration | Maximum time for complete request/response cycle. |
| `idleConnectionTimeout` | 60 seconds | Global | Connections idle longer than this are closed. Reduces memory pressure. |

**Memory budget:** Each `HttpClient` instance consumes approximately 2–5 MB including its selector thread and connection pool. At 20 cloud integrations, the total is 40–100 MB — within the 1.5 GB heap budget (INV-PR-03). The `ManagedHttpClient.close()` method calls `HttpClient.close()` (Java 21 `AutoCloseable` support), releasing all connections and selector threads.

**Virtual thread executor:** Each `HttpClient` is constructed with `.executor(Executors.newVirtualThreadPerTaskExecutor())`, enabling massive I/O concurrency without thread overhead. Request/response processing unmounts from the carrier thread during socket I/O, matching the platform's virtual thread model.

### 3.10 Integration Discovery via ServiceLoader

Integration modules are discovered using JPMS `ServiceLoader` (L12, LTD-16). The discovery mechanism requires no classpath scanning, no reflection beyond `ServiceLoader`, and no annotation processing at runtime.

**Module declarations:**

The core module declares the service interface:
```java
// module-info.java for com.homesynapse.api
module com.homesynapse.api {
    exports com.homesynapse.api;
    exports com.homesynapse.api.integration;
}

// module-info.java for com.homesynapse.core
module com.homesynapse.core {
    requires com.homesynapse.api;
    uses com.homesynapse.api.integration.IntegrationFactory;
    // does NOT export internal packages
}
```

Each integration module provides the service:
```java
// module-info.java for com.homesynapse.integration.zigbee
module com.homesynapse.integration.zigbee {
    requires com.homesynapse.api;
    provides com.homesynapse.api.integration.IntegrationFactory
        with com.homesynapse.integration.zigbee.ZigbeeIntegrationFactory;
}
```

At startup, the runtime calls `ServiceLoader.load(IntegrationFactory.class)` to discover all available factories. Each factory produces an `IntegrationDescriptor` that declares the integration's requirements. The supervisor then proceeds through the lifecycle (§3.3) for each discovered integration that is enabled in configuration.

**Three-layer enforcement (L7):**

Layer 1 — Gradle module graph (compile-time): Integration modules declare `implementation project(':homesynapse-api')` and nothing else from the core. `modules-graph-assert` plugin rejects forbidden dependency directions at build time.

Layer 2 — ArchUnit tests (CI-time): Rules verify that no class in an `integration.*` package imports from `core.internal.*`, `persistence.*`, or `statestore.*` packages.

Layer 3 — JPMS `module-info.java` (runtime): The `com.homesynapse.core` module does not export its internal packages. Any attempt by integration code to access non-exported classes throws `IllegalAccessError`. `setAccessible(true)` fails for module-internal classes. If full JPMS modularization is not achieved for the MVP (due to automatic modules in third-party dependencies), Layers 1 and 2 provide the baseline enforcement guarantee. JPMS is the target mechanism per LTD-17's specification ("compile-time enforcement if full modularization is achieved").

### 3.11 Event Production Enforcement

Adapters produce events via `EventPublisher.publish()` and `EventPublisher.publishRoot()` (**Event Model & Event Bus** §8.3). The Integration Runtime enforces the producer boundary rules from **Event Model & Event Bus** §3.1:

**Permitted event types for integration adapters:**
- `state_reported` — raw observations from the device
- `command_result` — outcome of a command dispatched to the device
- `availability_changed` — device online/offline transitions
- `device_discovered` — new device detected on the protocol network
- `presence_signal` — presence detection observations

**Prohibited event types:** `state_changed` (sole producer: State Projection), `command_issued` (sole producer: API/Automation), `command_dispatched` (sole producer: Command Dispatcher). Attempting to produce a prohibited event type results in an `IllegalEventTypeException` logged as a developer error.

**Origin model enforcement:** Integration-produced events carry `EventOrigin.INTEGRATION` unless the adapter has protocol-level evidence of a different origin. The Zigbee adapter may set `EventOrigin.PHYSICAL` when a ZCL frame indicates a physical button press (**Glossary** §8.9). The `EventPublisher` implementation validates that the declared origin is consistent with the event type.

**Priority elevation:** Adapters may elevate a specific event instance from DIAGNOSTIC to NORMAL priority — but not to CRITICAL, and never downward (**Event Model & Event Bus** §3.3). This accommodates integrations that detect significance at production time (for example, elevating a `state_reported` to NORMAL when the protocol frame indicates a physical button press).

### 3.12 Telemetry Routing

Integration adapters that manage high-frequency data sources (energy monitors, power meters) declare `DataPath.TELEMETRY` in their `IntegrationDescriptor`. The `IntegrationContext` provides a `TelemetryWriter` reference for these adapters.

The boundary criterion follows **Event Model & Event Bus** §3.5: data sources producing more than one sample per 10 seconds sustained for a single entity are telemetry stream candidates. The adapter declares the data path at registration time; the supervisor routes the `TelemetryWriter` reference accordingly. An adapter that does not declare `DataPath.TELEMETRY` does not receive a `TelemetryWriter` and must route all data through the domain event path via `EventPublisher`.

Telemetry samples are `(entityRef, attributeKey, value, timestamp)` tuples — numeric only. Non-numeric data flows through the domain event path as `state_reported` events (**Persistence Layer** §3.6).

---

## 4. Data Model

### 4.1 IntegrationDescriptor

The descriptor is the integration's contract with the supervisor, declared by the `IntegrationFactory` at discovery time. The `IntegrationDescriptor` declares the integration type (a string key like `"zigbee"`), not the instance identity. The supervisor assigns an `IntegrationId` (ULID, per LTD-04) when the integration is first loaded. This instance identity is stable across restarts and is the `integration_id` referenced in all scoped interfaces and event payloads. The distinction: `integrationType` identifies the software; `IntegrationId` identifies the installed instance.

**Concrete descriptor values for the Zigbee adapter:**
```java
new IntegrationDescriptor(
    "zigbee",                                          // integrationType
    "Zigbee Adapter",                                  // displayName
    IoType.SERIAL,                                     // ioType
    Set.of(RequiredService.SCHEDULER,                  // requiredServices
           RequiredService.TELEMETRY_WRITER),
    Set.of(DataPath.DOMAIN, DataPath.TELEMETRY),       // dataPaths
    HealthParameters.defaults(),                        // healthParameters — all defaults are appropriate
    1                                                   // schemaVersion
)
```

The adapter uses `HealthParameters.defaults()` without overrides. The defaults are appropriate: 120-second heartbeat timeout with a 30-second watchdog ping provides 4 missed pings before stale detection, and 3/60s restart intensity prevents restart storms from serial port flapping.

### 4.2 HealthParameters

```java
public record HealthParameters(
    Duration heartbeatTimeout,         // Max silence before flagged unresponsive
    int healthWindowSize,              // Sliding window for error/timeout rates (default: 20)
    Duration maxDegradedDuration,      // Max time in DEGRADED before SUSPENDED (default: 5m)
    Duration maxSuspendedDuration,     // Max total SUSPENDED time before FAILED (default: 1h)
    int maxSuspensionCycles,           // Max SUSPENDED→probe→SUSPENDED cycles (default: 5)
    int maxRestarts,                   // Restart intensity limit (default: 3)
    Duration restartWindow,            // Restart intensity time window (default: 60s)
    Duration probeInitialDelay,        // First probe delay in SUSPENDED (default: 30s)
    Duration probeMaxDelay,            // Max probe delay (default: 5m)
    int probeCount,                    // Probes per suspension cycle (default: 3)
    int probeSuccessThreshold          // Required successful probes (default: 2)
) {
    /** Default values suitable for network polling integrations. */
    public static HealthParameters defaults() {
        return new HealthParameters(
            Duration.ofSeconds(120),   // heartbeatTimeout
            20,                        // healthWindowSize
            Duration.ofMinutes(5),     // maxDegradedDuration
            Duration.ofHours(1),       // maxSuspendedDuration
            5,                         // maxSuspensionCycles
            3,                         // maxRestarts
            Duration.ofSeconds(60),    // restartWindow
            Duration.ofSeconds(30),    // probeInitialDelay
            Duration.ofMinutes(5),     // probeMaxDelay
            3,                         // probeCount
            2                          // probeSuccessThreshold
        );
    }
}
```

### 4.3 IntegrationHealthRecord

The supervisor maintains a health record per integration in memory. This record is not persisted — it is reconstructed on startup from the integration's current state.

```java
public record IntegrationHealthRecord(
    IntegrationId integrationId,
    HealthState state,                 // HEALTHY, DEGRADED, SUSPENDED, FAILED
    double healthScore,                // 0.0 to 1.0
    Instant lastHeartbeat,
    Instant lastKeepalive,
    Instant stateChangedAt,
    int consecutiveFailures,
    int suspensionCycleCount,
    Duration totalSuspendedTime,
    SlidingWindow errorWindow,
    SlidingWindow timeoutWindow,
    SlidingWindow slowCallWindow
) {}

public enum HealthState { HEALTHY, DEGRADED, SUSPENDED, FAILED }
```

### 4.4 Integration Lifecycle Events

The Integration Runtime produces the following domain events via `EventPublisher`:

| Event type | Priority | Subject | Produced when |
|---|---|---|---|
| `integration_started` | NORMAL | integration entity | Adapter transitions to RUNNING |
| `integration_stopped` | NORMAL | integration entity | Adapter transitions from RUNNING to STOPPING |
| `integration_health_changed` | NORMAL (DEGRADED), CRITICAL (SUSPENDED, FAILED) | integration entity | Health state transition |
| `integration_restarted` | NORMAL | integration entity | Adapter restarted after failure |
| `integration_resource_exceeded` | CRITICAL | integration entity | Adapter exceeded resource quota |

All events carry `EventOrigin.SYSTEM` and include the integration type, previous state, new state, and a human-readable reason in the payload (INV-HO-04).

---

## 5. Contracts and Invariants

**Adapters must not share mutable state across the API boundary.** Integration code must not pass mutable objects to core interfaces, hold references to core-internal objects, spawn threads outside the supervisor's management, or perform blocking operations on the supervisor's thread. All data crossing the IntegrationContext boundary is either immutable (event payloads, entity records, configuration values) or consumed immediately (telemetry samples, health signals). These prohibitions are enforced by Layers 1–3 (§3.10) for import violations; mutable state sharing is enforced by code review and ArchUnit rules that flag mutable collections in public API signatures.

**An adapter crash never affects the core runtime, other integrations, or the event bus.** The supervisor catches all exceptions escaping the adapter's thread boundary. Virtual thread uncaught exception handlers prevent unhandled exceptions from propagating. Platform thread uncaught exception handlers serve the same role. The event bus operates on its own threads and is not disrupted by adapter thread failures (INV-RF-01).

**Every integration operates within configurable resource bounds.** The supervisor enforces concurrency limits (Semaphore on `ManagedHttpClient`), rate limits (token bucket on HTTP and event production), and monitors resource consumption via JFR attribution by thread name. An integration that exceeds its quotas is throttled (HTTP rate limiting) or transitioned to DEGRADED/SUSPENDED (sustained resource violations) (INV-RF-02).

**A failing integration never blocks system startup.** The `IntegrationSupervisor.start()` method returns a `CompletableFuture<Void>` that completes when all enabled integrations have been started — where "started" means the adapter's initialization method has returned or timed out, not that the adapter has connected to its external device. An adapter that fails initialization is marked FAILED; the system proceeds to the next adapter. The supervisor does not wait for external connectivity (INV-RF-03, L9).

**Integration health state transitions produce observable events.** Every transition in the health state machine produces an `integration_health_changed` event that is persisted, delivered to subscribers, and visible in the dashboard. There is no silent degradation (INV-TO-01, P3).

**The IntegrationContext is the only entry point from adapter to core.** Adapters do not hold references to core-internal objects, do not share mutable state with core components or other adapters, and do not communicate with other adapters except through the event bus. Build-time, CI-time, and runtime enforcement layers verify this boundary (L7, L11, LTD-17).

**Exception classification is deterministic and documented.** Every exception type that can cross the adapter→core boundary has a defined classification (transient or permanent) that determines the supervisor's response. Unknown exceptions default to transient. The classification table in §3.7 is exhaustive for the base exception hierarchy; adapters extend it by throwing `PermanentIntegrationException` for explicit permanent failures (L10).

**Adapters declare their I/O type truthfully.** The supervisor trusts the `IntegrationDescriptor.ioType()` declaration for thread allocation. A mis-declared adapter (network declared but performing JNI) is detected via JFR pinning events and flagged in health monitoring, but the runtime does not automatically reclassify — the developer must correct the descriptor. This is a build-time correctness concern, not a runtime safety concern.

**Shutdown completes within a bounded time.** The supervisor enforces a per-adapter grace period. After the grace period, the adapter is abandoned and shutdown proceeds. Total shutdown time is bounded by `max(grace_period) + supervisor_overhead`, regardless of adapter behavior.

---

## 6. Failure Modes and Recovery

### 6.1 Adapter Crash (Unhandled Exception)

**Trigger:** An adapter's main loop throws an uncaught exception (NullPointerException, IllegalStateException, protocol-level error).

**Impact:** The adapter stops processing events and commands for its devices. Devices become unavailable. Other integrations and the core are unaffected.

**Recovery:** The supervisor classifies the exception (§3.7). For transient exceptions, the supervisor restarts the adapter with exponential backoff. For permanent exceptions, the supervisor transitions to FAILED and notifies the user. If transient restarts exceed the intensity limit (3 in 60 seconds), the supervisor transitions to FAILED.

**Events produced:** `integration_health_changed` (CRITICAL if FAILED, NORMAL if restarting). `availability_changed` for all devices owned by the integration (subjects: device entities).

### 6.2 Adapter Hang (Unresponsive Main Loop)

**Trigger:** The adapter's main loop stops progressing. The heartbeat timestamp is not updated. Common causes: deadlock, infinite loop without I/O, blocked on an unresponsive external device without timeout.

**Impact:** Devices become stale (state is not updated) and commands are not dispatched. The adapter appears running but is not processing.

**Recovery:** The health monitor detects the stale heartbeat when it exceeds the adapter's `heartbeatTimeout`. The supervisor transitions the adapter to DEGRADED (heartbeat miss) and then SUSPENDED (continued unresponsiveness). During SUSPENDED, the supervisor force-stops the adapter (interrupt or port close) and begins probe cycles.

**Events produced:** `integration_health_changed` at each state transition.

### 6.3 External Device Offline

**Trigger:** The adapter's external device becomes unreachable — serial port disconnected, network host down, cloud API returning errors.

**Impact:** Devices managed by the integration are unavailable. The adapter is running but cannot communicate with its protocol endpoint.

**Recovery:** The adapter handles reconnection internally using its own exponential backoff. The adapter reports `availability_changed` events for affected devices. If reconnection attempts consistently fail, the error rate drives the health score down, triggering DEGRADED → SUSPENDED → FAILED transitions. If the device comes back online, the adapter reconnects and the health score recovers.

**Events produced:** `availability_changed` (per device), `integration_health_changed` if health transitions occur.

### 6.4 Initialization Timeout

**Trigger:** An adapter's `initialize()` method does not return within the configured timeout (default: 30 seconds).

**Impact:** The integration does not start. Its devices are not available.

**Recovery:** The supervisor treats this as a transient failure and retries with backoff. If repeated initialization timeouts exhaust the restart intensity limit, the integration transitions to FAILED. This directly addresses the Home Assistant failure mode where a hanging `async_setup_entry` blocks the entire system startup (INV-RF-03).

**Events produced:** `integration_health_changed` (NORMAL on retry, CRITICAL on FAILED).

### 6.5 JNI Pinning on a Network-Declared Adapter

**Trigger:** An adapter declared as `IoType.NETWORK` (running on a virtual thread) performs JNI native calls, causing carrier thread pinning. This is a developer error — the adapter should have declared `IoType.SERIAL` or should not be making JNI calls.

**Impact:** The pinned carrier thread reduces available carrier capacity for all virtual threads in the system. On a 4-core RPi 5, one pinned carrier is a 25% capacity reduction.

**Recovery:** The JFR `jdk.VirtualThreadPinned` event fires with the adapter's thread name. The health monitor detects sustained pinning attributed to the adapter's thread group and logs a structured warning identifying the integration and the pinning call site (from the JFR stack trace). The `resourceComplianceScore` component of the health score decreases, potentially driving a HEALTHY → DEGRADED transition if pinning is sustained.

The fix is a code change in the adapter: either change the descriptor to `IoType.SERIAL` or replace the JNI call with a pure-Java alternative. This is not a runtime-recoverable failure — it is a development-time correctness issue. The runtime detects and reports it; the developer resolves it.

**Events produced:** `integration_resource_exceeded` (NORMAL priority, diagnostic) with pinning duration and call site.

### 6.6 Resource Quota Exceeded

**Trigger:** An integration exceeds its configured resource limits — HTTP request rate, concurrent request count, or event production rate.

**Impact:** The offending resource access is throttled (HTTP rate limiter blocks, Semaphore blocks) or the integration's health score degrades (sustained violations).

**Recovery:** For transient quota breaches (a burst of activity), the rate limiter and semaphore provide natural backpressure — the adapter blocks until capacity is available. For sustained quota violations, the health score decreases and the supervisor transitions through DEGRADED → SUSPENDED → FAILED. Quotas are configurable per integration; a legitimate high-throughput integration can have its limits raised.

**Events produced:** `integration_resource_exceeded` (NORMAL priority) when quotas are hit. `integration_health_changed` on state transitions.

### 6.7 System Shutdown During Active Processing

**Trigger:** The system receives a shutdown signal (SIGTERM from systemd, manual stop, JVM shutdown) while adapters are actively processing data.

**Impact:** In-flight operations (pending serial reads, HTTP requests, event publications) must complete or be abandoned.

**Recovery:** The shutdown manager (§3.6) stops adapters in reverse startup order with a per-adapter grace period. Adapters that complete within the grace period produce final `integration_stopped` events. Adapters that exceed the grace period are abandoned. On next startup, the event log is the source of truth — any events that were published before shutdown are present; any in-flight operations that did not complete are not (INV-ES-04).

**Events produced:** `integration_stopped` for each adapter that shuts down cleanly. No event for abandoned adapters (the absence is itself diagnostic — the next startup's `integration_started` event without a preceding `integration_stopped` indicates an unclean shutdown).

### 6.8 JNI Native Crash (Segmentation Fault)

**Trigger:** A JNI native method in a serial adapter library (jSerialComm, or a future native dependency) causes a segmentation fault or other native crash.

**Impact:** The entire JVM process terminates. All integrations, the event bus, and the core runtime are lost. This is the one failure mode that in-process isolation cannot contain — it is inherent to the single-process architecture (LTD-16 MVP scope).

**Recovery:** systemd restarts the HomeSynapse process (LTD-13). On restart, the event log is the source of truth — replay from the last checkpoint restores state (INV-RF-04). The crashed integration is loaded normally; if it crashes again, the restart intensity limit (§3.4) applies. If native crashes recur, the user must disable the integration or report the bug to the adapter developer.

**Mitigation:** This failure mode is mitigated by (a) using well-tested, widely-deployed JNI libraries (jSerialComm has extensive field use), (b) confining JNI usage to declared `IoType.SERIAL` adapters where the risk is understood, and (c) the future option to move JNI-using adapters to out-of-process isolation (§14) where a segfault kills only the sidecar. The `IntegrationContext` abstraction (P1) ensures this migration requires no adapter code changes.

**Events produced:** None (process terminated). The absence of an `integration_stopped` event before the next `system_started` event is the diagnostic indicator of an unclean shutdown (same as §6.7).

---

## 7. Interaction with Other Subsystems

| Subsystem | Direction | Mechanism | Data | Constraints |
|---|---|---|---|---|
| Event Model & Event Bus | Produces events via | `EventPublisher.publish()`, `EventPublisher.publishRoot()` | `state_reported`, `command_result`, `availability_changed`, `device_discovered`, `presence_signal`, `integration_*` lifecycle events | Producer boundary rules (§3.1) enforced. Origin model (§3.9) enforced. Single-writer contention with EventPublisher for SQLite (LTD-03). |
| Event Model & Event Bus | Receives commands via | Supervisor-managed subscription → `CommandHandler` callback on adapter thread | `command_dispatched` events targeting this integration's devices | Subscription filter: `command_dispatched` events where target `integration_id` matches. |
| Device Model & Capability System | Queries via | `EntityRegistry` (integration-scoped) | Device records, entity records, capability schemas, hardware identifiers | Read-only. Filtered by `integration_id`. Used during discovery deduplication (§3.12) and command dispatch. |
| Device Model & Capability System | Triggers via | `device_discovered` events | Proposed devices with hardware identifiers and capability declarations | Discovery pipeline (**Device Model** §3.12) consumes these events and manages the adoption flow. |
| State Store & State Projection | Queries via | `StateQueryService` (integration-scoped) | Current entity state for this integration's entities | Read-only. Used when adapters need current state for protocol-level decisions. |
| Persistence Layer | Writes via | `TelemetryWriter.writeSamples()` | Telemetry samples: `(entityRef, attributeKey, value, timestamp)` | Numeric values only. Only available to integrations declaring `DataPath.TELEMETRY`. |
| Configuration System | Reads via | `ConfigurationAccess` (integration-scoped) | Validated integration configuration subtree | Integration-scoped: only `integrations.{type}:` subtree. Schema validated at startup. |
| Automation Engine | Receives from (indirectly) | `command_dispatched` events | Commands to execute on devices | The Automation Engine produces `command_issued`; the Command Dispatcher produces `command_dispatched`; the Integration Runtime receives `command_dispatched` for its devices. |
| Startup, Lifecycle & Shutdown | Called by | `IntegrationSupervisor.start()`, `IntegrationSupervisor.stop()` | Lifecycle signals | Start returns `CompletableFuture<Void>`. Stop blocks until all adapters have stopped or timed out. Startup/Lifecycle (doc 12) determines sequencing. |
| Observability & Debugging | Exposes | JFR events, metrics, structured logs, health indicators | Per-integration health state, restart counts, error rates, pinning events | All metrics exposed via JFR (LTD-15). Health state accessible via REST API. |
| REST API | Called by | Integration management endpoints | Start/stop/restart individual integrations, query health state | REST API (doc 09) defines endpoints; this subsystem provides the implementation. |

---

## 8. Key Interfaces

### 8.1 Interfaces

| Interface | Responsibility | Primary Consumers |
|---|---|---|
| `IntegrationFactory` | Produces `IntegrationDescriptor` and creates `IntegrationAdapter` instances given an `IntegrationContext` | ServiceLoader discovery, IntegrationSupervisor |
| `IntegrationAdapter` | Lifecycle contract for integration modules: `initialize()`, `run()`, `close()` | IntegrationSupervisor |
| `IntegrationSupervisor` | Manages adapter lifecycle, health state machine, restart intensity, thread allocation | Startup/Lifecycle subsystem, REST API |
| `IntegrationContext` | Composed API surface injected into adapters at construction | Integration adapters |
| `HealthReporter` | Adapter-to-supervisor health signal channel: heartbeats, keepalives, error reports | Integration adapters |
| `ManagedHttpClient` | Resource-controlled HTTP client facade with concurrency limits and rate limiting | Cloud-connected integration adapters |
| `SchedulerService` | Timer and periodic task scheduling for integration adapters | Integration adapters |
| `CommandHandler` | Callback interface implemented by the adapter; receives dispatched commands for this integration's devices | IntegrationSupervisor (invoker), Integration adapters (implementor) |
| `EventPublisher` | Event production (defined by **Event Model & Event Bus** §8.3; consumed here) | Integration adapters, core services |
| `EntityRegistry` | Device and entity queries (defined by **Device Model** §8.1; consumed here, scoped) | Integration adapters |
| `StateQueryService` | Current state queries (defined by **State Store** §8.1; consumed here, scoped) | Integration adapters |
| `TelemetryWriter` | Telemetry sample writes (defined by **Persistence Layer** §8.3; consumed here) | Telemetry-producing integration adapters |

### 8.2 Key Types

| Type | Kind | Responsibility |
|---|---|---|
| `CommandEnvelope` | Record | Dispatched command targeting an entity: entity reference, command type, parameters, causal context |
| `IntegrationDescriptor` | Record | Adapter's contract with the supervisor: I/O type, required services, health parameters |
| `IntegrationId` | Value (ULID wrapper) | Typed identity for an integration instance (per LTD-04) |
| `IoType` | Enum | SERIAL, NETWORK — drives thread allocation |
| `HealthState` | Enum | HEALTHY, DEGRADED, SUSPENDED, FAILED |
| `HealthParameters` | Record | Per-integration health thresholds and restart limits |
| `IntegrationHealthRecord` | Record | Current health state, scores, and counters for one integration |
| `RequiredService` | Enum | HTTP_CLIENT, SCHEDULER, TELEMETRY_WRITER |
| `DataPath` | Enum | DOMAIN, TELEMETRY |
| `PermanentIntegrationException` | Exception | Adapter signals an unrecoverable failure with a user-readable message |
| `IntegrationLifecycleEvent` | Sealed interface | Payload types for `integration_started`, `integration_stopped`, `integration_health_changed`, `integration_restarted`, `integration_resource_exceeded` |

### 8.3 IntegrationFactory Method Summary

`descriptor()` — Returns the `IntegrationDescriptor` declaring the integration's requirements. Called once during discovery. Must be a pure method with no side effects.

`create(IntegrationContext context)` — Creates an `IntegrationAdapter` instance using the provided context. Called by the supervisor during the LOADING phase. May throw `PermanentIntegrationException` if the adapter cannot be constructed (missing required configuration, incompatible environment).

### 8.4 IntegrationAdapter Method Summary

`initialize()` — Performs startup work that does not depend on external device connectivity: register identity, declare capabilities, set up internal data structures. Must complete within the configured timeout. Must not block on network or serial connections (INV-RF-03).

`run()` — The adapter's main loop. For network adapters, this method blocks on socket I/O. For serial adapters, this method drains the inbound `BlockingQueue` and processes events. The method returns normally when the adapter is signaled to stop (via interrupt or queue poison pill). Throwing from `run()` triggers the exception classification and restart logic (§3.7).

`close()` — Releases resources: close protocol connections, flush buffers, cancel timers. Called after `run()` returns (normal or exceptional). Must complete within the shutdown grace period. Idempotent — safe to call multiple times.

### 8.5 HealthReporter Method Summary

`reportHeartbeat()` — Updates the adapter's heartbeat timestamp. Call on every iteration of the main loop, including iterations where no data arrived.

`reportKeepalive(Instant lastSuccess)` — Reports the timestamp of the last successful protocol-level keepalive.

`reportError(Throwable error)` — Registers an error with the supervisor's sliding window. The supervisor classifies the error and updates the health score. The adapter has already handled the error (logged it, attempted recovery); this call records it for health tracking.

`reportHealthTransition(HealthState suggestedState, String reason)` — The adapter suggests a health transition with a human-readable reason. The supervisor may accept or override the suggestion based on its own metrics. This allows adapters to signal conditions that external monitoring cannot detect (for example, receiving valid responses that contain semantic errors).

### 8.6 CommandHandler Method Summary

`handle(CommandEnvelope command)` — Invoked by the supervisor when a `command_dispatched` event targets a device owned by this integration. The `CommandEnvelope` carries the target entity reference, command type, parameters, and causal context. The adapter translates the command to protocol-specific operations (e.g., ZCL frame for Zigbee, HTTP request for Hue) and publishes a `command_result` event via `EventPublisher` with the outcome. The method is invoked on the adapter's thread (virtual for network adapters, the virtual thread processor for serial adapters). If the method throws, the exception is classified per §3.7.

---

## 9. Configuration

All configuration follows YAML 1.2 (LTD-09) with JSON Schema validation. The Integration Runtime runs correctly with zero configuration — all values have sensible defaults (INV-CE-02).

```yaml
integration_runtime:
  # Supervisor behavior
  supervisor:
    default_init_timeout_seconds: 30      # Max time for adapter initialize()
    default_shutdown_grace_seconds: 10    # Max time for adapter close()
    health_check_interval_seconds: 30     # How often the supervisor scans heartbeats
    jfr_pinning_threshold_ms: 20          # JFR VirtualThreadPinned event threshold

  # Default health parameters (overridden per-integration in IntegrationDescriptor)
  health_defaults:
    heartbeat_timeout_seconds: 120        # Default for network polling integrations
    health_window_size: 20                # Sliding window for error/timeout rates
    max_degraded_minutes: 5               # Max DEGRADED before SUSPENDED
    max_suspended_minutes: 60             # Max total SUSPENDED before FAILED
    max_suspension_cycles: 5              # Max probe cycles before FAILED
    max_restarts: 3                       # Restart intensity limit
    restart_window_seconds: 60            # Restart intensity time window
    probe_initial_delay_seconds: 30       # First probe in SUSPENDED
    probe_max_delay_seconds: 300          # Max probe backoff
    probe_count: 3                        # Probes per cycle
    probe_success_threshold: 2            # Required successes

  # HTTP client defaults (for integrations declaring RequiredService.HTTP_CLIENT)
  http_client:
    max_concurrent_requests: 10           # Per-integration Semaphore limit
    requests_per_minute: 120              # Per-integration rate limit
    connect_timeout_seconds: 10           # TCP connect timeout
    request_timeout_seconds: 30           # Full request/response timeout
    idle_connection_timeout_seconds: 60   # Connection pool idle eviction

  # Per-integration overrides (keyed by integration_type)
  overrides:
    zigbee:
      heartbeat_timeout_seconds: 600      # Hub coordinators have long quiet periods
    hue:
      requests_per_minute: 60             # Hue Bridge rate limits are strict
      request_timeout_seconds: 10         # Hue API is fast; timeout quickly
```

**Override precedence:** `integration_runtime.health_defaults` (system baseline) → `IntegrationDescriptor` (adapter developer's declaration) → `integration_runtime.overrides.{type}` (per-type user override) → direct per-instance YAML (user's final say). Each level overrides the previous. The adapter developer's declaration takes precedence over system health defaults because the developer understands the protocol's timing characteristics — a Zigbee adapter declaring a 600-second heartbeat knows its coordinator has long quiet periods. User-level overrides take precedence over everything because the user has the final say over their installation.

---

## 10. Performance Targets

All targets are specified for the primary deployment target: Raspberry Pi 5, 4 GB RAM, NVMe SSD storage, running the JVM configuration in LTD-01.

| Metric | Target | Rationale | Test Method |
|---|---|---|---|
| Adapter initialization time (p99) | < 5 seconds | Initialization must not block other adapters. 5 seconds allows resource allocation and descriptor registration without waiting for external devices. | Benchmark: initialize 10 adapters sequentially, measure p99. |
| Total supervisor startup time (all adapters started) | < 10 seconds | System must reach functional state quickly. Adapters start concurrently (asynchronous futures), so total time is bounded by the slowest initializer plus supervisor overhead (INV-RF-03). | Benchmark: start system with 5 integrations, measure time to `CompletableFuture` completion. |
| Health state transition latency | < 1 second | Transitions should be near-instantaneous once the guard condition is met. Dominated by event publication and health record update. | Benchmark: inject a health score change and measure time to event production. |
| Heartbeat scan overhead | < 5 ms per scan | Scanning a `ConcurrentHashMap` of 20 entries. Must be negligible. | Benchmark: scan 20 entries 10,000 times, measure p99. |
| Event production throughput per adapter | > 100 events/second | An individual adapter must not be bottlenecked by the IntegrationContext. The event bus's 500 events/second sustained target (**Event Model & Event Bus** §10) is shared across all producers. | Benchmark: single adapter publishing events in a tight loop, measure sustained throughput. |
| Managed HTTP client overhead per request | < 2 ms | Semaphore acquire + rate limiter check must not meaningfully add to HTTP latency. | Benchmark: 1,000 sequential HTTP requests through ManagedHttpClient vs raw HttpClient, measure overhead delta. |
| Carrier thread utilization at steady state (50 devices, 3 integrations) | < 50% | Must leave carrier thread capacity for core services (event bus, state projection, persistence). Measured as average carrier thread busy time over a 5-minute window. | JFR: monitor `jdk.VirtualThreadPinned` duration and carrier thread scheduling metrics. |
| Memory per integration (typical) | < 20 MB | Includes HttpClient (~5 MB), adapter state, thread stack, buffers. 20 integrations at 20 MB each = 400 MB, within the 1.5 GB heap budget. | JFR allocation profiling: attribute heap consumption by integration thread group. |

---

## 11. Observability

### 11.1 Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `hs.integration.health_state` | Gauge | `integration_id`, `integration_type` | Current health state (0=HEALTHY, 1=DEGRADED, 2=SUSPENDED, 3=FAILED) |
| `hs.integration.health_score` | Gauge | `integration_id`, `integration_type` | Current weighted health score (0.0 to 1.0) |
| `hs.integration.restart_count` | Counter | `integration_id`, `integration_type` | Total restart count since system start |
| `hs.integration.error_rate` | Gauge | `integration_id`, `integration_type` | Current error rate over sliding window |
| `hs.integration.timeout_rate` | Gauge | `integration_id`, `integration_type` | Current timeout rate over sliding window |
| `hs.integration.heartbeat_age_ms` | Gauge | `integration_id`, `integration_type` | Milliseconds since last heartbeat |
| `hs.integration.events_produced` | Counter | `integration_id`, `integration_type`, `event_type` | Events produced by this integration |
| `hs.integration.http_requests` | Counter | `integration_id`, `integration_type`, `status_code` | HTTP requests made (cloud integrations) |
| `hs.integration.http_latency_ms` | Histogram | `integration_id`, `integration_type` | HTTP request latency distribution |
| `hs.integration.carrier_pinning_ms` | Counter | `integration_id`, `integration_type` | Total carrier thread pinning time attributed to this integration |
| `hs.integration.telemetry_samples` | Counter | `integration_id`, `integration_type` | Telemetry samples written to ring store |
| `hs.supervisor.active_integrations` | Gauge | — | Count of integrations in RUNNING state |
| `hs.supervisor.failed_integrations` | Gauge | — | Count of integrations in FAILED state |

### 11.2 Structured Logging

| Log Event | Level | Key Fields | Description |
|---|---|---|---|
| `integration.started` | INFO | `integration_id`, `integration_type`, `io_type`, `thread_type` | Adapter transitioned to RUNNING |
| `integration.stopped` | INFO | `integration_id`, `integration_type`, `reason` | Adapter stopped (clean shutdown, suspension, or failure) |
| `integration.health_changed` | WARN (DEGRADED), ERROR (SUSPENDED/FAILED) | `integration_id`, `integration_type`, `from_state`, `to_state`, `health_score`, `reason` | Health state transition |
| `integration.restarted` | WARN | `integration_id`, `integration_type`, `attempt`, `backoff_ms` | Adapter restarted after failure |
| `integration.restart_limit` | ERROR | `integration_id`, `integration_type`, `restarts_in_window` | Restart intensity limit reached — transitioning to FAILED |
| `integration.exception` | WARN (transient), ERROR (permanent) | `integration_id`, `integration_type`, `exception_class`, `classification`, `message` | Exception at module boundary |
| `integration.heartbeat_stale` | WARN | `integration_id`, `integration_type`, `age_ms`, `threshold_ms` | Heartbeat exceeded threshold |
| `integration.pinning_detected` | WARN | `integration_id`, `integration_type`, `duration_ms`, `callsite` | Virtual thread pinning attributed to this integration |
| `integration.init_timeout` | WARN | `integration_id`, `integration_type`, `timeout_ms` | Initialization exceeded timeout |
| `supervisor.startup_complete` | INFO | `total_integrations`, `running`, `failed`, `duration_ms` | All integrations processed |
| `supervisor.shutdown_complete` | INFO | `total_integrations`, `clean`, `abandoned`, `duration_ms` | Shutdown finished |

All log entries use structured JSON format (LTD-15) with `integration_id` and `integration_type` fields for log correlation.

### 11.3 Health Indicator

The Integration Runtime exposes a composite health indicator to the system health API.

| State | Condition |
|---|---|
| **HEALTHY** | All enabled integrations are in HEALTHY state |
| **DEGRADED** | One or more integrations are in DEGRADED or SUSPENDED state, but at least one is HEALTHY |
| **UNHEALTHY** | All integrations are in FAILED state, or the supervisor itself has encountered an internal error |

Per-integration health state is also exposed individually, enabling the dashboard to display a detailed integration status panel with health score, error rate, and last heartbeat for each integration. This subsystem implements the `HealthContributor` interface (Doc 11 §8.1, §8.2) to report composite integration health to the HealthAggregator. The Integration Runtime is classified as CORE_SERVICES tier (Doc 11 §7.1) with a 30-second startup grace period. Health state changes are reported via `HealthContributor.reportHealth(status, reason)` when per-integration health transitions cause the composite state to change. Individual integration health (including the Zigbee Adapter, Doc 08) is reported through the Integration Runtime's composite indicator — adapters do not appear as separate HealthContributor instances in the HealthAggregator (Doc 11 §7.1).

---

## 12. Security Considerations

The Integration Runtime is a trust boundary. Integration code runs within the same JVM process as the core, so any isolation is enforcement-through-convention backed by compilation and module system constraints — not hardware-level isolation.

**API surface restriction.** The `IntegrationContext` provides the only legitimate entry point from adapter code to core services. JPMS module boundaries prevent integration code from accessing non-exported core packages at runtime. Gradle module graph enforcement and ArchUnit tests catch violations at build time and CI time respectively (L7). This is defense-in-depth: any single enforcement layer failing is caught by the others.

**No arbitrary code execution.** All MVP integrations are compiled into the HomeSynapse distribution (LTD-16). There is no dynamic JAR loading, no classpath extension, and no runtime class generation. This eliminates the security risk of arbitrary code execution from untrusted sources.

**Integration-scoped data access.** Each adapter's `EntityRegistry` and `StateQueryService` views are filtered by `integration_id`. An adapter cannot read another integration's device state, entity records, or configuration. This prevents a compromised or buggy adapter from exfiltrating data from other protocol domains.

**HTTP client restriction.** Cloud-connected integrations access external APIs only through the `ManagedHttpClient`, which enforces rate limits and concurrency limits. Integrations do not have direct socket construction capability (they could construct raw sockets through `java.net`, but JPMS module restrictions can limit this in future tiers, and ArchUnit rules flag such usage at CI time).

**Credential handling.** Integration credentials (API keys, Zigbee network keys, OAuth tokens) are stored in the integration's configuration and accessed via `ConfigurationAccess`. The Integration Runtime does not interpret or log credential values. The Configuration System (doc 06) owns credential storage and encryption (INV-PD-03).

---

## 13. Testing Strategy

### 13.1 Unit Tests

**Supervisor restart intensity tracking.** Verify that the restart counter correctly counts restarts within the sliding window. Test boundary conditions: exactly `maxRestarts` in `restartWindow`, restarts straddling the window boundary, window reset after stable uptime.

**Health score calculation.** Verify the weighted formula against known inputs. Test edge cases: all-zero rates (score = 1.0), all-failure rates (score = 0.0), mixed rates at transition boundaries (0.80 and 0.40 thresholds). Verify that `dataFreshnessScore` decays linearly from 1.0 to 0.0 as heartbeat age increases from threshold to 3× threshold.

**Health state machine transitions.** Verify every transition in the state machine (§3.4): HEALTHY→DEGRADED, DEGRADED→HEALTHY, DEGRADED→SUSPENDED, SUSPENDED→DEGRADED (probe success), SUSPENDED→FAILED (probe exhaustion), FAILED→LOADING (manual restart). Verify that HEALTHY→SUSPENDED and HEALTHY→FAILED transitions are impossible (must pass through DEGRADED). Verify flapping dampening: rapid DEGRADED↔HEALTHY cycling does not produce excessive events.

**Exception classification.** Verify that each exception type in the classification table (§3.7) is correctly categorized as transient or permanent. Verify that `PermanentIntegrationException` is classified as permanent. Verify that unknown `RuntimeException` subclasses default to transient.

**IntegrationDescriptor validation.** Verify that descriptors with invalid combinations (e.g., `IoType.SERIAL` with `RequiredService.HTTP_CLIENT`) are rejected during discovery. Verify that `HealthParameters` with out-of-range values (negative timeouts, zero window size) are rejected.

### 13.2 Integration Tests

**Virtual thread shutdown via interrupt.** Start a mock network adapter on a virtual thread blocked on socket read. Call `Thread.interrupt()`. Verify that the socket is closed, the `SocketException` propagates, and the adapter's `close()` method is called within the grace period.

**Platform thread shutdown via resource close.** Start a mock serial adapter on a platform thread blocked on jSerialComm `readBytes()`. Call `serialPort.closePort()` from the test thread. Verify that the `readBytes()` call returns and the adapter shuts down cleanly.

**Full lifecycle: discovery → initialization → running → shutdown.** Create a test `IntegrationFactory` via ServiceLoader. Verify the supervisor discovers it, creates the adapter, calls `initialize()`, transitions to RUNNING, and on shutdown calls `close()`. Verify lifecycle events (`integration_started`, `integration_stopped`) are produced.

**Health state transition under failure.** Start an adapter that intermittently throws exceptions. Verify the health score decreases, the state transitions through DEGRADED → SUSPENDED, probes execute on the backoff schedule, and the adapter either recovers or transitions to FAILED.

**IntegrationContext scoping.** Start two mock integrations with different `integration_id` values. Verify that each adapter's `EntityRegistry` and `StateQueryService` return only records belonging to that integration. Verify that adapter A cannot see adapter B's entities.

**Event production enforcement.** Attempt to produce a `state_changed` event from an adapter via `EventPublisher`. Verify that an `IllegalEventTypeException` is thrown and the event is not persisted.

### 13.3 Performance Tests

**Carrier thread utilization under mixed I/O.** Run 1 serial adapter (platform thread) and 3 network adapters (virtual threads) simultaneously on RPi 5 hardware. Measure carrier thread busy time via JFR. Verify that carrier utilization stays below 50% at steady state with typical event rates (50 devices, 30-second polling).

**Event throughput per adapter.** Single adapter publishing events in a tight loop via `EventPublisher`. Measure sustained events per second. Verify > 100 events/second per adapter.

**Managed HTTP client overhead.** Benchmark 1,000 HTTP requests through `ManagedHttpClient` versus raw `HttpClient`. Measure per-request overhead. Verify < 2 ms overhead.

**Startup time with multiple integrations.** Start the system with 5 mock integrations. Measure time from `IntegrationSupervisor.start()` to `CompletableFuture` completion. Verify < 10 seconds.

### 13.4 Failure Tests

**INV-RF-01 verification: adapter crash isolation.** Start 3 integrations. Force one to throw `OutOfMemoryError`. Verify the other two continue processing events. Verify event bus throughput is unaffected. Verify automations for unaffected devices continue firing.

**INV-RF-01 verification: infinite loop isolation.** Start 2 integrations. Force one into an infinite loop (no I/O, no heartbeat update). Verify the other integration continues operating. Verify the health monitor detects the stale heartbeat and transitions the looping integration through DEGRADED → SUSPENDED → FAILED.

**INV-RF-03 verification: startup with offline device.** Configure an integration targeting an unreachable network host. Verify the system reaches functional state (dashboard accessible, other integrations operational) within the startup time target. Verify the failing integration is marked FAILED without blocking other initialization.

**JFR pinning detection.** Start a mock adapter declared as `IoType.NETWORK` that executes `synchronized` blocks (causing pinning on Java 21). Verify that `jdk.VirtualThreadPinned` events are detected by the health monitor and attributed to the correct integration.

**Restart intensity exhaustion.** Configure an adapter that fails immediately on `run()`. Verify that the supervisor restarts it 3 times with increasing backoff, then transitions to FAILED when the intensity limit is reached. Verify the `integration.restart_limit` log event is produced.

---

## 14. Future Considerations

**Out-of-process integration isolation.** The current design uses in-process isolation with virtual thread supervision. For Enhanced-tier deployments on x86 hardware where IPC overhead is negligible, the `IntegrationContext` interface can be backed by IPC (Unix domain sockets, gRPC) instead of method dispatch. The INV-RF-01 compatibility test — deploying the same integration binary against both in-process and out-of-process hosts with identical behavior — validates this migration path. The design ensures this by prohibiting shared mutable state between adapters and core (L11).

**Classloader isolation for community integrations.** When community-developed integrations become a requirement, classloader isolation can be introduced to prevent integrations from accessing core-internal classes through the unnamed module. Each integration would load in its own classloader with the `homesynapse-api` module as the sole parent delegation target. Memory cost is approximately 5–10 MB per isolated classloader (duplicated Jackson, SLF4J instances). This is acceptable on x86 but may be too expensive for Constrained-tier RPi deployments.

**Dynamic JAR loading.** The current design requires all integrations to be compiled into the distribution. Dynamic loading of integration JARs from a repository (similar to OpenHAB's marketplace or Home Assistant's HACS) is a future capability. The `ServiceLoader` discovery mechanism (§3.10) is compatible with dynamic module loading — new modules added to the module path are discoverable on restart. Hot-loading without restart requires a custom classloader or JPMS layer, which is deferred until the use case warrants the complexity.

**Per-integration memory quotas.** The JVM provides no mechanism for per-thread-group memory limits. Future approaches include: JFR-based memory attribution with supervisor-enforced soft limits (the current approach), the potential introduction of memory scopes in future JDK releases, or process-level isolation where each integration runs in a separate JVM with `-Xmx` constraints. The `IntegrationContext` abstraction (§3.8) ensures the migration path is transparent to integration code.

**Integration marketplace and signing.** When community integrations are supported, a signing and verification mechanism prevents installation of tampered or malicious integration JARs. The `IntegrationDescriptor.schemaVersion` field accommodates versioned distribution metadata.

---

## 15. Open Questions

1. **OQ-1: Carrier thread pool sizing for RPi 5.** Default parallelism matches available processors (4 on RPi 5). Starting with the system default is the recommended position; `-Djdk.virtualThreadScheduler.parallelism=6` may improve throughput when serial I/O pins one carrier. Needs empirical validation during Phase 3 integration testing with representative workloads (1 serial adapter + 3 network adapters under typical event rates). Status: **[NON-BLOCKING]** — the design is valid at any pool size ≥ 4.

2. **OQ-2: Java 24 targeting.** JEP 491 eliminates `synchronized`-block pinning, benefiting SQLite JDBC driver, jSerialComm's synchronized methods, and third-party libraries. The recommended position is to ship on Java 21 LTS per LTD-01 and document Java 24 as the first upgrade candidate post-MVP, with specific benefits (JEP 491 pinning fix, potential throughput improvement on constrained hardware). No design in this document depends on Java 24 features. Status: **[NON-BLOCKING]** — all decisions are valid on Java 21.

3. **OQ-3: Custom circuit breaker vs Resilience4j.** The recommended position is a custom implementation (~200 lines) for MVP. The `IntegrationSupervisor`'s health state machine, restart intensity tracker, and backoff logic are purpose-built for this subsystem's specific requirements. Reversal criterion: if the custom implementation exceeds 500 lines or fails to handle 3+ edge cases discovered during Phase 3 integration testing, adopt Resilience4j and implement the health state machine as a Resilience4j `CircuitBreaker` with custom state mappings. The `IntegrationSupervisor` interface is designed so the swap is transparent to adapters. Status: **[NON-BLOCKING]** — the interface is stable regardless of implementation choice.

4. **OQ-4: Exact IntegrationContext injection surface.** The recommended position is the composition defined in §3.8: `EventPublisher`, `EntityRegistry`, `StateQueryService`, `ConfigurationAccess`, `SchedulerService`, `HealthReporter`, `TelemetryWriter`, and `ManagedHttpClient`. This will be validated during Doc 08 (Zigbee Adapter) when the first concrete integration exercises the API. Additional interfaces may be added if the Zigbee adapter reveals missing capabilities; removed if interfaces go unused. Status: **[NON-BLOCKING]** — the composition is extensible without breaking existing adapters.

5. **OQ-5: Per-integration heartbeat timeout thresholds.** The recommended position is to declare thresholds in `IntegrationDescriptor` with defaults per I/O type: serial/hub 600s, network polling 3× poll interval, event-driven 120s. These defaults are based on competitive research and engineering judgment. Calibration against real hardware during Phase 3 integration testing (Zigbee coordinator quiet period behavior, MQTT keepalive intervals, cloud API poll patterns) may adjust specific values. Configurable per-installation via the `overrides` section of YAML configuration (§9). Status: **[NON-BLOCKING]** — the defaults are conservative and the override mechanism allows any installation to tune them.

---

## Internal Decision Labels

This document uses internal labels L1–L12 for cross-referencing decisions within the Integration Runtime. These are document-scoped identifiers, distinct from the system-wide LTD-NN locked decisions.

| Label | Decision | Section |
|---|---|---|
| L1 | Hybrid thread model: platform for serial/JNI, virtual for network | §3.2 |
| L2 | I/O type declaration via IntegrationDescriptor.ioType() | §3.2 |
| L3 | Dual shutdown mechanism: interrupt for virtual, resource-close for platform | §3.6 |
| L4 | OTP-style one-for-one supervision, 3/60s restart intensity | §3.4 |
| L5 | Four-state health model with weighted scoring | §3.4 |
| L6 | Three complementary health checking mechanisms | §3.5 |
| L7 | Three-layer API boundary enforcement (Gradle + ArchUnit + JPMS) | §3.10 |
| L8 | Per-integration ManagedHttpClient with Semaphore + RateLimiter | §3.9 |
| L9 | Initialization independence from external connectivity | §3.3 |
| L10 | Deterministic exception classification table | §3.7 |
| L11 | No shared mutable state between adapters and core | §3.8 |
| L12 | ServiceLoader discovery via JPMS provides/uses | §3.10 |

---

## 16. Summary of Key Decisions

| Decision | Choice | Rationale | Section |
|---|---|---|---|
| Thread architecture | Hybrid: platform threads for serial/JNI I/O, virtual threads for network I/O | JEP 444 unmounts virtual threads from carrier on socket I/O but pins on JNI. Serial via jSerialComm pins carrier permanently — 25% carrier capacity loss on 4-core RPi 5. Platform thread isolates the pinning. Derives from P5 (thread architecture follows I/O physics). | §3.2 |
| I/O type declaration | Adapters declare `IoType.SERIAL` or `IoType.NETWORK` in IntegrationDescriptor | Supervisor selects thread type at registration. Mis-declaration detected via JFR pinning events. | §3.2, §4.1 |
| Shutdown mechanism | Interrupt-based for virtual threads; resource-close-based for platform threads | JEP 444 behavioral divergence: `Thread.interrupt()` closes socket on virtual thread; does not unblock JNI on platform thread. | §3.6 |
| Supervision strategy | Custom OTP-style one-for-one, 3 restarts per 60 seconds | Only the failed adapter restarts. Erlang/OTP's intensity/period model prevents restart storms. No Resilience4j or Akka dependency on constrained hardware. | §3.4 |
| Restart backoff | Exponential: 200ms × 2^min(count, 8), cap 30s, reset after 5s stable | Prevents rapid restart cycling. Resets on stable operation to avoid permanent escalation from transient failures. | §3.4 |
| Health model | Four states: HEALTHY → DEGRADED → SUSPENDED → FAILED | Graduated response replaces HA's binary model. Each transition produces an observable event. SUSPENDED includes probe-based recovery. FAILED requires manual intervention. | §3.4 |
| Health scoring | Weighted formula: 0.30 error + 0.20 timeout + 0.15 slow + 0.20 freshness + 0.15 resource | Multi-signal scoring prevents single-metric false positives. Weights emphasize error rate as the primary failure signal. | §3.4 |
| API surface | Composed IntegrationContext of narrow, typed interfaces | Eliminates HA's god object pattern. Each interface is the minimum surface for its concern. Build-time, CI-time, and runtime enforcement layers. | §3.8 |
| Integration discovery | ServiceLoader via JPMS provides/uses | No classpath scanning, no reflection, no annotation processing. Compatible with future dynamic module loading. | §3.10 |
| API boundary enforcement | Three layers: Gradle module graph, ArchUnit tests, JPMS module-info | Defense-in-depth. Gradle catches at compile time, ArchUnit at CI time, JPMS at runtime. Any single layer failure is caught by the others. | §3.10 |
| HTTP client model | Per-integration ManagedHttpClient with Semaphore + RateLimiter | Isolation prevents noisy-neighbor effects. Per-integration timeout/proxy/SSL configuration. Clean lifecycle. ~2–5 MB per instance, acceptable for 20 integrations. | §3.9 |
| Initialization independence | Adapters must initialize without external connectivity | Addresses HA's boot-dependent-on-connectivity anti-pattern. Connection is the adapter's concern; initialization is the supervisor's concern. | §3.3 |
| Exception classification | Deterministic table, unknown RuntimeException defaults to transient | Prevents HA's permanent-failure-on-unknown-exception pattern. Restart intensity limit protects against genuinely unrecoverable failures. | §3.7 |
| Event production enforcement | Compile-time + runtime boundary. Adapters produce only permitted event types. | Prevents adapter from producing derived events (state_changed) or command events (command_issued) reserved for core services. | §3.11 |
| Telemetry routing | Declared at registration via DataPath enum, routed to TelemetryWriter | High-frequency samples bypass the domain event store. Boundary criterion: >1 sample/10s sustained per entity. | §3.12 |
| Anti-pattern: no god object | IntegrationContext is composed of narrow interfaces, not a single omniscient reference | Directly addresses HA's hass object coupling problems. Each interface is independently versionable. | §3.8 |
| Anti-pattern: no cross-integration access | EntityRegistry and StateQueryService scoped by integration_id | Prevents invisible coupling where adapters read each other's state. All inter-integration communication flows through the event bus. | §3.8 |
| Anti-pattern: no infinite retry | Every retry path has an escalation threshold leading to FAILED | Addresses HA's indefinite retry at 80s intervals with no escalation. SUSPENDED→FAILED after configurable cycles. | §3.4 |
| Anti-pattern: no silent degradation | Health state changes produce events visible in the dashboard | HA has only binary states. HomeSynapse's four-state model with events makes degradation observable. | §3.4 |
| Anti-pattern: no hardcoded supervision | All thresholds configurable per-integration via IntegrationDescriptor + YAML overrides | HA's hardcoded WATCHDOG_THROTTLE_PERIOD applies identically to all integrations. HomeSynapse allows per-integration tuning. | §4.2, §9 |
| Anti-pattern: no startup dependency | initialize() must succeed without external connectivity | HA Cloud integrations fail permanently when starting without internet. HomeSynapse separates initialization from connection. | §3.3 |
| Command delivery | Supervisor-managed subscription with CommandHandler callback | Adapter receives commands without direct event bus access. Supervisor owns the subscription lifecycle and filter. Preserves the API boundary — adapters never touch the event bus directly. | §3.8 |

---

## Invariant and LTD Cross-Reference

| Invariant / LTD | Sections in This Document |
|---|---|
| **INV-ES-04** (Write-ahead persistence) | §4.4 (lifecycle events persisted via EventPublisher write-ahead), §6.7 (shutdown relies on write-ahead guarantee) |
| **INV-ES-05** (At-least-once delivery) | §7 (command_dispatched subscription, adapter command handling must be idempotent) |
| **INV-RF-01** (Integration isolation) | §0 (purpose), §3.2 (thread isolation), §3.4 (one-for-one restart), §3.7 (exception boundary), §3.8 (scoped context), §5 (crash isolation contract), §6.1 (adapter crash), §13.4 (failure tests) |
| **INV-RF-02** (Resource quotas) | §3.9 (HTTP client limits), §5 (resource bounds contract), §6.6 (quota exceeded), §11.1 (metrics) |
| **INV-RF-03** (Startup independence) | §3.3 (initialization phase), §5 (startup contract), §6.4 (init timeout), §13.4 (offline device test) |
| **INV-RF-06** (Graceful degradation) | §3.4 (four-state health model), §5 (observable transitions), §6 (all failure modes) |
| **INV-CE-02** (Zero-config first run) | §9 (all defaults sensible, zero-config functional) |
| **INV-CE-05** (Extension model) | §3.8 (IntegrationContext), §3.10 (ServiceLoader discovery), §14 (future classloader isolation) |
| **INV-CS-02** (Stable identifiers) | §4.1 (IntegrationId as ULID), §4.4 (integration_id in lifecycle events) |
| **INV-CS-04** (Integration API stability) | §3.8 (narrow typed interfaces), §3.10 (three-layer enforcement) |
| **INV-HO-04** (Self-explaining errors) | §3.7 (PermanentIntegrationException with user message), §4.4 (human-readable reason in events) |
| **INV-TO-01** (Observable behavior) | §3.4 (health events on every transition), §3.5 (three health mechanisms), §11 (metrics, logging, health) |
| **INV-PR-01** (Constrained hardware target) | §3.2 (hybrid thread model), §3.9 (HTTP client memory budget), §10 (RPi 5 targets) |
| **INV-PR-03** (Bounded resources) | §3.9 (per-integration HTTP limits), §5 (resource bounds), §10 (memory per integration) |
| **LTD-01** (Java 21) | §3.2 (virtual threads), §3.5 (JFR events), §3.9 (HttpClient AutoCloseable) |
| **LTD-03** (SQLite WAL) | §7 (single-writer contention with EventPublisher) |
| **LTD-04** (ULID) | §4.1 (IntegrationId), §8.2 (IntegrationId type) |
| **LTD-11** (No external broker) | §3.8 (adapters communicate via EventPublisher, not external messaging) |
| **LTD-13** (systemd) | §3.6 (shutdown via SIGTERM), §6.7 (system shutdown during processing) |
| **LTD-15** (JFR) | §3.5 (JFR event streaming), §11.1 (JFR-based metrics attribution) |
| **LTD-16** (In-process compiled modules) | §3.10 (ServiceLoader discovery), §12 (no dynamic JAR loading) |
| **LTD-17** (Build-enforced API boundaries) | §3.8 (IntegrationContext), §3.10 (three-layer enforcement), §12 (security) |

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It is governed by the Design Document Template and will be reviewed during architecture review.*
