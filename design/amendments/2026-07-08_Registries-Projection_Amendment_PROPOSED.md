# Device/Entity Registries as Projections of the Event Log (the DUR amendment)

**Document type:** CONTRACT-LEVEL AMENDMENT — **PROPOSED, RATIFICATION PENDING (Nick)**
**Date:** 2026-07-08
**AMD number:** assigned at ratification (the next in series; the on-disk watermark advances by one — per the in-flight-number convention this document does not pin it)
**Target documents:** Doc 01 (Event Model — new event types §4.3) · Doc 02 (Device Model — registry semantics §3.8/§3.12) · Doc 12 (Lifecycle — the Phase 3 boot rebuild)
**Ruling of record:** pm-handoff v24 beat-4 (Nick, verbatim, 2026-07-08): *"DUR — (i). Event-source the registries"* + guardrails G1 (this document) and G2 (bounded surface)
**Evidence base:** bench record iterations 3–5a (identity re-mint on every restart; orphan view rows; pin-2 unreachable); the completing survey at core `8800424` (pm-handoff v24 beat-4)

---

## §0 — RULING BOX (one turn: "ratify as recommended," or override by letter)

| # | Decision | REC / default |
|---|---|---|
| **R-A** | Payload shape: **(A) full-fidelity records in the events** — the log alone reconstructs the registries | **(A).** (B) fails the criterion (§2) |
| **R-B** | The invariant + its teeth: **ArchUnit rule `REGISTRY_MUTATION_ONLY_VIA_PROJECTION` ships IN the DUR WU** — enforcement arrives with the mechanism, not deferred | **Enforce now.** No N-2 deferral needed |
| **R-C** | Boot rebuild mechanism: **a registry-projection subscriber on the EXISTING bus replay machinery**, Phase 3 CORE_DOMAIN, completing before Phase 6 per the existing catch-up ordering invariant | **Subscriber.** One flagged addition (§5) |
| **R-D** | `device_removed` = first-class tombstone honored by the projection; orphans = **one-time bench events-DB wipe at 5b entry** (custody preserved), NOT a migration; new types are ADDITIVE | **As stated** |
| **R-E** | Mints: EventTypes **71→73** · @EventType records **41→43** · codec registrations **53→55** · +2 `EventCategoryMapping` rows · count-pin tests move in lockstep in the SAME change · register mints **one invariant** (174→175, new `REG` category 52→53) | **As stated** |

---

## §1 — Motivation (measured, not theoretical)

`HomeSynapseCore:347` constructs `new InMemoryDeviceRegistry()` on every boot (`entityRegistry` fresh at `:510`); nothing rehydrates either. Measured consequences (iterations 3–5a): adopted devices re-propose and re-adopt under NEW deviceId/entityId on every restart; the state view accumulates orphan rows (3 rows / 2 live devices on the bench); the re-link arm (`onRejoin`, DP-a pin-2) is structurally unreachable across restarts; entity-ID-bound automations cannot survive the very boot that loads them (automations load in Phase 3; identity re-mints in the same boot). The deeper defect the survey exposed: **the registries are imperative in-memory state, not derived from the log** — `DeviceAdoptedEvent` carries only an `entityId`; no event carries the device record, the entity records, the capabilities, or the bindings. This is the one place "everything is provably derived from the log" has a hole. This amendment closes it.

## §2 — The decision criterion, and the fork it settles (R-A)

**The criterion (Nick's, binding):** the ratified shape is the one that makes the registries a TRUE projection — *reconstructable from the log alone, as a pure function of replay, with the least denormalization/drift risk; the events carry everything the registries hold; a boot rebuild never reaches into live interview data again.*

- **(A) Full-fidelity record payloads.** The registration events carry the complete device + entity records, capabilities included. Replay alone rebuilds both registries and every derived map. Trade-off in one line: a larger payload schema (the capability forest rides in the event). **Meets the criterion.**
- **(B) Identity-binding payloads + boot re-derivation.** Events carry only minted IDs + binding facts; capabilities re-derive at boot from `zigbee-devices.json` + the profile registry. Trade-off in one line: light payloads — but the rebuild depends on a NON-LOG artifact (an adapter cache that can be deleted, drift, or lag its debounce) and on profile files whose change alters the rebuilt result, so the projection is not a pure function of replay. **Fails the criterion. Rejected.**

**Ratified: (A).** Denormalization note, stated honestly: under (A) the log stores capability schemas that also exist in profile files. This is correct, not waste — the event records *what was installed at adoption* (including the DP-a per-device confirmation tuning), which is precisely the fact a trust product must be able to prove later, independent of what profile files say today.

## §3 — The ratified record shapes (field-by-field)

**JPMS residency rule (the AMD-52 cycle class):** these records live in `com.homesynapse.event`, which must never reference device-model types. All payload components are therefore event-model-local nested records, leaf types, or `java.base`/platform-identity types. The nested mirrors below are ratified as FIELD CONTRACTS; exact Java naming is instruction-level, with a STOP gate requiring every registry-record component to be mapped or explicitly ruled out (full fidelity — no silent drops).

**Event 1 — `device_registered` (`DeviceRegisteredEvent`):**
`deviceId` (Ulid) · `deviceSlug` · `displayName` · `manufacturer` · `model` · `serialNumber?` · `firmwareVersion?` · `hardwareVersion?` · `integrationId` (String) · `areaId?` (Ulid) · `viaDeviceId?` (Ulid) · `labels` (List\<String>) · `hardwareIdentifiers` (List of {namespace, value} — the IEEE→deviceId map is derived from THIS, no separate field) · `createdAt` (Instant).

**Event 2 — `entity_registered` (`EntityRegisteredEvent`):**
`entityId` (Ulid) · `entitySlug` · `entityType` (String, enum name) · `displayName` · `deviceId` (Ulid) · `endpointIndex` (int) · `areaId?` · `enabled` (boolean) · `labels` · `entityRole` (String) · `createdAt` · **`capabilities`** (List of capability mirrors: `capabilityId` · `version` · `namespace` · `featureMap` · `attributes` (name → attribute-schema mirror) · `commands` (name → command-definition mirror) · `confirmation` (confirmation-policy mirror — the installed DP-a tuning, captured as adopted)).

**Emission contract:** `adopt()` publishes `device_registered`, then one `entity_registered` per created entity, then the existing `device_adopted` (RETAINED unchanged — additive; no existing consumer moves). Causal order: device before its entities. Subject refs: device-scoped / entity-scoped respectively.

**Boundary note (explicit):** the adapter's `profilesByIeee` map is adapter-local durable state whose home remains `zigbee-devices.json` (already restart-persistent). The registry invariant governs the CORE registries; the adapter's IEEE→id and binding maps rebuild FROM the rebuilt registries (hardwareIdentifiers + deviceId/endpointIndex), not from private events.

## §4 — The invariant, with teeth (R-B)

**The invariant (to be minted at ratification, new `REG` category):**
> **REG-INV-1 (registries are projections):** The device and entity registries are projections of the event log. Every registry mutation flows through a single projection-apply function whose only inputs are the registration/removal event types; at boot the registries are reconstructed by replaying those events; no other code path mutates registry state. Adoption-time writes use the SAME apply function (write-ahead: the event is durable before the in-memory apply; apply is idempotent by identity, so live bus delivery of a self-published event is a no-op).

**Enforcement, named and arriving WITH the mechanism (no deferral):** ArchUnit rule `REGISTRY_MUTATION_ONLY_VIA_PROJECTION` in `HomeSynapseArchRules` (app test classpath — production-code reach covers every module, the corrected-2026-06-13 reach note notwithstanding, since that caveat concerns non-app TEST code only): no class outside the registry-projection type may call the registries' mutating methods. The rule lands in the DUR WU itself and rides `./gradlew check` + CI — the gate of record — from day one. A projection invariant with no guard is how this regresses; this one ships guarded.

## §5 — The boot rebuild rides the existing seam (R-C — the P1 boundedness proof)

Home: **Phase 3 CORE_DOMAIN** (`HomeSynapseCore:501` region) — exactly where the registries, the state store, and the automation engine already initialize, upstream of Phase 6 INTEGRATIONS (`:705`). Mechanism: a **registry-projection subscriber** on the existing event-bus replay machinery (checkpointed like every subscriber; REPLAY→LIVE per the M3 lifecycle), consuming `device_registered` / `entity_registered` / `device_removed`. The composition root already encodes a Phase-3-before-Phase-6 catch-up ordering invariant (`:731` region names it) — the rebuild rides it: registries must be caught up to the log head before integrations resume and before automation definitions bind entity refs. **The one flagged addition (per your point 3):** if the WU's grounding survey finds no awaitable catch-up hook on that existing invariant, the sanctioned addition is ONE composition-root await on the projection reaching the log head — one await, not a subsystem; anything wider is a STOP-and-flag. Fallback realization if the subscriber path proves invasive (coder pushback welcome): a direct ordered read of the three event types from the store during Phase 3 — still a pure function of the log; the trade is uniformity (subscriber/DLQ/checkpoint semantics) vs simplicity.

## §6 — Tombstones and orphans, separated (R-D)

**Design mechanism (permanent):** `device_removed` — an EXISTING event type with zero production emitters today — becomes the first-class tombstone: the projection removes the device and its entities on replay and live delivery alike. Removal-event emission surfaces (REST/UI) remain future milestones; the projection honors the event from day one.
**One-time bench cleanup (not a migration):** the 3 orphan rows in the bench DB are pre-DUR history. At iteration 5b entry: **wipe the bench events DB once** (custody `data/zigbee/` preserved — the network resumes; the devices re-adopt under the new event flow, then the restart proves durability). No migration code, no backfill of synthetic registration events for pre-V1 data. **Additivity:** the new event types are additive; existing stored `device_adopted` rows replay untouched (per-type codecs).

## §7 — Mint arithmetic, explicit (R-E)

`EventTypes` constants **71 → 73** (+`device_registered`, +`entity_registered`; `device_removed` exists) · `@EventType` records **41 → 43** (+2) · persistence codec registrations **53 → 55** (+2) · `EventCategoryMapping` **+2 rows** (the P2 easy-miss, named here) · `AllEventClasses`/manifest aggregators +2 · `SubjectType` consumers checked. **Every count-pin test (`EventTypesTest`, `EventTypeRegistryTest`, `JacksonWarmupTest` et al.) moves in lockstep in the SAME change** — the M4.C lesson, applied at authoring. Register deltas at ratification: invariants **174 → 175**, categories **52 → 53** (new `REG`), watermark +1, the regeneration line updated — re-derived at the register, never copied.

## §8 — Sizing statement (G2) and out-of-scope

In: 2 event types + their nested payload mirrors (payload shape, not new event *types*) · 1 projection subscriber + the single-apply-path refactor of `adopt()`'s registry writes · 1 ArchUnit rule · `device_removed` projection handling · the full-restart identity IT (the leg `RestartHonestyIT` structurally cannot cover — it restarts only the integration). Out: any REST/UI removal surface · registry API reshaping · state-view projection changes (the view already keys on entity-scoped events; durable entity IDs fix its orphan accumulation going forward) · adapter cache redesign · any Doc 09 amendment. If authoring reveals a cascade beyond this list, the hub flags before dispatch — the G2 contract.

## §9 — Ratification actions (on Nick's word)

(1) Assign the next AMD number; rename this file to the `AMD-NN_` pattern. (2) Register edits: mint REG-INV-1 (§0.3, the §17 index, the §18 traceability row, the regeneration line: 175/53, watermark advanced). (3) Fold pointer notes into Doc 01 §4.3 / Doc 02 §3.8/§3.12 / Doc 12 Phase 3 per standing amendment practice. (4) The hub authors the DUR coding instruction AGAINST THIS RATIFIED TEXT (G1 discharged). Any edit Nick makes before ratifying folds verbatim; a contested clause is a conversation, not an improvisation.
