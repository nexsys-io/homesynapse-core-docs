<!--
file: design/amendments/AMD-92_Automation_Event_Vocabulary.md
purpose: AMD-92 — the M7 automation event vocabulary in com.homesynapse.event (flat): full Doc-07 inventory enumerated with per-type registration deltas; the type-residency decision (FLATTEN run/status identifiers — PM default); per-slice manifest fan-out (55/24/36 → +n) + P2 survey incl. behavioral publish-count pins; C8 stamping via envelope only (REC-39 W0-re-anchored ⊕ 141 ⊕ 147 per merged disposition §2a-F5).
audience: Nick (ratify), PM, Coder, independent DOCS-Project reviewer
status: PROPOSED 2026-06-13 — awaits the bundled DOCS review (M7 block + B2 C8/C9) + Nick ratification. ⚠ C8 is cited PROPOSED-PENDING throughout — the bundled review resolves both together; nothing here silently assumes C8 ratified.
source: Research 4 REC-39 (MODIFY+ACCEPT; the five W0 §2.5 re-anchored obligations ARE the MODIFY content) ⊕ R14-A REC-141/147 (inventory + drop-observability test-pins) via merged disposition §2a-F5; AMD-70 E70-1 (the type-residency precedent); AMD-52 (codec discipline)
baseline: homesynapse-core HEAD `e5ea76f` (substantive `7c73c91`). Source-verified at this baseline: EventTypes 55 constants (incl. AUTOMATION_TRIGGERED/AUTOMATION_COMPLETED/AUTOMATION_CAPABILITY_MISMATCH); CORE_PRODUCTION_EVENT_CLASSES 24 records (incl. minimal-shape AutomationTriggeredEvent/AutomationCompletedEvent); EventCategoryMapping 36 entries (automation rows: triggered/completed only); both module-infos (§7 verbatim embeds).
-->

# AMD-92: Automation Event Vocabulary — Inventory, Type-Residency, Manifest Fan-Out

**Block context:** Fifth of the six-amendment M7 automation block (AMD-88..93). The event-side contract for everything M7 publishes. This is the block's largest registration surface: 16 new event types, 17 new payload records, 2 record reshapes.

## 1. Problem Statement

Doc 07 specifies a rich automation event surface (run lifecycle §3.7; mode-enforcement and lifecycle events :317–326; duration-timer events §3.4; cascade diagnostics §3.7.1; slug redirects, Identity Model §7.5) — but at baseline the event module carries only THREE automation constants (`automation_triggered`, `automation_completed`, `automation_capability_mismatch`) and TWO records whose shapes (`AutomationTriggeredEvent(triggerType, triggerDetail)`; `AutomationCompletedEvent(status, failureReason, durationMs)`) are M1-era minimal vocabulary that does NOT match Doc 07's Locked payload spec (`run_id`, `matched_triggers[]`, `resolved_targets{}`, `definition_hash`, `cascade_depth`; `action_count`/`command_count`). M7 cannot publish a single run event without this AMD. Additionally, REC-39's W0 re-anchor surfaced the JPMS hazard: automation-resident types (`RunId`, `RunStatus`, `PendingStatus`) in event payloads would force `event → automation` — a cycle (`automation requires transitive event`), the exact AMD-52/E70-1 class.

## 2. Specification

### 2.1 Type-residency decision: **FLATTEN** (W0 §2.5.1 — decided HERE, the PM default stated for review confirmation)

Automation event records live in **`com.homesynapse.event` (flat package — AMD-52/NQ-5 precedent)** and may reference **only event-resident-or-below types** (`java.base`, `com.homesynapse.platform`, `com.homesynapse.value` — the declared `requires transitive` set; §7 embeds). Resolution of flatten-or-relocate: **FLATTEN.**

- `RunId` → **bare `Ulid`** payload components (`runId`), the AMD-70 E70-1 precedent. Relocating `RunId` to platform-api was REJECTED: `RunId` is automation-INTERNAL by design (MODULE_CONTEXT: "Unlike AutomationId, RunId is automation-specific") — relocation would make an automation-internal identifier a shared platform type, inverting its design intent for the convenience of a payload field.
- `RunStatus` → **`String finalStatus`** (`RunStatus.name()` at publish; consumers compare strings — the `ConfigSectionReloadedEvent.appliedClassification` precedent).
- `PendingStatus` → **`String`** wherever a ledger surface ever carries it (none in this inventory — the ledger events pre-exist; recorded for the standing rule).
- `RunCausalChain`/`ChainLink` (AMD-91) → flattened projections only (`int cascadeDepth`, `List<AutomationId> chain`).
- **Allowed unflattened:** `AutomationId`, `EntityId`, `EventId`, `Ulid` (platform/event-resident — LTD-04 typed wrappers ride fine); `Instant` (`java.base`).

Automation-resident enums/records are CONSUMED to derive flattened components, never REFERENCED in event records — the E70-1 rule verbatim, now the standing automation-family discipline (AMD-92-INV-01).

### 2.2 The inventory (complete; per-type registration state at baseline → action)

**Priorities/subjects per Locked Doc 07 §3.7/:317–326/§3.4/§3.7.1 and Doc 01 §4.3.** Category: all rows `[AUTOMATION]` (Doc 01 §4.4's automation-category definition; the command/ledger dual-category rows pre-exist and are untouched). PM-proposed where the Locked text is silent — category confirmation at review is the M4.C precedent.

| # | Event type | Baseline state | Action | Priority | Payload (flattened components) |
|---|---|---|---|---|---|
| 1 | `automation_triggered` | constant ✓, record minimal-shape | **RESHAPE record** | NORMAL | `Ulid runId`, `EventId triggeringEventId`, `List<String> matchedTriggers` (triggerIds, AMD-88 §2.5), `Map<String,Set<EntityId>> resolvedTargets`, `String definitionHash`, `int cascadeDepth` (AMD-91 `depth()`) |
| 2 | `automation_completed` | constant ✓, record minimal-shape | **RESHAPE record** | NORMAL | `Ulid runId`, `String finalStatus` (RunStatus.name()), `long durationMs`, `int actionCount`, `int commandCount`, `String failureReason` (nullable), `String abortReason` (nullable — §6.6) |
| 3 | `automation_invoked` | — | **MINT** (constant+record) | NORMAL | `String invocationContext` (nullable); invoker on envelope `actorRef` (C8 seam, PROPOSED-pending). ⚠ NOT in Doc 07's text — the AMD-88 §2.2 `ManualTrigger`/AMD-90 §2.3 invocation mint; Doc 07 §3.7 event-table row added at ratification [REVIEW-POINT R92-1] |
| 4 | `automation_condition_evaluated` | — | MINT | DIAGNOSTIC | `Ulid runId`, `int conditionIndex`, `String conditionType`, `boolean result`, `List<EvaluatedEntityState> evaluatedState` — nested event-resident record `EvaluatedEntityState(EntityId entityRef, String attribute, String value, Instant lastChangedAt, EventId lastChangedByEventId)` (critical-review 2.2 read-time version tracking) [REVIEW-POINT R92-2: nested-record payload precedent] |
| 5 | `automation_action_started` | — | MINT | DIAGNOSTIC | `Ulid runId`, `int actionIndex`, `String actionType`, `List<EntityId> targetRefs` |
| 6 | `automation_action_completed` | — | MINT | DIAGNOSTIC | `Ulid runId`, `int actionIndex`, `String outcome` ("success"/"skipped"/"error"), `String errorDetail` (nullable) |
| 7 | `automation_run_skipped` | — | MINT | DIAGNOSTIC | `AutomationId automationId`, `EventId triggeringEventId`, `String reason` ("mode_busy"/"queue_full"), `String mode`, `Ulid activeRunId` (nullable), `String maxExceededSeverity` (:321; REC-147 test-pins ride M7.2) |
| 8 | `automation_run_cancelled` | — | MINT | DIAGNOSTIC | `AutomationId automationId`, `Ulid cancelledRunId`, `EventId replacingEventId`, `EventId triggeringEventId` (:322) |
| 9 | `automation_conflict_detected` | — | MINT | DIAGNOSTIC | `EventId triggeringEventId`, `EntityId entityRef`, `List<ConflictEntry> conflicts` — nested record `ConflictEntry(AutomationId automationId, EventId commandEventId, String commandName, String parameters)` — `boolean contradictory` (:323) |
| 10 | `automation_disabled` | — | MINT | **NORMAL** | `AutomationId automationId`, `String reason`, `int failureCount`, `int windowMinutes`, `String lastError` (nullable), `Ulid lastRunId` (nullable). ⚠ Doc-07-internal tension: §3.7 :326 reasons NORMAL explicitly (retention rationale); §6.2 :709 says CRITICAL — PM default NORMAL per the reasoned table row; the loser section gets a correction note at ratification [REVIEW-POINT R92-3] |
| 11 | `automation_slug_redirect` | — | MINT | DIAGNOSTIC | `String requestedSlug`, `String resolvedSlug`, `EntityId resolvedEntityId` (Identity Model §7.5 tombstone-chain follow) |
| 12 | `trigger_duration_started` | — | MINT | DIAGNOSTIC | `AutomationId automationId`, `int triggerIndex`, `String triggerId`, `EventId startingEventId`, `EntityId entityRef`, `long forDurationMs` (§3.4 step 1) |
| 13 | `trigger_duration_cancelled` | — | MINT | DIAGNOSTIC | `AutomationId automationId`, `int triggerIndex`, `String triggerId`, `EventId startingEventId`, `String reason` ("predicate_false"/"definition_changed"/"automation_removed") (§3.4 step 2, §3.7 reload) |
| 14 | `trigger_duration_expired` | — | MINT | DIAGNOSTIC | `AutomationId automationId`, `int triggerIndex`, `String triggerId`, `EventId startingEventId` (§3.4 step 3) |
| 15 | `trigger_duration_state_validated` | — | MINT | DIAGNOSTIC | `AutomationId automationId`, `int triggerIndex`, `EventId startingEventId`, `boolean predicateStillTrue` — published ONLY on validation-vs-expectation divergence (§3.4 step 4) |
| 16 | `trigger_duration_limit_exceeded` | — | MINT | DIAGNOSTIC | `AutomationId automationId`, `int triggerIndex`, `int activeTimerCount`, `int maxConcurrentDurationTimers` (§9 :875) |
| 17 | `cascade_depth_exceeded` | — | MINT | DIAGNOSTIC | `AutomationId automationId`, `EventId triggeringEventId`, `int cascadeDepth`, `int maxCascadeDepth`, `Ulid correlationId` (§3.7.1 — field set unchanged from Locked) |
| 18 | `cascade_loop_detected` | — | MINT | DIAGNOSTIC | `AutomationId automationId`, `EventId triggeringEventId`, `Ulid correlationId`, `Ulid originalRunId`, `List<AutomationId> chain` (the AMD-91 cycle path — the F4 distinct diagnostic; payload extends the Locked §3.7.1 set by `chain`) |
| 19 | `automation_capability_mismatch` | constant ✓, NO record | **MINT record** (constant reused) | NORMAL | `AutomationId automationId`, `List<EntityId> affectedEntities`, `List<String> missingCapabilityIds` (Doc 01 :564) |

All snake_case (the automation-family precedent; dot-namespacing stays config/integration-side). All records `@EventType(EventTypes.CONSTANT)` — never raw literals; constants added for #3–18. `DegradedEvent` stays unannotated. Ledger/command events (`command_*`, `state_confirmed`) PRE-EXIST and are NOT touched — M7.3's slice mints nothing.

**Freeze boundary (the AMD-70 §2.1 pattern):** the CONTRACT this AMD freezes is the type-name set, priorities, subjects, categories, the type-residency rule, and the registration obligations. Exact flattened component lists above are the PM-proposed shapes — Phase-2-frozen at each slice's implementation after review adjudication of R92-1/2/3; a component-level adjustment at review or implementation does NOT re-open the AMD provided the residency rule and the inventory hold.

### 2.3 Manifest fan-out (the M3.6c/M4.C discipline; pins per the M6.2 closeout)

Expected deltas — **the P2 consumer/pin survey at EACH M7.x instruction fixes exact numbers before issue; these are the AMD-level expectations, not substitutes for the survey:**

- `EventTypes`: 55 → **71** (+16 constants — rows 3–18).
- `CORE_PRODUCTION_EVENT_CLASSES` / `EXPECTED_EVENT_RECORDS` (+ the `exactlyTwentyFourAnnotatedRecords`-class count pin in `EventTypeAnnotationTest`): 24 → **41** (+17 records — rows 3–19).
- `EventCategoryMapping.TABLE` (+ test): 36 → **+17** rows (`[AUTOMATION]`), survey-confirmed.
- `EventTypeRegistry` / `JacksonWarmup` (+ tests): counts follow the record roster.
- Composition root + integration-test harness aggregation: `Stream`-aggregated at baseline (M6.4-verified, no count pins) — survey re-confirms.
- **Behavioral publish-count pins in producing-module sibling tests** (the M6.4 GF-1 lesson — the survey category that postdates Research 4): every M7.x slice re-runs the survey INCLUDING this category before issue.

**Per-slice fan-out (charter-confirmed placement):** M7.1 = run-initiation slice (rows 1, 3, 11–16, 19 + their pins); M7.2 = run-lifecycle/dispatch slice (rows 2, 4–10, 17, 18); M7.3 = ledger slice (ZERO mints — publish-count pins only). Each slice lands compile-and-commit whole with its registrations (an unregistered type fails encode in production — the M4.C lesson).

### 2.4 Codec + publish discipline

- **AMD-52 codec discipline** for any typed-value-bearing payload: no `@JsonTypeInfo` (ArchUnit Rule 7), tagged-union + exhaustive no-`default` where a sealed value type ever rides (none of the rows above carry `AttributeValue` — `EvaluatedEntityState.value` is the String projection, deliberately; if a future reshape types it, AMD-52 governs).
- **Event-time rule:** run/diagnostic events publish with inherited or null `eventTime` — never `Instant.now()` in the publish path; Clock injection per §4c (automation is non-whitelisted).
- **Causality:** all Run events publish via `EventPublisher.publish()` with the triggering event's `CausalContext` (§3.7 :307 — correlation inheritance is what makes traces assemble per §4.2 and chains derivable per AMD-91).
- **C8 stamping (PROPOSED-PENDING — cited, not assumed):** every automation-originated publish carries `actorRef = AutomationId` per B2-C8 §4.5 (decision PROPOSED 2026-06-08; the bundled review adjudicates it ALONGSIDE this block). Stamping rides the ENVELOPE seam exclusively — REC-39 obligation 5: NO payload-level actor field anywhere in §2.2 (the envelope owns attribution; a payload duplicate would fork the audit surface). `automation_invoked` carries the INVOKER's actorRef (person/API-client per C8 kinds), inherited by the resulting run's events. If C8's ratification adjusts the convention, the stamping tests (M7.2) re-pin — the payload shapes above are C8-independent by construction.

## 3. Downstream Impact

- **event-model:** +16 records/+16 constants/2 reshapes (+ 2 nested records + `EvaluatedEntityState`/`ConflictEntry`); the reshape touches `AutomationTriggeredEvent`/`AutomationCompletedEvent` consumers — at baseline: manifest rosters + serde tests only (NO production producer/consumer exists; zero persisted instances — the reshape is regret-proof NOW and a log-migration later, which is why it rides this block).
- **persistence:** `EventTypeRegistry`/`JacksonWarmup` count updates; serde round-trip tests per slice.
- **state-store:** NONE — no row participates in state projection (observability + trace assembly; trace is query-assembled per §4.2, never materialized).
- **automation (producer, M7.x):** publish sites per slice; DQ-3: ledger projection handlers register on the existing `DispatchingProjectionAdvancer` (separate registrations, same advancer — W0 §2.5.4) — no new advancer.
- **JPMS: ZERO module-info change in BOTH modules** (§7 embeds — everything flattened or already on declared edges).
- **Doc 07/Doc 01 currency:** §3.7 table +`automation_invoked` row (R92-1); §6.2-vs-§3.7 priority correction (R92-3); Doc 01 §4.3 automation-lifecycle table gains the full family; §4.4 mapping rows.

## 4. Implementation Notes

Records follow the `ConfigSectionReloadedEvent` pattern (compact-ctor guards on required fields; nullable-by-Javadoc; defensive copies). Constants grouped under a `// M7 automation vocabulary (AMD-92)` banner in `EventTypes`. The two reshapes REPLACE components outright (no deprecation cycle — zero producers exist; the M1-era shapes were vocabulary placeholders). `matched_triggers` carries triggerIds (AMD-88): the publish path maps index→id; internal keying stays positional.

## 5. Tests (M7 scope, per slice)

| Test | Assertion |
|---|---|
| `EventTypeAnnotationTest` (extended per slice) | roster + count pins updated; every new record `@EventType`-annotated with an `EventTypes` constant |
| `EventCategoryMappingTest` (extended) | +17 `[AUTOMATION]` rows; count pin updated |
| Per-record serde tests | round-trip through the persistence codec incl. nested `EvaluatedEntityState`/`ConflictEntry`; nullable fields null-safe |
| `AutomationTriggeredEventTest` (reshape) | new shape round-trips; `matchedTriggers` carries ids not indices |
| Publish-path tests (M7.1/M7.2) | REC-141 four-detail pins (matched_triggers/resolved_targets/definition_hash + per-condition events); REC-147 pins (`run_skipped`/`run_cancelled` published on mode enforcement) + never-default-SILENT attestation; C8 stamping test cited PROPOSED-pending (re-pin at ratified convention) |
| Trace-assembly test (M7.2) | §4.2 trace assembles from events by correlation_id incl. the new rows; failed-run trace assembles fully inside the 7-day DIAGNOSTIC window (REC-145 narrowed obligation) |

## 6. Scope Fences / Deferred (non-goals)

NO state-projection participation by any row (trace is query-assembled — REC-145's no-ring-buffer structural attestation stands). NO payload-level actor fields (envelope owns attribution). NO webhook-received event (M10). NO energy/C9 vocabulary (C9 rides existing types — its own decision record). NO `PendingStatus`-bearing event surfaces (ledger events pre-exist unchanged). NO dot-namespaced automation types (snake_case family stays). **Anti-requirements:** no engine retry shows up as event vocabulary (REC-162 — no `command_retried` type exists or will); no templating artifacts in payloads (REC-155).

## 7. Invariants and Citations

- **AMD-92-INV-01 (candidate):** Event records in `com.homesynapse.event` never reference automation-resident types; run/status identifiers cross the event boundary only as flattened `Ulid`/`String` components (the E70-1 rule, automation instance). Enforceable by inspection + the JPMS graph itself.
- **AMD-92-INV-02 (candidate):** No automation event type reaches a production publish site before appearing in EVERY manifest/pin the P2 survey enumerates for its slice (the M4.C forcing-function, stated as invariant).
- Cites: Doc 07 §3.4/§3.7/:317–326/§3.7.1/§4.2/§6.2/§6.6/§9; Doc 01 §4.3/§4.4/§4.5/:564; Identity Model §7.5; AMD-52 (codec + cycle class); AMD-70 E70-1 (flatten precedent); AMD-88 §2.2/§2.5; AMD-90 §2.3; AMD-91 §2.3/§2.4; B2-C8 (PROPOSED-pending, §4.5 stamping); merged disposition §2a-F5; W0 §2.5 obligations 1–5; R14-A REC-141/145/147; critical-review 2.2.

**Verbatim `module-info.java` embeds (source at `7c73c91`/`e5ea76f`) — UNCHANGED by this AMD (the load-bearing claim: everything in §2.2 rides existing edges):**

`core/automation/src/main/java/module-info.java` (Javadoc + license header elided; directives verbatim):

```java
module com.homesynapse.automation {
    requires transitive com.homesynapse.platform;
    requires transitive com.homesynapse.event;
    requires transitive com.homesynapse.device;
    requires transitive com.homesynapse.state;

    // M4.0b-4a: PendingCommand's javadoc references com.homesynapse.value
    // .AttributeValue (via {@link Expectation#evaluate}); declared non-transitive
    // (value is not on automation's public API). The type is also reachable
    // transitively through `requires transitive com.homesynapse.device`; the edge
    // is declared explicitly at its use site per the relocation design note.
    requires com.homesynapse.value;

    exports com.homesynapse.automation;
}
```

`core/event-model/src/main/java/module-info.java` (doc comment elided; directives verbatim):

```java
module com.homesynapse.event {
    requires transitive com.homesynapse.value;
    requires transitive com.homesynapse.platform;

    exports com.homesynapse.event;
}
```

## 8. Implementing WU

Per-slice: **M7.1** (rows 1, 3, 11–16, 19), **M7.2** (rows 2, 4–10, 17, 18), **M7.3** (no mints; pins only). Each slice = one compile-and-commit unit with its full fan-out.

## 9. Ratification Checklist

- [ ] Bundled DOCS-Project review returned; deltas folded (R92-1/2/3 adjudicated; type-residency FLATTEN confirmed)
- [ ] **B2 C8 ratified (same bundle)** — stamping tests pin the ratified convention
- [ ] Nick ratification
- [ ] AMD-92-INV-01/02 registered in `Architecture_Invariants_v1.md`
- [ ] Navigation-index amendments row added
- [ ] Doc 07 §3.7 (+invoked row, priority correction) + Doc 01 §4.3/§4.4 currency edits applied
- [ ] Each M7.x P2 survey (incl. publish-count-pin category) enumerated before issue

## 10. Review Disposition

PENDING — rides the bundled M7-block + B2 C8/C9 DOCS review.
