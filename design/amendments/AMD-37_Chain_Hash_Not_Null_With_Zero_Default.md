# AMD-37: Chain Hash NOT NULL with Zero-Hash Default

**Amendment ID:** AMD-37
**Tier:** CONTRACT-LEVEL (M2-bridge — pre-M3 structural hardening)
**Status:** APPLIED
**Date applied:** 2026-05-02
**Target document:** Doc 04 (Persistence Layer)
**Target sections:** §4 (Data Model — events table schema)
**Implements:** Unified Cryptographic Architecture research OPEN-01 recommendation, §2.7 schema design
**Source:** Unified Cryptographic Architecture for HomeSynapse (2026-03-22), Independent Validation Report (2026-05-02)

## Problem

V001 defines `chain_hash BLOB(32)` as nullable (line 33 of `V001__initial_event_store_schema.sql`). The current `SqliteEventStore` INSERT binds NULL for this column (`ps.setNull(16, Types.BLOB)` at line 317) with the comment "chain_hash deferred to crypto milestone."

The Unified Cryptographic Architecture research (§2.7, OPEN-01 recommendation) specifies `chain_hash BLOB(32) NOT NULL` with a 32-byte zero vector as the genesis default. The research states at §Constraints: *"LTD-07 (Schema migration): Adding `chain_hash BLOB(32) NOT NULL` column requires a forward-only migration. Genesis event uses 32-byte zero vector."*

The nullable design creates two bad outcomes when tamper-evidence is activated in a future milestone:

1. **Full-table backfill.** Every existing row with `chain_hash = NULL` must be updated to the zero-hash before chain computation can begin. On a multi-GB event log on Pi hardware, this is a minutes-to-hours operation that blocks all writes. The WriteCoordinator serializes all writes through a single platform thread — the backfill monopolizes it.

2. **Chain epoch break.** If backfill is skipped, the chain starts at the first post-activation event. All pre-activation events have NULL chain hashes. Auditors and tamper-evidence verification systems cannot verify continuity from genesis to head. The chain has a gap that is functionally equivalent to "we don't know if the log was tampered with before this date." This undermines the trust guarantee that the chain is designed to provide.

The NOT NULL constraint with zero-hash default eliminates both outcomes: every row has a valid chain hash from day one. When chain computation is enabled, the genesis chain hash is calculated over `(zero_hash || event_metadata || payload)` — the zero-hash is a known, deterministic starting value, not an absence of data.

## Schema Change

Amend V001 in-place (V001 has not shipped to production; all existing databases are empty test instances):

**Before:**
```sql
chain_hash        BLOB(32),
```

**After:**
```sql
chain_hash        BLOB(32) NOT NULL DEFAULT x'0000000000000000000000000000000000000000000000000000000000000000',
```

The SQLite `DEFAULT x'...'` syntax for BLOB literals produces a 32-byte zero vector (64 hex characters = 32 bytes). This has been empirically verified: `CREATE TABLE t (h BLOB(32) NOT NULL DEFAULT x'0000...0000'); INSERT INTO t DEFAULT VALUES; SELECT hex(h), length(h) FROM t;` returns `hex=000...000, length=32`.

## SqliteEventStore Impact

**Before (line 317):**
```java
ps.setNull(16, Types.BLOB); // chain_hash deferred to crypto milestone
```

**After:**
```java
private static final byte[] ZERO_HASH = new byte[32];
// ...
ps.setBytes(N, ZERO_HASH); // chain_hash: zero-hash until crypto milestone activates chaining
```

This is a single-line change in the bind logic. The `ZERO_HASH` constant is a `private static final byte[32]` initialized to all zeros by the JVM's default array initialization.

Alternatively, the `chain_hash` column could be omitted from the INSERT column list entirely, relying on the `DEFAULT` clause. However, explicit binding is safer — it prevents silent breakage if column ordering changes and makes the intent explicit in code.

## Genesis Semantics

All events written before chain computation is enabled carry the 32-byte zero-hash. This is not a sentinel or placeholder — it is the defined genesis value.

When chain computation is activated in a future milestone:

```
chain_hash[1] = SHA-256(zero_hash || canonical_metadata[1] || payload[1])
chain_hash[n] = SHA-256(chain_hash[n-1] || canonical_metadata[n] || payload[n])
```

The first computed chain hash takes `zero_hash` as its predecessor. This matches the Unified Cryptographic Architecture §2.3 specification: *"The genesis event (first event in the log, global_position = 1) uses a 32-byte zero vector as `chain_hash[0]`."*

Chain integrity is preserved across the activation point because the zero-hash is deterministic and known. No chain epoch break occurs. Verification from genesis to head produces a continuous, verifiable chain.

## Test Impact

- **MigrationRunnerTest:** Verifies schema column presence (line 274 references `chain_hash`). Tests column existence, not nullability — no change needed unless the test explicitly checks for nullable constraints.
- **SqliteEventStoreTest:** Tests go through `SqliteEventStore.doAppend()`, which explicitly binds the `chain_hash` column. Once the `setNull` → `setBytes(ZERO_HASH)` change is made, all existing tests pass without modification.
- **New test:** A test should verify that `chain_hash` in a freshly inserted event is exactly 32 bytes of zeros, not NULL. This validates the NOT NULL constraint and the explicit binding.

## Invariant Alignment

- **INV-ES-01 (Immutability):** The constraint tightening does not modify existing events — the table is empty. Future events carry a non-null chain hash from insertion.
- **INV-ES-04 (Write-ahead persistence):** The chain hash is bound in the same INSERT as all other event fields. No additional write is needed.
- **Unified Cryptographic Architecture §2.7:** Directly implements the OPEN-01 recommendation: *"Include chain_hash in V001. The chain is a v1.0 feature, not a retroactive addition."*

## Downstream Dependencies

- **SqliteEventStore:** One-line bind change (`setNull` → `setBytes`). One constant addition (`ZERO_HASH`).
- **Future crypto milestone:** Chain computation activates by replacing `ZERO_HASH` with the computed SHA-256 value in the bind logic. The schema does not change — only the Java computation changes.
- **Chain verification (future):** Startup verification reads `chain_hash` from the last N events. NOT NULL guarantees no row returns NULL, simplifying the verification loop (no null-check branch needed).
