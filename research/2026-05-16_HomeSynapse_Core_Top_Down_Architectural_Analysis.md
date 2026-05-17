# HomeSynapse Core — Top-Down Architectural Analysis

**Date:** 2026-05-16
**Report version:** v1
**Status:** Descriptive reference (research-phase input — NOT prescriptive)
**Authority:** Architecture Invariants v1, Locked Decisions Register, Design Documents 01–14, applied amendments AMD-25..AMD-43 + AMD-M2Bridge, MODULE_CONTEXT files for all 19 modules, the Phase 3 Master Implementation Plan v2, PLAN-M3-CONSOLIDATED-02 (cross-referenced via `design/00-navigation-index.md`), and the post-M3-Deliverable-0 source state on `homesynapse-core@main` SHA `2b9d875…`.
**Companion (cross-repo):** `homesynapse-core-docs@main` SHA `ce200a9…`.

## Abstract

This report describes HomeSynapse Core's architecture top-down — from product vision down to the most recent code commit (M3 Deliverable 0, landed 2026-05-16). It is a neutral, citation-rich description intended as substrate for a downstream industry-comparison research phase. The report does not critique, propose alternatives, or recommend changes; where a design point is under-specified, it is flagged in §20 (Open Questions). Section §23 is a sync-verification appendix that confirms the report was produced against the current committed state of both repositories.

HomeSynapse Core is a local-first, event-sourced smart-home operating system implemented in Java 21 on a JPMS-modular Gradle multi-project. The architecture is anchored by three load-bearing constraints: (a) every meaningful occurrence in the system produces an immutable `EventEnvelope` appended to an append-only SQLite-backed log (INV-ES-01..08, LTD-03..06), (b) all SQLite writes serialize through a single platform-thread `WriteCoordinator` (AMD-26) while reads serialize through a bounded platform-thread `ReadExecutor` pool (AMD-27), and (c) virtual threads carry every other concurrent activity (subscribers, projection orchestration, API requests) and the discipline `LTD-11` (no `synchronized`) plus the ArchUnit-enforced clock-injection rule keep them pinning-free. The M3 governance bundle (AMD-41, AMD-42, AMD-43) — applied alongside Deliverable 0 — locks the State Projection's two-phase read/publish/checkpoint discipline, the five-state subscriber FSM (COLD → REPLAY → TRANSITION → LIVE → SUSPENDED), and the non-blocking-publish backpressure model. Deliverable 0 itself is the `ProjectionAdvancer.advance` interface upgrade to a three-parameter signature whose `Consumer<EventEnvelope>` processor callback runs inside the read transaction, codifying the two-phase discipline in code.

The remainder of this report walks down the architecture in order: vision and competitive positioning (§1); constitutional layer of invariants, locked decisions, and amendments (§2); module-level architecture and JPMS discipline (§3); the event model (§4); the persistence layer (§5); threading and concurrency model (§6); state projection and materialized views (§7); event bus and subscriber lifecycle (§8); backpressure and observability (§9); integration runtime (§10); automation engine (§11); device and capability model (§12); configuration system (§13); observability and debugging (§14); APIs (§15); lifecycle, startup, and shutdown (§16); the M2→M3 bridge (§17); M3 governance (§18); M3 Deliverable 0 (§19); open questions and pre-M3.1 decision points (§20); performance, privacy, and security posture (§21); topics deliberately out of scope (§22); and the sync-verification appendix (§23).

## Table of Contents

- §0 — Front matter (this section)
- §1 — Vision and differentiation
- §2 — Constitutional layer (invariants, locked decisions, amendments)
- §3 — Module architecture
- §4 — Event model
- §5 — Persistence layer
- §6 — Threading and concurrency
- §7 — State projection and materialized views
- §8 — Event bus and subscriber model
- §9 — Backpressure and observability (AMD-43)
- §10 — Integration runtime
- §11 — Automation engine
- §12 — Device and capability model
- §13 — Configuration system
- §14 — Observability and debugging
- §15 — APIs (out-of-M3-scope context)
- §16 — Lifecycle, startup, shutdown
- §17 — M2→M3 bridge work
- §18 — M3 governance (the planning lock)
- §19 — M3 Deliverable 0 (the most recent commit)
- §20 — Open questions and pre-M3.1 decision points
- §21 — Performance, privacy, and security posture
- §22 — Topics deliberately out of scope (for context)
- §23 — Sync verification appendix

---

## §1 — Vision and differentiation

### 1.1 Stated purpose

HomeSynapse Core describes itself as "a local-first smart home platform focused on reliability, correctness, and long-term scalability" and explicitly positions itself "as a smart home operating system, not an automation tool" (`HomeSynapse_Core_v1_Project_MVP.md` §1). The MVP document frames current platforms as failing in two distinct ways — "highly flexible but fragile" (cited examples include Python-runtime blocking, GIL contention, and integration-quality variance) and "highly polished but opaque" (cloud dependence, vendor lock-in, opaque data practices) — and proposes HomeSynapse as a third option that is "technically rigorous, fully functional offline, and explicit about how it works" (MVP §1).

### 1.2 Target audiences

The MVP document enumerates three target audiences in priority order (MVP §1):

1. **Power users of existing platforms** who value control, transparency, local execution, and reliability under load and who have experienced scaling pain on those platforms. Migration familiarity matters.
2. **Privacy-conscious users** leaving cloud ecosystems who want a modern smart home experience without surveillance, with explicit data boundaries.
3. **Developers and builders** writing integrations or extending the platform, who want clear interfaces, strong typing, and documentation that respects their time.

The same section explicitly states what HomeSynapse is not: "a cloud-dependent automation service; an advertising or data-harvesting platform; a drop-in feature-for-feature clone of any existing platform; a hobbyist project with no architecture discipline; a platform that competes on integration count" (MVP §1).

### 1.3 Competitive strategy — the "battlefields"

The MVP document enumerates six "battlefields" on which HomeSynapse intends to demonstrate superiority (MVP §2.1). They are: reliability under load (a 60-device home running for months without intervention); local-first superiority (full functionality without an internet connection); explainability (a non-developer can answer "why did the porch light turn on at 3am" from the event trace in the UI); crash isolation (killing one adapter does not affect another); energy intelligence (real-time whole-home energy monitoring with historically-loaded data); and zero-maintenance stability (a Pi-in-a-closet that does not need babysitting). The MVP §2.2 "Proof Scenario" lists the eight competitive demonstrations the system must be able to deliver, including the internet-outage and integration-crash simulations.

### 1.4 What HomeSynapse explicitly declines to do

Beyond the competitive negatives in §1.2, the architecture's invariants encode several explicit non-goals: cloud dependence is forbidden by INV-LF-01..05 (local-first; cloud is enhancement, never dependence; no required cloud account; graceful WAN degradation; convergent sync), telemetry is opt-in by INV-PD-01 ("zero telemetry by default"), and forced hardware obsolescence is rejected by INV-CS-07. INV-PD-02 (data residency is user-controlled) and INV-PD-04 (transparent data boundaries) further constrain what the platform may do with data.

### 1.5 Deployment spectrum

LTD-02 names Raspberry Pi 5 as the recommended hardware floor and Raspberry Pi 4 as the validation floor — every architectural decision (including the cadence and bounded-window numbers in §5 and §7) is expected to be valid on Pi 4 hardware. The deployment spectrum extends upward through x86 servers; the future desktop and mobile applications described in the project's roadmap are out of M3 scope. DEC-M3-12 (modified, locked via AMD-43 §3.6.6) extends the bounded-window discipline universally across the spectrum at MVP, with platform-specific tuning deferred to follow-up amendment AMD-44 if Pi 4 validation tests reveal saturation. INV-PR-04 (architecture must accommodate 1,000 devices) and INV-PR-01 (constrained hardware as the primary design target) anchor the upper and lower ends of the spectrum.

---

## §2 — Constitutional layer

### 2.1 Authority chain

HomeSynapse's design authority chain is, from highest to lowest precedence: **Invariants > Locked Decisions > Amendments > Design Documents > MODULE_CONTEXT > Handoff Documents > Traceability Maps** (`Architecture_Invariants_v1.md` §0; `HomeSynapse_Core_Locked_Decisions.md` §0.2). Invariants are constitutional: they bind every design choice and cannot be violated. Locked decisions (LTD-*, LD#*, DECIDE-*, DEC-M3-*) are concrete technology and policy commitments that close out invariant compliance with specific technology choices. Amendments (AMD-*) modify or extend design documents and the locked-decisions register without rewriting the parent artifact; they are tracked by status (APPLIED, WITHDRAWN, DEFERRED) and reference the locked decisions they implement. Design documents (Docs 01–14) specify each subsystem in detail. MODULE_CONTEXT files describe per-module reality (purpose, JPMS declaration, type inventory, amendments in force, gotchas). Conflicts are resolved upward: an amendment refines a design doc; a design doc refines a locked decision; a locked decision refines an invariant; invariants are never refined by anything below them (INV-GA-01 invariant stability).

INV-GA-02 (Invariant Identifiers Are Permanent) ensures that the alphanumeric identifiers used throughout the report remain stable even as the surrounding text evolves. INV-GA-03 (Compliance Is Verified in Review) makes design review the gatekeeper.

### 2.2 Invariant taxonomy

The canonical invariants register (`governance/Architecture_Invariants_v1.md`) organizes invariants into fifteen categories. Below is the full inventory with a one-sentence summary for each currently-applied invariant. Identifiers and short titles are reproduced verbatim from the register.

**LF — Local-First (5):**

- **INV-LF-01 Core Functionality Without Internet** — the system must remain fully functional with no WAN connectivity for all primary user journeys (lock, light, automation, dashboard).
- **INV-LF-02 Cloud Enhancement, Never Cloud Dependence** — any cloud integration is additive enhancement; loss of cloud must not block any local capability.
- **INV-LF-03 Graceful WAN Degradation** — partial network outages must degrade in a defined, observable way rather than silently freezing the UI or the event pipeline.
- **INV-LF-04 No Required Cloud Account** — the system must boot, configure, and operate without any account creation on any third-party service.
- **INV-LF-05 Convergent Sync Architecture** — multi-instance and backup-restore sync paths must be designed as convergent (eventually consistent) operations; LOCAL-ONLY tables (e.g. `subscriber_checkpoints`) are explicitly carved out.

**ES — Event Sourcing (8):**

- **INV-ES-01 Events Are Immutable Facts** — once an event is persisted to the WAL, it is never modified or deleted in normal operation; retention deletes are a separate, governed operation (AMD-40).
- **INV-ES-02 State Is Always Derivable from Events** — every observable state in the system can be rebuilt by replaying the event log from a checkpoint or from `position = 0`.
- **INV-ES-03 Per-Entity Ordering with Causal Consistency** — `(subjectRef, subjectSequence)` is monotonic per subject; cross-subject ordering uses `globalPosition` and the `CausalContext` (correlationId + causationId).
- **INV-ES-04 Write-Ahead Persistence** — events become durable (WAL committed) before any subscriber is notified; `EventBus.notifyEvent()` is always called after the commit.
- **INV-ES-05 At-Least-Once Delivery with Subscriber Idempotency** — subscribers may receive the same event more than once during crash recovery; idempotency is the subscriber's responsibility (stateVersion serves as the cursor inside the State Projection).
- **INV-ES-06 Every State Change Is Explainable** — `correlationId`, `causationId`, `actorRef`, and `origin` together produce a traceable causal chain for every state mutation.
- **INV-ES-07 Event Schema Evolution** — every event carries `schemaVersion`; backward-compatible evolution is supported via upcasters and the `DegradedEvent` fallback.
- **INV-ES-08 Event Time and Ingest Time Are Distinct** — `eventTime` (when the real-world thing happened, per the source's clock) and `ingestTime` (when the writer appended the event) are separate fields and are not conflated.

**RF — Reliability and Failure isolation (6):**

- **INV-RF-01 Integration Isolation** — an exception, hang, or native crash in one integration must not affect any other integration or the core.
- **INV-RF-02 Resource Quotas for Integrations** — integrations are bounded in memory, CPU, thread, and connection consumption to make crash-isolation finite.
- **INV-RF-03 Startup Independence** — a failing integration must not block core startup; the system boots with the failing integration in a documented unhealthy state.
- **INV-RF-04 Crash Safety and Automatic Recovery** — a `kill -9` must lose zero acknowledged events; the D1 WAL Pathology Validation Spike (2026-05-15) confirmed zero loss across 5 trials of 500 events each at 100 events/sec.
- **INV-RF-05 Bounded Storage Growth** — retention policy ensures the event log cannot grow without bound; AMD-40 codifies the execution model.
- **INV-RF-06 Graceful Degradation Under Partial Failure** — when a non-essential subsystem fails, the rest of the system continues to operate; integration health is observable via INV-TO-01.

**CS — Compatibility and Stability (7):**

- **INV-CS-01 Semantic Versioning Is Enforced** — REST API uses URL versioning (LTD-16); breaking changes increment the major.
- **INV-CS-02 Entity Identifiers Are Stable** — `EntityId` survives device replacement (AMD-related entity transfer protocol).
- **INV-CS-03 Configuration Schema Stability** — YAML schemas are versioned (INV-CE-03); migrations accompany schema evolution (INV-CE-06).
- **INV-CS-04 Integration API Stability** — the integration-api module's surface is stable across MVP and the M3 governance bundle; LD#10 makes inter-module `requires` transitive by default.
- **INV-CS-05 Update Safety Mechanisms** — CLI-driven upgrades are mandatory pre-snapshot (LTD-14) so any failed migration is recoverable.
- **INV-CS-06 Deprecation Discipline** — deprecations are announced in changelog before removal.
- **INV-CS-07 No Forced Hardware Obsolescence** — the Pi 4 floor (LTD-02) prevents accidental hardware demotion.

**HO — Household Operation (5):**

- **INV-HO-01 Physical Control Supremacy** — a physical light switch always works, even if the automation engine is down.
- **INV-HO-02 Operable Under Degradation** — the system remains usable for primary journeys when individual subsystems are degraded.
- **INV-HO-03 No Debugging for Daily Operation** — the partner test: the non-technical member of the household must not be expected to triage failures.
- **INV-HO-04 Self-Explaining Errors** — error messages are addressed to the household, not to the developer.
- **INV-HO-05 The Partner Test** — every flow must be operable by someone who did not install the system.

**PD — Privacy and Data sovereignty (8):**

- **INV-PD-01 Zero Telemetry by Default** — no usage data leaves the device unless the user explicitly opts in.
- **INV-PD-02 Data Residency Is User-Controlled** — the user chooses where their data lives.
- **INV-PD-03 Encrypted Storage** — sensitive data at rest is encrypted (AES-256-GCM per LTD-15 / configuration secrets).
- **INV-PD-04 Transparent Data Boundaries** — what leaves the device and where is visible in the configuration and the UI.
- **INV-PD-05 Consent Is Granular, Informed, and Revocable** — category-scoped consent (mapped to `EventCategory` per §4 of Doc 01 — DEVICE_STATE, ENERGY, PRESENCE, ENVIRONMENTAL, SECURITY, AUTOMATION, DEVICE_HEALTH, SYSTEM).
- **INV-PD-06 Offline Integrity** — privacy guarantees do not depend on online verification.
- **INV-PD-07 Crypto-Shredding for Sensitive Data Lifecycle** — categories enable scoped key destruction.
- **INV-PD-08 Tamper-Evident System Integrity** — the chain-hash column on the events table (AMD-37) is the foundation for cryptographic tamper evidence in a future milestone; the column is NOT NULL with a 32-byte zero default at MVP.

**TO — Transparency and Observability (4):**

- **INV-TO-01 System Behavior Is Observable** — every subsystem reports structured health and metrics to the `observability/observability` module (Doc 11).
- **INV-TO-02 Automation Determinism** — given the same event log and the same configuration, automations produce the same result.
- **INV-TO-03 No Hidden State** — every meaningful state mutation is a logged event; "what is going on" is always answerable.
- **INV-TO-04 Structured, Queryable Logs** — logs are JSON via SLF4J + Logback (LTD-15) and are queryable via the trace surface.

**CE — Configuration and Extension (6):**

- **INV-CE-01 Canonical, Human-Readable Configuration** — YAML 1.2 (LTD-09).
- **INV-CE-02 Zero-Configuration First Run** — an empty config file produces a running system using defaults (Doc 14 §9).
- **INV-CE-03 Configuration Schema Is Documented and Versioned** — schemas carry version numbers.
- **INV-CE-04 Protocol Agnosticism in the Device Model** — the device model is described in capability terms, not in Zigbee, Z-Wave, or Matter primitives (Doc 02).
- **INV-CE-05 Extension Model with Stability Guarantees** — integrations declare their config schemas via a stable surface (Doc 06 §3.2).
- **INV-CE-06 Migration Tooling Accompanies Schema Evolution** — every schema bump ships with a migration script.

**PR — Performance (4):**

- **INV-PR-01 Constrained Hardware Is the Primary Design Target** — Pi 4 floor is the design constraint.
- **INV-PR-02 Quantitative Performance Targets** — Doc 14 §10.1 enumerates per-subsystem targets (e.g. event append < 10 ms; subscriber notification < 5 ms; state-change derivation < 2 ms; WebSocket relay < 10 ms).
- **INV-PR-03 Resource Usage Is Bounded and Predictable** — memory budgets and CPU envelopes are documented per subsystem (Doc 14 §3.5 Memory Budget).
- **INV-PR-04 Architecture Must Accommodate 1,000 Devices** — the data model and the event throughput model are sized for 1000-device homes.

**SE — Security (6):**

- **INV-SE-01 No Default Credentials** — first-run flow enforces credential creation.
- **INV-SE-02 Authentication Required for All External Interfaces** — REST and WebSocket APIs reject anonymous access.
- **INV-SE-03 Secrets Encrypted at Rest** — the configuration secret store uses AES-256-GCM.
- **INV-SE-04 Least Privilege for Integrations** — integrations cannot access the full system state.
- **INV-SE-05 Remote Access Is End-to-End Encrypted** — the (post-MVP) remote access path will use end-to-end encryption.
- **INV-SE-06 Security Updates Without Feature Churn** — security patches can ship independently of feature releases.

**AI — Artificial Intelligence (5, post-MVP):**

- **INV-AI-01 AI Is Enhancement, Never Foundation** — AI features never become preconditions for primary journeys.
- **INV-AI-02 AI Requires Explicit Consent** — AI features require informed opt-in.
- **INV-AI-03 AI Decisions Are Explainable** — AI outputs are traceable to inputs.
- **INV-AI-04 Local AI Capability** — local-AI paths are preferred over cloud-AI.
- **INV-AI-05 On-Device Behavior Modeling** — behavior models are computed locally.

**EI — Energy Intelligence (5, post-MVP):**

- **INV-EI-01 Energy as First-Class Domain** — energy events are first-class, not bolt-on.
- **INV-EI-02 Grid-Interactive by Design** — grid-interaction is an architectural primitive.
- **INV-EI-03 Carbon-Aware Scheduling Architecture** — the architecture admits carbon-aware schedulers.
- **INV-EI-04 Energy Data Sovereignty** — energy data is owned by the user.
- **INV-EI-05 Hardware-Agnostic Energy Metering** — multiple metering protocols are supported uniformly.

**MU — Multi-User (5, post-MVP):**

- **INV-MU-01 Identity-Aware Device Model** — `actorRef` on the event envelope is the foundation for multi-user audit trails (already present at MVP).
- **INV-MU-02 Spatial Presence as Core Primitive** — presence is a first-class concept (the `PresenceSignalEvent` and `PresenceChangedEvent` vocabulary is reserved at MVP).
- **INV-MU-03 Preference Arbitration Framework** — multiple users with conflicting preferences are arbitrated.
- **INV-MU-04 Household Role Model** — household roles are encoded.
- **INV-MU-05 Graceful Identity Degradation** — identity faults degrade rather than break.

**MN — Mesh and Network intelligence (4, post-MVP):**

- **INV-MN-01 Protocol-Agnostic Network Telemetry** — Zigbee, Z-Wave, Thread network telemetry use a uniform model.
- **INV-MN-02 Mesh Health as Observable State** — mesh topology and health are observable.
- **INV-MN-03 Predictive Network Diagnostics** — diagnostics anticipate degradation.
- **INV-MN-04 Battery-Aware Network Optimization** — battery-powered devices are scheduled to extend lifetime.

**GA — Governance (3):**

- **INV-GA-01 Invariant Stability** — invariants change only via formal governance.
- **INV-GA-02 Invariant Identifiers Are Permanent** — IDs are never reused.
- **INV-GA-03 Compliance Is Verified in Review** — compliance is checked by design review.

**New M3 identifiers referenced by AMD-41/42/43 but not yet registered in `Architecture_Invariants_v1.md`** — the amendments introduce the identifiers below and rely on them for their normative force, but the canonical invariants document has not yet been updated to include them. This is captured here as observed state (see §20 and §23.4):

- `INV-BUS-01` — delivery exactly-once per subscriber (referenced by AMD-42).
- `INV-BUS-02` — `EventPublisher.publish()` is non-blocking on backpressure (referenced normatively by AMD-43 §3.6.1).
- `INV-BUS-03` — subscriber isolation (referenced by AMD-42).
- `INV-PROJ-01` — projection determinism (referenced by AMD-41).
- `INV-PROJ-04` — checkpoint-position monotonicity (referenced by AMD-41).
- `INV-PROJ-NEW-01` — self-produced isolation (introduced by AMD-41).
- `INV-WRITER-01` — single-writer (the AMD-26 promise re-stated as a numbered invariant; referenced by AMD-41 / AMD-42 / AMD-43).
- `INV-SUB-ISO-01..06` — per-subscriber resource isolation catalog (introduced by AMD-42 §3.4.4): one VT, one dedicated SQLite read connection, one DLQ instance, one `AtomicReference<SubscriberMode>`, one `ReplayWindowQueue`, one `SelfProducedFilter`.

### 2.3 Locked-decisions register

The locked-decisions register (`governance/HomeSynapse_Core_Locked_Decisions.md`) holds nineteen long-term technical decisions (LTD-01 through LTD-19). Each is a concrete technology, policy, or boundary commitment. One-sentence summaries below; full rationale lives in the source.

- **LTD-01 Java 21 LTS** — the JVM language and runtime. Phase 3 explicitly relies on virtual threads, sealed interfaces, records, and pattern matching.
- **LTD-02 Raspberry Pi 5 Recommended, Pi 4 as Validation Floor** — the hardware envelope.
- **LTD-03 SQLite as Default Persistence Engine** — single-process, WAL mode, with a specific PRAGMA recipe (cache, mmap, journal_size_limit 6 MB per AMD-39 withdrawal, busy_timeout 5s, etc.).
- **LTD-04 ULID for Event and Entity Identity** — 26-character Crockford Base32 at API boundaries, BLOB(16) in SQLite storage; lexicographically sortable.
- **LTD-05 Per-Entity Sequences with Global Position** — `(subjectRef, subjectSequence)` enforces optimistic concurrency; `globalPosition` orders cross-subject.
- **LTD-06 Write-Ahead Persistence with At-Least-Once Delivery** — durability before notification; subscribers are idempotent.
- **LTD-07 Forward-Only SQL Migrations with Mandatory Backup** — Flyway-style migrations tracked in `hs_schema_version`.
- **LTD-08 Jackson JSON for All Serialization** — ISO 8601 strings on the wire, integer microseconds in storage; SNAKE_CASE; NON_NULL include policy.
- **LTD-09 YAML 1.2 for User-Facing Configuration** — SnakeYAML 1.2 with tag resolution.
- **LTD-10 Gradle with Kotlin DSL, Multi-Module Project** — convention plugins in `build-logic/`.
- **LTD-11 No External Message Broker** — in-process pull-based bus; no Kafka, no RabbitMQ.
- **LTD-12 Zigbee as First Protocol** — Doc 08 is the first-protocol design.
- **LTD-13 Self-Contained Distribution via jlink, Managed by systemd** — runtime image is custom JRE plus the application; `platform/platform-systemd` integrates `sd_notify`.
- **LTD-14 CLI-Driven Upgrade with Mandatory Pre-Upgrade Snapshot** — every upgrade snapshots first.
- **LTD-15 Structured JSON Logging via SLF4J + Logback + JFR Continuous Recording** — logs are JSON; JFR is always recording.
- **LTD-16 Semantic Versioning with URL-Versioned REST API** — `/api/v1/…`.
- **LTD-17 In-Process Compiled Integrations with Enforced API Boundary** — integrations are Java modules; the `integration-api` module is the only re-export.
- **LTD-18 Web UI Technology — Preact SPA for Observability, HTMX Reserved for Tier 2+ Configuration** — Doc 13's stack.
- **LTD-19 Event Payload Serialization via EventTypeRegistry and PersistenceJacksonModule** — the type discriminator is the `@EventType` annotation; Jackson's `@JsonTypeInfo` is banned by the `NO_JSON_TYPE_INFO_IN_EVENTS` ArchUnit rule.

**LD#* (locked decisions outside the LTD numbering) and DECIDE-* (M2 decisions) referenced throughout this report include:**

- **LD#10** — inter-module Gradle / JPMS `requires` are `requires transitive` by default. This is the citation invoked by the Deliverable 0 fix that promoted `state-store`'s `requires com.homesynapse.event` to `requires transitive` (§19).
- **DECIDE-04** — no `ServiceLoader`; factories are instantiated directly (enforced by the `NO_SERVICE_LOADER` ArchUnit rule).
- **DECIDE-M2-01 / DECIDE-M2-05 / DECIDE-M2-07** — referenced from AMD-33 / LTD-19 and the `EventPayloadCodec` description (M2 type-resolution and DegradedEvent fallback decisions, respectively).

**DEC-M3-01..13 — the M3 governance lock** (PLAN-M3-CONSOLIDATED-02 §1.2 and §12, cross-referenced from `design/00-navigation-index.md`):

- **DEC-M3-01** Projection read/write discipline — locked by AMD-41 §3.2.1 (two-phase read-then-publish-then-checkpoint).
- **DEC-M3-02** Self-produced event detection — locked by AMD-41 §3.2.2 (`SelfProducedFilter` + `stateVersion` defence-in-depth).
- **DEC-M3-03** REPLAY→LIVE transition — locked by AMD-42 §3.4.2 (three-phase).
- **DEC-M3-04** (modified) State projection checkpoints — locked by AMD-41 §3.2.3 (MVP uses `ViewCheckpointStore`; `SqliteSnapshotStore` deferred).
- **DEC-M3-05** Snapshot format — locked by AMD-41 §3.2.3 + §3.2.4 (V003 table created; implementation deferred).
- **DEC-M3-06** (augmented) Subscriber isolation — locked by AMD-42 §3.4.4..§3.4.6 (INV-SUB-ISO-01..06 catalog).
- **DEC-M3-07** Coalescing — DEFERRED past M3 per AMD-43 §3.6.5 (`coalesceExempt` retained but inert).
- **DEC-M3-08** (rejected, replaced) Backpressure — replaced by AMD-43 §3.6.1 (non-blocking publish).
- **DEC-M3-09** Clock injection — extended to M3 via the existing `NO_DIRECT_TIME_ACCESS` ArchUnit rule; **not** a separate amendment (see §6 and the AMD-42 citation note correcting an earlier AMD-39 attribution).
- **DEC-M3-10** State_changed derivation — locked by AMD-41 (scope of the projection's derivation).
- **DEC-M3-11** Implementation order — locked by PLAN-M3-CONSOLIDATED-02 §1.2: M3.1 → M3.5a → M3.2 → M3.3 → M3.4 → M3.5b → M3.6 → M3.7.
- **DEC-M3-12** (modified) Pi 4 support — locked by AMD-43 §3.6.6 (universal defaults at MVP; AMD-44 may introduce platform-aware tuning if Pi 4 tests reveal saturation).
- **DEC-M3-13** M3.4 integration-test module placement — post-deliberation decision recorded in PLAN-M3-CONSOLIDATED-02 §8.2.

### 2.4 Amendment inventory

The `design/amendments/` directory contains seventeen amendments (sixteen numbered AMD-25 through AMD-43 with the gap noted below, plus the non-numbered `AMD-M2Bridge_Tier2_Schema_Reservations.md`). AMD-01..AMD-24 and AMD-28..AMD-30 are intentionally non-existent — the numbering is not contiguous because early-design decisions were resolved without going to amendment.

| AMD | Subject | Target | Status | Source / one-line summary |
|---|---|---|---|---|
| AMD-25 | Temporal Duration Trigger Modifier | Doc 07 (Automation Engine) | APPLIED (2026-03-17) | Trigger expression duration modifier semantics; gates `automation` module Phase 2 spec. |
| AMD-26 | sqlite-jdbc VT Carrier Pinning Mitigation | LTD-01/03/11 | APPLIED (2026-03-21) | All SQLite writes serialize through a dedicated platform-thread `WriteCoordinator`. Partner to AMD-27. Source: Virtual Thread Risk Audit Report. |
| AMD-27 | Persistence Layer Platform Thread Executor (reads) | Doc 04 | APPLIED (2026-03-21) | All SQLite reads serialize through a bounded platform-thread `ReadExecutor` (round-robin pool; default 2). |
| AMD-31 | Command Execution Order Guarantees | Doc 07 | APPLIED (2026-04-04) | Causal ordering of command emission; sequential per Run; ULID-ascending for multi-target. |
| AMD-32 | Persistence Internal Types | Doc 04 §8.7 | APPLIED (2026-04-09) | `WriteCoordinator` and `WritePriority` as package-private internal types. |
| AMD-33 | DomainEvent Permanently Non-Sealed | Doc 01; LTD-19 | APPLIED (2026-04-10) | `DomainEvent` is non-sealed because `IntegrationLifecycleEvent` lives in a different JPMS module; `@EventType` annotation + `EventTypeRegistry` provide type discovery without `getPermittedSubclasses()`. |
| AMD-34 | Home Identity Schema Reservation | Doc 04 §4 | APPLIED (2026-05-02) | `home_id BLOB(16)` column reserved on the events table; passed through `SqliteEventStore` constructor (5th param). |
| AMD-35 | Persistent Idempotency Key | Doc 01 + Doc 04 | APPLIED (2026-05-02) | 9th field on `EventDraft`: `idempotencyKey String` (max 128 chars, non-blank when non-null). Partial unique index `(home_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. |
| AMD-36 | Subscriber Dead-Letter Queue | Doc 01 + Doc 04 | APPLIED (2026-05-02) | V002 `subscriber_dead_letters` table: 11 columns, `UNIQUE(subscriber_id, event_position)`, NO `status` column (row presence IS the parked state). Default retry cap = 5. Park-and-advance atomicity via `AtomicCheckpointWriter`. |
| AMD-37 | Chain Hash Not Null with Zero Default | Doc 04 §4 | APPLIED (2026-05-02) | `chain_hash BLOB(32) NOT NULL DEFAULT (X'00…00')`. Foundation for INV-PD-08 tamper evidence; populated with zero vector at MVP. |
| AMD-38 | Checkpoint Policy Revision | Doc 03 §9 | APPLIED (2026-05-15) | Universal cadence: `event_threshold = 200` AND/OR `max_interval_seconds = 2`. Bounded-window reader `DEFAULT_MAX_ROWS = 500`. Source: D1 WAL Pathology Validation Spike (2026-05-15). |
| AMD-39 | Journal Size Limit Revision | LTD-03 PRAGMA | **WITHDRAWN (2026-05-15)** | Proposed raise to 64 MB withdrawn after D1 validated 6 MB is sufficient under the bounded-window reader pattern. Has nothing to do with clock injection — see the source-verification citation correction in AMD-42 noting that earlier plan drafts misattributed clock-injection authority to AMD-39. |
| AMD-40 | Retention Execution Model | Doc 04 §3.4 | APPLIED (2026-05-15) | Retention is routed through `WriteCoordinator` at `RETENTION` priority. Interval-based (6h default). Bounded chunks (1000 rows, ≤2 s lock hold). Yields the writer between chunks. |
| AMD-M2Bridge | Tier-2 Schema Reservations | Doc 04 §4 | APPLIED (2026-05-02) | Six additional zero-cost schema reservations on the events table, with no Java API impact and `setNull` binding at INSERT time. Informational, not contract-level. |
| **AMD-41** | **State Projection Execution Model** | **Doc 03 §3.2** | **APPLIED (2026-05-16)** | Two-phase READ → PUBLISH → CHECKPOINT discipline. `SelfProducedFilter` (60 s TTL, lazy eviction, no hard cap, REPLAY/TRANSITION bypass, `stateVersion` defence-in-depth). Reconciliation pass on `projectionVersion` mismatch with metadata reused into the existing opaque `CheckpointRecord.data` byte slot. |
| **AMD-42** | **Subscriber Lifecycle and Isolation** | **Doc 01 §3.4** | **APPLIED (2026-05-16)** | Five-state subscriber mode FSM `COLD → REPLAY → TRANSITION → LIVE → SUSPENDED`. Three-phase REPLAY→LIVE (paging `MAX_REPLAY_PAGE = 500`; `ReplayWindowQueue` bounded at 10000; TRANSITION drain with gap detection; `onCaughtUp()` single-shot per process per subscriber). Per-subscriber resources INV-SUB-ISO-01..06. Supervisor with 3 s initial / 30 s max backoff and 0.2 jitter; circuit breaker at 5 crashes in 10 minutes → SUSPENDED + CRITICAL. |
| **AMD-43** | **Backpressure and Observability** | **Doc 01 §3.6 + Doc 11 §3.X** | **APPLIED (2026-05-16)** | `EventPublisher.publish()` is non-blocking on writer-queue depth (INV-BUS-02 normative). Seven canonical bus/writer metric names. `QueueSaturationHealthCheck` with WARN @ 5000 / CRITICAL @ 10000 (1-second tick, hysteresis). Per-subscriber `DerivedWriteRateLimit` (200 cap / 200 per second; poll-then-park). Coalescing deferred past M3 (DEC-M3-07). |

The Navigation Index (`design/00-navigation-index.md`) is the source of truth for amendment status; the file `homesynapse-core-docs/HomeSynapse_Navigation_Index.md` referenced in this report's input prompt does NOT exist on disk — the actual navigation index lives at `design/00-navigation-index.md` and is scoped to design and amendments. This drift is recorded in §23.4.

### 2.5 ArchUnit rules in force

The `app/homesynapse-app` module runs seven ArchUnit rules in `HomeSynapseArchRules` (verified against `src/test/java/com/homesynapse/app/HomeSynapseArchRules.java`):

1. `NO_SYNCHRONIZED_METHODS` — codifies LTD-11; no `synchronized` block or method in core code. Virtual-thread carrier-pinning prevention.
2. `NO_DIRECT_TIME_ACCESS` — codifies DEC-M3-09; all wall-clock access must go through an injected `java.time.Clock`. Direct `Instant.now()`, `System.currentTimeMillis()`, or `Clock.systemUTC()` calls are forbidden.
3. `NO_SERVICE_LOADER` — codifies DECIDE-04; factories are instantiated directly. No `ServiceLoader.load(…)`.
4. `NO_REVERSE_DEPENDENCIES` — JPMS dependency direction is strictly inward (platform-api → no one; persistence → core; integration-runtime → core; etc.).
5. `NO_DIRECT_FILESYSTEM_IN_CORE` — core modules do not call `Files.*` directly; filesystem access goes through abstractions in `platform-api` or `lifecycle/lifecycle` (`PlatformPaths`).
6. `NO_INTERNAL_PACKAGE_ACCESS` — internal packages (those without an `exports` declaration in module-info) cannot be accessed from outside the declaring module.
7. `NO_JSON_TYPE_INFO_IN_EVENTS` — codifies the AMD-33 / LTD-19 decision that `EventTypeRegistry` (via `@EventType` annotation) is the polymorphic discriminator; Jackson's `@JsonTypeInfo` is banned from `DomainEvent` records.

DEC-M3-09 (single-`Clock`-per-module discipline) is currently a coding rule enforced by the existing `NO_DIRECT_TIME_ACCESS` rule. A separate ArchUnit rule per-module-clock-singleton is not yet defined. M3.5b introduces a NEW ArchUnit rule `ADMIN_ENDPOINTS_REQUIRE_AUTH_ANNOTATION` per the PLAN-M3-CONSOLIDATED-02 reclassification (PLAN §13.3; see §15 and §18).

---

## §3 — Module architecture

### 3.1 The 19-module map

The `homesynapse-core` Gradle multi-project contains nineteen production source modules (each with a `MODULE_CONTEXT.md`), organized by layer. The repository on-disk layout differs from the prompt's flat enumeration — the actual directory paths are as listed.

| Layer | Module | Path | JPMS module name | Purpose (one-paragraph) |
|---|---|---|---|---|
| Platform | `platform-api` | `platform/platform-api/` | `com.homesynapse.platform` | Dependency root. Zero project dependencies. Typed ULID identity system (`Ulid`, `UlidFactory`, `EntityId`, `DeviceId`, `AreaId`, `AutomationId`, `PersonId`, `HomeId`, `IntegrationId`, `SystemId`, `EventId`-style wrappers) plus `PlatformPaths` / `HealthReporter` interfaces. 12 types. |
| Platform | `platform-systemd` | `platform/platform-systemd/` | `com.homesynapse.platform.systemd` | `sd_notify` integration, watchdog heartbeat, `LinuxSystemPaths` (scaffold). Implements `PlatformPaths` for systemd-managed deployments. |
| Core | `event-model` | `core/event-model/` | `com.homesynapse.event` | Universal event vocabulary: `EventEnvelope` (14 fields), `EventPublisher`, `EventStore`, `EventDraft` (9 fields after AMD-35), 22 core `DomainEvent` payload records + `DegradedEvent` fallback, enums (`EventPriority`, `EventOrigin`, `EventCategory`, `SubjectType`, `ProcessingMode`, `CommandIdempotency`), exception hierarchy, `EventType` annotation, `EventTypes` registry. 47 public types. |
| Core | `event-bus` | `core/event-bus/` | `com.homesynapse.event.bus` | Pull-based event distribution. `EventBus` interface, `SubscriberInfo` (3 fields), `SubscriptionFilter`, `CheckpointStore` (subscriber position). 4 public types. AMD-42 expands this surface (introspection, supervisor) in M3.1. |
| Core | `state-store` | `core/state-store/` | `com.homesynapse.state` | Materialized view layer. `EntityState` (9 fields), `StateSnapshot` (5 fields), `CheckpointRecord` (5 fields), `Availability` enum, `StateQueryService`, `StateStoreLifecycle`, `ViewCheckpointStore`, `CheckpointPolicy` sealed hierarchy, `ProjectionAdvancer` (post-Deliverable 0), `AdvanceResult`. 12 public types. |
| Core | `persistence` | `core/persistence/` | `com.homesynapse.persistence` | SQLite WAL storage. Public: 16 types (telemetry, backup/restore, retention/vacuum results, four service interfaces, `DeploymentProfile`, `PersistenceConfig`, `RetentionPolicy`, `MaintenanceSubscriber`, `MaintenanceResult`). Package-private: ~25 internal types incl. `WriteCoordinator` / `WritePriority`, `PlatformThreadWriteCoordinator`, `PlatformThreadReadExecutor`, `DatabaseExecutor`, `MigrationRunner`, the Jackson infrastructure (`PersistenceJacksonModule`, `PersistenceObjectMapper`, `JacksonWarmup`, `EventPayloadCodec`), and the four production SQLite stores (`SqliteEventStore`, `SqliteCheckpointStore`, `SqliteViewCheckpointStore`, `AtomicCheckpointWriter`, `SqlitePersistenceLifecycle`). |
| Core | `device-model` | `core/device-model/` | `com.homesynapse.device` | Entity / Device / Capability model. 57 types. Sealed hierarchies (capability types, attribute values, command definitions). Registries, discovery pipeline, AttributeValue type system. |
| Core | `automation` | `core/automation/` | `com.homesynapse.automation` | Trigger → Condition → Action rule engine. ~52 types. Four sealed hierarchies (triggers, conditions, actions, results). Cascade governance with configurable depth limits. AMD-25 (temporal duration modifier) and AMD-31 (command order). |
| Config | `configuration` | `config/configuration/` | `com.homesynapse.config` | YAML 1.2 config loading, JSON Schema validation, AES-256-GCM secret store, hot reload with two-phase notification. 22 types. |
| Integration | `integration-api` | `integration/integration-api/` | `com.homesynapse.integration` | Adapter-facing API boundary. Re-exports platform-api, event-model, device-model. `IntegrationFactory`, `IntegrationAdapter`, `IntegrationContext`. 21 types. `IntegrationLifecycleEvent` permits subtypes that extend `DomainEvent` from a different JPMS module — the reason `DomainEvent` is permanently non-sealed (AMD-33). |
| Integration | `integration-runtime` | `integration/integration-runtime/` | `com.homesynapse.integration.runtime` | Scaffold. OTP-style supervisor, adapter lifecycle (init → run → close), hybrid thread architecture (platform-thread for serial I/O, virtual-thread for protocol logic), health monitoring (`HEALTHY → DEGRADED → SUSPENDED → FAILED` FSM), Kahn's startup ordering. |
| Integration | `integration-zigbee` | `integration/integration-zigbee/` | `com.homesynapse.integration.zigbee` | Scaffold. Zigbee 3.0 coordinator support (Z-Stack ZNP over UNPI, EmberZNet EZSP over ASH). `IEEEAddress` is a raw long (NOT a ULID — it is a network address, not a HomeSynapse identity). Cluster-to-capability mapping. |
| API | `rest-api` | `api/rest-api/` | `com.homesynapse.api.rest` | Scaffold. HTTP command interface. RFC 9457 error responses. 4-phase command lifecycle (`command_issued` → `command_dispatched` → `command_result` → `state_confirmed` or `command_confirmation_timed_out`). Idempotency keys at the command endpoint (AMD-08-related). URL-versioned per LTD-16. |
| API | `websocket-api` | `api/websocket-api/` | `com.homesynapse.api.websocket` | Scaffold. Real-time event streaming. 3-stage backpressure (NORMAL → BATCHED → COALESCED → close). Read-only (no commands; commands flow through REST). Out of M3 scope per the Navigation Index. |
| Observability | `observability` | `observability/observability/` | `com.homesynapse.observability` | Scaffold. JFR-centric metrics surface (`MetricsRegistry`, `MetricsStreamBridge`, `MetricSnapshot`). Health aggregation, trace query, structured logging. |
| App | `homesynapse-app` | `app/homesynapse-app/` | `com.homesynapse.app` | Scaffold. Assembly apex — manual DI wiring. All `requires` are non-transitive. No `exports`. Houses the seven ArchUnit rules in `HomeSynapseArchRules`. |
| Lifecycle | `lifecycle` | `lifecycle/lifecycle/` | `com.homesynapse.lifecycle` | Scaffold. 10-phase sequential startup (Doc 12 maps to 7 Phases in the doc, plus inner sub-phases). 30-second shutdown budget. Fatal vs non-fatal failure classification. Owns the runtime health loop. |
| Testing | `test-support` | `testing/test-support/` | (cross-cutting; unpublished module name) | Cross-cutting test infrastructure. `TestClock`, `SynchronousEventBus` (lightweight test bus — NOT the same as `InMemoryEventBus` in event-bus's testFixtures), `NoRealIoExtension`, GivenWhenThen DSL, custom AssertJ assertions. |
| Web UI | `dashboard` | `web-ui/dashboard/` | (Preact SPA; not a JPMS module) | Scaffold. Observability web UI. Static files served from Javalin. <100 KB gzipped budget. Separate build pipeline (npm + Preact). Doc 13. |

(That is nineteen modules counting `platform-systemd` and `dashboard`; the count matches the on-disk inventory in `homesynapse-core/`.)

### 3.2 JPMS discipline

The JPMS module structure is strict (Doc 14 §3.6; LTD-10):

- **One flat package per module.** Every module's `MODULE_CONTEXT.md` explicitly states "all types in a single flat package" (verified across `platform-api`, `event-model`, `event-bus`, `state-store`, `persistence`, `device-model`, `integration-api`, etc.). No sub-packages within a module's `exports` declaration.
- **No split packages.** Two modules cannot declare types in the same package name. This is a JPMS constraint and is reinforced by `NO_INTERNAL_PACKAGE_ACCESS`.
- **No cross-module reflection.** Modules do not call `setAccessible(true)` on types outside their own module. `EventTypeRegistry` uses `Class.getAnnotation(EventType.class)` on classes inside its own module (and any client modules that have explicitly added themselves to the bootstrap list).
- **Dependency direction is strictly inward.** `platform-api` depends on nothing. Core modules depend on platform-api and (where applicable) on each other in a strict topological order. Integration, API, observability, app, and lifecycle modules depend on core modules. The `NO_REVERSE_DEPENDENCIES` ArchUnit rule enforces this.
- **`requires transitive` is the default for inter-module APIs** (LD#10). A module that exposes another module's types in its public API surface uses `requires transitive` so consumers do not need to redeclare the dependency. The Deliverable 0 fix to `state-store`'s `module-info.java` (promoting `requires com.homesynapse.event` to `requires transitive`) is the canonical illustration: `ProjectionAdvancer.advance` takes a `Consumer<EventEnvelope>` parameter, surfacing event-model in state-store's exported API, which under `-Werror` triggers the leaked-type check unless the dependency is transitive (§19).

### 3.3 Gradle multi-project structure

Top-level Gradle layout (verified from the `homesynapse-core/` root listing):

```
homesynapse-core/
├── build.gradle.kts            # Root build script (minimal)
├── settings.gradle.kts         # Multi-project includes
├── build-logic/                # Convention plugins (LTD-10)
│   ├── build.gradle.kts
│   ├── settings.gradle.kts
│   └── src/
├── platform/
│   ├── platform-api/
│   └── platform-systemd/
├── core/
│   ├── event-model/
│   ├── event-bus/
│   ├── state-store/
│   ├── persistence/
│   ├── device-model/
│   └── automation/
├── config/
│   └── configuration/
├── integration/
│   ├── integration-api/
│   ├── integration-runtime/
│   └── integration-zigbee/
├── api/
│   ├── rest-api/
│   └── websocket-api/
├── observability/
│   └── observability/
├── lifecycle/
│   └── lifecycle/
├── testing/
│   └── test-support/
├── app/
│   └── homesynapse-app/
├── web-ui/
│   └── dashboard/              # Separate build pipeline (npm)
├── spike/                      # Spike databases / scratch
└── specs/                      # Reserved
```

`build-logic/` houses Gradle convention plugins that centralize Java compilation settings (`-Xlint:all -Werror`), JUnit 5 setup, test fixtures conventions, JPMS module-info plumbing, and dependency-pinning helpers. The exact convention-plugin set is in `build-logic/src/main/kotlin/` (not enumerated here per the prompt's "do not read full Gradle scripts" directive).

### 3.4 Dependency graph (high-level)

The following table summarizes the cross-module `requires` declarations as captured in each module's `MODULE_CONTEXT.md`. `T` denotes `requires transitive`; bare `requires` is non-transitive.

| Module | Direct dependencies |
|---|---|
| `platform-api` | (none — dependency root) |
| `platform-systemd` | `platform-api` (T) |
| `event-model` | `platform-api` (T) |
| `event-bus` | `event-model` (T) — transitively re-exports platform-api |
| `state-store` | `platform-api` (T), `device-model` (T), `event-model` (**T — promoted in Deliverable 0**) |
| `persistence` | `platform-api` (T), `state-store`, `event-model`, `event-bus`, `java.sql`, `org.slf4j`, Jackson (`core`, `databind`, `datatype.jsr310`, `module.blackbird`) |
| `device-model` | `platform-api` (T), `event-model` (T) |
| `automation` | platform-api / event-model / event-bus / device-model / state-store (per Doc 07 §3.1) |
| `configuration` | platform-api / event-model / event-bus |
| `integration-api` | re-exports platform-api, event-model, device-model; `requires transitive` for each |
| `integration-runtime` | integration-api, event-bus, lifecycle |
| `integration-zigbee` | integration-api |
| `rest-api` | state-store, event-bus, event-model, device-model, automation |
| `websocket-api` | state-store, event-bus, event-model |
| `observability` | event-model, event-bus, lifecycle |
| `lifecycle` | event-bus, persistence, state-store, observability, configuration, integration-runtime, api modules |
| `test-support` | (utility; depends on the modules it tests) |
| `homesynapse-app` | every module above; all `requires` non-transitive; **no `exports`** |
| `dashboard` | Preact SPA — not a JPMS module |

The `state-store` row's `event-model (T)` promotion is the post-Deliverable-0 state. Before Deliverable 0, that line read `event-model (non-transitive)` and is what made `ProjectionAdvancer.advance`'s `EventEnvelope` parameter a leaked-type failure under `-Werror` (see §19).

`homesynapse-app` is the assembly apex: it composes the runtime by manually instantiating each service from each module and wiring them together. It has zero `exports` because nothing outside the app is allowed to depend on the app.

---

## §4 — Event model

### 4.1 `DomainEvent` and the sealed/non-sealed decision

`DomainEvent` is a **non-sealed marker interface** in `com.homesynapse.event` (AMD-33). The original Phase 2 intent was to seal it for exhaustive `switch` discrimination, but the architecture admits subtypes that live in a different JPMS module: `IntegrationLifecycleEvent` in `com.homesynapse.integration` extends `DomainEvent`, and JEP 409 requires every permitted subtype of a sealed interface to be in the same module. AMD-33 makes this decision permanent: `DomainEvent` will never be sealed. Type discovery uses the `@EventType` annotation (LTD-19) plus the `EventTypeRegistry` reflection at startup, rather than `Class.getPermittedSubclasses()`. The `NO_JSON_TYPE_INFO_IN_EVENTS` ArchUnit rule keeps Jackson's competing type-info mechanism out.

Twenty-two core payload records in `event-model` implement `DomainEvent` and carry `@EventType(EventTypes.CONSTANT)`. The 23rd implementor, `DegradedEvent`, is deliberately unannotated: it is the fallback wrapper produced by `EventPayloadCodec.decode` when an event's payload cannot be upcast to the current schema version, and it must never be registered for forward serialization.

### 4.2 `EventEnvelope` (14 fields)

The `EventEnvelope` record is the universal immutable wrapper produced by `EventPublisher` (Doc 01 §4.1; `event-model/MODULE_CONTEXT.md`). Fields (in declared order):

| # | Field | Java type | Source-of-truth note |
|---|---|---|---|
| 1 | `eventId` | `EventId` (record wrapping `Ulid`) | Generated by `EventPublisher` at append time via `UlidFactory(clock)`. |
| 2 | `eventType` | `String` | Dotted-namespace for integrations (`zigbee.network_map_updated`); underscored for core (`state_reported`). |
| 3 | `schemaVersion` | `int`, ≥ 1 | Per `(eventType, schemaVersion)` discriminator (INV-ES-07). |
| 4 | `ingestTime` | `Instant`, non-null | System clock at append time. Storage: microseconds since epoch. |
| 5 | `eventTime` | `Instant`, nullable | When the real-world occurrence happened (INV-ES-08). Null if the source has no reliable clock. |
| 6 | `subjectRef` | `SubjectRef` | `(Ulid id, SubjectType type)`; static factories for entity / device / integration / automation / system / person. |
| 7 | `subjectSequence` | `long`, ≥ 1 | Monotonic per subject; UNIQUE constraint enforces optimistic concurrency. |
| 8 | `globalPosition` | `long` | SQLite `INTEGER PRIMARY KEY` (the rowid); strictly monotonic across all subjects. |
| 9 | `priority` | `EventPriority` enum | `CRITICAL(0) / NORMAL(1) / DIAGNOSTIC(2)`; `severity()` is the comparison method (not `ordinal()`). |
| 10 | `origin` | `EventOrigin` enum | `PHYSICAL / USER_COMMAND / AUTOMATION / DEVICE_AUTONOMOUS / INTEGRATION / SYSTEM / UNKNOWN`. |
| 11 | `categories` | `List<EventCategory>`, non-empty | Defensive copy via `List.copyOf()`. Populated at publish time from a compile-time mapping in `EventCategoryMapping`; not configurable. |
| 12 | `causalContext` | `CausalContext` record | 2 fields: `correlationId Ulid` (non-null; equals `eventId` for root events); `causationId Ulid` (nullable; null only for root events). |
| 13 | `actorRef` | `Ulid`, nullable | User identity (PersonId / AutomationId / SystemId) attributable to the event. Top-level envelope field (not inside `CausalContext`) so it can be indexed directly for multi-user audit trails (INV-MU-01). |
| 14 | `payload` | `DomainEvent` | The event-type-specific record. |

The compact constructor validates every field eagerly. `CausalContext` carries **only** `correlationId` and `causationId` — the absence of `traceDepth` or `actorRef` from `CausalContext` is a deliberate design decision: actor flows on the envelope (for direct indexing); chain depth is computable from the events table via `idx_events_correlation` and is not stored.

### 4.3 The typed-ULID identity model (`platform-api`)

LTD-04 fixes ULID as the universal identity primitive: 128 bits, 26-character Crockford Base32 at API boundaries, BLOB(16) in SQLite. `platform-api` provides:

- `Ulid` — the raw ULID type plus `UlidFactory(Clock)` for generation.
- `EventId` — `record(Ulid value) implements Comparable<EventId>` with `EventId.of(Ulid)`, `EventId.parse(String)`.
- `EntityId`, `DeviceId`, `AreaId`, `AutomationId`, `PersonId`, `HomeId`, `IntegrationId`, `SystemId` — typed wrappers, each a record holding a `Ulid` plus a `parse(String)` static factory and a `toString()` that emits Crockford Base32.

`SubjectRef(Ulid id, SubjectType type)` discriminates the ULID by subject kind without dereferencing into the type system. The static factories on `SubjectRef` (`entity(EntityId)`, `device(DeviceId)`, `integration(IntegrationId)`, `automation(AutomationId)`, `system(SystemId)`, `person(PersonId)`) accept the typed wrapper but store the raw `Ulid` — this is intentional and keeps `EventEnvelope.subjectRef` from carrying a sealed-type that would need refining at every consumer.

### 4.4 Event-type families

Doc 01 §4.3 organizes event types into families. Production families and example types:

- **Command lifecycle** (4 types): `command_issued`, `command_dispatched`, `command_result`, `command_confirmation_timed_out`.
- **State lifecycle** (8 types): `entity_profile_changed`, `entity_enabled`, `entity_disabled`, `state_reported`, `state_report_rejected`, `state_changed`, `state_confirmed`.
- **Device lifecycle** (5 types): `device_discovered`, `device_adopted`, `device_removed`, `device_metadata_changed`, `availability_changed`.
- **Automation** (2 types): `automation_triggered`, `automation_completed`.
- **Presence** (Tier 2 — vocabulary reserved at MVP, no producer): `presence_signal`, `presence_changed`.
- **System** (multiple): `system_started`, `system_stopped`, `migration_applied`, `snapshot_created`, `system_storage_critical`, `system_registry_rebuilt`, `storage_pressure_changed`, `system_integrity_failure`, `system_backup_failed`, `telemetry_store_rebuilt`, `persistence_vacuum_failed`, `persistence_retention_incomplete`, `subscriber_checkpoint_expired`, `subscriber_falling_behind`, `causality_depth_warning`.
- **Configuration**: `config_changed`, `config_error`.
- **Telemetry**: `telemetry_summary` (aggregated; the raw `state_reported` events for numeric attributes are augmented by a separate telemetry ring store in `persistence` — see §5).
- **Integration lifecycle** (5 types, defined in `integration-api`): `integration_started`, `integration_stopped`, `integration_health_changed`, `integration_restarted`, `integration_resource_exceeded`.
- **Automation capability mismatch**: `automation_capability_mismatch`.

The four conceptual families noted in the prompt — **device-observed, state-derived, lifecycle, integration-runtime** — map onto this taxonomy as follows: device-observed = `state_reported`, `device_discovered`, `availability_changed`, raw protocol events; state-derived = `state_changed`, `state_confirmed`, `state_report_rejected`, derived events from State Projection; lifecycle = `entity_*`, `device_adopted`, `device_removed`, `device_metadata_changed`, `system_*`; integration-runtime = the five `integration_*` lifecycle events plus protocol-namespaced events (`zigbee.*`).

### 4.5 The publish path

`EventPublisher` is the **only** write path into the event store (INV-ES-04, AMD-26). Methods:

- `EventEnvelope publish(EventDraft draft, CausalContext context)` — for derived events.
- `EventEnvelope publishRoot(EventDraft draft)` — for root events; actorRef comes from the draft.

`EventDraft` carries 9 fields after AMD-35: `eventType`, `schemaVersion`, `eventTime` (nullable), `subjectRef`, `priority`, `origin`, `payload`, `actorRef` (nullable), `idempotencyKey` (nullable, max 128 chars, non-blank when non-null). The publisher assigns the five fields the caller cannot know: `eventId`, `ingestTime`, `subjectSequence`, `globalPosition`, `categories`.

The canonical implementation is `SqliteEventStore` (package-private in `core/persistence`), which implements both `EventPublisher` and `EventStore`. The publish path is `EventPublisher.publish()` → `WriteCoordinator.submit(EVENT_PUBLISH, callable)` (handoff to the single platform thread `hs-write-0`) → SQLite WAL append → `EventBus.notifyEvent(globalPosition)` after the WAL commit returns. AMD-26 mandates this serialization; the WAL append is a single `INSERT` with 24 bind positions covering all 25 V001 columns minus `global_position` (which is `AUTOINCREMENT`). The publisher reads the `globalPosition` back via `Statement.getGeneratedKeys()` and constructs the returned `EventEnvelope` from the now-populated row.

`EventPublisher` was named "EventPublisher" not "EventAppender" — the canonical name is `EventPublisher`, present on `Doc 01 §8.3` and on the `event-model/MODULE_CONTEXT.md`. The publisher's "synchronous" promise is INV-ES-04: the WAL commit completes before the method returns.

### 4.6 The `EventStore` read surface

The `EventStore` interface (Doc 01 §8.1, `event-model/MODULE_CONTEXT.md`) exposes six read methods:

- `readFrom(long position, int limit) → EventPage`
- `readBySubject(SubjectRef ref, long fromSequence, int limit) → EventPage`
- `readByCorrelation(Ulid correlationId) → List<EventEnvelope>`
- `readByType(String eventType, long fromPosition, int limit) → EventPage`
- `readByTimeRange(Instant from, Instant to, long fromPosition, int limit) → EventPage`
- `latestPosition() → long`

`EventPage` is a record `(List<EventEnvelope> events, long nextPosition, boolean hasMore)` with defensive copy via `List.copyOf()`. The SQLite implementation routes every read through `ReadExecutor.execute(callable)` to a platform thread with round-robin `ThreadLocal<Connection>` binding (so a single logical read uses exactly one connection — required for cursor stability).

### 4.7 Exception hierarchy

`HomeSynapseException` is the abstract base for typed domain errors: every subclass implements `errorCode()` (a dotted string like `"entity.not_found"`) and `suggestedHttpStatus()` (the integer the REST API uses to translate the exception). Subclasses present in event-model:

- `EntityNotFoundException` — `"entity.not_found"` / 404.
- `DeviceNotFoundException` — `"device.not_found"` / 404.
- `CapabilityMismatchException` — `"capability.mismatch"` / 409.
- `ConfigurationValidationException` — `"config.validation_failed"` / 422.
- `IntegrationUnavailableException` — `"integration.unavailable"` / 503.

`SequenceConflictException` is intentionally **not** a `HomeSynapseException` subclass — it is an optimistic-concurrency signal carrying `subjectRef` and `conflictingSequence`, raised by `EventPublisher.publish` when the `UNIQUE(subjectRef, subjectSequence)` constraint fires. The REST API does not surface it as a 4xx; it surfaces as a retryable internal condition.

---

## §5 — Persistence layer

### 5.1 SQLite as the substrate (LTD-03)

LTD-03 fixes SQLite as the default persistence engine. The runtime database is a single file (`homesynapse-events.db`) opened in WAL mode with a specific PRAGMA recipe, verified empirically by the D1 WAL Pathology Validation Spike (`research/sqlite-wal-validation-spike-results.md`, 2026-04-02 measurement, codified 2026-05-15). The seven PRAGMA values are:

```
journal_mode         = wal            -- write-ahead log
synchronous          = NORMAL         -- fsync on WAL commit, not every page
cache_size           = -128000        -- 128 MB page cache (negative = KB)
mmap_size            = 1073741824     -- 1 GB mmap region
temp_store           = MEMORY         -- temp tables in RAM, not /tmp
journal_size_limit   = 6144000        -- 6 MB WAL cap (AMD-39 WITHDRAWN; 6 MB is sufficient under bounded-window reader)
busy_timeout         = 5000           -- 5 seconds before SQLITE_BUSY
```

The page size is set at creation time to `4096` and `auto_vacuum=INCREMENTAL` is set once before any tables exist. These are creation-time PRAGMAs and cannot be changed on an existing database. `DatabaseExecutor` distinguishes "new" from "existing" databases via `SELECT count(*) FROM sqlite_master WHERE type='table'` and only sets the creation-time PRAGMAs on a new database.

`DeploymentProfile` (M2→M3 bridge) tunes `cache_size` and `mmap_size` per hardware tier: `STUDIO` (2 MB cache, 64 MB mmap), `HOME` (16 MB cache, 256 MB mmap; the MVP default), `PERFORMANCE` (64 MB cache, 1 GB mmap). `journal_size_limit` is **uniform at 6 MB across all profiles** — this is the empirical result from the D1 spike, recorded explicitly in `PersistenceConfig`'s `HOME_DEFAULT` constant.

### 5.2 The single-writer invariant (AMD-26)

`sqlite-jdbc`'s native JNI methods are `synchronized native` — they pin the calling thread's carrier. Virtual threads parked inside a `synchronized native` call cannot be unmounted by the JVM scheduler. AMD-26 mitigates this by serializing **all** SQLite writes through a single dedicated platform thread (`hs-write-0`) servicing a `PriorityBlockingQueue` of `WorkItem`s. Virtual threads call `WriteCoordinator.submit(WritePriority, Callable)`, which enqueues the work and parks the VT on a `CompletableFuture<T>`; the writer thread dequeues by priority and runs the callable, completing the future on success or exceptionally on failure.

`WritePriority` (package-private enum, 5 values, with rank — lower = higher priority):

1. `EVENT_PUBLISH` (rank 1) — user-facing event appends.
2. `STATE_PROJECTION` (rank 2) — derived state event publishes and checkpoint writes.
3. `WAL_CHECKPOINT` (rank 3) — `PRAGMA wal_checkpoint(PASSIVE)` calls.
4. `RETENTION` (rank 4) — AMD-40-routed retention purge batches.
5. `BACKUP` (rank 5) — pre-upgrade or scheduled backup.

A `PriorityBlockingQueue` with an `AtomicLong` FIFO tiebreaker preserves per-priority ordering. The implementation is `PlatformThreadWriteCoordinator` (package-private, final) in `core/persistence`.

### 5.3 The single-writer's `BEGIN IMMEDIATE` discipline

Because all writes serialize through the writer thread, `SqliteEventStore.publish()` does not need an explicit `BEGIN IMMEDIATE` — the writer thread is the only writer and there is no contention to escalate. However, `AtomicCheckpointWriter` (M2.8) explicitly disables autoCommit before its two-row `INSERT OR REPLACE` sequence (one row to `subscriber_checkpoints`, one to `view_checkpoints`) and commits at the end, so the two checkpoints land atomically. This is the source of the "park-and-advance is atomic" claim in AMD-36.

The `globalPosition` is assigned by SQLite's `INTEGER PRIMARY KEY AUTOINCREMENT` semantics and read back via `Statement.getGeneratedKeys()`. Because exactly one thread is performing inserts, contiguous global positions are guaranteed (no gaps from rolled-back transactions during normal operation).

### 5.4 AMD-27 — the bounded read executor

AMD-27 codifies the symmetric read path. Read operations run on a bounded pool of platform threads (`hs-read-0`, `hs-read-1`, …) using `Executors.newFixedThreadPool` with a custom daemon `ThreadFactory`. The default pool size is **2 platform threads** (the prompt's "2–3" range; the codebase default is 2). The interface is `ReadExecutor`:

- `<T> T execute(Callable<T>) → T` — synchronous; the caller parks on `future.get()`. Checked exceptions are wrapped in `RuntimeException`; `RuntimeException` and `Error` propagate directly.
- `void shutdown()` — calls `ExecutorService.shutdown()` then `awaitTermination(5 s)`, falling back to `shutdownNow()`.

Each virtual-thread caller binds to a single read connection via a round-robin selection from `DatabaseExecutor.readConnections()` (an unmodifiable snapshot) plus a `ThreadLocal<Connection>` on the chosen pool worker. This guarantees cursor stability for a single logical read.

### 5.5 WAL growth pathology — what D1 validated, what AMD-38 codified

`research/sqlite-wal-validation-spike-results.md` (D1, completed 2026-04-02) is the empirical foundation for AMD-38 and the AMD-39 withdrawal. Key measured outcomes on Raspberry Pi 5 (4 GB) with NVMe storage:

- **C1 Append throughput:** 100,000 events in 1.962 s = 50,964 events/sec (target: ≥ 10,000/sec). p99 insert latency: 45.4 µs. WAL file size: 4.4 MB.
- **C2 Checkpoint non-blocking:** PASSIVE checkpoint completed in 26 ms with 0 SQLITE_BUSY errors observed on 5 concurrent reader threads.
- **C3 Kill -9 durability:** 0 events lost across 5 trials of 500 events at 100 events/sec; SIGKILL applied at random 5–15 second intervals.
- **C4 Virtual-thread compatibility:** 1 writer VT + 20 reader VTs over 60 s — 0 SQLITE_BUSY errors, 0 deadlocks, 5,607 writes, 708,080 reads.
- **C5 Native library extraction from jlink image:** PASS.
- **V1 JFR pinning events:** 0 events observed — confirming that at this hardware's per-call latency (10–45 µs), no virtual thread needs to park mid-operation and the carrier-pinning is operationally invisible.

AMD-38 codifies the WAL-release discipline these results support:

- Checkpoint cadence: `event_threshold = 200` events OR `max_interval_seconds = 2` (whichever first).
- Bounded-window reader: `DEFAULT_MAX_ROWS = 500` per `ProjectionAdvancer.advance` call.
- The 200 / 2s / 500 numbers apply universally across the deployment spectrum at MVP (DEC-M3-12 via AMD-43 §3.6.6).

AMD-39 (proposed raise of `journal_size_limit` to 64 MB) was WITHDRAWN on 2026-05-15 once D1 confirmed that 6 MB is sufficient when the bounded-window reader keeps the WAL turning over.

### 5.6 Schema versions

The persistence schema is managed by Flyway-style migrations in `core/persistence/src/main/resources/db/migration/events/`. Migrations are forward-only (LTD-07), tracked in `hs_schema_version` (created by `MigrationRunner` on first run; columns: `version PK, checksum, description, applied_at, success`). Migration files are checksummed (SHA-256, lowercase hex) and a checksum mismatch on an applied version aborts startup.

| Version | Subject | Status |
|---|---|---|
| V001 | `events` (25 columns after the bridge), `subscriber_checkpoints`, `view_checkpoints`, plus indexes | Applied |
| V002 | `subscriber_dead_letters` (11 columns, `UNIQUE(subscriber_id, event_position)`, NO `status` column — row presence IS the parked state) | Applied (AMD-36) |
| V003 | `snapshots` table (per-entity state snapshots, 9 columns); also drops the redundant `idx_events_subject` index | **Migration file on disk; NOT YET enrolled in `SqlitePersistenceLifecycle.EVENTS_MIGRATION_FILES`** — wired in by M3.5b per AMD-41 §3.2.3 source-verification correction. |

The events table's 25 columns include the M2→M3 bridge additions: `home_id BLOB(16)` (AMD-34), `idempotency_key TEXT` (AMD-35, with a partial unique index `(home_id, idempotency_key) WHERE idempotency_key IS NOT NULL`), `chain_hash BLOB(32) NOT NULL DEFAULT (X'00…00')` (AMD-37), plus the six Tier-2 reservations from `AMD-M2Bridge` (`payload_size`, `batch_id`, `external_ref`, `intent_kind`, `logical_time`, `node_id`) which are populated with defaults (or `NULL`) by `SqliteEventStore` at INSERT time and have no Java API impact.

### 5.7 Retention (AMD-40)

AMD-40 specifies that the retention sweep:

- Runs on the persistence write executor at `WritePriority.RETENTION` (NOT on a separate thread; AMD-26 compliance).
- Schedules by interval, not by cron (`DEFAULT_MAINTENANCE_INTERVAL = Duration.ofHours(6)`).
- Purges in bounded chunks (`DEFAULT_PURGE_BATCH_SIZE = 1_000` rows per chunk).
- Holds the write lock for ≤ 2 seconds per chunk, then yields the writer between chunks.
- Storage-pressure-triggered runs (e.g. transitioning into the EMERGENCY state) may break the interval.

The `RetentionPolicy` record `(diagnosticDays, normalDays, criticalDays)` defaults to `(7, 90, 365)` (`RetentionPolicy.SOURCE_DEFAULT`, verified against `EventPriority` Javadoc on 2026-05-15). Each compact-constructor field requires ≥ 1.

### 5.8 Jackson serialization (LTD-08, LTD-19, AMD-33)

Jackson is fully isolated behind `core/persistence`. The four serialization classes — `PersistenceJacksonModule`, `PersistenceObjectMapper`, `JacksonWarmup`, `EventPayloadCodec` — and the four (de)serializer classes for ULID types are the only files that import Jackson; no Jackson type appears in any public API in any module.

The canonical `ObjectMapper` build recipe (`PersistenceObjectMapper.create()`):

- `JsonFactory` constructed with `JsonRecyclerPools.newConcurrentDequePool()` — virtual-thread-safe buffer recycling. The earlier `sharedBucketPool()` choice was corrected to `newConcurrentDequePool` after analysis showed VT-safe behavior under heavy concurrency was preferable.
- `JsonMapper.builder()` with `JavaTimeModule`, `BlackbirdModule` (faster reflection), and `PersistenceJacksonModule` (the project's custom ULID (de)serializers).
- `PropertyNamingStrategies.SNAKE_CASE`.
- `JsonInclude.Include.NON_NULL`.
- Disables `FAIL_ON_UNKNOWN_PROPERTIES` (LTD-08 schema-version leniency), `WRITE_DATES_AS_TIMESTAMPS` (ISO-8601 instants), and `INDENT_OUTPUT` (compact JSON for BLOB storage).
- **`ParameterNamesModule` is intentionally NOT registered** — the project relies on Jackson's record-component discovery without `-parameters`-style parameter-name resolution, simplifying the build configuration and avoiding a known cause of carrier-thread pinning under JVMs where `ParameterNamesModule` synchronizes on a static cache.

The Jackson floor is **2.18.4+**. The `@JsonTypeInfo` polymorphism mechanism is banned by `NO_JSON_TYPE_INFO_IN_EVENTS`; instead, `EventTypeRegistry` reads `@EventType(EventTypes.CONSTANT)` from each registered `DomainEvent` record at startup and builds a `String → Class<? extends DomainEvent>` map for deserialization dispatch.

`JacksonWarmup` is invoked once at startup on a platform thread (LTD-19): it calls `mapper.canSerialize(class)` and `mapper.canDeserialize(JavaType)` on every registered event type to populate Jackson's `SerializerCache` and `DeserializerCache`, which are normally lazily populated under a `synchronized` block (the cause of VT carrier pinning if hit by a VT at first-encounter time). Pre-populating from a platform thread sidesteps the pinning.

`EventPayloadCodec.decode(eventType, schemaVersion, payload)` implements the DegradedEvent fallback per DECIDE-M2-07:

1. Unknown event type → `DegradedEvent("Unknown event type: …")`.
2. Parse/validation failure → `DegradedEvent(exception class name + message)`.

Both paths sanitize metadata: null/blank `eventType` clamps to `"unknown"`, `schemaVersion < 1` clamps to `1`. `rawPayload` is decoded with `StandardCharsets.UTF_8`. Every fallback emits a WARN-level SLF4J log.

The `AttributeValue` (de)serializer is currently DEFERRED — none of the 22 core event records use `AttributeValue` as a field type, so a serializer is not yet required. It will land when an event payload first references it.

### 5.9 Sync scope classification

The `events` table is SYNCABLE — events are the durable history of the system and (in a future multi-instance design) flow between instances. The `subscriber_checkpoints`, `view_checkpoints`, and `hs_schema_version` tables are LOCAL-ONLY — they reflect this instance's processing state and must not be synced. This classification is per INV-LF-05 (convergent sync architecture) and is documented in the `AtomicCheckpointWriter` Javadoc (`MODULE_CONTEXT.md`).

---

## §6 — Threading and concurrency

### 6.1 Virtual threads vs platform threads

The Phase 3 runtime uses Java 21 virtual threads (Project Loom) for every concurrent activity that is not a SQLite JNI call. Specifically:

- **Virtual threads carry:** subscriber `onEvent` callbacks (one VT per subscriber, named `hs-sub-<subscriberId>`, per INV-SUB-ISO-01); the State Projection's orchestration loop; HTTP request handling in the REST API (`rest-api`); WebSocket session loops (`websocket-api`); integration adapters' protocol logic (the non-serial-I/O half of the hybrid thread architecture from Doc 05 §3.2); automation Run execution.
- **Platform threads carry:** every `sqlite-jdbc` call. The dedicated writer thread `hs-write-0` services `WriteCoordinator`; the bounded read pool (default 2 threads, `hs-read-0`, `hs-read-1`) services `ReadExecutor`. Integrations that perform serial I/O (e.g. the Zigbee USB serial coordinator) hold a dedicated platform thread per Doc 05 §3.2.

The handoff pattern from a virtual thread to a platform thread is: VT calls `WriteCoordinator.submit(priority, callable)` (or `ReadExecutor.execute(callable)`); the call enqueues a `CompletableFuture`-bearing work item; the platform worker dequeues, runs the callable, completes the future; the VT parks on `future.get()` and resumes when the result lands. Because the VT is parked on a normal `Future.get()` (not a `synchronized native` call), the carrier is free to run other VTs in the meantime.

### 6.2 LTD-11 (no `synchronized`) and ReentrantLock-only

LTD-11 forbids `synchronized` blocks or methods anywhere in core code. The `NO_SYNCHRONIZED_METHODS` ArchUnit rule enforces this. The motivation is virtual-thread compatibility: `synchronized` pins the carrier thread for the duration of the critical section, defeating the cost model of VTs. Where mutual exclusion is needed, the project uses `ReentrantLock` (which parks the VT on the wait queue without pinning the carrier). For lock-free read paths the project uses `ConcurrentHashMap` (e.g., `StateQueryService` is described as "lock-free reads from ConcurrentHashMap"); for atomic single-value updates `AtomicReference` / `AtomicLong`; for high-throughput counters `LongAdder`.

### 6.3 Clock injection discipline (DEC-M3-09)

The `NO_DIRECT_TIME_ACCESS` ArchUnit rule forbids direct calls to `Instant.now()`, `System.currentTimeMillis()`, `System.nanoTime()`, and `Clock.systemUTC()` anywhere in production code. Every time-reading site must accept an injected `java.time.Clock` and call `clock.instant()` (or equivalent). The rule has narrow exceptions (e.g., literal `Instant.parse("…")` constants in test fixtures are permitted because they do not read the wall clock).

DEC-M3-09 extends the rule's scope to every M3 component, including the M3 governance bundle's new surfaces:

- The `SelfProducedFilter`'s 60-second TTL (AMD-41 §3.2.2) uses the injected `Clock`.
- The supervisor's backoff scheduler (AMD-42 §3.4.5, `MIN=3s/MAX=30s/jitter=0.2`) uses the injected `Clock`.
- The `DerivedWriteRateLimit`'s 50ms-tick refill (AMD-43 §3.6.4) uses the injected `Clock`.
- The reconciliation pass's `reconciledAt` timestamp (AMD-41 §3.2.4) uses the injected `Clock`.

The AMD-42 citation note (preserved verbatim in the on-disk amendment file) explicitly corrects an earlier draft that misattributed clock-injection authority to AMD-39 — AMD-39 is WITHDRAWN and concerns the `journal_size_limit` PRAGMA, not clock discipline. Clock-injection authority is `NO_DIRECT_TIME_ACCESS` + DEC-M3-09; nothing else.

DEC-M3-09 also calls for a "single-Clock-per-module" discipline, currently enforced as a coding rule (each module accepts exactly one `Clock` injected at construction time and threads it to its components). A dedicated ArchUnit rule for this discipline is not yet defined — it remains a code-review and PM-enforcement matter.

### 6.4 The seven ArchUnit rules

`HomeSynapseArchRules` in `app/homesynapse-app/src/test/java/com/homesynapse/app/HomeSynapseArchRules.java` defines seven `ArchRule` constants, all checked together in `HomeSynapseArchRulesTest`. Listed with rationale:

1. `NO_SYNCHRONIZED_METHODS` (LTD-11) — virtual-thread carrier-pinning prevention; mandates `ReentrantLock`.
2. `NO_DIRECT_TIME_ACCESS` (DEC-M3-09) — deterministic testing and clock-driven correctness; mandates injected `Clock`.
3. `NO_SERVICE_LOADER` (DECIDE-04) — factories are instantiated directly; ensures the dependency graph is statically visible and that the assembly apex (`homesynapse-app`) owns the wiring decisions.
4. `NO_REVERSE_DEPENDENCIES` — keeps the JPMS dependency graph a DAG; prevents accidental cycles or upward dependencies (e.g., `event-model` cannot import `state-store`).
5. `NO_DIRECT_FILESYSTEM_IN_CORE` — core modules do not call `Files.*` directly; filesystem access goes through `PlatformPaths` (`platform-api` or `platform-systemd`); enables alternate path strategies and the LTD-13 systemd integration.
6. `NO_INTERNAL_PACKAGE_ACCESS` — code outside a module cannot reach into its non-exported packages; pairs with the "one flat package per module" rule.
7. `NO_JSON_TYPE_INFO_IN_EVENTS` (AMD-33, LTD-19) — `EventTypeRegistry`'s `@EventType` annotation is the discriminator, not Jackson's `@JsonTypeInfo`.

### 6.5 DECIDE-04 (no ServiceLoader)

`ServiceLoader` is forbidden because: (a) it hides the dependency graph from the assembly apex; (b) it discovers types reflectively, which is hostile to JPMS and to native-image compilation; (c) it makes the startup ordering opaque. Every factory and every integration is instantiated explicitly in `homesynapse-app`'s wiring code or in the lifecycle module.

---

## §7 — State projection and materialized views

### 7.1 `EntityState` — the 9-field record

`EntityState` (`com.homesynapse.state.EntityState`) is the immutable per-entity state snapshot. Fields:

| Field | Type | Notes |
|---|---|---|
| `entityId` | `EntityId` | Map key in the state store; from platform-api. |
| `attributes` | `Map<String, AttributeValue>` (unmodifiable) | Values may be `null` for attributes declared by the capability schema but never reported. |
| `availability` | `Availability` enum (`AVAILABLE`, `UNAVAILABLE`, `UNKNOWN`) | Runtime reachability of the backing device. `UNKNOWN` is the initial value at entity adoption. Orthogonal to enabled/disabled status. |
| `stateVersion` | `long` | Idempotency cursor. Advances on **every** processed event, not just mutations — a `state_reported` that matches canonical state still bumps the version. |
| `lastChanged` | `Instant` | Most recent meaningful state change. |
| `lastUpdated` | `Instant` | Most recent projection update (whether or not state actually changed). |
| `lastReported` | `Instant` | Most recent adapter communication (heartbeat freshness). |
| `staleAfter` | `Instant`, **nullable** | Computed staleness deadline. Null means "never stale" (event-driven reporters / actuators). |
| `stale` | `boolean` (derived at read time) | `staleAfter != null && clock.instant().isAfter(staleAfter)`. Not stored; computed in the read path. |

The three-timestamp model (`lastChanged`, `lastUpdated`, `lastReported`) is load-bearing: a sensor reporting the same temperature every 30 seconds is not stale even if its `lastChanged` is hours old; the system distinguishes "unchanged but fresh" from "stale".

### 7.2 `StateSnapshot` — the 5-field record

`StateSnapshot` is a point-in-time copy of the entire materialized state view. Fields:

| Field | Type | Notes |
|---|---|---|
| `states` | `Map<EntityId, EntityState>` (unmodifiable) | All currently-tracked entities at this snapshot. |
| `viewPosition` | `long` | The `globalPosition` of the most recent event processed into this snapshot. Monotonic. |
| `snapshotTime` | `Instant` | When the snapshot was assembled. |
| `replaying` | `boolean` | API-readiness signal: `true` while the State Projection is in REPLAY mode. The REST API returns HTTP 503 when `true` (unless the caller has explicitly opted into stale data). |
| `disabledEntities` | `Set<EntityId>` (unmodifiable) | Entities currently in the disabled state — present in `states` with frozen attributes, but distinguishable from enabled entities. |

The `replaying` flag is the canonical readiness signal: dependent subsystems (REST, WebSocket, Automation) must not commit to user-facing behavior while it is `true`.

### 7.3 The "stateVersion advances on every event" idempotency cursor

`stateVersion` is the State Projection's per-entity idempotency cursor. Because the cursor advances even when the event did not actually mutate canonical state, a subscriber receiving the same event twice during crash recovery will produce the same `stateVersion` value the second time, allowing the projection to detect duplicate delivery without comparing payloads. This is the foundation of INV-ES-05 (at-least-once with subscriber idempotency) for the projection specifically.

`stateVersion` is also the AMD-41 §3.2.2 defence-in-depth check: when the `SelfProducedFilter` misses (e.g., post-restart, when the in-memory set is empty), the projection compares the candidate derived event's `stateVersion` to the current materialized state; equal-or-lower versions are discarded.

### 7.4 `ViewCheckpointStore` vs `CheckpointStore` — the two-checkpoint-stores gotcha

The codebase has two interfaces with similar names in different modules. They are NOT the same and serve different purposes:

- **`com.homesynapse.event.bus.CheckpointStore`** (in `core/event-bus`) — stores a single `long globalPosition` per subscriber. Method: `readCheckpoint(String subscriberId) → long`, `writeCheckpoint(String subscriberId, long globalPosition)`. Backed by the `subscriber_checkpoints` table. Implemented in production by `SqliteCheckpointStore` (`core/persistence` M2.6).
- **`com.homesynapse.state.ViewCheckpointStore`** (in `core/state-store`) — stores an opaque serialized view-state blob keyed by view name. Methods: `writeCheckpoint(String viewName, long position, byte[] data)`, `readLatestCheckpoint(String viewName) → Optional<CheckpointRecord>`. Backed by the `view_checkpoints` table. Implemented in production by `SqliteViewCheckpointStore` (`core/persistence` M2.7).

The `state-store/MODULE_CONTEXT.md` Javadoc cross-references both names to help developers distinguish them. They were intentionally named differently after Doc 03's original `CheckpointStore` name collided with the bus's `CheckpointStore`.

### 7.5 `ProjectionAdvancer` post-Deliverable 0

`ProjectionAdvancer` (`com.homesynapse.state.ProjectionAdvancer`) is the cursor runner for the State Projection. After M3 Deliverable 0 (2026-05-16), its single method is:

```java
AdvanceResult advance(long fromPosition, int maxRows, Consumer<EventEnvelope> processor);
```

Contract (verbatim from the source Javadoc + AMD-41 §3.2.1):

- The implementation opens a read transaction on entry.
- It invokes `processor.accept(envelope)` for each event read in `globalPosition` order, **inside the read transaction**.
- It closes the read transaction before the method returns. The transaction is closed even if `processor` throws (the exception propagates).
- The `processor` MUST NOT call `EventPublisher.publish()`, MUST NOT open writes against any `core/state-store` connection, and MUST NOT block on resources held elsewhere by the calling VT.
- Derived publishes are buffered by the processor implementation and emitted by the projection AFTER `advance` returns (two-phase discipline).
- A single call is capped at `DEFAULT_MAX_ROWS = 500` rows AND ≤ 2 s wall-clock, even if the caller passes a larger `maxRows`. This is the AMD-38 bounded-window invariant.
- Events are delivered in strict `globalPosition`-ascending order.
- `advance` is single-threaded with respect to the caller's VT and MUST NOT spawn helper threads.

The constant `DEFAULT_MAX_ROWS = 500` is exposed on the interface.

### 7.6 `AdvanceResult`

`AdvanceResult` is a 3-field record:

- `lastProcessedPosition` (`long`, ≥ 0) — the highest `globalPosition` delivered in this call, or the input `fromPosition` if no events were delivered.
- `eventsProcessed` (`int`, ≥ 0) — the number of events delivered.
- `hasMore` (`boolean`) — `true` if more events remain in the log beyond `lastProcessedPosition`; `false` otherwise.

The compact constructor validates non-negativity. The `hasMore == false && eventsProcessed == 0` tuple signals "caught up to writer head" — the caller may park until the next `EventBus.notifyEvent()` fires.

### 7.7 AMD-41's two-phase execution model (full)

AMD-41 §3.2.1 (verbatim spec, source-verified): the `StateProjection` subscriber runs on a per-subscriber virtual thread (AMD-42 §3.4). Each event delivery executes the following strict sequence:

1. **READ phase.** Open a read transaction on the subscriber's dedicated SQLite read connection via `ProjectionAdvancer`. The processor computes the derivation: load the prior state for the affected entity from the `EntityState` cache, apply the event, produce zero or more derived `state_changed` `EventDraft` instances **into an in-memory buffer**. **The read transaction closes when `advance` returns; the buffer holds the derived drafts.**
2. **PUBLISH phase.** For each buffered `EventDraft`, call `EventPublisher.publish(draft, causalContext)` sequentially on the projection's virtual thread. **No separate `WriteBatcher` thread exists.** Each `publish()` parks the VT on the writer's platform thread through the AMD-26 / AMD-27 handoff. The next `publish()` does not begin until the current one returns.
3. **CHECKPOINT phase.** After all derived publishes return, the projection records the source event's `globalPosition` via `ViewCheckpointStore.writeCheckpoint(viewName, position, data)`. Checkpoint cadence remains governed by AMD-38 (200 events OR 2 seconds).

AMD-41 explicitly notes the `WriteBatcher` thread referenced in earlier drafts is **not** introduced; the projection's own VT is the only orchestrator. This decision is the DEC-M3-01 lock.

### 7.8 `SelfProducedFilter` (AMD-41 §3.2.2)

The State Projection maintains an in-memory `SelfProducedFilter` keyed by `EventEnvelope.eventId` (`Ulid`). On every successful `EventPublisher.publish()` from the projection, the resulting envelope's `eventId` is inserted into the set with a 60-second TTL (clock from injected `Clock`). On every inbound delivery, the projection checks the filter; matches return immediately without re-derivation.

- **Eviction is lazy.** Expiry is checked on `isSelfProduced()`; expired entries are removed inline. No background sweeper thread.
- **No hard cap at MVP.** The memory envelope is bounded by `throughput × 60s`. At the M3.4 throughput floor of 100 events/sec, the set holds at most ~6000 ULIDs (≈ 96 KB at 16 bytes per ULID plus map overhead). A hard cap is deferred until empirical evidence justifies the complexity.
- **REPLAY/TRANSITION bypass.** During `SubscriberMode.REPLAY` and `SubscriberMode.TRANSITION` (AMD-42 §3.4.1), `isSelfProduced()` returns `false` unconditionally. Replay must re-derive deterministically from the log; the in-memory filter from the previous process is gone.
- **`stateVersion` defence-in-depth.** If the filter misses (e.g., restart loses the in-memory set), the projection compares the candidate derived event's `stateVersion` to the current materialized state. Equal-or-lower versions are discarded.

### 7.9 AMD-41's reconciliation pass

When the projection observes `projectionVersion(persisted_checkpoint) ≠ projectionVersion(current_code)`, the projection enters a **reconciliation pass** (AMD-41 §3.2.4):

1. The operator flag `homesynapse.projection.allow_stale_snapshots` is read. If `true`, the projection logs WARN and proceeds with the stale checkpoint (escape hatch).
2. If `false` (default), the projection discards the checkpoint, resets its in-memory state to empty, and replays from `position = 0` under `SubscriberMode.REPLAY`. The reconciliation timestamp (from injected `Clock`) is recorded on the new checkpoint as `reconciledAt`.
3. During reconciliation, the self-produced filter is bypassed (REPLAY mode); the writer is not invoked because the projection emits derived events only after exiting REPLAY.
4. On completion, `onCaughtUp()` fires exactly once (AMD-42 §3.4.3) and the projection transitions to LIVE.

The reconciliation pass is the **only** mechanism for handling projection-code version drift in M3.

Reconciliation metadata (`reconciledAt`, `fromVersion`, `toVersion`) is serialized into the existing opaque `CheckpointRecord.data` byte slot via the Jackson codec. **No schema migration is required** — `CheckpointRecord` already has `byte[] data` and `int projectionVersion` from Phase 2.

### 7.10 Per-entity snapshots (V003)

The V003 migration creates the `snapshots` table (`v003_snapshots_design_note.md`). Columns: `snapshot_id BLOB(16) PK`, `subject_ref BLOB(16)`, `subject_type TEXT`, `last_position INT`, `last_subject_seq INT`, `schema_version INT DEFAULT 1`, `taken_at INT` (microseconds), `payload_size INT`, `payload BLOB`. The `idx_snapshots_subject` unique index keys `(subject_ref, subject_type, last_subject_seq DESC)` so the most recent snapshot for an aggregate is the first row.

The schema is wired but the `SqliteSnapshotStore` implementation is **deferred until empirical evidence justifies it**: when full replay from `position = 0` exceeds **5 seconds** wall-clock on the Pi 4 reference hardware, M3.5b's deferred work is unblocked. The 5-second gate is per AMD-41 §3.2.3.

The V003 migration file lives on disk today but is **not yet enrolled** in `SqlitePersistenceLifecycle.EVENTS_MIGRATION_FILES` — this enrollment is part of M3.5b.

---

## §8 — Event bus and subscriber model

### 8.1 Pull-based, not push-based

The `EventBus` (`com.homesynapse.event.bus`) is a notification-driven pull-based bus. Its public methods at MVP are:

- `subscribe(SubscriberInfo info)` — register a subscriber.
- `unsubscribe(String subscriberId)` — remove a subscriber.
- `notifyEvent(long globalPosition)` — called by `SqliteEventStore` after a WAL commit; wakes matching subscribers via `LockSupport.unpark()`.
- `subscriberPosition(String subscriberId) → long` — diagnostic readout.

The bus does **not** deliver events. Subscribers wake up, then pull events from `EventStore.readFrom(checkpoint, batch)` themselves. The rationale (Doc 01 §3.4; `event-bus/MODULE_CONTEXT.md`):

- Enables per-subscriber backpressure without blocking the publisher.
- Slow subscribers do not affect fast subscribers.
- Crash recovery is trivial — resume from checkpoint.
- The bus itself holds no event buffer (no memory cost in the bus layer).

The alternative (push-based with per-subscriber queues) was rejected due to memory overhead on a constrained Pi and complex failure modes under slow subscribers.

### 8.2 `SubscriberInfo` (3 fields)

`SubscriberInfo` is an immutable record:

- `subscriberId` (`String`, non-null, non-blank) — stable across restarts; used as PK in `subscriber_checkpoints` and in `subscriber_dead_letters`.
- `filter` (`SubscriptionFilter`, non-null) — see §8.3.
- `coalesceExempt` (`boolean`) — exempts the subscriber from DIAGNOSTIC-event coalescing (State Projection and Pending Command Ledger set this `true`). At M3, coalescing is DEFERRED past M3 per AMD-43 §3.6.5 (DEC-M3-07), so `coalesceExempt` is **retained but inert**.

`subscriberId` is intentionally a plain `String`, not a typed wrapper: subscribers are infrastructure components, not domain objects; they don't need ULID identity or the type safety of domain IDs.

### 8.3 `SubscriptionFilter`

`SubscriptionFilter` is a 3-field record:

- `eventTypes` (`Set<String>`) — empty set means **all** types (wildcard); a non-empty set restricts to listed types. Defensive copy via `Set.copyOf()`.
- `minimumPriority` (`EventPriority`, non-null) — events with `severity > filter.minimumPriority.severity()` are filtered out.
- `subjectTypeFilter` (`SubjectType`, **nullable**) — null means all subject types; non-null restricts to one subject type.

`filter.matches(EventEnvelope)` is a **conjunction** of all criteria; an event must satisfy every active criterion. Factory helpers: `SubscriptionFilter.all()`, `forTypes(String...)`, `forPriority(EventPriority)`.

### 8.4 `CheckpointStore` (subscriber positions)

`CheckpointStore.readCheckpoint(String subscriberId) → long` returns `0L` when the subscriber has never checkpointed — this is the only signal for "start from the beginning of the log." The production implementation `SqliteCheckpointStore` routes reads through `ReadExecutor` and writes through `WriteCoordinator(STATE_PROJECTION priority)`. `last_updated` is stamped in microseconds (matching the events table's `ingest_time`/`event_time` format).

### 8.5 Two test buses — the gotcha

- **`InMemoryEventBus`** (in `core/event-bus`'s `testFixtures`) — a contract-complete reference implementation. Constructor: `InMemoryEventBus(EventStore, CheckpointStore)`. Evaluates `SubscriptionFilter.matches(envelope)` synchronously, mirrors the production wiring graph, and is the bus the contract tests run against.
- **`SynchronousEventBus`** (in `testing/test-support`) — a lightweight test bus that invokes all handlers regardless of filter. Suitable for unit tests where filter evaluation is not the focus.

These are two different fixtures with overlapping intent. `InMemoryEventBus` is the right choice for contract tests and integration-level testing; `SynchronousEventBus` is the right choice for trivial unit-level scenarios.

### 8.6 The pending production `InProcessEventBus` (M3.1)

The production `EventBus` implementation lands in M3.1 as `InProcessEventBus`. M3.1 implements:

- The `EventBus` skeleton.
- The cold-start registration path (subscribers registered with COLD mode).
- `notifyEvent(globalPosition)` wiring from `SqliteEventStore`'s post-commit hook.
- Integration with `SqliteCheckpointStore`.

M3.2 lands the REPLAY → LIVE algorithm per AMD-42.

### 8.7 AMD-42 — subscriber lifecycle (full)

**§3.4.1 — Subscriber mode state machine.** Every subscriber exposes a mode in `{ COLD, REPLAY, TRANSITION, LIVE, SUSPENDED }` via `SubscriberInfo.mode()`. Transitions are atomic (single `AtomicReference<SubscriberMode>` per subscriber) and observable to operators through the bus's introspection API.

```
COLD ──register()──▶ REPLAY ──reachedLiveTail()──▶ TRANSITION ──drainComplete()──▶ LIVE
                                                                                    │
                                                                                    │ circuitBreaker.trip()
                                                                                    ▼
                                                                                SUSPENDED
```

**§3.4.2 — Three-phase REPLAY → LIVE transition.**

1. **COLD.** Initial state on `EventBus.subscribe(subscriberInfo)`. No reads, no writes.
2. **REPLAY.** The bus reads the subscriber's persisted checkpoint via `CheckpointStore`, opens the subscriber's dedicated read connection (§3.4.4), and begins delivering events from `checkpoint + 1` in pages of `MAX_REPLAY_PAGE = 500` (AMD-38 bounded-window). During REPLAY: events arrive in strict `globalPosition` order; events newly published during REPLAY are captured in the subscriber's `ReplayWindowQueue` (bounded at 10000) and drained in TRANSITION; the subscriber MUST NOT call `EventPublisher.publish()` from `onEvent()` (defence-in-depth check rejects with `IllegalStateException`).
3. **TRANSITION.** When `ProjectionAdvancer.advance()` reports tail reached (`hasMore == false && eventsProcessed == 0`), the bus transitions to TRANSITION and runs `drainAndPromote`: drain the `ReplayWindowQueue` in `globalPosition` order, skipping events already delivered during REPLAY (gap detection).
4. **LIVE.** After drain completes, `onCaughtUp()` fires exactly once (single-shot per process per subscriber per §3.4.3); the mode atomically transitions to LIVE. From this point, events are delivered via standard notification (`EventBus.notifyEvent(globalPosition)` → VT pull from `EventStore.readFrom(checkpoint, batch)`).
5. **SUSPENDED.** Entered when the supervisor's circuit breaker trips (§3.4.5). No deliveries. Operator-recoverable via `EventBus.resume(subscriberId)`.

**§3.4.3 — `onCaughtUp()` semantics.** Fires exactly once per process lifetime per subscriber, after the TRANSITION → LIVE atomic CAS succeeds and before any LIVE-mode delivery. The default implementation is a no-op. Exceptions thrown from `onCaughtUp()` are caught by the supervisor and treated as a synthetic-event delivery failure (DLQ logged with a synthetic `CAUGHT_UP_TRANSITION` event-position marker).

**§3.4.4 — Per-subscriber resources (INV-SUB-ISO-01..06).** One VT per subscriber (`hs-sub-<subscriberId>`); one dedicated SQLite read connection (held for the subscriber's lifetime; allocated via `DatabaseExecutor.readExecutor()` round-robin with a `ThreadLocal<Connection>` binding); one `SubscriberDlq` instance per subscriber backed by the per-`subscriberId` rows in `subscriber_dead_letters` (V002, AMD-36); one `AtomicReference<SubscriberMode>`; one `ReplayWindowQueue` per subscriber (REPLAY entry → drain complete; GC'd after LIVE transition); one `SelfProducedFilter` per derivation-producing subscriber (only `StateProjection` at MVP).

**§3.4.5 — `SubscriberSupervisor`.** Per-subscriber. Wraps `subscriber.onEvent(envelope)` calls in try/catch:

- On success: increment `deliveryCount`; reset the consecutive-failure counter.
- On exception: append to the in-memory DLQ ring (cap 1024); persist to `subscriber_dead_letters` (AMD-36 — note no `status` column; row presence IS the parked state); increment `crashCount` within the rolling 10-minute window; schedule retry with backoff `MIN = 3s, MAX = 30s, jitter = 0.2`. After 5 retries (AMD-36 default) OR `crashCount >= 5` within 10 minutes, the circuit breaker trips: `mode → SUSPENDED`, emit `CRITICAL` on `subscriber.<id>.suspended`.
- `EventBus.resume(subscriberId)` clears the crash window, transitions SUSPENDED → REPLAY (re-bootstrap from last checkpoint), and re-attempts delivery.

The backoff scheduler uses the injected `Clock` (DEC-M3-09, enforced by `NO_DIRECT_TIME_ACCESS`).

**§3.4.6 — Cross-subscriber isolation guarantees.** A failure in subscriber A MUST NOT affect subscriber B's mode, queue, connection, DLQ, or delivery cadence. The bus MUST be tested with a contract test per INV-SUB-ISO-01..06 demonstrating no cross-contamination.

### 8.8 AMD-36 — DLQ table

The `subscriber_dead_letters` table (V002 migration) has 11 columns and a `UNIQUE(subscriber_id, event_position)` constraint. There is **no `status` column** — row presence IS the parked state. Default retry cap is 5. Park-and-advance atomicity (insert into DLQ + advance subscriber checkpoint past the parked position) is provided by `AtomicCheckpointWriter` (M2.8) executing both writes inside one transaction at `WritePriority.STATE_PROJECTION`.

---

## §9 — Backpressure and observability (AMD-43)

### 9.1 The non-blocking publish invariant (INV-BUS-02)

AMD-43 §3.6.1 is normative: `EventPublisher.publish()` is non-blocking on writer queue depth. The publisher does not introduce additional blocking via `Semaphore.acquire`, `wait`, `Lock.lock` keyed on queue depth, or any other depth-gated mechanism. Saturation manifests as elevated per-call latency, never as `publish()` hanging.

Natural backpressure arises from the single-thread write executor (AMD-26): callers park on their handoff `CompletableFuture`, which completes only when the writer drains to their slot. There is no separate "publisher backpressure" mechanism — the AMD-26 handoff IS the backpressure.

AMD-43 §3.6.1 is enforced by a new M3.3 ArchUnit rule `EVENT_PUBLISHER_HAS_NO_DEPTH_GATED_LOCK`: no class in `core/persistence` or `core/event-bus` may import `java.util.concurrent.Semaphore`, `java.util.concurrent.locks.Lock`, or call `Object.wait()` in a code path reachable from `EventPublisher.publish()`. The writer's own internal work queue is exempt (it uses internal synchronization but is not depth-gated on the caller).

### 9.2 The seven canonical bus metrics

AMD-43 §3.6.2 specifies the **literal** metric names. The seven are:

| Metric name | Type | Sampled when |
|---|---|---|
| `homesynapse.bus.publish.latency` | histogram (microseconds) | After every `EventPublisher.publish()` returns. |
| `homesynapse.bus.publisher.blocked.count` | counter | Incremented at `publish()` entry whenever observed writer queue depth > 5000. No debounce. |
| `homesynapse.bus.writer.queue.depth` | gauge (int) | Sampled on every enqueue AND every dequeue (guaranteed-fresh value). |
| `homesynapse.bus.subscriber.lag.events` | gauge per `subscriberId` (long) | Sampled after every `onEvent` returns. Lag of most-recently-delivered event vs writer tail. |
| `homesynapse.bus.subscriber.lag.millis` | gauge per `subscriberId` (Duration) | Sampled after every `onEvent` returns. Wall-clock between event ingest and subscriber observation. |
| `homesynapse.bus.subscriber.derived_writes.accepted` | counter per `subscriberId` | Incremented on each `EventPublisher.publish` from the subscriber that succeeded without rate-limit park. |
| `homesynapse.bus.subscriber.derived_writes.parked` | counter per `subscriberId` | Incremented when the rate-limit bucket was empty and the call parked. |

Renames are governed by Doc 11's metrics-stability policy.

### 9.3 `QueueSaturationHealthCheck`

The health check runs on a 1-second scheduled tick (shared with the supervisor scheduler). It reads `homesynapse.bus.writer.queue.depth` and maintains two consecutive-tick counters:

- `criticalTicks`: incremented when `depth > critical_depth` (default 10000); reset otherwise.
- `warnTicks`: incremented when `depth > warn_depth` (default 5000); reset otherwise.

Behavior:

- On `criticalTicks >= 5`: emit `CRITICAL` on channel `writer.queue.saturating`. Re-emit at 10-second intervals while sustained.
- On `warnTicks >= 5` AND no current critical: emit `WARN` on channel `writer.queue.saturating`. Re-emit at 30-second intervals while sustained.
- When depth drops below thresholds for ≥ 5 consecutive ticks, emit `INFO` `writer.queue.recovered`.

The asymmetric WARN/CRITICAL pair and the hysteresis (5 consecutive ticks before emission, separate recover signal) are explicit AMD-43 design choices. Operator-tunable via `application.properties`: `homesynapse.bus.queue.warn_depth`, `homesynapse.bus.queue.critical_depth`, `homesynapse.bus.queue.saturation_ticks`.

### 9.4 `DerivedWriteRateLimit` token bucket

Derivation-producing subscribers (only `StateProjection` at MVP) wrap their `EventPublisher.publish()` calls in a per-subscriber `DerivedWriteRateLimit` token bucket:

- Bucket capacity: 200 tokens (default for `StateProjection`; constructor parameter).
- Refill rate: 200 tokens/sec via a single scheduled task on the supervisor scheduler ticking every 50 ms (10 tokens per tick). Refill ticks use the injected `Clock` (DEC-M3-09).
- `acquire()` semantics: **poll first**; if available, decrement and return immediately. If not, increment `homesynapse.bus.subscriber.derived_writes.parked` and park on a `Semaphore` until the refill releases a permit.

The rate limit is **per subscriber** (one bucket instance per `StateProjection`); other future derived-publishing subscribers carry their own defaults.

### 9.5 Coalescing deferred past M3 (DEC-M3-07)

AMD-43 §3.6.5 records DEC-M3-07: no coalescing of subscriber notifications or publish calls is implemented in M3. The `coalesceExempt` flag on `SubscriberInfo` is retained but inert — M3 treats all subscribers as if `coalesceExempt = true`. Post-M3 work may activate coalescing for non-exempt subscribers under a future amendment.

### 9.6 The pending observability emission decision

AMD-43 §3.6.2 contains a caveat: the existing `observability/observability` module's M2 metrics surface is JFR-centric (`MetricsRegistry` for custom JFR event types, `MetricsStreamBridge` for `RecordingStream` consumption, `MetricSnapshot` for aggregated min/max/count/sum windows). It does **not** currently expose typed counter / gauge / histogram primitives.

M3.3 must therefore choose between two emission paths:

(a) Emit JFR events for each of the seven canonical metrics and reshape `BusMetrics` around event emission rather than typed primitive calls.

(b) Extend `observability/observability` with new typed primitive types (`Counter`, `Gauge`, `Histogram`).

This decision is **open** for M3.3 and should be resolved before the M3.3 implementation prompt is generated. Recorded in §20 (Open Questions).

### 9.7 The existing observability module surface

The `observability/observability` module (M2 scope) ships:

- `MetricsRegistry` — registers custom JFR event types.
- `MetricsStreamBridge` — consumes JFR `RecordingStream` output.
- `MetricSnapshot` — point-in-time aggregated min/max/count/sum window.

The module is described in `MODULE_CONTEXT.md` as a "Scaffold" — health model, hierarchical aggregation, trace query, metrics, JFR integration. The full surface lives in Doc 11 (Observability & Debugging).

---

## §10 — Integration runtime

### 10.1 Load-bearing invariants

The integration runtime is anchored by INV-RF-01 (Integration Isolation) and INV-RF-02 (Resource Quotas for Integrations). Together they make crash isolation finite: a faulty integration cannot consume unbounded resources, and its failure cannot affect any other integration or the core (Doc 05 §1; `integration-runtime/MODULE_CONTEXT.md`).

INV-RF-03 (Startup Independence) ensures that a failing integration does not block core startup — the system boots with the failing integration in a documented unhealthy state. INV-RF-06 (Graceful Degradation Under Partial Failure) ensures that the core continues to operate.

### 10.2 `IntegrationContext` — the adapter-facing API

`IntegrationContext` (Doc 05 §3.8) is the typed surface every adapter receives at initialization time. It provides:

- An injected `Clock` (DEC-M3-09 propagation).
- An `EventPublisher` reference (for producing device events).
- A read-only `StateQueryService` reference (for adapters that need to consult current entity state — for example, before issuing a redundant set-on-off command).
- The adapter's `Capabilities` (resource quotas, allowed file paths, network endpoints).
- The `ManagedHttpClient` (Doc 05 §3.9), a pre-configured HTTP client with timeouts, connection limits, and retry rules.

The adapter has no other way to reach the core. The `NO_INTERNAL_PACKAGE_ACCESS` and `NO_REVERSE_DEPENDENCIES` ArchUnit rules close off any reflection-based backdoor.

### 10.3 Adapter lifecycle

The adapter lifecycle is `initialize → run → close` (Doc 05 §3.3). The supervisor (Doc 05 §3.4) maintains a four-state FSM for each adapter:

```
HEALTHY → DEGRADED → SUSPENDED → FAILED
   ↑__________|         |___________|
                     (restart)
```

- **HEALTHY** — adapter is responding to health checks within thresholds.
- **DEGRADED** — adapter is responding but slowly; warnings emitted but processing continues.
- **SUSPENDED** — adapter has failed health checks repeatedly; supervisor is attempting restarts.
- **FAILED** — restart intensity exceeded; adapter is parked; operator intervention required.

### 10.4 Planned-restart pattern

Doc 05 §3.14 introduces planned-restart behavior: an adapter can request a clean restart (e.g., to apply a new configuration) that does not count against its restart intensity budget. The supervisor distinguishes planned restarts from crash-restarts in `IntegrationHealthRecord.plannedRestart` (added in the 2026-03-21 architecture corrections).

### 10.5 Zombie Run finalization

Doc 07 §3.10 — referenced from the integration-runtime through the command dispatch path — defines zombie Run finalization: when an integration adapter crashes mid-command-dispatch, any in-flight Runs that depend on its commands are marked `INTERRUPTED` and a synthesized `command_result(outcome=interrupted)` event is published so downstream subscribers (Pending Command Ledger, automation runs) can advance.

### 10.6 `IntegrationHealthRecord`

`IntegrationHealthRecord` (Doc 05 §4.3) has 13 fields, including `plannedRestart` (the 2026-03-21 addition). The record summarizes:

- Adapter ID, current state, last state transition timestamp.
- Restart count within the rolling intensity window.
- Last error (class + message + timestamp).
- Last successful health check timestamp.
- Resource consumption snapshot (memory, threads, connections).
- The `plannedRestart` boolean.

### 10.7 `RunStatus` (7 values)

The automation engine's `RunStatus` enum, referenced from integration-runtime via the command pipeline, has seven values: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`, `TIMED_OUT`, `INTERRUPTED`. `INTERRUPTED` is the zombie-finalization terminal status (Doc 07 §3.10).

### 10.8 Command dispatch path

The command dispatch path is causally ordered per AMD-31:

- **Sequential within a Run.** A single Run's actions execute sequentially; the next action does not begin until the previous one's `command_result` (or timeout) has been observed.
- **ULID-ascending for multi-target.** When a Run issues commands to multiple targets at the same logical step, the commands are emitted in ULID-ascending order of `targetEntityRef`. This makes the emission order deterministic across runs.
- **Log-order dispatch.** The Command Dispatch Service (Doc 07 §3.11.1) reads from the command log in `globalPosition` order.

---

## §11 — Automation engine

### 11.1 Trigger evaluation

The automation engine (`core/automation/MODULE_CONTEXT.md`) evaluates triggers against (a) current entity state via `StateQueryService` and (b) the inbound event stream. Triggers are sealed-hierarchy types in the `automation` module. Each trigger declares whether it fires on state change, on event arrival, on schedule, or on cascade.

### 11.2 Causal command ordering (AMD-31)

AMD-31 specifies that commands emitted by an automation Run carry a `CausalContext` that ties them to the triggering event. Within a Run, commands are sequential; across multi-target steps, they are emitted in ULID-ascending order of `targetEntityRef`. The Command Dispatch Service dispatches in log order.

### 11.3 AMD-25 — Temporal duration trigger modifier

AMD-25 (APPLIED 2026-03-17) added a temporal-duration modifier to the trigger expression DSL: a trigger can fire only if the underlying condition has been continuously true for a specified duration (e.g., `motion = true for 30 seconds`). The modifier is evaluated by the Automation Engine's trigger-state cache.

### 11.4 `IdempotencyClass`

`CommandIdempotency` (event-model enum) has three values: `IDEMPOTENT`, `NOT_IDEMPOTENT`, `CONDITIONAL`. The third value was previously named `TOGGLE` and was renamed during M2.x — the rename reflects that conditional idempotency depends on the current state of the target (e.g., a "toggle" command is idempotent when issued as "set on", non-idempotent when issued as "flip").

### 11.5 Subscriber PAUSED state

Doc 04 §3.4 — referenced from Doc 07's automation subscriber — defines a PAUSED state for automation subscribers during disk-pressure escalation. This is separate from AMD-42's SUSPENDED state; PAUSED is a deliberate, operator-controlled pause for back-pressure management.

---

## §12 — Device and capability model

### 12.1 Capability-based abstraction

Doc 02 (Device Model & Capability System) establishes that the device model is described in **capability** terms, not in protocol primitives. INV-CE-04 (Protocol Agnosticism in the Device Model) is the governing invariant. A "light" is not a Zigbee On/Off cluster; it is an Entity that carries a `light` capability with attributes `on_off`, `level`, `color_temperature`, etc.

### 12.2 `AttributeValue` hierarchy

`AttributeValue` is a sealed hierarchy in `device-model` (`core/device-model/MODULE_CONTEXT.md` — 57 types, four sealed hierarchies). The permitted subtypes cover the attribute primitives: boolean, integer, decimal, string, enum, range, color (HSV/RGB/CCT), duration, timestamp, energy, etc. Each subtype is a record with validation in the compact constructor (e.g. enum values constrained to the capability's declared value set).

The `AttributeValue` Jackson (de)serializer is currently DEFERRED — no event payload references `AttributeValue` as a field type at MVP (the State Projection's `StateChangedEvent` carries `oldValue String` and `newValue String`, not typed `AttributeValue` instances). When the first event payload uses `AttributeValue`, a serializer will be added to `PersistenceJacksonModule`.

### 12.3 Device adoption flow

Device adoption (Doc 02 §3.12) proceeds:

1. **Discovery.** An integration adapter detects a candidate device and publishes `device_discovered` with `integrationId`, `protocolAddress`, `manufacturer`, `model`.
2. **Capability resolution.** The capability registry maps the manufacturer/model to a set of capabilities (Doc 02 §3.5 capability definition structure; §3.6 standard capability set). The mapping may be a perfect match (a known model) or a heuristic match (a `device_replacement` proposal, Doc 02 §3.14).
3. **Adoption.** The user (or an auto-adoption policy) accepts the device. The system publishes `device_adopted` with an `EntityId` (newly minted ULID), and the entity becomes visible to State Projection and to automation triggers.
4. **Attribute initialization to nullable.** Newly-adopted entities have every attribute in the capability schema present in `EntityState.attributes` as a key, but the **value is `null`** until the first `state_reported` arrives. This is not an error condition (it is explicit in the `EntityState` Javadoc).

### 12.4 The two-axis availability model

Availability is two-axis: enabled/disabled (a user-controlled flag, persisted in the Entity Registry) and reachable/unreachable (a runtime status, the `Availability` enum on `EntityState`).

- **Enabled but unreachable** — `availability = UNAVAILABLE` (the device is supposed to be active; the network has lost it). The system continues to track `lastReported` and emits `availability_changed(UNAVAILABLE)`.
- **Disabled** — `entity_disabled` was published. The State Projection freezes the attribute map at the last known state; `lastReported` continues to update if the integration adapter is still receiving reports.
- **Stale** — the `staleAfter` timestamp has passed (`stale = true` is derived at read time). Stale is orthogonal to availability: a sensor can be `AVAILABLE` and `stale` (e.g. infrequent reporter), or `UNAVAILABLE` and not stale (e.g. recently-reported value before connectivity dropped).
- **Orphaned (AMD-17 device orphan lifecycle)** — when an integration fails, the State Projection notes the device as `stale:true` AND `availability:UNAVAILABLE` immediately; the 30-second staleness scan (AMD-11) treats already-stale orphaned devices as no-ops to avoid duplicate stale events.

---

## §13 — Configuration system

### 13.1 Canonical configuration

INV-CE-01 mandates a canonical human-readable configuration format. LTD-09 fixes that as **YAML 1.2**. The configuration module (`config/configuration/MODULE_CONTEXT.md` — 22 types) is the only ingestion path for user-supplied configuration.

### 13.2 Loading pipeline

Doc 06 §3.1 specifies a six-stage loading pipeline: (1) file read, (2) YAML parse, (3) tag resolution, (4) default merge, (5) schema validation (JSON Schema), (6) model construction. Each stage either advances the configuration or fails fast with a `ConfigIssue` describing the failure.

### 13.3 Schema versioning and migration (INV-CE-03, INV-CE-06)

Every config schema carries a version field. Migration runners (Doc 06 §3.7, AMD-13-related) transform older configurations to current schemas at load time. The migration framework is forward-only (mirroring LTD-07's SQL migration discipline).

### 13.4 Zero-configuration first run (INV-CE-02)

An empty config file produces a running system using documented defaults (Doc 14 §9 — the consolidated configuration reference). The system boots into a "configure me" state where the first-run UI prompts for credentials (INV-SE-01) and basic locality.

### 13.5 Extension model (INV-CE-05)

Integrations declare their config schemas via the `ConfigurationAccess` API (Doc 06 §8.4). The runtime composes the core schema with each integration's schema at startup (Doc 06 §3.2). Schema stability is a contract (INV-CS-04, INV-CE-05) — integrations cannot retroactively change their schema in a way that breaks existing user config.

### 13.6 Reload mechanism (Doc 06 §3.3)

Hot reload uses a two-phase notification pattern:

1. Direct callbacks (`ConfigurationChangeListener`) fire synchronously. The Automation Engine uses this path so it sees config changes before any subscriber.
2. `config_changed` event is published. All other subsystems receive notification through the normal pull-based event bus mechanism.

### 13.7 Secret store

Doc 06 §3.4 — the secret store uses AES-256-GCM with a key file (file permissions enforced). Secrets are referenced from configuration via `${secrets.foo}` placeholders.

---

## §14 — Observability and debugging

### 14.1 Invariants

INV-TO-01 (System Behavior Is Observable), INV-TO-02 (Automation Determinism — given the same event log and configuration, automations produce the same result), INV-TO-03 (No Hidden State — every meaningful mutation is a logged event), INV-TO-04 (Structured, Queryable Logs).

### 14.2 Doc 11 coverage areas

Doc 11 (Observability & Debugging, locked Phase 2 2026-03-09; updated by AMD-43 with the new "Event bus and writer metrics" sub-section) covers four coverage areas:

- **Tracing.** `TraceQueryService` (Doc 11 §3.4) assembles causal chains from `correlationId` and `causationId` into navigable trees over the event log.
- **Metrics.** Per-subsystem metric surface (Doc 11 §3.5) registered through `MetricsInfrastructure`. JFR-centric at M2; the AMD-43 caveat applies to M3.3.
- **Structured logging.** SLF4J + Logback (LTD-15) with JSON output and JFR continuous recording. Logs are queryable via the structured log query surface.
- **Debugging tools.** Dynamic log level control (Doc 11 §3.6), JFR custom event taxonomy (Doc 11 §4.3), health aggregation (Doc 11 §3.3).

### 14.3 Web UI Observability MVP (Doc 13)

Doc 13 (Web UI Observability MVP) describes the Preact SPA dashboard served from Javalin at `/dashboard/`. Components: real-time system health card, live event stream with virtual scrolling, causal-chain trace timelines, per-device state view, charts (Doc 13 §3.9). The bundle budget is <100 KB gzipped.

### 14.4 The new bus/writer metrics section landing via AMD-43

AMD-43 §3.6.2 lands a new sub-section under Doc 11 titled "Event bus and writer metrics" that hosts the seven canonical metric names (§9.2 of this report). This is the first M3 expansion of Doc 11's metric surface.

---

## §15 — APIs (out-of-M3-scope context)

### 15.1 REST API (Doc 09)

The REST API (`api/rest-api`, scaffold) provides read-only state queries and command issuance. Doc 09 §3.2 enumerates the endpoint taxonomy: entity reads, command issuance, event history with cursor pagination, automation management, system health. Doc 09 §3.7 defines the ETag caching strategy. Doc 09 §3.4 defines the four-phase command lifecycle (`command_issued` → `command_dispatched` → `command_result` → `state_confirmed` OR `command_confirmation_timed_out`).

The REST API is **readiness-gated**: while the State Projection is in REPLAY mode (`StateSnapshot.replaying == true`), state-query endpoints return HTTP 503 (Doc 09 §6.1). Commands return HTTP 503 in the same window.

### 15.2 WebSocket API (Doc 10)

The WebSocket API (`api/websocket-api`, scaffold) provides real-time event streaming. Doc 10 §3.6 describes the Event Relay (a single bus subscriber that evaluates per-client filters). Doc 10 §3.7 defines the four-stage backpressure escalation (`NORMAL → BATCHED → COALESCED → close`). The WebSocket API is **read-only** at MVP — commands flow through REST. Doc 10 is **out of M3 scope** per the Navigation Index.

### 15.3 Authentication

INV-SE-02 mandates authentication for all external interfaces. The current open question (PLAN-M3-CONSOLIDATED-02 §13.3, cross-referenced from `design/00-navigation-index.md` for Doc 09) is the admin-path / auth-annotation integration: how the REST API marks endpoints as `@AdminEndpoint` and how the ArchUnit rule enforces auth coverage. M3.5b adds a NEW ArchUnit rule `ADMIN_ENDPOINTS_REQUIRE_AUTH_ANNOTATION` per the PLAN-M3-CONSOLIDATED-02 reclassification (recorded in §18).

---

## §16 — Lifecycle, startup, shutdown

### 16.1 Doc 12 — the ordered startup model

Doc 12 (Startup, Lifecycle & Shutdown) specifies an ordered seven-phase startup model:

- **Phase 0 — Platform Bootstrap** (Doc 12 §3.2). PlatformPaths resolution, systemd integration (`platform-systemd`), watchdog handshake.
- **Phase 1 — Foundation Services** (§3.3). Logging, clock, executor pools.
- **Phase 2 — Data Infrastructure** (§3.4). `SqlitePersistenceLifecycle.start()` — opens the database, runs migrations, initializes `EventTypeRegistry` + `JacksonWarmup` + `EventPayloadCodec`, constructs all four stores.
- **Phase 3 — Core Domain** (§3.5). Subscriber registration with the EventBus (BEFORE event flow opens), State Projection start, Configuration load and validation, Device/Entity registries.
- **Phase 4 — Observability** (§3.6). Health aggregator, trace query service, JFR custom event registration.
- **Phase 5 — External Interfaces** (§3.7). REST API listener, WebSocket API listener. These wait for `StateStoreLifecycle.start()`'s `CompletableFuture<Void>` to complete (the readiness gate).
- **Phase 6 — Integrations** (§3.8). Integration adapters initialized in topologically-sorted order (per AMD-14 dependency ordering); failure of an integration does not block other integrations (INV-RF-03).

### 16.2 Subscriber registration before event flow

Phase 3 explicitly registers all subscribers with the EventBus BEFORE the publisher starts accepting events. This is the load-bearing detail: events published before subscribers register would not trigger notifications (events would be persisted and recovered on the next catch-up read, but the in-process notification path would have missed). The startup-lifecycle module coordinates this ordering.

### 16.3 `StateStoreLifecycle.start()` as the readiness gate

`StateStoreLifecycle.start()` returns a `CompletableFuture<Void>` that completes when the State Projection has reached LIVE. Phase 5 (External Interfaces) blocks on this future before binding sockets. The Web UI sees the system as "not ready" via the WebSocket initial-frame handshake until this future completes.

### 16.4 Shutdown discipline

Shutdown (Doc 12 §3.9) executes in reverse phase order with a 30-second budget. Each subsystem is given a fraction of the budget; if a subsystem exceeds its slice, the supervisor forces shutdown via `executor.shutdownNow()`. The critical operation is the WAL checkpoint: `SqlitePersistenceLifecycle.stop()` issues `PRAGMA wal_checkpoint(TRUNCATE)` through the WriteCoordinator at `WAL_CHECKPOINT` priority before shutting down the database executor. This ensures the WAL file is empty on next start, simplifying recovery.

---

## §17 — M2→M3 bridge work

### 17.1 The bridge amendments

The M2→M3 bridge was a focused round of structural hardening applied on 2026-05-02 and 2026-05-15. The amendments delivered:

- **AMD-34 (Home Identity Schema Reservation, 2026-05-02).** Adds `home_id BLOB(16) NOT NULL` to the events table. The Java surface is plumbed through `SqliteEventStore`'s 5th constructor parameter. The HomeId value is owned by `SqlitePersistenceLifecycle` and passed through. Reservation columns are populated at INSERT time and have no Java-API surface beyond the constructor.
- **AMD-35 (Persistent Idempotency Key, 2026-05-02).** Adds `idempotencyKey String` as the 9th field of `EventDraft` (max 128 chars, non-blank when non-null) and the `idempotency_key TEXT` column on events. A partial unique index `(home_id, idempotency_key) WHERE idempotency_key IS NOT NULL` enforces per-home uniqueness. AMD-35 extends AMD-08 (REST API idempotency keys) to the event-store layer.
- **AMD-36 (Subscriber Dead-Letter Queue, 2026-05-02).** V002 migration creating the `subscriber_dead_letters` table (11 columns, `UNIQUE(subscriber_id, event_position)`, no `status` column). Default retry cap of 5. Park-and-advance atomicity via `AtomicCheckpointWriter`. Source-of-resolution: Axon-style DLQ research (EventStoreDB #2748, etc.).
- **AMD-37 (Chain Hash NOT NULL with Zero Default, 2026-05-02).** `chain_hash BLOB(32) NOT NULL DEFAULT (X'00…00')`. The 32-byte zero vector is the MVP default; the column is the foundation for the unified-cryptographic-architecture's tamper-evident chain (INV-PD-08). `SqliteEventStore` exports the `ZERO_HASH` constant.
- **AMD-38 (Checkpoint Policy Revision, 2026-05-15).** Universal cadence: `event_threshold = 200`, `max_interval_seconds = 2`. Bounded-window reader `DEFAULT_MAX_ROWS = 500`. The empirical foundation is the D1 WAL Pathology Validation Spike.
- **AMD-39 (Journal Size Limit Revision, WITHDRAWN 2026-05-15).** Proposed raise to 64 MB; withdrawn after D1 confirmed the 6 MB limit is sufficient under the bounded-window reader. Note: AMD-39 has nothing to do with clock injection (the AMD-42 citation note corrects an earlier draft's mis-citation).
- **AMD-40 (Retention Execution Model, 2026-05-15).** Retention is routed through `WriteCoordinator` at `RETENTION` priority, interval-based at 6 hours, bounded at 1000-row chunks with ≤ 2 s lock-hold per chunk.
- **AMD-M2Bridge (Tier-2 Schema Reservations, 2026-05-02).** Six zero-cost schema reservations: `payload_size`, `batch_id`, `external_ref`, `intent_kind`, `logical_time`, `node_id`. No Java API impact; populated with defaults or `NULL` at INSERT time by `SqliteEventStore`.

### 17.2 The D1 WAL pathology spike

The D1 spike (`research/sqlite-wal-validation-spike-results.md`, 2026-04-02 execution; codified into amendments 2026-05-15) validated:

- **6 MB journal size limit is sufficient** under the bounded-window reader pattern (basis for AMD-39 withdrawal).
- **200-event / 2-second checkpoint cadence** keeps the WAL turning over (basis for AMD-38).
- **500-row bounded-window reader** prevents reader transactions from holding open long enough to starve checkpoints (basis for AMD-38).

The spike also exercised the Virtual Thread compatibility scenario (1 writer VT + 20 reader VTs over 60 s; 0 SQLITE_BUSY errors, 0 deadlocks) — empirical validation of the AMD-26 / AMD-27 thread architecture.

### 17.3 V003 snapshots design note

`design/v003_snapshots_design_note.md` (2026-05-15) documents the rationale for the V003 migration (snapshots table + dropping the redundant `idx_events_subject` index). The snapshot cadence of 200 events per aggregate aligns with AMD-38's checkpoint threshold; the per-aggregate replay window is bounded at ~200 events (~4 ms on Pi 5 NVMe). The `SqliteSnapshotStore` implementation remains deferred per AMD-41 §3.2.3.

---

## §18 — M3 governance (the planning lock)

### 18.1 PLAN-M3-CONSOLIDATED-02

`PLAN-M3-CONSOLIDATED-02` is the senior architect's M3 planning lock. It closes twelve decisions DEC-M3-01..12 plus the post-deliberation DEC-M3-13 (M3.4 integration-test module placement). The plan is referenced from `design/00-navigation-index.md` and from each of the three M3 amendments (AMD-41, AMD-42, AMD-43) via inline citations. The on-disk Master Implementation Plan v2 (`design/HomeSynapse_Phase3_Master_Implementation_Plan_v2.md`) is the broader Phase 3 plan; PLAN-M3-CONSOLIDATED-02 is the M3-specific consolidated lock.

The twelve DEC-M3-* decisions are listed in §2.3 above with their locking amendment.

### 18.2 The three M3 amendments

The M3 governance bundle is AMD-41 + AMD-42 + AMD-43, all APPLIED 2026-05-16. Each is covered in detail elsewhere in this report:

- **AMD-41** (State Projection Execution Model) — §7.
- **AMD-42** (Subscriber Lifecycle and Isolation) — §8.7.
- **AMD-43** (Backpressure and Observability) — §9.

The governance event itself was the 2026-05-16 commit that landed all three amendments alongside the MODULE_CONTEXT updates for `core/event-bus` and `core/state-store` and the new `design/00-navigation-index.md`.

### 18.3 Implementation order (DEC-M3-11)

PLAN-M3-CONSOLIDATED-02 §1.2 locks the M3 implementation order:

1. **M3.1** — Event bus skeleton: production `InProcessEventBus` implementing the `EventBus` interface; cold-start subscriber registration; wiring `SqliteEventStore`'s post-commit hook to `notifyEvent(globalPosition)`.
2. **M3.5a** — Vertical slice: end-to-end smoke test that drives an event from `EventPublisher` through bus notification, projection advance, derived publish, and checkpoint. First executable validation of AMD-41.
3. **M3.2** — REPLAY → LIVE algorithm per AMD-42 (three-phase transition; ReplayWindowQueue; gap detection; `onCaughtUp()` single-shot).
4. **M3.3** — Backpressure and observability per AMD-43 (seven canonical metrics; `QueueSaturationHealthCheck`; `DerivedWriteRateLimit`).
5. **M3.4** — Pi 4 integration tests (`Pi4SustainedLoadIT`, `Pi4D1SpikeIT`) and the integration-test module per DEC-M3-13.
6. **M3.5b** — Snapshots wiring (V003 migration enrollment, `SqliteSnapshotStore` implementation deferred until empirical 5-second gate), admin auth annotation ArchUnit rule.
7. **M3.6** — REST API readiness gating and command lifecycle integration with State Projection.
8. **M3.7** — Hardening pass; M3 exit gate.

### 18.4 The two corrections that landed alongside governance

Two source-verification corrections landed in the 2026-05-16 governance commit:

- **`ADMIN_ENDPOINTS_REQUIRE_AUTH_ANNOTATION` reclassified as NEW (M3.5b).** Earlier plan drafts described this ArchUnit rule as existing; source verification confirmed it does not exist in `HomeSynapseArchRules.java` (which currently has seven rules). It is added in M3.5b.
- **AMD-39 citation corrected.** Earlier drafts misattributed clock-injection authority to AMD-39 (which is WITHDRAWN and concerns the `journal_size_limit` PRAGMA). The actual authority is the `NO_DIRECT_TIME_ACCESS` ArchUnit rule + DEC-M3-09. AMD-42's preamble carries the verbatim correction note.

---

## §19 — M3 Deliverable 0 (the most recent commit)

### 19.1 Scope

M3 Deliverable 0 (commit `2b9d875` on `homesynapse-core@main`, 2026-05-16) upgrades `ProjectionAdvancer.advance` from a two-parameter signature to a three-parameter signature that takes a `Consumer<EventEnvelope>` processor callback. The processor runs **inside the read transaction**, codifying the AMD-41 §3.2.1 two-phase discipline in code.

The new signature:

```java
AdvanceResult advance(long fromPosition, int maxRows, Consumer<EventEnvelope> processor);
```

### 19.2 The two pushbacks that surfaced during implementation

**Pushback 1 — `EventEnvelope` construction was under-specified in the prompt.** The contract test needs to fabricate `EventEnvelope` instances at known `globalPosition` values to exercise the contract. The Deliverable 0 prompt did not authorize the Coder to read event-model source, but the test must construct an `EventEnvelope`'s 14 fields. Resolved by bounded read authorization for `event-model`'s `MODULE_CONTEXT.md` and one minimal `DomainEvent` source (`SystemStartedEvent`, chosen for its trivially-valid `(version String, startupDurationMs long)` field set).

**Pushback 2 — leaked-type failure under `-Werror`.** Adding `Consumer<EventEnvelope>` to a public-API signature on `ProjectionAdvancer` surfaced `EventEnvelope` (an `event-model` type) in `state-store`'s exported API. Under `-Xlint:all -Werror` the leaked-type check fails unless the dependency on `event-model` is `requires transitive`. Resolved by promoting `state-store`'s `module-info.java` from `requires com.homesynapse.event` to `requires transitive com.homesynapse.event`, per LD#10 (inter-module `requires` are `requires transitive` by default).

### 19.3 The 11 contract test methods

`ProjectionAdvancerContractTest` (in `core/state-store/src/testFixtures/java/com/homesynapse/state/test/`) is an abstract class declaring 11 `@Test` methods. Each is summarized below with its behavioral contract:

| # | Test method | Behavioral contract |
|---|---|---|
| 1 | `advanceDeliversInPositionOrder` | Strict `globalPosition`-ascending delivery (1, 2, 3, …, n). |
| 2 | `advanceRespectsFromPositionExclusive` | The `fromPosition` is exclusive — events with `globalPosition > fromPosition` are delivered; `fromPosition` itself is not. |
| 3 | `advanceRespectsMaxRows` | The `maxRows` parameter caps the per-call delivery (with `maxRows = 7`, at most 7 events). |
| 4 | `advanceCapsAtDefaultMaxRows` | Even with `Integer.MAX_VALUE` as `maxRows`, the implementation caps at `DEFAULT_MAX_ROWS = 500`. |
| 5 | `advanceHasMoreWhenLogExceedsPage` | When 600 events exist and 500 are read, `AdvanceResult.hasMore() == true`. |
| 6 | `advanceReachesTail` | On a 5-event log read with `maxRows = 10`, `hasMore == false` and `eventsProcessed == 5`. A follow-up read from position 5 returns `eventsProcessed == 0` and `hasMore == false` (the "caught-up" signal). |
| 7 | `advanceProcessorInvokedInsideReadTx` | The `processor` observes `readTxInProgress() == true` while it is being invoked; after `advance` returns, `readTxInProgress() == false`. |
| 8 | `advanceProcessorExceptionPropagates` | If `processor.accept` throws `RuntimeException("boom")`, the exception propagates out of `advance` unwrapped. |
| 9 | `advanceProcessorExceptionClosesReadTx` | Even when the processor throws, the read transaction is closed before the exception escapes (`readTxInProgress() == false` after). |
| 10 | `advanceRejectsInvalidArgs` | `maxRows < 1` → `IllegalArgumentException`; `fromPosition < 0` → `IllegalArgumentException`. (`null processor` is enforced in a paired check via `NullPointerException`.) |
| 11 | `advanceFromZeroDrainsLogInBoundedWindows` | A 1000-event log read from `fromPosition = 0` is drained in multiple bounded windows, with each window respecting `DEFAULT_MAX_ROWS` and the cumulative result covering all events. |

Subclasses implement `newAdvancer(List<EventEnvelope> log)` and `readTxInProgress()`; the 11 tests are inherited and run against the subclass's advancer. The in-memory subclass tracks `readTxInProgress` via a fixture flag set true on `advance` entry and false on `advance` exit; the SQLite subclass introspects the connection's `getAutoCommit()` state.

### 19.4 The MODULE_CONTEXT changes

The 2026-05-16 commit updates `core/state-store/MODULE_CONTEXT.md` in two ways:

1. **The `ProjectionAdvancer` row's "Key Details" cell was rewritten.** It now begins with the literal phrase `"Single method:"` (not `"Signature change pending"`), and the cell describes the 3-parameter signature, the bounded-window discipline, the read-tx-closes-before-publish invariant, the AMD-41 §3.2.1 enforcement point on processor restrictions, and the AMD-38 bounded-window justification.
2. **The JPMS sentence on line 28 was rewritten.** It now reads (verbatim from the on-disk file): *"All three `requires transitive` declarations mean any module that reads `com.homesynapse.state` automatically gets access to all identity types (`EntityId`, etc.), all device model types (`AttributeValue`, etc.), and all event types (`EventEnvelope`, etc.) without needing to declare those dependencies themselves. The transitive event-model dependency is load-bearing: `EventEnvelope` is the parameter type for `ProjectionAdvancer.advance`'s processor callback (AMD-41 §3.2.1), surfacing event-model in state-store's public API. This declaration is also consistent with LD#10 (inter-module `requires` are `requires transitive` by default)."*

### 19.5 Why this commit is "Deliverable 0"

Deliverable 0 is the **first** code commit of M3 and is the gate on M3.1. The signature change has no behavioral consequences on its own — there is no production implementation of `ProjectionAdvancer` yet. The deliverable's purpose is to establish the contract in code (matching AMD-41 §3.2.1 in source-of-truth form) and to run the contract test against the contract-complete in-memory reference implementation, so that M3.1's SQLite-backed implementation can be measured against the same contract from the moment it lands.

---

## §20 — Open questions and pre-M3.1 decision points

The following decision points remain open as M3.1 implementation begins. Each is recorded as observed state; none is resolved here.

### 20.1 `SubscriberInfo.mode()` mechanism

AMD-42 §3.4.1 specifies that subscriber mode is observable via `SubscriberInfo.mode()`. The current `SubscriberInfo` record is a 3-field record (`subscriberId`, `filter`, `coalesceExempt`) with no `mode` field. The open question is how `mode()` is exposed: as a 4th record field (mutating the record across a process lifetime, which conflicts with record immutability), as a getter on a separate type returned by `EventBus.subscriberInfo(subscriberId)`, or as a separate `EventBus.subscriberMode(subscriberId)` method that consults the per-subscriber `AtomicReference<SubscriberMode>`. M3.1 must decide.

### 20.2 Per-subscriber dedicated read connection vs AMD-27's bounded pool

AMD-42 INV-SUB-ISO-02 mandates one dedicated SQLite read connection per subscriber, held for the subscriber's lifetime. AMD-27 sizes the read pool at 2 platform threads by default. If the deployment has more than 2 subscribers, the per-subscriber connection cannot be a per-thread `ThreadLocal<Connection>` on a 2-thread pool — there are not enough threads. The open question is whether (a) the pool is resized to ≥ subscribers count, (b) the per-subscriber connection is a real `Connection` object passed across threads (which violates `sqlite-jdbc`'s thread-confinement assumption), or (c) the per-subscriber connection is a logical abstraction (e.g., the subscriber binds a connection on each `advance` call from the round-robin pool, holds it for the duration of the call only). M3.1 must decide.

### 20.3 `EventBus` introspection method names

AMD-42 §3.4.1 refers to a bus "introspection API" that lets operators read subscriber mode. The MODULE_CONTEXT for `core/event-bus` mentions methods being added in M3.1 (`subscribeRuntime`, `resume`, `subscriberInfo`, `subscribers`). The exact signatures and return types of the introspection methods are not pinned. M3.1 must decide.

### 20.4 Registration of new INV-* identifiers

INV-BUS-01, INV-BUS-02, INV-BUS-03, INV-PROJ-01, INV-PROJ-04, INV-PROJ-NEW-01, INV-WRITER-01, and INV-SUB-ISO-01..06 are referenced by AMD-41 / AMD-42 / AMD-43 but are NOT yet registered in `governance/Architecture_Invariants_v1.md`. Per INV-GA-01 / INV-GA-02 (invariant stability / identifier permanence), formal registration is the appropriate next step. M3 governance owners must decide.

### 20.5 Observability emission path (JFR vs typed primitives)

AMD-43 §3.6.2 caveat: M3.3 must choose between (a) JFR-event emission for the seven canonical metrics and (b) extending `observability/observability` with typed counter/gauge/histogram primitives. The decision affects the `BusMetrics` surface shape and constrains how external monitoring (e.g., Prometheus-style scrapes through a future M4+ adapter) can consume the metrics.

### 20.6 Other open questions captured in M3 deliberation

The M3 architecture deliberation record (`research/2026-05-16_HomeSynapse_M3_Architecture_EventBus_and_StateProjection_Design_Decisions.md`) and PLAN-M3-CONSOLIDATED-02 carry additional open questions resolved by the governance bundle. Among those that remain open or are explicitly deferred:

- Coalescing activation timing (DEC-M3-07 explicitly defers past M3; reactivation requires a future amendment AMD-44+).
- Platform-specific Pi 4 tuning (DEC-M3-12 defers to AMD-44 pending Pi4 IT results).
- Snapshot store implementation gate (5-second replay threshold per AMD-41 §3.2.3).
- Admin-path authentication annotation policy (PLAN §13.3; M3.5b lands `ADMIN_ENDPOINTS_REQUIRE_AUTH_ANNOTATION`).

---

## §21 — Performance, privacy, and security posture

### 21.1 Performance invariants

INV-PR-01 (Constrained Hardware Is the Primary Design Target) anchors every design choice to Pi 4 (validation floor, LTD-02). INV-PR-02 (Quantitative Performance Targets) enumerates per-subsystem targets in Doc 14 §10.1. The constitutional targets include:

- Event append: < 10 ms (Doc 01 §10).
- Subscriber notification: < 5 ms (Doc 01 §10).
- State change derivation: < 2 ms (Doc 03 §10).
- WebSocket relay to client frame: < 10 ms (Doc 10 §10).
- Zigbee attribute report processing: < 15 ms (Doc 08 §10).
- End-to-end radio-to-dashboard: sub-second (Doc 14 §3.3 data-flow latency budget).

INV-PR-03 (Resource Usage Is Bounded and Predictable) is the basis for the per-subsystem memory budgets in Doc 14 §3.5. INV-PR-04 (Architecture Must Accommodate 1,000 Devices) sizes the data model and event throughput.

### 21.2 The Pi 4 floor decision (DEC-M3-12)

DEC-M3-12 (modified by AMD-43 §3.6.6) applies AMD-38's 200/2s checkpoint cadence and the 500-row bounded-window reader **universally** across the Pi 4 → x86 server deployment spectrum at MVP. Platform-specific tuning is deferred to M3.4 validation: `Pi4SustainedLoadIT` and `Pi4D1SpikeIT` are the empirical gates. If those tests show saturation, follow-up amendment AMD-44 may introduce platform-aware defaults; this is NOT an M3 deliverable.

### 21.3 Privacy posture (INV-PD-01..08)

INV-PD-01 — zero telemetry by default. The system does NOT phone home; no usage data leaves the device unless the user explicitly opts in via configuration. INV-PD-02 — user-controlled data residency. INV-PD-03 — encrypted storage (the configuration secret store uses AES-256-GCM; the events table is not yet encrypted at rest at MVP, but the chain-hash column reservation in AMD-37 is the foundation for tamper evidence). INV-PD-04 — transparent data boundaries (what leaves the device and where is visible in the configuration and UI). INV-PD-05 — granular informed revocable consent, scoped by `EventCategory`. INV-PD-06 — offline integrity. INV-PD-07 — crypto-shredding lifecycle by category. INV-PD-08 — tamper-evident system integrity via the chain-hash column (zero default at MVP).

### 21.4 Security posture (INV-SE-01..06)

INV-SE-01 — no default credentials; first-run flow enforces credential creation. INV-SE-02 — authentication required for all external interfaces; REST and WebSocket APIs reject anonymous access. INV-SE-03 — secrets encrypted at rest via AES-256-GCM. INV-SE-04 — least privilege for integrations: an adapter cannot reach beyond `IntegrationContext`. INV-SE-05 — remote access is end-to-end encrypted (post-MVP feature scope). INV-SE-06 — security updates can ship without feature churn (independent release cadence).

### 21.5 Local-first posture (INV-LF-01..05)

INV-LF-01 — core functionality without internet. INV-LF-02 — cloud enhancement, never cloud dependence. INV-LF-03 — graceful WAN degradation. INV-LF-04 — no required cloud account. INV-LF-05 — convergent sync architecture (the SYNCABLE / LOCAL-ONLY table classification in §5.9 is the runtime expression of this invariant).

---

## §22 — Topics deliberately out of scope (for context)

In one sentence each, areas of the project that are intentionally out of M3 scope and where this report has not gone into depth:

- **Matter protocol support.** Post-MVP; the `Matter_Device_Conformance_Research_Plan.md` exists in `research/` as a planning artifact, but no implementation work is scheduled before MVP.
- **Zigbee adapter beyond the integration-runtime contract.** Doc 08 specifies the Zigbee adapter in full; the implementation work is post-M3 (the `integration-zigbee` module is currently a scaffold).
- **AI / intelligence integration (INV-AI-*).** Covered briefly in §2.2; no implementation at MVP.
- **Energy intelligence (INV-EI-*).** Covered briefly in §2.2; no implementation at MVP. The MVP positioning in §1.3 explicitly names energy intelligence as a "battlefield", but the implementation is post-MVP.
- **Multi-user identity and presence (INV-MU-*).** The `actorRef` field on `EventEnvelope` (INV-MU-01) is the foundation; identity-aware features are post-MVP.
- **Mesh and network intelligence (INV-MN-*).** Post-MVP.
- **WebSocket API (Doc 10).** Out of M3 scope per the Navigation Index.
- **Cloud-readiness test suite.** Post-M2 deferred per the test hardening backlog.
- **The academic NLP / GCVSP benchmark research track.** Separate from core development; lives in `homesynapse-core-docs/research/` as planning artifacts but does not gate any core milestone.

---

## §23 — Sync verification appendix

This appendix confirms that the report was produced against the current committed state of both repositories. Mismatches observed during the analysis are recorded in §23.4. Free-form source-verification surprises are recorded in §23.5.

### §23.1 Latest commit SHA and message for each repo

```
homesynapse-core         : 2b9d875757d0e0023eee0ba357de5041e7e008c8 "M3 Deliverable 0: ProjectionAdvancer.advance — Consumer<EventEnvelope> processor callback."
homesynapse-core-docs    : ce200a9c08dcc091bbd9078ac0c2986e373c8852 "AMD-41/42/43 APPLIED — M3 governance bundle + Navigation Index."
```

Both repositories are on `main`.

### §23.2 Last 5 commits in each repo

**`homesynapse-core`:**

```
2b9d875 M3 Deliverable 0: ProjectionAdvancer.advance — Consumer<EventEnvelope> processor callback.
3e0cb7e MODULE_CONTEXT updates for AMD-41/42/43 (M3 governance bundle).
1564ce8 Housekeeping: gitignore spike DBs, remove stale handoff duplicate
5f28c77 AMD-38/39 finalization: DeploymentProfile journal_size_limit → uniform 6 MB (LTD-03, D1 validated).
86be05d V003 migration, Phase 2 interfaces (state-store, persistence), MODULE_CONTEXT updates.
```

**`homesynapse-core-docs`:**

```
ce200a9 AMD-41/42/43 APPLIED — M3 governance bundle + Navigation Index.
6fcabcd AMD-38 APPLIED, AMD-39 WITHDRAWN — D1 WAL spike validates bounded-reader mitigation.
797cb39 AMD-38/39 (DRAFT), AMD-40 (APPLIED), V003 design note.
4a816b8 AMD-34, 35, 36, 37, schema reservation docs in amendments folder.
f7919ab Did more research, will updated event/persistence accordingly when done.
```

### §23.3 Post-Deliverable-0 source state confirmation (integrity quotations)

Each of the six integrity-check quotations below was retrieved from the live on-disk file and matches its expected form. Match status is noted after each.

**Quotation 1 — `ProjectionAdvancer.advance` method signature** (from `homesynapse-core/core/state-store/src/main/java/com/homesynapse/state/ProjectionAdvancer.java`):

```java
AdvanceResult advance(long fromPosition, int maxRows, Consumer<EventEnvelope> processor);
```

**Match:** EXACT. The expected line matches the on-disk source verbatim.

**Quotation 2 — `state-store`'s `requires` block** (from `homesynapse-core/core/state-store/src/main/java/module-info.java`):

```java
requires transitive com.homesynapse.platform;
requires transitive com.homesynapse.device;
requires transitive com.homesynapse.event;
```

**Match:** EXACT. The `requires transitive com.homesynapse.event;` line is present (the Deliverable 0 promotion). All three `requires` are `transitive` per LD#10.

**Quotation 3 — `ProjectionAdvancer` row's "Key Details" cell** (from `homesynapse-core/core/state-store/MODULE_CONTEXT.md`, line 65):

The cell begins with the literal phrase `"Single method:"` and reads in full:

> `Single method: \`advance(long fromPosition, int maxRows, Consumer<EventEnvelope> processor) → AdvanceResult\`. Constant: \`DEFAULT_MAX_ROWS = 500\`. Contract: each call opens an independent short-lived read transaction (≤ 2 s, ≤ 500 rows), invokes \`processor.accept(envelope)\` for each event in \`globalPosition\` order inside the read tx, then closes the tx before returning. Processor MUST NOT call \`EventPublisher.publish\` or perform writes (AMD-41 §3.2.1 enforcement point). Derived publishes are buffered by the processor and emitted after \`advance\` returns (two-phase discipline). No cursors held between calls — bounded-window discipline prevents WAL checkpoint starvation (AMD-38).`

**Match:** EXACT. Begins with `"Single method:"`; does NOT begin with `"Signature change pending"`.

**Quotation 4 — first 200 characters of AMD-41 §3.2.1** (verbatim from the on-disk `**§3.2.1 — Execution model (replaces existing §3.2.1).**` line):

```
**§3.2.1 — Execution model (replaces existing §3.2.1).** The `StateProjection` subscriber runs on a per-subscriber virtual thread (see AMD-42 §3.4). Each event delivery executes as the following
```

**Match:** EXACT (200 chars). The full §3.2.1 sub-section (one-line preamble + numbered phase list) is the source of §7.7 of this report.

**Quotation 5 — first 200 characters of AMD-42 §3.4.1**:

```
**§3.4.1 — Subscriber mode state machine.** Every subscriber registered with `EventBus` exposes a mode in `{ COLD, REPLAY, TRANSITION, LIVE, SUSPENDED }` via `SubscriberInfo.mode()`. Transitions ar
```

**Match:** EXACT (200 chars). The full §3.4.1 (the FSM diagram) and §3.4.2..§3.4.6 are the source of §8.7 of this report.

**Quotation 6 — first 200 characters of AMD-43 §3.6.1**:

```
**§3.6.1 — `EventPublisher.publish()` is non-blocking on backpressure (INV-BUS-02 normative).** The publisher MUST NOT block on writer queue depth. Natural backpressure arises from the single-threa
```

**Match:** EXACT (200 chars). The full §3.6.1 is the source of §9.1 of this report.

All six integrity-check quotations match expectations. No STOP-on-mismatch gate is tripped.

### §23.4 Mismatches encountered

The following discrepancies between the report's input prompt (or its referenced canon) and the on-disk reality were encountered during the analysis. Each is recorded as a finding; none is resolved here — that is PM territory.

- **F-1: `HomeSynapse_Navigation_Index.md` does not exist at the docs root.** The input prompt §2.1 instructs Cowork to start by reading `homesynapse-core-docs/HomeSynapse_Navigation_Index.md`. That file does not exist on disk. The canonical navigation index is `homesynapse-core-docs/design/00-navigation-index.md` (Status ACTIVE, Last updated 2026-05-16, created in the 2026-05-16 governance commit). The design-folder navigation index covers design documents, amendments, and the M3 lock-decisions cross-reference table; it is the source-of-truth used by the report.
- **F-2: `HomeSynapse_Knowledge_Primer.md` does not exist at the docs root.** The input prompt §2.1 references a "compressed architectural context" file at that path. No such file is on disk. The functional equivalent is the union of `design/00-navigation-index.md`, the MVP document (`governance/HomeSynapse_Core_v1_Project_MVP.md`), `Architecture_Invariants_v1.md`, and `HomeSynapse_Core_Locked_Decisions.md`. This report draws orientation from those files directly.
- **F-3: `PLAN-M3-CONSOLIDATED-02` does not exist as a standalone file under any obvious name.** The Navigation Index references it (`design/00-navigation-index.md` line 64) and the three M3 amendments cite specific sections (`§1.2`, `§8.2`, `§12`, `§13.3`, `§14`), but no file matching the name is on disk. The closest on-disk artifact is `design/HomeSynapse_Phase3_Master_Implementation_Plan_v2.md` (a 973-line broader Phase 3 plan). The M3-specific decisions DEC-M3-01..13 are reproduced abbreviated in the Navigation Index but do not appear in the v2 plan. This is documentation drift — the M3 plan is referenced by name in multiple amendments but the referenced file is not on disk.
- **F-4: New INV-* identifiers are referenced by AMD-41/42/43 but not registered in `Architecture_Invariants_v1.md`.** INV-BUS-01, INV-BUS-02, INV-BUS-03, INV-PROJ-01, INV-PROJ-04, INV-PROJ-NEW-01, INV-WRITER-01, and INV-SUB-ISO-01..06 are cited normatively by the three M3 amendments but do not appear in the canonical invariants register. Per INV-GA-01 / INV-GA-02, formal registration is appropriate. Recorded in §20.4.
- **F-5: Section reference style mismatch in the prompt.** The input prompt cites amendment sub-sections as if they were `### 3.2.1`-style headers (e.g., "AMD-41-state-projection-execution-model.md's §3.2.1"). The actual amendment files use `## Change specification` headers and embed sub-section markers as bold inline labels (e.g., `**§3.2.1 — Execution model**`). Both forms refer to the same content; this is a citation-style mismatch only, not a substantive disagreement. The integrity-check quotations in §23.3 use the verbatim inline-label form as it appears on disk.
- **F-6: AMD-39 status note in earlier plan drafts.** AMD-42's preamble carries a verbatim source-verification correction noting that earlier plan drafts attributed clock-injection authority to "AMD-39 (clock injection)" — AMD-39 was WITHDRAWN 2026-05-15 and concerns `journal_size_limit`, not clock discipline. The actual clock-injection enforcement surface is the `NO_DIRECT_TIME_ACCESS` ArchUnit rule + DEC-M3-09. This is already documented inline in the AMD-42 file; it is recorded here as a known prior-citation drift.
- **F-7: V003 migration file present but not enrolled.** The V003 SQL migration file lives on disk (per `design/v003_snapshots_design_note.md` and the AMD-41 §3.2.3 source-verification correction) but is NOT yet listed in `SqlitePersistenceLifecycle.EVENTS_MIGRATION_FILES`. Enrollment is part of M3.5b. This is the expected state per AMD-41 §3.2.3, not a defect.
- **F-8: `ProjectionAdvancerContractTest` has 11 test methods listed but `grep -c "@Test"` returns 12.** The 11 `@Test` methods are: `advanceDeliversInPositionOrder`, `advanceRespectsFromPositionExclusive`, `advanceRespectsMaxRows`, `advanceCapsAtDefaultMaxRows`, `advanceHasMoreWhenLogExceedsPage`, `advanceReachesTail`, `advanceProcessorInvokedInsideReadTx`, `advanceProcessorExceptionPropagates`, `advanceProcessorExceptionClosesReadTx`, `advanceRejectsInvalidArgs`, `advanceFromZeroDrainsLogInBoundedWindows`. The extra `@Test` occurrence in the grep count is a Javadoc reference (`@link Test`-style cross-reference in a class-level comment), not a 12th test method. Gate 7 (the contract test has 11 `@Test` methods) is satisfied.
- **F-9: `homesynapse-core` directory layout differs from the prompt's flat enumeration.** The input prompt §2.4 names modules by short path (e.g. `automation/automation-engine`, `integration-runtime`, `platform-api`). The on-disk layout uses nested groups: `core/automation/`, `integration/integration-runtime/`, `platform/platform-api/`, etc. The 19-module count is preserved. The report uses the on-disk paths.
- **F-10: Two production-or-near-production module names not in the prompt's enumeration.** The on-disk repository includes `platform/platform-systemd/` (systemd integration; scaffold) and `web-ui/dashboard/` (Preact SPA; separate build pipeline). Both have `MODULE_CONTEXT.md` files and are counted in the 19-module total. The input prompt §2.4 does not enumerate `platform-systemd` or `dashboard` explicitly.

### §23.5 Source-verification surprises

The following items are cases where the canonical source contradicted or refined what a casual reading of project memory might suggest. None changes the report's structure; each is recorded for future PM attention.

- **S-1: `AMD-39` is WITHDRAWN, not DEFERRED.** Several earlier traces (and the AMD-42 citation note) suggest at least one prior draft treated AMD-39 as applied. The on-disk amendment file explicitly carries `Status: WITHDRAWN` with `Date withdrawn: 2026-05-15`.
- **S-2: `synchronous=NORMAL` is the verified PRAGMA value, not `synchronous=FULL`.** The PRAGMA recipe in `research/sqlite-wal-validation-spike-results.md` §2 shows `synchronous = 1` (NORMAL). LTD-03's discussion text refers to "synchronous" without specifying a level; the empirically-verified value is NORMAL.
- **S-3: The read-pool default size is 2 platform threads, not 3.** The input prompt §6 cites "2–3"; the codebase default (per `PlatformThreadReadExecutor` and `DatabaseExecutor` constructor parameter conventions in `core/persistence/MODULE_CONTEXT.md`) is **2**. Three threads would require an explicit configuration override.
- **S-4: `EventPublisher`'s canonical name is preserved.** The input prompt §4 references "EventPublisher (canonical name, not EventAppender)" — the on-disk source uses `EventPublisher` everywhere; `EventAppender` does not appear. Likely a prior-name correction that has fully landed.
- **S-5: The `ParameterNamesModule` was dropped from `PersistenceObjectMapper`.** The on-disk `PersistenceObjectMapper.create()` recipe does not register `ParameterNamesModule`. This matches the prompt's description and the M2.4 design decision; included here for completeness as a confirmation against an alternative recollection.
- **S-6: `sharedBucketPool` → `newConcurrentDequePool` correction.** The `PersistenceObjectMapper` recipe uses `JsonRecyclerPools.newConcurrentDequePool()`. The MODULE_CONTEXT documents the explicit correction from an earlier `sharedBucketPool()` choice.
- **S-7: The `AttributeValue` serializer is deferred because no event record references it.** Confirmed: scanning the 22 core `DomainEvent` records in `event-model/MODULE_CONTEXT.md`, none uses `AttributeValue` as a field type. `StateChangedEvent` carries `oldValue String` and `newValue String`, not typed `AttributeValue` instances. The deferral is well-grounded.
- **S-8: The V003 schema's row layout (`subject_ref BLOB(16)`, `subject_type TEXT`) matches the events-table convention.** Confirmed against `design/v003_snapshots_design_note.md` — this is intentional cross-table consistency, not coincidence.
- **S-9: `MODULE_CONTEXT` count is 19, matching the prompt.** Verified via `find … -name "MODULE_CONTEXT.md"`: 19 files (rest-api, websocket-api, homesynapse-app, configuration, automation, device-model, event-bus, event-model, persistence, state-store, integration-api, integration-runtime, integration-zigbee, lifecycle, observability, platform-api, platform-systemd, test-support, dashboard). The prompt's enumerated 17 plus the two not-enumerated (`platform-systemd`, `dashboard`) makes 19.
- **S-10: `WriteCoordinator` and `WritePriority` are package-private internal types.** The input prompt §5 treats them as canonical references — they are, but they are package-private to `core/persistence` and never appear in any public API. `WritePriority`'s 5-value enum (`EVENT_PUBLISH`, `STATE_PROJECTION`, `WAL_CHECKPOINT`, `RETENTION`, `BACKUP`) is reproduced in §5.2 of this report from the MODULE_CONTEXT, not from a public API.

---

*End of report.*

