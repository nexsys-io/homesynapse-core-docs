# HomeSynapse Core — Observability & Debugging

**Document type:** Subsystem design
**Status:** Draft
**Subsystem:** Observability & Debugging
**Dependencies:** Event Model & Event Bus (Doc 01: §3.4 subscription model, §4.1 event envelope, §4.3 event type taxonomy, §4.4 causal chain projection, §8.1 EventStore query interface, §11 metrics/health), State Store & State Projection (Doc 03: §8.1 StateQueryService, §11 health indicator, §5 viewPosition contract)
**Dependents:** Web UI (Doc 13: real-time metrics streaming, health dashboard, trace viewer data), Startup Lifecycle & Shutdown (Doc 12: health reporting interface, subsystem initialization order), Master Architecture Document (Doc 14: system health model, memory budget for observability)
**Author:** HomeSynapse Core Architecture
**Date:** 2026-03-09

---

## 0. Purpose

Observability in HomeSynapse is a first-class subsystem, not an afterthought bolted onto production code. Every other design document in this project defines its own §11 — its own metrics, structured log events, and health indicator. This document owns the infrastructure those 10 subsystems report into: the JFR continuous recording that captures their metrics, the health aggregation that composes their individual health states into a single actionable system picture, and the trace query service that makes the causal chain metadata navigable.

The competitive gap that motivates this subsystem is concrete. Per competitive research across five platforms (Home Assistant, openHAB, SmartThings, Hubitat, Domoticz), no existing smart home platform answers "why did this happen?" with a full end-to-end causal chain. Home Assistant's automation trace viewer stops at the automation boundary — it cannot trace upstream triggers or downstream device confirmations. Hubitat's "Produced By" attribution is per-device only and opt-in. The universal failure is the inability to show "motion sensor detected motion → automation evaluated conditions → command sent to light → light confirmed state change" as a single queryable chain. HomeSynapse's event-sourced architecture, with correlation_id and causation_id on every event envelope (Doc 01 §4.1), makes this chain a stored fact. This subsystem makes it queryable.

The Tier 1 acceptance criterion from the MVP document (§8.1) requires that the event trace answers "why did this happen?" — INV-ES-06 states that every state change must be explainable through the causal chain. This subsystem is the mechanism that satisfies that invariant at the system level.

---

## 1. Design Principles

**Always-on, never opt-in.** Diagnostics that require prior setup are useless for investigating problems that have already occurred. JFR continuous recording, structured logging, and health reporting run from first boot with zero configuration. This is the subsystem-level expression of INV-TO-01 (system behavior is observable). The overhead budget for always-on observability is bounded: less than 5% of one CPU core sustained, 256 MB disk for JFR, and bounded memory for health aggregation state (INV-PR-03).

**The causal chain is the primary diagnostic tool.** Logs answer "what happened." Metrics answer "how much." The causal chain answers "why." For a smart home user investigating unexpected behavior, "why" is the question that matters. This subsystem prioritizes making correlation_id → event chain queries fast and navigable over providing granular metric breakdowns. Per competitive research, this is the universal gap across all platforms.

**Health is compositional and actionable.** A single red/yellow/green indicator tells a user that something is wrong but not what or where. Health aggregation must compose 10 per-subsystem indicators into a tiered structure that identifies which tier is affected, which subsystem is degraded, since when, and what the user-visible impact is. Every health state transition carries a reason string.

**Bounded overhead on constrained hardware.** Every observability feature must justify its resource cost against the Pi 5 / Pi 4 validation floor (LTD-02). JFR recording parameters, index maintenance, and streaming bridge throughput are designed for constrained hardware first. Features that work on x86 but bottleneck on ARM64 are rejected (INV-PR-01).

**Per-subsystem log levels are dynamically adjustable at runtime.** Inspired by openHAB's Karaf console, but exposed through the REST API and Web UI rather than requiring CLI access. A user investigating a Zigbee issue can set `com.homesynapse.integration.zigbee` to DEBUG without restarting the system and without flooding unrelated subsystem logs.

---

## 2. Scope and Boundaries

### 2.1 This Subsystem Owns

- JFR continuous recording lifecycle: startup, configuration, chunk rotation, shutdown dump
- Custom JFR event taxonomy: the unified registry of application-level JFR event types and their field definitions
- JFR Event Streaming bridge: the `RecordingStream`-based pipeline that reads JFR events and pushes aggregated metric snapshots to WebSocket and REST consumers
- System-wide health aggregation: tiered composition of per-subsystem health indicators into a single system health model, including startup grace periods, flapping prevention, and lifecycle state machine
- Trace query service: causal chain assembly from EventStore queries, reverse lookup ("why did this happen?"), completeness detection via terminal event types
- Dynamic log level control: runtime adjustment of per-package SLF4J/Logback log levels without restart

### 2.2 This Subsystem Does Not Own

- Per-subsystem metric definitions — each subsystem's §11.1 is authoritative for its own metrics. This subsystem provides the JFR recording infrastructure they emit into.
- Per-subsystem health indicator logic — each subsystem's §11.3 defines the conditions that produce HEALTHY, DEGRADED, or UNHEALTHY. This subsystem consumes those indicators; it does not override them.
- Per-subsystem structured log event definitions — each subsystem's §11.2 defines its own log events. This subsystem provides the logging infrastructure (SLF4J + Logback + JSON encoder per LTD-15) and dynamic level control.
- Event persistence and indexing — owned by the Persistence Layer (Doc 04). The trace query service reads from the EventStore interface (Doc 01 §8.1); it does not manage storage.
- Web UI presentation of health, metrics, or traces — owned by the Web UI subsystem (Doc 13). This subsystem provides the data interfaces that Doc 13 consumes.
- Startup and shutdown orchestration — owned by Startup/Lifecycle (Doc 12). This subsystem reports its own health and provides the health aggregation interface that Doc 12's startup sequence queries.
- Event envelope schema and causal chain metadata — owned by Doc 01 §4.1 and §4.4. This subsystem queries those fields; it does not define them.

---

## 3. Architecture

### 3.1 Component Overview

The Observability & Debugging subsystem consists of three internal components that share no mutable state with each other. Each runs independently and communicates with the rest of the system through defined interfaces.

```
┌─────────────────────────────────────────────────┐
│          Observability & Debugging               │
│                                                  │
│  ┌──────────────────┐  ┌─────────────────────┐  │
│  │ MetricsInfra     │  │ HealthAggregator    │  │
│  │                  │  │                     │  │
│  │  JFR Recording   │  │  Tier Composition   │  │
│  │  Event Registry  │  │  Lifecycle FSM      │  │
│  │  Stream Bridge   │  │  Flapping Guard     │  │
│  └───────┬──────────┘  └──────────┬──────────┘  │
│          │                        │              │
│  ┌───────┴────────────────────────┴──────────┐  │
│  │         TraceQueryService                  │  │
│  │                                            │  │
│  │  Chain Assembly    Reverse Lookup           │  │
│  │  Completeness      Story Builder            │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
         │              │               │
         ▼              ▼               ▼
   ┌──────────┐  ┌───────────┐  ┌────────────┐
   │ Doc 10   │  │ Doc 09    │  │ Doc 01     │
   │ WebSocket│  │ REST API  │  │ EventStore │
   └──────────┘  └───────────┘  └────────────┘
```

### 3.2 MetricsInfrastructure

MetricsInfrastructure manages the JFR recording lifecycle and the bridge between JFR events and real-time consumers.

**JFR Recording Lifecycle.** A single continuous JFR recording starts during subsystem initialization with parameters from configuration (§9). The recording writes to a dedicated directory on NVMe storage (never tmpfs — on a 4 GB system, a 256 MB tmpfs creates dangerous memory pressure). Chunk rotation is governed by `maxsize` and `maxage`; when either limit is exceeded, the oldest chunk is deleted. On clean shutdown, `dumponexit=true` ensures the final partial chunk is flushed. On unclean shutdown, the recording is intact up to the last completed chunk — JFR's append-only chunk format is crash-safe.

**Custom Event Registry.** All application-level JFR event types are registered through MetricsInfrastructure at subsystem initialization. This is a compile-time registry, not a dynamic registration system — the set of custom event types is fixed for a given release. The registry enforces the constraint that all JFR event fields use primitives or String (enums are silently ignored by JFR and must not be used). Per JFR analysis, the budget is 15–25 custom event types with a safe ceiling of 50–100, and up to 2,000 events/sec sustained. The `@StackTrace(false)` annotation is mandatory on all metric events — stack trace capture is the single most expensive JFR operation.

**Event Streaming Bridge.** A `RecordingStream` (JEP 349) reads from the disk repository with ~1–2 second latency from `event.commit()` to `onEvent()` callback. The bridge registers `onEvent()` callbacks for each metric event type of interest and aggregates values into per-metric snapshots (min, max, count, sum per flush window). The `onFlush()` callback — fired after each chunk flush, approximately once per second — pushes the aggregated snapshot to a bounded internal queue. The WebSocket API (Doc 10) and REST API (Doc 09) consume from this queue.

Pre-aggregation in `onFlush()` callbacks is the primary cardinality reduction strategy. Raw JFR events at 600/sec are reduced to ~15–25 metric snapshots per second for WebSocket push. Operations in `onEvent()` callbacks must never emit JFR events — this would cause infinite recursion (documented in JEP 349).

**JDK Version Requirement.** JDK 21.0.6+ is required (not merely 21.0.0). The JFR string constant pool bug (JDK-8338389) caused strings longer than 128 characters to not be pooled before the backport. This affects entity identifier strings in JFR events.

### 3.3 HealthAggregator

HealthAggregator composes per-subsystem health indicators into a tiered system health model. It evaluates reactively — triggered by health-change events from subsystems, not by polling on a timer.

**Tiered Composition.** Per competitive research on health aggregation models (Consul, Kubernetes, Envoy, Nagios, CloudWatch), tiered classification provides the optimal balance between sensitivity and actionability for HomeSynapse's 10-subsystem scale. Three tiers:

| Tier | Classification | Subsystems | Rationale |
|---|---|---|---|
| Tier 1 — Critical Infrastructure | Any UNHEALTHY → system UNHEALTHY; any DEGRADED → system DEGRADED | Event Bus (Doc 01), State Store (Doc 03), Persistence (Doc 04) | The platform cannot function without these. Event persistence, state projection, and durable storage are existential dependencies. |
| Tier 2 — Core Services | ≥2 DEGRADED or any UNHEALTHY → system DEGRADED | Automation Engine (Doc 07), Integration Runtime (Doc 05), Configuration System (Doc 06), Device Model (Doc 02), Observability (Doc 11, self) | A single DEGRADED core service is noted but does not degrade the system. Automations failing while manual device control works is a reduced but functional state. Degraded observability limits diagnostics but does not affect device operation. |
| Tier 3 — Interface Services | All UNHEALTHY → system DEGRADED | REST API (Doc 09), WebSocket API (Doc 10) | Partial interface degradation does not affect core system operation. |

System-wide health is the worst-of across tier results: `System = worst(Tier1_result, Tier2_result, Tier3_result)`. Computation is O(n) with n=10 — negligible.

The Zigbee Adapter (Doc 08) reports health through the Integration Runtime's per-integration health model (Doc 05 §11.3), not as a separate subsystem in this aggregation. Its health contributes to the Integration Runtime's composite indicator.

**Lifecycle State Machine.** The system progresses through three lifecycle states: `STARTING → RUNNING → SHUTTING_DOWN`. During `STARTING`, per-subsystem startup grace periods apply. A subsystem reporting DEGRADED within its grace period is annotated as "(starting)" and excluded from aggregate composition. After the grace period expires, normal tier rules apply. If any Tier 1 subsystem has not reported HEALTHY by the maximum startup duration, the system transitions to RUNNING in DEGRADED state with an explicit reason.

**Flapping Prevention.** At the aggregate level, a minimum dwell time of 10 seconds applies to DEGRADED → HEALTHY transitions. Transitions to UNHEALTHY are immediate (safety-critical). Individual subsystems implement their own hysteresis (documented in their respective §11.3 sections); the aggregate dwell time absorbs correlated oscillation across subsystems.

### 3.4 TraceQueryService

TraceQueryService makes the causal chain metadata in the event store (correlation_id, causation_id, triggered_by per Doc 01 §4.1) navigable as a concrete, queryable operation. It reads from the EventStore interface (Doc 01 §8.1) and builds chain structures for consumption by the REST API and Web UI.

**Chain Assembly.** Given a correlation_id, assembly is a single SQL query followed by a single-pass hash map tree build:

1. `SELECT * FROM events WHERE correlation_id = ? ORDER BY timestamp ASC` — fetches ~7 rows via index scan (p99 < 1 ms on NVMe).
2. Build tree in O(n) where n ≈ 7: create a hash map from `event_id` → node. Iterate events: if `causation_id` is null, mark as root; otherwise, append to parent's children list via hash map lookup.

HomeSynapse's single-writer SQLite model eliminates the challenges that distributed tracing systems face: no out-of-order arrivals, no distributed collection, no clock skew. At ~7 events per chain with ~100–1,000 chains per day, chain assembly is trivial — six orders of magnitude simpler than production distributed tracing systems.

**Reverse Lookup.** The "why did this happen?" query — given a device in a particular state, find the causal chain that produced it:

```sql
SELECT correlation_id FROM events
WHERE entity_id = ?
  AND event_type IN ('state_changed', 'state_confirmed')
ORDER BY timestamp DESC LIMIT 1
```

This returns the correlation_id for the most recent state-affecting event. The full chain is then assembled using the standard correlation_id lookup. The covering index on `(entity_id, event_type, timestamp DESC)` makes this query an index-only scan.

**Five Query Patterns.** Ordered by expected frequency:

1. **By correlation_id** — direct lookup when a user clicks a specific event. Single index scan.
2. **Reverse lookup** — "why is this device in this state?" The primary diagnostic query.
3. **By entity + time range** — "what happened to the porch light today?" Returns correlation_ids for all chains involving that entity.
4. **By event type + time range** — "show all automation triggers in the last hour."
5. **By time range** — "what happened between 2 AM and 4 AM?"

**Completeness Detection.** Terminal event types (`state_confirmed`, `automation_completed`, `command_failed`, `command_timed_out`) signal that a causal chain has reached its end. If the last event in a chain is terminal, the chain is complete. If not, the chain is in-progress. Chains in-progress for over 30 seconds are flagged with a warning; over 5 minutes, a potential failure indicator. The consumer (Web UI) can auto-refresh in-progress chains by re-querying the correlation_id.

### 3.5 Per-Subsystem Metric Surface

Doc 11 does not define per-subsystem metrics — it composes them. The following table catalogs the metric surface that this subsystem's infrastructure receives. Each entry references the authoritative source.

| Source | Metric Prefix | Key Metrics | Health States | Authority |
|---|---|---|---|---|
| Event Bus (Doc 01) | `hs_events_*` | appended_total, append_latency_ms, subscriber_lag, coalesced_total, store_size_bytes, pending_commands, causal_chain_max_depth | HEALTHY / DEGRADED / CRITICAL | Doc 01 §11 |
| Device Model (Doc 02) | `hs.device.*`, `hs.entity.*` | device.count, entity.count, validation.rejected, discovery.*, replacement.* | HEALTHY / DEGRADED / UNHEALTHY | Doc 02 §11 |
| State Store (Doc 03) | `hs_state_store_*` | view_position, entity_count, memory_bytes, replay_progress, query_latency_ms | HEALTHY / STARTING / DEGRADED / UNHEALTHY | Doc 03 §11 |
| Persistence (Doc 04) | `hs_persistence_*` | storage_used_bytes, storage_pressure_level, retention_events_deleted, backup_last_success, quick_check_duration_ms | HEALTHY / DEGRADED / UNHEALTHY (composite) | Doc 04 §11 |
| Integration Runtime (Doc 05) | `hs.integration.*` | health_state, health_score, error_rate, timeout_rate, restart_count, events_produced | Per-integration: HEALTHY / DEGRADED / SUSPENDED / FAILED. Composite: HEALTHY / DEGRADED / UNHEALTHY | Doc 05 §11 |
| Configuration (Doc 06) | `config.*` | load_duration_ms, reload_count, validation_issues, secret_count | HEALTHY / DEGRADED / UNHEALTHY | Doc 06 §11 |
| Automation Engine (Doc 07) | `hs_automation_*` | runs_total, run_duration_ms, trigger_evaluations_total, commands_issued_total, pending_commands | HEALTHY / DEGRADED / UNHEALTHY | Doc 07 §11 |
| Zigbee Adapter (Doc 08) | `hs.zigbee.*` | frames.received, frames.corrupt, commands.round_trip_ms, devices.available | Reports through Doc 05 integration health | Doc 08 §11 |
| REST API (Doc 09) | `hs.api.*` | request.duration, request.count, error.count, command.issued, rate_limit.hit | HEALTHY / DEGRADED / UNHEALTHY | Doc 09 §11 |
| WebSocket API (Doc 10) | `hs.ws.*` | connections.active, events.delivered, relay.lag, backpressure.activations | HEALTHY / DEGRADED / UNHEALTHY | Doc 10 §11 |

### 3.6 Dynamic Log Level Control

Log levels are adjustable at runtime per Java package through the LogLevelController interface. Changes take effect immediately via Logback's `LoggerContext` API — no restart, no config file reload. The REST API (Doc 09) exposes this as an authenticated endpoint. Default log levels are defined in LTD-15; dynamic adjustments persist only until the next restart (they are not written to configuration files).

Inspired by openHAB's Karaf console `log:set` capability, but exposed through the Web UI and REST API rather than requiring CLI access.

---

## 4. Data Model

This section defines the data structures that the Observability & Debugging subsystem introduces. Per-subsystem metrics and log events are not redefined here — they are referenced in §3.5.

### 4.1 Health Aggregation Model

```java
// System-wide health snapshot
public record SystemHealth(
    HealthStatus status,           // HEALTHY, DEGRADED, UNHEALTHY
    LifecycleState lifecycle,      // STARTING, RUNNING, SHUTTING_DOWN
    Instant since,                 // when current status began
    String reason,                 // human-readable reason for current status
    Map<HealthTier, TierHealth> tiers,
    Map<String, SubsystemHealth> subsystems
) {}

public record TierHealth(
    HealthTier tier,
    HealthStatus status,
    List<String> degradedSubsystems,
    List<String> unhealthySubsystems
) {}

public record SubsystemHealth(
    String subsystemId,            // e.g., "event-bus", "state-store"
    HealthTier tier,
    HealthStatus status,           // as reported by the subsystem
    Instant since,                 // when subsystem entered this status
    String reason,                 // subsystem-provided reason string
    boolean inGracePeriod          // true during startup grace
) {}

public enum HealthStatus { HEALTHY, DEGRADED, UNHEALTHY }

public enum HealthTier {
    CRITICAL_INFRASTRUCTURE,  // Tier 1
    CORE_SERVICES,            // Tier 2
    INTERFACE_SERVICES        // Tier 3
}

public enum LifecycleState { STARTING, RUNNING, SHUTTING_DOWN }
```

### 4.2 Trace Query Result

```java
// Complete causal chain for a single correlation_id
public record TraceChain(
    String correlationId,
    TraceEvent rootEvent,          // the event with no causation_id
    List<TraceEvent> orderedEvents, // all events, timestamp-ordered
    TraceNode tree,                // parent-child tree structure
    TraceCompleteness completeness,
    Instant firstTimestamp,
    Instant lastTimestamp
) {}

public record TraceEvent(
    String eventId,
    String eventType,
    String entityId,
    String correlationId,
    String causationId,            // null for root event
    Instant eventTime,
    Instant ingestTime,
    Map<String, Object> payload    // event-type-specific data
) {}

public record TraceNode(
    TraceEvent event,
    List<TraceNode> children       // ordered by timestamp
) {}

public sealed interface TraceCompleteness {
    record Complete(String terminalEventType) implements
        TraceCompleteness {}
    record InProgress(
        Instant lastEventTime,
        Duration elapsed
    ) implements TraceCompleteness {}
    record PossiblyIncomplete(
        String reason              // e.g., "retention purged"
    ) implements TraceCompleteness {}
}
```

### 4.3 JFR Custom Event Taxonomy

The following table defines the custom JFR event types registered by MetricsInfrastructure. Per-subsystem metric events are emitted by their respective subsystems; this taxonomy defines the event classes they use. All fields are primitives or String — no enums (JFR silently ignores them). All metric events carry `@StackTrace(false)`.

| Event Class | Category | Fields | Emitters |
|---|---|---|---|
| `DeviceMetricEvent` | HomeSynapse.Device | `int deviceId`, `int metricType`, `long value`, `byte unit` | Device Model, Integration Runtime, Zigbee Adapter |
| `EventBusMetricEvent` | HomeSynapse.EventBus | `long globalPosition`, `int subscriberLag`, `int pendingCommands`, `int appendLatencyUs` | Event Bus |
| `StateStoreMetricEvent` | HomeSynapse.StateStore | `long viewPosition`, `int entityCount`, `int queryLatencyUs`, `float replayProgress` | State Store |
| `PersistenceMetricEvent` | HomeSynapse.Persistence | `long storageUsedBytes`, `int pressureLevel`, `int walSizeBytes`, `int retentionDeletedCount` | Persistence Layer |
| `AutomationMetricEvent` | HomeSynapse.Automation | `int automationId`, `int runStatus`, `int durationMs`, `int pendingCommands` | Automation Engine |
| `IntegrationMetricEvent` | HomeSynapse.Integration | `int integrationId`, `int healthState`, `int healthScore`, `int errorRate`, `int restartCount` | Integration Runtime |
| `ApiRequestEvent` | HomeSynapse.Api | `int method`, `int pathTemplate`, `int statusCode`, `int durationMs` | REST API |
| `WebSocketMetricEvent` | HomeSynapse.WebSocket | `int activeConnections`, `int relayLag`, `int eventsDelivered`, `int backpressureStage` | WebSocket API |
| `ConfigMetricEvent` | HomeSynapse.Config | `int loadDurationMs`, `int validationIssues`, `int secretCount` | Configuration System |
| `HealthTransitionEvent` | HomeSynapse.Health | `int subsystemId`, `int previousStatus`, `int newStatus`, `long durationInPreviousMs` | HealthAggregator |
| `TraceQueryEvent` | HomeSynapse.Trace | `int queryType`, `int resultCount`, `int queryLatencyUs` | TraceQueryService |
| `LogLevelChangeEvent` | HomeSynapse.Logging | `String loggerName`, `int previousLevel`, `int newLevel` | LogLevelController |

Integer-encoded discriminators (e.g., `int metricType` instead of `MetricType` enum) use a mapping defined in the event registry. The mapping is documented in code and configuration. This avoids the JFR enum-silently-ignored problem while maintaining type safety at the application level through the registry.

For high-cardinality device metrics (50 devices × 12 metric types), the single `DeviceMetricEvent` with `int deviceId` and `int metricType` discriminators produces one JFR event class instead of 600. Small positive integer values (0–50 for deviceId, 0–12 for metricType) compress to 1 byte each via JFR's unsigned LEB128 varint encoding. A typical `DeviceMetricEvent` costs 19–24 bytes per event.

---

## 5. Contracts and Invariants

**Health evaluation is deterministic and reproducible (INV-TO-02).** Given the same set of per-subsystem health states, the HealthAggregator produces the same system health result. Tier assignments, composition rules, and dwell times are configuration, not runtime state. The only temporal dependency is the dwell timer, which is clock-based and deterministic given the same clock input.

**Trace queries return gapless chains (INV-ES-06).** The single-writer guarantee of the EventStore (Doc 01 §5, Doc 04 §5) ensures that all events sharing a correlation_id are in the same database with no replication lag. A query by correlation_id returns every event in the chain. The only exception is retention-purged events — in that case, TraceCompleteness reports `PossiblyIncomplete` with the reason.

**JFR overhead is bounded (INV-PR-03).** The continuous recording consumes at most 256 MB of disk (maxsize), approximately 25 MB of native memory outside the heap (global buffers + metadata + active chunk), and less than 5% of one CPU core for the Event Streaming bridge at 600 events/sec. These bounds are configuration-enforced and do not grow with device count or event volume.

**No observability operation blocks the event write path (INV-PR-02).** JFR `event.commit()` writes to thread-local buffers in a lock-free path. Health indicator reads are non-blocking. Trace queries read from the EventStore through the same read interface as any other consumer — they do not acquire the single-writer lock. The MetricsStreamBridge reads from the JFR disk repository via RecordingStream, which operates in its own thread.

**Health state transitions are logged as events (INV-TO-04).** Every transition of system health or subsystem health produces a structured log entry and a `HealthTransitionEvent` JFR event. This enables the "why did the system degrade at 3 AM?" query through standard log search or JFR analysis.

**Dynamic log level changes do not affect system stability (INV-PR-03).** Setting a package to DEBUG increases log volume for that package only. Log rotation (LTD-15: daily, 50 MB max per file, 500 MB total cap) bounds disk impact regardless of log level. The LogLevelController validates that the target logger name corresponds to a known HomeSynapse package and rejects arbitrary logger names.

---

## 6. Failure Modes and Recovery

### 6.1 JFR Repository Disk Full

**Trigger:** NVMe partition containing the JFR repository reaches capacity. This could occur if other processes fill the disk, since JFR's `maxsize` only caps its own footprint.

**Impact:** JFR stops writing new chunks. Existing chunks remain readable. Metric streaming via RecordingStream stops receiving new data. Per-subsystem JFR `event.commit()` calls silently discard events (JFR does not throw exceptions on write failure).

**Recovery:** JFR resumes writing when disk space becomes available. No manual intervention required for JFR itself. The MetricsStreamBridge detects stale data (no `onFlush()` callback for longer than the configured threshold) and reports the MetricsInfrastructure health as DEGRADED. The Persistence Layer's storage pressure mechanism (Doc 04 §6) may trigger retention or cleanup actions that free disk space.

**Event produced:** `HealthTransitionEvent` with subsystem = observability, status = DEGRADED, reason = "JFR recording stalled: no flush in {n} seconds".

### 6.2 Health Indicator Source Unavailable

**Trigger:** A subsystem fails to report health within its expected reporting interval. This can occur if the subsystem has crashed, is deadlocked, or its health reporting thread is starved.

**Impact:** The HealthAggregator cannot determine the subsystem's current state. Using the last-known state would mask failures; reporting UNHEALTHY on silence would cause false alarms during startup.

**Recovery:** During STARTING lifecycle state, the subsystem is assumed to be initializing and is excluded from aggregation (grace period). During RUNNING, if a subsystem has not reported health for longer than twice its expected interval, the HealthAggregator marks it as UNHEALTHY with reason "health report timeout". The subsystem can recover by reporting again — the HealthAggregator immediately processes the new report.

**Event produced:** `HealthTransitionEvent` with reason = "health report timeout after {n}ms".

### 6.3 Trace Query for Retention-Purged Events

**Trigger:** A user queries a causal chain whose events have been partially or fully removed by the Persistence Layer's retention policy (Doc 04 §3).

**Impact:** The TraceQueryService returns a partial chain. Events that still exist are returned correctly; gaps are detectable because causation_id references point to nonexistent events.

**Recovery:** No recovery is possible for purged data. The TraceChain result reports `TraceCompleteness.PossiblyIncomplete(reason = "retention purged: {n} events missing")`. The chain is still useful — it shows the events that remain, and the gap positions indicate where data was lost.

**Event produced:** `TraceQueryEvent` with queryType = PARTIAL_RESULT.

### 6.4 Event Streaming Bridge Consumer Falls Behind

**Trigger:** The WebSocket push thread or REST polling endpoint cannot consume aggregated metric snapshots as fast as `onFlush()` produces them. This can occur under sustained high event volume or when multiple WebSocket clients request high-frequency updates.

**Impact:** The Event Streaming API has no explicit backpressure mechanism. If the RecordingStream's consumer callback is slower than the producer, old JFR chunks may be deleted by `maxage`/`maxsize` before being fully read, causing silent data loss in the streaming path. The continuous recording itself is unaffected — the data exists in the JFR repository for offline analysis.

**Recovery:** The MetricsStreamBridge uses a bounded internal queue (capacity: 60 snapshots, representing ~60 seconds of data at 1 snapshot/sec). If the queue is full, the bridge drops the oldest snapshot and increments a `bridge_snapshots_dropped` counter. This is a lossy but bounded degradation — the real-time metrics stream may show gaps, but it cannot consume unbounded memory.

**Event produced:** Structured log at WARN: `observability.stream_bridge.snapshot_dropped` with `queue_depth`, `dropped_count`.

### 6.5 Trace Index Corruption

**Trigger:** SQLite index corruption on the trace-related indexes (§3.4), potentially caused by storage hardware failure or unclean shutdown during index write.

**Impact:** Trace queries may return incorrect or incomplete results, or fail with SQL errors. The underlying event data is unaffected if the main events table is intact.

**Recovery:** SQLite's `REINDEX` command rebuilds indexes from the table data. The TraceQueryService detects query failures, logs the error, and exposes a maintenance operation to trigger index rebuild. During rebuild, trace queries return an error response rather than incorrect data.

**Event produced:** Structured log at ERROR: `observability.trace.index_error` with `index_name`, `error_detail`.

---

## 7. Interaction with Other Subsystems

This subsystem has the densest interaction map in the project — it touches all 10 preceding subsystems. The interactions are organized by direction and mechanism.

### 7.1 Health Reporting (Receives From All Subsystems)

Every subsystem implements the `HealthContributor` interface (§8) and reports health state transitions to the HealthAggregator. The mechanism is direct method call — each subsystem holds a reference to its own `HealthContributor` callback and invokes it when its health state changes. The HealthAggregator processes these reports synchronously (O(1) per report) and updates the aggregated view.

| Subsystem | Health States | Grace Period |
|---|---|---|
| Event Bus (Doc 01) | HEALTHY / DEGRADED / CRITICAL | 10s |
| Device Model (Doc 02) | HEALTHY / DEGRADED / UNHEALTHY | 15s |
| State Store (Doc 03) | HEALTHY / STARTING / DEGRADED / UNHEALTHY | 60s (replay) |
| Persistence (Doc 04) | HEALTHY / DEGRADED / UNHEALTHY (composite) | 15s |
| Integration Runtime (Doc 05) | HEALTHY / DEGRADED / UNHEALTHY (composite) | 30s |
| Configuration (Doc 06) | HEALTHY / DEGRADED / UNHEALTHY | 10s |
| Automation Engine (Doc 07) | HEALTHY / DEGRADED / UNHEALTHY | 15s |
| REST API (Doc 09) | HEALTHY / DEGRADED / UNHEALTHY | 10s |
| WebSocket API (Doc 10) | HEALTHY / DEGRADED / UNHEALTHY | 10s |
| Observability (Doc 11, self) | HEALTHY / DEGRADED / UNHEALTHY | 10s |

The Zigbee Adapter (Doc 08) reports through the Integration Runtime's per-integration health model (Doc 05 §11.3). It does not appear as a separate row in this table — its health contributes to the Integration Runtime's composite indicator.

Note: Doc 01's "CRITICAL" health state maps to UNHEALTHY in the HealthAggregator's three-state model. The mapping is: CRITICAL → UNHEALTHY.

### 7.2 JFR Event Emission (Receives From All Subsystems)

Each subsystem emits JFR events using the custom event types defined in §4.3. The emission is a direct `event.commit()` call — no intermediary. The JFR runtime manages thread-local buffers and disk flushing transparently. The MetricsInfrastructure component does not receive these events through an application-level interface; it reads them from the JFR disk repository via RecordingStream.

### 7.3 Structured Log Production (Receives From All Subsystems)

All subsystems produce structured JSON log events through SLF4J (LTD-15). Log events carry mandatory fields (`correlation_id`, `entity_id`, `integration_id` in MDC per LTD-15). The Observability subsystem owns the Logback configuration and the LogLevelController interface that adjusts per-package log levels at runtime.

### 7.4 Trace Data Source (Reads From Event Bus / EventStore)

The TraceQueryService reads from the EventStore interface (Doc 01 §8.1) to assemble causal chains. It uses the five indexes described in §3.4 (managed by the Persistence Layer, Doc 04). The query path is read-only — the TraceQueryService never writes to the EventStore.

### 7.5 Real-Time Metrics Push (Pushes To WebSocket API)

The MetricsStreamBridge pushes aggregated metric snapshots to the WebSocket API (Doc 10) for real-time dashboard delivery. The mechanism is an internal interface — the bridge enqueues snapshots; the WebSocket relay delivers them to subscribed clients. This is the primary path for the Web UI's real-time metrics display (Doc 13).

### 7.6 Health and Trace REST Endpoints (Called By REST API)

The REST API (Doc 09) exposes health and trace data through authenticated endpoints. It calls the HealthAggregator for system health queries and the TraceQueryService for causal chain queries. The Observability subsystem provides the data; the REST API handles HTTP transport, authentication, and response formatting.

### 7.7 Startup Coordination (Called By Startup/Lifecycle)

The Startup/Lifecycle subsystem (Doc 12) queries the HealthAggregator during startup sequencing to determine when each subsystem has reached a ready state. The HealthAggregator's lifecycle state machine (§3.3) supports this by distinguishing startup grace periods from steady-state health reporting.

---

## 8. Key Interfaces

### 8.1 Interfaces

| Interface | Responsibility |
|---|---|
| `HealthAggregator` | Compose per-subsystem health into system health; query current and historical health state |
| `HealthContributor` | Callback interface each subsystem implements to report health state changes |
| `TraceQueryService` | Assemble and query causal chains by correlation_id, entity, event type, or time range |
| `MetricsRegistry` | Register custom JFR event types; validate field types; provide event type metadata |
| `MetricsStreamBridge` | Read JFR events via RecordingStream, aggregate, and push to WebSocket/REST consumers |
| `LogLevelController` | Query and adjust per-package SLF4J/Logback log levels at runtime |

### 8.2 Key Methods

**HealthAggregator:**
- `getSystemHealth()` — returns the current `SystemHealth` snapshot including tier breakdown and per-subsystem detail
- `getSubsystemHealth(subsystemId)` — returns health for a specific subsystem
- `onHealthChange(subsystemId, status, reason)` — called by HealthContributor when a subsystem's health changes
- `getHealthHistory(since, until)` — returns health state transitions in the given time range (reads from health transition log)

**HealthContributor:**
- `reportHealth(status, reason)` — subsystem calls this to report its current health state. The HealthAggregator processes the report and updates the aggregated view.
- `getSubsystemId()` — returns the subsystem's identifier for tier classification

**TraceQueryService:**
- `getChain(correlationId)` — assemble the full causal chain for a correlation_id
- `findRecentChain(entityId)` — reverse lookup: find the most recent causal chain affecting an entity
- `findChains(entityId, from, until)` — chains involving an entity in a time range
- `findChainsByType(eventType, from, until)` — chains containing a specific event type
- `findChainsByTimeRange(from, until, limit)` — all chains in a time range

**MetricsStreamBridge:**
- `start()` — begin streaming from JFR recording; register onEvent/onFlush callbacks
- `stop()` — stop streaming; release RecordingStream resources
- `getLatestSnapshot()` — return the most recent aggregated metric snapshot (for REST polling)
- `subscribe(consumer)` — register a push consumer for real-time metric snapshots (for WebSocket relay)

**LogLevelController:**
- `getLevel(loggerName)` — return current effective log level for a logger
- `setLevel(loggerName, level)` — set log level; validates against known package prefixes
- `resetLevel(loggerName)` — restore logger to its configured default level
- `listOverrides()` — return all currently active dynamic log level overrides

### 8.3 Key Types

| Type | Kind | Responsibility |
|---|---|---|
| `SystemHealth` | Record | Complete system health snapshot with tiers and subsystems |
| `SubsystemHealth` | Record | Individual subsystem health with tier, status, reason, duration |
| `TierHealth` | Record | Per-tier health summary |
| `HealthStatus` | Enum | HEALTHY, DEGRADED, UNHEALTHY |
| `HealthTier` | Enum | CRITICAL_INFRASTRUCTURE, CORE_SERVICES, INTERFACE_SERVICES |
| `LifecycleState` | Enum | STARTING, RUNNING, SHUTTING_DOWN |
| `TraceChain` | Record | Complete causal chain with tree structure and completeness |
| `TraceEvent` | Record | Single event within a chain |
| `TraceNode` | Record | Tree node wrapping a TraceEvent with children |
| `TraceCompleteness` | Sealed interface | Complete, InProgress, or PossiblyIncomplete |
| `MetricSnapshot` | Record | Aggregated metric values for one flush window |
| `LogLevelOverride` | Record | Active dynamic log level override with timestamp |

---

## 9. Configuration

All observability configuration lives under the `observability` key in the HomeSynapse configuration file. Every option has a sensible default — HomeSynapse runs correctly with zero observability configuration.

```yaml
observability:
  jfr:
    enabled: true                    # boolean, default: true
                                     # Enable JFR continuous recording.
                                     # Disable only for debugging JFR
                                     # itself. Disabling loses all
                                     # JFR-based metrics.

    repository: "/var/homesynapse/jfr"
                                     # string (path), default: platform-
                                     # dependent data dir + "/jfr"
                                     # Must be on NVMe. Never tmpfs.

    max_size_mb: 256                 # int, range: 64–1024, default: 256
                                     # Maximum disk footprint for JFR
                                     # recordings. At 600 events/sec with
                                     # ~22 bytes/event, 256 MB holds ~5–6
                                     # hours. Larger values extend the
                                     # diagnostic window at disk cost.

    max_age_minutes: 360             # int, range: 30–1440, default: 360
                                     # Maximum age of JFR data. 360
                                     # minutes = 6 hours. Binding
                                     # constraint in most scenarios.

    max_chunk_size_mb: 4             # int, range: 1–12, default: 4
                                     # Smaller chunks improve age
                                     # rotation precision and Event
                                     # Streaming latency. Default 4 MB
                                     # reduces latency vs JFR's 12 MB
                                     # default at negligible write
                                     # overhead cost.

  health:
    startup_max_duration_seconds: 120
                                     # int, range: 30–300, default: 120
                                     # Maximum time in STARTING state.
                                     # After this, system transitions to
                                     # RUNNING regardless of subsystem
                                     # health. Subsystems still in grace
                                     # period are marked UNHEALTHY.

    dwell_time_seconds: 10           # int, range: 5–60, default: 10
                                     # Minimum time in DEGRADED before
                                     # aggregate can transition to
                                     # HEALTHY. Prevents flapping.
                                     # Transitions to UNHEALTHY are
                                     # always immediate.

    grace_periods:                   # Per-subsystem startup grace
                                     # periods in seconds.
      event_bus: 10                  # int, range: 5–60, default: 10
      device_model: 15               # int, range: 5–60, default: 15
      state_store: 60                # int, range: 10–180, default: 60
      persistence: 15                # int, range: 5–60, default: 15
      integration_runtime: 30        # int, range: 10–120, default: 30
      configuration: 10              # int, range: 5–30, default: 10
      automation_engine: 15          # int, range: 5–60, default: 15
      rest_api: 10                   # int, range: 5–30, default: 10
      websocket_api: 10              # int, range: 5–30, default: 10

  trace:
    max_chain_depth: 50              # int, range: 10–200, default: 50
                                     # Maximum events returned per chain
                                     # query. Chains deeper than this are
                                     # truncated with a warning. Prevents
                                     # runaway queries from recursive
                                     # automations.

    max_results: 100                 # int, range: 10–1000, default: 100
                                     # Maximum chains returned per
                                     # time-range or entity query.

    incomplete_warning_seconds: 30   # int, range: 10–120, default: 30
                                     # In-progress chains older than this
                                     # show a warning indicator.

    incomplete_failure_seconds: 300  # int, range: 60–600, default: 300
                                     # In-progress chains older than this
                                     # show a potential failure indicator.

  stream_bridge:
    queue_capacity: 60               # int, range: 10–300, default: 60
                                     # Bounded queue between onFlush()
                                     # and WebSocket push. Each entry is
                                     # one aggregated snapshot (~2 KB).

    flush_interval_seconds: 1        # int, range: 1–10, default: 1
                                     # Target interval for metric
                                     # snapshot push. Actual interval
                                     # depends on JFR chunk flush timing.

  logging:
    dynamic_level_allowed_prefixes:
      - "com.homesynapse"            # string[], default: ["com.homesynapse"]
                                     # Package prefixes for which dynamic
                                     # log level changes are permitted.
                                     # Prevents changing log levels for
                                     # framework or library loggers.
```

---

## 10. Performance Targets

All targets are specified for the Pi 5 primary deployment target (LTD-02) with Pi 4 as the validation floor. Targets follow INV-PR-02: quantitative, with units, testable, and justified.

| Metric | Pi 5 Target | Pi 4 Floor | Rationale |
|---|---|---|---|
| Trace query by correlation_id (p99) | < 2 ms | < 5 ms | Must feel instant when clicking an event in the UI. At ~7 events per chain and NVMe index scan, this is achievable. |
| Trace reverse lookup (p99) | < 3 ms | < 8 ms | The "why did this happen?" query is the primary diagnostic operation. Covering index on `(entity_id, event_type, timestamp DESC)` makes this an index-only scan plus one chain assembly. |
| Health aggregation evaluation | < 1 ms | < 2 ms | O(10) composition with no I/O. Must not add perceptible latency to health endpoint responses. |
| JFR continuous recording CPU overhead | < 3% one core | < 5% one core | Per JFR analysis, 600 events/sec with ~22 bytes/event produces ~13 KB/sec disk write. JFR's lock-free thread-local buffer design keeps CPU overhead minimal. |
| MetricsStreamBridge latency (JFR commit to WebSocket frame) | < 2 s | < 3 s | RecordingStream reads from disk repo with ~1 second JFR flush latency plus bridge processing. Real-time dashboard updates within 2 seconds are acceptable for monitoring. |
| JFR disk footprint | ≤ 256 MB | ≤ 256 MB | Configured via `maxsize`. Does not grow with device count or event volume. |
| JFR native memory overhead | ≤ 25 MB | ≤ 25 MB | Global buffers + metadata + active chunk. Outside the 1536 MB heap (LTD-01). |
| Health state transition logging | < 0.5 ms | < 1 ms | Single structured log write plus JFR event commit. Must not delay the health state update. |
| Dynamic log level change | < 5 ms | < 10 ms | Logback LoggerContext update is synchronous but fast. Must be near-instant from the user's perspective. |

---

## 11. Observability

The observability subsystem itself requires observability — it must be possible to diagnose problems in the diagnostic infrastructure.

### 11.1 Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `hs.observability.jfr.recording_active` | Gauge | — | 1 if JFR continuous recording is active, 0 otherwise. |
| `hs.observability.jfr.repository_size_bytes` | Gauge | — | Current disk usage of the JFR repository directory. |
| `hs.observability.jfr.chunks_rotated_total` | Counter | — | Total JFR chunks rotated (deleted by maxsize/maxage). |
| `hs.observability.health.evaluations_total` | Counter | — | Total health aggregation evaluations performed. |
| `hs.observability.health.evaluation_latency_us` | Histogram | — | Health aggregation evaluation duration. |
| `hs.observability.health.transitions_total` | Counter | `subsystem_id`, `to_status` | Health state transitions by subsystem and target status. |
| `hs.observability.trace.queries_total` | Counter | `query_type` | Trace query count by type (correlation_id, reverse, entity, type, time_range). |
| `hs.observability.trace.query_latency_us` | Histogram | `query_type` | Trace query duration by type. |
| `hs.observability.trace.incomplete_chains` | Gauge | — | Number of currently in-progress (non-terminal) chains accessed in the last 5 minutes. |
| `hs.observability.stream.snapshots_pushed_total` | Counter | — | Total metric snapshots pushed to consumers. |
| `hs.observability.stream.snapshots_dropped_total` | Counter | — | Total snapshots dropped due to full queue. |
| `hs.observability.stream.consumer_count` | Gauge | — | Number of active metric stream consumers. |
| `hs.observability.logging.level_overrides_active` | Gauge | — | Number of active dynamic log level overrides. |

### 11.2 Structured Logging

| Log Event | Level | Key Fields | Description |
|---|---|---|---|
| `observability.started` | INFO | `jfr_enabled`, `jfr_maxsize_mb`, `jfr_maxage_min`, `subsystem_count` | Observability subsystem initialization complete. |
| `observability.health.transition` | INFO (HEALTHY), WARN (DEGRADED), ERROR (UNHEALTHY) | `subsystem_id`, `previous_status`, `new_status`, `reason`, `duration_in_previous_ms` | Any health state transition. |
| `observability.health.system_transition` | INFO / WARN / ERROR | `previous_status`, `new_status`, `reason`, `tier_summary` | System-wide health state transition. |
| `observability.health.grace_expired` | WARN | `subsystem_id`, `grace_period_seconds`, `final_status` | Subsystem startup grace period expired without reaching HEALTHY. |
| `observability.jfr.recording_stalled` | WARN | `last_flush_seconds_ago` | JFR recording has not flushed recently (possible disk issue). |
| `observability.stream.snapshot_dropped` | WARN | `queue_depth`, `dropped_count` | Metric snapshot dropped due to full consumer queue. |
| `observability.trace.partial_result` | DEBUG | `correlation_id`, `expected_events`, `found_events`, `reason` | Trace query returned incomplete chain. |
| `observability.logging.level_changed` | INFO | `logger_name`, `previous_level`, `new_level`, `actor` | Dynamic log level change. |
| `observability.logging.level_reset` | INFO | `logger_name`, `restored_level` | Log level restored to default. |

### 11.3 Health Indicator

The Observability subsystem itself reports health to the HealthAggregator. It is classified as a Tier 2 (Core Services) subsystem — degraded observability does not prevent the system from functioning, but it limits diagnostic capability.

| State | Condition |
|---|---|
| **HEALTHY** | JFR recording active and flushing. HealthAggregator receiving reports from all registered subsystems. MetricsStreamBridge producing snapshots. TraceQueryService responding to queries. |
| **DEGRADED** | JFR recording stalled (no flush in 30 seconds). OR MetricsStreamBridge dropping snapshots (queue full). OR one or more subsystems not reporting health (timeout). |
| **UNHEALTHY** | JFR recording failed to start. OR HealthAggregator cannot evaluate (internal error). OR TraceQueryService queries consistently failing (index corruption). |

---

## 12. Security Considerations

Health and trace data contains behavioral patterns that reveal occupancy and activity schedules. Trace chains show when automations fire, which devices are active, and at what times — information that can disclose when residents are home, asleep, or away. This data warrants the same access control as device state data.

All REST endpoints that expose health, trace, or metrics data require authentication per INV-SE-02. The REST API (Doc 09) and WebSocket API (Doc 10) enforce this — the Observability subsystem does not implement its own authentication layer. Health data served at `GET /api/v1/system/health` requires a valid API key. Unauthenticated health probes from the network are not supported; external liveness monitoring uses the systemd `sd_notify` watchdog (LTD-13), which operates outside the HTTP stack.

Dynamic log level changes are a privileged operation. Setting a subsystem to DEBUG can produce verbose output that includes device identifiers, event payloads, and integration credentials in log files. The LogLevelController restricts changes to authenticated API requests and validates that target logger names fall within the configured allowed prefixes (§9). Log level changes are themselves logged (§11.2) for audit.

The `event_category` field on events processed by the TraceQueryService follows the three-priority-tier model defined in Doc 01 §4.3. DIAGNOSTIC-priority events may contain more detailed payloads than NORMAL events. The TraceQueryService does not filter based on event category — all events with matching correlation_id are returned. Access control is at the API boundary (Doc 09, Doc 10), not within the query service.

---

## 13. Testing Strategy

### 13.1 Unit Tests

**Health aggregation composition.** Test the tiered composition algorithm with every meaningful combination of subsystem states. Key scenarios: all HEALTHY → system HEALTHY; single Tier 1 DEGRADED → system DEGRADED; single Tier 2 DEGRADED → system HEALTHY (below threshold); two Tier 2 DEGRADED → system DEGRADED; single Tier 1 UNHEALTHY → system UNHEALTHY; all Tier 3 UNHEALTHY → system DEGRADED; mixed states across tiers → worst-of rule applies.

**Flapping prevention.** Verify that DEGRADED → HEALTHY transitions respect the dwell time. Verify that DEGRADED → UNHEALTHY transitions are immediate regardless of dwell time. Verify that rapid oscillation (DEGRADED → HEALTHY → DEGRADED within dwell time) does not produce a HEALTHY report.

**Startup grace periods.** Verify that subsystems in grace period are excluded from aggregation. Verify that grace period expiration transitions subsystem to effective UNHEALTHY if still not HEALTHY. Verify that the lifecycle FSM transitions from STARTING to RUNNING after max startup duration.

**Trace chain assembly.** Given a set of events sharing a correlation_id, verify that the tree structure is correct: root event identified, parent-child relationships match causation_id references, ordering is by timestamp. Verify with chains of depth 1, 3, 7, and the configured max_chain_depth.

**Trace completeness detection.** Verify that chains ending with terminal event types report Complete. Verify that chains without terminal events report InProgress with correct elapsed duration. Verify that chains with missing events (gaps in causation_id references) report PossiblyIncomplete.

**Reverse lookup.** Given multiple chains affecting the same entity, verify that `findRecentChain` returns the most recent. Verify correct behavior when the entity has no chains.

### 13.2 Integration Tests

**Health reporting pipeline.** Start multiple subsystems, have each report health state changes, verify that the HealthAggregator produces correct system health. Verify that the REST API `/system/health` endpoint returns the aggregated result.

**Trace query through EventStore.** Write a realistic causal chain (motion → automation → command → confirmation) to the EventStore, then query it through the TraceQueryService. Verify all five query patterns return correct results.

**MetricsStreamBridge end-to-end.** Start JFR recording, emit custom JFR events, verify that the MetricsStreamBridge produces aggregated snapshots within the latency target. Verify that a WebSocket subscriber receives the snapshots.

**Dynamic log level change.** Change a log level through the REST API. Verify that subsequent log output reflects the new level. Verify that the change is logged. Verify that resetting the level restores the default.

### 13.3 Performance Tests

**Trace query latency.** Benchmark correlation_id lookup and reverse lookup against a database with 100,000+ events (simulating ~6 months of operation). Verify p99 meets §10 targets on Pi 4.

**Health aggregation throughput.** Simulate rapid health state changes from all 10 subsystems concurrently. Verify that aggregation evaluation latency remains below 2 ms on Pi 4.

**JFR overhead measurement.** Run the system under sustained load (600 events/sec) with JFR continuous recording active. Measure CPU overhead attributed to JFR using the JFR recording's own CPU profiling data. Verify overhead is below 5% of one core on Pi 4.

**MetricsStreamBridge latency.** Measure end-to-end time from JFR event commit to WebSocket frame delivery. Verify p99 < 3 seconds on Pi 4.

### 13.4 Failure Tests

**JFR disk full.** Fill the JFR repository partition to capacity. Verify that the system continues operating. Verify that MetricsInfrastructure reports DEGRADED. Verify that JFR resumes when space is freed.

**Health reporter timeout.** Stop a subsystem's health reporting. Verify that the HealthAggregator marks it as UNHEALTHY after the timeout period. Verify that the system health degrades according to the subsystem's tier.

**Trace index corruption simulation.** Corrupt a trace-related SQLite index. Verify that the TraceQueryService detects the corruption, logs the error, and fails gracefully rather than returning incorrect data. Verify that `REINDEX` restores correct operation.

**MetricsStreamBridge overflow.** Block the consumer thread. Verify that the bridge drops oldest snapshots when the queue is full. Verify the dropped count is tracked. Verify that the bridge resumes normal operation when the consumer is unblocked.

---

## 14. Future Considerations

**Prometheus and OpenTelemetry export.** LTD-15 explicitly defers Prometheus and OTEL to post-MVP. The architecture accommodates this: a Micrometer facade can wrap the existing JFR event types and structured log events, exposing them as Prometheus metrics via an HTTP scrape endpoint and OTEL spans via the OTLP exporter. The MetricsStreamBridge's aggregation logic already produces the metric snapshots that Micrometer would expose. The key design accommodation is that all metric data originates from JFR events and structured logs — adding an export format is a presentation concern, not a data collection change.

**Remote log shipping.** Shipping structured JSON logs to a remote aggregation service (Loki, Elasticsearch, Splunk) requires only a Logback appender change. The structured JSON format with correlation_id, entity_id, and integration_id fields is already compatible with these systems. No application code change is required. The deferral is justified because the MVP target audience does not have log aggregation infrastructure.

**Alerting and notification system.** Health state transitions could trigger notifications (push notification, email, webhook). The HealthAggregator already produces structured health transition events — an alerting system would subscribe to these events and apply user-configured notification rules. Deferred because notification delivery (push services, email SMTP) requires cloud connectivity, which contradicts the local-first MVP scope.

**Historical health timeline.** Currently, health state transitions are logged but not queryable as a time series. A future enhancement could store transitions in SQLite and expose a "system health over the last 30 days" view. The HealthTransitionEvent JFR events and structured log entries already contain the data — the enhancement is a storage and query concern.

**Negative trace implementation.** The "why didn't this automation fire?" question is unsolved across all platforms per competitive research. A future implementation could emit DIAGNOSTIC-priority events for trigger evaluations that do not result in execution, enabling queries like "show all triggers for automation X that were evaluated but did not fire in the last 24 hours." The event model's three-priority-tier system (Doc 01 §4.3) already supports this — DIAGNOSTIC events have shorter retention and can be enabled per-automation. The design decision (always-on vs. on-demand) is captured as an open question (§15).

**Multi-instance health aggregation.** If HomeSynapse supports multi-hub deployments in the future, the HealthAggregator would need to compose health across instances. The current design's tiered model is instance-local. Multi-instance aggregation would require a cross-instance health reporting protocol and a hierarchy of aggregators. The current single-instance design does not preclude this — the HealthContributor interface could be implemented by a remote health proxy.

---

## 15. Open Questions

1. **Should negative traces be always-on or on-demand?**
   Options: (a) Always emit DIAGNOSTIC-priority events for every trigger evaluation that does not fire — provides complete diagnostic data but increases event volume by an estimated 5–10× for busy automations. (b) On-demand: enable per-automation "debug mode" that activates DIAGNOSTIC event emission for that automation only. (c) Hybrid: always log the trigger evaluation result (1 event per evaluation), but only emit the full condition detail (which conditions passed/failed) in debug mode.
   Needed: Empirical measurement of DIAGNOSTIC event volume under realistic automation load (20 automations, 50 devices) on Pi 5.
   Status: **[NON-BLOCKING]** — the current design supports all three options. The event model's DIAGNOSTIC priority tier (Doc 01 §4.3) and shorter retention policy handle the storage impact. The decision affects trace query completeness for "why didn't X fire?" but does not affect the architecture of the trace query service.

2. **Should the Automation Engine be classified as Tier 1 or Tier 2?**
   Options: (a) Tier 1 (Critical Infrastructure): automation failure → system DEGRADED immediately. This reflects the view that automations are the primary value of a smart home platform. (b) Tier 2 (Core Services): automation failure is significant but the system still provides manual device control, state observation, and event recording. This is the current assignment.
   Needed: Product-level decision about what "the system works" means — is a smart home without working automations DEGRADED or UNHEALTHY?
   Status: **[NON-BLOCKING]** — the current design assigns Automation Engine to Tier 2 (D-03), which is valid regardless of resolution. If the answer is Tier 1, the change is a configuration update to the tier assignment table (§3.3) with no architectural impact. The question is recorded for explicit product-level confirmation.

3. **What are the empirically correct startup grace period durations?**
   Options: The proposed defaults (§9) are engineering estimates: State Store 60s, Integration Runtime 30s, others 10–15s. Actual replay and initialization times depend on event log size, device count, and hardware.
   Needed: Empirical measurement on Pi 5 and Pi 4 with realistic data (1 year of event history, 50 devices). Specifically: how long does State Store event replay take? How long does the Integration Runtime take to initialize all integrations?
   Status: **[NON-BLOCKING]** — the grace period values are configuration with documented ranges (§9). The defaults can be adjusted without architectural change. If the defaults are significantly wrong (e.g., State Store needs 5 minutes), the maximum startup duration configuration covers this.

4. **What is the JFR Event Streaming backpressure strategy when the bridge cannot keep up?**
   Options: (a) Drop-oldest from bounded queue (current design in §6.4) — simple, bounded memory, lossy. (b) Buffer with bounded queue and degrade to polling when full — more complex but preserves data availability. (c) Reduce streaming frequency dynamically (e.g., aggregate over 5 seconds instead of 1 second when under pressure) — adaptive but harder to reason about.
   Needed: Load testing of the MetricsStreamBridge under sustained 2,000 events/sec with a slow WebSocket consumer.
   Status: **[NON-BLOCKING]** — the current drop-oldest design (§6.4) is functional and bounded. The question is whether a more sophisticated strategy provides meaningful benefit. The MetricsStreamBridge interface supports swapping the strategy without changing consumers.

5. **What aggregation granularity for warm/cold tier metric retention?**
   Options: (a) Minute-level rollups for 24 hours, then 5-minute rollups for 30 days. (b) 5-minute rollups only, for 30 days. (c) Defer aggregation entirely to post-MVP — JFR's 6-hour window covers immediate diagnostics, and structured logs provide long-term searchability.
   Needed: Determination of whether the Web UI (Doc 13) requires historical metric charts beyond JFR's 6-hour window for the MVP.
   Status: **[NON-BLOCKING]** — the MetricsStreamBridge produces snapshots that could be persisted to SQLite by a downstream aggregator. This is an additive feature that does not affect the core observability architecture.

6. **Should entity identifiers in JFR events use String or int with a mapping table?**
   Options: (a) `int deviceId` with a mapping table managed by MetricsInfrastructure — optimal for JFR varint encoding (1 byte for IDs 0–127) but requires lifecycle management for the mapping (persist across restarts, handle device addition/removal). (b) Short string identifiers (truncated entity slug, ~10 characters) — costs more per event (~10 bytes vs 1 byte) but avoids the mapping layer entirely. At 600 events/sec, the difference is ~5 KB/sec vs ~0.6 KB/sec.
   Needed: Assessment of whether the 4.4 KB/sec difference justifies the mapping table complexity. The mapping table must be consistent across restarts, which means either persisting it or regenerating it deterministically from the entity registry.
   Status: **[NON-BLOCKING]** — the current design uses `int` fields (§4.3) for optimal encoding. If the mapping table proves burdensome, switching to short strings requires only changing the JFR event field types and the streaming bridge's parsing logic. No downstream consumer change.

---

## 16. Summary of Key Decisions

| # | Decision | Choice | Rationale | Section |
|---|---|---|---|---|
| D-01 | JFR recording parameters | maxsize=256 MB, maxage=6h, maxchunksize=4 MB, NVMe only | Per JFR analysis: bounded disk at ~5–6 hours retention. 4 MB chunks improve age precision and streaming latency. NVMe required — tmpfs creates memory pressure on 4 GB system (INV-PR-01, INV-PR-03). | §3.2, §9 |
| D-02 | Health aggregation algorithm | Tiered composition (3 tiers, worst-of per tier, worst-of across tiers) | Per competitive research: tiered classification balances sensitivity and actionability for 10 subsystems. Pure worst-of is too sensitive; weighted average is hard to interpret; dependency-graph is disproportionate complexity at this scale (INV-TO-01). | §3.3 |
| D-03 | Health tier assignments | Tier 1: Event Bus, State Store, Persistence. Tier 2: Automation, Integration, Config, Device Model. Tier 3: REST API, WebSocket API | Tier 1 subsystems are existential — the platform cannot function without them. Tier 2 subsystems provide core value but the system is functional (reduced) without any single one. Tier 3 subsystems are presentation layer (INV-TO-01, INV-PR-01). | §3.3 |
| D-04 | Startup lifecycle handling | Three-state FSM (STARTING → RUNNING → SHUTTING_DOWN) with per-subsystem grace periods | Inspired by Kubernetes startupProbe pattern per competitive research. Prevents false UNHEALTHY signals during event replay and integration initialization (INV-PR-02). | §3.3, §9 |
| D-05 | Flapping prevention | 10-second dwell time on DEGRADED → HEALTHY at aggregate level; immediate transitions to UNHEALTHY | Individual subsystems implement their own hysteresis. Aggregate dwell time absorbs correlated oscillation. Immediate UNHEALTHY transitions are safety-critical (INV-TO-01, INV-PR-03). | §3.3 |
| D-06 | Trace assembly algorithm | Single SQL query + O(n) hash map tree build | Single-writer SQLite eliminates distributed tracing complexity. ~7 events per chain makes linear scan + hash map optimal. No pagination, streaming, or sampling needed at this scale (INV-ES-06). | §3.4 |
| D-07 | Primary diagnostic query | Reverse lookup: entity + state → most recent correlation_id → full chain | Per competitive research: "why did this happen?" is the universal gap. Covering index on `(entity_id, event_type, timestamp DESC)` makes this an index-only scan (INV-ES-06, INV-TO-01). | §3.4 |
| D-08 | JFR custom event cardinality | Single generic DeviceMetricEvent with int discriminators; 15–25 total custom event types | Per JFR analysis: separate classes per device/metric is untenable (600 classes). Int fields compress to 1 byte via varint. Budget respects constrained hardware (INV-PR-01, INV-PR-03, LTD-15). | §4.3 |
| D-09 | JFR field type constraint | Primitives and String only; no enums | JFR silently ignores enum fields — no compile error, no runtime error, just missing data. Int discriminators with application-level mapping provide type safety without JFR's limitation (LTD-15). | §4.3 |
| D-10 | MetricsStreamBridge backpressure | Bounded queue (60 entries), drop-oldest on overflow | JFR Event Streaming API has no built-in backpressure. Bounded queue prevents unbounded memory growth. Drop-oldest is lossy but predictable. Downstream consumers tolerate gaps (INV-PR-03). | §3.2, §6.4 |
| D-11 | Dynamic log level scope | Per-package, restricted to com.homesynapse.* prefixes | Inspired by openHAB's Karaf console but GUI-accessible. Prefix restriction prevents inadvertent framework log level changes. Changes are non-persistent (reset on restart) for safety (LTD-15, INV-TO-04). | §3.6, §8 |
| D-12 | JDK version floor | 21.0.6+ (not 21.0.0) | JFR string constant pool bug (JDK-8338389) affects string fields in custom events. Backported fix available in 21.0.6. This is a hard requirement, not a recommendation (LTD-01, LTD-15). | §3.2 |
| D-13 | Observability subsystem self-classification | Tier 2 (Core Services) | Degraded observability does not prevent the system from controlling devices or running automations. It limits diagnostic capability, which is significant but not existential (INV-TO-01). | §11.3 |
| D-14 | Completeness detection strategy | Terminal event types with elapsed-time thresholds | Single-writer model eliminates indexing delays. Terminal events provide positive completion signal. Time-based thresholds catch stuck chains without complex distributed completeness protocols (INV-ES-06). | §3.4 |

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It is governed by the Design Document Template and will be reviewed during architecture review.*
