# HomeSynapse Core — Design Navigation Index

**Status:** ACTIVE
**Last updated:** 2026-05-16
**Maintainer:** Senior architect + Claude PM

This file is the master index for `homesynapse-core-docs/design/`. It lists every design document and every amendment with its status, target document, and one-line summary. Cowork prompts and Coder agents use this file to verify amendments cited as authority are actually applied.

> **Provenance note (2026-05-16):** This file was created as part of the AMD-41/42/43 governance commit. Earlier amendments are listed here from the on-disk inventory in `homesynapse-core-docs/design/amendments/`. Coverage of pre-2026-05-15 amendments may be incomplete; the on-disk file remains the source of truth in case of disagreement.

---

## Design Documents

| Doc | File | Status | Notes |
|---|---|---|---|
| Doc 01 — Event Model & Event Bus | `01-event-model-and-event-bus.md` | Locked Phase 2 | §3.4 Subscriber model updated by AMD-42; §3.6 Backpressure updated by AMD-43. |
| Doc 02 — Device Model & Capability System | `02-device-model-and-capability-system.md` | Locked Phase 2 | — |
| Doc 03 — State Store & State Projection | `03-state-store-and-state-projection.md` | Locked Phase 2 | §3.2 State Projection runtime model rewritten by AMD-41 (§3.2.1–§3.2.4). §8.1 `StateQueryService` interface remains locked (5 methods). |
| Doc 04 — Persistence Layer | `04-persistence-layer.md` | Locked Phase 2 | §3.4 Retention updated by AMD-40. PRAGMA `journal_size_limit` discussion in LTD-03 — see AMD-39 (withdrawn). |
| Doc 05 — Integration Runtime | `05-integration-runtime.md` | Locked Phase 2 | — |
| Doc 06 — Configuration System | `06-configuration-system.md` | Locked Phase 2 | — |
| Doc 07 — Automation Engine | `07-automation-engine.md` | Locked Phase 2 | AMD-25 Temporal Duration Trigger Modifier; AMD-31 Command Execution Order Guarantees. |
| Doc 08 — Zigbee Adapter | `08-zigbee-adapter.md` | Locked Phase 2 | — |
| Doc 09 — REST API | `09-rest-api.md` | Locked Phase 2 | M3.5b/M3.6 endpoint additions live in `api/rest-api`; admin path / auth integration is an open question in plan §13.3. |
| Doc 10 — WebSocket API | `10-websocket-api.md` | Locked Phase 2 | Out of M3 scope. |
| Doc 11 — Observability & Debugging | `11-observability-and-debugging.md` | Locked Phase 2 (2026-03-09) | New sub-section "Event bus and writer metrics" landed via AMD-43 §3.6.2. |
| Doc 12 — Startup, Lifecycle, Shutdown | `12-startup-lifecycle-shutdown.md` | Locked Phase 2 | Subscriber registration and wiring order updated implicitly by AMD-42. |
| Doc 13 — Web UI Observability MVP | `13-web-ui-observability-mvp.md` | Locked Phase 2 | — |
| Doc 14 — Master Architecture Document | `14-master-architecture-document.md` | Locked Phase 2 | — |
| Phase 3 Master Implementation Plan v2 | `HomeSynapse_Phase3_Master_Implementation_Plan_v2.md` | Active | M3 detail lives in `PLAN-M3-CONSOLIDATED-02` (source-verified). |
| V003 Snapshots Design Note | `v003_snapshots_design_note.md` | Note (M2→M3 bridge, 2026-05-15) | Schema rationale for the `snapshots` table created by V003. `SqliteSnapshotStore` implementation deferred per AMD-41 §3.2.3. |

---

## Amendments

The on-disk inventory in `design/amendments/` contains numbered amendments AMD-25 through AMD-53 plus the non-numbered `AMD-M2Bridge_Tier2_Schema_Reservations.md`. AMD-01..AMD-24, AMD-28..AMD-30, AMD-46, AMD-48, AMD-49 are intentionally non-existent or reserved-unused (the numbering is not contiguous — early decisions were resolved without going to amendment; the M4 device/projection blocks 44–52 are allocated under the P2 scheme; AMD-53 — the timestamp-model unifier — is the next free monotonic integer past the exhausted projection band, with the integration block's indicative range re-basing to 54+). **On-disk amendment watermark: AMD-53 (raised from AMD-52 on 2026-05-31 at AMD-53 ratification).**

| AMD | Subject | Tier | Status | Target | One-line |
|---|---|---|---|---|---|
| AMD-25 | Temporal Duration Trigger Modifier | Doc 07 | APPLIED | Doc 07 Automation Engine | Trigger expression duration modifier semantics. |
| AMD-26 | sqlite-jdbc VT Carrier Pinning Mitigation | Architectural invariant | APPLIED | Persistence layer | All SQLite writes routed through a dedicated platform-thread `WriteCoordinator`. Partner to AMD-27. |
| AMD-27 | Persistence Layer Platform Thread Executor (reads) | Architectural invariant | APPLIED | Persistence layer | All SQLite reads routed through a bounded platform-thread `ReadExecutor` (round-robin pool). Partner to AMD-26. |
| AMD-31 | Command Execution Order Guarantees | Doc 07 | APPLIED | Automation Engine | Causal ordering of command emission. |
| AMD-32 | Persistence Internal Types | Doc 04 | APPLIED | Persistence layer | Package-private boundary for internal SQLite types. |
| AMD-33 | DomainEvent Permanently Non-Sealed | Doc 01 | APPLIED | Event model | `DomainEvent` is a non-sealed interface (not sealed) to allow downstream extension. |
| AMD-34 | Home Identity Schema Reservation | M2→M3 bridge | APPLIED | Persistence schema | Reserves columns/tables for future Home identity. |
| AMD-35 | Persistent Idempotency Key | Architectural invariant | APPLIED | Event model + Persistence | Adds `idempotencyKey` (9th field on `EventDraft`, max 128 chars). Partial unique index `(home_id, idempotency_key)`. |
| AMD-36 | Subscriber Dead-Letter Queue | M2→M3 bridge | APPLIED | Persistence + Event bus | Adds `subscriber_dead_letters` table via V002 (11 columns, `UNIQUE(subscriber_id, event_position)`, NO `status` column — row presence IS the parked state). Default retry cap = 5. Park-and-advance is atomic via `AtomicCheckpointWriter`. |
| AMD-37 | Chain Hash Not Null With Zero Default | M2→M3 bridge | APPLIED | Persistence schema | `chain_hash` column made NOT NULL with zero-byte default. |
| AMD-38 | Checkpoint Policy Revision | M2→M3 bridge | APPLIED (2026-05-15) | Doc 03 | Universal cadence `event_threshold=200`, `max_interval_seconds=2`, bounded-window reader `DEFAULT_MAX_ROWS=500`. Source: D1 WAL Pathology Validation Spike (2026-05-15). |
| AMD-39 | Journal Size Limit Revision | M2→M3 bridge | **WITHDRAWN (2026-05-15)** | LTD-03 PRAGMA `journal_size_limit` | Proposed raise to 64 MB withdrawn after D1 validated 6 MB is sufficient under the bounded-window reader pattern. **Note: AMD-39 has nothing to do with clock injection — citation errors in earlier plan drafts have been corrected.** |
| AMD-40 | Retention Execution Model | M2→M3 bridge | APPLIED (2026-05-15) | Doc 04 §3.4 | Retention routes through `WriteCoordinator` at RETENTION priority. Interval-based (6h). Bounded chunks (1000 rows, ≤2s lock hold). |
| AMD-M2Bridge | Tier-2 Schema Reservations | M2→M3 bridge | APPLIED | Persistence schema | Additional Tier-2 reservations bundled with M2→M3 bridge work. |
| **AMD-41** | **State Projection Execution Model** | **Tier-1** | **APPLIED (2026-05-16)** | **Doc 03 §3.2** | **Two-phase read/publish/checkpoint discipline; SelfProducedFilter (60s TTL); reconciliation pass on `projectionVersion` mismatch; reconciliation metadata uses existing `CheckpointRecord.data` slot (no schema migration).** |
| **AMD-42** | **Subscriber Lifecycle and Isolation** | **Tier-1** | **APPLIED (2026-05-16)** | **Doc 01 §3.4** | **Five-state subscriber mode FSM (COLD/REPLAY/TRANSITION/LIVE/SUSPENDED), three-phase REPLAY→LIVE, `onCaughtUp()` single-shot, INV-SUB-ISO-01..06 per-subscriber resources, supervisor with 3s/30s/0.2 backoff and 5-crash circuit breaker.** |
| **AMD-43** | **Backpressure and Observability** | **Tier-1** | **APPLIED (2026-05-16)** | **Doc 01 §3.6 + Doc 11 §3.X** | **`EventPublisher.publish()` non-blocking on writer-queue depth (INV-BUS-02). Seven canonical bus metric names. `QueueSaturationHealthCheck` with WARN@5000/CRITICAL@10000. Per-subscriber `DerivedWriteRateLimit` (200/s default for `StateProjection`).** |
| AMD-44 | Floor Aggregate and EntityRole Enum | Doc 02 | RATIFIED (pending implementation) | Device model | Floor spatial aggregate + `EntityRole` enum. |
| AMD-45 | Atomic Subscriber+View Checkpoint Coupling | Tier-1 | APPLIED (2026-05-29, M4.0a `a441fdf`) | Doc 03 | Atomic subscriber+view checkpoint via `AtomicCheckpointSink` seam (AMD-45-INV-01); gated at all three writers (LIVE + both REPLAY writes). |
| AMD-47 | AttributeValue Hierarchy Expansion + AttributeValueUpcaster SPI | Tier-1 | APPLIED (2026-05-30, M4.B3 `60b4185`) | Doc 02 | 8-variant sealed `AttributeValue` (+`QuantityValue`/`ArrayValue`/`DegradedAttributeValue`), `AttributeValueUpcaster` SPI (no `ServiceLoader`), `QuantityValue` canonicalize-at-construction. AMD-47-INV-01..05 (§20). |
| AMD-50 | Version-Transition Reconciliation Backfill + Cursor Determinism | Tier-1 | RATIFIED + APPLIED (2026-05-29, M4.0b-2 `7610296`) | Doc 03 | General N→M reconciliation-backfill, supersession, cursor-as-log-position, `Clock` removed from `DerivationContext`. AMD-50-INV-01..04. |
| **AMD-51** | **Typed `AttributeValue` Change-Detection Comparator** | **Tier-1** | **RATIFIED (2026-05-30)** | **Doc 03 §3.2** | **External `AttributeValueComparator` in state-store (`ComparisonPolicy`, exhaustive no-`default` switch, DEC-M3-16 gateway); per-type structural equality + pinned total-form float/quantity epsilon (`1e-9`, IEEE totality); units free via AMD-47; both operands reconstructed to schema-typed form (prior is always `StringValue`); String `StateChangedEvent` payload preserved (typed payload = AMD-52, staged); `projectionVersion` 2→3 on AMD-50 backfill. AMD-51-INV-01..05 (§21). Implemented by M4.0b-3 (committed `98f705b`).** |
| **AMD-52** | **Typed `StateChangedEvent` Payload — `AttributeValue` Serializer + Replay** | **Tier-1** | **RATIFIED (2026-05-31)** | **Doc 01 §4.6 / Doc 03 §3.2 / Doc 04 §3.6** | **`StateChangedEvent.oldValue/newValue` String→`AttributeValue` (oldValue nullable = first report); custom `JsonSerializer`/`JsonDeserializer` in `core/persistence` with compact `{"t":<AttributeType>,"v":…}` envelope, exhaustive no-`default` switch, NO `@JsonTypeInfo` (Jackson-isolation + Rule 7), no new module edge/Jackson artifact; bit-anchored float identity (`Double.doubleToLongBits`; text round-trippable; `chain_hash` stays inert AMD-37); JSON-valid non-finite sentinels; per-event `schema_version` 1→2 discriminator (no row migration, G5); Path A re-derivation authoritative, Path B legacy reads → defined `DegradedEvent`; typed checkpoint envelope (S2); `projectionVersion` 3→4 on AMD-50's frozen backfill. AMD-52-INV-01..07 (§22). Implemented by M4.0b-4b (committed `72596cb`).** |
| **AMD-53** | **Timestamp-Model Unifier — Event-Time Activity Timestamps** | **Tier-1** | **RATIFIED (2026-05-31)** | **Doc 03 §4.1 / §3.2 / §3.8** | **`EntityState.lastChanged`/`lastUpdated`/`lastReported` sourced from `eventTime ?? ingestTime` in every projection path (LIVE `applyToState` all branches, reconciliation backfill, entity-adoption seeding) — never the projection wall-clock; brings LIVE into compliance with the Doc 03 §4.1 contract and makes the three fields replay-deterministic. Extends AMD-50-INV-03 from the `DerivationRule` to the materialization. `staleAfter`/`stale` explicitly carved out (real-time freshness). `projectionVersion` 4→5 on AMD-50's frozen backfill (heals legacy wall-clock timestamps). AMD-53-INV-01..02 (§23). Implemented by M4.0b-5 (timestamp-unifier WU; instruction issued).** |

---

## Locked Decisions

For the M3 milestone, the senior architect's lock closes twelve decisions DEC-M3-01 through DEC-M3-12 plus the post-deliberation DEC-M3-13 (M3.4 integration-test module placement). See `PLAN-M3-CONSOLIDATED-02` §1.2 and §12 for the resolved-decisions ledger. The locked decisions table is reproduced abbreviated below for cross-reference:

| ID | Subject | Locking amendment |
|---|---|---|
| DEC-M3-01 | Projection read/write discipline | AMD-41 §3.2.1 |
| DEC-M3-02 | Self-produced event detection | AMD-41 §3.2.2 |
| DEC-M3-03 | REPLAY→LIVE transition | AMD-42 §3.4.2 |
| DEC-M3-04 (modified) | State projection checkpoints | AMD-41 §3.2.3 |
| DEC-M3-05 | Snapshot format | AMD-41 §3.2.3 + §3.2.4 |
| DEC-M3-06 (augmented) | Subscriber isolation | AMD-42 §3.4.4..§3.4.6 |
| DEC-M3-07 | Coalescing | AMD-43 §3.6.5 (deferred) |
| DEC-M3-08 (rejected, replaced) | Backpressure | AMD-43 §3.6.1 |
| DEC-M3-09 | Clock injection | `NO_DIRECT_TIME_ACCESS` ArchUnit rule (extended to M3 per DEC-M3-09 — not an AMD) |
| DEC-M3-10 | State_changed derivation | AMD-41 (scope) |
| DEC-M3-11 | Implementation order | Planning lock (PLAN-M3-CONSOLIDATED-02 §1.2) |
| DEC-M3-12 (modified) | Pi 4 support | AMD-43 §3.6.6 |
| DEC-M3-13 | M3.4 integration-test module placement | PLAN-M3-CONSOLIDATED-02 §8.2 |

---

## M3 Readiness

M3 governance prerequisites complete on 2026-05-16: AMD-41, AMD-42, AMD-43 land in this commit alongside the MODULE_CONTEXT updates for `core/event-bus` and `core/state-store` and this Navigation Index. Deliverable 0 (`ProjectionAdvancer` signature change) is the first code commit and gates M3.1.

## M4 Readiness

Placeholder — populated after the M3 exit-gate sign-off (see `PLAN-M3-CONSOLIDATED-02` §14).
