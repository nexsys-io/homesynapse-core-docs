# HomeSynapse Core — Master Architecture Document

**Document type:** Architecture synthesis
**Status:** Locked
**Subsystem:** All (system-level synthesis)
**Dependencies:** Docs 01–13 (all locked subsystem designs), Architecture Invariants v1, Locked Decisions Register v1 (LTD-01 through LTD-18), Portability Architecture v1, Glossary v1, Identity and Addressing Model v1
**Dependents:** Phase 2 interface specifications (all subsystems)
**Author:** HomeSynapse Core Architecture
**Date:** 2026-03-10

---

## 0. Purpose

The Master Architecture Document is the single document a new team member reads to understand how HomeSynapse Core works as a whole. It is not a replacement for the 13 subsystem designs — it is the map that shows how they connect.

HomeSynapse Core is a local-first, event-sourced smart home platform. It runs as a single long-lived Java 21 process on a Raspberry Pi, managing devices across protocol adapters, persisting every state change as an immutable event, deriving current state from the event log, executing automations in response to events, and exposing the system through REST and WebSocket APIs with an observability-focused web dashboard. Thirteen subsystem design documents define how each piece works. This document defines how the pieces form a system.

**Template variance:** This document follows the DESIGN_DOC_TEMPLATE.md section structure (§0–§16) but its content is synthesis, not subsystem design. The metadata header uses "Architecture synthesis" rather than "Subsystem design" as the document type. Sections serve different purposes than in a subsystem design doc — §3 Architecture contains system-level diagrams and budgets rather than a single subsystem's internal architecture, §4 Data Model provides cross-cutting registries rather than one subsystem's schemas, and §8 Key Interfaces summarizes external API surfaces rather than one subsystem's public interfaces. All 16 template sections are present and substantive.

The document serves three purposes. First, it provides the architectural narrative that connects subsystem designs into a coherent whole — the data flows, initialization sequences, memory budgets, and module boundaries that no single subsystem document can express. Second, it consolidates cross-cutting concerns — security posture, performance targets, configuration namespaces, observability surfaces — that span multiple subsystems and must be understood at the system level. Third, it establishes the deployment tier model and CI/CD strategy that govern how HomeSynapse Core is built, tested, and shipped.

---

## 1. Design Principles

The Architecture Invariants document (v1) defines 72 invariants across 15 categories. Those invariants are constitutional constraints. The principles below describe how the invariants manifest in the actual architecture that emerged from 13 subsystem designs.

**Events are the system's memory.** Every meaningful occurrence — a device reporting state, an automation firing, a configuration change, a subsystem starting — is recorded as an immutable event in the event log before any other processing occurs (INV-ES-01, INV-ES-04). The event log is the source of truth; all other data structures are derived views that can be reconstructed by replaying events from the last checkpoint. This is not a logging strategy. It is the foundational data architecture that makes the system debuggable (INV-ES-06), recoverable (INV-RF-04), and auditable (INV-TO-01). See **Event Model & Event Bus** (Doc 01) for the event lifecycle, envelope schema, and persistence contract.

**State is always a projection.** The State Store (Doc 03) maintains the current state of every entity as a materialized view over the event stream. If the State Store is lost, replaying the event log reconstructs it identically. The Automation Engine's trigger index, the Pending Command Ledger, and the Causal Chain Projection are all subscribers that maintain their own derived views. No subscriber's state is authoritative — the event log is. This separation means that adding a new derived view (a reliability projection, an energy aggregation, a home health score) requires adding a subscriber, not modifying the data model.

**Integration isolation is a hard boundary.** Each integration adapter runs in a supervised execution context with its own virtual thread, health state machine, and resource monitoring (Doc 05). A crashing Zigbee adapter does not affect the core event bus, state store, automation engine, or any other adapter. Integrations communicate with the core exclusively through the Integration API — `EventPublisher`, `EntityRegistry`, `StateQueryService`, `ConfigurationAccess` — never through shared mutable state. The API boundary is enforced at build time by Gradle module dependencies and JPMS module boundaries (LTD-17). See **Integration Runtime** (Doc 05) for the supervisor architecture and **Zigbee Adapter** (Doc 08) for the first concrete implementation.

**Behavior is explainable through causal chains.** Every event carries `correlation_id` and `causation_id` fields (LTD-05). When a motion sensor triggers an automation that turns on a light, the entire chain — `state_reported` → `state_changed` → `automation_triggered` → `command_issued` → `command_dispatched` → `command_result` → `state_reported` → `state_changed` — shares a single correlation ID. The Observability subsystem's TraceQueryService (Doc 11) assembles these chains into navigable trees. The Web UI (Doc 13) renders them as visual timelines. A user asking "why did the porch light turn on at 3 AM?" gets a concrete, traceable answer.

**The architecture designs for the full vision; implementation delivers Tier 1.** The device model supports multi-protocol from day one (INV-CE-04). The event bus accommodates high-frequency telemetry streams. The entity model includes person and presence types. The automation engine schema includes time-based triggers. None of these are implemented in Tier 1 MVP. They are accommodated — the architecture does not preclude them, and the interfaces do not need to change when they arrive. See §3.7 for the tier model.

**Configuration has sensible defaults; zero-configuration produces a running system.** Every subsystem defines configuration under a YAML namespace with typed defaults and JSON Schema validation (Doc 06, INV-CE-02). HomeSynapse starts and runs correctly with an empty configuration file. Configuration knobs exist for tuning, not for basic operation.

---

## 2. Scope and Boundaries

### 2.1 What Tier 1 MVP Delivers

The Tier 1 MVP proves the thesis stated in the Project MVP document (§4): HomeSynapse's event-sourced, local-first architecture produces a smart home runtime that is correct, observable, and reliable on constrained hardware.

The concrete delivery is:

- **Core runtime:** Event bus with write-ahead persistence, in-memory state projection with checkpoint recovery, SQLite-backed event store and telemetry ring store, YAML configuration with JSON Schema validation, seven-phase startup with systemd integration and graceful shutdown.
- **Device model:** Protocol-agnostic entity identity, typed capability system, command validation with expected outcomes and confirmation tracking, device discovery and adoption pipeline.
- **Integration runtime:** Fault-isolated adapter supervision with health state machine, hybrid thread architecture (platform threads for serial I/O, virtual threads for protocol logic), resource monitoring.
- **Zigbee adapter:** CC2652 (Z-Stack ZNP) and EFR32 (EmberZNet EZSP) coordinator support, standard ZCL cluster handling, Tuya and Xiaomi manufacturer-specific codecs, mesh topology monitoring.
- **Automation engine:** Trigger-Condition-Action model with edge-triggered and level-triggered evaluation, sequential action execution on virtual threads, command dispatch with confirmation tracking, cascade governance with depth limiting.
- **APIs:** REST API with entity state queries, command issuance, event history, automation management, and system health. WebSocket API with subscription-based real-time event streaming, checkpoint-based resume, and backpressure management.
- **Web UI:** Preact SPA served as pre-built static files, displaying system health, live event stream, causal chain traces, and basic device state. Bundle budget: 100 KB gzipped.
- **Observability:** JFR continuous recording, structured JSON logging, health aggregation across all subsystems, causal chain trace queries.

### 2.2 What Tier 1 MVP Does Not Deliver

- Z-Wave, Matter, MQTT, Wi-Fi, or Bluetooth protocol adapters
- Energy monitoring integrations
- Network-based or BLE-based presence detection
- Time-based automation triggers (schema accommodated, implementation deferred)
- Template expressions in automation actions
- Multi-user household model (entity schema accommodated, implementation deferred)
- Device pairing UI, visual automation editor, configuration editor
- TLS for API endpoints (LAN-only in Tier 1)
- Remote access, cloud relay, mobile app
- Backup/restore UI (CLI-driven per LTD-14)
- AI-assisted automations, voice control, camera/RTSP

### 2.3 Acceptance Criteria

Per MVP §4, the Tier 1 acceptance test requires:

- 50 Zigbee devices, stable for 72+ hours on Raspberry Pi 5 (Pi 4 as validation floor)
- `kill -9` recovery with zero event loss
- Integration crash isolation demonstrated (kill adapter, verify core and other integrations unaffected)
- Event trace answers "why did this happen?" for any device state change
- All performance targets in §10 met

---

## 3. Architecture

### 3.1 System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                         HomeSynapse Core                             │
│                     (Single JVM Process, Java 21)                    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    Startup & Lifecycle (Doc 12)                  │ │
│  │         Seven-phase init · systemd watchdog · graceful stop     │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │  Event Model  │  │ Device Model │  │   Configuration System   │  │
│  │  & Event Bus  │  │ & Capability │  │                          │  │
│  │   (Doc 01)    │  │   (Doc 02)   │  │        (Doc 06)          │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                  │                        │                │
│  ┌──────┴───────┐  ┌──────┴───────┐                │                │
│  │  Persistence  │  │ State Store  │                │                │
│  │    Layer      │  │ & Projection │                │                │
│  │   (Doc 04)    │  │   (Doc 03)   │                │                │
│  └──────────────┘  └──────────────┘                │                │
│                                                     │                │
│  ┌──────────────────────────────────────────────────┴─────────────┐ │
│  │                    Automation Engine (Doc 07)                    │ │
│  │    Triggers · Conditions · Actions · Command Pipeline · Runs    │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                  Integration Runtime (Doc 05)                    │ │
│  │      IntegrationSupervisor · Health FSM · Resource Monitoring    │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │ │
│  │  │   Zigbee     │  │   (Z-Wave)   │  │   (Energy Monitor)   │  │ │
│  │  │   Adapter    │  │   Tier 2     │  │      Tier 2          │  │ │
│  │  │  (Doc 08)    │  │              │  │                      │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐  │
│  │   REST API   │  │ WebSocket API │  │  Web UI (Observability)  │  │
│  │   (Doc 09)   │  │   (Doc 10)    │  │       (Doc 13)           │  │
│  └──────────────┘  └───────────────┘  └──────────────────────────┘  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │              Observability & Debugging (Doc 11)                  │ │
│  │     JFR Recording · Health Aggregation · Trace Query Service    │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 Subsystem Catalog

**Event Model & Event Bus (Doc 01)** defines the immutable event envelope, the event type taxonomy, the append-only event store backed by SQLite WAL, and the in-process event bus that distributes events to subscribers. It owns the three-phase event lifecycle (production → persistence → distribution), seven core subscribers, and the at-least-once delivery contract with per-entity ordering. Every other subsystem depends on it. See Doc 01 for the envelope schema, subscriber model, and persistence contract.

**Device Model & Capability System (Doc 02)** defines what a device is, what an entity is, what capabilities they expose, what commands they accept, and how devices are discovered and adopted. It owns the Device Registry, Entity Registry, Capability Registry, the command validation pipeline, and the device replacement service. It provides the semantic translation layer between protocol-specific integration adapters and the protocol-agnostic core. See Doc 02 for the entity type system, capability contracts, and discovery pipeline.

**State Store & State Projection (Doc 03)** maintains the current state of all enabled entities as an in-memory materialized view over the event stream. It consumes `state_reported` events, derives `state_changed` events (detecting actual value transitions), and provides the `StateQueryService` interface that the REST API, Automation Engine, and Web UI depend on for responsive state lookups. It owns checkpoint creation for fast startup recovery. See Doc 03 for the projection pipeline, staleness model, and REPLAY→LIVE transition.

**Persistence Layer (Doc 04)** owns how data is stored, managed, and maintained across years of continuous operation. It manages the domain event store, the telemetry ring store for high-frequency numeric samples, the checkpoint infrastructure, the aggregation engine that promotes telemetry threshold crossings to domain events, and all maintenance operations: retention passes, incremental vacuum, integrity checks, and automated backups. See Doc 04 for the SQLite PRAGMA configuration, retention policies, and storage pressure model.

**Integration Runtime (Doc 05)** supervises all integration adapters within the HomeSynapse process. It owns adapter lifecycle management (initialize → run → close), the health state machine (HEALTHY → DEGRADED → SUSPENDED → FAILED), the hybrid thread architecture that assigns platform threads for serial I/O and virtual threads for protocol logic, and the IntegrationContext API surface through which adapters interact with the core. See Doc 05 for the supervisor architecture, exception classification, and restart intensity model.

**Configuration System (Doc 06)** translates YAML configuration files into validated, typed runtime state. It owns the six-stage loading pipeline (file read → YAML parse → tag resolution → default merge → schema validation → model construction), the AES-256-GCM encrypted secret store, runtime schema composition from core and integration schemas, hot reload with atomic swap, and configuration migration for schema evolution. See Doc 06 for the validation error model, reload classification, and secret store architecture.

**Automation Engine (Doc 07)** implements the Trigger-Condition-Action model. It owns the Automation Registry, trigger evaluation (matching incoming events against registered triggers), condition evaluation (boolean guards against current state), action execution (sequential commands on per-Run virtual threads), the Command Dispatch Service (routing commands to adapters), and the Pending Command Ledger (tracking command confirmation with expected outcomes). It enforces cascade governance with configurable depth limits. See Doc 07 for the Run lifecycle state machine, conflict detection, and concurrency modes.

**Zigbee Adapter (Doc 08)** is the first protocol integration, validating the Integration Runtime's abstract interfaces against real Zigbee hardware. It owns the coordinator transport abstraction (Z-Stack ZNP over UNPI framing and EmberZNet EZSP over ASH framing), the ZCL cluster-to-capability mapping, manufacturer-specific codecs for Tuya and Xiaomi devices, the device interview pipeline, and per-device availability tracking. It communicates with coordinators over USB serial on a dedicated platform thread. See Doc 08 for the protocol layer architecture, frame correlation model, and network telemetry.

**REST API (Doc 09)** exposes the event-sourced internals through standard HTTP semantics. It owns entity state queries, command issuance with four-phase lifecycle tracking, event history with cursor-based pagination, automation management, and system health endpoints. It makes consistency models explicit: every state query includes projection version, every command response includes a trackable identifier. See Doc 09 for the endpoint catalog, ETag strategy, and rate limiting model.

**WebSocket API (Doc 10)** provides persistent bidirectional streaming for real-time event delivery. It owns the Event Relay (a single Event Bus subscriber that evaluates per-client filters), connection management with authentication and backpressure, subscription-based event filtering with checkpoint-based resume semantics, and the four-stage backpressure escalation (NORMAL → BATCHED → COALESCED → close). See Doc 10 for the message protocol, replay delivery, and connection lifecycle.

**Observability & Debugging (Doc 11)** owns the infrastructure all subsystems report into. It manages JFR continuous recording with custom application-level events, the HealthAggregator that composes individual subsystem health states into a tiered system health picture, and the TraceQueryService that assembles causal chains from correlation IDs into navigable trees. See Doc 11 for the health tier model, flapping prevention, and metrics stream bridge.

**Startup, Lifecycle & Shutdown (Doc 12)** owns process-level lifecycle. It orchestrates the seven-phase initialization sequence from cold start, maintains the runtime watchdog protocol with systemd, and executes graceful shutdown in reverse phase order preserving data integrity. It defines two platform abstraction interfaces — `HealthReporter` (lifecycle health reporting across platform supervisors) and `PlatformPaths` (OS-specific directory conventions) — that isolate HomeSynapse from deployment-specific concerns. See Doc 12 for the phase model, subsystem dependency ordering, and unclean shutdown reconciliation.

**Web UI — Observability MVP (Doc 13)** is the primary user-facing observability interface. It is a Preact single-page application served as pre-built static files from Javalin, consuming the REST API and WebSocket API. It displays real-time system health, a live event stream with virtual scrolling, causal chain trace timelines, and per-device state views. It ships inside the jlink distribution and is served to LAN browsers at `/dashboard/`. See Doc 13 for the component architecture, bundle budget enforcement, and charting strategy.

### 3.3 Data Flow

An event flows from a physical device through the system to the dashboard in the following path:

```
Physical Device (e.g., Zigbee motion sensor)
       │
       │  Radio frame (ZCL attribute report)
       ▼
┌──────────────┐
│  Coordinator │  CC2652/EFR32 USB dongle
│  (Hardware)  │
└──────┬───────┘
       │  Serial bytes (UNPI/ASH framing)
       ▼
┌──────────────┐
│   Zigbee     │  Platform thread: frame decode, CRC verify
│   Adapter    │  Virtual thread: ZCL parse, cluster→capability map
│  (Doc 08)    │  Produces: state_reported event via EventPublisher
└──────┬───────┘
       │  EventPublisher.publish(stateReported, causalContext)
       ▼
┌──────────────┐
│  Event Store │  SQLite WAL append (single writer)
│  (Doc 01/04) │  Assigns global_position, subject_sequence
│              │  Event is now DURABLE — survives kill -9
└──────┬───────┘
       │  LockSupport.unpark() to all subscribers
       ▼
┌──────────────────────────────────────────────────────┐
│              Event Bus Subscriber Fan-Out             │
│                                                      │
│  ┌─────────────────┐  state_reported consumed        │
│  │ State Projection │──▶ Detects value change         │
│  │    (Doc 03)      │──▶ Produces state_changed event │
│  └─────────────────┘                                 │
│                                                      │
│  ┌─────────────────┐  state_changed consumed         │
│  │ Automation Engine│──▶ Trigger evaluation           │
│  │    (Doc 07)      │──▶ Condition check (StateQuery) │
│  │                  │──▶ Action execution (commands)   │
│  └─────────────────┘                                 │
│                                                      │
│  ┌─────────────────┐  state_changed consumed         │
│  │ Causal Chain    │──▶ Updates correlation index     │
│  │ Projection      │                                 │
│  └─────────────────┘                                 │
│                                                      │
│  ┌─────────────────┐  All events consumed            │
│  │ WebSocket Relay │──▶ Per-client filter evaluation  │
│  │    (Doc 10)      │──▶ JSON frame to browser        │
│  └─────────────────┘                                 │
│                                                      │
│  ┌─────────────────┐  All events consumed            │
│  │ Observability   │──▶ JFR event emission           │
│  │ Collector       │──▶ Metrics aggregation          │
│  └─────────────────┘                                 │
└──────────────────────────────────────────────────────┘
       │
       │  WebSocket JSON frame
       ▼
┌──────────────┐
│   Web UI     │  EventStream component renders event
│  (Doc 13)    │  HealthCard updates if health changed
│              │  TraceTimeline available via correlation_id
└──────────────┘
```

The entire path from radio frame to dashboard render — excluding radio propagation and device processing time — targets sub-second latency. The critical segments: Zigbee attribute report processing < 15 ms (Doc 08 §10), event append < 10 ms (Doc 01 §10), subscriber notification < 5 ms (Doc 01 §10), state change derivation < 2 ms (Doc 03 §10), WebSocket relay to client frame < 10 ms (Doc 10 §10).

### 3.4 Initialization Sequence Summary

HomeSynapse Core starts through the seven-phase model defined in **Startup, Lifecycle & Shutdown** (Doc 12):

**Phase 0 — BOOTSTRAP.** JVM starts with LTD-01 flags (`-Xms512m -Xmx1536m`, G1GC, AppCDS). PlatformPaths resolves OS-specific directories. Logging initializes (Logback + logstash-logback-encoder). JFR continuous recording starts. HealthReporter initializes (SystemdHealthReporter sends `STATUS=Bootstrapping`).

**Phase 1 — FOUNDATION.** Configuration System (Doc 06) loads and validates `config.yaml` through its six-stage pipeline. Migration check runs if schema version changed.

**Phase 2 — DATA_INFRA.** Persistence Layer (Doc 04) opens SQLite databases, applies PRAGMAs (WAL mode, synchronous=NORMAL, page cache, mmap), runs any pending migrations with mandatory pre-migration backup, executes quick integrity check. Event Bus (Doc 01) initializes subscriber dispatch. Unclean shutdown marker written.

**Phase 3 — CORE_DOMAIN.** Device Model (Doc 02) loads device, entity, and capability registries from checkpoints. State Store (Doc 03) recovers from checkpoint and replays events since checkpoint position, executes REPLAY→LIVE transition. Automation Engine (Doc 07) loads automation definitions, builds trigger index, recovers Pending Command Ledger from subscriber checkpoint.

**Phase 4 — OBSERVABILITY.** HealthAggregator (Doc 11) collects HealthContributor registrations from all initialized subsystems, begins aggregation.

**Phase 5 — EXTERNAL_IFACE.** REST API (Doc 09) and WebSocket API (Doc 10) start on the shared Javalin HTTP server. Web UI static files become available at `/dashboard/`. HealthReporter sends `READY=1` to systemd.

**Phase 6 — INTEGRATIONS.** IntegrationSupervisor (Doc 05) discovers and starts adapters via ServiceLoader. Zigbee Adapter (Doc 08) opens serial port, initializes coordinator, begins device communication. Integration startup is intentionally last — adapters producing events before the core is ready to process them would violate ordering guarantees.

**Cold start target:** < 15 seconds on RPi 5, < 30 seconds on RPi 4 (Doc 12 §10). State checkpoint recovery dominates startup cost.

### 3.5 Memory Budget

This section compiles per-subsystem memory estimates from each document's §10 and defines the INV-PR-02 measurement methodology.

#### 3.5.1 JVM Heap Budget

JVM configured with `-Xms512m -Xmx1536m` (LTD-01).

| Subsystem | Estimate | Source | Notes |
|---|---|---|---|
| Event Bus | ~10 MB | Doc 01 §10 | Per-subscriber overhead < 5 MB × ~7 core subscribers, shared structures |
| Device Model | ~5 MB | Doc 02 §10 | 50 devices, ~150 entities in registries |
| State Store | ~10 MB | Doc 03 §10 | EntityState records in ConcurrentHashMap at MVP scale |
| Persistence (JVM-side) | ~5 MB | Doc 04 §10 | JDBC driver, statement caches, maintenance buffers |
| Integration Runtime | ~10 MB | Doc 05 §10 | Supervisor structures, per-integration < 20 MB framework overhead |
| Configuration System | ~5 MB | Doc 06 §10 | ConfigModel < 500 KB, composed schema < 200 KB, validation structures |
| Automation Engine | ~50 MB | Doc 07 §10 | Registry, trigger index, 200 concurrent Runs, Pending Command Ledger, 3 subscribers |
| Zigbee Adapter | ~30 MB | Doc 08 §10 | 50 devices: profiles, cluster handlers, frame queues, transport buffers |
| REST API | ~20 MB | Doc 09 §10 | HTTP server buffers, Jackson ObjectReader/ObjectWriter, rate limiter |
| WebSocket API | ~15 MB | Doc 10 §10 | 20 connections × < 256 KB each, relay subscriber, filter state |
| Observability | ~10 MB | Doc 11 §3, §10 | HealthAggregator, TraceQueryService caches, MetricsStreamBridge queue (JFR native memory accounted separately in §3.5.2) |
| Lifecycle | ~5 MB | Doc 12 §10 | Lightweight orchestration structures, phase state |
| Web UI | ~0 MB | Doc 13 | Static files served from classpath; no heap allocation beyond Javalin serving |
| **Subtotal (JVM heap)** | **~175 MB** | | |

Against `-Xmx1536m`, this leaves approximately **1,361 MB** for GC headroom, class metadata, JIT-compiled code, thread stacks, and transient allocations during event processing, serialization, and query evaluation.

#### 3.5.2 Native Memory (Outside JVM Heap)

| Component | Estimate | Notes |
|---|---|---|
| SQLite page cache | 128 MB | Configured via PRAGMA cache_size (LTD-03) |
| SQLite mmap | up to 1 GB | Virtual address space; resident pages depend on working set |
| Serial I/O buffers | ~1 MB | Platform thread stack + jSerialComm native buffers |
| JFR recording | ~25 MB native memory, ≤ 256 MB disk | Global buffers + metadata + active chunk (Doc 11 §10); disk I/O to NVMe |
| Logback buffers | ~5 MB | Async appender queue + encoder buffers |
| JVM metaspace | ~50–80 MB | Class metadata, method data, interned strings |
| Thread stacks | ~20 MB | ~40 platform/carrier threads × 512 KB |
| **Subtotal (native)** | **~230–260 MB resident** + up to 1 GB virtual (mmap) | |

#### 3.5.3 Total RSS Estimate and INV-PR-02 Measurement Methodology

**INV-PR-02 defines "steady-state memory < 512 MB."** This target applies to **live heap after a major GC cycle**, not to total RSS.

**Measurement methodology:**

1. **Metric:** Live heap size immediately following a G1 Full GC or concurrent marking cycle completion.
2. **Data source:** JFR GC events (`jdk.GCHeapSummary` at GC end). The `heapUsed` field after a collection with `gcId` corresponding to a G1 Old Generation or Full GC event.
3. **Steady-state definition:** System running for ≥ 1 hour with ≥ 50 active Zigbee devices producing events at typical reporting intervals (~5 events/minute aggregate). No startup replay in progress. No retention pass executing.
4. **Threshold:** If post-GC live heap exceeds 512 MB under steady-state conditions, this is a performance investigation trigger per MVP §8.2.

**Total RSS will be higher than live heap.** At steady state, expected total RSS is approximately 650–850 MB: ~175 MB live heap + ~200 MB GC headroom and transient allocations + ~128 MB SQLite page cache + ~50–80 MB metaspace + ~20 MB thread stacks + ~25 MB JFR + ~5 MB Logback + variable mmap resident pages. The systemd `MemoryMax=2G` cgroup (LTD-13) provides the hard ceiling, leaving ~1.2 GB for the operating system and other services on a 4 GB Raspberry Pi.

**What the 512 MB target excludes:** SQLite mmap pages (virtual, demand-paged by the kernel, evictable under memory pressure), JFR disk repository (not memory-resident), Logback log files on disk.

#### 3.5.4 Contingency

If Phase 3 empirical measurement reveals live heap exceeding 512 MB:

1. Identify the largest contributors via JFR allocation profiling.
2. Determine whether estimates contain tightenable conservatism (many subsystem estimates include 2–5× headroom above expected working sets).
3. Tune configuration: reduce subscriber queue depths, lower max concurrent automation Runs, reduce SQLite page cache.
4. If configuration tuning is insufficient, escalate to LTD-01 amendment discussion (adjust `-Xmx`).

### 3.6 Gradle Module Map

The following module structure maps each subsystem to its Gradle module, organized by architectural layer. Module dependencies are acyclic. Integration modules depend on `integration-api` but never on `core/` modules directly (LTD-17).

```
homesynapse-core/
├── build-logic/                        # Convention plugins (included build)
│
├── platform/
│   ├── platform-api/                   # HealthReporter, PlatformPaths interfaces
│   └── platform-systemd/              # SystemdHealthReporter, LinuxSystemPaths
│
├── core/
│   ├── event-model/                    # Event types, envelope, EventPublisher interface
│   ├── device-model/                   # Device, Entity, Capability types + registries
│   ├── state-store/                    # StateProjection, StateQueryService
│   ├── persistence/                    # EventStore, TelemetryStore, migrations
│   ├── event-bus/                      # InProcessEventBus, subscriber dispatch
│   └── automation/                     # AutomationRegistry, RunManager, trigger index
│
├── integration/
│   ├── integration-api/                # IntegrationAdapter, IntegrationContext, etc.
│   ├── integration-runtime/            # IntegrationSupervisor, health, restart
│   └── integration-zigbee/            # ZigbeeAdapter (depends on integration-api ONLY)
│
├── config/
│   └── configuration/                  # ConfigurationService, SecretStore, schemas
│
├── api/
│   ├── rest-api/                       # Javalin REST endpoints
│   └── websocket-api/                  # WebSocket relay, subscription management
│
├── observability/
│   └── observability/                  # HealthAggregator, TraceQueryService, JFR events
│
├── web-ui/
│   └── dashboard/                      # Pre-built static files (Preact SPA, Vite output)
│
├── lifecycle/
│   └── lifecycle/                      # SystemLifecycleManager, startup/shutdown
│
└── app/
    └── homesynapse-app/                # Main class, jlink distribution, systemd unit
```

#### Module Dependency Rules

1. **`integration-zigbee` depends on `integration-api` only.** It does not depend on `core/event-model`, `core/device-model`, or any other core module. All interaction with the core flows through the `IntegrationContext` interfaces defined in `integration-api`. This enforces LTD-17.
2. **`core/` modules may depend on other `core/` modules** according to the subsystem dependency graph (e.g., `state-store` depends on `event-model` and `device-model`). No circular dependencies exist.
3. **`platform-api/` has zero dependencies** on any HomeSynapse module. `platform-systemd/` depends only on `platform-api/`.
4. **`homesynapse-app/` depends on everything** — it is the assembly module that wires subsystems together.
5. **`dashboard/` has no compile-time Java dependencies.** It contains only pre-built static files produced by the Vite build.
6. **Build-time enforcement:** `modules-graph-assert` Gradle plugin (LTD-10) verifies the dependency graph on every build. ArchUnit tests verify that code in `integration-zigbee` does not import from `core/` packages. JPMS `module-info.java` files restrict package visibility.

#### Companion Tier Module Sharing (Future)

For the Companion tier (phone/tablet thin client), only type-definition modules are shared: `event-model` (event records, sealed interfaces), `device-model` (device/entity/capability types), a `serialization` module (Jackson configuration), and an `api-client` module (REST and WebSocket client). No hub-only modules (`event-bus`, `state-store`, `persistence`, `automation`, `integration-runtime`) are included. This extraction path is accommodated by the module structure but not implemented in Tier 1.

### 3.7 Tier Model

The deployment tier model formalizes six tiers from the Portability Architecture research (v1). Only Tier 1 (Constrained) is implemented in Tier 1 MVP. The architecture accommodates all tiers without structural rework.

| Tier | Product | Hardware | Scale | Status |
|---|---|---|---|---|
| **Constrained** | HomeSynapse Hub | RPi 4/5, 4 GB RAM, NVMe | 10–50 devices, single protocol | **Tier 1 MVP** |
| **Standard** | HomeSynapse Hub | Mini-PC / NUC, 8–16 GB | 50–200 devices, multiple protocols | Tier 2 |
| **Enhanced** | HomeSynapse Server | x86-64 server or VM, 16+ GB | 200–1,000 devices | Tier 3 |
| **Companion** | HomeSynapse App | Phone/tablet, 4–8 GB | Thin client (no hub duties) | Post-Tier 1 |
| **Enterprise** | NexSys Energy | x86-64 server, 32+ GB | Energy management product | Post-Tier 1 |
| **Multi-instance** | Coordinated hubs | Mixed | Multiple hubs | Post-Tier 1 |

The tier model is additive: each higher tier includes everything from lower tiers plus additional capacity. The Companion tier is orthogonal — it is a client that connects to a hub, not a hub itself.

Three abstraction interfaces enable portability across tiers without code changes to subsystem logic: `HealthReporter` (lifecycle health reporting: systemd, Docker HEALTHCHECK, no-op), `PlatformPaths` (directory conventions: FHS Linux, XDG, macOS, Windows, Docker, Android), and `AdaptivePragmaConfig` (SQLite PRAGMA tuning per detected hardware). See Doc 12 §8 for `HealthReporter` and `PlatformPaths` interface contracts; Portability Architecture §7 for `AdaptivePragmaConfig`.

### 3.8 CI/CD Testing Matrix

Four tiers of testing from the Portability Architecture research (v1 §8):

**Tier 1 — Fast Feedback (every push, < 5 minutes).** Compile (Java 21, Linux x86-64). Unit tests (all modules). Architecture tests (ArchUnit + `modules-graph-assert`). Static analysis (Checkstyle, SpotBugs).

**Tier 2 — Platform Matrix (every PR merge, < 15 minutes).** Unit tests across Linux x86-64, Linux ARM64, macOS ARM64, Windows x86-64 — all on Temurin 21. Integration tests (SQLite WAL behavior per platform). jlink image build for Linux x86-64 and Linux ARM64. Docker image build and smoke test.

**Tier 3 — Hardware Validation (nightly, < 60 minutes).** Full test suite on RPi 5 (self-hosted runner). Performance benchmarks on RPi 5: event throughput, state query latency, automation trigger-to-action. JFR recording analysis for memory and GC regression. One-hour stability soak test. SQLite WAL checkpoint performance comparison (NVMe vs SD card).

**Tier 4 — Release Qualification (per release candidate, < 4 hours).** 72-hour stability test on RPi 5 (MVP §8.1). Full platform matrix with GraalVM JDK 21. Docker and Kubernetes deployment smoke test. jlink distribution validation per target platform. Upgrade path test (previous release → candidate). Real Zigbee hardware integration test on RPi 5.

---

## 4. Data Model

This document does not define new data structures. This section provides cross-cutting registries summarizing data types defined across all 13 subsystem designs.

### 4.1 Event Type Registry Summary

Events follow the dotted-notation taxonomy defined in Doc 01 §3. Event types are organized by domain:

| Domain | Event Types | Producer(s) | Priority | Categories |
|---|---|---|---|---|
| **device** | `state_reported`, `state_changed`, `availability_changed` | Integration adapters (state_reported, availability_changed); State Store (state_changed) | NORMAL | device_state |
| **device.discovery** | `device_discovered`, `device_adopted`, `device_removed`, `entity_profile_changed`, `entity_type_changed`, `state_report_rejected` | Integration adapters (discovered); Device Model (adopted, removed, profile/type changed) | NORMAL | device_state |
| **command** | `command_issued`, `command_dispatched`, `command_result`, `state_confirmed` | Automation Engine (issued); Command Dispatch Service (dispatched); Integration adapters (result); Pending Command Ledger (confirmed) | NORMAL | device_state, automation |
| **automation** | `automation_triggered`, `automation_completed`, `automation_conflict_detected`, `automation_disabled`, `automation_run_skipped`, `automation_run_cancelled` | Automation Engine | NORMAL | automation |
| **config** | `config_changed`, `config_error` | Configuration System | NORMAL (changed), DIAGNOSTIC (error) | system |
| **integration** | `integration_started`, `integration_stopped`, `integration_health_changed`, `integration_restarted` | Integration Runtime | NORMAL | system |
| **presence** | `presence_signal`, `presence_changed` | Integration adapters (signal); Presence Projection (changed) | NORMAL | presence |
| **system** | `system_starting`, `system_ready`, `system_stopping`, `system_stopped`, `unclean_shutdown_detected` | Lifecycle Manager | CRITICAL (starting, ready, stopping, stopped, unclean) | system |
| **telemetry** | Telemetry samples (high-frequency numeric) | Integration adapters | Written directly to TelemetryStore, not via Event Bus | device_state, energy |

### 4.2 Configuration Namespace Registry Summary

Every subsystem defines configuration under its own YAML namespace. The full list prevents key conflicts and feeds Phase 2 JSON Schema composition:

| Namespace | Owner Doc | Key Purpose |
|---|---|---|
| `event_model` | Doc 01 | Event store path, WAL limits, retention periods, bus coalesce thresholds, pending command settings |
| `device_model` | Doc 02 | Discovery settings, capability validation, confirmation timeouts, orphan management |
| `state_store` | Doc 03 | Checkpoint intervals, max entity count, staleness thresholds |
| `persistence` | Doc 04 | Retention schedules, telemetry ring sizing, aggregation settings, backup configuration, maintenance schedules |
| `integration_runtime` | Doc 05 | Supervisor timeouts, health defaults, HTTP client limits, per-integration overrides |
| `config_system` | Doc 06 | Config/secrets file paths, reload settings, schema output, migration settings |
| `automation` | Doc 07 | Batch size, max Runs, cascade depth, command pipeline settings, auto-disable thresholds |
| `integrations.zigbee` | Doc 08 | Serial port, channel, permit-join duration, watchdog, availability timeouts, topology scan |
| `api` | Doc 09 | Host, port, base path, rate limiting, CORS, pagination, idempotency, request logging |
| `websocket` | Doc 10 | Path, max connections, auth timeout, ping/pong, backpressure thresholds, replay limits |
| `observability` | Doc 11 | JFR settings, health grace periods, trace limits, storage monitoring, stream bridge |
| `lifecycle` | Doc 12 | Shutdown grace period, startup timeout, health check interval, integration start delay |
| `dashboard` | Doc 13 | Enabled flag, path, event stream buffer, chart defaults, WebSocket reconnection |

---

## 5. Contracts and Invariants

This section consolidates the cross-cutting behavioral contracts that span multiple subsystems. For subsystem-specific contracts, see each document's §5.

**Write-ahead persistence contract (Docs 01, 04, 06).** An event returned from `EventPublisher.publish()` is durable in SQLite WAL storage. If the process is killed (`kill -9`) or power is lost at any point after the publish call returns, the event will be present in the event store when the system restarts. This contract is the foundation of the zero-event-loss guarantee (INV-ES-04, INV-RF-04). The Configuration System produces `config_changed` events through the same path, ensuring configuration changes are also durable before taking effect.

**At-least-once delivery contract (Docs 01, 03, 07, 10).** Every subscriber receives every event at or above its priority filter, at least once. Subscribers maintain checkpointed positions against the global position. On restart, subscribers replay from their last checkpoint. Subscribers must be idempotent: the State Projection (Doc 03) uses entity-level `last_processed_version` tracking; the Automation Engine (Doc 07) uses correlation-based deduplication; the WebSocket Relay (Doc 10) uses position-based resume. See Doc 01 §5 for the full delivery contract.

**Per-entity ordering contract (Docs 01, 03, 05).** Events for a single entity are ordered by `subject_sequence` — a monotonically increasing counter per entity stream. Cross-entity ordering uses `global_position` (SQLite rowid) for total order and `correlation_id` + `causation_id` for causal chains. Integration adapters produce events through `EventPublisher`, which assigns sequence numbers atomically within the single-writer SQLite model (LTD-05). The State Projection processes events per-entity, rejecting out-of-sequence events.

**Integration isolation contract (Docs 05, 07, 08, 12).** A crashing integration adapter does not affect: the event bus, state store, automation engine, other adapters, or any API endpoint. The IntegrationSupervisor (Doc 05) manages adapter lifecycle independently. If an adapter throws an unhandled exception or fails its health check, it transitions through DEGRADED → SUSPENDED → FAILED states with configurable restart attempts (default: 3 restarts within 60 seconds). The core continues processing events from all other sources. Lifecycle events (`integration_health_changed`, `integration_restarted`) are produced for observability.

**State consistency contract (Docs 01, 03, 09, 10).** The State Store's view is consistent with the event log up to its `viewPosition`. Every state query through `StateQueryService` (consumed by REST API, WebSocket API, Automation Engine) includes the `viewPosition` at read time, enabling callers to reason about consistency. During startup replay, the State Store sets `isReplaying=true`; the REST API returns `503 Service Unavailable` with a `Retry-After` header, and the WebSocket API reports `DEGRADED` health. Once the REPLAY→LIVE transition completes and reconciliation finishes, the State Store is consistent with the live event stream.

**Command lifecycle contract (Docs 02, 07, 08, 09).** A command follows a four-phase lifecycle: `command_issued` (Automation Engine or REST API) → `command_dispatched` (Command Dispatch Service routes to adapter) → `command_result` (adapter reports success/failure) → `state_confirmed` (Pending Command Ledger matches expected outcome). All four phases produce events sharing a correlation ID. The REST API exposes command status through this chain. Timeout tracking is configurable per capability (Doc 02 §3.10, Doc 07 §3.11.2).

**Cascade governance contract (Docs 01, 07).** Automation cascades — where one automation's action triggers another automation — are governed by configurable depth limits (default: 8). The `cascade_depth` field in the causal chain projection (Doc 01 §4.5) tracks depth. When the limit is reached, the triggering event is suppressed for automation evaluation and an `automation_run_skipped` event with reason `cascade_depth_exceeded` is produced. Duplicate suppression within a correlation chain prevents infinite loops even below the depth limit.

---

## 6. Failure Modes and Recovery

This section consolidates system-level failure modes. For subsystem-specific failure handling, see each document's §6.

**Power loss during operation.** SQLite WAL mode with `synchronous=NORMAL` ensures events committed to the WAL survive power loss (Doc 04 §6). On restart, SQLite recovers the WAL automatically. The unclean shutdown marker (Doc 12 §3.2) triggers reconciliation: the State Store replays from its last checkpoint, the Pending Command Ledger rebuilds from the event log, and the Automation Engine reloads definitions and resubscribes. Events produced between the last subscriber checkpoints and the crash are replayed through normal at-least-once delivery. Expected recovery time: < 30 seconds on RPi 4, < 15 seconds on RPi 5.

**SD card fills up.** The Persistence Layer's storage pressure model (Doc 04 §3.9) monitors available space with four escalation levels: NORMAL → CAUTION (warning event) → PRESSURE (emergency retention, telemetry ring frozen) → CRITICAL (event store enters read-only, integration adapters suspended). Each level produces a diagnostic event. Recovery requires either manual cleanup or storage expansion. The retention policy (Doc 04 §3.5) prevents unbounded growth under normal operation: DIAGNOSTIC events retained 7 days, NORMAL events 90 days, CRITICAL events 365 days.

**Integration adapter crashes.** The IntegrationSupervisor (Doc 05) catches the exception, transitions the adapter to DEGRADED or FAILED state, and attempts restart per the configured restart intensity (default: 3 attempts within 60 seconds). If restart succeeds, the adapter re-initializes and resumes operation. If restart exhausts attempts, the adapter enters FAILED state and produces an `integration_health_changed` event. All other subsystems continue operating. Devices managed by the failed adapter become `UNAVAILABLE` through timeout-based availability tracking (Doc 08 §3.9).

**JNI native crash in serial I/O.** A segfault in the jSerialComm JNI layer crashes the entire JVM — this is a known limitation of in-process integration architecture (Doc 05 §6.8). systemd `Restart=on-failure` (LTD-13) restarts the process. Write-ahead persistence ensures zero event loss. The mitigation is defensive: serial I/O runs on a dedicated platform thread isolated from protocol logic, and the jSerialComm library is mature. Out-of-process integration (future tier) eliminates this risk category entirely.

**Event bus subscriber falls behind.** If a subscriber cannot keep pace with event production, its queue fills (bounded at 1,000 entries per Doc 01 §3.4). The event bus applies backpressure: subscriber queue full → events coalesced → subscriber reads directly from event store if gap exceeds threshold. The WebSocket relay (Doc 10) has its own four-stage escalation: NORMAL → BATCHED → COALESCED → close. Subscribers that fall behind never block the event store or other subscribers — the single-writer model and per-subscriber queues guarantee this.

**Configuration file corrupted or invalid.** The Configuration System (Doc 06) validates the parsed YAML against the composed JSON Schema. FATAL validation errors abort startup with a clear error message. ERROR-level issues apply defaults and produce `config_error` diagnostic events. A corrupted file that cannot be parsed as YAML triggers FATAL with the parse error location. The comment-preserving write path (Doc 06 §3.5) maintains backup copies of prior configurations.

**Network partition (WAN outage).** HomeSynapse operates identically without internet (INV-LF-01). All device communication uses local protocols (Zigbee radio in Tier 1). The REST API and WebSocket API serve LAN clients. Cloud-connected integrations (future tiers) degrade gracefully per INV-LF-03; local-only integrations are unaffected.

---

## 7. Interaction with Other Subsystems

The full subsystem interaction matrix. Direction is from the row subsystem's perspective: Produces = row publishes events consumed by column; Consumes = row subscribes to events from column; Calls = row calls an interface owned by column; Called by = row provides an interface consumed by column.

| | Event Bus | Device Model | State Store | Persistence | Integ. Runtime | Config | Automation | Zigbee | REST API | WebSocket | Observability | Lifecycle |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Event Bus** | — | | | Calls (SQLite) | | | | | Called by | Called by | Called by | Called by |
| **Device Model** | Produces | — | | | | | | | Called by | | | Called by |
| **State Store** | Consumes, Produces | Calls | — | Calls (checkpoint) | | | | | Called by | | | Called by |
| **Persistence** | Calls (store) | | Called by | — | Called by (telemetry) | Consumes (config) | | | | | | Called by |
| **Integ. Runtime** | Produces | Calls | Calls | Calls (telemetry) | — | Calls | | Manages | | | | Called by |
| **Config** | Produces | | | | Called by | — | Calls (listener) | | Called by | | | Called by |
| **Automation** | Consumes, Produces | Calls | Calls | | Calls (cmd handler) | Consumes (listener) | — | | Called by | | | Called by |
| **Zigbee** | Produces | Calls | Calls | Calls (telemetry) | Managed by | Calls | Called by (cmd) | — | | | | |
| **REST API** | Calls (query) | Calls | Calls | | Calls (health) | Calls | Calls | | — | Shares server | | Called by |
| **WebSocket** | Consumes | Calls | Calls | | | | | | Shares server | — | | Called by |
| **Observability** | Consumes (JFR) | | | | | | | | Called by | Called by | — | Called by |
| **Lifecycle** | Calls | Calls | Calls | Calls | Calls | Calls | Calls | | Calls | Calls | Calls | — |

**Key interaction patterns:**

- **Event Bus is the spinal cord.** 8 of 12 subsystems either produce or consume events through the bus. The bus mediates all state changes and cross-subsystem coordination.
- **Lifecycle is the conductor.** It calls every other subsystem during initialization and shutdown in strict phase order (Doc 12).
- **REST API and WebSocket API share the HTTP server.** Both bind to the same Javalin instance, share the API key authentication model, and share the `/api/v1` + `/ws/v1` versioned namespace (LTD-16).
- **Integration Runtime mediates all adapter interactions.** Adapters never call core subsystem interfaces directly; the IntegrationContext provides scoped, filtered views.

---

## 8. Key Interfaces

This section summarizes the public API surfaces that external consumers interact with. Internal subsystem interfaces (e.g., EventPublisher, StateQueryService) are documented in each subsystem's §8.

### 8.1 REST API Surface (Doc 09)

Base path: `/api/v1` (LTD-16). Authentication: API key via `Authorization: Bearer <key>` header.

| Endpoint Group | Key Endpoints | Description |
|---|---|---|
| Entities | `GET /entities`, `GET /entities/{entity_id}` | Entity listing with state, single entity detail |
| Devices | `GET /devices`, `GET /devices/{device_id}` | Device listing, device detail with entities |
| Commands | `POST /entities/{entity_id}/commands`, `GET /commands/{command_id}` | Command issuance, command lifecycle status |
| Events | `GET /events`, `GET /events/trace/{correlation_id}` | Event history with cursor pagination, causal chain trace |
| Automations | `GET /automations`, `GET /automations/{automation_id}` | Automation definitions, run history |
| System | `GET /system/health`, `GET /system/info`, `GET /system/integrations` | Health aggregation, system info, integration status |
| Capabilities | `GET /capabilities` | Capability registry listing |
| Config | `GET /config`, `POST /config/reload` | Configuration read, hot reload |

Response format: JSON. Error format: RFC 9457 Problem Details. Pagination: cursor-based with opaque tokens. ETags: derived from `viewPosition` (state endpoints) or `event_id` (event endpoints).

### 8.2 WebSocket Protocol (Doc 10)

Upgrade path: `/ws/v1` (LTD-16). Authentication: first message must be `authenticate` with API key.

Client-to-server messages: `authenticate`, `subscribe`, `unsubscribe`, `ping`.
Server-to-client messages: `auth_result`, `subscription_confirmed`, `events`, `state_snapshot`, `delivery_mode_changed`, `error`, `pong`, `subscription_ended`, `replay_queued`.

Subscriptions filter by event type, entity reference, area, label, entity type, capability, or priority. Each subscription includes optional `since_position` for checkpoint-based resume. Backpressure stages: NORMAL → BATCHED (32 KB) → COALESCED (64 KB) → close (128 KB).

### 8.3 Integration API (Docs 05, 17)

The Integration API is the contract between the core and integration adapters. Adapters implement `IntegrationFactory` and `IntegrationAdapter`. The core provides `IntegrationContext` containing:

| Interface | Purpose |
|---|---|
| `EventPublisher` | Produce domain events with causal context |
| `EntityRegistry` | Query device and entity records (scoped to integration) |
| `StateQueryService` | Query current entity state (scoped to integration) |
| `ConfigurationAccess` | Read integration configuration subtree |
| `SchedulerService` | Schedule periodic and delayed tasks |
| `CommandHandler` | Receive dispatched commands for this integration's devices |
| `HealthReporter` | Report health signals to supervisor |
| `TelemetryWriter` | Write high-frequency numeric samples to telemetry store |
| `ManagedHttpClient` | Resource-controlled HTTP client with rate limiting |

### 8.4 Configuration Schema (Doc 06)

User-facing configuration: YAML 1.2 at `/etc/homesynapse/config.yaml` (LTD-09). JSON Schema for validation published at `/etc/homesynapse/schema/config.schema.json`. Schema composed from core subsystem schemas and integration-registered schema fragments at startup. VS Code Red Hat YAML extension provides auto-completion against the published schema.

### 8.5 Web Dashboard (Doc 13)

Served at `/dashboard/` from the jlink distribution. Preact SPA consuming REST API and WebSocket API. Four views: System Overview (health dashboard), Service Detail (per-subsystem), Event Trace (live stream + causal chains), Device Detail (per-device state and history).

---

## 9. Configuration

The consolidated configuration reference below lists every namespace, its owner, and the key settings with defaults. For full configuration blocks with types, ranges, and rationale, see each subsystem's §9.

```yaml
# HomeSynapse Core — Configuration Reference
# All values shown are defaults. An empty config file produces
# a running system using these values.

event_model:
  store:
    path: "/var/lib/homesynapse/homesynapse-events.db"
    wal_size_limit_mb: 6                    # WAL auto-checkpoint trigger
    page_cache_mb: 128                      # SQLite PRAGMA cache_size
  retention:
    critical_days: 365                      # CRITICAL events kept 1 year
    normal_days: 90                         # NORMAL events kept 90 days
    diagnostic_days: 7                      # DIAGNOSTIC events kept 7 days
  bus:
    coalesce_backlog_threshold: 1000        # Queue depth before coalescing
    falling_behind_threshold: 10000         # Gap before subscriber bypasses queue
  pending_commands:
    confirmation_timeout_seconds: 30
    max_pending_per_entity: 10

device_model:
  discovery:
    auto_adopt: false                       # Manual adoption required by default
    proposal_ttl_hours: 168                 # Proposals expire after 7 days
  capabilities:
    allow_custom: true
  confirmation:
    default_timeout_ms: 5000
  validation:
    reject_untyped_values: true

state_store:
  checkpoint:
    interval_minutes: 5
    event_threshold: 1000
    min_interval_seconds: 30
  max_entity_count: 5000
  staleness_warning_ms: 5000

persistence:
  retention:
    schedule_time: "04:12"                  # Daily retention pass
    batch_size: 1000
  telemetry:
    max_rows: 100000                        # Circular buffer capacity
  aggregation:
    interval_minutes: 5
    enabled: true
  backup:
    schedule_time: "03:00"
    schedule_enabled: true
    retention_count: 3
  maintenance:
    wal_truncate_schedule: "weekly"
    quick_check_schedule: "daily"

integration_runtime:
  supervisor:
    default_init_timeout_seconds: 30
    default_shutdown_grace_seconds: 10
    health_check_interval_seconds: 30
  health_defaults:
    heartbeat_timeout_seconds: 120
    max_restarts: 3
    restart_window_seconds: 60

config_system:
  config_path: "/etc/homesynapse/config.yaml"
  secrets_path: "/etc/homesynapse/secrets.enc"
  secret_key_path: "/etc/homesynapse/.secret-key"
  reload_signal: "SIGHUP"
  schema_version: 1
  migration:
    auto_migrate: true

automation:
  max_total_runs: 200
  max_cascade_depth: 8
  auto_disable_failure_count: 5
  command_pipeline:
    default_confirmation_timeout_ms: 30000
    max_pending_commands: 500

integrations:
  zigbee:
    serial_port: auto                       # Auto-detect CC2652/EFR32
    channel: auto                           # Auto-select (default 15)
    permit_join_duration: 120
    watchdog_interval_seconds: 30
    availability:
      mains_timeout_minutes: 10
      battery_timeout_hours: 25

api:
  host: "0.0.0.0"
  port: 8080
  base_path: "/api/v1"
  rate_limit:
    enabled: true
    requests_per_minute: 300

websocket:
  path: "/ws/v1"
  max_connections: 50
  auth_timeout_seconds: 5
  ping_interval_seconds: 30
  backpressure:
    batched_threshold_kb: 32
    coalesced_threshold_kb: 64
    hard_ceiling_kb: 128

observability:
  jfr:
    enabled: true
    repository: "/var/homesynapse/jfr"
    max_size_mb: 256
    max_age_minutes: 360
  health:
    startup_max_duration_seconds: 120
    dwell_time_seconds: 10
  trace:
    max_chain_depth: 50

lifecycle:
  shutdown_grace_period_seconds: 30
  startup_timeout_per_subsystem_seconds: 60
  health_check_interval_seconds: 30

dashboard:
  enabled: true
  path: "/dashboard"
  event_stream:
    buffer_size: 10000
  charts:
    default_time_range: "1h"
```

---

## 10. Performance Targets

All targets measured on Raspberry Pi 5 (primary) with Pi 4 as validation floor. Targets are investigation triggers per MVP §8.2, not architecture revision triggers.

### 10.1 Constitutional Targets (INV-PR-02, MVP §8)

These targets are defined in the Architecture Invariants (INV-PR-02) and the Project MVP document (§8.1 Hard Invariants, §8.2 Budget Goals). They are non-negotiable:

| Metric | Target | Source |
|---|---|---|
| Startup to functional dashboard | < 10 seconds | INV-PR-02 |
| End-to-end device command (local) | < 300 ms | INV-PR-02 |
| Automation evaluation (p99) | < 100 ms | INV-PR-02 |
| REST API response (p99) | < 50 ms | INV-PR-02 |
| Dashboard initial load | < 500 ms | INV-PR-02 |
| Steady-state memory (live heap post-GC) | < 512 MB | INV-PR-02 |

### 10.2 Consolidated Subsystem Targets (Constrained Tier)

| Metric | Target | Owner | Rationale |
|---|---|---|---|
| Event append latency (p99) | < 10 ms | Doc 01 | Write-path budget within 50 ms trigger-to-action |
| Event append throughput (sustained) | > 500 events/sec | Doc 01 | 10× expected peak for 50-device home |
| Subscriber notification latency (p99) | < 5 ms after persistence | Doc 01 | Combined with append determines event-to-subscriber speed |
| Full event log replay | > 10,000 events/sec | Doc 01 | One year of data replayed in < 3 minutes |
| Attribute validation latency (p99) | < 0.5 ms | Doc 02 | Hot path for every state_reported event |
| State query, single entity (p99) | < 1 ms | Doc 03 | ConcurrentHashMap lookup |
| State query, full snapshot (p99) | < 5 ms | Doc 03 | O(N) map copy at 150 entities |
| Checkpoint write duration (p99) | < 500 ms | Doc 03/04 | Must not block event processing |
| Telemetry write throughput | > 1,000 samples/sec | Doc 04 | 8 circuits at 1 Hz with 10× headroom |
| Adapter initialization (p99) | < 5 seconds | Doc 05 | Must not block other adapters |
| Config load + validate (startup) | < 200 ms (p99) | Doc 06 | Critical startup path |
| Trigger evaluation (p99) | < 10 ms per event | Doc 07 | Sub-second automation response |
| Zigbee attribute report (p99) | < 15 ms | Doc 08 | Frame decode through event production |
| Zigbee command round-trip (p99) | < 500 ms | Doc 08 | Includes radio propagation and device response |
| REST entity state query | < 5 ms | Doc 09 | Dashboard responsiveness |
| REST concurrent throughput | > 200 req/sec sustained | Doc 09 | Virtual threads, WAL concurrency |
| WebSocket event delivery (p99) | < 10 ms persistence to frame | Doc 10 | Real-time dashboard update |
| Trace query by correlation_id (p99) | < 2 ms (Pi 5), < 5 ms (Pi 4) | Doc 11 | Instant click-through in UI |
| Cold start to READY=1 | < 15 s (Pi 5), < 30 s (Pi 4) | Doc 12 | Fast recovery after power loss |
| First paint, cold cache (LAN) | < 200 ms | Doc 13 | ~80 KB bundle, minimal parse + mount |
| Bundle size (gzipped) | < 100 KB | Doc 13 | Hard budget enforced at build time |
| 72-hour stability test | Zero leaks, crashes, event loss | MVP §8.1 | Reliability bar |

---

## 11. Observability

### 11.1 Health Model

The HealthAggregator (Doc 11) composes individual subsystem health states into a three-tier system health picture. Each subsystem implements `HealthContributor` and reports one of three states: HEALTHY, DEGRADED, UNHEALTHY.

**Tier 1 — Critical Services:** Event Bus, State Store, Persistence Layer, Configuration System. If any Tier 1 subsystem is UNHEALTHY, the system is UNHEALTHY.

**Tier 2 — Core Services:** Integration Runtime, Automation Engine, Device Model, Observability. Tier 2 degradation degrades the system but does not make it UNHEALTHY.

**Tier 3 — Interface Services:** REST API, WebSocket API, Web Dashboard. A broken dashboard does not affect system operation.

The system-level health state uses dwell-time flapping prevention (10 seconds, configurable). Health transitions produce `system_health_changed` events. The `GET /api/v1/system/health` endpoint returns the aggregated health tree.

### 11.2 Metrics Surface

All subsystems emit custom JFR events (LTD-15). The MetricsStreamBridge (Doc 11) reads JFR events via `RecordingStream` and pushes aggregated snapshots to consumers (WebSocket relay for live dashboard, REST API for polling). Key metrics per subsystem:

- **Event Bus:** `hs_events_appended_total`, `hs_events_append_latency_ms`, `hs_events_subscriber_lag`
- **Device Model:** `hs.device.count`, `hs.entity.count`, `hs.validation.attribute.rejected`
- **State Store:** `hs_state_store_view_position`, `hs_state_store_entity_count`, `hs_state_store_memory_bytes`
- **Persistence:** `hs_persistence_events_file_bytes`, `hs_persistence_storage_pressure_level`, `hs_persistence_retention_events_deleted`
- **Integration Runtime:** `hs.integration.health_state`, `hs.integration.restart_count`, `hs.supervisor.active_integrations`
- **Configuration:** `config.reload_count`, `config.validation_issues`
- **Automation:** `hs_automation_runs_total`, `hs_automation_active_runs`, `hs_automation_pending_commands`
- **Zigbee:** `hs.zigbee.devices.available`, `hs.zigbee.commands.round_trip_ms`, `hs.zigbee.frames.corrupt`
- **REST API:** `hs.api.request.duration`, `hs.api.error.count`, `hs.api.rate_limit.hit`
- **WebSocket:** `hs.ws.connections.active`, `hs.ws.relay.lag`, `hs.ws.backpressure.activations`
- **Observability:** `hs.observability.jfr.recording_active`, `hs.observability.health.transitions_total`
- **Lifecycle:** `lifecycle.startup_duration_ms`, `lifecycle.uptime_seconds`

### 11.3 Structured Logging

All subsystems produce structured JSON logs via SLF4J + Logback + logstash-logback-encoder (LTD-15). Mandatory fields on every log entry: `@timestamp`, `level`, `logger_name`, `thread_name`, `message`. MDC fields propagated where applicable: `correlation_id`, `entity_id`, `integration_id`. Log rotation: daily, 50 MB per file, 7 days retention, 500 MB total cap.

### 11.4 Causal Chain Traces

The TraceQueryService (Doc 11) assembles causal chains by querying the event store for all events sharing a `correlation_id`. Chains are rendered as trees rooted at the initial cause, with each node showing the event type, entity, timestamp, and actor. The REST API exposes chains at `GET /api/v1/events/trace/{correlation_id}`. The Web UI (Doc 13) renders them as interactive timelines.

---

## 12. Security

Tier 1 operates in a constrained security context: single-user, LAN-only, no remote access, no TLS. This section consolidates the security posture from all 13 subsystem §12 sections.

### 12.1 Authentication and Authorization

All external interfaces (REST API, WebSocket API, Web Dashboard) require API key authentication (INV-SE-02). API keys are 256-bit random values, bcrypt-hashed at rest, base64-encoded for transmission (43 characters). Key management is CLI-driven (LTD-14). No default credentials ship with the system (INV-SE-01). Tier 1 provides a single permission level (full access). Tier 2 adds role-based access control and per-key permission scoping.

### 12.2 Data Protection

**Event log** contains device state changes, user actions, presence patterns, automation history — occupancy and behavioral data that requires protection (INV-PD-03). Database files use `0600` permissions (owner read/write only). The SQLite database file is the encryption boundary; the data within is not encrypted at rest in Tier 1. Tier 2 adds filesystem-level encryption.

**Secrets** (integration credentials, API tokens) are stored in the AES-256-GCM encrypted secret store at `/etc/homesynapse/secrets.enc` (Doc 06 §3.3). The encryption key resides at `/etc/homesynapse/.secret-key` with `0400` permissions (owner read only). Secrets are never written to logs — the logstash-logback-encoder configuration redacts fields marked `x-sensitive` in the JSON Schema.

**Configuration files** at `0644` (world-readable) contain no secrets — all sensitive values use the `!secret` YAML tag that resolves from the encrypted store.

### 12.3 Process Isolation

HomeSynapse runs as a dedicated `homesynapse` system user with no login shell and no home directory (LTD-13). The systemd unit applies: `ProtectSystem=strict`, `PrivateTmp=true`, `NoNewPrivileges=true`, `ProtectHome=true`. Device access is restricted to USB serial ports via `DeviceAllow`. The systemd cgroup enforces `MemoryMax=2G`.

### 12.4 Network Surface

Tier 1 exposes a single HTTP port (default 8080) on the LAN. No TLS in Tier 1 — traffic is plaintext on the local network. The REST API, WebSocket API, and Web Dashboard share this port. CORS is configured to restrict origins. Rate limiting (per-key token bucket) mitigates abuse from compromised LAN devices.

### 12.5 Input Validation

- REST API: path parameters validated as ULIDs, query parameters typed and range-checked, request bodies validated against JSON Schema. Error responses use RFC 9457 Problem Details — no stack traces, no internal paths (Doc 09 §12).
- WebSocket: JSON message parsing with type field verification, field validation for types and ranges, consecutive error limit before disconnect (Doc 10 §12).
- Configuration: YAML parsed by SnakeYAML Engine (YAML 1.2 strict), validated against composed JSON Schema (Doc 06 §12).
- Device Model: every attribute value, command parameter, and discovery proposal validated against capability schemas before affecting the registry or event stream (Doc 02 §12).
- Integration adapters: ZCL frame validation prevents malformed frame processing; Tuya and Xiaomi codecs validate manufacturer-specific payloads (Doc 08 §12).

### 12.6 Integration Trust Boundary

Integration adapters are compiled into the distribution in Tier 1 (LTD-17), but the security model treats them as untrusted producers at the API boundary. The IntegrationContext provides scoped, filtered views of core interfaces. JPMS module boundaries prevent integration code from accessing non-exported core packages. All events produced by integrations are validated by the Device Model before affecting state. Cloud-connected integrations (future tiers) access external APIs only through the `ManagedHttpClient` with rate limiting and concurrency controls.

### 12.7 Tier 2+ Security Roadmap

Tier 2 extends the security model with: TLS for all API endpoints, bearer token authentication (OAuth2/OIDC), per-user role-based access control, event category-based access filtering, filesystem-level encryption for data at rest, and a standalone Security Architecture document. The event category field (Doc 01 §4.4, amendment A-01-DR-1 applied) prepares for category-scoped access controls.

---

## 13. Testing Strategy

Phase 3 testing follows a test-first discipline: tests are written against Phase 2 interfaces before implementation begins. The tests define "correct."

### 13.1 Unit Tests

Every subsystem defines unit tests that run in isolation without other subsystems. Key unit test scenarios per subsystem:

- **Event Model:** Event envelope construction, sequence assignment, serialization round-trip, type taxonomy validation.
- **Device Model:** Attribute validation against capability schemas, command validation, discovery proposal processing, entity type classification.
- **State Store:** Event projection correctness, state change detection, staleness evaluation, checkpoint serialization.
- **Persistence:** SQLite PRAGMA configuration, retention policy execution, migration runner, telemetry ring buffer wrap-around.
- **Integration Runtime:** Health state machine transitions, restart intensity tracking, exception classification.
- **Configuration:** YAML parsing, schema validation, secret resolution, hot reload diff, migration chain.
- **Automation:** Trigger matching, condition evaluation, Run lifecycle state machine, cascade depth enforcement, conflict detection.
- **Zigbee:** Frame parsing (UNPI and ASH), ZCL cluster decoding, manufacturer codec (Tuya DP, Xiaomi TLV), availability state machine.
- **REST API:** Endpoint routing, request validation, error mapping, pagination encoding, ETag computation.
- **WebSocket:** Message protocol parsing, subscription filter evaluation, backpressure state transitions.
- **Observability:** Health aggregation composition, trace chain assembly, flapping prevention.
- **Lifecycle:** Phase ordering verification, subsystem dependency graph validation, shutdown sequence.

### 13.2 Integration Tests

Integration tests verify boundaries between subsystems:

- **Event flow end-to-end:** Produce event → persist → notify subscriber → state change derived → WebSocket delivery.
- **Command lifecycle:** Command issued → dispatched to adapter → result reported → state confirmed.
- **Automation trigger chain:** State change event → trigger matched → conditions evaluated → action executed → device command dispatched.
- **Startup and recovery:** Cold start with checkpoint → replay → LIVE transition. Unclean shutdown → restart → reconciliation.
- **Configuration reload:** Modify config → trigger reload → verify subsystem reconfiguration.

### 13.3 Performance Tests

Benchmarks validate §10 targets on RPi 5 (primary) and RPi 4 (floor):

- Event append throughput and latency under sustained load (500 events/sec target).
- State query latency under concurrent API requests.
- Automation trigger-to-action latency with cascading automations.
- WebSocket event delivery latency with 20 concurrent clients.
- Startup time from checkpoint with various event log sizes.
- Memory profiling via JFR: live heap post-GC under steady-state device load.

### 13.4 Failure Tests

- `kill -9` recovery: verify zero event loss, state consistency after restart.
- Integration crash isolation: kill adapter thread, verify core continues operating.
- Storage pressure: fill disk to trigger escalation levels, verify graceful degradation.
- Subscriber backpressure: slow subscriber, verify other subscribers unaffected.
- Malformed input: send invalid frames to Zigbee adapter, invalid JSON to REST API, invalid WebSocket messages.

### 13.5 Architecture Tests

- `modules-graph-assert`: verify Gradle module dependency graph is acyclic and `integration-zigbee` depends only on `integration-api`.
- ArchUnit: verify no imports from `core/` packages in integration modules. Verify event types follow naming conventions. Verify public interfaces have Javadoc.
- JPMS: `module-info.java` files restrict package exports.

---

## 14. Future Considerations

### 14.1 Tier 2 — Competitive Proof

The first Tier 2 deliverable after Tier 1 acceptance criteria are met is the energy monitoring adapter (Shelly EM or local-API equivalent). This exercises the `IoType.NETWORK` integration path without serial I/O complexity. Subsequent Tier 2 work adds Z-Wave adapter, network-based presence detection, multi-user household model, time-based automation triggers, template expressions, backup/restore UI, update/rollback engine, and enhanced Web UI (energy dashboard, presence status, device management). The full Tier 2 acceptance test is the proof scenario from MVP §2.2.

### 14.2 Tier 3 — Market Credibility

Matter/Thread interoperability, MQTT adapter, BLE presence, progressive web app, conditional branching in automations, parallel action execution, device pairing UI, visual automation editor, camera/RTSP.

### 14.3 Companion App

The module structure (§3.6) accommodates a thin client that shares only type-definition modules (`event-model`, `device-model`, `serialization`, `api-client`) and connects to a hub via REST and WebSocket. No hub duties, no local event store, no automation engine. The `PlatformPaths` interface (Doc 12) includes Android path implementations. Implementation is post-Tier 1.

### 14.4 NexSys Energy Product

HomeSynapse Core serves as the foundation for the NexSys Energy management product. NexSys is a build variant: the full HomeSynapse Core plus energy-domain Gradle modules (`nexsys-energy-types`, `nexsys-openadr`, `nexsys-rate-engine`, `nexsys-solver`, per-vendor energy adapters). All NexSys integrations use `IoType.NETWORK`. The INV-EI invariants (Energy & Grid Integration) are satisfied by the core's event model, telemetry store, aggregation engine, and capability system. See Portability Architecture §4 for the NexSys module map and foundation analysis.

### 14.5 Multi-Instance Coordination

INV-LF-05 (Convergent Sync Architecture) reserves the path for multiple HomeSynapse hubs coordinating across locations. The event model's per-entity sequences and causal chain metadata support eventual consistency across instances. Implementation is post-Tier 3.

---

## 15. Open Questions

1. **event_category envelope field amendment.** The Data-Readiness design concern (PROJECT_STATUS §Data-Readiness Design Concerns) proposes adding `event_category` as a required string array on the event envelope, populated by static lookup from event type to consent-scope categories. Eight categories defined: device_state, energy, presence, environmental, security, automation, device_health, system. The field enables future category-scoped access controls and crypto-shredding boundaries (INV-PD-07). Forward references exist in Doc 07 §12, Doc 09, and Doc 10 §12.6. **Status: [RESOLVED]** — Amendment A-01-DR-1 applied to Doc 01 §4.1 and §4.4. Eight categories defined, static mapping from event_type to categories specified. Forward references in Docs 07, 08, 09, 10 confirmed consistent.

2. **Data-Readiness materialized views.** The Home Health Score subscriber (~5 MB), Device Reliability Projection (~10 MB), and multi-tier aggregation engine (~15 MB) are proposed as additional subscribers. Their memory contribution (~30 MB combined) is within budget but has not been formally assigned to a design document. They may warrant a dedicated document or amendments to Docs 03/04. **Status: [NON-BLOCKING]** — the subscriber-based architecture accommodates them without structural changes.

3. **State Projection self-delivery skip mechanism.** Doc 03 §3.2 notes that the State Projection must not re-process `state_changed` events it produced. The skip mechanism is deferred to Phase 2 interface specification. **Status: [NON-BLOCKING]** — the mechanism is an implementation detail that does not affect the design contract.

4. **Isolation language audit.** Strategic-layer documents use "isolated process" language that conflicts with the contract-level INV-RF-01 formulation. The correct formulation references "supervised, isolated execution context" where the specific mechanism is an implementation decision. Documents outside the Phase 1 design corpus need audit. **Status: [NON-BLOCKING]** — does not affect Phase 2 interface work.

---

## 16. Summary of Key Decisions

This table references all 18 Locked Technical Decisions plus key architectural decisions that emerged during the 13 subsystem designs.

### 16.1 Locked Technical Decisions (LTD-01 through LTD-18)

| LTD | Decision | Choice | Key Rationale | Primary Invariants |
|---|---|---|---|---|
| LTD-01 | Runtime platform | Java 21 LTS | Virtual threads, records, sealed interfaces; JVM maturity for long-running processes on constrained hardware | INV-PR-01, INV-PR-02, INV-PR-03 |
| LTD-02 | Primary hardware | RPi 5 recommended, RPi 4 floor | NVMe via M.2 HAT for production I/O; Pi 4 ensures backward compatibility | INV-PR-01, INV-CS-07 |
| LTD-03 | Persistence engine | SQLite WAL mode | Zero-config, single-file, crash-safe; pluggable via EventStore interface | INV-RF-04, INV-RF-05, INV-PR-01, INV-CE-02 |
| LTD-04 | Identity scheme | ULID with monotonic generation | Time-ordered, globally unique, typed wrappers for compile-time discrimination | INV-CS-02, INV-ES-03 |
| LTD-05 | Ordering model | Per-entity sequences + global position | Avoids global serialization bottleneck; causal tracing via correlation/causation IDs | INV-ES-03, INV-ES-06, INV-TO-04 |
| LTD-06 | Delivery guarantee | Write-ahead persistence, at-least-once delivery | Events durable before dispatch; subscribers idempotent; event store IS the outbox | INV-ES-04, INV-ES-05, INV-RF-04 |
| LTD-07 | Schema migration | Forward-only SQL, mandatory backup | Hand-rolled runner < 200 LOC; SHA-256 verified; snapshot enables crash recovery | INV-CE-06, INV-CS-05, INV-RF-04 |
| LTD-08 | Serialization | Jackson JSON with Blackbird | Human-readable events; EventSerializer abstraction preserves binary format path | INV-ES-07, INV-TO-01, INV-PR-01 |
| LTD-09 | Configuration format | YAML 1.2 + JSON Schema | SnakeYAML Engine (1.2 strict); JSON Schema validation; VS Code auto-completion | INV-CE-01, INV-CE-03, INV-CS-03 |
| LTD-10 | Build system | Gradle Kotlin DSL, multi-module | Convention plugins, version catalogs, modules-graph-assert for dependency enforcement | INV-RF-01, INV-CS-04 |
| LTD-11 | Message broker | In-process virtual thread event bus | No external dependency; thin dispatch (~50 LOC); per-subscriber virtual threads | INV-PR-01, INV-CE-02, INV-RF-06 |
| LTD-12 | First protocol | Zigbee only in MVP | Exercises full integration runtime; most widely deployed local mesh protocol | INV-CE-04, INV-CE-05 |
| LTD-13 | Distribution | jlink + systemd | ~70–90 MB runtime vs ~313 MB full JDK; systemd for lifecycle, cgroup resource limits | INV-RF-04, INV-PR-01, INV-PR-03, INV-SE-01 |
| LTD-14 | Update model | CLI-driven, mandatory pre-upgrade snapshot | Signature verification, dry-run migration, automatic rollback on health check failure | INV-CS-05, INV-RF-04, INV-PD-08 |
| LTD-15 | Observability stack | SLF4J + Logback + JFR continuous recording | Structured JSON logs; JFR for metrics and profiling; no Prometheus/OTel in MVP | INV-TO-01, INV-TO-04, INV-PR-01 |
| LTD-16 | API versioning | Semantic versioning + URL-prefix REST API | `/api/v1/` namespace; additive-only within major version; deprecation discipline | INV-CS-01, INV-CS-04, INV-CS-06 |
| LTD-17 | Integration model | In-process compiled, enforced API boundary | Gradle modules + JPMS + ArchUnit enforce boundary at build time; mechanism swappable | INV-RF-01, INV-RF-02, INV-CS-04 |
| LTD-18 | Web UI framework | Preact SPA for observability | ~6 KB core, 100 KB gzipped bundle budget; zero server CPU; HTMX reserved for Tier 2+ config | INV-LF-01, INV-PR-01, INV-TO-01 |

### 16.2 Architectural Decisions from Subsystem Designs

| Decision | Choice | Rationale | Source |
|---|---|---|---|
| Seven-phase startup model | Ordered: Bootstrap → Foundation → Data Infra → Core Domain → Observability → External Interface → Integrations | Dependency ordering prevents events arriving before core ready to process them | Doc 12 §3 |
| State Store as sole state_changed producer | Only the State Projection produces state_changed events | Single source of truth for actual state transitions; prevents duplicate change detection | Doc 03 §3.2 |
| Hybrid thread architecture for integrations | Platform threads for serial I/O (JNI pinning), virtual threads for protocol logic | JNI native calls pin carrier threads; dedicated platform threads prevent starvation | Doc 05 §3.3, Doc 08 §3.2 |
| Trigger-Condition-Action automation model | Edge-triggered and level-triggered evaluation, sequential actions on per-Run virtual threads | Simple mental model for users; virtual threads enable concurrent Runs without thread pool exhaustion | Doc 07 §3 |
| Cascade governance with depth limiting | Max depth 8 (configurable), duplicate suppression within correlation chain | Prevents infinite loops from circular automations without overly restrictive single-depth limits | Doc 07 §3.8 |
| Four-stage WebSocket backpressure | NORMAL → BATCHED → COALESCED → close | Graceful degradation preserves fast clients; slow clients closed before they consume unbounded memory | Doc 10 §3.5 |
| Three-tier health aggregation | Critical (event/state/persistence/config) → Core (integration/automation/device/observability) → Interface (REST/WS/dashboard) | A broken dashboard must not mark the system unhealthy; a broken event bus must | Doc 11 §3.2 |
| Scheduler absorption pattern | No standalone scheduler; responsibilities distributed to semantic owners | Each concern owned by subsystem that understands semantics; avoids coordination layer with no domain knowledge | PROJECT_STATUS |
| Coordinator transport abstraction | Unified interface above ZNP and EZSP transports | Supports both major Zigbee coordinator families without code duplication | Doc 08 §3.3 |
| Pre-built static Web UI | Vite build at dev/release time, Javalin serves from classpath at runtime | Zero server CPU for rendering; content-hashed assets for caching; no Node.js on RPi | Doc 13 §3.2 |

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It synthesizes all 13 subsystem designs into a coherent architectural narrative. It is governed by the Design Document Template and will be reviewed during architecture review.*
