# AMD-26: sqlite-jdbc Virtual Thread Carrier Pinning Mitigation

**Amendment ID:** AMD-26
**Tier:** CRITICAL (Virtual Thread Risk Audit)
**Status:** APPLIED
**Date applied:** 2026-03-21
**Target documents:** LTD-01, LTD-03, LTD-11 (Locked Decisions Register)
**Source:** Virtual Thread Risk Audit Report, Step 7 — Remediations
**Findings addressed:** C-01 (LTD-01 reversal criteria), C-02 (LTD-11 subscriber specification), C-03 (LTD-03 sqlite-jdbc threading constraint)

## Problem

The Locked Decisions Register did not document that xerial sqlite-jdbc pins virtual thread carrier threads on every database operation due to `synchronized native` methods in `NativeDB.java`. This omission propagated through all 14 design documents, producing 7 CRITICAL and 14 SIGNIFICANT incorrect assumptions about virtual thread safety.

## Changes Applied

1. **LTD-01 reversal criteria** — Replaced `synchronized` block pinning language with JNI pinning language. Documents that JEP 491 (Java 25) does NOT eliminate sqlite-jdbc pinning. Establishes 75% carrier utilization as the monitoring threshold.

2. **LTD-03 specification** — Inserted two new paragraphs after the sqlite-jdbc driver reference: "Virtual thread constraint" (explains the double-pinning mechanism) and "Mandatory mitigation" (establishes the platform thread executor pattern with specific sizing guidance).

3. **LTD-11 specification** — Replaced the subscriber threading paragraph to document that SQLite-touching subscribers route operations through the platform thread executor rather than executing JNI calls directly on virtual threads.

## Downstream Dependencies

AMD-26 establishes the governance foundation for:
- **AMD-27** — Doc 04 (Persistence Layer) platform thread executor design
- **AMD-28** — Doc 01 (Event Model) write path and performance target updates
- **AMD-29** — Doc 03 (State Store) projection subscriber threading
- **AMD-30** — LTD-08 (Jackson ObjectMapper warm-up)
- Downstream design doc amendments for Doc 07, 09, 10, 11, 12, 14
- MODULE_CONTEXT updates for event-bus, automation, persistence, state-store

## Escalation Resolutions

- **Escalation 1 (LTD placement):** LTD-03 confirmed as home for executor pattern. The constraint is a direct consequence of the sqlite-jdbc driver choice.
- **Escalation 2 (-Xss512k on ARM64):** Retained at 512k. Validate empirically in Phase 3 WAL spike.
- **Escalation 3 (WAL spike scope):** VT carrier pinning tests consolidated into existing spike.
