# HomeSynapse Core — Agent Knowledge Benchmark

**Purpose:** Paste this entire prompt into a fresh Claude conversation (with the `nexsys-coder` skill loaded and both repos mounted) to assess whether the agent has internalized the HomeSynapse Core architecture deeply enough to write correct Phase 3 code without constant correction.

**How to use:**
1. Open a new Cowork session with `homesynapse-core` and `homesynapse-core-docs` mounted
2. Paste everything below the `---` line
3. The agent should read the relevant MODULE_CONTEXT.md and source files, then answer all 8 sections
4. Score using the answer key at the bottom of this document (do NOT include the answer key in the prompt)

**Passing threshold:** 85% or higher across all sections. Any wrong answer in Section 1 (Gotcha Awareness) or Section 5 (Constraint Adherence) is a hard fail — those errors cause bugs that compile cleanly.

---

## PROMPT — COPY BELOW THIS LINE

You are being evaluated on your understanding of the HomeSynapse Core architecture before beginning Phase 3 implementation work. This is a closed-book exam in the sense that you should read the actual source files and MODULE_CONTEXT.md files in the repository to answer — do not guess from training data.

**Instructions:**
- Read the MODULE_CONTEXT.md files for: event-model, event-bus, device-model, state-store, persistence, platform-api, and configuration
- Read the governance files: Architecture_Invariants_v1.md, HomeSynapse_Core_Locked_Decisions.md
- Read the Glossary
- Then answer every question below precisely. Show your work — cite the file and section where you found each answer.

---

### Section 1: Gotcha Awareness (12 points)

These are the documented gotchas from MODULE_CONTEXT.md files — the things that cause bugs that compile cleanly. Answer each from memory after reading the context files.

1. How many fields does `EventEnvelope` have? Name the field that was promoted from `CausalContext` and explain why it was moved. (2 pts)

2. How many fields does `CausalContext` have? What are they? What is the ONLY case where `causationId` is null? (2 pts)

3. `SubscriptionFilter.eventTypes` — what does an empty set mean? Why is this a gotcha? (2 pts)

4. `CheckpointStore` vs `ViewCheckpointStore` — what does each store, and which module owns each? (2 pts)

5. Why is `CustomCapability` a final class instead of a record? How many total types does the sealed `Capability` interface permit? (2 pts)

6. `Entity.deviceId` is nullable. Under what circumstances? Why is this not a bug? (2 pts)

---

### Section 2: Type System Precision (10 points)

Write the exact Java signatures for each of the following. Do not paraphrase — write compilable code.

7. The `EventPublisher` interface — both method signatures including throws clauses. (2 pts)

8. The `EventStore` interface — all 6 method signatures with exact parameter types and return types. (3 pts)

9. The `EventDraft` record — all 8 component names and types in order. Which are nullable? (2 pts)

10. The `SubjectRef` record — its components and all 6 static factory methods with parameter types. (2 pts)

11. The `CausalContext` record — its components, both static factory methods, and the `isRoot()` method. (1 pt)

---

### Section 3: Cross-Module Contracts (10 points)

12. Describe the EventPublisher's durability guarantee. What happens between `publish()` returning and subscriber notification? Cite the invariant. (2 pts)

13. What is the subscriber delivery model — push or pull? Describe the exact mechanism: how does a subscriber learn about new events, and how does it retrieve them? (2 pts)

14. Which two subscribers MUST be registered with `coalesceExempt = true`? What breaks if they aren't? (2 pts)

15. Describe the ordering contract for subscriber registration at startup. What happens if events are published before subscribers register? (2 pts)

16. What is the relationship between `EntityId` and `DeviceId` in the device model? Which one do automation rules, state events, and commands reference? (2 pts)

---

### Section 4: Practical Implementation (16 points)

Write code for each scenario. The code must compile against the actual Phase 2 interfaces in the repository.

17. Write a method that publishes a root event and then publishes two derived events in the same causal chain, using the correct `CausalContext` factories. Show how `correlationId` and `causationId` flow through the chain. Use real types from the codebase. (4 pts)

18. Write a method that reads events page-by-page from `EventStore.readFrom()` until all events are consumed. Show correct use of `EventPage.nextPosition()` and `EventPage.hasMore()`. (3 pts)

19. Write a `SubscriptionFilter` that matches only NORMAL-or-higher priority `state_changed` events for ENTITY subjects. Show how `severity()` comparison works for priority filtering. (3 pts)

20. Write a test method (JUnit 5 + AssertJ) that verifies a `readBySubject` call returns events in `subjectSequence` order and correctly filters to a single subject when multiple subjects have events. Follow the `{method}_{scenario}_{expected}` naming convention. (3 pts)

21. Given an `EventEnvelope`, show how you would construct the `CausalContext` for a derived event and how you would propagate `actorRef` from the causing event through the new `EventDraft`. (3 pts)

---

### Section 5: Constraint Adherence (10 points)

22. Why must all concurrency use `ReentrantLock` instead of `synchronized`? Cite the locked decision. (1 pt)

23. What logging framework must be used? Can a module declare SLF4J as an `api()` dependency? Why or why not? (2 pts)

24. Name the 3 processing modes that suppress side effects during event consumption. For each, state what IS and IS NOT allowed. (3 pts)

25. An integration adapter crashes with an unhandled exception. What must happen to the core system? Cite the invariant. (1 pt)

26. You need to add a new dependency not in `libs.versions.toml`. What is the correct escalation path? Can you add it yourself? (1 pt)

27. You discover that a Phase 2 interface needs a new method to make your implementation work. What do you do? (2 pts)

---

### Section 6: Architecture Reasoning (8 points)

28. Why does HomeSynapse use event sourcing instead of a traditional CRUD state store? Give at least 3 specific benefits that matter for a smart home OS running on a Raspberry Pi. (3 pts)

29. Explain the "single-writer model" (LTD-03 context). Why does only one thread write to the event store? What would go wrong with concurrent writers? (2 pts)

30. The EventStore uses `COALESCE(event_time, ingest_time)` for time-range queries. Why are there two time fields? When would `event_time` be null? (2 pts)

31. Why does `EventPage` use cursor-based pagination (`afterPosition`) instead of offset-based pagination (`LIMIT/OFFSET`)? (1 pt)

---

### Section 7: Java 21 Patterns (6 points)

32. Write a sealed interface with 3 permitted records, then write an exhaustive switch expression over it. What happens at compile time if you add a 4th permitted type? (2 pts)

33. Show the typed ULID wrapper pattern (LTD-04) by writing a new ID type `AutomationRunId`. Include: record definition, `of()` factory, `parse()` factory, `Comparable` implementation. (2 pts)

34. Why does HomeSynapse prefer `Stream<T>` over `List<T>` for large result sets? Relate this to the Raspberry Pi 4's 4GB RAM constraint. (2 pts)

---

### Section 8: Error Handling and Edge Cases (8 points)

35. `SequenceConflictException` extends `Exception`, not `HomeSynapseException`. Why is it a separate hierarchy? What does the caller do when it catches one? (2 pts)

36. What is a `DegradedEvent`? When is it produced? How does it affect subscribers? (2 pts)

37. An event's `actorRef` is `null`. Is this an error? What does it mean? Give 2 examples of events that would have null actorRef. (2 pts)

38. `EventEnvelope.categories()` returns an unmodifiable list. What exception is thrown if a consumer tries to add to it? Why is this defensive copy necessary? (2 pts)

---

Total: 80 points. Passing: 68/80 (85%).

## END OF PROMPT

---
---
---

## ANSWER KEY — DO NOT INCLUDE IN PROMPT

### Section 1: Gotcha Awareness

**1.** 14 fields. `actorRef` (Ulid, nullable) was promoted from CausalContext to EventEnvelope. Reason: enables direct indexing and querying for multi-user audit trails (INV-MU-01) without unpacking the causal context. Source: event-model MODULE_CONTEXT.md, Gotchas section + Key Design Decisions #2.

**2.** 2 fields: `correlationId` (Ulid, non-null) and `causationId` (Ulid, nullable). `causationId` is null ONLY for root events (events with no causal predecessor). For root events, `correlationId` equals the event's own `eventId`. Source: CausalContext.java, event-model MODULE_CONTEXT.md Gotcha.

**3.** An empty `eventTypes` set means "match ALL event types" — it's a wildcard, not "no types." This is a gotcha because the intuitive reading of "empty set" would be "match nothing." Source: event-bus MODULE_CONTEXT.md, Gotchas section.

**4.** `CheckpointStore` (event-bus module) stores subscriber position checkpoints: `subscriberId → globalPosition` (a single long per subscriber). `ViewCheckpointStore` (state-store module) stores view snapshot checkpoints: `viewName → position + serialized data blob`. They have similar names but are completely different things. Source: event-bus MODULE_CONTEXT.md, Gotchas section.

**5.** `CustomCapability` is a final class because custom capabilities are constructed from runtime JSON schemas, not compile-time record components. The sealed `Capability` interface permits 16 types: 15 standard capability records + 1 `CustomCapability` final class. Source: device-model MODULE_CONTEXT.md.

**6.** `Entity.deviceId` is nullable for helper entities — entities not backed by physical hardware (virtual sensors, computed entities). This is deliberate, not a bug. Source: device-model MODULE_CONTEXT.md, Gotchas section.

### Section 2: Type System Precision

**7.** EventPublisher:
```java
EventEnvelope publish(EventDraft draft, CausalContext cause) throws SequenceConflictException;
EventEnvelope publishRoot(EventDraft draft) throws SequenceConflictException;
```

**8.** EventStore:
```java
EventPage readFrom(long afterPosition, int maxCount);
EventPage readBySubject(SubjectRef subject, long afterSequence, int maxCount);
List<EventEnvelope> readByCorrelation(Ulid correlationId);
EventPage readByType(String eventType, long afterPosition, int maxCount);
EventPage readByTimeRange(Instant from, Instant to, long afterPosition, int maxCount);
long latestPosition();
```
Key: `readByCorrelation` returns `List<EventEnvelope>`, NOT `EventPage`. `readBySubject` takes `long afterSequence`, not `int`.

**9.** EventDraft components in order:
```java
String eventType,          // non-null, non-blank
int schemaVersion,         // >= 1
Instant eventTime,         // NULLABLE
SubjectRef subjectRef,     // non-null
EventPriority priority,    // non-null
EventOrigin origin,        // non-null
DomainEvent payload,       // non-null
Ulid actorRef              // NULLABLE
```
Nullable: `eventTime` and `actorRef`.

**10.** SubjectRef:
```java
public record SubjectRef(Ulid id, SubjectType type) { }
// Factory methods:
static SubjectRef entity(EntityId entityId)
static SubjectRef device(DeviceId deviceId)
static SubjectRef integration(IntegrationId integrationId)
static SubjectRef automation(AutomationId automationId)
static SubjectRef system(SystemId systemId)
static SubjectRef person(PersonId personId)
```

**11.** CausalContext:
```java
public record CausalContext(Ulid correlationId, Ulid causationId) { }
static CausalContext root(Ulid correlationId)      // causationId = null
static CausalContext chain(Ulid correlationId, Ulid causationId) // both non-null
boolean isRoot()  // returns causationId == null
```

### Section 3: Cross-Module Contracts

**12.** `EventPublisher.publish()` is synchronous — the event is durable in SQLite WAL before the method returns (INV-ES-04). Subscriber notification begins asynchronously AFTER return. If the system crashes between publish and notification, recovery replays persisted-but-undelivered events.

**13.** Pull-based. The EventBus does NOT deliver events to subscribers. It wakes subscribers via `LockSupport.unpark()`. Each subscriber then calls `EventStore.readFrom()` to pull events starting from their checkpoint position. This enables per-subscriber backpressure and crash-safe resumption.

**14.** State Projection and Pending Command Ledger. If they aren't coalesce-exempt, they may miss individual DIAGNOSTIC events during backpressure periods, causing state to diverge from the event log.

**15.** Subscribers must be registered BEFORE the publisher starts accepting events. If events are published before registration, those events won't trigger notifications (though they ARE still persisted and will be processed on the next catch-up read). The startup-lifecycle module coordinates this ordering.

**16.** Entity is the atomic unit of behavior. A Device owns one or more Entities. Automation rules, state events, and commands all reference `EntityId`, not `DeviceId`. `DeviceId` is for device lifecycle events (discovered, adopted, removed).

### Section 4: Practical Implementation

**17.** Must show:
- `publisher.publishRoot(draft)` returns `root`
- `CausalContext.chain(root.causalContext().correlationId(), root.eventId().value())` for first derived
- `CausalContext.chain(root.causalContext().correlationId(), derived1.eventId().value())` for second derived
- `correlationId` stays the same throughout the chain
- `causationId` points to the immediately preceding event's ID

**18.** Must show:
```java
long position = 0;
boolean hasMore = true;
while (hasMore) {
    EventPage page = store.readFrom(position, batchSize);
    // process page.events()
    position = page.nextPosition();
    hasMore = page.hasMore();
}
```

**19.** Must show:
- `eventTypes` containing `"state_changed"` (or using the `EventTypes.STATE_CHANGED` constant)
- Priority filtering using `severity()`: `event.priority().severity() <= EventPriority.NORMAL.severity()`
- Subject type filter set to `SubjectType.ENTITY`
- The filter is a conjunction — all criteria must match

**20.** Must follow `{method}_{scenario}_{expected}` naming. Must create 2+ subjects, publish events to both, query one via `readBySubject`, assert size filters to correct subject, assert `subjectSequence` values are 1, 2, 3...

**21.** Must show:
```java
CausalContext derivedCause = CausalContext.chain(
    causingEnvelope.causalContext().correlationId(),
    causingEnvelope.eventId().value());
EventDraft derivedDraft = new EventDraft(
    eventType, schemaVersion, eventTime, subjectRef,
    priority, origin, payload,
    causingEnvelope.actorRef());  // inherit actorRef from causing event
publisher.publish(derivedDraft, derivedCause);
```

### Section 5: Constraint Adherence

**22.** `synchronized` pins virtual threads to carrier threads (LTD-11). The Pi 4 has only 4 cores — pinning would negate the benefit of virtual threads.

**23.** SLF4J (LTD-15). No — SLF4J must be `implementation` scope, not `api()`. If exposed as `api()`, it creates a Gradle/JPMS mismatch (documented in event-model build.gradle.kts comment referencing DECIDE-01 and S4-01). Each module declares its own SLF4J dependency.

**24.** Three modes that suppress side effects: REPLAY (state updates only — no command dispatch, no notifications, no external writes), PROJECTION (state only — even more restricted than REPLAY), DRY_RUN (evaluation only — no state updates, no execution). Only LIVE allows full processing + side effects.

**25.** The core system must continue running (INV-RF-01: crash isolation). An integration adapter crash cannot take down core or other adapters.

**26.** Log as `[REVIEW]` and escalate to the PM. You cannot add dependencies not in `libs.versions.toml` unilaterally.

**27.** Escalate to the PM. You do not own public interface changes. Changing a Phase 2 interface requires the formal revision process. Log as `[BLOCKING]` if it blocks implementation.

### Section 6: Architecture Reasoning

**28.** Three benefits for a Pi-based smart home OS:
1. Complete audit trail / explainability — every state change traceable to its cause (INV-ES-06)
2. Crash recovery without data loss — replay from last checkpoint rebuilds state (INV-ES-02)
3. Time travel / debugging — read the event log to understand what happened and when
Also acceptable: schema evolution (change how you interpret events without rewriting history), multi-subscriber projections (different views of the same data).

**29.** Single-writer (one thread writes via EventPublisher) avoids contention on the `(subjectRef, subjectSequence)` unique constraint. Concurrent writers would race on sequence assignment — two events could claim the same sequence number for the same subject, causing `SequenceConflictException` or requiring complex optimistic concurrency retry loops. SQLite's single-writer WAL mode aligns naturally.

**30.** `event_time` is when the real-world occurrence happened (reported by the event source). `ingest_time` is when the event was appended to the store. `event_time` is null when the source has no reliable clock — e.g., some Zigbee devices that report state changes without timestamps. COALESCE ensures time-range queries still work for those events.

**31.** Offset-based pagination (`LIMIT N OFFSET M`) is O(M+N) in SQLite — it must skip M rows to reach the offset. Cursor-based pagination (`WHERE globalPosition > ?`) uses the index directly and is O(N) regardless of position in the log. For an event store that may have millions of events, this matters.

### Section 7: Java 21 Patterns

**32.** Must show sealed interface, 3 permitted records, exhaustive switch with no default branch. Answer: adding a 4th type causes a compilation error in every exhaustive switch — the compiler enforces completeness.

**33.** Must show:
```java
public record AutomationRunId(Ulid value) implements Comparable<AutomationRunId> {
    public AutomationRunId { Objects.requireNonNull(value, "..."); }
    public static AutomationRunId of(Ulid value) { return new AutomationRunId(value); }
    public static AutomationRunId parse(String crockford) { return new AutomationRunId(Ulid.parse(crockford)); }
    @Override public int compareTo(AutomationRunId other) { return value.compareTo(other.value); }
}
```

**34.** `Stream<T>` processes elements lazily — only one element in memory at a time. `List<T>` materializes the entire collection. With 4GB RAM shared between the JVM, SQLite, and the OS, large materializations can trigger GC pressure or OOM. For large result sets (e.g., catch-up reads of thousands of events), streaming avoids the allocation spike.

### Section 8: Error Handling and Edge Cases

**35.** `SequenceConflictException` extends `Exception` directly, NOT `HomeSynapseException`, because it's an optimistic concurrency signal, not a domain error. It means the publisher computed an incorrect sequence number or the store is corrupted. The caller should NOT retry with the same sequence — the publisher should read the current max sequence for the subject and re-derive.

**36.** `DegradedEvent` is a record implementing `DomainEvent`. It wraps events whose payload could not be upcast to the current schema version (upcaster failure, Doc 01 §3.10). It's returned in the event stream in place of the real payload (lenient mode), so subscribers/diagnostic tools can still process the event metadata even when the payload is unreadable. Fields: `eventType`, `schemaVersion`, `rawPayload`, `failureReason`.

**37.** Not an error. Null `actorRef` means no user is attributable to the event. Examples: (1) device-autonomous events (a sensor reporting battery level on its own schedule), (2) system events (`system_started`, `system_stopped`). Any event where the stimulus isn't a human action.

**38.** `UnsupportedOperationException` — the list is created via `List.copyOf()` in EventEnvelope's compact constructor, which returns an unmodifiable list. The defensive copy is necessary because the caller could otherwise mutate the categories list after constructing the envelope, violating the immutability guarantee (INV-ES-01: events are immutable facts).
