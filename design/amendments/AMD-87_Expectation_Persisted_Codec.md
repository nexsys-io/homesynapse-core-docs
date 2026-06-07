<!--
file: design/amendments/AMD-87_Expectation_Persisted_Codec.md
purpose: AMD-87 — hand-rolled Expectation sealed-type persisted codec so command-bearing CapabilityAdded round-trips. Lightweight block-track (P4): trivial additive serde on the AMD-52 AttributeValue-codec precedent.
audience: Nick (ratify), PM, DOCS-Project review (lightweight)
status: **RATIFIED 2026-06-07** — lightweight block-track (P4) DOCS review **RATIFY-WITH-EDITS** folded (E1 §7 watermark "65"→"87"; E2 the two `@Disabled` quotes → `"AMD-65 pending"` matching HEAD; E3 citation → P2 ledger). Co-ratified with **AMD-86** + **Doc 15 Lock**; on-disk watermark → **AMD-87**. Implemented by **M5-A Part 2** (un-gated 2026-06-07). Review: `nexsys-hivemind/context/audits/2026-06-06_AMD-87_DOCS_Review_Return.md`.
source: M4.C deferral ([BLOCKING-for-M9] serde, Nick-arbitrated Option 2 2026-06-05); the executable acceptance test `EventPayloadCodecTest.CapabilityEvents.capabilityAdded_onOff_roundTrips` (`@Disabled("AMD-65 pending")`); AMD-52 AttributeValue tagged-union codec precedent
baseline: homesynapse-core HEAD `8ef9e9f` — verified: `PersistenceJacksonModule` registers ULIDs + `AttributeValue` only; `Expectation` sealed (4 permits) in `com.homesynapse.device`; persistence does NOT `requires com.homesynapse.device`
amd-number-rationale: reassigned from the retired AMD-65 → **AMD-87** per the **P2 renumbering decision** (`context/decisions/2026-05-29_P2_AMD_Renumbering_Decision.md`) + the pm-handoff AMD-retirement ledger (E3: INV-GA-02 governs `INV-XX-NN` invariant identifiers, *not* `AMD-NN` numbers — the AMD-number non-reuse convention is the P2 ledger, INV-GA-02 invoked here by analogy only). The pm-handoff ledger records AMD-64/AMD-65 as RETIRED post Research 5 v2 and "next active block starts at AMD-86"; AMD-86 took the INV-PD-07/crypto amendment, so AMD-87 is the next clean number (confirmed free). The Expectation codec was tracked as "~AMD-65" at M4.C (2026-06-05) before the retirement was reconciled. **NB:** the live acceptance test's annotation literally reads `@Disabled("AMD-65 pending")` at HEAD `8ef9e9f` — that is the retired number in the existing code; M5-A removes the annotation. Do not re-introduce AMD-65 anywhere.
-->

# AMD-87: `Expectation` Persisted Sealed-Type Codec

## 1. Problem Statement

A command-bearing `CapabilityAdded` carries the full `CapabilityInstance` (AMD-59-INV-02, for replay self-sufficiency), which embeds `CommandDefinition → ExpectedOutcome → Expectation`. `Expectation` is a device-model sealed type (`permits ExactMatch, WithinTolerance, EnumTransition, AnyChange`) with **no (de)serializer** in `PersistenceJacksonModule` (verified at HEAD: only ULID wrappers + `AttributeValue` are registered). So a command-bearing `CapabilityAdded` **decodes to `DegradedEvent`** — it does not round-trip. M4.C shipped GREEN using a command-*less* `occupancy()`-derived instance and left `capabilityAdded_onOff_roundTrips` `@Disabled("AMD-65 pending")` as the executable acceptance test. **M9 must not publish command-bearing `CapabilityAdded` until this lands.**

## 2. Specification

A hand-rolled `Expectation` `JsonSerializer`/`JsonDeserializer` pair in `core/persistence`, **keyed on the `Expectation` interface** (Jackson `SimpleSerializers` walks superclasses/interfaces, exactly as the `AttributeValue` pair is keyed on its interface), registered in `PersistenceJacksonModule`. Compact tagged-union envelope **mirroring `AttributeValueSerializer` (REC-100)**: `{"t":"<permit-simple-name>", …}`. **Exhaustive `switch` over the 4 permits with NO `default`** (so a future permit is a compile-time break — the established discipline):

| Permit (verified shape) | Wire form | Notes |
|---|---|---|
| `ExactMatch(AttributeValue expectedValue)` | `{"t":"ExactMatch","v":<AttributeValue>}` | `v` delegates to the **existing** `AttributeValue` codec |
| `AnyChange(AttributeValue previousValue)` | `{"t":"AnyChange","v":<AttributeValue>}` | `v` delegates to the existing `AttributeValue` codec |
| `EnumTransition(String expectedValue)` | `{"t":"EnumTransition","v":"<string>"}` | plain string |
| `WithinTolerance(double target, double tolerance)` | `{"t":"WithinTolerance","target":<bits>,"tolerance":<bits>}` | **AMD-52 bit-anchored-float treatment**: `Double.doubleToLongBits` text-round-trippable encoding + JSON-valid non-finite sentinels (`"NaN"`/`"+Inf"`/`"-Inf"`) + `−0.0`→`+0.0` |

**JPMS edge (the load-bearing change — this is NOT contract-only like M4.C):** the codec names `com.homesynapse.device` types (`Expectation` + the 4 permits), so **`core/persistence` gains `requires com.homesynapse.device`**. Verified acyclic: `com.homesynapse.device` does **not** `requires com.homesynapse.persistence` (device requires value/event/platform only). This is a real `module-info.java` change and the M5-A build STOP-gate.

**Jackson isolation holds (no domain annotations):** the codec lives in persistence; `Expectation` and its permits stay annotation-free — `NO_JACKSON_IN_DOMAIN_MODEL` (Rule 10) is satisfied, exactly as for `AttributeValue` (AMD-52). No `@JsonTypeInfo`.

## 3. Downstream Impact

- **`PersistenceJacksonModule`:** +`addSerializer(Expectation.class, …)` / +`addDeserializer(Expectation.class, …)`; 2 new package-private types (`ExpectationSerializer`/`ExpectationDeserializer`).
- **Acceptance:** un-`@Disabled` `EventPayloadCodecTest.CapabilityEvents.capabilityAdded_onOff_roundTrips` (`TestEventSamples.capabilityAddedOnOff()`) — it must pass (full round-trip, no `DegradedEvent`).
- **`module-info.java` (persistence):** + `requires com.homesynapse.device;` (the only JPMS change).
- **No change** to `Expectation` or any permit's shape; **no change** to event-store rows or `projectionVersion`.

## 4. Invariants

- **AMD-87-INV-01:** every `Expectation` permit round-trips losslessly through `EventPayloadCodec`; `WithinTolerance`'s two doubles use the AMD-52 bit-anchored-float / non-finite-sentinel determinism (so a tolerance of `0.1` or a `NaN` sentinel survives encode→decode bit-identically). Cites: AMD-52 (float determinism), AMD-59-INV-02 (`CapabilityAdded` carries the full instance), the `NO_JACKSON_IN_DOMAIN_MODEL` rule.

## 5. Scope Fences / Deferred

- Codec **only**. **NO** `Expectation.evaluate(...)` implementation — `WithinTolerance.evaluate()` still throws "deferred to Phase 3" (foundation-readiness F2); confirmation evaluation is automation (M7/M8), independent of serialization.
- **NO** new persisted shape, no event-store migration, no `projectionVersion` bump.
- **NO** `@JsonTypeInfo` / domain Jackson annotations.

## 6. Implementing WU

**M5-A** (this window). Lightweight block-track (P4).

## 7. Ratification Checklist

- [x] Lightweight DOCS-Project review (P4 — additive serde, AMD-52 precedent; not the full-review track) — RETURNED **RATIFY-WITH-EDITS** 2026-06-06 (`context/audits/2026-06-06_AMD-87_DOCS_Review_Return.md`).
- [x] Nick ratification — **2026-06-07** (co-ratified with AMD-86 + Doc 15 Lock).
- [x] On ratification (2026-06-07): registered **AMD-87-INV-01** (Architecture_Invariants_v1.md); watermark raised **AMD-64 → 87** (E1); nav-index row added; E1/E2/E3 folded.

## 8. Review Disposition

**RATIFIED 2026-06-07** — lightweight DOCS review RATIFY-WITH-EDITS (E1/E2/E3) folded; co-ratified with AMD-86 + Doc 15 Lock. Acceptance spec in-tree (`@Disabled("AMD-65 pending")` test); **M5-A Part 2 un-disables it** (un-gated 2026-06-07).
