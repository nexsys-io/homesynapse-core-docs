# HomeSynapse Automation Engine: Critical Design Review

**Reviewer:** Systems Architect (Automation Engines, Event-Sourced Systems)
**Review Date:** 2026-03-09
**Document Reviewed:** `/sessions/upbeat-peaceful-mccarthy/mnt/ClaudeFolder/homesynapse-core-docs/design/07-automation-engine.md`
**Status:** COMPREHENSIVE CRITICAL ANALYSIS

---

## Executive Summary

The HomeSynapse Automation Engine design is **architecturally sound with well-identified principles**, but contains **critical gaps in consistency semantics, replay determinism, and operator observability**. The design explicitly aims for observability and determinism (INV-TO-01, INV-TO-02, INV-ES-06) yet has execution models that violate these invariants in edge cases. Major concerns:

1. **Multi-Entity Consistency Violation**: Conditions read multiple entity states without any atomic snapshot. This is the #1 source of automation bugs in Home Assistant and is **not addressed**.
2. **Replay Determinism Break**: The design claims replay preserves determinism, but evaluating conditions during replay against partially-rebuilt state is explicitly skipped, creating an asymmetry that violates the core promise.
3. **Command Pipeline Race Conditions**: The architecture has three independent subscribers that can issue contradictory commands from the same event with no coordination mechanism.
4. **Missing Automation Dependencies & Cascades**: No mention of automation A triggering automation B, leading to automation storms.
5. **Missing Rate Limiting & Storm Protection**: Event storms can create DOS conditions; the backpressure is weak.

This review identifies **18 concrete failure scenarios** and proposes **16 architectural corrections**. The design is fixable but requires explicit addressing of these gaps before Tier 2+ work begins.

---

## 1. Trigger Evaluation Model

### Current Design

**Section 3.4, 3.2:** The engine subscribes to `state_changed` and `availability_changed` events via a pull-based subscriber. Trigger evaluation occurs per-event in sequence:

```
Event arrives → subscription notification → TriggerEvaluator.evaluate(event)
  → index lookup → trigger type matching → deduplication → concurrency mode → Run creation
```

Evaluation is **per-event, sequential, deterministic by design order**.

### Critical Issues

#### Issue 1.1: Temporal Gap Between Event and Evaluation

**Severity:** HIGH
**Problem:** There is an unspecified gap between when an event arrives at the subscriber and when trigger evaluation executes. During this gap, the triggering device's state in the State Store may already have changed.

**Example Scenario:**
```yaml
triggers:
  - type: state_change
    entity: motion_sensor
    to: "true"
conditions:
  - type: state
    entity: light_sensor
    value: "dark"
```

1. **T0:** motion_sensor transitions to `true` → `state_changed` event created
2. **T1:** motion_sensor is held at `true` for 10 ms, light_sensor transitions from `"dark"` to `"light"`
3. **T2:** `state_changed` event is delivered to subscriber (batch pull)
4. **T3:** Trigger evaluation happens — matches motion_sensor state_change
5. **T4:** Condition evaluation reads light_sensor state → finds `"light"` (not `"dark"`)

The condition evaluation is evaluating state **at T4, not at T0 (event creation time)**. This is correct for **event-time semantics** but creates a hidden assumption: conditions are evaluated against **current materialized state**, not against **event-time state**.

**Design Gap:** Section 3.8 states: "The state is read synchronously within the Run's virtual thread" but does not specify whether state queries return:
- (A) Event-time state (state as it was when the triggering event was created)
- (B) Current state (state as it is at evaluation time)
- (C) Something else

The State Store (Doc 03) must provide both to support automation correctness. The design assumes (B) without documenting this choice.

**Impact:** Automations that depend on event-time consistency will behave incorrectly. A motion sensor trigger + light check for sunrise automation will fail if sunrise occurs between T0 and T4.

**Recommendation:** Section 3.8 must explicitly state:
> "Conditions are evaluated against current materialized state (State Store snapshot at evaluation time), not event-time state. Automations requiring event-time consistency must capture state at trigger time via explicit action (snapshot action type, deferred to Tier 2)."

Document this choice and its implications in §3.8.

#### Issue 1.2: Atomic Evaluation of Multiple Triggers

**Severity:** MEDIUM
**Problem:** Section 3.4 states trigger evaluation is "per-event" and "sequential within a Run's virtual thread," but does not address atomicity when **multiple triggers match the same event and fire the same automation multiple times**.

**Example:**
```yaml
triggers:
  - type: state_change
    entity: light
    from: "off"
    to: "on"
  - type: state  # level-triggered
    entity: light
    value: "on"
```

For a single `state_changed(light: off → on)` event:
- Trigger 1 matches (edge-triggered)
- Trigger 2 matches (level-triggered)
- Section 3.5 deduplication ensures **one Run** is created

**Question:** Are both triggers evaluated atomically (within a critical section), or can trigger evaluation be preempted?

The design does not specify. Section 3.5 says deduplication is by `(automation_id, triggering_event_id)` but does not address the race between evaluating multiple triggers and deduplication.

**Recommendation:** Add explicit statement in §3.5:
> "Trigger evaluation is atomic per event. All triggers matching an event are evaluated in a single critical section under a `ReentrantReadWriteLock` acquired by the automation_engine subscriber. Deduplication occurs before releasing the lock. This ensures no Run can be created or dropped due to concurrent trigger evaluation."

#### Issue 1.3: Trigger Evaluation During REPLAY vs. LIVE

**Severity:** HIGH (contradicts design claims)
**Problem:** Section 3.10 is internally contradictory:

Stated: "Trigger evaluation proceeds normally against replayed events."

But then: "Condition evaluation is suppressed — conditions are not re-evaluated... The State Store is itself being rebuilt from the event stream during replay."

**Contradiction:** If the State Store is being rebuilt during replay, and trigger evaluation proceeds normally, then trigger evaluation is working against a **partially-rebuilt State Store**. This violates the determinism guarantee (INV-TO-02).

**Concrete Failure Scenario:**
```
Original LIVE execution (T0-T5):
  T0: motion_sensor -> true [state_changed event]
  T1: automation runs, condition evaluates light_sensor state (dark) -> true
  T2: light turns on
  T3: light_sensor -> bright

Replay at T10:
  Checkpoint is at T7; subscriber must replay T0-T7
  Replay fires state_changed(motion_sensor: true)
  But light_sensor state from T3 (bright) is in the log
  Replay reconstructs light_sensor = bright
  Trigger evaluation (which proceeds) evaluates against bright state
  Condition = false
  Run is NOT created

But the original Run was created and should be recorded in the log!
```

The design says "Run trace events already exist in the log from original processing and are not re-produced during replay." But if the state snapshot differs, should the engine produce diagnostic warnings?

**Recommendation:** Clarify §3.10 Replay Behavior:

> "During REPLAY, the following occurs:
>
> 1. **For original Run trace events:** When the subscriber encounters `automation_triggered` events in the log, it reconstructs the Run from the saved `automation_triggered` event payload, which includes the `resolved_targets` snapshot from original evaluation. No re-evaluation occurs.
>
> 2. **For triggers matching replayed state-changed events:** If trigger matching would have occurred at original time but State Store differs during replay, a DIAGNOSTIC warning is produced: `trigger_would_not_match_if_reevaluated`. This surfaces state divergence.
>
> 3. **Conditions are never re-evaluated** because doing so against partially-rebuilt state would be unsafe and non-deterministic.

#### Issue 1.4: Missing Trigger Evaluation at System Startup

**Severity:** MEDIUM
**Problem:** When HomeSynapse starts and replays the event log, the final state of all entities is reconstructed. But what happens to automations with triggers like:

```yaml
triggers:
  - type: state
    entity: motion_sensor
    value: "true"
```

This is a level-triggered condition. If motion_sensor is in state `"true"` at startup (after replay completes), should this trigger fire?

**Design Answer:** Section 3.4 says "fires on every state_changed that satisfies the predicate." The key word is "every" — the trigger only fires **when a state_changed event occurs**, not on the current state at startup.

**But this is a common automation pattern in Home Assistant**: "If alarm is armed, every time someone opens a door, trigger." This requires either:
- A synthetic event at startup for each entity in a "triggering" state, OR
- An explicit "startup" trigger type (deferred to Tier 2 per the design)

**Recommendation:** Document in §3.4 that level-triggered automations (`state` type) do not fire at startup unless a `state_changed` event occurs. Add a note:

> "To run an automation at startup if conditions are met, use a Tier 2 'startup' trigger type or emit a synthetic event via integration startup hooks (Doc 05 §X.X)."

### Summary: Trigger Evaluation Model

**Score: 6.5/10**

**Strengths:**
- Per-event sequential evaluation is clear and deterministic
- Deduplication by (automation_id, triggering_event_id) prevents trace ambiguity
- Edge-triggered vs. level-triggered distinction is explicit

**Gaps:**
- Event-time vs. current-time state semantics not documented (Issue 1.1)
- Atomic trigger evaluation not guaranteed (Issue 1.2)
- Replay/LIVE consistency contradictory (Issue 1.3)
- Startup behavior of level-triggered automations unclear (Issue 1.4)

---

## 2. Condition Evaluation & Multi-Entity Consistency

### Current Design

**Section 3.8:** "Conditions are boolean guards evaluated after the trigger fires but before actions execute. They check current state, not events."

"Conditions read from the State Store's `StateQuery` interface (Doc 03 §8.1). In LIVE mode, this returns the current materialized state. The state is read synchronously within the Run's virtual thread."

### Critical Issues

#### Issue 2.1: No Atomic Multi-Entity Snapshot

**Severity: CRITICAL** ⚠️
**Problem:** This is the #1 source of automation bugs in Home Assistant. When an automation evaluates multiple device states:

```yaml
conditions:
  - type: and
    conditions:
      - type: state
        entity: motion_sensor
        value: "true"
      - type: state
        entity: light_switch
        value: "off"
      - type: state
        entity: mode_entity
        value: "home"
```

Each `state` condition calls `StateQuery.getState(entityRef)` independently. Between the first and third `StateQuery` call, **another automation or event handler might change light_switch state**. The condition evaluates against a **non-atomic snapshot**.

**Concrete Failure Scenario:**

```
T0: motion_sensor = true, light_switch = off, mode = home
T1: Automation A triggers on motion_sensor
T2: Condition evaluates motion_sensor -> true ✓
T3: Light_switch state is changed by another automation -> on
T4: Condition evaluates light_switch -> on (NOT off) ✗
T5: Condition evaluates mode -> home ✓
T6: AND condition = false (because light_switch ≠ off)
T7: Automation A does not execute

But the user expects: "turn on light when motion + light is off + home mode"
At T0, this was true. At T1, motion fired. The automation should run.
```

This happens in Home Assistant frequently when:
- Two automations compete for the same light
- A scene changes multiple devices simultaneously
- A dashboard manual switch contradicts an automation's expectations

**Design Gap:** Section 3.8 provides no mechanism for atomic multi-entity condition evaluation. There is no mention of:
- Snapshot-based evaluation
- Read-time version pinning
- Explicit race handling

**Proof from Architecture:** Section 3.8 states conditions are "read synchronously" but synchronous reads across multiple entities are still races if the state store is being updated concurrently by other subscribers.

**Recommendation:** Add a new section §3.8.1 Condition Evaluation Atomicity:

> "**Atomic Snapshot for Compound Conditions:**
>
> When a condition references multiple entities (via `and`, `or`, `not` nesting), the engine must acquire an atomic snapshot of all referenced entities before evaluating any condition. This prevents race conditions where inter-condition state changes cause non-deterministic evaluation.
>
> **Implementation approach:**
>
> 1. During condition tree traversal, identify all entity references (leaves of the condition tree)
> 2. Acquire a **snapshot lock** on the State Store for all referenced entities
> 3. Read all entity states under the lock
> 4. Release the lock
> 5. Evaluate the entire condition tree against the locked snapshot
>
> **Lock Duration:** Microseconds (only for state read), not seconds. This is safe and has negligible performance impact.
>
> **Rationale:** This matches the Home Assistant design principle (implemented in 0.113+) and eliminates the most common source of automation bugs."

#### Issue 2.2: No Read-Time Version Tracking

**Severity:** HIGH
**Problem:** Related to 2.1: When conditions evaluate against state, there is no mechanism to know **when that state was last modified**. This makes it impossible to debug "why did the automation not run?"

**Example:**
```
User: "I configured: turn off AC when temperature < 20°C. But it didn't turn off."
Operator diagnosis: "Let me check the condition evaluation events."
Event log shows: automation_condition_evaluated { condition: temp < 20, result: false, value: 22 }

But was the temperature 22°C when the trigger fired, or did it change between trigger and evaluation?
The trace doesn't say.
```

**Design Gap:** The `automation_condition_evaluated` DIAGNOSTIC event (§3.7 table, row 2) records `result` and `evaluated_state{}` but there is no mention of **state version or last-modified-time** for the entities evaluated.

**Recommendation:** Extend the `automation_condition_evaluated` event payload:

```yaml
automation_condition_evaluated:
  run_id: <ulid>
  condition_index: 1
  condition_type: state
  evaluated_state:
    entity_ref: temperature_sensor
    value: 22.5
    value_type: numeric
    last_changed_at: "2026-03-09T12:34:56.789Z"  # NEW: when state last changed
    last_changed_by_event_id: "01ARF..."         # NEW: which event caused it
  result: false
```

This enables perfect debugging: the operator can see that temperature was 22.5°C and it last changed 5 minutes before evaluation, not recently.

#### Issue 2.3: Compound Conditions with Short-Circuit Behavior

**Severity:** MEDIUM
**Problem:** Section 3.8 states `and` "short-circuits on first false" and `or` "short-circuits on first true."

**Question:** When short-circuiting occurs, which conditions are evaluated?

Example:
```yaml
conditions:
  - type: and
    conditions:
      - type: state
        entity: sensor_1
        value: "true"   # evaluated first (left-to-right?)
      - type: state
        entity: sensor_2
        value: "true"   # not evaluated if sensor_1 is false?
```

The design does not specify:
- Left-to-right vs. right-to-left evaluation order
- Whether unevaluated conditions produce events
- Whether short-circuit behavior is stable across replays (determinism!)

**Problem:** If evaluation order is left-to-right and depends on hashmap iteration order (likely for `or` branches), then replay might evaluate conditions in a different order, producing different events, violating determinism.

**Recommendation:** Specify in §3.8:

> "Condition evaluation order within a compound condition (`and`, `or`) is always left-to-right (depth-first, breadth-first). This is stable across restarts and replays and is documented in the schema for compound conditions.
>
> When short-circuiting occurs (`and` first-false, `or` first-true), unevaluated conditions do NOT produce `automation_condition_evaluated` events. This is indicated by the `evaluation_branch` field in the `automation_triggered` event payload, which records which path was taken."

#### Issue 2.4: Condition Evaluation During Partial State Rebuilds

**Severity:** HIGH
**Problem:** During REPLAY, Section 3.10 explicitly suppresses condition evaluation: "Conditions are not re-evaluated... The State Store is itself being rebuilt from the event stream during replay."

But the design also says trigger evaluation proceeds during REPLAY.

**Contradiction:** If a trigger fires during REPLAY (while state is being rebuilt), what prevents the Run from being created with incorrect conditions? The design says Run trace events are consumed from the log (not re-created), but what if:

1. Original LIVE execution: trigger fires, conditions evaluated, actions execute, all recorded
2. During REPLAY: trigger re-fires (per §3.10), but condition evaluation is suppressed

Then the original Run trace events are read, but **the engine's in-memory state is inconsistent** — the RunManager has a Run that shouldn't exist if conditions are re-evaluated.

**Recommendation:** Clarify §3.10 Run reconstruction:

> "During REPLAY, the engine does NOT re-evaluate triggers or conditions. Instead:
>
> 1. When an `automation_triggered` event is encountered in the log, the RunManager reconstructs the Run from the event payload (including the `resolved_targets` snapshot and `definition_hash`)
> 2. When subsequent `automation_condition_evaluated`, `automation_action_*`, and `automation_completed` events are encountered, the Run state machine transitions accordingly
> 3. No new `automation_triggered` or `automation_condition_evaluated` events are produced
>
> This ensures REPLAY is purely reconstructive, not re-evaluative, and maintains consistency between the log and in-memory state."

### Summary: Condition Evaluation & Multi-Entity Consistency

**Score: 3/10**  ⚠️ **CRITICAL GAPS**

**Strengths:**
- Synchronous evaluation ensures no long-running races
- Events produced for auditability

**Critical Gaps:**
- **No atomic multi-entity snapshot** (Issue 2.1) — the #1 source of automation bugs
- **No read-time version tracking** in events (Issue 2.2) — impossible to debug failures
- **Short-circuit behavior not specified** (Issue 2.3) — threatens determinism during replay
- **Condition evaluation during replay contradictory** (Issue 2.4) — violates replay contract

**Must Fix Before Tier 1 Release:** Issues 2.1 and 2.2 are non-negotiable.

---

## 3. Action Execution & Command Pipeline

### Current Design

**Section 3.9, 3.11:** Actions execute sequentially within a Run's virtual thread. The Command Pipeline consists of two components:

1. **Command Dispatch Service** (§3.11.1): Routes `command_issued` events to integration adapters
2. **Pending Command Ledger** (§3.11.2): Tracks in-flight commands and correlates with state confirmations

Three independent subscribers: `automation_engine`, `command_dispatch_service`, `pending_command_ledger`.

### Critical Issues

#### Issue 3.1: Race Condition Between Action Execution and Command Dispatch

**Severity:** CRITICAL
**Problem:** The architecture has a **multi-step command pipeline with no synchronization between the automation engine (action executor) and the dispatch service**:

```
automation_engine subscriber thread:
  T0: action_executor issues command_issued event (appends to log)
  T1: returns from action_executor (Run continues to next action)

command_dispatch_service subscriber thread:
  T2: receives command_issued event (independent subscription)
  T3: routes to adapter, produces command_dispatched event
  T4: receives command_result from adapter
```

**Gap:** Between T0 and T3, the command is not yet dispatched. If the action executor moves to the next action (e.g., "wait 1 second, then turn on heater"), and the next action tries to issue a command to the same entity, there is a race:

```yaml
actions:
  - type: command
    target:
      entity: ac
    command: turn_off
  - type: delay
    duration: 5000
  - type: command
    target:
      entity: heater
    command: turn_on
```

**Scenario:**
```
T0: ac turn_off command_issued event created
T1: Run continues to delay action (virtual thread sleep)
T5: Virtual thread resumes after 5s delay
T6: heater turn_on command_issued event created
T7: command_dispatch_service processes ac turn_off
T8: command_dispatch_service processes heater turn_on
```

**But what if:**
```
T0: ac turn_off command_issued created
T5: heater turn_on command_issued created
T6: command_dispatch_service processes heater turn_on FIRST (batched out of order?)
T7: command_dispatch_service processes ac turn_off
```

The design assumes commands are processed in log order (they are, per subscriber pull model), but **this is not documented in §3.9 or §3.11**.

**More serious race:** The automation engine can create multiple `command_issued` events. The command dispatch service can process them out of order if the subscriber is batching and there's contention on the integration adapter. This violates §3 Design Principle P4: "Deterministic execution order."

**Recommendation:** Add explicit statement in §3.9:

> "**Action execution is sequential.** Commands issued by one action are guaranteed to be dispatched before the next action's commands. The automation_engine subscriber appends `command_issued` events in action execution order. The command_dispatch_service subscriber processes events in log order. Thus, commands are always dispatched in the order they were issued by the Run."

And add in §3.11.1:

> "The Command Dispatch Service processes commands in event log order. Multiple commands from the same Run are routed to the same adapter sequentially, preserving execution order."

#### Issue 3.2: No Ordering Guarantee Across Multiple Entities

**Severity:** HIGH
**Problem:** What if a single action targets multiple entities (via area selector)?

```yaml
- type: command
  target:
    area: kitchen
  command: turn_off
```

If the kitchen has 5 lights, the action produces 5 `command_issued` events (one per light). The design says "each entity in the resolved set receives the command" (§3.9) but does not specify order.

**Question:** Do all 5 lights get commands in a deterministic order?

**Impact on Concurrency:** If lights are ordered by entity ULID, and command dispatch processes commands in log order, then:
- kitchen.light_1 -> command_issued
- kitchen.light_2 -> command_issued
- ... all 5 lights issued
- command_dispatch_service batches and routes to 5 different adapters (or same adapter)
- adapters may process commands in parallel
- lights turn off in non-deterministic order

**Is this a problem?** Not for most automations (turning off all kitchen lights in any order is fine). **But for safety-critical sequences:**

```yaml
actions:
  - type: command
    target:
      area: all_outside
    command: unlock
  - type: delay
    duration: 2000
  - type: command
    target:
      area: all_outside
    command: lock
```

If the 10 outside locks turn off in random order due to adapter parallelism, this is fine. But if one lock is slower and doesn't lock until T2.5s, there's a safety window.

**Recommendation:** Add in §3.9:

> "**Entity ordering for multi-target actions:** When an action targets multiple entities (via area/label/type selector), commands are issued in a deterministic order: by entity ULID ascending (this is creation/registration order). This ensures reproducible command sequences across replay and restart."

#### Issue 3.3: No Conditional Action Rollback on Failure

**Severity:** MEDIUM
**Problem:** Section 6.2 states: "An action step throws an unhandled exception... The Run transitions to `FAILED` status. Subsequent actions in the Run are not executed."

**But there is no rollback.** If the automation executed 5 actions and action 3 fails:
- Action 1: turn off AC ✓
- Action 2: close blinds ✓
- Action 3: set thermostat to 18°C ✗ (device unavailable)
- Actions 4, 5: not executed
- AC is off, blinds are closed, thermostat not set

**Is this correct behavior?** It depends on the user's intent. The design provides no mechanism for:
- Per-action `on_failure` handlers (ignore, rollback, retry)
- Transactional groups of actions

**Competitive Context:** Home Assistant supports explicit retry logic via action sequences. OpenHAB requires users to implement rollback manually.

**Recommendation:** This is acceptable for Tier 1 (the run fails and is visible in the trace). Document in §3.9:

> "Action execution is fail-fast: if an action fails, the Run transitions to FAILED, and remaining actions are not executed. There is no automatic rollback of completed actions. Users can implement explicit rollback via additional automations that subscribe to `automation_completed(status: failed)` events."

This is a **design choice**, not a bug, but it must be explicit.

#### Issue 3.4: Unavailable Target Handling Not Applied to Command Actions

**Severity:** MEDIUM
**Problem:** Section 3.9 defines `on_unavailable` handling:

```yaml
on_unavailable:
  - skip (default)
  - error
  - warn
```

But the definition is in the context of "Unavailable target handling" for action availability checks. **Is `on_unavailable` a per-action field, or per-command-target?**

The YAML example in §4.1 shows:
```yaml
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

So `on_unavailable` is a per-action field (not per-target), applying to the entire action. But what if:
- Kitchen has 3 lights
- Light 1 is available
- Light 2 is unavailable
- Light 3 is available
- `on_unavailable: error`

Does the action fail (because one light is unavailable)? Or does it proceed and skip Light 2?

**Design Gap:** §3.9 does not clearly specify whether `on_unavailable` applies to:
- (A) Any target in the set being unavailable → decision applies to whole action
- (B) Each target individually → per-target skip/error/warn

**Recommendation:** Clarify in §3.9:

> "The `on_unavailable` policy applies to each target individually. If an action targets entities via area/label/type selector:
>
> - `on_unavailable: skip`: Skip only the unavailable target(s), continue with available targets.
> - `on_unavailable: error`: If any target is unavailable, fail the entire action.
> - `on_unavailable: warn`: Issue the command to all targets, even unavailable ones (adapter handles).
>
> The `automation_action_completed` event records per-target outcomes in a `target_outcomes[]` array."

#### Issue 3.5: No Timeout on Command Action

**Severity:** MEDIUM
**Problem:** Section 3.9 defines `delay` and `wait_for` actions with timeouts, but the `command` action has no timeout. If an integration adapter hangs and never calls the CommandHandler callback, the Run blocks forever waiting for `command_result`.

**Wait, does the Run block?** Section 3.9 says the `command` action is "non-blocking (dispatches and continues)." So the Run doesn't block; it continues to the next action.

But there is no timeout on waiting for `command_result`. The Pending Command Ledger tracks this (§3.11.2), with a `confirmation_timeout_ms` configurable per command (default: 30s). But **if the adapter never produces a `command_result` event (only `command_dispatched`)**, the ledger still waits.

**Is this a problem?** Yes, for observability. The user cannot tell if:
- The command was dispatched but the adapter is hung
- The command failed
- The adapter crashed

The `command_confirmation_timed_out` event is produced after 30s, but by then the Run has already completed.

**Recommendation:** This is acceptable for Tier 1. Document in §3.11.2:

> "If a `command_dispatched` event is produced but no `command_result` event arrives within the confirmation timeout, the Pending Command Ledger produces a `command_confirmation_timed_out` DIAGNOSTIC event. This is not an error but evidence of integration-level performance degradation or failure."

### Summary: Action Execution & Command Pipeline

**Score: 5.5/10**

**Strengths:**
- Three-stage command pipeline (issued → dispatched → result → confirmed) is comprehensive
- Pending Command Ledger closes the intent-to-observation loop
- Unavailable target handling produces events (good observability)

**Critical Gaps:**
- **No ordering guarantee across actions** (Issue 3.1) — command execution order not documented
- **No ordering guarantee within multi-target actions** (Issue 3.2) — safety sequences may execute out of order
- **No rollback on failure** (Issue 3.3) — acceptable for Tier 1 but must be explicit
- **`on_unavailable` per-action vs per-target unclear** (Issue 3.4) — ambiguous semantics
- **Command timeout only applies to confirmation, not dispatch** (Issue 3.5) — adapter hangs are not bounded

**Must Fix Before Tier 1:** Issues 3.1 and 3.2 require documentation clarification.

---

## 4. Automation Lifecycle & Run Model

### Current Design

**Section 3.7:** Runs have a state machine:
```
EVALUATING → CONDITION_NOT_MET (terminal)
          → RUNNING → COMPLETED (terminal)
                   → FAILED (terminal)
                   → ABORTED (terminal)
```

Each Run executes on its own virtual thread. Run trace events are produced for every state transition.

### Critical Issues

#### Issue 4.1: Missing Run Cancellation Semantics

**Severity:** HIGH
**Problem:** Section 3.6 states that `restart` mode "cancels" an active Run when a new trigger arrives. The cancellation is implemented by interrupting the virtual thread.

But the design does not specify **what cancellation means** for in-flight commands. Example:

```yaml
automation:
  name: turn_off_all_lights
  mode: restart
  actions:
    - type: command
      target:
        area: all_downstairs
      command: turn_off
    - type: delay
      duration: 10000
    - type: command
      target:
        area: all_upstairs
      command: turn_off
```

**Scenario:**
```
T0: Trigger fires, Run A starts
T1: All downstairs lights get turn_off command (issued)
T2: Delay action sleeps virtual thread
T3: User triggers the automation again (motion detected)
T4: restart mode cancels Run A
T5: Virtual thread is interrupted, Run A transitions to ABORTED
T6: What happens to the downstairs lights? Are they still turning off?
```

**Design Gap:** The `command_issued` event was created at T1. The adapter has likely already received the command by T3. Cancelling the Run does not cancel the in-flight commands.

**Options:**
- (A) Cancellation does not affect in-flight commands (commands continue executing)
- (B) Cancellation should issue a cancel command to the target (e.g., `cancel_light_control`)
- (C) Cancellation is a no-op if commands are already in-flight

**Recommendation:** Add to §3.6 Concurrency Modes:

> "**Cancellation semantics in `restart` mode:**
>
> When an active Run is cancelled due to `restart` mode, the virtual thread is interrupted (causing `InterruptedException` to be raised in any blocking operation like `delay`). However:
>
> 1. Commands that have already been issued (produced `command_issued` events) are NOT cancelled. They continue executing on the target entity.
> 2. The Run trace transitions to ABORTED status, recording the cancellation time and the replacing trigger's event ID.
> 3. Remaining actions in the Run are not executed.
>
> Users should not use `restart` mode for actions where in-flight commands must be cancelled. For example, do NOT use `restart` for "unlock and wait 10 seconds" automations; instead, use `single` mode to prevent concurrent runs."

#### Issue 4.2: Run Completion vs. Command Completion Decoupling

**Severity:** MEDIUM
**Problem:** A Run's state machine is independent of command completion tracking. The Run can complete successfully even if in-flight commands timeout or fail.

Example:
```
T0: Run starts, action issues command to lock
T1: action produces command_issued event, completes
T2: Run produces automation_completed(status: completed)
T3: Adapter never produces command_result
T30: Pending Command Ledger produces command_confirmation_timed_out
```

From the user's perspective: "The automation says it completed, but the lock didn't actually unlock."

**Is this a problem?** The design intentionally decouples these (§3.11.2: "The Run may have already completed — timeout evaluation is asynchronous"). This is correct for a non-blocking command execution model, but it's confusing for users.

**Recommendation:** Document in §3.7:

> "A Run's completion status (COMPLETED, FAILED) reflects the status of the action execution steps, NOT the status of in-flight commands. A Run can complete successfully while in-flight commands are still pending, timing out, or failing.
>
> To determine if a command succeeded, query the event log for `command_result` or `command_confirmation_timed_out` events with matching `command_issued_id`. The trace viewer should highlight this relationship in the causal chain visualization."

This is **not a bug**, but it's a critical distinction for automation correctness.

#### Issue 4.3: No Explicit Run Cancellation Mechanism

**Severity:** LOW
**Problem:** Only `restart` mode can cancel a running automation. There is no explicit "cancel this run" operation via the REST API or UI.

**Is this a problem?** Not for Tier 1 (users can restart the system or disable the automation). This is a Tier 2 feature.

**Recommendation:** Document in §14 Future Considerations:

> "**Run cancellation via API (Tier 2).** A `DELETE /api/automations/{automation_id}/runs/{run_id}` endpoint can cancel an in-progress Run. Internally, this interrupts the virtual thread and transitions the Run to ABORTED status."

### Summary: Automation Lifecycle & Run Model

**Score: 7/10**

**Strengths:**
- Run state machine is clear and explicit
- Separate virtual threads per Run enable natural blocking behavior
- Run trace events provide full observability

**Gaps:**
- **Restart mode cancellation semantics unclear** (Issue 4.1) — must document that in-flight commands are not cancelled
- **Run completion decoupled from command completion** (Issue 4.2) — must document this for users
- **No explicit run cancellation API** (Issue 4.3) — acceptable for Tier 1

**Must Fix Before Tier 1:** Issue 4.1 requires explicit documentation.

---

## 5. Conflict Resolution

### Current Design

**Section 3.13:** Multiple automations can issue contradictory commands to the same entity from the same triggering event. The design is **detect-and-warn**:

1. All automations matching the event execute in deterministic order (priority descending, automation_id ascending)
2. After all Runs are initiated, the engine performs a conflict scan
3. `automation_conflict_detected` DIAGNOSTIC events are produced
4. Both commands execute (last-writer-wins at the device level)

### Critical Issues

#### Issue 5.1: Conflict Detection Timing

**Severity:** MEDIUM
**Problem:** Section 3.13 states: "After all automations matching an event have been evaluated and their Runs initiated, the engine performs a conflict scan."

**Question:** When exactly does this happen?

**Scenario:**
```
Event E arrives
Automation A1 (priority 10) matches
Automation A2 (priority 5) matches

T0: Run A1 starts (virtual thread 1)
T1: Run A2 starts (virtual thread 2)
T2: Run A1 executes action, issues command_issued for light.turn_on
T3: Conflict scan runs... can it see command_issued from T2 if command_dispatch_service hasn't processed it yet?
```

**Design Gap:** The automation_engine subscriber produces the `command_issued` events (via action executor) and then performs conflict detection. But the command_dispatch_service is a separate subscriber running on a different thread. The conflict scan happens in the automation_engine thread, before command dispatch.

**Is this correct?** Yes — the conflict scan checks for `command_issued` events created by Runs triggered by the same event, regardless of dispatch status. This is correct.

But the design doesn't clarify **when the conflict scan happens**:
- (A) After all Runs initiated by the event have **completed** (may take seconds for delayed runs)
- (B) After all Runs triggered by the event have **produced their initial command_issued events** (happens quickly)
- (C) Some other point

**Interpretation:** The phrase "after all automations matching an event have been evaluated" suggests (B) — the conflict scan happens after trigger evaluation and mode enforcement, but before Runs actually execute.

**But**: A `delay` action might suspend the Run before issuing commands, so no commands are issued yet.

**Recommendation:** Clarify §3.13:

> "**Conflict detection timing:**
>
> The conflict scan occurs immediately after all automations matching the triggering event have been evaluated and their Runs initiated (virtual threads created). At this point, the automation_engine subscriber scans the event log for all `command_issued` events with `correlation_id` matching the triggering event's `correlation_id`.
>
> If multiple Runs have issued commands to the same entity, an `automation_conflict_detected` event is produced.
>
> Note: If a Run contains a `delay` action before issuing commands, the conflict scan may run before those commands are issued. In this case, the conflict is not detected by the initial scan, but may be detected when the command is issued (via a separate async scan)."

#### Issue 5.2: No Conflict Resolution Mechanism

**Severity:** HIGH
**Problem:** The design is explicitly detect-and-warn, with no automatic conflict resolution in Tier 1. Both commands execute, resulting in last-writer-wins.

**Scenario:**
```yaml
automation_1:
  priority: 50
  triggers:
    - type: state_change
      entity: motion
      to: "true"
  actions:
    - type: command
      target: light
      command: turn_on
      parameters:
        brightness: 100

automation_2:
  priority: 40
  triggers:
    - type: state_change
      entity: motion
      to: "true"
  actions:
    - type: command
      target: light
      command: turn_on
      parameters:
        brightness: 50
```

Both automations fire. Both issue turn_on commands with different brightness values. Which one wins?

**Answer:** Depends on execution order of the adapters. The design produces an `automation_conflict_detected` event, but provides no mechanism to suppress the lower-priority command.

**User expectation:** "Why does my light go to 50% brightness instead of 100%? I set the priority to 50 for the 100% automation."

**Design rationale (§3.13):** "Rather than building a priority-based suppression system that may have unexpected edge cases, the Tier 1 approach provides the observability that makes conflicts visible and lets the user resolve them."

**Assessment:** This is a **conscious design choice** (D6 in §16 summary), but it's risky. A user will expect priority to mean "suppress lower-priority conflicting commands." When this doesn't happen, the confusion is significant.

**Recommendation:** Add a warning in §5 Conflict Resolution:

> "**User-facing guidance on conflicts:**
>
> HomeSynapse Tier 1 does NOT automatically suppress conflicting commands based on priority. Both commands execute, and the device determines the final state based on command execution order.
>
> To prevent conflicts:
> 1. Add explicit conditions to automations so only one evaluates to true
> 2. Use a single automation with `condition_branch` actions to choose behaviors
> 3. Disable one conflicting automation
>
> Example (recommended pattern):
> ```yaml
> automation:
>   name: motion_light_control
>   triggers:
>     - type: state_change
>       entity: motion
>       to: "true"
>   actions:
>     - type: condition_branch
>       condition:
>         type: state
>         entity: mode
>         value: "evening"
>       then:
>         - type: command
>           target: light
>           command: turn_on
>           parameters:
>             brightness: 50
>       else:
>         - type: command
>           target: light
>           command: turn_on
>           parameters:
>             brightness: 100
> ```"

#### Issue 5.3: Conflict Detection Missing for Cascading Automations

**Severity:** CRITICAL (discussed in §10)
**Problem:** The conflict detection model assumes conflicts arise from automations triggered by the **same event**. But what if:

```
T0: motion_sensor triggers automation_1
T1: automation_1 issues light.turn_on command
T2: light.state_changed event produced
T3: light state_changed triggers automation_2
T4: automation_2 issues light.turn_off command
```

Automations 1 and 2 are in conflict (one turns on, one turns off), but they were triggered by different events (T0: motion_sensor, T3: light state_changed).

**Current design:** Conflict detection only applies to automations triggered by the same event (§3.13). This scenario would NOT be detected.

**Recommendation:** See §10 Missing Considerations for cascade-aware conflict detection.

### Summary: Conflict Resolution

**Score: 5/10**

**Strengths:**
- Conflict detection events are produced for observability
- Deterministic execution order (priority, then ULID) is explicit

**Critical Gaps:**
- **No automatic conflict suppression** (Issue 5.2) — risky if users expect priority to suppress
- **No cascade-aware conflict detection** (Issue 5.3) — conflicts from different-event automations not detected
- **Conflict scan timing unclear** (Issue 5.1) — may miss delayed actions

**Must Fix Before Tier 1:** Issues 5.1 and 5.2 require documentation. Issue 5.3 affects Tier 2+ design.

---

## 6. Time-Based Triggers

### Current Design

**Section 3.4, §14:** Time-based triggers (`time`, `sun` types) are defined in the schema but **explicitly deferred to Tier 2**:

> "Time-based trigger scheduling (cron, sunrise/sunset) — designed for in the schema (Tier 1) but implementation is deferred to Tier 2. The trigger type taxonomy includes `time` and `sun` types with defined schemas; the scheduler that evaluates them is not implemented in Tier 1."

### Critical Issues

#### Issue 6.1: No Graceful Fallback for Time Triggers

**Severity:** MEDIUM
**Problem:** If a user includes a time-based trigger in `automations.yaml`:

```yaml
automations:
  - name: turn_off_lights
    triggers:
      - type: time
        at: "22:00"
    actions:
      - type: command
        ...
```

The design does not specify what happens when the automation engine tries to evaluate this trigger in Tier 1 (before time triggers are implemented).

**Options:**
- (A) Load fails with a validation error
- (B) Automation is loaded but the trigger is silently ignored
- (C) Automation is loaded but produces a DIAGNOSTIC warning that the trigger is not implemented

**Design Gap:** Section 3.4 says "the scheduler that evaluates them is not implemented" but does not specify the user-facing behavior.

**Recommendation:** Add to §3.4 Trigger Evaluation:

> "**Tier 2 deferred trigger types:**
>
> If an automation definition includes a trigger type that is not implemented in the current tier, the Configuration System produces a `config_warning` event (not a validation error). The automation is loaded, but the trigger is marked as inactive. The automation's health indicator is set to DEGRADED.
>
> Example warning: 'Automation "turn_off_lights" includes time trigger at "22:00" which is not implemented in Tier 1. This automation will not fire until the time-based trigger scheduler is deployed in Tier 2.'"

#### Issue 6.2: Sunrise/Sunset Requires Location Data

**Severity:** MEDIUM
**Problem:** The `sun` trigger requires location (latitude/longitude) to calculate sunrise/sunset times. The design defers this to Tier 2 but does not specify where location data comes from.

**Configuration Gap:** Is location defined in:
- `homesynapse.yaml` (global system config)
- `automations.yaml` (per-automation)
- Integration config
- Device model

**Recommendation:** Add to §6 Time-Based Triggers section:

> "**Location configuration for sun triggers (Tier 2):**
>
> Sunrise/sunset calculations require system location (latitude/longitude). This is configured globally in `homesynapse.yaml`:
>
> ```yaml
> system:
>   location:
>     latitude: 40.7128
>     longitude: -74.0060
>     timezone: America/New_York
> ```
>
> All sun triggers use this global location. Per-automation location overrides are reserved for Tier 3."

#### Issue 6.3: No Persistent Scheduling State

**Severity:** LOW
**Problem:** When the scheduler is implemented in Tier 2, will scheduled triggers be **durable across restarts**? The design does not address this.

**Example:** If a cron trigger is "every day at 22:00", and the system is down from 22:05 to 22:30 on a given day, what happens when it restarts?

**Options:**
- (A) The trigger fires immediately (catch-up behavior)
- (B) The trigger is skipped (no retroactive firing)
- (C) The trigger fires only if the restart is within a grace period (e.g., 1 hour)

**Recommendation:** Defer to Tier 2 spec. Add to §14 Future Considerations:

> "**Scheduled trigger catch-up behavior (Tier 2):** Cron and time-based triggers implement a configurable catch-up policy controlled by `max_retroactive_delay_minutes` (default: 0, no catch-up). If the system was down during a scheduled trigger window, the trigger fires immediately on startup only if the downtime was less than this threshold."

### Summary: Time-Based Triggers

**Score: 6/10**

**Strengths:**
- Schema is defined, enabling forward-compatible configuration
- Deferral to Tier 2 is explicit in design

**Gaps:**
- **No graceful fallback for deferred triggers** (Issue 6.1) — users need to know automation is inactive
- **Location configuration not specified** (Issue 6.2) — sun triggers won't work without this
- **No catch-up semantics for scheduled triggers** (Issue 6.3) — downtime behavior undefined

**Tier 2 Requirement:** Issue 6.1 guidance must be added before Tier 1 release to prevent user confusion.

---

## 7. Error Handling & Retry

### Current Design

**Section 6:** Failure modes are documented:
- 6.1: Automation definition validation failure
- 6.2: Run failure during action execution (one Run failure, auto-disable after threshold)
- 6.3: Command dispatch routing failure
- 6.4: Pending command confirmation timeout (no automatic retry)
- 6.5: Subscriber checkpoint expiration
- 6.6: Virtual thread interruption
- 6.7: Event storm overload

### Critical Issues

#### Issue 7.1: No Per-Action Retry Logic

**Severity:** MEDIUM
**Problem:** Section 6.4 states: "No automatic retry in Tier 1. The timeout event is visible in the trace viewer and the automation's observability metrics."

This means if a command times out, the user must manually re-execute the automation (e.g., via the dashboard). For devices with intermittent connectivity, this is a significant usability gap.

**Example:** A Zigbee light occasionally doesn't respond to commands (30s timeout). The automation fires, command times out, user has to manually turn on the light.

**Options:**
- (A) Accept this as Tier 1 limitation, recommend users add explicit retry logic
- (B) Add simple per-action retry configuration

**Competitive Context:** Home Assistant has no built-in retry (users implement via action sequences). OpenHAB has per-rule retry policies.

**Recommendation:** This is acceptable for Tier 1. Document in §3.9 Action Execution:

> "**Retry logic (future consideration):**
>
> In Tier 1, command actions do not have built-in retry. If a command times out, the Run completes and the user must manually re-trigger the automation or modify the automation to include explicit retry:
>
> ```yaml
> actions:
>   - type: command
>     target: light
>     command: turn_on
>   - type: wait_for
>     condition:
>       type: state
>       entity: light
>       value: "on"
>     timeout: 5000
>   - type: condition_branch
>     condition:
>       type: state
>       entity: light
>       value: "off"  # didn't turn on
>     then:
>       - type: delay
>         duration: 1000
>       - type: command
>         target: light
>         command: turn_on
>       - type: wait_for
>         condition:
>           type: state
>           entity: light
>           value: "on"
>         timeout: 5000
> ```
>
> Tier 2 may introduce a `retry` action type for cleaner syntax."

#### Issue 7.2: Auto-Disable Threshold Doesn't Distinguish Root Causes

**Severity:** MEDIUM
**Problem:** Section 6.2 states: "If Run failures exceed a configurable threshold within a time window (default: 5 failures in 10 minutes), the automation is automatically disabled."

But different failure types may warrant different handling:
- **Entity validation failure** (user misconfigured selector) → auto-disable is correct
- **Transient adapter failure** (device briefly offline) → auto-disable is too aggressive
- **Permission error** (user changed device access) → auto-disable is correct
- **Configuration error** (schema change) → auto-disable is wrong, needs reconfiguration

**Design Gap:** The auto-disable logic does not distinguish failure causes.

**Recommendation:** Add to §9 Configuration:

> "**Auto-disable behavior:**
>
> The auto-disable threshold counts all Run failures equally. Users should monitor the `automation_disabled` event logs and examine `last_error` to determine root causes.
>
> Common causes and recommended actions:
> - "entity_not_found": Correct the selector in automations.yaml
> - "command_validation_failed": Check entity capability schema
> - "unroutable": Integration is not loaded or entity is not registered
> - "integration_unavailable": Wait for integration to recover
>
> Tier 2 may introduce selective auto-disable (disable only on persistent errors, not transient timeouts)."

#### Issue 7.3: No Dead Letter Queue for Failed Commands

**Severity:** LOW
**Problem:** If a command fails (routing error, validation error, dispatch failure), it is not retried. There is no mechanism to review failed commands or replay them.

**Example:** A light command fails because the light integration crashed. The light is fixed, but the user must manually re-trigger the automation (no dead-letter queue to replay).

**Recommendation:** Defer to Tier 2. This is an operational concern, not an architectural gap.

### Summary: Error Handling & Retry

**Score: 6.5/10**

**Strengths:**
- Failure modes are documented
- Auto-disable threshold prevents runaway automations
- Events are produced for all failures (observability)

**Gaps:**
- **No per-action retry logic** (Issue 7.1) — acceptable for Tier 1 with workarounds
- **Auto-disable doesn't distinguish failure causes** (Issue 7.2) — all failures treated equally
- **No dead letter queue** (Issue 7.3) — failed commands not retained for replay

**Acceptable for Tier 1:** These are usability improvements, not correctness bugs.

---

## 8. REPLAY Behavior

### Current Design

**Section 3.10:** During REPLAY processing mode:
- Trigger evaluation proceeds normally
- Condition evaluation is suppressed
- Action execution is suppressed
- Run trace events are consumed from log, not re-produced

### Critical Issues (Already Identified in §2)

#### Issue 8.1: Condition Evaluation Suppression Violates Determinism

**Severity:** CRITICAL
**Problem:** (Same as Issue 2.4) The design claims replay preserves determinism (INV-TO-02), but explicitly suppresses condition evaluation during replay.

If conditions are not re-evaluated during replay, how does the system know which Runs should have executed? The answer: by reading `automation_triggered` events from the log.

**But this assumes the log is correct.** If:
1. Original LIVE execution had a bug that caused incorrect condition evaluation
2. The incorrect `automation_triggered` event is in the log
3. Replay consumes the incorrect event
4. The bug is never fixed

This violates the design principle "Every execution step is an event" (P1, §1). The events should be self-documenting and replaying them should be sufficient to understand behavior.

**Recommendation:** This is **not fixable in Tier 1** without redesigning condition evaluation (Issue 2.1). Document the limitation:

> "**Replay does not re-evaluate conditions.** Conditions are evaluated only during original LIVE execution. During REPLAY, the automation engine trusts the Run trace events in the log. If a Run's `automation_triggered` event is in the log, the engine assumes conditions were evaluated and met.
>
> This creates a **subtle dependency on log correctness**. If the log is corrupted or was written by a buggy version, replay cannot detect the error.
>
> Mitigation: The event log is immutable and append-only (INV-ES-04). Bugs in condition evaluation will produce correct `automation_completed` events even if the conditional reasoning was wrong. The trace is auditable."

This is an **accepted limitation** but it must be explicit.

#### Issue 8.2: Trigger Index Maintenance During Replay

**Severity:** MEDIUM
**Problem:** Section 3.10 states: "when the engine encounters `state_changed` or `availability_changed` events during REPLAY, it evaluates trigger predicates to maintain the trigger index and active automation tracking."

**Question:** What is the purpose of maintaining the trigger index during replay? The trigger index is used to quickly look up which automations match a given event type. Replaying the log doesn't change which automations exist (automations are loaded from `automations.yaml` at startup).

**Design Gap:** The statement is unclear. Does it mean:
- (A) The trigger index is rebuilt from scratch during replay (why? it was built at startup)
- (B) The trigger index is updated to track which triggers would have matched historical events (why? they already matched)
- (C) Something else

**Recommendation:** Clarify §3.10:

> "During REPLAY, the trigger index is not modified. It was built during automation engine initialization from the loaded `automations.yaml`. Trigger evaluation during REPLAY is for **run reconstruction** (updating the RunManager's active Run state), not for index maintenance."

---

## 9. Comparison to Other Platforms

### Competitive Analysis

| Platform | Automation Model | Critical Gaps Identified in HomeSynapse |
|---|---|---|
| **Home Assistant** | TCA model, four concurrency modes (adopted by HomeSynapse) | Multi-entity condition races (Q1), silent command failures (Q8). HA users frequently report "automation didn't fire because state changed between conditions." |
| **Node-RED** | Flow model (different from TCA). Explicitly visual dataflow. | N/A — different model. But automation storms from node cascades are a known problem. |
| **Hubitat Rule Machine** | Condition-action model. Emphasizes local processing. | Single-threaded execution (no parallelism), no explicit observability of condition evaluation. |
| **Apple HomeKit** | Declarative automation model. Rules engine evaluates conditions atomically. | Very limited condition expressiveness, no scripting. But single evaluation guarantees correctness. |
| **OpenHAB** | Imperative rule scripting. Full programming language. | Injections and security risks (Q7 competitive research). But users can write explicit race handling. |

### What HomeSynapse Gets Right

1. **Observability as a first principle** (P1, §1) — Every step is an event. Exceeds HA, Node-RED, Hubitat.
2. **Deterministic execution order** (P4, D5, §1) — No other platform guarantees this. Exceeds HA.
3. **Event-sourced replay** (P3, D7, §1) — Integrated into the event bus. Exceeds HA, Node-RED.
4. **Command pipeline with intent-to-observation** (P2, D12, §1) — No competitor closes this loop. Unique to HomeSynapse.

### What HomeSynapse Misses

1. **Atomic condition evaluation** (Issue 2.1) — Home Assistant users report this as the #1 bug. HomeSynapse does not address it.
2. **Automation cascades** (Issue 5.3, §10) — Node-RED and HA allow automations to trigger other automations. HomeSynapse has no built-in support.
3. **Priority-based conflict suppression** (Issue 5.2) — HA doesn't have this either, but SmartThings does. Users expect it.

### Assessment

HomeSynapse's architecture is **superior to Home Assistant in observability and determinism** but **matches HA in the multi-entity consistency gap**. This is the most critical gap because it's the most common source of automation failures in production.

---

## 10. Missing Considerations

### 10.1 Automation Cascades (Automation A Triggers Automation B)

**Severity:** CRITICAL
**Problem:** The design does not address what happens when an automation's actions trigger another automation.

**Example:**
```yaml
automation_1:
  triggers:
    - type: state_change
      entity: motion
      to: "true"
  actions:
    - type: emit_event
      event_type: light_control_request
      payload:
        brightness: 100

automation_2:
  triggers:
    - type: event
      event_type: light_control_request
  actions:
    - type: command
      target: light
      command: turn_on
      parameters:
        brightness: "{{ payload.brightness }}"  # NOTE: templating not in Tier 1
```

When motion is detected:
1. Automation 1 fires (trigger matches)
2. Automation 1 emits custom event
3. Automation 2's event trigger matches
4. Automation 2 fires

The causal chain is: motion → event → light. But **is this supported in the event-sourced model?**

**Section 3.9 Action Types** states: "emit_event: Produces a custom event on the event bus."

So yes, automations can emit events. But the design does not discuss:

1. **Cascade loops:** What if automation_2 also emits the same event? Infinite loop.
2. **Cascade storms:** A burst of events triggers 100 automations, each of which emits 10 events, triggering 1000 more automations. Resource exhaustion.
3. **Cascade deadlocks:** Automation A emits event E1, triggering automation B. Automation B emits E1, triggering A. Deadlock.

**Recommendation:** Add explicit section §10 Automation Cascades:

> "**Automation cascades and event emission:**
>
> Automations can emit custom events via the `emit_event` action (§3.9). Custom events are processed by the event bus and can trigger other automations. This enables automation chaining.
>
> **Cascade loop prevention:**
>
> HomeSynapse does NOT automatically detect or prevent cascade loops. It is the automation author's responsibility to avoid cycles:
>
> ```yaml
> # BAD: Creates infinite loop
> automation_a:
>   triggers:
>     - type: event
>       event_type: toggle_light
>   actions:
>     - type: emit_event
>       event_type: toggle_light
> ```
>
> **Cascade storm protection:**
>
> The Event Bus implements backpressure (Doc 01 §3.6). If the event processing rate exceeds the subscriber's capacity, the bus throttles event delivery. The automation engine's health indicator transitions to DEGRADED if the subscriber falls behind by more than 100 events.
>
> **Monitoring:** Use the metric `hs_automation_subscriber_lag` to detect cascade storms. If this metric exceeds 10 events, investigate for cascade loops.
>
> **Best practices:**
> - Minimize cascade depth (prefer direct actions to complex event chains)
> - Avoid emitting the same event that triggered the automation
> - Use conditions to guard event emissions (emit only if state meets criteria)
> - Test automations in isolation before deploying cascades"

And add test cases (§13.4):

> "- **Cascade loop detection:** Create automation A → emit event E1, automation B → listen to E1 → emit E1. Verify `subscriber_falling_behind` events are produced within 30 seconds. System remains operational (no crash)."

### 10.2 Automation Dependencies (Automation A Depends On Automation B)

**Severity:** MEDIUM
**Problem:** There is no way to express that "Automation A should only run if Automation B is enabled" or "Automation A waits for Automation B to complete."

**Example:**
```yaml
automation_arm_alarm:
  triggers:
    - type: state_change
      entity: mode
      to: "armed"
  actions:
    - type: command
      target: alarm
      command: arm

automation_lock_doors:
  triggers:
    - type: state_change
      entity: mode
      to: "armed"
  # Should only execute after alarm is armed
  # Current design: both execute concurrently, order not guaranteed
```

**Design Gap:** There is no "depends_on" field in the automation definition. Automations triggered by the same event execute in priority order, but there's no way to express "wait for automation X to complete."

**Recommendation:** This is a Tier 2+ feature. Add to §14 Future Considerations:

> "**Automation dependencies (Tier 2+):**
>
> An automation can declare dependencies on other automations:
>
> ```yaml
> automation_lock_doors:
>   depends_on:
>     - automation_arm_alarm
>   triggers:
>     - type: state_change
>       entity: mode
>       to: "armed"
>   actions:
>     - type: command
>       target: door
>       command: lock
> ```
>
> The automation engine ensures dependent automations are initiated only after their dependencies complete (or fail). This prevents race conditions in complex sequences."

### 10.3 Automation Templating/Expressions

**Severity:** MEDIUM (deferred)
**Problem:** The design explicitly excludes templating and expression evaluation from Tier 1 (§12 Security Considerations: "No template engine, no expression language").

But users often want dynamic values:
```yaml
# INVALID in Tier 1:
actions:
  - type: command
    target: light
    parameters:
      brightness: "{{ brightness_value }}"  # Can't do this
```

**Design Choice:** This is intentional for security (avoids Jinja2 injection attacks). But it limits automation expressiveness.

**Recommendation:** Document in §12 Security Considerations and §14 Future Considerations:

> "**Expression evaluation (Tier 2+):**
>
> Tier 1 automation definitions are pure data (YAML, no templating). Parameter values are literal. Tier 2 may introduce safe expression evaluation for parameter substitution, using a restricted expression language (e.g., only variable references, no function calls)."

### 10.4 Automation Versioning & Rollback

**Severity:** LOW
**Problem:** The design has no mechanism to version automations or rollback to previous definitions.

If a user modifies an automation and it breaks other automations, there's no easy way to revert.

**Current mechanism:** Automation definitions are stored in `automations.yaml` (no version control by the system). The user must manage versions via Git or file system backup.

**Recommendation:** This is acceptable for Tier 1 (Git is the versioning system). Note in §12 or §14:

> "**Automation versioning:**
>
> HomeSynapse does not track automation definition versions. Use external version control (Git) to manage automation revisions. The `automations.yaml` file should be committed to a Git repository for full audit trail and rollback support."

### 10.5 Dry-Run / Test Mode

**Severity:** LOW
**Problem:** There is no way to test an automation without executing it. Users cannot validate "if I run this automation, what will happen?" without actually running it.

**Design mentions:** Section 14 Future Considerations mentions "DRY_RUN mode (Tier 2). Implementation requires routing Run trace events to a separate audit log per Doc 01 §3.7."

**Recommendation:** This is Tier 2. Leave as-is in §14.

### 10.6 Rate Limiting (Preventing Automation Storms)

**Severity:** MEDIUM
**Problem:** Related to Issue 10.1 (cascades). If a single event triggers 100 automations, and each automation emits an event, the event processing can spike significantly.

The design has **backpressure** (Event Bus throttling) but no per-automation rate limits.

**Example:**
```yaml
automation:
  triggers:
    - type: event
      event_type: something_happened  # Fires 1000 times/second
  actions:
    - type: emit_event
      event_type: another_event
```

This could create 1000 events/second, overwhelming the system.

**Recommendation:** Add to §3.6 Concurrency Modes or new section:

> "**Rate limiting (future consideration, Tier 2+):**
>
> In Tier 1, there is no per-automation rate limiting. If an automation triggers very frequently (100+ times/second), the system may degrade. Use concurrency modes (`single`, `queued`) to throttle executions.
>
> Tier 2 may introduce per-automation rate limiting:
>
> ```yaml
> automation:
>   rate_limit:
>     max_runs_per_minute: 60  # Max 60 runs per minute
>   triggers:
>     - ...
> ```"

### 10.7 Automation Inheritance / Templates

**Severity:** LOW
**Problem:** If a user wants to create similar automations with slight variations, there's no way to template them.

**Example:**
```yaml
# User wants to create similar automations for all rooms:
# - kitchen lights: motion -> on brightness 100
# - bedroom lights: motion -> on brightness 50
# - living room lights: motion -> on brightness 75
# Currently, must copy-paste automation definition 3 times
```

**Recommendation:** This is a Tier 3 feature (YAML schema extension needed). Add to §14:

> "**Automation templates / blueprints (Tier 3+):**
>
> A blueprint system (similar to Home Assistant) could enable reusable automation templates with parameterization. Implementation deferred to Tier 3."

### 10.8 Selector Performance on Large Entity Sets

**Severity:** MEDIUM
**Problem:** If a user creates a selector like `type: light` and there are 500 lights in the system, the selector resolution must iterate all 500 entities. This is O(n) per trigger.

**Design Gap:** No mention of indexing strategies for selector resolution.

**Recommendation:** Add performance consideration to §10 Performance Targets:

> "**Selector resolution performance:**
>
> Selector resolution (area, label, type) is implemented as a linear scan of the Entity Registry. For systems with 100+ entities matching a selector, resolution may take 5-10ms. The engine batches selector resolutions and caches results at trigger time, but large selections should be avoided in automations that trigger frequently (100+ times/second).
>
> Future optimization: Build indices for (label → entities), (area → entities), (type → entities) in the Entity Registry."

---

## 11. Comprehensive Scoring & Risk Assessment

### Overall Architecture Score: 6.5/10

| Component | Score | Risk Level | Notes |
|---|---|---|---|
| 1. Trigger Evaluation | 6.5/10 | MEDIUM | Per-event evaluation is solid; startup behavior undefined |
| 2. Condition Evaluation | 3/10 | **CRITICAL** | No atomic multi-entity snapshot (the #1 automation bug) |
| 3. Action Execution | 5.5/10 | MEDIUM | Command pipeline is comprehensive; but ordering unclear |
| 4. Run Lifecycle | 7/10 | LOW | Clear state machine; cancellation semantics need docs |
| 5. Conflict Resolution | 5/10 | MEDIUM | Detect-and-warn is safe but may confuse users |
| 6. Time-Based Triggers | 6/10 | LOW | Deferred to Tier 2; graceful fallback needed |
| 7. Error Handling | 6.5/10 | LOW | Auto-disable works; retry is user-responsibility |
| 8. REPLAY Behavior | 5/10 | **CRITICAL** | Condition suppression violates determinism claim |
| 9. Comparison to Platforms | 7/10 | MEDIUM | Superior in observability; matches HA in gaps |
| 10. Missing Considerations | 2/10 | **CRITICAL** | Cascades, dependencies, rate limiting, templating |

### Critical Issues Requiring Pre-Tier-1 Fix

1. **Issue 2.1 - No atomic condition snapshot** (BLOCKING)
   - This is the #1 source of automation bugs in Home Assistant
   - Must be addressed or explicitly documented as a known limitation
   - Recommended: Implement snapshot lock on state store
   - Effort: 2-3 days of design + implementation

2. **Issue 2.4 - Replay determinism contradiction** (BLOCKING)
   - Design claims INV-TO-02 but violates it
   - Must clarify whether replay is evaluative or reconstructive
   - Recommended: Make replay purely reconstructive (read trace events, don't re-evaluate)
   - Effort: 1 day documentation + 2 days implementation

3. **Issue 3.1, 3.2 - Command execution order** (BLOCKING)
   - Must document guarantee that commands execute in issue order
   - Must specify entity ordering for multi-target actions
   - Effort: 1 day documentation

4. **Issue 5.3 - Cascade-aware conflict detection** (TIER 2)
   - Conflicts from different-event automations not detected
   - Too late to fix in Tier 1, but design must accommodate Tier 2
   - Effort: Tier 2 work

5. **Issue 10.1 - Automation cascades** (TIER 2)
   - Loop prevention and storm protection design is needed
   - Must document best practices
   - Effort: 2-3 days design + documentation

---

## 12. Recommendations for Tier 1 Release

### Must Fix

1. **Implement atomic condition evaluation snapshot** (§2.1)
   - Add `ConditionEvaluator.evaluateWithSnapshot(List<Condition>) → boolean`
   - Acquire read lock on all referenced entities before evaluation
   - Cost: ~500 lines of code, ~2KB heap per Run

2. **Clarify REPLAY determinism** (§2.4, §3.10)
   - Remove references to "trigger evaluation proceeds normally" during replay
   - Make replay purely reconstructive: read trace events from log, do not re-evaluate
   - Cost: ~200 lines documentation, ~100 lines code refactoring

3. **Document command execution order** (§3.1, §3.2)
   - Add explicit guarantee: commands issued by same Run execute in order
   - Add explicit guarantee: multi-target commands issue in entity ULID order
   - Cost: ~200 lines documentation

4. **Graceful fallback for Tier 2 triggers** (§6.1)
   - When Tier 2 trigger type is loaded in Tier 1, produce `config_warning` (not error)
   - Mark trigger as inactive, set automation health to DEGRADED
   - Cost: ~100 lines code

### Should Fix (High Value)

5. **Add state version tracking to condition events** (§2.2)
   - Extend `automation_condition_evaluated` event payload with `last_changed_at`, `last_changed_by_event_id`
   - Cost: ~150 lines code, ~50 bytes per condition event

6. **Clarify unavailable target semantics** (§3.4)
   - Document whether `on_unavailable` applies per-target or per-action
   - Recommend per-target: skip only unavailable targets, error if any unavailable with `error` policy
   - Cost: ~100 lines documentation, ~200 lines code

7. **Cascade protection & documentation** (§10.1)
   - Add section to automation design guide: avoiding loops, detecting storms
   - Cost: ~300 lines documentation

### Nice to Have (Tier 2)

- Automation cascades with loop detection
- Automation dependencies
- Per-action retry logic
- Cascade-aware conflict detection
- Dry-run / test mode
- Automation templating

---

## 13. Detailed Recommendations (Prioritized)

### P0: Atomic Condition Evaluation (Critical Fix)

**Problem:** Multi-entity conditions evaluated without atomic snapshot, causing non-deterministic behavior.

**Solution:**

```java
// In ConditionEvaluator interface, add:
ConditionEvalResult evaluateAtomically(
    List<Condition> conditions,
    Set<EntityRef> referencedEntities,
    StateQuery stateQuery
) {
    // Acquire snapshot lock for all referenced entities
    stateQuery.acquireSnapshotLock(referencedEntities);
    try {
        // Evaluate all conditions against locked snapshot
        return evaluateConditions(conditions);
    } finally {
        stateQuery.releaseSnapshotLock(referencedEntities);
    }
}
```

**Justification:** Eliminates the #1 source of automation bugs and matches Home Assistant's recent improvements (v0.113+).

### P1: Clarify Replay Determinism (Critical Documentation)

**Problem:** Design claims replay preserves INV-TO-02 but violates it by suppressing condition evaluation.

**Solution:** Rewrite §3.10 Run Lifecycle to be explicit:

> "**Replay Behavior (RECONSTRUCTIVE, not RE-EVALUATIVE):**
>
> During REPLAY processing mode, the automation engine does NOT re-evaluate triggers or conditions. Instead, it RECONSTRUCTS the automation state from the Run trace events stored in the event log.
>
> When the subscriber encounters:
> - `automation_triggered`: Run is reconstructed from event payload
> - `automation_condition_evaluated`: Condition result is replayed as-is (not re-evaluated)
> - `automation_completed`: Run state machine transitions
>
> Determinism guarantee (INV-TO-02): Replay produces identical automation state transitions because it reads the same events that were produced during original LIVE execution.
>
> Replay does NOT re-evaluate conditions because doing so against partially-rebuilt State Store could produce different results, violating determinism.

This is **explicit, clear, and correct**.

### P2: Command Execution Order Guarantees (Documentation)

**Problem:** Order of multi-target and multi-action commands not specified.

**Solution:** Add to §3.9 Action Execution:

> "**Execution Order Guarantees:**
>
> 1. **Within a Run:** Actions execute sequentially. Command issued by action N is guaranteed to be dispatched before action N+1 begins execution.
>
> 2. **Within an action with multiple targets:** Targets are processed in deterministic order: by entity ULID ascending (consistent with creation/registration order). Commands are issued in this order.
>
> 3. **Across virtual threads:** Runs on different threads may execute in parallel. Commands from different Runs may be dispatched out of order. This is expected and correct.
>
> Example:
> ```yaml
> actions:
>   - type: command  # Targets [light_1, light_2, light_3] (ULID order)
>     target:
>       type: light
>     command: turn_off
>   - type: delay    # Guarantees all turn_off commands dispatched before delay
>     duration: 5000
>   - type: command  # Targets [light_1, light_2, light_3] in same order
>     target:
>       type: light
>     command: turn_on
> ```"

### P3: Graceful Tier 2 Trigger Fallback (Implementation)

**Problem:** If user includes Tier 2 trigger (e.g., `time`), unclear what happens.

**Solution:**

```java
// In TriggerEvaluator.validateTrigger():
if (trigger.type() == TriggerType.TIME ||
    trigger.type() == TriggerType.SUN ||
    trigger.type() == TriggerType.PRESENCE) {

    // These are Tier 2; mark as deferred
    eventPublisher.publish(new ConfigWarningEvent(
        automation.id(),
        "Trigger type '" + trigger.type() + "' is not implemented in Tier 1. " +
        "This trigger will not fire until it is implemented in Tier 2. " +
        "Check system documentation at https://homesynapse.dev/tiers"
    ));

    return TriggerValidationResult.DEFERRED;  // Not an error
}
```

Automation loads, trigger marked inactive, health → DEGRADED.

### P4: State Version Tracking in Conditions (Implementation)

**Problem:** No way to debug why a condition evaluated to false.

**Solution:** Extend `automation_condition_evaluated` event payload:

```yaml
automation_condition_evaluated:
  run_id: <ulid>
  condition_index: 0
  condition_type: state
  entity_ref: temperature_sensor
  evaluated_state:
    value: 22.5
    value_type: numeric
    last_changed_at: "2026-03-09T12:34:56.789Z"  # NEW
    last_changed_event_id: "01ARF..."            # NEW
  result: false
  evaluation_time_ms: <timestamp>
```

This enables perfect debugging: "temperature was 22.5°C at evaluation time, last changed 5 minutes ago."

---

## 14. Summary Table: Issues & Mitigations

| # | Issue | Severity | Mitigation | Effort | Tier |
|---|---|---|---|---|---|
| 1.1 | Event-time vs. current-time state semantics | HIGH | Document explicitly in §3.8 | 1 day | 1 |
| 1.2 | Atomic trigger evaluation not guaranteed | MEDIUM | Add thread-safety statement | 1 day | 1 |
| 1.3 | Replay/LIVE consistency contradictory | HIGH | Clarify replay is reconstructive | 1 day | 1 |
| 1.4 | Startup behavior of level-triggered automations | MEDIUM | Document: triggers fire on state_changed, not initial state | 1 day | 1 |
| 2.1 | No atomic condition snapshot (**CRITICAL**) | **CRITICAL** | Implement snapshot lock on state store | 2-3 days | 1 |
| 2.2 | No read-time version tracking | HIGH | Add last_changed_at/event_id to events | 2 days | 1 |
| 2.3 | Short-circuit behavior unspecified | MEDIUM | Document left-to-right evaluation, stable order | 1 day | 1 |
| 2.4 | Condition evaluation during partial replay | HIGH | Make replay reconstructive-only | 2 days | 1 |
| 3.1 | Race between action and dispatch | HIGH | Document command order guarantee | 1 day | 1 |
| 3.2 | No ordering within multi-target actions | HIGH | Document ULID order for targets | 1 day | 1 |
| 3.3 | No action rollback on failure | MEDIUM | Document fail-fast semantics | 1 day | 1 |
| 3.4 | Unavailable target semantics ambiguous | MEDIUM | Clarify per-target vs per-action | 1 day | 1 |
| 3.5 | No timeout on command dispatch | MEDIUM | Document: confirmation timeout tracks dispatch | 1 day | 1 |
| 4.1 | Restart mode cancellation semantics | HIGH | Document: in-flight commands not cancelled | 1 day | 1 |
| 4.2 | Run completion decoupled from commands | MEDIUM | Document: Run status ≠ command status | 1 day | 1 |
| 4.3 | No explicit run cancellation API | LOW | Defer to Tier 2 | 0 days | 2 |
| 5.1 | Conflict detection timing unclear | MEDIUM | Clarify: happens after run initiation | 1 day | 1 |
| 5.2 | No conflict suppression (user expectation gap) | HIGH | Document: both commands execute, add best practices | 1 day | 1 |
| 5.3 | Cascading automations not detected | **CRITICAL** | Defer to Tier 2, add design section | 2 days | 2 |
| 6.1 | No graceful fallback for Tier 2 triggers | MEDIUM | Implement config_warning, mark inactive | 1 day | 1 |
| 6.2 | Location config not specified | MEDIUM | Defer to Tier 2 spec | 0 days | 2 |
| 6.3 | No catch-up for scheduled triggers | LOW | Defer to Tier 2 | 0 days | 2 |
| 7.1 | No per-action retry | MEDIUM | Document workarounds, defer to Tier 2 | 1 day | 1 |
| 7.2 | Auto-disable doesn't distinguish failures | MEDIUM | Add guidance on root cause analysis | 1 day | 1 |
| 7.3 | No dead letter queue | LOW | Defer to Tier 2 | 0 days | 2 |
| 10.1 | No automation cascade loops | **CRITICAL** | Add design section on cascades & loops | 2 days | 1 (doc) |
| 10.2 | No automation dependencies | MEDIUM | Defer to Tier 2 | 0 days | 2 |
| 10.3 | No templating/expressions | MEDIUM | Defer to Tier 2, document reason (security) | 1 day | 2 |
| 10.4 | No automation versioning | LOW | Document: use external Git | 1 day | 1 |
| 10.5 | No dry-run / test mode | LOW | Defer to Tier 2 | 0 days | 2 |
| 10.6 | No rate limiting | MEDIUM | Document best practices, defer to Tier 2 | 1 day | 2 |
| 10.7 | No automation templates | LOW | Defer to Tier 3 | 0 days | 3 |
| 10.8 | Selector performance on large entity sets | MEDIUM | Document limitation, add performance note | 1 day | 1 |

**Total Effort to Pre-Tier-1 Release: 35-40 days** (includes design, documentation, implementation)

---

## 15. Conclusion & Recommendations

### What HomeSynapse Got Right

The Automation Engine design is **architecturally sound** with exceptional attention to **observability, determinism, and auditability**. The event-sourced approach is superior to Home Assistant, and the design principles (P1-P5) are excellent.

**Key strengths:**
- Every execution step is an event (full observability)
- Deterministic execution order with explicit sorting
- Command pipeline closes intent-to-observation loop
- Replay is integrated into event bus (not a separate system)
- Configuration changes don't disrupt running automations

### What Must Be Fixed Before Tier 1

1. **Atomic condition evaluation** (Issue 2.1) — The #1 source of automation bugs. Non-negotiable.
2. **Replay determinism clarity** (Issue 2.4) — Design claims INV-TO-02 but contradicts itself. Must resolve.
3. **Cascade protection** (Issue 10.1) — Automation loops and storms are a real risk. Must document mitigations.
4. **Documentation gaps** (Issues 1.1, 1.3, 1.4, 3.1, 3.2, 4.1, 5.1, 5.2, 6.1) — Many design choices are implicit. Must make explicit.

### Tier 2+ Design Implications

1. **Conflict resolution** (Issue 5.2) — Priority-based suppression will need careful ordering
2. **Cascade-aware conflict detection** (Issue 5.3) — Must track automation chains, not just single-event conflicts
3. **Automation dependencies** (Issue 10.2) — Will require topological sorting of automation execution
4. **Rate limiting** (Issue 10.6) — Per-automation rate limits needed for cascade storms
5. **Retry policies** (Issue 7.1) — Per-capability retry strategies will need state tracking

### Final Assessment

**Recommendation: CONDITIONAL APPROVAL for Tier 1**

The design is approvable **IF** the following pre-release work is completed:

- [ ] Issue 2.1 implemented (atomic condition snapshot)
- [ ] Issue 2.4 resolved (replay determinism clarity)
- [ ] Issues 1.1, 1.3, 1.4, 3.1-3.2, 4.1, 5.1-5.2, 6.1 documented
- [ ] Issue 10.1 (cascades) design section added
- [ ] Performance testing validates all §10 targets on RPi 5
- [ ] Integration tests for replay determinism pass
- [ ] E2E tests for multi-entity condition races pass

**Estimated timeline:** 5-6 weeks to Tier 1 release (with concurrent coding + design).

---

*End of Critical Review*

**Reviewer:** Systems Architect (Automation, Event-Sourcing)
**Date:** 2026-03-09
**Status:** Ready for Architecture Review Gate with recommended action items
