# HomeSynapse Core — Superior Automation Layer

**Document type:** Subsystem design
**Status:** Draft (Review-candidate — authored 2026-06-19; ready for the DOCS second-opinion review → Lock pipeline)
**Subsystem:** Superior Automation Layer (Expressiveness-without-a-DSL · Explainability / causal chain · Run-coupled reliability)
**Dependencies:** Automation Engine (Doc 07 — §3.4 trigger model, §3.7 Run lifecycle, §3.7.1 cascade governance + AMD-91 `RunCausalChain`, §3.8 condition evaluation + AMD-03 single-snapshot, §3.9 action execution, §3.10 zombie-Run finalization, §3.11/§3.11.2 command pipeline + ledger, §3.12 selectors, §6 failure modes, §8 interfaces, §9 config, §11.2 event inventory); Event Model & Event Bus (Doc 01 — §4.1 envelope + `CausalContext`, §4.3 taxonomy, §8.3 `EventPublisher`); State Store & State Projection (Doc 03 — §3.1 state query, §8.1 `StateQuery`); Configuration System (Doc 06 — §3.2 `SchemaRegistry`, §3.3 reload pipeline, §7 well-known paths); Observability & Debugging (Doc 11 — trace/metrics surfaces); Startup, Lifecycle & Shutdown (Doc 12 — composition root, REPLAY→LIVE); Cryptographic Architecture (Doc 15 — §3 `chain_hash` tamper-evidence for the audit projection); Platform API (`com.homesynapse.platform.identity` — typed ULID wrappers). Amendments: **AMD-88..93** (ratified 2026-06-12, watermark AMD-93). Decisions: the 2026-06-18 app-bootstrap + superiority-scope ruling (`nexsys-hivemind/context/decisions/2026-06-18_app-bootstrap-and-superiority-scope_decisions.md`, Part B; app-bootstrap A1/A2/A3/A4).
**Dependents:** M7.2 (run/action/dispatch — **shaped by this document; builds into it**); the Cross-Cutting Reliability-as-a-Product-Property design doc (sequenced right after this); the Multi-Site / Enterprise Federation design doc (post-M8 — consumes the identity/scoping seam in §3.5); the Honest-Hybrid Deployment design doc (consumes the cut-line in §3.6); REST API (Doc 09 — explanation + component endpoints); WebSocket API (Doc 10 — live causal-chain streaming); Observability & Debugging (Doc 11 — "why did this fire?" UX); Web UI (Doc 13 / M10/M13 — debugging surface).
**Author:** HomeSynapse Core Architecture
**Date:** 2026-06-19

---

> **Provenance and standing.** This is a Phase-1 design authored **ahead of M7.2/M7.3** so the baseline-engine implementation targets the differentiator rather than a baseline it would outgrow. It is the anchor document of the 2026-06-18 superiority scope ruling (Part B): it designs the **three first-class surfaces** (expressiveness-without-a-DSL, explainability/causal-chain, run-coupled reliability) **plus two non-preclusion seams** (federation identity/scoping; the hybrid local/remote cut-line). It is **not** the owner of: cross-cutting reliability-as-a-product-property (its own co-equal doc, sequenced right after this one), multi-site/enterprise federation (its own post-M8 doc, which mints its own invariants), or the full honest-hybrid feature (its own tight doc, sequenced with app-bootstrap). This document **reserves seams** for the latter two; it does not design them. The anti-requirements bind throughout: **no templating DSL · no engine retry · no destructive forced migration · never lead with commodity encryption · local-first inviolate** (any cloud/hybrid/enterprise element is honest and optional, and the enterprise story never compromises the home-user trust brand).

> **M7 Contract-Impact Verdict (summary — full interlock in §7.2, the mandatory deliverable).** **M7.1 (trigger/condition path) — UNAFFECTED.** **M7.2 (run/action/dispatch) — SHAPED; builds into this document (do not freeze its action contract first).** **M7.3 (pending-command ledger) — UNAFFECTED.** No ratified contract (AMD-88..93) is reshaped by this design; M7.2 is *forward-shaped* because it is unbuilt. Any contract change this design ever surfaces moves through the formal AMD/supersession pipeline — never a silent reshape. This verdict is the condition under which the M7.1 ride-along build is cleared to proceed in parallel (§7.2).

---

## 0. Purpose

The Superior Automation Layer is the differentiating layer that sits **on top of** the baseline Trigger-Condition-Action (TCA) engine designed in Doc 07. Doc 07 makes automation *correct, observable, and replayable* — table stakes for an event-sourced engine. This layer is what makes HomeSynapse automation **more expressive, more explainable, and more reliable under failure than Home Assistant, Apple Home, or Google Home**, for both the home user and the enterprise/institutional user, without abandoning the local-first determinism that is the product's deepest moat.

It exists as a distinct design because three product-defining properties are architecturally adjacent to — but separable from — the baseline engine, and all three must be designed **before** M7.2/M7.3 freeze the run/action/dispatch contracts, or those contracts get reshaped in arrears. The three are: **(1) expressiveness-without-a-DSL** — the power-user demand for reusable, parameterized, composable automations, satisfied within a sealed declarative model so it stays statically analyzable (the demand that historically forces every competitor into a fragile template language); **(2) explainability as a first-class product surface** — turning the immutable, causally-chained event log and AMD-91 `RunCausalChain` into a non-expert answer to "why did this fire?" and an enterprise-grade audit trail; and **(3) run-coupled reliability** — the honest, deterministic degradation of a *running* automation under partial failure, which is the half of "reliability" that touches the Run model and therefore shapes M7.2.

If this layer is designed poorly the consequences compound. Expressiveness bolted on as a template language destroys static-analyzability and reintroduces the silent-failure class the sealed model deliberately forecloses (a one-way door — see Home Assistant's template silent-fail corpus). Explainability bolted on as a separate trace store duplicates the log and drifts from it, breaking INV-ES-06 (every state change is explainable). Run-coupled reliability left to the baseline means a running automation degrades unpredictably, which is the single most common reliability complaint across competing platforms. The design must satisfy INV-TO-02 (automation determinism), INV-ES-06 (explainability), INV-RF-06 (graceful degradation under partial failure), and INV-LF-02 (local-first inviolate) while executing within the memory and latency budget of a Raspberry Pi 4 (4 GB RAM, INV-PR-01).

---

## 1. Design Principles

**SP1 — Expressiveness is composition over a sealed model, never a language.** Reusable, parameterized automation components and computed conditions are delivered by **expansion into the existing sealed `TriggerDefinition`/`ConditionDefinition`/`ActionDefinition` permits** (Doc 07 §3.4/§3.8/§3.9), not by a templating or scripting runtime. Expansion is static-analyzable by construction. This is the subsystem-level expression of the standing anti-requirement "no templating DSL" (AMD-88 §6 / REC-155) and of INV-CE-01 (canonical, human-readable, machine-validatable configuration).

**SP2 — "Why" is derived from the log, not stored beside it.** Every explanation this layer produces — for a non-expert or an auditor — is a **read/projection over the immutable event log and `RunCausalChain`** (Doc 01 §4.1 `CausalContext`; Doc 07 §3.7.1 / AMD-91), never a parallel trace store. This is the subsystem-level expression of INV-ES-06 (every state change is explainable) and INV-TO-01/03 (observable behavior, no hidden state). It is the reason the explainability surface mints **no new event types** — it queries the AMD-92 inventory that already exists.

**SP3 — A running automation degrades honestly and deterministically.** When a Run encounters partial failure mid-flight (a failed action, an unavailable target, a degraded read), it transitions to a **deterministic terminal state with a recorded, machine-readable reason** — never a silent partial success, never an autonomous retry. This is the subsystem-level expression of INV-RF-06 (graceful degradation), INV-TO-02 (determinism), and the anti-requirement "no engine retry" (AMD-90-INV-01 / REC-162). Every degradation produces an event (Doc 07 C8: unavailable targets are never silently skipped).

**SP4 — Forward-shape, never reshape.** This layer is designed before M7.2 builds, precisely so it can *shape* the unbuilt run/action contracts. It does **not** alter any ratified contract (AMD-88..93). Where a superiority requirement would change a ratified or Locked contract, it is routed through the formal AMD/supersession pipeline with explicit re-sequencing — never folded in silently. This protects the M7.1 ride-along build (§7.2).

**SP5 — Reserve seams, do not build futures.** Federation and honest-hybrid are out of scope here; each is its own doc. What this layer owns is the **non-preclusion seam** for each: design single-site identity/scoping and the local/remote boundary so that adding federation or a cloud accelerator later is *additive*, never a destructive migration of the immutable event log. This is the same cheap-now / irreversible-later discipline that governed the app-bootstrap A4 envelope version tag.

**SP6 — The home-user trust brand is the floor; enterprise rides the same runtime.** Every enterprise/institutional capability (audit, multi-site, attestation) is a **licensing + API tier over the identical HomeSynapse Core runtime**, not a fork and not a feature-gate on the core. No enterprise concern may weaken a home-user guarantee. This follows the non-negotiable revenue principles and the "same runtime, not a separate engine" institutional doctrine.

---

## 2. Scope and Boundaries

### 2.1 This Subsystem Owns

- **The expressiveness/composition layer over the sealed TCA model:** automation **components** (parameterized, reusable, composable definition fragments), **typed component parameters**, and **computed conditions/values** (bounded, total, side-effect-free derivations) — all of which **expand into the existing sealed permits** and are statically analyzable (§3.2).
- **The explainability product surface:** the "why did this fire?" (and "why did this *not* fire?") derivation for a non-expert, and the **enterprise audit projection** over the same log — both as read/projection contracts over the existing event inventory and `RunCausalChain` (§3.3).
- **The run-coupled reliability contracts:** the honest-degradation behavior of a *running* automation and its deterministic terminal states + recorded reasons under partial failure, including the run-coupled half of the app-bootstrap A3 fail-closed read contract (§3.4, §6).
- **The federation-readiness seam (design-only, non-preclusion):** single-site automation/entity/event identity and a reserved scope discriminator such that a future federation layer never forces an immutable-event-log migration (§3.5).
- **The hybrid cut-line (boundary definition only):** the local/remote boundary for the automation path and the never-a-dependency invariant, pinned in the app-bootstrap composition root (§3.6).

### 2.2 This Subsystem Does Not Own

- **The baseline TCA execution model** — owned by the **Automation Engine** (Doc 07). This layer composes over it; it does not re-specify trigger evaluation, condition evaluation, action execution, the Run lifecycle, the command pipeline, or the pending-command ledger.
- **The sealed trigger/condition/selector/action vocabularies** — owned by Doc 07 + **AMD-88/89/90**. This layer adds **no sealed permits**. (If a superiority requirement ever needs one, that is a formal AMD — see §7.2 and §15.)
- **The automation event inventory** — owned by **AMD-92**. This layer mints **no new event types**; it reads the existing inventory. (Any new event = formal AMD.)
- **Cross-cutting reliability-as-a-product-property** (multi-year longevity claims, observability-as-product, system-wide self-healing) — its own **co-equal** design doc, sequenced right after this one. NOT M7-gating (per the B-1 scope ruling).
- **Multi-site / enterprise federation** (cross-site event/state boundaries, federated identity, WAN-partition autonomy) — its own **post-M8** design doc, which mints its own invariants. This layer reserves only the §3.5 seam.
- **The full honest-hybrid deployment feature** (remote-access relay, voice bridge, cross-site sync, ML offload) — its own tight design doc, sequenced with app-bootstrap. This layer defines only the §3.6 cut-line.
- **Crypto at rest / key management / crypto-shred** — owned by **Doc 15** + the M6 implementation. This layer consumes the `chain_hash` tamper-evidence for the audit projection and coordinates with the A3 read contract; it does not design cryptography.
- **The deferred M7.2/M8 research vectors:** conflict-at-scale (A2), the eval/snapshot cost curve (B1), concurrency/backpressure at storm scale (B2), expected-state-vs-bounded-re-issue (D2 / REC-162), and reachability asleep-vs-dead (E2). These ride a real engine (post-M7.2) and are explicitly **not** designed here (§14).

---

## 3. Architecture

### 3.1 Position in the architecture

This layer is a thin set of contracts and components **between** the configuration/loading path and the Doc 07 TCA engine, plus a read-side projection for explainability. It introduces no new event-bus subscriber and no new producer boundary — it composes the existing ones.

```
            ┌──────────────────────────────────────────────────────┐
   YAML  ─▶ │  Configuration System (Doc 06)  +  schema fragment    │
 (defs +    └───────────────┬──────────────────────────────────────┘
 components)                │ validated definitions + component library
                            ▼
            ┌──────────────────────────────────────────────────────┐
            │   SUPERIOR AUTOMATION LAYER (this doc)                 │
            │                                                        │
            │   §3.2  ComponentRegistry → ComponentExpander          │
            │          (load-time expansion into sealed permits;     │
            │           computed-parameter resolution at run init)   │
            │                                                        │
            │   §3.4  Run-coupled reliability contract               │
            │          (honest degradation; deterministic terminal)  │
            └───────────────┬──────────────────────────────────────┘
                            │ concrete AutomationDefinition(s),
                            │ composed ENTIRELY of Doc 07 sealed types
                            ▼
            ┌──────────────────────────────────────────────────────┐
            │   AUTOMATION ENGINE (Doc 07)                           │
            │   TriggerEvaluator · ConditionEvaluator ·             │
            │   RunManager · ActionExecutor · CommandDispatch ·     │
            │   PendingCommandLedger   (+ AMD-88..93 contracts)     │
            └───────────────┬──────────────────────────────────────┘
                            │ immutable event log
                            │ (run trace + RunCausalChain, AMD-91/92)
                            ▼
            ┌──────────────────────────────────────────────────────┐
            │   §3.3  Explainability projection (READ-ONLY)          │
            │   ExplanationService over the log → "why did/n't this  │
            │   fire?" (non-expert)  +  AuditProjection (enterprise) │
            └──────────────────────────────────────────────────────┘
```

The two seams (§3.5 federation identity/scoping, §3.6 hybrid cut-line) are not runtime components; they are constraints on identity and on the composition root, recorded here so the engine they wrap is never foreclosed.

### 3.2 Expressiveness-without-a-DSL (the component model)

**The problem.** Power users need reuse and parameterization — the demand met by Home Assistant blueprints, Apple Shortcuts, and Node-RED subflows. Every competitor satisfies it with a template/expression language, which is the largest authoring-failure class in the field: silent template failures, un-analyzable spaghetti, and maintainer refusal to debug. The design challenge is power **without** a Turing tarpit.

**The mechanism — expansion, not interpretation.** This layer introduces three constructs, all of which resolve into the **existing** sealed `TriggerDefinition`/`ConditionDefinition`/`ActionDefinition` permits (Doc 07 §3.4/§3.8/§3.9). No new permit is added; no interpreter runs at evaluation time.

1. **Automation components** — a named, versioned, parameterized definition fragment. A component declares typed parameters and a body composed of the sealed permits with parameter references in value positions. Instantiating a component with arguments **expands** it into a concrete `AutomationDefinition` (or sub-sequence) made entirely of sealed types. Expansion is **load-time** for static arguments — the registry materializes concrete definitions the engine never distinguishes from hand-authored ones.

2. **Typed component parameters** — every parameter has a declared type drawn from the existing value vocabulary (`AttributeValue` kinds, `Duration`, `Selector`, typed IDs, enums). Arguments are validated against the parameter type at load (fail-closed — §6). There are no untyped/string-substitution parameters; a parameter is never spliced into a value as text.

3. **Computed conditions / computed values** — a **bounded, total, side-effect-free** derivation surface (typed operators over a fixed input set: the trigger-time `StateSnapshot` attributes, component parameters, and time). It is **not** a language: no I/O, no unbounded iteration (only bounded folds over a resolved `Selector`'s entity set), no recursion, no string templating, no external calls. A computed value resolves to a concrete typed value **at run initiation** (against the AMD-03 single snapshot), and that concrete value is what the existing `ConditionDefinition`/`ActionDefinition` consumes — so the Doc 07 evaluator contracts are unchanged and replay is deterministic (INV-TO-02).

**Why this is statically analyzable (and a superiority feature, not just a safety constraint).** Because everything expands to the sealed permits and computed values are total functions over a typed, finite input set, the load path can run the **static checks** that no competitor offers well (vector A1): unresolved references, type mismatches, unreachable conditions, and self-evidently shadowed/duplicate triggers are detectable at load time, before the automation ever runs. (The deeper write-conflict/precedence analysis at scale — A2 — is a deferred M8 vector; this layer provides the analyzable substrate it will need.)

**How this shapes M7.2 (forward-shaping, no reshape).** Expansion is mostly load-side, but two beats touch the unbuilt M7.2 run model: (a) **computed-parameter resolution at run initiation** — a deterministic step in `RunManager.initiateRun(...)` that resolves computed values against the captured snapshot before action execution; and (b) **component attribution** — the originating component is recoverable for any Run by mapping the Run's `definitionHash` (already carried in `automation_triggered` per AMD-92, and in `RunContext` per Doc 07 §8.2) to its `ComponentRef` via the `ComponentRegistry`, enriched by LTD-15 structured logs. Attribution therefore adds **no event field** (AMD-92 untouched): beat (a) is genuinely new M7.2 run-model behavior; beat (b) is a load-/read-side registry concern. Neither reshapes a ratified contract (§7.2).

### 3.3 Explainability / causal chain as a first-class product surface

**The substrate already exists.** Doc 07 records every execution step as an event (P1), threads `CausalContext` (correlation_id, causation_id) through trigger → condition → action → state change (Doc 01 §4.1), and AMD-91 carries a per-Run `RunCausalChain` (the ancestor chain of `(RunId, AutomationId)` links) with deterministic cycle detection. Explainability is therefore **architecturally available** — Apple/Google/HA cannot answer "why did this fire?"; HomeSynapse can. This layer specifies the **product surface** that turns the substrate into an answer.

**`ExplanationService` (read-only projection).** Given a `RunId` (or an entity + time, or an `EventId`), `ExplanationService` assembles a **`RunExplanation`** by reading the immutable log: the triggering event, the matched trigger(s) (by stable `triggerId` — AMD-88-INV-02), each condition evaluated and its result, each action and its outcome, the resolved targets, the originating component (§3.2), and the full `RunCausalChain` ancestry. It mints **no events** and stores **no parallel trace** (SP2): the log is the source of truth.

**Two consumers, one log.**
- **Non-expert "why did this fire?"** — a plain-language rendering of the `RunExplanation` for the dashboard/UI (Doc 11 / M10/M13): "The porch light turned on at 03:00 because automation *Night Arrival* fired — trigger *front-door opened* matched, condition *after sunset* was true." This directly answers the field's top opacity complaint (the WTH/porch-light corpus).
- **Enterprise audit projection** — the same assembly rendered as an append-only, **tamper-evident** audit record by binding each explanation to the Doc 15 `chain_hash` of its constituent events. This is the precondition for the institutional tier (attestation, dispatch verification, RPM summaries) — different query patterns on the same log, never a separate audit pipeline.

**"Why did this *not* fire?" — the harder, higher-value half.** A non-expert's real question is often about absence. This layer specifies the **suppression-reason** surface: the engine already emits the diagnostic events that explain non-firing — `automation_run_skipped` (mode enforcement), `cascade_loop_detected` and `cascade_depth_exceeded` (Doc 07 §3.7.1 / AMD-91), `automation_condition_evaluated` with `result=false` (condition not met → `CONDITION_NOT_MET`), and the AMD-93 `config_error` for a definition that failed to load (dangling reference). `ExplanationService` aggregates these into a **`NonFiringExplanation`** keyed by automation + triggering event, so "why didn't the heating come on?" resolves to "*Morning Warmup* was suppressed — it already fired once in this causal chain" or "condition *someone home* was false." No new events are required; the surface is a projection over the AMD-92 inventory.

### 3.4 Run-coupled reliability

This section owns **only** the half of reliability that is coupled to a *running* automation and therefore touches the M7.2 run model. The cross-cutting half (longevity, observability-as-product, system-wide self-healing) is a separate co-equal doc (§14).

**Honest degradation of a running Run.** When a Run encounters partial failure mid-sequence, it must reach a **deterministic terminal state with a recorded, machine-readable reason** — never a silent partial success and never an autonomous retry (SP3). The terminal states already exist (Doc 07 §8.2 `RunStatus`: `FAILED`, `ABORTED`, `INTERRUPTED`, `CONDITION_NOT_MET`), and AMD-92's `automation_completed` already carries nullable `failureReason` and `abortReason` components. This layer's contribution is the **contract that binds them**:
- A failed action transitions the Run to `FAILED` with a populated `failureReason`; subsequent actions in the sequence do **not** execute (Doc 07 §6.2). The partial trace is preserved and explainable (§3.3).
- An unavailable target is handled per the action's `UnavailablePolicy` (skip/error/warn) and **always** produces an event (Doc 07 C8) — degradation is never silent.
- A Run interrupted by reload-in-`restart`-mode or shutdown transitions to `ABORTED`/`INTERRUPTED` with an `abortReason`; zombie Runs are finalized on REPLAY→LIVE (Doc 07 §3.10) so every `automation_triggered` has a terminal `automation_completed` (C1).
- **No engine retry, at any confirmation policy** (AMD-90-INV-01). Remediation, if any, is a ledger-signal-driven concern *above* the engine (M8.2), never inside `ActionExecutor`. The standing D2/REC-162 question (whether a *guarded, idempotent* bounded re-issue ever belongs in the sealed model) is **explicitly deferred** to the M7.2 action-model decision and is **not** resolved or pre-empted here (§14, §15).

**The run-coupled half of the A3 fail-closed read contract.** App-bootstrap A3 ruled that a read-path decrypt failure fails the read **closed** with a distinct, loud error at MVP, with the cause-carrying `DegradedEvent` degrade seam *designed now but shipped later* (with the crypto-shred WU). The run-coupled consequence belongs here: **a running automation that needs to read state behind a fail-closed read must itself fail closed deterministically** — it does not proceed on partial or ambiguous state. Concretely, if condition evaluation (Doc 07 §3.8) cannot obtain the required snapshot because the read failed closed, the Run terminates `FAILED` with a `failureReason` identifying the degraded read, and the failure is explainable (§3.3). When the `DegradedEvent` degrade seam later activates (gated, per A3's F4 pin, on `chain_hash` + startup-verify being live), the run-coupled contract refines to "evaluate against the degraded marker deterministically" — a forward-shaping refinement of M7.2, not a reshape.

**Determinism is the through-line.** Given identical event streams and configuration, the degradation outcome is identical (INV-TO-02). No degradation path consults wall-clock timing, eviction windows, or restart-sensitive state (consistent with AMD-91-INV-01's determinism rule for suppression).

### 3.5 The federation-readiness seam (identity/scoping non-preclusion ONLY)

**Goal:** design single-site identity so that a future federation layer (the post-M8 B3 doc) can add multi-site scope **without** migrating the immutable event log. This is a seam, not a feature; federation itself — cross-site boundaries, federated identity, WAN-partition autonomy, sync semantics — is **not designed here** and will mint its own invariants in its own doc.

**Two facts make a clean seam possible.**
1. **Identity is already federation-safe for uniqueness.** All identities are 128-bit ULIDs via typed wrappers (`AutomationId`, `EntityId`, `RunId`, `EventId` — LTD-04). Cross-site collision probability is negligible, so federation requires **no re-keying and no log migration** for uniqueness. The seam records this as a guarantee to preserve: identity generation must remain globally-unique-by-construction (no site-local sequential IDs may ever be introduced into persisted identity).
2. **Scope is the only thing that needs reserving.** What federation adds is *which site owns this automation/entity/event*. If a required `SiteId`/scope field were added to persisted records later, it would force a destructive rewrite of the immutable log — exactly the foreclosure to avoid. The seam therefore reserves scope as an **additive, optional discriminator with a defined default of "this site"**, attached at the envelope/metadata level (not inside the domain payloads), so that introducing it later is additive (an absent scope reads as the local site), never a migration. This mirrors the app-bootstrap A4 "reserve the 1-byte envelope version tag now" logic.

**Coordination with the A2 token model.** App-bootstrap A2 ruled that the token model is designed now to anticipate **enterprise per-scope / per-site claims**, even though MVP issues tokens simply. The federation scope discriminator and the auth scope-claim vocabulary are **the same scoping concept** and must use one shared definition of "scope" so they cannot diverge. This layer records that constraint; it does not design the claim format (that is the auth/federation work).

**What is explicitly out:** the federation runtime, the central policy/observability plane, event-log shipping vs CRDT sync, and hierarchical policy are **not** designed here (§14).

### 3.6 The hybrid cut-line (local/remote boundary)

**Goal:** pin the boundary between what is always-local and what may be an optional remote accelerator, and the invariant that the boundary protects — coordinated with the app-bootstrap composition root. The full honest-hybrid feature is a separate doc (§14).

**The cut-line.** All automation decision-making — trigger evaluation, condition evaluation, the Run lifecycle, action dispatch to local integrations, cascade governance, and explainability derivation — is **always local** and never depends on a network call to an external service. Any cloud/remote element (remote-access relay, voice bridge, cross-site sync, compute-heavy ML offload) sits **outside** the cut-line as an **optional edge**: if it is absent or fails, **every automation still runs locally** and **no cloud service holds the keys** (keys are machine-local — Doc 15).

**Pinned in the composition root (coordinated with app-bootstrap).** The cut-line is structural, not a runtime check: the composition root (app-bootstrap) wires **only local dependencies** into the automation engine. Any remote accelerator is injected as an **optional, failure-isolated adapter behind a narrow interface** (an outbound port the engine does not depend on for correctness), consistent with INV-LF-02's three-level enforcement (core subsystems have no outbound network capability) and INV-RF-01 (integration isolation). The app-bootstrap decisions this coordinates with: A1 loopback-default bind (LAN/remote exposure is explicit authenticated opt-in), A2 authenticated token issuance on every external interface including WebSocket. The cut-line **invariant** — "every automation runs locally during a WAN outage; no cloud service holds the keys" — is a precise statement of the existing local-first-inviolate principle (INV-LF-01/02) and is owned in full by the honest-hybrid doc; this layer states it so the engine is not foreclosed.

---

## 4. Data Model

These are Phase-1 design shapes. Per the AMD-92 type-residency discipline, exact flattened/persisted forms are **phase-2-frozen at each M7.2 slice after review**; nothing here adds a sealed permit or an event type. New types proposed by this document are marked **(new)**; existing types are cited from their owning doc.

| Type | Kind | Residency | Responsibility |
|---|---|---|---|
| `AutomationComponent` **(new)** | Record | automation (config-loaded) | A named, versioned, parameterized definition fragment; body composed of sealed permits with parameter references. Expands to concrete sealed types. |
| `ComponentParameter` **(new)** | Record | automation | A typed parameter: name, value type (from the existing value vocabulary), required/default, constraints. |
| `ComponentArgument` **(new)** | Record | automation | A bound argument (parameter name → typed value or computed value) for an instantiation. |
| `ComputedValue` **(new)** | Sealed interface + bounded operator permits | automation | A bounded, total, side-effect-free typed derivation over {snapshot attributes, parameters, time}. Resolves to a concrete `AttributeValue`/typed value at run initiation. **Not** a `ConditionDefinition` permit and **not** an expression *string*. |
| `ComponentRef` **(new)** | Record | automation (registry/read-side) | `(componentId, version, resolved arguments)` held in the `ComponentRegistry` and mapped from a Run's `definitionHash` for attribution (§3.3); **not** an event-payload field. |
| `RunExplanation` **(new)** | Record (read projection) | automation (read-side) | Assembled "why did this fire?" view: triggering event, matched `triggerId`s, conditions+results, actions+outcomes, resolved targets, `ComponentRef`, `RunCausalChain`. Derived from the log; never persisted as a new event. |
| `NonFiringExplanation` **(new)** | Record (read projection) | automation (read-side) | Assembled "why did this *not* fire?" view: aggregated suppression reasons from existing diagnostics. |
| `SuppressionReason` **(new)** | Enum | automation | Closed set: `MODE_SUPPRESSED`, `CASCADE_LOOP`, `CASCADE_DEPTH_EXCEEDED`, `CONDITION_NOT_MET`, `DEFINITION_NOT_LOADED`, `TARGET_UNAVAILABLE`, `READ_FAILED_CLOSED`. Each maps to an existing diagnostic event. |
| `AuditRecord` **(new)** | Record (read projection) | automation (read-side) | Tamper-evident rendering of a `RunExplanation` bound to the Doc 15 `chain_hash` of its constituent events. |
| `ScopeRef` **(new, reserved seam)** | Record | envelope/metadata level | Reserved optional scope discriminator (default = local site). Design-only; not populated at MVP (§3.5). |
| `RunCausalChain` | Record | automation (AMD-91) | **Existing** (AMD-91). The causal ancestry substrate this layer reads. |
| `RunContext`, `RunId`, `RunStatus` | Record/wrapper/enum | automation (Doc 07 §8.2) | **Existing.** Run state and terminal status the reliability contract binds. |
| `automation_completed` (`failureReason`, `abortReason`) | Event record | event (AMD-92) | **Existing.** The reliability contract uses the already-ratified nullable reason components — no reshape. |

---

## 5. Contracts and Invariants

This layer **adds no sealed permits and no event types.** It guarantees the contracts below and operationalizes every cited invariant with a specific mechanism and a verifying test (§13).

### 5.1 Contracts this layer offers

- **C-SA-1 — Components are indistinguishable from hand-authored definitions after expansion.** A component instantiation produces a concrete `AutomationDefinition` composed only of sealed permits; the engine processes it identically (Doc 07 unchanged). *Test: expand a component, assert the result is structurally equal to the equivalent hand-authored definition and runs identically.*
- **C-SA-2 — Computed values are deterministic and total.** A `ComputedValue` resolves to the same concrete typed value given the same snapshot, parameters, and time; it never throws on valid typed inputs and never performs I/O. *Test: property-test resolution determinism; assert no I/O capability on the type.*
- **C-SA-3 — Every Run has a derivable explanation.** For any `RunId` in the log, `ExplanationService` returns a complete `RunExplanation` reconstructed solely from logged events. *Test: for a corpus of runs, assert the explanation reconstructs trigger/conditions/actions/outcome with no field sourced outside the log.*
- **C-SA-4 — Every non-firing has a derivable reason.** For any (automation, triggering event) where a Run was not initiated or did not complete its actions, a `SuppressionReason` is derivable from existing diagnostics. *Test: induce each suppression cause; assert the correct reason is derived.*
- **C-SA-5 — A running automation degrades to a deterministic terminal state with a recorded reason.** No partial success is silent; no autonomous retry occurs. *Test: inject action failure / unavailable target / fail-closed read; assert terminal `RunStatus` + populated reason + emitted event; assert no re-dispatch.*
- **C-SA-6 — The audit projection is tamper-evident.** An `AuditRecord` binds to the Doc 15 `chain_hash`; altering a constituent event invalidates the record. *Test: mutate a constituent event; assert verification fails.*
- **C-SA-7 — Identity is federation-safe and scope is additively reservable.** No persisted identity is site-local-sequential; scope is absent-defaults-to-local at the envelope level. *Test: assert identity generation is globally unique by construction; assert an absent scope reads as local with no migration.*

### 5.2 Invariant coverage (cited → mechanism)

**INV-TO-02 (Automation determinism).** Computed values are total functions over the AMD-03 single snapshot + parameters + time; expansion is load-time; degradation paths consult no windowed/wall-clock state. → deterministic replay. *(§3.2, §3.4)*

**INV-ES-06 (Every state change is explainable) / INV-TO-01, INV-TO-03 (observable, no hidden state).** Explanations are projections over the immutable log + `RunCausalChain`; no parallel trace store; component attribution is recorded in the run trace. *(§3.3)*

**INV-TO-04 (Structured, queryable logs).** All surfaces consume the LTD-15 structured JSON trace; the explanation and audit projections are queryable through the observability API. *(§3.3, §11)*

**INV-RF-06 (Graceful degradation under partial failure).** The run-coupled degradation contract: deterministic terminal + recorded reason + emitted event; unaffected automations continue. *(§3.4, §6)*

**INV-RF-01 (Integration isolation) / INV-RF-04 (Crash safety & recovery).** The hybrid cut-line injects any remote accelerator as a failure-isolated optional adapter; zombie-Run finalization (Doc 07 §3.10) preserves C1 across crash. *(§3.4, §3.6)*

**INV-LF-01 / INV-LF-02 (Local-first inviolate).** The cut-line keeps all automation decision-making local; core has no outbound network capability; the accelerator is optional and failure-isolated. *(§3.6)*

**INV-PD-07 (Crypto-shredding) / INV-PD-03 (Encrypted at rest).** The run-coupled fail-closed read contract coordinates with A3 so that a shredded/undecryptable read fails closed deterministically (and later degrades via the `DegradedEvent` seam), never masking corruption as intended. *(§3.4)*

**INV-SE-02 (Auth on every external interface).** The explanation/component/audit surfaces are exposed only through the authenticated REST/WS interfaces (A2 token issuance; A1 loopback-default); `/internal/*` is behind auth too. *(§7, §12)*

**INV-CE-01 (Canonical, human-readable config) / INV-CE-03 (schema documented & versioned) / INV-CS-03 (schema stability).** Components and computed values are expressed in the canonical YAML, validated by a registered Doc 06 schema fragment, versioned per AMD-93's `schema_version (major, minor)`. *(§3.2, §9)*

**INV-PR-02 (Automation eval p99 < 100 ms) / INV-PR-03 (bounded, predictable resource use).** Expansion is load-time (off the eval path); computed-value resolution is bounded and adds a small fixed cost at run initiation; explanation derivation is on-demand and bounded; idle cost is zero. *(§3.2, §10)*

**INV-MU-01 (Identity-aware model).** Scope reservation aligns with per-user/per-site context; the audit projection is scope-aware-ready. *(§3.5)*

**AMD-91-INV-01/02 (Deterministic cycle suppression; `RunCausalChain` never crosses the event boundary unflattened).** Explainability reads `RunCausalChain` in-process / from the log per AMD-91's reconstruction-source rule; the audit/explanation projections consume only flattened event components. *(§3.3)*

**AMD-92-INV-01/02 (No automation-resident types in event payloads; full manifest registration before first publish).** This layer mints no events; it reads the flattened AMD-92 inventory. No publish site is added. *(§2.2, §3.3)*

**AMD-90-INV-01/02 (Confirmation never blocks/retries; iteration hard-bounded).** The reliability contract honors no-engine-retry; computed folds are bounded (no unbounded iteration). *(§3.2, §3.4)*

**AMD-88-INV-02 (Stable `triggerId` on user-facing surfaces).** Explanations reference triggers by `triggerId`, never raw index. *(§3.3)*

**AMD-93-INV-01/02 (Forward-only non-destructive migration; fully-resolvable references at load).** Component/computed-value definitions are validated for resolvability at load (fail-closed) and migrate forward-only and non-destructively (no destructive forced migration — anti-requirement). *(§3.2, §6)*

**LTDs:** LTD-01 (Java 21 — sealed interfaces, records, pattern matching; no preview), LTD-04 (typed ULID identity — the federation-safe seam), LTD-08/09 (Jackson/YAML+JSON-Schema for component definitions), LTD-11 (in-process, `ReentrantLock` not `synchronized`), LTD-15 (structured logging substrate for explanations), LTD-17 (no `ServiceLoader` — components are registry-loaded by direct construction, not service discovery).

### 5.3 Candidate invariants introduced by this layer (to be registered at Lock)

Per INV-GA-02 (identifiers are permanent) and the amendment pipeline, these are proposed **statements + mechanisms**; canonical `INV-XX-NN` / `AMD-NN-INV` identifiers are assigned at ratification (escalated to Nick — §15). Provisional tags `[SA-INV-n]` are used here only for cross-reference.

- **[SA-INV-1] Expressiveness expands to the sealed model.** Every component and computed value resolves to instances of the existing sealed `TriggerDefinition`/`ConditionDefinition`/`ActionDefinition` permits; no runtime template, expression-string, or scripting engine exists in the automation path. *(the no-DSL anti-requirement as an invariant)*
- **[SA-INV-2] Explanation is a pure projection of the log.** Every `RunExplanation`/`NonFiringExplanation`/`AuditRecord` is reconstructable solely from persisted events + `RunCausalChain`; no explanation depends on state not in the log.
- **[SA-INV-3] Running automations degrade deterministically.** A Run under partial failure reaches a deterministic terminal `RunStatus` with a recorded reason and an emitted event; the engine never autonomously re-issues a command.
- **[SA-INV-4] Federation non-preclusion.** No persisted identity is site-local-sequential and scope is an additive, absent-defaults-to-local discriminator — so federating never requires migrating the immutable event log.

---

## 6. Failure Modes and Recovery

| # | Failure mode | Trigger | User-visible impact | Recovery | Events produced |
|---|---|---|---|---|---|
| 6.1 | **Component/argument validation failure** | A component definition or instantiation fails type/constraint validation, or references an undefined component/parameter | The offending automation is not loaded; valid automations load (valid-subset semantics, Doc 07 §6.1 / AMD-93) | Correct the YAML; Configuration System reload re-validates. **Fail-closed** — never partial expansion | `config_error` (CRITICAL) with component name + reason + line (AMD-93 framing) |
| 6.2 | **Computed-value resolution failure** | A computed value cannot resolve to a valid typed value at run initiation (e.g., a referenced attribute is absent in the snapshot) | The Run does not proceed on ambiguous input; it terminates deterministically | No retry. The Run is `FAILED` with a `failureReason` identifying the computed value; explainable (§3.3) | `automation_completed` (status `failed`, `failureReason` set) |
| 6.3 | **Fail-closed read during a running Run** | Condition evaluation needs state behind an A3 fail-closed read (GCM-auth-fail / missing-or-corrupt key / chain-hash failure) | The Run fails closed; it does **not** act on partial/ambiguous state | `FAILED` with a `failureReason` identifying the degraded read; when the A3 `DegradedEvent` seam later activates (gated on `chain_hash` + startup-verify), refine to deterministic degrade-marker handling | `automation_completed` (status `failed`); the read-path `config`/`DegradedEvent` signal is owned by A3 |
| 6.4 | **Action failure mid-sequence** | An action throws or a target is unavailable past its `UnavailablePolicy` | Remaining actions do not execute; partial trace preserved | Per Doc 07 §6.2 — single failure does not disable the automation; repeated failures auto-disable past threshold | `automation_action_completed` (outcome error), `automation_completed` (status failed), optionally `automation_disabled` |
| 6.5 | **Run interrupted (reload-restart / shutdown)** | Reload in `restart` mode or system shutdown interrupts a running Run | Run aborts; in-progress component-expanded definitions complete on their original snapshot (C7) | `ABORTED`/`INTERRUPTED` with `abortReason`; zombie-Run finalization on REPLAY→LIVE (Doc 07 §3.10) guarantees a terminal event | `automation_completed` (status aborted/interrupted) |
| 6.6 | **Explanation derivation gap** | A requested explanation references events purged by retention, or the log is mid-replay | The explanation is returned **partial and marked partial** — never fabricated | Bounded: derive from available events; mark missing spans; the log remains the source of truth (no parallel store to corrupt) | none (read-only); a DIAGNOSTIC metric increment (§11) |
| 6.7 | **Audit-record verification failure** | A constituent event's `chain_hash` does not verify | The `AuditRecord` is reported **invalid** (this is the feature working — tamper-evidence) | Surfaced to the auditor; no automatic "repair" of an immutable log | none (read-only); integrity status via Doc 15 `IntegrityService` |

This section is the run-coupled-reliability deliverable in operational form. Every degradation has a trigger, a deterministic outcome, an explainable record, and (where state changes) an event — there is no silent failure path.

---

## 7. Interaction with Other Subsystems

### 7.1 Subsystem interactions

| Subsystem | Direction | Mechanism | Data across the boundary |
|---|---|---|---|
| Automation Engine (Doc 07) | This layer → engine | Direct construction (LTD-17, no `ServiceLoader`) | Concrete `AutomationDefinition`s (expanded); computed-value resolution hook in `RunManager.initiateRun`; run-coupled reliability contract on the Run lifecycle |
| Configuration System (Doc 06) | Receives from | Validated config + reload pipeline; registered schema fragment | Component library + automation definitions; `schema_version` (AMD-93) |
| Event Model / Bus (Doc 01) | Reads from | Event log queries (no new subscriber, no new producer) | Run trace + `CausalContext` + `RunCausalChain` for explanations |
| State Store (Doc 03) | Reads from | `StateQuery` against the AMD-03 snapshot | Attribute values for computed-value resolution and condition evaluation |
| Cryptographic Architecture (Doc 15) | Reads from | `chain_hash` / `IntegrityService` | Tamper-evidence binding for the audit projection; coordination with the A3 read contract |
| REST API (Doc 09) / WebSocket API (Doc 10) | Called by | Authenticated endpoints (A1/A2) | Explanation queries, component CRUD, live causal-chain streaming |
| Observability (Doc 11) / Web UI (Doc 13) | Called by | Read projections + metrics | "Why did/n't this fire?" UX, debugging surface |
| Composition root (app-bootstrap / Doc 12) | Constrains | Wiring | The hybrid cut-line: only-local dependencies into the engine; any accelerator as an optional isolated adapter |

### 7.2 M7 Contract-Impact Interlock (the mandatory §4 deliverable — do not skip)

This is the explicit per-milestone contract-impact section the brief requires. **One-line verdict per M7.x, then the basis.** The rule: any contract change moves through the **formal AMD/supersession pipeline** — never a silent reshape of a ratified (AMD-88..93) or Locked contract.

**M7.1 (trigger/condition path) — UNAFFECTED. ✅ The ride-along build is cleared to proceed in parallel.**
Basis: this layer adds **no sealed permit** to `TriggerDefinition`/`ConditionDefinition`/`SelectorDefinition` (AMD-88/89 untouched) and **no new event type** (AMD-92 inventory untouched). Expressiveness is a **parameterization/composition/expansion layer over** the sealed model (§3.2): components expand into existing permits; computed values resolve to concrete typed values consumed by the *unchanged* `ConditionEvaluator.evaluate(ConditionDefinition, StateSnapshot)` contract. Definition loading/validation rides AMD-93's existing schema-version + dangling-reference frame; the component library is an **additive, separately-loaded** config surface whose expander feeds standard `AutomationDefinition`s into the existing `AutomationRegistry.load(...)` (Doc 07 §8.1) — so M7.1's `automations.yaml` loader contract is untouched, and the component layer builds with/after M7.2, never into M7.1's loader. Therefore M7.1's ratified trigger/condition contracts are not changed, and **M7.1 may build now**. *Contingency (stated honestly):* if a future computed-condition requirement is found to genuinely require a **new** `ConditionDefinition` permit (a runtime-computed predicate that cannot be expressed by load-time/run-init resolution into existing permits), that is an **AMD-89-class amendment** that would re-sequence M7.1 — it is **not** done silently. This document's design deliberately avoids that path (§3.2), and §15 carries it as a NON-BLOCKING open question.

**M7.2 (run/action/dispatch) — SHAPED; builds into this document. ✅ Do NOT freeze M7.2's action contract before this doc Locks.**
Basis: M7.2 is **unbuilt**, so this is *forward-shaping*, not reshaping. Three beats land in M7.2's run model and are specified here so M7.2 implements toward them: (a) **computed-parameter resolution at run initiation** in `RunManager.initiateRun(...)` (§3.2); (b) **component attribution** recoverable via the Run's `definitionHash`→`ComponentRef` mapping in the `ComponentRegistry` — **no new event field; AMD-92 untouched** (§3.2, §3.3); (c) the **run-coupled reliability contract** — deterministic terminal + recorded reason, reusing AMD-92's already-ratified `failureReason`/`abortReason` and AMD-90-INV-01's no-retry rule (§3.4). None reshapes a ratified contract: the action **permits** (AMD-90) and the event **inventory** (AMD-92) are unchanged; only the *unbuilt* run-level execution semantics — explicitly M7.2-design territory — are shaped. The standing **D2/REC-162** action-model question (expected-state vs guarded bounded re-issue) is **left to the separately-escalated M7.2 decision** and is neither resolved nor pre-empted here (§14, §15).

**M7.3 (pending-command ledger) — UNAFFECTED. ✅**
Basis: this layer mints no event type and changes no ledger state machine (Doc 07 §3.11.2 unchanged). The AMD-90 `ConfirmationPolicy` gate that M7.3 reads is unchanged. D2/REC-162 touches M7.3 only if folded into the ledger — and it is **not** folded here. The audit projection (§3.3) **reads** confirmation/command events; it does not alter the ledger's contract.

**Net:** no AMD/supersession is triggered by this draft. If the DOCS review or M7.2 authoring surfaces a genuine contract change, it is raised as a formal AMD with explicit re-sequencing of the affected M7 piece — preserving the discipline that keeps the M7.1 ride-along honest.

---

## 8. Key Interfaces

Phase-1 interface level (responsibilities + boundary; full signatures are M7.2 Phase-2). All constructed directly (LTD-17, no `ServiceLoader`).

### 8.1 Interfaces

| Interface | Responsibility |
|---|---|
| `ComponentRegistry` | Load, validate, and version the component library from configuration (Doc 06); resolve a `ComponentRef` to its definition. Hot-reload-aware (C7). |
| `ComponentExpander` | Expand an `AutomationComponent` + `ComponentArgument`s into a concrete `AutomationDefinition` composed of sealed permits. Load-time for static args; registers the `definitionHash`→`ComponentRef` mapping for attribution (no event reshape). |
| `ComputedValueResolver` | Resolve a `ComputedValue` to a concrete typed value against a `StateSnapshot` + parameters + time, at run initiation. Total, side-effect-free, bounded. |
| `ExplanationService` | Read-only projection: assemble `RunExplanation` / `NonFiringExplanation` from the log + `RunCausalChain`. Mints no events. |
| `AuditProjection` | Read-only projection: render `AuditRecord`s bound to Doc 15 `chain_hash`; report verification status. |
| `AutomationLinter` | Load/edit-time static analysis over expanded definitions: unresolved refs, type mismatches, unreachable conditions, self-shadowed triggers (the A1 substrate). |

### 8.2 Key types

`AutomationComponent`, `ComponentParameter`, `ComponentArgument`, `ComputedValue` (sealed + bounded operator permits), `ComponentRef`, `RunExplanation`, `NonFiringExplanation`, `SuppressionReason` (enum), `AuditRecord`, `ScopeRef` (reserved seam) — all **new** and defined in §4. Existing types reused unchanged: `AutomationDefinition`, `RunContext`, `RunId`, `RunStatus`, `RunCausalChain`, the sealed TCA permits, `CausalContext`, `StateSnapshot`.

> **Note for Phase 2:** these interfaces shape M7.2 (§7.2). Their signatures are frozen at the M7.2 slice that builds them, after review — not in this document. No interface here exposes a non-transitive `requires` type on its API surface (JPMS exports discipline applies at Phase 2).

---

## 9. Configuration

All options have zero-config defaults (INV-CE-02). Component and computed-value definitions live in the canonical YAML, validated by a registered Doc 06 schema fragment and versioned per AMD-93.

```yaml
automation:
  components:
    library_path: components/            # well-known dir under the config root (Doc 06 §7)
    max_expansion_depth: 5               # range 1-10; bounds component-in-component nesting (anti-tarpit)
    max_expanded_definitions: 500        # range 50-5000; bounds total materialized definitions
  computed_values:
    max_inputs: 64                       # range 1-256; max distinct snapshot attributes per computed value
    max_fold_entities: 256               # range 1-4096; upper bound on a bounded fold's resolved Selector set
  explainability:
    enabled: true                        # the "why" surface; read-only, always safe to enable
    non_firing_window: PT24H             # range PT1H-P7D; how far back "why did this NOT fire?" aggregates
  audit:
    enabled: false                       # enterprise audit projection; off for the home default (SP6)
    require_chain_verification: true     # when audit on, bind records to Doc 15 chain_hash
  scope:
    site_id: local                       # RESERVED seam (§3.5); MVP fixed to "local"; do not populate per-site yet
```

Rationale highlights: `max_expansion_depth`/`max_expanded_definitions`/`max_fold_*` are the anti-tarpit bounds that keep expressiveness statically analyzable and resource-bounded (INV-PR-03). `audit.enabled` defaults **off** so the home product carries no enterprise surface (SP6). `scope.site_id` is the reserved discriminator (§3.5) — present so its absence-defaults-to-local semantics are pinned, fixed to `local` at MVP.

---

## 10. Performance Targets

Primary target: Raspberry Pi 4, 4 GB RAM (INV-PR-01). Numbers are budgeted so the automation-eval path stays within INV-PR-02 (automation evaluation p99 < 100 ms).

| Metric | Target | Rationale |
|---|---|---|
| Component expansion (per component, load time) | < 50 ms | One-time at load/reload; off the eval path. Bounds reload latency for a large library. |
| Total load-time expansion (500-definition library) | < 2 s | Keeps cold-start/reload within Doc 12 lifecycle budget. |
| Computed-value resolution (per Run, run init) | < 5 ms p99 | Added to the run-initiation path; leaves ample headroom under the 100 ms eval budget (INV-PR-02). |
| `RunExplanation` derivation (single run, on demand) | < 500 ms p99 | Read-only, user-initiated; bounded by the run's event count, not the whole log. |
| `NonFiringExplanation` (default 24 h window) | < 1 s p99 | Bounded by the window + diagnostic event volume. |
| Idle steady-state cost | 0 | The layer adds no polling, no timer, no subscriber; cost is incurred only at load and on demand. |

These are investigation triggers, not architecture-revision triggers (MVP §8 discipline). The B1 cost-curve at 10k entities / 1k automations is a deferred M7.2/M8 vector (§14); this layer is designed not to add per-event steady-state cost.

---

## 11. Observability

### 11.1 Metrics
- `automation.components.expanded` (counter; labels: component_id, version) — expansions performed.
- `automation.components.expansion_failed` (counter; label: reason) — fail-closed validation rejections (§6.1).
- `automation.computed.resolution_latency` (histogram) — run-init resolution cost (§10).
- `automation.computed.resolution_failed` (counter) — §6.2 occurrences.
- `automation.explanation.queries` (counter; label: kind = why_fired / why_not_fired / audit).
- `automation.explanation.partial` (counter) — §6.6 partial derivations (retention/replay gaps).
- `automation.runs.degraded` (counter; label: terminal_status, reason) — run-coupled degradation outcomes (§3.4).
- `automation.audit.verification_failed` (counter) — §6.7 tamper-evidence trips.

### 11.2 Structured logging
All via SLF4J + Logback structured JSON with correlation context (LTD-15, INV-TO-04): every component expansion, computed-value resolution, degradation, and explanation query logs with `automation_id`, `run_id`, `component_id`/`version`, `correlation_id`, and outcome. **No new event types are minted** (§2.2); these are log records, not bus events. Existing automation events (AMD-92 inventory) carry the data the explanation surface reads.

### 11.3 Health indicator
- **HEALTHY** — expansions succeed; computed resolutions succeed; explanation derivations complete.
- **DEGRADED** — repeated component-expansion or computed-resolution failures within a window (mirrors Doc 07 §3.7.1's depth-exceeded DEGRADED pattern), or repeated explanation-partial events indicating retention pressure.
- **UNHEALTHY** — the component library cannot be loaded at startup (fail-closed; the engine still runs hand-authored definitions). Feeds the system health API (Doc 11).

---

## 12. Security Considerations

This layer handles a trust boundary (the audit surface), an external-facing read surface (explanations), and the federation/hybrid seams — so the section applies.

- **No injection surface (the no-DSL property as a security control).** Because expressiveness expands to sealed permits and computed values are bounded total functions with no string templating, there is no expression-injection or template-injection vector (Doc 07 §12 "no template injection," extended). Component arguments are typed and validated fail-closed.
- **Authenticated access only (INV-SE-02, A1/A2).** Explanation, component CRUD, and audit endpoints are exposed solely through the authenticated REST/WS surfaces; loopback-default bind (A1); token issuance with the **enterprise per-scope/per-site claims hook** designed in (A2). `/internal/*` is behind auth. The explanation surface must not leak state a token is not scoped to read (scope-aware-ready via §3.5).
- **Tamper-evident audit (Doc 15).** The audit projection binds to `chain_hash`; it surfaces verification failure rather than masking it.
- **Local-first inviolate (INV-LF-02).** The hybrid cut-line guarantees no core automation path makes an outbound network call; any accelerator is an optional, isolated, authenticated edge that never holds keys.
- **Never lead with commodity encryption.** The audit/integrity story rests on the event-sourced tamper-evident log and Doc 15's established primitives, not on a bespoke or headline encryption claim.

---

## 13. Testing Strategy

### 13.1 Unit
- Component expansion equivalence (C-SA-1): expanded == hand-authored; nested expansion within `max_expansion_depth`; over-depth rejected.
- Computed-value determinism & totality (C-SA-2): property tests over typed inputs; no-I/O assertion; bounded-fold ceiling enforced.
- Explanation reconstruction (C-SA-3): `RunExplanation` fields all sourced from logged events; component attribution present.
- Suppression-reason derivation (C-SA-4): one test per `SuppressionReason` cause.
- Linter checks: unresolved ref, type mismatch, unreachable condition, self-shadowed trigger each detected at load.

### 13.2 Integration (this layer over the real Doc 07 engine)
- A component-expanded automation runs identically to its hand-authored twin against the real engine.
- Computed-parameter resolution at run init against a real `StateSnapshot`; replay determinism (INV-TO-02) across a REPLAY→LIVE cycle.
- "Why did this fire?" and "why did this NOT fire?" derived against a real multi-run, cascade-containing log (including `cascade_loop_detected` / `cascade_depth_exceeded`).
- Audit record verification against Doc 15 `chain_hash`; mutation invalidates (C-SA-6).

### 13.3 Performance
- The §10 targets, on Pi-4-class hardware: expansion latency, computed-resolution p99 within the eval budget, explanation derivation bounds, zero idle cost (the storm/cost-curve B1 harness is deferred — §14).

### 13.4 Failure (the most important — §6)
- Fail-closed component/argument validation (6.1): invalid component → not loaded, valid subset loads, `config_error` emitted.
- Computed-resolution failure (6.2) and fail-closed read during a Run (6.3): Run terminates `FAILED` with the correct `failureReason`; **no re-dispatch** (assert C-SA-5 / AMD-90-INV-01).
- Interrupt + zombie-Run finalization (6.5): every `automation_triggered` reaches a terminal `automation_completed` across crash (C1).
- Explanation partiality under retention purge (6.6): returned partial-and-marked, never fabricated.
- Federation-seam non-preclusion (C-SA-7): an absent scope reads as local; adding scope is additive with no log migration (assert against a simulated scoped envelope).

---

## 14. Future Considerations

Each item is **deliberately deferred**; the note states what in this design keeps the door open.

- **Cross-cutting reliability-as-a-product-property** (own co-equal doc, right after this one). This layer owns only the run-coupled half; the longevity/observability-as-product/self-healing half is separable and not M7-gating. Accommodation: the run-coupled contracts and the explanation surface are the substrate that doc builds its system-wide story on.
- **Multi-site / enterprise federation (B3)** (own post-M8 doc; mints its own invariants). Accommodation: §3.5's identity/scoping seam — globally-unique identity preserved, scope reserved as an additive absent-defaults-to-local discriminator aligned with the A2 claims vocabulary.
- **Honest-hybrid deployment (C1)** (own tight doc with app-bootstrap). Accommodation: §3.6's cut-line invariant and the composition-root pin (only-local dependencies; optional isolated accelerator).
- **Conflict/precedence at scale (A2), eval/snapshot cost curve (B1), concurrency/backpressure (B2)** (deferred M7.2/M8 research briefs). Accommodation: the statically-analyzable expanded model (§3.2) is the substrate the conflict analyzer and the cost-curve harness will operate over.
- **Expected-state vs guarded bounded re-issue (D2 / REC-162)** (the standing escalation; an M7.2 action-model decision). Accommodation: §3.4 keeps no-engine-retry as the current contract and explicitly does **not** pre-empt the decision — if Nick rules a guarded idempotent re-issue in, it enters via the M7.2 action model through a formal AMD.
- **Reachability asleep-vs-dead (E2)** (deferred). Accommodation: the run-coupled fail/degrade contract distinguishes a deterministic failure from a not-yet-known state; the `Availability` granularity work folds into the explanation/reliability surfaces later.

---

## 15. Open Questions

1. **Computed-condition permit boundary.** Does any required computed-condition use case need a **new** `ConditionDefinition` permit, or does load-time/run-init resolution into existing permits cover the field demand? Options: (a) resolution-only (this doc's design — preserves M7.1); (b) a new computed-predicate permit (an AMD-89-class change that re-sequences M7.1). Needed: the A1/D1 field corpus assessed against a real M7.2 engine. **Status: [NON-BLOCKING]** — the doc Locks on (a); (b) is a future AMD if ever justified, never silent.
2. **Component versioning & deprecation policy (AX-7).** Before users author shareable components, the version/deprecation/compat policy must be set (so a component update can't silently break dependents). Options: semver on `(componentId, version)` with forward-only, non-destructive migration (AMD-93-aligned) vs a stricter immutability model. Needed: a Nick ruling on the user-authoring lock-in approach. **Status: [NON-BLOCKING for this doc's Lock] / escalation to Nick — must resolve before M7.2 ships user-authored components.**
3. **Expansion timing for computed arguments.** Static arguments expand at load; computed arguments resolve at run init. Is there a class of "load-time-computable" arguments worth expanding early for analyzability? Options: (a) the two-tier model as designed; (b) a constant-folding pass at load. Needed: profiling on a real library. **Status: [NON-BLOCKING]** — an optimization within the committed model.
4. **Audit projection scope granularity.** At what granularity does the enterprise audit projection filter by scope (per-site / per-user / per-category)? Needed: input from the federation + institutional-API docs. **Status: [NON-BLOCKING]** — the seam (§3.5) reserves scope; granularity is owned downstream.
5. **D2 / REC-162 (expected-state vs guarded bounded re-issue).** Explicitly **not** resolved here. **Status: [NON-BLOCKING for this doc] / standing escalation to Nick as the M7.2 action-model decision** — do not flip REC-162 silently.

No **[BLOCKING]** question remains; the Locked decisions hold regardless of how the above resolve. The two escalations (Q2, Q5) are user-authoring/M7.2-action gates, not Doc-16-Lock gates.

---

## 16. Summary of Key Decisions

| Decision | Choice | Rationale | Section |
|---|---|---|---|
| Expressiveness mechanism | Components + typed parameters + bounded computed values that **expand into the sealed permits** | Power without a DSL; statically analyzable; no injection surface; preserves M7.1 | §3.2, SP1 |
| New sealed permits / event types | **None** | Adding either would reshape AMD-88/89/90/92; keeps M7.1/M7.3 UNAFFECTED | §2.2, §7.2 |
| Computed values | Bounded, total, side-effect-free; resolve at run init to concrete typed values | Determinism (INV-TO-02); replay-safe; not a language | §3.2, SP1 |
| Explainability | Read-only **projection over the log + `RunCausalChain`**; no parallel trace store | INV-ES-06; SP2; mints no events (M7-safe) | §3.3, SP2 |
| "Why did this NOT fire?" | Aggregate existing suppression diagnostics into `NonFiringExplanation` | The high-value half; no new events | §3.3 |
| Enterprise audit | Same log, bound to Doc 15 `chain_hash`; default **off** | Same-runtime tier; home trust brand is the floor | §3.3, §12, SP6 |
| Run-coupled reliability | Deterministic terminal + recorded reason; **no engine retry**; reuse AMD-92 `failureReason`/`abortReason` | INV-RF-06; AMD-90-INV-01; no AMD-92 reshape | §3.4, SP3 |
| A3 read coupling | A running automation **fails closed** on a degraded read; degrade-marker handling deferred to the A3 seam | Avoids masking corruption as intended (A3/R-α) | §3.4, §6.3 |
| Federation | **Seam only** — globally-unique identity preserved; scope reserved as additive absent-defaults-to-local | Cheap-now / irreversible-later; no log migration to federate | §3.5, SP5, [SA-INV-4] |
| Hybrid | **Cut-line only** — all decisioning local; accelerator optional + isolated; pinned in the composition root | Local-first inviolate (INV-LF-02); coordinated with A1/A2 | §3.6, SP5 |
| M7 interlock | **M7.1 UNAFFECTED · M7.2 SHAPED (builds into this) · M7.3 UNAFFECTED**; any change → formal AMD | Forward-shape, never reshape; clears the M7.1 ride-along | §7.2, SP4 |
| Loading/migration | Fail-closed validation; forward-only, non-destructive (AMD-93) | No destructive forced migration (anti-requirement) | §6.1, §3.2 |

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It is governed by the Design Document Template and is submitted for the DOCS second-opinion review preceding Lock. It is authored ahead of M7.2/M7.3 per the 2026-06-18 superiority scope ruling (Part B); its M7 Contract-Impact Interlock (§7.2) is the condition under which the M7.1 ride-along build proceeds in parallel.*
