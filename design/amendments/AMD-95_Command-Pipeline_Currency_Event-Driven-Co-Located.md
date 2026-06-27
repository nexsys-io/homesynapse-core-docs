<!--
file: design/amendments/AMD-95_Command-Pipeline_Currency_Event-Driven-Co-Located.md
purpose: AMD-95 — the Doc 07 §3.11 / AMD-90 command-pipeline currency reconciliation. Brings the Locked design into agreement with the frozen source the M7.3 [REVIEW]s mapped AND ratifies the §1 event-driven/co-located dispatch shape (decision record 2026-06-25, D1) as the target M7.4 builds. Authored so M7.4a/M7.4b author against reality, not against a pipeline the code never built.
audience: Nick (ratify), PM, Coder (M7.4), independent DOCS-Project reviewer
status: **RATIFIED 2026-06-26** (v7 hub). DOCS-currency review **RATIFY-WITH-EDITS** (return `nexsys-hivemind/context/audits/2026-06-26_AMD-95-and-doc-currency_review_return.md` — all eight frozen-signature claims VERIFIED EXACT at core `5363347`; the AMD-90 §2.1 supersede-in-part correct; zero source/event/module-info delta); **Nick co-signed 2026-06-26** (the §3 consolidated decision pass, decision A1). The §3 edit list (incl. the three review-added drift fixes: getIntegrationForEntity→two-hop, handleCommand→handle(CommandEnvelope), §4.3 comment) is folded into Doc 07 §3.11.1/§3.11.2/§4.3/§7/§16 + the AMD-90 §11 supersede-in-part note. On-disk amendment watermark **AMD-94 → AMD-95** (a genuine Locked-doc amendment, unlike the Doc 16/17 new-doc Locks). ZERO invariant mint (register stays 169/49 from this amendment). **Unblocks M7.4a.**
source: the M7.3 closeout [REVIEW]s (pm-handoff beat 7; coder-handoff M7.3 block; cross-agent-notes 2026-06-22) + the §1 deeper-M7 architecture decision record (context/decisions/2026-06-25_deeper-M7-automation-architecture_decision-record.md, D1–D4) + the 2026-06-23 prior-art study.
baseline: homesynapse-core HEAD `5363347` (M7.3 DELIVERED GREEN; live wiring deferred → M7.4). The frozen signatures below are source-verified at this HEAD.
-->

# AMD-95: Command-Pipeline Currency — Event-Driven/Co-Located Dispatch + Capability-Sourced Confirmation

**Context.** Doc 07 §3.11 and AMD-90 §2.1 describe a command pipeline the code never fully built — the recurring source of the M7.3 "source-drift" [REVIEW]s and of wiring surprises. This amendment is a **currency reconciliation**: it (A) **affirms** §3.11.1's event-driven dispatch shape, now ratified by the §1 decision (D1) with the **co-located-for-MVP** refinement; and (B) **corrects** the three details the frozen source diverged on (the expectation source, the confirmation-policy placement, the value typing) so M7.4 authors against reality. It changes **no event type and no module-info**; it reconciles prose + one AMD design item to the as-built engine and the ratified target.

## 1. Problem Statement — the documented-vs-built drift (source-verified at `5363347`)

1. **Dispatch shape — built as an in-process call, not the doc's subscriber.** Doc 07 §3.11.1 specifies the executor appends `command_issued` and a separate `command_dispatch_service` subscriber consumes it. The source instead has `StandardActionExecutor` call `CommandDispatchService.dispatch(EventId, EntityId, String, Map<String,Object>)` **in-process** (`StandardActionExecutor.java:184`); the dispatch service (`StandardCommandDispatchService`) emits `command_dispatched`/`command_result` (the executor itself publishes only its own `automation_action_started/completed` diagnostics). `command_issued` is **never emitted**, and `command_dispatch_service` is an in-process collaborator, **not** a registered subscriber. Consequence: the Pending Command Ledger has **no live input** (its first FSM event, `command_issued`, is never produced) and the explainability causal chain has no `command_issued` node.
2. **Expectation source — `ExpectationFactory` has no implementation.** §3.11.1 step 3 / §3.11.2 step 1 say the expected outcome is computed by `ExpectationFactory` and recorded "from the event payload." Reality: `ExpectationFactory` is an **interface only** (no impl in the tree), and `CommandIssuedEvent` is the **FROZEN 5-component** record `(Ulid targetEntityRef, String commandType, String parameters, int confirmationTimeoutMs, CommandIdempotency idempotencyClass)` — it carries **no expectation/attribute/policy**. The shipped ledger resolves the `Expectation` from the **target capability's** `CommandDefinition.expectedOutcomes()` (device-model), reached via `EntityRegistry`.
3. **Confirmation policy — placed on the capability, not on `CommandAction`.** AMD-90 §2.1 specified an automation-resident `ConfirmationPolicy { OPTIMISTIC, REQUIRED, BEST_EFFORT }` enum and a **5th `confirmation` component on `CommandAction`** (4 → 5 fields). The M7.2b action-model freeze (2026-06-22, `1b0b6c9`) instead froze `CommandAction` at **4 fields** `(Selector target, String commandName, Map<String,Object> parameters, UnavailablePolicy onUnavailable)` — the `confirmation` component was **never added**, and the AMD-90 `ConfirmationPolicy{OPTIMISTIC,REQUIRED,BEST_EFFORT}` enum **does not exist**. The in-tree confirmation signal is the **capability's** `ConfirmationPolicy.mode()` (the device-model `ConfirmationMode` enum — `EXACT_MATCH`, `TOLERANCE`, …, **`DISABLED`**), where `DISABLED` ≡ "confirmation off / optimistic" (the M7.3 `ConfirmationPolicyGateTest` drives the bypass through this signal).
4. **Value typing — `state_reported.value` is a `String`.** §3.11.2 step 3 has the ledger evaluate the reported value against the `Expectation`, which needs a typed `AttributeValue`. `StateReportedEvent.value` is a `String` at HEAD, so the ledger coerces (directed by the expected `AttributeType`; total — uncoercible → `DegradedAttributeValue`, never throws).

What is **correct** in AMD-90 and stays: **no engine retry at any policy** (AMD-90-INV-01, frozen at M7.2b); the per-command `confirmation_timeout_ms` carried on `command_issued` from the capability's `CommandDefinition.default_timeout` with the `automation.command_pipeline.default_confirmation_timeout_ms` fallback (Doc 07 §9) — `CommandIssuedEvent.confirmationTimeoutMs` exists. AMD-90's `RepeatAction`/`InvokeAutomationAction` permit items are **out of scope here** (separate action-model currency; flag-only — see §6).

## 2. Specification — the reconciliation

### 2.A Dispatch shape — AFFIRM event-driven; ADD co-located-for-MVP; RECORD current-vs-target (§1 D1)

- **Ratify §3.11.1's event-driven shape.** The §1 decision (D1, RATIFIED 2026-06-25) confirms the executor **emits `command_issued`** to the log and `command_dispatch_service` is a **real bus subscriber** that consumes it and dispatches — the log is the **single source of truth for dispatch**, not merely its record. This makes replay-safety structural (a subscriber acts only in LIVE — D2), scales additively to cross-process/host/cloud/AI, and inherits AMD-31 ordering free from global position.
- **Co-located for MVP.** The dispatch subscriber runs **in-process / co-located** with the engine for MVP — the seam is correct and scales later while the latency is a single local hop. **Session D** (the Pi dispatch-latency spike) is the empirical confirmation; it is **non-blocking** (co-location is the ratified default).
- **Current-vs-target currency note (Doc 07 §3.11.1).** Record that as-of M7.3 (`5363347`) the executor dispatches **in-process** and does not emit `command_issued`; **M7.4a** wires the event-driven/co-located shape (the executor emits `command_issued`; `command_dispatch_service` becomes a co-located subscriber on it, with a paired `stop()` teardown), at which point §3.11.1's description is live. This supersedes the v5 "emit + keep dispatch in-process" hybrid lean.

### 2.B Expectation source — CORRECT `ExpectationFactory` → capability `CommandDefinition.expectedOutcomes()`

Doc 07 §3.11.1 step 3 / §3.11.2 step 1 are corrected: a LIVE `command_issued` resolves the target's capability (`EntityRegistry.findEntity` → `Entity.capabilities` → the `CapabilityInstance` whose command set carries the `commandType`) and reads the `ExpectedOutcome`(s) from `CommandDefinition.expectedOutcomes()` to build the `Expectation`. `CommandIssuedEvent` carries **no** expectation (it is the frozen 5-comp record). `ExpectationFactory` (interface, no impl) is **not** on the live path; if a parameterized expectation (e.g. `set_level(75)` → `ExactMatch(75)`) is ever required, that is a **separate, demand-gated** action-model change with its own AMD — not assumed here.

### 2.C Confirmation policy — CORRECT placement to the capability (supersede AMD-90 §2.1 for the as-built engine)

The shipped confirmation policy is read from the **capability**, not from a `CommandAction` component:

- `CommandAction` is the **frozen 4-field** record (M7.2b); it gains **no** `confirmation` component. AMD-90 §2.1's "`CommandAction` 4 → 5 fields" and the automation-resident `ConfirmationPolicy{OPTIMISTIC,REQUIRED,BEST_EFFORT}` enum are **superseded by reality** and withdrawn for the V1 engine.
- The confirmation signal is the capability's `ConfirmationPolicy.mode()` (device-model `ConfirmationMode`): **`DISABLED` ≡ optimistic / no ledger tracking**; a non-`DISABLED` mode (`EXACT_MATCH`/`TOLERANCE`/…) ≡ track-and-confirm. This is the first behavioral consumer of the policy (the M7.3 `ConfirmationPolicyGateTest`).
- **Preserved unchanged:** Run completion **never** blocks on confirmation at any setting (timeout is asynchronous; `command_confirmation_timed_out` stays DIAGNOSTIC); the per-command timeout precedence (capability `default_timeout` → the `default_confirmation_timeout_ms` config key); and **no engine retry** (AMD-90-INV-01). AMD-90-INV-01/02 are **not** disturbed by this amendment.

### 2.D Value typing — RECORD the `String` → `AttributeValue` coercion bridge

Doc 07 §3.11.2 step 3: the ledger coerces `StateReportedEvent.value` (`String`) to the typed `AttributeValue` the `Expectation` needs, directed by the expected `AttributeType` (total; uncoercible → `DegradedAttributeValue` typed-absent — the M7.2b precedent; never throws). Forward note: if `state_reported` is later typed at the source, this coercion is removed (a future, additive change).

### 2.E M7.4 constraints carried from the §1 decision (cross-reference, not re-specified here)

M7.4 builds 2.A–2.D under two §1 constraints: **D2 pure-function-replay** (device dispatch and all external side-effects run only in LIVE, never on replay — structural once dispatch is a subscriber; CI-tested in the M7.4b gate) and **D3 additive event versioning** (any new/changed event shape carries the `version` field + an upcaster). See the decision record.

## 3. Downstream Impact

- **Doc 07 edits (at ratification):** §3.11.1 — affirm event-driven + add the co-located-for-MVP sentence + the current-vs-target currency note; correct the `ExpectationFactory` step to capability-sourced `CommandDefinition.expectedOutcomes()`. §3.11.2 — correct "expected outcome from the event payload" → capability-resolved; add the confirmation-from-capability sentence + the `String`→`AttributeValue` coercion note. §16 decision summary — the confirmation-policy-on-capability row.
- **Doc 07 edits — ADDED by the 2026-06-26 DOCS-currency review (genuine drift in the same sections; fold in this pass):** **(6)** §3.11.1 **step 2** — `DeviceRegistry.getIntegrationForEntity(entityRef)` is stale (no such method in source); correct to the two-hop `EntityRegistry.findEntity → Entity.deviceId() → DeviceRegistry.findDevice → integration` (the shipped `StandardCommandDispatchService.java:41` Javadoc names `getIntegrationForEntity` as the thing it is NOT). **(7)** §3.11.1 **step 5 + §7 (~line 777)** — `CommandHandler.handleCommand(entityRef, commandName, parameters)` is stale; source is `void handle(CommandEnvelope command) throws Exception` (`integration-api/.../CommandHandler.java:61`) — correct both citation sites (Doc 05 §3.8 itself is already correct). **(8)** §4.3 (`PendingCommand` record) — the field comment `// from ExpectationFactory` carries the same stale claim; correct to `// from CommandDefinition.expectedOutcomes()`.
- **AMD-90 edits (at ratification):** a §11 "Superseded-in-part by AMD-95" note on §2.1 (the `CommandAction.confirmation` 5th component + the `ConfirmationPolicy{OPTIMISTIC,REQUIRED,BEST_EFFORT}` enum are withdrawn for the V1 engine; confirmation is capability-sourced). AMD-90-INV-01/02, the timeout design, and the RepeatAction/InvokeAutomation items are untouched.
- **Source:** **ZERO** — this amendment reconciles docs to the frozen source; no code changes from the amendment itself (M7.4 is the code WU). **module-info UNCHANGED; counts stay 71/41/53; zero event mint.**
- **JPMS / Glossary:** no new type names that aren't already in source (`ConfirmationMode`, `CommandDefinition`, `ExpectedOutcome`, `EntityRegistry`, `DegradedAttributeValue` all exist).

## 4. Invariants and Citations

- **No new invariant minted by this amendment.** It affirms AMD-90-INV-01 (no engine retry) and AMD-31 (dispatch ordering by global position). The §1 **pure-function-replay** invariant (decision record D2) is registered through its own forward governance action, not here.
- Cites: Doc 07 §3.11.1/§3.11.2 (the command pipeline), §3.9 (action execution), §9 (the timeout config key); AMD-90 §2.1 (the superseded-in-part confirmation surface), AMD-90-INV-01 (no-retry, affirmed); AMD-92 (`CommandIssuedEvent` frozen 5-comp; zero mint); AMD-31 (dispatch order = global position); Doc 02 (`CapabilityInstance`, `ConfirmationMode`, `CommandDefinition.expectedOutcomes()`, `EntityRegistry`); the §1 decision record (D1 shape, D2/D3 constraints); the M7.3 closeout [REVIEW]s #1–#4 + #6 (the source-drift evidence, file+line in coder-handoff).

## 5. Implementing WU

**M7.4a** (the `command_issued` producer + the co-located `command_dispatch_service` subscriber, paired `stop()` teardown) + **M7.4b** (the live `pending_command_ledger` subscriber + `pollExpirations()` tick + the E2E composition-root gate + the D2 replay CI test). This amendment is **doc-only**; it authors **before** M7.4a so M7.4 builds against the reconciled design. No deferred build gate from this amendment.

## 6. Scope Fences / Deferred

- **AMD-90 `RepeatAction` / `InvokeAutomationAction` permit currency is OUT of this amendment** (those are action-permit items, not the command pipeline). Flag-only: confirm at a separate action-model currency pass whether the shipped permit set matches AMD-90 §2.2/§2.3 (the M7.2b freeze + the M7.3 [REVIEW]s did not touch them). Not a blocker for M7.4.
- **No `ExpectationFactory` implementation** is added or required by V1 (parameterized expectations are demand-gated, separate AMD).
- **No engine retry, ever, in V1** (AMD-90-INV-01 / REC-162 — affirmed, not reopened).

## 7. Ratification Checklist

- [x] Independent DOCS-Project review (source-verify the frozen signatures at `5363347`; rule the AMD-90 §2.1 supersede-in-part; confirm zero event-type/module-info impact) — RATIFY-WITH-EDITS, 2026-06-26
- [x] Nick ratification (co-sign — the PM does not self-ratify) — 2026-06-26 (§3 decision A1)
- [x] Doc 07 §3.11.1/§3.11.2/§4.3/§7/§16 currency edits applied (incl. review edits 6–8) — 2026-06-26
- [x] AMD-90 §2.1 "superseded-in-part by AMD-95" note applied (§11 + the §2.1 inline marker) — 2026-06-26
- [x] Nav-index row + watermark AMD-94 → AMD-95 — 2026-06-26
- [ ] Spine flip (snapshot watermark; backlog M7.4 row references AMD-95) — applied in the v7 hub spine reconcile (this session)

## 8. Review Disposition

**DOCS-currency review returned 2026-06-26 (Cowork, source-verifying) — VERDICT: RATIFY-WITH-EDITS** (`context/audits/2026-06-26_AMD-95-and-doc-currency_review_return.md`). All eight frozen-signature/count claims **VERIFIED EXACT** at core `5363347`; the AMD-90 §2.1 supersede-in-part is the correct disposition; zero-impact (no mint, 71/41/53, no module-info, no source delta) is exact. The rulings need no change; the **edit list was extended** with three genuine drifts the review found inside the same sections — edits (6) `getIntegrationForEntity` → two-hop, (7) `handleCommand` → `handle(CommandEnvelope)`, (8) §4.3 `// from ExpectationFactory` comment — now folded into §3 above (the §1.1 emitter attribution was also tightened). **Awaiting Nick's co-sign;** on co-sign the §3 edit list applies to Doc 07 / AMD-90, watermark AMD-94 → AMD-95, spine flips. The amendment does not self-ratify and applies no mechanics until then.

**Related Tier-2 finding (NOT part of this amendment):** the review confirmed AMD-95 §6's flag fires — the shipped `ActionDefinition` permits **8** types, not AMD-90 §2.2/§2.3's 9 (`RepeatAction` unbuilt; `ActivateSceneAction` never renamed to `InvokeAutomationAction`). That ratified-but-unbuilt action-permit drift is a **separate action-model currency item** (build-vs-defer, off the M7.4 critical path), not folded here.
