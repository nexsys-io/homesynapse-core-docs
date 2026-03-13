# HomeSynapse Core — Implementation Plan v1

**Document type:** Governance — Execution Plan
**Status:** Locked
**Effective date:** 2026-03-10
**Owner:** nick@nexsys.io

This document is the definitive plan for Phases 2 and 3 of HomeSynapse Core development. It defines the repository structure, agent context architecture, interface specification workflow, test-driven implementation sequence, consistency enforcement strategy, module dependency map, and scaffold file list. Someone reading only this document can execute Phases 2 and 3 without ambiguity.

---

## 1. Repository Structure

The `homesynapse-core` repository follows Doc 14 §3.6 exactly, with additions for documentation, specifications, spikes, CI, and agent context. Base Java package: `com.homesynapse`.

```
homesynapse-core/
│
├── CONTEXT.md                              # Agent context primer (§2 of this document)
├── LICENSE                                 # Proprietary (transition guide §3)
├── README.md                               # Build instructions, license notice
├── settings.gradle.kts                     # Root project name + all 19 module declarations
├── .gitignore                              # Gradle, IntelliJ, macOS, .DS_Store
│
├── .github/
│   └── workflows/
│       ├── ci.yml                          # ./gradlew check on push
│       └── api-compat.yml                  # japicmp + oasdiff on PR (Phase 3)
│
├── gradle/
│   ├── libs.versions.toml                  # Version catalog (transition guide §5)
│   └── wrapper/
│       ├── gradle-wrapper.jar
│       └── gradle-wrapper.properties
│
├── build-logic/                            # Convention plugins (included build)
│   ├── settings.gradle.kts
│   ├── build.gradle.kts
│   └── src/main/kotlin/
│       └── homesynapse.java-conventions.gradle.kts
│           # Java 21 toolchain, -Xlint:all -Werror,
│           # Spotless copyright header, common test config,
│           # modules-graph-assert dependency rules
│
├── platform/
│   ├── platform-api/                       # HealthReporter, PlatformPaths (Doc 12 §8)
│   │   ├── build.gradle.kts
│   │   ├── MODULE_CONTEXT.md
│   │   ├── src/main/java/
│   │   │   ├── module-info.java            # Phase 2 (API-surface module)
│   │   │   └── com/homesynapse/platform/
│   │   │       ├── package-info.java
│   │   │       ├── HealthReporter.java
│   │   │       └── PlatformPaths.java
│   │   └── src/test/java/com/homesynapse/platform/
│   │
│   └── platform-systemd/                   # SystemdHealthReporter, LinuxSystemPaths
│       ├── build.gradle.kts
│       ├── MODULE_CONTEXT.md
│       └── src/
│           ├── main/java/com/homesynapse/platform/systemd/
│           │   └── internal/               # Unexported implementation
│           └── test/java/com/homesynapse/platform/systemd/
│
├── core/
│   ├── event-model/                        # Doc 01: types, envelope, publisher, store, bus interfaces
│   │   ├── build.gradle.kts
│   │   ├── MODULE_CONTEXT.md
│   │   ├── src/main/java/
│   │   │   ├── module-info.java            # Phase 2 (API-surface module)
│   │   │   └── com/homesynapse/event/
│   │   │       ├── package-info.java
│   │   │       ├── model/                  # EventEnvelope, DomainEvent (sealed), EventPriority, EventOrigin, CausalContext
│   │   │       ├── publish/               # EventPublisher
│   │   │       ├── store/                 # EventStore interface
│   │   │       ├── bus/                   # EventBus, SubscriptionFilter, SubscriberLifecycle, ProcessingMode
│   │   │       └── upcasting/             # UpcasterRegistry, Upcaster
│   │   └── src/test/java/com/homesynapse/event/
│   │
│   ├── device-model/                       # Doc 02: Device, Entity, Capability, registries
│   │   ├── build.gradle.kts
│   │   ├── MODULE_CONTEXT.md
│   │   ├── src/main/java/
│   │   │   ├── module-info.java            # Phase 2 (API-surface module)
│   │   │   └── com/homesynapse/device/
│   │   │       ├── package-info.java
│   │   │       ├── model/                 # Device, Entity, Capability (sealed), EntityType, HardwareIdentifier, AttributeValue (sealed)
│   │   │       ├── registry/              # DeviceRegistry, EntityRegistry, CapabilityRegistry
│   │   │       ├── command/               # CommandValidator, ExpectationFactory, Expectation (sealed), CommandDefinition
│   │   │       ├── discovery/             # DiscoveryPipeline, ProposedDevice
│   │   │       └── replacement/           # DeviceReplacementService
│   │   └── src/test/java/com/homesynapse/device/
│   │
│   ├── state-store/                        # Doc 03: projection, query service
│   │   ├── build.gradle.kts
│   │   ├── MODULE_CONTEXT.md
│   │   └── src/
│   │       ├── main/java/com/homesynapse/state/
│   │       │   ├── package-info.java
│   │       │   ├── model/                 # EntityState, StateSnapshot
│   │       │   ├── projection/            # StateProjection
│   │       │   └── query/                 # StateQueryService
│   │       └── test/java/com/homesynapse/state/
│   │
│   ├── persistence/                        # Doc 04: event store impl, telemetry, maintenance
│   │   ├── build.gradle.kts
│   │   ├── MODULE_CONTEXT.md
│   │   └── src/
│   │       ├── main/java/com/homesynapse/persistence/
│   │       │   ├── package-info.java
│   │       │   ├── event/                 # SQLiteEventStore
│   │       │   │   └── internal/          # Unexported implementation
│   │       │   ├── telemetry/             # TelemetryStore, TelemetryWriter
│   │       │   ├── checkpoint/            # CheckpointService
│   │       │   ├── maintenance/           # RetentionService, VacuumService
│   │       │   └── migration/             # SchemaMigrator
│   │       │       └── internal/
│   │       └── test/java/com/homesynapse/persistence/
│   │
│   ├── event-bus/                          # Doc 01 implementation: InProcessEventBus
│   │   ├── build.gradle.kts
│   │   ├── MODULE_CONTEXT.md
│   │   └── src/
│   │       ├── main/java/com/homesynapse/event/bus/
│   │       │   └── internal/              # InProcessEventBus, dispatch logic
│   │       └── test/java/com/homesynapse/event/bus/
│   │
│   └── automation/                         # Doc 07: TCA engine
│       ├── build.gradle.kts
│       ├── MODULE_CONTEXT.md
│       └── src/
│           ├── main/java/com/homesynapse/automation/
│           │   ├── package-info.java
│           │   ├── model/                 # AutomationDefinition, Run, Trigger, Condition, Action
│           │   ├── registry/              # AutomationRegistry
│           │   ├── execution/             # RunManager, trigger evaluation
│           │   │   └── internal/
│           │   ├── command/               # CommandDispatchService, PendingCommandLedger
│           │   │   └── internal/
│           │   └── cascade/               # CascadeGovernor
│           └── test/java/com/homesynapse/automation/
│
├── integration/
│   ├── integration-api/                    # Doc 05: adapter-facing contracts
│   │   ├── build.gradle.kts
│   │   ├── MODULE_CONTEXT.md
│   │   ├── src/main/java/
│   │   │   ├── module-info.java            # Phase 2 (API-surface module)
│   │   │   └── com/homesynapse/integration/
│   │   │       ├── package-info.java
│   │   │       ├── api/                   # IntegrationAdapter, IntegrationFactory, IntegrationContext
│   │   │       ├── health/               # HealthReporter (integration-level), HealthState, HealthParameters
│   │   │       ├── command/              # CommandHandler, CommandEnvelope
│   │   │       ├── descriptor/           # IntegrationDescriptor, IoType, RequiredService
│   │   │       └── exception/            # PermanentIntegrationException
│   │   └── src/test/java/com/homesynapse/integration/
│   │
│   ├── integration-runtime/                # Doc 05: supervisor, health state machine
│   │   ├── build.gradle.kts
│   │   ├── MODULE_CONTEXT.md
│   │   └── src/
│   │       ├── main/java/com/homesynapse/integration/runtime/
│   │       │   └── internal/              # IntegrationSupervisor impl, HealthStateMachine, thread allocation
│   │       └── test/java/com/homesynapse/integration/runtime/
│   │
│   └── integration-zigbee/                 # Doc 08: Zigbee adapter (depends on integration-api ONLY per LTD-17)
│       ├── build.gradle.kts
│       ├── MODULE_CONTEXT.md
│       └── src/
│           ├── main/java/com/homesynapse/integration/zigbee/
│           │   ├── package-info.java
│           │   ├── internal/              # All implementation is internal
│           │   │   ├── transport/         # ZNP/EZSP transport, serial I/O
│           │   │   ├── protocol/          # ZCL, cluster handlers
│           │   │   ├── device/            # Interview pipeline, profiles
│           │   │   ├── codec/             # Tuya DP, Xiaomi TLV
│           │   │   └── network/           # Topology, security, permit-join
│           │   └── ZigbeeIntegrationFactory.java  # ServiceLoader entry point
│           └── test/java/com/homesynapse/integration/zigbee/
│
├── config/
│   └── configuration/                      # Doc 06: config loading, secrets, schemas
│       ├── build.gradle.kts
│       ├── MODULE_CONTEXT.md
│       └── src/
│           ├── main/java/com/homesynapse/config/
│           │   ├── package-info.java
│           │   ├── loading/              # Six-stage pipeline
│           │   │   └── internal/
│           │   ├── schema/               # Schema composition, validation
│           │   ├── secret/               # SecretStore (AES-256-GCM)
│           │   │   └── internal/
│           │   ├── migration/            # ConfigMigrator
│           │   └── reload/               # Hot reload, atomic swap
│           │       └── internal/
│           ├── main/resources/schema/     # Co-located JSON Schema for config namespace
│           │   └── config-system.schema.json
│           └── test/java/com/homesynapse/config/
│
├── api/
│   ├── rest-api/                           # Doc 09: Javalin REST endpoints
│   │   ├── build.gradle.kts
│   │   ├── MODULE_CONTEXT.md
│   │   └── src/
│   │       ├── main/java/com/homesynapse/api/rest/
│   │       │   ├── package-info.java
│   │       │   └── internal/              # All endpoint implementations are internal
│   │       │       ├── endpoint/          # Per-operational-plane handlers
│   │       │       ├── error/             # RFC 9457 Problem Details
│   │       │       ├── auth/              # API key validation
│   │       │       ├── pagination/        # Cursor-based pagination
│   │       │       └── middleware/        # Rate limiting, correlation ID
│   │       ├── main/resources/schema/
│   │       │   └── api.schema.json
│   │       └── test/java/com/homesynapse/api/rest/
│   │
│   └── websocket-api/                      # Doc 10: WebSocket relay
│       ├── build.gradle.kts
│       ├── MODULE_CONTEXT.md
│       └── src/
│           ├── main/java/com/homesynapse/api/websocket/
│           │   ├── package-info.java
│           │   └── internal/
│           │       ├── relay/             # EventRelay subscriber
│           │       ├── connection/        # Connection lifecycle, auth
│           │       ├── subscription/      # Filter management, resume
│           │       └── backpressure/      # Four-stage escalation
│           └── test/java/com/homesynapse/api/websocket/
│
├── observability/
│   └── observability/                      # Doc 11: health, traces, JFR
│       ├── build.gradle.kts
│       ├── MODULE_CONTEXT.md
│       └── src/
│           ├── main/java/com/homesynapse/observability/
│           │   ├── package-info.java
│           │   ├── health/               # HealthAggregator, HealthContributor (exported)
│           │   ├── trace/                # TraceQueryService (exported)
│           │   └── internal/
│           │       ├── jfr/              # Custom JFR events, recording management
│           │       └── metrics/          # MetricsStreamBridge
│           ├── main/resources/schema/
│           │   └── observability.schema.json
│           └── test/java/com/homesynapse/observability/
│
├── web-ui/
│   └── dashboard/                          # Doc 13: Preact SPA (LTD-18)
│       ├── build.gradle.kts                # Packages pre-built static files into JAR
│       ├── MODULE_CONTEXT.md
│       ├── package.json                    # Vite + Preact
│       └── src/                            # Preact component tree (Phase 3)
│
├── lifecycle/
│   └── lifecycle/                          # Doc 12: startup, shutdown, watchdog
│       ├── build.gradle.kts
│       ├── MODULE_CONTEXT.md
│       └── src/
│           ├── main/java/com/homesynapse/lifecycle/
│           │   ├── package-info.java
│           │   └── internal/
│           │       ├── startup/           # SystemLifecycleManager impl, phase sequencing
│           │       ├── shutdown/          # Graceful shutdown orchestration
│           │       └── watchdog/          # Systemd watchdog protocol
│           └── test/java/com/homesynapse/lifecycle/
│
├── app/
│   └── homesynapse-app/                    # Assembly: main class, jlink, systemd unit
│       ├── build.gradle.kts
│       └── src/
│           ├── main/java/com/homesynapse/app/
│           │   └── Main.java
│           └── test/java/com/homesynapse/app/
│
├── testing/
│   └── test-support/                       # Shared test infrastructure
│       ├── build.gradle.kts
│       └── src/main/java/com/homesynapse/test/
│           ├── package-info.java
│           ├── InMemoryEventStore.java     # Non-persistent EventStore for unit tests
│           ├── SynchronousEventBus.java    # Synchronous dispatch for deterministic tests
│           ├── TestFixtures.java           # Builders for Event, Device, Entity instances
│           ├── TestIntegrationContext.java  # Mock IntegrationContext for adapter tests
│           ├── TestClock.java              # Controllable clock for time-dependent tests
│           └── NoRealIoExtension.java      # JUnit extension: fails on real network/filesystem I/O
│
├── specs/                                  # API specifications (spec-first)
│   ├── README.md                           # How to validate, how specs relate to code
│   ├── openapi/
│   │   └── homesynapse-rest-api-v1.yaml    # OpenAPI 3.1 (Doc 09)
│   └── asyncapi/
│       └── homesynapse-websocket-v1.yaml   # AsyncAPI 3.0 (Doc 10)
│
├── docs/                                   # Code-repo documentation
│   ├── ARCHITECTURE.md                     # Architecture overview with links to design docs
│   ├── TESTING.md                          # Test strategy, how to run, category definitions
│   ├── decisions/                          # ADRs (MADR format)
│   │   ├── 0001-adr-adoption.md
│   │   └── template.md
│   └── traceability/                       # Per-subsystem design-to-code maps
│       ├── 01-event-model.md
│       ├── 02-device-model.md
│       ├── 03-state-store.md
│       ├── 04-persistence.md
│       ├── 05-integration-runtime.md
│       ├── 06-configuration.md
│       ├── 07-automation.md
│       ├── 08-zigbee-adapter.md
│       ├── 09-rest-api.md
│       ├── 10-websocket-api.md
│       ├── 11-observability.md
│       ├── 12-lifecycle.md
│       ├── 13-web-ui.md
│       └── 14-master-architecture.md
│
└── spike/                                  # Throwaway spike code (Phase Guide rules apply)
    └── README.md                           # "Everything here is throwaway. Findings go to docs repo."
```

**Module count:** 18 Gradle modules (matching Doc 14 §3.6) + 1 test-support module = 19 total.

**Package convention:** `com.homesynapse.<subsystem>` for exported API packages. `com.homesynapse.<subsystem>.internal` for unexported implementation. Mirrors OpenHAB's `!*.internal.*` pattern, enforced by JPMS `module-info.java` on API-surface modules and by ArchUnit tests on all modules.

---

## 2. CONTEXT.md Content

The following is the complete content of `CONTEXT.md` at the repository root. Every LTD line is transcribed from the Locked Decisions Register. Every INV category is transcribed from the Architecture Invariants document. Maximum 100 lines.

```markdown
# HomeSynapse Core — Agent Context Primer

Read this file before any work session. It is the constitutional context for all agents.
Full details: homesynapse-core-docs repo. Do not paraphrase — cite by identifier.

## Locked Technical Decisions (18 LTDs — cite as LTD-NN)

- LTD-01: Java 21 LTS. Corretto 21.0.10.7.1. G1GC. -Xms512m -Xmx1536m -Xss512k. Virtual threads. Records, sealed interfaces, pattern matching. No preview features.
- LTD-02: Raspberry Pi 5 (4–8 GB) recommended target. Pi 4 (4 GB) validation floor. NVMe required for production. SD card detected and warned, not prevented.
- LTD-03: SQLite WAL mode. synchronous=NORMAL. cache_size=-128000 (128 MB). mmap_size=1 GB. busy_timeout=5000. Pluggable via EventStore interface. xerial sqlite-jdbc 3.51.2.0.
- LTD-04: ULID for all event and entity identity. MonotonicUlid for events, standard Ulid for entities. BLOB(16) in SQLite. Typed wrappers: EntityId, DeviceId, AreaId, AutomationId, PersonId, HomeId, EventId.
- LTD-05: Per-entity sequences (subject_sequence) for optimistic concurrency + SQLite rowid as global_position for cross-entity subscriptions. Correlation ID and Causation ID on every event.
- LTD-06: Write-ahead persistence. Events persisted to SQLite before subscriber delivery. At-least-once delivery. Subscribers must be idempotent. Event store IS the outbox.
- LTD-07: Hand-rolled forward-only SQL migrations. Mandatory backup-before-migrate. Flyway-compatible naming (V001__description.sql). Schema version tracking table. ≤200 LOC threshold for runner.
- LTD-08: Jackson 2.18+ with Blackbird module. Singleton ObjectMapper. SNAKE_CASE naming strategy. EventSerializer abstraction boundary. Pre-built ObjectReader/ObjectWriter for hot paths.
- LTD-09: YAML 1.2 via SnakeYAML Engine (not jackson-dataformat-yaml). JSON Schema validation via networknt. Config in /etc/homesynapse/. homesynapse validate-config CLI command.
- LTD-10: Gradle with Kotlin DSL. Convention plugins in build-logic/ (included build). Version catalogs (gradle/libs.versions.toml). modules-graph-assert for dependency enforcement. No on-device builds.
- LTD-11: In-process event bus. Virtual thread per subscriber. No external broker. ConcurrentHashMap subscriber lists. ArrayBlockingQueue(1000) per subscriber. EventPublisher interface abstracts dispatch.
- LTD-12: Zigbee only in MVP. USB coordinator (CC2652, EFR32). Protocol-agnostic device model from day one. Z-Wave is natural second adapter.
- LTD-13: jlink custom runtime (~70–90 MB). systemd service unit. Dedicated homesynapse user. FHS layout: /opt/homesynapse/ (read-only runtime), /etc/homesynapse/ (config), /var/lib/homesynapse/ (data), /var/log/homesynapse/ (logs). MemoryMax=2G. ProtectSystem=strict. WatchdogSec=60.
- LTD-14: CLI-driven upgrade. Mandatory pre-upgrade snapshot via VACUUM INTO. Dry-run migration on copy. Rollback restores snapshot. No auto-update. Last 3 snapshots retained.
- LTD-15: SLF4J 2.x + Logback 1.5.x + logstash-logback-encoder for structured JSON logs. JFR continuous recording (maxsize=100m, maxage=6h). Custom JFR events for application metrics. No Prometheus/OTEL in MVP.
- LTD-16: Semantic versioning. URL-versioned REST (/api/v1/). Additive-only within major version. Minimum one-major-version deprecation window. OpenAPI 3.1 is REST API source of truth. AsyncAPI for WebSocket.
- LTD-17: In-process compiled integrations. integration-zigbee depends on integration-api ONLY, never core/. Enforced by Gradle modules + modules-graph-assert + ArchUnit + JPMS. API boundary is the investment; loading mechanism is swappable.
- LTD-18: Preact SPA for observability dashboard (/dashboard/). Vite build. <100 KB gzipped bundle. uPlot for charting. Static files in jlink distribution. HTMX reserved for Tier 2+ config UI.

## Architecture Invariants (15 categories, 79 invariants — cite as INV-XX-NN)

- INV-LF (Local-First Operation): LF-01 core without internet, LF-02 cloud enhances never controls, LF-03 graceful WAN degradation, LF-04 no required cloud account, LF-05 convergent sync.
- INV-ES (Event Sourcing): ES-01 immutable events, ES-02 state derivable from events, ES-03 per-entity ordering with causal consistency, ES-04 write-ahead persistence, ES-05 at-least-once with idempotency, ES-06 every state change explainable, ES-07 event schema evolution, ES-08 event time vs ingest time distinct.
- INV-RF (Reliability): RF-01 integration isolation, RF-02 resource quotas, RF-03 startup independence, RF-04 crash safety and auto recovery, RF-05 bounded storage, RF-06 graceful degradation.
- INV-CS (Compatibility): CS-01 semantic versioning, CS-02 stable entity identifiers, CS-03 config schema stability, CS-04 integration API stability, CS-05 update safety, CS-06 deprecation discipline, CS-07 no forced hardware obsolescence.
- INV-HO (Household Operability): HO-01 physical control supremacy, HO-02 operable under degradation, HO-03 no debugging for daily operation, HO-04 self-explaining errors, HO-05 the partner test.
- INV-PD (Privacy): PD-01 zero telemetry by default, PD-02 user-controlled data residency, PD-03 encrypted storage, PD-04 transparent data boundaries, PD-05 granular revocable consent, PD-06 offline integrity, PD-07 crypto-shredding, PD-08 tamper-evident integrity.
- INV-TO (Transparency): TO-01 observable behavior, TO-02 automation determinism, TO-03 no hidden state, TO-04 structured queryable logs.
- INV-CE (Configuration): CE-01 canonical human-readable config, CE-02 zero-config first run, CE-03 documented versioned config schema, CE-04 protocol agnosticism, CE-05 extension model with stability, CE-06 migration tooling.
- INV-PR (Performance): PR-01 constrained hardware primary target, PR-02 quantitative performance targets, PR-03 bounded predictable resources, PR-04 architecture accommodates 1000 devices.
- INV-SE (Security): SE-01 no default credentials, SE-02 auth required for all external interfaces, SE-03 secrets encrypted at rest, SE-04 least privilege for integrations, SE-05 remote access E2E encrypted, SE-06 security updates without feature churn.
- INV-AI (AI Intelligence): AI-01 enhancement never foundation, AI-02 explicit consent, AI-03 explainable decisions, AI-04 local AI capability, AI-05 on-device behavior modeling.
- INV-EI (Energy Intelligence): EI-01 energy as first-class domain, EI-02 grid-interactive by design, EI-03 carbon-aware scheduling, EI-04 energy data sovereignty, EI-05 hardware-agnostic metering.
- INV-MU (Multi-User): MU-01 identity-aware device model, MU-02 spatial presence as primitive, MU-03 preference arbitration, MU-04 household role model, MU-05 graceful identity degradation.
- INV-MN (Mesh/Network): MN-01 protocol-agnostic network telemetry, MN-02 mesh health as observable state, MN-03 predictive network diagnostics, MN-04 battery-aware optimization.
- INV-GA (Governance): GA-01 invariant stability, GA-02 permanent identifiers, GA-03 compliance verified in review.

## Module Dependency Rules

- integration-zigbee → integration-api ONLY (never core/). Enforced by Gradle + modules-graph-assert + ArchUnit + JPMS.
- core/ modules may depend on other core/ modules per subsystem dependency graph. No cycles.
- platform-api has zero HomeSynapse dependencies. platform-systemd depends only on platform-api.
- homesynapse-app depends on everything (assembly module).
- dashboard has no compile-time Java dependencies (pre-built static files only).
- Enforced: modules-graph-assert in CI, ArchUnit tests, JPMS module-info.java on API-surface modules.

## Code Standards

- Java 21 source/target. No preview features. Records, sealed interfaces, pattern matching for switch.
- Virtual threads for all I/O except serial port (platform thread). Named thread groups per integration.
- Javadoc on every public method: preconditions, postconditions, @throws with conditions, thread safety, @see link to design doc section.
- Copyright header on every file (Spotless enforced). SPDX: LicenseRef-NexSys-Proprietary.
- -Xlint:all -Werror. Zero warnings.
- Exported packages: com.homesynapse.<subsystem>. Internal packages: com.homesynapse.<subsystem>.internal.
- Singleton ObjectMapper (LTD-08). SNAKE_CASE wire format, camelCase Java fields.
- All identifiers use typed ULID wrappers (LTD-04). Never raw ULID or String for identity.
- Tests first. No implementation without a failing test (Phase 3 rule).
```

**Line count:** 58 lines (well within 100-line limit).

---

## 3. Phase 2 Plan

### 3.0 Pre-Wave: Reference Artifact Production

Before interface specification begins, produce three reference artifacts in the `homesynapse-core-docs/reference/` directory. These are compilation exercises from the 14 locked design documents and directly feed Phase 2 work.

| Artifact | Feeds | Source |
|---|---|---|
| `event-type-registry.md` | DomainEvent sealed hierarchy, EventPriority assignments, event_category mappings | All 14 design docs' event type tables |
| `subscriber-registry.md` | EventBus subscription contracts, SubscriptionFilter instances, checkpoint strategies | Docs 01, 03, 04, 07, 10, 11 subscriber definitions |
| `configuration-schema-registry.md` | JSON Schema files per subsystem, default values, validation rules | All 14 design docs' §9 Configuration sections |

These artifacts resolve ambiguity before interface specification begins. The event-type-registry determines the number and shape of DomainEvent subtypes in the sealed hierarchy. The subscriber-registry determines SubscriptionFilter constructors. The config-schema-registry prevents namespace collisions.

### 3.1 Scaffold Setup

First Phase 2 task. Creates the repository skeleton per transition guide §8:

1. `settings.gradle.kts` with root project name and all 19 module declarations (empty modules).
2. `gradle/libs.versions.toml` with version catalog from transition guide §5.
3. `build-logic/` with `homesynapse.java-conventions.gradle.kts` convention plugin: Java 21 toolchain, Spotless copyright header check, `-Xlint:all -Werror`, common test configuration, modules-graph-assert rules.
4. Root `LICENSE`, `README.md`, `CONTEXT.md`, `.gitignore`.
5. `.github/workflows/ci.yml` with `./gradlew check` on push.
6. Empty `build.gradle.kts` in each of the 19 modules.
7. `specs/`, `docs/`, `spike/` directory structure with README files.

All modules compile to empty JARs. Phase 2 populates them.

### 3.2 Production Order (Waves)

Interface specifications follow the subsystem dependency graph from MVP §9.3. Modules within a wave have no inter-dependencies and can be specified in parallel.

**Wave 1 — Foundation (no upstream HomeSynapse dependencies):**

| Module | Design Doc | Deliverables | JPMS |
|---|---|---|---|
| `platform-api` | Doc 12 §8 | HealthReporter, PlatformPaths interfaces | module-info.java |
| `event-model` | Doc 01 | EventEnvelope, DomainEvent (sealed hierarchy from event-type-registry), EventPublisher, EventStore, EventBus, SubscriptionFilter, SubscriberLifecycle, ProcessingMode, CausalContext, EventPriority, EventOrigin, UpcasterRegistry, all typed ID wrappers | module-info.java |

**Quality gate after Wave 1:** All ID types (`EventId`, `EntityId`, `DeviceId`, etc.) defined. DomainEvent sealed hierarchy complete. EventPublisher and EventBus contracts defined. `./gradlew check` passes.

**Wave 2 — Core Domain (depends on event-model):**

| Module | Design Doc | Deliverables | JPMS | AMD Integration |
|---|---|---|---|---|
| `device-model` | Doc 02 | Device, Entity, Capability (sealed), EntityType, registries, command validation, ExpectationFactory, discovery pipeline | module-info.java | — |
| `integration-api` | Doc 05 | IntegrationAdapter, IntegrationFactory, IntegrationContext, IntegrationDescriptor, CommandHandler, CommandEnvelope, HealthState, IoType, RequiredService, PermanentIntegrationException | module-info.java | AMD-20 (restart jitter → HealthParameters field) |
| `configuration` | Doc 06 | ConfigurationService, ConfigMigrator, SecretStore, schema validation interfaces | — | AMD-12 (structured error taxonomy → exception hierarchy for config validation) |

**Quality gate after Wave 2:** All device/entity types defined. Integration API surface complete. Config validation model defined. Cross-module type references resolve. `./gradlew check` passes.

**Wave 3 — Derived Domain (depends on Waves 1+2):**

| Module | Design Doc | Deliverables | AMD Integration |
|---|---|---|---|
| `state-store` | Doc 03 | StateProjection, StateQueryService, EntityState (with AMD-11 staleness fields), StateSnapshot, checkpoint interfaces | — |
| `automation` | Doc 07 | AutomationRegistry, RunManager, CommandDispatchService, PendingCommandLedger, trigger/condition/action model, CascadeGovernor | AMD-18 (causal chain timeout), AMD-21 (conflict resolution) |
| `persistence` | Doc 04 | SQLiteEventStore interface contract, TelemetryStore, TelemetryWriter, CheckpointService, RetentionService, SchemaMigrator | AMD-23 (telemetry compaction trigger) |

**Quality gate after Wave 3:** State query path complete (event → projection → query). Automation model complete. Persistence contracts defined. `./gradlew check` passes.

**Wave 4 — External Interfaces (depends on Waves 1–3):**

| Module | Design Doc | Deliverables | AMD Integration |
|---|---|---|---|
| `event-bus` | Doc 01 | InProcessEventBus implementation contract, dispatch interfaces | AMD-19 (subscriber backpressure signal) |
| `integration-runtime` | Doc 05 | IntegrationSupervisor, HealthStateMachine, thread allocation interfaces | — |
| `rest-api` | Doc 09 | Endpoint contracts, RFC 9457 error model, pagination, ETag, rate limiting, auth interfaces | AMD-24 (API key rotation) |
| `websocket-api` | Doc 10 | EventRelay, subscription model, backpressure escalation interfaces | — |
| `observability` | Doc 11 | HealthAggregator, HealthContributor, TraceQueryService, MetricsStreamBridge | AMD-22 (HealthChangeListener) |

**Quality gate after Wave 4:** Full API surface defined. OpenAPI 3.1 spec written for REST. AsyncAPI 3.0 spec written for WebSocket. oasdiff baseline established. `./gradlew check` passes.

**Wave 5 — Assembly (depends on all preceding):**

| Module | Design Doc | Deliverables |
|---|---|---|
| `integration-zigbee` | Doc 08 | ZigbeeIntegrationFactory, ZigbeeAdapter type stubs (internal implementation deferred to Phase 3) |
| `lifecycle` | Doc 12 | SystemLifecycleManager, phase model, shutdown interfaces |
| `dashboard` | Doc 13 | package.json, Vite config, component stubs |
| `platform-systemd` | Doc 12 | SystemdHealthReporter, LinuxSystemPaths type stubs |
| `homesynapse-app` | — | Main class stub |
| `test-support` | — | InMemoryEventStore, SynchronousEventBus, TestFixtures, TestIntegrationContext, TestClock, NoRealIoExtension |

**Quality gate after Wave 5:** All 19 modules compile. Full project `./gradlew check` passes with zero warnings. All MODULE_CONTEXT.md files written. All traceability files have Phase 2 columns populated.

### 3.3 Parallel Deliverables (produced alongside waves)

| Deliverable | Timing | Location |
|---|---|---|
| JSON Schema per config namespace | With each module's wave | `<module>/src/main/resources/schema/` |
| OpenAPI 3.1 for REST API | Wave 4 (rest-api) | `specs/openapi/homesynapse-rest-api-v1.yaml` |
| AsyncAPI 3.0 for WebSocket | Wave 4 (websocket-api) | `specs/asyncapi/homesynapse-websocket-v1.yaml` |
| MODULE_CONTEXT.md per module | With each module | `<module>/MODULE_CONTEXT.md` |
| Traceability matrix per subsystem | With each module | `docs/traceability/<NN>-<name>.md` |

### 3.4 Per-Module Workflow

For each module in wave order:

1. PM reads the locked design document (§3 Technical Design, §5 External Interfaces, §8 Key Interfaces, §9 Configuration).
2. PM reads the Glossary for canonical type and method names.
3. PM reads upstream MODULE_CONTEXT.md files for consumed types.
4. PM writes Java interfaces, records, enums, sealed interfaces with full Javadoc (`@see` to design doc section, preconditions, postconditions, `@throws`, thread safety).
5. PM writes the module's JSON Schema (validated against design doc §9 defaults).
6. PM writes MODULE_CONTEXT.md (max 50 lines: Design Doc Reference, Dependencies, Consumers, Constraints, Gotchas).
7. PM updates the traceability file for this subsystem.
8. Compilation check: `./gradlew check` passes.
9. Hivemind reviews MODULE_CONTEXT.md for cross-module consistency.

### 3.5 RECOMMENDED Amendment Protocol

When the PM encounters a RECOMMENDED amendment (AMD-12, AMD-18–24) during interface specification:

1. PM drafts the amendment text for the design document in the docs repo.
2. Hivemind reviews the amendment for strategic alignment.
3. Nick applies the amendment to the design document.
4. PM then defines the interface in the code repo reflecting the amended design.

Design docs stay authoritative. Code never silently diverges.

---

## 4. Phase 3 Plan

### 4.0 WAL Validation Spike

First Phase 3 task. Confirms sqlite-jdbc 3.51.2.0 on aarch64 Linux (per transition guide §2):

1. WAL mode activates correctly on ext4 filesystem (RPi 5 NVMe).
2. `PRAGMA journal_mode=WAL` persists across connection close/reopen.
3. `PRAGMA synchronous=NORMAL` does not produce corruption under kill -9 during sustained writes.
4. Page cache memory usage (`PRAGMA cache_size`) behaves as expected under 128 MB allocation.
5. Native library extracts correctly from jlink image (no `java.io.tmpdir` conflicts with systemd `PrivateTmp=true`).

Results recorded in `homesynapse-core-docs/research/sqlite-wal-validation-spike.md`. Spike code lives in `spike/wal-validation/`. If the spike reveals problems, the sqlite-jdbc version is revised before any further Phase 3 work.

### 4.1 Test-Driven Development Cycle

For every module, the cycle is inviolable:

```
Write tests against Phase 2 interfaces → Verify tests COMPILE but FAIL →
Write implementation → Verify all tests PASS → Integration tests with upstream
```

The Hivemind does not issue implementation task briefs until the test suite exists and fails.

### 4.2 Four Test Categories Per Module

Written in this order for each module:

**Category 1 — Contract Tests** (written before implementation)
Test the behavioral contracts from the design doc. These test *what*, not *how*.

**Category 2 — Edge Case and Error Tests** (written with contract tests)
Test failure modes from each design doc's §6 and security constraints from §12.

**Category 3 — Integration Tests** (written after implementation, before next module)
Test interactions between this module and its dependencies.

**Category 4 — Performance Tests** (written last per module)
Validate targets from each design doc's §10, measured on RPi 5 (primary) and RPi 4 (floor).

### 4.3 Test Infrastructure (test-support module)

| Class | Purpose | Inspired By |
|---|---|---|
| `InMemoryEventStore` | Non-persistent EventStore for unit tests. Avoids SQLite in every test. | OpenHAB's in-memory ItemProvider |
| `SynchronousEventBus` | Delivers events immediately (no async dispatch). Deterministic tests. | Home Assistant's test event bus |
| `TestFixtures` | Builders for EventEnvelope, Device, Entity, EntityState with sensible defaults. | Home Assistant's conftest.py fixtures |
| `TestIntegrationContext` | Mock IntegrationContext for adapter tests without full runtime. | — |
| `TestClock` | Controllable `java.time.Clock` for time-dependent behavior. | — |
| `NoRealIoExtension` | JUnit extension that fails if test code attempts real network or filesystem I/O without `@RealIo` opt-in annotation. | Home Assistant's `check_real()` decorator |

### 4.4 Implementation Order

Phase 3 follows the dependency graph. Each step's tests are written and failing before implementation begins.

**Phase 3.0 — WAL Validation Spike** (see §4.0)

**Phase 3.1 — Foundation:**

| Step | Module | Test Focus | Implementation Focus |
|---|---|---|---|
| 3.1.1 | `platform-api` | Contract tests for HealthReporter, PlatformPaths | Trivial: LinuxSystemPaths, SystemdHealthReporter |
| 3.1.2 | `event-model` | Envelope construction, serialization round-trip, type hierarchy, ULID generation | Value types, records, sealed hierarchy |
| 3.1.3 | `test-support` | N/A (test infra) | InMemoryEventStore, SynchronousEventBus, TestFixtures |
| 3.1.4 | `event-bus` | Subscriber dispatch ordering, backpressure, concurrent delivery | InProcessEventBus (~50 lines per LTD-11) |
| 3.1.5 | `persistence` | SQLite PRAGMA config, append/read round-trip, retention, migration runner, WAL checkpoint | SQLiteEventStore, TelemetryStore, SchemaMigrator |

**Phase 3.2 — Core Domain:**

| Step | Module | Test Focus | Implementation Focus |
|---|---|---|---|
| 3.2.1 | `device-model` | Attribute validation, command validation, discovery pipeline, entity type classification | Registries backed by EventStore |
| 3.2.2 | `state-store` | Projection correctness, change detection, staleness, checkpoint, REPLAY→LIVE transition | StateProjection subscriber, StateQueryService |
| 3.2.3 | `configuration` | YAML parsing, schema validation, secret resolution, hot reload, migration chain | Six-stage pipeline, SecretStore |

**Phase 3.3 — Derived Domain:**

| Step | Module | Test Focus | Implementation Focus |
|---|---|---|---|
| 3.3.1 | `automation` | Trigger matching, condition evaluation, Run lifecycle, cascade depth, command pipeline, conflict detection | RunManager, CommandDispatchService, PendingCommandLedger |
| 3.3.2 | `integration-runtime` | Health state machine, restart intensity, exception classification, thread allocation | IntegrationSupervisor |

**Phase 3.4 — External Interfaces:**

| Step | Module | Test Focus | Implementation Focus |
|---|---|---|---|
| 3.4.1 | `rest-api` | Endpoint routing, request validation, error mapping, pagination, ETag, rate limiting | Javalin endpoint handlers |
| 3.4.2 | `websocket-api` | Message protocol, subscription filters, backpressure escalation, resume | EventRelay, connection management |
| 3.4.3 | `observability` | Health aggregation, trace assembly, flapping prevention, JFR event emission | HealthAggregator, TraceQueryService |

**Phase 3.5 — Integration:**

| Step | Module | Test Focus | Implementation Focus |
|---|---|---|---|
| 3.5.1 | `integration-zigbee` | Frame parsing (UNPI, ASH), ZCL decoding, manufacturer codecs (Tuya, Xiaomi), availability, interview pipeline | Full Zigbee adapter |
| 3.5.2 | `lifecycle` | Phase ordering, dependency graph, shutdown sequence, watchdog | SystemLifecycleManager |
| 3.5.3 | `homesynapse-app` | Assembly wiring, jlink image, startup/shutdown | Main class, distribution |
| 3.5.4 | `dashboard` | Component rendering, WebSocket integration, bundle budget | Preact SPA (Vite build) |

**Phase 3.6 — End-to-End Validation:**

| Criterion | Target | Source |
|---|---|---|
| Device count | 50 Zigbee devices | MVP §8 |
| Stability | 72+ hours continuous operation | MVP §8 |
| Live heap post-GC | <512 MB steady-state | INV-PR-02, Doc 14 §3.5.3 |
| Total RSS | <2 GB (systemd MemoryMax) | LTD-13 |
| Event throughput | ≥500 events/sec sustained | Doc 14 §13.3 |
| State query latency | <5 ms p99 | Doc 03 §10 |
| REST API response | <50 ms p95 | Doc 09 §10 |
| Cold start time | <15s RPi 5, <30s RPi 4 | Doc 14 §3.4 |
| kill -9 recovery | Zero event loss, state consistent | Doc 14 §13.4 |

---

## 5. Consistency Enforcement

Four enforcement layers, from fastest feedback to deepest analysis.

### 5.1 Compile-Time Enforcement

| Mechanism | What It Catches | Tool |
|---|---|---|
| `-Xlint:all -Werror` | Unsafe code patterns, unchecked casts, deprecation usage | javac (convention plugin) |
| Spotless copyright header | Missing or incorrect copyright headers | Spotless Gradle plugin |
| JPMS `module-info.java` | Package visibility violations on API-surface modules | javac module system |
| Gradle module dependencies | Illegal dependency directions (e.g., zigbee → core/) | Gradle `implementation` configuration |
| `modules-graph-assert` | Module dependency graph violations against regex rules | modules-graph-assert Gradle plugin |

### 5.2 Test-Time Enforcement

| Mechanism | What It Catches | Tool |
|---|---|---|
| ArchUnit — import rules | `integration-zigbee` importing from `core/` packages | ArchUnit |
| ArchUnit — naming conventions | Event types not matching Glossary terms | ArchUnit |
| ArchUnit — Javadoc presence | Public interfaces missing Javadoc | ArchUnit |
| ArchUnit — Freeze Rules | New architectural violations (baseline + delta) | ArchUnit |
| Contract tests | Behavioral deviations from design doc specifications | JUnit 5 |
| JSON Schema validation tests | Config schema drift from design doc §9 defaults | networknt json-schema-validator |
| NoRealIoExtension | Test code attempting real network/filesystem I/O | Custom JUnit extension |

### 5.3 CI-Time Enforcement

| Mechanism | What It Catches | Tool | When Active |
|---|---|---|---|
| `./gradlew check` | All compile + test failures | Gradle | Every push (Phase 2+) |
| japicmp | Binary compatibility breaks on API-surface modules | japicmp Gradle plugin | Phase 3 (after baseline release) |
| oasdiff | Breaking changes in OpenAPI/AsyncAPI specs | oasdiff GitHub Action | Phase 3 (after specs baselined) |
| `@see` extraction script | Orphaned code (no design doc ref) or unimplemented design (design doc section with no code ref) | Custom script parsing Javadoc | Every PR |
| Glossary audit | Non-canonical names in code | grep script against Glossary terms | Weekly scheduled |

### 5.4 Review-Time Enforcement

| Mechanism | What It Catches | Frequency |
|---|---|---|
| Traceability matrix review | Empty cells (design not implemented, or code not traced to design) | Per-module at Phase 2 completion, per-module at Phase 3 completion |
| MODULE_CONTEXT.md review | Stale dependency/consumer lists, missing gotchas | Start of each module's Phase 3 work |
| CONTEXT.md version check | LTD/INV amendments not reflected | On any governance artifact change |
| Design-doc-change protocol | Code silently diverging from design docs | On any proposed interface change |

**Design-doc-change protocol:** Coder flags issue → PM evaluates → PM produces amendment brief → Hivemind evaluates → Nick applies amendment to docs repo → code changes. Code never silently diverges.

---

## 6. Module Dependency Table

| Module | Design Doc | Gradle Dependencies | Exported Packages | Internal Packages | Phase 2 Wave | Phase 3 Step |
|---|---|---|---|---|---|---|
| `platform-api` | Doc 12 §8 | (none) | `com.homesynapse.platform` | — | Wave 1 | 3.1.1 |
| `platform-systemd` | Doc 12 | `platform-api` | — | `com.homesynapse.platform.systemd.internal` | Wave 5 | 3.1.1 |
| `event-model` | Doc 01 | `platform-api` | `com.homesynapse.event.model`, `.publish`, `.store`, `.bus`, `.upcasting` | — | Wave 1 | 3.1.2 |
| `device-model` | Doc 02 | `event-model` | `com.homesynapse.device.model`, `.registry`, `.command`, `.discovery`, `.replacement` | — | Wave 2 | 3.2.1 |
| `integration-api` | Doc 05 | `event-model`, `device-model` | `com.homesynapse.integration.api`, `.health`, `.command`, `.descriptor`, `.exception` | — | Wave 2 | 3.3.2 |
| `configuration` | Doc 06 | `event-model` | `com.homesynapse.config.loading`, `.schema`, `.secret`, `.migration`, `.reload` | `com.homesynapse.config.*.internal` | Wave 2 | 3.2.3 |
| `state-store` | Doc 03 | `event-model`, `device-model` | `com.homesynapse.state.model`, `.projection`, `.query` | — | Wave 3 | 3.2.2 |
| `persistence` | Doc 04 | `event-model`, `state-store` | `com.homesynapse.persistence.event`, `.telemetry`, `.checkpoint`, `.maintenance`, `.migration` | `com.homesynapse.persistence.*.internal` | Wave 3 | 3.1.5 |
| `automation` | Doc 07 | `event-model`, `device-model`, `configuration`, `state-store` | `com.homesynapse.automation.model`, `.registry`, `.execution`, `.command`, `.cascade` | `com.homesynapse.automation.*.internal` | Wave 3 | 3.3.1 |
| `event-bus` | Doc 01 | `event-model` | — | `com.homesynapse.event.bus.internal` | Wave 4 | 3.1.4 |
| `integration-runtime` | Doc 05 | `integration-api`, `event-model` | — | `com.homesynapse.integration.runtime.internal` | Wave 4 | 3.3.2 |
| `rest-api` | Doc 09 | `event-model`, `device-model`, `state-store`, `automation`, `observability` | — | `com.homesynapse.api.rest.internal` | Wave 4 | 3.4.1 |
| `websocket-api` | Doc 10 | `event-model`, `event-bus` | — | `com.homesynapse.api.websocket.internal` | Wave 4 | 3.4.2 |
| `observability` | Doc 11 | `event-model`, `state-store` | `com.homesynapse.observability.health`, `.trace` | `com.homesynapse.observability.internal` | Wave 4 | 3.4.3 |
| `integration-zigbee` | Doc 08 | `integration-api` ONLY | — | `com.homesynapse.integration.zigbee.internal` | Wave 5 | 3.5.1 |
| `lifecycle` | Doc 12 | `platform-api`, `event-model`, `observability`, (all subsystem modules) | — | `com.homesynapse.lifecycle.internal` | Wave 5 | 3.5.2 |
| `dashboard` | Doc 13 | (none — static files) | — | — | Wave 5 | 3.5.4 |
| `homesynapse-app` | — | (all modules) | — | `com.homesynapse.app` | Wave 5 | 3.5.3 |
| `test-support` | — | `event-model`, `device-model`, `integration-api` | `com.homesynapse.test` | — | Wave 5 | 3.1.3 |

**19 modules total.** All 7 columns filled.

---

## 7. Scaffold File List

Every file the scaffold setup session creates. File path and one-line description.

### Root Files

| File | Description |
|---|---|
| `settings.gradle.kts` | Root project name `homesynapse-core`, includeBuild for `build-logic`, include for all 19 modules |
| `build.gradle.kts` | Root build file (minimal — applies modules-graph-assert, defines dependency rules) |
| `CONTEXT.md` | Agent context primer (content defined in §2 of this document) |
| `LICENSE` | Proprietary notice (transition guide §3) |
| `README.md` | Project name, license notice, build instructions, link to docs repo |
| `.gitignore` | Gradle, IntelliJ, macOS, .DS_Store, *.class, build/, .gradle/ |
| `gradlew` | Gradle wrapper script (Unix) |
| `gradlew.bat` | Gradle wrapper script (Windows) |

### Gradle

| File | Description |
|---|---|
| `gradle/libs.versions.toml` | Version catalog (transition guide §5 with verified versions) |
| `gradle/wrapper/gradle-wrapper.jar` | Gradle wrapper binary |
| `gradle/wrapper/gradle-wrapper.properties` | Gradle wrapper version config |

### Build Logic

| File | Description |
|---|---|
| `build-logic/settings.gradle.kts` | Included build settings (declares convention plugin project) |
| `build-logic/build.gradle.kts` | Convention plugin build (depends on Gradle plugin APIs, Spotless, modules-graph-assert) |
| `build-logic/src/main/kotlin/homesynapse.java-conventions.gradle.kts` | Java 21 toolchain, -Xlint:all -Werror, Spotless copyright header, JUnit 5 config, modules-graph-assert rules |

### CI

| File | Description |
|---|---|
| `.github/workflows/ci.yml` | Run `./gradlew check` on push to any branch |

### Module Build Files (19 modules)

| File | Description |
|---|---|
| `platform/platform-api/build.gradle.kts` | Applies java-conventions, no dependencies |
| `platform/platform-systemd/build.gradle.kts` | Applies java-conventions, depends on platform-api |
| `core/event-model/build.gradle.kts` | Applies java-conventions, depends on platform-api |
| `core/device-model/build.gradle.kts` | Applies java-conventions, depends on event-model |
| `core/state-store/build.gradle.kts` | Applies java-conventions, depends on event-model, device-model |
| `core/persistence/build.gradle.kts` | Applies java-conventions, depends on event-model, state-store; implementation sqlite-jdbc |
| `core/event-bus/build.gradle.kts` | Applies java-conventions, depends on event-model |
| `core/automation/build.gradle.kts` | Applies java-conventions, depends on event-model, device-model, configuration, state-store |
| `integration/integration-api/build.gradle.kts` | Applies java-conventions, depends on event-model, device-model |
| `integration/integration-runtime/build.gradle.kts` | Applies java-conventions, depends on integration-api, event-model |
| `integration/integration-zigbee/build.gradle.kts` | Applies java-conventions, depends on integration-api ONLY |
| `config/configuration/build.gradle.kts` | Applies java-conventions, depends on event-model; implementation snakeyaml-engine, json-schema-validator |
| `api/rest-api/build.gradle.kts` | Applies java-conventions, depends on event-model, device-model, state-store, automation, observability; implementation javalin |
| `api/websocket-api/build.gradle.kts` | Applies java-conventions, depends on event-model, event-bus |
| `observability/observability/build.gradle.kts` | Applies java-conventions, depends on event-model, state-store |
| `web-ui/dashboard/build.gradle.kts` | Minimal: packages pre-built static files into JAR |
| `lifecycle/lifecycle/build.gradle.kts` | Applies java-conventions, depends on platform-api, event-model, observability (plus all subsystem modules for lifecycle orchestration) |
| `app/homesynapse-app/build.gradle.kts` | Application plugin, depends on all modules, jlink configuration |
| `testing/test-support/build.gradle.kts` | Java-library plugin, depends on event-model, device-model, integration-api; exposes as api (not implementation) |

### Module Source Directories (empty files for compilation)

For each of the 18 Java modules, create:

| Pattern | Description |
|---|---|
| `<module>/src/main/java/com/homesynapse/<pkg>/package-info.java` | Package-level Javadoc placeholder |
| `<module>/src/test/java/.gitkeep` | Ensure test directory exists |

For API-surface modules (`platform-api`, `event-model`, `device-model`, `integration-api`), also create:

| File | Description |
|---|---|
| `<module>/src/main/java/module-info.java` | JPMS module descriptor (empty exports, populated in Phase 2) |

### MODULE_CONTEXT.md Files (19 modules)

| Pattern | Description |
|---|---|
| `<module>/MODULE_CONTEXT.md` | Empty template with five section headers (Design Doc Reference, Dependencies, Consumers, Constraints, Gotchas). Populated during Phase 2. |

### Documentation

| File | Description |
|---|---|
| `docs/ARCHITECTURE.md` | Architecture overview with links to homesynapse-core-docs design documents |
| `docs/TESTING.md` | Test strategy: five categories (unit, integration, performance, failure, architecture), how to run, NoRealIoExtension usage |
| `docs/decisions/template.md` | MADR ADR template |
| `docs/decisions/0001-adr-adoption.md` | ADR-0001: Adopt MADR format for architecture decision records |
| `docs/traceability/01-event-model.md` through `docs/traceability/14-master-architecture.md` | 14 traceability files, each with three-column template (Design Doc Section, Interface/Type, Test Class) |

### Specifications

| File | Description |
|---|---|
| `specs/README.md` | How to validate specs, relationship between specs and code |
| `specs/openapi/.gitkeep` | Placeholder for OpenAPI spec (produced in Wave 4) |
| `specs/asyncapi/.gitkeep` | Placeholder for AsyncAPI spec (produced in Wave 4) |

### Spike Directory

| File | Description |
|---|---|
| `spike/README.md` | Rules: everything here is throwaway, findings go to docs repo, Phase Guide spike rules apply |

### Config Schema Directories

For modules with configuration namespaces, create:

| File | Description |
|---|---|
| `core/event-model/src/main/resources/schema/.gitkeep` | Placeholder for event-model config schema |
| `core/persistence/src/main/resources/schema/.gitkeep` | Placeholder for persistence config schema |
| `core/automation/src/main/resources/schema/.gitkeep` | Placeholder for automation config schema |
| `config/configuration/src/main/resources/schema/.gitkeep` | Placeholder for config-system schema |
| `integration/integration-zigbee/src/main/resources/schema/.gitkeep` | Placeholder for zigbee config schema |
| `api/rest-api/src/main/resources/schema/.gitkeep` | Placeholder for API config schema |
| `observability/observability/src/main/resources/schema/.gitkeep` | Placeholder for observability config schema |

---

*This document is part of HomeSynapse Core project governance. It defines the execution plan for Phases 2 and 3, bridging the locked design documents to production code.*
