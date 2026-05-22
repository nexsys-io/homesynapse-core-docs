# AMD-44: Floor Aggregate, EntityRole Enum, and Set\<HardwareIdentifier\> Refactor

**Status:** RATIFIED (pending implementation)
**Affects:** Doc 02 — Device Model & Capability System (§3.2, §3.3, §3.10, §3.12, §4.1, §4.2, §8.1, §11.2); Doc 09 — REST API; Doc 10 — WebSocket API; Doc 07 — Automation Engine; Doc 13 — Web UI
**Classification:** CONTRACT-LEVEL
**Date:** 2026-05-22
**Staged implementation:** Stage 1 (Floor + Set\<HardwareIdentifier\> + minimal Area record), Stage 2 (EntityRole)

---

## 1. Problem Statement

Three deficiencies in the current device model motivate this amendment.

**1.1 — No spatial hierarchy above Area.** HomeSynapse's spatial model is flat: devices and entities reference an `AreaId`, but there is no container that groups areas into floors. Users with multi-story homes cannot express "all lights on the ground floor" as a single selector. Home Assistant added `FloorRegistry` in its 2024.4 release to solve this exact problem. OpenHAB supports nested `Location` items but this produced documented UI bugs (openhab-webui#1397). HomeSynapse has neither mechanism. The `AreaId` Javadoc currently reads "a spatial area (room, zone, or floor)" — the "or floor" phrasing conflates two distinct levels of the hierarchy and must be corrected.

**1.2 — No UX-role classification for entities.** A kitchen smart plug may expose seven entities: the outlet itself (user-facing), voltage and RSSI sensors (infrastructure health), and a power-on-behavior switch (configuration). HomeSynapse currently treats all seven identically in the UI, automation selectors, and voice-assistant integration. Home Assistant's `EntityCategory` enum (`diagnostic`, `config`) solves this. Matter's specification separates utility clusters from application clusters for the same purpose. HomeSynapse has no equivalent — the `EntityType` enum classifies data shape and write semantics, but not UX role.

**1.3 — `List<HardwareIdentifier>` permits semantic duplicates.** `Device.hardwareIdentifiers` and `ProposedDevice.hardwareIdentifiers` are typed as `List<HardwareIdentifier>`. `HardwareIdentifier` is a value record — `(String namespace, String value)` — where duplicates are semantically meaningless. The discovery pipeline's matching algorithm silently deduplicates, masking data-quality issues at the adapter layer. The correct collection type is `Set`.

---

## 2. Specification

### 2.1 Floor Aggregate

#### 2.1.1 FloorId

A new typed ULID wrapper in `com.homesynapse.platform.identity`, following the established pattern of `DeviceId`, `EntityId`, `AreaId`:

```java
public record FloorId(Ulid value) implements Comparable<FloorId> {
    public FloorId { Objects.requireNonNull(value, "FloorId value must not be null"); }
    public static FloorId of(Ulid value) { return new FloorId(value); }
    public static FloorId parse(String crockford) { return new FloorId(Ulid.parse(crockford)); }
    @Override public int compareTo(FloorId other) { return value.compareTo(other.value); }
    @Override public String toString() { return value.toString(); }
}
```

Storage: `BLOB(16)` in SQLite per LTD-04.

#### 2.1.2 Floor Record

**(Decision 7)** The aggregate record lives in `com.homesynapse.device`:

```java
public record Floor(
    FloorId id,          // never null
    String name,         // non-blank, <= 100 chars
    int level,           // signed integer: -1 = basement, 0 = ground, 1 = first, etc.
    String icon,         // nullable — MDI icon name, e.g. "mdi:home-floor-g"
    List<String> aliases, // voice-assistant synonyms, unmodifiable via List.copyOf()
    Instant createdAt    // never null
) {
    /* Compact constructor validates: non-null id, name, createdAt;
       name non-blank and <= 100 chars; aliases = List.copyOf(aliases) */
}
```

Design notes:

- `icon` is nullable `String`, not `Optional<String>`. The JDK team discourages `Optional` as a record field; Jackson serialization of `Optional` record fields introduces friction with no compensating benefit. **(Decision 7)**
- `createdAt` is present for consistency with `Device` and `Entity` aggregate records. **(Decision 7)**
- `aliases` is defensively copied via `List.copyOf()` in the compact constructor, matching the project's existing immutability convention for collection-typed record fields. **(Decision 7)**
- No uniqueness constraint on `level`. Split-level homes (two wings at the same grade) legitimately produce duplicate level values. **(Decision 8)**

#### 2.1.3 FloorRegistry Interface

```java
public interface FloorRegistry {
    Floor create(String name, int level, String icon, List<String> aliases);
    Optional<Floor> get(FloorId id);
    Collection<Floor> getAll();        // sorted by level ASC, name ASC, createdAt ASC
    Collection<Floor> getByLevel(int level);
    Floor update(FloorId id, String name, int level, String icon, List<String> aliases);
    void delete(FloorId id);           // throws if areas are still assigned (see §3 DELETE cascade)
}
```

**(Decision 8)** `getAll()` returns floors sorted by `level ASC, name ASC, createdAt ASC`. The primary sort by `level` gives a natural spatial ordering (basement → ground → upper). The secondary sort by `name` is deterministic and user-explicable for the split-level case. Tertiary sort by `createdAt` covers the unlikely equal-level-and-name scenario.

#### 2.1.4 AreaId Javadoc Cleanup

The current `AreaId` Javadoc reads: "Typed identifier for a spatial area (room, zone, or floor) within a home." Post-amendment, the "(room, zone, or floor)" parenthetical must be corrected to "(room, zone, or other user-defined spatial grouping)" to reflect the separation of Floor as its own aggregate. **(Decision 5 — Floor and Area are distinct hierarchy levels.)**

### 2.2 Area Record (Minimal)

**(Decision 14)** `Area` does not currently exist as a Java record anywhere in the codebase. Only `AreaId` exists as a ULID wrapper. The `Area.floorId` field is structurally impossible without an `Area` record. Stage 1 introduces a minimal `Area` record and read-only `AreaRegistry`:

```java
public record Area(
    AreaId id,           // never null
    String name,         // non-blank, <= 100 chars
    FloorId floorId,     // nullable — null means unassigned to any floor
    Instant createdAt    // never null
) {
    /* Compact constructor validates: non-null id, name, createdAt;
       name non-blank and <= 100 chars */
}
```

```java
public interface AreaRegistry {
    Optional<Area> get(AreaId id);
    Collection<Area> getAll();
    Collection<Area> getByFloor(FloorId floorId);
    Collection<Area> getUnassigned();   // floorId == null
}
```

The `AreaRegistry` is **read-only for Stage 1**. Full Area lifecycle (create, update, delete events, REST CRUD, WebSocket subscription support, migration from inline `area_id` references) is tracked as AMD-45 (deferred — see §6).

**First-boot behavior for existing `area_id` references:** When the system initializes against a datastore containing `area_id` foreign keys on `Device` and `Entity` records but no corresponding `Area` records, Stage 1 creates synthetic `Area` records with `name = "Area " + ULID.substring(0, 8)`, `floorId = null`, and `createdAt = Instant.now(clock)`. These synthetic areas are flagged for user rename in the UI. **(Decision 14)**

### 2.3 Floor-Area Relationship

**(Decision 5)** The relationship between Floor and Area is **1:N with nullable floorId**. An Area belongs to at most one Floor. There is no M:N relationship. This design was debated and settled with reference to HA architecture discussion #1021 (January 2024), where the M:N case (area spanning multiple floors — open staircase, mezzanine) was raised and rejected. Paulus Schoutsen argued that merging area and floor concepts forces conditional checks throughout the codebase. Frenck noted that nested areas (OpenHAB's approach) produce messy situations. OpenHAB's nested-Location model produced documented UI bugs (openhab-webui#1397).

**Migration semantics:** Existing areas receive `floorId = null`. No synthetic "Unassigned" floor is materialized in the registry. The UI renders an "Unassigned Areas" pseudo-bucket client-side, matching HA's 2024.4 approach. **(Decision 5)**

Floor-area assignment and unassignment are explicit operations that produce their own events (see §2.4).

### 2.4 Floor Events

**(Decision 6)** Five event types are added to the Doc 02 event taxonomy (§11.2). These are string event types with JSON payloads — not typed Java event records at this stage. Typed event records will be added when the device-model module enters Phase 3 event implementation.

**`floor_created`**
```json
{
  "eventType": "floor_created",
  "floorId": "<ULID>",
  "name": "Ground Floor",
  "level": 0,
  "icon": "mdi:home-floor-g",
  "aliases": ["ground", "main level"],
  "createdAt": "2026-05-22T10:00:00Z"
}
```

**`floor_deleted`**
```json
{
  "eventType": "floor_deleted",
  "floorId": "<ULID>"
}
```

When `floor_deleted` is triggered via `DELETE /api/v1/floors/{floorId}?force=true` with areas still assigned, individual `area_floor_unassigned` events are emitted for each affected area **before** the `floor_deleted` event. Subscribers watching for area-floor changes must process the unassignments before the floor ceases to exist in the registry. Without `?force=true`, the delete is rejected with `409 Conflict` and no events are emitted (see §3, Decision 11).

**`floor_updated`**
```json
{
  "eventType": "floor_updated",
  "floorId": "<ULID>",
  "changes": {
    "name": { "old": "Ground", "new": "Ground Floor" },
    "level": { "old": 1, "new": 0 }
  }
}
```

The `floor_updated` event carries arbitrary diffs via a `Map<String, Change>` payload structure, matching the project precedent established by `entity_profile_changed` and `device_metadata_changed`. Only changed fields appear in the `changes` map. **(Decision 6)**

**`area_floor_assigned`**
```json
{
  "eventType": "area_floor_assigned",
  "areaId": "<ULID>",
  "floorId": "<ULID>"
}
```

**`area_floor_unassigned`**
```json
{
  "eventType": "area_floor_unassigned",
  "areaId": "<ULID>",
  "previousFloorId": "<ULID>"
}
```

Moving an area from Floor A to Floor B emits `area_floor_unassigned` (with `previousFloorId = A`) followed by `area_floor_assigned` (with `floorId = B`). This two-event approach matches the project's convention for assignment changes and preserves auditability.

### 2.5 EntityRole Enum

**(Decision 2)** A new enum in `com.homesynapse.device` with exactly three values:

```java
public enum EntityRole {
    /** The entity's value is what the user installed the device to observe or control. */
    PRIMARY,

    /** The entity reports on the device's own health or infrastructure status. */
    DIAGNOSTIC,

    /** The entity controls a device configuration parameter (e.g., polling interval, power-on behavior). */
    CONFIG
}
```

Three values only — PRIMARY, DIAGNOSTIC, CONFIG. No SYSTEM value. HA deliberately scrubbed `SYSTEM` from its `EntityCategory` enum before the 2021.11 release. Frenck (HA lead) stated that `system` was for internal use inside Home Assistant and should not be used by integrations. HA PR home-assistant/core#60277 cleaned up a stray `system` usage. HA uses orthogonal `entity_registry_enabled_default` / `entity_registry_visible_default` flags instead — HomeSynapse already exposes the `Entity.enabled` equivalent, with future `visibleByDefault` support planned. **(Decision 2)**

#### 2.5.1 Constraint Matrix on EntityType

**(Decision 4)** The legality constraint matrix is encoded directly on the `EntityType` enum, not in an external class. Adding a new `EntityType` value forces the compiler to declare its legal roles — the constraint cannot be forgotten.

```java
public enum EntityType {
    LIGHT(EnumSet.of(PRIMARY, DIAGNOSTIC)),
    SWITCH(EnumSet.of(PRIMARY, DIAGNOSTIC, CONFIG)),
    BINARY_SENSOR(EnumSet.of(PRIMARY, DIAGNOSTIC)),
    SENSOR(EnumSet.of(PRIMARY, DIAGNOSTIC)),
    PLUG(EnumSet.of(PRIMARY)),
    ENERGY_METER(EnumSet.of(PRIMARY, DIAGNOSTIC));

    private final Set<EntityRole> legalRoles;

    EntityType(Set<EntityRole> legalRoles) {
        this.legalRoles = legalRoles;
    }

    public boolean allows(EntityRole role) {
        return legalRoles.contains(role);
    }
}
```

Full constraint matrix:

| EntityType | PRIMARY | DIAGNOSTIC | CONFIG |
|---|---|---|---|
| LIGHT | yes | yes | no |
| SWITCH | yes | yes | yes |
| BINARY_SENSOR | yes | yes | no |
| SENSOR | yes | yes | no |
| PLUG | yes | no | no |
| ENERGY_METER | yes | yes | no |

**(Decision 3)** LIGHT permits DIAGNOSTIC because status-indicator LEDs are real entities. Pairing-status LEDs on Zigbee bridges, network-link LEDs on coordinators, and Wi-Fi-signal LEDs on cameras are all LIGHT entities with OnOff capability that are genuinely diagnostic in nature.

Enforcement is hard: `EntityType.allows(role)` returning `false` triggers rejection at adoption time and at reclassification time. There is no soft-fail or override mechanism.

#### 2.5.2 Mutability and Reclassification

**(Decision 1)** EntityRole is mutable post-adoption. Reclassification flows through the existing `entity_profile_changed` event, extended with `oldRole` and `newRole` fields:

```json
{
  "eventType": "entity_profile_changed",
  "entityId": "<ULID>",
  "changes": {
    "entityRole": { "old": "DIAGNOSTIC", "new": "PRIMARY" }
  },
  "oldRole": "DIAGNOSTIC",
  "newRole": "PRIMARY"
}
```

`EntityId` is preserved through reclassification per INV-CS-02 ("Entity identifiers are stable. EntityId survives device replacement, area reassignment, and capability changes"). The `(adapter, deviceId, channelKey)` natural key anchors identity continuity through role changes.

The legality matrix is validated on role transition: `EntityType.allows(newRole)` must return `true`, otherwise the reclassification is rejected. This is the same validation applied at adoption time.

Rationale for mutability: forcing re-adoption to reclassify would break automations, statistics, WebSocket subscriptions, and event-log historical queries — the exact pain that HA's architecture discussion #1088 documented.

#### 2.5.3 Discovery and Adoption Defaults

`ProposedEntity` gains an `entityRole` field:

```java
public record ProposedEntity(
    int endpointIndex,
    EntityType proposedEntityType,
    List<String> proposedCapabilities,
    EntityRole entityRole              // default PRIMARY if unset by adapter
) { }
```

If an adapter does not set `entityRole`, the default is `PRIMARY`. Adapters that expose diagnostic or configuration entities must explicitly declare the role. The constraint matrix (`EntityType.allows(role)`) is validated at adoption time — an illegal combination is rejected by the discovery pipeline.

The `Entity` record gains an `entityRole` field (Stage 2):

```java
public record Entity(
    EntityId entityId,
    String entitySlug,
    EntityType entityType,
    String displayName,
    DeviceId deviceId,
    int endpointIndex,
    AreaId areaId,
    boolean enabled,
    List<String> labels,
    List<CapabilityInstance> capabilities,
    EntityRole entityRole,             // never null; default PRIMARY
    Instant createdAt
) { }
```

#### 2.5.4 Coordinator-State Classification Convention

**(Decision 9)** The default EntityRole for coordinator-state entities (USB stick status, connected-device counts, permit-join buttons) is DIAGNOSTIC. The convention is: "if the entity's value is what the user installed the device to observe or control, it is PRIMARY; if it is about the device's own health or infrastructure status, it is DIAGNOSTIC."

Adapter authors for standalone-gateway products (e.g., a Zigbee gateway that is itself the user's primary interest) may declare coordinator-state entities as PRIMARY. The constraint matrix permits both — `SENSOR` allows `{PRIMARY, DIAGNOSTIC}`. This is documented as a footnote in the integration-author guide section of the relevant design document.

### 2.6 Set\<HardwareIdentifier\> Refactor

The following type changes convert `List<HardwareIdentifier>` to `Set<HardwareIdentifier>` across the device-model API surface:

**Device record:**
```java
// Before: List<HardwareIdentifier> hardwareIdentifiers
// After:
Set<HardwareIdentifier> hardwareIdentifiers  // unmodifiable via Set.copyOf()
```

**ProposedDevice record:**
```java
// Before: List<HardwareIdentifier> hardwareIdentifiers
// After:
Set<HardwareIdentifier> hardwareIdentifiers  // unmodifiable via Set.copyOf()
```

**DiscoveryPipeline interface:**
```java
// Before: propose(List<HardwareIdentifier> identifiers, ...)
// After:
ProposedDevice propose(Set<HardwareIdentifier> identifiers, String manufacturer, String model, List<ProposedEntity> entities);

// Before: findExistingDevice(List<HardwareIdentifier> identifiers)
// After:
Optional<Device> findExistingDevice(Set<HardwareIdentifier> identifiers);
```

`HardwareIdentifier` is a value record — `(String namespace, String value)` — with correct `equals`/`hashCode` semantics inherited from the record. `Set` is the semantically correct collection type: hardware identifiers are unique per device, and insertion order is meaningless.

**Blast-radius survey checklist** (the implementing engineer runs this before the PR):

1. `grep -rn "List<HardwareIdentifier>" --include="*.java"` — every hit must be evaluated for conversion
2. `grep -rn "hardwareIdentifiers" --include="*.java"` — verify all call sites pass `Set` or are updated
3. Check test fixtures and builders for `List.of(new HardwareIdentifier(...))` patterns — convert to `Set.of(...)`
4. Verify Jackson deserialization: `Set<HardwareIdentifier>` deserializes from JSON arrays identically to `List` (Jackson handles this natively for value records)
5. Check `DiscoveryPipeline` implementations and test doubles for parameter type mismatches

---

## 3. Downstream Impact

**Doc 09 — REST API:**

- New resource: `GET /api/v1/floors` — returns all floors, sorted per Decision 8
- New resource: `POST /api/v1/floors` — creates a floor
- New resource: `GET /api/v1/floors/{floorId}` — returns a single floor
- New resource: `PUT /api/v1/floors/{floorId}` — updates a floor
- New resource: `DELETE /api/v1/floors/{floorId}` — deletes a floor with cascade protection **(Decision 11)**: returns `409 Conflict` if any Area has `floorId == thisFloorId`, unless `?force=true` is present. The 409 response body includes `affectedAreaIds` so the caller can display which areas will be unassigned. This establishes the convention for future cascade-delete endpoints.
- New resource: `PUT /api/v1/areas/{areaId}/floor` — assigns an area to a floor
- New resource: `DELETE /api/v1/areas/{areaId}/floor` — unassigns an area from its floor
- Modified: `GET /api/v1/entities` gains `?floorId=` query parameter for floor-based filtering
- Stage 2: Entity responses include `entityRole` field; `?entityRole=` filter parameter

**Doc 10 — WebSocket API:**

- **(Decision 10)** `floorId` subscription filter semantics: `"floorId": null` in a subscription filter subscribes to entities with no floor assignment (the Unassigned bucket). Absence of `floorId` from the filter means no floor-based filtering (subscribe to all). This matches the existing `areaId` filter behavior pattern.
- Stage 2: `entityRole` subscription filter with the same null/absent semantics

**Doc 07 — Automation Engine:**

- `EntitySelector` gains a `floor(FloorId)` factory/constructor for floor-scoped automation rules (e.g., "all lights on the ground floor")
- Stage 2: `EntitySelector` gains `role(EntityRole)` for role-scoped selectors (e.g., "all diagnostic entities")

**Doc 13 — Web UI:**

- Floor-based navigation in the spatial hierarchy
- Unassigned Areas rendered as a client-side pseudo-bucket (no synthetic floor in the registry)
- Stage 2: EntityRole-based filtering and grouping in entity lists; diagnostic/config entities de-emphasized or collapsed by default

**Doc 05 — Integration API:**

- No change. Adapters do not interact with Floors or Areas at the integration-API level. Stage 2: adapters declare `EntityRole` via `ProposedEntity` but this is a device-model concern, not an integration-API contract change.

**Entity record (Stage 2):**

- Gains `EntityRole entityRole` field (never null, default PRIMARY)

**EntityType enum (Stage 2):**

- Gains `Set<EntityRole> legalRoles` constructor parameter and `allows(EntityRole)` method **(Decision 4)**

**`entity_profile_changed` event (Stage 2):**

- Gains `oldRole` / `newRole` payload fields for reclassification **(Decision 1)**

---

## 4. Implementation Notes

### 4.1 Staging

**(Decision 12)** Implementation is split into two stages reflecting different blast radii:

**Stage 1 — Floor + Set\<HardwareIdentifier\> + Minimal Area:**

- `FloorId` typed wrapper in `com.homesynapse.platform.identity`
- `Floor` record in `com.homesynapse.device`
- `FloorRegistry` interface in `com.homesynapse.device`
- `Area` record in `com.homesynapse.device` **(Decision 14)**
- `AreaRegistry` interface in `com.homesynapse.device` (read-only) **(Decision 14)**
- `AreaId` Javadoc cleanup (remove "or floor") **(Decision 5)**
- Five floor event types added to the event taxonomy **(Decision 6)**
- `Device.hardwareIdentifiers`: `List` to `Set`
- `ProposedDevice.hardwareIdentifiers`: `List` to `Set`
- `DiscoveryPipeline` parameter types: `List` to `Set`
- First-boot synthetic Area creation for existing `area_id` references **(Decision 14)**

Stage 1 is a mechanical refactor (Set\<HI\>) plus new types with no existing consumers. The blast radius is limited to the device-model module and its direct dependents.

**Stage 2 — EntityRole:**

- `EntityRole` enum in `com.homesynapse.device` **(Decision 2)**
- `EntityType` enum gains `Set<EntityRole> legalRoles` constructor **(Decision 4)**
- `ProposedEntity` gains `entityRole` field
- `Entity` gains `entityRole` field
- `entity_profile_changed` event extended with `oldRole`/`newRole` **(Decision 1)**
- Adapter-author coordination: every adapter must declare PRIMARY/DIAGNOSTIC/CONFIG for every entity it proposes

The Stage 2 split exists because EntityRole requires coordination with every integration adapter author. Each adapter must classify its entities before the feature can be considered complete.

### 4.2 Module and Package Placement

All new device-model types (`Floor`, `Area`, `EntityRole`, modified `EntityType`, `AreaRegistry`, `FloorRegistry`) live in `com.homesynapse.device`. `FloorId` lives in `com.homesynapse.platform.identity`. Both packages are already exported in their respective `module-info.java` files. No `module-info.java` changes are needed for any addition in this amendment.

### 4.3 Event Model Integration

Floor lifecycle events and the `entity_profile_changed` extension are string event types in the event taxonomy (Doc 01 §4.3, Doc 02 §11.2). They are not typed Java event records at this stage. Typed event records will be added when the device-model module receives its Phase 3 event implementations. This amendment specifies event-type strings and JSON payload schemas, not Java record definitions.

### 4.4 Set\<HardwareIdentifier\> Blast-Radius Survey

Before opening the Stage 1 PR, the implementing engineer must run the blast-radius survey checklist from §2.6. The grep patterns target every `List<HardwareIdentifier>` usage and every `hardwareIdentifiers` reference across the codebase. Jackson deserialization of `Set` from JSON arrays works natively for value records, but test fixtures using `List.of(...)` must be updated to `Set.of(...)`.

### 4.5 Performance Considerations

**REPLAY-mode cost for Floor:** Floor-area assignment changes produce `area_floor_assigned` / `area_floor_unassigned` events. During event replay, `EntitySelector.floor(floorId)` invalidations are O(|area-floor-assignment events|). At typical home sizes (3-5 floors, 10-30 areas, lifetime area-floor changes in the tens), this is sub-50ms on Pi 4 hardware.

**Constrained-hardware heap cost (Pi 4, 500 entities):** The total heap cost of this amendment is bounded. Floor records: ~5 records * ~200 bytes = ~1 KB. Area records: ~30 records * ~100 bytes = ~3 KB. EntityRole field on Entity: 4 bytes * 500 entities = ~2 KB. Total amendment heap cost < 10 KB — negligible relative to the existing device-model footprint.

---

## 5. Decision Rationale

**Floor as a distinct aggregate (Decisions 5, 7, 8):** Home Assistant's 2024.4 release introduced `FloorRegistry` with the same 1:N Floor-Area model after extensive debate in architecture discussion #1021. The alternative — M:N relationships or nested areas — was rejected by HA's architecture team. OpenHAB's nested-Location approach produced documented UI bugs (openhab-webui#1397). HomeSynapse adopts HA's proven model: a flat Floor aggregate with nullable `floorId` on Area, no synthetic "Unassigned" floor, and a client-side pseudo-bucket for UI rendering.

**EntityRole as a three-value enum (Decisions 1, 2, 3, 4, 9):** Home Assistant's `EntityCategory` enum provides the direct precedent. The SYSTEM value was deliberately removed before HA's 2021.11 release (PR #60277) because it conflated internal platform concerns with integration-visible classification. HomeSynapse's `Entity.enabled` field (and future `visibleByDefault`) covers the visibility semantics that SYSTEM would have implied. The constraint matrix on `EntityType` ensures compile-time completeness — every new entity type must declare its legal roles. Mutability post-adoption (via `entity_profile_changed`) preserves EntityId stability per INV-CS-02 and avoids the re-adoption pain documented in HA architecture discussion #1088.

**Set\<HardwareIdentifier\> over List:** This is a straightforward semantic correction. `HardwareIdentifier` is a value record with correct `equals`/`hashCode`. Duplicates are meaningless. The `List` type permitted a class of silent data-quality bugs that `Set` eliminates at the type level.

**Staging rationale (Decision 12):** Stage 1 (Floor + Set\<HI\> + minimal Area) is a self-contained structural change with no adapter-author coordination required. Stage 2 (EntityRole) requires every adapter author to classify every entity, making it a higher-coordination release. Splitting them reduces risk and allows Stage 1 to ship independently.

**EntityPointRole explicitly struck (Decision 13):** The combination of `EntityType` (data shape + write semantics) and `Capability` (domain) already covers the semantic space that OpenHAB's POINT axis (Measurement/Setpoint/Control) encodes. Adding a third orthogonal axis would increase adapter-author burden with no demonstrated user-facing benefit.

---

## 6. Deferred Work

**AMD-45: Area Aggregate Maturation** — Area currently has no lifecycle events, no REST CRUD surface, no WebSocket subscription support, and no formal migration path from inline `area_id` references. Stage 1 of this amendment introduces a minimal `Area` record and read-only `AreaRegistry` sufficient to support `Area.floorId`. AMD-45 will deliver:

- Area lifecycle events (`area_created`, `area_deleted`, `area_updated`)
- REST CRUD on `/api/v1/areas`
- WebSocket subscription support for area events
- Migration from inline `area_id` references on `Device` and `Entity` to `AreaRegistry`-backed lookups
- Full `AreaRegistry` with write operations (`create`, `update`, `delete`)

**EntityPointRole is NOT deferred — it is struck.** `EntityType + Capability` covers the semantic space. There is no speculative parking spot in the decision register. **(Decision 13)**

**HA reclassification history survey:** A post-Stage-1 calibration exercise to review Home Assistant's reclassification patterns across major integrations. This informs adapter-author documentation for Stage 2 but is not a decision gate — the constraint matrix and reclassification mechanism are locked.

---

## 7. Invariant and Locked Decision Citations

| Citation | Relevance to AMD-44 |
|---|---|
| INV-CS-02 | EntityId stability through EntityRole reclassification — identity is preserved, only the role classification changes **(Decision 1)** |
| INV-CE-04 | Protocol agnosticism — Floor and Area are protocol-independent spatial containers, not tied to any integration protocol |
| LTD-04 | FloorId uses ULID, stored as BLOB(16) in SQLite, following the typed wrapper pattern established by DeviceId, EntityId, AreaId |
| LTD-11 | AreaRegistry and FloorRegistry implementations use ReentrantLock, not synchronized, per the project's concurrency convention |
| Doc 02 §3.2 | Device.areaId — currently a free-floating ULID reference; post-AMD-44, references an Area in the AreaRegistry |
| Doc 02 §3.3 | Entity.areaId — overridable from Device; post-AMD-44, also references the AreaRegistry |
| Doc 02 §3.10 | EntityType enum — modified by this amendment to carry `Set<EntityRole> legalRoles` and `allows(EntityRole)` **(Decision 4)** |
| Doc 02 §3.12 | ProposedEntity and ProposedDevice — ProposedEntity gains `entityRole`; both Proposed records' `hardwareIdentifiers` change from List to Set |
| Doc 02 §4.1 | Device record — `hardwareIdentifiers` changes from `List` to `Set` |
| Doc 02 §4.2 | Entity record — gains `entityRole` field (Stage 2) |
| Doc 02 §8.1 | DiscoveryPipeline — parameter types change from `List<HardwareIdentifier>` to `Set<HardwareIdentifier>` |
| Doc 02 §11.2 | Event taxonomy — gains 5 floor lifecycle events + `entity_profile_changed` extension with `oldRole`/`newRole` |
| Doc 09 | REST API gains `/floors` endpoints with DELETE cascade protection **(Decision 11)** |
| Doc 10 | WebSocket API gains `floorId` subscription filter **(Decision 10)** |
| AMD-41 | State projection execution model — EntityRole reclassification events must be projected correctly |
| AMD-42 | Subscriber lifecycle — floor events are delivered through the standard subscriber mechanism |
| AMD-43 | Backpressure and observability — floor events contribute to writer queue depth metrics |

---

## Appendix A: Worked Examples

### Worked Example 1: Three-Story House with Floor Aggregate

```
Floor: Basement       (level = -1)
  Area: Laundry
    Device: ZigbeeBulb-LDR1 → Entity{LIGHT, PRIMARY}
    Device: SmartPlug-LP07  → Entity{PLUG, PRIMARY}, Entity{ENERGY_METER, PRIMARY}

Floor: Ground         (level = 0)
  Area: Kitchen
    3× Entity{LIGHT, PRIMARY}, 2× Entity{SENSOR, PRIMARY}
  Area: Living Room
    4× Entity{LIGHT, PRIMARY}, 1× Entity{MEDIA_PLAYER, PRIMARY}

Floor: First          (level = 1)
  Area: Bedroom 1
    2× Entity{LIGHT, PRIMARY}
  Area: Bedroom 2
    1× Entity{LIGHT, PRIMARY}
  Area: Bathroom
    1× Entity{LIGHT, PRIMARY}, 1× Entity{BINARY_SENSOR, PRIMARY}

Area: Stairwell       (floorId = null)
  Device: StaircaseLight → Entity{LIGHT, PRIMARY}
```

Edge case: the staircase fixture spans multiple floors physically. Three valid user choices exist: `floorId = null` (Unassigned — rendered in the UI pseudo-bucket), `floorId = Ground`, or `floorId = First`. The platform takes no opinion on which assignment is correct. The 1:N model means the user picks one or none. **(Decision 5)**

### Worked Example 2: Zigbee Device with EntityRole Classification

**Kitchen smart plug (TS011F):**

| Entity slug | EntityType | EntityRole | enabledByDefault |
|---|---|---|---|
| `plug.kitchen_outlet` | PLUG | PRIMARY | true |
| `sensor.kitchen_outlet_power` | ENERGY_METER | PRIMARY | true |
| `sensor.kitchen_outlet_energy` | ENERGY_METER | PRIMARY | true |
| `sensor.kitchen_outlet_voltage` | SENSOR | DIAGNOSTIC | false |
| `sensor.kitchen_outlet_rssi` | SENSOR | DIAGNOSTIC | false |
| `sensor.kitchen_outlet_lqi` | SENSOR | DIAGNOSTIC | false |
| `switch.kitchen_outlet_power_on_behavior` | SWITCH | CONFIG | true |

Note: `PLUG` only permits `{PRIMARY}` per the constraint matrix. `SENSOR` permits `{PRIMARY, DIAGNOSTIC}`. `SWITCH` permits `{PRIMARY, DIAGNOSTIC, CONFIG}`. Every row in this table is valid against the matrix.

**Battery-powered motion sensor:**

| Entity slug | EntityType | EntityRole | enabledByDefault |
|---|---|---|---|
| `binary_sensor.br1_motion` | BINARY_SENSOR | PRIMARY | true |
| `sensor.br1_motion_battery` | SENSOR | DIAGNOSTIC | true |
| `sensor.br1_motion_battery_voltage` | SENSOR | DIAGNOSTIC | false |
| `sensor.br1_motion_lqi` | SENSOR | DIAGNOSTIC | false |

Note: `number.br1_motion_occupancy_timeout` (CONFIG) is listed in the brief's worked example as EntityType `NUMBER`. NUMBER is not one of the current six MVP EntityType values. This entity would be added post-MVP when the NUMBER entity type is introduced. The constraint matrix for NUMBER would need to include CONFIG.

**Coordinator (USB stick):**

| Entity slug | EntityType | EntityRole | enabledByDefault | Notes |
|---|---|---|---|---|
| `sensor.coordinator_state` | SENSOR | DIAGNOSTIC | true | Default DIAGNOSTIC per Decision 9. Adapter authors for standalone gateways may declare PRIMARY. |
| `sensor.coordinator_devices_connected` | SENSOR | DIAGNOSTIC | true | |
| `button.coordinator_permit_join` | — | — | — | BUTTON is a post-MVP EntityType; not classified in this amendment's constraint matrix. |

**(Decision 9)** The convention for coordinator-state classification: default is DIAGNOSTIC. The rationale is that a USB coordinator stick is infrastructure — the user installed it to manage a Zigbee network, not to observe the coordinator's own state. But for standalone gateway products where the gateway itself is the user's primary interest, PRIMARY is permitted by the constraint matrix.
