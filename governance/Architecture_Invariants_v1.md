# HomeSynapse — Architecture & Directional Invariants (v1)

**Document type:** Governance — foundational architectural contract
**Status:** Locked
**Scope:** Governs all architectural, product, and data decisions across all versions
**Applies to:** MVP v1 and all future versions unless explicitly revised through the amendment process defined in §15
**Effective date:** 2026-02-21 (revised)
**Owner:** nick@nexsys.io

---

## 0. Purpose

This document defines the permanent, non-negotiable properties of the HomeSynapse platform and ecosystem. These are constitutional constraints — every future design decision, from MVP through cloud-enhanced multi-hub deployments, must satisfy every applicable invariant in this document.

These invariants exist because the competitive landscape research identified specific, documented failure modes across every major smart home platform, and because strategic analysis across ten technology domains identified architectural properties that HomeSynapse must exhibit to capture the opportunities those domains present. Each invariant traces to at least one competitive failure mode or strategic opportunity. The invariants are not aspirational principles — they are engineering constraints that prevent HomeSynapse from reproducing the failures we intend to displace and that ensure the architecture accommodates the capabilities that will define the next generation of smart home platforms.

### 0.1 What This Document Is

This is a foundational governance artifact. It sits above the subsystem design documents and below only the locked technical decisions register. Subsystem designs reference specific invariants by identifier (e.g., "this satisfies INV-ES-03") and must demonstrate compliance during architecture review.

### 0.2 What This Document Is Not

This document is not a roadmap, a feature list, or a product requirements document. It does not specify *how* invariants are achieved — that is the role of subsystem design documents. It does not define MVP scope — some invariants describe properties the architecture must *accommodate* even if the MVP does not fully implement them.

### 0.3 Invariant Identifiers

Every invariant has a stable identifier in the format `INV-{CATEGORY}-{NUMBER}`. These identifiers are permanent. If an invariant is retired, its identifier is reserved and never reused. Design documents, PR reviews, and architecture discussions reference invariants by these identifiers.

The complete set of category prefixes currently in use is:

| Prefix | Category | Section |
|---|---|---|
| `LF` | Local-First Operation | §1 |
| `ES` | Event Sourcing Guarantees | §2 |
| `RF` | Reliability and Fault Tolerance | §3 |
| `CS` | Compatibility and Stability Contracts | §4 |
| `HO` | Household Operability | §5 |
| `PD` | Privacy and Data Sovereignty | §6 |
| `TO` | Transparency and Observability | §7 |
| `CE` | Configuration and Extensibility | §8 |
| `PR` | Performance and Resource Discipline | §9 |
| `SE` | Security | §10 |
| `AI` | AI and Intelligence | §11 |
| `EI` | Energy Intelligence | §12 |
| `MU` | Multi-User Identity and Presence | §13 |
| `MN` | Mesh and Network Intelligence | §14 |
| `GA` | Governance and Amendment | §15 |
| `BUS` | Event Bus and Distribution | §19 |
| `PROJ` | State Projection | §19 |
| `WRITER` | Single-Writer Discipline | §19 |
| `SUB-ISO` | Subscriber Isolation | §19 |
| `AMD-47-INV` | Device-Model Attribute-Value Expansion (AMD-47) | §20 |
| `AMD-51-INV` | State-Store Typed Change-Detection Comparator (AMD-51) | §21 |
| `AMD-52-INV` | Typed `StateChangedEvent` Payload / Serializer / Replay (AMD-52) | §22 |
| `AMD-53-INV` | Timestamp-Model Unifier — Event-Time Activity Timestamps (AMD-53) | §23 |
| `AMD-54-INV` | IntegrationDescriptor Config-Schema Versioning (AMD-54) | §24 |
| `AMD-55-INV` | IntegrationAdapter Post-Setup Lifecycle Hooks (AMD-55) | §25 |
| `AMD-56-INV` | ExceptionClassification `AUTH_FAILED` (AMD-56) | §26 |
| `AMD-57-INV` | `HealthDetail` on `IntegrationHealthRecord` (AMD-57) | §27 |
| `AMD-58-INV` | IntegrationLifecycleEvent Expansion 5→10 (AMD-58) | §28 |
| `AMD-59-INV` | Capability Events, Publisher & DiscoveryServices (AMD-59) | §29 |
| `AMD-60-INV` | SecurityServices Aggregator & CredentialRotator (AMD-60) | §30 |
| `AMD-61-INV` | Descriptor Soft Dependencies (AMD-61) | §31 |
| `AMD-62-INV` | Descriptor BackoffParameters (AMD-62) | §32 |
| `AMD-63-INV` | IsolationLevel Reservation (AMD-63) | §33 |
| `AMD-64-INV` | Per-Descriptor Planned-Restart Timeout (AMD-64) | §34 |
| `AMD-86-INV` | INV-PD-07 Crypto-Shred MVP-Scope Narrow + INV-PD-03 At-Rest Posture (AMD-86) | §35 |
| `AMD-87-INV` | `Expectation` Persisted Sealed-Type Codec (AMD-87) | §36 |
| `AMD-66-INV` | `ConfigurationChangeListener` — Per-Section Reload Reaction (AMD-66) | §37 |
| `AMD-67-INV` | Config-Document Schema Versioning `(major, minor)` (AMD-67) | §38 |
| `AMD-68-INV` | `SecretStore` Atomic Multi-Key Durable Write (AMD-68) | §39 |
| `AMD-70-INV` | Configuration Observability Events (AMD-70) | §40 |
| `AMD-71-INV` | Hybrid Configuration Directory Layout (AMD-71) | §41 |
| `AMD-88-INV` | TriggerDefinition M7 Expansion (AMD-88) | §42 |
| `AMD-89-INV` | Selector Semantic Tags + Role Exclusion (AMD-89) | §43 |
| `AMD-90-INV` | Action Confirmation + Iteration Bounds (AMD-90) | §44 |
| `AMD-91-INV` | Run Causal Chain + Cycle Suppression (AMD-91) | §45 |
| `AMD-92-INV` | Automation Event Vocabulary (AMD-92) | §46 |
| `AMD-93-INV` | Automation Definition Schema Posture (AMD-93) | §47 |
| `AMD-94-INV` | Rotate-DEK-on-Restore + Envelope Version Discriminator (AMD-94) | §48 |
| `SA` | Superior Automation Layer (Doc 16) | §49 |

The §17 Invariant Index provides the canonical per-identifier lookup; the §18 Traceability Matrix maps each category to failure modes and opportunities. The BUS / PROJ / WRITER / SUB-ISO categories were added by Phase 3 governance work (AMD-41, AMD-42, AMD-43, applied 2026-05-16); their canonical definitions live in §19. The `AMD-47-INV-NN` identifiers are **amendment-scoped** contract-level invariants (the convention introduced by the projection block's `AMD-50-INV-NN`); their canonical definitions live in §20 and they trace 1:1 to AMD-47 (RATIFIED 2026-05-30). The `AMD-54-INV` … `AMD-64-INV` categories (§24–§34) were registered together at the Workstream C integration-block ratification (2026-06-05, single review return) and trace 1:1 to AMD-54..64. The `AMD-66-INV` … `AMD-71-INV` categories (§37–§41) were registered together at the M6 configuration-block ratification (2026-06-09, single review return) and trace 1:1 to AMD-66/67/68/70/71; **AMD-69 is DEFERRED (Tier-2/OQ-15-3) and registers no invariant — the number stays reserved.** The sections are numbered by AMD order (66, 67, 68, 70, 71 → §37–§41); the section count is five because the deferred AMD-69 contributes none. The **`SA`** category (§49) was registered at the **Doc 16 (Superior Automation Layer) Lock — 2026-06-20** — a **new design-doc Lock, not an amendment**, so (like the §19 Phase-3 subsystem categories BUS/PROJ/WRITER/SUB-ISO and the foundational docs) it mints a subsystem category at its own Lock and **the on-disk amendment watermark stays AMD-94**; INV-SA-01/02 are novel (registered first-class) and INV-SA-03/04 are citing compositions of existing parents.

### 0.4 Relationship to Other Artifacts

| Artifact | Relationship |
|---|---|
| Locked Technical Decisions Register | Constrains implementation choices. This document constrains *what properties the system must exhibit*; the decisions register constrains *what tools and technologies are used*. Both must be satisfied. |
| Subsystem Design Documents | Every subsystem design must identify which invariants it participates in and demonstrate compliance in its Contracts and Invariants section (DESIGN_DOC_TEMPLATE.md §5). |
| Master Architecture Document | Synthesizes all subsystem designs and demonstrates end-to-end invariant satisfaction. |
| DAS v1 Specification | Governs how these invariants are published as an explanation page on homesynapse.com. |
| AboutHomeSynapse.md | Provides the product identity context. This document formalizes the architectural consequences of that identity. |
| Strategic Opportunity Landscape | Provides the empirical research across ten technology domains that informs the forward-looking invariants in §§12–14. |

### 0.5 Deployment Spectrum

HomeSynapse is not a single-configuration product. These invariants must hold across the entire deployment spectrum:

| Deployment tier | Hardware | Connectivity | Scale |
|---|---|---|---|
| Constrained | Raspberry Pi 4/5, 4 GB RAM | Offline or intermittent WAN | 10–50 devices, single protocol |
| Standard | Mini-PC or NUC, 8–16 GB RAM | Reliable LAN, optional WAN | 50–200 devices, multiple protocols |
| Enhanced | x86 server or VM | LAN + cloud services | 200–1,000 devices, full protocol suite |
| Multi-instance | Multiple hubs, optional cloud coordinator | LAN + WAN | 1,000+ devices across locations |

Every invariant in this document must hold at the Constrained tier *at its base specification*. The base specification is the invariant text itself — the property described in the main body of each invariant must be satisfiable on a Raspberry Pi 4 with 4 GB RAM. Invariants marked **[SCALES]** define additional properties that extend the base invariant at higher deployment tiers. A `[SCALES]` annotation never weakens the base invariant — it adds capabilities that become achievable with more resources. For example, if an invariant specifies "> 100 events/sec" as its base target and a `[SCALES]` annotation specifies "> 1,000 events/sec at Enhanced tier," the Constrained tier must still meet the base 100 events/sec target. The `[SCALES]` annotation defines an additional commitment at the Enhanced tier, not a relaxation of the base.

The architecture must never require upward migration — a Constrained deployment that never upgrades hardware must remain fully functional indefinitely. No feature, capability, or correctness property defined in the base specification of any invariant may be available only at higher tiers. Higher tiers offer more capacity, more speed, and more concurrent capability — never more correctness.

---

## 1. Local-First Operation

**Failure modes addressed:** AWS October 2025 outage (15 hours, affecting Alexa, Ring, Eight Sleep). Cloud dependency as single point of failure across all major platforms. 1–3 second cloud latency versus 0.2–0.4 second local latency.

**Strategic context:** Local-first architecture (ranked #4 in strategic analysis, weighted score 7.9/10) is the foundational enabler for every other strategic domain. Proven production implementations (Linear, Figma, Apple Notes, Obsidian) demonstrate the pattern works at consumer scale. Automerge 3.0's 10× memory reduction and Ditto's delta-state CRDTs in aviation/retail/military validate the technical approach for resource-constrained environments.

### INV-LF-01: Core Functionality Without Internet

All core system functionality must operate without internet connectivity. Core functionality includes: device control, automation execution, event processing, state management, dashboard access, history queries, scene activation, configuration changes, and system health monitoring.

**Test:** Disconnect WAN. Every core function listed above must operate with no degradation in correctness and no degradation in latency beyond the removal of cloud-enhanced features.

### INV-LF-02: Cloud Enhancement, Never Cloud Dependence

Cloud services may enhance HomeSynapse (remote access, cloud-based AI suggestions, cross-instance synchronization, off-site backup) but may never be required for any core function defined in INV-LF-01. No core code path may include a network call to an external service that, if it fails, degrades core functionality.

**Enforcement:** The module architecture must enforce this invariant at three levels:

1. **Capability boundary:** Core subsystems (event bus, state store, automation engine, device model, persistence layer) must not have the ability to make outbound network calls. Network access is a capability granted only to enhancement modules and integration adapters. The core runtime does not import, depend on, or transitively access any HTTP client, WebSocket client, or network I/O library. If a core subsystem needs data that might come from a cloud source, it consumes that data through the event bus — the enhancement module produces events, the core subscribes to them.

2. **Dependency direction:** Enhancement modules depend on core interfaces. Core interfaces never depend on enhancement modules. This is enforced through Gradle module dependencies — the core module's dependency graph must not include any enhancement module, directly or transitively.

3. **Quick verification:** A grep of the core module's source tree for external HTTP/WebSocket client usage must return zero results. This is a CI check, not the primary enforcement mechanism — the module boundary is the primary enforcement — but the grep catches mistakes that slip through during refactoring.

**Test:** Remove all enhancement modules from the classpath. Verify that the core starts, processes events, executes automations, and serves the dashboard with zero errors. Separately, disable WAN and verify that enhancement module failures do not propagate to core subsystems — no exceptions, no blocked threads, no degraded core performance.

### INV-LF-03: Graceful WAN Degradation

During WAN outages, the system must continue operating without user intervention. There must be no error dialogs, no degraded UI states for local functions, and no queued operations that block on WAN restoration. Cloud-enhanced features must degrade to a clear "unavailable — operating locally" state, not to an error state.

**Test:** Sever WAN during active operation. The system must not produce errors, must not queue operations that block core functions, and must display accurate status for cloud-dependent features (unavailable, not errored).

### INV-LF-04: No Required Cloud Account

Local operation must never require creating an account with NexSys, a cloud provider, or any third party. A user who installs HomeSynapse on local hardware and never connects it to the internet must have access to every core function.

**Test:** Complete installation, device pairing, automation creation, and system configuration without ever providing an email address, creating an account, or accepting terms of service from any external entity.

### INV-LF-05: Convergent Sync Architecture

The event model, state representation, and data structures must support convergent synchronization: when multiple HomeSynapse instances or clients modify state concurrently — including during network partitions — the system must converge to a consistent, deterministic state without requiring a central coordinator or human conflict resolution. The sync protocol must transmit incremental changes (deltas), not full state snapshots, to remain viable on bandwidth-constrained local networks. The convergence property must hold regardless of message ordering and regardless of how long the partition lasts.

This invariant constrains the *property* the data model must exhibit, not the mechanism that achieves it. The data model must be designed so that convergent sync is achievable; the specific sync algorithm (CRDTs, operational transforms, or future approaches) is an implementation decision made in subsystem design.

**Rationale:** The sync property — not any specific algorithm — is what matters architecturally. Current leading approaches include conflict-free replicated data types (CRDTs), where delta-state CRDTs achieve up to 94% transmission cost reduction versus full-state shipping. The Small Peer / Big Peer pattern (Raspberry Pi as local authority, optional cloud for backup) maps directly to HomeSynapse's deployment model. Per-entity sequences with ULIDs are inherently compatible with convergent sync because entity-level ordering avoids global coordination. The data model must preserve these properties: per-entity sequences, commutative or idempotent update operations where possible, and no reliance on global ordering for correctness.

**MVP scope:** The MVP is single-instance. This invariant constrains the data model to be convergent-sync-compatible so that multi-instance synchronization does not require fundamental redesign. The sync protocol itself is a post-MVP feature.

**Test:** Simulate concurrent modifications to the same entity from two clients during a network partition. Reconnect. Verify that both clients converge to identical state without data loss, without human intervention, and regardless of the order in which partitioned modifications are replayed.

---

## 2. Event Sourcing Guarantees

**Failure modes addressed:** Home Assistant's opaque state management where "why did this happen?" is unanswerable. Debugging requires tribal knowledge. State corruption requires database rebuilds with data loss. No platform offers reliable replay or audit capability.

**Strategic context:** Deterministic event sourcing (ranked #8 in strategic analysis, weighted score 6.6/10) is the hardest capability to build but creates the deepest competitive moat. Neither Home Assistant nor OpenHAB implements event sourcing, CRDT-based state sync, or formal rule verification. A ScienceDirect study (n=137) found perceived reliability is the most important acceptance determinant for smart home adoption. Event sourcing makes "your home never forgets" a literal architectural property.

### INV-ES-01: Events Are Immutable Facts

Once an event is persisted, it is never modified or deleted by the system during normal operation. Events may be removed only by explicit retention policy execution, and only when the events predate the oldest active checkpoint. The event log is an append-only structure during normal operation.

**Test:** After any system operation, query the event log for events that existed before the operation. Every pre-existing event must be byte-identical to its original form.

### INV-ES-02: State Is Always Derivable from Events

All system state must be reconstructable by replaying the event log from a known checkpoint. If the state store is lost or corrupted, replaying events from the most recent valid checkpoint must produce identical state. No state may exist that is not the consequence of a recorded event.

**Test:** Destroy the state store. Replay events from the last checkpoint. Compare the rebuilt state to a snapshot taken before destruction. They must be identical.

### INV-ES-03: Per-Entity Ordering with Causal Consistency

Events for a single entity are strictly ordered by a per-entity monotonic sequence number. Cross-entity ordering is established by wall-clock timestamps (ULID) and causal metadata where applicable, not by a global sequence. This prevents a global ordering bottleneck on constrained hardware while preserving the ordering guarantees that matter for correctness.

**Test:** Under concurrent event production from multiple integrations, verify that per-entity sequences are gap-free and monotonically increasing. Verify that replaying events produces the same state regardless of cross-entity interleaving order, given identical per-entity sequences.

### INV-ES-04: Write-Ahead Persistence

Events are durable (persisted to stable storage) before they are delivered to any subscriber. No subscriber ever processes an event that could be lost to a crash. The persistence boundary is the commit point — if the system crashes after persist and before delivery, recovery replays the persisted-but-undelivered events.

**Test:** Inject a crash (kill -9) at random points during event processing. On restart, verify that every persisted event is eventually delivered to all subscribers. Verify that no subscriber holds state derived from an unpersisted event.

### INV-ES-05: At-Least-Once Delivery with Subscriber Idempotency

Every persisted event is delivered to every active subscriber at least once. Duplicate delivery is possible (and expected during crash recovery). Subscribers must be idempotent — processing the same event twice must produce the same result as processing it once. The system must provide mechanisms (event ID, sequence numbers) that make idempotency checks straightforward.

**Test:** Deliver the same event to a subscriber twice. Verify that the subscriber's resulting state is identical to processing the event once.

### INV-ES-06: Every State Change Is Explainable

For any observable system state, it must be possible to identify the specific event (or chain of events) that produced that state. The system must support a "why is this device in this state?" query that traces back through the event log to the causal event chain.

**Addressed failure mode:** Home Assistant's inability to explain automation behavior. Users cannot answer "why did the lights turn on at 3 AM?" without expert-level debugging.

**Test:** For any device state, issue a causal query. The system must return the event chain that produced that state, including the triggering event, any automation that fired, and the resulting command event.

### INV-ES-07: Event Schema Evolution

Event schemas must be forward-compatible within a major version. Events written by HomeSynapse X.Y must be readable by HomeSynapse X.Z where Z > Y. Each event envelope carries a schema version identifier. Consumers must tolerate unknown fields without failure (open-world assumption). Breaking schema changes are permitted only across major version boundaries and require an explicit migration path.

**Addressed failure mode:** Home Assistant's breaking changes that corrupt or invalidate historical data during upgrades.

**Test:** Create events with schema version N. Upgrade the system to a version that uses schema version N+1 (same major version). Verify that all historical events are still readable, queryable, and replayable.

### INV-ES-08: Event Time and Ingest Time Are Distinct

Every event in the system carries two timestamps with well-defined, distinct semantics:

1. **Event time** — when the real-world occurrence happened, as reported by the event source. For a Zigbee temperature sensor, this is when the sensor took the reading. For a user pressing a wall switch, this is when the switch was pressed. For a grid signal, this is the timestamp the utility assigned to the signal. Event time may be in the past relative to ingest time (a sensor reading delayed by mesh routing) or may be estimated (a device that does not report its own timestamps uses the best available approximation, documented as estimated in the event metadata).

2. **Ingest time** — when the HomeSynapse event bus accepted and persisted the event. This is always the system's local clock at the moment of persistence. Ingest time defines the position in the append-only log and is used for persistence ordering and subscriber delivery ordering.

The system must be explicit about which timestamp semantics apply in every context where time matters:

- **Automation triggers and conditions** evaluate against **event time** by default. An automation that triggers on "temperature above 80°F for 5 minutes" uses event time to determine whether the 5-minute window has elapsed, not ingest time. This is critical because mesh routing delays, integration polling intervals, and system load can introduce seconds to minutes of lag between event time and ingest time.

- **Retention policies** operate on **event time**. Events older than the retention window based on their event time are eligible for removal. This prevents a delayed event from being retained longer than intended because it arrived late.

- **Event log ordering and replay** use **ingest time** for the global append order (supplemented by per-entity sequence numbers for entity-level ordering per INV-ES-03). Replay produces identical state by replaying events in ingest-time order within each entity stream.

- **User-facing queries** ("show me what happened at 3 AM") match against **event time** by default, with the option to filter or sort by ingest time for diagnostic purposes. The UI must clearly indicate when event time and ingest time differ significantly (> 5 seconds), as this gap is itself a diagnostic signal (mesh congestion, integration lag, clock skew).

- **Energy time-of-use calculations** and **carbon-aware scheduling** (INV-EI-02, INV-EI-03) operate on **event time** for consumption and production readings, and on **ingest time** for grid signal responsiveness.

- **Presence tracking** (INV-MU-02) uses **event time** for "when did Alice enter the room" queries and **ingest time** for "how stale is the most recent presence update" freshness checks.

The event envelope schema must include both timestamps as required fields. Neither may be omitted. Event sources that cannot provide event time must document this limitation, and the system must assign an estimated event time equal to ingest time with an `estimated: true` flag in the event metadata.

**Rationale:** The distinction between event time and ingest time is fundamental to correctness in any event-sourced system that processes real-world events from devices with variable communication latency. Zigbee mesh routing can introduce 100ms–2s delays. Z-Wave polling intervals can introduce 1–30s delays. A temperature reading that arrives 10 seconds late must be evaluated as having occurred 10 seconds ago, not now — otherwise time-window automations, energy calculations, and presence tracking produce incorrect results. Conflating the two timestamps is a design error that becomes progressively harder to fix as the event log grows and consumers make assumptions about time semantics.

**Test:** Produce a temperature event with event time T and ingest time T+5s (simulating mesh delay). Create an automation that triggers on "temperature above threshold for 3 minutes." Verify the automation uses event time, not ingest time, to evaluate the duration. Separately, query "events at time T" and verify the delayed event appears in the results. Query the event log in persistence order and verify the event appears at its ingest-time position.

---

## 3. Reliability and Fault Tolerance

**Failure modes addressed:** Home Assistant's RPi3 10-minute boots, 25-second automation delays on RPi4. Community consensus shifting to recommending x86 hardware. Smart home fatigue driven by steady accumulation of small frustrations. "It worked yesterday" syndrome across all platforms. Google Home acknowledged "major reliability issues" including automations firing incorrectly or not at all. Insteon collapse bricked customers' devices entirely.

### INV-RF-01: Integration Isolation

Each integration (device protocol adapter, third-party connector, plugin) runs in a supervised, isolated execution context. A crash, hang, or resource exhaustion in one integration must not affect the core runtime, other integrations, or the event bus. The core must continue processing events and executing automations for all unaffected integrations.

**Isolation boundary is an implementation detail, not an API contract:** The specific isolation mechanism (in-process with virtual thread supervision, out-of-process with IPC, container-level sandboxing) is an implementation decision that may change across versions and may differ across deployment tiers — without requiring any change to integration code. An integration written against the Integration API (INV-CS-04) must function identically whether it runs in-process on a Raspberry Pi (where IPC overhead would be prohibitive) or out-of-process on an x86 server (where stronger isolation is worth the overhead). The Integration API must not expose or depend on the isolation mechanism.

This means: the Integration API communicates through abstract interfaces (event production, event subscription, device registration, state queries), not through mechanisms that imply a specific process topology (shared memory, direct method calls on core objects, process signals). The API boundary is designed so that it can be implemented as in-process method dispatch today and replaced with IPC, gRPC, or Unix domain sockets tomorrow without breaking a single integration.

**MVP expectation:** The MVP will use in-process isolation with Java 21 virtual threads and resource monitoring. This is sufficient for Constrained-tier deployments and avoids the IPC overhead that would degrade Pi 4 performance. The isolation boundary may be strengthened in future versions for Enhanced-tier deployments without requiring integration authors to rewrite or recompile their integrations.

**Addressed failure mode:** Home Assistant's single-process architecture where one misbehaving integration can degrade the entire system.

**Test:** Deliberately crash an integration (OOM, infinite loop, unhandled exception). Verify that other integrations continue operating, automations for unaffected devices continue firing, and the core event bus throughput is unaffected. Separately, deploy the same integration binary against both an in-process isolation host and a simulated out-of-process isolation host (if available). Verify that the integration's behavior is identical in both environments.

### INV-RF-02: Resource Quotas for Integrations

Every integration operates within configurable resource bounds (memory, CPU time, event production rate, file descriptors). An integration that exceeds its quota is throttled or terminated, not permitted to degrade the system. Default quotas must be sensible for constrained hardware without requiring user configuration.

**Test:** Deploy an integration that attempts to allocate unbounded memory. Verify that the integration is terminated before it impacts core memory availability. Verify that other integrations are unaffected.

### INV-RF-03: Startup Independence

A failing integration must not block system startup. Integrations start asynchronously. If an integration fails to initialize, the system records the failure, marks the integration as unhealthy, and proceeds. The user can access the dashboard, control working devices, and diagnose the failure without waiting for a timeout.

**Addressed failure mode:** Home Assistant's boot time scaling with integration count, leading to 10+ minute startups that block all functionality.

**Test:** Configure an integration that hangs during initialization (e.g., unreachable network device). Verify that the system reaches a functional state (dashboard accessible, other integrations operational) within the startup time target regardless of the hanging integration.

### INV-RF-04: Crash Safety and Automatic Recovery

The system must recover to a consistent state after an unclean shutdown (power loss, OOM kill, kernel panic) without user intervention. Recovery must not require manual repair, database rebuild, or configuration editing. The event log and checkpoint mechanism defined in §2 provide the recovery foundation.

**Test:** Kill the process with SIGKILL during active event processing. Restart. Verify that the system reaches a consistent, operational state automatically. Verify that no data corruption occurred (event log integrity, state consistency with event log).

### INV-RF-05: Bounded Storage Growth

Storage consumption must be governed by configurable retention policies with sensible defaults. The system must never allow unbounded growth that degrades performance or exhausts disk space. Default retention policies must keep a constrained-tier deployment healthy for years without manual intervention.

**Addressed failure mode:** Home Assistant's Recorder component creating 7–95 GB databases that kill SD cards within months.

**Test:** Run a simulated workload (50 devices, typical event rates) for the equivalent of one year of operation under default retention settings. Verify that database size remains within the configured bounds and that query performance does not degrade.

### INV-RF-06: Graceful Degradation Under Partial Failure

When a subsystem or integration is degraded, the rest of the system must continue operating at full capability for the unaffected scope. Partial failure is the normal operating condition in a home with diverse devices on diverse protocols. Total system failure should require a failure of the core event bus or persistence layer — not a failure of any single integration, protocol, or device.

**Test:** Disable or crash individual subsystems (Zigbee adapter, automation engine, state store). For each, verify that unaffected subsystems continue operating correctly.

---

## 4. Compatibility and Stability Contracts

**Failure modes addressed:** Home Assistant's monthly breaking changes — the #1 complaint across user forums. HACS integration breakage on updates. Entity renaming described as "a nightmare." Update fatigue driving users to skip updates, creating security debt.

### INV-CS-01: Semantic Versioning Is Enforced

HomeSynapse follows Semantic Versioning 2.0.0. Within a major version: no breaking changes to public APIs, event schemas, configuration schemas, entity ID formats, or automation definitions. Bug fixes and new features are additive. Breaking changes occur only at major version boundaries with explicit migration paths.

**Test:** Maintain a comprehensive API and schema compatibility test suite that runs against every release candidate. Any test that passes on version X.Y must pass on X.Z (Z > Y) without modification.

### INV-CS-02: Entity Identifiers Are Stable

Once an entity (device, sensor, actuator, automation) is assigned an identifier, that identifier does not change unless the user explicitly renames it. System upgrades, integration updates, and configuration changes must not alter entity identifiers. The identifier format must accommodate future hierarchical structures (areas, floors, zones) and multi-user context (INV-MU-01) without breaking existing identifiers.

**Addressed failure mode:** Home Assistant's entity naming changes that cascade through automations, dashboards, and scripts.

**Test:** Create entities. Upgrade the system across minor versions. Verify that all entity identifiers are unchanged. Verify that automations referencing those identifiers continue to function.

### INV-CS-03: Configuration Schema Stability

The configuration schema is versioned and backward-compatible within major versions. Configuration files written for HomeSynapse X.Y must load without modification on X.Z (Z > Y). New configuration options have defaults that preserve existing behavior. Deprecated options produce warnings but continue to function for at least one major version.

**Test:** Load a configuration file from the oldest minor version in the current major series. Verify it loads, functions correctly, and produces no errors (warnings for deprecated options are acceptable).

### INV-CS-04: Integration API Stability

The public API surface that integrations are built against is versioned independently of the core. Integration API versions follow semver. An integration compiled against API version X.Y must function on any core version that supports API version X.Z (Z ≥ Y). This prevents the "integration breaks on every update" pattern.

**Addressed failure mode:** HACS integrations breaking on monthly Home Assistant releases.

**Test:** Build an integration against API version X.Y. Upgrade the core to a version that supports X.(Y+N). Verify the integration loads, initializes, and functions without recompilation.

### INV-CS-05: Update Safety Mechanisms

Every system update must include: an automatic snapshot of configuration, state, and event data taken before the update is applied; a documented rollback procedure that restores the pre-update state; and a dry-run validation mode that checks compatibility without applying changes. "It worked yesterday" must remain true after updates.

**Addressed failure mode:** Home Assistant updates that break working setups with no rollback path.

**Test:** Apply an update. Verify that a pre-update snapshot exists. Execute a rollback. Verify that the system returns to its exact pre-update state and all devices, automations, and configurations function as they did before the update.

### INV-CS-06: Deprecation Discipline

No feature, API, configuration option, or behavioral contract may be removed without following the deprecation protocol: (1) announce deprecation at least one major version in advance, (2) provide a migration path in documentation, (3) produce visible warnings during the deprecation period, (4) provide automated migration tooling where feasible. Deprecation timelines are measured in major versions, not calendar time.

**Test:** Verify that no feature removal in a release lacks a corresponding deprecation announcement in the prior major version, a documented migration path, and runtime deprecation warnings.

### INV-CS-07: No Forced Hardware Obsolescence

HomeSynapse must never intentionally drop support for hardware that meets the minimum requirements published for the current major version. If minimum requirements increase at a major version boundary, the prior major version must receive security fixes for a documented support window.

---

## 5. Household Operability

**Failure modes addressed:** Partner/household acceptance problem universal across all platforms. 1 in 4 Americans say smart devices aren't worth the hassle. Smart home fatigue from steady accumulation of small frustrations. Highest-acceptance systems are completely invisible automation. IDC 2023 data reveals satisfaction plateaus at 3–4 years and actually declines for 5+ year users — multi-user friction and accumulated complexity are plausible drivers.

### INV-HO-01: Physical Control Supremacy

Physical controls (wall switches, manual buttons, hardware remotes) must always function as expected. The automation system must never prevent, override, or delay a physical control action. If an automation conflicts with a physical action, the physical action wins. A failure of HomeSynapse must never remove baseline "dumb" functionality from any device that has physical controls.

**Test:** While an automation is actively controlling a device, activate its physical control. Verify the physical control takes effect immediately. Kill the HomeSynapse process entirely. Verify that physical controls continue functioning (this is a device/protocol property, but HomeSynapse must never configure devices in a way that violates it).

### INV-HO-02: Operable Under Degradation

When HomeSynapse is degraded (integration failure, ongoing update, partial network outage), a non-technical household member must be able to operate lights, locks, climate controls, and other daily-use devices through their physical controls and, where the device protocol allows, through the HomeSynapse dashboard. Error states must be comprehensible without technical knowledge.

**Test:** Degrade the system (kill an integration, disconnect a protocol adapter). Hand the dashboard to a non-technical user. They must be able to identify which devices are affected, operate unaffected devices, and understand the error state without assistance.

### INV-HO-03: No Debugging for Daily Operation

Daily household operation (controlling devices, observing status, running manual scenes) must never require debugging skills, log inspection, YAML editing, or command-line access. All daily operations must be achievable through the graphical interface. Advanced configuration and troubleshooting may require technical skills, but routine use must not.

### INV-HO-04: Self-Explaining Errors

When an error affects user-visible behavior (device unreachable, automation failed, integration unhealthy), the system must present a human-readable explanation that: states what happened, states which devices or automations are affected, and suggests a concrete action the user can take. Error codes are exposed for technical users but are never the only information presented.

**Addressed failure mode:** Across all platforms, error messages that surface internal exceptions, protocol codes, or generic "something went wrong" messages.

### INV-HO-05: The Partner Test

Before any release, the system must be validated against this criterion: a non-technical household member who did not set up the system must be able to perform all daily operations (INV-HO-03), understand error states (INV-HO-04), and never encounter internal terminology, debugging interfaces, or states that make the home feel experimental. This is a release gate, not an aspiration.

---

## 6. Privacy and Data Sovereignty

**Failure modes addressed:** Amazon collecting 28/32 possible data points. Google's $68M settlement for secret recordings, $392M for location tracking. 53% of Americans nervous about smart home data security. Pervasive dark patterns in consent flows. ML attacks achieving MCC 0.956 in inferring in-home activities from network traffic metadata alone (ACM ToIT).

**Strategic context:** Privacy infrastructure (ranked #5 in strategic analysis, weighted score 7.4/10) is a strategic moat rather than a revenue driver. Privacy-first products are commercially viable at niche scale: Proton AG generates ~$97–134M revenue, Signal serves 70–100M MAU, DuckDuckGo processes ~100M searches/day. The median consumer willingness to pay for privacy protection is $5/month to protect versus $80/month to allow access — a 16:1 superendowment ratio. Privacy should be architectural (built into every layer), never sold as a premium tier.

### INV-PD-01: Zero Telemetry by Default

No telemetry, analytics, usage data, or diagnostic information is collected or transmitted unless the user explicitly enables it through a clear opt-in flow. The default installation transmits zero bytes to any external service. There are no dark patterns, no pre-checked boxes, and no "required for service improvement" exceptions.

**Test:** Install HomeSynapse. Monitor all network traffic. Verify that no outbound connections are made to any NexSys, analytics, or third-party service. Verify that the only outbound connections are those the user explicitly configures (e.g., integration to a device vendor's local API).

### INV-PD-02: Data Residency Is User-Controlled

All data generated by HomeSynapse resides on the user's hardware by default. If the user opts into cloud features, they control what data leaves their network, where it is stored, and how long it is retained. The system must provide a clear, in-application inventory of what data exists locally and what data (if any) has been transmitted externally.

### INV-PD-03: Encrypted Storage

All sensitive data (credentials, API keys, tokens, personal information) must be encrypted at rest using user-owned keys. Backups must be encrypted. The encryption implementation must use established algorithms (AES-256-GCM or equivalent) and must not rely on obscurity. Key management must be designed so that data is irrecoverable without the user's key material.

**At-rest posture (added by AMD-86, RATIFIED 2026-06-07 — PARTIAL satisfaction at MVP; owner doc Doc 15 §3.4/§3.5):** At MVP, the sensitive-PII categories are encrypted at rest under **per-scope DEKs** (application-level, per-category — never whole-database, so per-category crypto-shredding remains possible), rooted on a **machine-local key** (zero-config, INV-CE-02). **MVP is a *partial* satisfaction of this invariant:** at-rest encryption — yes; the **"user-owned keys"** property — not yet. Because the machine-local key sits on the **same medium** as the data, MVP encryption protects **data copies that exclude the key file** (key-excluding backups, synced/copied data directories) and runtime reads by a **less-privileged process**; it does **NOT** protect against **theft of the storage medium itself** (the key travels with it) or an **on-device-root adversary**. The full form — *irrecoverable without the user's key material*, and media-theft resistance — is a **Tier-2** property, delivered by a **passphrase-derived root** (never stored) **or a TPM-sealed root** on TPM-equipped hardware (the Pi-4 validation floor has none; a passphrase breaks zero-config — so this is genuinely Tier-2, not an MVP omission). The exact set of categories encrypted-on-write at MVP is the sensitive-PII set by default, tuned against the Raspberry-Pi-4 AES-256-GCM write-path benchmark (OQ-15-2), with a category falling back to plaintext-at-rest only where Pi-4 performance genuinely forces it, documented consciously. *(AMD-86-INV-01 §35.)*

### INV-PD-04: Transparent Data Boundaries

The system must maintain a machine-readable and human-readable manifest of: what data is stored locally and where, what data can potentially leave the home (if any cloud features are enabled), which external services each integration communicates with, and what data each integration sends to those services. This manifest must be accessible from the UI, not buried in documentation.

**Addressed failure mode:** Every major platform's opaque data practices that are discoverable only through privacy policy analysis or network traffic inspection.

### INV-PD-05: Consent Is Granular, Informed, and Revocable

Any feature that transmits data externally requires explicit, granular consent. Consent flows must state: what specific data is transmitted, to which specific service, for what specific purpose, and how long the data is retained. Consent must be revocable at any time, and revocation must halt further data transmission and, where technically feasible, trigger deletion of previously transmitted data.

### INV-PD-06: Offline Integrity

When operating offline, the system must prioritize data integrity above all other concerns. No background process may corrupt the event log or state store. Write operations must be transactional and crash-safe. The system is designed assuming power loss and network interruption are normal operating conditions, not exceptional events.

### INV-PD-07: Crypto-Shredding for Sensitive Data Lifecycle

The system must support crypto-shredding — encrypting data under per-scope keys and rendering it irrecoverable by destroying the relevant key — as the mechanism for data deletion in an append-only event log. This capability reconciles the immutable event log invariant (INV-ES-01) with data lifecycle requirements including GDPR "right to erasure" and user-initiated data deletion.

**Scope of application:** Crypto-shredding applies to data categories that contain personal, behavioral, or regulatorily sensitive information. Not every event in the system requires per-scope encryption. The following data categories must be encrypted under scoped keys and support crypto-shredding:

- **Behavioral data:** Occupancy patterns, presence history, usage schedules, learned preferences (INV-AI-05). This data reveals daily routines and is among the most privacy-sensitive data the system generates.
- **Energy consumption and production data:** Meter readings, tariff interactions, grid program participation (INV-EI-04). Energy data reveals occupancy, economic behavior, and daily patterns.
- **Identity and presence data:** Per-user presence events, preference records, role assignments (INV-MU-01, INV-MU-02). This data links physical location to named individuals.
- **Media and audio data:** If ambient sensing features are enabled (§16.10), any audio-derived event data must be shred-capable.
- **Any data category explicitly designated as sensitive by the user** through the consent framework (INV-PD-05).

The following data categories do **not** require crypto-shredding by default, because they do not contain personal or behavioral information:

- **Device state events:** "Light turned on," "temperature reading 72°F," "door sensor open." These are device-level facts that do not inherently reveal personal information when disconnected from identity and presence context.
- **System operational events:** Integration health, error events, configuration changes, update history. These are system infrastructure records.
- **Network telemetry:** RSSI, LQI, route changes (§14). These are protocol-level metrics.

Users may opt to extend crypto-shredding to additional data categories through configuration. The architecture must support this without schema changes — the scoping mechanism must be flexible enough to encrypt any event category under a dedicated key.

**Key management:** Each scope (data category × user, or data category × household, depending on the category) is encrypted under its own key. Key material is derived from user-owned root keys and stored in the encrypted secrets store (INV-PD-03). Retention policy execution and user data deletion operate through key destruction, not event mutation — the events remain in the log (preserving the append-only invariant) but become irrecoverable.

**MVP scope (narrowed by AMD-86, RATIFIED 2026-06-07):** The MVP must implement the per-scope key management infrastructure and define the encryption scope categories. At MVP, the sensitive-PII categories (identity, person-linked presence) are **written encrypted-at-rest under per-scope keys** (INV-PD-03), which preserves their crypto-shreddability on the immutable log. **Operational crypto-shredding — the key-destruction API and the data-erasure triggers that consume those keys — lands with the first cloud or institutional data-sharing product** (its first real consumer); a local single-home installation's data-deletion recourse at MVP is whole-installation reset. The per-scope key-management infrastructure, the encryption-scope categories, and the `scope_keys` schema seat the operation as a clean later-add over the already-encrypted historical corpus, with no migration. Extension to additional categories is incremental. *(Pre-AMD-86 text mandated "Crypto-shredding must be operational for at least one data category" at MVP; AMD-86 deferred the operation to its first real consumer per decision D2, preserving the design intent and the schema seam. Owner doc: Doc 15 §3.6. AMD-86-INV-01 §35.)*

**Test:** Encrypt a set of presence events under a user-scoped key. Destroy the key. Verify that the events remain in the log (append-only invariant preserved) but are irrecoverable (decryption fails). Verify that system operation is unaffected by the presence of shredded events. Verify that device state events in the same time range remain readable and unaffected.

### INV-PD-08: Tamper-Evident System Integrity

The system must maintain a cryptographic integrity chain for firmware updates, system packages, and configuration changes that allows users or auditors to verify independently that the software running on their hardware has not been tampered with. This verification must not require trust in NexSys or any third party — the user's local system must be able to validate the integrity chain using only locally available cryptographic material and the published signing keys.

The integrity chain must cover:

- **Firmware and update packages:** Every update package must be cryptographically signed. The system must verify signatures before applying updates and must reject packages that fail verification. The signing key and the verification process must be documented and auditable.
- **System configuration changes:** Configuration changes must be recorded in an append-only, tamper-evident structure (hash chain or equivalent) so that unauthorized modifications are detectable. This protects against both external tampering and software bugs that silently alter configuration.
- **Integration provenance:** When a user installs a third-party integration, the system must record and verify the integration's signature, source, and version in the integrity chain. A user must be able to verify that the integration running on their system matches the published version.

**What this invariant does not cover (deferred to §16):** Extending the tamper-evident log to cover automation execution history, data access auditing, and fine-grained behavioral transparency. These are valuable capabilities that build on the integrity chain infrastructure, but they represent significant engineering scope beyond what is required for MVP system integrity. The MVP integrity chain must be designed to accommodate these extensions — the log structure and verification mechanism must be extensible — but the extensions themselves are post-MVP. See §16.5 for the directional commitment.

**Rationale:** Tamper-evident system integrity is table-stakes security for an infrastructure platform that controls physical devices in a home. The cryptographic infrastructure (hash chains, signing, verification) is well-understood and achievable at MVP scale. Broader transparency capabilities (verifying "what automations ran last night" or "what data was accessed") build on the same infrastructure but require substantially more engineering to implement correctly and performantly. Deferring the broader scope while locking the foundational integrity mechanism is the right tradeoff.

**Test:** Record a sequence of update events and configuration changes to the integrity chain. Tamper with one entry. Verify that the tampering is detectable through hash chain verification without requiring any external service. Separately, install a signed integration, modify its files on disk, and verify that the system detects the modification on next startup.

---

## 7. Transparency and Observability

**Failure modes addressed:** Opaque automation behavior across all platforms. "It worked yesterday" syndrome with no diagnostic path. Home Assistant's debugging requiring expert knowledge of internal architecture.

### INV-TO-01: System Behavior Is Observable

The system must expose sufficient telemetry for a technically competent user to understand: what the system is doing right now (live event stream, active automations, integration status), why the system did something (event causal chains, automation evaluation traces), and how the system is performing (resource usage, event throughput, latency metrics, mesh network quality). Observability is a core feature, not a debugging add-on.

### INV-TO-02: Automation Determinism

Given identical event streams and identical configuration, the automation engine must produce identical outcomes. Automation evaluation must be traceable — for any automation execution, the system must record: the triggering event, the conditions evaluated (and their results), the actions dispatched, and the outcome of each action. Conflict resolution rules (when multiple automations respond to the same event) must be explicit, documented, and deterministic.

**Test:** Replay a recorded event stream through the automation engine twice with identical configuration. Verify that the sequence of dispatched actions is identical.

### INV-TO-03: No Hidden State

All state that influences system behavior must be inspectable. There must be no hidden caches, undocumented internal flags, or implicit state derived from timing or ordering that is not captured in the event log. If it affects behavior, it must be visible.

### INV-TO-04: Structured, Queryable Logs

System logs must be structured (machine-parseable), contextual (include correlation IDs that trace from trigger event through automation evaluation to device command), and queryable through the UI for common diagnostic scenarios. A user investigating "why did the lights turn on at 3 AM?" must be able to find the answer through the interface without grep.

---

## 8. Configuration and Extensibility

**Failure modes addressed:** Home Assistant's YAML-vs-UI war (ADR 0010). Power users wanting Git-trackable configuration. Newcomers wanting visual configuration. Neither served. Opaque JSON storage that is not human-readable or diffable.

### INV-CE-01: Canonical, Human-Readable Configuration

All configuration must exist in a single canonical representation that is: human-readable (documented YAML schema), machine-parseable (validated against JSON Schema), version-controllable (diffable, mergeable, suitable for Git), and the sole source of truth. The UI reads and writes this same canonical representation. There is no separate "UI storage" and "file storage" — there is one configuration, accessible through multiple interfaces.

**Addressed failure mode:** Home Assistant's dual configuration systems (YAML and opaque UI storage) that created a permanent rift in the user base.

**Test:** Create a configuration through the UI. Read the resulting file on disk. Verify it is valid, human-readable YAML. Edit the file by hand. Reload. Verify the UI reflects the change. Verify the round-trip is lossless.

### INV-CE-02: Zero-Configuration First Run

HomeSynapse must start and reach a functional state with no user-provided configuration. Every configuration option must have a sensible default. The first-run experience is: install, start, access the dashboard, begin adding devices. No YAML editing, no configuration wizards with mandatory fields, no prerequisite decisions.

### INV-CE-03: Configuration Schema Is Documented and Versioned

The configuration schema is published, versioned, and validated at startup. Every configuration option is documented with: its type, default value, valid range or allowed values, and the behavior it controls. Schema changes follow the compatibility rules in INV-CS-03.

### INV-CE-04: Protocol Agnosticism in the Device Model

The device model presents a unified abstraction above protocol-specific details. An automation that turns on a light must use the same interface regardless of whether the light is Zigbee, Z-Wave, Matter, Wi-Fi, or a future protocol. Protocol-specific capabilities are accessible but never required for common operations.

**Rationale:** The protocol ecosystem will remain fragmented for the foreseeable future. Matter adoption has reached 10,400+ certified products by end of 2024, but Zigbee, Z-Wave, Thread, and Wi-Fi each serve different niches and will coexist for years. HomeSynapse must unify them at the application layer without hiding protocol-specific capabilities that power users need.

### INV-CE-05: Extension Model with Stability Guarantees

Third-party integrations (community devices, plugins, protocol adapters) must be buildable against a stable, documented API with the versioning guarantees defined in INV-CS-04. The extension model must support: isolated execution (INV-RF-01), resource quotas (INV-RF-02), independent version pinning (an integration version is not coupled to core version), and graceful degradation when an extension fails.

### INV-CE-06: Migration Tooling Accompanies Schema Evolution

When configuration schemas, entity models, or automation definitions evolve, automated migration tooling must be provided. Users must never be required to manually rewrite configuration files to accommodate a system update. Migration tooling must be idempotent (safe to run multiple times), reversible (migration can be undone), and preview-able (user can see what will change before applying).

---

## 9. Performance and Resource Discipline

**Failure modes addressed:** Home Assistant's performance on Raspberry Pi (10-minute boots, 25-second automation delays). Community consensus shifting to recommending x86 hardware, raising the barrier to entry. Setup time inversely correlated with capability across all platforms.

### INV-PR-01: Constrained Hardware Is the Primary Design Target

The Raspberry Pi 4 (4 GB RAM) is the validation target; the Raspberry Pi 5 (4–8 GB RAM) is the recommended deployment target. Every subsystem must be designed, benchmarked, and tested against the Pi 4 class. Performance that is acceptable on an x86 workstation but degraded on a Pi is a bug, not a deployment recommendation. Users must never be told "upgrade your hardware" as the answer to a performance problem that is solvable through engineering.

**Rationale:** If HomeSynapse runs well on a Pi 4, it runs well everywhere. The reverse is not true. Designing for the constrained case prevents the performance creep that pushed Home Assistant's community to recommend x86.

### INV-PR-02: Quantitative Performance Targets

Performance targets are split into two categories: **constitutional targets** that are locked in this document and enforceable as invariants, and **operational budgets** that are defined in subsystem design documents and may evolve as workloads and hardware capabilities change.

**Constitutional targets** protect user-facing responsiveness. These are the performance properties that directly affect whether a household member perceives the system as fast, sluggish, or broken. They are stated with units, measured on the validation target (Raspberry Pi 4, 4 GB RAM), and enforced in CI. Violating these targets is a bug with the same severity as a correctness bug.

| Metric | Target (RPi4 4GB) | Rationale |
|---|---|---|
| Startup to functional dashboard | < 10 seconds | Users must not wait for the system to boot before controlling their home. A boot time longer than this makes the system feel broken after a power outage. |
| End-to-end device command (local) | < 300 ms | Physical-feeling responsiveness for light toggles, lock commands. Above 300ms, users perceive lag and lose trust in the system. |
| Automation evaluation (p99) | < 100 ms | Complex automations must not introduce perceptible delay between trigger and action. |
| REST API response (p99) | < 50 ms | Dashboard and third-party consumers must feel responsive. |
| Dashboard initial load | < 500 ms | First meaningful paint for the observability UI. Longer than this and users perceive the dashboard as slow. |
| Steady-state memory | < 512 MB | Leaves headroom on 4 GB for OS and other services. Exceeding this creates memory pressure that degrades the entire system. |

These targets are for 50 devices at typical event rates on the validation target hardware. The same latency targets must hold at proportionally higher device counts on proportionally more capable hardware.

**Operational budgets** are performance targets that depend on workload profile, hardware tier, and subsystem-specific implementation decisions. They are defined and enforced in subsystem design documents, not in this invariant document. Operational budgets may be revised through the normal design document process without requiring an invariant amendment. The following are the initial operational budgets; authoritative values live in the relevant subsystem design documents:

| Metric | Initial Budget (RPi4 4GB) | Governing Subsystem | Notes |
|---|---|---|---|
| Event processing latency (p99) | < 5 ms | Event Model & Event Bus | Workload-dependent: event complexity, subscriber count, and persistence backend affect this. |
| Event throughput (sustained) | > 100 events/sec | Event Model & Event Bus | Scales with hardware: Enhanced tier targets > 1,000 events/sec. |
| ML inference latency (p99) | < 20 ms | AI & Intelligence subsystem | Model-dependent: LightGBM 0.4–1.2ms, TinyLSTM 3–7ms demonstrated on Pi 5. Budget applies only when AI features are enabled. |
| State query latency (p99) | < 10 ms | State Store | Depends on entity count and query complexity. |
| Checkpoint write duration | < 2 seconds | Persistence Layer | Must not block event processing (INV-ES-04). Budget depends on state size. |

The distinction matters: if the dashboard takes 800ms to load, that is a constitutional violation regardless of circumstances. If ML inference takes 25ms because a user deployed a larger model than the hardware comfortably supports, that is an operational budget issue to be resolved through configuration guidance, not an invariant violation.

**[SCALES]** At the Enhanced and Multi-instance tiers, the system must sustain the constitutional latency targets at device counts and event rates proportional to the hardware capability. Specific scaling targets are defined in subsystem design documents.

### INV-PR-03: Resource Usage Is Bounded and Predictable

Memory consumption, disk I/O, and CPU usage must be bounded by configuration and predictable given the number of devices, event rate, and retention policy. Resource usage must not grow unboundedly over time. The system must function correctly for years on constrained hardware without manual resource management.

### INV-PR-04: Architecture Must Accommodate 1,000 Devices

Even if the MVP supports fewer devices, the architecture must be designed so that scaling to 1,000 devices does not require fundamental redesign. Data structures, event routing, and state management must be designed for this scale from day one. This is an architectural constraint, not a performance target — the MVP need not *achieve* 1,000-device performance, but the architecture must not *prevent* it.

---

## 10. Security

**Failure modes addressed:** Default credentials on consumer devices. Unencrypted local communication. Smart home systems as lateral movement vectors in home networks. Security as an afterthought that is never retrofitted successfully.

### INV-SE-01: No Default Credentials

HomeSynapse must never ship with default usernames, passwords, API keys, or tokens. First-run setup must require the user to create credentials. No "admin/admin" defaults, no well-known tokens, no backdoors.

### INV-SE-02: Authentication Required for All External Interfaces

Every interface accessible over the network (REST API, WebSocket API, dashboard) must require authentication. There is no "local network trust" exception — a compromised device on the same network must not gain unauthenticated access to HomeSynapse.

### INV-SE-03: Secrets Encrypted at Rest

All secrets (credentials, API keys, tokens, encryption keys for integrations) must be encrypted at rest using AES-256-GCM or equivalent. Secrets must never be stored in plaintext in configuration files, databases, or logs. Log output must redact secret values.

### INV-SE-04: Least Privilege for Integrations

Integrations must operate with the minimum permissions required for their function. An integration that controls lights must not have access to lock controls, camera feeds, or system configuration. The permission model must be explicit (declared in the integration manifest) and enforceable (the runtime denies unauthorized access).

### INV-SE-05: Remote Access Is End-to-End Encrypted

If remote access is enabled (optional — never required), all communication between the remote client and the HomeSynapse instance must be end-to-end encrypted. NexSys infrastructure, if used as a relay, must not have access to the plaintext content of the communication.

### INV-SE-06: Security Updates Without Feature Churn

Security fixes must be deliverable independently of feature updates. A user who wants security patches but does not want new features must have a path to receive them. This is the foundation of a future LTS channel, but the architectural separation of security fixes from feature delivery is an invariant from day one.

---

## 11. AI and Intelligence

**Failure modes addressed:** Cloud AI dependencies creating single points of failure. Opaque algorithmic decision-making in consumer platforms. Privacy erosion through behavioral data collection for model training. User distrust of "smart" features that cannot be explained.

**Strategic context:** Human-behavior modeling (ranked #2, weighted score 8.2/10) is the most technically ready domain with proven Pi performance. Edge AI (ranked #7, weighted score 7.0/10) is becoming table stakes. Multi-sensor occupancy detection achieves 95% accuracy (NIST-validated) with zero cameras. Reinforcement learning for HVAC delivers 8.8–26.3% energy savings. A Cambridge case study demonstrated a LightGBM classifier running on Pi 5 achieving 11% gas reduction versus a cloud-connected Nest while maintaining ±0.4°C comfort during a 14-hour ISP outage.

### INV-AI-01: AI Is Enhancement, Never Foundation

Core automation, device control, event processing, and state management must never depend on AI or machine learning models. If all AI features are disabled, the system must function at full core capability. AI features must be independent modules that enhance (suggest automations, optimize scheduling, detect anomalies) but never gate core functionality.

**Test:** Disable all AI-related configuration. Verify that every core function operates identically to a system where AI was never installed.

### INV-AI-02: AI Requires Explicit Consent

No AI feature may process user data without explicit, informed consent obtained through the consent framework defined in INV-PD-05. The user must know: what data the AI feature accesses, whether processing is local or remote, what the AI feature produces from that data, and how to revoke consent and delete AI-processed derivatives.

### INV-AI-03: AI Decisions Are Explainable

Any AI-generated suggestion, prediction, or action must be accompanied by an explanation that a non-expert can understand. "AI suggested this automation" is insufficient. "Based on your pattern of turning on the porch light at sunset on weekdays, this automation would do it automatically" is the minimum standard. AI must never make opaque decisions that affect the physical home.

### INV-AI-04: Local AI Capability

The architecture must support local AI inference (on-device model execution) for users who want AI features without sending data to cloud services. The system must not assume that AI requires cloud connectivity. Local inference may be less capable than cloud-based inference, but the option must exist. The AI pipeline must be designed around models that run on Pi-class hardware: LightGBM classifiers (0.4–1.2ms inference), TinyLSTM networks (3–7ms), and ONNX-format models via the Java DJL or ONNX Runtime.

**[SCALES]** At the Enhanced and Multi-instance tiers, cloud-based AI may offer additional capabilities beyond local inference, subject to INV-AI-02 consent requirements. Hardware AI accelerators (Hailo-10H at 40 TOPS, future NPUs) may expand on-device capability at higher tiers.

### INV-AI-05: On-Device Behavior Modeling

The system must support learning and applying behavioral patterns (occupancy schedules, usage preferences, energy consumption profiles) entirely on-device without transmitting behavioral data to any external service. Behavioral models must be: interpretable (the system can explain what pattern it learned and why it made a recommendation), correctable (the user can override or constrain learned behaviors), and deletable (the user can reset learned patterns without affecting core system operation). Model training data must never leave the device unless the user explicitly opts into a federated learning program governed by INV-PD-05.

**Rationale:** Local behavior modeling achieves Nest-class intelligence without cloud dependency. The privacy advantage is quantifiable — ML attacks achieve MCC 0.956 inferring in-home activities from network metadata alone. Local processing eliminates all data exfiltration vectors by design.

**MVP scope:** The MVP must define the behavioral data pipeline (how sensor events are collected, windowed, and feature-extracted for model input). Trained behavior models are post-MVP, but the data pipeline must be in place.

**Test:** Enable behavior learning. Verify that no behavioral data leaves the device (network monitoring). Verify that the user can inspect what the model has learned, correct a specific learned pattern, and delete all learned data. Verify the system operates identically before and after deletion.

---

## 12. Energy Intelligence

**Failure modes addressed:** DOE study finding mixed-protocol systems waste 14% of potential savings due to communication delays. Cloud-dependent energy optimization failing during grid emergencies when optimization matters most. Consumer energy management locked to vendor-specific hardware (SolarEdge, EcoFlow, Enphase) with no unified local-first platform.

**Strategic context:** Energy intelligence (ranked #1 in strategic analysis, weighted score 8.1/10) represents the single largest revenue opportunity. The HEMS market reached $3.8–5.8B in 2024/25 and is growing at 13.8–20.6% CAGR toward $8–21B by 2030–34. A 1,200-home LADWP pilot demonstrated 42% average monthly bill reduction. Willingness to participate in time-of-use programs jumps from 7% to 44% with automation technology. No open-source, local-first platform implements OpenADR 3.0 for residential users. Energy optimization at $3.99–7.99/month against documented savings of $50–200+/month creates a self-funding subscription model with 2–8× ROI.

### INV-EI-01: Energy as First-Class Domain

Energy production, consumption, storage, and grid interaction must be first-class concepts in the HomeSynapse data model — not afterthoughts bolted onto a lighting control system. The event model must accommodate energy-specific event types (meter readings, tariff changes, grid signals, battery state-of-charge transitions, solar production updates). The device model must represent energy entities (meters, inverters, batteries, EV chargers, controllable loads) with the same fidelity as lighting or climate entities. Energy state must be queryable, historicizable, and automatable through the same mechanisms as any other device domain.

**MVP scope:** The MVP device model and event taxonomy must include energy entity types and energy event categories. Energy-specific integrations (solar inverters, smart meters, EV chargers) are post-MVP, but the core model must accommodate them without schema changes.

**Test:** Define an energy meter entity, a battery entity, and a solar inverter entity using the standard device model. Produce energy events (consumption readings, state-of-charge changes, production updates). Verify that the event bus, state store, automation engine, and API all handle energy entities identically to any other entity type.

### INV-EI-02: Grid-Interactive by Design

The architecture must accommodate bidirectional grid interaction: receiving signals from utility programs (demand response, time-of-use pricing, grid emergencies) and responding with automated load management (shifting, curtailing, or dispatching stored energy). The system must support the OpenADR 3.0 Virtual End Node role and equivalent standards as they emerge. Grid interaction operates locally — the automation engine evaluates grid signals and executes responses without requiring cloud coordination.

**Rationale:** OpenADR 3.0 launched with first certified products in 2025 using a modern REST-based architecture that a Raspberry Pi can implement as a Virtual End Node. FERC data shows 33,272 MW of US wholesale demand response capacity. Retail DR enrollment grew by 732,000 customers (6.7%) in a single year. V2G is accelerating: Ford F-150 Lightning, Nissan Leaf, and Kia EV9 support V2G today, with GM, Tesla, BMW, and Mercedes announcing bidirectional capability for 2025–2026.

**MVP scope:** The event taxonomy must include grid signal event types. The automation engine must support time-based triggers and external signal evaluation. The OpenADR client and V2G orchestration are post-MVP features, but the automation and event infrastructure must support them.

**Test:** Simulate a demand response signal (tariff change event). Verify that an automation can trigger on the signal and execute load management actions (e.g., reduce thermostat setpoint, pause EV charging) through the standard automation framework.

### INV-EI-03: Carbon-Aware Scheduling Architecture

The automation engine must support scheduling decisions based on carbon intensity data alongside cost data. When the user enables carbon-aware operation, the system must be able to shift deferrable loads (EV charging, water heating, laundry cycles) to periods of lower carbon intensity within user-defined constraints (e.g., "car must be charged by 7 AM" or "water heater must reach target by 6 PM").

**Rationale:** Carbon-aware scheduling is an almost uncontested differentiator. WattTime and Electricity Maps offer free API tiers covering 200+ regions with 5-minute granularity. California users saved $414/year through carbon-intensity-based load shifting. The Green Software Foundation's Carbon Aware SDK provides a ready-made integration layer. Almost no consumer-facing product combines cost and carbon optimization.

**MVP scope:** The automation engine must support time-window constraints and external data sources (price signals, carbon intensity) as automation inputs. The specific carbon API integration is post-MVP.

**Test:** Define an automation with a time-window constraint ("charge EV to 80% by 7 AM using lowest-carbon-intensity hours"). Provide mock carbon intensity data. Verify the automation schedules charging during the lowest-intensity periods within the constraint window.

### INV-EI-04: Energy Data Sovereignty

Energy consumption, production, and grid interaction data are among the most sensitive data categories in a smart home — they reveal occupancy patterns, daily routines, and economic behavior. All energy data is governed by the same privacy invariants as any other data (§6), with the additional constraint that energy data must never be shared with utility programs, demand response aggregators, or grid operators without explicit per-program consent (INV-PD-05). The user must be able to participate in grid programs while controlling exactly what data each program receives.

**Test:** Enroll in a simulated demand response program. Verify that only the data fields explicitly consented to are transmitted. Verify that energy consumption history, behavioral patterns, and device inventories are not transmitted unless separately consented.

### INV-EI-05: Hardware-Agnostic Energy Metering

The energy subsystem must not be locked to any specific hardware vendor's metering, inverter, or battery system. Energy data must be ingested through the standard integration model (INV-CE-04, INV-CE-05) from any compatible device. A user who switches from SolarEdge to Enphase, or from a Tesla Powerwall to a Sonnen battery, must not lose energy history or reconfigure automations — only the integration binding changes.

**Test:** Configure energy automations using a simulated SolarEdge inverter integration. Replace the integration with a simulated Enphase integration exposing the same entity types. Verify that all automations continue functioning and that historical energy data remains queryable.

---

## 13. Multi-User Identity and Presence

**Failure modes addressed:** Nielsen Norman Group (November 2025) confirming smart home design remains centered on a primary-user model. ACM CHI 2019 documenting how smart homes exacerbate household power imbalances. IDC 2023 data showing satisfaction declining for 5+ year users. Apple HomeKit, Google Home, Amazon Alexa, Home Assistant, and SmartThings all lacking per-device context-aware RBAC, preference arbitration between household members, and continuous spatial identity awareness.

**Strategic context:** Multi-user identity (ranked #3 in strategic analysis, weighted score 8.2/10) represents the widest competitive gap in the entire smart home industry. No major platform offers identity-aware room-level presence with preference arbitration. Three user types emerge in practice — Device Managers, Everyday Users, and Restricted Users — yet platforms serve only the first. Preference arbitration algorithms (ACRA/MeCRA/HyCRA) demonstrate 40–60% thermal discomfort reduction with 7.8–12.8% energy savings. This is the capability that makes people say "I've never seen anything else do this."

### INV-MU-01: Identity-Aware Device Model

The device model, automation engine, and permission system must support per-user context. A device's behavior, visibility, and controllability may vary by which household member is present, what role they hold, and what preferences they have expressed. The entity identifier scheme (INV-CS-02) must accommodate user-scoped state (e.g., "Alice's preferred temperature for the living room") without breaking the shared state model.

**Identity in the event envelope:** The event envelope schema must include an optional user identity field with the following well-defined semantics:

- **Present and populated:** The event originated from or is causally attributable to a specific user action. Examples: a user pressed a button on the dashboard, a user activated a physical control that the system can associate with an identity (via presence), a user issued a voice command. The identity field carries the user identifier.
- **Present and set to a causal reference:** The event was produced by an automation or system process that was triggered by a user-originated event. The identity field carries the originating user's identifier, establishing the causal chain. This enables "who caused this?" queries to trace through automation chains back to the initiating user.
- **Null (absent):** The event has no meaningful user identity. Examples: a temperature sensor reporting a reading, a Zigbee LQI update, a battery level change, a system health check, a retention policy execution. Most events in a typical system will have null identity — the system must not require producers to fabricate a meaningless identity value.

Integration authors must not be required to populate the identity field. Integrations that have no concept of user identity (most device protocol adapters) produce events with null identity. The identity field is populated by subsystems that have identity context: the dashboard (which knows who is logged in), the presence system (which knows who is in the room), and the automation engine (which propagates causal identity from triggering events).

**MVP scope:** The MVP event envelope must include the optional identity field with the semantics defined above. The automation engine must support user-identity conditions ("if Alice is home" or "if only children are present") and must propagate causal identity through automation chains. Full preference profiles and arbitration are post-MVP.

**Test:** Create two user profiles with different temperature preferences. Trigger an automation conditioned on user presence. Verify the automation applies the correct user's preference. Verify that the event log records which user's presence triggered the action. Separately, verify that a temperature sensor event has null identity and that the system processes it identically to an event with identity populated.

### INV-MU-02: Spatial Presence as Core Primitive

Room-level and zone-level presence must be a core data type in the event and state model, not an afterthought layered on top of device events. The system must support a layered presence model that accommodates multiple technologies with different accuracy/cost tradeoffs: BLE-based (room-level, ~$5–10 per node), UWB-based (±10cm, ~$15 per module), mmWave radar (stationary presence detection), and device interaction inference. Presence state is first-class: "Alice is in the living room" is a system-level fact with the same status as "the living room light is on."

**Rationale:** UWB presence detection provides ±10cm accuracy at under $15 per module. The Qorvo DWM3001CDK development kit supports Raspberry Pi interface via GPIO. BLE presence (ESPresense) provides room-level accuracy at $5–10 per node. Neither Apple, Google, Amazon, nor Home Assistant treats spatial presence as a core architectural primitive — it is always a derived or integration-specific concept.

**MVP scope:** The MVP event taxonomy and state model must include presence event types and presence state representations. Presence hardware integrations are post-MVP, but the data model must be in place.

**Test:** Produce presence events from a simulated BLE integration ("Alice entered living room") and a simulated UWB integration ("Alice at coordinates x,y in living room"). Verify that the state store maintains a coherent presence model. Verify that automations can trigger on both room-level and zone-level presence. Verify that the event log supports "where was Alice at time T?" queries.

### INV-MU-03: Preference Arbitration Framework

When multiple household members are present in the same space with conflicting preferences (temperature, lighting level, media volume), the system must resolve conflicts through an explicit, configurable arbitration framework — not through silent last-write-wins or primary-user-always-wins. The arbitration model must support: priority-based resolution (ACRA: automatic, based on declared priorities), mediated resolution (MeCRA: notify affected users and request input), and hybrid resolution (HyCRA: automatic for routine conflicts, mediated for significant ones). The arbitration rules must be transparent and inspectable — every household member must be able to understand why the system chose a particular setting.

**MVP scope:** The automation engine must support multi-condition evaluation that includes user identity. The full arbitration framework (ACRA/MeCRA/HyCRA modes) is post-MVP, but the automation model must not prevent its implementation.

**Test:** Simulate two users present in the same room with conflicting temperature preferences. Verify that the system applies the configured arbitration rule. Verify that both users can see why the chosen temperature was selected. Verify that the event log records the arbitration decision and its inputs.

### INV-MU-04: Household Role Model

The permission and access control system must support a role-based model that reflects real household dynamics, not just "admin" and "user." The minimum role set must accommodate: a household administrator (full control, configuration access), adult household members (full device control, limited configuration), children or restricted members (constrained device control, no configuration access), and guests (temporary, scoped access that expires automatically). Roles must be assignable per-user and enforceable across all interfaces (dashboard, API, voice, physical controls where the protocol supports it).

**MVP scope:** The MVP must implement at least admin and member roles with distinct permission scopes. The full role taxonomy is post-MVP but the permission infrastructure must be designed for it.

**Test:** Create a restricted-role user. Verify that they can control devices within their permitted scope and cannot access devices, configuration, or system functions outside that scope. Verify that role enforcement is consistent across the dashboard, REST API, and WebSocket API.

### INV-MU-05: Graceful Identity Degradation

When the identity or presence system is degraded (presence sensors offline, identity uncertain, new unrecognized person), the system must degrade to safe, predictable defaults — not to an error state or to no-control. The degradation hierarchy is: if identity is uncertain, apply the most permissive common preference; if presence is unknown, maintain the last known state; if the identity system is entirely offline, fall back to non-identity-aware operation (the system behaves as if all registered users are present). A failure of the identity system must never lock anyone out of their home or prevent physical device control (INV-HO-01).

**Test:** Disable the presence integration while a user-preference-driven automation is active. Verify that the system falls back to the defined default behavior without errors. Verify that all physical controls remain functional. Verify that the dashboard clearly indicates that presence detection is unavailable.

---

## 14. Mesh and Network Intelligence

**Failure modes addressed:** Zero consumer-facing tools for Zigbee/Thread/802.15.4 indoor signal propagation. All existing heatmap tools (NetSpot, Ekahau, TamoGraph) are Wi-Fi only. Home Assistant offers fragmented, beta-quality mesh visualization. SmartThings, Homey, Apple Home, and Google Home provide zero mesh diagnostics. Unstable mesh networks causing increased radio traffic and shortened battery-powered device lifespan.

**Strategic context:** Mesh diagnostics (ranked #6 in strategic analysis, weighted score 7.6/10) represent HomeSynapse's strongest first-mover advantage. Thread 1.4 mandates border routers support 150+ devices and introduces Enhanced Network Diagnostics. OpenThread's topology discovery API provides frame/message error rates, neighbor tables, and child tables. Network health directly translates to user-visible outcomes: better battery life and fewer "device unreachable" errors. The engineering challenge is building a unified cross-protocol visualization and predictive degradation analysis.

### INV-MN-01: Protocol-Agnostic Network Telemetry

The system must collect and expose network health telemetry from every active wireless protocol (Zigbee, Thread, Wi-Fi, Z-Wave, Bluetooth, future protocols) through a unified telemetry model. Protocol-specific metrics (RSSI, LQI, packet error rates, route changes, neighbor tables) must be normalized into a common schema that supports cross-protocol health comparison and aggregation. Network telemetry is ingested through the standard event pipeline and stored as events subject to the same retention, query, and observability rules as any other event category.

**MVP scope:** The MVP Zigbee adapter must emit network telemetry events (RSSI, LQI, route information) through the standard event pipeline. The unified telemetry model must be defined to accommodate additional protocols.

**Test:** Pair Zigbee devices. Verify that the system produces network telemetry events containing signal quality metrics. Verify these events are queryable through the standard event API. Verify that the schema can represent equivalent metrics from a simulated Thread network without schema changes.

### INV-MN-02: Mesh Health as Observable State

The current health state of each wireless mesh network must be a first-class observable entity in the state model, with the same status as any device entity. Mesh health must be surfaced in the dashboard without requiring CLI tools, protocol-specific debugging interfaces, or third-party utilities. The health representation must include: per-device signal quality, per-link reliability, route topology (where the protocol exposes it), and aggregate network health scores.

**Rationale:** Network health monitoring directly translates to user-visible outcomes. Unstable Thread networks cause increased radio traffic, directly shortening battery-powered device lifespan (documented: Aqara FP300 achieving 3 years on Zigbee vs. 2 years on Thread due to network instability overhead). Exposing mesh health makes "why did my battery die so fast?" an answerable question.

**Test:** Degrade a Zigbee device's signal quality (increase distance or add interference). Verify that the mesh health state updates to reflect the degradation. Verify that the dashboard displays the degraded link without requiring any technical intervention.

### INV-MN-03: Predictive Network Diagnostics

The system must support detecting degradation trends in network telemetry before they become failures. At minimum, the system must identify: devices with declining signal quality (trending toward unreachable), links with increasing error rates (trending toward route changes), and battery-powered devices whose network behavior suggests accelerated battery drain. Diagnostic findings must be surfaceable as user-visible alerts through the standard notification framework.

**MVP scope:** The MVP must store network telemetry events with sufficient granularity for trend analysis. Predictive algorithms are post-MVP, but the data foundation must be in place.

**Test:** Simulate a device with gradually declining RSSI over 30 days. Verify that the stored telemetry is queryable with sufficient resolution to detect the trend. Verify that a post-MVP diagnostic algorithm could identify the decline using only data available through the standard event API.

### INV-MN-04: Battery-Aware Network Optimization

The system must track battery-powered device energy consumption as a function of network behavior and make this relationship visible to the user. When the system detects that a battery-powered device is experiencing elevated network overhead (retransmissions, frequent route changes, high polling rates), it must surface this as a diagnostic finding. The architecture must accommodate future optimization actions (adjusting polling intervals, suggesting router placement, recommending channel changes) without requiring changes to the core telemetry model.

**Rationale:** Battery life is a tangible, user-facing outcome that links abstract network health metrics to something every household member understands. "Your motion sensor battery is draining faster than expected because of weak signal — moving the nearest router closer would help" is a product experience no competitor offers.

**Test:** Simulate a battery-powered device with normal network overhead and a second device with elevated retransmission rates. Verify that the system captures the differential in network telemetry. Verify that the data supports distinguishing between the two devices' network efficiency through the standard API.

---

## 15. Governance and Amendment

### INV-GA-01: Invariant Stability

These invariants are designed to be permanent. Amending an invariant requires: a written proposal that identifies the invariant being changed and the specific reason existing constraints are wrong (not merely inconvenient); a documented analysis of impact on all subsystem designs that reference the affected invariant; approval by the architecture owner (nick@nexsys.io); and a migration plan for any existing code, data, or deployments affected by the change. Convenience, schedule pressure, and competitive feature parity are not sufficient reasons to amend an invariant.

### INV-GA-02: Invariant Identifiers Are Permanent

Once an invariant identifier (INV-XX-NN) is assigned, it is never reused. If an invariant is retired, its identifier is marked as retired with a reference to the amendment that retired it. This ensures that references to invariants in design documents, commit messages, and external documentation remain unambiguous.

### INV-GA-03: Compliance Is Verified in Review

Subsystem design documents must identify which invariants they participate in and must demonstrate compliance as part of their Contracts and Invariants section. Architecture review includes invariant compliance verification. A subsystem design that violates an invariant cannot be locked.

---

## 16. Long-Term Ecosystem Direction

The following are directional commitments that guide architectural decisions without being invariants in the formal sense. They represent properties that HomeSynapse intends to achieve as the ecosystem matures. Unlike invariants, these may be revised as the market and technology landscape evolves. Each directional commitment references the invariants that provide its architectural foundation and the strategic research that supports its viability.

### 16.1 Energy as Self-Funding Value Proposition

HomeSynapse intends to lead with energy intelligence as its primary revenue-generating capability. The target markets are California (NEM 3.0 creates ~10× differential between exported solar and peak imports), Texas (ERCOT growing 13.5%), and New York (NYISO growing 12.4%). The energy optimization subscription ($3.99–7.99/month) is designed to be self-funding: documented savings of $131–500+ per year against ~$65–95/year subscription cost create a 2–8× ROI that makes customer acquisition straightforward. The architecture supports this through INV-EI-01 (first-class energy domain), INV-EI-02 (grid-interactive design), and INV-EI-03 (carbon-aware scheduling).

**Phased capability delivery:**
- Phase 1: Solar + battery optimization, TOU automation, energy entity model
- Phase 2: OpenADR 3.0 VEN client enabling utility DR monetization ($200–625/year user earnings)
- Phase 3: V2G orchestration as vehicle/charger standards stabilize ($1,000–2,500/year arbitrage potential)

### 16.2 Multi-User Identity as Killer Feature

HomeSynapse intends to be the first smart home platform to treat multi-user identity and preference arbitration as a core product capability. This is the widest competitive gap in the industry — no major platform (Apple, Google, Amazon, Samsung, Home Assistant) offers identity-aware room-level presence with preference arbitration. The architecture supports this through INV-MU-01 through INV-MU-05.

**Phased capability delivery:**
- Phase 1: User identity in event model, basic role-based access control
- Phase 2: BLE-based room-level presence, per-user automation preferences
- Phase 3: UWB precision presence (±10cm), full ACRA/MeCRA/HyCRA preference arbitration
- Phase 4: mmWave stationary presence detection, behavioral preference learning

### 16.3 Unified RF Health Dashboard

HomeSynapse intends to provide a unified mesh network diagnostic interface that spans all active wireless protocols. This is a first-mover opportunity: zero consumer tools exist for Zigbee/Thread/802.15.4 indoor signal propagation modeling. The architecture supports this through INV-MN-01 through INV-MN-04 and the observability framework in §7.

**Phased capability delivery:**
- Phase 1: Zigbee telemetry in event pipeline, per-device signal quality in dashboard
- Phase 2: Thread diagnostic integration (OpenThread topology API), cross-protocol health view
- Phase 3: Floor-plan-based RF heatmapping (zero competition in 802.15.4 space)
- Phase 4: Predictive degradation alerts, automated channel optimization recommendations

### 16.4 On-Device Intelligence Pipeline

HomeSynapse intends to deliver Nest-class behavioral intelligence without cloud dependency. The Pi 5 hardware is demonstrated capable: LightGBM classifiers at 0.4–1.2ms, TinyLSTM at 3–7ms, total inference pipeline under 20ms at under 3W. A Cambridge case study maintained ±0.4°C comfort during a 14-hour ISP outage — impossible with cloud-dependent systems. The architecture supports this through INV-AI-01 through INV-AI-05 and the performance targets in INV-PR-02.

**Phased capability delivery:**
- Phase 1: Behavioral data pipeline (sensor event collection, windowing, feature extraction)
- Phase 2: Occupancy-driven HVAC optimization (LightGBM, highest ROI and most proven approach)
- Phase 3: Adaptive scheduling, anomaly detection, automation suggestions
- Phase 4: Local voice pipeline (Vosk STT + openWakeWord + Piper TTS + ONNX intent classifiers)

### 16.5 Privacy-Preserving Cloud Layer and Verifiable Transparency

When HomeSynapse offers optional cloud features (remote access, backup, cross-instance sync), these must be built on zero-knowledge architecture following the Bitwarden/NordLocker model: the cloud stores encrypted blobs that NexSys cannot decrypt. Cloud backup uses crypto-shredding (INV-PD-07) for data lifecycle management.

**Verifiable transparency extension:** The tamper-evident integrity chain established by INV-PD-08 (firmware, configuration, integration provenance) is designed to be extensible to broader transparency capabilities. When the engineering maturity and performance characteristics are proven, HomeSynapse intends to extend the integrity chain to cover:

- **Automation execution transparency:** Every automation execution (trigger, conditions evaluated, actions dispatched, outcome) recorded in the tamper-evident log so that users can cryptographically verify "what automations ran, when, and why." This converts the explainability promise of INV-ES-06 into a cryptographically verifiable property.
- **Data access auditing:** Every access to sensitive data categories (behavioral data, energy data, presence data — the same categories governed by INV-PD-07) recorded in the tamper-evident log. Users can verify that no unauthorized access occurred, including access by the system itself.
- **Cloud operation verification:** When cloud features are enabled, the transparency log extends to cloud operations — users can cryptographically verify that their data has not been accessed or modified by NexSys beyond the explicitly authorized scope.

This represents a genuine first-mover opportunity: no consumer smart home product offers verifiable transparency logs. Transparency logs using Merkle trees (the same technology underlying Certificate Transparency) are well-understood in enterprise security but have not been applied to consumer IoT. The combination of local tamper-evident integrity (INV-PD-08) and cloud zero-knowledge architecture creates a privacy posture that is not merely claimed but cryptographically demonstrable.

**Phased delivery:**
- Phase 1 (MVP): Tamper-evident integrity for firmware, updates, configuration, integration provenance (INV-PD-08)
- Phase 2: Automation execution logging in the integrity chain
- Phase 3: Data access auditing for sensitive categories
- Phase 4: Cloud operation verification, user-facing integrity dashboard

### 16.6 Multi-Protocol Convergence

HomeSynapse is designed to unify the fragmented protocol landscape. Matter adoption has reached 10,400+ certified products by end of 2024 but will coexist with Zigbee, Z-Wave, Thread, and Wi-Fi for years. The MVP ships with Zigbee support. The architecture accommodates all protocols through INV-CE-04 (protocol-agnostic device model) and INV-CE-05 (extension model). Each protocol adapter is an integration, not a core subsystem.

**Protocol priority (by market demand and HomeSynapse strategic value):**
- MVP: Zigbee 3.0 (largest installed base, most mature tooling)
- Post-MVP near-term: Matter/Thread (accelerating adoption, 2,473 new certifications in 2024), Z-Wave (700/800 series)
- Post-MVP medium-term: Wi-Fi device integration, Bluetooth/BLE
- Long-term: Future protocols through the stable extension model

### 16.7 Multi-Instance Operation

Future versions may support multiple HomeSynapse instances coordinating across a household or across locations. The event model (per-entity sequences, ULIDs), the state model (checkpoint-based recovery), the convergent sync architecture (INV-LF-05), and the configuration model (canonical YAML) are designed to be compatible with multi-instance operation without requiring fundamental redesign. The Small Peer / Big Peer pattern (Pi as local authority, optional cloud coordinator) maps directly to this deployment model. The MVP is single-instance, but the architecture does not prevent multi-instance extension.

### 16.8 Long-Term Support Channel

HomeSynapse intends to offer an LTS release channel that prioritizes stability over features, with security fixes delivered without feature churn (INV-SE-06). The release infrastructure must support parallel version tracks. The MVP may ship only the standard release channel, but the versioning and update mechanisms must accommodate LTS from the start.

### 16.9 Community Ecosystem

HomeSynapse intends to foster a community ecosystem of integrations, plugins, and shared automations. The extension model (INV-CE-05), the stable API contracts (INV-CS-04), and the quality tier system in the documentation catalog (DAS v1 Specification §6.4) provide the foundation. The "Works With HomeSynapse" device certification program ($1K–10K per device) creates a revenue stream while ensuring quality standards. Community contributions must be sustainable without core team bottlenecks.

### 16.10 Ambient Interfaces

When ambient interface technology matures, HomeSynapse intends to support privacy-preserving interaction modalities beyond screens and voice. The near-term opportunity is privacy-preserving sound event detection (smoke alarms, glass breakage, appliance monitoring — all achievable on Pi with >90% F1 scores) and ambient light feedback systems. The medium-term opportunity is PrivacyMic-style ultrasonic sensing (>20 kHz, >95% activity accuracy without capturing intelligible speech). Spatial computing and advanced gesture control are deferred to 2028+. All ambient sensing is governed by INV-AI-02 (explicit consent) and INV-PD-01 (zero telemetry by default).

### 16.11 Formal Verification of Automation Rules

HomeSynapse intends to use formal verification to validate automation rules before deployment. TLA+ and its model checker TLC are Java-based and could be embedded directly. Researchers have verified smart building systems exploring 1.79 million states in 171 seconds, discovering design flaws undetectable by conventional testing. For HomeSynapse, this means automation rules could be verified for safety ("garage door never opens when security is armed"), liveness ("smoke detection always triggers alarm"), and conflict freedom before deployment. This would be exposed through a simplified DSL rather than raw TLA+, creating a defensible moat that competitors cannot easily replicate.

---

## 17. Invariant Index

Complete index of all invariants for reference from subsystem design documents.

| Identifier | Title | Section |
|---|---|---|
| **INV-LF-01** | Core Functionality Without Internet | §1 |
| **INV-LF-02** | Cloud Enhancement, Never Cloud Dependence | §1 |
| **INV-LF-03** | Graceful WAN Degradation | §1 |
| **INV-LF-04** | No Required Cloud Account | §1 |
| **INV-LF-05** | Convergent Sync Architecture | §1 |
| **INV-ES-01** | Events Are Immutable Facts | §2 |
| **INV-ES-02** | State Is Always Derivable from Events | §2 |
| **INV-ES-03** | Per-Entity Ordering with Causal Consistency | §2 |
| **INV-ES-04** | Write-Ahead Persistence | §2 |
| **INV-ES-05** | At-Least-Once Delivery with Subscriber Idempotency | §2 |
| **INV-ES-06** | Every State Change Is Explainable | §2 |
| **INV-ES-07** | Event Schema Evolution | §2 |
| **INV-ES-08** | Event Time and Ingest Time Are Distinct | §2 |
| **INV-RF-01** | Integration Isolation | §3 |
| **INV-RF-02** | Resource Quotas for Integrations | §3 |
| **INV-RF-03** | Startup Independence | §3 |
| **INV-RF-04** | Crash Safety and Automatic Recovery | §3 |
| **INV-RF-05** | Bounded Storage Growth | §3 |
| **INV-RF-06** | Graceful Degradation Under Partial Failure | §3 |
| **INV-CS-01** | Semantic Versioning Is Enforced | §4 |
| **INV-CS-02** | Entity Identifiers Are Stable | §4 |
| **INV-CS-03** | Configuration Schema Stability | §4 |
| **INV-CS-04** | Integration API Stability | §4 |
| **INV-CS-05** | Update Safety Mechanisms | §4 |
| **INV-CS-06** | Deprecation Discipline | §4 |
| **INV-CS-07** | No Forced Hardware Obsolescence | §4 |
| **INV-HO-01** | Physical Control Supremacy | §5 |
| **INV-HO-02** | Operable Under Degradation | §5 |
| **INV-HO-03** | No Debugging for Daily Operation | §5 |
| **INV-HO-04** | Self-Explaining Errors | §5 |
| **INV-HO-05** | The Partner Test | §5 |
| **INV-PD-01** | Zero Telemetry by Default | §6 |
| **INV-PD-02** | Data Residency Is User-Controlled | §6 |
| **INV-PD-03** | Encrypted Storage | §6 |
| **INV-PD-04** | Transparent Data Boundaries | §6 |
| **INV-PD-05** | Consent Is Granular, Informed, and Revocable | §6 |
| **INV-PD-06** | Offline Integrity | §6 |
| **INV-PD-07** | Crypto-Shredding for Sensitive Data Lifecycle | §6 |
| **INV-PD-08** | Tamper-Evident System Integrity | §6 |
| **INV-TO-01** | System Behavior Is Observable | §7 |
| **INV-TO-02** | Automation Determinism | §7 |
| **INV-TO-03** | No Hidden State | §7 |
| **INV-TO-04** | Structured, Queryable Logs | §7 |
| **INV-CE-01** | Canonical, Human-Readable Configuration | §8 |
| **INV-CE-02** | Zero-Configuration First Run | §8 |
| **INV-CE-03** | Configuration Schema Is Documented and Versioned | §8 |
| **INV-CE-04** | Protocol Agnosticism in the Device Model | §8 |
| **INV-CE-05** | Extension Model with Stability Guarantees | §8 |
| **INV-CE-06** | Migration Tooling Accompanies Schema Evolution | §8 |
| **INV-PR-01** | Constrained Hardware Is the Primary Design Target | §9 |
| **INV-PR-02** | Quantitative Performance Targets | §9 |
| **INV-PR-03** | Resource Usage Is Bounded and Predictable | §9 |
| **INV-PR-04** | Architecture Must Accommodate 1,000 Devices | §9 |
| **INV-SE-01** | No Default Credentials | §10 |
| **INV-SE-02** | Authentication Required for All External Interfaces | §10 |
| **INV-SE-03** | Secrets Encrypted at Rest | §10 |
| **INV-SE-04** | Least Privilege for Integrations | §10 |
| **INV-SE-05** | Remote Access Is End-to-End Encrypted | §10 |
| **INV-SE-06** | Security Updates Without Feature Churn | §10 |
| **INV-AI-01** | AI Is Enhancement, Never Foundation | §11 |
| **INV-AI-02** | AI Requires Explicit Consent | §11 |
| **INV-AI-03** | AI Decisions Are Explainable | §11 |
| **INV-AI-04** | Local AI Capability | §11 |
| **INV-AI-05** | On-Device Behavior Modeling | §11 |
| **INV-EI-01** | Energy as First-Class Domain | §12 |
| **INV-EI-02** | Grid-Interactive by Design | §12 |
| **INV-EI-03** | Carbon-Aware Scheduling Architecture | §12 |
| **INV-EI-04** | Energy Data Sovereignty | §12 |
| **INV-EI-05** | Hardware-Agnostic Energy Metering | §12 |
| **INV-MU-01** | Identity-Aware Device Model | §13 |
| **INV-MU-02** | Spatial Presence as Core Primitive | §13 |
| **INV-MU-03** | Preference Arbitration Framework | §13 |
| **INV-MU-04** | Household Role Model | §13 |
| **INV-MU-05** | Graceful Identity Degradation | §13 |
| **INV-MN-01** | Protocol-Agnostic Network Telemetry | §14 |
| **INV-MN-02** | Mesh Health as Observable State | §14 |
| **INV-MN-03** | Predictive Network Diagnostics | §14 |
| **INV-MN-04** | Battery-Aware Network Optimization | §14 |
| **INV-GA-01** | Invariant Stability | §15 |
| **INV-GA-02** | Invariant Identifiers Are Permanent | §15 |
| **INV-GA-03** | Compliance Is Verified in Review | §15 |
| **INV-BUS-01** | Exactly-Once Delivery Per Subscriber | §19 |
| **INV-BUS-02** | Publish Is Non-Blocking on Backpressure | §19 |
| **INV-BUS-03** | Subscriber Isolation | §19 |
| **INV-PROJ-01** | Projection Determinism | §19 |
| **INV-PROJ-04** | Checkpoint-Position Monotonicity | §19 |
| **INV-PROJ-NEW-01** | Self-Produced Event Isolation | §19 |
| **INV-WRITER-01** | Single-Writer Discipline | §19 |
| **INV-SUB-ISO-01** | One Virtual Thread Per Subscriber | §19 |
| **INV-SUB-ISO-02** | One Dedicated SQLite Read Connection Per Subscriber | §19 |
| **INV-SUB-ISO-03** | One DLQ Instance Per Subscriber | §19 |
| **INV-SUB-ISO-04** | One Mode AtomicReference Per Subscriber | §19 |
| **INV-SUB-ISO-05** | One ReplayWindowQueue Per Subscriber | §19 |
| **INV-SUB-ISO-06** | One SelfProducedFilter Per Derivation-Producing Subscriber | §19 |
| **AMD-47-INV-01** | Sealing Remains Total (`AttributeValue` 8 variants) | §20 |
| **AMD-47-INV-02** | Upcaster-Before-Derivation Ordering (both paths) | §20 |
| **AMD-47-INV-03** | QuantityValue Normalization Determinism | §20 |
| **AMD-47-INV-04** | DegradedAttributeValue Non-Declarable and Lossless | §20 |
| **AMD-47-INV-05** | ArrayValue Full-Replacement | §20 |
| **AMD-51-INV-01** | Typed Total Comparison (exhaustive, no `default`) | §21 |
| **AMD-51-INV-02** | Float/Quantity Epsilon Totality (pinned total form) | §21 |
| **AMD-51-INV-03** | Degraded Change-Detection Semantics | §21 |
| **AMD-51-INV-04** | Comparator Placement + Gateway (state-store) | §21 |
| **AMD-51-INV-05** | Symmetric Reconstruction; 2→3 Rides AMD-50 Unchanged | §21 |
| **AMD-52-INV-01** | Typed Payload + Per-Event `schema_version` Discriminator; No Row Migration | §22 |
| **AMD-52-INV-02** | Custom Non-Reflective Jackson-Isolated Codec, Total Over 8 Variants | §22 |
| **AMD-52-INV-03** | Bit-Anchored Float Identity; Round-Trippable Text; `chain_hash` Inert | §22 |
| **AMD-52-INV-04** | JSON-Valid Non-Finite Sentinels; No Non-Standard Tokens | §22 |
| **AMD-52-INV-05** | Path A Authoritative; Path B = Defined `DegradedEvent`; Append-Only | §22 |
| **AMD-52-INV-06** | Typed Checkpoint Envelope (S2) | §22 |
| **AMD-52-INV-07** | `projectionVersion` 3→4 on Frozen AMD-50 Backfill | §22 |
| **AMD-53-INV-01** | Event-Time Activity-Timestamp Determinism (extends AMD-50-INV-03) | §23 |
| **AMD-53-INV-02** | Real-Time Freshness Carve-Out (`staleAfter`/`stale`) | §23 |
| **AMD-54-INV-01** | Two Distinct Compatibility Surfaces (descriptor vs config schema) | §24 |
| **AMD-54-INV-02** | Major Triggers Migration, Minor Never | §24 |
| **AMD-55-INV-01** | All Hooks `default`; Pre-AMD-55 Adapters Unchanged | §25 |
| **AMD-55-INV-02** | Sequential Hook Execution on the Adapter Thread | §25 |
| **AMD-55-INV-03** | `migrate` Before `initialize`; Migrate-Failure → FAILED | §25 |
| **AMD-55-INV-04** | `REJECTED` Apply Never Leaves the Rejected Config Active | §25 |
| **AMD-56-INV-01** | `AUTH_FAILED` Never Routes to Transient Backoff | §26 |
| **AMD-56-INV-02** | `ExceptionClassification` Append-Only, Order Frozen | §26 |
| **AMD-56-INV-03** | `PermanentIntegrationException` Constructors Append-Only; Well-Known Codes Documented | §26 |
| **AMD-57-INV-01** | `detail` Never Null; `NONE` Is the Explicit No-Cause Value | §27 |
| **AMD-57-INV-02** | `HealthDetail` Append-Only; 1:1 Transition-Trigger Mapping | §27 |
| **AMD-58-INV-01** | Three-Way Registration Lockstep, No Partial Registration | §28 |
| **AMD-58-INV-02** | Persisted Event-Type Strings Immutable; Dot-Namespace for New; Legacy Five Frozen | §28 |
| **AMD-58-INV-03** | The Five New Permits Are Observability-Only | §28 |
| **AMD-59-INV-01** | Capability Events Are the Only Post-Adoption Mutation Path; No Capability Table | §29 |
| **AMD-59-INV-02** | `CapabilityAdded` Carries the Complete Instance (Replay Self-Sufficiency) | §29 |
| **AMD-59-INV-03** | No `CapabilityId` Wrapper; Permit Class + String Identity | §29 |
| **AMD-59-INV-04** | `EntityId` Stable Across Capability Add/Remove | §29 |
| **AMD-59-INV-05** | `CapabilityPublisher` Integration-Scoped (LTD-17) | §29 |
| **AMD-59-INV-06** | `CapabilityRemovalReason` Descriptive-Only, Never Behavioral | §29 |
| **AMD-60-INV-01** | Context Grows Only by Service-Family Aggregators (NQ-1 Doctrine) | §30 |
| **AMD-60-INV-02** | `SecurityServices` Nullable, `RequiredService.SECURITY`-Gated; Non-Null Inside | §30 |
| **AMD-60-INV-03** | `rotate` Integration-Scoped, Atomic Across Entries, Durable-Before-Return | §30 |
| **AMD-61-INV-01** | Soft Dependency Never Blocks Startup; Hard Always Does | §31 |
| **AMD-61-INV-02** | `dependsOn ∩ softDependencies = ∅` at Construction | §31 |
| **AMD-62-INV-01** | Retry Schedule Is a Pure Function of `BackoffParameters` + Attempt Count | §32 |
| **AMD-62-INV-02** | Retry Backoff and Recovery Probing Are Distinct Mechanisms | §32 |
| **AMD-63-INV-01** | `RESERVED_SUBPROCESS` Rejected Until Activated by Amendment | §33 |
| **AMD-64-INV-01** | Null ⇒ Global §3.14 Default; Present Value Positive and Fully Replacing | §34 |
| **AMD-86-INV-01** | Encrypt-on-Write Is Irreversible; the Shred Operation Is Deferrable | §35 |
| **AMD-87-INV-01** | Every `Expectation` Permit Round-Trips Losslessly (AMD-52 Float Discipline) | §36 |
| **AMD-66-INV-01** | Listeners Classify; They Never Mutate the `ConfigModel` | §37 |
| **AMD-66-INV-02** | Classification Is Synchronous, Before the Reload Event Publishes | §37 |
| **AMD-67-INV-01** | System-Config and Adapter-Config Schemas Are Distinct Surfaces | §38 |
| **AMD-67-INV-02** | Major Triggers Migration, Minor Never (System-Config Surface) | §38 |
| **AMD-68-INV-01** | `setAll(Map)` Is All-or-Nothing and Durable-Before-Return | §39 |
| **AMD-70-INV-01** | Config Events Are Observability-Only | §40 |
| **AMD-71-INV-01** | The Loader Reads Only Within the Canonicalized Config Tree | §41 |
| **AMD-71-INV-02** | `!include` Is One Level Deep | §41 |
| **AMD-88-INV-01** | Promotions Are Field-Additions Only | §42 |
| **AMD-88-INV-02** | Stable Trigger Identity on User-Facing Surfaces | §42 |
| **AMD-89-INV-01** | PRIMARY-Only Default for Group-Resolving Selectors | §43 |
| **AMD-90-INV-01** | Confirmation Never Blocks Runs and Never Retries | §44 |
| **AMD-90-INV-02** | Iteration Constructs Are Hard-Bounded | §44 |
| **AMD-91-INV-01** | Deterministic Cycle Suppression | §45 |
| **AMD-91-INV-02** | `RunCausalChain` Never Crosses the Event Boundary Unflattened | §45 |
| **AMD-92-INV-01** | No Automation-Resident Types in Event Payloads | §46 |
| **AMD-92-INV-02** | Full Manifest Registration Before First Publish | §46 |
| **AMD-93-INV-01** | Forward-Only, Non-Destructive Definition Migrations | §47 |
| **AMD-93-INV-02** | Fully-Resolvable References at Load Time | §47 |
| **AMD-94-INV-01** | Rotate-on-Restore Prevents Cross-Restore Nonce Reuse (restore ⇒ fresh DEK version) | §48 |
| **AMD-94-INV-02** | Encrypted At-Rest Rows Are Self-Describing (1-byte version discriminator) | §48 |
| **INV-SA-01** | Expressiveness Expands Only Into the Sealed Model (no runtime DSL) | §49 |
| **INV-SA-02** | Federation Non-Preclusion (scope additively reservable; no site-local-sequential identity) | §49 |
| **INV-SA-03** | Explanation Is a Pure Projection of the Log (no parallel trace store) | §49 |
| **INV-SA-04** | Running Automations Degrade Deterministically (deterministic terminal + recorded reason) | §49 |

**Total: 169 invariants across 49 identifier categories (§0.3).** _Regenerated from this table at the 2026-06-20 Doc 16 (Superior Automation Layer) Lock (§49, +4 — INV-SA-01..04; INV-SA-01/02 novel registered first-class, INV-SA-03/04 citing compositions; a new-doc Lock, not an amendment — watermark stays AMD-94); prior regeneration 2026-06-19 AMD-94 ratification (165/48, §48, +2 — AMD-94-INV-01/02); 2026-06-12 (163/47, M7 block §42–§47, +11 — AMD-88..93); earlier 2026-06-09 (152/41, M6 block). Never propagate a stated total — re-derive from this table._

---

## 18. Traceability Matrix

This section maps each invariant category to the competitive failure modes and strategic opportunities it addresses, providing the evidentiary basis for why each category exists.

| Category | Key Failure Modes Addressed | Strategic Opportunities | Evidence Source |
|---|---|---|---|
| §1 Local-First | AWS Oct 2025 outage (15h), cloud latency (1–3s vs 0.2–0.4s local), cloud as single point of failure | Foundational enabler for all other domains (ranked #4, score 7.9/10). CRDT sync enables multi-instance without cloud coordinator | Competitive landscape research: all cloud-dependent platforms. Automerge 3.0, Ditto production deployments, Linear/Figma architecture |
| §2 Event Sourcing | Unanswerable "why did this happen?", opaque state management, data loss on corruption, HA automation state not persisting across restarts, conflated event time vs ingest time causing incorrect time-window evaluations | Deepest competitive moat (ranked #8, score 6.6/10). "Your home never forgets." Formal verification of automation rules via embedded TLA+. Dual-timestamp semantics enable correct energy TOU calculations and presence tracking under variable mesh latency | HA debugging difficulty, no platform offers replay. Axon Framework (70M+ downloads), ScienceDirect reliability study (n=137) |
| §3 Reliability | 10-min boots, 25-sec automation delays, single-process failure propagation, SD card death, Insteon cloud collapse | Perceived reliability is the #1 acceptance determinant. Java 21 virtual threads enable thousands of concurrent connections at ~1KB/thread. Upgradeable isolation boundary protects community ecosystem across hardware tiers | HA on RPi3/RPi4, Recorder component, Google Home reliability issues, Insteon collapse, Netflix virtual threads validation |
| §4 Compatibility | Monthly breaking changes (#1 complaint), HACS breakage, entity renaming cascades, update fatigue | Stable extension model enables community ecosystem and $1K–10K device certification revenue | HA forums, HACS issue tracker |
| §5 Household Operability | Partner acceptance problem, 1 in 4 "not worth the hassle", smart home fatigue, satisfaction declining at 5+ years | Multi-user identity converts abstract principles into concrete daily experience. Identity-aware system serves all three user types | Cross-platform user research, IDC 2023 satisfaction data, Nielsen Norman Group Nov 2025 study |
| §6 Privacy & Data | 28/32 data points (Amazon), $68M/$392M settlements (Google), 53% user nervousness, MCC 0.956 activity inference from metadata | Privacy as strategic weapon not feature checkbox. ZK cloud backup (Bitwarden model). Tamper-evident system integrity with extensible transparency logs. Scoped crypto-shredding reconciles immutable logs with data lifecycle. 16:1 privacy superendowment ratio | Privacy audits, legal proceedings, ACM ToIT ML attack study, Proton/Signal/DuckDuckGo revenue data |
| §7 Transparency | "It worked yesterday" with no diagnostic path, expert-level debugging required | Unified observability across devices, automations, mesh networks. "Why did this happen?" as a product feature | Cross-platform, HA debugging workflow |
| §8 Configuration | YAML-vs-UI war (ADR 0010), opaque JSON storage, Git-incompatible config | Canonical YAML enables community sharing, version control, migration tooling. Protocol-agnostic model unifies 10,400+ Matter products with legacy protocols | HA community split, configuration management failures, Matter certification data |
| §9 Performance | RPi performance degradation, community recommending x86, barrier to entry | Pi 5 supports ML inference at <20ms. Performance targets enable on-device intelligence pipeline | HA performance on constrained hardware, Cambridge HVAC case study, LightGBM/TinyLSTM benchmarks |
| §10 Security | Default credentials, unencrypted local comms, lateral movement risk | Security-first positioning supports premium market. LTS channel enables enterprise/property management | IoT security research, smart home attack surfaces |
| §11 AI | Cloud AI dependency, opaque decisions, privacy erosion through training data | Nest-class intelligence without cloud (ranked #2, score 8.2/10). 8.8–26.3% HVAC savings. Pi 5 runs full ML pipeline at <3W | Google Nest savings data ($131–145/yr), Cambridge ISP outage study, NIST occupancy validation (95% accuracy) |
| §12 Energy | Mixed-protocol 14% savings waste, cloud-dependent optimization failing during grid emergencies, vendor-locked energy hardware | Largest revenue opportunity (ranked #1, score 8.1/10). HEMS market $3.8–5.8B growing 13.8–20.6% CAGR. Self-funding subscription model | LADWP 1,200-home pilot (42% bill reduction), FERC DR capacity data, OpenADR 3.0 certification, V2G studies |
| §13 Multi-User | Primary-user-centric design across all platforms, household power imbalances, satisfaction declining at 5+ years | Widest competitive gap (ranked #3, score 8.2/10). No platform offers identity-aware presence + preference arbitration. Potential killer feature | Nielsen Norman Group Nov 2025, ACM CHI 2019, IDC 2023, UWB/BLE hardware specs, ACRA/MeCRA research |
| §14 Mesh/Network | Zero consumer 802.15.4 diagnostic tools, fragmented beta-quality HA visualization, battery life impact from network instability | Strongest first-mover advantage (ranked #6, score 7.6/10). Floor-plan RF heatmapping has zero competition in 802.15.4 space | Wi-Fi tool gap analysis, OpenThread diagnostic API, Thread 1.4 Enhanced Network Diagnostics, Aqara battery life data |
| §20 Device-Model Attribute-Value Expansion (AMD-47) | Physical quantities losing unit identity at the value layer (the Home Assistant `native_unit_of_measurement` data-corruption class), list-valued attributes degrading to opaque string blobs the validator/comparator cannot reason about element-wise, sealed-hierarchy evolution with no migration seam or defined fallback for un-upcastable stored values, non-deterministic unit normalization, a degraded sentinel silently entering canonical state, and element-delta `ArrayValue` semantics that a bounded-window advancer cannot reconstruct | A value-layer `QuantityValue(value, unit)` carrier makes the (value, unit) moat decision enforceable at the value layer, not just the schema layer (AMD-47-INV-03 hand-rolled deterministic normalization, no JSR 385 — REC-93). The `AttributeValueUpcaster` SPI (strict for core projections, lenient/forensic yielding `DegradedAttributeValue`) gives the sealed hierarchy a `DegradedEvent`-parallel migration seam (AMD-47-INV-04). Upcaster-before-`DerivationRule.evaluate()` on **both** `onEvent` and `processBatch` (AMD-47-INV-02) extends the M4.0a D-1 / AMD-50 gate-every-path discipline to the value layer. `ArrayValue` full-replacement (AMD-47-INV-05) keeps the bounded-window advancer able to reconstruct from a single latest event. Exhaustive 8-variant sealing (AMD-47-INV-01) preserves the Doc 02 §8.2 sealed-exhaustiveness contract | AMD-47 (RATIFIED 2026-05-30); Research 8 PM Assessment REC-24/27/29 + REC-93/REC-78; P2 AMD-allocation decision (device block 46–49); parallels `DegradedEvent` (Doc 01 §3.10) and the AMD-50 both-paths backfill discipline. Implemented by **M4.B3** (contract registered now; production code + §5 contract tests land at M4.B3) |
| §19 Event Distribution, Projection & Subscriber Lifecycle | Read-during-write deadlock between projection reads and derived-event writes, reentrant self-derivation loops where a projection re-derives from its own output, version-upgrade lossage when projection code drifts past its persisted checkpoint, silent re-delivery loops from unsupervised subscriber crashes, cross-subscriber transaction-isolation collapse from shared SQLite read connections, cold-start event loss during REPLAY catch-up, non-deterministic `onCaughtUp` firing across restarts, writer-queue saturation pathology under bursty derived-write storms, missing observability surface preventing operator detection of saturation before user-facing latency spikes, per-subscriber derived-write runaway exhausting the single writer | Two-phase READ/PUBLISH/CHECKPOINT discipline (AMD-41 §3.2.1) eliminates publish-path races constitutionally. Per-subscriber resource isolation catalog INV-SUB-ISO-01..06 (AMD-42 §3.4.4) makes cross-subscriber failure propagation structurally impossible. `SelfProducedFilter` with `stateVersion` defence-in-depth (AMD-41 §3.2.2, INV-PROJ-NEW-01) eliminates reentrant derivation without a bus-level filter mechanism. Five-state subscriber FSM (`COLD`/`REPLAY`/`TRANSITION`/`LIVE`/`SUSPENDED`) with `ReplayWindowQueue`-based catch-up (AMD-42 §3.4.1–§3.4.3) enables zero-loss cold-start. Non-blocking publish (INV-BUS-02, enforced by the M3.3 `EVENT_PUBLISHER_HAS_NO_DEPTH_GATED_LOCK` ArchUnit rule) preserves writer latency under saturation. Seven canonical bus metrics + `QueueSaturationHealthCheck` (AMD-43 §3.6.2–§3.6.3) make backpressure operationally observable. Per-subscriber `DerivedWriteRateLimit` token bucket (AMD-43 §3.6.4) bounds derived-write contribution to writer saturation. Registration of these invariants closes the citation chain for M3.1 `InProcessEventBus` contract tests and grounds AMD-41/42/43's normative invariant references on disk | AMD-41 / AMD-42 / AMD-43 (applied 2026-05-16); DEC-M3-01..DEC-M3-13 (PLAN-M3-CONSOLIDATED-02 §1.2 / §8.2 / §12); D1 WAL Pathology Validation Spike (2026-05-15); AMD-26 / AMD-27 (single-writer / bounded-read predecessors, 2026-03-21); AMD-36 (subscriber DLQ, 2026-05-02); AMD-38 (checkpoint policy revision, 2026-05-15) |
| §21 State-Store Typed Change-Detection Comparator (AMD-51) | String-based change detection conflating typed values (`21.0` vs `21.00`, `0.1+0.2` vs `0.3`) into phantom-change event storms that inflate `stateVersion` and spuriously wake automation triggers; float FP-noise indistinguishable from real change; physical quantities reported in different units (`21.0 °C` vs `294.15 K`) comparing unequal as raw strings; list-valued attributes with no element-wise comparison; an un-reconstructable inbound silently overwriting good canonical state; a non-total comparator letting a future `AttributeValue` permit slip through a `default` arm; a typed-compare rule change silently no-op'ing on historical data across a version transition | An external `AttributeValueComparator` in `com.homesynapse.state` carrying a `ComparisonPolicy` keeps epsilon/deadband policy out of the device-model data layer (AMD-51-INV-04, DEC-M3-16 gateway). An exhaustive no-`default` switch over the 8-variant sealed hierarchy makes a future permit a compile error (AMD-51-INV-01); D-01 is event-type-scoped so this is permitted. A pinned total-form epsilon `|a−b| > max(absEps, relEps·max(|a|,|b|))` with explicit IEEE-754 totality answers "did the number actually change" deterministically (AMD-51-INV-02); `QuantityValue` canonicalize-at-construction (AMD-47-INV-03) makes the comparator do zero unit work — no JSR-385/LTD-10. HA-mirrored Degraded semantics (never-emit-on-inbound, emit-on-recovery) keep degraded values out of canonical state (AMD-51-INV-03, with AMD-47-INV-04). Schema-driven inbound reconstruction (distinct from the `AttributeValueUpcaster` stored-value-migration SPI) feeds the typed compare and rides AMD-50's frozen 2→3 reconciliation-backfill + supersession unchanged (AMD-51-INV-05) | AMD-51 (RATIFIED 2026-05-30); Research 10 PM Assessment (v1 §7 source-corrections + v2 ratification) REC-90/92/93/94/95 + the four ratified strategic calls; design-track map NQ-10-1/5/6; builds on AMD-47 (typed hierarchy + canonicalize-at-construction) and AMD-50 (N→M backfill/supersession, scenario 3.3 = the 2→3 case). Implemented by **M4.0b-3** (contract registered at ratification; comparator + reconstruction + §5 tests land at M4.0b-3) |
| §22 Typed `StateChangedEvent` Payload / Serializer / Replay (AMD-52) | A typed payload re-introducing format fragility if serialized by reflection (`@JsonTypeInfo`, banned) or by a non-deterministic float renderer (`Double.toString` changed at JDK 18→19 / Schubfach — silent break of forensic equality and the reserved `chain_hash`); `NaN`/`±Inf` having no JSON representation and being emitted as non-standard bare tokens that break the forward-compat reader; the typed payload forcing an event-store row migration or a normalized columnar explosion under the 256 MiB heap; replaying a typed regime mutating historical String-payload events in place (the cardinal event-sourcing anti-pattern) or lossily upcasting them; a 9th `AttributeValue` permit silently lossy-encoding through a `default` arm | A custom `JsonSerializer`/`JsonDeserializer` pair in `com.homesynapse.persistence` keyed by an explicit `AttributeType` tag in a compact `{"t":…,"v":…}` envelope, exhaustive no-`default` switch over the 8 variants, no `@JsonTypeInfo`/Jackson annotation on `AttributeValue`/`StateChangedEvent` (AMD-52-INV-02; Rule 7 for the event host + the Jackson-isolation HARD RULE for the device-resident type), no new module edge (`persistence → transitive state → transitive device`) or Jackson artifact. Bit-anchored float identity (`Double.doubleToLongBits` after AMD-51 §2.3 canonicalization; stored text only round-trippable, never byte-frozen; `chain_hash` stays the inert AMD-37 zero-reservation — AMD-52-INV-03) dissolves the Schubfach instability; JSON-valid non-finite sentinels with `ALLOW_NON_NUMERIC_NUMBERS` disabled (AMD-52-INV-04). The typed payload stays in-BLOB on both surfaces with the per-event `schema_version` 1→2 as the string↔typed discriminator — no `events`/`view_checkpoints` row migration (AMD-52-INV-01/-06, G5). Replay: Path A re-derives all state from the immutable `state_reported` log (authoritative, rides AMD-50/AMD-51 unchanged), Path B legacy reads → a defined `DegradedEvent` (raw preserved, version-gated in `EventPayloadCodec.decode`, no upcaster pushed into the codec), no event ever mutated (AMD-52-INV-05). `projectionVersion` 3→4 rides AMD-50's frozen backfill (AMD-52-INV-07) | AMD-52 (RATIFIED 2026-05-31); OQ-05-08 design beat; Research 11 PM Assessment (A−, §7 source-verified) REC-100..105; the four PM-under-delegation fork calls (Nick + external review, 2026-05-31 — F1 bit-anchored identity, F2 `DegradedEvent` legacy contract); builds on AMD-47 (typed hierarchy), AMD-50 (frozen N→M backfill), AMD-51 (transient typed reconstruction + the String-payload staging this amendment cashes out). Implemented by **M4.0b-4b** (committed `72596cb`; codec + typed emit + checkpoint envelope + §5 tests) |
| §23 Timestamp-Model Unifier — Event-Time Activity Timestamps (AMD-53) | `EntityState.lastChanged`/`lastUpdated`/`lastReported` stamped from the projection wall-clock (`clock.instant()`) in LIVE `applyToState` and in entity-adoption seeding while the AMD-50 reconciliation backfill stamps `lastChanged` from event-time — so the same observable fields diverge across every `projectionVersion` bump (a replay-determinism gap AMD-52's live 3→4 path exposed) and contradict the Doc 03 §4.1 contract that already specifies `event_time ?? ingest_time`; a never-changed entity persisting a wall-clock adoption seed in `lastChanged` (a latent determinism hole); the unifier being misread as "no wall-clock anywhere," wrongly de-realtiming `staleAfter`/`stale` | Source `lastChanged`/`lastUpdated`/`lastReported` from the causing envelope's `eventTime ?? ingestTime` (the existing `backfillTimestamp` rule) in every `applyToState` branch and in `initialEntityState` adoption seeding (AMD-53-INV-01) — making the materialized timestamps a pure function of the immutable log (INV-ES-01/-08), extending AMD-50-INV-03 from the `DerivationRule` to the materialization and bringing LIVE into compliance with Doc 03 §4.1. `staleAfter`/`stale` are the sole real-time-clock fields and are explicitly carved out (AMD-53-INV-02). `projectionVersion` 4→5 rides AMD-50's frozen backfill, healing legacy wall-clock timestamps on the upgrade boot | AMD-53 (RATIFIED 2026-05-31); the timestamp-model-unifier design beat + Nick's four ratification-fork calls; every source line Read-verified at HEAD `72596cb`; builds on AMD-50 (frozen N→M backfill + the AMD-50-INV-03 determinism precedent it extends), Doc 01 INV-ES-08 (`event_time`/`ingest_time`). Implemented by **M4.0b-5** (the timestamp-unifier `core/state-store` WU; instruction issued) |
| §24 IntegrationDescriptor Config-Schema Versioning (AMD-54) | One integer conflating two unrelated compatibility surfaces — a config-layout change forcing a descriptor-contract bump and vice versa; HA separates entry `version`/`minor_version` from the manifest contract | Independent evolution of the descriptor parsing contract and per-adapter config schemas; the pair `migrate(...)` consumes (AMD-55) | AMD-54 (RATIFIED 2026-06-05); Research 6 REC-41 (schema half); NQ-2. Implemented by **M4.C** |
| §25 IntegrationAdapter Post-Setup Lifecycle Hooks (AMD-55) | Hookless adapter interfaces forcing full stop/start for config reload, options tuning, reauth, and schema migration (the retroactive-amendment tax every surveyed platform paid — HA, OpenHAB, Kura `@Modified`, OTP `code_change`); a void reauth hook making non-implementation undetectable; failed in-place applies with no outcome vocabulary | Four `default` hooks freeze the surface pre-M4 with zero adapter breakage; outcome enums (`ConfigUpdateOutcome` incl. `REJECTED`, `MigrationOutcome`, `ReauthOutcome`) give the supervisor truthful, exception-free signals with defined recovery semantics | AMD-55 (RATIFIED 2026-06-05); Research 6 REC-41 + §1 Verdict 2; review E1/E2/E3 + arbitration A3. Implemented by **M4.C**; supervisor flows M9 |
| §26 ExceptionClassification `AUTH_FAILED` (AMD-56) | Auth failures conflated with generic permanent failures — backoff retry on a dead token (pointless) or FAILED (wrong: user-fixable); HA's `ConfigEntryAuthFailed` reauth storm history shows the class needs its own route | A fourth classification routing to reauth-or-suspend, never transient retry; the append-only code-bearing `PermanentIntegrationException` surface makes the trigger implementable without a new type | AMD-56 (RATIFIED 2026-06-05); Research 6 REC-43; review E4 + arbitration A4. Implemented by **M4.C**; classifier M9 |
| §27 `HealthDetail` on `IntegrationHealthRecord` (AMD-57) | "DEGRADED" with no machine-readable cause — operators reverse-engineering causes from window snapshots (the OpenHAB `ThingStatusDetail` lesson, re-grounded for a metrics-aggregating FSM) | A 12-value transition-trigger vocabulary mapping 1:1 to the `HealthParameters` surface; truthful by construction for a metrics-driven FSM (arbitration A1) | AMD-57 (RATIFIED 2026-06-05); Research 6 REC-42; arbitration A1. Implemented by **M4.C**; population M9 |
| §28 IntegrationLifecycleEvent Expansion (AMD-58) | Hook flows invisible to the event log, automations, WS stream, and audit narrative; re-opening a sealed hierarchy post-freeze; event-type string drift breaking persisted logs | Five observability-only permits frozen now with three-way registration lockstep; dot-namespaced `integration.*` strings with the legacy snake_case five frozen forever | AMD-58 (RATIFIED 2026-06-05); Research 6 REC-44/§7.3; arbitration A2 + E7 ruling. Implemented by **M4.C**; producer M9 |
| §29 Capability Events, Publisher & DiscoveryServices (AMD-59) | `Entity.capabilities` set at adoption with no mutation vocabulary — firmware-added features invisible to log/replay/automations; `Class<?>` in persisted payloads (reflective serde liability); device-keyed events unable to deterministically target multi-endpoint entities; transient mesh drops indistinguishable from deliberate unregistration (Research 12 Aqara evidence — the strip-automations-on-transient-drop HA failure mode) | Event-sourced capability mutation as the only path (entity-registry projection, no new table — NQ-4); replay self-sufficiency via the full embedded `CapabilityInstance`; descriptive-only `CapabilityRemovalReason`; integration-scoped publisher (LTD-17); `DiscoveryServices` aggregator (NQ-1) | AMD-59 (RATIFIED 2026-06-05); Research 6 REC-47; NQ-3/NQ-4; R6 co-sign + E8 ruling. Implemented by **M4.C**; projection at the registry milestone |
| §30 SecurityServices Aggregator & CredentialRotator (AMD-60) | Reauth flows ending with fresh credentials and no sanctioned write path (LTD-17 forbids direct config writes); torn OAuth token+refresh pairs under per-key rotation; context field-per-service growth | One aggregator field (NQ-1 doctrine frozen as AMD-60-INV-01); atomic multi-entry `rotate(Map)` durable-before-return (arbitration A5); SecretEntry vocabulary reused, no bundle type | AMD-60 (RATIFIED 2026-06-05); Research 6 REC-45; NQ-1; R7 co-sign + arbitration A5. Implemented by **M4.C**; rotator impl M9 |
| §31 Descriptor Soft Dependencies (AMD-61) | Hard-only dependency graphs forcing authors to abuse `dependsOn`, creating spurious startup failures for optional peers (HA solved this with `after_dependencies`) | A soft tier that orders when present and never blocks when absent (INFO, not WARN); uniform cycle detection; construction-time overlap guard | AMD-61 (RATIFIED 2026-06-05); Research 6 REC-46. Implemented by **M4.C**; Kahn semantics M9 |
| §32 Descriptor BackoffParameters (AMD-62) | "Retry with backoff" with no declared shape; one global schedule forcing cloud-API worst cases onto local serial adapters; restart-intensity duplication (REC-49 lesson) | A deterministic, testable `(initialDelay, multiplier, maxDelay)` record reproducing HA's empirically validated 5/10/20/40/80s schedule as the default; jitter stays supervisor policy; suspend thresholds stay on `HealthParameters` | AMD-62 (RATIFIED 2026-06-05); Research 6 REC-48; NQ-5/NQ-6; review E10. Implemented by **M4.C**; consumption M9 |
| §33 IsolationLevel Reservation (AMD-63) | JNI/native adapter failures with no isolation escape hatch — and retrofitting a descriptor field across every published adapter post-MVP | A one-field reservation (AMD-34 cheap-insurance pattern): `RESERVED_SUBPROCESS` exists but is rejected at startup until a future amendment activates it | AMD-63 (RATIFIED 2026-06-05); Research 6 REC-50 as corrected by the v2 plan [VR §B F-C]. Implemented by **M4.C** |
| §34 Per-Descriptor Planned-Restart Timeout (AMD-64) | One global 60s planned-restart grace forcing the Zigbee radio-re-init worst case onto stateless cloud pollers, or false-positive failures on slow adapters | Nullable per-descriptor override with the global §3.14 default as fallback; present values fully replace, never combine | AMD-64 (RATIFIED 2026-06-05); Research 6 REC-51. Implemented by **M4.C**; enforcement M9 |
| §35 INV-PD-07 Crypto-Shred MVP-Scope Narrow + INV-PD-03 At-Rest Posture (AMD-86) | A ratified constitutional privacy invariant (INV-PD-07) mandating *operational* crypto-shredding at MVP that has no MVP consumer (a local single-home install deletes via whole-install reset; the immutability-vs-erasure conflict only bites with post-MVP audit-retention or off-device data) — and, conversely, the research deferring *all* at-rest encryption to Tier-2, leaving plaintext sensitive-PII on a removable SD card (a live INV-PD-03 exfiltration hole); an at-rest claim overstated as "safe if stolen" when a machine-local key shares the medium | Narrow INV-PD-07's MVP clause to encrypt-on-write-now / shred-operation-post-MVP (decision D2), preserving the `scope_keys` schema seam so the deferred operation is a clean later-add over the already-encrypted corpus (AMD-86-INV-01: encrypt-on-write irreversible, shred deferrable). State the INV-PD-03 at-rest posture precisely — partial MVP satisfaction (machine-local root protects key-excluding copies + less-privileged reads, NOT medium theft / on-device root; user-owned-key + media-theft resistance = Tier-2 via passphrase/TPM) — so the trust-brand claim is honest by construction | AMD-86 (RATIFIED 2026-06-07); decision D2; Doc 15 §3.4/§3.5/§3.6 (owner doc, Locked 2026-06-07); full DOCS review `2026-06-06_Doc15_AMD-86_DOCS_Review_Return.md` (J1/F-A threat-model PASS). Implemented by **M6** (MVP at-rest encryption + key infra); shred operation post-MVP |
| §36 `Expectation` Persisted Sealed-Type Codec (AMD-87) | A command-bearing `CapabilityAdded` carrying `CommandDefinition → ExpectedOutcome → Expectation` decoding to `DegradedEvent` because the sealed `Expectation` device type has no persistence codec — blocking M9 from publishing command-bearing capability events; a future 5th permit silently lossy-encoding through a `default` arm; float tolerances breaking forensic bit-identity | A hand-rolled tagged-union `Expectation` (de)serializer in `core/persistence` (no `@JsonTypeInfo`; exhaustive no-`default` switch over the 4 permits → a new permit is a compile break; AMD-52 bit-anchored-float discipline for `WithinTolerance`) so every permit round-trips losslessly (AMD-87-INV-01); the lone JPMS change `persistence requires com.homesynapse.device` is verified acyclic | AMD-87 (RATIFIED 2026-06-07, lightweight P4); reassigned from retired AMD-65 per the P2 ledger; AMD-52 codec precedent; lightweight review `2026-06-06_AMD-87_DOCS_Review_Return.md`. Implemented by **M5-A Part 2** (un-gated 2026-06-07) |
| §37 `ConfigurationChangeListener` — Per-Section Reload Reaction (AMD-66) | A reload pipeline with no consumer-facing seam — subsystems unable to declare how their section's change applies at runtime; a listener mutating the model out from under the file (violating the file-as-sole-source-of-truth); classification racing the published reload event so observers see an unclassified change | A plain, non-generic listener interface (the F7-corrected shape — the v1 sealed-generic bound was unsatisfiable on a final record) registered at composition time (no `ServiceLoader`, DEC-M3-16), classifying synchronously before the reload event publishes (AMD-66-INV-01/02); no-listener fallback = the locked per-property `x-reload` default (`PROCESS_RESTART`, [AMD-66-A] ENDORSED) | AMD-66 (RATIFIED 2026-06-09); Research 5 REC-55 (F7-corrected); Doc 06 §3.3/§4.3; review return `2026-06-09_AMD-66-71_DOCS_Review_Return.md`. Implemented by **M6.1**; exercised under the swap at **M6.4** |
| §38 Config-Document Schema Versioning `(major, minor)` (AMD-67) | A single `int schemaVersion` conflating breaking and additive config-document evolution (no way to say "additive, no migration needed"); the system-config and adapter-config version surfaces silently conflated (the confusion AMD-54 §3 warned of) | The `(configSchemaMajor, configSchemaMinor)` pair on `ConfigModel`/`ConfigMigrator`/`MigrationPreview`, the same idiom AMD-54 froze for adapter configs, on an explicitly distinct surface (AMD-67-INV-01); minor-only never migrates, major always does (AMD-67-INV-02, the AMD-54-INV-02 transplant); zero blast radius (no production migrator; no cross-module `ConfigModel` consumer) | AMD-67 (RATIFIED 2026-06-09); Research 5 REC-56 (REC-41 blocker cleared by ratified AMD-54 §1.1); review return `2026-06-09_AMD-66-71_DOCS_Review_Return.md` (E67-1/2 folded). Implemented by **M6.1** |
| §39 `SecretStore` Atomic Multi-Key Durable Write (AMD-68) | A loop of single-key `set()` calls tearing an OAuth access+refresh-token pair on crash — a credential left half-rotated and unusable; the ratified AMD-60-INV-03 (rotate atomic-across-entries, durable-before-return) having no store-layer write that can satisfy it; Doc 06 §8.5 stale vs the Locked Doc 15 §7.3 requirement | `SecretStore.setAll(Map)` — all-or-nothing, durable-before-return via write-temp → fsync → atomic-rename → fsync-dir on `secrets.enc` (AMD-68-INV-01), the store-layer guarantee beneath the M9 `CredentialRotator`; the REC-57 bundle/`credentialsFor` half retired by ratified AMD-60 ([AMD-68-A] VERIFIED — no orphaned consumer), keeping reads on `ConfigurationAccess` | AMD-68 (RATIFIED 2026-06-09 — the Doc 06 currency amendment); Doc 15 §7.3 (verbatim requirement); AMD-60-INV-03; review return `2026-06-09_AMD-66-71_DOCS_Review_Return.md` (E68-1 folded). Implemented by **M6.2** (interface may freeze at M6.1) |
| §40 Configuration Observability Events (AMD-70) | Validation passes and section reloads invisible to the event log, dashboard, and audit narrative; config-module types specified inside event-resident records forcing an `event→config` JPMS cycle (the AMD-52 `event↔device` class — the review's load-bearing E70-1 catch); new event types missing manifest/pin sites and failing `encode()` in production (the M4.C lesson) | Two observability-only dot-namespaced events (`config.validation_completed`, `config.section_reloaded`) that never participate in state projection (AMD-70-INV-01, INV-CE-01); payloads flattened to event-resident/`java.base` types under the **type-residency rule** (config types consumed, never referenced — now standing in the P2 consumer/pin survey as the JPMS contract-direction check); full manifest registration enumerated for the M6.1 survey | AMD-70 (RATIFIED 2026-06-09); Research 5 REC-59+REC-61; NQ-5 (flat `com.homesynapse.event`, AMD-52 precedent); review return `2026-06-09_AMD-66-71_DOCS_Review_Return.md` (E70-1 LOAD-BEARING + E70-2 folded). Implemented by **M6.1** (`validation_completed`) + **M6.4** (`section_reloaded`, survey re-run) |
| §41 Hybrid Configuration Directory Layout (AMD-71) | No fixed on-disk layout contract for the loader; unconstrained `!include` inviting the Home-Assistant chained-include footgun and path-traversal reads (`../`, absolute, symlink escape); a `config → platform` JPMS edge (or implied readability) falsifying every embedded module-info just to resolve the config dir | The hybrid layout rooted at `PlatformPaths.configDir()` (root doc + `integrations/` + `secrets.enc` + regenerable `schemas/` + `signing-key.pub`); canonicalization-based fail-closed containment (AMD-71-INV-01) and one-level-deep `!include` (AMD-71-INV-02); the config-dir `Path` injected from the composition root ([AMD-71-A]/E71-2 ruling = M6.1 DP-3) preserving the zero-new-edge property the Doc 15 §3.8 E2 bridge depends on | AMD-71 (RATIFIED 2026-06-09); Research 5 REC-60; Doc 06 §3.1; Doc 15 §9 (`${config_dir}`); review return `2026-06-09_AMD-66-71_DOCS_Review_Return.md` (E71-1/2 folded). Implemented by **M6.1** |
| §42 TriggerDefinition M7 Expansion (AMD-88) | Promotion breaks switch exhaustiveness; trigger references rot across definition edits (index-keyed traces). |
| §43 Selector Semantic Tags + Role Exclusion (AMD-89) | CONFIG/DIAGNOSTIC entities actuated by group automations — the HA voice-assistant exclusion class. |
| §44 Action Confirmation + Iteration Bounds (AMD-90) | Surprise double-actuation via engine retry; unbounded repeat loops freezing Runs (HA #115042 class). |
| §45 Run Causal Chain + Cycle Suppression (AMD-91) | Window-dependent loop suppression; replay-divergent cascade behavior (INV-TO-02 breach). |
| §46 Automation Event Vocabulary (AMD-92) | JPMS cycle via payload types (the AMD-52/E70-1 class); unregistered types failing encode in production (the M4.C class). |
| §47 Automation Definition Schema Posture (AMD-93) | Destructive definition migration (the Groovy/Rule-Machine corpus-loss class); silently-never-fires dangling references. |
| §48 Rotate-DEK-on-Restore + Envelope Version Discriminator (AMD-94) | Cross-restore (key,nonce) reuse breaking AES-GCM confidentiality *and* authentication (the OR-M6-NONCE restore-half: backup at N → live writes to N+k → restore to N → reuse N+1…N+k under the same DEK); an immutable hash-chained AEAD corpus shipped with no algorithm/version-agility slot, forcing a worst-conditions migration once the corpus is live and the chain is verified. |
| §49 Superior Automation Layer (Doc 16) | Expressiveness delivered via a runtime template/DSL (the silent-failure Groovy/Jinja/Rule-Machine corpus) instead of expansion into the sealed model; explanations diverging from truth via a parallel trace store; a Run dying in a silent partial success or autonomously re-issuing commands (double-actuation); federation foreclosed by a site-local-sequential identity or a payload-resident scope forcing an immutable-log migration. |

---

## 19. Event Distribution, Projection, and Subscriber Lifecycle

§19 registers invariant categories added during Phase 3 governance work (AMD-41, AMD-42, and AMD-43, applied 2026-05-16). These categories appear after the §17 Invariant Index and §18 Traceability Matrix because the categories themselves were authored after those structural sections. Both the Invariant Index and the Traceability Matrix are updated in the same commit to maintain completeness; readers may continue to use §17 as the canonical per-identifier lookup and §18 as the per-category traceability source. Future Phase-N governance additions follow the same pattern: append a new top-level section and update §17 and §18 in the same commit.

The invariants in this section govern the event bus, the state projection's execution discipline, the single-writer pipeline, and per-subscriber resource isolation. They register identifiers that AMD-41 (State Projection Execution Model), AMD-42 (Subscriber Lifecycle and Isolation), and AMD-43 (Backpressure and Observability) cite normatively. The amendments remain the implementing-policy source-of-truth; this section provides the canonical invariant definitions the amendments refine or introduce. Within §19 the invariants are organized into four inline sub-groupings — BUS (event bus and distribution), PROJ (state projection), WRITER (single-writer discipline), and SUB-ISO (subscriber isolation) — each introduced by a short prose paragraph that follows immediately below.

### Event Bus and Distribution (BUS)

The BUS category codifies properties of HomeSynapse's pull-based in-process event bus (LTD-11, Doc 01 §3.4) — what subscribers can rely on from the bus, what the publisher promises about non-blocking semantics, and how failure containment works across subscribers. The three identifiers `INV-BUS-01` through `INV-BUS-03` are refined by AMD-42 (delivery and isolation) and AMD-43 (non-blocking publish).

### INV-BUS-01: Exactly-Once Delivery Per Subscriber

Every event persisted to the WAL is delivered to each registered subscriber exactly once during normal operation. Duplicate delivery during crash recovery is bounded by the subscriber's last persisted checkpoint position (`CheckpointStore`) and is reconciled by subscriber idempotency (INV-ES-05). The event bus MUST use the per-subscriber checkpoint as the resume gate after a process restart, and the REPLAY → TRANSITION → LIVE transition MUST track `lastReplayedPosition` so that events delivered during catch-up are not re-delivered during drain (AMD-42 §3.4.2).

### INV-BUS-02: Publish Is Non-Blocking on Backpressure

`EventPublisher.publish()` MUST NOT block on writer queue depth, semaphore acquisition, or any other depth-gated mechanism. Natural backpressure arises from the single-thread write executor (INV-WRITER-01, AMD-26): callers park on their handoff future, which completes only when the writer drains to their slot. Saturation manifests as elevated per-call latency, never as `publish()` hanging. The ArchUnit rule `EVENT_PUBLISHER_HAS_NO_DEPTH_GATED_LOCK` (introduced in M3.3 per AMD-43) enforces this structurally: no class in `core/persistence` or `core/event-bus` may import `java.util.concurrent.Semaphore`, `java.util.concurrent.locks.Lock`, or call `Object.wait()` in a code path reachable from `EventPublisher.publish()`.

### INV-BUS-03: Subscriber Isolation

A failure in subscriber A — including thrown exceptions, DLQ overflow, circuit-breaker trip into SUSPENDED, dedicated-connection corruption, or unbounded backlog — MUST NOT affect subscriber B's mode, queue, connection, DLQ, or delivery cadence. Cross-subscriber state mutation through any shared mutable resource is forbidden. The concrete catalog of per-subscriber resources that implements this invariant is INV-SUB-ISO-01..06 (AMD-42 §3.4.4). The bus implementation MUST be tested with a contract test method per INV-SUB-ISO-01..06 demonstrating no cross-contamination.

### State Projection (PROJ)

The PROJ category governs the State Projection's execution discipline — its determinism guarantees, its checkpoint monotonicity, and its self-produced event isolation. The identifiers `INV-PROJ-01`, `INV-PROJ-04`, and `INV-PROJ-NEW-01` are refined or introduced by AMD-41. The numbering reserves `INV-PROJ-02` and `INV-PROJ-03` for future projection invariants without disturbing the existing identifiers.

### INV-PROJ-01: Projection Determinism

A state projection produces the same materialized state given the same event log replayed in `globalPosition` order, regardless of timing, thread scheduling, process-restart count, or wall-clock progression. Determinism is a constitutional requirement for crash recovery (INV-RF-04 Crash Safety and Automatic Recovery) and for the explainability invariant (INV-ES-06 Every State Change Is Explainable). Projection implementations MUST NOT depend on wall-clock time, random number generators, or external service state for derivation logic. Clock-based logic, where present, routes through an injected `java.time.Clock` and is enforced by the `NO_DIRECT_TIME_ACCESS` ArchUnit rule (DEC-M3-09). AMD-41 §3.2.1's two-phase READ/PUBLISH/CHECKPOINT discipline strengthens this invariant by eliminating read-write interleaving as a source of non-determinism.

### INV-PROJ-04: Checkpoint-Position Monotonicity

A subscriber's persisted checkpoint position is strictly non-decreasing during normal operation. A checkpoint write at `globalPosition = P` implies that all events with `globalPosition ≤ P` have been observed and processed (subject to subscriber idempotency per INV-ES-05). Checkpoint rewinding occurs only during operator-initiated reconciliation passes (e.g., AMD-41 §3.2.4 `projectionVersion` mismatch resets the checkpoint to `position = 0`) and is logged and observable. The two-phase discipline (AMD-41 §3.2.1) preserves monotonicity by writing the checkpoint only after all derived publishes return successfully — partial-publish-then-checkpoint cannot occur.

### INV-PROJ-NEW-01: Self-Produced Event Isolation

A derivation-producing subscriber (e.g., `StateProjection`) MUST NOT re-derive from its own published events during LIVE mode. The implementing mechanism is the `SelfProducedFilter` (AMD-41 §3.2.2): an in-memory set keyed by `EventEnvelope.eventId` with a 60-second TTL and lazy eviction. Every successful `EventPublisher.publish()` from the projection inserts the resulting envelope's `eventId` into the filter; every inbound delivery checks the filter and short-circuits matches without re-derivation. The filter is bypassed during REPLAY and TRANSITION modes (AMD-42 §3.4.1), where the projection re-derives deterministically from the log and the in-memory filter from the previous process cannot be trusted. Defense-in-depth: if the filter misses (e.g., on process restart), the projection's derivation logic compares the candidate derived event's `stateVersion` to the current materialized state and discards equal-or-lower versions (INV-PROJ-04).

### Single-Writer Discipline (WRITER)

The WRITER category elevates the single-writer constraint from implementing-policy status (AMD-26) to constitutional status. `INV-WRITER-01` is the only identifier in this category at present; it is the invariant that INV-BUS-02 (non-blocking publish) and the contiguous `globalPosition` guarantee both depend on.

### INV-WRITER-01: Single-Writer Discipline

All SQLite write operations route through a single bounded platform-thread executor (`WriteCoordinator`, AMD-26). At any given instant, at most one thread holds the writer position. No second writer pool exists. No derived-write thread bypasses the `WriteCoordinator`. The single-writer discipline is the foundation of contiguous `globalPosition` assignment via `BEGIN IMMEDIATE`, the WAL checkpoint progression guarantees validated by the D1 WAL Pathology Spike (2026-05-15), and the natural backpressure mechanism that INV-BUS-02 relies on. AMD-26 is the implementing-policy citation; this invariant elevates the constraint to constitutional status.

### Subscriber Isolation (SUB-ISO)

The SUB-ISO category enumerates the per-subscriber resources that AMD-42 §3.4.4 mandates. Each `INV-SUB-ISO-NN` identifier corresponds to exactly one per-subscriber resource. Together they implement INV-BUS-03 (Subscriber Isolation) concretely: a failure that crosses any one of these resources would constitute a violation of INV-BUS-03. Identifiers `INV-SUB-ISO-01` through `INV-SUB-ISO-06` are introduced by AMD-42 (catalog form).

### INV-SUB-ISO-01: One Virtual Thread Per Subscriber

Each registered subscriber owns exactly one virtual thread, named `hs-sub-<subscriberId>`. The thread is created on `EventBus.subscribe(subscriberInfo)` and terminated on `EventBus.unsubscribe(subscriberId)` or on a SUSPENDED → resume cycle (AMD-42 §3.4.5). No two subscribers share a virtual thread. The subscriber's virtual thread is the only thread that invokes `subscriber.onEvent(envelope)`; the per-subscriber `SubscriberSupervisor` wraps these invocations.

### INV-SUB-ISO-02: One Dedicated SQLite Read Connection Per Subscriber

Each subscriber holds one SQLite read connection for the lifetime of its subscription. The connection is allocated from the persistence layer's read executor pool (AMD-27) at `subscribe()` time and is released at `unsubscribe()` or on a SUSPENDED → resume cycle. No two subscribers share a read connection at any instant. The connection's thread-confinement (a sqlite-jdbc invariant) is satisfied by the AMD-26/27 platform-thread handoff: the subscriber's virtual thread submits reads to a platform thread that owns the connection. The mechanism for binding "one connection per subscriber" against a read-pool size that may be smaller than the subscriber count is an M3.1 design decision (open question 20.2 of the top-down analysis).

### INV-SUB-ISO-03: One DLQ Instance Per Subscriber

Each subscriber owns one `SubscriberDlq` instance backed by per-subscriber rows in the `subscriber_dead_letters` table (V002, AMD-36). DLQ entries are uniquely keyed by `(subscriberId, event_position)`. Cross-subscriber DLQ contamination is forbidden: subscriber A's DLQ overflow does not affect subscriber B's DLQ capacity, retry cadence, or persistence. The in-memory DLQ ring cap (1024 entries, AMD-42 §3.4.5) is per-subscriber.

### INV-SUB-ISO-04: One Mode AtomicReference Per Subscriber

Each subscriber's mode (`COLD` / `REPLAY` / `TRANSITION` / `LIVE` / `SUSPENDED`, AMD-42 §3.4.1) is held in a per-subscriber `AtomicReference<SubscriberMode>`. Transitions are atomic (CAS-based). No two subscribers share a mode reference. The mode is observable to operators through the bus's introspection API (the exact API shape is an M3.1 design decision — open question 20.1 of the top-down analysis).

### INV-SUB-ISO-05: One ReplayWindowQueue Per Subscriber

During REPLAY mode, events newly published while the subscriber is catching up are captured in a per-subscriber `ReplayWindowQueue` bounded at 10000 entries (AMD-42 §3.4.2). The queue is created on REPLAY entry, drained in TRANSITION (with gap detection against `lastReplayedPosition`), and garbage-collected after the LIVE transition. No two subscribers share a `ReplayWindowQueue`.

### INV-SUB-ISO-06: One SelfProducedFilter Per Derivation-Producing Subscriber

Derivation-producing subscribers (currently only `StateProjection`) each own one `SelfProducedFilter` instance with the 60-second TTL and lazy-eviction semantics defined by INV-PROJ-NEW-01. The filter is per-subscriber; cross-subscriber filter sharing is forbidden. Non-derivation-producing subscribers (e.g., observability subscribers, websocket relays) do not instantiate a `SelfProducedFilter`.

---

## 20. Device-Model Attribute-Value Hierarchy Expansion (AMD-47)

§20 registers the invariant category added by AMD-47 (AttributeValue Hierarchy Expansion + AttributeValueUpcaster SPI), RATIFIED 2026-05-30. It follows the §19 precedent: an amendment-driven category appended after the §17 Invariant Index and §18 Traceability Matrix, with both of those structural sections updated in the same commit. The identifiers use the amendment-scoped `AMD-47-INV-NN` form (the convention the projection block's `AMD-50-INV-NN` introduced) rather than a semantic `INV-{CATEGORY}` prefix, because they are contract-level invariants bound 1:1 to a single amendment. AMD-47 remains the implementing-policy source-of-truth; this section provides the canonical invariant definitions it allocates. The contract is registered at ratification; the production types, the `AttributeValueUpcaster` SPI, and the §5 contract tests are implemented by **M4.B3** (the device-model `AttributeValue` expansion WU). The statements below are verbatim from AMD-47 §4.

### AMD-47-INV-01: Sealing Remains Total

After this amendment the `AttributeValue` `permits` clause enumerates **exactly** `{BooleanValue, IntValue, FloatValue, StringValue, EnumValue, QuantityValue, ArrayValue, DegradedAttributeValue}` (8 variants). Every exhaustive `switch` over `AttributeValue` must handle all eight; no implementor outside the `permits` clause may exist. (Preserves the Doc 02 §8.2 sealed-exhaustiveness contract; an ArchUnit/compile check is the enforcement, mirroring the Capability-hierarchy exhaustiveness rule.)

### AMD-47-INV-02: Upcaster-Before-Derivation Ordering (REC-78)

When the `AttributeValueUpcaster` is wired (M4.B3), it MUST execute **strictly before** `DerivationRule.evaluate()` on **both** the `onEvent` and `processBatch` projection paths. No path may reach `evaluate()` with an un-upcast stored value. (Gate-every-path discipline — the M4.0a / AMD-50 both-paths lesson.)

### AMD-47-INV-03: QuantityValue Normalization Determinism (REC-93)

`QuantityValue` normalizes to its canonical unit at construction via a pure, hand-rolled, deterministic conversion — no external units library, no I/O, no locale/clock dependence. Same-dimension `QuantityValue`s are magnitude-comparable on their canonical `value`. An unknown/unsupported unit, a `null`/blank unit, or a non-finite magnitude fails construction deterministically (fail-closed; never silently coerced, never degraded).

### AMD-47-INV-04: DegradedAttributeValue Non-Declarable and Lossless

`AttributeType.DEGRADED` may never appear in an `AttributeSchema.type` (the `AttributeValidator` rejects it). `DegradedAttributeValue` preserves `originalTypeName`/`rawForm`/`failureReason` without mutation and is never written to canonical state under strict mode — it is a lenient-mode/forensic artifact only (parallels `DegradedEvent` strict/lenient modes, Doc 01 §3.10).

### AMD-47-INV-05: ArrayValue Full-Replacement

`ArrayValue` carries no delta/patch semantics; a new `ArrayValue` wholly replaces the prior value for the attribute. This is required for compatibility with the bounded-window advancer (Research 8 insight #2). `elements` is an unmodifiable, null-free, possibly-empty `List<AttributeValue>`.

---

## 21. State-Store Typed Change-Detection Comparator (AMD-51)

§21 registers the invariant category added by AMD-51 (Typed `AttributeValue` Change-Detection Comparator), RATIFIED 2026-05-30 — registered here (plus the §17 Invariant Index and §18 Traceability Matrix) at ratification, following the §20/AMD-47 precedent. The production comparator, the schema-driven inbound-reconstruction step, and the §5 contract tests are implemented by **M4.0b-3** (which bumps `projectionVersion` 2→3 on AMD-50's frozen reconciliation-backfill path). The identifiers use the amendment-scoped `AMD-51-INV-NN` form (the `AMD-47-INV-NN` / `AMD-50-INV-NN` convention) because they are contract-level invariants bound 1:1 to a single amendment. AMD-51 remains the implementing-policy source-of-truth. The statements below are verbatim from AMD-51 §4.

### AMD-51-INV-01: Typed Total Comparison (exhaustive, no `default`)

Change detection over `AttributeValue` is a **total** function realized by an exhaustive `switch` over the 8-variant sealed hierarchy with **no `default` arm** — a future permit MUST break compilation. Per-variant: exact equality for Boolean/Int/Enum/String; total-form epsilon for Float; canonical-magnitude epsilon + canonical-unit dimension check for Quantity; size-then-order-sensitive deep compare for Array; the Degraded rule (AMD-51-INV-03). D-01 (no exhaustive switch over **event** types) does not apply — it is event-type-scoped; an exhaustive switch over the sealed `AttributeValue` is permitted (AMD-47-INV-01).

### AMD-51-INV-02: Float/Quantity Epsilon Totality (pinned total form)

Float and same-dimension Quantity comparison uses the total form `changed ⟺ |a − b| > max(absEps, relEps · max(|a|, |b|))` with explicit IEEE-754 totality: `NaN`↔number = changed; `NaN`↔`NaN` = unchanged; `−0.0` == `+0.0`; same-sign `Inf` = unchanged; opposite-sign or finite↔`Inf` = changed. A pure relative epsilon is rejected (explodes near zero). Defaults `absEps = relEps = 1e-9` are a correctness (FP-noise) epsilon, not a perceptual deadband; carried in `ComparisonPolicy`; deterministic, with no clock, I/O, or randomness.

### AMD-51-INV-03: Degraded Change-Detection Semantics

Inbound `DegradedAttributeValue` ⇒ never emit; prior `DegradedAttributeValue` + valid inbound ⇒ emit (recovery); two `DegradedAttributeValue` ⇒ unchanged (REC-94, HA-mirrored). Consistent with AMD-47-INV-04 (a `DegradedAttributeValue` is never written to canonical state under strict mode).

### AMD-51-INV-04: Comparator Placement + Gateway (state-store)

The comparator is an external `AttributeValueComparator` in `com.homesynapse.state` carrying a `ComparisonPolicy`, **not** a method on the `AttributeValue` sealed interface — projection/epsilon policy is kept out of the device-model data layer. The implementation is package-private behind a public static factory (DEC-M3-16 gateway), consistent with `DerivationRule.production()`, `StateQueryService.materialized()`, and `StateCheckpointSource.stub()`.

### AMD-51-INV-05: Symmetric Reconstruction; 2→3 Rides AMD-50 Unchanged

**Both** comparison operands are reconstructed to the schema-declared typed `AttributeValue` before comparison, by one **schema-driven parse keyed by `AttributeSchema.type`**: the inbound `StateReportedEvent.value` (QUANTITY unit from `StateReportedEvent.unit`, fallback `AttributeSchema.canonicalUnitSymbol`) **and** the prior materialized value, which is always a `StringValue` (or `null`) — never the schema variant — reconstructed from its `value()` String. The produced typed values are transient; the materialized attribute and the emitted payload stay `String` (AMD-52 territory). This reconstruction is **distinct from** the `AttributeValueUpcaster` stored-value-migration SPI, which is left unchanged. Because typed compare alters change-detection outcomes vs the string rule, it rides a `projectionVersion` **2→3** bump on AMD-50's reconciliation-backfill path **unchanged**; reconstruction is identical on LIVE and on the 2→3 backfill (determinism, AMD-50-INV-03), and the AMD-50 supersession test remains the N→M regression guard.

---

## 22. Typed `StateChangedEvent` Payload — Serializer & Replay (AMD-52)

§22 registers the invariant category added by AMD-52 (Typed `StateChangedEvent` Payload — `AttributeValue` Serializer, Schema-Versioned Replay, and Typed Materialization), RATIFIED 2026-05-31 — registered here (plus the §17 Invariant Index and §18 Traceability Matrix) at ratification, following the §20/§21 precedent. The `AttributeValue` (de)serializer, the typed checkpoint envelope, the typed emit, the `schema_version` 1→2 seam, and the §5 contract tests are implemented by **M4.0b-4** (which bumps `projectionVersion` 3→4 on AMD-50's frozen reconciliation-backfill path; the AMD-51 §2.7 String-payload freeze is lifted by this ratification). The identifiers use the amendment-scoped `AMD-52-INV-NN` form. AMD-52 remains the implementing-policy source-of-truth. The statements below are verbatim from AMD-52 §4.

### AMD-52-INV-01: Typed Payload; Per-Event `schema_version` Discriminator; No Row Migration

`StateChangedEvent.oldValue/newValue` are `AttributeValue` (`newValue` non-null; `oldValue` nullable = no prior / first report). The typed payload is written at `events.schema_version = 2`; the per-event `schema_version` column is the string(1)↔typed(≥2) discriminator. **No `events` and no `view_checkpoints` row/column migration** — the typed payload stays in-BLOB on both surfaces (gate G5, closed by the OQ-05-08 design beat).

### AMD-52-INV-02: Custom Non-Reflective, Jackson-Isolated Codec, Total Over 8 Variants

`AttributeValue` is (de)serialized by a custom `JsonSerializer`/`JsonDeserializer` pair in `com.homesynapse.persistence`, keyed by an explicit `AttributeType` tag in the compact envelope `{"t":<AttributeType>,"v":…}`; dispatch is an exhaustive `switch` over the 8 permits with **no `default`** (a 9th permit breaks compilation — the serialization twin of AMD-51-INV-01). **No `@JsonTypeInfo`** — for the `StateChangedEvent` event host via ArchUnit Rule 7 `NO_JSON_TYPE_INFO_IN_EVENTS` (`com.homesynapse.event..`), and for the device-resident `AttributeValue` via the Jackson-isolation HARD RULE (no `com.fasterxml.jackson.*` import outside persistence; no Jackson annotation on `AttributeValue`/`StateChangedEvent`). `ArrayValue` recurses the envelope per element in order; fields are written in fixed order (no `Map` in any variant). The codec adds no new Jackson artifact (`JsonSerializer`/`JsonDeserializer` are in `jackson-databind`). _(Module-edge correction — AMD-52 §11 erratum: the `AttributeValue` hierarchy relocates to a new `com.homesynapse.value` leaf module to break the event-model→device-model cycle the typed `StateChangedEvent` field would otherwise create; the codec declares `requires com.homesynapse.value`. The original "adds no `requires`" wording is superseded; the codec substance — no `@JsonTypeInfo`, no new Jackson artifact, total over 8 variants, Jackson confined to persistence — stands.)_

### AMD-52-INV-03: Bit-Anchored Float Identity; Round-Trippable Text; `chain_hash` Inert

`FloatValue`/`QuantityValue` identity is `Double.doubleToLongBits` after the AMD-51 §2.3 canonicalization (`−0.0`→`+0.0`, canonical NaN). The stored `"v"` text is required only to be lossless round-trippable (`parseDouble(render(x))` recovers the same bits), never byte-frozen, and no canonical text renderer is owned — this dissolves the JDK-18→19 Schubfach `Double.toString` instability. `chain_hash` stays the AMD-37 NOT-NULL zero-reservation (NOT activated by AMD-52); if a future amendment ever activates it, it MUST hash the bit-anchored canonical form, never the stored text.

### AMD-52-INV-04: JSON-Valid Non-Finite Sentinels; No Non-Standard Tokens

`FloatValue` `NaN`/`±Inf` encode as the JSON-valid sentinel strings `"NaN"`/`"+Inf"`/`"-Inf"` with a strict decoder that rejects unknown tokens; `ALLOW_NON_NUMERIC_NUMBERS` stays disabled (no bare `NaN`/`Infinity` tokens). `−0.0` canonicalizes to `+0.0` (coherent with AMD-51 §2.3). `QuantityValue` cannot carry non-finite (construction-rejected, AMD-47-INV-03) and has no sentinel branch.

### AMD-52-INV-05: Path A Authoritative; Path B = Defined `DegradedEvent`; Append-Only

The 3→4 reconciliation re-derives all materialized state from the immutable `state_reported` log (Path A; rides AMD-50/AMD-51 unchanged) — the sole authoritative source of materialized state. Reading a legacy `schema_version = 1` String-payload `state_changed` under the typed reader yields a `DegradedEvent` carrying the raw payload verbatim (a defined non-upcast, not a lossy upcast); the version gate lives in `EventPayloadCodec.decode` (which already receives `schema_version`). **No `AttributeValueUpcaster` or schema resolver is wired into the decode path** (persistence must not depend down into device/state schema knowledge — the layering inversion is forbidden). No event is ever mutated (no `UPDATE`/`DELETE` on `events`).

### AMD-52-INV-06: Typed Checkpoint Envelope (S2)

`CheckpointSerializer` materializes `attributes` as a typed envelope per entry (the extension its own Javadoc anticipates), reusing the AMD-52-INV-02 codec, inside the same `view_checkpoints.data` BLOB — no row migration. The `JsonInclude.Include.ALWAYS` null round-trip is preserved (nullable `staleAfter` + null attribute values survive; rebuild via `HashMap.put`, never `Map.copyOf`). A deserialize failure surfaces `IllegalStateException` → the projection's lazy-init clear-and-replay reconciliation; the 3→4 `projectionVersion` mismatch makes this automatic.

### AMD-52-INV-07: `projectionVersion` 3→4 on Frozen AMD-50 Backfill

Typed materialization + typed payload is a materialized-output change → `projectionVersion` **3→4**, riding AMD-50's frozen reconciliation-backfill discipline unchanged (the fourth version on the same rails: 1→2, 2→3, 3→4). The AMD-50 supersession test remains the standing N→M regression guard and guards the 3→4 transition. `shouldPublishDerived` is migrated to a typed-coherent comparison so it neither manufactures nor suppresses a genuine change.

---

## 23. Timestamp-Model Unifier — Event-Time Activity-Timestamp Materialization (AMD-53)

§23 registers the invariant category added by AMD-53 (Timestamp-Model Unifier — Event-Time Sourcing for EntityState Activity Timestamps), RATIFIED 2026-05-31 — registered here (plus the §17 Invariant Index and §18 Traceability Matrix) at ratification, following the §20/§21/§22 precedent. The event-time sourcing of `lastChanged`/`lastUpdated`/`lastReported` across all projection paths (LIVE `applyToState`, the reconciliation backfill, and entity-adoption seeding), the `staleAfter`/`stale` carve-out, the `projectionVersion` 4→5 bump on AMD-50's frozen backfill, and the §5 contract tests are implemented by **M4.0b-5** (the timestamp-unifier `core/state-store` WU; coding instruction issued 2026-05-31). The identifiers use the amendment-scoped `AMD-53-INV-NN` form. AMD-53 remains the implementing-policy source-of-truth. The statements below are verbatim from AMD-53 §4.

### AMD-53-INV-01: Event-Time Activity-Timestamp Determinism

`EntityState.lastChanged`, `lastUpdated`, and `lastReported` are sourced from the causing envelope's `eventTime ?? ingestTime` — **never** from the projection wall-clock (`clock.instant()`) — in every projection path (LIVE `applyToState` all branches, reconciliation backfill, and entity-adoption seeding). They are therefore replay-deterministic: for a fixed event log they are identical across any rebuild path (from-zero replay, reconciliation backfill, steady-state catch-up). Extends AMD-50-INV-03 from the `DerivationRule` to the projection's state materialization; brings the code into compliance with Doc 03 §4.1.

### AMD-53-INV-02: Real-Time Freshness Carve-Out

`staleAfter` and `stale` are the **only** real-time-clock-dependent fields on `EntityState`: `stale` is derived at read time from `Instant.now()` vs `staleAfter`, and `staleAfter` (when resolved) is `eventTime + threshold` — a target for real-time comparison, not an activity timestamp. They are explicitly **excluded** from AMD-53-INV-01 and retain the Doc 03 §3.8 / §4.1 freshness semantics. (Guards against the unifier being misread as "no wall-clock anywhere on `EntityState`.")

---

## 24. IntegrationDescriptor Config-Schema Versioning (AMD-54)

§24 opens the eleven-section Workstream C integration block (§24–§34), registered together at the block ratification of AMD-54..64 (RATIFIED 2026-06-05 — single DOCS-Project review return, nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`, plus Nick arbitrations A1–A5 and the E3/E7/E8 rulings), following the §20–§23 precedent: each section registered here (plus §0.3, the §17 Invariant Index, and the §18 Traceability Matrix) in the same commit. Contracts are registered at ratification; the **M4.C** integration-api freeze WU implements the types, guards, and shape tests; supervisor behavior lands at **M9**. Identifiers use the amendment-scoped `AMD-NN-INV-NN` form. Each AMD remains the implementing-policy source-of-truth. The statements below are verbatim from AMD-54 §7.

### AMD-54-INV-01: Two Distinct Compatibility Surfaces

`descriptorSchemaVersion` (descriptor contract) and `(configSchemaMajor, configSchemaMinor)` (config-document schema) are distinct compatibility surfaces; no code path may derive one from the other.

### AMD-54-INV-02: Major Triggers Migration, Minor Never

Minor-only config mismatch never triggers migration; major mismatch always does (enforced at M9, contract frozen here).

---

## 25. IntegrationAdapter Post-Setup Lifecycle Hooks (AMD-55)

§25 registers the invariant category added by AMD-55, RATIFIED 2026-06-05 as part of the Workstream C block (see §24 preamble). The statements below are verbatim from AMD-55 §7.

### AMD-55-INV-01: All Hooks `default`; Pre-AMD-55 Adapters Unchanged

All four hooks are `default`; a pre-AMD-55 adapter remains source- and binary-compatible, with behavior identical to today.

### AMD-55-INV-02: Sequential Hook Execution on the Adapter Thread

Hooks execute sequentially on the adapter's thread; the supervisor never invokes a hook concurrently with another lifecycle method.

### AMD-55-INV-03: `migrate` Before `initialize`; Migrate-Failure → FAILED

`migrate` runs before `initialize` on schema mismatch; `PermanentIntegrationException` from `migrate` → FAILED without retry (Doc 05 §3.7 extension).

### AMD-55-INV-04: `REJECTED` Apply Never Leaves the Rejected Config Active

A `REJECTED` config/options apply never leaves the rejected config active — the supervisor restores the prior config section (planned restart on it); the prior config remains the valid running config. (M9 behavioral test; contract frozen here per the E3 ruling.)

---

## 26. ExceptionClassification `AUTH_FAILED` (AMD-56)

§26 registers the invariant category added by AMD-56, RATIFIED 2026-06-05 as part of the Workstream C block (see §24 preamble). The statements below are verbatim from AMD-56 §6.

### AMD-56-INV-01: `AUTH_FAILED` Never Routes to Transient Backoff

`AUTH_FAILED` never routes to transient backoff retry; its remediation path is reauth-or-suspend. (M9 behavioral test; contract frozen here.)

### AMD-56-INV-02: `ExceptionClassification` Append-Only, Order Frozen

The enum is append-only; existing declaration order frozen.

### AMD-56-INV-03: `PermanentIntegrationException` Constructors Append-Only; Well-Known Codes Documented

`PermanentIntegrationException` constructors are append-only; the no-code constructors permanently yield `integration.permanent_failure`; well-known codes (`integration.auth_failed`) are documented in AMD-56 before use.

---

## 27. `HealthDetail` on `IntegrationHealthRecord` (AMD-57)

§27 registers the invariant category added by AMD-57, RATIFIED 2026-06-05 as part of the Workstream C block (see §24 preamble; taxonomy arbitrated by A1 — PM transition-trigger vocabulary). The statements below are verbatim from AMD-57 §6.

### AMD-57-INV-01: `detail` Never Null; `NONE` Is the Explicit No-Cause Value

`detail` is never null; `NONE` is the explicit no-cause value. Supervisor-internal — adapters never set it (they have no write path to the record).

### AMD-57-INV-02: `HealthDetail` Append-Only; 1:1 Transition-Trigger Mapping

The enum is append-only once ratified; values map 1:1 to supervisor transition triggers.

---

## 28. IntegrationLifecycleEvent Expansion 5→10 (AMD-58)

§28 registers the invariant category added by AMD-58, RATIFIED 2026-06-05 as part of the Workstream C block (see §24 preamble). The statements below are verbatim from AMD-58 §6.

### AMD-58-INV-01: Three-Way Registration Lockstep

Every `IntegrationLifecycleEvent` permit is registered in `IntegrationEvents.LIFECYCLE_EVENT_CLASSES`, `EXPECTED_SUBTYPES`, and `EventTypes` in the same commit — three-way lockstep, no partial registration.

### AMD-58-INV-02: Persisted Event-Type Strings Immutable; Dot-Namespace for New; Legacy Five Frozen

Persisted event-type strings are immutable; new strings are dot-namespaced `integration.`; the legacy snake_case five are frozen.

### AMD-58-INV-03: The Five New Permits Are Observability-Only

The five new permits are observability-only — they never mutate projection state.

---

## 29. Capability Events, Publisher & DiscoveryServices (AMD-59)

§29 registers the invariant category added by AMD-59, RATIFIED 2026-06-05 as part of the Workstream C block (see §24 preamble; R6 payload refinement co-signed; `CapabilityRemovalReason` restored per the E8 ruling). The statements below are verbatim from AMD-59 §6.

### AMD-59-INV-01: Capability Events Are the Only Post-Adoption Mutation Path; No Capability Table

Capability events are the only post-adoption mutation path for `Entity.capabilities`; no API or registry method mutates the list outside the event-sourced path. No capability SQLite table exists.

### AMD-59-INV-02: `CapabilityAdded` Carries the Complete Instance (Replay Self-Sufficiency)

`CapabilityAdded` carries the complete `CapabilityInstance` — replay reconstructs `Entity.capabilities` from the log alone (replay self-sufficiency).

### AMD-59-INV-03: No `CapabilityId` Wrapper; Permit Class + String Identity

No `CapabilityId` wrapper type exists; capability type identity is the permit class (in-JVM) and `String capabilityId` (persisted).

### AMD-59-INV-04: `EntityId` Stable Across Capability Add/Remove

`EntityId` is stable across capability add/remove (no identity churn).

### AMD-59-INV-05: `CapabilityPublisher` Integration-Scoped (LTD-17)

`CapabilityPublisher` is integration-scoped (LTD-17): publishes only for entities owned by the calling adapter's integration.

### AMD-59-INV-06: `CapabilityRemovalReason` Descriptive-Only, Never Behavioral

`CapabilityRemovalReason` is descriptive diagnostics only — no supervisor, projection, or registry behavior branches on it (orphan detection unchanged). Consumers (M8 automations, UI) may branch on it; the core never does.

---

## 30. SecurityServices Aggregator & CredentialRotator (AMD-60)

§30 registers the invariant category added by AMD-60, RATIFIED 2026-06-05 as part of the Workstream C block (see §24 preamble; R7 narrowing co-signed; `rotate(Map)` widened per arbitration A5). The statements below are verbatim from AMD-60 §6.

### AMD-60-INV-01: Context Grows Only by Service-Family Aggregators (NQ-1 Doctrine)

`IntegrationContext` grows only by service-family aggregator fields; individual services join their family's aggregator record. (The NQ-1 doctrine, frozen.)

### AMD-60-INV-02: `SecurityServices` Nullable, `RequiredService.SECURITY`-Gated; Non-Null Inside

`SecurityServices` is nullable on the context, gated by `RequiredService.SECURITY`; inside the aggregator, declared services are non-null.

### AMD-60-INV-03: `rotate` Integration-Scoped, Atomic Across Entries, Durable-Before-Return

`CredentialRotator.rotate` is integration-scoped (LTD-17), atomic across all entries of a single call (all-or-nothing — a token+refresh-token pair can never be torn), and durable-before-return.

---

## 31. Descriptor Soft Dependencies (AMD-61)

§31 registers the invariant category added by AMD-61, RATIFIED 2026-06-05 as part of the Workstream C block (see §24 preamble). The statements below are verbatim from AMD-61 §5.

### AMD-61-INV-01: Soft Dependency Never Blocks Startup; Hard Always Does

A missing/failed soft dependency never blocks startup (INFO log only); a missing hard dependency always does.

### AMD-61-INV-02: `dependsOn ∩ softDependencies = ∅` at Construction

`dependsOn ∩ softDependencies = ∅`, enforced at construction.

---

## 32. Descriptor BackoffParameters (AMD-62)

§32 registers the invariant category added by AMD-62, RATIFIED 2026-06-05 as part of the Workstream C block (see §24 preamble). The statements below are verbatim from AMD-62 §5.

### AMD-62-INV-01: Retry Schedule Is a Pure Function

The retry schedule is a pure function of `BackoffParameters` and the attempt count — deterministic, no hidden state.

### AMD-62-INV-02: Retry Backoff and Recovery Probing Are Distinct Mechanisms

Retry backoff (`BackoffParameters`) and recovery probing (`HealthParameters.probe*`) are distinct mechanisms; neither reuses the other's parameters.

---

## 33. IsolationLevel Reservation (AMD-63)

§33 registers the invariant category added by AMD-63, RATIFIED 2026-06-05 as part of the Workstream C block (see §24 preamble). The statement below is verbatim from AMD-63 §5.

### AMD-63-INV-01: `RESERVED_SUBPROCESS` Rejected Until Activated by Amendment

`RESERVED_SUBPROCESS` is rejected at supervisor startup until a future amendment activates it; no code path may treat it as runnable.

---

## 34. Per-Descriptor Planned-Restart Timeout (AMD-64)

§34 closes the Workstream C block (see §24 preamble), registering the invariant category added by AMD-64, RATIFIED 2026-06-05. The statement below is verbatim from AMD-64 §5.

### AMD-64-INV-01: Null ⇒ Global Default; Present Value Positive and Fully Replacing

`plannedRestartTimeout == null` ⇒ the global Doc 05 §3.14 default governs; a present value must be positive and fully replaces (never combines with) the global.

---

## 35. INV-PD-07 Crypto-Shred MVP-Scope Narrow + INV-PD-03 At-Rest Posture (AMD-86)

§35 registers the invariant category added by **AMD-86** (INV-PD-07 Crypto-Shred MVP-Scope Narrowing + INV-PD-03 At-Rest Posture), **RATIFIED 2026-06-07** — registered here (plus §0.3, the §17 Invariant Index, and the §18 Traceability Matrix) at ratification, following the §20–§34 precedent. AMD-86 also (a) narrows INV-PD-07's MVP-scope clause (§6 — operational crypto-shredding deferred to its first cloud/institutional consumer per decision D2; the per-scope key infrastructure, scope categories, and `scope_keys` schema seam stay MVP) and (b) appends the INV-PD-03 at-rest posture note (§6 — partial MVP satisfaction: machine-local root; user-owned-key + media-theft resistance = Tier-2). Owner doc: **Doc 15 — Cryptographic Architecture** (Locked 2026-06-07). The MVP at-rest encryption + key-management infrastructure is implemented by **M6**; the crypto-shred *operation* is post-MVP. Full DOCS review return: `nexsys-hivemind/context/audits/2026-06-06_Doc15_AMD-86_DOCS_Review_Return.md`. The statement below is verbatim from AMD-86 §6.

### AMD-86-INV-01: Encrypt-on-Write Is Irreversible; the Shred Operation Is Deferrable

*Encrypt-on-write is irreversible; the shred operation is deferrable.* A category is crypto-shreddable only if written encrypted-per-scope; therefore the encrypt-on-write decision for the sensitive-PII categories is made at MVP and the operation that consumes those keys may land later. **[BLOCKING-for-M6-impl] corollary (Doc 15 §6/§13.4):** the per-scope GCM counter-nonce must be durable and strictly monotonic across crash AND restore, or (key, nonce) reuse breaks AES-GCM confidentiality *and* authentication for that scope — carried as an explicit M6 Open Risk (pm-handoff). **[RESOLVED 2026-06-19]** The **crash-half** is discharged by M6.3 (durable, fsync-ahead-of-return counter; re-init from persisted max). The **restore-half** is discharged by **AMD-94-INV-01 (§48)** — rotate-DEK-on-restore (additive new DEK version, retain priors) + the fail-closed boot invariant (restore ⇒ install a fresh DEK version). **OR-M6-NONCE → CLOSED.**

---

## 36. `Expectation` Persisted Sealed-Type Codec (AMD-87)

§36 registers the invariant category added by **AMD-87** (`Expectation` Persisted Sealed-Type Codec), **RATIFIED 2026-06-07** (lightweight P4 block-track) — registered here (plus §0.3, the §17 Invariant Index, and the §18 Traceability Matrix) at ratification, following the §20–§35 precedent. AMD-87 adds a hand-rolled `Expectation` (de)serializer in `core/persistence` (tagged-union `{"t":…}`, exhaustive no-`default` switch over the 4 permits, AMD-52 bit-anchored-float discipline for `WithinTolerance`) so a command-bearing `CapabilityAdded` round-trips; the only JPMS change is `persistence requires com.homesynapse.device` (verified acyclic — device requires value/event/platform only). Reassigned from the retired AMD-65 per the P2 renumbering decision. Implemented by **M5-A Part 2** (un-gated 2026-06-07). Lightweight DOCS review return: `nexsys-hivemind/context/audits/2026-06-06_AMD-87_DOCS_Review_Return.md`. The statement below is verbatim from AMD-87 §4.

### AMD-87-INV-01: Every `Expectation` Permit Round-Trips Losslessly

Every `Expectation` permit round-trips losslessly through `EventPayloadCodec`; `WithinTolerance`'s two doubles use the AMD-52 bit-anchored-float / non-finite-sentinel determinism (so a tolerance of `0.1` or a `NaN` sentinel survives encode→decode bit-identically). Cites: AMD-52 (float determinism), AMD-59-INV-02 (`CapabilityAdded` carries the full instance), the `NO_JACKSON_IN_DOMAIN_MODEL` rule.

---

## 37. `ConfigurationChangeListener` — Per-Section Reload Reaction (AMD-66)

§37 opens the five-section M6 configuration block (§37–§41), registered together at the block ratification of AMD-66..71 (66/67/68/70/71 **RATIFIED 2026-06-09** — single DOCS-Project review return, nexsys-hivemind `context/audits/2026-06-09_AMD-66-71_DOCS_Review_Return.md`; block verdict RATIFY-WITH-EDITS, all seven edits E67-1/2, E68-1, E70-1/2, E71-1/2 folded at docs `aedff55`), following the §24-block precedent: each section registered here (plus §0.3, the §17 Invariant Index, and the §18 Traceability Matrix) in the same commit. **AMD-69 is DEFERRED (Nick confirmed Option (a) at this ratification) — it registers no invariant; the number stays reserved for the Tier-2/OQ-15-3 passphrase-root-KDF amendment.** All six numbers sit below the AMD-87 watermark in the reserved range — ratification fills reserved slots, it does not raise the ceiling. Contracts are registered at ratification; **M6.1** (config pipeline) implements the listener interface and registration, **M6.4** (hot-reload atomic swap) exercises it under the swap. Identifiers use the amendment-scoped `AMD-NN-INV-NN` form. Each AMD remains the implementing-policy source-of-truth. The statements below are verbatim from AMD-66 §7.

### AMD-66-INV-01: Listeners Classify; They Never Mutate the `ConfigModel`

A `ConfigurationChangeListener` classifies a section change and is forbidden from mutating the `ConfigModel` (INV-CE-01 — the YAML file is the sole source of truth).

### AMD-66-INV-02: Classification Is Synchronous, Before the Reload Event Publishes

Classification is synchronous and completes before the reload observability event is published (Doc 06 §3.3 ordering).

---

## 38. Config-Document Schema Versioning `(major, minor)` (AMD-67)

§38 registers the invariant category added by AMD-67, RATIFIED 2026-06-09 as part of the M6 config block (see §37 preamble). Implementing WU: **M6.1** (config pipeline — loader/migrator). The statements below are verbatim from AMD-67 §7.

### AMD-67-INV-01: System-Config and Adapter-Config Schemas Are Distinct Surfaces

The system config-document schema `(configSchemaMajor, configSchemaMinor)` and the adapter-config schema `(IntegrationDescriptor.configSchemaMajor, …Minor)` are **distinct compatibility surfaces**; no code path derives one from the other.

### AMD-67-INV-02: Major Triggers Migration, Minor Never (System-Config Surface)

A minor-only config-document mismatch never triggers migration; a major mismatch always does (adopted from AMD-54-INV-02 for the system-config surface).

---

## 39. `SecretStore` Atomic Multi-Key Durable Write (AMD-68)

§39 registers the invariant category added by AMD-68 (the Doc 06 `SecretStore.setAll(Map)` currency amendment required by Locked Doc 15 §7.3), RATIFIED 2026-06-09 as part of the M6 config block (see §37 preamble). Implementing WU: **M6.2** (secret store + per-scope key-management; the interface addition may freeze at M6.1). The statement below is verbatim from AMD-68 §7.

### AMD-68-INV-01: `setAll(Map)` Is All-or-Nothing and Durable-Before-Return

`SecretStore.setAll(Map)` is all-or-nothing and durable-before-return — it is the store-layer guarantee beneath AMD-60-INV-03; a multi-secret set can never be torn by a crash.

---

## 40. Configuration Observability Events (AMD-70)

§40 registers the invariant category added by AMD-70 (`config.validation_completed` + `config.section_reloaded`), RATIFIED 2026-06-09 as part of the M6 config block (see §37 preamble; the review's load-bearing E70-1 fold — event payloads flattened to event-resident/`java.base` types under the type-residency rule, avoiding the `event→config` JPMS cycle — is part of the ratified text). Implementing WU: **M6.1** (`config.validation_completed`); **M6.4** publishes `config.section_reloaded` and must re-run the P2 consumer/pin survey for it. The statement below is verbatim from AMD-70 §7.

### AMD-70-INV-01: Config Events Are Observability-Only

`config.validation_completed` and `config.section_reloaded` are observability-only — no state projection consumes them; the config file remains the sole source of truth (INV-CE-01).

---

## 41. Hybrid Configuration Directory Layout (AMD-71)

§41 closes the M6 config block, registering the invariant category added by AMD-71 (hybrid layout rooted at `PlatformPaths.configDir()`, resolved via composition-root `Path` injection per the [AMD-71-A]/E71-2 ruling — no `config → platform` edge), RATIFIED 2026-06-09 (see §37 preamble). Implementing WU: **M6.1** (config pipeline — layout, one-level include, traversal guard). The statements below are verbatim from AMD-71 §7.

### AMD-71-INV-01: The Loader Reads Only Within the Canonicalized Config Tree

The configuration loader reads only files contained within `PlatformPaths.configDir()` after canonicalization; an `!include` escaping the config tree is rejected fail-closed (no path-traversal read).

### AMD-71-INV-02: `!include` Is One Level Deep

`!include` is one level deep; a nested include is a structural FATAL error.

### AMD-88-INV-01: Promotions Are Field-Additions Only
A Tier-2→Tier-1 promotion is a field-addition to an existing permit — it never adds, removes, or renames a sealed permit. Sealed-exhaustiveness switch shape changes ONLY when a genuinely-new permit lands.

### AMD-88-INV-02: Stable Trigger Identity on User-Facing Surfaces
Every Tier-1 `TriggerDefinition` permit carries a `triggerId` that is stable across definition reloads once assigned; user-facing trace and event surfaces reference triggers by `triggerId`, never by raw index.

### AMD-89-INV-01: PRIMARY-Only Default for Group-Resolving Selectors
Group-resolving selectors (`AreaSelector`, `LabelSelector`, `TypeSelector`, `SemanticTagSelector`) resolve PRIMARY-role entities only unless the definition explicitly opts into DIAGNOSTIC/CONFIG via `includedRoles`. Explicit single-entity selectors are never role-filtered.

### AMD-90-INV-01: Confirmation Never Blocks Runs and Never Retries
Command confirmation is a per-action policy that never blocks Run completion and never triggers engine-level retry; at no policy value does the engine re-issue a command autonomously.

### AMD-90-INV-02: Iteration Constructs Are Hard-Bounded
Every iteration construct is hard-bounded (`maxIterations` ceiling enforced independent of mode); unbounded loops are unrepresentable in the action vocabulary.

### AMD-91-INV-01: Deterministic Cycle Suppression
Cascade-cycle suppression is a deterministic function of the Run's causal chain and configuration alone — no windowed, evictable, or restart-sensitive state participates in a suppression decision (INV-TO-02 corollary; INV-PR-03 boundedness preserved via the depth ceiling). Cross-event-hop chain reconstruction reads the immutable event log or the in-process parent `RunContext` — never the windowed Doc 01 §4.5 correlation map.

### AMD-91-INV-02: `RunCausalChain` Never Crosses the Event Boundary Unflattened
`RunCausalChain` is automation-internal — it never crosses the event boundary unflattened (AMD-92-INV-01's specific instance for this type).

### AMD-92-INV-01: No Automation-Resident Types in Event Payloads
Event records in `com.homesynapse.event` never reference automation-resident types; run/status identifiers cross the event boundary only as flattened `Ulid`/`String` components (the E70-1 rule, automation instance).

### AMD-92-INV-02: Full Manifest Registration Before First Publish
No automation event type reaches a production publish site before appearing in EVERY manifest/pin the P2 survey enumerates for its slice (the M4.C forcing-function, stated as invariant).

### AMD-93-INV-01: Forward-Only, Non-Destructive Definition Migrations
Automation-definition migrations are forward-only and idempotent, always preceded by a backup, and never destructively rewrite or drop a user definition — unconvertible definitions are excluded-and-reported, not modified (REC-151 structural).

### AMD-93-INV-02: Fully-Resolvable References at Load Time
Every loaded automation definition has fully-resolvable references at load time (post-tombstone-redirect); a definition with dangling references never enters the registry.

---

## 48. Rotate-DEK-on-Restore + Envelope Version Discriminator (AMD-94)

§48 registers the invariant category added by **AMD-94** (Doc 15 §6 currency amendment — rotate-DEK-on-restore binding + the 1-byte envelope version discriminator), **RATIFIED 2026-06-19** (FULL per-AMD track — persisted shape + crypto behavioral contract + new invariants; `constraint-enforcement.md §6`) — registered here (plus §0.3, the §17 Invariant Index, and the §18 Traceability Matrix) at ratification, following the §20–§47 precedent. Owner doc: **Doc 15 — Cryptographic Architecture** (Locked 2026-06-07; AMD-94 folded 2026-06-19 into §3.4/§4.1/§5/§6/§13.4/§16/§8.1). AMD-94-INV-01 **discharges the AMD-86-INV-01 (§35) `[BLOCKING-for-M6-impl]` restore-half corollary** → **OR-M6-NONCE CLOSED**. Independent DOCS review return: `nexsys-hivemind/context/audits/2026-06-19_AMD-94_DOCS_Review_Return.md` (RATIFY-WITH-EDITS; **E-1** boot-invariant restore⇒rotation-only sharpening + **E-2** encoding-neutral discriminator folded; the §8.1 `ScopeKeyManager` currency rider kept). Implemented by the future backup/restore WU (rotate-on-restore mechanics, §2.1) + app-bootstrap **AB-2** (the boot invariant on the read/write path) / **AB-4** (emits `v1` on the first encrypted write). The statements below are AMD-94 §7 as corrected by the ratified review edits (E-1/E-2).

### AMD-94-INV-01: Rotate-on-Restore Prevents Cross-Restore Nonce Reuse

On restore, a scope resumes encryption only under a freshly-installed **additive** DEK version (priors retained, never replaced; payloads never re-encrypted; version monotonicity across successive/concurrent restores enforced by the `scope_keys` PRIMARY KEY `(scope_id, key_version)`); carry-high-water-mark is a defense-in-depth cross-check, never the sole guarantee. A restored scope therefore never resumes counting under an already-used DEK version → (key, nonce) reuse is structurally impossible across restore. The boot invariant is **fail-closed**: **after a restore it is discharged only by installing a fresh DEK version** — rotation is the restore-completion gate, because a restore can roll the persisted counter back below an already-issued nonce and erase the engine's evidence of the true high-water mark, so the restored counter is not proof of safety. The alternative discharge — resume only when the persisted counter is **proven ≥ all prior nonces issued under the active DEK version** — is the **crash-recovery** branch, sound only because the M6.3 durable, fsync-ahead-of-return counter makes the persisted max equal the true max after a crash. Discharges the AMD-86-INV-01 (§35) restore-half corollary; closes OR-M6-NONCE restore-half.

### AMD-94-INV-02: Encrypted At-Rest Rows Are Self-Describing

Every encrypted at-rest row carries a 1-byte algorithm/version discriminator; `v1` = the Doc 15 §3.4 envelope (AES-256-GCM, 96-bit counter nonce, per-scope DEK), distinct from `dek_ref`'s `key_version`. The slot exists from the first encrypted write so the AEAD may evolve without rewriting the immutable, chain-covered corpus — emitted as an envelope prefix (recommended, chain-covered) or an additive column (not chain-covered today; only the canonical metadata + `payload` are chained); final placement and version *policy* (registry, downgrade rules, AAD binding) are R-γ-pending, slot *existence* is this invariant.


---

## 49. Superior Automation Layer (Doc 16)

§49 registers the **INV-SA** invariant category introduced by **Doc 16 — Superior Automation Layer** (the three first-class surfaces: expressiveness-without-a-DSL · explainability/causal-chain · run-coupled reliability), **Locked 2026-06-20**. Registered here (plus §0.3, the §17 Invariant Index, and the §18 Traceability Matrix) at the Doc 16 Lock, following the §19 subsystem-category precedent (BUS/PROJ/WRITER/SUB-ISO) — a **new design-doc Lock, not an amendment**, so it mints a subsystem category at its own Lock the way the foundational docs did and **the on-disk amendment watermark stays AMD-94** (the drift discriminators are the invariant count, 165→169, and the Locked-doc set). Owner doc: **Doc 16** (Locked 2026-06-20). Independent DOCS review return: `nexsys-hivemind/context/audits/2026-06-20_Doc16_independent_DOCS_Review_Return.md` (SCOPE = RIGHT; DOCUMENT = RATIFY-WITH-EDITS, all NON-BLOCKING; E1/E2/E4/E5/E6/E7 + S1/S2 folded; §7.2 source cross-check re-run at core `60d50ce` → M7.1-UNAFFECTED holds). **INV-SA-01/02 are novel** (no existing invariant covers the no-runtime-DSL anti-requirement-as-invariant or scope-reservability — registered first-class); **INV-SA-03/04 are citing compositions** that each add a constraint their parents do not impose and cite those parents. This layer adds **no sealed permit and no event type**; built by **M7.2a/M7.2b** (the run/action/dispatch engine that builds into Doc 16).

### INV-SA-01: Expressiveness Expands Only Into the Sealed Model

Every automation component and computed value resolves at load time to instances of the existing sealed `TriggerDefinition` / `ConditionDefinition` / `ActionDefinition` permits; no runtime template, expression-string, or scripting engine exists in the automation path. Expressiveness grows only by expansion into the sealed model — never via a parallel evaluation surface — so the no-DSL anti-requirement (AMD-88 §6 / REC-155) is structural and the statically-analyzable substrate the linter and dry-run surfaces depend on is preserved. *(Novel — the no-DSL anti-requirement as an invariant; Doc 16 §3.2, §5.3.)*

### INV-SA-02: Federation Non-Preclusion

No persisted identity is site-local-sequential (identities are globally unique by construction — typed ULIDs, LTD-04), and scope is an additive, absent-defaults-to-local discriminator reserved at the envelope/metadata level. Federating a single-site install therefore never requires migrating the immutable event log. Materializing the reserved `ScopeRef` later is itself a formal AMD (an envelope-shape change through the pipeline, even though additive) and must be confirmed compatible with the AMD-94 envelope-version slot it mirrors. *(Novel — no existing invariant covers scope-reservability; Doc 16 §3.5, §5.3; S2.)*

### INV-SA-03: Explanation Is a Pure Projection of the Log

Every `RunExplanation` / `NonFiringExplanation` / `AuditRecord` is reconstructable solely from persisted events plus `RunCausalChain`; no explanation depends on state not in the log, and no parallel trace store exists. *(Citing composition of **INV-ES-06** (every state change is explainable) + **INV-ES-01** (events are immutable facts) + **INV-TO-03** (no hidden state) — strengthens them with the "no parallel trace store" guarantee the parents permit but do not require; Doc 16 §3.3, §5.2, §5.3.)*

### INV-SA-04: Running Automations Degrade Deterministically

A Run under partial failure reaches a deterministic terminal `RunStatus` with a recorded, machine-readable reason and an emitted event; the engine never autonomously re-issues a command. *(Citing composition of **INV-RF-06** (graceful degradation under partial failure) + **INV-TO-02** (automation determinism) + **AMD-90-INV-01** (confirmation never blocks/retries) — strengthens them with the required recorded terminal reason the parents do not mandate; Doc 16 §3.4, §5.2, §5.3. Honors the D2/REC-162 no-engine-retry anti-requirement — deferred, not pre-empted.)*

---

*This document is a foundational governance artifact of the HomeSynapse project. It is governed by the amendment process defined in §15 and will be referenced by all subsystem design documents produced during Phase 1.*