<!--
file: design/amendments/AMD-64_Planned_Restart_Timeout.md
purpose: AMD-64 — per-descriptor plannedRestartTimeout overriding the Doc 05 §3.14 global 60s (REC-51).
audience: Nick (ratify), PM, Coder
status: RATIFIED 2026-06-05 — DOCS-Project review (RATIFY-AS-IS) + Nick ratification; review return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`
source: Research 6 REC-51 ACCEPT (clean override; Doc 05 §3.14 60s remains the fallback)
baseline: homesynapse-core HEAD `e76b925` — IntegrationHealthRecord.plannedRestart boolean source-verified (the planned-restart mechanism exists in the health model)
-->

# AMD-64: `plannedRestartTimeout` on `IntegrationDescriptor`

## 1. Problem Statement

Doc 05 §3.14's planned-restart grace period is a global 60 seconds. A Zigbee coordinator restart (radio re-init, network re-form) can legitimately exceed it; a stateless cloud poller needs far less. One global number forces the worst-case on everyone or false-positive failures on slow adapters.

## 2. Specification

Append `Duration plannedRestartTimeout` to `IntegrationDescriptor` — **nullable** (Javadoc-only nullability convention): `null` means "use the global Doc 05 §3.14 default (60 s)". When present: must be positive (compact-ctor guard). Convenience-ctor default: `null`.

The M9 supervisor reads it wherever the planned-restart window is enforced (the `plannedRestart` flag on `IntegrationHealthRecord` is the existing mechanism hook, source-verified; AMD-55's `RESTART_REQUIRED` outcome is the new trigger that makes per-adapter tuning matter).

## 3. Downstream Impact

M9 only. No JPMS change.

## 4. Tests (M4.C scope)

| Test | Assertion |
|---|---|
| `IntegrationDescriptorTest` (extended) | null accepted (= global default); zero/negative → `IllegalArgumentException`; convenience-ctor default null |

## 5. Invariants and Citations

- **AMD-64-INV-01:** `plannedRestartTimeout == null` ⇒ the global §3.14 default governs; a present value must be positive and fully replaces (never combines with) the global.
- Cites: Doc 05 §3.14; REC-51 disposition; AMD-55 (RESTART_REQUIRED interaction).

Module-info: unchanged — see AMD-54 §7 verbatim embed.

## 6. Implementing WU

**M4.C** (field + guard). Enforcement = M9.

## 7. Ratification Checklist

- [x] DOCS-Project review — [x] Nick ratification — [x] Invariants registered (`Architecture_Invariants_v1.md` §34) — all 2026-06-05

## 8. Review Disposition

**DOCS-Project review (2026-06-05): RATIFY-AS-IS — no edits.** Return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`. REC-51 fidelity verified (null→global 60s fallback; the return's `@Nullable` rendered as Javadoc-only per convention; the return's Zigbee-90s/HTTP-15s figures are adapter-authoring guidance, not contract); `plannedRestart` mechanism hook source-verified; full-replace-never-combine semantics (AMD-64-INV-01) sound. Ratified by Nick 2026-06-05.
