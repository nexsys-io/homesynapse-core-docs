# HomeSynapse Core Doc 11: Observability & debugging research

**HomeSynapse can leapfrog every major smart home platform on observability by exploiting a universal gap: no existing platform answers "why did this happen?" with a full causal chain.** Home Assistant's automation trace viewer comes closest but stops at the automation boundary — it cannot trace upstream triggers or downstream device confirmations. By combining JFR-based metrics with event-sourced causal chains and a tiered health composition model, HomeSynapse can deliver always-on diagnostics at under 5% CPU overhead on a Raspberry Pi 5. This research covers competitive analysis across five platforms, JFR configuration for constrained ARM64 hardware, health aggregation algorithms, and trace assembly patterns adapted from distributed tracing systems.

---

## 1. Platform observability comparison

### Home Assistant: sophisticated traces, but no causal chains

Home Assistant offers the most advanced debugging among smart home platforms. Its **automation trace viewer** renders an interactive directed graph showing which execution path was taken, with clickable nodes for triggers, conditions, and actions. Step Details, Changed Variables, and Related Activity tabs provide context. Developer Tools (States, Services, Templates, Events) allow real-time entity inspection and service testing in-browser — a capability unique among platforms.

Despite this sophistication, HA's observability has critical gaps that users consistently report. **Only the last 5 traces are stored by default** (configurable via `stored_traces`), and "Chosen trace is no longer available" errors are pervasive. YAML automations without an `id` field silently produce no traces. When `choose:` actions evaluate, the trace shows "No action taken" without explaining which condition failed. Most fundamentally, if a trigger never fires, **no trace exists** — users cannot debug why an automation *didn't* run.

The Logbook (now "Activity") shows a timeline of entity state changes but suffers severe performance issues — loading takes 2–3+ minutes with many entities. High-frequency sensors flood it with noise. It shows *what* happened but never *why* or *what caused it*. The System Health page displays versions and connectivity but lacks performance metrics unless the separate System Monitor integration is installed. Device health requires manual setup: Zigbee users must enable availability tracking, create custom blueprints for offline detection, and dive into ZHA/Z2M debug logs to distinguish offline devices from slow or misconfigured ones.

### openHAB: best-in-class log control, weak on visualization

openHAB's Karaf console provides **dynamic per-binding log level adjustment at runtime** (`log:set DEBUG org.openhab.binding.zwave`) — the most surgical diagnostic tool across all platforms. The **separated `events.log`** captures only state changes and commands on the event bus, creating a clean event stream without framework noise. The formal Thing status model (UNINITIALIZED → ONLINE/OFFLINE/UNKNOWN) with detail text like "OFFLINE - COMMUNICATION_ERROR - No response after 3 retries" gives actionable device health information.

The weaknesses are significant on constrained hardware. openHAB's OSGi/Karaf framework causes high CPU overhead on Pi 2/3, and enabling DEBUG logging to SD cards creates a diagnostic paradox — the debugging tool itself degrades performance. There is no visual execution trace for rules; debugging is entirely text-log-based. Thing status semantics vary between bindings — some report ONLINE even when devices are unreachable. Per-individual-rule log levels are not supported (only per `automation` package).

### SmartThings, Hubitat, and Domoticz: diminishing diagnostic capability

**SmartThings** suffered a dramatic regression when the Groovy IDE was removed in October 2022. The old IDE provided in-browser live logging, device event history, and SmartApp debugging. The replacement — CLI-only `logcat` requiring developer tool installation — means **regular users have essentially zero diagnostic capability**. Edge driver logs have no persistence; they stream in real-time only. During internet outages, no diagnostics are available at all despite local Edge execution continuing.

**Hubitat** offers a real-time streaming log in its web UI and a "Produced By" column in device events that identifies which app sent a command — directly answering "what turned on my light?" at the device level. However, app logging is off by default, debug logging auto-disables after 30 minutes, and flash memory constraints mean logs disappear within hours on busy systems. Users report persistent difficulty correlating triggers across rules.

**Domoticz** provides a 300-line in-memory log buffer, per-hardware log level control, and a pragmatic Data Timeout feature that auto-restarts hardware gateways after configurable silence. Beyond this, it offers no automation tracing, no causal analysis, and confusing dzVents logging configuration.

### Failure catalog: what no platform can diagnose

The **universal gap** across all five platforms is end-to-end causal chain visibility. No platform can show: "motion sensor detected motion → automation evaluated conditions → command sent to light → light confirmed state change" as a single queryable chain. Additional common failures:

- **"Why didn't this automation fire?"** — No platform traces trigger evaluations that don't result in execution. Home Assistant generates no trace at all when a trigger doesn't match.
- **"What caused this state change?"** — Distinguishing physical button press vs. automation vs. scene vs. app command is partial at best (Hubitat's "Produced By") and absent on most platforms.
- **"Is this device healthy?"** — No platform provides a unified device health dashboard across protocols without manual setup or custom blueprints.
- **"Why is the system slow?"** — No platform includes built-in performance profiling.

### Pattern catalog: what HomeSynapse should adopt and improve

The strongest patterns to adopt are: HA's visual automation trace viewer (extend with upstream/downstream causal tracing), openHAB's dynamic per-binding log levels (expose in GUI, not just CLI), openHAB's Thing status model with detail text (standardize semantics across all integrations), Hubitat's "Produced By" attribution (make mandatory, not opt-in), and Domoticz's Data Timeout auto-restart (track restart frequency as a health signal). The community blueprint ecosystem in HA for device health monitoring proves massive demand for built-in first-class device health features.

---

## 2. JFR on constrained hardware

### Continuous recording configuration for years of uptime

JFR's continuous recording manages disk space through chunk-based rotation controlled by two parameters: `maxsize` (total disk cap) and `maxage` (time-based retention). Events flow from thread-local buffers (8 KB each) through global in-memory buffers (~10 MB total via `memorysize=10m`) to disk as timestamped `.jfr` chunk files. When either limit is exceeded, the oldest chunk is deleted.

**A critical gotcha: `maxage` is checked only when a new chunk is created**, not continuously. This means actual retained data can exceed `maxage` by up to one chunk's duration. Reducing `maxchunksize` from the 12 MB default to **4 MB** mitigates this by forcing more frequent chunk boundaries, improving both age precision and Event Streaming API latency.

**Recommended configuration for HomeSynapse:**

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `maxsize` | 256 MB | ~5–6 hours at 600 events/sec; caps disk permanently |
| `maxage` | 6h | Rolling diagnostic window; binding constraint in most scenarios |
| `maxchunksize` | 4 MB | Precise age rotation, lower streaming latency |
| `memorysize` | 10m | Default is appropriate; ~20–25 MB total native memory overhead |
| `repository` | `/path/on/nvme/jfr-repo` | NVMe, never tmpfs |

At **600 events/sec** with ~22 bytes per event, disk write rate is approximately **13 KB/sec (47 MB/hour)**. NVMe write endurance is a non-issue: a 500 GB NVMe rated at 300 TBW would last **~789 years** at this write rate. Even at 10× the rate, endurance exceeds 79 years. Sequential chunk writes also minimize write amplification. **Do not use tmpfs** — on a 4 GB system with 1536 MB heap, a 256 MB tmpfs creates dangerous memory pressure. NVMe is the correct and only choice.

Total JFR native memory footprint is approximately **20–25 MB outside the heap** (global buffers + metadata + one active chunk). Combined with the 1536 MB heap and ~200 MB JVM overhead, the JVM consumes ~1.8 GB, leaving ~2.2 GB for OS and page cache.

### Custom event design: what JFR permits and forbids

JFR custom events support a limited set of field types: **boolean, char, byte, short, int, long, float, double, String, Thread, and Class**. Arrays, enums, and other reference types are **silently ignored** — no compile error, no runtime error, just missing data in the recording. This is the most dangerous JFR gotcha for HomeSynapse. Metric type discrimination must use `int` or `String`, not Java enums.

All integer fields use **unsigned LEB128 (varint) encoding**. Small positive values compress to 1 byte (0–127), while negative values expand to 9–10 bytes. A typical `DeviceMetricEvent` with fields `{deviceId: int, metricType: int, value: long, unit: byte}` and `@StackTrace(false)` costs approximately **19–24 bytes per event** — provided `deviceId` (0–50) and `metricType` (0–12) are small positive integers. The `@StackTrace(false)` annotation is mandatory for all metric events; stack trace capture is the single most expensive JFR operation.

The `event.commit()` path is lock-free, writing to thread-local buffers. At **100 events/sec sustained**, overhead is trivial. At **1,000 events/sec**, it remains well within JFR's design envelope — the JDK 16 allocation profiler throttle was designed for millions of events per minute. The practical limit is disk I/O and file size, not CPU. For duration events, the `shouldCommit()` pattern avoids populating expensive fields for sub-threshold events.

A **JFR string constant pool bug (JDK-8338389)** caused strings longer than 128 characters to not be pooled before JDK 24, backported to **21.0.6**. HomeSynapse must run JDK 21.0.6+ and should prefer `int` fields over `String` for high-cardinality identifiers like device IDs.

### Event Streaming API: architecture, latency, and bridging patterns

The `RecordingStream` (JEP 349) reads from the **disk repository**, not from in-memory buffers. A separate parser thread reads the most recent chunk file as it is written. When streaming is active, JFR flushes to disk more frequently — approximately every second. Expected latency from `event.commit()` to `onEvent()` callback is **1–2 seconds**.

Only events registered via `onEvent("event.name", callback)` are parsed from the chunk file — unsubscribed events are skipped, making filtering efficient at the parser level. However, there is **no explicit backpressure mechanism**. If the consumer callback is slower than the producer, old chunks are deleted per `maxage`/`maxsize` before being read, causing silent data loss.

The recommended bridging pattern aggregates metrics in `onEvent()` callbacks and pushes snapshots in the `onFlush()` callback (fired after each chunk flush, ~1/sec):

```java
rs.onEvent("com.homesynapse.DeviceMetric", event -> {
    String key = event.getInt("deviceId") + ":" + event.getInt("metricType");
    snapshots.merge(key, MetricSnapshot.from(event), MetricSnapshot::merge);
});
rs.onFlush(() -> {
    broadcastToWebSockets(snapshots);
    snapshots.clear();
});
rs.startAsync();  // start() blocks; startAsync() runs in separate thread
```

A **critical safety rule**: operations in `onEvent()` callbacks must never emit JFR events, which would cause infinite recursion (documented in JEP 349). Multiple recordings and RecordingStreams share the same global buffer pool — running both a continuous recording and a streaming subscription does not double buffer usage.

Estimated CPU overhead for streaming 600 events/sec on Pi 5 ARM64 is **under 5% of one Cortex-A76 core**. No ARM64-specific JFR benchmarks exist in public literature, but JFR is fully supported on aarch64 in Java 21 across all major distributions (Temurin, Liberica, Zulu). The Pi 5's four Cortex-A76 cores at 2.4 GHz are reasonably performant; JFR overhead should be negligible for the described workload. Ensure the 64-bit (aarch64) OS is used — 32-bit armhf limits heap addressing.

### Cardinality strategy: fewer types, smarter fields

With 50 devices × 12 metric types, creating separate JFR event classes per metric per device is untenable (600 classes). The **recommended approach is a single generic `DeviceMetricEvent`** with discriminating `int` fields for `deviceId` and `metricType`. This produces a single event class, minimizes metaspace usage, and compresses exceptionally well through varint encoding of small positive integers.

JFR has no documented hard limit on custom event types — the JDK itself defines 150+ built-in types. However, each type adds metadata to every chunk file, and class loading performs bytecode transformation. A practical ceiling of **15–25 custom event types** is recommended: one generic device metric type, 10 per-subsystem event types, and 3–5 system-level events (health transitions, startup, errors).

High-cardinality string fields are handled by JFR's string constant pool, which deduplicates strings of 16–128 characters via a small cache. For device identifiers, `int` is vastly more efficient than `String` (1 byte vs. 20+ bytes). The realistic metric budget for Pi 5:

| Budget dimension | Recommended | Safe ceiling |
|-----------------|-------------|-------------|
| Events per second | 600 | 2,000 |
| Distinct event types | 15–25 | 50–100 |
| JFR disk footprint | 256 MB fixed | — |
| JFR native memory | ~25 MB | — |
| Streaming CPU | <5% one core | — |

Pre-aggregation in streaming callbacks is the primary cardinality reduction strategy. Use `onFlush()` to compute min/max/avg/count per metric window. For "warm/cold" retention, a separate in-process aggregator can compute minute-level and hour-level rollups to SQLite, while JFR serves as the hot tier. The `@Period("10 s")` annotation handles polling-style metrics without per-poll event emission.

---

## 3. Health aggregation models

### How infrastructure systems compose health

The five systems surveyed each emphasize different composition philosophies. **Consul** uses strict worst-of at the node level — any failed node-level check marks all services on that node as critical. **Kubernetes** separates concerns via three probe types (liveness, readiness, startup) and uses zone-aware eviction with a **55% quorum threshold** to prevent cascading failures. **Envoy** combines active health checks with passive outlier detection from real traffic, computing cluster health as a percentage of available endpoints. **Nagios/Icinga** models explicit dependency graphs that suppress notifications for dependent services when their dependencies fail. **AWS CloudWatch** offers Boolean composition with AND/OR/NOT and an `AT_LEAST(n, ...)` quorum operator, plus an `ActionsSuppressor` feature for maintenance windows.

The Kubernetes **startupProbe** is directly relevant: it defers liveness and readiness checks until the application finishes starting, preventing premature failure signals during initialization — exactly HomeSynapse's State Store replay scenario.

### Tiered composition is the right algorithm

Five composition approaches were evaluated against HomeSynapse's constraints:

**Worst-of** (system health = worst subsystem) is too sensitive: a DEGRADED WebSocket API would dominate system health identically to a DEGRADED Event Bus. **Weighted average** provides nuance but requires calibrating weights and mapping numeric scores to categorical states — harder to interpret on a dashboard. **Dependency-graph-aware** composition is the most informative (it can explain "WebSocket DEGRADED *because* Event Bus DEGRADED") but adds implementation complexity disproportionate to the 10-subsystem scale. **Quorum/threshold** loses information about which subsystem matters. **Tiered classification** provides the optimal balance.

The recommended algorithm classifies HomeSynapse's 10 subsystems into three tiers:

**Tier 1 — Critical Infrastructure** (Event Bus, State Store, SQLite Persistence): any UNHEALTHY → system UNHEALTHY; any DEGRADED → system DEGRADED. These subsystems are existential — the platform cannot function without them.

**Tier 2 — Core Services** (Rule Engine, Device Integrations, others): ≥2 DEGRADED or any UNHEALTHY → system DEGRADED. A single DEGRADED core service is noted but does not degrade the system — automations failing while device control still works is a reduced but functional state.

**Tier 3 — Interface Services** (WebSocket API, others): all UNHEALTHY → system DEGRADED. Partial degradation of interface services does not affect system operation.

The system-wide health is the **worst-of across tier results**: `System = worst(Tier1_result, Tier2_result, Tier3_result)`. Computation is O(n) with n=10 — negligible on Pi hardware. Integration sub-scoring (the existing weighted score from 0–100) maps to the three-state model: ≥80 → HEALTHY, 50–79 → DEGRADED, <50 → UNHEALTHY.

### Startup grace and flapping prevention

A **system lifecycle state machine** handles expected transient degradation: STARTING → RUNNING → SHUTTING_DOWN. During STARTING, per-subsystem startup grace periods apply (e.g., State Store: 30 seconds for event replay, Event Bus: 10 seconds for initialization). DEGRADED states within the grace period are annotated as "(startup replay)" and excluded from aggregate composition. After the grace period expires, normal tiered rules apply. If critical subsystems haven't reported HEALTHY by a configurable maximum startup duration (e.g., 60 seconds), the system transitions to DEGRADED with an explicit reason.

At the aggregate level, a **minimum dwell time** of 10 seconds prevents flapping on DEGRADED → HEALTHY transitions. Transitions to UNHEALTHY are immediate (safety-critical). This is sufficient given that individual subsystems already implement their own hysteresis. Correlated oscillation across subsystems remains the primary risk — the dwell time absorbs this without the complexity of Nagios-style weighted percent state change calculations.

### Dashboard information structure that drives action

The dashboard should implement four-level drill-down: **Level 0** shows a single system health indicator with text ("HomeSynapse: DEGRADED"). **Level 1** shows tier summaries ("Critical Infrastructure: HEALTHY | Core Services: DEGRADED (1/3) | Interface: HEALTHY"). **Level 2** lists individual subsystem statuses with duration ("Rule Engine: DEGRADED for 2m 15s"). **Level 3** provides subsystem-specific diagnostics (individual device health, integration scores).

Each status must carry context: *since when* (duration), *why* (specific reason text), *impact* (what functionality is affected), *expected?* (annotated for startup or maintenance), and *what changed* (previous state and transition cause). Recommended actions should distinguish user-actionable issues from auto-recoverable ones. All health state transitions should be logged to SQLite with timestamp, previous state, new state, and reason — this enables the "why did the system degrade at 3 AM?" query.

---

## 4. Trace query and assembly

### Query model adapted from Jaeger and Zipkin

Jaeger's `SpanReader` interface supports two primary query modes: direct lookup by trace_id (most efficient) and parametric search by service, operation, tags, duration, and time range. Zipkin offers similar parameters through its REST API. Both require time range constraints for search queries and provide trace_id-direct lookup as the fast path.

HomeSynapse's query model should support five access patterns, ordered by expected frequency:

1. **By correlation_id** — direct lookup when a user clicks a specific event (equivalent to Jaeger's `GetTrace`). Single index scan, returns complete chain.
2. **"Why did this happen?" reverse lookup** — given a device in a particular state, find the most recent causal chain: `SELECT correlation_id FROM events WHERE entity_id = ? AND event_type IN ('state_changed','state_confirmed') ORDER BY timestamp DESC LIMIT 1`, then fetch the full chain. This is the killer query for smart home users.
3. **By device + time range** — "What happened to the porch light today?" Returns correlation_ids for all chains involving that device.
4. **By event type + time range** — "Show all automation triggers in the last hour."
5. **By time range** — "What happened between 2 AM and 4 AM?"

### Assembly algorithm: trivially simple at depth 7

Distributed tracing systems solve a hard problem: assembling traces from spans arriving out of order from multiple services across a network. Jaeger fetches all spans for a trace_id from storage and ships the flat list to the UI, where JavaScript builds the parent-child tree from `parentSpanId` fields. Zipkin sorts spans ascending by timestamp and similarly delegates tree construction to the client. OpenTelemetry's tail sampling processor buffers spans in-memory for 10–30 seconds using a `decision_wait` timeout before assembly.

HomeSynapse faces none of these challenges. Events are written by a single writer to SQLite in timestamp order. There are no out-of-order arrivals, no distributed collection, no clock skew. The assembly algorithm is a single SQL query followed by a single-pass hash map build:

**Step 1**: `SELECT * FROM events WHERE correlation_id = ? ORDER BY timestamp ASC` — fetches ~7 rows via index scan in under 1 ms on NVMe.

**Step 2**: Build tree in O(n) where n ≈ 7. Create a hash map from `event_id` → node. Iterate events: if `causation_id` is null, mark as root; otherwise, append to the parent's children list via the hash map. No pagination, no streaming, no sampling needed.

For comparison, Uber processes **840 million traces per day** with an average of ~250 spans per trace. HomeSynapse's ~7 events per chain with ~100–1,000 chains per day is six orders of magnitude simpler. At ~500 bytes per event, a full year of trace data occupies approximately **1.3 MB** — effectively free in SQLite terms.

### Presentation: a "story view" for non-technical users

The Jaeger waterfall/Gantt view excels at timing analysis for parallel operations across distributed services but is confusing for non-technical users and irrelevant when time axes span milliseconds in a single process. Home Assistant's interactive graph works well for automation logic flow but stops at the automation boundary and has known bugs where the Trace Timeline shows no information.

The recommended presentation for HomeSynapse is a **vertical "story view"** — a linear narrative chain with plain-language descriptions, icons per entity type, causal arrows between steps, and inline condition results:

Each step shows: a numbered position, a plain-language description ("Motion Detected" not "automation_trigger event"), the entity involved with an icon, the timestamp, and the causal relationship to the next step ("→ triggered", "→ action executed", "→ confirmed"). Condition evaluations display inline with ✅/❌ per condition. Steps are expandable for power users who want raw event data. For multi-device automations where one trigger affects several devices, the chain branches visually after the automation evaluation step, with parallel branches for each device's command-and-confirm sequence.

This design exploits HomeSynapse's shallow chain depth — 7 events render cleanly as a vertical list without scrolling. Deeper traces in distributed systems require collapsible trees; HomeSynapse does not.

### Handling incomplete and in-progress traces

Jaeger has no "trace complete" signal — it detects missing spans by checking parentSpanId references against existing spans and shows warnings. Zipkin renders whatever spans are available with no completeness check. Both systems' users commonly encounter "broken" recent traces due to indexing delays.

HomeSynapse's single-writer SQLite model eliminates indexing delay — events are visible immediately after commit. The incompleteness problem is temporal: a causal chain unfolds over time (command dispatched → waiting for device response → state confirmed). The recommended strategy defines **terminal event types** (`state_confirmed`, `automation_completed`, `error`) and uses simple rules: if the last event in a chain is terminal, the chain is complete; if not, display a ⏳ indicator with context ("Waiting for device response..."). Chains incomplete for over 30 seconds show a ⚠️ warning; over 5 minutes, a potential failure flag. When viewing a partial chain, the UI auto-refreshes every 2 seconds by re-querying the correlation_id.

### SQLite indexing strategy for trace queries

Five indexes cover all trace query patterns with minimal write overhead (~5 additional B-tree insertions per event, negligible on NVMe at smart home volumes):

| Index | Covers query |
|-------|-------------|
| `(correlation_id, timestamp)` | Full chain retrieval |
| `(entity_id, event_type, timestamp DESC)` | "Why did this happen?" reverse lookup |
| `(causation_id)` | Tree building / child lookup |
| `(entity_id, timestamp, correlation_id)` | Recent chains for device (covering index) |
| `(timestamp)` | Time-range scans |

The covering index on `(entity_id, timestamp, correlation_id)` is particularly important — it answers "find correlation_ids affecting device X in the last hour" without table lookups. SQLite-specific optimizations include running `ANALYZE` periodically to update query planner statistics and considering partial indexes (e.g., `WHERE event_type = 'state_changed'`) to reduce index size for the "why did this happen?" query.

---

## 5. Recommendations

### RQ-1: Design for the universal gap — full causal chain tracing

Every platform surveyed fails at end-to-end causation tracing. HomeSynapse should implement always-on lightweight event attribution (inspired by Hubitat's "Produced By" but mandatory and comprehensive), bidirectional causal chain queries ("what caused this?" and "what did this trigger?"), and negative-trace capability for automation triggers that evaluate but don't fire. These directly satisfy the event model's correlation_id/causation_id metadata design and the three-priority-tier system (DIAGNOSTIC events can capture trigger evaluations that don't result in actions). Dynamic per-subsystem log levels should be exposed in the Web UI, not restricted to CLI access.

### RQ-2: JFR continuous recording at maxsize=256m, maxage=6h, maxchunksize=4m

This configuration provides a 6-hour diagnostic rolling window at bounded disk cost, with chunk rotation precise to a few minutes. NVMe is the only appropriate storage target. Satisfies the hardware constraints (Pi 5 4 GB, NVMe, -Xmx1536m) and the decision to use JFR as the primary metrics path without Prometheus or OpenTelemetry.

### RQ-3: Tiered health composition with lifecycle state machine

Three tiers (Critical Infrastructure, Core Services, Interface Services) with worst-of per tier and per-subsystem startup grace periods. Aggregated health evaluates reactively on Event Bus health-change events. Minimum 10-second dwell time on DEGRADED → HEALTHY transitions at the aggregate level. This satisfies the per-subsystem health indicator design across 10 subsystems and the weighted integration health scores.

### RQ-4: "Story view" trace presentation with reverse-lookup query

The "why did this happen?" query starts from a device's current state, finds the most recent correlation_id via a covering index on `(entity_id, event_type, timestamp DESC)`, and assembles the full chain in under 1 ms. Presentation uses a vertical narrative chain with plain-language descriptions, icons, inline condition results, and expandable raw data. This satisfies the causal chain projection design (correlation_id → ordered event_id list) and the JFR Event Streaming API bridge to the Web UI.

### RQ-5: Single generic DeviceMetricEvent with int-type discriminators

Use one JFR event class with `int deviceId` and `int metricType` fields instead of per-device or per-metric-type classes. Budget 15–25 total custom event types, up to 2,000 events/sec sustained. Pre-aggregate in RecordingStream `onFlush()` callbacks for WebSocket push. This satisfies the decision to catalog and compose per-subsystem JFR custom events without replacing them, while respecting the 4 GB RAM constraint.

### RQ-6: Single-index trace assembly with terminal event detection

Index on `(correlation_id, timestamp)` supports O(1) chain retrieval. Single-pass hash map tree building handles the ~7-event chain depth with no need for the complex algorithms used by Jaeger/Zipkin for hundreds-of-spans traces. Incomplete chains are handled via terminal event type detection with auto-refresh. This satisfies the single-writer SQLite WAL model and the event model's causal chain metadata design.

---

## 6. Open questions for design

**JFR event taxonomy**: The research recommends 15–25 custom event types with a single generic `DeviceMetricEvent`, but the exact mapping of existing per-subsystem JFR events (defined in 10 subsystem design documents) into a unified taxonomy requires design decisions. Which subsystem events should be separate classes for streaming-level filtering vs. consolidated into generic events with discriminating fields?

**Negative trace implementation**: No existing platform implements "why didn't this automation fire?" tracing. The design must decide: should trigger evaluations that don't result in actions emit DIAGNOSTIC-priority events always, on demand (when "debug mode" is active for a rule), or only when explicitly requested? The event volume and storage implications differ significantly.

**Health tier assignment**: The research proposes three tiers, but the exact classification of all 10 subsystems requires review. Specifically: does the Rule Engine belong in Tier 1 (critical) or Tier 2 (core)? If all automations fail but manual device control works, is the system DEGRADED or UNHEALTHY? This is a product-level decision about what "the system works" means.

**Startup grace period durations**: Per-subsystem grace periods (proposed: State Store 30s, Event Bus 10s) need empirical measurement. How long does event replay actually take on Pi 5 with NVMe for a system with 1 year of event history? Is 30 seconds sufficient, or could replay take minutes?

**Trace chain depth variability**: The research assumes ~7 events per chain, but complex automations (rule triggers rule triggers rule) could produce deeper chains. What is the maximum expected chain depth, and should the UI handle chains of 20+ events differently (collapsible sections, summary view)?

**JFR Event Streaming API backpressure**: The API has no documented backpressure mechanism — slow consumers silently lose data. The design must specify what happens when the WebSocket push thread cannot keep up with the `onFlush()` callback rate. Drop-oldest? Buffer with bounded queue? Degrade to polling?

**Aggregation warm/cold tier boundary**: JFR provides 6 hours of raw events; the research recommends SQLite rollups for longer retention. The design must specify: what aggregation granularity (minute? 5-minute?), what metrics survive aggregation (min/max/avg/count? percentiles?), and what is the retention policy for aggregated data (30 days? 1 year?)?

**String vs. int for entity identifiers in JFR events**: Using `int deviceId` is optimal for JFR varint encoding but requires a mapping table from device names/UUIDs to compact integer IDs. How is this mapping managed, and does it persist across restarts? The alternative — short string identifiers — costs more per event but avoids the mapping layer.