# Research 9: Event-Sourced Projection Rebuild, Versioning, and Backfill — Replay-from-Zero, One-Shot Backfill, and Determinism on Constrained Hardware
*Target: HomeSynapse Core M4 (M4.0a/M4.0b). Date: 2026-05-29.*

## 1. Executive Summary

- **Replay-from-zero is the correct rebuild strategy at HomeSynapse's scale, and the literature validates AMD-41 §3.2.4 — but the real risk is not the strategy, it is determinism and cursor discipline.** Axon, Marten, Akka, and EventStoreDB all treat "delete the read model, reset the offset to position 0, reprocess" as the baseline rebuild; blue-green/parallel rebuild exists only to avoid *downtime*, which a single-user local-first Pi runtime does not have. **(Highest-impact finding.)**
- **The one-shot backfill decision is sound and has direct prior art in Home Assistant: restore the last known state, never replay history into the live model.** HA's `RestoreEntity` restores a single last-snapshot per entity and explicitly never backfills historical state changes — HomeSynapse's plan to *compute* derived state during the 1→2 replay without re-emitting `state_changed` events is the event-sourced generalization of the same principle.
- **Computing derived state during replay WITHOUT re-emitting events is standard and safe — the double-counting hazard is real and must be solved by gating on event provenance, not on the version boundary alone.** The gate must distinguish "derived-during-replay" from "logged `state_changed`," because on the 2→3 replay both will be present.
- **The monotonic `stateVersion` cursor is the single most fragile component under rebuild.** Because it "advances on every processed event — not just mutations," any divergence in *which* drafts are applied between two replays produces a different final `stateVersion` for the same log — breaking its contract as a "reliable idempotency cursor." It must be made a deterministic function of log position, not of processing path.
- **A snapshot store is not yet warranted; the literature strongly favors deferring it, and AMD-41 §3.2.3's 5-second trigger is well-calibrated — but the trigger should be measured, not assumed.** Multiple maintainers (Kurrent, EventSourcingDB) call snapshots "overrated" and a frequent mask for modeling problems; sequential replay of even 100k small events is typically sub-second on modern hardware, though Pi-class I/O and JSON deserialization change the constant factor.
- **Upcasting must run strictly *before* the derivation rule sees an event, and is fully compatible with a projection-version rebuild — Axon's chained `SingleEventUpcaster` model is the reference.** The `AttributeValueUpcaster` SPI should transform the stored blob to current shape at read time; the rule then operates only on current-shape events, keeping determinism intact.
- **Testing must center on the replay invariant: replay(log) == replay(replay(log)) and rebuild-from-scratch equality, backed by real-blob golden-master fixtures.** Every surveyed system that handles upcasting well (Axon, EventSourcingDB, the Artium/AFAS practitioners) uses extracted production event streams as frozen fixtures.

## 2. Platform / Literature Deep Dives

### 2.1 Axon Framework

**(a) How it solves rebuild/backfill.** Axon rebuilds a projection by *resetting the tracking token* of a `StreamingEventProcessor` (Tracking or Pooled) to a position before the current one — typically the tail (index 0) — which triggers a replay. The processor must be **stopped** before reset because it must claim all its segments. A `@ResetHandler` method runs pre-replay to clear the projection's data (e.g., truncate the table). During replay, handlers can detect `ReplayStatus.REPLAY` (or annotate with `@DisallowReplay`) to suppress non-idempotent side effects such as sending email. Axon distinguishes replayed events from new ones via the `ReplayToken`, which wraps a "token at reset" (where replay ends) and the start token.

**(b) Primary-source quote + URL.** From the AxonIQ reference guide on streaming processors: *"As the method name suggests, the reset adjusts the tracking token to a new position. When starting a reset, the streaming processor is required to claim all its segments... the streaming event processor must be inactive when starting a reset. Hence, it is required to be shut down first before invoking the resetTokens operation."* — https://github.com/AxonIQ/reference-guide/blob/master/axon-framework/events/event-processors/streaming.md

On upcasting, from the Axon reference guide on event versioning: *"Upcasters are classes that take one input event of revision x and output zero or more new events of revision x + 1. Moreover, upcasters are processed in a chain, meaning that the output of one upcaster is sent to the input of the next."* — https://docs.axoniq.io/axon-framework-reference/4.11/events/event-versioning/

**(c) Known pain points.** `@DisallowReplay` and `ReplayStatus` have a history of bugs: Issue #2955 (a single `@DisallowReplay` handler blocking replay of the entire processor), #2154 and #2233 (`ReplayStatus` always REGULAR for PooledStreamingEventProcessor and in multi-node), and #2995 (the 4.9.0 default `ReplayToken` change causing events not to be handled with `@DisallowReplay`). The lesson: *the "is this a replay?" signal is exactly where frameworks accumulate subtle bugs.* — https://github.com/AxonFramework/AxonFramework/issues/2955 ; https://github.com/AxonFramework/AxonFramework/issues/2995

**(d) HomeSynapse lesson.** HomeSynapse's two-phase model (READ re-executes the rule on replay, PUBLISH suppressed for non-LIVE) is functionally Axon's `ReplayStatus`/`@DisallowReplay` — but implemented as a phase gate rather than per-handler annotations. Axon's bug history is a direct warning: the suppress-publish-during-replay signal must be unambiguous and centrally enforced (the StateProjection phase), never per-handler. The `EventTypeUpcaster` "type upcasting only" abstraction maps directly to the labels→SemanticTag change; Axon explicitly warns it "should not be used to change the semantic meaning of an event."

### 2.2 EventStoreDB / Kurrent

**(a) How it solves rebuild/backfill.** EventStoreDB projections are server-side and *emit/link* events reactively. The category projection (`$ce-<category>`) and event-type projection (`$et-<type>`) produce link streams. Rebuilding a user projection or downstream read model is done by re-subscribing from an earlier checkpoint; idempotency is the consumer's responsibility, achieved by tracking the source stream revision per event. Checkpoints are stored with `$maxCount: 1` so only the last is retained. Snapshots are explicitly a performance optimization to be deferred.

**(b) Primary-source quote + URL.** On write amplification from emitting events (relevant to HomeSynapse's "don't re-emit derived events" decision): *"Keep in mind that all projections emit events as a reaction to events that they process. We call this effect write amplification because emitting new events or link events creates additional load on the server IO... adding one event to the database will, in fact, produce three additional events and, therefore, quadruples the number of write operations."* — https://docs.kurrent.io/server/v22.10/projections

On snapshots: *"Snapshots are a valid pattern but shouldn't be treated as the foundational part of the system architecture. They should be performance optimisation. As with other optimisations, we should do them for the critical business parts, not try to apply them by default."* — https://www.kurrent.io/blog/snapshots-in-event-sourcing

**(c) Known pain points.** The Kurrent community forum thread "Projections - Dealing with idempotency" shows that idempotent projection is non-obvious: developers must use the stream revision of the originating stream (not the `$all` position) to dedupe. — https://discuss.kurrent.io/t/projections-dealing-with-idempotency/4229

**(d) HomeSynapse lesson.** EventStoreDB's "write amplification" is precisely *why* HomeSynapse's decision NOT to re-emit `state_changed` during the historical backfill is correct: re-emitting would quadruple write load on a single-writer SQLite file on a Pi. The idempotency lesson — dedupe on a stable per-stream position, not a global cursor — directly informs the `stateVersion` redesign (REC-76/REC-79).

### 2.3 Marten (.NET / PostgreSQL)

**(a) How it solves rebuild/backfill.** Marten rebuilds via the async daemon: `daemon.RebuildProjectionAsync("Name", ct)`. The classic rebuild is a "left fold / from zero" — delete and reprocess. Marten 7.0 introduced a `ProjectionVersion` field that enables blue-green: incrementing the version writes the new projection to *separate tables*, the async (green) version catches up while the old (blue) serves reads, then traffic cuts over. Marten also added an opt-in *optimized* single-stream rebuild (`UseOptimizedProjectionRebuilds`, stream-by-stream in reverse last-modified order), slated to become default in Marten 8.

**(b) Primary-source quote + URL.** From the Marten rebuilding docs: *"When deploying projection changes to production without downtime, you can use projection versioning to run old and new projection versions in parallel: Increment ProjectionVersion on your projection class to create a new version that writes to separate database tables from the previous version... Deploy new nodes ('green') running the updated code alongside existing nodes ('blue')."* — https://martendb.io/events/projections/rebuilding.html . The feature was introduced in Marten 7.0; per Jeremy D. Miller's release post: *"Now though, with Marten 7.0, we can instead make one more change to our projection and add this line to mark it as version 2: ... ProjectionVersion = 2."* — https://jeremydmiller.com/2024/03/05/marten-7-makes-write-model-projections-super/

**(c) Known pain points.** Marten's own docs flag the optimized rebuild as limited: *"Sorry, but this feature is pretty limited right now. This optimization is only today usable if there is exactly one single stream projection using any given event stream. If you have two or more single stream projection views for the same events ... the optimized rebuilds will not result in correct behavior."* Issue #1609 tracks the long road to downtime-free rebuilds. — https://martendb.io/events/projections/rebuilding.html ; https://github.com/JasperFx/marten/issues/1609

**(d) HomeSynapse lesson.** Marten is the closest analog to HomeSynapse's `projectionVersion` field, and it validates the design — *but Marten uses the version to write to separate tables for zero-downtime, whereas HomeSynapse uses it to trigger a clearing replay.* HomeSynapse should NOT adopt blue-green: it has no concurrent read traffic to protect and only ~4GB RAM, so maintaining two materialized maps doubles memory for no benefit (over-abstraction; see §3). The optimized "reverse last-modified, stream-by-stream" rebuild is, however, a useful future option if per-entity rebuild is ever needed.

### 2.4 Akka Projections / Lagom

**(a) How it solves rebuild/backfill.** Akka Projections store an *offset* per `ProjectionId` in an offset store. The headline guarantee: when the handler's DB write and the offset write share one transaction, you get **exactly-once**; otherwise **at-least-once** (offset saved after processing). The at-least-once window is batched by the reference defaults `save-offset-after-envelopes = 100` and `save-offset-after-duration = 500 ms`, with the docs noting *"There is a performance benefit of not storing the offset too often but the drawback is that there can be more duplicates ... when the projection is restarted."* Rebuild = clear the read model and reset the offset. Lagom's read-side processors auto-manage the `read_side_offsets` table and require the `globalPrepare`/handler logic to be idempotent because it "may be invoked multiple times."

**(b) Primary-source quote + URL.** From the Akka Projection JDBC docs: *"The offset is stored in the same transaction used for the user defined handler, which means exactly-once processing semantics if the projection is restarted from previously stored offset."* — https://doc.akka.io/libraries/akka-projection/current/jdbc.html

From Lagom: *"If the storing of offsets is done atomically with any updates produced by the events, then event processing will happen exactly once for each event, otherwise it will happen at least once."* — https://www.lagomframework.com/documentation/1.5.x/java/ReadSide.html

**(c) Known pain points.** Akka warns that concurrent projection instances with the same `ProjectionId` "will overwrite each others offset storage with undefined and unpredictable results." With at-least-once, restart reprocesses the tail, so handlers MUST be idempotent. Kafka source adds a rebalance caveat where filtering in-flight messages "is not possible to guarantee all the time." — https://doc.akka.io/libraries/akka-projection/current/running.html

**(d) HomeSynapse lesson.** This is the strongest validation of HomeSynapse's AMD-45 `AtomicCheckpointWriter`, which couples the subscriber checkpoint and the view checkpoint in **one SQLite transaction** — that is exactly Akka's exactly-once recipe. HomeSynapse is architecturally *ahead* of the at-least-once default here. The lesson for the cursor: Akka achieves exactly-once by atomic offset+state commit; HomeSynapse must ensure that on a crash mid-replay, the partial state and the checkpoint never disagree — which the atomic writer already guarantees, provided `stateVersion` is recomputable from position.

### 2.5 Home Assistant (smart-home reference)

**(a) How it solves rebuild/backfill.** Home Assistant does NOT event-source entity state. On restart, an entity that subclasses the `RestoreEntity` mixin calls `async_get_last_state()` in `async_added_to_hass()` to retrieve its **single last state** from the `core.restore_state` JSON store. That store is dumped every `STATE_DUMP_INTERVAL = timedelta(minutes=15)` and on `EVENT_HOMEASSISTANT_STOP`, holding exactly one `StoredState` per entity (expiring after `STATE_EXPIRATION = timedelta(days=7)`). The separate `recorder` integration keeps the full state-change history in `home-assistant_v2.db` for graphs/history — but that history is NOT replayed into entity state on boot.

**(b) Primary-source quote + URL.** From `homeassistant/helpers/restore_state.py`, the module docstring: *"Support for restoring entity states on startup."* and the dump comment: *"Dump the initial states now. This helps minimize the risk of having old states loaded by overwriting the last states once Home Assistant has started and the old states have been read."* `async_get_last_state` is documented in source as *"Get the entity state from the previous run."* (returns a single `State` or `None`). — https://github.com/home-assistant/core/blob/dev/homeassistant/helpers/restore_state.py

Per-platform, the Number entity dev docs note restore deals with a single stored value (RestoreEntity remains otherwise undocumented in prose — tracked by developers.home-assistant issue #702): https://developers.home-assistant.io/docs/core/entity/number/ . The recorder's `purge_keep_days` default is 10 days (set in core PR #12271) and `commit_interval` default is 5 s, where *"The default of 5 allows events to be committed almost right away without trashing the disk when an event storm happens."* — https://www.home-assistant.io/integrations/recorder/

**(c) Known pain points.** Community reports show restore is fragile and famously surprising: entities silently revert to empty/default on restart unless `RestoreEntity` is wired correctly (aarongodfrey.dev), MQTT sensors that "report only on temperature change" lose state across restart (community thread 31361), and a long-standing bug where the recorder saved a default 'off' state during startup before restore completed, corrupting subsequent restores (core issue #16837). — https://github.com/home-assistant/home-assistant/issues/16837

**(d) HomeSynapse lesson.** This is the decisive precedent for the M4.0b decision. HA is a mature smart-home runtime that deliberately restores only the *last* state and never backfills history into live entities — exactly because replaying device history is semantically wrong (a temperature reading from last Tuesday is not the current temperature). HomeSynapse's backfill is subtly different and *better*: it reconstructs *current* attribute state by folding the entire `state_reported` log deterministically, which is the right thing precisely because the fold's end state IS the current value. But the HA precedent confirms the boundary: backfill computes the *current* materialized value, it does not resurrect historical `state_changed` events. The HA "report only on change → empty after restart" failure is literally the problem M4.0b's backfill exists to fix.

### 2.6 Cross-reference: practitioner/academic literature

- **Determinism discipline (Neos CR, primary):** *"We all must ensure that the projector never consumes information not included in events - specifically you are not allowed to directly read Flow Settings or NodeType configuration; and you are also not allowed to read other projections. A projector is not allowed to trigger external actions like sending mails. The projector is not allowed to fail."* — https://docs.neos.io/guide/contributing-to-neos/event-sourced-content-repository/how-we-understand-event-sourcing
- **Snapshot skepticism (EventSourcingDB, primary):** *"snapshots are one of the most overrated concepts in the Event Sourcing toolbox. They solve a problem that rarely exists... Replaying a few hundred or even a few thousand events takes milliseconds."* — https://docs.eventsourcingdb.io/blog/2026/03/02/the-snapshot-paradox/
- **Schema evolution tactics (Overeem et al., ScienceDirect, peer-reviewed):** identifies "rebuilding projections" as one of five named challenges and "versioned events, weak schema, upcasting, in-place transformation, and copy-and-transform" as the tactics. — https://www.sciencedirect.com/science/article/pii/S0164121221000674
- **Golden-master with real streams (Artium, practitioner):** *"periodically extract a representative sample of event streams from your production database. These extracted streams are then hardcoded as fixture files within your test suite. By running your projector functions over these fixtures, you can guarantee that the event upcasting and state reconstruction logic continues to work correctly across event versions."* — https://artium.ai/insights/event-sourcing-what-is-upcasting-a-deep-dive

## 3. Cross-Cutting Analysis

### 3.1 Concept mapping

| Concept | HomeSynapse | Axon | EventStoreDB | Marten | Akka | Home Assistant |
|---|---|---|---|---|---|---|
| Rebuild trigger | `projectionVersion` mismatch → clear + replay from 0 (AMD-41 §3.2.4) | `resetTokens()` after stop; `@ResetHandler` clears | Re-subscribe from earlier checkpoint | `RebuildProjectionAsync` (left-fold from zero) | Clear read model + reset offset | N/A (no replay; last-snapshot restore) |
| Progress cursor | subscriber checkpoint + view checkpoint (atomic) | TrackingToken in TokenStore | checkpoint stream (`$maxCount:1`) | shard high-water mark | offset in offset store | `last_seen` per entity |
| "Is replay?" signal | two-phase READ/PUBLISH; publish suppressed off-LIVE | `ReplayStatus.REPLAY` / `@DisallowReplay` | consumer-coded | projection lifecycle | n/a (idempotent handlers) | n/a |
| Exactly-once | `AtomicCheckpointWriter` (one SQLite txn) | token+projection same DB txn | consumer dedupe by revision | FetchForWriting / inline | offset+write same txn | n/a |
| Schema evolution | `AttributeValueUpcaster` SPI | chained `SingleEventUpcaster` + `@Revision` | external upcast at read | `Upcast<T>` event versioning | Akka Serialization + manifest | n/a |
| Derived state | `DerivationRule` → `EventDraft` (not re-emitted on backfill) | event handler projection | emit/link (write-amplifies) | projection apply | handler `process()` | computed live, not stored |
| Snapshot | `SqliteSnapshotStore` deferred until replay > 5s | aggregate snapshots | snapshot-as-event | single-stream snapshot | n/a (read-model is the snapshot) | `core.restore_state` JSON |

### 3.2 Gap analysis (ranked by impact)

1. **Cursor determinism gap (CRITICAL).** `stateVersion` "advances on every processed event" and is the documented idempotency cursor, yet nothing in the verified inventory guarantees it is a *pure function of log position*. If the 1→2 backfill applies re-derived drafts AND the 2→3 replay applies logged `state_changed` events, the same entity reaches a different `stateVersion` on different rebuilds. No surveyed system uses a path-dependent cursor; all use a position/offset that is identical across replays. **This is the highest-impact gap.**
2. **Backfill provenance gap (CRITICAL).** The locked decision gates backfill to the 1→2 boundary, but version-boundary gating alone is insufficient: it answers "which replay" but not "which events within this replay are historical-derived vs. logged." Needs an explicit provenance flag on the draft-apply path.
3. **Upcasting/derivation ordering gap (HIGH).** Nothing in the inventory pins down that upcasting runs before `DerivationRule.evaluate()`. If the rule ever sees a pre-upcast blob, determinism breaks the moment a new `AttributeValue` permit is added.
4. **Snapshot-trigger measurement gap (MEDIUM).** The 5-second trigger is a sound threshold but is currently an assumption; there is no instrumented replay-duration metric feeding the decision.
5. **`CheckpointRecord.projectionVersion()` footgun (MEDIUM).** Both store implementations hardcode it to 1; the authoritative version lives in `StateCheckpointSource.loadedProjectionVersion()`. Any future code reading the wrong accessor will silently never detect a mismatch.

### 3.3 Over-abstraction analysis (where HomeSynapse risks building more than it needs)

- **Blue-green/parallel rebuild: do NOT build.** Marten and the broader literature build it solely for *zero-downtime* production cutover under concurrent read traffic. A local-first single-user Pi runtime tolerates a brief first-boot rebuild; maintaining two read-model maps would roughly double the ConcurrentHashMap memory footprint against a ~4GB budget for zero benefit.
- **Snapshot store right now: do NOT build yet.** AMD-41 §3.2.3 already defers it; the literature (EventSourcingDB, Kurrent) is emphatic that premature snapshotting masks modeling problems. The V003 table migration is fine to keep as a latent option, but `SqliteSnapshotStore` should remain unimplemented until measured.
- **ServiceLoader / plugin dispatch for handlers: correctly already rejected** (DECIDE-04, constructor-injected package-private handlers). The surveyed systems that use reflection/SPI dispatch (EventStoreDB's JS projections, Axon's annotation scanning) pay a startup and determinism-debuggability cost HomeSynapse does not need.
- **Per-event `@Revision` resolver (Axon-style): probably overkill.** HomeSynapse can version `AttributeValue` at the type-shape level via the upcaster SPI without a full Maven-artifact revision resolver.

### 3.4 Competitive assessment (where HomeSynapse is genuinely strong)

- **The atomic subscriber+view checkpoint (AMD-45) is best-in-class for the constraint.** It delivers Akka's exactly-once guarantee within a single SQLite transaction, on a single file, with no distributed coordination — a genuinely elegant fit. *Qualifier:* this holds only while `stateVersion` is position-derivable; otherwise the atomicity guards a non-deterministic value.
- **The two-phase READ/PUBLISH model with determinism-carries-correctness (not the stale filter) is cleaner than Axon's per-handler `@DisallowReplay`.** It centralizes the replay decision in one place, avoiding the entire class of Axon bugs (#2955, #2995). *Qualifier:* it depends on the rule being genuinely pure; the model gives no protection if a handler reads a clock or external state.
- **Bounded-window SQLite reads (D1 spike) plus platform-thread executors for JDBC (AMD-26/27) correctly handle the JNI carrier-pinning problem** that naive virtual-thread-on-JDBC code hits. This is a subtle, correct call.
- **Not re-emitting derived events avoids EventStoreDB-style write amplification** — the right choice for single-writer SQLite on a Pi.

## 4. Amendment Recommendations

Ranked by (impact × confidence) / cost.

### REC-76 — Make `stateVersion` a deterministic function of log position, not processing path
- **Gap citation:** §3.2 gap #1 (cursor determinism); the verified contract that `stateVersion` "advances on every processed event — not just mutations" and is a "reliable idempotency cursor."
- **Lesson source:** Akka exactly-once (offset+state atomic, offset is position) — https://doc.akka.io/libraries/akka-projection/current/jdbc.html ; EventStoreDB idempotency-by-stream-revision — https://discuss.kurrent.io/t/projections-dealing-with-idempotency/4229
- **Specific change:** Define `stateVersion` for an entity as the count of *events affecting that entity that the projection has folded up to the current global position*, computed identically on LIVE and REPLAY. Concretely, in `applyToState`, increment `stateVersion` once per inbound event applied to the entity (both `state_reported` and `state_changed` already do `+1`); for the one-shot backfill, a re-derived draft applied during the 1→2 replay MUST NOT add a second increment beyond the increment already attributable to the source `state_reported` event. The invariant to assert: for a fixed log and fixed `projectionVersion`, `entityState.stateVersion` is identical across any number of rebuilds.
- **Backward-compatibility:** No serialized-shape change (`stateVersion` stays a field in `EntityState`). Behavioral change only on the backfill path. Existing checkpoints written under v1 are discarded by the 1→2 reconciliation anyway, so no migration needed.
- **Effort:** M (logic + invariant tests).
- **Target work unit:** M4.0b-1.

### REC-77 — Gate the one-shot backfill on event provenance, not solely on the version boundary
- **Gap citation:** §3.2 gap #2 (backfill provenance).
- **Lesson source:** Home Assistant restores last-snapshot only, never replays history — https://github.com/home-assistant/core/blob/dev/homeassistant/helpers/restore_state.py ; EventStoreDB write-amplification rationale for not re-emitting — https://docs.kurrent.io/server/v22.10/projections
- **Specific change:** Introduce an explicit provenance signal on the draft-apply path so that `StateProjection` applies re-derived drafts to the in-memory state ONLY when (a) the current reconciliation is the 1→2 boundary AND (b) the source event is a historical `state_reported` whose corresponding `state_changed` does NOT already exist later in the log. The simplest robust mechanism: during the 1→2 replay, the derivation rule's output drafts are applied directly to state but **flagged as non-emitting and reconciliation-scoped**; on any replay where `projectionVersion ≥ 2`, the rule still re-executes (determinism) but its drafts are **discarded for state application** and the logged `state_changed` events are the sole source of attribute mutation. Record the decision in the existing reconciliation metadata (`reconciledFromVersion`/`reconciledToVersion`) already present in the checkpoint JSON. VERIFY: the exact draft-apply call site / method name in `StateProjection` against source.
- **Backward-compatibility:** Additive; uses existing reconciliation metadata fields. No event-log writes (preserves "don't re-emit" decision).
- **Effort:** M.
- **Target work unit:** M4.0b-1.

### REC-78 — Enforce upcasting strictly before `DerivationRule.evaluate()`
- **Gap citation:** §3.2 gap #3 (upcasting/derivation ordering).
- **Lesson source:** Axon chained upcaster runs at read time before handlers — https://docs.axoniq.io/axon-framework-reference/4.11/events/event-versioning/ ; Axon `EventTypeUpcaster` "should not be used to change the semantic meaning of an event" — https://apidocs.axoniq.io/latest/org/axonframework/serialization/upcasting/event/EventTypeUpcaster.html
- **Specific change:** Position the `AttributeValueUpcaster` SPI in the deserialization path so that every `EventEnvelope` handed to both `onEvent` (LIVE) and `processBatch` (REPLAY) carries already-upcast, current-shape `AttributeValue`s. The `DerivationContext` must never expose a pre-upcast payload. Treat the labels→`SemanticTag` migration as a *type/shape* upcast (Axon's `EventTypeUpcaster` analog), not a semantic change. Add a contract note to `DerivationRule` (INV-PROJ-01 family) that the rule may assume current-shape inputs.
- **Backward-compatibility:** Old blobs remain on disk unchanged (non-destructive, per Axon's core upcasting principle); upcasters chain x→x+1 as new `AttributeValue` permits are added (currently 5: BooleanValue, IntValue, FloatValue, StringValue, EnumValue).
- **Effort:** M–L (SPI wiring + chain registration + tests).
- **Target work unit:** M4.0b-2.

### REC-79 — Codify the determinism discipline for `DerivationRule` as enforced contract + test harness
- **Gap citation:** AMD-41 §3.2.2 (determinism carries correctness); the existing `DerivationRule` contract (MUST NOT publish, MUST NOT mutate StateStore, MUST be deterministic per INV-PROJ-01).
- **Lesson source:** Neos CR explicit prohibitions (no config reads, no other-projection reads, no external actions, must not fail) — https://docs.neos.io/guide/contributing-to-neos/event-sourced-content-repository/how-we-understand-event-sourcing ; "a projection must be deterministic and reproducible. If I replay all my events from the beginning, I must get exactly the same result" — https://joemugen.medium.com/event-sourcing-projections-must-tell-the-same-story-cc29ec8b75ce
- **Specific change:** Extend the `DerivationRule` contract to explicitly forbid: (1) reading `System.currentTimeMillis()`/`Instant.now()` or any wall clock — any needed time must arrive via the event/`DerivationContext`; (2) reading configuration, device registry, or any other projection; (3) any I/O or randomness. If the rule needs "now," inject a deterministic clock value sourced from the event being processed. Back this with a test-only `DerivationContext` that throws if a handler attempts a disallowed read (a "determinism sandbox"). VERIFY: whether `DerivationContext` currently exposes any clock/registry accessor against source — if it does, surface in §5.
- **Backward-compatibility:** Tightens an existing contract; the current production rule is the no-op `MINIMAL_DERIVATION_RULE`, so nothing real breaks today.
- **Effort:** S–M.
- **Target work unit:** M4.0b-1.

### REC-80 — Instrument replay duration and make the snapshot-store activation a measured trigger
- **Gap citation:** §3.2 gap #4 (snapshot-trigger measurement); AMD-41 §3.2.3 (defer `SqliteSnapshotStore` until replay > 5s on Pi 4).
- **Lesson source:** "Snapshots make sense when replay time > 100ms for hot aggregates" / measure first — https://dev.to/alex_aslam/snapshot-strategies-optimizing-event-replays-36oo ; "before you start thinking about snapshots, look at your actual numbers. Profile your replays." — https://docs.eventsourcingdb.io/blog/2026/03/02/the-snapshot-paradox/
- **Specific change:** Emit a structured metric `projection.replay.duration_ms` (and `events_replayed`) at the end of every reconciliation/first-boot replay. Define the activation rule concretely: implement `SqliteSnapshotStore` only after the p95 of measured full-replay on the Pi 4 reference exceeds 5000 ms across representative logs; below that, keep the V003 table dormant. The snapshot format is already specified (Jackson JSON with `snapshotVersion` + `projectionVersion` headers, DEC-M3-05) — note that a snapshot is itself version-stamped, so a `projectionVersion` bump MUST invalidate snapshots (clearing them is part of the 1→2 reconciliation).
- **Backward-compatibility:** Pure addition (metric). No snapshot code activated.
- **Effort:** S (metric); L (snapshot store, only if triggered).
- **Target work unit:** M4.0a (metric); snapshot store out-of-scope until triggered.

### REC-81 — Replay-invariant property tests + real-blob golden-master fixtures
- **Gap citation:** Testing requirement (Q8 of the brief); no rebuild/idempotency test surface exists since the production rule was a no-op.
- **Lesson source:** Artium real-stream fixtures — https://artium.ai/insights/event-sourcing-what-is-upcasting-a-deep-dive ; EventSourcingDB "verify a projection can be rebuilt from scratch... apply the same event twice and assert the side effect is not duplicated" — https://docs.eventsourcingdb.io/best-practices/testing-event-sourced-systems/
- **Specific change:** Add three test classes: (1) **replay idempotence** — assert `rebuild(log)` equals a second independent `rebuild(log)` and that `stateVersion`/`attributes` per entity are byte-identical across two rebuilds (property-based over generated `state_reported`/`state_changed` interleavings); (2) **backfill correctness** — assert the 1→2 backfill produces the same final attribute map as a fresh log that already contains the `state_changed` events (i.e., backfill ≡ native), and that no double-increment occurs; (3) **golden-master** — freeze extracted real serialized event blobs (including pre-upcast `AttributeValue` shapes) as fixtures and assert the upcaster+rule reconstruct the expected `EntityState`. Use these to guard the labels→`SemanticTag` migration.
- **Backward-compatibility:** Test-only.
- **Effort:** M.
- **Target work unit:** M4.0b-1 (1,2); M4.0b-2 (3).

### REC-82 — Add a guard against the `CheckpointRecord.projectionVersion()` footgun
- **Gap citation:** §3.2 gap #5; verified fact that both `InMemoryViewCheckpointStore` and `SqliteViewCheckpointStore` hardcode `CheckpointRecord.projectionVersion()` to 1, while the authoritative value is `StateCheckpointSource.loadedProjectionVersion()`.
- **Lesson source:** Axon TokenStore initial-token/rename footguns where the wrong token source silently changes replay behavior — https://github.com/AxonFramework/AxonFramework/issues/2995
- **Specific change:** Mark `CheckpointRecord.projectionVersion()` as `@Deprecated`/`@DoNotUse` (or rename to `legacyHardcodedProjectionVersion()`), add a Javadoc pointer to `StateCheckpointSource.loadedProjectionVersion()` as the only authoritative accessor, and add a unit test asserting reconciliation reads the loaded value (so a regression to the hardcoded accessor fails CI). VERIFY exact method signatures against source before renaming.
- **Backward-compatibility:** Annotation/doc + test; no behavioral change if the rename is deferred.
- **Effort:** S.
- **Target work unit:** M4.0a.

## 5. Caveats and Open Questions

- **Source reliability.** Platform behavior quotes are from primary docs/source (Axon reference guide and GitHub issues, Kurrent/EventStoreDB docs, Marten docs, Akka docs, Home Assistant source). Performance numbers for snapshots and replay are from practitioner blogs and vendor blogs (EventSourcingDB, Kurrent, dev.to) and a Raspberry Pi SQLite micro-benchmark — these are *indicative, not authoritative for HomeSynapse's exact workload* and the brief's own framing should govern. The Home Assistant developer prose docs do not document `RestoreEntity` (tracked by developers.home-assistant issue #702), so HA findings rest on the `dev`-branch source code, which is authoritative but a moving target.
- **Unresolved tensions.**
  1. *Does `DerivationContext` already expose a clock or registry?* If it does, REC-79's prohibition conflicts with the current shape — must be reconciled against source (marked VERIFY). Do not silently break the inventory.
  2. *Exact draft-apply call site in `StateProjection`* for REC-77's provenance flag is unverified (VERIFY).
  3. *Whether `applyToState` should increment `stateVersion` for an event that produces no attribute change during backfill* — REC-76 says the cursor must be position-derivable, but the documented contract ("advances on every processed event") and the backfill's "don't double-increment" decision must be reconciled precisely; the safe reading is that the source `state_reported` carries the single increment and the re-derived draft carries none.
- **What needs an empirical Pi spike vs. what the literature settles.**
  - *Settled by literature:* replay-from-zero is the right rebuild strategy at this scale; blue-green is unnecessary; not re-emitting derived events is correct; determinism disciplines (no clock/IO/config/other-projection reads); upcast-before-handler ordering; golden-master + replay-invariant testing.
  - *Needs a Pi spike:* the actual replay-from-zero wall-clock at 10k / 100k / 1M events with JSON deserialization through the bounded read executor on Pi 4/5; whether the 5-second snapshot trigger is ever hit in realistic device-count × report-rate scenarios; WAL checkpoint interaction with the 2-second read-tx cadence during a long replay.

## 6. Appendix: Sources

- Axon streaming processors / reset: https://github.com/AxonIQ/reference-guide/blob/master/axon-framework/events/event-processors/streaming.md
- Axon Streaming Event Processor (5.0): https://docs.axoniq.io/axon-framework-reference/5.0/events/event-processors/streaming/
- Axon event versioning / upcasting: https://docs.axoniq.io/axon-framework-reference/4.11/events/event-versioning/
- Axon EventTypeUpcaster API: https://apidocs.axoniq.io/latest/org/axonframework/serialization/upcasting/event/EventTypeUpcaster.html
- Axon `@DisallowReplay` bug #2955: https://github.com/AxonFramework/AxonFramework/issues/2955
- Axon ReplayStatus bug #2154: https://github.com/AxonFramework/AxonFramework/issues/2154
- Axon ReplayToken regression #2995: https://github.com/AxonFramework/AxonFramework/issues/2995
- Axon 4.6.0 replay context: https://developer.axoniq.io/w/axon-framework-4.6.0-replay-context-propagation
- EventStoreDB/Kurrent projections: https://docs.kurrent.io/server/v22.10/projections
- Kurrent snapshots blog: https://www.kurrent.io/blog/snapshots-in-event-sourcing
- Kurrent idempotency forum: https://discuss.kurrent.io/t/projections-dealing-with-idempotency/4229
- Kurrent proof-oriented event sourcing: https://www.kurrent.io/blog/proof-oriented-event-sourcing/
- Marten rebuilding projections: https://martendb.io/events/projections/rebuilding.html
- Marten 7 projection versioning (Jeremy D. Miller): https://jeremydmiller.com/2024/03/05/marten-7-makes-write-model-projections-super/
- Marten async daemon: https://martendb.io/events/projections/async-daemon
- Marten testing projections: https://martendb.io/events/projections/testing.html
- Marten async daemon improvements #1609: https://github.com/JasperFx/marten/issues/1609
- Akka Projection JDBC (exactly-once): https://doc.akka.io/libraries/akka-projection/current/jdbc.html
- Akka Projection running/settings: https://doc.akka.io/libraries/akka-projection/current/running.html
- Akka Projection settings (offset windows): https://doc.akka.io/libraries/akka-projection/current/projection-settings.html
- Lagom persistent read-side: https://www.lagomframework.com/documentation/1.5.x/java/ReadSide.html
- Lagom JDBC read-side: https://www.lagomframework.com/documentation/1.4.x/scala/ReadSideJDBC.html
- Home Assistant restore_state.py: https://github.com/home-assistant/core/blob/dev/homeassistant/helpers/restore_state.py
- Home Assistant Number entity dev docs: https://developers.home-assistant.io/docs/core/entity/number/
- Home Assistant recorder: https://www.home-assistant.io/integrations/recorder/
- Home Assistant restore bug #16837: https://github.com/home-assistant/home-assistant/issues/16837
- Neos event-sourced CR determinism: https://docs.neos.io/guide/contributing-to-neos/event-sourced-content-repository/how-we-understand-event-sourcing
- EventSourcingDB snapshot paradox: https://docs.eventsourcingdb.io/blog/2026/03/02/the-snapshot-paradox/
- EventSourcingDB testing: https://docs.eventsourcingdb.io/best-practices/testing-event-sourced-systems/
- Artium upcasting deep dive: https://artium.ai/insights/event-sourcing-what-is-upcasting-a-deep-dive
- Overeem et al., schema evolution (ScienceDirect): https://www.sciencedirect.com/science/article/pii/S0164121221000674
- Snapshot strategies (dev.to): https://dev.to/alex_aslam/snapshot-strategies-optimizing-event-replays-36oo
- SQLite WAL: https://sqlite.org/wal.html
- SQLite on Raspberry Pi: https://spin.atomicobject.com/sqlite-raspberry-pi/
- Projections must tell the same story: https://joemugen.medium.com/event-sourcing-projections-must-tell-the-same-story-cc29ec8b75ce

## 7. HomeSynapse Code-Level Implications

### 7.1 The replay-time hook for the one-shot backfill
The backfill belongs in the REPLAY path (`processBatch(int)`), gated by reconciliation state set in `initialize()` when `StateCheckpointSource.loadedProjectionVersion()` (NOT `CheckpointRecord.projectionVersion()`) returns 1 while the running `projectionVersion` is 2. Concretely:
- `initialize()` loads the checkpoint, compares loaded-vs-running version, and on `1 → 2` sets a reconciliation flag (`reconciledFromVersion=1`, `reconciledToVersion=2`) and clears the StateStore.
- During `processBatch`, for each historical `state_reported`, the `DerivationRule` runs (READ phase) and returns drafts. Under the reconciliation flag, those drafts are applied to in-memory state via the same `applyToState` path used for an inbound `state_changed` — but as **reconciliation-scoped, non-emitting** applications, and with the `stateVersion` accounting of REC-76 (the increment is owned by the source `state_reported`, the draft adds none).
- PUBLISH is suppressed (already the case off-LIVE). No `state_changed` events are written to the log.
- On completion, the atomic checkpoint writer (AMD-45) commits subscriber + view checkpoint + `projectionVersion=2` + reconciliation metadata in one SQLite transaction.

### 7.2 Concrete handler/rule/config shapes
- `DispatchingProjectionAdvancer` (Research 8 REC-28): dispatch-by-`@EventType`, constructor-injected package-private handlers, no ServiceLoader (DECIDE-04). Add two handlers: one for `state_reported` (advances `stateVersion`/`lastReported`/`lastUpdated`, leaves `attributes` untouched — matches verified `applyToState`), one for `state_changed` (does `newAttrs.put(key, new StringValue(value))`, sets `lastChanged`, `stateVersion + 1`).
- The real `DerivationRule` replacing `MINIMAL_DERIVATION_RULE`: given a `state_reported` in `DerivationContext`, returns a `List<EventDraft>` containing a `state_changed` draft when the reported value differs from current materialized attribute state — deterministic, no publish, no StateStore mutation (INV-PROJ-01).
- Provenance flag (REC-77): a reconciliation-scoped boolean/enum carried into the apply path. VERIFY the exact `applyToState`/draft-apply method signature against source before wiring.
- Determinism sandbox `DerivationContext` (REC-79, test-only): throws on clock/registry/other-projection access.

### 7.3 Snapshot-store activation criteria
Do not implement `SqliteSnapshotStore` now. Activate only when measured Pi 4 p95 full-replay > 5000 ms (AMD-41 §3.2.3). The V003 `snapshots` table stays migrated but dormant. When activated: Jackson JSON with `snapshotVersion` + `projectionVersion` headers (DEC-M3-05); a `projectionVersion` bump invalidates all snapshots (clearing is part of reconciliation). Note `CheckpointSerializer` currently stores attributes as `Map<String,String>` because only `StringValue` is written today — the snapshot format must evolve in lockstep with the `AttributeValue` hierarchy expansion (REC-78), or snapshots will silently lose non-`StringValue` attributes.

### 7.4 MODULE_CONTEXT impact
- `core/state-store` (package `com.homesynapse.state`): real `DerivationRule`, `DispatchingProjectionAdvancer`, `StateProjection` reconciliation/backfill logic, provenance flag, determinism contract. Largest change surface.
- `core/persistence` (package `com.homesynapse.persistence`): `AtomicCheckpointWriter` already in place (AMD-45); add replay-duration metric (REC-80); deprecate `CheckpointRecord.projectionVersion()` accessor (REC-82). `SqliteStateStore` remains an in-memory `ConcurrentHashMap` (no SQLite table) — unchanged.
- `AttributeValueUpcaster` SPI: placed in the deserialization path feeding both `onEvent` and `processBatch` (REC-78).
- All sqlite-jdbc I/O remains on bounded platform-thread executors (write=1, read=2-3) per AMD-26/27 (JNI carrier pinning) — the replay read path must use the read executor, never a virtual thread.
- LTD-11 (no `synchronized`, `ReentrantLock` only) applies to any new lock guarding reconciliation state.

VERIFY against source before implementation: exact `applyToState` signature and draft-apply call site; whether `DerivationContext` exposes any clock/registry accessor; exact `CheckpointRecord` / `StateCheckpointSource` method signatures; `EventDraft` constructor shape for the `state_changed` draft.