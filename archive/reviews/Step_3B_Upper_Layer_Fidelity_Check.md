# Pre-Phase 3 Upper-Layer Fidelity Check

**Document type:** Governance — audit findings
**Author:** PM (audit mode)
**Date:** 2026-03-20
**Scope:** 4 upper-layer modules with substantive Phase 2 code + 10 scaffold modules — field-by-field and method-by-method comparison of Phase 2 Java source against governing design documents and Design Review Amendments
**Status:** Complete
**Input documents:** Doc 04 (Persistence Layer), Doc 05 (Integration Runtime), Doc 06 (Configuration System), Doc 07 (Automation Engine), Design Review Amendments v1, AMD-25 Temporal Duration Trigger Modifier, Block L Handoff, all MODULE_CONTEXT.md files, all Phase 2 Java source, Steps 1/2/3A audit findings
**Prerequisite:** Step 3A verified the 5 foundation modules (platform-api, event-model, event-bus, device-model, state-store) with HIGH FIDELITY — 0 critical deltas, all foundation types are trustworthy references for upper-layer cross-module checks.

---

## Executive Summary

This audit performed field-by-field and method-by-method verification of all public types in 4 upper-layer modules and checked 10 scaffold modules. A total of **109 public types** across 4 substantive modules were inspected.

**Overall result: HIGH FIDELITY.** The Phase 2 interface specifications faithfully represent their governing design documents. No structural mismatches (wrong field types, wrong method signatures, wrong sealed hierarchy membership) were found. All amendments affecting these modules (AMD-04, AMD-25) are fully integrated. Cross-module type boundaries with foundation modules are consistent.

**Key findings:**

- **0 CRITICAL deltas** — no wrong field types, missing fields, or broken contracts
- **1 NON-COMPLIANT finding** — IntegrationFactory Javadoc references LTD-17 for ServiceLoader; should reference LTD-16 (carryforward from Step 2, now with exact line number)
- **1 SIGNIFICANT gap** — Persistence module interfaces lack virtual thread executor contract in Javadoc (Phase 3 implementation risk)
- **1 DOCUMENTATION debt** — integration-api MODULE_CONTEXT.md is empty scaffold despite 21 Java types
- **All cross-module boundary checks MATCH** — correct types, correct imports, correct `requires transitive` declarations
- **Both upper-layer amendments (AMD-04 cascade depth, AMD-25 duration triggers) PRESENT** in automation module
- **All 10 scaffold modules exist** with build.gradle.kts and MODULE_CONTEXT.md — none have module-info.java yet

---

## Section 1: Per-Module Fidelity Summary

### 1.1 persistence — Doc 04: Persistence Layer

**Module:** `com.homesynapse.persistence` (1 package)
**Governing doc:** Doc 04 §3–§8
**Types checked:** 11 (7 records + 4 interfaces)
**Overall status:** MATCH

#### Records

| Type | Kind | Fields | Design Doc Match | Status |
|------|------|--------|-----------------|--------|
| `TelemetrySample` | record (4 fields) | `entityRef: EntityId`, `attributeKey: String`, `value: double`, `timestamp: Instant` | Doc 04 §3.6, §8.3 — ring buffer telemetry sample | MATCH |
| `RingBufferStats` | record (6 fields) | `maxRows: int`, `currentSeq: long`, `oldestSeqInRing: long`, `distinctEntities: int`, `oldestTimestamp: Instant`, `newestTimestamp: Instant` | Doc 04 §3.6, §8.5 | MATCH |
| `BackupOptions` | record (2 fields) | `includeTelemetry: boolean`, `preUpgrade: boolean` | Doc 04 §3.10, §8.4 — VACUUM INTO backup parameters | MATCH |
| `BackupResult` | record (5 fields) | `backupDirectory: Path`, `createdAt: Instant`, `eventsGlobalPosition: long`, `telemetryIncluded: boolean`, `integrityVerified: boolean` | Doc 04 §3.10, §8.4 | MATCH |
| `RetentionResult` | record (5 fields) | `eventsDeleted: long`, `diagnosticEventsDeleted: long`, `normalEventsDeleted: long`, `criticalEventsDeleted: long`, `durationMs: long` | Doc 04 §3.4, §8.6 — priority-tier retention (DIAGNOSTIC 7d, NORMAL 90d, CRITICAL 365d) | MATCH |
| `VacuumResult` | record (4 fields) | `pagesFreed: long`, `databaseSizeBeforeBytes: long`, `databaseSizeAfterBytes: long`, `durationMs: long` | Doc 04 §3.3, §8.6 — incremental vacuum outcome | MATCH |
| `StorageHealth` | record (7 fields) | `eventsDatabaseSizeBytes: long`, `telemetryDatabaseSizeBytes: long`, `totalSizeBytes: long`, `budgetBytes: long`, `usagePercent: double`, `walSizeBytes: long`, `healthy: boolean` | Doc 04 §3.5, §8.6 — `budgetBytes=0` sentinel for no budget | MATCH |

#### Interfaces

| Type | Kind | Methods | Design Doc Match | Status |
|------|------|---------|-----------------|--------|
| `TelemetryWriter` | interface | `writeSamples(List<TelemetrySample>)` | Doc 04 §3.6, §8.3 — batch write, ring buffer overwrite (`slot = seq % max_rows`) | MATCH |
| `TelemetryQueryService` | interface | `querySamples(EntityId, String, Instant, Instant, int)` → `List<TelemetrySample>`, `getRingStats()` → `RingBufferStats` | Doc 04 §3.6, §8.5 | MATCH |
| `PersistenceLifecycle` | interface | `start()` → `CompletableFuture<Void>`, `stop()`, `createBackup(BackupOptions)` → `BackupResult`, `restoreFromBackup(Path)` | Doc 04 §3.1, §3.10, §8.4 — boot order: before Event Bus and State Store | MATCH |
| `MaintenanceService` | interface | `runRetention()` → `RetentionResult`, `runVacuum()` → `VacuumResult`, `getStorageHealth()` → `StorageHealth` | Doc 04 §3.4, §3.5, §8.6 — priority-based retention, incremental vacuum | MATCH |

**Notes:**
- `TelemetrySample.entityRef` uses `EntityId` (typed ULID wrapper from platform-api) — Doc 04 uses `EntityRef` conceptually but Java correctly uses the LTD-04 typed wrapper. MODULE_CONTEXT documents this decision.
- `ViewCheckpointStore` NOT duplicated — persistence module requires state-store (non-transitive) and implements the interface. Correct per MODULE_CONTEXT.
- **Virtual Thread Gap:** Public interfaces do not document the virtual thread executor contract that Doc 04 §3.4–§3.7 extensively specifies. sqlite-jdbc JNI calls double-pin carrier threads. This creates Phase 3 implementation risk — builders might use regular executors. See Delta Report D-03.

**module-info.java:** `requires transitive com.homesynapse.platform` (EntityId in public API), `requires com.homesynapse.state` (ViewCheckpointStore), `requires com.homesynapse.event` (Javadoc refs only). ✓ CORRECT.

**build.gradle.kts:** `api(event-model)`, `api(state-store)`, `implementation(sqlite-jdbc)`. ✓ CORRECT — sqlite-jdbc not exposed.

---

### 1.2 integration-api — Doc 05: Integration Runtime

**Module:** `com.homesynapse.integration` (1 package)
**Governing doc:** Doc 05 §3–§8
**Types checked:** 21 (1 sealed interface + 5 lifecycle records + 6 records + 5 interfaces + 3 enums + 1 exception)
**Overall status:** MATCH (with 1 Javadoc non-compliance carryforward)

#### Core Types

| Type | Kind | Fields/Members | Design Doc Match | Status |
|------|------|---------------|-----------------|--------|
| `IntegrationFactory` | interface | `descriptor()` → `IntegrationDescriptor`, `create(IntegrationContext)` → `IntegrationAdapter` | Doc 05 §8.3 | MATCH |
| `IntegrationAdapter` | interface | `initialize()`, `run()`, `close()`, `commandHandler()` → `Optional<CommandHandler>` | Doc 05 §8.4 | MATCH |
| `IntegrationContext` | record (10 fields) | `integrationId`, `integrationType`, `eventPublisher`, `entityRegistry`, `stateQueryService`, `healthReporter`, `configAccess`, `schedulerService`, `telemetryWriter`, `httpClient` | Doc 05 §3.8, §8.1 — scoped access surface | MATCH |
| `CommandEnvelope` | record (6 fields) | `entityRef`, `commandName`, `parameters`, `commandEventId`, `correlationId`, `integrationId` | Doc 05 §8.2, §8.6 | MATCH |
| `CommandHandler` | interface | `handle(CommandEnvelope)` — `@FunctionalInterface` | Doc 05 §8.6 | MATCH |
| `IntegrationDescriptor` | record (8 fields) | `integrationType`, `displayName`, `ioType`, `requiredServices`, `dataPaths`, `healthParameters`, `dependsOn`, `schemaVersion` | Doc 05 §4.1, §8.2 | MATCH |
| `HealthReporter` | interface | `reportHeartbeat()`, `reportKeepalive(Instant)`, `reportError(Throwable)`, `reportHealthTransition(HealthState, String)` | Doc 05 §3.5, §8.5 | MATCH |
| `HealthParameters` | record (11 fields) | `heartbeatTimeout`, `healthWindowSize`, `maxDegradedDuration`, `maxSuspendedDuration`, `maxSuspensionCycles`, `maxRestarts`, `restartWindow`, `probeInitialDelay`, `probeMaxDelay`, `probeCount`, `probeSuccessThreshold` + `defaults()` factory | Doc 05 §4.2, §8.2 | MATCH |
| `ManagedHttpClient` | interface | `send(HttpRequest, BodyHandler<T>)` → `HttpResponse<T>`, `sendAsync(HttpRequest, BodyHandler<T>)` → `CompletableFuture<HttpResponse<T>>`, `close()` | Doc 05 §3.8, §3.9, §8.1 | MATCH |
| `SchedulerService` | interface | `schedule(Runnable, Duration)`, `scheduleAtFixedRate(Runnable, Duration, Duration)`, `shutdown()` | Doc 05 §3.8, §8.1 | MATCH |
| `PermanentIntegrationException` | exception | `errorCode()` → `String`, `suggestedHttpStatus()` → `int`. Extends `HomeSynapseException` | Doc 05 §3.7, §8.2 | MATCH |

#### Enums

| Type | Values | Design Doc Match | Status |
|------|--------|-----------------|--------|
| `HealthState` | `HEALTHY`, `DEGRADED`, `SUSPENDED`, `FAILED` | Doc 05 §3.4, §4.3 | MATCH |
| `RequiredService` | `HTTP_CLIENT`, `SCHEDULER`, `TELEMETRY_WRITER` | Doc 05 §3.8, §8.2 | MATCH |
| `DataPath` | `DOMAIN`, `TELEMETRY` | Doc 05 §3.12, §8.2 | MATCH |
| `IoType` | `SERIAL`, `NETWORK` | Doc 05 §3.2, §4.1 | MATCH |

#### Sealed Hierarchy: IntegrationLifecycleEvent

| Type | Fields | Status |
|------|--------|--------|
| `IntegrationLifecycleEvent` (sealed) | Permits 5 subtypes | MATCH |
| `IntegrationStarted` | `integrationId`, `integrationType`, `newState`, `reason` | MATCH |
| `IntegrationStopped` | `integrationId`, `integrationType`, `previousState`, `newState`, `reason` | MATCH |
| `IntegrationHealthChanged` | `integrationId`, `integrationType`, `previousState`, `newState`, `reason`, `healthScore` | MATCH |
| `IntegrationRestarted` | `integrationId`, `integrationType`, `previousState`, `newState`, `reason`, `restartCount` | MATCH |
| `IntegrationResourceExceeded` | `integrationId`, `integrationType`, `previousState`, `newState`, `reason`, `resourceType`, `currentValue`, `limitValue` | MATCH |

**Known Issue Verification:**
- **ServiceLoader Javadoc (Step 2 NON-COMPLIANT #1):** CONFIRMED. `IntegrationFactory.java` line 9: `{@link java.util.ServiceLoader} (LTD-17) at system startup (Doc 05 §8.1, §8.3)`. The LTD reference is wrong — should be LTD-16, not LTD-17. LTD-17 prohibits ServiceLoader; LTD-16 covers in-process compiled modules.
- **ManagedHttpClient → java.net.http (Step 2 PARTIAL #5):** JUSTIFIED. `ManagedHttpClient.send()` and `sendAsync()` expose `HttpRequest`, `HttpResponse`, and `BodyHandler` from `java.net.http` in their public API signatures. The `requires transitive java.net.http` is necessary and correct.
- **MODULE_CONTEXT empty (Step 2 finding):** CONFIRMED. Still an empty scaffold template with only section headers, despite 21 Java types existing. Documentation debt.

**module-info.java:** 7 `requires transitive` declarations: `com.homesynapse.platform`, `com.homesynapse.event`, `com.homesynapse.device`, `com.homesynapse.state`, `com.homesynapse.persistence`, `com.homesynapse.config`, `java.net.http`. ✓ CORRECT — all justified (adapter-facing API module needs full context).

**build.gradle.kts:** `api(event-model)`, `api(device-model)`, `api(state-store)`, `api(persistence)`, `api(configuration)`. ✓ CORRECT.

---

### 1.3 configuration — Doc 06: Configuration System

**Module:** `com.homesynapse.config` (1 package)
**Governing doc:** Doc 06 §3–§8
**Types checked:** 24 (3 enums + 11 records + 2 exceptions + 6 interfaces + module-info + package-info)
**Overall status:** MATCH

#### Enums

| Type | Values | Design Doc Match | Status |
|------|--------|-----------------|--------|
| `Severity` | `FATAL`, `ERROR`, `WARNING` | Doc 06 §4.6 | MATCH |
| `ReloadClassification` | `HOT`, `INTEGRATION_RESTART`, `PROCESS_RESTART` | Doc 06 §4.3 | MATCH |
| `ChangeType` | `KEY_RENAMED`, `KEY_ADDED`, `KEY_REMOVED`, `VALUE_TRANSFORMED`, `SECTION_RESTRUCTURED` | Doc 06 §3.7 | MATCH |

#### Records

| Type | Kind | Fields | Design Doc Match | Status |
|------|------|--------|-----------------|--------|
| `ConfigIssue` | record (6 fields) | `severity`, `path`, `message`, `invalidValue` (nullable), `appliedDefault` (nullable), `yamlLine` (nullable) | Doc 06 §4.6 | MATCH |
| `SecretEntry` | record (4 fields) | `key`, `value`, `createdAt`, `updatedAt` | Doc 06 §4.8 | MATCH |
| `ConfigMutation` | record (3 fields) | `sectionPath`, `key`, `newValue` (nullable — null means remove) | Doc 06 §4.7 | MATCH |
| `ConfigSection` | record (3 fields) | `path`, `values` (Map, copyOf), `defaults` (Map, copyOf) | Doc 06 §4.2 | MATCH |
| `ConfigChange` | record (5 fields) | `sectionPath`, `key`, `oldValue` (nullable), `newValue` (nullable), `reload: ReloadClassification` | Doc 06 §4.3 — reload-path change | MATCH |
| `MigrationChange` | record (5 fields) | `type: ChangeType`, `path`, `oldValue` (nullable), `newValue` (nullable), `reason` | Doc 06 §3.7 — **renamed from Doc 06's second ConfigChange** to avoid collision | MATCH |
| `ConfigChangeSet` | record (2 fields) | `timestamp`, `changes` (List, copyOf) | Doc 06 §4.3 | MATCH |
| `MigrationResult` | record (2 fields) | `migratedConfig` (Map, copyOf), `changes` (List, copyOf) | Doc 06 §3.7 | MATCH |
| `MigrationPreview` | record (4 fields) | `fromVersion`, `toVersion`, `plannedChanges` (List, copyOf), `requiresUserReview` | Doc 06 §3.7 | MATCH |
| `ConfigModel` | record (5 fields) | `schemaVersion`, `loadedAt`, `fileModifiedAt`, `sections` (Map, copyOf), `rawMap` (Map, copyOf) | Doc 06 §4.1 — Phase 2 uses Map-based sections, typed records deferred to Phase 3 | MATCH |
| `ReloadResult` | record (3 fields) | `newModel`, `changeSet`, `issues` (List, copyOf) | Doc 06 §8.3 — new Phase 2 addition | MATCH |

#### Exceptions

| Type | Error Code | HTTP Status | Status |
|------|-----------|-------------|--------|
| `ConfigurationLoadException` | `config.load_failed` | 503 | MATCH |
| `ConfigurationReloadException` | `config.reload_failed` | 422 | MATCH |

#### Service Interfaces

| Type | Kind | Methods | Design Doc Match | Status |
|------|------|---------|-----------------|--------|
| `ConfigurationService` | interface | `load()` → `ConfigModel`, `reload()` → `ReloadResult`, `getCurrentModel()` → `ConfigModel`, `getSection(String)` → `Optional<ConfigSection>`, `write(List<ConfigMutation>, Instant)` (throws 2 exception types) | Doc 06 §8.1, §8.3 | MATCH |
| `ConfigurationAccess` | interface | `getConfig()` → `Map<String, Object>`, `getString(String)` → `Optional<String>`, `getInt(String)` → `Optional<Integer>`, `getBoolean(String)` → `Optional<Boolean>` | Doc 06 §8.4 — read-only, scoped to integration's section | MATCH |
| `SecretStore` | interface | `resolve(String)` → `String`, `set(String, String)`, `remove(String)`, `list()` → `Set<String>` | Doc 06 §8.5 — AES-256-GCM per INV-PD-03 | MATCH |
| `ConfigValidator` | interface | `validate(Map<String, Object>, String)` → `List<ConfigIssue>` | Doc 06 §8.1 — pure function, JSON text input | MATCH |
| `ConfigMigrator` | interface | `fromVersion()` → `int`, `toVersion()` → `int`, `migrate(Map<String, Object>)` → `MigrationResult` | Doc 06 §3.7 — forward-only, idempotent | MATCH |
| `SchemaRegistry` | interface | `registerCoreSchema(String, String)`, `registerIntegrationSchema(String, String)`, `getComposedSchema()` → `String`, `writeComposedSchema(Path)` | Doc 06 §8.6 — String-based API (JSON text, not library types) for JPMS hygiene | MATCH |

**Notes:**
- `MigrationChange` renamed from Doc 06's second `ConfigChange` to avoid collision — both Doc 06 and MODULE_CONTEXT document this resolution.
- `ConfigModel` uses `Map<String, ConfigSection>` instead of typed subsystem records (EventBusConfig, etc.) — Phase 2 simplification, Phase 3 deferral documented.
- `ConfigChangedEvent` / `ConfigErrorEvent` NOT duplicated — correctly live in event-model only. Configuration module references them via Javadoc `@see` only.
- `json-schema-validator` (networknt) CONFIRMED absent from `libs.versions.toml` — Phase 3 addition tracked.
- `module-info.java`: `requires transitive com.homesynapse.event` (HomeSynapseException in public API), `exports com.homesynapse.config`. ✓ CORRECT.

**build.gradle.kts:** `api(event-model)`, `implementation(snakeyaml-engine)`. ✓ CORRECT — SnakeYAML not exposed.

---

### 1.4 automation — Doc 07: Automation Engine

**Module:** `com.homesynapse.automation` (1 package)
**Governing doc:** Doc 07 §3–§8, AMD-25
**Types checked:** 53 (5 enums + 1 typed ULID wrapper + 4 sealed hierarchies with 30 subtypes + 4 core records + 9 service interfaces)
**Overall status:** MATCH

#### Enums

| Type | Values | Design Doc Match | Status |
|------|--------|-----------------|--------|
| `ConcurrencyMode` | `SINGLE`, `RESTART`, `QUEUED`, `PARALLEL` | Doc 07 §3.6 | MATCH |
| `RunStatus` | `EVALUATING`, `RUNNING`, `COMPLETED`, `FAILED`, `ABORTED`, `CONDITION_NOT_MET` | Doc 07 §3.7 | MATCH |
| `PendingStatus` | `DISPATCHED`, `ACKNOWLEDGED`, `CONFIRMED`, `TIMED_OUT`, `EXPIRED` | Doc 07 §4.3 | MATCH |
| `UnavailablePolicy` | `SKIP`, `ERROR`, `WARN` | Doc 07 §3.9 | MATCH |
| `MaxExceededSeverity` | `SILENT`, `INFO`, `WARNING` | Doc 07 §3.3 | MATCH |

#### Typed ULID Wrapper

| Type | Kind | Fields | Status |
|------|------|--------|--------|
| `RunId` | record | `value: Ulid` — Comparable, LTD-04 compliant | MATCH |

#### Sealed Hierarchy: Selector (6 subtypes)

| Type | Fields | Design Doc | Status |
|------|--------|-----------|--------|
| `Selector` (sealed) | Permits 6 | Doc 07 §3.12 | MATCH |
| `DirectRefSelector` | `entityId: EntityId` | §3.12 | MATCH |
| `SlugSelector` | `slug: String` | §3.12 | MATCH |
| `AreaSelector` | `areaSlug: String` | §3.12 | MATCH |
| `LabelSelector` | `label: String` | §3.12 | MATCH |
| `TypeSelector` | `entityType: String` | §3.12 | MATCH |
| `CompoundSelector` | `selectors: List<Selector>` (copyOf, intersection) | §3.12 | MATCH |

#### Sealed Hierarchy: TriggerDefinition (5 Tier 1 + 4 Tier 2 reserved)

| Type | Fields | AMD-25 forDuration | Design Doc | Status |
|------|--------|--------------------|-----------|--------|
| `TriggerDefinition` (sealed) | Permits 9 | — | Doc 07 §3.4 | MATCH |
| `StateChangeTrigger` | `selector`, `attribute`, `from`, `to`, `forDuration` | ✓ nullable Duration | §3.4 + AMD-25 | MATCH |
| `StateTrigger` | `selector`, `attribute`, `value`, `forDuration` | ✓ nullable Duration | §3.4 + AMD-25 | MATCH |
| `NumericThresholdTrigger` | `selector`, `attribute`, `above` (nullable), `below` (nullable), `forDuration` | ✓ nullable Duration | §3.4 + AMD-25 | MATCH |
| `AvailabilityTrigger` | `selector`, `targetAvailability: Availability`, `forDuration` | ✓ nullable Duration | §3.4 + AMD-25 | MATCH |
| `EventTrigger` | `eventType`, `payloadFilters` (Map, copyOf) | ✗ intentionally none | §3.4 | MATCH |
| `TimeTrigger` | (empty, Tier 2) | — | §3.4 | MATCH |
| `SunTrigger` | (empty, Tier 2) | — | §3.4 | MATCH |
| `PresenceTrigger` | (empty, Tier 2) | — | §3.4 | MATCH |
| `WebhookTrigger` | (empty, Tier 2) | — | §3.4 | MATCH |

#### Sealed Hierarchy: ConditionDefinition (6 Tier 1 + 1 Tier 2 reserved)

| Type | Fields | Design Doc | Status |
|------|--------|-----------|--------|
| `ConditionDefinition` (sealed) | Permits 7 | Doc 07 §3.8 | MATCH |
| `StateCondition` | `selector`, `attribute`, `value` | §3.8 | MATCH |
| `NumericCondition` | `selector`, `attribute`, `above` (nullable), `below` (nullable) | §3.8 | MATCH |
| `TimeCondition` | `after` (nullable), `before` (nullable) — HH:MM format | §3.8 | MATCH |
| `AndCondition` | `conditions: List<ConditionDefinition>` (copyOf, recursive) | §3.8 | MATCH |
| `OrCondition` | `conditions: List<ConditionDefinition>` (copyOf, recursive) | §3.8 | MATCH |
| `NotCondition` | `condition: ConditionDefinition` (recursive) | §3.8 | MATCH |
| `ZoneCondition` | (empty, Tier 2) | §3.8 | MATCH |

#### Sealed Hierarchy: ActionDefinition (5 Tier 1 + 3 Tier 2 reserved)

| Type | Fields | Cross-Module Refs | Design Doc | Status |
|------|--------|------------------|-----------|--------|
| `ActionDefinition` (sealed) | Permits 8 | — | Doc 07 §3.9 | MATCH |
| `CommandAction` | `target: Selector`, `commandName`, `parameters` (Map, copyOf), `onUnavailable: UnavailablePolicy` | Selector, UnavailablePolicy | §3.9 | MATCH |
| `DelayAction` | `duration: Duration` | — | §3.9 | MATCH |
| `WaitForAction` | `condition: ConditionDefinition`, `timeout: Duration`, `pollInterval: Duration` (nullable) | ConditionDefinition (recursive) | §3.9 | MATCH |
| `ConditionBranchAction` | `condition: ConditionDefinition`, `thenActions: List<ActionDefinition>` (copyOf), `elseActions: List<ActionDefinition>` (copyOf) | ConditionDefinition + ActionDefinition (recursive) | §3.9 | MATCH |
| `EmitEventAction` | `eventType`, `payload` (Map, copyOf) | — | §3.9 | MATCH |
| `ActivateSceneAction` | (empty, Tier 2) | — | §3.9 | MATCH |
| `InvokeIntegrationAction` | (empty, Tier 2) | — | §3.9 | MATCH |
| `ParallelAction` | (empty, Tier 2) | — | §3.9 | MATCH |

#### Core Records

| Type | Kind | Fields | Design Doc Match | Status |
|------|------|--------|-----------------|--------|
| `AutomationDefinition` | record (12 fields) | `automationId: AutomationId`, `slug`, `name`, `description` (nullable), `enabled`, `mode: ConcurrencyMode`, `maxConcurrent`, `maxExceededSeverity`, `priority`, `triggers: List<TriggerDefinition>` (copyOf, non-empty), `conditions: List<ConditionDefinition>` (copyOf, may be empty), `actions: List<ActionDefinition>` (copyOf, non-empty) | Doc 07 §3.3, §4.1 — all 12 fields | MATCH |
| `RunContext` | record (8 fields) | `runId: RunId`, `automationId: AutomationId`, `triggeringEventId: EventId`, `matchedTriggers: List<Integer>` (copyOf), `resolvedTargets: Map<String, Set<EntityId>>` (copyOf), `definitionHash`, `cascadeDepth: int`, `stateSnapshotPosition: long` | Doc 07 §8.2 + **AMD-04** — cascadeDepth present | MATCH |
| `PendingCommand` | record (8 fields) | `commandEventId: EventId`, `targetRef: EntityId`, `commandName`, `targetAttribute`, `expectation: Expectation`, `deadline: Instant`, `idempotency: CommandIdempotency`, `status: PendingStatus` | Doc 07 §4.3 — cross-module types (Expectation from device-model, CommandIdempotency from event-model) | MATCH |
| `DurationTimer` | record (8 fields) | `automationId: AutomationId`, `triggerIndex: int`, `startingEventId: EventId`, `entityRef: EntityId`, `forDuration: Duration`, `startedAt: Instant`, `expiresAt: Instant`, `virtualThread: Thread` | Doc 07 §8.2 + **AMD-25** — all 8 fields | MATCH |

#### Service Interfaces (9 total)

| Type | Methods | Design Doc Match | Status |
|------|---------|-----------------|--------|
| `AutomationRegistry` | `load()`, `get(AutomationId)`, `getBySlug(String)`, `getAll()`, `reload()` | Doc 07 §8.1 — CRUD + hot-reload | MATCH |
| `TriggerEvaluator` | `evaluate(EventEnvelope)`, `cancelDurationTimer(AutomationId, int)`, `activeDurationTimerCount()` | Doc 07 §3.4, §8.1 + AMD-25 | MATCH |
| `ConditionEvaluator` | `evaluate(ConditionDefinition, StateSnapshot)` | Doc 07 §3.8, §8.1 | MATCH |
| `ActionExecutor` | `execute(List<ActionDefinition>, RunContext)` | Doc 07 §3.9, §8.1 | MATCH |
| `RunManager` | `initiateRun(AutomationDefinition, EventEnvelope, List<Integer>, Map<String, Set<EntityId>>, int)` → `Optional<RunId>`, `getActiveRun(RunId)`, `getStatus(RunId)`, `activeRunCount()`, `activeRunCount(AutomationId)` | Doc 07 §3.7, §8.1 — cascade depth param present | MATCH |
| `CommandDispatchService` | `dispatch(EventId, EntityId, String, Map<String, Object>)` | Doc 07 §3.11.1, §8.1 | MATCH |
| `PendingCommandLedger` | `trackCommand(PendingCommand)`, `getCommand(EventId)`, `getPendingForEntity(EntityId)`, `pendingCount()` | Doc 07 §3.11.2, §8.1 — coalescing=DISABLED | MATCH |
| `SelectorResolver` | `resolve(Selector)` → `Set<EntityId>` | Doc 07 §3.12, §8.1 | MATCH |
| `ConflictDetector` | `scanForConflicts(EventId, List<RunContext>)` | Doc 07 §3.13, §8.1 — post-execution, no resolution in Tier 1 | MATCH |

**Notes:**
- AMD-04 (cascade depth): `RunContext.cascadeDepth` present as `int`, 0-based. `RunManager.initiateRun()` includes cascade depth parameter. Max default 8 documented.
- AMD-25 (duration triggers): All 4 trigger types have nullable `Duration forDuration`. `EventTrigger` explicitly has no `forDuration` (instantaneous). `DurationTimer` record has all 8 fields. `TriggerEvaluator` has `cancelDurationTimer()` and `activeDurationTimerCount()`.
- Block L handoff cross-check: No divergence between handoff instructions and Doc 07 type specifications. All types match.
- All `List.copyOf()` and `Map.copyOf()` applied correctly on collection fields.

**module-info.java:** 4 `requires transitive`: `com.homesynapse.platform`, `com.homesynapse.event`, `com.homesynapse.device`, `com.homesynapse.state`. ✓ CORRECT — all upstream types appear in public API signatures.

**build.gradle.kts:** `api(platform-api, event-model, device-model, state-store, configuration)`. Configuration is `api` in Gradle but NOT in module-info — correct (Phase 3 only).

---

## Section 2: Delta Report

### 2.1 Critical Deltas (wrong type, wrong signature, missing field)

**None found.**

### 2.2 Significant Deltas

| ID | Module | Type | Delta Description | Severity | Recommendation |
|----|--------|------|-------------------|----------|----------------|
| D-03 | persistence | All interfaces | Virtual thread executor contract missing from Javadoc. Doc 04 §3.4–§3.7 specifies maintenance operations on virtual threads with configurable yields. sqlite-jdbc JNI calls double-pin carrier threads. Public interfaces don't document this. | SIGNIFICANT | Before Phase 3: add VT executor contract to `MaintenanceService` and `PersistenceLifecycle` Javadoc. Without this, implementers may use regular executors, causing carrier thread pinning. |
| D-04 | integration-api | `IntegrationFactory` | Javadoc line 9 references `(LTD-17)` for ServiceLoader discovery. LTD-17 PROHIBITS ServiceLoader. Correct reference is LTD-16 (in-process compiled modules). Doc 05 §3.10 says "discovered using JPMS ServiceLoader (L12, LTD-16)." | SIGNIFICANT | Fix Javadoc: change `(LTD-17)` to `(LTD-16)`. This is a carryforward from Step 2 NON-COMPLIANT #1, now with exact line number for surgical fix. |

### 2.3 Minor Deltas

| ID | Module | Type | Delta Description | Severity | Recommendation |
|----|--------|------|-------------------|----------|----------------|
| D-05 | integration-api | MODULE_CONTEXT.md | Empty scaffold template despite 21 Java types with full Javadoc. All section headers present but no content. | MINOR | Populate before Phase 3. Integration-api is the highest-traffic cross-module boundary — builders need the gotchas documented. |

### 2.4 Cosmetic Deltas

**None found in upper-layer modules.**

---

## Section 3: Amendment Verification

| Amendment | Affects | Status | Verification |
|-----------|---------|--------|--------------|
| **AMD-03** (BLOCKING) | automation → state-store | **PRESENT** | `ConditionEvaluator.evaluate(ConditionDefinition, StateSnapshot)` uses `StateSnapshot` which contains `replaying` boolean and `disabledEntities` set (verified in Step 3A). Automation conditions evaluate against consistent snapshot. |
| **AMD-04** (BLOCKING) | automation | **PRESENT** | `RunContext.cascadeDepth` field (int, 0-based). `RunManager.initiateRun()` accepts cascade depth parameter. Javadoc documents `automation.max_cascade_depth` default 8. |
| **AMD-17** (REQUIRED) | integration-api, device-model | **NOT-IN-SCOPE** | No orphan-related types in integration-api Phase 2 interfaces. Orphan lifecycle is a Phase 3 runtime concern for `IntegrationAdapter` close/restart handling. |
| **AMD-25** | automation | **PRESENT** | 4 trigger types with nullable `Duration forDuration` (StateChangeTrigger, StateTrigger, NumericThresholdTrigger, AvailabilityTrigger). `DurationTimer` record (8 fields). `TriggerEvaluator.cancelDurationTimer()` and `activeDurationTimerCount()` methods. `EventTrigger` explicitly has no forDuration. |

**Summary:** Both BLOCKING amendments affecting upper-layer modules (AMD-03 via state-store snapshot, AMD-04 via RunContext.cascadeDepth) are fully present. AMD-25 is comprehensively integrated. AMD-17 correctly deferred to Phase 3.

---

## Section 4: Scaffold Module Status

| Module | Path | module-info? | Source Files | build.gradle.kts | MODULE_CONTEXT? | Design Doc | Status | Step 1/2 Findings |
|--------|------|-------------|-------------|-------------------|----------------|-----------|--------|-------------------|
| integration-runtime | `integration/integration-runtime/` | No | package-info.java only | api(integration-api), impl(event-model) | Yes | Doc 05 | SCAFFOLD | — |
| integration-zigbee | `integration/integration-zigbee/` | No | package-info.java only | impl(integration-api) | Yes | Doc 08 | SCAFFOLD | — |
| rest-api | `api/rest-api/` | No | package-info.java only | impl(event-model, device-model, state-store, automation, observability, javalin, jackson) | Yes | Doc 09 | SCAFFOLD | **Step 1: needs authentication interfaces (INV-SE-02)** |
| websocket-api | `api/websocket-api/` | No | package-info.java only | impl(event-model, event-bus) | Yes | Doc 10 | SCAFFOLD | **Step 1: needs authentication interfaces (INV-SE-02)** |
| observability | `observability/observability/` | No | package-info.java only | api(event-model), impl(state-store) | Yes | Doc 11 | SCAFFOLD | — |
| lifecycle | `lifecycle/lifecycle/` | No | package-info.java only | impl(platform-api, event-model, observability) | Yes | Doc 12 | SCAFFOLD | — |
| dashboard | `web-ui/dashboard/` | No | None (frontend only) | Base plugin, no Java deps | Yes | Doc 13 | SCAFFOLD | — |
| homesynapse-app | `app/homesynapse-app/` | No | Main.java only | impl(all 15 modules + logback) | Yes | Doc 12/14 | MAIN-ONLY | — |
| platform-systemd | `platform/platform-systemd/` | No | package-info.java only | impl(platform-api) | Yes | Doc 13 | SCAFFOLD | — |
| test-support | `testing/test-support/` | No | package-info.java only | api(event-model, device-model, integration-api, junit-jupiter, assertj-core) | Yes | N/A | SCAFFOLD | — |

**Key observations:**
- **None of the 10 scaffold modules have module-info.java** — JPMS declarations deferred until Phase 2 work begins for each.
- **rest-api and websocket-api** need authentication interfaces (INV-SE-02) before they can proceed to Phase 2. Step 1 flagged this as a GAP.
- **homesynapse-app** has a Main.java stub — Phase 3 will wire all modules together here.
- **dashboard** is a non-Java module (Preact/Vite frontend).
- **All 10 have build.gradle.kts** with dependency declarations that look correct for their planned scope.
- **All 10 have MODULE_CONTEXT.md** — documentation scaffolds ready for Phase 2.

---

## Section 5: Cross-Module Interface Consistency

### 5.1 Upper-Layer → Foundation Type Usage

| Boundary | Type Used | Source Module | Consuming Module | Import/Usage | Status |
|----------|-----------|--------------|-----------------|-------------|--------|
| platform → automation | `AutomationId` | platform-api | AutomationDefinition, RunContext, DurationTimer, RunManager, TriggerEvaluator | `import com.homesynapse.platform.identity.AutomationId` | MATCH |
| platform → automation | `EntityId` | platform-api | DirectRefSelector, PendingCommand, RunContext, SelectorResolver, CommandDispatchService | `import com.homesynapse.platform.identity.EntityId` | MATCH |
| platform → automation | `Ulid` | platform-api | RunId.value | `import com.homesynapse.platform.identity.Ulid` | MATCH |
| event-model → automation | `EventEnvelope` | event-model | TriggerEvaluator.evaluate(), RunManager.initiateRun() | `import com.homesynapse.event.EventEnvelope` | MATCH |
| event-model → automation | `EventId` | event-model | RunContext.triggeringEventId, PendingCommand.commandEventId, DurationTimer | `import com.homesynapse.event.EventId` | MATCH |
| event-model → automation | `CommandIdempotency` | event-model | PendingCommand.idempotency | `import com.homesynapse.event.CommandIdempotency` | MATCH |
| device-model → automation | `Expectation` | device-model | PendingCommand.expectation | `import com.homesynapse.device.Expectation` | MATCH |
| state-store → automation | `StateSnapshot` | state-store | ConditionEvaluator.evaluate() parameter | `import com.homesynapse.state.StateSnapshot` | MATCH |
| state-store → automation | `Availability` | state-store | AvailabilityTrigger.targetAvailability | `import com.homesynapse.state.Availability` | MATCH |
| platform → persistence | `EntityId` | platform-api | TelemetrySample.entityRef, TelemetryQueryService params | `import com.homesynapse.platform.identity.EntityId` | MATCH |
| state-store → persistence | `ViewCheckpointStore` | state-store | persistence implements (not duplicates) | `requires com.homesynapse.state` (non-transitive) | MATCH |
| platform → integration-api | `IntegrationId` | platform-api | IntegrationContext.integrationId, IntegrationDescriptor, CommandEnvelope, all lifecycle events | `import com.homesynapse.platform.identity.IntegrationId` | MATCH |
| platform → integration-api | `EntityId` | platform-api | CommandEnvelope.entityRef | `import com.homesynapse.platform.identity.EntityId` | MATCH |
| event-model → integration-api | `EventPublisher` | event-model | IntegrationContext.eventPublisher (Javadoc ref) | Javadoc `@see` reference | MATCH |
| device-model → integration-api | `EntityRegistry` | device-model | IntegrationContext.entityRegistry | `import com.homesynapse.device.EntityRegistry` | MATCH |
| state-store → integration-api | `StateQueryService` | state-store | IntegrationContext.stateQueryService | `import com.homesynapse.state.StateQueryService` | MATCH |
| persistence → integration-api | `TelemetryWriter` | persistence | IntegrationContext.telemetryWriter | `import com.homesynapse.persistence.TelemetryWriter` | MATCH |
| config → integration-api | `ConfigurationAccess` | configuration | IntegrationContext.configAccess | `import com.homesynapse.config.ConfigurationAccess` | MATCH |

### 5.2 JPMS Module Visibility (Upper-Layer)

| Module | `requires transitive` | Types Exposed in Public API | Correct? |
|--------|----------------------|----------------------------|----------|
| persistence | `com.homesynapse.platform` | EntityId in TelemetrySample, TelemetryQueryService | ✓ CORRECT |
| persistence | `com.homesynapse.state` (non-transitive) | ViewCheckpointStore — internal implementation | ✓ CORRECT |
| integration-api | `com.homesynapse.platform` | IntegrationId, EntityId in records | ✓ CORRECT |
| integration-api | `com.homesynapse.event` | EventPublisher referenced in context | ✓ CORRECT |
| integration-api | `com.homesynapse.device` | EntityRegistry in IntegrationContext | ✓ CORRECT |
| integration-api | `com.homesynapse.state` | StateQueryService in IntegrationContext | ✓ CORRECT |
| integration-api | `com.homesynapse.persistence` | TelemetryWriter in IntegrationContext | ✓ CORRECT |
| integration-api | `com.homesynapse.config` | ConfigurationAccess in IntegrationContext | ✓ CORRECT |
| integration-api | `java.net.http` | HttpRequest, HttpResponse in ManagedHttpClient | ✓ CORRECT |
| configuration | `com.homesynapse.event` | HomeSynapseException base class in public API throws | ✓ CORRECT |
| automation | `com.homesynapse.platform` | AutomationId, EntityId, Ulid across 15+ types | ✓ CORRECT |
| automation | `com.homesynapse.event` | EventEnvelope, EventId, CommandIdempotency | ✓ CORRECT |
| automation | `com.homesynapse.device` | Expectation in PendingCommand | ✓ CORRECT |
| automation | `com.homesynapse.state` | StateSnapshot, Availability | ✓ CORRECT |

**Summary:** All 18 upper-layer cross-module boundary checks pass. No import mismatches, no generic parameter mismatches, no missing or unjustified `requires transitive` declarations.

---

## Section 6: Consolidated Findings From All Steps

This is the master pre-Phase 3 punch list, merging findings from Steps 1, 2, 3A, and 3B.

### BLOCKING (must fix before Phase 3)

| # | Source | Finding | Recommended Fix |
|---|--------|---------|-----------------|
| B-1 | Step 2, NON-COMPLIANT #1 + Step 3B D-04 | **IntegrationFactory Javadoc cites LTD-17 for ServiceLoader.** LTD-17 prohibits ServiceLoader. Correct reference is LTD-16. Line 9 of IntegrationFactory.java. | Change `(LTD-17)` to `(LTD-16)` in Javadoc. One-line fix. Also evaluate whether the ServiceLoader pattern itself is the intended discovery mechanism (it IS permitted under LTD-16), or if this was a broader design error. |
| B-2 | Step 2, NON-COMPLIANT #2 | **Missing `networknt:json-schema-validator` from `libs.versions.toml`.** LTD-09 specifies this library. `SchemaRegistry` and `ConfigValidator` interfaces exist but the validation library they'll use is not declared. | Add `networknt:json-schema-validator` to `libs.versions.toml`. Must be present before any Phase 3 configuration implementation. |
| B-3 | Step 2, NON-COMPLIANT #3 | **Missing `logstash-logback-encoder` from `libs.versions.toml`.** LTD-15 specifies structured JSON log output via this library. Logback is present but the JSON encoder is not. | Add `logstash-logback-encoder` to `libs.versions.toml`. Required for any Phase 3 module that produces structured logs. |
| B-4 | Step 3B D-03 | **Persistence interfaces missing virtual thread executor contract in Javadoc.** sqlite-jdbc JNI calls double-pin carrier threads. Doc 04 §3.4–§3.7 specifies VT executor usage but public interfaces don't document this. High Phase 3 implementation risk. | Add VT executor contract language to `MaintenanceService` and `PersistenceLifecycle` Javadoc before Phase 3 begins. Consider AMD-26 for formal virtual thread isolation policy. |

### IMPORTANT (should fix before Phase 3)

| # | Source | Finding | Recommended Fix |
|---|--------|---------|-----------------|
| I-1 | Step 2, PARTIAL #4 | **Hand-rolled `UlidFactory` vs. `ulid-creator` library (LTD-04).** UlidFactory is functionally superior (ReentrantLock for VT safety), but LTD-04 specifies `com.github.f4b6a3:ulid-creator`. | Resolve the LTD-04 discrepancy: either (a) amend LTD-04 to permit the hand-rolled implementation (recommended — it's better), or (b) adopt the library and wrap it with ReentrantLock. Document the decision either way. |
| I-2 | Step 2, PARTIAL #5 | **`integration-api` module-info declares `requires transitive java.net.http`.** This weakens JPMS boundaries — every consumer of integration-api transitively gains HTTP capability. | Justified by ManagedHttpClient public API (HttpRequest, HttpResponse in method signatures). Document this as an accepted trade-off. Consider whether integration-runtime should be the one to expose this instead. |
| I-3 | Step 3B D-05 | **integration-api MODULE_CONTEXT.md is empty scaffold** despite 21 Java types. This is the highest-traffic cross-module API boundary in the system. | Populate MODULE_CONTEXT.md with: dependency graph, key design decisions (ServiceLoader discovery, IntegrationContext scope), gotchas (HealthReporter thread safety, ManagedHttpClient lifecycle), and cross-module contract documentation. |
| I-4 | Step 1, §10 | **Security invariants 50% PARTIAL.** INV-SE-02 (authentication) has no interfaces. rest-api and websocket-api are scaffolds with no auth types. | Define authentication interfaces before Phase 2 work begins on rest-api and websocket-api. This blocks their Phase 2 progression. |

### DOCUMENTATION (fix traceability docs, MODULE_CONTEXT files)

| # | Source | Finding | Recommended Fix |
|---|--------|---------|-----------------|
| DC-1 | Step 3A D-02 | **`platform` `package-info.java` missing copyright header.** All other source files have it. | Add `Copyright (c) 2026 NexSys` header. Cosmetic. |
| DC-2 | Step 3A D-01 | **20 `EventTypes` constants lack payload record classes.** Forward reservations for Phase 3. | No action needed in Phase 2. Phase 3 subsystem implementations should create payload records as their event types are activated. Track which constants need records in each subsystem's Phase 3 plan. |
| DC-3 | Step 3B | **4 traceability documents are empty scaffolds** (04-persistence, 05-integration-runtime, 06-configuration, 07-automation). | Populate with type-to-design-doc mappings from this audit. See Section 7. |
| DC-4 | Step 1, §5 | **Household Operability invariants (HO-01/02/03) 60% GAP.** No interfaces for area assignment, multi-device UX, or household-level operations. | These are Phase 2 work items for later modules (lifecycle, rest-api, websocket-api). Track as Phase 2 backlog. |
| DC-5 | Step 1, §6 | **Privacy and Data Governance invariants 37.5% PARTIAL+GAP.** No ScopeKeyManager, CryptoShredder, or data residency interfaces. | These require design decisions (which module owns crypto-shredding?). Escalate to Hivemind for scope assignment. |

### PHASE 3 VERIFICATION (cannot check until implementation)

| # | Source | Finding | What to Verify |
|---|--------|---------|----------------|
| P3-1 | Step 2, LTD-08 | Jackson SNAKE_CASE serialization | Verify `@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)` on all serialized records |
| P3-2 | Step 2, LTD-11 | No broker — single-writer semantics | Verify EventBus implementation uses single-writer pattern, no external message broker |
| P3-3 | Step 2, LTD-14 | SQLite WAL mode, incremental vacuum | Verify PRAGMA settings in PersistenceLifecycle.start() implementation |
| P3-4 | Step 2, LTD-01 | Virtual threads | Verify all concurrent work uses `Executors.newVirtualThreadPerTaskExecutor()`, no `synchronized` blocks |
| P3-5 | Step 2, LTD-15 | Structured logging | Verify logstash-logback-encoder produces JSON structured output |
| P3-6 | Step 3B | AMD-04 cascade depth enforcement | Verify RunManager implementation checks cascadeDepth against max (default 8) and aborts if exceeded |
| P3-7 | Step 3B | AMD-25 duration timer lifecycle | Verify TriggerEvaluator implementation correctly starts/cancels DurationTimer virtual threads |
| P3-8 | Step 3B | AMD-02 REPLAY→LIVE reconciliation | Verify StateStoreLifecycle.start() implementation replays events before signaling ready |
| P3-9 | Step 3B | AMD-10 projection version invalidation | Verify ViewCheckpointStore implementation checks projectionVersion and invalidates stale checkpoints |
| P3-10 | Step 3B | AMD-17 device orphan lifecycle | Verify IntegrationAdapter close/restart correctly handles orphaned devices |

---

## Section 7: Traceability Document Updates

### 7.1 04-persistence.md

```markdown
# Persistence Layer — Traceability

## Design Document
- **Source:** Doc 04: Persistence Layer
- **Status:** Locked

## Type-to-Design-Doc Mapping

| Java Type | Design Doc Section | Verified | Notes |
|-----------|-------------------|----------|-------|
| TelemetrySample | §3.6, §8.3 | Step 3B ✓ | entityRef is EntityId (LTD-04) |
| RingBufferStats | §3.6, §8.5 | Step 3B ✓ | 6 fields exact match |
| BackupOptions | §3.10, §8.4 | Step 3B ✓ | preUpgrade controls abort-on-failure |
| BackupResult | §3.10, §8.4 | Step 3B ✓ | integrityVerified is about backup copy |
| RetentionResult | §3.4, §8.6 | Step 3B ✓ | Per-tier: DIAGNOSTIC 7d, NORMAL 90d, CRITICAL 365d |
| VacuumResult | §3.3, §8.6 | Step 3B ✓ | Incremental vacuum, not full |
| StorageHealth | §3.5, §8.6 | Step 3B ✓ | budgetBytes=0 sentinel |
| TelemetryWriter | §3.6, §8.3 | Step 3B ✓ | Ring buffer: slot = seq % max_rows |
| TelemetryQueryService | §3.6, §8.5 | Step 3B ✓ | |
| PersistenceLifecycle | §3.1, §3.10, §8.4 | Step 3B ✓ | Boot order: before EventBus and StateStore |
| MaintenanceService | §3.4, §3.5, §8.6 | Step 3B ✓ | VT executor contract MISSING from Javadoc |

## Cross-Module Dependencies
- **Imports from:** platform-api (EntityId), state-store (ViewCheckpointStore)
- **Exported to:** integration-api (TelemetryWriter in IntegrationContext)

## Phase 3 Watch Items
- sqlite-jdbc carrier thread pinning — all DB ops need platform thread executor
- ViewCheckpointStore implementation — implements state-store interface, does NOT duplicate
```

### 7.2 05-integration-runtime.md

```markdown
# Integration Runtime — Traceability

## Design Document
- **Source:** Doc 05: Integration Runtime
- **Status:** Locked

## Type-to-Design-Doc Mapping (integration-api module)

| Java Type | Design Doc Section | Verified | Notes |
|-----------|-------------------|----------|-------|
| IntegrationFactory | §8.3 | Step 3B ✓ | **Javadoc cites LTD-17 — should be LTD-16** |
| IntegrationAdapter | §8.4 | Step 3B ✓ | initialize(), run(), close(), commandHandler() |
| IntegrationContext | §3.8, §8.1 | Step 3B ✓ | 10 fields: scoped access surface |
| CommandEnvelope | §8.2, §8.6 | Step 3B ✓ | 6 fields |
| CommandHandler | §8.6 | Step 3B ✓ | @FunctionalInterface |
| IntegrationDescriptor | §4.1, §8.2 | Step 3B ✓ | 8 fields with validation |
| HealthReporter | §3.5, §8.5 | Step 3B ✓ | 4 methods |
| HealthParameters | §4.2, §8.2 | Step 3B ✓ | 11 fields + defaults() factory |
| ManagedHttpClient | §3.8, §3.9, §8.1 | Step 3B ✓ | Exposes java.net.http types (justifies transitive) |
| SchedulerService | §3.8, §8.1 | Step 3B ✓ | 3 methods |
| HealthState | §3.4, §4.3 | Step 3B ✓ | 4 values |
| RequiredService | §3.8, §8.2 | Step 3B ✓ | 3 values |
| DataPath | §3.12, §8.2 | Step 3B ✓ | 2 values |
| IoType | §3.2, §4.1 | Step 3B ✓ | 2 values |
| PermanentIntegrationException | §3.7, §8.2 | Step 3B ✓ | extends HomeSynapseException |
| IntegrationLifecycleEvent (sealed) | §4.4, §8.2 | Step 3B ✓ | 5 permitted subtypes |

## Integration-Runtime Module (scaffold)
- Path: integration/integration-runtime/
- Status: SCAFFOLD — package-info.java only
- Phase 2 pending: IntegrationSupervisor, HealthTracker, IntegrationHealthRecord (Doc 05 §3.8)

## Cross-Module Dependencies
- **Imports from:** platform-api, event-model, device-model, state-store, persistence, configuration, java.net.http
- **Exported to:** integration-runtime, integration-zigbee, homesynapse-app

## Known Issues
- IntegrationFactory Javadoc LTD reference error (B-1)
- MODULE_CONTEXT.md empty (I-3)
- requires transitive java.net.http trade-off (I-2)
```

### 7.3 06-configuration.md

```markdown
# Configuration System — Traceability

## Design Document
- **Source:** Doc 06: Configuration System
- **Status:** Locked

## Type-to-Design-Doc Mapping

| Java Type | Design Doc Section | Verified | Notes |
|-----------|-------------------|----------|-------|
| Severity | §4.6 | Step 3B ✓ | 3 values |
| ReloadClassification | §4.3 | Step 3B ✓ | 3 values |
| ChangeType | §3.7 | Step 3B ✓ | 5 values |
| ConfigIssue | §4.6 | Step 3B ✓ | 6 fields (3 nullable) |
| SecretEntry | §4.8 | Step 3B ✓ | 4 fields |
| ConfigMutation | §4.7 | Step 3B ✓ | 3 fields (newValue nullable) |
| ConfigSection | §4.2 | Step 3B ✓ | 3 fields, Map.copyOf() |
| ConfigChange | §4.3 | Step 3B ✓ | 5 fields — reload-path change |
| MigrationChange | §3.7 | Step 3B ✓ | **Renamed from Doc 06's second ConfigChange** |
| ConfigChangeSet | §4.3 | Step 3B ✓ | 2 fields |
| MigrationResult | §3.7 | Step 3B ✓ | 2 fields |
| MigrationPreview | §3.7 | Step 3B ✓ | 4 fields |
| ConfigModel | §4.1 | Step 3B ✓ | 5 fields — Map-based, typed records Phase 3 |
| ReloadResult | §8.3 | Step 3B ✓ | New Phase 2 addition |
| ConfigurationLoadException | §4 | Step 3B ✓ | config.load_failed / 503 |
| ConfigurationReloadException | §4 | Step 3B ✓ | config.reload_failed / 422 |
| ConfigurationService | §8.1, §8.3 | Step 3B ✓ | 5 methods |
| ConfigurationAccess | §8.4 | Step 3B ✓ | 4 typed getters, scoped |
| SecretStore | §8.5 | Step 3B ✓ | AES-256-GCM, 4 methods |
| ConfigValidator | §8.1 | Step 3B ✓ | Pure function |
| ConfigMigrator | §3.7 | Step 3B ✓ | Forward-only, idempotent |
| SchemaRegistry | §8.6 | Step 3B ✓ | String-based API (JPMS hygiene) |

## Cross-Module Dependencies
- **Imports from:** event-model (HomeSynapseException base class)
- **Exported to:** integration-api (ConfigurationAccess in IntegrationContext)

## Phase 3 Watch Items
- json-schema-validator library needs adding to libs.versions.toml (B-2)
- Typed subsystem records (EventBusConfig, etc.) deferred from ConfigModel
```

### 7.4 07-automation.md

```markdown
# Automation Engine — Traceability

## Design Document
- **Source:** Doc 07: Automation Engine
- **Amendments:** AMD-04 (cascade depth), AMD-25 (duration triggers)
- **Status:** Locked

## Type-to-Design-Doc Mapping

### Enums (5)
| Java Type | Design Doc Section | Verified |
|-----------|-------------------|----------|
| ConcurrencyMode | §3.6 | Step 3B ✓ |
| RunStatus | §3.7 | Step 3B ✓ |
| PendingStatus | §4.3 | Step 3B ✓ |
| UnavailablePolicy | §3.9 | Step 3B ✓ |
| MaxExceededSeverity | §3.3 | Step 3B ✓ |

### Typed ULID Wrapper (1)
| Java Type | Design Doc Section | Verified |
|-----------|-------------------|----------|
| RunId | §4.1, LTD-04 | Step 3B ✓ |

### Sealed Hierarchies (4)
| Hierarchy | Subtypes | Design Doc Section | Verified |
|-----------|----------|-------------------|----------|
| Selector | 6 (all Tier 1) | §3.12 | Step 3B ✓ |
| TriggerDefinition | 9 (5 Tier 1 + 4 Tier 2) | §3.4, AMD-25 | Step 3B ✓ |
| ConditionDefinition | 7 (6 Tier 1 + 1 Tier 2) | §3.8 | Step 3B ✓ |
| ActionDefinition | 8 (5 Tier 1 + 3 Tier 2) | §3.9 | Step 3B ✓ |

### Core Records (4)
| Java Type | Fields | Design Doc Section | Verified | Notes |
|-----------|--------|-------------------|----------|-------|
| AutomationDefinition | 12 | §3.3, §4.1 | Step 3B ✓ | |
| RunContext | 8 | §8.2, AMD-04 | Step 3B ✓ | cascadeDepth present |
| PendingCommand | 8 | §4.3 | Step 3B ✓ | Cross-module: Expectation, CommandIdempotency |
| DurationTimer | 8 | §8.2, AMD-25 | Step 3B ✓ | virtualThread field for lifecycle |

### Service Interfaces (9)
| Java Type | Methods | Design Doc Section | Verified |
|-----------|---------|-------------------|----------|
| AutomationRegistry | 5 | §8.1 | Step 3B ✓ |
| TriggerEvaluator | 3 | §3.4, §8.1, AMD-25 | Step 3B ✓ |
| ConditionEvaluator | 1 | §3.8, §8.1 | Step 3B ✓ |
| ActionExecutor | 1 | §3.9, §8.1 | Step 3B ✓ |
| RunManager | 5 | §3.7, §8.1 | Step 3B ✓ |
| CommandDispatchService | 1 | §3.11.1, §8.1 | Step 3B ✓ |
| PendingCommandLedger | 4 | §3.11.2, §8.1 | Step 3B ✓ |
| SelectorResolver | 1 | §3.12, §8.1 | Step 3B ✓ |
| ConflictDetector | 1 | §3.13, §8.1 | Step 3B ✓ |

## Cross-Module Dependencies
- **Imports from:** platform-api (AutomationId, EntityId, Ulid), event-model (EventEnvelope, EventId, CommandIdempotency), device-model (Expectation), state-store (StateSnapshot, Availability)
- **Exported to:** rest-api (automation CRUD endpoints), homesynapse-app (wiring)

## Amendment Presence
- AMD-04 (cascade depth): RunContext.cascadeDepth ✓, RunManager parameter ✓
- AMD-25 (duration triggers): 4 trigger forDuration fields ✓, DurationTimer ✓, TriggerEvaluator methods ✓
```

---

## Appendix A: Known Issues Verification (from Steps 1 and 2)

| Known Issue | Step 3B Verification | Result |
|-------------|---------------------|--------|
| IntegrationFactory ServiceLoader LTD-17 reference | IntegrationFactory.java line 9: `(LTD-17)` — should be `(LTD-16)` | CONFIRMED NON-COMPLIANT |
| ManagedHttpClient → java.net.http transitive | ManagedHttpClient.send() exposes HttpRequest/HttpResponse in public API | CONFIRMED JUSTIFIED |
| integration-api MODULE_CONTEXT empty | Still scaffold template, only section headers | CONFIRMED EMPTY |
| json-schema-validator missing | Not in libs.versions.toml, not in any build.gradle.kts | CONFIRMED ABSENT |
| Crypto-shredding interfaces missing (Step 1 GAP-05) | No ScopeKeyManager or CryptoShredder in any module | CONFIRMED ABSENT |
| Integrity chain interfaces missing (Step 1 GAP-06) | No IntegrityChainStore or IntegrityVerifier in any module | CONFIRMED ABSENT |
| Authentication interfaces missing (Step 1 GAP-07) | rest-api and websocket-api are scaffolds with no auth types | CONFIRMED ABSENT |
| Automation handoff vs Doc 07 divergence | No divergence found — all 53 types match Doc 07 | NO DIVERGENCE |

---

## Appendix B: Methodology

**Approach:** For each of the 4 substantive modules, the audit:
1. Read the governing design document in full (sectioned reads for documents exceeding context limits)
2. Read the MODULE_CONTEXT.md for the expected type inventory
3. Read every Java source file in the module's `src/main/java` tree
4. Read `module-info.java` for JPMS declarations
5. Read `build.gradle.kts` for dependency declarations
6. Compared each type field-by-field, each method signature-by-signature, each sealed hierarchy member-by-member against the design document specifications
7. Verified cross-module imports and `requires transitive` justification

For the 10 scaffold modules: verified directory existence, checked for source files, read build.gradle.kts for dependencies, confirmed MODULE_CONTEXT.md presence.

**Tools used:** Read (file contents), Glob (file discovery), Grep (cross-file pattern matching), Agent (parallel module audits). No Java code was written or modified. No files were modified except this deliverable and the traceability documents.

**Coverage:** 109 public types across 4 substantive modules + 10 scaffold modules verified. Combined with Step 3A's 125 types, the full pre-Phase 3 audit covers **234 public types across 9 substantive modules + 10 scaffolds**.

---

*End of Step 3B Upper-Layer Fidelity Check.*
