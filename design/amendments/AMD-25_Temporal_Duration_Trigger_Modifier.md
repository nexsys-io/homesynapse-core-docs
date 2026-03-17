# AMD-25: Temporal Duration Modifier for Triggers

**Amendment type:** Design amendment to locked document
**Target document:** `design/07-automation-engine.md` (Locked, 2026-03-07)
**Status:** Approved with Conditions — Hivemind review 2026-03-17
**Review decision:** APPROVED WITH CONDITIONS (see §9 below)
**Priority:** HIGH — must land before Wave 3 Phase 2 interface specification (automation module)
**Author:** PM
**Date:** 2026-03-17
**Depends on:** Doc 07 at Locked status (satisfied), Doc 01 at Locked status (satisfied), Doc 03 at Locked status (satisfied), Automation Engine Critical Review (exists)
**Blocks:** `automation` module Phase 2 interface specification (Wave 3)

---

## 0. Motivation

The Automation Engine's Tier 1 trigger types (`state_change`, `state`, `numeric_threshold`, `availability`) fire immediately when their predicate is satisfied by an incoming event. This means there is no way to express the pattern "fire only when a state has been continuously true for a specified duration" — the most common temporal automation pattern in residential automation:

- "Turn off HVAC if no occupancy for 30 minutes"
- "Alert if garage door open for more than 10 minutes"
- "Turn off lights if no motion for 15 minutes"
- "Send notification if water sensor wet for more than 60 seconds"

Without `for_duration`, users must approximate this pattern using a `wait_for` action after an immediate trigger. This is both semantically wrong (the trigger fires immediately, consuming a Run slot and producing trace events for what may be a transient state) and resource-inefficient (`wait_for` ties up an active Run for the entire duration, consuming one of the `max_total_runs` slots).

**Competitive reference.** Home Assistant's `for:` modifier on state triggers is the direct precedent. HA implements this as a trigger-level modifier — not a separate condition type or trigger type. The `for:` modifier is one of HA's most-used trigger features and its absence would represent a regression in perceived capability for users migrating from HA.

**Critical Review alignment.** The Automation Engine Critical Review §1.1 (Temporal Gap Between Event and Evaluation) identified the temporal dimension as a gap. While §1.1 focused on the evaluation-time vs event-time question (addressed by AMD-03's snapshot pattern), the broader temporal gap — "has this state been true for a duration" — remains unaddressed. The `for_duration` modifier closes this gap at the trigger level.

---

## 1. Design Decision: Trigger-Level Modifier (Option A)

Three implementation options were evaluated:

| Option | Description | Pros | Cons |
|---|---|---|---|
| **(A) `for_duration` modifier on trigger types** | Add a nullable `for_duration` field to `state_change`, `state`, `numeric_threshold`, and `availability` triggers. When present, the trigger predicate must be continuously true for the specified duration before the trigger fires. | Matches user mental model ("when motion stops for 15 minutes"). Matches HA semantics. No new types. Timer is pre-Run (no Run slot consumed). | Changes trigger evaluation model — adds timer management to TriggerEvaluator. |
| (B) `duration` condition type | A new condition type that evaluates "has this state been true for N minutes" by querying the event log for the history of the entity's state. | Clean separation of concerns. No changes to trigger model. | Requires historical state query (not currently in StateQuery interface). Condition is post-trigger — the Run is already initiated. Semantically wrong: "check if state was held" vs "fire when state has been held." |
| (C) `state_held` trigger type | A new trigger type that fires only when a state has been held for a specified duration. | Clean type hierarchy — no nullable field. | Proliferates trigger types. Duplicates `state_change`/`state` semantics with an added duration parameter. Users must learn when to use `state_change` vs `state_held`. |

**Decision: Option (A).** The `for_duration` modifier is the right answer because:

1. It matches the user mental model: "when motion is off **for** 15 minutes."
2. It matches Home Assistant's `for:` modifier — users migrating from HA will expect this syntax.
3. It is additive to the existing trigger type hierarchy — no new sealed interface subtypes needed.
4. The timer is pre-Run: while the duration timer is pending, no Run slot is consumed, no Run events are produced, and no conditions are evaluated. The trigger fires only after the duration expires, at which point the normal Run lifecycle begins.
5. Virtual threads (LTD-01) make the timer implementation cost negligible — each pending duration timer is a sleeping virtual thread consuming ~1 KB.

---

## 2. Amendment Text

### 2.1 §3.4 Trigger Evaluation — Add `for_duration` modifier

**FIND (in §3.4, after the Tier 1 trigger types table and before the Tier 2 trigger types table):**

> **Trigger types (Tier 2, schema defined but not implemented):**

**INSERT BEFORE:**

> **Temporal duration modifier (`for_duration`).** The trigger types `state_change`, `state`, `numeric_threshold`, and `availability` support an optional `for_duration` field (ISO 8601 duration string, e.g., `"PT15M"` for 15 minutes, `"PT30S"` for 30 seconds). When `for_duration` is present and non-null, the trigger predicate match does not immediately initiate a Run. Instead, the TriggerEvaluator starts a **duration timer** — a virtual thread that sleeps for the specified duration (per LTD-01 / LTD-11, same mechanism as `delay` action). The trigger fires only if the predicate remains continuously true for the entire duration.
>
> **Duration timer lifecycle:**
>
> 1. **Start condition.** When a trigger predicate matches an incoming event and `for_duration` is non-null, the TriggerEvaluator checks whether a duration timer is already active for this `(automation_id, trigger_index)` pair. If not, it starts a new timer. If a timer is already active (the predicate matched a previous event and the duration has not yet expired), the existing timer continues — no restart. The timer start is recorded via a `trigger_duration_started` DIAGNOSTIC event.
>
> 2. **Cancel condition.** The duration timer is cancelled if a subsequent event causes the trigger predicate to become **false** for the monitored entity. Specifically:
>    - For `state_change` triggers with `for_duration`: cancellation occurs when a `state_changed` event for the same entity changes the monitored attribute away from the `to` value (or, if `to` is unspecified, any `state_changed` event for the entity). The timer evaluates each incoming event for the monitored entity to determine continued satisfaction.
>    - For `state` triggers with `for_duration`: cancellation occurs when a `state_changed` event for the entity causes the level-triggered predicate to become false.
>    - For `numeric_threshold` triggers with `for_duration`: cancellation occurs when a `state_changed` event for the entity causes the numeric value to cross back below/above the threshold (inverse of the original crossing direction).
>    - For `availability` triggers with `for_duration`: cancellation occurs when an `availability_changed` event for the entity transitions away from the monitored availability state.
>
>    Cancellation interrupts the sleeping virtual thread and produces a `trigger_duration_cancelled` DIAGNOSTIC event.
>
> 3. **Expiry.** When the duration elapses without cancellation, the timer expires and the trigger fires. The TriggerEvaluator produces a `trigger_duration_expired` DIAGNOSTIC event, then proceeds with the standard trigger evaluation procedure from step 4 (deduplication, §3.5) onward. The triggering event for deduplication and Run creation purposes is the **original event that started the timer** — this preserves causal linkage to the state change that initiated the temporal pattern.
>
> 4. **State validation at expiry.** When a duration timer expires, the TriggerEvaluator performs a final validation read against the State Store to confirm the predicate is still true at the moment of expiry. If the state has changed since the last event but no `state_changed` event was produced (edge case: state was set to the same value, or the State Store was rebuilt), the trigger still fires because the duration timer was not cancelled. The validation read is a defense-in-depth check logged as a DIAGNOSTIC event (`trigger_duration_state_validated`) only when the validation result differs from expectation.
>
> **Duration timer tracking key.** Each duration timer is identified by the tuple `(automation_id, trigger_index)`, where `trigger_index` is the zero-based position of the trigger in the automation's `triggers` array. At most one duration timer can be active per `(automation_id, trigger_index)` pair — if the predicate is already true and a timer is running, subsequent matching events do not restart the timer. This is consistent with Home Assistant's `for:` semantics, where the duration window starts on the first matching event and is not reset by subsequent matching events.
>
> **Interaction with concurrency modes.** Duration timers are **pre-Run**. A pending duration timer does not count as an active Run for concurrency mode enforcement. Specifically:
> - `single` mode with one active Run and a pending duration timer: if the timer expires while the Run is still active, the timer expiry is treated as a new trigger — the concurrency mode evaluates it the same as any other trigger. The trigger may be dropped per `single` mode rules.
> - `restart` mode with a pending duration timer: a new immediate trigger (no `for_duration`) that fires during the duration timer's pending period does not cancel the timer. The timer and immediate triggers are independent — they target different trigger indices.
> - The duration timer does not acquire a Run slot, does not produce Run lifecycle events, and does not participate in `max_total_runs` accounting.
>
> **Interaction with deduplication (§3.5).** The deduplication key `(automation_id, triggering_event_id)` uses the original event that started the timer. If the same event somehow triggers the automation through a non-duration trigger on the same automation, deduplication prevents a second Run.
>
> **`for_duration` constraints:**
> - Minimum: `PT1S` (1 second). Durations below 1 second are rejected at YAML validation time.
> - Maximum: governed by `automation.trigger.max_for_duration_ms` configuration (default: 86400000 ms = 24 hours). Durations exceeding this ceiling are rejected at YAML validation time.
> - Parsing: ISO 8601 duration format. Only `PT` (period-time) components are accepted — `P1D` (calendar days) is rejected because it is ambiguous across DST transitions. Users must specify `PT24H` for 24 hours.
>
> **Example YAML (duration trigger):**
>
> ```yaml
> automations:
>   - name: "Turn off HVAC if no occupancy for 30 minutes"
>     triggers:
>       - type: state_change
>         entity: living_room.motion_sensor
>         attribute: occupancy
>         to: "false"
>         for_duration: "PT30M"
>     actions:
>       - type: command
>         target:
>           entity: living_room.hvac
>         command: set_mode
>         parameters:
>           mode: "off"
> ```
>
> In this example, the trigger predicate matches when the motion sensor's `occupancy` attribute transitions to `"false"`. The `for_duration: "PT30M"` modifier delays the trigger fire by 30 minutes. If the occupancy transitions back to `"true"` within 30 minutes (a new `state_changed` event with `occupancy: "true"`), the timer is cancelled and no Run is created. If 30 minutes elapse with occupancy remaining `"false"`, the trigger fires and the Run proceeds through condition evaluation and action execution.

### 2.2 §3.10 Replay Behavior — Add duration timer replay suppression

**FIND (in §3.10, in the "What happens during REPLAY" table, after the Trigger evaluation row):**

> | Trigger evaluation | Proceeds normally against replayed events. | Rebuilds the engine's understanding of which automations were active and matching. |

**INSERT AFTER (new row):**

> | Duration timers | **Suppressed — no duration timers are started during REPLAY.** If a trigger predicate with `for_duration` matches a replayed event, the timer-start step is skipped. The original LIVE processing already produced the `trigger_duration_started`, `trigger_duration_expired`/`trigger_duration_cancelled` DIAGNOSTIC events, and those events exist in the log. During REPLAY, the TriggerEvaluator consumes these existing duration timer events to rebuild its understanding of which timers were active at the REPLAY→LIVE transition point. | Duration timers involve real wall-clock time. Starting a 30-minute timer during replay of historical events would produce side effects divorced from the original timeline. This follows the same suppression pattern as action execution: the DIAGNOSTIC events from original processing are consumed to rebuild state. **REPLAY→LIVE transition:** If the TriggerEvaluator determines (from consumed events) that a duration timer was active at the point where replay ends, it re-creates the timer with the **remaining duration** calculated from: `original_for_duration - (current_time - timer_start_time)`. If the remaining duration is ≤ 0 (the timer should have expired during the downtime), the trigger fires immediately upon LIVE transition. This ensures timers survive restart without losing temporal progress. |

### 2.3 §8.2 Key Types — Add DurationTimer tracking type

**FIND (in §8.2 Key Types table, after the `MaxExceededSeverity` row):**

> | `MaxExceededSeverity` | Enum | `SILENT`, `INFO`, `WARNING`. |

**INSERT AFTER:**

> | `DurationTimer` | Record | Tracks an active `for_duration` timer: `automationId` (AutomationId), `triggerIndex` (int), `startingEventId` (EventId — the event that started the timer), `entityRef` (EntityRef — the monitored entity), `forDuration` (Duration), `startedAt` (Instant), `expiresAt` (Instant), `virtualThread` (Thread — the sleeping virtual thread). Managed by TriggerEvaluator. Not persisted — rebuilt from events on REPLAY→LIVE transition. |

### 2.4 §3.4 Trigger Evaluation — Update `TriggerDefinition` sealed interface in §8.2

**FIND (in §8.2 Key Types table):**

> | `TriggerDefinition` | Sealed interface | Root of trigger type hierarchy: `StateChangeTrigger`, `StateTrigger`, `EventTrigger`, `AvailabilityTrigger`, `NumericThresholdTrigger`, plus Tier 2 reserved: `TimeTrigger`, `SunTrigger`, `PresenceTrigger`, `WebhookTrigger`. |

**REPLACE WITH:**

> | `TriggerDefinition` | Sealed interface | Root of trigger type hierarchy: `StateChangeTrigger`, `StateTrigger`, `EventTrigger`, `AvailabilityTrigger`, `NumericThresholdTrigger`, plus Tier 2 reserved: `TimeTrigger`, `SunTrigger`, `PresenceTrigger`, `WebhookTrigger`. The subtypes `StateChangeTrigger`, `StateTrigger`, `NumericThresholdTrigger`, and `AvailabilityTrigger` include a nullable `forDuration` field (`Duration`, default `null`) implementing the temporal duration modifier (AMD-25, §3.4). `EventTrigger` does not support `for_duration` — event triggers are inherently instantaneous. |

### 2.5 §9 Configuration — Add duration timer configuration

**FIND (in §9, at the end of the `automation:` block, after the `condition:` section):**

> ```yaml
>   condition:
>     # Polling interval for wait_for action conditions.
>     wait_for_poll_interval_ms: 1000          # range: 100-10000, default: 1000
>
>     # Maximum wait_for timeout. Prevents indefinite Run suspension.
>     max_wait_for_timeout_ms: 3600000         # range: 60000-86400000, default: 3600000 (1 hour)
> ```

**INSERT AFTER:**

> ```yaml
>   trigger:
>     # Maximum allowed for_duration value. Durations exceeding this ceiling
>     # are rejected at YAML validation time. Prevents unbounded timer accumulation
>     # from user misconfiguration (e.g., "PT365D" = 1-year timer).
>     max_for_duration_ms: 86400000            # range: 1000-604800000, default: 86400000 (24 hours)
>
>     # Maximum concurrent duration timers across all automations.
>     # Each duration timer is one sleeping virtual thread (~1 KB).
>     # Bounds memory and virtual thread count for the timer subsystem.
>     # When this limit is reached, new duration timer starts are rejected:
>     # the trigger fires immediately (as if for_duration were null) and a
>     # DIAGNOSTIC event (trigger_duration_limit_exceeded) is produced.
>     max_concurrent_duration_timers: 1000     # range: 10-10000, default: 1000
> ```

### 2.6 §10 Performance Targets — Add timer management overhead target

**FIND (in §10, after the last row of the performance targets table):**

> | Automation engine steady-state memory | < 50 MB | Automation Registry (~100 definitions × ~5 KB each = ~500 KB) + trigger index (~50 KB) + active Runs (~300 KB at max concurrent) + Pending Command Ledger (~100 KB at max pending) + subscriber overhead. Total well under 50 MB. | JFR heap snapshot after 24 hours of operation with 100 automations. |

**INSERT AFTER (new row):**

> | Duration timer management overhead (p99) | < 1 ms per trigger evaluation at 200 concurrent timers | Each trigger evaluation must check whether a duration timer exists for the `(automation_id, trigger_index)` pair — a `ConcurrentHashMap.get()` operation. Timer start is a virtual thread spawn (~1 μs). Timer cancel is a `Thread.interrupt()` call (~1 μs). At 200 concurrent timers, the map lookup is O(1) with negligible contention. The 1 ms budget provides 1000× headroom over expected latency. | JFR event timing on RPi 5 with 200 concurrent duration timers under sustained event load (10 events/sec, 50 automations with `for_duration`). |
> | Duration timer memory overhead | < 2 KB per active timer | Each `DurationTimer` record is ~200 bytes. Each sleeping virtual thread is ~1 KB. Total ~1.2 KB per timer. At 1000 max concurrent timers, total is ~1.2 MB — well within the 50 MB automation engine memory budget. | Heap profiling with 1000 concurrent duration timers. |

### 2.7 §11 Observability — Add timer metrics

**FIND (in §11.1 Metrics table, after the last row):**

> | `hs_automation_subscriber_lag` | Gauge | `subscriber_id` | Events behind log head per subscriber. |

**INSERT AFTER (new rows):**

> | `hs_automation_duration_timers_active` | Gauge | — | Currently active duration timer count. |
> | `hs_automation_duration_timers_started_total` | Counter | `trigger_type` | Duration timers started, by trigger type. |
> | `hs_automation_duration_timers_expired_total` | Counter | `trigger_type` | Duration timers that expired (trigger fired), by trigger type. |
> | `hs_automation_duration_timers_cancelled_total` | Counter | `trigger_type` | Duration timers cancelled (predicate became false), by trigger type. |
> | `hs_automation_duration_timer_limit_exceeded_total` | Counter | — | Duration timer starts rejected due to `max_concurrent_duration_timers` limit. |

**FIND (in §11.2 Structured Logging table, after the `automation.disabled` row):**

> | `automation.disabled` | WARN | `automation_id`, `reason`, `failure_count` | Auto-disabled due to repeated failures. |

**INSERT AFTER (new rows):**

> | `automation.trigger.duration.started` | DEBUG | `automation_id`, `trigger_index`, `entity_ref`, `for_duration`, `expires_at` | Duration timer started for a trigger predicate match. |
> | `automation.trigger.duration.expired` | DEBUG | `automation_id`, `trigger_index`, `entity_ref`, `for_duration`, `started_at` | Duration timer expired — trigger fires. |
> | `automation.trigger.duration.cancelled` | DEBUG | `automation_id`, `trigger_index`, `entity_ref`, `for_duration`, `started_at`, `cancelling_event_id` | Duration timer cancelled by state change. |
> | `automation.trigger.duration.limit_exceeded` | WARN | `automation_id`, `trigger_index`, `concurrent_timers`, `max_concurrent_duration_timers` | Duration timer start rejected — concurrent timer limit reached. Trigger fires immediately. |

### 2.8 §11.3 Health Indicator — Add duration timer degradation condition

**FIND (in §11.3 Health Indicator table, in the DEGRADED row):**

> | `DEGRADED` | One or more automations auto-disabled, or any subscriber lag exceeds 100 events, or pending command timeout rate exceeds 20% over 5-minute window. |

**REPLACE WITH:**

> | `DEGRADED` | One or more automations auto-disabled, or any subscriber lag exceeds 100 events, or pending command timeout rate exceeds 20% over 5-minute window, or duration timer limit exceeded more than 3 times within 60 seconds. |

### 2.9 §13 Testing Strategy — Add duration trigger tests

**FIND (in §13.1 Unit Tests, after the last bullet):**

> - **Conflict detection:** Test detection of contradictory commands from different automations targeting the same entity.

**INSERT AFTER:**

> - **Duration trigger — timer fires after state held:** Configure a `state_change` trigger with `for_duration: "PT5S"`. Inject the triggering `state_changed` event. Verify no Run is created immediately. Advance time by 5 seconds (or allow the virtual thread to sleep in test). Verify the trigger fires, producing `trigger_duration_started` and `trigger_duration_expired` events, followed by the normal Run lifecycle (`automation_triggered`, etc.).
> - **Duration trigger — timer cancels on state change before expiry:** Configure a `state_change` trigger with `for_duration: "PT10S"` and `to: "true"`. Inject `state_changed(to: "true")`. Verify timer starts. After 3 seconds, inject `state_changed(to: "false")`. Verify `trigger_duration_cancelled` event. Verify no Run is created.
> - **Duration trigger — concurrent timer bound enforcement:** Configure `max_concurrent_duration_timers: 5`. Start 5 duration timers. Attempt to start a 6th. Verify `trigger_duration_limit_exceeded` event. Verify the 6th trigger fires immediately (fallback behavior).
> - **Duration trigger — REPLAY suppression:** During REPLAY, inject events that would start duration timers. Verify no timers are started. Verify existing `trigger_duration_started`/`trigger_duration_expired` events are consumed to rebuild timer state.
> - **Duration trigger — interaction with `single` concurrency mode:** Start a Run on an automation in `single` mode. While the Run is active, start a duration timer on a different trigger of the same automation. When the timer expires, verify the trigger is evaluated against the concurrency mode (dropped per `single` mode, since a Run is active). Verify `automation_run_skipped` event.
> - **Duration trigger — no restart on subsequent matching events:** Start a duration timer with `for_duration: "PT10S"`. After 5 seconds, inject another matching event. Verify the timer is not restarted (original timer continues with 5 seconds remaining, not reset to 10 seconds).

**FIND (in §13.2 Integration Tests, after the last bullet):**

> - **Crash recovery:** Execute Runs with pending commands, simulate crash (kill subscriber), restart, verify pending command idempotency handling (re-issue IDEMPOTENT, expire NOT_IDEMPOTENT).

**INSERT AFTER:**

> - **Duration trigger end-to-end:** Trigger → duration timer → expiry → condition → action → command. Verify complete event chain including `trigger_duration_started`, `trigger_duration_expired`, and all Run trace events with correct causal references.
> - **Duration trigger across restart:** Start a duration timer, simulate crash. On restart (REPLAY→LIVE), verify the timer is reconstructed with the remaining duration. If the timer should have expired during downtime, verify the trigger fires immediately upon LIVE transition.
> - **Hot reload with active duration timer — conservative cancellation:** Start a duration timer. Reload `automations.yaml` with a changed trigger definition for that automation. Verify the pending timer is cancelled (conservative behavior). Verify `trigger_duration_cancelled` event with reason `definition_changed`.
> - **Hot reload with active duration timer — preservation:** Start a duration timer. Reload `automations.yaml` with no change to the trigger definition for that automation (e.g., only action changes). Verify the pending timer is preserved (sophisticated behavior — trigger definition unchanged, timer continues).

### 2.10 §3.7 Run Lifecycle — Add hot-reload interaction note

**FIND (in §3.7, the paragraph beginning "**Definition hash.**"):**

> **Definition hash.** The `automation_triggered` event payload includes a `definition_hash` field: a SHA-256 hash of the serialized automation definition active at trigger time.

**INSERT BEFORE:**

> **Interaction with duration timers on hot-reload (AMD-25).** When `automations.yaml` is reloaded, the TriggerEvaluator inspects all pending duration timers. For each timer, it compares the trigger definition hash of the timer's automation at the trigger index where the timer is active. If the trigger definition has changed (hash mismatch), the timer is cancelled — this is the conservative behavior that prevents a timer from firing under a definition that no longer matches the original predicate. If the trigger definition is unchanged, the timer is preserved. This selective cancellation ensures that editing one trigger on an automation does not invalidate duration timers on other, unchanged triggers of the same automation. Timer cancellation due to reload produces a `trigger_duration_cancelled` DIAGNOSTIC event with `reason: "definition_changed"`.
>

### 2.11 §14 Future Considerations — Note on Tier 2 trigger applicability

**FIND (in §14, at the beginning):**

> **Time-based triggers (Tier 2).** The trigger type taxonomy includes `time` and `sun` types with defined schemas.

**INSERT BEFORE:**

> **`for_duration` on Tier 2 trigger types (deferred).** The `for_duration` modifier is specified for Tier 1 trigger types only: `state_change`, `state`, `numeric_threshold`, and `availability`. Whether `for_duration` applies to Tier 2 trigger types (`time`, `sun`, `presence`, `webhook`) is deferred — the semantics differ for non-state triggers. Duration on a `time` trigger ("fire 5 minutes after 10 PM") is arguably a schedule offset, not a state-held pattern. Duration on a `presence` trigger ("fire when person is in zone for 10 minutes") is semantically valid and likely. This decision is escalated to the Hivemind for resolution when Tier 2 trigger types are specified.
>

---

## 3. DIAGNOSTIC Event Definitions

The following DIAGNOSTIC events are added to the automation engine's event production surface. All use `automation` subject type and `DIAGNOSTIC` priority. They carry `event_category: ["automation"]`.

| Event Type | When Produced | Key Payload Fields |
|---|---|---|
| `trigger_duration_started` | Duration timer starts after a trigger predicate matches with `for_duration` set | `automation_id`, `trigger_index`, `starting_event_id`, `entity_ref`, `for_duration_ms`, `expires_at`, `trigger_type` |
| `trigger_duration_expired` | Duration timer expires — predicate held for the full duration; trigger fires | `automation_id`, `trigger_index`, `starting_event_id`, `entity_ref`, `for_duration_ms`, `started_at`, `trigger_type` |
| `trigger_duration_cancelled` | Duration timer cancelled because predicate became false, or automation definition reloaded with changed trigger | `automation_id`, `trigger_index`, `starting_event_id`, `entity_ref`, `for_duration_ms`, `started_at`, `cancelling_event_id` (nullable — null for reload cancellation), `reason` (`state_changed` or `definition_changed`), `trigger_type` |
| `trigger_duration_limit_exceeded` | Duration timer start rejected because `max_concurrent_duration_timers` is reached | `automation_id`, `trigger_index`, `entity_ref`, `concurrent_timer_count`, `max_concurrent_duration_timers`, `trigger_type` |
| `trigger_duration_state_validated` | State validation at timer expiry found a discrepancy (defense-in-depth check) | `automation_id`, `trigger_index`, `entity_ref`, `expected_value`, `actual_value`, `trigger_type` |

**Event type registration.** These five event types must be added to the Event Model taxonomy (Doc 01 §4.3) under the `automation` event namespace. They follow the existing naming convention: `{subsystem}_{concept}_{action}`. All are DIAGNOSTIC priority — they exist for trace viewer debugging and operational monitoring, not for downstream automation logic.

---

## 4. Relationship to `wait_for` Action

The `for_duration` trigger modifier and the `wait_for` action both express temporal patterns, but they serve different purposes and have different resource characteristics.

| Dimension | `for_duration` (trigger modifier) | `wait_for` (action) |
|---|---|---|
| **Evaluation phase** | Pre-Run. Timer runs before any Run is created. | Post-Run. Timer runs inside an active Run. |
| **Run slot consumption** | None. Duration timers do not count against `max_total_runs`. | One Run slot consumed for the entire wait duration. |
| **Event production** | DIAGNOSTIC events only (`trigger_duration_*`). No Run lifecycle events until the trigger fires. | Full Run lifecycle events: `automation_triggered`, `automation_action_started`, `automation_action_completed`, etc. |
| **Use case** | "Fire when state held for N" — the temporal condition is part of the trigger predicate. | "After triggering, wait for a condition to become true before proceeding" — the temporal condition is part of the action sequence. |
| **Example** | "Turn off HVAC when no occupancy **for 30 minutes**" | "Turn on light, then **wait for** brightness sensor to confirm > 200 lux within 10 seconds" |
| **Cancellation** | State change cancels the timer. No Run was ever created. | Run is in `RUNNING` state. Timeout produces `automation_action_completed` with outcome `timeout`. |
| **Recommendation** | **Preferred** for "state held for N" patterns. | Use for post-trigger temporal conditions within an action sequence. |

**Guidance for users.** When the desired pattern is "fire only when a state has been true for N minutes," `for_duration` on the trigger is always preferred over an immediate trigger followed by a `wait_for` action. The `for_duration` approach is more resource-efficient (no Run slot consumed), produces cleaner traces (no Run lifecycle events for transient states), and is semantically clearer (the duration is part of the trigger definition, not the action sequence).

---

## 5. Implementation Notes

**Timer mechanism.** The amendment specifies the behavioral contract without mandating a specific implementation mechanism. The recommended approach, consistent with how `delay` and `wait_for` work, is virtual thread sleep via `Thread.sleep(Duration)`. Each duration timer spawns a virtual thread that:

1. Records itself in the `ConcurrentHashMap<DurationTimerKey, DurationTimer>` managed by TriggerEvaluator.
2. Sleeps for the specified duration.
3. On wakeup: checks whether it was interrupted (cancelled) or completed normally (expired).
4. On expiry: performs the state validation read, then feeds the trigger match back into the evaluation pipeline at step 4 (deduplication).
5. On cancellation: cleans up the map entry and produces the cancellation event.

**Alternative: Timing wheel.** For deployments approaching the 1000-concurrent-timer ceiling, a timing wheel (e.g., Hashed Timing Wheel or Hierarchical Timing Wheel) would be more memory-efficient — O(1) per timer tick instead of O(N) sleeping threads. However, at 1000 timers × ~1 KB per virtual thread = ~1 MB, the virtual thread approach is well within resource bounds on RPi 5. The timing wheel optimization is a Phase 3 implementation choice, not a design-level decision. The behavioral contract is the same regardless of mechanism.

**PM position on mechanism:** Virtual thread sleep. It is consistent with the existing codebase pattern (LTD-01, LTD-11), uses no additional dependencies, and the resource cost at the configured ceiling (1000 timers) is negligible. The timing wheel is overengineering for MVP.

**DIAGNOSTIC event payload — reference by ID vs. inline.** Duration timer DIAGNOSTIC events carry `automation_id` + `trigger_index` as references, not the full trigger definition inline. The trigger definition is retrievable from the AutomationRegistry by `(automation_id, trigger_index)`. This keeps event payloads compact and avoids duplicating the trigger definition across multiple events for the same timer lifecycle.

---

## 6. Invariant Alignment

| Invariant | How AMD-25 Satisfies It |
|---|---|
| **INV-TO-01** (Observable) | Duration timer lifecycle produces four DIAGNOSTIC event types. Active timer count exposed as a JFR metric. Structured log entries for all timer state transitions. |
| **INV-TO-02** (Automation determinism) | Timer start/cancel is deterministic: same event stream + same configuration = same timer lifecycle. Timer start depends solely on the trigger predicate match and `for_duration` value. Cancellation depends solely on subsequent events. No non-deterministic clock reads during REPLAY (timers suppressed). |
| **INV-PR-03** (Bounded resources) | Concurrent timer count bounded by `max_concurrent_duration_timers` (default: 1000). Maximum single timer duration bounded by `max_for_duration_ms` (default: 24 hours). Graceful degradation when limit reached (trigger fires immediately). |
| **INV-ES-06** (Explainable state) | Every duration trigger firing traces to: the original `state_changed` event that started the timer (`starting_event_id`), the `trigger_duration_started` event, the `trigger_duration_expired` event, and the resulting `automation_triggered` event. The trace viewer can reconstruct the full temporal pattern. |

---

## 7. Cross-Subsystem Impact

| Subsystem | Impact | Action Required |
|---|---|---|
| **Event Model (Doc 01)** | 5 new DIAGNOSTIC event types in `automation` namespace added to §4.3 taxonomy. | Upstream amendment to Doc 01 §4.3 event taxonomy table (add `trigger_duration_*` event types). Minor — taxonomy is extensible by design. |
| **State Store (Doc 03)** | State validation read at timer expiry uses existing `StateQuery.getState()`. No new interface required. | None. |
| **Configuration System (Doc 06)** | `automations.yaml` JSON Schema must accept `for_duration` field on trigger definitions. Two new engine config keys in `homesynapse.yaml` schema. | Schema update during Phase 2 interface spec for automation module. |
| **REST API (Doc 09)** | Duration timer DIAGNOSTIC events appear in event query responses. No new endpoints. | None. |
| **Observability (Doc 11)** | 5 new JFR metrics, 4 new structured log event types. | Catalog update during Phase 2 interface spec. |
| **Startup/Lifecycle (Doc 12)** | REPLAY→LIVE timer reconstruction is a new startup step within the automation engine's initialization sequence. | Doc 12's automation engine startup step should note the timer reconstruction phase. Minor. |

---

## 8. Success Criteria Checklist

- [x] Amendment text specifies `for_duration` field on all four Tier 1 trigger types with precise semantics
- [x] Timer lifecycle fully specified: start condition, cancel condition, expiry behavior, concurrent timer bound
- [x] REPLAY behavior explicitly specified (timers suppressed during replay, reconstructed at REPLAY→LIVE transition)
- [x] Four DIAGNOSTIC event types defined for timer observability (started, expired, cancelled, limit_exceeded) plus one defense-in-depth event (state_validated)
- [x] Configuration section specifies `max_for_duration_ms` and `max_concurrent_duration_timers` with ranges and defaults
- [x] Performance target for timer management overhead stated with measurement method
- [x] Testing strategy includes all seven required scenarios
- [x] Amendment is self-consistent with existing Doc 07 §3.4 trigger evaluation procedure and §3.5 deduplication
- [x] The `wait_for` action relationship documented: when to use which, and why `for_duration` is preferred for "state held" patterns
- [x] Hot-reload interaction specified (conservative cancellation when trigger definition changes, preservation when unchanged)

---

## 9. Hivemind Review — 2026-03-17

**Decision: APPROVED WITH CONDITIONS**

The amendment is well-designed, thorough, and consistent with the existing architecture. It addresses a genuine user-facing capability gap that would represent a regression vs. Home Assistant's `for:` modifier — one of HA's most-used trigger features. The design is clean: trigger-level modifier, pre-Run timer semantics, no new sealed interface subtypes, virtual thread implementation consistent with LTD-01/LTD-11 patterns.

### Review Against Criteria

**1. Does `for_duration` solve a real problem?** Yes. Without it, users must approximate the "state held for N" pattern using `wait_for` action, which (a) consumes a Run slot for the entire duration, (b) fires the trigger immediately for what may be a transient state producing noisy traces, and (c) is semantically wrong — the duration is part of the trigger predicate, not the action sequence. The four use cases in §0 (HVAC occupancy, garage door, lights, water sensor) are the bread-and-butter patterns of residential automation.

**2. Consistency with Doc 07 §3.4 trigger evaluation model.** Clean. The amendment inserts between step 3 (predicate match) and step 4 (deduplication). When `for_duration` is present, the timer delays entry into step 4 until expiry. The triggering event for deduplication is the original event that started the timer, preserving causal linkage. No existing steps are modified.

**3. REPLAY suppression (§2.2) vs. Doc 07 §3.10 / Doc 01 §3.7.** Consistent. Timers suppressed during REPLAY follows the same pattern as action execution suppression and derived event suppression. DIAGNOSTIC events consumed to rebuild state mirrors how RunManager reconstructs active Run tracking from existing `automation_triggered`/`automation_completed` events. REPLAY→LIVE timer reconstruction with `remaining_duration` calculation is sound.

**4. REPLAY→LIVE timer reconstruction semantics.** Sound. `remaining_duration ≤ 0` fires immediately — correct for timers that should have expired during downtime. Each timer tracked by `(automation_id, trigger_index)` limits to one timer per key, so no "multiple timers" ambiguity at transition. State validation at expiry (§2.1 step 4) catches the edge case where state changed during downtime without producing a cancellation event.

**5. `(automation_id, trigger_index)` tracking key — see Condition 2 below.**

**6. "No restart on subsequent matching events."** Correct and matches HA semantics. The first match starts the timer; subsequent matches do not reset it. This is the expected behavior for "occupancy off for 30 minutes" — each "still off" event should not restart the timer. A future `restart_on_match` option could be added if user demand materializes, but the HA-compatible default is right for MVP.

**7. Concurrent timer limit (1000) and "fire immediately" fallback.** 1000 timers × ~1.2 KB = ~1.2 MB — well within the 50 MB automation engine memory budget. "Fire immediately" is the correct fallback — the user's automation still runs (without temporal guard), and the degradation is observable via DIAGNOSTIC event and WARN log. The alternative ("drop the trigger") would silently break automations.

**8. DIAGNOSTIC events.** Sufficient. The five event types cover the full timer lifecycle plus the defense-in-depth validation check. `trigger_duration_state_validated` is worth the minimal implementation cost (one State Store read at expiry + one conditional event) — its diagnostic value in rare-but-confusing edge cases justifies the complexity.

**9. Hot-reload interaction (§2.10) — see Condition 1 below.**

**10. Cross-subsystem impacts (§7).** Thorough. All six subsystem impacts correctly identified with appropriate action items. No blocking misses.

**11. Performance targets (§2.6).** Realistic. ConcurrentHashMap.get() is O(1), virtual thread spawn ~1 μs, Thread.interrupt() ~1 μs. The 1 ms p99 budget at 200 concurrent timers provides 1000× headroom. Memory targets are well-justified.

**12. `PT` restriction.** Correct for MVP. Calendar durations are ambiguous across DST transitions. `PT24H` covers all reasonable home automation use cases. The restriction can be relaxed in a future amendment if needed.

### Conditions (must be addressed before applying to Doc 07)

**Condition 1: Add explicit handling for "automation deleted during pending timer" to §2.10.**

The current §2.10 text describes what happens when a trigger definition changes (hash mismatch → cancel) or is unchanged (preserve). But it does not explicitly address what happens when the entire automation is deleted from `automations.yaml` during a pending timer. When the trigger index is rebuilt after reload and the automation no longer exists, there is no trigger definition to compare against. The expected behavior — cancel the timer — is likely what would happen (the automation_id lookup returns nothing, which is a "change"), but it should be stated explicitly.

Add to §2.10: "If an automation is removed from `automations.yaml` during a reload, all pending duration timers for that automation are cancelled immediately. The cancellation produces `trigger_duration_cancelled` DIAGNOSTIC events with `reason: "automation_removed"`. If an automation is disabled (via API or `automations.yaml` change) during a pending timer, the timer is not proactively cancelled — if the timer expires, the standard evaluation pipeline checks the automation's enabled state at step 2 (§3.4) and skips execution, producing an `automation_run_skipped` event."

Add `"automation_removed"` to the `reason` field's enumeration in the `trigger_duration_cancelled` event definition (§3, table row 3).

**Condition 2: Document the multi-entity trigger limitation.**

The `(automation_id, trigger_index)` tracking key means at most one duration timer exists per trigger, regardless of how many entities the trigger monitors. For single-entity triggers (the common case), this is correct. For triggers using multi-entity selectors (area, label, type selectors), this creates a semantic limitation: the first matching entity starts the timer, and only that entity's subsequent state changes can cancel it. If entity A starts the timer and entity A's state reverts (timer cancelled), entity B (which also matched) does not automatically start a new timer — it would need to produce a new event.

Add a note to §2.1, after the "Duration timer tracking key" paragraph: "**Multi-entity selector limitation.** When a trigger uses an area, label, or type selector that resolves to multiple entities, the `(automation_id, trigger_index)` tracking key means only one duration timer can be active for that trigger. The first entity whose state matches the trigger predicate starts the timer. Only that entity's subsequent state changes are evaluated for cancellation. If the timer is cancelled and another entity in the selector's scope is already in the matching state, no new timer starts until that entity produces a new `state_changed` event. This is a known limitation acceptable for MVP — group-duration semantics (e.g., 'all entities in area X in state Y for N minutes') would require a per-entity tracking key and are deferred to a future amendment if user demand materializes."

### Non-Blocking Observations

1. **Tier 2 trigger applicability (§2.11).** The deferred decision on `for_duration` for Tier 2 triggers is appropriate. `presence` triggers with `for_duration` ("person in zone for 10 minutes") are the most likely future extension. The Hivemind agrees this should be decided when Tier 2 triggers are specified.

2. **Timing wheel optimization (§5).** The PM's position — virtual thread sleep for MVP, timing wheel deferred to Phase 3 if needed — is correct. At 1000 timers × ~1 KB, the resource cost is negligible on RPi 5.

3. **DIAGNOSTIC event retention.** Duration timer DIAGNOSTIC events follow the 7-day retention window. For timers with `for_duration` up to 24 hours, this provides at minimum 6 days of post-expiry trace retention. Sufficient for debugging.

4. **The `wait_for` relationship table (§4).** Excellent addition. This will prevent user confusion and reduce support burden. The guidance is clear and correct.
