<!--
file: design/amendments/AMD-57_Health_Detail_Enum.md
purpose: AMD-57 — HealthDetail enum + IntegrationHealthRecord.detail component (REC-42; description field dropped per PM disposition).
audience: Nick (ratify), PM, Coder
status: RATIFIED 2026-06-05 — DOCS-Project review (RATIFY-WITH-EDITS; R4 arbitrated) + Nick arbitration A1 (PM transition-trigger taxonomy stands); review return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`
source: Research 6 REC-42 ACCEPT(MODIFY) — 12-value count stands (taxonomy arbitrated, see §2.1); @Nullable String description DROPPED (YAGNI; lifecycle-event reason covers narrative)
baseline: homesynapse-core HEAD `e76b925` — IntegrationHealthRecord source-verified: 13 components, com.homesynapse.integration.runtime
-->

# AMD-57: `HealthDetail` Enum on `IntegrationHealthRecord`

## 1. Problem Statement

`IntegrationHealthRecord` (source-verified at `e76b925`: 13 components — `integrationId, state, healthScore, lastHeartbeat, lastKeepalive, stateChangedAt, consecutiveFailures, suspensionCycleCount, totalSuspendedTime, errorWindow, timeoutWindow, slowCallWindow, plannedRestart`) reports *which* `HealthState` an integration is in, but not *why*. "DEGRADED" without a cause forces operators (and the REST health endpoints, and the future UI) to reverse-engineer the cause from window snapshots. HA's 8-value `ConfigEntryState` with `(value, recoverable)` tuples demonstrates the operational value of a machine-readable cause.

## 2. Specification

### 2.1 `HealthDetail` enum (new, `com.homesynapse.integration.runtime`)

> **[REVIEW-FLAG R4 — RESOLVED by Nick arbitration A1 (2026-06-05).]** The review diffed this list against the inline Research 6 return §REC-42. **Count confirmed (12 = 12), but the return proposed a different, operator-cause taxonomy** — verbatim: `NONE`, `COMMUNICATION_ERROR`, `CONFIGURATION_ERROR`, `AUTH_FAILED`, `BRIDGE_OFFLINE`, `DUTY_CYCLE_THROTTLED`, `RATE_LIMITED`, `STARTUP_TIMEOUT`, `RESOURCE_LIMIT`, `DEPENDENCY_FAILED`, `MIGRATING`, `DISABLED_BY_USER`. **Arbitration: the PM transition-trigger taxonomy below stands; the research taxonomy was considered and declined.** Rationale: the research list is OpenHAB-derived, and Research 6's own §1 verdict explains why it does not transfer — OpenHAB's detail matrix is load-bearing only because bindings *self-report* their status, whereas HomeSynapse *aggregates health from metrics*; a transition-trigger vocabulary is what a metrics-driven FSM can actually emit truthfully. Verbatim replacement would also have broken AMD-57-INV-02 (1:1 trigger mapping) as written. The operator-cause vocabulary may resurface later as **observability display labels**, not enum values. (Each value below maps 1:1 to a supervisor transition trigger on the source-verified `HealthParameters` surface.)

```java
public enum HealthDetail {
    NONE,                        // HEALTHY — no detail applies
    HEARTBEAT_TIMEOUT,           // heartbeatTimeout exceeded
    KEEPALIVE_TIMEOUT,           // protocol keepalive overdue
    ERROR_RATE_EXCEEDED,         // errorWindow rate over threshold
    TIMEOUT_RATE_EXCEEDED,       // timeoutWindow rate over threshold
    SLOW_CALL_RATE_EXCEEDED,     // slowCallWindow rate over threshold
    PROBE_FAILED,                // recovery probe cycle failed
    RESTART_LIMIT_EXCEEDED,      // maxRestarts within restartWindow exhausted
    SUSPENSION_LIMIT_EXCEEDED,   // maxSuspensionCycles exhausted
    RESOURCE_QUOTA_EXCEEDED,     // resource quota breach (pairs with IntegrationResourceExceeded)
    AUTH_FAILURE,                // AUTH_FAILED classification active (AMD-56)
    PERMANENT_FAILURE            // PermanentIntegrationException — FAILED, no retry
}
```

### 2.2 `IntegrationHealthRecord` change

Insert `HealthDetail detail` immediately after `state` (component 3 of 14). The supervisor populates it on every record it produces; `NONE` if and only if `state == HEALTHY` is **not** required (a HEALTHY record post-recovery may carry the last cause? **No** — keep it simple: `NONE` ⇔ no active cause; the historical narrative lives in lifecycle events). The dropped `@Nullable String description` from the research proposal stays dropped: the `reason` field on `IntegrationLifecycleEvent` (Register C voice, INV-HO-04) already carries human-readable context, and `@Nullable` annotations violate the codebase convention (Javadoc-only nullability — integration-api MODULE_CONTEXT gotcha).

The canonical-constructor change is **breaking but acceptable** — the record is supervisor-internal (constructed only by integration-runtime; consumed read-only by rest-api/observability), per the REC-42 disposition. A 13-arg convenience constructor is NOT provided (no production constructor callers exist at `e76b925` outside the module's own tests — M4.C survey gate confirms).

## 3. Downstream Impact

- **rest-api / observability (planned consumers):** gain a machine-readable cause for `GET /api/v1/integrations/{id}/health` (Research 7 surface). Read-only — no breakage.
- **AMD-56 coupling:** `AUTH_FAILURE` detail ⇔ `AUTH_FAILED` classification active.
- **No JPMS change.**

## 4. Tests (M4.C scope)

| Test | Assertion |
|---|---|
| `HealthDetailTest.valueCount` | exactly 12 values, declaration order pinned |
| `IntegrationHealthRecordTest.detailComponent` | 14 components; `detail` non-null guard in compact ctor |

## 5. Scope Fences / Deferred

NO supervisor population logic (M9). NO REST exposure (M10).

## 6. Invariants and Citations

- **AMD-57-INV-01:** `detail` is never null; `NONE` is the explicit no-cause value. Supervisor-internal — adapters never set it (they have no write path to the record).
- **AMD-57-INV-02:** the enum is append-only once ratified; values map 1:1 to supervisor transition triggers.
- Cites: Doc 05 §4.3 (health model); REC-42 disposition (description dropped); INV-HO-04 (narrative lives in lifecycle-event reason).

Module-info (integration-runtime): unchanged — see AMD-56 §6 verbatim embed.

## 7. Implementing WU

**M4.C.**

## 8. Ratification Checklist

- [x] DOCS-Project review (R4 diffed; arbitrated by A1 — see §2.1) — 2026-06-05
- [x] Nick ratification — 2026-06-05
- [x] Invariants registered (`Architecture_Invariants_v1.md` §27)

## 9. Review Disposition

**DOCS-Project review (2026-06-05): RATIFY-WITH-EDITS — R4 arbitrated.** Return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`.

- **R4 (G1 fidelity, run against the inline return):** REC-42's 12-value count CONFIRMED; the lists differed in 11 of 12 entries — two different taxonomies, not transcription drift (the return's verbatim list is preserved in §2.1). **Nick arbitration A1: keep the PM transition-trigger taxonomy** (self-report-vs-metrics-aggregation rationale, recorded in §2.1); operator-cause vocabulary may resurface as observability display labels. AMD-57-INV-02 stands as written.
- The return's `@Nullable String description` stays dropped (PM disposition; Javadoc-only nullability convention; narrative lives in lifecycle-event `reason`).

Ratified by Nick 2026-06-05.
