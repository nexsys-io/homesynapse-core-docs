<!--
file: design/amendments/AMD-58_Integration_Lifecycle_Event_Expansion.md
purpose: AMD-58 — five new IntegrationLifecycleEvent permits (REC-44's four + IntegrationReauthCompleted), 5→10; dot-namespaced event-type strings.
audience: Nick (ratify), PM, Coder
status: PROPOSED — pending DOCS-Project review + Nick ratification (Workstream C block, AMD-54..64)
source: Research 6 REC-44 ACCEPT + assessment note "the 5 new permits (REC-44's 4 + the IntegrationReauthCompleted in §7.3) land in integration-api alongside the existing 5"; AMD-33 (permits live in com.homesynapse.integration, NOT event-model)
baseline: homesynapse-core HEAD `e76b925` — sealed hierarchy source-verified: 5 permits; IntegrationEvents.LIFECYCLE_EVENT_CLASSES = 5 entries; EventTypes INTEGRATION_* = 5 constants; zero dot-namespaced strings exist anywhere in EventTypes
-->

# AMD-58: IntegrationLifecycleEvent Expansion (5 → 10 permits)

## 1. Problem Statement

The AMD-55 hook flows and the AMD-56 reauth path produce observable lifecycle transitions that today have no event vocabulary: a config update applied (or restart-scheduled), an options update, a reauth demand, a reauth completion, a config-schema migration. Without events, these flows are invisible to the event log, automations (M8), the WS stream (M11), and the audit narrative. Freezing the records now (with the M9 supervisor as producer) avoids re-opening the sealed hierarchy later — the exact retroactive tax REC-44 exists to prevent.

## 2. Specification

### 2.1 Five new records (all `com.homesynapse.integration`, implementing `IntegrationLifecycleEvent`)

> **[REVIEW-FLAG R5 — name provenance.]** REC-44's four event names are not enumerated in the on-disk assessment; the five names below are PM-derived 1:1 from the AMD-55 hook flows plus the assessment's explicitly-named `IntegrationReauthCompleted` (§7.3). The DOCS-Project review MUST diff names and per-permit fields against the Research 6 return §REC-44/§7.3 and correct verbatim if they differ.

All five satisfy the sealed parent's 5-accessor contract (source-verified: `integrationId(), integrationType(), previousState() [nullable only for IntegrationStarted], newState(), reason()`). For these five, lifecycle flows do not change `HealthState`, so `previousState` and `newState` both carry the current state (non-null).

| Record | Extra components | `@EventType` string |
|---|---|---|
| `IntegrationConfigUpdated` | `ConfigUpdateOutcome outcome` | `integration.config.updated` |
| `IntegrationOptionsUpdated` | `ConfigUpdateOutcome outcome` | `integration.options.updated` |
| `IntegrationReauthRequired` | *(none)* | `integration.reauth.required` |
| `IntegrationReauthCompleted` | `boolean succeeded` | `integration.reauth.completed` |
| `IntegrationMigrationCompleted` | `int fromMajor, int fromMinor, int toMajor, int toMinor, MigrationOutcome outcome` | `integration.migration.completed` |

No timestamp components — `EventEnvelope` owns `eventTime`/`ingestTime` (house rule; the existing 5 permits carry none).

### 2.2 Naming convention (the dot-namespace decision)

Per the REC-44 disposition (ACCEPTed "dot-namespaced") and the project-wide direction for new event families (automation `automation.run.*`, config `config.*` — both already briefed dot-namespaced to Research 7): **new event-type strings use the `integration.` dot-namespace.** The existing five snake_case strings (`integration_started` … `integration_resource_exceeded`) are **frozen forever** — they are persisted in event logs and can never be renamed (Path-B/AMD-52 discipline: stored type strings are immutable contract).

**Consequence (source-verified):** `IntegrationEventTypeAnnotationTest` pins `values_use_integration_-prefix` (`integration_`). Its prefix predicate must evolve to accept `integration_` (legacy five, frozen) **or** `integration.` (new five and all future additions). The collision-prevention purpose (flat namespace shared with core `EventTypes`) is preserved by both prefixes.

### 2.3 Registration lockstep (the forcing function — three-way)

1. **`EventTypes` (event-model):** five new `String` constants (`INTEGRATION_CONFIG_UPDATED = "integration.config.updated"`, …). String constants only — **no event-model record, no module-info change** (precedent: the existing five INTEGRATION_* constants).
2. **`IntegrationEvents.LIFECYCLE_EVENT_CLASSES`:** 5 → 10 entries (source-verified current `List.of(...)` of 5).
3. **`IntegrationEventTypeAnnotationTest.EXPECTED_SUBTYPES`:** 5 → 10 (the authoritative registrable set per the integration-api MODULE_CONTEXT).

`@EventType` lives on the concrete records only, never the sealed parent (pinned by `sealedParent_doesNotHaveAnnotation`).

## 3. Downstream Impact

- **persistence:** `EventPayloadCodecTest`'s integration round-trip set grows 5 → 10 (the existing `testImplementation`-scoped dependency — no production ripple, source-verified MODULE_CONTEXT note).
- **Projection classification:** all five are **observability-only** (no `DispatchingProjectionAdvancer` handler; they change no entity state). Required classification per Research 8 REC-28.
- **M11 WS filters:** `WsSubscriptionFilter.eventTypes` must accept dot-namespaced strings (Research 7 brief already carries this; no M4 work).
- **No JPMS / Gradle change.**

## 4. Tests (M4.C scope)

| Test | Assertion |
|---|---|
| `IntegrationEventTypeAnnotationTest` (evolved) | 10 subtypes; all annotated; parent unannotated; values unique; values match EventTypes constants; prefix `integration_` or `integration.` |
| `EventPayloadCodecTest.IntegrationEvents` (extended) | all 10 round-trip through encode/decode |
| New per-record shape tests | component counts + accessor contract (previousState non-null for all five new permits) |

## 5. Scope Fences / Deferred

NO producer code (M9 supervisor emits these). NO consumer code (M8/M10/M11).

## 6. Invariants and Citations

- **AMD-58-INV-01:** every `IntegrationLifecycleEvent` permit is registered in `IntegrationEvents.LIFECYCLE_EVENT_CLASSES`, `EXPECTED_SUBTYPES`, and `EventTypes` in the same commit — three-way lockstep, no partial registration.
- **AMD-58-INV-02:** persisted event-type strings are immutable; new strings are dot-namespaced `integration.`; the legacy snake_case five are frozen.
- **AMD-58-INV-03:** the five new permits are observability-only — they never mutate projection state.
- Cites: AMD-33 (permits live in integration-api; DomainEvent permanently non-sealed); DECIDE-04 (manifest aggregation, no ServiceLoader; ArchUnit Rule 3); Research 8 REC-28 (state-changing vs observability classification); INV-HO-04 (reason voice).

Module-info: unchanged — see AMD-54 §7 verbatim embed.

## 7. Implementing WU

**M4.C.**

## 8. Ratification Checklist

- [ ] DOCS-Project review (**R5: names/fields vs the Research 6 return**)
- [ ] Nick ratification
- [ ] Invariants registered

## 9. Review Disposition

*(populated at ratification)*
