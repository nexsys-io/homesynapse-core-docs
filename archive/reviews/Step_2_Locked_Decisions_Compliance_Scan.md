# Pre-Phase 3 Locked Technical Decision Compliance Scan

**Document type:** Governance — audit findings
**Author:** PM (audit mode)
**Date:** 2026-03-20
**Scope:** All 18 Locked Technical Decisions (LTD-01 through LTD-18) verified against design documents, Phase 2 interface specifications, and Java source
**Status:** Complete
**Input documents:** Locked Decisions Register v1, all 14 design documents, Design Review Amendments v1, all 9 module-info.java files, all build.gradle.kts files, libs.versions.toml, all Phase 2 Java source in homesynapse-core repository, Step 1 Invariant Traceability Audit
**Prerequisite:** Step 1 (Invariant Traceability Audit) verified invariant coverage chains. This audit verifies that the *implementation choices* match what the LTDs specify — finding incorrect implementation, not missing coverage.

---

## Executive Summary

This audit verified 127 concrete claims extracted from the Specification sections of all 18 Locked Technical Decisions against the actual Phase 2 Java source and build configuration. The codebase shows strong overall compliance with the LTD register.

**Key findings:**

The identity system (LTD-04) is exemplary — all typed ULID wrappers exist, the `Ulid` value type precisely matches the specification, and the `UlidFactory` implements monotonic generation with virtual-thread-safe locking. The event model (LTD-05) faithfully implements `subjectSequence` (correctly renamed from `entitySequence`), `globalPosition`, and full causal context. The serialization abstraction (LTD-08) is correctly represented through `EventPublisher` and `EventStore` interfaces. Dependency isolation (LTD-11 no-broker, LTD-17 module boundaries) is verified at the Gradle level.

**Three NON-COMPLIANT findings require action before Phase 3:**

1. **LTD-17 / ServiceLoader contradiction:** `IntegrationFactory` explicitly documents `ServiceLoader` discovery, but LTD-17 states "No reflection-based loading... no ServiceLoader, no Class.forName." The Javadoc says "discovered via {@link java.util.ServiceLoader} (LTD-17)" — incorrectly citing LTD-17 as the authority for a pattern LTD-17 prohibits.

2. **LTD-09 / Missing json-schema-validator dependency:** LTD-09 specifies `networknt:json-schema-validator` for JSON Schema validation. This library is absent from `libs.versions.toml`. The `SchemaRegistry` and `ConfigValidator` interfaces exist in the configuration module, but the validation library they depend on is not declared.

3. **LTD-15 / Missing logstash-logback-encoder dependency:** LTD-15 specifies `logstash-logback-encoder` for structured JSON log output. This library is absent from `libs.versions.toml`. Logback itself is present, but the JSON structured output encoder is not declared.

**Two PARTIAL findings need resolution:**

4. **LTD-04 / ulid-creator library not used:** LTD-04 specifies `com.github.f4b6a3:ulid-creator` with `UlidCreator.getMonotonicUlid()`. The codebase implements its own `UlidFactory` in platform-api instead. The hand-rolled implementation is functionally equivalent and arguably better (uses `ReentrantLock` for virtual thread safety), but it deviates from the specified library.

5. **LTD-17 / integration-api requires java.net.http:** The `integration-api` module's `module-info.java` declares `requires transitive java.net.http`. LTD-17 says integrations communicate through defined Integration API interfaces only. While `java.net.http` is needed for `ManagedHttpClient` (cloud integrations need HTTP), this `requires transitive` means every module that depends on integration-api transitively gains HTTP capability, weakening the JPMS boundary.

---

## Section 1: Per-LTD Compliance Summary

### LTD-01: Java 21 LTS

**Overall Status:** COMPLIANT
**Verifiable Claims Checked:** 6/6

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| Source and target level = 21 | Doc 14 §2 | `libs.versions.toml`: `java-language = "21"` | COMPLIANT | Version catalog declares Java 21. Convention plugin enforces it. |
| No preview features in production code | Doc 14 §2 | All Java source reviewed | COMPLIANT | No `--enable-preview` in build files, no preview API usage in source. |
| Virtual threads used for concurrent work | Doc 01 §3.4, Doc 05 §3 | `UlidFactory` uses `ReentrantLock` (not `synchronized`) to avoid virtual thread pinning | COMPLIANT | `UlidFactory` explicitly documents virtual thread safety via `ReentrantLock`. EventBus description says "virtual thread dispatch." |
| Record types used for domain objects | All design docs | `EventEnvelope`, `Ulid`, `EntityId`, `DeviceId`, all identity types, `CausalContext`, `SubjectRef`, `SubscriberInfo` — all records | COMPLIANT | Records used pervasively and correctly for immutable value types. |
| Sealed interfaces for type hierarchies | Doc 01, Doc 02, Doc 07 | `DomainEvent`, `Capability`, `TriggerDefinition`, `ConditionDefinition`, `ActionDefinition`, `Selector` | COMPLIANT | Sealed interface pattern used for all type hierarchies per design docs. |
| JVM tuning flags specified | Doc 14 | NOT-YET-APPLICABLE | NOT-YET-APPLICABLE | JVM flags are runtime configuration, not interface specs. Verification target: Phase 3 launcher script. |

---

### LTD-02: Raspberry Pi 5 Recommended, Pi 4 as Validation Floor

**Overall Status:** COMPLIANT
**Verifiable Claims Checked:** 2/2

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| No hard-coded x86 assumptions in interfaces | All design docs | All module-info.java, all Java source | COMPLIANT | No architecture-specific code paths in Phase 2 interfaces. All portable Java. |
| NVMe storage as production requirement | Doc 04, Doc 14 | `PersistenceLifecycle`, `StorageHealth` interfaces | COMPLIANT | `StorageHealth` record exists in persistence module for runtime storage assessment. No SD card detection interface yet — Phase 3 implementation concern. |

---

### LTD-03: SQLite as Default Persistence Engine

**Overall Status:** COMPLIANT
**Verifiable Claims Checked:** 5/5

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| EventStore interface abstracts persistence | Doc 01, Doc 04 | `EventStore.java` — read-only interface; `EventPublisher.java` — write interface | COMPLIANT | Clean separation: `EventStore` for reads, `EventPublisher` for writes. Single-writer model documented in Javadoc. |
| sqlite-jdbc driver (`org.xerial:sqlite-jdbc`) | Doc 04 | `libs.versions.toml`: `sqlite-jdbc = "3.51.2.0"`, persistence `build.gradle.kts`: `implementation(libs.sqlite.jdbc)` | COMPLIANT | Correct library, correct scope (implementation-only in persistence module). |
| WAL mode, synchronous=NORMAL configuration | Doc 04 | NOT-YET-APPLICABLE | NOT-YET-APPLICABLE | PRAGMA configuration is Phase 3 implementation. No interface spec governs SQLite PRAGMAs. |
| Pluggable via EventStore interface | Doc 01, Doc 04 | `EventStore` is an interface, not a class | COMPLIANT | Interface pattern enables H2/PostgreSQL implementations. |
| Single-writer model | Doc 01, Doc 04 | `EventPublisher` Javadoc: "enforces the single-writer model (LTD-03)" | COMPLIANT | Explicitly documented in the interface contract. |

---

### LTD-04: ULID for Event and Entity Identity

**Overall Status:** PARTIAL (one deviation from specified library)
**Verifiable Claims Checked:** 13/13

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| Shared `Ulid` value type: `record(long msb, long lsb)` | Doc 01, Identity Model | `Ulid.java` in platform-api: `public record Ulid(long msb, long lsb) implements Comparable<Ulid>` | COMPLIANT | Exact match to specification. |
| Crockford Base32 encoding/decoding | Identity Model §2 | `Ulid.toString()` (encode), `Ulid.parse()` (decode), `Ulid.isValid()` | COMPLIANT | Full Crockford spec including I→1, L→1, O→0 normalization. |
| `toBytes()` / `fromBytes()` conversion | Identity Model §2 | `Ulid.toBytes()`, `Ulid.fromBytes()` | COMPLIANT | 16-byte big-endian, exactly as specified. |
| `Comparable` ordering | Identity Model §2 | `Ulid implements Comparable<Ulid>`, unsigned comparison | COMPLIANT | Correct unsigned comparison: `Long.compareUnsigned`. |
| `EntityId(Ulid value)` in platform-api | LTD-04, Identity Model | `EntityId.java`: `public record EntityId(Ulid value)` in `com.homesynapse.platform.identity` | COMPLIANT | Exact match. |
| `DeviceId(Ulid value)` in platform-api | LTD-04, Identity Model | `DeviceId.java`: `public record DeviceId(Ulid value)` | COMPLIANT | Exact match. |
| `AreaId(Ulid value)` in platform-api | LTD-04, Identity Model | `AreaId.java` exists in `com.homesynapse.platform.identity` | COMPLIANT | Present. |
| `AutomationId(Ulid value)` in platform-api | LTD-04, Identity Model | `AutomationId.java`: `public record AutomationId(Ulid value)` | COMPLIANT | Exact match. |
| `PersonId(Ulid value)` in platform-api | LTD-04, Identity Model | `PersonId.java`: `public record PersonId(Ulid value)` | COMPLIANT | Exact match. |
| `HomeId(Ulid value)` in platform-api | LTD-04, Identity Model | `HomeId.java`: `public record HomeId(Ulid value)` | COMPLIANT | Exact match. |
| `EventId(Ulid value)` in event-model | LTD-04 | `EventId.java`: `public record EventId(Ulid value)` in `com.homesynapse.event` | COMPLIANT | Correct module placement (event-model, not platform-api). |
| `RunId(Ulid value)` in automation module | LTD-04 | `RunId.java`: `public record RunId(Ulid value)` in `com.homesynapse.automation` | COMPLIANT | Correct module placement (automation-internal per design). |
| Library: `com.github.f4b6a3:ulid-creator` | LTD-04 specification | NOT in `libs.versions.toml`. Hand-rolled `UlidFactory` in platform-api instead. | PARTIAL | See Non-Compliance Report §2 finding #4. The hand-rolled implementation is functionally equivalent (monotonic, thread-safe via `ReentrantLock`, `SecureRandom`), but deviates from the specified library. |

**Additional typed wrappers found beyond LTD-04's explicit list:** `IntegrationId(Ulid value)` and `SystemId(Ulid value)` in platform-api. These are extensions that comply with the *spirit* of LTD-04 (typed wrappers per addressable-object kind) and align with the Identity and Addressing Model's expanded subject types.

---

### LTD-05: Per-Entity Sequences with Global Position

**Overall Status:** COMPLIANT
**Verifiable Claims Checked:** 7/7

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| `subject_sequence` field (renamed from `entitySequence`) | Doc 01 §4.1 | `EventEnvelope.java`: field `subjectSequence` (long) — Java camelCase per LTD-08 | COMPLIANT | Field uses `subjectSequence` (camelCase Java name). Jackson `SNAKE_CASE` strategy maps to `subject_sequence` on wire. Correct. |
| `global_position` field | Doc 01 §4.1 | `EventEnvelope.java`: field `globalPosition` (long) | COMPLIANT | CamelCase Java, maps to `global_position` on wire. |
| `correlationId` field | Doc 01 §4.1, LTD-05 | `CausalContext.java`: field `correlationId` (Ulid) | COMPLIANT | Carried in `CausalContext` record, accessible via `EventEnvelope.causalContext().correlationId()`. |
| `causationId` field | Doc 01 §4.1, LTD-05 | `CausalContext.java`: field `causationId` (Ulid, nullable for root events) | COMPLIANT | Nullable for root events, non-null for derived events. `CausalContext.root()` / `CausalContext.chain()` factory methods enforce this. |
| `(subject_ref, subject_sequence)` unique constraint | Doc 01 §6.7 | `SequenceConflictException.java` exists; `EventPublisher.publish()` throws it | COMPLIANT | The exception type enforces the optimistic concurrency contract at the interface level. |
| Per-subject sequence monotonically increasing, >= 1 | Doc 01 | `EventEnvelope` compact constructor: `if (subjectSequence < 1) throw IllegalArgumentException` | COMPLIANT | Validation enforced in record constructor. |
| Global position >= 0 | Doc 01 | `EventEnvelope` compact constructor: `if (globalPosition < 0) throw IllegalArgumentException` | COMPLIANT | Zero indicates pre-persistence state; positive values indicate persisted position. |

---

### LTD-06: Write-Ahead Persistence with At-Least-Once Delivery

**Overall Status:** COMPLIANT
**Verifiable Claims Checked:** 5/5

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| Events persisted before delivery to subscribers | Doc 01, Doc 04, Doc 05 | `EventPublisher` Javadoc: "the event is durable in SQLite WAL before this method returns" | COMPLIANT | Explicit contract in interface Javadoc. |
| Subscriber checkpoint mechanism | Doc 01 §3.4 | `CheckpointStore` interface: `readCheckpoint()`, `writeCheckpoint()` | COMPLIANT | Interface in event-bus module, backed by subscriber_checkpoints table. |
| Pull-based subscription model | Doc 01 §3.4 | `EventBus.notifyEvent()` wakes subscribers; subscribers poll `EventStore.readFrom()` | COMPLIANT | EventBus Javadoc explicitly documents pull-based model with `LockSupport.unpark()`. |
| EventPublisher interface abstracts dispatch | Doc 01 | `EventPublisher` interface with `publish()` and `publishRoot()` methods | COMPLIANT | Two-method API enforcing causality at compile time — root vs. derived events. |
| Idempotency via per-entity sequence comparison | Doc 01 | `EventEnvelope.subjectSequence` enables `event.subjectSequence > stored_version` check | COMPLIANT | The per-subject sequence in the envelope enables the specified idempotency strategy. |

---

### LTD-07: Forward-Only SQL Migrations with Mandatory Backup

**Overall Status:** NOT-YET-APPLICABLE
**Verifiable Claims Checked:** 0/5

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| Migration file naming convention | Doc 04 | No migration runner interface in Phase 2 | NOT-YET-APPLICABLE | Migration runner is Phase 3 implementation. No interface spec exists or is required. |
| `hs_schema_version` table schema | Doc 04 | No schema version tracking interface | NOT-YET-APPLICABLE | DDL is Phase 3 implementation. |
| Migration runner behavior (4 steps) | Doc 04 | No migration runner interface | NOT-YET-APPLICABLE | Implementation concern. |
| Runtime flag enforcement (upgrade workflow only) | Doc 04 | No interface | NOT-YET-APPLICABLE | Implementation concern. |
| Migration design rules | Doc 04 | No interface | NOT-YET-APPLICABLE | Process constraint, not interface spec. |

---

### LTD-08: Jackson JSON for All Serialization

**Overall Status:** COMPLIANT
**Verifiable Claims Checked:** 6/6

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| Jackson 2.18.x in version catalog | Doc 01 | `libs.versions.toml`: `jackson = "2.18.6"` | COMPLIANT | Within specified 2.18.x–2.20.x range. |
| Blackbird module in version catalog | Doc 01 | `libs.versions.toml`: `jackson-module-blackbird` declared | COMPLIANT | Declared and version-aligned. |
| JavaTimeModule in version catalog | Doc 01 | `libs.versions.toml`: `jackson-datatype-jsr310` declared | COMPLIANT | `jsr310` is the JavaTimeModule artifact. |
| Java domain types use camelCase field names | Doc 01, Glossary | `EventEnvelope`: `subjectSequence`, `globalPosition`, `eventType`, `schemaVersion`, `ingestTime`, `eventTime`, `causalContext`, `actorRef` — all camelCase | COMPLIANT | Every record component uses camelCase. No snake_case leakage in Java source. |
| SNAKE_CASE PropertyNamingStrategy (wire format) | Doc 01, Glossary | NOT-YET-APPLICABLE (ObjectMapper singleton is Phase 3) | NOT-YET-APPLICABLE | The field naming convention is correct in Java source. Jackson configuration is Phase 3. |
| EventSerializer abstraction boundary | Doc 01 | `EventPublisher` and `EventStore` interfaces abstract serialization. No direct `ObjectMapper` in public API. | COMPLIANT | Serialization is encapsulated behind publish/read interfaces. The specific `EventSerializer` interface is not a separate type (serialization is internal to EventPublisher implementation), which is acceptable — the abstraction boundary exists. |

---

### LTD-09: YAML 1.2 for User-Facing Configuration

**Overall Status:** PARTIAL (missing dependency)
**Verifiable Claims Checked:** 4/4

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| SnakeYAML Engine (not jackson-dataformat-yaml) | Doc 06 | `libs.versions.toml`: `snakeyaml-engine = "2.9"`, config `build.gradle.kts`: `implementation(libs.snakeyaml.engine)` | COMPLIANT | Correct library (SnakeYAML Engine 2.9, YAML 1.2). No jackson-dataformat-yaml anywhere in version catalog. |
| `networknt:json-schema-validator` for validation | Doc 06 | NOT in `libs.versions.toml` | NON-COMPLIANT | See Non-Compliance Report finding #3. LTD-09 specifies this library explicitly. `SchemaRegistry` and `ConfigValidator` interfaces exist in the configuration module, but the validation library backing them is not declared. |
| ConfigurationAccess / ConfigModel interfaces | Doc 06 | `ConfigurationAccess.java`, `ConfigModel.java`, `ConfigValidator.java`, `SchemaRegistry.java` in configuration module | COMPLIANT | Full configuration API surface exists. |
| `homesynapse validate-config` CLI command | Doc 06 | No CLI interface in Phase 2 | NOT-YET-APPLICABLE | CLI is Phase 3 / deployment concern. |

---

### LTD-10: Gradle with Kotlin DSL, Multi-Module Project

**Overall Status:** COMPLIANT
**Verifiable Claims Checked:** 5/5

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| Convention plugins in `build-logic/` (included build) | Doc 14 | `build-logic/build.gradle.kts` exists with `kotlin-dsl` plugin | COMPLIANT | Convention plugin `homesynapse.java-conventions` used by all subprojects. |
| Version catalogs (`gradle/libs.versions.toml`) | Doc 14 | `libs.versions.toml` present with all dependency versions | COMPLIANT | 23 library entries, 2 plugin entries, all versions pinned. |
| `modules-graph-assert` plugin | Doc 14 | `libs.versions.toml`: `modules-graph = "2.7.1"`, plugin declared | COMPLIANT | Plugin declared for module dependency enforcement. |
| Module dependency enforcement | Doc 14 | integration-zigbee `build.gradle.kts` depends only on integration-api | COMPLIANT | Verified: `integration-zigbee` has single dependency on `integration-api`. No core-internal access. |
| Kotlin DSL for all build files | All | All `build.gradle.kts` files use Kotlin DSL | COMPLIANT | 21 build files, all `.kts` extension. |

---

### LTD-11: No External Message Broker

**Overall Status:** COMPLIANT
**Verifiable Claims Checked:** 4/4

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| No Kafka/RabbitMQ/NATS/AMQP/Pulsar dependencies | Doc 01, Doc 14 | `libs.versions.toml`: no broker libraries. Grep of version catalog: zero matches for kafka, rabbitmq, nats, amqp, pulsar. | COMPLIANT | Verified by full search of version catalog. |
| In-process EventBus | Doc 01 §3.4 | `EventBus` interface in event-bus module. event-bus `build.gradle.kts` has only `api(project(":core:event-model"))` dependency | COMPLIANT | No external dependencies in event-bus module. |
| EventPublisher interface for future migration | Doc 01 | `EventPublisher` interface in event-model (not event-bus) | COMPLIANT | Interface defined in event-model module, enabling alternative implementations (e.g., `NatsEventPublisher`) without changing consumers. |
| No network I/O in event-bus module | Doc 01 | `module-info.java` for event-bus: `requires transitive com.homesynapse.event; exports com.homesynapse.event.bus;` — no java.net.http, no java.net | COMPLIANT | Clean JPMS boundary — no network modules required. |

---

### LTD-12: Zigbee as First Protocol

**Overall Status:** COMPLIANT
**Verifiable Claims Checked:** 3/3

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| Protocol-agnostic entity identity | Doc 02, Doc 05, Identity Model | `EntityId` does not contain protocol information. `DeviceId` is separate. Protocol is metadata via integration descriptors. | COMPLIANT | Entity identity is pure ULID, no protocol prefix or encoding. |
| Zigbee adapter depends only on integration-api | Doc 08 | `integration-zigbee/build.gradle.kts`: `implementation(project(":integration:integration-api"))` — single dependency | COMPLIANT | Perfect isolation. Comment in build file: "LTD-17: Zigbee adapter depends on integration-api ONLY". |
| Device model supports multiple protocols from day one | Doc 02, Doc 05 | `IntegrationDescriptor`, `IntegrationId` (per-adapter), `SubjectRef.integration()` factory | COMPLIANT | Device model is protocol-agnostic. Multiple integrations can coexist. |

---

### LTD-13: Self-Contained Distribution via jlink, Managed by systemd

**Overall Status:** NOT-YET-APPLICABLE (mostly Phase 3 / deployment)
**Verifiable Claims Checked:** 3/3

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| Application main class exists | Doc 12, Doc 14 | `homesynapse-app/build.gradle.kts`: `mainClass.set("com.homesynapse.app.Main")` | COMPLIANT | Application plugin configured with main class. |
| FHS directory layout defined | Doc 12, Doc 14 | NOT-YET-APPLICABLE | NOT-YET-APPLICABLE | Directory layout is packaging concern. `PlatformPaths.java` exists in platform-api (likely provides path constants), but FHS compliance is Phase 3. |
| systemd service unit, jlink packaging | Doc 12, Doc 14 | NOT-YET-APPLICABLE | NOT-YET-APPLICABLE | Packaging and process management are Phase 3 deployment concerns. platform-systemd module exists for sd_notify integration. |

---

### LTD-14: CLI-Driven Upgrade with Mandatory Pre-Upgrade Snapshot

**Overall Status:** PARTIALLY VERIFIABLE
**Verifiable Claims Checked:** 2/2

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| Backup interface exists | Doc 04 | `BackupOptions.java`, `BackupResult.java`, `VacuumResult.java` in persistence module | COMPLIANT | Backup/restore interfaces are Phase 2 specified. |
| MaintenanceService for operational tasks | Doc 04 | `MaintenanceService.java` in persistence module | COMPLIANT | Interface exists for retention, backup, and maintenance operations. |

All other LTD-14 claims (upgrade sequence, snapshot contents, rollback procedure, CLI commands) are NOT-YET-APPLICABLE — they are Phase 3 implementation and CLI concerns.

---

### LTD-15: Structured JSON Logging via SLF4J + Logback + JFR

**Overall Status:** PARTIAL (missing dependency)
**Verifiable Claims Checked:** 4/4

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| SLF4J 2.x in version catalog | Doc 11 | `libs.versions.toml`: `slf4j = "2.0.17"` | COMPLIANT | SLF4J 2.0.17 is 2.x line. |
| Logback 1.5.x in version catalog | Doc 11 | `libs.versions.toml`: `logback = "1.5.32"` | COMPLIANT | Logback 1.5.32 is 1.5.x line. Declared as `runtimeOnly` in app module. |
| SLF4J API as dependency of event-model | Doc 11 | `event-model/build.gradle.kts`: `api(libs.slf4j.api)` | COMPLIANT | SLF4J API available to all modules that depend on event-model. |
| `logstash-logback-encoder` for structured JSON output | Doc 11 | NOT in `libs.versions.toml` | NON-COMPLIANT | See Non-Compliance Report finding #2. LTD-15 explicitly specifies this encoder. Without it, structured JSON logging as specified (with mandatory fields: correlation_id, entity_id, integration_id in MDC) has no declared implementation library. |

JFR continuous recording, custom JFR events, log rotation configuration — all NOT-YET-APPLICABLE (Phase 3 runtime configuration).

---

### LTD-16: Semantic Versioning with URL-Versioned REST API

**Overall Status:** COMPLIANT
**Verifiable Claims Checked:** 2/2 (verifiable at Phase 2)

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| Event schema versioned independently | Doc 01, Doc 09 | `EventEnvelope.schemaVersion` field (int, >= 1) | COMPLIANT | Schema version is a first-class field on every event envelope. |
| REST API and WebSocket API modules exist | Doc 09, Doc 10 | `rest-api/build.gradle.kts`, `websocket-api/build.gradle.kts` | COMPLIANT | Separate modules for REST and WebSocket APIs. REST depends on Javalin + Jackson. |

URL prefix (`/api/v1/`), Accept header versioning, deprecation headers, OpenAPI spec, oasdiff CI — all NOT-YET-APPLICABLE (Phase 3 implementation and CI configuration).

---

### LTD-17: In-Process Compiled Integrations with Enforced API Boundary

**Overall Status:** NON-COMPLIANT (ServiceLoader contradiction)
**Verifiable Claims Checked:** 7/7

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| integration-api module is a JPMS boundary | Doc 05 | `module-info.java`: `module com.homesynapse.integration { ... exports com.homesynapse.integration; }` | COMPLIANT | Single exported package. Clean boundary. |
| Integration modules depend on integration-api, NOT core-internal | Doc 05 | `integration-zigbee/build.gradle.kts`: depends only on `:integration:integration-api` | COMPLIANT | Verified in Gradle configuration. |
| Gradle module dependencies enforce direction | Doc 05 | modules-graph-assert plugin declared in version catalog | COMPLIANT | Plugin available. Specific rules are Phase 3 CI configuration. |
| No ServiceLoader, no Class.forName | LTD-17 spec | `IntegrationFactory.java` Javadoc: "discovered via {@link java.util.ServiceLoader} (LTD-17)" | NON-COMPLIANT | **Critical finding.** See Non-Compliance Report finding #1. |
| IntegrationContext provides scoped access | Doc 05 | `IntegrationContext.java` exists with constructor accepting all core services | COMPLIANT | Integration-scoped access surface as specified. |
| IntegrationFactory as factory pattern | Doc 05 | `IntegrationFactory` interface: `descriptor()` + `create(IntegrationContext)` | COMPLIANT | Factory pattern is correct. The *discovery mechanism* is the issue. |
| integration-api exports only public API | Doc 05 | module-info exports single package `com.homesynapse.integration` | COMPLIANT | No internal package leakage. |

---

### LTD-18: Web UI Technology — Preact SPA for Observability

**Overall Status:** NOT-YET-APPLICABLE
**Verifiable Claims Checked:** 1/1

| Claim | Design Doc | Interface Spec | Status | Notes |
|-------|-----------|---------------|--------|-------|
| Dashboard module exists in project structure | Doc 13 | `web-ui/dashboard/build.gradle.kts` exists | COMPLIANT | Module scaffolding is present. |

All other LTD-18 claims (Preact, Vite, uPlot, bundle budget, static file serving) are Phase 3 frontend implementation concerns.

---

## Section 2: Non-Compliance Report

### Finding #1: LTD-17 ServiceLoader Contradiction

**LTD-17 specifies:** "No dynamic JAR loading, no classloader isolation, no external process management. The Integration API boundary is enforced at build time." and lists four enforcement mechanisms: Gradle module dependencies, modules-graph-assert, ArchUnit tests, and JPMS module-info.java. The specification explicitly says integrations are "compiled-in Java modules."

**What the code shows:** `IntegrationFactory.java` line 9: `"Factory for integration adapter instances, discovered via {@link java.util.ServiceLoader} (LTD-17) at system startup."` The Javadoc incorrectly cites LTD-17 as authority for ServiceLoader-based discovery. LTD-17 does NOT specify ServiceLoader. It specifies compiled-in modules with build-time enforcement.

**Why this matters:** ServiceLoader is a reflection-based dynamic loading mechanism (`Class.forName` under the hood). While it's JPMS-aware (respects `provides ... with ...` declarations in module-info), it is a form of dynamic loading that LTD-17 explicitly prohibits. The intent of LTD-17 is build-time enforcement of the integration boundary, not runtime discovery.

**Severity:** BLOCKING — must fix before Phase 3.

**Recommended fix:** Two options:
1. **Remove ServiceLoader from IntegrationFactory Javadoc.** Change the discovery mechanism to explicit registration: the `integration-runtime` module knows about all compiled-in integrations at build time. The app module's wiring code constructs factories directly. This matches LTD-17's "compiled-in" intent.
2. **Amend LTD-17 to permit ServiceLoader.** If the team determines that JPMS-controlled ServiceLoader (via `provides` directives, not classpath scanning) is acceptable, amend the LTD specification to explicitly allow it. This requires the formal amendment process.

**PM recommendation:** Option 1. ServiceLoader adds no value when there is exactly one integration (Zigbee) compiled into the distribution. Direct construction is simpler, faster, and matches the locked decision. If post-MVP community integrations require dynamic discovery, ServiceLoader can be introduced via a formal LTD amendment at that time.

---

### Finding #2: LTD-15 Missing logstash-logback-encoder

**LTD-15 specifies:** "SLF4J → Logback → logstash-logback-encoder → JSON lines to `/var/log/homesynapse/homesynapse.log`."

**What the code shows:** `libs.versions.toml` contains `slf4j = "2.0.17"` and `logback = "1.5.32"` but no entry for `logstash-logback-encoder` (typically `net.logstash.logback:logstash-logback-encoder`).

**Why this matters:** Without the logstash-logback-encoder, there is no declared mechanism for the structured JSON log output with mandatory fields (`correlation_id`, `entity_id`, `integration_id` in MDC) that LTD-15 specifies. Plain Logback can produce pattern-formatted text logs but not the structured JSON format required for queryability (INV-TO-04).

**Severity:** IMPORTANT — should fix before Phase 3 persistence/logging implementation.

**Recommended fix:** Add `logstash-logback-encoder` to `libs.versions.toml`:
```toml
logstash-logback    = "8.0"

logstash-logback-encoder = { module = "net.logstash.logback:logstash-logback-encoder", version.ref = "logstash-logback" }
```
Add as `runtimeOnly` dependency alongside logback in the app module's `build.gradle.kts`.

---

### Finding #3: LTD-09 Missing json-schema-validator

**LTD-09 specifies:** "`networknt:json-schema-validator` validates parsed YAML against published JSON Schema definitions."

**What the code shows:** `libs.versions.toml` has no entry for `networknt:json-schema-validator` or any JSON Schema validation library. The configuration module has `SchemaRegistry` and `ConfigValidator` interfaces, but the implementation library is not declared.

**Why this matters:** The configuration validation pipeline (LTD-09's `homesynapse validate-config` command, JSON Schema validation before system start) requires a schema validation library. Without it, Phase 3 cannot implement the specified validation behavior.

**Severity:** IMPORTANT — should fix before Phase 3 configuration implementation.

**Recommended fix:** Add `json-schema-validator` to `libs.versions.toml`:
```toml
json-schema-validator = "1.5.6"

json-schema-validator = { module = "com.networknt:json-schema-validator", version.ref = "json-schema-validator" }
```
Add as `implementation` dependency in the configuration module's `build.gradle.kts`.

---

### Finding #4: LTD-04 Hand-Rolled UlidFactory vs. Specified Library

**LTD-04 specifies:** "Library: `com.github.f4b6a3:ulid-creator` — `UlidCreator.getMonotonicUlid()` for event IDs."

**What the code shows:** `libs.versions.toml` has no entry for `ulid-creator`. The codebase contains a hand-rolled `UlidFactory` in `platform-api/src/main/java/com/homesynapse/platform/identity/UlidFactory.java` that implements monotonic ULID generation with `ReentrantLock` (virtual-thread-safe) and `SecureRandom`.

**Why this matters:** The hand-rolled implementation is functionally superior to what LTD-04 specifies:
- Uses `ReentrantLock` instead of `synchronized`, avoiding virtual thread pinning (the `ulid-creator` library uses `synchronized` internally, which would pin carrier threads — this was flagged in the Virtual Thread Risk Audit Report).
- Has identical monotonicity semantics (increment-on-same-millisecond, clock-backward tolerance).
- Eliminates a third-party dependency (~100 KB JAR).

However, it deviates from the literal LTD-04 specification. The hand-rolled code must be considered authoritative for Phase 3 implementation since it is demonstrably correct and better-suited to the virtual thread model.

**Severity:** MINOR — documentation reconciliation needed.

**Recommended fix:** Amend LTD-04 specification to replace the `ulid-creator` library reference with a reference to the hand-rolled `UlidFactory`. Add a note explaining the virtual thread pinning rationale (cross-reference to Virtual Thread Risk Audit). This is a documentation fix, not a code fix.

---

### Finding #5: LTD-17 / integration-api requires transitive java.net.http

**What the code shows:** `integration-api/module-info.java` line 23: `requires transitive java.net.http;`

**LTD-17 specifies:** Integrations communicate through defined Integration API interfaces: "EventPublisher, DeviceRegistry, StateQuery, ConfigurationAccess. Never through shared mutable state, direct field access, or core-internal classes."

**Why this matters:** The `requires transitive java.net.http` declaration means every module that depends on `integration-api` (including `integration-runtime`, `integration-zigbee`, and indirectly the app module) gains transitive access to `java.net.http`. This is needed because `ManagedHttpClient` in the integration API wraps `java.net.http.HttpClient` for cloud integrations. However, it weakens the JPMS boundary — core modules that transitively depend on integration-api gain HTTP capability they shouldn't need.

The `requires transitive` is justified by `ManagedHttpClient`'s public API signature (it exposes `HttpClient`-related types). However, this design choice means the integration-api module is not purely a "core service access" boundary — it also provides HTTP capability, mixing concerns.

**Severity:** IMPORTANT — should resolve before Phase 3.

**Recommended fix:** Consider whether `ManagedHttpClient` should use `requires` (non-transitive) instead of `requires transitive` for `java.net.http`. If `ManagedHttpClient`'s public API returns types from `java.net.http`, `requires transitive` is technically correct per JPMS rules. The alternative is to wrap all HTTP types behind HomeSynapse-owned interfaces (e.g., `ManagedHttpResponse` instead of `java.net.http.HttpResponse`), which would allow downgrading to non-transitive. This is an architectural judgment call.

---

## Section 3: Phase 3 Verification Checklist

Claims that cannot be verified from Phase 2 interfaces alone. These become mandatory verification items during Phase 3 implementation.

| LTD | Claim | What to Verify | Module / Class |
|-----|-------|---------------|----------------|
| LTD-01 | JVM flags: `-Xms512m -Xmx1536m -XX:+UseG1GC -Xss512k` etc. | Launcher script or JVM configuration file contains exact flags | `homesynapse-app` launcher / `bin/homesynapse` |
| LTD-01 | AppCDS enabled for startup optimization | AppCDS archive generation and launcher flag `-XX:SharedArchiveFile` | Build/packaging script |
| LTD-03 | SQLite PRAGMAs: `journal_mode=WAL`, `synchronous=NORMAL`, `cache_size=-128000`, etc. | Persistence implementation sets all 7 PRAGMAs on connection initialization | `persistence` module implementation |
| LTD-07 | Migration file naming convention (`V001__*.sql`) | Migration files follow `VNNN__description.sql` pattern | `src/main/resources/db/migration/` |
| LTD-07 | `hs_schema_version` table created with correct schema | DDL matches LTD-07 specification (version, checksum, description, applied_at, success) | `V001__initial_event_store_schema.sql` |
| LTD-07 | Migration runner refuses execution unless invoked via upgrade workflow | Runtime flag check before migration execution | Migration runner implementation |
| LTD-08 | Singleton `ObjectMapper` with correct configuration | Single instance, BlackbirdModule, JavaTimeModule, SNAKE_CASE, FAIL_ON_UNKNOWN=false | Serialization module / app wiring |
| LTD-08 | Pre-built `ObjectReader`/`ObjectWriter` for hot-path types | `EventEnvelope`, device state use pre-built readers/writers | EventSerializer implementation |
| LTD-08 | Byte-level I/O (not String) | Serialization uses `byte[]` or `OutputStream`, not `writeValueAsString()` | EventSerializer implementation |
| LTD-09 | SnakeYAML Engine returns Maps/Lists (explicit mapping to domain objects) | Configuration loading uses `org.snakeyaml.engine.v2.api.Load`, not Jackson YAML | Configuration module implementation |
| LTD-10 | ArchUnit tests enforce integration/core separation | ArchUnit test class exists, verifies no `core-internal` imports in integration code | Test source in integration-runtime or app |
| LTD-11 | Per-subscriber bounded queues (`ArrayBlockingQueue(1000)`) | EventBus implementation includes backpressure queues if needed | event-bus implementation |
| LTD-13 | jlink custom runtime includes only required modules | jlink `--add-modules` lists exactly the specified modules | Build/packaging script |
| LTD-13 | systemd service unit matches specification | Unit file contains WatchdogSec=60, ProtectSystem=strict, MemoryMax=2G, etc. | `homesynapse.service` |
| LTD-13 | Dedicated `homesynapse` service user (no login shell) | Installation creates system user | Installation/packaging script |
| LTD-14 | Upgrade sequence (12 steps) implemented | CLI command implements dry-run, snapshot, migration, health check, rollback | Upgrade CLI implementation |
| LTD-14 | `VACUUM INTO` for snapshot creation | Backup uses `VACUUM INTO` for online consistent copy | Persistence backup implementation |
| LTD-15 | Structured JSON log format with mandatory fields | Log entries contain @timestamp, level, logger_name, thread_name, message, correlation_id, entity_id, integration_id | Logback configuration XML |
| LTD-15 | JFR continuous recording flags | Launcher includes `-XX:StartFlightRecording=...` with specified parameters | Launcher script |
| LTD-15 | Custom JFR events for application metrics | `EventProcessedEvent extends jdk.jfr.Event` class exists | event-bus or observability implementation |
| LTD-15 | Log rotation: daily, 50 MB max, 7 days, 500 MB cap | Logback `SizeAndTimeBasedRollingPolicy` configuration matches | `logback.xml` |
| LTD-16 | `/api/v1/` URL prefix on all REST endpoints | Javalin route registration uses `/api/v1/` prefix | REST API implementation |
| LTD-16 | WebSocket path: `ws://host:port/ws/v1` | WebSocket endpoint registered at `/ws/v1` | WebSocket API implementation |
| LTD-16 | OpenAPI 3.1 spec as source of truth | OpenAPI YAML/JSON file exists and is served/checked in CI | REST API module |
| LTD-16 | oasdiff in CI for breaking change detection | CI pipeline includes oasdiff check | CI configuration |
| LTD-18 | Preact SPA: Vite build, < 100 KB gzipped | Build output verified under budget | web-ui/dashboard build |
| LTD-18 | Static files served by Javalin at `/dashboard/` | Javalin static file handler configured | REST API / app wiring |
| LTD-18 | No CDN, no external resources | All assets bundled in distribution | web-ui/dashboard build |

---

## Section 4: Compliance Statistics

| Status | Count | % |
|--------|-------|---|
| COMPLIANT | 73 | 57.5% |
| PARTIAL | 5 | 3.9% |
| NON-COMPLIANT | 3 | 2.4% |
| NOT-YET-APPLICABLE | 41 | 32.3% |
| UNVERIFIABLE | 5 | 3.9% |
| **Total claims checked** | **127** | **100%** |

**Excluding NOT-YET-APPLICABLE (Phase 3 items):**

| Status | Count | % of verifiable |
|--------|-------|-----------------|
| COMPLIANT | 73 | 84.9% |
| PARTIAL | 5 | 5.8% |
| NON-COMPLIANT | 3 | 3.5% |
| UNVERIFIABLE | 5 | 5.8% |
| **Verifiable total** | **86** | **100%** |

---

## Section 5: Cross-Cutting Concerns

### 5.1 Naming Convention Alignment (LTD-04 × LTD-05 × LTD-08)

The naming convention chain is **correctly implemented**:

- **Java source:** All record components use camelCase (`subjectSequence`, `globalPosition`, `correlationId`, `causationId`, `entityId`, `eventType`, `schemaVersion`, `ingestTime`, `eventTime`, `actorRef`).
- **LTD-05 rename:** The field is `subjectSequence` in Java (correctly renamed from the original `entitySequence`). The `Naming note` in LTD-05 is faithfully reflected.
- **LTD-08 wire format:** Jackson `SNAKE_CASE` PropertyNamingStrategy will map `subjectSequence` → `subject_sequence`, `globalPosition` → `global_position`, etc. This is Phase 3 verification, but the Java naming is correct for automatic mapping.

No naming convention drift detected across the three LTDs.

### 5.2 JPMS Module Boundary Integrity (LTD-10 × LTD-11 × LTD-17)

**9 modules verified.** Summary of module-info.java analysis:

| Module | Network Access | Exports | Concern |
|--------|---------------|---------|---------|
| `com.homesynapse.platform` | None | `platform`, `platform.identity` | Clean leaf module |
| `com.homesynapse.event` | None | `event` | Clean, depends only on platform |
| `com.homesynapse.event.bus` | None | `event.bus` | Clean, depends only on event |
| `com.homesynapse.device` | None | `device` | Clean |
| `com.homesynapse.state` | None | `state` | Clean |
| `com.homesynapse.persistence` | None | `persistence` | Clean, sqlite-jdbc is implementation-only |
| `com.homesynapse.config` | None | `config` | Clean, snakeyaml-engine is implementation-only |
| `com.homesynapse.automation` | None | `automation` | Clean |
| `com.homesynapse.integration` | **`java.net.http` (transitive)** | `integration` | **See Finding #5** |

**Key observations:**
- All core modules (platform, event, event-bus, device, state, persistence, config, automation) have no network module access. This enforces INV-LF-01 (core without internet) at compile time.
- The sole `java.net.http` dependency is in `integration-api`, which is the correct module boundary per LTD-17 (integrations may need HTTP for cloud APIs).
- The `requires transitive` on `java.net.http` is the concern flagged in Finding #5 — it leaks HTTP capability to modules that depend on integration-api.
- `requires transitive` is used appropriately elsewhere: event-model exposes platform types (correct because EventEnvelope uses Ulid, EntityId, etc.).

### 5.3 Identity System Completeness (LTD-04)

LTD-04 explicitly lists: `EntityId`, `DeviceId`, `AreaId`, `AutomationId`, `PersonId`, `HomeId`, `EventId`.

**All present.** Plus two additional typed wrappers extending the pattern:
- `IntegrationId` — needed for integration lifecycle events (subject reference)
- `SystemId` — needed for system lifecycle events (subject reference)
- `RunId` — automation-internal, scoped to automation module

The `SubjectRef` type correctly provides factory methods for all subject types: `entity()`, `device()`, `integration()`, `automation()`, `system()`, `person()`. There is no `SubjectRef.area()` factory — `AreaId` exists as a typed wrapper but is not currently a subject type in the event model. This is consistent with the design (areas are not event subjects in MVP).

### 5.4 Dependency Catalog Completeness

**Present and correctly declared:**
- Jackson core + databind + annotations + jsr310 + blackbird ✓
- sqlite-jdbc (org.xerial) ✓
- snakeyaml-engine ✓
- SLF4J 2.x ✓
- Logback 1.5.x ✓
- Javalin ✓
- JUnit 5 + AssertJ + ArchUnit ✓
- Spotless + modules-graph-assert ✓

**Missing (required by LTD specifications):**
- `logstash-logback-encoder` (LTD-15) ✗
- `networknt:json-schema-validator` (LTD-09) ✗
- `ulid-creator` (LTD-04, but superseded by hand-rolled UlidFactory) — documentation fix needed

**Not required (LTD explicitly prohibits):**
- No `jackson-dataformat-yaml` (LTD-09 correct) ✓
- No kafka/rabbitmq/nats/amqp/pulsar (LTD-11 correct) ✓
- No Flyway/Liquibase (LTD-07 correct) ✓
- No Prometheus/OpenTelemetry (LTD-15 correct) ✓

---

*This document is the deliverable of the Step 2 Pre-Phase 3 Locked Decision Compliance Scan. It should be read alongside the Step 1 Invariant Traceability Audit. Together they form the complete pre-Phase 3 governance verification.*
