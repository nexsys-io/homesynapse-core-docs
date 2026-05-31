# AMD-47: AttributeValue Hierarchy Expansion + AttributeValueUpcaster SPI

**Amendment ID:** AMD-47
**Tier:** Tier-1 (architectural invariant / contract-level)
**Status:** RATIFIED
**Date drafted:** 2026-05-30
**Date applied:** 2026-05-30
**Revision (Nick ratification, 2026-05-30):** Ratified by Nick. The §9 **ratification fork is RESOLVED — `AttributeType.QUANTITY` is added** (the 1:1 value↔type scheme, §2.5); the FLOAT-reuse alternative is rejected. §9 checklist accepted as written (three records, the `AttributeValueUpcaster` SPI with no `ServiceLoader`, the three `AttributeType` constants `QUANTITY`/`ARRAY`/`DEGRADED`, the five invariants AMD-47-INV-01..05, and the §2.6/§3.7 `Unit<?>`→`String` currency correction). The on-disk amendment watermark is **unchanged** — it stays **AMD-50** (47 < 50); ratification records AMD-47 RATIFIED, it does not raise the ceiling. AMD-47-INV-01..05 registered into `Architecture_Invariants_v1.md` (§20) and the Doc 02 §3.7/§8.2 PENDING-AMD-47 blocks folded current at this ratification (P4r mechanics session).
**Forward-note (2026-05-31, AMD-52 §11 erratum):** the `AttributeValue` hierarchy (`AttributeValue` + 8 variants + `AttributeType`) this amendment established in `com.homesynapse.device` **relocates to a new `com.homesynapse.value` leaf module** at M4.0b-4a, to break the event-model→device-model JPMS cycle the AMD-52 typed `StateChangedEvent` payload would otherwise create (design note `homesynapse-core-docs/design/2026-05-31_AttributeValue_Module_Relocation_Design_Note.md`). This supersedes the **module placement** only — every AMD-47 contract (AMD-47-INV-01 sealing, INV-03 canonicalize-at-construction, INV-04 Degraded non-declarable, INV-05 ArrayValue full-replacement) is unchanged and travels with the types. `AttributeSchema` and `AttributeValueUpcaster` stay in `com.homesynapse.device`.
**Classification:** CONTRACT-LEVEL (expands a sealed public hierarchy in the integration-facing device-model API)
**Target documents:** Doc 02 (Device Model & Capability System) — §3.7 (Attribute Type System), §8.2 (Key Types). Doc 03 (State Store & State Projection) — **forward-reference only** (the typed `applyToState` / `CheckpointSerializer` typed-store evolution is AMD-52 / M4.0b-3, not this amendment — see §6).
**Target sections:** Doc 02 §3.7 (AttributeType primitives + AttributeSchema), §8.2 (AttributeValue key-type row); the device-model `AttributeValue` sealed hierarchy in `com.homesynapse.device`.
**Refines / relates:** the `AttributeValue` sealed-hierarchy exhaustiveness contract (Doc 02 §8.2); LTD-19 type-name string identity (the forward-compat mechanism `DegradedAttributeValue` mirrors at the subtype level, paralleling `DegradedEvent`); INV-CS-04 (integration-API stability / semver). Does **not** refine AMD-50 — that governs the projection-version transition this amendment's types will later ride (AMD-52 / M4.0b-3).
**Source:** Research 8 PM Assessment (`context/assessments/2026-05-22_Research_8_PM_Assessment.md`, v2 post Nick source-verification) REC-24 (`QuantityValue`), REC-27 (`ArrayValue`, full-replacement), REC-29 (`AttributeValueUpcaster` SPI + `DegradedAttributeValue`); REC-93 (`QuantityValue` unit normalization) and REC-78 (upcaster-before-derivation positioning) per `PLAN-M4-CONSOLIDATED-v2` §3 / §7; P2 AMD-allocation decision (`context/decisions/2026-05-29_P2_AMD_Renumbering_Decision.md`, RATIFIED 2026-05-29 — device block 46–49, §3 fixes AMD-47 = the AttributeValue expansion).
**Scope:** Workstream B (device-model expansion). Authorises the **types + SPI + behavioral invariants**; implemented by **M4.B3** (the implementation WU, gated on this amendment + P4 Doc-02 currency). This amendment authors **no code**, bumps **no** `projectionVersion`, and implements **no** upcaster.
**AMD-allocation note:** Authored under the ratified P2 scheme. P2 §3 fixes the 4-AMD device block: **AMD-46** = `EntityCategory` on `Entity` (REC-23, M4.B1); **AMD-47 = this amendment** = `AttributeValue` expansion (REC-24/27/29/93, M4.B3); **AMD-48** = `Capability` batch expansion (REC-30, M4.B5); **AMD-49** = `SemanticTag` (REC-26, M4.B4). The "AMD-47-equiv withdrawn" line in the v2-plan M4.B1 row refers to a *provisional placeholder* (`EntityState.category`) that was never authored as a file (P2 §2 / §7); `EntityCategory` is reborn as AMD-46 on `Entity`, leaving AMD-47 cleanly free for this expansion. The on-disk amendment watermark remains **AMD-50** until Nick ratifies this amendment (§9).

---

## 1. Problem

The device model's canonical typed-value representation — the sealed `AttributeValue` hierarchy in `com.homesynapse.device` — currently admits exactly five primitive shapes: `BooleanValue`, `IntValue`, `FloatValue`, `StringValue`, `EnumValue` (source-verified — see §7). Three capability classes that the MVP device set requires cannot be represented faithfully, and the hierarchy has no migration seam for evolving stored values across the very type changes this amendment introduces.

### 1.1 Physical quantities lose their unit identity

Doc 02 §3.7 makes "physical quantities are stored as `(value, unit)` pairs with explicit unit identity" a *moat decision* — it is the design choice that prevents the Home Assistant unit-change data-corruption class. Yet the value side of the model has no quantity-carrying variant: a temperature, power, or energy reading is a bare `FloatValue`, and the unit lives only in the *schema* (`AttributeSchema.unitSymbol` / `canonicalUnitSymbol`). A value detached from its unit cannot be normalized, compared, or audited as a quantity — the moat decision is unenforceable at the value layer.

### 1.2 List-valued attributes cannot be represented

Matter list attributes (and several MVP capabilities that report sets, e.g. multi-segment or multi-channel readings) require an ordered, replaceable collection of values. The hierarchy has no array variant, so these attributes degrade to opaque `StringValue` blobs that the validator and comparator cannot reason about element-wise.

### 1.3 No subtype-level fallback / migration seam for sealed-hierarchy evolution

Expanding a **sealed** hierarchy is a forward-compatibility hazard: once `QuantityValue`/`ArrayValue` exist and are persisted, a later type change (or an older snapshot read by newer code, or vice-versa) needs a defined migration path, and a defined behaviour when a stored value cannot be upcast to a current variant. The event layer already solves the envelope-level version of this with the upcaster pipeline + `DegradedEvent` (Doc 01 §3.10; source-verified `DegradedEvent` in `com.homesynapse.event`). The `AttributeValue` layer has neither an upcaster SPI nor a `DegradedEvent`-equivalent subtype, so any future `AttributeValue` type evolution would have to break stored-value deserialization or invent the seam ad hoc.

These three gaps are what M4.B3 must close — but M4.B3 cannot be authored as a coding instruction until the types, the SPI, and their behavioral invariants exist as a ratified contract. This amendment is that contract.

---

## 2. Change Specification

This amendment expands the `AttributeValue` sealed hierarchy by **three public records**, adds the **`AttributeValueUpcaster` SPI**, adds **three `AttributeType` enum constants**, and allocates **five invariants** (§4). Every named existing type is source-verified in §7; every new type is introduced here.

### 2.1 `QuantityValue` (REC-24, REC-93) — public record

A new permitted `AttributeValue` carrying a physical quantity as an explicit magnitude + unit, normalized to the canonical unit at construction.

- **Components:** `(double value, String unit)` where `value` is the **canonical-normalized magnitude** and `unit` is the **canonical unit symbol** (e.g. `"°C"`, `"W"`, `"Wh"`, `"lux"`), matching the existing `String`-typed `AttributeSchema.canonicalUnitSymbol` convention. **No JSR 385 / `javax.measure` type is introduced** (see REC-93 and §2.6).
- **`rawValue()`** returns the canonical magnitude boxed as `Double` (never `null`). This keeps a `QuantityValue` magnitude-comparable with a `FloatValue` for generic processing while the typed comparator (AMD-51 / M4.0b-3) layers unit-aware comparison on top.
- **`attributeType()`** returns the new constant **`AttributeType.QUANTITY`** (§2.5).
- **Normalization contract (REC-93 — hand-rolled, deterministic):** at construction, the supplied magnitude+unit are converted to the canonical unit for the quantity's dimension via a **pure, hand-rolled, table-driven conversion** — no external units library, no I/O, no locale or clock dependence. Two `QuantityValue`s of the same dimension are therefore directly magnitude-comparable on `value`. Construction with a `null`/blank `unit`, a non-finite `value` (NaN/±Inf), or an **unrecognised** unit fails deterministically (`IllegalArgumentException` / `NullPointerException`) — it does **not** silently pass through and does **not** produce a `DegradedAttributeValue` (degradation is an *upcast/parse* fallback, §2.4, not a construction fallback). The canonical-unit catalogue and conversion table are specified at M4.B3 implementation against Doc 02 §3.7's canonical-unit list; this amendment fixes the *contract* (determinism, canonical-at-construction, fail-closed on unknown units), not the table contents.

### 2.2 `ArrayValue` (REC-27) — public record, full-replacement semantics

A new permitted `AttributeValue` carrying an ordered list of element values.

- **Components:** `(List<AttributeValue> elements)` — defensively copied via `List.copyOf(elements)` (rejects `null` elements; an empty list is permitted). The list is unmodifiable.
- **`rawValue()`** returns the unmodifiable `List<AttributeValue>` (never `null`; possibly empty).
- **`attributeType()`** returns the new constant **`AttributeType.ARRAY`** (§2.5).
- **Full-replacement semantics (non-negotiable, Research 8 insight #2):** an `ArrayValue` carries **no delta/patch semantics**. A new `ArrayValue` wholly replaces the prior value for that attribute. Delta semantics are explicitly rejected because they are incompatible with the bounded-window projection advancer (the advancer reads a bounded event window and cannot reconstruct a value from an unbounded chain of element-level deltas). Element homogeneity (whether all elements share an `attributeType()`) is a **schema-level** concern enforced by the `AttributeValidator` against the capability's `AttributeSchema`, not by the record. Nesting (`ArrayValue` of `ArrayValue`) is permitted by the type but discouraged by schema; M4.B3 documents the validator stance.

### 2.3 `AttributeValueUpcaster` SPI (REC-29) — public interface, `com.homesynapse.device`

The migration seam for evolving stored attribute values across `AttributeValue` type changes. It lives in `com.homesynapse.device` (the package that owns `AttributeValue`), so device-model remains the single source of the value-type contract and downstream modules (state-store, integration-runtime) depend on it without a new module edge.

The SPI is specified (interface shape, behavioral contract) by this amendment; **no implementation is authored here** and **no `ServiceLoader` is used** (DECIDE-04 — constructor injection, consistent with REC-28's advancer). Indicative shape (final signatures fixed at M4.B3 against source):

```text
public interface AttributeValueUpcaster {
    // Can this upcaster transform a stored value of the given subtype-name / schema version?
    boolean canUpcast(String storedTypeName, int fromSchemaVersion);
    // Transform a stored raw form to a current AttributeValue. Strict mode: throws on failure.
    AttributeValue upcast(String storedTypeName, String rawForm, int fromSchemaVersion);
}
```

**Two modes, paralleling the event upcaster (Doc 01 §3.10 / `DegradedEvent`):**
- **Strict mode** — used by **core projections** (State Store, Automation, Pending Command Ledger): a failed upcast **halts** processing; a `DegradedAttributeValue` is **never** written to canonical state.
- **Lenient mode** — used by **diagnostic/forensic tools** (trace viewer, export): a failed upcast yields a **`DegradedAttributeValue`** (§2.4) preserving the raw form and failure reason.

### 2.4 `DegradedAttributeValue` (REC-29) — **public** record, subtype-level fallback

The `AttributeValue`-layer analogue of `DegradedEvent`. **Visibility: `public`** (Research 8 FQ-3, Nick-confirmed — the researcher's "package-private" was a §7 error). It is the sealed-subtype-level fallback for a stored value that could not be upcast to a current variant.

- **Components (mirroring `DegradedEvent`):** `(String originalTypeName, String rawForm, String failureReason)` — `originalTypeName` is the stored subtype-name the value failed to become; `rawForm` is the original serialized form before the failed upcast; `failureReason` describes the failure. All non-null; `originalTypeName`/`failureReason` non-blank (compact-constructor validation, exactly as `DegradedEvent`).
- **`rawValue()`** returns `rawForm` (never `null`).
- **`attributeType()`** returns the new sentinel constant **`AttributeType.DEGRADED`** (§2.5). The original intended type is generally *unknown* (that is *why* the value degraded), so `DEGRADED` is the honest classifier — `attributeType()` stays non-null and exhaustive switches keep compiling.
- **Non-schema-declarable (AMD-47-INV-04):** `AttributeType.DEGRADED` may **never** appear in an `AttributeSchema.type`; the `AttributeValidator` rejects any schema that declares it. A `DegradedAttributeValue` is a forensic/lenient-mode artifact and never enters canonical state under strict mode (§2.3).

### 2.5 `AttributeType` enum expansion

`AttributeType` (the schema-side primitive classifier, source-verified `BOOLEAN, INT, FLOAT, STRING, ENUM` — §7) gains three constants so each new value variant has a 1:1 type classifier and exhaustive `switch`es over `AttributeType` stay total:

- **`QUANTITY`** — classifies `QuantityValue`. Schema-declarable; the validator uses the existing `unitSymbol`/`canonicalUnitSymbol`/`minimum`/`maximum` metadata.
- **`ARRAY`** — classifies `ArrayValue`. Schema-declarable; the validator applies element constraints per schema.
- **`DEGRADED`** — classifies `DegradedAttributeValue`. **Sentinel only — not schema-declarable** (AMD-47-INV-04).

> **Ratification fork — RESOLVED: `QUANTITY` added (Nick, 2026-05-30).** The 1:1 value↔type mapping above (add `QUANTITY`) is the ratified scheme — it preserves the existing "the attribute type corresponding to this value's concrete type" contract and exhaustive-switch clarity, and keeps the typed comparator (AMD-51) and `AttributeValidator` able to `switch(attributeType())` on the unit-dimensional case without down-casting. The alternative (keep `QuantityValue` schema-typed as `FLOAT` with unit metadata, no new `QUANTITY` constant) is **rejected**. One enum constant, near-zero downside.

### 2.6 Unit handling supersedes the deferred-JSR-385 plan

The device-model MODULE_CONTEXT records a Phase-2 simplification ("`unitSymbol` is `String`; Phase 3 will add JSR 385") and Doc 02 §3.7's `AttributeSchema` pseudocode still shows `unit: Unit<?>?` (JSR 385). REC-93 **resolves this the other way**: unit normalization is **hand-rolled, no external units library** (confirmed against the version catalog — `gradle/libs.versions.toml` contains no `javax.measure` / `indriya` / unit-of-measure entry, §7). This amendment therefore **supersedes the deferred-JSR-385 note**: `QuantityValue.unit` and the `AttributeSchema` unit fields remain `String` canonical-unit symbols, and the Doc 02 §3.7 pseudocode is corrected to `String` in the Doc 02 currency delta (the P4 companion deliverable).

---

## 3. Worked scenarios

**3.1 — A temperature sensor reports 22.5 °C.** The integration produces a `state_reported` whose value the projection materializes as `QuantityValue(22.5, "°C")` — canonical-normalized at construction. Generic code reads `rawValue()` → `22.5` (Double); unit-aware comparison (AMD-51) reads the canonical `value`+`unit`. The moat decision (§1.1) is now enforced at the value layer: the unit travels with the magnitude and is never reinterpreted at storage.

**3.2 — A multi-segment reading is replaced.** An attribute reporting `[on, on, off]` materializes as `ArrayValue([BooleanValue(true), BooleanValue(true), BooleanValue(false)])`. A later report `[on, off, off]` produces a **new** `ArrayValue` that **wholly replaces** the prior (§2.2) — no element delta is applied. The bounded-window advancer reconstructs the value from the single latest full-replacement event, never from an element-delta chain.

**3.3 — A stored value cannot be upcast (lenient mode).** A diagnostic export reads a historical attribute whose stored subtype no longer maps to any current variant. In **lenient** mode the `AttributeValueUpcaster` returns `DegradedAttributeValue("<storedTypeName>", "<rawForm>", "no upcaster for subtype/version")`; `attributeType()` → `DEGRADED`; the forensic tool surfaces it without halting. In **strict** mode (the State Store projection path) the same failure **halts** the projection — `DegradedAttributeValue` is never written to canonical state (§2.3, AMD-47-INV-04).

**3.4 — Upcaster ordering on a derivation path (REC-78, the gate-every-path discipline).** When M4.B3 wires the upcaster into the projection, a replayed or live `state_reported` carrying a stored value is upcast to a current `AttributeValue` **before** `DerivationRule.evaluate()` is called — on **both** the `onEvent` and `processBatch` delivery paths. Neither path may reach `evaluate()` with an un-upcast stored value (AMD-47-INV-02). This is the same "gate every path, not just the happy one" lesson that the M4.0a D-1 correction and AMD-50's both-paths backfill encode.

---

## 4. New invariants

Allocated under the `AMD-47-INV-0N` convention (matching AMD-50's `AMD-50-INV-0N`). All are **PROPOSED** until ratification (§9) and registered into `Architecture_Invariants_v1.md` + the device-model MODULE_CONTEXT Constraints table at M4.B3 closeout (not now — §6).

- **AMD-47-INV-01 (sealing remains total).** After this amendment the `AttributeValue` `permits` clause enumerates **exactly** `{BooleanValue, IntValue, FloatValue, StringValue, EnumValue, QuantityValue, ArrayValue, DegradedAttributeValue}` (8 variants). Every exhaustive `switch` over `AttributeValue` must handle all eight; no implementor outside the `permits` clause may exist. (Preserves the Doc 02 §8.2 sealed-exhaustiveness contract; an ArchUnit/compile check is the enforcement, mirroring the Capability-hierarchy exhaustiveness rule.)
- **AMD-47-INV-02 (upcaster-before-derivation ordering — REC-78).** When the `AttributeValueUpcaster` is wired (M4.B3), it MUST execute **strictly before** `DerivationRule.evaluate()` on **both** the `onEvent` and `processBatch` projection paths. No path may reach `evaluate()` with an un-upcast stored value. (Gate-every-path discipline — the M4.0a / AMD-50 both-paths lesson.)
- **AMD-47-INV-03 (QuantityValue normalization determinism — REC-93).** `QuantityValue` normalizes to its canonical unit at construction via a pure, hand-rolled, deterministic conversion — no external units library, no I/O, no locale/clock dependence. Same-dimension `QuantityValue`s are magnitude-comparable on their canonical `value`. An unknown/unsupported unit, a `null`/blank unit, or a non-finite magnitude fails construction deterministically (fail-closed; never silently coerced, never degraded).
- **AMD-47-INV-04 (DegradedAttributeValue non-declarable + lossless).** `AttributeType.DEGRADED` may never appear in an `AttributeSchema.type` (the `AttributeValidator` rejects it). `DegradedAttributeValue` preserves `originalTypeName`/`rawForm`/`failureReason` without mutation and is never written to canonical state under strict mode — it is a lenient-mode/forensic artifact only (parallels `DegradedEvent` strict/lenient modes, Doc 01 §3.10).
- **AMD-47-INV-05 (ArrayValue full-replacement).** `ArrayValue` carries no delta/patch semantics; a new `ArrayValue` wholly replaces the prior value for the attribute. This is required for compatibility with the bounded-window advancer (Research 8 insight #2). `elements` is an unmodifiable, null-free, possibly-empty `List<AttributeValue>`.

---

## 5. Test requirements (verification gate for M4.B3)

These are the contract tests M4.B3 must satisfy; they are listed here so the amendment is verifiable, not so this session writes them.

1. **Exhaustiveness (AMD-47-INV-01):** an ArchUnit/compile test asserts the `permits` clause is exactly the 8 variants and that the canonical `AttributeValue` `switch` site(s) handle all eight (no `default` swallowing a new variant).
2. **QuantityValue normalization + determinism (AMD-47-INV-03):** same-dimension constructions from different input units land on identical canonical `value`; repeated construction is byte-identical; unknown unit / blank unit / NaN / ±Inf each throw; no units-library import appears on the device-model classpath.
3. **ArrayValue full-replacement (AMD-47-INV-05):** a second `ArrayValue` wholly replaces the first (no element merge); `elements` is unmodifiable and rejects null elements; empty list permitted.
4. **Upcaster strict vs lenient + ordering (AMD-47-INV-02 / -04):** strict-mode failed upcast halts and writes no `DegradedAttributeValue` to state; lenient-mode failed upcast yields a `DegradedAttributeValue` with the raw form preserved; a path test proves the upcaster runs before `DerivationRule.evaluate()` on **both** `onEvent` and `processBatch` (the test FAILS if either path reaches `evaluate()` un-upcast).
5. **DegradedAttributeValue non-declarable (AMD-47-INV-04):** the `AttributeValidator` rejects any `AttributeSchema` whose `type == DEGRADED`.
6. **Round-trip / serialized form:** each new variant's specified serialized form round-trips (this is the *contract* the AMD-52 typed-store evolution will target — see §6; M4.B3 asserts the variant-level round-trip, not the store-level typed persistence).

Extend the existing device-model test suites (`AttributeValue`/variant tests, `AttributeValidator` tests); do not greenfield.

---

## 6. Scope — what this amendment does NOT do

- It does **not** author production Java, issue a coding instruction, or implement the `AttributeValueUpcaster`. **M4.B3** is the implementation WU (gated on this amendment + P4 Doc-02 currency).
- It does **not** bump `projectionVersion` and does **not** touch the projection version-transition machinery. The typed change-detect rule, typed `StateChangedEvent` payload (`String`→`AttributeValue`), the `applyToState` typed-store write, and the `CheckpointSerializer` `Map<String,String>`→typed evolution are **AMD-52 / M4.0b-3** (P2 §3.2), which will ride AMD-50's already-authorised backfill discipline for the 2→3 transition. This amendment only makes the **types + SPI** exist so AMD-52 has a target. **Doc 03 is a forward-reference here, not a change.**
- It does **not** modify `CheckpointSerializer` (today it flattens all `AttributeValue` to `Map<String,String>` and rebuilds as `StringValue` — source-verified §7). Because the production derivation rule remains the **string** change-detect through M4.0b-2, no typed value is produced until M4.0b-3, so the lossy serializer is a non-issue in the AMD-47 window; the upcaster (this amendment) is the seam AMD-52's transition uses.
- It does **not** entangle with sibling device amendments: **AMD-44** (Floor/EntityRole — RATIFIED pending implementation), **AMD-46** (`EntityCategory`), **AMD-48** (`Capability` batch), **AMD-49** (`SemanticTag`, whose `LabelsToTagsUpcaster` is a *separate* upcaster from this SPI). REC-91's typed `StateChangedEvent` swap is **AMD-52**, not this amendment.
- It does **not** bump the on-disk amendment watermark (stays **AMD-50** until ratification) and does **not** update the device-model MODULE_CONTEXT or `Architecture_Invariants_v1.md` (those happen at M4.B3 WUCP Phase 2 closeout, post-implementation).

---

## 7. Source anchors + verbatim embeds (confirm against source before implementation — STOP-on-Mismatch)

Every type this amendment names as *existing* is verified below against `homesynapse-core` at HEAD `7610296` (read with the file tool; the sandbox `git`/`grep` is distrusted per the hivemind sandbox note). A fabrication would produce a visible diff against these embeds — this is the Research-6/7 §7 fabrication guard (verified type/JPMS-module inventory embedded verbatim).

### 7.1 Verbatim `module-info.java` — `core/device-model/src/main/java/module-info.java`

```java
/*
 * HomeSynapse Core
 * Copyright (c) 2026 NexSys. All rights reserved.
 */

/**
 * Device model — Device, Entity, Capability, registries, and discovery.
 */
module com.homesynapse.device {
    requires com.homesynapse.event;
    requires transitive com.homesynapse.platform;

    exports com.homesynapse.device;
}
```

The JPMS module name is **`com.homesynapse.device`** (NOT `com.homesynapse.device.model`). All three new types (`QuantityValue`, `ArrayValue`, `DegradedAttributeValue`) and the `AttributeValueUpcaster` SPI land in the single exported `com.homesynapse.device` package (the one-flat-package invariant). **No `module-info` change is required by this amendment:** the new types use only `java.util.List`/`java.lang` and existing in-package types — no new `requires`/`exports`. M4.B3 must confirm this holds.

### 7.2 Verified `AttributeValue` sealed-hierarchy inventory (source-verified)

```java
// AttributeValue.java (verbatim head)
public sealed interface AttributeValue
        permits BooleanValue, IntValue, FloatValue, StringValue, EnumValue {

    Object rawValue();          // "never null"
    AttributeType attributeType();  // "never null"
}
```

| Existing variant | Declaration | `rawValue()` returns | `attributeType()` returns |
|---|---|---|---|
| `BooleanValue` | `record BooleanValue(boolean value)` | `value` (Boolean) | `AttributeType.BOOLEAN` |
| `IntValue` | `record IntValue(long value)` | `value` (Long) | `AttributeType.INT` |
| `FloatValue` | `record FloatValue(double value)` | `value` (Double) | `AttributeType.FLOAT` |
| `StringValue` | `record StringValue(String value)` | `value` (non-null) | `AttributeType.STRING` |
| `EnumValue` | `record EnumValue(String value)` | `value` (non-null) | `AttributeType.ENUM` |

**5 existing variants** (NOT 7 — the Research-8 §7 listing of `LongValue`/`DoubleValue`/`InstantValue`/`JsonValue` was fabricated; `FloatValue`/`EnumValue` were the real members it omitted — Research 8 PM Assessment §7 type-name corrections). `StringValue`/`EnumValue` validate non-null in a compact constructor; `BooleanValue`/`IntValue`/`FloatValue` do not. After this amendment the `permits` clause becomes the **8** variants of AMD-47-INV-01.

### 7.3 Verified `AttributeType` enum (source-verified — `AttributeType.java`)

```java
public enum AttributeType { BOOLEAN, INT, FLOAT, STRING, ENUM }
```

5 constants today; this amendment adds `QUANTITY`, `ARRAY`, `DEGRADED` (§2.5) → 8.

### 7.4 Other source anchors M4.B3 must confirm

- **`DegradedEvent`** (`core/event-model/.../DegradedEvent.java`) — the parallel this amendment mirrors at the subtype level: `record DegradedEvent(String eventType, int schemaVersion, String rawPayload, String failureReason) implements DomainEvent` with compact-constructor non-null/non-blank validation and the strict/lenient two-mode upcaster doctrine (Doc 01 §3.10). `DegradedAttributeValue` follows the same shape (§2.4).
- **`AttributeSchema`** (`AttributeSchema.java`) — `String unitSymbol`, `String canonicalUnitSymbol` are already `String` (NOT JSR 385 `Unit<?>`). `QuantityValue.unit` matches this convention (§2.6).
- **`CheckpointSerializer.toSerializable`/`fromSerializable`** (`core/persistence/.../CheckpointSerializer.java` ~L229–268) — currently flattens every `AttributeValue` to `Map<String,String>` (`StringValue` → `value()`; else `rawValue().toString()`) and rebuilds **all** as `StringValue`. This is the typed-store gap AMD-52/M4.0b-3 closes; **this amendment does not touch it** (§6).
- **Version catalog** (`gradle/libs.versions.toml`) — contains **no** units-of-measure library (no `javax.measure` / `indriya` / `uom`). REC-93's hand-rolled normalization (AMD-47-INV-03) is the constraint-compliant choice; do not add a units dependency.
- **Only one production `AttributeValue` switch/instanceof exists** outside tests: `CheckpointSerializer.java:238` (`else if (av instanceof StringValue sv)`). M4.B3's exhaustiveness work (AMD-47-INV-01) is therefore small in blast radius today; state-store's `EntityState`/`ProductionDerivationRule`/`StateProjection` reference `AttributeValue` but the typed-switch consumers arrive with AMD-51/52.

---

## 8. Implementing work units

- **M4.B3** — implements §2.1–§2.6 (the three records, the SPI, the three `AttributeType` constants) and the §5 contract tests; wires the upcaster per AMD-47-INV-02 when it reaches the projection path. Gated on **this amendment (ratified) + P4 Doc-02 currency**. Authors no `projectionVersion` bump.
- **M4.0b-3** (downstream, separate) — AMD-51 typed comparator + AMD-52 typed `StateChangedEvent`/typed-store; reuses AMD-50's backfill for the 2→3 transition. Gated on M4.B3. **Not** this amendment.

---

## 9. Ratification checklist (for Nick)

- [x] **Confirmed AMD number is 47** (P2 §3 device block 46–49; AMD-47 = AttributeValue expansion; the "AMD-47-equiv withdrawn" line was a placeholder, not a file — §AMD-allocation note). Accepted.
- [x] The three new public records — `QuantityValue` `(double value, String unit)`, `ArrayValue` `(List<AttributeValue> elements)`, `DegradedAttributeValue` `(String originalTypeName, String rawForm, String failureReason)` — and their `rawValue()`/`attributeType()` contracts (§2.1/§2.2/§2.4) are correct.
- [x] **`AttributeType` gains `QUANTITY`, `ARRAY`, `DEGRADED`** (§2.5) — and the **ratification fork is RESOLVED: add `QUANTITY`** (1:1 value↔type); the FLOAT-reuse alternative is rejected.
- [x] The `AttributeValueUpcaster` SPI shape + strict/lenient two-mode doctrine (§2.3) is acceptable; no `ServiceLoader` (DECIDE-04, constructor injection).
- [x] **REC-93 supersedes the deferred-JSR-385 plan** — unit normalization is hand-rolled `String`-based, no units library (§2.6, AMD-47-INV-03). The Doc 02 §3.7 `Unit<?>` → `String` correction (P4 companion delta) is accepted.
- [x] The five invariants (§4) are correct — in particular **AMD-47-INV-02** (upcaster strictly before `DerivationRule.evaluate()` on **both** paths) and **AMD-47-INV-05** (ArrayValue full-replacement, no deltas).
- [x] Scope boundaries (§6) hold: no `projectionVersion` bump, no `CheckpointSerializer` change, no Doc 03 change (forward-reference only), no entanglement with AMD-44/46/48/49 or AMD-52.
- [x] **On ratification (DONE — P4r mechanics session, 2026-05-30):** Status set → RATIFIED + Date applied = 2026-05-30; the on-disk amendment watermark was **left unchanged at AMD-50** (47 < 50 — ratification records AMD-47 RATIFIED, it does not raise the ceiling); AMD-47-INV-01..05 registered into `Architecture_Invariants_v1.md` (§20); the Doc 02 §3.7/§8.2 PENDING-AMD-47 blocks folded current; AMD-47 logged in the KB ledger; `pm-handoff`/`PROJECT_SNAPSHOT`/`cross-agent-notes` updated so **M4.B3** is now **UNBLOCKED** (AMD-47 ratified ✓ + Doc 02 current ✓) — **not yet started** (the next, separate fresh session).
