# HomeSynapse Core — Project Status

**Last updated:** 2026-03-17
**Current phase:** Phase 2 — Interface-Level Specification. Sprint 1 complete. Architecture Review Fixes applied. Sprint 2 in progress.
**Active work:** Sprint 2 (Week 2: Device Model + State Store). AMD-25 (temporal duration trigger modifier) drafted for Doc 07. Demand Response research artifact complete.

---

## Document Status

| # | Document | Status | Date | Notes |
|---|---|---|---|---|
| — | Glossary v1 | Locked | 2026-02-22 | Foundations layer. 64 terms across 9 sections. Round 3 amendment A-G1 applied. Round 4 A-STATUS-1 applied. Cross-document consistency: status header corrected (A-CD-4a). Round 6 amendment A-G2-R6-1 applied (trigger_type/action_type/condition_type enum corrections). |
| — | Identity and Addressing Model v1 | Locked | 2026-02-25 | Foundations layer. Round 4 A-STATUS-1 applied. Cross-document consistency: status header corrected (A-CD-4b). |
| 01 | Event Model & Event Bus | Locked | 2026-03-04 | Round 3 applied (A-01-1 through A-01-4). Round 4 applied (A-01-R4-1 subjectTypeFilter rename, A-01-R4-2 dedup, A-STATUS-1). Round 5 applied (A-01-R5-1 config_error taxonomy addition, A-01-R5-2 Dependents field update). Cross-document consistency applied (A-CD-1 §6.5 storage_pressure fix, A-CD-2a §10 header, A-CD-5 §4.3 dedup). Round 6 applied (A-01-R6-1 Dependents field update with Doc 07 dependencies). Round 8–9 applied (Dependents U-01-R8, U-01-R9; HealthContributor note). **Round 10 applied (AMD-04 cascade_depth in §4.4 causal chain projection).** A-01-DR-1 applied (event_category envelope field, §4.1 + new §4.4, D15 added to §16, §12 updated). Upstream Dependents U-01 (Docs 08/09) confirmed applied. |
| 02 | Device Model & Capability System | Locked | 2026-03-04 | Round 3 applied (A-02-1). Round 4 applied (A-02-R4-1 dedup, A-02-R4-2 Pi 5 header, A-STATUS-1). Round 6 applied (A-02-R6-1 Dependents field update with Doc 07 dependencies; EntityRegistry reference corrected to cite §3.11.1 and §3.12). **Round 11 applied (AMD-17 device orphan lifecycle §3.15, orphan config §9).** Upstream Dependents U-02 (Docs 08/09) confirmed applied. |
| 03 | State Store & State Projection | Locked | 2026-03-05 | Round 3 applied (A-03-1, A-03-2). Round 4 applied (A-03-R4-1 Dependencies correction, A-03-R4-2 dedup, A-STATUS-1). Cross-document consistency applied (A-CD-2b §10 header). Round 8–9 applied (Dependents U-03-R9; HealthContributor note). **Round 10 applied (AMD-02 reconciliation pass §3.2.1, AMD-10 projection versioning in §3.3/§3.6/§8.3).** **Round 11 applied (AMD-11 state TTL: staleAfter/stale fields on EntityState, §3.8 staleness model, staleness config §9, API contract note §5).** Upstream Dependents U-03 (Doc 09) confirmed applied. |
| 04 | Persistence Layer | Locked | 2026-03-05 | Round 3 applied (A-04-1). Round 4 applied (A-04-R4-1 stale reconciliation note, A-04-R4-2 Pi references, A-STATUS-1). Upstream Dependents U-04 (Doc 09) confirmed applied. |
| 05 | Integration Runtime | Locked | 2026-03-06 | Cross-audit complete. Round 4 A-STATUS-1 applied. **Round 11 applied (AMD-14 adapter dependency ordering §3.13, dependsOn field on IntegrationDescriptor, dependency config §9).** Upstream Dependents U-05 (Docs 08/09) confirmed applied. |
| 06 | Configuration System | Locked | 2026-03-06 | Cross-audit complete. 14 findings resolved (4 critical, 4 significant, 6 minor). Round 5 upstream amendments applied to Doc 01. **Round 11 applied (AMD-13 configuration migration framework §3.7, AMD-16 secrets store per-operation backup §3.4, migration and backup config §9, §6.9 recovery updated).** Upstream Dependents U-06 (Doc 09) confirmed applied. |
| 07 | Automation Engine | Locked | 2026-03-07 | Competitive research complete. Round 6 cross-audit complete: 14 findings (3 critical, 5 significant, 6 minor), all resolved. 10 Doc 07 amendments applied (A-07-R6-1 through A-07-R6-9, A-07-M3-R6). 4 upstream amendments applied (A-G2-R6-1 Glossary, A-01-R6-1, A-02-R6-1, A-MVP-R6-1). Pass 3 event_category forward reference applied to §12. Round 8–9 applied (HealthContributor note). **Round 10 applied (AMD-04 cascade governance §3.7.1, AMD-03 snapshot usage pattern §3.8).** Resolves Command Pipeline and Pending Command Ledger design gaps. Three non-blocking open questions remain (§15). Upstream Dependents U-07 (Doc 09) confirmed applied. |
| 08 | Zigbee Adapter | **Locked** | 2026-03-09 | Depends on Docs 01, 02, 05. All dependencies locked. Wave 1 parallel track. Competitive research complete. Full design document drafted. 9 pre-audit amendments applied (A-08-R7-1 through A-08-R7-9). **Round 7 full cross-audit complete (Tracks A–E): 0 critical, 2 significant, 3 minor. All findings applied.** Significant: presence_signal removed from produced event list, event_category forward reference added. Minor: Tuya DP header semantics, concrete IntegrationDescriptor values, command_result dual priority. 18 key decisions, 2 non-blocking open questions. **Round 11 applied (AMD-07 route health monitoring §3.15, RouteHealth record, command-failure recovery, weak-link analysis, route_health config §9).** Upstream Dependents (U-01 through U-07) applied. Locked 2026-03-09. |
| 09 | REST API | **Locked** | 2026-03-09 | Depends on Docs 01, 02, 03, 04, 05, 06, 07. All dependencies locked. Competitive research complete. Full design document drafted. 8 pre-audit amendments applied (A-09-R7-1 through A-09-R7-8). **Round 7 full cross-audit complete (Tracks C–E): 0 findings. Pre-audit amendments resolved all issues.** Track D (cross-consistency with Doc 08): 0 findings. **Round 11 applied (AMD-08 idempotency keys on command endpoint §3.4, AMD-15 correlation_id in all error responses §3.8, idempotency config §9, idempotency-key-conflict and device-orphaned problem types added).** Upstream Dependents (U-01 through U-07) applied. Locked 2026-03-09. |
| 10 | WebSocket API | **Locked** | 2026-03-09 | Round 8–9 applied. AMD-09 (reconnection admission control + rate limiting) applied pre-lock. HealthContributor upstream note applied. Upstream Dependents updates (U-01-R8, U-02-R8, U-05-R8) applied to Docs 01, 02, 05. |
| 11 | Observability & Debugging | **Locked** | 2026-03-09 | Round 8–9 applied. HealthContributor interface definition (§8.1, §8.2). Health aggregation model (§7.1). Upstream Dependents updates (U-01-R9, U-03-R9, U-04-R9) applied to Docs 01, 03, 04. **Round 11 applied (AMD-05 daily_bytes_written metric in §3.5 table, collection method and health threshold description, storage monitoring config §9).** |
| 12 | Startup, Lifecycle & Shutdown | **Locked** | 2026-03-09 | Round 12 cross-audit complete: 1 critical, 6 significant, 1 minor. All amendments applied. Upstream Dependents (U-01 through U-10 for Doc 12) applied. Locked 2026-03-09. |
| 13 | Web UI (Observability MVP) | **Locked** | 2026-03-10 | Depends on Docs 09, 10, 11, 12. Framework research complete (research/Web_UI_Framework_Research_v1.md). LTD-18 created. Full design document drafted. **Round 13 cross-audit complete: 0 critical, 5 significant, 5 minor. All amendments applied.** Significant: §8.2 missing 5 WebSocket message types from Doc 10, §3.8 missing Observability from Tier 2, WebSocket path /api/v1/ws→/ws/v1 per Doc 10, §3.5 missing replay_queued handling per Doc 10 §3.9, missing INV-TO-01 and INV-SE-02 citations. Minor: integration path param {id}→{integration_id}, §10 Pi 4 validation floor note, §13 missing browser memory and compatibility tests. Upstream Dependents (U-09, U-10, U-11, U-12 for Doc 13) applied. 16 key decisions, 3 non-blocking open questions. Locked 2026-03-10. |
| 14 | Master Architecture Document | **Locked** | 2026-03-10 | Round 14 cross-audit complete: 0 critical, 3 significant, 2 minor. All amendments applied (A-14-R14-1 through A-14-R14-5). Synthesizes all 13 subsystem designs. Memory budget: ~175 MB heap, ~230–260 MB native, 650–850 MB total RSS. INV-PR-02 measurement methodology defined. Gradle module map verified. Tier model (6 tiers from Portability Architecture). CI/CD testing matrix (4 tiers). All 18 LTDs referenced. 4 non-blocking open questions. Locked 2026-03-10. |

---

## Phase 1 Completion Summary

**Completed:** 2026-03-10
**Duration:** 2026-02-22 (Glossary v1 locked) to 2026-03-10 (Doc 14 locked) — 17 days
**Documents:** 14 design documents + 2 foundation documents (Glossary v1, Identity and Addressing Model v1) = 16 total
**Cross-audit rounds:** 14 (Rounds 1–14)
**Total amendments applied:** ~120 across all rounds (including upstream Dependents updates, cross-document consistency passes, and Critical Design Review)
**Locked decisions:** 18 (LTD-01 through LTD-18)
**Architecture invariants:** 72 across 15 categories
**Research artifacts:** 7 (Event Systems Autopsy, Device Model Architectures, Language Evaluation, Event System Design, Portability Architecture, Observability Debugging Research, Web UI Framework Research)

### Phase 2 Prerequisites

Before Phase 2 interface specification begins:

1. ~~A-01-DR-1 event_category envelope amendment~~ — COMPLETE. Applied to Doc 01 §4.1, §4.4, §12, §16. Glossary §3.9 updated. Doc 14 §15 Open Question 1 resolved. Forward references in Docs 07, 08, 09, 10 verified consistent.
2. ~~**JDK distribution selection**~~ — COMPLETE. Amazon Corretto 21.0.10.7.1 pinned. See `governance/phase-2-transition-guide.md` §1.
3. ~~**Copyright header template**~~ — COMPLETE. Proprietary header with SPDX identifier defined. See `governance/phase-2-transition-guide.md` §4.
4. ~~**sqlite-jdbc version pin gate**~~ — COMPLETE. xerial sqlite-jdbc 3.51.2.0 pinned. WAL validation spike deferred to first Phase 3 task. See `governance/phase-2-transition-guide.md` §2.
5. ~~**Licensing model decision**~~ — COMPLETE. Proprietary, all rights reserved. See `governance/phase-2-transition-guide.md` §3.
6. **9 RECOMMENDED review amendments** — AMD-12, AMD-18, AMD-19, AMD-20, AMD-21, AMD-22, AMD-23, AMD-24. Apply opportunistically during Phase 2 interface work. See `research/Critical_Design_Review_Docs_01_11_v1.md` §3 for full list.
7. **AMD-25 (temporal duration trigger modifier)** — Draft, pending Hivemind review. Must land before Wave 3 Phase 2 (automation module). See `design/amendments/AMD-25_Temporal_Duration_Trigger_Modifier.md`.

---

## Phase 2 Progress — Sprint 1 (Wave 1: Event Model + Platform API)

**Sprint period:** 2026-03-13 (Fri) to 2026-03-15 (Sun) — completed ahead of schedule
**Sprint goal:** All public Java interfaces, records, enums, and sealed interfaces for event-model, event-bus, and platform-api modules with full Javadoc contracts. All three modules compile cleanly.

### Modules Delivered

| Module | Package | Production Files | Types |
|---|---|---|---|
| platform-api | `com.homesynapse.platform` | 14 | Ulid, UlidFactory, 8 typed ID wrappers, PlatformPaths, HealthReporter |
| event-model | `com.homesynapse.event` | 43 | EventEnvelope (14-component), EventId, CausalContext (2-field), DomainEvent, DegradedEvent, EventDraft (8-field), EventPublisher, EventStore, EventPage, SequenceConflictException, HomeSynapseException + 5 subclasses, EventTypes (41 constants), 6 enums (incl. EventPriority with severity()), 22 payload records |
| event-bus | `com.homesynapse.event.bus` | 6 | SubscriptionFilter (with matches()), SubscriberInfo, EventBus, CheckpointStore |

**Total production Java files:** 57 across 3 modules (plus module-info.java and package-info.java for each).

### Execution Blocks

| Block | Deliverables | Status |
|---|---|---|
| A (Identity + Enums) | Ulid, UlidFactory, 8 typed IDs, SubjectRef, SubjectType, 5 event enums | DONE |
| B (EventEnvelope) | EventId, CausalContext rewrite, DomainEvent, DegradedEvent, EventEnvelope | DONE |
| D (Publisher/Store) | EventDraft, EventPublisher, EventPage, SequenceConflictException, EventStore | DONE |
| E (EventBus) | SubscriptionFilter, SubscriberInfo, EventBus, CheckpointStore, event-bus module-info | DONE |
| F (Platform API) | PlatformPaths, HealthReporter, platform-api module-info update | DONE |
| Payload Types | EventTypes constants, 22 event payload records (command, state, device, automation, presence, system, telemetry) | DONE |

### Quality Gates

- Full project compile (`./gradlew compileJava`): **PASS** — all 19 modules, zero warnings with `-Xlint:all -Werror`
- Javadoc quality pass: **PASS** — all public types documented with @param, @return, @throws, @see tags; thread safety documented on all interfaces; nullability documented on all parameters
- Traceability docs populated: `01-event-model.md` (41 types mapped), `12-lifecycle.md` (2 types mapped)
- Spotless copyright headers: verified on all files

### Key Decisions Made During Sprint 1

- **EventEnvelope non-generic** (Block B Decision 1): payload typed as `DomainEvent`, not `EventEnvelope<T>`. Subscribers use pattern matching for dispatch.
- **CausalContext uses raw Ulid** (Block B Decision 2): old typed wrappers (CorrelationId, CausationId, ActorRef) deleted. CausalContext now carries `Ulid correlationId`, nullable `Ulid causationId` only (2 fields). actorRef was promoted to EventEnvelope during Architecture Review Fixes (March 16, 2026).
- **DomainEvent non-sealed initially** (Block B Decision 4): marker interface for Phase 2. Becomes sealed when payload records are finalized in Phase 3.
- **EventPublisher CausalContext handling** (Block D): callers construct the derived event's CausalContext via `CausalContext.chain()` and pass it ready-made. Publisher trusts the caller's construction. For root events, publisher constructs CausalContext internally.
- **Event payload value fields use String** (Sprint 1): dynamic/Any-typed value fields (attribute values, parameters) represented as serialized String form in Phase 2. Phase 3 introduces typed `AttributeValue` when capabilities define attribute schemas.
- **EventTypes as static final Strings** (Sprint 1): non-instantiable utility class, not enum. Extensible for integration-defined types at runtime.

### Scaffold Fixes

- `device-model/module-info.java`: exports of empty `com.homesynapse.device` commented out (re-enable in Sprint 2)
- `integration-api/module-info.java`: exports of empty `com.homesynapse.integration` commented out (re-enable when integration types added)

---

## Architecture Review Fixes — March 16, 2026

**Scope:** Ten structural fixes identified during the critical architecture review, applied before Sprint 2 begins.
**Status:** Complete. All code compiles. All documentation updated.

### Code Changes (event-model, event-bus)

| Fix | Change | Impact |
|---|---|---|
| **Fix 1** | `EventEnvelope` promoted to **14 fields** — `actorRef` (Ulid, nullable) added as 14th field, positioned after `causalContext` and before `payload`. | Enables direct indexing for multi-user audit trails (INV-MU-01). |
| **Fix 1** | `CausalContext` reduced to **2 fields** — `actorRef` removed. Static factories: `root(Ulid)` (1 param), `chain(Ulid, Ulid)` (2 params). | Pure causality semantics only. |
| **Fix 1** | `EventDraft` gained `actorRef` field — now **8 fields**. actorRef flows from caller → draft → envelope. | Consistent actorRef path for both root and derived events. |
| **Fix 1** | `EventPublisher.publishRoot(EventDraft)` changed to **single-parameter** — actorRef comes from the EventDraft, not a separate parameter. | Consistent API: actorRef always on the draft. |
| **Fix 2** | `EventPriority` gained **`severity()` method** — CRITICAL(0), NORMAL(1), DIAGNOSTIC(2). | Ordinal-independent comparison for subscription filtering. |
| **Fix 2** | `SubscriptionFilter.matches()` updated to use `severity()` instead of `ordinal()`. | Stable against enum reordering. |
| **Fix 3** | `HomeSynapseException` abstract class added to `com.homesynapse.event` with `errorCode()` and `suggestedHttpStatus()` abstract methods. | Structured error infrastructure for REST API translation. |
| **Fix 3** | 5 concrete exception subclasses: `EntityNotFoundException` (404), `DeviceNotFoundException` (404), `CapabilityMismatchException` (409), `ConfigurationValidationException` (422), `IntegrationUnavailableException` (503). | Type-safe error handling across all modules. |

### Documentation Changes

| Fix | Document | Change |
|---|---|---|
| **Fix 4** | Repo Architecture v2 | Verified clean — zero instances of `io.homesynapse`. All references already use `com.homesynapse`. |
| **Fix 5** | event-model MODULE_CONTEXT.md | Added Configuration Reload Ordering Contract section documenting the direct-callback → event → subscriber ordering. |
| **Fix 6** | rest-api MODULE_CONTEXT.md | Added Idempotency-Key Contract section documenting best-effort semantics, LRU cache limitations, and guidance on non-idempotent commands. |
| **Fix 7** | websocket-api MODULE_CONTEXT.md | Added WebSocket Replay/Live Merge Protocol section documenting parallel-stream architecture, client-side buffering and merge, and overflow handling via REST fallback. |
| **Fix 8** | event-model MODULE_CONTEXT.md | Presence events (`PresenceSignalEvent`, `PresenceChangedEvent`) marked as Tier 2 — reserved vocabulary with no MVP producer or consumer. |
| **Fix 9** | Design_Review_Amendments_v1.md | Status changed from "Draft — pending Nick's review" to "Approved" with date 2026-03-16 and approval note. |
| **Fix 10** | PROJECT_STATUS.md | This section. Sprint 1 module summary updated to reflect new type counts. |

### Compile Gate

`./gradlew compileJava` — **PASS** — all 19 modules, zero errors, zero warnings.

### Next: Sprint 2 (Week 2: Device Model + State Store)

Target modules: device-model, state-store, integration-api. Design authority: Doc 02 (Device Model), Doc 03 (State Store), Doc 05 (Integration Runtime).

---

## AMD-25: Temporal Duration Trigger Modifier — March 17, 2026

**Status:** Draft — pending Hivemind review
**Target:** Doc 07 (Automation Engine) — amendment to locked document
**Priority:** HIGH — must land before Wave 3 Phase 2 interface specification (automation module)

AMD-25 adds a `for_duration` modifier to the four Tier 1 trigger types (`state_change`, `state`, `numeric_threshold`, `availability`) that delays trigger firing until the predicate has been continuously true for a specified duration. This is the HomeSynapse equivalent of Home Assistant's `for:` modifier — table-stakes functionality for temporal automation patterns ("turn off HVAC if no occupancy for 30 minutes").

**Amendment scope:** §3.4 (trigger evaluation — duration timer lifecycle), §3.7 (hot-reload interaction), §3.10 (REPLAY suppression and REPLAY→LIVE timer reconstruction), §8.2 (DurationTimer type, TriggerDefinition update), §9 (configuration — max_for_duration_ms, max_concurrent_duration_timers), §10 (performance targets — timer management overhead), §11 (5 new metrics, 4 new structured log events, health indicator update), §13 (7 new unit tests, 4 new integration tests), §14 (Tier 2 applicability note).

**Design decision:** Option (A) — trigger-level modifier, not a new condition type or trigger type. Matches HA semantics, matches user mental model, avoids type proliferation, timer is pre-Run (no Run slot consumed).

**New DIAGNOSTIC events:** `trigger_duration_started`, `trigger_duration_expired`, `trigger_duration_cancelled`, `trigger_duration_limit_exceeded`, `trigger_duration_state_validated`.

**Artifact:** `design/amendments/AMD-25_Temporal_Duration_Trigger_Modifier.md`

---

## Demand Response Grid-Interactive Research — March 17, 2026

**Status:** Complete
**Artifact:** `research/Demand_Response_Grid_Interactive_Research_v1.md`

Research evaluating whether HomeSynapse's automation engine can serve as the orchestration layer for demand response events. Covers OpenADR 3.0, CTA-2045, and three utility DR programs (ERCOT ERS, CAISO, ConEd SmartCharge).

**Key finding:** The existing automation engine can handle incentive-based and standard DR programs (10–30 minute response windows). Multi-device coordinated DR responses with rollback semantics require new action types (`capture_state`, `restore_state`, `sequence` with compensating transactions) — implementable as Tier 2 extensions to the existing engine, not a new subsystem.

**Recommendation:** Extend automation engine for Tier 2 DR. Evaluate dedicated orchestration layer for Tier 3+ with falsifiability criteria defined in the research artifact §7. No MVP scope change recommended.

**Feeds:** NexSys Grid product planning, INV-EI-02 (Grid-Interactive by Design), Automation Engine Tier 2+ design.

---

## Phase 1 Completion Plan

### Progress Summary

**14 of 14 documents locked.** Phase 1 complete. The architecture's core — event model, device model, state management, persistence, integration runtime, configuration, automation, protocol adapter, both API surfaces, observability, startup/lifecycle/shutdown, the observability dashboard, and the master architecture synthesis — is fully designed, audited, and post-review hardened.

**Critical Design Review complete.** 24 amendments identified; 22 accepted (4 BLOCKING, 9 REQUIRED, 9 RECOMMENDED), 2 rejected (AMD-01, AMD-06). All 13 BLOCKING + REQUIRED amendments applied across Rounds 10–11. 9 RECOMMENDED amendments deferred for opportunistic application. See `research/Critical_Design_Review_Docs_01_11_v1.md` for full decision record.

### Remaining Work

All Phase 1 design documents are locked. No remaining design work.

**Next:** Phase 2 prerequisites (see Phase 1 Completion Summary below), then interface specification.

### Per-Document Workflow

Each document follows the established cycle:
1. Competitive research → research summary committed to `research/` (if warranted).
2. Design drafting → full document per DESIGN_DOC_TEMPLATE.md.
3. Cross-audit → consistency verification against all dependencies and governance artifacts.
4. Amendment application → to both new document and any upstream documents.
5. Lock → once all blocking open questions are resolved.

Doc 13 framework research complete (LTD-18 created). Doc 14 requires no research (pure synthesis).

---

## Research Strategy for Remaining Documents (added 2026-03-08, updated 2026-03-09)

**Status update:** All research is COMPLETE. Docs 10, 11, 12, and 13 are locked. Doc 13 framework research (research/Web_UI_Framework_Research_v1.md) resulted in LTD-18 (Preact SPA). Doc 14 requires no research (pure synthesis).

### ~~Priority 1 — Doc 11: Observability & Debugging~~ COMPLETE — Locked 2026-03-09

Doc 11 is the highest-priority research target. It sits on the critical path and has the deepest unknowns among the remaining documents.

**Why research is needed:** The observability subsystem must catalog the complete metric surface from all 10 preceding design documents, design the health aggregation model that composes per-integration and per-subsystem health into a system-wide picture, and define the JFR continuous recording strategy for constrained hardware. These are not patterns that can be derived from first principles — they require competitive analysis of what works (and what fails) in practice.

**Research questions:**

| # | Question | Why It Matters |
|---|---|---|
| RQ-1 | How do existing smart home platforms handle observability, and what are the documented failure modes? | HA's diagnostics are widely criticized. OpenHAB has a different model. SmartThings Edge has limited observability. Understanding what fails informs what to build differently. |
| RQ-2 | What JFR continuous recording patterns work on constrained hardware (RPi 5, 4 GB RAM)? | JFR is our chosen telemetry mechanism (LTD-15), but continuous recording on a Pi with bounded storage is genuinely novel. Recording size limits, custom event design, event streaming vs file-based recording, and the JFR-to-structured-log bridge need empirical assessment. |
| RQ-3 | How should per-subsystem health indicators compose into system-wide health? | Doc 05 defines per-integration health scoring (weighted formula). Doc 11 must aggregate integration health, event bus subscriber health (checkpoint lag, error rates), State Store projection freshness, persistence health (storage pressure), and API health (error rates, latency). The composition algorithm matters — naive approaches (worst-of, average) produce noisy or insensitive signals. |
| RQ-4 | What makes the "event trace answers 'why did this happen?'" acceptance criterion concrete? | This is the Tier 1 acceptance criterion from MVP §8.1. Doc 11 must define the query model, the trace assembly logic, and the information structure that makes causal chain navigation ergonomic. The causal metadata exists (correlation_id, causation_id, triggered_by); the question is how to surface it. |
| RQ-5 | What metric cardinality is sustainable on RPi hardware? | Every Zigbee device adds per-device metrics (RSSI, LQI, command round-trip, availability). With 50 devices and 12 metric types, that is 600 time series. JFR handles this differently than Prometheus — what are the practical limits? |
| RQ-6 | How do observability-focused systems (Grafana Agent, OpenTelemetry Collector, Jaeger) handle the correlation-to-trace assembly pattern? | HomeSynapse's causal chain model is structurally similar to distributed tracing (correlation_id ≈ trace_id, causation_id ≈ parent_span_id). The assembly patterns from the tracing world likely apply. |

**Scope:** Competitive analysis of smart home observability (HA diagnostics, OpenHAB Karaf console, SmartThings device health), JFR patterns for embedded/constrained systems, health aggregation models from infrastructure monitoring (Consul, Kubernetes health probes, Envoy health checking), and trace assembly patterns from distributed tracing (Jaeger, Zipkin, OpenTelemetry).

**Estimated effort:** This is the deepest research remaining. Comparable in depth to Doc 05 (Integration Runtime) research, which resolved three targeted unknowns.

### ~~Priority 2 — Doc 10: WebSocket API~~ COMPLETE — Locked 2026-03-09

Doc 10 has a well-understood core pattern (WebSocket for real-time event streaming) but smart-home-specific design questions merit targeted research.

**Research questions:**

| # | Question | Why It Matters |
|---|---|---|
| RQ-7 | What subscription models do existing smart home WebSocket APIs use? | HA's WebSocket API is the primary control channel (not REST). SmartThings uses WebSocket for real-time updates. Matter uses a subscription model with min/max reporting intervals. The filter granularity and subscription lifecycle directly affect client implementation complexity. |
| RQ-8 | How should a WebSocket client reconnect after disconnect without missing events or creating duplicates? | This intersects with the event bus checkpoint model (Doc 01 §3.4). The client needs a `last_seen_position` to resume. The question is whether the server manages per-connection checkpoints or the client provides its resume position. |
| RQ-9 | What backpressure semantics prevent a slow WebSocket client from blocking the event bus? | A browser with a frozen tab or a mobile app that backgrounded should not cause subscriber lag. The coalescing model from Doc 01 §3.6 may apply, but WebSocket-specific buffering and drop policies need design. |
| RQ-10 | Binary frames vs JSON text frames — what do existing platforms use and what is the constrained-hardware tradeoff? | JSON is human-debuggable but larger. Binary (e.g., MessagePack, CBOR) reduces bandwidth on constrained networks. HA uses JSON. Matter uses binary TLV. The choice affects both server-side serialization cost and client implementation complexity. |

**Scope:** Competitive analysis of HA WebSocket API (message types, subscription model, authentication flow), SmartThings WebSocket, Matter subscription model, and general WebSocket best practices for event streaming (reconnection, backpressure, heartbeat).

**Estimated effort:** Moderate. Narrower than Doc 11 research. Comparable to Doc 06 (Configuration System) research — targeted unknowns, well-established domain.

**Strategic note:** Doc 10 research could begin immediately since all dependencies are locked. If researched and drafted during the Doc 08/09 lock process and Doc 11 research phase, it locks before Doc 11 completes, unblocking the Doc 13 critical path.

### Priority 3 — Doc 13: Web UI Framework Selection (HIGH for Framework, Early Start)

Doc 13 cannot be drafted until Docs 09, 10, and 11 are locked, but the framework selection research has no dependency on those documents and is the long-lead item.

**Research questions:**

| # | Question | Why It Matters |
|---|---|---|
| RQ-11 | Which JavaScript framework produces the smallest production bundle for a dashboard-oriented SPA? | The UI ships in the jlink distribution and is served from the RPi. Bundle size directly impacts storage footprint and initial load time. HA uses Lit/Web Components (~900 KB core). Preact, Solid, Svelte, and vanilla approaches should be evaluated. |
| RQ-12 | What rendering architecture (SPA, SSR, island architecture, hybrid) is appropriate for a local-network dashboard served from constrained hardware? | The server is an RPi serving to a LAN. SSR adds CPU cost on every navigation. SPA adds client-side JavaScript weight. Islands (Astro-style) or partial hydration may be the sweet spot. |
| RQ-13 | How does HA's frontend architecture succeed and fail, and what should HomeSynapse learn from it? | HA's Lit/Web Components frontend is functional but widely criticized for performance, customizability, and developer experience. Understanding the specific failure modes prevents repeating them. |
| RQ-14 | What dashboard patterns make event-sourced debugging ergonomic for non-technical users? | The Tier 1 acceptance criterion requires "event trace answers 'why did this happen?'" The visualization model must be intuitive enough for the MVP user persona. |

**Scope:** Framework benchmarks (bundle size, render performance, developer ergonomics), HA frontend architecture analysis, dashboard UX patterns for home automation, event trace visualization approaches.

**Estimated effort:** Moderate for framework selection, lighter for dashboard patterns (informed by Doc 11's trace model). Framework research can run as background investigation during Wave 2 without blocking anything.

### Research Sequencing Plan

| Phase | Research | Timing | Blocks |
|---|---|---|---|
| ~~**Immediate**~~ | ~~Doc 10 WebSocket API research~~ | ~~During Doc 08/09 lock process~~ | COMPLETE — Locked 2026-03-09 |
| ~~**Immediate**~~ | ~~Doc 11 Observability research~~ | ~~Start as soon as Docs 08/09 lock~~ | COMPLETE — Locked 2026-03-09 |
| **Parallel** | Doc 13 framework investigation | Background during Wave 2 | Doc 13 drafting (long-lead) |
| **Not needed** | Doc 12 research | — | Synthesis document, no research |
| **Not needed** | Doc 14 research | — | Synthesis document, no research |

### Research Warranted vs. Not Warranted (Decision Framework)

Applying the established principle: "research is only warranted when patterns are genuinely novel" (Doc 03's State Store didn't need research; Docs 01, 02, 04, 05 did).

| Document | Research Warranted? | Rationale |
|---|---|---|
| Doc 10 | **Yes** (moderate) | WebSocket patterns are well-established, but smart-home-specific subscription, reconnection, and backpressure semantics have documented design diversity across platforms. Targeted research on 3–4 platforms resolves the unknowns. |
| Doc 11 | **Yes** (deep) | JFR continuous recording on constrained hardware is genuinely novel. Health aggregation composition is a complex design space. The "why did this happen?" trace model requires competitive analysis to avoid reinventing known patterns poorly. |
| Doc 12 | **No** | Pure synthesis. Initialization order derivable from dependency graph. Shutdown derivable from Doc 05. HealthReporter and PlatformPaths contracts defined by Portability Architecture research (already complete). |
| Doc 13 | **Yes** (framework only) | Framework selection is a long-lead decision with measurable criteria (bundle size, performance, DX). Dashboard patterns are informed by Docs 09, 10, 11 designs. Competitive analysis of HA's frontend failures is high-value. |
| Doc 14 | **No** | Pure synthesis. Comprehensive memory budget, Gradle module map, and CI/CD matrix are compilation exercises, not design discovery. |

### Repository Structure, Test Infrastructure & API Evolution Research — COMPLETE (2026-03-10)

Cross-project competitive analysis covering 17 open-source projects across smart home platforms, event-sourcing frameworks, and Java infrastructure projects. Three focus areas: repository structure and module organization, test infrastructure patterns, and API stability/evolution strategies. Findings produced the Refined Repository Architecture v2 (superseding Implementation Plan v1) with 12 structural changes and 8 targeted amendments. See `research/Repository_Structure_Test_Infrastructure_And_API_Evolution_Research_v1.md` for full analysis and `governance/HomeSynapse_Core_Refined_Repo_Architecture_v2.md` for the resulting architecture.

---

## Planned Reference Artifacts

These are derived consolidation artifacts — not design documents. They do not follow DESIGN_DOC_TEMPLATE.md and do not have lifecycle states. They are living references updated as design documents lock. All reside in a new `reference/` directory in `homesynapse-core-docs`.

| Artifact | Purpose | When | Value |
|---|---|---|---|
| `event-type-registry.md` | Flat registry of every event type, subject type, producer, default priority, event category, and owning design document. | After Doc 11 locks (all event-producing subsystems designed). Updated as Docs 08–11 add event types. | Essential for Phase 2 event type enum. Essential for Doc 14. Essential for Doc 11 metric surface catalog. |
| `subscriber-registry.md` | Consolidated registry of every event bus subscriber: owning subsystem, filter spec, processing mode, checkpoint strategy, health indicator, estimated memory contribution. | After Doc 11 locks. | Essential for Doc 12 (startup initialization order). Essential for Doc 14 (memory budget). Useful for Doc 11 (observability targets). |
| `configuration-schema-registry.md` | Consolidated registry of every configuration namespace, key, type, default, validation rule, hot-reload support, and owning document. | After Doc 12 locks (startup config included). Final consolidation during Doc 14. | Direct input to Phase 2 JSON Schema specification. Prevents configuration key conflicts across subsystems. |
| `gradle-module-map.md` | Mapping from each subsystem to Gradle module name, module dependencies, exported packages, and deployment tier inclusion. | During Doc 14 drafting. | Prevents circular module dependencies. Ensures Companion-tier extraction path is viable. Feeds Phase 2 package structure. |

### Phase 2 Transition Guide

A governance artifact (`governance/phase-2-transition-guide.md`) mapping each Phase 1 design document to its Phase 2 deliverables: Java packages, interfaces requiring full method signatures, types requiring records/enums/sealed hierarchies, external specifications (OpenAPI for Doc 09, AsyncAPI for Doc 10). Also defines the Phase 2 document template and quality gate.

**When:** Begin drafting after Doc 09 locks (API surface clarifies Phase 2 shape). Finalize alongside Doc 14.

### Artifacts Explicitly Deferred

- **Projections & Aggregation design document.** Tier 2 concern. The existing subscriber model accommodates multi-tier aggregation, Home Health Score, and Device Reliability Projection without new architecture. If needed, amendments to Docs 03/04 are sufficient. Decision deferred until after Doc 09.
- **Standalone Security Architecture.** Per-subsystem §12 (Security Considerations) is sufficient for Tier 1 (local-only, single-user, LAN-only API). Doc 14 includes a security summary consolidating §12 content across all docs. Standalone security architecture warranted for Tier 2 (external network access, authentication, encryption-at-rest).
- **Deployment Guide.** Phase 3 artifact. Doc 12 covers design-level lifecycle concerns. Operational guide written when there is software to deploy.
- **Integration Developer Guide.** DAS content artifact (explanation type). Written after Phase 2 when the Integration API has concrete method signatures. Doc 05 and Doc 08 (as reference implementation) provide the design foundation.

---

## Cross-Audit History

### Round 1 (Docs 01–02): 12 amendments identified, all applied.
### Round 2 (Docs 01–04): 12 amendments identified, all applied.
### Round 3 (Doc 05): 18 findings (4 critical, 7 significant, 7 minor). All resolved. 10 upstream amendments applied.
### Round 4 (Cross-document consistency audit): 10 amendments across 7 documents. All applied.
### Round 5 (Doc 06): 14 findings (4 critical, 4 significant, 6 minor). All resolved. 3 upstream amendments applied (2 to Doc 01, 1 to PROJECT_STATUS).
### Cross-document consistency pass (post-Round 5): 8 findings (1 significant, 4 moderate, 3 minor). All actionable items resolved via 8 amendments across 6 documents (Doc 01, Doc 03, Locked Decisions, Glossary, Identity Model, Architecture Invariants). Three findings deferred with documented rationale.
### Round 6 (Doc 07): 14 findings (3 critical, 5 significant, 6 minor). All resolved. 10 Doc 07 amendments applied. 4 upstream amendments applied (Glossary v1 enum corrections, Doc 01 Dependents, Doc 02 Dependents, MVP §9.3 footnote). Critical findings: subscription filter subject type mismatch for config_changed events (resolved via ConfigurationChangeListener callback), presence_changed contradiction with Open Question 2 (resolved by removal from filter), Glossary trigger_type/action_type/condition_type enum gaps (resolved by Glossary amendment A-G2-R6-1). Pass 3 event_category forward reference applied to Doc 07 §12.
### Round 7 (Docs 08–09) — Complete:
**Doc 09 pre-audit pass:** 8 amendments identified (3 critical, 5 significant). Critical: health endpoint auth contradiction resolved (A-09-R7-1), correlation ID propagation conflict with Doc 01 publishRoot() resolved (A-09-R7-2, A-09-R7-3). Significant: automation plane description corrected (A-09-R7-4), performance targets context added (A-09-R7-5), DegradedEvent handling specified (A-09-R7-6), event_category forward reference added (A-09-R7-7), section references corrected (A-09-R7-8). Governance: LTD-06 naming corrected (A-LTD-R7-1), PROJECT_STATUS Dependents table completed (A-STATUS-R7-1). Two initial findings (command_issued producer, state_confirmed taxonomy) withdrawn after source verification.
**Doc 08 pre-audit pass:** 9 amendments applied (A-08-R7-1 through A-08-R7-9). Targeted ecosystem-risk analysis covering zigbee2mqtt, ZHA, and broader Zigbee community failure modes. External review received and validated — 4 of 10 reviewer claims rejected (OTA, backup/restore, Green Power, TelemetryWriter mapping already addressed in Doc 08). Accepted findings: (1) Aqara channel restriction (A-08-R7-1), (2) Transport auto-detection (A-08-R7-2), (3) EZSP version range (A-08-R7-4), (4) Local device cache resolved as mandatory (A-08-R7-3), (5) Command backpressure (A-08-R7-5), (6) Coordinator firmware parameters (A-08-R7-6), (7) Initialization writes (A-08-R7-7), (8) Permit-join contract (A-08-R7-8), (9) Zigbee group commands future consideration (A-08-R7-9).
**Full cross-audit (Tracks A–E) complete.** Doc 08: 0 critical, 2 significant, 3 minor — all applied. Doc 09: 0 findings (pre-audit resolved everything). Cross-consistency (Track D): 0 findings. Governance (Track E): 0 findings. **7 upstream Dependents amendments (U-01 through U-07) pending application to Docs 01–07.**
### Round 8–9 (Docs 10–11): Docs 10 and 11 drafted, reviewed, and locked. AMD-09 (reconnection admission control + rate limiting) applied to Doc 10 pre-lock. 6 upstream Dependents field updates (U-01-R8, U-02-R8, U-05-R8, U-01-R9, U-03-R9, U-04-R9) applied to Docs 01–05. HealthContributor upstream notes applied to all Docs 01–10. Docs 10 and 11 locked 2026-03-09.
### Round 10 (Critical Design Review — 4 BLOCKING amendments): AMD-02 reconciliation pass applied to Doc 03 (new §3.2.1: REPLAY→LIVE reconciliation that re-derives missing `state_changed` events from in-flight `state_reported`, bounded by replay window, emits `system.reconciliation_completed` event; cross-reference to Doc 01 §8.3 EventPublisher durability semantics). AMD-10 projection versioning applied to Doc 03 (new `projection_version` field in checkpoint schema and `CheckpointRecord`, `CURRENT_PROJECTION_VERSION` compile-time constant, startup mismatch triggers full replay from position 0). AMD-04 cascade depth limiting applied to Doc 07 (new §3.7.1: cascade_depth counter on AutomationRun, max 8 configurable, duplicate suppression per correlation_id, natural termination via Doc 03 §3.2 change detection, health DEGRADED on repeated hits) and Doc 01 (§4.4: cascade_depth as derived field in causal chain projection). AMD-03 snapshot usage pattern applied to Doc 07 §3.8 (condition evaluation captures StateSnapshot via getSnapshot() at trigger time for consistent cross-entity state view).
### Round 10–11 Summary — Critical Design Review
A fresh-perspective adversarial review of all 11 design documents identified 24 amendments (AMD-01 through AMD-24). Nick reclassified: 4 BLOCKING, 9 REQUIRED, 9 RECOMMENDED, 2 rejected (AMD-01 durability contract — already specified; AMD-06 single-writer contention — no real gap). Three systemic themes: (1) boundary contracts at subsystem interfaces, (2) production resilience gaps (failure modes, recovery paths), (3) API stability for client-facing contracts. All 13 BLOCKING + REQUIRED amendments applied in Rounds 10–11 across 8 design documents. 9 RECOMMENDED amendments remain for opportunistic application. Full decision record: `research/Critical_Design_Review_Docs_01_11_v1.md`.

### Round 12 (Doc 12) — Complete:
**Cross-audit results:** 1 critical, 6 significant, 1 minor. Critical: checkpoint field name `globalPosition` should be `view_position` (Doc 03 §3.3 schema). Significant: missing `cell_size_check` PRAGMA (Doc 04 §3.3), schema composition timing conflict with integration schemas (Doc 06 §3.2), REST API section reference §3.1→§3.9, health aggregation model description imprecise vs Doc 11 §3.3 tier model, 10 upstream Dependents updates. Minor: unclean shutdown marker write step not explicit. **All findings addressed. Upstream Dependents applied. Locked 2026-03-09.**

### Round 13 (Doc 13 — Web UI Observability MVP) — Complete:
**Cross-audit results:** 0 critical, 5 significant, 5 minor. **All findings applied. Upstream Dependents applied. Locked 2026-03-10.**
Significant: (S-01) §8.2 missing 5 WebSocket message types from Doc 10 §3.3 — `auth_result`, `subscription_confirmed`, `subscription_error`, `pong`, `replay_queued` added. (S-02) §3.8 health tier grid omitted Observability (Doc 11) from Tier 2 — added to diagram. (S-03) WebSocket endpoint path `/api/v1/ws` contradicts Doc 10 §3.1 `/ws/v1` — corrected throughout. (S-04) §3.5 reconnection sequence missing `replay_queued` handling per Doc 10 §3.9 admission control — new step 7 added with queue indicator and deduplication behavior, new §6 failure mode added. (S-05) Missing INV-TO-01 (observable behavior) and INV-SE-02 (authentication required) citations — added to §0 and §12 respectively.
Minor: (M-01) Path parameter `{id}` → `{integration_id}` per Doc 09. (M-02) §10 Pi 4 validation floor note added per LTD-02 pattern. (M-04) §13 browser memory exhaustion test added. (M-05) §13 browser compatibility test section added (new §13.5, accessibility renumbered to §13.6).
Upstream Dependents: Doc 09 Dependents updated with Doc 13 section-level references (§8.1, §3.6, §3.8, §3.9, §12). Doc 10 Dependents updated (§3.5, §8.2, §3.7, §3.8). Doc 11 Dependents updated (§3.8, §3.6.3, §3.6.2, §11.3). Doc 12 Dependents updated (§3.2, §7).
LTD-18 (Web UI Technology — Preact SPA for Observability, HTMX reserved for Tier 2+) created during Doc 13 drafting session.

### Round 14 (Doc 14 — Master Architecture Document) — Complete:
**Cross-audit results:** 0 critical, 3 significant, 2 minor. **All findings applied. Locked 2026-03-10.**
Significant: A-14-R14-1 Observability memory reclassification (25 MB JFR moved from heap table to native table, ~10 MB heap estimate added for in-JVM components, subtotals corrected from 190→175 MB heap). A-14-R14-3 Template variance note added to §0 documenting that Doc 14 is "Architecture synthesis" not "Subsystem design." A-14-R14-4 MVP §8 source citation added to §10.1 Constitutional Targets.
Minor: A-14-R14-2 JFR native memory label corrected in §3.5.2. A-14-R14-5 event_category open question cross-reference strengthened with category list and forward reference docs.
No upstream Dependents — Doc 14 depends on all docs but no Phase 1 doc depends on Doc 14.
**Phase 1 complete. All 14 design documents locked.**

### Round 11 (Design Review — 11 REQUIRED amendments, 10 applied, 1 pre-applied): AMD-11 state TTL applied to Doc 03 (staleAfter/stale fields on EntityState record, new §3.8 staleness model with capability-based defaults, passive 30-second scan, state_stale event emission, lazy read-time evaluation, staleness config §9, API contract note in §5). AMD-17 device orphan lifecycle applied to Doc 02 (new §3.15: ORPHANED state triggered by integration FAILED/removed, frozen state with stale:true via AMD-11 staleness model, command rejection with device_orphaned error, automation evaluation returns last known value with stale_input warning, re-adoption matching via preserved hardware identifiers, explicit removal via REST API, health DEGRADED when orphaned devices exist, orphan config §9). AMD-14 adapter dependency ordering applied to Doc 05 (new §3.13: dependsOn field on IntegrationDescriptor, topological sort startup via Kahn's algorithm, cycle detection rejects cyclic integrations, SUSPENDED state for dependency failure propagation, reverse-order shutdown, dependency config §9). AMD-13 configuration migration framework applied to Doc 06 (new §3.7: ConfigMigrator interface, MigrationResult/ConfigChange/ChangeType records, sequential migration chain, migration preview CLI, backup before migration, testing contract, migration config §9; supersedes §14 future consideration). AMD-16 secrets store backup applied to Doc 06 (§3.4: per-operation backup before set/delete, 5-rotation retention, recovery CLI with homesynapse secrets restore/list-backups, backup config §9, §6.9 updated to reference backups). AMD-07 route health monitoring applied to Doc 08 (new §3.15: RouteHealth record with HEALTHY/DEGRADED/UNREACHABLE states, command-failure-triggered recovery at 3 consecutive failures, device UNAVAILABLE at 10 failures, weak-link analysis on topology scan, coordinator exclusion, route_health config §9). AMD-08 idempotency keys applied to Doc 09 (§3.4: optional Idempotency-Key header on command endpoint, in-memory LRU cache 10K entries 24h TTL, IdempotencyEntry record, idempotency_key on command_issued event, conflict detection, idempotency-key-conflict problem type, idempotency config §9). AMD-15 correlation ID in error responses applied to Doc 09 (§3.8: correlation_id extension member in all RFC 9457 error bodies, X-Correlation-ID response header on all responses, auto-generated ULID when client omits header). AMD-09-RL rate limiting table confirmed pre-applied to Doc 10 (Part 1 Round 8–9). AMD-05 daily_bytes_written applied to Doc 11 (§3.5 metric table updated, collection via /proc/diskstats hourly, daily reset with JFR total event, health DEGRADED threshold at 10 GB/day, storage monitoring config §9). Cross-document consistency verified: AMD-11 staleness model and AMD-17 orphan lifecycle both set stale:true via the same mechanism (Doc 03 §3.8). AMD-17 device_orphaned error added to Doc 09 problem type table.

---

## Pending Amendments

### Active — None

All pending upstream Dependents (U-01 through U-07 from Round 7, U-01 through U-10 from Round 12, U-09 through U-12 from Round 13) have been applied. No active amendments remain.

### Deferred — Apply opportunistically

**9 RECOMMENDED review amendments (AMD-12, AMD-18, AMD-19, AMD-20, AMD-21, AMD-22, AMD-23, AMD-24).** See `research/Critical_Design_Review_Docs_01_11_v1.md` §3 for full list. AMD-22 (HealthChangeListener) and AMD-18 (causal chain timeout) are candidates for integration during Doc 12 drafting.

### Outside Phase 1 design documents

See Pending Governance Actions section: isolation language correction required in any strategic-layer documents that describe integration fault isolation as "isolated process."

---

## Tracked Risks

### Memory Budget Tightness

LTD-01 allocates -Xmx1536m. LTD-03 specifies 128 MB SQLite native page cache (outside JVM heap) plus 1 GB mmap. LTD-13 caps the systemd cgroup at MemoryMax=2G. **Resolved in Doc 14 §3.5.** Comprehensive memory budget compiled: ~175 MB JVM heap (against 1536 MB limit), ~230–260 MB native resident, 650–850 MB total RSS estimate. INV-PR-02 measurement methodology defined: live heap after major GC via JFR GCHeapSummary events. 512 MB target applies to live heap only, not total RSS. Phase 3 spikes should include RSS monitoring to validate estimates empirically.

**Doc 07 memory contribution (added 2026-03-07).** Doc 07 §10 estimates the automation subsystem at < 50 MB steady-state: Automation Registry (~500 KB), trigger index (~50 KB), active Runs at max concurrent 200 (~300 KB), Pending Command Ledger at max 500 entries (~100 KB), plus subscriber overhead. The three independent subscribers (automation_engine, command_dispatch_service, pending_command_ledger) add three virtual threads (~3 KB). This is well within budget but must be validated empirically during Phase 3.

**Doc 09 memory contribution (added 2026-03-07).** Doc 09 §10 estimates the REST API subsystem at < 20 MB steady-state. The API holds no persistent state — memory is dominated by the HTTP server's connection buffers, pre-built Jackson ObjectReader/ObjectWriter instances, and in-flight request allocations. Rate limiter state is bounded by the number of active API keys (typically < 10). This is the lightest subsystem memory contribution among all designed subsystems.

**Doc 08 memory contribution (updated 2026-03-08).** Doc 08 §10 specifies < 30 MB adapter heap for 50 devices / ~150 entities. Breakdown: coordinator protocol state machine (~100 KB), local device metadata cache per A-08-R7-3 (50 devices × ~2 KB ZigbeeDeviceRecord = ~100 KB, persisted to zigbee-devices.json on debounced writes), cluster-to-capability mapping registry (~50 KB for standard mappings + Tuya/Xiaomi translation tables), per-device reporting configuration cache (~50 KB), network topology map (~50 KB for 50-device mesh), serial I/O BlockingQueue buffers (~100 KB inbound + outbound at 1000+64 entry capacity), and device profile registry (~50 KB for bundled + user profiles). Plus the platform thread for serial I/O (~1 MB thread stack). The Zigbee adapter is the only integration that requires a dedicated platform thread (IoType.SERIAL), consuming one of the four carrier threads on RPi 5. The coordinator firmware's internal memory (running on the CC2652/EFR32 MCU) is outside the JVM budget.

**Portability Architecture memory implications (added 2026-03-07).** The Portability Architecture research (Track C) identifies that the Constrained-tier memory budget (LTD-01 -Xmx1536m, LTD-03 128 MB cache + 1 GB mmap) is the tightest configuration. Higher tiers scale linearly: Standard at -Xmx3g/64 MB cache/512 MB mmap, Enhanced at -Xmx6g/128 MB cache/1 GB mmap. The AdaptivePragmaConfig interface (Portability Architecture §7.3) will parameterize these values at startup based on detected hardware. The Companion tier does not carry a JVM or SQLite, eliminating this risk category entirely.

**Contingency (added 2026-03-07).** If the comprehensive memory budget in Doc 14 reveals that cumulative subsystem estimates exceed ~256 MB headroom: (1) identify largest contributors, (2) determine if estimates contain tightenable conservatism, (3) if not, escalate to LTD-01 or LTD-13 amendment discussion (increase heap or cgroup limit), (4) if hardware constraints are truly binding, identify subsystem-level optimizations. This does not require redesigning any locked document — it requires tuning configuration parameters that are already designed as configurable.

### SD Card Deployment

LTD-02 requires NVMe; INV-CE-02 prevents blocking SD card users. Detected and warned (Doc 04 §3.9), not prevented. Accepted risk.

### Performance Target Portability (added 2026-03-07)

The performance targets stated in Docs 01–07 and in INV-PR-02 are Constrained-tier commitments measured against RPi 5 / RPi 4 hardware with the Java 21 runtime specified in LTD-01. These targets serve as concrete design constraints for downstream documents (Doc 07 Automation Engine needs a latency budget for trigger evaluation; Doc 10 WebSocket API needs state query speed assumptions; Doc 04 Persistence Layer retention scheduling needs write throughput headroom).

The targets are not architectural absolutes. The HomeSynapse architecture — event sourcing patterns, API contracts, subsystem boundaries — is designed to be portable across runtimes and hardware. The specific throughput and latency numbers are a function of the runtime, storage engine, and deployment hardware. A future port to a different language or hardware target would re-derive these numbers through empirical validation while preserving the same architectural contracts.

**Phase 3 validation gate:** Before Tier 2 implementation begins, the Constrained-tier performance targets in Docs 01–07 must be validated empirically on RPi 5 hardware. If any target is not met, the resolution options are: (1) tune configuration (PRAGMA settings, JVM flags, batch sizes), (2) adjust the target with documented rationale and impact analysis on downstream docs, or (3) swap the storage backend per the pluggable `EventStore` interface (LTD-03). This validation gate is a Phase 3 milestone, not a Phase 1 design blocker.

### Platform Portability Beyond RPi (added 2026-03-07)

The HomeSynapse Core is designed for RPi 5 as the primary target but must ultimately run reliably on smartphones, tablets, laptops, desktops, mini-PCs, and enterprise servers — and serve as the foundation for specialized NexSys products (e.g., energy-grid management software). The architectural contracts (event sourcing, API boundaries, subsystem isolation) are language-agnostic and hardware-agnostic by design. However, the implementation makes assumptions (SQLite WAL single-writer, systemd lifecycle, NVMe I/O profile, ARM64 JIT tuning, G1GC pause budgets) that must be audited for portability before the core is deployed outside the RPi/Linux/server context.

**Resolution:** Portability Architecture research document (Track C) completed 2026-03-07. Identifies three required abstraction interfaces (HealthReporter, PlatformPaths, AdaptivePragmaConfig), classifies all 17 locked decisions by portability risk (11 portable, 4 parameterizable, 2 platform-specific), defines the six-tier deployment model, formalizes the Companion app as a thin client (not a HomeSynapse instance), and analyzes the NexSys energy product as a build variant of the core. See Portability Architecture v1 for full analysis. Findings feed into Doc 12 (HealthReporter, PlatformPaths interfaces) and Doc 14 (tier model, NexSys foundation, Companion architecture).

### Integration Runtime API Validation (added 2026-03-07)

**Status: Validated.** Doc 08 (Zigbee Adapter) is the first concrete protocol integration. It validated the Integration Runtime API surface (Doc 05) against a real protocol. The pre-audit amendments (A-08-R7-1 through A-08-R7-9) refined the adapter design without revealing any Doc 05 API gaps. The Round 7 cross-audit (Track B) confirmed all Doc 05 references in Doc 08 are correct and complete. **No Doc 05 amendment required.**

### Zigbee Event Volume Impact (added 2026-03-07)

Doc 08 research estimates event volume for a 50-device Zigbee home at ~258 events/hour (~6,200/day, ~2.3M/year) at typical reporting intervals. Adding energy monitoring at 10-second intervals for 5 smart plugs contributes ~1,800 additional events/hour. Total: ~2,058 events/hour peak = ~0.57 events/second average, well within the 100 events/second design target (Doc 01 §6). However, burst scenarios (all 50 devices reporting simultaneously after a power restoration) could spike to 50+ events in <5 seconds. The BlockingQueue buffer (1000 entries per Doc 05 §3.2) provides adequate headroom. Doc 08 §10 specifies performance targets for the adapter's serial I/O throughput and event processing latency: > 200 events/sec sustained throughput, < 15 ms p99 attribute report processing latency.

---

## Data-Readiness Design Concerns (added 2026-03-07)

The Data-Readiness Specification identifies four structural additions to the MVP that create preconditions for future data value without adding user-facing scope: (1) `event_category` field on the event envelope, (2) multi-tier aggregation engine (hourly/daily/weekly/monthly), (3) Home Health Score materialized view subscriber, (4) Device Reliability Projection materialized view subscriber.

**event_category (Doc 01 scope).** A required string array field on the event envelope, populated by static lookup from event_type to consent-scope categories at event creation time. Eight categories: device_state, energy, presence, environmental, security, automation, device_health, system. Aligns with INV-PD-07 crypto-shredding scopes. Doc 07 §12, Doc 09, and Doc 10 §12.6 contain forward references establishing category assignments. **Amendment A-01-DR-1 applied** — Doc 01 §4.1 (envelope field), §4.4 (category taxonomy), §12 (security), §16 (D15 key decision). Glossary §3.9 updated. Doc 14 §15 Open Question 1 resolved.

**Multi-tier aggregation, Home Health Score, Device Reliability Projection.** These introduce three additional materialized view subscribers to the event bus. Each is a standard subscriber with checkpoint persistence — architecturally compatible with the existing subscriber model. Combined steady-state memory contribution is estimated at < 30 MB (health score subscriber ~5 MB, reliability projection ~10 MB, aggregation engine ~15 MB for hourly/daily accumulation buffers). This must be included in the Doc 14 memory budget. Design ownership: these may warrant a dedicated design document (e.g., "Projections & Aggregation") or amendments to Docs 03/04. Decision deferred until after Doc 09.

---

## Known Design Gaps

### Pending Command Ledger Consolidation
Split across Doc 01 §3.8 and Doc 02 §3.10. **Resolved in Doc 07 §3.11.2.** The Pending Command Ledger is designed as a core subscriber within the automation subsystem, consuming behavioral specifications from Doc 01 §3.8 and ExpectationFactory from Doc 02 §3.10. Checkpoint, health indicator, and causal chain linking specified.

### Command Dispatch Service Ownership
The Command Dispatch Service appears in the event taxonomy (Doc 01 §4.3) as the producer of `command_dispatched` events but had no subsystem design home. **Resolved in Doc 07 §3.11.1.** Designed as a thin routing resolver on a dedicated subscriber within the automation subsystem.

### State Projection Self-Delivery Skip Mechanism
Doc 03 §3.2 notes need, mechanism unspecified. Resolution in Phase 2.

---

## Tier Transition Constraints (added 2026-03-07)

### Energy Adapter as First Tier 2 Deliverable

LTD-12 locks Zigbee as the sole protocol adapter in Tier 1. The Architecture Invariants §16.1 commits to energy intelligence as the primary revenue-generating capability, and INV-EI-01 requires the MVP device model and event taxonomy to include energy entity types (which they do — the schema accommodates energy entities without changes). However, the whole-home energy monitoring experience (INV-EI-05, §16.1 Phase 1) requires a local-network energy monitor integration that Zigbee alone cannot deliver.

**Constraint:** The first Tier 2 deliverable is a local-network energy monitor adapter (Shelly EM or equivalent local-API device). It is the first implementation task after Tier 1 acceptance criteria are met. No other Tier 2 work begins until this adapter ships.

**Rationale:** This adapter is `IoType.NETWORK` (Doc 05 §3.2), uses HTTP polling, requires no serial I/O, no JNI, and no platform threads. It is architecturally the simplest possible adapter — far simpler than the Zigbee adapter — and exercises the network I/O path through the Integration Runtime without introducing the complexity of the serial I/O path.

**Doc 08 research note (updated 2026-03-07).** Research confirms that Zigbee smart plugs with energy monitoring (Aqara Smart Plug SP-EUC01, Tuya TS011F) implement both Electrical Measurement (0x0B04) and Metering (0x0702) clusters. The Sonoff S31 Lite ZB does NOT support energy monitoring — only the WiFi version does. Per-device energy monitoring through Zigbee is achievable in Tier 1 as an interim demonstration.

---

## Subsystem Evolution Notes (added 2026-03-07)

### Scheduler Absorption

No standalone Scheduler subsystem exists. Scheduling responsibilities are distributed to the subsystems where they are consumed:

| Responsibility | Owner | Reference |
|---|---|---|
| Integration polling schedules | Integration Runtime — `SchedulerService` | Doc 05 §3.8 (IntegrationContext composed services) |
| Retention policy execution | Persistence Layer — retention scheduling | Doc 04 §3.5 (retention enforcement) |
| Telemetry aggregation cycles | Persistence Layer — aggregation engine | Doc 04 §3.7 (aggregation virtual thread) |
| Time-based automation triggers | Automation Engine (Tier 2 implementation) | Doc 07 §3.4 — schema defined, implementation deferred |
| Configuration file watch | Configuration System — file watcher | Doc 06 §3.4 (file system monitoring) |

This distribution is architecturally sound: each scheduling concern is owned by the subsystem that understands its semantics. A standalone Scheduler would have been a coordination layer with no domain knowledge, adding indirection without value.

### Naming Alignment

| MVP §9.3 Name | Actual Design Doc Name | Notes |
|---|---|---|
| Event Model & Event Bus | Event Model & Event Bus | Unchanged |
| Device Model & Capability System | Device Model & Capability System | Unchanged |
| State Store | State Store & State Projection | Expanded to include the State Projection as a co-located concern |
| Persistence Layer | Persistence Layer | Unchanged |
| Integration Runtime | Integration Runtime | Unchanged |
| Configuration System | Configuration System | Unchanged |
| Automation Engine | Automation Engine | Unchanged. Scope expanded to include Command Pipeline (Command Dispatch Service + Pending Command Ledger). |

---

## Pending Governance Actions (added 2026-03-07)

### Isolation Language Correction

The architectural contract for integration isolation (INV-RF-01) specifies that the isolation boundary is an implementation detail, not an API contract. Any strategic-layer documents (Technology and Architecture overview, investor materials, external communications) that use "isolated process" language to describe integration fault isolation must be corrected to match the contract-level formulation: "Each integration runs in a supervised, isolated execution context. The specific isolation mechanism (in-process with virtual thread supervision, out-of-process with IPC, container-level sandboxing) is an implementation decision that may change across versions and deployment tiers without requiring any change to integration code." The current MVP mechanism (in-process virtual thread supervision within a single JVM) should be described as the Constrained-tier realization, with the JNI native crash caveat (Doc 05 §6.8) noted as a known limitation of this specific mechanism that does not apply to out-of-process implementations.

**Action:** Audit all documents outside the Phase 1 design corpus for "isolated process" or equivalent language. Correct to match INV-RF-01. This is a documentation accuracy issue, not an architectural change.

---

## Doc 07 Design Summary (added 2026-03-07)

Doc 07 (Automation Engine) resolves all eight design questions from competitive research. Key decisions:

| # | Decision | Choice | Significance |
|---|---|---|---|
| D1 | Execution model | One virtual thread per Run | Lightweight, sequential, natural for Java 21 |
| D2 | Concurrency modes | single/restart/queued/parallel (adopts HA model) | Industry-proven; each transition event-sourced |
| D3 | Trigger dedup | By (automation_id, triggering_event_id) | Diverges from HA; preserves clean causal chains |
| D5 | Execution order | Priority desc, automation_id asc | Deterministic — no competitor offers this |
| D7 | Replay behavior | Trigger evaluation proceeds; conditions/actions suppressed | Conservative; avoids partially-replayed state |
| D8 | Hot-reload | In-progress Runs complete on original definition | Event-sourced: definition hash captured at trigger time |
| D11 | Command Pipeline | Doc 07 owns Dispatch Service + Pending Command Ledger | Resolves two tracked design gaps |
| D12 | Command tracking | Full intent-to-observation loop | Strongest competitive differentiation per research |

**Status:** Locked. Round 6 cross-audit complete. All upstream amendments applied. Three non-blocking open questions remain (§15).

---

## Doc 08 Design Summary (updated 2026-03-08)

Doc 08 (Zigbee Adapter) is the first concrete integration — it validates the Integration Runtime API surface (Doc 05) against a real protocol. Research complete 2026-03-07. Full design document drafted 2026-03-08. Pre-audit amendments applied 2026-03-08. **Round 7 cross-audit complete 2026-03-08.**

### Design decisions made

- **Two-layer coordinator architecture** (§3.2–§3.3). Platform thread transport (ZNP UNPI or EZSP/ASH) feeding virtual thread protocol layer via BlockingQueue. CompletableFuture-based SREQ/SRSP correlation. Auto-detection of coordinator type via probe sequence with defensive timing and serial flush between probes; manual `adapter_type` config fallback if auto-detection fails (A-08-R7-2). Semaphore-limited concurrent operations (16 for CC2652, 2 for CC2531).
- **EZSP version target** (§3.3). EZSP 13+ (EmberZNet 7.4+) is the primary supported range. EZSP 8–12 operates in legacy mode with a structured WARN log recommending firmware update. Below EZSP 8 is rejected (A-08-R7-4). Aligns with ecosystem direction — z2m deprecated its EZSP 8–12 driver.
- **Three-tier device handling** (§3.5–§3.9). Standard ZCL cluster handlers for ~60% of devices (12 MVP clusters mapped to HomeSynapse capabilities). Device profile registry (JSON-based, bundled + user overrides) for ~10% minor quirks. Isolated manufacturer codecs for Tuya DP (cluster 0xEF00, ~15–20%) and Xiaomi TLV (attributes 0xFF01/0xFCC0, ~10–15%). Profile schema includes `initializationWrites` for post-adoption manufacturer-specific attribute writes — enables Aqara decoupled mode and similar configuration (A-08-R7-7).
- **10-step device interview pipeline** (§3.4). Device Announce through cluster binding and reporting configuration. Sleepy device pending queue with 24-hour expiry. 3-retry exponential backoff with partial-interview fallback. Xiaomi/Aqara reporting configuration excluded via profile flag.
- **At-most-once command dispatch with backpressure** (§3.10). No silent retries — prevents duplicate physical actions. ExpectationFactory integration with Pending Command Ledger. Bounded 64-frame outbound queue; QUEUE_FULL failure on overflow prevents coordinator buffer exhaustion under burst load (A-08-R7-5). IKEA sequential-command workaround for simultaneous brightness + color temperature.
- **Power-source-aware availability** (§3.11). Active ping (read OnOff) after 10 min silence for mains devices. Passive 25-hour timeout for battery devices. Per-frame RSSI/LQI extraction. On-demand BFS topology scan via ZDO Mgmt_Lqi_req.
- **IAS Zone enrollment** (§3.12). CIE address write + ZoneEnrollRequest/Response handshake. Zone type determines capability mapping (motion, contact, water_leak, smoke, vibration).
- **Network security with Aqara-safe channel selection** (§3.13). AES-128 key via SecureRandom, encrypted at rest. Two-tier channel preference: primary tier (15, 20, 11) for broadest device compatibility including Aqara; fallback tier (21–26) only if all primary channels are heavily congested (A-08-R7-1). Default channel 15. Automatic permit-join timeout; normal device operations unaffected during permit-join (A-08-R7-8).
- **Local device metadata cache** (§3.14). Mandatory per-device protocol-level cache (ZigbeeDeviceRecord) with IEEE→NWK mapping, endpoint descriptors, manufacturer/model, power source, last-seen. Populated from coordinator device table on startup, reconciled on NWK address changes, persisted to JSON file on debounced 30-second writes (A-08-R7-3). Source of truth for protocol-level routing; EntityRegistry remains source of truth for HomeSynapse-level identity.
- **Coordinator firmware parameter logging and EZSP config overrides** (§9). Firmware capabilities logged at INFO on startup. Optional EZSP config overrides for advanced users: CONFIG_MAX_END_DEVICE_CHILDREN, CONFIG_SOURCE_ROUTE_TABLE_SIZE, CONFIG_APS_UNICAST_MESSAGE_COUNT (A-08-R7-6).
- **OTA deferred** (§14). Architecture accommodates future addition via ClusterHandler extension point. Users use zigbee2mqtt or manufacturer apps in MVP. Green Power and Zigbee group commands documented as future considerations.

### Two non-blocking open questions

1. ~~Local device metadata cache vs. EntityRegistry-only queries~~ **Resolved (A-08-R7-3).** Cache is mandatory.
2. Coordinator backup/restore for hardware migration (recommended: support via CoordinatorProtocol, implement post-launch based on demand)
3. Illuminance value conversion strategy (recommended: device-profile-driven log-scale vs. direct-lux mode selection)

**Status:** Audit complete. Ready to lock after upstream Dependents applied.

---

## Doc 09 Design Summary (added 2026-03-07)

Doc 09 (REST API) defines the HTTP API surface as a translation layer over HomeSynapse's event-sourced internals. Competitive research across SmartThings, Google Home, Home Assistant, Alexa, Matter, and HomeKit informed twelve key design decisions. The document is 987 lines, covers all 16 template sections (13 mandatory, 2 conditional, 1 optional), and has three non-blocking open questions.

| # | Decision | Choice | Significance |
|---|---|---|---|
| D1 | API architecture | Stateless translation layer, zero persistent state | Crash recovery is instant; no shadow domain model. |
| D2 | Command model | Typed invocation via POST, not state mutation via PUT | Matches cross-platform convergence; enables lifecycle tracking. |
| D3 | Command lifecycle | Four-phase: accepted → dispatched → acknowledged → confirmed | No existing platform exposes all four phases. Primary API differentiator. |
| D4 | Pagination | Cursor-based (opaque Base64 over sort key) | Stable under concurrent appends in append-only log. |
| D5 | Caching | ETag from viewPosition (state), event_id (events), definition_hash (automations) | First smart home platform with proper HTTP caching semantics. |
| D6 | Error model | RFC 9457 Problem Details for all errors | Standardized, machine-readable, typed error identifiers. |
| D7 | Endpoint taxonomy | Five operational planes with distinct consistency contracts | State Query, Command, Event History, Automation, System Admin — each with appropriate Cache-Control. |
| D8 | Authentication | API key (Tier 1), bearer token path reserved (Tier 2) | Satisfies INV-SE-02. CLI-managed keys with bcrypt storage. |
| D9 | Transport | HTTP on LAN (Tier 1), TLS required for non-LAN (Tier 2) | Pragmatic: no home platform mandates LAN TLS. Auth still required. |
| D10 | Composite queries | Handler-level join of EntityRegistry + StateQueryService | Follows State Store §8.1 filtered query design. No secondary indexes in State Store. |
| D11 | Concurrency | Virtual thread per request | Natural for Java 21 (LTD-01). No thread pool sizing. |
| D12 | Correlation | Client X-Correlation-ID logged but not injected into event envelope | Preserves Doc 01 causal chain invariant. End-to-end tracing via structured logs. |

**Status:** Audit complete. Ready to lock after upstream Dependents applied.

---

## Track C Summary — Portability Architecture (added 2026-03-07)

The Portability Architecture research artifact (Track C) is drafted. It synthesizes the Java 21 portability research and the platform portability matrix into a product-level deployment model. Key conclusions:

**Six deployment tiers formalized.** Constrained (RPi hub), Standard (mini-PC hub), Enhanced (server), Companion (phone/tablet controller), Enterprise (NexSys energy product), Multi-instance (coordinated hubs). The existing four-tier model from Architecture Invariants §0.5 is extended with Companion and Enterprise.

**Companion app is a thin client.** It shares type-definition Gradle modules (event-types, device-types, serialization, api-client) with the core but does not run the HomeSynapse process. No event store, no automation engine, no integration runtime. Connects to a hub via REST and WebSocket. Deferred to post-Tier 1.

**NexSys is a build variant.** Full HomeSynapse Core plus energy-domain Gradle modules (nexsys-energy-types, nexsys-openadr, nexsys-rate-engine, nexsys-solver, per-vendor adapters). The INV-EI invariants are satisfied by core contracts already designed. NexSys activates them with domain-specific integrations that are all IoType.NETWORK.

**Three abstraction interfaces identified for pre-non-RPi deployment.** HealthReporter (lifecycle health reporting across supervisors), PlatformPaths (directory conventions per OS), AdaptivePragmaConfig (SQLite PRAGMA tuning per hardware). HealthReporter and PlatformPaths should be defined in Doc 12. AdaptivePragmaConfig is a Phase 2 concern acknowledged by Doc 04.

**Risk classification: 11 portable, 4 parameterizable, 2 platform-specific** across all 17 locked decisions. The two platform-specific decisions (LTD-13 lifecycle, LTD-12 serial I/O) already have designed abstraction points.

**CI/CD testing matrix defined.** Four tiers: fast feedback (every push), platform matrix (every PR merge across Linux x86-64/ARM64, macOS ARM64, Windows x86-64), hardware validation (nightly on self-hosted RPi 5), release qualification (72-hour stability, real Zigbee hardware).

**Feeds into:** Doc 12 (HealthReporter, PlatformPaths interfaces), Doc 14 (tier model, NexSys foundation, Companion architecture, CI/CD matrix), NexSys product planning.

---

## Repository State

- **homesynapse-core-docs:** Governance artifacts (all status headers current), foundations layer, Docs 01–07 committed with all amendments applied through Round 6 cross-audit. Locked Decisions register corrected (LTD-09 cross-reference). Doc 07 competitive research summary and locked design document committed 2026-03-07. Portability Architecture research artifact (Track C) drafted 2026-03-07, pending commit. Doc 09 REST API competitive research artifact and draft design document generated 2026-03-07, pending commit. Doc 08 Zigbee Adapter competitive research artifact generated 2026-03-07, pending commit. Doc 08 Zigbee Adapter draft design document with 9 pre-audit amendments (A-08-R7-1 through A-08-R7-9) committed and pushed 2026-03-08. **Doc 08 Round 7 cross-audit amendments applied 2026-03-08 (presence_signal removal, event_category forward reference, IntegrationDescriptor values, command_result priority, Tuya DP header). Pending commit.**
- **homesynapse-core:** Empty. No implementation code during Phase 1.

### Planned repository structure additions

```
homesynapse-core-docs/
├── governance/
│   ├── {existing files}
│   └── phase-2-transition-guide.md          ← planned
├── foundations/
│   └── {existing files}
├── design/
│   ├── {existing Docs 01–07 + Docs 08–14}
├── research/
│   ├── {existing research summaries}
│   ├── Zigbee_Adapter_Research_v1.md        ← generated 2026-03-07
│   ├── WebSocket_API_Research_v1.md         ← planned
│   ├── Observability_Research_v1.md         ← planned (critical path)
│   ├── Web_UI_Framework_Research_v1.md      ← planned (parallel)
│   └── {future research summaries}
└── reference/                                ← new directory
    ├── event-type-registry.md
    ├── subscriber-registry.md
    ├── configuration-schema-registry.md
    └── gradle-module-map.md
```

---

## Next Steps

1. ~~Apply upstream Dependents (U-01 through U-07) + Lock Docs 08 and 09.~~ COMPLETE.
2. ~~Begin Doc 10 (WebSocket API) research.~~ COMPLETE — Locked 2026-03-09.
3. ~~Begin Doc 11 (Observability & Debugging) research.~~ COMPLETE — Locked 2026-03-09.
4. ~~Draft Doc 10.~~ COMPLETE — Locked 2026-03-09.
5. ~~Draft Doc 11.~~ COMPLETE — Locked 2026-03-09.
1. **Project scaffold setup** — Initialize `homesynapse-core` repository per `governance/HomeSynapse_Core_Refined_Repo_Architecture_v2.md` §9 (scaffold file list) and `governance/phase-2-transition-guide.md` §8. Refined Repo Architecture v2 supersedes Implementation Plan v1 for repository structure, convention plugins, test infrastructure, and Phase 2/3 sequencing. Research artifact: `research/Repository_Structure_Test_Infrastructure_And_API_Evolution_Research_v1.md`.
2. **Doc 01 interface specification** — Event Model & Event Bus. First Phase 2 deliverable.
3. ~~Begin Doc 13 framework investigation.~~ COMPLETE — LTD-18 created.
4. ~~Cross-audit + Lock Doc 10.~~ COMPLETE — Round 8–9.
5. ~~Cross-audit + Lock Doc 11.~~ COMPLETE — Round 8–9.
6. ~~Draft + audit + lock Doc 12.~~ COMPLETE — Round 12. Locked 2026-03-09.
7. ~~Draft + audit + lock Doc 13.~~ COMPLETE — Round 13. Locked 2026-03-10.
8. ~~Draft + audit + lock Doc 14.~~ COMPLETE — Round 14. Locked 2026-03-10.
9. **Reference artifacts** — event-type-registry, subscriber-registry, configuration-schema-registry. Can begin now (all source docs locked).
10. ~~**Phase 2 Transition Guide**~~ — COMPLETE. Locked 2026-03-10. See `governance/phase-2-transition-guide.md`.

---

## Strategic Research Opportunities (added 2026-03-07)

During Waves 2 and 3, while design documents are being drafted, the following research areas merit empirical market data gathering. These are CEO/CTO-level concerns that inform long-term product positioning, adoption strategy, and Tier 2/3 prioritization — not Phase 1 design blockers.

**Identified areas for investigation:** smart home platform adoption trends and churn drivers, energy management TAM evolution (especially NEM 3.0 / ERCOT / NYISO regulatory trajectory), Matter protocol adoption velocity and its impact on Zigbee/Z-Wave ecosystem fragmentation, developer ecosystem dynamics (what makes integration developers choose a platform), and privacy-first smart home market demand signals. Specific research scope and methodology to be defined per area as Waves 2–3 progress.