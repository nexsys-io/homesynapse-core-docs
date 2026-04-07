# How to build a test suite that proves HomeSynapse's architecture

**HomeSynapse can achieve a provably superior test suite by exploiting the specific testing gaps that plague Home Assistant and OpenHAB, while adopting the mature given/when/then patterns from Axon Framework and layering on advanced techniques — property-based testing, mutation testing, chaos engineering, and deterministic time — that no open-source smart home platform currently uses.** Both leading platforms suffer from inflated coverage metrics, race conditions in event processing, inadequate constrained-hardware testing, and over-reliance on mocks that diverge from real device behavior. Event-sourced architecture gives HomeSynapse a structural advantage: the entire system state is a function of its event history, making it inherently more testable than the mutable-state designs of competitors. The concrete path forward combines Axon-style aggregate test fixtures, jqwik property-based invariant verification, ArchUnit module boundary enforcement, Toxiproxy fault injection, and a three-tier CI pipeline spanning QEMU emulation through real Raspberry Pi hardware.

---

## Home Assistant tests widely but shallowly

Home Assistant's test suite is the largest in the smart home space — tens of thousands of pytest-based tests across **2,000+ integration directories**, with reported coverage of approximately 97%. But this headline figure conceals serious weaknesses. A July 2024 architecture discussion (GitHub #1105) explicitly acknowledged the number is "artificially maintained by excluding files that do not meet our coverage threshold using the `.coveragerc` file." When maintainer Frenck proposed dropping these exclusions, the team expected a "significant drop." Many integrations shipped with zero tests.

The testing stack relies on pytest, pytest-asyncio, freezegun for time manipulation, Syrupy for snapshot testing, and extensive use of `unittest.mock`. Every integration is tested through a standardized pattern: set up via `MockConfigEntry`, assert via `hass.states.get()`, call services via `hass.services.async_call()`. This consistency is admirable, but the mocking strategy exposes a critical gap. **For all hardware protocols — Zigbee, Z-Wave, Matter — HA mocks at the library API boundary**, never at the protocol level. ZHA tests use `FakeApplication` and `FakeEndpoint` objects that simulate zigpy behavior. Z-Wave JS tests mock the WebSocket connection to the external driver. The actual protocol behavior is deferred entirely to upstream libraries, which means HA cannot detect when real device timing, reconnection patterns, or error modes diverge from mock behavior.

This gap has real consequences. In 2026.4.x, a memory leak crashed Raspberry Pi 5 installations within 10–15 minutes, particularly with ZHA — suggesting insufficient stress testing on constrained hardware. The Cast integration suffered repeated regressions: session reuse broke Nest Hub behavior in 2026.3.x, and custom card casting failed starting 2025.12.3. Database migrations have failed across at least four major releases (2024.8, 2024.9, 2025.4), with users reporting 12-hour waits and integrity constraint violations on large MariaDB databases.

The most structurally damaging pattern involves **race conditions in the event bus**. HA's async architecture creates non-deterministic event ordering that causes real production bugs: template sensors haven't re-evaluated before automations check conditions (Issue #151585), successive calendar events produce incorrect state due to ordering races (Issue #146316), and automations in `restart` mode throw exceptions under concurrent triggers (Issue #37907). HA uses `await hass.async_block_till_done()` in tests to synchronize, but this utility masks rather than tests for ordering issues.

Home Assistant uses **no property-based testing, no fuzz testing, no chaos testing, and no contract tests**. There is no formal enforcement that integrations comply with core interfaces — it's purely convention-based. The community has requested an automation testing framework (feature request #688889) that remains unimplemented. These gaps represent clear opportunities for HomeSynapse.

---

## OpenHAB's OSGi dependency cripples its test infrastructure

OpenHAB presents a contrasting but equally instructive case. Built on OSGi with JUnit 5, Mockito, and Hamcrest, its test architecture splits into two tiers: standard unit tests in `src/test/` and OSGi integration tests in `itests/` that extend the `JavaOSGiTest` base class and run inside an actual OSGi container via bnd-testing-maven-plugin.

The integration tier is where the interesting testing happens — and where the problems are worst. The `RuntimeRuleTest` (477 lines) is OpenHAB's most valuable cross-subsystem test, spanning event bus triggers → condition evaluation → action execution across the item registry and rule engine. But these tests are explicitly documented as something that "should be used sparingly" because the `.bndrun` configuration, dependency resolution, and OSGi startup overhead create a prohibitive barrier to writing them.

This barrier has devastating effects on coverage. **OpenHAB does not use Codecov, Coveralls, or any coverage tracking service.** No coverage badges, no PR coverage checks, no minimum thresholds. The DESOSA 2021 analysis from TU Delft confirmed that "writing tests for every line of code is not mandatory in openHAB" and "many pull requests do not test their pull requests." Of the 400+ bindings in openhab-addons, only a handful have integration tests. Issue #144 in the Zigbee binding revealed that the pom.xml had `testSourceDirectory` misconfigured — **unit tests existed but were silently never run by Maven**.

The OSGi integration tests themselves are unstable. Issue #2134 documented persistent failures with `java.io.IOException: Stream closed` caused by a bnd bug where `System.in` gets closed during multi-threaded Maven builds. The workaround required splitting CI into two separate builds — one for compilation and one for tests. The official README even normalizes test failures: "If there are tests that are failing occasionally on your local build, run `mvn -DskipTests=true clean install`."

For HomeSynapse, OpenHAB demonstrates the **cost of coupling your runtime architecture to your test architecture**. By choosing a modular monolith over OSGi, HomeSynapse avoids this trap entirely — standard JUnit 5 tests can exercise cross-module behavior without container startup overhead.

---

## Event-sourced testing patterns that HomeSynapse should adopt wholesale

The event sourcing ecosystem has developed mature, well-proven testing patterns that map directly to smart home domain concepts. Axon Framework's `AggregateTestFixture` provides the canonical implementation of the **given/when/then pattern**: given a sequence of past events, when a command is dispatched, then expect specific new events (or exceptions, or state conditions).

```
given(DeviceRegisteredEvent, LightTurnedOnEvent)
  .when(SetBrightnessCommand(75))
  .expectEvents(BrightnessChangedEvent(75))
```

This pattern is powerful because it tests behavior purely through events — no database, no framework, no mocking required. The fixture even detects **illegal state changes**: after command execution, it re-sources the aggregate from all events and compares against the live state, catching mutations that occurred outside `@EventSourcingHandler` methods. HomeSynapse should build an equivalent fixture tailored to smart home aggregates (devices, rooms, automations, scenes).

For testing the automation engine — HomeSynapse's equivalent of sagas/process managers — Axon's `SagaTestFixture` provides deterministic time control via `StubScheduler`. Time stops at fixture creation; `whenTimeElapses(Duration.ofDays(1))` advances it predictably. This is essential for testing smart home automations like "if motion detected and no disarm within 30 seconds, trigger alarm" or "turn on porch lights 30 minutes before sunset." The fixture verifies dispatched commands, active saga count, and scheduled events without any real-time dependencies.

Mathias Verraes' taxonomy of event-sourced test patterns provides the complete vocabulary HomeSynapse needs:

- **Command handlers**: Given Events → When Command → Then Events (or Exception, or Nothing for idempotency)
- **Projections**: Given Events → When Query → Then Response (testing state is an anti-pattern; test observable behavior)
- **Process managers**: Given Events → Then Command (delegation) or Then Event (reactive) or Then I/O (mock side effects)

The **Decider pattern** (from Jérémie Chassaing, popularized by Oskar Dudycz) offers an even more testable architecture: three pure functions — `decide(command, state) → events[]`, `evolve(state, event) → state`, `getInitialState() → state` — that are trivially unit-testable without any framework dependency. HomeSynapse should adopt this for its core domain logic.

For event store implementation testing, the critical **contract invariants** to verify are append-only semantics, within-stream ordering with sequential numbering, optimistic concurrency (wrong expected version must fail), idempotent writes via EventId, stream isolation, and monotonically increasing global position. These should be encoded as a reusable `EventStoreContractTest` base class that any event store implementation must pass. Event upcasting should be tested with **golden files** — serialized JSON of each event version stored as test resources, fed through the upcaster chain, with output compared against expected new format — combined with **reflection-based consistency scanning** that verifies every event class has a `@Revision` annotation and a corresponding upcaster.

---

## Testing for Raspberry Pi demands a three-tier CI architecture

Neither Home Assistant nor OpenHAB systematically tests on constrained hardware, and both have suffered production bugs as a result — HA's 2026.4.x memory leak on Pi 5 being the most recent example. HomeSynapse's Raspberry Pi targeting requires a deliberate testing strategy for **memory constraints, thermal throttling, SD card wear, and crash recovery**.

The recommended architecture uses three CI tiers with increasing hardware fidelity:

**Tier 1 runs on every commit** (under 5 minutes, QEMU/cloud): compilation for aarch64, all unit tests with mock protocols, `@ShouldNotPin` virtual thread pinning detection (via Quarkus `loom-unit` JUnit 5 extension), and static analysis with ArchUnit. The `ptrsr/pi-ci` Docker container boots Raspberry Pi OS images using QEMU and integrates with GitHub Actions.

**Tier 2 runs nightly** (under 30 minutes, Docker ARM containers): integration tests against real databases via Testcontainers, JMH benchmark regression suite, memory-constrained tests with `-Xmx512m` (simulating Pi Zero 2W), crash recovery simulation using a custom VFS wrapper modeled on SQLite's approach, and Toxiproxy fault injection against the event store.

**Tier 3 runs weekly or pre-release** (under 2 hours, real Raspberry Pi 5 as GitHub Actions self-hosted runner): full system boot, protocol integration with real USB Zigbee/Z-Wave dongles, thermal stress testing (`stress-ng` with `vcgencmd` monitoring for throttle flags at 80°C/85°C thresholds), power-cycle recovery via USB relay board, and SD card I/O monitoring to track write amplification.

For crash recovery specifically, **LMDB's copy-on-write design** (if used as the event store backing) provides inherent safety — dual meta pages mean a crash loses at most the last uncommitted write transaction. But this must be tested explicitly. SQLite's crash-test VFS is the gold standard: a modified file system layer simulates power loss at varying points during transactions, testing incomplete sector writes, garbage-filled pages, and out-of-order writes. HomeSynapse should build an equivalent Java `FileChannel` wrapper that can simulate partial writes and `fsync` failures, running in a loop that advances the failure point each iteration.

**Virtual thread testing** requires specific tooling. Java 21's virtual threads can pin to carrier threads when entering `synchronized` blocks, causing catastrophic latency cliffs under load — Netflix discovered this in production when just 5 pinned carrier threads froze their entire application. The `loom-unit` JUnit 5 extension provides `@ShouldNotPin` annotations that fail tests when pinning is detected. JDK Flight Recorder's `jdk.VirtualThreadPinned` event (threshold: 20ms) provides production monitoring. Note that Java 24's JEP 491 eliminates `synchronized` pinning entirely, but HomeSynapse on Java 21 must use `ReentrantLock` instead and verify compliance via tests.

---

## Five advanced techniques no smart home platform uses today

These techniques represent HomeSynapse's opportunity to build demonstrably superior testing that competitors cannot match.

**Property-based testing with jqwik** is the highest-value addition. No smart home platform uses it. jqwik generates thousands of random inputs per property and automatically shrinks failures to minimal reproducing cases. For an event store, the key properties are: replaying identical events always produces identical state (reconstitution idempotency), no sequence of valid commands produces invalid aggregate state, aggregate version always equals event count, and certain event pairs commute when they affect independent devices. The Kurrent.io team's "Proof-Oriented Event Sourcing" framework demonstrates that event sourcing makes the reachable state space small enough for PBT to explore effectively. A custom `Arbitrary<List<DomainEvent>>` generator that produces valid event sequences according to domain rules would catch edge cases that example-based tests systematically miss.

**Mutation testing with PIT** verifies that tests actually detect code changes. PIT operates at the bytecode level, replacing `>` with `>=`, removing method calls, and inverting return values, then checking whether tests fail. TheLadders.com maintained ~95% mutation coverage from project start, and when they later refactored their core to use event sourcing, the high mutation score gave them confidence to "just do it" without regressions. For HomeSynapse, PIT is especially valuable for verifying that event handler `apply` methods actually use all event fields and that invariant guards in command handlers aren't dead code. Run weekly or on release candidates — PIT adds 10–30 minutes and is too slow for every commit.

**Chaos testing via Toxiproxy + Testcontainers** simulates the network conditions a Raspberry Pi hub actually faces: latency spikes to cloud services, complete disconnection from the internet, bandwidth throttling during large event replays, and mid-write connection kills to the event store. The pattern is straightforward: Testcontainers launches a Toxiproxy container as a TCP proxy between the application and its dependencies, then injects toxics (latency, bandwidth limits, connection resets) during test execution. Specific scenarios for HomeSynapse include verifying that a connection kill during event append produces no phantom events, that projections handle event store unavailability gracefully, and that the system degrades to local-only operation when cloud connectivity drops.

**ArchUnit for modular monolith contract enforcement** is low-effort and immediately valuable. Standard rules verify that domain packages have no dependencies on infrastructure, that modules communicate only via domain events (not by importing each other's internal classes), and that aggregates never call external services directly. Spring Modulith can layer on top with `@ApplicationModuleTest` for integration tests that bootstrap only one module at a time — a major performance optimization over OpenHAB's approach of spinning up the entire OSGi container.

**Deterministic time via Clock injection** goes beyond simple mocking. Production code accepts `java.time.Clock` via constructor injection; tests use `Clock.fixed()` or a `MutableClock` library (`io.github.robfletcher:test-clock`) that supports `advanceBy(Duration)`. This must extend to scheduled executors — wrap `ScheduledExecutorService` to use the injected Clock — and to all timeout handling. Axon's `StubScheduler` demonstrates the pattern: time stops at fixture creation, advances only when tests explicitly request it, and all events receive timestamps from the fixture's clock rather than system time.

---

## Conclusion: the testing gaps that define HomeSynapse's opportunity

The competitive landscape reveals three structural advantages HomeSynapse can exploit through testing. First, **event sourcing makes the system inherently more testable** — every state is a pure function of events, enabling given/when/then testing without databases or mocks, property-based invariant verification, and deterministic replay for reproduction of any bug. Neither Home Assistant's mutable state machine nor OpenHAB's OSGi service registry offers this.

Second, **no smart home platform tests on constrained hardware systematically**. HA's Pi 5 memory leak and OpenHAB's locale-dependent failures demonstrate that "works on developer machines" is not "works on a Raspberry Pi." A three-tier CI pipeline with real Pi hardware in the loop is a genuine differentiator.

Third, the most damaging production bugs in both platforms stem from **race conditions in event processing and state management** — template sensors evaluating out of order, calendar events creating incorrect state, automations executing non-deterministically. Event sourcing with explicit ordering guarantees, tested via property-based methods and chaos engineering, directly addresses the root cause.

The concrete implementation priority should be: Axon-style given/when/then fixtures first (immediate test coverage of core domain), ArchUnit boundary enforcement second (prevents architectural decay from day one), Clock injection third (essential for automation testing), Testcontainers for event store integration tests fourth, jqwik property-based testing fifth (the novel differentiator), Toxiproxy chaos testing sixth, and PIT mutation testing and JMH benchmarks as ongoing quality gates. This ordering delivers the highest testing value earliest while building toward a test suite that can demonstrably prove HomeSynapse's architectural claims — not just assert them.