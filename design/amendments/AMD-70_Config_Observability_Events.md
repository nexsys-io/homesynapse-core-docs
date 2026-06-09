<!--
file: design/amendments/AMD-70_Config_Observability_Events.md
purpose: AMD-70 — config.validation_completed + config.section_reloaded observability events in com.homesynapse.event (REC-59 + REC-61 folded).
audience: Nick (ratify), PM, Coder
status: PROPOSED 2026-06-08 — M6 config block (AMD-66..71); awaits DOCS-Project review + Nick ratification
source: Research 5 REC-59 (PM Assessment v2: ACTIVE) + REC-61 (MERGED into REC-59) + NQ-5 (RESOLVED — com.homesynapse.event flat, AMD-52 precedent)
baseline: homesynapse-core HEAD `6c6dd33`; event-model manifest pattern source-verified at M3.6c / M4.C (EventTypes, EventCategoryMapping, EventTypeRegistry, JacksonWarmup)
-->

# AMD-70: Configuration Observability Events — `config.validation_completed` + `config.section_reloaded`

**Block context:** Fifth of the six-amendment M6 configuration block (AMD-66..71). Adds two **observability-only** domain events; classification only, no state-derivation participation.

## 1. Problem Statement

Doc 06's reload/validation pipeline produces a `ReloadResult` (source-verified: 3 fields — `newModel`, `changeSet`, `issues`) and validation `ConfigIssue`s, but emits **no domain event** when a validation pass completes or a section reloads. Observers (the REST API change-notification surface, the dashboard, the audit log) have no event to subscribe to. Research 5 REC-59 (+ REC-61, folded) adds two dot-namespaced events. They are **observability** — they do not drive state projection (the config file remains the sole source of truth, INV-CE-01).

## 2. Specification

### 2.1 Two new event records (`com.homesynapse.event` — flat package, AMD-52 precedent)

Per NQ-5 (RESOLVED) and the AMD-52 precedent, new domain event records land in **`com.homesynapse.event`** (the flat event package), **not** in `com.homesynapse.config`. The legacy `config_changed` / `secret_added` / `secret_removed` events already live there — these join them.

- **`config.validation_completed`** — emitted after a load/reload validation pass. Payload (contingent on AMD-67): `(int configSchemaMajor, int configSchemaMinor, int issueCount, Map<Severity,Integer> severityCounts)`. If AMD-67 is **not** ratified, the payload reverts to a single `int schemaVersion`.
- **`config.section_reloaded`** — emitted per section actually changed by a reload. Payload: the section path + a `ReloadResult` breakdown (REC-61 — pure additive consumption of the existing 3-field `ReloadResult`; the record is not modified) + the section's applied `ReloadClassification` (from AMD-66's listener, or the property-default fallback).

Exact record component lists are Phase-2-frozen at M6.1 implementation against the then-current `ReloadResult`/`Severity`/`ReloadClassification` shapes (source-verified, no fabrication); the **contract** here is the event names, package, payload semantics, and observability-only classification.

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

- [ ] DOCS-Project review returned; deltas folded
- [ ] Nick ratification
- [ ] AMD-70-INV-01 registered in `Architecture_Invariants_v1.md`
- [ ] Navigation-index amendments row added (watermark unchanged — 70 < 87)
- [ ] M6.1 consumer/pin survey enumerates the exact manifest set before issue (P2)

## 10. Review Disposition

_Pending DOCS-Project review (M6 config block AMD-66..71)._ Review note: payload `(major, minor)` is contingent on AMD-67; category mapping `[SYSTEM]` is PM-confirmable at review (derived lookup).
