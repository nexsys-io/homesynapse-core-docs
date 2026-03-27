# HomeSynapse Core Architecture Exam — Answers

## Section 1: Gotcha Awareness (12 points)

### 1. How many fields does `EventEnvelope` have? Name the field that was promoted from `CausalContext` and explain why it was moved. (2 pts)

**`EventEnvelope` has 14 fields.** The 14 fields in record-declaration order are:

1. `eventId` (EventId)
2. `eventType` (String)
3. `schemaVersion` (int)
4. `ingestTime` (Instant)
5. `eventTime` (Instant, nullable)
6. `subjectRef` (SubjectRef)
7. `subjectSequence` (long)
8. `globalPosition` (long)
9. `priority` (EventPriority)
10. `origin` (EventOrigin)
11. `categories` (List\<EventCategory\>)
12. `causalContext` (CausalContext)
13. `actorRef` (Ulid, nullable)
14. `payload` (DomainEvent)

**The promoted field is `actorRef`.** It was originally bundled inside `CausalContext` (which used to have 3 fields) and was promoted to a top-level envelope field during the Architecture Review Fixes (March 2026). The reason: promoting `actorRef` to the envelope enables **direct indexing and querying for multi-user audit trails (INV-MU-01)**, per-user activity views (INV-TO-01), and explainability (INV-ES-06). Keeping it on CausalContext would have required unpacking the causal context to query by actor, making audit trail queries inefficient.

**Source:** event-model MODULE_CONTEXT.md — "Key Design Decisions" §2 and GOTCHA: "EventEnvelope has 14 fields, not 13."

---

### 2. How many fields does `CausalContext` have? What are they? What is the ONLY case where `causationId` is null? (2 pts)

**`CausalContext` has 2 fields:**

1. `correlationId` (Ulid, non-null) — the root event's event ID, propagated unchanged through all downstream events in the chain.
2. `causationId` (Ulid, nullable) — the immediately preceding event's event ID.

**`causationId` is null ONLY for root events** — events representing external stimuli entering the system with no prior event cause (e.g., a device report arriving from an integration adapter, a user command from the REST API, or a system lifecycle event). The `isRoot()` method returns `true` when `causationId == null`. For root events, `correlationId` equals the event's own event ID (self-correlation).

**Source:** CausalContext.java lines 47–49; event-model MODULE_CONTEXT.md GOTCHA: "`CausalContext` has 2 fields, not 3."

---

### 3. `SubscriptionFilter.eventTypes` — what does an empty set mean? Why is this a gotcha? (2 pts)

**An empty `eventTypes` set means "match ALL event types" — it is a wildcard.** This is the opposite of what you might intuitively expect. A developer might assume an empty set means "match no types" (i.e., nothing passes), but in fact it's a permissive wildcard that lets every event type through.

This is a gotcha because it's counterintuitive — in most filter APIs, an empty set means "nothing matches." Here, emptiness means universality. The `matches()` method implements this as: `if (!eventTypes.isEmpty() && !eventTypes.contains(envelope.eventType())) return false;` — the non-empty check short-circuits, so an empty set never rejects any event type.

**Source:** event-bus MODULE_CONTEXT.md GOTCHA: "`SubscriptionFilter.eventTypes` empty set means ALL types, not NO types"; SubscriptionFilter.java `matches()` method lines 132–134.

---

### 4. `CheckpointStore` vs `ViewCheckpointStore` — what does each store, and which module owns each? (2 pts)

**`CheckpointStore`** (in **event-bus** module, `com.homesynapse.event.bus`):
- Stores **subscriber position checkpoints** — a single `long` (globalPosition) per subscriber.
- Methods: `readCheckpoint(String subscriberId) → long`, `writeCheckpoint(String subscriberId, long globalPosition)`.
- Purpose: tracks how far each event bus subscriber has processed in the global event log.
- Stored in `subscriber_checkpoints` table.

**`ViewCheckpointStore`** (in **state-store** module, `com.homesynapse.state`):
- Stores **materialized view snapshot checkpoints** — opaque serialized view state (`byte[]`) keyed by view name.
- Methods: `writeCheckpoint(String viewName, long position, byte[] data)`, `readLatestCheckpoint(String viewName) → Optional<CheckpointRecord>`.
- Purpose: enables crash recovery of materialized views (e.g., State Projection) by storing a serialized snapshot of the view's state.
- Stored in `view_checkpoints` table.

Both are **implemented** by the **persistence** module in Phase 3, but the **interface definitions** live in their respective owning modules.

**Source:** event-bus MODULE_CONTEXT.md GOTCHA: "CheckpointStore here is for subscriber POSITION checkpoints only"; state-store MODULE_CONTEXT.md — ViewCheckpointStore description and GOTCHA: "`ViewCheckpointStore` ≠ `CheckpointStore`."

---

### 5. Why is `CustomCapability` a final class instead of a record? How many total types does the sealed `Capability` interface permit? (2 pts)

**`CustomCapability` is a `final class` (not a record) because custom capabilities are constructed from runtime JSON schemas, not from compile-time record components.** Records require all component values to be known at compile time and fixed in the record's canonical constructor signature. Custom capabilities have fields that are parsed dynamically from JSON at runtime, so they need a traditional class with constructor validation and manual `equals()`/`hashCode()`/`toString()` overrides. The constructor also validates that the namespace is not `"core"` (reserved for standard capabilities).

**The sealed `Capability` interface permits exactly 16 types:** 15 standard records (OnOff, Brightness, ColorTemperature, TemperatureMeasurement, HumidityMeasurement, IlluminanceMeasurement, PowerMeasurement, BinaryState, Contact, Motion, Occupancy, Battery, DeviceHealth, EnergyMeter, PowerMeter) + 1 final class (CustomCapability). Exhaustive switches must have 16 branches.

**Source:** device-model MODULE_CONTEXT.md — Sealed Capability Hierarchy table, GOTCHA: "Capability count is 16, not 15", and Key Design Decision §2.

---

### 6. `Entity.deviceId` is nullable. Under what circumstances? Why is this not a bug? (2 pts)

**`Entity.deviceId` is nullable for helper entities** — entities not backed by physical hardware, such as virtual sensors or computed entities. These entities have `deviceId = null` because they are not associated with any physical device.

**This is not a bug because it is a deliberate design decision.** Not all entities correspond to physical hardware. The device model explicitly supports logical/virtual entities that exist independently. The nullable `deviceId` enables the system to model entities like computed averages, virtual groups, or software-defined sensors that don't have a backing device. Callers must always null-check `Entity.deviceId()` before using it.

**Source:** device-model MODULE_CONTEXT.md GOTCHA: "`Entity.deviceId` is nullable. Helper entities (entities not backed by physical hardware, such as virtual sensors or computed entities) have `deviceId = null`. This is a deliberate design decision, not a bug."

---

## Section 2: Type System Precision (10 points)

### 7. The `EventPublisher` interface — both method signatures including throws clauses. (2 pts)

```java
public interface EventPublisher {

    EventEnvelope publish(EventDraft draft, CausalContext cause)
            throws SequenceConflictException;

    EventEnvelope publishRoot(EventDraft draft)
            throws SequenceConflictException;
}
```

**Source:** EventPublisher.java lines 57, 96–97, 126–127.

---

### 8. The `EventStore` interface — all 6 method signatures with exact parameter types and return types. (3 pts)

```java
public interface EventStore {

    EventPage readFrom(long afterPosition, int maxCount);

    EventPage readBySubject(SubjectRef subject, long afterSequence, int maxCount);

    List<EventEnvelope> readByCorrelation(Ulid correlationId);

    EventPage readByType(String eventType, long afterPosition, int maxCount);

    EventPage readByTimeRange(Instant from, Instant to, long afterPosition, int maxCount);

    long latestPosition();
}
```

Note: `readByCorrelation` returns `List<EventEnvelope>` (not `EventPage`) because causal chains are bounded in practice (Doc 01 §4.5 warns at depth 50). Also note `readByTimeRange` has **4 parameters** (from, to, afterPosition, maxCount) — not 5 — combining time-range filtering with position-based pagination.

**Source:** EventStore.java lines 37–154.

---

### 9. The `EventDraft` record — all 8 component names and types in order. Which are nullable? (2 pts)

```java
public record EventDraft(
        String eventType,          // non-null, non-blank
        int schemaVersion,         // >= 1
        Instant eventTime,         // NULLABLE
        SubjectRef subjectRef,     // non-null
        EventPriority priority,    // non-null
        EventOrigin origin,        // non-null
        DomainEvent payload,       // non-null
        Ulid actorRef              // NULLABLE
) { ... }
```

**Nullable fields:** `eventTime` (null if the source has no reliable clock) and `actorRef` (null when no user is attributable, e.g., device-autonomous or system-originated events).

**Source:** EventDraft.java lines 60–69; compact constructor validates non-null for eventType, subjectRef, priority, origin, payload (lines 82–86); eventTime and actorRef are not validated for null.

---

### 10. The `SubjectRef` record — its components and all 6 static factory methods with parameter types. (2 pts)

```java
public record SubjectRef(Ulid id, SubjectType type) {

    public static SubjectRef entity(EntityId entityId) { ... }
    public static SubjectRef device(DeviceId deviceId) { ... }
    public static SubjectRef integration(IntegrationId integrationId) { ... }
    public static SubjectRef automation(AutomationId automationId) { ... }
    public static SubjectRef system(SystemId systemId) { ... }
    public static SubjectRef person(PersonId personId) { ... }
}
```

Each factory method extracts the `Ulid` from the typed ID wrapper via `.value()` and pairs it with the corresponding `SubjectType` enum constant (ENTITY, DEVICE, INTEGRATION, AUTOMATION, SYSTEM, PERSON).

**Source:** SubjectRef.java lines 38–114.

---

### 11. The `CausalContext` record — its components, both static factory methods, and the `isRoot()` method. (1 pt)

```java
public record CausalContext(
        Ulid correlationId,   // non-null
        Ulid causationId      // nullable (null for root events only)
) {

    public static CausalContext root(Ulid correlationId) {
        return new CausalContext(correlationId, null);
    }

    public static CausalContext chain(Ulid correlationId, Ulid causationId) {
        Objects.requireNonNull(causationId,
                "causationId must not be null for derived events");
        return new CausalContext(correlationId, causationId);
    }

    public boolean isRoot() {
        return causationId == null;
    }
}
```

**Source:** CausalContext.java lines 47–106.

---

## Section 3: Cross-Module Contracts (10 points)

### 12. Describe the EventPublisher's durability guarantee. What happens between `publish()` returning and subscriber notification? Cite the invariant. (2 pts)

**Durability guarantee:** `EventPublisher.publish()` is synchronous — the event is persisted to SQLite WAL and the method returns **only after the WAL commit** succeeds. The event is durable before the method returns. This is **INV-ES-04 (Write-Ahead Persistence)**.

**Between publish() returning and subscriber notification:** Subscriber notification begins **asynchronously after** the method returns. There is a temporal gap — if the system crashes between publish() returning and subscriber notification, the event is still safely persisted. On recovery, the system replays persisted-but-undelivered events to subscribers from their checkpoints. This is the core of the "event store IS the outbox" pattern (LTD-06).

**Source:** event-model MODULE_CONTEXT.md Cross-Module Contracts: "`EventPublisher.publish()` is synchronous — the event is durable before the method returns. The WAL commit happens BEFORE subscriber notification."; EventPublisher.java Javadoc lines 36–37.

---

### 13. What is the subscriber delivery model — push or pull? Describe the exact mechanism. (2 pts)

**The model is pull-based, notification-driven.** The EventBus does NOT deliver events directly to subscribers.

**Exact mechanism:**
1. After an event is persisted, `EventBus.notifyEvent(long globalPosition)` is called with the new event's global position.
2. The bus evaluates each subscriber's `SubscriptionFilter` against the event metadata.
3. For matching subscribers, the bus **wakes them via `LockSupport.unpark()`**.
4. Each subscriber (running on its own virtual thread) then **pulls events from the `EventStore`** by calling `EventStore.readFrom()` starting from their last checkpoint position.
5. After processing, the subscriber writes its updated checkpoint via `CheckpointStore`.

The bus passes only the position, not the event itself. The subscriber retrieves the full event independently. This design enables per-subscriber backpressure, crash-safe resumption (resume from checkpoint), and prevents slow subscribers from blocking fast subscribers.

**Source:** event-bus MODULE_CONTEXT.md Cross-Module Contracts: "The EventBus does NOT deliver events to subscribers. It wakes them via `LockSupport.unpark()`"; GOTCHA: "`notifyEvent(long globalPosition)` does NOT pass the event itself."

---

### 14. Which two subscribers MUST be registered with `coalesceExempt = true`? What breaks if they aren't? (2 pts)

**The two coalesce-exempt subscribers are:**
1. **State Projection** (state-store)
2. **Pending Command Ledger**

**What breaks:** Without `coalesceExempt = true`, these subscribers may miss individual DIAGNOSTIC-priority events during periods of high throughput due to backpressure coalescing. If State Projection misses events, **state will diverge from the event log** — the materialized view will be incorrect and no longer reconstructable by replaying events (violating INV-ES-02). If the Pending Command Ledger misses events, command confirmations may be missed or incorrectly evaluated, breaking the command lifecycle.

**Source:** event-bus MODULE_CONTEXT.md GOTCHA: "`coalesceExempt` is critical for correctness of certain subscribers. The State Projection and Pending Command Ledger MUST be registered with `coalesceExempt = true`."; SubscriberInfo record description.

---

### 15. Describe the ordering contract for subscriber registration at startup. What happens if events are published before subscribers register? (2 pts)

**Ordering contract:** Subscribers MUST be registered with the EventBus BEFORE the publisher starts accepting events. The startup-lifecycle module (Doc 12) coordinates this ordering.

**If events are published before subscribers register:** Those events **will not trigger notifications** — the bus has no registered subscribers to wake. However, the events are **still persisted** to the event store (durability is independent of notification). The events will be processed on the **next catch-up read** — when the subscriber eventually registers and starts polling from its checkpoint (or position 0 for a new subscriber), it will read and process all previously-persisted events. No events are lost, but there is a delay before they are consumed.

**Source:** event-bus MODULE_CONTEXT.md GOTCHA: "Subscriber registration order matters at startup. Subscribers must be registered with the EventBus BEFORE the publisher starts accepting events."

---

### 16. What is the relationship between `EntityId` and `DeviceId` in the device model? Which one do automation rules, state events, and commands reference? (2 pts)

**Relationship:** A `Device` (identified by `DeviceId`) is a **container** for one or more `Entity` instances (each identified by `EntityId`). An `Entity` is the **atomic functional unit** of a device — the thing you target with automations and commands. For example, a Zigbee smart power strip with 4 outlets is one Device with 4 Entities. Each entity has its own capabilities, state, and event stream. `EntityId` is stable across hardware replacements (INV-CS-02) — when a device is replaced, entities transfer to the new device and the `EntityId` remains unchanged; only the backing `DeviceId` changes.

**Automation rules, state events, and commands all reference `EntityId`, NOT `DeviceId`.** Entity is the atomic unit of behavior — this distinction is critical everywhere. Do not treat Device and Entity as interchangeable.

**Source:** device-model MODULE_CONTEXT.md Cross-Module Contracts: "Entity is the atomic unit of behavior, not Device. Automation targets, state events, and commands all reference `EntityId`, not `DeviceId`."; Key Design Decision §1.

---

## Section 4: Practical Implementation (16 points)

### 17. Write a method that publishes a root event and then publishes two derived events in the same causal chain. (4 pts)

```java
import com.homesynapse.event.*;
import com.homesynapse.platform.identity.*;

public EventEnvelope[] publishCausalChain(
        EventPublisher publisher,
        SubjectRef subject,
        Ulid actorRef) throws SequenceConflictException {

    // 1. Publish root event — publisher creates root CausalContext internally
    //    (correlationId = new event's own eventId, causationId = null)
    EventDraft rootDraft = new EventDraft(
            EventTypes.STATE_REPORTED,
            1,
            null,                          // eventTime nullable
            subject,
            EventPriority.DIAGNOSTIC,
            EventOrigin.PHYSICAL,
            new StateReportedEvent("temperature_c", "22.5", "°C", null, null),
            actorRef                       // actorRef on draft
    );
    EventEnvelope rootEnvelope = publisher.publishRoot(rootDraft);
    // rootEnvelope.causalContext().correlationId() == rootEnvelope.eventId().value()
    // rootEnvelope.causalContext().causationId() == null
    // rootEnvelope.causalContext().isRoot() == true

    // 2. Publish first derived event — inherit correlationId, set causationId to root's eventId
    CausalContext derivedCtx1 = CausalContext.chain(
            rootEnvelope.causalContext().correlationId(),  // correlationId from root
            rootEnvelope.eventId().value()                 // causationId = root's eventId
    );
    EventDraft derivedDraft1 = new EventDraft(
            EventTypes.STATE_CHANGED,
            1,
            null,
            subject,
            EventPriority.NORMAL,
            EventOrigin.SYSTEM,
            new StateChangedEvent("temperature_c", "21.0", "22.5",
                    rootEnvelope.eventId()),
            rootEnvelope.actorRef()       // inherit actorRef from causing event
    );
    EventEnvelope derivedEnvelope1 = publisher.publish(derivedDraft1, derivedCtx1);
    // derivedEnvelope1.causalContext().correlationId() == root's correlationId
    // derivedEnvelope1.causalContext().causationId() == root's eventId

    // 3. Publish second derived event — same correlationId, causationId = first derived's eventId
    CausalContext derivedCtx2 = CausalContext.chain(
            derivedEnvelope1.causalContext().correlationId(),  // same correlationId chain
            derivedEnvelope1.eventId().value()                 // causationId = derived1's eventId
    );
    EventDraft derivedDraft2 = new EventDraft(
            EventTypes.STATE_CONFIRMED,
            1,
            null,
            subject,
            EventPriority.NORMAL,
            EventOrigin.SYSTEM,
            new StateConfirmedEvent(
                    rootEnvelope.eventId(),
                    derivedEnvelope1.eventId(),
                    "temperature_c", "22.5", "22.5", "exact"),
            derivedEnvelope1.actorRef()   // inherit actorRef from causing event
    );
    EventEnvelope derivedEnvelope2 = publisher.publish(derivedDraft2, derivedCtx2);

    return new EventEnvelope[] { rootEnvelope, derivedEnvelope1, derivedEnvelope2 };
}
```

**Flow:**
- `correlationId` is the same across all 3 events (the root's eventId).
- `causationId` chains: null → rootEventId → derivedEvent1Id.
- `actorRef` is inherited from the causing event at each step.

---

### 18. Write a method that reads events page-by-page from `EventStore.readFrom()` until all events are consumed. (3 pts)

```java
import com.homesynapse.event.*;
import java.util.ArrayList;
import java.util.List;

public List<EventEnvelope> readAllEvents(EventStore store, long startAfter, int pageSize) {
    List<EventEnvelope> allEvents = new ArrayList<>();
    long afterPosition = startAfter;

    do {
        EventPage page = store.readFrom(afterPosition, pageSize);
        allEvents.addAll(page.events());

        afterPosition = page.nextPosition();  // cursor for next page

        if (!page.hasMore()) {
            break;
        }
    } while (true);

    return allEvents;
}
```

**Key:** `EventPage.nextPosition()` provides the cursor value to pass as `afterPosition` in the next call. `EventPage.hasMore()` indicates whether additional events exist beyond this page. When `hasMore()` is false, we've consumed all events. The page's events list may be empty if no events match.

**Source:** EventPage.java Javadoc — "Callers advance through the result set by passing `nextPosition()` as the `afterPosition` argument to the next query invocation, continuing while `hasMore()` is `true`."

---

### 19. Write a `SubscriptionFilter` that matches only NORMAL-or-higher priority `state_changed` events for ENTITY subjects. Show how `severity()` comparison works. (3 pts)

```java
import com.homesynapse.event.EventPriority;
import com.homesynapse.event.SubjectType;
import com.homesynapse.event.EventTypes;
import com.homesynapse.event.bus.SubscriptionFilter;
import java.util.Set;

SubscriptionFilter filter = new SubscriptionFilter(
        Set.of(EventTypes.STATE_CHANGED),   // only state_changed events
        EventPriority.NORMAL,               // minimum priority = NORMAL
        SubjectType.ENTITY                  // only ENTITY subjects
);
```

**How `severity()` comparison works:**

`EventPriority.severity()` returns: CRITICAL=0, NORMAL=1, DIAGNOSTIC=2. **Lower severity value = higher priority.** The filter's `matches()` method checks:

```java
envelope.priority().severity() > minimumPriority.severity()
```

If the envelope's severity is **greater** than the filter's minimum (i.e., lower priority), the event is rejected.

With `minimumPriority = NORMAL` (severity 1):
- CRITICAL (severity 0): 0 > 1 → false → **accepted** ✓
- NORMAL (severity 1): 1 > 1 → false → **accepted** ✓
- DIAGNOSTIC (severity 2): 2 > 1 → true → **rejected** ✗

**Critical:** Do NOT use `ordinal()` for comparison — it is fragile against enum reordering. Always use `severity()`.

**Source:** SubscriptionFilter.java `matches()` line 136; event-model MODULE_CONTEXT.md GOTCHA about `EventPriority.severity()`.

---

### 20. Write a test method (JUnit 5 + AssertJ) that verifies a `readBySubject` call. (3 pts)

```java
import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;

@Test
void readBySubject_multipleSubjectsExist_returnsOnlyTargetSubjectInSequenceOrder() {
    // Given: events for two different entities interleaved in the store
    SubjectRef targetSubject = SubjectRef.entity(targetEntityId);
    SubjectRef otherSubject = SubjectRef.entity(otherEntityId);

    // Publish events for both subjects (assume publisher is set up)
    // targetSubject: subjectSequence 1, 2, 3
    // otherSubject: subjectSequence 1, 2

    // When: read by target subject from the beginning
    EventPage page = eventStore.readBySubject(targetSubject, 0, 100);

    // Then: only target subject's events returned, in subjectSequence order
    assertThat(page.events())
            .isNotEmpty()
            .allSatisfy(envelope ->
                assertThat(envelope.subjectRef()).isEqualTo(targetSubject))
            .extracting(EventEnvelope::subjectSequence)
            .isSorted()
            .containsExactly(1L, 2L, 3L);

    // Verify no events from the other subject leaked through
    assertThat(page.events())
            .noneMatch(e -> e.subjectRef().equals(otherSubject));
}
```

**Source:** EventStore.java `readBySubject` Javadoc: "Returns events for the given subject with `subjectSequence > afterSequence`, ordered by `subjectSequence` ascending."

---

### 21. Given an `EventEnvelope`, show how you would construct the `CausalContext` for a derived event and propagate `actorRef`. (3 pts)

```java
// Given: the causing event's envelope
EventEnvelope causingEnvelope = /* ... */;

// Construct CausalContext for the derived event:
CausalContext derivedContext = CausalContext.chain(
        causingEnvelope.causalContext().correlationId(),  // inherit correlationId unchanged
        causingEnvelope.eventId().value()                 // causationId = causing event's eventId
);

// Construct the EventDraft, propagating actorRef from the causing envelope:
EventDraft derivedDraft = new EventDraft(
        EventTypes.STATE_CHANGED,
        1,
        null,                               // eventTime
        causingEnvelope.subjectRef(),        // same subject
        EventPriority.NORMAL,
        EventOrigin.SYSTEM,
        somePayload,
        causingEnvelope.actorRef()           // INHERIT actorRef from causing event
);

// Publish the derived event:
EventEnvelope derivedEnvelope = publisher.publish(derivedDraft, derivedContext);
// derivedEnvelope.actorRef() == causingEnvelope.actorRef() (publisher copies from draft)
```

**Key points:**
- `correlationId` is inherited from the causing event's causal context (chains through the whole graph).
- `causationId` is set to the causing event's `eventId().value()` (the Ulid, NOT the causation ID — it's the event ID of the immediate cause).
- `actorRef` is inherited from `causingEnvelope.actorRef()` and placed on the `EventDraft`. The publisher copies it from draft to envelope without transformation.

**Source:** EventPublisher.java Javadoc lines 64–75; event-model MODULE_CONTEXT.md Cross-Module Contracts: "Actor attribution flows through `EventDraft.actorRef()` → `EventEnvelope.actorRef()`."

---

## Section 5: Constraint Adherence (10 points)

### 22. Why must all concurrency use `ReentrantLock` instead of `synchronized`? Cite the locked decision. (1 pt)

**`synchronized` blocks pin virtual threads to carrier threads.** On a Raspberry Pi with 4 cores (4 carrier threads), one pinned carrier is a **25% capacity loss**. `ReentrantLock` allows the virtual thread to **unmount** while waiting, freeing the carrier thread for other virtual threads. This is documented as a project-wide constraint referenced as LTD-11 in MODULE_CONTEXT files, with the underlying rationale in LTD-01 (Java 21 virtual threads) and LTD-03 (sqlite-jdbc carrier pinning).

**Source:** platform-api MODULE_CONTEXT.md Constraints: "LTD-11 | No `synchronized` — use `ReentrantLock` for virtual thread compatibility"; LTD-01 specification: "JEP 491 (Java 25 LTS) eliminates `synchronized`-monitor pinning but does NOT eliminate JNI pinning"; platform-api Key Design Decision §2.

---

### 23. What logging framework must be used? Can a module declare SLF4J as an `api()` dependency? Why or why not? (2 pts)

**Logging framework:** **SLF4J 2.x** as the facade, **Logback 1.5.x** as the implementation, with **logstash-logback-encoder** for structured JSON output. JDK Flight Recorder (JFR) in continuous recording mode as the primary metrics source. This is **LTD-15**.

**Can a module declare SLF4J as an `api()` dependency?** Based on the event-model MODULE_CONTEXT.md dependencies table, SLF4J (`slf4j.api`) is listed as an **"API dependency for logging"** for EventPublisher and EventStore implementations. However, the JPMS module declaration for event-model only `exports com.homesynapse.event` — SLF4J's `Logger` interface is not part of the module's public API. SLF4J should generally be an `implementation` scope dependency because logging is an implementation detail. The Logger interface should not leak through a module's public API signatures. Each module should declare its own SLF4J dependency rather than relying on transitive exposure.

**Source:** LTD-15 in HomeSynapse_Core_Locked_Decisions.md; event-model MODULE_CONTEXT.md Dependencies table.

---

### 24. Name the 3 processing modes that suppress side effects during event consumption. For each, state what IS and IS NOT allowed. (3 pts)

From the `ProcessingMode` enum (event-model MODULE_CONTEXT.md):

1. **REPLAY** — State updates only, no side effects.
   - **IS allowed:** State updates (updating ConcurrentHashMap, advancing stateVersion).
   - **IS NOT allowed:** Command dispatch, notification sending, external writes, integration calls.

2. **PROJECTION** — State only.
   - **IS allowed:** Projecting/materializing state from events.
   - **IS NOT allowed:** Side effects, command dispatch, external communication.

3. **DRY_RUN** — Evaluation only, no execution.
   - **IS allowed:** Evaluating conditions, computing results, testing what would happen.
   - **IS NOT allowed:** Executing any actions, state modifications, or side effects.

(The 4th mode, **LIVE**, is the normal mode with full processing + side effects — it does NOT suppress side effects.)

**Source:** event-model MODULE_CONTEXT.md Enums table: "ProcessingMode | enum | Processing mode governing subscriber behavior during event consumption | LIVE (full processing + side effects), REPLAY (state updates only, no side effects), PROJECTION (state only), DRY_RUN (evaluation only, no execution)"; Cross-Module Contracts: "`ProcessingMode` governs side effects. Subscribers MUST check `ProcessingMode` before executing side effects."

---

### 25. An integration adapter crashes with an unhandled exception. What must happen to the core system? Cite the invariant. (1 pt)

**The core system must continue operating normally.** A crash, hang, or resource exhaustion in one integration must NOT affect the core runtime, other integrations, or the event bus. The core must continue processing events and executing automations for all unaffected integrations.

**Invariant: INV-RF-01 (Integration Isolation)** — "Each integration runs in a supervised, isolated execution context. A crash, hang, or resource exhaustion in one integration must not affect the core runtime, other integrations, or the event bus."

**Source:** Architecture_Invariants_v1.md §3 INV-RF-01.

---

### 26. You need to add a new dependency not in `libs.versions.toml`. What is the correct escalation path? Can you add it yourself? (1 pt)

**No, you cannot add it yourself.** The version catalog (`gradle/libs.versions.toml`) is the centralized dependency management artifact governed by LTD-10. Adding a new dependency that is not already in the version catalog requires following the **amendment process** defined in §18 of the Locked Technical Decisions Register. This is because new dependencies affect the entire project's dependency graph, footprint, and virtual-thread compatibility posture. The dependency must be evaluated for license compatibility, memory impact on constrained hardware (INV-PR-01), virtual thread safety (LTD-01/LTD-11), and alignment with locked decisions.

The correct escalation path is to flag it as `[REVIEW]` and escalate to the Hivemind/PM level for evaluation before adding.

**Source:** LTD-10 specification; configuration MODULE_CONTEXT.md — "`json-schema-validator` is NOT in the version catalog. This does not affect Phase 2. It MUST be added before Phase 3 implementation."

---

### 27. You discover that a Phase 2 interface needs a new method to make your implementation work. What do you do? (2 pts)

**You do NOT modify the Phase 2 interface yourself.** Phase 2 interfaces are locked design artifacts — they represent the contracts that all modules compile against. Adding a method to a published interface is a **cross-module contract change** that may affect every consumer of that interface.

The correct process is:
1. **Document the need** — write up why the existing interface is insufficient, what the new method would look like, and which modules would be affected.
2. **Escalate to the PM (Project Manager)** — the PM is the quality gate between strategy and code. The PM assesses cross-subsystem impact, verifies the change doesn't violate architecture invariants, and determines if the change is justified.
3. **If approved, the PM produces an amended interface specification** that is reviewed and locked before any implementation proceeds. The change must be reflected in the MODULE_CONTEXT.md and any affected design documents.

**Source:** nexsys-coder and nexsys-project-manager skill descriptions; Locked Decisions Register §0: "If a design requires violating a locked decision, the amendment process in §18 must be followed before the design can proceed."

---

## Section 6: Architecture Reasoning (8 points)

### 28. Why does HomeSynapse use event sourcing instead of traditional CRUD? Give at least 3 benefits for a smart home OS on a Raspberry Pi. (3 pts)

1. **Complete explainability (INV-ES-06):** "Why did the lights turn on at 3 AM?" is answerable by tracing the causal event chain. In a CRUD system, the current state is all you have — the history of how you got there is lost. This directly addresses Home Assistant's documented failure mode where debugging automation behavior requires expert-level tribal knowledge.

2. **Crash-safe recovery without data loss (INV-ES-04, INV-RF-04):** The event log is append-only with write-ahead persistence. If power fails (a normal operating condition for a Pi — INV-PD-06), recovery is simply replaying from the last checkpoint. No complex transaction recovery, no corrupted partial state. The Pi runs for years unattended; power loss must be routine, not catastrophic.

3. **State is always rebuildable (INV-ES-02):** If the state store corrupts, you replay events from the last checkpoint to rebuild it. In a CRUD system, corrupted state requires a full backup restore. On a Pi with limited storage, maintaining both events and full database backups is wasteful — with event sourcing, the events ARE the backup. The materialized views are disposable caches.

4. **Natural fit for single-writer model on constrained hardware (LTD-03):** SQLite's single-writer + unlimited-reader WAL model maps perfectly to event sourcing's single write path. On a 4-core Pi, this eliminates write contention without complex locking. The append-only pattern is also optimal for NVMe sequential writes.

**Source:** Architecture_Invariants_v1.md §2; LTD-03; LTD-06.

---

### 29. Explain the "single-writer model" (LTD-03 context). Why does only one thread write to the event store? What would go wrong with concurrent writers? (2 pts)

**Single-writer model:** All event appends flow through a single write thread (owned by the Persistence Layer's platform thread executor). Only one thread invokes SQLite write operations at a time. The executor is sized to **1 write thread** for the write connection.

**Why only one thread writes:**
- **SQLite's WAL mode allows only one writer at a time** — concurrent write attempts block on SQLite's internal write lock (busy_timeout = 5000ms). Having multiple write threads would just cause them to serialize on the lock anyway, adding contention overhead without parallelism.
- **Per-subject sequence numbers require serial assignment** — the publisher must read the current max sequence for a subject and assign the next value atomically. Concurrent writers would create race conditions on sequence assignment, causing `SequenceConflictException` or gap-free sequence violations.
- **JNI carrier pinning** — sqlite-jdbc uses `synchronized native` methods. Executing these on virtual threads pins carrier threads. The single platform write thread confines all write-side pinning to one dedicated thread.

**What would go wrong with concurrent writers:**
- Sequence conflicts (two events claiming the same subjectSequence)
- Broken global position monotonicity
- Carrier thread pool exhaustion from JNI pinning
- SQLite lock contention with no throughput benefit (SQLite serializes writes internally anyway)

**Source:** LTD-03 specification; LTD-11 specification; persistence MODULE_CONTEXT.md — executor sizing: "1 write thread (single-writer model)."

---

### 30. The EventStore uses `COALESCE(event_time, ingest_time)` for time-range queries. Why are there two time fields? When would `event_time` be null? (2 pts)

**Why two time fields:** Per **INV-ES-08 (Event Time and Ingest Time Are Distinct)**:

- **`eventTime`** — when the real-world occurrence happened, as reported by the event source. For a Zigbee temperature sensor, this is when the sensor took the reading.
- **`ingestTime`** — when the HomeSynapse event bus accepted and persisted the event. This is always the system's local clock at persistence time.

The two fields serve fundamentally different purposes. Automation triggers evaluate against **eventTime** (a 5-minute temperature window uses the time the reading was taken, not when it arrived). Retention policies operate on **eventTime**. Event log ordering and replay use **ingestTime**. The gap between them (caused by mesh routing delays, polling intervals, system load) is itself a diagnostic signal.

**When would `eventTime` be null?** When the event source has **no reliable clock** — for example, some Zigbee devices that do not report their own timestamps. The `EventEnvelope.eventTime` field and `EventDraft.eventTime` field are both documented as nullable for this reason.

`COALESCE(event_time, ingest_time)` is used in time-range queries so that events without an eventTime still appear in time-range results — falling back to the system-assigned ingestTime.

**Source:** Architecture_Invariants_v1.md §2 INV-ES-08; EventStore.java `readByTimeRange` Javadoc: "Uses `COALESCE(event_time, ingest_time)` semantics"; EventEnvelope.java `eventTime` param doc: "`null` if the source has no reliable clock."

---

### 31. Why does `EventPage` use cursor-based pagination (`afterPosition`) instead of offset-based pagination (`LIMIT/OFFSET`)? (1 pt)

**Cursor-based pagination is stable and efficient for append-only logs.** With `LIMIT/OFFSET`, if new events are appended between page requests, the offset shifts and you either miss events or see duplicates. Cursor-based pagination (`afterPosition`) is stable because each query returns events with `globalPosition > afterPosition` — new appends have higher positions and don't affect the cursor. This is essential for subscriber catch-up reads where the log is actively growing.

Additionally, `LIMIT/OFFSET` with large offsets is O(N) in SQLite (it must scan and skip N rows), while `WHERE globalPosition > ?` with an indexed column is O(log N) regardless of how deep you are in the result set.

**Source:** EventPage.java Javadoc; EventStore.java `readFrom` Javadoc: "use 0 to read from the beginning."

---

## Section 7: Java 21 Patterns (6 points)

### 32. Write a sealed interface with 3 permitted records, then write an exhaustive switch expression. What happens if you add a 4th permitted type? (2 pts)

```java
public sealed interface AttributeValue
        permits BooleanValue, IntValue, FloatValue {

    Object rawValue();
    AttributeType attributeType();
}

public record BooleanValue(boolean value) implements AttributeValue {
    public Object rawValue() { return value; }
    public AttributeType attributeType() { return AttributeType.BOOLEAN; }
}

public record IntValue(long value) implements AttributeValue {
    public Object rawValue() { return value; }
    public AttributeType attributeType() { return AttributeType.INT; }
}

public record FloatValue(double value) implements AttributeValue {
    public Object rawValue() { return value; }
    public AttributeType attributeType() { return AttributeType.FLOAT; }
}

// Exhaustive switch expression:
String describe(AttributeValue val) {
    return switch (val) {
        case BooleanValue bv -> "boolean: " + bv.value();
        case IntValue iv     -> "int: " + iv.value();
        case FloatValue fv   -> "float: " + fv.value();
    };
}
```

**If you add a 4th permitted type** (e.g., `StringValue`): **every exhaustive switch expression over `AttributeValue` will fail to compile.** The Java compiler (JEP 441, Java 21) enforces that pattern matching switches over sealed types cover all permitted subtypes. The compiler error forces you to update every switch — this is the primary benefit of sealed hierarchies for correctness.

---

### 33. Show the typed ULID wrapper pattern (LTD-04) by writing a new ID type `AutomationRunId`. (2 pts)

```java
package com.homesynapse.platform.identity;

import java.util.Objects;

/**
 * Typed identifier for an automation run instance.
 *
 * @param value the underlying ULID, never {@code null}
 */
public record AutomationRunId(Ulid value) implements Comparable<AutomationRunId> {

    /**
     * Validates the underlying ULID is non-null.
     */
    public AutomationRunId {
        Objects.requireNonNull(value, "AutomationRunId value must not be null");
    }

    /**
     * Creates an AutomationRunId from an existing Ulid.
     */
    public static AutomationRunId of(Ulid value) {
        return new AutomationRunId(value);
    }

    /**
     * Parses an AutomationRunId from a 26-character Crockford Base32 string.
     */
    public static AutomationRunId parse(String text) {
        return new AutomationRunId(Ulid.parse(text));
    }

    @Override
    public int compareTo(AutomationRunId other) {
        return this.value.compareTo(other.value);
    }

    @Override
    public String toString() {
        return value.toString();
    }
}
```

This follows the exact pattern of `DeviceId`, `EntityId`, `IntegrationId`, etc. in the platform-api identity package: single-field record wrapping `Ulid`, `of()` factory, `parse()` factory, `Comparable` delegation to `Ulid.compareTo()`.

**Source:** platform-api MODULE_CONTEXT.md typed ID wrapper inventory.

---

### 34. Why does HomeSynapse prefer `Stream<T>` over `List<T>` for large result sets? Relate to Pi 4's 4GB RAM. (2 pts)

**`Stream<T>` enables lazy, pull-based evaluation** — elements are computed on demand and do not all need to reside in memory simultaneously. With `List<T>`, the entire result set must be materialized in heap memory before any processing begins. On a Raspberry Pi 4 with 4 GB RAM (JVM limited to ~1.5 GB by `-Xmx1536m`), materializing a large result set as a `List` risks:

- **Heap exhaustion** — a list of 100,000 event envelopes (~500 bytes each = ~50 MB) consumes a significant fraction of available heap.
- **GC pressure** — large transient lists trigger G1GC collections, potentially violating the 100ms pause target (LTD-01).

With `Stream<T>`, the persistence layer can use JDBC `ResultSet` cursor iteration, processing one row at a time. The memory footprint is O(1) per element rather than O(N) for the full result set. This is critical for operations like:
- Event replay during startup (potentially millions of events)
- Retention sweeps scanning large time ranges
- Telemetry queries across long periods

The constrained heap means every unnecessary `List` materialization competes with the state store's `ConcurrentHashMap`, SQLite's page cache, and Jackson's serialization buffers.

**Source:** LTD-01 JVM configuration (`-Xmx1536m`); INV-PR-03 (bounded and predictable resource usage).

---

## Section 8: Error Handling and Edge Cases (8 points)

### 35. `SequenceConflictException` extends `Exception`, not `HomeSynapseException`. Why is it a separate hierarchy? What does the caller do when it catches one? (2 pts)

**Why separate:** `SequenceConflictException` is an **optimistic concurrency signal**, not a domain error. It has fundamentally different semantics from `HomeSynapseException` subclasses:

- `HomeSynapseException` subclasses (EntityNotFoundException, CapabilityMismatchException, etc.) represent **domain-level errors** that carry `errorCode()` and `suggestedHttpStatus()` for API translation. They are application-level problems.
- `SequenceConflictException` represents a **constraint violation** — two events attempted to claim the same sequence number for the same subject. It is an infrastructure-level signal that the caller must handle explicitly with retry logic. It predates the `HomeSynapseException` hierarchy and has different recovery semantics.

**What the caller does:** The caller should **not retry with the same sequence number**. The publisher implementation should read the current maximum sequence for the subject and re-derive the next value. Under the single-writer model (LTD-03), this should only occur if the publisher computes an incorrect sequence or the store is corrupted — it's a safety net, not a normal flow.

**Source:** SequenceConflictException.java Javadoc; event-model MODULE_CONTEXT.md: "Separate from HomeSynapseException — this is an optimistic concurrency signal, not a domain error."

---

### 36. What is a `DegradedEvent`? When is it produced? How does it affect subscribers? (2 pts)

**What:** `DegradedEvent` is a record implementing `DomainEvent` that wraps events whose payload **could not be upcast to the current schema version** by the upcaster pipeline. It preserves the original event type, schema version, raw JSON payload, and the failure reason for forensic investigation.

**When produced:** Only in **lenient mode**, used by diagnostic tools (trace viewer, export utilities). Core projections (State Store, Automation Engine, Pending Command Ledger) run in **strict mode** — a failed upcast halts processing and never produces a `DegradedEvent`.

Fields: `eventType` (String), `schemaVersion` (int), `rawPayload` (String), `failureReason` (String).

**How it affects subscribers:** In lenient mode, the `DegradedEvent` is placed as the `payload` inside a normal `EventEnvelope` and returned to the caller. Subscribers processing events must handle the case where `envelope.payload()` is a `DegradedEvent` instance — they should either skip it, log a warning, or display diagnostic information. In strict mode, subscribers never see `DegradedEvent` because the upcast failure halts processing before delivery.

**Source:** DegradedEvent.java Javadoc; event-model MODULE_CONTEXT.md type inventory.

---

### 37. An event's `actorRef` is `null`. Is this an error? What does it mean? Give 2 examples. (2 pts)

**It is NOT an error.** A null `actorRef` means **no user or actor is attributable to this event** — the event was produced by the system autonomously or by a device without user intervention.

**Two examples of events with null actorRef:**

1. **`SystemStartedEvent`** — The HomeSynapse process starts up. This is a system lifecycle event with `EventOrigin.SYSTEM`. No user triggered the startup (or if they did via CLI, the system event itself is system-originated). `actorRef` is null.

2. **`StateReportedEvent` from a device-autonomous temperature sensor** — A Zigbee temperature sensor periodically reports readings on its own schedule. This has `EventOrigin.DEVICE_AUTONOMOUS`. No user commanded the reading — the sensor did it autonomously. `actorRef` is null.

Other examples: `AvailabilityChangedEvent` when a device goes offline (no user action), `StoragePressureChangedEvent` (system-detected condition).

**Source:** EventEnvelope.java `actorRef` param doc: "`null` when no user is attributable (e.g., device-autonomous or system-originated events)"; event-model MODULE_CONTEXT.md: "actorRef is nullable — null for system/autonomous events."

---

### 38. `EventEnvelope.categories()` returns an unmodifiable list. What exception is thrown if a consumer tries to add to it? Why is this defensive copy necessary? (2 pts)

**Exception thrown:** `UnsupportedOperationException`. The `categories` list is defensively copied via `List.copyOf()` in the compact constructor (line 158 of EventEnvelope.java: `categories = List.copyOf(categories);`). `List.copyOf()` returns an unmodifiable list — any mutating operation (`add()`, `remove()`, `set()`, `clear()`, etc.) throws `UnsupportedOperationException`.

**Why the defensive copy is necessary:** Without it, a caller who retains a reference to the original mutable list could modify the categories after the `EventEnvelope` is constructed. Since `EventEnvelope` is a record and intended to be **immutable** (events are immutable facts per INV-ES-01), any external mutation would violate this invariant. The defensive copy ensures that once an envelope is constructed, its categories cannot be altered — regardless of what the caller does with the list they originally passed in. This is the same pattern used for `EventPage.events()` and `SubscriptionFilter.eventTypes()`.

**Source:** EventEnvelope.java compact constructor line 158; event-model MODULE_CONTEXT.md GOTCHA: "`EventPage.events()` returns an unmodifiable list. `List.copyOf()` is used. Attempting to modify throws `UnsupportedOperationException`."
