# AMD-39: Journal Size Limit Revision

**Amendment ID:** AMD-39
**Tier:** CONTRACT-LEVEL (M2→M3 bridge — pre-M3 hardening)
**Status:** DRAFT (pending WAL pathology spike validation on hs-dev-1)
**Date drafted:** 2026-05-15
**Target document:** LTD-03 (SQLite Technology Selection — PRAGMA specification)
**Target sections:** Connection PRAGMAs — `journal_size_limit`
**Source:** WAL Spike (2026-04-02); M2→M3 Storage Efficiency Research; Home Assistant `recorder` issues #117263, #121909, #123348

## Problem

LTD-03 specifies `journal_size_limit = 6144000` (6 MB) as a connection PRAGMA applied by `DatabaseExecutor.applyConnectionPragmas()` (currently at `core/persistence/src/main/java/com/homesynapse/persistence/DatabaseExecutor.java` line 75).

This 6 MB value was validated by the WAL spike (2026-04-02) under a single-writer, no-concurrent-reader workload: the spike's 100K-event burst produced a WAL peak of 4.4 MB, leaving 1.6 MB headroom. Within the spike's scope, 6 MB was the correct, evidence-backed default — and the spike report explicitly captioned the value as "validated for the workload tested."

M3 changes that workload. The State Projection is a continuous reader that holds an open read transaction against the events table while consuming events. SQLite's WAL semantics prevent `wal_checkpoint` from advancing past the oldest open snapshot. While the projection's read transaction is open, the WAL can only grow. If checkpointing is starved long enough that the WAL reaches `journal_size_limit`, SQLite forcibly truncates the WAL — but the truncation requires acquiring an exclusive lock on the database, which fights every concurrent write and stalls the writer.

At 6 MB, this forced truncation fires at modest burst volumes. Under realistic M3 conditions (a multi-device automation cascade producing 100+ events while the projection is mid-read), the truncation-induced lock contention manifests as visible write latency spikes. This is the same pathology Home Assistant's `recorder` integration repeatedly hits (issues #117263, #121909, #123348).

64 MB is large enough to absorb every realistic burst the spike measured (4.4 MB peak with a 14× safety multiplier), negligible relative to the target storage tier (256 GB NVMe is 4,096× larger), and large enough that forced truncation under contention becomes an exceptional event rather than a normal-load occurrence.

## Change

**Before (LTD-03 PRAGMAs, currently applied by `DatabaseExecutor.CONNECTION_PRAGMAS`):**
```sql
PRAGMA journal_size_limit = 6144000;  -- 6 MB
```

**After:**
```sql
PRAGMA journal_size_limit = 67108864;  -- 64 MB
```

No other LTD-03 PRAGMA is affected. The change is a one-line update to the `CONNECTION_PRAGMAS` list in `DatabaseExecutor.java`.

## Rationale

The new value is **provisional** pending the WAL pathology spike (D1, pre-M3 gate). D1 will determine whether 6 MB is actually insufficient with a concurrent reader.

If D1's Run 3 (bounded-reader-only test) shows the WAL stays bounded under 6 MB when the State Projection closes and reopens read transactions every 500 rows, this amendment may be withdrawn — the bounded-window reader pattern (specified by `ProjectionAdvancer` in this work unit) may be sufficient on its own to prevent runaway WAL growth at the original 6 MB limit.

64 MB is the conservative default — large enough to provide meaningful safety headroom against the M3 reader pattern, small enough that it represents 0.025% of a 256 GB NVMe and 0.4% of a budget-class 16 GB SD card (the STUDIO profile's minimum target). It is the value used by Home Assistant after their post-pathology recorder tuning. It is also consistent with the `DeploymentProfile.HOME.journalSizeLimitBytes` constant defined in this work unit.

The STUDIO profile uses 32 MB and the PERFORMANCE profile uses 256 MB. The STUDIO 32 MB value is the only one that meaningfully differs from HOME, and reflects the smaller storage envelope of SD-card class hardware. This amendment locks the HOME profile value at 64 MB; the other profiles inherit the values declared in `DeploymentProfile` (this work unit).

## Implementation Impact

- `DatabaseExecutor.CONNECTION_PRAGMAS` (line 75 currently): `journal_size_limit = 6144000` → `journal_size_limit = 67108864`. **This is a Phase 3 code change, not Phase 2 scope.**
- `DatabaseExecutorTest`: any assertion that the applied PRAGMA value equals `6144000` must update to `67108864`. **This is a Phase 3 test change, not Phase 2 scope.**
- `DeploymentProfile.HOME.journalSizeLimitBytes()`: returns `67_108_864L`, matching this amendment. Defined in this work unit (Phase 2).
- Documentation: LTD-03 should be updated to cite this amendment as the active value.

## Invariant Alignment

- **INV-ES-04 (Write-ahead persistence):** Unaffected. `journal_size_limit` governs forced WAL truncation under pressure, not the durability of committed events. Events are durable at COMMIT regardless of WAL size.
- **INV-PD-06 (Offline integrity):** Unaffected. Power loss recovery uses the WAL as crash-recovery journal; size limit does not affect recovery correctness.

## Downstream Dependencies

- **DatabaseExecutor (Phase 3 update):** One-line PRAGMA value change. Single test assertion update.
- **DeploymentProfile (this work unit):** Carries the value as a profile-scoped constant (`HOME = 67_108_864L`). The PRAGMA application logic in M3 will read from the profile rather than the hardcoded constant — but that wiring is M3 scope.
- **STUDIO profile (32 MB):** Set in `DeploymentProfile` this work unit. Not affected by this amendment, but the smaller value is the operative one for SD-card hardware.
- **PERFORMANCE profile (256 MB):** Set in `DeploymentProfile` this work unit. Not affected by this amendment.

## Validation Gate

This amendment moves from DRAFT to APPLIED when D1 (WAL Pathology Validation Spike on hs-dev-1) produces one of the following outcomes:

1. **WAL grows past 6 MB under a slow continuous-reader workload** → 64 MB justified, status → APPLIED
2. **WAL stays bounded under 6 MB with bounded-window reader (close/reopen every 500 rows)** → bounded-window reader is the load-bearing safety mechanism, this amendment may be withdrawn
3. **WAL grows past 6 MB even with bounded-window reader** → 64 MB justified AND reader bounds are also load-bearing, status → APPLIED with prose noting the dual mechanism

Nick is the gate authority for the DRAFT → APPLIED transition based on D1 results.
