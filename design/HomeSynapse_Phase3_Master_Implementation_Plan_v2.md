# HomeSynapse Core — Phase 3 Master Implementation Plan v2

**Date:** 2026-04-03
**Status:** Draft — for Nick's review and iteration
**Supersedes:** Phase 3 Master Implementation Plan v1 (same date, pre-review)
**Scope:** All production implementation work from current state to v1.0
**Author:** PM Agent, with full context review of all 14 design docs, governance files, research docs, and nexsys-hivemind context layer

---

## 1. Philosophy

Four principles govern this plan:

**Contract tests define correctness.** For every major interface, we write an abstract contract test suite that specifies what "correct" means — independent of any implementation. Then every implementation (in-memory for fast tests, SQLite for production) must pass the same suite. The EventStoreContractTest (27 methods, passing) is the model for the entire project.

**Test infrastructure before production code.** Before implementing any module, we first build the test fixtures that downstream modules need. This means in-memory implementations, factory/builder utilities, and contract test suites. Without this discipline, we'll write production code that can't be properly tested, or we'll couple tests to implementation details.

**Each session produces a shippable increment.** Every working session has one clear objective, binary success criteria (`./gradlew :module:check` passes), and leaves the build green. No session depends on uncommitted work from a prior session.

**Documentation is a continuous deliverable, not a phase.** Design docs, MODULE_CONTEXT.md files, traceability indexes, and handoff notes evolve as implementation reveals reality. Every third milestone includes a dedicated documentation checkpoint. Implementation without documentation creates technical debt that compounds silently.

---

## 2. What Exists Today

### 2.1 Codebase State (as of 2026-04-03)

**Repository:** homesynapse-core — 19-module Gradle scaffold, full CI/build infrastructure
**Compile status:** `./gradlew compileJava` GREEN (verified March 20)
**Total Java files:** ~420 main + ~111 test + ~18 fixtures

| Layer | Modules | Phase 2 Status |
|-------|---------|---------------|
| Platform | platform-api (15 files), platform-systemd (1 file) | Complete |
| Core | event-model (48), device-model (59), event-bus (6), automation (55), persistence (12), state-store (8) | Complete |
| Integration | integration-api (22), integration-runtime (6), integration-zigbee (39) | Complete |
| Config | configuration (24) | Complete |
| API | rest-api (28), websocket-api (26) | Complete |
| Observability | observability (20) | Complete |
| Lifecycle | lifecycle (8) | Complete |
| App | homesynapse-app (4) | Complete |
| Testing | test-support (11) | Partial (implementations exist, not formally specified) |

### 2.2 Implemented and Passing

| Artifact | Location | Status |
|----------|----------|--------|
| `Ulid`, `UlidFactory`, 8 typed ID wrappers | platform-api | `UlidTest` + `TypedIdTest` passing |
| `InMemoryEventStore` | event-model testFixtures | 27/27 `EventStoreContractTest` methods passing |
| `TestEventFactory` | event-model testFixtures | Passing |
| `TestCausalContext` | event-model testFixtures | Passing |
| `TestClock` | test-support | Passing |
| `SynchronousEventBus` | test-support | Passing |
| `NoRealIoExtension` + `@RealIo` | test-support | Passing |
| `GivenWhenThen` DSL | test-support | Passing |
| Custom AssertJ assertions | test-support | `EventEnvelopeAssert`, `CausalContextAssert`, `SubjectRefAssert` passing |
| 7 ArchUnit rules | homesynapse-app test | Dependency direction, Clock injection, no synchronized, etc. |
| WAL spike (C1-C5, V1-V3) | spike/wal-validation | All core criteria pass, V3 executor validated |

### 2.3 Test Fixture Readiness

| Module | testFixtures Status | What Exists |
|--------|-------------------|-------------|
| event-model | **Populated** | InMemoryEventStore, EventStoreContractTest, TestEventFactory, TestCausalContext |
| device-model | Stub only | package-info.java |
| state-store | Stub only | package-info.java |
| persistence | Stub only | package-info.java |
| integration-api | Stub only | package-info.java |
| configuration | Stub only | package-info.java |

### 2.4 Known Debt and Prerequisites

| Item | Source | Severity | Status |
|------|--------|----------|--------|
| Pre-Phase 3 Context Audit: 7 CRITICAL findings (C-01 through C-04+) | Pre_Phase3_Context_Audit_Report_v1.md | CRITICAL | Must fix before Phase 3 coding begins |
| 10 traceability index stubs (docs 02-11) | PROJECT_SNAPSHOT.md | MEDIUM | Non-blocking but should be addressed |
| Doc 12 Cross-Audit: 1 CRITICAL + 6 SIGNIFICANT findings | Doc_12_Cross_Audit_Report.md | HIGH | Must fix before lifecycle implementation |
| Automation Engine: 18 failure scenarios / 16 corrections | AUTOMATION_ENGINE_CRITICAL_REVIEW.md | HIGH | Must address before automation tests |
| Doc 05 §3.14 planned restart event path | Master Plan v1 §4 | MEDIUM | Must amend before Wave 5 |
| Virtual Thread Risk Audit: platform thread executor pattern | Virtual_Thread_Risk_Audit_Report.md | CRITICAL | Already addressed via AMD-26/27; implementation in Wave 1 |

---

## 3. Structural Changes from v1

This plan differs from v1 in five significant ways:

**3.1 — Milestones replace sessions.** v1 estimated ~76-106 sessions and projected calendar time. This plan defines milestones with entry/exit criteria but no session counts or calendar estimates. Work takes as long as it takes. Some milestones will complete in one session; others will take several. The constraint is quality, not velocity.

**3.2 — Documentation checkpoints are explicit.** After every two to three implementation milestones, a documentation checkpoint occurs. This is where design docs get amended, MODULE_CONTEXT.md files get updated, traceability indexes get populated, and lessons get recorded. This isn't overhead — it's how the project maintains the context layer that makes each subsequent milestone faster.

**3.3 — Prerequisites are a formal milestone.** v1 assumed the context audit findings and documentation debt would be handled informally. This plan makes them Milestone 0 with explicit exit criteria.

**3.4 — Cross-cutting concerns have dedicated threads.** Jackson serialization, CausalContext propagation, ArchUnit rule expansion, and error handling patterns are not afterthoughts — they're woven into the milestones where they first become relevant, with explicit verification at each documentation checkpoint.

**3.5 — Hardware validation is staged.** Pi 5 validation happens at Milestone gates. Pi 4 validation (the performance floor) happens during system validation. This avoids the risk of building on assumptions that fail on real hardware.

---

## 4. Milestone Map

### Overview

| Milestone | Focus | Entry Gate | Exit Gate |
|-----------|-------|------------|-----------|
| **M0** | Prerequisites & cleanup | Plan approved | All CRITICAL audit findings fixed; build green |
| **M1** | Test infrastructure completion | M0 complete | All contract test suites + in-memory impls passing |
| **M2** | Persistence layer (SQLite) | M1 complete | SqliteEventStore passes all 27 EventStoreContractTest methods on real SQLite |
| **DC-1** | Documentation checkpoint | M2 complete | Design docs amended; MODULE_CONTEXT updated; lessons recorded |
| **M3** | Event distribution + state materialization | DC-1 complete | Full event pipeline: publish -> persist -> notify -> pull -> project state |
| **M4** | Configuration + device model services | M3 complete | YAML config loading; device/entity registry operations |
| **DC-2** | Documentation checkpoint | M4 complete | Cross-subsystem contracts verified; traceability populated |
| **M5** | Automation engine | DC-2 complete | Trigger -> condition -> action pipeline executing end-to-end |
| **M6** | Integration layer | M5 complete | IntegrationSupervisor managing adapter lifecycle |
| **DC-3** | Documentation checkpoint | M6 complete | Full system design review; all 14 docs current |
| **M7** | API layer | DC-3 complete | REST command endpoints + WebSocket event streaming |
| **M8** | System assembly | M7 complete | 10-phase startup, health aggregation, graceful shutdown |
| **DC-4** | Documentation checkpoint + Pi validation | M8 complete | All docs current; Pi 5 full system validation |
| **M9** | Dashboard | DC-4 complete | Preact SPA rendering entity state via WebSocket |
| **M10** | System validation & hardening | M9 complete | 72-hour stability test; performance targets met on Pi 5 |
| **DC-5** | Final documentation pass | M10 complete | All traceability complete; all docs at final quality |

---

## 5. Milestone Details

### M0 — Prerequisites & Cleanup

**Goal:** Resolve all known debt and audit findings that would undermine Phase 3 work. Establish a clean foundation.

**Entry gate:** This plan approved by Nick.

**Work items:**

**M0.1: Pre-Phase 3 Context Audit Fixes**
- Fix C-01: homesynapse-mental-model.md incorrect virtual thread safety claim for sqlite-jdbc
- Fix C-02: Events table schema missing `actor_ref BLOB(16)` and `event_category TEXT NOT NULL`
- Fix C-03: device-model MODULE_CONTEXT.md incorrect `requires transitive` claim
- Fix C-04: persistence MODULE_CONTEXT.md incorrect `api(project(...))` scope claim
- Fix remaining HIGH and MEDIUM findings from audit report

**M0.2: Doc 12 Cross-Audit Fixes**
- Fix F12-01 (CRITICAL): Checkpoint field reference `globalPosition` → `view_position`
- Fix F12-02 through F12-07: Section references, missing PRAGMA, Config System timing
- Update 10 upstream documents with Doc 12 Dependents field references

**M0.3: Automation Engine Critical Review Integration**
- Review all 18 failure scenarios from AUTOMATION_ENGINE_CRITICAL_REVIEW.md
- Determine which of the 16 architectural corrections require design doc amendments vs. implementation-level fixes
- File amendments for any corrections that change behavioral contracts
- Document implementation-level fixes as Phase 3 notes in automation MODULE_CONTEXT.md

**M0.4: Traceability Index Population**
- Populate stub traceability indexes for docs 02-11 (currently stubs)
- This is bookkeeping but prevents the debt from compounding further

**M0.5: V3 JFR Pinning Validation on Pi 5**
- Run `./gradlew runV3Jfr` on Pi 5
- Confirm zero pinning events
- Record in spike results document

**Exit gate:** All CRITICAL and HIGH findings resolved. `./gradlew compileJava` GREEN. All MODULE_CONTEXT.md files for existing modules verified accurate against actual source.

---

### M1 — Test Infrastructure Completion

**Goal:** Build the contract test suites and in-memory implementations that every subsequent milestone depends on. This is the foundation investment that makes everything after it faster and more reliable.

**Entry gate:** M0 complete (clean foundation).

**Principle:** Each contract test suite lives in the module's `testFixtures` source set. Each in-memory implementation lives alongside it. Downstream modules depend on `testFixtures(project(':module'))` to access these.

**M1.1: CheckpointStore Contract Test + InMemoryCheckpointStore**
- Module: event-bus testFixtures
- Produces: `CheckpointStoreContractTest` (abstract, 8-12 methods), `InMemoryCheckpointStore`
- Covers: save, load, load-unknown-returns-empty, delete, list-all, exact-value, concurrent-safety
- Success: `./gradlew :core:event-bus:check` passes
- Why first: Persistence needs this contract for SqliteCheckpointStore. EventBus needs it for subscriber management.

**M1.2: ViewCheckpointStore Contract Test + InMemoryViewCheckpointStore**
- Module: state-store testFixtures
- Produces: `ViewCheckpointStoreContractTest` (abstract), `InMemoryViewCheckpointStore`
- Same shape as CheckpointStore but with `byte[]` data instead of `long` positions
- Success: `./gradlew :core:state-store:check` passes

**M1.3: Device Model Test Factories**
- Module: device-model testFixtures
- Produces: `TestDeviceFactory`, `TestEntityFactory`, `TestCapabilityFactory`
- Builder pattern with sensible defaults for common device/entity/capability scenarios
- Success: `./gradlew :core:device-model:check` passes

**M1.4: StateQuery Contract Test + InMemoryStateStore**
- Module: state-store testFixtures
- Produces: `StateQueryContractTest` (abstract, 12-18 methods), `InMemoryStateStore`
- Covers: get entity state, getStatesAtPosition (AMD-03 ConsistentSnapshot), list by area/integration, entity-not-found, availability tracking, stale state (AMD-11)
- Success: `./gradlew :core:state-store:check` passes

**M1.5: Configuration Test Fixtures**
- Module: configuration testFixtures
- Produces: `InMemoryConfigStore`, `TestConfigFactory`
- In-memory config with reload support and ConfigurationChangeListener firing
- Success: `./gradlew :config:configuration:check` passes

**M1.6: Integration API Test Fixtures**
- Module: integration-api testFixtures
- Produces: `StubIntegrationContext`, `TestAdapter`, `StubCommandHandler`
- TestAdapter: records method calls, simulates configurable behavior (healthy, failing, slow)
- Success: `./gradlew :integration:integration-api:check` passes

**M1.7: EventBus Contract Test**
- Module: event-bus testFixtures
- Produces: `EventBusContractTest` (abstract, 15-20 methods)
- Covers: register subscriber, notification-triggers-pull, checkpoint persistence, REPLAY->LIVE transition (AMD-02), subscription filters, coalesceExempt, unregistration, LockSupport.unpark() notification, concurrent registration safety
- Note: SynchronousEventBus in test-support should pass this contract for single-threaded use
- Success: `./gradlew :core:event-bus:check` passes

**M1.8: WriteCoordinator Contract Test**
- Module: persistence testFixtures
- Produces: `WriteCoordinatorContractTest` (abstract, 10-15 methods)
- Covers: submit at each priority level, priority ordering, event-publish never starved, burst behavior (P4-5 paused during high event rate), write serialization, failure isolation, shutdown drain
- Success: `./gradlew :core:persistence:check` passes

**M1.9: Telemetry Test Fixtures**
- Module: persistence testFixtures
- Produces: `InMemoryTelemetryStore`, `TelemetryWriterContractTest` (abstract)
- Covers: ring buffer behavior, retention tier lifecycle, sample ingestion
- Success: `./gradlew :core:persistence:check` passes

**M1.10: Platform-API Development Implementations**
- Module: platform-api (production code, but trivial)
- Produces: `LocalPaths` (dev-tier PlatformPaths), `NoOpHealthReporter`, unit tests
- Success: `./gradlew :platform:platform-api:check` passes
- Why here: Lifecycle and persistence need PlatformPaths for database file locations.

**Exit gate:** ALL contract test suites passing with in-memory implementations. `./gradlew check` GREEN across all modules. Every testFixtures source set populated with meaningful content (no more stubs).

---

### M2 — Persistence Layer

**Goal:** Implement the SQLite persistence layer. The single most important production infrastructure — everything depends on durable event storage.

**Entry gate:** M1 complete (all contract tests defined, all in-memory implementations passing).

**Critical constraint:** ALL sqlite-jdbc operations route through platform thread executors (AMD-26/AMD-27/LTD-03). Virtual threads submit work via `CompletableFuture.supplyAsync(dbCall, executor)`. Write executor: 1 thread. Read executor: 2-3 threads.

**M2.1: Connection Management + PRAGMA Configuration**
- Produces: `SqliteConnectionProvider`, `PlatformThreadExecutors`
- Applies all 8 LTD-03 PRAGMAs in correct order
- Creation-time PRAGMAs (`auto_vacuum = INCREMENTAL`, `page_size = 4096`)
- Success: Tests verify PRAGMAs set correctly on real SQLite

**M2.2: Schema Initialization + Migration Runner**
- Produces: `SchemaManager`, migration runner
- Creates events table, subscriber_checkpoints table, indexes per Doc 04 §4.1
- Version-tracked migrations with atomic transactions
- Success: Fresh SQLite database has correct schema

**M2.3: SqliteEventPublisher — Write Path**
- Produces: `SqliteEventPublisher` implementing `EventPublisher.publish()` and `publishRoot()`
- Writes via write executor (platform thread)
- EventId generation, IngestTime via Clock, SubjectSequence assignment, GlobalPosition from rowid
- SequenceConflictException on duplicate (subject_ref, subject_sequence)
- Success: Write-side subset of EventStoreContractTest passes

**M2.4: SqliteEventStore — Core Read Methods**
- Produces: `SqliteEventStore` implementing `readFrom()` and `readBySubject()`
- Reads via read executor pool
- EventPage construction with cursor-based pagination
- Success: Combined with M2.3, majority of EventStoreContractTest passes

**M2.5: SqliteEventStore — Extended Read Methods**
- Produces: `readByType()`, `readByTimeRange()`, `readByCorrelation()`, `latestPosition()`
- All parameter validation (nulls, negative positions, inverted time ranges)
- **Success: All 27 EventStoreContractTest methods pass against real SQLite. This is the M2 EXIT GATE.**

**M2.6: WriteCoordinator Implementation**
- Produces: `WriteCoordinator` implementing AMD-06 priority serialization
- 5 priority levels, burst detection, P4-5 suspension
- Success: Passes `WriteCoordinatorContractTest`

**M2.7: SqliteCheckpointStore + SqliteViewCheckpointStore**
- Produces: Both checkpoint store implementations
- Read/write through appropriate executors
- Success: Both pass their respective contract tests (alongside InMemory implementations)

**M2.8: Telemetry Database + TelemetryWriter**
- Produces: Telemetry database schema (separate from main), `TelemetryWriter`
- Ring buffer per RetentionTier, sample ingestion, cleanup
- Success: Passes `TelemetryWriterContractTest`

**M2.9: MaintenanceService**
- Produces: WAL checkpoint scheduling, telemetry cleanup scheduling
- `PRAGMA wal_checkpoint(PASSIVE)` via WriteCoordinator at priority 3
- Integrity check support (`PRAGMA quick_check`)
- Success: Integration test: write events -> trigger checkpoint -> verify WAL shrinks

**M2.10: Persistence Integration Tests**
- Produces: `SqliteEventStoreIntegrationTest` (concurrent write+read under VTs through executor)
- `PersistenceLifecycleTest` (schema init -> write -> shutdown -> restart -> read -> verify)
- `WriteCoordinatorIntegrationTest` (event publish under concurrent pressure)
- Success: All integration tests pass within 60-second budget

**M2.11: Jackson Serialization Foundation**
- Produces: Jackson `@JsonCreator`/`@JsonValue` for all typed ID wrappers (EntityId, DeviceId, etc.)
- EventEnvelope serialization with `PropertyNamingStrategies.SNAKE_CASE`
- Round-trip serialization tests for every typed ID and EventEnvelope
- Success: Serialize -> deserialize -> equals for all event-related types

**Exit gate:** All 27 EventStoreContractTest methods pass on real SQLite. WriteCoordinator, CheckpointStores, TelemetryWriter all passing their contracts. Jackson serialization foundation established. `./gradlew check` GREEN.

---

### DC-1 — Documentation Checkpoint 1

**Goal:** Update all documentation artifacts to reflect what we learned during M1 and M2 implementation.

**Work items:**
- Amend design docs if implementation revealed any behavioral gaps
- Update MODULE_CONTEXT.md for: event-model, event-bus, persistence, state-store, platform-api
- Populate traceability indexes for docs 01 (event model) and 04 (persistence)
- Record lessons learned (coder-lessons.md, pm-lessons.md)
- Update PROJECT_SNAPSHOT.md
- Verify all existing ArchUnit rules still pass (no regressions from new code)
- Review: Do any AMDs (18-24) need to be applied now based on implementation experience?

**Exit gate:** All MODULE_CONTEXT.md files for implemented modules are accurate. Traceability indexes for docs 01 and 04 populated. Lessons recorded.

---

### M3 — Event Distribution + State Materialization

**Goal:** Events flow through the full pipeline: publish -> persist -> notify subscriber -> subscriber pulls from store -> projects state.

**Entry gate:** DC-1 complete.

**M3.1: InProcessEventBus — Core Implementation**
- Produces: `InProcessEventBus` implementing `EventBus`
- Subscriber registration with `SubscriptionFilter`
- Notification via `LockSupport.unpark()` (bus never pushes events)
- Subscriber pulls from EventStore using checkpoint position
- Virtual thread per subscriber
- Success: Passes `EventBusContractTest`

**M3.2: InProcessEventBus — REPLAY -> LIVE Transition**
- Produces: REPLAY mode (process from checkpoint to head), LIVE mode (new events), transition logic
- AMD-02 reconciliation pass: re-read events published during replay window
- Success: Integration test: 1000 events -> start subscriber -> replays all -> transitions to LIVE -> new event received

**M3.3: InProcessEventBus — Backpressure + Coalescing**
- Produces: Subscriber-local backpressure, DIAGNOSTIC event coalescing
- `coalesceExempt` flag: State Projection and Pending Command Ledger must see every event
- Success: Backpressure tests pass; coalesceExempt subscriber receives all events

**M3.4: Event Bus Integration Tests**
- Produces: Tests with real SqliteEventPublisher -> InProcessEventBus -> subscriber
- Multi-subscriber concurrent processing
- Subscriber crash -> restart -> replay from checkpoint
- Checkpoint persistence across bus restart

**M3.5: StateProjection — Core Implementation**
- Produces: `StateProjectionSubscriber` (coalesceExempt=true)
- Processes state_reported, entity_created, entity_removed events
- Builds EntityState records from event stream
- Validates attributes against capability schemas (invalid -> state_report_rejected, no state change)
- state_changed produced only on value difference (redundant reports suppressed)
- Success: Given sequence of events -> verify correct EntityState

**M3.6: StateQueryService Implementation**
- Produces: Implementation of `StateQueryService`
- `getEntityState()`, `getStatesAtPosition()` (AMD-03 ConsistentSnapshot)
- `listEntitiesByArea()`, `listEntitiesByIntegration()`
- Availability tracking, stale state detection (AMD-11)
- Success: Passes `StateQueryContractTest`

**M3.7: State Store Integration Tests**
- Produces: Full pipeline test: publish events -> EventBus notifies -> StateProjection processes -> StateQueryService returns correct state
- Projection versioning (AMD-10): version mismatch triggers full rebuild
- Stale state TTL (AMD-11): state marked stale after configured TTL
- Success: End-to-end pipeline test passes

**Exit gate:** Full event pipeline working end-to-end. Events published -> persisted -> subscribers notified -> pulled -> state materialized -> queryable. `./gradlew check` GREEN.

---

### M4 — Configuration + Device Model Services

**Goal:** Build the two independent subsystems that the automation engine depends on.

**Entry gate:** M3 complete.

**Note:** Configuration and Device Model are independent of each other — both depend on event-model and platform-api. They CAN be built in parallel within a milestone if session structure allows, but there is no requirement to do so.

#### Configuration (M4.1-M4.4)

**M4.1: YAML Loader**
- SnakeYAML Engine 2.9 (YAML 1.2 — no 1.1 type coercion bugs per LTD-09)
- Load from `PlatformPaths.configDir()/homesynapse.yaml`
- ConfigModel construction, error reporting with line numbers
- AMD-20 (YAML Parser Safety): apply here

**M4.2: JSON Schema Validator**
- json-schema-validator integration
- Validate against embedded schema
- ConfigurationValidationException on violations
- Unit tests with valid/invalid configs

**M4.3: Secrets Management**
- AES-256-GCM encrypted secrets file
- `!secret` reference resolution in YAML
- Secrets backup rotation (AMD-16)
- Key derivation and storage

**M4.4: Hot Reload + Listener Notification**
- `ConfigurationService.reload()` implementation
- `ConfigurationChangeListener` synchronous notification
- `config_changed` event publication
- Configuration migration framework (AMD-13)
- AMD-24 (Config Reload Atomicity): apply here
- Success: Passes `ConfigurationServiceContractTest`

#### Device Model (M4.5-M4.8)

**M4.5: DeviceRegistry Implementation**
- Device CRUD operations
- HardwareIdentifier matching for adoption (idempotency)
- Device-Entity parent-child relationship management
- Success: Passes `DeviceRegistryContractTest`

**M4.6: EntityRegistry Implementation**
- Entity CRUD, area assignment
- Entity transfer between devices (event production)
- Orphan lifecycle on integration removal (AMD-17)

**M4.7: Capability Validation**
- `CommandValidator` implementation
- Capability-based command validation
- `AttributeValue` validation against Capability constraints
- Tolerance bands owned by capabilities (not automations)

**M4.8: Discovery Pipeline**
- `DiscoveryPipeline` implementation
- New device discovery -> entity creation -> capability registration
- Integration test: simulated discovery event -> entities created

**Exit gate:** Configuration loads from YAML, validates against schema, resolves secrets, supports hot reload with listener notification. Device/entity CRUD operations working, discovery pipeline creating entities from simulated discovery events. `./gradlew check` GREEN.

---

### DC-2 — Documentation Checkpoint 2

**Goal:** Comprehensive cross-subsystem contract verification. We've now built the core domain — events, persistence, state, configuration, device model. This is the right moment to verify everything is coherent.

**Work items:**
- Update MODULE_CONTEXT.md for: event-bus, state-store, configuration, device-model
- Populate traceability indexes for docs 02 (device model), 03 (state store), 06 (configuration)
- Cross-subsystem contract audit: verify that interfaces consumed by automation engine match what we've built
- Review Automation Engine Critical Review findings — confirm which corrections are implementation-level vs. contract-level
- Amend Doc 05 §3.14 planned restart event path (must happen before M6 integration layer)
- Record lessons learned
- Update PROJECT_SNAPSHOT.md
- Verify: Are any AMDs (18-24) now clearly needed based on implementation?
- Review ArchUnit rules: should new rules be added based on patterns discovered?

**Exit gate:** All MODULE_CONTEXT.md current. Cross-subsystem contracts verified. Automation engine preconditions documented. Doc 05 §3.14 amended. `./gradlew check` GREEN.

---

### M5 — Automation Engine

**Goal:** The most complex domain module. Build the trigger-condition-action pipeline with full replay safety, cascade limiting, and conflict detection.

**Entry gate:** DC-2 complete. Automation engine critical review corrections documented. All upstream contracts verified.

**Pre-implementation requirement:** Before writing any automation tests, the 16 architectural corrections from the AUTOMATION_ENGINE_CRITICAL_REVIEW.md must be categorized as:
- **Contract-level** (requires design doc amendment) — apply amendment first
- **Implementation-level** (handled in test design + implementation) — document in coding instructions

**M5.1: Trigger Evaluation — Event Triggers**
- `TriggerEvaluator` for `EventTrigger`
- Match incoming events against trigger definitions
- No `forDuration` on EventTrigger (instantaneous by design)

**M5.2: Trigger Evaluation — State Triggers + Duration Timers**
- `StateTrigger`, `StateChangeTrigger`, `NumericThresholdTrigger`, `AvailabilityTrigger`
- `forDuration` support (AMD-25): DurationTimer management
- Timer virtual thread lifecycle (sleep -> expire -> fire, or cancel via interrupt)
- REPLAY suppression: no timers created during REPLAY mode
- Timer reconstruction on REPLAY->LIVE transition with remaining duration

**M5.3: Condition Evaluation**
- `ConditionEvaluator` implementation
- Evaluate against positional state snapshots (AMD-03: `getStatesAtPosition()` + `ConsistentSnapshot`)
- All condition types: `StateCondition`, `TimeCondition`, `CompoundCondition`
- **Critical:** Atomic multi-entity snapshot evaluation — conditions reading multiple entities use the same snapshot position

**M5.4: Action Execution**
- `ActionExecutor` implementation
- Selector resolution: `DirectRefSelector`, `LabelSelector`, `AreaSelector`, `CompoundSelector` (intersection semantics)
- Deferred resolution (resolved at action time, not definition time)
- Eligibility checks per target
- Command dispatch via `EventPublisher.publish()` (produces `command_issued` events)
- **Deterministic ordering:** Commands issued in deterministic order by entity ULID within a Run

**M5.5: RunManager — Orchestration**
- `RunManager.initiateRun()` — trigger -> condition -> action pipeline
- RunContext with cascade depth (AMD-04, max depth 8)
- Duplicate suppression per correlation_id
- Run lifecycle events: `automation_run_started`, `automation_run_completed`, `automation_run_failed`
- Concurrency mode enforcement: SINGLE/RESTART/QUEUED/PARALLEL
- ProcessingMode awareness: REPLAY mode evaluates but does NOT issue commands or produce run events

**M5.6: PendingCommandLedger**
- Subscriber (coalesceExempt=true)
- Tracks commands awaiting confirmation
- Evaluates `Expectation` against `state_reported` events
- Produces `state_confirmed` or `command_confirmation_timed_out`
- Idempotency recovery on restart: IDEMPOTENT re-issue, NOT_IDEMPOTENT expire

**M5.7: ConflictDetector**
- Post-execution conflict detection
- Scans Runs triggered by same event
- Identifies contradictory commands
- Conflict event production

**M5.8: Automation Definition CRUD**
- Create/update/delete automation definitions
- Definition validation (trigger/condition/action type compatibility)
- Enable/disable automations
- Definition versioning

**M5.9-M5.10: Automation Integration Tests**
- Full pipeline: device event -> trigger fires -> condition evaluates -> command dispatched -> state confirmed
- Cascade depth limiting (AMD-04): verify max depth 8 enforced
- Duration timer: state sustained for duration -> trigger fires
- Conflict detection: contradictory commands on same event
- Deterministic execution (INV-TO-02): same event sequence -> same outcomes
- REPLAY suppression: replay events -> verify no new commands issued
- Multi-entity condition evaluation: verify atomic snapshot usage

**Exit gate:** Complete automation pipeline working end-to-end with replay safety, cascade limits, conflict detection, and duration timer support. `./gradlew check` GREEN.

---

### M6 — Integration Layer

**Goal:** Build the OTP-style supervision tree and validate it against the Zigbee adapter.

**Entry gate:** M5 complete.

**M6.1-M6.2: IntegrationSupervisor Core**
- OTP-style one-for-one supervisor
- Adapter lifecycle: start/stop/restart with configurable backoff
- `ExceptionClassification` (TRANSIENT/PERMANENT/SHUTDOWN_SIGNAL) driving retry
- AMD-23 (Integration Hot-Swap): apply here if approved

**M6.3: Health Monitoring + SlidingWindow**
- `IntegrationHealthRecord` construction
- Weighted health score calculation
- SlidingWindow for error rate tracking
- Planned restart support

**M6.4: Startup Ordering (Kahn's Algorithm)**
- `IntegrationDescriptor.dependencies()` ordering
- Kahn's topological sort with cycle detection (AMD-14)

**M6.5-M6.6: Zigbee CoordinatorTransport + Protocol**
- `CoordinatorTransport` (NOT thread-safe) on dedicated platform thread (IoType.SERIAL)
- `CoordinatorProtocol` thread-safe wrapper
- ZigbeeFrame sealed hierarchy parsing

**M6.7-M6.8: Zigbee Device Discovery + Cluster Support**
- Device interview with 3 retries + exponential backoff
- Entity creation through discovery pipeline
- Common cluster implementations (OnOff, Level, Temperature, Humidity)
- ManufacturerCodec hierarchy for quirks

**M6.9: Zigbee Route Health + Mesh Management**
- Route health monitoring (AMD-07)
- Dead route detection, repair/rejoin

**M6.10: Integration Integration Tests**
- Supervisor manages lifecycle across failure/restart
- Zigbee adapter discovers simulated device -> creates entities -> reports state
- **Crash isolation test:** throw RuntimeException in adapter -> verify core continues (INV-RF-01)
- Command dispatch: REST API -> command event -> adapter -> Zigbee command -> state response

**Exit gate:** IntegrationSupervisor managing Zigbee adapter lifecycle. Crash isolation verified. Device discovery working end-to-end with simulated Zigbee frames. `./gradlew check` GREEN.

---

### DC-3 — Documentation Checkpoint 3

**Goal:** Full system design review. We've now built all core subsystems. The API and system assembly layers come next, but before we build the external interface we should verify that the internal system is coherent.

**Work items:**
- Update MODULE_CONTEXT.md for: automation, integration-api, integration-runtime, integration-zigbee
- Populate traceability indexes for docs 05 (integration), 07 (automation), 08 (zigbee)
- Full cross-subsystem contract audit: are all interfaces consistent between what's implemented and what the API layer expects?
- Review Doc 09 (REST API) and Doc 10 (WebSocket) against actual implementation — do any assumptions need updating?
- Review AMD-18 (Causal Chain Timeout), AMD-19 (Emergency Retention Priority), AMD-22 (Advanced Diagnostics): apply now or defer?
- Record lessons learned
- Update PROJECT_SNAPSHOT.md
- ArchUnit rule review: add new rules based on patterns from M3-M6

**Exit gate:** All implemented module contexts current. API layer preconditions verified. Full system architecture internally consistent. `./gradlew check` GREEN.

---

### M7 — API Layer

**Goal:** Build the external HTTP/WebSocket interface that exposes the event-sourced internals through standard REST semantics.

**Entry gate:** DC-3 complete.

**M7.1-M7.2: REST API Core + Routing**
- Javalin 6.7.0 integration behind `RestApiServer` abstraction
- Route registration for all endpoint planes
- RFC 9457 problem type responses via `ProblemType` enum
- JSON serialization with Jackson SNAKE_CASE
- API key authentication and rate limiting (per-key token bucket)
- AMD-15 (Correlation IDs in all error responses): apply here

**M7.3: Command Lifecycle Endpoints**
- POST /api/v1/commands — command submission
- 4-phase lifecycle: ACCEPTED -> DISPATCHED -> ACKNOWLEDGED -> CONFIRMED/TIMED_OUT
- Idempotency key support (AMD-08)
- CommandStatusResponse polling endpoint

**M7.4: Entity + Device CRUD Endpoints**
- GET/POST/PUT/DELETE for entities and devices
- ETag-based conditional requests (from viewPosition)
- Cursor-based pagination (opaque Base64 cursor)
- Area/integration/capability filtering

**M7.5-M7.6: WebSocket Event Streaming**
- WebSocket at `/ws/v1`
- Subscription with filter (entity/event_type/priority)
- Three-stage backpressure: NORMAL -> BATCHED -> COALESCED
- `WsMessage` sealed hierarchy
- Read-only (commands through REST only)

**M7.7: WebSocket Reconnection + Rate Limiting**
- Reconnection admission control (AMD-09)
- `replay_queued` state for catching up after disconnect
- Per-connection rate limiting

**M7.8: API Integration Tests**
- REST command -> event published -> state changes -> poll for confirmation
- WebSocket connects -> receives live events -> handles backpressure
- Idempotency: duplicate command returns same response
- ETag/304 conditional responses
- Concurrent connections under load

**Exit gate:** REST API serving all 5 endpoint planes. WebSocket streaming events with backpressure. Authentication and rate limiting working. `./gradlew check` GREEN.

---

### M8 — System Assembly

**Goal:** Wire all modules together into a bootable application.

**Entry gate:** M7 complete.

**M8.1-M8.2: Lifecycle — Startup Sequencer**
- `SystemLifecycleManager`: 10-phase sequential startup (BOOTSTRAP through RUNNING)
- Per-subsystem initialization with fatal/non-fatal classification
- Startup grace periods
- Unclean shutdown marker management

**M8.3: Lifecycle — Shutdown Coordinator**
- Reverse-order shutdown within 30-second budget
- WAL checkpoint on shutdown
- Database close, executor shutdown

**M8.4: Health Aggregation**
- `HealthAggregator`: three-tier hierarchical aggregation
- Watchdog loop: `HealthReporter.reportWatchdog()` every 30 seconds
- Flapping prevention (10s minimum dwell for DEGRADED -> HEALTHY)
- `SystemHealthSnapshot` construction

**M8.5: Observability — Trace + Metrics**
- JFR continuous recording with custom event taxonomy (15-25 event types)
- `TraceQueryService`: causal chain assembly, reverse lookup
- `MetricsRegistry`: internal metrics
- RecordingStream bridge for real-time metric consumption

**M8.6: ApplicationAssembler**
- `homesynapse-app` wiring: manual DI, construct all implementations
- No framework (DECIDE-04: no ServiceLoader, no DI container)
- Main entry point

**M8.7: System Integration Tests**
- Full boot: Main.main() -> all phases complete -> RUNNING
- Graceful shutdown within budget
- Health degradation: stop subsystem -> verify DEGRADED
- Unclean shutdown recovery: kill -9 -> restart -> replay from checkpoints

**M8.8: Platform-Systemd**
- `SystemdHealthReporter`: sd_notify via Unix domain socket
- `LinuxSystemPaths`: FHS-compliant directory resolution
- systemd watchdog integration
- Only on Tier 1 (Linux/systemd)

**Exit gate:** Application boots through all 10 phases. Shuts down gracefully within 30 seconds. Health aggregation working. Kill -9 recovery verified. `./gradlew check` GREEN.

---

### DC-4 — Documentation Checkpoint 4 + Pi Validation

**Goal:** All documentation current. First full system validation on Pi 5 hardware.

**Work items:**
- Update MODULE_CONTEXT.md for: rest-api, websocket-api, observability, lifecycle, homesynapse-app
- Populate traceability indexes for docs 09 (REST), 10 (WebSocket), 11 (observability), 12 (lifecycle)
- Pi 5 full system boot test: application starts -> connects simulated devices -> serves API -> WebSocket streaming
- Performance baseline measurement on Pi 5 (event throughput, API latency, memory usage)
- Compare against MVP §8 targets — are we on track?
- Record lessons learned
- Update PROJECT_SNAPSHOT.md
- Full ArchUnit rule audit: all 7 existing rules still pass + identify new rules needed

**Exit gate:** All MODULE_CONTEXT.md current. Pi 5 boots and runs. Performance baseline recorded. Traceability indexes for all docs populated. `./gradlew check` GREEN.

---

### M9 — Dashboard

**Goal:** Preact SPA providing real-time observability into the running system.

**Entry gate:** DC-4 complete.

**Separate build pipeline (Vite, not Gradle).**

**M9.1: Project Setup + Build Pipeline**
- Preact + Vite in `web-ui/dashboard/`
- Development server with hot reload
- Bundle size constraint: < 80 KB gzip total

**M9.2-M9.3: WebSocket Client + State Management**
- WebSocket connection to `/ws/v1`
- Event stream subscription with filter
- Client-side state store from event stream
- Reconnection with replay from global_position

**M9.4-M9.5: Entity + Device Views**
- Entity list with real-time state updates
- Device detail with entity children
- Capability-aware value display
- Area-based grouping

**M9.6-M9.7: Automation + Integration Views**
- Automation list with enable/disable
- Run history with causal chain visualization
- Integration health dashboard

**M9.8: Observability Views**
- System health overview (three-tier display)
- Event stream live view (virtual scrolling)
- Subscriber lag monitoring

**Exit gate:** Dashboard rendering entity state via WebSocket. Health overview working. Event stream browsable. Bundle under 80 KB gzip. Served from /dashboard/ path.

---

### M10 — System Validation & Hardening

**Goal:** Prove the system meets its performance and reliability commitments.

**Entry gate:** M9 complete.

**M10.1: 72-Hour Stability Test**
- 50 simulated Zigbee devices, continuous state reporting
- Automations firing, commands dispatching
- Monitor: memory, event throughput, subscriber lag, API latency
- Success: No crashes, no memory leaks, no degradation over 72 hours

**M10.2: Performance Target Validation (Pi 5)**
- Event publish latency p99 < 10 ms
- Automation trigger-to-action p99 < 50 ms
- Zero event loss on kill -9
- Integration crash isolation (throw in adapter -> core unaffected)
- Replay > 10K events/sec
- State query p99 < 5 ms
- Startup < 30 sec with checkpoint
- Steady-state memory < 512 MB live heap (INV-PR-02)

**M10.3: Pi 4 Validation (Performance Floor)**
- Run full test suite on Pi 4 (4 GB RAM)
- All MVP §8 hard invariants must pass
- Budget goals measured but not blocking

**M10.4: JMH Benchmarks**
- `EventSerializationBenchmark`
- `UlidGenerationBenchmark`
- `InMemoryEventStoreBenchmark`
- `VirtualThreadOverheadBenchmark`
- `CausalContextPropagationBenchmark`
- Run on both Pi 5 and Pi 4

**M10.5: Internet Outage Resilience**
- Disconnect Internet
- Verify: all core functions continue (local-first guarantee)
- Reconnect -> verify no data loss

**M10.6: Security Hardening**
- API key authentication verified
- Secrets encrypted at rest (AES-256-GCM)
- No outbound network calls from core (INV-LF-02)
- systemd sandboxing (ProtectSystem=strict)

**Exit gate:** 72-hour stability test passed. All MVP §8 hard invariants met on Pi 5. Pi 4 validation complete. Internet outage resilience confirmed.

---

### DC-5 — Final Documentation Pass

**Goal:** All documentation at release quality.

**Work items:**
- Final accuracy pass on all 14 design documents
- All MODULE_CONTEXT.md files verified against final implementation
- All traceability indexes complete
- Final PROJECT_SNAPSHOT.md update
- All lessons-learned files reviewed for patterns to document
- Release notes drafted
- Developer setup guide verified (operations/pi5-developer-setup-guide.md)
- ArchUnit rules finalized and documented

**Exit gate:** Documentation ready for public release. All governance artifacts current. Clean repo state.

---

## 6. Cross-Cutting Concern Threads

These concerns are not milestones — they're woven into the milestones where they become relevant.

### 6.1 Jackson Serialization

| When | What |
|------|------|
| M2.11 | Typed ID wrappers + EventEnvelope round-trip tests |
| M3.5 | DomainEvent payload records for state events |
| M4 | Configuration model serialization, automation definition serialization |
| M5 | Automation event payloads (run_started, command_issued, etc.) |
| M6 | Integration event payloads, Zigbee-specific types |
| M7 | REST request/response serialization, WebSocket message serialization |

### 6.2 CausalContext Propagation

| When | What |
|------|------|
| M2 | Verify EventPublisher correctly sets correlation_id and causation_id |
| M3 | Verify derived events (state_changed) inherit correlation from causing event |
| M5 | Verify automation run events chain correctly; cascade depth tracked |
| M6 | Verify integration events carry correct origin and causality |
| M7 | Verify REST API publishRoot() sets self-correlation; API adds AMD-15 correlation headers |

### 6.3 ArchUnit Rule Expansion

| When | What to consider adding |
|------|------------------------|
| DC-1 | Rules for platform thread executor usage (no direct SQLite from VTs) |
| DC-2 | Rules for event type producer boundaries |
| DC-3 | Rules for integration isolation (IntegrationContext-only access) |
| DC-4 | Full audit of all rules; finalize rule set |

### 6.4 ProcessingMode (LIVE vs REPLAY)

| When | What |
|------|------|
| M3.2 | EventBus REPLAY->LIVE transition |
| M3.5 | State Projection handles both modes identically |
| M5.5 | RunManager suppresses actuation during REPLAY |
| M5.2 | Duration timers suppressed during REPLAY; reconstructed on transition |
| M6 | Integration adapters not started during REPLAY phase |

### 6.5 Error Handling Patterns

| When | What |
|------|------|
| M2 | SequenceConflictException, database corruption detection |
| M4.1 | ConfigurationValidationException with line numbers |
| M5 | AutomationEvaluationException, CascadeDepthExceededException |
| M6 | ExceptionClassification (TRANSIENT/PERMANENT/SHUTDOWN_SIGNAL) |
| M7 | RFC 9457 ProblemDetail mapping for all error types |

---

## 7. Dependencies and Gates

```
M0 (Prerequisites)
 |
 M1 (Test Infrastructure)
 |
 M2 (Persistence) ---- EXIT GATE: 27/27 on SQLite
 |
 DC-1 (Docs)
 |
 M3 (Event Bus + State) ---- EXIT GATE: full pipeline
 |
 M4 (Config + Device Model)
 |
 DC-2 (Docs + Contract Audit)
 |
 M5 (Automation) ---- EXIT GATE: trigger->condition->action
 |
 M6 (Integration) ---- EXIT GATE: supervisor + Zigbee
 |
 DC-3 (Docs + Full Review)
 |
 M7 (API) ---- EXIT GATE: REST + WebSocket
 |
 M8 (System Assembly)
 |
 DC-4 (Docs + Pi Validation)
 |
 M9 (Dashboard)
 |
 M10 (System Validation) ---- EXIT GATE: 72h stability, perf targets
 |
 DC-5 (Final Docs)
```

**Parallel work opportunities:**
- M4 Config and Device Model are independent (can interleave within milestone)
- JMH benchmarks can be built any time after M2 (parallel track)
- Dashboard (M9) front-end design can be prototyped during earlier milestones
- Documentation checkpoints are lightweight and can overlap with early milestone work

---

## 8. Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| sqlite-jdbc JNI pinning under production load | Carrier thread starvation on Pi 5 | Platform thread executor pattern (AMD-26/27); validated in WAL spike V3 |
| SQLite behavior differs between dev and Pi | False confidence | Pi 5 validation at DC-4; Pi 4 at M10 |
| Jackson serialization edge cases | Runtime deserialization failures | Round-trip tests for every DomainEvent payload (M2.11 + each subsequent milestone) |
| Automation engine complexity | Sessions exceed scope | 10 sub-milestones, each testing one concern; critical review findings pre-integrated |
| Zigbee hardware unavailable | Can't test real devices | StubAdapter + simulated frames for CI; real hardware is manual validation |
| Documentation drift | Context loss between milestones | Explicit DC checkpoints every 2-3 milestones; MODULE_CONTEXT.md as persistent memory |
| Design doc gaps revealed during implementation | Rework | DC checkpoints include amendment review; corrections applied before moving forward |
| Context audit findings missed | Incorrect implementation | M0 dedicates to clearing all known debt before coding |
| Replay determinism violations in automation | Silent correctness bugs | M5 explicitly tests REPLAY suppression and deterministic execution |
| Memory budget exceeded on Pi 4 | Cannot ship on baseline hardware | M10.3 Pi 4 validation; memory budget tracked from M8 onward |

---

## 9. What This Plan Does NOT Cover

This plan covers Phase 3 (implementation) through system validation. It does NOT cover:

- **Distribution packaging** (jlink images, systemd units, installer) — separate planning after M10
- **Public documentation website** (Docusaurus, homesynapse.com) — parallel workstream
- **Cloud relay / remote access** (Tier 2) — post-v1.0
- **Additional protocol adapters** (Z-Wave, Matter/Thread, MQTT) — post-v1.0
- **Mobile companion app** — post-v1.0

These are tracked in the master release plan (nexsys-hivemind/context/planning/master-release-plan.md) but are out of scope for this document.

---

## 10. Immediate Next Actions

1. **Nick reviews this plan.** Flag anything that feels wrong, missing, or over/under-specified.
2. **Begin M0.** The prerequisite cleanup is the unglamorous but necessary foundation work.
3. **Once M0 is clear, begin M1.1** — CheckpointStore contract test. This is the first test infrastructure that other modules will depend on.

The decision point: approve this plan (with modifications), then we begin.
