# HomeSynapse Core — Identity and Addressing Model

**Document type:** Governance (Foundations Layer)
**Status:** Draft
**Version:** 1.0
**Effective date:** 2026-02-22
**Owner:** nick@nexsys.io
**Register:** A (Senior Engineer)
**Companion document:** Glossary v1

---

## 0. About This Document

This document specifies how addressable objects in HomeSynapse are identified, referenced, and resolved. It is the operational complement to the Glossary: the Glossary defines *what terms mean*; this document defines *how identity works*.

Identity is not a formatting concern. It is a structural contract that determines whether automations survive device replacements, whether event logs remain queryable across schema upgrades, and whether the system can be refactored without cascading breakage. Every design document, API specification, and event schema must conform to the rules defined here.

### 0.1 Relationship to other artifacts

| Artifact | Relationship |
|---|---|
| Glossary v1 | Defines concept terms, UI terms, and API token names. This document specifies the formats, generation rules, uniqueness scopes, and operational semantics for those tokens. |
| Architecture Invariants v1 | This document operationalizes INV-CS-02 (stable identifiers), INV-CE-04 (protocol agnosticism), INV-TO-02 (automation determinism), and INV-ES-06 (explainable state). Cited by INV-XX-NN. |
| Locked Technical Decisions Register v1 | LTD-04 (ULID), LTD-05 (per-entity sequences), LTD-03 (SQLite WAL) constrain storage and encoding. Cited by LTD-NN. |
| Design Document Template | Subsystem designs reference this document for all identity and addressing rules. |
| MVP Scope | §4 tiered approach determines which addressing modes are MVP-active vs. reserved. |

### 0.2 Scope

This document defines:

- The three-layer identity architecture (Reference, Slug, Path)
- Identifier formats, encoding, and storage rules
- Slug generation, collision resolution, and retention
- Path composition
- URN form for external interchange
- Identity lifecycle (creation, immutability, soft-delete, no-reuse)
- Device Replacement semantics
- Address resolution primitives and guarantees
- Hardware Identifier mapping rules

This document does not define:

- Automation selector vocabulary (owned by Automation Engine, design document 07)
- Event schema structure (owned by Event Model & Event Bus, design document 01)
- Database table layouts (owned by Persistence Layer, design document 04)
- API endpoint design (owned by REST API, design document 09)

### 0.3 Amendment process

Amendments to identifier formats or addressing rules require:

1. A pull request modifying this document with a rationale section.
2. An impact analysis identifying every design document, schema, and API surface affected.
3. Review by the architecture owner.
4. A migration note in this document and in the relevant changelog.

---

## 1. Foundational Principles

Five principles govern every identity and addressing decision. Each is referenced by at least one rule later in this document.

**P1 — Identity is opaque and stable.** An identifier carries no semantic content. It does not encode type, protocol, area, name, or hierarchy. It is assigned once and never changes. The only operation an identifier supports is equality comparison. This principle exists because Home Assistant's `domain.object_id` scheme — where `light.kitchen_ceiling` encodes entity type, area, and name into the identity — is the single most documented source of breakage in that ecosystem (INV-CS-02).

**P2 — Addressing is contextual and deterministic.** An address locates an object within a context (a Home, a UI breadcrumb, a log line). Addresses may change when the context changes (a rename, a move). Addresses resolve to a concrete set of References. Resolution is deterministic: the same address evaluated against the same state always produces the same set. This principle enables automation replay (INV-TO-02).

**P3 — Names are presentation.** Display Names are free-form user-facing strings. They are the source from which Slugs are derived. They carry no uniqueness guarantees and no system semantics. Two Entities in the same Area may share a Display Name. Names exist for humans; References exist for machines.

**P4 — Hierarchy is organization, not identity.** Home → Floor → Area → Device → Entity is a spatial and logical hierarchy. It informs the UI, log messages, and Path composition. It does not participate in identity. Moving an Entity to a different Area changes its Path but not its Reference.

**P5 — Protocol is implementation, not identity.** A Zigbee IEEE address, a Matter Node ID, an IP address — these are Hardware Identifiers used internally by Integrations for protocol-level communication. They never appear in References, Slugs, Paths, or any user-facing or automation-facing context. When a device changes protocol (Zigbee bulb replaced with Matter equivalent), the Hardware Identifiers change; the Reference does not (INV-CE-04).

---

## 2. The Three-Layer Identity Architecture

Every addressable object in HomeSynapse participates in three identity layers. Each layer serves a distinct audience and carries distinct stability guarantees.

### 2.1 Layer 1 — Reference (machine identity)

A Reference is a ULID-based identifier that serves as the immutable, opaque, internal identity of any addressable object.

**Format.** 128-bit ULID per LTD-04.

| Representation | Format | Used In |
|---|---|---|
| Binary | 16 bytes (BLOB(16)) | SQLite storage, internal Java objects |
| Text | 26-character Crockford Base32 | API responses, event payloads, log output, configuration files |

**Generation.** References are generated by HomeSynapse at the moment an object is *adopted* into the system — not at discovery, not at proposal, not at external creation. The `UlidCreator.getUlid()` method (LTD-04) produces non-monotonic ULIDs; monotonic mode (`getMonotonicUlid()`) is reserved for event IDs where within-millisecond ordering matters.

**Properties.**

- Immutable. A Reference is assigned once and never changes, regardless of renames, moves, protocol changes, or device replacements.
- Opaque. No information can be inferred from a Reference's value. The embedded timestamp is an implementation detail of ULID, not a semantic property.
- Globally unique by construction. ULID's 48-bit timestamp + 80-bit randomness produces a collision probability of <10⁻²⁴ per millisecond. References are unique within a Home and unique across all Homes without coordination.
- Time-ordered. ULIDs sort lexicographically by creation time. This is a useful debugging property, not a contract that consumers should depend on for correctness.

**API token convention.** The `*_id` suffix denotes a Reference used as a primary key (`entity_id`, `device_id`, `area_id`). The `*_ref` suffix denotes the same ULID used as a foreign key in event payloads, automation bindings, and permission targets (`entity_ref`, `subject_ref`, `target_ref`). The values are identical — the suffix signals intent, not a different type.

**The binding key rule.** References are the **only** identifiers used for durable machine-to-machine binding. Automations bind to `entity_ref`. Events record their subject as `entity_ref`. Permissions target `object_ref`. No system stores a Slug or Path as a binding key. This rule is the operational mechanism for INV-CS-02: because bindings use References and References never change, renaming or moving an object never breaks an automation, event query, or permission grant.

### 2.2 Layer 2 — Slug (human-readable key)

A Slug is a human-readable, URL-safe, mutable string derived from a Display Name.

**Format.** Lowercase ASCII alphanumeric characters and hyphens. No leading or trailing hyphens. No consecutive hyphens. Maximum length: 128 characters.

**Generation algorithm.**

1. Take the object's Display Name.
2. Transliterate to ASCII (ü → u, é → e, ñ → n). Use `java.text.Normalizer` (NFD) then strip combining marks.
3. Replace non-alphanumeric characters (including spaces) with hyphens.
4. Collapse consecutive hyphens to a single hyphen.
5. Strip leading and trailing hyphens.
6. Truncate to 128 characters at a hyphen boundary (do not split words).
7. If the result is empty (e.g., Display Name was entirely non-ASCII symbols), generate `unnamed-{short-ulid-suffix}` where the suffix is the last 6 characters of the object's Reference.

**Normalization and uniqueness checking.** Uniqueness is always checked against the normalized, stored form of the slug — the lowercase ASCII output of the generation algorithm. "Kitchen" and "kitchen" produce the identical stored slug `kitchen` and are therefore the same slug. There is no case-sensitive or pre-normalization comparison path.

**Uniqueness is per-type.** Slug uniqueness is scoped to `(home, addressable_type)`. The same slug string may exist simultaneously as an entity slug and an area slug without collision — `kitchen` as an `area_slug` and `kitchen` as an `entity_slug` are independent. This reflects the fact that Paths disambiguate by structure (`home/kitchen` is an Area; `home/kitchen/kitchen` is an Entity in that Area), and URN forms disambiguate by type segment. Slug tombstones (below) are also per-type: a tombstoned entity slug does not block creation of an area slug with the same string.

**Collision resolution.** When generation produces a collision within the same `(home, addressable_type)` scope:

1. The system appends `-2` to the base slug.
2. If `-2` collides, increment to `-3`, `-4`, etc., choosing the lowest available suffix.
3. The disambiguation is deterministic: given the same set of existing slugs, the same input always produces the same output.

**Rename behavior.** When a user changes an object's Display Name, the Slug is regenerated from the new name. If the user has previously set a manual slug override, the rename does not affect the slug unless the user explicitly requests re-derivation.

**Manual override.** The API allows setting a slug explicitly via a `PATCH` or `PUT` operation. The requested slug must pass format validation and uniqueness checks. If the requested slug is taken, the API returns a `409 Conflict` response identifying the current owner.

**Slug retention and tombstones.** When an object is renamed or soft-deleted, its previous slug enters a tombstone table:

| Column | Type | Description |
|---|---|---|
| `slug` | TEXT | The former slug value |
| `slug_type` | TEXT | The addressable type (`entity`, `device`, `area`, `automation`, `person`) |
| `owner_ref` | BLOB(16) | The Reference of the object that formerly held this slug |
| `retired_at` | TEXT (ISO 8601) | When the slug was released |
| `expires_at` | TEXT (ISO 8601) | When the tombstone expires and the slug becomes reusable |

Tombstone retention period: 90 days for renames, indefinite for soft-deletes (until the soft-deleted object is permanently purged). During the retention period, no other object may claim the tombstoned slug. An API request for a tombstoned slug returns a `301` redirect (or equivalent) to the object's current slug. This prevents link hijacking and user confusion when bookmarks or shared URLs reference a renamed object.

**Soft-deleted objects hold their slug.** A soft-deleted entity retains its slug reservation for the duration of the soft-delete retention window. The slug does not become available for reuse until the entity is permanently purged. This prevents the scenario where a user deletes `kitchen-thermostat`, creates a new entity that claims the slug, and then restores the original — creating an identity collision.

**No semantic guarantees.** Clients must never infer type, area, protocol, or Display Name from a slug. Slugs are presentation-layer conveniences. Any system that parses a slug for meaning is broken by design.

### 2.3 Layer 3 — Path (display address)

A Path is a hierarchical string composed from Slugs that locates an object within the Home's organizational structure.

**Composition rules.**

| Object Type | Path Format | Example |
|---|---|---|
| Home | `{home_slug}` | `home` |
| Area | `{home_slug}/{area_slug}` | `home/kitchen` |
| Device | `{home_slug}/{area_slug}/{device_slug}` | `home/kitchen/hue-motion-sensor` |
| Entity | `{home_slug}/{area_slug}/{entity_slug}` | `home/kitchen/ceiling-light` |
| Entity (area override) | `{home_slug}/{entity_area_slug}/{entity_slug}` | `home/bedroom/temperature` |
| Automation | `{home_slug}/automations/{automation_slug}` | `home/automations/morning-lights` |
| Device (no area) | `{home_slug}/_unassigned/{device_slug}` | `home/_unassigned/new-sensor` |

The `_unassigned` segment is a synthetic path component for objects without an area assignment. It is not an Area.

**Separator.** Forward slash (`/`). Slugs must not contain forward slashes (enforced by the slug format rules).

**Properties.**

- Mutable. When a slug changes (rename) or an area assignment changes (move), the Path changes.
- Not a binding key. Paths are never stored in automation definitions, event payloads, or permission grants. They exist for UI breadcrumbs, log messages, configuration file references, and debugging output.
- Not globally unique across Homes. Two Homes may produce identical Paths. The URN form (§2.4) provides global uniqueness when needed.

### 2.4 URN Form (external interchange)

The URN form provides an unambiguous, globally unique address for use in API responses, webhook payloads, and external integrations.

**Format.** `hs:{home_id}/{type}/{object_id}`

| Component | Description | Example |
|---|---|---|
| `hs:` | Scheme prefix | `hs:` |
| `{home_id}` | Home's Reference (26-char ULID) | `01HQX7K3...` |
| `{type}` | Object type discriminator | `entity`, `device`, `area`, `automation`, `person` |
| `{object_id}` | Object's Reference (26-char ULID) | `01HQY8M2...` |

**Example.** `hs:01HQXYZ.../entity/01HQYABC...`

**Properties.**

- Deterministic. Given a Reference and its type, the URN form is computed without lookup.
- Globally unique. The combination of `home_id` and `object_id` is unique across all HomeSynapse installations.
- Stable. URN forms change only if the Home's Reference changes (which it does not — `home_id` is immutable).
- Uses References, not Slugs. URN forms survive renames.

---

## 3. What Is Identifiable

Not every concept in HomeSynapse carries a Reference. The following table defines which objects are addressable and at which identity layer.

| Object | Reference (`*_id`) | Slug (`*_slug`) | Path | URN Form | Notes |
|---|---|---|---|---|---|
| Home | `home_id` | `home_slug` | Root | `hs:{home_id}` | One per installation |
| Area | `area_id` | `area_slug` | Yes | `hs:.../area/...` | Flat within Home |
| Floor | `floor_id` | `floor_slug` | No | No | Grouping only; Tier 2 |
| Zone | `zone_id` | `zone_slug` | No | No | Reserved; Tier 2+ |
| Device | `device_id` | `device_slug` | Yes | `hs:.../device/...` | Container for Entities |
| Entity | `entity_id` | `entity_slug` | Yes | `hs:.../entity/...` | Primary addressable unit |
| Automation | `automation_id` | `automation_slug` | Yes | `hs:.../automation/...` | — |
| Person | `person_id` | `person_slug` | No | `hs:.../person/...` | Multi-user identity |
| Label | `label_id` | `label_slug` | No | No | Cross-cutting tag |
| Integration | `integration_id` | — | No | No | Internal; no slug needed |
| Event | `event_id` | — | No | No | Immutable fact; no slug or path |
| Capability | `capability_id` (string key) | — | No | No | Not ULID; string key by design |

**What identity does not guarantee.** A Reference guarantees stable, opaque identification. It does not guarantee that the object exists, is active, or is reachable. An Entity may be soft-deleted, disabled, or unavailable while its Reference remains valid. Consumers that resolve a Reference must handle absence.

---

## 4. Identity Lifecycle

### 4.1 Creation

Identity is created at the moment an object is **adopted** into the system. The precise trigger varies by object type:

| Object | Creation Trigger | Who Creates |
|---|---|---|
| Home | First run of HomeSynapse process | System (automatic) |
| Device | User confirms adoption of a discovered device, or manual creation via API | System, on user action |
| Entity | Device adoption (automatic for discovered Entities) or explicit Helper creation | System or Integration |
| Area | User creates via UI or configuration | System, on user action |
| Automation | User creates via UI, API, or configuration | System, on user action |
| Person | User creates via UI or configuration | System, on user action |
| Label | First use (created implicitly when assigned) or explicit creation | System |

**Discovery does not create identity.** When an Integration discovers a device on its protocol network, the device carries only Hardware Identifiers. A `device_discovered` event records the proposal. The device receives a `device_id` only when adopted — when the user confirms or auto-adoption policy accepts it. This prevents phantom objects from accumulating in the identity space.

**Device adoption is idempotent by Hardware Identifier.** If an Integration proposes adoption of a device whose Hardware Identifier tuple already matches an existing Device within that Integration, the system returns the existing Device's Reference rather than creating a duplicate. This handles re-pairing after power loss, coordinator restarts, and duplicate discovery events. Matching is Integration-scoped (§6.2).

**All other creation uses explicit client-driven idempotency.** The API accepts an optional `Idempotency-Key` header (or request field) on creation endpoints. The server stores `(actor_ref, route, idempotency_key) → result_ref` for 24 hours. A repeated request with the same key returns the original result without side effects. If no Idempotency-Key is provided, every request creates a new object — the system does not silently deduplicate based on name similarity, timing, or heuristics. This is a deterministic, auditable contract with no time-window ambiguity.

**No implicit deduplication for user-created objects.** The system does not merge or collapse creation requests based on Display Name, Area, or type matching. Two Areas named "Kitchen" created without an Idempotency-Key produce two distinct Areas with two distinct References. If the UI needs to prevent double-click duplicates, it implements a client-side pending-create lock. Duplicates are user-visible and user-correctable, never silently merged.

### 4.2 Immutability

Once assigned, a Reference never changes. The following operations do not affect an object's Reference:

- Renaming (Display Name change, Slug change)
- Moving to a different Area
- Changing the parent Device's Area
- Enabling or disabling
- Changing the backing protocol (Device Replacement)
- Updating firmware
- Changing Capabilities (adding or removing)
- Soft-deleting
- Restoring from soft-delete

No operation in the system mutates a Reference. If a code path appears to require changing a Reference, the design is wrong — the correct approach is to create a new object with a new Reference and, if continuity matters, record a `supersedes` relationship.

### 4.3 No Reuse

A Reference is never reassigned to a different object. If Entity `01HQY...` is permanently deleted, that ULID is retired. No future Entity may receive the same ULID. This is guaranteed by ULID's construction (timestamp + random bits make reuse astronomically improbable) and by policy (the system never stores and re-issues References).

This rule extends to Slugs during the tombstone retention period (§2.2). After tombstone expiration, a slug may be claimed by a new object — but the Reference of the deleted object remains retired.

### 4.4 Soft-Delete

Soft-delete marks an object as inactive without removing its data or releasing its identity.

**Soft-delete behavior.**

- The object's Reference remains valid and reserved.
- The object's Slug remains reserved (§2.2).
- The object's events remain in the Event Log (subject to retention policy).
- The object does not appear in default API queries or UI views (filter: `active=true`).
- The object is retrievable via explicit query (`GET /entities/{id}` returns the object with `deleted_at` populated).
- Automation bindings referencing a soft-deleted entity evaluate as "target unavailable" — the automation logs a warning and skips the action, per the resolution failure rules in §7.5.
- A soft-deleted object can be restored. Restoration clears `deleted_at`, re-activates the slug, and produces a `restored` event.

**Soft-delete retention.** Soft-deleted objects are retained for a configurable period (default: 30 days). After the retention period, the system may permanently purge the object. Purging releases the slug tombstone for eventual reuse but does not release the Reference (§4.3).

**Event.** Soft-delete produces a `{type}_deleted` event (e.g., `entity_deleted`, `device_deleted`). The event records the actor who initiated deletion and a reason field.

### 4.5 No Resurrection After Purge

Once an object is permanently purged (past the soft-delete retention window), it cannot be restored. Its Reference remains retired. Its events remain in the Event Log (events are never deleted by object purge — they are removed only by retention policy). Creating a "replacement" for a purged object produces a new object with a new Reference.

This rule exists because resurrection after purge would create a gap in the event stream — the object would appear to have no events during the purge window, breaking the "state is derivable from events" guarantee (INV-ES-02).

---

## 5. Device Replacement

Device Replacement is the operation that makes identity durable across physical hardware changes. It is the single most important identity operation in a smart home platform, because hardware fails and users upgrade.

### 5.1 What Replacement Preserves

When a physical device is replaced with compatible hardware, the following are preserved:

| Preserved | Mechanism |
|---|---|
| Entity References (`entity_id`) | Unchanged; binding key rule (§2.1) |
| All Automation bindings | Bind to `entity_ref`, which does not change |
| All historical Events | Events reference `entity_ref`; history is continuous |
| Area assignment | Metadata on Entity; unchanged |
| Labels | Metadata on Entity; unchanged |
| Display Names | Metadata on Entity; unchanged |
| Slugs | Derived from Display Name; unchanged |
| Materialized state | Rebuilt from events; continuous |

### 5.2 What Replacement Changes

| Changed | Mechanism |
|---|---|
| Hardware Identifiers | New device has different protocol addresses |
| Protocol Binding | New device may use different protocol-level mapping |
| Device metadata | Manufacturer, model, firmware may differ |
| `device_id` | See §5.3 |

### 5.3 Same-Integration vs. Cross-Integration Replacement

**Same-Integration replacement** (e.g., Zigbee bulb → Zigbee bulb): The Device retains its `device_id`. The Integration updates the Hardware Identifiers and Protocol Binding. The Entity References are unaffected.

**Cross-Integration replacement** (e.g., Zigbee bulb → Matter bulb): The old Device is soft-deleted. A new Device is created under the new Integration with a new `device_id`. The user (or migration tooling) then *transfers* Entities from the old Device to the new Device. Entity transfer preserves `entity_id` — the Entity's `device_id` foreign key is updated, but the Entity's own Reference does not change.

**Entity transfer invariants:**

- **Single parent.** After transfer, an Entity has exactly one parent Device. The old parent relationship is severed atomically with the new one being established.
- **Atomicity.** Transfer is atomic per Entity. If a batch transfer covers multiple Entities, each individual transfer either completes fully or does not occur. Automations never observe a half-transferred topology where some Entities reference the old Device and others the new.
- **Batch correlation.** A multi-Entity replacement produces one `entity_transferred` event per Entity, plus a shared `correlation_id` linking all events in the batch. Debug, replay, and UI can group them as a single replacement operation.

**Capability compatibility.** Replacement requires that the new Device exposes a superset of the replaced Entities' Capability keys. If the new Device lacks a Capability key that the old Device provided (e.g., old device had `color_temperature`, new device is dimmer-only), the affected Entity is flagged as `degraded` and the user is warned. Automations targeting the missing Capability produce eligibility failures (§7.5) rather than silent drops.

MVP compatibility checks operate at the Capability key level. Future tiers may introduce **Capability profiles** — structured descriptions of supported features and constraints within a Capability (color temperature range, min/max dim level, supported HVAC modes) — enabling finer-grained compatibility assessment. The current design does not prevent this refinement.

**Cross-Integration replacement is always user-initiated.** The system never automatically matches devices across Integrations. Future tiers may offer *assisted suggestions* based on user-confirmed signals (same physical location, same label set, similar Capability profile) presented for explicit user confirmation — but never automatic execution.

### 5.4 Transfer Event

Every Entity transfer produces an `entity_transferred` event:

| Field | Value |
|---|---|
| `event_type` | `entity_transferred` |
| `subject_ref` | The Entity being transferred |
| `reason` | `device_replacement`, `reorg`, or future-defined reasons |
| `old_device_ref` | Reference of the source Device |
| `new_device_ref` | Reference of the destination Device |
| `old_hardware_ids` | Previous Hardware Identifier set |
| `new_hardware_ids` | New Hardware Identifier set |
| `actor_ref` | User who initiated the transfer |
| `correlation_id` | Shared across all transfers in a batch replacement |

Naming this event `entity_transferred` rather than `device_replaced` reflects the operational reality: the Entity is the continuity unit, and the operation is a transfer of that continuity to new backing hardware. The `reason` field distinguishes device replacement from other future transfer scenarios (reorganization, integration migration) without requiring new event types.

This event creates an auditable record (INV-ES-06) and enables the state store to understand why an Entity's Device association changed.

---

## 6. Hardware Identifier Mapping

Hardware Identifiers bridge the gap between protocol-level identity (which the device knows) and HomeSynapse identity (which the system controls).

### 6.1 Structure

Hardware Identifiers are stored as a set of `(namespace, value)` tuples on each Device:

| Namespace | Value Format | Example |
|---|---|---|
| `zigbee_ieee` | EUI-64 | `00:11:22:33:44:55:66:77` |
| `matter_unique_id` | Opaque string | `ABCD1234-5678-EFGH` |
| `matter_node_id` | Fabric-scoped integer | `12345` |
| `zwave_node_id` | Integer (network-scoped) | `7` |
| `serial` | Manufacturer serial | `SN-12345678` |
| `mac_address` | IEEE MAC | `AA:BB:CC:DD:EE:FF` |

### 6.2 Rules

**Hardware Identifiers are internal.** They are stored on the Device record and used by the Integration for protocol-level communication. They are never exposed in Slugs, Paths, URN forms, automation bindings, or user-facing configuration.

**Hardware Identifiers are mutable.** A Device's Hardware Identifiers change on replacement (§5), re-pairing, or network reconfiguration. The Device's `device_id` does not change.

**Hardware Identifiers enable Discovery matching.** When an Integration discovers a device, it presents Hardware Identifiers. The system searches existing Devices for a matching tuple. If found, the discovered device is recognized as an existing Device (re-pairing after power loss, for example) rather than proposed as a new adoption. This prevents duplicate Device creation after protocol-level interruptions.

**Matching is Integration-scoped.** Hardware Identifier matching operates within a single Integration. A Zigbee IEEE address is only compared against other Zigbee Devices. Cross-Integration matching (for Device Replacement) is always user-initiated.

---

## 7. Address Resolution

Address resolution is the process of converting a contextual address into a concrete `Set<EntityRef>`. This section defines the resolution primitives and guarantees. The selector vocabulary (the syntax users write in automation definitions) is defined in the Automation Engine design document (07).

### 7.1 What Addressing Means

An address is a query that resolves to zero or more Entity References. Addressing answers "which entities does this target?" — not "what is this entity?" (that is identity).

**An address may resolve to:**

- Exactly one Reference (a direct `entity_ref`)
- A set of References (a label, an area, an entity type filter)
- An empty set (no entities match the selector)

**Identity is always singular; addressing may be plural.** A Reference identifies exactly one object. An address may identify many. This distinction prevents conflation of "what something is" with "how we find it."

### 7.2 Resolution Timing

Address resolution occurs at a single, defined moment: **Trigger evaluation time.** When an Automation's Trigger fires, all address selectors in that Automation's Conditions and Actions are resolved into concrete `Set<EntityRef>` values. The resolved sets are captured in the Run record and used for the duration of that Run.

**Resolved sets are immutable within a Run.** If an Entity is added to a Label after the Trigger fires but before an Action executes, that Entity is not included in the current Run's target set. If an Entity is removed from a Label after the Trigger fires, it remains in the current Run's target set. This guarantees deterministic behavior: replaying a Run from its recorded resolved set produces the same actions (INV-TO-02).

**Exception: direct References.** An Action that targets a specific `entity_ref` (not a selector) does not require resolution — the Reference is the resolved set (of cardinality 1). Direct References still participate in the Run Trace for auditability.

### 7.3 Deduplication

When multiple selectors in the same Action resolve to overlapping sets, the union is deduplicated. An Entity appears at most once in the resolved target set for a given Action.

**Deduplication is by Reference.** Two Slugs that happen to point to the same Reference are deduplicated. This is the correct behavior because the Entity should receive the command once, not once per selector that matched it.

### 7.4 Ordering

The resolved set is ordered deterministically. The default ordering is by Reference (ULID lexicographic order, which corresponds to creation time). This ensures that:

- Replaying a Run produces the same execution order.
- Log output is consistent across replays.
- Users debugging an automation see the same entity order every time.

The Automation Engine (doc 07) may define additional ordering strategies (e.g., "alphabetical by Display Name for UI display"), but the default ordering for execution is always by Reference.

### 7.5 Eligibility Failures (resolution-time)

After resolution produces a `Set<EntityRef>`, each Reference is checked for eligibility before execution. Eligibility is a resolution-time concern — it determines whether the target *should* receive the action, not whether the action *succeeds*. Execution outcomes (device offline, timeout, protocol error) are owned by the Automation Engine (design document 07).

**Target soft-deleted.** The Action is skipped for this target. The Run Trace records: "target `{entity_ref}` is soft-deleted; action skipped." The Run continues. This is a warning, not an error — the entity may be restored.

**Target permanently purged.** The Action is skipped for this target. The Run Trace records: "target `{entity_ref}` no longer exists; action skipped." The Automation's health is set to `degraded` and the user is notified that the Automation references a nonexistent entity.

**Target permission-denied.** If the acting user (or automation actor) lacks permission to control the target entity, the Action is skipped for this target. The Run Trace records: "target `{entity_ref}` denied by permission policy; action skipped." Whether this degrades Automation health depends on whether the denial is persistent (role-based, always degrades) or transient (time-based policy, does not degrade).

**Target capability-degraded.** If the target entity has been flagged as `degraded` due to a Device Replacement (§5.3) that removed a required Capability, and the Action requires the missing Capability, the Action is skipped. The Run Trace records which Capability was missing.

**Selector resolves to empty set.** The Action is skipped. The Run Trace records: "selector `{selector_text}` resolved to empty set." Default behavior depends on selector type:

- **Label and area selectors:** empty set is treated as *normal* (no warning). These selectors legitimately target groups that may be temporarily empty.
- **Direct reference or slug selectors:** empty set is treated as *warning*. A selector that names a specific entity is expected to match; failure to match indicates a configuration problem.
- **Per-Automation override:** the user may explicitly configure any selector's empty-set behavior as `normal`, `warning`, or `error`.

**Health degradation rules.** An Automation's health degrades to `degraded` on the first occurrence of a purged-target or persistent-permission-denied failure. Health does not auto-recover — the user must edit the Automation to remove the invalid reference or fix the permission grant. After the edit, health resets to `healthy`. This is strict by design: an Automation with a known-broken reference should not silently run in a degraded state indefinitely.

**No silent failures.** Every eligibility failure is recorded in the Run Trace with sufficient context for a user to diagnose the problem. The system never silently drops an action because a target is ineligible (INV-TO-01, INV-HO-04).

### 7.6 Execution Failures (post-resolution)

Execution failures occur when a resolved, eligible target cannot be acted upon at runtime. These are owned by the Automation Engine (design document 07) and the Integration Runtime (design document 05). This document defines only the tracing contract:

- Every execution failure (device offline, command timeout, protocol error) is recorded in the Run Trace with the target `entity_ref`, failure reason, and timestamp.
- Execution failures do not degrade Automation health — they are transient by nature. A device that is offline today may be online tomorrow.
- The Run's terminal status reflects execution outcomes: `completed` (all actions succeeded), `completed_with_errors` (some actions failed at execution), or `failed` (a critical action failed and the Run was aborted per the Automation's error policy).

The full specification of execution failure handling, retry semantics, and error policies is defined in the Automation Engine design document (07).

### 7.7 Resolution and Eligibility in Run Traces

Every Run Trace includes a resolution and eligibility record:

| Field | Content |
|---|---|
| `resolved_targets` | Map of selector → `Set<EntityRef>` for every selector evaluated |
| `resolution_timestamp` | The instant at which resolution occurred |
| `eligibility_results` | Per-target eligibility outcome: `eligible`, `soft_deleted`, `purged`, `denied`, `capability_degraded` |
| `eligibility_failures` | List of any targets that were skipped and why |

This record enables complete automation replay and debugging. A user can examine a Run Trace and see exactly which entities were targeted, which were eligible, and what happened to each (INV-ES-06). Execution outcomes (success, failure, timeout) are appended to the trace by the Automation Engine during action dispatch.

---

## 8. What HomeSynapse Does Not Do

These anti-patterns are explicitly prohibited. They are documented here because each one has been observed in a competing platform and caused documented harm.

### 8.1 No name-derived identity

Identifiers are never computed from Display Names, area names, or any user-visible string. Home Assistant's `light.kitchen_ceiling` pattern — where renaming a device or moving it to a different room can change its identity and break every automation that references it — is the precise failure this rule prevents.

**Enforced by:** P1 (opaque identity), §2.1 (Reference format), LTD-04 (ULID).

### 8.2 No path-based addressing as identity

Paths (§2.3) are display addresses composed from mutable Slugs. They are never used as binding keys. The system never stores `home/kitchen/ceiling-light` as an automation target. If a user writes a configuration file that uses a Path where a Reference is expected, the configuration validator rejects it with a clear error message identifying the correct Reference.

**Enforced by:** P2 (addressing is contextual), §2.1 (binding key rule).

### 8.3 No implicit identity mutation

No system operation silently changes an object's Reference. There is no "re-ID" operation, no "merge entities" operation that combines two References into one, no migration that rewrites References in-place. If a design appears to require any of these, the design is wrong.

**Enforced by:** §4.2 (immutability), §4.3 (no reuse).

### 8.4 No hidden ID rewrites

If a system component internally maps one identifier to another (e.g., a cache that maps Protocol Bindings to Entity References), that mapping is explicit, logged, and observable. There are no internal translation tables that silently redirect one Reference to another.

**Enforced by:** INV-TO-03 (no hidden state).

### 8.5 No semantic encoding in identifiers

Identifiers do not contain:

- Entity type (`light`, `sensor`, `switch`)
- Protocol (`zigbee`, `matter`, `wifi`)
- Integration name
- Area or room name
- Hierarchy level
- Capability information
- Version numbers

If someone requests `light.kitchen_ceiling` as an identifier format, the answer is: "That is a Path, not an identity. The identity is `01HQY8M2...`."

**Enforced by:** P1 (opaque identity), P5 (protocol is implementation).

### 8.6 No IP address as device identity

IP addresses change on DHCP lease renewal. SmartThings' documentation explicitly warns against this. HomeSynapse uses Hardware Identifiers (§6) that are protocol-appropriate (IEEE addresses for Zigbee, unique IDs for Matter) and maps them to stable References.

**Enforced by:** P5 (protocol is implementation), §6.2 (Hardware Identifiers are internal).

### 8.7 No developer-assigned identity

Integrations do not generate or control Entity or Device References. HomeSynapse assigns all References. Integrations provide Hardware Identifiers; the system maps them to References. This prevents inconsistent formats, collisions across Integrations, and deduplication problems observed in Google Home and Alexa's developer-assigned ID models.

**Enforced by:** §4.1 (creation trigger), §6.2 (Integration-scoped matching).

---

## 9. Uniqueness Scopes

| Identifier | Unique Within | Guaranteed By |
|---|---|---|
| Reference (`*_id`) | Globally (all Homes, all installations) | ULID construction (timestamp + 80 random bits) |
| Slug (`*_slug`) | Home, per addressable type | Database unique constraint + tombstone table |
| Path | Home (by construction from unique slugs) | Slug uniqueness + deterministic composition |
| URN form | Globally | `home_id` (globally unique) + `object_id` (globally unique) |
| Hardware Identifier | Integration instance | Protocol-defined (IEEE, Matter spec, etc.) |
| `entity_sequence` | Entity | Monotonic counter per entity (LTD-05) |
| `global_position` | Home | SQLite rowid auto-increment (LTD-05) |
| `event_id` | Globally | Monotonic ULID (LTD-04) |

**MVP scope note.** The MVP is single-Home, single-instance. Slug uniqueness is enforced by a single SQLite database. Multi-Home coordination (if introduced in future tiers) does not require identity remapping because References are globally unique by construction.

---

## 10. Invariant and LTD Cross-Reference

| Invariant / LTD | Sections in This Document |
|---|---|
| **INV-CS-02** (Stable identifiers) | §2.1 (binding key rule), §4.2 (immutability), §4.3 (no reuse), §5 (Device Replacement) |
| **INV-CE-04** (Protocol agnosticism) | §1 (P5), §6 (Hardware Identifiers), §8.5 (no semantic encoding) |
| **INV-ES-02** (State derivable from events) | §4.5 (no resurrection after purge) |
| **INV-ES-06** (Explainable state) | §5.4 (transfer event), §7.7 (resolution and eligibility in traces) |
| **INV-TO-02** (Automation determinism) | §7.2 (resolution timing), §7.3 (deduplication), §7.4 (ordering) |
| **INV-TO-03** (No hidden state) | §8.4 (no hidden ID rewrites) |
| **INV-HO-04** (Self-explaining errors) | §7.5 (no silent failures), §7.6 (execution failure tracing) |
| **INV-MU-01** (Identity-aware model) | §3 (Person as addressable object), §2.1 (actor_ref in events) |
| **LTD-04** (ULID) | §2.1 (Reference format), §2.2 (slug suffix generation) |
| **LTD-05** (Per-entity sequences) | §9 (uniqueness scopes) |
| **LTD-03** (SQLite WAL) | §2.2 (slug uniqueness enforcement), §9 (uniqueness scopes) |

---

*This document is part of the HomeSynapse Core foundations layer. It governs identifier formats, addressing rules, and operational semantics across all Phase 1 design documents, Phase 2 interface specifications, and Phase 3 implementation. The companion Glossary governs terminology. Amendments follow the process defined in §0.3.*