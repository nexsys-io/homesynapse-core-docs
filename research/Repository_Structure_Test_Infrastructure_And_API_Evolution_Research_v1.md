# Repository Structure, Test Infrastructure & API Evolution Research v1

**Document type:** Research Artifact
**Date:** 2026-03-10
**Author:** Hivemind
**Status:** Complete — findings applied to Refined Repository Architecture v2

---

## 1. Research Scope

Competitive analysis across 17 open-source projects in three categories:
- **Smart home platforms:** OpenHAB, Home Assistant, Domoticz, ioBroker, Gladys Assistant
- **Event-sourcing/CQRS frameworks:** Axon Framework, Occurrent, Eventuate, Lagom, Marten
- **Java infrastructure projects:** Micronaut, Spring Boot, Quarkus, Helidon

Three focus areas:
1. Repository structure, module organization, dependency enforcement, and build system patterns
2. Test infrastructure: categories, shared fixtures, event-sourcing test patterns, in-memory replacements, architecture enforcement, solo-developer workflow optimization
3. API stability and evolution: binary compatibility tooling, stability annotations, event schema versioning, REST/WebSocket API versioning, embedded-to-cloud scaling patterns

---

## 2. Key Findings

### 2.1 Repository Structure

The foundation module (event types, bus interfaces, shared vocabulary) defines the project's ceiling. Axon's `axon-messaging` has zero framework dependencies. OpenHAB's `org.openhab.core` centralizes shared domain types. Home Assistant's core helpers establish every pattern downstream. HomeSynapse's `event-model` module must have zero HomeSynapse dependencies and be designed with disproportionate care.

The `.internal` package convention with JPMS `module-info.java` enforcement is stronger than any surveyed platform achieves. OpenHAB relies on OSGi (runtime complexity, ClassLoader issues). Home Assistant relies on convention only. Helidon is the only project using JPMS. HomeSynapse's combination provides compile-time enforcement without runtime overhead.

Helidon's `.spi` sub-package convention for extension points distinguishes "API for consumers" from "SPI for implementors." Micronaut supplements with `@Internal` annotations. Adopted for HomeSynapse on 5 modules with clear extension points.

Per-module test fixtures via Gradle's `java-test-fixtures` plugin (Occurrent pattern) are superior to a single grab-bag test-support module. Co-locating in-memory implementations with their API interfaces ensures they stay in sync. Adopted for 6 key modules.

Every successful multi-module project centralizes shared domain types in a single foundation module. Scattering types across modules creates circular dependency problems.

Monorepo is unambiguously correct for fewer than 50 tightly coupled modules (all surveyed core frameworks use monorepo).

Namespace changes after release are catastrophically expensive. OpenHAB's `org.eclipse.smarthome` to `org.openhab.core` migration broke all bundles, all 130+ open pull requests, and required migration scripts for configuration files. Axon's package reorganization between v4 and v5 similarly created painful migrations. `com.homesynapse.*` must be permanent.

The "depends-on-everything" configuration module is a proven anti-pattern. Axon v4's `axon-configuration` module depended on messaging, modelling, and eventsourcing, creating a God Module that made independent module evolution impossible. Axon v5 eliminated it. Spring Boot 4 is modularizing its monolithic `spring-boot-autoconfigure` for the same reason. Only `homesynapse-app` may depend on all modules. The `lifecycle` module is the risk area to watch.

Four layered convention plugins (base, library, test-fixtures, application) eliminate conditional build logic. Validated by Micronaut's precompiled script plugins and Spring Boot's starter pattern.

Occurrent decomposes EventStore into `EventStoreRead`, `EventStoreWrite`, `EventStoreQueries`. Interface segregation validated across all event-sourcing frameworks. Adopted as `EventAppender`, `EventReader`, `EventQuerier`.

Home Assistant's Integration Quality Scale (Bronze/Silver/Gold/Platinum) with `manifest.json` scales to 2,000+ integrations. Adopted as `integration.yaml` manifest per adapter module.

`build-logic/` as included build (not `buildSrc`) avoids full cache invalidation on build logic changes. Validated by Gradle's own recommendations.

### 2.2 Test Infrastructure

In-memory implementations of every persistence abstraction are non-negotiable and must be production-quality (same interface contract as production implementations, thread-safe, supporting `reset()` for test isolation). Validated by Axon (`InMemoryEventStorageEngine`), Occurrent (`eventstore-inmemory`), Eventuate (`eventuate-tram-in-memory`), Home Assistant (full mock `hass` instance). Lagom's `TestTopicComponents` "memoryless" bug demonstrates that partial implementations erode trust in the test suite.

The given/when/then aggregate fixture pattern is the highest-ROI test investment for event-sourced systems. Axon's `AggregateTestFixture` is proven across thousands of production deployments. HomeSynapse needs an adapted version (subscriber/projection fixture) because it does not use Axon-style aggregates. It uses event publishing through EventPublisher with subscriber-based projections.

Three fixture shapes match HomeSynapse's architecture. First, a subscriber/projection fixture: `given(events).whenProcessedBy(subscriber).expectState(assertions)`. Second, a command lifecycle fixture: `given(deviceState).when(commandIssued).expectEvents(...)`. Third, an automation rule fixture: `given(automationDefinition, currentState).whenEvent(triggerEvent).expectActions(...)`. Build the subscriber/projection fixture first; it covers the most modules.

Architecture tests (ArchUnit) should exist before any production code. Projects without automated boundary enforcement develop structural violations that compound silently. `FreezingArchRule` enables incremental adoption.

Global I/O blocking with opt-in exceptions prevents the most insidious class of test bugs. Home Assistant's `pytest-socket` is the gold standard. For Java 21, `SecurityManager` is dead. Enforce via ArchUnit rules on `java.net`/`java.io` imports plus a lightweight JUnit 5 extension overriding `ProxySelector.getDefault()` for runtime partial guard.

Protocol adapter testing should mock at the library/callback boundary, not the wire protocol. OpenHAB mocks `ThingHandlerCallback`, Home Assistant mocks Python client library methods. HomeSynapse mocks at `IntegrationContext`.

Deterministic time control (`java.time.Clock` injection) is the single largest factor in preventing flaky tests. Must be a Phase 2 interface design constraint, not just a Phase 3 test concern. Every interface with time-dependent behavior must accept `Clock` as a constructor parameter. Enforce via ArchUnit rule: no direct `Instant.now()`, `System.currentTimeMillis()`, or `Clock.systemUTC()` outside the assembly module.

Projection testing is the weakest link across the entire event-sourcing industry. Axon has had an open issue since 2018 (GitHub #729). HomeSynapse should build a `ProjectionFixture` early.

Test suites exceeding 2 minutes lead to developers skipping them (OpenHAB's documented experience). Budget: unit tests under 30 seconds, integration tests under 60 seconds across all 19 modules. Any module exceeding 5 seconds signals investigation.

Coverage gates should be tiered by module category: 70% for core domain, 60% for API modules, none for infrastructure/test-support.

Performance benchmarks (JMH) must run on Pi hardware, not GitHub-hosted runners. CI builds the JMH jar; execution is on a self-hosted runner or manual. Do not automate regression detection until at least 10 data points establish a baseline.

Traceability matrices go stale within weeks when maintained manually. Automate via `@see` Javadoc extraction from scaffold setup (approximately 50 lines as a Kotlin Gradle task).

### 2.3 API Stability & Evolution

JUnit 5's `@API` Guardian annotation (`org.apiguardian:apiguardian-api:1.1.2`) provides five stability levels — `INTERNAL`, `DEPRECATED`, `EXPERIMENTAL`, `MAINTAINED`, `STABLE` — with `since` version tracking and `RUNTIME` retention enabling tooling integration. Micronaut's `@Experimental` uses `SOURCE` retention, losing runtime introspection. Recommendation: adopt `@API Guardian`.

`japicmp` (via `me.champeau.gradle.japicmp` plugin v0.4.6) is the industry standard for Java binary compatibility checking. Used by Reactor Netty, gRPC-Java, Apache Groovy, and Gradle itself. Run on API-surface modules only (`platform-api`, `event-model`, `device-model`, `integration-api`). Configure to fail on `STABLE`/`MAINTAINED` API changes, warn on `EXPERIMENTAL`, ignore `INTERNAL`.

Axon v4 to v5 migration demonstrates the value of intermediate releases: Axon 4.13 was a deliberate stepping stone (JDK 17 + Spring Boot 3 upgrade only) before AF5's API rewrite. Plan intermediate releases that decouple infrastructure upgrades from API changes.

Spring Boot's deprecation policy is the gold standard: deprecated code stays for two minor releases minimum. Every `@Deprecated` includes `since` and `forRemoval`.

Event type logical names (`device.added`) rather than Java FQCNs prevent the serialization breakage anti-pattern documented with Axon/XStream. Akka/Pekko persistence documentation explicitly recommends detaching the domain model from the data model via an `EventAdapter` layer. HomeSynapse should store events with logical type names in the envelope, with a type registry mapping names to Java record classes. Upcasters operate on JSON nodes keyed by logical type + version.

### 2.4 Embedded-to-Cloud Scaling

Home Assistant and OpenHAB demonstrate that the same core codebase can serve Raspberry Pi and server deployments when core logic is separated from deployment infrastructure.

SmartThings' original cloud-first architecture forced a costly reversal ("SmartThings Edge"). HomeSynapse's local-first design is correct from the start.

The `EventStore` interface (decomposed into `EventAppender`/`EventReader`/`EventQuerier`) is the single most important abstraction for enabling SQLite-to-PostgreSQL portability. The Python `eventsourcing` library validates this pattern with `AggregateRecorder` abstractions.

For future multi-target deployment: Jib (Docker images without Docker daemon), Shadow plugin (fat JARs), and Badass JLink (minimal custom JRE, 40-70MB) are the three proven Gradle plugins. Separate assembly modules per deployment target are the recommended pattern when non-Pi deployment becomes concrete.

Eclipse Ditto publishes `-model` modules as shared artifacts consumed by both server and client libraries. HomeSynapse should ensure `event-model` and `device-model` are extractable for companion client use.

### 2.5 Anti-Patterns Observed

OSGi integration test infrastructure (OpenHAB): `itest.bndrun` files raised the barrier so high that most developers skip testing entirely. Lesson: keep test infrastructure simple.

No tests at all (Domoticz): 150+ integrations with zero unit tests. Regressions discovered by users in production. Codebase too rigid to refactor.

Dual configuration paradigms (Home Assistant YAML/UI split, ADR-21): most regretted architectural decision. Choose one and commit.

Backward compatibility layers (OpenHAB OH1 to OH2): years of technical debt before finally dropped.

Centralized message decoding (Domoticz `MainWorker`): God Object accumulates debt as protocols are added.

Lagom's `TestTopicComponents` "memoryless" issue: in-memory replacements must faithfully implement the full interface contract, not just the happy path.

Axon/XStream FQCN serialization: renaming or moving event classes broke deserialization. Store logical type names, not class names.

---

## 3. Changes Applied

### Structural changes (incorporated in Refined Repo Architecture v2):
1. `event-model` zero HomeSynapse module dependencies (was: depended on `platform-api`)
2. Four layered convention plugins (was: single `homesynapse.java-conventions`)
3. Per-module test fixtures via `java-test-fixtures` on 6 modules
4. `.spi` sub-package convention on 5 modules with extension points
5. Decomposed event store interfaces (`EventAppender`, `EventReader`, `EventQuerier`)
6. Integration quality tier manifest (`integration.yaml`)
7. Codified `modules-graph-assert` rules (7 explicit dependency rules)
8. `GivenWhenThen` assertion DSL and custom AssertJ assertions in test-support

### Targeted amendments (applied to v2 before lock):
- A-V2-1: Test execution time budgets (unit <30s, integration <60s, per-module 5s investigation threshold)
- A-V2-2: Tiered coverage gates by module category (70% core, 60% API, none infrastructure)
- A-V2-3: `java.time.Clock` injection as ArchUnit-enforced Phase 2 design constraint
- A-V2-4: `@API Guardian` annotations (`org.apiguardian:apiguardian-api:1.1.2`) + japicmp stability-level configuration
- A-V2-5: Event logical type naming constraint for `EventSerializer` (no Java FQCN in stored events)
- A-V2-6: `InMemoryEventStore` contract-completeness requirement (must pass same contract test suite as SQLiteEventStore)
- A-V2-7: `NoRealIoExtension` ArchUnit-based enforcement details (no SecurityManager, no bytecode instrumentation)
- A-V2-8: JMH build-in-CI / run-on-Pi execution strategy (no automated regression until 10+ baseline data points)

---

## 4. Impact on Other Documents

| Document | Impact |
|---|---|
| Refined Repository Architecture v2 | 8 targeted amendments (A-V2-1 through A-V2-8) applied before lock |
| Implementation Plan v1 | Superseded by v2. No modifications. Retained for historical reference |
| PROJECT_STATUS.md | Updated to record research completion, v2 commit, and supersession |
| Phase 2 Transition Guide §5 | 2 version catalog additions (`apiguardian-api`, `archunit-junit5`) |
| Design documents 01–14 | No amendments required |
| Architecture Invariants | No amendments required |
| Locked Decisions Register | No amendments required |
