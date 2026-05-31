<!--
file: design/2026-05-31_AMD-52_Typed_Payload_Serializer_Replay_Design_Beat.md
purpose: Design-beat scoping doc for AMD-52 (typed StateChangedEvent payload). Closes OQ-05-08 — settles or frames the serializer / event-store-shape / replay-determinism / staging sub-questions from first principles against actual source, and sets the go/no-go gate for AUTHORING AMD-52. This beat authors no amendment and no code.
audience: PM, Nick, HomeSynapse Core Claude Project (research dispatch)
state-type: current
status: CURRENT — issued 2026-05-31
last-verified: 2026-05-31 against HEAD `98f705b` (working-tree Read tool — in-sandbox git/grep distrusted on this synced folder, per the M4.0a/M4.B3 mount-staleness lesson)
predecessor: context/planning/2026-05-30_M4.0b-3_design-track-map.md §3 (CLOSED — reference only, do not reopen)
-->

# AMD-52 Design Beat — Typed `StateChangedEvent` Payload: Serializer / Replay Blast-Radius Scoping (OQ-05-08)

**Author:** PM (Cowork, Mode 1 — Architect)
**Date:** 2026-05-31
**Ground truth:** HEAD `98f705b` (M4.0b-3 / AMD-51 shipped); `projectionVersion` **3**; on-disk amendment watermark **AMD-51**; Workstream A COMPLETE. `homesynapse-core-docs` `d36f7a0` (AMD-51 §2.6 erratum). `nexsys-hivemind` `605b5d1`.
**Gate closed:** OQ-05-08 (the AMD-52 serializer/replay design beat).
**Gate opened:** the AMD-52 authoring go/no-go (§9) — and, behind it, **Research 11** (Deliverable 2, the deep-research brief scoped to the §10 forks).
**Precedent format:** `2026-05-20_M3.6_Composition_Root_Design.md` (work-unit design beat — scope calibration, per-question contracts, STOP-on-mismatch source anchors).

---

## 0. What this beat is — and is not

This is the scoping beat that the M4.0b-3 design-track map (§3) and the Research 10 v2 assessment (the OQ-05-08 5-item checklist) both demanded **before** AMD-52 can be authored. NQ-10-4 / REC-91 named the typed `StateChangedEvent` payload "the single most dangerous item in the track" precisely because it crosses the serializer, the event-store shape, and replay determinism at once — surfaces the AMD-51 comparator deliberately did **not** touch. AMD-51 §2.7 preserved the String `StateChangedEvent` payload unchanged for exactly this reason: so the typed-payload swap could be staged behind its own beat. This is that beat.

**It does:** settle or frame each OQ-05-08 sub-question from first principles against the actual source; mark each DECIDED (with rationale) or OPEN (needs research/Nick); keep every decision coherent with AMD-51 §2.7 (String-payload rationale) and the AMD-51 §2.6 erratum (the String/transient-typed boundary precedent); and define the explicit go/no-go gate for authoring AMD-52.

**It does NOT:** author AMD-52, write or specify production code, issue a coding instruction, or bump `projectionVersion`. The String `StateChangedEvent` payload **remains frozen** until AMD-52 is authored and ratified (a guardrail — §8). The predecessor M4.0b-3 design-track map is CLOSED (§0c there); it is referenced here as the predecessor, not reopened.

---

## 1. The structural fact that organizes the whole beat: there are TWO serialization surfaces, not one

The design-track map §3 spoke of "the serializer." Source shows AMD-52 actually crosses **two distinct, independently-versioned serializers**, owned by different mechanisms, both confined to `core/persistence`. Conflating them is the first error to avoid; the rest of this beat keeps them separate.

| # | Surface | Class (source-verified) | Storage | What it serializes | Touched by AMD-52? |
|---|---|---|---|---|---|
| **S1** | **Event payload** | `EventPayloadCodec` (pkg-private; sole `DomainEvent`↔JSON boundary, DECIDE-M2-06) over `PersistenceObjectMapper` | `events.payload` **BLOB NOT NULL** column (V001) | the inner `DomainEvent` record — here `StateChangedEvent` itself | **YES** — `StateChangedEvent.oldValue/newValue` become typed `AttributeValue` |
| **S2** | **Projection checkpoint** | `CheckpointSerializer` (pkg-private) over a `JsonInclude.Include.ALWAYS` mapper | `view_checkpoints.data` **BLOB NOT NULL** column (V001, Doc 04 §3.12) | the materialized `EntityState` map snapshot — `attributes` currently flattened to `Map<String,String>` | **YES** — typed materialized `attributes` need a typed envelope |

S1 is the **event** (the durable, append-only record that replay reads). S2 is the **materialized view** (a derived, rebuildable snapshot). The typed-payload change forces both: the event carries the typed value (S1), and `StateProjection.applyToState` would then materialize that typed value into `EntityState.attributes` (S2) instead of today's `new StringValue(...)`. S2 already anticipates this — `CheckpointSerializer`'s Javadoc says verbatim: *"When a future projection writes other `AttributeValue` kinds, the representation must be extended (a typed envelope per entry, or a per-value polymorphic codec)."* Both surfaces share the same nested-`AttributeValue` codec problem (§3), so they are solved together, once.

**Coherence with AMD-51.** Today both surfaces store **String only** — `applyToState` writes `new StringValue(sc.newValue())` (≈ line 819) and the AMD-50 backfill `applyBackfillAttribute` likewise (≈ line 928); `CheckpointSerializer` flattens to `Map<String,String>` and rebuilds as `new StringValue(v)`. This is the load-bearing fact behind AMD-51 §1.2 / AMD-51-INV-05 (the materialized prior is *always* a `StringValue`) and the §2.6 erratum (String/transient-typed boundary). AMD-52 is exactly the amendment that ends the "String-only materialized state" regime — so it must re-confirm that nothing in AMD-51's symmetric-reconstruction contract silently breaks when the prior side stops being a guaranteed `StringValue`. (Framed in §7; the comparator itself is total over the typed hierarchy already, so the change is benign — but it must be stated, not assumed.)

---

## 2. Sub-question 1 (OQ-05-08 #1) — Jackson (de)serialization strategy for the sealed 8-variant `AttributeValue`

**The fork.** A typed `StateChangedEvent(AttributeValue oldValue, AttributeValue newValue, …)` embeds a **nested polymorphic sum type** inside the event record. The reader, given JSON, must recover the right one of the 8 permits. How is the discriminator carried, and is the encoding deterministic and stable on disk across `projectionVersion`?

### 2.1 DECIDED — the discriminator mechanism (hard constraints from source)

**DECIDED: a custom serializer/deserializer pair registered in a Jackson module inside `core/persistence`, keyed by an explicit `AttributeType` discriminator — NOT Jackson's `@JsonTypeInfo`, and NOT any annotation on `AttributeValue` or `StateChangedEvent`.** Three independent source constraints force this and leave no latitude:

1. **`@JsonTypeInfo` is structurally banned on event types.** ArchUnit Rule 7 `NO_JSON_TYPE_INFO_IN_EVENTS` rejects it; the persistence MODULE_CONTEXT records it verbatim (DECIDE-M2-06): *"`@EventType` is the polymorphic dispatch key, not `@JsonTypeInfo` … `@JsonTypeInfo` is banned by ArchUnit Rule 7 because it would pollute the public event-model types with Jackson annotations and tie deserialization to a fragile classpath-scanning contract."* The event layer already does polymorphism by an **explicit discriminator** (the `events.event_type` column + `EventTypeRegistry`), not Jackson reflection. AMD-52's nested type must follow the same philosophy one level down.
2. **The Jackson-isolation HARD RULE.** Jackson is confined to 9 package-private classes in `com.homesynapse.persistence`; *no event record anywhere may carry a Jackson annotation*, and no other module may import `com.fasterxml.jackson.*`. `AttributeValue` lives in `com.homesynapse.device` — annotating it (or `StateChangedEvent` in `com.homesynapse.event`) would breach the rule and make Jackson un-swappable. So the codec must live in persistence and treat `AttributeValue` as a plain data type from the outside.
3. **The existing precedent is exact.** `PersistenceJacksonModule` already registers 10 custom serializer/deserializer pairs for the ULID/typed-identity wrappers (`UlidSerializer`/`TypedUlidDeserializer`, …) — keeping those wrappers Jackson-annotation-free (LTD-04). The `AttributeValue` codec is the same pattern: a `JsonSerializer<AttributeValue>` / `JsonDeserializer<AttributeValue>` pair, registered in (or alongside) `PersistenceJacksonModule`, emitting/reading an explicit `AttributeType` tag plus the variant's value. The 8-permit `AttributeType` enum is the natural discriminator (it already exists: `BOOLEAN/INT/FLOAT/STRING/ENUM/QUANTITY/ARRAY/DEGRADED`).

This also keeps AMD-52 consistent with AMD-51-INV-01 (the comparator's exhaustive no-`default` switch over the 8 permits): the codec's dispatch is the serialization-layer twin of that switch and should likewise be total over the 8 `AttributeType` values, so a future 9th permit forces a visible failure rather than a silent lossy encode.

**Map-ordering is a non-issue (DECIDED).** The design-track map §3 flagged "map ordering" as a determinism risk. Source clears it: **no `AttributeValue` variant contains a `Map`.** The only compound variant is `ArrayValue(List<AttributeValue>)`, which is an **ordered** `List` (`List.copyOf`, order-preserving) — element order is semantic (AMD-51 §2.2 array compare is order-sensitive) and serializes deterministically as a JSON array. There is no key-ordering nondeterminism to pin on either surface.

### 2.2 OPEN — the three genuine encoding forks (→ Research 11 + Nick)

The *mechanism* is decided; the *exact wire form* is not, and three sub-decisions carry real determinism risk. These are the heart of what the research brief must inform:

- **(a) Envelope shape.** The exact on-wire layout of the `{discriminator, value}` envelope — a compact tagged form (e.g. `{"t":"FLOAT","v":21.0}`) vs a nested form vs a tag-prefixed scalar — and whether `ArrayValue` recurses the same envelope per element. Must be compact (BLOB-size budget, INV-PR-01 / `Include.NON_NULL` posture) and stable on disk. **OPEN** (ergonomic + durability call; prior art via Axon `@Revision` serializers, Akka Persistence serializers, Kafka Schema Registry Avro/Protobuf union encodings — §10).
- **(b) Deterministic floating-point rendering.** `FloatValue(double)` and `QuantityValue(double, …)` must render to a **byte-deterministic** text form so the stored payload is reproducible. Jackson's default `double`→text is not guaranteed to be the canonical shortest round-trip across versions/platforms; and the payload's byte-stability matters for forensic equality, idempotency, and the reserved `chain_hash` column (V001, AMD-37). The comparator works on the in-memory `double` (epsilon-tolerant), but the *stored* form must be pinned. **OPEN** — needs a chosen canonical `double`→string contract (candidate: shortest round-trippable decimal, fixed locale, no platform variance), validated like AMD-51 §5 #5b's `Double.doubleToLongBits` bit-identity tests.
- **(c) `NaN` / `±Inf` / `−0.0` JSON encoding.** Standard JSON cannot represent `NaN` or `±Infinity`; `FloatValue` **can** carry them (no constructor guard — source-confirmed, vs `QuantityValue` which rejects non-finite at construction). The codec must define a **lossless, deterministic, JSON-valid** encoding for the IEEE-754 edge set that AMD-51-INV-02 already enumerates (sentinel strings are the likely answer; enabling Jackson `ALLOW_NON_NUMERIC_NUMBERS` writes bare `NaN`/`Infinity` tokens that are **not** valid JSON and would break the forward-compat reader posture — likely rejected). `−0.0` must canonicalize consistently with the comparator (AMD-51 §2.3 maps `−0.0`→`+0.0`). **OPEN** — a correctness fork, not a preference.

**Status: FRAMED — mechanism DECIDED, wire-form OPEN.** Sub-decisions (a)/(b)/(c) are the primary research targets and a Nick ratification item.

---

## 3. Sub-question 2 (OQ-05-08 #3) — Does the typed payload change the event-store row shape, or stay inside the existing payload column?

**DECIDED: the typed payload stays inside the existing BLOB column on BOTH surfaces — no row migration on the `events` table and none on `view_checkpoints`.** Confirmed against source, not assumed (the design-track map §3 said "almost certainly the latter — confirm").

**S1 (event store), confirmed against V001 + `EventPayloadCodec`:**

- The `events` row carries `payload BLOB NOT NULL` (V001 line 52) — the codec writes UTF-8 JSON bytes into it (DECIDE-M2-06). A richer *inner* JSON shape changes the bytes **inside** the BLOB; the column, the 25-column row, and the 24-bind `INSERT_SQL` are untouched. `EventPayloadCodec`'s contract is `byte[]` — the typed payload is still `byte[]`.
- **The per-event version seam already exists.** `events.schema_version INTEGER NOT NULL DEFAULT 1` (V001 line 33) is a *per-event* version, distinct from `projectionVersion`. `EventPayloadCodec.decode(String eventType, int schemaVersion, byte[] payload)` already **threads `schemaVersion`** from that column into the decode path. AMD-52 therefore bumps `StateChangedEvent`'s written `schema_version` (1 → 2) to mark typed payloads, and the decoder branches on it — **no new column, no migration.** This is the existing event-upcaster seam (Doc 01 §3.10) doing exactly its job.
- The forward-compat reader posture survives: `PersistenceObjectMapper` disables `FAIL_ON_UNKNOWN_PROPERTIES` (INV-ES-07) — a newer typed payload read by an older reader degrades gracefully rather than crashing.

**S2 (projection checkpoint), confirmed against V001 + `CheckpointSerializer`:**

- The checkpoint lands in `view_checkpoints.data BLOB NOT NULL` (V001) — a typed `attributes` envelope is a richer JSON shape **inside** that BLOB; the table is untouched. (Note: this BLOB is binary written via `setBytes`/`getBytes`, not `setString` — a known gotcha, unaffected here.)
- The checkpoint payload **does** change representation (`Map<String,String>` → a typed envelope per entry) — the extension the `CheckpointSerializer` Javadoc already anticipates. That is a code change inside the BLOB, not a schema change. Its `ALWAYS`-inclusion mapper (needed for null `staleAfter`/null attribute round-trip) must be preserved.

**One genuine sub-decision (OPEN, narrow): checkpoint forward-compatibility.** A checkpoint written by the typed projection cannot be read by a pre-AMD-52 binary. This is already handled by the existing mechanism — a `projectionVersion` mismatch triggers AMD-50 reconciliation (clear-and-rebuild from the event log), and `CheckpointSerializer.deserialize` already throws → clear-and-replay on schema drift. AMD-52's 3→4 bump (§5) makes this automatic. **Confirm**, at authoring, that the typed checkpoint's deserialize-failure path lands cleanly on AMD-50 reconciliation rather than a hard error. Non-blocking; rides existing machinery.

**Status: DECIDED — no row migration on either surface; in-BLOB representation changes on both; the per-event `schema_version` column is the existing typed/string discriminator.** This sub-question is closed by this beat (it becomes gate criterion G5).

---

## 4. Sub-question 3 (OQ-05-08 #2) — The replay-determinism contract (where the SPI finally earns its place)

**The contract to satisfy.** Replaying the historical log under the AMD-52 typed regime must produce a **bit-deterministic** typed value for every `state_changed`, identically on LIVE, on the 3→4 backfill, and on any forensic re-read — with **zero in-place mutation** of already-written events (the cardinal event-sourcing anti-pattern). The log holds **String-payload** `state_changed` (schema_version 1) written under M4.0b-1/2/3; the new rule is typed. There are two distinct replay surfaces, and the choice between them is the central fork.

### 4.1 The two replay surfaces

- **Path A — re-derivation from `state_reported` during the 3→4 backfill (the authoritative path).** This is the AMD-50/AMD-51 precedent applied unchanged. The projection does **not** trust historical `state_changed` payloads; AMD-50 §2.2 supersession means a logged prior-version `state_changed` advances the cursor but its attribute write is suppressed, and the **current** rule re-derives the canonical value from the immutable `state_reported` log (AMD-51 §2.6 symmetric schema-driven reconstruction). Under AMD-52 the re-derived value is simply *materialized typed* (S2) and *emitted typed* (S1) instead of stringified. Because reconstruction is a pure, schema-keyed parse with no clock/I/O (AMD-50-INV-03; `DerivationContext` has no `Clock`), it is deterministic by construction. **This is where the value layer earns its keep — and it largely already works**: AMD-51 §5 #5b already proves `QuantityValue` canonicalization is `Double.doubleToLongBits`-bit-identical across reconstructions.
- **Path B — version-aware decode of a historical String-payload `state_changed` (the forensic residual).** Reading an on-disk schema_version-1 `state_changed` *as a typed event* (for trace queries, observability, "why did this happen?" INV-ES-06) under a typed `ObjectReader` would today **parse-fail → `DegradedEvent`** (lossy — `EventPayloadCodec` decode stage 2 fallback). AMD-52 must define this: either a **version-branched decode** (schema_version 1 → read the String fields → lift to typed) or an accepted `DegradedEvent` for legacy rows. This is the `AttributeValueUpcaster` SPI's other natural home — the value-layer analogue of the event upcaster, `upcast(storedTypeName, rawForm, fromSchemaVersion)`, keyed by exactly the per-event `schema_version`.

### 4.2 PM lean (framed, not decided) + the determinism guarantees

- **Path A is the determinism keystone and should be authoritative** — it is the frozen AMD-50 backfill + AMD-51 reconstruction, reused unchanged, which AMD-52 must not re-open. The historical String `state_changed` events are **superseded, never rewritten** (anti-pattern avoided). This keeps AMD-52's replay story identical in shape to AMD-51's 2→3 story.
- **Path B is the open call**, and it is genuinely open because it determines whether the `AttributeValueUpcaster` is wired into the *decode* path (not just the derivation path) — a scope question with real blast radius. PM lean: prefer a **deterministic version-branched lift over a lossy `DegradedEvent`** for historical `state_changed` reads, *if and only if* the lift is provably bit-deterministic; otherwise accept `DegradedEvent` for pre-AMD-52 rows and rely on Path A for all *state* reconstruction. Either way, **no event is mutated.**
- **The determinism obligations the research + authoring must discharge:** (i) same `(storedTypeName, rawForm, fromSchemaVersion)` ⇒ **bit-identical** typed value, every replay (extend the AMD-51 §5 #5b bit-identity discipline to every String→typed lift, not just QUANTITY); (ii) the deterministic `double` rendering of §2.2(b) is a *precondition* for replay determinism — a non-canonical float render makes re-emitted typed payloads non-reproducible; (iii) `NaN`/`±Inf`/`−0.0` lift (§2.2(c)) must round-trip losslessly; (iv) no upcast may be **lossy** (an explicit anti-pattern for the brief — §10).

**Status: FRAMED — Path A DECIDED-by-precedent (authoritative, rides AMD-50/AMD-51 unchanged); Path B OPEN (decode-path upcaster wiring + the per-lift bit-determinism proof obligation) → Research 11 + Nick.**

---

## 5. Sub-question 4 (OQ-05-08 staging) — AMD-52 is a separate `projectionVersion` 3→4 bump riding AMD-50 unchanged

**DECIDED: AMD-52 is its own amendment, with its own `projectionVersion` 3→4 bump, riding AMD-50's frozen reconciliation-backfill discipline unchanged — the exact precedent AMD-51 set for 2→3.** Rationale, all source-anchored:

- AMD-51 §2.7 / Call 4 (REC-91 staging) preserved the String payload *specifically* so the typed-payload swap could be staged independently. The comparator returning a boolean while the rule still stringifies is "fully separable; staging costs nothing and de-risks the serializer/replay surface." This beat is the cash-out of that decision.
- A typed payload changes **derivation output** (the emitted `StateChangedEvent` is now typed) **and** **materialized state** (`applyToState` writes typed; `CheckpointSerializer` extended). Per AMD-41 §3.2.4 any change to derivation/projection logic that alters the materialized result forces a `projectionVersion` bump + reconciliation rebuild. So AMD-52 is a **3→4** bump.
- **AMD-50's mechanism is FROZEN and reused unchanged** (the same way AMD-51's 2→3 reused it; AMD-50 §2.5 generality covers any N→M). No new backfill/supersession mechanism is authored. The AMD-50 supersession test remains the standing N→M regression guard; AMD-52's closeout re-confirms it still guards the 3→4 transition (the historical `state_reported` log reconstructs typed via Path A — §4).
- AMD-50 itself is untouched: its scope note already says AMD-51/52 are separate, and the `projectionVersion` 3→4 transition "rides it unchanged."

**Coherence guardrail.** AMD-52's 3→4 is the *fourth* projection version on the *same* AMD-50 rails (1→2 = M4.0b-2, 2→3 = M4.0b-3/AMD-51, 3→4 = AMD-52). The beat asserts no new rails — only a new comparator-output/materialization shape rides them.

**Status: DECIDED.**

---

## 6. Consumer blast radius (OQ-05-08 #4) — enumerated before the type changes

Every reader of `StateChangedEvent.oldValue/newValue` (today `String`, non-null) and of the materialized `attributes` map must be enumerated so AMD-52 authoring can specify each migration. Source-anchored inventory (the readers AMD-52 must address; this is a framing list, not a code spec):

| Consumer | Where | Today | AMD-52 impact |
|---|---|---|---|
| `StateProjection.applyToState` (`state_changed` branch, ≈ L819) | state-store | writes `new StringValue(sc.newValue())` | writes the **typed** value (S2) — the change that makes the materialized prior stop being a guaranteed `StringValue` (re-confirm AMD-51-INV-05 coherence, §7) |
| `applyBackfillAttribute` (≈ L928) | state-store | writes `new StringValue(...)` during AMD-50 backfill | writes typed during the 3→4 backfill (Path A, §4) |
| `CheckpointSerializer` (S2) | persistence | flattens `attributes` → `Map<String,String>` | typed envelope per entry (§1/§3) |
| `shouldPublishDerived` (≈ L758) | state-store | string-serializes current attribute, string-compares to `sc.newValue()` (DEC-M3-02 dedup) | must stay coherent with a typed materialized value — the AMD-51 §5 #10 coherence concern, now on the *materialized* side |
| `ProductionDerivationRule.evaluate` | state-store | constructs String-payload `StateChangedEvent` (AMD-51 §2.7) | constructs typed-payload `StateChangedEvent` — the headline change |
| Query / observability surfaces | state-store / rest-api / observability | read `EntityState.attributes` as `AttributeValue` (already typed in the type system) | benign — already `AttributeValue`-typed; gain real types instead of always-`StringValue` |
| Future M7 automation triggers/conditions | automation (M7, not built) | would re-parse/re-guess types from String old/new (latent bug REC-91 names) | the payoff — typed old/new removes the re-parse; enumerate so the M7 contract is designed against typed from day one |

**Status: FRAMED — inventory complete; per-consumer migration is AMD-52 authoring work (gate criterion G4).**

---

## 7. Coherence check against AMD-51 §2.7 and the §2.6 erratum (mandatory)

This beat must not contradict the ratified AMD-51 surface. Two explicit checks:

- **AMD-51 §2.7 (String payload preserved).** Honored — the String payload stays frozen *until AMD-52 ratifies* (§8 guardrail). This beat only scopes the eventual swap; it changes nothing now.
- **AMD-51 §1.2 / §2.6 erratum (the String/transient-typed boundary; prior is always `StringValue`).** AMD-52 is the amendment that **ends** the "materialized prior is always `StringValue`" invariant (AMD-51-INV-05's load-bearing fact). This is coherent, not contradictory, but it must be **stated** in AMD-52: once `applyToState` writes typed, the AMD-51 comparator's symmetric reconstruction (§2.6) is reconstructing a prior that may already be the schema-typed variant rather than a `StringValue`. The comparator is **total over the typed hierarchy** (AMD-51-INV-01, exhaustive no-`default` switch) and the reconstruction step is idempotent on an already-typed value, so the change is benign — but AMD-52 must re-verify the §2.6 reconstruction path and the §2.6-erratum no-schema `StringValue` fallback both still behave when the prior is natively typed. **Framed as an AMD-52 authoring obligation, not a fork.** No AMD-51 invariant is reopened by this beat.

---

## 8. Source anchors + verbatim embeds (confirm against source before AMD-52 authoring — STOP-on-Mismatch)

Verified against `homesynapse-core` HEAD `98f705b` via the **Read tool on the working tree** (in-sandbox `git`/`grep` distrusted — it line-ending-churns this synced folder, the standing M4.0a/M4.B3 lesson). A fabrication would diff visibly against these embeds (the Research 6 lesson).

### 8.1 Verbatim `module-info.java` — three modules (embed)

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

// core/persistence/src/main/java/module-info.java  (Jackson lives ONLY here)
module com.homesynapse.persistence {
    requires transitive com.homesynapse.platform;
    requires transitive com.homesynapse.state;
    requires transitive com.homesynapse.event;
    requires transitive com.homesynapse.event.bus;

    requires java.sql;
    requires org.slf4j;

    // M2.4: Jackson serialization infrastructure for DomainEvent payload
    // encode/decode in the SQLite event store BLOB column (DECIDE-M2-04).
    requires com.fasterxml.jackson.core;
    requires com.fasterxml.jackson.databind;
    requires com.fasterxml.jackson.datatype.jsr310;
    requires com.fasterxml.jackson.module.blackbird;

    exports com.homesynapse.persistence;
}
```

JPMS module names are `com.homesynapse.event`, `com.homesynapse.device`, `com.homesynapse.persistence` (flat-package-per-module; **not** `…event.model` / `…device.model`). `core/state-store` is `com.homesynapse.state`. **The persistence module is the only one that `requires` Jackson** — the codec must live here (§2.1). AMD-52 likely requires **no new `requires`** if it reuses the existing `jackson-databind`/`jsr310`/`blackbird` set; confirm at authoring whether a custom `AttributeValue` (de)serializer needs any additional Jackson artifact (it should not — `JsonSerializer`/`JsonDeserializer` are in `jackson-databind`, already required).

### 8.2 Verbatim `events` row shape + per-event version column (V001, embed)

```sql
CREATE TABLE IF NOT EXISTS events (
    global_position   INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id          BLOB(16) NOT NULL,
    home_id           BLOB(16) NOT NULL,
    event_type        TEXT     NOT NULL,
    schema_version    INTEGER  NOT NULL DEFAULT 1,   -- per-event version seam (AMD-52 string↔typed discriminator)
    ...
    payload           BLOB     NOT NULL,             -- typed payload lands HERE, no row change
    chain_hash        BLOB(32) NOT NULL DEFAULT x'00...00',
    UNIQUE(subject_ref, subject_sequence)
);
-- View checkpoints (Doc 04 §3.12): data BLOB carries the CheckpointSerializer snapshot
CREATE TABLE IF NOT EXISTS view_checkpoints (
    view_name   TEXT    PRIMARY KEY,
    position    INTEGER NOT NULL,
    data        BLOB    NOT NULL,                    -- typed attribute envelope lands HERE, no row change
    updated_at  INTEGER NOT NULL
);
```

### 8.3 Verbatim `StateChangedEvent` (the type AMD-52 changes) + `AttributeValue` head (embed)

```java
@EventType(EventTypes.STATE_CHANGED)
public record StateChangedEvent(
        String attributeKey,
        String oldValue,        // AMD-52: → AttributeValue
        String newValue,        // AMD-52: → AttributeValue
        EventId triggeredBy
) implements DomainEvent { /* compact ctor: all non-null */ }

public sealed interface AttributeValue
        permits BooleanValue, IntValue, FloatValue, StringValue, EnumValue,
                QuantityValue, ArrayValue, DegradedAttributeValue {
    Object rawValue();              // never null
    AttributeType attributeType();  // never null — the 8-value discriminator the codec keys on
}
```

Variant shapes (source-verified, HEAD `98f705b`): `BooleanValue(boolean)`, `IntValue(long)`, `FloatValue(double)` — **can carry `NaN`/`±Inf`, no ctor guard**, `StringValue(String)` non-null, `EnumValue(String)` non-null, `QuantityValue(double value, String unit)` — canonicalized at construction, rejects non-finite, `ArrayValue(List<AttributeValue>)` — `List.copyOf`, ordered, `DegradedAttributeValue(String originalTypeName, String rawForm, String failureReason)`.

### 8.4 Verbatim Jackson version-catalogue rows (LTD-08 lock, embed)

```toml
# gradle/libs.versions.toml
jackson                   = "2.18.6"
jackson-core              = { module = "com.fasterxml.jackson.core:jackson-core", version.ref = "jackson" }
jackson-databind          = { module = "com.fasterxml.jackson.core:jackson-databind", version.ref = "jackson" }
jackson-annotations       = { module = "com.fasterxml.jackson.core:jackson-annotations", version.ref = "jackson" }
jackson-datatype-jsr310   = { module = "com.fasterxml.jackson.datatype:jackson-datatype-jsr310", version.ref = "jackson" }
jackson-module-blackbird  = { module = "com.fasterxml.jackson.module:jackson-module-blackbird", version.ref = "jackson" }
```

`PersistenceObjectMapper.create()` config is locked (LTD-08 / DECIDE-M2-04, validated by the pre-M2.4 Jackson research): `SNAKE_CASE`, `Include.NON_NULL`, `FAIL_ON_UNKNOWN_PROPERTIES` disabled (forward-compat INV-ES-07), `WRITE_DATES_AS_TIMESTAMPS` disabled, `INDENT_OUTPUT` disabled, `BlackbirdModule`, concurrent-deque recycler. AMD-52's `AttributeValue` codec must compose with this configuration — note `NON_NULL` interacts with the envelope shape (§2.2a) and the float/NaN encoding (§2.2c).

### 8.5 Other anchors AMD-52 authoring must confirm

- `EventPayloadCodec.encode(DomainEvent) → byte[]` / `decode(String eventType, int schemaVersion, byte[]) → DomainEvent` — the sole S1 boundary; `decode` already threads `schemaVersion`; parse-failure → `DegradedEvent` (the Path-B residual, §4).
- `CheckpointSerializer.toSerializable/fromSerializable` — the S2 `Map<String,String>` flatten + `new StringValue(v)` rebuild; the Javadoc's "typed envelope per entry" extension note.
- `AttributeValueUpcaster.upcast(String storedTypeName, String rawForm, int fromSchemaVersion)` — the value-layer migration SPI (no `ServiceLoader`, DECIDE-04); AMD-51 left it unchanged; AMD-52 is where its decode-path role (§4.1 Path B) is decided.
- ArchUnit Rule 7 `NO_JSON_TYPE_INFO_IN_EVENTS` + the Jackson-isolation HARD RULE — the constraints behind §2.1.
- AMD-50 §2.1–§2.5 (frozen backfill/supersession) and AMD-51 §2.6/§2.7 + §2.6 erratum — the rails AMD-52 rides and must stay coherent with.

---

## 9. Go / No-Go gate — criteria for authoring AMD-52

AMD-52 authoring is **GO** only when all of G1–G4 are settled (research-informed + Nick-adjudicated). This beat **closes G5** and frames G1–G4.

| Gate | Criterion | Status after this beat |
|---|---|---|
| **G1 — serializer** | The `AttributeValue` Jackson codec is settled: custom (de)serializer in `core/persistence`, **no `@JsonTypeInfo`**, explicit `AttributeType` discriminator, total over 8 permits; **deterministic `double` rendering** pinned (§2.2b); **`NaN`/`±Inf`/`−0.0` lossless JSON encoding** defined (§2.2c); envelope shape chosen (§2.2a). | **OPEN** — mechanism DECIDED (§2.1); wire-form forks dispatched to Research 11 (§10). |
| **G2 — replay determinism** | The contract is settled: Path A (re-derivation from `state_reported`, rides AMD-50/AMD-51 unchanged) is authoritative; Path-B decode-of-historical-String behavior decided (version-branched lift vs accepted `DegradedEvent`); **per-lift bit-determinism** proof obligation accepted (extend AMD-51 §5 #5b to every String→typed lift); no lossy/in-place-mutation upcast. | **OPEN** — Path A DECIDED-by-precedent; Path B + bit-determinism dispatched to Research 11 (§10). |
| **G3 — checkpoint (S2)** | The `CheckpointSerializer` typed-envelope extension is specified (same `view_checkpoints.data` BLOB; deterministic; `ALWAYS`-inclusion preserved; deserialize-failure lands on AMD-50 reconciliation). | **OPEN (narrow)** — shape DECIDED (no migration, §3); exact envelope shared with G1. |
| **G4 — consumer blast radius** | Every reader of `StateChangedEvent.oldValue/newValue` and the materialized `attributes` (§6) has a specified, benign migration — incl. `shouldPublishDerived` coherence on the typed materialized value and the AMD-51-INV-05 / §2.6-erratum re-verification (§7). | **OPEN** — inventory FRAMED (§6/§7); per-consumer spec is authoring work. |
| **G5 — event-store/row shape** | Confirmed: **no `events`-table and no `view_checkpoints` row migration**; typed payload stays in-BLOB; per-event `schema_version` is the string↔typed discriminator. | **DECIDED — CLOSED by this beat** (§3). |

**NO-GO** while any of G1–G4 is OPEN. Today G1 and G2 are the substantive blockers (G3/G4 are framed and become authoring work once G1/G2 land). **The path to GO:** Research 11 (Deliverable 2) returns → PM assessment (6-step A–F, source-verified) → Nick adjudicates the §10 forks + the §2.2/§4 calls → author AMD-52 → its own M4.0b-x coding instruction reusing AMD-50's backfill for 3→4. Until then, the String `StateChangedEvent` payload is frozen (AMD-51 §2.7, §8 guardrail).

---

## 10. Forks handed to the deep-research brief (Research 11) — scope discipline

The research brief (Deliverable 2) is scoped to **only** the genuine forks this beat surfaced — it must not invent problems already DECIDED here (the discriminator mechanism §2.1, the no-row-migration finding §3, the staging §5). The forks to research, mapped to mature event-sourced prior art:

1. **Polymorphic/sum-type payload serialization for durability** — envelope shape + explicit-discriminator encoding for an 8-variant sealed type *without* framework reflection (§2.2a). Prior art: Axon `@Revision` serializers (canonical), Akka Persistence serializers, Kafka Schema Registry Avro/Protobuf **union** types, EventStoreDB.
2. **Deterministic value encoding** — canonical `double`→text and the `NaN`/`±Inf`/`−0.0` JSON-valid lossless encoding (§2.2b/c). How do durable event stores pin floating-point byte-stability?
3. **Payload schema versioning without breaking replay** — the per-event `schema_version` upcaster seam (§3/§4); how Axon's upcaster chain + `@Revision` migrate old payloads forward at read time deterministically.
4. **Deterministic replay across schema versions** — Path A vs Path B (§4); re-derive-from-source vs lift-old-payload; the bit-determinism proof obligation.
5. **Inline-blob vs normalized-column storage tradeoffs on constrained hardware** — confirm the inline-BLOB choice (§3) against Pi-class / 256 MiB-heap constraints (BLOB size, GC pressure, the `Include.NON_NULL` compactness posture).
6. **Explicit anti-patterns to avoid** — in-place event mutation, lossy upcasts, serializer nondeterminism (map ordering — already cleared §2.1; float render; reflection-driven type tags).

The brief embeds the verbatim `module-info.java` (§8.1), the `libs.versions.toml` Jackson rows (§8.4, LTD-08), and the locked constraints (no `ServiceLoader`; D-01; AMD-50 frozen; AMD-51 §2.7 + §2.6 erratum; the `@JsonTypeInfo` ban) as CONSTRAINTS so the researcher cannot fabricate names/versions (the Research 6 lesson).

---

## 11. Bottom line

OQ-05-08 is **closed by this beat as a scoping question.** Two of the four sub-questions are **DECIDED** (event-store row shape: no migration, typed payload in-BLOB on both surfaces, per-event `schema_version` is the discriminator — §3/§5; staging: AMD-52 is a separate `projectionVersion` 3→4 bump riding AMD-50 unchanged — §5). The other two are **FRAMED with their mechanism decided and their genuine forks isolated** (the Jackson codec mechanism is fixed — custom persistence (de)serializer, no `@JsonTypeInfo` — but the wire-form/float/NaN encoding is OPEN §2; the replay contract's Path A is authoritative-by-precedent but Path B + per-lift bit-determinism is OPEN §4). The riskiest sub-problem the design-track map §3 flagged — the serializer/replay blast radius — is now bounded to a small, named set of forks (§10). **AMD-52 authoring stays GATED (§9, G1/G2 OPEN); the String `StateChangedEvent` payload stays frozen; the next step is the Research 11 brief, not the amendment.**
