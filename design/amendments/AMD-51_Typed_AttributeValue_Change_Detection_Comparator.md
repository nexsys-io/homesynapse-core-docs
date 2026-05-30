# AMD-51: Typed `AttributeValue` Change-Detection Comparator

**Amendment ID:** AMD-51
**Tier:** Tier-1 (architectural invariant)
**Status:** RATIFIED
**Date drafted:** 2026-05-30
**Date applied:** 2026-05-30
**Ratification (Nick, 2026-05-30):** all nine §9 boxes approved — the five invariants, the four ratified strategic calls, the `absEps = relEps = 1e-9` epsilon lock (justified by the conversion-noise ceiling analysis + the §5 #5b tests, no separate sensor-capture gate), the OQ-05-09 symmetric-reconstruction resolution, the `projectionVersion` 2→3 mechanism (rides AMD-50 unchanged), the AMD-51-before-AMD-52 staging (String payload preserved), and the deadband deferral. On-disk amendment watermark raised **AMD-50 → AMD-51**. Implementing WU = **M4.0b-3** (gated only on this ratification; M4.B3/AMD-47 already committed `60b4185`, so its DP-1 upcaster-wiring carry lands inside M4.0b-3 — there is no intermediate M4.B3 session).
**Revision (external review incorporated, 2026-05-30):** HomeSynapse Core Claude Project review returned RATIFY-AS-IS, 0 blocking. PM verified its source claims against HEAD `60b4185` (Read tool) and **confirmed the load-bearing one**: the materialized `EntityState.attributes` holds `StringValue` exclusively (`applyToState` writes `new StringValue(sc.newValue())`; `CheckpointSerializer` "only writes StringValue"), so the prior side is **not** the schema-typed variant. §1.2 reworded and §2.6 / AMD-51-INV-05 sharpened to require **symmetric reconstruction of both sides** (prior stored String + inbound event String) before the typed compare. Accepted review improvements folded in: emit-predicate naming/Javadoc (§2.1), `canonicalUnitSymbol`-fallback WARNING + adapter-`unit` pre-merge gate (§2.6), conversion-noise + catalogue-expansion-backfill tests (§5). PM-added finding: the existing string-based `shouldPublishDerived` dedup must stay coherent with the typed rule (§7.4). Full disposition: §10.
**Target documents:** Doc 03 (State Store & State Projection); Doc 02 (Device Model & Capability System) — forward-reference only
**Target sections:** Doc 03 §3.2 (State Projection runtime model — the derivation rule's change-detect step); Doc 03 §4.1 (`EntityState.attributes` materialization)
**Refines:** AMD-41 §3.2.1 (READ/derivation step); INV-PROJ-01 (projection determinism); AMD-50 §2.4 / AMD-50-INV-03 (rule determinism, no clock); AMD-47 §2.1/§2.3/§2.4 (`QuantityValue`/`ArrayValue`/`DegradedAttributeValue` + canonicalize-at-construction); AMD-47-INV-01 (8-variant sealing), AMD-47-INV-04 (Degraded non-declarable/strict-mode exclusion)
**Source:** Research 10 (Typed Attribute Change-Detection Semantics) REC-90/REC-92/REC-93/REC-94/REC-95; PM Assessment `context/assessments/2026-05-30_Research_10_PM_Assessment.md` (v1 §7 source-corrections + v2 ratification addendum); the four ratified strategic calls (Nick, delegated to PM, 2026-05-30); design-track map `context/planning/2026-05-30_M4.0b-3_design-track-map.md` (NQ-10-1, NQ-10-5, NQ-10-6).
**Scope:** Workstream A / M4.0b-3. Authorises the typed change-detection comparator and the inbound-reconstruction step; bumps `projectionVersion` **2→3**, riding AMD-50's reconciliation-backfill discipline unchanged. **This amendment authors no code** — the implementing WU is the M4.0b-3 coding instruction.
**AMD-allocation note:** Authored under the ratified P2 scheme (projection block 50–52, `context/decisions/2026-05-29_P2_AMD_Renumbering_Decision.md`). AMD-50 is the projection-rebuild/backfill/cursor amendment; **AMD-51 (this) is the typed comparator**; **AMD-52 (typed `StateChangedEvent` payload) is a separate, staged amendment** behind its own serializer/replay design beat (OQ-05-08). The **String `StateChangedEvent` payload is preserved unchanged by AMD-51.**

---

## 1. Problem

The production change-detect rule (`ProductionDerivationRule`, package-private in `com.homesynapse.state`, reached via `DerivationRule.production()`) decides whether an inbound `state_reported` represents a change by **string comparison**: it stringifies the prior canonical value (`StringValue.value()` or `rawValue().toString()`) and compares it to `StateReportedEvent.value()` with `Objects.equals` (source-verified, §7.4). This was the correct M4.0b-1/M4.0b-2 scope (string compare on a stringly-typed inbound), but it is wrong for a typed canonical state:

### 1.1 Stringification conflates and loses type identity

`21.0` and `21.00` are different strings and therefore falsely "change"; `0.1 + 0.2` and `0.3` likewise. Each spurious difference emits a `state_changed`, advances `stateVersion`, and wakes automation triggers — a phantom-change event storm whose root cause is format fragility, not a real state change. Conversely, `21.0 °C` reported once as `"21.0"` and later canonicalized from `294.15 K` would compare unequal as raw strings even though the physical quantity is identical. The string rule cannot reason about Float FP-noise, `QuantityValue` dimensional equality, `ArrayValue` element structure, or the `DegradedAttributeValue` sentinel.

### 1.2 Both sides reach the comparator as serialized strings — neither is the schema-typed variant

This is the load-bearing structural fact (C5, source-confirmed, and sharpened by the external review). Two surfaces, both stringly-typed:

- The **inbound** value is `StateReportedEvent.value()` — a `String` (the record is all-`String`: `attributeKey, value, unit, rawProtocolValue, rawProtocolUnit`).
- The **prior** value comes from `EntityState.attributes` (a `Map<String, AttributeValue>`) — so it is `AttributeValue`-*typed* in the type system, **but the concrete instance is always a `StringValue`**, never the schema variant. Source-confirmed: `StateProjection.applyToState` writes `new StringValue(sc.newValue())` for every `state_changed` (and `applyBackfillAttribute` likewise during the AMD-50 backfill); `CheckpointSerializer` serializes attributes as `Map<String,String>` and rebuilds them as `new StringValue(v)` ("only writes StringValue"). The `state_reported` branch never writes the attributes map at all.

Therefore a naive comparator that compared the prior `StringValue("21.5")` against a reconstructed inbound `FloatValue(21.5)` would hit the type-mismatch arm and report "changed" on **every** report — defeating the amendment. **Both sides must be reconstructed to the schema-declared typed form before comparison** (§2.6). The 8-variant typed hierarchy and the `AttributeValueUpcaster` SPI already exist (AMD-47/M4.B3, committed `60b4185`), but no *schema-typed* value is materialized yet; the typed values produced for comparison are **transient** — the materialized state and the `StateChangedEvent` payload remain `String` (AMD-52 territory, §2.7). Wiring reconstruct-both-sides-then-typed-compare is exactly this amendment's M4.B3 DP-1 carry-in.

### 1.3 A typed compare changes change-detection outcomes — it must ride a version bump

Because typed compare suppresses differences the string rule emitted (`21.0` vs `21.00`; within-epsilon Float deltas), the same event log produces **fewer** `state_changed` and a **lower** `stateVersion` under the typed rule than under the string rule. That is a derivation-logic change, which per AMD-41 §3.2.4 forces a `projectionVersion` bump and a reconciliation rebuild. AMD-50 already authorised the general N→M reconciliation-backfill + supersession discipline and worked scenario 3.3 is *precisely* the 2→3 typed-comparator case — so AMD-51 rides AMD-50 unchanged and adds no new §3.2.4 refinement. The genuinely new wrinkle is that the historical log holds **string-form** `state_reported`, which the 2→3 backfill must reconstruct to typed before re-deriving (§2.6).

---

## 2. Change Specification

### §2.1 — The comparator contract (NQ-10-5, REC-90)

Introduce an **external comparator** in the state-store module:

```
// com.homesynapse.state — package-private impl + public static factory (DEC-M3-16 gateway)
public interface AttributeValueComparator {
    /**
     * Returns true iff a state_changed should be emitted for this attribute given the
     * prior canonical value and the reconstructed inbound value, under the supplied policy.
     * Total over the 8-variant AttributeValue hierarchy. Pure: no clock, no I/O, no randomness.
     */
    boolean changed(AttributeValue prior, AttributeValue inbound, ComparisonPolicy policy);

    static AttributeValueComparator structural() { return new StructuralAttributeValueComparator(); }
}
```

Binding contract notes:

- **Placement (NQ-10-5, DECIDED).** The comparator is an **external `AttributeValueComparator` in `com.homesynapse.state`** (state-store), co-located with `ProductionDerivationRule` and the inbound-reconstruction step so "reconstruct → compare" is one unit in one module. It is **NOT** a polymorphic method on the `AttributeValue` sealed interface. Rationale: the comparator carries a `ComparisonPolicy` (epsilon now, future deadband) that is *projection/state-store policy*, not *device-model data*; putting it on the device-model type would drag projection policy into the data layer. The device-model `AttributeValue` types remain pure data carriers. This is a deliberate, source-grounded refinement of the assessment v1 §F-5 lean (which floated a polymorphic method on the sealed interface) — the v2 ratification chose the state-store comparator.
- **Gateway (DEC-M3-16).** The implementation is **package-private** (`StructuralAttributeValueComparator`), reached through a **public static factory** (`AttributeValueComparator.structural()`), consistent with `DerivationRule.production()`, `StateQueryService.materialized()`, `StateCheckpointSource.stub()`, and `AtomicCheckpointSink.viewOnly()`.
- **Exhaustive `switch`, NO `default` (AMD-51-INV-01).** The comparator dispatches per-variant via an exhaustive `switch` over the sealed `AttributeValue` hierarchy with **no `default` arm**. A future 9th permit MUST break compilation, not slip through a catch-all. This is permitted: **D-01 is event-type-scoped** (no exhaustive switch over `DomainEvent`); an exhaustive switch over the sealed `AttributeValue` is idiomatic Java and is the intended use of sealing (AMD-47-INV-01).
- **`ComparisonPolicy`** is a small immutable carrier of the Float/Quantity epsilon parameters (`absEps`, `relEps`; §2.3) with a documented FP-noise default. It reserves the shape for a future per-attribute deadband (§2.5, deferred) but carries no deadband field in M4.0b-3.
- **Emit-predicate, not symmetric equality (naming).** `changed(...)` is deliberately an **emit predicate**: it answers "should a `state_changed` be emitted for this transition?", folding in the asymmetric Degraded rule (§2.4b) and the `prior == null` first-report case — it is **not** a pure symmetric equality. The method name and Javadoc MUST make this explicit (e.g., name it `changed`/`hasChanged`/`shouldEmitChange`, never `isEqual`/`compare`, and document the Degraded asymmetry + null-prior semantics) so a future reader does not assume symmetric-equality behavior. No current consumer needs a pure-equality variant (command-confirmation comparison already lives in the `Expectation` hierarchy — `ExactMatch`/`WithinTolerance`); if one ever does, factor the per-variant equality core out then.

### §2.2 — Per-variant comparison semantics (NQ-10-1, REC-90/92/93/94)

The comparator's verdict is "does this inbound value represent a change that should be recorded/emitted?" Per-variant:

| Variant | Semantics |
|---|---|
| `BooleanValue` | exact: `prior.value() != inbound.value()` ⇒ changed. |
| `IntValue` (`long`) | exact: `prior.value() != inbound.value()` ⇒ changed. |
| `EnumValue` (`String`) | exact: `!prior.value().equals(inbound.value())` ⇒ changed. |
| `StringValue` (`String`) | exact: `!prior.value().equals(inbound.value())` ⇒ changed. |
| `FloatValue` (`double`) | **total-form epsilon** (§2.3) over the IEEE-754 edge set — `FloatValue` can carry `NaN`/`±Inf`. |
| `QuantityValue` (canonical `double` + canonical `unit`) | If the two canonical **unit symbols differ** ⇒ different dimension ⇒ **changed** (and a likely schema violation worth surfacing). If the canonical units match ⇒ apply the §2.3 epsilon to the canonical magnitudes. Units are **already canonical at construction** (AMD-47, §2.4 below) — the comparator does **no unit lookup or conversion**. (`QuantityValue` construction rejects non-finite magnitudes, so `NaN`/`±Inf` cannot reach the comparator for QUANTITY — but the total-form rule is shared with `FloatValue` and is stated once.) |
| `ArrayValue` (`List<AttributeValue>`) | **size-then-element-wise, order-sensitive, deep** compare: different size ⇒ changed; else recurse the comparator element-by-element in index order; any element changed ⇒ changed. Full-replacement semantics (AMD-47-INV-05); no delta/patch. Element epsilon uses the same `policy`. |
| `DegradedAttributeValue` | per the REC-94 rule, §2.4 below. |

**Type-mismatch (prior and inbound are different variants).** When the reconstructed inbound and the prior are different concrete variants (other than the Degraded cases of §2.4), the value has changed ⇒ **changed**. (This should be rare under a stable schema; it is the honest verdict and keeps the comparator total.) **No prior value** (`prior == null`, first report for the attribute) ⇒ **changed** (unless inbound is Degraded, §2.4) — the inbound establishes the first canonical value.

### §2.3 — Float / Quantity epsilon (Call 2, REC-92) — the pinned total form

The comparator uses the **total combined absolute+relative** form (a pure relative epsilon is undefined/explosive near zero and is rejected):

```
changed  ⟺  |a − b| > max(absEps, relEps · max(|a|, |b|))
```

with **explicit IEEE-754 totality** (no implementation latitude):

- `NaN` ↔ number ⇒ **changed**
- `NaN` ↔ `NaN` ⇒ **unchanged**
- `+0.0` ↔ `−0.0` ⇒ **unchanged** (canonicalize `−0.0`→`+0.0` before compare)
- same-sign `Inf` ↔ same-sign `Inf` ⇒ **unchanged**
- opposite-sign `Inf`, or `Inf` ↔ finite ⇒ **changed**

**Defaults:** `absEps = relEps = 1e-9`. This is a **correctness (FP-noise) epsilon** — it answers "did the number actually change?" — **not** a perceptual deadband (which is deferred, §2.5). The default magnitude is verified against real M4 sensor data before locking (ratification checklist §9); the `ComparisonPolicy` makes it tunable without an amendment.

### §2.4 — `QuantityValue` units are free (Call 3, REC-93 — already satisfied by AMD-47)

`QuantityValue` **canonicalizes at construction** (AMD-47 §2.1 / AMD-47-INV-03, committed `60b4185`, source-confirmed §7.4): the constructor converts the supplied `(value, unit)` to the dimension's canonical unit and stores the canonical magnitude and canonical unit symbol. **Therefore both operands reach the comparator already in the same canonical unit, and the comparator does zero unit work** — the QuantityValue↔QuantityValue compare is canonical-magnitude epsilon (§2.3) plus the canonical-unit-symbol equality dimension check (§2.2). No JSR-385 / Indriya, **no LTD-10 dependency amendment**. This amendment **cites** AMD-47's canonicalize-at-construction; it does **not** re-specify unit normalization as new AMD-51 work. (Ledger note: Research 10 §4's "unit normalization at compare" and AMD-47's REC-93 "hand-rolled units" both carry the label REC-93; they converge — Research 10's collapses into what AMD-47 already shipped. Reconcile by aliasing at the next freshness pass; non-blocking.)

### §2.4b — `DegradedAttributeValue` change-detection semantics (REC-94, HA-mirrored)

`DegradedAttributeValue` is inert for change-detection except for the recovery case:

- **Inbound Degraded ⇒ never emit** (suppress). Do not overwrite a good canonical value, nor establish canonical state, with a degraded value. (Aligns with AMD-47-INV-04: a `DegradedAttributeValue` is never written to canonical state under strict mode. In the core projection's strict reconstruction path a degraded inbound should not normally arise — strict reconstruction halts on an un-reconstructable value rather than producing Degraded — but the comparator's rule is the defining contract regardless of how a Degraded inbound was produced.)
- **Prior Degraded + valid (non-Degraded) inbound ⇒ emit** (recovery — the canonical value recovers from a degraded state to a good one).
- **Two Degraded ⇒ unchanged.**

### §2.5 — Deadband: deferred (Call 1, REC-95) — reserve only

The optional per-attribute value-deadband is **not implemented in M4.0b-3**. Structural-equality + the §2.3 FP-noise epsilon is the M4.0b-3 scope. A deadband against the *last reported* value would require extra stored state not in the event log (replay-divergence risk) and suppresses *small real* changes (a missed-change policy decision that must not be made implicitly in MVP). When it lands, its home is **`AttributeSchema`** (already the per-attribute metadata carrier — `minimum`, `maximum`, `step`, `unitSymbol`, `canonicalUnitSymbol` live there, source-confirmed §7.4), analog types only, absent ⇒ exact/epsilon comparison (fully back-compatible). `ComparisonPolicy` reserves the shape so the future field threads through without a breaking change. **Not** on `CapabilityInstance` (the Research 10 §7 imprecision, C6).

### §2.6 — Inbound reconstruction (OQ-05-09 — RESOLVED) and `projectionVersion` 2→3

**The fork (OQ-05-09).** Reconstructing a typed inbound from `StateReportedEvent` is a *different operation* from the `AttributeValueUpcaster`'s job. The upcaster's contract is `upcast(String storedTypeName, String rawForm, int fromSchemaVersion)` (source-confirmed §7.4) — it **migrates already-stored typed values** across `AttributeValue` type changes (the value-layer analogue of the event upcaster), keyed by a **stored subtype name + schema version**, and takes **no unit**. Reconstructing a fresh `state_reported` String into the schema-declared type is a distinct, projection-layer concern.

**Resolution (RATIFIED): a separate schema-driven reconstruction step, applied symmetrically to BOTH sides, NOT an extension of the upcaster SPI.** The `AttributeValueUpcaster` SPI is **left unchanged** (no unit parameter added; it keeps its stored-value-migration contract and its M4.B3 DP-1 wiring for migrating stored values / `DegradedAttributeValue` `rawForm` across version transitions). Inbound reconstruction is a new state-store step that parses a serialized value keyed by **`AttributeSchema.type`** (the entity's capability schema for the reported `attributeKey`). **The same reconstruction is applied to the prior side**: per §1.2 the materialized prior is always a `StringValue` (or `null`), so its `value()` String is reconstructed by the identical schema-driven step before comparison — both operands reach the comparator as the schema-declared typed variant, and the produced typed values are transient (the stored attribute and the emitted payload stay `String`, §2.7). For QUANTITY the prior `StringValue` holds the already-canonical magnitude, so its unit is `AttributeSchema.canonicalUnitSymbol` (the inbound's unit source is below). The per-side input differs only in where the unit comes from; the parse-by-type logic is one function:

- `BOOLEAN`/`INT`/`FLOAT`/`STRING`/`ENUM` → parse the String into the corresponding variant.
- `QUANTITY` → construct `QuantityValue(parseDouble(value), unit)` where **`unit` comes from `StateReportedEvent.unit`** (source-confirmed: the event carries `unit`, documented as the canonical unit for physical quantities). The `QuantityValue` constructor canonicalizes (identity conversion when the unit is already canonical, which it is per the `StateReportedEvent.value` "canonical (SI or standard units)" contract). If the event `unit` is absent/blank, fall back to `AttributeSchema.canonicalUnitSymbol`. If neither yields a recognised unit, reconstruction fails → the Degraded path (§2.4b: inbound Degraded ⇒ never emit).
- `ARRAY` → reconstruct elements per the schema's element type (full-replacement).
- A parse/reconstruction failure follows the strict-mode discipline (halt) or yields a Degraded inbound that the comparator suppresses (§2.4b) — the M4.0b-3 coding instruction fixes which, consistent with AMD-47-INV-02/-04.

**The one genuinely open empirical item — adapter-emit consistency.** Reconstructing a `QuantityValue` from the event depends on adapters actually populating `StateReportedEvent.unit` for QUANTITY attributes. The `canonicalUnitSymbol` fallback carries a **silent-data-corruption risk** the review surfaced: if an adapter sends a *non-canonical* magnitude (e.g. a Fahrenheit value) with `unit = null`, the fallback would construct `QuantityValue(fahrenheitMagnitude, canonicalUnitSymbol)` — treating a non-canonical number as canonical and materializing garbage. Mitigation, **mandatory in the M4.0b-3 coding instruction (pre-merge gates, not optional):**
- The reconstruction **MUST log a WARNING** (with `attributeKey` + entity id) whenever it uses the `canonicalUnitSymbol` fallback because `StateReportedEvent.unit` was null/blank for a QUANTITY attribute — the cheapest signal that an adapter is misconfigured.
- **Verify against what adapters actually emit** for a QUANTITY attribute, and add an integration-test-level assertion that every QUANTITY `StateReportedEvent` a harness publishes carries a non-null `unit`. Every integration adapter handling QUANTITY attributes must populate `unit`.

This is narrow and changes none of the ratified calls; it is a coding-instruction gate, not an amendment-text change.

**`projectionVersion` 2→3 (NQ-10-6).** The typed rule bumps `projectionVersion` 2→3 at `HomeSynapseCore`, triggering AMD-50's reconciliation-backfill. **AMD-50's mechanism is reused unchanged** (frozen — §6); AMD-50 worked scenario 3.3 *is* this 2→3 case. The new wrinkle: the historical `state_reported` log carries the **same String record with its `unit`**, so the 2→3 backfill reconstructs typed inbound values with the **identical** schema-driven step used on LIVE — making reconstruction-then-compare deterministic across LIVE and backfill (AMD-50-INV-03). The AMD-50 supersession test (AMD-50 §5 #5) remains the standing N→M regression guard; the M4.0b-3 closeout confirms it still guards the typed rule (a spurious prior-version `state_changed` is superseded by the typed rule's re-derivation).

### §2.7 — The `StateChangedEvent` payload is preserved (Call 4, REC-91 staging)

AMD-51 changes only the **comparison**. When the comparator returns `changed == true`, `ProductionDerivationRule` constructs the **same `StateChangedEvent` with String `oldValue`/`newValue`** it constructs today (the existing serialized form; `newValue = StateReportedEvent.value()`, `oldValue` = the stringified prior). The typed `AttributeValue` payload swap is **AMD-52**, staged behind its own serializer/replay design beat (OQ-05-08) and **not authored here**. The comparator returning a boolean while the rule still stringifies for the payload is fully separable — staging costs nothing and de-risks the serializer/replay surface. Do **not** touch `StateChangedEvent`, `CheckpointSerializer`, or the event-store payload shape in AMD-51 / M4.0b-3.

---

## 3. Worked scenarios

**3.1 — Float FP-noise suppression (the headline).** Under version 2 (string compare) a sensor reported `temp = 20.0` then `temp = 20.0000001`; the strings differ, so version 2 emitted `state_changed(20.0 → 20.0000001)`. Under version 3, the inbound `"20.0000001"` reconstructs to `FloatValue(20.0000001)`; the prior is `FloatValue(20.0)`; `|20.0000001 − 20.0| = 1e-7 > max(1e-9, 1e-9·20.0) = 2e-8`? → `1e-7 > 2e-8` is **true** ⇒ changed. (With `1e-9` defaults a `1e-7` delta still registers — the FP-noise epsilon is deliberately tiny. A `20.0` vs `20.0000000001` delta of `1e-10 < 2e-8` ⇒ unchanged.) The point: genuine FP noise below epsilon is suppressed; real deltas pass. The default magnitude is verified against M4 sensor data before lock (§9).

**3.2 — Quantity dimensional equality, no unit work.** A thermostat reports `"21.0"` with `unit = "°C"`; later an adapter reports `"294.15"` with `unit = "K"`. Reconstruction builds `QuantityValue(21.0, "°C")` and `QuantityValue(294.15, "K")`; the constructor canonicalizes the second to `(21.0, "°C")`. The comparator sees two `QuantityValue`s with identical canonical unit `"°C"` and canonical magnitude `21.0` → within epsilon → **unchanged**. No spurious change across a unit-of-report difference; the comparator did no conversion (AMD-47 did it at construction).

**3.3 — Array full-replacement, order-sensitive.** Prior `ArrayValue[IntValue(1), IntValue(2)]`; inbound reconstructs `ArrayValue[IntValue(2), IntValue(1)]`. Same size; element 0 `1 vs 2` ⇒ changed ⇒ emit. A reorder is a change (order-sensitive); a full-value replacement is the only semantic (no element-merge), per AMD-47-INV-05.

**3.4 — Degraded recovery.** Prior is `DegradedAttributeValue("FloatValue", "NaNsnt", "parse failure")` (a forensic artifact that somehow reached the prior side); inbound reconstructs cleanly to `FloatValue(22.5)`. Prior-Degraded + valid inbound ⇒ **emit** (recovery). Conversely, a clean prior `FloatValue(22.5)` with an inbound that fails reconstruction (Degraded) ⇒ **never emit** — the good canonical value is not overwritten.

**3.5 — The 2→3 transition (generality, rides AMD-50 §3.3 unchanged).** First boot after the typed rule ships: `loadedProjectionVersion() = 2 ≠ 3` → reconciliation, provenance gate active. The historical log holds String `state_reported` (and version-2 `state_changed`). The backfill reconstructs each `state_reported` to typed via the §2.6 schema-driven step and re-derives with the version-3 comparator; spurious version-2 `state_changed` (e.g. the `20.0 → 20.0000001` of 3.1, if below epsilon) are **superseded** (AMD-50 §2.2) — they advance `stateVersion` as log events but their attribute writes are suppressed. Final materialized attributes reflect the version-3 rule; `stateVersion` is path-independent (AMD-50-INV-01). No new §3.2.4 refinement — AMD-50 governs.

---

## 4. New invariants

Allocated under the amendment-scoped `AMD-51-INV-0N` convention (matching `AMD-47-INV-0N` / `AMD-50-INV-0N`). All are **PROPOSED** until ratification (§9) and are registered into `Architecture_Invariants_v1.md` (new §21 + §17 index + §18 traceability) and the state-store MODULE_CONTEXT at M4.0b-3 closeout, following the AMD-47 precedent.

- **AMD-51-INV-01 (typed total comparison, exhaustive no-`default`).** Change detection over `AttributeValue` is a **total** function realized by an exhaustive `switch` over the 8-variant sealed hierarchy with **no `default` arm** — a future permit MUST break compilation. Per-variant semantics are §2.2 (exact for Boolean/Int/Enum/String; total-form epsilon for Float; canonical-magnitude epsilon + canonical-unit dimension check for Quantity; size-then-order-sensitive deep compare for Array; the §2.4b rule for Degraded). D-01 (no exhaustive switch over **event** types) does not apply — it is event-type-scoped; an exhaustive switch over the sealed `AttributeValue` is permitted (AMD-47-INV-01).
- **AMD-51-INV-02 (epsilon totality, pinned).** Float and same-dimension Quantity comparison uses the total form `changed ⟺ |a − b| > max(absEps, relEps · max(|a|, |b|))` with the IEEE-754 totality of §2.3 (`NaN`↔number = changed; `NaN`↔`NaN` = unchanged; `−0.0` == `+0.0`; same-sign `Inf` = unchanged; opposite-sign or finite↔`Inf` = changed). A pure relative epsilon is rejected. Defaults `absEps = relEps = 1e-9` are a correctness (FP-noise) epsilon, not a perceptual deadband; carried in `ComparisonPolicy`, deterministic, no clock/I/O/randomness.
- **AMD-51-INV-03 (Degraded change-detection semantics).** Inbound `DegradedAttributeValue` ⇒ never emit; prior `DegradedAttributeValue` + valid inbound ⇒ emit (recovery); two `DegradedAttributeValue` ⇒ unchanged (REC-94, HA-mirrored). Consistent with AMD-47-INV-04 (Degraded never enters canonical state under strict mode).
- **AMD-51-INV-04 (comparator placement + gateway).** The comparator is an external `AttributeValueComparator` in `com.homesynapse.state` carrying a `ComparisonPolicy`, **not** a method on the `AttributeValue` sealed interface — projection/epsilon policy is kept out of the device-model data layer. The implementation is package-private behind a public static factory (DEC-M3-16 gateway), consistent with `DerivationRule.production()`, `StateQueryService.materialized()`, `StateCheckpointSource.stub()`.
- **AMD-51-INV-05 (symmetric reconstruction; typed compare rides 2→3 unchanged on AMD-50).** **Both** comparison operands are reconstructed to the schema-declared typed `AttributeValue` before comparison, by one **schema-driven parse keyed by `AttributeSchema.type`**: the inbound `StateReportedEvent.value` (QUANTITY unit from `StateReportedEvent.unit`, fallback `AttributeSchema.canonicalUnitSymbol`) **and** the prior materialized value, which is always a `StringValue` (or `null`) — never the schema variant — and so is reconstructed from its `value()` String (QUANTITY unit from `canonicalUnitSymbol`). The produced typed values are transient; the materialized attribute and the emitted payload stay `String` (§2.7). This reconstruction is **distinct from** the `AttributeValueUpcaster` stored-value-migration SPI, which is left unchanged. Because typed compare alters change-detection outcomes vs the string rule, it rides a `projectionVersion` **2→3** bump on AMD-50's reconciliation-backfill path **unchanged**; reconstruction is identical on LIVE and on the 2→3 backfill (determinism, AMD-50-INV-03), and the AMD-50 supersession test remains the N→M regression guard.

---

## 5. Test requirements (verification gate for M4.0b-3)

These are the contract tests M4.0b-3 must satisfy; listed so the amendment is verifiable, not so this session writes them. Extend the existing state-store suites (`StateProjectionContractTest`, `ReconciliationTest`, and the derivation-rule tests); do not greenfield.

1. **Exhaustiveness (AMD-51-INV-01):** a compile/ArchUnit test asserts the comparator `switch` over `AttributeValue` has no `default` and handles all 8 variants — adding a 9th permit must fail compilation.
2. **Per-variant semantics (AMD-51-INV-01):** exact equality for Boolean/Int/Enum/String (incl. `21` vs `21` no-change, distinct values change); Array size-mismatch, element-change, and reorder each ⇒ changed, identical ⇒ unchanged; type-mismatch ⇒ changed; `prior == null` ⇒ changed (non-Degraded inbound).
3. **Float/Quantity epsilon totality (AMD-51-INV-02):** within-epsilon delta ⇒ unchanged; above-epsilon ⇒ changed; the full IEEE edge table (`NaN`↔number, `NaN`↔`NaN`, `−0.0`/`+0.0`, same-sign `Inf`, opposite-sign `Inf`, `Inf`↔finite); `QuantityValue` same-canonical-unit magnitude compare and differing-canonical-unit ⇒ changed; assert the comparator performs **no unit conversion** (canonical operands only).
4. **Degraded semantics (AMD-51-INV-03):** inbound Degraded ⇒ no emit; prior Degraded + valid inbound ⇒ emit (recovery); two Degraded ⇒ no emit.
5. **Reconstruction, both sides (AMD-51-INV-05):** a String `state_reported` reconstructs to the schema-typed variant, and the prior `StringValue` reconstructs by the **identical** step (assert a prior `StringValue("21.5")` + schema FLOAT compares equal to an inbound `"21.5"` — i.e. no spurious type-mismatch "changed"); QUANTITY reconstruction uses event `unit` with `AttributeSchema.canonicalUnitSymbol` fallback, and the `canonicalUnitSymbol` fallback path logs a WARNING; an un-reconstructable value follows the strict/Degraded discipline (no Degraded written to canonical state, AMD-47-INV-04).
5b. **Conversion-noise floor (AMD-51-INV-02, epsilon lock):** for each non-identity `QuantityValue` conversion, re-constructing the same `(value, inputUnit)` yields a **bit-identical** canonical magnitude (`Double.doubleToLongBits` equality — determinism, AMD-47-INV-03); and for the worst case `°F→°C`, `|QuantityValue(70,"°F").value() − QuantityValue((70−32)*5.0/9.0,"°C").value()| < absEps` (proves conversion noise sits below the epsilon for the pathological cross-path case). These tests verify a known-correct epsilon, not discover an unknown one.
6. **2→3 transition + supersession (AMD-51-INV-05 / AMD-50 §5 #5):** a 2→3 reconciliation over a log containing a spurious within-epsilon version-2 `state_changed` reconstructs the **version-3** value (spurious change suppressed, not applied) and `stateVersion` matches the count of processed log events (path-independent, AMD-50-INV-01). This is the regression guard that proves the typed rule takes effect on historical data.
7. **String payload preserved (Call 4 / §2.7):** the emitted `StateChangedEvent` still carries String `oldValue`/`newValue`; `CheckpointSerializer` and the event-store payload shape are untouched.
8. **Determinism + arch-rule (AMD-50-INV-03, §4c):** the comparator and reconstruction are pure functions of inputs (no clock/I/O/randomness); **test code injects `Clock`** — no `Clock.systemUTC()`/`Instant.now()`/`System.nanoTime()`/`System.currentTimeMillis()` (state-store is non-whitelisted; `NO_DIRECT_TIME_ACCESS` will fail `./gradlew check`).
9. **Catalogue-expansion backfill (review-surfaced):** a historical `state_reported` whose `unit` was previously unrecognised (so it would have degraded) but is recognised by the current catalogue reconstructs correctly during the next version-transition backfill — validating the AMD-50 generality clause for the value-layer case. (A later-WU test if no catalogue unit is added at M4.0b-3; listed so it is not forgotten.)
10. **`shouldPublishDerived` coherence (PM-added):** the existing string-based publish-suppression guard (`serializeAttribute(currentValue).equals(sc.newValue())`, `StateProjection` ~line 758) stays coherent with the typed verdict — when the typed rule emits, the guard must not spuriously suppress (and vice versa). Assert the typed-"unchanged" path emits nothing (the guard is never reached) and the typed-"changed" path is not suppressed by the string guard for the variants where serialized forms can coincide while typed forms differ (and confirm none do under the chosen serialization).

---

## 6. Scope — what this amendment does NOT do

- It does **not** author production Java or issue a coding instruction. The implementing WU is the **M4.0b-3 coding instruction** (PM Mode-3), which modifies `ProductionDerivationRule` (C4), adds the comparator + reconstruction step, wires the `AttributeValueUpcaster` per the M4.B3 DP-1 carry, and reuses AMD-50's backfill for 2→3.
- It does **not** change the `StateChangedEvent` payload, `CheckpointSerializer`, or the event-store on-disk shape. The typed payload is **AMD-52** (staged behind OQ-05-08); the **String payload is preserved** (§2.7).
- It does **not** implement a per-attribute deadband (REC-95 deferred, §2.5); it reserves only the `ComparisonPolicy` shape. The deadband's future home is `AttributeSchema` (analog types).
- It does **not** modify the `AttributeValueUpcaster` SPI (no unit parameter added). Inbound reconstruction is a separate schema-driven step (§2.6 / OQ-05-09 resolution).
- It does **not** re-specify unit normalization — `QuantityValue` canonicalize-at-construction (AMD-47 §2.1 / AMD-47-INV-03) already satisfies REC-93; AMD-51 **cites** it. No JSR-385 / Indriya / LTD-10.
- It does **not** introduce a new reconciliation/backfill mechanism — AMD-50's N→M discipline is **frozen** and reused unchanged for 2→3 (AMD-50 §2.5 / scenario 3.3).
- It does **not** reintroduce a `Clock` to `DerivationContext` (AMD-50 §2.4 removed it; the comparator is a pure function of inputs).
- It does **not** bump the on-disk amendment watermark beyond recording AMD-51 RATIFIED; the watermark raises to **AMD-51** on ratification (51 > 50).

---

## 7. Source anchors + verbatim embeds (confirm against source before implementation — STOP-on-Mismatch)

Every type and module this amendment names is verified below against `homesynapse-core` at HEAD `60b4185` (read with the **Read tool on the working tree** — the in-sandbox `git`/`grep` is distrusted and was observed truncating files this round; the file tool is authoritative, per the M4.0a/M4.B3 mount-staleness lesson). A fabrication would produce a visible diff against these embeds.

### 7.1 Verbatim `module-info.java` (three modules — embed)

```java
// core/device-model/src/main/java/module-info.java
module com.homesynapse.device {
    requires com.homesynapse.event;
    requires transitive com.homesynapse.platform;

    exports com.homesynapse.device;
}

// core/state-store/src/main/java/module-info.java
module com.homesynapse.state {
    requires transitive com.homesynapse.platform;
    requires transitive com.homesynapse.device;
    requires transitive com.homesynapse.event;
    requires transitive com.homesynapse.event.bus;

    requires org.slf4j;

    exports com.homesynapse.state;
}

// core/event-model/src/main/java/module-info.java
module com.homesynapse.event {
    requires transitive com.homesynapse.platform;

    exports com.homesynapse.event;
}
```

**Placement is dependency-valid.** `com.homesynapse.state requires transitive com.homesynapse.device` (and `com.homesynapse.event`), so the comparator in state-store sees `AttributeValue` / its 8 permits / `AttributeSchema` / the `AttributeValueUpcaster` / `StateReportedEvent` with no module cycle. The JPMS module name is **`com.homesynapse.state`** (NOT `com.homesynapse.state.store`) and **`com.homesynapse.device`** (NOT `com.homesynapse.device.model`) — the one-flat-package-per-module convention. **No `module-info` change is required by AMD-51:** the comparator uses only existing in-module and already-required types.

### 7.2 The §7 corrected inventory — CONFIRMED against HEAD `60b4185` (build AMD-51 on these, not Research 10's original §7)

| # | Fact (source-verified this session via Read tool) | Implication for AMD-51 |
|---|---|---|
| **C1** | `DerivationContext` is a **2-arg record** `(EntityState priorState, EventEnvelope envelope)`; Javadoc verbatim: *"there is deliberately no clock"* and *"AMD-50 §2.4 removes the formerly-injected `Clock`."* | The comparator and rule are pure functions of inputs; there is no clock to read or branch on. |
| **C2** | M4.0b-2 (`7610296`) and M4.B3 (`60b4185`) are **already committed**. | Real target = **M4.0b-3**; `projectionVersion` **2→3**. |
| **C3** | `AttributeValue` is **already the 8-variant sealed interface** (AMD-47 shipped): `permits BooleanValue, IntValue, FloatValue, StringValue, EnumValue, QuantityValue, ArrayValue, DegradedAttributeValue`. `rawValue()` + `attributeType()`. | Build on existing types; exhaustive 8-arm switch. |
| **C4** | Production change-detect lives in **`ProductionDerivationRule`** (pkg-private `com.homesynapse.state`, via `DerivationRule.production()`), **not** `EchoStateRule` (fixture). Its `priorValue(...)` stringifies the prior and compares with `Objects.equals(oldValue, newValue)`. | This is the rule the M4.0b-3 coding instruction modifies to call the comparator on a reconstructed typed inbound. |
| **C5** | Inbound is **`StateReportedEvent`** — all-String `(attributeKey, value, unit, rawProtocolValue, rawProtocolUnit)`; Javadoc "Phase 3 introduces typed AttributeValue". **`unit` IS carried on the event.** Prior side (`EntityState.attributes : Map<String,AttributeValue>`) is typed. | Inbound must be **reconstructed to typed** before compare (§2.6); `unit` is available for QUANTITY reconstruction. |
| **C6** | `AttributeSchema` carries `(attributeKey, type, minimum, maximum, step, validValues, unitSymbol, canonicalUnitSymbol, permissions, nullable, persistent)` — `canonicalUnitSymbol` already present. `StateChangedEvent` linking field is **`triggeredBy`** (not "causingEventId"); old/new are String. | Canonical unit, future deadband, and the reconstruction type-key all already have a home; the String payload field names are confirmed. |
| **C7** | Module names per §7.1 (verbatim). D-01 is **event-type-scoped** (`DomainEvent`); an exhaustive switch over `AttributeValue` is fine. | No D-01 conflict for the comparator's exhaustive switch. |

### 7.3 Verbatim `AttributeValue` sealed head + the typed variants (source-verified, HEAD `60b4185`)

```java
public sealed interface AttributeValue
        permits BooleanValue, IntValue, FloatValue, StringValue, EnumValue,
                QuantityValue, ArrayValue, DegradedAttributeValue {
    Object rawValue();              // never null
    AttributeType attributeType();  // never null
}
```

| Variant | Declaration | Comparison-relevant shape |
|---|---|---|
| `BooleanValue` | `record BooleanValue(boolean value)` | exact |
| `IntValue` | `record IntValue(long value)` | exact (`long`) |
| `FloatValue` | `record FloatValue(double value)` | epsilon; **can carry `NaN`/`±Inf`** (no ctor guard) |
| `StringValue` | `record StringValue(String value)` non-null | exact |
| `EnumValue` | `record EnumValue(String value)` non-null | exact |
| `QuantityValue` | `record QuantityValue(double value, String unit)` — **canonicalized at construction**; rejects null/blank/unrecognised unit and non-finite magnitude | canonical-magnitude epsilon + canonical-unit-symbol dimension check; **no unit work in comparator** |
| `ArrayValue` | `record ArrayValue(List<AttributeValue> elements)` — `List.copyOf`, unmodifiable, full-replacement (AMD-47-INV-05) | size-then-order-sensitive deep compare |
| `DegradedAttributeValue` | `record DegradedAttributeValue(String originalTypeName, String rawForm, String failureReason)` — `attributeType()` = `DEGRADED` sentinel | §2.4b rule |

### 7.4 Other source anchors the M4.0b-3 coding instruction must confirm

- `ProductionDerivationRule.evaluate(DerivationContext)` — the `instanceof StateReportedEvent sr` guard, `priorValue(prior, key)` stringification, `Objects.equals(oldValue, newValue)`, and the `StateChangedEvent` construction with `env.eventId()` as `triggeredBy`. The comparator replaces the equality test; the `StateChangedEvent` String construction is **unchanged** (§2.7).
- `AttributeValueUpcaster.upcast(String storedTypeName, String rawForm, int fromSchemaVersion)` + `canUpcast(...)` + default `upcastLenient(...)` — **no unit parameter**; this is the stored-value-migration SPI, **left unchanged** (§2.6). Its M4.B3 DP-1 projection-path wiring is the carry-in.
- `QuantityValue` compact constructor — table-driven `CATALOGUE` canonicalization (°C/K/°F, W/kW/mW, Wh/kWh/J/kJ, lux/klx, %), fail-closed; `value()` returns the canonical magnitude; `unit()` the canonical unit symbol (AMD-47-INV-03).
- `EntityState.attributes : Map<String, AttributeValue>` (unmodifiable; values may be `null`) — the prior side; `lastChanged` is the timestamp the emit drives.
- `StateProjection` `onEvent` / `processBatch` derivation paths — the comparator + reconstruction wiring must sit on **both** (the M4.0a/AMD-50/AMD-47-INV-02 both-paths discipline); the upcaster (when wired) runs strictly before `DerivationRule.evaluate()` on both.
- `StateProjection.applyToState` — the `state_changed` branch writes `new StringValue(sc.newValue())` (~line 819) and the backfill `applyBackfillAttribute` likewise (~line 928); the `state_reported` branch does **not** touch `attributes`. `CheckpointSerializer` serializes attributes as `Map<String,String>` and rebuilds as `new StringValue(v)` ("only writes StringValue"). **This is why the prior side is always `StringValue` and must be reconstructed (§1.2 / §2.6).** AMD-51 does **not** change these writes — the materialized state stays `StringValue` (the typed store is AMD-52).
- `StateProjection.shouldPublishDerived` (~line 758) — an existing defence-in-depth publish guard that serializes the current attribute and **string**-compares to `sc.newValue()` (DEC-M3-02). The typed rule must stay coherent with it (§5 test #10): it only *suppresses* on string equality, so it cannot manufacture a spurious change, but the coding instruction must confirm it never suppresses a genuine typed-"changed" emit.
- AMD-50 §2.1–§2.5 reconciliation-backfill / supersession / cursor determinism — **frozen**; reused for 2→3.

---

## 8. Implementing work units

- **M4.0b-3** — implements §2.1–§2.7: the `AttributeValueComparator` (state-store, gateway), `ComparisonPolicy`, the schema-driven inbound reconstruction step (§2.6), the modification of `ProductionDerivationRule` to reconstruct-then-typed-compare while preserving the String `StateChangedEvent` payload, the `AttributeValueUpcaster` projection-path wiring (M4.B3 DP-1 carry, both paths), and the `projectionVersion` 2→3 bump riding AMD-50's backfill. Gated on AMD-51 (this) + M4.B3. The coding instruction **must include the §4c arch-rule test-`Clock` reminder** (state-store is non-whitelisted: `NO_DIRECT_TIME_ACCESS` scans test classes there).
- **AMD-52 / M4.0b-? (staged, NOT this track)** — the typed `StateChangedEvent` payload, behind the OQ-05-08 serializer/replay design beat (5-item checklist in the Research 10 assessment v2). Do not author until that beat closes.

---

## 9. Ratification checklist (for Nick)

- [ ] The comparator contract shape (NQ-10-5) — external `AttributeValueComparator` in `com.homesynapse.state` carrying a `ComparisonPolicy`, package-private impl + public static factory (DEC-M3-16), exhaustive no-`default` switch — is correct (vs a polymorphic method on the `AttributeValue` interface).
- [ ] The per-variant semantics (§2.2) are correct, especially the Array order-sensitive deep compare and the Quantity canonical-unit dimension check.
- [ ] The pinned total-form epsilon + IEEE-754 totality (§2.3 / AMD-51-INV-02) is the intended contract, and **the `absEps = relEps = 1e-9` FP-noise default has been verified against real M4 sensor data** before lock (the one empirical pre-condition).
- [ ] The Degraded semantics (§2.4b / AMD-51-INV-03 — never-emit-on-inbound, emit-on-recovery, unchanged-on-two-Degraded) are correct and consistent with AMD-47-INV-04.
- [ ] The OQ-05-09 resolution (§2.6) — a **separate schema-driven reconstruction**, NOT an extension of the `AttributeValueUpcaster` SPI; QUANTITY uses `StateReportedEvent.unit` with `AttributeSchema.canonicalUnitSymbol` fallback — is the right call, and the adapter-emit-consistency check is correctly deferred to the M4.0b-3 coding instruction.
- [ ] Staging AMD-51 before AMD-52 with the **String `StateChangedEvent` payload preserved** (§2.7 / Call 4) is confirmed; AMD-52 stays behind OQ-05-08.
- [ ] The deadband stays **deferred** (§2.5 / REC-95); only the `ComparisonPolicy` shape is reserved (future home `AttributeSchema`).
- [ ] `projectionVersion` 2→3 rides AMD-50's frozen backfill unchanged (§2.6 / scenario 3.5); the AMD-50 supersession test still guards the typed rule.
- [ ] AMD-51-INV-01..05 are correct and ready to register into `Architecture_Invariants_v1.md` (§21 + §17 index + §18 traceability) and the state-store MODULE_CONTEXT at M4.0b-3 closeout.
- [ ] On ratification: set Status → RATIFIED + Date applied; raise the on-disk amendment watermark to **AMD-51**; the PM folds Doc 02/03 currency, registers the invariants, updates PROJECT_SNAPSHOT / pm-handoff / design-track-map, and may then brief the M4.0b-3 coding instruction.

---

## 10. External review disposition (HomeSynapse Core Claude Project, 2026-05-30)

An independent pre-ratification review was run in the HomeSynapse Core Claude Project (prompt + source companion at `context/handoff/2026-05-30_AMD51_external_review_*`). Verdict: **RATIFY-AS-IS, 0 blocking issues.** The PM verified the review's source claims against HEAD `60b4185` with the Read tool (the Research-6 confabulation guard — the review asserted facts about `CheckpointSerializer` / `StateProjection.applyToState`, which were **not** in the source companion, so they were independently confirmed before acceptance). PM dispositions:

| # | Review point | PM verdict | Where folded |
|---|---|---|---|
| Q1 epsilon formula / IEEE table | Correct; `Inf−Inf=NaN` must be special-cased before the formula; subnormals/overflow fine | **ACCEPT** | §2.3 already states the special cases; coding instruction implements the `Inf` special-case ahead of the arithmetic |
| Q1 emit-predicate naming | Name/Javadoc must signal emit-predicate, not equality | **ACCEPT** | §2.1 (new bullet) |
| Q2 epsilon default `1e-9` | Correct; worst-case conversion noise (`°F→°C ≈ 6.6e-16` rel) is ~5 orders below `1e-9`; no per-dimension table needed | **ACCEPT** (lock at `1e-9`); the M4-sensor-data check (§9) is satisfied by the first-principles ceiling + the §5 5b tests | §5 #5b; §9 epsilon item |
| Q3 reconstruction separate from upcaster | Correct separation | **ACCEPT** | §2.6 |
| Q3 `canonicalUnitSymbol` fallback = silent-corruption risk | Needs WARNING log + mandatory adapter-`unit` gate | **ACCEPT** | §2.6 (mandatory gates), §5 #5 |
| Q3 catalogue-expansion backfill | Add as a test scenario | **ACCEPT** | §5 #9 |
| Q4 sequencing | Ratify now; gate the two empirical checks in the coding instruction | **ACCEPT** | §8, §9 |
| Array depth bound | Optional `MAX_NESTING_DEPTH` | **ACCEPT (coding-instruction, optional)** | noted here; not load-bearing for M4 |
| Dead-code QuantityValue NaN/Inf checks | Keep as defence-in-depth with comment | **ACCEPT (coding-instruction)** | §2.2 already notes Quantity can't carry NaN/Inf |
| "Didn't ask #1": prior side is `StringValue`, upcaster/reconstruction is load-bearing for **every** compare | **CONFIRMED against source — the one point elevated above non-blocking.** Drove the §1.2 reword + §2.6 symmetric-reconstruction requirement + AMD-51-INV-05 sharpening | §1.2, §2.6, §4 INV-05 |
| "Didn't ask #2/#3": String-payload interim correctness; `prior==null`+Degraded vs AMD-47-INV-04 | Correct; no change needed | **ACCEPT (no-op)** | consistent with §2.7 / §2.4b |
| PM-added finding | `shouldPublishDerived` string dedup must stay coherent with the typed verdict | **PM-RAISED** | §5 #10, §7.4 |

**Net:** no ratified decision reversed; one correctness clarification (symmetric reconstruction) and a set of coding-instruction gates folded in. The amendment is ready for Nick's ratification.
