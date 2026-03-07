# HomeSynapse Core — Portability Architecture

**Document type:** Research artifact
**Status:** Draft
**Purpose:** Defines the deployment tier model, classifies implementation decisions by portability risk, identifies required abstraction interfaces, and analyzes the NexSys energy product foundation
**Feeds into:** Doc 14 (Master Architecture Document), NexSys product planning
**Dependencies:** Architecture Invariants v1 (§0.5 Deployment Spectrum, §12 Energy Intelligence, §1 Local-First), Locked Decisions Register v1 (all 17 LTDs), Docs 01–07 (subsystem designs), Portability Matrix research, Java 21 LTS Portability research
**Date:** 2026-03-07
**Author:** HomeSynapse Core Architecture

---

## 0. Executive Summary

HomeSynapse Core is a single codebase that must produce deployment artifacts for five distinct product categories: a Constrained hub running on a Raspberry Pi for years, a Standard hub on commodity mini-PCs, an Enhanced server deployment, a Companion controller app on phones and tablets, and a NexSys Enterprise energy management product. The architectural contracts — event sourcing, API boundaries, subsystem isolation — are inherently portable. The implementation, however, encodes assumptions about systemd, SQLite WAL on ext4, NVMe I/O profiles, and ARM64 JVM tuning that must be explicitly parameterized before the core deploys outside its primary target.

This document formalizes the deployment tier model, classifies every locked technical decision and major implementation choice by portability risk, defines the Gradle module structure that supports multi-product builds, and provides the foundation analysis for NexSys as a standalone energy product built on the HomeSynapse Core.

Three strategic conclusions emerge:

1. **The Companion app is not a HomeSynapse instance.** It is a thin client — event bus observer plus REST/WebSocket consumer — that carries no persistence, no automation engine, and no integration runtime. It shares type definitions and serialization code with the core but does not run the core.

2. **NexSys is HomeSynapse Core plus energy-domain modules.** It is not a fork. It is a Gradle build variant that includes the core plus energy-specific integrations (OpenADR 3.0 VEN, utility rate engines, V2G orchestration), energy-specific automation templates, and an energy-focused UI. The INV-EI invariants are already designed into the core; NexSys activates them.

3. **Fourteen implementation decisions are fully portable; three require platform-specific adaptation.** The three are: lifecycle management (LTD-13, systemd-specific), storage engine tuning (LTD-03, PRAGMA values are hardware-dependent), and serial I/O (the Zigbee adapter, not a core concern). Everything else — the event model, device model, automation engine, configuration system, API layer — transfers without modification.

---

## 1. Deployment Tier Model

Architecture Invariants §0.5 defines four tiers: Constrained, Standard, Enhanced, and Multi-instance. This document expands the model to six tiers by adding Companion and Enterprise, and refines each tier's subsystem inclusion rules.

### 1.1 Tier Definitions

| Tier | Product | Hardware | OS | Primary Use |
|---|---|---|---|---|
| **Constrained** | HomeSynapse Hub | RPi 4/5, 4 GB RAM, NVMe | Linux (Debian/RPi OS) | Primary home hub. 10–50 devices, single protocol. Runs for years. |
| **Standard** | HomeSynapse Hub | Mini-PC / NUC, 8–16 GB | Linux | Power-user hub. 50–200 devices, multiple protocols. |
| **Enhanced** | HomeSynapse Server | x86-64 server or VM, 16+ GB | Linux, Docker, K8s | Enthusiast or small commercial. 200–1,000 devices. |
| **Companion** | HomeSynapse App | Phone/tablet, 4–8 GB | Android, iOS (future) | Controller and viewer. No hub duties. No integrations. No local persistence. |
| **Enterprise** | NexSys Energy | x86-64 server, 32+ GB | Linux, Docker, K8s | Energy management product. HomeSynapse Core + energy domain modules. Multi-site. |
| **Multi-instance** | Any combination | Mixed | Mixed | Multiple hubs coordinating. Post-MVP. INV-LF-05 applies. |

The tier model is additive: each higher tier includes everything from lower tiers plus additional capability. The Companion tier is orthogonal — it is not a hub at all, but a client that connects to a hub.

### 1.2 Subsystem Inclusion Matrix

Every subsystem from the Phase 1 design corpus maps to a specific inclusion rule per tier.

| Subsystem | Constrained | Standard | Enhanced | Companion | Enterprise |
|---|---|---|---|---|---|
| Event Model & Event Bus (Doc 01) | Full | Full | Full | Types + read-only client | Full |
| Device Model & Capability System (Doc 02) | Full | Full | Full | Types only (read-only view) | Full |
| State Store & State Projection (Doc 03) | Full | Full | Full | None (queries via REST/WS) | Full |
| Persistence Layer (Doc 04) | Full | Full | Full (PostgreSQL option) | None | Full (PostgreSQL) |
| Integration Runtime (Doc 05) | Full | Full | Full | None | Full + energy adapters |
| Configuration System (Doc 06) | Full | Full | Full | Minimal (connection config only) | Full + energy schemas |
| Automation Engine (Doc 07) | Full | Full | Full | None | Full + energy templates |
| Zigbee Adapter (Doc 08) | Full | Full | Full | None | Optional |
| REST API (Doc 09) | Full (server) | Full (server) | Full (server) | Client library | Full (server) |
| WebSocket API (Doc 10) | Full (server) | Full (server) | Full (server) | Client library | Full (server) |
| Observability (Doc 11) | Full | Full | Full + OTEL export | Minimal (client health) | Full + OTEL + energy dashboards |
| Startup & Lifecycle (Doc 12) | systemd | systemd | systemd / Docker / K8s | Android lifecycle | systemd / Docker / K8s |
| Web UI (Doc 13) | Full | Full | Full | Native mobile UI | Full + energy dashboards |

**Key principle from Architecture Invariants §0.5:** The architecture must never require upward migration. A Constrained deployment that never upgrades hardware must remain fully functional indefinitely. The tier model adds capability at higher tiers; it never restricts correctness at lower ones.

### 1.3 Tier Differentiation Rules

**What changes across tiers:**
- JVM flags (heap, stack, GC tuning, compiler threads) — per LTD-01 specification, which defines Constrained-tier values; other tiers scale up
- SQLite PRAGMA values (cache_size, mmap_size, busy_timeout) — per LTD-03, hardware-dependent
- Lifecycle manager (systemd, launchd, Docker, Android foreground service)
- Path conventions (FHS on Linux, platform-specific elsewhere — per LTD-13)
- Observability export targets (JFR-only at Constrained; OTEL at Enhanced+)
- Available integrations (Zigbee-only at Tier 1 per LTD-12; energy adapters at Enterprise)

**What never changes across tiers:**
- Event model schema and semantics (Doc 01)
- Device model contracts and capability system (Doc 02)
- State projection logic (Doc 03)
- Event ordering guarantees: per-entity sequences + global position (LTD-05)
- Delivery guarantees: write-ahead persistence, at-least-once (LTD-06)
- Serialization format: Jackson JSON with EventSerializer abstraction (LTD-08)
- Configuration schema: YAML 1.2 with JSON Schema validation (LTD-09)
- API contracts: semver, URL-versioned REST, additive-only within major (LTD-16)
- Integration API boundary (LTD-17)
- All 81 architectural invariants at their base specification

---

## 2. Portability Risk Classification

Every locked technical decision and major implementation choice is classified into one of three risk categories:

- **Portable (P):** Works identically across all tiers with no adaptation.
- **Parameterizable (PM):** Works across all hub tiers with configuration changes. A single code path, different runtime values.
- **Platform-Specific (PS):** Requires distinct implementation per platform category. Demands an abstraction interface.

### 2.1 Locked Technical Decisions

| LTD | Decision | Risk | Analysis |
|---|---|---|---|
| LTD-01 | Java 21 LTS | PM | JVM flags are Constrained-tier-specific. Five of nine flags (-Xmx, -Xss, CICompilerCount, MaxMetaspaceSize, heap-derived mmap) encode RPi hardware assumptions. G1GC, MaxGCPauseMillis, UseStringDeduplication, MetaspaceSize transfer cleanly. Containers should use -XX:MaxRAMPercentage instead of fixed -Xmx. ARM64 default -Xss is 2048 KB; the 512 KB override is aggressive. **Not applicable to Companion tier** (no JVM on mobile). |
| LTD-02 | Pi 5 / Pi 4 target | PM | Defines Constrained floor. Standard/Enhanced/Enterprise tiers exceed these specs. Companion tier is irrelevant (phone hardware). The constraint is architectural: all designs must be viable on 4 GB / 4-core. |
| LTD-03 | SQLite WAL | PM | The storage engine is portable (xerial sqlite-jdbc bundles natives for all platforms). The PRAGMA tuning is hardware-dependent. cache_size should scale from 16 MB (Constrained) to 128 MB (Enterprise). mmap_size from 256 MB (Constrained) to 1 GB (Enterprise), 0 on Android. busy_timeout from 5 s (local NVMe) to 15 s (NAS). Docker Desktop (macOS/Windows) requires PRAGMA locking_mode=EXCLUSIVE due to VirtioFS WAL-shm incompatibility. **Enterprise tier may offer PostgreSQL option** via the pluggable EventStore interface. |
| LTD-04 | ULID identity | P | Pure Java. No platform dependency. Works everywhere. |
| LTD-05 | Per-entity sequences + global position | P | Implemented in SQLite SQL. Portable with the storage engine. |
| LTD-06 | Write-ahead persistence, at-least-once | P | Architectural contract. Implementation details are within SQLite (portable) and in-process dispatch (portable). |
| LTD-07 | Hand-rolled SQL migration | P | Forward-only SQL against SQLite. Flyway-compatible naming. No platform dependency. |
| LTD-08 | Jackson serialization | P | Pure Java library. Blackbird bytecode generation works on all JVM platforms. EventSerializer abstraction is type-safe and platform-independent. |
| LTD-09 | YAML 1.2 / SnakeYAML Engine | P | Pure Java. JSON Schema validation via networknt is pure Java. No platform dependency. |
| LTD-10 | Gradle multi-module | P | Build tool. Runs on developer machines, not on target hardware. Cross-compiles to all targets via jlink. |
| LTD-11 | In-process event bus | P | ConcurrentHashMap + virtual thread executors. Pure Java. The EventPublisher interface abstracts this for future out-of-process dispatch. |
| LTD-12 | Zigbee first protocol | PS | jSerialComm bundles natives for Linux/macOS/Windows but cannot work on Android (requires USB Host API + usb-serial-for-android). Docker requires --device passthrough. Docker Desktop on macOS/Windows cannot pass through USB at all. **Irrelevant to Companion and Enterprise tiers** unless Enterprise manages physical Zigbee coordinators. The Integration Runtime's IoType.SERIAL declaration (Doc 05 §3.2) constrains this to platform threads — correct on all JVM platforms. |
| LTD-13 | jlink + systemd | PS | **The most platform-specific decision.** jlink distribution is portable (cross-compilable per target OS+arch). systemd is Linux-specific. macOS requires launchd plist. Windows requires SCM/WinSW. Docker replaces systemd with container lifecycle. Android requires foreground service. The directory layout (FHS: /opt, /etc, /var/lib, /var/log) is Linux-specific; each platform has its own conventions. |
| LTD-14 | CLI update strategy | PM | The update mechanism (snapshot, dry-run, rollback) is conceptually portable. The CLI invocation and directory paths are platform-specific but parameterizable. Android Companion tier has no update mechanism — it uses app store updates. |
| LTD-15 | SLF4J + Logback + JFR | P (hub tiers) | SLF4J and Logback are pure Java. JFR is a HotSpot feature — works on all JVM platforms. JFR container events are Linux-only but degrade gracefully. **JFR is unavailable on Android (ART runtime).** Companion tier needs a different observability strategy. |
| LTD-16 | Semver + URL-versioned REST | P | API contract. No platform dependency. |
| LTD-17 | In-process compiled modules | P | ServiceLoader discovery, virtual thread groups, build-enforced boundaries. Pure Java. |

### 2.2 Subsystem-Level Portability

| Subsystem | Portability | Key Risk |
|---|---|---|
| Event Model (Doc 01) | Fully portable | None. Pure domain model + SQLite. |
| Device Model (Doc 02) | Fully portable | None. In-memory registry + event-driven. |
| State Store (Doc 03) | Fully portable | None. In-memory projection from events. |
| Persistence Layer (Doc 04) | Parameterizable | PRAGMA tuning. Retention scheduling assumes always-on process. Enterprise may need PostgreSQL. |
| Integration Runtime (Doc 05) | Mostly portable | Serial I/O path (IoType.SERIAL) requires platform-specific transport. HTTP polling (IoType.NETWORK) is fully portable. Supervisor restart assumes long-lived process. |
| Configuration System (Doc 06) | Parameterizable | File paths are platform-specific. Schema, validation, reload logic all portable. |
| Automation Engine (Doc 07) | Fully portable | None. Virtual thread per Run. Pure domain logic. |

### 2.3 Risk Summary

Of the 17 locked decisions, 11 are fully portable, 4 are parameterizable (same code, different config), and 2 are platform-specific (require abstraction interfaces). The two platform-specific decisions — lifecycle management (LTD-13) and serial I/O (LTD-12) — are already designed with abstraction points: LTD-13's directory layout is isolated in a paths utility, and LTD-12's serial transport is behind the Integration Runtime's adapter interface.

The Companion tier is the largest departure: it does not run the HomeSynapse Core process at all. It is a purpose-built client that shares type definitions with the core.

---

## 3. Companion App Architecture

### 3.1 What the Companion Is

The Companion app is a controller and viewer. It connects to a HomeSynapse hub over the local network (REST API for queries and commands, WebSocket for real-time state updates). It does not manage devices, run automations, or persist events. It is to HomeSynapse what the Home Assistant mobile app is to a Home Assistant server — a remote control, not a second brain.

### 3.2 What the Companion Is Not

The Companion is **not** a HomeSynapse instance. It does not participate in INV-LF-05 convergent sync as a peer. It does not have an event store. It does not run the automation engine. It does not host integrations. It cannot operate independently — if the hub is unreachable, the Companion shows cached state and queues commands for delivery when connectivity resumes.

This is a deliberate architectural choice driven by three constraints:

1. **Mobile platform lifecycle.** Android's Low Memory Killer and iOS background execution limits make long-lived, always-on processes impractical. The HomeSynapse architecture assumes an always-running process (Doc 12, Startup & Lifecycle). Mobile platforms do not provide this guarantee.

2. **Storage engine incompatibility.** SQLite WAL with the shared-memory (-shm) coordination model works well on Linux ext4 but requires significant adaptation for Android (Compatibility WAL, reduced mmap, LMK-aware memory management). Running a full event store on a phone adds complexity with no user-facing benefit — the hub already has the canonical event log.

3. **Single-writer model (LTD-03).** SQLite's single-writer constraint means concurrent hubs writing to the same database create contention. A phone running a full HomeSynapse instance would either need its own database (requiring sync, which is post-MVP per INV-LF-05) or share the hub's database (impossible over the network with WAL mode).

### 3.3 Companion Module Composition

The Companion app uses a subset of the Gradle modules defined by LTD-10:

| Module | Purpose in Companion | Included? |
|---|---|---|
| `homesynapse-event-types` | Event type definitions, sealed interfaces, record types | Yes — shared types |
| `homesynapse-device-types` | Device model types, capability definitions, entity types | Yes — shared types |
| `homesynapse-serialization` | Jackson ObjectMapper configuration, EventSerializer | Yes — message parsing |
| `homesynapse-api-client` | REST client, WebSocket client, connection management | Yes — this is the Companion's core |
| `homesynapse-event-bus` | In-process event dispatch | No |
| `homesynapse-state-store` | In-memory state projection | No (receives projected state from hub via WS) |
| `homesynapse-persistence` | SQLite event store, retention, aggregation | No |
| `homesynapse-integration-api` | Integration adapter contracts | No |
| `homesynapse-integration-runtime` | Supervisor, lifecycle management | No |
| `homesynapse-automation` | Automation engine, command pipeline | No |
| `homesynapse-config` | Configuration system, schema validation | Minimal — connection config only |
| `homesynapse-observability` | JFR, structured logging | No (uses Android/iOS native logging) |
| `homesynapse-lifecycle` | systemd integration, startup sequencing | No |

The Companion's dependency footprint is approximately: Jackson + shared type modules + an HTTP client + a WebSocket client. Total JAR size estimate: 5–10 MB, well within mobile app norms.

### 3.4 Companion Capabilities

The Companion provides:

- **State viewing.** Current state of all entities, received via WebSocket subscription. The hub pushes state changes; the Companion renders them.
- **Command dispatch.** Send commands to entities via the REST API. The hub's Command Dispatch Service (Doc 07 §3.11.1) routes commands to the appropriate integration.
- **Automation monitoring.** View automation status, recent Run history, and active Runs — all queried via REST. The Companion does not evaluate or execute automations.
- **Event stream observation.** Subscribe to the event stream via WebSocket for real-time activity feed. The Companion renders events; it does not persist them.
- **Offline command queuing.** When the hub is unreachable, commands are queued locally and dispatched when connectivity resumes. This is a simple queue, not an event store.
- **Push notifications.** The hub pushes alerts (automation failures, device offline, security events) to the Companion. Implementation is platform-specific (FCM on Android, APNs on iOS).

### 3.5 Companion Does Not Require Java

The Companion shares *type definitions* with the core, not runtime code. The shared types are data structures (records, sealed interfaces, enums) that can be expressed in any language. For Android, the Companion can be:

- **Option A: Kotlin/Android native** using a code-generated Kotlin data class library derived from the Java type definitions. Jackson's Kotlin module handles serialization. This is the most natural Android approach.
- **Option B: Java 21 on Android** via desugaring (Android Gradle Plugin's coreLibraryDesugaring). Java 21 language features (records, sealed interfaces, pattern matching) require API desugaring that is partially available. Virtual threads are unavailable on ART.
- **Option C: Cross-platform (Kotlin Multiplatform or Flutter)** sharing a common REST/WebSocket client across Android and iOS.

The Companion's architecture does not constrain this choice. The API contracts (Doc 09, Doc 10) define the integration surface. The type-sharing strategy is an implementation decision for the Companion product, not a core architectural concern.

### 3.6 Gradle Support for Companion Builds

LTD-10's multi-module Gradle structure supports the Companion naturally:

```
homesynapse-core/
├── build-logic/                    # Convention plugins
├── homesynapse-event-types/        # Shared: event records, sealed interfaces
├── homesynapse-device-types/       # Shared: device model types, capabilities
├── homesynapse-serialization/      # Shared: Jackson config, EventSerializer
├── homesynapse-api-client/         # Shared: REST client, WebSocket client
├── homesynapse-event-bus/          # Hub only
├── homesynapse-state-store/        # Hub only
├── homesynapse-persistence/        # Hub only
├── homesynapse-integration-api/    # Hub only
├── homesynapse-integration-runtime/# Hub only
├── homesynapse-automation/         # Hub only
├── homesynapse-config/             # Hub: full. Companion: connection config subset
├── homesynapse-observability/      # Hub only
├── homesynapse-lifecycle/          # Hub only
├── homesynapse-zigbee/             # Hub only (integration)
├── homesynapse-hub/                # Hub application assembly
└── homesynapse-companion/          # Companion application assembly (future)
```

The `modules-graph-assert` plugin (LTD-10) enforces that `homesynapse-companion` cannot depend on hub-only modules. The type-sharing modules (`-event-types`, `-device-types`, `-serialization`, `-api-client`) form a "shared" layer with no dependencies on hub internals.

---

## 4. NexSys Energy Product Architecture

### 4.1 Product Definition

NexSys is a home energy management system (HEMS) built on the HomeSynapse Core. It is not a fork — it is a build variant. NexSys includes the full HomeSynapse Core (all hub subsystems) plus energy-domain modules that implement the capabilities described in INV-EI-01 through INV-EI-05 and the phased delivery plan in Architecture Invariants §16.1.

NexSys targets a different customer than HomeSynapse: homeowners with solar panels, batteries, EV chargers, and/or time-of-use electricity tariffs who want to optimize energy cost and carbon footprint. The subscription model ($3.99–7.99/month) is self-funding against documented savings of $131–500+/year.

### 4.2 How INV-EI Maps to NexSys Modules

| Invariant | Core Responsibility | NexSys Module Responsibility |
|---|---|---|
| INV-EI-01 (Energy as First-Class Domain) | Event taxonomy includes energy event types. Device model accommodates energy entities. State store, automation engine, and APIs handle energy entities identically to all others. | Energy-specific entity templates (solar inverter, battery, EV charger, whole-home meter, circuit-level meter). Energy dashboard UI. Energy-specific automation templates. |
| INV-EI-02 (Grid-Interactive by Design) | Automation engine supports time-based triggers and external signal evaluation. Event taxonomy includes grid signal event types. | OpenADR 3.0 VEN client (integration adapter). Utility rate schedule engine. Demand response automation templates. Grid signal processing pipeline. |
| INV-EI-03 (Carbon-Aware Scheduling) | Automation engine supports time-window constraints and external data sources. | WattTime / Electricity Maps integration (integration adapter). Carbon-cost optimization solver. Deferrable load scheduling engine. |
| INV-EI-04 (Energy Data Sovereignty) | Privacy invariants (§6) govern all data. Per-program consent model. | Consent management UI for utility programs. Data filtering pipeline for DR program participation. Audit trail for energy data sharing. |
| INV-EI-05 (Hardware-Agnostic Energy Metering) | Integration model (INV-CE-04, INV-CE-05) provides protocol-agnostic device abstraction. | Adapters for: Shelly EM (local HTTP), SolarEdge (Modbus TCP), Enphase (local API), Tesla Powerwall (local API), Emporia Vue (cloud API), Sense (cloud API). |

### 4.3 NexSys Module Structure

```
homesynapse-core/
├── [all core modules as defined in §3.6]
├── nexsys-energy-types/            # Energy entity templates, tariff records, grid signal types
├── nexsys-energy-automation/       # Energy-specific automation templates (TOU, DR, carbon)
├── nexsys-openadr/                 # OpenADR 3.0 VEN client (integration adapter)
├── nexsys-carbon/                  # Carbon intensity data integration (WattTime, Electricity Maps)
├── nexsys-rate-engine/             # Utility rate schedule engine (TOU, tiered, demand charges)
├── nexsys-solver/                  # Optimization solver for load scheduling
├── nexsys-adapter-shelly/          # Shelly EM/Pro energy monitor adapter
├── nexsys-adapter-solaredge/       # SolarEdge inverter adapter (Modbus TCP)
├── nexsys-adapter-enphase/         # Enphase microinverter adapter (local API)
├── nexsys-adapter-powerwall/       # Tesla Powerwall adapter (local API)
├── nexsys-energy-ui/               # Energy-specific dashboard components
└── nexsys-product/                 # NexSys application assembly
```

Every `nexsys-*` module depends on core modules via their published interfaces. No core module depends on any `nexsys-*` module. This preserves INV-LF-02's dependency direction: enhancement modules depend on core, never the reverse.

### 4.4 NexSys Energy Adapters as Integration Runtime Clients

Every NexSys energy adapter is an integration in the sense defined by Doc 05 (Integration Runtime). It implements the `IntegrationAdapter` interface, declares its `IntegrationDescriptor` with capabilities and configuration schema, and runs under the Integration Runtime's supervisor with health monitoring, crash isolation, and resource quotas.

Most energy adapters are `IoType.NETWORK` — they communicate via HTTP, Modbus TCP, or WebSocket to local-network devices or cloud APIs. This is the simplest I/O path through the Integration Runtime. No serial I/O, no JNI, no platform threads required (unlike the Zigbee adapter).

The first NexSys adapter — a Shelly EM local-network energy monitor — is already identified in PROJECT_STATUS as the first Tier 2 deliverable. It validates the `IoType.NETWORK` path through the Integration Runtime and proves the energy entity model end-to-end.

### 4.5 NexSys-Specific Subsystems

Three subsystems are NexSys-specific and do not exist in the base HomeSynapse product:

**Rate Engine.** Parses utility rate schedules (time-of-use tiers, demand charges, seasonal adjustments, net metering rules) and produces a queryable model that the automation engine uses for cost optimization. Rate schedules are complex (PG&E E-TOU-D has 4 time periods × 2 seasons × peak/off-peak demand charges), and encoding them as automation conditions would be fragile. The Rate Engine is a specialized data service that the automation engine queries via a well-defined internal API.

**Optimization Solver.** Given a set of deferrable loads (EV charging, water heating, pool pump, laundry), their time-window constraints ("car charged by 7 AM"), current and forecast energy prices, and optional carbon intensity data, the solver produces an optimal schedule. This is a constrained optimization problem. On Constrained-tier hardware, a greedy heuristic suffices (sort time slots by cost, assign loads to cheapest available slots). On Enhanced/Enterprise tiers, a proper LP/MILP solver (e.g., Google OR-Tools, which has a Java API) can find globally optimal solutions.

**OpenADR 3.0 VEN Client.** Implements the OpenADR 3.0 Virtual End Node role — receiving demand response signals from a Virtual Top Node (the utility or aggregator) and translating them into HomeSynapse automation triggers. OpenADR 3.0 uses a REST-based architecture that a Pi can implement. This is an integration adapter that produces grid signal events consumed by the automation engine.

### 4.6 NexSys Deployment Tiers

NexSys inherits the HomeSynapse tier model with energy-specific additions:

| Tier | NexSys Configuration | Typical Customer |
|---|---|---|
| Constrained | Pi-based. Shelly EM + Zigbee smart plugs. Greedy TOU optimizer. No cloud APIs. | Budget-conscious homeowner with solar panels and a simple rate plan. |
| Standard | Mini-PC. Multiple energy monitors. Full rate engine. Carbon-aware scheduling with WattTime free tier. | Solar + battery homeowner on a complex TOU rate. |
| Enhanced | Server. PostgreSQL. Multiple sites. OTEL metrics export. Full optimization solver. OpenADR VEN. | Multi-property owner or small commercial. DR program participant. |
| Enterprise | Multi-instance. Fleet management. Utility-facing APIs. Aggregated demand response. | Energy service company (ESCO) or community choice aggregator managing hundreds of homes. |

At every tier, NexSys satisfies INV-LF-01: core energy management (TOU automation, battery dispatch, load scheduling) operates without internet. Cloud services (carbon intensity data, utility rate updates, OpenADR VEN communication) enhance the product but are not required for basic optimization.

---

## 5. Configuration Tier Model

### 5.1 How Doc 06 Supports Deployment Profiles

The Configuration System (Doc 06) is designed with profile support as a future extension (Doc 06 §14, "Configuration profiles"). The current architecture supports deployment-tier differentiation through three mechanisms:

**Mechanism 1: Schema defaults.** Every configuration property has a schema-defined default (Doc 06 §P6, INV-CE-02). The defaults are tuned for the Constrained tier. Higher tiers override specific values in their `homesynapse.yaml`.

**Mechanism 2: Environment variable interpolation.** The `!env` YAML tag (Doc 06 §3.1) allows configuration values to reference environment variables. A Docker deployment sets `HOMESYNAPSE_PERSISTENCE_CACHE_SIZE=64000` to scale the SQLite cache without editing the YAML file.

**Mechanism 3: Profile overlays (future).** Doc 06 §14 describes a `profiles:` section with per-environment overrides merged at load time. This is the clean solution for deployment-tier configuration. The schema composition model supports it without architectural change.

### 5.2 Tier-Specific Configuration Defaults

The following table defines recommended configuration values per tier. These are the values that a tier-specific profile would set:

| Configuration Key | Constrained | Standard | Enhanced | Enterprise |
|---|---|---|---|---|
| `persistence.cache_size_kb` | 16384 (16 MB) | 65536 (64 MB) | 131072 (128 MB) | 131072 (128 MB) |
| `persistence.mmap_size_mb` | 256 | 512 | 1024 | 1024 |
| `persistence.busy_timeout_ms` | 5000 | 5000 | 5000 | 10000 (if NAS) |
| `persistence.wal_autocheckpoint` | 1000 | 1000 | 2000 | 2000 |
| `persistence.retention.event_days` | 365 | 730 | 1825 | 1825 |
| `persistence.retention.diagnostic_days` | 30 | 90 | 365 | 365 |
| `event_bus.subscriber_queue_size` | 1000 | 2000 | 5000 | 10000 |
| `automation.max_total_runs` | 200 | 500 | 1000 | 2000 |
| `automation.command_pipeline.max_pending` | 500 | 1000 | 2000 | 5000 |
| `integration_runtime.max_integrations` | 5 | 20 | 50 | 100 |
| `observability.jfr.max_recording_size_mb` | 50 | 100 | 500 | 1000 |
| `observability.otel.enabled` | false | false | true | true |

### 5.3 JVM Flag Profiles

Separate from YAML configuration, JVM flags must be parameterized per tier. These are set in the launcher script (part of the jlink distribution per LTD-13) or in the Docker entrypoint.

| Flag | Constrained | Standard | Enhanced | Enterprise |
|---|---|---|---|---|
| `-Xms` | 512m | 1g | 2g | 4g |
| `-Xmx` | 1536m | 3g | 6g | 12g |
| `-Xss` | 512k | 1024k | 1024k | 1024k |
| `-XX:CICompilerCount` | 2 | (auto) | (auto) | (auto) |
| `-XX:MaxMetaspaceSize` | 128m | 256m | (none) | (none) |
| `-XX:MaxGCPauseMillis` | 100 | 100 | 200 | 200 |

For Docker/K8s deployments at Enhanced/Enterprise tiers, replace fixed heap with percentage-based flags:
```
-XX:MaxRAMPercentage=75.0 -XX:InitialRAMPercentage=50.0
```

---

## 6. Multi-Instance Coordination

### 6.1 Scope

INV-LF-05 (Convergent Sync Architecture) constrains the data model to support convergent synchronization without requiring a central coordinator. The MVP is single-instance. This section analyzes what multi-instance means across the heterogeneous tier model and identifies the constraints the current design must preserve.

### 6.2 Instance Roles in a Multi-Instance Deployment

When HomeSynapse runs on a hub AND a phone AND a server, the instances have different roles:

| Instance | Role | Event Store | Writes Events | Runs Automations | Manages Integrations |
|---|---|---|---|---|---|
| Hub (Constrained/Standard) | **Authority.** Owns the canonical event log. Manages local devices. | Full (SQLite) | Yes — primary writer | Yes | Yes |
| Companion (phone/tablet) | **Observer.** Reads state, sends commands. | None | No — sends commands to authority via REST | No | No |
| Server (Enhanced) | **Replica or coordinator.** Aggregates events from multiple hubs. Off-site backup. Advanced analytics. | Full (PostgreSQL) | Yes — receives replicated events | Optionally (cross-hub automations) | No (delegates to hubs) |

The Companion is not a sync peer. It is a client. This simplifies the multi-instance model considerably: the sync problem is between hubs and optional server replicas, not between every device in the household.

### 6.3 Sync Model: Small Peer / Big Peer

The Architecture Invariants §16.7 identifies the Small Peer / Big Peer pattern:

- **Small Peer:** The Pi-based hub. Local authority for its devices. Operates autonomously during partitions. Event log is the source of truth for local state.
- **Big Peer:** The optional cloud or server coordinator. Receives event replicas from small peers. Provides off-site backup, cross-hub aggregation, and remote access relay.

The sync direction is primarily Small → Big (events flow from hub to coordinator). The reverse direction (Big → Small) carries configuration changes, cross-hub automation triggers, and remote commands. Both directions must handle partitions gracefully — the hub continues operating independently, queuing outbound events until connectivity resumes.

### 6.4 What the Current Design Preserves for Future Sync

The following design choices (already locked) are convergent-sync-compatible:

- **Per-entity sequences (LTD-05).** Each entity has its own monotonic sequence. There is no global sequence that requires cross-instance coordination. Two hubs managing different devices produce non-conflicting entity sequences.
- **ULID identity (LTD-04).** ULIDs are globally unique without coordination. Two hubs generating events concurrently produce non-colliding event IDs.
- **Correlation and causation IDs (LTD-05).** The causal chain linking events supports merge conflict detection — if two hubs modify the same entity concurrently, the causation chain reveals the fork.
- **Event immutability (INV-ES-01).** Events are append-only facts. Sync is additive — merging two event logs is a union operation, not a conflict resolution problem, as long as entity-level ordering is preserved.
- **Idempotent subscribers (LTD-06).** Subscribers tolerate duplicate delivery. If sync delivers an event that already exists locally, the subscriber ignores it.

### 6.5 What the Current Design Does Not Address (Post-MVP)

- **Entity ownership model.** Which hub is authoritative for a given entity? Current design assumes a single hub owns all entities. Multi-instance requires an ownership registry.
- **Configuration sync.** YAML configuration changes on one hub must propagate to others. Doc 06 §14 identifies this as a future extension using `config_changed` events.
- **Automation conflict resolution.** If two hubs both trigger the same automation from different events during a partition, the reconciliation strategy is undefined.
- **Sync transport protocol.** The specific mechanism (CRDT delta sync, event log tailing, or something else) is not specified. INV-LF-05 constrains the property, not the mechanism.

### 6.6 NexSys Multi-Site Implications

NexSys Enterprise targets multi-site deployments (energy service companies managing many homes). Each home has a local hub (Small Peer). The NexSys server (Big Peer) aggregates energy data across all sites for:

- Fleet-level demand response coordination
- Portfolio energy optimization
- Regulatory reporting and settlement
- Customer-facing analytics

This is a stricter form of the Small Peer / Big Peer pattern: the NexSys server is a read-heavy aggregator, not a bidirectional sync peer. Events flow from homes to server. Commands flow from server to homes (DR signals, remote schedule adjustments). This simpler model can be implemented before full convergent sync is ready.

---

## 7. Abstraction Interfaces Required Before Non-RPi Deployment

The following interfaces must exist in the codebase before HomeSynapse deploys outside the RPi/Linux/systemd context. Each interface isolates a platform-specific concern behind a portable contract.

### 7.1 HealthReporter

**Purpose:** Abstracts lifecycle health reporting across platform supervisors.

**Why needed:** LTD-13 specifies systemd with WatchdogSec=60. No other platform has this protocol. macOS launchd has crash restart but no heartbeat. Docker has HEALTHCHECK (pull-based). Android has no equivalent.

**Interface contract:**
- `reportReady()` — Process has completed initialization.
- `reportWatchdog()` — Heartbeat. Called periodically from an internal health check thread.
- `reportStopping()` — Process is shutting down gracefully.
- `reportStatus(String message)` — Human-readable status for debug.

**Implementations:**
- `SystemdHealthReporter` — Sends sd_notify messages via Unix domain socket. Uses faljse/SDNotify library (Maven Central, degrades to no-op when $NOTIFY_SOCKET is unset).
- `HttpHealthReporter` — Exposes /health endpoint on a dedicated port. Pull-based, for Docker HEALTHCHECK and K8s livenessProbe.
- `NoOpHealthReporter` — For macOS development, Windows, and any platform without a supervisor.

**Tier mapping:** Constrained/Standard use SystemdHealthReporter + HttpHealthReporter (dual-mode). Enhanced uses HttpHealthReporter (Docker/K8s). Companion does not use this interface.

### 7.2 PlatformPaths

**Purpose:** Abstracts platform-specific directory conventions.

**Why needed:** LTD-13 specifies FHS paths (/opt, /etc, /var/lib, /var/log). macOS uses /Library/Application Support/. Windows uses %ProgramData%. Android uses Context methods. Docker uses volume mounts.

**Interface contract:**
- `binaryDir()` — Read-only runtime image location.
- `configDir()` — Writable configuration files.
- `dataDir()` — Writable persistent data (SQLite databases).
- `logDir()` — Writable log files and JFR recordings.
- `backupDir()` — Writable pre-update snapshots.
- `tempDir()` — Writable temporary files (private, cleaned on startup).

**Implementations:**
- `LinuxSystemPaths` — FHS: /opt, /etc, /var/lib, /var/log per LTD-13.
- `LinuxUserPaths` — XDG: ~/.config, ~/.local/share, ~/.local/state.
- `MacOsPaths` — /Library/Application Support/HomeSynapse/.
- `WindowsPaths` — %ProgramData%\HomeSynapse\.
- `DockerPaths` — /app (binary), /config (volume), /data (volume).
- `AndroidPaths` — Context.getFilesDir() derivatives.

### 7.3 AdaptivePragmaConfig

**Purpose:** Scales SQLite PRAGMA values based on detected hardware and platform.

**Why needed:** LTD-03 specifies fixed PRAGMA values tuned for RPi 5 + NVMe. Other platforms need different values (§5.2). Android needs dramatically reduced mmap. NAS-backed storage needs longer busy_timeout.

**Interface contract:**
- `configure(Connection conn, PlatformInfo platform)` — Applies PRAGMA statements appropriate to the detected platform.
- `PlatformInfo` — Record containing: available RAM, OS type, storage type (NVMe/SSD/SD/NAS), deployment tier.

**Detection strategy:** At startup, read `Runtime.getRuntime().maxMemory()` for JVM heap ceiling, `System.getProperty("os.name")` for OS, and probe the data directory's filesystem type via `/proc/mounts` (Linux) or platform-specific equivalents. The Configuration System (Doc 06) can override detected values via explicit YAML configuration, providing a manual escape hatch.

### 7.4 DeviceTransport (Integration-Level, Not Core)

**Purpose:** Abstracts the physical transport for device communication, particularly serial I/O.

**Why needed:** jSerialComm works on Linux/macOS/Windows but not Android. Docker requires --device passthrough. Network-only deployments use MQTT or raw TCP instead of serial.

**This is not a core interface.** It lives within the Integration Runtime's adapter model. Each integration adapter declares its IoType (Doc 05 §3.2). The Zigbee adapter (Doc 08) will define a `ZigbeeTransport` interface with implementations for local serial (jSerialComm), Android USB Host API (usb-serial-for-android), and network bridges (MQTT via zigbee2mqtt, raw TCP via ser2net). This is Doc 08's design responsibility, not a cross-cutting concern.

---

## 8. CI/CD Testing Matrix

### 8.1 Target Platforms

The testing matrix must cover four dimensions: OS, architecture, JVM distribution, and deployment mode.

| Dimension | Values |
|---|---|
| OS | Linux (Debian 12), macOS (Ventura+), Windows 11 |
| Architecture | x86-64, ARM64 (Linux only for CI; macOS ARM64 via self-hosted runner) |
| JVM | Temurin 21 LTS (primary), GraalVM JDK 21 (secondary) |
| Deployment | Bare JVM, jlink image, Docker container |

### 8.2 CI Pipeline Structure

```
┌─────────────────────────────────────────────────────────────┐
│ Tier 1: Fast Feedback (every push, < 5 minutes)            │
│                                                             │
│  ● Compile (Java 21, Linux x86-64)                         │
│  ● Unit tests (all modules)                                │
│  ● Architecture tests (ArchUnit + modules-graph-assert)     │
│  ● Checkstyle / SpotBugs                                   │
└─────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────────┐
│ Tier 2: Platform Matrix (every PR merge, < 15 minutes)     │
│                                                             │
│  ● Unit tests × [Linux x86-64, Linux ARM64, macOS ARM64,  │
│    Windows x86-64] × [Temurin 21]                          │
│  ● Integration tests (SQLite WAL behavior per platform)    │
│  ● jlink image build × [Linux x86-64, Linux ARM64]        │
│  ● Docker image build + smoke test                         │
└─────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────────┐
│ Tier 3: Hardware Validation (nightly, < 60 minutes)        │
│                                                             │
│  ● Full test suite on RPi 5 (self-hosted runner)           │
│  ● Performance benchmarks (event throughput, state query    │
│    latency, automation trigger-to-action) on RPi 5         │
│  ● JFR recording analysis for memory/GC regression         │
│  ● 1-hour stability soak test on RPi 5                     │
│  ● SQLite WAL checkpoint performance on NVMe vs SD card    │
└─────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────────┐
│ Tier 4: Release Qualification (per release, < 4 hours)     │
│                                                             │
│  ● 72-hour stability test on RPi 5 (MVP §8.1)             │
│  ● Full platform matrix with GraalVM JDK 21                │
│  ● Docker + K8s deployment smoke test                      │
│  ● jlink distribution validation per target platform       │
│  ● Upgrade path test (previous release → candidate)        │
│  ● Real Zigbee hardware integration test on RPi 5          │
└─────────────────────────────────────────────────────────────┘
```

### 8.3 RPi 5 Testing Infrastructure

The RPi 5 self-hosted GitHub Actions runner is essential infrastructure. GitHub-hosted runners are x86-64 Linux/macOS/Windows only — no ARM64 Linux runners are available. Options:

- **Self-hosted RPi 5 runner.** Dedicated Pi 5 (8 GB) running the GitHub Actions runner agent. Executes Tier 3 and Tier 4 tests. Requires NVMe storage, stable power, and network connectivity. Cost: ~$120 hardware.
- **ARM64 Linux emulation via QEMU.** GitHub Actions supports QEMU for cross-architecture builds. Adequate for compilation and unit tests but unreliable for performance benchmarks (10–50× slowdown). Not suitable for Tier 3/4.
- **Cloud ARM64 runners.** GitHub offers ARM64 Linux runners in beta (Arm-hosted). Adequate for CI platform matrix but not for hardware-specific testing (SQLite on real NVMe, JFR under real memory pressure).

The recommended approach: QEMU for Tier 2 ARM64 cross-compilation, self-hosted RPi 5 for Tier 3/4 hardware validation.

### 8.4 Platform-Specific Test Categories

| Test Category | What It Validates | Platforms |
|---|---|---|
| SQLite WAL locking | fcntl (Linux/macOS) vs LockFileEx (Windows) | All |
| SQLite mmap behavior | mmap scaling, fallback when unavailable | All |
| File path resolution | PlatformPaths implementations | All |
| jlink image startup | Custom runtime completeness, CDS archive | Linux x86-64, Linux ARM64 |
| Docker WAL behavior | VirtioFS shm compatibility, exclusive locking fallback | Docker Desktop (macOS/Windows), Docker Linux |
| Serial port access | jSerialComm native library loading | Linux, macOS, Windows (with USB device) |
| JFR continuous recording | Event capture, file rotation, streaming API | All JVM platforms |
| Virtual thread scheduling | Carrier thread count, pinning detection | All |
| G1GC pause behavior | MaxGCPauseMillis compliance under load | RPi 5 (Tier 3) |

---

## 9. Open Questions

### OQ-1: PostgreSQL at Enterprise Tier

LTD-03 locks SQLite as the persistence engine with a pluggable `EventStore` interface. The Enterprise tier (NexSys at scale, multi-site aggregation) may require PostgreSQL for concurrent multi-writer access, advanced querying, and replication. The `EventStore` interface (Doc 04) is designed to accommodate this, but the PostgreSQL implementation is not in MVP scope. The question is: when does the PostgreSQL path become necessary, and what is the trigger?

**Proposed trigger:** When a NexSys deployment exceeds 500 concurrent devices or requires multi-instance write access to the same event store, the PostgreSQL `EventStore` implementation is justified. Below that threshold, SQLite with `PRAGMA locking_mode=EXCLUSIVE` (single-writer, which matches INV-LF-01's local-authority model) is sufficient.

### OQ-2: Companion Platform Choice

The Companion app architecture (§3) is platform-agnostic at the API level. The implementation language and framework are not constrained by the core architecture. The question is: should the initial Companion be Android-only (largest market, Java/Kotlin ecosystem alignment), cross-platform (Kotlin Multiplatform or Flutter), or deferred entirely until the core is proven?

**Recommendation:** Defer the Companion to post-Tier 1. The core's REST API (Doc 09) and WebSocket API (Doc 10) are the integration surface. Any HTTP client can be a Companion. A web-based responsive UI (Doc 13) provides mobile access without a native app. The native Companion adds push notifications and offline queuing — valuable, but not essential until the core is shipping.

### OQ-3: NexSys Energy Solver Complexity

The optimization solver (§4.5) ranges from a greedy heuristic (< 100 lines of Java, runs on a Pi) to a full MILP solver (Google OR-Tools, ~50 MB dependency, requires native libraries). The question is: does the Constrained-tier NexSys need anything beyond the greedy heuristic?

**Analysis:** For a single home with solar + battery + EV charger on a TOU rate, the greedy heuristic (sort slots by cost, assign loads to cheapest available) captures 80–90% of the theoretical optimum. The MILP solver matters when there are many interdependent constraints (multiple deferrable loads with overlapping time windows, demand charge avoidance, battery degradation curves). This is an Enhanced/Enterprise concern.

**Recommendation:** Ship greedy at Constrained tier. Offer MILP as an optional dependency at Enhanced/Enterprise. The solver interface is the same; only the implementation differs.

### OQ-4: Android Runtime Viability

If a future NexSys product targets Android tablets as dedicated energy dashboards (wall-mounted tablets showing real-time energy flow), does the Companion architecture suffice, or does the tablet need a full HomeSynapse instance?

**Analysis:** A wall-mounted energy dashboard is a Companion — it displays state and accepts commands. It does not need a local event store or automation engine. The WebSocket subscription provides real-time energy flow visualization. The REST API provides historical data for charts. The only gap is offline operation during hub connectivity loss, which can be addressed by caching the last N minutes of state on the tablet.

**Recommendation:** The Companion architecture is sufficient for energy dashboards. No full instance on Android is needed for this use case.

---

## 10. Recommendations and Next Steps

### 10.1 Immediate Actions (Inform Phase 1 Remaining Docs)

1. **Doc 12 (Startup & Lifecycle) must define the HealthReporter interface (§7.1).** This is the primary platform abstraction for lifecycle management. The interface is small (4 methods) and the systemd implementation is the only one needed for Tier 1.

2. **Doc 12 must define the PlatformPaths interface (§7.2).** The Linux system paths implementation is the only one needed for Tier 1, but the interface must exist so that Doc 14 can reference it as the portability contract.

3. **Doc 04 (Persistence Layer) should acknowledge AdaptivePragmaConfig (§7.3) as a Phase 2 concern.** The current PRAGMA values in LTD-03 are Constrained-tier specific. The adaptation logic is not needed until non-RPi deployment, but the design should not hardcode PRAGMA values in a way that prevents parameterization.

### 10.2 Phase 2 Actions (Before Non-RPi Deployment)

4. **Implement HealthReporter with SystemdHealthReporter and HttpHealthReporter.** The dual-mode approach (push for systemd, pull for everything else) covers all hub tiers.

5. **Implement PlatformPaths for Linux system, Linux user, Docker, and macOS.** Windows paths are lowest priority (developer convenience only at this stage).

6. **Implement AdaptivePragmaConfig with platform detection.** The detection is cheap (Runtime.maxMemory() + os.name + filesystem probe). The configuration override in YAML provides a manual escape hatch.

7. **Define the Companion API client module boundary in Gradle.** The shared type modules (event-types, device-types, serialization) must be extractable without pulling in hub dependencies.

### 10.3 Phase 3+ Actions (Product Expansion)

8. **NexSys module structure.** After the first energy adapter ships (Shelly EM, Tier 2 per PROJECT_STATUS), define the nexsys-* Gradle modules and their dependency rules.

9. **PostgreSQL EventStore implementation.** When the first NexSys Enterprise deployment approaches 500 devices or requires multi-writer access.

10. **Convergent sync protocol design.** When multi-instance deployment becomes a product requirement (not an architectural aspiration).

---

## 11. Document Status and Governance

This is a research artifact, not a design document. It does not follow DESIGN_DOC_TEMPLATE.md and does not have a four-state lifecycle. It is a living reference that informs Doc 14 (Master Architecture Document) and NexSys product planning.

**Invariants cited:** INV-LF-01, INV-LF-02, INV-LF-05, INV-CE-01, INV-CE-02, INV-CE-04, INV-CE-05, INV-EI-01 through INV-EI-05, INV-ES-01, INV-RF-01, INV-RF-06, INV-PR-01, INV-PR-02, INV-PR-03, INV-SE-03.

**Locked decisions cited:** LTD-01 through LTD-17 (all).

**PROJECT_STATUS update needed:** Track C (Portability Audit research) status should move from "Planning" to "Draft complete." The Parallelization Plan table should reflect this.