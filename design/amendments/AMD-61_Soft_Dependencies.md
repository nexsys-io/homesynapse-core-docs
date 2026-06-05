<!--
file: design/amendments/AMD-61_Soft_Dependencies.md
purpose: AMD-61 — softDependencies on IntegrationDescriptor + Kahn soft-edge semantics (REC-46).
audience: Nick (ratify), PM, Coder
status: RATIFIED 2026-06-05 — DOCS-Project review (RATIFY-AS-IS) + Nick ratification; review return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`
source: Research 6 REC-46 ACCEPT (clean; matches HA after_dependencies)
baseline: homesynapse-core HEAD `e76b925` — IntegrationDescriptor.dependsOn() Set<String> source-verified (type strings, not IDs)
-->

# AMD-61: `softDependencies` on `IntegrationDescriptor`

## 1. Problem Statement

`dependsOn` (source-verified `Set<String>` of integration *type* strings) declares hard startup ordering: a missing or failed dependency blocks startup. Real adapters also have **preferential** ordering — "start the MQTT broker bridge before me *if it's installed*, but start me regardless" (HA's `after_dependencies`). Without a soft tier, adapter authors abuse `dependsOn` and create spurious startup failures.

## 2. Specification

Append `Set<String> softDependencies` to `IntegrationDescriptor` (defensively copied to an unmodifiable `LinkedHashSet`, matching the existing collection components — source-verified pattern at `IntegrationDescriptor.java:105-106`). Default (8-arg convenience ctor): `Set.of()`.

**Semantics (frozen now, implemented in M9's Kahn ordering):**

- Soft edges participate in the topological sort exactly like hard edges **when the target is present**.
- A soft target that is absent, failed, or excluded: log at **INFO** (not WARN — REC-46's explicit HA-aligned call), drop the edge, start anyway.
- Cycle detection treats hard+soft edges uniformly (a cycle through a soft edge is still a descriptor validation error — determinism over leniency).
- The same type string appearing in both `dependsOn` and `softDependencies` is a descriptor validation error (compact-ctor guard).

## 3. Downstream Impact

`IntegrationStartupOrderer` (M9 internal type) implements the semantics. No JPMS change.

## 4. Tests (M4.C scope)

| Test | Assertion |
|---|---|
| `IntegrationDescriptorTest` (extended) | defensive copy + unmodifiability; convenience-ctor default `Set.of()`; overlap with `dependsOn` → `IllegalArgumentException` |

## 5. Invariants and Citations

- **AMD-61-INV-01:** a missing/failed soft dependency never blocks startup (INFO log only); a missing hard dependency always does.
- **AMD-61-INV-02:** `dependsOn ∩ softDependencies = ∅`, enforced at construction.
- Cites: Doc 05 §4.1 (descriptor), MODULE_CONTEXT contract "dependsOn declares startup ordering / Kahn with cycle detection"; INV-RF-03.

Module-info: unchanged — see AMD-54 §7 verbatim embed.

## 6. Implementing WU

**M4.C** (field + guards). Kahn soft-edge behavior = M9.

## 7. Ratification Checklist

- [x] DOCS-Project review — [x] Nick ratification — [x] Invariants registered (`Architecture_Invariants_v1.md` §31) — all 2026-06-05

## 8. Review Disposition

**DOCS-Project review (2026-06-05): RATIFY-AS-IS — no edits.** Return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`. REC-46 fidelity verified incl. the INFO-not-WARN call (return verbatim: "Soft-edge violations log at INFO, not WARN"); `Set<String>` type-string vocabulary (vs. the return's `Set<IntegrationId>`) verified as the correct narrowing matching the source-verified `dependsOn` shape; uniform cycle detection and the `dependsOn ∩ softDependencies = ∅` guard are sound additions frozen here. Ratified by Nick 2026-06-05.
