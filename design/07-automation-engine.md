# HomeSynapse Core — Automation Engine

**Document type:** Subsystem design
**Status:** Locked
**Subsystem:** Automation Engine
**Dependencies:** Event Model & Event Bus (§3.4 subscription model, §3.7 processing modes, §3.8 pending command ledger, §4.3 event taxonomy, §8.3 EventPublisher), Device Model & Capability System (§3.8 command model, §3.10 ExpectationFactory, §8.1 DeviceRegistry, §8.1 EntityRegistry, §8.1 CommandValidator), State Store & State Projection (§3.1 state query interface, §8.1 StateQuery), Persistence Layer (§8.1 CheckpointStore), Integration Runtime (§3.8 IntegrationContext.CommandHandler), Configuration System (§3.2 SchemaRegistry, §3.3 reload pipeline, §7 well-known file paths, ConfigurationChangeListener callback), Identity and Addressing Model (§7 address resolution primitives, §7.2 resolution timing, §7.3 deduplication, §7.4 ordering, §7.5 eligibility failures), Glossary (§4 TCA vocabulary)
**Dependents:** REST API (automation CRUD, run trace queries, command status), WebSocket API (live run trace streaming), Observability & Debugging (automation metrics, trace viewer data), Startup, Lifecycle & Shutdown (automation subscriber lifecycle, processing mode transitions)
**Author:** HomeSynapse Core Architecture
**Date:** 2026-03-07

---

## 0. Purpose

The Automation Engine subsystem implements the Trigger-Condition-Action (TCA) model that transforms HomeSynapse from a passive device monitoring system into an active automation platform. It is the subsystem that answers the question "what should happen when X occurs?" — evaluating triggers against incoming events, checking conditions against current state, executing actions that issue commands to devices, and recording every step as an immutable event in the log.

This subsystem is the most design-complex component in the platform. It simultaneously consumes contracts from the Event Bus (as a subscriber), the Device Model (for entity resolution and capability validation), the State Store (for condition evaluation), the Configuration System (for automation definition loading), and the Identity Model (for address resolution). It also owns the full outbound command path — from action dispatch through protocol adapter delivery to state confirmation — resolving two previously-orphaned design gaps (the Command Dispatch Service and the Pending Command Ledger).

If this subsystem is designed poorly, the consequences are severe. An automation engine that silently drops triggers makes the platform unreliable. One that cannot explain its behavior makes debugging impossible. One that replays incorrectly corrupts state on recovery. One that issues commands without tracking confirmation leaves users unable to trust that their automations work. The design must satisfy INV-TO-02 (automation determinism), INV-ES-06 (every state change is explainable), and INV-LF-01 (core functionality without internet) while executing within the memory and latency constraints of a Raspberry Pi 5 with 4 GB RAM.

---

## 1. Design Principles

**P1 — Every execution step is an event.** A Run is not a transient computation that produces a final result. Every trigger evaluation, condition check, action dispatch, and outcome is recorded as an event in the log. This makes the automation engine fully observable, replayable, and debuggable without introducing a separate trace storage system. This is the subsystem-level expression of INV-ES-06 and INV-TO-01.

**P2 — Commands are tracked, not forgotten.** When an action issues a command, the engine does not assume success. The command enters the Pending Command Ledger and is tracked through dispatch, protocol acknowledgment, and state confirmation. This closes the intent-to-observation loop that every competitor leaves open (competitive research Q8). Silent command failure is the single most common reliability complaint across Home Assistant, OpenHAB, SmartThings, and Node-RED.

**P3 — Replay suppresses actuation, not evaluation.** During REPLAY processing mode, the automation engine must not re-issue commands to physical devices. But trigger matching and condition evaluation proceed against the replayed state to rebuild the engine's internal bookkeeping (active run tracking, automation health status). Run trace events already exist in the log from original processing and are not re-produced during replay.

**P4 — Deterministic execution order.** When multiple automations match the same triggering event, execution order is deterministic and documented: by user-assigned priority (descending), then by automation ULID (ascending, which is creation order). This satisfies INV-TO-02 and enables users to reason about conflicts without inspecting event bus internals.

**P5 — Configuration changes never disrupt running automations.** When `automations.yaml` is reloaded, in-progress Runs complete against their original automation definition. New definitions take effect only for subsequent trigger evaluations. This follows from the event-sourced principle: a Run's definition is captured at trigger time and persisted in the Run's trace events.

---

## 2. Scope and Boundaries

### 2.1 This Subsystem Owns

- The TCA execution model: trigger registration, trigger evaluation, condition checking, action dispatch, and Run lifecycle management.
- Automation definition loading, validation, and hot-reload coordination with the Configuration System.
- The selector vocabulary: the syntax users write in automation targets and conditions to reference entities.
- Concurrency mode enforcement (single, restart, queued, parallel) per automation.
- Run trace event production: the complete event lifecycle from `automation_triggered` through `automation_completed`.
- The Command Dispatch Service: routing `command_issued` events to the correct integration adapter.
- The Pending Command Ledger: tracking in-flight commands and correlating them with state confirmations.
- Trigger deduplication: ensuring each causal event produces at most one Run per automation.
- Conflict detection: producing diagnostic events when multiple automations target the same entity with contradictory commands within the same causal window.

### 2.2 This Subsystem Does Not Own

- Event persistence and delivery mechanics — owned by the **Event Model & Event Bus** (Doc 01). The automation engine is a subscriber; it does not implement the subscription machinery.
- Entity metadata, capability schemas, and attribute validation — owned by the **Device Model & Capability System** (Doc 02). The automation engine queries these at evaluation time but does not modify them.
- Current entity state — owned by the **State Store & State Projection** (Doc 03). Conditions read from the state query interface.
- Protocol-level command delivery — owned by **Integration Runtime** (Doc 05). The Command Dispatch Service hands commands to the adapter's `CommandHandler`; protocol delivery is the adapter's responsibility.
- YAML file watching and reload signaling — owned by the **Configuration System** (Doc 06). The automation engine receives validated configuration and reload notifications.
- Time-based trigger scheduling (cron, sunrise/sunset) — designed for in the schema (Tier 1) but implementation is deferred to Tier 2. The trigger type taxonomy includes `time` and `sun` types with defined schemas; the scheduler that evaluates them is not implemented in Tier 1.
- Scene activation — reserved for Tier 2+ per Glossary §4.6. The action type taxonomy includes `activate_scene` as a reserved type.

---

## 3. Architecture

### 3.1 Subsystem Position

The Automation Engine sits at the intersection of the event bus (input), the state store (query), the device model (validation), and the integration runtime (output). It is the only subsystem that both consumes and produces events as part of its core function — triggers consume events, actions produce them.

```
                    ┌─────────────────────────────────────────────────────┐
                    │                 Automation Engine                    │
                    │                                                     │
  Event Bus ────▶   │  ┌────────────┐    ┌────────────┐    ┌──────────┐  │
  (state_changed,   │  │  Trigger    │───▶│ Condition  │───▶│  Action  │  │
   availability_    │  │  Evaluator  │    │ Evaluator  │    │ Executor │  │
   changed, etc.)   │  └────────────┘    └────────────┘    └──────────┘  │
                    │        │                 │                  │       │
                    │        │ reads           │ reads            │       │
                    │        ▼                 ▼                  │       │
                    │  ┌────────────┐    ┌────────────┐          │       │
                    │  │ Automation │    │ State      │          │       │
                    │  │ Registry   │    │ Query      │          │       │
                    │  │ (in-mem)   │    │ (Doc 03)   │          │       │
                    │  └────────────┘    └────────────┘          │       │
                    │                                            │       │
                    │                                            ▼       │
                    │                              ┌─────────────────┐   │
                    │                              │ Command Pipeline │   │
                    │                              │                 │   │
                    │                              │ ┌─────────────┐ │   │
                    │                              │ │  Dispatch   │ │   │
                    │                              │ │  Service    │─┼───┼──▶ Integration
                    │                              │ └─────────────┘ │   │    Adapter
                    │                              │ ┌─────────────┐ │   │
                    │                              │ │  Pending    │ │   │
  Event Bus ◀────   │                              │ │  Command    │◀┼───┼── state_reported
  (automation_      │                              │ │  Ledger     │ │   │    command_result
   triggered,       │                              │ └─────────────┘ │   │
   command_issued,  │                              └─────────────────┘   │
   etc.)            │                                                     │
                    └─────────────────────────────────────────────────────┘
```

### 3.2 Event Subscription

The Automation Engine registers as a subscriber with the Event Bus using subscriber ID `automation_engine`. The subscription filter is:
```java
new SubscriptionFilter(
    Set.of(
        "state_changed",
        "availability_changed"
    ),
    EventPriority.NORMAL,      // NORMAL minimum — no raw state_reported
    "entity"                   // entity-subject events only
)
```

The engine subscribes to `state_changed` (not `state_reported`) because triggers react to confirmed state transitions, not raw sensor reports. This is consistent with **Event Model & Event Bus** §7 interaction table, which specifies the automation engine subscribes to `state_changed` and `availability_changed`.

The `NORMAL` minimum priority filter prevents the engine from being woken for DIAGNOSTIC events (raw `state_reported`, `command_dispatched`, `telemetry_summary`). The engine processes only events that represent confirmed state transitions or lifecycle changes.

**Automation definition reload notification.** The engine does not subscribe to `config_changed` events through the event bus. `config_changed` events carry a system subject, not an entity subject, and would be filtered out by the `"entity"` subject type filter. Instead, the engine registers a `ConfigurationChangeListener` callback with the Configuration System (Doc 06 §7) for the `automations.yaml` well-known file path. When the Configuration System detects a change and completes validation, it invokes the callback directly, which triggers the hot-reload procedure (§3.7, C7). This is simpler than a separate subscriber and avoids polluting the trigger evaluation loop with non-device events.

**Presence events are excluded from the Tier 1 subscription.** The `presence_changed` event type is not included in the subscription filter because presence triggers are a Tier 2 feature (§3.4). Including presence events in the filter would cause the engine to process events it has no trigger types to evaluate against. The filter will be expanded when presence triggers are implemented (see Open Question 2, §15).

The engine runs on a dedicated virtual thread (per LTD-01 / LTD-11) and uses the standard pull-based subscription model defined in **Event Model & Event Bus** §3.4: notification via `LockSupport.unpark()`, batch polling via `eventStore.readFrom()`, and checkpoint persistence after processing.

### 3.3 Automation Registry

The Automation Registry is an in-memory data structure that holds all loaded automation definitions. It is populated from `automations.yaml` at startup and updated on hot-reload.

Each automation definition contains:

- `automation_id` — ULID, assigned at first load, stable across reloads (per LTD-04).
- `slug` — Human-readable identifier derived from the automation's `name` field.
- `name` — User-facing display name.
- `description` — Optional user-facing description.
- `enabled` — Boolean. Disabled automations are loaded but do not evaluate triggers.
- `mode` — Concurrency mode: `single` (default), `restart`, `queued`, or `parallel`.
- `max_concurrent` — Maximum concurrent Runs for `queued` and `parallel` modes (default: 10).
- `max_exceeded_severity` — What to log when a trigger is dropped due to mode constraints: `silent`, `info` (default), or `warning`.
- `priority` — Integer, default 0. Higher values execute first when multiple automations match the same event. Range: -100 to 100.
- `triggers` — One or more trigger definitions.
- `conditions` — Zero or more condition definitions.
- `actions` — One or more action definitions.

The registry maintains an index from event type to the set of automations that have triggers matching that event type. This index enables O(1) lookup when an event arrives, avoiding a scan of all automation definitions. The index is rebuilt on hot-reload.

### 3.4 Trigger Evaluation

When the subscriber receives a batch of events, each event is evaluated against the trigger index.

**Trigger types (Tier 1):**

| Type | Matches When | Event Types Consumed |
|---|---|---|
| `state_change` | An entity's attribute transitions to a specified value, from a specified value, or between specified values. | `state_changed` |
| `state` | An entity's attribute is currently at a specified value (level-triggered). Fires on every `state_changed` that satisfies the predicate. | `state_changed` |
| `event` | A specific event type is received, optionally filtered by payload fields. | Any NORMAL+ event type |
| `availability` | An entity's availability changes to `online` or `offline`. | `availability_changed` |
| `numeric_threshold` | An entity's numeric attribute crosses a threshold (above, below). | `state_changed` |

**Trigger types (Tier 2, schema defined but not implemented):**

| Type | Matches When | Implementation Deferred Because |
|---|---|---|
| `time` | A cron expression or specific time matches. | Requires scheduler integration (Doc 05 §3.8 SchedulerService). |
| `sun` | Sunrise or sunset occurs (with optional offset). | Requires location configuration and solar calculation. |
| `presence` | A person enters or leaves a zone. | `presence_changed` events exist in the taxonomy; trigger matching deferred. |
| `webhook` | An external HTTP request arrives. | Requires REST API (Doc 09). |

**Trigger evaluation procedure:**

1. For each event in the batch, look up matching automations via the trigger index.
2. For each matching automation, check whether the automation is enabled.
3. For each enabled automation, evaluate the specific trigger predicate against the event payload. A `state_change` trigger with `from: "off"` and `to: "on"` matches only if the event's `old_value` is `"off"` and `new_value` is `"on"`.
4. If the trigger predicate matches, apply deduplication (§3.5).
5. If not deduplicated, apply concurrency mode enforcement (§3.6).
6. If the mode permits execution, initiate a Run (§3.7).

**Edge-triggered vs. level-triggered distinction.** The `state_change` trigger type is edge-triggered: it fires only on transitions. The `state` trigger type is level-triggered: it fires whenever the condition is true after a `state_changed` event. This distinction follows from SmartThings' `changes` condition pattern identified in competitive research Q2 — converting level-triggered conditions to edge-triggered ones prevents redundant executions on every matching event.

### 3.5 Trigger Deduplication

When multiple triggers on the same automation match the same event, the engine produces one Run, not one Run per trigger. The deduplication key is `(automation_id, triggering_event_id)`.

This differs from Home Assistant, which produces separate runs for each matching trigger on the same automation (competitive research Q2). HomeSynapse deduplicates because the event-sourced model demands that a single causal event produce a single causal chain per automation. Multiple Runs from the same event for the same automation would create ambiguous trace histories and violate INV-TO-02 (automation determinism).

The Run trace records which trigger(s) matched, preserving diagnostic information. If trigger T1 and T2 both match event E for automation A, the resulting Run's `automation_triggered` event payload includes both trigger identifiers in its `matched_triggers` array.

### 3.6 Concurrency Modes

Each automation declares a concurrency mode that governs behavior when a new trigger fires while a previous Run is still active. This design adopts Home Assistant's four-mode model (introduced in HA v0.113, July 2020), which competitive research identified as the reference model for concurrent execution handling.

| Mode | Behavior When Trigger Fires During Active Run | Default `max_concurrent` |
|---|---|---|
| `single` | New trigger is dropped. Logged per `max_exceeded_severity`. | 1 |
| `restart` | Active Run is cancelled (receives `aborted` status). New Run starts. | 1 |
| `queued` | New Run is queued. Executes when current Run completes. Queue bounded by `max_concurrent`. | 10 |
| `parallel` | New Run starts immediately alongside active Run(s). Bounded by `max_concurrent`. | 10 |

**Concurrency mode is per-automation, not per-trigger.** A single automation definition has one mode that applies regardless of which trigger fired. This matches Home Assistant's semantics and prevents configuration complexity.

**Top-level conditions are evaluated before mode enforcement.** When a trigger fires, top-level conditions are evaluated immediately. If any condition is false, the Run completes with status `condition_not_met` and the mode is not consulted. This prevents a `single`-mode automation from blocking subsequent triggers when the current trigger's conditions fail — an important behavioral detail documented in Home Assistant's modes documentation and confirmed as a source of user confusion when not implemented (competitive research Q1).

**Mode transitions produce events.** When a Run is dropped (`single` mode, queue full), cancelled (`restart` mode), or queued, the engine produces an `automation_run_skipped` or `automation_run_cancelled` DIAGNOSTIC event. This provides observability into mode enforcement without requiring the user to infer behavior from the absence of trace events.

### 3.7 Run Lifecycle

A Run is a single execution instance of an automation, from trigger evaluation through action completion. Each Run executes on its own virtual thread (per LTD-01), enabling natural sequential execution with non-blocking delays.

**Run states:**

```
              trigger matches
                    │
                    ▼
            ┌──────────────┐
            │  EVALUATING  │──── conditions false ───▶ CONDITION_NOT_MET
            │  (conditions) │
            └──────────────┘
                    │
                conditions true
                    │
                    ▼
            ┌──────────────┐
            │   RUNNING    │──── all actions done ───▶ COMPLETED
            │   (actions)  │──── error in action ────▶ FAILED
            └──────────────┘──── cancelled (restart) ─▶ ABORTED
```

**Run lifecycle events:**

| Event Type | Subject | Priority | When Produced | Key Payload Fields |
|---|---|---|---|---|
| `automation_triggered` | Automation | NORMAL | Trigger matches and mode permits execution | `run_id`, `triggering_event_id`, `matched_triggers[]`, `resolved_targets{}`, `definition_hash` |
| `automation_condition_evaluated` | Automation | DIAGNOSTIC | Each top-level condition is evaluated | `run_id`, `condition_index`, `condition_type`, `result` (true/false), `evaluated_state{}` |
| `automation_action_started` | Automation | DIAGNOSTIC | An action step begins | `run_id`, `action_index`, `action_type`, `target_refs[]` |
| `command_issued` | Entity | NORMAL | A command action dispatches a command | All fields per Doc 01 §4.3 command lifecycle, plus `run_id` in payload |
| `automation_action_completed` | Automation | DIAGNOSTIC | An action step finishes | `run_id`, `action_index`, `outcome` (success/skipped/error), `error_detail` (if applicable) |
| `automation_completed` | Automation | NORMAL | Run reaches terminal state | `run_id`, `final_status`, `duration_ms`, `action_count`, `command_count` |

All Run events are produced via `EventPublisher.publish()` (§8.3 of Doc 01) with the triggering event's `CausalContext`, maintaining the causal chain. The `correlation_id` is inherited from the triggering event, enabling the Causal Chain Projection (Doc 01 §3.18) to reconstruct the full trace from trigger through command confirmation.

**Definition hash.** The `automation_triggered` event payload includes a `definition_hash` field: a SHA-256 hash of the serialized automation definition active at trigger time. The full definition is retrievable from the Automation Registry by `automation_id`; the hash enables replay verification without payload bloat. If the automation definition has changed since the Run, the trace viewer can indicate that the Run executed under a different definition than the current one.

**Resolved target snapshot.** Address selectors are resolved at trigger time per **Identity Model** §7.2. The resolved `Set<EntityRef>` for each selector is captured in the `automation_triggered` event payload (`resolved_targets`). All subsequent actions in the Run use these resolved sets, not re-resolution. This guarantees deterministic behavior within a Run and enables replay to verify that the same targets were used.

**Automation lifecycle events (non-Run).** The following events are produced by the automation engine outside the context of a specific Run. They record mode enforcement decisions, conflict detection, and health state transitions.

| Event Type | Subject | Priority | When Produced | Key Payload Fields |
|---|---|---|---|---|
| `automation_run_skipped` | Automation | DIAGNOSTIC | Trigger matched but Run not initiated due to mode enforcement: `single` mode with an active Run, or `queued`/`parallel` mode with queue at `max_concurrent`. | `automation_id`, `triggering_event_id`, `reason` (`mode_busy` or `queue_full`), `mode`, `active_run_id` (if single/restart), `max_exceeded_severity` |
| `automation_run_cancelled` | Automation | DIAGNOSTIC | Active Run cancelled by `restart` mode enforcement when a new trigger arrives. | `automation_id`, `cancelled_run_id`, `replacing_event_id`, `triggering_event_id` |
| `automation_conflict_detected` | Automation | DIAGNOSTIC | Multiple automations issued commands to the same entity from Runs triggered by the same event, and at least one pair targets the same attribute with different values. | `triggering_event_id`, `entity_ref`, `conflicts[]` (array of `{automation_id, command_event_id, command_name, parameters}`), `contradictory` (boolean) |
| `automation_disabled` | Automation | NORMAL | Automation auto-disabled after exceeding the failure threshold (`auto_disable_failure_count` failures within `auto_disable_window_minutes`). | `automation_id`, `reason` (`repeated_failure`), `failure_count`, `window_minutes`, `last_error`, `last_run_id` |

`automation_disabled` is NORMAL priority (not DIAGNOSTIC) because it represents a significant operational state change that affects system behavior and should survive the 7-day DIAGNOSTIC retention window. The user needs to know an automation was disabled even if they do not check the system for several weeks.

### 3.8 Condition Evaluation

Conditions are boolean guards evaluated after the trigger fires but before actions execute. They check current state, not events (Glossary §4.3).

**Condition types (Tier 1):**

| Type | Evaluates | Example |
|---|---|---|
| `state` | Whether an entity's attribute equals a specified value. | `entity: kitchen.light, attribute: on_off, value: "on"` |
| `numeric` | Whether an entity's numeric attribute satisfies a comparison. | `entity: thermostat, attribute: temperature, above: 25.0` |
| `time` | Whether the current time falls within a specified window. | `after: "22:00", before: "06:00"` |
| `and` | Logical conjunction of nested conditions. | Short-circuits on first false. |
| `or` | Logical disjunction of nested conditions. | Short-circuits on first true. |
| `not` | Logical negation of a nested condition. | Inverts result. |

**Condition types (Tier 2, schema defined but not implemented):**

| Type | Evaluates | Implementation Deferred Because |
|---|---|---|
| `zone` | Whether a person or entity is within a specified geographic zone. | Requires Tier 2 presence infrastructure and zone definition model. |

**State source for condition evaluation.** Conditions read from the State Store's `StateQuery` interface (Doc 03 §8.1). In LIVE mode, this returns the current materialized state. The state is read synchronously within the Run's virtual thread — no suspension point between condition evaluation and the decision to proceed, ensuring atomicity within a single Run.

**Condition evaluation produces events.** Each top-level condition evaluation produces an `automation_condition_evaluated` DIAGNOSTIC event recording the condition type, the evaluated state values, and the boolean result. This satisfies INV-TO-01 (observable) and enables the trace viewer to show exactly why a Run proceeded or was skipped.

### 3.9 Action Execution

Actions execute sequentially within a Run's virtual thread. Each action step produces events before and after execution.

**Action types (Tier 1):**

| Type | Behavior | Blocking? |
|---|---|---|
| `command` | Issues a command to one or more target entities via the Command Pipeline (§3.11). | Non-blocking (dispatches and continues). |
| `delay` | Suspends the Run's virtual thread for a specified duration. | Blocking (virtual thread sleep). |
| `wait_for` | Suspends until a condition becomes true or a timeout expires. | Blocking (polls State Store on interval). |
| `condition_branch` | Evaluates a condition and executes one of two action lists (`then`/`else`). | Non-blocking (inline decision). |
| `emit_event` | Produces a custom event on the event bus. | Non-blocking. |

**Action types (Tier 2, schema defined but not implemented):**

| Type | Behavior | Deferred Because |
|---|---|---|
| `activate_scene` | Activates a named Scene (Glossary §4.6). | Scene system deferred to Tier 2. |
| `invoke_integration` | Calls an Integration Operation (Glossary §2.9). | Requires integration operation registry. |
| `parallel` | Executes a list of actions concurrently. | Adds complexity to Run trace model. |

**Command action target resolution.** When an action targets entities via selectors (area, label, type), the resolved set from trigger time (§3.7) is used. Each entity in the resolved set receives the command. The action produces one `command_issued` event per target entity, each with its own `event_id` but sharing the Run's `correlation_id`.

**Unavailable target handling.** When a command action targets an entity whose availability is `offline` (per State Store), the behavior depends on a per-action configuration field `on_unavailable`:

| Value | Behavior | Rationale |
|---|---|---|
| `skip` (default) | Skip this target. Produce `automation_action_completed` with outcome `skipped` and reason `target_unavailable`. Continue to next target/action. | Safe default. Prevents the Run from blocking on unreachable devices. |
| `error` | Fail this action step. The Run transitions to `FAILED` status. | For safety-critical automations where partial execution is worse than no execution. |
| `warn` | Issue the command anyway (the adapter will handle the unavailable device). Produce a DIAGNOSTIC warning event. | For devices with intermittent availability where the adapter may succeed despite stale availability status. |

This design explicitly avoids Home Assistant's silent skip pattern (competitive research Q1, Q8). Every unavailable-target decision produces an event, making it diagnosable.

**Delay action implementation.** The `delay` action suspends the Run's virtual thread via `Thread.sleep(Duration)`. Because virtual threads do not consume platform threads during sleep (LTD-01), hundreds of concurrent delayed Runs cost negligible resources. The delay duration is captured in the `automation_action_started` event. If a delayed Run is cancelled (due to `restart` mode), the virtual thread is interrupted, and `Thread.sleep` throws `InterruptedException`, which the Run handler catches and transitions to `ABORTED`.

**Wait-for action implementation.** The `wait_for` action polls the State Store at a configurable interval (default: 1 second) until the specified condition is true or the timeout expires. Each poll is a virtual thread sleep + condition evaluation cycle. The polling interval and timeout are captured in the `automation_action_started` event. If the timeout expires, the action produces `automation_action_completed` with outcome `timeout`.

### 3.10 Replay Behavior

During REPLAY processing mode (Doc 01 §3.7), the automation engine processes historical events to rebuild its internal state (active automation set, health status) without producing side effects.

**What happens during REPLAY:**

| Operation | Behavior | Rationale |
|---|---|---|
| Trigger evaluation | Proceeds normally against replayed events. | Rebuilds the engine's understanding of which automations were active and matching. |
| Condition evaluation | Suppressed — conditions are not re-evaluated. | The State Store is itself being rebuilt from the event stream during replay. Evaluating conditions against partially-replayed state would produce inconsistent results. |
| Action execution | Suppressed — no commands issued, no delays executed, no events emitted. | INV-ES-04 and Doc 01 §3.7 mandate: actuator commands suppressed, derived events not re-produced. |
| Run Lifecycle | Two distinct behaviors. (1) **Trigger index maintenance:** when the engine encounters `state_changed` or `availability_changed` events during REPLAY, it evaluates trigger predicates to maintain the trigger index and active automation tracking. No new `automation_triggered` events are produced — those already exist in the log from original LIVE processing. (2) **Run history reconstruction:** when the engine encounters existing `automation_triggered`, `automation_completed`, and other Run trace events during REPLAY, it consumes them to rebuild the RunManager's active Run tracking, automation health counters, and concurrency mode state. |
| Command Pipeline | Suppressed. The Pending Command Ledger consumes existing `command_issued`, `command_result`, and `state_confirmed` events to rebuild its pending command map. No new commands are dispatched. | Doc 01 §3.7 explicitly specifies: "The Pending Command Ledger does not re-emit `state_confirmed` events during replay." |

**REPLAY to LIVE transition.** The engine transitions from REPLAY to LIVE when the subscriber's checkpoint reaches within the configurable threshold of the log head (default: 10 events, per Doc 01 §3.7). Events processed after the transition are in LIVE mode — triggers fire, conditions evaluate, and actions execute normally.

**Determinism guarantee under replay.** INV-TO-02 requires that identical event streams produce identical outcomes. During replay, the engine does not produce new events — it consumes existing ones. The determinism guarantee is satisfied because: (a) the original LIVE execution produced deterministic events given the event stream and configuration, and (b) replay consumes those same events without modification. If the automation definition has changed since the original execution, the engine detects this via the `definition_hash` in the `automation_triggered` event payload (§3.7) and logs a diagnostic warning.

### 3.11 Command Pipeline

The Command Pipeline is the outbound command path from action dispatch through protocol delivery to state confirmation. It consists of two components: the Command Dispatch Service and the Pending Command Ledger. Both were previously orphaned across Doc 01 and Doc 02; this document claims subsystem ownership and provides the unified design.

#### 3.11.1 Command Dispatch Service

The Command Dispatch Service is a thin routing resolver within the automation subsystem. When a `command_issued` event is appended to the log, the dispatch service:

1. Reads the `target_ref` from the event payload.
2. Resolves the entity's owning integration via `DeviceRegistry.getIntegrationForEntity(entityRef)` (Doc 02 §8.1).
3. Validates the command against the entity's capability schema via `CommandValidator.validate()` (Doc 02 §8.1). Commands that fail validation produce a `command_result` event with status `invalid` and do not reach the adapter.
4. If the entity is not owned by any loaded integration, produces a `command_result` event with status `unroutable`.
5. If routing succeeds, invokes the adapter's `CommandHandler.handleCommand(entityRef, commandName, parameters)` callback (Doc 05 §3.8).
6. On successful handoff to the adapter, produces a `command_dispatched` event (DIAGNOSTIC priority) carrying the `integration_id`, `protocol_metadata`, and a causal reference to the `command_issued` event.

The dispatch service runs as a separate subscriber (`command_dispatch_service`) with its own virtual thread. It subscribes to `command_issued` events and processes them independently of the automation engine's main subscriber. This decouples command routing from trigger evaluation — the automation engine's subscriber can continue processing events while commands are being dispatched.

**Subscription filter:**

```java
new SubscriptionFilter(
    Set.of("command_issued"),
    EventPriority.NORMAL,
    "entity"
)
```

#### 3.11.2 Pending Command Ledger

The Pending Command Ledger is a core subscriber that tracks in-flight commands and correlates them with incoming state reports. Its behavioral specification is established in **Event Model & Event Bus** §3.8; this section specifies its implementation within the automation subsystem.

**Subscriber registration:**

```java
subscriberId: "pending_command_ledger"
filter: new SubscriptionFilter(
    Set.of("command_issued", "command_result", "state_reported", "state_confirmed"),
    EventPriority.DIAGNOSTIC,    // state_reported is DIAGNOSTIC
    "entity"
)
coalescing: DISABLED             // per Doc 01 §3.6 — correctness-critical
```

**Lifecycle of a pending command (consuming Doc 01 §3.8):**

1. A `command_issued` event arrives. The ledger records a pending entry keyed by `(target_ref, command_name)` with the `expected_outcome` from the event payload (computed by `ExpectationFactory` per Doc 02 §3.10), the `confirmation_timeout_ms`, and the `idempotency_class`.
2. A `command_result` event arrives. If status is `acknowledged`, the ledger updates the pending entry to `awaiting_confirmation`. If status is `rejected` or `timed_out`, the entry is removed and a `command_confirmation_timed_out` event is produced if no prior timeout was emitted.
3. A `state_reported` event arrives for the target entity. The ledger evaluates the reported value against the pending entry's `Expectation` (via the `Expectation.evaluate()` interface from Doc 02 §8.2). If the result is `CONFIRMED`, the ledger produces a `state_confirmed` event referencing both the `command_issued` and `state_reported` events.
4. If no matching `state_reported` arrives within `confirmation_timeout_ms`, the ledger produces a `command_confirmation_timed_out` DIAGNOSTIC event referencing the `command_issued` event and any received `command_result`. Per Doc 01 §4.3: this is not an error — it is evidence for diagnosis.

**In-memory state.** The ledger maintains a `ConcurrentHashMap<EntityRef, List<PendingCommand>>` for pending commands. Each `PendingCommand` record holds the command event ID, target attribute, expectation, timeout deadline, and current status. This map is rebuilt during REPLAY by processing the existing command lifecycle events in the log.

**Causal chain linking.** The causal chain from an automation Run through command confirmation is:

```
automation_triggered (correlation_id = C)
  └─▶ command_issued (correlation_id = C, causation_id = trigger_event_id)
       └─▶ command_dispatched (correlation_id = C, causation_id = command_issued_id)
       └─▶ command_result (correlation_id = C, causation_id = command_issued_id)
       └─▶ state_confirmed (correlation_id = C, causation_id = state_reported_id)
```

This chain enables the Causal Chain Projection (Doc 01 §3.18) to reconstruct the complete narrative from "why did the automation fire?" through "did the command actually work?"

**Crash recovery.** On restart, the ledger replays from its checkpoint. `command_issued` events without corresponding `command_result` events represent commands that were in-flight at crash time. The behavior per idempotency class is defined in Doc 01 §3.7: `IDEMPOTENT` commands are re-issued after the subscriber reaches LIVE mode, `NOT_IDEMPOTENT` commands are marked as `expired_on_restart`, and `CONDITIONAL` commands are offered to the integration adapter for evaluation.

**Checkpoint and health.** The ledger checkpoints after each batch of processed events, using the same `CheckpointStore` interface as other subscribers (Doc 04 §8.1). The ledger's health indicator reports:

| State | Condition |
|---|---|
| `HEALTHY` | No pending commands with expired timeouts. Normal operation. |
| `DEGRADED` | One or more commands have timed out without confirmation in the current evaluation window. |
| `UNHEALTHY` | The subscriber is unable to keep up with the event stream (checkpoint falling behind log head). |

### 3.12 Selector Vocabulary

The Identity Model (§7) defines address resolution primitives. This section defines the selector syntax that users write in automation targets, conditions, and triggers. Each selector maps to the Identity Model's resolution primitives.

**Selector types:**

| Selector | Syntax in YAML | Resolves To | Example |
|---|---|---|---|
| Direct reference | `entity_ref: <ULID>` | Exactly one entity | `entity_ref: 01HXYZ...` |
| Slug reference | `entity: <slug>` | Exactly one entity (via slug lookup) | `entity: kitchen.overhead_light` |
| Area selector | `area: <area_slug>` | All entities in the area | `area: kitchen` |
| Label selector | `label: <label>` | All entities with the label | `label: downstairs_lights` |
| Type selector | `type: <entity_type>` | All entities of the type | `type: light` |
| Compound selector | Multiple selectors in an `all_of` block | Intersection of resolved sets | See below |

**Compound selector example:**

```yaml
target:
  all_of:
    - area: kitchen
    - type: light
```

This resolves to the intersection of "entities in the kitchen area" and "entities of type light" — kitchen lights only. The intersection follows the Identity Model's deduplication rules (§7.3): each entity appears at most once.

**Resolution timing.** All selectors are resolved at trigger evaluation time per Identity Model §7.2. The resolved sets are captured in the `automation_triggered` event payload and used for the duration of the Run.

**Zero-target resolution.** When a selector resolves to zero entities, the behavior depends on context:

- **In a trigger:** A trigger that watches a selector resolving to zero entities is logged as a DIAGNOSTIC warning and the trigger is inactive. The automation's health is set to `degraded`.
- **In an action:** The action step completes with outcome `no_targets`. An `automation_action_completed` event is produced with outcome `no_targets`. The Run continues to the next action. This is not an error — the selector may resolve to entities in the future as devices are added.
- **In a condition:** A state condition referencing a nonexistent entity evaluates to `false`. The Run completes with status `condition_not_met`.

**Definition-time validation.** When `automations.yaml` is loaded, all slug references are validated against the current Entity Registry. Invalid slugs produce a structured validation error surfaced through the Configuration System's error reporting. Direct references (ULIDs) are validated for format but not for existence — the entity may not yet be adopted. Area, label, and type selectors are validated for syntax only — they may legitimately match zero entities at definition time but resolve to entities later.

### 3.13 Conflict Detection

When multiple automations respond to the same triggering event with contradictory commands targeting the same entity, the outcome is deterministic but potentially undesirable. This section defines the detection and reporting mechanism.

**Execution order.** Automations matching the same event are evaluated in deterministic order: by `priority` descending (higher priority first), then by `automation_id` ascending (ULID lexicographic order, which corresponds to creation time). This ordering is stable and does not depend on event bus delivery order or subscription registration order. It satisfies INV-TO-02 (automation determinism).

**Conflict detection.** After all automations matching an event have been evaluated and their Runs initiated, the engine performs a conflict scan: for each entity that received `command_issued` events from multiple Runs triggered by the same event, the engine produces an `automation_conflict_detected` DIAGNOSTIC event containing:

- The triggering event ID.
- The list of `(automation_id, command_issued_event_id, command_name, parameters)` tuples.
- Whether the commands are contradictory (targeting the same attribute with different values) or compatible (targeting different attributes).

**No automatic resolution in Tier 1.** Both commands execute. The conflict detection event provides observability for the user to identify and resolve the conflict by adjusting priorities or adding conditions. Automatic conflict resolution (priority-based suppression) is deferred to Tier 2 to avoid introducing complex arbitration logic before the base execution model is validated.

**Rationale for detect-and-warn over priority-based suppression.** Competitive research found that no existing platform implements conflict resolution — all use last-writer-wins. Rather than building a priority-based suppression system that may have unexpected edge cases, the Tier 1 approach provides the observability that makes conflicts visible and lets the user resolve them. The priority field is defined now to enable Tier 2 suppression without schema changes.

---

## 4. Data Model

### 4.1 Automation Definition Schema

Automation definitions are stored in `automations.yaml`, registered as a secondary config file with the Configuration System (Doc 06 §7), and validated against a JSON Schema registered with the `SchemaRegistry` (Doc 06 §3.2).

**Top-level YAML structure:**

```yaml
automations:
  - name: "Turn on kitchen lights when motion detected"
    enabled: true
    mode: single
    max_exceeded_severity: info
    priority: 0
    triggers:
      - type: state_change
        entity: kitchen.motion_sensor
        attribute: occupancy
        to: "true"
    conditions:
      - type: numeric
        entity: kitchen.light_sensor
        attribute: illuminance
        below: 100
    actions:
      - type: command
        target:
          area: kitchen
          type: light
        command: set_on_off
        parameters:
          on_off: true
        on_unavailable: skip
```

**Automation identity assignment.** When `automations.yaml` is loaded for the first time, each automation is assigned an `automation_id` (ULID). The mapping from automation name to ULID is stored in a companion file (`automations.ids.yaml`) managed by the automation engine, not edited by users. On subsequent reloads, automations are matched by name to preserve identity across definition changes. If a name is not found in the identity file, a new ULID is assigned. If a name is removed from `automations.yaml`, the identity mapping is retained for 30 days (configurable) to support temporary removal and re-addition without identity change.

### 4.2 Run Trace Data Model

A Run's complete execution history is stored as a series of events in the domain event log. The trace viewer reconstructs the Run by querying events with the Run's `correlation_id`.

**Run trace record (assembled from events, not stored as a separate structure):**

| Field | Source | Description |
|---|---|---|
| `run_id` | `automation_triggered` payload | ULID identifying this Run instance. |
| `automation_id` | `automation_triggered` payload | The automation that was executed. |
| `triggering_event_id` | `automation_triggered` payload | The event that caused the trigger to fire. |
| `matched_triggers` | `automation_triggered` payload | Which trigger definition(s) matched. |
| `resolved_targets` | `automation_triggered` payload | The resolved entity sets for all selectors. |
| `conditions` | `automation_condition_evaluated` events | Ordered list of condition evaluations with results. |
| `actions` | `automation_action_started` + `automation_action_completed` events | Ordered list of action steps with outcomes. |
| `commands` | `command_issued` + `command_dispatched` + `command_result` + `state_confirmed` events | Command lifecycle for each issued command. |
| `final_status` | `automation_completed` payload | Terminal Run status. |
| `duration_ms` | `automation_completed` payload | Total Run duration. |

The trace is not materialized as a separate data structure. It is assembled on-demand by querying events by `correlation_id` using the Causal Chain Projection pattern (Glossary §3.18). The query uses standard `EventStore.readFrom()` filtering capabilities defined in **Event Model & Event Bus** §3.4. This avoids dual-write consistency issues and leverages the existing event log infrastructure.

### 4.3 Pending Command Entry

Each pending command in the ledger is represented as:

```java
record PendingCommand(
    ULID commandEventId,         // event_id of the command_issued event
    EntityRef targetRef,         // target entity
    String commandName,          // capability command name
    String targetAttribute,      // attribute expected to change
    Expectation expectation,     // from ExpectationFactory
    Instant deadline,            // when to emit timeout event
    CommandIdempotency idempotency,  // IDEMPOTENT, NOT_IDEMPOTENT, CONDITIONAL
    PendingStatus status         // DISPATCHED, ACKNOWLEDGED, CONFIRMED, TIMED_OUT, EXPIRED
) {}
```

---

## 5. Contracts and Invariants

**C1: Every Run produces a complete, self-contained trace.** An `automation_triggered` event is always followed by an `automation_completed` event with the same `run_id`. Between them, every condition evaluation and action step produces its own event. No Run is silently abandoned — even if the process crashes mid-Run, the absence of `automation_completed` is detectable and the partial trace is preserved in the log. This satisfies INV-TO-01 (observable) and INV-TO-02 (deterministic — the trace is the proof of determinism).

**C2: Trigger deduplication is by (automation_id, triggering_event_id).** A single event produces at most one Run per automation, regardless of how many triggers on that automation match. This prevents trace ambiguity and ensures causal chains are clean. Satisfies INV-TO-02.

**C3: Execution order is deterministic.** When multiple automations match the same event, they execute in `priority` descending, `automation_id` ascending order. This order is stable across restarts, replays, and configuration reloads (provided priorities and IDs are unchanged). Satisfies INV-TO-02.

**C4: Resolved target sets are immutable within a Run.** All address selectors are resolved at trigger time. The resolved sets are captured in the `automation_triggered` event payload and used for all actions in the Run. No re-resolution occurs during action execution. Satisfies INV-TO-02 per Identity Model §7.2.

**C5: Command dispatch is suppressed during REPLAY; evaluation is not.** Trigger matching proceeds normally during REPLAY to rebuild the engine's active automation set. Condition evaluation and action execution are suppressed. Run trace events are not re-produced. The Pending Command Ledger rebuilds from existing events. Satisfies Doc 01 §3.7 processing mode contract.

**C6: The Command Pipeline closes the intent-to-observation loop.** Every `command_issued` event is tracked through `command_dispatched`, `command_result`, and either `state_confirmed` or `command_confirmation_timed_out`. No command is silently dropped from tracking. The causal chain links all events via `correlation_id`. Satisfies INV-ES-06 and INV-TO-01.

**C7: In-progress Runs complete on their original definition.** When `automations.yaml` is reloaded, active Runs continue executing with the automation definition that was in effect when they were triggered. New definitions take effect only for subsequent trigger evaluations. Satisfies P5 (§1).

**C8: Unavailable targets are never silently skipped.** Every unavailable-target decision (skip, error, warn) produces an event. The user can always determine whether a command reached its target by querying the Run trace. Satisfies INV-TO-01 and addresses the universal silent-skip pattern identified in competitive research Q8.

**Invariant alignment:**

| Contract | Invariants Served |
|---|---|
| C1 | INV-TO-01 (observable), INV-TO-02 (deterministic), INV-ES-06 (explainable) |
| C2 | INV-TO-02 (deterministic) |
| C3 | INV-TO-02 (deterministic) |
| C4 | INV-TO-02 (deterministic), per Identity Model §7.2 |
| C5 | INV-ES-04 (write-ahead persistence), Doc 01 §3.7 (processing modes) |
| C6 | INV-ES-06 (explainable), INV-TO-01 (observable) |
| C7 | INV-TO-02 (deterministic — definition hash in trigger event enables replay verification) |
| C8 | INV-TO-01 (observable), INV-HO-04 (self-explaining errors) |

---

## 6. Failure Modes and Recovery

### 6.1 Automation Definition Validation Failure

**Trigger:** `automations.yaml` contains definitions that fail JSON Schema validation (unknown trigger type, missing required field, invalid selector syntax, unknown entity slug).

**Impact:** Invalid automations are not loaded. Valid automations in the same file are loaded normally. The system operates with the valid subset.

**Recovery:** A `config_error` event is produced per Doc 01 §4.3 (taxonomy addition from Doc 06 cross-audit, amendment A-01-R5-1) containing the automation name, the validation error details, and the line number in the YAML file. The automation engine's health indicator is set to `DEGRADED`. The user corrects the YAML file; the Configuration System detects the change and triggers a reload.

**Events produced:** `config_error` (CRITICAL).

### 6.2 Run Failure During Action Execution

**Trigger:** An action step throws an unhandled exception (e.g., the Command Dispatch Service encounters an unexpected error, the State Store is temporarily unavailable during a `wait_for` condition check).

**Impact:** The current action step fails. The Run transitions to `FAILED` status. Subsequent actions in the Run are not executed.

**Recovery:** An `automation_action_completed` event is produced with outcome `error` and the exception detail. An `automation_completed` event is produced with `final_status: failed`. The automation remains active for future triggers — a single Run failure does not disable the automation. If Run failures exceed a configurable threshold within a time window (default: 5 failures in 10 minutes), the automation is automatically disabled and an `automation_disabled` CRITICAL event is produced.

**Events produced:** `automation_action_completed` (DIAGNOSTIC, outcome: error), `automation_completed` (NORMAL, status: failed), optionally `automation_disabled` (CRITICAL).

### 6.3 Command Dispatch Routing Failure

**Trigger:** The Command Dispatch Service cannot resolve the entity's owning integration (entity not registered, integration not loaded, or integration in unhealthy state).

**Impact:** The command is not delivered to any adapter. The Run's action step records the failure.

**Recovery:** A `command_result` event is produced with status `unroutable` or `integration_unavailable`, referencing the `command_issued` event. The Pending Command Ledger removes the pending entry. The Run's action step proceeds per the `on_unavailable` setting.

**Events produced:** `command_result` (CRITICAL, status: unroutable/integration_unavailable).

### 6.4 Pending Command Confirmation Timeout

**Trigger:** A command was dispatched and acknowledged by the adapter, but the expected state change was not observed within the configured timeout.

**Impact:** The Pending Command Ledger produces a `command_confirmation_timed_out` event. The command is removed from the pending map. The Run trace shows the timeout but the Run's final status is not affected (the Run may have already completed — timeout evaluation is asynchronous).

**Recovery:** No automatic retry in Tier 1. The timeout event is visible in the trace viewer and the automation's observability metrics. The user can configure retry logic explicitly using `wait_for` + `command` action sequences. Tier 2 may introduce configurable per-capability retry policies.

**Events produced:** `command_confirmation_timed_out` (DIAGNOSTIC).

### 6.5 Subscriber Checkpoint Expiration

**Trigger:** Retention purges events that the automation engine subscriber has not yet processed (subscriber too far behind the log head).

**Impact:** The subscriber cannot catch up via sequential replay. The automation engine's active Run state may be incomplete.

**Recovery:** A `subscriber_checkpoint_expired` CRITICAL event is produced per Doc 01 §3.4 delivery gap handling. The engine attempts to reinitialize from the latest checkpoint. If no checkpoint exists, the engine reports UNHEALTHY status. Active automations continue to receive new events (the engine registers a fresh subscription from the current log head), but historical Run state is lost.

**Events produced:** `subscriber_checkpoint_expired` (CRITICAL).

### 6.6 Virtual Thread Interruption During Delay

**Trigger:** A Run in `delay` or `wait_for` state is interrupted because the automation was reloaded in `restart` mode or the system is shutting down.

**Impact:** The Run transitions to `ABORTED` status. Remaining actions are not executed.

**Recovery:** An `automation_completed` event is produced with `final_status: aborted` and `abort_reason: restart_mode` or `abort_reason: shutdown`. The Run's partial trace is preserved.

**Events produced:** `automation_completed` (NORMAL, status: aborted).

### 6.7 Event Storm Overload

**Trigger:** A burst of events (e.g., power restoration after outage causing dozens of `state_changed` events simultaneously) matches many automations, creating a spike of concurrent Runs.

**Impact:** Potential CPU and memory pressure on constrained hardware. The virtual thread scheduler may introduce latency as hundreds of Runs compete for carrier threads.

**Recovery:** The `max_concurrent` limit on `queued` and `parallel` modes bounds the per-automation Run count. The Event Bus's backpressure mechanism (Doc 01 §3.6) throttles event delivery if the subscriber falls behind. The engine processes events in batch (configurable batch size, default: 50) and checkpoints after each batch. If the checkpoint falls behind the log head by more than the configured threshold, the health indicator transitions to DEGRADED.

**Events produced:** `subscriber_falling_behind` (DIAGNOSTIC, from Event Bus).

---

## 7. Interaction with Other Subsystems

| Subsystem | Direction | Mechanism | Data | Constraints |
|---|---|---|---|---|
| Event Model & Event Bus | Subscribes to | Event Bus subscription (3 subscribers: `automation_engine`, `command_dispatch_service`, `pending_command_ledger`) | `state_changed`, `availability_changed`, `presence_changed`, `config_changed`, `command_issued`, `command_result`, `state_reported`, `state_confirmed` | Pull-based with notification. Coalescing disabled for Pending Command Ledger. |
| Event Model & Event Bus | Produces events via | `EventPublisher.publish()` | `automation_triggered`, `automation_condition_evaluated`, `automation_action_started`, `automation_action_completed`, `automation_completed`, `command_issued`, `command_dispatched`, `command_confirmation_timed_out`, `automation_conflict_detected`, `automation_run_skipped`, `automation_run_cancelled`, `automation_disabled` | All produced via `publishDerived()` with causal chain from triggering event. |
| Device Model & Capability System | Reads from | `EntityRegistry`, `CapabilityRegistry`, `DeviceRegistry`, `CommandValidator`, `ExpectationFactory` query interfaces | Entity metadata, capability schemas, command validation, expected outcomes, entity-to-integration ownership | Read-only. Queries at trigger time (selector resolution), action time (command validation), and pending command creation (expectation generation). |
| State Store & State Projection | Reads from | `StateQuery` interface | Current entity state for condition evaluation | Read-only. Synchronous reads within the Run's virtual thread. |
| Integration Runtime | Calls | `IntegrationContext.CommandHandler.handleCommand()` | Entity reference, command name, parameters | Via Command Dispatch Service. The adapter's response determines `command_result` production. |
| Configuration System | Receives from | `ConfigurationChangeListener` callback + `ConfigurationProvider` interface | Validated automation definitions from `automations.yaml`, reload signals via direct callback | Schema registered via `SchemaRegistry`. File path registered as well-known per Doc 06 §7. Reload notification via `ConfigurationChangeListener`, not event bus subscription (§3.2). |
| Persistence Layer | Uses | `CheckpointStore` interface | Checkpoint data for 3 subscribers | Same checkpoint infrastructure as State Store and other subscribers. |

---

## 8. Key Interfaces

### 8.1 Interfaces

| Interface | Responsibility |
|---|---|
| `AutomationRegistry` | Load, validate, and query automation definitions. Manage automation identity mapping. |
| `TriggerEvaluator` | Match incoming events against registered trigger definitions. Maintain trigger index. |
| `ConditionEvaluator` | Evaluate condition predicates against current state via `StateQuery`. |
| `ActionExecutor` | Execute action sequences within a Run's virtual thread. Coordinate with Command Pipeline. |
| `RunManager` | Manage Run lifecycle, concurrency mode enforcement, and Run state tracking. |
| `CommandDispatchService` | Route `command_issued` events to the correct integration adapter. |
| `PendingCommandLedger` | Track in-flight commands and correlate with state confirmations. |
| `SelectorResolver` | Resolve selector expressions to `Set<EntityRef>` using Identity Model primitives. |
| `ConflictDetector` | Scan Runs triggered by the same event for contradictory commands. |

### 8.2 Key Types

| Type | Kind | Responsibility |
|---|---|---|
| `AutomationDefinition` | Record | Complete parsed automation definition with triggers, conditions, actions, mode, priority. |
| `AutomationId` | Value (ULID wrapper) | Typed automation identity per LTD-04. |
| `TriggerDefinition` | Sealed interface | Root of trigger type hierarchy: `StateChangeTrigger`, `StateTrigger`, `EventTrigger`, `AvailabilityTrigger`, `NumericThresholdTrigger`, plus Tier 2 reserved: `TimeTrigger`, `SunTrigger`, `PresenceTrigger`, `WebhookTrigger`. |
| `ConditionDefinition` | Sealed interface | Root of condition type hierarchy: `StateCondition`, `NumericCondition`, `TimeCondition`, `AndCondition`, `OrCondition`, `NotCondition`. |
| `ActionDefinition` | Sealed interface | Root of action type hierarchy: `CommandAction`, `DelayAction`, `WaitForAction`, `ConditionBranchAction`, `EmitEventAction`, plus Tier 2 reserved: `ActivateSceneAction`, `InvokeIntegrationAction`, `ParallelAction`. |
| `ConcurrencyMode` | Enum | `SINGLE`, `RESTART`, `QUEUED`, `PARALLEL`. |
| `RunId` | Value (ULID wrapper) | Typed Run identity. |
| `RunStatus` | Enum | `EVALUATING`, `RUNNING`, `COMPLETED`, `FAILED`, `ABORTED`, `CONDITION_NOT_MET`. |
| `RunContext` | Record | Mutable context for an active Run: run_id, automation_id, triggering event, resolved targets, current action index. Carried on the Run's virtual thread. |
| `PendingCommand` | Record | In-flight command tracking entry (§4.3). |
| `PendingStatus` | Enum | `DISPATCHED`, `ACKNOWLEDGED`, `CONFIRMED`, `TIMED_OUT`, `EXPIRED`. |
| `Selector` | Sealed interface | Root of selector type hierarchy: `DirectRefSelector`, `SlugSelector`, `AreaSelector`, `LabelSelector`, `TypeSelector`, `CompoundSelector`. |
| `UnavailablePolicy` | Enum | `SKIP`, `ERROR`, `WARN`. |
| `MaxExceededSeverity` | Enum | `SILENT`, `INFO`, `WARNING`. |

---

## 9. Configuration

All automation engine configuration follows YAML 1.2 (LTD-09) with JSON Schema validation. The engine runs correctly with zero configuration — all values have sensible defaults.

**Engine-level configuration (in `homesynapse.yaml`):**

```yaml
automation:
  # Subscriber batch size for the automation_engine subscriber.
  # Larger batches improve throughput; smaller batches improve latency.
  batch_size: 50                      # range: 10-500, default: 50

  # Maximum number of active Runs across all automations.
  # Bounds total virtual thread count for the automation subsystem.
  max_total_runs: 200                 # range: 10-1000, default: 200

  # How long to retain identity mappings for removed automations.
  identity_retention_days: 30         # range: 1-365, default: 30

  # Auto-disable threshold: if an automation fails this many times
  # within the window, it is automatically disabled.
  auto_disable_failure_count: 5       # range: 1-50, default: 5
  auto_disable_window_minutes: 10     # range: 1-60, default: 10

  command_pipeline:
    # Default confirmation timeout for commands whose capability
    # does not specify a timeout.
    default_confirmation_timeout_ms: 30000   # range: 5000-120000, default: 30000

    # Maximum pending commands tracked simultaneously.
    # Bounds memory usage of the Pending Command Ledger.
    max_pending_commands: 500                # range: 50-5000, default: 500

    # Batch size for the command_dispatch_service subscriber.
    dispatch_batch_size: 20                  # range: 5-100, default: 20

  condition:
    # Polling interval for wait_for action conditions.
    wait_for_poll_interval_ms: 1000          # range: 100-10000, default: 1000

    # Maximum wait_for timeout. Prevents indefinite Run suspension.
    max_wait_for_timeout_ms: 3600000         # range: 60000-86400000, default: 3600000 (1 hour)
```

**Per-automation configuration** is defined in `automations.yaml` per §4.1. The schema is validated by the Configuration System using the JSON Schema registered at startup.

---

## 10. Performance Targets

All targets are Constrained-tier commitments measured against RPi 5 / RPi 4 hardware with the Java 21 runtime specified in LTD-01, per PROJECT_STATUS.md Performance Target Portability note.

| Metric | Target | Rationale | Verification Method |
|---|---|---|---|
| Trigger evaluation latency (p99) | < 10 ms per event | A user flipping a switch expects sub-second automation response. The 10 ms budget for trigger evaluation leaves headroom for state query (< 5 ms per Doc 03 §10), command dispatch, and protocol delivery within a 200 ms end-to-end target. | JFR event timing on RPi 5 under load (50 automations, 10 events/sec). |
| Condition evaluation latency (p99) | < 5 ms per condition | Conditions read from in-memory State Store. Single hash map lookup per condition should be well under 1 ms; 5 ms budget accounts for compound conditions (and/or/not nesting). | JFR event timing with compound conditions (depth 3). |
| Run startup overhead | < 2 ms | Time from trigger match to virtual thread creation. Virtual thread creation is ~1 μs (LTD-01). Overhead is dominated by automation lookup and mode enforcement. | Microbenchmark on RPi 5. |
| Command dispatch latency (p99) | < 5 ms from `command_issued` to adapter handoff | The dispatch service performs one registry lookup and one command validation. Both are in-memory operations. | JFR event timing with 100 concurrent commands. |
| Pending Command Ledger memory | < 20 KB per pending command | Each `PendingCommand` record is approximately 200 bytes. At 500 max pending commands, total is ~100 KB. The 20 KB/command budget includes index overhead. | Heap profiling under sustained command load. |
| Max concurrent Runs (sustained) | 200 | Virtual threads at ~1 KB each = ~200 KB. With Run context (~500 bytes each), total is ~300 KB. Well within the automation subsystem's share of the 1536 MB heap (LTD-01). | Load test: 200 concurrent Runs with delay actions on RPi 5, monitoring RSS and GC pauses. |
| Hot-reload latency | < 500 ms for 100 automations | JSON Schema validation dominates. 100 automations × ~5 ms validation each = ~500 ms. Trigger index rebuild is O(total_triggers) — at 2 triggers per automation average, 200 HashMap insertions add < 1 ms and are negligible compared to validation. | Benchmark with 100-automation YAML file on RPi 5. |
| Automation engine steady-state memory | < 50 MB | Automation Registry (~100 definitions × ~5 KB each = ~500 KB) + trigger index (~50 KB) + active Runs (~300 KB at max concurrent) + Pending Command Ledger (~100 KB at max pending) + subscriber overhead. Total well under 50 MB. | JFR heap snapshot after 24 hours of operation with 100 automations. |

---

## 11. Observability

### 11.1 Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `hs_automation_runs_total` | Counter | `automation_id`, `status` | Total Runs by automation and terminal status. |
| `hs_automation_run_duration_ms` | Histogram | `automation_id` | Run duration distribution. |
| `hs_automation_trigger_evaluations_total` | Counter | `trigger_type`, `result` (matched/not_matched) | Trigger evaluation throughput. |
| `hs_automation_condition_evaluations_total` | Counter | `condition_type`, `result` (true/false) | Condition evaluation throughput. |
| `hs_automation_commands_issued_total` | Counter | `capability`, `command_name` | Commands issued by capability and command. |
| `hs_automation_commands_confirmed_total` | Counter | `capability` | Commands that received state confirmation. |
| `hs_automation_commands_timed_out_total` | Counter | `capability` | Commands that timed out without confirmation. |
| `hs_automation_conflicts_detected_total` | Counter | — | Conflict detection events. |
| `hs_automation_runs_skipped_total` | Counter | `automation_id`, `reason` (mode/max_exceeded) | Runs dropped due to concurrency mode enforcement. |
| `hs_automation_active_runs` | Gauge | — | Currently active Run count. |
| `hs_automation_pending_commands` | Gauge | — | Currently pending command count. |
| `hs_automation_subscriber_lag` | Gauge | `subscriber_id` | Events behind log head per subscriber. |

All metrics are exposed via JFR continuous recording (LTD-15). No Prometheus or OpenTelemetry export in MVP.

### 11.2 Structured Logging

Key log events follow the structured JSON format per LTD-15 with correlation IDs linking to the Run trace.

| Log Event | Level | Key Fields | When |
|---|---|---|---|
| `automation.run.started` | INFO | `run_id`, `automation_id`, `triggering_event_id`, `mode` | Run begins execution. |
| `automation.run.completed` | INFO | `run_id`, `automation_id`, `final_status`, `duration_ms` | Run reaches terminal state. |
| `automation.run.failed` | WARN | `run_id`, `automation_id`, `error`, `action_index` | Run fails with error. |
| `automation.run.skipped` | DEBUG | `automation_id`, `reason`, `mode` | Run dropped by mode enforcement. |
| `automation.command.dispatched` | DEBUG | `command_event_id`, `target_ref`, `integration_id` | Command handed to adapter. |
| `automation.command.confirmed` | DEBUG | `command_event_id`, `target_ref`, `confirmation_delay_ms` | State confirmation received. |
| `automation.command.timed_out` | WARN | `command_event_id`, `target_ref`, `timeout_ms` | Confirmation timeout. |
| `automation.reload` | INFO | `automation_count`, `validation_errors`, `duration_ms` | Definition reload completed. |
| `automation.conflict` | WARN | `triggering_event_id`, `automation_ids[]`, `entity_ref` | Contradictory commands detected. |
| `automation.disabled` | WARN | `automation_id`, `reason`, `failure_count` | Auto-disabled due to repeated failures. |

### 11.3 Health Indicator

The Automation Engine reports a composite health indicator combining the engine subscriber, command dispatch subscriber, and pending command ledger subscriber.

| State | Condition |
|---|---|
| `HEALTHY` | All three subscribers are within acceptable lag. No automations auto-disabled. Pending command timeout rate below threshold. |
| `DEGRADED` | One or more automations auto-disabled, or any subscriber lag exceeds 100 events, or pending command timeout rate exceeds 20% over 5-minute window. |
| `UNHEALTHY` | Any subscriber checkpoint expired, or automation engine subscriber cannot process events (exception in main loop). |

---

## 12. Security Considerations

This subsystem has no direct external interface — all access is through the Event Bus (internal) and the Configuration System (file-based). However, automation definitions constitute executable logic that controls physical devices, warranting security consideration.

**Automation definition as executable policy.** An automation that turns off all lights, unlocks all doors, or disables the alarm system is a significant security surface. Automation definitions are loaded from `automations.yaml`, which is a local file on the deployment host. Access to this file is governed by the file system permissions enforced by the systemd service configuration (LTD-13, `ProtectSystem=strict`). The `homesynapse` service user has read access; modification requires root or a designated admin user.

**Command validation.** All commands issued by automations are validated against capability schemas via `CommandValidator` (Doc 02 §8.1) before dispatch. An automation cannot issue a command that the target entity's capability does not support. This prevents malformed YAML from producing invalid protocol-level commands.

**No template injection.** Automation definitions are data (YAML parsed by SnakeYAML Engine per LTD-09), not code. There is no template engine, no expression language, and no scripting runtime in Tier 1. Conditions and triggers evaluate against a fixed set of predicate types with typed parameters. This eliminates the injection surface that affects platforms with embedded scripting (Home Assistant's Jinja2 templates, OpenHAB's Xtend DSL).

**Event category classification.** All automation subsystem events carry `event_category: ["automation"]` in the event envelope. Command lifecycle events (`command_issued`, `command_dispatched`, `command_result`, `state_confirmed`, `command_confirmation_timed_out`) carry `["device_state"]` as their primary category; commands targeting energy entity types additionally carry `["device_state", "energy"]`. The `event_category` field is specified in **Event Model & Event Bus** §4.1 (envelope schema) and is populated at event creation time by a static lookup from event type and subject entity type to categories. This classification enables filtered event views by domain and aligns with the consent-scope categories defined in the Data-Readiness Specification for future access-control and crypto-shredding scope alignment (INV-PD-07).

---

## 13. Testing Strategy

### 13.1 Unit Tests

- **Trigger evaluation:** For each trigger type, test matching and non-matching events. Include edge cases: null values, type mismatches, boundary values for numeric thresholds.
- **Condition evaluation:** For each condition type, test true/false outcomes. Include compound conditions (nested and/or/not to depth 3). Mock `StateQuery` interface.
- **Concurrency mode enforcement:** For each mode (single, restart, queued, parallel), test behavior when a trigger fires during an active Run. Verify correct event production for skipped, cancelled, and queued Runs.
- **Selector resolution:** For each selector type, test resolution against a mock Entity Registry. Include zero-target, single-target, and multi-target cases. Test deduplication for compound selectors with overlapping results.
- **Deduplication:** Test that multiple triggers on the same automation matching the same event produce one Run.
- **Conflict detection:** Test detection of contradictory commands from different automations targeting the same entity.

### 13.2 Integration Tests

- **End-to-end Run:** Trigger → condition → action → command → dispatch → mock adapter → state report → confirmation. Verify complete event chain with correct causal references.
- **Replay:** Execute a Run in LIVE mode, checkpoint, restart the subscriber in REPLAY mode, and verify that no new events are produced but internal state is correctly rebuilt.
- **Hot reload:** Start a Run with a delay action, reload automations, verify the Run completes on the original definition while new triggers use the updated definition.
- **Crash recovery:** Execute Runs with pending commands, simulate crash (kill subscriber), restart, verify pending command idempotency handling (re-issue IDEMPOTENT, expire NOT_IDEMPOTENT).

### 13.3 Performance Tests

- **Trigger evaluation throughput:** 50 automations, 100 events/sec sustained for 60 seconds on RPi 5. Measure p99 evaluation latency.
- **Concurrent Run capacity:** 200 concurrent Runs with 5-second delays. Measure RSS, GC pause frequency, and action completion latency.
- **Command pipeline throughput:** 100 commands/sec through dispatch service. Measure dispatch latency and pending command ledger memory.
- **Hot reload under load:** Reload 100 automations while 50 Runs are active. Measure reload latency and verify no Run disruption.

### 13.4 Failure Tests

- **Repeated Run failure:** Trigger 6 Run failures within 10 minutes. Verify auto-disable and `automation_disabled` event production.
- **Command routing failure:** Issue command to entity with no registered integration. Verify `command_result` with `unroutable` status.
- **Confirmation timeout:** Issue command, mock adapter acknowledges, but never produce matching `state_reported`. Verify `command_confirmation_timed_out` event at deadline.
- **Subscriber checkpoint expiration:** Simulate retention purge ahead of subscriber. Verify `subscriber_checkpoint_expired` event and degraded health.
- **Event storm:** Produce 1000 `state_changed` events in 1 second matching 50 automations. Verify the engine processes all events, respects `max_total_runs`, and recovers to HEALTHY within 30 seconds.

---

## 14. Future Considerations

**Time-based triggers (Tier 2).** The trigger type taxonomy includes `time` and `sun` types with defined schemas. Implementation requires a scheduler that produces synthetic trigger events at scheduled times. The scheduler will be a component within the automation engine, not a standalone subsystem — consistent with the scheduler absorption documented in PROJECT_STATUS.md. The schema is defined now so that `automations.yaml` files can include time triggers that are syntax-valid but produce a clear "not yet implemented" diagnostic.

**Parallel action execution (Tier 2).** The action type taxonomy includes `parallel` as a reserved type. Implementation requires spawning child virtual threads within a Run and joining them before proceeding. The Run trace model accommodates this: each parallel branch produces its own action events with shared `run_id` and `correlation_id`.

**Scene activation (Tier 2+).** Scenes compile to a set of commands. The `activate_scene` action type will resolve a scene definition to its constituent commands and execute them.

**Priority-based conflict suppression (Tier 2).** When conflict detection is proven reliable, a Tier 2 enhancement can suppress lower-priority commands that conflict with higher-priority ones within the same causal window. The priority field exists in the schema now to support this without migration.

**Configurable retry policies (Tier 2).** Per-capability retry policies (retry with backoff for lights, alert without retry for locks) can be implemented by extending the `CommandDefinition` schema in Doc 02. The Pending Command Ledger's timeout event provides the trigger; the retry logic would be a new action type or an extension of the command action.

**DRY_RUN mode (Tier 2).** The processing mode taxonomy includes `DRY_RUN` for automation testing. Implementation requires routing Run trace events to a separate audit log per Doc 01 §3.7. The automation YAML schema can include a `test` mode flag.

---

## 15. Open Questions

1. **Should the `wait_for` action evaluate against event-time or ingest-time for its timeout calculation?**
   Options: (a) Use ingest-time (simpler — `System.currentTimeMillis()` comparison); (b) Use event-time from INV-ES-08 (more correct for delayed events, but requires clock synchronization considerations).
   Needed: Clarify whether any Tier 1 automation pattern requires event-time timeout semantics. The typical use case (wait for light to turn on within 30 seconds) is adequately served by ingest-time.
   Status: **[NON-BLOCKING]** — ingest-time is the implementation default. Event-time semantics can be added as a `wait_for` option without changing the architecture.

2. **Should the automation engine subscribe to `presence_changed` events in Tier 1?**
   Options: (a) Include in subscription filter now, ignore in trigger evaluation until Tier 2 presence triggers are implemented; (b) Exclude from subscription filter, add when presence triggers are implemented.
   Needed: Determine whether any Tier 1 automation pattern benefits from presence events (e.g., "turn off lights when area is vacant" using presence as a condition, not a trigger).
   Status: **[NON-BLOCKING]** — the subscription filter can be updated without architectural change. Currently excluded to minimize unnecessary event processing.

3. **What is the optimal batch size for the automation engine subscriber on RPi 5?**
   Options: Configurable with default 50. May need empirical tuning.
   Needed: Performance testing on RPi 5 hardware during Phase 3 validation gate.
   Status: **[NON-BLOCKING]** — configurable, default is a reasonable starting point.

---

## 16. Summary of Key Decisions

| # | Decision | Choice | Rationale | Section |
|---|---|---|---|---|
| D1 | Execution model | One virtual thread per Run, sequential action execution | Virtual threads are lightweight (~1 KB, LTD-01). Sequential execution is the simplest correct model and matches Glossary §4.4 default. | §3.7 |
| D2 | Concurrency modes | Four modes: single (default), restart, queued, parallel | Adopts Home Assistant's proven model (competitive research Q1). Covers the practical concurrency space. Each mode transition produces events for observability. | §3.6 |
| D3 | Trigger deduplication | By (automation_id, triggering_event_id) — one Run per causal event per automation | Prevents trace ambiguity. Satisfies INV-TO-02. Differs from HA (which produces separate runs per trigger). | §3.5 |
| D4 | Condition evaluation timing | Top-level conditions at trigger time, before mode enforcement | Prevents single-mode automations from blocking on failed conditions. Matches HA's documented behavior. | §3.6 |
| D5 | Execution order | Priority descending, then automation_id ascending (ULID = creation order) | Deterministic, stable across restarts and replays. Satisfies INV-TO-02. No platform in competitive research offers deterministic ordering. | §3.13 |
| D6 | Conflict resolution | Detect-and-warn in Tier 1; both commands execute | Provides observability without introducing complex arbitration. Priority field defined now for Tier 2 suppression. | §3.13 |
| D7 | Replay behavior | Trigger evaluation proceeds; condition evaluation, action execution, and event production suppressed | Rebuilds engine state without side effects. Consumes existing trace events from log. Satisfies Doc 01 §3.7. | §3.10 |
| D8 | Hot-reload semantics | In-progress Runs complete on original definition; new triggers use updated definition | Event-sourced: `definition_hash` (SHA-256) captured in `automation_triggered` event enables verification. No existing platform handles this gracefully (competitive research Q5). | §3.7, C7 |
| D9 | Selector vocabulary | entity_ref, entity (slug), area, label, type, compound (all_of intersection) | Covers HA's four targeting mechanisms. Resolution at trigger time per Identity Model §7.2. Compound selectors use intersection semantics. | §3.12 |
| D10 | Unavailable target handling | Configurable per-action: skip (default), error, warn — always produces event | Addresses universal silent-skip pattern from competitive research Q8. Skip is safe default; error available for safety-critical automations. | §3.9 |
| D11 | Command Pipeline ownership | Doc 07 owns Command Dispatch Service and Pending Command Ledger | Resolves two design gaps tracked in PROJECT_STATUS.md. Unifies the outbound command path within the automation subsystem. | §3.11 |
| D12 | Command tracking | Full intent-to-observation loop: issued → dispatched → result → confirmed/timed_out | No existing platform closes this loop (competitive research Q8). Causal chain links all events. Satisfies INV-ES-06. | §3.11.2 |
| D13 | Automation identity | ULID assigned at first load, stored in companion file, matched by name on reload | Stable identity across definition changes. 30-day retention for removed automations supports temporary removal. | §4.1 |
| D14 | Tier 2 schema reservation | Time, sun, presence, webhook triggers; scene, integration, parallel actions defined in schema but not implemented | Satisfies MVP §10 critical design constraint: every Tier 1 design must accommodate Tiers 2 and 3 without architectural rework. | §3.4, §3.9 |
| D15 | Three separate subscribers | automation_engine, command_dispatch_service, pending_command_ledger on independent virtual threads | Decouples trigger evaluation from command routing and confirmation tracking. Each can checkpoint independently. | §3.2, §3.11 |

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It is governed by the Design Document Template and will be reviewed during architecture review.*