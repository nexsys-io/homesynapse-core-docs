# AMD-38: Checkpoint Policy Revision

**Amendment ID:** AMD-38
**Tier:** CONTRACT-LEVEL (M2→M3 bridge — pre-M3 hardening)
**Status:** APPLIED
**Date drafted:** 2026-05-15
**Date applied:** 2026-05-15
**Target document:** Doc 03 (State Store & State Projection)
**Target sections:** §9 (Runtime Configuration — checkpoint settings)
**Source:** M2→M3 Storage Efficiency Research; Home Assistant recorder issues #117263, #121909, #123348 (WAL checkpoint starvation pathology); D1 WAL Pathology Validation Spike (2026-05-15)

## Problem

Doc 03 §9 specifies the State Store's checkpoint configuration as:

```yaml
state_store:
  checkpoint:
    interval_minutes: 5
    event_threshold: 1000
    min_interval_seconds: 30
```

These values were designed for the original framing of checkpointing as crash-recovery — the only purpose was to bound replay cost on restart, so a long interval (5 minutes) and a large event threshold (1000) were acceptable trade-offs against checkpoint write amplification.

M3 introduces a continuous-reader pattern: the State Projection holds a read transaction against the events table while it consumes events and updates its materialized view. Under SQLite's WAL semantics, an open read transaction prevents `wal_checkpoint` from advancing past the reader's snapshot. As long as the projection's read transaction stays open, the WAL grows.

At a 5-minute checkpoint interval, a slow projection reader during a sensor burst (e.g., a 100-device automation cascade) allows the WAL to grow for the full interval before the reader closes its transaction and checkpointing can release the journal. The pathological outcome is unbounded WAL growth and eventual disk exhaustion. This is the same failure mode documented in Home Assistant's `recorder` integration (issues #117263, #121909, #123348), which uses essentially the same SQLite write pattern with a long-checkpoint cadence and a continuous reader.

Checkpoint frequency in M3 is no longer purely a crash-recovery knob — it is also the WAL release lever. The values must reflect both purposes.

## Change

**Before (Doc 03 §9 YAML):**
```yaml
state_store:
  checkpoint:
    interval_minutes: 5
    event_threshold: 1000
    min_interval_seconds: 30
```

**After:**
```yaml
state_store:
  checkpoint:
    max_interval_seconds: 2       # was interval_minutes: 5 — WAL release purpose
    event_threshold: 200          # was 1000 — bounds recovery to ~4ms on Pi 5
    min_interval_seconds: 1       # was 30 — storm protection floor
```

The key change is the renamed knob (`interval_minutes` → `max_interval_seconds`) along with the order-of-magnitude tightening:
- `max_interval_seconds: 2` — the projection's read transaction closes at most every 2 seconds, releasing WAL pages for checkpointing
- `event_threshold: 200` — bounds the events-since-last-checkpoint to a value that replays in roughly 4 ms on Pi 5 NVMe (measured during the V3 platform-thread executor spike, 2026-04-02)
- `min_interval_seconds: 1` — floor that prevents thrash during storm-burst conditions (does not let the projection checkpoint more often than once per second)

## Rationale

The new values are **empirically validated** by the WAL pathology spike (D1, 2026-05-15). D1 reproduced the checkpoint starvation pathology on the V001 25-column production schema at 5 events/s sustained: Run 1 (continuous reader holding an open read transaction) drove the WAL to 20.6 MB over 121 seconds with `wal_autocheckpoint` firing repeatedly but making zero progress, because the reader's held snapshot anchored the read-mark. The 2 s `max_interval_seconds` ceiling is therefore the load-bearing safety mechanism: it forces the projection's read transaction to close on a known cadence, releasing the WAL anchor and allowing checkpoints to advance.

D1 also showed that under the bounded-window reader pattern (close/reopen read transaction every 500 rows), `wal_autocheckpoint` alone is sufficient to keep the WAL bounded near the default 1000-frame threshold (~4 MB). The active 30 s checkpoint cycle did fire (4 times across the run) but was effectively redundant under nominal load. It is retained as **defense in depth** against degraded projections (long GC pauses, scheduler stalls, downstream I/O blocks) where the bounded-window cadence might slip.

The values are designed for the HOME deployment profile (Pi 5 NVMe). STUDIO and PERFORMANCE profiles inherit the same checkpoint policy; only PRAGMA values tied to RAM availability (`cache_size`, `mmap_size`) vary by profile.

## Implementation Impact

- `CheckpointPolicy` interface in state-store (this work unit) carries these values as the `FixedCheckpointPolicy.HOME_DEFAULT` constants. Now that AMD-38 is APPLIED, the Javadoc on `HOME_DEFAULT` should reference AMD-38 directly without the "provisional" qualifier.
- `DatabaseExecutor` is **not** directly affected — checkpoint policy is consumed by the State Projection subscriber, not by the executor. The executor's own PRAGMA settings are governed by LTD-03. (`journal_size_limit` stays at LTD-03's 6,144,000 — see AMD-39, which was WITHDRAWN on 2026-05-15.)
- No Phase 3 code exists yet for the State Projection that consumes this policy. M3 work will read these defaults via configuration and pass a `FixedCheckpointPolicy` instance to the projection loop.

## Invariant Alignment

- **INV-ES-04 (Write-ahead persistence):** Unaffected — checkpoint policy governs in-memory subscriber state flushing, not event durability.
- **INV-ES-05 (At-least-once delivery with subscriber idempotency):** The State Projection must remain idempotent for up to `event_threshold` events. The new value (200) is well within the idempotency window the existing design already requires.

## Downstream Dependencies

- **State Projection (M3 scope):** Consumes the policy via a `CheckpointPolicy` instance. Logic is implemented in M3 Phase 3.
- **Configuration system:** Doc 06 already supports operator overrides of `state_store.*` keys. The renamed key (`interval_minutes` → `max_interval_seconds`) is breaking for any operator config that has explicitly set the old key — but no production deployments exist yet, so no migration path is required.
- **AdaptiveCheckpointPolicy (post-MVP):** The adaptive policy will eventually override `FixedCheckpointPolicy.HOME_DEFAULT` under pressure mode. The DRAFT values here are the normal-mode baseline for adaptive scaling.

## Validation Gate — RESOLVED

D1 WAL Pathology Validation Spike (2026-05-15) produced the following results:

- **Run 1 (continuous reader):** WAL grew to 20.60 MB — pathology confirmed at 5 events/s
  sustained with the V001 25-column schema. wal_autocheckpoint fired repeatedly with
  zero effect because the reader's held snapshot anchored the WAL read-mark.
- **Run 2 (bounded reader + 64 MB + active checkpoint):** WAL peaked at 3.96 MB.
  The bounded-window reader pattern (close/reopen transaction every 500 rows) allowed
  wal_autocheckpoint to make progress between chunks. Active checkpoint was redundant
  under nominal load (4 checkpoints fired, all no-ops).
- **Run 3 (bounded reader + 6 MB limit, no active checkpoint):** WAL peaked at 3.97 MB.
  Functionally identical to Run 2 — bounded reader alone is the load-bearing mitigation.

**Gate outcome:** Pathology reproduces (Run 1) and bounded-window reader prevents it
(Runs 2 and 3). Amendment status promoted to APPLIED.

The active checkpoint cycle (30 s PASSIVE) is retained as defense-in-depth against
degraded projections (GC pauses, scheduler stalls) but is not load-bearing under
nominal conditions.
