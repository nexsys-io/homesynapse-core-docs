# Smart Home Entity Modeling & State Management: Home Assistant, Matter, OpenHAB vs. HomeSynapse Core (M4 Research)

## Executive Summary

- **HomeSynapse's `staleAfter + Clock` model is a genuine differentiator.** None of the three platforms surveyed has a generalized per-entity wall-clock freshness model. Home Assistant explicitly lacks one (Architecture Discussion #1062 added only a `last_reported` *timestamp* in 2024.4 — not a timeout); HA's only per-entity timeout is MQTT-scoped `expire_after`. Matter ties liveness to subscription `MaxIntervalCeiling`, which is protocol-bound, not attribute-bound. OpenHAB has no equivalent.
- **HomeSynapse's two-layer Entity→Capability is the validated choice.** HA has Device→Entity (single-domain); OpenHAB has Thing→Channel→Item. OpenHAB's Item layer is widely reported as confusing — keep two layers. HA, which made the same two-layer call, reached "over 2 million active installations in 2024" (home-assistant.io/blog/2025/04/16/state-of-the-open-home-recap/), the largest of the three by a wide margin.
- **Matter's Endpoint/Cluster/Attribute aligns almost 1:1 with HomeSynapse's Entity/Capability/AttributeValue.** Matter clusters bundle attributes + commands + events with a FeatureMap bitmask — exactly HomeSynapse's CapabilityInstance + featureMap design. Strong validation.
- **Device replacement is universally painful.** HA has no first-class replace flow (architecture discussion #1088 unresolved); Matter requires re-commissioning. HomeSynapse's `DeviceReplacementService` + CapabilityCompatibilityReport + preserved EntityId is materially ahead if delivered.
- **HomeSynapse is missing two concepts present in 2+ platforms**: (1) a **Floor** layer above Area — HA introduced FloorRegistry in release 2024.4 (April 3, 2024), described in the release blog as one of "Three new ways to organize: Floors, Labels, and Categories" (home-assistant.io/blog/2024/04/03/release-20244/), and OpenHAB has nested Locations; and (2) **EntityCategory** (PRIMARY/DIAGNOSTIC/CONFIG) for UX role classification.
- **The `endpointIndex: int` field should be renamed to `endpointId`** and document stability requirements, mirroring Matter's 16-bit endpoint ID semantics.

---

## Platform 1: Home Assistant — Entity Model Evolution

### 1.1 Device/entity conflation and the device registry revision

HA began with **only entities** — a flat namespace (`light.kitchen`, `sensor.temperature`). The Device Registry was introduced in **release 0.79 (September 2018)**, driven by @Kane610. The official blog: *"This allows integrations to tell Home Assistant not only about entities, but also which devices the entities represent."* (home-assistant.io/blog/2018/09/28/release-79/)

**Release 0.87 (February 2019)** added the Area Registry: *"Areas will allow users to organize their devices by their physical area, like kitchen or living room."* The **FloorRegistry and LabelRegistry both landed in release 2024.4 (April 3, 2024)** as part of the same "Three new ways to organize: Floors, Labels, and Categories" initiative (home-assistant.io/blog/2024/04/03/release-20244/). Current registries: `homeassistant/helpers/{entity,device,area,floor,label}_registry.py`.

Pain that drove each revision (from architecture discussions):
- *Device registry (0.79):* No way to group entities, no firmware version surface, no `via_device` linkage. Architecture #685 later added `hw_version` because bug-reporters couldn't distinguish hardware revisions.
- *Area registry (0.87):* Users wanted "turn off all lights in the living room" without manual grouping. Frenck (architecture #1021): *"We didn't call them rooms on purpose, as rooms imply that there is a physical wall, but a kitchen and living room can be a continuing space yet be each their own."*
- *Floor registry (2024.4):* Frenck explicitly rejected nested areas: *"One approach for floors could be to allow nested areas. I think that this would result in a very messy situation."* Lesson for HomeSynapse: **introduce Floor as a separate aggregate, not nested Area.**
- *Label registry (2024.4):* Frenck on the labels POC: *"could be put on basically any physical thing in the home (areas, devices, entities), which would give me a non-physical categorization/organization."*

**What HA is doing differently now.** A July 2025 developer-blog post ("Updated guidelines for helper integrations linking to other integration's device") references architecture proposal #1226, which **made device connections and identifiers unique per-integration-domain instead of globally unique.** HA is *backing away* from a globally unique namespace. **Lesson for HomeSynapse: HardwareIdentifiers should be scoped by `integrationId`, not globally unique.**

The `via_device` pattern handles smart power strips: *"A device that offers multiple endpoints, may be split into separate devices and refer back to a parent device with the via_device attribute … Typical examples … are smart power strips or smart multi-gang wall switches. The parent device will have entities representing the state of the power strip … The sub devices will group entities tied to one of the channels."* (developers.home-assistant.io/docs/device_registry_index/)

**This contradicts HomeSynapse's 1 Device → N Entities model.** HA splits a smart power strip into N+1 devices (parent + per-outlet) so each outlet can have its own area. HomeSynapse's per-entity `areaId` override (inherits from device but overridable) should cover this — verify in test cases.

### 1.2 Entity categories and entity platforms

HA's `EntityCategory` is an optional property: `None` (primary), `CONFIG`, `DIAGNOSTIC`. From developers.home-assistant.io/docs/core/entity/: configuration entities configure the device; diagnostic entities surface health/state not used in normal operation. A `SYSTEM` value is documented in some places but rejected by validation (esphome/issues #2729).

**Mapping to HomeSynapse:** HomeSynapse's `EntityType` is **functional classification**, while HA's `EntityCategory` is **UX role classification** — orthogonal axes. A `sensor` in HA can be `entity_category=None` (room thermometer) or `DIAGNOSTIC` (RSSI). HomeSynapse currently can't distinguish; everything maps to SENSOR. **Add `entityRole` as an orthogonal field.**

**Entity Platforms vs. Capabilities.** HA's "entity platform" is the domain class — `light`, `switch`, `sensor`, `climate`, `cover`, `media_player`, `lock`, `fan`, `binary_sensor`, etc. **A multi-function HA device becomes multiple entities of different platforms** (an air-quality sensor with light becomes a `light` + several `sensor` entities under one Device).

Consequences:
- Cross-platform features get re-implemented (`device_class` exists on `sensor`, `binary_sensor`, `number`, `button`, `cover`, `switch`).
- New device categories require architecture-repo proposals.
- The `light` platform has 13+ `supported_features` bits and a tangled color_mode enum.

**HomeSynapse's CapabilityInstance + featureMap is the right answer**, and Matter agrees (§2 below).

### 1.3 State management and the state machine

HA's state machine is in-memory and single-threaded (asyncio). State is immutable: each update creates a new State object. Updates flow via `async_write_ha_state()` (push) or `async_update_ha_state(force_refresh=True)` (poll).

The State object holds **three timestamps** that map closely to HomeSynapse:

| HA field | HomeSynapse | Semantics |
|----------|-------------|-----------|
| `last_changed` | `lastChanged` | When state *value* last changed |
| `last_updated` | `lastUpdated` | When state (value or attrs) was last written |
| `last_reported` | `lastReported` | When integration set state, **regardless of any change** |

**`last_reported` was added in HA 2024.4 (April 3, 2024)** via PR #113511 and follow-up PR #113798, both authored by Erik Montnemery (synchronized March 19, 2024). The developer-blog announcement (developers.home-assistant.io/blog/2024/03/20/state_reported_timestamp/) was published **March 20, 2024**. It resulted from architecture discussion #1062 (opened March 12, 2024; closed June 27, 2024 by Frenck with: *"Closing this discussion as the proposal has been implemented."*).

The verbatim rationale (architecture #1062, March 2024) matches HomeSynapse's intent exactly:

> "Home Assistant currently discards state writes where neither the state nor the state attributes are changed, unless the integration sets the `force_update` flag. This behavior makes it very difficult for integrations to correctly do time series analysis of numerical sensor state. It also means the user don't know if an integration is updating a sensor or not." — emontnemery

The developer-blog confirms: *"The State object is now always updated and an event is always fired when an integration sets the state of an entity, regardless of any change to the state or a state attribute."*

**Important caveat:** Issue #145153 (May 2025) and the third-party "HA-Real-Last-Changed-Reported-Seen-Sensors" custom component report that all three timestamps **reset on HA restart**, and that `last_reported` is still discarded in some integrations (e.g., KNX without `always_callback`). The custom-component README: *"Home Assistant's built-in last_changed and last_reported attributes reset on restart and update when entities transition through unknown/unavailable states. This has been a long-standing pain point: 2019, 2020, 2022, 2024."*

**HomeSynapse advantage:** because state is event-sourced and replayed from the event log, `lastReported` is durable by construction. **Document and preserve this; add a regression test that confirms `lastReported` survives a full event-store replay.**

### 1.4 Staleness — HA does NOT have a generalized model

After deep investigation, **Home Assistant has no architecture-level, generalized per-entity staleness/freshness model.** The only timeout-based unavailability is `expire_after`, scoped exclusively to MQTT.

From the MQTT sensor docs (home-assistant.io/integrations/sensor.mqtt/):
> "`expire_after` integer (Optional, default: 0) — If set, it defines the number of seconds after the sensor's state expires if it's not updated. After expiry, the sensor's state becomes `unavailable`. Default the sensors state never expires."

`expire_after` for MQTT sensors was added via core PR #6708; for MQTT binary_sensor via PR #16090 (Aug 2018). Implementation uses `async_track_point_in_utc_time` — a single one-shot callback at `now() + expire_after`, cancelled and rescheduled on each new message. Known bugs:
- **#65558:** Sensor briefly flips to `unavailable` at the boundary even when updated in time (since 2022.0).
- **#86992:** Retained-message replay incorrectly resets the expiry timer at HA restart (uses `dt_util.utcnow()` instead of message timestamp).
- **#148860 (2025):** On reloads/restarts the last retained broker value is restored even if older than `expire_after`.
- **#28872:** `expire_after` doesn't reset when only `json_attributes_topic` receives updates.
- **#36553:** MQTT sensor returns `unknown` after expiry while MQTT binary_sensor returns `unavailable` for the same configuration.

The original feature request (core #6705) framed it as MQTT-only: *"This option is only useful for push-style sensors like MQTT. If the sender loses connection, the last value will be displayed forever. With this feature, the value would switch to UNKNOWN after a certain time."* HA implemented the fix only for MQTT and never generalized it.

**For all other integrations, `available` is push-driven by the integration itself.** From the HA Integration Quality Scale (entity-unavailable rule):
> "If we can't fetch data from a device or service, we should mark it as unavailable. We do this to reflect a better state, than just showing the last known state. If we can successfully fetch data but are temporarily missing a few pieces of data, we should mark the entity state as unknown instead."

DataUpdateCoordinator-based integrations mark entities unavailable only on `UpdateFailed` (poll-cycle failure). **No framework-level wall-clock freshness check exists.** This is exactly the gap HomeSynapse's `staleAfter + Clock` model fills.

Community evidence confirms the missing primitive: forum threads "Let us see when last sensor data was received, even if unchanged" (#480755), "Extend unavailable timeout for certain entities?" (#95065), "Determine state unchanged entities for a certain period" (#342221), and the HA-Real-Last-Changed-Reported-Seen-Sensors custom component exist *because* HA lacks built-in freshness tracking.

**Bottom line: HomeSynapse's `staleAfter` is novel within this competitive set, and independent of `availability` — the correct design.** HA conflates the two and pays for it.

### 1.5 Device replacement

This is HA's most-cited weak point. Architecture #1088 ("Add support for device replacement") is unresolved as of late 2024. Key participant quote:

> "For me, one of the main issues is that devices use a non-user configurable device_id string, so anything referring to the device (i.e. Triggers in an automation) are 'hard coded' to the specific device. Even removing and re-adding the same device will break things and require manually editing the references."

The status-quo workflow:
1. User removes the dead Zigbee device from ZHA/Z2M, removing it from HA's device registry.
2. User pairs the new device → new `device_id`, new entity_ids (often suffixed `_2`).
3. User hand-edits the entity_registry to delete the old entries, renames new entities back to old IDs.
4. Automations referencing `device_id` directly are silently broken.
5. Long-term statistics (Energy dashboard) are tied to entity_id, so renaming preserves history if done carefully.

**HomeSynapse's `DeviceReplacementService` + CapabilityCompatibilityReport + preserved EntityId is materially ahead.**

### 1.6 Config flow and discovery

HA's config flow (developers.home-assistant.io/docs/config_entries_config_flow_handler/):
- Integrations declare discovery methods in `manifest.json` (zeroconf, ssdp, dhcp, bluetooth, usb, homekit).
- Each discovery type maps to an `async_step_<protocol>` method.
- A **unique_id** (per-integration-domain, not globally unique) prevents duplicate setup.
- Built-in `register_discovery_flow()` helper for auto-discovery integrations.

**Lessons for HomeSynapse:**
- HomeSynapse's `device_discovered` event with `hardwareIdentifiers` is correct.
- HA's per-integration unique_id model (post-#1226) validates HomeSynapse's `(namespace, value)` design.
- HA distinguishes "discovery without auth" from "discovery requiring confirm" — HomeSynapse's auto/user-adoption branch matches.

---

## Platform 2: Matter Data Model

### 2.1 Node/Endpoint/Cluster/Attribute hierarchy

Matter's model (CSA-IOT Matter Specification; developers.home.google.com/matter/primer; docs.silabs.com/matter):

- **Node:** Uniquely addressable Matter entity on the fabric.
- **Endpoint:** Logical interface offered by the node. Endpoint 0 is reserved for the Root Node (utility clusters: Descriptor, Basic Information, Network Commissioning).
- **Cluster:** Typed contract grouping attributes, commands, and events. Servers hold state; clients consume.
- **Attribute:** Typed state value (uint8, int16, string, struct, list) with min/max/step at the protocol level.

**Mapping to HomeSynapse:**

| Matter | HomeSynapse | Notes |
|--------|-------------|-------|
| Node | Device | 1:1 |
| Endpoint | Entity | 1:1 — strong validation |
| Cluster | CapabilityInstance | 1:1 — both bundle related state + behavior |
| Attribute | AttributeValue (typed) | 1:1 with constraints |
| Command | Routed via event ledger | **Divergent** — HomeSynapse decouples |
| Event | (No direct equivalent at cluster level) | HomeSynapse events are system-level |
| Descriptor cluster (PartsList, DeviceTypeList) | (Missing) | HomeSynapse has no runtime introspection |

The Matter Descriptor cluster — mandatory on every endpoint — exposes `DeviceTypeList`, `ServerList`, `ClientList`, `PartsList`. This is **runtime schema introspection**:

> "Endpoint composition SHALL be indicated by these Descriptor cluster attributes: DeviceTypeList SHALL list the device type(s) that the endpoint supports; PartsList SHALL indicate the endpoints that support these device type(s)." — Matter System Model Specification §9

HomeSynapse has nothing analogous. **Recommendation:** add a read-only `EntityDescriptor` query on IntegrationContext for adapter introspection and the device-replacement compatibility check.

### 2.2 Cluster semantics vs. capability semantics

A Matter cluster bundles attributes, commands, and events. The `FeatureMap` global attribute is a bitmask of optional cluster features (Matter spec §7.13.2):

> "The FeatureMap attribute SHALL indicate whether the server supports zero or more optional cluster features. A cluster feature is a set of cluster elements that are mandatory or optional for a defined feature of the cluster. If a cluster feature is supported by the cluster instance, then the corresponding bit SHALL be set to 1." — Matter 1.1 Application Cluster Specification

**This is precisely HomeSynapse's `CapabilityInstance.featureMap` design.**

The divergence is **commands**: Matter places commands inside the cluster (`Toggle`, `MoveToLevel`, `MoveToColorTemperature`), while HomeSynapse routes commands through the event ledger with `Expectation` (ExactMatch, WithinTolerance, EnumTransition, AnyChange). Matter is procedural; HomeSynapse is declarative + event-sourced. For *adapter authors*, Matter's bundling is cleaner. For *core*, event sourcing gives replayable audit history. **Keep HomeSynapse's split; let adapters express command intent in cluster-shaped form.**

### 2.3 Data types and constraints

Matter attributes are protocol-typed with per-attribute constraints in cluster XML at compile time. HomeSynapse's `AttributeSchema` (type, min/max/step, validValues, unitSymbol, permissions READ/WRITE/NOTIFY, nullable, persistent) is **richer at runtime**:
- Runtime `permissions` flags (Matter's are implicit in cluster definition).
- `nullable` flag (Matter uses sentinel values like `0xFFFF` — error-prone).
- `persistent` flag (Matter has NV-storage quality at cluster definition time).

**Recommendation:** add a `unitSchema` mapping to UCUM or Matter's MeasurementUnit enum for unit interoperability with future Matter exports.

### 2.4 Multi-endpoint devices

A Matter Node can expose multiple endpoints (smart power strip: one Node, one Endpoint per outlet, each with OnOff cluster). From the Matter spec:

> "A composed device type is composed of two or more other device types. … The PartsList of the Descriptor cluster on the root node endpoint SHALL list all endpoints on the node, except the root node endpoint." — Matter System Model Specification §9

**Validates HomeSynapse's 1 Device → N Entities → endpointIndex model.** But Matter's endpoint is identified by a 16-bit integer assigned by the device firmware and stable for the lifetime of the node. **`endpointIndex: int` is a poor name if it's actually a protocol-assigned ID.** Recommend renaming to `endpointId` and documenting that it's adapter-defined and stable.

### 2.5 Bridged devices

Matter's bridge model (Device Library §2.6, Bridged Node device type ID 0x0013):

> "This device type SHALL only be used for Nodes which have a device type of Bridge. … Unlike native Matter nodes, the bridged device has a dedicated Bridged Device Basic Information cluster enabled on its endpoint to provide basic information about the device."

The architecture:
- Endpoint 0: Root Node (Matter utility).
- Endpoint 1: **Aggregator** device type with `PartsList` of all bridged endpoints.
- Endpoint N (N≥2): Each bridged device — `Bridged Node` device type + application device type (e.g., `On/Off Light`) + `Bridged Device Basic Information` cluster (manufacturer, model, serial, reachable).

**Key teachings for HomeSynapse:**
1. **`reachable` is a per-bridged-device attribute distinct from fabric connectivity.** HomeSynapse's `availability: AVAILABLE/UNAVAILABLE/UNKNOWN` aligns.
2. **Bridged endpoints can be added/removed dynamically.** HomeSynapse's event-sourced model handles this via `device_discovered` / `device_removed`.
3. **Bridged Node has a flat `PartsList`.** For HomeSynapse's future Matter-bridge feature, every adopted Entity must be enumerable from a single root.
4. **Identity stability across bridge restart is required** — controllers must not see new devices appear. HomeSynapse's ULID-based EntityId persisted at adoption handles this.

### 2.6 Matter staleness — subscription liveness, not entity staleness

Matter has **no per-attribute freshness concept**. The closest mechanism is the **Subscription**: a Subscriber requests `MinIntervalFloor` and `MaxIntervalCeiling`; the Publisher must emit a Report (data or empty liveness) within `MaxIntervalCeiling`. From the Matter Interaction Model docs:

> "If the Subscriber does not receive a Report Data Action within the maximum negotiated interval between Actions, the subscription will be terminated. As a consequence of the previous rule, the Publisher may terminate a Subscription Interaction by simply stopping sending periodic Report Data Actions."

**This is subscription-bound liveness, not entity-state staleness.** Subscription end signals "subscription dead" but provides no per-attribute "this value is stale" signal — the controller must implement that itself. Evidence that controllers struggle with this surfaces in community threads about Matter controllers (e.g., the SmartThings community thread "How To Set Matter Reporting Interval Configuration") where users observe Matter reporting interval handling inconsistencies between SmartThings (no floor) and Home Assistant's python-matter-server (a 1-second floor added in PR #891 to address report flooding).

**Strongest competitive signal yet for HomeSynapse's `staleAfter` model.** Matter's liveness is at the wrong granularity (subscription) and forces controllers to reimplement per-attribute timeouts.

---

## Platform 3: OpenHAB Thing/Channel/Item

### 3.1 Three-layer separation

OpenHAB's model (openhab.org/docs/concepts/):
- **Thing:** A physical device or service.
- **Channel:** A specific functionality of a Thing.
- **Item:** A user-facing abstract data point with a type (Switch, Dimmer, Number). Items are linked to Channels via Links, optionally with Profiles.

> "The actuator is a Thing that might be installed in an electrical cabinet … In order for the user to control the two lights, he or she accesses the capability of the actuator Thing (turning on and off two separate lights) through two Channels, that are Linked to two switch Items presented to the user through a user interface." — openhab.org/docs/concepts/

**The Item layer is widely reported as confusing.** From community forum thread #145706:
> "However, even after quite some considerable reading of this forum and the documentation I find the semantics used utterly confusing and difficult to understand. For some reason I am unable to grasp the concept of things, channels, and items and create a clear understanding."

Forum #112686 asks whether one Equipment maps to one Thing or many — a question that shouldn't arise with a clean model.

**Mapping to HomeSynapse:**

| OpenHAB | HomeSynapse | Notes |
|---------|-------------|-------|
| Thing | Device | 1:1 |
| Channel | CapabilityInstance attribute (with permissions) | Roughly 1:1 |
| ChannelType | AttributeSchema | 1:1 |
| Item | (No equivalent) | User-facing abstraction layer HomeSynapse lacks |
| Link (Channel↔Item) | (Implicit — Capability is automation target) | HomeSynapse skips |
| Profile | (No equivalent) | OpenHAB's Channel↔Item value transformation |

**Verdict:** OpenHAB's Item layer adds user-facing flexibility (one Channel → multiple Items; one Item ← multiple Channels via Profiles) but with a steep learning curve. **HomeSynapse's two-layer model — Entity+Capability directly automation-addressable — is the right call.** Home Assistant made the same call and reached "over 2 million active installations in 2024" (home-assistant.io/blog/2025/04/16/state-of-the-open-home-recap/), validating the two-layer approach as scalable to mass adoption.

The one thing the Item layer provides that HomeSynapse should consider: **value transformation between protocol data and automation-facing semantics** (e.g., 0–255 brightness → 0–100%). **Recommend: add `valueTransform` to AttributeSchema, optional, declarative.**

### 3.2 Composite devices

OpenHAB handles composite devices (smart plug with energy monitoring) by giving the Thing multiple Channels. Structurally identical to HomeSynapse's Entity with multiple Capabilities. The Semantic Model adds:

- **Equipment** tag at the Thing level.
- **Point** and **Property** tags at the Channel level.

Per openhab.org/docs/developer/bindings/semantic-tags.html:
> "Semantic EQUIPMENT tags MUST be applied at the thing level. Semantic POINT and PROPERTY tags MUST be applied at channel level."

> "A POINT is a tag that describes the functional type (or purpose) of a data point within an equipment. Examples are measurement, control, set point, or status."

A clean model **HomeSynapse should consider adopting** as a semantic layer atop EntityType/Capability — though existing `labels` may absorb much of it.

### 3.3 Binding developer experience

Friction points consistently reported by binding developers:
- **XML-driven Thing/Channel definitions** are static; dynamic channel discovery is painful (forum #91049: authors of devices with variable channel sets — e.g., a ceiling fan with/without dimmable light — struggle).
- **ThingHandler must implement polling itself.** From the binding dev guide: *"It is binding specific when the channel should be updated. If the device or service supports an event mechanism the ThingHandler should make use of it … If no event mechanism is available, the binding can poll for the state."*
- **Upgrade migration is manual** (forum #94842: new channels added to a binding don't auto-appear on existing Things).
- **Thing status machine is rigid** (UNINITIALIZED → INITIALIZING → ONLINE/OFFLINE/UNKNOWN → REMOVING → REMOVED) — once REMOVING, the binding cannot abort.

**For HomeSynapse:** the dynamic-capability problem is real. Doc 02 doesn't specify a "capability added at runtime" event. **Add `entity_capability_added` / `entity_capability_removed` events.**

---

## Cross-Cutting Analysis

### 4.1 Concept Alignment Mapping Table

| HomeSynapse (Doc 02) | Home Assistant | Matter | OpenHAB |
|----------------------|----------------|--------|---------|
| `Device` | DeviceEntry (DeviceRegistry) | Node | Thing |
| `Entity` | Entity (single domain) | Endpoint | (Thing + Channels collectively) |
| `CapabilityInstance` | (Implicit in entity domain) | Cluster | Channel + ChannelType |
| `Capability` (sealed) | Entity Platform (`light`, `switch`, …) | Cluster ID | ChannelType UID |
| `AttributeValue` | State + attributes (dict) | Attribute (typed) | Item state (typed) |
| `AttributeSchema` | EntityDescription / `device_class` | Cluster attribute XML | ChannelType XML + `<state>` |
| `featureMap` (bitmask) | `supported_features` bitmask | FeatureMap attribute | (None — separate channels) |
| `EntityType` | Platform domain | DeviceTypeList | semantic-equipment-tag |
| `EntityCategory` (proposed) | EntityCategory (PRIMARY/CONFIG/DIAGNOSTIC) | (Utility vs Application cluster) | (Implicit) |
| `areaId` | DeviceEntry.area_id (overridable) | (Not modeled) | Location tag (Group Item) |
| (proposed) Floor | FloorRegistry (added 2024.4) | (Not modeled) | Nested Location groups |
| `labels` | LabelRegistry (added 2024.4) | (Not modeled) | Custom tags |
| `viaDeviceId` | DeviceEntry.via_device | (Implicit through Bridge) | Bridge (Thing) |
| `hardwareIdentifiers` | DeviceEntry.identifiers + connections | Node ID + VendorID/ProductID | Thing UID + representation property |
| `IntegrationDescriptor` | manifest.json | (Vendor cluster) | binding.xml |
| `EventPublisher` (event-sourced) | hass.bus + state machine | Interaction model | EventAdmin + ItemRegistry |
| `staleAfter` + `stale` | **None (MQTT `expire_after` only)** | Subscription MaxIntervalCeiling (controller-side) | None |
| `EntityState.stateVersion` | (None — last_updated only) | DataVersion (per cluster) | None |
| Pending Command Ledger | `service_called` event (no confirm) | Command + Response (synchronous) | Command on event bus |
| `CapabilityCompatibilityReport` | (None — manual migration) | (Re-commissioning only) | (Manual binding upgrade) |
| `DeviceReplacementService` | (None — #1088 open) | (Re-commissioning) | (Remove + re-add Thing) |

### 4.2 Gap Analysis — Concepts in 2+ platforms missing from HomeSynapse

1. **Floor layer above Area.** HA FloorRegistry (introduced in HA release 2024.4, April 3, 2024); OpenHAB nested Locations. Users with multi-floor homes can't say "all lights on the ground floor". **Severity: medium.**
2. **EntityCategory / role classification.** HA `EntityCategory.CONFIG|DIAGNOSTIC`; Matter utility-vs-application clusters. Can't visually demote diagnostic entities without losing them in queries. **Severity: medium-high.**
3. **Descriptor / introspection cluster.** Matter mandates per-endpoint Descriptor. Adapters and DeviceReplacementService can't enumerate "what capabilities does this entity offer" through a uniform API. **Severity: low-medium** — easily added.
4. **Value transformation between protocol and semantic units.** OpenHAB Profiles; HA `value_template`. Adapters re-implement 0–255→0–100% mapping. **Severity: medium.**
5. **Bridged Device Basic Information "reachable" distinct from "available".** Matter has `Reachable` alongside fabric connectivity. **Severity: low** — current `availability` may suffice.
6. **Dynamic capability events.** Matter bridged endpoints can be added/removed at runtime; OpenHAB Things can be updated. HomeSynapse's adoption is one-shot. **Severity: medium.**

### 4.3 Over-abstraction Analysis — Doc 02 concepts no platform uses

1. **`EnumTransition` and `WithinTolerance` Expectation types.** None of the three platforms has a structured command-confirmation primitive. HA fires a service call and forgets it; Matter commands return synchronous status; OpenHAB sends commands on the event bus with no follow-up. **Keep but treat as feature-flagged for v1.**
2. **`SchedulerService` / `ManagedHttpClient` / `TelemetryWriter` as optional IntegrationContext services.** OpenHAB has BaseThingHandlerFactory's `ScheduledExecutorService`; HA none. **Likely correct; verify the API surface stays small.**
3. **`hardwareIdentifiers` as a *list* of (namespace, value) tuples.** HA uses a *set* of identifiers + a separate set of connections. **Recommendation: use a Set, define equality as set-equality.**
4. **`integrationId` on every Device.** HA tracks via `config_entries` — one device may belong to multiple config entries (rare but real: same Zigbee device discovered by both ZHA and Z2M). HomeSynapse's strict 1:1 may be too rigid. **Verify the multi-integration case is handled.**

### 4.4 staleAfter + Clock — Competitive Assessment

**HomeSynapse's `staleAfter + Clock` is genuinely novel within this competitive set.**

| Platform | Per-entity wall-clock freshness | Mechanism | Limitations |
|----------|--------------------------------|-----------|-------------|
| HomeSynapse | **Yes**, declarative | `staleAfter = lastReported + capability_interval`, read-time evaluation, 30s passive scan | (to be measured) |
| Home Assistant | **MQTT only** via `expire_after` | One-shot timer per entity (`async_track_point_in_utc_time`) | Limited to one component; bugs around retained messages, JSON attribute topics, restart behavior |
| Matter | **Subscription-bound only** (`MaxIntervalCeiling`) | Subscription terminates if no report within interval | Liveness is per-subscription, not per-attribute |
| OpenHAB | **No** | Bindings can set Item state to `UNDEF` manually | No wall-clock freshness at all |

**Problems the other platforms encounter:**
- HA: Users build template sensors for stale-state detection (forum #342221); long-open feature requests (#480755, #95065).
- Matter: HA's python-matter-server PR #891 hardcoded a 1-second subscription floor to prevent report flooding; SmartThings used 0 — indicating controllers continue to tune the subscription-liveness compromise.
- OpenHAB: Users build timestamp-comparison rules in DSL/JRuby/JS — error-prone, ad-hoc.

**Risks to mitigate:**
1. **Persistence across restart.** HA's `last_reported` resets on restart. HomeSynapse's event-sourcing makes it durable, but ensure `staleAfter` is *derived* from persisted `lastReported`, not stored separately.
2. **Threshold resolution complexity.** Four-level fallback (per-entity → capability default → global default → null) is sound but adds debugging surface area. Provide `/debug/staleness/<entityId>` introspection.
3. **30s passive scan interval is a tradeoff.** Battery-powered sensors reporting every 60s will appear stale 30s late on average. Document; consider making per-entity configurable.

### 4.5 Device replacement recommendations

The identity model is mostly correct, with two refinements:

1. **Decouple Device identity from HardwareIdentifier identity.** Replacing a Zigbee bulb necessarily creates a new IEEE address. `DeviceReplacementService` should perform an *identity transplant*: keep the old `deviceId` (ULID), retire old `hardwareIdentifiers`, attach new, update `model`/`serialNumber`/`firmwareVersion`. Document a `device_replaced` event with `oldHardwareIdentifiers` and `newHardwareIdentifiers`.
2. **EntityId preservation is the critical user-facing promise.** HA's pain (#1088) is precisely that automations are entity_id-bound and entity_ids change on re-pair. **Enforce in CapabilityCompatibilityReport: any capability that disappears in the new device must surface as a hard warning, not silent dropping.**
3. **Per-Entity, not just per-Device, compatibility.** A 5-outlet power strip replaced with 4-outlet should warn that Entity #5 is orphaned, not silently delete it.

### 4.6 Specific Doc 02 Amendments — Ranked by Impact

**Tier 1 (essential before M4 GA):**

1. **Add `entityRole: EntityRole` enum to Entity** (PRIMARY | DIAGNOSTIC | CONFIG). Orthogonal to EntityType. Cost: minimal. **Source: HA EntityCategory, Matter utility-vs-application.**
2. **Add `Floor` aggregate above Area.** A Floor contains 1+ Areas. Don't nest Areas. Cost: one new aggregate + migration. **Source: HA FloorRegistry (released 2024.4, April 3, 2024); OpenHAB nested Locations (an approach HA explicitly rejected as "very messy").**
3. **Rename `endpointIndex: int` to `endpointId` and document stability requirements.** Stable across restarts, opaque to core. Optionally allow String type. **Source: Matter 16-bit endpoint ID, Hue/Zigbee numeric, MQTT topics string.**
4. **Make `hardwareIdentifiers` a `Set` and scope namespace by integration.** Don't make identifiers globally unique — HA moved away from this in mid-2025 (proposal #1226). Cost: List→Set + namespace convention `${integrationId}.${type}`. **Source: HA DeviceRegistry identifiers as set, per-domain.**
5. **Persist `lastReported` durably via event-sourcing replay**, and make `staleAfter` lazy-derived from it. Regression-test that `lastReported` survives full event-store replay. **Source: HA `last_reported` reset-on-restart pain.**

**Tier 2 (post-M4, high value):**

6. **Add `entity_capability_added` / `entity_capability_removed` events.** Capabilities dynamic per-Entity at runtime, not just at adoption. **Source: Matter dynamic endpoints, OpenHAB Thing channel updates.**
7. **Add `valueTransform` to AttributeSchema** for declarative protocol↔semantic conversion (scale, offset, lookup). **Source: OpenHAB Profiles, HA `value_template`.**
8. **Per-Entity CapabilityCompatibilityReport in DeviceReplacementService.** Surface orphaned Entities. **Source: Matter Bridged Node per-endpoint conformance, HA #1088.**
9. **Add a derived `EntityDescriptor` query** (capabilities + featureMaps + schemas + version) on IntegrationContext. **Source: Matter Descriptor cluster mandatory on every endpoint.**
10. **Document semantic tags** as a labeling convention for the Label registry, folded into existing `labels`. **Source: OpenHAB Equipment/Point/Property hierarchy.**

**Tier 3 (consider but verify cost):**

11. **Support multi-integration Devices.** Same physical device discovered by two integrations. **Source: HA `config_entries` set on DeviceEntry.** Likely v2.
12. **`/debug/staleness/<entityId>` introspection endpoint** for four-level threshold resolution. High payoff in support load.
13. **Make 30 s passive scan interval configurable per-Capability.** Motion/contact want sub-second; battery/RSSI tolerate minutes.

---

## Recommendations

**For M4:**

1. **Ship Tier 1 amendments (1–5) as part of M4.** Small, address validated gaps, don't compromise architecture.
2. **Defer Tier 2 amendments to M4.1 / M5.** Improvements, not corrections.
3. **Treat `staleAfter + Clock` as a marketable differentiator.** Build comprehensive integration tests, document the threshold resolution clearly, instrument the passive scan with metrics. This is the feature that distinguishes HomeSynapse from the three competitors surveyed.
4. **Resist OpenHAB's three-layer Thing/Channel/Item.** The Item layer is widely reported as confusing. HomeSynapse's two-layer Entity/Capability matches HA (>2M active installs) and Matter, and is the validated choice.
5. **Embrace Matter's cluster ID space as a capability identifier.** When an adapter integrates a Matter device, the cluster ID can map directly to a HomeSynapse Capability (e.g., Matter OnOff Cluster 0x0006 → HomeSynapse `OnOff`). A future "HomeSynapse as Matter bridge" feature is significantly easier this way.
6. **For device replacement, commit publicly to "EntityId preserved" semantics.** Strongest differentiator vs. HA's unresolved community pain point.

**Benchmarks that would change these recommendations:**
- If HA ships generalized (non-MQTT) staleness in 2026, recommendation #3 weakens.
- If the FloorRegistry pattern is adopted by Matter (it isn't as of Matter 1.4), the Floor-as-separate-aggregate decision should be re-evaluated against a Matter-native model.
- If OpenHAB's user base re-grows and the Item layer's friction is addressed in a future redesign, recommendation #4 should be re-examined.

---

## Caveats

- **Sample bias:** All three platforms studied are open-source. Commercial platforms (SmartThings, Hubitat, HomeKit) may have additional patterns not surveyed.
- **Version drift:** HA evolves monthly. `last_reported` (April 2024) is recent; broader staleness work may land before M4 GA — re-check the architecture repo before final design freeze.
- **Matter spec versioning:** This document references Matter 1.1/1.2/1.3 sources. Matter 1.4+ (2025) introduces additional clusters and refinements not fully covered.
- **OpenHAB community signals** are based on forum sentiment, which may overweight users with problems. OpenHAB does not publish public installation analytics, so quantitative user-base comparisons against HA's published 2M+ active installations are unavailable.
- **The `last_reported` issues #145153 and the third-party HA custom component** are reported community pain points but were not empirically verified in the current HA codebase. The HomeSynapse architectural advantage is real on paper; verify behavior empirically before claiming in external materials.
- **The `Expectation` sealed hierarchy** (ExactMatch/WithinTolerance/EnumTransition/AnyChange) has no competitive analog and was not validated against external patterns; review against actual integration use cases.
- **The python-matter-server PR #891 attribution** to a September 2024 date and SmartThings community forum sourcing could not be independently confirmed from authoritative pages within the research window; the PR number and behavior described are reported by community sources and warrant direct verification before being cited externally.