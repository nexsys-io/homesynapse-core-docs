# Research Internalization Report — Smart Home Architecture Gaps

**Document type:** Governance — research findings internalization and disposition
**Author:** PM (governance mode)
**Date:** 2026-04-15
**Input:** "Architectural gaps in smart home platforms that HomeSynapse Core must solve" (research artifact, filed in `homesynapse-core-docs/research/`)
**Scope:** All 7 research findings mapped to existing governance artifacts (invariants, locked decisions, amendments, design documents, MODULE_CONTEXT files) with dispositions and downstream actions

---

## Executive Summary

The research surveyed failure modes across Home Assistant, OpenHAB, SmartThings, Hubitat, Matter, Z-Wave, Zigbee, and multiple event store implementations (EventStoreDB, Marten, Chronicle Queue, cr-sqlite). It identified 7 architectural gap categories that smart home platforms consistently fail to address. This report maps each finding against HomeSynapse Core's existing governance to determine whether it is already handled, requires new governance action, should be deferred with compatibility constraints, or creates test backlog items.

**Assessment: HomeSynapse's architecture is fundamentally sound against every finding.** The local-first invariants (INV-LF-*), event sourcing guarantees (INV-ES-*), integration isolation (INV-RF-01), and the platform thread executor pattern (AMD-26/27) address the most critical failure modes. However, 3 findings require governance annotations to prevent future regression, and 1 finding generates a concrete test hardening backlog that should be executed in the M2-bridge pass before M3 begins.

**Finding count by disposition:**

| Disposition | Count | Action Required |
|---|---|---|
| VALIDATED | 4 | None — existing governance covers these |
| GOVERNANCE ANNOTATION | 2 | MODULE_CONTEXT notes, open question additions |
| IMPLEMENTATION (M2.9) | 1 | SD card detection at startup |
| TEST BACKLOG | 1 | 16 specific test scenarios for M2-bridge |

---

## Step 1 — Finding Dispositions

### Finding R-01: Event Bus Must Be Parallel and Priority-Aware

**Research claim:** Single-threaded event loops are the "original sin" of Home Assistant (Python asyncio) and OpenHAB (single OSGi dispatch thread). No platform implements backpressure, event prioritization, or load shedding at the framework level.

**Disposition: VALIDATED**

HomeSynapse's event bus architecture is fundamentally different from every platform cited:

| Research Concern | HomeSynapse Response | Governing Artifact |
|---|---|---|
| Single-threaded dispatch | Pull-based subscription; each subscriber runs on a dedicated virtual thread | Doc 01 §3.4, LTD-11 |
| No backpressure | WriteCoordinator priority queue with 5 tiers; subscribers poll at their own rate | AMD-32, WritePriority enum |
| No event prioritization | EventPriority (CRITICAL / NORMAL / DIAGNOSTIC) + WritePriority (5 tiers) | Doc 01 §3.3, AMD-32 |
| Slow listener blocks all | Subscribers are independent virtual threads; one slow subscriber cannot block others | LTD-11, Doc 01 §3.4 |
| No load shedding | Subscription filters with eventType, severity, and subjectType dimensions; coalesceExempt flag for critical subscribers | Doc 01 §3.4, SubscriptionFilter |

**Cascade amplification** (N sensors → N events → N derived events → all serialized through single write thread) remains a real concern at scale. The research prompt on "Adaptive Event Cascade Optimization" (filed separately, 2026-04-12) addresses this. For MVP scope (50 devices, <500 events/sec sustained), the single-writer model at 24,473 events/sec measured burst capacity provides ~50× headroom above design sustained rate.

**No action required.**

---

### Finding R-02: Cross-Protocol Event Ordering Is Fundamentally Unsolved

**Research claim:** No platform implements vector clocks, Lamport timestamps, or formal causal ordering across heterogeneous protocol stacks. Hub-arrival-time ordering with eventual consistency is the universal pragmatic approach.

**Disposition: VALIDATED + GOVERNANCE ANNOTATION (deferred capability)**

HomeSynapse's dual-timestamp model already addresses this:

| Research Concern | HomeSynapse Response | Governing Artifact |
|---|---|---|
| No causal ordering | `correlationId` + `causationId` in every EventEnvelope; causal chain queries via `readByCorrelation()` | INV-ES-06, Doc 01 §4.1 |
| Conflated timestamps | `eventTime` (real-world occurrence, nullable) + `ingestTime` (hub-received, always set) as separate fields | INV-ES-08 |
| No gap detection | Per-entity `subjectSequence` with UNIQUE constraint on (subject_ref, subject_sequence) | LTD-05, Doc 01 §4.2 |
| Hub-arrival-time as source of truth | `ingestTime` serves this role; `eventTime` is preserved as metadata for forensic analysis | INV-ES-08, Doc 04 §3.4 |

**Deferred capability — Hybrid Logical Clocks (HLC):**

The research recommends HLC timestamps at ingestion for stronger cross-protocol ordering. HomeSynapse's current `ingestTime` (plain `Instant`) provides wall-clock ordering but cannot detect concurrent events that arrive within the same clock tick. HLC combines a physical clock with a logical counter to produce timestamps that are both monotonic and causally consistent.

This is a Tier 2+ optimization. The current schema can accommodate HLC via the nullable `event_time` column or a future V002 migration adding an `hlc` column. The event envelope's `ingestTime` field would remain unchanged — HLC would be an additional persistence-layer concern.

**Governance annotation required:**

Add to Doc 01 §15 (Open Questions) or Doc 04 §15 (Open Questions):

```
### Hybrid Logical Clock Timestamps (Research: Architecture Gaps §2)

For Tier 2+ multi-protocol deployments, evaluate HLC (Hybrid Logical Clock)
timestamps as an ingestion-time ordering mechanism. HLC combines a physical
clock with a logical counter to produce timestamps that are monotonic,
causally consistent, and backward-compatible with plain wall-clock timestamps.

Current dual-timestamp model (eventTime + ingestTime) is sufficient for
single-protocol MVP. HLC becomes valuable when:
- Multiple protocols (Zigbee + Z-Wave + Matter) report simultaneously
- Cross-protocol causal ordering is needed for automation conditions
- Multi-instance sync requires convergent timestamp ordering (INV-LF-05)

Activation criteria: Tier 2 multi-protocol integration implementation begins.
Schema impact: Possible V002 migration adding hlc INTEGER column to events table.
Invariant alignment: INV-ES-08 (dual timestamps), INV-LF-05 (convergent sync).
```

---

### Finding R-03: Device Identity Must Decouple from Hardware Identity

**Research claim:** Device replacement is the #1 lifecycle complaint across HA, SmartThings, and Hubitat. Entity IDs embed domain prefixes creating tight coupling between identity and capability type. No general cross-integration solution exists.

**Disposition: VALIDATED**

This is one of HomeSynapse's strongest architectural positions:

| Research Concern | HomeSynapse Response | Governing Artifact |
|---|---|---|
| Identity = hardware address | EntityId (stable, survives hardware replacement) ≠ DeviceId (bound to physical hardware) | INV-CS-02 |
| Entity IDs embed capability type | EntityId is a typed ULID wrapper with no domain prefix or capability encoding | LTD-04, Identity Model §2 |
| Automations break on replacement | Automations bind to EntityId (logical), not DeviceId (physical) | INV-CS-02, Doc 07 |
| No formal replacement flow | Entity transfer mechanism preserves EntityId while remapping DeviceId | Doc 02 §3.1, `entity_transferred` event type |

The architecture benchmark (2026-03-21) added `plannedRestart` to IntegrationHealthRecord and specified the event-based communication path for integration restarts, further validating the decoupled identity model.

**No action required.**

---

### Finding R-04: SQLite on Flash Storage Is a Scaling Risk

**Research claim:** SQLite databases grow to 7–53 GB in HA deployments. Purge operations consume 100% CPU. WAL mode with `synchronous=NORMAL` risks committed transaction loss on power failure. SD cards are a ticking time bomb. F2FS delivers 2× SQLite performance over ext4.

**Disposition: PARTIALLY VALIDATED — requires M2.9 implementation + test backlog**

What HomeSynapse already handles:

| Research Concern | HomeSynapse Response | Governing Artifact |
|---|---|---|
| NVMe required | Pi 5 + NVMe is the recommended deployment target | LTD-02 |
| WAL mode + synchronous=NORMAL | Configured via LTD-03 PRAGMAs; single-writer model limits in-flight data to at most one event | LTD-03, Doc 04 §3.2 |
| Database growth | Per-priority-tier retention (DIAGNOSTIC 7d, NORMAL 90d, CRITICAL 365d) with per-event-type overrides | Doc 04 §3.4, Doc 01 §3.3 |
| VACUUM cost | Incremental vacuum (routine, low-impact) vs full VACUUM (quarterly, opt-in, requires 2× space) | Doc 04 §3.3 |
| Snapshot optimization | Checkpoint strategy with configurable triggers (time-based, event-count-based, minimum spacing) | Doc 03 §3.3, Doc 04 §3.12 |

**What requires M2.9 implementation:**

**SD card detection.** The research's single most documented failure mode is SQLite on SD cards. M2.9 should detect SD card backing storage at startup and log a WARNING. Implementation: on Linux, inspect `/sys/block/<device>/queue/rotational` and `/sys/block/<device>/removable` for the filesystem hosting the data directory. This is a 10-line check with high user-protection value.

**WAL flush on graceful shutdown.** `PRAGMA wal_checkpoint(TRUNCATE)` during shutdown eliminates the power-loss vulnerability window. The WAL file is the only data-loss risk under `synchronous=NORMAL`. A clean shutdown should produce a clean database state with no pending WAL frames.

**What is deferred (post-MVP):**

| Deferred Item | Activation Criteria | Invariant Alignment |
|---|---|---|
| F2FS filesystem recommendation | Phase 3 hardening pass; empirical validation on Pi 5 NVMe | INV-PR-01 |
| Tiered storage (hot/warm/cold) | Event store consistently exceeds 2 GB; profiling shows retention DELETE is a performance bottleneck | INV-PR-03, INV-RF-05 |
| Per-entity retention granularity | User demand or energy monitoring data volumes require entity-level retention policies | Doc 04 §3.4 |
| Compressed columnar cold storage | Analytics queries over >90 day time ranges become a product feature | INV-PR-03 |

**Test backlog items** (see Step 3 below):

- Database growth under sustained load (TB-04)
- WAL checkpoint behavior during concurrent writes (TB-05)
- Purge/retention under storage pressure (TB-06)
- SD card detection accuracy (TB-14)

---

### Finding R-05: Multi-Hub Sync via CRDTs Is the Industry's Biggest Unsolved Problem

**Research claim:** No existing platform provides distributed state management across multiple hubs. CRDTs (LWW-Registers, OR-Sets, delta-state) are the most promising foundation. cr-sqlite enables CRDT-based SQLite multi-master replication. Metadata overhead is a real concern (4–5× inflation for naive implementations; Atoms.co reduced this 4× via parallel version trees).

**Disposition: GOVERNANCE ANNOTATION REQUIRED — sync scope classification for persistence tables**

INV-LF-05 (Convergent Sync Architecture) already constrains the data model to support convergent synchronization. The research validates that our per-entity sequences with ULIDs are inherently compatible with convergent sync. No architectural changes are needed.

However, the research introduces a critical distinction that our governance does not capture: **not all persistence tables participate in sync.**

| Table | Sync Scope | Rationale |
|---|---|---|
| `events` | **SYNCABLE** | The append-only event log is the source of truth. Per-entity sequences + ULIDs enable convergent merge. Event log is what syncs between instances. |
| `subscriber_checkpoints` | **LOCAL-ONLY** | Each instance maintains its own subscriber positions. Subscriber processing state is per-instance — converging checkpoint positions across instances is semantically meaningless (each instance runs its own projection pipeline). |
| `view_checkpoints` | **LOCAL-ONLY** | Each instance maintains its own materialized view snapshots. Projections are rebuilt from the event log on each instance. Syncing checkpoint BLOBs would be both wasteful and incorrect (projection versions may differ between instances). |
| `hs_schema_version` | **LOCAL-ONLY** | Per-instance migration state. Schema versions may differ during rolling upgrades. |
| `telemetry_samples` (future) | **LOCAL-ONLY** | Ring buffer data is ephemeral and instance-local. Meaningful telemetry is promoted to domain events (which are syncable). |
| `aggregation_cursors` (future) | **LOCAL-ONLY** | Per-instance aggregation processing state. |

**Governance annotation required:**

Add to `core/persistence/MODULE_CONTEXT.md` under Gotchas or a new "Sync Scope Classification" section:

```
### Sync Scope Classification (Research: Architecture Gaps §5)

When multi-instance sync is implemented (INV-LF-05), only the `events`
table participates in cross-instance replication. All other persistence
tables are LOCAL-ONLY — each instance maintains its own state for these
tables. Projections (subscriber checkpoints, view checkpoints) are
rebuilt from the replicated event log on each instance.

| Table                    | Sync Scope  | Rationale                              |
|--------------------------|-------------|----------------------------------------|
| events                   | SYNCABLE    | Append-only event log, source of truth |
| subscriber_checkpoints   | LOCAL-ONLY  | Per-instance subscriber positions      |
| view_checkpoints         | LOCAL-ONLY  | Per-instance materialized view state   |
| hs_schema_version        | LOCAL-ONLY  | Per-instance migration tracking        |

DO NOT add cr-sqlite CRDT replication to LOCAL-ONLY tables. Converging
subscriber/view checkpoint positions across instances would break the
atomic checkpoint invariant (Doc 04 §3.12) and produce semantically
nonsensical projection state.
```

This annotation also applies to M2.8 (AtomicCheckpointWriter). The atomic transaction between `subscriber_checkpoints` and `view_checkpoints` is a per-instance correctness guarantee. It does not and should not participate in cross-instance sync. The AtomicCheckpointWriter's Javadoc should note this.

---

### Finding R-06: Matter Architecture Is the Right Bet

**Research claim:** Matter's cluster-composition device model, priority-tiered events, and energy management clusters represent the most architecturally sophisticated consumer IoT standard. Energy management is emerging as the most significant new domain. Edge AI is becoming practical on hub hardware.

**Disposition: VALIDATED for device model; DEFERRED for energy and AI**

| Research Concern | HomeSynapse Response | Governing Artifact |
|---|---|---|
| Cluster-composition device model | Sealed Capability hierarchy (16 types) with composition | Doc 02, device-model MODULE_CONTEXT |
| Priority-tiered events | EventPriority (CRITICAL / NORMAL / DIAGNOSTIC) | Doc 01 §3.3 |
| Energy as first-class domain | 5 energy invariants (INV-EI-01 through INV-EI-05) | Architecture Invariants §12 |
| On-device intelligence | 5 AI invariants (INV-AI-01 through INV-AI-05); AI as enhancement, never foundation | Architecture Invariants §11 |
| Model lifecycle management | Research prompt filed for "On-Device Adaptive Heuristics" (2026-04-12) | Separate research artifact |

**No governance action required.** Energy integration and AI inference pipeline are Tier 2+ capabilities. The invariants establish the architectural constraints; the implementation is scoped per the phased delivery plan in Architecture Invariants §16.

---

### Finding R-07: Local-First Is a Hard Constraint, Not a Feature

**Research claim:** Insteon (zero-notice shutdown), Wink ($4.99/month ransom), Google Nest Secure (killed for ADT partnership), Amazon Echo Connect (3 weeks notice) — cloud-dependent platforms are a graveyard. HA avoids cloud dependency but runs 1,054 integrations in one process with no isolation. The "Frozen HA" community proposal validates architectural decoupling.

**Disposition: VALIDATED**

This is HomeSynapse's strongest architectural position and the foundation of the competitive strategy:

| Research Concern | HomeSynapse Response | Governing Artifact |
|---|---|---|
| Cloud dependency | Local-first is constitutional; internet is optional | INV-LF-01 through INV-LF-05 |
| No cloud account required | INV-LF-04: local operation never requires any account | INV-LF-04 |
| Monolithic process | JPMS-enforced module boundaries; per-integration fault domains | INV-RF-01, LTD-10, LTD-17 |
| Integration crash isolation | One adapter's failure cannot crash core or other integrations | INV-RF-01, Doc 05 |
| LTS stability | Designed for years-long operation on constrained hardware without intervention | INV-PR-03, MVP §3 |

The research's documentation of cloud platform failures (Insteon, Wink, Revolv, Iris, iHome, Staples Connect) validates HomeSynapse's competitive messaging. The "Frozen HA" community proposal — decoupling device management from HA using MQTT as a stable identity layer — is an explicit architectural critique of monolithic coupling that HomeSynapse addresses structurally.

**No action required.**

---

## Step 2 — Downstream Actions Summary

### Actions for M2.8 (AtomicCheckpointWriter)

| Action | Source Finding | Description |
|---|---|---|
| Javadoc annotation | R-05 | AtomicCheckpointWriter Javadoc must note that the atomic transaction operates on LOCAL-ONLY tables that do not participate in cross-instance sync. The event log syncs; projections rebuild locally. |
| Test grounding | R-04, R-05 | Test scenarios must validate atomic commit, atomic rollback, position consistency (the invariant crash recovery depends on), and WAL snapshot isolation for concurrent readers. Each test should reference the research finding that grounds it. |

### Actions for M2.9 (PersistenceLifecycle)

| Action | Source Finding | Description |
|---|---|---|
| SD card detection | R-04 | Detect SD card backing storage at startup. Log WARNING with actionable message: "Database is on removable/SD card storage. This configuration is not recommended for production use. See homesynapse.com/docs/storage for recommended configurations." Do not block startup. |
| WAL flush on shutdown | R-04 | Execute `PRAGMA wal_checkpoint(TRUNCATE)` during graceful shutdown to eliminate the power-loss vulnerability window. |
| Store wiring | R-05 | Wire AtomicCheckpointWriter with references to both stores. Expose via typed accessor for the State Projection subscriber. |

### Actions for MODULE_CONTEXT Updates (after M2.8/M2.9)

| Action | Source Finding | Description |
|---|---|---|
| Sync scope table | R-05 | Add sync scope classification table to persistence MODULE_CONTEXT (see §R-05 above) |
| M2.8/M2.9 type additions | All | Update type inventory with AtomicCheckpointWriter and PersistenceLifecycle implementation |

### Actions for Design Document Open Questions

| Action | Source Finding | Description |
|---|---|---|
| HLC timestamp note | R-02 | Add HLC evaluation note to Doc 01 or Doc 04 open questions (see §R-02 above) |

---

## Step 3 — Test Hardening Backlog (M2-Bridge)

These test scenarios are derived directly from the research's documented failure modes. Each is traceable to a specific finding and validates that HomeSynapse's implementation actually defends against the failure mode, not just that the architecture describes a defense.

**Scope:** 16 test scenarios organized by failure-mode category. Execute as a focused hardening pass after M2.9, before M3 begins.

### Group A — Atomic Checkpoint Integrity (Research: R-04 §exactly-once, R-05 §local-only)

| ID | Scenario | Expected Outcome | Research Grounding |
|---|---|---|---|
| TB-01 | Write atomic checkpoint (subscriber + view), then read both stores | Both stores return consistent position and data | "Single most important pattern for exactly-once processing" |
| TB-02 | Simulate failure during atomic write (e.g., corrupt view data after subscriber SQL succeeds, before commit) | NEITHER store is updated; both reflect pre-transaction state | Oskar Dudycz's same-transaction pattern |
| TB-03 | Write atomic checkpoint at position 100, overwrite at 200, read both | Both stores reflect 200; no mixture of 100 and 200 | Overwrite atomicity |

### Group B — Storage Durability and Growth (Research: R-04 §SQLite-on-flash)

| ID | Scenario | Expected Outcome | Research Grounding |
|---|---|---|---|
| TB-04 | Publish 10,000 events across 3 priority tiers; verify database size is bounded | Database size < 5 MB for 10K small events; indexes contribute expected overhead | HA databases growing to 7–53 GB without retention |
| TB-05 | Concurrent writes (event publish) and reads (readFrom, readBySubject) during active WAL | All reads return consistent data; no SQLITE_BUSY exceptions | WAL concurrent access; HA recorder blocking event loop |
| TB-06 | Fill database to storage pressure threshold; verify retention fires and reclaims space | Retention deletes eligible events; incremental vacuum reclaims freelist pages; database size decreases | HA purge consuming 100% CPU on 6 GB database |

### Group C — Crash Recovery Sequence (Research: R-04 §power-loss, R-07 §reliability)

| ID | Scenario | Expected Outcome | Research Grounding |
|---|---|---|---|
| TB-07 | Write events and checkpoint; close database without shutdown (simulated crash); reopen | All committed events present; WAL recovery transparent; checkpoint at pre-crash position | "Committed transactions survive process crashes" |
| TB-08 | Write events; checkpoint at position 50; write more events to position 100; crash; reopen | Events 1–100 all present; checkpoint at 50; replay from 50 produces correct state | Doc 12 §3.5 startup recovery sequence |
| TB-09 | Start with no database file (fresh install); verify full initialization | Database created, PRAGMAs set, V001 migration applied, all stores functional | INV-CE-02 zero-config first run |

### Group D — Event Store Contract Extensions (Research: R-01 §event-storms, R-02 §ordering)

| ID | Scenario | Expected Outcome | Research Grounding |
|---|---|---|---|
| TB-10 | Publish events for 50 distinct entities concurrently (50 virtual threads submitting to write coordinator) | All events persisted in correct per-entity sequence order; zero SequenceConflictException; global_position monotonically increasing | HA event loop blocking under 500-entity load |
| TB-11 | Read from position 0 with empty database | Returns empty EventPage with hasMore=false | Empty-poll behavior; startup with no events |
| TB-12 | Publish event with DegradedEvent fallback (unknown event type in serialization) | Event persisted with degraded payload; readable without exception | Research: "no platform provides replay-safe event processing" |

### Group E — Lifecycle Robustness (Research: R-04 §startup, R-07 §reliability)

| ID | Scenario | Expected Outcome | Research Grounding |
|---|---|---|---|
| TB-13 | Full lifecycle cycle: start → publish events → checkpoint → shutdown → restart → read events and checkpoint | All data survives; stores are functional after restart | "Boring steady state" — years-long operation |
| TB-14 | Mock `/sys/block/` to simulate SD card backing storage; start PersistenceLifecycle | WARNING logged; startup not blocked; system functional | HA users reporting SD card failures as #1 hardware issue |
| TB-15 | Start with database at current schema version (V001); no migration runs | Migration runner detects version match; skips execution; startup succeeds | Version conflict detection; "the operator must upgrade" |
| TB-16 | Graceful shutdown; verify WAL file is empty or absent after TRUNCATE checkpoint | `database.db-wal` is either 0 bytes or absent; all data flushed to main database | Research: WAL tail is the power-loss vulnerability window |

---

## Step 4 — Deferred Capabilities with Activation Criteria

These are capabilities the research recommends that HomeSynapse should eventually implement, but which are not MVP scope. Each has an activation criterion — an observable condition that triggers the evaluation, not a calendar date.

| ID | Capability | Activation Criteria | Invariant Alignment | Research Source |
|---|---|---|---|---|
| DC-01 | Hybrid Logical Clock timestamps | Tier 2 multi-protocol integration begins (Zigbee + Z-Wave or Matter simultaneously) | INV-ES-08, INV-LF-05 | R-02 |
| DC-02 | cr-sqlite CRDT replication for events table | Multi-instance sync feature scoped; single-instance deployment validated for 6+ months | INV-LF-05 | R-05 |
| DC-03 | F2FS filesystem detection and recommendation | Phase 3 hardening; empirical benchmark on Pi 5 NVMe comparing ext4 vs F2FS | INV-PR-01 | R-04 |
| DC-04 | Tiered storage (hot/warm/cold) | Event store consistently exceeds 2 GB; retention DELETE is a measured performance bottleneck | INV-PR-03, INV-RF-05 | R-04 |
| DC-05 | Per-entity retention granularity | Energy monitoring or high-frequency sensor deployment generates entity-specific storage pressure | Doc 04 §3.4 | R-04 |
| DC-06 | Compressed columnar cold storage | Analytics queries over >90 day time ranges become a product requirement | INV-PR-03 | R-04 |
| DC-07 | Soft leader election for multi-hub automation execution | Multi-instance deployment with shared automation definitions | INV-LF-05, INV-TO-02 | R-05 |
| DC-08 | Edge AI inference pipeline (LightGBM/TinyLSTM) | Behavioral data pipeline (sensor windowing, feature extraction) operational for 3+ months | INV-AI-01 through INV-AI-05 | R-06 |
| DC-09 | Matter energy management cluster integration | Matter 1.4+ devices available for testing; energy monitoring hardware deployed | INV-EI-01 through INV-EI-05 | R-06 |
| DC-10 | Protocol-specific gap detection (Matter event numbers, Z-Wave Supervision CC) | Protocol adapter integration reaches production maturity (Tier 2) | INV-ES-05, INV-MN-01 | R-02 |

---

## Step 5 — Summary Table

| Finding | Disposition | Action | Owner | Timeline |
|---|---|---|---|---|
| R-01: Event bus parallelism | VALIDATED | None | — | — |
| R-02: Cross-protocol ordering | VALIDATED + ANNOTATION | Add HLC note to Doc 01/04 open questions | PM | Before M3 |
| R-03: Device identity decoupling | VALIDATED | None | — | — |
| R-04: SQLite on flash | PARTIAL + M2.9 + TEST BACKLOG | SD card detection (M2.9); WAL flush (M2.9); 6 test scenarios (TB-04 through TB-09) | PM → Coder | M2.9 + M2-bridge |
| R-05: Multi-hub CRDT sync | ANNOTATION | Sync scope table in persistence MODULE_CONTEXT; AtomicCheckpointWriter Javadoc note | PM → Coder | M2.8 + M2.9 |
| R-06: Matter architecture | VALIDATED | None | — | — |
| R-07: Local-first constraint | VALIDATED | None | — | — |

---

## Success Criteria

- [x] Every research finding has a traceable disposition (VALIDATED / ANNOTATION / IMPLEMENTATION / TEST BACKLOG)
- [x] Every VALIDATED disposition cites the specific governing artifact(s) that cover it
- [x] Every ANNOTATION disposition specifies the exact text to add and where
- [x] Every IMPLEMENTATION disposition specifies the milestone (M2.8 or M2.9)
- [x] Every TEST BACKLOG item has a scenario description, expected outcome, and research grounding
- [x] Every deferred capability has an activation criterion, not a calendar date
- [x] No finding is left as "we should think about this later" without a concrete trigger

---

*This report was produced as a read-only governance exercise. No source files were modified. The governance annotations specified in Steps 1 and 2 should be applied during or immediately after the M2.8 and M2.9 milestones. The test hardening backlog (Step 3) constitutes the scope for the M2-bridge pass.*
