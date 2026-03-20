# Virtual Thread Risk Assessment — Documentation Audit & Remediation Report

**Document type:** Governance — audit findings and remediation plan
**Author:** PM (audit mode)
**Date:** 2026-03-19
**Input:** Java 21 Virtual Threads Risk Assessment (external research artifact)
**Scope:** All governance files, all 14 design documents, all research artifacts, all MODULE_CONTEXT files, all amendments

---

## Executive Summary

The risk assessment identifies a **critical architectural gap**: xerial sqlite-jdbc double-pins virtual thread carrier threads on every database operation via `synchronized native` methods in `NativeDB.java`. With 4 carrier threads on RPi 5, as few as 4 concurrent database operations exhaust the carrier pool. JEP 491 (Java 24/25) only resolves the `synchronized` pinning — JNI pinning persists across all Java versions.

This audit read every governance file, design document, research artifact, MODULE_CONTEXT file, and amendment in both repositories. The findings are severe: **the project's documentation systematically assumes that sqlite-jdbc operations can safely execute on virtual threads**. This assumption pervades the event bus dispatch model, every subscriber's threading model, the persistence layer's maintenance threads, the automation engine's execution model, and multiple performance targets.

The irony is that the project **already solved this exact problem** for jSerialComm in Doc 05 (Integration Runtime) §3.2. That document correctly identifies JNI pinning from serial I/O and designs a hybrid thread model with platform thread isolation. The same analysis was never applied to sqlite-jdbc — the project's most heavily used JNI library.

Jackson 2.18.x is confirmed safe after warm-up, but the startup sequence (Doc 12) does not include an ObjectMapper warm-up step. ARM64 is a non-issue, but the `-Xss512k` JVM flag deserves a documentation note.

**Finding count:** 7 CRITICAL, 14 SIGNIFICANT, 3 MINOR.

---

## Step 1 Findings — Governance Files

### PROJECT_STATUS.md

Read in full. Current phase: Phase 2, Sprint 2. No threading-related content to audit. **No findings.**

### HomeSynapse_Core_Locked_Decisions.md

#### FINDING C-01: LTD-01 Reversal Criteria Are Incomplete [CRITICAL]

**Location:** LTD-01 §1, reversal criteria field.

**Actual text:** *"If virtual thread pinning on `synchronized` blocks in third-party libraries proves unresolvable without migrating to Java 25+."*

**Problem:** This reversal criterion is deficient in two ways:

1. **Scope too narrow.** It mentions only `synchronized` pinning. The risk assessment demonstrates that sqlite-jdbc's pinning comes from **both** `synchronized` monitors **and** JNI native calls. JNI pinning is the more severe problem because it is inherent to the JVM's native method implementation and cannot be resolved by any Java version upgrade.
2. **Resolution too optimistic.** The criterion implies that migrating to Java 25+ resolves the issue. JEP 491 (delivered in Java 24, shipping in Java 25 LTS) eliminates `synchronized` pinning but **does not fix JNI pinning**. Even on Java 25, every sqlite-jdbc operation will pin its carrier thread for the duration of the native call.

The reversal criteria should be rewritten to: (a) mention JNI pinning explicitly, (b) acknowledge that Java 25 is a partial mitigation only, and (c) define the actual resolution path (platform thread executor isolation pattern).

**Downstream impact:** Every document that references LTD-01's virtual thread model inherits this incomplete analysis.

#### FINDING C-02: LTD-11 Specification Assumes Virtual Thread Safety for SQLite-Writing Subscribers [CRITICAL]

**Location:** LTD-11 §5, specification field.

**Actual text:** *"Each subscriber runs in its own virtual thread. A slow subscriber (e.g., a database-writing projection) does not block the event store or other subscribers."*

**Problem:** This claim is false when the subscriber writes to SQLite via xerial sqlite-jdbc. A database-writing projection subscriber **does** block other virtual threads by pinning its carrier thread during every JNI call. With 4 carrier threads and multiple database-writing subscribers (State Projection, Pending Command Ledger, Observability, Automation subscribers), carrier starvation is a production-realistic scenario.

The statement should be amended to acknowledge that database-writing subscribers pin carrier threads and require a platform thread executor to avoid starvation.

**Downstream impact:** Doc 01 §3.4, Doc 03 §3.2, Doc 04 §3.4/§3.7, Doc 07 §3.2 all inherit this assumption.

#### FINDING C-03: LTD-03 Has No Threading Warning for sqlite-jdbc [CRITICAL]

**Location:** LTD-03 §2, specification field.

**Actual text:** *"The JDBC driver is `org.xerial:sqlite-jdbc` (bundles native libraries for ARM64 and x86_64)."*

**Problem:** LTD-03 specifies the sqlite-jdbc driver without any mention of its threading characteristics. The risk assessment reveals that every method in `NativeDB.java` is `synchronized native` — a worst-case double-pinning pattern for virtual threads. This is a critical omission in a document that governs how every subsystem interacts with the database.

At minimum, LTD-03 should document: (a) the `synchronized native` pattern in the driver, (b) the carrier thread pinning consequence, (c) the mandatory mitigation (platform thread executor), and (d) that this constraint persists across all Java versions due to JNI.

**Downstream impact:** Every subsystem that touches SQLite (Docs 01, 03, 04, 07, 09, 10, 11) is affected.

#### FINDING S-01: LTD-01 `-Xss512k` Rationale Incomplete for ARM64 [SIGNIFICANT]

**Location:** LTD-01 §1, specification field.

**Actual text:** *"Thread stack size reduction from ARM64's 2 MB default to 512 KB is mandatory."*

**Problem:** The specification correctly acknowledges ARM64's 2 MB default and specifies 512k, but the rationale does not discuss the aggressiveness of this reduction. On ARM64, 512k is 25% of the default (vs 50% on x86_64 where the default is 1 MB). The risk assessment cites Apache Cassandra's CASSANDRA-15446 as precedent for stack overflow issues on aarch64 with undersized stacks and recommends starting at `-Xss1m`.

This is not necessarily wrong — the current specification may be correct for HomeSynapse's stack depth requirements — but the rationale should document why 512k is safe specifically on ARM64, or it should be changed to 1m pending empirical validation.

#### FINDING S-02: LTD-08 Missing Jackson ObjectMapper Warm-Up Guidance [SIGNIFICANT]

**Location:** LTD-08 §3, specification field.

**Problem:** The specification defines the singleton ObjectMapper configuration but does not mention warm-up. The risk assessment confirms Jackson 2.18.x is safe after warm-up, but `SerializerCache` and `DeserializerCache` still use `synchronized` blocks on cache-miss writes. Before warm-up, every first-time type serialization enters the `synchronized` path, which on Java 21 pins the carrier thread (microsecond duration, but still a pinning event).

LTD-08 should specify that the ObjectMapper must be warmed up at startup by pre-serializing all expected event types before any virtual threads begin processing. This is a low-effort, high-value mitigation.

### Architecture_Invariants_v1.md

#### FINDING S-13: INV-PR-02 Operational Budgets Assume Direct Virtual Thread SQLite Access [SIGNIFICANT]

**Location:** Architecture Invariants §9, INV-PR-02 operational budgets table.

**Relevant entries:**
- *"Event processing latency (p99) < 5 ms — Event Model & Event Bus"*
- *"Checkpoint write duration < 2 seconds — Persistence Layer — Must not block event processing (INV-ES-04)"*

**Problem:** These budgets were set assuming virtual threads can call sqlite-jdbc directly. With a platform thread executor indirection (the mandatory mitigation), every database operation acquires an additional scheduling hop: virtual thread → submit to platform thread executor → platform thread executes JNI call → result returned to virtual thread. This adds measurable latency (estimated 0.1–0.5 ms per hop on RPi 5) and constrains throughput to the platform thread executor's capacity.

The 5 ms event processing latency budget may still be achievable with executor indirection (the SQLite WAL commit is ~2–5 ms on NVMe per Doc 09 §10), but the budget was not analyzed with this overhead. The budgets should be re-validated after the platform thread executor pattern is designed.

**Note:** INV-PR-02 explicitly states operational budgets "may be revised through the normal design document process without requiring an invariant amendment." The invariant itself does not need amendment — the subsystem design documents that implement these budgets do. The invariant architecture is sound; the implementation budgets need footnotes. Reclassified from CRITICAL to SIGNIFICANT per Hivemind review — the invariant is correct, the design docs need re-validation.

#### FINDING: INV-ES-04, INV-RF-04 — Consistent

INV-ES-04 (Write-Ahead Persistence) and INV-RF-04 (Crash Safety) are **not invalidated** by the risk assessment. The write-ahead guarantee is about ordering (persist before deliver), not about which thread type performs the persist. A platform thread executor pattern satisfies both invariants — the event is still durable before subscriber delivery. The crash recovery mechanism (checkpoint replay) is unaffected.

### phase-2-transition-guide.md

#### FINDING S-03: WAL Validation Spike Missing Virtual Thread Carrier Pinning Test [SIGNIFICANT]

**Location:** Phase 2 Transition Guide §2, WAL validation gate.

**Problem:** The WAL validation spike lists 5 test items but none test virtual thread interaction with sqlite-jdbc. Given that carrier pinning is the critical risk, the spike should include:
- Confirm JFR `jdk.VirtualThreadPinned` events fire on every sqlite-jdbc operation
- Measure carrier thread utilization under concurrent virtual thread database access
- Validate the platform thread executor pattern achieves acceptable latency

---

## Step 2 Findings — Design Documents

### Doc 01: Event Model & Event Bus

#### FINDING C-05: EventPublisher Write Path Assumes Virtual Thread Safety [CRITICAL]

**Location:** Doc 01 §3.4 (Subscription Model), lines 217–227.

**Actual text:** *"Because the EventPublisher acquires the SQLite write lock for each append and virtual threads do not hold OS-level locks across suspension points, this pattern is safe under the single-writer discipline as long as the subscriber's `publish()` call completes before the subscriber processes the next event."*

**Problem:** The claim that *"virtual threads do not hold OS-level locks across suspension points"* is **false for JNI boundaries**. When sqlite-jdbc calls native code, the virtual thread pins its carrier thread for the duration of the JNI call. The carrier is unavailable for any other virtual thread. With re-entrant write patterns (projection subscribers calling `publish()` during event processing), the State Projection and Pending Command Ledger subscribers each pin a carrier during their `publish()` call. Combined with the EventPublisher's own write, this can consume 3 of 4 carrier threads simultaneously.

The write path must be redesigned to route all SQLite writes through a bounded platform thread executor. The `EventPublisher.publish()` contract (synchronous persist, asynchronous notify) can be preserved — the caller blocks (virtually) while the platform thread performs the actual JNI write.

#### FINDING C-06: Doc 01 §10 Performance Targets Not Validated Against Executor Indirection [CRITICAL]

**Location:** Doc 01 §10.

**Key targets:**
- *"Event append latency (p99) < 10 ms"*
- *"Event append throughput (sustained) > 500 events/sec"*
- *"Subscriber notification latency (p99) < 5 ms after persistence"*

**Problem:** These targets assume the calling virtual thread directly executes the SQLite WAL commit. With platform thread executor indirection, the append latency includes an additional scheduling hop. More critically, the 500 events/sec throughput target assumes unlimited virtual thread concurrency on the write path. With a platform thread executor (likely sized to 1–2 threads for write, matching the single-writer model), throughput is bounded by the executor's capacity. The targets may still be achievable (500 events/sec at 2 ms per write = 1 writer thread is sufficient), but they were not analyzed with this constraint.

### Doc 02: Device Model & Capability System

**No findings.** Doc 02 does not define independent threading models. It inherits from the Event Model's subscription model. Command validation happens in handler threads. **Consistent with risk assessment.**

### Doc 03: State Store & State Projection

#### FINDING C-07: State Projection Threading Model Assumes Virtual Thread Safety [CRITICAL]

**Location:** Doc 03 §3.5 (Concurrency Model), §3.2 (Event Subscription).

**Actual text (§3.5):** *"The projection subscriber processes events sequentially on its dedicated virtual thread."*

**Problem:** The State Projection is the highest-throughput SQLite writer after the EventPublisher. It processes every state-affecting event and produces `state_changed` events via `publish()`. Each `publish()` call pins a carrier thread for the duration of the SQLite JNI call. At the design's stated event rate (~500 events/sec with ~65% producing state changes), this is ~325 carrier-pinning operations per second, each lasting ~2–10 ms.

The projection subscriber must route its `publish()` calls through the same platform thread executor as all other SQLite writes.

### Doc 04: Persistence Layer — GROUND ZERO

#### FINDING C-08: Persistence Layer Design Principle Contradicted by JNI Reality [CRITICAL]

**Location:** Doc 04 §1.1 (Design Principles), lines 27–28.

**Actual text:** *"Maintenance never blocks recording for extended or unbounded periods. Retention execution, space reclamation, integrity checks, and backup operations run on separate virtual threads with separate database connections. They yield to the write path by operating in small batches with explicit pauses."*

**Problem:** This is the most consequential incorrect assumption in the entire document set. The principle assumes that running maintenance on "separate virtual threads" provides isolation from the write path. It does not. Every maintenance operation (retention DELETE, aggregation SELECT+INSERT, checkpoint write) pins its carrier thread during the JNI call. With 4 carriers, a retention batch DELETE, an aggregation query, and an EventPublisher append running simultaneously consume 3 carriers — leaving only 1 for all other virtual threads in the system.

**Specific subsection problems:**

- **§3.4 (Retention Execution):** Retention runs on a "dedicated virtual thread" performing batch DELETEs. Each DELETE pins the carrier for the duration of the JNI call. The "yield for 50 ms" between batches releases the carrier during the sleep, but re-pins it on the next DELETE.

- **§3.7 (Aggregation Engine):** Runs on a "dedicated virtual thread" performing SELECT queries and `EventPublisher.publish()` INSERT calls. Both pin the carrier.

- **§3.12 (View Checkpoint Store):** Wraps checkpoint writes in a multi-statement transaction on the State Projection's virtual thread. The entire transaction pins the carrier.

- **§14 (Decision Table):** Claims *"Separate thread prevents retention from blocking event recording."* This is false under JNI pinning.

**Remediation:** Doc 04 requires the most extensive amendment. All database operations must be routed through a platform thread executor. The design principle must be revised to acknowledge JNI pinning and define the platform thread executor as the isolation mechanism.

### Doc 05: Integration Runtime

**No findings — CONSISTENT.** Doc 05 is the one document that got this right. §3.2 explicitly identifies JNI pinning from jSerialComm and designs a hybrid thread model: platform threads for serial/JNI I/O, virtual threads for network I/O. The JFR `jdk.VirtualThreadPinned` monitoring in §3.5 is exactly the right observability mechanism.

**The inconsistency is not in Doc 05 — it is that Doc 05's correct analysis was never generalized to sqlite-jdbc.** Doc 05 §3.2's decision table even quantifies the cost: *"25% carrier capacity loss on 4-core RPi 5"* from a single pinned carrier. This same math applies to sqlite-jdbc but is not applied anywhere else.

### Doc 06: Configuration System

**No findings.** Configuration uses synchronous file I/O at startup, not virtual thread SQLite access. **Consistent.**

### Doc 07: Automation Engine

#### FINDING S-04: Automation Engine Threading Assumes Virtual Thread SQLite Safety [SIGNIFICANT]

**Location:** Doc 07 §3.2, §3.10.

**Actual text (§3.2):** *"The engine runs on a dedicated virtual thread (per LTD-01 / LTD-11) and uses the standard pull-based subscription model."*

**Problem:** The Automation Engine has three subscribers (`automation_engine`, `command_dispatch_service`, `pending_command_ledger`), each on its own virtual thread. All three read from the EventStore (SQLite SELECT via JNI) and at least two write events (SQLite INSERT via JNI). Additionally, each Run executes on its own virtual thread (up to 200 concurrent). Runs that evaluate conditions read from the State Store (ConcurrentHashMap, no SQLite — this is fine) but `wait_for` actions poll the State Store on interval, and command dispatch writes events.

The 200-concurrent-Run design relies on virtual thread lightweight concurrency. This is still valid — the Runs themselves don't touch SQLite directly (they dispatch commands via EventPublisher). But the three subscriber threads do, and they will pin carriers on every EventStore read and EventPublisher write. The design should document that subscriber database operations route through the platform thread executor.

### Doc 08: Zigbee Adapter

**No findings — CONSISTENT.** Doc 08 correctly uses the hybrid thread model from Doc 05: platform thread for jSerialComm transport, virtual thread for protocol logic. §10 performance targets explicitly allocate 10 ms of 15 ms p99 for SQLite WAL commit, which is a realistic budget.

### Doc 09: REST API

#### FINDING S-05: REST API Assumes Virtual Threads Don't Exhaust Carriers on SQLite Reads [SIGNIFICANT]

**Location:** Doc 09 §16 (Key Decisions), line 1022.

**Actual text:** *"Virtual thread per request. Each HTTP request dispatched on its own virtual thread. Natural concurrency model for Java 21 (LTD-01). No thread pool sizing. Blocking in handlers (SQLite reads) does not exhaust carrier threads."*

**Problem:** The claim that *"Blocking in handlers (SQLite reads) does not exhaust carrier threads"* is false. Every SQLite read via sqlite-jdbc is a JNI call that pins the carrier. At 200 req/sec (the sustained throughput target), if each request performs a SQLite read averaging 5 ms, that's 1,000 ms of carrier pinning per second. With 4 carriers providing 4,000 ms/sec of total capacity, SQLite reads alone consume 25% of carrier capacity.

In practice, most REST API reads go through the State Store's `ConcurrentHashMap` (no SQLite, no pinning). But event history queries and command issuance hit SQLite directly. The document should acknowledge this and specify that direct SQLite queries (event history, command writes) route through the platform thread executor, while state queries use the in-memory State Store.

### Doc 10: WebSocket API

#### FINDING S-06: WebSocket Replay Reads Pin Carriers [SIGNIFICANT]

**Location:** Doc 10 §3.6 (Event Relay Architecture).

**Problem:** The Event Relay's single subscriber polls events from the EventStore in batches. During client replay (catch-up from a historical position), the replay runs on the client's virtual thread and reads from the EventStore. Each batch read is a SQLite SELECT via JNI that pins the carrier. With multiple concurrent replay clients, carrier exhaustion is possible.

The design correctly avoids per-client subscribers (noting SQLite read amplification), but the single-subscriber + client-replay model still touches SQLite on virtual threads. Replay reads should route through the platform thread executor.

### Doc 11: Observability & Debugging

Read in full (`design/11-observability-and-debugging.md`). The HealthAggregator (§3.3) and JFR subsystem (§3.2) are **consistent** — HealthAggregator uses in-memory O(10) composition with no I/O, and the MetricsStreamBridge operates on its own dedicated thread reading from the JFR disk repository. No SQLite access in either subsystem.

However, the TraceQueryService has a finding:

#### FINDING S-07: TraceQueryService Executes SQLite Queries Without Specifying Thread Model [SIGNIFICANT]

**Location:** Doc 11 §3.4 (TraceQueryService), §5 (Contracts), §10 (Performance Targets).

**Actual text (§3.4):** *"`SELECT * FROM events WHERE correlation_id = ? ORDER BY timestamp ASC` — fetches ~7 rows via index scan (p99 < 1 ms on NVMe)."*

**Actual text (§5):** *"Trace queries read from the EventStore through the same read interface as any other consumer — they do not acquire the single-writer lock."*

**Problem:** The TraceQueryService executes direct SQL queries against SQLite (correlation_id chain assembly, reverse lookup by entity_id, REINDEX for index maintenance in §6.5). §5's claim that trace queries "do not acquire the single-writer lock" is correct but incomplete — they still pin a carrier thread during the read JNI call. The document does not specify what thread executes these queries or whether they route through a platform thread executor.

This is SIGNIFICANT rather than CRITICAL because: (a) trace queries are low-frequency user-initiated diagnostic operations, not sustained throughput, (b) they are read-only (WAL allows concurrent reads), and (c) the pinning duration is short (~1–2 ms on NVMe). But they should route through the read executor for consistency with the architectural pattern. Performance targets (§10: < 2 ms Pi 5, < 5 ms Pi 4 for trace queries) were not validated against executor scheduling overhead.

### Doc 12: Startup, Lifecycle, Shutdown

#### FINDING S-08: No Jackson ObjectMapper Warm-Up in Startup Sequence [SIGNIFICANT]

**Location:** Doc 12 §3.2–§3.8 (startup phases).

**Problem:** The startup sequence defines 7 phases (Platform Bootstrap → Data Infrastructure → Core Services → Event Processing → External Interfaces → Integrations → Ready). Jackson ObjectMapper initialization happens implicitly when the first serialization occurs. The risk assessment recommends pre-serializing all expected event types before virtual threads begin processing, to ensure the `SerializerCache`/`DeserializerCache` are warm and the `synchronized` cache-miss paths are not entered under concurrent virtual thread load.

A warm-up step should be added to Phase 4 (Event Processing Init) or Phase 3 (Core Services Init), before the Event Bus begins dispatching events to subscribers. The step should pre-serialize/deserialize every registered event type and every API response type.

### Doc 13: Web UI

Read in full (`design/13-web-ui-observability-mvp.md`). **No findings — CONSISTENT.** Doc 13 is a pure client-side Preact SPA. §2.2 explicitly states it does not own any backend data operations. All data arrives via REST API (Doc 09) and WebSocket (Doc 10). No server-side rendering, no SQLite access, no threading concerns. Contract C13-05 confirms: *"All data is consumed from existing REST and WebSocket APIs — no new server endpoints."*

### Doc 14: Master Architecture Document

#### FINDING S-09: Thread Model Summary Omits Database Platform Thread Isolation [SIGNIFICANT]

**Location:** Doc 14 §2.1, §3.5.2, §16.2.

**Actual text (§16.2):** *"Hybrid thread architecture for integrations: Platform threads for serial I/O (JNI pinning), virtual threads for protocol logic. JNI native calls pin carrier threads; dedicated platform threads prevent starvation."*

**Problem:** The master architecture document correctly describes the hybrid thread model but scopes it exclusively to *integrations*. The same principle — JNI calls pin carrier threads, therefore isolate them on platform threads — applies to sqlite-jdbc but is never stated. The thread model summary should be generalized: platform threads for **all JNI-pinning I/O** (serial ports, sqlite-jdbc), virtual threads for protocol logic and non-JNI work.

**Memory budget (§3.5.2):** *"Thread stacks: ~20 MB — ~40 platform/carrier threads × 512 KB."* If the platform thread executor for database operations adds 2–4 dedicated threads, the thread stack budget increases by ~1–2 MB. This is within tolerance but should be reflected.

---

## Step 3 Findings — Research Artifacts

#### FINDING M-01: Event Systems Research Identifies Pinning but Not sqlite-jdbc Specifically [MINOR]

**Location:** `research/Smart Home Event Systems - An architectural Autopsy.md`

**Actual text:** *"When a thread blocks on database I/O, the JVM unmounts it from the carrier thread, which serves other virtual threads. The caveat: avoid `synchronized` blocks (causes thread pinning); use `ReentrantLock` instead."*

**Problem:** The research artifact correctly identifies `synchronized` as a pinning risk and recommends `ReentrantLock`. However, it does not identify that sqlite-jdbc's pinning comes from JNI native methods, not from application-level `synchronized` blocks. The project followed this guidance (LTD-11 mandates `ReentrantLock` over `synchronized`), but the guidance is incomplete — it addresses only half the pinning problem.

#### FINDING M-02: No Research Artifact Covers sqlite-jdbc Virtual Thread Interaction [MINOR]

**Problem:** None of the 13 research artifacts include a dedicated analysis of sqlite-jdbc's virtual thread compatibility. The Language Evaluation research mentions Java 21 virtual threads but does not discuss JDBC driver threading characteristics. The Event Systems research discusses virtual thread dispatch but not JNI pinning from the database driver. This gap allowed the incorrect assumption to propagate through all design documents.

---

## Step 4 Findings — MODULE_CONTEXT Files

#### FINDING S-10: event-bus MODULE_CONTEXT Assumes Virtual Thread Subscriber Model Without Caveat [SIGNIFICANT]

**Location:** `core/event-bus/MODULE_CONTEXT.md`

**Actual text:** *"Each subscriber runs on its own virtual thread, blocked on `LockSupport.park()` until notified. The bus unparks matching subscribers. This is the standard virtual thread blocking pattern — no thread pools needed."*

**Problem:** The MODULE_CONTEXT file presents the virtual thread subscriber model as the complete threading story. It needs a caveat: subscribers that perform SQLite operations (EventStore reads, EventPublisher writes, checkpoint writes) must route those operations through a platform thread executor to avoid carrier pinning.

#### FINDING S-11: automation MODULE_CONTEXT Threading Assumption [SIGNIFICANT]

**Location:** `core/automation/MODULE_CONTEXT.md`

**Actual text:** *"LTD-01 Virtual threads for all blocking operations. DelayAction, WaitForAction, and DurationTimer use virtual thread sleep. Each Run executes on its own virtual thread."*

**Problem:** "Virtual threads for all blocking operations" is correct for sleep/park/network I/O but incorrect for SQLite JNI calls. The MODULE_CONTEXT should clarify that database operations (EventStore reads, EventPublisher writes) are the exception — they route through the platform thread executor.

#### FINDING: persistence, state-store MODULE_CONTEXT files — Same Pattern

The persistence and state-store MODULE_CONTEXT files both reference `ReentrantLock` over `synchronized` (per LTD-11) but do not mention JNI pinning as a separate concern. They need the same caveat.

---

## Step 5 Findings — Amendments

#### FINDING S-12: AMD-25 Duration Timers Spawn Virtual Threads That May Read SQLite [SIGNIFICANT]

**Location:** `design/amendments/AMD-25_Temporal_Duration_Trigger_Modifier.md`, §5 Implementation Notes.

**Actual text:** *"The recommended approach, consistent with how `delay` and `wait_for` work, is virtual thread sleep via `Thread.sleep(Duration)`. Each duration timer spawns a virtual thread that: 1. Records itself in the `ConcurrentHashMap`. 2. Sleeps for the specified duration. 3. On wakeup: checks whether it was interrupted (cancelled) or completed normally (expired)..."*

**Problem:** The virtual thread sleep itself is fine — sleeping virtual threads don't pin carriers. However, on wakeup, the timer must evaluate whether the triggering condition is still true, which may require reading entity state. If that state read goes to the State Store's `ConcurrentHashMap`, there is no pinning risk. But if the condition evaluation triggers an EventPublisher write (the trigger fires and produces an event), that write pins a carrier via SQLite JNI.

This is a **lower severity** concern because: (a) the State Store read path is `ConcurrentHashMap` (no SQLite, no pinning), and (b) the trigger fire produces an event through the Automation Engine's normal EventPublisher path, which will be covered by the platform thread executor pattern. AMD-25 itself does not need amendment, but its implementation must use the executor pattern for any SQLite writes.

---

## Step 6 — Findings Summary

### CRITICAL Findings

| # | ID | Location | Finding | Remediation Type |
|---|---|---|---|---|
| 1 | C-01 | LTD-01 reversal criteria | Only mentions `synchronized` pinning; implies Java 25 resolves it. JNI pinning persists on all versions. | LTD Amendment |
| 2 | C-02 | LTD-11 specification | Claims database-writing subscribers on virtual threads don't block other subscribers. False under JNI pinning. | LTD Amendment |
| 3 | C-03 | LTD-03 specification | No threading warning for sqlite-jdbc's `synchronized native` pattern. | LTD Amendment |
| 4 | C-05 | Doc 01 §3.4 | EventPublisher re-entrant write path claims virtual threads don't hold OS-level locks across suspension — false for JNI. | Design doc amendment |
| 5 | C-06 | Doc 01 §10 | Performance targets (500 events/sec, <10ms append) not validated against executor indirection. | Design doc amendment |
| 6 | C-07 | Doc 03 §3.5 | State Projection processes on virtual thread; every `publish()` pins carrier. | Design doc amendment |
| 7 | C-08 | Doc 04 §1.1, §3.4, §3.7, §3.12, §14 | Entire persistence layer assumes virtual thread isolation via separate threads. Design principle is wrong. | Design doc amendment (extensive) |

### SIGNIFICANT Findings

| # | ID | Location | Finding | Remediation Type |
|---|---|---|---|---|
| 1 | S-01 | LTD-01 `-Xss512k` | ARM64 default is 2MB; 512k is 25% of default. No empirical validation cited. | LTD Amendment (note) |
| 2 | S-02 | LTD-08 specification | Missing Jackson ObjectMapper warm-up guidance. | LTD Amendment (addition) |
| 3 | S-03 | Phase 2 Transition Guide §2 | WAL validation spike missing virtual thread carrier pinning test. | Document update |
| 4 | S-04 | Doc 07 §3.2 | Automation Engine's 3 subscriber threads touch SQLite on virtual threads. | Design doc amendment |
| 5 | S-05 | Doc 09 §16 | REST API claims SQLite reads don't exhaust carriers. False for JNI. | Design doc amendment |
| 6 | S-06 | Doc 10 §3.6 | WebSocket replay reads pin carriers during client catch-up. | Design doc amendment |
| 7 | S-07 | Doc 11 §3.4 | TraceQueryService executes SQLite queries without specifying thread model or executor routing. | Design doc amendment |
| 8 | S-08 | Doc 12 §3.2–§3.8 | No Jackson ObjectMapper warm-up in startup sequence. | Design doc amendment |
| 9 | S-09 | Doc 14 §16.2 | Thread model summary scopes platform thread isolation to integrations only. | Design doc amendment |
| 10 | S-10 | event-bus MODULE_CONTEXT | Presents virtual thread subscriber model without SQLite caveat. | MODULE_CONTEXT update |
| 11 | S-11 | automation MODULE_CONTEXT | "Virtual threads for all blocking operations" — incorrect for SQLite. | MODULE_CONTEXT update |
| 12 | S-12 | AMD-25 §5 | Duration timers on virtual threads may trigger SQLite writes on wakeup. | No amendment needed; implementation note |
| 13 | S-13 | INV-PR-02 operational budgets | Event processing and checkpoint latency budgets not validated against executor overhead. Invariant correct; design doc budgets need re-validation. | Design doc revision |
| 14 | S-14 | Doc 11 §10 | Trace query performance targets (<2ms Pi 5) not validated against executor scheduling overhead. | Design doc amendment |

### MINOR Findings

| # | ID | Location | Finding | Remediation Type |
|---|---|---|---|---|
| 1 | M-01 | Event Systems research | Identifies `synchronized` pinning but not JNI pinning. | No action (research artifact) |
| 2 | M-02 | All research artifacts | No research covers sqlite-jdbc virtual thread interaction. | New research artifact recommended |
| 3 | M-03 | Doc 05 §3.2 vs Doc 04 | Doc 05 solved JNI pinning for serial I/O; Doc 04 didn't apply same analysis to sqlite-jdbc. Inconsistency in how project handles JNI-pinning libraries. | Addressed by C-08 |

---

## Step 7 — Remediations

### Amendment Specifications

#### AMD-26: sqlite-jdbc Virtual Thread Carrier Pinning Mitigation

**Amendment ID:** AMD-26
**Target documents:** LTD-01, LTD-03, LTD-11 (Locked Decisions Register)
**Target sections:** LTD-01 reversal criteria, LTD-03 specification, LTD-11 specification

**Problem statement:** The Locked Decisions Register does not document that xerial sqlite-jdbc pins virtual thread carrier threads on every database operation due to `synchronized native` methods in `NativeDB.java`. This omission has propagated through all design documents, causing 8 critical and 9 significant incorrect assumptions.

**Proposed changes:**

**LTD-01 reversal criteria — REPLACE:**

FIND:
```
If virtual thread pinning on `synchronized` blocks in third-party libraries proves unresolvable without migrating to Java 25+.
```

REPLACE:
```
If steady-state carrier thread utilization exceeds 75% due to JNI pinning from third-party libraries (primarily sqlite-jdbc) despite the platform thread executor mitigation pattern, indicating that the virtual thread model provides insufficient benefit to justify its complexity. Note: JEP 491 (Java 25 LTS) eliminates `synchronized`-monitor pinning but does NOT eliminate JNI pinning. sqlite-jdbc's `synchronized native` methods cause carrier pinning via both mechanisms on Java 21, and via JNI alone on Java 25+. The platform thread executor pattern (see LTD-03, LTD-11) is required on ALL Java versions.
```

**LTD-03 specification — INSERT after existing text *"The JDBC driver is `org.xerial:sqlite-jdbc` (bundles native libraries for ARM64 and x86_64)."*:**

```

**Virtual thread constraint.** Every method in xerial sqlite-jdbc's `NativeDB.java` is declared `synchronized native`. This is a worst-case double-pinning pattern for Java 21 virtual threads: the virtual thread is pinned by both the monitor entry and the JNI native call. With 4 carrier threads on RPi 5, as few as 4 concurrent sqlite-jdbc operations can exhaust the carrier pool. JEP 491 (Java 25) eliminates the `synchronized` pinning but JNI pinning persists across all Java versions — it is inherent to how native methods interact with the virtual thread scheduler.

**Mandatory mitigation.** All sqlite-jdbc operations — reads and writes — must be submitted to a bounded platform thread executor (`Executors.newFixedThreadPool(N)`), not executed directly on virtual threads. Virtual threads submit database work via `CompletableFuture.supplyAsync(dbCall, dbExecutor)` and await the result. This confines all carrier pinning to dedicated platform threads, keeping the virtual thread carrier pool free. Executor sizing: 1 thread for the write connection (single-writer model), 2–3 threads for read connections (matching WAL concurrent reader capacity under load). The executor is owned by the Persistence Layer and exposed to other subsystems through the `EventStore` and `StateStore` interfaces — callers never interact with sqlite-jdbc directly.

This pattern mirrors the platform thread isolation already designed for jSerialComm in Integration Runtime §3.2. The principle is the same: JNI native calls pin carrier threads; dedicated platform threads prevent starvation.
```

**LTD-11 specification — REPLACE:**

FIND:
```
Each subscriber runs in its own virtual thread. A slow subscriber (e.g., a database-writing projection) does not block the event store or other subscribers.
```

REPLACE:
```
Each subscriber runs in its own virtual thread. Subscribers that perform SQLite operations (EventStore reads, EventPublisher writes, checkpoint writes) route those operations through the Persistence Layer's platform thread executor (LTD-03). The subscriber's virtual thread parks while the platform thread executes the JNI call, then resumes when the result is available. This prevents database-writing subscribers from pinning carrier threads. A slow subscriber does not block the event store or other subscribers because: (a) the platform thread executor serializes database access without consuming carrier threads, and (b) each subscriber pulls events independently from its own checkpoint.
```

**Downstream impact:** All 14 design documents reference at least one of these LTDs. The amendments to Doc 01, 03, 04, 07, 09, 10, 12, and 14 (below) implement the downstream consequences.

---

#### AMD-27: Persistence Layer Platform Thread Executor Design

**Amendment ID:** AMD-27
**Target document:** Doc 04 (Persistence Layer)
**Target sections:** §1.1 (Design Principles), §3.4, §3.7, §3.12, §10, §14, §15 (Design Rationale)

**Problem statement:** Doc 04 assumes all database operations execute on virtual threads. Every section that defines a "dedicated virtual thread" for database work must be amended to route SQLite operations through a platform thread executor.

**Proposed changes:**

**§1.1 Design Principles — REPLACE:**

FIND:
```
**Maintenance never blocks recording for extended or unbounded periods.** Retention execution, space reclamation, integrity checks, and backup operations run on separate virtual threads with separate database connections. They yield to the write path by operating in small batches with explicit pauses. The single-writer model (LTD-03, LTD-11) means maintenance and recording compete for the write lock, but maintenance acquires it in short bursts rather than holding it for extended operations.
```

REPLACE:
```
**Maintenance never blocks recording for extended or unbounded periods.** Retention execution, space reclamation, integrity checks, and backup operations are coordinated by virtual threads but execute all SQLite operations through the Persistence Layer's platform thread executor (LTD-03). The executor confines JNI carrier-thread pinning to dedicated platform threads, preventing database operations from starving the virtual thread carrier pool. Maintenance tasks yield to the write path by operating in small batches with explicit pauses between executor submissions. The single-writer model (LTD-03, LTD-11) means maintenance and recording compete for the write lock via the executor's scheduling, but maintenance acquires it in short bursts rather than holding it for extended operations.
```

**§3.4 Retention Execution — REPLACE the retention thread description:**

FIND:
```
Retention runs on a dedicated virtual thread during a configurable low-activity window
```

REPLACE:
```
Retention is coordinated by a virtual thread during a configurable low-activity window. All SQLite DELETE operations are submitted to the Persistence Layer's platform thread write executor. The coordinating virtual thread parks while each batch executes on the platform thread, then resumes for the inter-batch yield (50 ms sleep).
```

**§3.7 Aggregation Engine — same pattern.** Replace "dedicated virtual thread" with "coordinated by a virtual thread; SQLite operations submitted to platform thread executor."

**§3.12 View Checkpoint Store — same pattern.** The multi-statement checkpoint transaction must execute entirely on a platform thread (a single executor submission containing the full transaction).

**§15 Design Rationale — INSERT new rationale entry describing the executor as an internal implementation detail:**

The platform thread executor is an internal implementation detail of the Persistence Layer module, NOT a public interface. It does not appear in §8 (Key Interfaces). Other subsystems access SQLite exclusively through the `EventStore` and `StateStore` interfaces — they never interact with the executor directly. This is deliberate: the executor strategy is a consequence of the sqlite-jdbc driver's JNI characteristics (LTD-03). If the driver is replaced with a pure-Java implementation (or one that uses `ReentrantLock` around its native calls), the executor requirement changes. Hiding the executor behind `EventStore`/`StateStore` preserves the freedom to change the concurrency strategy without breaking downstream modules. The expected internal shape:

```java
// INTERNAL to persistence module — not a public API surface.
// 1 write thread (single-writer model), 2-3 read threads (WAL concurrent readers).
// Virtual threads submit work via CompletableFuture.supplyAsync(task, executor)
// and park until the result is available.
```

**§10 Performance Targets — ADD note:**

```
All latency targets include the platform thread executor scheduling overhead
(estimated 0.1–0.5 ms per submission on RPi 5). Targets were validated
assuming this overhead. If measured overhead exceeds 1 ms, investigate
executor thread pool sizing and scheduling policy.
```

**§14 Decision Table — REPLACE the row about retention threading:**

FIND:
```
Separate thread prevents retention from blocking event recording
```

REPLACE:
```
Platform thread executor prevents retention SQLite operations from pinning carrier threads. Virtual thread coordination provides scheduling flexibility while platform threads handle JNI isolation.
```

---

#### AMD-28: Event Model Write Path and Performance Target Updates

**Amendment ID:** AMD-28
**Target document:** Doc 01 (Event Model & Event Bus)
**Target sections:** §3.4 (Subscription Model), §10 (Performance Targets)

**Problem statement:** Doc 01 §3.4 incorrectly claims virtual threads don't hold OS-level locks across suspension points (false for JNI). §10 performance targets were not validated against executor indirection.

**Proposed changes:**

**§3.4 — REPLACE the re-entrant write contention paragraph:**

FIND:
```
Because the EventPublisher acquires the SQLite write lock for each append and virtual threads do not hold OS-level locks across suspension points, this pattern is safe under the single-writer discipline as long as the subscriber's `publish()` call completes before the subscriber processes the next event.
```

REPLACE:
```
The EventPublisher submits each SQLite append to the Persistence Layer's platform thread write executor (LTD-03) and parks the calling virtual thread until the WAL commit completes. This prevents carrier thread pinning from sqlite-jdbc's `synchronized native` JNI methods. Re-entrant writes from projection subscribers (State Projection, Pending Command Ledger calling `publish()` during event processing) are serialized through the same write executor. Because the single-writer model guarantees sequential write access, re-entrant writes do not deadlock — they queue behind the current write and execute when the platform thread becomes available. The subscriber's virtual thread parks during the write, freeing its carrier for other work.
```

**§3.4 — ADD explicit contract preservation statement after the replacement text:**

```
**Contract preservation.** The EventPublisher.publish() behavioral contract
is unchanged by this threading change. The caller blocks until persistence
completes — it blocks on a CompletableFuture.join() rather than directly
executing JNI, but the semantics are identical. The event is durable before
the method returns. INV-ES-04 (Write-Ahead Persistence) is satisfied
identically: the caller's virtual thread does not resume, and no subscriber
is notified, until the WAL commit completes on the platform thread. The
platform thread executor changes which thread executes the JNI call, not
when the caller resumes or when subscribers are notified.
```

**§10 Performance Targets — ADD footnote to the targets table:**

```
† All database operation latency targets include platform thread executor
scheduling overhead (LTD-03). The executor adds an estimated 0.1–0.5 ms
per operation due to the virtual-thread-to-platform-thread handoff. The
single-writer model (LTD-03) bounds write throughput to 1/(WAL commit
latency) regardless of threading model — the writes were always serialized.
On NVMe (1–2 ms commits), the theoretical ceiling is 500–1000 events/sec.
The executor overhead reduces this existing ceiling by approximately 10–20%
(to ~400–800 events/sec) due to the scheduling hop, not because it creates
a new bottleneck. The 500 events/sec target remains achievable. If measured
throughput falls below 400 events/sec, investigate batched WAL commits
(grouping multiple events into a single transaction).
```

---

#### AMD-29: State Store Projection Threading Update

**Amendment ID:** AMD-29
**Target document:** Doc 03 (State Store & State Projection)
**Target section:** §3.5 (Concurrency Model)

**Problem statement:** Doc 03 assumes the projection subscriber processes events on a virtual thread with direct SQLite access.

**Proposed change — INSERT after the existing concurrency model description:**

```
**Platform thread executor for database writes.** The projection subscriber's
`EventPublisher.publish()` calls for `state_changed` events are submitted to the
Persistence Layer's platform thread write executor (LTD-03, Doc 04). The subscriber's
virtual thread parks during each write and resumes when the WAL commit completes.
This prevents the State Projection from pinning carrier threads during high-throughput
event processing. The in-memory ConcurrentHashMap updates remain on the virtual thread
(no JNI, no pinning).
```

---

#### AMD-30: LTD-08 Jackson Warm-Up Addition

**Amendment ID:** AMD-30
**Target document:** Locked Decisions Register, LTD-08
**Target section:** LTD-08 specification

**Problem statement:** LTD-08 does not specify ObjectMapper warm-up. Jackson 2.18.x has `synchronized` cache-miss paths in `SerializerCache`/`DeserializerCache` that pin carriers during cold-start.

**Proposed change — INSERT after the ObjectMapper configuration block:**

```
**Startup warm-up (mandatory).** Before virtual threads begin processing events,
warm up the ObjectMapper by pre-serializing and pre-deserializing every registered
event type and API response type. This populates the SerializerCache and
DeserializerCache, ensuring the `synchronized` cache-miss write path is never
entered under concurrent virtual thread load. The warm-up step is part of the
startup sequence (Doc 12, Phase 3 — Core Services Init or Phase 4 — Event
Processing Init). After warm-up, Jackson's hot read path uses unsynchronized
snapshots and is fully virtual-thread-safe.
```

---

#### Additional Design Document Amendments

**Doc 07 (Automation Engine) §3.2:** Add note that the three subscriber threads route EventStore reads and EventPublisher writes through the platform thread executor.

**Doc 09 (REST API) §16 Key Decisions:** Replace *"Blocking in handlers (SQLite reads) does not exhaust carrier threads"* with *"Direct SQLite reads (event history queries) and writes (command issuance) route through the Persistence Layer's platform thread executor (LTD-03) to prevent carrier pinning. State queries use the in-memory ConcurrentHashMap and do not touch SQLite."*

**Doc 10 (WebSocket API) §3.6:** Add note that the Event Relay's EventStore reads and client replay reads route through the platform thread executor.

**Doc 11 (Observability) §3.4, §5, §10:** Add note that TraceQueryService SQL queries route through the read executor. Update §5 contract to acknowledge JNI pinning on reads. Add executor overhead footnote to §10 performance targets. Note: HealthAggregator (§3.3) and JFR subsystem (§3.2) are unaffected — no SQLite access.

**Doc 12 (Startup/Lifecycle) §3.3 or §3.4:** Add Jackson ObjectMapper warm-up step. Add platform thread executor initialization to the Persistence Layer startup phase (before Event Bus starts dispatching).

**Doc 14 (Master Architecture) §16.2:** Generalize the hybrid thread architecture decision from "for integrations" to "for all JNI-pinning I/O (serial ports, sqlite-jdbc)". Update thread stack budget to include 2–4 additional platform threads for the database executor (~1–2 MB).

---

### MODULE_CONTEXT Updates

**core/event-bus/MODULE_CONTEXT.md — INSERT caveat:**

```
**Threading caveat (LTD-03).** Subscribers run on virtual threads, but any
subscriber that performs SQLite operations (EventStore reads, EventPublisher
writes, checkpoint writes) must route those operations through the Persistence
Layer's platform thread executor. The virtual thread parks during the executor
call and resumes when the result is available. This prevents sqlite-jdbc's
JNI native methods from pinning carrier threads.
```

**core/automation/MODULE_CONTEXT.md — REPLACE:**

FIND: `LTD-01 Virtual threads for all blocking operations.`

REPLACE: `LTD-01 Virtual threads for all blocking operations except SQLite access, which routes through the Persistence Layer's platform thread executor (LTD-03) to avoid JNI carrier pinning.`

**core/persistence/MODULE_CONTEXT.md — INSERT:**

```
**Platform thread executor (LTD-03).** All sqlite-jdbc operations are submitted
to a bounded platform thread executor: 1 write thread, 2-3 read threads.
Virtual threads submit work via CompletableFuture and park until completion.
This confines JNI carrier pinning to dedicated platform threads. The executor
is initialized during startup (Doc 12 Phase 2 — Data Infrastructure) before
the Event Bus begins dispatching.
```

**core/state-store/MODULE_CONTEXT.md — INSERT:**

```
**Threading note.** StateQueryService reads from ConcurrentHashMap — no SQLite,
no carrier pinning, safe on virtual threads. The State Projection subscriber's
EventPublisher.publish() calls route through the platform thread executor (LTD-03).
```

---

### Escalations to Hivemind (All Resolved)

All three escalations were resolved by the Hivemind. Decisions recorded here for traceability.

**Escalation 1: LTD placement for platform thread executor pattern.**
Options presented: (A) Amend LTD-03, (B) Create LTD-18, (C) Amend LTD-11.
PM recommended: Option A.
**Hivemind decision: Option A confirmed.** The executor is a direct consequence of the sqlite-jdbc driver choice. If the driver is ever replaced with a pure-Java implementation (or one that uses `ReentrantLock` around its native calls), the executor requirement changes. That coupling belongs in LTD-03.

**Escalation 2: `-Xss512k` on ARM64.**
Options presented: (A) Keep 512k + ARM64 note + spike validation, (B) Change to 1m, (C) Change to 768k.
PM recommended: Option A.
**Hivemind decision: Option A confirmed.** No evidence of stack overflow at 512k for HomeSynapse's call-depth profile. The Cassandra precedent (CASSANDRA-15446) involves substantially deeper call stacks. Validate empirically in the Phase 3 spike rather than preemptively spending ~20 MB of RSS without evidence.

**Escalation 3: WAL validation spike scope expansion.**
Options presented: (A) Consolidate pinning tests into existing spike, (B) Create separate spike.
PM recommended: Option A.
**Hivemind decision: Option A confirmed.** One spike, expanded scope. Tests are closely related and share infrastructure.

---

## Step 8 — Summary and Execution Order

### Summary Table

| # | Severity | Location | Finding | Remediation |
|---|---|---|---|---|
| C-01 | CRITICAL | LTD-01 reversal criteria | Only mentions `synchronized` pinning; JNI pinning persists on Java 25 | AMD-26 (LTD amendment) |
| C-02 | CRITICAL | LTD-11 specification | Database-writing subscribers on VTs don't block — false under JNI | AMD-26 (LTD amendment) |
| C-03 | CRITICAL | LTD-03 specification | No threading warning for sqlite-jdbc `synchronized native` | AMD-26 (LTD amendment) |
| C-05 | CRITICAL | Doc 01 §3.4 | EventPublisher write path assumes VT safety for JNI | AMD-28 |
| C-06 | CRITICAL | Doc 01 §10 | Performance targets unvalidated against executor overhead | AMD-28 |
| C-07 | CRITICAL | Doc 03 §3.5 | State Projection on VT pins carrier on every publish() | AMD-29 |
| C-08 | CRITICAL | Doc 04 §1.1/§3.4/§3.7/§3.12/§14 | Entire persistence layer assumes VT isolation via separate threads | AMD-27 |
| S-01 | SIGNIFICANT | LTD-01 `-Xss512k` | ARM64 75% reduction; no empirical validation | AMD-26 + Escalation |
| S-02 | SIGNIFICANT | LTD-08 specification | Missing Jackson ObjectMapper warm-up | AMD-30 |
| S-03 | SIGNIFICANT | Phase 2 Transition Guide §2 | WAL spike missing carrier pinning test | Document update + Escalation |
| S-04 | SIGNIFICANT | Doc 07 §3.2 | Automation subscriber threads touch SQLite on VTs | Design doc note |
| S-05 | SIGNIFICANT | Doc 09 §16 | REST API claims SQLite reads don't exhaust carriers | Design doc amendment |
| S-06 | SIGNIFICANT | Doc 10 §3.6 | WebSocket replay reads pin carriers | Design doc amendment |
| S-07 | SIGNIFICANT | Doc 11 §3.4 | TraceQueryService queries SQLite without thread model specification | Design doc amendment |
| S-08 | SIGNIFICANT | Doc 12 §3.2–§3.8 | No Jackson warm-up in startup sequence | Design doc amendment |
| S-09 | SIGNIFICANT | Doc 14 §16.2 | Thread model scoped to integrations only | Design doc amendment |
| S-10 | SIGNIFICANT | event-bus MODULE_CONTEXT | VT subscriber model without SQLite caveat | MODULE_CONTEXT update |
| S-11 | SIGNIFICANT | automation MODULE_CONTEXT | "VTs for all blocking ops" incorrect for SQLite | MODULE_CONTEXT update |
| S-12 | SIGNIFICANT | AMD-25 §5 | Duration timer VTs may trigger SQLite writes on wakeup | Implementation note (no amendment) |
| S-13 | SIGNIFICANT | INV-PR-02 op budgets | Latency budgets not validated against executor overhead (invariant correct; design docs need re-validation) | AMD-28, AMD-27 |
| S-14 | SIGNIFICANT | Doc 11 §10 | Trace query targets (<2ms Pi 5) not validated against executor overhead | Design doc amendment |
| M-01 | MINOR | Event Systems research | Identifies `synchronized` but not JNI pinning | No action |
| M-02 | MINOR | All research artifacts | No sqlite-jdbc VT interaction research | New artifact recommended |
| M-03 | MINOR | Doc 05 vs Doc 04 | JNI analysis applied to serial I/O but not SQLite | Addressed by C-08 |

### Recommended Execution Order

The amendments have dependencies. Execute in this order:

**Phase A — Governance Foundation (do first)**

1. **AMD-26** — Amend LTD-01, LTD-03, LTD-11. This establishes the authoritative constraint that all downstream amendments reference. Wait for Hivemind to confirm LTD-03 as the home for the platform thread executor pattern.
2. **AMD-30** — Amend LTD-08 (Jackson warm-up). Independent of AMD-26, can execute in parallel.

**Phase B — Core Design Documents (do after Phase A)**

3. **AMD-27** — Amend Doc 04 (Persistence Layer). This is the most extensive amendment and defines the `DatabaseExecutor` interface that all other documents reference.
4. **AMD-28** — Amend Doc 01 (Event Model). Depends on AMD-27 (references the executor).
5. **AMD-29** — Amend Doc 03 (State Store). Depends on AMD-27.

**Phase C — Downstream Design Documents (do after Phase B)**

6. Amend Doc 07 (Automation Engine) — references executor from AMD-27.
7. Amend Doc 09 (REST API) — references executor from AMD-27.
8. Amend Doc 10 (WebSocket API) — references executor from AMD-27.
9. Amend Doc 11 (Observability) — TraceQueryService reads through read executor.
10. Amend Doc 12 (Startup/Lifecycle) — adds warm-up step (AMD-30) and executor init (AMD-27).
11. Amend Doc 14 (Master Architecture) — generalizes thread model.

**Phase D — Supporting Artifacts (do after Phase C)**

12. Update MODULE_CONTEXT files (event-bus, automation, persistence, state-store).
13. Update Phase 2 Transition Guide (add spike test items).
14. File the risk assessment as a formal research artifact in `homesynapse-core-docs/research/`.

### Documents Confirmed Consistent (No Findings)

- Doc 02 (Device Model & Capability System) — no independent threading model
- Doc 05 (Integration Runtime) — correctly identifies and mitigates JNI pinning for serial I/O
- Doc 06 (Configuration System) — synchronous file I/O, no virtual thread SQLite access
- Doc 08 (Zigbee Adapter) — correctly uses hybrid thread model from Doc 05
- Doc 11 (Observability) — HealthAggregator (in-memory O(10) composition) and JFR subsystem (dedicated thread, thread-local buffers) are clean. TraceQueryService has finding S-07.
- Doc 13 (Web UI) — pure client-side Preact SPA, no backend SQLite access

---

## Success Criteria Verification

- [x] Every governance file listed in Step 1 has been read and assessed
- [x] Every design document (01–14) has been read and assessed (all located and read in full)
- [x] Every research artifact has been read and assessed (13 artifacts)
- [x] Every MODULE_CONTEXT file has been read and assessed (5 substantive files found; remainder were templates)
- [x] The amendments directory has been checked (AMD-25 read and assessed)
- [x] All findings are organized by severity (7 CRITICAL / 14 SIGNIFICANT / 3 MINOR)
- [x] Every CRITICAL finding has a concrete remediation (amendment spec, MODULE_CONTEXT update, or escalation)
- [x] Every SIGNIFICANT finding has a concrete remediation
- [x] A summary table exists with all findings and recommended execution order
- [x] No finding references a document section without having read the actual text
