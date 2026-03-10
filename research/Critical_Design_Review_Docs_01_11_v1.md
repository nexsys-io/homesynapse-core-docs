# HomeSynapse Core — Critical Design Review (Docs 01–11)

**Document type:** Research artifact — decision record
**Status:** Complete (archived)
**Date:** 2026-03-09
**Scope:** Adversarial architecture review of all 11 locked design documents
**Reviewer:** Fresh-perspective critical analysis (no access to prior review context)
**Owner:** nick@nexsys.io

---

## 1. Review Methodology

The critical design review was conducted as a fresh-perspective adversarial analysis of all 11 HomeSynapse Core subsystem design documents (Docs 01–11) after all documents reached Locked status. The review was cross-referenced against:

- Architecture Invariants v1 (all INV-* citations)
- Locked Decisions Register v1 (all 17 LTDs)
- Project MVP v1 (scope constraints and acceptance criteria)
- Portability Architecture v1 (deployment tier model)

**Review approach:** The reviewer treated each document as a specification that would be handed to an independent engineering team for Phase 2 interface specification and Phase 3 implementation. The question was: "If I implement exactly what this document says, what breaks?" This surfaces gaps at subsystem boundaries, missing failure modes, underspecified contracts, and implicit assumptions that would produce contradictory implementations.

**Output:** 24 specification-level amendments (AMD-01 through AMD-24) organized by priority tier. The amendments document (`governance/Design_Review_Amendments_v1.md`) contains the full specification text for each amendment.

---

## 2. Findings Summary by Tier

### Original Classification (Reviewer)

| Tier | Count | Description |
|---|---|---|
| BLOCKING | 6 | Must resolve before Phase 2 interface specs — would produce wrong/incomplete interfaces |
| REQUIRED | 10 | Must resolve before Phase 3 implementation — would produce incorrect runtime behavior |
| RECOMMENDED | 8 | Should resolve — improves production resilience, not functionally blocking |

### Three Systemic Themes

The 24 amendments clustered around three systemic themes:

**Theme 1 — Boundary Contracts.** Gaps at subsystem interfaces where two documents each assumed the other specified the contract. Examples: EventPublisher durability semantics (AMD-01), REPLAY→LIVE reconciliation (AMD-02), cascade depth governance (AMD-04), projection versioning (AMD-10). These were the highest-risk items because they would produce contradictory Phase 2 interfaces.

**Theme 2 — Production Resilience.** Missing failure modes, recovery paths, and operational safety mechanisms not addressed in design-time analysis. Examples: state staleness detection (AMD-11), device orphan lifecycle (AMD-17), secrets store backup (AMD-16), route health monitoring (AMD-07), configuration migration (AMD-13). These represent the gap between "works on the happy path" and "works in a real home."

**Theme 3 — API Stability.** Gaps in the REST and WebSocket API contracts that would cause client-facing issues in production. Examples: idempotency keys (AMD-08), correlation ID in error responses (AMD-15), rate limiting governance (AMD-09), write endurance monitoring (AMD-05). These protect the API contract from issues that are expensive to fix post-release.

---

## 3. Final Amendment Disposition

After review, Nick reclassified amendments from the original tiers. Two amendments were rejected. The final disposition:

### Accepted: 4 BLOCKING (applied in Round 10)

| AMD | Title | Target | Applied |
|---|---|---|---|
| AMD-02 | REPLAY→LIVE Reconciliation Pass | Doc 03 §3.2.1 | Session 1 (Part 2) |
| AMD-03 | Snapshot Usage Pattern for Automation | Doc 07 §3.8 | Session 1 (Part 2) |
| AMD-04 | Cascade Depth Limiting | Doc 07 §3.7.1, Doc 01 §4.4 | Session 1 (Part 2) |
| AMD-10 | Projection Logic Versioning | Doc 03 §3.3/§3.6/§8.3 | Session 1 (Part 2) |

### Accepted: 9 REQUIRED (applied in Round 11)

| AMD | Title | Target | Applied |
|---|---|---|---|
| AMD-05 | daily_bytes_written Metric | Doc 11 §3.5 | Session 2 (Part 3) |
| AMD-07 | Route Health Monitoring | Doc 08 §3.15 | Session 2 (Part 3) |
| AMD-08 | Idempotency Keys | Doc 09 §3.4 | Session 2 (Part 3) |
| AMD-09 | WebSocket Rate Limiting | Doc 10 §3.10 | Pre-applied (Part 1, Round 8–9) |
| AMD-11 | State TTL | Doc 03 §3.8 | Session 2 (Part 3) |
| AMD-13 | Configuration Migration Framework | Doc 06 §3.7 | Session 2 (Part 3) |
| AMD-14 | Adapter Dependency Ordering | Doc 05 §3.13 | Session 2 (Part 3) |
| AMD-15 | Correlation ID in Error Responses | Doc 09 §3.8 | Session 2 (Part 3) |
| AMD-16 | Secrets Store Backup | Doc 06 §3.4 | Session 2 (Part 3) |
| AMD-17 | Device Orphan Lifecycle | Doc 02 §3.15 | Session 2 (Part 3) |

### Accepted: 9 RECOMMENDED (not yet applied — opportunistic)

| AMD | Title | Target | Notes |
|---|---|---|---|
| AMD-12 | API Key Permission Scoping | Doc 09 | Tier 2 concern; Tier 1 is single-user |
| AMD-18 | Causal Chain Timeout Extension | Doc 07 | Candidate for Doc 12 integration |
| AMD-19 | Emergency Retention Priority Refinement | Doc 04 | Enhances retention under storage pressure |
| AMD-20 | YAML Parser Safety Configuration | Doc 06 | Defensive hardening |
| AMD-21 | WAL Checkpoint Strategy Storage Awareness | Doc 04 | NVMe vs SD card awareness |
| AMD-22 | Observability Alerting Foundation | Doc 11 | Candidate for Doc 12 integration (HealthChangeListener) |
| AMD-23 | Cross-Protocol Device Identity Resolution | Doc 02 | Tier 2 concern; single-protocol in Tier 1 |
| AMD-24 | Configuration Reload Atomicity Clarification | Doc 06 | Documentation precision |

### Rejected: 2

| AMD | Title | Reason |
|---|---|---|
| AMD-01 | EventPublisher.publish() Durability Contract | Already specified. Doc 01 §8.3 states "publish() returns after the event has been assigned a global_position and written to the append-only log." AMD-02's reconciliation pass provides the safety net for the crash window. Reviewer conceded this was adequately covered. |
| AMD-06 | Single-Writer Contention Analysis | Already addressed. Doc 04's SQLite WAL single-writer model and Doc 01's subscriber model ensure no contention beyond designed backpressure. The analysis would produce "no issue found." Reviewer conceded this was not a real gap. |

### Reviewer Concessions

The reviewer explicitly conceded on AMD-01 and AMD-06 after examining the existing specification text more carefully. On AMD-01, the durability semantics are stated in Doc 01 §8.3 and the reconciliation pass (AMD-02) covers the crash window. On AMD-06, the single-writer model is inherent in SQLite WAL and the subscriber model already sequences access. These concessions demonstrate that the review process was rigorous — findings that did not hold up under scrutiny were withdrawn rather than defended.

---

## 4. Amendment Application Record

### Session 1 — Part 1 (Round 8–9)
- AMD-09 rate limiting applied to Doc 10 pre-lock
- 6 upstream Dependents field updates applied to Docs 01–05
- HealthContributor upstream notes applied to Docs 01–10
- Docs 10 and 11 locked

### Session 1 — Part 2 (Round 10)
- AMD-02 reconciliation pass → Doc 03 (new §3.2.1)
- AMD-10 projection versioning → Doc 03 (§3.3, §3.6, §8.3, §9)
- AMD-04 cascade depth limiting → Doc 07 (new §3.7.1), Doc 01 (§4.4)
- AMD-03 snapshot usage pattern → Doc 07 (§3.8)
- PROJECT_STATUS.md updated with Round 10 entry

### Session 2 — Part 3 (Round 11)
- AMD-11 state TTL → Doc 03 (EntityState record, new §3.8, §5, §9)
- AMD-17 device orphan lifecycle → Doc 02 (new §3.15, §9)
- AMD-14 adapter dependency ordering → Doc 05 (IntegrationDescriptor, new §3.13, §9)
- AMD-13 configuration migration framework → Doc 06 (new §3.7, §9)
- AMD-16 secrets store backup → Doc 06 (§3.4, §6.9, §9)
- AMD-07 route health monitoring → Doc 08 (new §3.15, §9)
- AMD-08 idempotency keys → Doc 09 (§3.4, §3.8, §9)
- AMD-15 correlation ID in error responses → Doc 09 (§3.8)
- AMD-09-RL confirmed pre-applied to Doc 10
- AMD-05 daily_bytes_written → Doc 11 (§3.5, §9)
- PROJECT_STATUS.md updated with Round 11 entry

### Session 2 — Part 4 (Archival)
- This decision record created
- PROJECT_STATUS.md comprehensively updated
- Doc 12 drafting prompt generated

---

## 5. Cross-Document Consistency Verification

The following cross-document consistency checks were verified during amendment application:

- **AMD-11 ↔ AMD-17:** Both set `stale:true` on EntityState. AMD-17 (device orphan lifecycle in Doc 02) explicitly references AMD-11's staleness model (Doc 03 §3.8) as the mechanism. Consistent.
- **AMD-04 ↔ AMD-03:** Cascade depth limiting (Doc 07 §3.7.1) uses the snapshot from AMD-03's getSnapshot() pattern (Doc 07 §3.8). Change detection for natural cascade termination references Doc 03 §3.2. Consistent.
- **AMD-08 ↔ AMD-15:** Idempotency keys (Doc 09 §3.4) and correlation ID in errors (Doc 09 §3.8) both use the same correlation_id propagation model from §3.11. `idempotency-key-conflict` added to problem type table alongside AMD-15's enhanced error format. Consistent.
- **AMD-14 ↔ AMD-17:** Adapter dependency ordering (Doc 05 §3.13) and device orphan lifecycle (Doc 02 §3.15) both handle integration FAILED transitions. AMD-17 orphans devices; AMD-14 suspends dependents. Both fire from the same integration lifecycle events. Consistent.
- **AMD-17 ↔ Doc 09:** `device_orphaned` problem type added to Doc 09 error table as part of AMD-17 application. Consistent.

---

## 6. Impact Assessment

**Documents modified by the review:** 8 of 11 design documents received amendments.

| Doc | Amendments Applied | Sections Added/Modified |
|---|---|---|
| 01 | AMD-04 | §4.4 |
| 02 | AMD-17 | §3.15, §9 |
| 03 | AMD-02, AMD-10, AMD-11 | §3.2.1, §3.3, §3.6, §3.8, §4.1, §5, §8.3, §9 |
| 05 | AMD-14 | §3.13, §4.1, §9 |
| 06 | AMD-13, AMD-16 | §3.4, §3.7, §6.9, §9 |
| 07 | AMD-03, AMD-04 | §3.7.1, §3.8, §9 |
| 08 | AMD-07 | §3.15, §9 |
| 09 | AMD-08, AMD-15, AMD-17 (error type) | §3.4, §3.8, §9 |
| 10 | AMD-09 (pre-applied) | §3.10 |
| 11 | AMD-05 | §3.5, §9 |

**Documents not modified:** Doc 04 (Persistence Layer) — no amendments targeted it directly.

**Net additions:** ~15 new subsections, ~12 configuration key blocks, ~8 new event types, ~4 new record types, 2 new problem types in the REST API error table.

---

## 7. RECOMMENDED Amendments — Integration Opportunities

Two RECOMMENDED amendments are natural candidates for integration during upcoming document drafting:

**AMD-22 (Observability Alerting Foundation / HealthChangeListener):** Doc 12 owns the health aggregation lifecycle and is the natural home for a `HealthChangeListener` callback interface. If Doc 12 addresses how health state changes are propagated to consumers (Web UI, systemd, REST API), AMD-22's specification can be folded in.

**AMD-18 (Causal Chain Timeout Extension):** If Doc 12 addresses the lifecycle of causal chain projections (which it should, since the TraceQueryService from Doc 11 depends on the event bus subscriber model that Doc 12 orchestrates), AMD-18's timeout extension can be integrated.

The remaining 7 RECOMMENDED amendments are Tier 2 concerns or documentation precision items that can be applied opportunistically during future maintenance passes.
