# HomeSynapse Core — M3 Consolidated Implementation Plan (Source-Verified)

**Document ID:** PLAN-M3-CONSOLIDATED-02
**Status:** AUTHORITATIVE (governance artifact)
**Phase:** 3 (Tests and Implementation)
**Milestone:** M3 (Event Distribution and State Materialization)
**Supersedes:** PLAN-M3-CONSOLIDATED-01 (draft); M3 architecture research notes; M2→M3 bridge planning artifacts (for M3 scope only)
**Authority:** Senior architect lock of DEC-M3-01 through DEC-M3-12
**Source-verification pass:** 2026-05-16 (against `homesynapse-core` commit baseline post-M2→M3 bridge, 2026-05-15)

---

## 0. Changelog from PLAN-M3-CONSOLIDATED-01 (Draft)

This document is a source-verification pass over the original M3 plan draft. The architectural substance — the twelve locked decisions, the three new amendments (AMD-41/42/43), the §12 resolved-decisions ledger, the §13 open questions, and the §14 exit-gate criteria — is preserved unchanged. The mechanical corrections below were applied throughout to align the plan with the actual codebase as of the post-M2→M3-bridge commit baseline.

### 0.1 Module and package corrections

The original draft referenced a `core/event-store` module that does not exist and a `com.homesynapse.event.store` package that does not exist. Actual locations:

| Original draft reference | Actual location |
|---|---|
| `core/event-store/` (module) | Does not exist. Types live in three modules: `core/event-model`, `core/persistence`, `core/state-store`. |
| `core/event-store/.../ProjectionAdvancer.java` | `core/state-store/src/main/java/com/homesynapse/state/ProjectionAdvancer.java` |
| `core/event-store/.../AdvanceResult.java` | `core/state-store/src/main/java/com/homesynapse/state/AdvanceResult.java` |
| `core/event-store/.../EventEnvelope.java` | `core/event-model/src/main/java/com/homesynapse/event/EventEnvelope.java` |
| `core/event-store/.../EventStore.java` (interface) | `core/event-model/src/main/java/com/homesynapse/event/EventStore.java` |
| `core/event-store/.../InMemoryEventStore.java` | `core/event-model/src/testFixtures/java/com/homesynapse/event/InMemoryEventStore.java` |
| `core/event-store/.../SqliteEventStore.java` | `core/persistence/src/main/java/com/homesynapse/persistence/SqliteEventStore.java` (package-private, final) |
| `core/api/` (module) | Does not exist. HTTP endpoints live in `api/rest-api/` (package `com.homesynapse.api.rest`). The `StateQueryService` interface already lives in `core/state-store` (package `com.homesynapse.state`). |
| `com.homesynapse.event.store.*` (package) | Does not exist. Replaced by `com.homesynapse.state` (advancer/result), `com.homesynapse.event` (store interface, envelope, draft, publisher), or `com.homesynapse.persistence` (SQLite impl). |
| `core/integration-tests/` (proposed new module) | New module. Settings.gradle.kts addition required; placement and naming flagged in §13 (open question) — alternative is per-module `src/integrationTest/` source sets per the existing repo convention. |

### 0.2 Flat-package convention corrections

The Knowledge Primer states "Each module has one flat Java package under `com.homesynapse.*`." The event-bus MODULE_CONTEXT reiterates: "All types in a single flat package." The original draft created multiple sub-packages within modules; all such sub-packages have been flattened. Package-private visibility (no modifier) provides encapsulation without sub-packages.

| Original draft sub-package | Corrected (flat) package |
|---|---|
| `com.homesynapse.event.bus.subscriber.*` | `com.homesynapse.event.bus` |
| `com.homesynapse.event.bus.internal.*` | `com.homesynapse.event.bus` (package-private) |
| `com.homesynapse.event.bus.metrics.*` | `com.homesynapse.event.bus` |
| `com.homesynapse.event.bus.health.*` | `com.homesynapse.event.bus` |
| `com.homesynapse.state.projection.*` | `com.homesynapse.state` |
| `com.homesynapse.api.query.endpoints.*` | `com.homesynapse.api.rest` (api/rest-api module) |
| `com.homesynapse.api.admin.*` | `com.homesynapse.api.rest` (api/rest-api module) |

**TestFixtures exception (existing convention).** The existing testFixtures source sets use a `.test` sub-package for contract test base classes (e.g., `core/event-bus/src/testFixtures/java/com/homesynapse/event/bus/test/EventBusContractTest.java`). New contract test bases created in M3 follow this existing pattern: production code stays flat; testFixtures bases use the `.test` sub-package. Local unit tests in `src/test/java/` use the same flat package as production code (e.g., `com.homesynapse.event` for `EventStoreTest`).

### 0.3 EventBus vs EventPublisher responsibility correction

The original draft added `EventBus.publish(EventEnvelope candidate)` to the bus interface and called it from the State Projection's derivation path. This conflicts with the existing Phase 2 contract:

- `EventBus` is **notification-only**: methods are `subscribe(SubscriberInfo)`, `unsubscribe(String subscriberId)`, `notifyEvent(long globalPosition)`, `subscriberPosition(String subscriberId)`. Its Javadoc explicitly states: *"The bus does not own event persistence — that is the responsibility of EventPublisher. The publisher calls notifyEvent(long) after successfully appending an event to the log."*
- `EventPublisher` is the **sole write path**: methods are `publish(EventDraft, CausalContext)` (derived events) and `publishRoot(EventDraft)` (root events). The signature takes `EventDraft` (the pre-publish builder), not `EventEnvelope` (the post-persistence wrapper assigned by the publisher).

The corrected plan:
- Removes `publish()` from the `EventBus` interface (§4.3) — `EventBus` retains its Phase 2 notification-only contract.
- `StateProjection`'s constructor (§5.3) takes `EventPublisher`, not `EventBus`, for its derivation publish path. It still observes the `EventBus` indirectly through its subscriber registration, but the publish path goes through `EventPublisher` (which then calls `EventBus.notifyEvent` internally per the existing contract).
- The replay/transition wiring (§6) uses the existing pull-based delivery model: subscribers register with the bus, the bus wakes them via `LockSupport.unpark`, and they poll the `EventStore` directly.

### 0.4 `AdvanceResult` field-name preservation

The original draft renamed `AdvanceResult`'s fields. The committed code (M2→M3 bridge, 2026-05-15) has `lastProcessedPosition`, `eventsProcessed`, `hasMore`. The corrected plan retains the committed names. Renaming committed types that compile and pass tests is churn without justification.

| Original draft (proposed rename) | Committed (retained) |
|---|---|
| `nextPosition()` | `lastProcessedPosition()` |
| `consumed()` | `eventsProcessed()` |
| `reachedTail()` | `hasMore()` (note inverted semantics: `hasMore = false` AND `eventsProcessed = 0` signals caught up to tail) |

The substantive change to `ProjectionAdvancer.advance` — adding a `Consumer<EventEnvelope> processor` parameter to enforce in-transaction processing per AMD-41 §3.2.1 — is preserved. The signature becomes `advance(long fromPosition, int maxRows, Consumer<EventEnvelope> processor) → AdvanceResult`.

### 0.5 Existing-interface awareness corrections

Two interfaces named in the original draft as "create new" already exist:

- **`StateQueryService`** already exists in `core/state-store` (package `com.homesynapse.state`) as a Phase 2 service interface. Methods present: `getState(EntityId)`, `getStates(Set<EntityId>)`, `getSnapshot()`, `getViewPosition()`, `isReady()`. M3.6 implements this interface (the draft's proposed `StateQueryServiceImpl` becomes `MaterializedStateQueryService` in the state-store module). M3.6 also adds HTTP endpoint handlers in `api/rest-api`. The draft's proposed `getStatesAtPosition(Collection<String>, long)` method is **not** on the existing interface; adding it requires either (a) an interface extension that AMD-03 must explicitly bless, or (b) keeping it as an HTTP-only concern not exposed on the Java interface. Resolved as open question §13.9 (new).
- **`EventBusContractTest`** already exists at `core/event-bus/src/testFixtures/java/com/homesynapse/event/bus/test/EventBusContractTest.java` with 18 contract methods. M3.1 extends this existing class rather than creating a new one. The naming convention is `*ContractTest` (with the "Test" suffix), not `*Contract`.

### 0.6 Bounded-window contract preservation

The original draft's §3.6 test method `advanceFromZeroReadsEntireLog()` calls `advance(0, MAX_INT, ...)`. This violates the Phase 2 bounded-window contract (`DEFAULT_MAX_ROWS = 500`, "≤ 500 rows, ≤ 2 s read transaction") established by the D1 WAL Pathology Validation Spike (2026-05-15) and codified in AMD-38. The corrected test method is `advanceFromZeroDrainsLogInBoundedWindows()` and asserts that multiple successive `advance(_, 500, _)` calls drain a 10-event log correctly, with each call independently opening and closing its read transaction.

### 0.7 Things explicitly NOT changed

- §1 (preamble), §2 (AMD-41/42/43 amendment text — modulo path/package references in the validation gates and downstream-dependency listings), §12 (resolved decisions ledger), §13 (open questions — modulo §13.9 newly added), §14 (exit-gate criteria — modulo file path corrections).
- All twelve DEC-M3-* locked decisions remain as locked.
- The implementation ordering M3.1 → M3.5a → M3.2 → M3.3 → M3.4 → M3.5b → M3.6 → M3.7 (DEC-M3-11) is preserved.
- The amendments AMD-41, AMD-42, AMD-43 are preserved verbatim except where they cite specific file paths or module names that need correction.

---

## 1. Preamble

### 1.1 Current state recap

HomeSynapse Core has completed M2 (persistence layer) and the M2→M3 structural-hardening bridge (amendments AMD-34 through AMD-40). The codebase as of this plan's commit baseline contains:

- **core/event-model** — `EventEnvelope` (immutable wrapper, 14 fields), `EventDraft` (pre-publish builder, 9 fields including `idempotencyKey` per AMD-35), `EventPublisher` (sole write interface: `publish(EventDraft, CausalContext)`, `publishRoot(EventDraft)`), `EventStore` (read interface: 6 methods), the `DomainEvent` sealed hierarchy, `CausalContext`, `EventPriority`, `EventOrigin`, `SubjectRef`, `SubjectType`. Package: `com.homesynapse.event`. Test fixtures: `InMemoryEventStore` (production-quality, 27-method contract suite passing).
- **core/persistence** — `SqliteEventStore` (package-private, final, implements both `EventPublisher` and `EventStore`), `SqliteCheckpointStore`, `SqliteViewCheckpointStore`, `AtomicCheckpointWriter` (AMD-38 cadence enforcement), `SqlitePersistenceLifecycle`, `DatabaseExecutor` (write coordinator + read executor per AMD-26/27), V001/V002 migrations applied. V003 migration (snapshots table + redundant index drop) staged from the M2→M3 bridge and runs at boot. Package: `com.homesynapse.persistence`.
- **core/state-store** — `EntityState` (9 fields), `StateSnapshot`, `CheckpointRecord`, `StateQueryService` (existing Phase 2 interface — to be implemented in M3.6), `StateStoreLifecycle`, `ViewCheckpointStore`, `Availability` enum, plus the M2→M3 bridge additions: `CheckpointPolicy` (sealed), `FixedCheckpointPolicy` (HOME_DEFAULT = 200 events / 2 s per AMD-38), `AdaptiveCheckpointPolicy` (reserved), `ProjectionAdvancer` (cursor interface: `advance(long, int) → AdvanceResult` at baseline; modified by Deliverable 0 to add `Consumer<EventEnvelope>`), `AdvanceResult` (record: `lastProcessedPosition`, `eventsProcessed`, `hasMore`). Package: `com.homesynapse.state`. **Total: 12 public types post-bridge.**
- **core/event-bus** — `EventBus` (4 methods: `subscribe`, `unsubscribe`, `notifyEvent(long globalPosition)`, `subscriberPosition`), `SubscriberInfo`, `SubscriptionFilter`, `CheckpointStore`. Notification-only contract (subscribers pull from `EventStore` after `LockSupport.unpark`). No production `InProcessEventBus` implementation exists yet — M3.1 lands it. The 18-method `EventBusContractTest` exists in testFixtures (`com.homesynapse.event.bus.test`). Package: `com.homesynapse.event.bus`.
- **api/rest-api** — Phase 2 type scaffolding only (request/response records, RFC 9457 error model, auth types). No endpoint handlers wired. Package: `com.homesynapse.api.rest`. Module name: `com.homesynapse.api.rest`.
- **api/websocket-api** — Phase 2 type scaffolding only. Package: `com.homesynapse.api.ws`. Module name: `com.homesynapse.api.ws`. Out of M3 scope.
- **testing/test-support** — `TestClock`, `SynchronousEventBus`, `GivenWhenThen` DSL, `TestIntegrationContext`. Package: `com.homesynapse.test`.

The repo has 19 Gradle modules total (18 production + test-support). Dependency rules (enforced by ArchUnit at the repo level): `:core:*` cannot depend on `:integration:*`, `:api:*`, `:app:*`, or `:lifecycle:*`. `:platform:*` cannot depend on `:core:*`.

The persistence layer is correct, durable, and observable. M3 layers event distribution (in-process bus, subscriber lifecycle, REPLAY→LIVE) and read-side materialization (`StateProjection`, `MaterializedStateQueryService` + HTTP handlers) on top.

### 1.2 Locked decisions

The senior architect's lock of M3 architecture closed twelve decisions. They are summarized below and are not subject to re-deliberation in this plan or in any Cowork prompt derived from it.

| ID | Subject | Resolution (one-line) |
|---|---|---|
| DEC-M3-01 | Projection read/write discipline | Two-phase: read tx closes before publish; publishes sequential on projection VT, AMD-26/27 handoff per publish. |
| DEC-M3-02 | Self-produced event detection | In-memory ID set, 60s TTL, lazy eviction, no hard cap at MVP; `stateVersion` as defence-in-depth; bypass in REPLAY/TRANSITION. |
| DEC-M3-03 | REPLAY→LIVE transition | Three-phase COLD → REPLAY → TRANSITION → LIVE; `onCaughtUp()` single-shot per subscriber lifetime per process. |
| DEC-M3-04 (modified) | State projection checkpoints | MVP via existing `ViewCheckpointStore`; V003 migration already ran at the M2→M3 bridge, `SqliteSnapshotStore` deferred until empirical replay > 5s. |
| DEC-M3-05 | Snapshot format | Jackson JSON, mandatory `snapshotVersion` + `projectionVersion` headers, eager rebuild on mismatch, operator override flag `homesynapse.projection.allow_stale_snapshots`. |
| DEC-M3-06 (augmented) | Subscriber isolation | Per-subscriber VT; dedicated SQLite read connection; per-subscriber DLQ; supervisor with exponential backoff (3s min / 30s max / 0.2 jitter); in-memory circuit breaker 5 crashes / 10 min → suspend + CRITICAL. |
| DEC-M3-07 | Coalescing | Deferred past M3; M3.3 ships lag measurement and metrics only. |
| DEC-M3-08 (rejected, replaced) | Backpressure | `EventPublisher.publish` is NOT blocked on bus queue depth; natural backpressure from single-thread write executor (AMD-26); per-subscriber derived-write rate limit (200/s for State Projection); metrics + health signal at queue depth > 5000. |
| DEC-M3-09 | Clock injection | Single `Clock` instance per JPMS module; ArchUnit `NO_DIRECT_TIME_ACCESS` enforced; propagated to bus, checkpoints, stale detection, snapshots, filter expiry, supervisor backoff, DLQ insertion, reconciliation timestamps. |
| DEC-M3-10 | State_changed derivation | Lives in `StateProjection` (core/state-store), NOT in writer. Writer remains semantic-free. Alternative A permanently rejected. |
| DEC-M3-11 | Implementation order | M3.1 → M3.5a → M3.2 → M3.3 → M3.4 → M3.5b → M3.6 → M3.7. The vertical slice (M3.5a) follows the bus core (M3.1) to validate cross-executor pattern before locking the bus contract. |
| DEC-M3-12 (modified) | Pi 4 support | Pi 4 is supported floor; ArchUnit budget test enforces 3000 entities / 256 MB heap envelope; AMD-38 checkpoint cadence retained universally; platform tuning deferred to M3.4 outcome. |

### 1.3 Authority chain reminder

This plan does not create authority — it consolidates the authority granted by:

1. **The twelve locked decisions** (DEC-M3-01 … DEC-M3-12). These are the irreducible governance atoms.
2. **The three new amendments** (AMD-41, AMD-42, AMD-43) introduced in §2 below. These translate the decisions into design-doc deltas and invariant alignments.
3. **The existing amendment corpus** (AMD-01 … AMD-40), in particular AMD-02 (reconciliation), AMD-03 (`StateQueryService` contract), AMD-26 / AMD-27 (virtual-thread / platform-thread handoff for SQLite writes), AMD-36 (Jackson codec), AMD-38 (checkpoint cadence), AMD-39 (clock discipline), and AMD-40 (writer scope and semantic neutrality).

Every Cowork prompt derived from this plan cites the plan section as its scope-of-work authority and the relevant amendments as the invariant authority. Where prompt and amendment disagree, the amendment wins; where amendment and decision disagree (they should not), the decision wins; where decision and senior architect lock disagree (they should not), the lock wins.

### 1.4 Purpose and relationship to Cowork prompts

This document is the **input** to Cowork prompt generation. It is not itself a prompt and is not legible to the Coder agent as a single block — prompts will quote specific sub-sections by anchor.

The document is structured so that for every M3 deliverable there is:

- A scope statement (what the deliverable produces).
- An authority statement (which amendments and invariants apply).
- An interface statement (signatures the deliverable must produce).
- A contract test statement (the abstract test method list).
- An acceptance criterion (binary GREEN/RED).
- A **Cowork prompt scope** subsection that pre-bakes the MUST / MUST-NOT / STOP-on-Mismatch / completion-report shape for the eventual prompt.

The Cowork prompts themselves are produced by Claude PM by quoting sections of this plan verbatim plus the standard Cowork preamble. The Coder agent reads only the prompts and the cited source files / amendments — it never reads this plan directly.

**Build discipline reminder (per Hivemind protocol):** Cowork prompts produce files only. Nick owns the compile gate (`./gradlew :module:check`) and runs every build locally. Coder reports the set of files written, the AMD citations relied upon, and the verification commands Nick should run. Coder does not invoke gradle, mvn, javac, or any build tool.

---

## 2. Governance prerequisites (single commit to `homesynapse-core-docs`)

Before any M3 code is written, a single governance commit lands in `homesynapse-core-docs` containing AMD-41, AMD-42, AMD-43, the MODULE_CONTEXT updates, and the Navigation Index registration. The commit is atomic — partial application is not permitted. The three amendment files live at:

- `homesynapse-core-docs/design/amendments/AMD-41-state-projection-execution-model.md`
- `homesynapse-core-docs/design/amendments/AMD-42-subscriber-lifecycle-and-isolation.md`
- `homesynapse-core-docs/design/amendments/AMD-43-backpressure-observability.md`

Each file is written in the exact format used by AMD-34 through AMD-40. The full text of each amendment is given below.

---

### 2.1 AMD-41 — State Projection Execution Model

**Amendment ID:** AMD-41
**Tier:** Tier-1 (architectural invariant)
**Status:** APPLIED (on commit)
**Date Applied:** (commit date)
**Target Document:** Doc 03 — State Materialization and Read Path
**Target Sections:** §3.2 (State Projection runtime model), new §3.2.4 (Reconciliation pass), §12.5 Q5 (resolved)
**Refines:** INV-PROJ-01 (projection determinism), INV-PROJ-04 (checkpoint-position monotonicity), INV-WRITER-01 (single-writer invariant from AMD-26)
**Source:** DEC-M3-01, DEC-M3-02, DEC-M3-04 (modified), DEC-M3-10

#### Problem statement

The Phase 2 design of State Projection inherits the writer's single-thread discipline (AMD-26) by accident rather than design. The projection performs reads against `EventStore` (implemented by `SqliteEventStore`), derives state-changed events, and publishes them back via `EventPublisher`, but the ordering between the read transaction, the derived-event publish, and the AMD-26/27 handoff to the writer's platform thread has never been pinned. Three concrete failure modes are possible:

1. **Read-during-write deadlock.** If the read transaction is held open across an `EventPublisher.publish()` call and the publish path parks on the writer's platform thread to perform a derived write, SQLite WAL can promote the read to a `BEGIN IMMEDIATE` if a checkpoint coincides, blocking the writer's next acquire.
2. **Reentrant filter blindness.** Without a self-produced-event filter, a `state_changed` event derived from `device_observed` is re-delivered to the same `StateProjection` subscriber, which then attempts to derive a second `state_changed` from the first one. The cycle terminates only when the filter logic happens to short-circuit on idempotent state.
3. **Version-upgrade lossage.** When `projectionVersion` is bumped (a derivation rule change), the existing checkpoint references a position that was processed under the old rules. Replay-from-zero is the only safe recovery, but the design as of M2→M3 has no formal reconciliation pass.

#### Change specification

Replace Doc 03 §3.2 in its entirety with the following text (additions and replacements):

**§3.2.1 — Execution model (replaces existing §3.2.1).** The `StateProjection` subscriber runs on a per-subscriber virtual thread (see AMD-42 §3.4). Each event delivery executes as the following strict sequence:

1. **READ phase.** Open a read transaction on the subscriber's dedicated SQLite read connection via the `ProjectionAdvancer` (whose `advance` method invokes the per-event processor inside the read transaction — see Deliverable 0 / §3 of the implementation plan). The processor computes the derivation: load the prior state for the affected entity from `EntityState` cache, apply the event, produce zero or more derived `state_changed` `EventDraft` instances **into an in-memory buffer**. **The read transaction closes when `advance` returns; the buffer holds the derived drafts.**
2. **PUBLISH phase.** For each buffered `EventDraft`, call `EventPublisher.publish(draft, causalContext)` sequentially on the projection's virtual thread. **No separate WriteBatcher thread exists.** Each `publish()` call parks the virtual thread on the writer's platform thread through the standard AMD-26 / AMD-27 handoff. The next `publish()` does not begin until the current one returns.
3. **CHECKPOINT phase.** After all derived publishes return, the projection records the source event's `globalPosition` via `ViewCheckpointStore.writeCheckpoint(viewName, position, data)`. Checkpoint cadence remains governed by AMD-38 (200 events or 2 seconds, whichever first).

The sequence is single-threaded per subscriber and produces a total order on the subscriber's derived publishes. The `WriteBatcher` thread referenced in earlier drafts is **not** introduced; the projection's own virtual thread is the only orchestrator.

**§3.2.2 — Self-produced filter (replaces existing §3.2.2).** The `StateProjection` maintains an in-memory `SelfProducedFilter` keyed by `EventEnvelope.eventId` (`Ulid`). On every successful `EventPublisher.publish()` from the projection, the resulting envelope's `eventId` is inserted into the set with a 60-second TTL (clock from injected `Clock`). On every inbound delivery, the projection checks the filter; matches return immediately without re-derivation.

- **Eviction is lazy.** Expiry is checked on `isSelfProduced()`; expired entries are removed inline. No background sweeper thread exists.
- **No hard cap at MVP.** Memory envelope is bounded by event throughput × 60s. With the M3.4 throughput floor of 100 events/sec, the set holds at most ~6000 ULIDs (≈ 96 KB at 16 bytes per ULID plus map overhead). A hard cap is deferred until empirical evidence justifies the complexity.
- **`stateVersion` defence-in-depth.** If the filter misses (e.g. process restart loses the in-memory set), the projection's derivation logic compares the candidate derived event's `stateVersion` to the current materialized state. Equal-or-lower versions are discarded.
- **REPLAY/TRANSITION bypass.** During `SubscriberMode.REPLAY` and `SubscriberMode.TRANSITION` (AMD-42 §3.4.1), `isSelfProduced()` returns `false` unconditionally. Replay must re-derive deterministically from the log; the in-memory filter from the previous process is gone and cannot be trusted.

**§3.2.3 — MVP checkpoint mechanism (replaces existing §3.2.3).** State Projection checkpoints through the existing `ViewCheckpointStore`. No per-entity snapshot store is introduced at MVP. The V003 migration that creates the `snapshots` table already ran at the M2→M3 bridge (2026-05-15) to keep schema versions linear, but the `SqliteSnapshotStore` implementation is deferred. The trigger for landing per-entity snapshots is empirical: when full replay from `position = 0` exceeds **5 seconds** wall-clock on the Pi 4 reference hardware, M3.5b's deferred work is unblocked.

**§3.2.4 — Reconciliation pass (NEW section, resolves §12.5 Q5).** When the projection observes `projectionVersion(persisted_checkpoint) ≠ projectionVersion(current_code)`, the projection enters a **reconciliation pass**:

1. The operator flag `homesynapse.projection.allow_stale_snapshots` is read. If `true`, the projection logs a WARN and proceeds with the stale checkpoint (escape hatch only).
2. If `false` (default), the projection discards the checkpoint, resets its in-memory state to empty, and replays from `position = 0` under `SubscriberMode.REPLAY`. The reconciliation timestamp (from injected `Clock`) is recorded on the new checkpoint as `reconciledAt`.
3. During reconciliation, the self-produced filter is bypassed (REPLAY mode); the writer is not invoked because the projection emits derived events only after exiting REPLAY (see AMD-42 §3.4.2).
4. On completion, `onCaughtUp()` fires exactly once (AMD-42 §3.4.3) and the projection transitions to LIVE.

The reconciliation pass is the **only** mechanism for handling projection-code version drift in M3. Schema-level migrations (writer-side) are out of scope for AMD-41 and remain governed by AMD-36.

#### Invariant alignment

- **INV-PROJ-01** (projection determinism): strengthened. The two-phase discipline guarantees that derived publishes are produced only after the read transaction commits, eliminating read-write interleaving as a source of non-determinism.
- **INV-PROJ-04** (checkpoint monotonicity): preserved. Checkpoint writes happen only after derived publishes return; partial-publish-then-checkpoint cannot occur.
- **INV-WRITER-01** (single-writer): preserved. All derived publishes route through `EventPublisher` and thus through the AMD-26/27 handoff; no second writer is introduced.
- **INV-PROJ-NEW-01** (self-produced isolation): introduced. A subscriber must not re-derive from its own publishes during LIVE mode.

#### Downstream dependencies

- AMD-42 (subscriber lifecycle) depends on AMD-41's `SubscriberMode` reference.
- AMD-43 (backpressure) depends on AMD-41's confirmation that `publish()` is sequential on the projection VT (no separate batcher to coalesce against).
- M3.5a (vertical slice) is the first executable validation of AMD-41.
- The existing `StateQueryService` interface in `core/state-store` (AMD-03) reads the materialized state produced by AMD-41's projection; no contract change to AMD-03.

#### Validation gate

- ArchUnit rule `PROJECTION_NO_WRITE_BATCHER_THREAD`: no class in `core/state-store` named `*WriteBatcher*` or extending `Thread`/`Runnable` outside the subscriber's own VT factory.
- Contract test `StateProjectionContractTest#readTxClosesBeforePublish` (in `core/state-store/src/testFixtures/.../test/`): instruments the `ProjectionAdvancer.advance()` and `EventPublisher.publish()` call boundaries and asserts the read tx is closed before publish executes.
- Contract test `StateProjectionContractTest#selfProducedFilterBypassedInReplay`: verifies `isSelfProduced()` returns `false` during REPLAY/TRANSITION.
- Contract test `StateProjectionContractTest#reconciliationOnVersionMismatch`: simulates a checkpoint with `projectionVersion = 1` while code reports `projectionVersion = 2` and asserts replay-from-zero.

---

### 2.2 AMD-42 — Subscriber Lifecycle and Isolation

**Amendment ID:** AMD-42
**Tier:** Tier-1
**Status:** APPLIED (on commit)
**Date Applied:** (commit date)
**Target Documents:** Doc 01 — Event Model & Event Bus; Doc 03 — State Materialization
**Target Sections:** Doc 01 §3.4 (Event bus subscriber model); Doc 03 §3.2 (cross-reference)
**Refines:** INV-BUS-01 (delivery exactly-once per subscriber), INV-BUS-03 (subscriber isolation), AMD-26 (writer single-thread), AMD-39 (clock injection)
**Source:** DEC-M3-03, DEC-M3-06 (augmented), DEC-M3-09

#### Problem statement

The Phase 2 design declares "in-process bus, per-subscriber delivery" without specifying:

- How subscribers transition from cold-start (no in-memory state, persisted checkpoint may exist) to LIVE delivery without losing events arriving during the catch-up read.
- Whether subscribers share SQLite read connections (they must not — connection-level transaction isolation collapses under sharing).
- What happens when a subscriber throws repeatedly — silent re-delivery loops would corrupt downstream views.
- How `onCaughtUp()` fires deterministically when catch-up is itself producing publishes that arrive on the same bus.

#### Change specification

Add the following text as Doc 01 §3.4.1 (replacing the existing §3.4.1 placeholder) and reference it from Doc 03 §3.2.

**§3.4.1 — Subscriber mode state machine.** Every subscriber registered with `EventBus` exposes a mode in `{ COLD, REPLAY, TRANSITION, LIVE, SUSPENDED }` via `SubscriberInfo.mode()`. Transitions are atomic (single `AtomicReference<SubscriberMode>` per subscriber) and observable to operators through the bus's introspection API.

```
COLD ──register()──▶ REPLAY ──reachedLiveTail()──▶ TRANSITION ──drainComplete()──▶ LIVE
                                                                                    │
                                                                                    │ circuitBreaker.trip()
                                                                                    ▼
                                                                                SUSPENDED
```

**§3.4.2 — Three-phase REPLAY→LIVE transition.**

1. **COLD.** Initial state on `EventBus.subscribe(subscriberInfo)`. No reads, no writes. The bus has accepted the registration but not started delivery.
2. **REPLAY.** The bus reads the subscriber's persisted checkpoint (via `CheckpointStore`), opens the subscriber's dedicated read connection (§3.4.4), and begins delivering events from `checkpoint + 1` forward in pages of `MAX_REPLAY_PAGE = 500` (bounded-window per AMD-38). During REPLAY:
   - The subscriber receives events strictly in `globalPosition` order.
   - Events newly published during REPLAY are captured in the subscriber's `ReplayWindowQueue` (bounded at 10000) and drained in TRANSITION.
   - The subscriber MUST NOT call `EventPublisher.publish()` from `onEvent()` during REPLAY — defence-in-depth check rejects with `IllegalStateException`. `StateProjection` is REPLAY-mode-aware and defers derivation publishes until LIVE.
3. **TRANSITION.** When `ProjectionAdvancer.advance()` reports tail reached (`hasMore == false && eventsProcessed == 0`), the bus transitions the subscriber to TRANSITION and runs the `drainAndPromote` procedure (§3.4.3). Drains the `ReplayWindowQueue` in `globalPosition` order, skipping events already delivered during REPLAY (gap detection).
4. **LIVE.** After drain completes, `onCaughtUp()` fires exactly once (single-shot per subscriber lifetime per process — see §3.4.3) and the mode atomically transitions to LIVE. From this point, events are delivered via standard notification: `EventBus.notifyEvent(globalPosition)` wakes the subscriber's VT, which polls `EventStore.readFrom(checkpoint, batch)` for the new events.
5. **SUSPENDED.** Entered when the supervisor's circuit breaker trips (§3.4.5). No deliveries. Operator-recoverable via `EventBus.resume(subscriberId)`.

**§3.4.3 — `onCaughtUp()` semantics.** Fires exactly once per process lifetime per subscriber, after the TRANSITION → LIVE atomic mode CAS succeeds and before any LIVE-mode delivery. Implementations may use it to log "ready", flush warm caches, or emit a readiness signal. The default implementation in `Subscriber` is a no-op. Exceptions thrown from `onCaughtUp()` are caught by the supervisor and treated as a synthetic-event delivery failure (DLQ logged with a synthetic `CAUGHT_UP_TRANSITION` event-position marker).

**§3.4.4 — Per-subscriber resources (INV-SUB-ISO-01..06).**

- **INV-SUB-ISO-01** — One virtual thread per subscriber, named `hs-sub-<subscriberId>`. Created on `subscribe()`, terminated on `unsubscribe()` (or SUSPENDED → resume cycle).
- **INV-SUB-ISO-02** — One dedicated SQLite read connection per subscriber, held for the lifetime of the subscriber. Connection allocation via `DatabaseExecutor.readExecutor()` round-robin pool (AMD-27); the subscriber binds one slot through a `ThreadLocal<Connection>`.
- **INV-SUB-ISO-03** — One `SubscriberDlq` instance per subscriber. DLQ entries are per-`subscriberId` in the `subscriber_dead_letters` table (V002, AMD-35).
- **INV-SUB-ISO-04** — One `AtomicReference<SubscriberMode>` per subscriber.
- **INV-SUB-ISO-05** — One `ReplayWindowQueue` per subscriber (lifetime: REPLAY entry → drain complete). Garbage-collected after LIVE transition.
- **INV-SUB-ISO-06** — One `SelfProducedFilter` per subscriber (only for derivation-producing subscribers, e.g. `StateProjection`).

**§3.4.5 — `SubscriberSupervisor` (per-subscriber).**

The supervisor wraps `subscriber.onEvent(envelope)` calls in a try/catch:

- On success: increment the subscriber's `deliveryCount` metric; reset the consecutive-failure counter on this subscriber.
- On exception: append to the subscriber's in-memory DLQ ring (cap 1024); persist to `subscriber_dead_letters` with `status = PENDING`; increment `crashCount` within the rolling 10-minute window; schedule retry via the bus's shared `ScheduledExecutorService` with backoff `MIN = 3s, MAX = 30s, jitter = 0.2`. After 10 retries OR `crashCount >= 5` within 10 minutes, the circuit breaker trips: `mode → SUSPENDED`, emit CRITICAL on health channel `subscriber.<id>.suspended`, persist the final DLQ entries with `status = GAVE_UP`.
- `EventBus.resume(subscriberId)` clears the crash window, transitions SUSPENDED → REPLAY (re-bootstrap from last checkpoint), and re-attempts delivery.

The supervisor's backoff scheduler uses the injected `Clock` (AMD-39 propagation).

**§3.4.6 — Cross-subscriber isolation guarantees.** A failure in subscriber A (exception, DLQ overflow, circuit trip) MUST NOT affect subscriber B's mode, queue, connection, DLQ, or delivery cadence. The bus implementation MUST be tested with a contract test method per INV-SUB-ISO-01..06 demonstrating no cross-contamination.

#### Invariant alignment

- **INV-BUS-01** (exactly-once per subscriber): preserved. The REPLAY → TRANSITION → LIVE handoff prevents duplicate delivery at the transition boundary by tracking `lastReplayedPosition` and using it as the drain gate.
- **INV-BUS-03** (subscriber isolation): strengthened by the explicit INV-SUB-ISO-01..06 catalog.
- **AMD-26 (writer single-thread)**: preserved. The bus has no writer; all writes go through `EventPublisher` which routes through the writer's platform thread.
- **AMD-39 (clock injection)**: extended. The supervisor's backoff scheduler joins the propagation surface.

#### Validation gate

- Contract tests `EventBusContractTest#subscriberLifecycle_*` (extension of existing 18-method base): cover state machine transitions, atomicity, single-shot `onCaughtUp`, isolation guarantees (one method per INV-SUB-ISO-01..06).
- `ReplayTransitionIT` integration test (M3.2 §6.6).

---

### 2.3 AMD-43 — Backpressure and Observability

**Amendment ID:** AMD-43
**Tier:** Tier-1
**Status:** APPLIED (on commit)
**Date Applied:** (commit date)
**Target Document:** Doc 01 — Event Model & Event Bus; Doc 11 — Observability
**Target Sections:** Doc 01 §3.6 (backpressure), Doc 11 §3.X (bus metrics)
**Refines:** INV-BUS-02 (publish is non-blocking on backpressure), AMD-26 (writer single-thread)
**Source:** DEC-M3-07 (deferred), DEC-M3-08 (replaced), DEC-M3-12 (modified)

#### Problem statement

The Phase 2 design specifies pull-based bus delivery and per-subscriber checkpoints, but does not specify:

- What happens when the writer's queue is saturated (>5000 enqueued writes pending).
- Whether `EventPublisher.publish` blocks the caller, fails-fast, or coalesces.
- Which metrics operators can rely on to detect saturation before it becomes a user-facing latency spike.
- How a derivation-producing subscriber (`StateProjection`) limits its own contribution to the writer's backlog.

#### Change specification

Add the following text as Doc 01 §3.6 (replacing existing placeholder) and reference from Doc 11 §3.X (new sub-section "Event bus and writer metrics").

**§3.6.1 — `EventPublisher.publish()` is non-blocking on backpressure (INV-BUS-02 normative).** The publisher MUST NOT block on writer queue depth. Natural backpressure arises from the single-thread write executor (AMD-26): callers park on their handoff future, which completes only when the writer drains to their slot. The publisher MUST NOT introduce additional blocking via `Semaphore.acquire`, `wait`, `Lock.lock` keyed on queue depth, or any other depth-gated mechanism. Saturation manifests as elevated per-call latency, never as `publish()` hanging.

**§3.6.2 — Required metrics (seven canonical names).** The bus implementation MUST emit these exact metric names through the project's existing `core/observability` adapter:

| Metric name | Type | Sampled when |
|---|---|---|
| `homesynapse.bus.publish.latency` | histogram (microseconds) | After every `EventPublisher.publish()` returns. |
| `homesynapse.bus.publisher.blocked.count` | counter | Incremented at `publish()` entry whenever observed writer queue depth > 5000. No debounce. |
| `homesynapse.bus.writer.queue.depth` | gauge (int) | Sampled on every enqueue AND every dequeue (guaranteed-fresh value). |
| `homesynapse.bus.subscriber.lag.events` | gauge per subscriberId (long) | Sampled after every `onEvent` returns. Lag of most-recently-delivered event vs writer tail. |
| `homesynapse.bus.subscriber.lag.millis` | gauge per subscriberId (Duration) | Sampled after every `onEvent` returns. Wall-clock between event ingest and subscriber observation. |
| `homesynapse.bus.subscriber.derived_writes.accepted` | counter per subscriberId | Incremented on each `EventPublisher.publish` from the subscriber that succeeded without rate-limit park. |
| `homesynapse.bus.subscriber.derived_writes.parked` | counter per subscriberId | Incremented when the rate-limit bucket was empty and the call parked. |

These are the literal names. Renames are governed by Doc 11's metrics-stability policy.

**§3.6.3 — Health-signal mechanics.** A `QueueSaturationHealthCheck` runs on a 1-second scheduled tick (shared with the supervisor scheduler). It reads `homesynapse.bus.writer.queue.depth` and maintains two consecutive-tick counters:

- `criticalTicks`: incremented when `depth > critical_depth` (default 10000), reset otherwise.
- `warnTicks`: incremented when `depth > warn_depth` (default 5000), reset otherwise.
- On `criticalTicks >= 5`: emit `CRITICAL` on channel `writer.queue.saturating`. Re-emit at 10-second intervals while sustained.
- On `warnTicks >= 5` AND no current critical: emit `WARN` on channel `writer.queue.saturating`. Re-emit at 30-second intervals while sustained.
- When depth drops below thresholds for ≥ 5 consecutive ticks, emit `INFO` `writer.queue.recovered`.

Operator-tunable via `application.properties`:
- `homesynapse.bus.queue.warn_depth` (default 5000)
- `homesynapse.bus.queue.critical_depth` (default 10000)
- `homesynapse.bus.queue.saturation_ticks` (default 5)

**§3.6.4 — Per-subscriber derived-write rate limit.** Derivation-producing subscribers (currently only `StateProjection`) wrap their `EventPublisher.publish()` calls in a `DerivedWriteRateLimit` token bucket:

- Bucket capacity: 200 tokens (default for `StateProjection`; constructor parameter).
- Refill rate: 200 tokens/sec via a single scheduled task on the supervisor scheduler ticking every 50ms (refill of 10 tokens per tick). Refill ticks use the injected `Clock` (AMD-39).
- `acquire()` semantics: poll first; if available, decrement and return immediately. If not, `BusMetrics.recordDerivedWriteParked(subscriberId)` and park on a `Semaphore` until the refill releases a permit.
- The rate limit is per-subscriber (one bucket instance per `StateProjection`); other future derived-publishing subscribers carry their own defaults.

**§3.6.5 — Coalescing deferred past M3 (DEC-M3-07).** No coalescing of subscriber notifications or publish calls is implemented in M3. The `coalesceExempt` flag on `SubscriberInfo` (existing field from Phase 2) is retained in the contract but is not exercised: M3 treats all subscribers as if `coalesceExempt = true`. Post-M3 work may activate coalescing for non-exempt subscribers under a future amendment.

**§3.6.6 — Pi 4 platform envelope (DEC-M3-12 modified).** The above defaults are universal across the Pi 4 → x86 server deployment spectrum at MVP. The `Pi4SustainedLoadIT` and `Pi4D1SpikeIT` integration tests (M3.4) are the empirical gates that determine whether platform-specific tuning is required. If observed saturation occurs at Pi 4's natural throughput, follow-up amendment AMD-44 may introduce platform-aware defaults; this is not a M3 deliverable.

#### Invariant alignment

- **INV-BUS-02** (non-blocking publish on backpressure): formalized and enforced by ArchUnit rule `EVENT_PUBLISHER_HAS_NO_DEPTH_GATED_LOCK` (added in M3.3): no class in `core/persistence` or `core/event-bus` may import `java.util.concurrent.Semaphore`, `java.util.concurrent.locks.Lock`, or call `Object.wait()` in a code path reachable from `EventPublisher.publish()`. (Exceptions: the writer's own work queue uses internal synchronization; this is allowed because it's not depth-gated on the caller.)
- **AMD-26 (single-writer)**: preserved. Backpressure is a writer-derived consequence, not a separate mechanism.

#### Validation gate

- `BackpressureMetricsIT` (M3.3 §7): drives writer queue to 6000 depth via a slow writer fixture; asserts publish latency p99 within 2× steady-state; asserts `homesynapse.bus.publisher.blocked.count` increments.
- Contract tests `EventBusContractTest#publishDoesNotBlockAt5000` and related (M3.3).
- ArchUnit rule `EVENT_PUBLISHER_HAS_NO_DEPTH_GATED_LOCK`.

---

## 3. Deliverable 0 — `ProjectionAdvancer.advance` signature change

### 3.1 Scope

Deliverable 0 is a single-file refactor that lands before any M3.1 work. It changes the `ProjectionAdvancer.advance` signature to take a per-event processor callback (`Consumer<EventEnvelope>`) that executes inside the read transaction. This enforces AMD-41 §3.2.1 at the type-system level: the existing signature (`advance(long, int) → AdvanceResult` with no events list) leaves the question of how the advancer feeds events to the projection under-specified, which has caused implementation-time confusion in prior milestones. The processor-callback shape removes that ambiguity.

### 3.2 Authority

- AMD-41 §3.2.1 (read transaction discipline).
- AMD-38 (bounded-window read transaction — preserved).
- DEC-M3-01 (two-phase discipline).

### 3.3 Files to modify (all paths source-verified)

| Path | Change |
|---|---|
| `core/state-store/src/main/java/com/homesynapse/state/ProjectionAdvancer.java` | Replace `advance` signature, update Javadoc. |
| `core/state-store/src/main/java/com/homesynapse/state/AdvanceResult.java` | **No change.** Existing fields (`lastProcessedPosition`, `eventsProcessed`, `hasMore`) are preserved. Existing compact constructor and accessors are correct as-is. |
| `core/state-store/src/testFixtures/java/com/homesynapse/state/test/ProjectionAdvancerContractTest.java` | **NEW.** Abstract contract test class. (No such class exists today — the Phase 2 interface was specified without a contract test suite. Deliverable 0 introduces it as the basis for M3.1+ implementations.) |
| `core/state-store/MODULE_CONTEXT.md` | Update `ProjectionAdvancer` row to reflect the new signature; preserve `AdvanceResult` row unchanged. |

No production code outside `core/state-store` currently calls `ProjectionAdvancer.advance` (verifiable by grep at plan-writing time — Deliverable 0's Cowork prompt MUST re-verify). The interface has been declared in Phase 2 but no production implementation exists yet; the M3.1+ implementations land in `core/event-bus` (where the `ReplayDriver` invokes the advancer) and `core/persistence` (where `SqliteProjectionAdvancer`, a thin wrapper over the read connection, implements the advancer).

### 3.4 Old signature (to remove)

```java
package com.homesynapse.state;

public interface ProjectionAdvancer {

    int DEFAULT_MAX_ROWS = 500;

    /**
     * Advances a projection cursor by reading up to maxRows events from
     * fromPosition (exclusive). Implementations apply each event to the
     * projection's state model.
     *
     * Contract: each call is an independent short-lived read transaction
     * (≤ 2 s, ≤ 500 rows). No cursors held between calls.
     */
    AdvanceResult advance(long fromPosition, int maxRows);
}
```

### 3.5 New signature (to introduce)

```java
package com.homesynapse.state;

import com.homesynapse.event.EventEnvelope;
import java.util.function.Consumer;

public interface ProjectionAdvancer {

    int DEFAULT_MAX_ROWS = 500;

    /**
     * Advances a projection cursor by reading up to {@code maxRows} events from
     * {@code fromPosition} (exclusive) and synchronously invoking {@code processor}
     * for each event in {@code globalPosition}-ascending order.
     *
     * <p><b>Transaction discipline (AMD-41 §3.2.1, normative).</b> The implementation
     * MUST open a read transaction on entry, invoke {@code processor.accept(envelope)}
     * for each event read in {@code globalPosition} order, and close the read
     * transaction before this method returns. The {@code processor} executes inside
     * the read transaction; implementations of {@code processor} MUST NOT call
     * {@code EventPublisher.publish()}, MUST NOT open writes against any
     * {@code core/state-store} connection, and MUST NOT block on resources held
     * elsewhere by the calling virtual thread. Derived publishes are buffered
     * by the processor and emitted by the projection AFTER {@code advance} returns
     * (two-phase discipline).
     *
     * <p><b>Bounded-window discipline (AMD-38, preserved).</b> Implementations MUST
     * cap a single call at {@link #DEFAULT_MAX_ROWS} = 500 rows AND ≤ 2 s wall-clock,
     * even if the caller passes a larger {@code maxRows}. The bounded-window
     * contract is load-bearing for WAL checkpoint progression (see D1 WAL Pathology
     * Validation Spike, 2026-05-15).
     *
     * <p><b>Ordering.</b> Events are delivered in strict {@code globalPosition}-ascending
     * order. Gaps (which AMD-26 / AMD-27 do not produce but defence-in-depth requires)
     * are preserved — the consumer sees events as they exist in the log.
     *
     * <p><b>Exceptions from processor.</b> If {@code processor.accept} throws, the
     * exception propagates from {@code advance}, the read transaction is closed
     * (rolled back — a no-op for read tx), and the returned {@link AdvanceResult}
     * is never constructed. The caller's subscriber supervisor (AMD-42 §3.4.5)
     * handles the exception and updates the subscriber's DLQ.
     *
     * <p><b>Threading.</b> {@code advance} is single-threaded with respect to the
     * caller's virtual thread. The implementation MUST NOT spawn helper threads.
     *
     * @param fromPosition the exclusive lower bound; events with
     *                     {@code globalPosition > fromPosition} are candidates.
     * @param maxRows the maximum number of events to deliver in this call. Capped
     *                internally at {@link #DEFAULT_MAX_ROWS}.
     * @param processor the per-event consumer, invoked inside the read transaction.
     * @return the {@link AdvanceResult} describing how far the cursor advanced and
     *         whether more events remain in the log.
     * @throws IllegalArgumentException if {@code maxRows < 1} or {@code fromPosition < 0}.
     * @throws NullPointerException if {@code processor} is {@code null}.
     * @throws RuntimeException any exception thrown by {@code processor.accept} propagates.
     */
    AdvanceResult advance(long fromPosition, int maxRows, Consumer<EventEnvelope> processor);
}
```

### 3.6 Contract test methods (new file)

`ProjectionAdvancerContractTest` is an abstract JUnit 5 test class. Concrete implementations (`InMemoryProjectionAdvancerTest`, `SqliteProjectionAdvancerTest`) subclass it and supply factory methods via the same pattern as `EventBusContractTest`. The required method roster:

- `advanceDeliversInPositionOrder()` — events with positions 1..10 are delivered in ascending order.
- `advanceRespectsFromPositionExclusive()` — `advance(5, 10, ...)` does not deliver position 5.
- `advanceRespectsMaxRows()` — at most `maxRows` events delivered; result's `eventsProcessed()` equals actual count.
- `advanceCapsAtDefaultMaxRows()` — passing `maxRows = Integer.MAX_VALUE` against a 1000-event log delivers ≤ 500 events in a single call (bounded-window enforcement).
- `advanceHasMoreWhenLogExceedsPage()` — when the log has more events past the page boundary, `hasMore()` is `true`.
- `advanceReachesTail()` — when fewer than `maxRows` events remain, result's `hasMore()` is `false` and `eventsProcessed()` reflects actual count; `hasMore == false && eventsProcessed == 0` indicates caught up to tail.
- `advanceProcessorInvokedInsideReadTx()` — instruments the processor to assert that the read connection's transaction state is "in progress" during the callback (verified via `SqliteProjectionAdvancer` connection introspection in subclass).
- `advanceProcessorExceptionPropagates()` — processor that throws on event 3 of 5 causes `advance` to throw; result not returned.
- `advanceProcessorExceptionClosesReadTx()` — after the exception, the read connection's auto-commit / transaction state is restored.
- `advanceRejectsInvalidArgs()` — `maxRows = 0`, `maxRows = -1`, `fromPosition = -1`, `processor = null` all throw appropriate exceptions.
- `advanceFromZeroDrainsLogInBoundedWindows()` — calling `advance(0, 500, ...)` against a 10-event log delivers all 10 in one call (since 10 < 500); against a 1500-event log, three successive `advance` calls (each starting at the previous `lastProcessedPosition`) drain the log entirely, with each call independently opening and closing its read transaction. This replaces the draft's `advanceFromZeroReadsEntireLog()` which violated AMD-38's bounded-window contract.

### 3.7 MODULE_CONTEXT update for `core/state-store`

In the `ProjectionAdvancer` row, replace:

> Single method: `advance(long fromPosition, int maxRows) → AdvanceResult`. Constant: `DEFAULT_MAX_ROWS = 500`.

with:

> Single method: `advance(long fromPosition, int maxRows, Consumer<EventEnvelope> processor) → AdvanceResult`. Constant: `DEFAULT_MAX_ROWS = 500`. Contract: each call opens an independent short-lived read transaction (≤ 2 s, ≤ 500 rows), invokes `processor.accept(envelope)` for each event in `globalPosition` order inside the read tx, then closes the tx before returning. Processor MUST NOT call `EventPublisher.publish` or perform writes (AMD-41 §3.2.1 enforcement point). Derived publishes are buffered by the processor and emitted after `advance` returns (two-phase discipline). No cursors held between calls — bounded-window discipline prevents WAL checkpoint starvation (AMD-38).

The `AdvanceResult` row is unchanged.

### 3.8 Acceptance criteria

- `ProjectionAdvancer.java` compiles against the new signature with `-Xlint:all -Werror`.
- `AdvanceResult.java` is unchanged.
- `ProjectionAdvancerContractTest` defines the eleven test methods in §3.6.
- `core/state-store/MODULE_CONTEXT.md` `ProjectionAdvancer` row is updated.
- No production source file references the old `advance(long, int)` overload (verifiable by `grep -rn "advance(.*int)" core/state-store/src/main/java/`).

Binary success criterion: `./gradlew :core:state-store:check` GREEN (Nick runs locally).

### 3.9 Cowork prompt scope (Deliverable 0)

#### The prompt MUST specify

- The new `ProjectionAdvancer` signature verbatim (§3.5), including full Javadoc text and the `Consumer<EventEnvelope>` import.
- The two production files to modify (`ProjectionAdvancer.java` only — `AdvanceResult.java` is unchanged) with full paths.
- The complete list of eleven contract test methods to land in `ProjectionAdvancerContractTest` (§3.6).
- The location and naming of the new contract test: `core/state-store/src/testFixtures/java/com/homesynapse/state/test/ProjectionAdvancerContractTest.java` (testFixtures `.test` sub-package per the existing repo convention).
- The MODULE_CONTEXT update text (§3.7).
- A citation to AMD-41 §3.2.1 (which the Coder may not be able to read yet — the prompt MUST include the relevant prose inline because the doc commit follows the code commit).
- The verification commands Nick should run after Coder reports done: `./gradlew :core:state-store:check`; `grep -rn "advance(.*int)" core/state-store/src/main/java/`.
- A note that no `testFixtures` source set may yet exist in `core/state-store` — if the build.gradle.kts needs the `java-test-fixtures` plugin added, the Coder makes that minimal addition (matches the existing pattern in `core/event-bus/build.gradle.kts`).

#### The prompt MUST NOT specify

- Production `SqliteProjectionAdvancer` or `InMemoryProjectionAdvancer` implementations (those land in M3.1 and M3.5a respectively).
- Internal implementation of how the read transaction will be opened (JDBC details belong to the M3.1 implementation).
- Logging statements, log message text, or log levels.
- Performance tuning.

#### STOP-on-Mismatch verification gates

The Coder MUST read the following before writing any code and report the read in the completion report. If any of these does not exist or differs from the prompt's quoted text, the Coder STOPS and reports the mismatch:

- `core/state-store/MODULE_CONTEXT.md` — confirm `ProjectionAdvancer` row currently shows `advance(long fromPosition, int maxRows) → AdvanceResult` and `AdvanceResult` row shows fields `lastProcessedPosition`, `eventsProcessed`, `hasMore`.
- `core/state-store/src/main/java/com/homesynapse/state/ProjectionAdvancer.java` — confirm the current signature is `AdvanceResult advance(long fromPosition, int maxRows)` (no third parameter).
- `core/state-store/src/main/java/com/homesynapse/state/AdvanceResult.java` — confirm fields are `lastProcessedPosition`, `eventsProcessed`, `hasMore` (NOT `nextPosition`, `consumed`, `reachedTail`).
- `core/event-model/src/main/java/com/homesynapse/event/EventEnvelope.java` — confirm the type exists and is in package `com.homesynapse.event`.
- `core/state-store/build.gradle.kts` — note whether `java-test-fixtures` plugin is already applied; if not, the Coder applies it.

#### Completion report format

The Coder reports:

1. **Files written** (full path list, one per line).
2. **AMD citations relied on** (inline quotes from the prompt, confirming Coder read them).
3. **STOP-on-Mismatch gate results** (each gate item with PASS/MISMATCH).
4. **Grep verification**: result of `grep -rn "advance(" core/state-store/src/main/java/` confirming the old signature does not appear elsewhere.
5. **build.gradle.kts changes** (if any — e.g. adding `java-test-fixtures` plugin).
6. **Verification commands for Nick**: literal command list to run locally.
7. **Open questions** (if any). For Deliverable 0, none are expected.

#### Binary success criterion

`./gradlew :core:state-store:check` GREEN (Nick runs locally after merging Coder's commit).

---

## 4. M3.1: InProcessEventBus core

### 4.1 Scope

M3.1 lands the bus skeleton, the subscriber mode state machine, the supervisor, and the per-subscriber isolation guarantees of AMD-42. It does NOT land the REPLAY→LIVE catch-up loop (that is M3.2), the metrics (M3.3), or the projection vertical slice (M3.5a — runs immediately after M3.1 per DEC-M3-11).

**Critical architectural clarification.** Per the corrected EventBus/EventPublisher responsibility split (see §0.3): the `EventBus` interface is notification-only. It does NOT gain a `publish()` method. Subscribers that produce derived events (`StateProjection`) call `EventPublisher.publish()` directly; the publisher then calls `EventBus.notifyEvent(globalPosition)` after the WAL commit. The bus's only orchestration role is wake-and-deliver.

### 4.2 Files to create or modify (all paths in `com.homesynapse.event.bus` flat package)

| Path | Purpose |
|---|---|
| `core/event-bus/src/main/java/com/homesynapse/event/bus/InProcessEventBus.java` | The production `EventBus` implementation. Package-private constructor; exposed via factory or wired in `homesynapse-app`. |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/Subscriber.java` | NEW — the subscriber callback interface (`onEvent(EventEnvelope)`, `default onCaughtUp()`). NOT currently in the module — `SubscriberInfo` is the existing registration record; `Subscriber` is the runtime callback. |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/SubscriberMode.java` | NEW — `enum { COLD, REPLAY, TRANSITION, LIVE, SUSPENDED }`. |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/SubscriberSupervisor.java` | NEW — per-subscriber supervisor (AMD-42 §3.4.5). Package-private. |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/SubscriberDlq.java` | NEW — per-subscriber DLQ (in-memory ring + persistent overflow stub; M3.5b completes the persistent path). Package-private. |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/ReplayWindowQueue.java` | NEW — bounded in-memory queue for events arriving during REPLAY (drained in TRANSITION). Package-private. |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/SubscriberRuntime.java` | NEW — internal bundle: VT, connection, supervisor, DLQ, mode ref, replay queue, self-filter (when applicable). Package-private. |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/SubscriberInfo.java` | **MODIFY** — extend the existing `SubscriberInfo` record (or replace with an interface, decision recorded in completion report) to expose `mode()`, `checkpoint()`, `dlqDepth()`, `crashCount()` for operator introspection. Current `SubscriberInfo` is a 3-field record (`subscriberId`, `filter`, `coalesceExempt`). |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/EventBus.java` | **MODIFY** — extend existing interface with `subscribeRuntime(SubscriberInfo info, Subscriber runtime)` (returns a handle exposing mode), `resume(String subscriberId)`, `subscriberInfo(String subscriberId)`, `subscribers()` for introspection. **Do NOT add a `publish()` method.** The existing `notifyEvent(long globalPosition)` and `subscriberPosition(String)` methods are retained. |
| `core/event-bus/src/testFixtures/java/com/homesynapse/event/bus/test/EventBusContractTest.java` | **MODIFY** — extend the existing 18-method contract suite with the new M3.1 methods (§4.4). Methods scheduled for M3.2/M3.3 land with `@Disabled("M3.2")` or `@Disabled("M3.3")` annotations as placeholders, removed when those milestones land. |
| `core/event-bus/src/test/java/com/homesynapse/event/bus/InProcessEventBusTest.java` | NEW — concrete subclass exercising `InProcessEventBus`. Lives in `src/test/java` (not testFixtures); uses the main `com.homesynapse.event.bus` package. |

**Note on the existing `Subscriber` vs `SubscriberInfo` split.** The Phase 2 design used `SubscriberInfo` as a registration descriptor and assumed subscriber callback behavior was supplied implicitly (e.g. via consumer registration). M3.1 makes the runtime callback explicit by introducing `Subscriber` (the `onEvent` / `onCaughtUp` callback interface). This is a small but important contract addition; the prompt MUST be explicit about it.

### 4.3 Interface signatures

```java
package com.homesynapse.event.bus;

/**
 * Notification-driven event distribution (Doc 01 §3.4).
 *
 * The bus does NOT publish events — that is EventPublisher's job. The bus
 * registers subscribers, evaluates filters, and wakes matching subscribers
 * via LockSupport.unpark() so they poll the EventStore directly.
 */
public interface EventBus {

    // ── Existing Phase 2 contract (preserved) ──────────────────────────
    void subscribe(SubscriberInfo subscriber);
    void unsubscribe(String subscriberId);
    void notifyEvent(long globalPosition);
    long subscriberPosition(String subscriberId);

    // ── New in M3.1 (AMD-42 lifecycle introspection and active runtime) ─
    /**
     * Registers a subscriber with an active runtime callback. The bus creates
     * the per-subscriber VT, connection, DLQ, supervisor, and (for derivation-
     * producing subscribers) self-filter. Returns immediately in COLD mode;
     * transition to REPLAY begins asynchronously on the subscriber's VT.
     */
    void subscribeRuntime(SubscriberInfo info, Subscriber runtime);

    /** Operator action: exits SUSPENDED, resets crash window, re-enters REPLAY. */
    void resume(String subscriberId);

    /** Read-only introspection of a single subscriber. */
    SubscriberSnapshot subscriberInfo(String subscriberId);

    /** Read-only introspection of all subscribers. */
    java.util.List<SubscriberSnapshot> subscribers();
}

public interface Subscriber {
    void onEvent(EventEnvelope event);
    default void onCaughtUp() { /* no-op */ }
}

public record SubscriberSnapshot(
    String subscriberId,
    SubscriberMode mode,
    long checkpoint,    // last delivered position; 0 if never delivered
    int dlqDepth,       // current DLQ size (in-memory + persistent)
    int crashCount      // crashes within current 10-min window
) {}

public enum SubscriberMode { COLD, REPLAY, TRANSITION, LIVE, SUSPENDED }
```

`SubscriptionFilter` (existing) is reused unchanged. The hint set already present on `SubscriptionFilter` (event-type, subject-type) is honored by M3.2's catch-up loop.

### 4.4 `EventBusContractTest` test methods added in M3.1

Added to the existing 18-method contract test (which already covers subscribe/unsubscribe lifecycle, filter evaluation, notification, checkpoint integration, and concurrent safety). New M3.1 methods:

**Mode state machine (active in M3.1):**
- `subscribeRuntimeStartsInColdMode()`
- `subscriberTransitionsColdToReplayOnFirstScheduling()` — minimal: assert mode reaches REPLAY; full REPLAY behavior validated in M3.2.
- `modeReferenceIsAtomicAcrossConcurrentObservers()` — multiple threads reading `subscriberInfo(id).mode()` concurrently see consistent values.
- `unsubscribeClosesSubscriberRuntime()` — VT terminates, connection released, DLQ flushed to persistent.

**Per-subscriber isolation (active in M3.1):**
- `INV_SUB_ISO_01_oneVirtualThreadPerSubscriber()` — register 3 subscribers; assert 3 VTs named `hs-sub-<id>` exist.
- `INV_SUB_ISO_02_oneReadConnectionPerSubscriber()` — register 3 subscribers; assert 3 connection slots reserved (via fixture introspection on the executor's slot accounting).
- `INV_SUB_ISO_03_oneDlqPerSubscriber()` — exception in subscriber A's `onEvent` lands in A's DLQ only; B's DLQ unchanged.
- `INV_SUB_ISO_04_oneModeRefPerSubscriber()` — SUSPEND A; assert B's mode unaffected.
- `INV_SUB_ISO_05_replayWindowQueueIsolated()` — placeholder asserting the per-subscriber `ReplayWindowQueue` field exists. Full behavior in M3.2.
- `INV_SUB_ISO_06_selfFilterIsolatedWhenPresent()` — placeholder. Full behavior in M3.5a.

**Supervisor (active in M3.1):**
- `supervisorCatchesSubscriberException()` — exception in `onEvent` does not propagate to bus or affect other subscribers.
- `supervisorRecordsDlqEntryOnException()` — DLQ in-memory ring receives entry.
- `supervisorRetriesAfterBackoff()` — fake-clock advances 3s, retry occurs.
- `supervisorTripsCircuitBreakerAt5Crashes()` — 5 consecutive failures within 10 min → mode = SUSPENDED, no further deliveries.
- `circuitBreakerResumeRestoresDelivery()` — `resume()` clears crash window, returns to REPLAY.

**Lifecycle (active in M3.1):**
- `onCaughtUpDefaultNoOp()` — subscriber not overriding `onCaughtUp` does not throw.

**M3.2 placeholders (`@Disabled("M3.2")`):**
- `replayDeliversFromCheckpointForward()`
- `transitionDrainsReplayWindowQueue()`
- `liveTransitionFiresOnCaughtUpExactlyOnce()`
- `replayWindowOverflowAt10000IsCriticalAlert()`
- `multipleSubscribersInReplayDoNotInterfere()`
- `reconciliationOnVersionMismatch()`

**M3.3 placeholders (`@Disabled("M3.3")`):**
- `publishDoesNotBlockAt5000()`
- `publisherBlockedCountIncrements()`
- `writerQueueDepthGaugeSamplesOnEnqueueAndDequeue()`
- `subscriberLagGaugePopulatedAfterDelivery()`

### 4.5 Module isolation constraints introduced in M3.1

- **JPMS-enforced (not ArchUnit):** event-bus `module-info.java` does not `requires java.sql`, preventing any import of `org.sqlite.*` or `java.sql.Connection` at compile time. This is stronger than ArchUnit enforcement (compile-time guarantee vs test-time detection). The bus is wire-and-glue; SQLite access goes through the `core/persistence` adapter types.
- `NO_DIRECT_TIME_ACCESS` (preserved — not "introduced" by M3.1): this ArchUnit rule was already defined in `HomeSynapseArchRules.java` prior to M3.1. M3.1 verified it still passes for all new event-bus types. No new ArchUnit rules are introduced in M3.1.

### 4.6 Acceptance criteria

- All M3.1-active test methods (§4.4) GREEN.
- M3.2 and M3.3 placeholder methods present but `@Disabled` with the milestone reason.
- Module isolation constraints (§4.5) verified — JPMS compile-time checks pass, existing ArchUnit rules GREEN.
- `core/event-bus/MODULE_CONTEXT.md` updated to reflect new types (`Subscriber`, `SubscriberMode`, `SubscriberSnapshot`, `SubscriberSupervisor` (pkg-private), `SubscriberDlq` (pkg-private), `ReplayWindowQueue` (pkg-private), `SubscriberRuntime` (pkg-private)) and the extended `EventBus` interface. Note that production type count grows from 4 (Phase 2: `EventBus`, `SubscriberInfo`, `SubscriptionFilter`, `CheckpointStore`) to ~9 public + ~5 package-private.

Binary success criterion: `./gradlew :core:event-bus:check` GREEN.

### 4.7 Cowork prompt scope (M3.1)

#### The prompt MUST specify

- The file list (§4.2) including which files are NEW vs MODIFY.
- The complete `EventBus` interface signature (§4.3), with the explicit instruction "**Do NOT add a `publish()` method.** The bus is notification-only per Doc 01 §3.4 and the existing `EventBus.java` Javadoc."
- The new types' signatures: `Subscriber`, `SubscriberMode`, `SubscriberSnapshot`.
- The full list of M3.1-active contract test methods (§4.4) and the placeholder list with their `@Disabled("M3.X")` annotations.
- AMD citations: AMD-42 §3.4.1 through §3.4.6, AMD-39 (clock), AMD-26 / AMD-27 (writer threading — relevant because the supervisor scheduler shares a `ScheduledExecutorService` whose threads must be platform threads if used to dispatch DB operations, but for bus-internal scheduling virtual threads are fine).
- The package convention: all production code in `com.homesynapse.event.bus` (flat). Test fixtures additions in `com.homesynapse.event.bus.test`. Unit tests in `com.homesynapse.event.bus`.
- The module isolation constraints (§4.5) — note that JDBC isolation is JPMS-enforced, not ArchUnit.
- The note that `SubscriberInfo` is being extended (or replaced with an interface) — Coder picks but reports the choice; the new shape MUST include `mode()`, `checkpoint()`, `dlqDepth()`, `crashCount()` accessors or there must be a separate `SubscriberSnapshot` record (the §4.3 example uses the snapshot record approach).

#### The prompt MUST NOT specify

- Internal implementation of the supervisor's exponential backoff math (the parameters 3s/30s/0.2 jitter are fixed; the implementation chooses the formula).
- The specific data structure for the DLQ in-memory ring (`ArrayDeque`, `RingBuffer`, etc. — Coder picks).
- The specific data structure for the replay window queue (Coder picks among `ArrayBlockingQueue`, `MpscArrayQueue`, etc.).
- Logging messages.

#### STOP-on-Mismatch verification gates

- `core/event-bus/MODULE_CONTEXT.md` — confirm the current type count is 4 and the package is `com.homesynapse.event.bus`.
- `core/event-bus/src/main/java/com/homesynapse/event/bus/EventBus.java` — confirm the current signature has exactly 4 methods: `subscribe`, `unsubscribe`, `notifyEvent`, `subscriberPosition`. NO `publish` method.
- `core/event-bus/src/main/java/com/homesynapse/event/bus/SubscriberInfo.java` — confirm it is currently a 3-field record.
- `core/event-bus/src/testFixtures/java/com/homesynapse/event/bus/test/EventBusContractTest.java` — confirm it exists with 18 methods and uses the `.test` sub-package.
- `core/event-model/src/main/java/com/homesynapse/event/EventPublisher.java` — confirm its two-method signature is `publish(EventDraft, CausalContext)` and `publishRoot(EventDraft)`. This is the publish surface; the bus does not replicate it.
- AMD-42 file at `homesynapse-core-docs/design/amendments/AMD-42-subscriber-lifecycle-and-isolation.md` exists.

#### Completion report format

1. **Files written.**
2. **AMD citations relied on** (AMD-42 §3.4.1..§3.4.6, AMD-39, AMD-26, AMD-27).
3. **STOP-on-Mismatch gate results** (PASS/MISMATCH per gate).
4. **Contract test method roster** — explicit list of active methods + `@Disabled` placeholders with their milestone tags.
5. **ArchUnit rule confirmation** — rule class file written; the two named rules assert correctly.
6. **`SubscriberInfo` evolution choice** — extension vs replacement with interface, with rationale.
7. **Verification commands for Nick**: `./gradlew :core:event-bus:check`.
8. **Open questions** (if any).

#### Binary success criterion

`./gradlew :core:event-bus:check` GREEN.

---

## 5. M3.5a: StateProjection vertical slice

### 5.1 Scope and rationale

DEC-M3-11 places M3.5a immediately after M3.1 and before M3.2. The reason: the two-phase read/write discipline (AMD-41 §3.2.1) makes assumptions about cross-executor handoff that are easy to get wrong if discovered late. M3.5a builds a minimal but end-to-end-functional `StateProjection` against an in-memory bus fixture and the in-memory `EventStore` testFixture, validating that:

- The two-phase discipline (read tx close → publish → checkpoint) holds in code.
- The self-produced filter behaves correctly in LIVE mode (REPLAY/TRANSITION semantics validated in M3.2).
- The AMD-26/27 handoff works when the projection's VT parks on the writer's platform thread (via `EventPublisher.publish` calls into the persistence layer).

M3.5a deliberately does **not** include: full DLQ retry counting (M3.5b), DLQ admin replay endpoint (M3.5b), or per-entity snapshots (deferred per DEC-M3-04 modified). It also does NOT include the SQLite-backed state store — that lands in M3.5b. M3.5a uses an `InMemoryStateStore` test fixture.

### 5.2 Files to create or modify (all in `core/state-store`, package `com.homesynapse.state`)

| Path | Purpose |
|---|---|
| `core/state-store/src/main/java/com/homesynapse/state/StateProjection.java` | NEW — the subscriber implementation. Implements `com.homesynapse.event.bus.Subscriber`. |
| `core/state-store/src/main/java/com/homesynapse/state/SelfProducedFilter.java` | NEW — AMD-41 §3.2.2 filter. Package-private. |
| `core/state-store/src/main/java/com/homesynapse/state/DerivationRule.java` | NEW — strategy interface for deriving `state_changed` events from inbound envelopes. Public (so other modules can supply rules in Phase 3+; but at M3.5a only state-store-internal rules exist). |
| `core/state-store/src/main/java/com/homesynapse/state/DerivationContext.java` | NEW — read-only view of prior state passed to `DerivationRule`. Public (for the rule SPI). |
| `core/state-store/src/main/java/com/homesynapse/state/StateStore.java` | NEW — port interface for state holding. `InMemoryStateStore` (M3.5a fixture) and `SqliteStateStore` (M3.5b) implement. Public. |
| `core/state-store/src/main/java/com/homesynapse/state/DerivedWriteRateLimit.java` | NEW — AMD-43 §3.6.4 rate limit (200/s default for StateProjection). Public (constructor parameter to `StateProjection`). |
| `core/state-store/src/main/java/com/homesynapse/state/ProjectionId.java` | NEW — typed wrapper around String for projection identity (parallel to existing `EntityId` pattern). Public. |
| `core/state-store/src/testFixtures/java/com/homesynapse/state/InMemoryStateStore.java` | NEW — testFixture implementation. Lives in the testFixtures source set under the flat package `com.homesynapse.state` (NOT under `.test` — the `.test` sub-package convention is for abstract contract test bases, not for fixture implementations). |
| `core/state-store/src/testFixtures/java/com/homesynapse/state/test/SubscriberContractTest.java` | NEW — abstract contract test for any `Subscriber` implementation (not specifically StateProjection). |
| `core/state-store/src/testFixtures/java/com/homesynapse/state/test/StateProjectionContractTest.java` | NEW — specific contract test for `StateProjection`. |
| `core/state-store/src/test/java/com/homesynapse/state/InMemoryStateProjectionTest.java` | NEW — concrete subclass exercising `StateProjection` against in-memory fixtures. |
| `core/state-store/src/test/java/com/homesynapse/state/StateProjectionVerticalIT.java` | NEW — end-to-end test wiring `InProcessEventBus` + `InMemoryEventStore` + `InMemoryStateStore` + `StateProjection`. |

**Critical correction vs draft.** The draft's `SubscriberContract` (without "Test" suffix) lived in `src/test/`. The corrected pattern uses `*ContractTest` (with the "Test" suffix, matching `EventBusContractTest`) and lives in `src/testFixtures/` under the `.test` sub-package. Concrete test implementations live in `src/test/` and use the flat module package.

**Critical correction vs draft.** The draft used sub-packages `com.homesynapse.state.projection.*`. The corrected layout uses the flat `com.homesynapse.state` package; types like `StateProjection`, `SelfProducedFilter`, `DerivationRule`, etc. live alongside `EntityState`, `Availability`, `ViewCheckpointStore`, etc.

### 5.3 `StateProjection` constructor and lifecycle

```java
package com.homesynapse.state;

import com.homesynapse.event.EventEnvelope;
import com.homesynapse.event.EventPublisher;
import com.homesynapse.event.bus.Subscriber;
import com.homesynapse.event.bus.SubscriberMode;

import java.time.Clock;

public final class StateProjection implements Subscriber {

    public StateProjection(
        ProjectionId projectionId,
        int projectionVersion,
        ViewCheckpointStore checkpointStore,
        StateStore stateStore,
        DerivationRule rule,
        EventPublisher publisher,         // ← EventPublisher, NOT EventBus (corrected per §0.3)
        ProjectionAdvancer advancer,      // for the two-phase READ phase
        Clock clock,
        DerivedWriteRateLimit rateLimit,  // 200/s default per AMD-43 §3.6.4
        SelfProducedFilter selfFilter
    ) { /* ... */ }

    /**
     * Called by EventBus dispatch on the projection's VT. Implements
     * AMD-41 §3.2.1 two-phase discipline:
     *   1. READ phase: invoke advancer.advance(lastCheckpoint, batch, processor)
     *      where the processor loads prior state, applies rule, and buffers
     *      derived EventDraft instances. Read tx closes when advance returns.
     *   2. PUBLISH phase: for each buffered draft, rateLimit.acquire(),
     *      publisher.publish(draft, causalContext), selfFilter.record(envelope.eventId()).
     *   3. CHECKPOINT phase: viewCheckpointStore.writeCheckpoint(viewName, position, data)
     *      subject to AMD-38 cadence.
     */
    @Override
    public void onEvent(EventEnvelope inbound) {
        // Per-event handler is short — the bulk of work is in the advancer-driven
        // batch loop, which the bus dispatches via a separate code path for
        // efficiency. The onEvent shape exists for compatibility with the
        // Subscriber contract.
    }

    @Override
    public void onCaughtUp() { /* AMD-42 §3.4.3 firing — log INFO and continue */ }
}
```

**Note on `EventBus` access.** `StateProjection` does NOT take `EventBus` in its constructor. Subscription registration (calling `EventBus.subscribeRuntime(info, projection)`) happens in the wiring layer (`homesynapse-app` in M3.7; for M3.5a's vertical test, the test fixture wires it). The projection itself only needs `EventPublisher` (for derivation publishes) and the dependencies above.

### 5.4 `SelfProducedFilter` implementation

Per AMD-41 §3.2.2:

```java
package com.homesynapse.state;

import com.homesynapse.event.bus.SubscriberMode;
import com.homesynapse.platform.identity.Ulid;
import java.time.Clock;
import java.time.Duration;

final class SelfProducedFilter {

    SelfProducedFilter(Clock clock, Duration ttl);  // ttl = 60s for StateProjection

    /** Records this projection's own publish; called after EventPublisher.publish() succeeds. */
    void record(Ulid eventId);

    /** True iff eventId is in-set, not expired, AND mode == LIVE. Returns false in REPLAY/TRANSITION. */
    boolean isSelfProduced(Ulid eventId, SubscriberMode mode);

    /** Lazy eviction: scans expired entries inline on isSelfProduced; no background sweeper. */
    /* Internally: ConcurrentHashMap<Ulid, Instant> or equivalent.
       isSelfProduced removes expired entries inline. */
}
```

Key behaviors:
- `isSelfProduced(_, REPLAY) → false`, `isSelfProduced(_, TRANSITION) → false`, regardless of set membership.
- `eventId` is the `Ulid` from `EventEnvelope.eventId()`, not a `UUID`. Use `com.homesynapse.platform.identity.Ulid`.
- No hard cap; M3.4 validates the 60s × 100ev/s envelope.
- The filter is owned by the projection (per-subscriber state, INV-SUB-ISO-06), not a global service.

### 5.5 `SubscriberContractTest` (general — testFixtures)

This is the bus's subscriber-side contract — any `Subscriber` implementation, not specifically `StateProjection`. Methods:

- `subscriberReceivesEventsInPositionOrder()`
- `subscriberOnEventExceptionDoesNotKillSubscriber()` — supervisor catches, DLQ records, next event still delivered.
- `subscriberCheckpointAdvancesAfterOnEvent()`
- `subscriberRespectsModeBoundary()` — REPLAY-mode `EventPublisher.publish` from inside subscriber's batch processor throws `IllegalStateException`; LIVE-mode publish succeeds.

### 5.6 `StateProjectionContractTest` (specific — testFixtures)

- `readTxClosesBeforePublish()` — instrument with a fake `ProjectionAdvancer` that asserts the read-tx-closed boolean is `true` when `EventPublisher.publish` is invoked.
- `derivedEventCarriesIncrementedStateVersion()` — derived `state_changed` has `stateVersion = prior + 1`.
- `selfProducedFilterSuppressesReentrantDelivery()` — the derived event is re-delivered (the bus does fan out to all subscribers); the projection's filter suppresses re-derivation.
- `selfProducedFilterBypassedInReplay()`
- `stateVersionDefenceInDepthSuppressesEqualOrOlderDerivations()`
- `derivedWriteRateLimitedAt200()` — drive 1000 derivations in a fake-clock-controlled 1-second window; assert ≤ 200 emitted.
- `checkpointAdvancesAfterDerivedPublishesReturn()` — partial-derivation crash leaves checkpoint unmoved.
- `reconciliationOnVersionMismatch()` — projection-version persisted as 1, code reports 2; checkpoint discarded, replay-from-zero.
- `reconciliationHonorsAllowStaleSnapshotsFlag()` — flag set, WARN logged, replay-from-zero NOT triggered.

### 5.7 Vertical contract test (`StateProjectionVerticalIT`)

Sets up:
- An `InMemoryEventStore` (existing testFixture from `core/event-model`) seeded with 10 `device_observed` events.
- An `InProcessEventBus` (from M3.1) wired to the store.
- An `EventPublisher` (the InMemoryEventStore implements `EventPublisher`).
- An `InMemoryStateStore` (M3.5a fixture).
- A `StateProjection` subscriber with a `DerivationRule` that emits one `state_changed` per `device_observed` whose `value` differs from prior.
- A second subscriber (test spy) that records all events seen.

Asserts:
1. The spy sees 10 `device_observed` + 10 `state_changed` (= 20 events), all in `globalPosition` order.
2. The projection's `EntityState` map (in `InMemoryStateStore`) has the final values for each entity.
3. The `StateProjection` does NOT re-derive from its own `state_changed` events (the spy sees no third generation).
4. The projection's checkpoint advances to position 20 (10 inbound + 10 derived).
5. `onCaughtUp()` fires exactly once at the end of initial replay (note: M3.5a uses a synthetic catch-up trigger since full REPLAY→LIVE comes in M3.2).

### 5.8 Wiring details

- The bus is constructed with a `ScheduledExecutorService` from `Executors.newSingleThreadScheduledExecutor()` for the supervisor.
- The clock is a `FixedClock` test double (from `testing/test-support`); tests advance it explicitly.
- The `EventPublisher` is the `InMemoryEventStore` test fixture (which implements both `EventStore` and `EventPublisher`).
- The rate limit is constructed with the default 200/s but tests can override via constructor injection.
- The `ProjectionAdvancer` used in M3.5a is an `InMemoryProjectionAdvancer` (test fixture, lives in `core/state-store/src/testFixtures/java/com/homesynapse/state/InMemoryProjectionAdvancer.java`) backed by `InMemoryEventStore` — passes the `ProjectionAdvancerContractTest` from Deliverable 0.

### 5.9 Acceptance criteria

- All methods in §5.5, §5.6, and the vertical IT (§5.7) pass GREEN.
- ArchUnit rules pass, in particular `PROJECTION_NO_WRITE_BATCHER_THREAD` (AMD-41 validation gate).
- `core/state-store/MODULE_CONTEXT.md` cites AMD-41/42/43 and lists the new public types.
- All new types in `com.homesynapse.state` (flat package); no sub-packages.

Binary success criterion: `./gradlew :core:state-store:check` GREEN.

### 5.10 Cowork prompt scope (M3.5a)

#### The prompt MUST specify

- The file list (§5.2) with explicit "all production code in `com.homesynapse.state` flat package; testFixture contract test bases in `com.homesynapse.state.test` sub-package".
- The `StateProjection` constructor signature verbatim (§5.3) — **explicitly stating that the publish dependency is `EventPublisher`, NOT `EventBus`**.
- The `SelfProducedFilter` API surface (§5.4) including the `Ulid` parameter type (NOT `UUID`).
- The `SubscriberContractTest` and `StateProjectionContractTest` method lists (§5.5, §5.6).
- The vertical IT setup and assertions (§5.7) including the use of existing fixtures (`InMemoryEventStore` from `core/event-model` testFixtures; `InProcessEventBus` from M3.1; new `InMemoryStateStore` from this milestone).
- AMD citations: AMD-41 §3.2.1, §3.2.2, §3.2.4; AMD-42 §3.4.4 (per-subscriber resources); AMD-43 §3.6.4 (rate limit).
- The note that `InMemoryStateStore` is a deliberate scaffold — replaced in M3.5b by `SqliteStateStore`. The `StateStore` interface must be small enough that the replacement is mechanical.

#### The prompt MUST NOT specify

- The internal representation of `EntityState.attributes` (already a `Map<String, AttributeValue>` per the existing record — preserved).
- The internal `DerivationRule` strategy class names beyond `DerivationRule` itself.
- The implementation of the rate-limit token bucket (Coder picks: `Semaphore` + scheduled refill, etc. — but no third-party library unless already in the project's dependency declaration).
- Logging.

#### STOP-on-Mismatch verification gates

- `homesynapse-core-docs/design/amendments/AMD-41-state-projection-execution-model.md` exists.
- `core/state-store/MODULE_CONTEXT.md` exists with the post-M2→M3-bridge type inventory (12 public types).
- `core/event-bus/src/main/java/com/homesynapse/event/bus/EventBus.java` has the extended signatures from §4.3 (M3.1 landed) — **specifically no `publish()` method**.
- `core/event-bus/src/main/java/com/homesynapse/event/bus/Subscriber.java` exists with `onEvent` and default `onCaughtUp` (M3.1 landed).
- `core/state-store/src/main/java/com/homesynapse/state/ProjectionAdvancer.java` has the new processor-callback signature (Deliverable 0 landed).
- `core/state-store/src/main/java/com/homesynapse/state/ViewCheckpointStore.java` exists from M2.
- `core/state-store/src/main/java/com/homesynapse/state/EntityState.java` exists (9-field record).
- `core/event-model/src/main/java/com/homesynapse/event/EventPublisher.java` exists with `publish(EventDraft, CausalContext)` and `publishRoot(EventDraft)` signatures.

#### Completion report format

1. **Files written.**
2. **AMD citations relied on.**
3. **STOP-on-Mismatch gate results.**
4. **Contract test method roster** (§5.5 + §5.6 + the vertical IT).
5. **Internal design choices made** (e.g. "selected `Semaphore`-based rate limit; refill via `ScheduledExecutorService` shared with supervisor", "`DerivationContext` is a record with `EntityState prior` and `Clock clock`").
6. **Verification commands for Nick**: `./gradlew :core:state-store:check`.
7. **Open questions.**

#### Binary success criterion

`./gradlew :core:state-store:check` GREEN.

---

## 6. M3.2: REPLAY→LIVE transition

### 6.1 Scope

M3.2 implements the full three-phase REPLAY → TRANSITION → LIVE algorithm (AMD-42 §3.4.2), the reconciliation pass (AMD-41 §3.2.4), and `onCaughtUp()` firing semantics (AMD-42 §3.4.3). It unblocks all `@Disabled("M3.2")` placeholders from M3.1.

### 6.2 Files to create or modify (all in flat packages)

| Path | Change |
|---|---|
| `core/event-bus/src/main/java/com/homesynapse/event/bus/ReplayDriver.java` | NEW — package-private. Drives the page-replay loop, owns tail-detection logic. |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/TransitionCoordinator.java` | NEW — package-private. Drains the replay-window queue and atomically fires the LIVE switch + `onCaughtUp()`. |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/InProcessEventBus.java` | MODIFY — wires `ReplayDriver` and `TransitionCoordinator` into `subscribeRuntime` path. |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/ReplayWindowQueue.java` | COMPLETE — bounded queue with drain method (M3.1 created the stub). |
| `core/state-store/src/main/java/com/homesynapse/state/ReconciliationPass.java` | NEW — implements AMD-41 §3.2.4. Package `com.homesynapse.state` (flat). |
| `core/state-store/src/main/java/com/homesynapse/state/StateProjection.java` | MODIFY — wire reconciliation pass into cold-start path. |
| `core/event-bus/src/testFixtures/java/com/homesynapse/event/bus/test/EventBusContractTest.java` | MODIFY — un-disable M3.2 placeholders; complete assertions. |
| `core/event-bus/src/test/java/com/homesynapse/event/bus/ReplayTransitionIT.java` | NEW — end-to-end test of REPLAY→LIVE under continuous publish. |
| `core/state-store/src/testFixtures/java/com/homesynapse/state/test/ReconciliationContractTest.java` | NEW — reconciliation pass contract. |

### 6.3 Three-phase algorithm (implementation)

The `ReplayDriver` runs on the subscriber's VT after `subscribeRuntime()` returns. Pseudocode:

```
state = checkpointStore.readCheckpoint(subscriberId);  // 0 if none
modeRef.cas(COLD, REPLAY);
loop:
    page = projectionAdvancer.advance(state, MAX_REPLAY_PAGE, envelope -> {
        if (filter.matches(envelope)) {
            subscriber.onEvent(envelope);                 // sync, inside read tx — see note
            state = envelope.globalPosition();
        }
    });
    checkpoint cadence per AMD-38
    if not page.hasMore():
        modeRef.cas(REPLAY, TRANSITION);
        transitionCoordinator.drainAndPromote(subscriber, replayQueue, modeRef);
        break
```

**Note on "inside read tx" for the subscriber callback.** The `advance` contract (§3.5) forbids `EventPublisher.publish` from inside `processor.accept`. The bus enforces this by setting the calling VT's mode reference to REPLAY before invoking the processor; `StateProjection` is REPLAY-mode-aware and does not publish during REPLAY. Instead, it derives state into its in-memory `StateStore` and defers any `state_changed` emission until LIVE. This matches AMD-41 §3.2.1's two-phase discipline because in REPLAY there are no derived publishes to perform — the log is the source of truth and the projection's state is recomputed from existing `state_changed` events that were already in the log.

If a subscriber that should publish derived events runs in REPLAY (a future subscriber type, not `StateProjection`), it would buffer its intended emissions and replay them in TRANSITION. M3.2 does not implement this generic buffering — the only derived-publishing subscriber is `StateProjection`, which by design does not republish during catch-up.

### 6.4 `TransitionCoordinator.drainAndPromote`

```
drainAndPromote(subscriber, queue, modeRef):
    // queue contains events published during REPLAY, captured by InProcessEventBus.notifyEvent
    // at the moment of notification if any subscriber was in REPLAY at that time.
    while not queue.isEmpty():
        envelope = queue.poll()
        if envelope.globalPosition() > lastReplayedPosition:   // gap detection
            subscriber.onEvent(envelope)
            lastReplayedPosition = envelope.globalPosition()
    modeRef.cas(TRANSITION, LIVE)
    try { subscriber.onCaughtUp(); }                     // single-shot per AMD-42 §3.4.3
    catch (Throwable t) { supervisor.onSubscriberException(SYNTHETIC_CAUGHT_UP_EVENT, subscriber, t); }
```

The replay-window queue is populated by `InProcessEventBus.notifyEvent` only for subscribers currently in REPLAY: when a notification arrives, the bus iterates active subscribers and appends to each REPLAY-mode subscriber's queue (the LIVE-mode subscribers receive the notification via standard wake-and-poll). The queue is bounded at 10000 entries; overflow is a CRITICAL health alert (`subscriber.<id>.replay_window_overflow`) and causes the subscriber to restart REPLAY from the failing position.

### 6.5 Mode atomicity tests (un-disabled)

- `modeRefIsAtomicAcrossConcurrentObservers()` — already in M3.1, validated under load here.
- `replayDriverDoesNotMissEventsPublishedAtTailBoundary()` — `EventPublisher.publish` happens at the exact moment `advance` reports tail reached; the event must appear in the replay-window queue and be drained.
- `multipleSubscribersInReplayDoNotInterfere()` — two subscribers in REPLAY simultaneously; each sees its own queue, no cross-contamination (INV-SUB-ISO-05).

### 6.6 Integration test: continuous publish during restart, no events lost

`ReplayTransitionIT`:

1. Start bus, register subscriber S1 with a `DerivationRule` that records every received envelope's `eventId` to an external list.
2. Publish 1000 events via `EventPublisher.publish` / `publishRoot`.
3. Wait until S1's checkpoint reaches `globalPosition` 1000.
4. Simulate restart: close bus, recreate bus and S1 with the same `subscriberId`.
5. Concurrently: launch a publisher thread emitting 500 more events at 100/sec.
6. The new S1 starts COLD → REPLAY (reads checkpoint 1000) → processes new events as they arrive in REPLAY, then TRANSITION (drains anything published after `advance` saw the tail), then LIVE.
7. Assert: S1's recorded list contains exactly events 1..1500 in `globalPosition` order (after the restart, deduped against the externally-tracked emitted set), no duplicates, no gaps.
8. Assert: `onCaughtUp()` fired exactly once after restart.

### 6.7 AMD-41 §3.2.4 reconciliation pass (full implementation)

`ReconciliationPass` runs as a precondition inside `StateProjection`'s cold-start path:

```
on StateProjection construction or subscribe:
    persistedRecord = checkpointStore.readLatestCheckpoint(viewName);
    persistedVersion = persistedRecord.map(CheckpointRecord::projectionVersion).orElse(0);
    currentVersion = this.projectionVersion;
    if persistedVersion != currentVersion:
        if config.allowStaleSnapshots:
            log.warn("Stale snapshot allowed for {}: {} != {}", viewName, persistedVersion, currentVersion);
            // proceed without reset
        else:
            log.info("Reconciliation pass: discarding checkpoint for {} ({} != {})", ...);
            checkpointStore.writeCheckpoint(viewName, 0L, /* metadata bytes with reconciledAt */);
            stateStore.clear();
            // bus will detect checkpoint=0 and start REPLAY from zero on its next loop
```

The reconciliation timestamp and `fromVersion`/`toVersion` are encoded into the `data` byte array of `CheckpointRecord` (an existing 5-field record with a `byte[] data` slot designed exactly for this kind of opaque metadata). This avoids a schema migration. The Jackson codec serializes `Map.of("reconciledAt", ..., "fromVersion", ..., "toVersion", ...)` into the data slot.

**Open question §13.4 closed.** No V004 migration is needed for reconciliation metadata. The existing `CheckpointRecord.data` byte slot absorbs the metadata; this is exactly its design intent. The original draft's proposed V004 is dropped.

### 6.8 `ReconciliationContractTest` test method list

- `reconciliationDiscardsCheckpointOnVersionMismatch()`
- `reconciliationRecordsTimestampAndFromToVersionsInDataSlot()` — assert `CheckpointRecord.data` deserializes to a map containing the three keys.
- `reconciliationHonorsAllowStaleSnapshotsFlag()` — flag true, checkpoint preserved, WARN emitted.
- `reconciliationIsIdempotent()` — running reconciliation twice with same versions is a no-op after the first.
- `reconciliationOnDowngradeAlsoDiscards()` — version 2 → version 1 (downgrade) also triggers reset (symmetrical handling).

### 6.9 Acceptance criteria

- All M3.1 `@Disabled("M3.2")` placeholders un-disabled and GREEN.
- `ReplayTransitionIT` GREEN.
- `ReconciliationContractTest` GREEN.
- ArchUnit rules retained from M3.1 still GREEN.
- A `Subscriber`'s call to `EventPublisher.publish` from a REPLAY-mode batch context throws `IllegalStateException` (defence-in-depth from M3.1, now exercised).

Binary success criteria:
- `./gradlew :core:event-bus:check` GREEN.
- `./gradlew :core:state-store:check` GREEN.

### 6.10 Cowork prompt scope (M3.2)

#### The prompt MUST specify

- The file change list (§6.2).
- The `ReplayDriver` pseudocode (§6.3) as the algorithmic contract.
- The `TransitionCoordinator.drainAndPromote` pseudocode (§6.4).
- The replay-window queue's 10000-entry bound and the overflow-handling specification.
- The reconciliation algorithm (§6.7) including the **explicit instruction that reconciliation metadata goes into `CheckpointRecord.data` (no schema migration)**.
- AMD citations: AMD-42 §3.4.2 (three-phase), §3.4.3 (`onCaughtUp` semantics); AMD-41 §3.2.4 (reconciliation).
- The integration test scenario (§6.6) including the exact 1500-event count, 100/sec publishing rate, and the dedup-against-emitted-set assertion technique.
- The contract test method lists (§6.8 + un-disabled M3.1 methods).
- The note that NO new migration file is created in M3.2 (V004 is dropped; reconciliation metadata uses `CheckpointRecord.data`).

#### The prompt MUST NOT specify

- The internal class name of the queue overflow detector.
- The thread on which the reconciliation pass runs (the bus's subscriber VT is implied but Coder confirms).
- Logging messages.
- The Jackson serialization format of reconciliation metadata beyond "JSON map with three keys" (the existing Jackson codec from AMD-36 handles this).

#### STOP-on-Mismatch verification gates

- M3.1 landed: `EventBus.java` has the extended signatures from §4.3 (still no `publish()` method), contract test placeholders annotated `@Disabled("M3.2")` exist.
- M3.5a landed: `StateProjection.java` has the constructor from §5.3 (taking `EventPublisher`, not `EventBus`).
- AMD-41/42/43 exist in the docs repo.
- `core/state-store/src/main/resources/db/migration/V003__add_snapshots_and_drop_redundant_index.sql` exists (M2→M3 bridge artifact — already applied at boot via existing `SqlitePersistenceLifecycle`).
- `core/state-store/src/main/java/com/homesynapse/state/CheckpointRecord.java` exists with the 5-field record including `byte[] data` and `int projectionVersion`.

#### Completion report format

1. **Files written / modified.**
2. **AMD citations relied on.**
3. **STOP-on-Mismatch gate results.**
4. **Un-disabled placeholder list** confirming each `@Disabled("M3.2")` is now active and passing.
5. **New contract test methods** listed (§6.8 + the new mode-atomicity methods from §6.5).
6. **No-migration confirmation**: explicit statement that NO V004 migration file was created (reconciliation metadata uses `CheckpointRecord.data`).
7. **Verification commands for Nick**: `./gradlew :core:event-bus:check :core:state-store:check`.
8. **Open questions.**

#### Binary success criterion

`./gradlew :core:event-bus:check :core:state-store:check` GREEN.

---

## 7. M3.3: Backpressure metrics (no coalescing, no blocking)

### 7.1 Scope

M3.3 implements AMD-43 §3.6.2 (metrics), §3.6.3 (health signal), §3.6.4 (per-subscriber derived-write rate limit completion), and the `homesynapse.bus.publisher.blocked.count` counter (measurement, not block) from §3.6.1. It does NOT implement coalescing (DEC-M3-07, deferred) and does NOT introduce any blocking behavior in `EventPublisher.publish()` (DEC-M3-08 rejected).

If the per-subscriber rate limit was implemented during M3.5a (it must be — `StateProjection`'s constructor signature in §5.3 already accepts `DerivedWriteRateLimit`), M3.3's scope for the rate limit is the wiring of metrics emission and the production-default construction of the limit (rather than test-only stubs).

### 7.2 Files to create or modify (all in flat packages)

| Path | Change |
|---|---|
| `core/event-bus/src/main/java/com/homesynapse/event/bus/BusMetrics.java` | NEW — interface/façade over the shared observability adapter. |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/WriterQueueGauge.java` | NEW — gauge wrapper sampling writer queue depth on enqueue/dequeue. Package-private. |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/QueueSaturationHealthCheck.java` | NEW — emits WARN at 5000, CRITICAL at 10000 (per AMD-43 §3.6.3). Package-private. |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/InProcessEventBus.java` | MODIFY — wire `BusMetrics` into publish-path notification and subscriber dispatch. |
| `core/persistence/src/main/java/com/homesynapse/persistence/SqliteEventStore.java` | MODIFY — expose `queueDepth()` accessor (package-private or via a small dedicated interface) so `WriterQueueGauge` can sample it. Per the architecture invariants, the persistence module owns the WriteCoordinator and exposes its queue depth via a deliberate accessor. |
| `core/state-store/src/main/java/com/homesynapse/state/DerivedWriteRateLimit.java` | COMPLETE — production-default constructor + metric emission. |
| `core/event-bus/src/testFixtures/java/com/homesynapse/event/bus/test/EventBusContractTest.java` | MODIFY — un-disable M3.3 placeholders. |
| `core/event-bus/src/test/java/com/homesynapse/event/bus/BackpressureMetricsIT.java` | NEW. |

**Note on `SqliteEventStore.queueDepth()`.** The current `SqliteEventStore` is package-private; exposing `queueDepth()` requires either (a) a small public accessor interface in `core/persistence` (e.g., `WriteQueueObservable`) that `SqliteEventStore` implements and that `SqlitePersistenceLifecycle` returns to consumers, or (b) routing queue-depth observation through the existing observability adapter in `core/observability`. The Coder picks the approach and documents the choice; both preserve JPMS encapsulation. Cross-module dependency direction must remain `core/event-bus → core/observability` (allowed) — it must NOT become `core/event-bus → core/persistence` (forbidden by the architecture rules; persistence is at the leaf level for write coordination and the bus is at a higher level for distribution).

**Cross-module dependency note (important).** `core/event-bus` currently has `requires transitive com.homesynapse.event` and exports `com.homesynapse.event.bus`. It does NOT depend on `core/persistence`. The WriteQueue depth observation MUST be funneled through `core/observability` — the bus subscribes to a queue-depth gauge published by `core/persistence`. This preserves the inward-only dependency invariant. The Coder MUST surface this as an open question if `core/observability` does not yet expose a gauge-publishing port.

### 7.3 Metrics surface

`BusMetrics` exposes these methods (all delegate to the project's observability adapter — `core/observability` already provides the port from M2):

```java
package com.homesynapse.event.bus;

import java.time.Duration;

public interface BusMetrics {
    void recordPublishLatency(Duration d);
    void incrementPublisherBlocked();              // counts depth > 5000 observations
    void recordWriterQueueDepth(int depth);         // gauge sample
    void recordSubscriberLag(String subscriberId, long lagEvents, Duration lagMillis);
    void recordDerivedWriteAccepted(String subscriberId);
    void recordDerivedWriteParked(String subscriberId);  // when rate-limit bucket empty
}
```

The implementation is a thin adapter; the actual metric names are exactly those listed in AMD-43 §3.6.2 (the seven literal names).

### 7.4 Sampling discipline

- `homesynapse.bus.writer.queue.depth` is sampled on **every** enqueue and dequeue (not on a timer — guaranteed-fresh value at the cost of a hot-path call; sampling overhead is one `AtomicInteger.get()`).
- `homesynapse.bus.publish.latency` is recorded as a histogram in microseconds; recording is on the publishing VT, after `EventPublisher.publish()` returns.
- `homesynapse.bus.subscriber.lag.*` is sampled on every event delivery (after `onEvent` returns); this gives the lag of the *most recently delivered* event, which is the operationally meaningful number.
- `homesynapse.bus.publisher.blocked.count` is incremented at observation of depth > 5000 by the publisher's call site. The increment is unconditional — there is no debounce. **The publisher does NOT block; it only observes and records.**

### 7.5 Health signal mechanics

`QueueSaturationHealthCheck`:

- Runs on a single scheduled task (1-second tick) shared with the supervisor scheduler. Reads the latest `homesynapse.bus.writer.queue.depth` gauge value.
- Maintains two consecutive-tick counters: `warnTicks` and `criticalTicks`.
- Behavior per §3.6.3 of AMD-43 (above).
- Thresholds and tick counts operator-tunable per AMD-43 §3.6.3.

### 7.6 Per-subscriber derived-write rate limit (completion)

The token bucket inside `DerivedWriteRateLimit`:

- Bucket capacity: 200 tokens (default; constructor parameter).
- Refill: 200 tokens/sec, refilled by a single scheduled task on the supervisor scheduler ticking every 50ms (refill of 10 tokens per tick).
- `acquire()` is non-blocking-poll-then-park: if a token is available, decrement and return; if not, `BusMetrics.recordDerivedWriteParked(subscriberId)` and park on the bucket's `Semaphore` with the clock-aware refill releasing permits.
- Refill uses the injected `Clock` for the scheduled tick interval calculation (AMD-39).

The rate limit is **per-subscriber**, with separate bucket instances per `StateProjection`. The default 200/s is fixed by AMD-43 §3.6.4 for the `StateProjection` class; other future derived-publishing subscribers carry their own defaults.

### 7.7 Test methods un-disabled / new

From M3.1 `EventBusContractTest`:

- `publishDoesNotBlockAt5000()` — drive depth to 6000 by injecting a slow writer fixture; assert `EventPublisher.publish` latency p99 within 2× steady-state.
- `publisherBlockedCountIncrements()` — drive depth > 5000; assert the counter increments.
- `writerQueueDepthGaugeSamplesOnEnqueueAndDequeue()`
- `subscriberLagGaugePopulatedAfterDelivery()`

New methods (in `BackpressureMetricsIT` or `EventBusContractTest` extension):

- `queueSaturationWarnAt5000SustainedFor5Seconds()`
- `queueSaturationCriticalAt10000SustainedFor5Seconds()`
- `queueSaturationRecoveryInfoEmitted()`
- `derivedWriteRateLimitParksOver200PerSecond()`
- `derivedWriteRateLimitParkedCountIncrements()`

### 7.8 Acceptance criteria

- All un-disabled methods plus new methods GREEN.
- The shared observability adapter receives the seven metric names from §3.6.2 of AMD-43.
- The health channel `writer.queue.saturating` receives WARN and CRITICAL emissions correctly under simulated saturation.
- ArchUnit rule `EVENT_PUBLISHER_HAS_NO_DEPTH_GATED_LOCK` (AMD-43 invariant): no class in `core/persistence` or `core/event-bus` calls `Semaphore.acquire`, `Lock.lock`, or `Object.wait` keyed on queue depth from a code path reachable from `EventPublisher.publish()`.
- ArchUnit rule `BUS_METRICS_NOT_DIRECT_INSTANTIATION`: any metric emission MUST go through `BusMetrics`; no class outside the bus's `BusMetrics` implementation directly constructs an observability primitive.

Binary success criterion: `./gradlew :core:event-bus:check :core:state-store:check` GREEN.

### 7.9 Cowork prompt scope (M3.3)

#### The prompt MUST specify

- The file list (§7.2).
- The `BusMetrics` interface methods verbatim (§7.3).
- The seven exact metric names from AMD-43 §3.6.2 (the Coder MUST use these literal names — observability is brittle to renames).
- The sampling discipline (§7.4) — enqueue/dequeue sampling is mandatory; the Coder cannot substitute a 1-second poll.
- The health-check tick algorithm (§7.5) including the thresholds, tick count, and re-emit cadences.
- The rate-limit refill algorithm (§7.6) — 50ms ticks × 10 tokens.
- AMD citations: AMD-43 §3.6.1, §3.6.2, §3.6.3, §3.6.4.
- The instruction that `EventPublisher.publish()` MUST remain non-blocking on backpressure (INV-BUS-02 normative); the prompt MUST explicitly forbid any `wait`, `Lock.lock`, or `Semaphore.acquire` in the publish path keyed on queue depth.
- The explicit cross-module dependency direction rule: `core/event-bus` MUST NOT add a `requires` on `core/persistence`. Queue-depth observation goes through `core/observability`.

#### The prompt MUST NOT specify

- The internal observability adapter class names (already exist in `core/observability`).
- The histogram implementation (HdrHistogram vs simple percentile estimators — Coder picks among what's already in the dependency graph).
- The exact thread pool sizing for the saturation health check (it shares the supervisor scheduler per §7.5).
- Logging.

#### STOP-on-Mismatch verification gates

- M3.1 + M3.5a + M3.2 landed (bus + projection + REPLAY→LIVE all present).
- `core/observability/src/main/java/com/homesynapse/observability/` exists and exposes the metric primitive port.
- `core/event-bus/build.gradle.kts` does NOT have `implementation(project(":core:persistence"))`. If a gauge-publishing port is missing from `core/observability`, the Coder MUST STOP and report.
- AMD-43 file exists with §3.6.1 through §3.6.4 as specified.

#### Completion report format

1. **Files written / modified.**
2. **AMD citations relied on.**
3. **STOP-on-Mismatch gate results** including the explicit cross-module dependency check.
4. **Metric name roster** (literal names) confirming all seven from AMD-43 §3.6.2 are emitted.
5. **Health channel verification** (test methods that assert WARN/CRITICAL/INFO emissions).
6. **Un-disabled placeholder list.**
7. **Verification commands for Nick**: `./gradlew :core:event-bus:check :core:state-store:check`.
8. **Open questions** — in particular, surface whether the 200/s default has been validated against the M3.4 throughput floor (if not, M3.4 is the validation point) and whether the chosen queue-depth observation path goes through `core/observability` without introducing a forbidden bus → persistence dependency.

#### Binary success criterion

`./gradlew :core:event-bus:check :core:state-store:check` GREEN.

---

## 8. M3.4: Integration tests

### 8.1 Scope

M3.4 is the empirical validation milestone. It does not introduce new production code (modulo small wiring fixes discovered during testing); it introduces test infrastructure that runs on **throttled Pi-4-equivalent test environments** in CI, plus an explicit on-device Pi 4 validation step that Nick runs out-of-band before declaring M3.4 done.

DEC-M3-12 (modified) makes Pi 4 the supported floor; M3.4 is the gate that decides whether AMD-38's universal 200-event / 2-second checkpoint cadence holds on Pi 4 or whether a platform-tuned cadence is needed (and deferred into a separate post-M3 amendment).

### 8.2 Module placement note (corrected from draft)

The draft placed integration tests under `core/integration-tests/`. **This path is not valid** for two reasons:

1. There is no `core:integration-tests` module in `settings.gradle.kts`. M3.4 must either (a) create a new module or (b) use an existing module's test source set.
2. Repo-level ArchUnit rule `:core:.* -X> :integration:.*` (and parallel rules against `:api:`, `:app:`, `:lifecycle:`) means a module under `core/` cannot exercise the full stack. The M3.4 scope happens to stay within `:core:` + `:observability:`, but placing the module there is misleading and forecloses future cross-stack tests.

**The corrected placement is `testing/integration-tests/`** — a new module under the `testing/` tree, alongside the existing `testing:test-support`. The repo-level ArchUnit rules already authorize `:testing:.* -> :core:.*`, `:testing:.* -> :integration:integration-api`, and `:testing:.* -> :platform:platform-api`. This module gets a `library-conventions` plugin application and a `requires` dependency on the modules under test via the JPMS `module-info.java`.

**Alternative considered:** Per-module `src/integrationTest/` source sets in each of `core:event-bus`, `core:persistence`, `core:state-store`. Rejected because the M3.4 tests cross module boundaries (a single test exercises bus + persistence + state-store + projection together), and a per-module source set forces either duplication or unnatural module ownership. A dedicated `testing:integration-tests` module is the natural seam.

**This placement decision is recorded as DEC-M3-13 (post-deliberation):**

> **DEC-M3-13.** M3.4 integration tests live in a new Gradle module `testing:integration-tests` with `library-conventions` plugin and JPMS `requires` clauses for `com.homesynapse.event`, `com.homesynapse.event.bus`, `com.homesynapse.persistence`, `com.homesynapse.state`, `com.homesynapse.observability`. The module is added to `settings.gradle.kts` as `include("testing:integration-tests")`. Test classes go in `src/test/java/com/homesynapse/it/` under flat package `com.homesynapse.it`.

### 8.3 Files to create

| Path | Purpose |
|---|---|
| `testing/integration-tests/build.gradle.kts` | Module build script — `library-conventions`, JPMS test runtime config, Pi-profile properties wiring. |
| `testing/integration-tests/src/main/java/module-info.java` | Empty production module-info (the module has no production code, only tests). |
| `testing/integration-tests/src/test/java/com/homesynapse/it/Pi4SustainedLoadIT.java` | 100 events/sec × 1 hour, WAL bounded. |
| `testing/integration-tests/src/test/java/com/homesynapse/it/BurstLoadIT.java` | 100 entities × 5 events × 1 sec. |
| `testing/integration-tests/src/test/java/com/homesynapse/it/CrashRecoveryIT.java` | Mid-write crash; restart; verify no-loss/no-duplicate. |
| `testing/integration-tests/src/test/java/com/homesynapse/it/Pi4D1SpikeIT.java` | SD-card D1-spike equivalent: simulate `fsync` latency spikes; assert AMD-38 cadence does not collapse. |
| `testing/integration-tests/src/test/java/com/homesynapse/it/HeapBudgetIT.java` | 3000-entity load; assert resident heap ≤ 256 MB. |
| `testing/integration-tests/src/test/resources/pi4-throttled.properties` | Test profile: CPU pinning hints, disk-throttle parameters, GC flags matching Pi 4 production. |
| `scripts/pi4-validation.sh` | On-device runner script Nick invokes manually on `hs-dev-1` for the full-hour run. |
| `settings.gradle.kts` | Add `include("testing:integration-tests")` (already 19 modules; this is module 20). |

The `testing/integration-tests` module's `module-info.java` is empty because the module has no production code; the test classes are in the unnamed test module per the existing `library-conventions` test setup.

### 8.4 Test environment ("Pi-4-equivalent")

The CI Pi-4-equivalent profile applies the following constraints inside a single JVM:

- `-Xmx256m -Xms256m` (memory ceiling matching Pi 4 production heap envelope).
- `-XX:ActiveProcessorCount=4` (Pi 4 has 4 cores).
- `-XX:+UseG1GC -XX:MaxGCPauseMillis=100` (production GC flags).
- A `Disk` test double layered over the on-disk SQLite file that injects configurable `fsync` latencies: baseline 10ms, D1-spike events at 200ms with 0.5% probability (modeling observed SD-card behavior).

The profile is selected by Gradle property `-PpiProfile=throttled`. CI runs `:testing:integration-tests:test -PpiProfile=throttled` on every PR; the on-device Pi 4 validation is a manual step Nick runs before M3.4 sign-off via `scripts/pi4-validation.sh`.

### 8.5 `Pi4SustainedLoadIT` — sustained-load test

Configuration:
- Publishing rate: 100 events/sec, sustained for 1 hour wall-clock (CI may scale down to 10 minutes with `-PsustainedMinutes=10`; on-device run uses the full hour).
- One `StateProjection` subscriber.
- One spy subscriber.
- Event mix: 80% `device_observed`, 20% other types.

Assertions:
- WAL file size at end of test ≤ 100 MB (AMD-38's bound).
- No `homesynapse.bus.publisher.blocked.count` increment (no event observed depth > 5000).
- Subscriber lag p99 ≤ 500ms.
- No SUSPENDED transitions.
- No DLQ entries.
- Checkpoint advancements occurred at the AMD-38 cadence (counted via metric — between 200 and 250 checkpoint writes for the hour-long 100/s test = 360,000 events ⇒ ≥ 1800 checkpoints).

### 8.6 `BurstLoadIT` — burst-load test

Configuration:
- 100 entities, each emits 5 `device_observed` events within a 1-second window (500 events total).
- One `StateProjection` subscriber.

Assertions:
- All 500 events ingested within 5 seconds (200 events/sec ingest floor).
- Derived `state_changed` count ≤ 500 (rate limit holds: 200/s × ~2.5s drain = 500 max). If derivation logic produces one `state_changed` per inbound, the count should be exactly 500 and arrive over 2.5 seconds due to the 200/s cap.
- No DLQ entries.
- `homesynapse.bus.derived.writes.rate` gauge for the subscriber peaks at ~200/s.

### 8.7 `CrashRecoveryIT` — crash-recovery test

Configuration:
- Publish 5000 events; let the projection process to position ~3000.
- Kill the JVM (`-XX:OnOutOfMemoryError`-style hard exit injected via a test helper that calls `Runtime.halt(137)`).
- Restart the JVM, recreate the bus + projection with the same `subscriberId`.

Assertions:
- Projection's checkpoint at restart is ≤ 3000 (AMD-38's at-most-2-seconds-of-loss bound; combined with the 200-event bound, the checkpoint at the moment of kill is between (lastCheckpoint - 200 - 2s_worth_of_events) and lastCheckpoint).
- After restart, REPLAY processes from checkpoint to 5000, then TRANSITION drains any in-flight, then LIVE.
- No event is delivered more than twice to the projection (at-most-twice is the at-least-once + checkpoint-window combination; the projection's derivation logic must be idempotent against this, which AMD-41 §3.2.2 `stateVersion` defence-in-depth guarantees).
- `onCaughtUp()` fires once.

### 8.8 `Pi4D1SpikeIT` — SD-card D1 spike equivalent

Configuration:
- Throttled disk double injects 200ms `fsync` latency events at 0.5% probability.
- Publishing rate: 50 events/sec for 30 minutes.

Assertions:
- AMD-38 cadence holds: checkpoint cadence is event-driven (200) OR time-driven (2s), so D1 spikes that delay an `fsync` lengthen the time-driven cadence but the event-driven trigger still fires.
- Subscriber lag p99 ≤ 1500ms during the test (D1 spikes elevate the tail; this is acceptable per the M3.4 budget).
- No SUSPENDED transitions.
- No WAL unbounded growth (≤ 50 MB at end).

### 8.9 `HeapBudgetIT` — Pi 4 memory envelope

Configuration:
- 3000 distinct entities, each emitting 1 event per minute.
- One `StateProjection` subscriber holding all 3000 in `EntityState` map.
- Test runs 10 minutes; samples resident heap every 30 seconds.

Assertions:
- Peak resident heap (after a full GC, captured via `MemoryMXBean`) ≤ 256 MB.
- No `OutOfMemoryError` thrown.
- `SelfProducedFilter` size remains bounded (it should hold at most 60s × 50ev/s = 3000 entries given the 1-event-per-entity-per-minute pattern).

This test corresponds to the ArchUnit budget test referenced in DEC-M3-12; it is the runtime counterpart to the static check.

### 8.10 Acceptance criteria

- All five integration tests GREEN under `-PpiProfile=throttled` in CI.
- On-device Pi 4 run of `Pi4SustainedLoadIT` (1-hour version) reported by Nick as GREEN.
- Decision recorded in `homesynapse-core-docs/log/M3.4-pi4-validation.md`: either "AMD-38 cadence retained on Pi 4" (the expected outcome) or "platform-tuned cadence required — file follow-up amendment AMD-44".

Binary success criterion: `./gradlew :testing:integration-tests:test -PpiProfile=throttled` GREEN; Nick attests Pi 4 on-device run GREEN.

### 8.11 Cowork prompt scope (M3.4)

#### The prompt MUST specify

- The file list (§8.3) including the `settings.gradle.kts` edit to add `include("testing:integration-tests")`.
- The test environment profile parameters (§8.4): `-Xmx256m`, `-XX:ActiveProcessorCount=4`, GC flags, disk-throttle parameters.
- The five test scenarios with their exact event counts, durations, and assertion bullet lists (§8.5..§8.9).
- The `-PsustainedMinutes` Gradle property for CI vs full-hour scaling (§8.5).
- AMD citations: AMD-38 (cadence), AMD-41 (projection discipline), AMD-42 (lifecycle), AMD-43 (metrics + rate limit), DEC-M3-12 modified (Pi 4 envelope), DEC-M3-13 (module placement).
- The format of the post-test decision log file `M3.4-pi4-validation.md`.
- The exact metric names (with `homesynapse.bus.*` prefix) the assertions reference — these MUST match what M3.3 emitted.

#### The prompt MUST NOT specify

- The exact API of the disk-throttle test double (Coder picks; the contract is "configurable fsync latency injection").
- Internal class names or test fixture organization within the test source set.
- Logging.
- The CI runner configuration (Nick owns the GitHub Actions / equivalent setup).

#### STOP-on-Mismatch verification gates

- M3.1 + M3.5a + M3.2 + M3.3 all landed.
- AMD-38 / AMD-41 / AMD-42 / AMD-43 exist in the docs repo.
- `testing/integration-tests/` directory does NOT yet exist (gate confirms the creation site is correct).
- `settings.gradle.kts` does NOT yet have `include("testing:integration-tests")` (gate confirms the new module is being created, not reused).
- `core:event-bus`, `core:persistence`, `core:state-store`, and `observability:observability` modules all exist and expose either a public API or testFixtures jar usable from `testing:integration-tests`.
- If `core:state-store` does not expose `InMemoryEventStore` or equivalent in-process driver primitives, the Coder MUST STOP and report.

#### Completion report format

1. **Files written / modified** including the `settings.gradle.kts` edit.
2. **AMD citations relied on.**
3. **STOP-on-Mismatch gate results.**
4. **Test scenario roster** (five tests, each with the assertion count).
5. **Disk-throttle double API** (Coder reports the chosen contract).
6. **CI Gradle properties** introduced (`-PpiProfile`, `-PsustainedMinutes`).
7. **Verification commands for Nick**: `./gradlew :testing:integration-tests:test -PpiProfile=throttled`; manual on-device Pi 4 invocation script `scripts/pi4-validation.sh` (Coder produces the script file but does NOT run it).
8. **Open questions** — in particular, any AMD-38 cadence concerns surfaced empirically, and whether `scripts/pi4-validation.sh` needs to ssh to `hs-dev-1` or run locally.

#### Binary success criterion

`./gradlew :testing:integration-tests:test -PpiProfile=throttled` GREEN. Pi 4 on-device run attested by Nick.

---

## 9. M3.5b: StateProjection completion

### 9.1 Scope

M3.5b completes the persistent and operational features of `StateProjection` that M3.5a stubbed:

- **Wire V002 into the migration lifecycle.** The `V002__subscriber_dead_letter_queue.sql` file already exists in `core/persistence/src/main/resources/db/migration/events/` but is NOT in `SqlitePersistenceLifecycle.EVENTS_MIGRATION_FILES`. M3.5b adds it.
- **Persistent DLQ.** Populate and read the `subscriber_dead_letters` table per AMD-36 schema (see §9.3).
- **DLQ retry counting** with per-subscriber maximum-attempts policy.
- **DLQ admin API endpoint** (`POST /admin/dlq/replay`) in `api/rest-api`.
- **`ProjectionRebuild`** API for operator-initiated full replay.
- **Swap of `InMemoryStateStore`** (M3.5a testFixture) for a SQLite-backed `SqliteStateStore` in production wiring.

**Explicitly deferred** per DEC-M3-04 modified:

- `SqliteSnapshotStore` implementation. V003 created the `snapshots` table, but no application code reads or writes it. The trigger to land this work is empirical: full replay exceeds 5 seconds wall-clock on Pi 4 reference hardware (as measured in M3.4).

### 9.2 Source-of-truth notes (corrected from draft)

The draft made the following factual errors that this corrected plan resolves:

| Draft claim | Source-verified reality |
|---|---|
| DLQ table is `dlq_entries`. | Table is `subscriber_dead_letters` (created by V002, 11 columns per AMD-36). |
| DLQ has a `status ∈ {PENDING, RETRYING, GAVE_UP}` column. | AMD-36 schema has NO status column. The row's existence IS the parked state. |
| Retry cap is 10 attempts. | AMD-36 §INV-ES-05 refinement: default cap is **5 attempts** (including initial). |
| Replay creates new DLQ rows on failure. | AMD-36 `UNIQUE(subscriber_id, event_position)`: replay failure UPDATEs the existing row (increments `attempt_count`), never inserts a duplicate. |
| Migration `V005__dlq_entries_indices.sql` in `core/state-store/src/main/resources/db/migration/`. | Migrations live in `core/persistence/src/main/resources/db/migration/events/`. The next available migration number is **V004** (since §6's corrected plan dropped the proposed reconciliation-metadata V004). |
| `SqliteStateStore` lives in `core/state-store`. | By precedent (`SqliteEventStore` lives in `core/persistence`), `SqliteStateStore` belongs in `core/persistence`. The `core/state-store` module defines the `StateStore` port (M3.5a) and the testFixture `InMemoryStateStore`; `core/persistence` provides the production SQLite adapter. |
| Admin endpoints in `core/api/`. | API module is `api/rest-api/`. Package is `com.homesynapse.api.rest` (flat per module). |
| Sub-packages `event/bus/subscriber/`, `state/projection/`, `api/admin/`. | Flat package convention: all event-bus types in `com.homesynapse.event.bus`; all state-store types in `com.homesynapse.state`; all rest-api types in `com.homesynapse.api.rest`. |

### 9.3 Files to create or modify

| Path | Change |
|---|---|
| `core/event-bus/src/main/java/com/homesynapse/event/bus/SubscriberDlq.java` | NEW — public class. In-memory ring (1024) + persistent overflow writer. Package-private collaborators allowed. |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/DeadLetter.java` | NEW — public record mirroring the `subscriber_dead_letters` row shape (§9.4). |
| `core/event-bus/src/main/java/com/homesynapse/event/bus/SubscriberMaxRetries.java` | NEW — public record `SubscriberMaxRetries(int value)` with `DEFAULT = 5` (AMD-36) and validation (`value >= 1`). |
| `core/persistence/src/main/java/com/homesynapse/persistence/SqliteStateStore.java` | NEW — package-private final implementation of `StateStore` (the port lives in `core/state-store`). Wires through `DatabaseExecutor` per AMD-26/27. |
| `core/persistence/src/main/java/com/homesynapse/persistence/SqliteDeadLetterStore.java` | NEW — package-private final. Routes DLQ writes through `WriteCoordinator` and atomically pairs the park INSERT with the checkpoint UPDATE per AMD-36's atomicity requirement. |
| `core/persistence/src/main/java/com/homesynapse/persistence/SqlitePersistenceLifecycle.java` | MODIFY — change `EVENTS_MIGRATION_FILES` constant from `List.of("V001__initial_event_store_schema.sql")` to `List.of("V001__initial_event_store_schema.sql", "V002__subscriber_dead_letter_queue.sql", "V003__add_snapshots_and_drop_redundant_index.sql", "V004__dlq_indices.sql")`. |
| `core/persistence/src/main/resources/db/migration/events/V004__dlq_indices.sql` | NEW — additive indices on `(subscriber_id)` and `(subscriber_id, last_attempt_at)` for admin query efficiency. (V002 created the table; V004 adds operational indices now that admin queries exist.) |
| `core/state-store/src/main/java/com/homesynapse/state/StateProjection.java` | MODIFY — constructor signature unchanged from M3.5a (`StateStore` port already injected). Production wiring (in `lifecycle/`) swaps the M3.5a `InMemoryStateStore` fixture for the new `SqliteStateStore`. |
| `core/state-store/src/main/java/com/homesynapse/state/ProjectionRebuild.java` | NEW — public class. Orchestrates: SUSPEND subscriber → `ViewCheckpointStore.reset(viewName)` → `StateStore.clear(viewName)` → `EventBus.resume(subscriberId)` → REPLAY from position 0. |
| `api/rest-api/src/main/java/com/homesynapse/api/rest/DlqAdminEndpoint.java` | NEW — HTTP handler for `POST /admin/dlq/replay`. Flat package. |
| `api/rest-api/src/main/java/com/homesynapse/api/rest/ProjectionRebuildEndpoint.java` | NEW — HTTP handler for `POST /admin/projection/{id}/rebuild`. Flat package. |
| `api/rest-api/src/main/java/com/homesynapse/api/rest/ProjectionStatusEndpoint.java` | NEW — HTTP handler for `GET /admin/projection/{id}/status` (polled by operators after rebuild). |
| `core/event-bus/src/testFixtures/java/com/homesynapse/event/bus/test/DlqContractTest.java` | NEW — abstract DLQ contract test base. `.test` sub-package per testFixtures convention. |
| `core/event-bus/src/test/java/com/homesynapse/event/bus/InMemoryDlqContractTest.java` | NEW — concrete extension running the contract against an in-memory `SubscriberDlq`. |
| `core/persistence/src/test/java/com/homesynapse/persistence/SqliteDeadLetterStoreContractTest.java` | NEW — concrete extension running the contract against the SQLite-backed DLQ. |
| `core/state-store/src/testFixtures/java/com/homesynapse/state/test/ProjectionRebuildContractTest.java` | NEW — abstract contract test base. |
| `core/state-store/src/test/java/com/homesynapse/state/ProjectionRebuildTest.java` | NEW — concrete extension. |
| `api/rest-api/src/test/java/com/homesynapse/api/rest/DlqAdminEndpointTest.java` | NEW — HTTP-layer test (matching the existing rest-api testing pattern). |
| `api/rest-api/src/test/java/com/homesynapse/api/rest/ProjectionRebuildEndpointTest.java` | NEW. |

### 9.4 DLQ row shape (verbatim from V002 / AMD-36)

The `DeadLetter` record in `core/event-bus/src/main/java/com/homesynapse/event/bus/DeadLetter.java` mirrors the table:

```java
public record DeadLetter(
    long dlqId,
    String subscriberId,
    String sequenceKey,        // hex-encoded subject_ref ULID
    long eventPosition,        // global_position from events table
    Ulid eventId,              // BLOB(16) → Ulid (uses LTD-04 wrapper handling)
    String causeClass,         // e.g. "java.lang.ClassCastException"
    String causeMessage,
    int attemptCount,          // total attempts including initial (≥1)
    Instant firstSeenAt,       // Unix micros stored as long; record exposes Instant
    Instant lastAttemptAt,
    String diagnostics         // nullable
) { /* validation in compact constructor */ }
```

### 9.5 DLQ semantics (completion — corrected per AMD-36)

The `SubscriberDlq` instance per subscriber holds:

- An in-memory ring of the most recent 1024 entries (for fast operator inspection via in-process JMX / observability surface).
- A persistent overflow in `subscriber_dead_letters` (V002).

On each subscriber exception (handled by `SubscriberSupervisor` from M3.1, per AMD-42 §3.4.5):

1. Append to in-memory ring.
2. **Atomically** UPSERT into `subscriber_dead_letters`:
   - If `(subscriber_id, event_position)` does not exist: INSERT new row with `attempt_count = N` where N is the actual attempt count at this point, `first_seen_at = now()`, `last_attempt_at = now()`.
   - If exists: UPDATE `attempt_count = attempt_count + 1`, `last_attempt_at = now()`, refresh `cause_class`/`cause_message`/`diagnostics`.
   AND in the same transaction: `UPDATE subscriber_checkpoints SET last_position = ?` where `?` is one past the parked event's position. This atomicity uses the existing `AtomicCheckpointWriter` (M2) — AMD-36 §"AtomicCheckpointWriter Interaction" is normative.
3. Supervisor advances the subscriber past the parked event and continues processing.

**Retry policy:** Per-subscriber `SubscriberMaxRetries` config; default is 5 attempts (AMD-36). After 5 failed attempts (initial + 4 in-line retries), the event is parked. There is no `GAVE_UP` status flag — the row's presence IS the parked state. Parked events do NOT auto-retry; they wait for operator action via §9.6.

### 9.6 DLQ admin API endpoint

`POST /admin/dlq/replay`

Request body (JSON):

```json
{
  "subscriberId": "state-projection-v1",
  "eventPositions": [1234, 1456]    // OR omit for "all parked entries for this subscriber"
}
```

The draft used `entryIds`; corrected to `eventPositions` because `event_position` is the natural keying for the operator (positions are visible in event-log inspection tools; opaque DLQ row IDs are not).

Behavior:

1. Validates subscriber exists.
2. Loads the targeted `subscriber_dead_letters` rows (filtered by `subscriberId` AND optionally `eventPositions`).
3. For each entry: fetches the original `EventEnvelope` from the event store (by `event_position`), invokes the subscriber's processor under a special "manual-replay" mode. On success: DELETE the DLQ row (atomically with no checkpoint movement — the subscriber's checkpoint is already past this event). On failure: UPDATE `attempt_count = attempt_count + 1`, `last_attempt_at = now()`, refresh diagnostics.
4. Returns a summary JSON: `{ "replayed": N, "succeeded": M, "failed": K, "details": [...] }`.

Response status codes:
- `200 OK` — replay attempted (regardless of per-entry success).
- `404 Not Found` — subscriber unknown.
- `409 Conflict` — subscriber currently in REPLAY mode (cannot manually replay simultaneously).

**Authentication:** The endpoint is mounted under the existing `/admin/*` path which the `api/rest-api` module's basic-auth middleware protects (M2→M3 bridge artifact). M3 inherits that protection unless the STOP-on-Mismatch gate (§9.10) reveals the middleware is not present, in which case the Coder STOPs and reports.

### 9.7 `ProjectionRebuild` API

`POST /admin/projection/{id}/rebuild`

Request body: empty (the path parameter identifies the projection).

Behavior:

1. Sets the projection's subscriber to SUSPENDED (operator-initiated, distinct from circuit-breaker SUSPENDED but uses the same mode value; the audit log distinguishes by reason).
2. Calls `ViewCheckpointStore.reset(viewName)`.
3. Calls `StateStore.clear(viewName)`.
4. Calls `EventBus.resume(subscriberId)` which triggers fresh REPLAY from position 0.
5. Returns `202 Accepted` with a status URL (`GET /admin/projection/{id}/status`) so the operator can poll for `LIVE` completion.

The rebuild is idempotent: invoking it twice in succession before completion of the first is a `409 Conflict`.

### 9.8 Contract tests

`DlqContractTest`:

- `parkAppendsOnSubscriberException()`
- `parkInMemoryRingCapsAt1024()`
- `parkPersistentOverflowWritesToTable()`
- `parkAtomicWithCheckpointAdvance()` — AMD-36 atomicity invariant.
- `parkUpsertOnDuplicateEventPosition()` — INSERT first time, UPDATE subsequent (UNIQUE constraint).
- `attemptCountIncrementsOnRetryFailure()`
- `defaultMaxRetriesIsFive()` — AMD-36.
- `parkIsolatedPerSubscriber()` — INV-SUB-ISO-03.

`ProjectionRebuildContractTest`:

- `rebuildSuspendsSubscriberFirst()`
- `rebuildResetsCheckpointToZero()`
- `rebuildClearsStateStore()`
- `rebuildResumesAndReplaysFromZero()`
- `rebuildIsIdempotentBeforeCompletion()` — second call returns 409.
- `rebuildFiresOnCaughtUpAgainAfterCompletion()` — per AMD-42 §3.4.3 (rebuild is conceptually a re-subscription).

`DlqAdminEndpointTest`:

- `replayWithoutEventPositionsReplaysAllParked()`
- `replayWithEventPositionsReplaysOnlySpecified()`
- `replay404OnUnknownSubscriber()`
- `replay409WhenSubscriberInReplay()`
- `replaySummaryJsonShape()`
- `replaySuccessDeletesDlqRow()`
- `replayFailureUpdatesExistingRow()` — confirms UPSERT path, not duplicate INSERT.

### 9.9 Acceptance criteria

- All contract test methods (§9.8) GREEN.
- The V004 indices migration runs cleanly on a fresh database AND on a database populated through V003.
- `SqlitePersistenceLifecycle.EVENTS_MIGRATION_FILES` now lists all four migrations (V001 → V004); the existing M2 `MigrationRunnerTest` is updated to assert this.
- `StateProjection` constructed with `SqliteStateStore` passes the M3.5a vertical IT and all M3.2 reconciliation tests (regression).
- HTTP endpoints conform to the project's existing handler convention in `api/rest-api`.
- ArchUnit rule `ADMIN_ENDPOINTS_REQUIRE_AUTH_ANNOTATION` (existing in rest-api): both new endpoints carry the auth marker.
- ArchUnit rule that no class outside `core/persistence` directly opens a SQLite `Connection` for the state store — `SqliteStateStore`'s constructor must accept a `DatabaseExecutor`-managed connection per AMD-26/27.

Binary success criterion: `./gradlew :core:state-store:check :core:persistence:check :core:event-bus:check :api:rest-api:check` GREEN.

### 9.10 Cowork prompt scope (M3.5b)

#### The prompt MUST specify

- The file list (§9.3) including the modification to `SqlitePersistenceLifecycle.EVENTS_MIGRATION_FILES`.
- The exact V004 migration SQL (additive index creation only — no schema change).
- The `subscriber_dead_letters` row shape **as given in §9.4**; the Coder MUST use the existing V002 column names verbatim — no field renames.
- The default retry cap of 5 from `SubscriberMaxRetries.DEFAULT` (AMD-36).
- The atomic park-and-advance contract (§9.5 step 2) — INSERT/UPDATE on `subscriber_dead_letters` and checkpoint UPDATE in the same transaction via `AtomicCheckpointWriter`.
- The `POST /admin/dlq/replay` request/response JSON shape and status codes (§9.6) — including the `eventPositions` keying (NOT `entryIds`).
- The `POST /admin/projection/{id}/rebuild` behavior (§9.7).
- AMD citations: AMD-36 (DLQ schema + atomicity), AMD-41 (projection discipline), AMD-42 §3.4.5 (supervisor & DLQ), AMD-42 §3.4.6 (INV-SUB-ISO-03), AMD-26/27 (write coordinator routing).
- The deferral notice (per DEC-M3-04 modified): `SqliteSnapshotStore` is NOT to be implemented in M3.5b; the V003 `snapshots` table remains untouched by application code.
- The contract test method lists (§9.8).
- The placement of `SqliteStateStore` in `core/persistence` (not `core/state-store`) — explicit instruction with rationale (matches `SqliteEventStore` precedent).
- Flat-package convention citation.

#### The prompt MUST NOT specify

- Internal SQL prepared-statement shapes (Coder writes JDBC code).
- The HTTP framework integration details (the project already uses one — Coder follows the existing `api/rest-api` admin handler pattern).
- The exact serialization of `EventEnvelope` for the admin endpoint (Coder uses the project's existing Jackson codec from AMD-36).
- Logging.

#### STOP-on-Mismatch verification gates

- M3.1 + M3.5a + M3.2 + M3.3 + M3.4 all landed.
- `core/persistence/src/main/resources/db/migration/events/V002__subscriber_dead_letter_queue.sql` exists.
- `core/persistence/src/main/resources/db/migration/events/V003__add_snapshots_and_drop_redundant_index.sql` exists.
- `SqlitePersistenceLifecycle.EVENTS_MIGRATION_FILES` currently lists ≤ 3 of V001/V002/V003 (gate confirms M3.5b's wiring is necessary).
- The `api/rest-api` module exposes the `/admin/*` handler pattern (Coder reads one existing admin endpoint and reports its style).
- The basic-auth middleware exists in `api/rest-api` (gate confirms whether the open question about endpoint auth is closed by inheritance).
- `AtomicCheckpointWriter` exists in `core/persistence` (gate confirms the park-and-advance atomicity is achievable with existing primitives).
- AMD-36, AMD-41, AMD-42, AMD-43 exist.

#### Completion report format

1. **Files written / modified.**
2. **AMD citations relied on.**
3. **STOP-on-Mismatch gate results** — in particular, whether the admin auth middleware was found, and whether `AtomicCheckpointWriter` already supports the DLQ insert variant or needs an extension.
4. **Migration list confirmation**: `EVENTS_MIGRATION_FILES` now lists V001 through V004.
5. **Contract test method roster** (§9.8).
6. **Deferral attestation**: confirm `SqliteSnapshotStore` was NOT implemented; confirm V003 `snapshots` table is unread by application code.
7. **Verification commands for Nick**: `./gradlew :core:state-store:check :core:persistence:check :core:event-bus:check :api:rest-api:check`.
8. **Open questions** — specifically the admin auth question if the middleware was not found, and whether `AtomicCheckpointWriter` needs an API extension to accept the DLQ insert.

#### Binary success criterion

`./gradlew :core:state-store:check :core:persistence:check :core:event-bus:check :api:rest-api:check` GREEN.

---

## 10. M3.6: StateQueryService

### 10.1 Scope

M3.6 implements the read-side query service. The `StateQueryService` interface **already exists as a Phase 2 locked contract** in `core/state-store` (created during the Phase 2 round, verified via `StateQueryServiceTest`'s "exactly 5 declared methods" assertion). M3.6 does not define a new interface — it provides a production implementation that reads from the `StateStore` populated by `StateProjection` (M3.5a/b) and exposes that implementation through HTTP endpoints in `api/rest-api`.

The service consumes the materialized state produced by `StateProjection`; it does NOT re-derive state on the read path.

### 10.2 Source-of-truth notes (corrected from draft)

The draft made the following factual errors that this corrected plan resolves:

| Draft claim | Source-verified reality |
|---|---|
| Interface defined in `core/api/src/main/java/com/homesynapse/api/query/StateQueryService.java`. | Interface ALREADY EXISTS at `core/state-store/src/main/java/com/homesynapse/state/StateQueryService.java`. Phase 2 locked. |
| Interface has 4 operations: `getState`, `getStates`, `getSnapshot(String entityId)`, `getStatesAtPosition`. | Interface has **5** locked operations: `getState(EntityId) → Optional<EntityState>`, `getStates(Set<EntityId>) → Map<EntityId, EntityState>`, `getSnapshot() → StateSnapshot` (no parameter, returns full snapshot), `getViewPosition() → long`, `isReady() → boolean`. The Phase 2 `StateQueryServiceTest` asserts "exactly 5 declared methods" — adding a 6th method breaks this test. |
| `getState` takes `String entityId`. | `getState` takes `EntityId` (typed wrapper per LTD-04). All methods use `EntityId`, not `String`. |
| `getSnapshot(String)` returns `Optional<EntityState>` (per-entity historical). | `getSnapshot()` (no parameter) returns full `StateSnapshot` containing the entire materialized view. The draft confused per-entity snapshot with the bulk-snapshot operation. |
| `getStatesAtPosition` is part of the interface. | NOT on the existing interface. Adding it is an API-shape change requiring a new amendment. M3.6 must either (a) omit point-in-time queries from MVP, or (b) propose AMD-44 to extend the interface. See Open Question §13.9. |
| Implementation in `core/api/`. | Implementation belongs in `core/state-store` (where the interface lives and where it reads from `StateStore`). HTTP endpoints live in `api/rest-api`. |
| Endpoint package `com.homesynapse.api.query.endpoints`. | Flat package per module: `com.homesynapse.api.rest`. |
| `core/api` module. | API module is `api/rest-api` (and `api/websocket-api`). |

### 10.3 Files to create or modify

| Path | Purpose |
|---|---|
| `core/state-store/src/main/java/com/homesynapse/state/MaterializedStateQueryService.java` | NEW — package-private final implementation of `StateQueryService` that reads from `StateStore`. Constructed by lifecycle wiring (lifecycle module) with the configured `StateStore` and the projection's `SubscriberInfo` accessor for `isReady()`. |
| `core/state-store/src/main/java/com/homesynapse/state/ReadinessSource.java` | NEW — small port consumed by `MaterializedStateQueryService` for `isReady()` — abstracts the subscriber-mode introspection so state-store does not directly require event-bus types beyond `SubscriberInfo`. Provided by lifecycle wiring. |
| `core/state-store/src/test/java/com/homesynapse/state/MaterializedStateQueryServiceTest.java` | NEW — unit tests against the implementation using an in-memory `StateStore` and a stub `ReadinessSource`. |
| `api/rest-api/src/main/java/com/homesynapse/api/rest/GetStateEndpoint.java` | NEW — `GET /state/{entityId}`. Flat package. |
| `api/rest-api/src/main/java/com/homesynapse/api/rest/GetStatesEndpoint.java` | NEW — `GET /state?entityIds=a,b,c`. Flat package. |
| `api/rest-api/src/main/java/com/homesynapse/api/rest/GetSnapshotEndpoint.java` | NEW — `GET /snapshot`. Flat package. Returns full `StateSnapshot`. |
| `api/rest-api/src/main/java/com/homesynapse/api/rest/ReadinessFilter.java` | NEW — HTTP filter (or interceptor matching the existing `api/rest-api` pattern) that consults `StateQueryService.isReady()` and short-circuits to 503 when false. |
| `api/rest-api/src/test/java/com/homesynapse/api/rest/QueryEndpointIT.java` | NEW — HTTP-level integration test. |

### 10.4 `StateQueryService` interface (existing, unchanged)

For reference (locked Phase 2, NOT modified by M3.6):

```java
public interface StateQueryService {
    Optional<EntityState> getState(EntityId entityId);
    Map<EntityId, EntityState> getStates(Set<EntityId> entityIds);
    StateSnapshot getSnapshot();
    long getViewPosition();
    boolean isReady();
}
```

All five methods are non-blocking. `getState()` and `getStates()` are lock-free `ConcurrentHashMap` reads. `getSnapshot()` is O(N) immutable-copy.

### 10.5 Readiness gate

`ReadinessFilter` short-circuits when `StateQueryService.isReady() == false`:

- Status: `503 Service Unavailable`.
- Header: `X-HomeSynapse-Projection-State: <MODE>` where `<MODE>` is the literal `SubscriberMode` value from §4 (`COLD`, `REPLAY`, `TRANSITION`, `SUSPENDED`).
- Header: `Retry-After: 5` (seconds).
- Body: JSON `{ "ready": false, "state": "REPLAY", "checkpoint": 4321, "viewPosition": 9876 }` providing operator diagnostics (where `viewPosition` comes from `StateQueryService.getViewPosition()`).

The mode value comes via the `ReadinessSource` port from the projection's `SubscriberInfo.mode()`. In LIVE mode the filter is transparent — endpoints execute normally and never emit the `X-HomeSynapse-Projection-State` header.

### 10.6 HTTP endpoint shapes

`GET /state/{entityId}`:
- 200 OK + JSON `{ "entityId": "...", "stateVersion": ..., "attributes": {...}, "availability": "AVAILABLE", "lastChanged": "ISO-8601", "lastUpdated": "ISO-8601", "lastReported": "ISO-8601", "staleAfter": "ISO-8601" or null, "stale": false }`.
- 404 Not Found if entity unknown (i.e., `getState(EntityId).isEmpty()`).
- 503 if not ready (per §10.5).

`GET /state?entityIds=a,b,c`:
- 200 OK + JSON `{ "states": { "a": {...}, "b": {...} }, "viewPosition": 9876 }` (entity `c` omitted because unknown).
- 200 with empty map if no matches.
- 400 Bad Request if `entityIds` list exceeds 100 items (DEC-M3-09 pagination cap; see §13.7 default).
- 503 if not ready.

`GET /snapshot`:
- 200 OK + JSON `{ "states": { ... }, "viewPosition": 9876, "snapshotTime": "ISO-8601", "replaying": false, "disabledEntities": [...] }` — mirroring the `StateSnapshot` record shape.
- 503 if not ready.

The path-parameter `entityId` is parsed from `String` to the typed `EntityId` wrapper at the endpoint boundary; parse failures yield `400 Bad Request`.

**Point-in-time queries (`GET /state/at/{position}`) are NOT included in MVP.** See §13.9 — this is a flagged Open Question. If Nick directs us to include it, the path is either an `api/rest-api` endpoint that returns `501 Not Implemented` (no interface change) or an AMD-44 amendment extending `StateQueryService`.

### 10.7 Contract test methods

`MaterializedStateQueryServiceTest` (unit tests against the implementation):

- `getStateReturnsEntityWhenPresent()`
- `getStateReturnsEmptyForUnknownEntity()`
- `getStatesOmitsUnknownEntityIds()`
- `getStatesReturnsUnmodifiableMap()`
- `getSnapshotReturnsAllEntitiesAtSameViewPosition()` — cross-entity consistency.
- `getViewPositionReflectsLastProcessedEvent()`
- `isReadyDelegatesToReadinessSource()` — covers each `SubscriberMode` value.

`QueryEndpointIT` (HTTP-layer integration tests):

- `getState200WhenLive()` — full JSON shape check.
- `getState404OnUnknownEntity()`
- `getState503WhenReplay()` — asserts the `X-HomeSynapse-Projection-State: REPLAY` header.
- `getState503WhenSuspended()`
- `getState503WhenCold()`
- `getState503WhenTransition()`
- `getStatesOmitsUnknownIds()`
- `getStates400WhenIdsExceedCap()` — 100-id cap (§13.7).
- `getStates503Format()` — JSON body shape on 503.
- `getSnapshotReturnsFullView()`
- `retryAfterHeaderPresentOn503()`
- `entityIdParseFailureReturns400()`

### 10.8 Acceptance criteria

- `MaterializedStateQueryServiceTest` and `QueryEndpointIT` all GREEN.
- The Phase 2 `StateQueryServiceTest` ("exactly 5 declared methods") still passes — confirming the interface was NOT modified.
- The query service does not perform any derivation — it reads only from `StateStore`.
- The `X-HomeSynapse-Projection-State` header is emitted exactly when the response status is 503.
- ArchUnit rule `QUERY_SERVICE_READ_ONLY` (NEW, defined in `homesynapse-app` test ArchUnit suite): `MaterializedStateQueryService` and its endpoint classes do NOT import `EventBus`, `EventPublisher`, `SqliteEventStore.append*`, or any write-path symbol from `core/event-bus` or `core/persistence`.

Binary success criterion: `./gradlew :core:state-store:check :api:rest-api:check :app:homesynapse-app:check` GREEN. (The `app` check runs the repo-level ArchUnit suite that hosts `QUERY_SERVICE_READ_ONLY`.)

### 10.9 Cowork prompt scope (M3.6)

#### The prompt MUST specify

- The file list (§10.3).
- The instruction that `StateQueryService` interface is LOCKED Phase 2 and MUST NOT be modified — the Phase 2 `StateQueryServiceTest` assertions are the gate.
- The implementation class name `MaterializedStateQueryService` (package-private final, flat package `com.homesynapse.state`).
- The `ReadinessSource` port shape and rationale (avoids `core/state-store` requiring event-bus's full surface).
- The readiness filter semantics (§10.5) including the four header values, `Retry-After: 5`, and the diagnostic JSON body shape.
- The HTTP endpoint paths and response shapes (§10.6).
- The 100-id cap on `GET /state?entityIds=...` (per §13.7 default).
- The deferral note: point-in-time queries are NOT in MVP; do NOT add `getStatesAtPosition` to the interface; do NOT add a `/state/at/{position}` endpoint.
- AMD citations: AMD-03 (StateQueryService contract — locked Phase 2), AMD-41 (state source), AMD-42 (`SubscriberInfo.mode()` source of truth for readiness).
- The contract test method list (§10.7).
- The ArchUnit rule name `QUERY_SERVICE_READ_ONLY` and its enforcement site in `homesynapse-app`'s test suite.

#### The prompt MUST NOT specify

- The internal HTTP routing class names (Coder uses the existing `api/rest-api` pattern).
- The JSON serialization details (Jackson defaults plus the project's existing module configuration).
- The `getStatesAtPosition` method or `/state/at/{position}` endpoint (deferred per §13.9).
- Logging.

#### STOP-on-Mismatch verification gates

- M3.5b landed: `SqliteStateStore` exists in `core/persistence`, `StateStore` port in `core/state-store`.
- AMD-03 file exists and matches the existing 5-method interface (verified by reading `core/state-store/src/main/java/com/homesynapse/state/StateQueryService.java`).
- AMD-42 file exists; `SubscriberInfo.mode()` accessor present in `core/event-bus`.
- `api/rest-api`'s existing handler pattern is discoverable from at least one example endpoint.
- The Phase 2 `StateQueryServiceTest` exists and currently passes (gate confirms it as the regression suite the Coder must NOT break).

#### Completion report format

1. **Files written.**
2. **AMD citations relied on.**
3. **STOP-on-Mismatch gate results.**
4. **Endpoint roster** (three endpoints + their HTTP methods + paths).
5. **Contract test method roster** (§10.7).
6. **Readiness filter verification**: list the four 503 cases tested (COLD, REPLAY, TRANSITION, SUSPENDED).
7. **Phase 2 regression confirmation**: `StateQueryServiceTest` still GREEN; interface still has exactly 5 methods.
8. **Verification commands for Nick**: `./gradlew :core:state-store:check :api:rest-api:check :app:homesynapse-app:check`.
9. **Open questions** — in particular, whether the 100-id cap is sufficient for early dashboard use cases.

#### Binary success criterion

`./gradlew :core:state-store:check :api:rest-api:check :app:homesynapse-app:check` GREEN.

---

## 11. M3.7: End-to-end integration tests

### 11.1 Scope

M3.7 is the M3 exit-gate test milestone. It exercises the full system end-to-end: HTTP ingress → writer → bus → `StateProjection` → `MaterializedStateQueryService` → HTTP egress, under realistic multi-subscriber and long-running conditions.

M3.7 introduces NO new production code beyond bug fixes surfaced by the tests themselves. All production behavior is fixed by M3.5b and M3.6.

### 11.2 Source-of-truth notes (corrected from draft)

- Module path: `core/integration-tests/` → `testing/integration-tests/` (per DEC-M3-13, §8.2). E2E tests in this milestone share the module created in M3.4. Sub-folder `e2e/` under the test directory is permitted (test source-set organization is not subject to the flat-package convention; the test classes themselves all live under `com.homesynapse.it.e2e`).
- DLQ retry semantics: 10 attempts → **5 attempts** (AMD-36 default). The draft's `AdminReplayE2EIT` was specified against an incorrect retry count.
- DLQ row state on park: there is no `GAVE_UP` status flag. The row's presence indicates the parked state. The test assertion is updated accordingly.
- Admin replay listing endpoint `GET /admin/dlq?subscriberId=...` was used in the draft but is NOT defined in §9.6. The corrected assertion uses direct table inspection via a test helper that opens a read connection to the DLQ table (acceptable in an integration test).
- `core/integration-tests` module path corrected to `testing/integration-tests` throughout.

### 11.3 Files to create

| Path | Purpose |
|---|---|
| `testing/integration-tests/src/test/java/com/homesynapse/it/e2e/MultiSubscriberE2EIT.java` | Two `StateProjection` instances + one custom spy subscriber concurrently. |
| `testing/integration-tests/src/test/java/com/homesynapse/it/e2e/IngressToQueryE2EIT.java` | HTTP POST ingress → query via `GET /state/{id}` round trip. |
| `testing/integration-tests/src/test/java/com/homesynapse/it/e2e/SoakE2EIT.java` | 24-hour soak; tagged `@Tag("soak")`. Per §13.8 default: manual pre-release execution only — no nightly CI. |
| `testing/integration-tests/src/test/java/com/homesynapse/it/e2e/AdminReplayE2EIT.java` | Inject a poison event; verify it routes to DLQ; admin replay path corrects it. |
| `testing/integration-tests/src/test/java/com/homesynapse/it/e2e/RebuildE2EIT.java` | Operator-initiated `ProjectionRebuild`; verify full state regeneration. |

### 11.4 `MultiSubscriberE2EIT` — multi-subscriber test

Configuration:
- Two `StateProjection` subscribers, each with a different `viewName` and a different `DerivationRule` (e.g. one produces `state_changed`, the other produces `entity_summary`).
- One spy subscriber capturing all events.
- 10,000 events published over 100 seconds (100/sec).

Assertions:
- Each projection processes all 10,000 inbound events.
- Derived events from projection A do NOT cause re-derivation in projection A (`SelfProducedFilter` from M3.5a).
- Derived events from projection A DO appear as inbound to projection B (and vice versa). B's filter recognizes A's events as not self-produced.
- The two projections' per-subscriber connections are distinct (`SqliteEventStore.distinctReadConnectionsCount` or equivalent metric exposed by the M3.3 work).
- The two projections' DLQs are independent (INV-SUB-ISO-03 — drive a failure in A; assert B's `subscriber_dead_letters` rows unchanged).
- Subscriber lag for both projections p99 ≤ 500ms.

### 11.5 `IngressToQueryE2EIT` — HTTP round trip

Configuration:
- Bootstrap the full process (writer + bus + projection + rest-api).
- Publish a `device_observed` event via HTTP POST (the project's existing ingress endpoint).
- Poll `GET /state/{entityId}` until 200 OK (or 503 retry-after).

Assertions:
- The first poll may return 503 (projection still in REPLAY for a fresh process); subsequent polls return 200 within 5 seconds.
- The returned state reflects the posted event's value (attribute matching, `stateVersion = 1`).
- The response has no `X-HomeSynapse-Projection-State` header (LIVE).
- Posting a second event for the same entity updates the state and increments `stateVersion` to 2.

### 11.6 `SoakE2EIT` — 24-hour soak

Configuration:
- Sustained 50 events/sec for 24 hours.
- 500 distinct entities cycled through.
- One `StateProjection`, one spy subscriber.
- Periodic operator-initiated rebuilds (every 6 hours) to exercise the rebuild path.
- `@Tag("soak")` so it runs only on Nick's manual invocation (per §13.8 default: no nightly CI).

Assertions:
- No `OutOfMemoryError` over the 24 hours.
- WAL bounded (peak ≤ 200 MB across the run; the writer's automatic WAL checkpoint should keep it well below).
- Per-rebuild: full state regenerated, no events lost (verifiable against a side-channel ledger maintained by the test).
- `subscriber_dead_letters` table never exceeds 100 entries cumulatively (no entries should land; the test logs an investigation alert if any do).
- `homesynapse.bus.subscriber.lag.p99` over 24-hour window ≤ 1000ms.
- Heap growth: peak heap at hour 24 ≤ 110% of peak heap at hour 1 (allows GC variation; flags potential leaks).

### 11.7 `AdminReplayE2EIT` — DLQ admin replay round trip

Configuration:
- Configure `StateProjection`'s `DerivationRule` to throw on a specific event payload (the "poison").
- Publish 100 events, 1 of which is a poison.
- After supervisor exhausts retries (5 attempts × backoff schedule per AMD-36, fast-forwarded via injected `Clock` — wall-clock test time should be ≤ 5 seconds), the event is parked in `subscriber_dead_letters`.
- Fix the derivation rule (rewire the projection with a non-throwing rule — simulating a code fix).
- POST `/admin/dlq/replay` with `subscriberId`.

Assertions:
- The DLQ row is present after retry exhaustion with `attempt_count = 5`.
- The admin replay request succeeds; response summary indicates `succeeded: 1, failed: 0`.
- The previously-missed `state_changed` derivation now appears in the spy's log.
- The `subscriber_dead_letters` row is DELETED post-success (verified via direct table read in the test helper).

### 11.8 `RebuildE2EIT` — projection rebuild

Configuration:
- Publish 1000 events; let projection reach LIVE with full state.
- Snapshot the materialized state (test fixture serializes the `Map<EntityId, EntityState>` from `getSnapshot()`).
- POST `/admin/projection/{id}/rebuild`.
- Poll until projection returns to LIVE (via `GET /admin/projection/{id}/status`).

Assertions:
- During rebuild, `GET /state/{id}` returns 503 with `X-HomeSynapse-Projection-State: REPLAY`.
- After rebuild, the materialized state EXACTLY equals the pre-rebuild snapshot (derivation is deterministic — same events, same `stateVersion` ordering).
- `onCaughtUp()` fired twice in process lifetime (once for initial subscribe, once for post-rebuild) — per AMD-42 §3.4.3.
- Rebuild duration ≤ 30 seconds for the 1000-event log on the Pi-4-equivalent profile.

### 11.9 Acceptance criteria

- All five tests GREEN under standard CI (except `SoakE2EIT` which is `@Tag("soak")` excluded by default).
- No new ArchUnit rules introduced; all existing rules remain GREEN.
- Soak test outcome logged in `homesynapse-core-docs/log/M3.7-soak-results.md` with date, peak metrics, and any DLQ entries (when Nick eventually runs the soak).

Binary success criterion: `./gradlew :testing:integration-tests:test` GREEN (excluding `@Tag("soak")`); soak test attested by Nick separately at pre-release.

### 11.10 Cowork prompt scope (M3.7)

#### The prompt MUST specify

- The file list (§11.3) with the `testing/integration-tests/` path.
- The five test scenarios with exact configuration (event counts, durations, subscriber counts, assertion lists).
- The `@Tag("soak")` annotation for `SoakE2EIT` and the instruction that this test is NOT run by CI by default (§13.8 default).
- The fake-`Clock` injection pattern for `AdminReplayE2EIT` (the project's `Clock.fixed` discipline applies — no `Thread.sleep` for backoff fast-forward).
- AMD citations: AMD-36 (DLQ — 5-retry default), AMD-41/42/43 (all M3 invariants exercised), AMD-03 (query service contract), DEC-M3-04 modified (snapshot deferral context for one assertion in `RebuildE2EIT`), DEC-M3-13 (module placement).
- The format of the soak results log file.

#### The prompt MUST NOT specify

- Internal test helper class names.
- Specific HTTP client library — Coder uses whichever client M3.4 / `api/rest-api` tests already use.
- Logging.

#### STOP-on-Mismatch verification gates

- M3.6 landed: query endpoints exist in `api/rest-api`.
- M3.5b landed: DLQ admin endpoint exists; `subscriber_dead_letters` table is wired via the migration manifest.
- M3.4's `testing/integration-tests` module exists with build wiring.
- `@Tag("soak")` JUnit 5 tagging is supported in the project's test configuration; the Gradle JUnit Platform `excludeTags = "soak"` filter is configured.

#### Completion report format

1. **Files written.**
2. **AMD citations relied on.**
3. **STOP-on-Mismatch gate results.**
4. **Test scenario roster** (five tests).
5. **Soak tag confirmation**: `SoakE2EIT` carries `@Tag("soak")` and CI exclusion is documented.
6. **Verification commands for Nick**: `./gradlew :testing:integration-tests:test`; manual `./gradlew :testing:integration-tests:test -PincludeTag=soak` for pre-release soak.
7. **Open questions.**

#### Binary success criterion

`./gradlew :testing:integration-tests:test` GREEN (excluding `@Tag("soak")`). Soak test attested by Nick pre-release.

---

## 12. Resolved decisions ledger

These six items are explicitly documented as **resolved** so they do not resurface in any future deliberation. Any Cowork prompt, code review, or planning artifact that proposes to revisit them MUST cite a new senior-architect lock — and the Coder/PM MUST refuse to silently re-deliberate within an in-flight prompt.

### 12.1 `WriteBatcher` is NOT a separate thread

**Resolution source:** DEC-M3-01, AMD-41 §3.2.1.
**What is decided:** State Projection performs its derived publishes **sequentially on the projection's own virtual thread**, with each `publish()` parking the VT on the writer's platform thread via the AMD-26/27 handoff. There is no `WriteBatcher` thread, no internal queue between the projection and the writer beyond the writer's existing single-threaded queue.
**Why locked:** Introducing a separate batcher thread would mean two writers (the batcher and the projection-VT-parked-on-writer), violating AMD-26's single-writer invariant; would require its own checkpoint coordination; and would add a failure mode (batcher death between publish-intent and actual-publish) that the current design eliminates by construction.
**Future re-opening conditions:** Only if Pi 4 empirical results from M3.4 show that the sequential discipline cannot sustain the 100 events/sec throughput floor — and even then, the first remediation is rate-limit tuning, not a batcher thread.

### 12.2 `publish()` is NOT blocked under backpressure

**Resolution source:** DEC-M3-08 (rejected, replaced), AMD-43 §3.6.1.
**What is decided:** Natural backpressure from the single-thread writer suffices. `EventPublisher.publish()` never returns a "blocked" status, never throws on backpressure, never parks on a high-watermark semaphore. The `homesynapse.bus.publisher.blocked.count` metric **measures** depth excursions but does not gate calls. The 5000-depth threshold triggers a **health signal**, not a block.
**Why locked:** Blocking `publish()` creates priority inversion (R-07) where a slow subscriber's derived publishes can starve external producers (HTTP, MQTT). The architectural cost (added blocking states, deadlock surface area, observability complexity) outweighs the benefit (queue-depth bound) compared to the alternative of rate-limiting the *derived* publishers (which is what AMD-43 §3.6.4 does).
**Future re-opening conditions:** Only if M3.4 empirically shows external producers being parked on writer throughput in a way operators cannot tolerate — and the first remediation is writer throughput optimization, not publish blocking.

### 12.3 Per-entity snapshots via V003 are DEFERRED (ViewCheckpointStore for MVP)

**Resolution source:** DEC-M3-04 (modified), AMD-41 §3.2.3.
**What is decided:** MVP State Projection checkpoints through the existing `ViewCheckpointStore` (single serialized map keyed by `viewName`). V003 (`snapshots` table) already runs at boot via the migration manifest (M3.5b adds it to `EVENTS_MIGRATION_FILES`), but no application code reads or writes the table at MVP. `SqliteSnapshotStore` is not implemented.
**Trigger to land:** Empirical full-replay-from-zero duration on Pi 4 reference hardware exceeds **5 seconds**. Until M3.4 measures replay time and that threshold is crossed, the snapshot store remains unimplemented.
**Why locked:** Premature optimization. The single-checkpoint-per-projection model is simple, correct, and fast enough for the M3 throughput targets (verified by M3.4). Adding per-entity snapshots introduces snapshot-version-skew handling, snapshot-eviction policy, and read-side fallback logic — all complexity that's worth bearing only when measured replay time demands it.
**Future re-opening conditions:** M3.4 measurement crosses 5 seconds, OR Pi 4 production telemetry shows replay-blocked startups exceeding operator tolerance.

### 12.4 `SelfProducedFilter` has NO hard cap (TTL-only at MVP)

**Resolution source:** DEC-M3-02, AMD-41 §3.2.2.
**What is decided:** The in-memory `Ulid` set uses a 60-second TTL with lazy eviction. No `LinkedHashMap` size cap, no LRU eviction, no eager sweeper thread.
**Why locked:** The memory envelope is bounded by event rate × TTL: 100 ev/s × 60s = 6000 ULIDs ≈ 96 KB raw + map overhead. This is negligible against the 256 MB Pi 4 heap budget. A cap would introduce a "missed entry" failure mode (capped-out ULID arrives after cap eviction, fails to short-circuit, triggers re-derivation) that the no-cap design avoids entirely.
**Future re-opening conditions:** Pi 4 production telemetry shows the filter consuming > 50 MB resident (which would require ~3M ULIDs and therefore event rates two orders of magnitude above design target).

### 12.5 Pi 4 checkpoint cadence uses AMD-38's 200/2s until M3.4 validates

**Resolution source:** DEC-M3-12 (modified), AMD-43 §3.6.6.
**What is decided:** AMD-38's universal cadence (200 events or 2 seconds, whichever first) applies on Pi 4 without modification at M3 entry. M3.4's `Pi4D1SpikeIT` and on-device Pi 4 validation are the empirical gates.
**Outcome paths:**
- M3.4 GREEN under universal cadence → cadence retained, no follow-up amendment, item closed.
- M3.4 shows cadence collapse under Pi 4 SD-card D1 spikes → file AMD-44 with platform-tuned cadence; M3.4 GREEN definition tightened.
**Why locked:** Pre-tuning a cadence without measurement is speculation. The 200/2s envelope is conservative and the M3.4 test infrastructure exists precisely to make the empirical determination.

### 12.6 Circuit breaker is in-memory (resets on process restart, by design)

**Resolution source:** DEC-M3-06 (augmented), AMD-42 §3.4.5.
**What is decided:** The supervisor's circuit-breaker state (5 crashes / 10 min window, SUSPENDED transition) lives in-memory. Process restart resets the breaker to closed and the crash counter to empty.
**Why locked:** Restart is the operator's diagnostic-and-recovery moment. Persisting the breaker state would mean a previously-tripped subscriber starts the new process already SUSPENDED, requiring an operator `resume()` action even if the cause was a code bug fixed in the new build. The non-persistent design lets a deploy of the fix automatically restore service — which is the operationally desirable behavior.
**Future re-opening conditions:** Only if production experience shows operators forgetting to investigate the cause of pre-restart trips (i.e. the auto-reset masks a real problem). The remediation would be a structured restart audit log, not breaker persistence.

### 12.7 Reconciliation metadata uses existing `CheckpointRecord.data` slot (NEW — resolved during PLAN-M3-CONSOLIDATED-02 revision)

**Resolution source:** Source-verification pass that produced PLAN-M3-CONSOLIDATED-02 (this document).
**What is decided:** The reconciliation metadata that M3.2 needs (timestamp of last reconciliation pass, divergence count, etc.) is serialized into the existing `CheckpointRecord.data` byte slot — which is an opaque byte[] field already present in the locked Phase 2 record (5 fields). No new migration is required. No new column.
**Why locked:** The draft (PLAN-M3-CONSOLIDATED-01) proposed a V004 migration adding sidecar columns to `view_checkpoints`. This was unnecessary: `CheckpointRecord.data` is explicitly defined as opaque payload owned by the writing projection — the M3.2 reconciliation pass writes its metadata as a JSON-encoded record in that slot. The migration governance question (draft §13.4) is consequently moot.
**Future re-opening conditions:** Only if reconciliation metadata grows beyond what the opaque byte slot can carry without breaking the writer's contract (single-key write within `ViewCheckpointStore.writeCheckpoint`). If multi-key reconciliation data emerges as a need, a sidecar column or table can be re-proposed.

### 12.8 Point-in-time queries are NOT in MVP — interface remains 5 methods (NEW — resolved during PLAN-M3-CONSOLIDATED-02 revision)

**Resolution source:** Source-verification pass against the Phase 2 `StateQueryService` interface and `StateQueryServiceTest`.
**What is decided:** The existing `StateQueryService` interface has exactly 5 methods (verified by `StateQueryServiceTest#exactlyFiveMethods`). M3.6 does NOT add `getStatesAtPosition` to the interface, and does NOT expose `GET /state/at/{position}` as an HTTP endpoint. The draft (PLAN-M3-CONSOLIDATED-01) proposed both, with a 501 fallback for non-current positions; the corrected plan removes the method entirely from MVP.
**Why locked:** Adding the method requires an AMD amendment (the interface is Phase 2 locked), and the 501-fallback endpoint without an interface method invites confusion. The cleanest MVP shape is: omit entirely; revisit when a real consumer requests historical queries. If the omission later proves wrong, the addition is non-breaking (new method on an interface is additive for callers; only implementations need updating).
**Future re-opening conditions:** A concrete consumer requirement for point-in-time queries arises (e.g. audit log replay, debugging tool). At that point, propose AMD-44 to extend the interface.

---

## 13. Open questions for Nick

These items cannot be resolved from the corpus and require Nick's decision before the corresponding Cowork prompts can be generated. Each item is scoped narrowly so Nick can answer briefly.

The list has been revised from PLAN-M3-CONSOLIDATED-01 — draft §13.4 (V004 reconciliation migration) and draft §13.6 (`getStatesAtPosition` 501 fallback) have been resolved by the source-verification pass and moved to §12.7 and §12.8 respectively. The replacement §13.9 is new.

The feedback that accompanied the source-verification request also provided rapid-fire recommended defaults for §13.1 through §13.8; those defaults are recorded below as **"Documented default"** and are the values M3 will adopt absent explicit Nick override.

### 13.1 SubscriberSupervisor backoff parameters — confirm 3s / 30s / 0.2 jitter

**Context:** AMD-42 §3.4.5 specifies `MIN = 3s`, `MAX = 30s`, `jitter = 0.2`. These values are the senior-architect lock's stated parameters but are based on intuition rather than measurement.

**Question:** Are these final, or should M3.4 be charged with empirically determining them?

**Documented default (feedback):** Treat the stated values as fixed for M3 entry. If M3.4 observes pathologies (e.g. retry storms saturating the writer), open a follow-up amendment AMD-45 after the M3 exit gate.

### 13.2 Per-subscriber derived-write rate limit value — 200/s vs measured

**Context:** AMD-43 §3.6.4 specifies 200/s as the `StateProjection` default. This is derived from the M3.4 throughput floor (100 ev/s) doubled to allow burst headroom, but it is not empirically validated.

**Question:** Should M3.5a/M3.3 use 200/s as a fixed default and let M3.4 validate, or should the rate limit be a no-op (unlimited) at M3.5a entry and only activated after M3.4 measurement?

**Documented default (feedback):** Use 200/s active from M3.5a. The cost of an over-tight limit (occasional derived-write parking) is observable via metrics; the cost of no limit (R-07 priority inversion under derivation storms) is observable only as customer-facing latency.

### 13.3 DLQ admin API authentication — M3 scope or M3.6+?

**Context:** AMD-43 / DEC-M3-06 do not specify authentication for the admin endpoints (`POST /admin/dlq/replay`, `POST /admin/projection/{id}/rebuild`). The M2→M3 bridge introduced a basic-auth middleware on `/admin/*` (per the bridge plan); M3 inherits that protection if it exists, but the inheritance has not been verified in code.

**Question:** Is M3.5b expected to verify (and add tests for) the inheritance of admin auth, or is auth outside M3 scope and the endpoints land unauthenticated for now?

**Documented default (feedback):** STOP-on-Mismatch behavior — M3.5b assumes inheritance; the Cowork prompt's STOP-on-Mismatch gate requires the Coder to confirm the middleware exists. If absent, the Coder STOPs and reports; Nick then decides whether to bolt on auth in M3.5b or defer to a separate hardening pass.

### 13.4 ~~V004 migration governance — additive metadata column~~

**RESOLVED in PLAN-M3-CONSOLIDATED-02 §12.7.** Reconciliation metadata uses the existing `CheckpointRecord.data` byte slot. No migration is needed.

### 13.5 V004 indices migration timing (renumbered from draft V005)

**Context:** §9.3 introduces V004 to add indices on `subscriber_dead_letters` for admin query efficiency. With the draft's proposed V004 (reconciliation metadata) resolved away in §12.7, the DLQ-indices migration takes the V004 slot. This is the only additive migration in M3.

**Question:** Acceptable to land in M3.5b, or should it be a separate hardening pass?

**Documented default (feedback):** Land in M3.5b. Indices are additive, non-breaking, and necessary for admin query performance.

### 13.6 ~~`getStatesAtPosition` 501 fallback — acceptable for MVP?~~

**RESOLVED in PLAN-M3-CONSOLIDATED-02 §12.8.** The method is NOT added to the interface and the endpoint is NOT exposed. See §13.9 for the related forward-compatibility question if Nick wants a placeholder.

### 13.7 Pagination strategy for `GET /state?entityIds=...`

**Context:** §10.6 does not specify a maximum number of `entityIds` per request beyond the proposed cap. Large requests (1000+ ids) could produce large responses and slow queries.

**Question:** Is a cap acceptable (e.g. 100 ids per request → 400 Bad Request beyond) or is a streaming/paginated response required?

**Documented default (feedback):** 100-id cap, 400 Bad Request beyond, documented in the M3.6 prompt. Streaming is over-engineering for MVP given the 3000-entity total scale.

### 13.8 Soak test invocation cadence and environment

**Context:** §11.6 specifies a 24-hour soak test but does not commit to a CI schedule.

**Question:** Does Nick want the soak test to run on a nightly CI schedule (requires CI runner with 24-hour budget) or only on manual pre-release invocation?

**Documented default (feedback):** Manual pre-release; CI does not auto-trigger. A nightly soak adds CI cost without proportionate signal; pre-release runs catch regressions before they ship.

### 13.9 Point-in-time query placeholder — endpoint-only 501 for forward compatibility? (NEW)

**Context:** §10.6 and §12.8 close the point-in-time-query feature for MVP: no `getStatesAtPosition` method, no `GET /state/at/{position}` endpoint. This is the cleanest MVP shape. However, there is a forward-compatibility tradeoff: if a client team starts integrating against the API and assumes positional queries are coming, they may want a placeholder endpoint that returns `501 Not Implemented` today to signal "this is intentional, not a missing implementation."

**Question:** Should M3.6 add an endpoint-only `GET /state/at/{position}` that always returns `501 Not Implemented` with a body like `{"error": "point-in-time queries are not implemented in MVP; track AMD-44"}` — or should the endpoint be omitted entirely (404 from the router)?

**Recommendation:** Omit entirely. A 501 placeholder consumes URL real estate and creates a maintenance obligation; a 404 is the honest signal that the feature does not exist. If a consumer arrives with a real requirement, add the endpoint then (with the interface extension via AMD-44).

**Default if Nick does not respond:** Omit entirely.

---

## 14. Phase 3 exit gate criteria for M3

M3 is complete and Phase 3 advances to M4 when all of the following are simultaneously true. Each criterion is binary — partial satisfaction does not count.

### 14.1 Contract test suites GREEN

- `:core:state-store:check` GREEN, including `ProjectionAdvancerContract` with the methods of §3 (Deliverable 0), `SubscriberContractTest`, `StateProjectionContractTest`, `ReconciliationContractTest`, `ProjectionRebuildContractTest`, and `MaterializedStateQueryServiceTest`.
- `:core:event-bus:check` GREEN, including the extended `EventBusContractTest` with all M3.1, M3.2, M3.3 methods, plus the new `DlqContractTest`. No `@Disabled` annotations remaining for M3 scope.
- `:core:persistence:check` GREEN, including `SqliteDeadLetterStoreContractTest`, the migration-manifest regression in `MigrationRunnerTest`, and the `SqliteStateStore` integration tests.
- `:core:event-model:check` GREEN (regression — `InMemoryEventStore` testFixture continues to satisfy `EventStoreContractTest`).
- `:api:rest-api:check` GREEN, including `DlqAdminEndpointTest`, `ProjectionRebuildEndpointTest`, and `QueryEndpointIT`.

### 14.2 Integration tests GREEN

- `:testing:integration-tests:test -PpiProfile=throttled` GREEN for all M3.4 tests:
  - `Pi4SustainedLoadIT` (1-hour version or `-PsustainedMinutes=60`).
  - `BurstLoadIT`.
  - `CrashRecoveryIT`.
  - `Pi4D1SpikeIT`.
  - `HeapBudgetIT`.
- `:testing:integration-tests:test` (default tag set, soak excluded) GREEN for all M3.7 tests:
  - `MultiSubscriberE2EIT`.
  - `IngressToQueryE2EIT`.
  - `AdminReplayE2EIT`.
  - `RebuildE2EIT`.
- `SoakE2EIT` attested by Nick separately (not a CI gate, but an exit gate per §13.8 default — manual pre-release). Soak result logged in `homesynapse-core-docs/log/M3.7-soak-results.md`.

### 14.3 Pi 4 on-device validation complete

- Nick has run `Pi4SustainedLoadIT` on actual Pi 4 hardware (`hs-dev-1`) and attested GREEN in `homesynapse-core-docs/log/M3.4-pi4-validation.md`.
- The log records: hardware revision (Pi 4 model B, RAM size), kernel version, storage type (NVMe via M.2 HAT+ for `hs-dev-1`; the SD-card D1 spike emulation is the CI-only profile), observed `homesynapse.bus.subscriber.lag.p99`, observed peak WAL size, observed peak heap.
- The decision recorded as either:
  - "AMD-38 cadence retained on Pi 4" (expected), OR
  - "Platform-tuned cadence required — file follow-up amendment AMD-44" with the proposed cadence parameters.

### 14.4 MODULE_CONTEXT files updated

- `core/event-bus/MODULE_CONTEXT.md` cites AMD-41, AMD-42, and AMD-43 in the amendments-in-force section. Lists the new types: `Subscriber` (callback interface), `SubscriberMode`, `SubscriberSnapshot`, `SubscriberSupervisor`, `SubscriberDlq`, `DeadLetter`, `SubscriberMaxRetries`, `ReplayWindowQueue`, `BusMetrics`. Confirms `EventBus` retains only 4 methods.
- `core/state-store/MODULE_CONTEXT.md` cites AMD-41, AMD-42, AMD-43, and the corrected `ProjectionAdvancer` signature (modified by Deliverable 0). Lists the new types: `StateStore` (port), `SelfProducedFilter`, `StateProjection`, `ProjectionRebuild`, `ReadinessSource`, `MaterializedStateQueryService`. Confirms `StateQueryService` interface unchanged (5 methods).
- `core/persistence/MODULE_CONTEXT.md` cites AMD-36 (DLQ wiring), AMD-41 (state store SQLite adapter). Lists the new types: `SqliteStateStore`, `SqliteDeadLetterStore`. Records the migration manifest update (V001..V004 now wired into `EVENTS_MIGRATION_FILES`).
- `api/rest-api/MODULE_CONTEXT.md` cites AMD-03 (StateQueryService contract), AMD-42 (readiness gate via subscriber mode), AMD-36 (DLQ admin endpoint). Lists the new endpoints: `GetStateEndpoint`, `GetStatesEndpoint`, `GetSnapshotEndpoint`, `ReadinessFilter`, `DlqAdminEndpoint`, `ProjectionRebuildEndpoint`, `ProjectionStatusEndpoint`.
- `testing/integration-tests/MODULE_CONTEXT.md` created (new module per DEC-M3-13), describing the throttled profile, the soak tag, and the relationship to `scripts/pi4-validation.sh`.

### 14.5 Traceability indexes updated

- `homesynapse-core-docs/design/00-navigation-index.md` lists AMD-41/42/43 as APPLIED, plus DEC-M3-13 (new module placement decision).
- The decision-traceability matrix (if maintained as a separate file) links each of DEC-M3-01 through DEC-M3-13 to the implementing amendment and the implementing module.
- The invariant catalog includes INV-SUB-ISO-01 through INV-SUB-ISO-06 and INV-BUS-02 (publish never blocks on depth — the AMD-43 invariant), each with a back-link to the source amendment and the contract test method that exercises it.

### 14.6 AMD-41/42/43 marked APPLIED in Navigation Index

- Three Tier-1 amendment entries with `Status: APPLIED` and the commit date populated.
- The "M3 readiness" subsection of the Navigation Index records: "M3 complete on (date); see exit-gate log."
- A new "M4 readiness" subsection is stubbed (no content; placeholder for future planning).

### 14.7 No outstanding `@Disabled` annotations referring to M3 milestones

- `grep -r '@Disabled.*M3' --include='*.java'` returns no results inside the M3-scoped modules.
- Any remaining `@Disabled` annotations reference M4 or later milestones explicitly.

### 14.8 ArchUnit rules introduced or preserved in M3 are all GREEN

- `NO_DIRECT_TIME_ACCESS` (AMD-39, preserved — `Clock` injection only).
- `PROJECTION_NO_WRITE_BATCHER_THREAD` (AMD-41 §3.2.1 — projection's only writer is the projection's VT parked on the writer platform thread).
- **JPMS-enforced JDBC isolation** (M3.1 — bus module is JDBC-free; enforced by `module-info.java` not requiring `java.sql`, not by ArchUnit).
- `EVENT_PUBLISHER_HAS_NO_DEPTH_GATED_LOCK` (AMD-43 §3.6.1 — `EventPublisher.publish()` does not call `Semaphore.acquire`, `Lock.lock`, or `Object.wait` keyed on queue depth).
- `BUS_METRICS_NOT_DIRECT_INSTANTIATION` (M3.3 — metric emissions route through `BusMetrics`).
- `QUERY_SERVICE_READ_ONLY` (M3.6 — `MaterializedStateQueryService` and rest-api endpoints do not import write-path symbols).
- `ADMIN_ENDPOINTS_REQUIRE_AUTH_ANNOTATION` (existing in rest-api — M3.5b's new admin endpoints carry the marker).
- All repo-level dependency rules from `build.gradle.kts` continue to hold: `:core:.* -X> :integration:.*`, `:core:.* -X> :api:.*`, `:core:.* -X> :app:.*`, `:core:.* -X> :lifecycle:.*`, `:platform:.* -X> :core:.*`.

### 14.9 Exit-gate sign-off

Nick records exit-gate sign-off as a single dated entry in `homesynapse-core-docs/log/M3-exit-gate.md` citing:

1. The commit hash where AMD-41/42/43 landed (governance commit).
2. The commit hash where the final M3 milestone (M3.7) completed.
3. The Pi 4 on-device validation log entry reference.
4. The soak test result log reference.
5. Any open questions deferred to M4 (these become inputs to M4 planning).

After the sign-off entry lands, M3 is closed. Future amendments may reference but not modify AMD-41/42/43 without a new senior-architect lock.

---

---

## Document control

**Document ID:** PLAN-M3-CONSOLIDATED-02 (Source-Verified)
**Supersedes:** PLAN-M3-CONSOLIDATED-01 (the draft that this revision corrected — see §0 Changelog).
**Author:** Claude PM (source-verification pass over the PLAN-M3-CONSOLIDATED-01 draft).
**Status:** AUTHORITATIVE on approval by Nick.
**Effective on:** Approval + commit of AMD-41/42/43 governance bundle to `homesynapse-core-docs`.

**Relationship to PLAN-M3-CONSOLIDATED-01:** This document preserves the entire architectural deliberation outcome of the draft (twelve locked decisions, three amendments, contract-test coverage, milestone ordering). The corrections are mechanical: file paths, module names, package conventions, and the EventBus-vs-EventPublisher responsibility split. The amendment text itself is preserved verbatim except where the draft cited a non-existent path or package.

**Reading order for downstream consumers:**

- **Nick** (one read, then approve): §0 (changelog — what changed and why) → §1 (preamble + locked decisions table) → §2 (the three amendments verbatim) → §3 (Deliverable 0 rationale) → §13 (open questions to triage, particularly the new §13.9). Skim §4–§11; deep-read §12 (now eight items) and §14.
- **Claude PM** (repeated reads when generating prompts): §3–§11 each section's "Cowork prompt scope" subsection is the prompt template; §2 amendments are quoted into prompt authority sections; §12 is the gatekeeper against re-deliberation.
- **Claude Coder** (per-prompt reads): only the sections cited by the active prompt. The Coder never reads this document directly; it reads the prompt, which quotes this document.

**Change discipline:**

- Modifying §2 (AMD-41/42/43 text) requires a new senior-architect lock.
- Modifying §3–§11 (deliverable details) requires PM approval and a changelog entry at the top of this document.
- Modifying §12 (resolved decisions) requires a senior-architect lock that explicitly names the decision being re-opened.
- Modifying §13 (open questions) requires Nick's response or PM's escalation; resolved questions move to §12 with the resolution recorded.
- Modifying §14 (exit gate) requires PM approval; tightening is permitted, loosening is not.

**Cross-references at a glance:**

| Decision | Amendment | Section | Validation locus |
|---|---|---|---|
| DEC-M3-01 (two-phase) | AMD-41 §3.2.1 | §5 (M3.5a) | `StateProjectionContractTest#readTxClosesBeforePublish` in `core/state-store` |
| DEC-M3-02 (self-produced filter) | AMD-41 §3.2.2 | §5 (M3.5a) | `selfProducedFilterSuppressesReentrantDelivery` in `core/state-store` |
| DEC-M3-03 (three-phase REPLAY→LIVE) | AMD-42 §3.4.2 | §6 (M3.2) | `replayWindowDrainBeforeLive` in `core/event-bus` extended contract |
| DEC-M3-04 modified (MVP checkpoints) | AMD-41 §3.2.3 | §9 (M3.5b deferral) | §12.3 ledger |
| DEC-M3-05 (Jackson snapshot format) | AMD-41 §3.2.3 + §3.2.4 | §9 (M3.5b — deferred per §12.3) | n/a at MVP |
| DEC-M3-06 augmented (isolation) | AMD-42 §3.4.4..§3.4.6 | §4 (M3.1) | INV-SUB-ISO-01..06 tests in `EventBusContractTest` |
| DEC-M3-07 (coalescing deferred) | AMD-43 §3.6.5 | §7 (M3.3) | (absence of feature) |
| DEC-M3-08 replaced (no publish block) | AMD-43 §3.6.1 | §7 (M3.3) | `publishDoesNotBlockAt5000` + ArchUnit `EVENT_PUBLISHER_HAS_NO_DEPTH_GATED_LOCK` |
| DEC-M3-09 (clock injection) | (existing AMD-39 + propagation) | all milestones | `NO_DIRECT_TIME_ACCESS` ArchUnit |
| DEC-M3-10 (state_changed in projection) | AMD-41 (implicit by scope) | §5 (M3.5a) | derivation rule located in `core/state-store` |
| DEC-M3-11 (impl order) | (planning lock) | §3–§11 ordering | this document |
| DEC-M3-12 modified (Pi 4 floor) | AMD-43 §3.6.6 | §8 (M3.4) | `Pi4SustainedLoadIT`, `HeapBudgetIT`, on-device attestation |
| DEC-M3-13 (NEW — module placement) | (this revision) | §8 (M3.4) | `testing:integration-tests` module exists in `settings.gradle.kts` |

**Resolved items new in this revision (PLAN-M3-CONSOLIDATED-02):**

| Item | Source draft reference | Resolution |
|---|---|---|
| Reconciliation metadata migration | draft §13.4 | §12.7 — use existing `CheckpointRecord.data` slot; no V004 reconciliation migration needed. |
| Point-in-time queries on `StateQueryService` | draft §13.6 | §12.8 — interface stays at 5 methods; no `/state/at/{position}` endpoint in MVP. |

**Modules touched by M3 (final list with corrected paths):**

| Module | M3 changes |
|---|---|
| `core/event-model` | No changes (testFixtures `InMemoryEventStore` regression-tested). |
| `core/event-bus` | New types: `Subscriber`, `SubscriberMode`, `SubscriberSnapshot`, `SubscriberSupervisor`, `SubscriberDlq`, `DeadLetter`, `SubscriberMaxRetries`, `ReplayWindowQueue`, `BusMetrics`. `EventBus` retains 4 methods. Extended `EventBusContractTest`. |
| `core/state-store` | Modified: `ProjectionAdvancer` signature (Deliverable 0). New types: `StateStore` (port), `SelfProducedFilter`, `StateProjection`, `ProjectionRebuild`, `ReadinessSource`, `MaterializedStateQueryService`. `StateQueryService` unchanged. New testFixture: `InMemoryStateStore`. |
| `core/persistence` | New types: `SqliteStateStore`, `SqliteDeadLetterStore`. Modified: `SqlitePersistenceLifecycle.EVENTS_MIGRATION_FILES` (V001..V004). New migration: V004 DLQ indices. V002 and V003 wired (already existed). |
| `core/automation` | No changes in M3 scope. |
| `core/device-model` | No changes in M3 scope. |
| `observability/observability` | Possibly modified: new metric primitive port if needed for `BusMetrics` (M3.3). Existing surface preferred. |
| `api/rest-api` | New endpoints: `GetStateEndpoint`, `GetStatesEndpoint`, `GetSnapshotEndpoint`, `ReadinessFilter`, `DlqAdminEndpoint`, `ProjectionRebuildEndpoint`, `ProjectionStatusEndpoint`. |
| `api/websocket-api` | No changes in M3 scope (initial-state sync via WebSocket may use `getSnapshot()` but is not part of M3 gate). |
| `lifecycle/lifecycle` | Modified: wires `MaterializedStateQueryService`, `SqliteStateStore`, `StateProjection` into startup order. |
| `app/homesynapse-app` | Modified: ArchUnit test suite gains `EVENT_PUBLISHER_HAS_NO_DEPTH_GATED_LOCK`, `BUS_METRICS_NOT_DIRECT_INSTANTIATION`, `QUERY_SERVICE_READ_ONLY`, `EVENT_BUS_DOES_NOT_IMPORT_SQLITE_DRIVER`, `PROJECTION_NO_WRITE_BATCHER_THREAD`. |
| `testing/test-support` | No changes (continued use of `SynchronousEventBus`). |
| `testing/integration-tests` | NEW MODULE (DEC-M3-13). |
| `scripts/` | New: `scripts/pi4-validation.sh` (Coder produces; Nick runs). |

**End of consolidated M3 implementation plan (PLAN-M3-CONSOLIDATED-02 Source-Verified).**
