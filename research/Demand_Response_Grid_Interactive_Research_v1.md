# Demand Response & Grid-Interactive Buildings: Research Artifact

**Document type:** Research artifact — engineering analysis
**Status:** Complete
**Date:** 2026-03-17
**Scope:** Protocol requirements, orchestration patterns, and gap analysis for demand response integration with the HomeSynapse automation engine
**Author:** PM
**Audience:** NexSys Grid product planning, Automation Engine Tier 2+ design
**Feeds:** INV-EI-02 (Grid-Interactive by Design), INV-EI-01 (Energy as First-Class Domain), NexSys Grid product viability assessment

---

## 0. Executive Summary

This research evaluates whether HomeSynapse's event-sourced automation engine can serve as the orchestration layer for demand response (DR) events, or whether a dedicated orchestration primitive is needed. The analysis covers three protocol families (OpenADR 3.0, CTA-2045, utility-specific programs), multi-device coordination patterns from four commercial systems, and the latency/reliability requirements that DR programs impose.

**Key finding:** The HomeSynapse automation engine's existing TCA model with sequential actions, `wait_for`, and `condition_branch` can handle the common DR pattern — receive signal, evaluate conditions, execute load management — for **incentive-based and slow DR programs** (response windows of 10–30+ minutes). However, the engine **cannot serve as the orchestration layer** for **coordinated multi-device DR responses** that require dependency-ordered command sequences with rollback semantics, atomic multi-device state transitions, or sub-second response times for ancillary services. These patterns require a dedicated orchestration primitive.

**Recommendation:** Build Tier 1 DR support on the existing automation engine. Introduce a compound command sequence primitive (a new action type, not a new subsystem) for Tier 2+ when multi-device orchestration and OpenADR 3.0 VEN compliance are implemented. The falsifiability criteria and threshold for introducing the dedicated primitive are specified in §7.

---

## 1. Protocol Analysis

### 1.1 OpenADR 3.0 — Virtual End Node (VEN) Requirements

OpenADR 3.0 (released 2023–2024) is the successor to OpenADR 2.0b. It modernizes the protocol stack while preserving the VTN-VEN (Virtual Top Node — Virtual End Node) architecture.

**Protocol architecture.** OpenADR 3.0 replaces the SOAP/XML transport of 2.0b with RESTful APIs using JSON payloads. Authentication uses OAuth 2.0 with JWT tokens over TLS. This is significant for HomeSynapse: the protocol stack is now implementable with standard Java HTTP client libraries (java.net.http) and Jackson JSON serialization (LTD-08) — no SOAP library dependency needed.

**VEN requirements.** A certified VEN must: maintain persistent registration with a VTN; receive and acknowledge event notifications; report resource status at configured intervals; support multiple simultaneous program enrollments (a 3.0 improvement — 2.0b required separate event streams per program). Certification requires interoperability testing with certified VTNs through the OpenADR Alliance test lab.

**Signal types relevant to residential DR:**

| Signal Type | Semantics | HomeSynapse Mapping |
|---|---|---|
| Pricing signals | Time-varying energy prices with intervals. Can include export prices and marginal GHG intensity signals. | Ingest as `grid_signal_received` events. Automation triggers on price thresholds or rate changes. Maps to INV-EI-03 carbon-aware scheduling. |
| Direct load control | Utility requests specific load reduction. VEN acknowledges and executes. | Ingest as `grid_signal_received` with `signal_type: "load_control"`. Automation executes pre-configured load shedding sequence. |
| Capacity bidding | VEN declares available curtailable capacity. Utility dispatches against declared capacity. | Requires state aggregation across devices to calculate available capacity. Post-MVP — needs energy metering integration. |

**Response time requirements.** OpenADR 3.0 itself does not specify sub-second response times. The VEN must acknowledge event receipt promptly (HTTP response), but the actual load management response window is defined by the enrolled utility program, not the protocol. Typical windows: 10 minutes (fast DR), 30 minutes (standard DR). The protocol's REST architecture means signal delivery latency is dominated by network round-trip, not protocol overhead — typically under 2 seconds for a well-connected VEN.

**Confirmation semantics.** The VEN reports its response status to the VTN via REST endpoints. Three response states: opted-in (will comply), opted-out (will not comply), and reporting (actual telemetry). Reporting intervals are program-configurable. Historical reporting (metered data delivered hours after the event) is the common pattern for residential programs and is sufficient for compliance validation.

**HomeSynapse alignment.** A Raspberry Pi 5 running HomeSynapse can implement a VEN using the REST API framework already specified in Doc 09 (Javalin, LTD-16). The VEN would be an integration adapter per Doc 05's integration model — it receives grid signals via REST callbacks and produces `grid_signal_received` events on the event bus. This is architecturally clean: the VEN adapter is an inbound integration, not a core subsystem modification.

### 1.2 CTA-2045 — Device-Level Command Protocol

CTA-2045 (ANSI/CTA-2045-B) is a modular communication interface standard for demand-responsive appliances. It defines the physical socket and command protocol through which a utility or home energy management system communicates with individual appliances.

**Physical interface.** RS-485 data link with AC line voltage provision. The communication module is a pluggable cartridge (similar in concept to a USB dongle) that connects to a CTA-2045 port on the appliance.

**Command semantics by device type:**

| Device Type | Key Commands | Response Pattern |
|---|---|---|
| Water heater | Load Up (immediate activation), Shed (curtail), Critical Peak (emergency shed) | Command acknowledgment + device status response. Load Up executes immediately except when post-heating cycle. |
| HVAC | Operating Mode, Setpoint Adjustment, Shed (reduce output) | Command acknowledgment. HVAC response is gradual (thermal inertia). |
| EV charger | Charge Rate Adjustment, Shed, Load Up | Command acknowledgment. Charge rate changes take effect within one charging cycle. |
| Battery storage | Charge/Discharge mode, Power Limit, SOC Target | Command acknowledgment + SOC reporting. |

**Latency characteristics.** RS-485 serial communication at typical baud rates (9.6–115.2 kbps) delivers subsecond command delivery. The appliance response time varies by device type — a water heater element turns on in seconds, while HVAC adjustments propagate over minutes due to thermal inertia. CTA-2045 does not specify millisecond-level response time requirements because the appliances themselves are the limiting factor, not the protocol.

**HomeSynapse alignment.** CTA-2045 devices would be reached through an integration adapter that communicates via the RS-485 interface (likely via a USB-to-RS-485 converter on the Pi). The adapter translates CTA-2045 commands to HomeSynapse command events and CTA-2045 status reports to state events. This follows the same integration model as the Zigbee adapter (Doc 08) — protocol-specific communication in the adapter, standard events on the bus.

**Relationship to OpenADR.** In a complete DR stack, OpenADR 3.0 carries the top-level grid signal (utility → home), and CTA-2045 carries the device-level command (home controller → appliance). The HEMS (HomeSynapse, in our case) bridges the two: it receives an OpenADR signal, evaluates it through the automation engine, and translates the response into CTA-2045 commands for individual appliances. EPRI has published a protocol mapping guide for OpenADR 2.0 → CTA-2045-A; the 3.0 equivalent simplifies this mapping due to the shared JSON/REST approach.

### 1.3 Utility DR Program Analysis

Three programs were analyzed to establish patterns in response time, penalty structure, and confirmation requirements.

#### ERCOT Emergency Response Service (Texas)

ERCOT's ERS is a wholesale-level DR program where aggregated resources (including residential participants through aggregators) provide emergency curtailment capacity.

**Program structure.** Two response tiers: ERS-10 (10-minute response) and ERS-30 (30-minute response). Four service types crossing weather-sensitivity and response-time axes. Standard contract terms (SCTs) cover 4-month high-risk periods (summer/winter) and 2-month shoulder seasons.

**Performance requirements.** Minimum 100 kW curtailable load (aggregated across participants). 15-minute interval metering (IDR or smart meter). Event duration up to 4 hours per event, maximum 4 unscheduled events per contract period, maximum 22 hours annual curtailment.

**Penalty structure.** Non-performance consequences escalate: first-tier penalties reduce compensation; persistent failures result in 6-month suspension from program. ERS-10 has a carve-out for Responsive Reserve Service dispatch — no out-of-pocket penalties for under-performance in fast-response scenarios.

**Implications for HomeSynapse.** The 10-minute ERS-10 window is the most demanding residential-accessible DR tier. A HomeSynapse automation with a grid signal trigger, condition evaluation (check current load, battery SOC, occupancy), and multi-device command sequence needs to complete within this window. The existing automation engine can handle this — trigger evaluation (< 10 ms), condition evaluation (< 5 ms), and sequential command dispatch are well within 10 minutes even with confirmation tracking. The constraint is not automation execution speed — it is the physical device response time and the number of devices that must be coordinated.

#### California ISO (CAISO) Demand Response

CAISO integrates DR resources into the wholesale electricity market alongside traditional generation.

**Response categories.** Fast DR: resources that can fully respond within 20 minutes post-contingency. Slow DR: resources requiring 20–30+ minutes. SCE participants elect 15 or 30-minute response windows per event. Long-start resources: 255+ minutes.

**Performance metrics.** Sustained participation during contract periods. Resource adequacy (RA) credit requires reliable curtailment during declared availability windows. Real-time telemetry was historically required but has been relaxed — meter data delivered hours post-event is acceptable for most programs.

**Implications for HomeSynapse.** CAISO's tiered response model maps naturally to automation priority and concurrency modes. A "fast DR" automation at priority 100 with `mode: single` ensures it takes precedence over conflicting automations. The 15–30 minute response window provides ample time for the existing automation engine to evaluate conditions and dispatch commands.

#### ConEd SmartCharge (New York)

ConEd SmartCharge is an incentive-based program, not a mandatory DR dispatch.

**Program structure.** Enrollment reward ($25 per vehicle/charger after 3 months). Off-peak charging incentive ($0.10/kWh for midnight–8 AM charging). Peak avoidance incentive ($35/month per vehicle/charger, June–September, avoid 2–6 PM weekdays).

**Confirmation requirements.** Behavioral — charging data is metered and reported. No real-time dispatch signal. Compliance is measured by charging patterns over the billing period, not per-event response.

**Implications for HomeSynapse.** Incentive programs like SmartCharge are the simplest DR integration: the automation engine evaluates time-of-use conditions and adjusts EV charging schedules accordingly. No external signal ingestion needed — just time-based triggers (Tier 2) and rate schedule data. This is fully addressable with the existing automation engine plus scheduled triggers.

---

## 2. Latency and Reliability Requirements

### 2.1 Response Time Taxonomy

| DR Category | Response Window | Signal Delivery | Typical Duration | HomeSynapse Automation Feasibility |
|---|---|---|---|---|
| Ancillary services (frequency regulation) | Seconds (2–4 sec) | Direct control signal | Continuous | **Not feasible.** Requires dedicated hardware controller (e.g., battery inverter firmware). Beyond any HEMS scope. |
| Fast DR (ERCOT ERS-10, CAISO fast) | 10 minutes | REST/webhook | 1–4 hours | **Feasible with existing engine.** 10 minutes provides ample time for trigger → condition → multi-device command sequence. |
| Standard DR (ERCOT ERS-30, SCE 30-min) | 30 minutes | REST/webhook, day-ahead notification | 1–6 hours | **Fully feasible.** Comfortable margin for any automation complexity. |
| Incentive/behavioral (ConEd SmartCharge, TOU programs) | Hours/day-ahead | Schedule-based, no real-time signal | Season-long | **Fully feasible.** Time-based triggers + rate schedule evaluation. |

### 2.2 Failure Consequences

**What happens when a DR response fails:**

The failure consequences vary dramatically by program tier. For incentive programs (ConEd SmartCharge), failure means reduced incentive payments — no penalty beyond the opportunity cost. For contracted capacity programs (ERCOT ERS), failure escalates: first failure reduces compensation for that event; repeated failures result in 6-month program suspension and potential financial penalties. For resource adequacy programs (CAISO), persistent non-performance can result in loss of RA credit, which has significant financial implications for aggregators.

**Key insight for HomeSynapse:** The failure penalty asymmetry means that DR automation reliability is more important than DR automation sophistication. A simple, reliable "shed all non-essential loads" automation that executes every time is more valuable than a sophisticated optimization that sometimes fails to execute. The automation engine's health monitoring, auto-disable on repeated failure, and command confirmation tracking (Pending Command Ledger) provide the reliability foundation that DR programs require.

### 2.3 Confirmation Semantics

DR programs typically require two levels of confirmation:

1. **Signal acknowledgment.** The VEN confirms receipt of the DR event signal. For OpenADR 3.0, this is an HTTP response to the event notification. Latency requirement: seconds (HTTP round-trip). HomeSynapse alignment: the OpenADR integration adapter sends the HTTP acknowledgment before producing the internal event. This is standard adapter behavior — no automation engine involvement.

2. **Performance reporting.** The VEN reports its actual load reduction after the event. Two patterns exist: real-time telemetry (meter readings during the event) and settlement reporting (metered data hours/days post-event). Most residential programs accept settlement reporting. HomeSynapse alignment: an energy metering integration reports consumption data; an OpenADR reporting adapter aggregates and transmits to the VTN. This is a data pipeline, not an orchestration problem.

**Neither confirmation level requires sub-second automation engine response.** The tight latency requirement is on the signal acknowledgment (adapter-level, pre-automation), not on the load management execution.

---

## 3. Multi-Device Orchestration Patterns

### 3.1 Observed Patterns from Commercial Systems

Four commercial systems were analyzed for their multi-device DR coordination patterns.

**Tesla Powerwall.** The Powerwall system coordinates solar inverter output, battery charge/discharge, and household load. However, coordination is tightly coupled within Tesla's proprietary firmware — the Powerwall gateway makes millisecond-level decisions about power flow based on real-time CT measurements. When paired with non-Tesla solar (Enphase, SolarEdge), coordination degrades: the Powerwall measures combined AC generation via CTs but has no bidirectional awareness of the third-party inverter's state or intent. This is a firmware-level coordination problem, not a HEMS orchestration problem.

**SolarEdge StorEdge.** SolarEdge implements demand response through a DRED (Demand Response Enabling Device) interface that connects to the inverter's Power Reduction Interface. The DRED supports up to 16 control states, each defining an AC output power limit (0–100%) and power factor. This is single-device, direct-control DR — the inverter responds to the DRED signal, and the battery follows the inverter. No multi-device coordination logic exists at the HEMS level.

**Enphase IQ System.** Enphase distributes control across IQ8 microinverters coordinated by a centralized IQ Gateway. DR participation is managed at the gateway level. The gateway can participate in utility programs while maintaining grid-tie operation. Multi-device coordination (microinverters + battery modules) is internal to the Enphase ecosystem.

**Span Panel.** Span implements multi-device orchestration at the circuit-breaker level. The panel can prioritize circuits, throttle low-priority loads to free capacity for high-priority loads (e.g., EV charging), and participate in utility DR programs. Orchestration is panel-firmware-level: the Span controller makes real-time decisions about circuit power allocation.

### 3.2 Emergent Orchestration Patterns

Across these systems, three multi-device orchestration patterns emerge:

**Pattern 1: Priority-based load shedding.** When a DR signal arrives, shed loads in priority order: discretionary loads first (pool pumps, EV charging), then comfort loads (HVAC setpoint adjustment), then essential loads last (refrigeration, medical equipment, never shed). This is a sequential command pattern with dependency ordering.

**Pattern 2: Battery-first response.** When a DR signal arrives, first switch battery to discharge mode. If battery SOC is insufficient to cover the entire event, additionally shed loads. If solar production is available, redirect to grid export. This pattern has a dependency chain: battery state determines whether load shedding is needed.

**Pattern 3: Coordinated ramp.** For capacity bidding programs, the VEN declares available capacity and then must deliver exactly that amount when dispatched. This requires coordinated adjustment across multiple devices to hit a target aggregate power reduction. This is the most complex pattern — it requires real-time metering feedback and iterative adjustment.

### 3.3 Dependency Ordering and Rollback

**Dependency ordering.** In Pattern 2, the command sequence has explicit dependencies:

1. Query battery SOC → determines subsequent steps
2. Switch battery to discharge → wait for acknowledgment
3. If SOC < threshold: shed HVAC by raising setpoint → wait for acknowledgment
4. If SOC < lower threshold: pause EV charging → wait for acknowledgment
5. Report aggregate response to VTN

Steps 3 and 4 depend on step 2's outcome. Step 5 depends on all preceding steps completing (or failing with known status).

**Rollback semantics.** When a DR event ends, the system must restore pre-event state. Rollback requires:

- Remembering pre-event device states (battery mode, HVAC setpoint, EV charging state)
- Restoring in reverse dependency order (resume EV charging → restore HVAC setpoint → switch battery back to normal mode)
- Handling partial rollback: if EV was manually unplugged during the DR event, skip that rollback step

**Key observation.** Existing commercial systems handle rollback poorly or not at all. Tesla's Powerwall firmware manages battery transitions but does not coordinate HVAC and EV rollback. Span Panel can restore circuit priorities but does not track pre-event device states across non-Span devices. There is no industry-standard rollback protocol. This is an opportunity for HomeSynapse to provide genuine differentiation.

---

## 4. Gap Analysis: HomeSynapse Automation Engine vs. DR Orchestration Requirements

### 4.1 What the Existing Engine Can Handle

The automation engine's TCA model with sequential actions, `wait_for`, `condition_branch`, and the new `for_duration` trigger modifier (AMD-25) can implement:

| DR Pattern | Implementation | Feasibility |
|---|---|---|
| Simple load shedding (single device) | `state_change` trigger on grid signal → `command` action to shed device | Fully supported. |
| Priority-based load shedding (sequential) | Grid signal trigger → sequential `command` actions in priority order with `on_unavailable: warn` | Supported. Sequential action execution handles priority ordering. |
| Time-of-use optimization | `time` trigger (Tier 2) → `condition_branch` on rate schedule → adjust device setpoints | Supported once time triggers are implemented (Tier 2). |
| Battery-first with conditional shedding | Grid signal trigger → `command` (battery discharge) → `wait_for` (battery ack) → `condition_branch` (SOC check) → conditional load shedding | Supported. `wait_for` + `condition_branch` express the dependency chain. |
| DR event end (simple restore) | Grid signal "event ended" trigger → sequential `command` actions to restore pre-event states | Partially supported — requires pre-event state capture, which is not a current action type. |

### 4.2 What the Existing Engine Cannot Handle

| DR Pattern | Why It Fails | What's Needed |
|---|---|---|
| **Pre-event state capture** | No action type to "snapshot current state of devices X, Y, Z" for later rollback. The AMD-03 `StateSnapshot` is for condition evaluation, not for state preservation across automation runs. | A `capture_state` action type that stores device states in a named snapshot, and a `restore_state` action type that applies a previously captured snapshot. |
| **Coordinated ramp to target** | The engine executes actions sequentially. Adjusting 5 devices to hit an aggregate power reduction target requires iterative feedback: adjust, measure, adjust again. The `wait_for` action can wait for a condition, but it cannot adjust commands based on intermediate measurements. | A feedback loop primitive or an iterative action type that can read metering data and adjust subsequent commands. |
| **Guaranteed multi-device atomicity** | If command 3 of 5 fails (device offline), the engine continues or fails the Run. There is no mechanism to undo commands 1 and 2. The `on_unavailable` policy governs per-command behavior, not sequence-level rollback. | Compensating action semantics: if step N fails, execute a defined compensation sequence for steps 1..N-1. |
| **Sub-second response for ancillary services** | The automation engine's event processing pipeline adds 10–15 ms per event (trigger evaluation + condition + mode enforcement). For frequency regulation (2–4 second response), the pipeline overhead is acceptable, but the command confirmation loop (Pending Command Ledger timeout-based) is not — it is designed for 30-second confirmation, not sub-second. | Direct control path bypassing the automation engine. This is fundamentally a firmware/hardware controller responsibility, not a HEMS capability. |
| **Cross-automation coordination** | A DR response may require coordinating multiple automations (battery automation + HVAC automation + EV automation). The engine evaluates each automation independently — there is no mechanism to say "these three automations must execute as a coordinated unit." | An orchestration scope that groups related automations and sequences their execution with shared state. |

### 4.3 Gap Severity Assessment

| Gap | Severity | DR Programs Affected | When Needed |
|---|---|---|---|
| Pre-event state capture/restore | MEDIUM | All programs with event-end restoration | Tier 2 (any DR integration) |
| Coordinated ramp to target | LOW | Capacity bidding programs only | Tier 3+ (advanced grid services) |
| Multi-device atomicity/rollback | MEDIUM | Programs with multi-device responses | Tier 2 (when multi-device DR is implemented) |
| Sub-second response | N/A | Ancillary services (frequency regulation) | Never — this is hardware-controller scope |
| Cross-automation coordination | HIGH | Any multi-device DR response | Tier 2 (when multi-device DR is implemented) |

---

## 5. Existing Automation Engine Strengths for DR

The gap analysis should not obscure the significant strengths the existing engine brings to DR integration:

**Event-sourced audit trail.** Every DR response — from signal receipt to device commands to state confirmations — is recorded as an immutable event chain. This is exactly what utility reporting requires: a verifiable, timestamped record of what was done in response to each DR event. No commercial HEMS provides this level of DR response auditability.

**Causal chain tracing.** The `correlation_id` propagation from grid signal event → automation trigger → command issued → state confirmed creates a complete causal chain. For DR compliance reporting, this means the system can answer "show me everything that happened in response to DR event X" with a single query. This directly serves INV-EI-02's test criterion.

**Command confirmation tracking.** The Pending Command Ledger closes the intent-to-observation loop that other platforms leave open. For DR, this means the system knows which commands were actually confirmed by devices, not just which commands were dispatched. If the HVAC didn't actually change its setpoint, the system knows — and can report accurately to the utility.

**Deterministic replay.** If a DR event response is questioned (utility disputes the reported curtailment), the event log can be replayed to reconstruct exactly what happened, in what order, and why. This is a compliance advantage that no competing local-first platform offers.

**Local-first execution.** DR events often coincide with grid stress, which correlates with infrastructure failures — including internet outages. HomeSynapse executes DR automations locally without cloud dependency (INV-LF-01). A cloud-dependent HEMS that loses connectivity during a grid emergency is the worst possible failure mode for DR. HomeSynapse avoids it by design.

---

## 6. Architecture Options for Addressing the Gaps

### Option A: Extend the Existing Automation Engine (Recommended for Tier 2)

Add three new action types to the existing TCA model:

1. **`capture_state` action.** Captures current state of specified entities into a named snapshot stored in the Run's context. The snapshot is a `Map<EntityRef, Map<String, AttributeValue>>` persisted in the `automation_action_completed` event payload for observability.

2. **`restore_state` action.** Restores device states from a named snapshot captured earlier in the same Run (or in a referenced Run via `run_id`). Generates `command_issued` events for each entity whose current state differs from the snapshot. Skips entities whose state already matches (idempotent).

3. **`sequence` action (compound command sequence).** A new action type that wraps a list of actions with transactional semantics:
   - `on_failure: rollback` — execute compensation actions (defined inline) in reverse order
   - `on_failure: continue` — log failure and proceed (current behavior, compatible)
   - `on_failure: abort` — stop the sequence and fail the Run (current behavior for `on_unavailable: error`)

   The `sequence` action does not provide atomicity (commands are dispatched individually), but it provides compensating transactions — if step N fails, steps N-1..1 have their compensation actions executed. This is the "saga pattern" from distributed systems, applied to device orchestration.

**Cross-automation coordination** is addressed by a new automation configuration field: `group`. Automations in the same group are evaluated and executed as a unit when any automation in the group is triggered. The group shares a single Run context (state snapshots, dependency ordering). This is a configuration-level change — the RunManager treats a group as a single composite automation, not N independent automations.

**Advantages:** No new subsystem. No new event bus subscribers. Extends the existing engine with well-defined action types. Follows the established Phase 1→2→3 pipeline. The `sequence` action type naturally fits in the `ActionDefinition` sealed interface hierarchy.

**Disadvantages:** Complex automations become deeply nested YAML. The `sequence` + `capture_state` + `restore_state` pattern requires users to manually specify what would ideally be declarative ("respond to this DR event with these devices").

### Option B: Dedicated DR Orchestration Layer (Tier 3+)

Introduce a new subsystem (Doc 15: DR Orchestration Engine) that operates alongside the automation engine. The DR orchestrator would:

- Receive grid signals from the OpenADR integration adapter
- Evaluate available DR capacity by aggregating current device states
- Generate optimized command sequences based on device capabilities, user preferences, and program constraints
- Execute command sequences with rollback semantics
- Report compliance metrics to the VTN via the OpenADR adapter

This is a substantially larger scope: a new design document, new Phase 2 interfaces, new Phase 3 implementation, and new integration points with the automation engine, event bus, and device model.

**Advantages:** Clean separation of concerns. The automation engine remains simple (user-defined TCA automations). The DR orchestrator is a purpose-built engine for the specific problem. Users configure DR participation declaratively ("enroll these devices in this program with these constraints"), not procedurally (YAML automation definitions).

**Disadvantages:** New subsystem = new complexity. Requires design document, cross-audit, Phase 2, Phase 3. Interactions with the existing automation engine must be carefully specified (what happens when a user automation and a DR orchestration conflict?). This is minimum 3–4 sessions of design work before any implementation.

---

## 7. Recommendation

**Tier 2: Build on the existing automation engine.** Implement `capture_state`, `restore_state`, and `sequence` action types. Implement the `group` coordination mechanism. Implement the OpenADR 3.0 VEN integration adapter. This delivers basic DR participation (incentive programs, time-of-use optimization, simple load shedding) and advanced DR participation (multi-device coordination with rollback) using the engine users already understand.

**Tier 3+: Evaluate dedicated orchestration layer.** If the Tier 2 implementation reveals that the extended automation engine produces unacceptable user experience (too-complex YAML, insufficient optimization, reliability issues with the saga-pattern rollback), introduce the dedicated DR orchestration layer.

### Falsifiability Criteria for the Tier 3 Decision

The recommendation to extend the automation engine (not introduce a new subsystem) is falsified if **any** of the following are observed during Tier 2 implementation or production:

1. **Complexity threshold.** A representative DR automation (battery-first with conditional HVAC shedding and EV pause, with rollback) requires more than 60 lines of YAML. At that point, the declarative advantage of a purpose-built orchestrator outweighs the simplicity advantage of reusing the automation engine.

2. **Reliability threshold.** The saga-pattern rollback in the `sequence` action type fails to restore pre-event state in more than 5% of DR events during testing. This would indicate that compensating transactions are insufficient for multi-device state restoration and that a purpose-built state machine is needed.

3. **Performance threshold.** The total time from grid signal receipt to last device command dispatch exceeds 2 minutes for a 5-device DR response. This would leave insufficient margin for the 10-minute ERS-10 window after accounting for device response time.

4. **User feedback threshold.** During beta testing, more than 30% of users who attempt to configure a multi-device DR automation abandon the configuration process or require support. This would indicate that the YAML-based automation model is too complex for DR orchestration.

If any of these criteria are met, escalate to Nick for a go/no-go decision on dedicated DR orchestration (Doc 15).

---

## 8. Summary of Findings

### Protocol Requirements

| Protocol | Role | Integration Model | Latency Requirement | HomeSynapse Feasibility |
|---|---|---|---|---|
| OpenADR 3.0 | Grid → Home signal delivery | Integration adapter (REST, LTD-16 Javalin + java.net.http client) | Signal ack: seconds. Load response: program-defined (10–30 min). | High. Standard REST integration. |
| CTA-2045 | Home controller → Appliance commands | Integration adapter (RS-485 via USB converter) | Command delivery: subsecond. Appliance response: seconds to minutes. | High. Standard serial integration, same model as Zigbee. |
| Utility DR programs | Program-specific enrollment and reporting | Varies by program. Often aggregator-mediated. | Response: 10–30 minutes. Reporting: hours to days post-event. | High for incentive/standard programs. Medium for fast DR. |

### Orchestration Capability Assessment

| Capability | Current Engine | With Tier 2 Extensions | Dedicated Orchestrator |
|---|---|---|---|
| Single-device load shedding | Yes | Yes | Yes |
| Sequential multi-device shedding | Yes | Yes | Yes |
| Conditional shedding (dependency ordering) | Yes (`wait_for` + `condition_branch`) | Yes | Yes |
| State capture and rollback | No | Yes (`capture_state` + `restore_state`) | Yes |
| Compensating transactions | No | Yes (`sequence` with rollback) | Yes |
| Cross-automation coordination | No | Yes (`group` mechanism) | Yes |
| Coordinated ramp to target | No | Partial (iterative adjustment via `wait_for` loop) | Yes |
| Declarative DR participation | No | No (procedural YAML) | Yes |
| Sub-second response | No | No | No (hardware scope) |

### Revenue and Strategic Implications

The DR market opportunity (§12 of Architecture Invariants, INV-EI-02) is real: FERC data shows 33,272 MW of US wholesale DR capacity, and retail DR enrollment grew by 732,000 customers in a single year. No open-source, local-first platform implements OpenADR 3.0 for residential users. The first platform to offer auditable, event-sourced DR response tracking with local-first execution has a structural advantage that cloud-dependent competitors cannot match.

The recommended path — extend the automation engine for Tier 2, evaluate dedicated orchestration for Tier 3 — balances time-to-market (Tier 2 extensions ship with the automation engine, not a new subsystem) with capability ceiling (Tier 3 orchestrator addresses the advanced use cases if the automation engine proves insufficient).

---

## 9. Decisions Requiring Escalation

### Escalation to Nick

If this research reveals that a dedicated DR orchestration primitive is needed before Tier 2 can ship, it affects MVP scope. **Current assessment:** This is not the case. The automation engine extensions are sufficient for Tier 2 DR participation. The dedicated orchestrator is a Tier 3+ consideration with clear falsifiability criteria (§7). No MVP scope change is recommended.

### Escalation to Hivemind

**`for_duration` applicability to Tier 2 trigger types.** The brief flagged this for escalation. The DR research provides context: `for_duration` on a `presence` trigger ("fire when person is in zone for 10 minutes") is semantically valid and directly useful for energy optimization (occupancy-based HVAC control). `for_duration` on a `time` trigger is semantically dubious (it becomes a schedule offset, not a state-held pattern). `for_duration` on a `webhook` trigger (the OpenADR signal delivery mechanism) makes limited sense — grid signals are events, not states. Recommendation: apply `for_duration` to `presence` triggers when implemented; do not apply to `time` or `webhook` triggers.
