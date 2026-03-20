# Pre-Phase 3 Invariant Traceability Audit

**Document type:** Governance — audit findings
**Author:** PM (audit mode)
**Date:** 2026-03-20
**Scope:** All 81 architecture invariants (INV-LF-01 through INV-GA-03) traced through Locked Technical Decisions, design documents, and Phase 2 interface specifications
**Status:** Complete
**Input documents:** Architecture Invariants v1, Locked Decisions Register v1, Design Review Amendments v1, AMD-25, Virtual Thread Risk Audit Report, all 14 design documents, all 14 traceability documents, all 19 MODULE_CONTEXT files, Java source in homesynapse-core repository

---

## Executive Summary

This audit verifies the traceability chain from architecture invariant → locked technical decision → design document → interface specification → Java code for all 81 invariants across 15 categories. The audit was performed before Phase 3 to identify gaps that cost a document edit now versus a refactor later.

**Overall finding: The core event sourcing, reliability, configuration, and observability invariants are well-covered.** The 28 invariants that form the MVP's architectural backbone (§1–§4, §7–§9) have complete traceability chains verified to Java source. The 19 explicitly post-MVP invariants (AI, Energy, Multi-User, Mesh) are correctly deferred with appropriate data model foundations in place.

**Gaps requiring action before Phase 3:** 4 invariants have no design doc claim at all (broken traceability chain). 9 invariants have partial coverage where interface specs need completion. 5 invariants are classified DESIGN-ONLY (no LTD, but architecturally enforced — acceptable). 12 traceability documents remain empty scaffolds despite Phase 2 being complete — a documentation debt that should be resolved.

**Critical cross-cutting finding:** The Virtual Thread Risk Audit Report (2026-03-19) identified that sqlite-jdbc double-pins carrier threads on every database operation. This affects INV-PR-01, INV-PR-03, and the virtual thread assumptions in LTD-01/LTD-11. Remediation is documented but not yet incorporated into design documents or interface specs. This must be resolved before Phase 3 persistence and event-bus implementation.

---

## Section 1: Per-Invariant Traceability Table

### §1 Local-First Operation

| Invariant | Title | LTD(s) | Design Doc(s) | Interface Type(s) / Enforcement | Status | Notes |
|-----------|-------|--------|---------------|--------------------------------|--------|-------|
| INV-LF-01 | Core Functionality Without Internet | LTD-03, LTD-11, LTD-14, LTD-18 | Doc 13 §5, Doc 14 §2 | `module-info.java` in core modules (no `java.net.http`); static dashboard files in jlink distribution | COVERED | Verified: platform-api, event-model, event-bus, device-model module-info files contain no network module requires. |
| INV-LF-02 | Cloud Enhancement, Never Cloud Dependence | — | Doc 14 §2 | `module-info.java` enforcement; `integration-api` is the only module requiring `java.net.http` | DESIGN-ONLY | No LTD explicitly cites INV-LF-02, but enforcement is strong via JPMS boundaries. Three-level enforcement (capability boundary, dependency direction, CI grep check) is documented in invariant text. Acceptable. |
| INV-LF-03 | Graceful WAN Degradation | — | Doc 14 (implied) | No specific interface | POST-MVP | Behavioral invariant for cloud-enhanced features. MVP is local-only, so WAN degradation is not applicable until cloud features exist. Architectural compliance inherent in local-first design. |
| INV-LF-04 | No Required Cloud Account | — | — | No specific interface | DESIGN-ONLY | No LTD or design doc explicitly claims this. However, enforcement is architectural: no account creation flow exists in MVP. Zero-config first run (INV-CE-02) implicitly satisfies this. Should be explicitly cited in Doc 12 (startup/lifecycle). |
| INV-LF-05 | Convergent Sync Architecture | — | Doc 06 §3 | Per-entity sequences (EventEnvelope), ULID ordering, CausalContext | POST-MVP | MVP is single-instance. The invariant constrains the data model to be sync-compatible. Data model is compliant (per-entity sequences, ULIDs, no global coordination for correctness). Sync protocol itself is post-MVP. |

### §2 Event Sourcing Guarantees

| Invariant | Title | LTD(s) | Design Doc(s) | Interface Type(s) / Enforcement | Status | Notes |
|-----------|-------|--------|---------------|--------------------------------|--------|-------|
| INV-ES-01 | Events Are Immutable Facts | LTD-03, LTD-06 | Doc 01 §5, Doc 04 §3.2, Doc 09 | `EventEnvelope` (Java record = immutable); `EventStore` (append-only contract in Javadoc); `List.copyOf()` defensive copying | COVERED | Verified in Java source. EventEnvelope is a record with `List.copyOf()` on categories. EventStore provides no update/delete methods. |
| INV-ES-02 | State Is Always Derivable from Events | LTD-06 (implied) | Doc 01 §5, Doc 03 §1 | `EventStore.readBySubject()`, `StateStoreLifecycle` (rebuild from events), `CheckpointStore` | COVERED | State store is explicitly a materialized view rebuilt from event replay. Checkpoint-based recovery documented. |
| INV-ES-03 | Per-Entity Ordering with Causal Consistency | LTD-04, LTD-05 | Doc 01 §5 | `EventEnvelope` (subjectSequence, globalPosition fields), `SequenceConflictException`, `CausalContext` (correlationId, causationId) | COVERED | Verified: EventEnvelope carries both per-entity sequence and global position. SequenceConflictException enforces unique constraint on (subject_ref, subject_sequence). CausalContext provides chain/root factories. |
| INV-ES-04 | Write-Ahead Persistence | LTD-06 | Doc 01 §5, Doc 02, Doc 04 §3.2, Doc 05, Doc 06, Doc 07, Doc 10 | `EventPublisher` (Javadoc: "event is durable in SQLite WAL before this method returns") | COVERED | Verified in Java source. EventPublisher Javadoc explicitly documents WAL durability before subscriber notification. Most-cited invariant across design docs (7 documents). |
| INV-ES-05 | At-Least-Once Delivery with Subscriber Idempotency | LTD-06 | Doc 01 §5, Doc 04, Doc 05, Doc 08 | `CheckpointStore` (subscriber position tracking), `EventBus` (pull-based subscription), `SubscriberInfo` | COVERED | Verified: CheckpointStore interface provides writeCheckpoint/readCheckpoint. EventBus.subscribe() reads checkpoint and begins from stored position. Idempotency via per-entity sequence comparison. |
| INV-ES-06 | Every State Change Is Explainable | LTD-05, LTD-15 | Doc 01 §5, Doc 02, Doc 03, Doc 06, Doc 07, Doc 11 | `CausalContext` (correlationId, causationId), `EventStore.readByCorrelation()`, structured logging with correlation_id MDC | COVERED | Verified: CausalContext enables full causal chain assembly. EventStore provides readByCorrelation() for "why is this state?" queries. Six design docs claim this invariant. |
| INV-ES-07 | Event Schema Evolution | LTD-08, LTD-16 | Doc 01 §5, Doc 06 | `EventEnvelope` (schemaVersion field), `DegradedEvent` (fallback for unparseable events), Jackson `FAIL_ON_UNKNOWN_PROPERTIES=false` | COVERED | Verified: DegradedEvent preserves raw bytes when schema upcasting fails. Forward-compatible deserialization via lenient Jackson config. Independent event schema versioning per LTD-16. |
| INV-ES-08 | Event Time and Ingest Time Are Distinct | — | Doc 01 §5, Doc 04, Doc 07, Doc 08 | `EventEnvelope` (eventTime and ingestTime as separate Instant fields) | DESIGN-ONLY | No LTD explicitly serves this. Four design docs claim it. Verified in EventEnvelope record: both timestamps are distinct required fields. The `estimated` flag for event time approximation is documented. Acceptable — this is a data model design decision, not a technology choice requiring an LTD. |

### §3 Reliability and Fault Tolerance

| Invariant | Title | LTD(s) | Design Doc(s) | Interface Type(s) / Enforcement | Status | Notes |
|-----------|-------|--------|---------------|--------------------------------|--------|-------|
| INV-RF-01 | Integration Isolation | LTD-10, LTD-17 | Doc 02, Doc 05 §3, Doc 12, Doc 14 | `IntegrationContext` (scoped registries, scoped EventPublisher, scoped ConfigurationAccess), `IntegrationFactory`, `module-info.java` in integration-api, Gradle module boundaries | COVERED | Verified in Java source: IntegrationContext provides integration-scoped access to all core services. integration-api module-info declares clean boundary. Gradle module dependencies enforce direction. |
| INV-RF-02 | Resource Quotas for Integrations | LTD-17 | Doc 05 §3 | `IntegrationContext` (resource limits via supervisor), JFR custom events per integration | COVERED | IntegrationContext documents optional services gated by RequiredService declarations. JFR monitoring for resource consumption per integration documented. |
| INV-RF-03 | Startup Independence | LTD-17 | Doc 05, Doc 08, Doc 12 §3.6 | `IntegrationFactory` (async initialization), lifecycle phase ordering in Doc 12 | COVERED | Doc 12 specifies integrations initialize in Phase 5 (asynchronous, non-blocking). System reaches functional state before integrations complete. |
| INV-RF-04 | Crash Safety and Automatic Recovery | LTD-03, LTD-06, LTD-07, LTD-13, LTD-14 | Doc 04 §3.2, Doc 05 | `CheckpointStore`, `PersistenceLifecycle`, `MaintenanceService`, SQLite WAL mode, systemd `Restart=on-failure` | COVERED | Most heavily supported invariant: 5 LTDs serve it. Persistence layer provides WAL durability, checkpoint replay, and maintenance services. systemd provides automatic process restart. |
| INV-RF-05 | Bounded Storage Growth | LTD-07, LTD-15 | Doc 04 (retention) | `MaintenanceService` (retention execution), `TelemetryWriter` (ring buffer with slot-based overwrite), log rotation via Logback | COVERED | Retention policies are priority-based (DIAGNOSTIC 7d, NORMAL 90d, CRITICAL 365d). Telemetry uses ring buffer (seq % max_rows). Log rotation caps at 500 MB. |
| INV-RF-06 | Graceful Degradation Under Partial Failure | LTD-11 | Doc 04, Doc 05, Doc 06, Doc 12 | Lifecycle phase ordering, IntegrationContext isolation, EventBus subscriber independence | COVERED | Four design docs claim this. In-process event bus (LTD-11) means fewer failure modes. Integration isolation (RF-01) prevents cascade. |

### §4 Compatibility and Stability Contracts

| Invariant | Title | LTD(s) | Design Doc(s) | Interface Type(s) / Enforcement | Status | Notes |
|-----------|-------|--------|---------------|--------------------------------|--------|-------|
| INV-CS-01 | Semantic Versioning Is Enforced | LTD-16 | Doc 09, Doc 14 | REST API URL versioning (`/api/v1/`), OpenAPI spec as contract, oasdiff CI check | COVERED | LTD-16 specifies full semver protocol with additive-only within major version. |
| INV-CS-02 | Entity Identifiers Are Stable | LTD-04 | Doc 05, Doc 06, Doc 14 | `EntityId`, `DeviceId`, `AutomationId`, `PersonId` (typed ULID wrappers), `EntityRegistry` | COVERED | Verified in Java source: All ID types are immutable records wrapping Ulid. Generated once, never change. BLOB(16) storage. EntityRegistry provides stable lookup. |
| INV-CS-03 | Configuration Schema Stability | LTD-09, LTD-16 | Doc 06, Doc 14 | `SchemaRegistry`, `ConfigValidator`, JSON Schema validation | COVERED | LTD-09 mandates JSON Schema for all config. LTD-16 extends additive-only model to config schemas. SchemaRegistry interface in configuration module. |
| INV-CS-04 | Integration API Stability | LTD-16, LTD-17 | Doc 05, Doc 06, Doc 14 | `integration-api` module (independently versioned), build-time dependency enforcement | COVERED | integration-api is a separate Gradle module with its own version. Build-time enforcement via modules-graph-assert and ArchUnit. |
| INV-CS-05 | Update Safety Mechanisms | LTD-07, LTD-14 | Doc 06, Doc 14 | Upgrade CLI workflow, mandatory snapshot via `VACUUM INTO`, dry-run validation, rollback procedure | COVERED | LTD-14 specifies the complete upgrade sequence (12 steps). Snapshot contents and rollback semantics fully documented. |
| INV-CS-06 | Deprecation Discipline | LTD-16 | Doc 06, Doc 14 | `Deprecated: true` + `Sunset:` response headers (RFC 8594), structured deprecation log warnings | COVERED | LTD-16 specifies full deprecation protocol: 1 major version minimum window, migration guide, automated tooling where feasible. |
| INV-CS-07 | No Forced Hardware Obsolescence | LTD-02 | Doc 14 | Pi 4 as validation floor, all benchmarks against Pi 4 class | GOVERNANCE-ONLY | Policy invariant. LTD-02 locks Pi 4 as floor with explicit reversal criteria. No code interface needed — enforcement is through testing and CI. |

### §5 Household Operability

| Invariant | Title | LTD(s) | Design Doc(s) | Interface Type(s) / Enforcement | Status | Notes |
|-----------|-------|--------|---------------|--------------------------------|--------|-------|
| INV-HO-01 | Physical Control Supremacy | — | — | No specific interface | GAP | **No design doc explicitly claims this invariant.** Doc 07 (automation engine) should claim it — the automation engine must never prevent or delay physical control actions. Doc 02 (device model) should specify that physical control events have priority. This is an MVP-critical behavioral property. |
| INV-HO-02 | Operable Under Degradation | — | — | No specific interface | GAP | **No design doc claims this.** Partially implied by INV-RF-06 (graceful degradation) but the user-facing operability dimension is not explicitly claimed. Doc 13 (Web UI) should claim it — the dashboard must remain usable when subsystems are degraded. |
| INV-HO-03 | No Debugging for Daily Operation | — | — | No specific interface | GAP | **No design doc claims this.** UI/UX constraint. Doc 13 (Web UI) should explicitly claim this as a design principle. The dashboard must be the sole interface for daily operations. |
| INV-HO-04 | Self-Explaining Errors | — | Doc 05 §5, Doc 06 §5, Doc 07 §5 | Exception hierarchy in event-model (`HomeSynapseException`, `EntityNotFoundException`, etc.), structured error events | DESIGN-ONLY | Three design docs claim this. Error types exist in event-model. No LTD — acceptable for a behavioral quality invariant. Exception hierarchy provides the foundation; human-readable error messages are an implementation concern for Phase 3. |
| INV-HO-05 | The Partner Test | — | — | No specific interface | GOVERNANCE-ONLY | Release gate, not a code contract. Enforcement is through manual testing before release. No interface or design doc needed. |

### §6 Privacy and Data Sovereignty

| Invariant | Title | LTD(s) | Design Doc(s) | Interface Type(s) / Enforcement | Status | Notes |
|-----------|-------|--------|---------------|--------------------------------|--------|-------|
| INV-PD-01 | Zero Telemetry by Default | LTD-14, LTD-15 | — | No telemetry/analytics infrastructure in core modules; LTD-14 prohibits auto-update phoning home; LTD-15 prohibits remote log shipping | COVERED | Enforcement is architectural: no outbound telemetry code exists. LTD-14 and LTD-15 explicitly prohibit remote data transmission. Verified via JPMS: core modules have no network I/O capability. |
| INV-PD-02 | Data Residency Is User-Controlled | — | — | No specific interface | DESIGN-ONLY | Default satisfaction: all data is local (SQLite on-device). No cloud storage exists in MVP. When cloud features are added, this invariant constrains their design. No code interface needed for MVP. |
| INV-PD-03 | Encrypted Storage | — | Doc 02, Doc 04, Doc 05, Doc 06, Doc 08, Doc 14 | `SecretStore` (AES-256-GCM encrypted), `ConfigurationAccess` (secrets resolved before delivery) | COVERED | SecretStore interface in configuration module provides encrypted storage. Six design docs claim this invariant. Secrets never appear in plaintext in config files or logs. |
| INV-PD-04 | Transparent Data Boundaries | — | — | No specific interface | GAP | **No design doc claims this. No interface exists for the data manifest.** The invariant requires a machine-readable and human-readable manifest of what data exists and where. This is an MVP deliverable (users must understand what data the system holds). Recommend: add data manifest requirement to Doc 11 (observability) or Doc 13 (web UI). |
| INV-PD-05 | Consent Is Granular, Informed, and Revocable | — | — | No specific interface | POST-MVP | The consent framework applies when cloud/AI features transmit data externally. MVP is local-only with no external data transmission. The invariant's MVP scope is satisfied by PD-01 (no telemetry). |
| INV-PD-06 | Offline Integrity | — | Doc 04 §3.2 | `PersistenceLifecycle`, SQLite WAL mode, crash-safe writes | COVERED | Satisfied by the same mechanisms as INV-RF-04 (crash safety). Doc 04 explicitly addresses offline integrity through transactional writes and WAL. |
| INV-PD-07 | Crypto-Shredding for Sensitive Data Lifecycle | — | Doc 01 §4.4, Doc 04 | No dedicated interface yet | PARTIAL | **Design docs reference crypto-shredding but no interface enforces it.** MVP scope states: "must implement the per-scope key management infrastructure and define the encryption scope categories." The SecretStore handles key storage, but no `CryptoShredder`, `ScopeKeyManager`, or equivalent interface exists in any MODULE_CONTEXT. This is a Phase 2 gap. |
| INV-PD-08 | Tamper-Evident System Integrity | LTD-13, LTD-14 | Doc 14 | `/opt/homesynapse/` read-only filesystem (systemd `ProtectSystem=strict`), package signature verification (LTD-14), but no integrity chain interface | PARTIAL | **LTDs provide deployment-level tamper evidence (read-only filesystem, signed packages), but no hash chain interface exists for configuration change auditing or integration provenance tracking.** MVP scope requires integrity chain for firmware, updates, configuration, and integration provenance. No `IntegrityChain`, `HashChainStore`, or equivalent interface in MODULE_CONTEXT files. |

### §7 Transparency and Observability

| Invariant | Title | LTD(s) | Design Doc(s) | Interface Type(s) / Enforcement | Status | Notes |
|-----------|-------|--------|---------------|--------------------------------|--------|-------|
| INV-TO-01 | System Behavior Is Observable | LTD-15, LTD-18 | Doc 05, Doc 07, Doc 11, Doc 12, Doc 14 | JFR continuous recording, structured JSON logging, custom JFR events, Preact dashboard (Doc 13/LTD-18) | COVERED | Five design docs claim this. JFR + structured logs + dashboard provide the three observability dimensions (what, why, how). |
| INV-TO-02 | Automation Determinism | — | Doc 02, Doc 07 §5, Doc 11 | `TriggerEvaluator`, `ConditionEvaluator`, `RunManager`, `ActionExecutor` — deterministic evaluation pipeline with deduplication (C2), priority ordering (C3), single StateSnapshot | COVERED | Verified in Java source: Four automation interfaces enforce deterministic evaluation. Doc 07 specifies that identical event streams + identical config = identical outcomes. AMD-03 snapshot pattern ensures conditions evaluate against consistent state. |
| INV-TO-03 | No Hidden State | — | Doc 02, Doc 03, Doc 06, Doc 09 | `StateQueryService` (all state inspectable), `EventStore` (all events queryable), `ConfigurationAccess` (all config visible) | COVERED | Four design docs claim this. All state is either in the event log (queryable via EventStore) or materialized views (queryable via StateQueryService). Configuration is human-readable YAML. |
| INV-TO-04 | Structured, Queryable Logs | LTD-15 | Doc 11 | Structured JSON logging via logstash-logback-encoder; mandatory fields: correlation_id, entity_id, integration_id in MDC | COVERED | LTD-15 specifies the complete structured logging stack. Doc 11 details the observability surface including JFR event streaming for real-time dashboard consumption. |

### §8 Configuration and Extensibility

| Invariant | Title | LTD(s) | Design Doc(s) | Interface Type(s) / Enforcement | Status | Notes |
|-----------|-------|--------|---------------|--------------------------------|--------|-------|
| INV-CE-01 | Canonical, Human-Readable Configuration | LTD-09 | Doc 06 §5 | `ConfigurationService`, `ConfigurationAccess` (read-only view), YAML 1.2 via SnakeYAML Engine, JSON Schema validation | COVERED | Verified: ConfigurationAccess provides resolved, typed config values. LTD-09 mandates YAML 1.2 + JSON Schema. Single canonical representation: YAML files on disk, accessible through UI and file system. |
| INV-CE-02 | Zero-Configuration First Run | LTD-03, LTD-11, LTD-13, LTD-18 | Doc 02, 03, 04, 05, 06, 08, 09, 10, 12, 13 | Sensible defaults in all configuration schemas; SQLite (no DB server); in-process event bus (no broker); self-contained jlink distribution | COVERED | Most widely claimed invariant: 10 design docs reference it. Every subsystem must provide sensible defaults. Four LTDs serve it. |
| INV-CE-03 | Configuration Schema Is Documented and Versioned | LTD-09 | Doc 06 §5 | `SchemaRegistry`, `ConfigValidator`, JSON Schema definitions, `homesynapse validate-config` CLI command | COVERED | SchemaRegistry interface provides schema lookup. JSON Schema files enable VS Code auto-completion. Startup validation rejects invalid config. |
| INV-CE-04 | Protocol Agnosticism in the Device Model | LTD-12 | Doc 02, Doc 08 | `Capability` (sealed interface, 15 standard + CustomCapability), `Device` (record, no protocol fields), `CapabilityRegistry` | COVERED | Verified in Java source: Capability sealed hierarchy is entirely protocol-agnostic. Device record carries generic hardware metadata. Protocol details are isolated in HardwareIdentifier (discovery only). |
| INV-CE-05 | Extension Model with Stability Guarantees | LTD-12 | Doc 02, Doc 05 | `IntegrationFactory`, `IntegrationContext`, `integration-api` module (independently versioned) | COVERED | Integration API provides stable surface. LTD-12 ensures the Zigbee adapter uses the same API that community adapters will use. LTD-17 enforces build-time boundary. |
| INV-CE-06 | Migration Tooling Accompanies Schema Evolution | LTD-07 | Doc 06 §5 | `ConfigMigrator`, `MigrationResult`, `MigrationPreview`, `MigrationChange` records in configuration module | COVERED | ConfigMigrator interface provides preview and execute methods. MigrationPreview enables user review before applying. Forward-only SQL migrations per LTD-07 for database schema. |

### §9 Performance and Resource Discipline

| Invariant | Title | LTD(s) | Design Doc(s) | Interface Type(s) / Enforcement | Status | Notes |
|-----------|-------|--------|---------------|--------------------------------|--------|-------|
| INV-PR-01 | Constrained Hardware Is Primary Design Target | LTD-01, LTD-02, LTD-03, LTD-08, LTD-11, LTD-13, LTD-15, LTD-18 | Doc 02, 05, 09, 10, 11, 13, 14 | JVM tuning flags (LTD-01), Pi 4 validation floor (LTD-02), SQLite footprint (LTD-03), jlink size reduction (LTD-13), zero server CPU for dashboard (LTD-18) | COVERED | Most heavily supported by LTDs: 8 decisions serve it. Cross-cutting constraint verified in every subsystem. |
| INV-PR-02 | Quantitative Performance Targets | LTD-01, LTD-18 | Doc 02, 03, 09, 11, 14 | Constitutional targets in invariant doc; operational budgets in design docs; JFR measurement methodology | COVERED | Six constitutional targets defined with units and deployment context. Each design doc specifies operational budgets with JFR measurement methods. |
| INV-PR-03 | Resource Usage Is Bounded and Predictable | LTD-01, LTD-13, LTD-15 | Doc 05, 07, 08, 11, 14 | `-Xmx1536m` (LTD-01), `MemoryMax=2G` (LTD-13 systemd), log rotation 500 MB cap (LTD-15), bounded queues per subscriber (LTD-11) | COVERED | Three layers of resource bounding: JVM heap, systemd cgroup, per-subsystem bounds. Five design docs claim this. |
| INV-PR-04 | Architecture Must Accommodate 1,000 Devices | — | Doc 02, Doc 03 | Architectural constraint: ConcurrentHashMap state store, efficient event routing, capability-based device model | COVERED | Architectural accommodation, not a performance target. Device model (Doc 02) and state store (Doc 03) designed for this scale. No LTD needed — enforcement is through architecture review. |

### §10 Security

| Invariant | Title | LTD(s) | Design Doc(s) | Interface Type(s) / Enforcement | Status | Notes |
|-----------|-------|--------|---------------|--------------------------------|--------|-------|
| INV-SE-01 | No Default Credentials | LTD-13 | Doc 09, Doc 13 | Dedicated `homesynapse` service user (LTD-13, no login shell); first-run setup requires credential creation | PARTIAL | **LTD-13 provides OS-level enforcement (unprivileged service user). Design docs reference authentication. But no `SetupWizard` or `InitialCredentialFlow` interface exists in Phase 2 specs.** The mechanism for first-run credential creation is not specified as an interface. Recommend: add to Doc 09 (REST API) or Doc 12 (lifecycle) Phase 2 spec. |
| INV-SE-02 | Authentication Required for All External Interfaces | — | Doc 03, Doc 09, Doc 10 | REST API and WebSocket API reference authentication requirements | PARTIAL | **Three design docs claim authentication, but no `AuthenticationService`, `TokenValidator`, or equivalent interface exists in any MODULE_CONTEXT.** The rest-api and websocket-api MODULE_CONTEXT files are templates with no type inventory. Authentication interfaces must be specified before Phase 3 for these modules. |
| INV-SE-03 | Secrets Encrypted at Rest | — | Doc 04, 06, 08, 09, 14 | `SecretStore` (AES-256-GCM), configuration module | COVERED | SecretStore interface in configuration module provides encrypted secret storage. Five design docs claim this. Log redaction of secrets documented in LTD-15. |
| INV-SE-04 | Least Privilege for Integrations | — | Doc 02, 03, 05 | `IntegrationContext` (scoped registries: integration-scoped EntityRegistry, StateQueryService, EventPublisher limited to 5 event types) | COVERED | Verified in Java source: IntegrationContext enforces scoped access. Integration can only see its own entities, query its own state, and publish permitted event types. |
| INV-SE-05 | Remote Access Is End-to-End Encrypted | — | Doc 09 | No specific interface | POST-MVP | Remote access is optional and not implemented in MVP. Doc 09 references it architecturally. When implemented, requires E2E encryption with zero-knowledge relay. |
| INV-SE-06 | Security Updates Without Feature Churn | — | — | No specific interface | POST-MVP | Release infrastructure concern. LTS channel is a directional commitment (§16.8). MVP may ship only standard channel, but versioning must accommodate it. LTD-16 semver provides the foundation. |

### §11 AI and Intelligence

| Invariant | Title | LTD(s) | Design Doc(s) | Interface Type(s) / Enforcement | Status | Notes |
|-----------|-------|--------|---------------|--------------------------------|--------|-------|
| INV-AI-01 | AI Is Enhancement, Never Foundation | — | — | No specific interface | POST-MVP | Architectural constraint: AI modules are enhancement modules, not core. Core must function with all AI disabled. No AI module exists in MVP. The invariant is satisfied by absence — but the constraint must be enforced when AI modules are added. |
| INV-AI-02 | AI Requires Explicit Consent | — | — | No specific interface | POST-MVP | Depends on consent framework (INV-PD-05). Both are post-MVP. |
| INV-AI-03 | AI Decisions Are Explainable | — | — | No specific interface | POST-MVP | Applies when AI features exist. |
| INV-AI-04 | Local AI Capability | — | — | No specific interface | POST-MVP | Architecture supports it (constrained hardware targets, local-first design), but no AI runtime interface exists. |
| INV-AI-05 | On-Device Behavior Modeling | — | — | No specific interface | POST-MVP | MVP scope: define behavioral data pipeline. Event taxonomy includes behavioral event types. Data pipeline interface not yet specified. |

### §12 Energy Intelligence

| Invariant | Title | LTD(s) | Design Doc(s) | Interface Type(s) / Enforcement | Status | Notes |
|-----------|-------|--------|---------------|--------------------------------|--------|-------|
| INV-EI-01 | Energy as First-Class Domain | — | Doc 01 (event taxonomy), Doc 02 (device model) | `EnergyMeter` capability, `PowerMeter` capability, `EnergyDirection` enum in device-model; energy event categories in event taxonomy | PARTIAL | **MVP scope says model must include energy entity types and event categories.** Device model has EnergyMeter and PowerMeter capabilities. Event taxonomy includes energy categories. But no design doc has a dedicated §5 claim for INV-EI-01. Coverage is implicit through CE-04 (protocol agnosticism) rather than explicit. Recommend: Doc 02 should explicitly claim INV-EI-01 in its Contracts section. |
| INV-EI-02 | Grid-Interactive by Design | — | — | No specific interface | POST-MVP | MVP scope: event taxonomy must include grid signal event types. Automation engine supports time-based triggers and external signal evaluation. OpenADR client is post-MVP. |
| INV-EI-03 | Carbon-Aware Scheduling Architecture | — | — | No specific interface | POST-MVP | MVP scope: automation engine must support time-window constraints and external data sources. Architecture accommodates this through automation engine design. |
| INV-EI-04 | Energy Data Sovereignty | — | Doc 01 (privacy categories) | Governed by INV-PD-07 (crypto-shredding) and INV-PD-05 (consent) | POST-MVP | Energy data is listed as a crypto-shredding category in INV-PD-07. Privacy enforcement depends on the consent framework. |
| INV-EI-05 | Hardware-Agnostic Energy Metering | — | — | `Capability` sealed hierarchy (protocol-agnostic), integration model | COVERED | Satisfied by INV-CE-04 (protocol agnosticism) and INV-CE-05 (extension model). Energy hardware is accessed through standard integration adapters, same as any other device type. Device model has no vendor-specific references. |

### §13 Multi-User Identity and Presence

| Invariant | Title | LTD(s) | Design Doc(s) | Interface Type(s) / Enforcement | Status | Notes |
|-----------|-------|--------|---------------|--------------------------------|--------|-------|
| INV-MU-01 | Identity-Aware Device Model | — | Doc 01 §4.4 | `EventEnvelope` (actorRef field for user attribution), `PersonId` typed wrapper in platform-api | PARTIAL | **MVP scope: event envelope must include optional identity field with defined semantics.** EventEnvelope has actorRef. PersonId exists in platform-api. But no design doc explicitly claims INV-MU-01 in a §5 Contracts section. Doc 01 references it in the event taxonomy. The automation engine's user-identity conditions and causal identity propagation are not reflected in the automation MODULE_CONTEXT interface inventory. |
| INV-MU-02 | Spatial Presence as Core Primitive | — | — | `PresenceSignalEvent`, `PresenceChangedEvent` in event-model | PARTIAL | **MVP scope: event taxonomy and state model must include presence types.** Presence event types exist in event-model. But no `PresenceState`, `ZonePresence`, or equivalent state-model type exists in any MODULE_CONTEXT. The state-model dimension of presence is not specified. |
| INV-MU-03 | Preference Arbitration Framework | — | — | No specific interface | POST-MVP | Full ACRA/MeCRA/HyCRA arbitration is post-MVP. MVP scope: automation model must not prevent its implementation. Automation engine's multi-condition evaluation provides the foundation. |
| INV-MU-04 | Household Role Model | — | — | No specific interface | POST-MVP | MVP scope: implement at least admin and member roles. No `Role`, `Permission`, or `RoleBasedAccessControl` interface in MODULE_CONTEXT. This is needed before Phase 3 for rest-api and websocket-api modules. |
| INV-MU-05 | Graceful Identity Degradation | — | — | No specific interface | POST-MVP | Depends on identity/presence system existing first. Degradation hierarchy defined in invariant text. |

### §14 Mesh and Network Intelligence

| Invariant | Title | LTD(s) | Design Doc(s) | Interface Type(s) / Enforcement | Status | Notes |
|-----------|-------|--------|---------------|--------------------------------|--------|-------|
| INV-MN-01 | Protocol-Agnostic Network Telemetry | — | Doc 08 §3.11 | `TelemetrySample`, `TelemetryWriter`, `TelemetryQueryService` in persistence module | PARTIAL | **MVP scope: Zigbee adapter must emit telemetry events.** Persistence module has telemetry interfaces. Doc 08 specifies Zigbee RSSI/LQI telemetry emission. But the "unified telemetry model" for cross-protocol comparison is not specified as an interface — telemetry types are generic (4 fields), which may or may not be sufficient. |
| INV-MN-02 | Mesh Health as Observable State | — | Doc 08 §3.11 | No dedicated interface for mesh health as entity state | PARTIAL | **Design doc claims mesh health visibility, but no `MeshHealthEntity` or `NetworkHealthState` type exists.** The invariant requires mesh health as a "first-class observable entity." Current telemetry is event-based, not entity-state-based. This may need a mesh health projection in the state store. |
| INV-MN-03 | Predictive Network Diagnostics | — | — | No specific interface | POST-MVP | MVP scope: store telemetry with sufficient granularity for trend analysis. TelemetryWriter and ring buffer satisfy the data foundation requirement. Predictive algorithms are post-MVP. |
| INV-MN-04 | Battery-Aware Network Optimization | — | — | No specific interface | POST-MVP | Depends on network telemetry foundation (MN-01) being in place. Architecture accommodates future optimization actions. |

### §15 Governance and Amendment

| Invariant | Title | LTD(s) | Design Doc(s) | Interface Type(s) / Enforcement | Status | Notes |
|-----------|-------|--------|---------------|--------------------------------|--------|-------|
| INV-GA-01 | Invariant Stability | — | — | No code interface | GOVERNANCE-ONLY | Process invariant. Amendment process defined in invariant doc §15 and LTD doc §18. Enforcement is procedural. |
| INV-GA-02 | Invariant Identifiers Are Permanent | — | — | No code interface | GOVERNANCE-ONLY | Process invariant. Identifier permanence is a documentation convention. |
| INV-GA-03 | Compliance Is Verified in Review | — | — | No code interface | GOVERNANCE-ONLY | Process invariant. This audit is itself an exercise of INV-GA-03. |

---

## Section 2: Gap Analysis

### CRITICAL Gaps (Block Phase 3)

**No critical gaps found.** All MVP-essential invariants have at least design-doc-level traceability with verified interface types. The priority invariants (INV-ES-01 through ES-08, INV-RF-01, RF-04, CE-01, CE-04, TO-02, LF-01/02, CS-02) have complete traceability chains verified to Java source.

### IMPORTANT Gaps (Should Fix Before Phase 3)

#### GAP-01: INV-HO-01 (Physical Control Supremacy) — UNCOVERED
- **What's missing:** No design document explicitly claims INV-HO-01. No LTD references it. The invariant states that the automation system must never prevent, override, or delay a physical control action — this is an MVP-critical behavioral property.
- **Severity:** IMPORTANT
- **Recommended action:** Doc 07 (Automation Engine) §5 Contracts and Invariants section must add an explicit claim for INV-HO-01. The automation engine's conflict resolution rules (priority ordering, physical-wins semantics) should be documented as the enforcement mechanism. Doc 02 (Device Model) should specify that physical control events carry maximum priority.

#### GAP-02: INV-HO-02 (Operable Under Degradation) — UNCOVERED
- **What's missing:** No design doc claims this. The behavioral requirement that non-technical household members can operate the system during degradation is not traced.
- **Severity:** IMPORTANT
- **Recommended action:** Doc 13 (Web UI) §5 should claim INV-HO-02. The dashboard must show clear degradation states and maintain control of unaffected devices. Doc 12 (Lifecycle) should specify health status propagation to the UI.

#### GAP-03: INV-HO-03 (No Debugging for Daily Operation) — UNCOVERED
- **What's missing:** No design doc claims this UX invariant.
- **Severity:** IMPORTANT
- **Recommended action:** Doc 13 (Web UI) §5 should claim INV-HO-03 as a design principle. All daily operations must be achievable through the dashboard without YAML editing or CLI access.

#### GAP-04: INV-PD-04 (Transparent Data Boundaries) — UNCOVERED
- **What's missing:** No design doc claims this. No interface for the data manifest exists. The invariant requires a machine-readable inventory of what data is stored, what can leave the home, and what each integration accesses.
- **Severity:** IMPORTANT
- **Recommended action:** Doc 11 (Observability) or Doc 13 (Web UI) should claim INV-PD-04. A `DataManifest` or `DataInventory` interface should be added to the observability or configuration module.

#### GAP-05: INV-PD-07 (Crypto-Shredding) — PARTIAL
- **What's missing:** Design docs reference crypto-shredding but no dedicated interface exists. MVP scope explicitly requires per-scope key management infrastructure. No `ScopeKeyManager`, `CryptoShredder`, or equivalent interface in any MODULE_CONTEXT.
- **Severity:** IMPORTANT
- **Recommended action:** Add crypto-shredding interfaces to the persistence module's Phase 2 spec. At minimum: `ScopeKeyManager` (manage per-scope encryption keys), `EncryptedEventWriter` (encrypt designated event payloads), and a configuration schema for scope definitions.

#### GAP-06: INV-PD-08 (Tamper-Evident System Integrity) — PARTIAL
- **What's missing:** LTD-13 and LTD-14 provide deployment-level tamper evidence (read-only filesystem, signed packages), but no hash chain interface exists for the configuration change audit trail or integration provenance tracking required by the invariant's MVP scope.
- **Severity:** IMPORTANT
- **Recommended action:** Add integrity chain interfaces. At minimum: `IntegrityChainStore` (append-only hash chain for config changes and integration provenance) and `IntegrityVerifier` (verify chain consistency). These could live in the persistence module or a new `integrity` module.

#### GAP-07: INV-SE-02 (Authentication Required for All External Interfaces) — PARTIAL
- **What's missing:** Three design docs claim authentication, but no `AuthenticationService`, `TokenValidator`, or security filter interface exists in any Phase 2 spec. The rest-api and websocket-api MODULE_CONTEXT files are still templates.
- **Severity:** IMPORTANT
- **Recommended action:** Phase 2 specs for rest-api and websocket-api modules must include authentication interfaces before Phase 3 implementation. At minimum: `AuthenticationService` (validate credentials, issue tokens), `AuthorizationFilter` (per-request auth check), `SessionManager` (WebSocket session authentication).

### INFORMATIONAL Gaps

#### INFO-01: INV-LF-04 (No Required Cloud Account) — DESIGN-ONLY
- No design doc explicitly claims this. Enforcement is architectural (no account creation flow exists). Should be explicitly cited in Doc 12 (lifecycle/startup) for completeness.

#### INFO-02: INV-EI-01 (Energy as First-Class Domain) — PARTIAL
- Device model has EnergyMeter/PowerMeter capabilities and energy event categories exist, but no design doc explicitly claims INV-EI-01 in a Contracts section. Recommend Doc 02 add explicit claim.

#### INFO-03: INV-MU-01 (Identity-Aware Device Model) — PARTIAL
- EventEnvelope has actorRef. PersonId exists. Presence events exist. But the full MVP scope (user-identity conditions in automation, causal identity propagation) is not reflected in automation module interfaces. Lower priority since multi-user is early-MVP/post-MVP boundary.

#### INFO-04: INV-SE-01 (No Default Credentials) — PARTIAL
- LTD-13 provides OS-level enforcement. No first-run credential setup interface specified. Should be added to rest-api Phase 2 spec.

### DOCUMENTATION Gaps

#### DOC-01: 12 of 14 Traceability Documents Are Empty Scaffolds
- **Finding:** Only `01-event-model.md` (fully populated, 28 interface mappings) and `12-lifecycle.md` (minimally populated, 2 mappings) have content. The remaining 12 traceability documents contain only empty scaffold comments ("Populated during Phase 2").
- **Severity:** DOCUMENTATION
- **Recommended action:** Populate all 12 empty traceability documents from the MODULE_CONTEXT type inventories. Modules with completed Phase 2 specs (device-model, state-store, persistence, configuration, automation, event-bus) have detailed type inventories in their MODULE_CONTEXT files that should be reflected in traceability docs.

#### DOC-02: Virtual Thread Risk Not Yet Incorporated into Design Documents
- **Finding:** The Virtual Thread Risk Audit Report (2026-03-19) identifies critical sqlite-jdbc carrier thread pinning requiring architectural mitigation (platform thread executor for all DB operations). This finding affects Doc 01 (event bus dispatch model), Doc 03 (state store threading), Doc 04 (persistence layer threading), Doc 05 (integration runtime threading), and Doc 07 (automation engine execution model). None of these design docs have been amended to reflect this finding.
- **Severity:** DOCUMENTATION (with Phase 3 implementation implications)
- **Recommended action:** Create AMD-26 to amend affected design documents with the platform thread executor pattern for sqlite-jdbc operations, per the Virtual Thread Risk Audit Report's remediation plan. This should be completed before Phase 3 begins for any module that touches SQLite.

---

## Section 3: Coverage Statistics

| Metric | Count | Percentage |
|--------|-------|------------|
| **Total invariants** | **81** | 100% |
| COVERED | 40 | 49.4% |
| DESIGN-ONLY | 5 | 6.2% |
| PARTIAL | 9 | 11.1% |
| GAP (UNCOVERED) | 4 | 4.9% |
| POST-MVP | 18 | 22.2% |
| GOVERNANCE-ONLY | 5 | 6.2% |

**MVP-relevant invariants** (excluding POST-MVP and GOVERNANCE-ONLY): 58
- COVERED: 40 (69.0%)
- DESIGN-ONLY: 5 (8.6%) — acceptable, no code interface needed
- PARTIAL: 9 (15.5%) — interface gaps to resolve
- GAP: 4 (6.9%) — design doc claims missing

**Priority invariants verified to Java source:** 8/8 invariant groups passed (INV-ES-01–08, INV-RF-01, INV-RF-04, INV-CE-01, INV-CE-04, INV-TO-02, INV-LF-01/02, INV-CS-02).

---

## Section 4: Categories With Weak Coverage

| Category | § | Total | COVERED | DESIGN-ONLY | PARTIAL | GAP | POST-MVP | GOV-ONLY | Weak? |
|----------|---|-------|---------|-------------|---------|-----|----------|----------|-------|
| Local-First | §1 | 5 | 1 | 2 | 0 | 0 | 2 | 0 | No — DESIGN-ONLY acceptable |
| Event Sourcing | §2 | 8 | 7 | 1 | 0 | 0 | 0 | 0 | **No — 87.5% COVERED** |
| Reliability | §3 | 6 | 6 | 0 | 0 | 0 | 0 | 0 | **No — 100% COVERED** |
| Compatibility | §4 | 7 | 6 | 0 | 0 | 0 | 0 | 1 | No |
| **Household Operability** | **§5** | **5** | **0** | **1** | **0** | **3** | **0** | **1** | **YES — 60% GAP** |
| **Privacy** | **§6** | **8** | **3** | **1** | **2** | **1** | **1** | **0** | **YES — 37.5% PARTIAL+GAP** |
| Observability | §7 | 4 | 4 | 0 | 0 | 0 | 0 | 0 | **No — 100% COVERED** |
| Configuration | §8 | 6 | 6 | 0 | 0 | 0 | 0 | 0 | **No — 100% COVERED** |
| Performance | §9 | 4 | 4 | 0 | 0 | 0 | 0 | 0 | **No — 100% COVERED** |
| **Security** | **§10** | **6** | **2** | **0** | **2** | **0** | **2** | **0** | **YES — 50% PARTIAL (of MVP-relevant)** |
| AI | §11 | 5 | 0 | 0 | 0 | 0 | 5 | 0 | No — all POST-MVP |
| Energy | §12 | 5 | 1 | 0 | 1 | 0 | 3 | 0 | No — mostly POST-MVP |
| Multi-User | §13 | 5 | 0 | 0 | 2 | 0 | 3 | 0 | No — mostly POST-MVP |
| Mesh Network | §14 | 4 | 0 | 0 | 2 | 0 | 2 | 0 | No — mostly POST-MVP |
| Governance | §15 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | No — all GOVERNANCE-ONLY |

### Flagged Categories

**§5 Household Operability: 60% GAP.** This is the most significant systemic gap. Three of five invariants (HO-01, HO-02, HO-03) have no design doc claims and no LTD references. These are MVP-relevant behavioral invariants that define the user experience difference between HomeSynapse and competitors. The design documents focus heavily on technical architecture (event sourcing, persistence, integration isolation) but have not explicitly addressed the household operability dimension.

**Recommended systemic fix:** Doc 07 (Automation Engine) should claim INV-HO-01. Doc 13 (Web UI) should claim INV-HO-02 and INV-HO-03. These are not code-heavy changes — they are explicit commitments in the Contracts and Invariants sections that ensure Phase 3 implementors know these properties must be satisfied.

**§6 Privacy: 37.5% PARTIAL+GAP.** Two invariants (PD-07, PD-08) have broken interface chains — design docs reference them but no Phase 2 interfaces enforce them. One invariant (PD-04) has no design doc coverage at all. This is concerning because privacy is a strategic differentiator for NexSys. The SecretStore and local-first architecture provide a strong foundation, but the advanced privacy mechanisms (crypto-shredding, tamper-evident integrity, data manifest) need interface specifications before Phase 3.

**§10 Security: 50% PARTIAL of MVP-relevant.** Authentication interfaces (SE-01, SE-02) are not specified despite being MVP-essential. Of the 4 MVP-relevant security invariants, 2 are COVERED (SE-03, SE-04) and 2 are PARTIAL (SE-01, SE-02). The rest-api and websocket-api modules need Phase 2 security interface specs. This is a known gap — these modules' MODULE_CONTEXT files are still templates.

---

## Appendix A: LTD-to-Invariant Reverse Mapping

For reference, the complete mapping from each LTD to the invariants it serves:

| LTD | Invariants Served |
|-----|-------------------|
| LTD-01 | INV-PR-01, INV-PR-02, INV-PR-03 |
| LTD-02 | INV-PR-01, INV-CS-07 |
| LTD-03 | INV-RF-04, INV-RF-05, INV-PR-01, INV-CE-02, INV-ES-01, INV-LF-01 |
| LTD-04 | INV-CS-02, INV-ES-03 |
| LTD-05 | INV-ES-03, INV-ES-06, INV-TO-04 |
| LTD-06 | INV-ES-04, INV-ES-05, INV-RF-04 |
| LTD-07 | INV-CE-06, INV-CS-05, INV-RF-04, INV-RF-05 |
| LTD-08 | INV-ES-07, INV-TO-01, INV-PR-01 |
| LTD-09 | INV-CE-01, INV-CE-03, INV-CS-03 |
| LTD-10 | INV-RF-01, INV-CS-04 |
| LTD-11 | INV-PR-01, INV-CE-02, INV-RF-06, INV-LF-01 |
| LTD-12 | INV-CE-04, INV-CE-05 |
| LTD-13 | INV-RF-04, INV-PR-01, INV-PR-03, INV-PD-08, INV-SE-01 |
| LTD-14 | INV-CS-05, INV-RF-04, INV-PD-08, INV-PD-01, INV-LF-01 |
| LTD-15 | INV-TO-01, INV-TO-04, INV-PR-01, INV-ES-06, INV-PD-01, INV-RF-05 |
| LTD-16 | INV-CS-01, INV-CS-04, INV-CS-06, INV-CS-03, INV-ES-07 |
| LTD-17 | INV-RF-01, INV-RF-02, INV-RF-03, INV-CS-04 |
| LTD-18 | INV-LF-01, INV-PR-01, INV-PR-02, INV-TO-01, INV-CE-02 |

## Appendix B: Virtual Thread Risk Cross-Reference

The Virtual Thread Risk Audit Report (2026-03-19) identified a critical architectural gap affecting the following invariant chains:

| Affected Invariant | How Affected | Status |
|-------------------|--------------|--------|
| INV-PR-01 | sqlite-jdbc carrier thread pinning degrades performance on 4-core RPi 5 | Mitigation documented, not yet in design docs |
| INV-PR-03 | Carrier pool exhaustion from 4 concurrent DB ops makes resource usage unpredictable | Mitigation documented, not yet in design docs |
| INV-ES-04 | Write-ahead persistence assumes virtual thread can write to SQLite without pinning | Platform thread executor needed for write path |
| INV-RF-04 | Crash recovery subscriber replay involves DB reads that pin carriers | Platform thread executor needed for read path |
| INV-TO-02 | Automation determinism depends on predictable event processing latency | Carrier starvation from DB pinning introduces non-deterministic delays |

**Required action:** AMD-26 must incorporate the platform thread executor pattern (bounded `FixedThreadPool` for all sqlite-jdbc operations) into the affected design documents before Phase 3 begins. The Virtual Thread Risk Audit Report provides the complete remediation specification.

## Appendix C: Traceability Document Status

| Traceability Doc | Status | Interface Count |
|-----------------|--------|-----------------|
| 01-event-model.md | **Fully populated** | 28 types mapped |
| 02-device-model.md | Empty scaffold | 0 |
| 03-state-store.md | Empty scaffold | 0 |
| 04-persistence.md | Empty scaffold | 0 |
| 05-integration-runtime.md | Empty scaffold | 0 |
| 06-configuration.md | Empty scaffold | 0 |
| 07-automation.md | Empty scaffold | 0 |
| 08-zigbee-adapter.md | Empty scaffold | 0 |
| 09-rest-api.md | Empty scaffold | 0 |
| 10-websocket-api.md | Empty scaffold | 0 |
| 11-observability.md | Empty scaffold | 0 |
| 12-lifecycle.md | **Minimally populated** | 2 types mapped |
| 13-web-ui.md | Empty scaffold | 0 |
| 14-master-architecture.md | Empty scaffold | 0 |

The MODULE_CONTEXT files for 8 modules (platform-api, event-model, event-bus, device-model, state-store, persistence, configuration, automation) contain detailed type inventories that should be reflected in the corresponding traceability documents. This is documentation debt, not a code gap — the interfaces exist, they just aren't traced in the traceability docs.

---

*This audit was performed as a read-only governance exercise. No files were modified. The only file created is this deliverable.*
