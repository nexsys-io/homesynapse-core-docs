# Architecture Benchmark Assessment — Independent Review

**Date:** 2026-03-21
**Reviewer:** Hivemind (independent assessment)
**Subject:** Full-spectrum architecture stress test response (A1–E3)
**Purpose:** Extract actionable findings that should be amended into or formally acknowledged in the HomeSynapse Core specification

---

## 1. Overall Verdict

The benchmark response demonstrates genuine architectural understanding, not document retrieval. Citations are overwhelmingly accurate against the actual design documents, the reasoning traces real subsystem interactions rather than summarizing section headers, and — critically — the gaps it identifies are real gaps, not fabricated concerns.

That said, the response is not flawless. There are a handful of citation inaccuracies, one material mischaracterization, and several places where the response's own gap analysis could go further. This review separates signal from noise.

---

## 2. Section-by-Section Assessment

### A1: Zigbee Coordinator Hang (30s) — ACCURATE, GAP IS REAL

**Citation accuracy:** High. The threading model trace (virtual thread on CompletableFuture, platform thread on JNI serial read, BlockingQueue between layers) is consistent with Doc 08 §3.2 and Doc 05 §3.2. The health state transition thresholds (120s heartbeat timeout, 0.80 threshold, 3 consecutive evaluations, asymmetric hysteresis) are consistent with Doc 05 §4.2.

**Gap identified — health evaluation interval unspecified:** CONFIRMED REAL. Doc 05 defines the health *formula* and the *transition thresholds* but does not specify the sampling interval for the sliding window. This is a genuine Phase 3 implementation ambiguity.

**Gap identified — boundary oscillation blindspot:** VALID CONCERN. The scenario where an intermittently responsive coordinator hovers around 0.80 and resets the consecutive-evaluation counter is architecturally plausible. The 3-evaluation floor for degradation combined with an unspecified interval creates a real window for limping behavior.

**What to do:** Both gaps should be noted as open implementation questions for Phase 3. The evaluation interval should have a default specified in Doc 05 (recommendation: 10–30 seconds). The boundary oscillation scenario should be added to Doc 05's test matrix.

### A2: 50 Simultaneous Sensor Reports — ACCURATE, INSIGHT IS VALUABLE

**Citation accuracy:** High. The single-writer model (AMD-26, 1 write thread), the 2–3 read threads, the WAL concurrent read capability, and the pull-based batching are all confirmed against the Virtual Thread Risk Audit and Doc 01 §3.4.

**Key insight — write serialization cascade through State Projection:** This is the most valuable finding in Part A. The response correctly identifies that the real bottleneck isn't read contention but the derived-event write cascade: 50 original writes → State Projection reads batch → produces up to 50 `state_changed` writes → Automation Engine waits for those derived writes. The 100–210ms aggregate latency estimate is reasonable.

**Concern about p99 target ambiguity:** VALID. Doc 01 §10's "automation trigger-to-action < 50ms" does not specify whether this is per-event in isolation or per-event under burst. This is a real specification gap.

**Minor inaccuracy:** The response references "Doc 01 §15 open question #3" about the 10-second threshold needing empirical validation. The section number may not be exact — Doc 01's open questions section is numbered differently across revisions. Not material to the analysis.

**What to do:** The p99 target ambiguity should be clarified in Doc 01 §10 — specify that the 50ms target applies to single-event steady-state, and define a separate burst-latency budget (e.g., 500ms for the 50th event in a simultaneous burst). The derived-event cascade should be documented as a known performance characteristic in the persistence layer's Phase 3 notes.

### A3: Slow Memory Leak — ACCURATE, MOST HONEST ANSWER IN THE RESPONSE

**Citation accuracy:** High. The JFR allocation profiling mechanism, the `resourceComplianceScore` formula, the 20 MB per-integration budget, and the "no classloader isolation at MVP" decision (DECIDE-04) are all confirmed.

**The core insight — JFR allocation ≠ retained heap:** This is exactly correct and is the strongest piece of technical reasoning in the entire response. JFR's `ObjectAllocationInNewTLAB` events track allocation volume, not retained heap. A slow leak (10 KB/hour) is invisible to allocation rate monitoring. The response correctly identifies that per-integration heap accounting is not achievable at the in-process isolation tier without classloader or process isolation.

**Gap identified — INV-RF-02's test is for fast allocation only:** CONFIRMED REAL. The invariant's test ("Deploy an integration that attempts to allocate unbounded memory. Verify that the integration is terminated before it impacts core memory availability") tests the *fast* case. The *slow* case has no detection mechanism at MVP.

**What to do:** This is a genuine architectural limitation that should be explicitly acknowledged in Doc 05. Recommendation: add a "Known Limitations" subsection to Doc 05 §10 stating that per-integration heap retention accounting is not possible at the in-process isolation tier, and that slow memory leaks will manifest as JVM-wide OOM events recoverable via process restart (INV-RF-04, LTD-13). This sets correct expectations for Phase 3 implementors and prevents wasted effort.

### B1: Duplicate Event Delivery to Automation Engine — ACCURATE

**Citation accuracy:** High. Contract C2's deduplication key `(automation_id, triggering_event_id)` is confirmed at Doc 07 line 642. The REPLAY mode behavior table (§3.10 lines 420–426) confirms action execution suppression. The `CommandIdempotency` handling (IDEMPOTENT → re-issue, NOT_IDEMPOTENT → expired_on_restart, CONDITIONAL → adapter evaluation) is confirmed at Doc 07 line 496.

**Minor discrepancy found:** Doc 02 lists `TOGGLE` as an idempotency class while Doc 01 and Doc 07 list `CONDITIONAL`. The benchmark response uses `CONDITIONAL` throughout, which aligns with the authoritative event model (Doc 01). This discrepancy between Doc 02 and Doc 01 is a pre-existing documentation inconsistency, not an error in the benchmark.

**Gap identified — incomplete Run finalization after crash:** VALID. The response correctly identifies that after a crash mid-Run, Run R1 has `automation_triggered` and `command_issued` in the log but no `automation_completed`, violating Contract C1. The observation that no recovery mechanism produces the missing `automation_completed` is accurate — Doc 07 doesn't specify what happens to zombie Runs on REPLAY→LIVE transition.

**What to do:** Doc 07 should specify that on REPLAY→LIVE transition, any Run reconstructed as active whose last trace event predates the crash timestamp is finalized with `automation_completed(status: interrupted_by_crash)`. Add this to the crash recovery section and the test matrix.

### B2: Temperature Sensor Data Path — ACCURATE, YOUR HIGHEST-PRIORITY QUESTION ANSWERED CORRECTLY

**Citation accuracy:** High. The data routing table, the 10-second threshold from the Glossary, the `state_reported` → DIAGNOSTIC priority assignment (Doc 01 §3.2: "state_reported is always appended at DIAGNOSTIC priority"), and the 7-day retention for DIAGNOSTIC events (Doc 04 §3.4) are all confirmed.

**The answer to your question:** Yes, `state_reported` events go through `EventPublisher.publish()` into the main domain event store. The math is correct: 30 sensors × 2,880 events/day = 86,400 DIAGNOSTIC events/day, 604,800 at 7-day retention. This IS in the main event store, not the ring buffer.

**The response's own analysis is strong here.** The distinction between quantitative improvement (bounded retention, NVMe target, priority tiers) and qualitative similarity (every reading is a full event-sourced domain event) is the right framing. The 120 MB estimate for 7 days of temperature data at 50-device scale is reasonable.

**The deeper insight about duplicate-value reports:** The response identifies that a `state_reported` event where the value matches the previous canonical state (no `state_changed` produced) is, by the spec's own routing criteria, a telemetry candidate — it doesn't affect automation replay. This is a genuine design tension that the spec doesn't confront. The routing decision is based on *rate* (10-second threshold), not on *information value*.

**What to do:** This is the finding most likely to affect long-term scalability. Two actions:

1. **Immediate (documentation):** Add a "Known Characteristic" note to Doc 04 §3.5 acknowledging that duplicate-value `state_reported` events consume domain event store capacity proportional to sensor count × reporting frequency, and that the 10-second threshold is a rate heuristic, not an information-value filter.

2. **Future consideration (Phase 3+):** Record a research item for a "deduplication-at-state-reported" optimization — when State Projection detects a `state_reported` value matches canonical state (no `state_changed` produced), the event could be tagged for accelerated retention or rerouted to the telemetry store. This would require a metadata tagging mechanism that doesn't violate event immutability. Not MVP scope, but should be recorded as a known optimization opportunity.

### B3: Subscriber Checkpoint Expired — ACCURATE, GRACE PERIOD FOUND

**Citation accuracy:** High with one important correction. The response claims the grace period "is not stated in Doc 04" — but it IS stated. Doc 04 line 899 specifies `subscriber_grace_period_hours: 24` with range 1–168. The default is 24 hours. The response missed this specific configuration parameter.

**The analysis is still correct despite this miss.** The fundamental concern — that a deliberately disabled subscriber looks identical to a dead one from the retention engine's perspective — is valid. The 24-hour default grace period means a module disabled for more than 24 hours has its checkpoint protection stripped and retention proceeds. The "disabled for a week" scenario in the original question absolutely triggers this.

**Gap identified — no "subscriber pause" state:** CONFIRMED REAL. The design has "active" and "stalled" subscriber states but no explicit "paused" state that preserves checkpoint protection indefinitely while the subscriber is intentionally disabled. This is a real gap for maintenance scenarios.

**What to do:** Doc 04 should add a `subscriber_state` concept with at least three values: ACTIVE, PAUSED (checkpoint protected, retention blocked), STALLED (grace period expired, retention proceeds). The PAUSED state should be explicitly settable via REST API for maintenance windows. Add a maximum pause duration warning mechanism.

### C1: Entity Slug Stability — ACCURATE, MOST NUANCED ANSWER

**Citation accuracy:** High. The three-layer identity model (Reference/Slug/Path), INV-CS-02 protecting References only, slug mutability (Identity Model §2.2 line 113), tombstone 90-day retention (lines 141–151), and the automation validation behavior (Doc 07 §6.1 lines 673–679) are all confirmed.

**The critical gap — SelectorResolver tombstone-following behavior:** CONFIRMED REAL. The Identity Model specifies tombstone behavior for *API requests* (301 redirect) but does not specify whether the in-process `SelectorResolver` follows tombstones when resolving slug-based selectors. This is a genuine specification gap.

**The second gap — integration-initiated Display Name changes:** VALID. The Identity Model says "When a *user* changes an object's Display Name, the Slug is regenerated." Whether integration-initiated metadata changes trigger slug regeneration is unspecified.

**The proposed fix (resolve slugs to ULIDs at load time):** This is architecturally sound and worth serious consideration. Resolving slugs to ULIDs at `automations.yaml` load time, storing resolved ULIDs in the runtime definition, and using slugs only as human-readable annotations would make running automations immune to slug changes. Only a reload would re-resolve, and at reload time the tombstone-follow + validation catches issues.

**What to do:** Three items:

1. **Spec the SelectorResolver tombstone contract:** Add to the Identity Model a section specifying that `SelectorResolver` MUST follow tombstone chains during slug resolution, and MUST produce an `automation_slug_redirect` DIAGNOSTIC event each time a tombstoned slug is followed.

2. **Spec integration-initiated Display Name behavior:** Add to the Identity Model that integration-initiated Display Name changes do NOT regenerate slugs unless the user explicitly requests re-derivation.

3. **Evaluate load-time resolution:** Record as a design consideration for Doc 07 — resolving slugs to ULIDs at definition load time rather than trigger evaluation time. This is a potentially significant change to the selector resolution model and should be evaluated for its interaction with dynamic entity creation (a device adopted after automation load should still be matchable by label/area selectors).

### C2: Planned Restart Behavior — ACCURATE, YOUR SECOND-HIGHEST PRIORITY QUESTION

**Citation accuracy:** Mostly high, with one important nuance. The response correctly identifies that orphaning triggers on FAILED or removed transitions (AMD-17) and that a planned restart that succeeds before FAILED is entered doesn't trigger orphaning. However, the design docs DO distinguish between planned restarts and crashes at the ExceptionClassification level — the `shuttingDown` flag prevents shutdown-caused exceptions from being classified as failures. The response acknowledges this but correctly notes it doesn't propagate to the device availability model.

**The core gap — entity availability during planned restart window:** CONFIRMED REAL. The design does not specify what happens to entity availability during the STOPPING→LOADING gap of a planned restart. The three options the response presents (entities go UNAVAILABLE, entities stay at last-known, suppression mechanism) are the correct design space, and none is currently chosen.

**The AvailabilityTracker initial state problem:** VALID. When the new adapter instance starts after restart, the in-memory AvailabilityTracker has no `lastSeen` timestamps. Whether it defaults to AVAILABLE or UNAVAILABLE for known devices determines whether the restart produces a false UNAVAILABLE→AVAILABLE cascade. Doc 08 doesn't specify this initial state.

**What to do:** This needs a design amendment. Recommended approach:

1. Add a `RESTARTING` lifecycle phase (or a `plannedRestart` boolean on `IntegrationHealthRecord`) that downstream consumers can query.

2. Specify that planned restarts do NOT trigger device orphaning or `availability_changed` events.

3. Specify that `AvailabilityTracker` initial state for known devices defaults to their pre-restart availability, persisted as a device-level property in the device registry (not just in-memory).

4. Add an availability-triggered automation grace period: before firing, check if the source integration is in a transient restart state. If so, defer evaluation for a configurable window.

### D1: Discovery UX — ACCURATE AND HONEST

**Citation accuracy:** High. The three-stage pipeline (Detection → Proposal → Adoption), the `DiscoveryPipeline` interface, the Web UI scoped to observability only, and Doc 14 §2.2 listing "Device pairing UI" among missing features are all confirmed.

**The assessment is fair:** The backend pipeline is well-specified; the user-facing experience is Tier 2+ work. The re-pairing automatic re-link is correctly identified as a bright spot.

**What to do:** No specification changes needed. This is a known, acknowledged scope boundary. The assessment confirms the design's self-awareness about its own gaps.

### D2: Automation Templates — ACCURATE

**Citation accuracy:** High. Glossary §9 Blueprint reservation (Tier 3) confirmed at line 1202. The AreaSelector helps with action targets but not with per-area trigger binding — you can't express "for each area, link that area's motion sensor to that area's lights" without 10 separate definitions or the Blueprint system.

**What to do:** No specification changes needed. The gap is known and deferred to Tier 3.

### D3: Non-Device Extensions — ACCURATE

**Citation accuracy:** High. The sidecar pattern from DECIDE-04, the WebSocket subscription model for external consumers, the Glossary "Addon" reservation (Tier 3) — all confirmed.

**What to do:** No specification changes needed. The assessment is honest about the extension model limitations at MVP.

### E1: Unanticipated Phase 3 Failure — PLAUSIBLE BUT PARTIALLY SPECULATIVE

**The Jackson serialization concern:** The reasoning about polymorphic deserialization cost under virtual threads is technically sound. The observation that Jackson's `SerializerCache` uses `synchronized` internally (which would cause carrier pinning on virtual threads) is a real concern in older Jackson versions. The pre-warm recommendation (Finding S-08 in the Virtual Thread Risk Audit) addresses cold start but not steady-state contention.

**Where I'm less convinced:** The response claims "no performance budget for serialization/deserialization latency per event." This is partly true — the 5ms p99 event processing latency is measured at the EventStore level — but the Virtual Thread Risk Audit DID analyze the Jackson interaction and recommended pre-warming. The gap is narrower than presented: it's not "nobody thought about Jackson" but rather "the specific steady-state contention path through `SerializerCache` under concurrent virtual thread deserialization hasn't been empirically validated."

**The fix proposed (pre-build all ObjectReader instances, avoid polymorphic @JsonTypeInfo):** This is standard practice for high-throughput Jackson usage and would likely be discovered and applied early in Phase 3 performance testing. It's a valid concern but probably a week of work, not a design-level problem.

**What to do:** Record as a Phase 3 performance risk in the persistence layer's MODULE_CONTEXT.md. Note that Jackson `SerializerCache` synchronization should be investigated during initial throughput testing, and that pre-built per-type `ObjectReader` instances are the likely mitigation.

### E2: The 30% Cut — SOUND JUDGMENT

The three cuts (observability reduced to structured logging, automation engine reduced to triggers + direct commands, web UI dropped entirely) are well-chosen. The response correctly identifies that:

- The event model, persistence, state store, integration runtime, configuration, and Zigbee adapter are non-negotiable for the architectural thesis
- Upgrade safety mechanisms should ship from day one
- The cuts are reversible because the data model and interfaces remain intact

The E2 answer demonstrates genuine scope prioritization judgment, not generic "cut the UI" advice.

**What to do:** No specification changes, but this analysis is useful strategic context for future scope discussions. File in research.

### E3: Path to 50 Integrations — REALISTIC

The sidecar SDK recommendation over JPMS classloader isolation for community growth is strategically sound. The 2–3 year timeline, the install-base math, and the priority ordering (example integration → dev toolkit → sidecar SDK → documentation → registry) are all reasonable.

**What to do:** No specification changes. Useful strategic input for post-launch planning.

---

## 3. Actionable Items — Ranked by Priority

These are the findings that SHOULD or MUST be worked into the specification or formally acknowledged.

### MUST — Design Gaps That Affect Correctness

| # | Finding | Source | Action | Affects |
|---|---------|--------|--------|---------|
| 1 | **Planned restart does not specify entity availability behavior** | C2 | Design amendment: add restart suppression mechanism, AvailabilityTracker initial state spec, automation grace period | Doc 05, Doc 02 (AMD-17), Doc 08 |
| 2 | **SelectorResolver does not specify tombstone-following behavior** | C1 | Amend Identity Model: SelectorResolver MUST follow tombstone chains; add `automation_slug_redirect` event | Identity Model, Doc 07 |
| 3 | **Incomplete Run finalization after crash not specified** | B1 | Amend Doc 07: REPLAY→LIVE transition finalizes zombie Runs with `automation_completed(status: interrupted_by_crash)` | Doc 07 |
| 4 | **Integration-initiated Display Name changes and slug regeneration unspecified** | C1 | Amend Identity Model: integration-initiated Display Name changes do NOT regenerate slugs | Identity Model |

### SHOULD — Specification Gaps That Affect Clarity or Scalability

| # | Finding | Source | Action | Affects |
|---|---------|--------|--------|---------|
| 5 | **Health evaluation interval not specified** | A1 | Specify default evaluation interval (10–30s) in Doc 05 §4.2 | Doc 05 |
| 6 | **No "subscriber pause" state distinct from "stalled"** | B3 | Add subscriber_state concept (ACTIVE/PAUSED/STALLED) to Doc 04 | Doc 04 |
| 7 | **p99 latency target ambiguity (single event vs. burst)** | A2 | Clarify Doc 01 §10: 50ms is single-event steady-state; define burst-latency budget | Doc 01 |
| 8 | **Per-integration heap retention accounting not achievable at MVP** | A3 | Add "Known Limitations" to Doc 05 §10 acknowledging this | Doc 05 |
| 9 | **Duplicate-value `state_reported` events consume disproportionate domain store capacity** | B2 | Add "Known Characteristic" to Doc 04; record dedup optimization as future research | Doc 04 |
| 10 | **IdempotencyClass naming inconsistency: TOGGLE (Doc 02) vs. CONDITIONAL (Doc 01, Doc 07)** | B1 | Reconcile — one canonical name across all docs | Doc 01, Doc 02, Doc 07 |

### RECORD — Valuable Context for Phase 3

| # | Finding | Source | Action |
|---|---------|--------|--------|
| 11 | **Write serialization cascade through State Projection under burst load** | A2 | Document in persistence MODULE_CONTEXT.md as known performance characteristic |
| 12 | **Jackson SerializerCache synchronization under virtual threads** | E1 | Add to persistence MODULE_CONTEXT.md as Phase 3 performance risk |
| 13 | **Boundary oscillation in health formula around 0.80 threshold** | A1 | Add to Doc 05 test matrix |
| 14 | **Subscriber checkpoint expiration grace period default is 24h** | B3 | Response missed this — no action needed, but validates the config exists |
| 15 | **Load-time slug→ULID resolution as alternative to evaluation-time resolution** | C1 | Record as design consideration for Doc 07 (evaluate interaction with dynamic entity creation) |

---

## 4. What the Benchmark Missed

For completeness, areas where the response could have gone further:

1. **Configuration reload race conditions.** The response discusses planned restarts but doesn't analyze what happens if `automations.yaml` is reloaded while a Run is in progress. Does the engine finish the Run under the old definition or abort it?

2. **Cross-integration command routing during partial startup.** During Doc 12's phased startup sequence, some integration adapters may be RUNNING while others are still LOADING. If an automation's action targets a device on a not-yet-running adapter, the command dispatch has no route. The response touches this in C2 but doesn't trace the startup-order dependency.

3. **Event ordering guarantees under the derived-event cascade.** The response identifies the A2 write serialization but doesn't ask: if `state_reported` E1 and E2 arrive simultaneously for different entities, and State Projection produces `state_changed` S1 and S2, is the global ordering of S1 and S2 in the event store deterministic? (Answer: yes, because the single write thread serializes them, but the *order* depends on State Projection's internal processing order, which is batch-dependent.)

4. **WebSocket backpressure.** The WebSocket API (Doc 10) streams events to connected clients. Under the 50-sensor burst, the WebSocket server is producing 50+ notifications. If a slow client (mobile device on poor WiFi) can't keep up, what happens? Is there per-client backpressure, or does the slow client cause the WebSocket broadcast to block?

---

## 5. Bottom Line

The benchmark response is **high quality**. Citation accuracy is ~90%+ against the actual design documents. The gaps identified are real, not fabricated. The architectural reasoning traces actual subsystem interactions rather than summarizing documentation structure.

The four MUST items (planned restart suppression, SelectorResolver tombstone-following, zombie Run finalization, integration-initiated slug behavior) are genuine design gaps that should be addressed via amendments before Phase 3 implementation reaches those subsystems. The SHOULD items are specification clarifications that reduce Phase 3 implementation ambiguity.

The response's strongest sections are A3 (memory leak honesty), B2 (state_reported data path analysis), and C1 (slug stability nuance). Its weakest section is E1 (Jackson concern is valid but narrower than presented).

This benchmark confirms that the knowledge base is deep enough to support genuine architectural stress-testing, which is a strong signal for Phase 2/3 readiness.
