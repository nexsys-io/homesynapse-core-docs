# Matter Device Conformance Research Plan v1

**Document type:** Pre-Implementation Research  
**Owner:** Nick (NexSys Technologies)  
**Status:** ACTIVE — Pre-Phase 3  
**Created:** 2026-03-22  
**Audience:** Internal (NexSys engineering) + External (published report)

---

## 1. Strategic Objective

This research exists to answer one question: **Does the HomeSynapse integration architecture — designed and validated against Zigbee — accommodate Matter without structural rework?**

HomeSynapse ships Zigbee-first (MVP), with Matter as the post-MVP near-term priority (Architecture Invariants §16.6). The integration model is intentionally protocol-agnostic (INV-CE-04), and every protocol adapter is an integration, not a core subsystem (INV-CE-05). The Zigbee adapter (Doc 08) validates the abstract integration interfaces (`IntegrationFactory`, `IntegrationAdapter`, `IntegrationContext`, `CommandHandler`) against real hardware. Matter must validate the same interfaces against a fundamentally different protocol model.

The gap between the Matter specification and Matter device reality is well-documented anecdotally but has not been systematically catalogued from a **controller developer's perspective**. Platforms like Apple Home, Google Home, Alexa, and SmartThings each implement different subsets of the Matter specification, creating a per-ecosystem conformance matrix that no public resource currently provides in structured, developer-facing form.

This research produces three artifacts:

1. **Matter Device Conformance Database** — Structured, machine-readable data documenting per-device, per-controller conformance observations.
2. **Matter Conformance Reality Report** — A publishable, developer-facing document analyzing the spec-to-reality gap.
3. **HomeSynapse Matter Adapter Requirements Addendum** — Internal artifact translating findings into concrete requirements for the future Matter adapter, mapped to existing integration architecture surfaces.

### Strategic value

| Dimension | Value |
|---|---|
| **Architecture validation** | Confirms or identifies gaps in INV-CE-04, the `IntegrationAdapter` lifecycle model, `ExceptionClassification`, and the Pending Command Ledger's timeout assumptions |
| **Adapter design input** | Produces the equivalent of ZHA's "quirks" database: per-device behavioral data that the adapter layer must compensate for |
| **Technical credibility** | Positions NexSys as deeply informed about Matter realities before shipping a line of Matter code. Publishable content for developer community |
| **Competitive intelligence** | Maps which controller platforms are ahead/behind on Matter implementation, informing HomeSynapse's positioning |

---

## 2. Scope

### In scope

- Thread-based Matter devices (primary focus, 6–7 devices)
- WiFi-based Matter devices (comparison set, 2–3 devices)
- Five controller platforms: Apple Home, Google Home, Amazon Alexa, Samsung SmartThings, Home Assistant
- Commissioning behavior per device × controller combination
- Subscription/attribute reporting behavior observation
- Controller unavailability recovery behavior
- Cluster claim vs. cluster reality per device × controller
- Matter bridge path evaluation: rs-matter (Rust/Panama FFI) and CHIP SDK (C++/JNI)
- Device shopping list with pricing and sourcing (tiered)

### Out of scope

- Writing Matter adapter code (Phase 3+, post-Zigbee validation)
- Matter certification or compliance testing (we are testing as a controller consumer, not certifying)
- Bluetooth commissioning transport internals (we observe success/failure, not protocol traces)
- Thread mesh topology optimization (Thread is a transport layer; Matter is the application layer)
- GraalJS-based bridge paths (rejected: 40+ MB distribution size, violates minimal distribution principle per Web UI research)
- Python matter-server bridge (rejected: subprocess model breaks single-process architecture, violates INV-LF-01)
- Z-Wave (separate post-MVP track, not related to Matter research)
- Energy management clusters (Matter 1.2+ energy clusters are future work; focus on core device types first)

---

## 3. Architecture Surface Mapping

Every observation in this research must map back to a specific HomeSynapse integration architecture surface. This section defines those surfaces and the questions each observation should answer.

### 3.1 IntegrationAdapter Lifecycle (Doc 05 §8.4)

The Zigbee adapter lifecycle is: `initialize()` → `run()` → `close()`.

- `initialize()` — No external I/O (INV-RF-03). For Zigbee: load config, prepare state, register command handler.
- `run()` — Main processing loop. For Zigbee: open serial connection, form/resume network, process frames.
- `close()` — Resource cleanup. For Zigbee: close serial port, flush pending writes.

**Matter questions:**
- Does Matter commissioning (PASE/CASE handshake, fabric joining) fit within `run()`, or does it require a distinct lifecycle phase between `initialize()` and `run()`?
- How long does commissioning take per device? Per controller? Is it blocking or can it be async on a virtual thread?
- When a Matter device loses connectivity and reconnects, does the adapter need to re-commission or just re-establish the CASE session? This determines whether `ExceptionClassification.TRANSIENT` is appropriate or whether a reconnection sub-lifecycle is needed.

### 3.2 CommandHandler and Command Lifecycle (Doc 05 §8.6, Doc 07)

The 4-phase command lifecycle: `command_issued` → `command_dispatched` → `command_result` (success/failure/timeout).

- Zigbee: ZCL frame sent → ACK received → attribute report confirms state change.
- Matter: Invoke interaction → status response → subscription report confirms state change.

**Matter questions:**
- What is the observed latency from invoke to status response? From status response to subscription update?
- Do all devices that claim a cluster actually respond to invoke interactions on that cluster? (The Eve Energy / Alexa power monitoring loss suggests they don't.)
- What timeout values are realistic for the Pending Command Ledger's `command_confirmation_timed_out` event?
- Does the tolerance band model (Doc 02 Contract C5 — `Expectation` objects from capability definitions) work for Matter devices, or do Matter devices report state changes at different granularity than the command requested?

### 3.3 Event Pipeline — state_reported Flow (Doc 01, Doc 03)

For Zigbee: attribute reports arrive as ZCL frames, are translated by `ClusterHandler`, and published as `state_reported` domain events.

**Matter questions:**
- What are actual subscription reporting intervals for different device types? (The Matter spec defines min/max intervals; devices may not honor them.)
- Do devices report all attributes in a subscription, or only changed attributes?
- How do sleepy end devices (Thread SEDs) behave? Do they batch reports or send them on wake?
- When a controller (HomeSynapse) becomes temporarily unavailable, do devices re-subscribe automatically, or does the adapter need to re-establish subscriptions on reconnect?
- Are `state_reported` events from Matter devices structurally identical to those from Zigbee after translation, or do they carry different metadata that would require event model changes?

### 3.4 ExceptionClassification (integration-runtime)

Three categories: `TRANSIENT` (retry with backoff), `PERMANENT` (transition to FAILED), `SHUTDOWN_SIGNAL` (clean shutdown).

**Matter questions:**
- What failure modes exist during commissioning? Are they transient (retry) or permanent (user intervention required)?
- What does a Thread network partition look like from the application layer? Does the device simply stop reporting, or is there an explicit disconnect signal?
- When a border router fails, how do Thread devices behave? Is this a transient failure for the adapter or does it require a different recovery strategy?
- Do Matter devices have firmware-update-induced unavailability? How long? Is it signaled or silent?

### 3.5 IntegrationDescriptor and Adapter Dependencies (AMD-14)

AMD-14 introduced `dependsOn` for adapter startup ordering. The motivating example was a Matter-over-Thread adapter depending on a Thread Border Router adapter.

**Matter questions:**
- If HomeSynapse runs its own Thread Border Router (e.g., via OpenThread on the Pi), does the Matter adapter depend on that adapter being `RUNNING` first?
- Or does Matter commissioning handle border router discovery internally, making `dependsOn` unnecessary for this case?
- What is the observed startup sequence when using external border routers (Apple TV, HomePod Mini, Nest Hub)?

### 3.6 Device Model Translation (Doc 02, INV-CE-04)

The three-layer translation architecture from research: Protocol Transport → Device Profile → HomeSynapse Capability.

**Matter questions:**
- Do Matter device types map cleanly to HomeSynapse entity types? (e.g., Matter `On/Off Light` → HomeSynapse `EntityType` with `OnOff` + `Brightness` capabilities)
- Is there information loss in the Matter → HomeSynapse capability translation equivalent to the Zigbee translation loss (transition times, manufacturer-specific clusters)?
- Do dual-protocol devices (Aqara's Thread + Zigbee sensors) present different capabilities depending on the transport used?
- Does the Matter `Descriptor` cluster (which lists supported clusters per endpoint) match reality? Or do devices claim clusters they don't fully implement?

---

## 4. Testing Protocol

### 4.1 Environment Setup

**Controllers (5):**

| Controller | Role | Hardware |
|---|---|---|
| Apple Home | Primary Thread ecosystem | HomePod Mini or Apple TV 4K (Thread border router) |
| Google Home | Comparison | Nest Hub 2nd Gen (Thread border router) |
| Amazon Alexa | Comparison | Echo 4th Gen (Thread border router) |
| Samsung SmartThings | Most aggressive Matter implementer | SmartThings Station or Hub v3 |
| Home Assistant | Developer reference | Pi-based or VM with SkyConnect or similar |

**Infrastructure:**
- OpenThread Border Router on a separate Pi (optional but recommended for raw Thread packet visibility)
- WiFi network (2.4 GHz + 5 GHz, standard home setup)
- Network packet capture capability (Wireshark with Thread dissector, if available)

### 4.2 Per-Device Test Sequence

For each device, execute this sequence against each controller. Document every observation.

**Phase A: Commissioning**

| Step | Observation | Record |
|---|---|---|
| A1. Unbox, power on | LED/indicator behavior, time to first advertisement | Seconds to discoverable state |
| A2. Scan QR code / enter manual pairing code | Success/failure per controller | Boolean + error message if failure |
| A3. Commission to first controller | Time from scan to "device ready" | Seconds, steps required |
| A4. Multi-admin: commission same device to second controller | Success/failure, time, complexity | Boolean, seconds, steps |
| A5. Multi-admin: commission to third, fourth, fifth controller | Cumulative success, any failures | Per-controller matrix |
| A6. Re-commission after factory reset | Does it work cleanly? Any stuck state? | Boolean + notes |

**Phase B: Cluster Conformance**

| Step | Observation | Record |
|---|---|---|
| B1. List claimed clusters (from device's Descriptor cluster) | Which clusters does the device advertise? | Cluster ID list |
| B2. For each claimed cluster, test basic operations | Does the cluster actually work on each controller? | Per-cluster, per-controller matrix |
| B3. Feature parity across controllers | Does the device expose the same features on all controllers? | Feature delta matrix |
| B4. Identify "claimed but non-functional" clusters | Clusters in Descriptor but not working | List with error behavior |

**Phase C: Subscription and Reporting**

| Step | Observation | Record |
|---|---|---|
| C1. Trigger a state change (physical or command) | Time from change to controller update | Milliseconds |
| C2. Measure subscription reporting interval | How often does the device push unsolicited updates? | Interval range (min/max/avg) |
| C3. Change state rapidly (5 toggles in 5 seconds) | Are all transitions reported? Are any coalesced? | Count of events received vs. expected |
| C4. Leave device idle for 1 hour | Does it send keepalive/periodic reports? | Interval, content |
| C5. For sleepy devices: observe wake/report cycle | How often does the device wake? What does it report on wake? | Wake interval, report content |

**Phase D: Failure and Recovery**

| Step | Observation | Record |
|---|---|---|
| D1. Disconnect controller (e.g., unplug HomePod) for 5 min | Device behavior during outage | Buffering? Lost events? |
| D2. Reconnect controller | Does subscription resume automatically? | Boolean, time to resume |
| D3. Disconnect controller for 1 hour | Same as D1 but extended | Recovery behavior |
| D4. Reboot device (remove/restore power) | Re-subscription behavior, time to operational | Seconds to first report |
| D5. Move device to edge of Thread range | Behavior at signal margin | Latency increase? Lost reports? |
| D6. Remove border router, leave only device and controller | Thread network disruption behavior | Error signals, recovery |

**Phase E: Cross-Protocol Comparison (for dual-protocol devices)**

| Step | Observation | Record |
|---|---|---|
| E1. Commission via Thread, observe capabilities | Capability set, reporting behavior | Cluster list, intervals |
| E2. Commission via Zigbee (if dual-protocol), observe capabilities | Capability set, reporting behavior | Cluster list, intervals |
| E3. Compare Thread vs. Zigbee capability exposure | What's different? What's missing? | Delta list |

### 4.3 Documentation Standard

Each observation must include:

```yaml
device_id: "eve-door-window-matter"
manufacturer: "Eve Systems"
model: "Eve Door & Window (Matter)"
firmware_version: "x.y.z"
transport: "thread"  # or "wifi"
test_date: "2026-XX-XX"
controller: "apple-home"  # one of: apple-home, google-home, alexa, smartthings, home-assistant
test_phase: "commissioning"  # commissioning, cluster-conformance, subscription, failure-recovery, cross-protocol
observation:
  step: "A3"
  result: "success"  # success, failure, partial
  duration_seconds: 45
  notes: "Required two attempts. First attempt timed out at BLE handshake."
  architecture_surface: "IntegrationAdapter.run() — commissioning sub-lifecycle"
  adapter_implication: "Commissioning retry logic needed. Not a simple connect-and-go like Zigbee network resume."
```

---

## 5. Matter Bridge Path Evaluation

### 5.1 Evaluation Criteria

Both paths are evaluated against three axes. This is data gathering for a future decision, not a decision now.

| Axis | Question | Measurement |
|---|---|---|
| **Binary size on ARM64** | How large is the compiled library for aarch64-linux? | Megabytes. Must fit within jlink distribution budget. |
| **Controller API completeness** | Does the library support: commissioning a device, managing a fabric, subscribing to attributes, invoking commands, OTA? | Checklist of 5 operations, each: full/partial/none. |
| **Build/integration complexity** | Can it be built for aarch64 from a Gradle build? Does it work with JPMS? What are the transitive native dependencies? | Qualitative: low/medium/high friction. |

### 5.2 Path A: rs-matter via Panama FFI

**Repository:** `project-chip/rs-matter` (official project-chip org)

**Current status (March 2026):** Pure Rust, no_std, no-alloc, async-first. Still marked experimental. Active development (issues and PRs through January 2026). Primarily targets device-side (MCU/embedded). Controller-side usage would mean building fabric management on top of rs-matter's transport and secure channel layers.

**Evaluation tasks:**
1. Clone and build rs-matter for `aarch64-unknown-linux-gnu`. Record binary size of the resulting `.so`.
2. Review API surface: does it expose controller-side operations (commissioner, fabric admin, subscription client)? Or is it device-side only?
3. Attempt a minimal JNI/Panama bridge: can a Java program call into rs-matter's transport layer? Record friction.
4. Assess: is building controller-side fabric management on rs-matter's transport a months-long project or a weeks-long project?

**Alignment with HomeSynapse:** This path fits Layer 3 of the Language Evaluation strategy (selective Rust extraction via Panama FFI). Binary size is likely small (rs-matter targets MCUs with 1MB flash). Virtual thread compatibility depends on whether the FFI call blocks a carrier thread (likely yes for synchronous calls).

### 5.3 Path B: CHIP SDK (C++) via JNI/Panama

**Repository:** `project-chip/connectedhomeip` (the reference Matter implementation)

**Current status:** The reference implementation used by Apple, Google, Samsung under the hood. Full controller support including commissioner, fabric management, subscription handling, OTA. Massive C++ codebase (~2GB build tree).

**Evaluation tasks:**
1. Build `chip-tool` for `aarch64-linux-gnu`. Record binary size and transitive dependencies.
2. Review the controller API surface (`CHIPDeviceController`, `Commissioner`, `SubscriptionClient`). Is it callable from JNI without major wrapper work?
3. Assess cross-compilation complexity: can the CHIP SDK be built from a Gradle task, or does it require a separate CMake pipeline?
4. Evaluate memory footprint: what is the RSS of `chip-tool` managing 10 devices with active subscriptions?

**Alignment with HomeSynapse:** This path provides the most complete controller API but at significant build complexity and binary size cost. The CHIP SDK is not designed for embedding — it's designed for building standalone controller applications. JNI wrapping would be substantial. Virtual thread compatibility is a concern: C++ calls via JNI pin carrier threads (same issue as sqlite-jdbc, Doc 04 §3.x).

### 5.4 Decision Criteria (for future use)

The bridge path decision is NOT made during this research. The research produces data. The decision is made when Matter adapter implementation begins (post-Zigbee validation). Decision inputs:

- If rs-matter matures controller-side APIs before we need Matter support → strong candidate for Panama FFI path
- If rs-matter remains device-side focused → CHIP SDK is the only viable complete path
- If CHIP SDK binary size exceeds 50 MB on ARM64 → investigate stripped/minimal builds or subprocess model (with INV-LF-01 implications)
- If neither path is viable → evaluate implementing Matter's application layer directly in Java using rs-matter or CHIP SDK as specification references (highest effort, most control)

---

## 6. Device Shopping List

### 6.1 Selection Criteria

Devices are selected to maximize architectural insight per dollar:

- **Manufacturer diversity** — At least 3 manufacturers to detect manufacturer-specific quirks vs. protocol-level behavior
- **Device type diversity** — Lights, sensors, plugs, at minimum. These map to different cluster sets and reporting patterns.
- **Thread-primary** — 6–7 Thread devices, 2–3 WiFi for comparison
- **Dual-protocol where possible** — Devices that support both Thread and Zigbee (e.g., Aqara) enable direct cross-protocol comparison using the same hardware
- **Available in the US** — Devices must be purchasable from Amazon, direct, or similar. No import-only or regional exclusives.

### 6.2 Tier 1: Minimum Viable Test Kit (~$200–300)

This tier covers the essential device types and manufacturer diversity needed for meaningful research.

| # | Device | Manufacturer | Transport | Clusters Tested | Approx. Price |
|---|---|---|---|---|---|
| 1 | Eve Door & Window (Matter) | Eve Systems | Thread | Boolean State, Contact Sensor | ~$30 |
| 2 | Eve Motion (Matter) | Eve Systems | Thread | Occupancy Sensing, Illuminance | ~$40 |
| 3 | Aqara Door and Window Sensor P2 | Aqara | Thread (also Zigbee via hub) | Boolean State, Contact Sensor | ~$25 |
| 4 | Nanoleaf Essentials A19 Bulb | Nanoleaf | Thread | On/Off, Level Control, Color Control | ~$20 |
| 5 | Aqara Smart Plug (Matter) or IKEA TRETAKT | Aqara / IKEA | Thread or WiFi | On/Off, Electrical Measurement | ~$15–25 |
| 6 | TP-Link Tapo P125M (WiFi Matter plug) | TP-Link | WiFi | On/Off, (power monitoring varies by controller) | ~$15 |

**Tier 1 total: ~$145–$160 for devices**

**Required infrastructure (if not already owned):**

| Item | Purpose | Approx. Price |
|---|---|---|
| Apple HomePod Mini | Apple Home controller + Thread border router | ~$100 |
| Thread border router (if no Apple/Google/Amazon device owned) | Thread network anchor | $0–100 (often already owned) |

**Tier 1 total with infrastructure: ~$200–$300**

**What Tier 1 answers:** Basic commissioning behavior across controllers, cluster conformance for the most common device types (lights, sensors, plugs), subscription reporting intervals for powered vs. battery devices, basic failure recovery.

### 6.3 Tier 2: Comprehensive Kit (~$450–$650)

Adds Tier 1 plus:

| # | Device | Manufacturer | Transport | Clusters Tested | Approx. Price |
|---|---|---|---|---|---|
| 7 | Eve Energy (Matter) | Eve Systems | Thread | On/Off, Electrical Measurement, Power | ~$40 |
| 8 | Eve Weather (Matter) | Eve Systems | Thread | Temperature, Humidity, Pressure | ~$60 |
| 9 | IKEA DIRIGERA Hub + IKEA Zigbee/Matter device | IKEA | Thread + Zigbee bridge | Bridge behavior, cross-protocol | ~$35 (hub) + ~$10 (device) |
| 10 | Aqara Presence Sensor FP2 | Aqara | WiFi (Matter) | Occupancy, Presence zones | ~$60–75 |

**Tier 2 additions: ~$145–$220**  
**Tier 2 total (including Tier 1): ~$450–$520**

**Additional controller (if budget allows):**

| Item | Purpose | Approx. Price |
|---|---|---|
| SmartThings Station | Most aggressive Matter implementer, Zigbee + Thread | ~$100–140 |

**Tier 2 total with SmartThings: ~$550–$660**

**What Tier 2 adds:** Energy monitoring cluster behavior (the cluster most commonly lost across controllers), environmental sensor reporting patterns, Matter bridge behavior (IKEA DIRIGERA exposing Zigbee devices via Matter), WiFi Matter device comparison (Aqara FP2), and the SmartThings conformance data point.

### 6.4 Sourcing Notes

- **Amazon** — Primary source for all devices. Watch for deals; Eve and Aqara frequently run 15–25% discounts.
- **Eve direct** (evehome.com) — Sometimes has bundle pricing (3-packs at 10–20% discount).
- **IKEA** — In-store pricing is often lower than online. DIRIGERA hub frequently available refurbished.
- **Aqara direct** (aqara.com) — Occasionally runs promotions on new sensors.

---

## 7. Conformance Database Schema

The conformance database is a collection of YAML files following HomeSynapse's configuration conventions (INV-CE-01). One file per device, observations nested per controller.

```yaml
# File: matter-conformance/eve-door-window-matter.yaml
device:
  manufacturer: "Eve Systems"
  model: "Eve Door & Window"
  model_number: "EVE-DW-MATTER-2024"
  transport: "thread"
  matter_version: "1.3"
  firmware_version: "2.1.3"
  thread_version: "1.3.0"
  purchase_price_usd: 30
  purchase_date: "2026-XX-XX"
  purchase_source: "Amazon"

  claimed_clusters:
    - cluster_id: 0x0045  # Boolean State
      cluster_name: "Boolean State"
    - cluster_id: 0x002F  # Power Source
      cluster_name: "Power Source"
    - cluster_id: 0x001D  # Descriptor
      cluster_name: "Descriptor"
    # ... complete list

  controllers:
    apple_home:
      commissioned: true
      commissioning_seconds: 42
      commissioning_notes: "Clean first-time pairing via QR code"
      multi_admin: true
      multi_admin_notes: ""
      functional_clusters:
        - cluster_id: 0x0045
          functional: true
          notes: "Reports open/closed state correctly"
      subscription:
        reporting_interval_min_seconds: 0.5
        reporting_interval_max_seconds: 60
        reports_on_change: true
        reports_periodic: true
        periodic_interval_seconds: 300
        coalesces_rapid_changes: false
        notes: "Responsive. Sub-second change detection."
      failure_recovery:
        controller_offline_5min: "Resumed automatically within 10 seconds"
        controller_offline_1hr: "Resumed automatically within 30 seconds"
        device_power_cycle: "Re-subscribed within 15 seconds of boot"
        border_router_failure: "Lost connectivity until border router restored"

    google_home:
      commissioned: true
      commissioning_seconds: 68
      # ... same structure

    alexa:
      commissioned: false
      commissioning_failure_reason: "Timeout during CASE session establishment"
      # ... document what happened

  architecture_implications:
    adapter_lifecycle: |
      Commissioning is controller-initiated, not adapter-initiated.
      The HomeSynapse Matter adapter acts as a controller.
      This means commissioning lives in run(), similar to Zigbee's
      permitJoin() flow but more complex (PASE → CASE → fabric join).
    exception_classification: |
      Commissioning timeout → TRANSIENT (retry with backoff).
      CASE session failure after successful commission → TRANSIENT.
      Device removed from fabric by another controller → PERMANENT.
    command_lifecycle: |
      Invoke-to-status: ~200ms observed.
      Status-to-subscription-update: ~500ms observed.
      Total command round-trip: ~700ms.
      Pending Command Ledger timeout should be ≥2 seconds for Matter.
    event_pipeline: |
      Subscription reports map cleanly to state_reported events.
      No new event types needed — the translation layer is adapter-internal.
```

---

## 8. Report Structure (Publishable Document)

The published report follows this structure:

### 8.1 Outline

1. **Executive Summary** — The spec-to-reality gap in one page. Key findings.
2. **Methodology** — Devices tested, controllers used, test protocol, data collection.
3. **Commissioning Reality** — Per-device, per-controller commissioning results. Multi-admin behavior. Factory reset recovery.
4. **Cluster Conformance Matrix** — The core contribution. Per-device, per-controller: which clusters are claimed, which actually work, which features are lost.
5. **Subscription and Reporting Behavior** — Measured intervals, change detection latency, sleepy device behavior, rapid-change handling.
6. **Failure and Recovery** — Controller unavailability, device reboot, border router failure, range edge behavior.
7. **Thread vs. WiFi Comparison** — Same-manufacturer devices on different transports. What changes, what doesn't.
8. **Dual-Protocol Comparison** — Devices that support Thread + Zigbee. Capability exposure differences.
9. **Controller Ecosystem Assessment** — Which controllers are furthest ahead on Matter implementation. Which are furthest behind. What this means for controller developers.
10. **Recommendations for Controller Developers** — Concrete guidance derived from findings. Timeout values, retry strategies, subscription management patterns, quirk handling.
11. **Appendix: Raw Data** — Complete conformance database in structured format.

### 8.2 Tone

Technically precise, developer-facing, evidence-based. Not promotional, not polemical. The tone is: "Here's what we measured. Here's what it means if you're building a controller." Let the data speak.

---

## 9. HomeSynapse Adapter Requirements Addendum Structure

This internal document translates research findings into concrete requirements, organized by integration architecture surface.

### 9.1 Sections

1. **IntegrationAdapter Lifecycle Changes** — Does Matter require lifecycle modifications? New phases? Different `initialize()` / `run()` contracts?
2. **CommandHandler Adaptations** — Invoke interaction mapping to `CommandEnvelope`. Timeout value recommendations for Pending Command Ledger.
3. **ExceptionClassification Mapping** — Concrete mapping of observed Matter failure modes to TRANSIENT / PERMANENT / SHUTDOWN_SIGNAL.
4. **Subscription Management** — Adapter-layer subscription lifecycle. Re-subscription strategy. Report handling pipeline.
5. **Device Profile Registry** — Matter equivalent of ZHA's quirks. Per-device behavioral compensation. Structured as adapter-internal device profiles.
6. **IntegrationDescriptor Configuration** — Recommended `IoType`, `RequiredService` set, `DataPath` declaration, `dependsOn` requirements for the Matter adapter.
7. **JPMS and Dependency Impact** — Does the Matter adapter require new module dependencies? New `requires` directives? Impact on the module graph.
8. **Bridge Library Integration** — Findings from the rs-matter / CHIP SDK evaluation. Recommended path and integration approach.

### 9.2 Format

Each requirement is a structured entry:

```yaml
requirement_id: "MATTER-REQ-001"
title: "Commissioning retry with exponential backoff"
architecture_surface: "IntegrationAdapter.run()"
evidence: "Commissioning timeout observed on 3/5 controllers for Eve Door & Window on first attempt"
specification: |
  The Matter adapter's run() phase must include commissioning logic
  with retry. Recommended: max 3 attempts, exponential backoff
  starting at 2 seconds, max 30 seconds.
existing_pattern: "Analogous to Zigbee's interview retry in Doc 08 §3.x"
rework_required: false  # true if existing architecture surface needs modification
rework_scope: ""  # description if rework_required is true
```

---

## 10. Timeline and Workflow

### 10.1 Execution Principles

- This research is a **parallel workstream**. It does NOT block Phase 3 entry (SQLite WAL validation spike, then implementation).
- Ad-hoc testing as devices are used in daily life. Structured documentation batched into focused sessions.
- Start with Tier 1 devices. Expand to Tier 2 only if findings warrant deeper investigation.
- Bridge path evaluation (§5) is a separate weekend spike, not interleaved with device testing.

### 10.2 Suggested Sequence

| Phase | Activity | Estimated Effort |
|---|---|---|
| Week 1–2 | Purchase Tier 1 devices. Set up controller accounts. | 1–2 hours |
| Week 2–4 | Commission each device to all available controllers. Document Phase A observations ad-hoc. | 30 min per device × controller (spread across daily use) |
| Week 4–6 | Structured Phase B (cluster conformance) and Phase C (subscription) testing. | 2–3 focused sessions, 1–2 hours each |
| Week 6–8 | Phase D (failure/recovery) testing. Bridge path evaluation spike (§5). | 2–3 focused sessions + 1 weekend spike |
| Week 8–10 | Compile conformance database. Draft adapter requirements addendum. | 2–3 hours |
| Week 10–12 | Draft publishable report. Review, polish, publish. | 3–5 hours |

**Total estimated effort: 20–30 hours over 12 weeks, alongside Phase 3 work.**

### 10.3 Decision Gates

| Gate | Trigger | Action |
|---|---|---|
| Tier 2 expansion | Tier 1 findings reveal device-type-specific issues that require more data | Purchase Tier 2 devices, extend testing |
| Architecture rework flag | Any observation maps to `rework_required: true` | Escalate to design document amendment process before Phase 3 Matter work |
| Bridge path decision | Matter adapter implementation begins | Use §5 evaluation data to select rs-matter or CHIP SDK path |
| Report publication | Conformance database has ≥5 devices × ≥3 controllers with complete observations | Draft and publish report |

---

## 11. Success Criteria

This research is complete when:

1. ✅ Tier 1 devices (≥5) are tested against ≥3 controllers with complete Phase A–D observations
2. ✅ Conformance database contains structured YAML data for all tested device × controller combinations
3. ✅ Adapter requirements addendum identifies all `rework_required: true` items (or confirms none exist)
4. ✅ Bridge path evaluation produces binary size, API completeness, and build complexity data for both rs-matter and CHIP SDK
5. ✅ Publishable report draft exists with the structure defined in §8
6. ✅ All observations include `architecture_surface` and `adapter_implication` fields — no orphaned data points

---

## 12. References

### HomeSynapse Architecture (internal)

- **INV-CE-04** — Protocol Agnosticism in the Device Model (Architecture Invariants §8)
- **INV-CE-05** — Extension Model with Stability Guarantees (Architecture Invariants §8)
- **INV-RF-01** — Integration Isolation (Architecture Invariants §3)
- **INV-RF-03** — Startup Independence (Architecture Invariants §3)
- **INV-LF-01** — Local Operation Without Cloud (Architecture Invariants §2)
- **AMD-14** — Integration Runtime Adapter Dependency Ordering
- **Doc 02** — Device Model and Capability System (Contract C5: tolerance bands)
- **Doc 05** — Integration Runtime (§8: key interfaces)
- **Doc 08** — Zigbee Adapter (reference implementation for integration patterns)
- **Language Evaluation Strategy** — §3.4 (rs-matter as strategic asset), §6.3 (Panama FFI extraction)
- **Device Model Architectures Research** — Three-layer translation architecture

### Matter Specification (external)

- Matter 1.0/1.2/1.3/1.4/1.5 specifications (CSA members only; public summaries at csa-iot.org)
- Thread 1.4 specification (threadgroup.org)
- rs-matter repository: github.com/project-chip/rs-matter
- CHIP SDK repository: github.com/project-chip/connectedhomeip
- matter-smarthome.de — Independent Matter product and development tracking

### Market Context (external)

- matter-smarthome.de status reviews (2025, 2026)
- Parks Associates: 52% of DIY smart home users report setup/connectivity issues (2026)
- Eve "Which hub is right for me?" — canonical example of the spec-vs-reality gap
