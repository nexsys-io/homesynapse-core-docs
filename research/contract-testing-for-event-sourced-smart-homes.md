# Contract testing for event-sourced smart home systems

**The most critical lesson across event-sourced frameworks and smart home platforms is identical: startup ordering and crash-recovery checkpointing are where almost every system breaks first.** Axon Framework, Marten, and EventStoreDB have all converged on abstract contract test suites with factory-method extension points, atomic checkpoint-and-projection writes, and gap-aware sequence tracking — patterns that directly address the startup race conditions plaguing Home Assistant (6+ documented GitHub issues), OpenHAB (officially documented persistence-before-rules race), and SmartThings (405+ tracked cloud outages before their local pivot). This report catalogs concrete test patterns, specific edge cases, and real failure stories across all eight requested domains.

---

## 1. How mature frameworks structure event store contract tests

Axon Framework establishes the gold standard for abstract contract test suites. Its `AbstractEventStorageEngineTest` base class defines all behavioral contracts — append-and-read, concurrent write detection via key constraint violations, gap-aware tracking token behavior — and publishes these as a **Maven test-jar** so that extension modules (`axon-mongo`, `axon-jdbc`) simply extend the base and override a factory method:

```java
abstract class AbstractEventStorageEngineTest {
    protected abstract EventStorageEngine createEngine();
    
    @Test void shouldStoreAndLoadEvents() { /* contract */ }
    @Test void shouldDetectConcurrentWrites() { /* contract */ }
    @Test void shouldHandleGapAwareTrackingTokens() { /* contract */ }
}

class JdbcEventStorageEngineTest extends AbstractEventStorageEngineTest {
    @Override protected EventStorageEngine createEngine() {
        return new JdbcEventStorageEngine(/* HSQL in-memory config */);
    }
}
```

In **Axon 5**, these were renamed to `StorageEngineTestSuite` with adjustments for transactional executors. The critical insight is that Axon's `GapAwareTrackingToken` has configurable `gapTimeout` (default **60 seconds**) and `gapCleaningThreshold` (default **250**) — these are precisely the parameters most custom implementations forget to test.

**Marten** takes a different approach since it's PostgreSQL-only: its test suite splits into `CoreTests`, `DocumentDbTests`, and `EventSourcingTests`, with base classes `IntegrationContext` (deletes data between runs), `DestructiveIntegrationContext` (wipes schema), and `OneOffConfigurationsContext` (unique store configurations per test). Marten's projection testing is particularly instructive. For inline projections, tests immediately call `LoadAsync<T>()` after `SaveChangesAsync()` since both happen in the same transaction. For async projections, Marten provides `WaitForNonStaleData` — a built-in query-time mechanism that blocks until the async daemon catches up. The `DaemonSettings.StaleSequenceThreshold` (default **3 seconds**) triggers gap-skipping when sequence numbers are reserved but never committed, and Marten emits an OpenTelemetry counter (`marten.daemon.skipping`) every time this happens.

**EventStoreDB** separates catch-up subscriptions (client-managed checkpoints) from persistent subscriptions (server-managed). A documented bug (#1081) showed that persistent subscriptions with `StartFromBeginning` could resend messages after an EventStoreDB restart — the repro test was literally named `ShouldNotResendMessagesAfterRestart()`. For catch-up subscriptions, the best practice from Oskar Dudycz's reference implementation is storing the checkpoint in the same database transaction as the read model update.

**Eventuous** provides an `IEventStore` interface split into `IEventReader` and `IEventWriter`, with `InMemoryEventStore` for testing and production implementations for EventStoreDB and PostgreSQL. Its checkpoint commit handler is notable for handling **out-of-order checkpoints from parallel partition consumers** — it reorders them and only stores the latest gap-free position. Issue #165 documented intermittent checkpoint tracking failures during early subscription startup.

### Edge cases most implementations miss

The commonly missed edge cases across all frameworks cluster around five areas. **Position gaps** (sequences reserved but never committed) are handled by Marten's `StaleSequenceThreshold` and Axon's `GapAwareTrackingToken`, but most custom implementations have no gap detection at all. **Concurrent write detection** requires database-specific error code mapping — Axon uses `SQLErrorCodesResolver` to translate vendor-specific constraint violations into `ConcurrencyException`. **Empty store behavior** causes subtle bugs: Axon issue #1786 revealed that `createHeadToken()` on an empty event store behaves differently than expected. **Sequence overflow** is not explicitly tested by any reviewed framework, likely because 64-bit sequences are considered practically inexhaustible. **Event skipping in async daemons** is tracked by Marten via the `mt_high_water_skips` table but is invisible in most custom implementations.

---

## 2. Smart home platforms break at startup, staleness, and cloud dependency

### Home Assistant's event bus and startup races

Home Assistant's architecture centers on an event bus originally built with `threading.Thread` and `RLock`, now running on Python's `asyncio`. The platform maintains an ADR repository at `github.com/home-assistant/architecture` with 62 committed decisions. Despite requiring **95%+ test coverage** for all integration modules, critical race conditions persist:

**Issue #124594** (August 2024) revealed that `homeassistant_start` and `homeassistant_started` events fire *before* the Automation integration loads, making them undetectable via Event Triggers — a fundamental startup ordering deficiency. **Issue #132004** (December 2024) documented Utility Meters entering a permanently broken state because ESPHome devices take ~30 seconds longer to initialize than the meter expects. **Issue #95887** (July 2023) showed the HA core failing to communicate with the Supervisor API during startup because the system state is still `setup`, with no proper retry logic. **Issue #115193** (April 2024) found that two automations sharing the same trigger race unpredictably — disabling one via the other no longer prevents it from completing.

For device staleness, Home Assistant has a formal quality-scale rule called "Stale devices are removed" using `DataUpdateCoordinator` to diff current vs. previous device sets. However, **there is no built-in native staleness detection for entity values** (i.e., "this sensor hasn't reported in X hours"). Community solutions like `unavailable-entities-sensor` and `ad-ench` (with configurable `stale: max_stale_min`) fill this gap. A Feature Request asking to "see when last sensor data was received, even if unchanged" remains open, confirming this as a core gap.

### OpenHAB's officially documented persistence-rules race

OpenHAB's persistence documentation states plainly: *"Persistence services and the Rule engine are started in parallel. Because of this, it is possible that, during an openHAB startup, Rules will execute before Item states used by those Rules have been restored."* The official workaround — creating a `delayed_start` Item with an empirically-determined delay — is a design-level deficiency. OpenHAB 3 introduced start levels (rules at 40, Things at 80, startup complete at 100), but `System started` triggers at level 40 before Things initialize at level 80. Community reports describe users resorting to `Thread::sleep(30000)` in startup rules.

For staleness, OpenHAB's **Expire binding/profile** (`expire="2m"`) is the closest any platform comes to a `staleAfter` pattern — it automatically reverts item state to a default after a configurable timeout. However, no platform was found to use an explicit **staleAfter + clock-injection** pattern for deterministic time-based testing.

### SmartThings: 405+ outages drove the local processing pivot

StatusGator has tracked **405+ outages** since January 2019 across SmartThings' 15 components. The platform underwent a massive migration from cloud-based Groovy Device Type Handlers to local Lua-based Edge Drivers between April 2022 and July 2023. Failed migrations produced non-functional "Thing" placeholders, community integrations (webCoRE, Life360, Logitech Harmony) broke permanently, and some 2015-era Samsung devices lost all functionality. The pivot acknowledged that their cloud-first architecture was fundamentally unreliable for home automation.

**Hubitat** processes 100% of automations locally with sub-500ms response times, but Z-Wave commands are fire-and-forget with **no built-in retry/verification** — users report lights staying on overnight every 3-4 days because sleep rules' "off" commands fail silently.

---

## 3. Checkpoint store testing demands atomic writes and gap awareness

The essential checkpoint store interface, distilled from EventStoreDB and Eventuous patterns, has exactly two operations:

```java
public interface CheckpointStore {
    OptionalLong load(String subscriptionId);        // null = never stored
    void store(String subscriptionId, long position); // idempotent overwrite
}
```

The critical test scenarios are: **store-and-load roundtrip**, **non-existent subscriber returns empty** (not an exception), **overwrite replaces previous value**, and **position zero is valid** (distinct from "no checkpoint stored"). For crash-safe resumption, the pattern from EventStoreDB's ecosystem is: store checkpoint → simulate crash (close connection) → restart → verify the subscription resumes from the stored position with no duplicate delivery.

**Atomic checkpoint-and-event-write** is the single most important pattern for exactly-once processing. The approach from Oskar Dudycz stores the checkpoint in the same database transaction as the read model update:

```typescript
await postgres.tx(async (transaction) => {
    for (const handle of handlers) await handle(db, event);
    await storeCheckpointInPostgres(event); // Same transaction!
});
```

For concurrent checkpoint testing, Eventuous's commit handler is instructive: it accumulates out-of-order checkpoints from parallel partition consumers and only stores the latest gap-free position. Testing this requires submitting checkpoints out of order (e.g., positions 5, 3, 4, 7, 6) and verifying the stored position advances correctly (to 5 after receiving 3-4-5, then to 7 after receiving 6-7).

Materialized view checkpoint stores that store opaque `byte[]` data need version-aware invalidation testing: store a checkpoint with version 1, update the projection schema (version 2), verify the old checkpoint is rejected or triggers a full rebuild.

---

## 4. State store testing: thread safety, staleness, and projection replay

### ConcurrentHashMap testing without flakiness

The key insight is **don't test ConcurrentHashMap itself** — it's exhaustively tested by the JDK. Instead, test your application's compound operations. Atomic methods like `computeIfAbsent()`, `compute()`, and `merge()` are safe, but check-then-act sequences are not. The non-flaky pattern uses `CyclicBarrier` to force simultaneous execution and asserts on final state rather than intermediate states:

```java
@Test void shouldHandleConcurrentProjectionUpdates() {
    var barrier = new CyclicBarrier(100);
    var store = new ConcurrentHashMap<String, EntityState>();
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        for (int i = 0; i < 100; i++) {
            executor.submit(() -> {
                barrier.await(); // all threads start simultaneously
                store.compute("entity-1", (k, v) -> applyEvent(v, event));
            });
        }
    }
    assertEquals(expectedFinalState, store.get("entity-1"));
}
```

### Clock injection for stale-at-read-time computation

The `staleAfter` + Clock pattern is a well-established Java testing idiom. The production code accepts `java.time.Clock` (or `InstantSource` since Java 17) via constructor injection:

```java
public class DeviceState {
    private final Clock clock;
    private Instant staleAfter;
    
    public boolean isStale() {
        return staleAfter != null && Instant.now(clock).isAfter(staleAfter);
    }
}
```

Tests use `Clock.fixed()` for point-in-time assertions and a `MutableTestClock` (subclassing `Clock` with an `advance(Duration)` method) for testing state transitions over time. The .NET equivalent is `Microsoft.Extensions.Time.Testing.FakeTimeProvider`, which Marten uses in its own test suite.

### Three-tier consistency and projection replay determinism

Testing three-tier consistency follows naturally from event sourcing semantics. **Per-entity consistent reads** are tested by appending events and calling `AggregateStreamAsync<T>()` — the result is always strongly consistent because it replays the entity's event stream. **Weakly-consistent batch reads** through async projections require either Marten's `WaitForNonStaleData` or explicit daemon synchronization. **Fully-consistent snapshot reads** are tested by replaying all events from position 0 and verifying deterministic output.

Projection replay determinism is the most foundational test: append a known event stream, project to build state M1, delete the read model, replay all events to build M2, and assert **M1 equals M2**. This works only when the projector is a pure function — it must never consume information outside the events, read other projections, or trigger side effects. The Neos CMS documentation articulates this principle most clearly.

For testing `getSnapshot()` (O(N), replays all events) vs. `getState()` (O(1), reads from cache), the pattern is: verify `getState()` equals `getSnapshot()` at rest, then verify `getState()` returns under concurrent reads without blocking using `CompletableFuture.allOf()` with timing assertions.

---

## 5. Write coordination requires re-entrancy awareness and starvation prevention

### Single-writer patterns and SQLite WAL

The **LMAX Disruptor** is the canonical single-writer implementation: data is owned by exactly one thread for write access, eliminating contention. It uses pre-allocated ring buffers, monotonic sequence counters instead of locks, and consumer dependency graphs. SQLite WAL mode provides the database equivalent: unlimited concurrent readers with a single writer. At **1000x concurrency**, increasing `busy_timeout` by ~20 seconds reduces timeout probability by 10x. WAL mode eliminates reader-writer blocking but not writer-writer blocking — the `busy_timeout` pragma is the single most impactful setting.

### Re-entrant write deadlock prevention

When a subscriber handler produces derived events during processing, re-entrant calls to the event bus can deadlock. The Mars Pathfinder incident (1997) is the canonical example of priority inversion causing system resets — notably, *"in testing, the problem was not repeatable and could not be isolated."*

Three solutions exist for re-entrant event processing. **Queue-based dispatch** buffers derived events during processing and dispatches after the current handler completes — this is the safest approach. **Reentrant locks** (Java's `synchronized` or `ReentrantLock`) allow recursive entry but risk unbounded recursion. **The Disruptor approach** separates concerns entirely so producers and consumers never contend on the same structures.

Testing for deadlocks uses **timeout-annotated tests**:

```java
@Test(timeout = 5000) // Timeout detects deadlock
void derivedEventsDontDeadlock() {
    bus.register(event -> bus.post(new DerivedEvent(event))); // Re-entrant
    bus.post(new PrimaryEvent()); // Must complete within 5 seconds
}
```

### Priority starvation testing

To verify high-priority writes (event persistence) are never starved by low-priority operations (retention, vacuum), continuously submit low-priority operations while measuring high-priority write latency under contention. The assertion is bounded: high-priority writes must complete within a fixed time ceiling regardless of low-priority load. A complementary "fairness" test verifies low-priority tasks eventually complete via aging/promotion.

---

## 6. Event bus contracts split cleanly between sync and async

The Guava EventBus provides a clean model for distinguishing sync-appropriate from async-only tests. **Both implementations should pass**: event routing correctness, type hierarchy routing, dead event handling (unmatched events wrapped in `DeadEvent`), registration/unregistration lifecycle, exception isolation (subscriber throws → logged, not propagated), and filter evaluation correctness. **Only async implementations need**: non-blocking `post()` return, concurrent subscriber execution, `@AllowConcurrentEvents` behavior, and backpressure under slow subscribers. **Only sync (test-only) implementations guarantee**: deterministic ordering (subscribers execute in registration order), state-after-post assertions (all side effects complete when `post()` returns), and sequential causality (event A handler posts event B, B runs before A.post() returns).

For backpressure coalescing, Project Reactor's `StepVerifier` is the primary tool:

```java
StepVerifier.create(flux)
    .thenRequest(1).expectNext(first)
    .thenRequest(2).expectNext(second, third)
    .verifyComplete();
```

Five coalescing strategies exist: **Use First** (overlapping requests skip), **Use Last** (latest request cancels previous), **Queue** (sequential execution), **Debounce** (delayed until inactivity), and **Aggregate** (batch collection). Testing coalescing uses `TimeProvider` abstractions for deterministic time control — the `dorssel/dotnet-debounce` library demonstrates 100% code coverage via interface-based mocking of time.

For filter conjunction testing, the Cartesian product approach verifies that a composite filter (event type AND priority AND subject type) correctly matches when all criteria are satisfied and rejects when any single criterion fails. AWS EventBridge provides a `TestEventPattern` API for exactly this purpose.

---

## 7. Virtual thread testing centers on pinning detection and platform thread delegation

### JFR-based pinning assertions

The `jdk.VirtualThreadPinned` event (enabled by default, **20ms threshold**) is the primary mechanism for detecting virtual thread pinning in tests. Three approaches exist in increasing order of convenience:

**JfrUnit** (by Gunnar Morling) provides JUnit 5 integration:
```java
@JfrEventTest
public class PinningTest {
    public JfrEvents jfrEvents = new JfrEvents();

    @Test @EnableEvent("jdk.VirtualThreadPinned")
    public void shouldNotPin() {
        exerciseVirtualThreadCode();
        jfrEvents.awaitEvents();
        assertTrue(jfrEvents.events().findAny().isEmpty());
    }
}
```

**Raw RecordingStream** requires no external dependency but needs careful timing:
```java
var pinEvents = new CopyOnWriteArrayList<RecordedEvent>();
try (var rs = new RecordingStream()) {
    rs.enable("jdk.VirtualThreadPinned")
      .withThreshold(Duration.ZERO); // Catch ALL pinning, not just >20ms
    rs.onEvent("jdk.VirtualThreadPinned", pinEvents::add);
    rs.startAsync();
    // ... exercise code ... allow ~1s for JFR event flush
}
assertTrue(pinEvents.isEmpty());
```

**Quarkus `@ShouldNotPin`** is the most ergonomic but adds ~2-5 seconds overhead per test (Quarkus issue #38721).

### ReentrantLock vs synchronized on Java 21

On Java 21, `synchronized` blocks that perform blocking operations **pin the carrier thread**. Netflix documented a production deadlock ("Dude, Where's My Lock?") where 4 virtual threads each pinned to a carrier thread inside `synchronized` blocks in Zipkin's `CountBoundedQueue`, exhausting the ForkJoinPool entirely. The fix is replacing `synchronized` with `ReentrantLock`. **JEP 491 (Java 24+) resolves this** — `synchronized` no longer pins. Detection on Java 21-23 uses `-Djdk.tracePinnedThreads=full` (removed in Java 24).

A hidden gotcha: **`ConcurrentHashMap.computeIfAbsent()`** uses internal `synchronized` and causes pinning on Java 21 when the lambda performs blocking I/O. This is fixed in Java 24.

### JNI pinning persists across all Java versions

JNI calls **always pin** virtual threads, including in Java 24+. Libraries like sqlite-jdbc route all operations through JNI. The solution is a bounded platform thread executor:

```java
private static final ExecutorService PLATFORM_EXEC = 
    Executors.newFixedThreadPool(
        Runtime.getRuntime().availableProcessors(),
        Thread.ofPlatform().name("jni-worker-", 0).factory());

public static <T> T onPlatformThread(Callable<T> task) throws Exception {
    return PLATFORM_EXEC.submit(task).get();
}
```

Tests verify delegation by checking `Thread.currentThread().isVirtual()` inside the platform-thread callable returns `false`, and by using JFR to confirm zero `VirtualThreadPinned` events during sqlite operations routed through this executor.

### Clock injection combines cleanly with virtual threads

`java.time.Clock` (Java 8+) and `InstantSource` (Java 17+) are the standard injection points. For tests needing time advancement, a `MutableTestClock` subclass with `advance(Duration)` avoids creating new clock instances. The pattern combines with virtual thread testing by injecting the clock into scheduled tasks and calling `advance()` + `tick()` deterministically — no real waiting required.

---

## 8. Ring buffer testing requires wrap-around, monotonicity, and corruption resilience

### Critical test cases from LMAX Disruptor and Agrona

The Disruptor uses **64-bit monotonically increasing sequences** starting at `INITIAL_CURSOR_VALUE = -1L`, with ring buffer index computed as `sequence & (capacity - 1)` for power-of-two capacities. Its test suite covers five canonical topologies: Unicast (1P-1C), Three-Step Pipeline (1P-3C sequential), Sequencer (3P-1C), Multicast (1P-3C broadcast), and Diamond (1P-3C with fan-out/fan-in). Test names follow the pattern `shouldPublishEvents`, `shouldNotPublishEventsIfBatchIsLargerThanRingBuffer`.

Agrona's `ManyToOneRingBuffer` tests use Mockito to mock the underlying `UnsafeBuffer`, with a critical test `shouldUnblockWhenFull()` that handles the case where a writer dies mid-write, leaving the buffer in a stalled state. The buffer uses a trailer with tail, head, and head-cache position counters, and supports `tryClaim`/`commit`/`abort` for zero-copy publication — the abort path is essential for crash recovery.

### Overwrite and wrap-around edge cases

The fundamental wrap-around test (from Captain Debug's pattern) verifies that writing N+1 items into an N-capacity buffer discards the oldest:

```java
@Test void overwriteByOne() {
    buffer.enqueue("A"); buffer.enqueue("B"); buffer.enqueue("C"); // capacity = 3
    buffer.enqueue("D"); // overwrites "A"
    assertEquals("B", buffer.dequeue());
    assertEquals("C", buffer.dequeue());
    assertEquals("D", buffer.dequeue());
}
```

The bitdrift Capture SDK adds **fuzz testing** as a primary strategy: LLVM libFuzzer with protobuf-mutated inputs exercises SPSC, MPSC, and buffer corruption scenarios. Their buffer corruption fuzzer directly fuzzes the disk file to test resilience, with CRC32 on both control blocks and individual records for integrity verification.

### Monotonic sequence testing under concurrency

Single-threaded monotonicity is straightforward: verify each `next()` call returns a value strictly greater than the previous. Multi-threaded monotonicity (from LMAX's concurrent sequencing) uses `AtomicLong.incrementAndGet()` for claiming unique sequences, with busy-spin serialization for publishing: a thread publishing sequence N spins until the cursor reaches N-1. The test runs N threads each publishing M events and verifies total = N×M with no duplicates and no gaps.

### Retention tier lifecycle testing

InfluxDB's retention model deletes entire shard groups when all data exceeds the retention period, meaning data can persist up to `retention_period + shard_group_duration`. A critical edge case (GitHub issue #4441): `ALTER RETENTION POLICY` doesn't update existing shards — expiry time is baked in at shard creation. Prometheus TSDB has a similar block-level issue: size-based retention is not enforced when compaction fails due to disk full (issue #10890). Multi-tier retention tests should verify: data flows correctly between tiers, queries transparently span tiers, tier transitions don't lose data, and retention policy changes handle existing data correctly.

---

## Conclusion

The research reveals three overarching patterns that cut across all eight domains. First, **abstract contract test suites with factory-method extension** (Axon's `AbstractEventStorageEngineTest`, Eventuous's `IEventStore` interface) are the proven way to share tests between in-memory and production implementations — every custom event store should adopt this pattern. Second, **atomic checkpoint-and-projection writes in the same transaction** is the single most impactful reliability pattern, directly preventing the duplicate-processing bugs that plague both event-sourced systems and smart home platforms. Third, **deterministic time control through clock injection** eliminates the flakiest category of tests across staleness detection, virtual thread scheduling, and retention tier lifecycle.

The most under-tested areas are position gap detection (only Axon and Marten handle this explicitly), startup ordering (every smart home platform documents this as a known issue rather than a tested scenario), and JNI pinning delegation (no framework provides built-in support — every virtual thread application using sqlite-jdbc must build this themselves). The `staleAfter + Clock` pattern for device staleness — which no smart home platform currently implements with clock injection — represents a concrete testing improvement that would prevent multiple classes of bugs documented across Home Assistant, OpenHAB, and Hubitat.