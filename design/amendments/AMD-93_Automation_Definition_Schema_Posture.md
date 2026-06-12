<!--
file: design/amendments/AMD-93_Automation_Definition_Schema_Posture.md
purpose: AMD-93 — automations.yaml definition-schema posture: (major,minor) schema_version on the AMD-67 substrate + forward-only idempotent migration guarantee + dangling-reference load validation; Doc 07 §3.3 ↔ AMD-66/71 reconciliation stated (REC-150 ⊕ 153a⊕136 per merged disposition §2a-F6; W0 §4.2).
audience: Nick (ratify), PM, Coder, independent DOCS-Project reviewer
status: PROPOSED 2026-06-13 — awaits the bundled DOCS review (M7 block + B2 C8/C9) + Nick ratification
source: R14-A REC-150 (ACCEPT lightened — posture statement) + REC-153a (M7 half of the split; co-anchored with the queued REC-136 family) via merged disposition §2a-F6; W0 §4.2 (the config-substrate reconciliation obligation)
baseline: homesynapse-core HEAD `e5ea76f` (substantive `7c73c91`) — the shipped AMD-66..71 config pipeline (M6.1/M6.4/M6.2) is the loading substrate; docs `ed5cf91`. Doc 07 §4.1 :584 (secondary-doc registration) source-verified.
-->

# AMD-93: `automations.yaml` Definition-Schema Posture — Versioning, Migration Guarantee, Reference Validation

**Block context:** Sixth of the six-amendment M7 automation block (AMD-88..93). Documents-and-schema posture: zero new Java contract types; one YAML key; one validation pass; the explicit Doc 07 §3.3 ↔ shipped-config-substrate reconciliation. Mostly attestation — deliberately the block's lightest member (REC-150 "lightened").

## 1. Problem Statement

Three currency gaps between Locked Doc 07 and the shipped M6 ground: (1) `automations.yaml` (Doc 07 §4.1) declares NO schema version — the Groovy/Rule-Machine migration-trap evidence (REC-150/151) says a definition corpus without a versioned schema eventually forces destructive migration; (2) reference integrity (entity slugs, area slugs, automation slugs) is validated only as "unknown entity slug" inside §6.1's generic class — dangling references after renames/removals are the quiet breakage class (REC-153a; HA's silent-breakage complaints); (3) Doc 07 §3.3 was Locked before the M6 config block shipped — the reload/listener/write-path semantics it assumes must be explicitly reconciled to AMD-66/71 and the M6.2 fail-closed write posture (W0 §4.2: an AMD-block obligation, not an instruction-level note).

## 2. Specification

### 2.1 `(major, minor)` schema version (REC-150 — the AMD-67 substrate, applied)

`automations.yaml` gains a top-level key:

```yaml
schema_version: { major: 1, minor: 0 }
automations:
  - …
```

- Semantics IDENTICAL to AMD-67's system-document pair (adopted, not re-invented): **major** = breaking layout change, migration required; **minor** = additive within major, older minors tolerated by the loader without migration (AMD-67-INV-02's tolerance rule applies verbatim to this document class).
- Absent key → `(1, 0)` assumed (every pre-M7 file is definitionally version 1.0; the assumption is logged once at INFO, not warned — absence is the common initial state).
- The M7 schema (AMD-88/89/90 fields) IS `(1, 0)` — versioning starts at the first frozen vocabulary, so no migration exists yet and none is needed to adopt this AMD.
- **Forward-only idempotent migration guarantee (stated as posture, binding on every future migrator):** automation-definition migrations run forward only (never downgrade), are idempotent (re-running a completed migration is a no-op), write a pre-migration backup before touching the file (the AMD-16/AMD-71 backup conventions), and NEVER drop or rewrite user content destructively — a definition the migrator cannot mechanically convert is left in place, reported per §6.1, and excluded from loading (valid-subset semantics) rather than deleted or mangled. This is the REC-151 anti-requirement made structural (§6).

### 2.2 Dangling-reference load validation (REC-153a — within the §6.1 frame)

A reference-integrity pass runs at load AND reload, after JSON-Schema validation, per definition:

- **Checked references:** entity slugs/ULIDs in selectors (`DirectRefSelector`/`SlugSelector` targets), area slugs (`AreaSelector`), automation slugs (`InvokeAutomationAction.automationSlug` — AMD-90), calendar entity references (`CalendarTrigger.calendarEntityId` — AMD-88). Label/type/tag selectors are NOT reference-checked (they legitimately match zero entities — empty resolution is their contract, not breakage).
- **Severity:** a dangling reference is a per-definition validation FAILURE on the §6.1 path — the definition is not loaded, valid definitions in the same file load normally, `config_error` carries the automation name + the dangling reference + the line number, health → DEGRADED. (Not WARNING: an automation that silently can never fire is the precise failure class this kills. Slug-tombstone redirects per Identity Model §7.5 are followed FIRST — a redirected slug is valid-with-DIAGNOSTIC (`automation_slug_redirect`, AMD-92 row 11), not dangling.) [REVIEW-POINT R93-1: failure-vs-warning severity for the InvokeAutomationAction forward-reference case — definitions may legitimately reference an automation defined LATER in the same file; the pass therefore resolves automation-slug references against the POST-parse set of the whole file, and only cross-file/absent slugs fail.]
- **REC-136 queue annotation (already applied at the merged disposition):** this pass discharges the automation-internal half of the queued Research-13 REC-136 reference-integrity family; the config-side half (cross-section config references at composition root) REMAINS queued — the FUTURE-AMD entry is annotated, not closed.

### 2.3 Doc 07 §3.3 ↔ shipped-config-substrate reconciliation (W0 §4.2 — stated, binding)

- **Registration:** `automations.yaml` is a Doc 06 §7 secondary config document (Doc 07 §4.1 :584 — already registered; ATTESTED, no change) validated through the M6.1 `SchemaRegistry`/`JsonSchemaCompositeValidator` pipeline; the automation schema fragment registers at startup (`registerCoreSchema`, the MODULE_CONTEXT Phase-3 note).
- **Placement:** AMD-71's hybrid directory layout governs where `automations.yaml` and `automations.ids.yaml` live; the identity companion is engine-managed (NOT user-edited) and sits beside the definition file per AMD-71's layout rules (exact path = AMD-71's existing decision; nothing new here).
- **Hot-reload classification:** automation definition reload rides the AMD-66 listener-classification machinery — the automation engine registers a `ConfigurationChangeListener` (the Doc-01-§-Reload direct-callback path, which the event-model MODULE_CONTEXT already names the Automation Engine as using) classified **HOT** for `automations.yaml` changes: reload re-parses definitions, preserves in-progress Runs against their original definition snapshots (C7 — Locked, unchanged), reconciles duration timers per the §3.7 hash-comparison rules (Locked, unchanged), and never requires process restart. Identity stability across reloads (slug → `AutomationId` via `automations.ids.yaml`) is the Locked §4.1 mechanism, unchanged.
- **Write-path posture (M6.2 R-1, inherited):** UI/API mutation of `automations.yaml` rides the config `write()` path — which REJECTS tag-bearing documents fail-closed until the tag-preserving emitter exists (the queued post-MVP AMD). Consequence stated plainly: programmatic automation editing (M10) of files carrying `!secret`/`!env` tags is unavailable until that AMD lands; hand-edits + reload are unaffected. (Automation definitions rarely carry secrets; webhook configurations may — the M10 design notes this fence.)

## 3. Downstream Impact

- **Code (M7.1):** the schema fragment gains `schema_version` + the AMD-88/89/90 field vocabulary; the reference pass implements in the loading path (`AutomationRegistry.load/reload` pre-step). No new public automation types.
- **AMD-92 coupling:** `automation_slug_redirect` (row 11) is this pass's redirect diagnostic; `config_error` (existing) carries failures.
- **Doc 07:** §4.1 gains the `schema_version` key + posture paragraph; §6.1 gains the reference-pass sentence + redirect-vs-dangling distinction; §3.3 gains the AMD-66/71 reconciliation note (the AMD-67 §3.7-banner pattern).
- **JPMS/Gradle:** ZERO change. (The automation module's Phase-3 config dependency — `implementation` + `requires com.homesynapse.config` when the implementation imports `ConfigurationService`/`SchemaRegistry` — is the FIX-07 re-add the MODULE_CONTEXT already anticipates; it rides the M7.1 instruction as the pre-authorized Phase-3 wiring, NOT a contract change here. Stated so the survey expects it.)

## 4. Implementation Notes

The reference pass runs against the registries AFTER the State Store/Device Model are caught up (Doc 12 startup sequencing — automation subscribes after state catch-up; load-time validation therefore sees a populated registry). On reload, the pass sees current registries by construction. Validation errors are user-legible (REC-149's nicety: name the automation, the reference, the line). The pass is pure read — no events except `config_error`/`automation_slug_redirect`.

## 5. Tests (M7 scope)

| Test | Assertion |
|---|---|
| `SchemaVersionTest` | absent key → (1,0) assumed + INFO once; minor-ahead tolerated; major-ahead rejected per AMD-67-INV-02 semantics; malformed pair → schema validation failure |
| `DanglingReferenceTest` | dangling entity/area/automation/calendar refs → per-definition failure, valid subset loads, `config_error` payload pins (name/ref/line); same-file forward automation-slug reference loads (R93-1) |
| `TombstoneRedirectTest` | tombstoned slug follows chain + `automation_slug_redirect` published; redirect ≠ failure |
| `ReloadClassificationTest` (M7.1) | automations.yaml change classifies HOT; in-progress Runs complete on original snapshot (C7); timers reconcile per §3.7 |
| Migration-guarantee attestation | no migrator exists at (1,0) — a test asserts the loader refuses a HIGHER major with the §6.1 path (the forward-only floor, testable today) |

## 6. Scope Fences / Deferred (non-goals)

NO migrator implementation (none needed at (1,0) — the posture binds future ones). NO new validation framework (the M6.1 pipeline is the substrate). NO stable entity-reference indirection (REC-153b — FUTURE-AMD, parked un-drafted). NO config-side reference integrity (REC-136 remainder — stays queued). NO tag-preserving emitter (queued post-MVP AMD — inherited fence, restated). **Anti-requirement (REC-151, explicit non-goal):** NO destructive forced migration of user automation definitions, ever — the Groovy/Rule-Machine corpus-loss class is structurally excluded by §2.1's guarantee. **Anti-requirement (REC-155):** the schema defines typed fields only — no template-string escape hatches enter the definition language through versioning.

## 7. Invariants and Citations

- **AMD-93-INV-01 (candidate):** Automation-definition migrations are forward-only and idempotent, always preceded by a backup, and never destructively rewrite or drop a user definition — unconvertible definitions are excluded-and-reported, not modified (REC-151 structural).
- **AMD-93-INV-02 (candidate):** Every loaded automation definition has fully-resolvable references at load time (post-tombstone-redirect); a definition with dangling references never enters the registry.
- Cites: Doc 07 §3.3/§4.1 :584/§6.1; Doc 06 §7 (secondary docs) + §3.2 (SchemaRegistry); AMD-66 (listener classification), AMD-67 (the (major,minor) substrate + INV-02 tolerance), AMD-71 (layout + fail-closed validation surfacing), AMD-16 (backup conventions), M6.2 R-1 (fail-closed write posture, the tag-emitter queue); Identity Model §7.5; merged disposition §1.3/§2a-F6; R14-A REC-149/150/151/153a; W0 §4.2; AMD-88/90/92 (the referencing fields + redirect diagnostic). Module-info UNCHANGED (embed at AMD-92 §7; the FIX-07 Phase-3 config wiring rides M7.1 as pre-authorized implementation detail).

## 8. Implementing WU

**M7.1** (trigger/condition path — definition loading is its first deliverable; the schema fragment + reference pass land with it).

## 9. Ratification Checklist

- [ ] Bundled DOCS-Project review returned; deltas folded (R93-1 adjudicated)
- [ ] Nick ratification
- [ ] AMD-93-INV-01/02 registered in `Architecture_Invariants_v1.md`
- [ ] Navigation-index amendments row added (block watermark AMD-87 → 93)
- [ ] Doc 07 §3.3/§4.1/§6.1 currency edits applied
- [ ] REC-136 FUTURE-AMD queue annotation confirmed (automation half discharged; config half remains)

## 10. Review Disposition

PENDING — rides the bundled M7-block + B2 C8/C9 DOCS review.
