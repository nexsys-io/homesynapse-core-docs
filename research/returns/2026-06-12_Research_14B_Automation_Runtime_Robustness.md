# Research 14-B: Automation Engine Runtime — Robustness Prior Art
*Target: HomeSynapse M7 AMD block + M7.x/M8.x instructions + M7/M8 charter. Date: 2026-06-12.*

## 0. Quote-back gate [M — FIRST]

**(a) §0.2 `module-info.java` embed (verbatim):**

```java
/*
 * HomeSynapse Core
 * Copyright (c) 2026 NexSys. All rights reserved.
 */

/**
 * Automation engine module: trigger-condition-action rules, cascade governor,
 * command dispatch, and pending command tracking.
 *
 * <p>This module defines the public API contracts for the HomeSynapse automation
 * subsystem. It exports sealed type hierarchies (triggers, conditions, actions,
 * selectors), data records (automation definitions, run contexts, pending commands),
 * and service interfaces consumed by the REST API, WebSocket API, Observability,
 * and Lifecycle modules.</p>
 */
module com.homesynapse.automation {
    requires transitive com.homesynapse.platform;
    requires transitive com.homesynapse.event;
    requires transitive com.homesynapse.device;
    requires transitive com.homesynapse.state;

    // M4.0b-4a: PendingCommand's javadoc references com.homesynapse.value
    // .AttributeValue (via {@link Expectation#evaluate}); declared non-transitive
    // (value is not on automation's public API). The type is also reachable
    // transitively through `requires transitive com.homesynapse.device`; the edge
    // is declared explicitly at its use site per the relocation design note.
    requires com.homesynapse.value;

    exports com.homesynapse.automation;
}
```

**(b) §0.3.1 inventory-summary line (verbatim):**

**~53 public types in ONE FLAT package `com.homesynapse.automation`: 5 enums · 1 typed ULID wrapper (`RunId`) · 4 sealed hierarchies with 30 permits (Selector 6, all Tier 1 · TriggerDefinition 9 = 5 Tier 1 + 4 Tier 2 empty-reserved · ConditionDefinition 7 = 6 Tier 1 + 1 Tier 2 · ActionDefinition 8 = 5 Tier 1 + 3 Tier 2) · 4 data records (`AutomationDefinition` 12 fields, `RunContext` 8 fields, `PendingCommand` 8 fields, `DurationTimer` 8 fields) · 9 service interfaces.** *(Permit total re-derived from source 2026-06-12: 6+9+7+8 = 30.)*

**(c) §0.3.3 decided-ground table — six rows (verbatim):**

| # | Decided item | Status |
|---|---|---|
| 1 | **DQ resolutions (Nick, 2026-05-30):** Pending-Command-Ledger projection handlers register on the existing `DispatchingProjectionAdvancer` (separate registrations; split only at M8 if unmanageable); zone/geofence evaluation = M8 | **DECIDED — not open questions** |
| 2 | **REC-36 (re-anchored):** `RunContext.cascadeDepth: int` will be REPLACED by `causalChain: RunCausalChain` in the M7 AMD block (supersedes AMD-04); the `depth()` accessor feeds the §3.7.1 governor unchanged | **ACCEPTED, pending the M7 AMD block** |
| 3 | **REC-39 (re-anchored, HIGH):** the M7 automation event vocabulary lands in `com.homesynapse.event` (flat) under a type-residency rule — **automation-resident types (`RunId`, `RunStatus`, `PendingStatus`) MUST NOT appear in event payloads** (JPMS cycle); flattened identifiers or relocation = an AMD-block decision; every new event type rides the manifest fan-out (55/24/36 + consumer/pin survey) | **ACCEPTED, pending the M7 AMD block** |
| 4 | **The replay hazard class is named:** side-effecting subsystems re-derive state during REPLAY but NEVER re-execute side effects (the AMD-41-class rule; Doc 07 §3.10 applies it to automation). Run-persistence findings must be expressed against this rule | **LOCKED discipline** |
| 5 | **C8 `actorRef` (PROPOSED 2026-06-08):** automations stamp `actorRef = AutomationId` on every command/event they originate; bare `Ulid` envelope field unchanged | **PROPOSED — ratification on the W25 critical path** |
| 6 | **Co-design carry-pin discipline (the OR-M6-NONCE pattern):** crash/restore-correctness hazards (your RQ4 findings) land as EXPLICIT carry pins in milestone rows, co-designed with the features they interact with — your job is to identify the hazards precisely enough to pin | **STANDING process rule** |

> **Connector reachability note (§5 cross-ref):** The `homesynapse-core-docs` connector was not directly reachable in this run; Doc 07 §§3.2/3.4–3.8/3.10/3.11/4.2–4.3/6.5–6.7/10, `01-event-model.md` §3/§4.3, and AMD-25 are cited from the §0.3 embed (which the brief declares AUTHORITATIVE for those anchors). No anchor was reconstructed beyond what §0.3 embeds; where a finding needs a fact not embedded, it is flagged in §5 rather than invented.

## 1. Executive Summary [M]

- **The single highest-impact finding: HomeSynapse's `forDuration` timer must be driven by a monotonic clock for elapsed-time decisions, not the wall-clock `Instant` the Clock-injection discipline exposes.** Every surveyed duration system (Java `System.nanoTime`, POSIX `CLOCK_MONOTONIC`) is explicit that wall-clock time can step backward on NTP correction and produce zero/negative intervals; since `DurationTimer.expiresAt` is an `Instant` rebuilt from events, the sustain-check arithmetic is the crash-window most exposed to clock skew. This is an M7 test obligation, not a contract change.
- **The single nastiest crash-window hazard: the checkpoint-vs-side-effect non-atomicity gap between `command_dispatch_service` dispatching a command and the `pending_command_ledger` durably recording DISPATCHED.** Temporal's own docs concede activities are at-least-once and a side effect "could result in the Side Effect function executing more than once"; HomeSynapse's three-independent-checkpoint model (§0.3.1) means a crash between physical dispatch and ledger-write replays as "never dispatched." This must be a named M7 carry pin per §0.3.3 row 6, expressed against the AMD-41-class re-derive-never-re-execute rule (row 4).
- **Depth-bounding alone (the frozen `max_cascade_depth` 8/§3.7.1) is necessary but NOT sufficient; prior art justifies same-automation cycle detection.** SQL Server's hard 32-level nesting cap terminates loops but does not *diagnose* the offending cycle; the re-anchored REC-36 `RunCausalChain` (row 2) makes the full chain first-class and should carry an explicit same-automation-in-chain check as an M7 obligation.
- **The frozen ledger's coalescing-DISABLED rule is correct and prior-art-validated; do not revisit it.** MQTT QoS 2's four-packet PUBREC/PUBREL/PUBCOMP handshake exists precisely because collapsing in-flight command identity produces duplicate or lost execution — HomeSynapse's per-command ledger identity is the same discipline. This is ALREADY-COVERED, and any "add coalescing for efficiency" finding is a REJECT.
- **Event-storm survivability is structurally closed at the run layer but UNTESTED; storm simulation is an M7 test obligation.** Reactive Streams mandates bounded queues and `maxConcurrent` bounds runs — but as the brief notes, `maxConcurrent` bounds runs, not trigger evaluations, so the trigger-index hot path (§3.4) under burst needs an explicit Pi-4-class storm benchmark.
- **HomeSynapse's event-sourced replay posture is materially ahead of Home Assistant's, whose `delay`/`wait`/`for` state is documented as completely lost on restart.** The frozen §3.10 timer-rebuild-from-events rule already closes HA's worst-known class of bug; "automations should survive restart" is correctly a FAILED finding — but the *recovery-ordering races* it introduces are new and need pins.
- **Verdict on retry posture: the frozen surface's absence of a retry field is defensible, but a deadline-default policy and an explicit no-auto-retry anti-requirement are M7 obligations.** Zigbee APS auto-retries (default 1.5s, up to 2 APS retries) and MQTT's resend-until-ack both show retry belongs at the transport/device layer, below the ledger — confirming HomeSynapse should NOT add engine-level retry.

## 2. Prior-Art Deep Dives [M]

### 2.1 Quartz Scheduler — misfire instruction taxonomy (RQ1)
**(a) Mechanism.** Quartz classifies a firing as *misfired* only after it passes its next-fire-time by more than a threshold. Per the Quartz Configuration Reference (`org.quartz.jobStore.misfireThreshold`): "The number of milliseconds the scheduler will tolerate a trigger to pass its next-fire-time by, before being considered 'misfired'. The default value... is 60000 (60 seconds)" — this applies to both JobStoreSupport and RAMJobStore. A misfire is then resolved by a per-trigger *misfire instruction*. The defaults resolve via `MISFIRE_INSTRUCTION_SMART_POLICY`:
- SimpleTrigger SMART_POLICY: repeatCount==0 → `FIRE_NOW`; repeatCount==REPEAT_INDEFINITELY → `RESCHEDULE_NEXT_WITH_REMAINING_COUNT`; repeatCount>0 → `RESCHEDULE_NOW_WITH_EXISTING_REPEAT_COUNT`.
- CronTrigger SMART_POLICY resolves to `MISFIRE_INSTRUCTION_FIRE_ONCE_NOW`.

**(b) Primary-source quotes.** "A misfire occurs if a persistent trigger 'misses' its firing time because of the scheduler being shutdown, or because there are no available threads in Quartz's thread pool for executing the job." (quartz-scheduler.org tutorial-lesson-04). And on the catch-up hazard: `MISFIRE_INSTRUCTION_IGNORE_MISFIRE_POLICY` — "if a trigger uses this instruction, and it has missed several of its scheduled firings, then several rapid firings may occur as the trigger attempt to catch back up to where it would have been" (Quartz Trigger Javadoc, reproduced at community.jaspersoft.com FAQ).

**(c) Documented failure modes.** The "thundering catch-up" — a fire-all-missed policy producing a burst of rapid firings after downtime (DZone: "you don't want to run it 20 times! One is enough"). And CronTrigger DST skip/double-fire: per the Quartz maintainers, a 2:15am daily trigger "will be skipped, since 2:15 am never occurs that day" on spring-forward (groups.google.com/g/quartznet).

**(d) Gap-relative lesson.** Quartz's taxonomy is the canonical decision-space for "what to do about a missed temporal firing." Against AMD-25 `forDuration` (§3.4) and the `DurationTimer`-rebuilt-from-events rule (§0.3.1): HomeSynapse's timer rebuild on REPLAY→LIVE is effectively a *re-derive next-fire-time* posture, which structurally avoids the catch-up burst (no missed firings are replayed as side effects — §3.10). The 60s-default threshold concept is the gap-relative input for the Tier-2 `TimeTrigger` promotion: when `TimeTrigger`/`SunTrigger` field shapes are designed, they must decide a misfire posture (fire-once-now vs skip) — FUTURE-AMD input.

### 2.2 cron / anacron / systemd timers — catch-up and DST (RQ1)
**(a) Mechanism.** Vixie/Debian cron special-cases clock shifts <3h: per `man 8 cron`, "If time was adjusted one hour forward, those jobs that would have run in the interval that has been skipped will be run immediately. Conversely, if time was adjusted backward, running the same job twice is avoided. Time changes of more than 3 hours are considered to be corrections to the clock or the timezone, and the new time is used immediately." (access.redhat.com/solutions/477963). systemd timers gate downtime catch-up behind `Persistent=`: "If true, the time when the service unit was last triggered is stored on disk. When the timer is activated, the service unit is triggered immediately if it would have been triggered at least once during the time when the timer was inactive… Defaults to false." (Arch Wiki / systemd docs).

**(b) Primary-source quotes.** See the `man 8 cron` quote above; and the systemd `Persistent=` semantics confirmed at the SUSE systemd-timers docs.

**(c) Documented failure modes.** systemd issue #24984: persistent timer did not trigger after a missed calendar run across suspend. systemd issue #16732: editing `OnCalendar=` and reloading caused timers to fire immediately because the recomputed deadline was in the past. The `RandomizedDelaySec=` interaction (Debian bug #997943) could mean a service "never actually" runs if the system is only up briefly.

**(d) Gap-relative lesson.** The "fire-on-boot vs skip vs configurable" taxonomy is the design space for the Tier-2 `TimeTrigger`. Against §3.10 (re-derive, never re-execute): HomeSynapse's event-sourced log means "missed while down" is answered by replay — but the *policy* (does a missed `TimeTrigger` window fire on boot?) is undecided because `TimeTrigger` is Tier-2 empty-reserved. The reload-recompute-fires-immediately bug (#16732) is a direct warning for `AutomationDefinition` edits + `definitionHash` (§0.3.1): a changed definition must not cause spurious immediate fires on REPLAY→LIVE. FUTURE-AMD input for Tier-2 + an M7 test obligation for `definitionHash` change handling.

### 2.3 Temporal / Cadence — durable timers and side-effect isolation (RQ4, canonical)
**(a) Mechanism.** Temporal records an immutable event history per workflow and reconstructs state by deterministic replay; side effects are confined to "activities" that are recorded once. Timers "are recorded as events and don't 'wait' again during replay."

**(b) Primary-source quotes.** "A Side Effect does not re-execute upon replay, but instead returns the recorded result. Do not ever have a Side Effect that could fail, because failure could result in the Side Effect function executing more than once." (docs.temporal.io/workflow-execution/event). "Time is read from the Workflow context so it matches the recorded history. Timers are recorded as events and don't 'wait' again during replay." (docs.temporal.io/workflows). Temporal provides "exactly-once execution semantics for Workflow logic and at-least-once for activities."

**(c) Documented failure modes.** Replay non-determinism: changing workflow code across a live execution diverges from recorded history (Temporal mandates versioning). Observability double-counting: Temporal's own guidance warns to avoid duplicating observation side effects on replay.

**(d) Gap-relative lesson.** Temporal is the exact prior art for §0.3.3 row 4 (re-derive-never-re-execute) and §3.10. The lesson that bites HomeSynapse: Temporal's "exactly-once for workflow logic, at-least-once for activities" is a precise statement that *the side-effect boundary is where exactly-once becomes a lie*. HomeSynapse's command dispatch is the "activity" boundary; `PendingStatus.EXPIRED = NOT_IDEMPOTENT on restart` (§0.3.1) is the correct, honest encoding of "we cannot prove this side effect happened exactly once." This validates the frozen design and yields the M7 crash-window pins in §3.2.

### 2.4 Akka Persistence — event-sourced recovery and the persist/side-effect ordering (RQ4)
**(a) Mechanism.** Event-sourced actors validate a command, persist the resulting event(s), then apply state. On recovery only persisted events are replayed (events cannot fail on replay, unlike commands). Commands received during recovery are stashed.

**(b) Primary-source quotes.** "When persisting events with persist it is guaranteed that the EventSourcedBehavior will not receive further commands until after the events have been confirmed to be persisted and additional side effects have been run." And the explicit warning: "It's possible to execute a side effect before persisting the event, but that can result in that the side effect is performed but the event is not stored if the persist fails." (doc.akka.io/libraries/akka-core/current/typed/persistence.html). On recovery-time side effects: "when run it in the RecoveryCompleted signal handler, a side effect may run more than once."

**(c) Documented failure modes.** Side-effect-before-persist → side effect happens, event lost on crash (the inverse of HomeSynapse's hazard). Shared `PersistenceId` corrupts replay. Recovery is bounded/throttled to avoid overloading the journal (thundering-herd on restart).

**(d) Gap-relative lesson.** Akka makes explicit the ordering rule HomeSynapse must pin: **persist the event before performing the side effect, and stash incoming commands during recovery.** Against the three-subscriber/three-checkpoint model (§0.3.1) and §3.10: HomeSynapse's `automation_engine`, `command_dispatch_service`, and `pending_command_ledger` each replay independently — the Akka "stash commands during recovery" rule maps to the recovery-ordering race where a subscriber acts on half-rebuilt state (an explicit RQ4 crash window → M7 pin). Akka's bounded-concurrent-recovery is gap-relative input for the storm/restart interaction.

### 2.5 Home Assistant — restart loss, loop behavior, event storms (RQ2/RQ4/RQ5)
**(a) Mechanism.** HA automations run in-memory; `delay`, `wait_for_trigger`/`wait_template`, and `for:` state conditions hold transient state that is not persisted. There is no structural loop protection between automations; the `repeat` action can spin unbounded.

**(b) Primary-source quotes.** "Lost wait states: Any automation using wait_for_trigger or wait_template with a timeout completely loses its state on restart. A 2-hour wait that's 90 minutes in will need to start over. Reset 'for' conditions: State triggers with 'for' conditions lose their timing state… Interrupted sequences… simply stop executing. There's no way to resume where they left off." (github.com/orgs/home-assistant/discussions/797). On loops: issue #115042 "Infinite loop in automation/script repeat causes Home Assistant to freeze" — "repeat causes a hang in some cases. At the same time, there is no information in the logs at all." On storms, per the Home Assistant core recorder log (community thread 747879, 2024-07-09): "The recorder backlog queue reached the maximum size of 178958 events; usually, the system is CPU bound, I/O bound, or the database is corrupt due to a disk problem; The recorder will stop recording events to avoid running out of memory." DST issue #58783 — after the fall-back hour, "high CPU usage, using a core at 100%" and "The recorder queue reached the maximum size of 30000".

**(c) Documented failure modes.** Total in-flight loss on restart; unbounded inter-automation loops with no diagnostic; recorder queue saturation (drop-and-stop) under storm; DST fall-back triggering a CPU storm.

**(d) Gap-relative lesson.** HA is the negative control. Against §3.10 + the timer-rebuild rule: HomeSynapse's event-sourced design already closes the "lost wait state" class — so "survive restart" is a FAILED (ALREADY-COVERED) finding. Against §3.7.1 cascade governance: HA's *absence* of loop protection is exactly what `max_cascade_depth` + `cascade_depth_exceeded` DIAGNOSTIC close — but HA's same-pair ping-pong loops (automation A↔B) are depth-shallow and would evade a pure depth bound, motivating cycle detection in REC-36's `RunCausalChain`. The recorder drop-and-stop is the gap-relative model for §6.7 / `MaxExceededSeverity`. (HA community complaints themselves are sibling-register; cited here only as maintainer-acknowledged engineering evidence.)

### 2.6 SQL Server nested triggers — depth cap as loop containment (RQ2)
**(a) Mechanism.** SQL Server bounds trigger/procedure/function/view nesting at a hard 32 levels; exceeding it aborts the whole call chain and rolls back the transaction. Recursion can be further disabled via `RECURSIVE_TRIGGERS` / `nested triggers` server option.

**(b) Primary-source quotes.** Per Microsoft Learn "Create Nested Triggers": "If nested triggers are allowed and a trigger in the chain starts an infinite loop, the nesting level is exceeded and the trigger terminates." The runtime surfaces this as Error 217: "Maximum stored procedure, function, trigger, or view nesting level exceeded (limit 32)." Also: "Because triggers execute within a transaction, a failure at any level of a set of nested triggers cancels the entire transaction, and all data modifications are rolled back."

**(c) Documented failure modes.** The cap fires as a blunt instrument: it aborts and rolls back the entire chain (Error 217) without identifying the offending cycle, and operators must add their own `TRIGGER_NESTLEVEL()` guards to break loops early (mssqltips.com tip 1713).

**(d) Gap-relative lesson.** SQL Server validates the *concept* of HomeSynapse's `max_cascade_depth` (default 8, range 1–32 — note the upper bound matches SQL Server's cap exactly). But its weakness — a depth cap diagnoses "too deep," not "which automation is looping" — is precisely the gap the re-anchored REC-36 `RunCausalChain` (§0.3.3 row 2) closes by making the chain first-class. Verdict: depth-bound is ALREADY-COVERED; same-automation cycle detection on the causal chain is the M7 obligation.

### 2.7 Node-RED — message loops and catch-node loop guard (RQ2)
**(a) Mechanism.** Node-RED has no global loop protection in normal message flow; community loop nodes implement their own max-loops/max-timeout guards. The one built-in guard is on the error `catch` node.

**(b) Primary-source quotes.** Maintainer (Nick O'Leary): "if a message is passed to a catch node from the same source node 10 times, then it is dropped and a warning logged. The theory here is that there are valid scenarios where you may want the message to loop through the catch node whilst retrying… Allowing 10 loops feels the right level for basic retry flows to work without any special measures needed." (groups.google.com/g/node-red). Loop-timer contrib node: "to ensure you do not end up with an infinite loop, you can set a maximum timeout… and when that time is reached, the loop and timer will also be stopped." (flows.nodered.org/node/node-red-contrib-looptimer).

**(c) Documented failure modes.** Unbounded `while(true)` in a function node → "FATAL ERROR: … JavaScript heap out of memory" (discourse.nodered.org). The catch-node guard required real-world iteration to tune.

**(d) Gap-relative lesson.** Node-RED's catch-node "same source 10 times → drop + warn" is a rate/count-based same-origin guard — a second prior-art vote (alongside SQL Server) for tracking origin identity, not just depth. Against §3.7.1 + REC-36: a count-of-same-automation-in-chain threshold is a defensible companion to depth-bounding. The "10 loops" number is an empirical tuning anchor, not a value to copy.

### 2.8 MQTT QoS ladder — the ack/confirm taxonomy (RQ3)
**(a) Mechanism.** MQTT defines three delivery guarantees: QoS 0 at-most-once (fire-and-forget), QoS 1 at-least-once (PUBLISH→PUBACK, duplicates possible), QoS 2 exactly-once via a four-packet handshake (PUBLISH→PUBREC→PUBREL→PUBCOMP). Packet identifiers tie acknowledgements to in-flight messages and are released only on handshake completion.

**(b) Primary-source quotes (OASIS spec, primary).** "The Packet Identifier becomes available for reuse after the sender has processed the corresponding acknowledgement packet… In the case of a QoS 1 PUBLISH, this is the corresponding PUBACK; in the case of QoS 2 PUBLISH it is PUBCOMP or a PUBREC with a Reason Code of 128 or greater." (docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html). On QoS 2 boundary semantics: "the receiver can use the PUBREL packet as a boundary and consider any PUBLISH packet that arrives before it as a duplicate and any PUBLISH packet that arrives after it as new." (emqx.com). On QoS 2 expiry-on-reconnect: the PUBCOMP carries a reason code "for the case when a client reconnects with clean start set to 0 and it has a QoS 2 message part way through its handshake, but the server has already expired the message." (codecentric.de).

**(c) Documented failure modes.** QoS 1 duplicate delivery (ack-lost-but-executed) — the receiving application "must be designed to be idempotent." QoS 0 silent loss. QoS 2 mid-handshake message expiry on reconnect (the exact analogue of `PendingStatus.EXPIRED`).

**(d) Gap-relative lesson.** MQTT's three-layer ack model maps cleanly to §3.11.2's `PendingStatus` FSM (DISPATCHED/ACKNOWLEDGED/CONFIRMED/TIMED_OUT/EXPIRED). Transport-ack ≈ ACKNOWLEDGED, application/state-confirmation ≈ CONFIRMED (via `Expectation.evaluate`), mid-flight expiry ≈ EXPIRED-NOT_IDEMPOTENT. The QoS 2 packet-id-released-only-on-PUBCOMP rule is the prior-art justification for coalescing-DISABLED (collapsing identity breaks exactly-once). Verdict: the ledger FSM is ALREADY-COVERED and well-founded; the *deadline default* and the explicit no-retry posture are M7 obligations.

### 2.9 Zigbee APS acks vs ZCL Default Response (RQ3)
**(a) Mechanism.** Zigbee acknowledges at two layers: MAC-layer (per-hop) and APS end-to-end. APS auto-retries on missing ack. Separately, the application layer can return a ZCL Default Response. APS ack ≠ proof the application acted.

**(b) Primary-source quotes.** "If the originator fails to receive this Ack, it retransmits the data, up to two times until an Ack is received. This Ack is called the Zigbee APS layer [acknowledgment]." (digi.com Zigbee retries/acks docs). On the default retry timeout, per Drew Gislason, EDN "ZigBee applications Part 7": "APS will automatically retry after the time-out period (which defaults to 1.5 seconds)." On broadcast: "There is no equivalent of the APS end-to-end acknowledgment for broadcast messages." (silabs.com UG103.2).

**(c) Documented failure modes.** Transport ack received but application never acted (the transport-ack-vs-application-ack gap). Broadcasts have no end-to-end confirmation at all.

**(d) Gap-relative lesson.** Zigbee makes the transport-ack vs application-ack distinction concrete and shows retry living at the transport layer (APS, default 1.5s, ≤2 retries). Against §3.11.2: this is the prior-art argument that HomeSynapse's ledger CONFIRMED state must be driven by *state confirmation* (`Expectation.evaluate` against device state), not by a transport ack — and that the absence of an engine-level retry field is correct because retry belongs below the ledger (REJECT engine retry). M7 obligation: document the transport-ack≠confirmation distinction as a ledger semantics test.

### 2.10 Kubernetes controllers — level-triggered reconciliation (RQ3/RQ4 alternative)
**(a) Mechanism.** Controllers reconcile to desired state on a level-triggered (not edge-triggered) basis; the workqueue holds keys, not events, and re-reads current state on each reconcile. Reconcile must be idempotent and tolerate lost/duplicated/out-of-order events.

**(b) Primary-source quotes.** controller-runtime: "Reconciliation is level-based, meaning action isn't driven off changes in individual events, but instead is driven by actual cluster state read from the apiserver or a local cache." (github.com/gianlucam76 reconciler.md). "if you miss an event, the next reconciliation catches it anyway." (platformwale.blog operators internals).

**(c) Documented failure modes.** Edge-triggered designs lose correctness if an event is missed; the level-triggered model trades that for the requirement that every reconcile be idempotent and re-read state.

**(d) Gap-relative lesson.** This is the declarative alternative to HomeSynapse's imperative confirm. HomeSynapse's single-`StateSnapshot`-at-trigger-time (AMD-03, §3.8) is deliberately *edge-ish* (one snapshot per Run), the opposite of level reconciliation. The lesson is not to change the model (guardrail 1) but to recognize the tradeoff: HomeSynapse's confirm-by-`Expectation` against a captured snapshot can suffer confirmation-by-stale-state, which k8s avoids by always re-reading. Verdict: M7 test obligation to assert `stateSnapshotPosition` confirmation semantics under a state change between dispatch and confirm; not a contract change.

### 2.11 Reactive Streams / Kafka — backpressure and bounded queues (RQ5)
**(a) Mechanism.** Reactive Streams mandates non-blocking backpressure so consumer demand bounds the queue; unbounded buffers are avoided by design, and unbackpressurable sources "must choose to either buffer or drop." Kafka consumers apply backpressure via `pause()`/`resume()` on partitions and bound batch size with `max.poll.records`.

**(b) Primary-source quotes.** "Since back-pressure is mandatory the use of unbounded buffers can be avoided… In the case of sources whose production rate cannot be influenced—for example clock ticks or mouse movement—the publisher must choose to either buffer or drop elements to obey the imposed bounds." (github.com/reactive-streams/reactive-streams-jvm). Kafka: "Kafka facilitates the dynamic control of consumption flows through the use of pause(Collection) and resume(Collection), enabling the suspension of consumption on specific assigned partitions." (dzone.com Kafka backpressure).

**(c) Documented failure modes.** Unbounded buffering → OOM (the "firehose into a teacup" failure). Slow consumer + auto-commit → silent message loss or duplicate reprocessing. GC pauses → heartbeat miss → rebalance storm.

**(d) Gap-relative lesson.** Reactive Streams validates HomeSynapse's bounded `maxConcurrent` (QUEUED/PARALLEL, default 10) and the drop-with-`MaxExceededSeverity` logging (§3.6/§6.7) as the correct "bounded queue + drop policy" posture. The critical gap-relative caveat (from the brief): `maxConcurrent` bounds *runs*, not *trigger evaluations* — the trigger index (§3.4) ingest path is the unbacked-pressured source. Verdict: storm survivability at the run layer is structurally closed (ALREADY-COVERED); a Pi-4-class storm simulation test is an M7 obligation; per-automation trigger-evaluation rate limiting is FUTURE-AMD.

### 2.12 SCADA / DNP3 — Select-Before-Operate command verification (RQ3)
**(a) Mechanism.** DNP3 and IEC 60870-5-104 use Select-Before-Operate (SBO): the master sends a SELECT to arm a control point, receives a validating response, then sends OPERATE which executes only if it matches the prior selection. A faster, less-safe DIRECT OPERATE skips the select.

**(b) Primary-source quotes.** "Select Before Operate—Geo SCADA Expert issues a two-phase Select/Operate control to the outstation. Geo SCADA Expert has to receive a valid response to the Select before it will issue the Operate." (tprojects.schneider-electric.com Geo SCADA DNP3 driver). "The select phase confirms device availability and parameter validity. The operate phase executes only if the select acknowledgment is valid — preventing accidental operations." (scadaprotocols.com DNP3 vs IEC 104).

**(c) Documented failure modes.** The select "arm" timer can expire before operate (stale selection); a DIRECT OPERATE bypasses the safety entirely. SBO state held by the outstation is lost on outstation restart ("Restore Output… a point's value is lost" on restart).

**(d) Gap-relative lesson.** SBO is the high-assurance command-verification end of the spectrum. HomeSynapse's ledger (dispatch→ack→confirm) is a single-phase confirmed-execution model, not two-phase arm/operate — which is appropriate for a home runtime (guardrail: not a contract change). The transferable lesson is the *arm-timer-expiry* analogue: the `PendingCommand.deadline` is HomeSynapse's equivalent of the select-arm timer, and SBO's "selection lost on restart" is the same hazard as `PendingStatus.EXPIRED = NOT_IDEMPOTENT on restart`. Verdict: deadline-default and expiry-on-restart semantics are M7 obligations; two-phase SBO is a REJECT for the home register.

## 3. Cross-Cutting Analysis [M]

### 3.1 Mechanism concept map

| Concern | Surveyed systems' answers | HomeSynapse frozen mechanism (anchor) |
|---|---|---|
| Temporal | Quartz misfire instructions (threshold 60s default, SMART_POLICY); cron <3h DST special-case; systemd `Persistent=` (default false); Temporal durable timers | AMD-25 `forDuration` (§3.4); `DurationTimer` rebuilt-from-events (§0.3.1); Clock-injection; `TimeTrigger`/`SunTrigger` Tier-2 empty-reserved |
| Cascade | SQL Server 32-level hard cap (Error 217); Node-RED catch-node "same source 10×→drop"; loop-timer max-loops | `cascadeDepth` + `max_cascade_depth` (8; range 1–32); `cascade_depth_exceeded` DIAGNOSTIC (§3.7.1); REC-36 `RunCausalChain` (row 2) |
| Confirmation | MQTT QoS 0/1/2 (PUBACK / 4-packet handshake); Zigbee APS ack (1.5s, ≤2 retries) vs ZCL Default Response; DNP3 SBO; k8s level reconcile | Ledger FSM `PendingStatus` 5 states (§3.11.2); `Expectation.evaluate` state-confirmation; `deadline`; `CommandIdempotency`; coalescing DISABLED |
| Recovery | Temporal replay + side-effect isolation; Akka persist-before-side-effect + stash-on-recovery; HA total in-flight loss | §3.10 re-derive-never-re-execute; `INTERRUPTED` runs; `startingEventId` dedup; `definitionHash`; 3-subscriber/3-checkpoint (§0.3.1) |
| Storm | Reactive Streams bounded-queue+drop; Kafka pause/resume + `max.poll.records`; HA recorder drop-and-stop | `maxConcurrent` bounds (default 10 QUEUED/PARALLEL); `MaxExceededSeverity` drop logging; trigger index O(1) (§3.4); §6.7 |

### 3.2 The crash-window hazard table (RQ4)

| Hazard (named crash window) | Prior-art mitigation | HomeSynapse mechanism | Disposition |
|---|---|---|---|
| **W1: crash between physical command dispatch and ledger DISPATCHED write** | Temporal at-least-once activities; record intent before acting | Ledger `command_issued`→`dispatched`; EXPIRED=NOT_IDEMPOTENT | CLOSED-UNTESTED → M7 test: "kill between dispatch and ledger-write; assert replay marks NOT_IDEMPOTENT, no silent double-dispatch" |
| **W2: crash mid-`forDuration` sustain window** | Quartz timer rebuild; Temporal timers re-recorded not re-waited | `DurationTimer` rebuilt from events on REPLAY→LIVE; keyed (automationId, triggerIndex), at most one per key | CLOSED-UNTESTED → M7 test: "kill mid-sustain; assert single timer rebuilt, no double-fire" |
| **W3: NTP step / wall-clock skew during a duration measurement** | `nanoTime`/`CLOCK_MONOTONIC` for elapsed time | Clock-injection (wall-clock `Instant` for `expiresAt`) | OPEN → M7 obligation: monotonic-clock discipline for sustain arithmetic; see REC-156 |
| **W4: recovery-ordering race — subscriber acts on half-rebuilt state** | Akka stash-commands-during-recovery; bounded concurrent recovery | 3 independent subscribers/checkpoints replay independently | OPEN → M7 carry pin: define REPLAY→LIVE barrier ordering across the 3 subscribers; see REC-159 |
| **W5: in-flight run at crash** | Temporal resumes; HA loses it | `RunStatus.INTERRUPTED` produced at REPLAY→LIVE (§3.10) | CLOSED → ALREADY-COVERED (§3.10) |
| **W6: command confirmed by stale state** | k8s re-reads current state on reconcile | `stateSnapshotPosition` single snapshot (AMD-03); `Expectation.evaluate` | CLOSED-UNTESTED → M7 test: "state changes between dispatch and confirm; assert confirmation semantics" |
| **W7: `definitionHash` mismatch on replay (definition edited mid-flight)** | systemd #16732 (reload → spurious immediate fire); Temporal versioning | `RunContext.definitionHash` (SHA-256 replay verification) | CLOSED-UNTESTED → M7 test: "edit definition mid-flight; assert no spurious fire, INTERRUPTED handling" |
| **W8: ledger EXPIRED entry on restart** | MQTT QoS2 mid-handshake expiry on reconnect; DNP3 SBO selection lost on restart | `PendingStatus.EXPIRED = NOT_IDEMPOTENT` | CLOSED → ALREADY-COVERED (§0.3.1, §4.3) |

### 3.3 The ledger semantics matrix (RQ3)

| Ack layer | Prior art | §3.11.2 / ledger mapping |
|---|---|---|
| Transport ack (delivered to device) | MQTT PUBACK (QoS1); Zigbee APS ack (1.5s, ≤2 retries); DNP3 SELECT response | `PendingStatus.ACKNOWLEDGED` |
| Application ack (device processed) | Zigbee ZCL Default Response; DNP3 OPERATE response | (between ACKNOWLEDGED and CONFIRMED) |
| State confirmation (world changed) | k8s level-reconcile re-read; MQTT QoS2 PUBCOMP completion | `PendingStatus.CONFIRMED` via `Expectation.evaluate` |
| Timeout / arm-expiry | DNP3 select-arm timer; MQTT message-expiry-interval | `PendingStatus.TIMED_OUT`; `deadline` (Instant) |
| Mid-flight expiry on restart | MQTT QoS2 reconnect-expiry; DNP3 selection-lost-on-restart | `PendingStatus.EXPIRED = NOT_IDEMPOTENT` |
| Exactly-once identity (no collapsing) | MQTT QoS2 packet-id-held-until-PUBCOMP | coalescing DISABLED (correctness-critical) |
| Retry | Zigbee APS (transport-layer, 1.5s/≤2); MQTT resend-until-ack (transport) | **NO retry field** — retry deliberately below the ledger |

### 3.4 Over-engineering check (REJECT-candidates / honesty section)

- **Three independent subscribers/checkpoints (§0.3.1).** Prior art (Akka bounds concurrent recovery; Temporal uses one history per workflow) might suggest a single checkpoint is simpler. **Defend:** the dispatch/ledger separation is exactly the side-effect-isolation boundary Temporal validates; three checkpoints is the cost of honest at-least-once side effects. Keep — but pin the cross-subscriber recovery ordering (W4).
- **`max_cascade_depth` range up to 32.** SQL Server caps at 32 as a hard safety limit, not a routine operating point; a home automation chain reaching even 8 is almost certainly a bug. **Defend (weakly):** the default of 8 is reasonable; the 1–32 range is harmless configurability. Not a REJECT, but note the realistic working value is low single digits.
- **Engine-level retry — correctly ABSENT.** Both MQTT and Zigbee put retry at the transport layer. Adding an engine retry field would be over-engineering and would corrupt the exactly-once ledger accounting. **REJECT** any finding proposing engine retry.
- **Coalescing — correctly DISABLED.** Validated by MQTT QoS2 identity rules. **REJECT** any "add coalescing for efficiency" proposal.

## 4. Findings + Recommendations [M]

### 4a. REC-numbered findings (ranked by (impact × confidence)/cost)

**REC-156 — Monotonic-clock discipline for `forDuration` sustain arithmetic (concern: temporal/recovery).** Evidence: Java/POSIX guidance that wall-clock time steps on NTP and can yield zero/negative intervals (itnext.io monotonic-clock). The canonical incident is Cloudflare's 2017-01-01 00:00 UTC leap-second RRDNS outage, per Cloudflare's incident blog (John Graham-Cumming): "a number went negative when it should always have been, at worst, zero. A little later this negative value caused RRDNS to panic." Root cause: Go's `time.Now()` "does not guarantee monotonicity"; the bug affected ~0.2% of DNS queries across 102 datacenters (The Register). Gap-relative: Clock-injection (§0.3.1) + AMD-25 `forDuration` (§3.4); `DurationTimer.expiresAt` is an `Instant`. Recommendation: M7 instruction that sustain-check *elapsed-time* decisions use a monotonic source while wall-clock `Instant` remains for `expiresAt` persistence/replay anchoring; add a clock-step test. Effort: S.

**REC-157 — Storm simulation test on the trigger-evaluation path (concern: storm).** Evidence: HA recorder backlog saturation at 178,958 events with drop-and-stop behavior (community thread 747879); Reactive Streams bounded-queue mandate. Gap-relative: §6.7, §3.4 trigger index, §10 targets; `maxConcurrent` bounds runs not trigger evals. Recommendation: M7 test obligation — Pi-4-class burst simulation asserting the trigger index stays within §10 targets and drop logging via `MaxExceededSeverity` engages before memory pressure. Effort: M.

**REC-158 — Same-automation cycle detection on `RunCausalChain` (concern: cascade).** Evidence: SQL Server depth cap diagnoses depth not cycle (Microsoft Learn create-nested-triggers, Error 217); Node-RED catch-node "same source 10×→drop" (groups.google.com/g/node-red). Gap-relative: §3.7.1 + REC-36 `RunCausalChain` (row 2). Recommendation: M7 AMD-block content — when `cascadeDepth` becomes `causalChain`, carry a same-automation-in-chain detector emitting a distinct diagnostic (vs the depth diagnostic). Effort: M.

**REC-159 — REPLAY→LIVE cross-subscriber ordering barrier (concern: recovery).** Evidence: Akka "stash commands during recovery… will not receive further commands until after events confirmed persisted and side effects run" (doc.akka.io persistence). Gap-relative: §3.10 + 3-subscriber/3-checkpoint model (§0.3.1). Recommendation: M7 carry pin (OR-M6-NONCE pattern) — specify the barrier guaranteeing no subscriber executes side effects against half-rebuilt state during the other subscribers' replay. Effort: L.

**REC-160 — Dispatch/ledger atomicity crash-window pin (concern: recovery, the nastiest).** Evidence: Temporal "a Side Effect that could fail… could result in the Side Effect function executing more than once" (docs.temporal.io/workflow-execution/event); Akka side-effect-before-persist warning. Gap-relative: §0.3.3 row 4; §3.11; `EXPIRED=NOT_IDEMPOTENT`. Recommendation: M7 carry pin + kill-mid-flight test for window W1 (crash between physical dispatch and ledger DISPATCHED write); assert replay never silently double-dispatches. Effort: M.

**REC-161 — Deadline default policy for `PendingCommand` (concern: confirmation).** Evidence: Zigbee APS default 1.5s timeout (EDN, Gislason: "APS will automatically retry after the time-out period (which defaults to 1.5 seconds)"); MQTT message-expiry-interval. Gap-relative: §4.3 ledger model; `deadline` (Instant). Recommendation: M7 obligation — define a documented default deadline (and per-`ActionDefinition` overridability) so confirmation timeouts are deterministic; spike to calibrate against real Zigbee/Z-Wave round-trips on Pi-4. Effort: S.

**REC-162 — Explicit no-engine-retry anti-requirement (concern: confirmation).** Evidence: MQTT/Zigbee place retry at transport (docs.oasis-open.org/mqtt/mqtt/v5.0; Zigbee APS 1.5s/≤2). Gap-relative: frozen surface has NO retry field. Recommendation: record as an anti-requirement (REJECT bucket) with reasoning so M7/M8 implementers do not add engine retry. Effort: S.

**REC-163 — Transport-ack ≠ state-confirmation ledger test (concern: confirmation).** Evidence: Zigbee APS ack vs ZCL Default Response distinction (digi.com); k8s re-read-on-reconcile. Gap-relative: §3.11.2 `Expectation.evaluate`. Recommendation: M7 test — assert a transport ack alone never advances a command to CONFIRMED; only `Expectation` satisfaction does. Effort: S.

**REC-164 — Confirmation-by-stale-state test against `stateSnapshotPosition` (concern: confirmation/recovery).** Evidence: k8s level-triggered re-read avoids stale action (github.com/gianlucam76 reconciler.md). Gap-relative: AMD-03 single snapshot (§3.8); `stateSnapshotPosition`. Recommendation: M7 test — state changes between dispatch and confirm; assert documented, deterministic confirmation semantics (snapshot-relative). Effort: S.

**REC-165 — `definitionHash` mid-flight-edit replay test (concern: recovery/temporal).** Evidence: systemd #16732 reload→spurious immediate fire; Temporal versioning. Gap-relative: `RunContext.definitionHash` (§0.3.1). Recommendation: M7 test — edit `AutomationDefinition` while a run is in flight; assert hash-mismatch handling (INTERRUPTED, no spurious fire). Effort: M.

**REC-166 — Tier-2 `TimeTrigger`/`SunTrigger` misfire-posture field shape (concern: temporal, FUTURE).** Evidence: Quartz misfire taxonomy (fire-once-now vs do-nothing); cron <3h DST special-case (access.redhat.com/solutions/477963); systemd `Persistent=`. Gap-relative: Tier-2 empty-reserved triggers; §3.4. Recommendation: FUTURE-AMD input — when `TimeTrigger` is promoted, its field shape must accommodate a misfire/catch-up posture (fire-on-boot vs skip vs configurable) and an explicit DST policy (skip the non-existent 02:30; pick first occurrence on fall-back). Do NOT draft. Effort: M.

**REC-167 — DST policy test for `forDuration` spanning a transition (concern: temporal).** Evidence: cron 2:30am-skip / 1:30am-double (blog.healthchecks.io Debian cron DST); HA DST CPU storm #58783. Gap-relative: AMD-25 `forDuration`; Clock-injection. Recommendation: M7 test — a `forDuration` window spanning spring-forward/fall-back computes true elapsed time (reinforces REC-156's monotonic posture). Effort: S.

**REC-168 — Per-automation trigger-evaluation rate limiting (concern: storm, FUTURE).** Evidence: Node-RED catch-node rate guard; Kafka `pause()`/`resume()` (dzone.com Kafka backpressure). Gap-relative: `maxConcurrent` bounds runs, not trigger evals (§3.6/§3.4). Recommendation: FUTURE-AMD contract-delta sketch — a per-automation trigger-evaluation rate limit distinct from `maxConcurrent`. Do NOT draft. Effort: M.

**REC-169 — Storm-coupling diagnostic: storm × cascade interaction (concern: storm/cascade).** Evidence: HA feedback loops (#115042 repeat-freeze) + recorder saturation co-occurrence; Akka thundering-herd-on-recovery. Gap-relative: §6.7 + §3.7.1. Recommendation: M8 obligation — observability that correlates `cascade_depth_exceeded` diagnostics with storm/drop events to detect pathological storm→automation→storm feedback. Effort: M.

**REC-170 — Recovery thundering-herd bound on REPLAY→LIVE (concern: recovery/storm).** Evidence: Akka bounds concurrent recoveries to avoid overloading the journal (github.com/akka persistence.md). Gap-relative: 3-subscriber model (§0.3.1); LTD-03 SQLite via persistence platform-thread executor. Recommendation: M8 obligation — bound the rate of timer-rebuild/run-resume work at REPLAY→LIVE so SQLite (single platform-thread executor) is not saturated on a Pi-4 restart. Effort: M.

### 4b. THE DISPOSITION TABLE [M — load-bearing]

| REC | Disposition | Anchor / reasoning |
|---|---|---|
| REC-156 | **M7-OBLIGATION** | Monotonic-clock sustain arithmetic; test obligation under Clock-injection (§0.3.1) + AMD-25 (§3.4) |
| REC-157 | **M7-OBLIGATION** | Storm-simulation test; §6.7 + §3.4 + §10 |
| REC-158 | **M7-OBLIGATION** | Same-automation cycle detection rides REC-36 `RunCausalChain` AMD-block (row 2) + §3.7.1 |
| REC-159 | **M7-OBLIGATION** | Cross-subscriber REPLAY→LIVE barrier carry pin; §3.10 + §0.3.1 |
| REC-160 | **M7-OBLIGATION** | Dispatch/ledger atomicity crash-window pin + test; §0.3.3 row 4, §3.11 |
| REC-161 | **M7-OBLIGATION** | Deadline default policy; §4.3 |
| REC-162 | **REJECT** | Engine-level retry; prior art (MQTT/Zigbee) puts retry below the ledger — anti-requirement |
| REC-163 | **M7-OBLIGATION** | Transport-ack≠CONFIRMED test; §3.11.2 |
| REC-164 | **M7-OBLIGATION** | Confirmation-by-stale-state test; AMD-03 (§3.8) |
| REC-165 | **M7-OBLIGATION** | `definitionHash` mid-flight-edit test; §0.3.1 |
| REC-166 | **FUTURE-AMD** | Tier-2 `TimeTrigger`/`SunTrigger` misfire+DST field shape input (do not draft) |
| REC-167 | **M7-OBLIGATION** | DST-spanning `forDuration` test; AMD-25 |
| REC-168 | **FUTURE-AMD** | Per-automation trigger-eval rate limit (contract delta; do not draft) |
| REC-169 | **M8-OBLIGATION** | Storm×cascade coupling observability; §6.7 + §3.7.1 |
| REC-170 | **M8-OBLIGATION** | Recovery thundering-herd bound at REPLAY→LIVE; §0.3.1 + LTD-03 |

**Bucket coverage check:** ALREADY-COVERED — not assigned a REC because the items that fall here (survive-restart via §3.10; `INTERRUPTED` runs; EXPIRED-on-restart; coalescing-disabled; depth-bounding itself) are frozen machinery, correctly scored as coverage attestations in §3.2/§3.4 rather than new recommendations (per Evidence Standard 5). M7-OBLIGATION — REC-156, 157, 158, 159, 160, 161, 163, 164, 165, 167. M8-OBLIGATION — REC-169, 170. FUTURE-AMD — REC-166, 168. POST-MVP — genuinely empty: every finding in this engineering register maps to runtime contracts or tests; UI/cloud-lane items are the sibling 14-A register (out of register here). REJECT — REC-162. No REC appears in two buckets.

## 5. Caveats and Open Questions [M]

- **Connector reachability.** The `homesynapse-core-docs` connector/project files were not directly reachable in this run. All Doc 07 / event-model / AMD-25 anchors are cited from the §0.3 embed, which the brief declares AUTHORITATIVE. No anchor content was reconstructed beyond the embed. If the PM needs verbatim §3.10 / §3.11.2 / §6.7 wording to finalize the W4/W1 pins, request those sections — they are not embedded at quote granularity.
- **Source reliability.** Primary specs (OASIS MQTT 5.0, Zigbee/CSA spec, Quartz official docs/Javadoc, systemd issues, Akka docs, Temporal docs, Microsoft Learn, Cloudflare incident blog) are high-confidence. Some failure-mode evidence (HA community threads, vendor blogs) is secondary/maintainer-acknowledged rather than formal post-mortem; flagged inline. The Quartz CronTrigger "fire now" constant is officially `MISFIRE_INSTRUCTION_FIRE_ONCE_NOW` (Javadoc), though Tutorial Lesson 6 prose loosely writes "FIRE_NOW" — noted to avoid a fabricated-identifier error.
- **Spike candidates (empirical validation on Pi-4-class hardware).** (1) REC-161 deadline default — calibrate against real Zigbee/Z-Wave/Matter round-trip times. (2) REC-157 storm threshold — find the actual trigger-eval rate at which a Pi-4 misses §10 targets. (3) REC-170 recovery herd — measure SQLite single-executor saturation point on restart with N in-flight timers.
- **Out-of-register note (guardrail 5).** Strong community/UX evidence exists (HA users repeatedly demanding restart-persistence) — that is the sibling 14-A register; noted once, not pursued.
- **Evidence completeness.** Web reach was sufficient across all five RQs (cron/anacron, systemd, Quartz, Temporal, Akka, HA, SQL Server, Node-RED, MQTT spec, Zigbee, k8s, Reactive Streams, Kafka, DNP3). NOT declaring INCOMPLETE-EVIDENCE.

## 6. Appendix: Sources [M]

- **Quartz:** quartz-scheduler.org tutorials lesson-04/05/06; configuration/ConfigRAMJobStore.html (misfireThreshold default 60000ms); Javadoc (javadoc.io org.quartz-scheduler 1.8.2/2.1.0/2.3.1, MISFIRE_INSTRUCTION_FIRE_ONCE_NOW); community.jaspersoft.com FAQ; dzone.com/articles/quartz-scheduler-misfire; groups.google.com/g/quartznet (DST).
- **cron/anacron/systemd:** access.redhat.com/solutions/477963 (man 8 cron <3h rule); wiki.archlinux.org/title/Systemd/Timers; documentation.suse.com systemd timers; github.com/systemd/systemd issues #24984, #16732; groups.google.com Debian bug #997943; blog.healthchecks.io Debian cron DST.
- **Temporal:** docs.temporal.io/workflow-execution/event; docs.temporal.io/workflows; temporal.io/blog.
- **Akka:** doc.akka.io/libraries/akka-core/current/typed/persistence.html; github.com/akka/akka persistence.md; getakka.net event-sourcing.
- **Home Assistant:** github.com/orgs/home-assistant/discussions/797; github.com/home-assistant/core issues #115042, #58783; community.home-assistant.io recorder-backlog thread 747879; home-assistant.io/integrations/recorder.
- **SQL Server:** learn.microsoft.com create-nested-triggers (Error 217, limit 32); mssqltips.com tip 1713; blog.sqlauthority.com.
- **Node-RED:** groups.google.com/g/node-red catch-node (10-loop guard); flows.nodered.org node-red-contrib-looptimer; discourse.nodered.org.
- **MQTT:** docs.oasis-open.org/mqtt/mqtt/v5.0/ (spec, primary); emqx.com; hivemq.com; codecentric.de; steves-internet-guide.com.
- **Zigbee:** csa-iot.org Zigbee Specification (primary); digi.com retries/acks; edn.com APS (1.5s default); silabs.com UG103.2.
- **Kubernetes:** github.com/gianlucam76 reconciler.md; platformwale.blog operators internals; chainguard.dev reconciliation.
- **Reactive Streams / Kafka:** github.com/reactive-streams/reactive-streams-jvm (spec); dzone.com Kafka backpressure; tuleism.github.io parallel-backpressured-kafka-consumer.
- **SCADA/DNP3:** scadaprotocols.com DNP3 vs IEC 104; tprojects.schneider-electric.com Geo SCADA DNP3 driver; chipkin.com DNP3 control points.
- **Clocks:** itnext.io monotonic clock; dev.to monotonic clocks; artofcode.wordpress.com nanoTime vs currentTimeMillis; Cloudflare 2017 leap-second RRDNS outage incident blog (John Graham-Cumming) + The Register report.

## 7. HomeSynapse Code-Level Implications [LIGHT]

Observations only (all routed through §4b; NO module-info changes, NO new types, NO contract drafts; identifiers from §0.2/§0.3.1 verbatim):
- `DurationTimer` (fields `startingEventId`, `expiresAt`, `virtualThread`; NOT persisted; keyed (automationId, triggerIndex)) is the locus of REC-156/167 (monotonic sustain arithmetic) and W2 (mid-sustain crash). `expiresAt` being an `Instant` is the wall-clock exposure.
- `RunContext` (`definitionHash`, `cascadeDepth`, `stateSnapshotPosition`) is the locus of REC-158 (`cascadeDepth`→`causalChain` per REC-36/row 2), REC-164/165 (`stateSnapshotPosition`/`definitionHash` tests), W6/W7.
- `PendingCommand` (`expectation`, `deadline`, `idempotency`, `status`) and `PendingStatus` (DISPATCHED/ACKNOWLEDGED/CONFIRMED/TIMED_OUT/EXPIRED) are the locus of REC-160/161/162/163 and W1/W8. EXPIRED=NOT_IDEMPOTENT is the honest exactly-once boundary.
- The three Phase-3 subscribers (`automation_engine`, `command_dispatch_service`, `pending_command_ledger`), each with its own virtual thread and checkpoint, plus LTD-01 (virtual threads) and LTD-03 (SQLite via persistence platform-thread executor), are the locus of REC-159 (W4 barrier) and REC-170 (recovery herd). No `synchronized` (LTD-11) and Clock-injection are the standing constraints these observations respect.
- Per §0.3.3 row 3, none of `RunId`/`RunStatus`/`PendingStatus` may appear in event payloads (JPMS cycle) — any M7 event vocabulary realizing these RECs uses flattened identifiers, an AMD-block decision.