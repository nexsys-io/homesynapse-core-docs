<!--
file: design/amendments/AMD-90_ActionDefinition_Confirmation_Repeat_Invoke.md
purpose: AMD-90 — ActionDefinition M7 expansion: ConfirmationPolicy opt-in surface (the merged 33⊕143⊕144⊕161 item: named default + existing confirmation_timeout_ms key binding + Pi-4 calibration spike), RepeatAction permit, ActivateSceneAction→InvokeAutomationAction rename+promotion (DQ-2).
audience: Nick (ratify), PM, Coder, independent DOCS-Project reviewer
status: RATIFIED 2026-06-12 (Nick) — bundled DOCS review RATIFY-AS-IS per §10 (zero edits); mechanics applied 2026-06-12 (invariants §44; nav-index row; Doc 07 banner)
source: Research 4 REC-33/37/40 ⊕ R14-A REC-143/144 ⊕ R14-B REC-161 (the merged disposition §1.1 collision adjudication; evidence-grade rule: R14-A community evidence prioritizes, R14-B prior art constrains) via merged disposition §2a-F3
baseline: homesynapse-core HEAD `e5ea76f` (substantive `7c73c91`); ActionDefinition 8 permits (5 Tier 1 + 3 Tier 2) + `automation.command_pipeline.default_confirmation_timeout_ms` (Doc 07 §9, default 30000, range 5000–120000) source-verified at this baseline
-->

# AMD-90: ActionDefinition M7 Expansion — `ConfirmationPolicy`, `RepeatAction`, `InvokeAutomationAction`

**Block context:** Third of the six-amendment M7 automation block (AMD-88..93). Root-interface confirmation surface + one new permit (8 → 9) + one rename-and-promote. The rename is source-breaking in name only (the record is an empty Tier-2 reserved type with zero field consumers).

## 1. Problem Statement

Three gaps: (1) the Pending Command Ledger is implicitly mandatory for every command — competitive evidence (HA optimistic mode; Z-Wave Supervision CC; Matter Timed Invoke; the frenck 2022 maintainer statement that retry/verification is "out of scope for HA… a level UP" — the R14-A §3.3 dossier) says confirmation must be a per-action POLICY with a calibrated default, not a fixed behavior; (2) no iteration primitive (HA `repeat:` parity; unbounded-loop hazard documented in HA #115042); (3) `ActivateSceneAction` (Tier-2 empty) contradicts the accepted scenes-as-automations model (REC-37) — Nick's DQ-2 ruling renames and promotes it.

## 2. Specification

### 2.1 `ConfirmationPolicy` (the merged 33⊕143⊕144⊕161 item)

New automation-resident enum:

```java
public enum ConfirmationPolicy {
    /** No ledger entry; action completes on dispatch. The explicit opt-out. */
    OPTIMISTIC,
    /** Ledger entry mandatory; the trace carries confirmed/timed-out resolution. */
    REQUIRED,
    /** Ledger entry iff the capability command defines an expected outcome
     *  (Expectation available — confirmation is cheap); else OPTIMISTIC. */
    BEST_EFFORT
}
```

- **Root-interface surface:** `ActionDefinition` gains a default method `default ConfirmationPolicy confirmation() { return ConfirmationPolicy.OPTIMISTIC; }`. Only `CommandAction` overrides it — via a new **non-null** component `confirmation` (default applied at YAML load when unset — mirroring `onUnavailable`'s "non-null, default SKIP applied at YAML load" convention exactly), making `CommandAction` 4 → 5 fields: `CommandAction(Selector target, String commandName, Map<String,Object> parameters, UnavailablePolicy onUnavailable, ConfirmationPolicy confirmation)`. **Breaking canonical-ctor change to `CommandAction`** — construction-site sweep rides the AMD-89 sweep (same survey, same WU). Non-command permits keep the interface default (confirmation is meaningless for Delay/WaitFor/Branch/Emit — the root default makes that structural rather than per-permit boilerplate).
- **The NAMED default (REC-144, PM-stated for review confirmation): `BEST_EFFORT`.** Semantics read exactly as the disposition's parenthetical — confirmation "off; on where `Expectation` is cheap": commands whose capability defines an `ExpectedOutcome` get ledger tracking (the correlation costs nothing extra — the §3.11.2 machinery already evaluates incoming `state_reported`); commands without expectations don't pretend to confirm. `REQUIRED` is the opt-in hard-confirm; `OPTIMISTIC` is the opt-out. The frenck double-actuation rationale is the reason `REQUIRED` is NOT the default: confirmation-driven remediation (M8.2) must never surprise-double-actuate. [REVIEW-POINT R90-1: confirm BEST_EFFORT-as-default vs OPTIMISTIC-as-default — the disposition's "opt-in" phrasing tolerates either reading; the PM default preserves today's ledger-for-expectation-bearing-commands behavior.]
- **Run-independence preserved (unchanged Locked semantics):** Run completion NEVER blocks on confirmation at ANY policy value (Doc 07 critical-review 3.5/4.2 — timeout evaluation is asynchronous; `command_confirmation_timed_out` stays DIAGNOSTIC). `REQUIRED` changes what the LEDGER tracks and the trace shows, not Run lifecycle.
- **Timeout key — BINDS to the existing config, mints nothing:** the per-command timeout remains `confirmation_timeout_ms` carried in the `command_issued` payload from the capability's `CommandDefinition.default_timeout`, with the system fallback **`automation.command_pipeline.default_confirmation_timeout_ms`** (Doc 07 §9 — EXISTS at baseline, default 30000, range 5000–120000). Precedence (now stated explicitly): capability `default_timeout` → config key default. No per-action timeout field in M7 (a fourth layer is authoring noise; demand-gated).
- **Calibration spike (REC-161, pinned):** before M7.3 freezes test pins on the 30000 default, a Pi-4 round-trip calibration spike (Zigbee + Z-Wave actual command→`state_reported` latencies) confirms or adjusts the default VALUE within the frozen range. Spike, not CI gate (§10 targets are investigation triggers). Owner: Nick's bench, alongside the OQ-15-2 microbench cadence.

### 2.2 `RepeatAction` (8 → 9 permits; REC-40)

**`RepeatAction(RepeatMode mode, int count, ConditionDefinition condition, Selector forEach, List<ActionDefinition> sequence, int maxIterations)`** with automation-resident enum **`RepeatMode { COUNT, WHILE, UNTIL, FOR_EACH }`**:

- `COUNT`: run `sequence` exactly `count` times (`count` ≥ 1; ignored other modes).
- `WHILE`/`UNTIL`: re-evaluate `condition` (non-null for these modes, validated at load) before/after each iteration against the Run's single AMD-03 snapshot **for state conditions** — i.e. state-based `WHILE` over a static snapshot is degenerate and load-validation WARNs on it; the intended carriers are `WaitForAction`-composed patterns and `TimeCondition`. [REVIEW-POINT R90-2: alternative = re-snapshot per iteration, which breaches AMD-03's single-snapshot-per-Run rule — the PM keeps AMD-03 inviolate and accepts the degenerate-case WARNING.]
- `FOR_EACH`: iterate `sequence` once per entity resolved by `forEach` (non-null for this mode), binding the iteration entity as the implicit command target where an inner `CommandAction.target` is the reserved `iteration` selector form. Exact YAML binding frozen at implementation.
- **`maxIterations` (default 100, hard ceiling all modes)** — the HA #115042 lesson; exceeding terminates the action with outcome `error` (Run → FAILED per §6.2). Nested `RepeatAction` within `sequence` is REJECTED at YAML load (recursion bound, trace-model sanity — `ConditionBranchAction` nesting inside `sequence` remains legal).

### 2.3 `ActivateSceneAction` → `InvokeAutomationAction` (DQ-2 rename + promotion)

The Tier-2 empty `ActivateSceneAction()` is **renamed and promoted**: **`InvokeAutomationAction(String automationSlug)`** — invokes another automation by slug (the scenes-as-automations model: invoking an automation whose only trigger is `ManualTrigger` ≡ activating a scene). Slug resolution at execution via `AutomationRegistry.getBySlug` (dangling slug → §6.1-class load validation per AMD-93 + runtime no-op-with-DIAGNOSTIC if removed mid-flight). The invocation publishes **`automation_invoked`** (AMD-92) with the parent Run's causal context — the resulting run is cascade-governed by AMD-91 (an automation invoking itself or a cycle through invocations is exactly the chain-membership suppression case). **NO parameter passing** (templating-adjacent scripting creep — §6). Rename mechanics: file/type rename + permits-clause update; zero field consumers exist (empty Tier-2 record, source-verified), so blast radius is the permits clause + any switch listing the old name (sweep-enumerated).

## 3. Downstream Impact

- **Sealed-exhaustiveness consumers:** +1 case (`RepeatAction`); rename swaps one case name (`ActivateSceneAction` → `InvokeAutomationAction`).
- **`ActionExecutor` (M7.2):** repeat loop + invocation dispatch; per-iteration `automation_action_started/completed` events ride the existing per-step trace (iteration index in payload detail — AMD-92 shapes).
- **Pending Command Ledger (M7.3):** reads `confirmation()` on the dispatching action — OPTIMISTIC commands bypass `trackCommand` entirely (the first behavioral consumer of the policy).
- **JPMS:** ZERO module-info change. New enums automation-resident.
- **Doc 07:** §3.9 action table +1 row & rename; §3.11.2 gains the policy gate sentence; §8.2 updated; §16 decision summary row (confirmation-as-policy).

## 4. Implementation Notes

YAML: `confirmation: optimistic|required|best_effort` (CommandAction only — schema rejects it elsewhere), `repeat: {mode:, count:, condition:, for_each:, sequence:, max_iterations:}`, `invoke_automation: {automation: slug}`. Cross-field validation at load (mode↔field requirements). `confirmation()` default-method on the sealed root is legal Java 21 (interfaces in sealed hierarchies carry default methods; the M3.1 default-interface-method lesson applies). Trace: repeat iterations surface as indexed action steps — no new event types (AMD-92's `action_index`/detail fields carry iteration identity).

## 5. Tests (M7 scope)

| Test | Assertion |
|---|---|
| `ActionDefinitionPermitTest` (extended) | permits clause exactly 9; rename complete (no `ActivateSceneAction` symbol); `confirmation()` default = OPTIMISTIC on non-command permits |
| `ConfirmationPolicyGateTest` (M7.3) | OPTIMISTIC → zero ledger entries; REQUIRED → entry always; BEST_EFFORT → entry iff expectation present; Run completion independent of policy (never blocks) |
| `ConfirmationDefaultTest` | YAML-unset confirmation loads as BEST_EFFORT (the named default); timeout precedence capability→config-key pinned |
| `RepeatActionTest` (M7.2) | COUNT exact; WHILE/UNTIL condition gating; FOR_EACH per-entity binding; maxIterations ceiling → FAILED; nested repeat rejected at load |
| `InvokeAutomationTest` (M7.2) | invocation publishes `automation_invoked` with inherited causal context; self-invocation suppressed by AMD-91 chain detection (cross-AMD test, shared with AMD-91 §5) |

## 6. Scope Fences / Deferred (non-goals)

NO per-action timeout field (config-key + capability layering suffices; demand-gated). NO parameter passing on `InvokeAutomationAction`. NO scene primitive, ever (REC-37). NO `InvokeIntegrationAction`/`ParallelAction` promotion (Tier 2 reserved, unchanged — W0 §4.5). **Anti-requirement (REC-162, explicit non-goal):** NO engine-level retry at any `ConfirmationPolicy` value — transports own retry (MQTT QoS, Zigbee APS, Z-Wave Supervision); remediation is ledger-signal-driven ABOVE the engine and lands at M8.2, never inside `ActionExecutor`. **Anti-requirement (REC-155):** no templating in action parameters — `parameters` values are literals, never template strings.

## 7. Invariants and Citations

- **AMD-90-INV-01 (candidate):** Command confirmation is a per-action policy that never blocks Run completion and never triggers engine-level retry; at no policy value does the engine re-issue a command autonomously.
- **AMD-90-INV-02 (candidate):** Every iteration construct is hard-bounded (`maxIterations` ceiling enforced independent of mode); unbounded loops are unrepresentable in the action vocabulary.
- Cites: Doc 07 §3.9 (sequential execution, UnavailablePolicy), §3.11.2 (ledger FSM, per-command `confirmation_timeout_ms`), §9 (`automation.command_pipeline.default_confirmation_timeout_ms` — pre-existing key), §6.2/§6.4 (failure semantics), critical-review 3.5/4.2 (run-independence); AMD-03 (single snapshot per Run — kept inviolate); Doc 01 §4.3 command lifecycle (payload `confirmation_timeout_ms` from `CommandDefinition.default_timeout`); merged disposition §1.1 + §2a-F3; R14-A §3.3 dossier (frenck rationale); R14-B REC-161 (calibration spike), REC-162 (anti-requirement evidence); B2 C8 (PROPOSED-pending — invocation/command stamping rides the envelope seam); AMD-88 §2.2 (`ManualTrigger` counterpart), AMD-91 (cycle governance), AMD-92 (`automation_invoked`), AMD-93 (load validation). Module-info UNCHANGED (embed at AMD-92 §7).

## 8. Implementing WU

**M7.2** (run/action/dispatch — RepeatAction, InvokeAutomationAction, executor wiring); **M7.3** (ledger policy gate); the `CommandAction` sweep rides M7.1's survey with AMD-89's (one sweep, both families). Calibration spike: Nick-paced, before M7.3 pin-freeze.

## 9. Ratification Checklist

- [x] Bundled DOCS-Project review returned 2026-06-12 (RATIFY-AS-IS; R90-1/R90-2 CONFIRMED)
- [x] Nick ratification — 2026-06-12
- [x] AMD-90-INV-01/02 registered (§44) — 2026-06-12
- [x] Navigation-index row added — 2026-06-12
- [x] Doc 07 currency edits applied (amendments-in-force banner) — 2026-06-12
- [ ] Pi-4 confirmation-timeout calibration spike scheduled (Nick) — result folded before M7.3 pin-freeze

## 10. Review Disposition

**DOCS-Project review (2026-06-12): RATIFY-AS-IS — zero edits.** Return §A.6. R90-1 (BEST_EFFORT-as-default) CONFIRMED — the disposition's parenthetical describes BEST_EFFORT's semantics verbatim; OPTIMISTIC-as-default would silently regress Locked §3.11.2's implicit posture. R90-2 (AMD-03 inviolate; state-based WHILE degenerate → load-time WARNING) CONFIRMED — per-iteration re-snapshot is supersession territory. The two-layer default (interface OPTIMISTIC / CommandAction YAML-load BEST_EFFORT mirroring `onUnavailable`) ruled coherent. **RATIFIED by Nick 2026-06-12.** Open residue: the Pi-4 calibration spike (REC-161) remains Nick-paced, pre-M7.3 pin-freeze.
