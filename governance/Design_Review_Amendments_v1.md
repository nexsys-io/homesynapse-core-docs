# HomeSynapse Core — Design Review Amendments (v1)

**Document type:** Governance — specification amendments
**Status:** Approved
**Approval date:** 2026-03-16
**Approval note:** All 14 BLOCKING + REQUIRED amendments were applied during Rounds 10-11. 8 RECOMMENDED amendments remain deferred for opportunistic application.
**Scope:** Amendments to subsystem design documents 01–11 arising from adversarial architecture review
**Date:** 2026-03-09
**Review method:** Fresh-perspective critical analysis of all 11 design documents, cross-referenced against Architecture Invariants v1, Locked Decisions Register v1, and Project MVP v1
**Owner:** nick@nexsys.io

---

## 0. How to Read This Document

Each amendment is a self-contained specification change. Amendments are organized by priority tier, not by document number, because the most important changes span multiple documents.

**Amendment structure:**

| Field | Purpose |
|---|---|
| **ID** | Stable identifier: `AMD-{NUMBER}` |
| **Affected docs** | Which design document(s) require changes |
| **Section(s)** | Specific section numbers to modify |
| **Classification** | BLOCKING (must resolve before Phase 2 interface specs) or REQUIRED (must resolve before Phase 3 implementation) or RECOMMENDED (should resolve, won't block) |
| **Problem** | What's wrong, with a concrete failure scenario |
| **Specification** | The exact text, contract, or interface to add or change |
| **Invariant alignment** | Which INVs this amendment protects |
| **Phase impact** | What breaks in Phase 2 or 3 if this isn't addressed |

Amendments marked BLOCKING mean: if the PM begins writing interface specifications against the current doc text, the resulting interfaces will be wrong or incomplete. These must be resolved in Phase 1 (design docs) before Phase 2 begins.

---

## 1. BLOCKING Amendments — Cross-Document Boundary Contracts

These amendments address gaps at subsystem boundaries where two or more design documents each assume the other specifies the contract. These are the highest-risk items because they will produce contradictory interface specifications in Phase 2 if left unresolved.

---

### AMD-01: EventPublisher.publish() Durability Contract

**Affected docs:** Doc 01 (Event Model & Event Bus), Doc 03 (State Store & State Projection)
**Section(s):** Doc 01 §8.3 (EventPublisher API), Doc 03 §3.2 (state event lifecycle)
**Classification:** BLOCKING

**Problem:**

The State Projection derives `state_changed` events from `state_reported` events and publishes them via `EventPublisher.publish()`. Whether `publish()` blocks until the event is durably persisted is never stated in either document. Doc 01 §8.3 defines the two-method API (`publish` for business events, `emit` for telemetry) but specifies only the routing semantics, not the durability semantics.

*Failure scenario:* The State Projection receives a `state_reported` event, derives a `state_changed` event, calls `publish()`, which returns. The process crashes before the derived event reaches SQLite. On restart, REPLAY replays the original `state_reported` but the projection is in REPLAY mode — it consumes existing events but does not re-derive. The `state_changed` event is permanently lost. Current state for that entity is stale until the device reports again (30–300 seconds for most Zigbee devices).

This violates INV-ES-02 (state is always derivable from events) and INV-ES-04 (write-ahead persistence).

**Specification — add to Doc 01 §8.3:**

```
### 8.3.1 Durability Semantics

EventPublisher.publish(event) is a SYNCHRONOUS, DURABLE operation.
The method returns only after the event has been:
  1. Assigned a global_position in the append-only log
  2. Written to the SQLite WAL (per LTD-03 synchronous=NORMAL,
     this means the WAL page is in the OS page cache; fsync is
     not required per-event but occurs at WAL checkpoint intervals)
  3. Visible to subsequent EventStore queries

If publish() returns normally, the event survives a process crash
(it will be replayed on restart). If publish() throws, the event
was NOT persisted and the caller must handle the failure.

EventPublisher.emit(telemetryEvent) is ASYNCHRONOUS and BEST-EFFORT.
Telemetry events are buffered and batched. Loss of telemetry events
during a crash is an accepted trade-off (they are DIAGNOSTIC tier
per Doc 01 §3.3 and are not inputs to state derivation or automation
evaluation).

The durability contract is:
  - publish() → durable before return → safe for state derivation
  - emit() → buffered, batched → acceptable loss on crash
```

**Specification — add to Doc 03 §3.2:**

```
The State Projection publishes derived state_changed events via
EventPublisher.publish() (not emit()). Because publish() is
synchronous and durable (Doc 01 §8.3.1), the derived event is
guaranteed to survive a crash that occurs after the publish() call
returns. This means:

  - If the process crashes BEFORE publish() returns: the derived
    event is lost, but the source state_reported event is still in
    the log. The REPLAY→LIVE reconciliation pass (§3.2.1) detects
    this and re-derives the missing event.
  - If the process crashes AFTER publish() returns: both events
    are durable. No data loss.
```

**Invariant alignment:** INV-ES-02, INV-ES-04, INV-RF-04
**Phase impact:** Without this, the PM cannot write the `EventPublisher` interface spec. The `publish()` method signature needs a checked exception for persistence failure, and the return type must communicate the assigned `global_position`. Every subscriber of derived events inherits this ambiguity.

---

### AMD-02: REPLAY→LIVE Reconciliation Pass

**Affected docs:** Doc 03 (State Store & State Projection)
**Section(s):** Doc 03 §3.2 (state event lifecycle), new §3.2.1
**Classification:** BLOCKING

**Problem:**

Doc 03 acknowledges that if the process crashes after `state_reported` is persisted but before `state_changed` is derived and persisted, the derived event is lost. The doc calls this an "accepted trade-off." It is not an acceptable trade-off — it violates INV-ES-02 (state derivable from events) and means the current state for that entity will be stale until the device reports again. For devices with long reporting intervals (temperature sensors at 5 minutes, energy meters at 15 minutes), the system shows incorrect state for a meaningful duration.

The fix is cheap: a reconciliation pass at the REPLAY→LIVE transition point.

**Specification — add new §3.2.1 to Doc 03:**

```
### 3.2.1 REPLAY→LIVE Reconciliation

When the State Projection completes REPLAY and transitions to LIVE
mode, it executes a single reconciliation pass before accepting new
events:

1. For each entity in the state map, identify the most recent
   state_reported event in the event log (by per-entity sequence).
2. Check whether a corresponding state_changed event exists with
   a causation_id pointing to that state_reported event.
3. If the state_changed event is MISSING: re-derive it by applying
   the projection logic to the state_reported event and publishing
   via EventPublisher.publish().
4. If the state_changed event EXISTS: no action needed.

This pass runs once per startup. On a system with 200 entities, it
requires at most 200 event log lookups (indexed by entity_ref +
event_type, covered by the existing entity_stream index). Expected
duration: < 50 ms on Pi 5 with NVMe.

The reconciliation pass is observable: it emits a
system.reconciliation_completed event containing:
  - entities_checked: int
  - events_re_derived: int
  - duration_ms: long

If events_re_derived > 0, a WARNING-level structured log is emitted
identifying the affected entities, indicating a prior unclean shutdown
interrupted state derivation.
```

**Invariant alignment:** INV-ES-02, INV-ES-06
**Phase impact:** Without this, every entity in the system has a window where state can silently become stale after a crash. The Automation Engine (Doc 07) evaluates conditions against current state — stale state produces incorrect automation decisions. The reconciliation pass is a one-time O(N) operation at startup; its absence creates ongoing correctness risk.

---

### AMD-03: Atomic Multi-Entity State Snapshot for Automation Evaluation

**Affected docs:** Doc 03 (State Store), Doc 07 (Automation Engine)
**Section(s):** Doc 03 §8.1 (StateQueryService API), Doc 07 §3.x (condition evaluation)
**Classification:** BLOCKING
**Traceability note (DECIDE-03, 2026-03-20):** Code uses `ConsistentSnapshot` and `getStatesAtPosition` (as specified in the code block below). The name `ConsistentSnapshot` is accepted as canonical — it more precisely describes the consistency guarantee that is this amendment's purpose. `StateSnapshot` is NOT used because that name collides with an existing type in state-store with a different purpose.

**Problem:**

The State Store provides `getStates(Set<EntityRef>)` which reads each entity independently from a `ConcurrentHashMap`. Between reads, the projection can advance — meaning an automation evaluating a multi-entity condition (e.g., "motion_sensor is DETECTED AND ambient_light is DARK AND home_mode is HOME") can read a temporally inconsistent snapshot. Entity A's state might reflect event at position 1000, while entity B's reflects position 1005.

This is the #1 source of automation bugs in Home Assistant. Their `hass.states.get()` has the same race condition, and it's been a known issue for years.

For HomeSynapse, this is worse because the system claims deterministic automation execution (INV-TO-02). Non-deterministic condition evaluation directly contradicts this invariant.

*Failure scenario:* Automation: "If motion detected AND lights are off, turn on lights." Motion event arrives at position 1000. The automation engine reads motion_sensor → DETECTED (from position 1000). Between that read and the next, a separate automation processes the same motion event and turns the lights on, updating light state at position 1001. The condition engine reads light_state → ON (from position 1001). Condition evaluates false. The automation doesn't fire — but it should have, because at the moment of the triggering event, lights WERE off.

**Specification — add to Doc 03 §8.1:**

```
### 8.1.1 Consistent Multi-Entity Snapshot

StateQueryService provides two read modes:

1. CURRENT (default for dashboards, REST API):
   getState(EntityRef) → EntityState
   getStates(Set<EntityRef>) → Map<EntityRef, EntityState>

   These return the latest projected state. Reads are NOT
   guaranteed consistent across entities. Suitable for display
   and non-critical queries.

2. POSITIONAL (required for automation condition evaluation):
   getStatesAtPosition(Set<EntityRef>, long maxPosition)
       → ConsistentSnapshot

   Returns entity states as they existed at or before the given
   global_position. The snapshot is consistent: all returned states
   reflect the event log up to (and no further than) maxPosition.

   ConsistentSnapshot is a record:
     record ConsistentSnapshot(
         long position,
         Map<EntityRef, EntityState> states,
         Instant snapshotTime
     )

   Implementation: The state projection maintains a versioned state
   map where each entity state is tagged with the global_position of
   the event that produced it. getStatesAtPosition reads only states
   whose position ≤ maxPosition. If an entity has no state at or
   before maxPosition (it was created later), it is absent from the
   map — the caller handles this as "entity does not exist at this
   point in time."

   Performance: This requires storing the position tag alongside
   each entity state in the ConcurrentHashMap. The position tag is
   a single long (8 bytes per entity). For 200 entities, overhead
   is 1.6 KB. The read operation is still O(N) in the number of
   requested entities with no locking — it reads each entity's
   state and position atomically (the state + position are stored
   in an immutable record that is atomically swapped on update).
```

**Specification — add to Doc 07 condition evaluation section:**

```
When the Automation Engine evaluates conditions for a triggered
automation, it MUST use StateQueryService.getStatesAtPosition()
with the global_position of the triggering event. This ensures
all condition reads reflect the world as it existed at the moment
the trigger fired, not the world as it exists when the condition
evaluation executes (which may be milliseconds later, after other
events have been processed).

The triggering event's global_position is carried in the
AutomationRun context and passed to every condition evaluator.
```

**Invariant alignment:** INV-TO-02 (deterministic execution), INV-ES-06 (explainability)
**Phase impact:** If the PM writes condition evaluation interfaces against the current `getStates()` API, every automation will have latent race conditions. The positional read must be in the `StateQueryService` interface from day one — retrofitting it requires changing every condition evaluator.

---

### AMD-04: Automation Cascade Detection and Depth Limiting

**Affected docs:** Doc 07 (Automation Engine), Doc 01 (Event Model)
**Section(s):** Doc 07 new §3.x (cascade handling), Doc 01 §4.4 (causal chain)
**Classification:** BLOCKING

**Problem:**

When Automation A fires and emits an event that triggers Automation B, which emits an event that triggers Automation C (or back to A), there is no loop detection, no depth limit, and no cascade storm protection. The causal chain metadata (Doc 01 §4.4) tracks causation_id but nobody enforces a maximum chain depth.

*Failure scenario:* User creates two automations: (1) "When living room light turns ON, turn on hallway light" and (2) "When hallway light turns ON, turn on living room light." The living room light is turned on. Automation 1 fires, turning on hallway. Automation 2 fires, turning on living room. But wait — the living room was already on. Does the `state_changed` event fire again? If the state projection correctly de-duplicates (same state → no event), the cascade stops. But if the command produces a new `command_issued` → `command_acknowledged` event chain regardless of whether the state actually changed, the cascade is infinite.

Even without true infinite loops, cascade depth of 10+ automations creates event storms that can overwhelm the Event Bus on constrained hardware.

**Specification — add new section to Doc 07:**

```
### Automation Cascade Governance

#### Cascade Depth Limit

Every AutomationRun carries a cascade_depth counter, initialized
to 0 for user-triggered or device-triggered automations. When an
automation's action produces an event that triggers another
automation, the child AutomationRun inherits cascade_depth + 1.

Maximum cascade depth: 8 (configurable via
automation_engine.max_cascade_depth, default 8, minimum 1,
maximum 32).

When cascade_depth exceeds the limit:
  1. The automation is NOT triggered.
  2. A cascade_depth_exceeded event is emitted (DIAGNOSTIC tier)
     containing: automation_id, triggering_event_id,
     cascade_depth, root_automation_id (from causal chain).
  3. A WARNING structured log is emitted.
  4. The health indicator for the Automation Engine reports
     DEGRADED if cascade limit is hit more than 3 times in
     60 seconds.

#### Duplicate Suppression Within Cascade

Within a single causal chain (identified by the root
correlation_id), an automation will not fire more than once.
If Automation A is already represented in the causal chain
of the current event, triggering Automation A again is
suppressed with a cascade_loop_detected event.

#### Cascade Rate Limiting

The Automation Engine enforces a global cascade rate limit:
no more than 50 cascade-triggered automation runs per second
(configurable via automation_engine.max_cascade_rate_per_sec).
Excess cascades are queued with a bounded queue of 100 entries;
if the queue is full, excess cascades are dropped with a
cascade_rate_exceeded event.
```

**Specification — add to Doc 01 §4.4:**

```
The causal chain projection tracks cascade_depth as a derived
field: cascade_depth = count of distinct automation_run events
in the chain from root to current node. This field is included
in the CausalChain record returned by the trace query service.
```

**Invariant alignment:** INV-RF-01 (integration isolation — an automation storm shouldn't crash the core), INV-PR-03 (bounded resource usage)
**Phase impact:** Without cascade governance, the first user who creates a circular automation pair will crash their system. The Automation Engine interface spec must include `cascade_depth` in the `AutomationRun` context from day one.

---

### AMD-05: Consolidated Write Endurance Budget

**Affected docs:** Doc 04 (Persistence Layer), new cross-cutting appendix
**Section(s):** Doc 04 new §X (write endurance analysis)
**Classification:** BLOCKING

**Problem:**

HomeSynapse's #1 competitive claim against Home Assistant is "we won't kill your hardware." The system is event-sourced, meaning it writes constantly — events, WAL flushes, checkpoints, retention deletes, vacuum passes, backup copies, observability metrics. Despite this, there is no consolidated write budget analysis anywhere in the design documentation. Each subsystem specifies its own write patterns in isolation, but nobody has summed the total.

This matters because LTD-02 specifies NVMe as a production requirement and explicitly states "SD card storage is not supported for production" due to write endurance concerns. But even NVMe SSDs have write endurance limits (TBW — terabytes written). A cheap 256GB NVMe has ~150 TBW. We need to know if HomeSynapse's write patterns stay within that budget over the expected hardware lifetime (5+ years).

**Specification — add new section to Doc 04:**

```
### Write Endurance Analysis

This section consolidates write volume estimates across all
subsystems for the reference deployment: 50 Zigbee devices,
6 automations, on Pi 5 with NVMe SSD.

#### Per-Subsystem Daily Write Estimates

| Source | Events/day | Avg bytes/event | Daily writes |
|---|---|---|---|
| Device state_reported | 50 devices × 4 reports/hr × 24h = 4,800 | 512 B | 2.4 MB |
| Derived state_changed | ~3,600 (75% produce changes) | 384 B | 1.4 MB |
| Automation run events | 6 automations × 10 fires/day × 5 events/run = 300 | 640 B | 0.2 MB |
| Command events | ~200 commands/day × 3 events/command = 600 | 448 B | 0.3 MB |
| Telemetry (energy) | 5 monitors × 4 samples/min × 1440 min = 28,800 | 256 B | 7.4 MB |
| System/health events | ~500/day | 320 B | 0.2 MB |
| **Subtotal: Event writes** | | | **~12 MB/day** |
| SQLite WAL overhead (2× write amplification) | | | 24 MB/day |
| WAL checkpoints (weekly TRUNCATE) | | | ~50 MB/week |
| Daily checkpoint snapshots | | | ~5 MB/day |
| Retention deletes + VACUUM | | | ~10 MB/week |
| Daily backup (compressed) | | | ~20 MB/day |
| JFR continuous recording | | | ~15 MB/day |
| **Total estimated daily writes** | | | **~75 MB/day** |
| **Annual writes** | | | **~27 GB/year** |
| **5-year writes** | | | **~135 GB** |

#### Endurance Assessment

A budget NVMe SSD (256 GB, 150 TBW rating):
  - 135 GB / 5 years = well within 150 TBW
  - Safety margin: > 1000× headroom

Even with 10× the estimated write volume (500 devices, heavy
telemetry, frequent automations), the 5-year write total of
~1.35 TB remains within the 150 TBW budget with > 100× margin.

SD card endurance (for comparison — NOT supported):
  - Consumer SD cards: 500–2,000 P/E cycles
  - At 75 MB/day with ~4KB erase blocks, SD card degradation
    would begin within 6–18 months depending on wear leveling
    quality. This confirms LTD-02's prohibition on SD cards.

#### Write Amplification Monitoring

The Persistence Layer MUST expose a daily_bytes_written metric
(Doc 11 §3.5) that tracks actual bytes written to the SQLite
database file and WAL. This metric enables:
  - Storage health dashboard in the Web UI
  - Early warning if write volume exceeds projections
  - Validation of the estimates in this section against
    production data

The metric is collected by reading /proc/diskstats or the
NVMe SMART write counter (via smartctl) once per hour.
```

**Invariant alignment:** INV-PR-01 (constrained hardware), INV-CS-07 (no forced hardware obsolescence)
**Phase impact:** Without this analysis, we cannot make credible claims about hardware longevity. The write monitoring metric must be included in the Persistence Layer interface spec (Phase 2) and the Observability subsystem interface spec.

---

### AMD-06: Single-Writer Contention Analysis Under Composite Load

**Affected docs:** Doc 04 (Persistence Layer), Doc 01 (Event Model)
**Section(s):** Doc 04 §3.x (concurrency model), Doc 01 §3.x (bus throughput)
**Classification:** BLOCKING

**Problem:**

SQLite's single-writer model means only one thread can write at a time (per LTD-03). During normal operation, writes are infrequent enough that contention is negligible. But during a device mesh recovery event (Zigbee coordinator restarts, 50+ devices re-report state simultaneously), write contention becomes the bottleneck:

- The EventPublisher writes 100+ events/sec to the event store
- The State Projection derives and writes state_changed events
- The retention thread attempts its periodic cleanup
- The WAL checkpoint thread attempts its periodic checkpoint
- The backup thread might be running its daily backup

Each writer competes for the same SQLite write lock. LTD-03 specifies `busy_timeout = 5000` (5 seconds), but under sustained high write load, the retention thread and checkpoint thread may never acquire the lock — they'll timeout and silently skip their work. Over time, this means the event store grows unboundedly during recovery windows.

No stress test validates the aggregate behavior of all writers competing simultaneously.

**Specification — add to Doc 04:**

```
### Concurrent Writer Governance

#### Writer Priority Model

All SQLite write operations are serialized through a single
WriteCoordinator that enforces priority ordering:

| Priority | Writer | Rationale |
|---|---|---|
| 1 (highest) | EventPublisher.publish() | Event durability is the core contract |
| 2 | State Projection (derived events) | State correctness depends on timely derivation |
| 3 | WAL checkpoint | Prevents unbounded WAL growth |
| 4 | Retention cleanup | Can be deferred without correctness impact |
| 5 (lowest) | Backup | Entirely deferrable |

The WriteCoordinator is a single-threaded executor with a
priority queue. Writers submit work items; the coordinator
executes them in priority order. This eliminates SQLite-level
contention entirely — there is never more than one concurrent
SQLite write attempt.

#### Burst Capacity

During event storms (> 50 events/sec sustained for > 10 seconds),
the WriteCoordinator:
  1. Pauses Priority 4–5 writers (retention, backup) entirely
  2. Allows Priority 3 (WAL checkpoint) only during natural gaps
     (when the event write queue is empty for > 100ms)
  3. Batches Priority 1–2 writes into transactions of up to
     100 events per commit (reducing per-event fsync overhead)

When the event rate drops below 50/sec for 5 consecutive seconds,
normal priority scheduling resumes.

#### Stress Test Requirement

Before Tier 1 acceptance, validate:
  - 100 events/sec sustained for 60 seconds with all writers active
  - Zero busy_timeout failures
  - Retention and backup resume within 30 seconds of storm subsiding
  - WAL size never exceeds 2× journal_size_limit during storm
  - Event write latency p99 < 10ms during storm
```

**Invariant alignment:** INV-PR-02 (quantitative performance targets), INV-RF-04 (crash safety)
**Phase impact:** The WriteCoordinator must be in the Persistence Layer interface spec. Without it, every subsystem that writes to SQLite will implement its own retry/backoff logic, creating inconsistent contention behavior.

---

## 2. BLOCKING Amendments — Single-Subsystem Critical Gaps

---

### AMD-07: Zigbee Mesh Route Health Monitoring

**Affected docs:** Doc 08 (Zigbee Adapter)
**Section(s):** Doc 08 §4.1 (mesh management), new §4.1.1
**Classification:** BLOCKING

**Problem:**

The #1 source of real-world Zigbee failures is devices stuck on dead routes. A device's routing table points to a relay node that has been unplugged, moved, or lost power. The device continues trying to reach the coordinator through the dead relay. Commands fail silently or with generic "delivery failed" errors. Users blame the platform.

zigbee2mqtt has this problem. ZHA has this problem. deCONZ has this problem. Every Zigbee platform has this problem because mesh healing is hard and the Zigbee specification doesn't mandate proactive route maintenance.

Doc 08 handles device interviews, attribute reporting, and command delivery, but has zero route health infrastructure.

**Specification — add new §4.1.1 to Doc 08:**

```
### 4.1.1 Route Health Monitoring

#### Passive Route Quality Tracking

The Zigbee Adapter maintains a route_health record per device:

  record RouteHealth(
      String deviceEui64,
      int consecutiveFailures,    // reset on successful delivery
      int totalFailures24h,       // rolling 24-hour window
      Instant lastSuccessfulDelivery,
      int lastLqi,                // Link Quality Indicator (0–255)
      int lastRssi,               // Received Signal Strength
      String lastRelayPath        // e.g., "coordinator → relay1 → device"
  )

Route health is updated on every command delivery attempt:
  - Success: reset consecutiveFailures, update LQI/RSSI/relay path
  - Failure: increment consecutiveFailures and totalFailures24h

#### Active Route Recovery

When consecutiveFailures reaches 3 for any device:
  1. Emit a device.route_degraded event (NORMAL tier) with the
     device EUI-64, failure count, and last known relay path.
  2. Request a route discovery for the device via the coordinator
     (send a ZDO Network Address Request or Route Record Request,
     forcing the mesh to recalculate the path).
  3. After route discovery completes, retry the failed command once.
  4. If the retry succeeds, emit device.route_recovered.
     If it fails, emit device.route_failed and mark the device
     as DEGRADED in the Integration Runtime health model.

When consecutiveFailures reaches 10:
  1. Emit device.unreachable event.
  2. The device's state in the State Store is annotated with
     reachability: UNREACHABLE and last_seen timestamp.
  3. The device remains in the registry (not removed) — it may
     come back when power is restored or mesh heals.

#### Periodic Mesh Health Scan

Every 6 hours (configurable: zigbee.mesh_health_scan_interval),
the adapter performs a passive mesh scan:
  1. For each router-capable device, request its neighbor table
     (ZDO Mgmt_Lqt_req).
  2. Build a mesh topology map: nodes, edges, LQI per edge.
  3. Identify devices with zero high-quality neighbors (LQI < 100
     on all links) — these are at risk of route failure.
  4. Emit mesh.topology_updated event with the full topology.
  5. If at-risk devices are found, emit mesh.weak_link_detected
     with device list.

The topology data feeds the Web UI's mesh visualization (Doc 13)
and the Observability subsystem's health reporting.

#### Performance Budget

- Passive tracking: O(1) per command, negligible memory
  (RouteHealth is ~100 bytes per device, 5 KB for 50 devices)
- Active recovery: at most 1 route discovery per device per
  5-minute window (rate limited to avoid flooding the mesh)
- Mesh scan: one scan takes ~2–5 seconds for 50 devices
  (sequential ZDO requests with 50ms spacing to avoid congestion)
```

**Invariant alignment:** INV-RF-01 (integration isolation — degraded mesh shouldn't cascade), INV-CE-05 (self-diagnosing system)
**Phase impact:** Route health is the difference between "Zigbee works in a demo" and "Zigbee works in production for months." The `RouteHealth` record and the health monitoring contract must be in the Zigbee Adapter interface spec.

---

### AMD-08: REST API Idempotency Keys for Command Endpoints

**Affected docs:** Doc 09 (REST API)
**Section(s):** Doc 09 §3.x (command endpoints), §4 (serialization)
**Classification:** BLOCKING

**Problem:**

When a client sends a command via `POST /api/devices/{id}/commands` and loses the HTTP response (network timeout, client crash), retrying the request produces a new `command_issued` event with a new `command_id`. The device executes the command twice. For most devices (lights, sensors), this is harmless. For locks, garage doors, and thermostats, it's a safety issue — the user intended one toggle but got two, which returns the device to its original state.

No other smart home platform solves this well, but HomeSynapse's event-sourced architecture makes it trivially solvable.

**Specification — add to Doc 09 command endpoints:**

```
### Command Idempotency

All command endpoints accept an optional Idempotency-Key header:

  POST /api/devices/{id}/commands
  Idempotency-Key: {client-generated-ULID-or-UUID}

Behavior:
  - If the Idempotency-Key has not been seen before: process the
    command normally, store the key → command_id mapping.
  - If the Idempotency-Key has been seen before: return the
    original response (same HTTP status, same command_id, same
    body). Do NOT issue a new command.
  - Key retention: idempotency keys are retained for 24 hours,
    then expired. A key used after expiration is treated as new.

Storage: idempotency keys are stored in a lightweight in-memory
map (ConcurrentHashMap<String, IdempotencyEntry>) with a
scheduled cleanup task. Maximum 10,000 entries (configurable).
If the map is full, the oldest entry is evicted (LRU).

  record IdempotencyEntry(
      String idempotencyKey,
      String commandId,
      int httpStatus,
      String responseBody,
      Instant createdAt
  )

The Idempotency-Key header is OPTIONAL. Clients that don't
send it get the current behavior (every request produces a
new command). Clients that need exactly-once semantics
(lock controllers, garage door controllers) SHOULD always
send idempotency keys.

The idempotency key is included in the command_issued event
envelope as an optional field: idempotency_key. This enables
forensic analysis of duplicate command attempts.
```

**Invariant alignment:** INV-ES-06 (explainability — can trace duplicate attempts), INV-RF-03 (graceful degradation)
**Phase impact:** The REST API interface spec must include `Idempotency-Key` in the command endpoint contract. Retrofitting idempotency after the API is published is a breaking change.

---

### AMD-09: WebSocket Rate Limiting and Reconnection Governance

**Affected docs:** Doc 10 (WebSocket API)
**Section(s):** Doc 10 §3.5 (authentication), §3.8 (reconnection), new §3.x
**Classification:** BLOCKING

**Problem:**

Two related issues: (1) No per-client message rate limiting — a malicious or buggy client on the local network can spam subscribe/unsubscribe messages and consume all server resources. (2) When the server restarts, all WebSocket clients reconnect simultaneously, each requesting replay from their last checkpoint — creating a "thundering herd" that can overwhelm SQLite reads and CPU on constrained hardware.

**Specification — add new section to Doc 10:**

```
### Client Rate Limiting

Each WebSocket connection is subject to rate limits:

| Message type | Limit | Window | Exceeded behavior |
|---|---|---|---|
| subscribe | 20 | per 10 sec | error frame + 5 sec cooldown |
| unsubscribe | 20 | per 10 sec | error frame + 5 sec cooldown |
| command | 10 | per second | error frame, command dropped |
| ping | 2 | per second | silently dropped |
| Any message | 100 | per second | connection terminated |

Rate limit state is per-connection, not per-API-key (a single
API key may have multiple connections; each is independently
rate-limited).

When a connection exceeds the "Any message" limit 3 times within
60 seconds, the server bans the connection's IP for 5 minutes
(configurable: websocket.ban_duration_sec).

### Reconnection Admission Control

After server restart, client reconnections are admitted with
staggered replay:

1. The server accepts all reconnections immediately (no
   connection delay — clients should not show "disconnected"
   longer than necessary).
2. Authentication is processed immediately for all clients.
3. Replay requests are queued and served sequentially, not
   in parallel. Each client's replay is fully served before
   the next client's replay begins.
4. During replay queueing, the client receives a
   replay_queued frame:
   {
     "type": "replay_queued",
     "position_in_queue": 3,
     "estimated_wait_ms": 1500
   }
5. While queued, the client receives LIVE events normally
   (they may have gaps relative to replay, but they see
   current activity). When replay completes, the gap is
   filled.

Maximum concurrent replay streams: 1 (configurable:
websocket.max_concurrent_replays, default 1, maximum 4).

This ensures that replay I/O does not compete with LIVE
event delivery or with the State Store's own startup replay.
```

**Invariant alignment:** INV-PR-03 (bounded resource usage), INV-RF-01 (isolation)
**Phase impact:** Rate limiting and admission control must be in the WebSocket API interface spec. Without them, the first multi-client deployment will exhibit thundering herd failures on every server restart.

---

### AMD-10: Projection Logic Versioning in State Store Checkpoints

**Affected docs:** Doc 03 (State Store & State Projection)
**Section(s):** Doc 03 §X (checkpoint schema)
**Classification:** BLOCKING

**Problem:**

The checkpoint schema has a `schema_version` for data format changes, but no `projection_version` for logic changes. If the rules for deriving `state_changed` from `state_reported` change in a software update (e.g., a new normalization rule, a changed threshold, a bugfix in derivation logic), old checkpoints will be loaded and replay will apply old logic to old events but new logic to new events — creating a temporal discontinuity in derived state.

This is subtle and dangerous: the system appears to work, but entities whose state was derived before the update have different derivation logic applied than entities derived after. Automation conditions may evaluate differently depending on when an entity was last updated.

**Specification — add to Doc 03 checkpoint schema:**

```
### Checkpoint Projection Versioning

Each checkpoint includes a projection_version field alongside
schema_version:

  record Checkpoint(
      long globalPosition,
      int schemaVersion,       // data format version
      int projectionVersion,   // derivation logic version
      Instant timestamp,
      Map<EntityRef, EntityState> stateMap
  )

projection_version is a monotonically increasing integer,
incremented whenever the derivation logic in the State Projection
changes in a way that would produce different output for the
same input event.

On startup, after loading a checkpoint:
  1. Compare checkpoint.projectionVersion to the running
     code's CURRENT_PROJECTION_VERSION constant.
  2. If they MATCH: proceed with normal replay from the
     checkpoint's globalPosition.
  3. If they DIFFER: discard the checkpoint's stateMap and
     replay from the most recent checkpoint whose
     projectionVersion matches, or from position 0 if no
     matching checkpoint exists.

This ensures that every entity state in memory was derived
by the currently running projection logic, eliminating
temporal discontinuities.

Performance note: a full replay from position 0 on a system
with 6 months of data (~1.7M events at 50 devices) takes
~30–60 seconds on Pi 5 (events are sequential reads from
SQLite, which are I/O-bound at ~50,000 reads/sec on NVMe).
This is acceptable for a major version upgrade that changes
projection logic, which should be infrequent.
```

**Invariant alignment:** INV-ES-02 (state derivable from events — projection version ensures correct derivation), INV-TO-02 (determinism)
**Phase impact:** The `Checkpoint` record in the interface spec must include `projectionVersion` from day one. Adding it later requires a checkpoint migration.

---

## 3. REQUIRED Amendments — Must Resolve Before Phase 3

These amendments don't affect interface specifications but will cause implementation pain or production failures if not addressed before code is written.

---

### AMD-11: State TTL for Ephemeral Sensors

**Affected docs:** Doc 03 (State Store)
**Section(s):** Doc 03 §3.x (state lifecycle)
**Classification:** REQUIRED

**Problem:**

Motion sensors, occupancy sensors, doorbells, and other ephemeral devices produce states that should auto-expire. A motion sensor whose battery dies will show "DETECTED" indefinitely in the State Store. The dashboard shows phantom motion. Automations that check "motion is NOT detected" never fire because the stale state is "DETECTED."

Home Assistant has `STATE_UNAVAILABLE` for devices that stop communicating, but the timeout is configured per-integration with inconsistent behavior. HomeSynapse should do better.

**Specification — add to Doc 03:**

```
### State Freshness and TTL

Entity states carry a freshness model:

  record EntityState(
      EntityRef entityRef,
      Map<String, Object> attributes,
      long sourceEventPosition,
      Instant lastUpdated,
      Instant staleAfter,        // nullable — null means "never stale"
      boolean stale              // derived: Instant.now().isAfter(staleAfter)
  )

staleAfter is set by the State Projection based on the entity's
capability type:
  - Motion sensors: lastUpdated + 5 minutes (configurable per-device)
  - Occupancy sensors: lastUpdated + 10 minutes
  - Contact sensors: null (door open/closed is persistent)
  - Temperature sensors: lastUpdated + 30 minutes
  - Light state: null (commanded state is persistent)
  - Energy meters: lastUpdated + 5 minutes

When stale becomes true:
  1. The entity state remains in the map (it is NOT deleted).
  2. A state_stale event is emitted (NORMAL tier) with entity_ref
     and last_updated timestamp.
  3. The REST API and WebSocket API include stale: true in the
     entity state response.
  4. Automation conditions can check entity.stale as a boolean
     condition.
  5. The dashboard renders stale entities with a visual indicator
     (grayed out, clock icon, "last seen X minutes ago").

When the device reports again, stale is cleared and staleAfter
is recalculated from the new lastUpdated.

The staleness check is passive — a scheduled task runs every
30 seconds, iterating the state map and emitting state_stale
events for newly-stale entities. On a system with 200 entities,
this takes < 1ms.
```

**Invariant alignment:** INV-ES-06 (explainability — stale state is visible and explained), INV-CE-05 (self-diagnosing)
**Phase impact:** The `EntityState` record must include `staleAfter` and `stale` fields. Automation condition evaluators must be aware of staleness. The Web UI must render it. If deferred to post-MVP, every downstream consumer must be retrofitted.

---

### AMD-12: API Key Permission Scoping

**Affected docs:** Doc 09 (REST API), Doc 10 (WebSocket API)
**Section(s):** Doc 09 §12 (security), Doc 10 §3.5 (authentication)
**Classification:** REQUIRED

**Problem:**

All API keys are equivalent — full read/write access to every entity, command, event, and system endpoint. A user who gives an API key to a weather integration also gives that integration the ability to unlock their front door, reconfigure the system, or delete events.

For Tier 1 with only the built-in Web UI, this is tolerable. But the moment any external client or third-party integration uses the API (which is the entire point of having an API), the lack of scoping is a security liability.

**Specification — add to Doc 09 §12:**

```
### API Key Permission Model

Each API key has an associated permission scope:

  record ApiKeyPermissions(
      Set<Permission> grants
  )

  enum Permission {
      DEVICE_READ,       // read device state, attributes, history
      DEVICE_COMMAND,    // issue commands to devices
      EVENT_READ,        // read event log, subscribe to events
      AUTOMATION_READ,   // read automation definitions and run history
      AUTOMATION_MANAGE, // create, update, delete automations
      SYSTEM_READ,       // read health, metrics, configuration
      SYSTEM_MANAGE,     // modify configuration, manage integrations
      ADMIN              // all permissions (master key)
  }

Key creation:
  POST /api/keys
  {
    "name": "weather-integration",
    "permissions": ["DEVICE_READ", "EVENT_READ"]
  }

Permission enforcement:
  - Every REST endpoint declares its required permission.
  - Every WebSocket message type declares its required permission.
  - Requests with insufficient permissions receive 403 Forbidden.
  - The ADMIN permission grants all other permissions implicitly.

The default key created during initial setup has ADMIN permission.
The system warns (via health indicator) if there is only one key
and it has ADMIN permission.

Migration: existing keys (created before this feature) are
grandfathered as ADMIN. The system emits a one-time advisory
event recommending permission scoping.

Performance: permission checking is an O(1) set lookup cached
per-connection. Zero overhead in the hot path.
```

**Invariant alignment:** INV-SE-01 (security by default), INV-LF-02 (cloud enhancement boundary — scoped keys enable safe third-party access)
**Phase impact:** The API key model in the interface spec must include permission scoping. Adding it after the API is published requires either a breaking change or a complex migration.

---

### AMD-13: Configuration Migration Framework Design

**Affected docs:** Doc 06 (Configuration System)
**Section(s):** Doc 06 §8.1 (ConfigMigrator interface), move from §14 to main body
**Classification:** REQUIRED

**Problem:**

Configuration migration is completely deferred to "future considerations" (§14). The `ConfigMigrator` interface is mentioned in §8.1 but has no method signatures, no semantics, and no migration descriptor schema. When the configuration schema changes between versions — which it will, since many of these amendments add new configuration keys — users with existing config files will face unguided breakage.

This doesn't need to be fully implemented for Tier 1, but the interface must be designed now so that the Configuration System's internal model accommodates migration from day one.

**Specification — add to Doc 06 as new §5:**

```
### 5. Configuration Migration

#### 5.1 Migration Interface

  interface ConfigMigrator {
      /**
       * Returns the range of schema versions this migrator handles.
       * from_version is inclusive, to_version is exclusive.
       */
      int fromVersion();
      int toVersion();

      /**
       * Analyze the old config and produce a preview of changes
       * without modifying anything.
       */
      MigrationPreview preview(ConfigModel oldConfig);

      /**
       * Apply the migration, producing a new ConfigModel.
       * The old config file is NOT modified — the caller writes
       * the result after user confirmation.
       */
      ConfigModel apply(ConfigModel oldConfig);
  }

  record MigrationPreview(
      int fromVersion,
      int toVersion,
      List<ConfigChange> changes,
      List<String> warnings
  )

  record ConfigChange(
      String path,          // e.g., "persistence.retention.normal_days"
      ChangeType type,      // ADDED, REMOVED, RENAMED, TYPE_CHANGED, VALUE_CHANGED
      Object oldValue,      // null for ADDED
      Object newValue,      // null for REMOVED
      String description    // human-readable explanation
  )

#### 5.2 Migration Execution Flow

  1. On startup, compare config file's schema_version to
     CURRENT_SCHEMA_VERSION.
  2. If versions match: proceed normally.
  3. If config version < current version:
     a. Look up the chain of ConfigMigrators that cover the gap
        (e.g., v1→v2, v2→v3 for a v1→v3 upgrade).
     b. If any link in the chain is missing: FATAL startup error
        with message "No migration path from version X to Y.
        Please run homesynapse migrate-config manually."
     c. If interactive (CLI): show preview, ask for confirmation.
     d. If non-interactive (service startup): apply automatically
        if all changes are non-destructive (ADDED, VALUE_CHANGED).
        If any change is REMOVED or TYPE_CHANGED, refuse and
        require manual migration via CLI.
  4. Before applying any migration: create a timestamped backup
     (config.yaml.backup.vX.{ISO8601}).

#### 5.3 Migration Testing Contract

Every ConfigMigrator must be accompanied by a test that:
  - Loads a fixture config at fromVersion
  - Applies the migration
  - Validates the result against toVersion's schema
  - Verifies that no existing configuration values are silently
    lost (every removed key must appear in the preview)
```

**Invariant alignment:** INV-CE-03 (safe updates), INV-CE-06 (migration tooling)
**Phase impact:** The `ConfigMigrator` interface and the `MigrationPreview`/`ConfigChange` records must be in the Phase 2 interface spec. Even if no migrations exist for Tier 1, the infrastructure must be present so that Tier 2 schema changes don't require a retrofit.

---

### AMD-14: Integration Runtime Adapter Dependency Ordering

**Affected docs:** Doc 05 (Integration Runtime)
**Section(s):** Doc 05 §3.3 (startup order)
**Classification:** REQUIRED

**Problem:**

Doc 05 §3.3 states "Shutdown order is the reverse of startup order... bridge adapters stop after their dependents." But there is no mechanism for an adapter to declare dependencies on other adapters. The startup sequence is discovery order (which is filesystem scan order — non-deterministic). A Matter-over-Thread adapter that depends on the Thread Border Router adapter will fail intermittently depending on which adapter is discovered first.

**Specification — add to Doc 05:**

```
### Adapter Dependency Declaration

IntegrationDescriptor includes an optional dependency declaration:

  record IntegrationDescriptor(
      String type,
      String displayName,
      SemanticVersion version,
      Set<String> dependsOn,  // NEW: set of integration type names
      ...existing fields...
  )

dependsOn semantics:
  - An adapter with dependsOn = {"thread-border-router"} will not
    begin its INITIALIZING phase until the thread-border-router
    adapter reaches RUNNING state.
  - If a dependency fails to reach RUNNING (transitions to FAILED),
    all adapters that depend on it transition to SUSPENDED with
    reason: "dependency_failed: {type}".
  - Circular dependencies are detected at DISCOVERED phase and
    produce a FATAL startup error.

Startup sequence becomes:
  1. DISCOVERED: all factories enumerated (unchanged).
  2. Dependency graph validated (topological sort, cycle detection).
  3. LOADING: adapters with no dependencies start first.
  4. INITIALIZING: each adapter starts only when all its
     dependencies are RUNNING.
  5. Adapters with no dependencies and adapters whose dependencies
     are satisfied proceed in parallel.

Shutdown sequence is the reverse: dependents stop before their
dependencies.

For Tier 1, only the Zigbee adapter exists, so dependsOn is
empty. This amendment ensures the infrastructure is in place for
Tier 2 (Matter, Z-Wave, bridges).
```

**Invariant alignment:** INV-RF-01 (integration isolation), INV-CS-04 (integration API stability)
**Phase impact:** The `IntegrationDescriptor` record in the interface spec must include `dependsOn`. Adding it later requires changing every existing adapter's descriptor.

---

### AMD-15: Correlation ID in REST API Error Responses

**Affected docs:** Doc 09 (REST API)
**Section(s):** Doc 09 §4 (error responses)
**Classification:** REQUIRED

**Problem:**

Server errors include correlation IDs in structured logs (Doc 11) but not in HTTP responses. When a user reports "I got a 500 error," the developer must search logs by timestamp — which is imprecise and may match multiple requests. A correlation ID in the response enables exact log correlation.

**Specification — add to Doc 09 §4:**

```
### Error Response Envelope

All error responses (4xx, 5xx) include a correlation_id:

  {
    "error": {
      "status": 500,
      "code": "INTERNAL_ERROR",
      "message": "An unexpected error occurred.",
      "correlation_id": "01HXYZ...",  // ULID
      "timestamp": "2026-03-09T14:30:00Z"
    }
  }

The correlation_id matches the correlation_id in the
corresponding structured log entries and JFR events.
The developer can search logs with:
  correlation_id=01HXYZ...

Successful responses (2xx) include the correlation_id in
an X-Correlation-ID response header (not in the body, to
avoid payload bloat for normal operations).

For WebSocket connections, the correlation_id is included
in error frames.
```

**Invariant alignment:** INV-ES-06 (explainability), INV-CE-05 (self-diagnosing)
**Phase impact:** Small change, but must be in the REST API interface spec. Adding it after the API is published requires clients to update their error handling.

---

### AMD-16: Secrets Store Automatic Backup

**Affected docs:** Doc 06 (Configuration System)
**Section(s):** Doc 06 §6.9 (secrets store corruption), §12.1 (encryption)
**Classification:** REQUIRED

**Problem:**

If the secrets store (`secrets.enc`) becomes corrupted or the encryption key (`.secret-key`) is lost, all secrets are irrecoverable. The current design says backup is "the user's responsibility." For a system targeting non-developer users, this is insufficient. A user with 15+ API keys for various integrations faces hours of reconfiguration.

**Specification — add to Doc 06 §12:**

```
### 12.1a Secrets Store Backup

Before every secrets set or secrets delete operation, the
Configuration System creates an atomic backup:

  secrets.enc → secrets.enc.backup.{ISO8601}

Maximum 5 backups retained (configurable:
config_system.secrets_backup_count). Oldest backup is deleted
when the limit is reached.

The .secret-key file is included in the daily system backup
(Doc 04 §X) but is NOT backed up per-operation (to avoid
key file proliferation).

Recovery CLI:
  homesynapse secrets restore-backup [path]

If path is omitted, lists available backups with timestamps
and lets the user select one.

If .secret-key is lost but a system backup containing it
exists, the recovery process is:
  1. Restore .secret-key from system backup
  2. Verify: homesynapse secrets list (should show all keys)
  3. If verification fails, the key doesn't match — user must
     recreate secrets manually.
```

**Invariant alignment:** INV-CE-03 (safe updates — secrets should survive failures)
**Phase impact:** The `SecretStore` interface must include backup operations. Without this, the first user who loses their key file learns the hard way.

---

### AMD-17: Device Orphan Lifecycle on Integration Removal

**Affected docs:** Doc 02 (Device Model & Capability System)
**Section(s):** Doc 02 §3.x (device lifecycle)
**Classification:** REQUIRED

**Problem:**

When an integration is removed (or permanently fails), its devices remain in the device registry with no special lifecycle state. The dashboard shows devices that can never respond to commands. Automations referencing those devices fail silently.

**Specification — add to Doc 02 device lifecycle:**

```
### Device Orphan Handling

When an integration transitions to FAILED (unrecoverable) or
is explicitly removed:

1. All devices owned by that integration transition to
   lifecycle state ORPHANED.

2. ORPHANED semantics:
   - Device remains in the registry (preserving history and
     automation references).
   - State is frozen at last known values with stale: true.
   - Commands to ORPHANED devices return immediately with
     error: "device_orphaned" (no attempt to deliver).
   - Automations referencing ORPHANED devices in conditions
     evaluate the condition as UNKNOWN (not true, not false) —
     the automation logs a warning but does not fire.
   - The dashboard renders ORPHANED devices with a distinct
     visual indicator and an explanation: "This device's
     integration ({type}) is no longer available."

3. Re-adoption: if the integration is restored (reinstalled,
   repaired), the Integration Runtime attempts to match
   ORPHANED devices by physical_id. Matched devices transition
   from ORPHANED to RUNNING. Unmatched devices remain ORPHANED.

4. Explicit removal: a user can delete an ORPHANED device via
   the REST API. Deletion emits a device_removed event and
   removes the device from the registry. Automations referencing
   the deleted device are flagged with a validation warning
   (not auto-deleted — the user may want to update the
   automation rather than lose it).
```

**Invariant alignment:** INV-RF-01 (integration isolation — one integration's removal shouldn't break unrelated automations), INV-ES-06 (explainability)
**Phase impact:** The `DeviceLifecycleState` enum must include `ORPHANED`. The Automation Engine condition evaluator must handle `UNKNOWN` results. Without this, integration removal creates cascading phantom failures.

---

## 4. RECOMMENDED Amendments — Should Resolve, Won't Block

---

### AMD-18: Causal Chain Timeout Extension for Long-Running Automations

**Affected docs:** Doc 01 (Event Model)
**Section(s):** Doc 01 §4.4 (causal chain projection)
**Classification:** RECOMMENDED

**Problem:**

The causal chain projection tracks up to 10,000 active chains with a 5-minute timeout. Long-running automations that include delays (e.g., "wait 10 minutes, then turn off lights") will have their causal chains evicted before the final action executes. The "why did my light turn off" trace will be incomplete.

**Specification — amend Doc 01 §4.4:**

```
Causal chain timeout is dynamic based on automation context:

  - Default chain timeout: 5 minutes (unchanged)
  - Automation-associated chain timeout: max(5 minutes,
    automation's total_delay + 5 minutes)

When an AutomationRun begins, the Automation Engine calculates
the maximum possible delay in its action sequence and updates
the chain's timeout via:
  CausalChainProjection.extendTimeout(correlationId, Duration)

This ensures that even automations with 30-minute delays
maintain complete causal chains for forensic analysis.

The 10,000 active chain limit remains. If the limit is
approached, chains are evicted by LRU with a preference for
evicting non-automation chains first.
```

**Invariant alignment:** INV-ES-06 (explainability)

---

### AMD-19: Emergency Retention Priority Refinement

**Affected docs:** Doc 01 (Event Model)
**Section(s):** Doc 01 §6.5 (emergency retention)
**Classification:** RECOMMENDED

**Problem:**

Under disk pressure, the current retention priority retains DIAGNOSTIC events over NORMAL state transitions. This means debug telemetry survives while automation history (the events users actually need for "why did this happen" answers) is deleted first. The priority should be inverted for user-facing value.

**Specification — amend Doc 01 §6.5:**

```
Emergency retention priority (highest retained first):

  1. CRITICAL events (system health, crash records, security)
  2. NORMAL events with automation_run association (automation
     history — the "why did this happen" answer chain)
  3. NORMAL events without automation association (device state
     changes)
  4. DIAGNOSTIC events (telemetry, debug, performance metrics)

Under emergency retention:
  - DIAGNOSTIC events are deleted first (oldest first within tier)
  - If disk pressure persists after all DIAGNOSTIC events older
    than 1 hour are deleted, NORMAL non-automation events are
    trimmed (oldest first, respecting the minimum 24-hour
    retention window for state events)
  - CRITICAL and automation-associated NORMAL events are deleted
    only as a last resort (disk > 95% full)
```

**Invariant alignment:** INV-ES-06 (explainability — the events users need most are retained longest)

---

### AMD-20: YAML Parser Safety Configuration

**Affected docs:** Doc 06 (Configuration System)
**Section(s):** Doc 06 §3.1 (loading pipeline, stage 2)
**Classification:** RECOMMENDED

**Problem:**

Doc 06 references SnakeYAML Engine and YAML 1.2 (LTD-09) but doesn't specify parser safety configuration. SnakeYAML can construct arbitrary Java objects if misconfigured. The Configuration System design should explicitly state its safety posture.

**Specification — add to Doc 06 §3.1 stage 2:**

```
SnakeYAML Engine parser configuration:

  - Constructor: SafeConstructor (no arbitrary Java object
    deserialization)
  - Maximum nesting depth: 20 levels
  - Maximum document size: 1 MB
  - Maximum number of aliases: 50 (prevents billion laughs /
    YAML bomb attacks)
  - Custom tag constructors registered: !secret, !env (§3.4) —
    no other custom tags permitted
  - XXE prevention: not applicable (YAML, not XML) but
    no external entity processing of any kind

If the YAML file exceeds any safety limit, parsing fails with
a FATAL validation issue. The error message identifies which
limit was exceeded.
```

**Invariant alignment:** INV-SE-01 (security by default)

---

### AMD-21: WAL Checkpoint Strategy Storage Awareness

**Affected docs:** Doc 04 (Persistence Layer)
**Section(s):** Doc 04 §3.x (WAL management)
**Classification:** RECOMMENDED

**Problem:**

LTD-02 explicitly prohibits SD cards for production, but the system should detect storage type at startup and adjust its behavior accordingly — both for users who ignore the recommendation and for development environments.

**Specification — add to Doc 04:**

```
### Storage-Aware WAL Strategy

At startup, the Persistence Layer detects the storage type by
reading /sys/block/{device}/queue/rotational and
/sys/block/{device}/device/model:

| Storage type | Detection | WAL checkpoint interval | VACUUM strategy |
|---|---|---|---|
| NVMe SSD | rotational=0, nvme in model | Weekly TRUNCATE | Monthly INCREMENTAL |
| SATA SSD | rotational=0, non-nvme | Weekly TRUNCATE | Monthly INCREMENTAL |
| SD card | rotational=0, mmcblk pattern | Daily PASSIVE only | Never auto-VACUUM |
| HDD | rotational=1 | Weekly TRUNCATE | Monthly INCREMENTAL |
| Unknown | detection fails | Weekly TRUNCATE (conservative) | Monthly INCREMENTAL |

For SD card storage:
  - Log a WARNING at startup: "SD card storage detected. This is
    not recommended for production use (see LTD-02). Write
    endurance may be insufficient for continuous operation."
  - Reduce WAL checkpoint aggressiveness (PASSIVE only — never
    TRUNCATE, which forces full erase-block rewrites)
  - Disable auto-VACUUM entirely (user can trigger manually)
  - Increase event batching (write fewer, larger transactions
    to reduce IOPS)
```

**Invariant alignment:** INV-PR-01 (constrained hardware), INV-CS-07 (no forced obsolescence)

---

### AMD-22: Observability Alerting Foundation

**Affected docs:** Doc 11 (Observability & Debugging)
**Section(s):** Doc 11, new §X
**Classification:** RECOMMENDED

**Problem:**

Health aggregation exists but there's no alerting — no MQTT publish, no webhook, no notification when the system enters degraded state. A system running in a closet that enters DEGRADED or CRITICAL state will stay there until the user happens to check the dashboard.

This doesn't need a full alerting engine for Tier 1, but the health model needs an extension point that future alerting can plug into.

**Specification — add to Doc 11:**

```
### Health State Change Notification

When the system-level health state changes (e.g., HEALTHY →
DEGRADED, DEGRADED → CRITICAL, or any recovery transition),
the Observability subsystem:

1. Emits a system.health_state_changed event (CRITICAL tier)
   containing:
   - previous_state: HealthState
   - new_state: HealthState
   - trigger: String (which subsystem/component caused the change)
   - summary: String (human-readable explanation)
   - timestamp: Instant

2. Invokes all registered HealthChangeListeners:
   interface HealthChangeListener {
       void onHealthStateChanged(HealthStateChange change);
   }

For Tier 1, the only listener is the structured logger (writes
the event to the log). The listener interface enables Tier 2
additions:
  - MQTT publish to a notification topic
  - Webhook POST to a user-configured URL
  - WebSocket broadcast to connected clients (Doc 10)

The listener invocation is asynchronous (fire-and-forget via
virtual thread) to avoid blocking health aggregation.
```

**Invariant alignment:** INV-CE-05 (self-diagnosing system), INV-RF-03 (graceful degradation — alerting is part of degradation visibility)

---

### AMD-23: Cross-Protocol Device Identity Resolution

**Affected docs:** Doc 02 (Device Model & Capability System)
**Section(s):** Doc 02 §3.x (device identity)
**Classification:** RECOMMENDED

**Problem:**

When the same physical device is reachable via multiple protocols (e.g., a lamp accessible via both Zigbee and Matter), the current deduplication pipeline is integration-scoped. The system creates two `device_id`s for one physical device. The State Store holds two entity states. Automations must target one or the other, and they can diverge.

For Tier 1 (Zigbee only), this is not an issue. But the device model is designed once and used across all tiers. If cross-protocol identity isn't at least structurally accommodated now, Tier 2 requires a device model rework.

**Specification — add to Doc 02:**

```
### Cross-Protocol Device Identity

#### Physical Device Group

The Device Model supports an optional physical_device_group
association:

  record PhysicalDeviceGroup(
      String groupId,      // ULID, stable across protocols
      Set<DeviceRef> members,  // devices representing the same
                               // physical device across protocols
      DeviceRef primary         // the "preferred" protocol for commands
  )

For Tier 1 (single protocol), every device has an implicit
singleton group (groupId = deviceId, members = {self},
primary = self). No behavioral change.

For Tier 2+, when a second protocol adapter discovers a device
that matches an existing device's physical_id (e.g., same
MAC address, same Matter device ID), the Device Registry creates
a PhysicalDeviceGroup linking both:
  - State queries for the group return the primary member's state.
  - Commands to the group route to the primary member.
  - If the primary member is unreachable, commands fall back to
    other members (protocol failover).
  - Automations can target either the group (recommended) or a
    specific protocol member.

The matching heuristic is integration-provided: each adapter
can declare identity_hints (e.g., MAC address, serial number,
manufacturer model) that the Device Registry uses for
cross-protocol matching. Exact matching algorithm is a
Phase 3 implementation detail.

The PhysicalDeviceGroup concept is structural only in Tier 1 —
no code paths change, but the DeviceRef type and DeviceRegistry
interface accommodate it.
```

**Invariant alignment:** INV-CS-04 (integration API stability — the device model shouldn't break when new protocols arrive)

---

### AMD-24: Configuration Reload Atomicity Clarification

**Affected docs:** Doc 06 (Configuration System)
**Section(s):** Doc 06 §3.3 (reload pipeline), §4.1 (ConfigModel)
**Classification:** RECOMMENDED

**Problem:**

Doc 06 §3.3 describes atomic reference swap for ConfigModel on reload, but doesn't specify what happens to subsystems mid-read. A subsystem calling `getCurrentModel()` twice during a reload may get two different models. The immutability contract is implied but not explicitly stated in the reload context.

**Specification — add to Doc 06 §3.3:**

```
### Reload Atomicity Contract

ConfigModel is immutable (§4.1). The active model reference is
a volatile field. On reload, the new ConfigModel is constructed
completely before the reference is swapped (no partial visibility).

Subsystem contract:
  - A subsystem that calls getCurrentModel() receives a complete,
    consistent ConfigModel instance.
  - If a subsystem calls getCurrentModel() twice across a reload
    boundary, it may receive two different instances. This is
    expected and correct — each instance is independently
    consistent.
  - If a subsystem needs multiple reads from the same config
    snapshot (e.g., reading 3 related fields), it MUST capture
    the ConfigModel reference once and read all fields from that
    single reference:

      ConfigModel model = configService.getCurrentModel();
      int a = model.getInt("section.field_a");
      int b = model.getInt("section.field_b");
      // a and b are guaranteed from the same config version

  - Subsystems that receive configuration via ConfigurationAccess
    (§8.4) follow the same pattern: capture the access result
    once, read fields from that result.

The reload notification (§3.3, stage 7) is delivered AFTER the
reference swap. Subsystems registered for reload notification
are guaranteed to see the new model when their callback fires.
```

**Invariant alignment:** INV-TO-03 (no hidden state — config reads are deterministic within a snapshot)

---

## 5. Amendment Impact Summary

### By Document

| Document | Amendments | BLOCKING | REQUIRED | RECOMMENDED |
|---|---|---|---|---|
| Doc 01 (Event Model) | AMD-01, 04, 06, 18, 19 | 3 | 0 | 2 |
| Doc 02 (Device Model) | AMD-17, 23 | 0 | 1 | 1 |
| Doc 03 (State Store) | AMD-01, 02, 03, 10, 11 | 4 | 1 | 0 |
| Doc 04 (Persistence) | AMD-05, 06, 21 | 2 | 0 | 1 |
| Doc 05 (Integration Runtime) | AMD-14 | 0 | 1 | 0 |
| Doc 06 (Configuration) | AMD-13, 16, 20, 24 | 0 | 2 | 2 |
| Doc 07 (Automation Engine) | AMD-03, 04 | 2 | 0 | 0 |
| Doc 08 (Zigbee Adapter) | AMD-07 | 1 | 0 | 0 |
| Doc 09 (REST API) | AMD-08, 12, 15 | 1 | 2 | 0 |
| Doc 10 (WebSocket API) | AMD-09 | 1 | 0 | 0 |
| Doc 11 (Observability) | AMD-22 | 0 | 0 | 1 |

### By Phase Gate

**Must resolve before Phase 2 (interface specs):** AMD-01 through AMD-10 (10 BLOCKING amendments)

**Must resolve before Phase 3 (implementation):** AMD-11 through AMD-17 (7 REQUIRED amendments)

**Should resolve when convenient:** AMD-18 through AMD-24 (7 RECOMMENDED amendments)

### Cross-Cutting Themes

The amendments cluster around three systemic patterns that the original design process missed:

**Theme 1 — Boundary Contracts (AMD-01, 02, 03, 06):** The most dangerous gaps are at subsystem interfaces where each document assumes the other specifies the contract. The EventPublisher durability semantics, the REPLAY reconciliation pass, and the consistent snapshot API all sit on boundaries between the Event Model, State Store, and Automation Engine. These must be resolved as a group — they are interdependent.

**Theme 2 — Production Resilience (AMD-04, 05, 07, 09, 11, 17):** The designs are correct for steady-state operation but under-specified for failure modes that are routine in production: cascade storms, mesh route failures, thundering herds, stale sensors, orphaned devices, storage wear. Each of these is a "works in the demo, fails in the field" risk.

**Theme 3 — Security and API Stability (AMD-08, 12, 13, 15):** Idempotency keys, permission scoping, correlation IDs, and config migration are all features that are trivial to include in the initial design but expensive to retrofit. Their absence doesn't block a demo but blocks production readiness.

---

*End of amendments document.*
