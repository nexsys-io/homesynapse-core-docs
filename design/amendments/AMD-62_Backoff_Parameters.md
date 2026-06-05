<!--
file: design/amendments/AMD-62_Backoff_Parameters.md
purpose: AMD-62 — BackoffParameters record on IntegrationDescriptor (REC-48) + the NQ-5/NQ-6 restart-intensity documentation fold.
audience: Nick (ratify), PM, Coder
status: RATIFIED 2026-06-05 — DOCS-Project review (RATIFY-WITH-EDITS; E10 doc-only edit folded); review return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`
source: Research 6 REC-48 ACCEPT (HA empirical 5/10/20/40/80 schedule; fix @Nullable convention violation) + NQ-5/NQ-6 (RESOLVED: REC-49 rejected; document the OTP embedded override; keep global default + per-descriptor override + pre-M9 spike)
baseline: homesynapse-core HEAD `e76b925` — HealthParameters 11 fields + defaults() (maxRestarts=3, restartWindow=60s) source-verified
-->

# AMD-62: `BackoffParameters` on `IntegrationDescriptor`

## 1. Problem Statement

Transient-failure retry backoff has no declared shape — Doc 05 §3.7 says "retry with backoff" without parameters. HA's empirically-derived schedule (`2 ** min(tries, 4) * 5` → 5/10/20/40/80/80… seconds, source-quoted in Research 6 §2.3) is a production-proven default. Per-adapter override matters: a local serial adapter can retry faster than a rate-limited cloud API.

## 2. Specification

### 2.1 `BackoffParameters` (new record, `com.homesynapse.integration`)

```java
public record BackoffParameters(
        Duration initialDelay,    // > 0
        double multiplier,        // >= 1.0
        Duration maxDelay         // >= initialDelay
) {
    public static BackoffParameters defaults() {
        return new BackoffParameters(Duration.ofSeconds(5), 2.0, Duration.ofSeconds(80));
    }
}
```

`defaults()` reproduces the HA schedule exactly: 5, 10, 20, 40, 80, 80, … No jitter field — deterministic schedules are testable; jitter (if M9 wants it) is supervisor policy, not adapter contract. Nullability convention: Javadoc-only (the research's `@Nullable` annotation violates the codebase rule — integration-api MODULE_CONTEXT gotcha, fixed here per the REC-48 disposition). The research's fourth field — `maxConsecutiveBeforeSuspend` (REC-48, default 5) — is likewise dropped (review E10): it duplicates the existing suspend-threshold surface (`HealthParameters.maxRestarts`/`restartWindow`/`maxSuspensionCycles`, source-verified), the same check-existing-fields rationale that rejected REC-49 (NQ-5).

### 2.2 Descriptor change

Append `BackoffParameters backoffParameters` to `IntegrationDescriptor` — **non-null**, convenience-ctor default `BackoffParameters.defaults()`.

### 2.3 Restart-intensity documentation fold (ratified NQ-5/NQ-6 — Javadoc only, no contract change)

`HealthParameters.defaults()` (source-verified values: `maxRestarts=3`, `restartWindow=60s`) gains a Javadoc note: *the OTP-derived embedded-systems override is `(maxRestarts=1, restartWindow=60s)`; radio-based adapters (Zigbee/Matter) that legitimately glitch during radio init should rely on per-descriptor `HealthParameters` overrides rather than a loosened global default. An empirical spike measuring real Zigbee/Matter restart frequency on Pi 5 hardware is scheduled before M9.* This discharges NQ-5's documentation clause (REC-49 itself stays REJECTED — no `RestartIntensity` record; the fields already exist) and NQ-6's keep-default call. Research 12's restart-intensity findings corroborate (assessment §Strategic impact).

## 3. Downstream Impact

M9 supervisor consumes `backoffParameters` in the transient-retry path. Distinct from probe backoff (`probeInitialDelay`/`probeMaxDelay` on `HealthParameters` — recovery probing, not retry; Javadoc must cross-reference to prevent conflation). No JPMS change.

## 4. Tests (M4.C scope)

| Test | Assertion |
|---|---|
| `BackoffParametersTest` (new) | guards (initialDelay>0, multiplier>=1, maxDelay>=initialDelay); `defaults()` yields the 5/10/20/40/80 schedule under iterated application capped at maxDelay |
| `IntegrationDescriptorTest` (extended) | non-null guard; convenience-ctor default = `defaults()` |

## 5. Invariants and Citations

- **AMD-62-INV-01:** the retry schedule is a pure function of `BackoffParameters` and the attempt count — deterministic, no hidden state.
- **AMD-62-INV-02:** retry backoff (`BackoffParameters`) and recovery probing (`HealthParameters.probe*`) are distinct mechanisms; neither reuses the other's parameters.
- Cites: Doc 05 §3.7; REC-48 disposition (@Nullable fix); NQ-5/NQ-6 (RESOLVED 2026-06-04); REC-49 REJECTED (no new intensity record).

Module-info: unchanged — see AMD-54 §7 verbatim embed.

## 6. Implementing WU

**M4.C** (record + field + Javadoc fold). Supervisor consumption = M9. Pre-M9 Zigbee restart-frequency spike: tracked on the research agenda (NQ-6).

## 7. Ratification Checklist

- [x] DOCS-Project review — [x] Nick ratification — [x] Invariants registered (`Architecture_Invariants_v1.md` §32) — all 2026-06-05

## 8. Review Disposition

**DOCS-Project review (2026-06-05): RATIFY-WITH-EDITS — E10 (doc-only) folded.** Return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`. The `(initialDelay, multiplier, maxDelay)` shape vs. the return's `(minBackoff, maxBackoff, jitterFactor, maxConsecutiveBeforeSuspend)` verified as sound narrowing: defaults reproduce the return's HA-derived 5/10/20/40/80 schedule exactly; jitter is supervisor policy; the fourth field's drop is now documented in §2.1 (NQ-5 existing-fields rationale). NQ-5/NQ-6 rendering verified (REC-49 stays REJECTED; OTP 1/60s embedded override documented; pre-M9 Zigbee spike named). Ratified by Nick 2026-06-05.
