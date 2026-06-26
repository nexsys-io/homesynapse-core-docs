# HomeSynapse Core — AIoT + Cloud Readiness (Doc 17)

> **STATUS: DRAFT (review-candidate). NOT LOCKED. NOT self-ratified.**
> This beat is authored by the v6 PM hub as a reserved-architecture artifact and is submitted for the formal DOCS second-opinion review → Nick co-sign → Lock pipeline, exactly the path Doc 16 (Superior Automation Layer) followed. It **builds nothing** and **mints no invariant at this stage**; the `[AIOT-INV-n]` tags below are **PROPOSED candidates** for the review to assess, not registered invariants. Per the new-design-doc-Lock convention (as with Doc 16 / the §19 subsystem categories), a Lock here would mint a subsystem invariant category and the on-disk amendment **watermark would stay AMD-94** (a new-doc Lock is not an amendment). The PM does not self-ratify.

---

## 0. The scoping decision (resolve this first — stated explicitly per the §1 ruling)

**Recommendation: this is a NEW design doc (Doc 17 — "AIoT + Cloud Readiness"), not a Doc-16 extension.** The rationale, stated up front so the reviewer rules on it deliberately:

- **It spans well beyond the automation layer.** Doc 16 (Superior Automation Layer) owns the automation engine's expressiveness/explainability/run-coupled-reliability. The subject here — **the immutable log as the universal substrate**, **cloud replication outward**, and **the AI-safety frame across the whole system** (device intelligence, authoring, reasoning, dispatch) — cuts across persistence (Doc 04), the event model (Doc 01), the integration runtime (Doc 05), security/crypto (Doc 15), and the federation seam, not just automation. Burying a cross-cutting, now-first-class direction inside Doc 16 would hide it (the M4-retrospective "epic under one label" failure).
- **AIoT-readiness was just elevated to first-class** (Nick, 2026-06-25). A first-class strategic direction earns a **named architectural artifact**, not a buried decision line — so the reservation is discoverable and the runway is auditable.
- **It is a readiness/reservation doc, not a build spec.** It reserves seams and pins invariants of non-preclusion; it specifies no runtime to build in V1. That is a coherent doc scope (cf. how Doc 16 §3.5/§3.6 reserve seams without building them).

**Alternative the reviewer may prefer:** fold this as a Doc-16 §3.7/§3.8 extension + a Doc-14 (Master Architecture) note. Lean is **new doc**; the call is Nick's at review.

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

Projections (state, explanation, audit, future cloud/AI projections) are **derivable, replaceable optimizations over the log** — never a second source of truth. This is the property that lets the same engine scale free single-home → paid power-user → business/enterprise (multi-site/MDU/hospitality) as **one runtime, not a fork**.

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

### 3.4 Cloud as strictly additive

The local/cloud cut-line (Doc 16 §3.6) is restated as a readiness invariant: **all decisioning is local; the log replicates outward; cloud projections/AI/federation run cloud-side over the replicated log; no cloud element is ever required for local function and none holds the keys.** A cloud accelerator (remote-access relay, voice bridge, compute-heavy ML offload, cross-site sync) is injected — when it ever exists — as an **optional, failure-isolated outbound adapter behind a narrow port the engine does not depend on for correctness** (INV-LF-02, INV-RF-01). WAN outage ⇒ every automation still runs locally.

---

## 4. The reserved seams (each tied to the vision, each non-precluding)

| Seam | Owner / mechanism | What V1 does | Why it stays non-precluding |
|---|---|---|---|
| **Cloud-replication (NEW reserved seam)** | event-log-shipping outward; this doc | Nothing — the log is local-only in V1 | The log is append-only and causally-chained; replicating it outward is additive (ship events, build cloud-side projections). No payload change. Coordinates with the federation scope seam (one "scope" concept). |
| **Federation / multi-site (INV-SA-02)** | Doc 16 §3.5 | Reserves scope at the envelope (`ScopeRef` design-only, absent-defaults-to-local) | Globally-unique ULID identity needs no re-keying; scope is additive at the envelope, never a payload-resident field. **Materializing `ScopeRef` is a formal AMD** (envelope-shape change; must confirm compatible with the AMD-94 1-byte version slot). |
| **Enterprise audit projection (Doc 16 §3.3)** | Doc 16 §3.3; default-off | Reserved; inert until `chain_hash` is live (post-MVP, with crypto-shred) | Same log, bound to the Doc 15 `chain_hash`; a different query pattern, never a separate audit pipeline. `audit.enabled` defaults off. |
| **Component-authoring / AI-as-author (AX-7)** | Doc 16 §3.2 / OQ2 | Component model exists; authoring UX + versioning policy deferred | Expansion into sealed permits is the AI-author target; AX-7 versioning is the gate before shareable/AI-authored components ship. |
| **AI-as-reasoner / -device-intelligence** | the log + explanation projection (INV-SA-03) | Nothing AI-specific | Both are ordinary LIVE-only log consumers over the existing substrate. |
| **Crypto-shred (INV-PD-07)** | Doc 15 | Infrastructure/seams at MVP; operational shred post-MVP | Per-scope key destruction over the encrypted log; interacts with retention (decision record D4) and the audit projection. |
| **SBOM + signed-update + vuln-disclosure (NEW reserved seam)** | EU CRA / UK PSTI runway | Reserve only; reaffirm local-first + auth-before-exposure posture | Table-stakes MVP→post-MVP; our posture is already ahead. Conformity-class sizing is post-MVP. |
| **AI-safety frame (§3.3)** | the deterministic engine (INV-SA-04 / AMD-90-INV-01) + pure-function-replay (decision record D2) | Already embodied by the V1 engine | AI is a proposer; the engine is the disposer; everything auditable. No V1 change needed to keep it open. |

---

## 5. Boundaries — what is explicitly OUT (reserved, not built)

The cloud runtime; the federation runtime / central policy plane / event-log-shipping-vs-CRDT-sync mechanics; any AI model, planner, or inference runtime; the AI-authoring UX; the operational crypto-shred behavior; the SBOM/update pipeline implementation; the enterprise audit projection's live tamper-evidence (gated on `chain_hash`). **This doc reserves the seams for all of these and builds none of them.** Each is a future milestone, several through a formal AMD.

---

## 6. PROPOSED invariant candidates (for the review to assess — NOT registered)

Offered for the DOCS review + Nick's ratification to consider at a potential Lock; **not minted here.**

- `[AIOT-INV-1]` (candidate) — **AI is never an autonomous actuator.** Every AI-originated effect enters as a proposed definition/command and passes through the deterministic engine's governance + no-autonomous-retry + pure-function-replay path; no AI code path actuates a device or mutates state outside the engine. (Composes INV-SA-04 / AMD-90-INV-01 + decision-record D2.)
- `[AIOT-INV-2]` (candidate) — **Cloud is non-authoritative and non-required.** No cloud/remote element is a dependency for local automation correctness; the log is authoritative locally and replicates outward additively; keys never leave the machine. (Composes INV-LF-01/02 + INV-SA-02 + Doc 16 §3.6.)
- `[AIOT-INV-3]` (candidate) — **Every AI decision is explainable and auditable** as a pure projection of the log (no parallel AI trace store). (Composes INV-SA-03 + INV-ES-06.)

If the reviewer prefers, these can instead be recorded as design principles without invariant status — the non-preclusion holds either way (it rests on the existing INV-SA / INV-LF / INV-PD invariants).

---

## 7. Open questions / review gates

1. **Scoping (§0):** new Doc 17 vs Doc-16 extension — Nick rules at review. (Lean: new doc.)
2. **Invariant status (§6):** mint `[AIOT-INV-1..3]` at Lock, or keep as principles? — reviewer + Nick.
3. **Cloud-replication seam shape:** event-log-shipping vs CRDT sync is **out of scope here** (owned by the future federation/cloud doc); this doc reserves only "replicates outward, additive." Confirm that boundary is the right cut.
4. **AX-7 dependency:** the AI-as-author seam is gated on the AX-7 versioning policy — confirm AX-7 is tracked as the prerequisite to any AI-authoring milestone.
5. **CRA/PSTI conformity class:** post-MVP sizing (a research item, non-near-term) — confirm it does not gate V1.

**No `[BLOCKING]` question gates V1.** This doc reserves; it does not build. The path to Lock is the standard DOCS second-opinion review → Nick co-sign — the PM does not self-ratify.

---

*This document is part of the HomeSynapse Core design documentation and is governed by the Design Document Template. It is a DRAFT review-candidate authored 2026-06-25 by the v6 PM hub as the reserved-seams half of the §1 deeper-M7 architecture beat; the concrete M7.4-gating rulings live in `context/decisions/2026-06-25_deeper-M7-automation-architecture_decision-record.md`. It builds nothing and mints no invariant until Locked.*
