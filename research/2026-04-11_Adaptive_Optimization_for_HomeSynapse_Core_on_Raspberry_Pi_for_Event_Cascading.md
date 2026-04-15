# Adaptive optimization for HomeSynapse Core on Raspberry Pi

**HomeSynapse's cascade amplification problem — where 50 simultaneous sensor reports create 100+ serialized events yielding 100–210ms pipeline latency — is solvable today with proven techniques from Akka, Home Assistant, and TCP congestion control, without any machine learning.** The most impactful optimizations are derived-event coalescing (treating derived events as ephemeral projections rather than first-class events), adaptive WAL checkpoint scheduling (deferring checkpoints during bursts), and per-subscriber backpressure using Java's native Flow API. For on-device self-tuning, lightweight statistical models (t-digest, EWMA) fit comfortably within **~170 KB total memory** and deliver 90%+ of the value of complex ML-based approaches. At the 50–200 device target range, "adaptive self-tuning" using bounded feedback loops is the correct framing — not machine learning.

---

## Research Direction 1: Adaptive event cascade optimization

### Derived event coalescing has deep production prior art

The cascade amplification problem — N source events generating up to N derived events, all serialized through a single writer — is not unique to HomeSynapse. **EventStoreDB explicitly documents "write amplification" as a major concern**, noting that enabling all system projections (By Category, By Event Type, By Correlation Id) quadruples write operations per appended event. Their mitigation: make projections configurable and disable unnecessary ones.

The critical architectural insight comes from event-sourcing theory itself. Source events (`state_reported` from sensors) are immutable facts and the ground truth. Derived events (`state_changed`, `room_occupancy_updated`) are, by definition, **reproducible from source events via deterministic projection logic** — they are materialized projections, not first-class events. Coalescing, filtering, or delaying derived events is safe for correctness if three conditions hold: source events remain intact and immutable; derived state can be reconstructed by replaying source events; and subscribers accept eventual consistency semantics.

Four production systems demonstrate concrete coalescing patterns applicable to HomeSynapse:

**Akka Persistence** uses dynamic batching during journal round-trips. When using `persistAsync`, batch size is determined by how many events accumulate during a journal write cycle — never timer-based, keeping latencies minimal. Akka enforces the single-writer principle via Cluster Sharding (one `EventSourcedBehavior` per `PersistenceId`), directly analogous to HomeSynapse's model. Coalescing happens at the command-handling level before event generation, not after.

**Axon Framework** offers **automatic event blacklisting**: when a Tracking Event Processor determines none of its handlers can process a particular event type, it signals the event stream to stop sending those events entirely. This server-side filtering eliminates unnecessary derived event processing. Axon's `SequencingPolicy` (default: `SequentialPerAggregatePolicy`) ensures per-aggregate ordering even with parallel processing segments — a pattern directly transferable to per-device ordering in HomeSynapse.

**Home Assistant** faces the exact same problem on identical hardware (Pi, SQLite, dedicated recorder thread). Its solutions are the most directly applicable. The **`commit_interval`** (default 5 seconds) batches database writes: "allows events to be committed almost right away without thrashing the disk when an event storm happens." The **Significant Change Platform** lets each integration implement `async_check_significant_change`, returning whether a state change is meaningful — effectively derived event coalescing at the platform level. Sensor-level **throttle filters** (`lowpass`, `outlier`, `throttle`, `time_throttle`) reduce state change volume before it reaches the recorder. Attribute deduplication via `StateAttributesManager` eliminates redundant JSON storage.

**One caveat demands attention**: side-effect-producing subscribers. If a subscriber triggers an irreversible action (push notification, actuator command) per derived event, coalescing could cause missed actions. The solution is subscriber categorization: idempotent/catch-up-safe subscribers tolerate coalescing; side-effect subscribers require guaranteed delivery of each derived event.

### Priority-aware write scheduling works with per-device ordering

The single-writer model can safely reorder writes across devices while preserving per-device event ordering — this is the key finding. Events for the same device (aggregate) must maintain causal order, but events from independent devices are semantically independent. A security alarm from Device X can jump ahead of a temperature log from Device Y without violating any invariant.

Java's `PriorityBlockingQueue` with a custom comparator provides the implementation vehicle. The comparator applies priority first, then FIFO sequence number for tie-breaking within the same priority level. **Five static priority levels** are sufficient and recommended as the baseline:

- **CRITICAL (10)**: Safety/security events (smoke alarm, intrusion, water leak)
- **HIGH (7)**: User-interactive commands (light switch, lock/unlock)
- **NORMAL (5)**: Routine state changes (thermostat adjustments)
- **LOW (3)**: Periodic telemetry (temperature, humidity)
- **BULK (1)**: Background sync, statistics aggregation

This mirrors RabbitMQ's best practice of 3–5 priority levels. RabbitMQ implements priority via internal sub-queues — one per level — and its quorum queues (v4.0+) guarantee a proportion of normal-priority messages for every batch of high-priority messages, preventing starvation. An aging mechanism (`effective_priority = base_priority + min(max_bonus, elapsed_time / aging_interval)`) ensures low-priority events eventually process. With 5 levels and a 100ms aging interval, a low-priority event reaches maximum effective priority within **300–500ms** — acceptable for IoT telemetry while ensuring safety events process first.

**Learned/adaptive priority adds complexity for marginal benefit** at this scale. Time-of-day patterns (morning routine boost) could be a simple second-phase enhancement, but full ML-based priority learning is unnecessary for 50–200 devices.

### WAL checkpoint scheduling should be adaptive and state-driven

SQLite's auto-checkpoint mechanism fires after every COMMIT that causes the WAL to exceed 1,000 pages (~4 MB), and it runs **on the same thread as the COMMIT** — catastrophic during bursts. At 24K events/sec, auto-checkpoint would trigger every **0.2 seconds** on the writer thread, destroying throughput. The solution is disabling auto-checkpoint (`PRAGMA wal_autocheckpoint = 0`) on all connections and implementing a custom three-state adaptive scheduler.

The four checkpoint modes have distinct trade-offs. **PASSIVE** checkpoints as many frames as possible without blocking readers or writers — safe for background use. **FULL** blocks until no writers exist, then waits for readers to finish before checkpointing all frames. **RESTART** and **TRUNCATE** additionally wait for all readers to finish reading from the WAL, with TRUNCATE zeroing the file. For HomeSynapse, the recommended state machine is:

**IDLE** (<10 events/sec): Aggressive TRUNCATE every 200 pages. Keeps WAL tiny for fast reads. The fsync cost is amortized over idle time. **NORMAL** (10–200 events/sec): PASSIVE every 1,000 pages with periodic FULL every 5,000 pages if PASSIVE is incomplete. Run on a dedicated checkpoint thread, never the writer. **BURST** (>500 events/sec): Defer all checkpoints. Monitor WAL size with a hard cap at 32–128 MB (storage-dependent). When burst ends (rate drops below 200/sec for 2 seconds), run PASSIVE immediately, then schedule FULL within 5 seconds.

Implementation uses `sqlite3_wal_hook()` via JDBC/JNI, which receives the WAL page count after each commit. The hook assesses current write rate via sliding window average and makes checkpoint decisions accordingly. This approach is inspired by PostgreSQL's `checkpoint_completion_target = 0.9`, which spreads checkpoint I/O over 90% of the checkpoint interval to prevent spikes.

**Storage type is the single most impactful variable.** Raspberry Pi benchmarks reveal staggering differences: SD cards deliver **2–6,000 4K random write IOPS** (with degradation over time), while NVMe delivers **57,000–92,000 IOPS** — a 10–100× improvement. The recommended PRAGMA configuration differs by storage type:

| Parameter | SD Card | NVMe |
|-----------|---------|------|
| `synchronous` | NORMAL | NORMAL |
| `cache_size` | -32768 (32 MB) | -65536 (64 MB) |
| `mmap_size` | 128 MB | 256 MB |
| `journal_size_limit` | 16 MB | 128 MB |
| Checkpoint strategy | PASSIVE every 500 pages | PASSIVE every 2,000 pages; deferred during burst |

Setting `synchronous = NORMAL` is critical — in WAL mode, this is corruption-safe and eliminates per-COMMIT fsync, making checkpoint the only fsync operation. A recently discovered WAL-reset bug (fixed in SQLite **3.51.3**, March 2026) affects WAL mode with 2+ connections during simultaneous write and checkpoint — HomeSynapse should mandate this version or later.

### Per-subscriber backpressure protects the writer without sacrificing correctness

The fundamental rule: **backpressure must never affect event persistence**. The write side is the source of truth and must operate independently. Backpressure should only affect event dispatch to subscribers, implemented via a fan-out dispatcher with per-subscriber queues applying independent strategies.

Java's native `java.util.concurrent.Flow` API (Java 9+) implements the Reactive Streams specification with zero external dependencies. The core mechanism is pull-based: subscribers call `Subscription.request(long n)` to signal demand, and the publisher must not emit more items than requested. Three backpressure strategies map to HomeSynapse's subscriber types:

**Projection subscribers** (building read models): Use catch-up semantics with unbounded queuing. Events must never be dropped; ordering must be preserved. The subscriber catches up when resources allow. This follows EventStoreDB's catch-up subscription model and Axon's tracking processor pattern.

**Automation subscribers** (triggering rules/actions): Use bounded buffers with at-least-once delivery. If overwhelmed, queue and process when available. Per-device ordering preserved via Axon's `SequencingPolicy` pattern — partition events by device ID, parallelize across partitions.

**UI/WebSocket subscribers**: Use `onBackpressureLatest()` — keep only the most recent state per entity, dropping intermediates. Akka Streams' `conflate` operator implements this exact pattern, automatically coalescing sensor events when subscribers are slow. For a smart home, "the kitchen light is now ON" matters, not every intermediate dimming step.

An AIMD (Additive Increase / Multiplicative Decrease) approach — where the event dispatch window increases linearly when subscribers keep up and halves on congestion — is provably stable and fair. However, for an in-process system with ~50–200 devices, it may be over-engineered. A simpler bounded buffer + `onBackpressureLatest` per subscriber likely suffices. **The AIMD state machine should be a "decide later" extension point** — design the per-subscriber queue interface to accept pluggable overflow strategies, but ship with simple strategies first.

### An honest scale assessment reveals when optimization matters

Real-world Home Assistant data provides the clearest benchmark for HomeSynapse's target hardware. Users report 85 devices on Pi 4 running "smoothly, no problems," while 200+ device installations consistently note requiring **minimum 8 GB RAM** and migration off Pi hardware. The database is overwhelmingly the #1 bottleneck at scale — not CPU, not network.

Device counts are misleading. The actual load driver is **entity count × state change frequency**. One power-monitoring smart plug updating every second generates more load than 10 rarely-toggled switches. A 200-device installation might expose 2,000+ entities. Home Assistant's core contributors explicitly state: "Anything more frequent than 1/s should be throttled before it even reaches Home Assistant."

| Device count | Events/sec est. | Static config status |
|:---:|:---:|:---|
| **1–50** | 1–10 | Perfectly fine. Default configuration works. Pi 4 + SD card adequate. |
| **50–100** | 5–20 | Fine with basics. SSD recommended. Exclude obviously noisy entities. |
| **100–200** | 10–50 | Manual tuning needed. SSD mandatory. Entity filtering important. |
| **200–500** | 20–100+ | Significant tuning. 8 GB+ RAM recommended. Users migrate off Pi. |

**For HomeSynapse targeting 50–200 devices on Pi 4/5 with 4 GB RAM**, the honest assessment is: adaptive behavior provides genuine value starting around **150 devices**, where the mix of device types (chatty power monitors vs. rarely-triggered door sensors) varies enormously between installations. Below 100 devices, static configuration with sensible defaults is entirely sufficient. Above 200, architectural constraints (4 GB RAM, single SQLite instance) become fundamental limits that no amount of tuning can overcome.

---

## Research Direction 2: On-device adaptive heuristics and offline intelligence

### The right tunable parameters, ranked by impact and safety

Self-tuning database research (OtterTune, iTuned) consistently finds that typically **only 5–10 out of hundreds of configuration knobs** meaningfully impact performance. For HomeSynapse's focused parameter space, the highest-value targets are all application-layer and fully controllable without touching SQLite internals:

**Event write batch size** ranks highest: it directly reduces WAL writes and fsync pressure, is trivially measurable (write throughput and latency), has no corruption risk (larger batches = more latency but never data loss), and can be bounded safely (min 10, max 500 events). **WAL checkpoint timing** ranks second: checkpoints are I/O-intensive, and scheduling them during idle periods avoids latency spikes while growing the WAL file is safe within bounds. **Read query cache size** (SQLite `cache_size` PRAGMA) is the safest database-level knob — purely a memory/performance trade-off with trivially measurable cache hit ratios. **Event coalescing window** controls noise reduction but requires care — too aggressive loses granularity.

Parameters like `synchronous` mode should be **set once and never auto-adjusted** — the safety implications of runtime changes outweigh any performance gains. Thread pool sizes can be tuned but interact with JVM-level concerns and virtual thread scheduling, making them lower priority.

### Statistical models fit in under 200 KB total

Four algorithms cover HomeSynapse's monitoring needs within extraordinary resource constraints:

**t-digest** (Ted Dunning's algorithm) provides space-efficient percentile estimation for streaming data. With compression parameter δ=100, it maintains ~100–500 centroids at **~5–10 KB heap** per instance, delivering part-per-million accuracy at extreme quantiles (p99, p99.9). The reference Java implementation (`com.tdunning:t-digest`, Apache 2.0, 2.1k GitHub stars) has zero external dependencies. This is ideal for tracking event processing latency distributions, query duration profiling, and WAL checkpoint duration.

**HDR Histogram** (Gil Tene) provides exact percentile measurement within configured precision. For a 1μs–1s range with 2 significant digits, memory is **~31 KB** per histogram. Recording cost is **3–6 nanoseconds** per value with zero allocations after initialization. Best suited for command execution latency where exact precision and known value ranges matter.

**Exponential Moving Average (EWMA)** costs **~48 bytes per metric** for three time horizons (1-minute, 5-minute, 15-minute — matching Unix load average convention). CPU cost is effectively zero: one multiply, one add per update. Implementation is 5–10 lines of Java with no library needed. This is the workhorse for driving adaptive tuning decisions: "if the 5-minute EWMA of write latency exceeds the target threshold, increase batch size by 10%."

**Reservoir sampling** maintains a representative sample of k recent values in **O(k) memory** — 800 bytes for k=100 samples of 8-byte values. Useful for anomaly detection and debugging traces.

The total budget for comprehensive monitoring: 10 t-digest instances (~100 KB), 2 HDR Histograms (~62 KB), 50 EWMA metrics with 3 horizons (~4 KB), 2 reservoir samples (~2 KB) = **~170 KB total**, well under the 1 MB budget and consuming less than 0.01% of a single Pi 5 core.

### Learned state belongs outside the event store

PostgreSQL provides the clearest precedent. Statistics (`pg_stat` tables) are stored in **temporary files** (`pg_stat_tmp/`), not in the WAL or transaction log. On shutdown, a permanent copy is saved; on startup, stats are loaded from this file; if corrupted or missing, they are rebuilt from scratch. Autovacuum thresholds are configuration parameters, not transactional data. Query plan caches are purely in-memory and ephemeral. PostgreSQL deliberately keeps learned/adaptive state outside the transaction log because statistics are derived, disposable, and reconstructable.

The recommended architecture for HomeSynapse follows this pattern directly. The event store contains business events only — deterministic replay is unaffected. A separate `adaptive_parameters` SQLite table stores current tuning values (`param_name`, `current_value`, `last_updated`, `observation_count`, `confidence_score`), persisted periodically (every 5 minutes). Statistical summaries (t-digests, EWMA values, histograms) live in-memory and are serialized to the tuning state table on graceful shutdown, rebuilt from scratch on cold start.

**The boundary is clean: events are things that happened (business facts); learned state is derived observations about system behavior (operational metadata).** If the system is replayed from events, it starts with default tuning parameters and re-learns them — analogous to PostgreSQL rebuilding statistics after `initdb`. The learning process converges within minutes to hours, and reasonable defaults ensure acceptable cold-start performance.

One exception: if a tuning decision has business significance (e.g., "event coalescing policy was changed because of user-reported notification flooding"), that decision can be stored as a `TuningPolicyChanged` event. But the statistical state that drove the decision stays outside the event store.

### Self-tuning prior art favors control theory over machine learning

The most successful and widely deployed self-tuning system in existence is **TCP congestion control** — running on billions of devices, adapting to network conditions in real time, with negligible compute overhead. Its AIMD (Additive Increase / Multiplicative Decrease) pattern is provably stable, converges to fair resource sharing, and operates on far less capable hardware than a Raspberry Pi. Google's **BBR** (2016) takes this further by maintaining an internal model of bottleneck bandwidth and minimum RTT, periodically probing for more capacity — the most relevant TCP variant for HomeSynapse's capacity-modeling needs.

Industrial PLC self-tuning has an even deeper heritage. **Over 80% of industrial control loops use PI-only (proportional-integral) controllers**, and modern DCS/PLC platforms (Siemens, ABB, Honeywell, Rockwell) include self-tuning PID regulators that automatically calculate controller parameters via relay auto-tuning or step response methods. The **ASPECT system** implements self-tuning nonlinear control on PLC hardware with mathematical coprocessors — directly relevant to Pi-class hardware. **Gain scheduling** — switching between pre-computed parameter sets based on operating conditions — is the simplest applicable pattern: different configurations for "few devices active" vs. "many devices active," with negligible computational overhead.

Among smart home platforms, **Hubitat** has the most interesting adaptive features, but all at the protocol layer: automatic Z-Wave mesh re-optimization, on/off command deduplication (skipping "on" to devices already on), and configurable metering delays between group commands. **Home Assistant has no system-level self-tuning** — all performance optimization is manual YAML configuration. openHAB similarly lacks any adaptive features.

**The verdict on framing**: "Machine Learning" is the wrong term for what HomeSynapse needs. **"Adaptive Self-Tuning" or "Feedback-Driven Configuration"** accurately describes the approach: statistical observation (EWMA, t-digest) driving bounded parameter adjustments via simple feedback loops. This is classical control theory. ML becomes relevant only when parameter spaces exceed 100+ knobs with complex interactions, when cross-parameter effects are unpredictable, or when the system needs to predict future load patterns rather than react to current conditions. None of these apply to a smart home with <200 devices and <20 tunable parameters.

### Fleet intelligence should start with curated profiles, not telemetry

Federated learning is impractical for HomeSynapse. Standard cross-device FL requires **thousands to millions of participants** — Google deploys it across billions of Chrome installations. No mature Java FL framework exists (all major frameworks are Python-based). Running FL model training on a Pi 4/5 simultaneously serving as a smart home controller risks responsiveness, as benchmarks show CPU and RAM maxing out during training rounds.

Differential privacy faces a fundamental scale problem. Local DP (noise added on-device, Apple's approach) requires massive populations for signal recovery. Google's RAPPOR research showed that with 10,000 reports results were "just too noisy," with meaningful signal only emerging at **100,000+ participants**. Apple acknowledged this limitation, noting they moved to multi-party computation for some use cases because "local DP requires a significant amount of noise to be added, allowing us to discover only the most prominent signal." For a project with hundreds to low thousands of users, local DP produces useless data.

The practical path is a phased approach. **Phase 1 (now)**: Ship with 3–5 curated configuration profiles based on hardware and scale (e.g., "Small deployment <50 devices, SD card" through "Large deployment 200+ devices, NVMe required"). Implement local adaptive tuning where the system monitors itself and adjusts within profile bounds. No data ever leaves the device. **Phase 2 (if community exceeds ~500 installations)**: Offer optional opt-in telemetry with a minimal bucketed payload — `device_count_bucket`, `storage_type`, `avg_event_rate_bucket`, `p99_latency_bucket`, coarse config parameters. No timestamps, no IP storage, no installation identifiers. Apply central DP (Google's Java DP library) to server-side aggregates at ε = 4–8. **Phase 3 (only if exceeding 5,000 installations)**: Consider RAPPOR-style collection for specific categorical data. Federated learning remains unlikely to be necessary.

For GDPR compliance, truly anonymized system metrics (bucketed, no identifiers, no IPs) likely fall outside GDPR scope per Recital 26. However, **opt-in consent is recommended** for trust and legal safety — consent must be active (not pre-selected), obtained before first collection, with transparent disclosure and easy revocation.

---

## Architecture compatibility and extension point recommendations

Every proposed optimization must respect four event-sourcing invariants: immutable events, deterministic replay, single-writer model, and durability guarantees. The compatibility assessment is favorable across the board, with one important nuance.

| Optimization | Immutable events | Deterministic replay | Single-writer | Durability |
|:---|:---:|:---:|:---:|:---:|
| Derived event coalescing | ✅ Source events intact | ⚠️ Must re-apply coalescing on replay | ✅ | ✅ |
| Priority write scheduling | ✅ | ✅ Per-device order preserved | ✅ Native fit | ✅ |
| Adaptive WAL checkpointing | ✅ | ✅ | ✅ | ✅ `synchronous=NORMAL` safe in WAL |
| Per-subscriber backpressure | ✅ | ⚠️ Timing-dependent strategies non-deterministic | ✅ Never affects writer | ✅ Events persisted before dispatch |
| On-device statistical tracking | ✅ Outside event store | ✅ Not part of replay | ✅ | ✅ Separate table |

The replay nuance: if derived events are coalesced during live processing but source events are intact, replaying source events will regenerate all derived events — potentially producing more events during replay than during live operation. The mitigation is either applying the same coalescing logic during replay, or marking derived events as "notification-only" and excluding them from replay entirely. The latter is cleaner and aligns with treating derived events as ephemeral projections.

### What to prepare now versus decide later

**Prepare now** — these interface decisions are low-cost and keep doors open:

- **Define a `WriteCommand` abstraction** with a `priority` field and `deviceId` for partitioned ordering. Even if the initial implementation uses a simple FIFO queue, the abstraction enables swapping in `PriorityBlockingQueue` later without restructuring.
- **Separate the event fan-out dispatcher from the writer.** Writer → Event Store → Fan-out Dispatcher → Per-subscriber queues. This decoupling is essential for all backpressure strategies and costs almost nothing architecturally.
- **Design subscriber queue interfaces with pluggable overflow strategies** (buffer, latest, catch-up). Ship with one strategy; the interface enables adding others.
- **Disable SQLite auto-checkpoint and register a custom WAL hook** from day one. Even if the initial implementation mimics auto-checkpoint behavior, owning the hook enables adaptive scheduling without code restructuring.
- **Instrument key metrics with EWMA** (event rate, write latency, queue depth) from the start. The cost is ~48 bytes per metric. These observations are prerequisites for any future adaptive behavior.
- **Store tuning parameters in a separate `adaptive_parameters` table**, even if initially populated only with static defaults. This establishes the boundary between business events and operational metadata.

**Decide later** — these add complexity and should wait for evidence of need:

- AIMD-style dynamic flow control (simple bounded buffers likely sufficient at <200 devices)
- Learned/adaptive priority from usage patterns (static 5-level priority sufficient initially)
- t-digest and HDR Histogram deployment (EWMA alone drives the first generation of feedback loops)
- Any form of fleet telemetry (local adaptive tuning provides 90%+ of value)
- PID controllers for tuning parameters (simple threshold-based adjustments with hysteresis are adequate initially)
- Event coalescing window auto-tuning (start with static configurable windows per device type)

---

## Conclusion

HomeSynapse's cascade amplification problem maps precisely to challenges already solved in production systems. The highest-impact intervention is architectural, not algorithmic: **persist all source events, treat derived events as ephemeral projections, and coalesce them through time-windowed batching** (Home Assistant's 5-second `commit_interval` pattern) combined with **significance filtering** (Home Assistant's `async_check_significant_change` pattern). This alone could reduce the 100–210ms cascade latency to near-single-event latency for most practical scenarios.

The most underappreciated finding is how dramatically **storage type dominates all other optimizations**. SD cards deliver 2–6,000 random write IOPS versus NVMe's 57,000–92,000 — a difference that dwarfs anything achievable through software tuning. Mandating NVMe for installations above ~100 devices would provide more benefit than every adaptive algorithm combined.

For self-tuning, the entire monitoring infrastructure fits in 170 KB of memory — a rounding error on a 4 GB system. The correct vocabulary is "adaptive self-tuning with feedback loops," drawing from TCP congestion control and industrial PID heritage rather than machine learning. Simple EWMA-based feedback loops on write latency and queue depth, driving bounded adjustments to batch size and checkpoint timing, deliver the vast majority of adaptive value. Fleet intelligence should begin as curated configuration profiles and community benchmarks — the privacy-preserving alternatives (federated learning, differential privacy) require user populations orders of magnitude larger than HomeSynapse will likely achieve in its early years.

The strategic insight: **design the extension points now, but ship the simplest viable implementation.** A `WriteCommand` with a priority field, a fan-out dispatcher with pluggable overflow strategies, a custom WAL hook, and EWMA instrumentation on key metrics — these decisions cost almost nothing today and keep every optimization door open for when the system's actual production workload reveals what genuinely matters.