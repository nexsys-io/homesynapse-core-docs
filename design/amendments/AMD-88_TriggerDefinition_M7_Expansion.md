<!--
file: design/amendments/AMD-88_TriggerDefinition_M7_Expansion.md
purpose: AMD-88 — TriggerDefinition M7 expansion: 3 new Tier-1 permits (Calendar/Reachability/Manual), the WebhookTrigger promotion, the PresenceTrigger promotion-designation (fields M8), and stable triggerId on every permit (REC-31/32/37/38 per the 2026-06-12 merged disposition §2a-F1).
audience: Nick (ratify), PM, Coder, independent DOCS-Project reviewer
status: PROPOSED 2026-06-13 — awaits the bundled DOCS review (M7 block + B2 C8/C9) + Nick ratification
source: Research 4 REC-31/32/37/38 (PM Assessment v3 source-verified, v4 DQ-1/DQ-2/DQ-5 Nick-resolved 2026-05-30) via context/planning/2026-06-12_M7-blueprint_merged-disposition.md §2a-F1; W0 currency delta §2.1 (arithmetic re-verified at 7c73c91)
baseline: homesynapse-core HEAD `e5ea76f` (substantive `7c73c91` — automation module last touched M4.0b-4a); TriggerDefinition 9 permits (5 Tier 1 + 4 Tier 2) source-verified at this baseline
-->

# AMD-88: TriggerDefinition M7 Expansion — New Permits, Promotions, `triggerId`

**Block context:** First of the six-amendment M7 automation block (AMD-88..93). Expands the trigger hierarchy 9 → 12 permits and gives every trigger a stable identity. Breaking only in the additive-sealed sense (new permits add switch cases); promotions are field-additions and add **no** new switch cases.

## 1. Problem Statement

`TriggerDefinition` (source-verified at `7c73c91`: 9 permits — 5 Tier 1 `StateChangeTrigger`/`StateTrigger`/`EventTrigger`/`AvailabilityTrigger`/`NumericThresholdTrigger` + 4 Tier 2 empty records `TimeTrigger`/`SunTrigger`/`PresenceTrigger`/`WebhookTrigger`) lacks the trigger classes competitive research ranked highest (Research 4 §3.2): webhook, calendar, device-reachability, and manual invocation. Triggers are also identified only positionally (`trigger_index`; `DurationTimer` keyed `(automationId, triggerIndex)`; `RunContext.matchedTriggers` is `List<Integer>`), which makes traces fragile across definition edits and gives users no stable handle (REC-38, the HA Trigger-ID lesson).

## 2. Specification

### 2.1 Permit arithmetic (W0 §2.1, re-verified at baseline)

| Action | Kind | Permit count effect |
|---|---|---|
| `CalendarTrigger` — genuinely new | new Tier-1 permit | +1 |
| `ReachabilityTrigger` — genuinely new (REC-32) | new Tier-1 permit | +1 |
| `ManualTrigger` — genuinely new (REC-37) | new Tier-1 permit | +1 |
| `WebhookTrigger` — Tier 2 → Tier 1 | promotion (field addition) | 0 |
| `PresenceTrigger` — promotion-designation (DQ-1) | binding posture only; record unchanged in M7 | 0 |

**9 → 12 permits** (8 Tier 1 + 4 Tier 2 → after this AMD: Tier 1 = 9 of 12 — the five existing + Calendar + Reachability + Manual + Webhook; Tier 2 remaining = `TimeTrigger`, `SunTrigger`, `PresenceTrigger`). **Promotions are field-additions to existing empty records — they add NO new sealed-exhaustiveness switch cases; only the three genuinely-new permits do.** Consumers that pattern-match exhaustively gain exactly three cases.

### 2.2 New Tier-1 permits

- **`CalendarTrigger(EntityId calendarEntityId, CalendarEventTransition transition, Duration offset)`** — fires when a calendar-integration entity's event starts/ends. `transition` is a new automation-resident enum `CalendarEventTransition { EVENT_START, EVENT_END }`; `offset` nullable (fire before/after by the offset; null = at transition). NO `forDuration` (inherently instantaneous — the AMD-25 `EventTrigger` class). No calendar integration ships in MVP; the permit freezes the shape regret-proof (the Tier-1-shape-now pattern), and evaluation activates when a calendar-capable integration produces the consumed events. [REVIEW-POINT R88-1: field set proposed by the PM from REC-31's `CalendarTrigger(EntityId, CalendarEventTransition, Duration)` — confirm or adjust.]
- **`ReachabilityTrigger(DeviceId deviceId, Availability targetAvailability, Duration forDuration)`** — fires on **device-subject** `availability_changed` transitions (Doc 01 §4.3 lists `availability_changed` with Subject Entity/Device — the device-level event already exists in the taxonomy; **no new event type is minted**). `targetAvailability` reuses `com.homesynapse.state.Availability` exactly as `AvailabilityTrigger` does; `forDuration` nullable per AMD-25 (the standard temporal mechanism). **PM adjustment vs REC-32's letter:** the REC's `debounce` field (default 30 s) is REPLACED by `forDuration` — debounce IS sustained-predicate semantics and the AMD-25 duration-timer machinery already provides it; a parallel debounce concept would duplicate the mechanism. The REC's 30 s default becomes authoring guidance, not a field. REC-32's claimed dependency (`device.reachable_changed`, the Research-8 REC-25 event) never shipped — this permit binds to the shipped taxonomy instead. [REVIEW-POINT R88-2: confirm the availability_changed binding + the debounce→forDuration substitution.]
- **`ManualTrigger(String invocationContext)`** — fires on explicit invocation (REST `POST /automations/{id}/invoke` at M10, UI button, voice). `invocationContext` nullable (free-text origin note surfaced in the trace; the project convention is nullable-with-Javadoc, NOT `Optional` components — REC-37's `Optional<String>` is adjusted). An automation whose only trigger is `ManualTrigger` is what other platforms call a scene (REC-37; scenes-as-automations, the rejected-Scene-primitive decision). Invocation produces the **`automation_invoked`** event (minted in AMD-92 §2.2; subject Automation; the envelope's `actorRef` carries the invoker — the C8 seam, PROPOSED-pending). The trigger consumes that event; `RunContext.triggeringEventId` references it. NO `forDuration`.

### 2.3 WebhookTrigger promotion (Tier 2 → Tier 1)

`WebhookTrigger()` (empty) gains fields: **`WebhookTrigger(String webhookId, Set<String> allowedMethods, boolean localOnly)`** — `webhookId` non-null/non-blank (the path discriminator); `allowedMethods` non-null, defensive-copied, defaulted at YAML load to `{"POST"}` (carried as `Set<String>` of HTTP method names — no HTTP-client type appears on the automation API; REC-31's `Set<HttpMethod>` is flattened to strings deliberately); `localOnly` default `true` (LAN-only exposure posture, consistent with the local-first brand). NO `forDuration`. The producing event (the REST layer's webhook-received publish) is **named and minted by the M10 REST amendment, not here** — the permit shape is frozen now so `automations.yaml` definitions are forward-stable; the evaluator simply has no matching events until M10 wires the producer (benign no-match, not the §6.1-class Tier-2-fallback warning — the permit IS Tier 1 once promoted).

### 2.4 PresenceTrigger promotion-designation (DQ-1 — binding, zero code change in M7)

Nick's DQ-1 ruling (2026-05-30) is REGISTERED as the binding shape: **`PresenceTrigger` is the designated zone/presence permit; a separate `ZoneTrigger` permit is permanently rejected.** Its promotion fields (person/tracker reference, zone, transition — the REC-31 `ZoneTrigger` field content migrates here) and evaluation logic land at **M8.1** with the person/location infrastructure (DQ-5). In M7 the record stays the Tier-2 empty `public record PresenceTrigger() implements TriggerDefinition {}` — byte-identical, no compile impact.

### 2.5 `triggerId` — stable trigger identity on every permit (REC-38)

Every **Tier-1** permit gains a **`String triggerId`** component (first component position is NOT required; append per-record consistently — exact position frozen at implementation). Semantics:

- User-assignable in YAML (`trigger_id:`); when unset, **assigned at load time as a ULID string** and persisted back through the identity machinery alongside the §4.1 identity model (the `automations.ids.yaml` pattern governs durability of generated IDs across reloads — same file, per-trigger sub-entries; exact persistence shape frozen at M7.1 implementation).
- Uniqueness scope: within one automation definition (validated at YAML load).
- **Additive identity, not a re-keying:** the engine-internal keying stays positional exactly as Locked — `DurationTimer` remains keyed `(automationId, triggerIndex)` (Doc 07 §3.4), `RunContext.matchedTriggers` remains `List<Integer>` (AMD-91 does not touch it), and the §3.7 reload hash-comparison stays per-index. `triggerId` is the USER-FACING identity: the reshaped `automation_triggered.matched_triggers` payload carries trigger IDs (AMD-92 §2.1), traces and diagnostics reference them, and duration-timer events carry both index and id.
- Tier-2 empty records (`TimeTrigger`, `SunTrigger`, `PresenceTrigger`) gain the field at their own promotions, not now (an empty record with one field is no longer empty — promotion semantics would blur).
- REC-38's companion `TriggerIdCondition` permit for `ConditionDefinition` is **explicitly NOT included** — the merged disposition's F1 scope is `triggerId()` only; the condition permit is queued as a future item if authoring demand materializes (§6).

## 3. Downstream Impact

- **Sealed-exhaustiveness consumers:** every exhaustive `switch` over `TriggerDefinition` gains exactly 3 cases (Calendar/Reachability/Manual). At baseline no Phase-3 evaluator exists yet (automation is Phase-2-only code) — the construction-site blast radius is **tests + the M7.1 evaluator built against the post-AMD hierarchy**, which is why this block precedes M7.1 (entry-gate row 1).
- **TriggerEvaluator (M7.1):** trigger index gains device-subject `availability_changed` routing (Reachability) and `automation_invoked` routing (Manual). Calendar/Webhook routes are registered but produce no matches until their producers exist.
- **Event vocabulary:** `automation_invoked` rides AMD-92's manifest fan-out (one of the two non-Doc-07-inventory mints, flagged there).
- **JPMS:** ZERO module-info change. `DeviceId`/`EntityId` (platform, `requires transitive`), `Availability` (state, `requires transitive`) are already on the automation API surface. New enums (`CalendarEventTransition`) are automation-resident.
- **Doc 07 §3.4:** the Tier-1 trigger table gains 4 rows (3 new + webhook), the Tier-2 table shrinks to 3; §8.2 type table updated. Doc-currency edits ride ratification (the AMD-67 §3.7-banner pattern).

## 4. Implementation Notes

`CalendarEventTransition` follows the existing automation-enum conventions (values UPPER_SNAKE, no wire-format methods — these enums never appear in event payloads; AMD-92's type-residency rule). YAML field names: `trigger_id`, `webhook_id`, `allowed_methods`, `local_only`, `calendar_entity`, `transition`, `offset`, `device`, `target_availability`, `invocation_context` — schema fragment updated in the same WU (AMD-93 substrate). Compact constructors null-guard required fields only; cross-field validation at YAML load (per the standing §3.3 split).

## 5. Tests (M7 scope)

| Test | Assertion |
|---|---|
| `TriggerDefinitionPermitTest` (extended) | permits clause lists exactly 12; the 3 new permits construct; promotions construct with fields; Tier-2 empties unchanged |
| `TriggerIdAssignmentTest` | unset `trigger_id` → load-time ULID assigned + stable across reload; duplicate ids within one automation rejected at load |
| `ReachabilityTriggerEvaluationTest` (M7.1) | device-subject `availability_changed` matches; entity-subject does NOT; `forDuration` timer lifecycle per AMD-25 |
| `ManualTriggerEvaluationTest` (M7.1) | `automation_invoked` initiates a run; `triggeringEventId` = the invocation event; actorRef inherited per C8 (cited PROPOSED-pending) |
| Construction-site sweep test | every existing `TriggerDefinition` construction site (tests, fixtures) compiles against the new shapes |

## 6. Scope Fences / Deferred (non-goals)

NO `ZoneTrigger` permit (permanently rejected, DQ-1). NO geofence fields or presence evaluation (M8.1). NO `TimeTrigger`/`SunTrigger` promotion (Tier 2; scheduler/solar — the REC-166 misfire/DST field-shape input is parked in the FUTURE-AMD queue for that promotion). NO webhook-received event mint (M10 REST amendment). NO `TriggerIdCondition` (future, demand-gated). NO internal re-keying from index to triggerId. **Anti-requirement (REC-155, explicit non-goal):** no templating DSL anywhere in trigger definitions — trigger fields are typed values, never template strings (HA's largest authoring-failure class; the sealed-permit design forecloses it deliberately).

## 7. Invariants and Citations

- **AMD-88-INV-01 (candidate):** A Tier-2→Tier-1 promotion is a field-addition to an existing permit — it never adds, removes, or renames a sealed permit. Sealed-exhaustiveness switch shape changes ONLY when a genuinely-new permit lands.
- **AMD-88-INV-02 (candidate):** Every Tier-1 `TriggerDefinition` permit carries a `triggerId` that is stable across definition reloads once assigned; user-facing trace and event surfaces reference triggers by `triggerId`, never by raw index.
- Cites: Doc 07 §3.4 (trigger types + evaluation procedure), §3.5 (dedup), §8.2 (type table); AMD-25 (`forDuration` machinery, EventTrigger exclusion precedent); Doc 01 §4.3 (`availability_changed` Entity/Device subject); W0 delta §2.1/§3 (DQ-1/2/5 decided ground); merged disposition §2a-F1; B2 C8 (PROPOSED — cited, not assumed ratified); AMD-92 (`automation_invoked` mint + type-residency).

**Verbatim `module-info.java` (`com.homesynapse.automation`, at `7c73c91`/`e5ea76f`) — UNCHANGED by this AMD** (all referenced types already on the declared edges; full file incl. header comments embedded at AMD-92 §7 alongside the event-model module-info):

```java
module com.homesynapse.automation {
    requires transitive com.homesynapse.platform;
    requires transitive com.homesynapse.event;
    requires transitive com.homesynapse.device;
    requires transitive com.homesynapse.state;

    requires com.homesynapse.value;

    exports com.homesynapse.automation;
}
```

## 8. Implementing WU

**M7.1** (trigger/condition path) — permits + triggerId + evaluator routing. PresenceTrigger fields: M8.1. Webhook producer: M10.

## 9. Ratification Checklist

- [ ] Bundled DOCS-Project review returned; deltas folded
- [ ] Nick ratification
- [ ] AMD-88-INV-01/02 registered in `Architecture_Invariants_v1.md`
- [ ] Navigation-index amendments row added (watermark AMD-87 → 93 at block ratification)
- [ ] Doc 07 §3.4/§8.2 currency edits applied
- [ ] M7.1 consumer/pin survey enumerates the construction-site sweep set before issue (P2)

## 10. Review Disposition

PENDING — rides the bundled M7-block + B2 C8/C9 DOCS review.
