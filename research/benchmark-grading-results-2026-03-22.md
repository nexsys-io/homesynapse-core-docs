# HomeSynapse Core Agent Benchmark — Grading Results

**Date:** 2026-03-22
**Model under test:** Claude (via Cowork with nexsys-coder skill)
**Graded by:** Hivemind (manual source verification)

---

## Final Score: 71.5 / 80 (89.4%) — PASS

Passing threshold was 68/80 (85%). The model passes overall but has two critical errors in Section 5 that warrant attention before Phase 3 work begins.

---

## Section 1: Gotcha Awareness (11.5 / 12)

**Q1 (2/2).** Correct. 14 fields, actorRef promoted from CausalContext, INV-MU-01 reasoning. The additional context about INV-TO-01 and INV-ES-06 is accurate and shows deep understanding of why the promotion matters beyond just indexing.

**Q2 (2/2).** Correct. 2 fields, correlationId + causationId, null only for root events. Clean, precise answer.

**Q3 (2/2).** Correct. Empty set = wildcard (all types). Good explanation of the intuition mismatch. The note about how `matches()` works internally adds useful implementation insight.

**Q4 (2/2).** Correct. CheckpointStore in event-bus (subscriberId → long), ViewCheckpointStore in state-store (viewName → position + data blob). The additional detail about CheckpointRecord's 5 fields (including `projectionVersion` per AMD-10) is accurate and goes beyond what the answer key expected — this is a strength.

**Q5 (2/2).** Correct. Runtime JSON schemas prevent record usage. 16 types total (15 records + 1 final class). Named all 15 standard capabilities correctly.

**Q6 (1.5/2).** Correct on the core answer: nullable for helper entities (virtual sensors, computed entities), deliberate design decision. **Minor deduction:** The answer says "they have capabilities, produce state events, can be targets of automations" — this is reasonable inference but not directly documented in the gotcha text. The gotcha says only "entities not backed by physical hardware, such as virtual sensors or computed entities." Stating inferred behavioral properties as fact without hedging is a pattern to watch.

**Articulation note for Section 1:** Strong overall. Answers are well-structured with clear claim → evidence → source citation pattern. One minor tendency: when the model is very confident, it adds details from MODULE_CONTEXT cross-references that go slightly beyond the specific question asked. This is generally positive (shows deep reading) but occasionally introduces uncited embellishments.

---

## Section 2: Type System Precision (10 / 10)

**Q7 (2/2).** Exact match. Both signatures correct including throws clauses. Good supplementary explanation of the 1-param vs 2-param distinction.

**Q8 (3/3).** Exact match. All 6 signatures correct. Correctly identifies `readByCorrelation` returning `List<EventEnvelope>` not `EventPage`, and `readBySubject` taking `long afterSequence` not `int`. These are the two highest-risk mistakes and the model got both right.

**Q9 (2/2).** All 8 components correct in order with correct types. Correctly identifies `eventTime` and `actorRef` as the two nullable fields. The citation of INV-ES-08 for eventTime nullability is accurate — I verified INV-ES-08 is "Event Time and Ingest Time Are Distinct."

**Q10 (2/2).** Components and all 6 factory methods correct with exact parameter types.

**Q11 (1/1).** Components, both factories, and isRoot() all correct. The inclusion of the compact constructor validation logic (requireNonNull on correlationId, requireNonNull on causationId in chain()) shows the model read the actual source, not just the MODULE_CONTEXT summary.

**Articulation note for Section 2:** Excellent precision. The model clearly read the source files rather than paraphrasing from MODULE_CONTEXT. The code blocks are compilable. No fabricated method names or parameter types.

---

## Section 3: Cross-Module Contracts (10 / 10)

**Q12 (2/2).** Correct on the durability guarantee and INV-ES-04. The sequence description (WAL commit → return → async notification) is accurate. The AMD-01 citation is verified correct ("EventPublisher.publish() Durability Contract"). **Minor style note:** The answer embellishes with implementation details about "platform thread write executor" and "virtual thread parks" (AMD-26/27 context) — these are Phase 3 implementation plans, not current interface contracts. The embellishment is *technically accurate* (the amendments exist) but blurs the line between "what the interface contract guarantees" and "how we plan to implement it." In a Phase 3 implementation context this would be fine; in a pure contract discussion it's slightly overstepping.

**Q13 (2/2).** Correct. Pull-based, notification via LockSupport.unpark(), subscriber pulls via EventStore.readFrom(). All four benefits listed (backpressure, isolation, crash recovery, no buffering) are accurate.

**Q14 (2/2).** Correct. State Projection and Pending Command Ledger. Correct explanation of what breaks (missed DIAGNOSTIC events → state divergence).

**Q15 (2/2).** Correct. Registration before publisher accepts events. Events published before registration are persisted but don't trigger notifications — caught up on next read. Doc 12 coordinates ordering.

**Q16 (2/2).** Correct. Entity is atomic unit, Device is container. EntityId referenced by automations/state/commands. DeviceId for lifecycle events. INV-CS-02 for hardware replacement stability.

**Articulation note for Section 3:** Very strong. The answers demonstrate understanding of *why* the contracts exist, not just *what* they are. The Q12 embellishment is the only concern — it's a pattern where the model fills in implementation details from amendment documents as if they're established facts. This could be problematic in Phase 3 if the model treats planned implementation approaches as locked decisions.

---

## Section 4: Practical Implementation (15 / 16)

**Q17 (4/4).** Code is correct. Shows proper CausalContext.chain() usage with correlationId inheritance and causationId pointing to the immediately preceding event. actorRef propagation from root through derived events is correct. Using real event types (command_issued → command_dispatched → command_result) shows domain understanding.

**Q18 (3/3).** Correct pagination loop. Proper use of nextPosition() and hasMore(). Clean, minimal code.

**Q19 (3/3).** Correct SubscriptionFilter construction. Good explanation of severity() comparison mechanics. The comment block showing the severity values and comparison logic is pedagogically strong.

**Q20 (3/3).** Good test method. Follows naming convention. Creates two subjects, publishes to both, queries one, asserts filtering and ordering. The use of `extracting(EventEnvelope::subjectSequence).containsExactly(1L, 2L, 3L)` is clean AssertJ.

**Q21 (2/3).** Core pattern is correct: CausalContext.chain() with correlationId from causing event's causal context and causationId from causing event's eventId. actorRef inheritance is correct. **Deduction:** The answer uses `Instant.now()` for eventTime in the derived draft. This is not *wrong* per se, but it's inconsistent with best practices for a derived event. Derived events are produced by subscribers processing events — the eventTime should either be null (if the subscriber has no independent time source) or the causing event's eventTime (if the derived event represents the same real-world occurrence). Using `Instant.now()` would set eventTime to the processing time, which conflates ingest time semantics with event time semantics. A production implementation would either pass null or pass `causingEvent.eventTime()`. This matters because it affects time-range query correctness (COALESCE semantics). The answer key didn't flag this but it's a real correctness concern.

**Articulation note for Section 4:** Code quality is high. The model writes idiomatic Java 21 with var declarations, correct use of the factory methods, and proper exception handling (throws clauses on methods). The Q21 issue is subtle — it's the kind of thing that would compile cleanly and pass basic tests but produce incorrect behavior in time-range queries.

---

## Section 5: Constraint Adherence (7 / 10)

**Q22 (1/1).** Correct. synchronized pins virtual threads to carrier threads. LTD-11 cited. Good additional context about JNI double-pinning (AMD-26) and JEP 491 not fixing JNI pinning.

**Q23 (0/2). WRONG.** The answer claims: "SLF4J **is** declared as `api()` scope on `event-model`'s `build.gradle.kts`." This is factually incorrect. The actual `event-model/build.gradle.kts` reads:

```
implementation(libs.slf4j.api)
```

...with an explicit comment: "SLF4J is per-module (DECIDE-01, 2026-03-20). Each module that uses logging declares its own implementation dependency. event-model's public API does not expose SLF4J types, so api() scope was unjustified and created a Gradle/JPMS mismatch (S4-01)."

The model read stale handoff documents (block-d and block-e, which reference the old `api()` scope) instead of the actual current source file. This is a **critical reliability failure** — the model trusted secondary documentation over primary source code. The correct answer: SLF4J is `implementation` scope, not `api()`, and each module declares its own dependency. The benchmark answer key specifically tests for this.

**This error demonstrates the exact failure mode the benchmark was designed to catch: reading cached/stale references instead of the authoritative source.**

**Q24 (3/3).** Correct. REPLAY, PROJECTION, DRY_RUN all accurately described. Verified against `ProcessingMode.java` source — the descriptions match the Javadoc exactly.

**Q25 (1/1).** Correct. INV-RF-01 cited. Core continues operating. OTP-style supervision mentioned.

**Q26 (1/1).** Correct. Cannot add unilaterally. Escalate to Hivemind. Good additional context about JAR size monitoring.

**Q27 (2/2).** Correct process: document the need, draft amendment, escalate, get approval before modifying. The "cardinal rule: no implementation precedes specification" framing is accurate.

**Articulation note for Section 5:** The Q23 error is the most concerning finding in this benchmark. The model's answer is confident and detailed — it doesn't hedge or express uncertainty — which makes the error worse. It built a plausible-sounding explanation around a wrong fact. The stale handoff documents (block-d, block-e) do say `api(libs.slf4j.api)`, but the actual code was changed by DECIDE-01 on 2026-03-20 and the comment explains why. **Lesson for Phase 3: always verify build.gradle.kts source directly, never trust handoff documents for dependency scope.**

---

## Section 6: Architecture Reasoning (8 / 8)

**Q28 (3/3).** Three strong benefits: auditability/causal tracing (INV-ES-06), crash recovery from checkpoints (INV-RF-04 — verified correct), bounded storage with priority retention (INV-RF-05, INV-PR-03 — both verified correct). The fourth benefit (deterministic automation replay, INV-TO-02 — verified correct) adds value.

**Q29 (2/2).** Correct on single-writer model. Three failure modes identified: sequence integrity race, SQLITE_BUSY contention, carrier pinning. Good point that serialized writes are not a limitation given the ~100 events/sec throughput requirement vs SQLite's capacity.

**Q30 (2/2).** Correct. Two distinct time fields with clear semantics. Good examples of when eventTime is null (Zigbee devices without timestamps, battery sensors, batched reconnection reports). COALESCE logic explained correctly.

**Q31 (1/1).** All three reasons correct: O(N) vs O(M+N) performance, correctness under concurrent appends, crash-safe checkpoint simplicity. Well articulated.

**Articulation note for Section 6:** This is the model's strongest section. Answers demonstrate genuine architectural reasoning, not just fact recall. The connection between constraints and their consequences is well-drawn. The Q29 answer about throughput headroom is the kind of quantitative reasoning that builds confidence in implementation decisions.

---

## Section 7: Java 21 Patterns (6 / 6)

**Q32 (2/2).** Correct sealed interface, correct exhaustive switch, correct explanation of compiler enforcement. Good connection to HomeSynapse's actual sealed hierarchies (Capability 16 branches, AttributeValue 5 branches, Expectation 4 branches).

**Q33 (2/2).** Correct typed ULID wrapper following the exact EventId/EntityId pattern. Record definition, of() factory, parse() factory, Comparable implementation, toString() — all match the established pattern. Good note about Ulid.compareTo using unsigned comparison.

**Q34 (2/2).** Correct lazy-vs-materialized tradeoff for 4GB RAM. Good nuance: acknowledges that the current Phase 2 interfaces use List (bounded by maxCount and chain depth), and that Stream applies to future bulk operations. This shows the model understands when the pattern matters and when it doesn't, rather than applying it dogmatically.

---

## Section 8: Error Handling and Edge Cases (7 / 8)

**Q35 (2/2).** Correct. Separate from HomeSynapseException because it's an optimistic concurrency signal, not a domain error. Correct recovery guidance (publisher re-derives, not caller retry).

**Q36 (2/2).** Correct. DegradedEvent wraps failed upcasts. Lenient mode. 4 fields correct. Subscriber handling described accurately.

**Q37 (2/2).** Correct. Not an error. Null means no attributable user. Good examples: device-autonomous state report, system lifecycle event.

**Q38 (1/2). PARTIALLY WRONG.** The core answer is correct: `UnsupportedOperationException` from `List.copyOf()`, defensive copy for INV-ES-01 immutability. **However, the answer fabricates a detail:** it claims the compact constructor uses `List.copyOf(new LinkedHashSet<>(categories))` for deduplication. The actual source code (verified at line 158 of EventEnvelope.java) simply reads:

```java
categories = List.copyOf(categories);
```

There is no `LinkedHashSet` wrapping. No deduplication. The model invented this detail — likely by conflating information from a MODULE_CONTEXT description or a handoff document with the actual source. The `List.copyOf()` is purely for immutability, not deduplication.

**This is the same failure pattern as Q23: the model introduces fabricated specifics with high confidence.** In this case the fabrication is less consequential (it doesn't affect how you'd write code against the interface), but it's the same root cause — generating plausible-sounding details that aren't in the source.

---

## Summary Scorecard

| Section | Points | Max | % |
|---|---|---|---|
| 1. Gotcha Awareness | 11.5 | 12 | 95.8% |
| 2. Type System Precision | 10 | 10 | 100% |
| 3. Cross-Module Contracts | 10 | 10 | 100% |
| 4. Practical Implementation | 15 | 16 | 93.8% |
| 5. Constraint Adherence | 7 | 10 | 70% |
| 6. Architecture Reasoning | 8 | 8 | 100% |
| 7. Java 21 Patterns | 6 | 6 | 100% |
| 8. Error Handling | 7 | 8 | 87.5% |
| **TOTAL** | **74.5** | **80** | **93.1%** |

---

## Critical Findings

### Finding 1: Stale Source Preference (Q23 — HARD FAIL in isolation)

The model read stale handoff documents over the actual build.gradle.kts when answering about SLF4J dependency scope. The handoff files (written weeks ago) said `api()` but the code was changed to `implementation()` by DECIDE-01 on 2026-03-20 with an explicit comment explaining why. The model then built a confident, detailed explanation around the wrong fact.

**Risk for Phase 3:** If the model reads a handoff document that describes a planned approach and the actual code has since diverged, it may write code against the stale specification.

**Mitigation:** Coding instructions should explicitly state: "Read the actual source file for dependency scopes and module configuration. Do not rely on handoff documents for build.gradle.kts content."

### Finding 2: Confident Fabrication (Q38)

The model invented the `LinkedHashSet` deduplication wrapper in EventEnvelope's compact constructor. This detail doesn't exist in the source code. The model presented it as fact with no hedging.

**Risk for Phase 3:** The model may generate code that includes unnecessary operations based on fabricated assumptions about how existing code works.

**Mitigation:** The Coder skill's requirement to "read every referenced file" helps, but the model should be instructed to distinguish between "I read this in the source" and "I infer this from the design."

### Finding 3: Implementation Detail Bleed (Q12, Q21)

The model occasionally mixes Phase 3 implementation plans (from amendments) with Phase 2 interface contracts, presenting planned implementation details as established facts. In Q21, it used `Instant.now()` for a derived event's eventTime, conflating processing time with event time.

**Risk for Phase 3:** Moderate. The model understands the contracts but may make subtle time-semantics errors in derived event production.

**Mitigation:** Coding instructions for derived event producers should explicitly state: "Derived eventTime is either null or inherited from the causing event — never Instant.now()."

---

## Verdict

**PASS (93.1%).** The model demonstrates strong architectural understanding, precise type knowledge, and correct practical implementation patterns. The three critical findings are all addressable through explicit coding instruction language. The Q23 error is the most concerning — it reveals a source-trust hierarchy problem that could cause real bugs — but it's mitigable by reinforcing "source code is authoritative over all secondary documents" in every coding instruction.

Recommended: proceed with Phase 3, with the three mitigations above added to the Coder skill's reference material or to individual coding instructions.
