# Research 11 — Typed Event Payload Persistence: Polymorphic Serialization, Schema Versioning, and Replay-Deterministic Upcasting

## §1 Executive Summary

HomeSynapse is adding a sealed 8-variant `AttributeValue` sum type to `StateChangedEvent`, a change that simultaneously touches the serializer (Fork 1), determinism (Fork 2), versioning (Fork 3), replay (Fork 4), storage layout (Fork 5), and the anti-pattern surface (Fork 6). The strong consensus across mature event-sourced systems (Akka Persistence, Axon, Kafka Schema Registry/Avro/Protobuf, EventStoreDB/Kurrent, Marten) is that HomeSynapse's instincts are correct and align with industry practice. The recommended path:

1. **Tagged-union envelope (Fork 1):** Use a compact, explicit string-discriminator envelope — `{"t":"FLOAT","v":…}` — exactly mirroring Akka's `SerializerWithStringManifest` (a string manifest beside the bytes) and Avro's JSON union encoding (a single-key object keyed by type name). This is fully compatible with the `@JsonTypeInfo` ban, since the discriminator is an explicit data field written by a hand-rolled `StdSerializer`, not reflective type metadata.

2. **Determinism keystone (Fork 2):** This is the single highest-risk fork. `Double.toString` changed output between JDK 18 and JDK 19 (Schubfach) — Oracle's own heads-up states "passing 1e23 to this method in JDK 19 will return '1.0E23' instead of '9.999999999999999E22' in earlier JDK releases" — so float text rendering is **not** stable across JVM upgrades. Standard JSON has no NaN/Infinity, and `FloatValue` admits them. HomeSynapse must (a) pin a canonical float-rendering routine and (b) encode non-finite values as explicit sentinel strings, never as bare `NaN`/`Infinity` tokens.

3. **Versioning & replay (Forks 3–4):** Wire the `AttributeValueUpcaster` into the decode path as a version-branched lift (REC-104), eliminating the lossy `DegradedEvent` for legacy `schema_version=1` rows. This is precisely Axon's "payload conversion at handling time" model, distinct from rebuilding projections.

4. **Storage (Fork 5):** The decided inline-BLOB design is **confirmed correct** for Pi-class hardware; SQLite's own benchmark shows it "reads and writes small blobs (for example, thumbnail images) 35% faster than the same blobs can be read from or written to individual files," and the "opaque blob + indexed metadata columns" pattern is the event-sourcing consensus.

5. **Anti-patterns (Fork 6):** The dominant documented failure modes — event-log mutation, lossy upcasts, and serializer nondeterminism (float rendering, reflective tags, locale formatting) — are all avoidable within HomeSynapse's locked constraints, and we provide a gating checklist.

The decision-maker should scope the line at: **REC-100 (envelope) + REC-101/102 (float + IEEE edges) + REC-104 (version-branched decode) are must-do**; REC-103 (confirm inline BLOB) is a low-cost validation; REC-105 (anti-pattern gate) is a process artifact.

## §2 Platform / Literature Deep Dives (organized by Fork)

### Fork 1 — Polymorphic / sum-type payload serialization

**Akka Persistence `SerializerWithStringManifest`** is the closest philosophical match to HomeSynapse. Akka's documentation states the manifest "is a String instead of a Class. That means that the class can be moved/removed and the serializer can still deserialize old data by matching on the String," and crucially "the manifest string can also encode a version number that can be used in fromBinary to deserialize in different ways to migrate old data to new domain objects." A serialized Akka record "consists of serializer-id, the manifest, and the binary payload"; the manifest is the explicit discriminator beside the bytes — exactly HomeSynapse's `event_type`/`AttributeType` philosophy. Akka's example serializers do explicit `switch`/match on the manifest string (`CUSTOMER_MANIFEST`, `USER_MANIFEST`) with no reflection.

**Avro unions** give the canonical sum-type-on-the-wire encoding. In binary, a union value is prefixed by the zero-based branch index encoded as a varint ("the index of 'string' in the union, encoded as hex 02"). In JSON, the Avro spec says a non-null union value "is encoded as a JSON object with one name/value pair whose name is the type's name and whose value is the recursively encoded value" — i.e. `{"TypeName": value}`. This is a single-key tagged object, structurally identical to HomeSynapse's proposed `{"t":…,"v":…}` (HomeSynapse just names the discriminator and value fields explicitly rather than using the type name as the key).

**Protobuf `oneof`** encodes each member as an ordinary tagged field: "Oneof fields are encoded the same as if the fields were not in a oneof," where every record is a Tag-Length-Value triple with the tag = `(field_number << 3) | wire_type`. The discriminator is the field number, an explicit integer on the wire. Both Avro branch-index and Protobuf field-number are explicit, non-reflective discriminators — validating HomeSynapse's `attributeType()` enum approach.

**Axon** supports both `XStreamSerializer` (XML, default, flexible) and `JacksonSerializer` (JSON). Axon's docs state Jackson "produces a more compact serialized form… The compact format makes it ideal for events, commands, and queries, as it minimizes the storage space and package size," whereas "for messages (and specifically events) XML might cost too much due to its serialized size." This directly supports HomeSynapse's compactness priority on a 256 MiB heap.

**EventStoreDB/Kurrent** models each event as type + id + data + metadata + content type, where ContentType has variants `Binary` and `Json`, and the event type is "a unique string used to identify the type of event." Kurrent explicitly warns against coupling storage to runtime types: "One might be tempted to use language runtime types for event types… this is not recommended as it couples storage to your types. Instead, you can use a mapping between event types stored in KurrentDB and your concrete runtime types." This validates HomeSynapse's explicit-discriminator-not-class-name stance.

### Fork 2 — Deterministic value encoding (the determinism keystone)

**(a) Float text-rendering stability.** Java's `Double.toString` is **not** byte-stable across JVM versions. JDK-4511638 documented that the old spec was "ambiguous in the case that there is more than one 'shortest' decimal," and the fix (Schubfach algorithm by Raffaello Giulietti, CSR JDK-8202555) changed behavior in **JDK 19**: per Oracle's official Inside.java Quality Outreach heads-up (Sept 23, 2022), "passing 1e23 to this method in JDK 19 will return '1.0E23' instead of '9.999999999999999E22' in earlier JDK releases… Many string representations of doubles and floats have changed to match the specification update." This is logged as a behavioral change (JDK-8291475 release note) and JDK-8291240 shows further differences (e.g. `1.0E-323` vs `9.9E-324`). Real projects were affected — Micrometer issue #3439 tracked exactly this. **Implication:** if HomeSynapse renders floats via `Double.toString` (or Jackson's default, which delegates similarly) and ever computes a hash chain over the rendered text, a future Corretto upgrade across the JDK 18→19 boundary could silently break forensic equality and the reserved `chain_hash`.

The Jackson ecosystem mirrors this: Jackson 2.15+ offers `StreamWriteFeature.USE_FAST_DOUBLE_WRITER` (Schubfach-based). Jackson's maintainer notes that from JDK 17→21 the JDK's own float-to-String writing "MORE THAN DOUBLED" in speed and that "JDK-based serialization is slightly faster than one provided by Jackson," indicating the two paths can produce subtly different rendering decisions across versions. The robust mitigation, repeatedly suggested in the OpenJDK thread, is to anchor identity on a representation that is "almost trivial" and "much less subject to slight errors" — e.g. the hex/bit representation — rather than shortest-decimal text.

**RFC 8785 (JSON Canonicalization Scheme)** is the reference standard for hashable JSON. It pins number serialization to the ECMAScript `Number.prototype.toString` algorithm and lexicographic key sorting to produce "byte-identical output for logically equivalent data." JCS implementers universally report that "Number formatting is the most error-prone part of any JCS implementation," and several (nlohmann/json, Elixir jcs) had to import Ryū/Schubfach-style code to match. RFC 8785 also restricts data to the I-JSON subset, which **excludes NaN/Infinity** entirely.

**(b) NaN / ±Inf / −0.0.** Standard JSON has no representation for these. The consensus across communities is unambiguous: there is "no JSON representation for NaN or Infinity. Use a string or a sentinel number if you need to represent them." Python's `json.dumps` emits bare `Infinity`/`NaN` tokens that then fail `JSON.parse` ("SyntaxError: Unexpected token I") — the exact trap Jackson's `ALLOW_NON_NUMERIC_NUMBERS` falls into, producing non-standard, non-portable output. Binary formats (Avro/Protobuf) sidestep the entire problem: they encode `double` in raw IEEE-754 8-byte form, so NaN/Inf/−0.0 round-trip losslessly with no text rendering and no determinism question. Since HomeSynapse is JSON-confined, it must emulate this with explicit sentinels (e.g. `{"t":"FLOAT","v":"NaN"}`, `"+Inf"`, `"-Inf"`, `"-0.0"`) and a strict decoder.

### Fork 3 — Payload schema versioning without breaking replay

**Axon upcasters + `@Revision`** are THE canonical reference. Axon's docs: "Since the Event Store is considered a read and append-only data source, your application must be able to read all events, regardless of when they were added. This is where upcasting comes in." Upcasters "take one input event of revision x and output zero or more new events of revision x + 1… processed in a chain, meaning that the output of one upcaster is sent to the input of the next." The store "stores a revision number as well as the fully qualified name of the Event," resolved by a `RevisionResolver` (e.g. `AnnotationRevisionResolver` reading `@Revision`). The headline benefit: "upcasting… allows you to do non-destructive refactoring. In other words, the complete event history remains intact." HomeSynapse's `AttributeValueUpcaster` with `canUpcast(storedTypeName, fromSchemaVersion)` is a direct, idiomatic analogue, keyed on `(type, version)` exactly like Axon's `EventTypeUpcaster`. The only deliberate divergence: HomeSynapse uses constructor injection, not a `ServiceLoader` (DECIDE-04) — which is well within the SPI spirit.

**Marten** confirms read-time upcasting on Postgres JSONB: "Upcasting is a process of transforming the old JSON schema into the new one. It's performed on the fly each time the event is read… we can keep only the last version of the event schema in our stream aggregation or projection handling." Marten also stresses immutability: "Events… should be immutable… The best strategy is not to change the past data but compensate."

**Kafka Schema Registry compatibility modes** provide the contract vocabulary for "old reader/new writer." Per Confluent's documentation, "BACKWARD: (default) consumers using the new schema can read data written by producers using the latest registered schema"; FORWARD is the reverse; FULL is both. For an append-only event store that replays history, the relevant mode is **BACKWARD**, and Confluent's rationale maps directly to replay: "The main reason that BACKWARD compatibility mode is the default, and preferred for Kafka, is so that you can rewind consumers to the beginning of the topic. With FORWARD compatibility mode, you aren't guaranteed the ability to read old messages." Rewinding to the beginning of the log *is* replay. HomeSynapse's schema_version=1→typed migration is therefore a backward-compatible read concern.

### Fork 4 — Deterministic replay across schema versions

The literature draws a sharp, explicit line between **upcasting stored events** (read-time deserialization concern) and **rebuilding projections** (re-running handlers over the stream). Axon's 5.x reference calls the former "payload conversion at handling time": "When a handler needs to process an event, Axon converts the payload to the handler's expected type at that moment… For scenarios where payload conversion is not sufficient, Axon will provide upcasters to transform the stored representation of events." The actual upcast "is performed on the serialized event" when "the end result is pulled from" the `IntermediateEventRepresentation`.

By contrast, rebuilding a read model is a `TrackingEventProcessor` reset: per AxonIQ, "A replay means preparing it (such as cleaning out the existing data) and restarting the processor from an earlier position of the event store, processing all historical events since that point to rebuild the projection," with `@ResetHandler` methods to "clear the data in the projection." The API doc for `TrackingEventProcessor.resetTokens` states it "effectively causes a replay." Upcasting *feeds* replay (events are upcast as read), but they are architecturally distinct.

This maps cleanly onto HomeSynapse's two surfaces. **Path A** (re-derive typed state from the immutable `state_reported` log) is the projection-rebuild analogue — authoritative, and it rides AMD-50/AMD-51 unchanged. **Path B** (reading a historical String-payload `state_changed` as a typed event) is the deserialization/upcast surface, where today a lossy `DegradedEvent` results. EventStoreDB/Kurrent's guidance reinforces that re-deriving the read model from the log (rebuilding) and migrating stored events (Copy-and-Replace) are separate techniques; Michiel Rook describes "Copy and Replace," where existing upcasting logic is reused to write a new versioned stream, as an explicit alternative to read-time upcasting.

**Proving the upcaster is pure/total/deterministic.** The proven testing pattern is golden-file/fixture tests over captured event streams. Artium.AI's deep-dive prescribes: "extract a representative sample of event streams from your production database… hardcoded as fixture files within your test suite. By running your projector functions over these fixtures, you can guarantee that the event upcasting and state reconstruction logic continues to work correctly across event versions." The `holixon/axon-testing` library operationalizes exactly this with input/expected-result JSON fixtures (`…AccountCreatedEvent__12.json` → `…__13__result.json`). Axon's own maintainer (Steven van Beelen) describes the round-trip pattern: "grabs a deserialized version of ExampleEvent 1, upcasts it, and asserts it compared to a deserialized version of ExampleEvent 2." Trifork additionally recommends a source-code-consistency unit test that "caught an error… we forgot to change the TypeName in INPUT and OUTPUT constants of an upcaster that was copy-pasted." Combined with AMD-50-INV-03 (no Clock in derivation — replay is a pure function), these patterns give HomeSynapse a concrete verification recipe: a golden corpus of `schema_version=1` payloads with exact expected typed outputs, asserted byte-for-byte.

### Fork 5 — Inline-blob vs normalized-column storage on constrained hardware

The decided inline-BLOB design is **confirmed correct** and pressure-tests well. SQLite's own benchmark ("35% Faster Than The Filesystem") states it "reads and writes small blobs (for example, thumbnail images) 35% faster than the same blobs can be read from or written to individual files on disk using fread() or fwrite()," and "a single SQLite database holding 10-kilobyte blobs uses about 20% less disk space than storing the blobs in individual files." The mechanism is that "the open() and close() system calls are invoked only once" for the DB versus "once for each blob" with individual files; on Windows10 specifically, "content can be read from the SQLite database about 5 times faster than it can be read directly from disk," and reading is broadly "about an order of magnitude faster than writing." For an event store with small JSON payloads, in-database storage avoids per-event syscall overhead entirely. The general event-sourcing consensus, articulated by Ben Morris and others, is: "events are stored as serialized blobs"; "you don't directly query the data in each event. Queries are run by retrieving a stream of events… there is a complete separation between event persistence and the logic used to process data." Metadata (stream id, sequence, type, version) goes in indexed columns; the payload stays an opaque blob — exactly HomeSynapse's shape (BLOB(16) ULID identity + `events.schema_version` column + payload BLOB).

**Marten-on-Postgres JSONB is the deliberate contrast.** Marten leverages Postgres's JSONB binary type for "rich querying and even indexing through JSON documents." HomeSynapse explicitly does **not** have this — and shouldn't want it on a Pi. JSONB-style in-place query/index pays off only at Postgres scale with server-side query needs; on a single-node Pi with a write executor and 2–3 read threads, the indexing/query machinery is pure overhead. Notably, SQLite *does* offer a JSONB blob format (since 3.45.0) that "uses slightly less disk space than text JSON" and skips re-parsing, but SQLite's docs caution to "treat JSONB as an opaque BLOB"; adopting it would be an optional future compaction lever, not a normalization. GC pressure on the 256 MiB heap argues for the compact tagged envelope + `JsonInclude.Include.NON_NULL` rather than any columnar explosion of the 8 variants into wide nullable columns.

### Fork 6 — Explicit anti-patterns to avoid

**Never mutate the event log.** This is the foundational invariant. Kurrent: immutability "describes the practice and policy of not updating, or in any way altering, the event after it has been persisted." Microsoft's Azure guidance lists "In-place migration: Rewrite historical events… directly in the event store. This approach breaks immutability and should be a last resort because it undermines the audit trail." HomeSynapse's append-only, never-mutate stance is correct; upcasting at read time is the sanctioned alternative.

**Lossy upcasts.** Microsoft warns that bad events persist: "if a bug produces incorrect events, those events persist in the store. Fixing the bug in application code doesn't fix the historical events." A lossy upcast silently drops data during migration — the very risk in HomeSynapse's current `DegradedEvent` fallback for Path B. The mitigation is a total, information-preserving upcast (REC-104) plus golden-file tests asserting no field is dropped.

**Serializer nondeterminism.** Three documented sub-classes, all directly relevant:
- *Float/locale formatting:* covered in Fork 2 (Schubfach JDK-19 break). Locale-dependent formatting (e.g. decimal comma) is a classic trap; the fix is locale-independent rendering.
- *Reflective/field ordering & map ordering:* `auth0/node-jsonwebtoken` #404 — "The output order of JSON.stringify is not guaranteed… The former would create a different MAC than the latter" — a serializer-ordering bug that broke signature verification. `gltf-rs` #336 documented nondeterministic map attribute ordering from hash-function seeding. HomeSynapse has already cleared map-ordering (no Map inside any `AttributeValue`; `ArrayValue` is an ordered List), so the residual risk is field ordering within the envelope — controlled by writing fields in a fixed order in the hand-rolled serializer.
- *Reflective type tags:* the `@JsonTypeInfo` ban (ArchUnit Rule 7) preempts the reflective-polymorphism instability class entirely.

## §3 Cross-Cutting Analysis (concept-mapping tables)

**Table A — Tagged-union envelope, prior art → HomeSynapse**

| System | Discriminator carrier | Shape | Reflection? | HomeSynapse mapping |
|---|---|---|---|---|
| Akka `SerializerWithStringManifest` | String manifest beside bytes | `(serializer-id, manifest, payload)` | No (switch on string) | `AttributeType` enum as `"t"` field |
| Avro union (JSON) | Type name as object key | `{"TypeName": value}` | No (schema-driven) | `{"t":"FLOAT","v":…}` |
| Avro union (binary) | Branch index varint | `02 <value>` | No | n/a (JSON-confined) |
| Protobuf `oneof` | Field number in tag | TLV, `(field<<3)|wire` | No | n/a (JSON-confined) |
| Axon Jackson | `@Revision` + FQCN | compact JSON | Avoidable | explicit serializer in persistence module |
| **HomeSynapse (recommended)** | **`AttributeType` enum string** | **`{"t":"FLOAT","v":…}`** | **No (exhaustive switch)** | **— REC-100** |

**Table B — Float / IEEE-754 edge encoding**

| Concern | Avro/Protobuf (binary) | JSON default (Jackson) | RFC 8785 JCS | HomeSynapse recommendation |
|---|---|---|---|---|
| Finite double text-stability | N/A (raw 8 bytes) | `Double.toString`, JDK-19 unstable | ECMAScript NumberToString, pinned | Pin canonical renderer; consider bit/hex anchor for hash |
| NaN | raw bits | bare `NaN` (ALLOW_NON_NUMERIC) → invalid JSON | prohibited (I-JSON) | sentinel string `"NaN"` |
| +Inf / −Inf | raw bits | bare `Infinity` → invalid JSON | prohibited | `"+Inf"` / `"-Inf"` |
| −0.0 | raw bits | may render `-0.0` or `0` | edge case | explicit `"-0.0"` sentinel |
| Cross-JVM stability | guaranteed | NOT guaranteed | guaranteed by spec | must enforce — REC-101/102 |

**Table C — Versioning / replay vocabulary**

| Concept | Axon term | Kafka SR term | HomeSynapse construct |
|---|---|---|---|
| Read-time transform of stored event | Upcaster / "payload conversion at handling time" | (consumer schema resolution) | `AttributeValueUpcaster.upcast` |
| Rebuild read model from log | TrackingEventProcessor reset / replay | (rewind to beginning) | Path A re-derivation (AMD-50) |
| Old-reader-reads-new-writer contract | revision chain | BACKWARD compatibility | schema_version branch |
| Append-only, never mutate | non-destructive refactoring | immutable log | append-only events table |
| Store-rewrite alternative | Copy-and-Replace | (re-keyed topic) | NOT chosen (would touch frozen AMD-50) |

**Table D — Storage layout**

| Approach | Example | Query model | Fit for Pi/256 MiB | HomeSynapse |
|---|---|---|---|---|
| Opaque blob + indexed metadata | EventStoreDB, Greg Young ES, Axon JDBC | replay-only | Excellent | **Chosen (confirmed)** |
| JSONB document w/ indexing | Marten/Postgres | rich server-side query | Overkill on Pi | Deliberately NOT used |
| Normalized columns per variant | (relational) | SQL per field | Wide-nullable, GC churn | Rejected |
| In-DB BLOB vs external file | SQLite fasterthanfs | n/a | In-DB faster <100 KiB | Inline BLOB |

## §4 Amendment Recommendations (ranked by impact × confidence / cost)

**REC-100 — Adopt the compact tagged-union envelope `{"t":<AttributeType>,"v":<value>}` (Fork 1).**
*Impact: High · Confidence: High · Cost: Low.* Write one hand-rolled `StdSerializer`/`StdDeserializer` pair in `com.homesynapse.persistence` that emits `"t"` from `attributeType()` and dispatches via exhaustive `switch` over the sealed type (permitted; D-01 is event-type-scoped). For `ArrayValue`, recurse the same envelope per element (ordered List preserved). Use `JsonInclude.Include.NON_NULL`. Real-world anchor: Akka's string-manifest model and Avro's single-key JSON union both prove the explicit-string-discriminator pattern at scale, without reflection. Satisfies the `@JsonTypeInfo` ban because `"t"` is plain serialized data, not Jackson type metadata.

**REC-101 — Pin a canonical, locale-independent float renderer and anchor hashes on a stable form (Fork 2).**
*Impact: High · Confidence: High · Cost: Medium.* Because `Double.toString` changed at JDK 18→19 (Schubfach, JDK-8202555/JDK-8291475 — "passing 1e23… will return '1.0E23' instead of '9.999999999999999E22'"), do not let shortest-decimal text be the hashed identity. Two options: (a) render finite floats with a fixed, version-stable routine and freeze it behind a golden test corpus; or (b) for `chain_hash`/idempotency, hash the IEEE-754 bit pattern (`Double.doubleToLongBits`, with `−0.0` and NaN canonicalization choices made explicit) rather than text — the OpenJDK reviewers explicitly recommend the hex/bit form as "much less subject to slight errors." Anchor: Micrometer #3439 and JDK-8291240 are real breakages of float-text stability across JVM upgrades. This is the determinism keystone — the highest-impact REC.

**REC-102 — Encode non-finite `FloatValue` as explicit sentinel strings; ban `ALLOW_NON_NUMERIC_NUMBERS` on the wire (Fork 2).**
*Impact: High · Confidence: High · Cost: Low.* Standard JSON cannot represent NaN/±Inf; the cross-language consensus is to use sentinel strings. Encode `NaN`→`"NaN"`, `+Inf`→`"+Inf"`, `−Inf`→`"-Inf"`, and `−0.0`→`"-0.0"` inside the `"v"` field, with a strict decoder that rejects unknown tokens. Never emit bare `NaN`/`Infinity` (Jackson's `ALLOW_NON_NUMERIC_NUMBERS`) — Python's `json.dumps` produces exactly this and the output fails standard parsers ("Unexpected token I"). Note the asymmetry already in the design: `QuantityValue` rejects non-finite at construction but `FloatValue` does not, so only `FloatValue` needs the sentinel path. Document that this is HomeSynapse's I-JSON-style restriction.

**REC-104 — Wire `AttributeValueUpcaster` into the Path B decode path as a version-branched lift; retire `DegradedEvent` for legacy rows (Fork 4).**
*Impact: High · Confidence: High · Cost: Medium.* AMD-52 should make reading a `schema_version=1` String-payload `state_changed` event invoke `canUpcast("state_changed", 1)` → `upcast(...)` to produce a real typed `AttributeValue` (e.g. `StringValue`, or a best-effort typed lift), rather than emitting a lossy `DegradedEvent`. This is Axon's "payload conversion at handling time," distinct from Path A re-derivation. Keep `upcastLenient(...)` as the fallback only for genuinely unparseable rows. Anchor: Microsoft's Azure guidance and Marten both endorse read-time upcasting as the immutability-preserving alternative to mutation; the lossy-upcast risk is the documented failure mode this REC closes. Verify with golden-file fixtures (Artium.AI / holixon pattern) asserting exact typed output for a corpus of real v1 payloads.

**REC-103 — Confirm inline-BLOB with a constrained-hardware micro-benchmark; defer normalization permanently (Fork 5).**
*Impact: Medium · Confidence: High · Cost: Low.* The inline-BLOB decision is correct; this REC is a cheap validation, not a change. Run a Pi-class benchmark of append + full-stream replay at representative payload sizes; SQLite's own data predicts in-DB BLOBs are ~35% faster than external files for small blobs (and ~5× faster reads on Windows10), use ~20% less disk, and that reads are ~10× writes. Record GC behavior under the 256 MiB heap with the compact envelope. Explicitly document that Marten/Postgres-JSONB-style indexed querying is **out of scope** (no server-side payload query need on a single node). Optionally note SQLite 3.45 JSONB as a future opaque-compaction lever only.

**REC-105 — Adopt the AMD-52 anti-pattern gating checklist (Fork 6).**
*Impact: Medium · Confidence: High · Cost: Low.* A required review gate for the AMD-52 author and coder:
1. ☐ No `UPDATE`/`DELETE` on the events table (append-only; never mutate).
2. ☐ Every upcast is total and information-preserving (no silent field drop); golden-file test proves exact output.
3. ☐ Envelope fields written in fixed order; no Map anywhere in `AttributeValue` (already cleared).
4. ☐ Float rendering locale-independent and version-pinned; hash anchored per REC-101.
5. ☐ Non-finite floats use sentinels; `ALLOW_NON_NUMERIC_NUMBERS` disabled.
6. ☐ No `@JsonTypeInfo`/reflective polymorphism (ArchUnit Rule 7).
7. ☐ Upcaster is a pure function (no Clock, AMD-50-INV-03; constructor-injected, no ServiceLoader).
Anchors: node-jsonwebtoken #404 (ordering broke a MAC), gltf-rs #336 (map-order nondeterminism), Kurrent immutability guidance.

## §5 Caveats / Open Questions

1. **No locked decision may be violated.** No REC above proposes a new backfill (AMD-50 frozen), a new Jackson artifact (2.18.6 locked), `@JsonTypeInfo`, a `ServiceLoader`, a `Clock` in derivation, or Jackson annotations on event types. If REC-101's hash-anchoring requires touching the reserved `chain_hash` derivation, that must be raised as a design question, not silently implemented — flagging here per instructions.
2. **Float canonicalization vs. round-trip fidelity.** Anchoring the hash on IEEE-754 bits (REC-101 option b) decouples hash stability from text rendering, but the *stored* `"v"` text is still produced by some renderer. If forensic equality is defined over stored text rather than over the decoded double, the renderer itself must be frozen. The team must decide whether identity is defined over (a) the decoded `double` value, or (b) the exact stored bytes. This choice is not yet specified in the brief.
3. **NaN bit-pattern canonicalization.** IEEE-754 has many NaN bit patterns (signaling/quiet, payload bits). If `FloatValue` could ever carry a non-canonical NaN, a single `"NaN"` sentinel collapses them — acceptable for most smart-home use but lossy in the strict bit sense. Confirm this is acceptable.
4. **−0.0 semantics.** Whether HomeSynapse must distinguish `−0.0` from `+0.0` is a domain question; the sentinel approach (REC-102) preserves it, but only if the decoder and any equality logic honor it.
5. **Subagent gap acknowledged:** no single vendor doc presents a formal property-based (QuickCheck/Hypothesis-style) upcaster test guide; the proven patterns found are golden-file/round-trip/snapshot, which are sufficient but worth supplementing with property tests if budget allows.
6. **JCS adoption is NOT recommended wholesale.** RFC 8785 is the right *reference* for number/ordering discipline, but full JCS (UTF-16 key sorting, ECMAScript number formatting) is heavier than needed given map-ordering is already cleared and the envelope has fixed fields. Borrow its principles, not its full machinery — and note no new Jackson artifact is permitted regardless.

## §6 Sources

1. Axon Event Versioning (upcasters, @Revision, RevisionResolver) — https://docs.axoniq.io/axon-framework-reference/4.11/events/event-versioning/
2. Axon reference-guide event-versioning (GitHub mirror) — https://github.com/AxonIQ/reference-guide/blob/master/axon-framework/events/event-versioning.md
3. Axon EventTypeUpcaster Javadoc — https://apidocs.axoniq.io/latest/org/axonframework/serialization/upcasting/event/EventTypeUpcaster.html
4. Axon Upcaster interface Javadoc — https://apidocs.axoniq.io/3.0/org/axonframework/serialization/upcasting/Upcaster.html
5. Axon Serialization (XStream vs Jackson) — https://docs.axoniq.io/axon-framework-reference/4.10/serialization/
6. Axon 5.1 Event Versioning (payload conversion at handling time) — https://docs.axoniq.io/axon-framework-reference/5.1/events/event-versioning/
7. Axon Streaming Event Processor (replay/reset) — https://docs.axoniq.io/axon-framework-reference/4.11/events/event-processors/streaming/
8. AxonIQ blog — replay context propagation (rebuild projection) — https://www.axoniq.io/blog/axon-framework-4-6-0-replay-context-propagation
9. AxonIQ — Demystifying Tracking Event Processors — https://developer.axoniq.io/w/demystifying-tracking-event-processors-in-axon-framework
10. Akka SerializerWithStringManifest API — https://doc.akka.io/japi/akka-core/current//akka/serialization/SerializerWithStringManifest.html
11. Akka Serialization docs (manifest, rolling upgrades) — https://doc.akka.io/docs/akka/2.5.21//serialization.html
12. Apache Avro 1.11.1 Specification (unions, JSON encoding) — https://avro.apache.org/docs/1.11.1/specification/
13. Protobuf Encoding (oneof, TLV, wire types) — https://protobuf.dev/programming-guides/encoding/
14. Protobuf proto3 Language Guide (oneof) — https://protobuf.dev/programming-guides/proto3/
15. RFC 8785 JSON Canonicalization Scheme — https://www.rfc-editor.org/info/rfc8785/
16. RFC 8785 datatracker (number serialization, I-JSON) — https://datatracker.ietf.org/doc/html/rfc8785
17. Confluent Schema Registry compatibility types — https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html
18. Confluent — Schema Compatibility (event-stream patterns) — https://developer.confluent.io/patterns/event-stream/schema-compatibility/
19. Inside.java — JDK 19 Double.toString/Float.toString change — https://inside.java/2022/09/23/quality-heads-up/
20. JDK-4511638 Double.toString incorrect results — https://bugs.openjdk.org/browse/JDK-4511638
21. JDK-8202555 Double.toString CSR (Schubfach, unique rendering) — https://bugs.openjdk.org/browse/JDK-8202555
22. JDK-8291240 JDK 19/20 double precision change — https://bugs.openjdk.org/browse/JDK-8291240
23. OpenJDK PR #3402 Schubfach adoption (hex anchor recommendation) — https://github.com/openjdk/jdk/pull/3402
24. Micrometer #3439 — investigate Double.toString JDK 19 effect — https://github.com/micrometer-metrics/micrometer/issues/3439
25. Jackson 2.15 release (USE_FAST_DOUBLE_WRITER, Schubfach) — https://github.com/FasterXML/jackson/wiki/Jackson-Release-2.15
26. Jackson 2.18 fast vector reads/writes (JDK 17→21 float speed) — https://cowtowncoder.medium.com/jackson-2-18-fast-vector-reads-writes-6c2cf99c4594
27. EventStoreDB/Kurrent basic data types (event type, ContentType) — https://ahjohannessen.github.io/sec/docs/types/
28. Kurrent — Event immutability and dealing with change — https://www.kurrent.io/blog/event-immutability-and-dealing-with-change/
29. Microsoft Azure — Event Sourcing pattern (upcasting, in-place migration warning) — https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing
30. Marten — Events Versioning (read-time upcasting, immutability) — https://martendb.io/events/versioning.html
31. SQLite — 35% Faster Than The Filesystem (in-DB BLOB perf) — https://sqlite.org/fasterthanfs.html
32. SQLite — JSON/JSONB functions (opaque BLOB guidance) — https://sqlite.org/json1.html
33. Ben Morris — Designing an event store for scalable event sourcing (blob + metadata) — https://www.ben-morris.com/designing-an-event-store-for-scalable-event-sourcing/
34. auth0/node-jsonwebtoken #404 — JSON.stringify order breaks MAC — https://github.com/auth0/node-jsonwebtoken/issues/404
35. gltf-rs #336 — nondeterministic map attribute ordering — https://github.com/gltf-rs/gltf/issues/336
36. getsentry/sentry #1979 — Infinity/NaN produce invalid JSON — https://github.com/getsentry/sentry/issues/1979
37. Artium.AI — Event Sourcing upcasting deep dive (fixture testing) — https://artium.ai/insights/event-sourcing-what-is-upcasting-a-deep-dive
38. holixon/axon-testing — upcaster JUnit5 fixture tests — https://github.com/holixon/axon-testing
39. Michiel Rook — Upcasters vs versioned event store (Copy-and-Replace) — https://www.michielrook.nl/2017/11/upcasters-versioned-event-store-pros-cons/
40. Trifork — Unit testing Axon upcaster consistency — https://trifork.nl/blog/unit-testing-source-code-verifying-axon-event-upcaster-consistency/

## §7 Code-Level Implications

Mapping each REC onto HomeSynapse's specific types and boundaries:

- **REC-100 (envelope):** A single `AttributeValueSerializer extends StdSerializer<AttributeValue>` and `AttributeValueDeserializer extends StdDeserializer<AttributeValue>`, both confined to `com.homesynapse.persistence` (Jackson module boundary). The serializer's `serialize` does an exhaustive `switch` over the sealed `AttributeValue` (BooleanValue, IntValue, FloatValue, StringValue, EnumValue, QuantityValue, ArrayValue, DegradedAttributeValue), writing `gen.writeStringField("t", value.attributeType().name())` then the variant-specific `"v"`. `ArrayValue` recurses via `gen.writeArrayFieldStart("v")` + per-element serialize. No Jackson annotations leak onto event/device types (constraint honored). Registered via a `SimpleModule` on the single confined `ObjectMapper`.

- **REC-101/102 (float + IEEE edges):** Lives entirely inside the `FloatValue` arm of REC-100's `switch`. A package-private `static String renderFloat(double)` / `static double parseFloat(String)` pair handles finite rendering (pinned) and the four sentinels. The `chain_hash` derivation (reserved) should consume `Double.doubleToLongBits` of the decoded value, not the text — touching this is flagged in §5 as requiring sign-off. `QuantityValue` arm needs no sentinel branch (rejects non-finite at construction).

- **REC-104 (version-branched decode):** The `AttributeValueDeserializer` (or the enclosing `StateChangedEvent` decode path) consults the constructor-injected `AttributeValueUpcaster`. On reading a row, branch on `events.schema_version`: for `1`, call `upcaster.canUpcast("state_changed", 1)` then `upcast(...)`; for current, decode directly. The lossy `DegradedEvent`/`DegradedAttributeValue` becomes the `upcastLenient(...)` fallback only. No `ServiceLoader`; the upcaster is a constructor field. No `Clock` enters this path (pure).

- **REC-103 (inline BLOB):** No type changes — validates the existing payload BLOB column + BLOB(16) ULID identity + `schema_version` column against a Pi benchmark. Confirms the bounded executors (1 write, 2–3 read) and SQLite WAL config are sized for the compact envelope.

- **REC-105 (anti-pattern gate):** Process artifact enforced partly by ArchUnit (Rule 7 already bans `@JsonTypeInfo`); add an ArchUnit/test assertion that no `UPDATE`/`DELETE` SQL targets the events table, and a golden-file `AttributeValueUpcasterTest` proving total, deterministic, information-preserving upcasts over a captured v1 corpus.