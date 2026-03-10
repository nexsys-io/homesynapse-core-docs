# Doc 12 Cross-Audit Report — Round 12

**Document type:** Governance — adversarial architecture review
**Subject:** Startup, Lifecycle & Shutdown (Doc 12)
**Date:** 2026-03-09
**Method:** Five-track cross-audit against all governance artifacts, all 11 upstream design documents, Portability Architecture, and internal consistency checks
**Auditor:** Senior Systems Architect (Cross-Audit Round 12)

---

## 0. Summary

| Severity | Count |
|---|---|
| CRITICAL | 1 |
| SIGNIFICANT | 6 |
| MINOR | 1 |
| **Total** | **8** |

**Lock readiness:** Doc 12 is ready to lock after the 1 CRITICAL and 6 SIGNIFICANT amendments are applied. No BLOCKING concerns remain. The CRITICAL finding is a single field name error that is straightforward to correct. The SIGNIFICANT findings are section reference corrections, a missing PRAGMA, and upstream metadata housekeeping. None require architectural redesign.

---

## 1. Findings

### Finding F12-01: Incorrect Checkpoint Field Name — `globalPosition` vs `view_position`

**Severity:** CRITICAL
**Track:** B
**Location:** Doc 12 §3.5 Phase 3.2 Step 4 vs Doc 03 §3.3, §3.6

**Issue:** Doc 12 refers to a field named `globalPosition` in the checkpoint object. Doc 03 defines the checkpoint schema with a field named `view_position`. The `globalPosition` is a method on event objects (`event.globalPosition()`), while the checkpoint carries `view_position` as the position from which replay resumes. This mismatch would cause an implementation error — the coder would look for a field that does not exist in the checkpoint structure.

**Evidence:**

Doc 12 §3.5 Phase 3.2 Step 4:
> Execute checkpoint recovery: replay events from the checkpoint's `globalPosition` (or position 0 if the checkpoint was discarded) to the current log head.

Doc 03 §3.3 checkpoint schema:
```json
{
  "schema_version": 1,
  "projection_version": 1,
  "view_position": 48523,
  ...
}
```

Doc 03 §3.6 Phase 2:
> The subscriber registers with the Event Bus at the checkpoint's `view_position` (or 0 if no checkpoint).

**Resolution:**

FIND (Doc 12 §3.5 Phase 3.2 Step 4):
```
replay events from the checkpoint's `globalPosition` (or position 0 if the checkpoint was discarded)
```

REPLACE:
```
replay events from the checkpoint's `view_position` (or position 0 if the checkpoint was discarded)
```

---

### Finding F12-02: Missing PRAGMA `cell_size_check` in Connection PRAGMAs

**Severity:** SIGNIFICANT
**Track:** B
**Location:** Doc 12 §3.4 Phase 2.1 Step 2 vs Doc 04 §3.3

**Issue:** Doc 12 lists the connection PRAGMAs to apply but omits `cell_size_check = ON`, which Doc 04 §3.3 specifies for early corruption detection. The omission means the coder implementing Phase 2.1 would skip this PRAGMA, reducing SQLite's ability to detect on-read cell integrity violations.

**Evidence:**

Doc 12 §3.4 Phase 2.1 Step 2:
> Apply connection PRAGMAs in the order specified by LTD-03: `journal_mode = WAL`, `synchronous = NORMAL`, `cache_size = -128000`, `mmap_size = 1073741824`, `temp_store = MEMORY`, `journal_size_limit = 6144000`, `busy_timeout = 5000`.

Doc 04 §3.3 includes an additional PRAGMA:
```sql
PRAGMA cell_size_check = ON;          -- Early corruption detection
```

**Resolution:**

FIND (Doc 12 §3.4 Phase 2.1 Step 2):
```
`journal_size_limit = 6144000`, `busy_timeout = 5000`. PRAGMA order matters
```

REPLACE:
```
`journal_size_limit = 6144000`, `busy_timeout = 5000`, `cell_size_check = ON`. PRAGMA order matters
```

---

### Finding F12-03: Schema Composition Timing Conflict Between Phase 1 and Phase 6

**Severity:** SIGNIFICANT
**Track:** B
**Location:** Doc 12 §3.3 Phase 1 vs Doc 06 §3.2

**Issue:** Doc 12 Phase 1 claims the Configuration System executes its full six-stage loading pipeline including "schema composition" during Phase 1. However, Doc 06 §3.2 states that schema composition collects integration schemas from registered `IntegrationDescriptor` instances, and that "Schema composition occurs once during startup, after integration registration and before configuration validation." Integration discovery via `ServiceLoader.load()` happens during Phase 6, which is after Phase 1. This creates a temporal dependency that cannot be satisfied during Phase 1. In practice, Phase 1 can only compose core schemas (which are static and bundled); integration schemas are not available until Phase 6.

**Evidence:**

Doc 12 §3.3 Phase 1:
> The Configuration System (Doc 06 §3.1–§3.2) executes its six-stage loading pipeline: file system read from `PlatformPaths.configDir()/config.yaml`, YAML parse via SnakeYAML Engine, tag resolution (`!secret`, `!env`), schema composition, schema validation, and typed model construction.

Doc 06 §3.2:
> Composition at startup: 1. Load all core schemas from the distribution classpath. 2. Collect integration schemas from registered `IntegrationDescriptor` instances. 3. Build a root schema... Schema composition occurs once during startup, after integration registration and before configuration validation.

**Resolution:**

FIND (Doc 12 §3.3 Phase 1):
```
tag resolution (`!secret`, `!env`), schema composition, schema validation, and typed model construction.
```

REPLACE:
```
tag resolution (`!secret`, `!env`), core-only schema composition (integration schemas are not yet available — they are registered after Phase 6 integration discovery), schema validation against the core schema, and typed model construction. After Phase 6 integration discovery, the Configuration System recomposes the full schema including integration schemas and revalidates the integration configuration sections.
```

---

### Finding F12-04: REST API Startup Section Reference Mismatch

**Severity:** SIGNIFICANT
**Track:** B
**Location:** Doc 12 §3.7 Phase 5 Step 5.1 vs Doc 09 §3.1, §3.9

**Issue:** Doc 12 Step 5.1 references "Doc 09 §3.1" as the source for REST API server startup. Doc 09 §3.1 is titled "Subsystem Position" and describes the REST API's role as a translation layer — it does not describe server startup procedures. HTTP server selection and implementation details are in Doc 09 §3.9. Additionally, Doc 12's Dependencies metadata header also cites "Doc 09 — §3.1 server start" which is the wrong section.

**Evidence:**

Doc 12 Dependencies header:
> REST API (Doc 09 — §3.1 server start, §3.4 idempotency per AMD-08)

Doc 09 §3.1:
> The REST API sits at the outer edge of the system, accepting HTTP requests from external clients and translating them into queries against internal interfaces.

Doc 09 §3.9 covers HTTP server selection (Javalin).

**Resolution:**

FIND (Doc 12 Dependencies header):
```
REST API (Doc 09 — §3.1 server start, §3.4 idempotency per AMD-08)
```

REPLACE:
```
REST API (Doc 09 — §3.9 HTTP server selection, §3.4 idempotency per AMD-08)
```

And in Doc 12 §3.7 Phase 5 Step 5.1, if the text references "Doc 09 §3.1", replace with "Doc 09 §3.9".

---

### Finding F12-05: Health Aggregation Model Description Inconsistency

**Severity:** SIGNIFICANT
**Track:** B
**Location:** Doc 12 §3.6 Step 4.2 vs Doc 11 §3.3

**Issue:** Doc 12 describes health aggregation as "per-component health rolls up to per-subsystem health, which rolls up to system-wide health." This implies a three-level hierarchical model (component → subsystem → system). Doc 11 §3.3 defines a tier-based composition model where subsystems are classified into three tiers (Tier 1: Critical Infrastructure, Tier 2: Core Services, Tier 3: Interface Services), each tier applies its own composition rule, and "System-wide health is the worst-of across tier results." These are structurally different aggregation models — Doc 12's description could mislead the implementer into building a different aggregation hierarchy than what Doc 11 specifies.

**Evidence:**

Doc 12 §3.6 Step 4.2:
> It computes the initial system health state using the three-tier composition model: per-component health rolls up to per-subsystem health, which rolls up to system-wide health.

Doc 11 §3.3:
> Three tiers: Tier 1 — Critical Infrastructure [...] Tier 2 — Core Services [...] Tier 3 — Interface Services [...] System-wide health is the worst-of across tier results: `System = worst(Tier1_result, Tier2_result, Tier3_result)`.

**Resolution:**

FIND (Doc 12 §3.6 Step 4.2):
```
It computes the initial system health state using the three-tier composition model: per-component health rolls up to per-subsystem health, which rolls up to system-wide health.
```

REPLACE:
```
It computes the initial system health state using the tier-based composition model (Doc 11 §3.3): subsystems are classified into three tiers (Tier 1: Critical Infrastructure; Tier 2: Core Services; Tier 3: Interface Services), each tier applies its own composition rule (e.g., any Tier 1 UNHEALTHY → system UNHEALTHY), and system health is the worst-of across tier results.
```

---

### Finding F12-06: Upstream Documents Missing "Doc 12" Citation in Dependents Fields

**Severity:** SIGNIFICANT
**Track:** E
**Location:** Docs 01, 05, 06, 07, 09, 10 metadata headers

**Issue:** Six upstream documents reference "Startup, Lifecycle & Shutdown" in their Dependents fields but do not include the document number "Doc 12". Only Doc 11 correctly identifies "Doc 12" in its Dependents field. This violates the cross-reference format established by the Design Doc Template §1.3 and makes impact analysis harder.

**Evidence:**
- Doc 01 Dependents: "Startup, Lifecycle & Shutdown (§3.7 processing modes, §6 failure recovery)" — no doc number
- Doc 05 Dependents: "Startup, Lifecycle & Shutdown (supervisor initialization order, shutdown sequence)" — no doc number
- Doc 06 Dependents: "Startup, Lifecycle & Shutdown (§3.1 config loading as first stage in startup sequence)" — no doc number
- Doc 07 Dependents: "Startup, Lifecycle & Shutdown (automation subscriber lifecycle, processing mode transitions)" — no doc number
- Doc 09 Dependents: "Startup, Lifecycle & Shutdown (HTTP server lifecycle)" — no doc number
- Doc 10 Dependents: "Startup, Lifecycle & Shutdown" — no doc number
- Doc 11 Dependents: "Startup Lifecycle & Shutdown (Doc 12: health reporting interface, subsystem initialization order)" — CORRECT

**Resolution:** Amend each upstream document's Dependents field to include "Doc 12 —" before the section details. Example for Doc 01:

FIND: `Startup, Lifecycle & Shutdown (§3.7 processing modes, §6 failure recovery)`
REPLACE: `Startup, Lifecycle & Shutdown (Doc 12 — §3.7 processing modes, §6 failure recovery)`

Apply the same pattern to Docs 05, 06, 07, 09, and 10.

---

### Finding F12-07: Four Upstream Documents Missing Doc 12 From Dependents Entirely

**Severity:** SIGNIFICANT
**Track:** E
**Location:** Docs 02, 03, 04, 08 metadata headers

**Issue:** Four upstream documents do not mention Doc 12 in their Dependents fields at all, despite Doc 12 depending on them and orchestrating their initialization and shutdown. This breaks bidirectional traceability for impact analysis.

**Evidence:**
- Doc 02 (Device Model): Dependents field does not mention Doc 12 or "Startup, Lifecycle & Shutdown"
- Doc 03 (State Store): Dependents field does not mention Doc 12 or "Startup, Lifecycle & Shutdown"
- Doc 04 (Persistence Layer): Dependents field does not mention Doc 12 or "Startup, Lifecycle & Shutdown"
- Doc 08 (Zigbee Adapter): Dependents field says "None yet"

**Resolution:** Add Doc 12 to each document's Dependents field:

Doc 02 — Add: `Startup, Lifecycle & Shutdown (Doc 12 — Device Model registry initialization in Phase 3, orphan detection)`

Doc 03 — Add: `Startup, Lifecycle & Shutdown (Doc 12 — State Store checkpoint recovery in Phase 3, projection versioning)`

Doc 04 — Add: `Startup, Lifecycle & Shutdown (Doc 12 — Phase 2 initialization: database opening, PRAGMA application, migrations, integrity check)`

Doc 08 — FIND: `**Dependents:** None yet`
REPLACE: `**Dependents:** Startup, Lifecycle & Shutdown (Doc 12 — Integration Runtime discovery and startup in Phase 6)`

---

### Finding F12-08: Unclean Shutdown Marker Write Step Not Explicit in Phase 2 Sequence

**Severity:** MINOR
**Track:** B
**Location:** Doc 12 §3.4 Phase 2.1 Step 5

**Issue:** Step 2.1.5 states "A new marker is written at the end of Phase 2" but the actual enumerated steps in Phase 2.1 (steps 1–8) and Phase 2.2 (steps 1–4) do not include an explicit numbered step to write the marker. The marker check is documented (step 5) but the marker creation exists only as a prose comment within that step, not as a discrete action. This creates minor ambiguity about implementation timing and ownership.

**Evidence:**

Doc 12 §3.4 Phase 2.1 Step 5:
> Check for unclean shutdown marker. If the marker file (`PlatformPaths.dataDir()/.unclean_shutdown`) exists, log a WARNING indicating the previous shutdown was unclean. The marker is removed after successful startup completes. A new marker is written at the end of Phase 2.

No subsequent step in Phase 2 explicitly performs the marker write.

**Resolution:**

Add after Phase 2.2 (Event Bus initialization):

```
**Step 2.3: Write unclean shutdown marker.** After Phase 2 completes (Persistence Layer and Event Bus are operational), `SystemLifecycleManager` writes the unclean shutdown marker at `PlatformPaths.dataDir()/.unclean_shutdown`. This marker persists until removed during graceful shutdown (§3.9 step 11). If the process is killed after this point, the marker signals unclean shutdown on next startup.
```

And amend Step 2.1.5:

FIND:
```
A new marker is written at the end of Phase 2.
```

REPLACE:
```
A new marker is written in Step 2.3 after all Phase 2 initialization completes.
```

---

## 2. Upstream Dependents Amendments

The following upstream documents need their Dependents field updated to reference Doc 12:

| Document | Current State | Amendment Needed |
|---|---|---|
| Doc 01 (Event Bus) | References "Startup, Lifecycle & Shutdown" without doc number | Add "Doc 12 —" prefix |
| Doc 02 (Device Model) | No reference to Doc 12 | Add full entry |
| Doc 03 (State Store) | No reference to Doc 12 | Add full entry |
| Doc 04 (Persistence Layer) | No reference to Doc 12 | Add full entry |
| Doc 05 (Integration Runtime) | References without doc number | Add "Doc 12 —" prefix |
| Doc 06 (Configuration System) | References without doc number | Add "Doc 12 —" prefix |
| Doc 07 (Automation Engine) | References without doc number | Add "Doc 12 —" prefix |
| Doc 08 (Zigbee Adapter) | "None yet" | Replace with Doc 12 entry |
| Doc 09 (REST API) | References without doc number | Add "Doc 12 —" prefix |
| Doc 10 (WebSocket API) | References without doc number | Add "Doc 12 —" prefix |
| Doc 11 (Observability) | Correctly references Doc 12 | No change needed |

Specific sections Doc 12 references from each upstream doc:

| Doc | Sections Referenced by Doc 12 |
|---|---|
| 01 | §3 initialization, §3.7 processing modes, §4 subscriber registration, §8.3 EventPublisher |
| 02 | §3.12 discovery pipeline, §3.15 orphan lifecycle (AMD-17), §8.1 registries |
| 03 | §3.2.1 reconciliation (AMD-02), §3.3/§3.6 projection versioning (AMD-10), §3.8 staleness (AMD-11), §8 checkpoint recovery |
| 04 | §3.1–§3.4 database opening/PRAGMAs/migration/integrity, §3.5 retention, §3.7 aggregation, §3.8 backup |
| 05 | §3.2 thread allocation, §3.3 adapter lifecycle, §3.4 supervision, §3.5 health, §3.13 dependency ordering (AMD-14) |
| 06 | §3.1 file loading, §3.2 schema validation, §3.4 watch thread, §3.7 migration (AMD-13) |
| 07 | §3.1–§3.8 registry/triggers/subscriber/RunManager/cascade/snapshot |
| 08 | §3.2 coordinator connection, §3.3 network formation, §3.4 device cache |
| 09 | §3.9 HTTP server selection, §3.4 idempotency (AMD-08) |
| 10 | §3.1 upgrade handler, §3.3 relay subscriber, §3.14 admission control (AMD-09) |
| 11 | §3.1 JFR start, §3.3 health aggregation, §8.1–§8.2 HealthContributor |

---

## 3. Lock Readiness Assessment

**Verdict: Ready to lock after amendments.**

The 1 CRITICAL finding (F12-01) is a straightforward field name correction — `globalPosition` → `view_position`. The 6 SIGNIFICANT findings are section reference corrections (F12-04), model description clarifications (F12-03, F12-05), a missing PRAGMA (F12-02), and upstream metadata housekeeping (F12-06, F12-07). None require architectural changes. The 1 MINOR finding (F12-08) improves specification clarity.

No BLOCKING concerns. All findings have exact amendment text. No finding requires rethinking the startup sequence, shutdown order, or lifecycle state machine.

---

## 4. What Doc 12 Gets Right

Doc 12 is a strong synthesis document. The audit found only 8 issues across 5 tracks examining the document against 11 upstream designs, 4 governance artifacts, and the Portability Architecture — a low defect density for a document of this scope.

**Governance compliance is clean.** All 16 template sections present. All invariant citations (INV-CE-02, INV-RF-01, INV-RF-02, INV-RF-03, INV-RF-06, INV-TO-01) verified correct. All 9 LTD citations verified. All 12 AMD citations verified. Register A voice throughout with no DAS violations.

**The seven-phase initialization sequence is well-structured.** The phase ordering (Platform Bootstrap → Foundation → Data Infrastructure → Core Domain → Observability → External Interfaces → Integrations) correctly reflects the dependency graph across all 11 subsystems. The reverse-order shutdown sequence is consistent with the initialization order and Contract C12-02.

**Internal consistency is tight.** All contracts in §5 are testable and match §3. All failure modes in §6 cover initialization paths in §3. All configuration parameters in §9 correspond to claims in §3. Performance targets in §10 are consistent with timing claims. The testing strategy in §13 covers all failure modes. The lifecycle events in §4.4 cover all transitions. The interaction table in §7 is complete.

**Portability Architecture alignment is exact.** HealthReporter (4 methods, 2 implementations, selection logic), PlatformPaths (6 methods, LinuxSystemPaths paths), and AdaptivePragmaConfig acknowledgment all match the Portability Architecture specification precisely.

**The platform abstraction design is sound.** Introducing HealthReporter and PlatformPaths as Doc 12's own interfaces (rather than leaving them implicit in upstream docs) was the right architectural decision. These interfaces cleanly separate platform-specific concerns from lifecycle orchestration logic.

---

*This audit report is part of HomeSynapse Core Round 12 design review. It should be read alongside Doc 12 and the Design Review Amendments v1.*
