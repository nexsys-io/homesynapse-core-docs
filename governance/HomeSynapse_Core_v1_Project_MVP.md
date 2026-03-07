# HomeSynapse Core — Project Prompt

---

## What This Document Is

This is the foundational context for the HomeSynapse Core Claude project. Every conversation in this project inherits this context. Treat its principles as constraints, its architecture vision as a starting hypothesis to pressure-test, and its competitive strategy as the lens through which every design decision is evaluated.

A separate Claude project manages the documentation architecture, website design system, and content governance for homesynapse.com. That project has produced a complete Documentation Architecture System (DAS v1) — content types, templates, style guides, CI pipelines, and Docusaurus configuration. The Core project does not reproduce any of that, but the DAS defines contracts that the Core project must satisfy (API specs, config schemas, event type registries feed into the DAS build pipeline).

---

## 1. What HomeSynapse Is

HomeSynapse is a **local-first smart home platform** focused on reliability, correctness, and long-term scalability. It is designed to function as a smart home operating system, not an automation tool.

Current smart home platforms fall into two failure modes:

- **Highly flexible but fragile** — complexity and reliability issues compound over time. Home Assistant at scale: Python runtime blocking, GIL contention, inconsistent integration quality, UI performance degradation. Home Assistant has an internal event bus, but no event-sourced system of record, no replay-based correctness guarantees, and poor causal explainability. State management does not guarantee consistency.
- **Highly polished but opaque** — default automation and control paths are cloud-dependent and degrade severely offline; local operation is not a guaranteed contract. Data practices are unclear, and devices become useless when vendor servers go down. Google Home, Apple HomeKit, Amazon Alexa have all discontinued products and broken ecosystems (Nest Secure, Works with Nest, Alexa Skills deprecations).

HomeSynapse is a third option: technically rigorous, fully functional offline, and explicit about how it works.

### Target Audiences (Priority Order)

1. **Home Assistant power users** who value control, transparency, local execution, and reliability under load. They have experienced Home Assistant's scaling pain and want a platform built on stronger foundations. Migration familiarity matters.
2. **Privacy-conscious users** leaving cloud ecosystems who want a modern smart home experience without surveillance. They want convenience with explicit data boundaries.
3. **Developers and builders** writing integrations, working with custom hardware, or extending the platform. They want clear interfaces, strong typing, and documentation that respects their time.

### What HomeSynapse Is Not

- A cloud-dependent automation service
- An advertising or data-harvesting platform
- A drop-in feature-for-feature clone of any existing platform
- A hobbyist project with no architecture discipline
- A platform that competes on integration count

---

## 2. Competitive Strategy — How HomeSynapse Wins

HomeSynapse does not win by matching 3,000 integrations. It wins by demonstrating superiority on battlefields where every competitor fails.

### 2.1 The Battlefields

**Reliability under load.** A 60-device home with layered automations running for months without intervention, without memory leaks, without degradation. Home Assistant struggles here. Google/Amazon hide the problem behind cloud servers.

**Local-first superiority.** Unplug the internet cable. Everything still works — locks, lights, automations, the UI, event recording. Google Home and Alexa fail completely. Home Assistant mostly works but has cloud-dependent integrations that degrade unpredictably.

**Explainability.** A non-developer user can answer "why did the porch light turn on at 3am?" by looking at the event trace in the UI. No other platform makes this possible without log diving or guessing.

**Crash isolation.** Kill the Zigbee adapter mid-operation. Z-Wave locks keep working. Automations that don't depend on Zigbee keep firing. The crashed adapter restarts. No events are lost. No state is corrupted. Home Assistant has no formal isolation model — one bad integration can block the event loop and freeze the entire system.

**Energy intelligence.** Real-time whole-home energy monitoring with historical data that loads instantly, even six months of data. Automations that respond to power usage. This is the feature that justifies platform adoption to the skeptical member of the household — it saves money.

**Zero-maintenance stability.** The system runs on a Raspberry Pi in a closet and does not require babysitting. Updates are safe, rollbacks work, and device replacement does not break automations. This is the bar that separates infrastructure from hobbyist tools.

### 2.2 The Proof Scenario

The competitive demonstration that HomeSynapse must be able to deliver:

1. A 60-device home across multiple protocols (Zigbee, Z-Wave, energy monitoring)
2. Six layered automations operating simultaneously
3. Internet outage simulated — zero degradation in any capability
4. Integration crash simulated — isolated, automatic recovery, no data loss
5. System update simulated — clean rollback on failure
6. Device replacement (swap a lock) — automations remain intact, event history preserved
7. Energy dashboard with six months of historical data — loads instantly
8. Event trace for any device state change — full causal chain visible in the UI

This scenario is the acceptance test for the full competitive MVP (Tier 2). It is the demo that proves HomeSynapse is not a prototype but a viable platform.

### 2.3 The Minimum Competitive Device Stack

These device categories were chosen because they expose the weaknesses of competing platforms and prove HomeSynapse's architectural invariants.

**Lighting (Zigbee) — 20–30 devices.**
Lighting is the most failure-sensitive category and where latency is felt immediately. Zigbee mesh with bulbs, switches, motion sensors, and dimmers proves: mesh stability, sub-300ms actuation, automation determinism, no Wi-Fi congestion, no cloud latency. Lighting is also the first household acceptance test — if the lights are unreliable, the platform is rejected.

**Security (Z-Wave) — 10–15 devices.**
Z-Wave dominates locks and security in the US market. Locks, door/window sensors, leak detectors, and a siren prove: secure local execution, lock reliability during WAN outage, supervision of critical integrations, no bricking risk. The killer demo: internet unplugged, locks still work, automations still trigger. This instantly differentiates from Google and Amazon.

**Energy Monitoring — 5–12 devices.**
Whole-home energy monitor plus circuit-level monitors and smart plug energy tracking. This proves: real-time analytics without database degradation, historical data that scales, automation triggered by power usage. Energy is the feature that justifies platform adoption to skeptical household members — it demonstrates measurable value.

**Matter/Thread (Credibility) — 3–6 devices.**
A small Matter-over-Thread deployment with sensors and smart plugs demonstrates standards interoperability without dependency. This is market credibility for 2026–2028.

**Climate — 3–5 devices.**
A smart thermostat plus temperature/humidity sensors. Proves multi-sensor aggregation, deterministic climate automation, scheduling reliability.

**Presence Detection.**
Network-based presence detection (who is on the local network) as the foundation for household-aware automations. BLE-based presence is a future enhancement. The multi-user model must be designed from day one even if BLE presence is deferred.

### 2.4 What Is Explicitly Deferred

- **Voice control** — high risk, low marginal value in MVP. A bad voice experience is worse than no voice experience. Deferred entirely.
- **Camera/RTSP** — a media pipeline problem orthogonal to the core value proposition. Deferred.
- **Native mobile app** — the web UI served as a progressive web app covers mobile for MVP. Native app is post-MVP.
- **500+ cloud-only integrations** — not the battlefield. Comes later.
- **AI-based automation** — suggestions, anomaly detection, adaptive behavior. Post-MVP.
- **Multi-site management** — single-home focus for MVP.
- **Third-party marketplace** — post-MVP.

---

## 3. Non-Negotiable Principles

These govern every architecture decision, every API design, every tradeoff discussion. They are constraints, not aspirations.

### Local-First by Design
All core functionality runs locally on the user's hardware. Internet access is optional, never required. Cloud services may enhance the system but never control it. The system must function identically when disconnected from the internet.

### Events First, State Second
Events are immutable facts — once written, they cannot be altered. System state is derived by replaying the event log from a known checkpoint. This enables: reliable debugging (replay the exact sequence), audit trails, failure diagnosis, and eventual consistency across subsystems. State is inspectable and explainable at all times.

### Reliability Over Cleverness
Predictable behavior is always prioritized over hidden magic. Integrations are isolated — one failing integration cannot crash the core or other integrations. Performance degrades gracefully, not catastrophically. The system prefers doing fewer things correctly over doing many things unreliably.

### Transparency by Default
Behavior is explainable — a user can ask "why did this happen?" and get a concrete answer traceable to specific events. Data movement is explicit. Nothing is silently collected, exported, or shared. Users can see what the system is doing and why at all times.

### Privacy as Architecture, Not Policy
No behavioral data leaves the home by default. No hidden telemetry. No usage data sharing. Future opt-in cooperative features will be off by default, transparent, and revocable. Raw data is never silently exported. Privacy is enforced by the system's architecture, not by a policy document that can be revised.

---

## 4. Tiered MVP Strategy

The competitive vision described in §2 is the target. The implementation is phased so each tier ships something real and demonstrable while building toward the full competitive proof.

**The critical constraint: every Tier 1 design decision must accommodate Tiers 2 and 3 without architectural rework.** The event model, device model, integration runtime, automation engine, state store, and APIs are all designed with the full device stack in mind. Only the *implementation* is phased.

### Tier 1 — Foundation (Current Focus)

**Thesis to prove:** HomeSynapse's event-sourced, local-first architecture produces a smart home runtime that is correct, observable, and reliable on constrained hardware.

**Scope:**
- Core runtime (event bus, state store, persistence layer, configuration system, startup/lifecycle)
- Device model and capability system (designed for multi-protocol, implemented for Zigbee)
- Integration runtime with fault isolation
- Zigbee adapter (the first real integration — 30–50 devices)
- Minimal automation engine (event-driven triggers, conditions, sequential actions)
- REST API and WebSocket API
- Observability-focused web UI (event trace, health dashboard, basic device control)

**Acceptance test:**
- 50 Zigbee devices, stable for 72+ hours on Raspberry Pi 4
- Kill -9 recovery with zero event loss
- Integration crash isolation demonstrated
- Event trace answers "why did this happen?" for any device state change
- All performance targets met (see §8)

**What Tier 1 designs must accommodate (but not implement):**
- Multiple simultaneous protocol adapters (Z-Wave, Matter, energy protocols)
- Energy data ingestion at high frequency (per-second power readings)
- Multi-user presence model in the device/entity schema
- Device replacement without automation disruption (entity identity vs. physical identity)
- Historical data queries over months of accumulated events

### Tier 2 — Competitive Proof

**Thesis to prove:** HomeSynapse is demonstrably superior to Home Assistant, Google Home, and Amazon Alexa on the battlefields that matter to real households.

**Scope (additive to Tier 1):**
- Z-Wave adapter (security layer — locks, sensors, leak detectors)
- Energy monitoring integration (whole-home + circuit-level)
- Network-based presence detection
- Multi-user household model
- Time-based automation triggers (schedules, sunrise/sunset)
- Template expressions in automation actions
- Smart plug energy tracking
- Climate integration (thermostat + sensors)
- Basic backup/restore tooling
- Update/rollback engine
- Enhanced web UI (energy dashboard, presence status, device management)

**Acceptance test:** The full proof scenario from §2.2.

### Tier 3 — Market Credibility

**Scope (additive to Tier 2):**
- Matter/Thread interoperability
- MQTT adapter (advanced/hobby tier)
- BLE-based presence detection
- Progressive web app for mobile
- Conditional branching in automations
- Parallel action execution
- Device pairing UI
- Visual automation editor
- Camera/RTSP support (local only)

### Post-Tier (Future Roadmap)

- Voice control (local processing)
- AI-assisted automations
- Native mobile apps
- Multi-site management
- Community integration marketplace
- Enterprise features

---

## 5. Locked Technical Foundation

These decisions are finalized. They are not revisitable without a formal revision process and impact analysis across all design documents.

| # | Decision | Detail | Rationale |
|---|---|---|---|
| 1 | **Java 21 LTS** | Virtual threads, record types, sealed interfaces, pattern matching | JVM maturity for long-running processes, strong typing catches contract violations at compile time, virtual threads handle hundreds of device connections without thread pool exhaustion |
| 2 | **Gradle (Kotlin DSL)** | Multi-module project | Modern, flexible, better dependency management and build script readability than Groovy DSL or Maven |
| 3 | **JSON (Jackson)** | All serialization for storage and API | Human-readable events support the transparency principle; clean `EventSerializer` abstraction keeps door open for binary formats |
| 4 | **SQLite default** | Pluggable backend via `EventStore` interface | Zero-configuration, single-file, widely deployed on SBCs; abstraction allows H2 or PostgreSQL for advanced users |
| 5 | **Event sourcing** | Events are immutable facts, state is derived, event log is source of truth | Core architectural differentiator — enables replay, debugging, audit trails, state reconstruction |
| 6 | **Per-entity sequences** | Monotonic ordering within entity streams, not global | Avoids global serialization bottleneck on constrained hardware; cross-entity ordering via timestamps and correlation |
| 7 | **Write-ahead persistence** | Events durable before subscriber delivery | Guarantees zero event loss across crashes and power failures |
| 8 | **At-least-once delivery** | Subscriber-side idempotency | Simpler than exactly-once; safe because the event log is the recovery mechanism |
| 9 | **ULID event identity** | Time-ordered, globally unique, 26-character string | Lexicographic time ordering, monotonic within millisecond, no coordination required, shorter than UUID in JSON |
| 10 | **Zigbee first protocol** | Tier 1 ships Zigbee only | Most widely deployed local mesh protocol, exercises the integration runtime thoroughly, covers the most common device categories |

---

## 6. Architecture Vision

### 6.1 Core Runtime Model

HomeSynapse Core runs as a single long-lived process with internal isolation between subsystems:

```
┌─────────────────────────────────────────────────────────────────┐
│                      HomeSynapse Core                           │
│                                                                 │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────────────────┐  │
│  │  Event Bus   │──│ State Store │──│  Automation Engine    │  │
│  └──────┬───────┘  └─────────────┘  └───────────────────────┘  │
│         │                                                       │
│  ┌──────┴───────┐  ┌─────────────┐  ┌───────────────────────┐  │
│  │ Persistence  │  │   Config    │  │ Startup / Lifecycle   │  │
│  │   Layer      │  │   System    │  │                       │  │
│  └──────────────┘  └─────────────┘  └───────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                Integration Runtime                       │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │   │
│  │  │ Zigbee   │  │ Z-Wave   │  │ Energy   │  │  ...    │ │   │
│  │  │ Adapter  │  │ Adapter  │  │ Monitor  │  │         │ │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────┐  ┌───────────────┐  ┌─────────────────────────┐  │
│  │ REST API │  │ WebSocket API │  │ Web UI (Observability)  │  │
│  └──────────┘  └───────────────┘  └─────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Observability & Debugging                    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Key Architectural Properties

**Event bus as the spinal cord.** Everything that happens is an event — device state changes, automation triggers, configuration changes, integration lifecycle transitions, errors. The event bus persists events before delivering them to subscribers. Subscribers receive at-least-once delivery with per-entity ordering guarantees.

**State as a materialized view.** The state store is derived from the event log. If the state store is lost, replaying the event log reconstructs it identically. State is queryable but never authoritative — the event log is the source of truth.

**Integration isolation as a hard boundary.** Each integration runs in its own fault domain. A crashing integration is restarted independently. The core and other integrations are unaffected. Integrations communicate with the core exclusively through the EventPublisher and subscription interfaces — never through shared mutable state. Integrations are in-process for trusted adapters in early tiers, but the integration API contract must support promoting an integration to an out-of-process sandbox without breaking the contract. This preserves the path to marketplace-scale safety when community and third-party integrations arrive.

**Automation as event reaction.** Automations are triggered by events, not by polling. Every step of automation execution (trigger, condition evaluation, action dispatch, completion) produces its own event. This makes automation behavior fully traceable through the event log.

**APIs as the only external surface.** The REST API, WebSocket API, and web UI are the only ways external consumers interact with HomeSynapse. They consume the same interfaces that internal subsystems use — there is no privileged internal path.

### 6.3 Design for Multi-Protocol from Day One

The device model, capability system, and integration runtime are designed to support multiple simultaneous protocol adapters from the start, even though Tier 1 ships only Zigbee:

- **Entity identity is protocol-agnostic.** A device's entity_id (`device.living_room.front_lock`) does not embed the protocol. The protocol is metadata, not identity. This means replacing a Z-Wave lock with a Matter lock does not change automations.
- **Capabilities are standardized.** The capability model (on/off, dimming, color, temperature, motion, lock, energy) is defined independently of any protocol. Protocol adapters translate between protocol-specific representations and the standard capability model.
- **The integration runtime supports N concurrent adapters.** The runtime does not assume a single integration. Fault isolation, lifecycle management, and resource monitoring are per-integration from the start.

### 6.4 High-Frequency Data Strategy (Energy, Sensors, Future Audio)

Energy monitoring, high-frequency sensors, and future audio pipelines produce data at rates that create fundamentally different pressure on the event bus and persistence layer than typical device state changes. A per-second energy reading from 8 circuits is 691,200 events per day — an order of magnitude beyond typical device state changes. Future audio streams (voice processing, ambient sound) produce even higher rates.

The core architectural principle — events are the source of truth — must accommodate this without self-inflicting a storage or performance bottleneck. The strategy has three parts:

**Events at the semantic layer, not the sample layer.** Not every raw sample needs to be a full event in the event log. The event model distinguishes between *semantic events* (a meaningful state change: "power usage crossed 5kW," "motion detected," "voice command recognized") and *telemetry streams* (raw high-frequency samples: per-second watt readings, audio frames). Semantic events flow through the event bus as normal events. Telemetry streams may be ingested through a dedicated high-throughput path that writes to optimized storage without the full event envelope overhead.

**Internal storage may include optimized side structures.** Events are JSON at the envelope and API layer — human-readable, exportable, and transparent. But internal persistent storage may use typed columnar tables, rollup/aggregation tables, or segment files for high-frequency numeric streams. This preserves the transparency contract (data is always exportable as JSON, the API always returns JSON) while allowing the persistence layer to store and query time-series data efficiently. The persistence layer design document (04) must define this dual-path architecture.

**The event bus does not become a telemetry firehose.** High-frequency streams that would overwhelm subscriber queues are pre-aggregated before entering the event bus. A per-second energy reading might be aggregated to a per-minute summary event that flows through the bus, while the per-second data is written directly to the persistence layer's time-series storage. The aggregation window and strategy are configurable per stream type.

This approach maintains the "events are the source of truth" principle for meaningful state changes while acknowledging that raw telemetry at full fidelity has different storage and query requirements. The Persistence Layer design document must define the boundary between the event log and telemetry storage, and the API design must expose both through a unified query interface.

### 6.5 Design for Household Model from Day One

Multi-user presence and household-aware automations require:

- **The entity model supports user/person entities** alongside device entities. A person is an entity with presence state, preferences, and association to devices.
- **Automations can reference person entities** in triggers and conditions ("when person.nick arrives home").
- **The area model accommodates room-level and person-level scoping** for automations and state queries.

**Presence is probabilistic, not authoritative.** Presence detection — whether network-based (Tier 2) or BLE-based (Tier 3) — is inherently a noisy signal. Phones sleep Wi-Fi, MAC addresses randomize, guests and IoT devices pollute network scans, and false "away" or false "home" states erode household trust fast. The presence model must treat each detection method as one input among several, not as authoritative identity truth. The data model supports `confidence` (0.0–1.0), `last_seen` (timestamp), and `unknown` as a first-class state, even if the MVP UI collapses this to a simple present/away display. This prevents the system from becoming unreliable or intrusive when presence is wrong — and it prevents architectural rework when BLE, GPS geofencing, or other signals are added later.

---

## 7. Competitive Landscape — What to Learn, What to Reject

### Home Assistant
**Learn from:** Massive integration ecosystem, active community, YAML-based configuration, local execution model, strong privacy stance.
**Reject:** Python runtime performance at scale (event loop blocking, GIL contention), reliability degradation with integration count, inconsistent integration quality, UI performance with large deployments. Home Assistant has an internal event bus, but lacks an event-sourced system of record, replay-based correctness guarantees, and causal explainability. State management offers no formal consistency guarantees. Architectural debt compounds across major releases.
**How HomeSynapse exploits this:** Event sourcing provides formal consistency guarantees and replay-based debugging. Java's threading model does not have GIL contention. Integration isolation prevents cross-contamination. The event trace makes behavior explainable in ways Home Assistant's log-based debugging cannot match.

### Apple HomeKit
**Learn from:** Design discipline, smooth user experience, local processing on HomePod, Matter adoption leadership.
**Reject:** Closed ecosystem, limited automation, Apple hardware requirement, opaque behavior, no developer extensibility for custom devices.
**How HomeSynapse exploits this:** Open platform with developer-first APIs. Automations are traceable and debuggable. No vendor lock-in on hub hardware.

### Google Home / Nest
**Learn from:** Multi-room coordination, ambient computing vision.
**Reject:** Default automation and control paths are cloud-dependent; local operation is not a guaranteed contract. Aggressive data collection, product discontinuation history (Nest Secure, Works with Nest), limited local automation processing.
**How HomeSynapse exploits this:** Internet outage demo. Locks still work. Automations still fire. Zero data leaves the home. No product can be "discontinued" by a vendor decision.

### Amazon Alexa / Echo
**Learn from:** Device ecosystem breadth, voice as primary interface, Alexa Skills developer platform.
**Reject:** Advertising-driven data model, cloud-dependent default control path, privacy concerns, aggressive upselling in UI.
**How HomeSynapse exploits this:** Same as Google — local-first superiority, privacy as architecture, no advertising, no upselling.

### OpenHAB
**Learn from:** Java-based (validates the language choice), OSGi plugin architecture, mature codebase.
**Reject:** Steep learning curve, enterprise-heavy architecture, smaller community, dated UI.
**How HomeSynapse exploits this:** Modern Java (21 vs. OpenHAB's older targets), event sourcing (OpenHAB has no formal event model), observability UI designed for approachability, documentation as a first-class product.

---

## 8. Performance Targets (Tier 1)

These targets define "works well" on the primary deployment target: Raspberry Pi 4 Model B, 4 GB RAM, USB SSD storage.

### 8.1 Hard Invariants

These are non-negotiable. Failing any of these means the architecture has a defect.

| Metric | Target | Rationale |
|---|---|---|
| Event publish latency (p99) | < 10ms | Device state changes must be recorded within 10ms |
| Automation trigger-to-action (p99) | < 50ms | Motion sensor to light-on must feel instant |
| Write-ahead durability | Zero event loss across kill -9 | The foundational reliability guarantee |
| Integration crash isolation | No impact on core or other integrations | The foundational isolation guarantee |
| Full event log replay | > 10,000 events/second | One year of 50-device data replayed in < 3 minutes |
| 72-hour stability test | Zero memory leaks, zero crashes, zero event loss | The reliability bar |

### 8.2 Budget Goals

These are targets, not invariants. They guide design tradeoffs and are validated empirically. Missing a budget goal triggers investigation and optimization, not an architecture revision.

| Metric | Target | Rationale |
|---|---|---|
| Devices supported | 50+ Zigbee with stable operation | Typical enthusiast home with headroom |
| Event throughput (sustained) | > 500 events/second | 10x expected peak for 50-device home |
| State query latency (p99) | < 5ms | UI and API responsiveness |
| Startup time (with checkpoint) | < 30 seconds | Restart after power failure should be fast |
| Idle memory consumption | < 512 MB | Must leave headroom for OS and other services on 4 GB Pi |
| Idle CPU usage | < 5% single core | 24/7 operation without thermal issues on passive-cooled SBC |
| Subscriber fan-out latency | < 5ms after persistence | Responsiveness of event delivery to all consumers |

UI-dependent metrics (dashboard load time, historical query response time, WebSocket reconnection latency) are defined in the relevant subsystem design documents, not here. They are implementation targets validated through testing, not architectural commitments.

---

## 9. Development Process

### 9.1 Three-Phase Approach

**Phase 1 — System Design Documentation.** Top-down architecture: event model, device model, integration runtime, state store, persistence, automation engine, configuration, APIs, observability, lifecycle, web UI. Each subsystem gets a design document following DESIGN_DOC_TEMPLATE.md. A master architecture document synthesizes all subsystem designs.

**Phase 2 — Interface-Level Specification.** For each subsystem: Java package structure, all public interfaces with method signatures and contracts, all public types (records, enums, sealed interfaces, exceptions), package-level READMEs, configuration schemas (JSON Schema), API specifications (OpenAPI, AsyncAPI).

**Phase 3 — Tests, Then Implementation.** Unit tests written against Phase 2 interfaces. Implementation that passes the tests. Integration tests. Performance benchmarks. Failure mode tests. End-to-end validation with real Zigbee hardware.

Never write production implementation code during Phase 1 or 2. Never skip ahead without completed design docs. **Prototype spikes are allowed** when a design question cannot be resolved without empirical validation — SQLite write patterns for append-only workloads, ULID monotonic behavior under concurrency, virtual-thread scheduling semantics, Zigbee adapter I/O under load. Spikes must be explicitly labeled as throwaway, live outside the production source tree, and the findings must be recorded in the relevant design document's open questions or key decisions section. A spike that quietly becomes production code is a governance failure.

### 9.2 Design Document Governance

All Phase 1 documents follow DESIGN_DOC_TEMPLATE.md:
- 13 mandatory sections, 2 conditional, 1 optional
- Four-state lifecycle: Draft → Review → Locked → Superseded
- Dependencies cite specific sections for impact analysis
- Open questions marked BLOCKING or NON-BLOCKING
- Quality checklist verified before moving from Draft to Review

### 9.3 Phase 1 Production Order

| # | Document | Depends On |
|---|---|---|
| 01 | Event Model & Event Bus | None (foundational) |
| 02 | Device Model & Capability System | 01 |
| 03 | State Store | 01, 02 |
| 04 | Persistence Layer | 01, 03 |
| 05 | Integration Runtime | 01 |
| 06 | Configuration System | 01 |
| 07 | Automation Engine | 01, 02, 06 ¹ |
| 08 | Zigbee Adapter | 02, 05 |
| 09 | REST API | 02, 03, 07 |
| 10 | WebSocket API | 01 |
| 11 | Observability & Debugging | 01, 03 |
| 12 | Startup, Lifecycle & Shutdown | All preceding |
| 13 | Web UI (Observability MVP) | 09, 10, 11 |
| 14 | Master Architecture Document | All preceding |
¹ Doc 07 also has runtime dependencies on Doc 03 (StateQuery for condition evaluation), Doc 04 (CheckpointStore for subscriber persistence), and Doc 05 (CommandHandler for command dispatch to adapters). These are not listed as ordering dependencies because Docs 03–05 are already completed before Doc 07 in the production sequence. The complete dependency graph is recorded in each document's metadata header.
---

## 10. How to Work in This Project

### Role
Act as a senior systems architect and Java engineer. Think in terms of long-lived infrastructure, not quick prototypes. Every decision should be defensible five years from now.

### Decision-Making Protocol
When discussing architecture decisions:
1. State the problem clearly
2. Present realistic options with genuine strengths — no strawmen
3. Identify tradeoffs explicitly
4. Recommend a direction with reasoning
5. Identify what would tell us the decision was wrong

### What "Good" Looks Like
- Clear module boundaries with well-defined interfaces
- Strong typing — the compiler catches as many errors as possible
- Testable in isolation — every subsystem can be tested without the full runtime
- Observable — logging, metrics, and tracing built in from day one
- Configuration-driven — behavior determined by configuration, not code changes
- Every major design decision documentable as a standalone explanation page

### What to Avoid
- **Over-engineering** — this runs in a home, not a data center
- **Framework worship** — use libraries, not frameworks; own the control flow
- **Premature abstraction** — build the concrete thing first, extract when the second use case appears
- **Dependency accumulation** — every dependency is a liability on constrained hardware
- **Speculative implementation** — design for Tiers 2–3 in the architecture; implement only Tier 1
- **AI-associated language** — all documentation follows VoiceAndToneGuidelines.md; no "delve," "robust" (without specifics), "comprehensive" (without scope), "cutting-edge," or any pattern from the banned vocabulary

### Critical Design Constraint
**Every Tier 1 design must accommodate Tiers 2 and 3 without architectural rework.** This means:
- The device model supports multi-protocol from day one
- The event bus handles high-frequency energy data patterns
- The entity model includes person/presence entities
- The automation engine supports time-based triggers in its schema (even if not implemented)
- The state store's query interface does not preclude aggregation queries
- Entity identity is protocol-agnostic (device replacement does not break automations)

Design for the full vision. Implement only Tier 1.

---

## 11. What Exists Already

### Documentation Architecture System (DAS v1)
Complete documentation governance: DAS v1 Specification, Content Types, Voice & Tone Guidelines, Typography Reference, Visual Design Reference, Website Design Vision, Style Guide, six content templates, frontmatter JSON Schema, Docusaurus config, CI pipeline, PR template, CODEOWNERS, Vale linting rules.

### Website
homesynapse.com shows a countdown landing page. Registrar: GoDaddy. DNS/CDN: Cloudflare. Hosting: GitHub Pages.

### Brand Identity
- Parent company: NexSys (nexsys.io)
- Product: HomeSynapse (homesynapse.com)
- Visual identity: calm, architectural, infrastructure-grade
- Accent: #3FA6C9 (HomeSynapse Blue)
- Neutrals: #0B0F14 (Obsidian Graphite), #151B23 (Carbon Slate), #ECEFF3 (Mineral Ash)

### Core Design Documents (In Progress)
- DESIGN_DOC_TEMPLATE.md — canonical template for all subsystem designs
- 01-event-model-and-event-bus.md — foundational design (event schema, bus architecture, ordering, persistence contract)
- MVP_SCOPE.md — authoritative scope definition with tiered approach

---

*This document reflects the current direction of the HomeSynapse Core project. Locked decisions (§5) are not revisitable without formal revision. The competitive strategy (§2) and tiered MVP approach (§4) guide all design work.*