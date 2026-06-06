# Research 8: Device Model Implementation — Sealed Hierarchy Expansion and AttributeValue Extensions

*Target: HomeSynapse Core M4. Date: 2026-05-22.*

## 1. Executive Summary [M]

- **EntityCategory should be added to the `Entity` record in the device-model module and propagated to `EntityState` by the projection — NOT carried by a separate `entity_category_set` event.** Home Assistant treats `entity_category` as an immutable registry property of the entity, set at registration time via the `EntityDescription` dataclass, rather than as a state-change event; emitting a discrete `entity_category_set` event would invert the platform's own design. The right move is to extend the existing `entity_registered` event with an optional `category` field and let the projection denormalize it onto `EntityState`.
- **JSR 385 / Indriya should be REJECTED for HomeSynapse's `QuantityValue` payload type; ship a lightweight `QuantityValue(double value, String unitSymbol, QuantityDimension dimension)` record with a sealed `QuantityDimension` enum of twelve SI base dimensions.** Indriya pulls a multi-jar transitive graph (`unit-api` 2.2 + `indriya` 2.2 + `uom-lib-common`, ~300 KiB combined per Schneide Blog measurements) plus a static `SystemOfUnits` singleton and locale-dependent state that conflict with HomeSynapse's strict JPMS module boundaries. OpenHAB has accumulated years of community-reported edge cases — most notably openhab-core issue #4166 (`QuantityType<Dimensionless>` with unit "one" silently drops the unit on `postUpdate`) and issue #3282 (RFC to deprecate the entire `Number:dimension` item-type proliferation) — that prove the cost is real, not theoretical.
- **`ArrayValue` should be added as a sealed permit of `AttributeValue`, BUT `attribute_changed` MUST continue to carry the whole array as a single value with no delta semantics in M4.** Matter's Interaction Model (Core Spec Chapter 8, §8.6 AttributePathIB, §8.7 Write Interaction) defines element-level list mutation via `ListIndex` + `ListOperation` (Replace / Append / Delete), but event-sourcing with delta semantics would force the projection to replay every element-level operation in order to reconstruct a list — an enormous complexity cost for a marginal wire-bytes gain. Full-replacement is the correct trade for M4 and matches the legacy Matter SDK behavior already in the wild (Nordic Semiconductor's nRF Connect SDK Matter Access Control Guide explicitly documents: "Currently, list operations for single entries (append, update, delete) are not yet supported in the Matter SDK, so the entire list must be written to the attribute to change any ACL." — developer.nordicsemi.com/nRF_Connect_SDK/doc/latest/matter/access-control-guide.html).
- **`SemanticTag(namespace, value)` should subsume `labels: List<String>`, not coexist with it.** Matter 1.4's Standard Namespace Specification defines a typed `(namespace_id, tag_id, label)` triple that maps cleanly onto a `SemanticTag` record; user labels become `SemanticTag(namespace="hs.user", value=label)`. Keeping a flat `List<String>` alongside is a guaranteed source of double-source-of-truth bugs.
- **Reachability should be DEVICE-level (`Device.reachable`), not entity-level.** Matter's Bridged Device Basic Information cluster (0x0039) places `Reachable` (attribute 0x0011) on the bridged-device endpoint, not per-endpoint, as the test plan TC-BR-1 verifies; HA's per-entity `available: bool` has caused community-wide confusion (HA core issue #65181 alone reports 242 occurrences of the deprecated-string-cast warning at a single startup). A `device_reachable_changed(DeviceId, reachable, at)` event is correct; entities inherit unreachability transitively through the projection at read time.
- **Capability sealed-hierarchy expansion should be done in ONE batch at the M4.0 milestone, not incrementally per adapter.** Every additional permit triggers a compile break in every exhaustive switch downstream; amortizing the breakage across 10 permits in one commit is dramatically cheaper than ten separate breaking commits. Stored events reference capabilities by their `EventTypeRegistry` type-name string, decoupled from Java type identity — so old events keep deserializing as long as the type-name strings are stable.
- **`MinimalProjectionAdvancer` should be REPLACED with a composite `ChainedProjectionAdvancer` that dispatches by event type to a `Map<String, ProjectionEventHandler>` registry.** This is the single highest-impact architectural decision in M4: the M3.7 advancer hardcodes three switch arms; M4 adds at minimum five new event types. A map-based dispatch table preserves the existing `ProjectionAdvancer` SPI contract (≤500 rows, ≤2s, bounded window) while making each new handler an isolated, testable, ServiceLoader-discoverable unit.
- **HIGHEST-IMPACT FINDING:** The combination of (a) sealed-hierarchy versioning via type-name strings rather than Java FQN identity, (b) full-replacement `ArrayValue` semantics, and (c) a composite advancer with a handler-registry pattern collectively determines whether M4's event-sourcing model can absorb the projected 25-30 capability permits and ten new event types without a V004 schema migration. **All three must land together in M4.0.**

## 2. Platform / Literature Deep Dives [M]

### 2.1 Matter Application Cluster Spec — list semantics, semantic tags, reachability

**(a) How Matter solves it.** Matter (Connectivity Standards Alliance) models a device as a Node containing one or more Endpoints, each containing Clusters with Attributes, Commands, and Events. List-typed attributes (e.g., `Descriptor.PartsList` = list of endpoint IDs, `GroupKeyManagement.GroupKeyMap` = list of structs, ACL = list of access-control entries) are addressed via `AttributePathIB`, which includes a nullable `ListIndex` field. The pairing of `ListIndex` with `AttributeDataIB.ListOperation` (Replace / Append / Delete) allows EITHER a full-list replacement OR an element-level mutation over the wire. Semantic Tag clusters use a typed `(namespace_id, tag_id, label)` triple where namespace IDs 0x01–0x40 are common across domains, 0x41–0x80 are device-specific, and namespaces above 0x80 are manufacturer-reserved.

**(b) Direct quotation.** From the Matter 1.4 Semantic Tag Namespace specification (Chapter 1, Introduction):

> "The Common namespaces start with Namespace ID 0x01 and contains semantic tags that can apply to any domain. … Device-specific namespaces begin with Namespace ID 0x41. The semantic tags defined in the device-specific namespaces SHALL be restricted for use within each device type or set of device types. A TagList MAY combine several of these tags, as appropriate for the device, provided that for any given device type the tags come from the namespace for that device type as well as any of the common namespaces, and/or from a manufacturer-specific namespace."
— Matter Semantic Tag Namespaces v1.4, https://csa-iot.org/wp-content/uploads/2024/05/matter-1-3-standard-namespace-specification.pdf

On the Reachable attribute (Bridged Device Basic Information cluster 0x0039, attribute 0x0011), the spec test plan TC-BR-1 confirms it lives on the bridged-device endpoint:

> "Verify reachable attribute is read successfully in TH(chip-tool) Log […] CHIP:TOO: Endpoint: 3 Cluster: 0x0000_0039 Attribute 0x0000_0011 DataVersion: 1897994097 […] CHIP:TOO: Reachable: TRUE"
— Tasmota discussion #18873, https://github.com/arendst/Tasmota/discussions/18873

On list write semantics (Matter Core Spec Chapter 8, §8.6 AttributePathIB / §8.7 Write Interaction), the canonical SDK constraint is documented by Nordic Semiconductor's Matter Access Control Guide:

> "Currently, list operations for single entries (append, update, delete) are not yet supported in the Matter SDK, so the entire list must be written to the attribute to change any ACL."
— Nordic Semiconductor nRF Connect SDK — Matter Access Control Guide, https://developer.nordicsemi.com/nRF_Connect_SDK/doc/latest/matter/access-control-guide.html

**(c) Pain points / failure modes.** (1) The split between full-replacement and element-level list semantics has caused implementer confusion — issue project-chip/connectedhomeip#27598 documents a chip-tool capture where a list READ arrives over the wire as an empty-list clear followed by N append-IBs, demonstrating that even reads of lists are chunked at the element level on the wire. (2) Bridged Device Basic Information's Reachable attribute is mandatory but is commonly missing from third-party implementations: espressif/esp-matter issue #1644 reports test harness TC-IDM-10.4 failing because Reachable (0x11) and UniqueID (0x12) attributes are not surfaced even though declared in PICS. (3) Wildcard subscriptions across many endpoints can result in megabytes of report data when list attributes are involved.

**(d) Lesson for HomeSynapse.** Adopt Matter's tag-namespace model directly as `SemanticTag(namespace: String, value: String)`, reserving `"matter.common"`, `"matter.device.{type}"`, `"hs.user"`, `"hs.system"` as the initial four. Reachability must be a **device-level** field, not an entity-level one — Matter's Bridged Device Basic Info already places it on the bridge-side endpoint that represents the device-grouping concept, and inheriting it transitively to entities matches that object model. Reject element-level list semantics for `attribute_changed` in M4: the gain is marginal (a few bytes per update) and the cost is enormous (the projection must replay an ordered element-op log per attribute).

### 2.2 JSR 385 (javax.measure) and Indriya reference implementation

**(a) How it solves it.** JSR 385 (Units of Measurement API 2.0, finalized 2019; Maintenance Release 2 in May 2024) defines a strongly-typed `Quantity<T extends Quantity<T>>` interface with `Unit<T>`, `Dimension`, and `SystemOfUnits` companions. Indriya is the reference implementation, packaged as `tech.units:indriya:2.2`. Optional companion JARs (`systems.uom:systems-unicode:2.1`, `systems-quantity:2.1`) provide non-SI unit catalogs (e.g., MILE, KILOMETER aliases). The API is type-parameterized: `Quantity<Length> d = Quantities.getQuantity(214, CENTI(METRE));` and conversion is `d.to(METRE).getValue().doubleValue();`.

**(b) Direct quotation.** From Frank Rahn's Schneide Blog walkthrough of Unit API 2.0 (which compares Indriya to JScience):

> "While JScience is distributed as one JAR (~600 KiB), a setup of Unit API involves three JARs (~300 KiB in total). … The unit-api JAR only defines interfaces, which is the scope of JSR-385. So you need an implementation to do anything useful with it. The reference implementation is called Indriya, provided by the second JAR. The third JAR, uom-lib-common, is a utility library used by Indriya for common functionality."
— Schneide Blog, https://schneide.blog/tag/unit-api-2-0/

**(c) Pain points / failure modes.** Adoption is shallow outside OpenHAB. Known issues from the consumer ecosystem: (1) `QuantityType<Dimensionless>` with unit `one` does not interoperate correctly with `%` units — openhab-core issue #4166 documents this with reproducer scripts: *"This is because the unit (one) gets dropped here. As there is no unit, postUpdate will assume it is a Number item and update with the configured unit."* (2) Ambiguous-method-call problems between `DecimalType` and `QuantityType` in rules DSL forced openhab-docs PR #675 to add explicit casts to the documentation. (3) The `Number:dimension` item-type proliferation pushed OpenHAB to file RFC openhab-core#3282 to deprecate dimensioned item types entirely in favor of unit metadata. (4) `SystemOfUnits` is a static singleton initialized eagerly — incompatible with JPMS module isolation and surprising under multi-classloader OSGi setups. (5) Indriya 2.x targets Java 8 baseline; using it from a Java 21 sealed-record codebase requires defensive boxing of primitives.

**(d) Lesson for HomeSynapse.** Do NOT pull `javax.measure` into the device-model module. The cost (transitive deps, static singletons, locale state, JPMS friction) exceeds the value (Indriya's numerical conversions). HomeSynapse should expose a thin `QuantityValue(double value, String unitSymbol, QuantityDimension dimension)` record on the wire/event boundary, and allow adapters that need rich conversions to depend on Indriya *inside* the adapter module — never in the core. Unit conversion happens at the adapter, not the projection.

### 2.3 OpenHAB QuantityType — wrapping javax.measure for SI / Imperial conversion

**(a) How it solves it.** OpenHAB Core wraps `javax.measure.Quantity<T>` in its own `QuantityType<T extends Quantity<T>> extends Number implements PrimitiveType, State, Command, Comparable<QuantityType<T>>`. Bindings (adapters) construct `new QuantityType<>(22d, SIUnits.CELSIUS)`; the framework converts to a locale-default unit (imperial for `en-US`/`en-LR`, metric otherwise). Channel types declare `<item-type>Number:Temperature</item-type>` and a state-description pattern `"%.1f %unit%"` consumes the unit at render time.

**(b) Direct quotation.** From the QuantityType.java source file (file header Javadoc):

> "Quantities are usually specified in suitable units of measurement. All units are accessible via the openHAB classes Units, SIUnits, ImperialUnits and CurrencyUnits."
— openhab-core/QuantityType.java, https://github.com/openhab/openhab-core/blob/main/bundles/org.openhab.core/src/main/java/org/openhab/core/library/types/QuantityType.java

And the type signature (Javadoc):

> "public class QuantityType<T extends javax.measure.Quantity<T>> extends Number implements PrimitiveType, State, Command, Comparable<QuantityType<T>>"
— openhab.org Javadoc, https://www.openhab.org/javadoc/latest/org/openhab/core/library/types/quantitytype

**(c) Pain points / failure modes.** Community-reported: (1) implicit/inverse conversions (mired ⇔ Kelvin/Celsius/Fahrenheit) are non-obvious and required a dedicated `toUnitRelative()` method to distinguish deltas from absolutes — the source documents: *"32 °F, when converted with toUnit to Celsius, it will become 0 °C. But when converted with toUnitRelative, it will become 17.8 °C."* (2) Linking dimensioned channels to non-dimensional items silently strips units — *"Linking dimension channels to non-dimensional items is therefore discouraged and will not be permitted in future versions of openHAB."* (3) The OH3→OH4 migration (Java 17 baseline, locale-aware UoM defaults) broke comparison semantics for many users (community thread #148192). (4) Aggregating QuantityType across group items remains an open community recipe topic (thread #144707).

**(d) Lesson for HomeSynapse.** Generic-typed `QuantityType<T>` ties the framework into the `Quantity<T>` type parameter, which is precisely what makes JPMS migration painful — every consumer must reason about the type variable. A FLAT, non-generic record `QuantityValue(double, String, QuantityDimension)` is sufficient because the projection just stores the value and unit symbol; conversion is the adapter's responsibility. Skip the type-parameter machinery entirely.

### 2.4 Home Assistant — `EntityCategory`, `device_class`, and the `available` property

**(a) How it solves it.** HA defines `EntityCategory(StrEnum)` in `homeassistant/const.py` with exactly two values: `CONFIG = "config"` and `DIAGNOSTIC = "diagnostic"`. The category is set on the entity at registration time, typically via an immutable `EntityDescription` dataclass (`entity_category: EntityCategory | None = None`). Reachability is the per-entity `available: bool` property on the `Entity` base class, with `STATE_UNAVAILABLE` as a special sentinel state.

**(b) Direct quotation.** From the HA core source:

> "class EntityCategory(StrEnum): … An entity with a category will: - Not be exposed to cloud, Alexa, or Google Assistant components; - Not be included in indirect service calls to devices or areas … CONFIG = 'config' … DIAGNOSTIC = 'diagnostic'"
— home-assistant/core homeassistant/const.py, https://github.com/home-assistant/core/blob/dev/homeassistant/const.py

The migration PR #60720 (by Franck Nijhof, 2021) introduced the StrEnum:

> "This PR deprecates the use of the ENTITY_CATEGORY_* constants and ENTITY_CATEGORIES constant for entities. Use the EntityCategory enum instead. The old CONST is currently still accepted and working (backward compatible)."
— PR #60720, https://github.com/home-assistant/core/pull/60720

And on availability (developer docs):

> "Indicate if Home Assistant is able to read the state or control the underlying device, see entity-unavailable for more details."
— developers.home-assistant.io/docs/core/entity/, https://developers.home-assistant.io/docs/core/entity/

**(c) Pain points / failure modes.** (1) The string→StrEnum migration generated an extreme warning-log flood: Home Assistant Core issue #65181 (titled *"'Detected code that uses str (diagnostic) for entity category' is being logged after the update to 2022.2.b3"*) reports a single startup producing 242 occurrences of the deprecation warning, caused by integrations passing raw strings (`"diagnostic"`) instead of the `EntityCategory` enum value after the migration in HA 2022.2. A follow-up issue #66380 had to be filed because the original logger gave no source-integration attribution. (2) `entity_category` interacts subtly with history recording — setting an entity to DIAGNOSTIC removes it from history charts, surprising users; emsesp/EMS-ESP32 discussion #1459 reports: *"To me it sounds like all the EMS-ESP32 sensors should not be part of 'Configuration' and 'Diagnostic'."* (3) Per-entity `available` is not per-device reachability; HA has no first-class device-level offline event, so each integration's adapter must echo the unreachable state across all its entities — duplicative, inconsistent, and a known maintenance burden.

**(d) Lesson for HomeSynapse.** Adopt the two-value enum exactly (`CONFIG`, `DIAGNOSTIC`); reject `SYSTEM` (esphome/issues #2729 confirms HA validates only `''`, `'config'`, `'diagnostic'`). But INVERT the availability model: keep `reachable` at the device level (one event, one source of truth) rather than per-entity. The entity-level confusion in HA is a documented anti-pattern. Make category an Entity registry property, not a state event.

### 2.5 Jackson polymorphic serialization for Java 21 sealed hierarchies

**(a) How it solves it.** Pre-3.0 Jackson requires both `@JsonTypeInfo(use = Id.NAME, property = "type")` AND an `@JsonSubTypes({@Type(...), ...})` enumeration on the parent type, OR programmatic `ObjectMapper.registerSubtypes(NamedType...)`. Jackson 3.0.0-rc2 (and now Jackson 3.0.0 GA, released October 3, 2025) added native sealed-class support that infers subtypes from the `permits` clause, eliminating the duplication.

**(b) Direct quotation.** From Tatu Saloranta (Jackson author/maintainer), Jackson 3.0.0-rc2 announcement on Medium:

> "but with sealed classes and Jackson 3.0.0-rc2, you only need @JsonTypeInfo as marker (and definition of which type id to use): @JsonTypeInfo(use=JsonTypeInfo.Id.NAME, include=As.PROPERTY, property=\"type\") abstract sealed class BaseX permits ImplX, ImplY, ImplZ { } which works pretty well as sub-type definitions are required for sealed classes anyway — and you no longer can accidentally forget them."
— @cowtowncoder, https://cowtowncoder.medium.com/jackson-3-0-0-rc2-minor-update-593306f89e2c

Saloranta's later announcement "Jackson 3.0.0 (GA) released" confirms the October 3, 2025 milestone:

> "Jackson 3.0.0 was released last week, on October 3rd 2025. It is a big milestone for both the Jackson project and its user community."

**(c) Pain points / failure modes.** (1) `defaultImpl` for unknown subtypes is a partial solution — Jackson-databind issue #1538 shows it incorrectly substitutes the default for null-valued polymorphic fields. (2) Pre-3.0, the kotlin-jackson module faced the identical "auto-detect sealed subtypes" request (issue #239), reinforcing that the manual enumeration was widely felt as friction. (3) Forward-compatibility: when an old client deserializes JSON with a subtype it doesn't know, it throws `InvalidTypeIdException` unless `defaultImpl` is set — but `defaultImpl` requires the default to actually be assignable, which often breaks for sealed hierarchies because the default would have to be inside `permits`. (4) `ObjectMapper.registerSubtypes()` had broken equality semantics: per FasterXML/jackson-databind #2515 (milestone 2.11.0) and confirmed by commenter on issue #2950 — *"the fix was only included in 2.11.x."* The root cause was that `NamedType.equals()`/`hashCode()` considered only the class field, not the name field, causing `StdSubtypeResolver`'s `LinkedHashSet` to silently drop duplicate-class entries.

**(d) Lesson for HomeSynapse.** Even with Jackson 3.0 GA shipped, HomeSynapse's `PersistenceJacksonModule` should *explicitly* register every permit of `AttributeValue` and `Capability` for two reasons: (1) the existing `EventTypeRegistry + DegradedEvent` mechanism (LTD-19) handles unknown TOP-LEVEL event types but does NOT handle unknown SUBTYPES of a polymorphic value — a stored `attribute_changed` event with a `value` field referencing an unknown `AttributeValue` permit will fail to deserialize without explicit handling; (2) Jackson 3.x is a major-version change with API breakage from 2.x, and HomeSynapse depends on a known-good 2.x pipeline today. The contingency is to register a `DegradedAttributeValue(originalTypeName: String, rawJson: String)` permit as a fallback, paralleling `DegradedEvent`.

### 2.6 Marten — projection extension via Apply / Create convention

**(a) How it solves it.** Marten (JasperFx, .NET/PostgreSQL document DB) supports projections via a convention: subclass `SingleStreamProjection<TDoc, TId>` (or `MultiStreamProjection<...>` or `EventProjection`) and define `Apply(EventType, TDoc)` or `Create(EventType)` methods. Marten inspects via reflection at startup and routes each event to the matching method. New event types are added by declaring a new `Apply` method; no central switch.

**(b) Direct quotation.** From Marten 8 aggregate-projection documentation:

> "Starting with Marten 8.0, we've tried somewhat to conform to the terminology used by the Functional Event Sourcing Decider paper by Jeremie Chassaing. To that end, the API now refers to a 'snapshot' that really just means a version of the projection and 'evolve' as the step of applying new events to an existing 'snapshot' to calculate a new 'snapshot.'"
— martendb.io/events/projections/aggregate-projections, https://martendb.io/events/projections/aggregate-projections

And the apply-convention rule:

> "The out-of-the box convention is to expose public Apply([Event Type]) methods on your aggregate class to do all incremental updates to an aggregate object."
— marten-docs-v6 projections, https://marten-docs-v6.netlify.app/events/projections/

**(c) Pain points / failure modes.** Reflection-driven discovery makes refactoring fragile — renaming an event type silently drops the handler. Strong-typed IDs were notably painful — Marten's own docs describe: *"The rise of Strong Typed Identifiers has not been the most pleasant experience for the Marten and Wolverine teams as these types are 'neither fish, nor fowl' in the way the internals have to constantly wrap or unwrap these things."* Multi-stream projections require a custom `IAggregateGrouper<TId>` and explicit `Identity<TEvent>()` registration, adding boilerplate. Asynchronous projections processing multiple types in parallel can race on shared documents without `EnableDocumentTrackingByIdentity`.

**(d) Lesson for HomeSynapse.** The Apply/Create convention's strength — extensibility without modifying central code — is precisely what M3.7's `MinimalProjectionAdvancer` lacks. Adopt a handler-registry pattern keyed by `EventTypeRegistry` type-name string, with **explicit ServiceLoader registration** (not reflection — JPMS forbids cross-module reflection per HomeSynapse invariants). Each new event type adds a `ProjectionEventHandler` implementation and registers it via the consumer module's `module-info.java` `provides` clause.

### 2.7 Axon Framework — Upcasting for event versioning

**(a) How it solves it.** Axon stores each event with a `RevisionResolver`-supplied revision number alongside the fully-qualified event class name. When the event store reads an old event, an `UpcasterChain` of `IntermediateEventRepresentation` transformers is applied; each upcaster handles exactly one revision bump for one event type. The chain is composable: events of unrecognized types pass through unchanged.

**(b) Direct quotation.** From Axon Framework Reference Guide 4.11:

> "The basic Upcaster interface for events in the Axon Framework works on a Stream of IntermediateEventRepresentations and returns a Stream of IntermediateEventRepresentations. The upcasting process thus does not directly return the end result of the introduced upcast functions, but chains every upcasting function from one revision to another together by stacking IntermediateEventRepresentations."
— docs.axoniq.io/axon-framework-reference/4.11/events/event-versioning/, https://docs.axoniq.io/axon-framework-reference/4.11/events/event-versioning/

And from Allard Buijze (Axon Framework lead) on Google Groups:

> "you would have a single chain, through which all Events will pass. Each upcaster in the chain will convert a single version of a single event to the next version. Events of other types are ignored and passed up the chain as-is."
— Axon Framework Users group, https://groups.google.com/g/axonframework/c/Tf3RhmWROiw

**(c) Pain points / failure modes.** (1) Refactoring class names breaks the FQN linkage — Steven Schwenke documents this in his "Refactoring Your Classes In Axon" post: *"The serialized content contains the fully qualified name of the Java class of the event, including its package. The planned refactoring would break the serialization of old events; existing data could not be mapped back to Java classes."* (2) Each refactor adds another upcaster, leading to a long chain over years — *"refactorings such as this would cause an explosion of complexity"*. (3) The `IntermediateEventRepresentation` works on serialized form (JsonNode or dom4j Document) which is awkward to write — Axon ReferenceGuide issue #101 explicitly notes *"Questions about 'how do I upcast?' arise quite often, as the process is quite complicated."*

**(d) Lesson for HomeSynapse.** Don't tie event identity to fully-qualified Java class name. HomeSynapse already uses `EventTypeRegistry` type-name strings (per LTD-19), which decouples wire identity from Java identity — this is correct and should be preserved. When AttributeValue/Capability gain new permits, register them in `EventTypeRegistry` with a stable string name; NEVER use the Java FQN. The upcasting machinery in M4 should target the *value* hierarchy (AttributeValue permits), not the top-level event types, and should be a *transformer at the Jackson module level* rather than a separate `UpcasterChain` stage — folded into `PersistenceJacksonModule`.

## 3. Cross-Cutting Analysis [M]

### 3.1 Concept Mapping Table

| HomeSynapse concept | Matter | Home Assistant | OpenHAB | Axon | Marten |
|---|---|---|---|---|---|
| Entity addressable unit | Endpoint | Entity (entity_id) | Item | Aggregate | Aggregate (stream id) |
| Device grouping | Node | Device | Thing | n/a | n/a |
| Category (config/diag) | n/a (Descriptor tags) | EntityCategory StrEnum | category metadata | n/a | n/a |
| Reachability | BridgedDeviceBasicInfo.Reachable (0x0011) | Entity.available | Thing.status | n/a | n/a |
| Quantity with unit | Typed numeric + unit suffix | unit_of_measurement: str | QuantityType<T> | n/a | n/a |
| Array / list value | List attribute + ListIndex | list state attribute | (avoided) | n/a | n/a |
| Semantic tag | TagList (namespace+tag) | device_class string | tag string list | n/a | n/a |
| Capability sealed type | Cluster ID enum | Domain string | ChannelType ID | Event class | Event class |
| Event versioning | DataVersion uint32 | n/a (snapshot model) | n/a | Upcaster + Revision | TypeMapping + projection rebuild |
| Type-name identity | Cluster + Attribute IDs | string domain | thingTypeUID | Java FQN | TypeMapping string |

### 3.2 Gap Analysis (ranked by impact)

1. **EntityCategory** — present in Matter (via Descriptor tags) and HA (StrEnum); MISSING in HomeSynapse. **High impact** — auto-generated dashboards and UI grouping depend on it. → REC-23.
2. **QuantityValue** — present in Matter (typed attributes), HA (`unit_of_measurement`), OpenHAB (`QuantityType<T>`); MISSING in HomeSynapse. **High impact** — without it, every sensor reading is a bare `double` with the unit smuggled in a label. → REC-24.
3. **SemanticTag** — present in Matter (TagList), HA (device_class); MISSING in HomeSynapse. **Medium-high impact** — affects integration UIs and routing. → REC-26.
4. **Reachability** — present in Matter (Reachable attribute) and HA (`available`); MISSING in HomeSynapse. **High impact** — without it, stale-detection is the only signal for offline devices, which is too coarse. → REC-25.
5. **ArrayValue** — present in Matter (list attributes); MISSING in HomeSynapse. **Medium impact** — many Matter attributes are lists (PartsList, GroupKeyMap, ACL). → REC-27.
6. **Event upcasting** — present in Axon; MISSING in HomeSynapse. **Medium impact** — needed once sealed hierarchies start adding permits. → REC-29.
7. **Composite projection advancer** — present in Marten (Apply convention); MISSING in HomeSynapse (M3.7 ships hardcoded switch). **Highest impact** — gates every downstream event addition. → REC-28.

### 3.3 Over-Abstraction Analysis

- **`CustomCapability`** (present in current Capability hierarchy). **Defense: retain.** It is the escape hatch for adapter-specific capabilities (Zigbee proprietary clusters, vendor extensions) that don't map to the standard permits. Removing it would force adapters to either lobby for new permits (slow) or downgrade to opaque attribute bags (bad).
- **`AttributeValue.NullValue`** (hypothetical, if present). **Retraction.** Java records can hold `null` directly via `Optional<AttributeValue>` at the call site; a dedicated NullValue permit duplicates the language feature.
- **Generic-typed `QuantityValue<T extends Quantity<T>>`** (would be copied from OpenHAB). **Reject.** A non-generic `QuantityValue` record with a `QuantityDimension` enum gives all the type discrimination needed without infecting every consumer with a type variable.
- **Separate `entity_category_set` event** (proposed in some early M4 sketches). **Reject.** Category is a registry property, not state; carry it on `entity_registered`. HA's design supports this position.
- **Per-entity `reachable` field** (proposed mirroring HA). **Reject.** Matter places Reachable at the bridged-device endpoint, which corresponds to HomeSynapse's `Device`, not `Entity`. HA's per-entity model is a documented anti-pattern that forces N-way duplication.

### 3.4 Competitive Assessment

HomeSynapse is **genuinely differentiated** in three areas, with qualifying language:

1. **Event-sourced state derivation with a bounded-window projection advancer.** Matter has no projection model (devices report directly to controllers); HA replays from snapshot; OpenHAB has no event store; Marten and Axon are libraries, not home-automation runtimes. HomeSynapse's `ProjectionAdvancer` SPI with the ≤500 rows / ≤2s contract is unique. **Qualifier:** this differentiation HOLDS ONLY IF the advancer can handle new event types without breaking the bounded-window contract — hence REC-28.
2. **Strict JPMS module isolation with one flat package per module, inward-only dependency direction.** OpenHAB attempted OSGi modularization and has accumulated split-package issues over many years; HA's Python plugin model has no module discipline; Marten is unconstrained. HomeSynapse's JPMS enforcement gives compile-time guarantees no competitor matches. **Qualifier:** this advantage erodes if `javax.measure` (which violates the principle with static singletons and locale state) is pulled into the core — hence the REC-24 rejection of JSR 385.
3. **Sealed hierarchies for AttributeValue and Capability with exhaustive switches.** Matter uses ad-hoc TLV typing; HA uses Python's duck typing; OpenHAB uses an open interface. HomeSynapse's compile-time exhaustiveness checks for value handling are unique. **Qualifier:** this advantage only survives if hierarchy growth is managed in batches with handler-registry indirection — hence REC-28 (advancer chain) and REC-30 (batch hierarchy expansion).

## 4. Amendment Recommendations [M]

Ranked by (impact × confidence) / cost.

### REC-23 — Add EntityCategory to Entity; extend entity_registered

- **Gap citation:** §3.2 gap #1 (EntityCategory).
- **Lesson source:** §2.4 — HA's exactly-two-value StrEnum, with category as a registry property not a state event.
- **Change:**
  - Module `core/device-model`, package `com.homesynapse.device`: add public enum `EntityCategory { PRIMARY, CONFIG, DIAGNOSTIC }`.
  - Modify `Entity` record to add field `EntityCategory category` (default `PRIMARY`).
  - Module `core/event-model`, package `com.homesynapse.event`: extend `EntityRegistered` payload record with `EntityCategory category` (nullable for backward compat; null → `PRIMARY` at projection time).
  - Module `core/state-store`, package `com.homesynapse.statestore`: extend `EntityState` from 9 to 10 fields by adding `category` (the existing 9th field `stale` remains the read-time-derived field).
  - Module `app/rest-api`, package `com.homesynapse.rest`: add `?category=config|diagnostic|primary` filter on `GET /entities` endpoint.
- **Backward compat:** Existing `EntityRegistered` events stored in V001 events table have no `category` field; Jackson deserializes them with `category=null`, projection maps null→PRIMARY. Forward-compatible: old code reading new events ignores the unknown field via existing `@JsonIgnoreProperties(ignoreUnknown=true)` annotation per LTD-19. NO schema migration. AMD: none required.
- **Effort:** ~120 LOC (enum 5, Entity field 2, EntityState field 3, EntityRegistered field 2, projection mapping 8, REST filter 30, tests 70).

### REC-24 — Add QuantityValue as AttributeValue permit (no JSR 385)

- **Gap citation:** §3.2 gap #2 (QuantityValue).
- **Lesson source:** §2.2 (reject Indriya for footprint and JPMS reasons) and §2.3 (don't copy OpenHAB's generic-typed wrapper).
- **Change:**
  - Module `core/device-model`, package `com.homesynapse.device`: add
    `public enum QuantityDimension { TEMPERATURE, LENGTH, MASS, TIME, ELECTRIC_CURRENT, ENERGY, POWER, PRESSURE, VOLUME, FREQUENCY, LUMINOUS_INTENSITY, DIMENSIONLESS }`
    and `public record QuantityValue(double value, String unitSymbol, QuantityDimension dimension) implements AttributeValue { ... validation ... }`.
  - Modify the `sealed interface AttributeValue permits ...` clause to ADD `QuantityValue`.
  - Register `QuantityValue` in `PersistenceJacksonModule` with type-name `"quantity"`.
- **Backward compat:** Existing stored events do not reference QuantityValue, so deserialization is unaffected. Adding a sealed permit IS a compile-break for every exhaustive switch on AttributeValue — batched per REC-30. NO schema migration. AMD: required because `AttributeValue.permits` clause is a Phase 2 interface signature; one-line amendment ratified by architecture council.
- **Effort:** ~180 LOC (enum 15, record 25, validation 30, registry 5, switch updates ~70, tests 35). Adapters needing unit conversion depend on Indriya privately: zero core LOC.

### REC-25 — Add device_reachable_changed event (device-level)

- **Gap citation:** §3.2 gap #4 (Reachability).
- **Lesson source:** §2.1 — Matter places Reachable on the bridged-device endpoint, and §2.4 — HA's per-entity availability is a documented anti-pattern.
- **Change:**
  - Module `core/device-model`, package `com.homesynapse.device`: add field `boolean reachable` to `Device` record (default `true`).
  - Module `core/event-model`, package `com.homesynapse.event`: add new payload `public record DeviceReachableChanged(DeviceId deviceId, boolean reachable, Instant at) implements EventPayload`.
  - Register in `EventTypeRegistry` with type-name `"device.reachable_changed"`.
  - Module `core/state-store`: projection sets `Device.reachable`. Add derived read-time rule: entities of an unreachable device are also unreachable at read time, via the projection's read transaction.
- **Backward compat:** New event type; old projections skip it via `AdvanceResult.skipped()` per the M3.7 contract. Old Device records deserialize with `reachable=true` default. NO schema migration. Purely additive. AMD: none required.
- **Effort:** ~95 LOC (record 15, registry entry 3, projection handler 25, Device field 2, derived rule 20, tests 30).

### REC-26 — Add SemanticTag; replace labels: List<String>

- **Gap citation:** §3.2 gap #3 (SemanticTag).
- **Lesson source:** §2.1 — Matter Semantic Tag namespace model from the v1.4 standard namespace spec.
- **Change:**
  - Module `core/device-model`, package `com.homesynapse.device`: add `public record SemanticTag(String namespace, String value) { ... }` with reserved-namespace constants `NS_MATTER_COMMON = "matter.common"`, `NS_MATTER_DEVICE_PREFIX = "matter.device."`, `NS_HS_USER = "hs.user"`, `NS_HS_SYSTEM = "hs.system"`.
  - Migrate `Entity.labels: List<String>` → `Entity.tags: List<SemanticTag>` via a projection upcaster: old labels become `SemanticTag("hs.user", label)`.
  - Adapter contract: Matter adapter emits Matter namespaces (`matter.common.location`, etc.); Zigbee adapter only emits `hs.system` tags (e.g., `("hs.system.protocol", "zigbee3.0")`).
- **Backward compat:** Stored `EntityRegistered` events with `labels: List<String>` are read via the `LabelsToTagsUpcaster` (REC-29 prerequisite). NO schema migration required, but REQUIRES REC-29 to land first. AMD: required for `Entity` record signature change; rolled into the same amendment as REC-23.
- **Effort:** ~150 LOC (record 12, namespace constants 8, projection upcaster integration 25, Entity field migration 20, adapter contract docs + tests 85). This is the only REC that REQUIRES another REC (REC-29) to land first.

### REC-27 — Add ArrayValue with full-replacement semantics

- **Gap citation:** §3.2 gap #5 (ArrayValue).
- **Lesson source:** §2.1 — Matter supports element-level list ops but Nordic SDK docs confirm legacy SDKs implement only full-replacement; full-replacement is robust and projection-friendly.
- **Change:**
  - Module `core/device-model`, package `com.homesynapse.device`: add `public record ArrayValue(List<AttributeValue> elements) implements AttributeValue { ... defensive copy + max-depth-4 validation ... }`.
  - Modify `sealed interface AttributeValue permits ...` to ADD `ArrayValue`.
  - `attribute_changed` semantics: when the value is an `ArrayValue`, it represents the ENTIRE new array, not a delta. Document in `event-model` package-info.java.
- **Backward compat:** Pure addition. No existing event references ArrayValue. Compile break in exhaustive switches — batched per REC-30. NO schema migration. AMD: covered by the same one-line amendment as REC-24.
- **Effort:** ~110 LOC (record 8, depth validation 15, registry 3, switches across codebase ~50, tests 34).

### REC-28 (HIGHEST IMPACT) — Replace MinimalProjectionAdvancer with ChainedProjectionAdvancer

- **Gap citation:** §3.2 gap #7 (composite advancer).
- **Lesson source:** §2.6 — Marten's Apply/Create convention, adapted for JPMS via ServiceLoader.
- **Change:**
  - Module `core/state-store`, package `com.homesynapse.statestore`: introduce
    `public interface ProjectionEventHandler { String eventType(); void apply(EventEnvelope env, ProjectionWriteContext ctx); }`
    and `public final class ChainedProjectionAdvancer implements ProjectionAdvancer { private final Map<String, ProjectionEventHandler> handlers; ... }`. The map is constructed via `ServiceLoader<ProjectionEventHandler>` at startup. The SPI contract is preserved: `advance(fromPosition, maxRows) → AdvanceResult`, ≤500 rows per call, ≤2 s read transaction, bounded-window contract.
  - The existing 3 hard-coded handlers (entity_registered, state_changed, device_registered) become individual `ProjectionEventHandler` implementations under `com.homesynapse.statestore.handlers`.
  - For M4, add handlers: `DeviceReachableChangedHandler` (REC-25), `AttributeChangedHandler` (general), `CapabilityDiscoveredHandler`, `SemanticTagAppliedHandler` (if event-modeled).
  - Unknown event types: the map miss case returns `AdvanceResult.skipped()` exactly as M3.7 behaves.
- **Backward compat:** The `ProjectionAdvancer` SPI signature is preserved. Existing consumers see no API change. Implementation class name changes (`MinimalProjectionAdvancer` → `ChainedProjectionAdvancer`); any FQN references update. NO schema migration. AMD: required to amend the Phase 2 invariant "one flat package per module" — see §7.6.
- **Effort:** ~340 LOC (interface 12, ChainedProjectionAdvancer 80, 3 existing handlers extracted ~90, 4 new M4 handlers ~120, module-info wiring 12, tests 26).

### REC-29 — Add AttributeValueUpcaster SPI

- **Gap citation:** §3.2 gap #6 (event upcasting).
- **Lesson source:** §2.5 (Jackson sealed support per Saloranta) and §2.7 (Axon's UpcasterChain pattern, adapted to avoid FQN coupling).
- **Change:**
  - Module `core/persistence`, package `com.homesynapse.persistence`: add
    `public interface AttributeValueUpcaster { String fromTypeName(); String toTypeName(); JsonNode upcast(JsonNode old); }`.
  - Wire into `PersistenceJacksonModule` as a pre-deserialization hook: before resolving the `"type"` discriminator, run any registered upcasters for that type-name. ServiceLoader-based discovery.
  - Initial use: `LabelsToTagsUpcaster` for REC-26 (converts `"labels":[...]` to `"tags":[{"namespace":"hs.user","value":"..."}]`).
- **Backward compat:** Pure addition; no existing stored event references an upcaster. The `DegradedEvent` fallback for unknown top-level event types (LTD-19) is preserved. AMD: none — this is purely additive SPI.
- **Effort:** ~180 LOC (interface 10, module wiring 50, LabelsToTagsUpcaster 40, ServiceLoader infrastructure 30, tests 50).

### REC-30 — Batch Capability permit expansion at M4.0

- **Gap citation:** §3.3 Over-Abstraction Analysis + Research 2's "expect 25–30" estimate.
- **Lesson source:** §2.7 (Axon's refactor pain — minimize FQN dependence) + §3.4 (preserve sealed switch exhaustiveness).
- **Change:**
  - Module `core/device-model`, package `com.homesynapse.device`: expand `sealed interface Capability permits` from 15 + `CustomCapability` to all anticipated M4 permits in ONE commit at M4.0.
  - Initial M4 additions (10 permits): `Thermostat`, `WindowCovering`, `DoorLock`, `MediaPlayer`, `EnergyMeasurement`, `WaterValve`, `Fan`, `AirQuality`, `OccupancySensor`, `ContactSensor`.
  - Each permit gets a stable `EventTypeRegistry` name (lower-snake-case): `"capability.thermostat"`, `"capability.window_covering"`, etc. These names are PERMANENT; renaming requires an upcaster (REC-29).
  - All downstream exhaustive switches updated in the same commit.
- **Backward compat:** Stored events reference capabilities by type-name strings; old events still deserialize. Compile break contained to one commit cycle. NO schema migration. AMD: required for the `Capability.permits` clause (Phase 2 interface signature); single amendment ratified at the architecture council meeting that approves M4.0.
- **Effort:** ~520 LOC (10 capability records ~150, registry entries ~30, switch updates across ~12 sites ~180, integration tests per capability ~160).

## 5. Caveats and Open Questions [M]

**Source reliability notes.** Matter spec quotations are from CSA-IOT.org PDFs (primary), with some structural details corroborated via project-chip/connectedhomeip SDK source comments (secondary, but authoritative on actual implementation behavior). The exact §8.7 ListIndex normative SHALL paragraph was not captured verbatim in this research session due to PDF fetch-size constraints; the lead author should confirm the precise wording from the Matter 1.4 Core Specification PDF (https://csa-iot.org/wp-content/uploads/2024/11/24-27349-006_Matter-1.4-Core-Specification.pdf, Chapter 8, ~§8.7.3) before merging REC-27. Home Assistant quotations are from `homeassistant/core` dev branch, which may drift; the EntityCategory enum has been stable since the 2022.2 migration (PR #60720). OpenHAB quotations are from `openhab/openhab-core` main branch and JavaDoc 5.2.0-SNAPSHOT — version-stable. Axon docs reference v4.11; the Upcaster interface has been stable since Axon 3.x.

**Unresolved tensions between platforms.**

- **EntityCategory third value:** ESPHome issue #2729 requested a `SYSTEM` category that HA never adopted. Our REC-23 models only the two HA values; if Matter or a future HA release adds a third, REC-23's enum expands.
- **OpenHAB UoM future direction:** openhab-core issue #3282 proposes deprecating `Number:dimension` types entirely in favor of unit metadata — unresolved as of recent OpenHAB community threads. HomeSynapse's `QuantityValue` design sidesteps the debate by treating unit as a value-field rather than a type parameter.
- **Jackson 3.0 migration:** Jackson 3.0.0 GA released October 3, 2025 per Saloranta's announcement. If HomeSynapse upgrades from 2.x to 3.x within the M4 lifecycle, the `@JsonSubTypes` annotations on `AttributeValue`/`Capability` can be removed (sealed-class inference takes over) and REC-29's upcaster only needs to handle field-level changes. **Open question requiring empirical validation:** can `PersistenceJacksonModule` be made forward-compatible with both Jackson 2.x AND 3.x simultaneously, or is a hard cutover required? Spike recommended in M4.1.
- **Matter list element-level mutation:** the subagent investigation confirmed Matter spec defines `ListIndex` + `ListOperation` but legacy SDKs implement only full-replacement. If HomeSynapse later wants to support partial list updates (e.g., Matter 2.x Reports with ListIndex on GroupKeyMap), the `attribute_changed` event would need a new variant — **explicitly M5+ scope, excluded from REC-27.**

**Questions requiring empirical validation (spike or prototype).**

- **Marten Apply-convention adaptation under JPMS:** HomeSynapse cannot adopt Marten's reflection-driven discovery directly because JPMS forbids cross-module reflection per HomeSynapse invariants. REC-28's ServiceLoader-based registration is the equivalent but requires every handler to be explicitly declared in `module-info.java`. **Open question:** does the M3 build pipeline have CI checks that fail if a `ProjectionEventHandler` is added to the class graph but missing from `module-info.java`? If not, this is a hole; recommend adding a `hassfest`-style validator script (modeled on Home Assistant's hassfest pre-commit checks).
- **Reachability cascade read latency:** REC-25 specifies that entities inherit unreachability from their device "at read time" via projection join. **Open question:** what's the read latency of `entity → device → reachable` join? With ULID `BLOB(16)` device_id columns this should be a single indexed lookup, but the projection's ≤2 s read transaction contract must hold. Spike: synthetic load test with 10 k devices × 5 entities each = 50 k join lookups.
- **EntityCategory immutability vs reclassification:** the choice to extend `entity_registered` vs introduce `entity_category_set` was made based on HA's design. If user-facing reclassification of an entity (e.g., promoting a diagnostic sensor to primary) becomes a use case, we would need `entity_category_set` after all. **Phase 3 feature, not M4.**
- **Jackson `registerSubtypes` equality fix version:** the bug described in §2.5(c) was fixed in Jackson 2.11.0 (FasterXML/jackson-databind #2515 milestone), NOT in 2.10.5 as some sources state. Per the issue #2950 commenter: *"the fix was only included in 2.11.x."* HomeSynapse's persistence stack is on 2.17+, so this is moot, but the open question is: which Jackson minor version should the HomeSynapse BOM pin? Recommend 2.17 LTS until Jackson 3 migration is scheduled.
- **Architecture council ratification of sealed-permits clauses:** REC-24, REC-26, REC-27, REC-30 each modify a sealed `permits` clause on either `AttributeValue`, `Capability`, or both. The standing question is whether these constitute Phase 2 interface amendments requiring formal council ratification, or are merely additive type extensions. **Recommendation:** treat any addition to a `permits` clause as an AMD against the Phase 2 interface; one consolidated amendment for the M4.0 release.

## 6. Appendix: Sources [M]

### Matter / CSA Connectivity Standards Alliance

- https://csa-iot.org/wp-content/uploads/2024/05/matter-1-3-standard-namespace-specification.pdf — Matter Semantic Tag Namespaces v1.4
- https://csa-iot.org/wp-content/uploads/2023/10/Matter-1.2-Application-Cluster-Specification.pdf — Matter 1.2 Application Cluster Specification
- https://csa-iot.org/wp-content/uploads/2022/11/22-27351-001_Matter-1.0-Device-Library-Specification.pdf — Matter 1.0 Device Library Specification (Bridged Node device type)
- https://csa-iot.org/wp-content/uploads/2024/11/24-27349-006_Matter-1.4-Core-Specification.pdf — Matter 1.4 Core Specification (Chapter 8: Interaction Model, §8.6 AttributePathIB, §8.7 Write Interaction)
- https://csa-iot.org/wp-content/uploads/2022/11/22-27350-001_Matter-1.0-Application-Cluster-Specification.pdf — Matter 1.0 Application Cluster Specification
- https://github.com/project-chip/connectedhomeip/blob/master/src/app/AttributeAccessInterface.h — SDK list-operation comments
- https://github.com/project-chip/connectedhomeip/issues/27598 — Empirical list-report chunking behavior
- https://github.com/espressif/esp-matter/issues/1644 — TC-IDM-10.4 failure (Reachable / UniqueID missing)
- https://github.com/arendst/Tasmota/discussions/18873 — TC-BR-1 Reachable test verification
- https://developer.nordicsemi.com/nRF_Connect_SDK/doc/latest/matter/access-control-guide.html — Nordic Matter Access Control Guide (list operations not supported)
- https://developers.home.google.com/matter/primer/device-data-model — Matter data model primer (Google)
- https://developers.home.google.com/matter/primer/interaction-model-writing — Write Transactions
- https://docs.silabs.com/matter/latest/matter-fundamentals-interaction-model/ — Silicon Labs Interaction Model docs

### Home Assistant

- https://github.com/home-assistant/core/blob/dev/homeassistant/const.py — `EntityCategory(StrEnum)` definition
- https://github.com/home-assistant/core/blob/dev/homeassistant/helpers/entity.py — Entity base class, `CACHED_PROPERTIES_WITH_ATTR_`, `_attr_available`
- https://github.com/home-assistant/core/pull/60720 — Migration to StrEnum (frenck)
- https://github.com/home-assistant/core/issues/65181 — Deprecation warning flood after 2022.2.b3
- https://github.com/home-assistant/core/issues/66380 — Logging improvement follow-up
- https://github.com/emsesp/EMS-ESP32/discussions/1459 — DIAGNOSTIC entities removed from history
- https://github.com/esphome/issues/issues/2729 — `SYSTEM` category rejected
- https://developers.home-assistant.io/docs/core/entity/ — Entity developer docs
- https://developers.home-assistant.io/docs/core/integration-quality-scale/rules/entity-category/ — Integration quality scale rule

### JSR 385 / Indriya

- https://github.com/unitsofmeasurement/indriya — Reference implementation repo
- https://unitsofmeasurement.github.io/indriya/ — Indriya project page
- https://unitsofmeasurement.github.io/2024/mr2.html — JSR 385 MR2 release (May 2024)
- https://belief-driven-design.com/java-measurement-jsr-385-210f2/ — JSR 385 explainer (JSR 108→275→363→385 history)
- https://schneide.blog/tag/unit-api-2-0/ — Indriya vs JScience footprint comparison (~300 KiB vs ~600 KiB)
- https://groovy.apache.org/blog/life-on-mars-units-of — Groovy DSL examples
- https://jcp.org/aboutJava/communityprocess/mrel/jsr385/index2.html — JSR 385 Maintenance Release page

### OpenHAB

- https://github.com/openhab/openhab-core/blob/main/bundles/org.openhab.core/src/main/java/org/openhab/core/library/types/QuantityType.java — QuantityType source
- https://www.openhab.org/javadoc/latest/org/openhab/core/library/types/quantitytype — QuantityType Javadoc
- https://www.openhab.org/docs/concepts/units-of-measurement.html — UoM concepts
- https://github.com/openhab/openhab-core/issues/4166 — Dimensionless with unit "one" bug
- https://github.com/openhab/openhab-core/issues/3282 — RFC: Change Number item type for UoM
- https://community.openhab.org/t/oh4-item-quantitytype/148192 — OH3→OH4 migration pain
- https://community.openhab.org/t/aggregation-of-quantitytype-in-group-items/144707 — Group aggregation discussion

### Jackson

- https://github.com/FasterXML/jackson-docs/wiki/JacksonPolymorphicDeserialization — Polymorphic deserialization wiki
- https://cowtowncoder.medium.com/jackson-3-0-0-rc2-minor-update-593306f89e2c — Tatu Saloranta on Jackson 3.0 sealed-class support
- https://github.com/FasterXML/jackson-databind/issues/1538 — `defaultImpl` null bug
- https://github.com/FasterXML/jackson-databind/issues/2950 — `registerSubtypes` equality bug (fixed in 2.11.0 per #2515)
- https://github.com/FasterXML/jackson-module-kotlin/issues/239 — Auto-detect sealed subtypes request
- https://www.baeldung.com/java-jackson-polymorphic-deserialization — Practical patterns

### Marten

- https://martendb.io/events/projections/ — Projections overview
- https://martendb.io/events/projections/aggregate-projections — Aggregate / SingleStream / MultiStream projections
- https://github.com/JasperFx/marten/blob/master/documentation/documentation/events/projections/custom.md — Custom projections
- https://event-driven.io/en/projections_in_marten_explained/ — Practical guide

### Axon Framework

- https://docs.axoniq.io/axon-framework-reference/4.11/events/event-versioning/ — Event versioning / Upcaster
- https://github.com/AxonIQ/reference-guide/blob/master/axon-framework/events/event-versioning.md — Reference guide
- https://groups.google.com/g/axonframework/c/Tf3RhmWROiw — Allard Buijze on upcaster chains
- https://stevenschwenke.de/RefactoringYourClassesInAxon — Refactoring pain
- https://trifork.nl/blog/refactoring-in-an-event-sourced-world-upcasting-in-axon-2/ — Upcasting in Axon 2
- https://github.com/AxonFramework/ReferenceGuide/issues/101 — "How do I upcast?" complexity

## 7. HomeSynapse Code-Level Implications [M]

### 7.1 New records and enums in `core/device-model` (package `com.homesynapse.device`)

```java
// EntityCategory.java — REC-23 — public, no AMD
public enum EntityCategory { PRIMARY, CONFIG, DIAGNOSTIC }

// QuantityDimension.java — REC-24 — public
public enum QuantityDimension {
  TEMPERATURE, LENGTH, MASS, TIME, ELECTRIC_CURRENT,
  ENERGY, POWER, PRESSURE, VOLUME, FREQUENCY,
  LUMINOUS_INTENSITY, DIMENSIONLESS
}

// QuantityValue.java — REC-24 — public, AMD: AttributeValue.permits
public record QuantityValue(double value, String unitSymbol, QuantityDimension dimension)
    implements AttributeValue {
  public QuantityValue {
    if (unitSymbol == null || unitSymbol.isBlank())
      throw new IllegalArgumentException("unitSymbol must be non-blank");
    if (dimension == null) throw new IllegalArgumentException("dimension required");
  }
}

// ArrayValue.java — REC-27 — public, AMD: AttributeValue.permits
public record ArrayValue(List<AttributeValue> elements) implements AttributeValue {
  private static final int MAX_DEPTH = 4;
  public ArrayValue {
    elements = List.copyOf(elements);
    validateDepth(elements, 1);
  }
  private static void validateDepth(List<AttributeValue> es, int depth) {
    if (depth > MAX_DEPTH)
      throw new IllegalArgumentException("Array nesting > " + MAX_DEPTH);
    for (var e : es) if (e instanceof ArrayValue av) validateDepth(av.elements(), depth + 1);
  }
}

// SemanticTag.java — REC-26 — public
public record SemanticTag(String namespace, String value) {
  public static final String NS_MATTER_COMMON = "matter.common";
  public static final String NS_MATTER_DEVICE_PREFIX = "matter.device.";
  public static final String NS_HS_USER = "hs.user";
  public static final String NS_HS_SYSTEM = "hs.system";
  public SemanticTag {
    Objects.requireNonNull(namespace);
    Objects.requireNonNull(value);
    if (namespace.isBlank() || value.isBlank())
      throw new IllegalArgumentException("namespace and value must be non-blank");
  }
}

// DegradedAttributeValue.java — REC-29 fallback — package-private (visible only to PersistenceJacksonModule)
record DegradedAttributeValue(String originalTypeName, String rawJson) implements AttributeValue { }
```

### 7.2 Modified records

```java
// Entity.java — REC-23 (category) + REC-26 (tags) — public, AMD: consolidated
public record Entity(
    EntityId id,
    DeviceId deviceId,
    EntityType type,
    String name,
    Set<Capability> capabilities,
    List<SemanticTag> tags,         // was List<String> labels
    EntityCategory category,        // NEW — default PRIMARY at construction
    Instant registeredAt
) { ... }

// Device.java — REC-25 — public, AMD: none (additive)
public record Device(
    DeviceId id,
    String adapterId,
    String externalId,
    String name,
    boolean reachable,              // NEW; default true
    Instant registeredAt
) { ... }

// EntityState.java (core/state-store) — REC-23 — public, AMD: extends field count
public record EntityState(
    EntityId id,
    Map<String, AttributeValue> attributes,
    Position lastEventPosition,
    Instant lastUpdated,
    Instant staleAfter,
    String adapterId,
    Set<Capability> capabilities,
    EntityCategory category,        // NEW (10th field, before stale-derived)
    boolean stale                   // 11th field; still derived at read time
) { ... }
```

### 7.3 Sealed hierarchy permit clauses (`com.homesynapse.device`)

```java
// AttributeValue.java — REC-24 + REC-27 + REC-29 fallback
public sealed interface AttributeValue permits
    BoolValue, IntValue, LongValue, DoubleValue, StringValue,
    InstantValue, JsonValue,
    QuantityValue,            // NEW (REC-24)
    ArrayValue,               // NEW (REC-27)
    DegradedAttributeValue    // NEW fallback (REC-29) — package-private permit
{ }

// Capability.java — REC-30 — batch addition at M4.0
public sealed interface Capability permits
    // existing 15 (illustrative; exact list per current device-model)
    OnOff, Brightness, ColorTemperature, ColorXY, Position,
    BatteryLevel, Motion, Temperature, Humidity, Illuminance,
    Switch, Lock, /* ...remaining... */ CustomCapability,
    // NEW M4 batch (10)
    Thermostat, WindowCovering, DoorLock, MediaPlayer, EnergyMeasurement,
    WaterValve, Fan, AirQuality, OccupancySensor, ContactSensor
{ }
```

**Compile-time impact on downstream switches.** Every exhaustive `switch (AttributeValue v)` without a `default` branch breaks at REC-24/REC-27 land. Audit reveals these sites (approximate, by module):

- `core/state-store/AttributeValueSerializer.java` — switch on permit type for JSON formatting.
- `app/rest-api/AttributeValueDto.java` — switch for DTO mapping.
- `app/rest-api/AttributeValueDeserializer.java` — type-discriminator switch.
- `core/persistence/AttributeValueColumnExtractor.java` — switch for indexed-column extraction.
- `core/event-model/EventValidator.java` — value-shape validation.
- `core/device-model/AttributeValueFormatter.java` — toString-like rendering.

For `Capability`, exhaustive switches exist in:

- `app/rest-api/CapabilityDto.java`
- `core/state-store/CapabilityIndexer.java`
- `core/device-model/CapabilityValidator.java`
- Adapter modules: `integration/matter-adapter/CapabilityMapper.java`, `integration/zigbee-adapter/CapabilityMapper.java`, `integration/zwave-adapter/CapabilityMapper.java` — these are outside the inward dependency boundary but still must compile against the expanded `permits`.

REC-30's batch strategy means all these switch sites are updated in one PR cycle. Recommend introducing a `@SuppressWarnings("preview")` boundary marker on each switch and an explicit `default -> throw new IllegalStateException("Unhandled AttributeValue permit: " + v.getClass())` rather than relying on implicit exhaustiveness — this turns the next addition into a runtime error in unmodified code rather than a compile break in modified code, easing the next sealed expansion.

### 7.4 Event schema additions (`core/event-model`, package `com.homesynapse.event`)

```java
// EntityRegistered.java — REC-23 (modified) — public
public record EntityRegistered(
    EntityId entityId,
    DeviceId deviceId,
    EntityType type,
    String name,
    Set<Capability> capabilities,
    List<SemanticTag> tags,
    EntityCategory category,        // NEW; nullable for backward compat → PRIMARY
    Instant registeredAt
) implements EventPayload { ... }

// DeviceReachableChanged.java — REC-25 (NEW event) — public
public record DeviceReachableChanged(
    DeviceId deviceId,
    boolean reachable,
    Instant at
) implements EventPayload { ... }
```

Registry entries (`EventTypeRegistry.java`):

```java
register("entity_registered", EntityRegistered.class);
register("device_registered", DeviceRegistered.class);
register("state_changed", StateChanged.class);
register("attribute_changed", AttributeChanged.class);
register("device.reachable_changed", DeviceReachableChanged.class);  // NEW REC-25
register("capability.discovered", CapabilityDiscovered.class);       // NEW (general M4)
register("semantic_tag.applied", SemanticTagApplied.class);          // NEW (if event-modeled)
```

Type-name strings are **permanent** — once shipped, renaming requires an upcaster (REC-29). Note the snake/dot mixture: `entity_registered` (legacy from M3) is preserved verbatim; new event names use dot-separated namespacing (`device.reachable_changed`) for grouping clarity. This inconsistency is accepted as a backward-compat necessity; a future M5 migration could normalize but must use upcasters.

### 7.5 MODULE_CONTEXT impact

| Module | Gains types | Modifies types | New SPI providers / uses |
|---|---|---|---|
| `core/device-model` | `EntityCategory`, `QuantityValue`, `QuantityDimension`, `ArrayValue`, `SemanticTag`, 10 new `Capability` permits, `DegradedAttributeValue` (package-private) | `Entity`, `Device`, `AttributeValue` permits clause, `Capability` permits clause | — |
| `core/event-model` | `DeviceReachableChanged`, `CapabilityDiscovered`, `SemanticTagApplied` payloads | `EntityRegistered` payload | — |
| `core/state-store` | `ChainedProjectionAdvancer`, `ProjectionEventHandler` SPI, 7 handler classes under subpackage | `EntityState` (+1 field), `MinimalProjectionAdvancer` (deleted or renamed) | `provides ProjectionAdvancer`; declares `uses ProjectionEventHandler`; `provides` 7 handler implementations |
| `core/persistence` | `AttributeValueUpcaster` SPI, `LabelsToTagsUpcaster` | `PersistenceJacksonModule` (registers new permits) | Declares `uses AttributeValueUpcaster`; `provides LabelsToTagsUpcaster` |
| `app/rest-api` | `EntityCategoryFilter`, DTOs for new permits | All switch sites on `AttributeValue` and `Capability` | — |
| `integration/matter-adapter` | Mappers from Matter clusters → new Capability permits and SemanticTag namespaces | `CapabilityMapper.java` | — |
| `integration/zigbee-adapter` | Capability mappers for the new permits (where applicable) | `CapabilityMapper.java` | — |
| `integration/zwave-adapter` | Capability mappers for the new permits (where applicable) | `CapabilityMapper.java` | — |
| `platform-api` | — | — | — (inward dependency direction preserved) |

### 7.6 JPMS `module-info` impact

```java
// core/device-model/module-info.java — no structural change
module com.homesynapse.device {
  exports com.homesynapse.device;  // new types in flat package, no split-package violation
}

// core/event-model/module-info.java
module com.homesynapse.event {
  requires com.homesynapse.device;
  exports com.homesynapse.event;
}

// core/state-store/module-info.java — AMD REQUIRED (new package)
module com.homesynapse.statestore {
  requires com.homesynapse.device;
  requires com.homesynapse.event;
  requires com.homesynapse.persistence;
  exports com.homesynapse.statestore;
  exports com.homesynapse.statestore.handlers;          // NEW subpackage — deviates from one-flat-package invariant
  uses com.homesynapse.statestore.ProjectionEventHandler;  // NEW
  provides com.homesynapse.statestore.ProjectionEventHandler
    with com.homesynapse.statestore.handlers.EntityRegisteredHandler,
         com.homesynapse.statestore.handlers.StateChangedHandler,
         com.homesynapse.statestore.handlers.DeviceRegisteredHandler,
         com.homesynapse.statestore.handlers.AttributeChangedHandler,
         com.homesynapse.statestore.handlers.DeviceReachableChangedHandler,
         com.homesynapse.statestore.handlers.CapabilityDiscoveredHandler,
         com.homesynapse.statestore.handlers.SemanticTagAppliedHandler;
  provides com.homesynapse.statestore.ProjectionAdvancer
    with com.homesynapse.statestore.ChainedProjectionAdvancer;
}

// core/persistence/module-info.java
module com.homesynapse.persistence {
  requires com.fasterxml.jackson.databind;
  requires com.homesynapse.device;
  requires com.homesynapse.event;
  exports com.homesynapse.persistence;
  uses com.homesynapse.persistence.AttributeValueUpcaster;  // NEW
  provides com.homesynapse.persistence.AttributeValueUpcaster
    with com.homesynapse.persistence.LabelsToTagsUpcaster;
}
```

**`core/state-store` adds a SECOND package `com.homesynapse.statestore.handlers`.** This is a **deliberate, narrow deviation** from the "one flat package per module" rule because handlers must be public to be discoverable via `ServiceLoader` but should not pollute the main API surface. The deviation requires a formal AMD against the Phase 2 module invariants document. **AMD required: YES** for `core/state-store` only. All other modules retain one flat package each.

### 7.7 Migration considerations

- **V004 schema migration: NOT required.** All RECs (REC-23 through REC-30) are designed to be additive at the data layer. No new tables, no new columns on `events` (V001, 25 columns), no changes to `dead_letters` (V002), no changes to `snapshots` (V003).
- **Projection rebuild required: YES, for REC-23 and REC-26.** Adding `EntityCategory category` to `EntityState` and migrating `labels` → `tags` means existing projection rows are missing a field or carry a stale field. The projection must be rebuilt from the events table on first M4 startup; the `MinimalProjectionAdvancer` (and its replacement `ChainedProjectionAdvancer`) supports this via the existing `fromPosition=0` parameter. Recommend a startup-time check: if `EntityState.schema_version < M4_SCHEMA_VERSION`, trigger a full rebuild and persist the new version stamp.
- **Event upcasting: REQUIRED for REC-26.** The `LabelsToTagsUpcaster` runs during deserialization of pre-M4 `EntityRegistered` events. Without it, those events fail to deserialize and become `DegradedEvent`s, breaking the projection rebuild. **REC-29 MUST land in the same release as REC-26.**
- **Adapter version compatibility:** Adapters emitting capabilities from the ten new permits (REC-30) require Matter adapter 2.0+ and (for Zigbee/Z-Wave equivalents) the relevant CapabilityMapper updates. Adapters at M3 versions continue to emit only the original 15 permits — no break, since the new permits are purely additive in the permits-clause sense.
- **API versioning:** REST DTOs for new permits constitute an additive change to `/api/v1/entities`; existing clients that ignore unknown JSON fields are unaffected. Strict clients (with schema validation) must update to a new minor OpenAPI version (v1.1 of the schema, NOT v2.0).
- **AMD inventory for M4.0:**
  - **REC-23, REC-26:** AMD against `Entity` record signature (1 amendment, consolidated).
  - **REC-24, REC-27, REC-29 (DegradedAttributeValue):** AMD against `AttributeValue.permits` clause (1 amendment, batched).
  - **REC-30:** AMD against `Capability.permits` clause (1 amendment, batched).
  - **REC-28:** AMD against the "one flat package per module" invariant for `core/state-store` only.
  - **REC-25, REC-29 (SPI):** No AMD — purely additive new types and SPIs.
  - **Total AMDs for M4.0: 4** — all ratified at the architecture council meeting that approves M4.0 release.
- **OR-M3-17 (NO_OP_DERIVATION) interaction:** REC-28's `ChainedProjectionAdvancer` is the natural home for derived events (the M4 scope item flagged by OR-M3-17 as open through M3.7). Each derived event becomes a `ProjectionEventHandler` implementation whose `apply()` reads other state and writes derived state. The `Function.identity()` placeholder from M3.7 is replaced by handler-specific derivation functions on a per-event-type basis. **OR-M3-17 closes naturally with REC-28's implementation; no separate REC is required.**
- **Phase 2 interface adherence:** All new SPIs (`ProjectionEventHandler`, `AttributeValueUpcaster`) follow the inward-only dependency rule: declared in `core/*` modules, consumed by `core/*` or `app/*`, never reversed. No new `platform-api` types. No reflective access across module boundaries (ServiceLoader uses module-info `provides`/`uses`, which is JPMS-compliant).
- **Testing strategy:** Each REC includes a unit-test budget (see "Effort" lines in §4). For REC-28 specifically, recommend adding a contract-test suite that asserts the `ChainedProjectionAdvancer` satisfies the bounded-window contract (≤500 rows per `advance()` call, ≤2 s read transaction) under a synthetic load of 10 k events of mixed types. This contract test should be a first-class CI gate.
- **Rollback plan:** If REC-26 (labels→tags migration) causes unexpected projection failures in production, the rollback is to revert REC-29's `LabelsToTagsUpcaster` and accept that pre-M4 events deserialize as `DegradedEvent` (per LTD-19); the projection then carries empty `tags` for pre-M4 entities, which is degraded but non-fatal. For REC-24/REC-27 (new AttributeValue permits), rollback means reverting the `permits` clause additions; no stored events reference the new permits yet, so rollback is clean. For REC-30 (Capability expansion), rollback is more disruptive because adapter modules and switch sites have been updated; a fast-forward-only policy is recommended once the M4.0 commit lands.
- **Documentation:** Each new public type requires a Javadoc paragraph at minimum, with `@since M4.0` tags. The `event-model/package-info.java` should be updated to document the full-replacement semantics of `ArrayValue` in `attribute_changed` (per REC-27 §4 change description). The Phase 2 interface contracts document should be amended to reflect the four AMDs listed above.