<!--
file: design/amendments/AMD-63_Isolation_Level_Reservation.md
purpose: AMD-63 — IsolationLevel enum + isolationLevel descriptor field, reservation-only (REC-50, corrected: NEW field — no existing isolationHint to rename).
audience: Nick (ratify), PM, Coder
status: RATIFIED 2026-06-05 — DOCS-Project review (RATIFY-AS-IS) + Nick ratification; review return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`
source: Research 6 REC-50 ACCEPT(RENAME) as corrected by PLAN-M4-CONSOLIDATED-v2 §6 [VR §B F-C]: "ADD a new field + IsolationLevel enum; there is no existing isolationHint to rename"
baseline: homesynapse-core HEAD `e76b925` — IntegrationDescriptor has no isolation field (verified: 8 components)
-->

# AMD-63: `IsolationLevel` Reservation on `IntegrationDescriptor`

## 1. Problem Statement

All adapters run in-JVM today (LTD-17 isolation is module/context-level, not process-level). Post-MVP, misbehaving native/JNI adapters (serial drivers) may warrant subprocess isolation. Reserving the enum slot **now** costs one field; adding it after adapters ship is a retroactive descriptor amendment across every published adapter. This is the same cheap-insurance pattern as AMD-34's schema reservation.

## 2. Specification

```java
public enum IsolationLevel {
    /** Adapter runs in the core JVM under supervisor thread management (MVP — the only supported level). */
    IN_JVM,
    /** Reserved for post-MVP subprocess isolation. The M9 supervisor REJECTS this value
     *  with UnsupportedOperationException at startup. */
    RESERVED_SUBPROCESS
}
```

Append `IsolationLevel isolationLevel` to `IntegrationDescriptor` — non-null, convenience-ctor default `IN_JVM`. **Correction folded (v2 plan [VR §B F-C]):** this is a **new** field; the research's "rename `isolationHint`" referenced a field that does not exist (source-verified at `e76b925`). Field name `isolationLevel` matches the enum, per the REC-50 disposition's naming intent.

## 3. Downstream Impact

M9 supervisor: startup validation rejects `RESERVED_SUBPROCESS` with `UnsupportedOperationException` ("subprocess isolation is reserved and not implemented" — Register C). No isolation machinery of any kind. No JPMS change.

## 4. Tests (M4.C scope)

| Test | Assertion |
|---|---|
| `IsolationLevelTest` (new) | exactly 2 values, order pinned |
| `IntegrationDescriptorTest` (extended) | non-null guard; convenience-ctor default `IN_JVM` |

## 5. Invariants and Citations

- **AMD-63-INV-01:** `RESERVED_SUBPROCESS` is rejected at supervisor startup until a future amendment activates it; no code path may treat it as runnable.
- Cites: REC-50 disposition; v2 plan §6 correction [VR §B F-C]; AMD-34 (reservation precedent); LTD-17.

Module-info: unchanged — see AMD-54 §7 verbatim embed.

## 6. Implementing WU

**M4.C** (enum + field). Rejection behavior = M9.

## 7. Ratification Checklist

- [x] DOCS-Project review — [x] Nick ratification — [x] Invariants registered (`Architecture_Invariants_v1.md` §33) — all 2026-06-05

## 8. Review Disposition

**DOCS-Project review (2026-06-05): RATIFY-AS-IS — no edits.** Return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`. REC-50 fidelity verified — enum members `IN_JVM, RESERVED_SUBPROCESS` and the `UnsupportedOperationException` rejection match the return verbatim; the no-existing-`isolationHint` correction independently confirmed at `e76b925` (8 components, no isolation field); Register C rejection message present. Ratified by Nick 2026-06-05.
