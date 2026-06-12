<!--
file: design/amendments/AMD-91_RunCausalChain_Supersedes_AMD-04.md
purpose: AMD-91 — RunContext cascadeDepth:int → causalChain:RunCausalChain; chain-membership cycle detection with a distinct diagnostic; FORMALLY SUPERSEDES AMD-04 (REC-36⊕158 per the merged disposition §1.2/§2a-F4).
audience: Nick (ratify), PM, Coder, independent DOCS-Project reviewer
status: RATIFIED 2026-06-12 (Nick) — bundled DOCS review RATIFY-WITH-EDITS per §10, E91-1 folded same-day; mechanics applied 2026-06-12 (invariants §45; nav-index row; AMD-04 SUPERSEDED banner; Doc 07 §3.7.1 + Doc 01 §4.5 notes)
source: Research 4 REC-36 (MODIFY+ACCEPT, v3-verified single-field swap) ⊕ R14-B REC-158 (same-automation cycle detection) via merged disposition §1.2/§2a-F4; W0 §2.4 (re-confirmed at 7c73c91)
baseline: homesynapse-core HEAD `e5ea76f` (substantive `7c73c91`); RunContext 8 fields with `cascadeDepth` (int) at position 7 source-verified; `automation.max_cascade_depth` / `cascade_depth_health_threshold` config keys (Doc 07 §9) source-verified
-->

# AMD-91: `RunCausalChain` — Per-Run Causal Chain, Cycle Detection (supersedes AMD-04)

**Block context:** Fourth of the six-amendment M7 automation block (AMD-88..93). One breaking single-field swap on `RunContext` + one new automation-resident record + a detection-mechanism upgrade. **Formally supersedes AMD-04** (§2.4 disposition ledger below).

## 1. Problem Statement

Cascade governance currently rests on a bare `cascadeDepth: int` (RunContext field 7) plus an in-memory `(correlation_id, automation_id)` suppression set bounded by the active-chain window (Doc 07 §3.7.1; Doc 01 §4.5 — 60-minute window, 10,000-chain cap, evicted entries). Two defects (REC-36/158): the int carries no lineage (a trace cannot show WHICH automations produced depth 5), and windowed/evictable suppression state is non-deterministic at the margins — an evicted entry permits a loop that an identical replay would suppress, violating the spirit of INV-TO-02 (automation determinism). Cross-automation cascade loops are the dominant infinite-loop class in HA/SmartThings/Node-RED field reports (REC-36 evidence); `InvokeAutomationAction` (AMD-90) adds a second cycle-forming edge class.

## 2. Specification

### 2.1 New automation-resident record: `RunCausalChain`

```java
/** Automation-resident; NEVER appears in event payloads (AMD-92 type-residency). */
public record RunCausalChain(List<ChainLink> ancestors) {
    public record ChainLink(RunId runId, AutomationId automationId) {}

    public static RunCausalChain root() { … }            // empty ancestors
    public RunCausalChain extend(ChainLink parent) { … } // append, defensive copy
    public int depth() { … }                             // ancestors.size()
    public boolean containsAutomation(AutomationId id) { … }
}
```

- Root Runs (user/device/time-initiated): `RunCausalChain.root()` — `depth() == 0`, preserving the existing `cascadeDepth = 0` root semantics exactly.
- Cascade Runs: child chain = `parent.causalChain().extend(new ChainLink(parent.runId(), parent.automationId()))` — `depth()` ≡ the old int by construction.
- `depth()` is DERIVED (`ancestors.size()`), not a stored field — one source of truth; REC-36's `(List<RunId> ancestors, int depth)` dual-field shape is adjusted to eliminate the redundancy, and `ChainLink` carries the `AutomationId` the cycle check needs (a bare `RunId` list cannot answer "is automation A already in this chain" without registry lookups). [REVIEW-POINT R91-1: confirm derived-depth + ChainLink over the REC's literal shape.]
- Bounded by construction: the depth governor (§2.3) caps chain length at `max_cascade_depth` (≤ 32), so the record is always small.

### 2.2 BREAKING: `RunContext` field swap (8 fields, position 7)

`cascadeDepth (int)` → **`causalChain (RunCausalChain, non-null)`**. Single-field canonical-constructor swap, exactly the v3-verified change shape. All other 7 fields untouched (`matchedTriggers` stays `List<Integer>` — AMD-88 §2.5's additive-identity rule). Construction-site sweep: rides the block's M7.x survey (at baseline `RunContext` construction exists only in Phase-2 tests/fixtures). No "nullable for legacy traces" provision (REC-36's letter) is needed: traces are events, not persisted `RunContext` instances, and no production Run has ever executed — `causalChain` is non-null from birth.

### 2.3 Governance mechanics (Doc 07 §3.7.1 — amended, not replaced)

1. **Depth limiting (UNCHANGED semantics, new accessor):** the governor compares `causalChain.depth()` against `automation.max_cascade_depth` (config key UNCHANGED — default 8, range 1–32; `cascade_depth_health_threshold` UNCHANGED; the §3.7.1 DEGRADED escalation UNCHANGED). Suppression emits `cascade_depth_exceeded` (payload per AMD-92 — unchanged field set incl. `cascade_depth`, now sourced from `depth()`).
2. **Cycle detection (UPGRADED mechanism, distinct diagnostic):** at Run initiation the RunManager checks `candidateChain.containsAutomation(automationId)` — chain membership REPLACES the in-memory `(correlation_id, automation_id)` suppression set as the suppression AUTHORITY. Detection emits **`cascade_loop_detected`** (the F4 distinct diagnostic — distinct from the depth diagnostic; payload gains the cycle path: `List<AutomationId> chain`, per AMD-92). Deterministic: a function of the chain alone — no window, no eviction, no restart sensitivity; the same event stream + config yields the same suppressions (INV-TO-02 alignment). The §4.5-windowed correlation map REMAINS for trace queries and `causality_depth_warning` (Doc 01 — untouched, adjacent-not-colliding) but no longer participates in suppression decisions.
3. **Natural termination (UNCHANGED):** the State Projection change-detection floor (§3.7.1 / Doc 03 §3.2) stands as the first defense layer.
4. **Chain propagation across the event hop:** a cascade Run's chain is reconstructed from the parent's `automation_triggered` event — which (AMD-92 reshape) carries `cascade_depth` AND the parent chain's automation lineage is recoverable from the correlation chain's `automation_triggered`/`cascade` events; the in-process fast path passes the parent `RunContext` directly. REPLAY rebuild derives chains from the event log (re-derive-never-re-execute, §3.10) — the chain is event-derivable BY DESIGN, which is what makes detection replay-stable. **Reconstruction-source pin (E91-1):** cross-event-hop chain reconstruction reads the **immutable event log** (`EventStore.readByCorrelation`/`readFrom`) or the in-process parent `RunContext` — **NEVER the windowed Doc 01 §4.5 in-memory correlation map** (which remains for trace queries only); otherwise windowed/evictable state would re-enter the suppression decision through the reconstruction path and AMD-91-INV-01 would be breached in fact while honored in letter. `InvokeAutomationAction` invocations extend the chain identically (the `automation_invoked` hop is a chain edge like any cascade hop — AMD-90 §2.3).

### 2.4 AMD-04 supersession ledger (formal disposition of every AMD-04 element)

| AMD-04 element | Disposition here |
|---|---|
| `cascade_depth` counter on each Run, parent+1 inheritance | **CARRIED, re-typed** — `RunCausalChain.depth()`; semantics identical (root 0, child parent+1) |
| Max depth 8, config `automation_engine.max_cascade_depth` (1–32) | **CARRIED as already folded** — Doc 07 §3.7.1/§9 key `automation.max_cascade_depth` (the Doc-07 key name supersedes AMD-04's draft name; unchanged by this AMD) |
| `cascade_depth_exceeded` DIAGNOSTIC + WARNING log + 3-in-60s DEGRADED | **CARRIED unchanged** (§3.7.1; event registered at AMD-92) |
| Duplicate suppression per correlation chain, `cascade_loop_detected` event | **CARRIED, mechanism UPGRADED** — chain-membership replaces the windowed correlation-set; event name kept, payload gains the cycle path (AMD-92) |
| Cascade rate limiting (50/s, queue 100, `cascade_rate_exceeded` event) | **NOT ADOPTED** — never folded into Locked Doc 07 (the §6.7 storm-overload machinery + `max_concurrent`/backpressure own this space); the per-automation eval-rate-limit design space is the parked REC-168 FUTURE-AMD; `cascade_rate_exceeded` is NOT minted |
| Doc 01 §4.4→§4.5 derived `cascade_depth` in the Causal Chain Projection | **CARRIED unchanged** — the §4.5 "(AMD-04)" paragraph stands as the query-side diagnostic view; its label updates to cite this AMD |

`Design_Review_Amendments_v1.md` AMD-04 entry gains a SUPERSEDED-by-AMD-91 banner at ratification; governing text = Doc 07 §3.7.1 (as amended) + this AMD.

## 3. Downstream Impact

- **`RunManager` (M7.2):** initiation path swaps int arithmetic for chain extension + membership check; the in-memory suppression set is DELETED from the design (never built — it was Phase-3-future).
- **AMD-92 coupling:** `cascade_loop_detected` payload reshape (cycle path); `automation_triggered.cascade_depth` sourced from `depth()`.
- **Doc 01 §4.5:** supersession-label edit only (derived view unchanged). `causality_depth_warning` (threshold 50, chain-EVENT count) remains a distinct, coexisting signal — automation-run depth ≤ 32 by config ceiling; the two thresholds never alias.
- **JPMS:** ZERO module-info change (`RunId` automation-resident; `AutomationId` platform).
- **Doc 07:** §3.7.1 mechanism paragraphs amended (suppression-set paragraph replaced by chain-membership); §8.2 `RunContext` row + `RunCausalChain` row.

## 4. Implementation Notes

`ChainLink` is a nested record (automation-resident, never serialized into payloads — flattened projections only per AMD-92). Defensive `List.copyOf()` in the compact constructor; `extend` allocates (chains are ≤ 32 entries — allocation is trivial). Equality is value-based (records) — useful in tests. The RunManager's dedup map (C2 `(automation_id, triggering_event_id)`) is UNTOUCHED — dedup and cycle suppression are different mechanisms and stay separate.

## 5. Tests (M7 scope)

| Test | Assertion |
|---|---|
| `RunCausalChainTest` | root depth 0; extend appends + depth increments; containsAutomation true/false; immutability |
| `CascadeDepthGovernorTest` (M7.2) | depth > max suppresses + emits `cascade_depth_exceeded` with `depth()` value; config range pins (default 8, 1–32) |
| `CycleDetectionTest` (M7.2) | A→B→A suppressed at the SECOND A with `cascade_loop_detected` carrying the chain path; A→B→C all distinct proceeds; determinism — identical stream replayed yields identical suppressions (no window sensitivity) |
| `InvokeCycleTest` (shared w/ AMD-90 §5) | self-`InvokeAutomationAction` suppressed via chain membership |
| `RunContext` sweep | every baseline construction site updated to `causalChain` (survey-enumerated) |

## 6. Scope Fences / Deferred (non-goals)

NO rate limiting (AMD-04's clause NOT adopted — REC-168 parks the redesigned form; §6.7 owns storm response). NO `cascade_rate_exceeded` event. NO change to dedup (C2), concurrency modes (§3.6), or the Doc 01 §4.5 projection mechanics. NO chain persistence structure (chains derive from events — re-derive-never-re-execute). NO cross-correlation (multi-chain) loop analysis (Tier-2 5.3 territory). **Anti-requirement (REC-162):** suppression never triggers retry/re-issue — a suppressed Run is terminal-absent, visible only via its diagnostic.

## 7. Invariants and Citations

- **AMD-91-INV-01 (candidate):** Cascade-cycle suppression is a deterministic function of the Run's causal chain and configuration alone — no windowed, evictable, or restart-sensitive state participates in a suppression decision (INV-TO-02 corollary; INV-PR-03 boundedness preserved via the depth ceiling).
- **AMD-91-INV-02 (candidate):** `RunCausalChain` is automation-internal — it never crosses the event boundary unflattened (AMD-92-INV-01's specific instance for this type).
- Cites: Doc 07 §3.7.1 (cascade governance — amended), §3.10 (re-derive-never-re-execute), §9 (config keys, unchanged); Doc 01 §4.5 (causal chain projection, `causality_depth_warning` adjacency); AMD-04 (superseded — ledger §2.4); AMD-03 (snapshot rule untouched); merged disposition §1.2/§2a-F4; R14-B REC-158; W0 §2.4; AMD-90 §2.3 (invocation edges), AMD-92 (diagnostic payloads + residency). Module-info UNCHANGED (embed at AMD-92 §7).

## 8. Implementing WU

**M7.2** (run/action/dispatch path — RunManager governance is an M7.2 deliverable).

## 9. Ratification Checklist

- [x] Bundled DOCS-Project review returned 2026-06-12 (RATIFY-WITH-EDITS; R91-1 CONFIRMED; §2.4 ledger AUDITED, all six rows); E91-1 folded
- [x] Nick ratification — 2026-06-12
- [x] AMD-91-INV-01/02 registered (§45) — 2026-06-12
- [x] Navigation-index row added — 2026-06-12
- [x] AMD-04 SUPERSEDED banner applied; Doc 07 §3.7.1 note + Doc 01 §4.5 label applied — 2026-06-12
- [ ] M7.2 survey enumerates `RunContext` construction sites before issue

## 10. Review Disposition

**DOCS-Project review (2026-06-12): RATIFY-WITH-EDITS — E91-1 (required, the reconstruction-source pin) FOLDED by the PM 2026-06-12 into §2.3.4.** Return §A.7. R91-1 (derived `depth()` + `ChainLink` over REC-36's literal shape) CONFIRMED — the bare-`RunId`-list alternative re-introduces registry lookups into the suppression decision. **The §2.4 AMD-04 supersession ledger AUDITED element-by-element, all six rows VERIFIED — incl. rate-limiting NOT-ADOPTED** (Locked §3.7.1 enumerates exactly three mechanisms; §6.7 + parked REC-168 own the space). INV-TO-02/REPLAY determinism test PASS. The §D chain-narrowing note (intentional deep re-fire now deterministically suppressed within a chain) rides the M7.2 instruction's authoring guidance. **RATIFIED by Nick 2026-06-12.**
