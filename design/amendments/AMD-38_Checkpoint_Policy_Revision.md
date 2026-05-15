# AMD-38: Checkpoint Policy Revision

**Amendment ID:** AMD-38
**Tier:** CONTRACT-LEVEL (M2→M3 bridge — pre-M3 hardening)
**Status:** DRAFT (pending WAL pathology spike validation on hs-dev-1)
**Date drafted:** 2026-05-15
**Target document:** Doc 03 (State Store & State Projection)
**Target sections:** §9 (Runtime Configuration — checkpoint settings)
**Source:** M2→M3 Storage Efficiency Research; Home Assistant recorder issues #117263, #121909, #123348 (WAL checkpoint starvation pathology)

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

The new values are **provisional** pending empirical validation by the WAL pathology spike (D1, pre-M3 gate). D1 will reproduce the checkpoint starvation pathology on hs-dev-1 by running a slow simulated projection reader against a high-rate writer and observing WAL growth.

If D1 demonstrates that the pathology does not reproduce at HomeSynapse event rates (0.5–5 events/s sustained), these values may be relaxed. The DRAFT status is the operational signal that these values are not yet locked — they cannot be cited as canonical Doc 03 §9 until D1 results promote this amendment to APPLIED.

The values are designed for the HOME deployment profile (Pi 5 NVMe). STUDIO and PERFORMANCE profiles will get profile-scaled defaults in a future amendment if D1 results require it.

## Implementation Impact

- `CheckpointPolicy` interface in state-store (this work unit) carries these values as the `FixedCheckpointPolicy.HOME_DEFAULT` constants. The Javadoc on `HOME_DEFAULT` explicitly states the values are AMD-38 provisional.
- `DatabaseExecutor` is **not** directly affected — checkpoint policy is consumed by the State Projection subscriber, not by the executor. The executor's own PRAGMA settings are governed by LTD-03 (and AMD-39 for `journal_size_limit`).
- No Phase 3 code exists yet for the State Projection that consumes this policy. M3 work will read these defaults via configuration and pass a `FixedCheckpointPolicy` instance to the projection loop.
- If D1 invalidates these values, this amendment is withdrawn and a new amendment with the empirically-validated values is issued. The `HOME_DEFAULT` constant is updated accordingly.

## Invariant Alignment

- **INV-ES-04 (Write-ahead persistence):** Unaffected — checkpoint policy governs in-memory subscriber state flushing, not event durability.
- **INV-ES-05 (At-least-once delivery with subscriber idempotency):** The State Projection must remain idempotent for up to `event_threshold` events. The new value (200) is well within the idempotency window the existing design already requires.

## Downstream Dependencies

- **State Projection (M3 scope):** Consumes the policy via a `CheckpointPolicy` instance. Logic is implemented in M3 Phase 3.
- **Configuration system:** Doc 06 already supports operator overrides of `state_store.*` keys. The renamed key (`interval_minutes` → `max_interval_seconds`) is breaking for any operator config that has explicitly set the old key — but no production deployments exist yet, so no migration path is required.
- **AdaptiveCheckpointPolicy (post-MVP):** The adaptive policy will eventually override `FixedCheckpointPolicy.HOME_DEFAULT` under pressure mode. The DRAFT values here are the normal-mode baseline for adaptive scaling.

## Validation Gate

This amendment moves from DRAFT to APPLIED when D1 (WAL Pathology Validation Spike on hs-dev-1) produces one of the following outcomes:

1. **Pathology reproduces at these values or worse** → values stand, status → APPLIED
2. **Pathology does not reproduce** → revisit, potentially relax values, issue replacement amendment
3. **Pathology reproduces only when reader holds transactions longer than 2 s** → values stand, status → APPLIED (the 2 s `max_interval_seconds` is the load-bearing safety mechanism)

Nick is the gate authority for the DRAFT → APPLIED transition based on D1 results.
