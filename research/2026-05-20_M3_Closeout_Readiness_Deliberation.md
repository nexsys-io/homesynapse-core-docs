# M3 Closeout Readiness Deliberation

**Date:** 2026-05-20
**Codebase HEAD:** adf04d2 (M3.4b)
**M3.6a status:** In-flight (not yet merged)
**Session type:** Architectural deliberation — zero code output
**Author:** Claude PM (Cowork session)

---

## Part 1 — M3.6d Composition-Root Readiness

### Q1.1 Bootstrap Sequence Feasibility

The design doc §6.3 specifies a 12-step `start()` sequence. I verified every subsystem constructor against source.

**SqlitePersistenceLifecycle** — `core/persistence/.../SqlitePersistenceLifecycle.java:125-133`. Public 5-arg constructor: `(Path databasePath, PersistenceConfig config, Clock clock, HomeId homeId, List<Class<? extends DomainEvent>> eventClasses)`. This matches the design doc §6.3 step 1. The class is `final` with package-private visibility (line 65). **Issue:** Because the class itself is package-private, `HomeSynapseCore` (in `com.homesynapse.lifecycle`) cannot construct it by type from outside the `com.homesynapse.persistence` package. The persistence module's `module-info.java` exports `com.homesynapse.persistence`, which makes public types visible — but `SqlitePersistenceLifecycle` is package-private. The composition root must construct it through the public `PersistenceLifecycle` interface's factory or accessor. **This is the #1 feasibility concern.** The design doc does not address how `HomeSynapseCore` obtains a `SqlitePersistenceLifecycle` instance from outside the persistence package. Options: (a) promote the class to public, (b) add a factory method on `PersistenceLifecycle` or a new `PersistenceFactory` type, (c) use a package-private bootstrap helper inside persistence that returns the lifecycle as the `PersistenceLifecycle` interface type. Option (c) is most aligned with existing patterns — the lifecycle module only needs the `PersistenceLifecycle` interface contract, not the concrete type.

**InProcessEventBus** — `core/event-bus/.../InProcessEventBus.java:87-122`. Two constructors: 4-arg convenience `(EventStore, CheckpointStore, Clock, SubscriberReadConnectionFactory)` and 6-arg production `(EventStore, CheckpointStore, Clock, SubscriberReadConnectionFactory, BusMetrics, IntSupplier)`. Both are package-private. The class itself is `final` and package-private (line 52). **The design doc §6.3 step 3 specifies a 7-arg constructor accepting `EventBusConfig` — this does not exist.** M3.6b creates `EventBusConfig` as a new record and extends the `InProcessEventBus` constructor to accept it. Until M3.6b lands, the composition root cannot parameterize the bus. **Same visibility concern:** `InProcessEventBus` is package-private, so `HomeSynapseCore` cannot construct it directly. The `EventBus` interface is public, but there is no public factory. Resolution: the M3.6d coding instruction must either (a) promote `InProcessEventBus` to public, or (b) create a public factory in `com.homesynapse.event.bus`.

**StateProjection** — `core/state-store/.../StateProjection.java:208-226`. Public factory `create()` with 11 parameters: `(ProjectionId, int projectionVersion, ViewCheckpointStore, StateCheckpointSource, StateStore, DerivationRule, EventPublisher, ProjectionAdvancer, CheckpointPolicy, Clock, DerivedPublishGate)`. The factory creates a `SelfProducedFilter` internally. The class is `public final` and implements `Subscriber`. Registration is external — the composition root must call `bus.subscribeRuntime(subscriberInfo, projection)`. **All 11 parameters are available at the composition root's construction point** after steps 1-6 complete, assuming the visibility issues above are resolved.

**DerivedWriteRateLimit** — `core/event-bus/.../DerivedWriteRateLimit.java:79-100`. Public constructors: 3-arg `(Clock, BusMetrics, String)` and 4-arg `(int capacity, Clock, BusMetrics, String)`. Does NOT require a bus reference. **No visibility issue** — the class was promoted to `public` in Bus-Fix Piece A (2026-05-18).

**QueueSaturationHealthCheck** — `core/event-bus/.../QueueSaturationHealthCheck.java:90-112`. 6-arg constructor: `(IntSupplier, Clock, int warnDepth, int criticalDepth, int saturationTicks, Consumer<HealthSignal>)`. **Package-private class.** The composition root needs visibility. Resolution: promote to public, or create a factory.

**PersistentDlqWriter** — `core/event-bus/.../PersistentDlqWriter.java:46`. Confirmed `@FunctionalInterface` with `park(DeadLetter)`. Public. The adapter pattern (`store::park` method reference) is straightforward.

**DerivedPublishGate** — `core/state-store/.../DerivedPublishGate.java:48`. Confirmed `@FunctionalInterface` with `acquire() throws InterruptedException`. Public. Static factory `unbounded()` for no-op. The adapter `rateLimit::acquire` satisfies this interface.

**StateCheckpointSource** — `core/state-store/.../StateCheckpointSource.java:59`. Public interface with two methods: `byte[] serializeCheckpoint(int projectionVersion)` and `int loadedProjectionVersion()`. Static factory `stub()` for tests.

**Feasibility summary:** The bootstrap sequence is logically sound — all parameters are available in dependency order. The **blocking concern** is visibility: `SqlitePersistenceLifecycle`, `InProcessEventBus`, and `QueueSaturationHealthCheck` are all package-private. The M3.6d coding instruction must specify a visibility strategy. The cleanest approach is to promote these three classes to `public` (they already implement public interfaces) or create public factory types in each module. This is a design decision the PM must resolve before M3.6d issues.

### Q1.2 SqliteStateStore Visibility Promotion

**Current state** (`core/persistence/.../SqliteStateStore.java`):
- Class declaration (line 78): `final class SqliteStateStore implements StateStore` — package-private.
- `serialize(int projectionVersion)` (line 174): package-private visibility.
- `loadedProjectionVersion()` (line 191): package-private visibility.
- Does NOT currently implement `StateCheckpointSource`.

**StateCheckpointSource requires:** `serializeCheckpoint(int projectionVersion) → byte[]` and `loadedProjectionVersion() → int`. The existing `serialize(int)` returns `byte[]` and the existing `loadedProjectionVersion()` returns `int` — signatures are compatible.

**Type-compatibility analysis:** No checked exceptions on either method. No generics involved. The return types match exactly. The only rename needed is `serialize` → `serializeCheckpoint` to match the interface method name, OR rename the interface method to match (the interface was designed with this promotion in mind — the Javadoc on `StateCheckpointSource` explicitly documents the planned promotion).

**Module visibility:** The persistence module's `module-info.java` already exports `com.homesynapse.persistence`. It also `requires com.homesynapse.state` (the module containing `StateCheckpointSource`). So `SqliteStateStore` can `implements StateCheckpointSource` without any new module-info changes.

**However:** `SqliteStateStore` itself is package-private. After adding `implements StateCheckpointSource`, it can implement the public interface — but external code cannot reference `SqliteStateStore` by type. The composition root would hold it as `StateCheckpointSource` (the interface type). This is fine for the composition root's needs — it passes the `StateCheckpointSource` reference into `StateProjection.create()`. No need to promote `SqliteStateStore` to public for this purpose alone. The composition root needs only the interface type, not the concrete type.

**Risk assessment:** Low. The promotion is straightforward. The method rename (`serialize` → `serializeCheckpoint` if needed) is the only potential friction point.

### Q1.3 SharedScheduler Design

**`refill()` blocking analysis** (`DerivedWriteRateLimit.java:155`): Acquires a `ReentrantLock`, performs atomic integer arithmetic, releases `Semaphore` permits. No I/O, no blocking waits beyond the lock acquisition itself. Effectively non-blocking — the only contention is with `acquire()` calls from subscriber virtual threads, which is bounded (single subscriber per rate limiter).

**`tick()` blocking analysis** (`QueueSaturationHealthCheck.java:122-176`): Reads an `IntSupplier`, performs integer comparisons, calls `clock.instant()`, invokes `emitter.accept()`. No locks, no I/O in the method body. Whether `emitter.accept()` blocks depends on the `Consumer<HealthSignal>` implementation — the composition root must supply a non-blocking consumer (e.g., a JFR event emitter or a lock-free queue append).

**ScheduledExecutorService semantics:** `scheduleAtFixedRate` queues the next execution if the prior overruns — it does not skip ticks. `scheduleWithFixedDelay` waits a fixed delay after the prior completes. The design doc does not specify which variant is used. Recommendation: use `scheduleAtFixedRate` for `refill()` (50 ms cadence, must not drift) and `scheduleAtFixedRate` for `tick()` (1 s cadence, minor queuing is acceptable).

**Single thread vs. two threads:** A single thread is sufficient because both tasks are sub-millisecond under normal conditions. If `refill()` takes 0.1 ms and `tick()` takes 0.1 ms, the scheduler has 49.8 ms of idle time per 50 ms cycle. Splitting to 2 threads provides fault isolation (a pathological `tick()` cannot delay `refill()`) at a cost of one additional platform thread. On Pi 4 with 4 cores, this is a meaningful cost.

**Recommendation:** Start with a single thread. The M3.6d coding instruction should include a STOP-on-Mismatch gate: if SharedSchedulerTest shows `refill()` execution time exceeding 5 ms under any test scenario, escalate for thread-split decision. The 5 ms threshold provides 90% margin on the 50 ms tick.

### Q1.4 ReadinessSource Placement

**ReadinessSource does not exist yet** — it will be created by M3.6d per the design doc §6.2.

**Proposed placement:** `core/state-store` (package `com.homesynapse.state`).

**Dependency analysis:** `ReadinessSource` has a single method `SubscriberMode mode()`. `SubscriberMode` is defined in `core/event-bus` (package `com.homesynapse.event.bus`). The question is: does `core/state-store` already depend on `core/event-bus`?

**Answer: Yes.** `core/state-store/src/main/java/module-info.java` already contains `requires transitive com.homesynapse.event.bus` (line 13). This was added for M3.5a because `StateProjection` implements `Subscriber` and exposes `SubscriberMode` on its public API. Therefore, placing `ReadinessSource` in `core/state-store` introduces **zero new coupling** — the dependency already exists.

**Why not `core/event-bus`?** The alternative (defining `ReadinessSource` in `core/event-bus`) would mean the event-bus module defines a type that only the state-store and lifecycle modules consume. `ReadinessSource` is conceptually a state-store concern — it answers "is the state view ready?" The state-store placement is semantically correct and dependency-clean.

**Assessment:** The design doc's placement in `core/state-store` is correct. No concerns.

### Q1.5 HomeSynapseCore.stateQueryService() Returning Null

**The design doc §6.3 step 11 specifies:** `stateQueryService()` returns `null` until M3.6e wires the real service.

**Risk assessment:**
- **How many M3.6d tests reference this accessor?** Based on the test file list in §6.2, `HomeSynapseCoreTest.java` includes "accessors return non-null after `start()`". This test will FAIL with the null return — it expects non-null. The test must either (a) exempt `stateQueryService()` from the non-null assertion, or (b) the accessor must return a stub.
- **Codebase convention:** The codebase uses `Objects.requireNonNull` pervasively and avoids null returns on public accessors. A null return is a genuine code smell.

**Better pattern:** Return a stub `StateQueryService` that throws `IllegalStateException("StateQueryService not yet wired — available after M3.6e")` on every method call. This is self-documenting, fail-fast, and avoids null-check pollution. The stub can be an anonymous class or a package-private `UnwiredStateQueryService`. M3.6e replaces it with `MaterializedStateQueryService`.

**Does §6.4 G4 mitigate?** G4 says: "No public API exposes a `null` `stateQueryService()` accessor without warning — Javadoc on the accessor states 'returns null until M3.6e lands.'" This is documentation mitigation, not structural mitigation. The stub pattern is strictly better — it turns a runtime NPE into a clear `IllegalStateException` with a message pointing to M3.6e.

**Recommendation:** The M3.6d coding instruction should specify a `ThrowingStateQueryService` stub instead of null. Cost: ~15 lines. Benefit: eliminates null-check obligation on every caller.

---

## Part 2 — M3.6e REST Endpoint Feasibility

### Q2.1 REST API Module Current State

**RestApiServer** (`api/rest-api/.../RestApiServer.java`): Interface only — 5 methods (`registerRoute`, `start`, `stop`, `isRunning`, `port`). No production implementation. Javadoc states: "Phase 2 defines this interface; Phase 3 implements it against the chosen library."

**HTTP server library:** Javalin 6.7.0 is declared in the version catalog and referenced in `api/rest-api/build.gradle.kts` (line 14: `implementation(libs.javalin)`). No Javalin imports exist in any Java source — the dependency is declared but unused.

**No HTTP server is wired anywhere in the codebase today.** There is no `RestApiServer` implementation, no Javalin configuration class, no route registration code.

**Impact on M3.6e:** M3.6e must create the Javalin-based `RestApiServer` implementation, wire route registration for the three state-query endpoints plus the readiness filter, and create the `QueryEndpointIT` tests that make real HTTP calls. This is a significant scope expansion beyond what "implement `MaterializedStateQueryService`" implies. The HTTP server plumbing is prerequisite work that is silently included in M3.6e.

**Impact on M3.7:** `IngressToQueryE2EIT` and `SoakE2EIT` require a live HTTP server. Since M3.6e creates the server, M3.7 depends on M3.6e — which is already on the critical path.

### Q2.2 EndpointHandler Pattern

**EndpointHandler** (`api/rest-api/.../EndpointHandler.java`): `@FunctionalInterface` with `ApiResponse handle(ApiRequest request) throws ApiException`. The contract specifies that pre-processing (auth, rate limiting, param parsing, correlation ID) is done before the handler runs. The handler focuses on business logic only.

**M3.6e creates the first handlers.** There is no existing pattern to follow — M3.6e establishes the pattern. This is both a risk (no precedent) and an opportunity (clean design).

**ReadinessFilter:** No `Filter` or `Middleware` type exists in the rest-api module beyond `AuthMiddleware`. The `ReadinessFilter` is not an `EndpointHandler` — it's a cross-cutting concern that runs before endpoint dispatch. Options:
- (a) Implement as a Javalin `before` handler (framework-specific, but natural for Javalin).
- (b) Create a new `RequestFilter` functional interface in `api/rest-api` and compose it with `EndpointHandler`.
- (c) Wrap each endpoint handler with a readiness-checking decorator.

Option (a) is the pragmatic choice for M3.6e. Option (b) is more architecturally clean but adds a type that no other filter currently needs. The M3.6e coding instruction should specify (a) with a note that if more filters emerge (auth filter, rate limit filter), the pattern should be extracted to (b).

### Q2.3 ArchUnit Rule QUERY_SERVICE_READ_ONLY

**Current ArchUnit rules:** 7 rules in `HomeSynapseArchRules.java` (at `app/homesynapse-app/src/test/java/com/homesynapse/app/HomeSynapseArchRules.java`), wired via `@ArchTest` fields in `HomeSynapseArchRulesTest.java`.

**Existing infrastructure:** The rules use ArchUnit's `ArchRule` fluent API (`classes().that()...should()...`). The pattern `noClasses().that().resideInAPackage("com.homesynapse.state").should().accessClassesThat().resideInAPackage("com.homesynapse.persistence")` is straightforward with ArchUnit. The specific rule — `MaterializedStateQueryService` must not import write-path symbols (`EventBus`, `EventPublisher`, `SqliteEventStore.append*`) — is expressible as a targeted class-level assertion.

**Assessment:** Straightforward to implement. No new infrastructure needed. The rule adds ~10-15 lines to `HomeSynapseArchRules.java`.

### Q2.4 The 100-id Cap on GET /state?entityIds=...

**PLAN-M3 §13.7 specifies:** 100-id cap, 400 Bad Request beyond. "Streaming is over-engineering for MVP given 3000-entity total scale."

**Entity count for a 60-device home:** Entities ≠ devices. A typical device (e.g., a multi-sensor) produces 3-5 entities (temperature, humidity, motion, battery, tamper). A smart plug produces 2 (switch, power). A thermostat produces 4-6. For 60 devices at ~3 entities/device average, the estimate is ~180 entities. A complex home with multi-zone HVAC and multi-sensor nodes could reach 300-400 entities.

**Is 100 the right cap?** For a "get all entities in room X" dashboard query, a single room might have 10-30 entities. 100 is generous for room-level queries. For a "get all entities" request, the caller should use `GET /snapshot` instead. The 100-id cap on the batch endpoint is a reasonable anti-abuse measure.

**Should it be configurable?** For MVP, hardcoded is fine. The cap protects against accidental or malicious large requests. Configuration can be added when the first real operator asks for it.

**Assessment:** 100 is appropriate. Hardcoded for MVP.

---

## Part 3 — M3.7 E2E Test Feasibility

### Q3.1 HTTP Server Bootstrap Dependency

**Confirmed:** M3.6e must fully land before M3.7 can begin. Two of five M3.7 tests (`IngressToQueryE2EIT`, `SoakE2EIT`) require live HTTP endpoints.

**Does the design doc §6 specify REST server wiring in `HomeSynapseCore.start()`?** No — the composition root design (§6.3) stops at step 12 without wiring the REST API server. The REST server is a separate lifecycle concern. The design doc §7 (M3.6e) specifies that M3.6e modifies `HomeSynapseCore` to wire the real `MaterializedStateQueryService`, but does not explicitly mention REST server startup.

**Gap:** Neither M3.6d nor M3.6e's design doc sections specify who starts the REST API server. `RestApiLifecycle.start()` exists as an interface, but nothing calls it. The M3.6e coding instruction must include: (a) create a Javalin-based `RestApiServer` implementation, (b) wire it into `HomeSynapseCore` or create a parallel `RestApiBootstrap` that composes with `HomeSynapseCore`, (c) register the three query endpoints + readiness filter.

**Fallback if HTTP is not wired:** M3.7 tests could call `MaterializedStateQueryService` directly (in-process) instead of via HTTP. This weakens the E2E value — the test no longer exercises the HTTP parsing, error handling, and 503 filter. For `IngressToQueryE2EIT`, the value proposition is specifically the HTTP round-trip. Direct calls would make it "IngressToQueryIT" (integration, not end-to-end).

**Recommendation:** The M3.6e scope MUST include HTTP server wiring. The coding instruction must be explicit about this.

### Q3.2 HTTP Ingress Endpoint

**No raw event-publish endpoint exists.** The rest-api module defines `CommandRequest.java` documenting `POST /api/v1/entities/{entity_id}/commands` — a command endpoint, not a raw event POST.

**PLAN-M3 §11.5 says:** "Publish a device_observed event via HTTP POST (the project's existing ingress endpoint)." This references an endpoint that does not exist.

**Resolution options:**
- (a) M3.6e creates a minimal `POST /api/v1/events` endpoint for test ingestion (scope expansion).
- (b) M3.7's `IngressToQueryE2EIT` uses `EventPublisher.publish()` directly (bypassing HTTP for the write path, HTTP only for the read path). The test becomes "PublishToQueryE2EIT" — less E2E, but avoids creating a non-production endpoint.
- (c) Use the command endpoint `POST /api/v1/entities/{id}/commands` as the ingress path. But this requires the full command lifecycle pipeline (command → dispatch → event), which is M4+ scope.

**Recommendation:** Option (b) is the pragmatic choice for M3. The write path (event persistence + bus notification) is already thoroughly tested by M3.4a/M3.4b integration tests. The E2E value of M3.7 is proving the read path works end-to-end: event → projection → state store → REST query → HTTP response. Using `EventPublisher.publish()` for injection still exercises the full read pipeline.

### Q3.3 AdminReplayE2EIT Prerequisites

**Admin endpoints are part of M3.5b scope** (PLAN-M3 §9.3):
- `DlqAdminEndpoint.java` — `POST /admin/dlq/replay` (§9.6)
- `ProjectionRebuildEndpoint.java` — `POST /admin/projection/{id}/rebuild` (§9.7)
- `ProjectionStatusEndpoint.java` — `GET /admin/projection/{id}/status`

**These do NOT exist in the codebase today.** M3.5b landed the persistence-layer and bus-layer DLQ wiring but NOT the REST admin endpoints. This is a significant gap.

**When do they ship?** They cannot ship with M3.6a-M3.6d (those WUs are fully specified and scoped). They could:
- (a) Ship as part of M3.6e (scope expansion — M3.6e already creates the HTTP server).
- (b) Ship as a new M3.5c WU before M3.6e.
- (c) Ship as part of M3.7 itself (the tests create the endpoints they test).

**Recommendation:** Option (a) is cleanest — M3.6e already builds the HTTP server and registers endpoints. Adding 3 admin endpoints to M3.6e increases its scope by ~2-3 hours but avoids creating a new WU. This requires Nick's approval for scope expansion.

**Impact if deferred:** `AdminReplayE2EIT` and `RebuildE2EIT` (2 of 5 M3.7 tests) cannot execute without these endpoints. The M3 exit gate (§14.2) requires all M3.7 tests GREEN.

### Q3.4 SoakE2EIT Practical Constraints

**Hardware:** The test runs on `hs-dev-1` (Pi 5 with NVMe). Tagged `@Tag("soak")` — manual-only, not CI.

**HTTP requirement:** The soak test must exercise the full stack including HTTP queries to verify no connection leaks over 24 hours. In-process calls would miss HTTP-layer resource leaks (socket exhaustion, Javalin thread pool growth).

**Disk budget:** 50 ev/s × 86,400 s × ~600 bytes/event ≈ 2.59 GB. The 256 GB NVMe has ample headroom. The retention policy (DIAGNOSTIC 7d, NORMAL 90d) is irrelevant for a 24-hour test since nothing expires within the test window. WAL size is the real constraint — the §11 spec asserts WAL ≤ 200 MB. The bounded-window reader pattern (AMD-38) should keep WAL bounded, but this is exactly what the soak test validates.

**Assessment:** No concerns. The soak test is feasible on the specified hardware.

### Q3.5 M3.7 Test Count and CI Time

**MultiSubscriberE2EIT:** 10,000 events over 100 seconds, plus startup/teardown. Under Pi-profile throttle, estimate ~120 seconds total.

**RebuildE2EIT:** 1,000 events, rebuild, poll until LIVE. The rebuild re-processes 1,000 events; at Pi-profile throughput (~800 ev/s sustained from M3.4a data), this takes ~2 seconds for replay + overhead. Estimate ~15-20 seconds total.

**IngressToQueryE2EIT:** Publish 2-3 events, poll for state. Estimate ~10-15 seconds.

**AdminReplayE2EIT:** Inject poison, exhaust retries (fast-forwarded clock), replay. Estimate ~15-20 seconds.

**Total non-soak CI time:** ~170-180 seconds (~3 minutes). Acceptable.

**Tagging recommendation:** The soak test is already `@Tag("soak")`. The other four should run in default `./gradlew check` (they complete in under 3 minutes). If PI-profile throttle makes them slower, they should be tagged `@Tag("e2e")` and run via `-PincludeTags=e2e` in the full validation script. The `pi4-validation.sh` script should include them.

---

## Part 4 — M3 Exit Gate Completeness

### Q4.1 Contract Test Suite Completeness

**`:core:state-store:check`** — PLAN-M3 §14.1 requires 6 test suites:

| Test Suite | Exists Today? | Created By |
|---|---|---|
| `ProjectionAdvancerContractTest` | YES (testFixtures, abstract) | M3.5a |
| `SubscriberContractTest` | YES (testFixtures, abstract) | M3.5a |
| `StateProjectionContractTest` | YES (testFixtures, extends SubscriberContractTest) | M3.5a |
| `ReconciliationContractTest` | **NO** | Must be created — likely M3.6d or M3.6e |
| `ProjectionRebuildContractTest` | **NO** | Must be created — likely M3.6e |
| `MaterializedStateQueryServiceTest` | **NO** | M3.6e scope (PLAN-M3 §10.7) |

**`:core:event-bus:check`** — `EventBusContractTest` exists with M3.1/M3.2/M3.3 methods. One `@Disabled` annotation remains (see Q4.2). `DlqContractTest` is required by §14.1 — **status: not verified (needs search)**.

**`:core:persistence:check`** — `SqliteDeadLetterStoreContractTest` EXISTS. `MigrationRunnerTest` EXISTS. `SqliteStateStore` integration tests exist via `StateProjectionContractTest`'s concrete subclass.

**`:api:rest-api:check`** — No tests exist today. All tests are M3.6e/M3.5b scope: `DlqAdminEndpointTest`, `ProjectionRebuildEndpointTest`, `QueryEndpointIT`.

**Gap summary:** 3 missing state-store test suites (created by M3.6d/M3.6e), all rest-api tests (created by M3.6e + admin endpoint work), and 1 `@Disabled` annotation to resolve.

### Q4.2 @Disabled Test Cleanup

**Only one `@Disabled` annotation exists in the entire codebase:**
- `EventBusContractTest.java:1466` — `@Disabled("M3.5a") void reconciliationOnVersionMismatch()`

PLAN-M3 §14.7 requires: `grep -r '@Disabled.*M3' --include='*.java'` returns no results. The tag is `"M3.5a"` which matches the `M3` pattern. This test must be un-disabled before the exit gate passes.

The test depends on reconciliation behavior (projection version mismatch triggering a clear-and-replay). `ReconciliationContractTest` (Q4.1) must be created, and this specific test in `EventBusContractTest` must be enabled and passing. The reconciliation path exists in `StateProjection` (M3.5a) — the test body is currently empty and needs to be implemented.

### Q4.3 Pi 4 On-Device Validation

`Pi4SustainedLoadIT.java` exists at `testing/integration-tests/src/test/java/com/homesynapse/it/Pi4SustainedLoadIT.java`. `scripts/pi4-validation.sh` exists. Neither has been executed on `hs-dev-1` per the task brief.

**This is a manual step that Nick must perform after M3.7 lands.** It is not on the critical path for coding work but is a gate for the M3 exit sign-off (§14.3).

### Q4.4 Missing ArchUnit Rules

**Currently implemented:** 7 rules in `HomeSynapseArchRules.java`.

**PLAN-M3 §14.8 requires these additional rules** (0 of 6 exist today):

| Rule | Specified In | Ships With |
|---|---|---|
| `PROJECTION_NO_WRITE_BATCHER_THREAD` | AMD-41 | Unclear — not assigned to any WU |
| `EVENT_PUBLISHER_HAS_NO_DEPTH_GATED_LOCK` | AMD-43 | Unclear — not assigned to any WU |
| `BUS_METRICS_NOT_DIRECT_INSTANTIATION` | M3.3 | Should have shipped with M3.3 — gap |
| `QUERY_SERVICE_READ_ONLY` | M3.6 (§10.8) | M3.6e |
| `ADMIN_ENDPOINTS_REQUIRE_AUTH_ANNOTATION` | M3.5b (§9.3) | M3.5b (missed) or M3.6e |
| `EVENT_BUS_DOES_NOT_IMPORT_SQLITE_DRIVER` | §15 table | Unclear |

**Gap:** 3 rules should already exist (from M3.3 and M3.5b) but were not created. 1 rule ships with M3.6e. 2 rules have no clear WU assignment.

**Recommendation:** Bundle the missing ArchUnit rules into M3.6e (they are small — each is ~10-15 lines). Alternatively, create a focused M3.6f "arch-rule sweep" WU. The total effort is ~1-2 hours.

### Q4.5 bus.resume() Limitation

**Current `resume()` implementation** (`InProcessEventBus.java:286-305`): Transitions the FSM from SUSPENDED → REPLAY, clears the crash window and DLQ, but does NOT re-spawn the virtual thread. The original VT (started in `subscribeRuntime()`) has already exited when the subscriber entered SUSPENDED — the `subscriberLoop()` returns when the circuit breaker trips, terminating the VT. After `resume()` sets mode to REPLAY, there is no thread driving the REPLAY/TRANSITION/LIVE phases.

**Is Tier 9 in M3 scope?** The disabled test `reconciliationOnVersionMismatch` is tagged `"M3.5a"`, which falls under M3 scope. PLAN-M3 §14.7 requires zero M3-tagged `@Disabled` tests. Therefore: **yes, Tier 9 reconciliation is in M3 scope, and the `bus.resume()` limitation is a blocking bug for the M3 exit gate.**

However, the disabled test is specifically about reconciliation (projection version mismatch), not about `resume()` after circuit-breaker suspension. The reconciliation path in `StateProjection` (M3.5a) handles version mismatch by clearing state and re-replaying from position 0 — this happens within the existing VT's lifecycle (the projection is already subscribed and its VT is running). Reconciliation does NOT require `bus.resume()`. The `@Disabled` tag references M3.5a, meaning the test was deferred until `StateProjection` was fully wired.

**Assessment:** The `bus.resume()` VT re-spawn limitation is a real bug, but it does NOT block the M3 exit gate — because the M3-scoped disabled test (`reconciliationOnVersionMismatch`) tests reconciliation within an active subscription, not resume-after-suspension. The `resume()` VT limitation should be logged as a tracked item for M4 (when integration adapters will need crash-and-resume semantics) but is not a M3 blocker.

**What must happen to un-disable the test:** Implement the test body in `EventBusContractTest` that exercises `StateProjection`'s reconciliation pass (clear state + re-replay when persisted checkpoint's `projectionVersion` mismatches the running code's version). This is feasible within M3.6d or M3.6e scope because `StateProjection` already implements reconciliation logic.

---

## Part 5 — Alignment with Project Vision

### Q5.1 Explainability Thesis

MVP Battlefield #3: "A non-developer user can answer 'why did the porch light turn on at 3am?' by looking at the event trace in the UI."

**M3 delivers:** `StateQueryService.getState()` — current state of any entity. After M3, the system can answer "what is the current state of entity X?" and "what is the state of all entities?"

**M3 does NOT deliver:** Causal chain queries. The causal metadata exists on every event (`CausalContext` record with `correlationId` and `causationId` fields, confirmed in `core/event-model/.../CausalContext.java:47`). A `TraceQueryService` interface exists in `observability/observability` with 5 query methods (`getChain`, `findRecentChain`, `findChains`, `findChainsByType`, `findChainsByTimeRange`) — but this is a Phase 2 interface with no implementation.

**Gap analysis:** The explainability query path ("why did the porch light turn on?") requires: (1) a `TraceQueryService` implementation that reads the event log filtering by `correlation_id`, (2) a REST endpoint exposing the trace chain, (3) a UI component that renders the causal chain. Items (1) and (2) are post-M3 (likely M5 or M6 per the trace/observability subsystem). Item (3) is Web UI scope.

**Is this acceptable?** Yes. M3's role is foundational: events carry causal IDs, the event store persists them, and the event log is query-able. The causal query is a separate subsystem built on top of the event log — it does not modify the event store or the bus. M3 delivers "what is the state now?" and the foundation for "why is it this way?" The user-facing "why?" answer is architecturally correct as a separate milestone.

### Q5.2 Event Sourcing Integrity Through the Composition Root

**Write-ahead guarantee (INV-ES-04):** Events are persisted before subscribers are notified. The composition root wires `WriteCoordinator` (single platform thread `hs-write-0`) which appends to SQLite, then calls `eventBus.notifyEvent(globalPosition)`. The bus's `notifyEvent` method samples queue depth, emits metrics, and routes to subscriber queues/VTs. The write-ahead guarantee is preserved because `notifyEvent` is called AFTER the `WriteCoordinator` completes the SQLite transaction. The composition root does not alter this ordering — it wires the same `WriteCoordinator` → `EventBus` notification chain that exists today.

**Single-writer invariant (INV-WRITER-01):** `WriteCoordinator` is an interface with one production implementation (`PlatformThreadWriteCoordinator`), constructed in exactly one place: `DatabaseExecutor.java:250-251`. The composition root receives the `WriteCoordinator` through `SqlitePersistenceLifecycle` — it does not construct a second one. Invariant preserved.

**Subscriber isolation (INV-SUB-ISO-01..06):** Each subscriber gets its own VT (`hs-sub-{id}`), `SubscriberReadExecutor` (dedicated platform thread + SQLite connection), `SubscriberDlq`, `SubscriberMode` reference, `ReplayWindowQueue`, and `SelfProducedFilter`. The composition root calls `bus.subscribeRuntime(info, subscriber)` for the projection, which triggers the per-subscriber resource allocation inside `InProcessEventBus`. The composition root does not bypass this allocation — it uses the standard registration path. Isolation preserved.

### Q5.3 Local-First Operation

**After M3, can HomeSynapse start, process events, and serve REST queries with zero internet connectivity?**

**DNS resolution:** No production Java source makes DNS lookups. The one URL found (`SqlitePersistenceLifecycle.java:435`) is in a log warning string ("https://homesynapse.com/docs/storage for recommended configurations") — no network call is made.

**Clock synchronization:** The codebase uses injected `Clock` everywhere. `Clock.systemUTC()` is allowed only in `com.homesynapse.{app,platform,test}` packages (enforced by the `NO_DIRECT_TIME_ACCESS` ArchUnit rule). If NTP fails, the system clock is stale but the application continues — events are timestamped with whatever `clock.instant()` returns. There is no NTP-dependent initialization gate.

**External URLs:** Zero hardcoded external service calls. SQLite is local. JFR events are local. SLF4J logs to local appenders.

**Assessment:** Full local-first operation. Zero internet dependencies. This is a core architectural property, not an accident — the design documents explicitly require it.

### Q5.4 Performance on Constrained Hardware

**SharedScheduler overhead:** One additional platform thread (`hs-sched-0`) running two sub-millisecond tasks. Negligible CPU overhead. The thread is a daemon with no I/O — it consumes zero resources when idle (parked by the ScheduledExecutorService).

**REST API server threads:** Javalin 6.x uses Jetty under the hood. Default Jetty configuration creates a thread pool (typically min 8, max 200 for platform threads). On Pi 4 with 4 cores, this is excessive. The M3.6e coding instruction should configure Javalin's thread pool to a constrained size (e.g., min 2, max 8 platform threads, plus virtual thread handler dispatch per LTD-01).

**Total platform thread count after M3.6:**

| Thread | Count | Purpose |
|---|---|---|
| `hs-write-0` | 1 | Single SQLite writer |
| `hs-read-0`, `hs-read-1` | 2 (HOME profile) | SQLite reader pool |
| `hs-sched-0` | 1 | SharedScheduler (refill + tick) |
| Javalin/Jetty acceptor | 1 | HTTP accept loop |
| Javalin/Jetty selector | 1-2 | NIO event loop |
| Main thread | 1 | Application bootstrap |
| **Total platform threads** | **7-8** | Plus virtual threads for subscribers + request handlers |

Pi 4 has 4 cores. 7-8 platform threads is within normal operating range — most are parked waiting for I/O. The write thread and read threads are the only CPU-active threads during sustained load. **No oversubscription risk.**

### Q5.5 Crash Isolation

**If `StateProjection` crashes:** The projection runs on a virtual thread. The bus supervisor catches the exception, records it in the DLQ, and may circuit-break the subscriber (5 crashes in 10 minutes → SUSPENDED). The event bus continues operating — other subscribers are unaffected. The `WriteCoordinator` continues accepting writes. The REST API serves stale state (last projected state) with a 503 if the projection enters SUSPENDED mode (via `ReadinessFilter`).

**If the REST API server crashes:** Javalin runs on its own thread pool. A Javalin crash (e.g., unhandled exception in an endpoint) would kill the request-handling threads but not the event processing pipeline. The `WriteCoordinator`, event bus, and state projection continue operating. REST queries fail until the server restarts — but event sourcing integrity is preserved. Note: a catastrophic Javalin crash (JVM-level) would take down the entire process, but that's a JVM concern, not an architecture concern.

**If the write coordinator hangs:** The REST read path is unaffected. `MaterializedStateQueryService` reads from `StateStore` (an in-memory `ConcurrentHashMap`), not from the write coordinator. The state store serves the last-projected state. New events stop flowing (the write queue backs up), the bus's `QueueSaturationHealthCheck` fires WARN → CRITICAL signals, and the REST API continues serving stale-but-valid state. This is the correct degradation behavior — reads and writes are on independent paths.

**Assessment:** The composition root preserves crash isolation. The design correctly separates write, projection, and query paths onto independent threads/executors.

---

## Part 6 — Risk Register and Remaining Unknowns

### Q6.1 Tracked Items Blocking M3 Exit Gate

The task brief references `HomeSynapse_Current_State.md` — this file was not found at the expected path. The tracked items are sourced from the design doc, PLAN-M3, and the research agents' findings:

| Tracked Item | Status | Resolution |
|---|---|---|
| `bus.resume()` does not re-spawn VT | Pre-existing M3.1 limitation | NOT a M3 blocker — reconciliation (the M3-scoped test) does not require `resume()`. Log for M4. |
| `@Disabled("M3.5a") reconciliationOnVersionMismatch` | Blocking M3 exit gate (§14.7) | Must implement test body and un-disable. Feasible within M3.6d/M3.6e. |
| Admin endpoints (DLQ replay, projection rebuild, projection status) | NOT implemented — M3.5b gap | Must ship before M3.7. Recommend bundling into M3.6e. |
| 6 missing ArchUnit rules | NOT implemented | 3 should already exist (M3.3, M3.5b gaps); 1 ships with M3.6e; 2 unassigned. Bundle into M3.6e. |
| `ReconciliationContractTest` | NOT created | Must be created. M3.6d or M3.6e scope. |
| `ProjectionRebuildContractTest` | NOT created | Must be created. M3.6e scope. |
| `MaterializedStateQueryServiceTest` | NOT created | M3.6e scope (already planned). |
| HTTP server implementation | NOT created | M3.6e scope (implicit prerequisite). |
| HTTP ingress endpoint for M3.7 E2E tests | Does not exist | Recommend using `EventPublisher.publish()` directly in M3.7 tests. |
| Pi 4 on-device validation | NOT performed | Manual step for Nick after M3.7 lands. |
| Soak test execution | NOT performed | Manual 24-hour test for Nick after M3.7 lands. |
| WUCP Phase 2 reconciliation for 5 WUs | STALE (per design doc §0) | Must complete before M3.6a coding instruction issues. |
| Package-private visibility of `SqlitePersistenceLifecycle`, `InProcessEventBus`, `QueueSaturationHealthCheck` | Design concern | Must resolve visibility strategy before M3.6d issues. |

### Q6.2 Governance Artifacts Needed Before M3 Closes

**AMDs:** AMD-44 (`getStatesAtPosition`) is explicitly deferred — no AMD needed now. No other new AMDs identified. The existing AMD-41/42/43 must be marked `Status: APPLIED` per §14.6.

**DEC-M3 entries:** DEC-M3-01 through DEC-M3-15 are the current locked-decisions ledger. No new entries identified — all M3.6 design decisions are traceable to existing DECs. If the visibility promotion (Q1.1) is decided as "promote to public," it should be documented as DEC-M3-16 or as a PM decision in the coding instruction.

**`M3-exit-gate.md`:** Must be created by Nick at sign-off time (§14.9).

### Q6.3 MODULE_CONTEXT Files Created or Modified by M3.6d-M3.7

| Module | Action | Reason |
|---|---|---|
| `lifecycle/lifecycle/MODULE_CONTEXT.md` | POPULATE (currently scaffold) | `HomeSynapseCore`, `HomeSynapseConfig`, `SharedScheduler` |
| `core/state-store/MODULE_CONTEXT.md` | UPDATE | Add `ReadinessSource`, `MaterializedStateQueryService` |
| `core/persistence/MODULE_CONTEXT.md` | UPDATE | `SqliteStateStore` now implements `StateCheckpointSource`, visibility changes |
| `core/event-bus/MODULE_CONTEXT.md` | UPDATE | `EventBusConfig` entry, updated `InProcessEventBus` constructor |
| `core/event-model/MODULE_CONTEXT.md` | UPDATE | `EventTypes` utility class |
| `integration/integration-api/MODULE_CONTEXT.md` | UPDATE | `IntegrationEvents` utility class |
| `api/rest-api/MODULE_CONTEXT.md` | UPDATE | First production types: endpoint handlers, Javalin server impl, ReadinessFilter |
| `testing/integration-tests/MODULE_CONTEXT.md` | UPDATE | M3.7 E2E test classes |

### Q6.4 Realistic Calendar Estimate

| WU | Estimated Hours | Notes |
|---|---|---|
| WUCP Phase 2 reconciliation | 3-4 h | 5 stale WUs, must complete first |
| M3.6a (landing) | 0 h | Already in flight |
| M3.6b (ReplayWindowQueue) | 2-3 h | Including WUCP Phase 2 |
| M3.6c (event-class manifests) | 2 h | Including WUCP Phase 2 |
| M3.6d (composition root) | 7-9 h | Including visibility decisions + WUCP Phase 2 |
| M3.6e (query service + REST + admin endpoints + arch rules) | 9-12 h | Scope larger than originally estimated — HTTP server, admin endpoints, 6 arch rules |
| M3.7 (E2E tests) | 7-9 h | 5 test classes + WUCP Phase 2 |
| Pi 4 validation + soak test | 2 h active + 24 h soak | Manual, Nick's time |
| Exit gate sign-off | 1-2 h | Documentation review + M3-exit-gate.md |

**Total Coder hours:** ~30-39 hours
**At 4-5 focused hours/day:** 6-10 working days
**Calendar estimate:** M3 closes in **~8-12 calendar days** (accounting for iteration, pushback resolution, and Nick's manual validation steps).

**Critical path:** WUCP reconciliation → M3.6a merge → M3.6b → M3.6c → M3.6d → M3.6e → M3.7 → Pi 4 validation → soak → sign-off. Strictly sequential — no parallelism possible.

---

## Summary — Top 5 Risks for M3 Completion

**1. M3.6e scope underestimate (Impact: HIGH, Likelihood: HIGH).** M3.6e must create the HTTP server implementation (Javalin wiring), 3 admin endpoints (M3.5b gap), 6 missing ArchUnit rules, `MaterializedStateQueryService`, `ReadinessFilter`, and 3 query endpoint handlers. The original estimate of 6-8 hours is optimistic; 9-12 hours is realistic. This is the largest single WU remaining and the most likely to slip.

**2. Package-private visibility blocks composition root (Impact: HIGH, Likelihood: CERTAIN).** `SqlitePersistenceLifecycle`, `InProcessEventBus`, and `QueueSaturationHealthCheck` are all package-private. `HomeSynapseCore` cannot construct them from outside their packages. A visibility strategy must be decided before M3.6d issues. This is a design decision, not a coding task — but if it triggers disagreement or cross-module refactoring, it adds risk.

**3. Admin endpoint gap from M3.5b (Impact: MEDIUM, Likelihood: CERTAIN).** Three admin REST endpoints were scoped for M3.5b but not delivered. They block 2 of 5 M3.7 tests and the M3 exit gate. The gap must be closed — either in M3.6e (scope expansion) or a new WU.

**4. Missing ArchUnit rules (Impact: MEDIUM, Likelihood: HIGH).** 6 rules required by §14.8 do not exist. 3 should have shipped with earlier milestones. If these rules expose existing violations when first run, fixing those violations adds unplanned work.

**5. `@Disabled` test + `ReconciliationContractTest` (Impact: MEDIUM, Likelihood: MEDIUM).** The single `@Disabled("M3.5a")` test must be un-disabled, and `ReconciliationContractTest` must be created. The reconciliation logic exists in `StateProjection` but has never been independently tested. Unexpected behavior in the reconciliation path could require design-level fixes.

---

## Recommended Actions Before Proceeding

1. **Decide visibility strategy for package-private subsystem classes (BLOCKING M3.6d).** Options: (a) promote `SqlitePersistenceLifecycle`, `InProcessEventBus`, and `QueueSaturationHealthCheck` to `public`; (b) create public factory types in each module; (c) create a `PersistenceBootstrap`-style helper. PM recommends option (a) — these classes already implement public interfaces, and promoting them to `public` is the simplest change with the least downstream impact. Record as DEC-M3-16 if approved.

2. **Approve M3.6e scope expansion to include admin endpoints + ArchUnit rules.** The 3 M3.5b-gap admin endpoints and 6 missing ArchUnit rules should be bundled into M3.6e. This increases the WU from ~8 hours to ~12 hours but avoids creating new WUs and keeps M3.7 unblocked.

3. **Complete WUCP Phase 2 reconciliation for 5 stale WUs.** This is the hard prerequisite for any M3.6 coding instruction (design doc §0). Schedule a dedicated PM session.

4. **Decide M3.7 ingress strategy.** Recommend using `EventPublisher.publish()` directly in E2E tests (option b from Q3.2), with HTTP exercised only on the read path. This avoids creating a non-production event ingress endpoint.

5. **Decide `stateQueryService()` null vs. stub pattern.** PM recommends a `ThrowingStateQueryService` stub over null return. Cost: ~15 lines. Eliminates null-check obligation.

6. **Schedule Pi 4 on-device validation.** Not on the Coder's critical path, but Nick must plan for it after M3.7 lands. The validation script exists but has never been executed on `hs-dev-1`.
