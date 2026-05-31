# AMD-52: Typed `StateChangedEvent` Payload — `AttributeValue` Serializer, Schema-Versioned Replay, and Typed Materialization

**Amendment ID:** AMD-52
**Tier:** Tier-1 (architectural invariant)
**Status:** RATIFIED
**Date drafted:** 2026-05-31
**Date applied:** 2026-05-31
**Ratification (Nick + external review, 2026-05-31):** all §9 boxes approved. An independent review run in the HomeSynapse Core Claude Project returned **RATIFIED as-authored** — both forks confirmed: **F1** (bit-anchored `Double.doubleToLongBits` identity after AMD-51 §2.3 canonicalization; stored `"v"` text lossless-round-trippable, not byte-frozen; `chain_hash` stays the inert AMD-37 zero-reservation — confirmed `SqliteEventStore` writes `ZERO_HASH = new byte[32]`; if ever activated must hash the bit-anchored form) and **F2** (Path B legacy `schema_version=1` reads → defined `DegradedEvent`, raw preserved, version-gated in `EventPayloadCodec.decode`; **no** `AttributeValueUpcaster`/schema resolver in the codec — the layering argument decisive: persistence must not depend down into device-model schema knowledge; Path A authoritative for all state). The review independently re-derived the load-bearing source facts (DECIDE-M2-03 pre-declaration of the `AttributeValue` serde; `JsonSerializer` base class; the `persistence → transitive state → transitive device` graph; `CheckpointSerializer` `IllegalStateException`→reconciliation; the `FloatValue`/`QuantityValue` non-finite asymmetry). **Milestone id M4.0b-4 confirmed** (follows the M4.0b-1/-2/-3 projection-block sequence). On-disk amendment watermark raised **AMD-51 → AMD-52**. Implementing WU = **M4.0b-4** (gated only on this ratification; the AMD-51 §2.7 String-payload freeze is now lifted).
**Erratum (2026-05-31, M4.0b-4 instruction STOP-gate) — see §11.** The "no new module edge" finding (§2.2 / §6 / §7.1) is **corrected**: it analyzed the persistence codec's reachability of `AttributeValue` but not the edge created by the **typed field in the event-model record itself**. `StateChangedEvent` (in `com.homesynapse.event`) carrying an `AttributeValue` (in `com.homesynapse.device`) would force `event → device`, but `device → event` already exists → a JPMS cycle. **Resolution:** relocate the `AttributeValue` hierarchy (+ 8 variants + `AttributeType`) to a new `com.homesynapse.value` leaf module both event and device depend on (design note `homesynapse-core-docs/design/2026-05-31_AttributeValue_Module_Relocation_Design_Note.md`), landed as a behavior-preserving sub-WU **M4.0b-4a** ahead of the typed payload **M4.0b-4b**, gated on a compile-spike + review. **No ratified fork (F1/F2), the codec mechanism, or the 3→4 staging is reopened** — only the types' module home changes.
**Target documents:** Doc 01 (Event Model & Event Bus); Doc 03 (State Store & State Projection); Doc 04 (Persistence Layer)
**Target sections:** Doc 01 §4.6 (`StateChangedEvent` payload shape) + §3.10 (event-upcaster / `schema_version` seam); Doc 03 §3.2 (derivation emit) + §4.1 (`EntityState.attributes` materialization) + the projection checkpoint; Doc 04 §3.6 / §3.12 (`CheckpointSerializer`, `view_checkpoints`)
**Refines:** AMD-41 §3.2.4 (projection-version bump on materialized-output change); AMD-50 §2.1–§2.5 (frozen N→M reconciliation-backfill / supersession / cursor determinism — reused unchanged for 3→4); AMD-51 §2.6/§2.7 + §2.6 erratum (the transient-typed reconstruction; the String-payload preservation that this amendment now ends); AMD-47 §2.1–§2.4 + AMD-47-INV-01..05 (the 8-variant sealed hierarchy + canonicalize-at-construction); AMD-37 (`chain_hash` NOT-NULL zero-reservation — referenced, not activated); DECIDE-M2-04/06/07 (the Jackson-isolated codec + `EventPayloadCodec` boundary + `DegradedEvent` fallback)
**Source:** OQ-05-08 design beat `homesynapse-core-docs/design/2026-05-31_AMD-52_Typed_Payload_Serializer_Replay_Design_Beat.md`; Research 11 (Typed Event Payload Persistence) REC-100..105; PM Assessment `nexsys-hivemind/context/assessments/2026-05-31_Research_11_PM_Assessment.md` (§F §7 source-corrections); the four PM-under-delegation fork calls (Nick, 2026-05-31 — Q1 bit-anchored identity, Q2 `DegradedEvent` legacy-read contract, Q3 accept REC-100/102/103, Q4 author).
**Scope:** Workstream A / M4.0b-4. Authorises the typed `StateChangedEvent` payload (the `AttributeValue` (de)serializer S1, the typed checkpoint envelope S2), the per-event `schema_version` 1→2 marker, the schema-versioned replay contract (Path A authoritative; Path B = defined `DegradedEvent` for legacy rows), and the `projectionVersion` **3→4** bump riding AMD-50's frozen backfill. **This amendment authors no code** — the implementing WU is the **M4.0b-4 coding instruction** (PM Mode-3).
**AMD-allocation note:** Authored under the ratified P2 scheme (projection block 50–52, `nexsys-hivemind/context/decisions/2026-05-29_P2_AMD_Renumbering_Decision.md`). AMD-50 = projection rebuild/backfill/cursor; AMD-51 = typed comparator (String payload preserved); **AMD-52 (this) = typed payload + serializer + replay** — the cash-out of the AMD-51 §2.7 staging.

**Two ratification forks — both RESOLVED (Nick + external review, 2026-05-31):** **F1 — CONFIRMED:** bit-anchored float identity (`Double.doubleToLongBits`, REC-101); `chain_hash` stays the inert AMD-37 zero-reservation (NOT activated here). **F2 — CONFIRMED:** Path B legacy-read behavior is the **defined `DegradedEvent` contract** (REC-104 narrowed per Q2), NOT a decode-path upcaster lift. See the ratification block above.

---

## 1. Problem

AMD-51 (committed `98f705b`) made change-detection **typed**: `ProductionDerivationRule` reconstructs both operands to the schema-declared `AttributeValue`, compares them with the structural comparator + pinned epsilon, and — when a change is detected — emits a `state_changed`. But AMD-51 §2.7 deliberately kept the **payload `String`**: the emitted `StateChangedEvent` still carries `String oldValue/newValue`, and `StateProjection.applyToState` still materializes `new StringValue(sc.newValue())`. The typed values AMD-51 reconstructs are **transient** — discarded after the comparison.

This leaves three defects that AMD-52 closes:

### 1.1 The materialized state lies about its own types
`EntityState.attributes : Map<String, AttributeValue>` is `AttributeValue`-typed in the type system, but every entry is a `StringValue` (source-confirmed: `applyToState` ≈ L819 writes `new StringValue(sc.newValue())`; `applyBackfillAttribute` likewise; `CheckpointSerializer` flattens to `Map<String,String>` and rebuilds `new StringValue(v)`). A query/observability consumer that reads `attributes` gets a `StringValue("21.0")` where the schema says `FLOAT` / `QUANTITY`. This is the load-bearing fact behind AMD-51 §1.2 / AMD-51-INV-05 (the prior is *always* a `StringValue`, forcing symmetric reconstruction on every compare). AMD-52 is the amendment that **ends the materialized-String-only regime**.

### 1.2 The event payload throws away type identity that the rule already computed
`ProductionDerivationRule.evaluate` (source-confirmed, HEAD `98f705b`, L112–137) computes `inboundTyped` and `priorTyped`, uses them for the comparison, then **re-stringifies** them (`oldNonNull = priorStringForm(...)`, `newValue = sr.value()`) into a String-payload `StateChangedEvent` and emits `new EventDraft(EventTypes.STATE_CHANGED, 1, …)` — the literal `1` is the per-event `schemaVersion`. Downstream readers (the latent M7 automation triggers REC-91 named) must then **re-parse / re-guess** the type from the String, reintroducing exactly the format-fragility AMD-51 removed from change-detection. The typed value is right there at emit time; AMD-52 carries it into the payload.

### 1.3 A typed payload changes the materialized result — it must ride a version bump
Once `applyToState` materializes the typed value (S2) and the event carries it (S1), the materialized `attributes` map changes representation. Per AMD-41 §3.2.4 any change to the materialized projection result forces a `projectionVersion` bump + reconciliation rebuild. AMD-52 is therefore a **3→4** bump, riding AMD-50's frozen backfill unchanged (the fourth version on the same rails: 1→2 = M4.0b-2, 2→3 = AMD-51/M4.0b-3, 3→4 = AMD-52). The historical log holds **String-payload** (`schema_version = 1`) `state_changed`; Path A re-derives typed state from the immutable `state_reported` log (AMD-50/AMD-51 reconstruction), so no historical event is read for state and none is mutated.

---

## 2. Change Specification

The change crosses **two serialization surfaces** (the design-beat §1 structural fact), both confined to `core/persistence`, sharing one nested `AttributeValue` codec:

- **S1 — event payload:** `StateChangedEvent.oldValue/newValue` become `AttributeValue`; the codec serializes them inside the `events.payload` BLOB; the event is written at `schema_version = 2`.
- **S2 — projection checkpoint:** `CheckpointSerializer` materializes `attributes` as a typed envelope per entry inside the `view_checkpoints.data` BLOB.

### §2.1 — The `StateChangedEvent` type change (S1, headline)

`StateChangedEvent(String attributeKey, AttributeValue oldValue, AttributeValue newValue, EventId triggeredBy)`. `attributeKey`/`triggeredBy` unchanged. `newValue` is always non-null (the reconstructed inbound typed value). **`oldValue` first-report sub-decision (bounded, recommended default — F-side note):** today `oldValue` is the `""` empty-string sentinel when there is no prior; the typed analogue makes **`oldValue` nullable** (`null` ⇒ "no prior canonical value", the first-report case), keeping the compact-ctor non-null guard on `attributeKey`/`newValue`/`triggeredBy` only. Rationale: a sentinel `AttributeValue` (e.g. a synthetic `Degraded`) would pollute the type; nullability is the minimal, honest encoding and both readers (§2.6) already special-case first-report. *(Alternative considered: keep non-null and require a sentinel — rejected as type pollution. Flagged for Nick at §9.)*

No Jackson annotation is added to `StateChangedEvent` (Jackson-isolation HARD RULE + ArchUnit Rule 7 `NO_JSON_TYPE_INFO_IN_EVENTS`, which covers `com.homesynapse.event..` — source-confirmed).

### §2.2 — The `AttributeValue` codec (S1+S2 shared) — REC-100, gate G1

A **custom `JsonSerializer<AttributeValue>` / `JsonDeserializer<AttributeValue>` pair** registered in (or alongside) `PersistenceJacksonModule` in `com.homesynapse.persistence`, keyed by an **explicit `AttributeType` discriminator** — **NOT** `@JsonTypeInfo`, and **no Jackson annotation on `AttributeValue`** (which lives in `com.homesynapse.device`). This is the exact pattern `PersistenceJacksonModule` already uses for the 10 ULID/typed-identity pairs (LTD-04) and the expansion its own Javadoc **pre-declares**: *"`AttributeValue` serde is deliberately NOT registered here … the state-store milestone will add a dedicated handler … when the type becomes part of serialized payloads"* (DECIDE-M2-03, source-confirmed). Use `JsonSerializer`/`JsonDeserializer` (the repo precedent — `UlidSerializer extends JsonSerializer<Ulid>`), **not** `StdSerializer`/`StdDeserializer` (the Research 11 §7 nit).

**Wire form (REC-100):** a compact tagged-union envelope
```json
{"t":"<AttributeType>","v":<value>}
```
- `"t"` is `attributeType().name()` — the explicit string discriminator (one of `BOOLEAN/INT/FLOAT/STRING/ENUM/QUANTITY/ARRAY/DEGRADED`).
- `"v"` is the variant payload: scalar for `BooleanValue/IntValue/FloatValue/StringValue/EnumValue`; `QuantityValue` carries `{"v":<canonical-magnitude>,"u":"<canonical-unit>"}` (value + canonical unit symbol); `ArrayValue` **recurses the same envelope per element**, in order (`writeArrayFieldStart`), preserving the AMD-47-INV-05 ordered-List semantics; `DegradedAttributeValue` carries `originalTypeName`/`rawForm`/`failureReason`.
- The serializer's dispatch is an **exhaustive `switch` over the sealed 8-variant `AttributeValue`, no `default`** (permitted — D-01 is event-type-scoped; the serialization twin of AMD-51-INV-01). A future 9th permit MUST break compilation, not silently lossy-encode.
- Composes with the locked `PersistenceObjectMapper` config (`SNAKE_CASE`, `Include.NON_NULL`, `FAIL_ON_UNKNOWN_PROPERTIES` disabled, compact). Fields are written in **fixed order** (no map anywhere — REC-105 #3; map-ordering already cleared, no `Map` in any variant).

**Module edge (CORRECTED by §11 erratum).** The persistence-side reachability below is correct: `com.homesynapse.persistence requires transitive com.homesynapse.state`, `com.homesynapse.state requires transitive com.homesynapse.device`, so `AttributeValue`/`StringValue`/`AttributeValueUpcaster`/`AttributeType` are readable from persistence (proven live: `CheckpointSerializer` imports `com.homesynapse.device.AttributeValue`), and `JsonSerializer`/`JsonDeserializer` are in `jackson-databind` (already required) — **no new Jackson artifact / `libs.versions.toml` row.** **BUT the broader "no new `module-info` change" claim was wrong:** it missed that the typed field in `StateChangedEvent` (event-model) forces `event → device` while `device → event` already exists = a JPMS cycle. **Resolution (§11):** the `AttributeValue` hierarchy relocates to a new `com.homesynapse.value` leaf module; event/device/state/persistence gain `requires com.homesynapse.value`. So the module graph DOES change (the relocation, M4.0b-4a); the codec still adds no Jackson dependency.

### §2.3 — Float identity + IEEE-754 edge encoding — REC-101/102, gate G1/G2 (FORK F1)

**Bit-anchored identity (REC-101 / Q1).** `FloatValue`/`QuantityValue` identity is defined over the **decoded `double`**, anchored on `Double.doubleToLongBits` **after the AMD-51 §2.3 canonicalization** (`−0.0`→`+0.0`; canonical NaN) — the exact anchor AMD-51 §5 #5b already uses. The stored `"v"` text is required only to be **lossless round-trippable** (`parseDouble(render(x))` recovers the same bits), **not byte-frozen**. This dissolves the Schubfach `Double.toString` JDK-18→19 instability (REC-101 / JDK-8202555 / JDK-8291475): HomeSynapse never hashes or compares stored float *text*, so a future JDK upgrade changing the shortest rendering is harmless as long as round-trip holds (it did across that boundary). The codec therefore uses **whatever round-trippable `double` rendering Jackson emits** — no frozen canonical text renderer is owned (REC-101 option (b), the simplification Q1 noted for REC-100). **`chain_hash` is NOT activated by AMD-52** — it stays the AMD-37 NOT-NULL zero-reservation; **if it is ever activated (a future amendment), it MUST hash the bit-anchored canonical form, never the stored text.**

**Non-finite sentinels (REC-102 / Q3).** Standard JSON cannot carry `NaN`/`±Inf`; `FloatValue` can (no constructor guard — source-confirmed). Encode them as **JSON-valid sentinel strings** inside `"v"`: `NaN`→`"NaN"`, `+∞`→`"+Inf"`, `−∞`→`"-Inf"`, with a strict decoder that rejects unknown tokens. **`ALLOW_NON_NUMERIC_NUMBERS` stays disabled** — never emit bare `NaN`/`Infinity` (non-standard, breaks the forward-compat reader posture; the Python `json.dumps` / Sentry #1979 trap). `QuantityValue` rejects non-finite at construction (source-confirmed, L105–108) so its arm needs **no** sentinel branch. **`−0.0` stance:** the stored form canonicalizes `−0.0`→`+0.0` to stay coherent with the AMD-51 §2.3 comparator (which treats them equal); the value layer does not distinguish signed zero. *(Research 11 Caveat 4 flagged this as a domain question; the comparator already decided it — AMD-52 follows.)*

### §2.4 — The `schema_version` 1→2 write/read seam — gate G5 (CLOSED by the beat) + G2

**Write (the seam, source-confirmed).** `schema_version` is a **per-draft field** (`EventDraft.schemaVersion()`, written by `SqliteEventStore` ≈ L316 `ps.setInt(4, draft.schemaVersion())`), defaulting to `1` everywhere; the `@EventType` annotation carries only the type string (no version). AMD-52's typed `StateChangedEvent` draft is constructed with **`schemaVersion = 2`** — `ProductionDerivationRule.evaluate` changes its `new EventDraft(EventTypes.STATE_CHANGED, 1, …)` to `…, 2, …` and carries the **typed** payload. **No new `events`-table column and no migration** — the existing `events.schema_version INTEGER NOT NULL DEFAULT 1` column (V001) is the string(1)↔typed(2) discriminator (design beat §3, G5 CLOSED).

**Read / replay contract (G2):**
- **Path A — authoritative for all state.** The 3→4 reconciliation re-derives typed state from the **immutable `state_reported` log** (AMD-50 backfill + AMD-51 schema-driven reconstruction), now materializing the typed value (S2) and emitting typed (S1) instead of stringifying. Pure, clock-free, deterministic (AMD-50-INV-03). Historical `state_changed` rows are **superseded** (AMD-50 §2.2), never read for state, never mutated.
- **Path B — legacy forensic reads = defined `DegradedEvent` (REC-104 narrowed per Q2 — FORK F2).** Reading a legacy `schema_version = 1` String-payload `state_changed` under the post-AMD-52 typed reader yields a **`DegradedEvent`** carrying the raw String payload + reason — a **defined non-upcast, not a lossy upcast** (the raw bytes are preserved verbatim). `EventPayloadCodec.decode(eventType, schemaVersion, payload)` (which already receives the per-event `schema_version`) **version-gates** for `state_changed`: `schema_version ≥ 2` → typed decode; `schema_version == 1` → `DegradedEvent` (the existing two-stage fallback, made explicit by the version gate rather than relied upon incidentally). **No `AttributeValueUpcaster` and no schema resolver is wired into the decode path** — this avoids pushing device/state schema knowledge down into the persistence codec (the layering inversion + lossy-guess risk Nick's Q2 rejected). Typed forensic reads apply to `schema_version ≥ 2` going forward; Path A remains the sole authoritative state source. *(If lossless typed reads of legacy rows ever become a real need, that is a small follow-up amendment — YAGNI for MVP.)*

### §2.5 — The typed checkpoint envelope (S2) — gate G3

`CheckpointSerializer` materializes `attributes` as a **typed envelope per entry** (`Map<String, AttributeValue-envelope>`) inside the same `view_checkpoints.data` BLOB — the extension its own Javadoc anticipates verbatim (*"a typed envelope per entry, or a per-value polymorphic codec"*, source-confirmed). It reuses the §2.2 `AttributeValue` codec. Constraints, source-confirmed:
- **No `view_checkpoints` row migration** (G5) — richer JSON inside the existing BLOB.
- **Preserve the `Include.ALWAYS` null round-trip** — `CheckpointSerializer` requires a mapper that keeps nulls (nullable `staleAfter`, nullable attribute values); the `NON_NULL` default mapper drops them. The typed envelope must keep this (a separate `ALWAYS` mapper or per-field handling), and the deserializer must still tolerate `null` attribute values (`HashMap.put`, never `Map.copyOf`).
- **Deserialize-failure → AMD-50 reconciliation.** A typed checkpoint read by a pre-AMD-52 binary (or a schema-drifted read) throws `IllegalStateException` → the projection's lazy-init clear-and-replays (source-confirmed). The 3→4 `projectionVersion` mismatch makes this automatic. Confirm at coding that the typed-checkpoint deserialize-failure lands cleanly on reconciliation, not a hard error.

### §2.6 — Consumer blast radius (G4) — every reader migrated

Source-verified against HEAD `98f705b`:

| Consumer | Source site | Today | AMD-52 migration |
|---|---|---|---|
| `ProductionDerivationRule.evaluate` | state-store, L112–137 | reconstructs `inboundTyped`/`priorTyped`, then **stringifies** into a String `StateChangedEvent`, emits `EventDraft(…, 1, …)` | emit the **typed** `StateChangedEvent(key, priorTyped-or-null, inboundTyped, eventId)` at `EventDraft(…, 2, …)` — the values are **already computed**; drop the `priorStringForm`/`sr.value()` stringify. Headline change. |
| `StateProjection.applyToState` (`state_changed` branch) | state-store, L819 | `newAttrs.put(key, new StringValue(sc.newValue()))` | `newAttrs.put(key, sc.newValue())` — write the **typed** value (S2). The materialized prior stops being a guaranteed `StringValue`. |
| `applyBackfillAttribute` / `applyBackfillDraft` | state-store, L869–872 | writes `StringValue` during AMD-50 backfill | writes typed during the 3→4 backfill (Path A). |
| `CheckpointSerializer` | persistence | `Map<String,String>` flatten + `new StringValue(v)` rebuild | typed envelope per entry (§2.5). |
| `shouldPublishDerived` | state-store, L746–773 | `draft.payload() instanceof StateChangedEvent sc` → string-serialize current attribute, string-compare to `sc.newValue()` | must stay coherent on the **typed** materialized value: compare typed-to-typed (reuse the AMD-51 comparator / typed equality), not string-to-string — the AMD-51 §5 #10 coherence concern, now on the materialized side. Must neither manufacture nor suppress a genuine change. |
| `AttributeValueComparator` symmetric reconstruction (AMD-51 §2.6) | state-store | reconstructs the prior `StringValue` to typed before compare | **re-verify (AMD-51-INV-05 / §2.6-erratum coherence):** once the prior is **natively typed**, the reconstruction step is idempotent on an already-typed value and the comparator is total over the hierarchy (AMD-51-INV-01) — so the change is **benign**, but AMD-52 must re-confirm the prior-side reconstruction and the no-schema `StringValue` fallback still behave when the prior is the schema variant rather than a `StringValue`. |
| Query / observability / rest-api | state-store / observability / rest-api | read `EntityState.attributes` as `AttributeValue` (already typed in the type system) | **benign** — gain real variants instead of always-`StringValue`; no signature change. |
| Future M7 automation triggers/conditions | automation (not built) | would re-parse types from String old/new | **the payoff** — typed `oldValue`/`newValue` removes the re-parse; design the M7 contract against typed from day one. |

No non-benign migration surfaced (proviso-b discharged); the one bounded sub-decision is the §2.1 first-report `oldValue` nullability.

### §2.7 — Coherence with AMD-50 / AMD-51 (mandatory, no reopen)

- **AMD-50 frozen.** The N→M reconciliation-backfill / one-shot provenance gate / supersession / cursor-as-log-position is reused **unchanged** for 3→4. No new backfill mechanism. The AMD-50 supersession test remains the standing N→M regression guard; AMD-52's closeout re-confirms it guards 3→4.
- **AMD-51 §2.7 is now cashed out, not contradicted.** AMD-51 preserved the String payload *specifically so this swap could be staged*; AMD-52 performs it. The transient typed reconstruction AMD-51 introduced becomes the materialized + emitted value.
- **AMD-51-INV-05 / §2.6 erratum re-verified, not reopened** (the §2.6 consumer row): the comparator is total and the reconstruction idempotent on an already-typed prior, so ending the "prior is always `StringValue`" fact is benign — but AMD-52 states it explicitly.
- **No `Clock` reintroduced** to `DerivationContext` (AMD-50 §2.4); the codec, reconstruction, and rule stay pure functions of inputs.

---

## 3. Worked scenarios

**3.1 — Typed emit (headline).** A thermostat reports `temp = "21.5"`, `unit = "°C"`, schema `FLOAT`. The rule reconstructs `inboundTyped = FloatValue(21.5)`, `priorTyped = FloatValue(21.0)`; comparator → changed. AMD-52 emits `StateChangedEvent("temp", FloatValue(21.0), FloatValue(21.5), eventId)` at `schema_version = 2`; the codec writes `{"attribute_key":"temp","old_value":{"t":"FLOAT","v":21.0},"new_value":{"t":"FLOAT","v":21.5},"triggered_by":"…"}` into `payload`. `applyToState` materializes `FloatValue(21.5)`. No re-parse downstream.

**3.2 — Quantity round-trip.** `QuantityValue(21.0, "°C")` serializes `{"t":"QUANTITY","v":21.0,"u":"°C"}` (canonical magnitude + canonical unit); deserializes by constructing `QuantityValue(21.0,"°C")` (identity canonicalization). Bit-identical magnitude on round-trip (REC-101 / AMD-51 §5 #5b discipline).

**3.3 — NaN sentinel.** `FloatValue(Double.NaN)` serializes `{"t":"FLOAT","v":"NaN"}` (sentinel string, valid JSON); the strict decoder maps `"NaN"`→`Double.NaN`. A bare `NaN` token is never emitted (`ALLOW_NON_NUMERIC_NUMBERS` disabled). `+Inf`/`-Inf` likewise.

**3.4 — Legacy forensic read (Path B, FORK F2).** A `schema_version = 1` row `{"old_value":"21.0","new_value":"21.5",…}` is read post-AMD-52. `decode` sees `state_changed` + `schema_version == 1` → returns `DegradedEvent("state_changed", 1, "{…raw…}", reason)` — raw payload preserved, nothing lost, no typed guess. State is unaffected (Path A re-derived it from `state_reported`). No event mutated.

**3.5 — The 3→4 transition (Path A, rides AMD-50 §3.3).** First boot after AMD-52 ships: `loadedProjectionVersion() = 3 ≠ 4` → reconciliation, provenance gate active. The backfill re-derives each `state_reported` to typed via the AMD-51 schema-driven step and materializes the **typed** value; historical `schema_version = 1` `state_changed` are superseded (cursor advances, attribute write suppressed). Final `attributes` hold typed variants; `stateVersion` is path-independent (AMD-50-INV-01). No new §3.2.4 refinement — AMD-50 governs.

---

## 4. New invariants (PROPOSED — registered at ratification)

Allocated under the `AMD-52-INV-0N` convention (matching AMD-47/50/51). Registered into `Architecture_Invariants_v1.md` (new §22 + §17 index + §18 traceability), the persistence + state-store MODULE_CONTEXTs, and the navigation index at M4.0b-4 closeout.

- **AMD-52-INV-01 (typed payload; per-event `schema_version` discriminator; no row migration).** `StateChangedEvent.oldValue/newValue` are `AttributeValue` (`newValue` non-null; `oldValue` nullable = no prior, §2.1). The typed payload is written at `events.schema_version = 2`; the per-event `schema_version` column is the string(1)↔typed(≥2) discriminator. **No `events` and no `view_checkpoints` row/column migration** — the typed payload stays in-BLOB on both surfaces (G5).
- **AMD-52-INV-02 (custom non-reflective, Jackson-isolated codec, total over 8 variants).** `AttributeValue` is (de)serialized by a custom `JsonSerializer`/`JsonDeserializer` pair in `com.homesynapse.persistence`, keyed by an explicit `AttributeType` tag in the compact envelope `{"t":…,"v":…}`; dispatch is an exhaustive `switch` over the 8 permits with **no `default`** (a 9th permit breaks compilation). **No `@JsonTypeInfo`** (event host: ArchUnit Rule 7 `NO_JSON_TYPE_INFO_IN_EVENTS` over `com.homesynapse.event..`; device-resident `AttributeValue`: the Jackson-isolation HARD RULE — no Jackson annotation on `AttributeValue`/`StateChangedEvent`, no `com.fasterxml.jackson.*` import outside persistence). `ArrayValue` recurses the envelope per element in order; fields written in fixed order (no `Map` in any variant). No new `requires`, no new Jackson artifact.
- **AMD-52-INV-03 (bit-anchored float identity; round-trippable text; `chain_hash` not activated).** `FloatValue`/`QuantityValue` identity is `Double.doubleToLongBits` after the AMD-51 §2.3 canonicalization (`−0.0`→`+0.0`, canonical NaN). The stored `"v"` text is required only to be lossless round-trippable (`parseDouble` recovers the bits), never byte-frozen; no canonical text renderer is owned. `chain_hash` stays the AMD-37 zero-reservation (NOT activated by AMD-52); if ever activated it MUST hash the bit-anchored canonical form, never the text. (FORK F1.)
- **AMD-52-INV-04 (JSON-valid non-finite sentinels; no non-standard tokens).** `FloatValue` `NaN`/`±Inf` encode as the sentinel strings `"NaN"`/`"+Inf"`/`"-Inf"` with a strict decoder; `ALLOW_NON_NUMERIC_NUMBERS` stays disabled (no bare `NaN`/`Infinity`). `−0.0` canonicalizes to `+0.0` (coherent with AMD-51 §2.3). `QuantityValue` cannot carry non-finite (construction-rejected) and has no sentinel branch.
- **AMD-52-INV-05 (Path A authoritative; Path B = defined `DegradedEvent`; append-only).** The 3→4 reconciliation re-derives all materialized state from the immutable `state_reported` log (Path A; rides AMD-50/AMD-51 unchanged) — the sole authoritative state source. A legacy `schema_version = 1` String `state_changed` read under the typed reader yields a `DegradedEvent` with the raw payload preserved (a defined non-upcast, not lossy); the version gate lives in `EventPayloadCodec.decode` (which has `schema_version`). **No `AttributeValueUpcaster`/schema resolver is wired into the decode path.** No event is ever mutated (no `UPDATE`/`DELETE` on `events`). (FORK F2.)
- **AMD-52-INV-06 (typed checkpoint envelope, S2).** `CheckpointSerializer` materializes `attributes` as a typed envelope per entry (the Javadoc-anticipated extension) in the same `view_checkpoints.data` BLOB (no row migration), reusing the §2.2 codec; preserves the `Include.ALWAYS` null round-trip (nullable `staleAfter` + null attribute values); a deserialize failure lands on AMD-50 clear-and-replay reconciliation.
- **AMD-52-INV-07 (3→4 bump on frozen AMD-50).** Typed materialization + typed payload is a materialized-output change → `projectionVersion` **3→4**, riding AMD-50's frozen reconciliation-backfill unchanged; the AMD-50 supersession test guards the 3→4 transition. `shouldPublishDerived` is migrated to a typed-coherent comparison so it neither manufactures nor suppresses a genuine change.

---

## 5. Test requirements (verification gate for M4.0b-4)

Extend the existing suites (`EventPayloadCodecTest`, `CheckpointSerializer` tests, `StateProjectionContractTest`, `ReconciliationTest`, the derivation-rule tests); do not greenfield.

1. **Codec round-trip, all 8 variants (AMD-52-INV-02):** each `AttributeValue` variant serializes to `{"t":…,"v":…}` and deserializes back equal; `ArrayValue` recurses and preserves order; the dispatch `switch` has no `default` (a 9th permit breaks compilation — compile/ArchUnit assertion). No Jackson annotation on `AttributeValue`/`StateChangedEvent` (ArchUnit: Rule 7 for the event package + a `no com.fasterxml.jackson.* import outside persistence` assertion; consider extending Rule 7's predicate to `com.homesynapse.device`).
2. **Float bit-identity round-trip (AMD-52-INV-03):** for a corpus of doubles (incl. `1e23`, subnormals, the JDK-19-divergent values), `parseFloat(renderFloat(x))` is `Double.doubleToLongBits`-identical to the canonicalized `x`; assert identity is over the bits, never the text. `chain_hash` remains zero-default (unchanged) — assert no write touches it.
3. **Non-finite sentinels (AMD-52-INV-04):** `NaN`/`+Inf`/`-Inf` round-trip via sentinels; the decoder rejects unknown tokens; assert the serializer never emits a bare `NaN`/`Infinity`; `−0.0` serializes as `+0.0`; `QuantityValue` has no sentinel path (non-finite construction-rejected).
4. **`schema_version` 1→2 write (AMD-52-INV-01):** a typed emit produces a draft with `schemaVersion == 2`; the row's `schema_version` column is `2`; the typed payload round-trips through `decode(…, 2, …)`.
5. **Path B legacy read = `DegradedEvent` (AMD-52-INV-05, FORK F2):** a `schema_version == 1` String `state_changed` decoded post-AMD-52 returns a `DegradedEvent` with the raw payload preserved verbatim and a reason; assert no typed guess and no exception escapes; assert no `UPDATE`/`DELETE` SQL targets `events` (ArchUnit/test).
6. **Typed checkpoint round-trip (AMD-52-INV-06):** a state map with mixed typed variants (incl. a `null` attribute value and `null staleAfter`) serializes and rebuilds equal; a deserialize failure surfaces `IllegalStateException` → clear-and-replay; the `ALWAYS` null round-trip is preserved.
7. **3→4 transition + supersession (AMD-52-INV-07 / AMD-50 §5 #5):** a 3→4 reconciliation over a log of String `state_changed` + `state_reported` re-derives typed `attributes` (historical `state_changed` superseded, not applied); `stateVersion` matches processed-log-event count (path-independent, AMD-50-INV-01). The standing N→M regression guard still passes.
8. **`shouldPublishDerived` typed coherence (G4):** the typed-"unchanged" path emits nothing; the typed-"changed" path is not suppressed by the publish guard; assert the guard compares typed-to-typed, not string-to-string.
9. **Determinism + arch-rule (AMD-50-INV-03, §4c):** the codec, reconstruction, and rule are pure functions of inputs (no clock/I/O/randomness); **test code injects `Clock`** — no `Clock.systemUTC()`/`Instant.now()`/`System.nanoTime()`/`System.currentTimeMillis()` (persistence **and** state-store are non-whitelisted; `NO_DIRECT_TIME_ACCESS` scans test classes there and will fail `./gradlew check`).
10. **(Optional, REC-103) inline-BLOB Pi micro-benchmark:** append + full-stream replay at representative payload sizes; record GC under the 256 MiB heap with the compact envelope. A coding-instruction acceptance check, **not** an authoring gate.

---

## 6. Scope — what this amendment does NOT do

- It does **not** author production Java or issue a coding instruction. The implementing WU is the **M4.0b-4 coding instruction** (PM Mode-3), gated on this ratification.
- It does **not** introduce a new reconciliation/backfill mechanism — AMD-50 is **frozen** and reused unchanged for 3→4.
- It does **not** wire the `AttributeValueUpcaster` SPI into the decode path, nor change its signature (FORK F2 / Q2 — legacy reads are the defined `DegradedEvent` contract); the SPI stays as AMD-47 left it.
- It does **not** activate `chain_hash` (stays the AMD-37 zero-reservation, §2.3); it only specifies the bit-anchored form a future activation must use.
- ~~It does **not** add any `requires` to a `module-info.java`~~ **CORRECTED by §11 erratum** — the relocation adds the `com.homesynapse.value` module + `requires com.homesynapse.value` edges (event/device/state/persistence); it still adds **no** `libs.versions.toml` row and no new Jackson artifact (`jackson-databind` already present).
- It does **not** add a new `events`/`view_checkpoints` column or migration (typed payload is in-BLOB on both surfaces — G5).
- It does **not** reintroduce a `Clock` to derivation, change the AMD-51 comparator/epsilon, or re-specify unit normalization (AMD-47 canonicalize-at-construction stands).
- It does **not** bump `projectionVersion` itself — that is the M4.0b-4 code (the amendment specifies 3→4; the code performs it).

---

## 7. Source anchors + verbatim embeds (confirm against source before implementation — STOP-on-Mismatch)

Verified against `homesynapse-core` HEAD `98f705b` via the **Read tool on the working tree** (in-sandbox `git`/`grep` distrusted — line-ending churn on this synced folder; the standing M4.0a/M4.B3 lesson). A fabrication would diff visibly against these embeds (the Research 6 lesson).

### 7.1 Verbatim `module-info.java` — three modules (embed)

```java
// core/event-model/src/main/java/module-info.java
module com.homesynapse.event {
    requires transitive com.homesynapse.platform;
    exports com.homesynapse.event;
}

// core/device-model/src/main/java/module-info.java
module com.homesynapse.device {
    requires com.homesynapse.event;
    requires transitive com.homesynapse.platform;
    exports com.homesynapse.device;
}

// core/persistence/src/main/java/module-info.java   (Jackson lives ONLY here)
module com.homesynapse.persistence {
    requires transitive com.homesynapse.platform;
    requires transitive com.homesynapse.state;
    requires transitive com.homesynapse.event;
    requires transitive com.homesynapse.event.bus;

    requires java.sql;
    requires org.slf4j;

    requires com.fasterxml.jackson.core;
    requires com.fasterxml.jackson.databind;
    requires com.fasterxml.jackson.datatype.jsr310;
    requires com.fasterxml.jackson.module.blackbird;

    exports com.homesynapse.persistence;
}
```

```java
// core/state-store/src/main/java/module-info.java
module com.homesynapse.state {
    requires transitive com.homesynapse.platform;
    requires transitive com.homesynapse.device;   // ← device readable transitively from persistence via state
    requires transitive com.homesynapse.event;
    requires transitive com.homesynapse.event.bus;
    requires org.slf4j;
    exports com.homesynapse.state;
}
```

JPMS names are `com.homesynapse.event`, `com.homesynapse.device`, `com.homesynapse.persistence`, `com.homesynapse.state` (flat-package-per-module — **not** `…event.model` / `…device.model` / `…state.store`). **Persistence reads `com.homesynapse.device` transitively** (`persistence → transitive state → transitive device`), proven by `CheckpointSerializer` importing `com.homesynapse.device.AttributeValue`/`StringValue` and compiling at HEAD. ~~**AMD-52 requires NO `module-info` change.**~~ **CORRECTED by §11 erratum:** the persistence-reachability analysis was right, but it missed that `StateChangedEvent` (event-model) carrying an `AttributeValue` field forces `event → device` = a JPMS cycle. Resolution: relocate the value hierarchy to a new `com.homesynapse.value` leaf (design note `2026-05-31_AttributeValue_Module_Relocation_Design_Note.md`); the module graph DOES change. The embeds above are the **pre-relocation** HEAD `98f705b` state.

### 7.2 Verbatim `events` row + per-event version column + checkpoint table (V001, embed)

```sql
CREATE TABLE IF NOT EXISTS events (
    global_position   INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id          BLOB(16) NOT NULL,
    home_id           BLOB(16) NOT NULL,
    event_type        TEXT     NOT NULL,
    schema_version    INTEGER  NOT NULL DEFAULT 1,   -- per-event seam; AMD-52 writes 2 for typed StateChangedEvent
    ...
    payload           BLOB     NOT NULL,             -- typed payload lands HERE, no row change
    chain_hash        BLOB(32) NOT NULL DEFAULT x'0000000000000000000000000000000000000000000000000000000000000000',
    UNIQUE(subject_ref, subject_sequence)
);
CREATE TABLE IF NOT EXISTS view_checkpoints (
    view_name   TEXT    PRIMARY KEY,
    position    INTEGER NOT NULL,
    data        BLOB    NOT NULL,                    -- typed attribute envelope lands HERE, no row change
    updated_at  INTEGER NOT NULL
);
```

### 7.3 Verbatim `StateChangedEvent` (the type AMD-52 changes) + `AttributeValue` head (embed)

```java
@EventType(EventTypes.STATE_CHANGED)
public record StateChangedEvent(
        String attributeKey,
        String oldValue,        // AMD-52: → AttributeValue (nullable: null = no prior)
        String newValue,        // AMD-52: → AttributeValue (non-null)
        EventId triggeredBy
) implements DomainEvent { /* compact ctor: all non-null today */ }

public sealed interface AttributeValue
        permits BooleanValue, IntValue, FloatValue, StringValue, EnumValue,
                QuantityValue, ArrayValue, DegradedAttributeValue {
    Object rawValue();              // never null
    AttributeType attributeType();  // never null — the 8-value discriminator the codec keys on
}
```

Variant shapes (source-verified, HEAD `98f705b`): `BooleanValue(boolean)`; `IntValue(long)`; `FloatValue(double)` — **carries `NaN`/`±Inf`, no ctor guard**; `StringValue(String)` non-null; `EnumValue(String)` non-null; `QuantityValue(double value, String unit)` — canonicalized at construction, **rejects non-finite**; `ArrayValue(List<AttributeValue>)` — `List.copyOf`, ordered; `DegradedAttributeValue(String originalTypeName, String rawForm, String failureReason)`.

### 7.4 Verbatim Jackson version-catalogue rows (LTD-08 lock, embed — confirmed `gradle/libs.versions.toml`)

```toml
jackson                   = "2.18.6"
jackson-core              = { module = "com.fasterxml.jackson.core:jackson-core", version.ref = "jackson" }
jackson-databind          = { module = "com.fasterxml.jackson.core:jackson-databind", version.ref = "jackson" }
jackson-annotations       = { module = "com.fasterxml.jackson.core:jackson-annotations", version.ref = "jackson" }
jackson-datatype-jsr310   = { module = "com.fasterxml.jackson.datatype:jackson-datatype-jsr310", version.ref = "jackson" }
jackson-module-blackbird  = { module = "com.fasterxml.jackson.module:jackson-module-blackbird", version.ref = "jackson" }
```

Locked `PersistenceObjectMapper.create()` (DECIDE-M2-04, source-confirmed): `SNAKE_CASE`; `Include.NON_NULL`; `FAIL_ON_UNKNOWN_PROPERTIES` disabled (INV-ES-07); `WRITE_DATES_AS_TIMESTAMPS` disabled; `INDENT_OUTPUT` disabled; `JavaTimeModule` + `BlackbirdModule` + `PersistenceJacksonModule`; concurrent-deque recycler. The `AttributeValue` codec composes with this; note `NON_NULL` interacts with the envelope (omit-absent fields) — the checkpoint surface (§2.5) needs the `ALWAYS` mapper for the null round-trip. **No new Jackson artifact** — `JsonSerializer`/`JsonDeserializer` are in `jackson-databind`.

### 7.5 Other source anchors the M4.0b-4 coding instruction must confirm

- `EventPayloadCodec.decode(String eventType, int schemaVersion, byte[] payload)` — sole S1 boundary; already threads `schemaVersion`; two-stage `DegradedEvent` fallback (unknown type / parse failure). AMD-52 adds the explicit `state_changed` + `schema_version == 1` → `DegradedEvent` version gate (§2.4 / FORK F2). `encode` throws on an unregistered class (`DegradedEvent` never re-serialized).
- `SqliteEventStore` ≈ L316 `ps.setInt(4, draft.schemaVersion())` / L376 / L658 `rs.getInt("schema_version")` / L685 `codec.decode(eventType, schemaVersion, …)` — the write/read of the per-event `schema_version`. `EventDraft.schemaVersion()` defaults to `1`; the `@EventType` annotation has no version element (source-confirmed) — the version is set at draft construction.
- `ProductionDerivationRule.evaluate` — computes `inboundTyped`/`priorTyped`, currently stringifies (`priorStringForm`, `sr.value()`) and emits `new EventDraft(EventTypes.STATE_CHANGED, 1, …)`. AMD-52: emit the typed values at `schemaVersion = 2`.
- `StateProjection.applyToState` (`state_changed` branch, ≈ L819 `new StringValue(sc.newValue())`), `applyBackfillAttribute`/`applyBackfillDraft` (≈ L869–872), `shouldPublishDerived` (≈ L746–773). The S2 + emit-coherence sites (§2.6).
- `CheckpointSerializer.serialize/deserialize` + `toSerializable/fromSerializable` (`Map<String,String>` flatten + `new StringValue(v)` rebuild) + the verbatim "typed envelope per entry, or a per-value polymorphic codec" Javadoc — the S2 extension point (§2.5).
- `PersistenceJacksonModule` (the ULID/typed-identity precedent + the "`AttributeValue` serde … the state-store milestone will add a dedicated handler" pre-declaration, DECIDE-M2-03) and `PersistenceObjectMapper` (the same note). `UlidSerializer extends JsonSerializer<Ulid>` — the base-class precedent (§2.2; not `StdSerializer`).
- `AttributeValueUpcaster.upcast/canUpcast/upcastLenient` — **left unchanged** (§2.4 / FORK F2 — not wired into decode).
- `HomeSynapseArchRules.NO_JSON_TYPE_INFO_IN_EVENTS` — `noClasses().that().resideInAPackage("com.homesynapse.event..").should().beAnnotatedWith(@JsonTypeInfo)`. **Event-package-scoped**; the device-resident `AttributeValue` is covered by the Jackson-isolation HARD RULE, not this rule (§2.2 / AMD-52-INV-02; consider extending the predicate to `com.homesynapse.device`).
- AMD-50 §2.1–§2.5 (frozen) + AMD-51 §2.6/§2.7 + §2.6 erratum — the rails AMD-52 rides and stays coherent with.

---

## 8. Implementing work units

- **M4.0b-4 (the coding instruction this amendment gates)** — implements §2.1–§2.7: the `AttributeValue` `JsonSerializer`/`JsonDeserializer` pair (persistence; envelope §2.2; float/sentinel §2.3) registered on the mapper; the `StateChangedEvent` type change (String→`AttributeValue`, nullable `oldValue`); `ProductionDerivationRule` emitting the typed payload at `schemaVersion = 2`; `applyToState`/backfill writing typed (S2); the `CheckpointSerializer` typed envelope; the `shouldPublishDerived` typed-coherence migration; the `EventPayloadCodec` Path-B version gate (legacy → `DegradedEvent`); and the `projectionVersion` **3→4** bump riding AMD-50's backfill. The coding instruction **must include the §4c arch-rule test-`Clock` reminder** — both `com.homesynapse.persistence` and `com.homesynapse.state` are non-whitelisted; `NO_DIRECT_TIME_ACCESS` scans their test classes. **Confirm the M4.0b-4 milestone id with Nick** before issuing (proposed under M4.0b-x / projection-block-50–52; not locked).
- **Future (NOT this track):** `chain_hash` activation (if ever) — must hash the bit-anchored canonical form (§2.3); typed legacy forensic reads (if ever needed) — a small follow-up amendment (§2.4).

---

## 9. Ratification checklist (for Nick)

- [x] **FORK F1 — float identity / `chain_hash`.** Bit-anchored identity (`Double.doubleToLongBits` after AMD-51 §2.3 canonicalization; stored text only round-trippable, not byte-frozen; no owned canonical renderer) is correct, **and** `chain_hash` staying the inert AMD-37 zero-reservation (NOT activated by AMD-52; future activation must hash the bits) is confirmed (§2.3 / AMD-52-INV-03). **CONFIRMED.**
- [x] **FORK F2 — Path B.** Legacy `schema_version = 1` `state_changed` reads degrade to a defined `DegradedEvent` (raw preserved), via a version gate in `EventPayloadCodec.decode`, with **no** `AttributeValueUpcaster`/schema resolver pushed into the codec; Path A authoritative for all state; typed forensic reads apply to `schema_version ≥ 2` (§2.4 / AMD-52-INV-05). **CONFIRMED.**
- [x] The compact tagged-union envelope `{"t":…,"v":…}`, custom `JsonSerializer`/`JsonDeserializer` in persistence, exhaustive no-`default` switch, `ArrayValue` recursion, no new Jackson artifact (§2.2 / AMD-52-INV-02) is the intended wire form. _(The "no new module edge" sub-claim is CORRECTED by §11 — the value types relocate to `com.homesynapse.value`; the graph changes.)_
- [x] Non-finite sentinels + `ALLOW_NON_NUMERIC_NUMBERS` disabled + `−0.0`→`+0.0` (§2.3 / AMD-52-INV-04) is correct.
- [x] The `StateChangedEvent` first-report **`oldValue` nullability** (§2.1) is the right call (vs a sentinel `AttributeValue`).
- [x] Typed checkpoint envelope on the same `view_checkpoints.data` BLOB with the `ALWAYS` null round-trip preserved, deserialize-failure → AMD-50 reconciliation (§2.5 / AMD-52-INV-06) is correct.
- [x] `projectionVersion` **3→4** rides AMD-50's frozen backfill unchanged; the AMD-50 supersession test guards 3→4; `shouldPublishDerived` migrated to typed coherence (§2.7 / AMD-52-INV-07).
- [x] AMD-52-INV-01..07 are correct and ready to register into `Architecture_Invariants_v1.md` (§22 + §17 index + §18 traceability) + the persistence/state-store MODULE_CONTEXTs at M4.0b-4 closeout.
- [x] On ratification: set Status → RATIFIED + Date applied; raise the on-disk amendment watermark to **AMD-52**; the PM folds Doc 01/03/04 currency, registers the invariants, updates PROJECT_SNAPSHOT / pm-handoff / the design-track note, and may then brief the **M4.0b-4** coding instruction (after confirming the milestone id).

---

## 10. Provenance + assessment disposition

AMD-52 is authored from the OQ-05-08 design beat (which DECIDED G5 — no row migration — and the staging, and the codec *mechanism*; FRAMED G1/G2) and Research 11 (which informed the OPEN wire-form + replay forks). The PM 6-step A–F assessment (`nexsys-hivemind/context/assessments/2026-05-31_Research_11_PM_Assessment.md`) graded the research **A−**, source-verified every §7 type/module/version claim against HEAD `98f705b` (Research 6 anti-fabrication guard), and recorded three §7 refinements now folded into this amendment: (1) the codec needs **no new module edge** (persistence reads device transitively — §2.2 / §7.1); (2) base class is `JsonSerializer`/`JsonDeserializer`, not `StdSerializer` (§2.2); (3) ArchUnit Rule 7 is **event-package-scoped**, so the device-resident `AttributeValue` is governed by the Jackson-isolation HARD RULE (§2.2 / AMD-52-INV-02 / §7.5). The four fork calls (Nick, PM-under-delegation, 2026-05-31): **Q1** bit-anchored identity (F1); **Q2** `DegradedEvent` legacy contract (F2 — a deliberate narrowing of Research 11 REC-104, which had leaned toward a decode-path lift; Nick chose the defined-degrade contract to avoid the layering inversion); **Q3** accept REC-100/102/103; **Q4** author this session. No frozen item reopened (AMD-50, AMD-51 §2.7/§2.6, the `@JsonTypeInfo` ban, the no-`Clock` determinism rule). **RATIFIED 2026-05-31 (Nick + external review; F1/F2 confirmed).** One implementation-structural defect surfaced post-ratification and is resolved by the §11 erratum (the typed field's module home).

---

## 11. Erratum (2026-05-31) — event-model → device-model module cycle; `AttributeValue` relocates to `com.homesynapse.value`

**Discovered:** while authoring the M4.0b-4 coding instruction (the instruction's own STOP-on-Mismatch gate on the event-model→device-model edge fired before any code was written).

**The defect.** This amendment (§2.1) changes `StateChangedEvent` — a record in `com.homesynapse.event` — to carry `AttributeValue oldValue/newValue`, a type in `com.homesynapse.device`. For that record to compile, `com.homesynapse.event` must `requires com.homesynapse.device`. But source shows `com.homesynapse.device requires com.homesynapse.event` already (Read-tool-verified, HEAD `98f705b`). That is a **JPMS cyclic dependence** — the module graph will not compile. **The "no new module edge" finding (§2.2, §6 bullet, §7.1) is therefore incorrect:** it analyzed the *persistence codec's* reachability of `AttributeValue` (`persistence → transitive state → transitive device` — genuinely fine, no edge needed there) but not the edge created by the typed field **in the event-model record itself**. In hindsight AMD-51 §2.7's String-payload preservation was implicitly guarding exactly this boundary.

**Resolution (no ratified decision reopened).** Relocate the `AttributeValue` hierarchy — `AttributeValue` + the 8 variants + `AttributeType` (the self-contained set, importing only `java.base`) — out of `com.homesynapse.device` into a **new `com.homesynapse.value` leaf module** that both `com.homesynapse.event` and `com.homesynapse.device` depend on (`event → value`, `device → value`, `device → event` unchanged → acyclic DAG). `AttributeSchema` and `AttributeValueUpcaster` stay in device-model (they reference the value types via the new `device → value` edge; the upcaster is not on the AMD-52 path). Full spec: `homesynapse-core-docs/design/2026-05-31_AttributeValue_Module_Relocation_Design_Note.md`.

**What this changes vs the amendment body:**
- **§2.2 / §6 / §7.1 "no new `module-info` change" → corrected.** The relocation adds the `com.homesynapse.value` module and `requires com.homesynapse.value` edges on event, device, state, and persistence (the design note §4 specifies the minimal set; a compile-spike is the authority). The codec still lives in `core/persistence` and now declares `requires com.homesynapse.value` at its use site.
- **AMD-52-INV-02 wording → corrected.** "The codec adds no `requires` to any `module-info.java`" is superseded by the above; the *substance* of INV-02 (custom non-reflective codec, no `@JsonTypeInfo`, no new Jackson artifact, total over 8 variants, Jackson confined to persistence) is unchanged. The codec now serializes `com.homesynapse.value.AttributeValue` (package change only).
- **AMD-47 placement superseded (no contract change).** AMD-47 set these types' home in `com.homesynapse.device`; the relocation moves them to `com.homesynapse.value`. AMD-47-INV-01/-03/-04/-05 (sealing, canonicalize-at-construction, Degraded non-declarable, ArrayValue full-replacement) are unchanged and travel with the types. (AMD-47 carries a one-line forward-note.)

**Sequencing.** The relocation lands as **M4.0b-4a** — a pure, behavior-preserving refactor (package rename + `module-info` edges + import updates; no `projectionVersion` change, no semantics), built GREEN on its own commit — gated on a **JPMS compile-spike** (the empirical proof the cycle is gone; prose review twice missed this edge) plus an external-review pass. The typed payload (this amendment's §2.1–§2.7) then lands as **M4.0b-4b** on the clean graph, with the `AttributeValue` import path `device` → `value` and the event-model STOP-gate removed (the edge is now the legal `event → value`).

**Unchanged by this erratum:** F1 (bit-anchored identity / `chain_hash` inert), F2 (Path-B `DegradedEvent`, no decode-path upcaster), the codec mechanism (`{"t":…,"v":…}`, no `@JsonTypeInfo`), the `schema_version` 1→2 seam, the typed checkpoint envelope, and the `projectionVersion` 3→4 staging. This erratum corrects **where the types live**, not **what the amendment does.**
