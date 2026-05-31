<!--
file: design/HomeSynapse_Core_M4_Implementation_Plan_PLAN-M4-CONSOLIDATED-v2.md
purpose: Finalized M4 implementation plan. Supersedes DRAFT v1 (…PLAN-M4-CONSOLIDATED.md). Applies the source-grounded corrections and Research 9 + Research 10 fold-ins from the independent verification pass.
audience: PM, Coder, Nick
update-cadence: per-milestone
status: FINAL-CANDIDATE v2 (source-verified 2026-05-29; Research 9 + 10 integrated; §3 propagated to the P2 re-scope + M4.0a/b-1/b-2 completion 2026-05-29). **P2 RATIFIED.** Pending: P3 Research-6 NQ-1..6, P4 doc-currency (gates M4.B3), and the Research-9/10 Nick-calls in §10.
supersedes: HomeSynapse_Core_M4_Implementation_Plan_PLAN-M4-CONSOLIDATED.md (DRAFT v1, 2026-05-28)
evidence-base: 2026-05-29_M4_Plan_Independent_Verification_Report.md (every v2 change traces to a verdict there)
last-verified: 2026-05-31 against M4.B-S1 closeout (commit `e73e199`); Workstream A COMPLETE (through M4.0b-5 `c99b425`), Workstream B Stage 1 DONE (`e73e199`). See the 2026-05-31 §3 currency note.
-->

# HomeSynapse Core — M4 Implementation Plan (PLAN-M4-CONSOLIDATED **v2**, FINAL CANDIDATE)

> **§3 currency note (2026-05-31, propagated at M4.B-S1 closeout — supersedes the boundaries below for status):** Workstream A is now **COMPLETE** end-to-end: **M4.B3** (AMD-47 AttributeValue expansion + upcaster) DONE `60b4185`; **M4.0b-3** (AMD-51 typed comparator) DONE `98f705b`; **M4.0b-4a** (AttributeValue → `com.homesynapse.value` leaf, AMD-52 §11 erratum — breaks the event↔device JPMS cycle) DONE `971cfa1`; **M4.0b-4b** (AMD-52 typed `StateChangedEvent` payload + codec + Path-B gate; `projectionVersion` 3→4) DONE `72596cb` — this is where the §3-row "M4.0b-3 typed `StateChangedEvent`" REC-91 work actually landed (split into 4a/4b); **M4.0b-5** (AMD-53 timestamp-model unifier — event-time activity-timestamp materialization; `projectionVersion` 4→5; a new WU not in the original table) DONE `c99b425`. **Workstream B: M4.B6 → renumbered `M4.B-S1`; AMD-44 Stage 1 (Floor/`FloorId`/Area + `FloorRegistry`/`AreaRegistry` + `Set<HardwareIdentifier>`) DONE `e73e199`** (no `projectionVersion`/`module-info`/Gradle change); **Stage 2 = EntityRole, RATIFIED pending impl.** Workstream C remains gated on Research 6 NQ-1..6 (now surfaced — `nexsys-hivemind/context/planning/2026-05-31_Workstream-C_gate-status.md`) + post-B device model + P4 Doc-05 currency. AMD-numbering: AMD-53 was consumed by the unifier, so the integration block re-bases to **54+** (`context/decisions/2026-05-29_P2_AMD_Renumbering_Decision.md` §3). The per-WU prose below predates this chain; treat **this note** as authoritative on status.
>
> **§3 currency note (2026-05-29, propagated at M4.0b-2 closeout):** P2 (RATIFIED) re-scoped **M4.0b-2** to *AMD-50 backfill + `projectionVersion` 1→2 on the existing string change-detect* (no M4.B3 dependency), and split the typed comparator (AMD-51) + typed `StateChangedEvent` (AMD-52, formerly REC-91 inside M4.B3) into a new **M4.0b-3** gated on M4.B3. Workstream A is now COMPLETE through M4.0b-2 (`a441fdf` / `cf1a97e` / `7610296`). §3, the sequencing notes, and the §11 critical-path diagram reflect this; the narrative §4.x prose below predates the split and still reads M4.0b-2-as-typed in places — treat §3 + §11 as authoritative on WU boundaries.

## 0. What changed from v1, and provenance

v1 was a source-grounded draft. v2 is the **finalized** plan after (a) an independent line-by-line verification against the M3.7-closeout source tree, and (b) folding in Research 9 (projection rebuild/versioning/backfill) and Research 10 (typed change-detection). Every change below is justified in `2026-05-29_M4_Plan_Independent_Verification_Report.md` (cited as **[VR §x]**); nothing here is a silent rewrite.

**Changelog v1 → v2 (each item has source evidence in the VR):**

1. **Verified baseline holds exactly** [VR §A.1-8]: 20 non-spike modules, **1,422** test methods (`@Test` 1,402 + `@ParameterizedTest` 20), **724** `.java` files, **10** `*ContractTest` testFixtures suites, `EventStoreContractTest` = 27. `Entity` = 11 fields (enforced by `EntityTest.exactlyElevenFields()`), `EntityState` = 9, `AttributeValue` = 5 permits, `Capability` = 16 permits, `Availability` = {AVAILABLE, UNAVAILABLE, UNKNOWN}. AMD-44 = "RATIFIED (pending implementation)", AMD-45 = DRAFT, watermark = **AMD-45**.
2. **Fixed dangling cross-references** [VR §B I-1]: v1 §3 pointed to non-existent §5.1/§5.2/§5.3; the content is in §4.1/§4.2/§4.5 (fixed throughout v2).
3. **De-poison: AMD-45:75 phantom** [VR §B F-A]: the DRAFT `AMD-45` body still says `MinimalDerivationRule`; it must be corrected to `MINIMAL_DERIVATION_RULE` before AMD-45 ratification (added to P1).
4. **Stale source Javadoc** [VR §B F-B]: `HomeSynapseCore` Javadoc says automation is "M5 scope"; it is M7/M8 (M5 = Platform API). M4.0a's Javadoc fix now corrects both this and the "state map update" imprecision.
5. **Workstream C corrections** [VR §B F-C/F-D, §D-Q2]: REC-50 is an **ADD** of `isolationLevel` (+ `IsolationLevel` enum) — there is **no** existing `isolationHint` field to rename. `IntegrationContext` is **10** fields today; NQ-1's aggregator brings it to 11 (vs 12 field-by-field).
6. **Reconciliation mechanics refined** [VR §A.1-5, §G.0]: the 1→2 trigger compares `StateCheckpointSource.loadedProjectionVersion()` vs the code version — **not** `CheckpointRecord.projectionVersion()` (a sentinel hardcoded to 1 in both `ViewCheckpointStore` impls). Escape hatch literal = `homesynapse.projection.allow_stale_snapshots`. Reconciliation metadata fields (`reconciledAt`/`reconciledFromVersion`/`reconciledToVersion`) **already exist** in `CheckpointData` + `CheckpointSerializer` but are written `null` today; M4.0a wires their population.
7. **Research 9 folded in** [VR §G/§H]: REC-76..82 — cursor determinism, backfill provenance gating, upcast-before-rule, `DerivationRule` determinism contract, replay-duration metric, replay-invariant/golden-master tests, `CheckpointRecord.projectionVersion()` guard. The one-shot backfill **requires an amendment refining AMD-41 §3.2.4** (it adds a replay-time in-memory state-mutation path).
8. **Research 10 folded in** [VR §I/§J]: REC-90..94 — typed per-permit comparator, **typed `StateChangedEvent` payload + typed materialized store (breaking)**, deferred per-attribute deadband, hand-rolled `QuantityValue` unit normalization, and a coherent float policy. REC-91 resolves the v1-era open question of how typed comparison reaches the store.
9. **AMD allocation gap surfaced** [VR §H, §J, I-2/I-3]: §7's renumbering had no block for Workstream-A projection amendments, under-allocated device by one (SemanticTag unnumbered), and collides with Research 6's pre-baked AMD-53..63. v2 §7 proposes a corrected allocation, still pending P2.

**Anti-transcription rule (unchanged, reinforced):** literal type names, line numbers, AMD numbers, and the `projectionVersion` constant in this document are *pointers, not authority*. Confirm each against source via grep before it enters a coding instruction or amendment. Items not re-grepped firsthand carry **[grep-confirm]**. (Even cap-limited greps are a transcription hazard — see VR §I.0.)

---

## 1. What M4 is — and what it is not

**M4 scope (Nick, 2026-05-28: Canonical; confirmed against `phase-3-milestone-backlog.md:108` [VR §A.2]).** M4 is the foundation milestone that makes state materialization real and freezes the cross-module interface surface. Three workstreams:

- **A — Projection / derivation foundation** (`core/state-store`, `core/persistence`, `lifecycle`): atomic checkpoint coupling (AMD-45) and the real `state_changed` derivation path (`DispatchingProjectionAdvancer`, Research 8 REC-28), now including the Research-9 cursor-determinism + one-shot-backfill discipline and the Research-10 typed comparator. Critical path; all state-based behavior is dark until it lands.
- **B — Device-model expansion** (`core/device-model`): Research 8 REC-23–REC-30, the already-ratified AMD-44 (Floor/EntityRole), and the Research-10 typed-value representation change (REC-91/93).
- **C — Integration-api interface freeze** (`integration/integration-api`): Research 6 REC-41–51 — **interface only**; supervisor implementation is M9.

**Explicitly NOT in M4** (per the backlog dependency graph): Configuration → **M6**; Automation → **M7/M8** (the automation module's entire Phase-2 interface spec already exists on disk — 9 service interfaces, 4 sealed hierarchies, flat `com.homesynapse.automation`, zero impl, zero tests [VR §A.1-7] — so M7/M8 is implementation, not interface design); Integration-runtime supervisor impl → **M9**; REST/WebSocket API → **M10/M11**.

---

## 2. Prerequisites and parallel governance

Each must close before the WU that depends on it is *briefed* (the "generate now, clean in parallel" sequencing decision holds).

| Prereq | What | Gates | Status |
|---|---|---|---|
| **P1 — De-poison** | Correct the `MinimalDerivationRule` phantom, the `~1,600+`→1,422 count, AMD-44 `APPLIED`→`RATIFIED`, `NumericStateTrigger` scrub. **v2 addition: also correct `AMD-45:75`** which still names `MinimalDerivationRule` [VR §B F-A]. (The three KB state docs + Nav Index are already corrected [VR §A.1-6]; AMD-45 is the surviving authoritative-doc phantom.) | Reconciliation to KB; **AMD-45 ratification**. | Ready to run; AMD-45 fix added |
| **P2 — AMD renumbering** | Resolve the collision and allocate one contiguous scheme. v2 expands this: it must also (a) give device a **4th** slot for SemanticTag, (b) add a **Workstream-A projection block** (Research 9/10), and (c) re-map Research 6's baked AMD-53..63. See §7. | Authoring **any** M4 amendment. | Needs Nick (expanded scope) |
| **P3 — Research 6 NQ-1..6** | Six scope/design calls (§6). PM recommendations verified sound [VR §D-Q2]. | Finalizing Workstream C amendments. | PM-recommended; pending Nick |
| **P4 — Doc currency (NEW)** | Doc 02 (device model, Locked 2026-03-05) carries **no** Floor/EntityRole/SemanticTag; Doc 05 (integration-runtime, Locked 2026-03-06) carries **none** of the Research-6 surface [VR §D-Q5]. A doc-update WU must land before Workstream B/C coding instructions are authored. | Briefing Workstream B/C. | New prerequisite |

---

## 3. Work-unit decomposition

WUs are sized to one reviewable `git diff`. Ordering respects the dependency graph; the critical path is Workstream A.

| WU | Title | Module(s) | Depends on | Key deliverable |
|---|---|---|---|---|
| **M4.0a** ✅ **DONE `a441fdf`** | Atomic checkpoint coupling + reconciliation plumbing | persistence, state-store, lifecycle | AMD-45 (ratified) | Wire `AtomicCheckpointWriter.writeAtomicCheckpoint(...)` into `StateProjection.writeCheckpoint()`; remove the per-delivery bus subscriber-checkpoint for `state_projection` (`InProcessEventBus:500`). **Pick AMD-45 §2.2 Option A (`SubscriberInfo.atomicCheckpoint` flag) vs B (no-op `CheckpointStore` wrapper)** — recommend A. Fold OR-M3-13: **populate** the existing `reconciledAt`/`reconciledFromVersion`/`reconciledToVersion` (extend `serializeCheckpoint` past `int`-only). Fold H2 (dedup tx wrapper) + the `HomeSynapseCore` Javadoc fix (§4.1 — incl. "M5"→"M7"). **REC-80**: emit `projection.replay.duration_ms` + `events_replayed`. **REC-82**: deprecate/guard `CheckpointRecord.projectionVersion()` (authoritative = `loadedProjectionVersion()`) + CI regression test. Extend `CrashRecoveryHttpIT` to assert the bus-ahead-of-view window is gone. |
| **M4.0b-1** ✅ **DONE `cf1a97e`** | Dispatch advancer (vertical slice) + determinism | state-store, lifecycle | M4.0a | `DispatchingProjectionAdvancer` (REC-28) replaces `MinimalProjectionAdvancer`; constructor-injected, package-private per-event-type handlers (DECIDE-04 — **no ServiceLoader**). Promote `EchoStateRule`'s change-detect into a production `DerivationRule`. **Publishes** derived `state_changed` (the seam decision — §4.2). **REC-76** cursor = f(log position). **REC-77** backfill provenance gate (reconciliation-scoped, non-emitting). **REC-79** determinism contract + test-only "sandbox" `DerivationContext` (forbid registry/IO; clock injected for timestamps, MUST NOT branch on it). **REC-81(1,2)** replay-invariant + backfill-correctness tests. |
| **M4.0b-2** ✅ **DONE `7610296`** | **AMD-50 version-transition backfill + projVer 1→2** (re-scoped per P2 — typed work split to M4.0b-3) | state-store, lifecycle | M4.0b-1, **AMD-50 (ratified)** | `projectionVersion` 1→2 bump (the trigger). **One-shot backfill** (§4.5) gated to the 1→2 reconciliation via the `backfillActive` provenance gate, on BOTH `onEvent` + `processBatch`, via the narrow `applyBackfillAttribute` (attributes + event-time `lastChanged`; no second `stateVersion` increment — INV-01; never publishes). Supersession (§2.2) suppresses logged prior-version `state_changed` under the gate. `Clock` removed from `DerivationContext` (§2.4). Built on the **existing string change-detect — does NOT need M4.B3.** AMD-50-INV-01..04 upheld. |
| **M4.0b-3** | Typed comparator + typed `StateChangedEvent` (the clean rule-swap riding AMD-50's backfill) | state-store, event-model | **M4.B3** | **AMD-51** — **REC-90** total typed per-permit comparator (`EnumValue.value()`) + **REC-94** float policy (comparison epsilon only; store verbatim; display rounding out of scope). **AMD-52** — **REC-91 (breaking)** `StateChangedEvent.oldValue`/`newValue` `String`→`AttributeValue`; `applyToState` stores the typed value (not `new StringValue(...)`); `CheckpointSerializer` evolves `Map<String,String>`→typed; String→typed upcaster. Reuses the M4.0b-2 AMD-50 backfill path **unchanged** for the 2→3 `projectionVersion` transition (the supersession test is the standing N→M regression guard). Pi replay-time validation vs the §3.2.3 5s threshold (feeds REC-80 metric). |
| **M4.B1** | EntityCategory on Entity | device-model | M4.0b-1 | REC-23. AMD [renumber→D1]. Category on `Entity` only, NOT `EntityState` (AMD-47-equiv withdrawn). |
| **M4.B2** | device_reachable_changed | device-model, state-store | M4.0b-1 | REC-25. New device-level cause updating the existing `Availability` enum on child `EntityState`; handler idempotent with `availability_changed`. |
| **M4.B3** | AttributeValue expansion (typed values + upcaster) — **AMD-47** | device-model, **event-model** | — (do early; **M4.0b-3** needs it); **gated on P4** (Doc 02/05 currency) | REC-24 + REC-27 + REC-29: add `QuantityValue`, `ArrayValue`, `DegradedAttributeValue` (public), `AttributeValueUpcaster` SPI. **REC-78** position the upcaster strictly before `DerivationRule.evaluate()` (both `onEvent` + `processBatch`). **REC-93** hand-rolled `QuantityValue` unit normalization. AMD-47. **(REC-91 — the breaking typed `StateChangedEvent` swap + `applyToState`/`CheckpointSerializer` typed evolution — moved to M4.0b-3 / AMD-52 per P2; M4.B3 only makes the typed values + upcaster exist.)** |
| **M4.B4** | SemanticTag replaces labels | device-model | M4.B3 (upcaster) | REC-26 (HIGH risk). AMD [renumber→**D4** — see §7 I-2: device needs a 4th slot, or bundle with M4.B1's Entity-record AMD]. CI-gated test deserializing a **real** pre-M4 `EntityRegistered` blob (reuse the REC-81(3) golden-master fixture). |
| **M4.B5** | Capability batch expansion | device-model | M4.0b-1 | REC-30: **8** new permits — `Thermostat, WindowCovering, DoorLock, MediaPlayer, EnergyMeasurement, WaterValve, Fan, AirQuality` [grep-confirm against `Capability` permits clause; **verify `EnergyMeasurement` does not duplicate existing `EnergyMeter`/`PowerMeter`** — the Research-8 dedup only caught `Occupancy`/`Contact`]. AMD [renumber→D3]. |
| **M4.B6** | Floor / EntityRole | device-model | — | Implement the already-ratified **AMD-44** (Floor aggregate, EntityRole enum, `Set<HardwareIdentifier>` — note AMD-44 §1.3 changes `List`→`Set`). Types absent from source today. Stage 1 (Floor + minimal Area) / Stage 2 (EntityRole) per the AMD. |
| **M4.C1..n** | Integration-api interface freeze | integration-api | P3 (NQ confirm) | Research 6 REC-41–48, 50, 51 (REC-49 **rejected**). Interface/enum/record/descriptor-field changes only. Each → an AMD [renumber→integration block]. **No supervisor code** (M9). |

**Sequencing notes:**

1. **M4.0a is first and unconditional** — data-integrity fix (AMD-45) + reconciliation-metadata population that the backfill gate depends on.
2. **M4.B3 must precede M4.0b-3** (the typed work) — the typed comparator (REC-90) is only meaningful once `QuantityValue`/`ArrayValue` exist **and** the store preserves type (REC-91/AMD-52). **(P2 re-scope, propagated 2026-05-29):** M4.0b-2 (AMD-50 backfill + projVer 1→2) **shipped on the proven string change-detect and did NOT need M4.B3** — the typed comparator + typed `StateChangedEvent` are now the separate **M4.0b-3**, gated on M4.B3, reusing AMD-50's backfill path unchanged for the 2→3 transition.
3. **REC-91 is the highest-risk change** — a breaking `StateChangedEvent` schema + materialized-store change, upcaster-dependent. **Nick-call (§10):** ride M4.B3 or split into its own WU.
4. **Workstream C runs in parallel** with A/B (different module, interface-only, no compile dependency). Gate: P3.
5. **M4.B4 (SemanticTag)** after the upcaster (M4.B3); highest device-model risk.

---

## 4. The critical path: `state_changed` derivation (M4.0b)

Specified at source-grain; this was the most error-prone area in scoping.

### 4.1 Why it gates everything

`StateProjection.applyToState` writes an entity's `attributes` only on inbound `state_changed`; an inbound `state_reported` advances `lastReported`/`lastUpdated`/`stateVersion` but leaves `attributes` untouched (`StateProjection.java:648-701`). The **only** producer of `state_changed` is the `DerivationRule`, which in production today is the no-op constant lambda `MINIMAL_DERIVATION_RULE = context -> List.of()` (`HomeSynapseCore.java:144-145`, wired `:255`; closes OR-M3-17). Therefore the canonical attribute map is **never populated in production today**, and every state-reading path is dark until a real rule ships. *M4.0a Javadoc fix:* the `HomeSynapseCore` Javadoc calling this "state_reported → state map update" is imprecise (the `EntityState` record is replaced — version/timestamps advance — but `attributes` are not) **and** mislabels the automation consumer as "M5 scope" (it is M7/M8). Correct both.

### 4.2 The seam decision — settled

Research 8 REC-28's dispatch table updates in-memory state with "no new events," which does not give automation triggers the `state_changed` *events* they subscribe to. **Decision: the production `DerivationRule` MUST publish a real `state_changed` when a `state_reported` changes the canonical attribute value.** M4.0b-1 owns this; not deferred to M7.

### 4.3 REPLAY semantics — verified against AMD-41 + source

Per AMD-41 §3.2.1/§3.2.2 and `StateProjection` (`onEvent:345`, `processBatch:460`): on REPLAY/TRANSITION the rule **re-executes** (the `SelfProducedFilter` is bypassed — determinism, not a stale filter, carries correctness — AMD-41 §3.2.2), but derived drafts are **buffered and not published** (publish gated to LIVE at `:388`/`:501`). Attribute state during a normal replay is rebuilt from previously-logged `state_changed` replaying as inbound. The production rule **must be deterministic under re-execution** (INV-PROJ-01) and **must gate publication to LIVE**. **REC-79 (determinism contract):** the rule must not branch on the injected `Clock` (it is provided only for derived-event timestamps), must not read any registry / other projection / I/O / randomness. `DerivationContext` exposes `(priorState, envelope, clock)` and no registry [VR §G.1].

### 4.4 `projectionVersion` bump → reconciliation replay

Shipping a real rule is a derivation-logic change. Per AMD-41 §3.2.4, a version mismatch forces reconciliation: discard checkpoint, clear `StateStore`, replay from position 0 (`StateProjection.initialize():549-566`). **The compared persisted version is `checkpointSource.loadedProjectionVersion()` (`:548`), NOT `CheckpointRecord.projectionVersion()`** — the latter is a sentinel hardcoded to 1 in both `ViewCheckpointStore` impls (`InMemoryViewCheckpointStore:70` literal `1`; `SqliteViewCheckpointStore` `DEFAULT_PROJECTION_VERSION = 1`). **REC-82** guards this footgun. `HomeSynapseCore` wires `StateProjection.create(ProjectionId, 1, …)` (`:251`; arg #2 = `int projectionVersion`); M4.0b bumps it to 2 → first boot after M4.0b does a full replay-from-zero. Escape hatch: `homesynapse.projection.allow_stale_snapshots` (`StateProjection.java:141-142`). **REC-80:** measure replay wall-time vs the §3.2.3 5s Pi threshold; `SqliteSnapshotStore` stays dormant until p95 > 5000 ms.

### 4.5 One-shot backfill — settled (Nick, 2026-05-28), with the Research-9 discipline

A plain replay-from-zero rebuilds timestamps/`stateVersion` but leaves historical `attributes` **empty** (the pre-M4.0b log has zero `state_changed`; re-derived drafts are not applied to state during replay). **Decision: implement a one-shot backfill** — during the 1→2 reconciliation replay *only*, apply re-derived `state_changed` drafts to in-memory state so historical attributes reconstruct from the `state_reported` log.

- **Gating (REC-77 — provenance, not version-boundary alone):** version-boundary gating answers "which replay" but not "which events are historical-derived vs logged." Gate on the reconciliation flag set in `initialize()` (`reconciledFromVersion=1`, `reconciledToVersion=2`) **and** treat re-derived drafts as reconciliation-scoped, non-emitting. On any replay where `projectionVersion ≥ 2`, the rule still re-executes (determinism) but its drafts are **discarded for state application** — logged `state_changed` is the sole attribute source. The `reconciledToVersion` field already exists in `CheckpointData`; M4.0a populates it.
- **Cursor determinism (REC-76):** the double-increment hazard is the deeper issue. `stateVersion` "advances on every processed event" and is the documented idempotency cursor (`EntityState.java:46-51`). Define it as **a function of log position**: `+1` per processed *log event* for the entity; a reconciliation-scoped backfill draft is **not** a log event and carries **no** increment (the source `state_reported` owns the single `+1`). Invariant: for a fixed log + fixed `projectionVersion`, `stateVersion` is identical across any number of rebuilds.
- **Governance (NEW amendment required):** AMD-41 §3.2.4 step 3 states the projection "emits derived events only after exiting REPLAY." The backfill does **not** publish/write events (single-writer invariant intact) but it **does** introduce a replay-time in-memory state-mutation path AMD-41 does not contemplate. **This requires an amendment refining AMD-41 §3.2.4** to authorise the one-shot, reconciliation-scoped, non-emitting backfill + the cursor-determinism rule. Allocate it in P2 (§7 Workstream-A block).
- **Test (REC-81):** (i) `rebuild(log) == rebuild(rebuild(log))` byte-identical per entity; (ii) 1→2 backfill ≡ native (final attribute map equals a fresh log already containing the `state_changed`), no double-increment; (iii) a second restart at code-version 2 finds persisted-version 2 → no reconciliation → backfill does not run. Extend the existing `StateProjectionContractTest` + `ReconciliationTest`.

---

## 5. Workstream B — device-model expansion (Research 8 + Research 10)

Implementation order (Nick-approved, source-verified [VR §A.2]):

1. **REC-28** — `DispatchingProjectionAdvancer` (= M4.0b; the gateway).
2. **REC-23** — `EntityCategory` on `Entity` only. AMD [→D1].
3. **REC-25** — `device_reachable_changed`, integrating the existing `Availability { AVAILABLE, UNAVAILABLE, UNKNOWN }`; handler idempotent with `availability_changed`.
4. **REC-24 + REC-27** — `QuantityValue`, `ArrayValue` (full-replacement semantics; ArrayValue uses order-sensitive element-wise equality per REC-90, never element-wise deadband — ZCL forbids change-reporting on arrays). AMD [→D2].
5. **REC-29** — `AttributeValueUpcaster` SPI (prereq for REC-26 and REC-91; `DegradedAttributeValue` is **public** [grep-confirm visibility when built]).
6. **REC-26** — `SemanticTag` replaces `labels` (HIGH risk; upcaster-dependent; real-blob CI test). AMD [→D4 or bundled with D1 — §7].
7. **REC-30** — `Capability` batch: 8 new permits (see M4.B5; verify `EnergyMeasurement` vs existing `EnergyMeter`/`PowerMeter`).

Plus **M4.B6**: implement ratified AMD-44 (Floor/EntityRole).

**Research-10 representation change (REC-91, breaking) lives here:** `StateChangedEvent.oldValue`/`newValue` `String`→`AttributeValue`; `applyToState` stores the typed value; `CheckpointSerializer` evolves `Map<String,String>`→typed in lockstep (or snapshots silently drop non-`StringValue` attributes); String→typed event upcaster (best-effort parse → else `StringValue`/`DegradedAttributeValue`). **REC-93:** hand-rolled canonical-unit normalization for `QuantityValue` (LTD-10 gates an Indriya dependency — Nick-call, §10).

Verified type facts to brief against: `Entity` = 11 fields; `AttributeValue` permits = `BooleanValue, IntValue(long), FloatValue(double), StringValue, EnumValue` (`EnumValue` accessor = `value()`, not `token()`); `Long/Double/Instant/JsonValue` are phantom; `EntityState` = 9 fields, no structural metadata.

---

## 6. Workstream C — integration-api interface freeze (Research 6)

**Interface, enums, records, descriptor fields only. Supervisor implementation is M9.**

Accepted RECs (all → AMDs in the renumbered integration block): REC-41 lifecycle hooks; REC-42 `HealthDetail` enum; REC-43 `AUTH_FAILED` on `ExceptionClassification`; REC-44 four lifecycle events; REC-45 security services (NQ-1); REC-46 `softDependencies`; REC-47 capability events (NQ-3/4); REC-48 `BackoffParameters`; **REC-50 `isolationLevel`** — **ADD a new field + `IsolationLevel` enum; there is no existing `isolationHint` to rename** [VR §B F-C]; REC-51 `plannedRestartTimeout`. **REC-49 rejected** (duplicates existing `HealthParameters.maxRestarts`/`restartWindow` — verified, 11-field record).

Module/type corrections (Research 6 F1–F8, source-verified [VR §A.2/§D-Q2]): JPMS module is `com.homesynapse.integration` (no `.api`); composition root is `com.homesynapse.app` (no `.bootstrap`); `CapabilityId` does **not** exist (use `Class<? extends Capability>` + `CapabilityInstance`); the M9 supervisor migration runner must be `AdapterMigrationRunner` (persistence `MigrationRunner` exists). `schemaVersion` exists at `IntegrationDescriptor.java:80`.

**Research 6 NQ recommendations (P3 — pending Nick; all verified sound [VR §D-Q2]):** NQ-1 `SecurityServices` aggregator → `IntegrationContext` **10→11** fields (vs 12 field-by-field); NQ-2 rename `schemaVersion`→`descriptorSchemaVersion`, add `configSchemaMajor/Minor`; NQ-3 capability identity = sealed `Capability` permit class + `CapabilityInstance`; NQ-4 no new SQLite table (capabilities on `Entity`); NQ-5 reject REC-49; NQ-6 keep 1/60s restart default with per-descriptor override (empirical Zigbee spike before M9).

---

## 7. AMD allocation (proposed — pending P2 ratification)

On-disk watermark: **AMD-45** (44 = Floor RATIFIED; 45 = Checkpoint DRAFT). Gaps 28–30 are unused; allocation proceeds forward (monotonic). **v2 resolves three problems v1 left** [VR §H/§J, I-2/I-3]: (a) device needs a **4th** slot (SemanticTag was unnumbered); (b) there was **no Workstream-A projection block**; (c) Research 6 pre-baked AMD-53..63, colliding with v1's automation 49–53.

**Proposed contiguous allocation (M4-authored amendments fixed first; non-M4 blocks reserved after):**

| Block | Source / WUs | Proposed AMDs | M4? |
|---|---|---|---|
| Device-model expansion | R8 + R10 REC-93 | **D1–D4** = e.g. 46 (EntityCategory, REC-23), 47 (AttributeValue+QuantityValue/ArrayValue/upcaster, REC-24/27/29 + REC-93), 48 (Capability, REC-30), 49 (SemanticTag, REC-26) — *or* bundle EntityCategory+SemanticTag into one Entity-record AMD (R8's original grouping) and keep 3 | Yes (Workstream B) |
| **Workstream-A projection (NEW)** | R9 REC-76/77/79 + AMD-41 §3.2.4 backfill refinement; R10 REC-90/94 (comparator+float); R10 REC-91 (breaking `StateChangedEvent`) | **A1–A3** (one projection-rebuild/backfill/cursor AMD; one typed-comparator AMD; one typed-`StateChangedEvent` breaking AMD) | Yes (Workstream A) |
| Integration-runtime | R6 (10 accepted) | **10 contiguous** (supersedes the assessment's stale AMD-53..63) | Interface freeze only |
| Automation | R4 | reserved after the M4 blocks | No (M7) |
| Configuration | R5 | reserved | No (M6) |
| REST/WebSocket API | R7 | reserved | No (M10/M11) |

REC-80/81/82 (metric/tests/accessor-guard) and REC-92 (deferred deadband) need **no** AMD. Per-REC→AMD assignment and the final numeric ranges are ratified in the P2 renumbering WU. **Do not author any M4 amendment file until P2 is ratified.**

---

## 8. Test strategy

Contract-test-first (10 `*ContractTest` fixtures exist; `EventStoreContractTest` = 27 is the model). The R-01–R-11 set maps directly (R-01 idempotency = CRITICAL [VR §A.2]; note only R-01–R-04 carry explicit severities).

- **Derivation contract** — extend `StateProjectionContractTest` (already exercises `EchoStateRule`/`AlwaysProducingRule`) to cover the production rule: typed change-detect correctness per permit (REC-90), REPLAY re-derive-without-publish, and the one-shot backfill. Gate for M4.0b.
- **Replay-invariant + golden-master (REC-81)** — (i) `rebuild(log)==rebuild(rebuild(log))`; (ii) backfill ≡ native, no double-increment; (iii) golden-master over extracted real serialized blobs (incl. pre-upcast `AttributeValue` shapes), shared with the M4.B4 SemanticTag real-blob test. Extend the existing `ReconciliationTest`.
- **Typed comparator (REC-90/94)** — per-permit equality incl. NaN==NaN, ±0.0, hybrid abs/rel epsilon; `QuantityValue` unit-normalized comparison (REC-93); `ArrayValue` order-sensitive.
- **`DispatchingProjectionAdvancer`** — new contract suite (dispatch by `@EventType`, `AdvanceResult.skipped()` for unknown types, determinism).
- **Determinism sandbox (REC-79)** — test-only `DerivationContext` that throws on registry/IO access (clock access is legal).
- **R-01 idempotency (CRITICAL)**, **R-03 `IntegrationAdapterContractTest`**, **M4.0a `CrashRecoveryHttpIT`** (bus-ahead-of-view window closed), **R-06/R-07 (Pi 5s replay, REC-80 metric)/R-09 (PIT, advisory)/R-10 (jqwik)** as ongoing gates.

---

## 9. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `state_changed` derivation under-scoped; state paths silently dark | Med | High | M4.0b as explicit hard gate (§4); derivation contract test before any state-reading work |
| One-shot backfill leaks into steady-state replay → `stateVersion` desync | Med | High | Provenance gate (REC-77) + cursor-as-log-position (REC-76); contract test asserts no double-increment on later replays |
| **Cursor non-determinism (path-dependent `stateVersion`)** | Med | High | REC-76 makes it a function of log position; replay-invariant property test (REC-81) |
| **Typed-`StateChangedEvent` break corrupts stored events** | Med | High | REC-91 co-sequenced with REC-29 upcaster; golden-master real-blob test; best-effort parse fallback |
| First-boot replay-from-zero exceeds Pi budget | Med | Med | REC-80 metric vs §3.2.3 5s threshold; `SqliteSnapshotStore` is the documented escape valve (dormant until measured) |
| Integration-api freeze on stale assumptions | Low | High | Research 6 fully assessed; apply F1–F8 + the REC-50 add-not-rename correction; confirm NQ-1..6 |
| AMD numbering collision propagates into files | Med | High | P2 renumbering (expanded: device 4th slot + Workstream-A block + R6 53→remap) ratified before any M4 amendment authored |
| **Doc 02/05 lag the ratified amendments** | High | Med | P4 doc-update WU before Workstream B/C briefs |
| KB re-poisons the plan | Low | Med | Largely mitigated — three KB state docs + Nav Index already corrected; `AMD-45:75` is the one residual (P1) |
| **Indriya dependency creep (units)** | Low | Med | Hand-roll the M4 normalizer (REC-93); Indriya deferred behind LTD-10 |

---

## 10. Open decisions (the only things not settled)

1. **P2 — AMD renumbering allocation** (§7): ratify the expanded scheme — device 4th slot (or bundle EntityCategory+SemanticTag), the new Workstream-A projection block (Research 9/10 + the AMD-41 §3.2.4 backfill refinement), and the integration 53→remap.
2. **P3 — Research 6 NQ-1..6** (§6): confirm or override the (verified-sound) PM recommendations.
3. **P4 — Doc currency** (§2): confirm/schedule the Doc 02 + Doc 05 update before Workstream B/C coding instructions are authored.
4. **REC-91 sequencing** (§3/§5): ride M4.B3, or split the breaking `StateChangedEvent` typed-payload change into its own WU?
5. **Units library (LTD-10)** (§5, REC-93): hand-roll the M4 normalizer (recommended) vs adopt `tech.units:indriya:2.2.3` (version-catalog amendment)?
6. **Float comparison constants** (§4, REC-94): exact `absEps`/`relEps`, and abs vs rel vs hybrid vs ULP?
7. **`DerivedAttributeValue`/Degraded-transition semantics** (REC-90/92): does *entering* Degraded ever warrant an observability signal, even if not a value change?
8. **Deferred deadband** (REC-92): confirm the future home (`AttributeSchema` within `CapabilityInstance.attributes`) and default (absent/exact); not built in M4.

Everything else — scope, the derivation mechanism, REPLAY semantics, the backfill + cursor-determinism decisions, typed comparison, the WU decomposition — is settled and source-grounded.

---

## 11. Critical path summary

```
M4.0a ✅ DONE `a441fdf` (atomic checkpoint + reconciliation-metadata population + replay metric + projVer guard)
   └─> M4.0b-1 ✅ DONE `cf1a97e` (dispatch advancer + publishing rule + cursor-determinism + provenance gate + determinism contract)
          ├─> M4.0b-2 ✅ DONE `7610296` (AMD-50 one-shot backfill + provenance gate + supersession + projVer 1→2, on the string change-detect — **no M4.B3 dep**)
          ├─> M4.B3 (AttributeValue expansion + upcaster, AMD-47)   ← NEXT forward WU; gated on P4
          │       └─> M4.0b-3 (typed comparator AMD-51 + TYPED StateChangedEvent/store AMD-52 [REC-90/91, breaking] — reuses the AMD-50 backfill path for the 2→3 transition)
          ├─> M4.B1/B2/B5/B6 (device-model expansion)
          └─> M4.B4 (SemanticTag — after upcaster; shares golden-master fixture)
Workstream C (integration-api freeze)             ← parallel; gated only on P3
P1 de-poison (incl. AMD-45:75) ✅ + P2 renumbering ✅ (ratified) + P4 doc-currency (remaining — gates M4.B3)
```

Workstream A is COMPLETE through M4.0b-2 (`7610296`). **Next coding instruction to cut: M4.B3** (device-model AttributeValue expansion, AMD-47) — gated on P4 doc currency — then **M4.0b-3** (the typed comparator + typed `StateChangedEvent`, gated on M4.B3, a clean rule-swap riding AMD-50's backfill unchanged). The cursor-determinism (REC-76) and provenance-gate (REC-77) discipline shipped in M4.0b-1/M4.0b-2 and is the foundation M4.0b-3 reuses.
