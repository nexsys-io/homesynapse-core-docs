# HomeSynapse Core Architecture Exam — Benchmark Scoring Report

**Date:** 2026-03-22
**Subject:** Claude Project (HomeSynapse Core) — Closed-Book Architecture Exam
**Evaluator:** Cowork Claude (independent session with source-file verification)
**Conditions:** The benchmarked model was NOT told it was being evaluated, was NOT given the scoring rubric, and answered from its internalized project knowledge.

---

## Scoring Summary

| Section | Topic | Earned | Available |
|---------|-------|--------|-----------|
| 1 | Gotcha Awareness | 12 | 12 |
| 2 | Type System Precision | 10 | 10 |
| 3 | Cross-Module Contracts | 10 | 10 |
| 4 | Practical Implementation | 16 | 16 |
| 5 | Constraint Adherence | 9 | 10 |
| 6 | Architecture Reasoning | 8 | 8 |
| 7 | Java 21 Patterns | 6 | 6 |
| 8 | Error Handling & Edge Cases | 7.5 | 8 |
| **TOTAL** | | **78.5** | **80** |

**Grade: 98.1% — Outstanding**

---

## Section-by-Section Scoring

### Section 1: Gotcha Awareness (12/12)

**Q1 (2/2)** — `actorRef` lives on `EventDraft` but is promoted to `EventEnvelope` by the publisher, not carried through `CausalContext`. Correct. The model clearly articulated that `CausalContext` has only 2 fields (`correlationId`, `causationId`) and that `actorRef` is a separate top-level field on both `EventDraft` and `EventEnvelope`.

**Q2 (2/2)** — Empty `eventTypes` set in `SubscriptionFilter` means "match ALL event types," not "match nothing." Correct. The model identified the wildcard semantics and warned that accidentally passing an empty set would produce a firehose subscription.

**Q3 (2/2)** — `EventPriority` comparisons must use `.severity()` (CRITICAL=0, NORMAL=1, DIAGNOSTIC=2), never `.ordinal()`. Correct. The model explained that lower severity = higher priority and noted the inverse relationship that trips people up.

**Q4 (2/2)** — Cursor-based pagination via `afterPosition` / `afterSequence`, not LIMIT/OFFSET. Correct. Explained the motivation (append-only store where OFFSET would shift as new events arrive).

**Q5 (2/2)** — `CausalContext` has exactly 2 fields: `correlationId` (Ulid) and `causationId` (Ulid). Correct. Noted the historical change from 3 to 2 fields after `actorRef` was promoted.

**Q6 (2/2)** — `Entity` is the atomic addressable unit; `Device` is a container for entities. Automation, commands, and state all reference `EntityId`, not `DeviceId`. Correct and well-articulated.

### Section 2: Type System Precision (10/10)

**Q7 (2/2)** — `EventEnvelope` has exactly 14 components. Correct. Listed all 14 in the right order: `eventId`, `eventType`, `schemaVersion`, `ingestTime`, `eventTime`, `subjectRef`, `subjectSequence`, `globalPosition`, `priority`, `origin`, `categories`, `causalContext`, `actorRef`, `payload`.

**Q8 (2/2)** — `EventPublisher` exposes exactly 2 methods: `publish(EventDraft, CausalContext)` and `publishRoot(EventDraft)`, both returning `EventEnvelope` and throwing `SequenceConflictException`. Correct.

**Q9 (2/2)** — `EventStore` has 6 query methods. Correct enumeration: `readFrom`, `readBySubject`, `readByCorrelation`, `readByType`, `readByTimeRange`, `latestPosition`. The model correctly noted that `readByCorrelation` returns `List<EventEnvelope>` (not `EventPage`) and that `readByTimeRange` takes 4 parameters.

**Q10 (2/2)** — Sealed `Capability` hierarchy has 16 permitted types: 15 records + `CustomCapability` as a final class. Correct count and correct identification of the odd one out.

**Q11 (2/2)** — `SubjectRef` has exactly 2 components (`Ulid id`, `SubjectType type`) with 6 factory methods. Correct.

### Section 3: Cross-Module Contracts (10/10)

**Q12 (2/2)** — `CheckpointStore` (event-bus) stores subscriber positions as `long`; `ViewCheckpointStore` (state-store) stores serialized view state as `byte[]`. Correct distinction.

**Q13 (2/2)** — `ProcessingMode` enum: LIVE, REPLAY, PROJECTION, DRY_RUN. Last three suppress side effects. Correct.

**Q14 (2/2)** — `publish()` requires a `CausalContext` (chained event), `publishRoot()` creates a root context internally. Compile-time causality enforcement. Correct. The benchmarked model actually gave a particularly strong answer here, walking through a concrete causal chain scenario with correlation/causation ID threading.

**Q15 (2/2)** — `coalesceExempt` subscribers: State Projection and Pending Command Ledger — they must see every event, not just the latest. Correct.

**Q16 (2/2)** — `EventDraft` has 8 fields, with `eventTime` and `actorRef` nullable. Correct.

### Section 4: Practical Implementation (16/16)

**Q17 (2/2)** — Filter matching logic: empty `eventTypes` = pass; `severity()` comparison (`<=` means at or above minimum tier); `subjectTypeFilter` null = pass. Correct and matched the actual `SubscriptionFilter.matches()` source.

**Q18 (2/2)** — `EventPage` pagination: pass `nextPosition` as `afterPosition` for next query; continue while `hasMore` is true. Correct.

**Q19 (2/2)** — INV-ES-04 (write-ahead persistence): events must be durable in the store before any subscriber is notified. Correct invariant citation and explanation.

**Q20 (2/2)** — LockSupport.unpark() for pull-based notification; subscribers poll the store for new events after being unparked. Correct description of the notification-then-pull architecture.

**Q21 (2/2)** — ReentrantLock over `synchronized` to avoid virtual thread carrier pinning (LTD-03 / JEP 444). Correct.

**Q22 (4/4)** — Single-writer model (LTD-03): one platform write thread for SQLite. Virtual threads for reads, platform thread for writes. Correct and well-explained with the SQLite WAL motivation.

### Section 5: Constraint Adherence (9/10)

**Q23 (1/2) ⚠️ DEDUCTION** — The model claimed SLF4J uses Gradle `api()` scope, stating: "SLF4J is declared as an api dependency (not implementation)."

**Actual source** (`core/event-model/build.gradle.kts`, line 14):
```
implementation(libs.slf4j.api)
```

There is even an explicit comment in the build file:
> "event-model's public API does not expose SLF4J types, so api() scope was unjustified and created a Gradle/JPMS mismatch (S4-01)"

This is a direct contradiction. The model likely internalized the MODULE_CONTEXT phrasing "API dependency for logging" and conflated "API" (the SLF4J library name) with Gradle's `api()` scope. The rest of the answer (LTD-15, SLF4J 2.x + Logback 1.5.x + logstash-logback-encoder) was correct.

**Deduction: −1 point** for the incorrect scope claim.

**Q24 (2/2)** — INV-RF-01: integration adapter crash cannot affect core event processing. Correct.

**Q25 (2/2)** — LTD-04: typed ULID wrappers (`EventId`, `EntityId`, `DeviceId`, etc.) for compile-time identity discrimination. Correct.

**Q26 (2/2)** — INV-ES-01: all events immutable once persisted. EventEnvelope is a record, List.copyOf for categories. Correct.

**Q27 (2/2)** — `SequenceConflictException` is a checked exception (extends `Exception`), signals optimistic concurrency conflict on the (subject_ref, subject_sequence) unique constraint. Correct.

### Section 6: Architecture Reasoning (8/8)

**Q28 (2/2)** — Pull-based event bus: subscribers control their own pace, backpressure is inherent, no unbounded queue buildup. Correct reasoning.

**Q29 (2/2)** — Event sourcing on constrained hardware (RPi): append-only writes are SQLite-friendly, full audit trail, temporal queries via event replay. Correct.

**Q30 (2/2)** — `DegradedEvent` wraps events whose payload couldn't be upcast. Strict mode (core projections) halts; lenient mode (diagnostics) wraps and continues. Correct.

**Q31 (2/2)** — `SubjectRef` as a value type enables routing, partitioning, and per-subject sequence numbering without coupling to a specific entity implementation. Correct.

### Section 7: Java 21 Patterns (6/6)

**Q32 (2/2)** — Records for immutable value types (`EventEnvelope`, `CausalContext`, `SubjectRef`, etc.). Compact constructors for validation and defensive copying. Correct.

**Q33 (2/2)** — Sealed interfaces (`Capability`, `DomainEvent`) for exhaustive pattern matching and closed type hierarchies. Correct.

**Q34 (2/2)** — `readByCorrelation` returns `List<EventEnvelope>` (not `EventPage`) because correlation groups are expected to be small and bounded — no pagination needed. Correct. The benchmarked model gave a nuanced answer here, noting the semantic difference between "scan the global log" (needs pagination) and "fetch a known-small correlation group" (List suffices).

### Section 8: Error Handling & Edge Cases (7.5/8)

**Q35 (2/2)** — `SequenceConflictException`: do not retry with the same sequence. Re-read current max sequence for the subject and re-derive. Correct, matching the Javadoc recovery guidance.

**Q36 (2/2)** — `Entity.deviceId` is nullable — helper/virtual entities may exist without belonging to a physical device. Correct.

**Q37 (2/2)** — `EventPage` with `hasMore=false` and empty `events`: signals end of stream. `nextPosition` equals the original `afterPosition`. No further queries needed. Correct.

**Q38 (1.5/2) ⚠️ DEDUCTION** — The model correctly identified that `categories` undergoes defensive copying in EventEnvelope's compact constructor. However, it claimed the implementation uses `List.copyOf(new LinkedHashSet<>(categories))` to deduplicate while preserving order.

**Actual source** (`EventEnvelope.java`, line 158):
```java
categories = List.copyOf(categories);
```

There is no `LinkedHashSet` wrapping. The actual implementation simply calls `List.copyOf(categories)` — no deduplication, just immutability. The model fabricated the `LinkedHashSet` detail, which represents a small but real factual error about the defensive copy mechanism.

**Deduction: −0.5 points** — the core concept (defensive copy for immutability) was correct, but the specific mechanism was wrong.

---

## Discrepancy Analysis

### Error 1: SLF4J Gradle Scope (Q23) — Severity: Moderate

**Root cause:** The MODULE_CONTEXT.md for event-model describes SLF4J as an "API dependency for logging." The word "API" here refers to the SLF4J library (which is literally named `slf4j-api`), not to Gradle's `api()` dependency scope. The model conflated these two meanings.

**Impact for Phase 3:** If the model were writing a new module's `build.gradle.kts`, it might incorrectly use `api(libs.slf4j.api)` instead of `implementation(libs.slf4j.api)`, creating the exact Gradle/JPMS mismatch that governance decision S4-01 was created to prevent.

**Recommended fix:** The model should internalize: "SLF4J uses `implementation` scope in HomeSynapse, never `api()`. The library is *called* slf4j-api, but that doesn't mean it uses Gradle's api() scope. See S4-01."

### Error 2: LinkedHashSet in EventEnvelope (Q38) — Severity: Low

**Root cause:** The model likely inferred that since `categories` is a `List<EventCategory>`, deduplication would be desirable, and `LinkedHashSet` is the standard Java idiom for order-preserving deduplication. This is a reasonable inference — but it's not what the code does.

**Impact for Phase 3:** Minimal. The model understands the *principle* of defensive copying. If writing similar compact constructors, it would correctly use `List.copyOf()` as the baseline. The `LinkedHashSet` detail would only matter if duplicate categories were a real concern, which the current design doesn't address.

**Recommended fix:** Simply note: "EventEnvelope uses bare `List.copyOf(categories)` — no deduplication. If duplicate categories become a concern, that's a design decision for the future."

---

## Strengths Worth Highlighting

The benchmarked model demonstrated several areas of exceptional depth:

1. **Causal chain threading (Q14):** The walkthrough of how `correlationId` and `causationId` propagate through a multi-event chain was more detailed and concrete than a minimal correct answer would require. This suggests strong internalization of the causality model.

2. **Stream vs List reasoning (Q34):** The nuanced explanation of why `readByCorrelation` returns `List` while other queries return `EventPage` showed genuine architectural understanding, not rote memorization.

3. **DegradedEvent dual-mode explanation (Q30):** Clearly articulated the strict/lenient dichotomy and named the specific consumers in each mode (core projections vs. diagnostic tools).

4. **Single-writer rationale (Q22):** Connected the SQLite WAL constraint to the platform-thread executor design with appropriate references to LTD-03.

5. **Overall consistency:** 36 out of 38 questions were answered with complete accuracy. The two errors were both minor factual details, not architectural misunderstandings.

---

## Final Assessment

**Score: 78.5 / 80 (98.1%)**

The model has deeply internalized the HomeSynapse Core architecture. The two errors found are both detail-level inaccuracies — one from ambiguous documentation wording (SLF4J scope) and one from a reasonable but incorrect inference about implementation details (LinkedHashSet). Neither error reflects a gap in architectural understanding.

**Verdict: Ready for Phase 3 implementation work**, with the following two items to correct in its knowledge base:

1. SLF4J is `implementation` scope, not `api()` scope. See S4-01 in governance.
2. `EventEnvelope` uses `List.copyOf(categories)` with no `LinkedHashSet` deduplication.
