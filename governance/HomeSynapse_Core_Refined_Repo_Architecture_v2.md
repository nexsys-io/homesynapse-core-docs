# HomeSynapse Core — Refined Repository Architecture v2

**Document type:** Governance — Repository Architecture & Execution Plan
**Status:** Locked
**Effective date:** 2026-03-10
**Supersedes:** HomeSynapse_Core_Implementation_Plan_v1.md
**Owner:** nick@nexsys.io

This document refines the HomeSynapse Core repository structure, build system, package conventions, and Phase 2/3 execution plan based on competitive research across 17 open-source projects (OpenHAB, Home Assistant, Axon Framework, Occurrent, Eventuate, Lagom, Micronaut, Spring Boot, Quarkus, Helidon, Domoticz, ioBroker, Gladys, Marten, and others). Every change is traced to a specific research insight, and every decision to NOT adopt a research recommendation is explicitly justified.

---

## 1. Research Analysis — What Changes and What Doesn't

### 1.1 What the Research Validates (No Change Needed)

These aspects of Plan v1 are independently validated by multiple projects:

| Current Decision | Validating Projects | Confidence |
|---|---|---|
| Monorepo for 19 tightly coupled modules | OpenHAB core, Micronaut, Spring Boot, Quarkus, Helidon | Universal consensus for <50 coupled modules |
| `platform-api` with zero HomeSynapse dependencies | Helidon's platform abstraction, OpenHAB's core bundle | Strong |
| `integration-api` / `integration-runtime` / `integration-zigbee` split | Lagom's `-api`/`-impl`, Quarkus's runtime/deployment, OpenHAB's binding pattern | Gold standard |
| `test-support` as first-class module | Axon `axon-test`, Occurrent `test-support`, OpenHAB `core.test`, Marten.Testing | Universal among mature projects |
| `build-logic/` as included build (not `buildSrc`) | Gradle best practice; avoids cache invalidation affecting entire build | Strong |
| `.internal` package convention | OpenHAB, Helidon, Micronaut — the three most common API boundary mechanisms | Universal |
| JPMS `module-info.java` enforcement | Helidon; stronger than OpenHAB's OSGi without runtime complexity | Strong for Java 21 |
| Single `libs.versions.toml` | Sufficient for 19 modules; Micronaut pattern | Strong |
| YAML-only configuration (LTD-09) | Validated as correct by Home Assistant's regret over YAML/UI dual paradigm (ADR-21) | High — avoid the dual-paradigm trap |
| `homesynapse-app` as thin assembly module | Axon v5 eliminated its God Module `axon-configuration`; Spring Boot 4 modularizing `spring-boot-autoconfigure` | Critical anti-pattern to avoid |
| 19-module count | Research says "well-sized — large enough for meaningful boundaries, small enough to manage" vs. Occurrent's 50+ modules | Right balance for constrained hardware |
| `com.homesynapse` base package (Decision I) | Follows modern convention; matches company domain `nexsys.io` | Locked decision — no change |

### 1.2 What the Research Challenges (Changes Adopted)

These are concrete improvements extracted from the research that improve our architecture without conflicting with any locked decision:

**Change 1: event-model must have ZERO HomeSynapse module dependencies.**
- *Source:* Axon's `axon-messaging` has zero framework dependencies. Research conclusion: "the foundation module defines the project's ceiling."
- *Problem in v1:* Plan v1 gave `event-model` a dependency on `platform-api`. But Doc 01 explicitly states "Dependencies: None (foundational)." This was an error.
- *Fix:* `event-model` depends on NOTHING. Any health reporting or platform integration belongs in `event-bus` (the implementation module), not `event-model` (the type/interface module).
- *Impact:* Strengthens the foundation. Any module in the system can depend on `event-model` without pulling in platform abstractions.

**Change 2: Four layered convention plugins instead of one.**
- *Source:* Micronaut's precompiled script plugins; Spring Boot's starter pattern; Gradle best practices.
- *Problem in v1:* Single `homesynapse.java-conventions.gradle.kts` forces all modules to share identical configuration. But library modules need `java-library`, the app module needs `application`, and test fixtures need `java-test-fixtures`.
- *Fix:* Four plugins forming an inheritance hierarchy:
  1. `homesynapse.java-conventions` — Java 21 toolchain, `-Xlint:all -Werror`, Spotless copyright headers, JUnit 5 config, common repositories.
  2. `homesynapse.library-conventions` — Extends java-conventions. Applies `java-library` plugin. For all library modules (17 of 19).
  3. `homesynapse.application-conventions` — Extends java-conventions. Applies `application` plugin, jlink configuration. For `homesynapse-app` only.
  4. `homesynapse.test-fixtures-conventions` — Extends library-conventions. Applies `java-test-fixtures` plugin. For modules that publish test fixtures.
- *Impact:* Cleaner build configuration. Each module applies exactly one convention plugin. No conditional logic.

**Change 3: Per-module test fixtures via Gradle's `java-test-fixtures` plugin.**
- *Source:* Occurrent publishes in-memory implementations alongside API modules. Axon's `axon-test` provides given/when/then fixtures. Research conclusion: "In-memory implementations of every persistence abstraction are essential for testing."
- *Problem in v1:* All test infrastructure crammed into a single `test-support` module. This creates a grab-bag that grows without structure.
- *Fix:* Key modules publish their own test fixtures via `testFixtures` source sets:
  - `event-model` → `InMemoryEventStore`, `TestEventFactory`, `TestCausalContext`
  - `device-model` → `TestDeviceFactory`, `TestCapabilityFactory`, `TestEntityFactory`
  - `persistence` → `InMemoryCheckpointStore`, `InMemoryTelemetryStore`
  - `integration-api` → `StubIntegrationContext`, `TestAdapter`, `StubCommandHandler`
  - `state-store` → `InMemoryStateStore`, `TestProjectionFixture`
  - `configuration` → `InMemoryConfigStore`, `TestConfigFactory`
  - `test-support` (kept) → Cross-cutting: `TestClock`, `TestIntegrationContext`, `NoRealIoExtension`, `GivenWhenThen` assertion DSL, reusable JUnit extensions.
- *Impact:* Test fixtures are discoverable (co-located with the module they test), composable (modules consume only the fixtures they need), and lightweight (no single God test module). Other modules consume via `testFixtures(project(":core:event-model"))`.

**Change 4: `.spi` sub-package convention for extension points.**
- *Source:* Helidon's `.spi` sub-package pattern. Micronaut supplements with `@Internal` annotations.
- *Problem in v1:* No distinction between "public API for consumers" and "SPI for implementors." Both live in the exported root package.
- *Fix:* Three-tier package convention per module:
  - `com.homesynapse.<subsystem>` — Public API. Consumed by other modules. Stable.
  - `com.homesynapse.<subsystem>.spi` — Extension points. Implemented by adapters/plugins. Stable but narrower audience.
  - `com.homesynapse.<subsystem>.internal` — Implementation details. Not exported. Free to change.
- *Modules with SPI packages:*
  - `integration-api` → `com.homesynapse.integration.spi` (IntegrationAdapter, AdapterFactory, CoordinatorStrategy)
  - `persistence` → `com.homesynapse.persistence.spi` (StorageMigration, RetentionPolicy)
  - `configuration` → `com.homesynapse.config.spi` (ConfigSource, SecretProvider)
  - `observability` → `com.homesynapse.observability.spi` (HealthContributor, MetricExporter)
  - `event-model` → `com.homesynapse.event.spi` (UpcasterProvider, EventSerializer)
- *Impact:* JPMS `module-info.java` exports `.spi` packages selectively. Adapter authors know exactly what they can implement vs. what they should only consume.

**Change 5: Finer-grained event store interfaces.**
- *Source:* Occurrent decomposes into `EventStoreRead`, `EventStoreWrite`, `EventStoreQueries`. Interface segregation principle validated across all event-sourcing frameworks studied.
- *Problem in v1:* Doc 01 defines a single `EventStore` interface covering read, write, and query operations.
- *Fix:* During Phase 2 interface specification, decompose into:
  - `EventAppender` — Append-only write operations. Used by `EventPublisher`.
  - `EventReader` — Read by position, entity stream, type. Used by projections, replay.
  - `EventQuerier` — Correlation queries, time-range queries, type filtering. Used by REST API, observability.
  - `EventStore` — Marker interface extending all three (for convenience when a module needs full access).
- *Impact:* Modules that only read events (state-store, observability) don't depend on write capabilities. Enables the in-memory test implementation to be minimal per interface.
- *Note:* This is a Phase 2 interface design decision, not a module structure change. The interfaces still live in `event-model`.

**Change 5a: Event logical type names in EventSerializer.**
- *Source:* Axon/XStream FQCN anti-pattern (renaming classes broke deserialization). Akka/Pekko persistence docs: "detach the domain model from the data model."
- *Fix:* `EventSerializer` (in `event-model` SPI) stores events with a logical type name (`device.added`, `state.reported`) in the `EventEnvelope.eventType` field rather than the Java FQCN. The event-type-registry reference artifact maps logical names to Java record classes. Upcasters operate on JSON nodes keyed by logical type + version, never on Java class instances.
- *Impact:* Event classes can be renamed, moved, or refactored without breaking deserialization of stored events. Consistent with LTD-08 (Jackson JSON with `EventSerializer` abstraction).

**Change 6: Integration quality tier metadata.**
- *Source:* Home Assistant's Integration Quality Scale (Bronze/Silver/Gold/Platinum) with `manifest.json` declaring machine-readable metadata. Scales to 2,000+ integrations.
- *Adoption:* Each integration module includes a `META-INF/homesynapse/integration.yaml` manifest declaring: integration ID, supported protocols, quality tier, required capabilities, codeowner, documentation link.
- *Impact:* Enables automated quality enforcement in CI. Prepares for future integration marketplace. Low cost to add now.

**Change 7: Explicit `modules-graph-assert` rules codifying dependency direction.**
- *Source:* Cross-cutting pattern from all projects. Every successful project enforces unidirectional dependency flow.
- *Rules to enforce:*
  1. `event-model` has zero HomeSynapse module dependencies.
  2. `platform-api` has zero HomeSynapse module dependencies.
  3. `integration-zigbee` depends ONLY on `integration-api` (LTD-17).
  4. No module in `core/` depends on modules in `integration/`, `api/`, `observability/`, or `lifecycle/`.
  5. No module in `integration/` depends on modules in `core/` (interaction flows through `integration-api`).
  6. Only `homesynapse-app` may depend on all modules.
  7. No circular dependencies anywhere.
- *Impact:* Build fails immediately if a developer introduces a forbidden dependency.

### 1.3 What the Research Suggests That We Deliberately Reject

These are research recommendations we considered and decided NOT to adopt, with explicit rationale:

**Rejected: Renaming `event-model` to `messaging`.**
- *Research argument:* Axon's `axon-messaging` names the foundation module after its function (message passing), not its domain concept (events).
- *Rejection rationale:* HomeSynapse is a domain-specific product, not a generic framework. Axon's naming works because Axon IS a messaging framework. Our event model is the domain — events are how the system remembers what happened, not just how components communicate. Commands are modeled AS events (command_issued, command_dispatched, command_result) per Doc 01. The name `event-model` is more precise for our architecture than the generic `messaging`. Renaming would contradict our 14 locked design documents for no functional gain.

**Rejected: Universal API/implementation module pairs.**
- *Research argument:* Lagom mandates `-api`/`-impl` for every service module.
- *Rejection rationale:* This would double our module count from 19 to ~30+. The research itself says 19 is "well-sized" for constrained hardware and warns that Occurrent's 50+ modules is "overwhelming." We selectively apply API/impl splits where they add clear value: `integration-api`/`integration-runtime`/`integration-zigbee` (multiple adapter implementations expected), and the event store interface/implementation boundary (via `event-model` interfaces + `persistence` implementation). For modules where the API and implementation are tightly coupled with no expected alternative implementations (e.g., `automation`, `state-store`), the split adds build overhead without benefit.

**Rejected: Separate `eventstore-api` and `eventstore-sqlite` modules.**
- *Research argument:* Occurrent's lego-brick philosophy — separate API module from storage implementation module.
- *Rejection rationale:* We effectively already have this split, just named differently. `event-model` contains the store interfaces (`EventAppender`, `EventReader`, `EventQuerier` per Change 5). `persistence` contains the SQLite implementation plus operational concerns (WAL tuning, checkpointing, retention, telemetry ring store). Creating two additional modules (`eventstore-api` + `eventstore-sqlite`) would either duplicate what `event-model` + `persistence` already provide, or force us to extract a thin wrapper module that adds no value. The in-memory event store lives in `event-model`'s test fixtures (Change 3), achieving the same testability benefit without the extra modules.

**Rejected: `homesynapse-scheduling` as a separate module.**
- *Research argument:* Cross-cutting scheduling concern deserves its own module.
- *Rejection rationale:* Scheduling in HomeSynapse is split across two subsystems by design: time-based automation triggers (owned by `automation`, Doc 07) and maintenance scheduling (owned by `persistence`, Doc 04). Neither is large enough to justify extraction, and neither shares scheduling infrastructure with the other. Creating a shared scheduling module would introduce an artificial coupling.

**Rejected: `homesynapse-gpio` hardware module.**
- *Research argument:* RPi-specific hardware integration deserves a module.
- *Rejection rationale:* GPIO is a Tier 2+ concern. LTD-13 defines the jlink runtime targeting RPi 4/5, but GPIO access is not part of Tier 1 MVP scope. The integration adapter pattern (Doc 05) already accommodates future hardware adapters without a dedicated module now.

**Rejected: Process-level adapter isolation (ioBroker pattern).**
- *Research argument:* Each adapter runs in its own process for maximum isolation.
- *Rejection rationale:* ioBroker later partially reversed this decision with "compact mode" for constrained devices. On Raspberry Pi 4 with 4 GB RAM, 10-60 MB per adapter process is unacceptable. Our architecture uses virtual thread isolation + `IntegrationSupervisor` crash containment (Doc 05) to achieve isolation within a single process. The research validates this — ioBroker's experience proves process isolation doesn't work on our target hardware.

**Rejected: CloudEvents specification as event envelope.**
- *Research argument:* Occurrent uses CloudEvents for interoperability.
- *Rejection rationale:* Doc 01 defines a purpose-built event envelope with fields specific to HomeSynapse's needs (entity_ref, processing_mode, priority, causation chain). CloudEvents would add overhead for interoperability we don't need in Tier 1 — HomeSynapse is a closed system, not a distributed microservice mesh. If future tiers require external event interoperability, a CloudEvents adapter can serialize our events into CloudEvents format without changing the internal envelope.

**Rejected: `com.homesynapse` package prefix.**
- *Research argument:* Follow Java convention matching domain name.
- *Rejection rationale:* Decision I locks `com.homesynapse` as the base package. This follows the modern convention used by many Java projects (io.micronaut, io.helidon, io.quarkus) and matches the company domain (nexsys.io). No change.

---

## 2. Refined Repository Structure

The `homesynapse-core` repository follows Doc 14 §3.6 with targeted refinements from §1.2 above. Base Java package: `com.homesynapse`. Changes from v1 are marked with `← CHANGED` or `← NEW`.

```
homesynapse-core/
│
├── CONTEXT.md                              # Agent context primer (§3)
├── LICENSE                                 # Proprietary (transition guide §3)
├── README.md                               # Build instructions, license notice
├── settings.gradle.kts                     # Root project name + all 19 module includes
├── gradle.properties                       # Parallel execution, config cache, build cache
├── .gitignore                              # Gradle, IntelliJ, macOS, .DS_Store
├── .editorconfig                           # Consistent formatting across IDEs          ← NEW
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
│       ├── homesynapse.java-conventions.gradle.kts       # Base: Java 21, lint, Spotless, JUnit 5
│       ├── homesynapse.library-conventions.gradle.kts    # Extends base + java-library        ← NEW
│       ├── homesynapse.application-conventions.gradle.kts # Extends base + application + jlink ← NEW
│       └── homesynapse.test-fixtures-conventions.gradle.kts # Extends library + test-fixtures  ← NEW
│
├── platform/
│   ├── platform-api/                       # HealthReporter, PlatformPaths interfaces
│   │   ├── build.gradle.kts                # Applies library-conventions. ZERO dependencies.
│   │   └── src/
│   │       ├── main/java/
│   │       │   ├── module-info.java
│   │       │   └── com/homesynapse/platform/
│   │       │       ├── HealthReporter.java
│   │       │       ├── PlatformPaths.java
│   │       │       └── package-info.java
│   │       └── test/java/com/homesynapse/platform/
│   │
│   └── platform-systemd/                   # SystemdHealthReporter, LinuxSystemPaths
│       ├── build.gradle.kts                # Applies library-conventions. Depends: platform-api.
│       └── src/
│           ├── main/java/
│           │   ├── module-info.java
│           │   └── com/homesynapse/platform/systemd/
│           │       └── internal/           # Not exported via JPMS
│           └── test/java/com/homesynapse/platform/systemd/
│
├── core/
│   ├── event-model/                        # Event types, envelope, store interfaces, bus interfaces
│   │   ├── build.gradle.kts                # Applies test-fixtures-conventions. ZERO dependencies. ← CHANGED
│   │   └── src/
│   │       ├── main/java/
│   │       │   ├── module-info.java
│   │       │   └── com/homesynapse/event/
│   │       │       ├── model/              # EventEnvelope, DomainEvent, CausalContext, enums
│   │       │       ├── publish/            # EventAppender (was EventPublisher)               ← CHANGED
│   │       │       ├── store/              # EventReader, EventQuerier, EventStore            ← CHANGED
│   │       │       ├── bus/                # EventBus interface, SubscriptionFilter
│   │       │       ├── upcasting/          # UpcasterRegistry, Upcaster, IntermediateRepresentation
│   │       │       ├── spi/               # UpcasterProvider, EventSerializer                ← NEW
│   │       │       └── package-info.java
│   │       ├── test/java/com/homesynapse/event/
│   │       └── testFixtures/java/com/homesynapse/event/test/                                  ← NEW
│   │           ├── InMemoryEventStore.java   # Implements EventAppender + EventReader + EventQuerier
│   │           ├── TestEventFactory.java     # Builders for test EventEnvelopes
│   │           └── TestCausalContext.java     # Pre-built causal contexts for tests
│   │
│   ├── device-model/                       # Device, Entity, Capability types + registries
│   │   ├── build.gradle.kts                # Applies test-fixtures-conventions. Depends: event-model.
│   │   └── src/
│   │       ├── main/java/
│   │       │   ├── module-info.java
│   │       │   └── com/homesynapse/device/
│   │       │       ├── model/              # Device, Entity, Capability records
│   │       │       ├── registry/           # DeviceRegistry, EntityRegistry interfaces
│   │       │       ├── command/            # CommandType, CommandValidation
│   │       │       ├── discovery/          # DiscoveryService interface
│   │       │       ├── replacement/        # DeviceReplacementService interface
│   │       │       └── package-info.java
│   │       ├── test/java/com/homesynapse/device/
│   │       └── testFixtures/java/com/homesynapse/device/test/                                 ← NEW
│   │           ├── TestDeviceFactory.java
│   │           ├── TestEntityFactory.java
│   │           └── TestCapabilityFactory.java
│   │
│   ├── state-store/                        # StateProjection, StateQueryService
│   │   ├── build.gradle.kts                # Applies test-fixtures-conventions. Depends: event-model, device-model.
│   │   └── src/
│   │       ├── main/java/
│   │       │   ├── module-info.java
│   │       │   └── com/homesynapse/state/
│   │       │       ├── model/              # EntityState, StateSnapshot
│   │       │       ├── projection/         # StateProjection, ProjectionLifecycle            ← CHANGED
│   │       │       ├── query/              # StateQueryService interface
│   │       │       └── package-info.java
│   │       ├── test/java/com/homesynapse/state/
│   │       └── testFixtures/java/com/homesynapse/state/test/                                  ← NEW
│   │           ├── InMemoryStateStore.java
│   │           └── TestProjectionFixture.java
│   │
│   ├── persistence/                        # EventStore impl, TelemetryStore, migrations
│   │   ├── build.gradle.kts                # Applies test-fixtures-conventions. Depends: event-model, state-store.
│   │   └── src/
│   │       ├── main/java/
│   │       │   ├── module-info.java
│   │       │   └── com/homesynapse/persistence/
│   │       │       ├── event/              # SQLiteEventStore (implements EventAppender + EventReader + EventQuerier)
│   │       │       │   └── internal/       # WAL management, PRAGMA configuration
│   │       │       ├── telemetry/          # TelemetryWriter, TelemetryQueryService, ring store
│   │       │       │   └── internal/       # Ring buffer implementation
│   │       │       ├── checkpoint/         # CheckpointStore interface + SQLite impl
│   │       │       ├── maintenance/        # RetentionService, VacuumService
│   │       │       │   └── internal/
│   │       │       ├── migration/          # Schema migration framework
│   │       │       ├── spi/               # StorageMigration, RetentionPolicy              ← NEW
│   │       │       └── package-info.java
│   │       ├── test/java/com/homesynapse/persistence/
│   │       └── testFixtures/java/com/homesynapse/persistence/test/                            ← NEW
│   │           ├── InMemoryCheckpointStore.java
│   │           └── InMemoryTelemetryStore.java
│   │
│   ├── event-bus/                          # InProcessEventBus, subscriber dispatch
│   │   ├── build.gradle.kts                # Applies library-conventions. Depends: event-model, platform-api. ← CHANGED
│   │   └── src/
│   │       ├── main/java/
│   │       │   ├── module-info.java
│   │       │   └── com/homesynapse/event/bus/
│   │       │       └── internal/           # InProcessEventBus impl, subscriber dispatch
│   │       └── test/java/com/homesynapse/event/bus/
│   │
│   └── automation/                         # AutomationRegistry, RunManager, trigger index
│       ├── build.gradle.kts                # Applies library-conventions. Depends: event-model, device-model, configuration, state-store.
│       └── src/
│           ├── main/java/
│           │   ├── module-info.java
│           │   └── com/homesynapse/automation/
│           │       ├── model/              # AutomationRule, Trigger, Condition, Action
│           │       ├── registry/           # AutomationRegistry interface
│           │       ├── execution/          # RunManager, ActionExecutor
│           │       ├── command/            # CommandDispatchService, PendingCommandLedger
│           │       ├── cascade/            # CascadeGovernor, depth limiting
│           │       │   └── internal/
│           │       └── package-info.java
│           └── test/java/com/homesynapse/automation/
│
├── integration/
│   ├── integration-api/                    # IntegrationAdapter SPI, IntegrationContext
│   │   ├── build.gradle.kts                # Applies test-fixtures-conventions. Depends: event-model, device-model.
│   │   └── src/
│   │       ├── main/java/
│   │       │   ├── module-info.java
│   │       │   └── com/homesynapse/integration/
│   │       │       ├── api/                # IntegrationContext (consumed by adapters)
│   │       │       ├── health/             # HealthStateMachine states
│   │       │       ├── command/            # CommandHandler interface
│   │       │       ├── descriptor/         # IntegrationDescriptor metadata
│   │       │       ├── exception/          # Integration exception hierarchy
│   │       │       ├── spi/               # IntegrationAdapter, AdapterFactory, CoordinatorStrategy  ← NEW
│   │       │       └── package-info.java
│   │       ├── test/java/com/homesynapse/integration/
│   │       └── testFixtures/java/com/homesynapse/integration/test/                            ← NEW
│   │           ├── StubIntegrationContext.java
│   │           ├── TestAdapter.java
│   │           └── StubCommandHandler.java
│   │
│   ├── integration-runtime/                # IntegrationSupervisor, health, restart
│   │   ├── build.gradle.kts                # Applies library-conventions. Depends: integration-api, event-model, platform-api.
│   │   └── src/
│   │       ├── main/java/
│   │       │   ├── module-info.java
│   │       │   └── com/homesynapse/integration/runtime/
│   │       │       └── internal/           # Supervisor impl, restart intensity, thread management
│   │       └── test/java/com/homesynapse/integration/runtime/
│   │
│   └── integration-zigbee/                 # ZigbeeAdapter (depends on integration-api ONLY, LTD-17)
│       ├── build.gradle.kts                # Applies library-conventions. Depends: integration-api ONLY.
│       ├── src/
│       │   ├── main/java/
│       │   │   ├── module-info.java
│       │   │   └── com/homesynapse/integration/zigbee/
│       │   │       └── internal/           # Coordinator transports, ZCL mapping, interview pipeline
│       │   │           ├── transport/      # Z-Stack ZNP, EmberZNet EZSP
│       │   │           ├── zcl/            # Cluster-to-capability mapping
│       │   │           ├── codec/          # Tuya, Xiaomi manufacturer codecs
│       │   │           └── interview/      # Device interview pipeline
│       │   └── test/java/com/homesynapse/integration/zigbee/
│       └── src/main/resources/
│           └── META-INF/homesynapse/
│               └── integration.yaml        # Quality tier metadata manifest              ← NEW
│
├── config/
│   └── configuration/                      # ConfigurationService, SecretStore, schemas
│       ├── build.gradle.kts                # Applies test-fixtures-conventions. Depends: event-model.
│       └── src/
│           ├── main/java/
│           │   ├── module-info.java
│           │   └── com/homesynapse/config/
│           │       ├── loading/            # Six-stage pipeline
│           │       ├── schema/             # Schema validation, JSON Schema
│           │       ├── secret/             # AES-256-GCM encrypted secret store
│           │       ├── migration/          # Config schema migration
│           │       ├── reload/             # Hot reload with atomic swap
│           │       ├── spi/               # ConfigSource, SecretProvider                  ← NEW
│           │       │   └── internal/
│           │       └── package-info.java
│           ├── test/java/com/homesynapse/config/
│           ├── testFixtures/java/com/homesynapse/config/test/                              ← NEW
│           │   ├── InMemoryConfigStore.java
│           │   └── TestConfigFactory.java
│           └── main/resources/
│               └── META-INF/homesynapse/
│                   └── config-schema/      # Core configuration JSON Schemas
│
├── api/
│   ├── rest-api/                           # Javalin REST endpoints
│   │   ├── build.gradle.kts                # Applies library-conventions. Depends: event-model, device-model, state-store, automation, observability.
│   │   └── src/
│   │       ├── main/java/
│   │       │   ├── module-info.java
│   │       │   └── com/homesynapse/api/rest/
│   │       │       └── internal/           # Route handlers, serialization, ETag, rate limiting
│   │       │           ├── entity/         # Entity state endpoints
│   │       │           ├── command/        # Command issuance endpoints
│   │       │           ├── event/          # Event history endpoints
│   │       │           ├── automation/     # Automation management endpoints
│   │       │           └── system/         # Health and system endpoints
│   │       └── test/java/com/homesynapse/api/rest/
│   │
│   └── websocket-api/                      # WebSocket relay, subscription management
│       ├── build.gradle.kts                # Applies library-conventions. Depends: event-model, event-bus.
│       └── src/
│           ├── main/java/
│           │   ├── module-info.java
│           │   └── com/homesynapse/api/websocket/
│           │       └── internal/           # Event relay, backpressure, subscription filters
│           │           ├── relay/          # EventRelay subscriber
│           │           ├── session/        # Connection management
│           │           └── protocol/       # Message framing
│           └── test/java/com/homesynapse/api/websocket/
│
├── observability/
│   └── observability/                      # HealthAggregator, TraceQueryService, JFR events
│       ├── build.gradle.kts                # Applies library-conventions. Depends: event-model, state-store.
│       └── src/
│           ├── main/java/
│           │   ├── module-info.java
│           │   └── com/homesynapse/observability/
│           │       ├── health/             # HealthAggregator, tier model, flapping prevention
│           │       ├── trace/              # TraceQueryService, causal chain assembly
│           │       ├── spi/               # HealthContributor, MetricExporter              ← NEW
│           │       │   └── internal/       # JFR event definitions, metrics bridge
│           │       └── package-info.java
│           └── test/java/com/homesynapse/observability/
│
├── web-ui/
│   └── dashboard/                          # Pre-built static files (Preact SPA, Vite output)
│       ├── build.gradle.kts                # No Java compilation; copy task for static assets.
│       └── src/main/resources/
│           └── dashboard/                  # Pre-built HTML/JS/CSS
│
├── lifecycle/
│   └── lifecycle/                          # SystemLifecycleManager, startup/shutdown
│       ├── build.gradle.kts                # Applies library-conventions. Depends: platform-api, event-model, observability + all subsystem modules.
│       └── src/
│           ├── main/java/
│           │   ├── module-info.java
│           │   └── com/homesynapse/lifecycle/
│           │       └── internal/           # Seven-phase initialization, watchdog, graceful shutdown
│           │           ├── startup/        # Phase orchestrator
│           │           ├── shutdown/       # Reverse-order shutdown
│           │           └── watchdog/       # Systemd watchdog protocol
│           └── test/java/com/homesynapse/lifecycle/
│
├── app/
│   └── homesynapse-app/                    # Assembly: main class, jlink, systemd unit
│       ├── build.gradle.kts                # Applies application-conventions. Depends: ALL modules.  ← CHANGED
│       └── src/
│           ├── main/java/
│           │   ├── module-info.java
│           │   └── com/homesynapse/app/
│           │       ├── HomeSynapseMain.java
│           │       └── package-info.java
│           └── test/java/com/homesynapse/app/
│
├── testing/
│   └── test-support/                       # Cross-cutting test infrastructure
│       ├── build.gradle.kts                # Applies library-conventions. Depends: event-model, device-model, integration-api.
│       └── src/main/java/com/homesynapse/test/
│           ├── TestClock.java              # Controllable clock for deterministic testing
│           ├── TestIntegrationContext.java  # Full wired test context for integration tests
│           ├── NoRealIoExtension.java      # JUnit extension preventing accidental real I/O
│           ├── SynchronousEventBus.java    # Single-threaded bus for deterministic test ordering
│           ├── GivenWhenThen.java          # Event-sourced assertion DSL (inspired by Axon)   ← NEW
│           └── assertions/                 # Custom AssertJ assertions for HomeSynapse types   ← NEW
│
├── spike/                                  # Prototype spikes (throwaway code, not production)
│   └── wal-validation/                     # SQLite WAL validation spike (Phase 3.0)
│
├── specs/                                  # API specifications
│   ├── openapi/
│   │   └── homesynapse-rest-api-v1.yaml    # OpenAPI 3.1 (Doc 09)
│   └── asyncapi/
│       └── homesynapse-websocket-v1.yaml   # AsyncAPI 3.0 (Doc 10)
│
├── docs/                                   # Repository-level documentation
│   ├── ARCHITECTURE.md                     # Architecture overview with links to design docs
│   ├── CONTRIBUTING.md                     # Build, test, and contribution guidelines
│   ├── MODULE_MAP.md                       # Visual dependency map (generated)
│   └── modules/                            # Per-module MODULE_CONTEXT.md files
│       ├── event-model.md
│       ├── device-model.md
│       ├── state-store.md
│       ├── persistence.md
│       ├── event-bus.md
│       ├── automation.md
│       ├── integration-api.md
│       ├── integration-runtime.md
│       ├── integration-zigbee.md
│       ├── configuration.md
│       ├── rest-api.md
│       ├── websocket-api.md
│       ├── observability.md
│       ├── lifecycle.md
│       ├── dashboard.md
│       ├── homesynapse-app.md
│       ├── platform-api.md
│       ├── platform-systemd.md
│       └── test-support.md
│
└── reference/                              # Phase 2 pre-wave reference artifacts
    ├── event-type-registry.md              # All event types from 14 design docs
    ├── subscriber-registry.md              # All event bus subscribers from 14 design docs
    └── configuration-schema-registry.md    # All config schemas from 14 design docs
```

**Module count:** 18 Gradle modules (matching Doc 14 §3.6) + 1 test-support module = 19 total. Unchanged from v1.

**Package convention (refined):**
- `com.homesynapse.<subsystem>` — Public API. Exported via JPMS. Stable contract.
- `com.homesynapse.<subsystem>.spi` — Extension points. Exported via JPMS. Stable but narrow. ← NEW
- `com.homesynapse.<subsystem>.internal` — Implementation. Not exported. Free to change.

**Convention plugin assignment:**
| Plugin | Applies To |
|---|---|
| `homesynapse.library-conventions` | All 17 library modules without test fixtures |
| `homesynapse.test-fixtures-conventions` | event-model, device-model, state-store, persistence, integration-api, configuration (6 modules) |
| `homesynapse.application-conventions` | homesynapse-app (1 module) |
| (dashboard uses a custom build script — no Java compilation) | dashboard (1 module) |

Note: The 6 test-fixture modules also apply library-conventions (since test-fixtures-conventions extends it). The remaining 11 library modules use library-conventions directly.

---

## 3. CONTEXT.md Content

The CONTEXT.md file sits at the repository root. It provides the constitutional context that every agent session must read. Maximum 100 lines. Mechanically generated from governance sources.

```markdown
# HomeSynapse Core — Agent Context

## Identity
HomeSynapse Core is the local-first, event-sourced smart home operating system.
Java 21 (Corretto), SQLite WAL, virtual threads, Raspberry Pi 5 primary target (Pi 4 validation floor).
Base package: com.homesynapse. Proprietary license (LicenseRef-NexSys-Proprietary).

## Locked Technical Decisions (source: Locked_Decisions.md)
- LTD-01: Java 21 LTS. Amazon Corretto 21.0.10.7.1. No preview features.
- LTD-02: Gradle 8.12+ with Kotlin DSL. Single build. Convention plugins in build-logic/.
- LTD-03: SQLite via xerial sqlite-jdbc 3.51.2.0. WAL mode. Single-writer.
- LTD-04: Jackson 2.x for JSON serialization. Explicit ObjectMapper, no auto-detection.
- LTD-05: ULIDs for all identifiers. Monotonic factory. correlation_id + causation_id on every event.
- LTD-06: Per-entity sequences with global append position. Optimistic concurrency.
- LTD-07: At-least-once event delivery. Idempotent subscribers with checkpoint tracking.
- LTD-08: Virtual threads for all concurrent work. Platform threads only for serial I/O (Zigbee USB).
- LTD-09: YAML 1.2 via SnakeYAML Engine. JSON Schema validation via networknt. Config in /etc/homesynapse/.
- LTD-10: modules-graph-assert for dependency enforcement. ArchUnit for package rules.
- LTD-11: JUnit 5 + AssertJ. No Mockito for core domain. Fakes and in-memory implementations.
- LTD-12: Javalin for HTTP (REST + WebSocket). Embedded Jetty.
- LTD-13: jlink custom runtime. systemd service. FHS layout. MemoryMax=2G.
- LTD-14: Preact + Vite for dashboard. <150KB gzipped. Pre-built static files.
- LTD-15: SLF4J + Logback. Structured JSON logging.
- LTD-16: JFR continuous recording. Custom application events. Zero-overhead when disabled.
- LTD-17: Adapters depend on integration-api ONLY. No direct core module imports.
- LTD-18: Spotless for formatting. Google Java Format base. Copyright header enforcement.

## Architecture Invariants (source: Architecture_Invariants_v1.md)
15 categories, 79 invariants. Key categories:
- INV-ES: Event sourcing (events immutable, append-only, WAL durability)
- INV-LF: Local-first (no cloud dependency, works offline indefinitely)
- INV-PR: Privacy (data stays local by default, no telemetry home)
- INV-RF: Reliability (crash recovery, zero event loss, isolation)
- INV-CE: Core engine (deterministic replay, causal ordering)
- INV-PD: Performance/device scale (p99 targets, memory budgets)
- INV-SE: Security (encrypted secrets, least privilege)
- INV-TO: Transparency/observability (full audit trail, causal chains)
- INV-EI: Energy/integration (metering accuracy, protocol isolation)
- INV-CS: Configuration/schema (single paradigm, validated, migrateable)
- INV-MU: Multi-user (presence, permissions, activity audit)
- INV-HO: Horizontal scaling (multi-hub coordination, future)
- INV-AI: AI/ML (local inference, privacy-preserving)
- INV-MN: Maintenance (backup, retention, self-healing)
- INV-GA: Governance/amendment (formal process for invariant changes)

## Module Dependency Direction
event-model (ZERO deps) → device-model → state-store → persistence
event-model → event-bus (impl, depends on platform-api)
event-model → configuration
device-model + integration-api → integration-runtime → integration-zigbee
state-store + automation + observability → rest-api
event-model + event-bus → websocket-api
All → lifecycle → homesynapse-app (assembly)
platform-api (ZERO deps) → platform-systemd

## Phase Discipline
Phase 2: Interface specification. Java interfaces, types, schemas. No implementation code.
Phase 3: Tests first, then implementation. Tests written against Phase 2 interfaces.
Design docs are authoritative. Any deviation requires formal revision.

## Build Commands
./gradlew check                    # Full build + test + lint
./gradlew :core:event-model:test   # Single module test
./gradlew dependencyGuard          # Verify dependency graph rules
```

58 lines. All 18 LTDs. All 15 INV categories. Module dependency direction. Phase discipline. Build commands.

---

## 4. Refined Module Dependency Table

All 7 columns. 19 rows. Changes from v1 marked with ←.

| Module | Design Doc | Gradle Dependencies | Exported Packages | SPI Packages | Internal Packages | Phase 2 Wave |
|---|---|---|---|---|---|---|
| `platform-api` | Doc 12 §8 | (none) | `com.homesynapse.platform` | — | — | Wave 1 |
| `event-model` | Doc 01 | **(none)** ← | `com.homesynapse.event.model`, `.publish`, `.store`, `.bus`, `.upcasting` | `com.homesynapse.event.spi` ← | — | Wave 1 |
| `device-model` | Doc 02 | `event-model` | `com.homesynapse.device.model`, `.registry`, `.command`, `.discovery`, `.replacement` | — | — | Wave 2 |
| `integration-api` | Doc 05 | `event-model`, `device-model` | `com.homesynapse.integration.api`, `.health`, `.command`, `.descriptor`, `.exception` | `com.homesynapse.integration.spi` ← | — | Wave 2 |
| `configuration` | Doc 06 | `event-model` | `com.homesynapse.config.loading`, `.schema`, `.secret`, `.migration`, `.reload` | `com.homesynapse.config.spi` ← | `com.homesynapse.config.*.internal` | Wave 2 |
| `state-store` | Doc 03 | `event-model`, `device-model` | `com.homesynapse.state.model`, `.projection`, `.query` | — | — | Wave 3 |
| `persistence` | Doc 04 | `event-model`, `state-store` | `com.homesynapse.persistence.event`, `.telemetry`, `.checkpoint`, `.maintenance`, `.migration` | `com.homesynapse.persistence.spi` ← | `com.homesynapse.persistence.*.internal` | Wave 3 |
| `automation` | Doc 07 | `event-model`, `device-model`, `configuration`, `state-store` | `com.homesynapse.automation.model`, `.registry`, `.execution`, `.command`, `.cascade` | — | `com.homesynapse.automation.*.internal` | Wave 3 |
| `event-bus` | Doc 01 | `event-model`, **`platform-api`** ← | — | — | `com.homesynapse.event.bus.internal` | Wave 4 |
| `integration-runtime` | Doc 05 | `integration-api`, `event-model`, **`platform-api`** ← | — | — | `com.homesynapse.integration.runtime.internal` | Wave 4 |
| `rest-api` | Doc 09 | `event-model`, `device-model`, `state-store`, `automation`, `observability` | — | — | `com.homesynapse.api.rest.internal` | Wave 4 |
| `websocket-api` | Doc 10 | `event-model`, `event-bus` | — | — | `com.homesynapse.api.websocket.internal` | Wave 4 |
| `observability` | Doc 11 | `event-model`, `state-store` | `com.homesynapse.observability.health`, `.trace` | `com.homesynapse.observability.spi` ← | `com.homesynapse.observability.internal` | Wave 4 |
| `integration-zigbee` | Doc 08 | `integration-api` ONLY | — | — | `com.homesynapse.integration.zigbee.internal` | Wave 5 |
| `platform-systemd` | Doc 12 | `platform-api` | — | — | `com.homesynapse.platform.systemd.internal` | Wave 5 |
| `lifecycle` | Doc 12 | `platform-api`, `event-model`, `observability`, (all subsystem modules) | — | — | `com.homesynapse.lifecycle.internal` | Wave 5 |
| `dashboard` | Doc 13 | (none — static files) | — | — | — | Wave 5 |
| `homesynapse-app` | — | (all modules) | — | — | `com.homesynapse.app` | Wave 5 |
| `test-support` | — | `event-model`, `device-model`, `integration-api` | `com.homesynapse.test` | — | — | Wave 5 |

**19 modules total.** 8 columns (added SPI Packages).

Key changes from v1:
1. `event-model` dependencies: `platform-api` → **(none)**. Foundation module with zero HomeSynapse dependencies.
2. `event-bus` dependencies: `event-model` → `event-model`, **`platform-api`**. Health reporting moved here.
3. `integration-runtime` dependencies: Added explicit `platform-api` (for HealthReporter).
4. SPI Packages column added for 5 modules with extension points.

---

## 5. Convention Plugin Architecture

### 5.1 Plugin Hierarchy

```
homesynapse.java-conventions
├── homesynapse.library-conventions
│   └── homesynapse.test-fixtures-conventions
└── homesynapse.application-conventions
```

### 5.2 Plugin Specifications

**`homesynapse.java-conventions.gradle.kts`** (base — all modules)
```kotlin
// Applied by: All other convention plugins (never directly by modules)
plugins {
    java
    id("com.diffplug.spotless")
}

java {
    toolchain { languageVersion = JavaLanguageVersion.of(21) }
}

tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror"))
    options.encoding = "UTF-8"
}

spotless {
    java {
        licenseHeaderFile(rootProject.file("gradle/license-header.txt"))
        // Google Java Format base (per LTD-18)
    }
}

testing {
    suites {
        val test by getting(JvmTestSuite::class) {
            useJUnitJupiter()
        }
    }
}

// Common repositories
repositories {
    mavenCentral()
}
```

**`homesynapse.library-conventions.gradle.kts`** (library modules)
```kotlin
// Applied by: 17 library modules (11 directly, 6 via test-fixtures-conventions)
plugins {
    id("homesynapse.java-conventions")
    `java-library`
}

// API vs implementation dependency enforcement
// Modules use api() for types they expose, implementation() for internal deps
```

**`homesynapse.test-fixtures-conventions.gradle.kts`** (modules publishing test fixtures)
```kotlin
// Applied by: event-model, device-model, state-store, persistence, integration-api, configuration
plugins {
    id("homesynapse.library-conventions")
    `java-test-fixtures`
}

// Test fixtures are published as testFixtures configuration
// Other modules consume via: testImplementation(testFixtures(project(":core:event-model")))
```

**`homesynapse.application-conventions.gradle.kts`** (app module only)
```kotlin
// Applied by: homesynapse-app only
plugins {
    id("homesynapse.java-conventions")
    application
}

application {
    mainClass = "com.homesynapse.app.HomeSynapseMain"
}

// jlink custom runtime configuration (LTD-13)
// systemd service unit generation
```

### 5.3 `modules-graph-assert` Rules

Defined in `build-logic/` and applied to root project:

```kotlin
moduleGraphAssert {
    // Rule 1: Foundation modules have zero HomeSynapse dependencies
    assertEmpty(":platform:platform-api")
    assertEmpty(":core:event-model")

    // Rule 2: Adapter isolation (LTD-17)
    allowed(":integration:integration-zigbee" dependsOn ":integration:integration-api")
    notAllowed(":integration:integration-zigbee" dependsOn ":core:*")

    // Rule 3: Core never depends on higher layers
    notAllowed(":core:*" dependsOn ":integration:*")
    notAllowed(":core:*" dependsOn ":api:*")
    notAllowed(":core:*" dependsOn ":observability:*")
    notAllowed(":core:*" dependsOn ":lifecycle:*")
    notAllowed(":core:*" dependsOn ":app:*")

    // Rule 4: Integration layer never depends on core directly
    notAllowed(":integration:integration-zigbee" dependsOn ":core:*")
    notAllowed(":integration:integration-runtime" dependsOn ":core:device-model")
    notAllowed(":integration:integration-runtime" dependsOn ":core:state-store")
    notAllowed(":integration:integration-runtime" dependsOn ":core:persistence")
    notAllowed(":integration:integration-runtime" dependsOn ":core:automation")

    // Rule 5: No circular dependencies
    assertNoCycles()
}
```

---

## 6. Phase 2 Plan (Refined)

### 6.0 Pre-Wave: Reference Artifacts

Before interface specification begins, produce three reference artifacts in `homesynapse-core-docs/reference/`. These are compilation exercises from the 14 locked design documents.

| Artifact | Content | Purpose |
|---|---|---|
| `event-type-registry.md` | All event types from all 14 design docs. Columns: event_type, producing_subsystem, payload_fields, version, priority, event_origin | Single source of truth for Phase 2 event type definitions |
| `subscriber-registry.md` | All event bus subscribers from all 14 design docs. Columns: subscriber_name, owning_module, subscribed_events, processing_mode, checkpoint_strategy | Ensures no subscriber is missed during interface specification |
| `configuration-schema-registry.md` | All configuration sections from all 14 design docs. Columns: yaml_path, owning_module, fields, types, defaults, validation_rules | Feeds the configuration module's JSON Schema definitions |

### 6.1 Wave 1 — Foundation (Zero-Dependency Modules)

| Module | Design Doc | Deliverables | Convention Plugin |
|---|---|---|---|
| `platform-api` | Doc 12 §8 | `HealthReporter`, `PlatformPaths` interfaces | test-fixtures-conventions |
| `event-model` | Doc 01 | All event types, `EventAppender`, `EventReader`, `EventQuerier`, `EventBus` interface, `CausalContext`, `DomainEvent` sealed hierarchy, upcaster infrastructure. **Plus testFixtures:** `InMemoryEventStore`, `TestEventFactory`, `TestCausalContext` | test-fixtures-conventions |

**Per-module workflow (applies to all waves):**
1. Read the Locked design document cover to cover.
2. Read the relevant reference artifact(s) from Pre-Wave.
3. Produce Java interfaces, records, sealed interfaces, enums with full Javadoc.
4. Produce `module-info.java` with explicit `exports` and `requires`.
5. Produce `package-info.java` for every package.
6. Produce test fixtures (for modules with `testFixtures` source set).
7. Verify: all types trace to design doc sections. No orphan types.
8. Verify: all interfaces with time-dependent behavior accept `java.time.Clock` as a constructor/factory parameter. No direct calls to `Instant.now()`, `System.currentTimeMillis()`, or `Clock.systemUTC()` permitted outside `homesynapse-app`. This is an ArchUnit rule enforced from Wave 1 onward.
9. Run Architecture Mismatch Detection: compare interface against design doc using automated `@see` references.

### 6.2 Wave 2 — Domain Models

| Module | Design Doc | Deliverables | Convention Plugin |
|---|---|---|---|
| `device-model` | Doc 02 | Device, Entity, Capability types, DeviceRegistry, EntityRegistry, CommandType, discovery and replacement interfaces. **Plus testFixtures.** | test-fixtures-conventions |
| `integration-api` | Doc 05 | IntegrationAdapter SPI, IntegrationContext, HealthStateMachine, CommandHandler, IntegrationDescriptor. **Plus testFixtures.** | test-fixtures-conventions |
| `configuration` | Doc 06 | ConfigurationService, SecretStore, ConfigSource SPI, schema validation types. **Plus testFixtures.** | test-fixtures-conventions |

### 6.3 Wave 3 — Derived State

| Module | Design Doc | Deliverables | Convention Plugin |
|---|---|---|---|
| `state-store` | Doc 03 | StateProjection, StateQueryService, EntityState, ProjectionLifecycle (inline + live). **Plus testFixtures.** | test-fixtures-conventions |
| `persistence` | Doc 04 | CheckpointStore, TelemetryWriter, TelemetryQueryService, PersistenceLifecycle, MaintenanceService, StorageMigration SPI. **Plus testFixtures.** | test-fixtures-conventions |
| `automation` | Doc 07 | AutomationRule, Trigger, Condition, Action types, AutomationRegistry, RunManager, CommandDispatchService, PendingCommandLedger, CascadeGovernor | library-conventions |

### 6.4 Wave 4 — Distribution & Presentation

| Module | Design Doc | Deliverables | Convention Plugin |
|---|---|---|---|
| `event-bus` | Doc 01 | (Implementation module — all types internal) | library-conventions |
| `integration-runtime` | Doc 05 | (Implementation module — IntegrationSupervisor internal) | library-conventions |
| `rest-api` | Doc 09 | Route definitions. **Plus** `specs/openapi/homesynapse-rest-api-v1.yaml` | library-conventions |
| `websocket-api` | Doc 10 | Relay and session interfaces. **Plus** `specs/asyncapi/homesynapse-websocket-v1.yaml` | library-conventions |
| `observability` | Doc 11 | HealthAggregator, TraceQueryService, HealthContributor SPI, JFR event definitions | library-conventions |

### 6.5 Wave 5 — Assembly & Periphery

| Module | Design Doc | Deliverables | Convention Plugin |
|---|---|---|---|
| `integration-zigbee` | Doc 08 | All internal (coordinator transports, ZCL mapping, interview pipeline). **Plus** `integration.yaml` manifest. | library-conventions |
| `platform-systemd` | Doc 12 | SystemdHealthReporter, LinuxSystemPaths (internal) | library-conventions |
| `lifecycle` | Doc 12 | SystemLifecycleManager, seven-phase startup, graceful shutdown (all internal) | library-conventions |
| `dashboard` | Doc 13 | Static file structure, Vite build configuration | (custom) |
| `homesynapse-app` | — | Main class stub, jlink config, systemd unit template | application-conventions |
| `test-support` | — | TestClock, TestIntegrationContext, NoRealIoExtension, SynchronousEventBus, GivenWhenThen DSL, custom assertions | library-conventions |

### 6.6 Architecture Mismatch Detection (AMD) Protocol

After each module's interface specification is complete:

1. **Automated `@see` extraction:** Every public type's Javadoc must include `@see` references to the design document section it implements. Extract these programmatically and verify full coverage.
2. **Interface count verification:** Count interfaces, records, enums, sealed interfaces per module. Compare against design document expectations (each doc's §8 Key Interfaces section).
3. **Cross-reference check:** Verify that every type referenced by another module's design doc exists in the referenced module's public API.
4. **Invariant spot-check:** For each module, verify that the 3-5 most critical invariants are reflected in the interface contracts (via Javadoc `@invariant` tags or method preconditions).

---

## 7. Phase 3 Plan (Refined)

### 7.0 SQLite WAL Validation Spike

Before any Phase 3 implementation, validate SQLite WAL behavior empirically:
- **Question:** Does sqlite-jdbc 3.51.2.0 on Corretto 21 with WAL mode meet our append-only workload requirements under the concurrency model described in Doc 04?
- **Success criteria:** (1) Append 100K events in <10s, (2) WAL checkpoint completes without blocking readers, (3) Kill -9 at random points produces zero event loss, (4) Virtual thread compatibility confirmed (no SQLITE_BUSY under concurrent reads).
- **Location:** `spike/wal-validation/`
- **Results recorded in:** `homesynapse-core-docs/research/sqlite-wal-validation-spike.md`

### 7.1 TDD Cycle (Strict)

For every module in Phase 3:
1. Write test against Phase 2 interface.
2. Verify test fails (no implementation exists).
3. Write minimal implementation to pass the test.
4. Refactor. All tests still pass.
5. Repeat.

Implementation code that exists without a corresponding failing test first is a governance violation.

### 7.2 Test Categories

| Category | Location | Tools | Runs |
|---|---|---|---|
| Unit tests | `<module>/src/test/` | JUnit 5, AssertJ, module test fixtures | Every build |
| Architecture tests | `test-support` or `<module>/src/test/` | ArchUnit | Every build |
| Integration tests | Separate `src/integrationTest/` source set | Full wired context via TestIntegrationContext | CI only |
| Performance tests | Separate `src/performanceTest/` source set | JMH via `me.champeau.jmh` Gradle plugin | CI builds JMH jar only (`./gradlew jmhJar`); execution on physical Pi 5 hardware via self-hosted runner or manual invocation. Results tracked in `benchmark-data` branch or CSV in docs repo. No automated regression detection until ≥10 data points establish a baseline. |

**Test execution time budgets:**

| Scope | Command | Target | Enforcement |
|---|---|---|---|
| Unit + architecture | `./gradlew test` | < 30 seconds (all 19 modules) | CI fails if exceeded |
| Integration tests | `./gradlew integrationTest` | < 60 seconds (all 19 modules) | CI warns if exceeded |
| Performance benchmarks | `./gradlew jmhJar` (build only) | N/A (build time only) | Run on Pi hardware |

If any single module's unit tests exceed 5 seconds, investigate — likely a missing in-memory replacement or accidental real I/O. The `SynchronousEventBus` is critical for meeting these budgets: it delivers events inline rather than through async dispatch, making event-driven tests deterministic without `Thread.sleep()` or polling.

### 7.3 Test Infrastructure (test-support module + per-module testFixtures)

**Per-module test fixtures** (consumed via `testFixtures(project(...))`):**

| Module | Test Fixtures Provided |
|---|---|
| `event-model` | `InMemoryEventStore` (production-quality, thread-safe implementation of the full `EventAppender` + `EventReader` + `EventQuerier` interface contract: append with causal context, read by subject, global stream with position tracking, retention policy awareness, subscriber notification, duplicate detection, and `reset()` for test isolation. Must pass the same contract test suite as `SQLiteEventStore` — behavioral equivalence validates the interface design. NOT a stub.), `TestEventFactory`, `TestCausalContext` |
| `device-model` | `TestDeviceFactory`, `TestEntityFactory`, `TestCapabilityFactory` |
| `state-store` | `InMemoryStateStore`, `TestProjectionFixture` |
| `persistence` | `InMemoryCheckpointStore`, `InMemoryTelemetryStore` |
| `integration-api` | `StubIntegrationContext`, `TestAdapter`, `StubCommandHandler` |
| `configuration` | `InMemoryConfigStore`, `TestConfigFactory` |

**Cross-cutting test-support module:**

| Component | Purpose |
|---|---|
| `TestClock` | Controllable clock for deterministic time-dependent tests |
| `TestIntegrationContext` | Full wired test context with in-memory everything, for integration tests |
| `SynchronousEventBus` | Single-threaded bus ensuring deterministic subscriber ordering |
| `NoRealIoExtension` | Two-layer enforcement: (1) ArchUnit rules preventing direct `java.net.Socket`, `java.net.HttpURLConnection`, `java.io.File`, `java.nio.file.Files` usage in test classes not annotated with `@RealIo`; (2) lightweight JUnit 5 extension overriding `ProxySelector.getDefault()` to throw `AssertionError` on non-localhost connections. Does NOT use `SecurityManager` (removed in Java 21) or bytecode instrumentation. Primary enforcement is architectural: all I/O flows through injectable interfaces with in-memory replacements. |
| `GivenWhenThen` | Event-sourced assertion DSL: given(events).when(command).then(expectedEvents) |
| `assertions/` | Custom AssertJ assertions: `assertThat(event).hasCorrelationId(...)`, etc. |

### 7.4 Implementation Order

Follows the same wave structure as Phase 2, with tests written first in each step:

| Step | Module(s) | Key Implementation |
|---|---|---|
| 3.0 | (spike) | SQLite WAL validation spike |
| 3.1.1 | `platform-api`, `platform-systemd` | Platform abstractions + systemd implementation |
| 3.1.2 | `event-model` | Event envelope, DomainEvent hierarchy, serialization |
| 3.1.3 | `test-support` | Cross-cutting test infrastructure |
| 3.1.4 | `event-bus` | InProcessEventBus, subscriber dispatch, backpressure |
| 3.1.5 | `persistence` | SQLiteEventStore, TelemetryRingStore, checkpoint, maintenance |
| 3.2.1 | `device-model` | Device/Entity/Capability types, registries |
| 3.2.2 | `state-store` | StateProjection, inline + live projection lifecycles |
| 3.2.3 | `configuration` | Six-stage loading pipeline, secret store, hot reload |
| 3.3.1 | `automation` | Trigger-Condition-Action, CommandDispatch, PendingCommandLedger |
| 3.3.2 | `integration-api`, `integration-runtime` | IntegrationSupervisor, health state machine, thread management |
| 3.4.1 | `rest-api` | Javalin endpoints, ETag, rate limiting |
| 3.4.2 | `websocket-api` | Event relay, subscriptions, backpressure escalation |
| 3.4.3 | `observability` | HealthAggregator, TraceQueryService, JFR events |
| 3.5.1 | `integration-zigbee` | Coordinator transports, ZCL mapping, device interview |
| 3.5.2 | `lifecycle` | Seven-phase startup, graceful shutdown, watchdog |
| 3.5.3 | `homesynapse-app` | Assembly wiring, jlink image, startup/shutdown |
| 3.5.4 | `dashboard` | Static file packaging, Vite build integration |
| 3.6 | (end-to-end) | 50 Zigbee devices, 72+ hours, kill -9 recovery |

### 7.5 End-to-End Validation Criteria

From MVP §4 (Tier 1 Acceptance Test):
- 50 Zigbee devices, stable for 72+ hours on Raspberry Pi 4
- Kill -9 recovery with zero event loss
- Integration crash isolation demonstrated
- Event trace answers "why did this happen?" for any device state change
- All performance targets from MVP §8 met

---

## 8. Consistency Enforcement (4 Layers)

### Layer 1: Compile-Time (immediate feedback)

| Mechanism | Enforces | Source |
|---|---|---|
| JPMS `module-info.java` | Package visibility — `.internal` packages not exported | Helidon pattern, LTD-10 |
| `api()` vs `implementation()` | Transitive vs. non-transitive dependency visibility | Gradle best practice |
| `-Xlint:all -Werror` | No warnings in production code | Standard quality bar |
| Spotless copyright header check | Every file has correct license header | LTD-18 |

### Layer 2: Test-Time (every build)

| Mechanism | Enforces | Source |
|---|---|---|
| `modules-graph-assert` | Module-level dependency rules (§5.3) | LTD-10 |
| ArchUnit tests | Package-level architecture rules (e.g., no `core` → `integration` imports) | LTD-10 |
| ArchUnit Freeze Rules | No new violations; existing violations tracked and shrink over time | Apache Commons pattern |
| ArchUnit Clock rule | No direct `Instant.now()`, `System.currentTimeMillis()`, or `Clock.systemUTC()` outside `homesynapse-app` | Research finding: largest factor in flaky test prevention |
| `NoRealIoExtension` | Unit tests don't perform real I/O | Home Assistant's `check_real()` pattern |

### Layer 3: CI-Time (every PR)

| Mechanism | Enforces | Source |
|---|---|---|
| `japicmp` | Binary compatibility on API-surface modules (event-model, device-model, integration-api, platform-api). Configured to fail on `STABLE`/`MAINTAINED` API breaks, warn on `EXPERIMENTAL`, ignore `INTERNAL`. | Apache Commons pattern, gRPC-Java |
| `@API(status)` annotations | All new public interfaces annotated with `@API(status = EXPERIMENTAL)` during Phase 2. Graduated to `MAINTAINED` after one release cycle. Uses `org.apiguardian:apiguardian-api:1.1.2` (RUNTIME retention). | JUnit 5 pattern, Gradle pattern |
| `oasdiff` | OpenAPI/AsyncAPI spec backward compatibility | SmartThings pattern |
| Full `./gradlew check` | All tests pass, all lint passes, all dependency rules pass | Standard CI |

### Layer 4: Review-Time (human + agent)

| Mechanism | Enforces | Source |
|---|---|---|
| AMD protocol (§6.6) | Interface specs match design documents | HomeSynapse-specific |
| `@see` reference coverage | Every public type traces to a design doc section | Traceability requirement |
| MODULE_CONTEXT.md currency | Per-module context files updated with each change | Context architecture |

### Coverage Gates (JaCoCo)

| Module Category | Modules | Line Coverage Gate |
|---|---|---|
| Core domain | event-model, device-model, state-store, automation, persistence, event-bus | 70% |
| API surface | rest-api, websocket-api, integration-api, integration-runtime, configuration | 60% |
| Infrastructure | platform-api, platform-systemd, lifecycle, observability, homesynapse-app | No gate |
| Test support | test-support | No gate |
| Web UI | dashboard | No gate |

Enforced via JaCoCo in the convention plugin with per-module overrides. Coverage gates apply to Phase 3 implementation — Phase 2 interface-only modules are exempt.

---

## 9. Scaffold File List

Every file that must exist after the initial scaffold setup (Prompt 13). Changes from v1 marked.

### Root Files

| File | Content |
|---|---|
| `settings.gradle.kts` | Root project name `homesynapse-core`, includeBuild for `build-logic`, include for all 19 modules |
| `gradle.properties` | `org.gradle.parallel=true`, `org.gradle.caching=true`, `org.gradle.configuration-cache=true` |
| `build.gradle.kts` | Root: `modules-graph-assert` plugin, dependency rules from §5.3 |
| `.gitignore` | Gradle, IntelliJ, macOS, .DS_Store, build outputs |
| `.editorconfig` | UTF-8, LF line endings, 4-space indent, trim trailing whitespace ← NEW |
| `LICENSE` | Proprietary notice (NexSys Technologies 2025-2026) |
| `README.md` | Build instructions, license notice, link to design docs |
| `CONTEXT.md` | Agent context primer (§3 of this document) |

### Gradle Wrapper

| File | Content |
|---|---|
| `gradle/libs.versions.toml` | Version catalog from transition guide §5 with verified versions |
| `gradle/wrapper/gradle-wrapper.properties` | Gradle 8.12+ distribution URL |
| `gradle/wrapper/gradle-wrapper.jar` | Wrapper JAR |
| `gradle/license-header.txt` | Copyright header template for Spotless |

### Build Logic

| File | Content |
|---|---|
| `build-logic/settings.gradle.kts` | `rootProject.name = "build-logic"` |
| `build-logic/build.gradle.kts` | `kotlin-dsl` plugin, Spotless dependency, modules-graph-assert dependency |
| `build-logic/src/main/kotlin/homesynapse.java-conventions.gradle.kts` | Base convention (§5.2) |
| `build-logic/src/main/kotlin/homesynapse.library-conventions.gradle.kts` | Library convention (§5.2) ← NEW |
| `build-logic/src/main/kotlin/homesynapse.application-conventions.gradle.kts` | App convention (§5.2) ← NEW |
| `build-logic/src/main/kotlin/homesynapse.test-fixtures-conventions.gradle.kts` | Test fixtures convention (§5.2) ← NEW |

### Per-Module Files (19 modules)

Each module gets at minimum:

| File | Content |
|---|---|
| `<module>/build.gradle.kts` | Applies appropriate convention plugin, declares dependencies |
| `<module>/src/main/java/module-info.java` | JPMS module descriptor with explicit exports |
| `<module>/src/main/java/com/homesynapse/<pkg>/package-info.java` | Package-level Javadoc placeholder |
| `<module>/src/test/java/com/homesynapse/<pkg>/package-info.java` | Test package placeholder |

For the 6 test-fixture modules, additionally:

| File | Content |
|---|---|
| `<module>/src/testFixtures/java/com/homesynapse/<pkg>/test/package-info.java` | Test fixtures package placeholder |

For `integration-zigbee`, additionally:

| File | Content |
|---|---|
| `src/main/resources/META-INF/homesynapse/integration.yaml` | Integration quality tier manifest ← NEW |

### Documentation Files

| File | Content |
|---|---|
| `docs/ARCHITECTURE.md` | Architecture overview with links to design docs |
| `docs/CONTRIBUTING.md` | Build, test, and contribution guidelines |
| `docs/MODULE_MAP.md` | Visual dependency map (placeholder for generated content) |
| `docs/modules/<module-name>.md` | MODULE_CONTEXT.md for each of 19 modules |

### Specification Files

| File | Content |
|---|---|
| `specs/openapi/homesynapse-rest-api-v1.yaml` | OpenAPI 3.1 skeleton (populated in Wave 4) |
| `specs/asyncapi/homesynapse-websocket-v1.yaml` | AsyncAPI 3.0 skeleton (populated in Wave 4) |

### Reference Artifacts (Pre-Wave)

| File | Content |
|---|---|
| `reference/event-type-registry.md` | Placeholder (populated before Wave 1) |
| `reference/subscriber-registry.md` | Placeholder (populated before Wave 1) |
| `reference/configuration-schema-registry.md` | Placeholder (populated before Wave 1) |

### Spike Directory

| File | Content |
|---|---|
| `spike/.gitkeep` | Placeholder for spike code |

---

## 10. Decisions for Nick's Review

This document incorporates all 12 previously resolved decisions (A through L) and proposes 5 new decisions based on the competitive research:

### Decision M: Four layered convention plugins

**Proposed:** Replace single `homesynapse.java-conventions.gradle.kts` with four layered plugins (§5.2).
**Rationale:** Different modules need different build configurations. Layered plugins prevent conditional logic and configuration duplication.
**Alternative:** Single plugin with conditional blocks. Rejected: harder to maintain, less discoverable.

### Decision N: Per-module test fixtures via `java-test-fixtures` plugin

**Proposed:** Six modules publish their own test fixtures alongside their production API (§1.2, Change 3).
**Rationale:** Occurrent, Axon, and OpenHAB all validate this pattern. Co-locating in-memory implementations with their API interfaces makes them discoverable and ensures they stay in sync.
**Alternative:** All test fixtures in single `test-support` module. Rejected: creates a grab-bag; fixtures for unused modules get pulled in.

### Decision O: `.spi` sub-package convention for extension points

**Proposed:** Add `com.homesynapse.<subsystem>.spi` packages for 5 modules with extension points (§1.2, Change 4).
**Rationale:** Helidon's practice, validated by Micronaut. Distinguishes "API for consumers" from "SPI for implementors." JPMS exports `.spi` packages selectively.
**Alternative:** All public types in root package. Rejected: no visibility into extension vs. consumption intent.

### Decision P: `event-model` zero-dependency foundation

**Proposed:** Remove `event-model`'s dependency on `platform-api`. Move any platform-api usage to `event-bus` (implementation module).
**Rationale:** Doc 01 says "Dependencies: None (foundational)." Axon, Occurrent, and the research conclusion all agree: the foundation module defines the project's ceiling and must have zero framework dependencies.
**Alternative:** Keep `platform-api` dependency. Rejected: contradicts Doc 01 and limits `event-model`'s reusability.

### Decision Q: Integration quality tier metadata

**Proposed:** Each integration module includes a `META-INF/homesynapse/integration.yaml` manifest with quality tier metadata.
**Rationale:** Home Assistant's Quality Scale (Bronze through Platinum) with `manifest.json` is their most effective quality enforcement mechanism, scaling to 2,000+ integrations.
**Alternative:** No metadata. Rejected: loses the opportunity to enforce quality standards as integrations scale.

---

## 11. Summary of All Changes from Plan v1

| # | Change | Category | Impact |
|---|---|---|---|
| 1 | `event-model` zero HomeSynapse dependencies | Dependency structure | Foundation module strengthened |
| 2 | `event-bus` gains `platform-api` dependency | Dependency structure | Health reporting moves to implementation |
| 3 | Four convention plugins (was one) | Build system | Cleaner per-module configuration |
| 4 | `java-test-fixtures` on 6 modules | Build system + testing | In-memory impls co-located with APIs |
| 5 | `.spi` packages on 5 modules | Package convention | Extension points explicitly marked |
| 6 | Decomposed event store interfaces | Interface design (Phase 2) | `EventAppender`, `EventReader`, `EventQuerier` |
| 7 | Integration quality tier manifest | Integration metadata | `integration.yaml` per adapter |
| 8 | `modules-graph-assert` rules codified | Build enforcement | 7 explicit dependency rules |
| 9 | `.editorconfig` added | Developer experience | Consistent formatting across IDEs |
| 10 | `GivenWhenThen` assertion DSL in test-support | Testing | Event-sourced test pattern from Axon |
| 11 | Custom AssertJ assertions in test-support | Testing | Domain-specific assertion methods |
| 12 | `integration-runtime` explicit `platform-api` dep | Dependency structure | Health reporting for supervisor |

**What did NOT change:** Module count (19), module names, directory layout layers, base package (`com.homesynapse`), monorepo structure, YAML-only configuration, JPMS enforcement, `.internal` convention, Phase 2/3 wave ordering, production order, acceptance criteria, performance budgets.

The refined structure adopts the best-validated patterns from 17 projects while staying true to HomeSynapse's identity as a domain-specific product (not a generic framework) targeting constrained hardware.
