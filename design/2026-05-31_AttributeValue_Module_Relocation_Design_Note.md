<!--
file: design/2026-05-31_AttributeValue_Module_Relocation_Design_Note.md
purpose: Design note for relocating the AttributeValue value hierarchy to a new com.homesynapse.value leaf module, resolving the event→device JPMS cycle that AMD-52's typed StateChangedEvent payload would otherwise create. Behavior-preserving structural refactor; precedes the AMD-52 typed-payload implementation.
audience: PM, Nick, Coder, external review
state-type: current
status: CURRENT — issued 2026-05-31
ground-truth: HEAD `98f705b` (projectionVersion 3, watermark AMD-52); verified with the Read tool on the working tree (in-sandbox git/grep distrusted — synced-folder churn)
companion: homesynapse-core-docs/design/amendments/AMD-52_*.md (§12 erratum); 2026-05-31_AMD-52_Typed_Payload_Serializer_Replay_Design_Beat.md
-->

# Design Note — Relocate the `AttributeValue` Hierarchy to a `com.homesynapse.value` Leaf Module

**Author:** PM (Cowork, Mode 1). **Date:** 2026-05-31.
**Trigger:** the M4.0b-4 coding-instruction STOP-gate fired on a real defect — AMD-52's typed `StateChangedEvent` payload puts a `com.homesynapse.device` type into a `com.homesynapse.event` record, which would force `event → device` while `device → event` already exists → a **JPMS cyclic dependence** (compile-time blocker). This note specifies the behavior-preserving structural fix that unblocks AMD-52.
**Scope:** a pure module/package relocation. **No semantics, no `projectionVersion` change, no contract change.** It precedes the AMD-52 typed-payload code (sequencing in §6).

---

## 0. What this is — and is not

**It is:** the decision + spec to move the self-contained `AttributeValue` value hierarchy out of `core/device-model` into a **new leaf module `com.homesynapse.value`** that both `com.homesynapse.event` and `com.homesynapse.device` depend on — turning the event↔device near-cycle risk into a clean DAG over a shared value leaf.

**It is not:** an amendment (the governing amendment is AMD-52; this note + the AMD-52 §12 erratum record the resolution), a behavioral change, or a reopening of any ratified AMD-52 fork (bit-anchored identity F1, Path-B `DegradedEvent` F2, the codec mechanism, 3→4 staging — all stand). The `AttributeValue` types' *public contract* (records, fields, sealing, canonicalization, `AttributeType` values) is **unchanged**; only their package and owning module change.

---

## 1. The defect (source-verified, HEAD `98f705b`)

```java
// core/device-model/src/main/java/module-info.java
module com.homesynapse.device {
    requires com.homesynapse.event;            // ← device DEPENDS ON event
    requires transitive com.homesynapse.platform;
    exports com.homesynapse.device;
}
// core/event-model/src/main/java/module-info.java
module com.homesynapse.event {
    requires transitive com.homesynapse.platform;   // ← event does NOT depend on device
    exports com.homesynapse.event;
}
```

AMD-52 changes `StateChangedEvent` (in `com.homesynapse.event`) to carry `AttributeValue oldValue/newValue` (type in `com.homesynapse.device`). For that record to compile, `com.homesynapse.event` must `requires com.homesynapse.device`. Combined with the existing `device → event`, that is a **cycle**, which JPMS rejects (`cyclic dependence involving com.homesynapse.event`).

**Why it slipped (recorded for the lessons file):** the OQ-05-08 design beat and AMD-52 §2.2/§7.1 checked the **persistence codec's** reachability of `AttributeValue` (`persistence → transitive state → transitive device` — correct, no edge needed there) and concluded "no new module edge." Neither checked the edge created by the typed field living in the **event-model record itself**. In hindsight AMD-51 §2.7's String-payload preservation was implicitly guarding this boundary — keeping device types out of event-model. The persistence-reachability check answered the wrong question.

**`AttributeValue` relocates cleanly (verified):** `AttributeValue` + the 8 variants + `AttributeType` import only `java.base` + each other + `AttributeType` — zero `com.homesynapse.event`/`device` dependencies. So they can sit in a leaf module that depends on nothing but `java.base`.

---

## 2. Decision — a new `com.homesynapse.value` leaf module (NOT platform-api)

Create `core/value-model` → JPMS module **`com.homesynapse.value`**, package `com.homesynapse.value`, `requires` nothing but the implicit `java.base`, `exports com.homesynapse.value`. Both event-model and device-model depend on it. Resulting graph (acyclic):

```
                 com.homesynapse.platform   (existing leaf)
                          ▲
       ┌──────────────────┼───────────────────┐
 com.homesynapse.value    │              (value is a sibling leaf; requires only java.base)
       ▲        ▲         │
       │        │         │
 com.homesynapse.event ───┘   (event requires value + platform; NO device dep)
       ▲
 com.homesynapse.device ──► com.homesynapse.value, com.homesynapse.event, platform
       ▲
 com.homesynapse.state  ──► device, event, value, platform
       ▲
 com.homesynapse.persistence ──► state, event, (value), platform, jackson…
```

**Why a dedicated `value` leaf, not `platform-api`** (the structural call Nick made): `platform-api` would also work with zero new edges (both event and device already require it), but it would bloat the identity/abstraction leaf with a domain value model and make `AttributeValue` visible everywhere. A dedicated `value` leaf keeps event-model and device-model as **peers over a shared value contract** — which matches reality (both events and devices traffic in attribute values) and is the architecturally honest call for a long-lived codebase.

---

## 3. Exactly what moves — the minimal set

**MOVE** (from `com.homesynapse.device` → `com.homesynapse.value`, 10 types — package rename `com.homesynapse.device` → `com.homesynapse.value`, public contracts unchanged):

`AttributeValue` (sealed interface) · `BooleanValue` · `IntValue` · `FloatValue` · `StringValue` · `EnumValue` · `QuantityValue` · `ArrayValue` · `DegradedAttributeValue` · `AttributeType` (enum).

**STAYS in `com.homesynapse.device`** (Nick's "move only the minimum"):

- `AttributeSchema` — device/capability metadata; references `AttributeType` (now in value) → device gains `requires com.homesynapse.value` (it will anyway), so no forced move.
- `AttributeValueUpcaster` — the stored-value-migration SPI; returns `AttributeValue` / produces `DegradedAttributeValue` (now in value) → same `requires com.homesynapse.value` covers it. It is **not** on the AMD-52 path (Path B = `DegradedEvent`, no decode-path upcast), so leaving it in device is correct and lower-blast-radius.
- Everything else in device-model (Device, Entity, Capability, registries, discovery).

**Forced-move check:** the only thing that would force `AttributeSchema`/`AttributeValueUpcaster` to move is if `value` needed to reference *them* (it must not — `value` is a leaf). It does not: the value types reference only each other + `AttributeType`. Confirmed clean. The compile-spike (§5) is the definitive check.

---

## 4. The `requires` graph — verbatim before/after (STOP-on-mismatch anchors)

The rule: **any module that directly names a `com.homesynapse.value` type declares `requires com.homesynapse.value`** — `requires transitive` if it re-exports those types on its own public API, plain `requires` otherwise. The spike verifies the minimal correct set; the proposed diffs below cover the **known** importers, but the importer set is broader than event/device/state/persistence — a recon grep at `98f705b` also found **`api/rest-api`** (4 files) naming the value types, and there may be others (automation, websocket-api, integration-runtime, observability — they read `EntityState.attributes`/`AttributeValue`). **The grep is authoritative:** edge **every** module that `grep -rlE "com\.homesynapse\.device\.(AttributeValue|BooleanValue|IntValue|FloatValue|StringValue|EnumValue|QuantityValue|ArrayValue|DegradedAttributeValue|AttributeType)" --include=*.java` returns (minus `/build/`), not just the four diffed here. The proposed diffs for the core four:

**NEW — `core/value-model/src/main/java/module-info.java`:**
```java
module com.homesynapse.value {
    exports com.homesynapse.value;
}
```

**`com.homesynapse.event`** (now references `AttributeValue` on the public `StateChangedEvent` API → **transitive**):
```diff
 module com.homesynapse.event {
+    requires transitive com.homesynapse.value;
     requires transitive com.homesynapse.platform;
     exports com.homesynapse.event;
 }
```

**`com.homesynapse.device`** (references the value types throughout its API — `AttributeSchema`, capabilities → **transitive**, replacing in-module ownership):
```diff
 module com.homesynapse.device {
+    requires transitive com.homesynapse.value;
     requires com.homesynapse.event;          // see §7 — verify/clean if vestigial (separate)
     requires transitive com.homesynapse.platform;
     exports com.homesynapse.device;
 }
```

**`com.homesynapse.state`** already `requires transitive` device + event (both now re-export value), so value is visible transitively. **Recommended:** add an explicit `requires transitive com.homesynapse.value;` so state does not silently depend on device's re-export (robustness; state names value types directly in the comparator/reconstructor). The spike confirms whether the explicit line is necessary or merely hygienic.

**`com.homesynapse.persistence`** names `AttributeValue` directly (the codec + `CheckpointSerializer`); it does not re-export it. value is reachable transitively via `requires transitive com.homesynapse.event` (which now re-exports value) and via state→device. **Recommended:** add an explicit non-transitive `requires com.homesynapse.value;` so the codec's dependency is declared at its use site, not inherited. (This is the one place AMD-52-INV-02's "the codec adds no `requires`" claim changes — see the AMD-52 §12 erratum: the codec now declares `requires com.homesynapse.value`, which did not exist pre-relocation.)

No other module-info changes are anticipated; the spike is the authority.

---

## 5. The sign-off gate — a JPMS compile-spike (not prose review alone)

This edge was missed by reading twice (the design beat, and AMD-52's external review — which checked persistence, not the event record). Prose review keeps missing module cycles. So the **definitive sign-off gate is an empirical compile-spike**, with external review as a complement, not a substitute. (The PM skill explicitly sanctions spikes for exactly this kind of empirical question.)

**Spike — "does the relocation break the cycle and compile?"**
- **Question:** does creating `com.homesynapse.value`, moving the 10 types, and adding the §4 `requires` edges yield an acyclic graph that compiles clean (`-Xlint:all -Werror`, all `module-info` resolved)?
- **Success:** the full module graph compiles; no `cyclic dependence`; `event` does NOT require `device`; the value types resolve from event, device, state, persistence.
- **Failure:** any residual cycle, or a forced move of `AttributeSchema`/`AttributeValueUpcaster`/another type into `value` to compile (→ re-scope §3).
- **Where:** a throwaway branch/worktree, NOT a record of production intent until it passes. Findings recorded here (§5 outcome) + the M4.0b-4a coding instruction.
- **Time-box:** small — it is a package-rename + four module-info edits + a compile.

**Gate:** M4.0b-4a (the production relocation) is authored only after the spike compiles clean AND an external-review pass concurs. The spike is the gate; review is the second pair of eyes.

---

## 6. WU sequencing — relocation and typed-payload on separate commit boundaries

Per milestone discipline ("single compile-and-commit unit") and to keep structural risk and semantic risk apart:

- **M4.0b-4a — relocation (this note).** Pure, behavior-preserving refactor: create `core/value-model`, move the 10 types (package rename), add the §4 `requires` edges, update every `import com.homesynapse.device.{AttributeValue,…}` → `com.homesynapse.value.*` across the codebase, update MODULE_CONTEXTs. **No `projectionVersion` change, no semantics, no typed payload.** Build GREEN on its own commit. This is where a rename slip is caught in isolation.
- **M4.0b-4b — typed payload (AMD-52).** Layer the typed `StateChangedEvent` + the `AttributeValue` codec + typed materialization + Path-B gate + `projectionVersion` 3→4 onto the now-clean graph. This is the existing `M4.0b-4_Typed_StateChangedEvent_Payload_Serializer.md` instruction, **re-targeted to 4b** and rebased on the relocated packages (the `AttributeValue` import path changes `device` → `value`; the event-model→device STOP-gate is removed because the edge is now event→value, which is legal).

Milestone ids M4.0b-4a / M4.0b-4b proposed under the projection-block scheme — confirm with Nick (M4.0b-4 was already confirmed as the typed-payload step; this splits it).

---

## 7. The vestigial `device → event` edge (hygiene — verify, do NOT invert)

`core/device-model` declares `requires com.homesynapse.event`, but a grep found **zero** `import com.homesynapse.event` in device-model main source — the edge may be **vestigial**. Worth verifying and removing as hygiene during M4.0b-4a (the spike will reveal whether anything in device actually needs event).

**Do NOT, however, "fix" the cycle by removing `device → event` and adding `event → device` instead.** Even if `device → event` is dead, inverting the layering (making event-model depend on device-model) is wrong: event-model is the foundational near-leaf of the domain (events are produced about devices; the dependency flows device → event, never the reverse), and an `event → device` edge would re-break the moment device-model next needs an event type. The `value` leaf is the robust answer; the dead-edge cleanup is independent hygiene that does not, on its own, solve the typed-payload problem (the field type must live in a leaf both modules depend on).

---

## 8. Coherence — what does and does not change

- **No ratified AMD-52 fork reopened.** F1 (bit-anchored identity / `chain_hash` inert), F2 (Path-B `DegradedEvent`, no decode-path upcaster), the codec mechanism (`{"t":…,"v":…}`, no `@JsonTypeInfo`), and the 3→4 staging all stand. The codec still lives in `core/persistence`; it now serializes `com.homesynapse.value.AttributeValue` instead of `com.homesynapse.device.AttributeValue` — a package change only.
- **AMD-47 placement superseded (no contract change).** AMD-47 established the `AttributeValue`/variant/`AttributeType` hierarchy in `com.homesynapse.device`. This relocation supersedes that *placement* (the types move to `com.homesynapse.value`); the AMD-47 *contract* (8-variant sealing AMD-47-INV-01, canonicalize-at-construction AMD-47-INV-03, Degraded non-declarable AMD-47-INV-04, ArrayValue full-replacement AMD-47-INV-05) is unchanged and travels with the types. A one-line forward-note is added to AMD-47.
- **AMD-52-INV-02 wording correction (via the §12 erratum).** "The codec adds no `requires` to any `module-info.java`" becomes: the relocation adds `com.homesynapse.value` and the §4 `requires` edges; the codec then declares `requires com.homesynapse.value` at its use site. The *substance* of INV-02 (no new Jackson artifact; no `@JsonTypeInfo`; total over 8 variants; Jackson confined to persistence) is unchanged.
- **The Jackson-isolation HARD RULE still holds** — Jackson stays confined to `core/persistence`; the value types carry no Jackson annotation (same as before, just in a new module). ArchUnit's `no com.fasterxml.jackson.* outside persistence` is unaffected.

---

## 9. Source anchors (confirm before M4.0b-4a — STOP-on-Mismatch)

Verified via the Read tool at HEAD `98f705b`:
- `core/device-model/src/main/java/module-info.java` — `requires com.homesynapse.event; requires transitive com.homesynapse.platform; exports com.homesynapse.device;` (verbatim §1).
- `core/event-model/src/main/java/module-info.java` — `requires transitive com.homesynapse.platform; exports com.homesynapse.event;` (verbatim §1; no device).
- `AttributeValue.java` + the 8 variant files + `AttributeType.java` — in `com.homesynapse.device`, importing only `java.base` + each other + `AttributeType` (the relocatable set, §3).
- `AttributeSchema.java`, `AttributeValueUpcaster.java` — in `com.homesynapse.device`, reference `AttributeType`/`AttributeValue` (stay; pick up `requires com.homesynapse.value`).
- Consumers naming the value types (import updates in M4.0b-4a): `core/state-store` (`ProductionDerivationRule`, `AttributeValueComparator`/`StructuralAttributeValueComparator`, `AttributeValueReconstructor`, `ComparisonPolicy`?, `AttributeSchemaResolver`), `core/persistence` (`CheckpointSerializer`, the new codec), any device-model internal references, and the `StateChangedEvent` field type at M4.0b-4b.

**Bottom line:** AMD-52's typed payload is sound; its types just live in the wrong module to express it without a cycle. Relocate `AttributeValue` + variants + `AttributeType` to a new `com.homesynapse.value` leaf (minimal move), prove the graph acyclic with a compile-spike, land it as M4.0b-4a (green build, no semantics), then layer the typed payload as M4.0b-4b. No ratified decision changes.
