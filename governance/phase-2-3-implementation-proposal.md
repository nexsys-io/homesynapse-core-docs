# HomeSynapse Core — Phase 2/3 Implementation Proposal

**Document type:** Proposal (not locked — for Nick's review)
**Date:** 2026-03-10
**Author:** Hivemind
**Status:** Draft — awaiting Nick's feedback before execution

---

## 0. What This Document Is

This is the Hivemind's complete proposal for how the `homesynapse-core` repository should be structured, what documentation lives where, how Phase 2 (interface specification) flows into Phase 3 (test-driven implementation), and what the concrete work sequence looks like. It synthesizes everything from the 14 locked design documents, the Gradle module map (Doc 14 §3.6), the phase guide, the transition guide, and the subsystem dependency catalog.

This is not a governance artifact. It is a proposal for your review. Once you approve (with any modifications), the Hivemind will produce task briefs from it.

---

## 1. Repository Structure

### 1.1 The Two Repositories

| Repository | Purpose | Contains |
|---|---|---|
| `homesynapse-core-docs` | Governance, design, research | Everything produced in Phase 1 + governance artifacts. Already exists. |
| `homesynapse-core` | Production code | All Java source, build files, tests, config schemas, API specs. Created during scaffold setup. |

The docs repo remains the authoritative source for architectural decisions. The code repo implements them. When a design document says "X", the code must do X. If the code reveals that X is wrong, the formal revision process in the docs repo happens first — then the code changes.

### 1.2 `homesynapse-core` Repository Layout

This follows Doc 14 §3.6 exactly, with additions for documentation, spikes, and CI:

```
homesynapse-core/
│
├── LICENSE                                 # Proprietary (transition guide §3)
├── README.md                               # Build instructions, license notice
├── settings.gradle.kts                     # Root project + all module declarations
├── .gitignore                              # Gradle, IntelliJ, macOS, .DS_Store
├── .github/
│   └── workflows/
│       └── ci.yml                          # ./gradlew check on push
│
├── gradle/
│   ├── libs.versions.toml                  # Version catalog (transition guide §5)
│   └── wrapper/
│       └── ...                             # Gradle wrapper
│
├── build-logic/                            # Convention plugins (included build)
│   ├── settings.gradle.kts
│   ├── build.gradle.kts
│   └── src/main/kotlin/
│       ├── homesynapse.java-conventions.gradle.kts
│       │   # Java 21 toolchain, -Xlint:all -Werror,
│       │   # Spotless copyright header check, common test config
│       └── homesynapse.library-conventions.gradle.kts
│           # Extends java-conventions, adds publishing config if needed
│
├── platform/
│   ├── platform-api/                       # HealthReporter, PlatformPaths
│   │   ├── build.gradle.kts
│   │   └── src/
│   │       ├── main/java/com/homesynapse/platform/
│   │       │   ├── package-info.java
│   │       │   ├── HealthReporter.java
│   │       │   └── PlatformPaths.java
│   │       └── test/java/com/homesynapse/platform/
│   │
│   └── platform-systemd/                   # SystemdHealthReporter, LinuxSystemPaths
│       ├── build.gradle.kts
│       └── src/
│           ├── main/java/com/homesynapse/platform/systemd/
│           └── test/java/com/homesynapse/platform/systemd/
│
├── core/
│   ├── event-model/                        # Doc 01: Event types, envelope, publisher
│   │   ├── build.gradle.kts
│   │   └── src/
│   │       ├── main/java/com/homesynapse/event/
│   │       │   ├── package-info.java
│   │       │   ├── model/                  # EventEnvelope, DomainEvent, EventPriority, etc.
│   │       │   ├── publish/               # EventPublisher, CausalContext
│   │       │   ├── store/                 # EventStore interface
│   │       │   ├── bus/                   # EventBus, SubscriptionFilter, SubscriberLifecycle
│   │       │   └── upcasting/             # UpcasterRegistry, Upcaster
│   │       └── test/java/com/homesynapse/event/
│   │
│   ├── device-model/                       # Doc 02: Device/Entity/Capability
│   │   ├── build.gradle.kts
│   │   └── src/
│   │       ├── main/java/com/homesynapse/device/
│   │       │   ├── model/                 # Device, Entity, Capability, EntityType, etc.
│   │       │   ├── registry/              # DeviceRegistry, EntityRegistry, CapabilityRegistry
│   │       │   ├── command/               # CommandValidator, ExpectationFactory, Expectation
│   │       │   ├── discovery/             # DiscoveryPipeline, ProposedDevice
│   │       │   └── replacement/           # DeviceReplacementService
│   │       └── test/java/com/homesynapse/device/
│   │
│   ├── state-store/                        # Doc 03: State projection, query service
│   │   ├── build.gradle.kts
│   │   └── src/
│   │       ├── main/java/com/homesynapse/state/
│   │       │   ├── model/                 # EntityState, AttributeValue (sealed)
│   │       │   ├── projection/            # StateProjection
│   │       │   └── query/                 # StateQueryService
│   │       └── test/java/com/homesynapse/state/
│   │
│   ├── persistence/                        # Doc 04: EventStore impl, telemetry, maintenance
│   │   ├── build.gradle.kts
│   │   └── src/
│   │       ├── main/java/com/homesynapse/persistence/
│   │       │   ├── event/                 # SQLiteEventStore
│   │       │   ├── telemetry/             # TelemetryStore, TelemetryWriter
│   │       │   ├── checkpoint/            # CheckpointService
│   │       │   ├── maintenance/           # RetentionService, VacuumService
│   │       │   └── migration/             # SchemaMigrator
│   │       └── test/java/com/homesynapse/persistence/
│   │
│   ├── event-bus/                          # Doc 01 (bus implementation)
│   │   ├── build.gradle.kts
│   │   └── src/
│   │       ├── main/java/com/homesynapse/event/bus/
│   │       │   └── impl/                 # InProcessEventBus, dispatch logic
│   │       └── test/java/com/homesynapse/event/bus/
│   │
│   └── automation/                         # Doc 07: TCA engine
│       ├── build.gradle.kts
│       └── src/
│           ├── main/java/com/homesynapse/automation/
│           │   ├── model/                 # AutomationDefinition, Run, Trigger, Condition, Action
│           │   ├── registry/              # AutomationRegistry
│           │   ├── execution/             # RunManager, trigger evaluation
│           │   ├── command/               # CommandDispatchService, PendingCommandLedger
│           │   └── cascade/               # CascadeGovernor
│           └── test/java/com/homesynapse/automation/
│
├── integration/
│   ├── integration-api/                    # Doc 05: adapter-facing contracts
│   │   ├── build.gradle.kts
│   │   └── src/
│   │       ├── main/java/com/homesynapse/integration/
│   │       │   ├── api/                   # IntegrationAdapter, IntegrationFactory, IntegrationContext
│   │       │   ├── health/               # HealthReporter (integration-level), HealthState, HealthParameters
│   │       │   ├── command/              # CommandHandler, CommandEnvelope
│   │       │   ├── descriptor/           # IntegrationDescriptor, IoType, RequiredService
│   │       │   └── exception/            # PermanentIntegrationException
│   │       └── test/java/com/homesynapse/integration/
│   │
│   ├── integration-runtime/                # Doc 05: supervisor, lifecycle
│   │   ├── build.gradle.kts
│   │   └── src/
│   │       ├── main/java/com/homesynapse/integration/runtime/
│   │       │   ├── supervisor/           # IntegrationSupervisor
│   │       │   ├── health/               # HealthStateMachine
│   │       │   └── thread/               # Thread allocation (platform vs virtual)
│   │       └── test/java/com/homesynapse/integration/runtime/
│   │
│   └── integration-zigbee/                 # Doc 08: Zigbee adapter
│       ├── build.gradle.kts
│       └── src/
│           ├── main/java/com/homesynapse/integration/zigbee/
│           │   ├── transport/            # ZNP/EZSP transport, serial I/O
│           │   ├── protocol/             # ZCL, cluster handlers
│           │   ├── device/               # Interview pipeline, profiles
│           │   ├── codec/                # Tuya DP, Xiaomi TLV
│           │   └── network/              # Topology, security, permit-join
│           └── test/java/com/homesynapse/integration/zigbee/
│
├── config/
│   └── configuration/                      # Doc 06: config loading, secrets, schemas
│       ├── build.gradle.kts
│       └── src/
│           ├── main/java/com/homesynapse/config/
│           │   ├── loading/              # Six-stage pipeline
│           │   ├── schema/               # Schema composition, validation
│           │   ├── secret/               # SecretStore (AES-256-GCM)
│           │   ├── migration/            # ConfigMigrator
│           │   └── reload/               # Hot reload, atomic swap
│           └── test/java/com/homesynapse/config/
│
├── api/
│   ├── rest-api/                           # Doc 09: Javalin REST endpoints
│   │   ├── build.gradle.kts
│   │   └── src/
│   │       ├── main/java/com/homesynapse/api/rest/
│   │       │   ├── endpoint/             # One class per operational plane
│   │       │   ├── error/                # RFC 9457 Problem Details
│   │       │   ├── auth/                 # API key validation
│   │       │   ├── pagination/           # Cursor-based pagination
│   │       │   └── middleware/           # Rate limiting, correlation ID
│   │       └── test/java/com/homesynapse/api/rest/
│   │
│   └── websocket-api/                      # Doc 10: WebSocket relay
│       ├── build.gradle.kts
│       └── src/
│           ├── main/java/com/homesynapse/api/websocket/
│           │   ├── relay/                # EventRelay subscriber
│           │   ├── connection/           # Connection lifecycle, auth
│           │   ├── subscription/         # Filter management, resume
│           │   └── backpressure/         # Four-stage escalation
│           └── test/java/com/homesynapse/api/websocket/
│
├── observability/
│   └── observability/                      # Doc 11: health, traces, JFR
│       ├── build.gradle.kts
│       └── src/
│           ├── main/java/com/homesynapse/observability/
│           │   ├── health/               # HealthAggregator, HealthContributor
│           │   ├── trace/                # TraceQueryService, causal chain assembly
│           │   ├── jfr/                  # Custom JFR events, recording management
│           │   └── metrics/              # MetricsStreamBridge
│           └── test/java/com/homesynapse/observability/
│
├── web-ui/
│   └── dashboard/                          # Doc 13: Preact SPA
│       ├── build.gradle.kts                # Just packages pre-built static files
│       ├── package.json                    # Vite + Preact
│       └── src/                            # Preact component tree (Phase 3)
│
├── lifecycle/
│   └── lifecycle/                          # Doc 12: startup, shutdown, watchdog
│       ├── build.gradle.kts
│       └── src/
│           ├── main/java/com/homesynapse/lifecycle/
│           │   ├── startup/              # SystemLifecycleManager, phase sequencing
│           │   ├── shutdown/             # Graceful shutdown orchestration
│           │   └── watchdog/             # Systemd watchdog protocol
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
├── schema/                                 # JSON Schemas + API specs (Phase 2 output)
│   ├── config/                             # JSON Schema per configuration namespace
│   │   ├── event-model.schema.json
│   │   ├── device-model.schema.json
│   │   ├── state-store.schema.json
│   │   ├── persistence.schema.json
│   │   ├── integration-runtime.schema.json
│   │   ├── config-system.schema.json
│   │   ├── automation.schema.json
│   │   ├── zigbee.schema.json
│   │   ├── api.schema.json
│   │   └── observability.schema.json
│   ├── openapi/
│   │   └── homesynapse-rest-api-v1.yaml    # OpenAPI 3.1 (Doc 09)
│   └── asyncapi/
│       └── homesynapse-websocket-v1.yaml   # AsyncAPI 3.0 (Doc 10)
│
└── spike/                                  # Throwaway spike code (never production)
    └── README.md                           # "Everything in this directory is throwaway"
```

### 1.3 Documentation Within the Code Repository

This is where I want to be precise about what lives where, because sloppy documentation placement kills consistency.

**Principle:** The design documents in `homesynapse-core-docs` are the authority. The code repo contains only documentation that is *about the code itself* — not duplications of design decisions.

| Location | What Goes There | What Does NOT Go There |
|---|---|---|
| Root `README.md` | Build instructions, license notice, project name, link to docs repo | Architecture descriptions, design rationale |
| `build-logic/README.md` | How the convention plugins work, what they enforce | Why Java 21, why Spotless |
| Each module's `src/main/java/.../package-info.java` | Package-level Javadoc: what this package does, key types, relationship to other packages | Design rationale (that belongs in the design doc) |
| Each interface's Javadoc | Contract: preconditions, postconditions, exception semantics, thread safety, @see references to design doc section | Implementation strategy |
| `schema/README.md` | How to validate config against schemas, how to use OpenAPI/AsyncAPI specs | Why the config structure is what it is |
| `spike/README.md` | Rules for spike code (throwaway, labeled, findings go to design docs) | Actual findings (those go to docs repo) |

**The critical Javadoc-to-design-doc link:** Every public interface and type gets a `@see` tag that references the specific design document section it implements. Example:

```java
/**
 * Appends domain events to the event store with compile-time causality enforcement.
 *
 * <p>Every event published through this interface is persisted to the domain event store
 * before distribution to subscribers. The at-least-once delivery guarantee means
 * subscribers may receive duplicate events; idempotency is the subscriber's responsibility.
 *
 * @see <a href="https://github.com/nexsys/homesynapse-core-docs/design/01-event-model-and-event-bus.md#83-eventpublisher">Doc 01 §8.3</a>
 */
public interface EventPublisher { ... }
```

This traceability link is the enforcement mechanism for keeping code consistent with design docs. If a design doc changes, grepping for `@see` references to that section identifies every interface that might need updating.

---

## 2. Phase 2 Approach: Interface Specification

### 2.1 What Phase 2 Actually Produces

Phase 2 is not prose. It is **compilable Java source**. The deliverable for each subsystem is:

1. All public interfaces with full method signatures, generics, checked exceptions, and Javadoc contracts.
2. All public types: records, enums, sealed interfaces, exception types.
3. No implementation code. Abstract methods or methods that throw `UnsupportedOperationException`.
4. Compiles cleanly with `javac -source 21 -Xlint:all -Werror`.

Plus, per subsystem where applicable:
- JSON Schema files for configuration namespaces.
- OpenAPI 3.1 for REST endpoints (Doc 09).
- AsyncAPI 3.0 for WebSocket protocol (Doc 10).

### 2.2 Production Order

The dependency graph dictates the order. Each subsystem's interfaces can only be specified once all upstream interfaces are locked. This is the sequence:

**Wave 1 — Foundation (no upstream dependencies):**
1. `platform-api` — HealthReporter, PlatformPaths (Doc 12 §8, but zero dependencies)
2. `event-model` — EventEnvelope, DomainEvent, EventPublisher, EventStore, EventBus, CausalContext, all event types (Doc 01)

**Wave 2 — Core domain (depends on event-model):**
3. `device-model` — Device, Entity, Capability, registries, command validation (Doc 02, depends on Doc 01)
4. `integration-api` — IntegrationAdapter, IntegrationContext, IntegrationDescriptor (Doc 05, depends on Doc 01)
5. `configuration` — ConfigurationService, schema validation, SecretStore (Doc 06, depends on Doc 01)

**Wave 3 — Derived domain (depends on Wave 2):**
6. `state-store` — StateProjection, StateQueryService, EntityState (Doc 03, depends on Docs 01+02)
7. `automation` — AutomationRegistry, RunManager, CommandDispatchService, PendingCommandLedger (Doc 07, depends on Docs 01+02+06)
8. `persistence` — SQLiteEventStore interface contract, TelemetryStore, CheckpointService (Doc 04, depends on Docs 01+03)

**Wave 4 — External interfaces (depends on Wave 3):**
9. `event-bus` — InProcessEventBus implementation contract (Doc 01, but implementation-adjacent)
10. `integration-runtime` — IntegrationSupervisor (Doc 05, depends on integration-api + core)
11. `rest-api` — Javalin endpoint contracts, error model, pagination (Doc 09, depends on Docs 02+03+07)
12. `websocket-api` — EventRelay, subscription model, backpressure (Doc 10, depends on Doc 01)
13. `observability` — HealthAggregator, HealthContributor, TraceQueryService (Doc 11, depends on Docs 01+03)

**Wave 5 — Assembly (depends on everything):**
14. `integration-zigbee` — ZigbeeAdapter contract (Doc 08, depends on integration-api only per LTD-17)
15. `lifecycle` — SystemLifecycleManager (Doc 12, depends on all preceding)
16. `homesynapse-app` — Main class wiring

**Parallel with Waves 2–5:**
- `schema/config/*.schema.json` — produced as each subsystem's interfaces stabilize
- `schema/openapi/` — produced during rest-api spec (Wave 4)
- `schema/asyncapi/` — produced during websocket-api spec (Wave 4)

### 2.3 Per-Subsystem Workflow (Phase 2)

For each subsystem in the order above:

1. **PM reads the locked design document.** Specifically: §8 (Key Interfaces), §5 (External Interfaces), §3 (Technical Design), §9 (Configuration), and the Glossary for canonical type names.

2. **PM produces the interface specification.** This is Java source files containing interfaces, records, enums, sealed interfaces. Every public method gets Javadoc with:
   - `@param` descriptions
   - `@return` semantics
   - `@throws` with conditions
   - Preconditions and postconditions in prose
   - `@see` link to design doc section
   - Thread safety contract

3. **PM produces the configuration schema.** JSON Schema file for this subsystem's YAML namespace, validated against the default values in Doc 14 §9.

4. **Compilation check.** The full project must compile after each subsystem's interfaces are added. No partial compilation states.

5. **Cross-subsystem consistency check.** After each wave completes, verify:
   - All type references across module boundaries resolve
   - Generic type parameters are consistent (e.g., if StateQueryService returns `EntityState`, and EntityState is defined in state-store, the dependency is declared)
   - Exception types are defined where they're thrown
   - No Glossary violations in type or method names

### 2.4 The RECOMMENDED Amendments (AMD-12, AMD-18–24)

These nine deferred amendments get integrated during Phase 2 as their relevant subsystems are specified:

| AMD | Integration Point | What Changes |
|---|---|---|
| AMD-12 | Doc 06 interface spec (Wave 2) | Structured error taxonomy for config validation — becomes exception hierarchy |
| AMD-18 | Doc 01 or Doc 07 interface spec | Causal chain timeout extension — may add a timeout field to CausalContext |
| AMD-19 | Doc 01 interface spec (Wave 1) | Subscriber backpressure signal — may add a backpressure callback interface |
| AMD-20 | Doc 05 interface spec (Wave 2) | Integration restart jitter — parameter on HealthParameters |
| AMD-21 | Doc 07 interface spec (Wave 3) | Automation conflict resolution — method on RunManager or new interface |
| AMD-22 | Doc 11 interface spec (Wave 4) | HealthChangeListener — new interface |
| AMD-23 | Doc 04 interface spec (Wave 3) | Telemetry store compaction trigger — method on TelemetryStore |
| AMD-24 | Doc 09 interface spec (Wave 4) | API key rotation without downtime — method on auth service |

When the PM encounters one of these during interface specification, the process is: (1) apply the amendment to the design document in the docs repo, (2) then define the interface in the code repo. Design doc stays authoritative.

---

## 3. Phase 3 Approach: Test-Driven Implementation

### 3.1 The Iron Rule: Tests First

Phase 3 follows strict test-driven development. The cycle for every subsystem is:

```
Write tests against Phase 2 interfaces
        ↓
Verify tests compile but FAIL (no implementation exists)
        ↓
Write implementation to make tests pass
        ↓
Verify all tests pass
        ↓
Integration tests with upstream subsystems
```

This is not a preference. It is a governance rule (Phase Guide §Phase 3). The Hivemind will not issue implementation task briefs until the corresponding test suite exists and fails.

### 3.2 Test Categories

Each subsystem gets four categories of tests, written in this order:

**Category 1: Contract Tests (written first, before implementation)**
Test the behavioral contracts specified in the design doc. These test *what* the subsystem does, not *how* it does it.

Examples for event-model:
- `EventPublisher.publish()` with valid event and causal context succeeds
- `EventPublisher.publish()` with null causal context throws
- `EventPublisher.publishRoot()` generates a new correlation_id
- Events are persisted before distribution to subscribers
- Subscribers receive events in global position order

**Category 2: Edge Case and Error Tests (written with contract tests)**
Test the failure modes documented in each design doc's §6 (Failure Modes) and §12 (Security).

Examples for persistence:
- WAL checkpoint under storage pressure
- kill -9 recovery (no data loss for committed events)
- Corruption detection via integrity check
- Retention enforcement with correct priority-based policies

**Category 3: Integration Tests (written after implementation, before next subsystem)**
Test the interaction between this subsystem and its dependencies.

Examples:
- Event published → persisted to EventStore → distributed via EventBus → received by StateProjection → state updated → queryable via StateQueryService
- Device discovered → proposed → adopted → entity created → state_reported events flow

**Category 4: Performance Tests (written last for each subsystem)**
Validate the performance targets from each design doc's §10.

Examples:
- Event throughput ≥ 100 events/sec sustained (Doc 01 §6)
- State query < 5ms p99 (Doc 03 §10)
- REST API response < 50ms p95 (Doc 09 §10)

### 3.3 Implementation Order

Phase 3 follows the same dependency graph as Phase 2 but with a critical addition: the SQLite WAL validation spike (transition guide §2) is the very first task.

**Phase 3.0 — WAL Validation Spike:**
- Confirms sqlite-jdbc 3.51.2.0 on aarch64 Linux with ext4
- Tests WAL persistence, synchronous=NORMAL safety, cache_size behavior, jlink tmpdir
- Results recorded in `research/sqlite-wal-validation-spike.md`
- If spike fails, sqlite-jdbc version revised before anything else

**Phase 3.1 — Foundation:**
1. `platform-api` — trivial implementations (LinuxSystemPaths, SystemdHealthReporter)
2. `event-model` + `event-bus` — in-memory EventStore for testing, InProcessEventBus
3. `persistence` — SQLiteEventStore (the real persistence engine)

These three together form the "event backbone" — everything else depends on events flowing.

**Phase 3.2 — Core Domain:**
4. `device-model` — registries backed by EventStore
5. `state-store` — StateProjection subscriber, StateQueryService
6. `configuration` — YAML loading pipeline, schema validation, SecretStore

**Phase 3.3 — Derived Domain:**
7. `automation` — trigger evaluation, condition checks, action execution, command pipeline
8. `integration-api` + `integration-runtime` — supervisor, health state machine

**Phase 3.4 — External Interfaces:**
9. `rest-api` — all five operational planes
10. `websocket-api` — event relay, subscriptions, backpressure
11. `observability` — HealthAggregator, TraceQueryService, JFR integration

**Phase 3.5 — Integration:**
12. `integration-zigbee` — coordinator transport, ZCL, device interview
13. `lifecycle` — SystemLifecycleManager, seven-phase startup
14. `homesynapse-app` — assembly, jlink distribution
15. `dashboard` — Preact SPA (separate Vite build pipeline)

**Phase 3.6 — End-to-End Validation:**
- 50 Zigbee devices, 72+ hours stable
- Memory budget validation against Doc 14 §3.5
- All MVP acceptance criteria from MVP §8

### 3.4 Test Infrastructure

To make TDD practical, Phase 3 needs lightweight test infrastructure from day one:

**In-Memory EventStore:** A simple, non-persistent EventStore implementation for unit tests. This avoids SQLite in every test. The real SQLiteEventStore gets its own dedicated tests.

**TestEventBus:** A synchronous EventBus for tests that delivers events immediately (no async dispatch). This makes tests deterministic.

**Test Fixtures:** Shared factories for creating test Device, Entity, EventEnvelope instances with sensible defaults. Avoids boilerplate in every test class.

**TestIntegrationContext:** A mock IntegrationContext for testing adapters without the full runtime.

These test utilities live in a shared `test-support` module:

```
core/
└── test-support/                       # Test fixtures, in-memory implementations
    ├── build.gradle.kts
    └── src/main/java/com/homesynapse/test/
        ├── InMemoryEventStore.java
        ├── SynchronousEventBus.java
        ├── TestFixtures.java
        └── TestIntegrationContext.java
```

Every module that needs test infrastructure declares a `testImplementation` dependency on `test-support`.

---

## 4. Consistency Enforcement

The hardest problem is keeping code consistent with 14 design documents across months of development. Here is the enforcement strategy:

### 4.1 Compile-Time Enforcement

| Mechanism | What It Catches | When |
|---|---|---|
| Spotless copyright header check | Missing headers | Every build |
| `-Xlint:all -Werror` | Unsafe code patterns | Every build |
| `modules-graph-assert` | Illegal module dependencies (e.g., zigbee→core) | Every build |
| JPMS `module-info.java` | Package visibility violations | Every build |

### 4.2 Test-Time Enforcement

| Mechanism | What It Catches | When |
|---|---|---|
| ArchUnit tests | Import rule violations, naming convention violations | Every test run |
| Contract tests | Behavioral deviations from design doc specs | Every test run |
| JSON Schema validation tests | Config schema drift from design doc §9 | Every test run |
| OpenAPI/AsyncAPI validation | API spec drift from Doc 09/10 | Every test run |

### 4.3 Review-Time Enforcement

| Mechanism | What It Catches | When |
|---|---|---|
| `@see` Javadoc links | Traceability from code to design doc | Code review |
| Glossary term audit | Non-canonical names in code | Periodic (automated grep) |
| Design doc diff review | When a design doc is amended, grep all `@see` references to that section | On amendment |

### 4.4 Traceability Matrix

During Phase 2, the PM maintains a traceability file per subsystem in the docs repo:

```
homesynapse-core-docs/
└── traceability/
    ├── 01-event-model-traceability.md
    ├── 02-device-model-traceability.md
    └── ...
```

Each file maps: Design Doc Section → Interface/Type in Code → Test Class. If any column is empty, something is missing. This is the master consistency check.

---

## 5. What Changes from Original Plan

The transition guide (already locked) defines the scaffold. This proposal adds:

| Addition | Rationale |
|---|---|
| `schema/` top-level directory | Config JSON Schemas and API specs deserve a discoverable home, not buried in module resources |
| `spike/` directory | Phase guide mandates spike code lives outside production tree |
| `core/test-support/` module | TDD requires shared test infrastructure from day one |
| Traceability matrix in docs repo | The enforcement mechanism for design-to-code consistency |
| ArchUnit tests for import rules | Compile-time module enforcement is necessary but not sufficient; ArchUnit catches intra-module violations |
| Explicit test category ordering | Contract → Edge Case → Integration → Performance prevents "test the implementation" anti-pattern |
| WAL spike as Phase 3.0 | Transition guide already specifies this; making it explicit in sequencing |

---

## 6. What I Want Your Decision On

Before I produce task briefs from this proposal:

**A. schema/ directory location.** I placed it at the repo root for discoverability. Alternative: each module keeps its schemas in `src/main/resources/schema/`. Tradeoff: root is easier to find; per-module keeps schemas with their code. My recommendation: root, because the OpenAPI and AsyncAPI specs span multiple modules.

**B. module-info.java in Phase 2 vs Phase 3.** JPMS modules add compile-time package visibility enforcement but also add complexity. Option 1: define module-info.java during Phase 2 (strictest enforcement from the start). Option 2: defer to Phase 3 (simpler Phase 2, add JPMS when there's actual code to restrict). My recommendation: Phase 2, because catching package visibility errors early is worth the modest overhead.

**C. Test-support module scope.** I proposed a single shared `core/test-support` module. Alternative: each module has its own test fixtures. Tradeoff: shared module avoids duplication but creates a dependency; per-module keeps things isolated. My recommendation: shared module, because many test fixtures (EventEnvelope builders, test Device factories) are needed across almost all subsystem tests.

**D. Traceability matrix granularity.** Option 1: per-subsystem file mapping sections to interfaces. Option 2: single consolidated matrix. Option 3: automated (generate from `@see` tags). My recommendation: option 1 during Phase 2 (manual, per-subsystem), with a plan to automate via `@see` tag extraction in Phase 3 when there's enough code to make automation worthwhile.

**E. Reference artifacts timing.** PROJECT_STATUS lists three reference artifacts (event-type-registry, subscriber-registry, configuration-schema-registry) as "can begin now." These directly feed Phase 2 work — the event-type-registry informs the DomainEvent sealed interface hierarchy, the subscriber-registry informs EventBus contracts, and the configuration-schema-registry feeds JSON Schema generation. My recommendation: produce these before or alongside Wave 1 of Phase 2. They are compilation exercises from already-locked design docs and will accelerate interface specification significantly.

---

## 7. Summary: The Complete Sequence

```
NOW
 │
 ├── [Phase 2 Prep] Produce reference artifacts (event-type, subscriber, config registries)
 ├── [Phase 2 Prep] Project scaffold setup (transition guide §8)
 │
 ├── [Phase 2 Wave 1] platform-api + event-model interfaces
 ├── [Phase 2 Wave 2] device-model + integration-api + configuration interfaces
 ├── [Phase 2 Wave 3] state-store + automation + persistence interfaces
 ├── [Phase 2 Wave 4] event-bus + integration-runtime + rest-api + websocket-api + observability
 ├── [Phase 2 Wave 5] integration-zigbee + lifecycle + homesynapse-app
 ├── [Phase 2 Parallel] JSON Schemas, OpenAPI, AsyncAPI
 │
 ├── [Phase 2→3 Gate] All interfaces compile. Cross-subsystem consistency verified.
 │
 ├── [Phase 3.0] SQLite WAL validation spike
 ├── [Phase 3.1] Foundation: platform + event backbone + persistence (tests first, then impl)
 ├── [Phase 3.2] Core domain: device-model + state-store + configuration
 ├── [Phase 3.3] Derived: automation + integration-runtime
 ├── [Phase 3.4] External: REST + WebSocket + observability
 ├── [Phase 3.5] Integration: zigbee + lifecycle + app + dashboard
 ├── [Phase 3.6] End-to-end: 50 devices, 72h stable, memory validation
 │
DONE — Tier 1 MVP
```

---

This is the complete proposal. What's your read?
