<!--
file: design/amendments/AMD-70_Config_Observability_Events.md
purpose: AMD-70 — config.validation_completed + config.section_reloaded observability events in com.homesynapse.event (REC-59 + REC-61 folded).
audience: Nick (ratify), PM, Coder
status: RATIFIED 2026-06-09 (Nick) — DOCS review RATIFY-WITH-EDITS, edits E70-1 (**load-bearing JPMS-cycle fix** — payloads flattened to event-resident types + type-residency rule) + E70-2 folded `aedff55`; return: nexsys-hivemind `context/audits/2026-06-09_AMD-66-71_DOCS_Review_Return.md`
source: Research 5 REC-59 (PM Assessment v2: ACTIVE) + REC-61 (MERGED into REC-59) + NQ-5 (RESOLVED — com.homesynapse.event flat, AMD-52 precedent)
baseline: homesynapse-core HEAD `6c6dd33`; event-model manifest pattern source-verified at M3.6c / M4.C (EventTypes, EventCategoryMapping, EventTypeRegistry, JacksonWarmup)
-->

# AMD-70: Configuration Observability Events — `config.validation_completed` + `config.section_reloaded`

**Block context:** Fifth of the six-amendment M6 configuration block (AMD-66..71). Adds two **observability-only** domain events; classification only, no state-derivation participation.

## 1. Problem Statement

Doc 06's reload/validation pipeline produces a `ReloadResult` (source-verified: 3 fields — `newModel`, `changeSet`, `issues`) and validation `ConfigIssue`s, but emits **no domain event** when a validation pass completes or a section reloads. Observers (the REST API change-notification surface, the dashboard, the audit log) have no event to subscribe to. Research 5 REC-59 (+ REC-61, folded) adds two dot-namespaced events. They are **observability** — they do not drive state projection (the config file remains the sole source of truth, INV-CE-01).

## 2. Specification

### 2.1 Two new event records (`com.homesynapse.event` — flat package, AMD-52 precedent)

Per NQ-5 (RESOLVED) and the AMD-52 precedent, new domain event records land in **`com.homesynapse.event`** (the flat event package), **not** in `com.homesynapse.config`. The legacy `config_changed` / `config_error` events (`ConfigChangedEvent`, `ConfigErrorEvent`) already live there — these join them. _(E70-2: corrected from `secret_added`/`secret_removed`, which do **not** exist in source at `6c6dd33` — that claim was propagated unverified from the Research 5 return; `EventTypes` carries `CONFIG_CHANGED` + `CONFIG_ERROR` only.)_

**Type-residency rule (E70-1 — load-bearing, JPMS-cycle avoidance).** Event records in `com.homesynapse.event` **must not reference `com.homesynapse.config` types** — `config` already `requires transitive com.homesynapse.event`, so a config type in an event record would force the reverse `event → config` edge: a **JPMS cycle, the exact AMD-52 `event↔device` class** (Doc 15 §3.8). The payloads are therefore **flattened to event-module-resident / `java.base` types only**, matching the existing all-String `ConfigChangedEvent` precedent (source-verified `(String configPath, String previousValue, String newValue)`). `Severity`, `ReloadResult`, and `ReloadClassification` are **consumed to derive the flattened components, never referenced as types** in the event record.

- **`config.validation_completed`** — emitted after a load/reload validation pass. Payload (contingent on AMD-67): `(int configSchemaMajor, int configSchemaMinor, int issueCount, Map<String,Integer> severityCounts)` — `severityCounts` keys are `Severity.name()`. If AMD-67 is **not** ratified, the schema component reverts to a single `int schemaVersion`.
- **`config.section_reloaded`** — emitted per section actually changed by a reload. Payload: `(String sectionPath, int changeCount, int issueCount, String appliedClassification)` — `appliedClassification` = `ReloadClassification.name()` (from AMD-66's listener, or the property-default fallback); the `ReloadResult` (REC-61) is *consumed* to derive `changeCount`/`issueCount`, never referenced as a type.

Exact flattened component lists are Phase-2-frozen at M6.1 implementation; the **contract** here is the event names, package, the **type-residency rule above**, the flattened-payload semantics, and observability-only classification. _(Alternative — landing the records in `com.homesynapse.config` behind a `ConfigEvents` manifest, the IntegrationEvents/M3.6c pattern — was considered and rejected: it contradicts the Nick-resolved NQ-5 and adds a manifest + composition-root aggregation site for two observability events.)_

### 2.2 Manifest registration (the M3.6c / M4.C consumer-pin discipline)

New event types must be registered in **every** event-type manifest/pin the M4.C gate-fix enumerated, or the build breaks (the M4.C lesson: an unregistered event type fails `encode` in production and trips count-pinned tests). At M6.1 the coding instruction MUST run the **P2 consumer/pin survey** and enumerate the exact set before issue. The known sites (source-verified at M4.C) are:

- `EventTypes` — add the two string constants (`config.validation_completed`, `config.section_reloaded`); update any count-pin.
- the core production event-class manifest (the `CORE_PRODUCTION_EVENT_CLASSES` / `AllEventClasses.ALL_EVENTS` roster, M3.6c pattern) — add the two records.
- `EventCategoryMapping.TABLE` (+ `EventCategoryMappingTest`) — map both to **`[SYSTEM]`** (observability; a derived runtime lookup, freely amendable — PM confirms category at review per the M4.C `[REVIEW]` precedent).
- `EventTypeRegistry` (+ test), `JacksonWarmup` (+ test) — counts updated.
- the production composition root + integration-test harness aggregation, if they pin counts (the M4.C straggler sites).

## 3. Downstream Impact

- **`ConfigurationService.reload()`** publishes these via the injected `EventPublisher` (`com.homesynapse.event`) — `config` already `requires transitive com.homesynapse.event` (source-verified module-info), so **no JPMS change**.
- **State projection:** none — observability-only; not in the projection advancer's handled set (INV-CE-01).
- **REST API (Doc 09, M10):** the eventual change-notification endpoint consumes `config.section_reloaded`; out of M6 scope.

## 4. Implementation Notes

The events are published on the same virtual thread that completes the reload, after the AMD-66 listener classification (AMD-66-INV-02 ordering). `config.validation_completed` fires once per validation pass; `config.section_reloaded` fires once per changed section. Derived/observability events use inherited or null `eventTime` — never `Instant.now()` in the publish path (the standing event-time rule).

## 5. Tests (M6 scope)

| Test | Assertion |
|---|---|
| `ConfigValidationCompletedEventTest` | payload carries `(major, minor, issueCount, severityCounts)`; round-trips through the event codec |
| `ConfigSectionReloadedEventTest` | one event per changed section; carries the `ReloadResult` breakdown + classification |
| `EventCategoryMappingTest` (extended) | both new types mapped (count +2) |
| `EventTypeRegistryTest` / `JacksonWarmupTest` (extended) | registered (counts +2); encode/decode round-trips |
| `ConfigurationServiceReloadTest` | reload publishes the events in order, after listener classification |

## 6. Scope Fences / Deferred

NO change to `ReloadResult` (additive consumption only — REC-61). NO state-derivation participation. NO REST endpoint (M10). Payload `(major, minor)` is **contingent on AMD-67** (reverts to single `schemaVersion` if AMD-67 is rejected).

## 7. Invariants and Citations

- **AMD-70-INV-01:** `config.validation_completed` and `config.section_reloaded` are observability-only — no state projection consumes them; the config file remains the sole source of truth (INV-CE-01).
- Cites: Doc 06 §3.3/§4.3 (`ReloadResult`); AMD-52 / NQ-5 (event package landing, flat `com.homesynapse.event`); M3.6c manifest pattern; M4.C consumer/pin-survey lesson; AMD-66 (classification source); AMD-67 (payload pair).

**Verbatim `module-info.java` (`com.homesynapse.config`, at `6c6dd33`) — unchanged by this AMD** (events land in `com.homesynapse.event`, already `requires transitive`):

```java
module com.homesynapse.config {
    requires transitive com.homesynapse.event;

    exports com.homesynapse.config;
}
```

## 8. Implementing WU

**M6.1** (config pipeline) — the events fire from the loader/reload path. No crypto gate.

## 9. Ratification Checklist

- [x] DOCS-Project review returned; deltas folded — 2026-06-09 (E70-1 + E70-2 folded, commit `aedff55`)
- [x] Nick ratification — 2026-06-09
- [x] AMD-70-INV-01 registered in `Architecture_Invariants_v1.md` (§40) — 2026-06-09
- [x] Navigation-index amendments row added (watermark unchanged — 70 < 87) — 2026-06-09
- [x] M6.1 consumer/pin survey enumerates the exact manifest set before issue (P2) — VERIFIED complete by the review 2026-06-09 (§2.2 set correctly enumerated; **M6.4 must re-run the survey for `config.section_reloaded`**)

## 10. Review Disposition

**DOCS-Project review (2026-06-09): RATIFY-WITH-EDITS — E70-1 (load-bearing) + E70-2, folded by the PM 2026-06-09 and committed at docs `aedff55`.** Return: nexsys-hivemind `context/audits/2026-06-09_AMD-66-71_DOCS_Review_Return.md` (block verdict RATIFY-WITH-EDITS; source baseline re-derived independently at `6c6dd33`). **E70-1 was the block's load-bearing catch:** the originally-specified payload types (`Map<Severity,Integer>`, `ReloadResult` breakdown, `ReloadClassification`) are config-module types inside event-resident records → an `event→config` JPMS cycle, the exact AMD-52 `event↔device` class. Folded as the §2.1 flattening (`Map<String,Integer>` keyed by `Severity.name()`; `String appliedClassification`) + the **type-residency rule** (config types are *consumed* to derive flattened components, never *referenced* in event records) — the rule now also stands in the P2 consumer/pin survey and the pm-/coder-lessons as the standing JPMS contract-direction discipline. E70-2: the `secret_added`/`secret_removed` claim was propagated unverified from Research 5 — source carries `CONFIG_CHANGED`/`CONFIG_ERROR` only; corrected. Payload `(major, minor)` contingency resolved — AMD-67 RATIFIED same block, the pair stands. `[SYSTEM]` category confirmed (consistent with `CONFIG_CHANGED → [SYSTEM]`). The §7 verbatim `module-info.java` embed source-verified at `6c6dd33`. Ratified by Nick 2026-06-09 at the M6 config-block ratification (watermark unchanged at AMD-87).
