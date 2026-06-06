# Research 6: Integration Runtime — Supervisor Patterns for Protocol Adapters

> Companion to Doc 05 (Integration Runtime). Targets HomeSynapse Core M4 (API freeze) and M9 (supervisor). Numbering continues from prior research notes; AMD-01..AMD-52 are allocated (AMD-47 withdrawn), RECs continue from REC-41.

---

## §1 Executive Summary

- **VERDICT — Adopt Erlang/OTP's exact `intensity`/`period` semantics over Akka's `withLimit`**, because OTP's "MaxR restarts in MaxT seconds → terminate self" rule maps cleanly to a `ConcurrentLinkedDeque<Instant>` guarded by `ReentrantLock` (LTD-11 compliant), exactly as the reference `supervisor.erl` does it via an `inPeriod/3` predicate over a list of timestamps. Akka's `BackoffSupervisorStrategy.withMaxNrOfRetries` is *per-incident* and resets on backoff-window expiry, which silently allows pathological children to limp along forever — the failure mode the Erlang Battleground "dodos" post documents.
- **VERDICT — Add four post-setup lifecycle hooks to `IntegrationAdapter` before M4 freeze (`onConfigUpdated`, `onReauthRequired`, `onOptionsUpdated`, `migrate`), because every comparable platform (HA, OpenHAB, Kura DS, OTP) treats reload/reauth/options/migrate as first-class, and HomeSynapse will pay a retroactive amendment tax if M4 ships without them.** This is the single highest-impact finding in the document.
- **VERDICT — Reject expanding `HealthState` beyond the four members.** OpenHAB's seven-state `ThingStatus` × 8+ `ThingStatusDetail` matrix is load-bearing in OpenHAB only because bindings *self-report* their status; HomeSynapse aggregates from metrics. Keep the FSM at four; add a `HealthDetail` reason enum on `IntegrationHealthRecord` instead.
- **VERDICT — Retain the weighted health score but reclassify it as advisory, not gating.** No comparable platform (HA, OpenHAB, Kura, Akka) computes a unified score; they all use ad-hoc signals (`ConfigEntryState`, `ThingStatus`, last-update timestamp). The score is a HomeSynapse differentiator, but state transitions should be driven by individual per-dimension thresholds, not the composite, to avoid hidden coupling between unrelated dimensions.
- **VERDICT — Add a `CredentialRotator` service to `IntegrationContext` (M4-blocking).** HA's reauth flow is exception-driven (`ConfigEntryAuthFailed` → `async_start_reauth`); HomeSynapse needs an equivalent escape hatch because OAuth-bearing cloud adapters (Nest, Tado, Netatmo) cannot recover via supervisor restart alone — the OTP "kill and restart" pattern *does not refresh tokens*.
- **VERDICT — Reject sub-process isolation for Phase-3 scope but reserve the design surface.** JNI memory leaks and JVM-wide OOM are real (Pi 4 has 1–8 GB depending on SKU, Pi 5 has 4–16 GB), but `ProcessBuilder`-based isolation costs an order of magnitude more code than the next-most-impactful change. Leave a documented `isolationHint` enum on `IntegrationDescriptor` for future work.
- **VERDICT — Adopt HA's `after_dependencies` (soft dependency) semantics in addition to existing hard dependencies.** Kahn's algorithm on hard edges only correctly models "MQTT broker must be up before MQTT adapter" but cannot model "Bluetooth proxy *may* be used by HomeKit if present" — HA solved this exactly, and the cost is one optional `Set<IntegrationId>` field on `IntegrationDescriptor`.
- **VERDICT — Keep the 60s planned-restart timeout but make it per-descriptor with a declared default.** OpenHAB's `initialize()` contract is "non-blocking, schedule separate job"; HA has no fixed timeout but raises `ConfigEntryNotReady` to retry. 60s is right for Zigbee/Matter (radio init takes 15–30s); too long for HTTP-only cloud APIs (which should fail fast). Per-descriptor configurability beats a single global constant.

---

## §2 Platform/Literature Deep Dives

### §2.1 Erlang/OTP supervisor (canonical)

**(a) How it solves the problem.** OTP supervisors are configured via a `SupFlags` map with `strategy`, `intensity`, `period`, `auto_shutdown`. A sliding window of restart timestamps is kept; if more than `intensity` restarts occur within `period` seconds, the supervisor terminates all children and itself, escalating to its parent. Restart strategies (`one_for_one`, `one_for_all`, `rest_for_one`, `simple_one_for_one`) determine sibling impact when one child crashes.

**(b) Direct quotation.** From the canonical Erlang System Documentation (`https://www.erlang.org/doc/system/sup_princ.html`):

> "To prevent a supervisor from getting into an infinite loop of child process terminations and restarts, a maximum restart intensity is defined using two integer values specified with keys intensity and period in the [sup_flags()] map. Assuming the values MaxR for intensity and MaxT for period, then, if more than MaxR restarts occur within MaxT seconds, the supervisor terminates all child processes and then itself."

The reference implementation (`https://github.com/blackberry/Erlang-OTP/blob/master/lib/stdlib/src/supervisor.erl`) keeps an in-memory list pruned by an `inPeriod/3` predicate — exactly the ring-of-timestamps pattern HomeSynapse needs. The **built-in defaults are `intensity=1, period=5`**, not the "intensity=3, period=60" mentioned in informal community blog posts.

**(c) Known pain points.** The Erlang Battleground "Extinction of the Dodos" post (`https://medium.com/erlang-battleground/the-extinction-of-the-dodos-otp-style-f421f9de4275`) documents a non-obvious edge case: with `intensity=5, period=1` and 10 transient `dodo` children, simultaneously killing all ten exceeds the 5-restarts-per-second threshold, killing the supervisor itself — and because that supervisor was declared `transient`, its parent `world_sup` does *not* restart it. Lesson: HomeSynapse must distinguish *transient-failure restarts* (counted against intensity) from *planned restarts* (not counted), or face the same trap.

**(d) Lesson for HomeSynapse.** The Erlang docs say "If you have multiple levels of supervision, do not set the restart intensities to the same values on all levels … the total number of restarts will be the product of the intensity values." HomeSynapse has only one supervisor level (no nesting), so the product collapses to the single configured intensity. The Erlang docs' explicit embedded-system guidance — *"if you do not have real time monitoring and ability to fix problems quickly, for example in an embedded system, you might want to accept at most one restart per minute"* — yields **intensity=1, period=60** as the most defensible default. The "intensity=3" figure appears only in the docs' multi-level-supervision example ("Allowing at most 3 restarts for the top level supervisor might be a better choice"). HomeSynapse should default to `intensity=1, period=60s` for the embedded-system case, encoded in `SupervisorParameters` and overridable per-descriptor via REC-49.

### §2.2 Akka / Apache Pekko typed supervision

**(a) How it solves the problem.** Akka typed offers `SupervisorStrategy.restart()`, `.resume()`, `.stop()`, `.restartWithBackoff(min, max, jitter)`. A `RestartSupervisorStrategy.withLimit(maxNrOfRetries, withinTimeRange)` enforces an intensity-like cap. Crucially, restart strategies are *per-behavior* in the typed API: `Behaviors.supervise(behavior).onFailure(...)`.

**(b) Direct quotation.** From the Akka typed Javadoc (`https://doc.akka.io/japi/akka-core/current//akka/actor/typed/SupervisorStrategy.html`):

> "public static RestartSupervisorStrategy restart() — Restart immediately without any limit on number of restart retries. A limit can be added with RestartSupervisorStrategy.withLimit. If the actor behavior is deferred and throws an exception on startup the actor is stopped (restarting would be dangerous as it could lead to an infinite restart-loop)."

For the backoff variant (Apache Pekko 1.1.4 Javadoc, `https://pekko.apache.org/api/pekko/current/org/apache/pekko/pattern/Backoff$.html`):

> "It supports exponential back-off between the given minBackoff and maxBackoff durations. For example, if minBackoff is 3 seconds and maxBackoff 30 seconds the start attempts will be delayed with 3, 6, 12, 24, 30, 30 seconds. The exponential back-off counter is reset if the actor is not terminated within the minBackoff duration."

**(c) Known pain points.** Two community-documented issues: (i) message stash overflow during backoff — incoming messages are dropped silently if `akka.actor.typed.restart-stash-capacity` is exceeded; (ii) `withLimit` is *per-incident* and resets after `withinTimeRange` — different semantics from OTP, where the window is sliding.

**(d) Lesson for HomeSynapse.** Adopt Akka's *backoff math* (exponential with jitter, capped) but OTP's *intensity accounting* (sliding window). HomeSynapse is not actor-based, so the `Behaviors.supervise(...).onFailure(...)` API is not applicable; the lesson is in the *parameter shape*, not the implementation. Specifically: a `BackoffParameters { Duration minBackoff, Duration maxBackoff, double jitterFactor }` record should live on `IntegrationDescriptor` so per-adapter tuning is possible.

### §2.3 Home Assistant ConfigEntry lifecycle

**(a) How it solves the problem.** HA's `ConfigEntry` is the unit of integration instantiation. An async state machine (`ConfigEntryState` enum) drives transitions; integrations expose `async_setup_entry`, `async_unload_entry`, `async_remove_entry`, `async_migrate_entry`. Reauth is exception-driven (`ConfigEntryAuthFailed`). Options flows allow runtime-tunable parameters distinct from setup data.

**(b) Direct quotations.** Primary-source fetch of `homeassistant/config_entries.py` (`https://github.com/home-assistant/core/blob/dev/homeassistant/config_entries.py`) confirms the `ConfigEntryState` enum has exactly eight members with `(value, recoverable)` tuples:

> `LOADED = "loaded", True` ("The config entry has been set up successfully")
> `SETUP_ERROR = "setup_error", True` ("There was an error while trying to set up this config entry")
> `MIGRATION_ERROR = "migration_error", False` ("There was an error while trying to migrate the config entry to a new version")
> `SETUP_RETRY = "setup_retry", True` ("The config entry was not ready to be set up yet, but might be later")
> `NOT_LOADED = "not_loaded", True` ("The config entry has not been loaded")
> `FAILED_UNLOAD = "failed_unload", False` ("An error occurred when trying to unload the entry")
> `SETUP_IN_PROGRESS = "setup_in_progress", False`
> `UNLOAD_IN_PROGRESS = "unload_in_progress", False`

The second tuple element is the `recoverable` attribute — `MIGRATION_ERROR` and `FAILED_UNLOAD` are deliberately non-recoverable.

The setup-retry backoff schedule, from the `__async_setup_with_context` method's `except ConfigEntryNotReady` block:

> `wait_time = 2 ** min(self._tries, 4) * 5 + (randint(RANDOM_MICROSECOND_MIN, RANDOM_MICROSECOND_MAX) / 1000000)`

So the deterministic schedule (in seconds) is **5, 10, 20, 40, 80, then 80 forever** (capped via `min(self._tries, 4)`), with sub-second jitter.

For reauth (HA developer docs, `https://developers.home-assistant.io/docs/integration_setup_failures/`):

> "Raise the ConfigEntryAuthFailed exception, and Home Assistant will automatically put the config entry in a failure state and start a reauth flow. The exception must be raised from async_setup_entry in __init__.py or from the DataUpdateCoordinator or the exception will not be effective at triggering the reauth flow."

**(c) Known pain points.** Issue `home-assistant/core#67855` ("Sense reauth is triggering hundreds of time per minute") documents shared-cookie-session collisions between two Sense instances causing **hundreds** of reauth attempts per minute; issue #154379 (icloud incorrectly creating new entries instead of updating); issue #143148 (Tado OAuth reauth needed on every HA restart). PR #138522 introduced `UNLOAD_IN_PROGRESS` and `FAILED_UNLOAD` as discrete states because the prior collapsed model leaked partially-unloaded state.

**(d) Lesson for HomeSynapse.** Three concrete lessons: (1) `SETUP_IN_PROGRESS` / `UNLOAD_IN_PROGRESS` are *non-recoverable* in HA's flag and *not* operator-observable health states — HomeSynapse's collapse into a pre-start state is correct; (2) the exponential schedule **5, 10, 20, 40, 80s with sub-second jitter** is empirically validated and should be the default `BackoffParameters` — HomeSynapse can encode the same; (3) **add `IntegrationConfigUpdated` event and `migrate` hook now, not later** — HA has spent years fighting backward-compat for entries that predate `MIGRATION_ERROR`.

### §2.4 OpenHAB binding lifecycle (ThingHandler / ThingStatus)

**(a) How it solves the problem.** OpenHAB's `ThingHandler` defines `initialize()`, `dispose()`, `handleConfigurationUpdate(Map)`, `handleRemoval()`, `thingUpdated(Thing)`, `bridgeStatusChanged(ThingStatusInfo)`, `childHandlerInitialized(...)`, `childHandlerDisposed(...)`. State is `ThingStatus` (UNINITIALIZED, INITIALIZING, UNKNOWN, ONLINE, OFFLINE, REMOVING, REMOVED) with secondary `ThingStatusDetail` enum (COMMUNICATION_ERROR, CONFIGURATION_ERROR, BRIDGE_OFFLINE, FIRMWARE_UPDATING, DUTY_CYCLE, BRIDGE_UNINITIALIZED, GONE, DISABLED).

**(b) Direct quotation.** From the OpenHAB binding developer docs (`https://www.openhab.org/docs/developer/bindings/`):

> "The ThingHandler has two important lifecycle methods: initialize and dispose. The initialize method is called when the handler is started and dispose just before the handler is stopped … The framework expects this method to be non-blocking and return quickly. For longer running initializations, the implementation has to take care of scheduling a separate job which must guarantee to set the thing status eventually."

On bridge ordering:

> "A BridgeHandler of a bridge is initialized before ThingHandlers of its child things are initialized. A BridgeHandler is disposed after all ThingHandlers of its child things are disposed."

State restrictions are enforced at the framework boundary (Issue openhab-core#1326, `https://github.com/openhab/openhab-core/issues/1326`):

> "Illegal status INITIALIZING. Bindings only may set UNKNOWN, ONLINE, OFFLINE or REMOVED."

**(c) Known pain points.** (i) The `bridgeStatusChanged` BaseThingHandler default *loses* `ThingStatusDetail.CONFIGURATION_ERROR` when a bridge goes offline (smarthome#4074) — generic supervision logic can mask real per-thing problems; (ii) the framework owns INITIALIZING/UNINITIALIZED so bindings cannot signal a *reinitialization in progress*, which forces hacks (openhab-core#1326 cites a Sony binding waiting 15–30s for the device to come up but not being able to display that state); (iii) `handleRemoval()` cannot run on a thing that's not initialized — circular blocker (openhab-core#2828).

**(d) Lesson for HomeSynapse.** HomeSynapse already collapses UNINITIALIZED/INITIALIZING into pre-start; that's correct because pre-start exists only as the *absence* of `IntegrationStarted`. But add a `HealthDetail` reason enum with at minimum `COMMUNICATION_ERROR`, `CONFIGURATION_ERROR`, `BRIDGE_OFFLINE` (parent integration down), `DUTY_CYCLE_THROTTLED` (Zigbee-specific but reusable), and `AUTH_FAILED`. **Critically**: don't let the parent's offline status overwrite a child's `CONFIGURATION_ERROR` (the smarthome#4074 lesson). Encode that as a unit test, not just doc.

### §2.5 Eclipse Kura ConfigurationService / OSGi DS

**(a) How it solves the problem.** Kura builds on OSGi Declarative Services (`@Component`, `@Activate`, `@Deactivate`, `@Modified`). `@Modified` is the key annotation: when ConfigAdmin updates a component's properties, `@Modified` is called *without* deactivating the component, allowing in-place reconfiguration. Snapshots and rollback are first-class (`snapshot()`, `rollback()`).

**(b) Direct quotation.** From the Liferay DS-annotations writeup (`https://liferay.dev/b/revisiting-osgi-ds-annotations`):

> "@Modified is how you get notified of the changes to the Config Admin properties, either via a change in the control panel or a change to the osgi/configs/<my pid>.config files. When you have an @Modified annotation, you can update your local cache value and then you won't require a restart when the data changes."

From the Kura `ConfigurationService` Javadoc:

> "The configuration properties will be passed in the activate or update methods of the Component definition."

**(c) Known pain points.** OSGi DS has well-known startup-ordering complexity: `configuration-policy="require"` blocks activation until config arrives, but if config never arrives, the component is silently never alive — and `@Activate` never fires. Diagnosing "component not alive" requires the Felix console.

**(d) Lesson for HomeSynapse.** The `@Modified` annotation maps directly to the proposed `onConfigUpdated(IntegrationConfig oldConfig, IntegrationConfig newConfig)` hook. The signature matters: pass both old and new so adapters can diff and avoid recreating expensive resources. Snapshots/rollback are out of scope for M9, but `onConfigUpdated` should return `ConfigUpdateOutcome` (RESTART_REQUIRED / APPLIED_IN_PLACE / REJECTED) so a failed apply triggers supervisor restart with the prior config.

### §2.6 Android Service lifecycle

**(a) How it solves the problem.** Android Services use `onCreate`, `onStartCommand`, `onBind`, `onUnbind`, `onDestroy`. `onStartCommand` is idempotent — re-invocation does not call `onCreate` again. Return codes (`START_STICKY`, `START_NOT_STICKY`, `START_REDELIVER_INTENT`) declare the restart policy *to the OS*.

**(b) Direct quotation.** From the Android developer docs (`https://developer.android.com/develop/background-work/services`):

> "The onCreate() and onDestroy() methods are called for all services, whether they're created by startService() or bindService(). The active lifetime of a service begins with a call to either onStartCommand() or onBind() … Although a started service is stopped by a call to either stopSelf() or stopService(), there isn't a respective callback for the service (there's no onStop() callback)."

**(c) Known pain points.** No reconfigure hook — Android Services have to be stopped and recreated to apply new configuration, exactly what HomeSynapse must avoid.

**(d) Lesson for HomeSynapse.** Android's `START_STICKY` is conceptually identical to HomeSynapse's TRANSIENT-classified restart. The cleanest split — onCreate-versus-onStartCommand — is worth borrowing: in HomeSynapse, `IntegrationAdapter.initialize()` is the `onCreate`-equivalent (once per descriptor), `run()` is the `onStartCommand`-equivalent (re-invocable on planned restart). The current API already has this split — keep it, don't merge.

### §2.7 Matter 1.4 Bridged Device Basic Information

**(a) How it solves the problem.** Matter's BridgedDeviceBasicInformation cluster (cluster ID 0x0039) declares per-endpoint attributes: `Reachable` (0x0011), `UniqueID` (0x0012), `NodeLabel`. Dynamic endpoints can be added/removed at runtime; the bridge publishes structural reachability changes via attribute updates on the `Reachable` attribute.

**(b) Direct quotation.** From the Matter Bridge Example documentation (`https://project-chip.github.io/connectedhomeip-doc/examples/bridge-app/linux/README.html`):

> "Using this declared endpoint structure, three endpoints for three bridged lights are dynamically added at endpoint ID's 2, 3, and 4 … In the Bridged Device Basic Information cluster, the reachable attribute is simulated."

**(c) Known pain points.** ESP-Matter Issue #1644 documents that Reachable (0x11) and UniqueID (0x12) are *mandatory* but commonly missing on bridged endpoints, breaking certification — i.e., reachable-status broadcasts cannot be assumed-present at the adapter layer.

**(d) Lesson for HomeSynapse.** Matter's `Reachable` attribute is the canonical equivalent of HomeSynapse's `device_reachable_changed` event. The bridge-app dynamic endpoint demo (Light 2 removed then re-added at endpoint 6) is exactly the *capability_added_post_registration* / *capability_removed* pattern HomeSynapse needs. Propose two new events: `integration.capability_added` and `integration.capability_removed` (dot-namespaced per the new-event convention).

### §2.8 Java virtual-thread supervisor patterns (Loom)

**(a) How it solves the problem.** JDK 21 finalized virtual threads. `StructuredTaskScope` remains **preview** as of May 2026 — per JEP 525 (`https://openjdk.org/jeps/525`), it has been re-previewed in JDK 22 (JEP 462), JDK 23 (JEP 480), JDK 24 (JEP 499), and JDK 25 (JEP 505), with JEP 533 proposing a seventh preview in JDK 27. For supervisor-style code where children outlive the call site, raw `Thread.ofVirtual().start(...)` is the appropriate primitive.

**(b) Direct quotation.** From Ron Pressler's "State of Loom Part 2" (`https://cr.openjdk.org/~rpressler/loom/loom/sol1_part2.html`):

> "we represent a structured concurrency scope, the code block that confines the lifetime of child threads, by making the java.util.concurrent.ExecutorService an AutoCloseable, with close shutting down the service and awaiting termination. This guarantees that all tasks submitted to the service will have terminated by the time we exit the try-with-resources (TWR) block, confining their lifetime to the code structure."

And from Red Hat (`https://developers.redhat.com/articles/2023/10/03/beyond-loom-weaving-new-concurrency-patterns`):

> "Vthreads are managed by the JVM and are not permanently associated with a platform thread. They only use a platform thread (called the carrier) when they are actually running."

**(c) Known pain points.** (i) Thread *pinning* when blocked inside a `synchronized` block — exactly why LTD-11 mandates `ReentrantLock`; the carrier is held for the duration of any synchronized critical section; (ii) `StructuredTaskScope` is still preview across six JDK releases (21–26) — not safe to ship in production code targeting JDK 21.

**(d) Lesson for HomeSynapse.** The supervisor itself runs on platform threads (AMD-26/27 for JDBC). Each adapter's `run()` executes on a dedicated virtual thread launched via `Thread.ofVirtual().name(...).start(...)`. The supervisor watches via `Thread.join(Duration)` (Loom-friendly, no callback registration). `ConcurrentLinkedDeque<Instant>` for the restart-timestamp ring is correct; iteration to prune expired entries must hold the `ReentrantLock` since two pruners would corrupt order. **Do not use `StructuredTaskScope`** — preview through at least JDK 26, and the supervisor needs children to outlive the supervising scope anyway.

---

## §3 Cross-Cutting Analysis

### §3.1 Concept Mapping Table

| HomeSynapse concept | OTP | Akka typed | Home Assistant | OpenHAB | Kura DS |
|---|---|---|---|---|---|
| `IntegrationAdapter.initialize()` | child_spec `start` | `Behaviors.setup` | `async_setup_entry` | `ThingHandler.initialize()` | `@Activate` |
| `IntegrationAdapter.run()` | implicit (loop in process) | message loop | background tasks | scheduled jobs | n/a |
| `IntegrationAdapter.close()` | `terminate/2` | `PostStop` signal | `async_unload_entry` | `ThingHandler.dispose()` | `@Deactivate` |
| `commandHandler()` | `gen_server:call/cast` | message receive | service handlers | `handleCommand` | service method |
| (missing) `onConfigUpdated` | `code_change` | re-setup | reload listener + `async_update_entry` | `handleConfigurationUpdate` / `thingUpdated` | **`@Modified`** |
| (missing) `onReauthRequired` | n/a | n/a | `ConfigEntryAuthFailed` → `async_start_reauth` | OFFLINE + CONFIGURATION_ERROR re-init | n/a |
| (missing) `migrate` | `code_change` | n/a | `async_migrate_entry` | binding internal | snapshot/rollback |
| `HealthState` (4) | binary alive/dead | binary | `ConfigEntryState` (8) | `ThingStatus` (7) | reference satisfied/not |
| Restart intensity | `intensity` × `period` | `withLimit(maxNr, withinTimeRange)` | tries-based: 5,10,20,40,80s | none — relies on user | none |
| Exception classification | `transient`/`permanent`/`temporary` | per-strategy decider | `ConfigEntryNotReady` / `ConfigEntryAuthFailed` / `ConfigEntryError` | exception → COMMUNICATION_ERROR detail | reference rebind |
| Topological start order | child_spec order | `Behaviors.setup` order | `manifest.after_dependencies` | bridge-before-thing | DS reference resolution |
| Planned restart (config reload) | `code_change` (rare) | restart behavior | `hass.config_entries.async_reload` | dispose → initialize | `@Modified` (no restart) |
| Composite observability | `sys:get_status` | `Behaviors.intercept` | `/api/states` + repairs | `/rest/things` + `/rest/inbox` | OSGi Console |

### §3.2 Gap Analysis (ranked by impact)

| Rank | Gap | Present in | Impact |
|---|---|---|---|
| 1 | **Reconfigure hook (`onConfigUpdated`)** | HA, OpenHAB, Kura, OTP | HIGH — every cloud adapter and every protocol broker needs to apply user-edited config without dropping in-flight commands |
| 2 | **Reauth hook (`onReauthRequired`)** | HA | HIGH — OAuth-bearing adapters (Nest, Tado, Hue cloud, Spotify) cannot recover via restart |
| 3 | **Migrate hook (`migrate(...)`)** | HA, OTP `code_change` | MEDIUM — needed the moment any adapter version bumps schema; missing it means user data loss |
| 4 | **Options-flow / runtime-tunable parameters** | HA, OpenHAB | MEDIUM — operators must restart to change poll intervals, log levels |
| 5 | **Soft dependencies (`after_dependencies`)** | HA | MEDIUM — Kahn's algorithm on hard edges only is incomplete |
| 6 | **Per-integration status reason (`HealthDetail` enum)** | OpenHAB | MEDIUM — operators need to distinguish "device unreachable" from "auth failed" from "config invalid" without parsing log lines |
| 7 | **Dynamic capability events** | Matter Bridge, HA discovery, OpenHAB dynamic channels | LOW–MEDIUM — Zigbee firmware updates, Matter endpoint changes |
| 8 | **Credential rotation API** | HA reauth flow | MEDIUM — required to support gap #2 |

### §3.3 Over-Abstraction Analysis

| HomeSynapse concept | Defense or retraction |
|---|---|
| **Weighted health score** (0.30/0.20/0.15/0.20/0.15) | **Defended with caveat.** No other surveyed platform computes a unified score. The weights are unsourced from any prior art — the closest is HAGHS (community-driven HACS integration, `https://github.com/D-N91/home-assistant-global-health-score`), which uses a 40/60 hardware/hygiene split and is explicitly *advisory, not gating*. **Retain** the score as an output; **reject** using it to drive `HEALTHY → DEGRADED` transitions; use per-dimension thresholds instead. |
| **Four-state FSM with asymmetric hysteresis** | **Defended.** OTP has no FSM (binary alive/dead), HA has eight states but four are transient (SETUP_IN_PROGRESS, UNLOAD_IN_PROGRESS, MIGRATION_ERROR, FAILED_UNLOAD), OpenHAB has seven (three framework-owned). Collapsed to operator-visible states, HA effectively has LOADED / SETUP_RETRY / SETUP_ERROR / NOT_LOADED — four. **Match.** |
| **`IntegrationContext` injected once, no setters** | **Defended.** This is the cleanest invariant in the design. The hooks proposed below are *methods on `IntegrationAdapter`*, not setters on the context. Context is *services*; adapter methods are *signals*. |
| **TRANSIENT/PERMANENT/SHUTDOWN_SIGNAL classification** | **Partially retracted.** HA distinguishes four failure modes: `ConfigEntryNotReady` (transient), `ConfigEntryAuthFailed` (auth), `ConfigEntryError` (permanent), migration error (effectively a fifth). Add `AUTH_FAILED` — it routes to reauth flow, not restart. |

### §3.4 Competitive Assessment

Where HomeSynapse is genuinely differentiated:

1. **Composite, weighted, observable health score** with five quantitative inputs. Nothing in HA / OpenHAB / Kura matches this. Risk: weights are not empirically calibrated.
2. **Topological start ordering via Kahn's algorithm.** HA solves this implicitly via `dependencies` / `after_dependencies` resolved at module import time; OpenHAB does it via bridge-before-thing only. HomeSynapse's explicit DAG is more general.
3. **Planned-restart semantics** (suppress `availability_changed`, queue commands, exclude from orphan detection, 60s timeout). This is genuinely novel; HA's `async_reload` does some of this, but command queuing across reload is custom per integration.
4. **Single-JVM, no-Actor, Loom-native supervision.** OTP requires the BEAM; Akka requires actor mailboxes; OpenHAB requires OSGi; Kura requires both. HomeSynapse trades the actor abstraction cost for direct control — competitive only if the supervisor stays simple.

---

## §4 Amendment Recommendations

Ranked by `(impact × confidence) / cost`. Effort estimates assume a single contributor familiar with the codebase. LOC counts are gross (interface + implementation + test) and are upper bounds.

### REC-41 — Add four lifecycle hooks to `IntegrationAdapter` (M4-blocking)

- **Gap citation:** §3.2 #1, #2, #3, #4
- **Lesson source:** HA `async_unload_entry`, `async_migrate_entry`, `async_start_reauth`, options-flow listener; OpenHAB `handleConfigurationUpdate`; Kura `@Modified`
- **Change (signatures, single flat package `com.homesynapse.integration.api`):**
  ```java
  public interface IntegrationAdapter {
      void initialize() throws IntegrationStartupException;
      void run() throws InterruptedException;
      void close();
      CommandHandler commandHandler();

      // NEW — all default no-op so existing M3-prototype adapters compile
      default ConfigUpdateOutcome onConfigUpdated(
          IntegrationConfig oldConfig,
          IntegrationConfig newConfig
      ) throws IntegrationConfigException {
          return ConfigUpdateOutcome.RESTART_REQUIRED;
      }

      default void onOptionsUpdated(IntegrationOptions newOptions) { /* no-op */ }

      default ReauthOutcome onReauthRequired(ReauthContext ctx) {
          return ReauthOutcome.UNSUPPORTED;
      }

      default boolean migrate(
          int fromMajor, int fromMinor,
          int toMajor, int toMinor,
          IntegrationConfig oldConfig
      ) {
          return fromMajor == toMajor;
      }
  }
  ```
- **Backward compat:** All four are `default` methods; existing adapters compile unmodified.
- **Effort:** ~280 LOC (4 interface methods + 4 outcome enums/records + 4 default impls + 12 unit tests). 1.5 developer-days.
- **Confidence:** HIGH — direct port of well-trodden HA + OpenHAB API surface.
- **Requires AMD-53.**

### REC-42 — Add `HealthDetail` reason enum and `IntegrationHealthRecord.detail` field

- **Gap citation:** §3.2 #6
- **Lesson source:** OpenHAB `ThingStatusDetail`
- **Change:** Add `HealthDetail` enum (`NONE`, `COMMUNICATION_ERROR`, `CONFIGURATION_ERROR`, `AUTH_FAILED`, `BRIDGE_OFFLINE`, `DUTY_CYCLE_THROTTLED`, `RATE_LIMITED`, `STARTUP_TIMEOUT`, `RESOURCE_LIMIT`, `DEPENDENCY_FAILED`, `MIGRATING`, `DISABLED_BY_USER`). Add `HealthDetail detail` and `@Nullable String description` to `IntegrationHealthRecord`. The supervisor sets `detail` whenever an FSM transition is driven by a specific reason; `description` is human-readable optional context.
- **Backward compat:** New components on existing record — flag this; existing call sites in `integration-runtime` need a sweep. If the inventory says `integration-api` has 22 types and `IntegrationHealthRecord` is among them, the record gains two components.
- **Effort:** ~140 LOC. 1 developer-day.
- **Requires AMD-54.**

### REC-43 — Add `AUTH_FAILED` to `ExceptionClassification`

- **Gap citation:** §3.3 retraction
- **Lesson source:** HA `ConfigEntryAuthFailed`
- **Change:** Extend the enum:
  ```java
  public enum ExceptionClassification {
      TRANSIENT,
      PERMANENT,
      AUTH_FAILED,        // NEW — routes to onReauthRequired, not restart
      SHUTDOWN_SIGNAL
  }
  ```
  Also add `IntegrationAuthException extends RuntimeException` to `integration-api` as the canonical signal type.
- **Backward compat:** Adding an enum member is binary-compatible for callers using exhaustive switches *only if those switches throw on default* — flag in PR. Affects `ExceptionClassifier` in `com.homesynapse.integration.runtime`.
- **Effort:** ~80 LOC. Half a developer-day.
- **Requires AMD-55.**

### REC-44 — Add four lifecycle events (dot-namespaced)

- **Gap citation:** §3.2 #1, #2, #3, #4 (event surface)
- **Lesson source:** HA event bus emits `config_entry_changed`; OpenHAB emits `ThingStatusInfoChangedEvent`
- **Change:** Four new records in the sealed `IntegrationLifecycleEvent` hierarchy. **Dot-namespaced `@EventType` strings per the constraint:**
  ```java
  @EventType("integration.config_updated")
  public record IntegrationConfigUpdated(
      IntegrationId id, Instant timestamp,
      int configHashBefore, int configHashAfter,
      ConfigUpdateOutcome outcome
  ) implements IntegrationLifecycleEvent {}

  @EventType("integration.options_updated")
  public record IntegrationOptionsUpdated(
      IntegrationId id, Instant timestamp, Set<String> changedKeys
  ) implements IntegrationLifecycleEvent {}

  @EventType("integration.reauth_requested")
  public record IntegrationReauthRequested(
      IntegrationId id, Instant timestamp, String reason
  ) implements IntegrationLifecycleEvent {}

  @EventType("integration.migrated")
  public record IntegrationMigrated(
      IntegrationId id, Instant timestamp,
      int fromMajor, int fromMinor, int toMajor, int toMinor,
      boolean success
  ) implements IntegrationLifecycleEvent {}
  ```
  All four are **observability-only** — the supervisor emits them as side effects of state-changing operations.
- **Backward compat:** Additive. Existing underscore-named events (`integration_started`, `integration_stopped`) unchanged.
- **Effort:** ~220 LOC. 1 developer-day.
- **Requires AMD-56.**

### REC-45 — Add `CredentialRotator` service to `IntegrationContext`

- **Gap citation:** §3.2 #8
- **Lesson source:** HA reauth flow + `async_update_entry`
- **Change:** Add field to `IntegrationContext`:
  ```java
  CredentialRotator credentialRotator;  // @NotNull, gated by RequiredService.CREDENTIAL_ROTATOR
  ```
  Where:
  ```java
  public interface CredentialRotator {
      CompletableFuture<Void> rotate(IntegrationId id, SecureCredentialBundle bundle);
      SecureCredentialBundle current(IntegrationId id);
  }
  ```
  This **contradicts the existing "IntegrationContext has 10 fields" inventory** — adding `credentialRotator` makes it 11. Reviewer must decide whether to (a) accept the field-count change or (b) bundle this into a new `SecurityServices` aggregator field.
- **Backward compat:** Existing adapters ignoring the field are unaffected. M9 supervisor injects a real implementation; tests inject a stub.
- **Effort:** ~310 LOC including AES-GCM wrapper alignment with `ConfigurationService`. 2 developer-days.
- **Requires AMD-57. Cross-module: `configuration-module` exports the new `SecureCredentialBundle` type.**

### REC-46 — Add `softDependencies` to `IntegrationDescriptor`; modify Kahn (AMD-14)

- **Gap citation:** §3.2 #5
- **Lesson source:** HA `manifest.after_dependencies`
- **Change:** Add `Set<IntegrationId> softDependencies` to `IntegrationDescriptor` (default empty). Modify `IntegrationStartupOrderer` so that hard dependencies are edges in the DAG; soft dependencies are *advisory* — if the dependency is registered AND its start succeeds, the dependent waits; otherwise the dependent starts anyway. Soft-edge violations log at INFO, not WARN.
- **Backward compat:** Additive.
- **Effort:** ~190 LOC. 1.5 developer-days.
- **Requires AMD-58.**

### REC-47 — Capability events + `CapabilityPublisher` context service

- **Gap citation:** §3.2 #7
- **Lesson source:** Matter dynamic endpoint demo; HA entity registry; OpenHAB dynamic channels
- **Change:**
  ```java
  @EventType("integration.capability_added")
  public record CapabilityAdded(
      IntegrationId integration, DeviceId device,
      CapabilityId capability, Instant discoveredAt
  ) implements IntegrationLifecycleEvent {}

  @EventType("integration.capability_removed")
  public record CapabilityRemoved(
      IntegrationId integration, DeviceId device,
      CapabilityId capability, Instant lostAt,
      CapabilityRemovalReason reason  // FIRMWARE_DOWNGRADE | DEVICE_REPLACED | TRANSIENT_LOSS | UNREGISTERED
  ) implements IntegrationLifecycleEvent {}
  ```
  Adapters publish these via new context service `CapabilityPublisher`. State-changing (updates entity registry).
- **Backward compat:** Additive.
- **Effort:** ~250 LOC. **Requires AMD-59. Cross-module: `state-store` adds capability table; `event-model` exports new records.**

### REC-48 — `BackoffParameters` on `IntegrationDescriptor`

- **Gap citation:** §2.2(d)
- **Lesson source:** Apache Pekko `BackoffOnFailureOptions`; HA's empirically validated 5/10/20/40/80 schedule
- **Change:**
  ```java
  public record BackoffParameters(
      Duration minBackoff,        // default 5s
      Duration maxBackoff,        // default 80s
      double jitterFactor,        // default 0.2
      int maxConsecutiveBeforeSuspend  // default 5
  ) {}
  ```
  Add nullable field to `IntegrationDescriptor` (default applied if null).
- **Backward compat:** Additive on descriptor.
- **Effort:** ~120 LOC. **Requires AMD-60.**

### REC-49 — Per-integration `RestartIntensity` on `IntegrationDescriptor`

- **Gap citation:** §2.1(d)
- **Lesson source:** OTP `intensity` + `period`
- **Change:**
  ```java
  public record RestartIntensity(int maxRestarts, Duration window) {
      public static final RestartIntensity DEFAULT =
          new RestartIntensity(1, Duration.ofMinutes(1));  // OTP embedded-system guidance
  }
  ```
  Add nullable field to `IntegrationDescriptor`.
- **Backward compat:** Additive.
- **Effort:** ~90 LOC. **Requires AMD-61.**

### REC-50 — `isolationHint` reservation (no implementation)

- **Gap citation:** §1 verdict 6
- **Lesson source:** JNI memory leak failure mode (Pi 4/5)
- **Change:** `IsolationLevel { IN_JVM, RESERVED_SUBPROCESS }`. Field on descriptor. M9 supervisor rejects `RESERVED_SUBPROCESS` with `UnsupportedOperationException` and a clear log message. Field exists to avoid retroactive amendment when Phase 4 implements sub-process isolation.
- **Backward compat:** Additive.
- **Effort:** ~40 LOC. **Requires AMD-62.**

### REC-51 — Per-descriptor `plannedRestartTimeout`

- **Gap citation:** §1 verdict 8
- **Lesson source:** OpenHAB "initialize must be non-blocking" + HA's lack of fixed timeout
- **Change:** `@Nullable Duration plannedRestartTimeout` on `IntegrationDescriptor`; default fallback to `SupervisorParameters.defaultPlannedRestartTimeout` (60s). Zigbee/Matter descriptors override to 90s; HTTP-only cloud adapters override to 15s.
- **Backward compat:** Additive.
- **Effort:** ~60 LOC. **Requires AMD-63.**

### REC-52 — Internal supervisor types (Phase 3, no AMDs)

- **Change:** Inside `com.homesynapse.integration.runtime` (single flat package per module):
  - `RestartLedger` — `ConcurrentLinkedDeque<Instant>` per integration + `ReentrantLock`; methods `record(Instant)`, `countSince(Instant)`, `prune(Duration window)`.
  - `HealthFsm` — pure-function transition table; no I/O, no locks.
  - `SupervisorVThreadRegistry` — `Map<IntegrationId, Thread>` of virtual threads currently running; manages join-with-timeout.
  - `PlannedRestartCoordinator` — tracks `IntegrationId → PlannedRestartContext` with command queue and availability-suppression flag.
  - `ReauthDispatcher` — translates `IntegrationAuthException` → invocation of `onReauthRequired` with bounded retry.
  - `ConfigUpdateApplier` — diffs old/new configs, decides RESTART vs APPLY_IN_PLACE based on `ConfigUpdateOutcome`.
  - `MigrationRunner` — invokes `adapter.migrate()`, persists new version on success.
  - `CapabilityChangeRouter` — dispatches `CapabilityAdded`/`CapabilityRemoved` to state-store.
- **Effort:** ~1400 LOC across eight types + tests. 4–6 developer-days. **No AMDs needed.**

---

## §5 Caveats and Open Questions

### §5.1 Source reliability notes

- The Instagit page describing HA's `ConfigEntry` internals references specific line numbers (e.g., "config_entries.py#L47-L66") that **may be stale** between HA releases. We cross-checked enum membership via the live `dev` branch and the primary-source fetch confirmed the eight-state enum.
- The `D-N91/home-assistant-global-health-score` repository is a third-party HACS integration, **not** an HA core feature. Treat its scoring weights as community consensus, not canonical.
- Erlang documentation is canonical for OTP semantics; the BlackBerry-mirrored `supervisor.erl` is a snapshot of OTP at one point in time, not the live OTP master.
- The Akka 2.5 docs (legacy untyped supervision) describe `BackoffSupervisor` differently from the typed `BackoffSupervisorStrategy`. REC-48 references the *typed* API.
- The `StructuredTaskScope` status was verified against JEP 525 directly; informal community claims that "StructuredTaskScope is stable in JDK 21" are wrong.

### §5.2 Unresolved tensions between platforms

| Tension | HA position | OpenHAB position | HomeSynapse resolution |
|---|---|---|---|
| Does config update restart the integration? | YES (`async_reload` after `async_update_entry`) | NO by default (`handleConfigurationUpdate` is in-place; default `thingUpdated` *does* dispose+init) | **Mixed.** `onConfigUpdated` returns `ConfigUpdateOutcome` — adapter chooses APPLY_IN_PLACE or RESTART_REQUIRED. |
| Is the FSM exception-driven or signal-driven? | Exception-driven (`ConfigEntryNotReady` etc.) | Signal-driven (`updateStatus(ThingStatus, detail)`) | **Both.** Exception classification (REC-43) drives transitions; supervisor sets `HealthDetail` from the exception type. |
| Where does "config validation failed at startup" land? | `SETUP_ERROR` (recoverable=True in HA's flag) | `OFFLINE` + `CONFIGURATION_ERROR` | **`FAILED` with `HealthDetail.CONFIGURATION_ERROR`** — non-recoverable until user edits config. |
| Where does "config valid but device unreachable at startup" land? | `SETUP_RETRY` (recoverable=True, exponential backoff) | `OFFLINE` + `COMMUNICATION_ERROR` + auto-retry | **`SUSPENDED` with `HealthDetail.COMMUNICATION_ERROR`** + backoff per REC-48. |

### §5.3 Questions requiring empirical validation (spike/prototype)

1. **Are the health-score weights (0.30/0.20/0.15/0.20/0.15) load-bearing?** Run a 72-hour soak test on a Pi 5 with a synthetic adapter that toggles each input dimension and observe whether FSM transitions correlate with operator-meaningful incidents. If the score is mostly redundant with `errorRate` alone, simplify.
2. **What is the actual JNI / native-memory footprint of zigbee2mqtt-style native binaries on Pi 4 (1GB) vs Pi 5 (4GB)?** Determines whether REC-50's `RESERVED_SUBPROCESS` becomes urgent.
3. **Does virtual-thread pinning matter for adapter workloads?** JDBC carrier-pinning is documented (AMD-26/27 handles it). MQTT clients (Paho), HTTP clients (`java.net.http`) — measure pinning under realistic load.
4. **Is HA's `5/10/20/40/80s` the right schedule for HomeSynapse?** HA's empirical evidence is from cloud APIs. Local Zigbee adapter failures cluster differently. A/B test HA's schedule vs a flatter `10/15/20/30/45s` schedule.
5. **Does the `ConfigEntryState.recoverable` flag map cleanly to HomeSynapse's `FAILED`?** HA marks `FAILED_UNLOAD` and `MIGRATION_ERROR` as non-recoverable. Confirm the mapping in code review.

### §5.4 Constraint violations / inventory contradictions

- **REC-45 (CredentialRotator)** increases `IntegrationContext` from 10 fields to 11. The brief explicitly states "10 fields." Reviewer must choose: (a) accept 11, (b) wrap multiple security services in one `SecurityServices` aggregator field, (c) defer REC-45 to Phase 4 (rejected — reauth is M4-blocking per §1 verdict 5).
- **REC-42** changes `IntegrationHealthRecord` constructor signature. Confirm the 22-type inventory in `integration-api` accommodates the modified record without a fresh type allocation.
- All new events use **dot-namespaced** `@EventType` strings per the constraint. Existing `integration_started` / `integration_stopped` remain underscore.

---

## §6 Appendix: Sources

### Erlang/OTP
- `https://www.erlang.org/doc/system/sup_princ.html` — canonical supervisor behaviour
- `https://www.erlang.org/doc/man/supervisor` — `supervisor` man page
- `https://www.erlang.org/doc/apps/stdlib/supervisor.html` — `sup_flags()` record
- `https://github.com/blackberry/Erlang-OTP/blob/master/lib/stdlib/src/supervisor.erl` — reference impl of `add_restart`/`inPeriod`
- `https://medium.com/erlang-battleground/the-extinction-of-the-dodos-otp-style-f421f9de4275` — pathological-case writeup
- `https://hexdocs.pm/gleam_otp/gleam/otp/static_supervisor.html` — Gleam wrapper documenting the same parameters

### Akka / Pekko
- `https://doc.akka.io/japi/akka-core/current//akka/actor/typed/SupervisorStrategy.html` — typed SupervisorStrategy
- `https://doc.akka.io/japi/akka-core/current//akka/actor/typed/BackoffSupervisorStrategy.html` — typed BackoffSupervisorStrategy
- `https://pekko.apache.org/api/pekko/current/org/apache/pekko/pattern/Backoff$.html` — Pekko 1.1.4 Backoff options
- `https://nightlies.apache.org/pekko/docs/pekko/1.0.0/docs/fault-tolerance.html` — Classic fault tolerance
- `https://pekko.apache.org/docs/pekko/1.0/supervision-classic.html` — Classic supervision
- `https://github.com/akka/akka/blob/main/akka-actor-typed/src/main/scala/akka/actor/typed/SupervisorStrategy.scala` — typed source

### Home Assistant
- `https://github.com/home-assistant/core/blob/dev/homeassistant/config_entries.py` — `ConfigEntryState`, setup-retry math
- `https://developers.home-assistant.io/docs/config_entries_index/` — ConfigEntry lifecycle
- `https://developers.home-assistant.io/docs/integration_setup_failures/` — `ConfigEntryNotReady`, `ConfigEntryAuthFailed`, `ConfigEntryError`
- `https://developers.home-assistant.io/docs/config_entries_config_flow_handler/` — `async_migrate_entry`
- `https://developers.home-assistant.io/blog/2024/11/04/reauth-reconfigure-entry-id/` — reauth/reconfigure linking
- `https://developers.home-assistant.io/blog/2025/11/17/retry-after-update-failed/` — DataUpdateCoordinator `retry_after`
- `https://developers.home-assistant.io/docs/creating_integration_manifest/` — `after_dependencies` semantics
- `https://github.com/home-assistant/core/pull/138522` — UNLOAD_IN_PROGRESS / FAILED_UNLOAD addition
- `https://github.com/home-assistant/core/pull/20888/files` — original migration PR
- `https://github.com/home-assistant/core/issues/67855` — "Sense reauth is triggering hundreds of time per minute"

### OpenHAB
- `https://www.openhab.org/docs/developer/bindings/` — binding developer doc; lifecycle, bridge-before-thing
- `https://www.openhab.org/javadoc/latest/org/openhab/core/thing/binding/thinghandler` — ThingHandler interface
- `https://www.openhab.org/javadoc/latest/org/openhab/core/thing/binding/basethinghandler` — BaseThingHandler
- `https://www.openhab.org/javadoc/latest/org/openhab/core/thing/binding/basebridgehandler` — BaseBridgeHandler + childHandlerInitialized
- `https://www.openhab.org/javadoc/latest/org/openhab/core/thing/thingstatus` — ThingStatus enum
- `https://www.openhab.org/javadoc/latest/org/openhab/core/thing/thingstatusdetail` — full ThingStatusDetail list
- `https://www.openhab.org/docs/concepts/things.html` — framework- vs binding-set statuses
- `https://github.com/openhab/openhab-core/issues/1326` — "Illegal status INITIALIZING" enforcement
- `https://github.com/eclipse-archived/smarthome/issues/4074` — bridgeStatusChanged detail loss

### Eclipse Kura / OSGi DS
- `https://liferay.dev/b/revisiting-osgi-ds-annotations` — `@Activate` / `@Deactivate` / `@Modified` semantics
- `https://download.eclipse.org/kura/docs/api/3.0.0/apidocs/org/eclipse/kura/configuration/ConfigurationService.html`
- `https://deepwiki.com/eclipse-kura/kura/4-configuration-management` — snapshot/rollback

### Android
- `https://developer.android.com/develop/background-work/services` — Service lifecycle, START_STICKY
- `https://developer.android.com/guide/components/activities/activity-lifecycle` — activity-vs-service contrast

### Matter
- `https://project-chip.github.io/connectedhomeip-doc/examples/bridge-app/linux/README.html` — bridge-app dynamic endpoint demo
- `https://github.com/espressif/esp-matter/issues/1644` — Reachable attribute mandatory but missing

### Loom / virtual threads
- `https://cr.openjdk.org/~rpressler/loom/loom/sol1_part2.html` — Ron Pressler, State of Loom Part 2
- `https://developers.redhat.com/articles/2023/10/03/beyond-loom-weaving-new-concurrency-patterns` — vthread patterns
- `https://openjdk.org/jeps/525` — JEP 525, Structured Concurrency sixth preview (JDK 26)
- `https://inside.java/2025/02/22/devoxxbelgium-loom-next/` — pinning update

### Health-aggregation prior art
- `https://github.com/D-N91/home-assistant-global-health-score` — HAGHS (third-party HACS, not core HA)

---

## §7 Code-Level Implications

### §7.1 IntegrationContext field additions / changes

| Field | Type | Nullability | RequiredService gate | AMD |
|---|---|---|---|---|
| `credentialRotator` | `CredentialRotator` | @NotNull | `RequiredService.CREDENTIAL_ROTATOR` | **AMD-57** |
| `capabilityPublisher` | `CapabilityPublisher` | @NotNull | `RequiredService.CAPABILITY_PUBLISHER` | included with AMD-59 |

Net: context grows from **10 → 12 fields**. **Explicit contradiction with brief: brief states "10 fields"** — central trade-off the reviewer must arbitrate. Alternative: wrap both in a `SecurityAndDiscoveryServices` aggregator, keeping field count at 11.

### §7.2 IntegrationAdapter interface additions

| Method | Default? | Throws | AMD |
|---|---|---|---|
| `onConfigUpdated(IntegrationConfig oldConfig, IntegrationConfig newConfig)` | `default` → `RESTART_REQUIRED` | `IntegrationConfigException` | AMD-53 |
| `onOptionsUpdated(IntegrationOptions newOptions)` | `default` → no-op | — | AMD-53 |
| `onReauthRequired(ReauthContext ctx)` | `default` → `UNSUPPORTED` | — | AMD-53 |
| `migrate(int fromMajor, int fromMinor, int toMajor, int toMinor, IntegrationConfig oldConfig)` | `default` → `fromMajor == toMajor` | `IntegrationMigrationException` | AMD-53 |

All defaults preserve current behavior. Adapters opting in override one or more.

### §7.3 IntegrationLifecycleEvent sealed hierarchy additions

| Record | @EventType | Fields | State-changing? |
|---|---|---|---|
| `IntegrationConfigUpdated` | `"integration.config_updated"` | id, ts, hashBefore, hashAfter, outcome | observability only |
| `IntegrationOptionsUpdated` | `"integration.options_updated"` | id, ts, changedKeys | observability only |
| `IntegrationReauthRequested` | `"integration.reauth_requested"` | id, ts, reason | observability only |
| `IntegrationReauthCompleted` | `"integration.reauth_completed"` | id, ts, success | observability only |
| `IntegrationMigrated` | `"integration.migrated"` | id, ts, fromMajor, fromMinor, toMajor, toMinor, success | observability only |
| `CapabilityAdded` | `"integration.capability_added"` | integration, device, capability, ts | state-changing (entity registry) |
| `CapabilityRemoved` | `"integration.capability_removed"` | integration, device, capability, ts, reason | state-changing (entity registry) |

All seven preserve existing underscore events (`integration_started`, `integration_stopped`).

### §7.4 IntegrationDescriptor field additions

| Field | Type | Default | AMD |
|---|---|---|---|
| `softDependencies` | `Set<IntegrationId>` | `Set.of()` | AMD-58 |
| `backoff` | `@Nullable BackoffParameters` | `null` → use supervisor default | AMD-60 |
| `restartIntensity` | `@Nullable RestartIntensity` | `null` → `(1, 60s)` per OTP embedded guidance | AMD-61 |
| `isolationHint` | `IsolationLevel` | `IN_JVM` | AMD-62 |
| `plannedRestartTimeout` | `@Nullable Duration` | `null` → 60s default | AMD-63 |
| `configSchemaMajor` | `int` | `1` | AMD-53 (for migrate) |
| `configSchemaMinor` | `int` | `0` | AMD-53 |

### §7.5 HealthParameters field additions

| Field | Type | Default | Rationale |
|---|---|---|---|
| `degradedThresholds` | `Map<HealthDimension, Double>` (advisory) | empty | Per §3.3: individual thresholds drive transitions, not the composite |

The weighted-score formula stays as-is per §3.3. REC-42's `HealthDetail` lives on `IntegrationHealthRecord`, not `HealthParameters`.

### §7.6 New supervisor-internal types (`com.homesynapse.integration.runtime`, Phase 3, no AMDs)

```
com.homesynapse.integration.runtime
├── RestartLedger                  // per-integration timestamp deque + ReentrantLock
├── HealthFsm                       // pure-function transition table
├── SupervisorVThreadRegistry      // virtual thread per integration, join-with-timeout
├── PlannedRestartCoordinator      // command queue + availability suppression
├── ReauthDispatcher                // routes IntegrationAuthException to onReauthRequired
├── ConfigUpdateApplier             // diff old/new configs, RESTART vs APPLY_IN_PLACE
├── MigrationRunner                 // invokes adapter.migrate(), persists version on success
└── CapabilityChangeRouter          // dispatches CapabilityAdded/Removed to state-store
```

Approximately 1400 LOC across the eight types. Single flat package per module, per the constraint.

### §7.7 Cross-module impacts

| Module | Change | LOC |
|---|---|---|
| `event-model` | New records (REC-44, REC-47). Sealed hierarchy gains 7 cases. | ~250 |
| `state-store` | New `capability` table per REC-47. Migration script needed. SQLite WAL schema bump. | ~180 + migration |
| `configuration-module` | Exports `SecureCredentialBundle` type (REC-45). AES-GCM helper aligned with existing secret storage. | ~120 |
| `integration-api` | All four hook signatures + 5 new outcome types/enums + 7 new event records. 22-type inventory grows. | ~600 |
| `integration-runtime` | Eight new internal types per §7.6. | ~1400 |
| `supervisor-module` (M9) | Wires `ReauthDispatcher`, `ConfigUpdateApplier`, `MigrationRunner`. | ~400 |

### §7.8 JPMS module-info changes

`integration-api/module-info.java`:
```java
module com.homesynapse.integration.api {
    requires transitive com.homesynapse.event.model;
    requires transitive com.homesynapse.configuration;   // for SecureCredentialBundle
    exports com.homesynapse.integration.api;
}
```

`integration-runtime/module-info.java`:
```java
module com.homesynapse.integration.runtime {
    requires com.homesynapse.integration.api;
    requires com.homesynapse.event.model;
    requires com.homesynapse.state.store;
    requires com.homesynapse.configuration;
    exports com.homesynapse.integration.runtime to com.homesynapse.bootstrap;  // qualified
}
```

`state-store/module-info.java` gains capability table exports. `configuration-module/module-info.java` adds `exports com.homesynapse.configuration.credential` for `SecureCredentialBundle` and `CredentialRotator`.

**No new modules required.** All changes are within the existing 19-module Gradle JPMS topology. Per DECIDE-04, no `ServiceLoader` is used; supervisor wiring is explicit constructor injection from the bootstrap module.

---

*End of Research 6.*