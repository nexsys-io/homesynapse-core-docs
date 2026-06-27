# HomeSynapse Core — AIoT + Cloud Readiness (Doc 17)

**Document type:** Design — reserved-architecture readiness doc
**Status:** **Locked (2026-06-26)** — independent DOCS-Project review (SCOPE = new-doc cut RIGHT, conditional on S1; DOCUMENT = RATIFY-WITH-EDITS, all NON-BLOCKING) folded; Nick co-signed the Lock (the §3 consolidated decision pass, decision A3). **AIOT-INV-1 minted** as the new `INV-AC` category (`Architecture_Invariants_v1.md` §50; invariants **169 → 170**, categories **49 → 50**); AIOT-INV-2/3 kept as design principles. A **new-design-doc Lock, not an amendment** — the on-disk amendment watermark is unaffected by this Lock (it is AMD-95 from the same-session AMD-95 ratification).
**Subsystem:** cross-cutting (substrate / cloud / AI-safety) — coordinates with Doc 01, Doc 04, Doc 05, Doc 15, Doc 16
**Dependencies:** Doc 16 §3.2/§3.3/§3.5/§3.6 (Superior Automation Layer); Doc 15 (Cryptographic Architecture); Doc 01 (Event Model); Doc 04 (Persistence); `Architecture_Invariants_v1.md` (INV-LF-01/02/05, INV-ES-01/02, INV-RF-01, INV-SA-01..04, INV-PD-07/08, INV-CS-05, AMD-90-INV-01); the 2026-06-25 deeper-M7 decision record (D1–D5)
**Dependents:** the planned B3-federation design doc; the honest-hybrid design doc; the future AI-authoring / AI-reasoner milestone docs
**Owner:** nick@nexsys.io · **Author:** PM hub (v6 DRAFT 2026-06-25 → v7 Lock-fold 2026-06-26)

> **Lock provenance.** Authored as a reserved-architecture artifact and run through the formal DOCS second-opinion review → Nick co-sign → Lock pipeline (the Doc 16 path). Independent review return: `nexsys-hivemind/context/audits/2026-06-26_Doc17_independent_DOCS_Review_Return.md` (new-doc cut independently affirmed on the center-of-gravity criterion, CONDITIONAL on the S1 boundary section, now folded as §0.1; all 11 cited invariant ids source-verified; document RATIFY-WITH-EDITS, S1/S2 + E1–E5 folded). This doc **builds nothing**; it reserves seams and pins one non-preclusion invariant (AIOT-INV-1).

---

## 0. The scoping decision — RULED: NEW design doc (Doc 17), conditional on §0.1

**RULED 2026-06-26 (Nick co-sign, §3 decision A3): this is a NEW design doc (Doc 17 — "AIoT + Cloud Readiness"), not a Doc-16 extension** — independently affirmed by the DOCS review on the **center-of-gravity criterion** (the subject's weight — the substrate thesis, cloud-replication, SBOM/update, and the cross-cutting AI-safety frame — lies outside Doc 16's automation charter; the "AIoT is important" argument alone would justify only a Doc-14 note). The cut is **conditional on the §0.1 OWNS/RESTATES/COORDINATES-WITH boundary** (the review's S1), now folded — without it the doc would itself be the fragmentation hazard it forecloses. The rationale, retained:

- **It spans well beyond the automation layer.** Doc 16 (Superior Automation Layer) owns the automation engine's expressiveness/explainability/run-coupled-reliability. The subject here — **the immutable log as the universal substrate**, **cloud replication outward**, and **the AI-safety frame across the whole system** (device intelligence, authoring, reasoning, dispatch) — cuts across persistence (Doc 04), the event model (Doc 01), the integration runtime (Doc 05), security/crypto (Doc 15), and the federation seam, not just automation. Burying a cross-cutting, now-first-class direction inside Doc 16 would hide it (the M4-retrospective "epic under one label" failure).
- **AIoT-readiness was just elevated to first-class** (Nick, 2026-06-25). A first-class strategic direction earns a **named architectural artifact**, not a buried decision line — so the reservation is discoverable and the runway is auditable.
- **It is a readiness/reservation doc, not a build spec.** It reserves seams and pins invariants of non-preclusion; it specifies no runtime to build in V1. That is a coherent doc scope (cf. how Doc 16 §3.5/§3.6 reserve seams without building them).

**Alternative considered (not taken):** fold this as a Doc-16 §3.7/§3.8 extension + a Doc-14 note. Rejected at the Lock — the center-of-gravity criterion favors a discoverable named artifact.

---

## 0.1 Scope boundary — OWNS / RESTATES / COORDINATES-WITH (S1)

This boundary is what earns the new-doc cut and forecloses the three-way (Doc 16 → Doc 17 → B3/honest-hybrid) reservation drift. Doc 17 carries only the OWNS column as net-new; the RESTATES rows in §4 are marked "restated, not owned here."

- **OWNS (net-new to this doc):** the **AI-safety frame** (§3.3) and its invariant **AIOT-INV-1**; the **cloud-replication seam** (§4); the **SBOM / signed-update / vuln-disclosure seam** (§4); the **substrate-as-a-named-cross-cutting-principle** (§2.1 / §3.1); and the **AIoT direction as four named seams** (§3.2).
- **RESTATES / REAFFIRMS (owned elsewhere — not re-reserved here):** the **federation seam** (Doc 16 §3.5 / INV-SA-02); the **local/cloud cut-line** (Doc 16 §3.6); the **enterprise audit projection** (Doc 16 §3.3); **crypto-shred** (Doc 15 / INV-PD-07). Each §4 row for these is tagged "restated, not owned here," with its owning doc.
- **COORDINATES-WITH but does NOT pre-empt:** the planned **B3-federation** design doc and the **honest-hybrid** design doc (Nick's B-1/B-2/B-3 rulings). Doc 17 reserves the AIoT+cloud *direction* and the two genuinely-new seams; the full federation/cloud *mechanics and their invariants* are those docs' to mint.

---

## 1. Purpose

Make the AIoT + cloud vision **real reserved architecture instead of an implicit hope — without building any of it in V1.** This doc states the direction, names the safety frame, pins the cloud-as-additive principle, and ties every existing reserved seam (plus one new one) to the vision as explicitly **non-precluding**. Its job is done if a future AIoT or cloud milestone is a **projection/extension over existing events**, never a re-architecture, and if "we are the safest, most reliable, most advanced AIoT-ready ecosystem" is a defensible architectural claim rather than marketing.

**Inputs:** the 2026-06-23 prior-art architecture study (PM assessment, grade A−) and the 2026-06-25 deeper-M7 decision record (the substrate thesis + D1–D5). **This doc is the §1(f) reserved-seams half of that beat;** the concrete M7.4-gating rulings live in the decision record.

---

## 2. Design principles

1. **The immutable, causally-chained event log is the universal substrate.** Local-first, cloud, and AI are the **same log read differently** — not three subsystems. Everything additive attaches to the log; nothing parallel competes with it as a source of truth (INV-SA-03, INV-ES-01).
2. **Local-first is inviolate; cloud is strictly additive.** Every automation decision runs locally; the log replicates **outward** to cloud; no cloud service is ever a dependency for local function and no cloud service holds the keys (INV-LF-01/02, Doc 16 §3.6 cut-line).
3. **AI proposes; the deterministic engine disposes.** AI is a first-class producer/consumer of the log and the explanation projection, but **never** an autonomous actuator. The deterministic, explainable, no-autonomous-retry engine is the safety frame between any AI proposal and a real-world command. Everything is auditable via the immutable log + the explanation/audit projection.
4. **Reserve, don't build.** V1 builds the thin slice (the decision record's D1–D4); this doc only guarantees the seams stay open. Materializing any seam is a future milestone, several through a formal AMD.

---

## 3. Architecture of the readiness

### 3.1 The substrate (confirm + restate)

One log, three reads:

```
                       ┌───────────────────────────────────────┐
   local-first ───────▶│  IMMUTABLE, CAUSALLY-CHAINED EVENT LOG │◀─────── AI (producer/consumer)
   (everything in       │  (the single source of truth)         │         + explanation projection
    the local log)      └───────────────┬───────────────────────┘
                                        │ replicates OUTWARD (additive, never a dependency)
                                        ▼
                       ┌───────────────────────────────────────┐
                       │  CLOUD: projections / AI / federation   │
                       │  run cloud-side over the replicated log │
                       └───────────────────────────────────────┘
```

Projections (state, explanation, audit, future cloud/AI projections) are **derivable, replaceable optimizations over the log** — never a second source of truth (**INV-ES-02** "state is always derivable from events" is the tight parent; INV-SA-03 / INV-ES-01 the supporting context). This is the property that lets the same engine scale free single-home → paid power-user → business/enterprise (multi-site/MDU/hospitality) as **one runtime, not a fork**.

### 3.2 The AIoT direction (named, first-class)

Four AI seams, each already reserved by an existing mechanism — this doc names them as a coherent direction and confirms V1 precludes none:

- **AI-as-author** — natural-language → **component-based automation definitions** that **expand into the existing sealed permits** (no runtime DSL, no template interpreter). The component model (Doc 16 §3.2 / INV-SA-01) is exactly the analyzable target an LLM author should emit; the load-time static checks (unresolved refs, type mismatches) catch a bad AI authoring before it ever runs. **Open gate:** AX-7 component versioning/deprecation policy (Doc 16 OQ2) must be set before shareable/AI-authored components ship.
- **AI-as-reasoner** — consumes the **causal-chain / explanation projection** (Doc 16 §3.3 / INV-SA-03) to answer "why did/didn't this fire?" and to summarize/diagnose. Because explanation is a pure projection of the log, an AI reasoner reads the same substrate as the dashboard — no parallel trace store to build or trust.
- **AI-as-device-intelligence** — anomaly detection / prediction over the **device event stream** (just another ordered log consumer; subscribes like any other subscriber, LIVE-only — D2). No new substrate; reads the same log.
- **AI-safety frame** — see §3.3. The deterministic engine is the disposer; AI is always a proposer.

### 3.3 The AI-safety frame (the potential "safest AIoT" moat)

**AI proposes, the deterministic engine disposes** is stated here as a **first-class safety principle**, not an implementation note. The prior-art study found the **planner → verifier/safety-gate → deterministic-executor** pattern (and HA Assist's deterministic-first / LLM-fallback) to be the **emerging industry consensus** for safe AI-in-the-home — which maps exactly onto HomeSynapse's existing architecture:

- Any AI proposal becomes a **proposed automation definition or a proposed command**, never a direct actuation.
- It passes through the **deterministic, statically-analyzable engine**: expansion into sealed permits (no DSL), condition/mode/cascade governance, the **no-autonomous-retry** contract (INV-SA-04 / AMD-90-INV-01), and the **pure-function-replay** invariant (decision record D2 — no side-effect on replay).
- Every proposal, decision, and outcome is **auditable** via the immutable log + the explanation/audit projection (Doc 16 §3.3) — so an AI action is as explainable and tamper-evident as any other.

This is potentially the strongest moat: not "we have AI," but **"we are the system where AI can never autonomously misfire, and every AI decision is explainable and auditable after the fact."** V1's engine already embodies the frame; this doc reserves it as the explicit AIoT-safety thesis.

**Structural enforcement (E3) — what makes AIOT-INV-1 testable, not merely asserted.** A future AI module is wired at the **composition root as a proposer-only adapter** behind the inbound proposed-definition / proposed-command port, with **no actuation capability and no outbound device/dispatch dependency** — the same structural denial that gives core no outbound network capability (INV-LF-02's three-level enforcement). The enforcing CI test: wire a **mock AI module** and assert it **cannot reach `ActionExecutor` / dispatch** except by emitting a proposed definition the engine governs. This upgrades AIOT-INV-1 from an asserted principle to a **CI-testable invariant on two axes** — the **temporal** axis (D2 pure-function-replay: no external side-effect on replay) and the **actor** axis (E3: the AI actor is structurally denied actuation). The moat the V2-C research independently sharpened: every surveyed system verifies plan *behavior*; none type-checks the authored *form* against a sealed schema, because none has one — the `AutomationLinter` statically rejects malformed AI-authored components at load, before they run.

### 3.4 Cloud as strictly additive

The local/cloud cut-line (Doc 16 §3.6) is restated as a readiness invariant: **all decisioning is local; the log replicates outward; cloud projections/AI/federation run cloud-side over the replicated log; no cloud element is ever required for local function and none holds the keys.** A cloud accelerator (remote-access relay, voice bridge, compute-heavy ML offload, cross-site sync) is injected — when it ever exists — as an **optional, failure-isolated outbound adapter behind a narrow port the engine does not depend on for correctness** (INV-LF-02, INV-RF-01). WAN outage ⇒ every automation still runs locally.

---

## 4. The reserved seams (each tied to the vision, each non-precluding)

| Seam | Owner / mechanism | What V1 does | Why it stays non-precluding |
|---|---|---|---|
| **Cloud-replication (newly-named seam over existing reservations — OWNED here)** | event-log-shipping outward; this doc; composes **INV-LF-02 / INV-LF-05** | Nothing — the log is local-only in V1 | The log is append-only and causally-chained; replicating it outward is additive (ship events, build cloud-side projections). No payload change (pairs with decision-record D3 additive versioning / INV-ES-07). **Non-preclusion-honesty:** outward replication does not foreclose or narrow the **INV-LF-05** convergent multi-instance-sync property — the federation/cloud doc owns the sync semantics (event-log-shipping vs CRDT). Coordinates with the federation scope seam (one "scope" concept). |
| **Federation / multi-site (INV-SA-02)** _(restated, not owned here — owned by Doc 16 §3.5)_ | Doc 16 §3.5 | Reserves scope at the envelope (`ScopeRef` design-only, absent-defaults-to-local) | Globally-unique ULID identity needs no re-keying; scope is additive at the envelope, never a payload-resident field. **Materializing `ScopeRef` is a formal AMD** (envelope-shape change; must confirm compatible with the AMD-94 1-byte version slot). |
| **Enterprise audit projection (Doc 16 §3.3)** _(restated, not owned here — owned by Doc 16 §3.3)_ | Doc 16 §3.3; default-off | Reserved; inert until `chain_hash` is live (post-MVP, with crypto-shred) | Same log, bound to the Doc 15 `chain_hash`; a different query pattern, never a separate audit pipeline. `audit.enabled` defaults off. |
| **Component-authoring / AI-as-author (AX-7)** | Doc 16 §3.2 / OQ2 | Component model exists; authoring UX + versioning policy deferred | Expansion into sealed permits is the AI-author target; AX-7 versioning is the gate before shareable/AI-authored components ship. |
| **AI-as-reasoner / -device-intelligence** | the log + explanation projection (INV-SA-03) | Nothing AI-specific | Both are ordinary LIVE-only log consumers over the existing substrate. |
| **Crypto-shred (INV-PD-07)** _(restated, not owned here — owned by Doc 15)_ | Doc 15 | Infrastructure/seams at MVP; operational shred post-MVP | Per-scope key destruction over the encrypted log; interacts with retention (decision record D4) and the audit projection. |
| **SBOM + signed-update + vuln-disclosure (newly-named seam over existing reservations — OWNED here)** | architecturally **owned by INV-PD-08 / INV-CS-05**; EU CRA / UK PSTI is the external *driver* | Reserve only; reaffirm local-first + auth-before-exposure posture | Table-stakes MVP→post-MVP; our posture is already ahead. INV-PD-08 already mandates signed update packages + signature verification + integration provenance; INV-CS-05 covers update-safety. Conformity-class sizing is post-MVP. |
| **AI-safety frame (§3.3)** | the deterministic engine (INV-SA-04 / AMD-90-INV-01) + pure-function-replay (decision record D2) | Already embodied by the V1 engine | AI is a proposer; the engine is the disposer; everything auditable. No V1 change needed to keep it open. |

---

## 5. Boundaries — what is explicitly OUT (reserved, not built)

The cloud runtime; the federation runtime / central policy plane / event-log-shipping-vs-CRDT-sync mechanics; any AI model, planner, or inference runtime; the AI-authoring UX; the operational crypto-shred behavior; the SBOM/update pipeline implementation; the enterprise audit projection's live tamper-evidence (gated on `chain_hash`). **This doc reserves the seams for all of these and builds none of them.** Each is a future milestone, several through a formal AMD.

**Coordinate-not-pre-empt boundary (S2).** This doc does **not** pre-empt the planned **B3-federation** and **honest-hybrid** design docs; it reserves the AIoT+cloud *direction* and the two genuinely-new seams (cloud-replication, SBOM/update) and **defers all federation/cloud *mechanics and their invariants* to those docs** (Nick's B-1/B-2/B-3 rulings).

---

## 6. Invariants — one minted (AIOT-INV-1), two kept as principles

**RULED at the 2026-06-26 Lock (review §B + Nick co-sign): mint exactly one of the three.** The test (the project's own, from the Doc 16 INV-SA minting + INV-GA-02): a candidate is minted first-class only if it adds a constraint its cited parents do not already impose and cites those parents.

- **AIOT-INV-1 — AI Is Never an Autonomous Actuator. MINTED** (`Architecture_Invariants_v1.md` §50, the new `INV-AC` category; invariants 169 → 170, categories 49 → 50). Every AI-originated effect enters as a proposed definition/command and passes through the deterministic engine's governance + no-autonomous-retry + pure-function-replay path; **no AI code path actuates a device or mutates state outside the engine** (the structural proposer-only port, §3.3 E3). _Parentage:_ composes the **registered** parents **INV-SA-04** + **AMD-90-INV-01**, plus **decision-record D2 (pure-function-replay — canonical invariant pending registration at M7.4b**, per the decision record's forward action; AIOT-INV-1 cites D2 as pending until then). **Novel:** the parents bind the *engine* (no autonomous re-issue; no side-effects on replay); none binds a **new actor class (AI)** to proposer-only. CI-testable on two axes — temporal (D2) + actor (E3).
- **AIOT-INV-2 — Cloud is non-authoritative and non-required. KEPT AS PRINCIPLE (not minted).** No cloud/remote element is a dependency for local automation correctness; the log is authoritative locally and replicates outward additively; keys never leave the machine. _Not minted_ because its testable content is **fully covered** by **INV-LF-02** (cloud enhancement, never dependence; no outbound capability whose failure degrades core) + **INV-LF-01** (works without internet) + **INV-SA-02** (scope additive, no log migration). Minting would create the droppable near-duplicate INV-GA-02 warns against.
- **AIOT-INV-3 — Every AI decision is explainable and auditable as a pure projection of the log. KEPT AS PRINCIPLE (not minted).** _Not minted_ because **INV-SA-03** ("Explanation Is a Pure Projection of the Log — no parallel trace store") already carries the whole guarantee and is itself a citing composition of INV-ES-06 — so citing both is redundant. If ever minted, it must drop the INV-ES-06 citation, cite INV-SA-03 alone, and state the AI-specific strengthening ("no AI subsystem maintains a parallel trace/decision store").

The two principles' non-preclusion rests entirely on the existing INV-LF / INV-SA / INV-ES invariants and holds without minting.

---

## 7. Open questions / review gates — RESOLVED at the 2026-06-26 Lock

1. **Scoping (§0):** **RULED — new Doc 17** (center-of-gravity criterion; conditional on §0.1, folded).
2. **Invariant status (§6):** **RULED — mint AIOT-INV-1 only** (`INV-AC` §50); AIOT-INV-2/3 kept as principles.
3. **Cloud-replication seam shape:** **CONFIRMED out of scope here** — event-log-shipping vs CRDT sync is owned by the future federation/cloud doc; this doc reserves only "replicates outward, additive" (with the INV-LF-05 non-preclusion-honesty clause, §4).
4. **AX-7 dependency:** **CONFIRMED — AX-7 (component versioning/deprecation, Doc 16 OQ2) is sequenced BEFORE any AI-authoring milestone** (a hard prerequisite; the AI-as-author seam ships nothing until AX-7 is set).
5. **CRA/PSTI conformity class:** **CONFIRMED post-MVP** (a research item; does not gate V1).
6. **Claim language (the moat — counsel-gated).** Defensible architectural claim: **"AI is structurally a proposer, statically verified, and durably auditable."** **NOT** to be made without counsel + the patent search (item 7): "safest AIoT," "can never misfire," "formally verified" (we do static type-checking against a sealed schema, not model-checking). Adopt the honest framing in all external copy.
7. **Q1 patent search — COMMISSIONED.** Before any "safest AIoT" / "only / unique" superlative ships, run the patent/IP search (the V2-C + Session-B finding: durable plain-language "why-not" explainability appears unclaimed, but command-confirmation as a mechanic is well-trodden prior art — claim the *durable plain-language projection*, not confirmation itself). Owner: Nick + counsel; non-near-term, non-V1-gating.

**No `[BLOCKING]` question gated V1; all review gates are resolved at this Lock.** This doc reserves; it does not build.

---

*This document is part of the HomeSynapse Core design documentation and is governed by the Design Document Template. Authored 2026-06-25 by the v6 PM hub as the reserved-seams half of the §1 deeper-M7 architecture beat; **Locked 2026-06-26** (v7 hub fold) after the independent DOCS review (RATIFY-WITH-EDITS; S1/S2 + E1–E5 folded) and Nick's co-sign. The concrete M7.4-gating rulings live in `context/decisions/2026-06-25_deeper-M7-automation-architecture_decision-record.md`. It builds nothing; it reserves seams and pins one non-preclusion invariant (AIOT-INV-1, register §50).*
