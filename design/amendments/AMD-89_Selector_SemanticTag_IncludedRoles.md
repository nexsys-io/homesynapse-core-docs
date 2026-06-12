<!--
file: design/amendments/AMD-89_Selector_SemanticTag_IncludedRoles.md
purpose: AMD-89 — Selector M7 expansion: SemanticTagSelector permit + role-based default exclusion (includedRoles) on group-resolving permits — BREAKING to existing permit constructors; construction-site sweep mandated (REC-34/35 per the merged disposition §2a-F2).
audience: Nick (ratify), PM, Coder, independent DOCS-Project reviewer
status: PROPOSED 2026-06-13 — awaits the bundled DOCS review (M7 block + B2 C8/C9) + Nick ratification
source: Research 4 REC-34/35 (PM Assessment v3 source-verified) via merged disposition §2a-F2; W0 §2.3 (AMD-routing sharpened: breaking permit change = block item, never instruction-level)
baseline: homesynapse-core HEAD `e5ea76f` (substantive `7c73c91`); Selector 6 permits (all Tier 1) + Entity 12 fields incl. `labels: List<String>` + `entityRole: EntityRole` source-verified at this baseline
-->

# AMD-89: Selector M7 Expansion — `SemanticTagSelector` + Role-Based Default Exclusion

**Block context:** Second of the six-amendment M7 automation block (AMD-88..93). One new permit (6 → 7) plus a **BREAKING** field addition to the three group-resolving permits. The breaking change is the block's construction-site sweep item.

## 1. Problem Statement

Two gaps (Research 4 §3.1, HA 2021.11/2024.4 lessons): (1) the `Selector` hierarchy (source-verified 6 permits: `DirectRefSelector`/`SlugSelector`/`AreaSelector`/`LabelSelector`/`TypeSelector`/`CompoundSelector`) has no tag-vocabulary selection; (2) group-resolving selectors (`AreaSelector` "all entities in the kitchen", `TypeSelector` "all lights") resolve DIAGNOSTIC and CONFIG entities alongside PRIMARY ones — a motion-automation targeting "all kitchen entities" should not actuate a polling-interval CONFIG entity. HA and HomeKit both converged on category-based default exclusion (voice assistants exclude diagnostic/config since HA 2021.11 / HomeKit 2022.2); HomeSynapse shipped the classification substrate at M4 (AMD-44: `EntityRole { PRIMARY, DIAGNOSTIC, CONFIG }` on `Entity`, legality-matrix-guarded) but the selector layer ignores it.

**Naming correction (Check-11 class — the disposition label vs source):** the merged disposition carries REC-35's field as `includedCategories` (the researcher inherited HA's `entity_category` vocabulary, and Research 8's REC-23 proposed an `EntityCategory` enum). **`EntityCategory` does not exist in source.** The shipped M4 type is **`EntityRole`** (AMD-44, `com.homesynapse.device`). This AMD binds to the real type and names the field **`includedRoles`** — Glossary discipline over disposition label. [REVIEW-POINT R89-1: confirm the rename; the alternative (an `includedCategories` field of type `Set<EntityRole>`) preserves the REC label at the cost of a name/type mismatch.]

## 2. Specification

### 2.1 New permit: `SemanticTagSelector` (6 → 7 permits)

**`SemanticTagSelector(String namespace, String value, MatchMode matchMode, Set<EntityRole> includedRoles)`** — selects entities whose labels match a namespaced tag. `matchMode` is a new automation-resident enum **`MatchMode { EXACT, NAMESPACE_PREFIX }`**. Namespaced-tag convention over the SHIPPED substrate: `Entity.labels` (`List<String>`, source-verified) carries tags as `namespace:value` strings (e.g. `room:kitchen`, `safety:critical`); `EXACT` matches `namespace:value`, `NAMESPACE_PREFIX` matches any label in the namespace. **No new device-model type and no `Entity` change** — the Research-8 REC-26 `SemanticTag`-replaces-labels migration did NOT ship (labels remain `List<String>` at baseline); this permit defines the tag CONVENTION on the existing field. If a future device-model amendment ships first-class tags, this permit's resolution re-binds without shape change. [REVIEW-POINT R89-2: confirm the convention-over-labels grounding.]

### 2.2 BREAKING: `includedRoles` on the three group-resolving permits

The three existing group-resolving permits each gain a **non-null `Set<EntityRole> includedRoles`** component (defensive-copied; YAML default applied at load = `Set.of(EntityRole.PRIMARY)`):

- `AreaSelector(String areaSlug)` → `AreaSelector(String areaSlug, Set<EntityRole> includedRoles)`
- `LabelSelector(String label)` → `LabelSelector(String label, Set<EntityRole> includedRoles)`
- `TypeSelector(String entityType)` → `TypeSelector(String entityType, Set<EntityRole> includedRoles)`

(+ `SemanticTagSelector` carries it from birth, §2.1.) **Resolution semantics:** `SelectorResolver` filters the resolved set to entities whose `entityRole` ∈ `includedRoles` — silently (no per-entity diagnostic; the resolved set in the `automation_triggered` payload IS the observability). `DirectRefSelector`/`SlugSelector` are exempt (explicit single-entity reference is an unambiguous user intent — role filtering would surprise); `CompoundSelector` composes filtered operands (intersection unchanged).

**This is a breaking canonical-constructor change.** Per W0 §2.3, breaking permit changes are block items, never instruction-level folds. **Construction-site sweep mandated:** the M7.1 coding instruction's P2 consumer/pin survey MUST enumerate every `AreaSelector`/`LabelSelector`/`TypeSelector` construction site (at baseline: Phase-2 tests and fixtures only — no production evaluator exists yet) and update each to pass an explicit role set; the sweep result is listed in the instruction before issue (the M6-block discipline).

**No serialized-form migration is needed** (vs REC-35's migration step): automation definitions are YAML re-parsed on every load — there are no persisted serialized `Selector` instances. Existing `automations.yaml` files without `included_roles` get the PRIMARY-only default at load, which CHANGES resolution behavior for definitions that previously (in the pre-M7, never-executed Phase-2 world) would have matched DIAGNOSTIC/CONFIG entities — acceptable exactly because no production evaluator has ever run (zero behavioral regression surface at baseline; post-M7 this default is the documented contract).

## 3. Downstream Impact

- **Sealed-exhaustiveness consumers:** every exhaustive switch over `Selector` gains 1 case (`SemanticTagSelector`).
- **`SelectorResolver` (M7.1):** gains tag matching (label-scan, optionally indexed later — the critical-review 10.8 note stands) + role filtering on group paths. Resolution remains snapshot-at-trigger-time (C4; no re-resolution mid-Run).
- **AMD-92 coupling:** `resolved_targets` in the reshaped `automation_triggered` payload reflects post-filter sets — the trace shows exactly what role filtering produced.
- **JPMS:** ZERO module-info change — `EntityRole` is `com.homesynapse.device`, already `requires transitive`. `MatchMode` is automation-resident.
- **Doc 07 §3.12:** selector vocabulary table +1 row; group-permit field lists updated; the role-exclusion default documented. §8.2 updated.

## 4. Implementation Notes

YAML keys: `semantic_tag: {namespace:, value:, match_mode:, included_roles:}`, `included_roles: [primary, diagnostic, config]` (lower-case wire forms mapped at load). Role filtering applies at RESOLUTION time only — identity-model §7.2/§7.3 dedup and tombstone-chain rules are untouched. The compact constructors null-guard + `Set.copyOf()`; empty `includedRoles` is rejected at YAML load (an automation that can never resolve anything is a misconfiguration — WARNING-class per the §6.1 path).

## 5. Tests (M7 scope)

| Test | Assertion |
|---|---|
| `SelectorPermitTest` (extended) | permits clause lists exactly 7; new shapes construct; defensive copies hold |
| `SemanticTagResolutionTest` | EXACT vs NAMESPACE_PREFIX matching against `Entity.labels`; no match → empty set |
| `RoleFilterTest` | Area/Label/Type/SemanticTag resolution excludes DIAGNOSTIC/CONFIG by default; explicit `included_roles` opts in; DirectRef/Slug bypass filtering |
| `CompoundIntersectionTest` (extended) | intersection over post-filter operand sets |
| Construction-site sweep | every baseline construction site updated + compiling (survey-enumerated) |

## 6. Scope Fences / Deferred (non-goals)

NO `EntityCategory` type mint (the shipped `EntityRole` is the substrate). NO device-model change (no first-class `SemanticTag` type; no `Entity` shape change — labels-as-tags convention only). NO resolver-side tag index in M7 (resolution is scan-based; index if 10.8-class evidence demands). NO role filtering on Direct/Slug selectors. NO per-entity skip diagnostics (resolved-set observability suffices). **Anti-requirement (REC-155):** tag matching is EXACT/NAMESPACE_PREFIX only — no pattern templates, no expression matching.

## 7. Invariants and Citations

- **AMD-89-INV-01 (candidate):** Group-resolving selectors (`AreaSelector`, `LabelSelector`, `TypeSelector`, `SemanticTagSelector`) resolve PRIMARY-role entities only unless the definition explicitly opts into DIAGNOSTIC/CONFIG via `includedRoles`. Explicit single-entity selectors are never role-filtered.
- Cites: Doc 07 §3.12 (selector vocabulary, intersection semantics), §7.3 (dedup); AMD-44 (`EntityRole` + legality matrix, M4.B-S2); Identity Model §7.2/§7.5 (resolution time, tombstone chains); merged disposition §2a-F2; W0 §2.3 (block-routing rule); AMD-88 §7 module-info embed (unchanged here too — `EntityRole` rides the existing device edge).

## 8. Implementing WU

**M7.1** (trigger/condition path — `SelectorResolver` is an M7.1 deliverable; the sweep rides the same WU).

## 9. Ratification Checklist

- [ ] Bundled DOCS-Project review returned; deltas folded (R89-1 naming + R89-2 grounding adjudicated)
- [ ] Nick ratification
- [ ] AMD-89-INV-01 registered in `Architecture_Invariants_v1.md`
- [ ] Navigation-index amendments row added
- [ ] Doc 07 §3.12/§8.2 currency edits applied
- [ ] M7.1 P2 survey enumerates the construction-site sweep set before issue

## 10. Review Disposition

PENDING — rides the bundled M7-block + B2 C8/C9 DOCS review.
