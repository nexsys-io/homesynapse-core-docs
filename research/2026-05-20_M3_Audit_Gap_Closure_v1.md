# M3 Audit Gap-Closure — Four Unexamined Architectural Questions

**Document type:** Research artifact / pre-M3.6 design input
**Status:** Draft (Artifact 1 of the M3 Gap-Closure + Composition-Root Design Session)
**Date:** 2026-05-20
**Author:** Claude PM (Cowork session)
**Codebase HEAD at investigation:** `5ae7912` — M3.4a integration test scaffold
**Feeds into:** `design/M3.6_Composition_Root_Design.md` (Artifact 2 of this session)
**Supersedes:** Nothing. Closes gaps in the 2026-05-19 cross-tier deployment audit.

---

## 0. Preflight Deviation Notice

This document was produced after the session-start freshness preflight returned **STALE**. Five completed work units (`fceafe8`, `08d0136`, `56aaa4b`, `ed5862c`, `5ae7912`) had not received WUCP Phase 2 closeout at the time of writing — the hivemind governance layer (PROJECT_SNAPSHOT.md, weekly plan, milestone backlog, pm-handoff Open Risks, coder-handoff next-unit pointer, `testing/integration-tests/MODULE_CONTEXT.md`) was five milestones behind the codebase.

Nick reviewed the preflight result and approved a **documented protocol deviation (Option B)** for this session on the grounds that:

1. Both artifacts are pure codebase reads and design specifications — they do not reference, depend on, or consume PROJECT_SNAPSHOT.md, pm-handoff.md, the weekly plan, or any other governance-layer artifact.
2. The MODULE_CONTEXT.md files for the touched modules (`core/event-bus`, `core/persistence`, `core/state-store`) ARE current and reflect the post-M3.5b-supervisor-wiring state.
3. The build is GREEN on HEAD `5ae7912` with no deferred build gates outstanding.
4. The drift is procedural ("DONE" status flips), not architectural.

**Commitment:** Full WUCP Phase 2 reconciliation for all five work units runs as a dedicated session before any M3.6 coding instructions issue from Artifact 2. No code ships against the stale hivemind.

---

## 1. Origin and Scope

The 2026-05-19 cross-tier deployment audit (Cowork) examined the M3.4a codebase against six deployment tiers. Nick reviewed the audit and surfaced four unexamined architectural questions that the audit had missed. These questions, if left unresolved, risk the M3.6 composition root committing to assumptions a future PostgreSQL backend would need to undo.

This document answers each question with evidence — grep results, file:line citations, contract text — and assigns each a binary impact on M3.6 composition-root design.

The questions are not new audits. They are the design-readiness gates Artifact 2 must pass before specifying the work-unit sequence for M3.6.

---

## 2. Q1 — `globalPosition` Contiguity Dependencies

### 2.1 Question

SQLite with single-writer produces contiguous global positions (no gaps). PostgreSQL with `BIGSERIAL` produces monotonically increasing values with gaps on rollback. **If any code in `core/event-bus`, `core/state-store`, or `core/event-model` depends on `position + 1 == nextExpectedPosition`, PostgreSQL compatibility requires refactoring.**

### 2.2 Evidence

**Grep 1 — `position + 1` arithmetic across core/.**
Pattern: `position \+ 1|Position \+ 1|position\+1|Position\+1`
Result: **No matches.** Zero occurrences of position-plus-one arithmetic anywhere in `core/`.

**Grep 2 — variable names suggesting expected-next-position semantics.**
Pattern: `expectedPosition|nextPosition|nextExpected|lastPosition`
Result: All matches resolve to two patterns:
- `EventPage.nextPosition()` — the cursor field returned for pagination (`core/event-model/src/main/java/com/homesynapse/event/EventPage.java:36`). Documented as "the position to use as the `afterPosition` argument for the subsequent query." Gap-tolerant by definition — it is just the last position the caller saw.
- Test-only assertions on `page.nextPosition()` (`core/event-model/src/test/java/com/homesynapse/event/EventPageTest.java`). Test code, not production.

**Grep 3 — `position - 1` arithmetic.**
Pattern: `globalPosition\(\) \- 1|globalPosition - 1|position \- 1|pos \- 1`
Result: Six matches across `InProcessEventBus.java:168, 396`, `TransitionCoordinator.java:99`, `InMemoryEventBus.java:110`, `StateProjectionVerticalIT.java:194`, `EventBusContractTest.java:1449, 1453`. **Every match is the same idiom**:

```java
EventPage page = eventStore.readFrom(globalPosition - 1, 1);
```

This is "fetch the event AT position `globalPosition`" via `EventStore.readFrom`'s exclusive-on-`afterPosition` semantics. The `-1` is not "the position before this one" — it is "decrement so the `>` comparison hits exactly this position."

**SQL semantics verification.** `SqliteEventStore.java` lines 156, 168, 178, 581, 608, 623:

```sql
WHERE global_position > ?
```

Strictly exclusive. The interface Javadoc on `EventStore.readFrom` says "return events with `globalPosition > afterPosition`" — the contract matches the implementation.

**Cursor-advance pattern verification.** `ReplayDriver.java:171`:

```java
currentPosition = envelope.globalPosition();
```

The reader's cursor is copied forward from each delivered envelope. No arithmetic. Gap-tolerant.

**Gap-detection pattern verification.** `TransitionCoordinator.java:91`:

```java
if (position <= runtime.lastReplayedPosition()) {
    continue; // gap detection — already delivered during REPLAY
}
```

A `<=` comparison against the high-water mark. Not arithmetic. Gap-tolerant.

**State projection cursor verification.** `StateProjection.java:576`:

```java
cursorPosition = Math.max(cursorPosition, globalPosition);
```

Monotonic-max. No arithmetic. Gap-tolerant.

### 2.3 The `readFrom(pos - 1, 1)` idiom — explicit reasoning

The idiom appears at six sites. The reasoning is identical at each:

1. A notification arrives with `globalPosition = P` (the bus's `notifyEvent(long)` parameter or the queue's polled value).
2. The bus needs to fetch the envelope **at** position `P` from the event store.
3. The store's read API is `readFrom(afterPosition, maxCount)` with **exclusive** `afterPosition` semantics.
4. So to fetch the event at `P`, the caller passes `P - 1` and reads the first returned row.

Does this break on PostgreSQL with gaps?

- Suppose position 42 was rolled back (gap). Position 43 lands. `notifyEvent(43)` fires (post-persistence per INV-ES-04 — the notified position always exists).
- `readFrom(42, 1)` → SQL `WHERE global_position > 42 LIMIT 1` → returns event 43.
- Returned envelope's `globalPosition()` is 43. Caller's filter/route logic operates on the envelope. No reference to "the gap at 42." Correct outcome.

The idiom is **not** "previous position then this position." It is "fetch the event whose position satisfies `>` against `(P - 1)`," which on any monotonic position scheme returns the event at the smallest position greater than `P - 1`. With contiguous positions that is `P`. With gaps, if `P` exists, it is still `P` (because any rolled-back gap is below `P`). With gaps where `P` itself was rolled back — impossible by INV-ES-04 (notification is post-persistence).

### 2.4 Answer

**Gap-tolerant by construction.** No code in `core/event-bus`, `core/state-store`, or `core/event-model` depends on contiguous positions. Every observed pattern is one of three gap-tolerant idioms: cursor advance from envelope (`Math.max(cursor, envelope.globalPosition())`), gap-detection comparison (`<=` against high-water), or the exclusive-on-`afterPosition` read idiom (`readFrom(pos - 1, 1)`).

### 2.5 Affects M3.6?

**NO.** The composition root design proceeds unchanged. A future PostgreSQL `EventStore` implementation (sibling module per the audit's Dimension 2 verdict) returns `BIGSERIAL` positions and satisfies every existing subscriber contract.

**One soft recommendation** for Artifact 2's M3.6 documentation: the `EventStore.readFrom` Javadoc could explicitly call out the EXCLUSIVE semantics of `afterPosition` as a contract property rather than an incidental SQL detail. This is a Javadoc clarification, not a code change. Not blocking M3.6.

---

## 3. Q2 — `chain_hash` Cross-Backend Semantics

### 3.1 Question

The `chain_hash BLOB(32) NOT NULL` column (AMD-37, V001 schema) creates an implicit ordering dependency if the hash chain is active — each event's hash depends on the previous event's hash. On PostgreSQL with concurrent writers, the chain breaks unless writers serialize.

### 3.2 Evidence

**`SqliteEventStore.publish()` binding — `SqliteEventStore.java:353`:**

```java
ps.setBytes(24, ZERO_HASH);                                 // chain_hash (AMD-37)
```

Bound **unconditionally** to `ZERO_HASH`. No hash computation. No reference to the previous event's hash. No `SELECT MAX(...)` or similar dependency.

**`ZERO_HASH` definition — `SqliteEventStore.java:116`:**

```java
private static final byte[] ZERO_HASH = new byte[32];
```

A 32-byte zero vector. Static field. No mutation path.

**Class-level Javadoc — `SqliteEventStore.java:90-92`:** "The `chain_hash` column is declared [reserved schema] ... [populated with] 32-byte zero vector for the `chain_hash` column (AMD-37)."

**V001 schema default — `MigrationRunnerTest.java:302-333`** verifies "V001 `chain_hash` is NOT NULL with zero-hash default (AMD-37)" — a row written without the column gets 32 zero bytes by SQLite default. Tested directly.

**`EventDraft` / `EventEnvelope` — Grep `chainHash|chain_hash` in `core/event-model/src/main/java/`:** No matches. The hash is not exposed in the public event records.

**Spike confirmation — `D1WalStarvationTest.java:79, 376, 447`:** The D1 WAL Pathology spike (2026-05-15) writes `new byte[32]` zero vectors for `chain_hash` on every row, matching the SqliteEventStore convention.

### 3.3 Answer

**Reserved schema, not active behavior.** Every event row gets `chain_hash = 0x00...00`. There is no chain computation, no dependency on prior events' hashes, no read-then-write transactional pattern. The column exists as a schema reservation for AMD-37's future cryptographic activation (post-MVP per Architecture Invariants §16.5 Phase 4).

The Java-side API surface (`EventDraft`, `EventEnvelope`) does not carry `chainHash`. Cross-backend serialization is unaffected — `chain_hash` is a column, not a record field.

**Multi-writer safe today.** A future PostgreSQL backend can write `chain_hash = 0x00...00` on every INSERT with no coordination. When the cryptographic chain activates (post-MVP), AMD-37 will need an explicit invariant: "chain activation requires single-writer or partition-local chain construction."

### 3.4 Affects M3.6?

**NO.** No composition-root work. Two documentation actions are recommended, neither blocking:

1. **AMD-37 annotation.** When AMD-37 is next edited (likely as part of the cryptographic-chain WU, post-MVP), append: *"Activation invariant: the cryptographic hash chain requires single-writer or partition-local chain construction. Until activation, every event row carries a 32-byte zero vector; the column is schema-reserved."*

2. **MODULE_CONTEXT.md note in `core/persistence`.** The existing class-level Javadoc on `SqliteEventStore` (lines 90-92) covers this, but a single-line gotcha in the MODULE_CONTEXT.md ("chain_hash is reserved schema — always ZERO_HASH today; activation post-MVP") would aid the next reader.

Both are documentation-only, deferred to the next routine update of those documents.

---

## 4. Q3 — Event Type Registration Portability

### 4.1 Question

`EventTypeRegistry` takes an explicit `List<Class<? extends DomainEvent>>` at construction (LTD-07: no classpath scanning). M3.4a's `IntegrationTestHarness` hardcodes 27 event classes. For Enterprise deployments with dynamically-loaded energy integrations, this registration model has friction. **What is M3.6's registration contract?**

### 4.2 Evidence

**`EventTypeRegistry` constructor — `EventTypeRegistry.java:73-101`:**

```java
EventTypeRegistry(List<Class<? extends DomainEvent>> eventClasses) {
    Objects.requireNonNull(eventClasses, "Event class list must not be null");
    if (eventClasses.isEmpty()) {
        throw new IllegalArgumentException("Event class list must not be null or empty");
    }
    // ... explicit-list validation, no scanning
}
```

The constructor itself documents the intent (lines 33-38): *"Classpath scanning is avoided because it is unreliable under JPMS and because an explicit manifest is a deliberate forcing function for code review — adding a new event type requires editing the caller's class list."*

**DECIDE-04 — ServiceLoader explicitly forbidden.** Multi-source confirmation:

- `app/homesynapse-app/src/test/java/com/homesynapse/app/HomeSynapseArchRules.java:109-126` — ArchUnit Rule 3 `noServiceLoader`: *"DECIDE-04: No ServiceLoader — factories instantiated directly."* Enforces at build time.
- `integration/integration-runtime/MODULE_CONTEXT.md:131-137` — *"IntegrationSupervisor.start() accepts `List<IntegrationFactory>`, not ServiceLoader. Per DECIDE-04, the application module assembles the factory list explicitly."*
- `integration/integration-zigbee/ZigbeeAdapterFactory.java:30-31` — *"Per DECIDE-04, this factory is instantiated directly by the application module ... not discovered via ServiceLoader."*

**Existing pattern — explicit list assembly.** Two production sites already follow the pattern:

1. `IntegrationSupervisor.start(List<IntegrationFactory>)` — the composition root assembles the factory list.
2. `EventTypeRegistry(List<Class<? extends DomainEvent>>)` — the composition root assembles the event class list.

The hardcoded test list — `IntegrationTestHarness.ALL_PRODUCTION_EVENT_CLASSES` — is 22 core records + 5 integration lifecycle records = 27 classes. The composition root must construct an identical list at runtime.

### 4.3 Answer

**Option (a): static list assembled at composition root from a published API on each module.** This is the only DECIDE-04-compliant option. Option (b) is forbidden by ArchUnit. Option (c) (ship M3 with static list, defer dynamic) is a degenerate form of (a).

The M3.6 composition root constructs an explicit `List<Class<? extends DomainEvent>>` aggregated from each contributing module. Three sources today:

1. `core/event-model` — 22 core domain events.
2. `integration/integration-api` — 5 `IntegrationLifecycleEvent` subtypes.
3. (Future) `nexsys-*` energy modules — when energy integrations contribute events, the NexSys composition root extends the list.

**Implementation pattern for M3.6.** Each contributing module exposes a `public static final List<Class<? extends DomainEvent>>` constant (e.g., `EventTypes.CORE_PRODUCTION_EVENT_CLASSES` in `core/event-model`, `IntegrationEvents.LIFECYCLE_EVENT_CLASSES` in `integration/integration-api`). The composition root concatenates them. This formalizes the existing test-fixture pattern as a production API.

**Forward compatibility for dynamic integration loading (post-MVP).** When integrations are loaded at runtime (currently out of scope per Doc 05), the integration runtime will publish its own event-class contribution at integration-registration time, and the composition root will rebuild the registry. This is a separate WU; M3.6 does not address it. Documented as a future-extension note.

### 4.4 Affects M3.6?

**YES — minimally.** Two new public constants land as part of M3.6 (one in `core/event-model`, one in `integration/integration-api`) plus a composition-root aggregator that produces the registry. The aggregator is a one-line `Stream.concat(...).toList()` pattern. Zero refactoring of existing types.

Artifact 2 specifies this as **WU M3.6a** (or its successor — final numbering in Artifact 2).

---

## 5. Q4 — `home_id` on `EventEnvelope`

### 5.1 Question

`SqliteEventStore.publish()` binds `HomeId` to the `home_id` column on every event (AMD-34). The cloud-scalability analysis §2.1 flags that `EventEnvelope` doesn't expose `homeId` as a field. **Does M3.6 surface it now or defer to multi-hub?**

### 5.2 Evidence

**`EventEnvelope` record — `EventEnvelope.java:99-114`:** 14 fields. In order:

1. `eventId` (`EventId`)
2. `eventType` (`String`)
3. `schemaVersion` (`int`)
4. `ingestTime` (`Instant`)
5. `eventTime` (`Instant`, nullable)
6. `subjectRef` (`SubjectRef`)
7. `subjectSequence` (`long`)
8. `globalPosition` (`long`)
9. `priority` (`EventPriority`)
10. `origin` (`EventOrigin`)
11. `categories` (`List<EventCategory>`)
12. `causalContext` (`CausalContext`)
13. `actorRef` (`Ulid`, nullable)
14. `payload` (`DomainEvent`)

**No `homeId` field. Not on the envelope.**

**`SqliteEventStore.publish()` — write path:** `SqliteEventStore.java:189, 234, 239, 314`:

```java
private final HomeId homeId;                                    // ctor field
this.homeId = Objects.requireNonNull(homeId, "homeId must not be null");
ps.setBytes(2, homeId.value().toBytes());                       // home_id (AMD-34)
```

`HomeId` is a constructor parameter of `SqliteEventStore`, stored as instance field, bound to the `home_id` column on every INSERT. Single-instance scope — every event written by this `SqliteEventStore` carries the same `homeId`.

**`SqliteEventStore.fromRow()` — read path:** `SqliteEventStore.java:654-703`:

```java
private EventEnvelope fromRow(ResultSet rs) throws SQLException {
    long globalPosition = rs.getLong("global_position");
    EventId eventId = EventId.of(Ulid.fromBytes(rs.getBytes("event_id")));
    // ... 12 more rs.get* calls, then construct EventEnvelope ...
    return new EventEnvelope(
            eventId, eventType, schemaVersion, ingestTime, eventTime,
            subject, subjectSequence, globalPosition, priority, origin,
            categories, causalContext, actorRef, payload
    );
}
```

**`fromRow` does NOT read `home_id`.** The column is written on every INSERT but never read back. The Java API is unaware of the home identity that the event was tagged with at write time.

### 5.3 The cost-benefit of surfacing now

**Surfacing `homeId` on `EventEnvelope` as a 15th field today:**

- One field added to `EventEnvelope` record.
- `fromRow()` reads `home_id` and binds it.
- **All ~1,400 tests that construct `EventEnvelope` directly or via test factories require updating** — record canonical-constructor change is a breaking compile-time API change.
- `TestEventFactory`, `InMemoryEventStore`, every contract test, every test fixture: parameter added.
- Bus-side filtering (`SubscriptionFilter.matches(envelope)`) doesn't use `homeId` — no behavioral change.
- No in-process consumer needs it today. The Companion app reads via REST/WS — not in scope until those APIs ship. The cloud relay (post-MVP) is the first real consumer.

**Deferring to a future multi-hub WU:**

- Same record + `fromRow` changes happen later, with the same test-fixture cost.
- BUT: the multi-hub WU is the moment when consumer code *needs* the field — the test-fixture cost is paid simultaneously with the consumer-side wiring, not as a pre-payment.
- Risk: in the intervening period, the schema's `home_id` column is populated but unreadable from Java. A debugger looking at a `ResultSet` row sees the home identity; a Java caller using only `EventStore.readFrom(...).events()` does not. Diagnostic disclosure asymmetry.
- Mitigation: a `SqliteEventStore.homeId()` accessor (returning the constructor-injected `HomeId`) gives test fixtures and bus introspection the same value without touching `EventEnvelope`. Adds one method, no breaking changes.

### 5.4 Answer

**Defer to the multi-hub WU.** Do not surface `homeId` on `EventEnvelope` in M3.6.

**Rationale:** The cost of the breaking record-constructor change (every test fixture and contract test) is large; the consumer-side benefit is zero for in-process MVP code. The cloud-scalability analysis §2.1 was right that the column exists as preparation — the *Java API exposure* is what's missing, and exposing it is a multi-hub-WU concern, not an M3.6 concern.

**Documentation actions required (M3.6 scope, lightweight):**

1. **MODULE_CONTEXT.md note in `core/persistence`.** Add a Gotcha: *"`home_id` column is populated on every write from the `SqliteEventStore`-constructor-injected `HomeId` (AMD-34) but NOT read back by `fromRow()`. The Java `EventEnvelope` is unaware of the home identity. When multi-hub sync ships, surface `homeId` as a 15th field on `EventEnvelope` and update `fromRow()` to read `rs.getBytes("home_id")`. Until then, `SqliteEventStore` is the sole owner of the value."*

2. **AMD-34 annotation.** Append: *"As of M3.6, the `home_id` column is written but not exposed on `EventEnvelope`. Java-side API exposure is deferred to the multi-hub sync WU (post-MVP) to avoid the breaking-record-constructor cost during single-instance MVP."*

3. **(Optional, low-priority)** Add a `SqliteEventStore.homeId() → HomeId` accessor for test fixtures and bus introspection. One method, zero breaking changes, lets diagnostic tools observe the value without record changes. Decided in Artifact 2.

### 5.5 Affects M3.6?

**NO.** Composition-root design proceeds unchanged. Two documentation updates are the only M3.6 deliverable for Q4. The optional accessor is an Artifact-2 micro-decision.

---

## 6. Decision Matrix

| # | Question | Evidence-backed answer | Affects M3.6? | If yes, what changes |
|---|---|---|---|---|
| Q1 | `globalPosition` contiguity dependencies | **Gap-tolerant by construction.** No `position + 1` arithmetic anywhere in `core/`. The `readFrom(pos - 1, 1)` idiom is exclusive-`afterPosition` semantics, not contiguity. Cursor advance is `Math.max`. Gap detection is `<=`. | **No** | (Optional) Clarify `EventStore.readFrom` Javadoc: `afterPosition` is EXCLUSIVE. Documentation only. |
| Q2 | `chain_hash` cross-backend semantics | **Reserved schema, not active.** `SqliteEventStore.java:353` binds `ZERO_HASH` unconditionally. No chain computation. `chain_hash` is not on `EventDraft` / `EventEnvelope`. Multi-writer safe today. | **No** | AMD-37 annotation (post-MVP) + MODULE_CONTEXT.md gotcha. Documentation only. |
| Q3 | Event type registration portability | **Static list at composition root** (option a). DECIDE-04 forbids `ServiceLoader` (ArchUnit Rule 3). Matches `IntegrationSupervisor.start(List<IntegrationFactory>)` pattern. | **Yes (minimal)** | Add `EventTypes.CORE_PRODUCTION_EVENT_CLASSES` to `core/event-model` (public static final List) and `IntegrationEvents.LIFECYCLE_EVENT_CLASSES` to `integration/integration-api`. Composition root concatenates. One sub-WU in M3.6. |
| Q4 | `home_id` on `EventEnvelope` | **Defer to multi-hub WU.** 14-field envelope, `homeId` not present. `fromRow()` does not read `home_id` despite the column being populated on every write. Breaking record-constructor change has no MVP consumer. | **No** | MODULE_CONTEXT.md gotcha + AMD-34 annotation. Optional `SqliteEventStore.homeId()` accessor. Documentation + optional one-method addition. |

---

## 7. What This Means for Artifact 2 (M3.6 Composition-Root Design)

The four investigations produce a benign result: **zero architectural surprises**. Every M3.6 composition-root decision proceeds as outlined in the prior session's design proposal. The deltas are:

- **Q3 introduces one new sub-WU:** publish per-module event-class constants and aggregate at the composition root. Self-contained, one-line aggregator, no refactor of existing types.
- **Q1, Q2, Q4 produce documentation updates** that ride alongside the M3.6 work units but do not gate them. They can land in the same commits as the corresponding code changes or in a single post-M3.6 documentation pass.
- **Q4 adds an optional micro-decision** (`SqliteEventStore.homeId()` accessor) that Artifact 2 will resolve one way or the other.

The five M3.6 commitments from the prior session — `PersistenceConfig` wiring, profile-driven PRAGMAs, `ReplayWindowQueue.MAX_CAPACITY` parameterization, `PersistenceLifecycle` Javadoc cleanup, composition-root facade with shared scheduler — all stand. Artifact 2 will sequence them as M3.6a, M3.6b, … with binary success criteria per the coding-instruction format.

---

## 8. STOP for Review

Per the session brief, this artifact is the gating point. Artifact 2 will not begin until Nick reviews the four answers above. Specifically:

- **Q1 (gap-tolerant):** if you spot a code path I missed that does depend on contiguity, flag it now — Artifact 2 has to address it.
- **Q2 (reserved schema):** the two documentation updates are nice-to-have but the recommendation is to defer them to the cryptographic-chain WU. Confirm or override.
- **Q3 (static-list aggregator):** the recommended pattern is for each module to publish a `public static final List<Class<? extends DomainEvent>>` constant. Confirm — or specify an alternative (e.g., a dedicated `EventClassRegistry` utility module).
- **Q4 (defer):** confirm the defer decision and the optional-accessor question. If you want the accessor in M3.6, Artifact 2 specifies it; if you want it deferred too, Artifact 2 leaves it out.

Once reviewed, Artifact 2 lands at `homesynapse-core-docs/design/M3.6_Composition_Root_Design.md`.

---

## Appendix A — File:line index of every cited match

| Citation | Location | Subject |
|---|---|---|
| `EventStore.readFrom` exclusive contract | `core/event-model/src/main/java/com/homesynapse/event/EventStore.java:40-55` | Q1 |
| `EventPage.nextPosition` cursor field | `core/event-model/src/main/java/com/homesynapse/event/EventPage.java:36` | Q1 |
| SQL `WHERE global_position > ?` | `core/persistence/src/main/java/com/homesynapse/persistence/SqliteEventStore.java:156, 168, 178, 581, 608, 623` | Q1 |
| `readFrom(pos - 1, 1)` idiom | `core/event-bus/src/main/java/com/homesynapse/event/bus/InProcessEventBus.java:168, 396`; `TransitionCoordinator.java:99`; `core/event-bus/src/testFixtures/java/com/homesynapse/event/bus/test/InMemoryEventBus.java:110`; `core/event-bus/src/testFixtures/java/com/homesynapse/event/bus/test/EventBusContractTest.java:1449, 1453`; `core/state-store/src/test/java/com/homesynapse/state/StateProjectionVerticalIT.java:194` | Q1 |
| `ReplayDriver` cursor advance | `core/event-bus/src/main/java/com/homesynapse/event/bus/ReplayDriver.java:171` | Q1 |
| `TransitionCoordinator` gap-detection comparison | `core/event-bus/src/main/java/com/homesynapse/event/bus/TransitionCoordinator.java:91` | Q1 |
| `StateProjection.cursorPosition` monotonic-max | `core/state-store/src/main/java/com/homesynapse/state/StateProjection.java:576` | Q1 |
| `ZERO_HASH` static field | `core/persistence/src/main/java/com/homesynapse/persistence/SqliteEventStore.java:116` | Q2 |
| `chain_hash` bound unconditionally | `core/persistence/src/main/java/com/homesynapse/persistence/SqliteEventStore.java:353` | Q2 |
| `chain_hash` reserved-schema Javadoc | `core/persistence/src/main/java/com/homesynapse/persistence/SqliteEventStore.java:90-92` | Q2 |
| V001 `chain_hash` zero-default test | `core/persistence/src/test/java/com/homesynapse/persistence/MigrationRunnerTest.java:302-333` | Q2 |
| `EventTypeRegistry` explicit-list constructor | `core/persistence/src/main/java/com/homesynapse/persistence/EventTypeRegistry.java:73-101` | Q3 |
| DECIDE-04 ArchUnit enforcement | `app/homesynapse-app/src/test/java/com/homesynapse/app/HomeSynapseArchRules.java:109-126` | Q3 |
| `IntegrationSupervisor.start(List<...>)` precedent | `integration/integration-runtime/src/main/java/com/homesynapse/integration/runtime/IntegrationSupervisor.java:58-59`; MODULE_CONTEXT.md:131-137 | Q3 |
| `EventEnvelope` 14-field record | `core/event-model/src/main/java/com/homesynapse/event/EventEnvelope.java:99-114` | Q4 |
| `home_id` written, not read | `core/persistence/src/main/java/com/homesynapse/persistence/SqliteEventStore.java:189, 234, 239, 314 (write)`; `654-703 (read, omitted)` | Q4 |
