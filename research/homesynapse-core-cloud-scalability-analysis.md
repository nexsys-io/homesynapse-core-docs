# HomeSynapse Core: Cloud-Readiness & Scalability Deep Dive

**Research artifact — no code changes, no locked decision amendments.**

---

## Executive Summary

After systematically reading every test module, contract suite, persistence implementation, identity model, event envelope, bus interface, and architecture invariant in the `homesynapse-core` repository, the assessment is: **HomeSynapse's architecture is remarkably well-positioned for future cloud and multi-instance services, with five specific areas where current implementation choices could create friction if not addressed before they calcify.**

The architecture was designed with explicit multi-tier awareness (Constrained through Enterprise), the identity model (ULIDs) is globally unique without coordination, the event model (per-entity sequences, causal chains) is inherently replication-friendly, and the invariant framework (INV-LF-02, INV-LF-05, INV-HO-*) actively constrains the design to preserve cloud-extensibility. The five friction points are not architectural flaws — they are implementation-level decisions that are correct for the MVP but would require attention before cloud services ship. None require immediate action; all require awareness.

---

## Part 1: What the Codebase Reveals

### 1.1 The Contract Test Architecture Is Cloud-Compatible by Design

The `EventStoreContractTest` (27 methods), `EventBusContractTest` (18 methods), `WriteCoordinatorContractTest` (11 methods), `ReadExecutorContractTest`, `CheckpointStoreContractTest` (9 methods), and `ViewCheckpointStoreContractTest` all follow the same pattern: abstract factory methods return the implementation under test, and the concrete subclass provides wiring. This is not just good testing — it is the structural prerequisite for alternative storage backends.

The `SqliteEventStoreTest` extends `EventStoreContractTest` and passes all 27 methods against a real SQLite database. A future `PostgresEventStoreTest` or `CloudEventStoreTest` would extend the same contract and inherit the same 27 behavioral assertions. The contract tests validate behavioral equivalence, not implementation identity — meaning a cloud-backed event store that satisfies the same contracts is provably correct by construction.

**Key observation:** The contract tests validate the `EventPublisher` and `EventStore` interfaces defined in `event-model`, not the `SqliteEventStore` class in `persistence`. The interfaces live in `com.homesynapse.event` (Layer 1), while the SQLite implementation lives in `com.homesynapse.persistence` (Layer 4). This means a cloud relay module could implement `EventPublisher` and `EventStore` at the same layer as `persistence` without touching the core event model at all.

### 1.2 The Identity Model Is Already Globally Unique

The `Ulid` record (128-bit, 48-bit timestamp + 80-bit random) with `UlidFactory` provides globally unique identifiers without any coordination. Two HomeSynapse hubs generating events simultaneously will never collide on `eventId`, `correlationId`, or any typed identity (`EntityId`, `DeviceId`, `PersonId`, `AutomationId`, `SystemId`, `IntegrationId`). The Portability Architecture research (§6.4) explicitly notes this as a convergent-sync-compatible property.

The `SubjectRef` record (pairing a `Ulid` with a `SubjectType` discriminator) enables type-aware filtering without requiring a registry lookup. This design is cloud-friendly because a cloud aggregator receiving events from multiple hubs can route and partition events by subject type without understanding the hub-specific entity model.

**What's missing:** There is no `HubId`, `TenantId`, or `InstanceId` concept anywhere in the codebase. The `grep` for these terms returns zero results. The `SubjectType` enum has six values (ENTITY, DEVICE, INTEGRATION, AUTOMATION, SYSTEM, PERSON) but no INSTANCE or HUB. This is not a problem for the MVP — it is single-instance. But when events from multiple hubs arrive at a cloud aggregator, there must be a way to identify the originating hub. This is the most significant gap for cloud readiness.

### 1.3 The EventEnvelope Carries Everything Needed for Replication

The `EventEnvelope` record has 14 fields, and nearly all are replication-safe:

- `eventId` (ULID) — globally unique, no coordination needed
- `eventType` + `schemaVersion` — self-describing, version-aware
- `ingestTime` + `eventTime` — dual timestamps preserved
- `subjectRef` + `subjectSequence` — per-entity ordering
- `globalPosition` — **this is the problematic field** (see §2.2)
- `priority` + `origin` — metadata, replicable as-is
- `categories` — derived from eventType, deterministic
- `causalContext` (correlationId + causationId) — the causal chain uses ULIDs, which are globally unique. Cross-hub causal chains would work if events are replicated
- `actorRef` — nullable ULID, globally unique
- `payload` — the DomainEvent, serialized via Jackson

The `chain_hash` column (declared in V001 schema, bound as NULL) is reserved for the future crypto milestone. This is forward-thinking — the tamper-evident integrity chain (INV-PD-08) will eventually extend to cloud operation verification (Architecture Invariants §16.5 Phase 4).

### 1.4 The Module Boundary Enforcement Is the Primary Cloud Enabler

Seven ArchUnit rules in `HomeSynapseArchRules` enforce structural constraints that directly enable cloud extension:

1. **NO_REVERSE_DEPENDENCIES** — Core modules cannot depend on integration, API, lifecycle, or app layers. A cloud relay module would live at the integration or API layer, meaning it can depend on core interfaces but core code can never depend on it. This is exactly the INV-LF-02 enforcement pattern: "Cloud Enhancement, Never Cloud Dependence."

2. **NO_DIRECT_FILESYSTEM_IN_CORE** — Core modules cannot use `java.io.File` or `java.nio.file.Files`. This means the core event model, device model, state store, automation, and configuration modules are already filesystem-agnostic. Only the persistence module touches the filesystem (via SQLite). A cloud persistence backend would not need to modify any core module.

3. **NO_JSON_TYPE_INFO_IN_EVENTS** — Events use logical type names via the `EventTypeRegistry`, not Java FQCNs. This means event payloads can be deserialized by non-Java consumers (a cloud service in Go, Rust, or Python) using the logical event type as the discriminator.

4. **NO_DIRECT_TIME_ACCESS** — All time-dependent code accepts `Clock` as a parameter. The `TestClock` utility enables deterministic testing. For cloud services, this means time-sensitive logic (staleness, scheduling) can be tested with simulated time regardless of deployment environment.

The `NoRealIoExtension` (a JUnit 5 extension that fails tests attempting non-localhost network I/O) provides an additional safety net: no test accidentally makes a real network call, which means the test suite is portable across environments (local, CI, cloud).

### 1.5 The Persistence Layer Is Cleanly Isolated

The `DatabaseExecutor`, `SqliteEventStore`, `PlatformThreadWriteCoordinator`, and `PlatformThreadReadExecutor` are all **package-private** within `com.homesynapse.persistence`. External modules interact only through the public interfaces: `EventPublisher`, `EventStore`, `CheckpointStore`, `ViewCheckpointStore`. The JPMS `module-info.java` for the persistence module exports only `com.homesynapse.persistence` — the implementation classes are not accessible outside the module.

This means the entire SQLite persistence stack could be replaced with a different backend (PostgreSQL, cloud-backed event store, distributed log) by providing a new module that implements the same public interfaces. The contract test suites would validate behavioral equivalence. This is the most important structural decision for cloud scalability.

### 1.6 The Test Infrastructure Is Deployment-Agnostic

The `test-support` module provides deployment-agnostic test utilities:

- `TestClock` — controllable `Clock` implementation
- `EventCollector` — captures events for assertion
- `SynchronousEventBus` — deterministic event dispatch for testing
- `TestSubscriber` — captures notifications
- `GivenWhenThen` — BDD-style test structure
- Custom AssertJ assertions (`EventEnvelopeAssert`, `CausalContextAssert`, `SubjectRefAssert`)
- `NoRealIoExtension` + `@RealIo` — network isolation

None of these utilities depend on SQLite, the filesystem, or any platform-specific resource. A cloud test suite would use the same utilities.

---

## Part 2: Five Friction Points for Cloud Scaling

### 2.1 No Hub/Instance Identity in the Event Envelope

**Risk level: MEDIUM — must be addressed before multi-hub sync ships, but not before MVP.**

The `EventEnvelope` has no field identifying which HomeSynapse instance produced the event. In a single-instance deployment, this is unnecessary. In a multi-hub deployment where events are replicated to a cloud aggregator, it becomes essential.

**Why it matters for cloud services:** A NexSys cloud service receiving events from 1,000 homes needs to partition events by origin. Without a hub identifier on each event, the service must maintain external routing tables mapping event IDs to hubs — fragile and un-auditable.

**The architectural door that's already open:** The `EventDraft` and `EventEnvelope` are records. Adding a field to a record is a non-breaking change for existing callers if the new field has a default. The `schemaVersion` field and the `DegradedEvent` fallback mechanism already handle payload evolution. The envelope schema can evolve via a V002 migration that adds an `origin_hub BLOB(16)` column with a default value (the local hub's own ULID).

**What to prepare now:** Nothing in code. The awareness is the preparation. When multi-hub sync is designed, an `InstanceId` typed wrapper (extending the existing 8-wrapper pattern in `platform-api`) and a nullable `originHub` field on `EventEnvelope` are the natural extension points. The V001 schema already has a `chain_hash` column that was added proactively — the same pattern works for `origin_hub`.

### 2.2 `globalPosition` Is SQLite AUTOINCREMENT — Not Globally Meaningful

**Risk level: MEDIUM — structural awareness needed, but the mitigation path is clear.**

The `globalPosition` field is SQLite's `INTEGER PRIMARY KEY AUTOINCREMENT` (`rowid`). It is monotonically increasing within a single SQLite database. It has no meaning across databases. Two hubs will both have events at `globalPosition = 1`, `2`, `3`, etc.

**Why it matters for cloud services:** The `EventBus` uses `globalPosition` for subscriber checkpointing. The `EventStore.readFrom(afterPosition, maxCount)` API is the primary subscriber polling method. The `CheckpointStore` stores `last_position` per subscriber. All of these assume a single, linear, monotonic position space.

In a cloud aggregator receiving events from multiple hubs, there are two options:

1. **Re-assign positions on ingest** — the cloud store assigns its own monotonic position to each received event. This is what EventStoreDB and Kafka do (partition-local offsets). The original `globalPosition` becomes metadata, not the primary ordering key.

2. **Use a composite key** — `(hubId, globalPosition)` uniquely identifies an event across hubs. This preserves per-hub ordering semantics but makes cross-hub queries more complex.

**The architectural door that's already open:** The `EventStore` interface is abstract. A cloud implementation of `EventStore` could use a different position space entirely. The contract tests validate that `readFrom(afterPosition, maxCount)` returns events with monotonically increasing positions and that `latestPosition()` returns the maximum — they do not assert that positions are SQLite rowids. A PostgreSQL-backed `EventStore` using `BIGSERIAL` or a cloud store using Kafka offsets would pass the same contract tests.

**What to prepare now:** Nothing in code. The contract tests already validate the behavioral property (monotonic, gapless within a query result) rather than the implementation property (SQLite AUTOINCREMENT). This is correct by design.

### 2.3 The Single-Writer Model Is Fundamentally Single-Node

**Risk level: LOW for cloud services, HIGH only for multi-writer scenarios (which the architecture explicitly avoids).**

The `WriteCoordinator` serializes all writes through a single platform thread. `SqliteEventStore` routes every `publish()` call through `WriteCoordinator.submit(WritePriority.EVENT_PUBLISH, ...)`. This is a hard constraint of SQLite WAL mode (one writer at a time) and is enforced by AMD-26/AMD-27.

**Why it matters for cloud services:** A cloud service receiving events from many hubs is an event consumer, not a co-writer. The hub remains the single writer for its own event log. The cloud service ingests replicated events into its own store (PostgreSQL, Kafka, etc.) using its own write model. There is no conflict.

The only scenario where the single-writer model creates friction is if the cloud service needs to write events back to the hub's event log — for example, a "remote command dispatched" event. In this case, the command arrives via REST API, the hub's local `EventPublisher` publishes it through the `WriteCoordinator`, and the event is replicated outbound. The hub is always the writer; the cloud is always the relay.

**The architectural door that's already open:** The `EventPublisher` interface has two methods: `publish()` and `publishRoot()`. A cloud relay module would call `publishRoot()` for events originating from remote commands, threading them through the existing single-writer model. The priority queue in `PlatformThreadWriteCoordinator` would handle these alongside local events.

### 2.4 The EventBus Is In-Process — No Remote Subscriber Support

**Risk level: MEDIUM — requires a new module, but no core changes.**

The `EventBus` interface uses `LockSupport.unpark()` to wake subscribers — a JVM-local mechanism. There is no concept of a remote subscriber. The `notifyEvent(long globalPosition)` method is called by the `EventPublisher` after persisting an event, and it wakes local subscribers to poll the `EventStore`.

**Why it matters for cloud services:** A cloud service needs to receive events from hubs. The two viable patterns are:

1. **Hub pushes events to cloud** — a local "cloud sync" subscriber registers with the `EventBus`, polls the `EventStore` for new events, and forwards them to the cloud via HTTPS/WebSocket. This subscriber is a local process that uses the existing `EventBus` and `EventStore` APIs. No core changes needed. This is exactly how the Companion tier is designed to work (Portability Architecture §6.2).

2. **Cloud pulls events from hub** — the cloud service calls the hub's REST API, which internally calls `EventStore.readFrom()`. The existing `readFrom(afterPosition, maxCount)` + `EventPage.hasMore()` pagination model is exactly the long-polling pattern used by EventStoreDB's catch-up subscriptions.

**The architectural door that's already open:** The `websocket-api` module is already designed to relay events to remote clients (the Companion tier). A cloud sync module would be architecturally identical: a subscriber that reads from the local `EventStore` and relays events to a remote endpoint. The `rest-api` module already exposes event query endpoints.

**What to prepare now:** Consider ensuring the `EventStore.readFrom()` query supports efficient "changes since position X" semantics for remote polling. The current SQLite implementation uses `WHERE global_position > ? ORDER BY global_position ASC LIMIT ?` — this is already optimal for long-polling (index-backed, paginated, resumable from checkpoint).

### 2.5 No Event Deduplication Mechanism for Inbound Replication

**Risk level: LOW for MVP, MEDIUM for multi-hub sync.**

When events are replicated from a hub to a cloud service (or between hubs), the same event may arrive multiple times due to network retries, partition recovery, or subscriber replay. The current architecture relies on INV-ES-05 (at-least-once delivery with subscriber idempotency) for local subscribers, but there is no mechanism for deduplicating inbound replicated events at the store level.

**Why it matters for cloud services:** If the cloud service receives the same event twice (same `eventId`), it must either detect the duplicate and skip it, or tolerate it. The `UNIQUE(subject_ref, subject_sequence)` constraint in the V001 schema would catch duplicates that attempt to insert with the same subject and sequence, but it would throw `SequenceConflictException` rather than silently deduplicate.

**The architectural door that's already open:** The `eventId` (ULID) is globally unique. A `UNIQUE(event_id)` index on the cloud store would provide natural deduplication — `INSERT ... ON CONFLICT(event_id) DO NOTHING` in PostgreSQL, or equivalent. The local SQLite schema doesn't need this index because there is only one writer, but a cloud schema would. This is a schema design decision for the cloud store, not a change to the core.

---

## Part 3: What the Tests Don't Cover (Cloud-Relevant Gaps)

### 3.1 No Crash-Recovery or Replay-Consistency Tests

The `EventStoreContractTest` validates append and read-back round trips, ordering, pagination, and parameter validation. It does not test:

- **Replay consistency:** If you replay all events from `readFrom(0, MAX)` through the `StateProjection`, do you get identical state to what existed before a crash? This is the foundational promise of event sourcing.

- **Partial-write recovery:** If the process crashes mid-write (after SQLite WAL commit but before subscriber notification), does the system recover correctly on restart? The design says yes (events are durable before publish returns), but no test validates this.

- **Schema migration under load:** If a V002 migration runs while events are being published, does the system remain consistent? The `MigrationRunner` tests validate migration mechanics, but not concurrent operation.

**Why this matters for cloud:** Event replication relies on the guarantee that the event log is the complete, ordered, consistent source of truth. If replay doesn't produce identical state, replication to a cloud store will produce inconsistent state. A crash-recovery contract test — publish N events, kill the process, restart, verify all N events are readable and produce correct projected state — would validate this guarantee.

### 3.2 No Multi-Reader Consistency Tests

The `PlatformThreadReadExecutor` routes reads to 2 platform threads with round-robin connection assignment. The `SqliteEventStoreTest` runs on a single test thread. There is no test that validates:

- Multiple concurrent readers see consistent state
- A read that starts before a write completes sees either the pre-write or post-write state, never a partial state
- Read-after-write consistency when the write and read are on different threads

**Why this matters for cloud:** A cloud service polling the hub's REST API while the hub is actively publishing events must see consistent state. SQLite WAL provides snapshot isolation for readers, but the test suite doesn't validate this property explicitly.

### 3.3 No Event Serialization Round-Trip Tests Across Versions

The `EventPayloadCodecTest` validates Jackson serialization for the current schema version. There are no tests that validate:

- An event serialized with schema version 1 can be deserialized after the codec is updated to schema version 2 (upcasting)
- An event with an unknown event type produces a `DegradedEvent` with the raw bytes preserved
- The `DegradedEvent` can be re-serialized and sent to a cloud service that has the newer codec

**Why this matters for cloud:** Event replication between hubs running different HomeSynapse versions requires forward and backward compatibility. The `DegradedEvent` mechanism is designed for this, but it's not tested in a cross-version scenario.

### 3.4 No Performance Regression Tests

No test validates the performance targets from INV-PR-02 (event publish p99 < 10ms, query p99 < 50ms). The WAL validation spike (`spike/wal-validation/`) benchmarks are standalone executables, not part of `./gradlew check`.

**Why this matters for cloud:** When a cloud sync subscriber is added (polling the EventStore, serializing events for HTTPS transmission), it adds read load. Without baseline performance tests, there's no way to detect if the sync subscriber degrades local performance.

---

## Part 4: Architecture Compatibility Matrix for Cloud Services

| Cloud Capability | Architecture Ready? | Core Changes Needed? | Test Changes Needed? | Notes |
|:---|:---:|:---:|:---:|:---|
| Event replication (hub → cloud) | ✅ Yes | None | Replay-consistency test recommended | `EventStore.readFrom()` + checkpoint is the pattern |
| Remote command relay (cloud → hub) | ✅ Yes | None | None | REST API → `EventPublisher.publishRoot()` |
| Multi-hub aggregation | ⚠️ Mostly | Hub identity field on envelope | Deduplication tests | ULIDs prevent collisions; position spaces need mapping |
| Companion (phone/tablet) client | ✅ Yes | None | None | Explicitly designed (Portability Architecture §6.2) |
| Encrypted cloud backup | ✅ Yes | None | None | Event log is append-only; backup is a snapshot + stream |
| Cross-hub automation | ⚠️ Partially | Entity ownership model | Cross-hub causal chain tests | Causal context works cross-hub; ownership is undefined |
| Fleet analytics (NexSys Energy) | ✅ Yes | None | None | Read-only aggregation from replicated events |
| Multi-instance convergent sync | ⚠️ Partially | CRDT or merge strategy | Concurrent-modification tests | INV-LF-05 constrains the data model; protocol is post-MVP |

---

## Part 5: "Prepare Now" vs. "Decide Later"

### Prepare Now (low-cost, high-value door-openers)

1. **Add a replay-consistency contract test.** Publish N events, read them all back via `readFrom(0, MAX)`, verify the sequence is complete, ordered, and the payloads are intact. This test validates the foundational promise that the event log is the source of truth. Cost: ~2 hours. Value: validates the core cloud-readiness assumption.

2. **Add a concurrent read/write test to `SqliteEventStoreTest`.** Publish events on one thread while reading on another. Verify snapshot isolation — reads never see partial writes. Cost: ~2 hours. Value: validates the multi-reader model that cloud polling depends on.

3. **Add a cross-version serialization test.** Serialize an event with codec V1, modify the codec to V2 (add a field), deserialize the V1 event, verify it produces a `DegradedEvent` with preserved raw bytes. Cost: ~3 hours. Value: validates the schema evolution mechanism that cross-version replication depends on.

4. **Reserve `origin_hub` in the EventEnvelope Javadoc.** Add a documentation note (not a field) explaining that a future hub identity field is anticipated for multi-instance support. This costs nothing and signals intent to future contributors. No schema change needed.

5. **Ensure `EventStore.readFrom()` contract tests validate efficient long-polling semantics.** The existing tests cover basic pagination. Add a test that verifies `readFrom(latestPosition, 100)` returns an empty page with `hasMore = false` — this is the "nothing new" response that a cloud polling subscriber needs to handle efficiently. Already passing today — just make it explicit.

### Decide Later (complexity without current evidence of need)

1. **Hub identity typed wrapper (`InstanceId` / `HubId`)** — wait until multi-hub sync is designed. The identity model (8 typed wrappers) is extensible; adding a 9th is mechanical.

2. **PostgreSQL EventStore implementation** — wait until a concrete tier (Enhanced or Enterprise) requires it. The contract tests guarantee behavioral equivalence; the implementation is a known quantity.

3. **Event replication protocol** — wait until the sync architecture is designed. The Portability Architecture research identifies the Small Peer / Big Peer pattern but deliberately leaves the protocol unspecified.

4. **Cloud event deduplication** — this is a cloud-store schema design decision, not a core change. `UNIQUE(event_id)` on the cloud schema handles it.

5. **Cross-hub automation ownership model** — this is a design-level question with significant UX implications. The core event model supports it (causal chains with ULIDs work cross-hub), but the ownership policy is a product decision.

---

## Part 6: Honest Assessment

### Where HomeSynapse is genuinely strong for cloud scaling

The event-sourced architecture with clean interface boundaries is the single best structural decision for cloud extensibility. Most smart home platforms (Home Assistant, openHAB, Hubitat) store mutable state directly — syncing mutable state across instances is fundamentally harder than syncing an append-only event log. HomeSynapse's event log is additive (INV-ES-01: events are immutable), globally-identified (LTD-04: ULIDs), causally-linked (LTD-05: correlation/causation chains), and per-entity-sequenced (avoiding global coordination). This combination makes event replication a union operation rather than a conflict resolution problem.

The contract-test-first methodology means that alternative storage backends are provably correct by construction. The 27-method `EventStoreContractTest` is not just a quality assurance tool — it is the specification that any cloud-backed event store must satisfy. This is a stronger guarantee than any other smart home platform provides for backend portability.

The JPMS module boundaries and ArchUnit rules enforce the INV-LF-02 constraint ("Cloud Enhancement, Never Cloud Dependence") structurally, not just by convention. A cloud relay module cannot accidentally create a reverse dependency on core modules because the build system catches it. This means cloud features can be added, removed, or replaced without touching the core — exactly the local-first-with-optional-cloud model that the Architecture Invariants describe.

### Where the real scaling concerns will emerge

The scaling challenge for HomeSynapse cloud services is not architectural — it is operational. The event model, identity system, and interface boundaries are sound. The challenges will be:

1. **Event volume at fleet scale.** A NexSys Energy deployment managing 1,000 homes at 100 events/sec/home would generate 100,000 events/sec aggregate. The cloud aggregation service needs to handle this — but that is a cloud infrastructure problem (Kafka, PostgreSQL with partitioning, etc.), not a HomeSynapse core problem.

2. **Schema evolution across a heterogeneous fleet.** When homes run different HomeSynapse versions, the cloud service receives events with different schema versions. The `DegradedEvent` fallback handles unknown types gracefully, but the cloud service needs its own upcasting pipeline. This is a cloud-side concern.

3. **Privacy at scale.** INV-PD-07 (crypto-shredding) and INV-PR-01 (data stays local by default) mean the cloud service handles encrypted blobs, not plaintext events. The zero-knowledge architecture (Architecture Invariants §16.5) is a privacy advantage but a engineering complexity cost.

None of these concerns require changes to the HomeSynapse core. They are all cloud-service-layer problems that the core's clean interfaces make solvable.

### The bottom line

HomeSynapse is not cornering itself into local-only. The architecture was designed — deliberately, with documented invariants and formal constraints — to be local-first but cloud-extensible. The event-sourced model with ULID identity, per-entity sequencing, and clean interface boundaries is the strongest foundation for cloud scaling of any smart home platform examined. The five friction points identified in this analysis are implementation details, not architectural barriers, and all have clear mitigation paths that require no changes to locked decisions or architecture invariants.

The highest-value action items are not code changes — they are test additions that validate the assumptions cloud services will depend on: replay consistency, concurrent read/write safety, and cross-version serialization compatibility. These tests cost hours, not days, and they convert implicit architectural guarantees into explicit, continuously-validated assertions.
