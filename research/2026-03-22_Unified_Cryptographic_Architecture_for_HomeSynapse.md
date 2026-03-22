# HomeSynapse Core — Unified Cryptographic Architecture

**Document type:** Research artifact — architectural design proposal
**Status:** Draft
**Date:** 2026-03-22
**Purpose:** Map empirical cryptographic research (ARM hardware benchmarks, algorithm selection, key management design) to HomeSynapse's existing architecture, producing specific implementation recommendations for the hash chain (MVP), package signing (MVP), and envelope encryption with crypto-shredding (post-MVP)
**Feeds into:** INV-PD-03 (Encrypted Storage), INV-PD-07 (Crypto-Shredding), INV-PD-08 (Tamper-Evident Integrity), LTD-03 (SQLite persistence), LTD-08 (EventSerializer), Doc 01 §4.2 (event store schema), Doc 04 (Persistence Layer), Doc 12 (Startup/Lifecycle)
**Dependencies:** Virtual Thread Risk Audit (AMD-26 through AMD-30), WAL Validation Spike Plan, Architecture Invariants v1 §6 (Privacy & Data), Locked Decisions Register v1
**Author:** nick@nexsys.io

---

## 0. Executive Summary

Empirical research into ARM cryptographic hardware acceleration on Raspberry Pi 4 and Pi 5 reveals a defining asymmetry: the Pi 5's BCM2712 delivers 10× faster SHA-256 and 21× faster AES-256-GCM through ARMv8 crypto extensions that the Pi 4's BCM2711 entirely lacks. This asymmetry shapes every algorithm and implementation decision.

Three conclusions emerge:

1. **The SHA-256 hash chain is essentially free on Pi 5 and negligible on Pi 4.** At ~0.7–1.0 µs per event on Pi 5 and ~5–10 µs on Pi 4, the tamper-evident chain adds less than 1% overhead at HomeSynapse's design throughput (100–500 events/sec sustained). This means INV-PD-08's tamper-evident integrity chain should ship in v1.0 as a default-on feature, not a deferred capability.

2. **Ed25519 package signing requires zero new dependencies and trivial boot-time cost.** Java 21's built-in `Signature.getInstance("Ed25519")` is production-ready. At ~0.5–1.5 ms per verification on Pi 5, verifying 10–50 packages at boot adds ~12 ms. This should also ship in v1.0.

3. **Envelope encryption with crypto-shredding (INV-PD-03, INV-PD-07) is architecturally clean but adds meaningful complexity.** The per-scope key hierarchy, AES-256-GCM encryption pipeline, Bouncy Castle dependency for Argon2id, and GCM nonce management are each individually tractable but collectively represent significant engineering scope. The schema and interfaces should be designed to accommodate encryption from day one, but the implementation should be deferred to Tier 2 — after the core event pipeline is proven stable.

The four cryptographic requirements (hash chain, encryption, crypto-shredding, package signing) compose into a unified architecture because they occupy distinct layers with independent key domains. The critical design insight is that **the hash chain operates on stored bytes, not plaintext** — this means the chain survives encryption being toggled on/off and survives crypto-shredding intact.

---

## 1. Mapping to Existing Invariants and Locked Decisions

### 1.1 Invariant Coverage

| Invariant | Requirement | Crypto Layer Component | Proposed MVP Scope |
|-----------|-------------|----------------------|-------------------|
| INV-PD-03 | Encrypted storage for sensitive data, user-owned keys, AES-256-GCM | Envelope encryption with per-scope DEKs | Schema reservations only. Implementation Tier 2. |
| INV-PD-07 | Crypto-shredding via per-scope keys, reconciles append-only with GDPR erasure | Scope KEK hierarchy, key destruction = data destruction | Schema reservations only. Implementation Tier 2. |
| INV-PD-08 | Tamper-evident integrity chain for firmware, packages, configuration | SHA-256 hash chain on event log + Ed25519 package verification | **Full implementation in v1.0.** |
| INV-ES-01 | Events are immutable once persisted | Hash chain enforces: any mutation breaks the chain | Strengthened by hash chain. |
| INV-PD-06 | Offline integrity, crash-safe writes | Chain hash cached in memory with rollback guard on transaction failure | Integrated into single-writer model. |

### 1.2 Locked Decision Interactions

| LTD | Interaction | Impact |
|-----|-------------|--------|
| LTD-03 (SQLite) | Hash chain stored as BLOB(32) column in events table. Chain computation happens on virtual thread before platform thread executor submission (SHA-256 is pure Java, no JNI — no carrier pinning). | Schema change to Doc 01 §4.2. Compatible with AMD-27 executor model. |
| LTD-04 (ULID) | Event identity (BLOB(16)) included in chain hash input. No change to ULID handling. | No impact. |
| LTD-07 (Schema migration) | Adding `chain_hash BLOB(32) NOT NULL` column requires a forward-only migration. Genesis event uses 32-byte zero vector. | New migration file V002. |
| LTD-08 (EventSerializer) | EventSerializer produces `byte[]`. Chain hash is computed over those bytes plus canonical metadata bytes. The serializer abstraction boundary is preserved — crypto wraps around it, not inside it. | No change to EventSerializer contract. |
| LTD-11 (No external broker) | Hash chain state is maintained by the single-writer thread. The in-process event bus is unaware of the chain — it dispatches events after persistence, which is after chain hash computation. | No impact. |
| LTD-13 (jlink + systemd) | Ed25519 public verification key embedded at `/etc/homesynapse/signing-key.pub` in the read-only system image. | New file in jlink distribution. |
| LTD-14 (Update strategy) | Package signing verification happens before update application. Mandatory snapshot still taken before migration. | Addition to update verification step. |

### 1.3 Architecture Invariants Phased Delivery Alignment

The Architecture Invariants document (§16.5) defines a four-phase delivery for the transparency chain:

- **Phase 1 (MVP):** Tamper-evident integrity for firmware, updates, configuration, integration provenance
- **Phase 2:** Automation execution logging in the integrity chain
- **Phase 3:** Data access auditing for sensitive categories
- **Phase 4:** Cloud operation verification, user-facing integrity dashboard

This research proposes **expanding Phase 1** to include the event log hash chain (not just firmware/package signing). The performance data justifies this: the chain adds <1% overhead. The architectural benefit is substantial: every event in the system becomes tamper-evident from day one, which means Phases 2–4 are projections over an already-tamper-evident log rather than retroactive additions. This is the difference between "we added integrity later" and "integrity was always there."

---

## 2. Architectural Design

### 2.1 The Three Independent Key Domains

```
INTEGRITY DOMAIN (MVP)
  └─ No key required. SHA-256 hash chain is keyless.
     Tamper-evidence comes from the chain structure, not a secret.

SIGNING DOMAIN (MVP)
  └─ Developer-held Ed25519 private key (offline, never on device)
  └─ 32-byte Ed25519 public key embedded in read-only system image
  └─ Used only at boot and update time for package verification

ENCRYPTION DOMAIN (Tier 2)
  └─ User passphrase → Argon2id → Root Key (256-bit, in-memory only)
    └─ HKDF-SHA256(root_key, "scope:" + scope_id) → Scope KEK
      └─ Scope KEK wraps per-scope DEK via AES-256-GCM
        └─ DEK encrypts event payloads
```

This separation is load-bearing. Losing the user passphrase makes encrypted data irrecoverable but does not break chain verification or package signature checking. Destroying a scope KEK (crypto-shredding) renders that scope's events unreadable but does not invalidate any chain hashes. Each domain can be implemented, tested, and deployed independently.

### 2.2 Write Path Integration

The event write path currently follows this sequence (per Doc 01, Doc 04, AMD-27):

```
EventDraft → EventPublisher.publish()
  → EventSerializer.serialize(payload) → byte[]           [virtual thread]
  → assign global_position, subject_sequence               [virtual thread]
  → submit SQLite INSERT to platform thread executor        [virtual thread → platform thread]
  → platform thread: WAL commit                             [platform thread]
  → return to virtual thread                                [virtual thread]
  → notify EventBus subscribers                             [virtual thread]
```

The crypto layer inserts between serialization and executor submission:

```
EventDraft → EventPublisher.publish()
  → EventSerializer.serialize(payload) → byte[]            [virtual thread]
  → assign global_position, subject_sequence                [virtual thread]
  → (Tier 2) encrypt payload bytes → ciphertext + iv       [virtual thread, AES-256-GCM]
  → compute chain_hash over metadata + stored_bytes         [virtual thread, SHA-256]
  → cache chain_hash in instance variable                   [virtual thread]
  → submit SQLite INSERT to platform thread executor        [virtual thread → platform thread]
  → platform thread: WAL commit                             [platform thread]
  → on commit success: chain_hash is now durable            [virtual thread]
  → on commit failure: rollback cached chain_hash           [virtual thread]
  → notify EventBus subscribers                             [virtual thread]
```

The critical observation: **all crypto operations happen on the virtual thread, before the platform thread executor submission.** SHA-256 and AES-256-GCM are pure Java operations using JDK intrinsics — no JNI, no carrier pinning. This means the crypto layer does not interact with the AMD-27 platform thread executor pattern at all. The platform thread receives a fully prepared row (including chain_hash and optional ciphertext) and does a single SQLite INSERT.

### 2.3 Chain Hash Computation

```
chain_hash[n] = SHA-256(chain_hash[n-1] ‖ canonical_metadata_bytes[n] ‖ stored_payload_bytes[n])
```

The genesis event (first event in the log, global_position = 1) uses a 32-byte zero vector as `chain_hash[0]`.

**Canonical metadata serialization** uses length-prefixed binary fields to ensure deterministic hashing regardless of JSON key ordering:

```
[16 bytes: event_id]
[variable: event_type as UTF-8 with 4-byte length prefix]
[4 bytes: schema_version as big-endian int32]
[8 bytes: ingest_time as big-endian int64 (Unix microseconds)]
[8 bytes: event_time as big-endian int64, or 0x00 × 8 if null]
[16 bytes: subject_ref]
[8 bytes: subject_sequence as big-endian int64]
[1 byte: priority ordinal]
[variable: origin as UTF-8 with 4-byte length prefix]
[16 bytes: actor_ref, or 0x00 × 16 if null]
[16 bytes: correlation_id]
[16 bytes: causation_id, or 0x00 × 16 if null]
[variable: event_category JSON array as UTF-8 with 4-byte length prefix]
```

**stored_payload_bytes** is whatever the `payload` column contains — plaintext JSON bytes when encryption is disabled, ciphertext bytes when encryption is enabled. The chain is format-agnostic.

**Serialization format versioning:** The canonical format version (initially `1`) is recorded in the genesis event's metadata. If the format changes in a future version, old events retain their original format, new events use the new format, and the chain verification code handles both. This prevents the silent chain corruption risk identified in the research.

### 2.4 Chain Verification Strategy

Three verification layers, matching the research recommendations:

**Layer 1 — Startup verification (mandatory).** On every startup, verify from the most recent checkpoint to the chain head. At 10,000 events per checkpoint, this takes ~10–20 ms on Pi 5, ~50–100 ms on Pi 4. This runs during Doc 12's PERSISTENCE_READY phase, after SQLite opens but before the Event Bus begins dispatching. If verification fails, emit `system_integrity_violation` (CRITICAL) and enter degraded mode — the system runs but the integrity indicator is red.

**Layer 2 — Background full verification (periodic).** During idle periods (same window as retention per Doc 04 §3.4), verify the entire chain from genesis to head. At 100K events, this takes ~100–200 ms on Pi 5. At 10M events, ~10–20 seconds. Runs as a low-priority background task that yields between batches, similar to retention execution. Results are surfaced via the HealthContributor interface (Doc 11).

**Layer 3 — External anchoring (optional, user-initiated).** Users can export the current chain head hash to external storage (USB drive, signed file). On subsequent verification, compare the stored anchor against the chain at that position. This detects full-chain rewrites by an attacker with complete device access — the only attack that Layers 1 and 2 cannot detect for an on-device-only system.

### 2.5 Interaction with Event Retention

When retention (Doc 04 §3.4) deletes old events, their chain hashes are deleted too. This does not break the chain for surviving events because:

- Chain checkpoints store the `chain_hash` value at periodic boundaries (every 10,000 events by default)
- Verification from a checkpoint only requires events after that checkpoint
- Checkpoints older than the oldest surviving event can be pruned, but at least one checkpoint must be retained as the verification anchor

The `chain_checkpoints` table is a separate table from the events table, with its own retention policy: retain checkpoints for at least as long as the oldest surviving event, plus one additional checkpoint as the verification anchor.

### 2.6 Ed25519 Package Signing

The signing workflow follows the Debian/APT manifest-signing model:

**Build phase (developer machine, offline):**
1. Hash all update files into `MANIFEST.sha256` (one SHA-256 hash per file)
2. Sign: `manifest.sig = Ed25519_sign(private_key, MANIFEST.sha256)`
3. Include `MANIFEST.sha256` and `manifest.sig` in the update package

**Verification phase (device, boot-time and update-time):**
1. Load the 32-byte Ed25519 public key from `/etc/homesynapse/signing-key.pub`
2. Verify `manifest.sig` against `MANIFEST.sha256` using `Signature.getInstance("Ed25519")`
3. Verify each file's SHA-256 hash against the manifest
4. If any verification fails, reject the package and emit `system_package_rejected` (CRITICAL)

**Key rotation:** Include the successor public key in an update signed by the current key. Embed 1–2 backup successor keys in the initial system image for emergency rotation.

**Implementation note:** Java 21's Ed25519 support (SunEC provider, JEP 339) is constant-time, stable since JDK 15, and requires zero additional dependencies. The verification code is approximately 20 lines of Java.

### 2.7 Schema Design — Forward-Compatible from Day One

The v1.0 event store schema (Doc 01 §4.2) should include the chain hash column and reserve structural space for encryption columns that will be added via forward-only migration (LTD-07) when Tier 2 encryption ships.

**v1.0 schema addition (MVP — hash chain only):**

```sql
-- Add to events table
chain_hash  BLOB(32) NOT NULL   -- SHA-256 chain hash, always populated

-- New table
CREATE TABLE chain_checkpoints (
    checkpoint_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    event_position  INTEGER NOT NULL,   -- global_position of the checkpointed event
    chain_hash      BLOB(32) NOT NULL,  -- chain_hash value at that position
    created_at      INTEGER NOT NULL,   -- Unix microseconds
    UNIQUE(event_position)
);
```

The `payload` column remains `TEXT NOT NULL` (JSON) in v1.0. The chain hash covers the payload bytes as stored — since encryption is disabled in v1.0, this means the chain covers plaintext JSON bytes.

**Tier 2 schema migration (encryption + crypto-shredding):**

```sql
-- Forward-only migration when encryption ships
ALTER TABLE events ADD COLUMN payload_iv    BLOB(12);  -- AES-GCM IV, null when unencrypted
ALTER TABLE events ADD COLUMN dek_ref       TEXT;       -- scope_id:key_version, null when unencrypted
-- payload column changes from plaintext JSON to ciphertext bytes for encrypted events
-- SQLite's dynamic typing handles this transparently

-- New table for key management
CREATE TABLE scope_keys (
    scope_id        TEXT    NOT NULL,
    key_version     INTEGER NOT NULL,
    encrypted_kek   BLOB    NOT NULL,   -- KEK wrapped with root key (AES-256-GCM)
    iv              BLOB(12) NOT NULL,
    created_at      INTEGER NOT NULL,
    destroyed_at    INTEGER,            -- NULL until crypto-shredded
    PRIMARY KEY (scope_id, key_version)
);
```

When encryption is enabled for a scope, new events in that scope have `payload_iv` and `dek_ref` populated, and `payload` contains ciphertext. Old events in the same scope remain unencrypted (plaintext JSON with null `payload_iv`). The chain hashes for both encrypted and unencrypted events are valid because the chain always covers stored bytes.

### 2.8 Module Placement in the JPMS Dependency Graph

The crypto operations are internal implementation details of two modules:

**persistence module** — owns the chain hash computation, chain verification, checkpoint management, and (Tier 2) envelope encryption. These are part of the write path and verification path, both of which are persistence concerns. The `ChainHashComputer` and `ChainVerifier` are internal classes, not public interfaces. External subsystems interact with the chain through the existing `EventStore` interface (which gains a `getChainHead()` method) and a new `IntegrityService` interface in the observability module for verification status.

**lifecycle module** — owns the Ed25519 package verification step during boot and update. The public key is loaded from `PlatformPaths.configDir()` (platform-api). The verification logic is a startup phase task.

**No new module is needed.** The crypto layer is an internal implementation concern of persistence (for the event chain) and lifecycle (for package signing), consistent with AMD-27's principle that the platform thread executor is internal to persistence.

### 2.9 Dependency Impact

**MVP (hash chain + Ed25519): Zero new dependencies.** `java.security.MessageDigest` (SHA-256) and `java.security.Signature` (Ed25519) are both JDK built-in with hardware intrinsic support on Pi 5.

**Tier 2 (encryption + crypto-shredding): One new dependency — Bouncy Castle.** `org.bouncycastle:bcprov-jdk18on` (~5.5 MB) for Argon2id key derivation and HKDF. BC 1.83+ has full JPMS `module-info.java` support: `requires org.bouncycastle.provider;` in the persistence module descriptor.

**Critical constraint:** Bouncy Castle must **only** be used for Argon2id and HKDF. Never for AES, SHA-256, or Ed25519 — the JDK's intrinsic-accelerated implementations are measurably faster (5–10× on Pi 5). This constraint should be enforced via ArchUnit rule: no import of `org.bouncycastle.crypto.engines.AESEngine` or `org.bouncycastle.crypto.digests.SHA256Digest` in production code.

**Alternative zero-dependency path:** Use PBKDF2 with ≥600,000 iterations (OWASP 2023 guidance) instead of Argon2id for passphrase-to-root-key derivation. Implement HKDF manually (~30 lines wrapping `javax.crypto.Mac`). This eliminates the BC dependency entirely at the cost of weaker memory-hard resistance against GPU-based brute force. For a local-only system where the passphrase protects data on the same device, this tradeoff may be acceptable.

---

## 3. Performance Budget

### 3.1 Per-Event Crypto Overhead

| Operation | Pi 5 (HW crypto) | Pi 4 (software) | Notes |
|-----------|------------------|-----------------|-------|
| SHA-256 chain hash (~500 byte input) | ~0.7–1.0 µs | ~5–10 µs | JDK intrinsics auto-detect HWCAP_SHA2 |
| AES-256-GCM encrypt (500 byte payload) | ~3–6 µs | ~30–60 µs | Tier 2 only. JDK intrinsics use AESE/PMULL |
| AES-256-GCM wrap DEK (32 bytes) | ~2–3 µs | ~10–20 µs | Tier 2 only. Per DEK rotation, not per event |
| **MVP total (chain only)** | **~0.7–1.0 µs** | **~5–10 µs** | **<0.1% core at 1,000 events/sec** |
| **Tier 2 total (chain + encrypt)** | **~7–13 µs** | **~65–130 µs** | **~1% core on Pi 5, ~10% on Pi 4** |

### 3.2 Storage Overhead

The `chain_hash BLOB(32)` column adds 32 bytes per event. At HomeSynapse's design throughput:

- 100 events/day (minimal home): 1.2 KB/day → 0.4 MB/year
- 10,000 events/day (active home, 50 devices): 320 KB/day → 117 MB/year
- 100,000 events/day (high-density deployment): 3.2 MB/day → 1.2 GB/year

At 6–16% overhead relative to typical 200–500 byte event payloads, this is well within the storage budgets defined in Doc 04 §3.5.

### 3.3 Startup Verification Time

| Chain length | Pi 5 | Pi 4 | Notes |
|-------------|------|------|-------|
| 10,000 events (checkpoint-to-head) | ~10–20 ms | ~50–100 ms | Mandatory on every startup |
| 100,000 events (full chain) | ~100–200 ms | ~500 ms–1 s | Background periodic verification |
| 1,000,000 events | ~1–2 s | ~5–10 s | Large deployment, background only |
| 10,000,000 events | ~10–20 s | ~50–100 s | Spread across idle cycles |

The mandatory startup verification (checkpoint-to-head) fits within the 30-second startup target (Doc 12 §3.6) with substantial margin.

### 3.4 Pi 4 as the Constraint Floor

The Pi 4's lack of ARMv8 crypto extensions is the defining constraint. For MVP (hash chain only), the 5–10 µs per event overhead is negligible even on Pi 4 — less than 1% of a single core at 1,000 events/sec. For Tier 2 (full encryption), the 65–130 µs per event overhead consumes ~10% of a single Pi 4 core at 1,000 events/sec. This is feasible but leaves less headroom.

**Recommendation:** The Pi 4 Tier 2 throughput target should be relaxed to 500 events/sec (versus 1,000 on Pi 5) for workloads with full encryption enabled. Document this in LTD-02 when Tier 2 ships.

**Runtime detection:** Parse `/proc/cpuinfo` at startup for the `Features` line. Pi 5 shows `aes pmull sha1 sha2`; Pi 4 shows none. Log which acceleration path is active. On Pi 4 with Tier 2 encryption, consider offering AES-CBC (via ChaCha20 as an alternative — ~173–192 MB/s on Pi 4 versus ~25–30 MB/s for AES-GCM) as a performance optimization, though this sacrifices GCM's built-in authentication.

---

## 4. Risks and Mitigations

### 4.1 GCM Nonce Collision (Tier 2 Only)

**Risk:** AES-GCM with random 96-bit nonces hits the birthday bound at ~2³² encryptions per key. At 1,000 events/sec on a single scope, that's ~50 days.

**Mitigation:** Use deterministic counter-based nonces (scope-unique monotonic counter stored alongside the DEK). Alternatively, rotate the DEK well before 2³⁰ uses (~12 days at 1,000 events/sec). The per-scope DEK rotation is already part of the key management design.

### 4.2 Canonical Serialization Drift

**Risk:** If two software versions serialize the same event's metadata differently, the chain breaks irreversibly.

**Mitigation:** The canonical format version is recorded in the genesis event. The serialization code is a single static method with no external dependencies — length-prefixed big-endian binary, fully specified in this document. The format is independent of Jackson, independent of EventSerializer, and independent of the JSON payload format. Changes to the canonical format require a new format version number and dual-format verification support.

### 4.3 Root Key Loss (Tier 2 Only)

**Risk:** User forgets passphrase → all encrypted data irrecoverable. This is by design (crypto-shredding requires it), but surprising to users.

**Mitigation:** Offer optional encrypted root key backup to external storage (USB drive) at setup time. The backup itself is encrypted with a recovery passphrase. The chain hashes and package signatures remain functional regardless — independent key domains.

### 4.4 Single-Writer Chain State

**Risk:** The cached `previous_chain_hash` is an in-memory variable on the single-writer virtual thread. If the writer crashes after computing a chain hash but before the SQLite commit, the cache is inconsistent.

**Mitigation:** Rollback guard. On transaction failure, reset the cached hash to the last committed hash (read from the `chain_hash` of the most recent committed event, or from the latest checkpoint). On startup, always initialize the cache from the database, never from any in-memory state.

### 4.5 JDK Crypto Intrinsics Activation

**Risk:** Specific Corretto builds could theoretically disable ARM crypto intrinsics.

**Mitigation:** At startup, benchmark a single SHA-256 operation. If it completes in <1 µs, intrinsics are active. If >5 µs, log a warning indicating software fallback. This is a diagnostic check, not a functional gate — the code works either way, just slower.

---

## 5. What Ships When

### 5.1 v1.0 (MVP)

| Component | Implementation | New Dependencies | Estimated Effort |
|-----------|---------------|-----------------|-----------------|
| SHA-256 event chain | `ChainHashComputer` internal to persistence. Computes hash on VT before executor submission. Caches previous hash. Rollback guard. | None (JDK built-in) | 2–3 days |
| Chain checkpoints | `chain_checkpoints` table. Checkpoint every 10,000 events. | None | 1 day |
| Startup verification | Verify checkpoint-to-head during PERSISTENCE_READY phase. Emit `system_integrity_violation` on failure. | None | 1 day |
| Background verification | Full-chain verification during idle window (alongside retention). | None | 1 day |
| Ed25519 package signing | Manifest-based signing in build pipeline. Verification at boot and update time. | None (JDK built-in) | 2 days |
| Schema: `chain_hash` column | `V002__add_chain_hash.sql` migration. BLOB(32) NOT NULL. | None | 0.5 days |
| Intrinsics detection | Log crypto acceleration status at startup. | None | 0.5 days |
| **Total** | | **Zero new dependencies** | **~8–10 days** |

### 5.2 Tier 2 (Post-MVP)

| Component | Implementation | New Dependencies | Estimated Effort |
|-----------|---------------|-----------------|-----------------|
| Envelope encryption | AES-256-GCM per-scope DEK encryption in write path. Selective — only scoped event categories per INV-PD-07. | None (JDK built-in AES-GCM) | 3–4 days |
| Per-scope key hierarchy | Argon2id root key derivation, HKDF scope KEK derivation, DEK wrapping. `scope_keys` table. | Bouncy Castle bcprov-jdk18on (~5.5 MB) | 3–4 days |
| Crypto-shredding | KEK destruction API. Verification that shredded events are irrecoverable. Chain integrity preserved. | None | 2 days |
| DEK rotation | Automatic rotation on counter threshold or time-based schedule. | None | 1–2 days |
| Schema: encryption columns | `V00N__add_encryption_columns.sql` migration. `payload_iv BLOB(12)`, `dek_ref TEXT`, `scope_keys` table. | None | 0.5 days |
| Nonce management | Counter-based deterministic nonces per scope. | None | 1 day |
| Pi 4 optimization | Optional ChaCha20 fallback for Pi 4 deployments. | None | 1 day |
| **Total** | | **One new dependency (BC)** | **~12–15 days** |

### 5.3 Tier 3+ (Future)

- Automation execution transparency (chain covers automation trace events)
- Data access auditing (chain covers access events)
- Cloud operation verification (chain extends to cloud backup operations)
- User-facing integrity dashboard (web UI for chain verification status)
- External anchoring protocol (cross-device chain verification)

---

## 6. Spike Extension — Crypto Validation

The WAL validation spike (`research/sqlite-wal-validation-spike-plan.md`) should be extended with three additional criteria to validate the crypto layer's performance characteristics on real hardware. These extend the spike rather than creating a separate one — they share the same SQLite infrastructure, the same event schema, and the same measurement framework.

### C6: Chain Hash Throughput Overhead

**Test:** Run C1 (100K event inserts) with SHA-256 chain hash computed per event and stored in BLOB(32) column. Compare throughput to the C1 baseline.

**Success:** Overhead < 5% versus unchained baseline on Pi 5.

**Record:** Events/sec with chain, events/sec without chain, per-event chain hash latency (via `System.nanoTime` around SHA-256 call only), total overhead percentage.

### C7: Chain Verification Performance

**Test:** After C6 completes (100K chained events), verify the full chain from genesis. Then verify from the last checkpoint (at position 90,000) to head.

**Success:** Full 100K verification < 500 ms on Pi 5. Checkpoint-to-head (10K events) < 50 ms.

**Record:** Full verification time, checkpoint verification time, per-event verification rate.

### C8: Ed25519 Verification Throughput

**Test:** Generate an Ed25519 keypair. Sign a 10 KB manifest. Verify the signature 50 times (simulating boot-time verification of 50 packages).

**Success:** Total 50 verifications < 100 ms on Pi 5.

**Record:** Per-verification latency, total time for 50 verifications.

---

## 7. Open Decisions

### OPEN-01: Chain Hash Column in MVP Event Schema

**Question:** Should the `chain_hash BLOB(32) NOT NULL` column be part of the initial `V001__initial_event_store_schema.sql` schema (created during the persistence module implementation), or added as a separate `V002__add_chain_hash.sql` migration?

**Recommendation:** Include it in V001. The chain is a v1.0 feature, not a retroactive addition. Having it in the initial schema avoids the need for a migration on first install and makes the chain genesis clean (first event = first hash).

### OPEN-02: Bouncy Castle vs Zero-Dependency Path for Tier 2

**Question:** When Tier 2 encryption ships, should we add Bouncy Castle for Argon2id + HKDF, or use PBKDF2 (≥600K iterations) + manual HKDF (~30 lines) to avoid the dependency?

**Recommendation:** Defer this decision until Tier 2 implementation begins. The MVP has zero dependency impact either way. The factors that matter — BC's JPMS compatibility with the HomeSynapse module graph at that time, Argon2id's value for a local-only system, and whether JDK 25 adds HKDF natively — will be clearer then.

### OPEN-03: Pi 4 Encryption Cipher

**Question:** Should Pi 4 deployments use AES-256-GCM (authenticated but slow: ~25–30 MB/s) or offer ChaCha20-Poly1305 as a faster alternative (~173–192 MB/s)?

**Recommendation:** Defer to Tier 2. For MVP, only the hash chain runs on Pi 4, and it's negligible overhead. When encryption ships, benchmark both ciphers on Pi 4 and make the decision empirically.

---

## 8. Governance Impact

### 8.1 Amendments Required Before Implementation

**Schema amendment to Doc 01 §4.2:** Add `chain_hash BLOB(32) NOT NULL` to the events table schema and add the `chain_checkpoints` table definition. This is a blocking amendment for the persistence module implementation (Phase 3 Step 3.1.5).

**Startup phase addition to Doc 12:** Add chain verification step to the PERSISTENCE_READY phase, after SQLite opens but before Event Bus initialization. This is non-blocking — it can be applied when the lifecycle module is implemented (Phase 3 Step 3.5.2).

**LTD-14 update:** Add Ed25519 signature verification as a mandatory step before update application. Non-blocking for MVP since the update workflow is a Phase 3 late-stage concern.

### 8.2 New Locked Decision

When Tier 2 encryption ships, a new locked decision should be created for the cryptographic algorithm selections (AES-256-GCM, SHA-256 chain, Ed25519 signing, Argon2id or PBKDF2 for KDF). For MVP, the algorithm choices are implicitly locked by this research document and do not need a formal LTD — SHA-256 and Ed25519 are the only viable choices given the constraints.

### 8.3 ArchUnit Rule (Tier 2)

When Bouncy Castle is added: `noClasses().that().resideInAnyPackage("com.homesynapse..").should().accessClassesThat().resideInAnyPackage("org.bouncycastle.crypto.engines..", "org.bouncycastle.crypto.digests..").because("JDK intrinsics are faster than BC for AES and SHA — use BC only for Argon2id and HKDF")`.

---

## 9. References

### Invariants
- INV-PD-03 (Encrypted Storage) — Architecture Invariants §6
- INV-PD-07 (Crypto-Shredding) — Architecture Invariants §6
- INV-PD-08 (Tamper-Evident Integrity) — Architecture Invariants §6
- INV-ES-01 (Immutable Events) — Architecture Invariants §2

### Locked Decisions
- LTD-03 (SQLite + WAL + platform thread executor) — Locked Decisions §2, AMD-26
- LTD-08 (EventSerializer abstraction) — Locked Decisions §4
- LTD-13 (jlink + systemd) — Locked Decisions §6
- LTD-14 (Update strategy) — Locked Decisions §6

### Design Documents
- Doc 01 §4.2 (Event store schema)
- Doc 04 (Persistence Layer — write path, retention, maintenance)
- Doc 12 (Startup/Lifecycle — boot phases)

### External
- Crosby & Wallach, "Efficient Data Structures for Tamper-Evident Logging" (USENIX Security 2009) — linear hash chains for append-only logs
- OWASP Password Storage Cheat Sheet (2023) — PBKDF2 ≥600K iterations guidance
- NIST SP 800-185 (SHA-3 Derived Functions) — HKDF specification context
- FIPS 186-5 (February 2023) — Ed25519 standardization
- JEP 339 (Edwards-Curve Digital Signature Algorithm) — Java Ed25519 support
