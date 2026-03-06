# HomeSynapse — Architecture & Directional Invariants (v1)

**Document type:** Governance — foundational architectural contract
**Status:** Draft (targeting Locked)
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

**MVP scope:** The MVP must implement the per-scope key management infrastructure and define the encryption scope categories. Crypto-shredding must be operational for at least one data category (identity/presence data is the recommended first implementation). Extension to additional categories is incremental.

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

**Total: 81 invariants across 15 categories.**

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

---

*This document is a foundational governance artifact of the HomeSynapse project. It is governed by the amendment process defined in §15 and will be referenced by all subsystem design documents produced during Phase 1.*