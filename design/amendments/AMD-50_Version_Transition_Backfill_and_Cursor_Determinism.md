# AMD-50: Version-Transition Reconciliation Backfill + Cursor Determinism

**Amendment ID:** AMD-50
**Tier:** Tier-1 (architectural invariant)
**Status:** RATIFIED
**Date drafted:** 2026-05-29
**Date applied:** 2026-05-29
**Revision (Nick review, 2026-05-29):** resolved the N→M attribute-precedence hole — committed to **current-rule-authoritative supersession** (§2.2), so a rule change takes effect on historical data instead of silently no-op'ing (the blocking issue). Plus: removed `Clock` from `DerivationContext` (§2.4, airtight determinism); clarified the rebuild-equivalence test to compare attribute *values* (§5 #2); scoped the backfill apply to `attributes` only (§2.3); added AMD-50-INV-04 gate–checkpoint coherence (§4/§7).
**Target documents:** Doc 03 (State Store & State Projection)
**Target sections:** AMD-41 §3.2.4 (Reconciliation pass) — refined; Doc 03 §3.2 (State Projection runtime model)
**Refines:** AMD-41 §3.2.4 (reconciliation/replay-from-zero); INV-PROJ-01 (projection determinism); INV-PROJ-04 (checkpoint-position monotonicity); INV-WRITER-01 (single-writer, from AMD-26)
**Source:** Research 9 (projection rebuild/versioning/backfill) REC-76/REC-77/REC-79, folded into PLAN-M4-CONSOLIDATED-v2 §4.5; `2026-05-29_M4_Plan_Independent_Verification_Report.md` §D-Q3/§G (the backfill↔AMD-41 governance gap — the VR's "highest-value finding"); P2 AMD-allocation decision (`context/decisions/2026-05-29_P2_AMD_Renumbering_Decision.md`, ratified 2026-05-29 — AMD-50, §8.6 general-transition requirement).
**Scope:** Workstream A. Authorises the mechanism; implemented by **M4.0b-2** (the 1→2 transition) and reused by **M4.0b-3** (the 2→3 transition). This amendment authors **no code**.
**AMD-allocation note:** Authored under the ratified P2 scheme (projection block 50–52). AMD-50 is the projection-rebuild/backfill/cursor amendment; AMD-51 (typed comparator) and AMD-52 (typed `StateChangedEvent`) are separate.

---

## 1. Problem

Shipping a real derivation rule is a **derivation-logic change**: it bumps `projectionVersion`, which (per AMD-41 §3.2.4) forces a reconciliation pass — discard the checkpoint, clear in-memory state, replay from `position = 0` under `SubscriberMode.REPLAY`. Three problems arise that the ratified §3.2.4 does not address.

### 1.1 A plain replay-from-zero leaves historical attributes empty

`StateProjection.applyToState` writes an entity's `attributes` **only** on inbound `state_changed`; inbound `state_reported` advances `stateVersion`/timestamps but leaves `attributes` untouched (`StateProjection.java` applyToState — `state_reported` branch). The only producer of `state_changed` is the `DerivationRule`. Before the first real rule ships, the event log contains **zero** `state_changed` events. Therefore a reconciliation replay of the pre-transition log rebuilds timestamps and `stateVersion` but reconstructs **no** historical `attributes` — every entity's canonical attribute map is empty until *new* `state_reported` arrive post-transition. The historical state is materially incomplete on the very upgrade that was supposed to make state real.

The natural fix — re-derive during the reconciliation replay and apply the derived `state_changed` to in-memory state — is **forbidden by AMD-41 §3.2.4 step 3**, which states the projection "emits derived events only after exiting REPLAY," and is structurally absent from the implemented REPLAY path: `processBatch`'s PUBLISH phase applies derived drafts to state **only** when `mode == SubscriberMode.LIVE` (`StateProjection.java` processBatch — `if (mode == SubscriberMode.LIVE)` block); under REPLAY the derived drafts are buffered and then discarded. So historical attribute reconstruction during reconciliation is currently both un-implemented and un-authorised.

### 1.2 A naive backfill double-counts the idempotency cursor

`EntityState.stateVersion` "advances on every processed event" and is the documented per-entity **idempotency cursor**. If a backfill applies a re-derived `state_changed` to state **in addition to** the inbound `state_reported` that caused it, the entity's `stateVersion` advances twice for one source event. Worse, on any *later* replay (after the transition, when the log already contains the previously-published `state_changed` events) the logged `state_changed` replays as inbound and is applied (+1); re-deriving-and-applying it again would double-count. The backfill must run **once**, on the transition replay only, and must not perturb the cursor — otherwise `stateVersion` becomes path-dependent and the materialized view is non-deterministic across rebuilds.

### 1.3 §3.2.4 is silent on the replay-time state-mutation path and its provenance

AMD-41 §3.2.4 contemplates only "clear, replay-from-zero, record `reconciledAt`, then go LIVE." It does not describe (a) a replay-time, in-memory, **non-emitting** state-mutation path, (b) the provenance gate that confines it to a genuine version transition, or (c) the cursor-determinism rule that keeps `stateVersion` a function of the log. M4.0a already populates the reconciliation metadata fields the gate needs (`reconciledFromVersion`/`reconciledToVersion`/`reconciledAt`, written in `StateProjection.initialize()`'s reconciliation branch — OR-M3-13), but the **discipline** governing their use in a backfill is unwritten. This amendment writes it.

---

## 2. Change Specification — refine AMD-41 §3.2.4

AMD-41 §3.2.4 steps 1, 2, 4 are unchanged. **Step 3 is replaced** and three sub-clauses are added. The discipline is defined **generally for any `projectionVersion` increment N→M (N < M)** — never hardcoded to 1→2 (P2 §8.6), so a later derivation-logic change (e.g. M4.0b-3's typed change-detect, 2→3) reuses this amendment without a fresh one.

### §2.1 — Reconciliation backfill (replaces AMD-41 §3.2.4 step 3)

During a version-transition reconciliation replay (entered when `loadedProjectionVersion()` (N) ≠ code `projectionVersion` (M), the escape hatch inactive — `StateProjection.initialize()` reconciliation branch), the projection re-executes the `DerivationRule` for every replayed inbound event (the `SelfProducedFilter` is bypassed in REPLAY, AMD-41 §3.2.2) and **applies the re-derived `state_changed` drafts to in-memory state** as part of the rebuild.

This is a **replay-time, in-memory, non-emitting state-mutation path**. It does **not** call `EventPublisher.publish()` and does **not** write any event to the log or to persistence: the single-writer / no-writer-in-REPLAY invariant (INV-WRITER-01) is preserved in its letter — no derived events are emitted before the projection exits REPLAY. The backfill mutates only the projection's own in-memory `StateStore` snapshot, which is exactly what a checkpoint write later persists.

The refined step 3 reads: *"During reconciliation, the self-produced filter is bypassed (REPLAY mode). The projection re-derives deterministically and, under the provenance gate of §2.2, applies re-derived `state_changed` drafts to its in-memory state so historical attributes reconstruct from the `state_reported` log. No derived events are published or written until the projection exits REPLAY; the writer is not invoked during the pass."*

### §2.2 — Provenance gate (REC-77) — reconciliation-scoped, not version-boundary-alone

Backfill application is gated on **provenance**, not merely on a version number. The gate is active **iff** the projection entered the §3.2.4 reconciliation branch for the current rebuild (a genuine N→M version mismatch with the escape hatch inactive). Concretely it binds to the reconciliation flag set when `reconciledFromVersion`/`reconciledToVersion` are populated in `initialize()`.

- **While the gate is active** (the reconciliation replay, from `position = 0` until `onCaughtUp()`): re-derived `state_changed` drafts ARE applied to in-memory state (non-emitting).
- **When the gate is inactive** — i.e. any rebuild that is NOT a version-transition reconciliation: a normal restart at the same `projectionVersion` (no mismatch → no reconciliation), OR a steady-state catch-up — re-derived drafts are **discarded for state application**. The **logged `state_changed`** events (replaying as inbound) are the sole source of historical `attributes`. The rule still re-executes (determinism, §2.4) but its drafts do not touch state.
- The gate **deactivates** when the projection exits REPLAY (`onCaughtUp()` → LIVE). From LIVE onward, derivation publishes normally (the LIVE seam) and the backfill path is dormant until the next version transition.

**Attribute precedence under an active gate (supersession) — the N→M rule.** When the gate is active, the **re-derived current-rule drafts are authoritative for `attributes`**. A logged *prior-version* `state_changed` encountered during the reconciliation replay is a log event — it advances `stateVersion` (§2.3 / AMD-50-INV-01) — but its attribute write is **suppressed**: it does not set `attributes` or `lastChanged`. A version-transition reconciliation therefore rebuilds the materialized attribute map **purely by re-running the current rule over the `state_reported` history**; prior-version derived events become cursor-only vestiges of the rule they were produced under. This is what makes a derivation-logic change actually take effect on historical data: without supersession, a 2→3 upgrade would leave historical entities carrying the rule-2 values (a stale logged `state_changed` would win the interleaving — see §3.3). Outside the gate, logged `state_changed` is authoritative for `attributes` as normal (the inactive bullet above), because there is no re-derivation competing with it.

Rationale: version-boundary gating answers *"which replay"* but not *"which events are historical-derived vs. already-logged."* After a transition completes, the log contains the published `state_changed`; a future (gate-inactive) replay must apply those as inbound and must NOT also re-derive-and-apply, or it double-counts (§1.2). During a transition (gate active), the inverse holds: the current rule's re-derivation supersedes the now-stale prior-version `state_changed` for attribute values. Provenance — "is this the one-shot reconciliation rebuild?" — is the discriminator that selects between these two regimes.

### §2.3 — Cursor as a function of log position (REC-76) — AMD-50-INV-01

`stateVersion` is defined as **a function of log position**: it advances by exactly `+1` per processed **log event** for the entity. A reconciliation-scoped backfill draft is **not a log event** and carries **no** increment — the source `state_reported` that triggered the derivation owns the single `+1`; a logged prior-version `state_changed` (which *is* a log event) owns its own `+1` even while its attribute write is suppressed (§2.2). The backfill applies the derived attribute value to the entity's `attributes` map **without** advancing `stateVersion` a second time.

**The backfill apply touches the `attributes` map only** (and the associated `lastChanged`). It must **not** be routed through the full inbound-`state_changed` apply branch and must not re-stamp `lastReported`/`lastUpdated` or re-increment `stateVersion`: those, and the single per-event `+1`, are owned by the triggering `state_reported` (and, for logged prior-version `state_changed` during the gate, the cursor `+1` is owned by that log event under §2.2's suppression rule). Implementers should apply the re-derived value through a narrow attribute-write path, not by re-dispatching a synthetic `state_changed` through `applyToState`'s normal branch.

**Invariant (AMD-50-INV-01, cursor determinism):** for a fixed event log and a fixed `projectionVersion`, an entity's `stateVersion` is identical across any number of rebuilds, regardless of whether a given rebuild was a from-scratch replay, a reconciliation backfill, or a steady-state catch-up. `stateVersion` is path-independent. This refines INV-PROJ-04 (checkpoint-position monotonicity) at the per-entity cursor granularity.

### §2.4 — Determinism contract (REC-79) — AMD-50-INV-03

Because the rule is re-executed during reconciliation, its output must be **identical to the original execution** or the rebuild diverges from the live history. The `DerivationRule` is therefore normatively deterministic under re-execution (elevating INV-PROJ-01 to a governance contract for the production rule):

- MUST be a pure function of `(priorState, envelope)`.
- MUST NOT read any registry, any other projection, any I/O, or any source of randomness.
- **`DerivationContext` is reduced to `(priorState, envelope)` — the injected `Clock` is removed.** Derived `EventDraft.eventTime` inherits from the causing envelope (never `Instant.now()`), and ingest-time stamping is the publisher's job, so the rule has no legitimate use for a clock. Removing it makes the determinism contract airtight **by construction** — there is no clock value to branch on, and no carve-out is needed. (The M4.0b-1 production rule already does not read the clock, so this is a non-breaking narrowing folded into M4.0b-2: the two `StateProjection` `DerivationContext` construction sites drop the `clock` argument.)

A test-only "sandbox" `DerivationContext` that throws on any registry/IO access is the recommended enforcement mechanism (REC-79); with the clock removed there is no clock carve-out to reason about.

### §2.5 — Generality: any N→M transition

The §2.1–§2.4 discipline is defined for **any** `projectionVersion` increment, not the 1→2 case specifically. The provenance gate keys off "a reconciliation is in progress" (any N≠M with the escape hatch inactive); the cursor rule (§2.3) is stated independent of the version numbers; and — critically — the **supersession rule (§2.2)** is what makes the discipline correct when the log *already contains* prior-version `state_changed` (the N>1 case): the current rule's re-derivation owns the attribute values and the stale prior-version derived events become cursor-only. Without supersession the general claim would be false (the 1→2 case happens to work only because its pre-transition log has no `state_changed`). Consequently a future derivation-logic change that bumps 2→3 (e.g. M4.0b-3's typed change-detect) is governed by **this amendment** and needs no new §3.2.4 refinement. Each transition runs its own one-shot reconciliation backfill; once persisted-version equals code-version again, the gate is inactive on subsequent restarts.

---

## 3. Worked scenarios

**3.1 — The 1→2 transition (M4.0b-2).** First boot after the production rule ships: `loadedProjectionVersion()` = 1, code `projectionVersion` = 2 → reconciliation. State cleared, cursor 0, `reconciledFromVersion=1`/`reconciledToVersion=2` set (M4.0a). The pre-2 log holds `state_reported` only (zero `state_changed`). During the replay, the rule re-derives a `state_changed` for each `state_reported` whose value changed; under the active provenance gate the derived value is applied to `attributes` **without** a second `stateVersion` increment. At `onCaughtUp()` the projection goes LIVE with historical attributes reconstructed; the gate deactivates. A checkpoint persists version 2.

**3.2 — A normal restart at version 2 (gate inactive).** `loadedProjectionVersion()` = 2 = code version → **no** reconciliation, **no** backfill. The persisted snapshot already carries the reconstructed attributes; ordinary catch-up applies any new logged `state_changed` as inbound (+1 each). No double-application.

**3.3 — The 2→3 transition (M4.0b-3), generality under supersession.** A typed-change-detect rule (AMD-51 epsilon comparator) bumps to 3: `loadedProjectionVersion()` = 2 ≠ 3 → reconciliation, gate active. The log now contains prior-version `state_changed`. Concrete case: under version 2 (string compare) a sensor reported `temp = 20.0` then `temp = 20.0000001`, and version 2 logged a `state_changed(20.0 → 20.0000001)` because the strings differ; version 3 (epsilon compare) does **not** treat that delta as a change. During the reconciliation replay, under §2.2 supersession: the `state_reported` events replay and the **version-3 rule re-derives** — it sets `temp = 20.0` on the first report and produces **no** draft for the within-epsilon second report, so the attribute stays `20.0`. The logged version-2 `state_changed(… → 20.0000001)` advances `stateVersion` (it is a log event) but its attribute write is **suppressed**. Final materialized value: **`20.0`** — the version-3 rule's correct output; the spurious change is gone. (Under the naïve "apply both" reading the stale `20.0000001` would have won the interleaving and the upgrade would have been a no-op on historical data — precisely the hole this revision closes.) `stateVersion` equals the count of processed log events, identical to the version-2 snapshot's, so AMD-50-INV-01 holds. No new amendment required — the same §2.1–§2.5 discipline governs the 2→3 transition.

---

## 4. New invariants

- **AMD-50-INV-01 (cursor determinism).** For a fixed log and fixed `projectionVersion`, every entity's `stateVersion` is identical across all rebuild paths; backfill drafts carry no increment. (Refines INV-PROJ-04.)
- **AMD-50-INV-02 (single-application provenance).** A reconciliation-scoped re-derived `state_changed` draft is applied to in-memory state **only** while the §2.2 provenance gate is active (a genuine version-transition reconciliation replay) and is **never** published or written to the log. Outside that window, logged `state_changed` is the sole source of historical attributes. (Refines AMD-41 §3.2.4 + INV-WRITER-01.)
- **AMD-50-INV-03 (rebuild determinism of the rule).** The production `DerivationRule` is deterministic under re-execution per §2.4 — a pure function of `(priorState, envelope)` with no clock, registry, I/O, or randomness. (Elevates INV-PROJ-01.)
- **AMD-50-INV-04 (gate–checkpoint coherence).** A replay from `position = 0` occurs **only** under an active reconciliation gate. Equivalently: the gate is inactive only when resuming from a checkpoint whose persisted version equals the code version. No code path may rebuild in-memory state from position 0 with `loadedProjectionVersion() == projectionVersion` and the gate off — the reconstructed attributes are reproducible **only** through the gated transition path (under supersession, §2.2), so a from-zero rebuild with the gate inactive would apply stale prior-version `state_changed` (or, on the first transition, leave attributes empty). The escape-hatch path (`allow_stale_snapshots`) resumes from the stale snapshot — it does **not** replay from zero — and must never resume from an empty/corrupt snapshot at a matching version without forcing a reconciliation.

---

## 5. Test requirements (REC-81; verification gate for M4.0b-2)

1. **Rebuild idempotency:** `rebuild(log) == rebuild(rebuild(log))` — byte-identical materialized `attributes` per entity. (Already partially landed in M4.0b-1's `rebuildIdempotency_...` test, which excluded the backfill assertions; M4.0b-2 adds them.)
2. **Backfill ≡ native (attribute *values*):** after an N→M reconciliation, each entity's **attribute values** equal those of a fresh log already containing the equivalent current-rule `state_changed`. Assert on `attributes` **values only** — do **not** compare `stateVersion` to the native log, which carries extra `state_changed` log events that legitimately raise its cursor. Separately assert `stateVersion` equals the count of processed log events in the *reconciliation* log (for the 1→2 case, the `state_reported` count, since the pre-transition log holds no derived `state_changed`), with no double-increment (AMD-50-INV-01).
3. **One-shot:** a second restart at code-version M finds persisted-version M → **no** reconciliation → the backfill path does **not** run (AMD-50-INV-02, gate inactive).
4. **Steady-state safety:** on a post-transition (gate-inactive) replay, logged `state_changed` applies once as inbound; re-derived drafts are discarded for state application (no double-count).
5. **Generality + supersession (the 2→3 case, scenario 3.3):** an N→M reconciliation over a log that already contains a *spurious* prior-version `state_changed` reconstructs the **current** rule's value (the spurious change suppressed, not applied), and `stateVersion` matches the prior snapshot's. This is the test that proves a rule upgrade takes effect on historical data; it is the regression guard for the blocking issue this revision fixes.
6. **Determinism (REC-79):** the rule produces identical drafts across repeated invocations on the same `(priorState, envelope)`. With the clock removed from `DerivationContext` (§2.4) there is no clock-shift case and no sandbox clock carve-out; a registry/IO-forbidding sandbox `DerivationContext` confirms no disallowed access (AMD-50-INV-03).

Extend the existing `StateProjectionContractTest` + `ReconciliationTest` (do not greenfield).

---

## 6. Scope — what this amendment does NOT do

- It does **not** bump `projectionVersion`. The 1→2 bump is implemented by **M4.0b-2**; this amendment only authorises the mechanism the bump triggers.
- It does **not** introduce typed comparison, `QuantityValue`/`ArrayValue`, or a typed `StateChangedEvent` — those are AMD-47 (types) / AMD-51 (comparator) / AMD-52 (payload), implemented in M4.B3 / M4.0b-3.
- It does **not** weaken the single-writer or no-writer-in-REPLAY invariants: the backfill mutates only in-memory projection state and emits nothing before LIVE.
- It does **not** alter the escape hatch (`homesynapse.projection.allow_stale_snapshots`) or the `SqliteSnapshotStore` dormancy (AMD-41 §3.2.3 — gated separately by the REC-80 replay-duration metric).

---

## 7. Source anchors (confirm against source before implementation — STOP-on-Mismatch)

- `StateProjection.initialize()` reconciliation branch — reads `checkpointSource.loadedProjectionVersion()` (NOT the `CheckpointRecord.projectionVersion()` sentinel = 1), compares to code `projectionVersion`, on mismatch (escape hatch off) `stateStore.clear()` + `cursorPosition = 0L` and populates `reconciledFromVersion`/`reconciledToVersion`/`reconciledAt`. **This is the gate's binding point (§2.2).**
- `StateProjection.processBatch()` PUBLISH phase — derived drafts applied to state only inside the `mode == SubscriberMode.LIVE` block; under REPLAY they are buffered and discarded today. **This is the path §2.1 refines** (apply-during-reconciliation under the gate).
- `StateProjection.onEvent()` — the active production REPLAY delivery path (the bus's `ReplayDriver` delivers replayed events via `supervisor.deliver` → `onEvent`); its publish/apply of derived is likewise `mode == LIVE`-gated. The backfill apply must be added to **both** the `onEvent` and `processBatch` derivation paths.
- `EntityState.stateVersion` — the per-entity idempotency cursor that AMD-50-INV-01 constrains; `EntityState.attributes` / `lastChanged` — the only fields the backfill apply may touch (§2.3).
- `StateProjection.applyToState` — the inbound-`state_changed` branch sets `attributes` + `lastChanged`; §2.2's supersession requires that, while the gate is active, a logged prior-version `state_changed` advance `stateVersion` (cursor) but skip the attribute/`lastChanged` write. Confirm the branch and add the gate-conditional suppression.
- `DerivationRule` / `DerivationContext` — the determinism contract surface (§2.4). **§2.4 removes `clock` from `DerivationContext`** (currently the record `(priorState, envelope, clock)` → `(priorState, envelope)`); update the two `StateProjection` construction sites and the M4.0b-1 `ProductionDerivationRule` signature use (the rule already ignores the clock).
- **Gate–checkpoint coherence (AMD-50-INV-04, STOP-gate):** confirm the **only** replay-from-zero path is the `initialize()` reconciliation branch (version mismatch, escape hatch off). Verify no other path — including escape-hatch snapshot acceptance — rebuilds from position 0 with `loadedProjectionVersion() == projectionVersion`.
- The reconciliation-metadata fields (`reconciledAt`/`reconciledFromVersion`/`reconciledToVersion`) in `CheckpointData`/`CheckpointSerializer`, **populated since M4.0a** (`a441fdf`) — the gate's binding point (§2.2).

---

## 8. Implementing work units

- **M4.0b-2** — implements §2.1–§2.4 for the **1→2** transition on the existing **string** change-detect rule (the M4.0b-1 production rule). Bumps `projectionVersion` 1→2. This is the first consumer of AMD-50 and is gated only on AMD-50 + M4.0b-1 (P2 §3.1).
- **M4.0b-3** — reuses AMD-50 for the **2→3** transition when the typed change-detect (AMD-51/52) ships; no new §3.2.4 refinement (§2.5). Gated on M4.B3.

---

## 9. Ratification checklist (for Nick)

- [ ] §2.1's replay-time in-memory backfill is acceptable as a refinement of AMD-41 §3.2.4 step 3 (it emits nothing before LIVE; single-writer preserved).
- [ ] The provenance gate (§2.2) is the right discriminator (vs. version-boundary-alone).
- [ ] **§2.2's supersession rule is the correct N→M semantic** — during an active gate, re-derived current-rule drafts are authoritative for `attributes`; logged prior-version `state_changed` advance `stateVersion` but are suppressed for attribute writes. (This is the fix for the blocking review issue: without it, a 2→3 upgrade no-ops on historical data.)
- [ ] AMD-50-INV-01 (cursor as f(log position); backfill drafts carry no increment) and **AMD-50-INV-04** (gate–checkpoint coherence; no from-zero rebuild with matching version) are correct.
- [ ] §2.4 removing `Clock` from `DerivationContext` is acceptable (the rule has no envelope-independent stamping need).
- [ ] The general N→M framing (§2.5) is intended, so M4.0b-3's 2→3 rides this amendment.
- [ ] On ratification: set Status → RATIFIED + Date applied; the PM logs AMD-50 in the KB ledger and updates `pm-handoff` so M4.0b-2 may be briefed.
