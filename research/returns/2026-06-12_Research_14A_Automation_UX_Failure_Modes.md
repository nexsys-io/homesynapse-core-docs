# Research 14-A: Automation Authoring & Operating UX — Failure Modes
*Target: HomeSynapse M7/M8 charter + M7 AMD block + M5-C. Date: 2026-06-12.*

## 0. Quote-back gate

**§0.2 — module-info.java at 7c73c91 (verbatim):**
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

**§0.3.1 — inventory-summary line (verbatim):**
"**~53 public types in ONE FLAT package `com.homesynapse.automation`: 5 enums · 1 typed ULID wrapper (`RunId`) · 4 sealed hierarchies with 30 permits (Selector 6, all Tier 1 · TriggerDefinition 9 = 5 Tier 1 + 4 Tier 2 empty-reserved · ConditionDefinition 7 = 6 Tier 1 + 1 Tier 2 · ActionDefinition 8 = 5 Tier 1 + 3 Tier 2) · 4 data records (`AutomationDefinition` 12 fields, `RunContext` 8 fields, `PendingCommand` 8 fields, `DurationTimer` 8 fields) · 9 service interfaces.** *(Permit total re-derived from source 2026-06-12: 6+9+7+8 = 30.)*"

**§0.3.3 — decided-ground table (five rows, verbatim):**
| 1 | **DQ resolutions (Nick, 2026-05-30):** promote `PresenceTrigger` (no separate ZoneTrigger); rename `ActivateSceneAction` → `InvokeAutomationAction` + promote (scenes = automations-with-`ManualTrigger`); Pending-Command-Ledger projection handlers ride the existing advancer; zone/geofence evaluation = M8, not M7 | **DECIDED — not open questions** |
| 2 | **M7 trigger additions (Research 4, re-anchored 2026-06-12):** `CalendarTrigger`, `ReachabilityTrigger`, `ManualTrigger` new permits + `WebhookTrigger`/`PresenceTrigger` promotions → 9→12 permits; `RepeatAction` +1; `SemanticTagSelector` +1; trigger `id` field; `ConfirmationPolicy` opt-in | **ACCEPTED, pending the M7 AMD block** |
| 3 | **C8 `actorRef` (PROPOSED 2026-06-08):** automations stamp `actorRef = AutomationId` on every command/event they originate; bare `Ulid` envelope field unchanged; kind recoverable by typed-ID provenance | **PROPOSED — ratification on the W25 critical path** |
| 4 | **Automation definitions load through the shipped M6 config pipeline** (AMD-66 listener classification for reload, AMD-71 layout, fail-closed write posture for tag-bearing docs) | **SHIPPED substrate (M6.1/M6.2/M6.4)** |
| 5 | **The Pending Command Ledger is the reliability differentiator** — intent-confirmation (did the light ACTUALLY turn on?) is first-class, coalescing disabled, `Expectation`-evaluated confirmation | **LOCKED (Doc 07 §3.11.2)** |

---

## 1. Executive Summary

- **The single highest-impact finding: the "why didn't it fire?" debuggability problem is the universal failure mode, and HomeSynapse's §4.2 run-trace surface already captures the raw material to answer it — but only if M7 wires four specific trace details** (which trigger fired, per-condition eval result including `RunStatus.CONDITION_NOT_MET`, selector resolution to `Set<EntityId>`, and the dedup/drop reason). Every platform surveyed forces users into manual bisection; the frozen surface is the answer, but it must be instrumented, not merely defined.
- **The single strongest ledger-gap evidence item: no consumer platform offers first-class confirmation-of-intent, and Home Assistant's lead maintainer Franck Nijhof (frenck) declared command-retry/verification out of scope on 2022-10-01:** *"That is a library implementation, which is considered out of scope for HA. Such retries do not take place in HA, but in a level UP."* This is decisive validation that the Pending Command Ledger (§3.11.2, row 5) is an unserved market need, not a parity item — it belongs in the M5-C superiority material.
- **HomeSynapse's structural edge-vs-level split (StateChangeTrigger vs StateTrigger as distinct sealed permits) does NOT eliminate the trigger/condition mental-model confusion class — it relocates it** from "wrong YAML flag" to "wrong permit chosen at authoring." The win is real but conditional on authoring-time affordances; without them the confusion survives.
- **Forced-migration trust destruction is the most severe trust event in the survey (SmartThings Groovy→Edge/Lua, Hubitat Rule Machine version freezes), and HomeSynapse's forward-only idempotent migration (AMD-67) plus identity stability (§3.3) is the correct anti-requirement posture — but the M7 AMD block must state the automation-definition schema versioning posture explicitly**, or it inherits the gap.
- **Concurrency footguns users actually hit (restart-kills-my-delay, queued-fires-stale-at-3am, double-trigger storms) map cleanly onto ConcurrencyMode + maxConcurrent + MaxExceededSeverity; the SINGLE default + silent-drop is the right default shape but needs a drop DIAGNOSTIC so the drop is observable** — HA's `max_exceeded: silent` choice is exactly the footgun users complain about.
- **Trace retention is a sleeper failure: Home Assistant's default of 5 stored traces is the single most-cited debuggability complaint, and HomeSynapse must guarantee failed-run trace retention (within §4.2/§3.3) rather than a fixed ring buffer** — losing the trace of the one failed run is functionally equivalent to having no trace.
- **HomeSynapse should NOT add a Jinja2-equivalent templating DSL.** Templating is Home Assistant's single largest authoring failure class; the sealed-permit, typed-record design deliberately forecloses it, and re-introducing an expression language would import the exact failure mode the architecture avoids. This is an honest REJECT.

---

## 2. Platform Deep Dives

### 2.1 Home Assistant (deepest)

HA is the reference platform: YAML + a visual editor over the same schema, Jinja2 templating, automation `mode`, and a built-in per-run **trace** viewer.

**(a) How it solves/fails the RQ families.**
- *Authoring (RQ1):* Jinja2 templating is the canonical failure class. HA's own docs concede: *"Templates are fiddly, and even experienced people make the same mistakes over and over."* ([home-assistant.io/docs/templating/debugging](https://www.home-assistant.io/docs/templating/debugging/)). The trigger-vs-condition mental model is a documented, persistent confusion: HA docs say *"Conditions look very similar to triggers, but they are very different,"* and an open docs issue (#41835) records a user: *"I have trouble grasping how exactly to differentiate between checking state inside a trigger block vs checking it inside a condition block."* ([github.com/home-assistant/home-assistant.io/issues/41835](https://github.com/home-assistant/home-assistant.io/issues/41835)).
- *Debuggability (RQ2):* HA traces are the best-in-class run-trace surface — *"Every time an automation runs, Home Assistant records a step-by-step timeline of what was triggered, which conditions were checked, and what each action did"* ([troubleshooting docs](https://www.home-assistant.io/docs/automation/troubleshooting/)). Two structural gaps: (1) **"no traces = didn't trigger"** is an inference users must make manually, and (2) per the YAML docs, *"stored_traces integer (Optional, default: 5) — The number of traces which will be stored"* ([yaml docs](https://www.home-assistant.io/docs/automation/yaml/)).
- *Reliability (RQ3):* fire-and-forget; the maintainer position is explicit (below).
- *Migration (RQ4):* silent breakage on schema deprecation. The official 2026.6 release blog (2026-06-03) confirms the primary cause: *"The legacy template platform syntax under the individual platform keys has been removed. This syntax was deprecated in Home Assistant 2025.12 and has now reached the end of its 6-month deprecation period."* ([home-assistant.io/blog/2026/06/03/release-20266](https://www.home-assistant.io/blog/2026/06/03/release-20266/)). The user-visible effect — *"Your automations look enabled, your dashboard looks normal, but nothing triggers"* — is the silent-failure blast radius.
- *Concurrency (RQ5):* `single/restart/queued/parallel`. Per the modes docs: *"Configuration option max controls the maximum number of runs that can be executing and/or queued up at a time. The default is 10… Configuration option max_exceeded controls the severity level of that log message. Set it to silent to ignore warnings or set it to a log level. The default is warning."* ([modes docs](https://www.home-assistant.io/docs/automation/modes/)).

**(b) Primary-source quotations.**
- Maintainer on confirmation/retry being out of scope — Franck Nijhof (frenck), 2022-10-01: *"That is a library implementation, which is considered out of scope for HA. Such retries do not take place in HA, but in a level UP."* And on the double-actuation risk: *"we can't know the impact of calling things twice. Sure, for a light… but some random entity on a car that gets controlled… you could be toggling locks for example."* ([community.home-assistant.io/t/wth-doesnt-ha-retry-a-failed-service-call/467850](https://community.home-assistant.io/t/wth-doesnt-ha-retry-a-failed-service-call/467850)).
- Trace retention pain: *"WTH is there only 5 traces… It'd be great if we could set how many traces we can scroll back."* ([community 473716](https://community.home-assistant.io/t/wth-is-there-only-5-traces/473716)). Core issue #117133 shows the deeper problem: a time-delayed automation's real run gets evicted by empty runs — *"it just shows the last 5 minutes of traces where nothing happened."* ([github core #117133](https://github.com/home-assistant/core/issues/117133)).

**(c) What users DID (Mom-Test).**
- Built **verify-and-retry hacks**: *"I work around this by doing most of my automations in AppDaemon where I use a callback that read the device state and send back the order if the state was still not correct… up to 10 times."* ([WTH add a retry option](https://community.home-assistant.io/t/wth-add-a-retry-option-on-automation/810459), 2024-12-13). Others adopted the third-party `retry` HACS integration ([github.com/amitfin/retry](https://github.com/amitfin/retry)), which exposes an `expected_state` parameter — outcome verification, not just delivery.
- Built **watchdog automations** to re-enable silently-disabled automations ([andrewdoering.org watchdog](https://andrewdoering.org/blog/2025/home-assistant-automation-watchdog/)).
- On breaking changes, users **freeze versions**: *"We typically don't upgrade for months, as it is too time consuming to track changes and debug each update."* ([feature request #785719](https://community.home-assistant.io/t/display-breaking-changes-from-version-x-to-y-based-on-your-yaml-and-used-ha-features/785719)).

**(d) Gap-relative lesson.** HA validates that the **§4.2 run-trace model** is the right answer, and exposes the instrumentation HomeSynapse must guarantee: failed-run retention (a different clock from §3.3's 30-day definition retention), trigger attribution, and per-condition results. HA's fire-and-forget posture is the direct foil for the **§3.11.2 ledger**.

### 2.2 SmartThings (substantive)

**(a)** Cloud-first Routines (plus the retired Groovy SmartApp/webCoRE ecosystem). The Groovy→Edge/Lua transition is the canonical trust-destruction case.

**(b) Quotations.**
- The forced migration: *"the shutdown date for Groovy integrations [is] December 31, 2022… Devices that are no longer supported… will be migrated to a placeholder device driver called a 'Thing.'"* ([support.smartthings.com Platform Transition FAQ](https://support.smartthings.com/hc/en-us/articles/9339624925204-Platform-Transition-FAQ)).
- Partial-failure reporting (the closest thing to confirmation anywhere): *"I get the above error that it ran, but not everything worked correctly. The error message lists all the devices in the routine, rather than the one that didn't work."* ([Routine Actions Ran, but some of them Didn't Work Correctly](https://community.smartthings.com/t/routine-actions-ran-but-some-of-them-didnt-work-correctly/306320), 2025-11). Even Samsung's own developer-support rep could not explain what it reports.
- Reliability: *"simple routines work about half the time. I want my money back."* ([SmartThings Reliability](https://community.smartthings.com/t/smartthings-reliability/120517)).

**(c) What users DID.** webCoRE users were told to **abandon or migrate**: *"webCoRE is going away and it's not coming back… embrace the suck and rework your system or go to hubitat."* ([webCoRE is going away, please quit complaining](https://community.smartthings.com/t/webcore-is-going-away-please-quit-complaining/249279)). Many migrated to Hubitat or Home Assistant.

**(d) Gap-relative lesson.** SmartThings' partial-failure notice is **report-only, not verify-and-remediate** — it proves the ledger's confirmation (§3.11.2) and `Expectation`-evaluation is differentiated, not parity. The Groovy shutdown is the anti-requirement justifying HomeSynapse's forward-only **AMD-67** posture.

### 2.3 Node-RED (substantive)

**(a)** Visual flow editor with explicit **Debug nodes** the user must place; no automatic per-automation trace.

**(b) Quotation.** Debug nodes are manual instrumentation: *"By adding Debug nodes at key points in your flow, you gain visibility into what's being passed between nodes."* ([flowfuse.com/node-red/core-nodes/debug](https://flowfuse.com/node-red/core-nodes/debug/)). The "spaghetti" maintainability problem is widely felt: *"any NR flow that isn't the most simplistic one looks like a complete mess… it would make me delete NR right away."* ([Best practices to keep automations readable](https://community.home-assistant.io/t/best-practices-to-keep-automations-readable/413870)).

**(c) What users DID.** Users decompose into sub-flows (and hit performance regressions doing so) or **migrate complex logic back to YAML/pyscript**.

**(d) Gap-relative lesson.** Node-RED proves that **debuggability must be intrinsic** (HomeSynapse §4.2 captures every run by construction) rather than opt-in instrumentation users forget to add. The flow-format evolution is a milder RQ4 case than SmartThings.

### 2.4 Hubitat (substantive)

**(a)** Local hub; **Rule Machine** with multiple co-existing versions (Legacy, RM 4.x, RM 5.1) and per-app logging toggles.

**(b) Quotations.**
- Version-migration churn / frozen rules: *"I know this has been brought up in the past and it was deemed impossible or very challenging to migrate between say RM4.0 and RM5.0."* ([Rule Machine Version Migrations](https://community.hubitat.com/t/rule-machine-version-migrations/77221)). Users cannot even recreate legacy rules: *"Now, I need another legacy rule, but I don't see a way to create it."* ([Cannot create Legacy Rules with 2.2.9?](https://community.hubitat.com/t/cannot-create-legacy-rules-with-2-2-9/81921/3)).
- Provenance question (maps to C8 actorRef): *"is there an easy way to see what executed a device command?… events and logs just list that a device 'turned on' but not what triggered it?"* ([How can I tell what automation turned on a light?](https://community.hubitat.com/t/how-can-i-tell-what-automation-turned-on-a-light/87629)).
- Confirmation gap: *"the logs say that the app sent a dimmer level command [but] the lights are sometimes not turning on."* ([Automation firing but no response from lights](https://community.hubitat.com/t/automation-firing-but-no-response-from-lights/82875)).

**(c) What users DID.** Froze rules at legacy RM versions and refused to migrate; restored from backups when updates blanked rules ([Rules missing after latest update](https://community.hubitat.com/t/rules-missing-after-latest-update/125604)).

**(d) Gap-relative lesson.** Hubitat's "what turned on my light?" gap is precisely what **C8 actorRef (§0.3.3 row 3)** closes — strong external validation for ratifying the proposal. Its version-fragmentation is the lesson AMD-67 forward-only migration must avoid.

### 2.5 Homey (substantive)

**(a)** Polished "Flow" and "Advanced Flow" visual editor; cloud + local.

**(b) Quotation.** Debugging is the top complaint: *"if I have done a logical error then it might be really hard to backtrace and debug the problem… I would like to be able to see triggered [flows]."* ([Advanced flows debugging](https://community.homey.app/t/advanced-flows-debugging/73120)). Post-upgrade intermittent failures: *"After upgrading to 2023 the flows were migrated fine but they work just intermittently."* ([Advanced flow issue](https://community.homey.app/t/advanced-flow-issue/89072)).

**(c) What users DID.** Used the mobile **timeline as an ad-hoc debugger** because no real trace exists: *"Every time something doesn't go as planned I open the Homey app and use the timeline as a debug mode."* ([View Advanced flows on mobile](https://community.homey.app/t/request-view-advanced-flows-on-mobile/135639)).

**(d) Gap-relative lesson.** Even the most design-polished visual editor fails on RQ2 without a structured run-trace — reinforcing that **§4.2** is the differentiator, and that visual polish (POST-MVP) is no substitute.

---

## 3. Cross-Cutting Analysis

### 3.1 Failure-class concept map

| Failure class | HA | SmartThings | Node-RED | Hubitat | Homey | HomeSynapse (frozen mechanism) |
|---|---|---|---|---|---|---|
| Expression/template syntax | Severe (Jinja2) | N/A (cloud rules) | Function-node JS | Limited | Limited | **Structurally absent** — sealed permits + typed records, no DSL (§0.3.1). REJECT adding one. |
| Trigger vs condition mental model | High | Moderate | Low (explicit wiring) | Moderate | Moderate | **Relocated, not removed** — StateChangeTrigger vs StateTrigger distinct permits (§0.3.1); needs authoring affordance (M7). |
| Refactor/rename churn | High (silent break) | High (migration) | Moderate | High | Moderate | Identity stable across reloads (§3.3); entity/selector refs need validation (§6.1) + possible contract delta. |
| "Why didn't it fire?" | Trace (best) but evicted | Weak | Manual debug nodes | Logs only | Timeline only | **Run-trace model §4.2** + §11 — captures the data; M7 must wire details. |
| Command not confirmed | Fire-and-forget | Report-only partial fail | Fire-and-forget | Fire-and-forget | Fire-and-forget | **Pending Command Ledger §3.11.2** — `Expectation`-evaluated, coalescing disabled. Differentiator. |
| Concurrency footguns | mode/max | Limited | Manual | Limited | Limited | ConcurrencyMode + maxConcurrent + MaxExceededSeverity + dedup (§3.6/§3.7). |
| Migration trust destruction | Silent schema break | Severe (Groovy) | Mild | Severe (RM versions) | Mild | Forward-only idempotent AMD-67; M7 AMD block must state schema posture. |

### 3.2 Debuggability matrix (RQ2)

| Diagnostic question | HA | ST | NR | Hubitat | Homey | HomeSynapse frozen surface captures it? |
|---|---|---|---|---|---|---|
| Did it trigger at all? | Inferred (no trace) | Weak | Manual | Logs | Timeline | **Yes** — every run produces a RunContext/run-trace (§4.2); a non-fire is the absence of a triggering match, recordable. M7 should emit a DIAGNOSTIC. |
| Trigger fired but condition false? | Yes (trace) | No | Manual | Partial | Partial | **Yes** — `RunStatus.CONDITION_NOT_MET` is a distinct status (§0.3.1) + per-condition eval in trace (§4.2). |
| Condition true but action failed? | Yes (trace) | Partial (report) | Manual | Logs | Partial | **Yes** — run failure §6.2 + Action Execution §3.9 per-command status. |
| Fired but device didn't respond? | **No** (fire-and-forget) | **Report-only** | No | No | No | **Yes — uniquely** — Pending Command Ledger §3.11.2, `Expectation`-evaluated confirmation, `PendingStatus` CONFIRMED/TIMED_OUT/EXPIRED. |
| What caused this command? (provenance) | Partial (context_id) | Weak | No | No (top complaint) | No | **Yes (pending C8)** — `actorRef = AutomationId` (§0.3.3 row 3). |

### 3.3 The ledger-gap dossier (RQ3)

The assembled evidence establishes that **intent-confirmation is a genuinely unserved market need**, not a parity feature:

1. **No platform closes the intent-to-observation loop as first-class.** Across SmartThings, Apple HomeKit, Google Home, Matter, Home Assistant, and Zigbee/Z-Wave, none verifies that a device reached the commanded state and surfaces/remediates it as a built-in primitive.
2. **HA core explicitly refuses it.** frenck, 2022-10-01: *"out of scope for HA… Such retries do not take place in HA, but in a level UP."* A core dev confirms silent failure: when an entity is marked unavailable it is *"silently skipped by HA."* Reliability is left to per-integration libraries.
3. **The workaround patterns are the strongest Mom-Test signal.** Users built AppDaemon verify-and-resend callbacks, adopted the `amitfin/retry` HACS add-on (which exposes `expected_state` — outcome verification), and wrote watchdog automations. These are installed hacks, not feature requests.
4. **Protocol acks are a red herring.** Zigbee APS acks and Matter InvokeResponse confirm *delivery/processing at the node*, not that the physical device reached the commanded state — and are generally not surfaced to automations. Matter groupcast Invoke explicitly suppresses responses (true fire-and-forget for groups). The gap is precisely between "command received/processed by the node" and "device verifiably reached the intended physical end-state, confirmed and remediated within the automation" — which is what the ledger's `Expectation`-evaluation targets.
5. **The one shipping "confirmation" is report-only.** SmartThings' partial-failure notice can't reliably name the failed device, gives false positives (locks that actually locked), and offers no remediation.

**Verdict:** The Pending Command Ledger (§3.11.2, row 5) with `Expectation`-evaluated confirmation and coalescing-disabled is a defensible category-of-one claim. This is M5-C superiority material (the Research-13 INV-CE-01 pattern). The M7 obligations are: surfacing `PendingStatus` transitions in the run-trace, sane timeout defaults, and ergonomic `UnavailablePolicy`. Confirmation-*driven retry/remediation* (re-issue on TIMED_OUT) is the advanced behavior and belongs in M8.

### 3.4 Over-engineering check (honesty section / REJECT candidates)

- **5th concurrency mode / arbitrary `maxConcurrent` tuning:** No surveyed user articulated a need beyond single/restart/queued/parallel. HA's four modes are sufficient; ConcurrencyMode's four values are correct. **Defend — not over-engineered, but do not extend.**
- **Tier 2 reserved triggers (TimeTrigger, SunTrigger, WebhookTrigger):** Empty-reserved permits, not implemented machinery — no over-engineering cost today; time/sun automation is heavily used everywhere, so the reservation is justified. **Defend.**
- **A templating/expression DSL:** No surveyed platform's users *need* a Jinja-equivalent; HA's users overwhelmingly *suffer* from it. Adding one would import the largest authoring failure class. **REJECT (REC-155).**
- **`MaxExceededSeverity.SILENT` as a default:** HA's `max_exceeded: silent` (against its own `warning` default) is the exact setting users blame for invisible drops. SILENT must exist (for intentional rate-limited automations) but must NOT be the HomeSynapse default. **Flag → M7 (REC-147).**

---

## 4. Findings + Recommendations

### 4a. REC-numbered findings (ranked by (impact × confidence)/cost)

**REC-141 — Wire the four "why didn't it fire?" trace details into the §4.2 run-trace.**
*Failure-class:* RQ2 debuggability (universal). *Evidence:* HA's trace model is best-in-class yet users still bisect manually; "no traces = didn't trigger" is an unguided inference ([HA troubleshooting docs](https://www.home-assistant.io/docs/automation/troubleshooting/)). *Gap-relative:* §4.2 defines the run-trace; the delta is guaranteeing it records (1) which trigger permit fired, (2) per-condition eval incl. `CONDITION_NOT_MET`, (3) selector resolution to `Set<EntityId>` (§3.12), (4) dedup/drop reason (§3.7 C2). *Recommendation:* Make these four fields mandatory trace content + an instruction test. *Effort:* M.

**REC-142 — Attest the Pending Command Ledger as the validated reliability differentiator.**
*Failure-class:* RQ3 confirmation gap. *Evidence:* No platform offers first-class confirmation; frenck declared it out of scope ([WTH retry thread](https://community.home-assistant.io/t/wth-doesnt-ha-retry-a-failed-service-call/467850), 2022). *Gap-relative:* §3.11.2 + row 5 already own this. *Recommendation:* No new contract; route the §3.3 dossier to M5-C. *Effort:* S.

**REC-143 — Set confirmation timeout defaults and surface `PendingStatus` transitions in the trace.**
*Failure-class:* RQ3. *Evidence:* "automation ran but the light stayed off" recurs across HA/ST/Hubitat ([Simple automation runs but light does not turn on](https://community.home-assistant.io/t/simple-automation-runs-but-light-does-not-turn-on/756793)). *Gap-relative:* `PendingStatus` (DISPATCHED/ACKNOWLEDGED/CONFIRMED/TIMED_OUT/EXPIRED) exists (§0.3.1); the delta is a sane default timeout and trace surfacing. *Recommendation:* M7 AMD block sets default confirmation timeout + makes ledger status visible in run-trace. *Effort:* M.

**REC-144 — Ratify `ConfirmationPolicy` opt-in posture and its default.**
*Failure-class:* RQ3. *Evidence:* users want confirmation but fear double-actuation — frenck, 2022-10-01: *"we can't know the impact of calling things twice. Sure, for a light… but some random entity on a car that gets controlled… you could be toggling locks for example."* *Gap-relative:* `ConfirmationPolicy` opt-in is ACCEPTED (row 2); delta is stating the default (off for most, on where `Expectation` is cheap). *Recommendation:* M7 AMD block names the default. *Effort:* S.

**REC-145 — Guarantee failed-run trace retention rather than a fixed ring buffer.**
*Failure-class:* RQ2. *Evidence:* HA's last-5 default is the most-cited debuggability complaint; real runs get evicted by empty runs ([core #117133](https://github.com/home-assistant/core/issues/117133); [WTH only 5 traces](https://community.home-assistant.io/t/wth-is-there-only-5-traces/473716)). The named HA proposal Discussion #3912 ("Protect one trace of 'failed' run") validates the fix: *"new number of 'runs in error' to protect: define a number of 'error runs' to store and forbid to erase them by 'successful' ones (that could be 1 by default and extendable)."* *Gap-relative:* §4.2 run-trace + §3.3 retention; delta is a retention rule that protects the last failed run. *Recommendation:* M7 retention rule — always retain N most-recent runs AND the most-recent failed run. *Effort:* M.

**REC-146 — Ratify C8 `actorRef` to answer "what turned on my light?"**
*Failure-class:* RQ2 provenance. *Evidence:* top Hubitat complaint ([what automation turned on a light](https://community.hubitat.com/t/how-can-i-tell-what-automation-turned-on-a-light/87629)); HA WTH thread mirrors it. *Gap-relative:* C8 actorRef = AutomationId is PROPOSED (row 3). *Recommendation:* External evidence supports ratifying C8 on the W25 path; no new draft here. *Effort:* S (decision, not build).

**REC-147 — Default to SINGLE with an observable drop DIAGNOSTIC; never default SILENT.**
*Failure-class:* RQ5. *Evidence:* HA `max_exceeded` default is `warning` but users set `silent`, causing invisible drops; "restart-kills-my-delay" and "queued-fires-stale" are recurring ([Automation modes](https://www.home-assistant.io/docs/automation/modes/); [Understanding queued automatons](https://community.home-assistant.io/t/understanding-queued-automatons/426043)). *Gap-relative:* ConcurrencyMode + MaxExceededSeverity (SILENT/INFO/WARNING) + INTERRUPTED status exist (§0.3.1/§3.6); delta is the default severity (INFO/WARNING, not SILENT) and emitting a DIAGNOSTIC on drop + on mid-delay interruption. *Recommendation:* M7 sets defaults + drop/interrupt DIAGNOSTIC. *Effort:* M.

**REC-148 — Give StateChangeTrigger vs StateTrigger distinct authoring affordances + validation.**
*Failure-class:* RQ1 mental model. *Evidence:* trigger/condition and edge/level confusion is documented and persistent ([docs issue #41835](https://github.com/home-assistant/home-assistant.io/issues/41835)). *Gap-relative:* the split is structural (§0.3.1) but relocates confusion. *Recommendation:* M7 instruction-level guidance + validation that flags likely-misuse (e.g., a StateTrigger where edge semantics are implied). *Effort:* M.

**REC-149 — Confirm definition-validation failure surfacing is adequate (fail-closed).**
*Failure-class:* RQ1 syntax/validation. *Evidence:* HA's silent post-update failures vs explicit fail-closed posture (2026.6 release blog, 2026-06-03). *Gap-relative:* §6.1 definition-validation failure + AMD-71 fail-closed write posture (row 4) already cover this. *Recommendation:* Coverage attestation; verify validation errors are user-legible. *Effort:* S.

**REC-150 — State the automation-definition schema versioning posture in the M7 AMD block.**
*Failure-class:* RQ4 migration. *Evidence:* HA silent schema breaks; users freeze versions ([#785719](https://community.home-assistant.io/t/display-breaking-changes-from-version-x-to-y-based-on-your-yaml-and-used-ha-features/785719)). *Gap-relative:* AMD-67 (major,minor) forward-only idempotent migration + automations.yaml rides it (row 4); §3.3 pins identity. *Recommendation:* M7 AMD block explicitly states automation-definition schema version + forward-only migration guarantee. *Effort:* M.

**REC-151 — Record forced-migration trust-destruction as a ratified anti-requirement.**
*Failure-class:* RQ4. *Evidence:* SmartThings Groovy shutdown (devices → "Thing" placeholders) and Hubitat RM version freezes drove abandonment/migration ([Platform Transition FAQ](https://support.smartthings.com/hc/en-us/articles/9339624925204-Platform-Transition-FAQ); [RM version migrations](https://community.hubitat.com/t/rule-machine-version-migrations/77221)). *Gap-relative:* forward-only AMD-67 + identity stability §3.3 is the correct posture. *Recommendation:* record as anti-requirement; never ship a destructive forced migration. *Effort:* S.

**REC-152 — Scope confirmation-driven retry/remediation (re-issue on TIMED_OUT) to M8.**
*Failure-class:* RQ3 advanced. *Evidence:* `amitfin/retry` add-on with `expected_state`; AppDaemon resend-loops are the dominant workaround. *Gap-relative:* the ledger (§3.11.2) gives the signal; acting on it (retry/escalation) is advanced ledger behavior. *Recommendation:* M8 charter row for confirmation-driven remediation. *Effort:* L.

**REC-153 — Validate entity/selector reference integrity across renames (contract-delta candidate).**
*Failure-class:* RQ1 refactor churn. *Evidence:* "rename breaks all automations" is a top HA pain ([WTH can't I rename entities](https://community.home-assistant.io/t/wth-cant-i-rename-entities-without-lots-of-stuff-breaking/815676)); HA confirms automations *"have no idea that the entity name changed."* *Gap-relative:* §3.3 stabilizes AutomationId, not entity references; selectors resolve at trigger time (§3.12). Load-time validation can flag dangling refs (§6.1), but a stable-handle indirection is a contract delta. *Recommendation:* M7 adds dangling-reference validation; FUTURE-AMD sketch for stable entity-reference indirection (do NOT draft). *Effort:* M (validation) / contract-delta (deep fix).

**REC-154 — Treat blank-page + spaghetti authoring UX as a companion/UI lane concern.**
*Failure-class:* RQ1 authoring. *Evidence:* blank-page and "grew into spaghetti" problems are real ([Best practices to keep automations readable](https://community.home-assistant.io/t/best-practices-to-keep-automations-readable/413870)); Homey's polish doesn't fix debuggability. *Gap-relative:* none in frozen core contracts; this is a UI/companion concern. *Recommendation:* POST-MVP (M10/M11/Doc 13 lane): authoring templates/scene gallery, visual flow aid. *Effort:* L.

**REC-155 — Do NOT add a Jinja2-equivalent templating DSL.**
*Failure-class:* RQ1. *Evidence:* templating is HA's single largest authoring failure class ([HA templating debugging docs](https://www.home-assistant.io/docs/templating/debugging/)). *Gap-relative:* sealed permits + typed records (§0.3.1) deliberately foreclose it. *Recommendation:* REJECT; record as anti-requirement. *Effort:* S.

### 4b. THE DISPOSITION TABLE

| REC | One-line | Disposition | Anchor / what it adds |
|---|---|---|---|
| REC-141 | Wire four "why didn't it fire?" trace details | **M7-OBLIGATION** | §4.2/§3.7/§3.12 — mandatory trace fields + instruction test |
| REC-142 | Ledger = validated differentiator | **ALREADY-COVERED** | §3.11.2 + §0.3.3 row 5; feeds M5-C |
| REC-143 | Confirmation timeout defaults + trace surfacing | **M7-OBLIGATION** | §3.11.2 + PendingStatus (§0.3.1) — default timeout + trace detail |
| REC-144 | ConfirmationPolicy opt-in default | **M7-OBLIGATION** | §0.3.3 row 2 — AMD block names the default |
| REC-145 | Guarantee failed-run trace retention | **M7-OBLIGATION** | §4.2 + §3.3 — retention rule protecting last failed run |
| REC-146 | actorRef provenance | **ALREADY-COVERED** | §0.3.3 row 3 (C8 PROPOSED) — evidence supports W25 ratification |
| REC-147 | SINGLE default + drop/interrupt DIAGNOSTIC, never SILENT default | **M7-OBLIGATION** | §3.6/§3.7 + MaxExceededSeverity (§0.3.1) — default severity + DIAGNOSTIC |
| REC-148 | Edge-vs-level authoring affordance + validation | **M7-OBLIGATION** | §0.3.1 sealed permits — instruction guidance + misuse validation |
| REC-149 | Definition-validation failure surfacing | **ALREADY-COVERED** | §6.1 + AMD-71 (row 4) |
| REC-150 | Automation schema versioning posture stated | **M7-OBLIGATION** | AMD-67 + §3.3 — AMD block statement |
| REC-151 | Forced-migration anti-requirement | **ALREADY-COVERED** | AMD-67 + §3.3 — coverage attestation/anti-requirement |
| REC-152 | Confirmation-driven retry/remediation | **M8-OBLIGATION** | §3.11.2 — advanced ledger behavior (re-issue on TIMED_OUT) |
| REC-153 | Entity/selector reference integrity | **FUTURE-AMD** | §3.3/§3.12/§6.1 — stable-reference indirection delta sketch (not drafted) |
| REC-154 | Blank-page + spaghetti authoring UX | **POST-MVP** | none in core — M10/M11/Doc 13 UI lane |
| REC-155 | No Jinja-equivalent templating DSL | **REJECT** | §0.3.1 — anti-requirement |

No REC appears in two buckets. All six dispositions (ALREADY-COVERED, M7-OBLIGATION, M8-OBLIGATION, FUTURE-AMD, POST-MVP, REJECT) are populated.

---

## 5. Caveats and Open Questions

- **Source reliability:** HA docs, GitHub issues, the official HA release blog, and the SmartThings/Hubitat/Homey official community forums are primary and dated. Several troubleshooting aggregator sites (trunetto.com, whizz-experts.com, newerest.space) appear AI-generated/low-authority and were used only to corroborate failure-mode existence, never as sole evidence. The HA 2026.6 silent-template-break is now **primary-verified** against the official release blog (2026-06-03), upgraded from indicative; the silent-failure *pattern* is independently attested by primary forum/GitHub threads.
- **Empirical validation needed:** the claim that HomeSynapse's edge/level split *relocates* rather than *removes* confusion (REC-148) is inferential — validate with M7 authoring usability testing.
- **Connector note:** the Doc 07 §-anchors and §0.3 materials were read from the embedded brief, which states they are source-verified at `7c73c91`; I did not have an independent connector read of design/07-automation-engine.md or design/01-event-model.md. If the M7 AMD block needs the exact `PendingCommand`/`DurationTimer` field lists or the precise §3.11.2 `Expectation.evaluate` contract beyond what §0.3.1 embeds, **request those fields from the connector** — I did not reconstruct them.
- **Out-of-register (one line each):** Z-Wave/Zigbee APS application-level ack semantics and how the ledger persists pending state are engineering-register (sibling 14-B) — noted, not analyzed. Event-storm throttling internals (§6.7) are likewise sibling-register.
- **Evidence reach:** NOT INCOMPLETE — all five RQs reached 2+ independent primary sources or a maintainer statement.

---

## 6. Appendix: Sources

- **Home Assistant (docs/blog):** home-assistant.io/docs/templating/debugging/, /docs/templating/errors/, /docs/automation/condition/, /docs/automation/basics/, /docs/automation/modes/, /docs/automation/troubleshooting/, /docs/automation/yaml/; home-assistant.io/blog/2026/06/03/release-20266/
- **Home Assistant (community/GitHub):** community 467850 (frenck retry/out-of-scope), 473716 (5 traces), 810459 (retry hack), 815676 (rename breaks), 785719 (breaking changes), 426043 (queued), 413870 (readability), 756793 (ran but off); github core #117133, home-assistant.io issues #41835, discussions #926, discussions #3912 (protect failed trace); amitfin/retry; andrewdoering.org watchdog.
- **SmartThings:** support.smartthings.com Platform Transition FAQ; community 306320 (partial fail), 120517 (reliability), 249279 (webCoRE going away), 257458 (migrate from webCoRE); thedigitalmediazone.com Groovy retirement.
- **Node-RED:** flowfuse.com debug node + debugging-flows; flows.nodered.org node-red-debugger.
- **Hubitat:** community 77221 (RM migrations), 81921 (legacy rules), 87629 (what turned on light), 82875 (firing no response), 125604 (rules missing); docs2.hubitat.com troubleshoot-apps-or-devices.
- **Homey:** community 73120 (advanced flow debugging), 89072 (intermittent post-upgrade), 135639 (mobile timeline as debugger).

## 7. HomeSynapse Code-Level Implications [LIGHT]

Observations only (routed through §4b); no module-info changes, no new types.
- The `RunContext` (8 fields) and the run-trace (§4.2) are where REC-141/REC-145 land — trace-detail and retention obligations live on the observability surface exported from `com.homesynapse.automation`, consumed by the Observability module per the §0.2 javadoc.
- `PendingCommand` (8 fields) + `PendingStatus` (DISPATCHED/ACKNOWLEDGED/CONFIRMED/TIMED_OUT/EXPIRED) carry REC-143/REC-152; the `Expectation`-evaluated confirmation referenced via `requires com.homesynapse.value` is the mechanism, not a new type.
- `ConcurrencyMode` (SINGLE/RESTART/QUEUED/PARALLEL) + `MaxExceededSeverity` (SILENT/INFO/WARNING) + `RunStatus.INTERRUPTED`/`CONDITION_NOT_MET` carry REC-147; the obligation is default selection + DIAGNOSTIC emission, not new enum values.
- `StateChangeTrigger` vs `StateTrigger` (distinct TriggerDefinition permits) carry REC-148; the obligation is authoring guidance + validation, not a permit change.
- C8 `actorRef = AutomationId` (REC-146) rides the existing envelope; no envelope field change.