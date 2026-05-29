<!--
file: design/HomeSynapse_Core_M4_Implementation_Plan_PLAN-M4-CONSOLIDATED.md
purpose: Authoritative M4 implementation plan — scope, work-unit decomposition, AMD allocation, sequencing, test strategy, open decisions.
audience: PM, Coder, Nick
update-cadence: per-milestone
state-type: planning
status: DRAFT v1 (source-grounded 2026-05-28; pending de-poison reconciliation + AMD-renumbering ratification + Research-6 NQ confirmation)
last-verified: 2026-05-28 against M3.7 closeout source tree
-->

# HomeSynapse Core — M4 Implementation Plan (PLAN-M4-CONSOLIDATED)

## 0. Provenance and verification discipline

This plan was built from a direct read of the M3.7-closeout **source tree**, not from the project-knowledge state docs. That matters because a source ground-truth pass during M4 scoping found that the knowledge base asserts a class `MinimalDerivationRule` that **does not exist** in the source (the real construct is a no-op constant lambda), plus a stale test count and an incorrect AMD-44 status. A de-poison WU corrects those at the source and **runs in parallel with this plan** (Nick's sequencing decision, 2026-05-28); this document is reconciled to the cleaned KB once that lands.

**Anti-transcription rule (applies to every WU briefed off this plan):** literal type names, line numbers, and the `projectionVersion` constant in this document are *pointers, not authority*. Confirm each against the actual source via grep before it is written into a coding instruction or an amendment. Type names carried from PM research assessments rather than verified firsthand are tagged **[grep-confirm]**. Transcription error is the failure mode this entire scoping arc exists to remove; do not reintroduce it.

**Verified baseline (firsthand, 2026-05-28):** M3 COMPLETE (2026-05-27); build GREEN; 20 non-spike Gradle modules; **1,422** `@Test`/`@ParameterizedTest`/`@RepeatedTest` methods across **724** `.java` files; 10 `*ContractTest` testFixtures suites; `EventStoreContractTest` = 27 methods.

---

## 1. What M4 is — and what it is not

**M4 scope decision (Nick, 2026-05-28): Canonical.** M4 is the **foundation milestone** that makes state materialization real and freezes the cross-module interface surface that downstream subsystems will compile against. It contains three workstreams:

- **A — Projection / derivation foundation** (`core/state-store`, `core/persistence`, `lifecycle`): atomic checkpoint coupling (AMD-45) and the real `state_changed` derivation path (`DispatchingProjectionAdvancer`, Research 8 REC-28). This is the critical path; all state-based behavior is dark until it lands.
- **B — Device-model expansion** (`core/device-model`): Research 8 REC-23–REC-30, plus implementation of the already-ratified AMD-44 (Floor / EntityRole).
- **C — Integration-api interface freeze** (`integration/integration-api`): Research 6 REC-41–REC-51 — lifecycle hooks, health/exception enums, descriptor fields. **Interface only**; the supervisor implementation is M9.

**Explicitly NOT in M4** (per the phase-3 backlog dependency graph; recorded here to prevent scope creep):

- **Configuration system** → **M6** (Research 5, REC-53–61).
- **Automation engine** → **M7 (core) / M8 (advanced)** (Research 4, REC-31–40). Note: the automation module's entire **Phase 2 interface spec already exists on disk** (9 service interfaces, 4 sealed hierarchies, ~52 types, flat package, zero implementation, zero tests). M7/M8 is the Phase 3 *implementation* of those existing contracts — not new interface design.
- **Integration-runtime supervisor implementation** → **M9** (Research 6 REC-52). M4 freezes its *interface*; M9 builds the OTP-style supervisor, restart/backoff, Kahn ordering.
- **REST / WebSocket API** → **M10 / M11** (Research 7, REC-62–75 — note Research 7's §7 is graded C- and needs a structural rewrite before any of it lands; far downstream, does not gate M4).

---

## 2. Prerequisites and parallel governance

Three items run **alongside** M4 authoring (not as blockers, per the "generate now, clean in parallel" decision), but each must close before the specific WU that depends on it is *briefed*:

| Prereq | What | Gates | Status |
|---|---|---|---|
| **P1 — De-poison KB** | Correct the `MinimalDerivationRule` phantom, the `~1,600+`→1,422 count, AMD-44 `APPLIED`→`RATIFIED`, `NumericStateTrigger` scrub. Cowork doc-only WU; drafted and grep-verified. | Reconciliation of this plan to the KB; nothing in the code path. | Ready to run |
| **P2 — AMD renumbering** | Resolve the collision: Research 8 numbered its device AMDs 44/45/46, but AMD-44 (Floor) and AMD-45 (Checkpoint) are taken. Ratify a single contiguous allocation (see §8). | Authoring **any** M4 amendment file. | Needs Nick's ratification |
| **P3 — Research 6 NQ-1..6** | Six scope/design calls that shape the integration-api freeze content (aggregator vs per-field, schema-version split, capability identity/storage, restart-intensity default). PM recommendations exist for each (§7). | Finalizing Workstream C amendments. | PM-recommended; pending Nick |

---

## 3. Work-unit decomposition

WUs are sized to one reviewable `git diff` (the M3 lesson: every sub-step explosion in M3.6/M3.7 happened when a unit was too big to land as one diff). Ordering respects the dependency graph; the critical path is Workstream A.

| WU | Title | Module(s) | Depends on | Key deliverable |
|---|---|---|---|---|
| **M4.0a** | Atomic checkpoint coupling | persistence, state-store, lifecycle | AMD-45 ratify | Wire existing `AtomicCheckpointWriter.writeAtomicCheckpoint(...)` into `StateProjection.writeCheckpoint()`; remove the per-delivery bus subscriber-checkpoint for `state_projection`. Fold OR-M3-13 (reconciliation metadata) + H2 (dedup transaction wrapper) + the `HomeSynapseCore` Javadoc fix (§5.1). Extend `CrashRecoveryHttpIT` to assert the bus-ahead-of-view window is gone. |
| **M4.0b-1** | Dispatch advancer (vertical slice) | state-store, lifecycle | M4.0a | `DispatchingProjectionAdvancer` (REC-28) replaces `MinimalProjectionAdvancer`; constructor-injected, package-private per-event-type handlers (DECIDE-04 — **no ServiceLoader**). Promote `EchoStateRule`'s string change-detect logic into a production `DerivationRule`. **Publishes** derived `state_changed` (the seam decision — §5.2). |
| **M4.0b-2** | Typed-value derivation + one-shot backfill | state-store | M4.0b-1, Workstream B AttributeValue WU | Extend change-detection from string-only to typed `AttributeValue` (incl. `QuantityValue`/`ArrayValue`). `projectionVersion` 1→2 bump. **One-shot backfill** (§5.3): apply re-derived drafts to state during the 1→2 reconciliation replay only, gated to that boundary. Pi replay-time validation vs the §3.2.3 5s threshold. |
| **M4.B1** | EntityCategory on Entity | device-model | M4.0b-1 | REC-23. AMD [renumber→46]. Category on `Entity` only, NOT `EntityState` (design-boundary; AMD-47-equiv withdrawn). |
| **M4.B2** | device_reachable_changed | device-model, state-store | M4.0b-1 | REC-25. New device-level cause that updates the existing `Availability` enum on child `EntityState`; handler idempotent with `availability_changed`. |
| **M4.B3** | AttributeValue.permits expansion | device-model | — (do early; M4.0b-2 needs it) | REC-24 + REC-27 + REC-29: add `QuantityValue`, `ArrayValue`, `DegradedAttributeValue` (public), `AttributeValueUpcaster` SPI. AMD [renumber→47]. |
| **M4.B4** | SemanticTag replaces labels | device-model | M4.B3 (upcaster) | REC-26 (HIGH risk). AMD (Entity record). CI-gated integration test deserializing a **real** pre-M4 `EntityRegistered` JSON blob (PM mod). |
| **M4.B5** | Capability batch expansion | device-model | M4.0b-1 | REC-30: 8 new permits [grep-confirm names against `Capability` permits clause]. AMD [renumber→48]. |
| **M4.B6** | Floor / EntityRole | device-model | — | Implement the already-ratified **AMD-44** (Floor aggregate, EntityRole enum, `Set<HardwareIdentifier>`). Types are absent from source today. Stage 1 (Floor + minimal Area) / Stage 2 (EntityRole) per the AMD. |
| **M4.C1..n** | Integration-api interface freeze | integration-api | P3 (NQ confirm) | Research 6 REC-41–48, 50, 51 (REC-49 **rejected**). Interface/enum/record/descriptor-field changes only. Each is an AMD [renumber→54–63 block]. **No supervisor code** (M9). |

**Sequencing notes (real interactions, not boilerplate):**

1. **M4.0a is first and unconditional** — it's a data-integrity fix (AMD-45) and touches the same projection-checkpoint surface as OR-M3-13/H2.
2. **M4.B3 (AttributeValue expansion) must precede M4.0b-2** — typed change-detection can't compare `QuantityValue`/`ArrayValue` that don't exist yet. M4.0b-1 ships with string comparison (the proven `EchoStateRule` logic) so the vertical slice isn't blocked on the type expansion.
3. **Workstream C runs in parallel with A/B** — different module (`integration-api`), interface-only, no compile dependency on the projection work. Its only gate is P3 (NQ confirmation).
4. **M4.B4 (SemanticTag) is the highest-risk WU** — it's a breaking change to the `Entity` record's stored form and depends on the upcaster SPI (M4.B3). Schedule it after the upcaster is proven.

---

## 4. The critical path: `state_changed` derivation (M4.0b)

This is the single most important sequencing fact in M4, and it was the most error-prone area in scoping — so it is specified at the source-grain here.

### 4.1 Why it gates everything

`StateProjection.applyToState` writes an entity's **`attributes`** only on inbound `state_changed` events; an inbound `state_reported` advances `lastReported`/`lastUpdated`/`stateVersion` but leaves `attributes` untouched. The **only** producer of `state_changed` is the `DerivationRule`, which in production today is the **no-op constant lambda** `MINIMAL_DERIVATION_RULE = context -> List.of()` in `HomeSynapseCore` (closing OR-M3-17). Therefore **the canonical attribute map is never populated in production today** — and *every* state-reading path (state/numeric conditions and triggers, once automation arrives in M7) is dark until a real rule ships. (The `HomeSynapseCore` Javadoc calling this "state_reported → state map update" is imprecise: the `EntityState` record *is* replaced — version/timestamps advance — but `attributes` specifically are not. Reworded in M4.0a.)

### 4.2 The seam decision — settled

Research 8 REC-28's dispatch table is described as updating in-memory state with "no new events." That covers device-model cases (`device_reachable_changed` → `Availability`, `entity_registered` → category) but **does not** give automation triggers the `state_changed` *events* they subscribe to. **Decision: the production `DerivationRule` MUST publish a real `state_changed` event when a `state_reported` changes the canonical attribute value** — otherwise triggers never wake. M4.0b-1 owns this; it is not deferred to M7.

### 4.3 REPLAY semantics — verified against AMD-41 + source

Per AMD-41 §3.2.1/§3.2.2 and `StateProjection.processBatch`: on REPLAY/TRANSITION the rule **re-executes** (re-derive — the `SelfProducedFilter` is bypassed so determinism, not a stale filter, carries correctness), but derived drafts are **buffered and not published** (publish is LIVE-only). Attribute state during a normal replay is rebuilt from the previously-logged `state_changed` events replaying as inbound. Consequence for the production rule: it **must be deterministic under re-execution** (INV-PROJ-01) and **must gate publication to LIVE**. (Telling a coder "don't re-derive on replay" would be a bug — the rule does re-run; it just doesn't re-publish.)

### 4.4 `projectionVersion` bump → reconciliation replay

Shipping a real rule is a derivation-logic change. Per AMD-41 §3.2.4, a `projectionVersion(checkpoint) ≠ projectionVersion(code)` mismatch forces a reconciliation pass: discard checkpoint, clear `StateStore`, replay from position 0 (escape hatch `homesynapse.projection.allow_stale_snapshots` [grep-confirm]). `HomeSynapseCore` currently wires `StateProjection.create(ProjectionId, 1, ...)` [grep-confirm the `1`]; M4.0b bumps it to 2, so **first boot after M4.0b does a full replay-from-zero**. Validate replay wall-time on the Pi reference against the §3.2.3 5-second threshold.

### 4.5 One-shot backfill — settled (Nick, 2026-05-28)

A plain replay-from-zero rebuilds timestamps/`stateVersion` but leaves historical `attributes` **empty** (the pre-M4.0b log contains zero `state_changed` events, and re-derived drafts are not applied to state during replay). That is the §5 blind-automation hazard in new clothes. **Decision: implement a one-shot backfill** — during the 1→2 reconciliation replay *only*, apply the re-derived `state_changed` drafts to in-memory state so historical attributes reconstruct from the `state_reported` log.

**The guard that makes this safe and one-shot:** applying a re-derived draft *and* a logged `state_changed` to the same logical change would not corrupt the attribute value (`applyToState` does `newAttrs.put(key, value)` — idempotent on value) but **would inflate `stateVersion` by two** (every `applyToState` does `stateVersion + 1`, and `stateVersion` is the documented idempotency cursor that "advances on every processed event" per `EntityState`). Inflation desyncs cursor consumers. This hazard is **absent precisely at the 1→2 boundary** (no `state_changed` exists in the pre-M4.0b log), so the backfill must be **gated to that reconciliation pass and must not run on subsequent replays**, where logged `state_changed` events already exist.

---

## 5. Workstream B — device-model expansion (Research 8)

Implementation order is Nick-approved (Research 8 v2, source-verified). All eight RECs are M4.0 scope.

1. **REC-28** — `DispatchingProjectionAdvancer` (= M4.0b; the gateway).
2. **REC-23** — `EntityCategory` on `Entity` only. AMD [→46].
3. **REC-25** — `device_reachable_changed`, integrating the existing `Availability { AVAILABLE, UNAVAILABLE, UNKNOWN }` enum [grep-confirm]; handler idempotent with `availability_changed`.
4. **REC-24 + REC-27** — `QuantityValue`, `ArrayValue` (full-replacement semantics — non-negotiable per the bounded-window advancer). AMD [→47].
5. **REC-29** — `AttributeValueUpcaster` SPI (prereq for REC-26; enables sealed-hierarchy versioning without breaking stored-event deserialization). `DegradedAttributeValue` is **public** [grep-confirm visibility].
6. **REC-26** — `SemanticTag` replaces `labels` (HIGH risk; upcaster-dependent; real-blob CI test).
7. **REC-30** — `Capability` batch: 8 new permits [grep-confirm against the existing 16-permit clause; `Occupancy`/`Contact` already exist — do not re-add].

Verified type facts to brief against (Research 8 v2, Nick-source-verified): `Entity` has **11** fields; `AttributeValue`'s real permits are `BooleanValue, IntValue, FloatValue, StringValue, EnumValue` (5) — `LongValue`/`DoubleValue`/`InstantValue`/`JsonValue` are **phantom**; `EntityState` has 9 fields and carries **no** structural metadata (category/capabilities live on `Entity`). Plus **M4.B6**: implement the ratified-but-unbuilt **AMD-44** (Floor/EntityRole).

---

## 6. Workstream C — integration-api interface freeze (Research 6)

**Interface, enums, records, descriptor fields only. Supervisor implementation is M9.** Research 6 §1 Verdict 2: adding lifecycle hooks "before M4 freeze is the single highest-impact finding" — the retroactive-amendment tax is the rationale for freezing now.

Accepted RECs (all → AMDs in the renumbered 54–63 block): REC-41 lifecycle hooks (`onConfigUpdated`/`onOptionsUpdated`/`onReauthRequired`/`migrate`); REC-42 `HealthDetail` enum; REC-43 `AUTH_FAILED` on `ExceptionClassification`; REC-44 four lifecycle events; REC-45 security services (see NQ-1); REC-46 `softDependencies`; REC-47 capability events (see NQ-3/4); REC-48 `BackoffParameters`; REC-50 `isolationLevel` (rename from `isolationHint`); REC-51 `plannedRestartTimeout`. **REC-49 rejected** (duplicates existing `HealthParameters.maxRestarts`/`restartWindow` [grep-confirm]).

Module/type corrections that MUST be applied (Research 6 fabrication catalog F1–F8): JPMS module is `com.homesynapse.integration` (no `.api`); upstream modules are `.event`, `.state`, `.config` (not `.event.model`/`.state.store`/`.configuration`); composition root is `com.homesynapse.app` (no `.bootstrap`); `CapabilityId` does **not** exist (use `Class<? extends Capability>` + `CapabilityInstance`); the supervisor's migration runner must be `AdapterMigrationRunner` (name collision with the existing persistence `MigrationRunner` [grep-confirm]). All integration-api type names in this section are **[grep-confirm]** — PM-verified in the assessment but not re-grepped firsthand here.

**Research 6 NQ recommendations (P3 — pending Nick):** NQ-1 aggregate security services into one `SecurityServices` field (keep `IntegrationContext` at 11 fields); NQ-2 rename existing `schemaVersion`→`descriptorSchemaVersion`, add `configSchemaMajor/Minor`; NQ-3 capability identity = sealed `Capability` permit class + `CapabilityInstance`; NQ-4 no new SQLite table (capabilities live on `Entity`); NQ-5 reject REC-49; NQ-6 keep 1/60s restart default with per-descriptor override (empirical Zigbee spike before M9).

---

## 7. AMD allocation (proposed — pending P2 ratification)

On-disk watermark: **AMD-45** (44 = Floor RATIFIED; 45 = Checkpoint DRAFT). The three 2026-05-22 research assessments numbered their amendments assuming device-model owned 44–47, which now collides. Proposed single contiguous re-allocation:

| Block | Source | AMDs | M4? |
|---|---|---|---|
| Device-model expansion | Research 8 | **46, 47, 48** | Yes (Workstream B) |
| Automation | Research 4 | 49–53 | No (M7) |
| Integration-runtime | Research 6 | **54–63** | Interface freeze only (Workstream C) |
| Configuration | Research 5 | 64–71 | No (M6) |
| REST/WebSocket API | Research 7 | 72–85 | No (M10/M11) |

Per-REC assignment within each block is finalized in the renumbering WU (P2). Do not author any M4 amendment file until P2 is ratified.

---

## 8. Test strategy

Contract-test-first, matching the established discipline (10 `*ContractTest` fixtures already exist; `EventStoreContractTest` = 27 methods is the model). The R-01–R-11 set (formalized with severities in the 2026-04-08 project state report) maps directly:

- **Derivation contract** — extend `StateProjectionContractTest` (which already exercises `EchoStateRule`/`AlwaysProducingRule`) to cover the production rule: change-detect correctness, typed-value comparison, REPLAY re-derive-without-publish, and the **one-shot backfill** (assert historical attributes reconstruct on the 1→2 replay and `stateVersion` is not double-incremented). This is the gate for M4.0b.
- **`DispatchingProjectionAdvancer`** — new contract suite (dispatch by `@EventType`, `AdvanceResult.skipped()` for unknown types, determinism).
- **R-01 idempotency (CRITICAL)** — every projection handler must produce identical state on replay of the same envelope; bake into the handler base test.
- **R-03 `IntegrationAdapterContractTest`** — define the adapter behavioral contract once (the freeze gives it a stable surface); scaffolds Zigbee/Z-Wave/Matter conformance later.
- **M4.0a** — extend `CrashRecoveryHttpIT` to prove the bus-ahead-of-view window is closed.
- **R-06 failure-mode**, **R-07 Pi profiling** (the 5s replay threshold), **R-09 PIT** (advisory/weekly, never per-commit), **R-10 jqwik** (ULID ordering, derivation determinism) as ongoing gates.

---

## 9. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `state_changed` derivation under-scoped; state paths silently dark | Med | High | M4.0b as explicit hard gate (§4); derivation contract test before any downstream state-reading work |
| One-shot backfill leaks into steady-state replay → `stateVersion` desync | Med | High | Gate strictly to the 1→2 reconciliation pass; contract test asserts no double-increment on later replays |
| First-boot replay-from-zero exceeds Pi budget | Med | Med | Measure against §3.2.3 5s threshold in M4.0b-2; `SqliteSnapshotStore` is the documented escape valve if breached |
| Integration-api freeze on stale assumptions | Low | High | Research 6 is fully assessed; apply F1–F8 corrections; confirm NQ-1..6 before authoring |
| AMD numbering collision propagates into amendment files | Med | High | P2 renumbering ratified before any M4 amendment authored |
| KB re-poisons the plan | Med | Med | P1 de-poison in parallel; this plan reconciled to cleaned KB; `[grep-confirm]` tags on all carried literals |
| Device-model `SemanticTag` migration breaks stored events | Low | High | Upcaster SPI (M4.B3) first; real-blob CI test (M4.B4) |

---

## 10. Open decisions (the only things not settled)

1. **P2 — AMD renumbering allocation** (§7): ratify or amend.
2. **P3 — Research 6 NQ-1..6** (§6): confirm or override the PM recommendations.
3. **Doc currency**: confirm Doc 02 (device model) and Doc 05 (integration-runtime) reflect the ratified amendments before Workstream B/C coding instructions are authored (AMD-44 is "RATIFIED pending implementation" — the design doc may already carry it; the code does not).

Everything else — scope, the derivation mechanism, REPLAY semantics, the backfill decision, the WU decomposition — is settled and source-grounded.

---

## 11. Critical path summary

```
M4.0a (atomic checkpoint)                         ← first, unconditional
   └─> M4.0b-1 (dispatch advancer + publishing string-derivation)   ← hard gate
          ├─> M4.B3 (AttributeValue expansion)
          │       └─> M4.0b-2 (typed derivation + one-shot backfill + projVer 1→2)
          ├─> M4.B1/B2/B5/B6 (device-model expansion)
          └─> M4.B4 (SemanticTag — after upcaster)
Workstream C (integration-api freeze)             ← parallel; gated only on P3
P1 de-poison + P2 renumbering                     ← parallel governance
```

First coding instruction to cut: **M4.0a** (fully source-grounded, decision-free, AMD-45 already drafted).
