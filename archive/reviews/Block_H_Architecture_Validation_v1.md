# HomeSynapse Core Architecture Validation — Block H Review

**Date:** 2026-03-17
**Scope:** Event system, device model/capabilities, state store, persistence, integration runtime, automation engine, identity model
**Goal:** Validate that HomeSynapse Core's architecture is correctly designed for single-family homes, multi-family homes, small businesses, large offices, and enterprise multi-property management
**Documents reviewed:** 16 design docs, research papers, and governance documents

---

## 1. Executive Assessment

The architecture is sound. HomeSynapse Core's design demonstrates the discipline of learning from the documented failures of Home Assistant, SmartThings, openHAB, and Hubitat, and systematically closing the gaps those platforms left open. The event-sourced, entity-centric, capability-contract model scales from a 10-device apartment to a multi-property enterprise without architectural rework — which is the stated design constraint and the hardest thing to get right.

There are no blocking architectural flaws. The 24-amendment critical design review process caught and resolved the boundary contract gaps, production resilience concerns, and API stability issues that would otherwise surface under load or at scale. Four amendments were classified BLOCKING and applied; nine REQUIRED amendments were applied; the remaining RECOMMENDED items are correctly deferred to opportunistic implementation.

The remainder of this review validates each subsystem against deployment scales, identifies the specific design decisions that make cross-scale operation work, and flags three areas where future extension will be needed but where the current architecture correctly reserves the path.

---

## 2. Event System — Validated Across All Scales

The event model is the foundation. If this is wrong, everything above it breaks. It is not wrong.

**Per-entity monotonic sequencing** is the critical decision. Each entity maintains its own `subject_sequence` — a contiguous, gap-free counter starting at 1. Gaps indicate data loss and are treated as a system integrity failure (INV-ES-03). This gives every entity a complete, ordered, verifiable history regardless of how many other entities exist in the system. A 10-device home and a 1,000-device office both get the same correctness guarantees per entity. The global position (SQLite rowid) provides total ordering across all entities for subscribers that need it.

**The three-level state event lifecycle** (`state_reported` → `state_changed` → `state_confirmed`) separates raw observation from derived transitions from intent closure. This matters at scale because high-frequency sensors (energy meters reporting every second) generate enormous volumes of `state_reported` events at DIAGNOSTIC priority, but only meaningful changes propagate as `state_changed` at NORMAL priority. The priority-tier system with configurable retention (CRITICAL 365 days, NORMAL 90 days, DIAGNOSTIC 7 days) means a large office with 200 energy meters doesn't drown in storage — diagnostic data ages off while the meaningful state transition history remains intact.

**Telemetry isolation** (separate `homesynapse-telemetry.db`) prevents high-frequency data sources from degrading the core event log's write performance. This is essential for energy monitoring at any scale beyond a handful of devices, and critical for enterprise deployments where energy analytics may involve hundreds of meters reporting at sub-second intervals.

**The pull-based subscription model with backpressure** handles diverse consumer speeds gracefully. The State Projection, which must process every event for correctness, is exempt from coalescing. But a dashboard subscriber that falls behind can have DIAGNOSTIC events coalesced — only the most recent value per (subject, attribute) is delivered. This prevents slow consumers from causing unbounded memory growth in the bus, which is the exact failure mode that kills smart home platforms under sustained load.

**Processing modes** (LIVE, REPLAY, PROJECTION, DRY_RUN) are the mechanism that makes event sourcing practical rather than theoretical. The REPLAY mode suppresses actuator commands and external notifications during catch-up, preventing the classic "replay turns on all the lights" disaster. The LIVE/REPLAY transition at 10 events from log head is simple and correct. DRY_RUN for automation testing is a thoughtful inclusion that becomes essential once automations manage anything consequential — an enterprise managing HVAC, access control, or energy load-shedding needs to test automations before deploying them.

**Multi-instance readiness:** The event model explicitly reserves the path. ULID event IDs are globally unique by construction. Per-entity sequences provide conflict detection primitives for merge resolution. The `ingest_time` vs `event_time` distinction becomes the merge-ordering signal in multi-instance scenarios. The single-writer model (LTD-03, LTD-11) is correct for MVP and Tier 1/2, and the documented extension path to multi-instance coordination post-Tier 3 is architecturally coherent.

**Scale validation:**
- **Single-family home (10–50 devices):** Well within all performance budgets. Event throughput target of 500 events/sec sustained is orders of magnitude above steady-state for this scale.
- **Multi-family / small business (50–200 devices):** Telemetry isolation and priority-tier retention prevent storage bloat from energy monitoring. Per-entity sequencing means adding devices is linear in event volume, not quadratic.
- **Large office (200–1,000 devices):** Replay performance target of 10,000+ events/sec means a full rebuild from checkpoint takes minutes, not hours. The checkpoint strategy (5-minute interval OR 1,000 events, 30-second minimum spacing) keeps replay windows short even under sustained write load.
- **Enterprise multi-property:** Each property runs its own hub with its own event log. The ULID + per-entity sequence design means future cross-property synchronization can merge event streams without identity collision. Event category taxonomy (8 categories) enables consent-scoped access control boundaries — essential for multi-tenant scenarios where different properties have different data governance requirements.

---

## 3. Device Model & Capability System — Validated Across All Scales

The device model's entity-first design and capability-as-contract architecture are the most strategically important decisions in the entire system. They solve problems that Home Assistant, SmartThings, and openHAB have been unable to fix despite years of effort.

**Entity-first targeting** means automations, APIs, and state queries address entities, never devices. This is correct because a device is a physical container, not a functional surface. A 4-outlet power strip with energy monitoring is five entities (four outlets, one meter), each independently controllable and independently addressable. This model works identically whether the strip is in a kitchen or an office building's server rack.

**Capability composition** (`OnOff` + `Brightness` rather than monolithic `DimmableLight`) prevents the SmartThings splitting problem where adding or removing a feature from a device type requires migrating all devices of that type. It also means the same automation logic works across protocols — a Zigbee dimmer and a Matter dimmer both compose `OnOff` + `Brightness`, and the automation engine sees identical capability contracts regardless of the underlying protocol.

**The three-level capability separation** (Declared Capabilities / Feature Map / Availability) solves the Home Assistant problem where `supported_features` changes at runtime, breaking UI rendering, voice assistant discovery, and automation conditions. In HomeSynapse, declared capabilities are locked after adoption and change only via explicit `entity_profile_changed` events. Feature maps are stable per-entity. Only availability changes at runtime — and availability is entity-level, not per-capability, which correctly reflects hardware reality (a Zigbee endpoint is either reachable or not; individual clusters don't have independent reachability).

**Protocol agnosticism through canonical units** prevents the Home Assistant unit-change data corruption problem. All physical quantities are stored in SI canonical units at ingestion, with raw protocol values preserved for auditability. Historical data is never reinterpreted through a different unit lens. This is essential for energy analytics at any scale — an enterprise managing energy across properties needs consistent units across Zigbee power meters, Matter energy meters, and MQTT inverter data.

**The discovery-to-adoption pipeline** with hardware identifier deduplication handles device replacement gracefully at all scales. In a single-family home, replacing a failed light bulb preserves the entity ID, automation bindings, and historical events. In a large office, the same mechanism handles bulk hardware refreshes without breaking the automation graph. The compatibility checking (compatible / partially compatible / incompatible) provides appropriate guardrails — an enterprise facility manager replacing 50 sensors gets clear feedback on which automations need review.

**Device orphan lifecycle** (AMD-17) is critical for production reliability at any scale. When an integration adapter crashes, orphaned devices have their state frozen and marked stale rather than silently disappearing. Commands are rejected with a clear error. When the adapter recovers, hardware identifier matching triggers automatic re-adoption. This is the difference between a smart home platform that survives real-world conditions and one that requires manual intervention after every adapter restart.

**Custom capabilities with namespace governance** provide the extensibility needed for enterprise and specialized deployments without compromising the integrity of the standard capability set. A commercial building's BACnet integration can register custom capabilities for HVAC setpoints, damper positions, and air handling units, all participating in the same event system and automation engine as standard capabilities. The stability level progression (EXPERIMENTAL → STABLE → DEPRECATED) and the prohibition on shadowing standard capability IDs prevent the fragmentation that plagues plugin ecosystems.

**Scale validation:**
- **Single-family home:** Standard capability set covers all common devices. Entity types (light, switch, plug, sensor, binary_sensor, energy_meter) map cleanly to residential devices. Discovery-to-adoption pipeline handles new device pairing without protocol knowledge.
- **Multi-family / small business:** Multi-function device modeling (multi-outlet strips, combination sensors) handled correctly by entity decomposition. Area assignment provides spatial organization. Labels provide cross-cutting grouping.
- **Large office:** Endpoint indexing aligns with Matter's endpoint numbering, enabling direct mapping of commercial-grade Matter devices with many endpoints. Custom capabilities accommodate building management protocols. Registry memory at 1,000 devices / 3,000 entities is ~50 MB — well within budget.
- **Enterprise multi-property:** Each property's device registry is independent (local-first). The URN form (`hs:{home_id}/{type}/{object_id}`) provides globally unique external interchange identifiers for cross-property dashboards and analytics. Custom capability namespacing prevents collision between different properties' specialized integrations.

---

## 4. State Store — Validated Across All Scales

The state store is the most-consumed subsystem in HomeSynapse — every downstream consumer (REST API, WebSocket API, Automation Engine, Web UI) reads current entity state through `StateQueryService`. The Block H interface specification correctly captures the design document's requirements.

**The three-timestamp model** (`lastChanged`, `lastUpdated`, `lastReported`) is the right design for cross-scale operation. `lastReported` tracks adapter communication freshness — a temperature sensor reporting the same value every 30 seconds is not stale, even if `lastChanged` is hours old. This distinction is essential for monitoring at scale: a facility manager needs to know that all sensors are reporting, not just that some values have changed.

**Derived staleness** (`stale` computed at read time from `staleAfter` and wall clock) avoids the need for background timers to update staleness flags. In a large deployment with thousands of entities, a timer-based approach would create periodic CPU spikes and contention. Read-time derivation pushes the cost to the query caller, where it's amortized across natural access patterns.

**The three-tier consistency model** (per-entity consistent, cross-entity batch weakly consistent, snapshot fully consistent) is the right trade-off. The State Projection is a single writer replacing immutable EntityState records in a ConcurrentHashMap — individual record reads are always consistent because record replacement is atomic. Cross-entity batches may span projection ticks, which is acceptable for dashboard rendering. Full snapshot consistency (under lock) is available when needed, at the cost of O(N) copy time — the 10ms target for 10,000 entities is achievable.

**The replaying flag** on StateSnapshot gates downstream behavior correctly. REST API returns 503 during replay (unless the caller accepts stale data). Automations don't fire during replay. This prevents the cascade of phantom actions that would otherwise occur during startup of a large deployment.

**The checkpoint strategy** (full snapshot to ViewCheckpointStore, triggered by interval or event count) keeps startup replay windows bounded. For a large office generating 500 events/sec, checkpoints occur every 2 seconds by event count — meaning worst-case replay after a crash processes at most a few thousand events, completing in under a second at the 10,000+ events/sec replay target.

**Scale validation:**
- **Single-family home:** 150 entities, state queries sub-millisecond, snapshot in microseconds. Well within all budgets.
- **Multi-family / small business:** 500 entities. ConcurrentHashMap lock-free reads scale linearly. Snapshot copy under 1ms.
- **Large office:** 3,000 entities. Snapshot copy approaches 10ms target. Checkpoint data size ~3,000 × ~500 bytes ≈ 1.5 MB — trivial for SQLite storage and recovery.
- **Enterprise multi-property:** Each property has its own State Store. Cross-property queries would route through a future aggregation layer, not through individual property state stores. The design correctly avoids baking in cross-property state query assumptions.

---

## 5. Identity Model — The Foundation That Makes Everything Work

The three-layer identity architecture (Reference / Slug / Path) is the single most important architectural decision for enterprise scalability, and it is correct.

**Immutable ULID References as binding keys** means automations, events, and all machine-to-machine communication use identifiers that never change. A device can be renamed, moved to a different area, have its display path change, and every automation, every historical event, every checkpoint record remains valid. This prevents the Home Assistant `light.kitchen_ceiling` problem where renaming an entity breaks all automations that reference it.

**Slug tombstones with 90-day retention** (indefinite for soft-deletes) prevent the link hijacking scenario where a deleted entity's human-readable name is reused by a new entity, causing old bookmarks and external references to point to the wrong thing. This is a real-world problem in any deployment that persists long enough — and enterprise deployments persist for years.

**URN form** (`hs:{home_id}/{type}/{object_id}`) provides globally unique external interchange identifiers. For enterprise multi-property management, this means a central dashboard can reference entities across properties without ambiguity, and cross-property reports can include entity references that are globally resolvable.

**Hardware identifier deduplication with integration scoping** prevents cross-protocol identity confusion while enabling same-protocol device recovery. A Zigbee device's IEEE address is only compared against other Zigbee devices — never against a Matter device that might coincidentally have a matching identifier in a different namespace. This is the correct scoping for multi-protocol deployments.

---

## 6. Cross-Subsystem Integration — Validated

**Persistence Layer (Doc 04):** SQLite with WAL mode, single-writer, concurrent readers. The domain/telemetry database split prevents high-frequency sensor data from degrading core event performance. The ViewCheckpointStore implementation stores opaque checkpoint data without interpreting content, maintaining clean separation between the State Store's serialization format and the persistence layer's storage mechanism.

**Integration Runtime (Doc 05):** Process-level isolation for integration adapters with crash-safe restart. The IntegrationContext provides controlled access to EventPublisher and StateQueryService without exposing internal state store mechanics. This is the right architecture for supporting multiple protocol adapters (Zigbee, Z-Wave, Matter, MQTT) simultaneously — a crashed Zigbee adapter doesn't affect Z-Wave operation.

**Automation Engine (Doc 07):** Trigger evaluation against StateQueryService, with DRY_RUN mode for testing. The automation engine consumes state changes via event subscription and evaluates conditions against current state via StateQueryService. This two-path approach (event-driven triggering + state-query evaluation) is the correct architecture — events tell the automation when to wake up, state queries tell it what to do.

**Startup & Lifecycle (Doc 12):** StateStoreLifecycle.start() returns a CompletableFuture that gates dependent subsystem startup. This ordered initialization prevents the REST API from serving stale data during replay, prevents automations from firing on historical events, and prevents WebSocket clients from receiving inconsistent initial state.

---

## 7. Areas Requiring Future Extension (Not Flaws)

These are areas where the current architecture correctly reserves the path but does not implement the solution. They are documented here for completeness, not as deficiencies.

**7.1 Multi-Instance Event Synchronization**

The event model's ULID event IDs and per-entity sequences provide the primitives for cross-instance merge resolution, but the actual synchronization protocol is post-Tier 3 scope. For enterprise multi-property management, each property currently runs as an independent hub. A future coordination layer would need to handle: merge ordering (using `ingest_time` vs `event_time`), conflict resolution for concurrent writes to the same entity (which shouldn't happen in normal operation but could during split-brain recovery), and cross-property event subscription for central dashboards.

The current architecture does not preclude this. The identity model's global uniqueness means no remapping is needed. The event category taxonomy enables per-category synchronization policies. The causal metadata (correlation_id, causation_id) enables causal ordering reconstruction across instances.

**7.2 Multi-User Access Control**

Tier 1 operates single-user, LAN-only, no TLS. Tier 2+ adds OAuth2/OIDC bearer token auth, per-user RBAC, and event category-based access filtering. The event model's `actor_ref` field (promoted to top-level in the March 16 change) already captures user identity on every event, providing the audit trail needed for multi-user accountability. The event category taxonomy provides the access control granularity — a property manager might have access to `device_state` and `energy` categories but not `security` or `presence`.

The current architecture supports this extension without rework. The `actor_ref` field is nullable (for system-originated events) and already flows through the entire event pipeline.

**7.3 Cross-Property Aggregation**

An enterprise managing multiple properties needs aggregated views — total energy consumption across all buildings, device health status across all locations, consolidated alert feeds. The current architecture's per-property independence means aggregation requires a new layer that subscribes to each property's event stream (or polls each property's REST API) and maintains aggregated materialized views.

The URN form provides the addressing. The event category taxonomy provides filtering. The REST API's eventual pagination and filtering (API Layer responsibility, not State Store) provide the query mechanism. The aggregation layer itself is future work, but nothing in the current architecture makes it difficult.

---

## 8. Specific Strengths Worth Highlighting

**8.1 The Command Confirmation Model is Exceptional**

The Pending Command Ledger with capability-owned tolerance bands and typed expected outcomes (ExactMatch, WithinTolerance, EnumTransition, AnyChange) is more sophisticated than any competing smart home platform's command handling. It provides:
- Confirmation that a command was executed (not just sent)
- Tolerance-aware matching that handles real-world sensor imprecision
- Timeout-based expiry that surfaces unresponsive devices
- Idempotency classification for crash recovery (IDEMPOTENT commands re-issued, NOT_IDEMPOTENT expired)

This matters at every scale but becomes critical in commercial and enterprise deployments where command confirmation is a compliance or safety requirement (HVAC setpoints, access control, energy load-shedding).

**8.2 Energy as First-Class Citizen (INV-EI-01)**

Energy monitoring is not an afterthought — it has its own event category, dedicated capability types, bidirectional metering support, cumulative vs instantaneous measurement distinction, and the telemetry isolation infrastructure to handle high-frequency reporting without degrading the core event log. This positions HomeSynapse for the energy management market that Home Assistant is poorly equipped to serve.

**8.3 The Amendment Process Itself**

The 24-amendment critical design review caught real issues before they became code. AMD-02 (REPLAY→LIVE reconciliation), AMD-04 (cascade depth governance), AMD-10 (projection versioning), and AMD-11 (state staleness detection) are the exact kinds of boundary-condition bugs that would surface in production under load and be extremely expensive to fix retroactively. Catching them at the design stage, with precise specifications for the fix, is the right engineering process.

---

## 9. Conclusion

HomeSynapse Core's architecture is correctly designed for the full range of deployment scales, from single-family homes to enterprise multi-property management. The event-sourced, entity-centric, capability-contract model provides a consistent correctness foundation regardless of scale. The identity model's global uniqueness and binding-key immutability prevent the cascading breakage that plagues competing platforms. The state store's three-tier consistency model and derived staleness computation provide the right performance trade-offs at each scale tier.

The three areas requiring future extension (multi-instance synchronization, multi-user access control, cross-property aggregation) are correctly scoped as post-Tier 3 work, and the current architecture reserves the path for all three without requiring rework of existing subsystems.

The design is ready for implementation.
