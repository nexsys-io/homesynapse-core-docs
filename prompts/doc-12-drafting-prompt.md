# Doc 12 Drafting Prompt — Startup, Lifecycle & Shutdown

**Generated:** 2026-03-09
**Purpose:** Self-contained prompt for drafting HomeSynapse Core Design Document 12
**Phase:** Phase 1 (System Design Documentation)
**Template:** Follow `governance/DESIGN_DOC_TEMPLATE.md` — all mandatory sections required

---

## 1. Document Identity

- **Number:** 12
- **Title:** Startup, Lifecycle & Shutdown
- **Type:** Synthesis document — no new competitive research needed
- **Nature:** This document orchestrates all preceding subsystems. It defines _when_ things happen, not _what_ they do. Every subsystem's design is locked; Doc 12 sequences their initialization, coordinates their runtime lifecycle, and orders their shutdown.

---

## 2. Dependencies — All 11 Locked Design Documents

Doc 12 depends on every preceding design document. The specific dependency surfaces are:

| Doc | Title | Key Dependency Surfaces for Doc 12 |
|---|---|---|
| 01 | Event Model & Event Bus | §3.4 subscription model (subscribers register with checkpoint), §3.6 coalescing, §4.4 causal chain projection startup, §8.1 EventStore interface. The event bus is the first subsystem that must be operational — nothing else works without it. |
| 02 | Device Model & Capability System | §3.15 device orphan lifecycle (orphan detection runs after integration startup), §3.1 EntityRef/EntityState model. Device registry must be populated before automations evaluate. |
| 03 | State Store & State Projection | §3.1 replay-from-checkpoint startup, §3.2.1 REPLAY→LIVE reconciliation pass (AMD-02), §3.8 staleness model (scan timer startup), §8.1 StateQueryService. State store must replay before any query consumer starts. |
| 04 | Persistence Layer | §3.1 first-run initialization (INV-CE-02), §3.3 connection PRAGMAs, §3.4 WAL checkpoint scheduling, §3.6 retention scheduling. Persistence is the very first thing — databases must exist before the event bus can write. |
| 05 | Integration Runtime | §3.3 integration supervisor lifecycle (8-state machine: LOADING→INITIALIZING→RUNNING→STOPPING, plus DEGRADED→SUSPENDED→FAILED), §3.13 adapter dependency ordering (AMD-14, topological sort via Kahn's algorithm), §3.2 thread allocation (virtual vs platform per IoType). The supervisor exposes a lifecycle interface; Doc 12 determines when to call it. |
| 06 | Configuration System | §3.1 YAML loading, §3.2 schema validation, §3.7 configuration migration framework (AMD-13, runs between parse and validation), §3.4 secrets store (AMD-16, backup rotation). Configuration must load before any subsystem reads its config. |
| 07 | Automation Engine | §3.7.1 cascade depth limiting (AMD-04), §3.8 snapshot usage (AMD-03). Automations must not evaluate until state store is live and integrations are running. |
| 08 | Zigbee Adapter | §3.15 route health monitoring (AMD-07). Reference integration — startup sequence informs the general integration startup pattern. |
| 09 | REST API | §3.4 idempotency key cache (AMD-08), §3.8 correlation ID (AMD-15), §3.11 rate limiting. API must not accept requests until subsystems are ready. |
| 10 | WebSocket API | §3.10 rate limiting (AMD-09), connection lifecycle. WebSocket must not stream events until event bus and state store are live. |
| 11 | Observability & Debugging | §3.3 HealthAggregator (tiered composition model), §3.5 JFR continuous recording, §8 HealthContributor interface, §8.2 key types (HealthStatus, HealthThresholds). Observability should start early (to capture startup metrics) but HealthAggregator excludes subsystems in STARTING state. |

---

## 3. External Dependencies — Portability Architecture

**Portability Architecture v1** (research artifact, `research/Portability_Architecture_v1.md`) defines two interfaces that Doc 12 MUST specify:

### 3.1 HealthReporter Interface (§7.1)

**Purpose:** Abstracts lifecycle health reporting across platform supervisors.

**Interface contract (4 methods):**
- `reportReady()` — Process has completed initialization. On systemd, sends `sd_notify("READY=1")`.
- `reportWatchdog()` — Heartbeat. Called periodically. On systemd, sends `sd_notify("WATCHDOG=1")`.
- `reportStopping()` — Process is shutting down gracefully. On systemd, sends `sd_notify("STOPPING=1")`.
- `reportStatus(String message)` — Human-readable status for debug. On systemd, sends `sd_notify("STATUS=...")`.

**Implementations for Tier 1:**
- `SystemdHealthReporter` — sd_notify via Unix domain socket (faljse/SDNotify library, degrades to no-op when $NOTIFY_SOCKET is unset)
- `HttpHealthReporter` — /health endpoint on dedicated port (pull-based, for Docker/K8s)
- `NoOpHealthReporter` — macOS/Windows development

**Tier mapping:** Constrained/Standard use SystemdHealthReporter + HttpHealthReporter (dual-mode).

### 3.2 PlatformPaths Interface (§7.2)

**Purpose:** Abstracts platform-specific directory conventions.

**Interface contract (6 methods):**
- `binaryDir()` — Read-only runtime image location
- `configDir()` — Writable configuration files
- `dataDir()` — Writable persistent data (SQLite databases)
- `logDir()` — Writable log files and JFR recordings
- `backupDir()` — Writable pre-update snapshots
- `tempDir()` — Writable temporary files (private, cleaned on startup)

**Tier 1 implementation:** `LinuxSystemPaths` — FHS paths per LTD-13:
- binaryDir → `/opt/homesynapse/`
- configDir → `/etc/homesynapse/`
- dataDir → `/var/lib/homesynapse/`
- logDir → `/var/log/homesynapse/`
- backupDir → `/var/lib/homesynapse/backups/`
- tempDir → private temp (cleaned on startup)

### 3.3 AdaptivePragmaConfig (§7.3)

**Purpose:** Scales SQLite PRAGMA values based on detected hardware. Tier 1 uses fixed values from LTD-03; the interface exists so non-RPi deployments can parameterize.

---

## 4. Key Locked Technical Decision — LTD-13 (systemd)

Doc 12 is the primary consumer of LTD-13. The systemd service unit specifies:

- `Type=exec` — systemd waits for `sd_notify(READY=1)` before considering the service started
- `WatchdogSec=60` — process must send `sd_notify(WATCHDOG=1)` every 60 seconds or systemd kills it
- `Restart=on-failure` with `RestartSec=10` — automatic crash recovery
- `MemoryMax=2G` / `MemoryHigh=1536M` — cgroup resource limits
- `ProtectSystem=strict` with `ReadWritePaths` — filesystem isolation

Doc 12 must define the application-side behavior that satisfies these systemd contracts.

---

## 5. Key Design Questions

The following questions must be resolved by the design. They represent the core intellectual work of Doc 12.

### Q1: Initialization Order

What is the correct startup sequence for all subsystems? The dependency graph implies a partial order, but Doc 12 must linearize it into a concrete sequence with explicit "ready" gates between phases.

**Known constraints:**
- Persistence Layer (Doc 04) must initialize first (databases must exist)
- Configuration System (Doc 06) must load before any subsystem reads config (but needs PlatformPaths to find config files)
- Event Bus (Doc 01) must be operational before any subscriber registers
- State Store (Doc 03) must complete replay before consumers query state
- Integration Runtime (Doc 05) must start after event bus + state store are live
- Automation Engine (Doc 07) must start after integrations are running
- API layer (Docs 09, 10) must not accept external requests until subsystems are ready
- Observability (Doc 11) should start early to capture startup metrics, but HealthAggregator gives subsystems a STARTING grace period

**Likely phasing:**
1. Platform bootstrap (PlatformPaths, temp dir cleanup)
2. Configuration load + migration (Doc 06 §3.7)
3. Persistence initialization (Doc 04 §3.1)
4. Observability infrastructure (JFR recording, metrics bridge)
5. Event bus startup (Doc 01)
6. State store replay + reconciliation (Doc 03 §3.1, §3.2.1)
7. Device registry population
8. Integration runtime startup with dependency ordering (Doc 05 §3.13)
9. Automation engine activation (Doc 07)
10. API layer opens (Docs 09, 10)
11. `sd_notify(READY=1)` — systemd considers service started

### Q2: HealthReporter Integration

How does the HealthReporter interface interact with the HealthAggregator from Doc 11? The HealthAggregator composes per-subsystem health into system health. The HealthReporter communicates system lifecycle to the platform supervisor. Doc 12 must define:
- When `reportReady()` is called (after which subsystem completes initialization?)
- How frequently `reportWatchdog()` is called (must be < 60s per WatchdogSec=60)
- What triggers `reportStopping()`
- How `reportStatus()` is used during startup (e.g., "Starting: replaying state store...")

### Q3: PlatformPaths Bootstrap

PlatformPaths must be resolved before anything else (every subsystem needs to know where its files are). But PlatformPaths is an interface with multiple implementations. Doc 12 must define:
- How the correct implementation is selected (configuration? Auto-detection? JVM property?)
- What happens if directory permissions are wrong (fail-fast vs. attempt creation)
- Temp dir cleanup semantics (clean on startup — what about files from a crashed previous run?)

### Q4: Startup Readiness Definition

What does "ready" mean for each subsystem? Doc 12 must define per-subsystem readiness criteria that gate the next phase. For example:
- State store is "ready" when replay is complete AND reconciliation pass has run
- Integration runtime is "ready" when all non-FAILED integrations have reached RUNNING or DEGRADED
- API layer is "ready" when the HTTP listener is bound and accepting connections

### Q5: Graceful Shutdown Sequence

Shutdown is the reverse of startup but with additional concerns:
- API layer must stop accepting new requests but complete in-flight requests (drain period)
- WebSocket connections must be closed with a close frame
- Integration runtime must shut down adapters in reverse dependency order (Doc 05 §3.13)
- Automation engine must complete or cancel in-flight automation runs
- State store should create a final checkpoint (faster next startup)
- Event bus must flush pending events
- Persistence layer must run WAL checkpoint
- `reportStopping()` must be called before shutdown begins
- Total shutdown must complete within systemd's `TimeoutStopSec` (default: 90s)

### Q6: Crash Recovery

What happens when the process restarts after an unexpected termination? Doc 12 must define:
- The state each subsystem is in after a crash (event bus has durable events; state store replays from last checkpoint; integrations restart from scratch)
- Whether crash recovery follows the same initialization sequence as clean startup
- How the system detects it's recovering from a crash vs. a clean start (e.g., presence of WAL file, unclean shutdown marker)
- Doc 03 §3.2.1 reconciliation pass (AMD-02) — this is specifically designed for post-crash recovery

### Q7: AMD-14 Coordination — Integration Dependency Ordering at Startup

Doc 05 §3.13 (AMD-14) defines topological sort for integration startup. Doc 12 must orchestrate this:
- When does the dependency sort run? (After all IntegrationDescriptors are loaded via ServiceLoader)
- How do dependency failures propagate? (If integration A depends on B and B fails to start, A enters SUSPENDED with `dependency_failed`)
- What is the timeout for waiting on dependency chains? (Doc 05 §9: `startup_timeout_seconds`, default 120)

---

## 6. RECOMMENDED Amendments — Candidates for Integration

Two RECOMMENDED amendments from the critical design review are natural candidates for Doc 12:

### AMD-22: Observability Alerting Foundation (HealthChangeListener)

**Source:** `governance/Design_Review_Amendments_v1.md` AMD-22
**Natural fit:** Doc 12 owns the lifecycle that determines when health state changes propagate. The HealthChangeListener callback interface extends the HealthAggregator with notification when system-level health changes.

**Specification summary:**
- When system health state changes, emit `system.health_state_changed` event (CRITICAL tier)
- Invoke registered `HealthChangeListener` implementations:
  ```java
  interface HealthChangeListener {
      void onHealthStateChanged(HealthStateChange change);
  }
  ```
- Tier 1 listener: structured logger. Interface enables Tier 2 additions (MQTT, webhook, WebSocket broadcast)
- Listener invocation is async (fire-and-forget via virtual thread) to avoid blocking health aggregation

**Decision needed:** Should Doc 12 fold this in, or leave it as a future amendment to Doc 11?

### AMD-18: Causal Chain Timeout Extension for Long-Running Automations

**Source:** `governance/Design_Review_Amendments_v1.md` AMD-18
**Natural fit:** Doc 12 coordinates the Automation Engine (Doc 07) and the causal chain projection (Doc 01 §4.4). If Doc 12 addresses automation lifecycle management, AMD-18's timeout extension can be integrated.

**Specification summary:**
- Default chain timeout: 5 minutes (unchanged)
- Automation-associated chain timeout: max(5 minutes, automation's total_delay + 5 minutes)
- `CausalChainProjection.extendTimeout(correlationId, Duration)` called by Automation Engine at run start
- 10,000 active chain limit preserved; LRU eviction prefers non-automation chains

**Decision needed:** Does Doc 12's scope naturally cover causal chain lifecycle, or is this better as an amendment to Doc 01?

---

## 7. Architecture Invariants — Key Citations

| Invariant | Relevance to Doc 12 |
|---|---|
| INV-CE-02 | Zero-configuration first run. Startup must succeed with no user-provided config. Doc 04 §3.1 first-run initialization creates databases automatically. |
| INV-RF-04 | Crash safety. The system must recover to a consistent state after any crash at any point. Doc 12 defines the recovery sequence. |
| INV-PR-03 | Bounded resource usage. Startup must not exceed memory/CPU limits during replay or initialization. |
| INV-ES-02 | State derivable from events. State store replay on startup is the primary expression of this invariant. |
| INV-TO-01 | Observable behavior. Startup progress must be observable (structured logging, health status, JFR events). |
| INV-TO-04 | Non-persistent debug changes. Any debug settings from the previous run do not carry over (reset on restart). |
| INV-ES-06 | Every state change explainable. Causal chain projection must be operational before automations fire. |

---

## 8. Scope Boundaries

### IN scope:
- Process main() entry point and bootstrap sequence
- Subsystem initialization ordering with dependency-aware phasing
- HealthReporter interface definition and systemd integration
- PlatformPaths interface definition and Tier 1 implementation
- Startup readiness gates (per-subsystem and system-level)
- Graceful shutdown sequence with drain periods
- Crash recovery sequence
- Watchdog heartbeat thread
- Startup/shutdown event production (for observability)
- Configuration for startup behavior (timeouts, grace periods)

### OUT of scope:
- Individual subsystem internal initialization (each doc owns its own startup logic; Doc 12 orchestrates when they're called, not how they initialize internally)
- AdaptivePragmaConfig implementation details (Portability Architecture §7.3 — Doc 12 acknowledges the interface; Doc 04/Doc 14 own the details)
- Update/upgrade process (LTD-14 covers pre-upgrade snapshots; Doc 12 covers normal startup/shutdown, not the upgrade orchestration)
- Multi-instance coordination (Tier 2 concern)
- Container orchestration lifecycle (Docker/K8s — covered by HttpHealthReporter, not systemd-specific design)

---

## 9. Drafting Instructions

1. Follow `governance/DESIGN_DOC_TEMPLATE.md` exactly. All 16 sections (§0 through §16) must be present per the template's mandatory/conditional rules.

2. This is a synthesis document. Do not invent new subsystem responsibilities. Doc 12 orchestrates what other documents have designed. Every claim about subsystem behavior must cite the specific document and section.

3. The §3 Architecture section is the core. It should contain:
   - A startup sequence diagram (ASCII art) showing phases and gates
   - A shutdown sequence diagram showing reverse ordering and drain periods
   - The HealthReporter interface specification (from Portability Architecture §7.1)
   - The PlatformPaths interface specification (from Portability Architecture §7.2)
   - Watchdog thread design
   - Crash detection and recovery flow

4. The §7 Interaction table will be the largest of any document — Doc 12 touches every subsystem. Be exhaustive.

5. The §8 Key Interfaces section should define:
   - `HealthReporter` (4 methods from Portability Architecture §7.1)
   - `PlatformPaths` (6 methods from Portability Architecture §7.2)
   - `LifecycleManager` or equivalent orchestrator interface
   - `SubsystemLifecycle` or equivalent — the interface each subsystem implements for startup/shutdown hooks

6. Performance targets (§10) should include:
   - Cold start time (first run, empty databases)
   - Warm start time (replay from checkpoint)
   - Shutdown drain time
   - Watchdog heartbeat interval

7. For the two RECOMMENDED amendments (AMD-22, AMD-18): evaluate during drafting whether they naturally fit within Doc 12's scope. If they do, integrate them. If they're better as amendments to their original target documents, note this in §15 Open Questions.

---

## 10. Files to Load Before Drafting

The drafter must have access to these files:

**Governance:**
- `governance/DESIGN_DOC_TEMPLATE.md` — template to follow
- `governance/HomeSynapse_Core_Locked_Decisions.md` — all 17 LTDs (especially LTD-13)
- `governance/Architecture_Invariants_v1.md` — all INV-* citations
- `governance/PROJECT_STATUS.md` — current project state
- `governance/Project_MVP_v1.md` — scope constraints and acceptance criteria
- `governance/Design_Review_Amendments_v1.md` — AMD-22 and AMD-18 specs

**Design documents (all locked):**
- `design/01-event-model-and-event-bus.md` through `design/11-observability-and-debugging.md`

**Research:**
- `research/Portability_Architecture_v1.md` — §7.1 HealthReporter, §7.2 PlatformPaths, §7.3 AdaptivePragmaConfig

---

*This prompt was generated as part of the Phase 1 critical design review closure (Part 4c). It encodes all locked decisions, dependencies, design questions, and RECOMMENDED amendment candidates needed to draft Doc 12 without requiring any prior session context.*
