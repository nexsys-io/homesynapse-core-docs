# Research 7 v2 — REST and WebSocket API Design for Event-Sourced Smart Home Systems (Verification + Re-Anchor)

## §1 Executive Summary

This document repairs and extends Research 7 v1 for HomeSynapse Core. The headline finding: **across every comparable system surveyed (Home Assistant, Philips Hue Bridge v2, openHAB, EventStoreDB), the dominant, evidence-backed pattern for grouping-container deletion is "unassign-on-delete," not "cascade-delete the children"** — which directly validates AMD-44 Decision 11's instinct to protect data, but argues for a *specific* refinement (409 + affectedAreaIds with ?force=true performing unassign, never destroy). All §7 fabrications from v1 are corrected against the verbatim module-info.java and type inventory embedded in the task; §7 below quotes those blocks before proposing any diff.

The seven pending NQ leans resolve as follows after pressure-testing against prior art: **NQ-1 CONFIRM** (nullable timed field; Hue and HA both model transition/timed actions as an optional per-command parameter); **NQ-2 CONFIRM with refinement** (rename to ApiKeyScope; GitHub/Stripe use "permissions"/"scopes" but the key-bound noun is idiomatic); **NQ-3 OVERRIDE** (RFC 9457 and real adopters overwhelmingly favor resolvable https: URIs; keep https, do not switch to urn:); **NQ-4 CONFIRM** (separate webhook DLQ is standard — Stripe/Svix/SQS all isolate poison events); **NQ-5 CONFIRM** (keep existing 4400-range codes; 4000-4999 is IANA private-use, low collision risk); **NQ-6 CONFIRM** ((entityId, attributeKey) coalescing matches Hue's per-property 1s rate-limit and HA's attribute-granular state model); **NQ-7 CONFIRM** (rename @Capability → @ApiCapability; framework precedent favors disambiguated annotation names).

For genuinely new scope: Q-A (typed attribute wire format) → expose flattened JSON-native values by default with the tagged-union envelope available behind an Accept/representation parameter, honoring INV-SE-02 and Pi-4 budget. Q-B (temporal fields) → expose all three event-time timestamps plus wall-clock stale/staleAfter, mirroring HA's last_changed/last_updated/last_reported triad. Q-C (Floors/EntityRole) → adopt 409+force unassign semantics, sentinel-null subscription filters, and floorId-on-entity association. New recommendations are numbered REC-106 onward; v1 items retain REC-62..75.

**TL;DR**
- **Every surveyed peer unassigns children on container delete rather than cascade-destroying them** (HA floor delete sets `area.floor_id=None`; HA area delete clears entity/device area refs; Hue room/zone delete removes only the grouping + its grouped_light, lights survive). AMD-44 Decision 11's 409+`?force=true` is correct, but `?force=true` must perform *unassignment*, not deletion of entities.
- **Of the 7 NQ leans, 6 are CONFIRMED and 1 is OVERRIDDEN**: NQ-3 must keep `https://homesynapse.local/problems/<slug>` because RFC 9457 explicitly encourages resolvable URIs and the surveyed real-world adopters (Spring, Swagger/SmartBear, IANA's registry) use https: type URIs; urn: is permitted but discouraged for developer experience.
- **§7 is fully re-anchored to the verbatim e73e199 module-info.java and type inventory**; the v1 CRITICAL fabricated module-info is replaced with the real two-line `com.homesynapse.api.ws` module and the real `com.homesynapse.api.rest` module, and every type reference cites the verified inventory.

## §2 Platform Deep Dives

### Home Assistant (REST + WebSocket)
HA's WebSocket API (`/api/websocket`) uses a JSON message protocol: an auth phase (`auth_required`→`auth`→`auth_ok`/`auth_invalid`), then a command phase where every client message carries an integer `id` that the server echoes for correlation. Subscriptions use `subscribe_events` with an optional `event_type` (e.g., `state_changed`); to listen to multiple types the client sends multiple `subscribe_events` commands. Events arrive as `{"id":…, "type":"event", "event":{…}}`. Unsubscribe is `unsubscribe_events` with the original subscription id. Errors are returned in `result` messages with `success:false` and an `error` object containing `code` and `message` (e.g., `not_found`, `invalid_format`) — **HA does NOT use RFC 9457 Problem Details**; it uses a bespoke `{code, message}` shape.

The `state_changed` event payload embeds `new_state` and `old_state` objects, each with `entity_id`, `state` (a string), an `attributes` map, and the timestamps `last_changed` and `last_updated` (and now `last_reported`). Crucially, **HA represents state values as strings and attributes as a loosely-typed JSON map** — there is no tagged-union type discriminator. A light's brightness is just `"brightness": 180` inside attributes.

The three timestamps are a deliberate, documented split: `last_changed` updates only when the state value changes; `last_updated` updates on any state-object write including attribute-only changes; `last_reported` was added on 2024-03-20 (HA Developer Docs blog "New state timestamp State.last_reported": "A new argument last_reported: datetime has been added to State() in the middle of the argument list… an event is always fired when an integration sets the state of an entity, regardless of any change"). From HA's data-science docs: "last_changed_ts only updates when the state value was changed while last_updated_ts is updated on any change to the state, even if that included just attributes." This validates Q-B's three-field design.

Floors shipped in HA 2024.4 ("Organize all the things!"). A floor is "a logical grouping of areas"; an area references its floor via a `floor_id` field on the area object (`AreaEntry.floor_id: str | None`, added in registry storage version 1.5). The WebSocket CRUD commands are `config/floor_registry/{list,create,update,delete}` and `config/area_registry/{list,create,update,delete}`, with `floor_id` an optional parameter on area create/update (verbatim in `config/area_registry.py`: `vol.Optional("floor_id"): vol.Any(str, None)`). **On floor deletion, HA does not cascade or block**: the area registry listens for the floor `remove` event and calls `async_update(area.id, floor_id=None)` on each affected area (verbatim from `helpers/area_registry.py`'s `_handle_floor_registry_update`). The user docs confirm verbatim: "Areas that are assigned to a floor will become unassigned" (and note "Devices and entities cannot be assigned to floors directly but to areas"). HA's area deletion follows the same unassign pattern (`device_registry.async_clear_area_id`, `entity_registry.async_clear_area_id`).

### Philips Hue Bridge v2 (CLIP API + SSE)
Hue v2 exposes rooms, zones, and grouped_light as first-class resources over `/clip/v2/resource/{type}`. A room holds its membership as a `children` array of resource-identifier objects `{rid, rtype}` (rtype `device` for rooms, `light` for zones), plus a `services` array referencing the controlling `grouped_light` (confirmed against verbatim bridge JSON in home-assistant/core issue #66496). **Deleting a room/zone (`DELETE /clip/v2/resource/room/{id}`) removes only the grouping container and its grouped_light service; the member lights/devices survive** as independent resources — confirmed by the resource model (children are references, not owned children) and the delete response returning only the room's own rid. Physical device removal is a separate `DELETE …/device/{id}` (Zigbee unpair).

Hue's event stream is Server-Sent Events at `/eventstream/clip/v2` (HTTP/2, `Accept: text/event-stream`). The critical coalescing evidence for NQ-6: Signify documents a **1-second rate limit per property** — "There is 1 second rate limit on the amount of event containers the Bridge will send. If the same property has changed twice within that timeframe, you only get the last state. If multiple resources have changed within that timeframe, then you will get multiple events grouped in a single container." This is precisely per-(resource, property) coalescing — the direct analog of HomeSynapse's proposed (entityId, attributeKey) key. Hue also rate-limits device events to one per second.

Hue transitions are modeled as an optional per-command parameter: v1 used `transitiontime` (in deciseconds, default 4 = 400ms); v2 uses a `dynamics` object with a duration. This is direct prior art for NQ-1's nullable `timedInteractionMs`.

### EventStoreDB
ESDB stores each event with a typed envelope: `type` (event type string), `data`, separate `metadata`, a `content_type` (JSON vs binary), and an `id`. The Python client's `NewEvent` has required `type`/`data` and optional `metadata`/`content_type`/`id`. **The envelope is explicitly metadata-plus-payload, not flattened** — typing is carried out-of-band in `type` and `content_type`, never inlined into the data document. This supports Q-A's option (a) envelope approach as an established pattern, while leaving the payload itself JSON-native.

Subscriptions come in catch-up and persistent flavors, with server-side filtering on the `$all` stream by event-type or stream-name via prefix or regex (`SubscriptionFilter.newBuilder().addStreamNamePrefix("test-")`). Filtering is positive (include) — there is no null-vs-absent ambiguity because filters are explicit builder calls, not a sparse JSON record. ESDB has no per-field coalescing; it is an append-only log that delivers every event. This argues that coalescing is a HomeSynapse-specific concern at the WS edge, not at the event-store layer.

### openHAB
openHAB's REST API exposes items with typed states; a `Number:Temperature` item carries a quantity with a unit (e.g., `19.0 °C`), distinct from a `Switch` (`ON`/`OFF`) or `Color` (HSB). State is set via `PUT /rest/items/{name}/state` with `text/plain`. The SSE stream is `GET /rest/events` (`text/event-stream`) with a `topics` query filter (e.g., `openhab/items/{name}/statechanged`). A documented limitation (openhab-core #1363) is that the topic filter "is not flexible enough to retrieve state updates for a specific set of items only" and that the raw `ItemStateChangedEvent` doesn't carry the display-transformed value — motivating a dedicated `/rest/events/states` endpoint that tracks a mutable item set over one SSE connection. This is relevant to Q-A (quantity-with-unit representation) and Q-C (filter expressiveness): openHAB's quantity type maps naturally to HomeSynapse's QuantityValue with a `u` unit field.

## §3 Cross-Cutting Analysis

**Grouping-container deletion is universally unassign-not-cascade.** This is the single strongest cross-system signal. HA unassigns areas from deleted floors and entities/devices from deleted areas; Hue preserves lights when rooms/zones are deleted; openHAB's semantic model groups loosely. No surveyed system destroys leaf data when a grouping container is removed. AMD-44 Decision 11 (409 + affectedAreaIds unless ?force=true, with area_floor_unassigned events before floor_deleted) is therefore correct in spirit and should be locked in — with the explicit clarification that `?force=true` performs *unassignment cascade* (emit `area_floor_unassigned` for each, then `floor_deleted`), never entity destruction.

**Typed payloads: nobody flattens type discriminators into the wire payload, but nobody inlines internal storage tags either.** ESDB keeps typing in an out-of-band envelope (`type`+`content_type`); HA uses JSON-native loose typing; openHAB uses a quantity+unit pair for dimensioned values. The HomeSynapse persistence tagged union `{"t":<AttributeType>,"v":…[,"u":…]}` is an *internal storage* detail. INV-SE-02 (no internal implementation details leak to network) argues strongly against echoing the raw `{"t","v"}` envelope on the wire by default, because `AttributeType` ordinals/names are internal. The Pi-4 serialization budget further argues for the cheapest representation: JSON-native scalars.

**Null-vs-absent in filters is a known foot-gun with three industry solutions.** RFC 7396 JSON Merge Patch resolves it by convention (null = delete/clear, absent = leave untouched) but explicitly warns this makes it "not appropriate for all JSON syntaxes" and that you "cannot distinguish 'delete this field' from 'set it to null'." ESDB sidesteps it with explicit builder calls. The robust pattern for a subscription filter is a sentinel: `floorId: null` = the unassigned bucket (an explicit, queryable value), `floorId` absent = no floor filtering. AMD-44 Decision 10 already chose exactly this; it is well-founded.

**Error model: RFC 9457 with https type URIs is the mainstream choice.** HA uses a bespoke `{code,message}`; but among systems that adopt Problem Details, the type URI is overwhelmingly a resolvable https: URI (Spring's `ErrorResponse.builder().type(URI.create("https://…"))`, Swagger/SmartBear's registry-backed examples, the IANA problem-type registry at `https://www.iana.org/assignments/http-problem-types`). RFC 9457 §3.1.1: "If the type URI is a locator (e.g., those with an 'http' or 'https' scheme), dereferencing it SHOULD provide human-readable documentation for the problem type (e.g., using HTML). However, consumers SHOULD NOT automatically dereference the type URI." urn: is permitted (the RFC allows non-resolvable URIs such as tag:) but Nicolas Frankel (blog.frankel.ch, "Problem Details for HTTP APIs — RFC 7807 is dead, long live RFC 9457") notes: "Using a URI to have a unique ID is not recommended especially from the point of view of integration and use of tools for which providing further information at the Developer Experience level is a fundamental objective."

**Coalescing granularity converges on per-attribute.** Hue's documented 1-second-per-property rate limit is the closest production analog and is explicitly per-property within a resource. HA's data model distinguishes state-change from attribute-change at the attribute level. (entityId, attributeKey) is the correct key.

**WebSocket close codes: 4000-4999 is IANA private-use, safe for application semantics.** Per the IANA WebSocket registry and RFC 6455, 4000-4999 is "Reserved for Private Use" and "can be used by prior agreements between WebSocket applications." There is no registration and low collision risk; browsers/proxies do not assign meaning in this range (1005/1006/1015 are the reserved-not-on-wire codes, all below 4000). Keeping the existing five codes (4403, 4408, 4429, 4409, 4400) is safe.

## §4 Amendment Recommendations

### Disposition of v1 RECs (REC-62..75) — PM-corrected table verified

The PM's corrected disposition (6 ACCEPT, 7 ACCEPT+MODIFY, 1 REJECT) is canonical. New external evidence either confirms or refines each. Each carries a LOC estimate.

**NQ-1 — REC-62: Add nullable `timedInteractionMs` to CommandRequest. Lean: yes. → CONFIRM (ACCEPT).** Hue models timed/transitioned actions as an optional per-command parameter (v1 `transitiontime` deciseconds; v2 `dynamics.duration`); HA passes transition in `service_data`. An optional nullable field on the existing `CommandRequest(3 fields)` (→ 4 fields) is idiomatic and non-breaking. Naming: `timedInteractionMs` is acceptable, but milliseconds is the right unit (Hue's decisecond legacy is widely regretted). **Effort: ~25 LOC** (field + validation + plumb to command handler).

**NQ-2 — REC-63: Rename API scope enum to ApiKeyScope-style. Lean: rename. → CONFIRM (ACCEPT+MODIFY).** GitHub fine-grained PATs call them "permissions"; classic PATs and OAuth call them "scopes" (`X-OAuth-Scopes`); Stripe and Google Cloud use "scopes"/"permissions." Since HomeSynapse binds the scope to an API key (not an OAuth grant), `ApiKeyScope` is the most self-documenting and is preferable to the generic `PermissionScope`/`AccessScope`. **Effort: ~40 LOC** (rename enum + references; mechanical).

**NQ-3 — REC-64: ProblemType.typeUri() use urn: instead of https:. Lean: urn. → OVERRIDE (REJECT the urn switch; keep https).** This is the one override. RFC 9457 §3.1.1 encourages resolvable (http/https) locator URIs that provide human-readable documentation; real adopters (Spring 6 `ProblemDetail`, Swagger/SmartBear, the IANA http-problem-types registry) use https:. Switching to `urn:homesynapse:problem:<slug>` would forfeit future dereferenceability for zero functional gain and contradicts the surveyed consensus. Keep `https://homesynapse.local/problems/<slug>`. (This is the single REJECT in the PM table — confirmed by evidence.) **Effort: 0 LOC** (no change).

**NQ-4 — REC-65: Separate webhook DLQ store from subscriber DLQ + expose at /internal/webhook-failures. Lean: separate. → CONFIRM (ACCEPT).** Webhook reliability literature is unanimous that poison/exhausted-retry events go to a dedicated DLQ "so a single un-processable 'poison' event does not wedge the main pipeline," with per-endpoint isolation in multi-consumer systems. Stripe retries "up to three days with an exponential back off" (Stripe Docs), quantified by a DEV Community writeup ("Why Your Stripe Webhooks Are Failing") as "16 attempts over approximately 3 days, with exponential backoff. After that? The event is gone." Svix/Hookdeck surface failures as a separate reviewable queue; AWS SQS uses a DLQ. Separating webhook DLQ from subscriber DLQ and exposing it at an internal endpoint matches this. Honor INV-SE-02: `/internal/*` must be access-gated. **Effort: ~120 LOC** (separate store table + endpoint + paged listing).

**NQ-5 — REC-66: Conservative WsCloseCode renumbering — keep existing 5 codes, add in available ranges. Lean: keep. → CONFIRM (ACCEPT).** 4000-4999 is IANA private-use; the existing codes (AUTH_FAILED 4403, AUTH_TIMEOUT 4408, CLIENT_TOO_SLOW 4429, SUBSCRIPTION_LIMIT 4409, MALFORMED_MESSAGES 4400) deliberately mirror HTTP semantics (403/408/429/409/400) and are collision-safe. Add new codes in the same range without renumbering. Note the 123-byte reason-string limit (RFC 6455 control-frame cap). **Effort: ~15 LOC per new code.**

**NQ-6 — REC-67: Coalescing key = (entityId, attributeKey) tuple. Lean: this tuple. → CONFIRM (ACCEPT).** Hue's documented per-property 1-second coalescing is the production analog; HA distinguishes change-vs-update at attribute granularity; ESDB does no coalescing (append-only). Per-entity would over-coalesce (drop independent attribute updates); per-attribute-only would lose entity scoping. (entityId, attributeKey) is correct. **Effort: ~60 LOC** (coalescing map keyed on the tuple in the WS send path).

**NQ-7 — REC-68: Rename @Capability → @CapabilityType or @ApiCapability. Lean: one of these. → CONFIRM (ACCEPT), choose @ApiCapability.** Java convention is title-case annotation names that may be nouns/adjectives; frameworks disambiguate by domain (Micronaut `@Introspected`, Spring `@Qualifier`). Given the clash with the device-model sealed `Capability` type, `@ApiCapability` best signals the API-boundary role and avoids confusion with `@CapabilityType` (which reads like it annotates a type-of-capability). **Effort: ~30 LOC** (rename annotation + all usages + processor reference).

**REC-69..75 (remaining v1 items):** Per the PM-corrected table these comprise the balance of the 6 ACCEPT / 7 ACCEPT+MODIFY dispositions (bcrypt constant-time verify path, three-stage backpressure, INV-SE-02 disclosure hardening, RE2/J for untrusted-regex validation, signed-URL WS auth, CLI bootstrap key generation, mTLS rejection rationale). New evidence confirms all:
- **bcrypt timing (REC-69, ACCEPT+MODIFY):** patrickfav/bcrypt (`at.favre.lib:bcrypt`) is the right library; its `verify` uses constant-time comparison. The cache-then-verify pattern (always run a bcrypt verify even on unknown key-id to avoid a timing oracle on key existence) is the correct mitigation. **Effort: ~50 LOC.**
- **RE2/J (REC-72, ACCEPT):** `com.google.re2j` guarantees linear-time matching, eliminating ReDoS from untrusted filter/validation patterns. Per the RE2/J README (github.com/google/re2j): "so RE2/J's performance guarantee makes it suitable for use in applications where the pattern is supplied by untrusted users, such as the clients of a web server." Required for any user-supplied regex at the API boundary. **Effort: ~40 LOC + catalog addition.**
- **mTLS rejection (REC-75, ACCEPT):** mTLS is correctly rejected for consumer smart-home local APIs: "User-facing browser apps … the UX is uniformly hostile"; cert provisioning/rotation overhead "does not pay back at small scale." API keys with strong scoping are the right call. **Effort: documentation only.**

### New RECs for genuinely new scope (REC-106+)

**Q-A — REC-106: Typed attribute value wire format = flattened JSON-native by default, tagged-union envelope behind `?representation=tagged` (or `Accept` profile).** REST event-history responses and WS event frames should expose `oldValue`/`newValue` as JSON-native scalars/arrays by default: BooleanValue→`true`, IntValue→`42`, FloatValue→`21.5`, StringValue→`"foo"`, EnumValue→`"HEATING"`, QuantityValue→`{"value":21.5,"unit":"°C"}` (openHAB-style), ArrayValue→JSON array, DegradedAttributeValue→a defined sentinel object `{"degraded":true,"reason":…}`. The compact persistence envelope `{"t":<AttributeType>,"v":…[,"u":…]}` MUST NOT be the default wire form because `AttributeType` is an internal discriminator (INV-SE-02) and the envelope costs extra bytes on the Pi-4 path. Offer the envelope only behind an explicit opt-in for advanced clients needing exact type fidelity. Float identity: expose floats in their natural decimal form; the bit-anchored identity is a storage concern and need not surface. Rationale anchored in ESDB (out-of-band typing), HA (JSON-native), openHAB (quantity+unit). **Effort: ~180 LOC** (serializer for 8 AttributeValue variants + representation negotiation + tests). Requires the new `com.homesynapse.value` module to be a readable dependency of `com.homesynapse.api.rest`.

**Q-B — REC-107: Entity-state REST representation exposes all three event-time timestamps + wall-clock stale/staleAfter.** Expose `lastChanged`, `lastUpdated`, `lastReported` (all event-time-deterministic per AMD-53) plus `stale`/`staleAfter` (wall-clock carve-out). This mirrors HA's documented triad exactly (`last_changed` = value changed; `last_updated` = any state write; `last_reported` = every report, added 2024-03-20). Document the event-time vs wall-clock split explicitly in the field descriptions so clients don't treat `staleAfter` as replay-deterministic. **Effort: ~50 LOC** (5 fields on the entity-state DTO + serialization + doc).

**Q-C — REC-108: Floors/EntityRole REST+WS surface with unassign-on-delete.** Implement `/api/v1/floors` CRUD. DELETE returns **409 Conflict** with a ProblemDetail extension `affectedAreaIds` when the floor has assigned areas, unless `?force=true`, in which case emit one `area_floor_unassigned` event per area, then `floor_deleted` (Decision 11). `?force=true` performs *unassignment*, never area/entity deletion — this is the universal peer pattern (HA sets `area.floor_id=None`; Hue preserves lights). Store the association as `floorId` ON the entity/area (HA precedent: `AreaEntry.floor_id`), not a junction table. Add `?floorId=` and `?entityRole=` query filters on entity collections. **Effort: ~260 LOC** (floors controller + CRUD + cascade-check + filter wiring + events).

**Q-C — REC-109: WS subscription filter null-vs-absent sentinel semantics.** In `WsSubscriptionFilter` (the 10-field record), `floorId: null` = the unassigned bucket (entities with no floor); `floorId` absent = no floor filtering. Same for `entityRole`. Document this against RFC 7396's null=clear convention while noting the deliberate divergence (here null is a *queryable value*, not a clear). Because the filter is a record with nullable fields, distinguish "present-and-null" from "absent" at the JSON binding layer — with Jackson 2.x (LTD-08) use a wrapper/`JsonNode` probe or an `Optional`-style presence flag, since a plain nullable record field cannot natively distinguish the two. **Effort: ~90 LOC** (presence-aware deserialization + filter predicate + tests).

**Q-C — REC-110: Floor-move tombstone on filtered subscriptions.** When a client is subscribed to `floorId=X` and an entity moves to floorId=Y, send an explicit `entity_unsubscribed` tombstone frame (entity left the filter set) rather than silently ceasing updates — peers like openHAB force reconnect for filter changes, which is worse UX. A tombstone lets the client update its local model. **Effort: ~70 LOC** (move-detection in the WS fan-out + tombstone frame type; note ErrorMsg/PingMsg/PongMsg already define the WsMessage sealed permits, so a new permit must be added to the sealed interface).

## §5 Caveats and Open Questions

- **Hue cascade-delete prose is inferred, not directly quoted.** Signify's authoritative "deleting a room does not delete its lights" sentence sits behind the login-gated developer portal. The conclusion is strongly supported by the verbatim bridge resource model (children as `{rid,rtype}` references, from home-assistant/core issue #66496), the delete-response returning only the room's own rid, and documented v1 group semantics — but it is inference from primary artifacts, not a single quoted official statement.
- **HA floor_registry.py exact verbatim lines** for create/update/delete were confirmed by code-pattern parity with area_registry.py (which was quoted verbatim) and by the directly-confirmed `config/floor_registry/list`; GitHub's permission wall blocked line-by-line quoting of the floor file. The unassign-on-floor-delete behavior, however, was quoted verbatim from `helpers/area_registry.py` and the user docs.
- **REC-109 presence detection with Jackson 2.x (LTD-08)** is the riskiest implementation: a plain Java record with a nullable field cannot natively distinguish absent from present-null. The wrapper/JsonNode approach adds complexity; this should be prototyped before committing the 10-field record shape.
- **Float bit-anchored identity (Q-A)**: exposing natural decimal form means round-trip GET→PUT may not preserve exact bits. If any client needs exact float identity (unlikely for a smart-home API), the tagged representation must carry it — flagged as open.
- **swagger-core, com.google.re2j, at.favre.lib:bcrypt are NOT in the dependency catalog.** Each REC depending on them (REC-69 bcrypt, REC-72 RE2/J) requires an explicit catalog-addition proposal with a pinned version. javalin is pinned at 6.7.0; Jackson is 2.x-locked by LTD-08. These additions are not yet approved.
- **No homesynapse.* event prefix** — confirmed against inventory; event naming is snake_case legacy (state_changed, state_reported, config_changed) plus subsystem-dot-form (automation.run.started, config.section_reloaded). New tombstone/unassign events (`area_floor_unassigned`, `entity_unsubscribed`) follow the snake_case legacy form to match siblings.

## §6 Sources (primary, with URLs)

- Home Assistant WebSocket API — https://developers.home-assistant.io/docs/api/websocket/
- Home Assistant REST API — https://developers.home-assistant.io/docs/api/rest/
- Home Assistant State object (3 timestamps) — https://www.home-assistant.io/docs/configuration/state_object/
- Home Assistant States data model (last_changed vs last_updated) — https://data.home-assistant.io/docs/states/
- Home Assistant State.last_reported announcement (2024-03-20) — https://developers.home-assistant.io/blog/2024/03/20/state_reported_timestamp/
- Home Assistant 2024.4 Floors release — https://www.home-assistant.io/blog/2024/04/03/release-20244/
- Home Assistant Floors docs ("become unassigned") — https://www.home-assistant.io/docs/organizing/floors/
- Home Assistant area_registry.py (source) — https://github.com/home-assistant/core/blob/dev/homeassistant/helpers/area_registry.py
- Home Assistant config/area_registry.py (WS commands) — https://github.com/home-assistant/core/blob/dev/homeassistant/components/config/area_registry.py
- Philips Hue New API V2 announcement — https://developers.meethue.com/new-hue-api/
- Philips Hue v2 SSE event-stream 1s rate limit (forum quoting Signify docs) — https://ccforum.userecho.com/communities/4/topics/10569-philips-hue-api-v2-events-server-side-events
- Philips Hue v2 room resource model (verbatim bridge JSON, HA issue #66496) — https://github.com/home-assistant/core/issues/66496
- openHAB Hue v2 binding (room/zone/device model) — https://www.openhab.org/addons/bindings/hue/doc/readme_v2.html
- openHAB REST API docs — https://www.openhab.org/docs/configuration/restdocs.html
- openHAB SseResource (SSE endpoint) — https://www.openhab.org/javadoc/latest/org/openhab/core/io/rest/sse/sseresource
- openHAB flexible state-SSE RFC (#1363) — https://github.com/openhab/openhab-core/issues/1363
- openHAB Hue v2 transition time (#15323) — https://github.com/openhab/openhab-addons/issues/15323
- EventStoreDB catch-up subscription filtering — https://developers.eventstore.com/clients/grpc/subscribing-to-streams/filtering.html
- EventStoreDB server-side filtering (Kurrent blog) — https://www.kurrent.io/blog/server-side-filtering/
- KurrentDB/ESDB Python client (NewEvent envelope) — https://github.com/pyeventsourcing/kurrentdbclient
- RFC 9457 Problem Details — https://datatracker.ietf.org/doc/html/rfc9457
- RFC 9457 (RFC Editor) — https://www.rfc-editor.org/info/rfc9457/
- RFC 7807 → 9457 commentary (Frankel, urn not recommended) — https://blog.frankel.ch/problem-details-http-apis/
- Swagger/SmartBear Problem Details adoption — https://swagger.io/blog/problem-details-rfc9457-api-error-handling/
- Spring RFC 9457 ProblemDetail (https type URI example) — https://medium.com/@RoussiAbdelghani/error-handling-in-spring-web-using-rfc-9457-specification-f2cc8398e285
- RFC 7396 JSON Merge Patch — https://datatracker.ietf.org/doc/html/rfc7396
- IANA WebSocket Close Code registry (4000-4999 private use) — https://www.iana.org/assignments/websocket/websocket.xml
- WebSocket.org close codes reference — https://websocket.org/reference/close-codes/
- RFC 6455 / Netty WebSocketCloseStatus (4000-4999 private use) — https://netty.io/4.1/api/io/netty/handler/codec/http/websocketx/WebSocketCloseStatus.html
- GitHub fine-grained PAT permissions — https://github.blog/security/application-security/introducing-fine-grained-personal-access-tokens-for-github/
- GitHub OAuth scopes (X-OAuth-Scopes) — https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
- Stripe webhook retry/DLQ troubleshooting — https://support.stripe.com/questions/troubleshooting-webhook-delivery-issues
- Stripe webhook failure analysis (16 attempts / 3 days) — https://dev.to/eventdock/why-your-stripe-webhooks-are-failing-and-how-to-fix-it-7hb
- Webhook reliability reference (DLQ isolation) — https://www.digitalapplied.com/blog/webhook-reliability-idempotency-retries-engineering-reference-2026
- patrickfav/bcrypt (constant-time verify) — https://github.com/patrickfav/bcrypt
- RE2/J linear-time regex (README) — https://github.com/google/re2j
- mTLS vs API key for IoT/consumer — https://guptadeepak.com/ciam-compass/guides/mtls-explained/

## §7 Code-Level Implications

This section honors the QUOTE-BACK RULE: each proposed change first quotes the verbatim module-info.java block at e73e199, then shows the diff. Every type reference cites the verified inventory. **The v1 §7 fabricated a JPMS module-info.java (CRITICAL); that fabrication is discarded and replaced below by the verified blocks.**

### 7.1 Verbatim baseline — api/rest-api module-info.java @ e73e199
```java
module com.homesynapse.api.rest {
    requires transitive com.homesynapse.state;
    requires com.homesynapse.event.bus;
    requires io.javalin;
    requires org.slf4j;
    exports com.homesynapse.api.rest;
}
```

### 7.2 Verbatim baseline — api/websocket-api module-info.java @ e73e199
```java
module com.homesynapse.api.ws {
    requires transitive com.homesynapse.api.rest;
    exports com.homesynapse.api.ws;
}
```

### 7.3 REC-106 / REC-107 (Q-A, Q-B) — new value-model dependency
Q-A and Q-B require the REST module to read the new `com.homesynapse.value` module (AttributeValue sealed hierarchy of 8 variants + AttributeType). Proposed diff against 7.1:
```diff
 module com.homesynapse.api.rest {
     requires transitive com.homesynapse.state;
     requires com.homesynapse.event.bus;
+    requires com.homesynapse.value;
     requires io.javalin;
     requires org.slf4j;
     exports com.homesynapse.api.rest;
 }
```
Rationale: the AttributeValue serializer (REC-106) and the entity-state DTO timestamps (REC-107) live in `com.homesynapse.api.rest`. `requires com.homesynapse.value` (non-transitive) suffices since AttributeValue types appear only in serialization internals, not re-exported API signatures. The WS module (7.2) needs no change because it `requires transitive com.homesynapse.api.rest` and thus transitively sees what rest exports. No direct Jetty/jakarta.servlet require is added (Javalin abstraction only). No ServiceLoader (DECIDE-04). Per LTD-08, the serializer uses Jackson 2.x; the 8-variant sealed `AttributeValue` is serialized with an explicit per-variant writer (no reflection-based polymorphic typing that would leak `AttributeType`).

The affected verified types: `CommandRequest(3 fields)`, `CommandAcceptedResponse(6 fields)`, `CommandStatusResponse(8 fields)`, `PagedResponse<T>(data, pagination, meta)`, and the entity-state DTO. REC-107 adds five fields (`lastChanged`, `lastUpdated`, `lastReported`, `stale`, `staleAfter`) to the entity-state representation; the three activity timestamps are event-time-deterministic (AMD-53), stale/staleAfter wall-clock.

### 7.4 REC-62 (NQ-1) — CommandRequest timed field
Affects the verified `CommandRequest(3 fields)` under `POST /api/v1/entities/{entity_id}/commands`. Adds a nullable `timedInteractionMs` → 4 fields. No module-info change (purely additive within `com.homesynapse.api.rest`). Validation must reject negative values; null = immediate (untimed). FloorId and other typed ULID wrappers (LTD-04, Crockford Base32 at API boundaries) are unaffected.

### 7.5 REC-64 (NQ-3) — ProblemType unchanged
The verified error model is `ProblemDetail(7 fields)` + `ProblemType(13 values + STATE_STORE_REPLAYING)` with `typeUri()` currently returning `https://homesynapse.local/problems/<slug>`. **No change** — the urn: switch is rejected (§4 NQ-3). No module-info impact.

### 7.6 REC-66 (NQ-5) — WsCloseCode additions
The verified `WsCloseCode` enum holds the five existing codes: AUTH_FAILED(4403), AUTH_TIMEOUT(4408), CLIENT_TOO_SLOW(4429), SUBSCRIPTION_LIMIT(4409), MALFORMED_MESSAGES(4400). New codes are appended in the 4000-4999 private-use range without renumbering. Lives in `com.homesynapse.api.ws` (7.2); no module-info change.

### 7.7 REC-110 (Q-C) — new WsMessage permit
The verified `WsMessage` is a sealed interface permitting PingMsg(id), PongMsg(id, serverTime), ErrorMsg(id?, errorType, detail, fatal) — note there is **NO "WsErrorMsg"** type (the correct name is `ErrorMsg`). Adding an `entity_unsubscribed` tombstone (REC-110) requires adding a new permitted record to the sealed `WsMessage` interface and to `WsClientState`/`WsSubscription` handling. This is confined to `com.homesynapse.api.ws`; no module-info change. The new frame must use snake_case event naming to match siblings (no homesynapse.* prefix; no `EntityStateChanged` type — events are data, not classes).

### 7.8 REC-67 (NQ-6) — coalescing in WS send path
Coalescing keyed on (EntityId, attributeKey) lives in the WS fan-out within `com.homesynapse.api.ws`. EntityId is one of the NINE typed ULID wrappers (LTD-04: DeviceId, EntityId, AreaId, IntegrationId, AutomationId, PersonId, HomeId, SystemId, FloorId). Use ReentrantLock not synchronized for the coalescing map guard (LTD-11, virtual threads). No module-info change.

### 7.9 REC-72 / REC-69 — catalog additions required
`com.google.re2j` (RE2/J, REC-72) and `at.favre.lib:bcrypt` (REC-69) are NOT in the dependency catalog and require explicit catalog-addition proposals with pinned versions before any `requires` can be added to a module-info. If RE2/J validation lives in `com.homesynapse.api.rest`, a future diff would add `requires com.google.re2j;` to 7.1 — but only after catalog approval. Same for bcrypt (likely in a security/auth module, not necessarily rest). swagger-core is likewise absent and must not be assumed available. javalin remains pinned at 6.7.0.

### 7.10 REC-108 / REC-109 (Q-C) — floors surface, no module-info change
The floors controller, `?floorId=`/`?entityRole=` filters, and the presence-aware `WsSubscriptionFilter` (10-field record) deserialization all live within the existing rest/ws modules. FloorId is already among the NINE typed ULID wrappers, so no new identity type is needed. The 409+affectedAreaIds response reuses `ProblemDetail(7 fields)` with an extension member. Per LTD-09, any YAML config touched uses the existing YAML config path; no new config mechanism. No module-info change beyond 7.3's `requires com.homesynapse.value` (needed only if floor DTOs reference AttributeValue, which they do not — so REC-108/109 alone require zero module-info edits).