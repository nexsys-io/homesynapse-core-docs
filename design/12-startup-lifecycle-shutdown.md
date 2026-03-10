# HomeSynapse Core — Startup, Lifecycle & Shutdown

**Document type:** Subsystem design
**Status:** Draft
**Subsystem:** Startup, Lifecycle & Shutdown
**Dependencies:** Event Model & Event Bus (Doc 01 — §3 event bus initialization, §3.7 processing modes, §4 subscriber registration, §8.3 EventPublisher),
  Device Model & Capability System (Doc 02 — §3.12 discovery pipeline, §3.15 orphan lifecycle per AMD-17, §8.1 registries),
  State Store & State Projection (Doc 03 — §3.2.1 reconciliation pass per AMD-02, §3.3/§3.6 projection versioning per AMD-10, §3.8 staleness model per AMD-11, §8 checkpoint recovery),
  Persistence Layer (Doc 04 — §3.1 database opening, §3.2 PRAGMA application, §3.3 migration, §3.4 integrity check, §3.5 retention, §3.7 aggregation, §3.8 backup),
  Integration Runtime (Doc 05 — §3.2 thread allocation, §3.3 adapter lifecycle, §3.4 supervision, §3.5 health, §3.13 dependency ordering per AMD-14),
  Configuration System (Doc 06 — §3.1 file loading, §3.2 schema validation, §3.4 watch thread, §3.7 migration per AMD-13),
  Automation Engine (Doc 07 — §3.1 registry loading, §3.2 trigger index, §3.4 subscriber, §3.6 RunManager, §3.7.1 cascade governance per AMD-04, §3.8 snapshot per AMD-03),
  Zigbee Adapter (Doc 08 — §3.2 coordinator connection, §3.3 network formation, §3.4 device cache),
  REST API (Doc 09 — §3.1 server start, §3.4 idempotency per AMD-08),
  WebSocket API (Doc 10 — §3.1 upgrade handler, §3.3 relay subscriber, §3.14 admission control per AMD-09),
  Observability & Debugging (Doc 11 — §3.1 JFR start, §3.3 health aggregation, §8.1–§8.2 HealthContributor)
**Dependents:** Web UI (Doc 13), Master Architecture Document (Doc 14)
**Author:** HomeSynapse Core Architecture
**Date:** 2026-03-09

---

## 0. Purpose

This subsystem owns the process-level lifecycle of HomeSynapse Core: the ordered initialization of all subsystems from cold start, the runtime health and watchdog protocol, and the graceful shutdown sequence that preserves data integrity. It is the bridge between the platform supervisor (systemd on Tier 1) and the application's internal subsystem graph.

Without this subsystem, there is no defined answer to three questions that determine whether the system can run reliably for years: In what order do subsystems initialize, and what happens when one fails? How does the platform supervisor know the process is alive? How does the system stop without losing data? Every other subsystem defines its own internal lifecycle — what it needs before it can start, what it must do before it can stop — but no other subsystem owns the orchestration of those individual lifecycles into a coherent whole. A startup sequence that initializes the Automation Engine before the State Store has recovered produces incorrect automation evaluations against empty state. A shutdown that kills the Event Bus before the Persistence Layer has checkpointed the WAL leaves the event store in a state that requires recovery on next start. This subsystem prevents both classes of failure by defining and enforcing the ordering contracts.

This subsystem also defines two platform abstraction interfaces — `HealthReporter` and `PlatformPaths` — that isolate HomeSynapse from platform-specific concerns. These interfaces are the portability boundary between the application and the deployment environment. Tier 1 provides systemd and FHS implementations; future tiers provide Docker, macOS, and Android implementations without changing application code.

---

## 1. Design Principles

**Deterministic, dependency-driven ordering.** Subsystems initialize in a fixed sequence determined by their data and service dependencies. No concurrent initialization within a phase. The ordering is documented, testable, and identical on every startup. This eliminates the class of failures where initialization races produce intermittent bugs that are unreproducible in development. Derives from INV-RF-02 (transient failure recovery without restart) — a system that starts deterministically is a system whose startup failures are diagnosable.

**Fail-fast on critical infrastructure, degrade gracefully on optional services.** If the configuration system, persistence layer, or event bus cannot initialize, the process exits immediately with a diagnostic message. There is no value in running a system that cannot load its configuration, store events, or distribute them. If an integration adapter fails to start, the rest of the system continues — the adapter enters its supervised restart cycle (INV-RF-01). The distinction between fatal and non-fatal failures is explicit and enumerated in §6.

**No external blocking during startup.** Startup must not block on external device connectivity (INV-RF-03). Subsystems that depend on external connections — integration adapters, Zigbee coordinators, cloud bridges — defer connection establishment to their `run()` phase. The `initialize()` method allocates resources and registers with the supervisor; the `run()` method establishes connections. This prevents the failure mode where a powered-off Zigbee coordinator blocks the entire platform from starting.

**Observable from the first instruction.** Logging infrastructure (SLF4J/Logback) and JFR continuous recording start before any HomeSynapse subsystem code executes (LTD-15). Every lifecycle transition is logged as a structured event and recorded as a JFR event. A crash during startup produces a JFR recording and log entries sufficient to diagnose the failure. Derives from INV-TO-01 (observable behavior).

**Idempotent shutdown.** The shutdown sequence is safe to invoke at any point in the lifecycle, including during initialization before all subsystems have started. Resources are released in reverse initialization order. A subsystem that was never initialized is skipped during shutdown. A second SIGTERM during an in-progress shutdown does not corrupt the sequence.

**Platform abstraction at the boundary.** The application never calls platform-specific APIs directly. systemd notification, filesystem paths, and process supervision are accessed through `HealthReporter` and `PlatformPaths` interfaces. This keeps the application portable without premature abstraction — Tier 1 needs exactly two implementations (systemd + FHS), and the interface surface is small enough (10 methods total) that the abstraction cost is negligible.

---

## 2. Scope and Boundaries

### 2.1 This Subsystem Owns

- The `SystemLifecycleManager` — the top-level orchestrator that sequences initialization, runs the health loop, and executes shutdown.
- The initialization phase model: defined phases with explicit boundaries, ordering contracts, and timeout enforcement.
- The shutdown sequence: ordered teardown with grace periods and drain semantics.
- The runtime health loop: periodic polling of all `HealthContributor` implementations, aggregated health computation, and watchdog notification.
- The `HealthReporter` interface and its Tier 1 implementations (`SystemdHealthReporter`, `NoOpHealthReporter`).
- The `PlatformPaths` interface and its Tier 1 implementation (`LinuxSystemPaths`).
- Process-level signal handling: SIGTERM triggers graceful shutdown.
- Lifecycle event production: `system_starting`, `subsystem_initialized`, `subsystem_failed`, `system_ready`, `system_stopping`, `system_stopped`.
- Collecting all `HealthContributor` implementations from initialized subsystems.
- Orphan device detection scheduling (triggering the scan defined in **Device Model & Capability System** §3.15 per AMD-17) after core domain initialization and before integration startup.

### 2.2 This Subsystem Does Not Own

- Individual subsystem initialization logic — each subsystem owns its own `initialize()` and `close()` behavior. This subsystem calls them in order; it does not implement them.
- Integration adapter lifecycle management — owned by **Integration Runtime** (Doc 05 §3.3–§3.4). This subsystem tells the `IntegrationSupervisor` to start; the supervisor manages individual adapters.
- Health indicator logic for individual subsystems — each subsystem's §11.3 defines its own health conditions. This subsystem consumes those indicators through `HealthContributor`; it does not override them.
- JVM-level configuration (heap size, GC tuning, JIT settings) — these are deployment-time concerns specified in the systemd service unit and launcher script per LTD-01.
- Database schema migration content — owned by the subsystem whose schema is being migrated. The Persistence Layer (Doc 04 §3.3) owns the migration runner; this subsystem ensures it runs at the correct point in the sequence.
- Configuration file watching and reload — owned by **Configuration System** (Doc 06 §3.4). This subsystem starts the Configuration System; the config watcher is an internal concern of Doc 06.

---

## 3. Architecture

### 3.1 Lifecycle Phase Model

The HomeSynapse process moves through a fixed sequence of lifecycle phases. Each phase completes fully before the next begins. Within a phase, subsystems initialize sequentially in the order listed. There is no concurrent initialization — sequential execution on constrained hardware (4-core Cortex-A76, LTD-02) is simpler to debug, produces deterministic failure diagnosis, and avoids initialization races that would require synchronization barriers.

```
┌─────────────────────────────────────────────────────────────────┐
│                    HomeSynapse Lifecycle                          │
│                                                                  │
│  Phase 0        Phase 1       Phase 2          Phase 3           │
│  BOOTSTRAP ───▶ FOUNDATION ──▶ DATA_INFRA ────▶ CORE_DOMAIN     │
│  (platform)     (config)       (persistence,    (device model,   │
│                                 event bus)       state store,    │
│                                                  automation)     │
│       │                                               │          │
│       │         Phase 4       Phase 5          Phase 6           │
│       │         OBSERVABILITY─▶EXTERNAL_IFACE─▶INTEGRATIONS     │
│       │         (health agg,   (REST, WS,       (adapters via   │
│       │          metrics)       READY=1)         supervisor)    │
│       │                            │                  │          │
│       │                            │                  ▼          │
│       │                            │            RUNNING          │
│       │                            │            (health loop,    │
│       │                            │             watchdog)       │
│       │                            │                  │          │
│       ▼                            │                  ▼          │
│  On failure:                       │          SHUTTING_DOWN      │
│  EXIT with                         │          (reverse order,    │
│  diagnostic                        │           drain, close)     │
│                                    │                  │          │
│                                    │                  ▼          │
│                                    │             STOPPED         │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Phase 0 — Platform Bootstrap

Platform Bootstrap executes before any HomeSynapse application code. It establishes the observability and platform abstraction foundation that every subsequent phase depends on.

**Step 0.1: JVM starts with LTD-01 flags.** The launcher script in `/opt/homesynapse/bin/homesynapse` applies the JVM configuration specified in LTD-01: `-Xms512m -Xmx1536m -XX:+UseG1GC -XX:MaxGCPauseMillis=100 -Xss512k -XX:CICompilerCount=2 -XX:+UseStringDeduplication -XX:MetaspaceSize=64m -XX:MaxMetaspaceSize=128m`. AppCDS is enabled when the archive exists.

**Step 0.2: PlatformPaths resolved.** The `PlatformPaths` implementation is selected based on deployment tier detection. For Tier 1 (Constrained/Standard), `LinuxSystemPaths` provides FHS-compliant paths per LTD-13. Detection logic: if `/opt/homesynapse/` exists and the process runs as the `homesynapse` user, select `LinuxSystemPaths`. If neither condition is met, fall back to development-mode paths under the current working directory. The resolved paths are immutable for the lifetime of the process.

**Step 0.3: Logging infrastructure configured and started.** SLF4J/Logback is configured per LTD-15. The JSON log file is opened at `PlatformPaths.logDir()/homesynapse.log`. Console output uses plain text format for systemd journal capture. Default log levels are applied per LTD-15 §Specification. Logging is available from this point forward — every subsequent step can log.

**Step 0.4: JFR continuous recording started.** The JFR recording is started with parameters from LTD-15: `disk=true, maxsize=100m, maxage=6h, dumponexit=true, filename={PlatformPaths.logDir()}/flight.jfr`. Custom JFR event types are registered. The recording is active from this point forward — every subsequent step produces JFR events.

**Step 0.5: HealthReporter initialized.** If the `$NOTIFY_SOCKET` environment variable is set, `SystemdHealthReporter` is instantiated, which sends `sd_notify` messages via Unix domain socket using the faljse/SDNotify library. If `$NOTIFY_SOCKET` is unset, `NoOpHealthReporter` is instantiated. The reporter calls `reportStatus("BOOTSTRAP: platform initialized")`.

**Phase 0 failure semantics:** Any failure in Phase 0 is fatal. If logging cannot initialize, the error is written to stderr (captured by systemd journal). If PlatformPaths detection fails, the process exits with code 1 and a diagnostic message to stderr.

### 3.3 Phase 1 — Foundation Services

Foundation Services loads and validates the configuration that every subsequent subsystem reads.

**Step 1.1: Configuration System loads and validates.** The Configuration System (Doc 06 §3.1–§3.2) executes its six-stage loading pipeline: file system read from `PlatformPaths.configDir()/config.yaml`, YAML parse via SnakeYAML Engine, tag resolution (`!secret`, `!env`), schema composition, schema validation, and typed model construction. If the configuration file is absent, the Configuration System generates defaults satisfying INV-CE-02 (zero-configuration first run). If schema validation produces fatal errors (corrupt YAML, broken secret references), the process exits with a diagnostic message listing every validation failure. Non-fatal errors (invalid value for one key) cause that key to revert to its default, and the system logs a WARNING.

**Step 1.2: Configuration migration check.** If the loaded configuration file's `schema_version` is older than the running code's `CURRENT_SCHEMA_VERSION`, the Configuration System executes the migration framework (AMD-13, Doc 06 §3.7). In service mode (non-interactive), non-destructive migrations (ADDED, VALUE_CHANGED) apply automatically. Destructive migrations (REMOVED, TYPE_CHANGED) cause a fatal startup error requiring manual migration via `homesynapse migrate-config`. A timestamped backup of the original configuration is created before any migration.

**Phase 1 failure semantics:** Configuration loading failure is fatal. The system cannot proceed without validated configuration. The diagnostic message includes every validation error, the schema version mismatch details (if migration fails), and the path to the configuration file.

### 3.4 Phase 2 — Data Infrastructure

Data Infrastructure establishes the persistence and event distribution foundation. The ordering within this phase is critical: the Persistence Layer must be ready before the Event Bus, because the Event Bus depends on the domain event store for write-ahead persistence (LTD-06).

**Step 2.1: Persistence Layer initialization.** The Persistence Layer (Doc 04 §3.1–§3.4) executes its initialization sequence:

1. Open (or create) `PlatformPaths.dataDir()/homesynapse-events.db`. On first run, set creation-time PRAGMAs: `PRAGMA auto_vacuum = INCREMENTAL` and `PRAGMA page_size = 4096`.
2. Apply connection PRAGMAs in the order specified by LTD-03: `journal_mode = WAL`, `synchronous = NORMAL`, `cache_size = -128000`, `mmap_size = 1073741824`, `temp_store = MEMORY`, `journal_size_limit = 6144000`, `busy_timeout = 5000`. PRAGMA order matters — `journal_mode` must be set before any queries execute.
3. Run schema migrations via the migration runner (LTD-07). Each migration is atomic within a transaction. If any migration fails, the process exits with a diagnostic listing the failed migration and suggesting rollback to the pre-upgrade snapshot (LTD-14).
4. Execute integrity check (`PRAGMA quick_check`). If the check fails, log the corruption details at ERROR, emit a structured diagnostic, and exit. The diagnostic recommends restoring from backup.
5. Check for unclean shutdown marker. If the marker file (`PlatformPaths.dataDir()/.unclean_shutdown`) exists, log a WARNING indicating the previous shutdown was unclean. The marker is removed after successful startup completes. A new marker is written at the end of Phase 2.
6. Open the telemetry ring store (`PlatformPaths.dataDir()/homesynapse-telemetry.db`) with the same PRAGMA and migration sequence.
7. Initialize the WriteCoordinator (AMD-06) — the single-threaded priority executor that serializes all SQLite write operations.
8. Start the retention scheduler, aggregation engine, and backup scheduler as background virtual threads. These do not execute immediately — they wait for their first scheduled interval.

**Step 2.2: Event Bus initialization.** The Event Bus (Doc 01 §3) initializes:

1. Connect to the domain event store via the Persistence Layer's write and read interfaces.
2. Initialize the EventPublisher with its durability contract (AMD-01): `publish()` is synchronous and durable, `emit()` is asynchronous and best-effort.
3. Initialize the subscriber registration API. No subscribers are registered yet — downstream subsystems register during their own initialization phases.
4. Load subscriber checkpoint positions from the `subscriber_checkpoints` table.

**Phase 2 failure semantics:** Persistence Layer or Event Bus failure is fatal. Without durable event storage and distribution, the system has no foundation. Exit with a diagnostic message. The HealthReporter calls `reportStatus("FATAL: data infrastructure failed")` before exit.

### 3.5 Phase 3 — Core Domain

Core Domain initializes the subsystems that give HomeSynapse its semantic model: what devices exist, what state they have, and what automations operate on them. The ordering within this phase reflects data dependencies: the Device Model must load before the State Store (which queries entity schemas), and both must be ready before the Automation Engine (which queries both).

**Step 3.1: Device Model registries initialize.** The DeviceRegistry, EntityRegistry, and CapabilityRegistry (Doc 02 §8.1) load their persisted state from the domain event store. Standard capability definitions are registered. The registries are available for queries from this point forward.

**Step 3.2: State Store and State Projection initialize.** The State Store (Doc 03) executes:

1. Load the most recent checkpoint from the `view_checkpoints` table (Doc 04 §3.12).
2. Check projection versioning (AMD-10): compare the checkpoint's `projectionVersion` to the running code's `CURRENT_PROJECTION_VERSION`. If they differ, discard the checkpoint's state map and prepare for full replay from position 0 (or from the most recent checkpoint with a matching projection version).
3. Register the State Projection as a subscriber of the Event Bus.
4. Execute checkpoint recovery: replay events from the checkpoint's `globalPosition` (or position 0 if the checkpoint was discarded) to the current log head. During replay, the State Projection operates in REPLAY mode (Doc 01 §3.7) — it consumes existing `state_changed` events to rebuild state but does not re-derive them from `state_reported` events.
5. Execute the reconciliation pass (AMD-02, Doc 03 §3.2.1): for each entity in the state map, verify that the most recent `state_reported` event has a corresponding `state_changed` event. Re-derive any missing derived events. This pass repairs state that was lost due to a prior unclean shutdown.
6. Transition to LIVE mode. The State Projection now produces derived events for new incoming events.

**Step 3.3: Orphan device detection.** After the Device Model and State Store are initialized, the orphan detection scan runs (AMD-17, Doc 02 §3.15). This identifies devices whose owning integration no longer exists and transitions them to ORPHANED lifecycle state. This runs before integrations start because integration startup may attempt to re-adopt orphaned devices.

**Step 3.4: Automation Engine initialization.** The Automation Engine (Doc 07) executes:

1. Load automation definitions from the configuration (Doc 06 well-known file path for `automations.yaml`).
2. Validate automation definitions against the Device Model (entity references, capability requirements).
3. Build the trigger index — the data structure that maps event type patterns to the automations they trigger.
4. Register the automation subscriber with the Event Bus.
5. Initialize the RunManager — the component that tracks active automation runs, enforces concurrency modes, and manages cascade governance (AMD-04).
6. Recover the PendingCommandLedger — load in-flight commands from persisted state and reconcile against events that arrived while the system was down.
7. Register the cascade rate limiter.

**Phase 3 failure semantics:** Device Model, State Store, or Automation Engine initialization failure is fatal. These are core domain subsystems — a system without state projection or automation evaluation cannot serve its primary purpose. Exit with a diagnostic. If the reconciliation pass reveals widespread data inconsistency (>50% of entities have missing derived events), log an ERROR recommending database restore from backup but proceed — the reconciliation pass repairs the inconsistencies.

### 3.6 Phase 4 — Observability

Observability initialization collects health indicators from all subsystems initialized in Phases 1–3 and starts the health aggregation system.

**Step 4.1: Collect HealthContributor implementations.** The `SystemLifecycleManager` queries each initialized subsystem for its `HealthContributor` implementation (Doc 11 §8.1–§8.2). Every subsystem that defines a §11.3 health indicator provides a `HealthContributor`. The collection is complete at this point because all subsystems that provide health indicators have initialized.

**Step 4.2: Initialize health aggregation.** The HealthAggregator (Doc 11 §3.3) initializes with the collected `HealthContributor` set. It computes the initial system health state using the three-tier composition model: per-component health rolls up to per-subsystem health, which rolls up to system-wide health. Health states are HEALTHY, DEGRADED, or UNHEALTHY.

**Step 4.3: Start metric ring buffer.** The MetricsInfrastructure (Doc 11 §3.2) starts the JFR Event Streaming bridge that reads JFR events and pushes aggregated metric snapshots to the ring buffer for WebSocket and REST consumers.

**Phase 4 failure semantics:** Observability initialization failure is non-fatal but produces a DEGRADED system health. The system can function without health aggregation — it loses watchdog feeding and health dashboard data, but device control, automation, and API access remain functional. Log a WARNING and continue.

### 3.7 Phase 5 — External Interfaces

External Interfaces starts the API layer that makes HomeSynapse accessible to clients. This phase ends with the `READY=1` notification to systemd.

**Step 5.1: REST API server starts.** The REST API (Doc 09 §3.1) starts the Javalin HTTP server, registers all endpoint handlers, and initializes the idempotency key store (AMD-08). The server binds to the configured port (default 8123). If the port is unavailable, the process exits with a diagnostic — the API is the primary user interface.

**Step 5.2: WebSocket upgrade handler registers.** The WebSocket API (Doc 10 §3.1) registers the WebSocket upgrade handler on the shared Javalin server instance (Doc 09 §3.9). The Event Relay subscriber registers with the Event Bus. Reconnection admission control initializes (AMD-09).

**Step 5.3: READY notification.** `HealthReporter.reportReady()` is called. On Tier 1, `SystemdHealthReporter` sends `READY=1` via `sd_notify`. systemd now considers the service fully started and begins enforcing `WatchdogSec=60`. The `system_ready` lifecycle event is emitted to the event log. A structured log entry records the total startup duration and per-phase durations.

**Phase 5 failure semantics:** REST API or WebSocket server failure is fatal. Without the API, the user has no interface to the system. The HealthReporter does NOT call `reportReady()` — systemd will eventually kill the process via startup timeout, producing a clean restart.

### 3.8 Phase 6 — Integrations

Integration startup happens after `READY=1`. This is a deliberate design decision: the API is available before devices are connected. Users can access the dashboard, view system health, and monitor integration startup progress in real time. Integration adapters that depend on external connections (serial ports, network endpoints) may take seconds to minutes to establish connectivity — blocking `READY=1` on external connectivity would violate INV-RF-03 and make systemd's startup timeout unpredictable.

**Step 6.1: IntegrationSupervisor discovers adapters.** The IntegrationSupervisor (Doc 05 §3.1) uses ServiceLoader (LTD-17) to discover all `IntegrationFactory` implementations. Each factory produces an `IntegrationDescriptor` declaring the adapter's type, I/O requirements, and dependencies.

**Step 6.2: Dependency graph resolution.** The supervisor validates the adapter dependency graph (AMD-14). Circular dependencies produce a fatal startup error. The dependency graph is resolved into a topological order.

**Step 6.3: Adapter initialization in dependency order.** Adapters initialize in topological order. For each adapter:

1. `initialize()` is called — this allocates resources, registers with the supervisor, and declares health state. It does NOT establish external connections (INV-RF-03).
2. The supervisor starts `run()` on the allocated thread — a platform thread for IoType.SERIAL (Doc 05 §3.2), a virtual thread for IoType.NETWORK.
3. The adapter's `run()` method establishes external connections (serial port, network socket, coordinator handshake) asynchronously.

Adapters with satisfied dependencies start in parallel (AMD-14 §Specification, point 5). Adapters whose dependencies have not yet reached RUNNING state wait.

**Phase 6 failure semantics:** Individual adapter failures are non-fatal (INV-RF-01). A failed adapter enters the supervised restart cycle (Doc 05 §3.4) — the supervisor applies the one-for-one restart strategy with restart intensity tracking. Other adapters continue starting. An adapter that cannot initialize (as opposed to failing during `run()`) transitions to SUSPENDED with a diagnostic reason.

### 3.9 Shutdown Sequence

The shutdown sequence is triggered by SIGTERM (sent by systemd during `systemctl stop homesynapse` or system shutdown). The `SystemLifecycleManager` registers a JVM shutdown hook that initiates the orderly teardown.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shutdown Sequence                              │
│                                                                  │
│  SIGTERM received                                                │
│      │                                                           │
│      ▼                                                           │
│  1. HealthReporter.reportStopping()  ─── STOPPING=1 to systemd  │
│      │                                                           │
│      ▼                                                           │
│  2. IntegrationSupervisor: signal stop all adapters              │
│     ├── Each adapter: close() with per-adapter grace period      │
│     ├── Wait for drain (adapters flush in-flight work)           │
│     └── Force-close after timeout                                │
│      │                                                           │
│      ▼                                                           │
│  3. WebSocket API: close all connections (Going Away 1001)       │
│      │                                                           │
│      ▼                                                           │
│  4. REST API: stop accepting, drain in-flight requests           │
│      │                                                           │
│      ▼                                                           │
│  5. Automation Engine: cancel active Runs, flush Ledger          │
│      │                                                           │
│      ▼                                                           │
│  6. Event Bus: flush buffered events, close subscribers          │
│      │                                                           │
│      ▼                                                           │
│  7. State Store: final projection flush                          │
│      │                                                           │
│      ▼                                                           │
│  8. Persistence Layer: final WAL checkpoint, close databases     │
│      │                                                           │
│      ▼                                                           │
│  9. Configuration System: stop file watcher                      │
│      │                                                           │
│      ▼                                                           │
│  10. Observability: final JFR chunk dump, stop recording         │
│      │                                                           │
│      ▼                                                           │
│  11. Remove unclean shutdown marker                              │
│      │                                                           │
│      ▼                                                           │
│  12. Logging: final flush, close appenders                       │
│      │                                                           │
│      ▼                                                           │
│  Process exits with code 0                                       │
└─────────────────────────────────────────────────────────────────┘
```

**Shutdown step details:**

1. **HealthReporter.reportStopping()** — `SystemdHealthReporter` sends `STOPPING=1` via `sd_notify`. systemd knows the process is shutting down and starts its `TimeoutStopSec` countdown (default 90 seconds). The `system_stopping` lifecycle event is emitted.

2. **Integration adapters stop.** The `IntegrationSupervisor` signals all adapters to stop in reverse dependency order (dependents stop before their dependencies, per AMD-14). Each adapter's `close()` method is called. The supervisor waits up to the per-adapter grace period (default 5 seconds, configurable per adapter) for the adapter to drain in-flight work. Adapters that do not complete within the grace period are interrupted (virtual threads) or have their resources forcibly closed (platform threads). Serial ports are closed explicitly to release hardware.

3. **WebSocket API closes.** All active WebSocket connections receive a Close frame with status 1001 (Going Away) and reason "server shutdown." The server waits up to 2 seconds for clients to acknowledge the close handshake.

4. **REST API drains.** The Javalin server stops accepting new connections. In-flight requests are allowed to complete for up to 5 seconds. After the grace period, the server forces closure.

5. **Automation Engine shuts down.** Active Runs are cancelled — each cancelled Run emits an `automation_cancelled` event with reason `system_shutdown`. The PendingCommandLedger is flushed — commands that were issued but not yet confirmed are logged with their pending state for recovery on next startup.

6. **Event Bus closes.** Any buffered events are flushed through to persistence. All subscriber registrations are cleared. The subscriber checkpoint positions are persisted (they are already durable from the last subscription progress update, but a final write ensures the latest position is captured).

7. **State Store flushes.** The State Projection is unsubscribed from the Event Bus. No explicit state persistence is needed — state is derived from events, and projections are rebuilt on startup. The latest checkpoint position is already persisted.

8. **Persistence Layer closes.** The WriteCoordinator drains its queue (priority-ordered — events first, then checkpoint, then maintenance). A final WAL checkpoint is executed (`PRAGMA wal_checkpoint(TRUNCATE)`) to return the database to a clean state. Both database files are closed. The unclean shutdown marker is not yet removed (it is removed in step 11, after observability shutdown confirms the JFR recording is flushed).

9. **Configuration System stops.** The file watcher thread is interrupted and joined.

10. **Observability stops.** The health aggregation loop is stopped. The JFR recording is stopped with `dumponexit=true` ensuring the final partial chunk is written. The metric ring buffer is cleared.

11. **Unclean shutdown marker removed.** The marker file at `PlatformPaths.dataDir()/.unclean_shutdown` is deleted. Its absence on next startup confirms the previous shutdown was clean.

12. **Logging flushes.** Logback appenders are flushed and closed. This is the last operation — every preceding step can still log.

The `system_stopped` lifecycle event is emitted before step 12 (while the Event Bus is still partially functional for this final event). The process exits with code 0.

**Grace period budget.** The total shutdown grace period defaults to 30 seconds. This is half of systemd's default `TimeoutStopSec=90`, leaving a 60-second margin for systemd to send SIGKILL if the process hangs. The 30-second budget is allocated:

| Phase | Budget | Subsystem |
|---|---|---|
| Integration drain | 10 seconds | IntegrationSupervisor |
| API drain | 5 seconds | REST + WebSocket |
| Core subsystem flush | 10 seconds | Automation, Event Bus, State Store |
| Persistence close | 3 seconds | WAL checkpoint, DB close |
| Observability + logging | 2 seconds | JFR dump, log flush |

If any phase exceeds its budget, the `SystemLifecycleManager` logs a WARNING identifying the slow subsystem and proceeds to the next phase. The total 30-second budget is a hard deadline — after 30 seconds from SIGTERM, remaining subsystems are abandoned and the process exits.

### 3.10 Runtime Health Loop

After Phase 6 completes and all integration adapters have been started (or failed with non-fatal errors), the `SystemLifecycleManager` transitions to RUNNING state and starts the health loop.

```
┌────────────────────────────────────────────────────────────────┐
│                     Runtime Health Loop                          │
│                                                                 │
│  ┌─────────────────┐    ┌──────────────────────┐               │
│  │ Health Loop      │    │ HealthContributors    │               │
│  │ (virtual thread) │    │                       │               │
│  │                  │    │  Config System ──────┐│               │
│  │  Every 30 sec:   │───▶│  Persistence ────────┤│               │
│  │  poll all ──────▶│    │  Event Bus ──────────┤│               │
│  │  contributors    │    │  Device Model ───────┤│               │
│  │  compute agg ────│    │  State Store ────────┤│               │
│  │  feed reporter   │    │  Automation ─────────┤│               │
│  │                  │    │  REST API ───────────┤│               │
│  │  reportWatchdog()│    │  WebSocket API ──────┤│               │
│  │       │          │    │  Observability ──────┤│               │
│  │       ▼          │    │  Integration [n] ────┘│               │
│  │  sd_notify       │    └──────────────────────┘               │
│  │  (WATCHDOG=1)    │                                            │
│  └─────────────────┘                                            │
└────────────────────────────────────────────────────────────────┘
```

**Health check period:** `WatchdogSec / 2 = 30 seconds` per systemd convention — the process must notify within the watchdog interval, and notifying at half the interval provides margin for scheduling jitter and GC pauses. The period is derived from the systemd `WatchdogSec=60` setting (LTD-13). If a different watchdog interval is configured, the health check period adjusts to half.

**Each iteration:**

1. Poll every registered `HealthContributor`. Each returns a `HealthStatus` (HEALTHY, DEGRADED, or UNHEALTHY) with a reason string.
2. Compute aggregated system health using the three-tier model (Doc 11 §3.3): per-component → per-subsystem → system-wide.
3. Call `HealthReporter.reportWatchdog()`. On Tier 1, this sends `WATCHDOG=1` to systemd. If the health loop stops running (process hangs, infinite loop, deadlock), systemd detects the missing watchdog and kills the process after `WatchdogSec` expires.
4. Call `HealthReporter.reportStatus(statusMessage)`. The status message is a human-readable summary: e.g., `"RUNNING: 47 entities, 6 automations, 1 integration (zigbee: HEALTHY)"`.
5. If system health transitions to UNHEALTHY and remains UNHEALTHY for a configurable duration (default 5 minutes, from `lifecycle.unhealthy_threshold_seconds`), emit a `system_health_changed` event and log at ERROR. The system does not self-terminate on UNHEALTHY status — systemd's watchdog handles unrecoverable hangs, and UNHEALTHY status may be recoverable (e.g., an integration adapter in restart cycle).

**Health loop failure handling:** The health loop itself runs on a dedicated virtual thread. If the thread throws an unhandled exception, it is restarted immediately. If the health loop fails to run for a full `WatchdogSec` interval (60 seconds), systemd kills the process — this is the correct behavior for an unrecoverable hang.

---

## 4. Data Model

### 4.1 Lifecycle Phase Enum

```
enum LifecyclePhase {
    BOOTSTRAP,            // Phase 0: platform, logging, JFR, HealthReporter
    FOUNDATION,           // Phase 1: configuration loading and validation
    DATA_INFRASTRUCTURE,  // Phase 2: persistence, event bus
    CORE_DOMAIN,          // Phase 3: device model, state store, automation
    OBSERVABILITY,        // Phase 4: health aggregation, metrics
    EXTERNAL_INTERFACES,  // Phase 5: REST API, WebSocket API
    INTEGRATIONS,         // Phase 6: adapter discovery and startup
    RUNNING,              // Steady state: health loop active
    SHUTTING_DOWN,        // Shutdown sequence in progress
    STOPPED               // All resources released, process exiting
}
```

### 4.2 Subsystem State Record

```
record SubsystemState(
    String subsystemName,          // e.g., "persistence_layer", "event_bus"
    LifecyclePhase phase,          // The phase this subsystem belongs to
    SubsystemStatus status,        // INITIALIZING, RUNNING, FAILED, STOPPED
    HealthStatus healthState,      // HEALTHY, DEGRADED, UNHEALTHY (null before init)
    Duration initializationDuration, // How long initialize() took
    String error                   // null if no error; diagnostic message if failed
)

enum SubsystemStatus {
    NOT_STARTED,     // Subsystem has not begun initialization
    INITIALIZING,    // initialize() in progress
    RUNNING,         // Successfully initialized and operating
    FAILED,          // Initialization failed or runtime failure
    STOPPING,        // Shutdown in progress
    STOPPED          // Shutdown complete
}
```

### 4.3 System Health Snapshot Record

```
record SystemHealthSnapshot(
    Instant timestamp,
    Map<String, SubsystemState> subsystemStates,
    HealthStatus aggregatedHealth,  // HEALTHY, DEGRADED, UNHEALTHY
    Duration uptime,                // Time since system_ready event
    long eventStorePosition,        // Current global_position in event log
    int entityCount,                // Number of active entities
    int integrationCount,           // Number of running integrations
    int automationCount             // Number of loaded automations
)
```

### 4.4 Lifecycle Events

All lifecycle events use the `system.*` event type namespace per **Event Model & Event Bus** §4.3.

| Event Type | Priority | Payload Fields | When Emitted |
|---|---|---|---|
| `system.starting` | NORMAL | `version`, `platform_tier`, `config_schema_version` | Start of Phase 1 (after logging is available) |
| `system.subsystem_initialized` | DIAGNOSTIC | `subsystem_name`, `phase`, `duration_ms` | After each subsystem completes initialization |
| `system.subsystem_failed` | CRITICAL | `subsystem_name`, `phase`, `error`, `fatal` | When a subsystem fails to initialize |
| `system.ready` | NORMAL | `total_startup_ms`, `phase_durations`, `entity_count`, `integration_count` | After Phase 5 (READY=1 sent) |
| `system.health_changed` | NORMAL | `previous_health`, `current_health`, `reason`, `affected_subsystems` | On aggregated health state transition |
| `system.stopping` | NORMAL | `reason` (e.g., "SIGTERM", "fatal_error") | Start of shutdown sequence |
| `system.stopped` | NORMAL | `uptime_seconds`, `shutdown_duration_ms`, `clean` | End of shutdown sequence (before logging closes) |

---

## 5. Contracts and Invariants

**C12-01: Initialization order is fixed and documented.** Subsystems initialize in the exact sequence defined in §3.2–§3.8. No subsystem may depend on a subsystem that initializes in a later phase. This ordering is a contract — downstream designs may depend on it.

**C12-02: Shutdown order is the reverse of initialization.** Subsystems shut down in reverse phase order (Phase 6 first, Phase 0 last). Within a phase, subsystems shut down in reverse initialization order. This guarantees that a subsystem's dependencies are still available when its `close()` method executes.

**C12-03: Watchdog notification within WatchdogSec/2.** The health loop calls `HealthReporter.reportWatchdog()` at least once every `WatchdogSec / 2` seconds (30 seconds for the default `WatchdogSec=60`). If the process fails to maintain this cadence, the platform supervisor (systemd) kills and restarts the process. This contract is the liveness guarantee.

**C12-04: Fatal failures produce diagnostic exit.** When a fatal failure occurs during initialization, the process exits with a non-zero exit code and a structured log entry containing: the subsystem that failed, the phase it was in, the exception message and stack trace, and a human-readable recommendation (e.g., "restore from backup", "check configuration file", "verify serial port permissions").

**C12-05: Non-fatal failures produce DEGRADED health, not process exit.** Integration adapter failures, observability subsystem failures, and other non-fatal failures cause the system health to report DEGRADED. The system continues operating with reduced functionality. The failure is logged, emitted as an event, and visible in the health dashboard.

**C12-06: Shutdown grace period is bounded.** The total shutdown duration from SIGTERM to process exit does not exceed 30 seconds (configurable via `lifecycle.shutdown_grace_period_seconds`). Individual subsystems receive proportional budgets. Subsystems that exceed their budget are forcibly closed.

**C12-07: Unclean shutdown detection.** On startup, the presence of `.unclean_shutdown` marker file indicates the previous run did not complete its shutdown sequence. The Persistence Layer's integrity check (Doc 04 §3.4) runs regardless, but the marker provides additional context. The marker is created at the end of Phase 2 (after data infrastructure is initialized) and removed at the end of a clean shutdown (step 11).

**C12-08: READY=1 is sent only after APIs are serving.** The `reportReady()` call occurs in Phase 5, after the REST and WebSocket servers are accepting connections. Integrations start after READY. systemd considers the service "started" only after READY=1, which means `systemctl start homesynapse` blocks until the API is available — dependent services can rely on this.

**C12-09: Integrations start after READY=1.** Integration adapters start in Phase 6, after the READY notification. The API is accessible before any device connectivity is established. This satisfies INV-RF-03 and provides users with immediate feedback (dashboard loads, health visible) while adapters establish device connections.

**C12-10: PlatformPaths are immutable after Phase 0.** Directory paths resolved during Phase 0 do not change for the lifetime of the process. All subsystems receive the same path set. This prevents the class of bugs where a path changes mid-operation.

---

## 6. Failure Modes and Recovery

### 6.1 Configuration File Missing or Invalid

**Trigger:** `PlatformPaths.configDir()/config.yaml` is absent or contains syntax errors.

**Impact:** If absent, the Configuration System generates defaults (INV-CE-02). If syntax is invalid, the system cannot determine any configuration.

**Recovery:** Fatal syntax errors → process exits with diagnostic listing every parse error and the file path. The user corrects the file and restarts. Non-fatal validation errors → affected keys revert to defaults, WARNING logged, startup continues.

**Event:** `system.subsystem_failed` with `subsystem_name: "configuration_system"`, `fatal: true` for syntax errors.

### 6.2 SQLite Database Corrupt

**Trigger:** `PRAGMA quick_check` fails during Phase 2.

**Impact:** The event store is unreadable. No events can be loaded, no state can be rebuilt.

**Recovery:** Process exits with diagnostic recommending `homesynapse restore-backup <path>` (LTD-14). The user restores from the most recent validated backup. If no backup exists, the user can delete the database file — HomeSynapse creates a fresh database on next start, losing all history.

**Event:** `system.subsystem_failed` with `subsystem_name: "persistence_layer"`, `fatal: true`, `error` containing the integrity check output.

### 6.3 Individual Subsystem Initialization Failure

**Trigger:** A subsystem's `initialize()` method throws an exception.

**Impact:** Depends on whether the subsystem is in the fatal set or the non-fatal set.

**Fatal set (process exits):** Configuration System, Persistence Layer, Event Bus, Device Model, State Store, Automation Engine, REST API. These are the minimum viable system — without any one of them, the system cannot serve its primary purpose.

**Non-fatal set (degraded operation):** Observability, WebSocket API, individual integration adapters. The system continues with reduced functionality.

**Recovery:** Fatal → process exits, user investigates using log and JFR recording. Non-fatal → degraded health reported, subsystem retries on next health cycle (where applicable).

**Event:** `system.subsystem_failed` with `fatal` field indicating the classification.

### 6.4 Watchdog Timeout

**Trigger:** The health loop fails to call `reportWatchdog()` within `WatchdogSec` (60 seconds).

**Impact:** systemd sends SIGABRT (or SIGKILL depending on configuration), producing a core dump. The process is restarted by `Restart=on-failure` after `RestartSec=10` (LTD-13).

**Recovery:** On restart, the unclean shutdown marker is detected. The integrity check runs. The reconciliation pass repairs any inconsistencies. JFR recording from the failed run (if recoverable) provides root-cause data.

**Event:** None (the process was killed externally). The next startup's `system.starting` event implicitly indicates a non-graceful restart when the unclean shutdown marker is present.

### 6.5 SIGTERM During Initialization

**Trigger:** `systemctl stop homesynapse` or system shutdown occurs while the process is still in Phases 0–5.

**Impact:** The shutdown hook fires. The `SystemLifecycleManager` shuts down only the subsystems that have completed initialization — subsystems that have not yet started are skipped.

**Recovery:** The shutdown is inherently safe because each subsystem's `close()` method is designed to be callable at any point after `initialize()` completes. Subsystems that never initialized have no resources to release.

### 6.6 Out of Memory During Startup

**Trigger:** The JVM reaches `-Xmx1536m` or systemd's `MemoryMax=2G` cgroup limit during initialization. The most likely cause is a full replay from position 0 (AMD-10, projection version mismatch) on a system with a large event log.

**Impact:** `OutOfMemoryError` or systemd OOM-kills the process.

**Recovery:** The system restarts via `Restart=on-failure`. If the OOM was caused by full replay, the system will OOM again on the next attempt. Mitigation: the full replay path logs its progress (events processed, memory used) so the user can identify the cause. The long-term fix is to ensure checkpoint compatibility across versions (reducing the need for full replay) or to implement incremental replay with bounded memory.

**Event:** JFR captures allocation profiling data leading up to the OOM. If the process survives long enough (OOM caught by a subsystem), a `system.subsystem_failed` event is emitted.

### 6.7 Integration Adapter Failure During Startup

**Trigger:** An adapter's `initialize()` or early `run()` throws an exception.

**Impact:** Non-fatal (INV-RF-01). The adapter enters SUSPENDED or FAILED state. Other adapters continue. The supervisor's restart strategy (Doc 05 §3.4) handles recovery.

**Recovery:** The supervisor retries the adapter according to its restart intensity policy. The user sees the adapter's health as DEGRADED or FAILED in the dashboard. No manual intervention required unless the failure is permanent (hardware disconnected).

**Event:** Integration lifecycle events per Doc 05 §4.4. `system.subsystem_failed` with `fatal: false`.

### 6.8 Unclean Shutdown Detection on Next Startup

**Trigger:** The `.unclean_shutdown` marker file exists when Phase 2 begins.

**Impact:** Indicates the previous shutdown did not complete its sequence — the process was killed (OOM, SIGKILL, power loss) or crashed.

**Recovery:** Log a WARNING with the marker file's timestamp (file modification time). The Persistence Layer's integrity check runs (it runs regardless). The State Store's reconciliation pass (AMD-02) repairs any missing derived events. The Automation Engine's PendingCommandLedger recovery reconciles in-flight commands. After all recovery passes complete, the marker is cleared.

**Event:** The `system.starting` event includes an `unclean_previous_shutdown: true` field when the marker is detected.

---

## 7. Interaction with Other Subsystems

This subsystem interacts with every other subsystem in the platform. It is the orchestration layer.

| Subsystem | Direction | Mechanism | Data / Purpose |
|---|---|---|---|
| Configuration System (Doc 06) | Calls | `ConfigurationSystem.load()` | Phase 1: load and validate config. Reads `lifecycle.*` configuration for this subsystem's own parameters. |
| Persistence Layer (Doc 04) | Calls | `PersistenceLayer.initialize()`, `.close()` | Phase 2: open databases, apply PRAGMAs, run migrations, integrity check. Shutdown: WAL checkpoint, close databases. |
| Event Bus (Doc 01) | Calls | `EventBus.initialize()`, `.close()` | Phase 2: initialize event distribution. Produces lifecycle events via `EventPublisher`. |
| Device Model (Doc 02) | Calls | `DeviceRegistry.initialize()`, `.close()` | Phase 3: load device/entity/capability registries. Triggers orphan detection (AMD-17). |
| State Store (Doc 03) | Calls | `StateStore.initialize()`, `.close()` | Phase 3: checkpoint recovery, replay, reconciliation (AMD-02), projection versioning (AMD-10). |
| Automation Engine (Doc 07) | Calls | `AutomationEngine.initialize()`, `.close()` | Phase 3: load rules, build index, register subscriber, recover ledger. Shutdown: cancel runs, flush ledger. |
| Observability (Doc 11) | Calls | `HealthAggregator.initialize()`, `.close()` | Phase 4: collect HealthContributors, start aggregation. Consumes health data from all subsystems. |
| REST API (Doc 09) | Calls | `RestApi.start()`, `.stop()` | Phase 5: start HTTP server. Shutdown: drain requests, stop server. |
| WebSocket API (Doc 10) | Calls | `WebSocketApi.start()`, `.stop()` | Phase 5: register upgrade handler, start relay subscriber. Shutdown: close connections. |
| Integration Runtime (Doc 05) | Calls | `IntegrationSupervisor.start()`, `.stop()` | Phase 6: discover and start adapters. Shutdown: signal stop, drain, force-close. |
| Zigbee Adapter (Doc 08) | Indirect | Via IntegrationSupervisor | Phase 6: discovered and started by supervisor. No direct interaction with this subsystem. |
| All subsystems | Receives from | `HealthContributor` interface | Runtime: polls health state from every subsystem for aggregation and watchdog feeding. |
| HealthReporter | Calls | `reportReady()`, `reportWatchdog()`, `reportStopping()`, `reportStatus()` | All phases: communicates lifecycle state to platform supervisor. |
| PlatformPaths | Provides to all | `binaryDir()`, `configDir()`, `dataDir()`, `logDir()`, `backupDir()`, `tempDir()` | Phase 0: resolved once, provided to all subsystems for directory resolution. |

---

## 8. Key Interfaces

### 8.1 Interfaces

| Interface | Responsibility |
|---|---|
| `SystemLifecycleManager` | Top-level orchestrator: sequences initialization, runs health loop, executes shutdown |
| `HealthReporter` | Abstracts platform-specific lifecycle health reporting (systemd, Docker, none) |
| `PlatformPaths` | Abstracts platform-specific directory conventions |
| `HealthContributor` | Per-subsystem health reporting (defined by Doc 11 §8.1, consumed here) |

### 8.2 HealthReporter Interface

**Purpose:** Abstracts lifecycle health reporting across platform supervisors per Portability Architecture §7.1.

```
interface HealthReporter {
    void reportReady();
    void reportWatchdog();
    void reportStopping();
    void reportStatus(String message);
}
```

**Method contracts:**

- `reportReady()` — Called exactly once, at the end of Phase 5, after APIs are accepting connections. On Tier 1, sends `READY=1` via `sd_notify`. After this call, the platform supervisor considers the service fully started and begins enforcing the watchdog interval.
- `reportWatchdog()` — Called periodically from the health loop (every `WatchdogSec/2` seconds). On Tier 1, sends `WATCHDOG=1` via `sd_notify`. Missing calls for longer than `WatchdogSec` trigger a process restart.
- `reportStopping()` — Called once at the start of the shutdown sequence. On Tier 1, sends `STOPPING=1` via `sd_notify`. The platform supervisor begins its shutdown timeout.
- `reportStatus(String message)` — Called at lifecycle transitions with a human-readable status string. On Tier 1, sends `STATUS=<message>` via `sd_notify`. Visible in `systemctl status homesynapse`.

**Tier 1 implementations:**

| Implementation | When Selected | Behavior |
|---|---|---|
| `SystemdHealthReporter` | `$NOTIFY_SOCKET` environment variable is set | Sends `sd_notify` messages via Unix domain socket using the faljse/SDNotify library (Maven Central) |
| `NoOpHealthReporter` | `$NOTIFY_SOCKET` is unset | All methods are no-ops. Used for development, macOS, and non-systemd environments |

### 8.3 PlatformPaths Interface

**Purpose:** Abstracts platform-specific directory conventions per Portability Architecture §7.2.

```
interface PlatformPaths {
    Path binaryDir();    // Read-only runtime image location
    Path configDir();    // Writable configuration files
    Path dataDir();      // Writable persistent data (SQLite databases)
    Path logDir();       // Writable log files and JFR recordings
    Path backupDir();    // Writable pre-update snapshots
    Path tempDir();      // Writable temporary files, cleaned on startup
}
```

**Method contracts:**

- All methods return absolute `Path` instances. Paths are resolved once during Phase 0 and cached — subsequent calls return the same `Path` object.
- All writable directories are verified to exist and be writable during Phase 0. If a directory does not exist, it is created. If creation fails (permission denied), initialization fails with a diagnostic naming the missing directory and the required permissions.
- `tempDir()` contents are deleted at the start of each process run (Phase 0). No other directory is cleaned on startup.

**Tier 1 implementation:**

| Implementation | Paths |
|---|---|
| `LinuxSystemPaths` | `binaryDir()` → `/opt/homesynapse/`, `configDir()` → `/etc/homesynapse/`, `dataDir()` → `/var/lib/homesynapse/`, `logDir()` → `/var/log/homesynapse/`, `backupDir()` → `/var/lib/homesynapse/backups/`, `tempDir()` → `/var/lib/homesynapse/tmp/` |

Selection logic: if `/opt/homesynapse/` exists and the process effective user is `homesynapse`, select `LinuxSystemPaths`. Otherwise, fall back to a development-mode `LocalPaths` implementation that creates all directories under the current working directory.

### 8.4 SystemLifecycleManager Interface

```
interface SystemLifecycleManager {
    void start();                          // Execute full startup sequence (Phases 0–6)
    void shutdown(String reason);          // Execute shutdown sequence
    LifecyclePhase currentPhase();         // Current lifecycle phase
    SystemHealthSnapshot healthSnapshot(); // Current system health
    Map<String, SubsystemState> subsystemStates(); // Per-subsystem state
}
```

**Implementation notes:**

- `start()` is called from `main()`. It executes Phases 0–6 sequentially. If a fatal failure occurs, `start()` calls `shutdown()` for any already-initialized subsystems and then calls `System.exit(1)`.
- `shutdown(reason)` is safe to call from the JVM shutdown hook, from `start()` on fatal failure, or from an explicit admin API call. Concurrent calls are serialized — the first call executes the shutdown; subsequent calls wait for completion.
- `healthSnapshot()` is called by the REST API health endpoint and the WebSocket health streaming.

### 8.5 Key Types

| Type | Kind | Responsibility |
|---|---|---|
| `LifecyclePhase` | Enum | The 10 phases of the process lifecycle |
| `SubsystemState` | Record | Current state of a single subsystem: phase, status, health, timing |
| `SubsystemStatus` | Enum | The 6 states a subsystem can be in |
| `SystemHealthSnapshot` | Record | Point-in-time snapshot of the entire system's health |
| `HealthReporter` | Interface | Platform-specific lifecycle reporting abstraction |
| `PlatformPaths` | Interface | Platform-specific directory path abstraction |
| `SystemLifecycleManager` | Interface | Top-level lifecycle orchestrator |

---

## 9. Configuration

All lifecycle configuration lives under the `lifecycle:` namespace in `config.yaml`. Every option has a sensible default — the system starts and operates correctly with no lifecycle configuration (INV-CE-02).

```yaml
lifecycle:
  shutdown_grace_period_seconds: 30   # Total time budget for shutdown sequence.
                                       # Must be less than systemd TimeoutStopSec (90s).
                                       # Range: 10–60. Default: 30.

  startup_timeout_per_subsystem_seconds: 60  # Maximum time any single subsystem
                                              # may take to initialize before the
                                              # startup is considered failed.
                                              # Range: 10–300. Default: 60.

  health_check_interval_seconds: 30   # Period of the runtime health loop.
                                       # Derived from WatchdogSec/2 by default.
                                       # Override for non-systemd environments.
                                       # Range: 5–120. Default: 30.

  unhealthy_threshold_seconds: 300    # Duration the system must remain UNHEALTHY
                                       # before emitting a system_health_changed event
                                       # at ERROR level. Short transient dips are normal.
                                       # Range: 30–3600. Default: 300.

  integration_start_delay_seconds: 0  # Delay after READY=1 before starting integrations.
                                       # Useful for testing API without device traffic.
                                       # Range: 0–60. Default: 0.

  unclean_shutdown_reconciliation: true  # Whether to run the full reconciliation pass
                                          # when an unclean shutdown is detected.
                                          # Disabling this skips AMD-02 reconciliation.
                                          # Default: true.
```

**JVM flags reference:** JVM-level configuration (heap size, GC tuning, thread stack size) is specified in the launcher script `/opt/homesynapse/bin/homesynapse` and the systemd service unit per LTD-01. This subsystem does not own JVM flags but depends on them. See **Locked Technical Decisions** LTD-01 §Specification for the complete flag set.

---

## 10. Performance Targets

| Metric | Target | Rationale |
|---|---|---|
| Cold start to READY=1 | < 15 seconds on RPi 5 with NVMe | Includes config load, SQLite open + PRAGMA + migration (if none pending), event bus init, state recovery from checkpoint, health aggregation, and API server start. The dominant cost is state checkpoint recovery + replay. With 200 entities and a recent checkpoint (<1000 events to replay), this should be well under budget. Full replay from position 0 (~1.7M events after 6 months) takes 30–60 seconds — this exceeds the target but is an exceptional case triggered only by projection version changes (AMD-10). |
| Cold start to READY=1 | < 30 seconds on RPi 4 with NVMe | Pi 4 validation floor (LTD-02). 2× the Pi 5 target due to ~50% lower single-core throughput. |
| Shutdown (SIGTERM to exit) | < 30 seconds | Within the 30-second grace period budget. Under normal conditions (no in-flight long-running operations), shutdown completes in < 5 seconds. |
| Health check loop overhead | < 1% CPU steady-state | The loop runs once every 30 seconds. Each iteration polls ~15 `HealthContributor` implementations (each returning a cached status) and sends one `sd_notify` message. Total work per iteration: < 1 ms. |
| Memory overhead of lifecycle management | < 5 MB | `SystemLifecycleManager`, `SubsystemState` records, `SystemHealthSnapshot`, `HealthReporter`, `PlatformPaths` — all lightweight data structures with no large buffers. |
| Watchdog notification jitter | < 5 seconds | The health loop targets 30-second intervals. With GC pauses (< 100 ms per LTD-01) and scheduling jitter, the actual interval may vary. The 30-second margin (WatchdogSec=60 minus 30-second interval) absorbs this variation. |

---

## 11. Observability

### 11.1 Metrics

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `lifecycle.startup_duration_ms` | Gauge | `phase` | Duration of each initialization phase |
| `lifecycle.shutdown_duration_ms` | Gauge | `phase` | Duration of each shutdown phase |
| `lifecycle.health_check_duration_ms` | Histogram | — | Time to complete each health check iteration |
| `lifecycle.subsystem_health` | Gauge | `subsystem`, `status` | Current health state per subsystem (0=HEALTHY, 1=DEGRADED, 2=UNHEALTHY) |
| `lifecycle.uptime_seconds` | Counter | — | Seconds since `system_ready` event |

All metrics are emitted as custom JFR events per LTD-15.

### 11.2 Structured Logging

Key log events produced by this subsystem:

| Log Event | Level | Fields | When |
|---|---|---|---|
| `lifecycle.phase_started` | INFO | `phase`, `subsystem_count` | Start of each initialization phase |
| `lifecycle.subsystem_initialized` | INFO | `subsystem`, `duration_ms` | After each subsystem completes init |
| `lifecycle.subsystem_failed` | ERROR | `subsystem`, `phase`, `error`, `fatal` | When a subsystem fails to init |
| `lifecycle.system_ready` | INFO | `total_ms`, `entity_count`, `integration_count` | READY=1 sent |
| `lifecycle.health_changed` | WARN/ERROR | `previous`, `current`, `reason` | Aggregated health state transition |
| `lifecycle.shutdown_started` | INFO | `reason`, `grace_period_ms` | SIGTERM received |
| `lifecycle.shutdown_step` | INFO | `subsystem`, `duration_ms` | Each subsystem shutdown completes |
| `lifecycle.shutdown_timeout` | WARN | `subsystem`, `budget_ms`, `actual_ms` | Subsystem exceeded its shutdown budget |
| `lifecycle.unclean_previous` | WARN | `marker_timestamp` | Unclean shutdown marker detected |

### 11.3 Health Indicator

This subsystem's own `HealthContributor` reports:

| State | Condition |
|---|---|
| HEALTHY | System is in RUNNING phase, all critical subsystems are RUNNING, health loop is active |
| DEGRADED | One or more non-critical subsystems are in FAILED state, or the health loop has missed one interval |
| UNHEALTHY | A critical subsystem has transitioned to FAILED during runtime (not just during startup), or the health loop has missed two consecutive intervals |

---

## 12. Security Considerations

This subsystem handles process-level security concerns at the platform boundary.

**PlatformPaths directory permissions.** On Tier 1, the FHS directory layout uses restricted permissions per LTD-13: `/opt/homesynapse/` is owned by `root:homesynapse` with mode 755 (read-only for the service); `/etc/homesynapse/`, `/var/lib/homesynapse/`, and `/var/log/homesynapse/` are owned by `homesynapse:homesynapse` with mode 750 (no access for other users). Configuration files may contain secret references; log files may contain entity identifiers and operational data. Restricting access to the `homesynapse` group prevents other local users from reading this data.

**systemd security hardening.** The service unit in LTD-13 enables: `ProtectSystem=strict` (read-only filesystem except explicitly listed paths), `PrivateTmp=true` (isolated /tmp), `NoNewPrivileges=true` (prevents privilege escalation), `ProtectHome=true` (no access to user home directories). `DeviceAllow` restricts device access to USB serial ports required by Zigbee coordinators.

**Dedicated service user.** The `homesynapse` system user has no login shell and no home directory. The process never runs as root. The launcher script drops to the `homesynapse` user before executing the JVM.

**Signal handling.** Only SIGTERM triggers graceful shutdown. SIGINT is equivalent to SIGTERM (for interactive use during development). SIGHUP is reserved for future log rotation signaling but is currently ignored. Other signals use JVM defaults.

---

## 13. Testing Strategy

### 13.1 Unit Tests

- **Initialization ordering logic.** Verify that the phase sequence is correct — subsystems are initialized in the documented order, and a subsystem in Phase N cannot be initialized before all Phase N-1 subsystems complete.
- **Shutdown ordering logic.** Verify that shutdown proceeds in reverse initialization order.
- **Fatal vs. non-fatal classification.** For each subsystem, verify that initialization failure produces the correct behavior (exit vs. degraded).
- **Grace period enforcement.** Verify that subsystems exceeding their shutdown budget are forcibly closed.
- **PlatformPaths selection logic.** Verify that `LinuxSystemPaths` is selected when FHS conditions are met, and development-mode paths are selected otherwise.
- **HealthReporter selection logic.** Verify that `SystemdHealthReporter` is selected when `$NOTIFY_SOCKET` is set, and `NoOpHealthReporter` otherwise.

### 13.2 Integration Tests

- **Full startup/shutdown cycle with mock subsystems.** Each subsystem is replaced with a mock that records initialization and shutdown calls. Verify the complete sequence.
- **Startup with one fatal subsystem failure.** Inject a failure in the Persistence Layer mock. Verify that previously-initialized subsystems are shut down and the process exits with the correct diagnostic.
- **Startup with one non-fatal subsystem failure.** Inject a failure in an integration adapter. Verify that other subsystems complete normally and the system reports DEGRADED health.
- **Shutdown during initialization.** Send SIGTERM during Phase 3. Verify that only initialized subsystems are shut down, and uninitiated subsystems are skipped.
- **HealthReporter integration.** On a system with systemd, verify that `sd_notify` messages are received by systemd (testable via `systemd-notify --status` or by inspecting `systemctl status` output).

### 13.3 Performance Tests

- **Startup time benchmark on RPi 5.** Measure cold start to READY=1 with 200 entities, a recent checkpoint, and a single Zigbee adapter (mocked). Target: < 15 seconds.
- **Startup time benchmark on RPi 4.** Same scenario. Target: < 30 seconds.
- **Shutdown time benchmark.** Measure SIGTERM to process exit with active integrations and in-flight API requests. Target: < 30 seconds.
- **Health loop overhead.** Measure CPU usage of the health loop over a 10-minute window. Target: < 1% of one core.

### 13.4 Failure Tests

- **Watchdog timeout test.** Block the health loop thread. Verify that systemd kills the process after `WatchdogSec` expires.
- **Unclean shutdown recovery.** Kill the process with SIGKILL during Phase 3 (after persistence is initialized but before shutdown marker is cleared). Restart. Verify that the unclean shutdown is detected, the reconciliation pass runs, and the system starts correctly.
- **OOM during startup.** Reduce `-Xmx` to trigger OOM during state replay. Verify that the process exits with an identifiable OOM error and restarts via systemd.
- **Concurrent SIGTERM during shutdown.** Send two SIGTERM signals in rapid succession. Verify that only one shutdown sequence executes and it completes without errors.
- **Corrupt database on startup.** Provide a SQLite database with a corrupted page. Verify that `PRAGMA quick_check` detects the corruption and the process exits with a diagnostic recommending backup restore.

---

## 14. Future Considerations

**Multi-instance lifecycle coordination.** MVP runs as a single instance per hub. Future multi-hub deployments may require coordinated startup (leader election, state synchronization) and coordinated shutdown (drain before maintenance). The current design does not prevent this — the `SystemLifecycleManager` interface can be extended with coordination methods, and the `HealthReporter` model extends to cluster-aware health reporting. Not implemented in MVP because the single-instance model is the defining constraint of local-first operation.

**Rolling subsystem restart (hot reload).** The current design treats subsystems as initialize-once, shutdown-once. Future versions may support restarting individual subsystems without a full process restart — useful for upgrading integration adapters without downtime. The sequential initialization model supports this if dependency tracking is maintained at runtime. Not implemented in MVP because the added complexity is not justified for a single-adapter system.

**AdaptivePragmaConfig integration.** Per Portability Architecture §7.3, SQLite PRAGMA values should adapt to the deployment platform (NVMe vs. SD card, 4 GB vs. 16 GB RAM). The current design uses static PRAGMA values from LTD-03. The Phase 2 interface spec should parameterize PRAGMAs through `PlatformPaths` or a sibling `PlatformCapabilities` interface.

**Additional HealthReporter implementations.** `HttpHealthReporter` for Docker HEALTHCHECK and Kubernetes livenessProbe (Enhanced tier). `AndroidHealthReporter` for the Companion tier. The interface is designed for this — 4 methods, no systemd-specific semantics.

**Additional PlatformPaths implementations.** `LinuxUserPaths` (XDG directories for non-root installation), `MacOsPaths` (/Library/Application Support/), `DockerPaths` (volume mounts), `WindowsPaths` (%ProgramData%). The interface accommodates all of these — 6 path methods with no platform-specific return types.

**Startup time optimization.** AppCDS (Application Class Data Sharing) per LTD-01 is the primary optimization lever. CRaC (Coordinated Restore at Checkpoint) is a future JDK feature that could reduce startup to sub-second by checkpointing the initialized JVM state. The current design does not prevent CRaC integration.

---

## 15. Open Questions

1. **Should the startup timeout per subsystem be enforced strictly, or should it serve as a WARNING threshold?**
   Options: (a) Hard enforcement — kill the subsystem's initialization thread after the timeout and fail fast; (b) Soft enforcement — log a WARNING after the timeout but allow initialization to continue; (c) Configurable per-subsystem — some subsystems (State Store during full replay) legitimately take longer than others.
   Needed: Production data on actual initialization times for full replay scenarios (AMD-10).
   Status: **[NON-BLOCKING]** — Option (c) is the likely resolution, but the default 60-second timeout is generous enough for normal operation. Full replay (the only case that might exceed it) is already documented as an exceptional scenario. The timeout enforcement mode can be finalized during Phase 2 interface specification without changing any design decision in this document.

2. **Should the health loop frequency be adaptive based on system load?**
   Options: (a) Fixed at WatchdogSec/2; (b) Increase frequency during DEGRADED status for faster recovery detection; (c) Decrease frequency during high event throughput to reduce overhead.
   Needed: Production profiling of health check overhead on constrained hardware.
   Status: **[NON-BLOCKING]** — The fixed WatchdogSec/2 interval satisfies the watchdog contract and has negligible overhead (< 1 ms per check). Adaptive frequency is an optimization that can be added in any release without changing interfaces.

---

## 16. Summary of Key Decisions

| Decision | Choice | Rationale | Section |
|---|---|---|---|
| Initialization ordering model | Sequential within phases, no concurrent initialization | Deterministic failure diagnosis on constrained hardware; eliminates initialization races without synchronization barriers. Per LTD-02 (constrained hardware), debuggability outweighs marginal startup time savings. | §3.1 |
| Phase boundary model | 7 phases (0–6) with explicit boundaries | Each phase establishes a contract that subsequent phases depend on: Phase 0 (platform) → Phase 1 (config) → Phase 2 (data) → Phase 3 (domain) → Phase 4 (observability) → Phase 5 (API) → Phase 6 (integrations). The boundaries are data dependencies, not arbitrary groupings. | §3.2–§3.8 |
| READY=1 timing | After Phase 5 (API up), before Phase 6 (integrations) | API availability before device connectivity satisfies INV-RF-03 (no external blocking). Users see the dashboard and system health immediately. Integration startup is visible as it progresses. | §3.7, §3.8 |
| Fatal vs. non-fatal classification | Config, Persistence, Event Bus, Device Model, State Store, Automation, REST API are fatal; Observability, WebSocket, integrations are non-fatal | The fatal set is the minimum viable system — without any one, the system cannot serve its primary purpose. Non-fatal subsystems provide enhanced functionality that degrades gracefully. Per INV-RF-01 (integration isolation) and INV-RF-06 (graceful degradation). | §6.3 |
| Shutdown grace period | 30 seconds total, allocated proportionally | Half of systemd's default TimeoutStopSec=90, leaving 60-second margin. The 30-second budget is sufficient for draining connections, flushing the WAL, and dumping JFR. Per LTD-13 systemd configuration. | §3.9 |
| Shutdown ordering | Reverse of initialization order | Ensures each subsystem's dependencies are still available during its `close()` execution. Standard resource management pattern. | §3.9 |
| Integrations start after READY | Integration startup is Phase 6, after READY=1 sent | Prevents external device connectivity from blocking service readiness. Per INV-RF-03. Adapter failures during Phase 6 are non-fatal (INV-RF-01). | §3.8 |
| Watchdog interval | WatchdogSec/2 = 30 seconds | systemd convention: notify at half the watchdog interval to provide margin for scheduling jitter and GC pauses. The 30-second margin absorbs G1GC pauses (< 100 ms per LTD-01). | §3.10 |
| HealthReporter interface | 4 methods: reportReady, reportWatchdog, reportStopping, reportStatus | Minimal interface covering the full lifecycle notification protocol. Per Portability Architecture §7.1. SystemdHealthReporter for Tier 1; NoOpHealthReporter for development and non-systemd environments. | §8.2 |
| PlatformPaths interface | 6 methods: binaryDir, configDir, dataDir, logDir, backupDir, tempDir | Covers all directory categories needed by all subsystems. Per Portability Architecture §7.2. LinuxSystemPaths for Tier 1 (FHS per LTD-13). | §8.3 |
| Unclean shutdown detection | Marker file in dataDir | Simple, reliable detection mechanism. Created after Phase 2 (data infrastructure available), removed at end of clean shutdown. Presence on next startup triggers reconciliation pass (AMD-02). | §3.4 (Step 2.1.5), §6.8 |
| Orphan detection timing | After Device Model + State Store init, before integrations start | Orphans must be detected after state is available (to mark them stale) but before integrations start (to allow re-adoption). Per AMD-17. | §3.5 (Step 3.3) |
| Concurrent initialization | Not used — sequential within phases | On 4-core Cortex-A76 (LTD-02), concurrent init adds synchronization complexity without meaningful speedup. Sequential initialization produces deterministic timing, simplifies failure diagnosis, and eliminates race conditions. | §3.1 |

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It is governed by the Design Document Template and will be reviewed during architecture review.*
