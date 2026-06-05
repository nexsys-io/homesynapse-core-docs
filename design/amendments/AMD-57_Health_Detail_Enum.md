<!--
file: design/amendments/AMD-57_Health_Detail_Enum.md
purpose: AMD-57 — HealthDetail enum + IntegrationHealthRecord.detail component (REC-42; description field dropped per PM disposition).
audience: Nick (ratify), PM, Coder
status: PROPOSED — pending DOCS-Project review + Nick ratification (Workstream C block, AMD-54..64)
source: Research 6 REC-42 ACCEPT(MODIFY) — 12-value enum stands; @Nullable String description DROPPED (YAGNI; lifecycle-event reason covers narrative)
baseline: homesynapse-core HEAD `e76b925` — IntegrationHealthRecord source-verified: 13 components, com.homesynapse.integration.runtime
-->

# AMD-57: `HealthDetail` Enum on `IntegrationHealthRecord`

## 1. Problem Statement

`IntegrationHealthRecord` (source-verified at `e76b925`: 13 components — `integrationId, state, healthScore, lastHeartbeat, lastKeepalive, stateChangedAt, consecutiveFailures, suspensionCycleCount, totalSuspendedTime, errorWindow, timeoutWindow, slowCallWindow, plannedRestart`) reports *which* `HealthState` an integration is in, but not *why*. "DEGRADED" without a cause forces operators (and the REST health endpoints, and the future UI) to reverse-engineer the cause from window snapshots. HA's 8-value `ConfigEntryState` with `(value, recoverable)` tuples demonstrates the operational value of a machine-readable cause.

## 2. Specification

### 2.1 `HealthDetail` enum (new, `com.homesynapse.integration.runtime`)

> **[REVIEW-FLAG R4 — value-list provenance.]** The Research 6 return proposed a 12-value enum which the PM disposition accepted as proposed; the return document is not on disk and the assessment does not enumerate the values. The 12 values below are **PM-reconstructed from the HealthParameters threshold surface** (each value maps 1:1 to a supervisor transition trigger). The DOCS-Project review MUST diff this list against the Research 6 return §REC-42 and replace it verbatim if it differs. Semantics and placement are not affected by the exact list.

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

- [ ] DOCS-Project review (**R4: replace the value list verbatim from the Research 6 return if it differs**)
- [ ] Nick ratification
- [ ] Invariants registered

## 9. Review Disposition

*(populated at ratification)*
