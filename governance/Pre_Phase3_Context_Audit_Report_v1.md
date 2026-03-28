# Pre-Phase 3 Context Integrity Audit Report

**Date:** 2026-03-27
**Auditor:** PM Agent (independent verification)
**Scope:** Knowledge Primer (`homesynapse-mental-model.md`), root context files (`CONTEXT.md`, `ARCHITECTURE.md`), and all 16 populated `MODULE_CONTEXT.md` files
**Method:** Every claim verified against (1) authoritative design documents, (2) governance files (LTDs, INVs), and (3) actual Java source code in `homesynapse-core`
**Purpose:** Ensure no contaminated foundations enter Phase 3 sessions

---

## Executive Summary

The audit examined 19 context files containing the project's persistent agent memory. These files are read at the start of every Coder and PM session — errors here silently contaminate every downstream instruction and every line of Phase 3 code.

**Results:**
- **7 findings require correction before Phase 3 begins** (CRITICAL or HIGH severity)
- **4 findings should be corrected** (MEDIUM severity)
- **6 findings are cosmetic** (LOW severity — file counts, minor wording)
- **3 design document staleness issues** discovered as side-effects (not in context files, but in the design docs themselves)

The foundation modules (event-model, event-bus) are **clean**. The most dangerous errors are in the Knowledge Primer's concurrency model, the device-model JPMS declaration, and the persistence module's dependency scope claims.

---

## CRITICAL Findings (Must Fix Before Phase 3)

### C-01: Mental Model — sqlite-jdbc JNI Pinning Omission

**File:** `nexsys-coder/references/homesynapse-mental-model.md` §5
**Claim:** "Virtual threads for everything except serial I/O"
**Reality:** Every SQLite operation via xerial sqlite-jdbc uses `synchronized native` methods that permanently pin carrier threads. This affects EventPublisher.publish() (the core write path), every State Projection write, every EventStore query, and every persistence maintenance operation.
**Source:** `Virtual_Thread_Risk_Audit_Report.md` findings C-02, C-03, C-05 through C-08
**Impact:** A Coder reading this mental model will assume database operations are safe on virtual threads. They are not. The Coder will write subscribers that perform database I/O on virtual threads without platform-thread isolation, leading to carrier starvation on the Pi's 4 carrier threads.
**Fix:** Add a subsection to §5 documenting sqlite-jdbc JNI pinning, reference AMD-26/AMD-27 mitigations, and state that all database-accessing code paths must use a platform-thread executor.

### C-02: Mental Model — Events Table Schema Error

**File:** `nexsys-coder/references/homesynapse-mental-model.md` §6
**Claim:** The events table schema shown in §6 omits `actor_ref` and `event_category` columns. The text implies these are "missing from table."
**Reality:** Design Doc 01 §4.2 specifies both `actor_ref BLOB(16)` (nullable) and `event_category TEXT NOT NULL` (JSON array) as columns in the events table.
**Source:** Design Doc 01 §4.2, Architecture Invariants INV-MU-01 (requires actor_ref indexing)
**Impact:** A Coder implementing the persistence layer or writing queries will build the wrong schema, missing the actor_ref index required by INV-MU-01 and the event_category column needed for consent-scope filtering.
**Fix:** Add `actor_ref BLOB(16)` and `event_category TEXT NOT NULL` to the CREATE TABLE statement in §6. Remove any implication that these are absent.

### C-03: Device-Model MODULE_CONTEXT — JPMS `requires transitive` Error

**File:** `core/device-model/MODULE_CONTEXT.md` lines 19-24 and Gotcha line 251
**Claim:** `requires transitive com.homesynapse.event` (both in the JPMS section and the Gotcha)
**Reality:** Actual `module-info.java` declares `requires com.homesynapse.event` (non-transitive)
**Source:** `core/device-model/src/main/java/module-info.java`
**Impact:** The MODULE_CONTEXT tells the Coder that any module depending on device-model automatically gets event-model types (EventEnvelope, EventPublisher, etc.). This is false. Modules that need event-model types must declare their own dependency. A Coder trusting this claim will produce code that fails to compile with "package com.homesynapse.event is not visible" errors.
**Fix:** Change `requires transitive com.homesynapse.event` to `requires com.homesynapse.event` in both the JPMS section and the Gotcha. Update the Gotcha text to reflect that ONLY platform-api is transitive.

### C-04: Persistence MODULE_CONTEXT — Gradle Dependency Scope Error

**File:** `core/persistence/MODULE_CONTEXT.md` lines 75-83
**Claim:** `api(project(":core:event-model"))` and `api(project(":core:state-store"))`
**Reality:** Actual `build.gradle.kts` uses `implementation(project(":core:event-model"))` and `implementation(project(":core:state-store"))`
**Source:** `core/persistence/build.gradle.kts` lines 8-10
**Impact:** The MODULE_CONTEXT states "The api scope for event-model and state-store ensures types are transitively available to consumers." This is factually wrong — `implementation` scope makes types NOT transitively visible. Any module depending on persistence will NOT automatically get event-model or state-store types. A Coder trusting this will write code that compiles locally but fails in the module graph.
**Fix:** Change `api` to `implementation` in the documented Gradle dependencies. Update the explanatory text to match.
**Additional finding:** `api(project(":platform:platform-api"))` exists in the actual build.gradle.kts but is undocumented in MODULE_CONTEXT.

---

## HIGH Severity Findings (Fix Before Phase 3)

### H-01: Mental Model — Phantom Type `ConfigurationProvider`

**File:** `nexsys-coder/references/homesynapse-mental-model.md` §8, Subsystem 06
**Claim:** Key interfaces listed as `ConfigurationProvider, SchemaRegistry`
**Reality:** No `ConfigurationProvider` interface exists. Actual interfaces are `ConfigurationService`, `ConfigurationAccess`, and `SchemaRegistry`.
**Source:** `config/configuration/MODULE_CONTEXT.md`, actual Java source files
**Impact:** A Coder referencing the subsystem map will search for `ConfigurationProvider` and find nothing, causing confusion or invention of a phantom type.
**Fix:** Replace `ConfigurationProvider` with `ConfigurationService, ConfigurationAccess` in §8.

### H-02: Mental Model — EventId Location Error

**File:** `nexsys-coder/references/homesynapse-mental-model.md` §9
**Claim:** "Identity types (shared identity module): EntityId, DeviceId, EventId, AutomationId, PersonId, HomeId, AreaId"
**Reality:** EventId lives in `com.homesynapse.event` (event-model module), NOT in `com.homesynapse.platform.identity` (platform-api).
**Source:** `platform/platform-api/MODULE_CONTEXT.md` Gotcha section explicitly documents this: "EventId is NOT in this module."
**Impact:** A Coder importing identity types will add `import com.homesynapse.platform.identity.EventId` — which doesn't exist. Or worse, they'll assume event-model is unnecessary if they have platform-api.
**Fix:** Move EventId out of the "Identity types" list and into the "Event types" list where it belongs. Add a note: "EventId lives in event-model, not platform-api, despite being a typed ULID wrapper."

### H-03: Platform-API MODULE_CONTEXT — Wrong LTD Citation

**File:** `platform/platform-api/MODULE_CONTEXT.md` line 90
**Claim:** "LTD-11 | No synchronized — use ReentrantLock for virtual thread compatibility"
**Reality:** LTD-11 is "No External Message Broker" (in-process event dispatch). The ReentrantLock constraint is specified within LTD-04 and the Virtual Thread Risk Audit.
**Source:** `HomeSynapse_Core_Locked_Decisions.md` lines 378-401 (LTD-11 definition)
**Impact:** A Coder or PM looking up LTD-11 to understand the synchronization constraint will find an unrelated decision about message brokers. This breaks the traceability chain.
**Fix:** Change "LTD-11" to the correct constraint identifier. Reference LTD-04 and the Virtual Thread Risk Audit.

---

## MEDIUM Severity Findings (Should Fix)

### M-01: Mental Model — `current_brightness` Phantom Attribute

**File:** `nexsys-coder/references/homesynapse-mental-model.md` §3
**Claim:** "A brightness capability guarantees specific attributes (current_brightness, min, max)"
**Reality:** The attribute key is `brightness`, not `current_brightness`. There are no `min` or `max` named attributes — the range is defined in `AttributeSchema` (minimum/maximum/step).
**Source:** Design Doc 02 §3.5, `Brightness.java`
**Fix:** Replace the example with accurate attribute names from the actual Brightness capability.

### M-02: Mental Model — `StateQuery` vs `StateQueryService`

**File:** `nexsys-coder/references/homesynapse-mental-model.md` §8, Subsystem 03
**Claim:** Key interfaces listed as `StateStore, StateQuery`
**Reality:** The interface is named `StateQueryService`, not `StateQuery`.
**Source:** `core/state-store/MODULE_CONTEXT.md`, actual Java source
**Fix:** Change `StateQuery` to `StateQueryService`.

### M-03: Platform-API MODULE_CONTEXT — ID Wrapper Count

**File:** `platform/platform-api/MODULE_CONTEXT.md` lines 27, 105
**Claim:** "9 typed ID wrapper records"
**Reality:** 8 typed ID wrappers: DeviceId, EntityId, IntegrationId, AreaId, AutomationId, PersonId, HomeId, SystemId
**Fix:** Change "9" to "8" in both locations.

### M-04: Configuration MODULE_CONTEXT — Stale Dependency Claim

**File:** `config/configuration/MODULE_CONTEXT.md` lines 102, 185
**Claim:** "`json-schema-validator` is NOT yet in the version catalog"
**Reality:** `libs.json.schema.validator` IS present in the Gradle build.
**Source:** `config/configuration/build.gradle.kts`
**Fix:** Remove the stale [REVIEW] flag and update the Gotcha.

---

## LOW Severity Findings (Cosmetic / File Counts)

### L-01: websocket-api MODULE_CONTEXT — File count claims 26, actual is 25
### L-02: rest-api MODULE_CONTEXT — package-info.java not mentioned in type inventory
### L-03: observability MODULE_CONTEXT — No explicit total file count (inconsistent with other modules)
### L-04: lifecycle MODULE_CONTEXT — File count ambiguity around package-info.java
### L-05: homesynapse-app MODULE_CONTEXT — module-info.java inclusion in file count unclear
### L-06: state-store MODULE_CONTEXT — EntityId listed as "from platform-api" but platform-api not in Gradle (comes transitively through device-model)

---

## Design Document Staleness (Side-Effect Findings)

These are not errors in the context files — the context files are correct. But the design documents they reference have fallen out of sync:

### DS-01: Design Doc 01 §8.3 — Stale `publishRoot` Signature

**File:** `design/01-event-model-and-event-bus.md` line ~890
**Stale:** `publishRoot(DomainEvent event, @Nullable ULID actorRef)`
**Current:** `publishRoot(EventDraft draft)` — actorRef is on the draft
**Source:** March 2026 Architecture Review Fixes, EventPublisher.java

### DS-02: Design Doc 01 §8.2 — Stale CausalContext Description

**File:** `design/01-event-model-and-event-bus.md` line ~878
**Stale:** "Carries correlation_id, causation_id, actor_ref"
**Current:** CausalContext has 2 fields only (correlationId, causationId). actorRef is on EventEnvelope.

### DS-03: Design Doc 01 — Stale Filter Terminology

**File:** `design/01-event-model-and-event-bus.md` lines ~200, 881, 1045, 1124
**Stale:** `entity_type_prefix`
**Current:** `subjectTypeFilter` (SubjectType enum)

---

## Governance Document Discrepancies

### GD-01: LTD-04 References Phantom Method

**File:** `HomeSynapse_Core_Locked_Decisions.md` line ~153
**Claim:** "`UlidFactory.monotonic()` for event IDs"
**Reality:** UlidFactory only has `generate()` and `generate(Clock)`. No `monotonic()` method exists.
**Impact:** Not immediate (the code is correct), but the governance doc references a method that doesn't exist.

### GD-02: Glossary — Capability ID Mismatch

**File:** `HomeSynapse_Core_v1_Glossary.md` §2.3 line ~219
**Claim:** Brightness capability has `capability_id = "dimmable"`
**Reality:** Code defines it as `capability_id = "brightness"`
**Source:** `Brightness.java` line 19

### GD-03: Glossary — Attribute Name Mismatch

**File:** `HomeSynapse_Core_v1_Glossary.md` §2.3 line ~229
**Claim:** Power measurement attribute is `watts`
**Reality:** Code defines it as `power_w`
**Source:** `PowerMeasurement.java` line 12

---

## Modules Verified Clean

The following MODULE_CONTEXT files passed audit with **zero discrepancies** against their design documents and source code:

| Module | Types | Verdict |
|--------|-------|---------|
| event-model | 46 | CLEAN |
| event-bus | 4 | CLEAN |
| automation | 52 | CLEAN |
| integration-api | 21 | CLEAN |
| integration-runtime | 6 | CLEAN |
| integration-zigbee | 39 | CLEAN |
| rest-api | 27 | CLEAN (minor file count) |
| observability | ~19 | CLEAN (minor file count) |
| lifecycle | ~7 | CLEAN (minor file count) |
| homesynapse-app | 4 | CLEAN (minor file count) |

---

## Recommended Fix Order

1. **C-01, C-02** (Mental Model §5, §6) — Fix first. Every Coder session reads this.
2. **C-03** (device-model JPMS) — Fix second. Foundation module, affects all downstream.
3. **C-04** (persistence Gradle scope) — Fix third. Wrong dependency visibility.
4. **H-01, H-02** (Mental Model §8, §9) — Fix fourth. Phantom types and wrong locations.
5. **H-03** (platform-api LTD citation) — Fix fifth. Traceability chain.
6. **M-01 through M-04** — Fix in any order.
7. **DS-01 through DS-03** — Design doc updates, can be batched.
8. **GD-01 through GD-03** — Governance doc updates, lower urgency.

---

## Certification

This audit examined every populated MODULE_CONTEXT.md file, the Knowledge Primer mental model, and both root context files. Each claim was verified against authoritative design documents, governance files, and actual Java source code. The findings above represent the complete set of discrepancies discovered.

After the CRITICAL and HIGH findings are corrected, the context file system will be clean for Phase 3 entry.
