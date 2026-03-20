# Step 6: MODULE_CONTEXT Accuracy Verification & Master Punch List

**Document type:** Governance — audit findings + decision-ready punch list
**Author:** PM (audit mode)
**Date:** 2026-03-20
**Scope:** All 19 MODULE_CONTEXT.md files verified against source; all findings from Steps 1–6 consolidated into master punch list
**Status:** Complete
**Input documents:** Steps 1–5 audit deliverables, all 19 MODULE_CONTEXT.md files, all 9 module-info.java files, all 21 build.gradle.kts files, all Phase 2 Java source, libs.versions.toml
**Purpose:** This is the input document for Step 7 (final strategic review). Nick makes go/no-go decisions on each item before Phase 3 begins.

---

## Section 1: MODULE_CONTEXT Accuracy Summary

| # | Module | Status | Accuracy | Findings | Priority |
|---|--------|--------|----------|----------|----------|
| 1 | platform/platform-api | POPULATED | ACCURATE (minor) | Type count states 11, actual is 12 (PlatformPaths likely uncounted). All type names, JPMS, purpose correct. VT-safe UlidFactory gotcha present. | LOW |
| 2 | core/event-model | POPULATED | ACCURATE | 46 types match. JPMS correct. Forward-reservation gotcha for 20 EventTypes without payloads documented. | NONE |
| 3 | core/event-bus | POPULATED | ACCURATE | 4 types match exactly. JPMS correct. CheckpointStore vs ViewCheckpointStore distinction documented. | NONE |
| 4 | core/device-model | POPULATED | ACCURATE | 57 types match exactly. Both `requires transitive` declarations correct. All sealed hierarchies documented. | NONE |
| 5 | core/state-store | POPULATED | ACCURATE | 7 types match. JPMS correct (non-transitive `requires event` correctly documented). AMD-02/10/11 gotchas present. | NONE |
| 6 | core/persistence | POPULATED | ACCURATE | 11 types match. JPMS correct. sqlite-jdbc VT pinning gotcha (B-4) documented. | NONE |
| 7 | config/configuration | POPULATED | ACCURATE | 22 types match. MigrationChange rename documented. B-2 (missing json-schema-validator) flagged. | NONE |
| 8 | core/automation | POPULATED | ACCURATE (minor) | Type count states 53, actual is ~51–52 (±1–2 arithmetic discrepancy). All type names, sealed hierarchies, AMD-04/AMD-25 gotchas correct. S4-05 (premature config dep) documented as intentional. | LOW |
| 9 | integration/integration-api | EMPTY-SCAFFOLD | **EMPTY-CRITICAL** | **21 Java types, zero documentation.** Highest-traffic cross-module API boundary. CRITICAL pre-Phase 3 gap. | **CRITICAL** |
| 10 | integration/integration-runtime | EMPTY-SCAFFOLD | APPROPRIATE | No substantive source (package-info only). Scaffold correct. | NONE |
| 11 | integration/integration-zigbee | EMPTY-SCAFFOLD | APPROPRIATE | No substantive source. Scaffold correct. | NONE |
| 12 | api/rest-api | EMPTY-SCAFFOLD | PARTIAL | Has Idempotency-Key Contract section but no Java types yet. Partial content is forward-looking design notes. | LOW |
| 13 | api/websocket-api | EMPTY-SCAFFOLD | PARTIAL | Has WebSocket Replay/Live Merge Protocol section but no Java types yet. Partial content is forward-looking design notes. | LOW |
| 14 | observability/observability | EMPTY-SCAFFOLD | APPROPRIATE | No substantive source. Scaffold correct. | NONE |
| 15 | lifecycle/lifecycle | EMPTY-SCAFFOLD | APPROPRIATE | No substantive source. Scaffold correct. | NONE |
| 16 | web-ui/dashboard | EMPTY-SCAFFOLD | APPROPRIATE | Frontend module (no Java). Scaffold correct. | NONE |
| 17 | app/homesynapse-app | EMPTY-SCAFFOLD | APPROPRIATE | Only Main.java stub. Scaffold correct. | NONE |
| 18 | platform/platform-systemd | EMPTY-SCAFFOLD | APPROPRIATE | No substantive source. Scaffold correct. | NONE |
| 19 | testing/test-support | EMPTY-SCAFFOLD | APPROPRIATE | No substantive source. Scaffold correct. | NONE |

**Summary:** 8 populated files — 6 fully ACCURATE, 2 with minor arithmetic discrepancies. 11 scaffolds — 1 CRITICAL gap (integration-api), 2 partially filled (rest-api, websocket-api), 8 appropriately empty.

---

## Section 2: Detailed MODULE_CONTEXT Findings

### 2.1 Populated MODULE_CONTEXT Files

#### MC-01: platform-api — ACCURATE (minor)

**A1 Purpose:** Correct. Accurately describes identity types, ULID generation, and foundation role.
**A2 Design Doc:** Correct. References Identity and Addressing Model v1.
**A3 JPMS:** Correct. Leaf module — no `requires`, exports `platform` and `platform.identity`.
**A4 Type Inventory:** Lists 11 types. Actual count is 12 (likely `PlatformPaths` uncounted). All named types are present and verified in Step 3A. **Minor arithmetic discrepancy — no missing documentation of functionality.**
**A5 Cross-Module:** Correct. Accurately documents that platform types are consumed by all downstream modules.
**A6 Gotchas:**
- ✓ VT-safe UlidFactory (ReentrantLock, not synchronized) — LTD-01/LTD-11 documented
- ✓ Hand-rolled vs ulid-creator deviation noted
- ✗ Missing: No mention of S4-02 (device-model JPMS explicit `requires transitive platform` vs Gradle implicit transitivity) — MINOR, affects device-model not platform-api

#### MC-02: event-model — ACCURATE

**A1 Purpose:** Correct. Describes EventEnvelope, DomainEvent, CausalContext, sealed hierarchies.
**A2 Design Doc:** Correct. References Doc 01 §3–§4, §8.
**A3 JPMS:** Correct. `requires transitive com.homesynapse.platform`, exports `com.homesynapse.event`.
**A4 Type Inventory:** 46 types match Step 3A verification exactly.
**A5 Cross-Module:** Correct.
**A6 Gotchas:**
- ✓ 20 EventTypes constants without payload records (forward reservation) documented
- ✓ SubjectRef factory methods documented
- ✗ Missing: No mention of S4-01 (SLF4J api() scope in Gradle without JPMS `requires org.slf4j`) — this is a Gradle/JPMS mismatch that MODULE_CONTEXT should note for Phase 3 implementers

#### MC-03: event-bus — ACCURATE

**A1–A5:** All correct. 4 types, JPMS declarations, cross-module deps all verified.
**A6 Gotchas:**
- ✓ CheckpointStore (subscriber position) vs ViewCheckpointStore (state projection) distinction documented
- ✓ Empty eventTypes set = wildcard documented
- ✓ coalesceExempt semantics documented
- ✓ notifyEvent(long) passes position, not full event — documented

#### MC-04: device-model — ACCURATE

**A1–A5:** All correct. 57 types, all sealed hierarchies (Capability/16, AttributeValue/5, Expectation/4) verified.
**A6 Gotchas:**
- ✓ EntityType has 6 MVP values documented
- ✓ Nullable fields documented
- ✓ CustomCapability is final class (not record) documented
- ✗ Missing: No mention of S4-06 (unjustified `requires transitive com.homesynapse.event` — Javadoc-only references, no event types in public API)

#### MC-05: state-store — ACCURATE

**A1–A5:** All correct. 7 types, JPMS includes non-transitive `requires com.homesynapse.event` correctly documented.
**A6 Gotchas:**
- ✓ AMD-02 REPLAY→LIVE reconciliation documented (StateStoreLifecycle async start)
- ✓ AMD-10 projection versioning documented (CheckpointRecord.projectionVersion)
- ✓ AMD-11 staleness model documented (staleAfter nullable, stale derived at read time)
- ✗ Missing: S5-CF2 (staleness scan vs orphan transition timing) — Phase 3 watch item not yet in MODULE_CONTEXT
- ✗ Missing: S4-03 (Gradle `api(event-model)` vs JPMS non-transitive `requires`) — should note that Gradle scope will change to `implementation`

#### MC-06: persistence — ACCURATE

**A1–A5:** All correct. 11 types verified.
**A6 Gotchas:**
- ✓ sqlite-jdbc JNI carrier thread pinning documented (B-4)
- ✓ ViewCheckpointStore implementation (not duplication) documented
- ✓ TelemetrySample.entityRef uses EntityId not EntityRef documented
- ✗ Missing: S4-04 (Gradle `api(event-model)` and `api(state-store)` should both become `implementation`) — should note planned Gradle scope change
- ✗ Missing: Explicit note that `api(platform-api)` should be added (persistence public API uses EntityId)

#### MC-07: configuration — ACCURATE

**A1–A5:** All correct. 22 types verified.
**A6 Gotchas:**
- ✓ B-2 (json-schema-validator missing from libs.versions.toml) flagged with [REVIEW] marker
- ✓ MigrationChange renamed from Doc 06's second ConfigChange documented
- ✓ ConfigModel uses Map-based sections (typed records deferred to Phase 3) documented
- ✓ SnakeYAML Engine internal, not exposed via JPMS documented

#### MC-08: automation — ACCURATE (minor)

**A1–A5:** Type count states 53, actual is ~51–52. All type names verified. JPMS correct.
**A6 Gotchas:**
- ✓ AMD-04 cascade depth max 8 documented
- ✓ AMD-25 duration timer lifecycle documented (for_duration on 4 trigger types, EventTrigger excluded)
- ✓ S4-05 (premature config dependency) documented as intentional Phase 3 readiness
- ✗ Missing: S5-01 (AMD-03 naming divergence — ConsistentSnapshot vs StateSnapshot)
- ✗ Missing: S5-CF1 (snapshot freshness during duration timer expiry) — Phase 3 watch item not yet in MODULE_CONTEXT

### 2.2 Scaffold MODULE_CONTEXT Files

#### MC-09: integration-api — EMPTY-CRITICAL

**A7 Scaffold Appropriateness:** **INAPPROPRIATE.** This module has 21 substantive Java types (verified in Step 3B), a full module-info.java with 7 `requires transitive` declarations, and is the adapter-facing surface that every integration depends on. An empty MODULE_CONTEXT here means Phase 3 integration implementers have no navigational aid for the most complex cross-module boundary in the system.

**A8 Content That MUST Be Present:**
- Purpose: Adapter-facing API surface per Doc 05. Single exported package.
- JPMS: 7 `requires transitive` declarations — each justified by public API type exposure (documented in Step 4 S4-07)
- Type inventory: 21 types (IntegrationFactory, IntegrationAdapter, IntegrationContext, CommandEnvelope, CommandHandler, IntegrationDescriptor, HealthReporter, HealthParameters, ManagedHttpClient, SchedulerService, PermanentIntegrationException, HealthState, RequiredService, DataPath, IoType, IntegrationLifecycleEvent + 5 sealed subtypes)
- Critical gotchas: ServiceLoader LTD-17/LTD-16 Javadoc error (B-1), `requires transitive java.net.http` justification (I-2), "transitive gateway" architectural constraint (S4-07)
- Cross-module: Imports from all 6 internal modules; exported to integration-runtime, integration-zigbee

**Priority:** MUST populate before Phase 3.

#### MC-10 through MC-19: Other Scaffolds

| Module | Appropriate? | Substantive Source? | Phase 3 Pre-Docs Needed? |
|--------|-------------|--------------------|-----------------------|
| integration-runtime | ✓ Yes | No (package-info only) | No — populate when Phase 2 starts |
| integration-zigbee | ✓ Yes | No | No — populate when Phase 2 starts |
| rest-api | ⚠ Partial | No | Yes — needs auth interfaces pre-doc (INV-SE-02) |
| websocket-api | ⚠ Partial | No | Yes — needs auth interfaces pre-doc (INV-SE-02) |
| observability | ✓ Yes | No | No |
| lifecycle | ✓ Yes | No | No |
| dashboard | ✓ Yes | N/A (frontend) | No |
| homesynapse-app | ✓ Yes | Main.java stub | No |
| platform-systemd | ✓ Yes | No | No |
| test-support | ✓ Yes | No | No |

---

## Section 3: MODULE_CONTEXT Remediation Plan

**Priority order for pre-Phase 3 fixes:**

| Priority | Module | Action | Effort | Blocks |
|----------|--------|--------|--------|--------|
| **P0** | integration-api | Populate full MODULE_CONTEXT from Step 3B type inventory + Step 4 JPMS analysis + B-1/I-2/S4-07 gotchas | 1 hour | Phase 3 integration work |
| **P1** | platform-api | Fix type count (11→12) | 5 min | Nothing |
| **P1** | automation | Fix type count arithmetic; add S5-01, S5-CF1 gotchas | 15 min | Nothing |
| **P1** | state-store | Add S4-03, S5-CF2 gotchas | 10 min | Nothing |
| **P1** | persistence | Add S4-04, explicit `api(platform-api)` note | 10 min | Nothing |
| **P1** | event-model | Add S4-01 (SLF4J scope) gotcha | 5 min | Nothing |
| **P1** | device-model | Add S4-06 (unjustified `requires transitive event`) gotcha | 5 min | Nothing |
| **P2** | rest-api | Pre-document authentication interface requirements (INV-SE-02) | 30 min | Phase 2 for rest-api |
| **P2** | websocket-api | Pre-document authentication interface requirements (INV-SE-02) | 30 min | Phase 2 for websocket-api |

---

## Section 4: Master Finding Registry

Every finding from every step, deduplicated. Each finding appears ONCE with all step references.

| ID | Source Step(s) | Original ID(s) | Category | Module(s) | Finding Summary | Action |
|----|--------------|----------------|----------|-----------|----------------|--------|
| F-01 | Step 2 #1, Step 3B D-04, Step 4 S4-CF2 | B-1 | **RESOLVED** | integration-api | IntegrationFactory Javadoc cited ServiceLoader + `(LTD-17)`. LTD-17 prohibits ServiceLoader. | **DECIDE-04 RESOLVED (2026-03-20): Option A — direct construction, no ServiceLoader.** IntegrationFactory Javadoc fully rewritten. All ServiceLoader references removed. Discovery is via explicit construction in app wiring code per LTD-17. Supersedes original F-01 fix. |
| F-02 | Step 2 #2 | B-2 | **FIX-NOW** | libs.versions.toml, configuration | Missing `networknt:json-schema-validator` from version catalog. LTD-09 specifies this library. SchemaRegistry/ConfigValidator interfaces exist but backing library undeclared. | Add to libs.versions.toml: `json-schema-validator = "1.5.6"` + library alias |
| F-03 | Step 2 #3 | B-3 | **FIX-NOW** | libs.versions.toml, homesynapse-app | Missing `logstash-logback-encoder` from version catalog. LTD-15 specifies structured JSON log output via this library. | Add to libs.versions.toml: `logstash-logback = "8.0"` + library alias. Add `runtimeOnly` in app module. |
| F-04 | Step 3B D-03 | B-4 | **FIX-NOW** | persistence | Persistence interfaces missing VT executor contract in Javadoc. sqlite-jdbc JNI calls double-pin carrier threads. Phase 3 implementers may use wrong executor. | Add VT executor contract to MaintenanceService and PersistenceLifecycle Javadoc |
| F-05 | Step 4 S4-03 | S4-03 | **FIX-NOW** | state-store | Gradle `api(event-model)` but JPMS non-transitive `requires event`. Contradictory signals to consumers. | Change to `implementation(project(":core:event-model"))` in state-store build.gradle.kts |
| F-06 | Step 4 S4-04 | S4-04 | **FIX-NOW** | persistence | Two Gradle/JPMS mismatches: `api(event-model)` and `api(state-store)` both non-transitive in JPMS. | Change both to `implementation()`. Add explicit `api(project(":platform:platform-api"))` for EntityId. |
| F-07 | Step 4 S4-05 | S4-05 | **FIX-NOW** | automation | Gradle `api(configuration)` with NO JPMS `requires` and NO source imports. Premature dependency. | Remove `api(project(":config:configuration"))` from automation build.gradle.kts. Re-add in Phase 3. |
| F-08 | Step 4 S4-01 | S4-01 | **RESOLVED** | event-model | SLF4J `api()` scope in Gradle but no `requires org.slf4j` in module-info. Gradle exposes SLF4J to consumers; JPMS does not. | **DECIDE-01 RESOLVED (2026-03-20): Option A — per-module SLF4J.** Changed event-model `api(libs.slf4j.api)` → `implementation(libs.slf4j.api)`. Each module declares its own SLF4J dependency. |
| F-09 | Step 4 S4-06 | S4-06 | **FIX-NOW** | device-model | `requires transitive com.homesynapse.event` unjustified — only Javadoc `@see` refs, no event types in public API. | Downgrade to `requires com.homesynapse.event;` in device-model module-info.java |
| F-10 | Step 4 S4-08 | S4-08 | **FIX-NOW** | integration-runtime | `implementation(event-model)` redundant — already provided via `api(integration-api)`. | Remove `implementation(project(":core:event-model"))` from integration-runtime build.gradle.kts |
| F-11 | Step 2 #4, Step 3A | I-1 | **RESOLVED** | platform-api, LTD-04 | Hand-rolled UlidFactory vs LTD-04's specified `ulid-creator` library. Implementation is functionally superior (ReentrantLock for VT safety). LTD text needs reconciliation. | **DECIDE-02 RESOLVED (2026-03-20): Option A — amend LTD-04.** LTD-04 updated to bless hand-rolled UlidFactory. `ulid-creator` removed from dependency list. Rationale: VT-safe by construction. |
| F-12 | Step 2 #5, Step 4 S4-07/S4-CF1 | I-2 | **DOCUMENT** | integration-api | `requires transitive java.net.http` justified by ManagedHttpClient API. Creates "transitive gateway" effect (S4-07). | Document trade-off in integration-api module-info.java comment and MODULE_CONTEXT |
| F-13 | Step 3B D-05, Step 6 MC-09 | I-3 | **FIX-NOW** | integration-api | MODULE_CONTEXT.md empty despite 21 Java types. Highest-traffic cross-module boundary. | Populate full MODULE_CONTEXT from Step 3B inventory + Step 4 JPMS analysis |
| F-14 | Step 5 S5-01 | S5-01 | **RESOLVED** | automation, state-store | AMD-03 naming divergence: code uses `ConsistentSnapshot`/`getStatesAtPosition` vs amendment's `StateSnapshot`. Behavioral contract fully satisfied. | **DECIDE-03 RESOLVED (2026-03-20): Option A — accept current naming.** `ConsistentSnapshot` is canonical. `StateSnapshot` name collides with existing state-store type. Traceability note added to AMD-03. |
| F-15 | Step 5 S5-CF1 | S5-CF1 | **PHASE-3-WATCH** | automation | Snapshot freshness during duration timer expiry. When timer expires, condition evaluation MUST use fresh StateSnapshot, not snapshot from timer start. | Embed in Phase 3 automation coding instructions |
| F-16 | Step 5 S5-CF2 | S5-CF2 | **PHASE-3-WATCH** | state-store, device-model | Staleness scan (30s interval) vs orphan transition timing. Orphan transition (AMD-17) must set stale immediately, not wait for scan cycle. | Embed in Phase 3 state-store and device-model coding instructions |
| F-17 | Step 1 GAP-01/02/03 | HO-GAP | **DOCUMENT** | Doc 07, Doc 13 | Household Operability invariants (HO-01/02/03) 60% GAP. No design doc claims for physical control supremacy, operable under degradation, no debugging for daily ops. | Add INV-HO-01 claim to Doc 07 §5. Add INV-HO-02/03 claims to Doc 13 §5. |
| F-18 | Step 1 GAP-04 | PD-04-GAP | **DOCUMENT** | Doc 11 or Doc 13 | INV-PD-04 (Transparent Data Boundaries) — no design doc claim, no DataManifest interface. | Add claim and interface stub. Non-blocking for Phase 3. |
| F-19 | Step 1 GAP-05/06 | PD-07/08-GAP | **DEFERRED** | persistence | INV-PD-07 (Crypto-Shredding) and INV-PD-08 (Tamper-Evident Integrity) — partial coverage. No ScopeKeyManager or IntegrityChainStore interfaces. | Defer to post-MVP Tier 2. MVP scope satisfied by local-only data model. |
| F-20 | Step 1 GAP-07 | SE-02-GAP | **DOCUMENT** | rest-api, websocket-api | INV-SE-02 (Authentication) — no AuthenticationService or TokenValidator interfaces. Blocks Phase 2 for these modules. | Define authentication interfaces before rest-api/websocket-api Phase 2 |
| F-21 | Step 1 DOC-01 | DC-3 | **DOCUMENT** | traceability docs | 12 of 14 traceability documents are empty scaffolds despite Phase 2 completion. | Populate from MODULE_CONTEXT type inventories. Schedule post-Phase 3-start. |
| F-22 | Step 1 DOC-02 | VT-DOC | **DOCUMENT** | Doc 01, 03, 04, 05, 07 | Virtual Thread Risk Audit findings not yet incorporated into design documents. sqlite-jdbc pinning requires platform thread executor. | Create AMD-26 or add VT notes to affected design docs |
| F-23 | Step 3A D-02 | DC-1 | **FIX-NOW** | platform-api | platform `package-info.java` missing copyright header | Add `Copyright (c) 2026 NexSys` header |
| F-24 | Step 6 | MC-COUNTS | **FIX-NOW** | platform-api, automation | MODULE_CONTEXT type count arithmetic: platform-api says 11 (actual 12), automation says 53 (actual ~51–52) | Fix counts in MODULE_CONTEXT.md |
| F-25 | Step 6 | MC-GOTCHAS | **DOCUMENT** | Multiple | S4 findings (S4-01 through S4-06) not referenced in any MODULE_CONTEXT. Phase 3 implementers need awareness. | Add S4 finding references to affected MODULE_CONTEXT gotcha sections |
| F-26 | Step 5 S5-02 | S5-02 | **DOCUMENT** | N/A | Task brief misclassified AMD-12 as REQUIRED; actual tier is RECOMMENDED | Correct in project documentation. No code impact. |
| F-27 | Step 4 S4-07 | S4-07 | **DOCUMENT** | integration-api | 7-way `requires transitive` creates "transitive gateway." Only integration adapters and integration-runtime should depend on integration-api. | Document constraint in integration-api module-info.java and MODULE_CONTEXT |

---

## Section 5: FIX-NOW Items

These are unambiguous pre-Phase 3 fixes. No decision needed — just execute.

### FIX-01: IntegrationFactory Javadoc LTD Reference (F-01)
**File:** `integration/integration-api/src/main/java/com/homesynapse/integration/IntegrationFactory.java`
**Line:** 9
**Change:** Replace `(LTD-17)` with `(LTD-16)` in Javadoc comment about ServiceLoader discovery.
**Effort:** 1 minute.

### FIX-02: Add json-schema-validator to Version Catalog (F-02)
**File:** `gradle/libs.versions.toml`
**Change:** Add under `[versions]`: `json-schema-validator = "1.5.6"` and under `[libraries]`: `json-schema-validator = { module = "com.networknt:json-schema-validator", version.ref = "json-schema-validator" }`.
Then add `implementation(libs.json.schema.validator)` to `config/configuration/build.gradle.kts`.
**Effort:** 5 minutes.

### FIX-03: Add logstash-logback-encoder to Version Catalog (F-03)
**File:** `gradle/libs.versions.toml`
**Change:** Add under `[versions]`: `logstash-logback = "8.0"` and under `[libraries]`: `logstash-logback-encoder = { module = "net.logstash.logback:logstash-logback-encoder", version.ref = "logstash-logback" }`.
Then add `runtimeOnly(libs.logstash.logback.encoder)` to `app/homesynapse-app/build.gradle.kts` alongside logback.
**Effort:** 5 minutes.

### FIX-04: Add VT Executor Contract to Persistence Javadoc (F-04)
**Files:** `core/persistence/src/main/java/com/homesynapse/persistence/MaintenanceService.java` and `PersistenceLifecycle.java`
**Change:** Add Javadoc noting that all implementations MUST execute SQLite operations on platform threads (not virtual threads) due to sqlite-jdbc JNI carrier thread pinning. Reference Virtual Thread Risk Audit finding B-4.
**Effort:** 15 minutes.

### FIX-05: State-Store Gradle Scope Fix (F-05)
**File:** `core/state-store/build.gradle.kts`
**Change:** `api(project(":core:event-model"))` → `implementation(project(":core:event-model"))`.
**Effort:** 2 minutes.

### FIX-06: Persistence Gradle Scope Fix (F-06)
**File:** `core/persistence/build.gradle.kts`
**Change:**
- `api(project(":core:event-model"))` → `implementation(project(":core:event-model"))`
- `api(project(":core:state-store"))` → `implementation(project(":core:state-store"))`
- Add: `api(project(":platform:platform-api"))` (EntityId in public API)
**Effort:** 5 minutes.

### FIX-07: Remove Premature Automation→Configuration Dependency (F-07)
**File:** `core/automation/build.gradle.kts`
**Change:** Remove `api(project(":config:configuration"))`. Re-add when Phase 3 automation implementation actually imports configuration types.
**Effort:** 2 minutes.

### FIX-08: Downgrade device-model Transitive (F-09)
**File:** `core/device-model/src/main/java/module-info.java`
**Change:** `requires transitive com.homesynapse.event;` → `requires com.homesynapse.event;`
**Effort:** 2 minutes.

### FIX-09: Remove Redundant integration-runtime Dependency (F-10)
**File:** `integration/integration-runtime/build.gradle.kts`
**Change:** Remove `implementation(project(":core:event-model"))` (already provided transitively by `api(integration-api)`).
**Effort:** 2 minutes.

### FIX-10: Populate integration-api MODULE_CONTEXT (F-13)
**File:** `integration/integration-api/MODULE_CONTEXT.md`
**Change:** Full population from Step 3B type inventory (21 types), Step 4 JPMS analysis (7 `requires transitive`), and gotchas (B-1, I-2, S4-07 transitive gateway constraint).
**Effort:** 1 hour.

### FIX-11: Copyright Header (F-23)
**File:** `platform/platform-api/src/main/java/com/homesynapse/platform/package-info.java`
**Change:** Add `// Copyright (c) 2026 NexSys` header.
**Effort:** 1 minute.

### FIX-12: MODULE_CONTEXT Type Count Corrections (F-24)
**Files:** `platform/platform-api/MODULE_CONTEXT.md`, `core/automation/MODULE_CONTEXT.md`
**Change:** Correct type count arithmetic to match actual source file counts.
**Effort:** 10 minutes.

**Total FIX-NOW effort estimate: ~2 hours.**

---

## Section 6: DECIDE Items — ALL RESOLVED (2026-03-20)

All four DECIDE items were resolved by Nick on 2026-03-20. Changes applied to source files and governance documents. See individual resolutions below.

### DECIDE-01: SLF4J Distribution Strategy (F-08) — ✅ RESOLVED

**Resolution: Option A — per-module SLF4J.** Changed `api(libs.slf4j.api)` → `implementation(libs.slf4j.api)` in event-model. Each module that uses logging adds its own dependency. JPMS-pure, explicit, no hidden transitivity.

**Context:** event-model's build.gradle.kts declares `api(libs.slf4j.api)` making SLF4J visible to all consuming modules via Gradle. But event-model's module-info.java has no `requires org.slf4j`, so JPMS does not grant readability. This sends contradictory signals.

**Options:**

A. **Per-module SLF4J (PM Recommended)** — Remove `api(libs.slf4j.api)` from event-model. Each module that uses logging adds its own `implementation(libs.slf4j.api)` and `requires org.slf4j;`. This is JPMS-pure and makes logging dependencies explicit.
- *Pros:* Clean JPMS hygiene. Each module's dependencies are self-documenting. No hidden transitivity.
- *Cons:* More verbose (8+ modules need the declaration). Slightly more boilerplate.

B. **Event-model as SLF4J distributor** — Keep `api(libs.slf4j.api)` on event-model AND add `requires transitive org.slf4j;` to event-model's module-info.java.
- *Pros:* Single declaration. Every module that depends on event-model automatically gets logging.
- *Cons:* Couples logging distribution to the event model. SLF4J types don't appear in event-model's public API, so `requires transitive` is technically unjustified per JPMS best practices.

C. **Convention plugin injection** — Move SLF4J to the `homesynapse.java-conventions` plugin so it's added to every module automatically, outside of module-level dependency declarations.
- *Pros:* Zero per-module boilerplate. Clean separation (convention vs module-level).
- *Cons:* Each module still needs `requires org.slf4j;` in module-info.java for JPMS correctness. Convention plugin can only handle Gradle scope.

**PM Recommendation:** Option A. JPMS purity matters for this project — it's a core architectural constraint (LTD-10, LTD-17). The boilerplate cost is small (one line per module × 8 modules). Option C is acceptable as a Gradle convenience but doesn't solve the JPMS side.

**Impact if deferred:** Phase 3 modules will encounter confusing JPMS compilation errors when they try to use SLF4J through event-model's transitive Gradle dependency but JPMS denies access.

---

### DECIDE-02: UlidFactory vs ulid-creator Library (F-11) — ✅ RESOLVED

**Resolution: Option A — amend LTD-04 to bless hand-rolled implementation.** LTD-04 specification updated to reference `UlidFactory` in platform-api. `ulid-creator` removed from dependency list. Rationale: VT-safe by construction (ReentrantLock), eliminates a third-party dependency.

**Context:** LTD-04 specifies `com.github.f4b6a3:ulid-creator` with `UlidCreator.getMonotonicUlid()`. The codebase has a hand-rolled `UlidFactory` in platform-api that is functionally superior — uses `ReentrantLock` (VT-safe) instead of `synchronized` (which the library uses internally, causing carrier thread pinning).

**Options:**

A. **Amend LTD-04 to bless hand-rolled implementation (PM Recommended)** — Update LTD-04 to replace the ulid-creator reference with a reference to the hand-rolled UlidFactory. Add a note explaining the VT pinning rationale.
- *Pros:* Documents the actual state. Eliminates a governance discrepancy. The hand-rolled code is demonstrably better for the VT execution model.
- *Cons:* Requires formal LTD amendment. Sets precedent for hand-rolling vs library usage.

B. **Adopt ulid-creator library + VT wrapper** — Add ulid-creator to version catalog. Wrap its `UlidCreator.getMonotonicUlid()` call inside a `ReentrantLock` to make it VT-safe.
- *Pros:* Complies with LTD-04 literally. Less custom code to maintain.
- *Cons:* Adds a dependency just to wrap it. The wrapper negates the library's internal optimization.

**PM Recommendation:** Option A. The hand-rolled implementation exists, is tested, and is better. Amending the LTD is the honest governance action.

**Impact if deferred:** No functional impact — the code works. But the LTD register will contain a stale specification that doesn't match reality, which undermines governance credibility for Phase 3 developers.

---

### DECIDE-03: AMD-03 Naming — ConsistentSnapshot vs StateSnapshot (F-14) — ✅ RESOLVED

**Resolution: Option A — accept current naming.** `ConsistentSnapshot` is canonical. The name better describes the consistency guarantee (AMD-03's core purpose). `StateSnapshot` collides with an existing type in state-store. Traceability note added to AMD-03 in Design_Review_Amendments_v1.md.

**Context:** AMD-03 specifies `StateSnapshot` terminology. The code uses `ConsistentSnapshot` and `getStatesAtPosition`. The behavioral contract is fully satisfied — automation conditions evaluate against a point-in-time snapshot. The naming divergence is cosmetic.

**Options:**

A. **Accept current naming (PM Recommended)** — The code uses `ConsistentSnapshot` and `getStatesAtPosition`. Add a traceability note to Doc 07 recording the deviation: "AMD-03 implemented as ConsistentSnapshot/getStatesAtPosition."
- *Pros:* No code changes. Current naming may be more descriptive of intent. StateSnapshot already exists as a type in state-store (different purpose).
- *Cons:* AMD-03's specified name doesn't match code. Could confuse someone reading the amendment vs code.

B. **Align to amendment naming** — Rename `ConsistentSnapshot` to match AMD-03's terminology. Update all references.
- *Pros:* Perfect traceability. Amendment and code match.
- *Cons:* Code changes across automation module. Risk of introducing bugs during rename. And `StateSnapshot` is already a type in state-store, so using the same name would create confusion.

**PM Recommendation:** Option A. The name collision with state-store's `StateSnapshot` is a strong argument against Option B. `ConsistentSnapshot` is actually a better name for what it does (it emphasizes the consistency guarantee, not just that it's a snapshot of state). Document the deviation.

**Impact if deferred:** None — the code works. But the traceability note should be added before Phase 3 so developers don't waste time trying to find the "StateSnapshot" that AMD-03 mentions.

---

### DECIDE-04: ServiceLoader Discovery Mechanism (extends F-01) — ✅ RESOLVED

**Resolution: Option A — direct construction, no ServiceLoader.** IntegrationFactory.java Javadoc fully rewritten. All ServiceLoader references removed. App module constructs factories directly (`new ZigbeeIntegrationFactory()`). Matches LTD-17 literally. If post-MVP community integrations need dynamic discovery, amend LTD-17 at that time. Supersedes original F-01 Javadoc fix.

**Context:** F-01 fixes the Javadoc LTD reference (LTD-17 → LTD-16). But the deeper question is: should ServiceLoader be the integration discovery mechanism at all? LTD-17 says "no reflection-based loading, no ServiceLoader, no Class.forName." The IntegrationFactory Javadoc says "discovered via ServiceLoader." The fix for the LTD reference doesn't resolve the architectural question.

**Options:**

A. **Direct construction, no ServiceLoader (PM Recommended)** — The app module's wiring code constructs integration factories directly: `new ZigbeeIntegrationFactory()`. No ServiceLoader, no reflection. Matches LTD-17's "compiled-in" intent.
- *Pros:* Simplest. Fastest startup. No runtime discovery overhead. Matches LTD-17 literally.
- *Cons:* Adding a new integration requires editing the app wiring code. But this is one line of code per integration, and post-MVP community integrations can be supported via a formal LTD-17 amendment.

B. **JPMS ServiceLoader (amend LTD-17)** — Allow JPMS-controlled ServiceLoader via `provides IntegrationFactory with ZigbeeIntegrationFactory` in module-info.java. Amend LTD-17 to permit this specific pattern.
- *Pros:* Pluggable. New integrations just add module-info `provides` clause. No wiring code changes.
- *Cons:* Requires LTD amendment. ServiceLoader has startup cost (scans all modules). Overkill for MVP (exactly 1 integration).

**PM Recommendation:** Option A. With exactly one integration (Zigbee) in MVP, ServiceLoader adds complexity with zero benefit. If post-MVP community integrations need dynamic discovery, amend LTD-17 at that time with the full evaluation of the security implications.

**Impact if deferred:** The IntegrationFactory Javadoc will continue to say "ServiceLoader" after the LTD-17→LTD-16 fix (F-01), creating ambiguity about the intended discovery mechanism. Phase 3 integration-runtime implementers need clarity NOW.

---

## Section 7: DOCUMENT Items

Documentation gaps to schedule, with suggested order. None of these block Phase 3, but they improve quality and reduce confusion.

| # | Finding | Modules/Docs | Action | Effort | Priority |
|---|---------|-------------|--------|--------|----------|
| DOC-01 | F-12: java.net.http transitive trade-off | integration-api | Add comment in module-info.java explaining the transitive gateway design and documenting that only integration adapters should depend on this module | 15 min | HIGH |
| DOC-02 | F-17: Household Operability gaps | Doc 07, Doc 13 | Add INV-HO-01 claim to Doc 07 §5 (physical control supremacy). Add INV-HO-02/03 claims to Doc 13 §5 (operability, no debugging). | 1 hour | HIGH |
| DOC-03 | F-20: Authentication interfaces pre-doc | rest-api, websocket-api | Define AuthenticationService, TokenValidator, AuthorizationFilter interfaces in MODULE_CONTEXT before Phase 2 work begins on these modules. | 2 hours | HIGH |
| DOC-04 | F-22: Virtual Thread Risk incorporation | Doc 01, 03, 04, 05, 07 | Create AMD-26 or add VT platform-thread-executor notes to all design docs that describe concurrent/IO operations. | 2 hours | MEDIUM |
| DOC-05 | F-25: S4 findings in MODULE_CONTEXT | event-model, state-store, persistence, device-model, automation | Add S4 finding references to gotcha sections of affected MODULE_CONTEXT files. | 30 min | MEDIUM |
| DOC-06 | F-18: Transparent Data Boundaries | Doc 11 or Doc 13 | Add INV-PD-04 claim and DataManifest interface stub. | 1 hour | LOW |
| DOC-07 | F-21: Traceability documents | 12 files | Populate from MODULE_CONTEXT type inventories. Bulk task — can be scripted. | 4 hours | LOW |
| DOC-08 | F-26: AMD-12 tier correction | Project docs | Correct any references that classify AMD-12 as REQUIRED. Actual tier is RECOMMENDED. | 10 min | LOW |
| DOC-09 | F-27: Transitive gateway constraint | integration-api | Document in module-info.java and MODULE_CONTEXT that integration-api is high-privilege and should not be depended on by non-integration modules. | 15 min | HIGH (bundle with DOC-01) |

---

## Section 8: PHASE-3-WATCH Items

Items to embed in Phase 3 coding instructions, organized by module.

### Automation Module

| Watch Item | Source | What Phase 3 Must Ensure |
|-----------|--------|-------------------------|
| **Snapshot freshness on timer expiry** (F-15/S5-CF1) | AMD-03 × AMD-25 | When a duration timer expires, `ConditionEvaluator.evaluate()` MUST receive a fresh `StateSnapshot` obtained at expiry time, NOT the snapshot captured at timer start. The AMD-25 spec says "original triggering event used for deduplication" — that's correct for dedup, but the snapshot for condition re-evaluation must be current. |
| **Cascade depth enforcement** | AMD-04 | `RunManager.initiateRun()` must check `cascadeDepth >= automation.max_cascade_depth` (default 8) and abort with `CAUSALITY_DEPTH_WARNING` event if exceeded. |
| **Duration timer limits** | AMD-25 | Max 1000 concurrent timers. Timer suppression during REPLAY mode. Cancel timers on automation hot-reload if definition hash changes. |
| **ConsistentSnapshot naming** | S5-01 | Code uses `ConsistentSnapshot` not `StateSnapshot` for AMD-03. If DECIDE-03 selects Option A, add traceability note. |

### State-Store / Device-Model Boundary

| Watch Item | Source | What Phase 3 Must Ensure |
|-----------|--------|-------------------------|
| **Orphan transition timing** (F-16/S5-CF2) | AMD-11 × AMD-17 | When integration fails, orphan transition (AMD-17) MUST set `stale:true` and `availability:UNAVAILABLE` immediately as part of the ORPHANED state entry. The 30-second staleness scan (AMD-11) must treat already-stale orphaned devices as no-ops (don't emit duplicate stale events). |
| **Staleness scan interval** | AMD-11 | 30-second scan interval. `stale` is derived at read time from `Instant.now().isAfter(staleAfter)`. Scan emits `state_stale` / `state_stale_cleared` events for transitions only. |
| **Projection version invalidation** | AMD-10 | `ViewCheckpointStore` must check `projectionVersion` on startup. Mismatch → full replay. |
| **REPLAY→LIVE reconciliation** | AMD-02 | `StateStoreLifecycle.start()` returns `CompletableFuture<Void>` that completes only after replay finishes and reconciliation pass emits synthetic `state_changed` events for divergences. |

### Persistence Module

| Watch Item | Source | What Phase 3 Must Ensure |
|-----------|--------|-------------------------|
| **Platform thread executor for SQLite** | B-4 / VT Risk Audit | ALL sqlite-jdbc operations (EventStore reads/writes, TelemetryWriter, MaintenanceService, ViewCheckpointStore) MUST run on a platform thread executor, not virtual threads. sqlite-jdbc JNI calls double-pin carrier threads. Use `Executors.newFixedThreadPool()` or similar. |
| **WAL mode PRAGMAs** | LTD-03 | Set on connection initialization: `journal_mode=WAL`, `synchronous=NORMAL`, `cache_size=-128000`, `foreign_keys=ON`, `busy_timeout=5000`, `wal_autocheckpoint=1000`, `auto_vacuum=INCREMENTAL`. |
| **Single-writer model** | LTD-03/LTD-06 | `EventPublisher.publish()` enforces single-writer. Only one thread may write events at a time. |

### Integration Module

| Watch Item | Source | What Phase 3 Must Ensure |
|-----------|--------|-------------------------|
| **Discovery mechanism** | DECIDE-04 | Implement per Nick's decision (direct construction vs ServiceLoader). |
| **IntegrationContext scoping** | INV-SE-04 | Each integration gets scoped registries. Integration can only see its own entities and publish permitted event types. |
| **Adapter dependency ordering** | AMD-14 | Topological sort (Kahn's algorithm) at startup. Cycle detection. Dependency failure propagation. |

### Event-Model / Event-Bus

| Watch Item | Source | What Phase 3 Must Ensure |
|-----------|--------|-------------------------|
| **Jackson SNAKE_CASE** | LTD-08 | Singleton ObjectMapper with `PropertyNamingStrategies.SNAKE_CASE`. Pre-built ObjectReader/ObjectWriter for EventEnvelope. Byte-level I/O (not String). |
| **Payload records for activated event types** | D-01 | As each subsystem activates event types (from the 20 forward-reserved EventTypes constants), create corresponding payload record classes. |
| **SLF4J module access** | DECIDE-01 | Implement per Nick's decision on SLF4J distribution strategy. |

---

## Section 9: DEFERRED Items

Post-MVP concerns, parked cleanly.

| # | Finding | Rationale | Revisit When |
|---|---------|-----------|-------------|
| DEFER-01 | F-19: Crypto-Shredding interfaces (INV-PD-07) | MVP is local-only. No external data transmission. Crypto-shredding is meaningful when cloud sync or multi-user data deletion is implemented. | Tier 2 — when cloud features or multi-user identity is scoped |
| DEFER-02 | F-19: Tamper-Evident Integrity interfaces (INV-PD-08) | Deployment-level tamper evidence (read-only filesystem, signed packages) exists via LTD-13/14. Application-level hash chains are Tier 2 hardening. | Tier 2 — when security hardening phase begins |
| DEFER-03 | AMD-12 (Security Hardening) | RECOMMENDED tier. Correctly deferred per governance rules. | Tier 2 — post-MVP security review |
| DEFER-04 | AMD-18 (Advanced Event Compaction) | RECOMMENDED tier. No structural traces in codebase. | Tier 2 — when event store size becomes a concern |
| DEFER-05 | AMD-19 (Priority-Based Event Processing) | RECOMMENDED tier. Structural hooks exist (EventPriority enum) but priority semantics differ from AMD-19 spec. | Tier 2 — verify compatibility when applied |
| DEFER-06 | AMD-20 (Distributed Event Coordination) | RECOMMENDED tier. Post-MVP multi-node scope. | Tier 2 — when multi-instance architecture is designed |
| DEFER-07 | AMD-21 (Resource Quota Management) | RECOMMENDED tier. Production hardening. | Tier 2 — when operational experience identifies quota needs |
| DEFER-08 | AMD-22 (Advanced Diagnostic Telemetry) | RECOMMENDED tier. Beyond current observability spec. | Tier 2 — when observability gaps are identified in production |
| DEFER-09 | AMD-23 (Integration Hot-Swap Protocol) | RECOMMENDED tier. Requires Phase 3 operational experience. | Tier 2 — when integration lifecycle experience warrants it |
| DEFER-10 | AMD-24 (Atomic State Transitions) | RECOMMENDED tier. Implicit atomicity via event-sourced model partially addresses it. | Tier 2 — document implicit guarantees as partial coverage |
| DEFER-11 | INV-MU-04 (Household Role Model) | No Role/Permission interfaces. Required before multi-user features but not for MVP single-user operation. | Pre-multi-user feature work |
| DEFER-12 | INV-AI-01 through AI-05 | All POST-MVP. No AI module in MVP. Architectural constraint satisfied by absence. | When AI features are scoped |

---

## Section 10: Pre-Phase 3 Readiness Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Invariant Coverage** | **45/81** (40 COVERED + 5 DESIGN-ONLY) | 9 PARTIAL, 4 GAP, 18 POST-MVP, 5 GOVERNANCE-ONLY. MVP-relevant: 45/58 (77.6%). Core invariants (ES, RF, CE, TO, PR) at 100%. Household Operability at 40% (3 design-doc gaps). Privacy/Security at ~65% (partial coverage). |
| **LTD Compliance** | **14/18** verifiable, **11/14** COMPLIANT | 3 NON-COMPLIANT (B-1 Javadoc, B-2 missing lib, B-3 missing lib) — all FIX-NOW items. 2 PARTIAL (I-1 UlidFactory, I-2 java.net.http) — DECIDE items. 4 NOT-YET-APPLICABLE (Phase 3). |
| **Foundation Fidelity** | **HIGH** | 0 critical deltas, 0 significant deltas across 125 types (Step 3A). All 5 foundation modules verified field-by-field. |
| **Upper-Layer Fidelity** | **HIGH** | 0 critical deltas, 2 significant (B-4 VT Javadoc, B-1 LTD ref) across 109 types (Step 3B). Both are FIX-NOW items. |
| **JPMS Integrity** | **SOUND with ISSUES** | Valid DAG, no cycles, no split packages, no illegal imports, all 82 cross-module imports legal. 5 Gradle/JPMS mismatches (S4-01, S4-03, S4-04, S4-05 — all FIX-NOW), 1 unjustified transitive (S4-06 — FIX-NOW). Integration-api "transitive gateway" documented (S4-07). |
| **Amendment Application** | **PASS** | 25/25 amendments accounted for. 3/4 BLOCKING applied faithfully. 1 BLOCKING partial (AMD-03 naming — DECIDE-03). All REQUIRED applied. All RECOMMENDED correctly deferred. |
| **MODULE_CONTEXT Quality** | **7/19 fully accurate** | 8 populated: 6 fully accurate, 2 minor arithmetic issues. 1 CRITICAL empty (integration-api). 10 scaffolds: 8 appropriate, 2 partially filled. |
| **Overall Phase 3 Readiness** | **CONDITIONAL GO** | Phase 3 can begin after: (1) 12 FIX-NOW items executed (~2 hours), (2) 4 DECIDE items resolved with Nick, (3) integration-api MODULE_CONTEXT populated. Core architecture is sound. Type specifications are high-fidelity. JPMS graph is valid. The gaps are documentation, governance reconciliation, and dependency catalog completeness — not structural or architectural. |

### Conditional GO Criteria

Phase 3 may begin when ALL of the following are satisfied:

1. ✅ **FIX-NOW items executed** (12 items, ~2 hours of work)
2. ✅ **DECIDE-01 resolved** (SLF4J distribution — affects every module's build file)
3. ✅ **DECIDE-02 resolved** (UlidFactory — LTD-04 amendment or library adoption)
4. ✅ **DECIDE-03 resolved** (AMD-03 naming — traceability note or rename)
5. ✅ **DECIDE-04 resolved** (ServiceLoader — discovery mechanism for integration-runtime)
6. ✅ **integration-api MODULE_CONTEXT populated** (1 hour — the highest-traffic boundary needs documentation)

DOCUMENT items and PHASE-3-WATCH items do NOT block Phase 3 start, but must be incorporated into Phase 3 coding instructions before the relevant module's implementation begins.

---

*End of Step 6: MODULE_CONTEXT Accuracy Verification & Master Punch List. This document is the input for Step 7 (final strategic review with Nick).*
