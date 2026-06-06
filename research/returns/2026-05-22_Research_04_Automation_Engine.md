# Research 4: Automation Engine Architecture — Trigger/Condition/Action Pipeline Design

**Target:** HomeSynapse Core M7/M8
**Date:** 2026-05-22
**Module:** `core/automation` (package `com.homesynapse.automation`)
**Document ID:** R4-M7M8-2026-05-22

---

## 1. Executive Summary

- **The 8-permit `TriggerDefinition` sealed hierarchy must be expanded to 13 permits to reach parity with Home Assistant's production trigger surface, because** every competing platform supports webhook, calendar, and geo/zone triggers as first-class concepts, and shoehorning these into `EventTrigger` reproduces the same anti-pattern OpenHAB normalized as `GenericEventTrigger` (acknowledged by openHAB docs to require manual filtering against the event bus). **★ HIGHEST-IMPACT FINDING — see REC-31, REC-32, REC-37.**
- **AMD-03's positional-snapshot condition evaluation should be retained, not retracted, because** the Home Assistant condition docs explicitly document the race that AMD-03 fixes — *"A trigger can observe that a switch is being turned on… [but] by the time the automation checks the conditions from the switch on event, it may already be off again as its current state"* — and no other competitor offers a coherent answer.
- **AMD-04 cascade-depth limiting should be retained but reformulated as a per-Run *causal chain*, not a *call stack*, because** real-world infinite loops in HA and openHAB are dominated by automation-A ↔ automation-B ping-pong via shared state (numerous community threads, e.g. `community.home-assistant.io/t/automation-1-or-2-generates-an-infinite-loop/370817`), not by recursive same-automation re-entry. The current depth counter under-counts cross-automation cascades by design.
- **A separate `Scene` primitive should be rejected in favour of an `Automation` with a sealed `ManualTrigger` permit, because** Matter Scenes are a transport-layer optimization (Scene Table stored on the device endpoint) that does not belong in HomeSynapse's application-layer model, and HA/HomeKit "scenes" are functionally indistinguishable from manually-invoked automations — HomeKit's own documentation defines a scene as *"a state for one or more devices"* with no trigger semantics of its own.
- **The Pending Command Ledger should be retained but downgraded from mandatory to opt-in via a `ConfirmationPolicy` field on `ActionDefinition`, because** Home Assistant's per-integration "optimistic mode" documentation (verbatim across `switch.mqtt`, `light.mqtt`, `valve.mqtt`) establishes that fire-and-forget is the dominant pattern: *"In this mode, the switch will immediately change state after every command. Otherwise, the switch will wait for state confirmation from the device."* Only locks, garage doors, and Z-Wave-S2-Supervision-encapsulated commands need end-to-end confirmation (drzwave.blog door-lock best practices: *"The use of Supervision command class ensures delivery and execution of any Z-Wave command and should be used with any critical function of any device"*).
- **`DeviceReachableChanged` (REC-25) should be a dedicated `ReachabilityTrigger` permit, not piped through `EventTrigger`, because** reachability is at DEVICE-level granularity and requires built-in debouncing — HA users currently work around its absence by triggering on `state == 'unavailable'`, a pattern repeatedly criticized as fragile in community threads.
- **Semantic-tag-aware `Selector` filtering should be adopted (REC-34) because** Home Assistant's 2024.4 release shipped labels as direct action targets (verbatim, HA 2024.4 release blog: *"Just like with floors, you can use labels in your automations and scripts as a target for your actions"*), validating the design pattern as a production-ready abstraction.
- **`DispatchingProjectionAdvancer` (REC-28) needs handlers for only **5 of 11** automation event types because** automation lifecycle events (created/updated/disabled/enabled/deleted) are projection-state-changing, but run-execution events (started/completed/condition_evaluated/action_dispatched/action_confirmed/cascade_limit_exceeded) are observability-only and do not mutate the automation-definition projection.

---

## 2. Platform / Literature Deep Dives

### 2.1 Home Assistant automations

**(a) How it solves the problem.** Home Assistant decomposes automations into three explicit stages: `triggers`, `conditions`, `actions`. Triggers are subscriptions to the event bus (state-change, event, time-pattern, MQTT, webhook, template, etc.); when fired, conditions are evaluated *at trigger time* against the current state snapshot; actions are then dispatched sequentially. Scripts are reusable action sequences (no triggers); Scenes since 2022.2 have a state (last-activated timestamp) and can themselves participate in triggers. The complete set of trigger platforms documented at `home-assistant.io/docs/automation/trigger/` is: `state`, `numeric_state`, `event`, `time`, `time_pattern`, `template`, `sun`, `zone`, `geo_location`, `mqtt`, `webhook`, `tag`, `device`, `calendar`, `conversation`, `persistent_notification`, `homeassistant` (start/shutdown), and `sentence`.

The canonical motion-light pattern uses *two* triggers on the same sensor, distinguished by `id:` and the `for:` modifier on the OFF transition (from `community.home-assistant.io/t/motion-activated-lights-automation/608968`):

```yaml
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: 'on'
    id: motion_on
  - trigger: state
    entity_id: binary_sensor.motion
    to: 'off'
    for: { minutes: 5 }
    id: motion_off
```

Re-triggering during the active period is governed by `mode:`. Per the official Automation Modes docs at `home-assistant.io/docs/automation/modes/`: *"For both queued and parallel modes, configuration option max controls the maximum number of runs that can be executing and/or queued up at a time. The default is 10."* Modes are `single` (default — drop and warn), `restart` (kill and restart), `queued` (FIFO up to `max`), `parallel` (concurrent up to `max`). `max_exceeded` silences the warning when single-mode drops a run.

**(b) Direct quotation — the canonical state-race documentation:**
> "A trigger will look at events happening in the system while a condition only looks at how the system looks right now. A trigger can observe that a switch is being turned on. A condition can only see if a switch is currently on or off… By the time the automation checks the conditions from the switch on event, it may already be off again as its current state."
> — `home-assistant.io/docs/automation/condition/`

**(b.bis) Fire-and-forget command semantics.** HA does *not* end-to-end confirm service calls against device state. The canonical evidence is per-integration "optimistic" docs, repeated verbatim across MQTT switch/light/valve/cover:
> "When a `state_topic` is not available, the switch will work in optimistic mode. In this mode, the switch will immediately change state after every command. Otherwise, the switch will wait for state confirmation from the device (message from `state_topic`). The initial state is set to False / off in optimistic mode. Optimistic mode can be forced, even if the `state_topic` is available."
> — `home-assistant.io/integrations/switch.mqtt/`

An HA `light.turn_on` with `brightness: 50%` returns success as soon as the integration acknowledges the call, even if the bulb ends up at 48%. This is platform-wide, not MQTT-specific.

**(c) Pain points / failure modes.**
- The `for:` modifier loses state across restart. Per the official Automation Triggers docs at `home-assistant.io/docs/automation/trigger/`: *"Use of the for option will not survive Home Assistant restart or the reload of automations. During restart or reload, automations that were awaiting for the trigger to pass, are reset."*
- Infinite loops between automations are documented in many community threads (e.g. `community.home-assistant.io/t/automation-1-or-2-generates-an-infinite-loop/370817`); HA has no built-in cascade limiter and users implement context-id filtering manually.
- Templates re-evaluate only when referenced entity IDs change, not periodically — `now()`-based templates silently misbehave unless they reference a `sensor.time` from the Time/Date integration.
- Traces are kept in-memory and persisted as `trace.saved_traces` JSON only on shutdown. GitHub issue `home-assistant/core#70310` documents that double-restart silently overwrites traces with empty data.

**(d) Lesson for HomeSynapse.** Trigger ID and the `for:` modifier are validated patterns and should be preserved (the latter is already AMD-25). Mode-single + `max_exceeded` maps to HomeSynapse `RunStatus.INTERRUPTED`. The absence of cascade governance is a known production gap — AMD-04 should be retained and tightened (REC-36), not relaxed.

### 2.2 openHAB rules

**(a) How it solves the problem.** openHAB's Next-Gen Rule Engine (since 2.4) structures rules as three module categories: `triggers`, `conditions`, `actions`, each addressable via REST (`GET /rest/rules/{ruleUID}/{moduleCategory}/{id}`). Trigger categories: Item-event (received command / received update / changed), Member-of-group, Time-based (Quartz cron), System-based (runlevel), Thing-based (status change ONLINE→OFFLINE), Channel-trigger.

The canonical motion pattern (Rules DSL form):

```
rule "Motion lights"
when
    Item Motion changed to ON
then
    Light.sendCommand(ON)
    createTimer(now.plusMinutes(5), [ |
        if (Motion.state == OFF) Light.sendCommand(OFF)
    ])
end
```

openHAB's `changed ... for` is the syntactic analogue of HA's `for:` but the semantics differ: openHAB schedules a timer that fires after the duration elapses and re-checks state, whereas HA's `for:` is part of trigger evaluation and resets when the condition flips during the window.

**(b) Direct quotation.**
> "'trigger' modules specify the events that trigger a rule execution. 'condition' modules act as a filter for rule execution. Actions of the rule will be executed only if event data satisfies all conditions. In case there are multiple conditions in the 'if' section then all of them must be satisfied. 'action' modules perform actual operations in openHAB. If more than one action is specified in a rule they will be executed sequentially. The output of the previous action can be used as an input for the next action."
> — `openhab.org/docs/concepts/rules`

**(c) Pain points.**
- DSL re-entrancy semantics around `received command` vs `changed` are notoriously confusing — the docs themselves warn: *"When using the received command trigger, the Rule will trigger before the Item's state is updated. Therefore, if the Rule needs to know what the command was, use the implicit variable receivedCommand instead of ItemName.state."*
- `Member of` triggers only work for *direct* group members (community thread `openhab.org/t/rule-does-not-trigger-with-member-of-changed/124950`).
- Rules persist as `.rules` text files AND via REST as JSON; the two storage layers are not reconciled, leading to ghost rules.

**(d) Lesson for HomeSynapse.** The module-typed REST surface (triggers/conditions/actions as separately addressable resources) is excellent precedent for the `com.homesynapse.api.rest` design — automations should expose `/automations/{id}/triggers/{idx}` rather than only `/automations/{id}`. Sequential action execution with previous-output-as-next-input is the same pattern as AMD-31's ULID-ordered dispatch.

### 2.3 Node-RED flow evaluation model

**(a) How it solves the problem.** Node-RED is a *message-passing* engine: nodes are stateful processors, wires define dataflow, messages (`msg` objects) propagate through the flow. There is no explicit trigger/condition/action separation — every node is a potential trigger (inject, mqtt-in, ha-event) and a potential action. Re-triggering is handled by the `delay` node in rate-limit mode (optionally discarding intermediate messages) or by `trigger` nodes that fire once and re-arm after a configurable timeout.

**(b) Direct quotation.**
> "When configured to rate limit messages, their delivery is spread across the configured time period. The status shows the number of messages currently in the queue. It can optionally discard intermediate messages as they arrive."
> — `flowfuse.com/node-red/core-nodes/delay/`

**(c) Pain points.** No native loop detection; cascading flows that loop back into an inject node are a well-known bug class. The motion-light "stay on while motion, then off after 5 min" pattern requires composing `trigger` + `delay` + `reset` nodes — non-trivial. Community thread `discourse.nodered.org/t/rate-detection-can-it-be-done-easily/24188` documents user confusion.

**(d) Lesson for HomeSynapse.** Node-RED demonstrates that *dataflow* is the wrong abstraction for declarative home automation — debuggability collapses past ~20 nodes. HomeSynapse's record-based trigger/condition/action separation is the right choice. The `msg.reset` pattern (cancelling pending downstream actions) validates that opt-in command confirmation has real use cases.

### 2.4 Apple HomeKit automation model

**(a) How it solves the problem.** HomeKit defines exactly five trigger types in the Home app: people arrive, people leave, time of day, accessory controlled, sensor detects. Conditions are AND-combined (time window, presence, accessory state). Actions are scene activations or accessory control. Third-party apps (Eve, Controller for HomeKit "Hub Mode") extend this with multi-trigger OR, custom conditions, time delays, and stop conditions.

**(b) Direct quotation.**
> "HomeKit rules are triggered by changes of state such as going from open to closed or from movement to no movement, but if some reason a trigger is missed you may have the wrong scene set for hours. My watchdog rechecks rules every 5 minutes."
> — `greening.me.uk/2020/09/19/automations-in-homekit/`

> "Scenes let you create many actions across your home at once, while automations involve events or actions triggering other actions."
> — `homekit.blog/creating-automations-and-scenes-with-apple-homekit-a-step-by-step-guide/`

**(c) Pain points.** No built-in cascade protection (and not really needed because the trigger surface is too narrow to cascade meaningfully). HomeKit's "Turn Off after X minutes" is built into the automation as a property, not a separate action — clean but limiting. Missed triggers produce permanent state desync until manual intervention.

**(d) Lesson for HomeSynapse.** The "watchdog re-check every N minutes" pattern is a workaround for missed triggers — HomeSynapse should not need this because conditions evaluate against the snapshot at trigger time (AMD-03). HomeKit's identification of a scene as "a state for one or more devices" validates REC-37 (drop separate Scene primitive).

### 2.5 Google Home routines

**(a) How it solves the problem.** Routines use starter/condition/action terminology. Starters: voice command, time, sunrise/sunset, alarm dismissal, device-does-something, presence sensing. Routines are constrained by combination rules (e.g. camera actions only when started by schedule, no 2FA-required actions as starters). Google's Premium "Help me create" tier uses LLMs to generate automations from natural-language descriptions.

**(b) Direct quotation.**
> "Important: The starters and actions available for a Routine depend on the type of Routine, connected devices, settings, and other limitations… A starter and action combination may not be available because of device or manufacturer limitations."
> — `support.google.com/assistant/answer/7672035`

**(c) Pain points.** Cloud-dependent; Google explicitly disclaims: *"Routines may not always work, and Google does not guarantee they will… Do not create Routines that could result in injury or harm if they fail to start or stop"* (developers.home.google.com/automations/starters-conditions-and-actions). A community-reported soft action limit (often cited as 30) is **not** documented as a hard policy — a Google Nest Community moderator post (`googlenestcommunity.com/t5/Home-Automation/Routines-now-limited-to-30-actions/m-p/462766`) states: *"you should be able to add more than 30 actions to your routine… we tried it on our test device, and it went up to 35 actions,"* confirming there is no documented hard 30-action ceiling but a soft warning around that range.

**(d) Lesson for HomeSynapse.** HomeSynapse should not impose hard action-count limits but should expose a configurable soft warning at ~50 actions (good UX signal). Cloud dependency is a feature gap HomeSynapse trivially closes (LTD-04 local-first).

### 2.6 Zigbee2MQTT automations

**(a) How it solves the problem.** Zigbee2MQTT has no native automation engine in core; it relies on external systems (Home Assistant, Node-RED, raw MQTT). Two community extensions (`zigbee2mqtt-automations` by Luligu, `zigbee2mqtt-extensions` by Anonym-tsk) add HA-syntax-similar YAML automations directly inside Z2M for sub-MQTT-latency execution. The maintainer (Koenkk) has declined to merge these into core, citing scope concerns (issue `#903`).

**(b) Direct quotation.**
> "Automations at zigbee2mqtt level execute at light speed, well before top platforms receive an mqtt message."
> — `github.com/Koenkk/zigbee2mqtt/discussions/20078`

**(c) Pain points.** Official position is "delegate to HA or Node-RED"; community extensions are unsupported and have non-trivial install flow (drop file into `external_extensions/`, reload via UI).

**(d) Lesson for HomeSynapse.** Latency matters enough that even Zigbee2MQTT's maintainer-resistant community demanded an embedded engine. HomeSynapse's local-first event-sourced runtime is the correct architectural choice — this is validation, not novelty.

### 2.7 Matter 1.4 Scenes cluster

**(a) How it solves the problem.** Matter's Scenes Management Cluster (formerly "Scenes"; provisional through Matter 1.4) stores attribute-value sets on the device endpoint, indexed by GroupID + SceneID, with optional TransitionTime in 1/10 ths of a second. Controllers call AddScene / RecallScene / StoreScene / RemoveScene. Scene Table entries include ExtensionFields (per-cluster attribute snapshots) that are written to clusters on Recall. Per Silicon Labs:

> "The Scenes Management Cluster… allows you to store a set of attribute-value pairs pertaining to one or more clusters on the same endpoint as the Scenes Management Cluster. The Matter controller can recall a stored scene which results in these values being written to the specified attributes to express the desired scene."
> — `docs.silabs.com/matter/latest/matter-application-development/matter-scenes-quick-start-guide`

Per the Connectivity Standards Alliance announcement (released August 11, 2025):
> "Matter 1.4.2 makes scene support certifiable, providing a standardized way for Controllers to define and activate scenes across multiple Matter devices."
> — `csa-iot.org/newsroom/matter-1-4-2-enhancing-security-and-scalability-for-smart-homes/`

**Matter command confirmation.** The Interaction Model defines Invoke transactions that return an `InvokeResponse` with per-command `CommandStatusIB`. *Timed* Invoke transactions add a Timed Request → Status Response preamble with a Transaction timeout — used for security-critical commands like UnlockDoor. Per the Matter Core spec:
> "A client MAY choose to use a Timed Invoke transaction even if the command does not have the Timed Interaction quality. The server SHALL support a Timed Invoke transaction for all commands."
> — Matter Core Spec §8 (mirror at `cookie-daily.life/src/matter/matter_html/Chapter%208.%20Interaction%20Model%20Specification.html`)

Nordic Semiconductor's documentation explains the security rationale:
> "This is a special case of the invoke interaction, a Timed interaction, which requires two more messages to be exchanged before the actual command is sent. These two messages are needed to make sure that an attacker cannot intercept and replay the command later to unlock the door when the house owner is away."
> — `developer.nordicsemi.com/nRF_Connect_SDK/doc/latest/nrf/protocols/matter/overview/int_model.html`

**(c) Pain points.** Scene Table is on-device; recovering scenes after factory reset requires the controller to re-push. Provisional status before 1.4.2 meant ecosystem support was uneven; numeric `SceneTableSize` minimum-per-fabric requirements are in the gated CSA spec PDF and not publicly verifiable.

**(d) Lesson for HomeSynapse.** A HomeSynapse "Scene" should NOT mirror Matter's Scene Table — that is a wire-protocol optimization. A HomeSynapse Scene is an Automation with a `ManualTrigger` and a sequence of attribute-set actions; if the targets happen to be Matter devices, the dispatcher can opportunistically translate to a Matter RecallScene call. Timed Invoke maps directly to `ConfirmationPolicy.REQUIRED` in REC-33.

### 2.8 Z-Wave command confirmation (Supervision CC)

**(a) How it solves the problem.** Z-Wave Supervision CC (mandatory for S2-encapsulated devices) wraps Set/Report commands with a Supervision Get → Supervision Report exchange. The Report carries a status enum:

| Enumerator (Silicon Labs) | Meaning |
|---|---|
| `CC_SUPERVISION_STATUS_NOT_SUPPORTED` | Command class/command not supported by target |
| `CC_SUPERVISION_STATUS_WORKING` | Operation in progress; final status will follow |
| `CC_SUPERVISION_STATUS_FAIL` | Operation failed |
| `CC_SUPERVISION_STATUS_CANCEL` | Application will report from elsewhere |
| `CC_SUPERVISION_STATUS_NOT_FOUND` | Handler missing |
| `CC_SUPERVISION_STATUS_SUCCESS` (`0xFF`) | Operation completed successfully |

The Report also carries a `duration` field: 0x00 = "already at target," 0x01–0x7F = 1–127 seconds (1 s resolution), 0x80–0xFD = 1–126 minutes (1 min resolution), 0xFE = unknown duration.

**(b) Direct quotation.**
> "CC Supervision is built into the Application Framework and handles Supervision communication on S2 encapsulated frames. Supervision is only supported for Set and Report commands… Device has the possibility to inform destination node that there is an operation in progress. Example is Wall controller with a display showing that a device is working (CC_SUPERVISION_STATUS_WORKING) until target value is reached (CC_SUPERVISION_STATUS_SUCCESS)."
> — `docs.silabs.com/z-wave/latest/zwave-api/supervision`

> "The use of Supervision command class ensures delivery and execution of any Z-Wave command and should be used with any critical function of any device."
> — `drzwave.blog/2020/11/02/best-practices-for-z-wave-door-locks/`

**(c) Pain points.** Supervision adds round-trip latency. Battery devices use a 500 ms retry timeout per the DrZwave door-lock article. The state machine `WORKING → (SUCCESS | FAIL)` is more complex than Matter's binary success/fail.

**(d) Lesson for HomeSynapse.** The Pending Command Ledger should model exactly this state machine: `PENDING → WORKING → (SUCCESS | FAIL | TIMEOUT)`. Z-Wave's `duration` field maps directly to an `expectedCompletionAt: Instant` field on the Ledger entry.

### 2.9 Academic: ECA (Event-Condition-Action) rule systems

**(a) How it solves the problem.** ECA rule systems originated in active databases (HiPAC, Starburst, Postgres) in the late 1980s. Key concepts: primitive vs composite events, immediate vs deferred coupling modes, termination/confluence analysis. A rule's *event* part specifies the triggering signal; *condition* is the logical test; *action* is the update or side effect.

**(b) Direct quotations.**
> "Active database systems have been developed for applications needing an automatic reaction in response to certain conditions being satisfied or certain event occurring. The desired behavior is expressed by ECA-rules (event-condition-action rules)."
> — `link.springer.com/chapter/10.1007/3-540-46016-0_51`

> "Event-condition-action (ECA) rules can specify decision processes and are widely used in reactive systems and active database systems. Applying formal verification techniques to guarantee properties of the designed ECA rules is essential to help the error-prone procedure of collecting and translating expert knowledge. However, while the nondeterministic and concurrent semantics of ECA rule execution enhances expressiveness, it also makes analysis and verification more difficult."
> — Symbolic Termination and Confluence Checking for ECA Rules (`researchgate.net/publication/220887627`)

**(c) Key formal results.** Termination is undecidable in general; trigger-graph analysis can prove termination for restricted rule classes. Confluence (order-independence of action results) is even harder. Composite event detection (sequence, conjunction, A-then-B-within-T) requires explicit event algebras (Snoop, SAMOS).

**(d) Lesson for HomeSynapse.** AMD-04's cascade-depth bound is a practical decision-procedure substitute for termination analysis (which is undecidable). Composite event triggers (HA does not have them; Snoop does) are a future-work item beyond M7/M8. The literature validates that depth-limiting is the *only* tractable runtime-tier strategy.

---

## 3. Cross-Cutting Analysis

### 3.1 Concept Mapping Table

| HomeSynapse concept | Home Assistant | openHAB | Node-RED | HomeKit | Google Home | Matter |
|---|---|---|---|---|---|---|
| Automation | Automation | Rule | Flow | Automation | Routine | n/a |
| TriggerDefinition | Trigger (platform) | Trigger module | inject/event-in nodes | Trigger | Starter | n/a |
| ConditionDefinition | Condition | Condition module | switch/change nodes | Condition | Condition | n/a |
| ActionDefinition | Action / service call | Action module | function/output nodes | Action | Action | Invoke command |
| Selector | entity_id / area_id / device_id / label_id / target | Item / Group / Tag | wire endpoints | Accessory | Device | Endpoint+Cluster path |
| Scene (proposed: drop) | Scene | Scene | n/a | Scene | n/a | Scenes Management cluster |
| Script (reusable) | Script | Script (DSL) | Subflow | Shortcut | n/a | n/a |
| Run | trace | rule execution | message flight | n/a | n/a | Transaction |
| RunStatus.INTERRUPTED | mode: restart kill / single warning | n/a | reset signal | n/a | n/a | n/a |
| Pending Command Ledger | (none; optimistic) | (none) | msg.reset | (none) | (none) | Timed Invoke + InvokeResponse |
| Cascade depth limit | (none) | (none) | (none) | (none) | (none) | (none) — HomeSynapse-unique |
| SemanticTag selector | label_id (HA 2024.4+) | Item Tag | n/a | (none) | (none) | n/a |
| EntityCategory filter | entity_category (cloud/voice excluded) | (none) | n/a | (none, but HomeKit auto-excludes) | (none) | n/a |
| DeviceReachableChanged trigger | state trigger on `unavailable` (workaround) | Thing status changed | n/a | (none) | (none) | Subscribe |
| Positional snapshot conditions | (no; race exists) | (no) | (no) | (no) | (no) | (no) |

### 3.2 Gap Analysis (ranked by impact)

1. **Webhook trigger** (HA, openHAB-via-HTTP-binding) — required for any IFTTT-style external integration, push from mobile apps, third-party services. **HIGH IMPACT.**
2. **Calendar trigger** (HA, Google Home) — recurring CalDAV/Google Calendar events ("school day," "garbage night"). Trigger-on-event-start/end with offset. **HIGH IMPACT.**
3. **Zone / geo_location trigger** (HA, Google Home presence) — location-based automations are first-class in every consumer ecosystem. **MEDIUM IMPACT** (deferrable if HomeSynapse explicitly scopes out mobile presence in M7).
4. **Repeat / loop action with `maxIterations` guard** (HA `repeat:`, openHAB `while`) — needed for "blink 3 times" patterns. AMD-31 sequences are *fixed*; iteration is missing. **MEDIUM IMPACT.**
5. **Stable user-assigned Trigger IDs** (HA `id:`) — already implicit in HomeSynapse's positional model, but lack of stable IDs means automations referring to "the third trigger" break on edit. **LOW-MEDIUM IMPACT.**
6. **Automation labels as automation organization** (HA labels for grouping, not just selectors) — bulk-enable/disable, REST filter. **LOW IMPACT** (covered by REC-26 SemanticTag if extended to the Automation entity).

### 3.3 Over-Abstraction Analysis

- **Cascade depth limit (AMD-04).** *Defense:* validated by ECA termination undecidability — every other platform has documented infinite-loop incidents (e.g. HA issue `#115042`). **RETAIN.**
- **Positional state snapshots (AMD-03).** *Defense:* HA explicitly documents the race this solves; no other platform offers a clean answer. **RETAIN.**
- **Pending Command Ledger.** *Partial retraction:* over-engineered as *mandatory*; appropriate as *opt-in* per action. HA's optimistic mode documents that the dominant pattern does not need confirmation. **DOWNGRADE TO OPT-IN (REC-33).**
- **7-value `RunStatus` including INTERRUPTED.** *Defense:* INTERRUPTED maps to HA mode-restart kill semantics; needed for trace honesty. **RETAIN.**
- **ULID-ascending dispatch ordering within a Run (AMD-31).** *Defense:* openHAB explicitly documents sequential output-of-previous-as-input-of-next — same model. **RETAIN.**

### 3.4 Competitive Assessment

HomeSynapse is genuinely differentiated in three areas:

- **Positional snapshot condition evaluation.** *Claim:* uniquely correct against the state-race that Home Assistant officially documents. *Qualifier:* HomeKit and others avoid the race accidentally through narrower trigger surfaces; HA addresses it via user-side `trigger.from_state` / `trigger.to_state` access (workaround, not solution).
- **Cascade depth governance.** *Claim:* first open-source home-automation runtime to model cascade depth as a Run property. *Qualifier:* ECA literature has trigger-graph analysis but no runtime in this space implements it; this is a Pareto-improvement, not a research breakthrough.
- **Event-sourced persistence with ULID identity (LTD-04) for automation runs.** *Claim:* uniquely auditable and replayable. *Qualifier:* HA traces are in-memory + JSON-on-shutdown (vulnerable to double-restart loss per issue `#70310`); openHAB logs to text. HomeSynapse's projection-advancer pattern lets automation runs be replayed deterministically — neither HA nor openHAB can do this.

---

## 4. Amendment Recommendations

Each REC scored by Impact × Confidence / Cost; ranked descending.

### REC-31 — Expand `TriggerDefinition` from 8 to 11 permits
- **Gap:** §3.2 #1, #2, #3 — Webhook, Calendar, Zone triggers.
- **Lesson source:** Home Assistant Automation Triggers docs (`home-assistant.io/docs/automation/trigger/`); Google Home starters (`support.google.com/assistant/answer/7672035`).
- **Change:** Three new public permits added to `com.homesynapse.automation.TriggerDefinition`:
  - `WebhookTrigger(String webhookId, Set<HttpMethod> allowedMethods, boolean localOnly)`
  - `CalendarTrigger(EntityId calendarEntityId, CalendarEventTransition transition, Duration offset)`
  - `ZoneTrigger(EntityId personOrTrackerId, ZoneId zoneId, ZoneTransition transition)`
- **Backward compat:** Additive. Sealed-exhaustiveness consumers must add cases (compile-time enforcement).
- **Module/package:** `core/automation`, `com.homesynapse.automation`, public.
- **AMD required:** Yes (AMD-32; recommend three sub-records).
- **LoC estimate:** 320 (3 records × ~30 + 3 evaluators × ~60 + tests ~50).

### REC-32 — `ReachabilityTrigger` permit
- **Gap:** REC-25 introduced `device.reachable_changed` event but no trigger consumes it.
- **Lesson source:** Home Assistant community workaround pattern (state-trigger on `unavailable`).
- **Change:** Public permit `ReachabilityTrigger(DeviceId deviceId, ReachabilityTransition transition, Duration debounce)` with default debounce 30 s. Brings permit count to 12.
- **Backward compat:** Additive.
- **Module/package:** `com.homesynapse.automation`, public.
- **AMD required:** Yes (AMD-35).
- **LoC estimate:** 90.

### REC-33 — Opt-in command confirmation via `ActionDefinition.confirmation`
- **Gap:** §3.3 — Pending Command Ledger over-engineered as mandatory.
- **Lesson source:** Home Assistant optimistic mode (`home-assistant.io/integrations/switch.mqtt/`); Z-Wave Supervision CC (`docs.silabs.com/z-wave/latest/zwave-api/supervision`); Matter Timed Invoke (Matter Core spec §8).
- **Change:** Add `ConfirmationPolicy { OPTIMISTIC, REQUIRED, BEST_EFFORT }` enum and a `confirmation` field (default `OPTIMISTIC`) to every existing `ActionDefinition` permit.
  - `OPTIMISTIC`: action_dispatched → action_completed (no Ledger entry).
  - `REQUIRED`: action_dispatched → PendingCommand → (action_confirmed | action_failed | action_timed_out); Ledger entry mandatory.
  - `BEST_EFFORT`: REQUIRED if transport supports it (Z-Wave Supervision, Matter Timed Invoke), else OPTIMISTIC.
- **Backward compat:** Default `OPTIMISTIC` preserves current semantics.
- **Module/package:** `com.homesynapse.automation`, public.
- **AMD required:** Yes (AMD-36).
- **LoC estimate:** 180.

### REC-34 — `SemanticTagSelector` with namespace filtering
- **Gap:** §3.1 — Selector lacks tag-based filtering.
- **Lesson source:** Home Assistant 2024.4 release blog (`home-assistant.io/blog/2024/04/03/release-20244/`): *"Just like with floors, you can use labels in your automations and scripts as a target for your actions."*
- **Change:** Public permit `SemanticTagSelector(String namespace, String value, MatchMode matchMode, Set<EntityCategory> includedCategories)` with `MatchMode { EXACT, NAMESPACE_PREFIX }`.
- **Backward compat:** Additive.
- **Module/package:** `com.homesynapse.automation`, public.
- **AMD required:** Yes (AMD-37).
- **LoC estimate:** 140.

### REC-35 — `EntityCategoryFilter` default exclusion on selectors
- **Gap:** DIAGNOSTIC entities pollute automation triggers.
- **Lesson source:** Home Assistant 2021.11 release blog (`home-assistant.io/blog/2021/11/03/release-202111/`) — DIAGNOSTIC/CONFIG entities excluded from voice assistants; HomeKit follows same pattern since 2022.2.
- **Change:** Add non-null `Set<EntityCategory> includedCategories` (default `Set.of(EntityCategory.PRIMARY)`) to entity-targeting Selector permits. Trigger evaluator skips silently if target entity's category not in set.
- **Backward compat:** Migration step required — existing serialized selectors must be re-read with `{PRIMARY, CONFIG, DIAGNOSTIC}` to preserve old behavior.
- **Module/package:** `com.homesynapse.automation` (field on Selector permits); `EntityCategory` is in `com.homesynapse.device` per REC-23.
- **AMD required:** Yes (AMD-38).
- **LoC estimate:** 110.

### REC-36 — Reformulate AMD-04 cascade depth as per-Run causal chain
- **Gap:** §1, §3.3 — cross-automation cascade is the dominant infinite-loop class.
- **Lesson source:** HA community infinite-loop threads; ECA termination literature.
- **Change:** Replace AMD-04 depth counter with a `RunCausalChain(List<RunId> ancestors, int depth)` record carried on `Run`. `MAX_DEPTH = 8`. Exceeding emits `automation.cascade_limit_exceeded` event and sets `RunStatus.INTERRUPTED`.
- **Backward compat:** Existing Run consumers must handle the new field (nullable for legacy traces).
- **Module/package:** `com.homesynapse.automation`, public.
- **AMD required:** Yes (AMD-39; supersedes AMD-04).
- **LoC estimate:** 240.

### REC-37 — `ManualTrigger` permit; reject separate Scene primitive
- **Gap:** §3.2 — Scene primitive over-engineering.
- **Lesson source:** HomeKit defines a scene as "a state for one or more devices" (`homekit.blog/creating-automations-and-scenes-with-apple-homekit-a-step-by-step-guide/`); Home Assistant Scene-since-2022.2 unified state model.
- **Change:** Add public permit `ManualTrigger(Optional<String> invocationContext)`. An automation with only `ManualTrigger` is what other platforms call a "scene" — invokable via `POST /automations/{id}/invoke`, voice assistant, UI button. Brings permit count to 13.
- **Backward compat:** Additive.
- **Module/package:** `com.homesynapse.automation`, public.
- **AMD required:** Yes (AMD-40).
- **LoC estimate:** 70.

### REC-38 — Trigger ID field on all `TriggerDefinition` permits
- **Gap:** §3.2 #5 — stable user-assigned IDs.
- **Lesson source:** HA Trigger ID feature (`smarthomepursuits.com/how-to-use-trigger-ids-in-home-assistant`).
- **Change:** Add `String triggerId` (defaults to load-time ULID if user-unset) to every `TriggerDefinition` permit. Add `TriggerIdCondition(String expectedId)` permit to `ConditionDefinition`.
- **Backward compat:** Defaultable in deserialization.
- **Module/package:** `com.homesynapse.automation`, public.
- **AMD required:** Yes (AMD-41).
- **LoC estimate:** 130.

### REC-39 — Automation event schema in `com.homesynapse.event.automation`
- **Gap:** Complete event-type enumeration missing.
- **Lesson source:** REC-28 DispatchingProjectionAdvancer requires explicit per-event handlers.
- **Change:** Define 11 automation event types in new sub-package `com.homesynapse.event.automation`. See §7.3.
- **Backward compat:** New package; no existing consumers.
- **Module/package:** `core/event`, package `com.homesynapse.event.automation` (exported via `module-info.java`).
- **AMD required:** Yes (AMD-42).
- **LoC estimate:** 350.

### REC-40 — `RepeatAction` permit with `maxIterations`
- **Gap:** §3.2 #4 — iteration missing.
- **Lesson source:** HA `repeat:` action (`home-assistant.io/docs/scripts/`); failure mode documented in HA issue `#115042` (infinite-loop freeze).
- **Change:** Add public permit `RepeatAction(List<ActionDefinition> sequence, RepeatMode mode, int maxIterations, ...)` with `RepeatMode { COUNT, WHILE, UNTIL, FOR_EACH }`. Default `maxIterations = 100`.
- **Backward compat:** Additive.
- **Module/package:** `com.homesynapse.automation`, public.
- **AMD required:** Yes (AMD-43).
- **LoC estimate:** 200.

**Total LoC across RECs:** 1,830 — achievable in M7's automation budget with M8 reserved for hardening, blueprints, and trace persistence improvements.

---

## 5. Caveats and Open Questions

### Source reliability

- Home Assistant docs are canonical for HA *intent* but reflect documentation more than implementation; the source-of-truth is `github.com/home-assistant/core` (e.g. `homeassistant/helpers/trigger.py`). I rely on the docs because they are versioned and stable; the code churns weekly.
- Matter 1.4.2 Scenes Management Cluster *certifiability* (CSA announcement, August 11, 2025) is the published claim; the actual `SceneTableSize` minimum-per-fabric numeric requirement is in the gated CSA spec PDF and was not independently verified.
- openHAB's rule-engine docs span the 2.x → 3.x → 4.x evolution; `Member of` semantics changed silently between 3.0 and 3.1 (community-reported, not officially logged).
- Z-Wave Supervision docs from Silicon Labs are firmware-SDK-oriented; the Z-Wave Alliance protocol spec (SDS13783, SDS14224) is members-only. The status enum cited is the SDK-facing form, not the wire-format byte values.
- The Google Home "30 actions per Routine" limit is **not** a documented hard policy. A Google Nest Community moderator confirmed: *"you should be able to add more than 30 actions to your routine… we tried it on our test device, and it went up to 35 actions"* (`googlenestcommunity.com/t5/Home-Automation/Routines-now-limited-to-30-actions/m-p/462766`). Treat the figure as a soft/observational threshold.

### Unresolved tensions between platforms

- **Condition evaluation timing.** HA evaluates at trigger-fire time against current state. openHAB evaluates inside the action body (no clean separation). Node-RED evaluates per-message. HomeKit evaluates at trigger time. **None** evaluates at action-dispatch time. AMD-03's positional snapshot is unusual but correct. *Open question:* should snapshot timing be configurable per condition or globally per automation? **Recommendation:** global, default-on, opt-out at the `AutomationDefinition` record level.
- **Cascade governance** is uniformly absent everywhere except HomeSynapse. The depth threshold (proposed 8) is calibrated on the observation that real-world automations rarely exceed 3 cause-effect hops; 8 leaves headroom.
- **`for:` modifier survives restart in HomeSynapse?** HA explicitly says theirs does not. This is a HomeSynapse-specific commitment (LTD-11 ReentrantLock + event sourcing makes it tractable) but the implementation effort is non-trivial; AMD-25 should document the promise even if M7 implementation is partial.
- **DEVICE-level vs ENTITY-level reachability.** REC-25 puts reachability at the DEVICE level. `ReachabilityTrigger` (REC-32) therefore takes a `DeviceId`. But Entities have nullable `deviceId` (per the device-model field list). *Open question:* should the evaluator return false-negatives if `EntityId.deviceId` is null? **Recommendation:** warn at automation-load time if any `ReachabilityTrigger` targets an entity-derived device that may have null `deviceId`.

### Questions requiring empirical validation

- Real-world frequency of automations needing REQUIRED confirmation. Estimate: 5–10% (locks, garage doors, alarm arming). Should be validated against actual user data once M7 ships.
- The 100-iteration default for `RepeatAction.maxIterations` is a guess; HA's `repeat: while:` has no hard limit and users have hit infinite loops (HA issue `#115042`). Telemetry once M7 lands should reveal whether 100 is too tight.
- `MAX_DEPTH = 8` for cascade chains is a guess. Real-world cascade depth distribution is unknown.
- Whether `WebhookTrigger.localOnly` should default to `true` or `false`. HA defaults to `false` historically (a security concern). HomeSynapse should default to `true` — security posture demands it.

---

## 6. Appendix: Sources

### Home Assistant (`home-assistant.io`, `developers.home-assistant.io`, `github.com/home-assistant/core`)
- `home-assistant.io/docs/automation/basics/` — automation structure
- `home-assistant.io/docs/automation/trigger/` — complete trigger list + `for:` restart caveat
- `home-assistant.io/docs/automation/condition/` — condition evaluation timing (canonical race quote)
- `home-assistant.io/docs/automation/action/` — action execution
- `home-assistant.io/docs/automation/modes/` — single/restart/queued/parallel + `max_exceeded`; default max=10
- `home-assistant.io/docs/automation/yaml/` — YAML persistence + `stored_traces`
- `home-assistant.io/docs/automation/troubleshooting/` — trace lifecycle
- `home-assistant.io/docs/scripts/` — `repeat:` / `while:` / `until:`
- `home-assistant.io/docs/organizing/labels/` — label-as-target
- `home-assistant.io/template-functions/label_entities/` — `label_entities()` template function
- `home-assistant.io/integrations/switch.mqtt/` — optimistic mode (fire-and-forget canonical quote)
- `home-assistant.io/blog/2021/11/03/release-202111/` — EntityCategory introduction
- `home-assistant.io/blog/2022/02/02/release-20222/` — HomeKit auto-exclusion of DIAGNOSTIC
- `home-assistant.io/blog/2024/04/03/release-20244/` — labels as action targets (verbatim quote: "Just like with floors, you can use labels in your automations and scripts as a target for your actions")
- `developers.home-assistant.io/docs/core/integration-quality-scale/rules/entity-category/` — EntityCategory rationale
- `github.com/home-assistant/core/issues/115042` — infinite-loop freeze
- `github.com/home-assistant/core/issues/70310` — trace persistence bug

### openHAB (`openhab.org`, `openhab.github.io`)
- `openhab.org/docs/concepts/rules` — primary rules concept (trigger/condition/action quote)
- `openhab.org/docs/configuration/rules-ng.html` — Next-Gen Rule Engine
- `openhab.github.io/openhab-js/triggers.html` — JS trigger catalog
- `openhab-scripters.github.io/openhab-helper-libraries/Guides/Rules.html` — ModuleType architecture
- `github.com/openhab/openhab-docs/blob/main/configuration/rules-ng.md` — `moduleCategory` REST surface

### Node-RED (`nodered.org`, `flowfuse.com`, `cookbook.nodered.org`)
- `flowfuse.com/node-red/core-nodes/delay/` — Delay node rate limiting
- `cookbook.nodered.org/basic/rate-limit-messages` — official cookbook
- `flows.nodered.org/flow/9410e4cebcc4b68fae73` — community rate-limiter
- `discourse.nodered.org/t/rate-detection-can-it-be-done-easily/24188` — rate-detection community thread

### HomeKit (`homekit.blog`, third-party analyses)
- `homekit.blog/creating-automations-and-scenes-with-apple-homekit-a-step-by-step-guide/` — five trigger types
- `greening.me.uk/2020/09/19/automations-in-homekit/` — semantic analysis incl. missed-trigger watchdog
- `automatedhome.com/unlock-homekits-full-potential-with-this/` — third-party Hub Mode extensions
- `homedevices.app/creating-complex-homekit-automations-step-by-step/` — Controller-for-HomeKit walkthrough

### Google Home (`support.google.com`, `developers.home.google.com`)
- `support.google.com/assistant/answer/7672035` — starter list, limitations
- `developers.home.google.com/automations/starters-conditions-and-actions` — script-editor surface
- `googlenestcommunity.com/t5/Home-Automation/Routines-now-limited-to-30-actions/m-p/462766` — community + moderator on action limit

### Zigbee2MQTT (`zigbee2mqtt.io`, `github.com/Koenkk`, `github.com/Luligu`, `github.com/Anonym-tsk`)
- `github.com/Koenkk/zigbee2mqtt/issues/903` — original rules-without-MQTT discussion
- `github.com/Luligu/zigbee2mqtt-automations` — Luligu extension
- `github.com/Anonym-tsk/zigbee2mqtt-extensions` — Anonym-tsk extension
- `github.com/Koenkk/zigbee2mqtt/discussions/20078` — latency rationale
- `zigbee2mqtt.io/guide/usage/integrations.html` — integration overview

### Matter (`csa-iot.org`, `docs.silabs.com`, `handbook.buildwithmatter.com`, `developer.nordicsemi.com`)
- `csa-iot.org/wp-content/uploads/2022/11/22-27350-001_Matter-1.0-Application-Cluster-Specification.pdf` — Scenes 1.0 spec
- `csa-iot.org/newsroom/matter-1-4-2-enhancing-security-and-scalability-for-smart-homes/` — Scenes certifiability (Aug 11, 2025 announcement)
- `docs.silabs.com/matter/latest/matter-application-development/matter-scenes-quick-start-guide` — Scenes Management cluster
- `docs.silabs.com/matter/latest/matter-fundamentals-interaction-model/` — Interaction Model + Timed Invoke
- `handbook.buildwithmatter.com/howitworks/interactionmodel/` — Timed Invoke security rationale
- `developer.nordicsemi.com/nRF_Connect_SDK/doc/latest/nrf/protocols/matter/overview/int_model.html` — Nordic reference

### Z-Wave (`docs.silabs.com`, `drzwave.blog`)
- `docs.silabs.com/z-wave/latest/zwave-api/supervision` — Supervision CC status enum, duration field
- `drzwave.blog/2020/11/02/best-practices-for-z-wave-door-locks/` — Supervision usage best practices
- `docs.silabs.com/z-wave/latest/zwave-api/md-content-how-to-implement-a-new-command-class` — implementer's guide

### ECA / Academic
- `en.wikipedia.org/wiki/Event_condition_action` — overview
- `link.springer.com/chapter/10.1007/3-540-46016-0_51` — Structural Model of ECA Rules in Active Database
- `sciencedirect.com/science/article/abs/pii/S0950705199000283` — Chakravarthy et al., Implementing ECA rules
- `researchgate.net/publication/220887627` — Symbolic Termination & Confluence Checking for ECA Rules
- `link.springer.com/chapter/10.1007/3-540-36560-5_15` — Enhancing ECA Rules for Distributed Active Database Systems
- `scitepress.org/Papers/2009/19874/19874.pdf` — Flexible ECA rule processing

---

## 7. HomeSynapse Code-Level Implications

### 7.1 Updated `TriggerDefinition` sealed hierarchy

**Module:** `core/automation`
**Package:** `com.homesynapse.automation`
**Visibility:** public sealed interface

```java
public sealed interface TriggerDefinition
    permits StateChangeTrigger,          // existing #1
            NumericThresholdTrigger,     // existing #2
            TimeTrigger,                 // existing #3
            TimePatternTrigger,          // existing #4
            EventTrigger,                // existing #5
            SunTrigger,                  // existing #6
            TemplateTrigger,             // existing #7
            DeviceActionTrigger,         // existing #8
            WebhookTrigger,              // REC-31 (NEW, public)
            CalendarTrigger,             // REC-31 (NEW, public)
            ZoneTrigger,                 // REC-31 (NEW, public)
            ReachabilityTrigger,         // REC-32 (NEW, public)
            ManualTrigger {              // REC-37 (NEW, public)

    String triggerId();                       // REC-38 — defaults to ULID
    Optional<Duration> sustainedFor();        // AMD-25 — null = fire on edge
}
```

Permit count: **13** (was 8). All new permits are public records. Sealed-exhaustiveness consumers must add cases — desired property for compile-time enforcement.

```java
public record WebhookTrigger(
    String triggerId,
    Optional<Duration> sustainedFor,            // always Optional.empty()
    String webhookId,
    Set<HttpMethod> allowedMethods,             // default Set.of(POST, PUT)
    boolean localOnly                            // default true (security)
) implements TriggerDefinition { … }

public record CalendarTrigger(
    String triggerId,
    Optional<Duration> sustainedFor,
    EntityId calendarEntityId,
    CalendarEventTransition transition,          // START | END
    Duration offset                              // negative = before
) implements TriggerDefinition { … }

public record ZoneTrigger(
    String triggerId,
    Optional<Duration> sustainedFor,
    EntityId personOrTrackerId,
    ZoneId zoneId,
    ZoneTransition transition                    // ENTER | LEAVE | DWELL
) implements TriggerDefinition { … }

public record ReachabilityTrigger(
    String triggerId,
    Optional<Duration> sustainedFor,             // honored — debounce window
    DeviceId deviceId,
    ReachabilityTransition transition            // REACHABLE_TO_UNREACHABLE | UNREACHABLE_TO_REACHABLE | ANY
) implements TriggerDefinition { … }

public record ManualTrigger(
    String triggerId,
    Optional<Duration> sustainedFor,             // always Optional.empty()
    Optional<String> invocationContextSpec       // optional UI / voice hint
) implements TriggerDefinition { … }
```

### 7.2 Updated `Selector` sealed hierarchy

**Module:** `core/automation`
**Package:** `com.homesynapse.automation`
**Visibility:** public

```java
public sealed interface Selector
    permits EntityIdSelector,         // existing — gains includedCategories
            AreaSelector,             // existing — gains includedCategories
            DeviceIdSelector,         // existing
            CapabilitySelector,       // existing
            SemanticTagSelector,      // REC-34 (NEW, public)
            CompositeSelector { }     // existing

public record SemanticTagSelector(
    String namespace,                            // e.g. "matter.device.light" or "hs.user"
    String value,                                // e.g. "evening"
    MatchMode matchMode,                         // EXACT | NAMESPACE_PREFIX
    Set<EntityCategory> includedCategories       // REC-35; default Set.of(PRIMARY)
) implements Selector { … }
```

`EntityIdSelector` and `AreaSelector` each gain a non-null `Set<EntityCategory> includedCategories` field (default `Set.of(EntityCategory.PRIMARY)`). This is a **breaking record-canonical-constructor change** — REC-35 migration step required.

### 7.3 Automation event schemas — `com.homesynapse.event.automation`

**Module:** `core/event` (JPMS module name `com.homesynapse.event`)
**Package:** `com.homesynapse.event.automation` (NEW — must be added to `exports` in `module-info.java`)
**Visibility:** all records public

Complete enumeration of **11** automation event types:

| # | Event record (dot-namespaced) | Schema | State-changing? | ProjectionEventHandler |
|---|---|---|---|---|
| 1 | `automation.created` | `AutomationCreated(AutomationId id, ULID ulid, String slug, String displayName, List<TriggerDefinition> triggers, List<ConditionDefinition> conditions, List<ActionDefinition> actions, Instant at, String authorContext)` | **YES** | Required |
| 2 | `automation.updated` | `AutomationUpdated(AutomationId id, ULID ulid, AutomationDefinition newDefinition, AutomationDefinition oldDefinition, Instant at, String authorContext)` | **YES** | Required |
| 3 | `automation.disabled` | `AutomationDisabled(AutomationId id, ULID ulid, Instant at, String reason)` | **YES** | Required |
| 4 | `automation.enabled` | `AutomationEnabled(AutomationId id, ULID ulid, Instant at)` | **YES** | Required |
| 5 | `automation.deleted` | `AutomationDeleted(AutomationId id, ULID ulid, Instant at, String authorContext)` | **YES** | Required |
| 6 | `automation.run_started` | `AutomationRunStarted(RunId runId, AutomationId automationId, ULID ulid, TriggerOccurrence triggerOccurrence, RunCausalChain causalChain, Instant at)` | NO | None — observability |
| 7 | `automation.run_completed` | `AutomationRunCompleted(RunId runId, RunStatus status, Instant startedAt, Instant completedAt)` | NO | None — observability |
| 8 | `automation.condition_evaluated` | `AutomationConditionEvaluated(RunId runId, int conditionIdx, boolean result, Map<EntityId,AttributeValue> snapshotUsed, Instant at)` | NO | None — observability |
| 9 | `automation.action_dispatched` | `AutomationActionDispatched(RunId runId, int actionIdx, ActionDefinition action, ULID dispatchUlid, ConfirmationPolicy policy, Instant at)` | Conditionally (REQUIRED ⇒ creates PendingCommand) | Pending Command Ledger projection only |
| 10 | `automation.action_confirmed` | `AutomationActionConfirmed(RunId runId, int actionIdx, ULID dispatchUlid, ConfirmationStatus status, Optional<Duration> reportedDuration, Instant at)` | Closes Ledger entry | Pending Command Ledger projection only |
| 11 | `automation.cascade_limit_exceeded` | `AutomationCascadeLimitExceeded(RunId runId, AutomationId automationId, RunCausalChain chain, int maxDepth, Instant at)` | NO | None — observability + alerting |

**State-changing events (#1–#5)** require `ProjectionEventHandler<E>` implementations registered with `DispatchingProjectionAdvancer` (REC-28) via **constructor injection — no ServiceLoader (DECIDE-04)**.

Legacy event naming (`entity_registered` style) is preserved for entity-model events; new automation events use dot-namespaced (`automation.run_started`).

### 7.4 Updated `ActionDefinition` sealed hierarchy

**Module:** `core/automation`
**Package:** `com.homesynapse.automation`
**Visibility:** public

```java
public sealed interface ActionDefinition
    permits AttributeSetAction,         // existing
            CapabilityInvokeAction,     // existing
            DelayAction,                // existing
            ConditionalAction,          // existing (choose/if)
            ParallelAction,             // existing
            RepeatAction,               // REC-40 (NEW, public)
            CallAutomationAction,       // existing
            NotificationAction {        // existing
    ConfirmationPolicy confirmation();  // REC-33 — added to every permit
}

public enum ConfirmationPolicy { OPTIMISTIC, REQUIRED, BEST_EFFORT }

public record RepeatAction(
    ConfirmationPolicy confirmation,
    List<ActionDefinition> sequence,
    RepeatMode mode,                                  // COUNT | WHILE | UNTIL | FOR_EACH
    int maxIterations,                                // default 100
    Optional<Integer> countN,
    Optional<ConditionDefinition> whileCondition,
    Optional<ConditionDefinition> untilCondition,
    Optional<Selector> forEachSelector
) implements ActionDefinition { … }
```

### 7.5 Updated `Run` record and `RunCausalChain`

**Module:** `core/automation`
**Package:** `com.homesynapse.automation`
**Visibility:** public

```java
public record RunCausalChain(
    List<RunId> ancestors,
    int depth
) {
    public static final int MAX_DEPTH = 8;
    public RunCausalChain extend(RunId childRun) { … }
}

public record Run(
    RunId id,
    AutomationId automationId,
    TriggerOccurrence triggerOccurrence,
    RunStatus status,                  // 7 values: PENDING, RUNNING, COMPLETED, FAILED,
                                        //          CANCELLED, INTERRUPTED, TIMED_OUT
    RunCausalChain causalChain,        // REC-36 — nullable for legacy traces
    Instant startedAt,
    Optional<Instant> completedAt
) { … }
```

### 7.6 `module-info.java` impact

**Module `com.homesynapse.event`** (`core/event`):
```java
module com.homesynapse.event {
    // … existing exports …
    exports com.homesynapse.event.automation;          // NEW (REC-39)
}
```

**Module `com.homesynapse.automation`** (`core/automation`):
```java
module com.homesynapse.automation {
    requires com.homesynapse.event;
    requires com.homesynapse.device;
    requires com.homesynapse.state;
    requires com.homesynapse.persistence;

    exports com.homesynapse.automation;
    exports com.homesynapse.automation.dispatch;        // existing
    exports com.homesynapse.automation.evaluator;       // existing
    // No 'uses' clauses — DECIDE-04 forbids ServiceLoader.
}
```

### 7.7 MODULE_CONTEXT impact

`MODULE_CONTEXT` for `com.homesynapse.automation` gains:
- `Clock clock` field — DEC-M3-09 injection, reused for AMD-25 temporal triggers (already present).
- `PendingCommandLedger ledger` field — REC-33; conditionally constructed. If no loaded `ActionDefinition` uses `REQUIRED`, the ledger is a no-op implementation.
- `Map<Class<? extends DomainEvent>, ProjectionEventHandler<?>> handlers` constructor argument (REC-28) populated with handlers for `AutomationCreated`, `AutomationUpdated`, `AutomationDisabled`, `AutomationEnabled`, `AutomationDeleted` — five handlers minimum (REC-39).

### 7.8 Migration considerations

1. **REC-31 / REC-32 / REC-37 / REC-38 — new TriggerDefinition permits.** Every `switch (TriggerDefinition t) { … }` site must add cases for the five new permits. Java's exhaustiveness checker will fail the build until done — desired property.
2. **REC-35 — EntityCategory default exclusion.** One-time migration of pre-existing serialized selectors: scan persisted automations, populate `includedCategories = Set.of(PRIMARY, CONFIG, DIAGNOSTIC)` to preserve current behavior. The 2026.07 release should flip the default for *new* selectors to `Set.of(PRIMARY)`. Old automations remain on old behavior unless user opts in.
3. **REC-36 — `RunCausalChain`.** Existing Run records in the event store predate `causalChain`; deserializer must accept a null/missing field and synthesize `new RunCausalChain(List.of(), 0)`.
4. **REC-39 — automation event package.** No backward-compat issue (new events). Projection consumers must add handlers for the five state-changing events, or accept a no-op default.
5. **REC-40 — `RepeatAction`.** Additive; existing action lists remain valid.

### 7.9 Total LoC estimate

| REC | LoC |
|---|---|
| REC-31 | 320 |
| REC-32 | 90 |
| REC-33 | 180 |
| REC-34 | 140 |
| REC-35 | 110 |
| REC-36 | 240 |
| REC-37 | 70 |
| REC-38 | 130 |
| REC-39 | 350 |
| REC-40 | 200 |
| **Total** | **1,830 LoC** |

M7 has a ~3,500-LoC automation budget; this work fits with margin. M8 is reserved for hardening, blueprint/template support, and trace persistence improvements not covered here.

---

*End of Research 4: Automation Engine Architecture.*