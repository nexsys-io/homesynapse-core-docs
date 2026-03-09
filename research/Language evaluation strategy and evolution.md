# HomeSynapse Core — Language Evaluation and Evolution Strategy

**Document type:** Research artifact
**Status:** Draft
**Purpose:** Definitive evaluation of implementation language candidates for HomeSynapse Core, recording the decision to retain Java 21 LTS (LTD-01) for the MVP core, the post-MVP evolution strategy toward a mixed Java/Kotlin codebase, and forward-compatible core amendments that enable multi-home, multi-client, and cloud-enhanced product tiers without structural rework
**Feeds into:** LTD-01 (confirmation), Phase 2 transition planning, Companion app architecture, Cloud services architecture, NexSys product planning, Doc 14 (Master Architecture Document)
**Dependencies:** Architecture Invariants v1 (all categories), Locked Decisions Register v1 (all 17 LTDs), Docs 01–09 (subsystem designs), Portability Architecture v1, Identity and Addressing Model v1, Glossary v1
**Date:** 2026-03-08
**Author:** HomeSynapse Core Architecture

---

## 0. Executive Summary

Four implementation languages were evaluated for HomeSynapse Core: Java 21 LTS (current lock, LTD-01), Kotlin/JVM, Rust, and Go. The evaluation was conducted across six axes weighted by NexSys strategic importance: runtime fitness for constrained hardware, integration developer recruitment, solo developer velocity, companion app synergy, IoT library ecosystem maturity, and long-term ecosystem positioning.

Three strategic conclusions emerged:

1. **Java 21 LTS remains the correct choice for the MVP core.** Nine locked design documents encode Java 21 concurrency semantics (virtual threads, carrier release on network I/O, JNI pinning on serial I/O, `Thread.interrupt()` for cancellation) at a depth that makes switching to Kotlin coroutines or any non-JVM language a design-document rework project, not a file-conversion exercise. The ergonomic gap between Java 21 and Kotlin has narrowed substantially — sealed interfaces, records, pattern matching for switch, and virtual threads deliver the type safety and concurrency primitives the architecture requires.

2. **Post-MVP, HomeSynapse should evolve toward a mixed Java/Kotlin codebase.** The core infrastructure (event bus, event store, persistence, integration supervisor, automation engine) stays Java. New modules above the core — API layer, cloud services, companion apps, integration DSL — should be Kotlin. This is not a migration with a completion date; it is a permanent, stable architecture that leverages each language's strengths within the JVM's unified bytecode runtime.

3. **Four forward-compatible core amendments should be applied during Phase 1 to prevent structural rework in v2/v3.** These are interface boundaries and schema reservations, not implementations: `actor_id` on the event envelope, `home_id` in the identity model, authenticated configuration write surface in the REST API, and an `Authenticator` interface boundary in the API layer.

This document records the full evaluation, the reasoning behind each decision, the conditions under which decisions should be revisited, and the concrete migration plan.

---

## 1. Evaluation Methodology

### 1.1 Candidates

| Candidate | Version | Runtime | Primary Argument |
|---|---|---|---|
| **Java 21 LTS** | JDK 21.0.x (Temurin/Corretto) | HotSpot JVM | Incumbent. Virtual threads, sealed interfaces, records, pattern matching. Mature ARM64 JIT. |
| **Kotlin/JVM** | 2.1.x | HotSpot JVM (shared with Java) | Same runtime as Java plus null safety, coroutines, data classes, extension functions, KMP for companion apps. Full Java interop. |
| **Rust** | 1.8x (stable) | Native (no runtime) | Zero-cost abstractions, no GC, 10–20× lower memory than JVM. Ownership model for compile-time memory safety. |
| **Go** | 1.2x | Native (minimal runtime) | Goroutines, fast compilation, simple spec, ~80–150 MB idle RSS, strong networking ecosystem. |

### 1.2 Evaluation Axes (Weighted)

| Axis | Weight | Rationale |
|---|---|---|
| Runtime fitness for constrained hardware | Table stakes | Any candidate that cannot run within RPi 5 4 GB constraints is eliminated. |
| Integration developer recruitment | 30% | Self-identified #1 strategic risk. HomeSynapse needs hundreds of third-party integrations to compete. |
| Solo developer velocity | 25% | Nick is the sole developer for 12–24 months. |
| Companion app synergy | 15% | Code sharing between hub and companion reduces maintenance burden. |
| IoT library ecosystem maturity | 15% | Zigbee, MQTT, SQLite, JSON serialization must be production-quality. |
| Long-term ecosystem positioning | 15% | 10-year horizon: language trajectory, stewardship, community health. |

### 1.3 Source Hierarchy

1. Published ARM64 benchmarks with reproducible methodology (TechEmpower, Phoronix)
2. Language specifications and official documentation (Inside.java, Kotlin Blog, Rust Blog, Go Blog)
3. Production experience reports (Netflix, LinkedIn, openHAB, Home Assistant engineering blogs)
4. Community signal (Stack Overflow 2025 Survey, JetBrains Developer Ecosystem Survey, TIOBE)
5. Market research (SlashData State of the Developer Nation)

---

## 2. Runtime Performance Assessment

### 2.1 Steady-State Memory (RSS on RPi 5 with Representative Workload)

Benchmark workload: 60 simulated Zigbee devices reporting every 5–30 seconds, 10 active automations, 1 SQLite database with 1M events, 50 concurrent WebSocket subscribers, REST API at 10 req/s.

| Metric | Java 21 (G1GC) | Kotlin/JVM (G1GC) | Rust (Tokio) | Go |
|---|---|---|---|---|
| Steady-state RSS | 350–550 MB | 370–580 MB | 15–50 MB | 80–150 MB |
| % of 4 GB RAM | 9–14% | 9–15% | 0.4–1.3% | 2–4% |
| With zigbee2mqtt sidecar | 430–640 MB | 450–670 MB | 95–140 MB | 160–240 MB |
| Headroom for OS + SQLite cache | ~3.3–3.5 GB | ~3.3–3.5 GB | ~3.8–3.9 GB | ~3.7–3.8 GB |

Kotlin/JVM RSS is 10–30 MB higher than Java due to Kotlin stdlib metadata and coroutine machinery when used. When running with virtual threads (Java-style concurrency), overhead is <5 MB — within measurement noise.

Rust uses 10–20× less memory than JVM candidates. Go uses 3–5× less. Both leave substantially more headroom for data-heavy plugins and out-of-process services.

### 2.2 GC Pause Characteristics

| Metric | Java 21 (G1GC) | Java 21 (ZGC) | Rust | Go |
|---|---|---|---|---|
| p99 GC pause | 50–100 ms | <1 ms | N/A (no GC) | <0.1 ms |
| p99.9 GC pause | 100–200 ms | <1 ms | N/A | <0.5 ms |
| Meets latency budget | Yes (G1 within tolerance) | Yes (comfortably) | Yes | Yes |

LTD-01 specifies G1GC. ZGC's colored-pointer overhead (5–15% of heap) is prohibitive on the Constrained tier per LTD-01's rationale. On the Enhanced tier (16+ GB servers), ZGC is viable and recommended. G1GC's 50–100 ms p99 pauses are within the automation latency budget (<50 ms p99 for evaluation, per Doc 07 §13.3) only because automation evaluation itself takes <5 ms, so a GC pause during evaluation is tolerable. If profiling reveals GC pauses coinciding with automation evaluation under heavy telemetry load, the mitigation is off-heap telemetry buffers (§6.1 of this document), not a GC switch.

### 2.3 Startup Time

| Metric | Java 21 (AppCDS) | Kotlin/JVM (AppCDS) | Rust | Go |
|---|---|---|---|---|
| Cold start to first event | 0.8–2 s | 1–2.5 s | 1–10 ms | 5–50 ms |
| Warm start | 0.5–1.5 s | 0.7–1.8 s | 1–10 ms | 5–50 ms |
| Plus 10K event replay | +2–5 s | +2–5 s | +0.5–2 s | +1–3 s |

All candidates meet the <5 second startup target (LTD-01). Rust and Go are two orders of magnitude faster for the runtime itself, but event replay dominates total startup time regardless of language.

### 2.4 Long-Running Process Stability (>30 Days on ARM64)

JVM processes can and do run for months in production (Netflix, LinkedIn). Known risks requiring mitigation: native memory fragmentation via glibc malloc (resolved by `LD_PRELOAD=libjemalloc.so`), metaspace growth from classloader churn (bounded by `-XX:MaxMetaspaceSize=128m` per LTD-01), and JIT deoptimization storms (rare, documented in long-running JVMs but not specific to ARM64).

Rust and Go are structurally advantaged — no GC heap fragmentation, no JIT deoptimization, no metaspace. Rust's Tokio runtime and Go's goroutine scheduler are both designed for indefinite operation.

### 2.5 Performance Verdict

No candidate is eliminated. Rust is the clear winner on raw resource efficiency. Go is excellent. Java/Kotlin are adequate with tuning but consume a material fraction of RPi 5's constrained RAM. The JVM's steady-state JIT optimization compensates for higher baseline memory in throughput-bound workloads, but memory, not throughput, is the binding constraint on a 4 GB system.

---

## 3. IoT Library Ecosystem Assessment

### 3.1 Zigbee Coordinator Libraries (Critical Path)

| Language | Library | Status | Coordinator Support | Production Usage |
|---|---|---|---|---|
| **Java** | com.zsmartsystems.zigbee | Maintenance mode (last update May 2024). 149 stars, 87 forks. | ZNP (TI CC2652) + EZSP (Silicon Labs EFR32). Full ZCL with auto-generated clusters. | openHAB — thousands of installations. |
| **Kotlin** | Same via Java interop | Works. No coroutine-specific issues. | Same as Java. | Same as Java (via openHAB). |
| **Rust** | zigbee-rs | Explicitly "not yet functional." ezsp crate: 3,521 total downloads. | Incomplete. | None. |
| **Go** | shimmeringbee/zstack | API marked "unstable and should not yet be relied upon." | Partial ZNP. | None at production scale. |

**Critical finding:** Java/Kotlin has the only production-grade native Zigbee coordinator library among the four candidates. However, this advantage is substantially neutralized by zigbee2mqtt as a sidecar process, which supports 4,000+ devices from 400+ brands. Doc 08 (Zigbee Adapter) was designed with both native and sidecar architectures in scope. The sidecar approach is recommended regardless of core language because it maximizes device compatibility.

### 3.2 SQLite Bindings

| Language | Library | Bundled SQLite | Feature Coverage | Notes |
|---|---|---|---|---|
| **Java/Kotlin** | xerial sqlite-jdbc | 3.51.x | WAL, BLOB PK, prepared statement cache, JSON functions, user-defined functions, thread-safe writer/reader. | All LTD-03 requirements met. |
| **Rust** | rusqlite | 3.51.x (bundled via libsqlite3-sys) | Full feature coverage. Compile-time safety for prepared statements. | Excellent quality. |
| **Go** | mattn/go-sqlite3 (CGo) | 3.51.x | Full coverage. CGo adds build complexity. | Production quality. |
| **Go** | modernc.org/sqlite (pure Go) | 3.51.x (transpiled) | Full coverage. No CGo. Possible subtle behavioral differences. | Growing adoption. |

All candidates have production-quality SQLite bindings. This is not a differentiator.

### 3.3 JSON Serialization

| Language | Library | Discriminated Unions | Compile-Time Safety | ARM64 Performance |
|---|---|---|---|---|
| **Java** | Jackson 2.18+ (Blackbird) | `@JsonTypeInfo` + sealed interfaces. Runtime reflection. | Runtime (errors at deserialization time). | Mature, well-optimized. |
| **Kotlin** | kotlinx.serialization | Built-in discriminator for sealed classes. Compile-time codec generation. | Compile-time (no reflection, errors at build time). | Excellent. No reflection overhead. |
| **Rust** | serde + serde_json | Native enum discriminator via `#[serde(tag = "type")]`. | Compile-time. | Best-in-class throughput. |
| **Go** | encoding/json | No native sum types. Manual dispatch or interface-based polymorphism. | Runtime. Missing cases are silent. | Adequate. |

Kotlin's kotlinx.serialization and Rust's serde are meaningfully superior to Java's Jackson for event-sourced systems where serialization correctness is critical. Go's lack of sum types is a genuine weakness for discriminated event hierarchies. For the MVP, Jackson with sealed interfaces is adequate — LTD-08 locks this choice. Post-MVP, kotlinx.serialization in the KMP shared modules is recommended.

### 3.4 Broader IoT Library Matrix

| Category | Java/Kotlin (JVM) | Rust | Go |
|---|---|---|---|
| MQTT client | Eclipse Paho (mature, MQTT 5.0) | rumqttc (pure Rust, async, MQTT 5.0) | paho.mqtt.golang (mature) |
| HTTP server | Javalin / Ktor / Vert.x | axum (Tokio team, 20K+ stars) | net/http (stdlib) |
| WebSocket | Ktor WebSocket / Java-WebSocket | tokio-tungstenite | gorilla/websocket |
| YAML 1.2 | SnakeYAML Engine | serde_yaml | go-yaml/v3 |
| JSON Schema | networknt/json-schema-validator | jsonschema-rs | gojsonschema |
| mDNS/DNS-SD | JmDNS (mature since 2002) | mdns-sd (beta) | hashicorp/mdns |
| TLS/crypto | JCE + Bouncy Castle | rustls | crypto/tls (stdlib) |
| Observability | JFR + Micrometer + SLF4J | tracing + metrics | pprof + expvar |
| Matter protocol | JNI bindings (CHIP SDK) | rs-matter (pure Rust, official org) | No viable implementation |
| Event sourcing | Axon Framework (gold standard) | cqrs-es (growing) | Watermill (6K stars) |

Java/Kotlin leads on breadth and maturity for IoT-specific libraries. Rust leads on Matter protocol support (rs-matter is a strategic asset for the 10-year horizon). Go leads on infrastructure-adjacent tooling (Prometheus, Telegraf ecosystem).

### 3.5 Ecosystem Verdict

Java/Kotlin wins on IoT ecosystem maturity. All critical path libraries (Zigbee, SQLite, MQTT, JSON) are production-quality. Rust is the strongest runner-up, with the Matter protocol as its unique advantage. Go is adequate but lacks native Zigbee and Matter support. The zigbee2mqtt sidecar strategy equalizes the Zigbee advantage across all candidates.

---

## 4. Developer Recruitment Assessment

### 4.1 The Home Assistant Benchmark

Home Assistant has 21,000+ unique contributors, 3,000+ integrations, and 2 million+ active installations. openHAB (Java-based, launched earlier) has approximately 2,000 contributors and 400 bindings. This 10× contributor gap is the most important data point in this evaluation.

**Causal analysis:** The gap is primarily attributable to the combination of Java + OSGi + Maven + a complex binding framework, not Java alone. openHAB's community repeatedly cites the toolchain as a barrier. Home Assistant's Python-based integration framework — where a developer can implement a sensor integration in 50 lines and test it with `pytest` — is the gold standard for contributor accessibility.

**Implication for HomeSynapse:** The integration SDK design matters more than the core language. Doc 05's Integration Runtime is already designed to avoid openHAB's mistakes: integrations implement a clean `IntegrationAdapter` interface, receive a scoped `IntegrationContext`, and don't need to understand the event bus, state store, or persistence layer internals. The barrier to contribution is the SDK surface, not the underlying implementation language.

### 4.2 Developer Population by Segment

| Segment | Java | Kotlin | Rust | Go |
|---|---|---|---|---|
| IoT/embedded developers | Moderate (openHAB, Eclipse IoT) | Low (few IoT projects) | Growing (Embassy, esp-rs) | Moderate (Balena, infrastructure) |
| Hobbyist/tinkerer | Low (verbose, tooling-heavy) | Low-moderate (Android tinkerers) | Very low (learning curve) | High (simple, fast) |
| Professional backend | Very high | High (growing server-side) | Moderate (growing fast) | High |
| Android developers | Declining | Dominant (Kotlin-first since 2019) | Minimal | Minimal |

Stack Overflow 2025 data: Java 30.2% professional usage, Go 16.4%, Kotlin 10.8%, Rust 13.5%. Rust is the most admired language (72%); Java is among the least admired despite high usage.

### 4.3 Learning Curve for Python/JavaScript Developers

| Concept Required | Java 21 | Kotlin | Rust | Go |
|---|---|---|---|---|
| Type system basics | 1–2 weeks | 1 week | 2–4 weeks | 3–5 days |
| Concurrency model | 1 week (virtual threads) | 1–2 weeks (coroutines) | 4–8 weeks (ownership + async) | 3–5 days (goroutines) |
| Build tooling | 1–2 weeks (Gradle) | 1–2 weeks (Gradle) | 1 week (Cargo) | 2–3 days (Go modules) |
| Error handling | 1 week | 1 week | 2–3 weeks (Result, ?) | 3–5 days (value, error) |
| **Total to first integration** | **3–5 weeks** | **3–4 weeks** | **2–4 months** | **1–2 weeks** |

Go has the lowest barrier. Kotlin has moderate friction that's offset by better IDE support than Go. Java is slightly slower than Kotlin due to more ceremony. Rust's borrow checker and ownership model represent a fundamental paradigm shift that blocks most contributors for weeks to months.

### 4.4 Recruitment Verdict

Integration developer recruitment is not solved by the core language choice. It is solved by the integration SDK design. A simple Java interface with good documentation, a starter template, and a test harness is more important than whether the core uses `data class` or `record`. The recommended two-tier SDK approach (Java interface for maximum reach, Kotlin DSL for maximum ergonomics) decouples the recruitment axis from the core language.

---

## 5. Companion App and Code Sharing Assessment

### 5.1 Architectural Baseline

The Portability Architecture v1 (§3) establishes that the companion app is not a HomeSynapse instance. It is a thin client that shares type definitions with the core, not runtime code. The companion's architecture does not constrain the core language choice. Three companion options are documented:

- Option A: Kotlin/Android native with code-generated types from Java definitions
- Option B: Java 21 on Android via desugaring (limited, no virtual threads on ART)
- Option C: Cross-platform via Kotlin Multiplatform (KMP) or Flutter

The Gradle module structure (Portability Architecture §3.6) already separates shared type modules (`homesynapse-event-types`, `homesynapse-device-types`, `homesynapse-serialization`, `homesynapse-api-client`) from hub-only modules.

### 5.2 Cross-Platform Code Sharing Viability

| Approach | Shared Code % | Build Complexity | Production Adopters | Type Fidelity |
|---|---|---|---|---|
| KMP (Kotlin) | 40–80% (data + network + offline) | Medium (Gradle multiplatform) | Netflix, McDonald's, Forbes, CashApp | Full Kotlin types across all targets |
| UniFFI (Rust) | 30–50% (non-UI logic) | High (cross-compilation + FFI generation) | Mozilla Firefox | Rust enums → Kotlin/Swift enums |
| gomobile (Go) | 15–30% | Low-medium | Rare | Primitives only |
| Java only | 0% cross-platform | N/A | N/A | N/A |

KMP is the only viable cross-platform approach that shares types, serialization, and networking code across JVM hub, Android, and iOS targets with full type fidelity. Compose Multiplatform (Stable for iOS as of May 2025) extends this to shared UI code.

### 5.3 Companion Verdict

KMP is the recommended companion app technology. It does not require the hub core to be written in Kotlin — the shared type modules can be Kotlin while the hub's internal modules remain Java. The Gradle multi-module structure supports mixed Java/Kotlin compilation natively. The companion app strategy is decoupled from the core language decision.

---

## 6. Performance Optimization Strategy for Data-Heavy Local Operation

### 6.1 Layer 1: Off-Heap Data Structures for the Telemetry Pipeline

The telemetry ring store (Doc 04's modular-rowid ring buffer) is the highest-throughput write path. Under sustained telemetry load (60 devices × 12 events/minute = 720 events/minute at ~200 bytes each), heap allocation of event objects creates GC pressure that accumulates over months.

**Optimization:** Use `java.nio.ByteBuffer.allocateDirect()` for the telemetry write path. Serialize telemetry events directly into a direct byte buffer that lives outside the JVM heap in native memory. Write to SQLite from the buffer. The heap never sees the raw telemetry data.

**Estimated impact:** 50–100 MB heap reduction under sustained telemetry load, plus significantly reduced GC frequency. This is an implementation optimization within Doc 04's persistence layer — no design document changes required.

**Language dependency:** Pure Java. `ByteBuffer.allocateDirect()` is a JDK API.

### 6.2 Layer 2: Process Isolation for Data-Heavy Plugins

Doc 05's Integration Runtime specifies in-process virtual thread supervision as the Constrained-tier isolation mechanism, but INV-RF-01 explicitly states the isolation boundary is an implementation detail. For data-heavy plugins (energy optimization solver, camera motion detection, voice assistant), process isolation provides:

- Per-plugin memory budgets enforced by cgroups/systemd `MemoryMax=`
- OS-level OOM kill of a misbehaving plugin without affecting the core process
- Language-agnostic plugin authoring (Java, Python, Rust, Go — any language that can communicate over a Unix domain socket or localhost HTTP)
- Independent JVM lifecycle (if the plugin is JVM-based, its GC doesn't contend with the core's GC)

**Cost:** Each out-of-process JVM plugin requires ~150–200 MB RSS for its own JVM baseline. On a 4 GB Pi, 2–3 out-of-process JVM plugins alongside the core is feasible. Non-JVM plugins (Rust, Go) require only 10–30 MB each, making them significantly more dense.

**WASM plugin host (future):** A WebAssembly runtime (Wasmtime via JNI or GraalWasm) can sandbox plugin execution with configurable memory ceilings (e.g., 64 MB per plugin), run plugins compiled from Rust/Go/AssemblyScript/C, and share the host process's address space without sharing its heap. This provides in-process density with out-of-process isolation. Evaluation deferred to Phase 3+.

**Language dependency:** The process isolation model is language-independent by design. The WASM host is callable from Java via JNI (Wasmtime) or native (GraalWasm).

### 6.3 Layer 3: Selective Rust Extraction via Project Panama FFI

If profiling during Phase 3 validation identifies specific subsystems (event store write path, telemetry aggregation engine, state projection rebuild) consuming disproportionate CPU or memory, those specific functions can be extracted into a native Rust library callable from Java via `java.lang.foreign` (Project Panama FFI, finalized in Java 22, preview in 21).

**Example:** `append_event(byte[] serialized_event) -> long global_position` and `rebuild_projection(long from_position) -> byte[] snapshot` implemented as a Rust `.so` for ARM64, called from the existing Java persistence layer. The rest of the system is unaffected.

**Language dependency:** Java + Rust interop via Panama FFI. This is the same pattern SQLite itself uses (C library callable from any language).

**Trigger criteria:** Only warranted if profiling shows a specific subsystem consuming >30% of CPU or >25% of allocated heap under representative workload. This is an optimization, not an architectural decision.

### 6.4 Layer 4: RPi 5 8 GB as Recommended Power-User Target

For the data-heavy, many-plugin scenario (100+ devices, energy optimization, camera integrations), the 8 GB RPi 5 provides sufficient headroom: `-Xmx3g` for the core JVM, 512 MB SQLite page cache, zigbee2mqtt sidecar, 2–3 out-of-process plugins, and 2+ GB for OS. The 8 GB model costs approximately $15 more than the 4 GB variant.

**Recommendation:** LTD-02 should be amended to specify RPi 5 8 GB as the "recommended for power users" target while retaining 4 GB as the minimum supported configuration and Pi 4 4 GB as the validation floor. This is a documentation change, not an architectural change.

---

## 7. Multi-Client Architecture (Always-Connected Devices ↔ Hub ↔ Companions)

### 7.1 Communication Patterns

The always-connected scenario involves three simultaneous communication patterns with different architectural homes:

**Hub ↔ IoT devices:** Handled by integrations (Zigbee coordinator, MQTT, HTTP polling, Matter). The hub is the always-on authority. Fully designed in Docs 05, 08. Pure Java. Not affected by language choice.

**Hub ↔ companions over LAN:** WebSocket (Doc 10) for real-time state push, REST (Doc 09) for commands and queries. Virtual threads — each WebSocket connection costs ~1 KB. 10 simultaneous companion connections costs 10 KB heap. Scales trivially. Pure Java.

**Hub ↔ companions over internet:** Requires a cloud relay or direct connection (WireGuard/Tailscale). The hub side is another integration — a "cloud bridge" subscriber that filters events and pushes to the cloud service. Pure Java, virtual thread. The cloud relay service runs on servers (no Pi constraints) and handles concurrent hub + companion connections with structured cancellation semantics.

### 7.2 Language Architecture by Communication Layer

| Layer | Language | Rationale |
|---|---|---|
| Hub core (event bus, persistence, automation) | Java 21 | Virtual thread semantics, long-running stability, existing design corpus. |
| Hub API layer (REST + WebSocket serving) | Kotlin (post-MVP) | Ktor for serving, kotlinx.serialization for type-safe encoding. New code, no existing Java design to preserve. |
| Cloud relay service | Kotlin | Structured concurrency with cancellation propagation. `CoroutineScope` per user session. Ktor for server framework. |
| Cloud subscription/push service | Kotlin | Shares KMP type modules with companion. No Pi constraints. |
| Companion data/network layer | Kotlin (KMP) | Shared between Android, iOS, and Desktop. Ktor Client, kotlinx.serialization, SQLDelight for offline queue. |
| Companion UI — Android | Kotlin (Compose) | Platform-native, shares KMP data layer. |
| Companion UI — iOS | Swift (SwiftUI) | Platform-native, consumes KMP shared module via Kotlin/Native. |
| Companion UI — Desktop (Mac/Windows) | Kotlin (Compose for Desktop) | Shares code with Android Compose. Renders via Skia. |
| Web UI | TypeScript (React or SvelteKit) | Browsers run JavaScript. Types generated from OpenAPI spec (Doc 09), not KMP. |

### 7.3 Companion App Architecture

The companion app serves five functions: state viewing (WebSocket subscription), command dispatch (REST API), automation monitoring (REST queries), event stream observation (WebSocket), and offline command queuing (local SQLite via SQLDelight).

The KMP shared module contains:
- Event and device type definitions (Kotlin data classes matching the hub's Java records)
- kotlinx.serialization codecs for all types (compile-time, no reflection, all KMP targets)
- Ktor-based WebSocket client with reconnection state machine (connected → reconnecting → offline → syncing)
- Ktor-based REST client for commands and queries
- Offline command queue backed by SQLDelight (KMP-compatible SQLite)
- Connection state machine

Estimated code sharing: 50–60% between Android and iOS (entire data/network/offline layer). Platform-specific: UI, push notifications (FCM/APNs), background execution (Doze/Background App Refresh).

### 7.4 Elderly-Optimized UX Variant

The same KMP shared module supports a simplified companion UI for elderly or non-technical users. The data layer is identical — the simplified variant presents a different Compose composition with large touch targets, high contrast, status-oriented display ("is the house okay?" rather than entity lists), and proactive alerts. This is a UI concern, not a data architecture concern.

---

## 8. Multi-Home Management Architecture

### 8.1 Scenario Description

A user manages their own HomeSynapse hub and their elderly parent's hub from a single interface (desktop, mobile, or web). Each hub is the local authority for its own home (INV-LF-01 preserved). The management plane spans both homes via a cloud service.

### 8.2 Architectural Requirements

**Multi-home management from a single identity.** The user needs one interface showing both homes with the ability to switch between them and manage the remote home. Each hub remains locally authoritative.

**Remote hub access.** The user reaches the remote hub's REST and WebSocket APIs across the internet via a cloud relay, with low latency and graceful connectivity interruption handling.

**Delegated authorization.** The remote hub recognizes the user as an authorized manager with specific permissions. The elderly parent has a simpler permission set.

**Client diversity.** Web browser, Mac desktop, Windows desktop, Android, iOS, iPad, wall-mounted tablet — each needs real-time state, command dispatch, and offline resilience.

### 8.3 What the Current Core Trajectory Handles

The event-sourced, API-driven architecture handles more of this than expected. Each hub is self-contained with REST (Doc 09) and WebSocket (Doc 10) APIs as the integration surface. A remote client through a cloud relay looks identical to a local client from the hub's perspective. The event model, state store, device model, and automation engine do not need to know whether the client is on the LAN or across the internet.

### 8.4 What the Current Core Trajectory Does Not Handle

**Identity and authorization.** The current architecture is single-user, LAN-only. Doc 09 defers authentication to Tier 2. Multi-home requires: user identity, home identity, user-home bindings with role-based permissions, and token-based authentication across the cloud relay.

**Remote configuration push.** Doc 06 assumes local filesystem editing. Remote management requires authenticated write endpoints in the REST API that call the same validation and hot-reload path, with optimistic concurrency control.

**Multi-home WebSocket multiplexing.** A multi-home client needs either separate WebSocket connections per hub (simpler) or a single multiplexed connection through the cloud relay (better UX for reconnection and home-switching).

### 8.5 Design Invariants Preserved

**The event model stays single-home.** Events do not carry `home_id`. Each hub produces and stores its own events. Multi-home correlation happens in the cloud service and client apps, not in the hub core. Placing `home_id` on events would imply the hub might store events from other homes, violating the local-authority model (INV-LF-01) and opening consistency concerns.

**The automation engine stays local.** Cross-home rules ("when mom's door unlocks after 10 PM, notify me") are cloud-side rules subscribing to the hub's event stream and triggering push notifications — not cross-hub automation engine operations. This preserves the automation engine's deterministic replay property (Doc 07 §3.10, INV-TO-02).

**The persistence layer does not gain multi-writer capability.** Each hub has one SQLite database with single-writer discipline (LTD-03). The cloud service uses PostgreSQL for user accounts and home metadata. These are separate services with separate constraints.

---

## 9. Forward-Compatible Core Amendments

Four amendments should be applied during Phase 1 to prevent structural rework in v2/v3. These are interface boundaries and schema reservations — not implementations.

### 9.1 Amendment A: `actor_id` on the Event Envelope

**Target:** Doc 01 (Event Model & Event Bus), event envelope schema.

**Change:** Add an optional `actor_id` field (ULID, nullable) to the event envelope. When null, the actor is the system or local user. When set, it identifies the authenticated user who initiated the causal chain.

**Behavior:** The `actor_id` is set at the API boundary (Doc 09) from the authentication token and propagates through `publishDerived()` via the causal chain. During local-only single-user operation (Tier 1), it defaults to a well-known `LOCAL_USER` sentinel.

**Cost:** One nullable BLOB(16) column in the events table. NULL for all MVP events. Zero behavioral change.

**Benefit:** Enables the full multi-user audit trail ("who did what in mom's house") without retrofitting an envelope field after events are persisted — every historical event would otherwise lack the field, and projections would need to handle both schemas.

**Invariant alignment:** INV-TO-01 (observable — actor identity is part of observability), INV-ES-06 (explainable — who caused this event chain).

### 9.2 Amendment B: `home_id` in the Identity Model

**Target:** Identity and Addressing Model v1.

**Change:** Add a `home_id` concept: a ULID uniquely identifying a HomeSynapse installation. Generated on first boot, stored in system configuration. Appears in the API's `/system/info` endpoint (Doc 09).

**Behavior:** The hub does not use `home_id` internally for event routing or storage. It is an external identity for the management plane — used by the cloud relay to route connections and by multi-home clients to distinguish event streams.

**Cost:** One ULID in configuration. One field in the `/system/info` response.

**Benefit:** Prevents the need to retroactively assign home identities when multi-home support is implemented. Clients can immediately distinguish between event streams from different homes.

### 9.3 Amendment C: Authenticated Configuration Write Surface

**Target:** Doc 09 (REST API), configuration endpoints.

**Change:** Design the configuration endpoints with write capability in mind, even if the Tier 1 implementation is read-only. Specifically: include version/hash fields in GET responses for configuration resources (automations, integrations, device settings), and reserve PUT/PATCH methods with optimistic concurrency control semantics (reject if `If-Match` header doesn't match current version).

**Cost:** Additional response fields in configuration GET endpoints. Reserved HTTP methods that return 501 (Not Implemented) in Tier 1.

**Benefit:** When remote configuration management is implemented in Tier 2, the API contract doesn't change — only the implementation behind the existing endpoints. Clients built against the Tier 1 API already have the version fields needed for optimistic concurrency.

### 9.4 Amendment D: `Authenticator` Interface Boundary

**Target:** Doc 09 (REST API), request processing pipeline.

**Change:** Define an `Authenticator` interface that every API request passes through, returning an `AuthContext` record (actor_id, home_id, permission set) or rejecting the request.

**Tier 1 implementation:** `LocalTrustAuthenticator` — every LAN request receives a `LOCAL_USER` AuthContext with full permissions. Zero overhead — a singleton that always returns the same context.

**Tier 2 implementation:** Validates JWT tokens issued by the cloud authentication service.

**Cost:** One interface, one record, one singleton implementation. All API handlers written in terms of `AuthContext` rather than assuming unauthenticated access.

**Benefit:** The API handler code never changes when authentication is added. The `AuthContext` parameter is already threaded through every handler, so adding permission checks is additive, not structural.

---

## 10. LTD-01 Confirmation and Decision Record

### 10.1 Decision

**Java 21 LTS is confirmed as the implementation language for the HomeSynapse Core MVP.** LTD-01 is retained without amendment.

### 10.2 Decisive Factors

1. **Design corpus depth.** Nine locked design documents encode Java 21 virtual thread semantics at the concurrency model level — carrier release behavior, JNI pinning, `Thread.interrupt()` for cancellation, `Thread.sleep()` for zero-cost delays. Switching to Kotlin coroutines would require design document rework across Docs 05, 07, and 08. The cost exceeds the benefit.

2. **Java 21 closes the expressiveness gap.** Sealed interfaces + records + pattern matching for switch deliver the type safety features that historically justified Kotlin for domain modeling. The remaining Kotlin advantages (null safety, `copy()`, extension functions, coroutines) are ergonomic improvements, not architectural enablers.

3. **IoT ecosystem maturity.** Java has the only production-grade Zigbee coordinator library (zsmartsystems.zigbee), mature MQTT (Eclipse Paho), mature SQLite (xerial), and the broadest IoT library ecosystem among the four candidates.

4. **Integration recruitment is SDK-dependent, not language-dependent.** The integration SDK design (Doc 05's `IntegrationAdapter` interface + `IntegrationContext`) determines contributor accessibility. A well-designed Java interface is more accessible than a poorly-designed Kotlin one. The two-tier SDK approach (Java interface + Kotlin DSL) addresses this axis without changing the core language.

5. **Companion app strategy is decoupled.** The Portability Architecture explicitly established that the companion shares type definitions, not runtime code. KMP shared modules can be Kotlin regardless of the hub core's language. The Gradle multi-module structure supports this natively.

### 10.3 Conditions for Revisiting

| Condition | Threshold | Response |
|---|---|---|
| Steady-state RSS exceeds budget | >2.0 GB on RPi 5 with representative workload | Apply Layer 1 (off-heap telemetry), then Layer 2 (process isolation). If still exceeded, evaluate ZGC or Rust extraction (Layer 3). |
| GC pauses impact automation latency | p99 automation evaluation >50 ms correlated with GC | Apply Layer 1 (off-heap telemetry reduces GC pressure). If still impacted, evaluate ZGC for Enhanced tier. |
| Virtual thread pinning blocks scaling | >5% of carrier threads pinned for >100 ms | Identified in LTD-01 reversal criteria. Monitor with JFR `jdk.VirtualThreadPinned` events. If unresolvable, evaluate Java 25+ (which resolves `synchronized` pinning). |
| Integration contributor count below threshold | <5 community integrations within 6 months of public release | Evaluate scripting-friendly integration layer: GraalJS (JavaScript), Kotlin DSL, or WASM plugin host. This is additive, not a language change. |
| Kotlin coroutines prove necessary for a subsystem | A new subsystem design cannot be cleanly expressed with virtual threads | Add `kotlin("jvm")` to that specific module. Mixed compilation is the designed evolution path. |

### 10.4 What This Decision Is Not

This is not a decision against Kotlin. It is a decision that the MVP core stays Java while the broader system evolves toward mixed Java/Kotlin. The two languages coexist on the JVM by design. The migration path is always open, file by file, module by module, on the developer's schedule rather than as a forced rewrite.

---

## 11. Post-MVP Language Evolution Plan

### 11.1 Permanent Architecture: Mixed Java/Kotlin on JVM

The target state is not "all Kotlin" or "all Java." It is a layered language architecture where each language is used where it provides the most value:

| Layer | Language | Rationale | Changes |
|---|---|---|---|
| Core infrastructure (event bus, event store, persistence, integration supervisor, automation engine) | Java 21 | Virtual thread concurrency semantics. Long-running stability. Correctness over ergonomics. | Never unless specific profiling or design data justifies it. |
| API layer (REST + WebSocket serving) | Kotlin (post-MVP) | Ktor for serving, kotlinx.serialization for compile-time type-safe encoding. Less boilerplate for route handlers. | New implementation when API layer is built in Phase 3. |
| Integration SDK — public interface | Java | Maximum reach. Any JVM developer can implement a Java interface. | Stable from Phase 2. |
| Integration SDK — ergonomic DSL | Kotlin | Builder pattern, extension functions, coroutine-friendly callbacks for Kotlin-fluent developers. | Added post-MVP as a layer on top of the Java interface. |
| Cloud services (relay, subscription, push) | Kotlin | Structured concurrency for session management. Shares KMP type modules with companion. Server hardware, no Pi constraints. | Written in Kotlin from day one. |
| Companion data/network layer | Kotlin (KMP) | Shared across Android, iOS, Desktop. Ktor Client, kotlinx.serialization, SQLDelight. | Written in Kotlin from day one. |
| Companion UI — Android | Kotlin (Compose) | Platform-native. Shares KMP data layer. | Written in Kotlin from day one. |
| Companion UI — iOS | Swift (SwiftUI) | Platform-native. Consumes KMP shared module. | Written in Swift from day one. |
| Companion UI — Desktop | Kotlin (Compose for Desktop) | Shares code with Android Compose. Renders via Skia on Mac and Windows. | Written in Kotlin from day one. |
| Web UI | TypeScript | Browsers run JavaScript. Types from OpenAPI spec. | Separate codebase. |

### 11.2 Migration Stages

**Stage 1 (when first additional developers join):** Add `kotlin("jvm")` to the Gradle build convention plugin. Write all new test utilities in Kotlin. Implement the Kotlin integration DSL wrapper. Core production code stays Java. Time cost: ~1 week.

**Stage 2 (when companion app is built):** Convert shared type modules (`homesynapse-event-types`, `homesynapse-device-types`, `homesynapse-serialization`) to Kotlin with KMP targets. IntelliJ auto-converts records/sealed interfaces mechanically — these are data-definition modules with no concurrency logic. Rewrite `homesynapse-api-client` in Kotlin with Ktor Client and kotlinx.serialization. Build companion app in KMP Kotlin + Compose.

**Stage 3 (when cloud services are built):** Cloud relay, subscription management, push notification dispatch, and telemetry aggregation written in Kotlin from day one. Share KMP type modules with companion.

**Stage 4 (ongoing, never "completes"):** When a developer touches an existing Java module for a significant feature addition, consider converting to Kotlin if the module is above the core infrastructure line (API handlers, configuration parsing, projection logic, new automation action types). Modules below the line (event bus, persistence, integration supervisor) stay Java unless there is a specific, measured reason to convert.

### 11.3 What "Mixed Java/Kotlin" Means at Runtime

At runtime, the JVM executes bytecode. It does not know or care whether a `.class` file was compiled from `.java` or `.kt`. There is no interop overhead, no FFI boundary, no serialization barrier between Java and Kotlin modules. A Java class can extend a Kotlin class and vice versa. A Java record can be passed to a Kotlin function and matched in a `when` expression. The "mixed" architecture has zero runtime cost — it is purely a source-level concern.

Gradle's Kotlin multiplatform plugin handles compilation ordering automatically. The Kotlin compiler sees Java classes as first-class types. The Java compiler sees Kotlin classes as normal Java classes (with some nullability annotations). IDE support in IntelliJ IDEA is first-class for both languages simultaneously.

---

## 12. Competitive Positioning Summary

### 12.1 Against Home Assistant (DIY/Tech-Savvy Market)

**HomeSynapse advantages enabled by the language architecture:**
- Event-sourced core (Java) provides reliability, auditability, and deterministic replay that HA's mutable-state architecture cannot match
- Two-tier integration SDK (Java interface + Kotlin DSL) lowers contribution barrier while maintaining type safety
- Native Zigbee coordinator support (zsmartsystems.zigbee) plus zigbee2mqtt sidecar compatibility
- Companion app quality via KMP (shared data layer across Android/iOS/Desktop)

**HomeSynapse challenges:**
- HA's Python integration framework is more accessible to hobbyists than any compiled language
- HA's 21,000-contributor ecosystem is a 10+ year head start
- HA's add-on system (Docker containers) is more flexible than in-process-only plugins

**Mitigation:** The scripting-friendly integration layer (GraalJS, WASM plugins) and process-isolated plugin model address both challenges. The core's reliability advantage becomes the primary differentiator as users scale to 50+ devices and demand month-over-month stability.

### 12.2 Against Google/Apple (Consumer Market)

**HomeSynapse advantages enabled by the language architecture:**
- Local-first guarantee — everything works without internet (INV-LF-01). Neither Google nor Apple can credibly offer this because their business models depend on cloud connectivity.
- KMP companion apps can match native quality on both platforms with a fraction of the team
- Cloud services (Kotlin) share type safety end-to-end with companion and hub
- Subscription model (remote access, push notifications, cloud backup, multi-hub coordination) is architecturally natural — every event is already serialized and immutable, so streaming to a cloud endpoint is a subscriber, not a new system
- Privacy: no data leaves the home unless the user explicitly enables cloud enhancement

**HomeSynapse challenges:**
- Google/Apple have deep OS integration (Siri, Google Assistant, widgets, Thread radio in phones)
- Consumer UX expectations are extremely high — polish matters as much as functionality
- Consumer market requires zero-configuration-needed simplicity

**Mitigation:** Matter protocol support (via JNI bindings or future rs-matter integration) provides interoperability with Google/Apple ecosystems. Compose Multiplatform provides high-quality native UI on both platforms. The elderly-optimized UX variant demonstrates that the companion architecture supports radically simplified interfaces without architectural changes.

---

## 13. Eliminated Candidates: Detailed Reasoning

### 13.1 Rust — Eliminated by Integration Recruitment Axis

**Strengths acknowledged:** Rust is technically superior on constrained hardware (10–20× lower memory, zero GC, compile-time memory safety). rs-matter is a genuine strategic asset for the 10-year Matter protocol horizon. The ownership model prevents entire categories of runtime bugs.

**Elimination reasoning:** The borrow checker learning curve is incompatible with the integration developer recruitment requirement (#1 strategic risk). No significant Rust smart home hub projects exist. GitHub "smart-home" topic shows <20 Rust repos among 1,951 total. Zigbee library ecosystem is non-functional. The months-long learning curve to productivity eliminates the hobbyist contributor who represents the largest segment of the Home Assistant community.

**Preserved escape hatch:** Selective Rust extraction via Project Panama FFI for performance-critical paths (§6.3). The architecture accommodates Rust modules without requiring a full language commitment.

### 13.2 Go — Eliminated by Type System and Companion Axes

**Strengths acknowledged:** Go has the lowest contributor barrier (1–2 weeks to first integration for Python developers), excellent runtime characteristics (80–150 MB RSS, sub-millisecond GC, fast compilation), and a strong infrastructure ecosystem (Prometheus, Grafana Agent, Telegraf).

**Elimination reasoning:** Go's type system cannot express the event-sourced domain model safely. No exhaustive matching on type switches means new event variants can be silently unhandled — a data-loss bug in an event-sourced system. No sum types means discriminated event hierarchies require manual dispatch with runtime type assertions. The `(value, error)` pattern makes it easy to silently ignore errors — dangerous for a never-crash system. gomobile is not viable for companion app code sharing. A goroutine panic without `recover()` kills the entire process — there is no parent-goroutine recovery mechanism, making integration isolation structurally risky.

**Preserved insight:** Go's contributor accessibility is the benchmark. The integration SDK (regardless of core language) should target Go-level simplicity for integration authors.

### 13.3 Pure Kotlin/JVM — Eliminated for MVP, Recommended for Expansion

**Strengths acknowledged:** Kotlin is a genuinely better language than Java for new code. Null safety, sealed classes, coroutines, `when` expressions, extension functions, data class `copy()`, and KMP all provide material ergonomic improvements. kotlinx.serialization eliminates an entire class of runtime deserialization bugs.

**Elimination reasoning for MVP:** The nine locked design documents encode Java 21 virtual thread semantics at the concurrency model level. Switching to Kotlin coroutines would require design document rework across Docs 05, 07, and 08. The cost exceeds the benefit during the highest-pressure phase of development. Additionally, using Kotlin with virtual threads (rather than coroutines) — which is the zero-rework option — gives up the primary concurrency advantage that justified the switch and leaves the developer writing Java-with-Kotlin-syntax.

**Recommendation for post-MVP:** Kotlin is the right language for everything built after the core MVP ships — companion apps, cloud services, API layer, integration DSL, new modules. The mixed Java/Kotlin architecture (§11) is the target state.

---

## 14. Document Status and Governance

This is a research artifact, not a design document. It does not follow DESIGN_DOC_TEMPLATE.md and does not have a four-state lifecycle. It is a reference that informs LTD-01 retention, Phase 2 transition planning, companion app architecture, cloud services architecture, and post-MVP language strategy.

### 14.1 Invariants Cited

INV-LF-01 (local authority), INV-RF-01 (integration isolation), INV-PR-01 (constrained hardware), INV-PR-02 (quantitative performance targets), INV-PR-03 (bounded resource usage), INV-TO-01 (observable), INV-TO-02 (deterministic), INV-ES-04 (write-ahead persistence), INV-ES-06 (explainable), INV-HO-04 (self-explaining errors), INV-CE-01, INV-CE-02 (cloud enhancement optional).

### 14.2 Locked Decisions Cited

LTD-01 (Java 21 — confirmed), LTD-02 (RPi 5/Pi 4 targets), LTD-03 (SQLite WAL), LTD-04 (ULID identity), LTD-05 (event sequences), LTD-06 (delivery semantics), LTD-08 (Jackson serialization), LTD-09 (YAML 1.2 configuration), LTD-10 (Gradle multi-module), LTD-11 (no external broker), LTD-12 (Zigbee coordinator), LTD-13 (jlink + systemd), LTD-17 (in-process integration modules).

### 14.3 Design Documents Cited

Doc 01 (Event Model — envelope schema, causal chain propagation), Doc 04 (Persistence Layer — telemetry ring store), Doc 05 (Integration Runtime — hybrid thread architecture, IntegrationAdapter interface, IntegrationContext), Doc 06 (Configuration System — hot-reload), Doc 07 (Automation Engine — virtual thread per Run, delay/cancellation semantics), Doc 08 (Zigbee Adapter — serial I/O thread model), Doc 09 (REST API — endpoints, authentication boundary), Doc 10 (WebSocket API — subscription model).

### 14.4 Related Research Artifacts

Portability Architecture v1 (companion app architecture, deployment tier model, Gradle module structure).

### 14.5 PROJECT_STATUS.md Update Needed

Add entry: "Language Evaluation and Evolution Strategy v1 — Draft complete. Confirms LTD-01 (Java 21) for MVP. Documents post-MVP mixed Java/Kotlin evolution plan. Identifies four forward-compatible core amendments (actor_id, home_id, configuration write surface, Authenticator interface) for Phase 1 application. Filed in research/ directory."
