# AMD-53: Timestamp-Model Unifier — Event-Time Sourcing for EntityState Activity Timestamps

**Amendment ID:** AMD-53
**Tier:** Tier-1 (architectural invariant)
**Status:** PROPOSED
**Date drafted:** 2026-05-31
**Date applied:** _(pending ratification)_
**Target documents:** Doc 03 (State Store & State Projection)
**Target sections:** Doc 03 §4.1 (EntityState field contracts — code brought into compliance, no contract change); Doc 03 §3.2 (LIVE/REPLAY dispatch tables); Doc 03 §3.8 (staleness — the carve-out reference)
**Refines / ties into:** AMD-50-INV-03 (rebuild determinism of the rule) — **extends** the determinism contract from the `DerivationRule` to the projection's own timestamp materialization; INV-PROJ-01 (projection determinism); Doc 01 INV-ES-08 (`event_time` vs `ingest_time`); INV-ES-01 (events immutable once persisted).
**Source:** the timestamp-model-unifier design beat (2026-05-31); every type/field/line source-verified against HEAD `72596cb` with the Read tool; Nick's four ratification-fork calls (2026-05-31). Prior interim record: M4.0b-2 closeout flagged the mixed-`lastChanged` split as a conscious interim and named the unifier a separate WU; the in-code `[REVIEW]` note (`StateProjection.applyBackfillAttribute` ~L918) is its standing marker.
**Scope:** Workstream A — the honest last mile. Authorises the mechanism; implemented by one small `core/state-store` Coder WU (the timestamp unifier). **This amendment authors no code.**
**AMD-allocation note:** AMD-53 is the next free monotonic integer. The P2 projection fixed band (50–52) is exhausted (AMD-50 backfill / AMD-51 comparator / AMD-52 typed payload, all RATIFIED). Per the P2 renumbering decision §2 (allocation is forward/monotonic) and §6 (everything past the device/projection fixed bands is assign-at-milestone, all assessment numbers ≥ 46 non-binding), the unifier — authored now, ahead of Workstream C — correctly takes 53; the integration block's indicative range re-bases to 54+. Recorded in `context/decisions/2026-05-29_P2_AMD_Renumbering_Decision.md` (allocation note, 2026-05-31).

---

## 1. Problem

`StateProjection` sources the `EntityState` activity timestamps **two different ways across the replay/LIVE boundary**, and the LIVE way contradicts the documented contract. This is not a re-derivation from scratch — it is the ratification of the model Doc 03 §4.1 already states, plus the code fix that makes LIVE match it and restores replay-determinism.

### 1.1 The split (source-confirmed at HEAD `72596cb`)

- **LIVE** (`applyToState`, `StateProjection.java`): every materialization branch stamps the activity timestamps from the projection wall-clock `now = clock.instant()` (L784). The `state_changed` branch sets `lastChanged` **and** `lastUpdated` to `now` (L830, L831); the `state_reported` branch sets `lastUpdated` **and** `lastReported` to `now` (L794, L795); the `availability_changed` branch sets `lastUpdated` to `now` (L843); the supersession and "other" branches set `lastUpdated` to `now` (L818, L854).
- **Backfill** (`applyBackfillAttribute` via `backfillTimestamp`, the AMD-50 reconciliation replay): `lastChanged` is set to the **event-time** of the causing envelope — `eventTime ?? ingestTime` (`backfillTimestamp`, L895–898; applied at L939). The code carries an explicit `[REVIEW]` note (L918–921) flagging this as a "conscious interim" and naming the unifier as the follow-up.

So the **same observable fields** are event-time in the reconciliation path and wall-clock in the LIVE path.

### 1.2 A source finding that broadens the brief: all three activity timestamps diverge, not just `lastChanged`

The kickoff framing was "`lastChanged` event-time vs wall-clock," with `lastReported` tentatively assumed to already be log-time. **Source disproves the assumption.** `lastReported` is wall-clock in LIVE (`state_reported` branch, L795), and `lastUpdated` is wall-clock in every LIVE branch (L794/L818/L831/L843/L854). All **three** activity timestamps — `lastChanged`, `lastUpdated`, `lastReported` — are LIVE-wall-clock-sourced. Fixing two and leaving the third non-deterministic would be incoherent, so the unifier governs all three.

### 1.3 It is a live-exercised replay-determinism gap

Event-time `lastChanged`/`lastUpdated`/`lastReported` are replay-deterministic: `eventTime` and `ingestTime` are recorded on the immutable event (INV-ES-01) and read back identically on every rebuild. Wall-clock `clock.instant()` at projection time is recorded **nowhere** and is non-reproducible. AMD-52 made the `projectionVersion` 3→4 reconciliation a **live, exercised path** (it ran on first boot at `72596cb`). So the same "last activity" fields **provably diverge across every version-bump boundary**: a field stamped wall-clock in LIVE is re-stamped event-time when a bump triggers a reconciliation replay — checkpoint ≠ replay output for that field. This sits exactly in the path-dependence class AMD-50-INV-03 exists to forbid, in fields AMD-50 left as interim.

### 1.4 It already contradicts the documented contract (Doc 03 §4.1)

Doc 03 §4.1 specifies, for each field (L460–462):

- `lastChanged` — "The `event_time` (falling back to `ingest_time` if `event_time` is null) of the most recent event that altered an attribute value or availability."
- `lastUpdated` — "The `event_time` (falling back to `ingest_time`) of the most recent event processed for this entity, including events that did not alter state."
- `lastReported` — "The `event_time` (falling back to `ingest_time`) of the most recent `state_reported` event for this entity…"

The LIVE wall-clock code is a latent **doc/code mismatch** for all three, not just an internal inconsistency. Aligning LIVE to event-time brings the code into compliance with the contract the doc already states. The persistence schema corroborates the rule: `idx_events_event_time` is built on `COALESCE(event_time, ingest_time)` (Doc 01 §4.2) — the index already canonicalizes the exact `eventTime ?? ingestTime` fallback.

### 1.5 A latent determinism hole in entity adoption

`initialEntityState` (L947–958) seeds a brand-new entity's `lastChanged`/`lastUpdated`/`lastReported` from wall-clock `now`. The first processed event overwrites the fields it owns (e.g. `state_reported` overwrites `lastUpdated`/`lastReported`), but a field not yet touched **persists the wall-clock seed** — most visibly `lastChanged` for an entity that has only ever reported and never changed. For the invariant in §4 to hold end-to-end, adoption seeding must also be event-time-sourced, not wall-clock. This is in scope as the completion of the rule.

**Net:** this is closer to "ratify the model the doc already implies + fix LIVE (all three fields, plus adoption seeding) to match + restore determinism" than to "invent a new contract." It is small and bounded — the honest last mile of Workstream A.

---

## 2. Change Specification

### §2.1 — The event-time rule (Option A — ratified)

In `StateProjection`, the `EntityState` activity timestamps `lastChanged`, `lastUpdated`, and `lastReported` are sourced from the **causing envelope's event-time**: `eventTime ?? ingestTime` — the identical rule `backfillTimestamp` already applies (L895–898). Concretely:

- **`applyToState`** computes the event-time stamp once from the inbound `envelope` (the envelope is already in hand — no new plumbing) and uses it for every activity-timestamp write, in **every** branch:
  - `state_reported` → `lastUpdated` and `lastReported` = event-time (was `now`, L794/L795).
  - `state_changed` (LIVE, non-suppressed) → `lastChanged` and `lastUpdated` = event-time (was `now`, L830/L831).
  - `state_changed` (supersession, gate active) → `lastUpdated` = event-time (was `now`, L818); `lastChanged` remains suppressed per AMD-50 §2.2.
  - `availability_changed` → `lastUpdated` = event-time (was `now`, L843).
  - "other payload" → `lastUpdated` = event-time (was `now`, L854).
- **`initialEntityState`** (§1.5) seeds `lastChanged`/`lastUpdated`/`lastReported` from the **triggering event's** event-time, not wall-clock. (Pass the seed instant in: `applyToState` seeds from its `envelope`; `applyBackfillAttribute` seeds from its `causeEventTime`.) This closes the adoption-seeding hole so a never-changed/never-reported field is still a pure function of the log.
- **The backfill path is already compliant** (`applyBackfillAttribute` L939 sets `lastChanged` = event-time and preserves `lastUpdated`/`lastReported`, which — once their owning `state_reported` flows through the fixed `applyToState` — are themselves event-time). After this change, **LIVE and backfill agree by construction.**

`clock` remains injected on `StateProjection` for its legitimate real-time uses (reconciliation `reconciledAt` L675; `lastCheckpointAt` L689; `replayStartedAt`/replay-duration metric L693/L512; and the staleness machinery, §2.2). It is simply no longer the source of any `EntityState` activity timestamp.

### §2.2 — Carve-out: `staleAfter` / `stale` stay real-time (AMD-53-INV-02)

The event-time rule applies **only** to the three activity timestamps. `staleAfter` and `stale` are genuinely real-time freshness concepts and **stay wall-clock** — this is stated explicitly so the unifier is not misread as "no wall-clock anywhere on `EntityState`":

- `stale` is derived **at read time** from `staleAfter != null && Instant.now().isAfter(staleAfter)` (Doc 03 §4.1 L464, §3.8 lazy read-time + scanner). It is correctly non-deterministic: "is this entity stale **right now**" is a question about real elapsed time, not log time. A deterministic `stale` would be meaningless.
- `staleAfter`, when computed, is `event.eventTime() + resolvedThreshold` (Doc 03 §3.8 L412) — already event-time-derived and deterministic; it is a **target for real-time comparison**, not an activity timestamp. (Note: `applyToState` at `72596cb` carries `staleAfter` forward as `prior.staleAfter()` — threshold resolution is not yet wired; this amendment does not change that and does not introduce it.)

`staleAfter`/`stale` are therefore **explicitly excluded** from AMD-53-INV-01 and unchanged by this amendment.

### §2.3 — Determinism contract: extend AMD-50-INV-03 from the rule to the materialization

AMD-50 §2.4 made the `DerivationRule` a pure function of `(priorState, envelope)` with the clock removed — so the **rule** is deterministic. But the **projection's own state-application** still stamped wall-clock onto the materialized timestamps, so the materialized `EntityState` was not. This amendment closes that residual: with the activity timestamps sourced from `eventTime ?? ingestTime` (immutable log facts, INV-ES-01 / INV-ES-08), the materialized `EntityState` becomes a pure function of the event log across all three activity timestamps. AMD-50-INV-03 governed the rule; **AMD-53-INV-01 governs the materialization.**

### §2.4 — `projectionVersion` 4 → 5, riding AMD-50's frozen backfill (ratified)

This is a derivation-logic-adjacent change to how materialized state is stamped, so it bumps `projectionVersion` **4 → 5** and rides AMD-50's general N→M reconciliation discipline **unchanged** (AMD-50 §2.5) — exactly as the 3→4 AMD-52 transition did. On the upgrade boot, the reconciliation replay-from-zero re-materializes every entity under the unified event-time rule, **healing legacy wall-clock timestamps** so that checkpoint == replay output for all entities (not eventually, immediately). Cost: one bounded reconciliation replay on the upgrade boot — the same cost profile the project paid at 50/51/52 and just paid at AMD-52's 3→4.

**Load-bearing implementation caveat (Nick, 2026-05-31): the reconciliation replay must re-derive _all three_ activity timestamps from event-time, not just `lastChanged`.** Today the backfill helper (`applyBackfillAttribute`) is attribute-/`lastChanged`-focused; it preserves `lastUpdated`/`lastReported`. Those are owned by the inbound `state_reported`, which flows through `applyToState` during the replay. Therefore the heal is complete **only because** §2.1 fixes `applyToState`'s `state_reported` branch (and the adoption seeding, §1.5/§2.1) to event-time — the backfill helper alone does not touch `lastUpdated`/`lastReported`. The Coder WU MUST verify (and §5 tests MUST assert) that a 4→5 reconciliation produces event-time `lastUpdated`/`lastReported` as well as `lastChanged`, or the bump only half-corrects.

### §2.5 — No new plumbing, low blast radius

`applyToState` already receives the `EventEnvelope`; `eventTime()`/`ingestTime()` are public accessors (`ingestTime` never-null, `eventTime` nullable — `EventEnvelope.java`), so `eventTime ?? ingestTime` is always well-defined. The change is internal to `StateProjection` timestamp sourcing: no `module-info`/Gradle change, no event/checkpoint shape change, no attribute-value or `stateVersion` semantics change.

---

## 3. Worked scenarios

**3.1 — LIVE `state_changed`, before/after.** A light reports `brightness` changing at device-time `T_e` (the envelope's `eventTime`); the projection processes it at wall-clock `T_p > T_e`. **Today:** `lastChanged = lastUpdated = T_p` (L830/L831). **After:** `lastChanged = lastUpdated = T_e` (= `eventTime ?? ingestTime`). The displayed "last activity" now reflects when the change actually happened, and is reproducible on replay.

**3.2 — Divergence across a version bump (the core motivation).** Under the current code, entity E's `lastChanged` is `T_p` (LIVE wall-clock). A later `projectionVersion` bump triggers a reconciliation replay, which re-derives E's `lastChanged` to `T_e` (backfill event-time) — a **different value**. So E's "last activity" silently changes on every version bump. **After this AMD:** LIVE stamps `T_e` too, so the bump re-derives the **same** `T_e` — no divergence. (And the 4→5 bump itself, §2.4, heals any entity still carrying a pre-AMD wall-clock value.)

**3.3 — The `lastReported` finding (steady reporter).** A temperature sensor reports `21.0` every 30 s without changing value. Each report's `lastReported` should answer "when did the device last send a reading?" **Today:** `lastReported = T_p` (processing wall-clock, L795) — not reproducible, and drifts from the device's reported time. **After:** `lastReported = T_e` (the report's event-time) — reproducible on replay and faithful to the device clock, exactly as Doc 03 §4.1 L462 specifies. (`lastChanged` stays put across these no-op reports — correct — because no `state_changed` is derived.)

**3.4 — The 4→5 reconciliation heal.** First boot after the unifier ships: `loadedProjectionVersion()` = 4 ≠ code 5 → reconciliation (AMD-50 §2.2 gate active). The replay re-runs over the `state_reported` history: `state_reported` events flow through the fixed `applyToState` (event-time `lastUpdated`/`lastReported`), re-derived `state_changed` drafts flow through `applyBackfillAttribute` (event-time `lastChanged`), adoption seeds from event-time. At `onCaughtUp()` every entity's three activity timestamps equal a fresh-from-zero replay's — checkpoint == replay output. Attribute values and `stateVersion` are untouched (AMD-50-INV-01 holds; no second increment).

---

## 4. New invariants

- **AMD-53-INV-01 (event-time activity-timestamp determinism).** `EntityState.lastChanged`, `lastUpdated`, and `lastReported` are sourced from the causing envelope's `eventTime ?? ingestTime` — **never** from the projection wall-clock (`clock.instant()`) — in every projection path (LIVE `applyToState` all branches, reconciliation backfill, and entity-adoption seeding). They are therefore replay-deterministic: for a fixed event log they are identical across any rebuild path (from-zero replay, reconciliation backfill, steady-state catch-up). **Extends AMD-50-INV-03 from the `DerivationRule` to the projection's state materialization; brings the code into compliance with Doc 03 §4.1.**
- **AMD-53-INV-02 (real-time freshness carve-out).** `staleAfter` and `stale` are the **only** real-time-clock-dependent fields on `EntityState`: `stale` is derived at read time from `Instant.now()` vs `staleAfter`, and `staleAfter` (when resolved) is `eventTime + threshold` — a target for real-time comparison, not an activity timestamp. They are explicitly **excluded** from AMD-53-INV-01 and retain the Doc 03 §3.8 / §4.1 freshness semantics. (Guards against the unifier being misread as "no wall-clock anywhere.")

_(Registered into `governance/Architecture_Invariants_v1.md` as a new §23 at ratification — not at authoring.)_

---

## 5. Test requirements (verification gate for the unifier Coder WU)

Extend the existing `StateProjectionContractTest` + `ReconciliationTest` (do not greenfield).

1. **Headline determinism — LIVE ≡ replay-from-zero (all three fields).** Process a log LIVE, capture each entity's `lastChanged`/`lastUpdated`/`lastReported`; rebuild the same log from `position = 0`; assert the three timestamps are **identical** per entity. Must use a test `Clock` whose `instant()` differs from every envelope `eventTime`/`ingestTime`, so a wall-clock regression cannot pass. (This is the test that makes Nick's §2.4 caveat a gate: it fails if `lastUpdated`/`lastReported` are not event-time post-replay, not only `lastChanged`.)
2. **Event-time sourcing + fallback.** A `state_changed` (and a `state_reported`) whose `eventTime` ≠ processing wall-clock → the field equals `eventTime`. An envelope with `eventTime == null` → the field equals `ingestTime`. Cover all three fields and the `availability_changed` `lastUpdated`.
3. **Carve-out unchanged.** `stale` still flips based on real `Instant.now()` vs `staleAfter` (read-time and scanner paths), independent of the activity-timestamp change.
4. **Adoption-seeding determinism (§1.5).** A never-changed entity (only `state_reported` in its history) has a **deterministic** `lastChanged` across two independent rebuilds (it must be the seed event-time, not a wall-clock value).
5. **4→5 reconciliation heal (§2.4 / §3.4).** Materialize an entity under a wall-clock-stamped checkpoint (the legacy regime), then run the 4→5 reconciliation; assert the entity's three activity timestamps now equal a fresh-from-zero replay's, and that `stateVersion`/attribute values are unchanged (AMD-50-INV-01 preserved — no double-increment).
6. **No-op report keeps `lastChanged`.** A `state_reported` whose value matches canonical state advances `lastUpdated`/`lastReported` (to event-time) and `stateVersion`, but leaves `lastChanged` unchanged (Doc 03 §3.2 LIVE contract).

---

## 6. Scope — what this amendment does NOT do

- It does **not** touch the typed-value pipeline, the `AttributeValue` codec, or the event/checkpoint payload shapes. **Frozen and untouched:** AMD-52 typed `StateChangedEvent` payload + codec + Path A/B + `schema_version` 1→2; `projectionVersion` semantics beyond the 4→5 trigger; the AMD-50 reconciliation backfill discipline; the AMD-51 comparator; the `com.homesynapse.value` relocation.
- It does **not** change attribute **values**, `availability`, or the `stateVersion` cursor — only the **source** of three timestamp fields.
- It does **not** change `staleAfter`/`stale` semantics, nor wire staleness-threshold resolution (still deferred).
- It does **not** add per-attribute `changedAt` (Doc 03 future-work) or any `EntityState` shape change.
- It authors **no code** — the change lands in the teed-up `core/state-store` Coder WU, which must not start until this AMD ratifies.

---

## 7. Source anchors (verified against source at HEAD `72596cb` with the Read tool — STOP-on-Mismatch before implementation)

- **`StateProjection.applyToState`** (`core/state-store/.../StateProjection.java`, L782–860): `Instant now = clock.instant()` at **L784**; `state_reported` branch sets `lastUpdated`/`lastReported` = `now` (**L794/L795**); `state_changed` LIVE branch sets `lastChanged`/`lastUpdated` = `now` (**L830/L831**); `state_changed` supersession branch sets `lastUpdated` = `now` (**L818**); `availability_changed` branch sets `lastUpdated` = `now` (**L843**); "other" branch sets `lastUpdated` = `now` (**L854**). These are the writes §2.1 re-sources to event-time.
- **`StateProjection.backfillTimestamp`** (L895–898): `eventTime != null ? eventTime : ingestTime` — the existing event-time rule §2.1 reuses for LIVE.
- **`StateProjection.applyBackfillAttribute`** (L928–945): `lastChanged` = `causeEventTime` (event-time, **L939**); `lastUpdated`/`lastReported` **preserved** (L940/L941); `stateVersion` preserved (no increment, L938). The **`[REVIEW]` interim note** at **L918–921** explicitly flags the LIVE-wall-clock vs backfill-event-time split and names the unifier follow-up.
- **`StateProjection.initialEntityState`** (L947–958): seeds `lastChanged`/`lastUpdated`/`lastReported` from wall-clock `now` — the §1.5 adoption-seeding hole §2.1 closes.
- **`EntityState`** record (`core/state-store/.../EntityState.java`): 9 positional fields `(entityId, attributes, availability, stateVersion, lastChanged, lastUpdated, lastReported, staleAfter, stale)`; the three activity timestamps documented "never null."
- **`EventEnvelope`** (`core/event-model/.../EventEnvelope.java`): `ingestTime()` never-null ("system clock at append; always present; system-derived"); `eventTime()` nullable ("when the real-world occurrence happened; null if the source has no reliable clock"). Both immutable once persisted (INV-ES-01). `applyToState` holds the envelope → no new plumbing.
- **Doc 03 §4.1** (L460–464): the `lastChanged`/`lastUpdated`/`lastReported` = `event_time ?? ingest_time` contracts (the compliance target); `staleAfter`/`stale` real-time semantics (the carve-out). **Doc 03 §3.8** (L407–424): `staleAfter = eventTime + threshold`; `stale` lazy read-time + scanner against `Instant.now()`.
- **Doc 01 INV-ES-08** (§4 L404; narrative L744) + `idx_events_event_time = COALESCE(event_time, ingest_time)` (§4.2 L432): the `event_time` vs `ingest_time` distinction and the schema-level canonicalization of the exact fallback.
- **AMD-50 §2.4 + AMD-50-INV-03**: the determinism precedent (Clock removed from `DerivationContext`; rule = pure function of `(priorState, envelope)`) that this amendment extends from the rule to the materialization. **AMD-50 §2.5**: the general N→M backfill the 4→5 transition rides unchanged.

---

## 8. Implementing work unit (tee-up — DO NOT author the coding instruction until this AMD ratifies)

**The timestamp unifier — `core/state-store`** (one milestone, no `projectionVersion`-band ambiguity):

- **Change:** in `StateProjection`, source `lastChanged`/`lastUpdated`/`lastReported` from `eventTime ?? ingestTime` in **every** `applyToState` branch (§2.1), and seed `initialEntityState` from the triggering event-time (§1.5). Bump `projectionVersion` **4 → 5** at `HomeSynapseCore` (the trigger; rides AMD-50's frozen backfill — no new §3.2.4 refinement, AMD-50 §2.5).
- **Verify Nick's caveat (§2.4):** confirm the 4→5 reconciliation re-derives **all three** activity timestamps from event-time (the heal is complete only because `applyToState`'s `state_reported` branch and adoption seeding are fixed — the backfill helper alone does not touch `lastUpdated`/`lastReported`).
- **Tests:** per §5 — the headline LIVE≡replay test (1) is the gate; the 4→5 heal test (5) and adoption-seeding test (4) guard the caveat and the §1.5 hole.
- **Arch-rule reminder (§4c — state-store is NOT whitelisted):** tests MUST inject `Clock` and MUST NOT use `Clock.systemUTC()`, `Instant.now()`, `System.nanoTime()`, or `System.currentTimeMillis()` anywhere in test code; the ArchUnit rule `NO_DIRECT_TIME_ACCESS` scans non-whitelisted test classes and will fail `./gradlew check`. Use `Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC)` and pass the clock into constructors / `@BeforeEach`. (The test `Clock` must differ from the corpus's `eventTime`/`ingestTime` so a wall-clock regression cannot pass — see §5 #1.)
- **No** `module-info`/`build.gradle.kts` change; **no** typed-pipeline/codec/event-shape/attribute-value/`stateVersion`-semantics change.

---

## 9. Ratification checklist (for Nick)

Nick gave the four design-fork calls 2026-05-31; this checklist records them for the formal ratification step.

- [ ] **Option A (§2.1):** event-time everywhere for `lastChanged`/`lastUpdated`/`lastReported` (incl. the `availability_changed` `lastUpdated` and adoption seeding). _(Nick: confirmed — event-time everywhere; `staleAfter`/`stale` stay wall-clock.)_
- [ ] **Carve-out (§2.2 / AMD-53-INV-02):** `staleAfter`/`stale` stay real-time and are excluded from the rule.
- [ ] **`lastReported` finding (§1.2):** confirm the broadened scope (all three fields), not `lastChanged` alone.
- [ ] **`initialEntityState` seeding (§1.5):** confirm adoption seeding moves to event-time (closes the never-changed-field hole).
- [ ] **AMD number:** AMD-53 (next free monotonic integer); P2 renumbering-decision allocation note added; integration block re-bases to 54+. _(Nick: confirmed — take 53 cleanly.)_
- [ ] **`projectionVersion` 4→5 on AMD-50's backfill (§2.4):** confirm the bump, and that the reconciliation replay re-derives **all three** activity timestamps from event-time (not only `lastChanged`). _(Nick: confirmed — bump 4→5; replay must re-derive all three.)_
- [ ] **Invariants (§4):** AMD-53-INV-01 (event-time materialization determinism, extends AMD-50-INV-03) and AMD-53-INV-02 (real-time freshness carve-out) are correct.
- [ ] **On ratification:** Status → RATIFIED + Date applied; register AMD-53-INV-01/02 into `Architecture_Invariants_v1.md` (new §23 + §0.3 prefix + §17 index + §18 traceability); raise the on-disk watermark **AMD-52 → AMD-53** (`00-navigation-index.md` + amendments-table row); fold the Doc 03 §4.1 currency note (the contract already states event-time — add a "code brought into compliance by AMD-53" note, not a contract change); then the PM briefs the timestamp-unifier Coder WU (§8).

---

## 10. Provenance / authoring disposition

- **Every source fact in §1/§7 was Read-tool-verified against the working tree at HEAD `72596cb`** — the in-sandbox `git`/`grep`/`wc` is distrusted for this synced folder (standing lesson). The prompt's approximate line numbers were confirmed exact.
- **Two findings beyond the kickoff framing**, both source-driven: (a) `lastReported` is wall-clock in LIVE (L795), not log-time as tentatively assumed — broadening the rule to all three activity timestamps (§1.2); (b) `initialEntityState` seeds wall-clock (L947–958), a latent determinism hole for never-changed/never-reported fields (§1.5).
- **Nick's §2.4 caveat folded in:** the 4→5 reconciliation heal is complete only because `applyToState` (not just the backfill helper) is fixed — captured as a normative implementation requirement (§2.4/§8) and a verification gate (§5 #1, #5).
- Nothing frozen reopened (§6): the typed-value pipeline, codec, event/checkpoint shapes, AMD-50 backfill, AMD-51 comparator, and `com.homesynapse.value` relocation are untouched. This amendment changes **only** the `EntityState` activity-timestamp sourcing in the projection.
