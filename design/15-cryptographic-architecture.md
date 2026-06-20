# HomeSynapse Core — Cryptographic Architecture

**Document type:** Subsystem design
**Status:** **Locked** (2026-06-07). Full DOCS review **RATIFY-WITH-EDITS** folded: **E1** schema naming `encrypted_kek`→`encrypted_dek` across §4.1 (column **and** comment → "scope DEK wrapped by the scope KEK"), §4.2 key-hierarchy row, and §8.2 `ScopeKey.encryptedDek`; **E2** §3.8 `PayloadCipher` wiring stated precisely (composition-root bridge in `com.homesynapse.app` — neither `persistence` nor `config` references the other; zero new module edge). Locked alongside **AMD-86** (INV-PD-07 narrow + INV-PD-03 at-rest posture) and **AMD-87** (Expectation codec); on-disk watermark → **AMD-87**. Review return: `nexsys-hivemind/context/audits/2026-06-06_Doc15_AMD-86_DOCS_Review_Return.md`. **AMD-94 folded 2026-06-19** (RATIFY-WITH-EDITS; E-1 boot-invariant restore⇒rotation-only sharpening + E-2 encoding-neutral discriminator applied; §8.1 currency rider kept): rotate-DEK-on-restore bound as the restore contract (§3.4/§6) + the 1-byte envelope version discriminator reserved (`v1` = current, §3.4/§4.1/§5); mints AMD-94-INV-01/02; review return `nexsys-hivemind/context/audits/2026-06-19_AMD-94_DOCS_Review_Return.md`. The former `[BLOCKING-for-M6-impl]` m2 counter-nonce-durability hazard (§6/§13.4/§16) is **RESOLVED** — crash-half by M6.3 (durable counter), restore-half by AMD-94 (rotate-on-restore); **OR-M6-NONCE → CLOSED**.
**Subsystem:** Cryptographic Architecture (event-log integrity chain, package signing, at-rest envelope encryption + per-scope key management, crypto-shredding)
**Dependencies:** Event Model & Event Bus (Doc 01 §4.2 event-store schema, §4.6 typed payload); Persistence Layer (Doc 04 §3.4 retention, §3.6 write path); Configuration System (Doc 06 §3.4/§8.5 secret store); Startup/Lifecycle (Doc 12 PERSISTENCE_READY phase, update-time verification); Integration Runtime (Doc 05 §3.8 `CredentialRotator`/AMD-60). Amendments: **AMD-37** (`chain_hash` NOT NULL zero-hash reservation — this doc activates it), AMD-26/AMD-27 (VT carrier-pinning / platform-thread executor — crypto runs off this path). Locked Decisions LTD-03/04/07/08/11/13/14. Invariants INV-PD-03/06/07/08, INV-ES-01, INV-SE-03, INV-CE-02.
**Dependents:** Configuration System (M6 — builds the secret store + key-management infrastructure to this design); Integration Runtime (M9 — `CredentialRotator` impl writes through the store); Observability (M12 — `IntegrityService` status); Persistence (M2/M4 — chain-hash write path); the institutional/cloud data-sharing products (post-MVP — activate the crypto-shred operation).
**Author:** HomeSynapse Core Architecture (PM, promoting `research/2026-03-22_Unified_Cryptographic_Architecture_for_HomeSynapse.md`)
**Date:** 2026-06-06

> **Provenance.** This document **promotes** the 2026-03-22 research artifact *Unified Cryptographic Architecture for HomeSynapse* (Draft, never owned by a numbered design doc) into the owned design that seven design docs already defer to for INV-PD-03/07 (Doc 01 §12, Doc 02 §12, Doc 04 §12, Doc 07 §12, Doc 09 §14, Doc 10 §12.6, Doc 14 §12.7). It **supersedes** that research artifact as the owner of the cryptographic architecture. It is **not a verbatim promotion**: it folds in decision **D2** (`nexsys-hivemind/context/decisions/2026-06-06_post-M4_M5-window_decisions.md`), which moves the MVP/post-MVP line the research drew — see §2.3 and the Provenance note in §16. The substance (three key domains, write-path integration, hash-chain computation, Pi-4/Pi-5 performance) is carried over from the research and re-verified against HEAD `8ef9e9f`.

---

## 0. Purpose

HomeSynapse stores an **immutable, append-only event log** (INV-ES-01) that is the system of record and the asset the whole data-value strategy rests on. Three cryptographic obligations attach to that log and to the software that runs it, and no numbered design doc currently owns them: **(1)** the log must be **tamper-evident** (INV-PD-08) so a user or auditor can verify locally that history has not been rewritten; **(2)** the most sensitive categories of data in the log (identity, person-linked presence) must be **encrypted at rest under user-controlled keys** (INV-PD-03), because plaintext PII on a removable SD card is a live exfiltration hole; and **(3)** because the log is immutable, the *only* mechanism by which data in it can ever be **erased** — for GDPR right-to-erasure or a future institutional data-sharing agreement — is **crypto-shredding** (INV-PD-07): encrypt under a per-scope key, then destroy the key. A fourth obligation attaches to the software supply chain: **package/update integrity** via Ed25519 signature verification (INV-PD-08).

This subsystem exists because those four obligations share one substrate (the event-store bytes and the key hierarchy) and must be designed as a unit, even though they ship on different schedules. Designing them piecemeal — as seven docs each deferring to "the key-management infrastructure established by INV-PD-03/07" that nobody owns — is exactly how the foundation-readiness assessment found a crypto **design vacuum** on M6's doorstep (M6 builds the secret store and the key manager). The cost of getting this wrong is not recoverable: the event log is immutable, so a category written in plaintext at launch can *never* be retroactively crypto-shredded. That irreversibility is why the at-rest/key-management seam is settled now, while the log is small.

---

## 1. Design Principles

**The chain operates on stored bytes, not plaintext.** The hash chain hashes whatever the `payload` column holds — plaintext JSON when a category is unencrypted, ciphertext when it is encrypted. This single decision makes the four obligations *independent layers*: integrity survives encryption being toggled on for a category, and survives crypto-shredding intact (destroying a key makes a payload unreadable but does not change its stored bytes or its chain hash).

**Three independent key domains.** Integrity (keyless SHA-256 chain), Signing (developer-held Ed25519, public key on device), and Encryption (user/​machine-rooted per-scope key hierarchy) share no key material. Losing the encryption root makes encrypted data irrecoverable but breaks neither chain verification nor signature checking. This separation is what lets each domain ship, be tested, and fail independently.

**Per-scope encryption, never whole-DB.** At-rest encryption is **application-level, per-scope (per data-category) payload encryption**, not whole-database encryption (e.g., SQLCipher). This is load-bearing: crypto-shredding *requires* per-scope keys — destroying one category's key must render that category irrecoverable while every other category and the chain survive. A whole-DB cipher can only shred everything or nothing, which cannot satisfy INV-PD-07's "operational for at least one category."

**Encrypt-on-write is now-or-never; the shred operation is not.** Because the log is immutable, a category is only ever crypto-shreddable if it was *written encrypted under a per-scope key in the first place*. So the **decision of which categories are encrypted-on-write is irreversible and made now**; the **key-destruction operation that consumes those keys is deferrable** to its first real consumer. The two are separated deliberately (§2.3, D2).

**Crypto cost lives on the virtual thread, off the platform-thread executor.** SHA-256 and AES-256-GCM are pure-Java JDK-intrinsic operations (no JNI, no carrier pinning, AMD-26). All crypto happens on the publishing virtual thread *before* the single-writer platform-thread INSERT, so the crypto layer never touches the AMD-27 executor pattern — the platform thread receives a fully prepared row.

**Zero-config by default (INV-CE-02).** The system must run correctly with no user setup. MVP at-rest encryption therefore roots on a **machine-local key** (no passphrase prompt), with passphrase-gated rooting as a later, opt-in hardening — see §3.5 and OQ-15-1.

---

## 2. Scope and Boundaries

### 2.1 This Subsystem Owns

- The **event-log hash chain** (computation, checkpointing, verification) and the `chain_hash` / `chain_checkpoints` schema.
- The **Ed25519 package/update signature-verification** workflow (boot-time and update-time) and the embedded public-key handling.
- The **at-rest envelope-encryption design** for event payloads: the per-scope DEK model, the canonical write-path placement, and the `payload_iv` / `dek_ref` / `scope_keys` schema.
- The **per-scope key-management infrastructure**: the root-key derivation, scope-KEK derivation, DEK wrapping, and the encryption-scope **category definitions** — shared by both event-payload encryption and the integration-secret store.
- The **crypto-shredding model** (key-destruction = data-destruction) — the *design and the schema seam* at MVP; the *operation* is scoped post-MVP (§2.3).
- The **cryptographic algorithm selections** (SHA-256 chain, Ed25519 signing, AES-256-GCM payload encryption, the KDF choice) and the constraint that JDK-intrinsic implementations are used for AES/SHA/Ed25519.

### 2.2 This Subsystem Does Not Own

- **Durable event storage / the write coordinator** — owned by Persistence (Doc 04). Crypto wraps the write path; it does not own it.
- **The `EventSerializer` / payload JSON shape** — owned by Event Model (Doc 01, AMD-52). Encryption wraps the serialized bytes; it does not change the serializer contract.
- **The integration-secret *store* surface** (`SecretStore` / `!secret` resolution / the `homesynapse secrets` CLI) — owned by Configuration (Doc 06). This doc owns the *key management beneath it* and the reconciliation with AMD-60 (§7.3), but Doc 06 owns the store API.
- **Credential *rotation* as an integration contract** (`CredentialRotator.rotate(Map)`) — owned by Integration Runtime (Doc 05, AMD-60). This doc places it in the key/secret picture and states what the M6 store must provide for it.
- **Authentication / authorization of API callers** (REST/WS auth, INV-SE-02) — owned by REST API (Doc 09). Crypto-shredding governs *erasure*, not *access control*.
- **Retention policy** — owned by Persistence (Doc 04 §3.4). This doc owns only the chain's interaction with retention (§3 / chain checkpoints survive event deletion).

### 2.3 The MVP / post-MVP line (decision D2 — moved from the research)

The research artifact drew the line at: **MVP = hash chain + Ed25519 signing**, with *all* envelope encryption + crypto-shredding deferred to "Tier 2" (schema reservations only at MVP). Decision **D2** moves that line, because the research conflated two separable things and only one is safe to defer:

| Capability | Research line | **D2 line (this doc)** | Why |
|---|---|---|---|
| SHA-256 hash chain + checkpoints + verification | **MVP** | **MVP** | <1% overhead even on Pi 4; every event tamper-evident from genesis (INV-PD-08). |
| Ed25519 package/update signing | **MVP** | **MVP** | Zero new deps; ~12 ms at boot (INV-PD-08). |
| Per-scope key-management **infrastructure** + scope-category **definitions** + forward-compatible schema | reservations only | **MVP** | M6 builds the secret store + key manager; the schema and key model must exist for it to build against. |
| **At-rest envelope encryption of sensitive-PII categories** (identity, person-linked presence) on write | Tier 2 | **MVP** | **INV-PD-03 at-rest obligation in its own right** — plaintext PII on removable storage is a live hole — *and* the now-or-never preservation of future shreddability (immutable log). Since the key infrastructure is already MVP, this is a **small increment, not new scope**. |
| **Crypto-shred *operation*** (KEK-destruction API, erasure triggers/UI) + per-category erasure feature | Tier 2 | **post-MVP** (first cloud/institutional data-sharing consumer) | **No MVP consumer**: the immutability-vs-erasure conflict it resolves is itself post-MVP — a local single-home user's "delete my data" is served by **whole-installation reset**, which needs no crypto-shredding. |
| Passphrase-gated root key (Argon2id) + DEK rotation automation + extending encryption to non-sensitive categories | Tier 2 | **post-MVP** | Threat-model-driven; arrives with off-device/cloud flows. MVP roots on a machine-local key (§3.5). |

**The one open variable** in the D2 line is *exactly which* categories are encrypted-on-write at MVP — resolved against the **Lane D Pi-4 AES-256-GCM write-path microbench** (the GraalVM/GenZGC spikes carry it): the sensitive-PII categories are encrypted by default, and a category falls back to plaintext-at-rest **only where Pi-4 write-path performance genuinely forces it, documented consciously** (OQ-15-2). This line is codified into the invariants by a minimal **INV-PD-07 amendment** (separate artifact, authored alongside this doc): it strikes only INV-PD-07's "crypto-shredding must be operational for ≥1 category at MVP" clause and is widened one line to state the INV-PD-03 at-rest posture decided here.

---

## 3. Architecture

### 3.1 The three key domains

```
INTEGRITY DOMAIN (MVP, default-on)
  └─ Keyless. SHA-256 hash chain over stored bytes. Tamper-evidence from
     chain structure, not a secret.

SIGNING DOMAIN (MVP, default-on)
  └─ Developer Ed25519 private key (offline, never on device)
  └─ 32-byte public key in the read-only system image (LTD-13)
  └─ Used only at boot + update time for package verification

ENCRYPTION DOMAIN (key infra + sensitive-PII at-rest = MVP; shred op = post-MVP)
  └─ Root Key (256-bit)
       MVP:     machine-local key file (0400), zero-config (INV-CE-02)
       Tier 2:  user passphrase → Argon2id → root key (off-device)
     └─ HKDF-SHA256(root_key, "scope:" + scope_id) → Scope KEK
        └─ Scope KEK wraps per-scope DEK (AES-256-GCM)
           └─ DEK encrypts event payloads for that scope (category)
           └─ destroying the Scope KEK ⇒ crypto-shred of that scope (post-MVP op)
```

The encryption domain serves **two consumers** under one root: (a) event-payload per-scope encryption (this doc), and (b) the integration-secret store (Doc 06 `SecretStore`) and its rotation (AMD-60 `CredentialRotator`). Unifying them under one machine-local root at MVP (§3.5, §7.3) avoids two parallel key systems.

### 3.2 Write-path integration

The crypto layer inserts between serialization and the platform-thread executor submission (Doc 04 / AMD-27), entirely on the virtual thread:

```
EventDraft → EventPublisher.publish()
  → EventSerializer.serialize(payload) → byte[]                       [VT]
  → assign global_position, subject_sequence                          [VT]
  → IF scope(event.category) is encrypted-at-rest:                    [VT, AES-256-GCM, JDK intrinsic]
        ciphertext, iv ← encrypt(DEK(scope), payload_bytes)
        stored_bytes ← ciphertext ; set payload_iv, dek_ref
     ELSE stored_bytes ← payload_bytes (plaintext JSON)
  → chain_hash ← SHA-256(prev_chain_hash ‖ canonical_metadata ‖ stored_bytes)  [VT, JDK intrinsic]
  → cache chain_hash                                                  [VT]
  → submit single INSERT(row incl. chain_hash, payload_iv?, dek_ref?) [VT → platform thread]
  → platform thread: WAL commit                                       [platform thread]
  → on success: chain_hash durable ; on failure: roll cache back      [VT]
  → notify EventBus subscribers                                       [VT]
```

All crypto is pure-Java JDK-intrinsic (no JNI, no carrier pinning) — it never interacts with the AMD-27 executor. The platform thread receives a finished row.

### 3.3 Hash chain (INV-PD-08)

`chain_hash[n] = SHA-256(chain_hash[n-1] ‖ canonical_metadata_bytes[n] ‖ stored_payload_bytes[n])`; genesis (`global_position = 1`) uses a 32-byte zero vector. Canonical metadata is **length-prefixed big-endian binary** (event_id, event_type, schema_version, ingest_time, event_time, subject_ref, subject_sequence, priority, origin, actor_ref, correlation_id, causation_id, event_category) — deterministic regardless of JSON key ordering, independent of Jackson and of `EventSerializer`. The canonical-format version is recorded in the genesis event; format changes require a new version number and dual-format verification (mitigates silent-corruption drift). `stored_payload_bytes` is whatever the `payload` column holds (plaintext or ciphertext) — the chain is format-agnostic, which is what lets encryption be per-category without forking the chain.

**Verification (three layers):** (1) **mandatory startup** verify checkpoint→head in the Doc 12 PERSISTENCE_READY phase (~10–20 ms / 10k events on Pi 5, ~50–100 ms on Pi 4); failure → `system_integrity_violation` (CRITICAL) + degraded mode (runs, integrity indicator red). (2) **periodic background** full verification genesis→head in the idle/retention window, yielding between batches. (3) **optional external anchoring** — user exports the chain-head hash to external storage to detect full-chain rewrites by an attacker with complete device access.

### 3.4 At-rest envelope encryption (INV-PD-03; MVP for sensitive-PII categories)

Encryption is **per-scope**, where a *scope* is `(data-category [× user/household for some categories])`. For each encrypted scope: a **DEK** (256-bit) encrypts that scope's event payloads with AES-256-GCM; the DEK is **wrapped** by the scope KEK (`HKDF-SHA256(root_key, "scope:"+scope_id)`); wrapped DEKs live in `scope_keys`. An encrypted event has `payload` = ciphertext, `payload_iv` = the 96-bit GCM nonce, `dek_ref` = `scope_id:key_version`. Unencrypted events in the same table have `payload` = plaintext JSON, null `payload_iv`/`dek_ref`. The stored at-rest representation is also **self-describing** via a **1-byte algorithm/version discriminator** identifying the envelope/algorithm version (`v1` = this envelope) — **distinct from `dek_ref`'s `key_version`**, which is a *key* version, never an *algorithm* version. It is emitted as an envelope prefix (recommended, chain-covered) or an additive column (final placement and version *policy* are R-γ-pending; the slot existence is not — AMD-94 §2.2/§4.1). **Nonce discipline:** counter-based deterministic 96-bit nonces per scope (stored alongside the DEK) — never random — to avoid the GCM birthday bound (random nonces collide at ~2³² per key; at 1k events/s on one scope that is ~50 days). DEK rotation (counter/time threshold) is the post-MVP automation; at MVP a scope uses one DEK with counter nonces.

**Rotate-DEK-on-restore = the restore contract (AMD-94 §2.1).** On restore of an encrypted scope from backup, the engine **rotates the scope DEK**, pinned to exactly one meaning: install an **additive new DEK version** (mint a fresh per-scope DEK, wrap it under the scope KEK, write a new `scope_keys` row at `key_version` = prior max + 1) and **retain all prior versions** — pre-restore rows stay decryptable under their original `dek_ref` `key_version`. Rotation does **not** re-encrypt existing payloads (re-encryption would mutate `stored_payload_bytes` and break `chain_hash`, §5) and does **not** replace or overwrite any prior DEK version (in-place replacement would render every pre-restore row permanently unreadable — silent data loss). It touches only the `scope_keys` table (which is **not** chain-covered) and *future* writes, so it is **chain-safe**. The restored scope resumes counter-nonce counting **from zero under the fresh DEK version**, so a (key, nonce) pair already used under a prior version can never recur — this is structural, which is why rotate-on-restore *binds* and carry-high-water-mark does not. Version monotonicity across successive or concurrent restores is enforced by the `scope_keys` PRIMARY KEY `(scope_id, key_version)` (§4.1) — two restores cannot silently collide a version. Carry-high-water-mark is retained only as a **defense-in-depth cross-check** (assert the resumed counter ≥ any carried max) — **never the sole guarantee** (alone it is the unsafe option: a stale backup can carry a counter below already-issued nonces). **Boot invariant (R-α REC-235), fail-closed, no silent resume:** the engine refuses to encrypt in a scope until it is provably safe, where the discharge depends on the recovery scenario. **After a restore, the invariant is discharged *only* by installing a fresh DEK version — rotation is the restore-completion gate.** A restore can roll the persisted counter back below an already-issued nonce while destroying the engine's evidence of the true high-water mark, so the restored counter is *not* proof of safety and the counter-comparison branch must not clear a restore. The alternative discharge — resume only when the persisted counter is **proven ≥ all prior nonces issued under the active DEK version** — is the **crash-recovery** branch, sound because the M6.3 durable, fsync-ahead-of-return counter makes the persisted max equal the true max after a crash. This closes **OR-M6-NONCE restore-half** (R-α Problem 1). It changes no shipped code — the backup/restore feature is unbuilt; this is the design contract it is built against, plus the boot invariant the app-bootstrap read/write path carries.

**Which scopes are encrypted at MVP (D2):** the **sensitive-PII categories** — identity and person-linked presence (the categories INV-PD-07 §427 names; presence/identity events `presence_signal`/`presence_changed` and any person-linked records). The *framework* encrypts these by default; the *exact category list* is tuned by the Lane D Pi-4 microbench (§2.3, OQ-15-2). Non-sensitive high-volume telemetry (e.g., generic `telemetry_summary`, device state) stays plaintext-at-rest at MVP — it is not PII under INV-PD-03 and carries the write-path cost the microbench measures.

### 3.5 Root-key source (MVP machine-local; Tier-2 passphrase)

At **MVP**, the root key is a **256-bit machine-local key** generated by `SecureRandom` on first boot and stored at `PlatformPaths.configDir()` (e.g., `/etc/homesynapse/.root-key`, POSIX `0400`) — the *same machine-local-key pattern* Doc 06 already uses for the secret store's `.secret-key` (§7.3 unifies them). This is **zero-config** (INV-CE-02): no passphrase prompt at install.

**Honest threat model for the machine-local root (stated precisely — it is easy to overclaim and must not be).** The root key lives on the **same medium** as the data it protects. So MVP at-rest encryption protects the sensitive-PII categories against exfiltration of **data copies that exclude the root-key file** (key-excluding backups of `/var/lib`, synced or copied data directories) and against runtime reads by a **process less privileged than the service user**. It does **NOT** protect against **theft of the storage medium itself** — a thief who takes the SD card / NVMe reads `.root-key` off the same medium (the `0400` permission is a runtime OS control, meaningless once the medium is mounted on the attacker's machine), derives the KEKs, and decrypts everything. It also does **not** protect against an **on-device-root adversary**. **The MVP claim is therefore "encrypted at rest and designed to be cryptographically destroyable; key-excluding copies are protected" — never "safe if your device is stolen."**

**This makes MVP a *partial* satisfaction of INV-PD-03 (F-B):** at-rest encryption — **yes**; the invariant's **"user-owned keys"** property — **no, that is Tier-2**. A machine-held key is not user-owned. **Media-theft resistance and the user-owned-key property arrive at Tier-2**, via a **passphrase-derived root** (`passphrase → Argon2id (or PBKDF2 ≥600k) → root key`, never stored on device — which also makes passphrase loss an intentional crypto-shred), **or** a **TPM-sealed root** on TPM-equipped hardware. Note the positioning fact (not a gap to paper over): the only *zero-config* way to get media-theft protection is a TPM, which the **Pi-5 has but the Pi-4 validation floor does not**; and a passphrase breaks zero-config — so media-theft + user-owned-key resistance is *genuinely* a Tier-2 property, not an MVP omission. The schema and key hierarchy are identical across MVP and Tier-2; only the *root-key acquisition* changes, so the upgrade is non-breaking (OQ-15-1, OQ-15-3). The now-or-never reason to encrypt sensitive-PII on write at MVP — preserving future shreddability on the immutable log — is **independent of the root-key source**, so the machine-local MVP root is the right call regardless.

### 3.6 Crypto-shredding (INV-PD-07; design MVP, operation post-MVP)

Crypto-shredding = destroy a scope's KEK (and its wrapped DEKs in `scope_keys`, setting `destroyed_at`) → that scope's ciphertext is permanently unreadable, while the chain hashes (over stored bytes) stay valid and every other scope survives. **At MVP the design + the schema seam exist** (the `scope_keys` table, the per-scope key model, the encrypted sensitive-PII corpus) so the operation is a clean later-add. **The operation itself — the KEK-destruction API, the retention/deletion triggers, and any user-facing erasure UI — is post-MVP** (D2): a local single-home MVP has no consumer for per-category erasure (whole-install reset suffices), and the immutability-vs-erasure tension only bites when there is a reason to *retain* the log after erasure (institutional audit) or data has left the device (cloud). It activates with the first cloud/institutional data-sharing product — and because the sensitive-PII corpus is **already written encrypted-per-scope from MVP**, that activation shreds the *historical* corpus too, with zero migration.

### 3.7 Ed25519 package signing (INV-PD-08; MVP)

Debian/APT manifest-signing model: build-time (offline) hash all files into `MANIFEST.sha256`, sign with the developer Ed25519 private key; device-time (boot + update) load the 32-byte public key from the read-only image, verify `manifest.sig` then each file hash; failure → reject + `system_package_rejected` (CRITICAL). Key rotation: successor public key shipped in an update signed by the current key; 1–2 emergency backup successors embedded in the initial image. JDK built-in `Signature.getInstance("Ed25519")` (JEP 339, constant-time) — zero new dependencies.

### 3.8 Module placement

No new module. Chain computation/verification lives **internal to persistence** (`com.homesynapse.persistence`), reached through the existing `EventStore` (gains `getChainHead()`) and a new `IntegrityService` (observability) for status. Ed25519 verification is a **lifecycle** boot/update task reading the public key from `PlatformPaths`.

**Key-manager placement — JPMS-cycle resolution (m3).** The key manager (root key, scope KEK/DEK derivation, wrap/unwrap, `scope_keys`) is key-management and therefore belongs with **configuration** (`com.homesynapse.config`, M6) — but the *encryptor of event payloads* is **persistence**, which must not statically depend on config (verified at HEAD: persistence does **not** `requires com.homesynapse.config`; config `requires transitive com.homesynapse.event` only — a new persistence→config edge plus any future config→persistence need would risk the **same cycle class as the AMD-52 `event↔device` cycle that forced the value-model relocation**). The resolution is the **AMD-45 `AtomicCheckpointSink` seam pattern**: a narrow **`PayloadCipher` interface is *consumer-defined in persistence*** (`encrypt(scopeId, plaintext) → (ciphertext, iv)` / `decrypt(scopeId, keyVersion, ciphertext, iv) → plaintext`), the config-resident key manager (`ScopeKeyManager`) **exposes its own `encrypt`/`decrypt` surface but does *not* implement the persistence-exported `PayloadCipher` type directly** — implementing it in `config` would force a `config → persistence` edge. Instead the **top-level composition root `com.homesynapse.app`** (`Main`) constructs `ScopeKeyManager`, wraps it in a thin `PayloadCipher` adapter (a lambda over `encrypt`/`decrypt`), and **injects that adapter down through `HomeSynapseCore` (lifecycle) into the persistence write path**. `app` is the correct host because it is the **only** module that already `requires` **both** `com.homesynapse.config` **and** `com.homesynapse.persistence` (verified at HEAD: `app/homesynapse-app/src/main/java/module-info.java` `requires com.homesynapse.config` *and* `requires com.homesynapse.persistence`; `lifecycle` requires `persistence` but **not** `config`), so the bridge adds **no** new module edge; hosting it in `lifecycle`/`HomeSynapseCore` would force a new `lifecycle → config` edge. The `scope_keys` store is owned on the **config/key-manager** side (mirroring the secret store's own `secrets.enc` file). **Net JPMS result: `persistence` does not `requires` `config`, `config` does not `requires` `persistence`, and only `app` `requires` both — which it already does at HEAD — so the cycle is closed in *both* directions with zero new edges** (the AMD-45 `AtomicCheckpointSink` injection-at-the-composition-root discipline, applied to a config-supplied implementation). The verbatim `module-info.java` for persistence and config **must be embedded in the M6 coding instruction** (the standing Research-6 rule) before any code is written, and the no-cycle property re-verified at issue.

The MVP path adds **zero new dependencies** (SHA-256/AES-GCM/Ed25519 are JDK-intrinsic); the Tier-2 passphrase KDF may add Bouncy Castle for Argon2id, or take the zero-dependency PBKDF2 path (OQ-15-3).

---

## 4. Data Model

### 4.1 Event-store schema (MVP)

```sql
-- events table: chain_hash ALREADY EXISTS in V001 (AMD-37) — Doc 15 activates it.
chain_hash   BLOB(32) NOT NULL DEFAULT x'00..00',  -- AMD-37: V001, zero-hash default; this doc computes real hashes
-- events table additions (MVP — at-rest encryption of sensitive-PII scopes; new columns)
payload_iv   BLOB(12),            -- AES-256-GCM nonce; NULL when the scope is unencrypted
dek_ref      TEXT,                -- "scope_id:key_version"; NULL when unencrypted

-- chain checkpoints (MVP)
CREATE TABLE chain_checkpoints (
    checkpoint_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    event_position  INTEGER NOT NULL,    -- global_position of the checkpointed event
    chain_hash      BLOB(32) NOT NULL,   -- chain_hash value at that position
    created_at      INTEGER NOT NULL,    -- Unix microseconds
    UNIQUE(event_position)
);

-- per-scope key store (MVP — written for encrypted sensitive-PII scopes; destroyed_at consumed post-MVP)
CREATE TABLE scope_keys (
    scope_id        TEXT    NOT NULL,    -- data category (× user/household where applicable)
    key_version     INTEGER NOT NULL,
    encrypted_dek   BLOB    NOT NULL,    -- scope DEK wrapped by the scope KEK (AES-256-GCM)
    iv              BLOB(12) NOT NULL,
    created_at      INTEGER NOT NULL,
    destroyed_at    INTEGER,             -- NULL until crypto-shredded (the post-MVP operation sets it)
    PRIMARY KEY (scope_id, key_version)
);
```

**`chain_hash` is not new — AMD-37 already reserved it (m1).** It exists in `V001__initial_event_store_schema.sql` as `BLOB(32) NOT NULL DEFAULT x'00…00'`, and `SqliteEventStore` currently binds the `ZERO_HASH` constant for it (`SqliteEventStore.java:353`, "chain_hash (AMD-37)"). AMD-37 ("Chain Hash NOT NULL with Zero-Hash Default") created the NOT-NULL-with-zero-default precisely so that **chain activation requires no full-table backfill** — every pre-activation row already carries the zero-hash (a known, deterministic value), and AMD-37 explicitly anticipates "the crypto milestone activates chaining." **Doc 15 is that activation:** it replaces the `ZERO_HASH` bind with real single-writer chain computation (§3.3). For a fresh MVP install the chain is real from genesis; for an upgrade over a pre-activation log, AMD-37's zero-hash default means activation starts a clean chain epoch from the activation point without a blocking backfill (the pre-activation epoch break is AMD-37 §22's documented, accepted tradeoff). *Currency note:* Doc 01 §14/§4.2 still say hash-chaining "is not implemented… a `log_hash` column can be added" — stale against AMD-37 and this doc; flag for a Doc 01 currency fix.

The `payload_iv` / `dek_ref` columns and the `scope_keys` table **are** new and **differ from the research**, which placed them behind a *future* Tier-2 migration. Under D2 they are **MVP schema** (the sensitive-PII categories are encrypted-on-write from launch), populated for those scopes from day one. `payload` is declared `TEXT` but holds ciphertext bytes for encrypted scopes (SQLite dynamic typing handles this). The chain covers `payload` as stored either way.

**Envelope version discriminator (AMD-94 — reserved; `v1` = current).** Every encrypted at-rest row carries a 1-byte algorithm/version discriminator, reserved from the first encrypted write so the AEAD can evolve without rewriting the immutable, hash-chained corpus. Final placement is R-γ-pending: either (a) a **1-byte prefix on the stored `payload` envelope** — chain-covered (the chain covers `payload`), the **recommended** encoding — or (b) a new additive `envelope_version` column (`INTEGER`/`BLOB(1)`, `ALTER TABLE ADD COLUMN`, backfill-free per LTD-07 forward-only and the AMD-37 additive-no-backfill precedent, **not** chain-covered today — like `payload_iv`/`dek_ref`, only the canonical metadata + `payload` are chained, §3.3). The discriminator is **distinct from `dek_ref`'s `key_version`** (a *key* version). **No migration ships with AMD-94** — the corpus is empty until the first encrypted write at app-bootstrap AB-4, which emits `v1`; the version *policy* (registry, downgrade rules, AAD binding) is R-γ-pending.

### 4.2 Key hierarchy (in-memory + at-rest)

| Element | At rest | In memory | Lifetime |
|---|---|---|---|
| Root key | MVP: `.root-key` file (0400). Tier 2: not stored (derived from passphrase). | 256-bit, process lifetime | Per install |
| Scope KEK | Not stored directly — re-derived `HKDF(root, "scope:"+id)` on demand | Cached per active scope | Per scope; destroyed at shred (post-MVP) |
| Scope DEK | `scope_keys.encrypted_dek` (wrapped by KEK) | Cached per active scope | Per scope/version; rotated (post-MVP) |
| Chain head | `chain_hash` of the latest event + latest `chain_checkpoints` row | `previous_chain_hash` on the single-writer thread (rollback-guarded) | Per process; re-init from DB on boot |

### 4.3 Package manifest

`MANIFEST.sha256` (one SHA-256 per update file) + `manifest.sig` (Ed25519 over the manifest); the 32-byte public key embedded in the read-only image at a `PlatformPaths`-resolved path.

---

## 5. Contracts and Invariants

**The chain covers stored bytes, so integrity is independent of encryption and of shredding.** Any mutation of a persisted event's metadata or stored payload breaks `chain_hash[n]` and every subsequent hash. Encrypting a scope, or later destroying its key, does not alter any stored bytes and therefore does not invalidate any chain hash.

**Every event is chained from genesis (INV-PD-08).** `chain_hash` is `NOT NULL` and computed for every event in `global_position` order on the single writer; genesis uses the zero vector. There is no unchained event.

**Sensitive-PII categories are written encrypted-at-rest under per-scope DEKs from MVP (INV-PD-03).** For the categories in the encrypted set, `payload` is ciphertext and `payload_iv`/`dek_ref` are populated at write time. This is the irreversible contract — it cannot be retrofitted onto already-written plaintext (the log is immutable).

**Crypto-shred destroys exactly one scope (INV-PD-07).** Destroying a scope KEK renders that scope's events permanently unreadable and leaves every other scope and the entire chain valid and verifiable. (Operation post-MVP; the contract and the schema seam are MVP.)

**Root-key loss is data loss, by design.** Without the root key (MVP file, or Tier-2 passphrase), encrypted scopes are irrecoverable. Chain verification and package-signature verification remain fully functional (independent domains).

**Crypto runs off the platform-thread executor.** No crypto operation occupies a carrier thread via JNI (AMD-26); all of it is JDK-intrinsic pure-Java on the publishing virtual thread, before the single-writer INSERT.

**Package verification is mandatory and fail-closed.** An update with a missing/invalid manifest signature or any file-hash mismatch is rejected before application (INV-PD-08, LTD-14).

**The integration-secret store and event-payload encryption share one root (§7.3).** There is one key-management root per install; the secret store and per-scope payload encryption do not maintain independent root keys.

**Rotate-on-restore prevents cross-restore nonce reuse (AMD-94).** A scope resumes encryption after restore only under a freshly-installed **additive** DEK version; priors are retained and never replaced, payloads are never re-encrypted. A restored scope therefore never resumes counting under an already-used DEK version, so (key, nonce) reuse is structurally impossible across restore. The boot invariant is **fail-closed**: after a restore it is discharged only by installing a fresh DEK version (rotation is the restore-completion gate, because a restore can roll the persisted counter back below a used nonce and erase the true-high-water evidence); resuming on a counter proven ≥ all prior nonces is the **crash-recovery** branch, sound because the M6.3 counter is durable across crash.

**Every encrypted at-rest row is self-describing via a 1-byte version discriminator (AMD-94).** `v1` = the §3.4 envelope (AES-256-GCM, counter nonce, per-scope DEK), distinct from `dek_ref`'s key version; emitted as an envelope prefix (recommended, chain-covered) or an additive column (final placement R-γ-pending). The slot exists from the first encrypted write so the AEAD can evolve without rewriting the immutable, chain-covered corpus; the version *policy* is R-γ-pending.

---

## 6. Failure Modes and Recovery

| Failure | Trigger | Impact | Recovery | Event |
|---|---|---|---|---|
| Startup chain mismatch | checkpoint→head verification fails at boot | Integrity indicator RED; system runs degraded | Operator investigates; external anchor (if any) localizes the break | `system_integrity_violation` (CRITICAL) |
| Single-writer crash mid-write | writer dies after computing `chain_hash` before WAL commit | Cached head could be ahead of durable head | **Rollback guard:** on tx failure reset cache to last committed hash; on boot always re-init cache from DB, never from in-memory state | — |
| Canonical-format drift | two versions serialize metadata differently | Chain would break irreversibly | Format version recorded in genesis; canonical serializer is a single fully-specified static method; format change ⇒ new version + dual-format verification | — |
| Root-key file missing/unreadable | `.root-key` absent or wrong perms (MVP) | Encrypted scopes cannot be read; secret store cannot resolve | Fail-closed with a diagnostic naming the path + required perms (INV-HO-04); no silent plaintext fallback | `system_root_key_unavailable` (CRITICAL) |
| Root-key loss | file destroyed (MVP) / passphrase forgotten (Tier 2) | Encrypted data irrecoverable (by design) | Optional encrypted root-key backup to external storage at setup; chain + signatures unaffected | — |
| GCM nonce exhaustion | a scope DEK approaches 2³² uses | Nonce-reuse risk | Counter-based nonces + DEK rotation before threshold (rotation = post-MVP; MVP scopes are low-volume sensitive-PII, far from the bound) | — |
| **Counter-nonce reuse across crash/restore — [RESOLVED: crash-half M6.3 durable counter; restore-half AMD-94 rotate-on-restore]** | the per-scope nonce counter repeats after a crash, **or** a restored backup reintroduces a counter value already used under the same DEK | **Catastrophic:** (key, nonce) reuse breaks AES-GCM confidentiality *and* authentication for that scope | **Crash-half (M6.3, discharged):** the per-scope counter is durable and strictly monotonic across crash — persist the counter high-water mark atomically with (or ahead of) the encrypted write; on boot re-init from the persisted max, never from memory. **Restore-half (AMD-94 §2.1, the binding contract):** on restore, **rotate the DEK — install an additive new DEK version and retain priors**, so a restored scope never resumes under a DEK version whose nonce space was already used; carrying the high-water mark in the backup is a defense-in-depth **cross-check** only (assert resumed counter ≥ carried max), never the sole guarantee. The **boot invariant** makes this enforceable: **after a restore the scope refuses to encrypt until a fresh DEK version is installed** (rotation is the restore-completion gate — a restore can roll the counter back below a used nonce and erase the true-high-water evidence, so the restored counter is not proof of safety); the resume-when-counter-proven-≥-all-priors branch is the crash-recovery path (sound because the M6.3 durable counter makes the persisted max the true max after a crash). Closes **OR-M6-NONCE restore-half**. **Corollary to F-A:** "key-excluding backups are protected" holds only if the backup excludes (or separately wraps) the root key — a backup carrying ciphertext + counter state but *not* the key is safe; one carrying the key is not. | — |
| Package signature invalid | tampered/corrupt update | Update rejected, not applied | Fail-closed; operator re-fetches a valid package | `system_package_rejected` (CRITICAL) |
| JDK intrinsics inactive | a build disables ARM crypto intrinsics | Slower crypto (not incorrect) | Startup benchmark logs a warning; diagnostic only, not a gate | startup log |

---

## 7. Interaction with Other Subsystems

| Subsystem | Direction | Mechanism | Data / contract |
|---|---|---|---|
| Persistence (Doc 04) | this ↔ | internal to persistence write path | chain computation + envelope encryption between serialize and INSERT; `EventStore.getChainHead()` |
| Event Model (Doc 01) | consumes | reads serialized bytes + metadata | canonical metadata fields for the chain; AMD-52 typed payload is the plaintext input to encryption |
| Startup/Lifecycle (Doc 12) | called by | PERSISTENCE_READY phase task; update step | mandatory chain verify before bus dispatch; Ed25519 verify before update |
| Observability (Doc 11/M12) | exposes to | `IntegrityService` + HealthContributor | verification status, last-verified position, integrity health state |
| Configuration (Doc 06 / M6) | shares with | shared key-management root; secret store | §7.3 |
| Integration Runtime (Doc 05 / AMD-60) | supports | `CredentialRotator` writes through the secret store | §7.3 |

### 7.3 Reconciliation with Doc 06 (`SecretStore`) and AMD-60 (`CredentialRotator`)

The foundation-readiness assessment flagged Doc 06's `SecretStore` as **stale against the ratified AMD-60** and **narrower than INV-PD-07 needs**. This doc reconciles both:

- **Shared root, not two key systems.** Doc 06's secret store currently roots on its own `.secret-key` (single static AES-256-GCM key). Under this design the secret store and the event-payload per-scope encryption share **one machine-local root key** (§3.5) at MVP. The secret store becomes one *scope* in the key hierarchy (`scope_id = "config_secrets"`), so the per-scope/crypto-shred model and the secret store are the same machinery — exactly what M6 builds. (The existing `.secret-key` design is the seed of this; M6 generalizes it to the per-scope root.)
- **`SecretStore` needs an atomic multi-key durable write for AMD-60.** AMD-60's `CredentialRotator.rotate(Map<String,String>)` is **atomic-across-entries and durable-before-return** (AMD-60-INV-03 — a token+refresh-token pair can never be torn). Doc 06 §8.5 today exposes only single-key `set(key,value)`. **M6 must add an all-or-nothing multi-key write** (e.g., `setAll(Map)` / a transactional store write) beneath the rotator; the M9 `CredentialRotator` impl calls it. This doc owns the requirement; Doc 06/M6 owns the store API change (a Doc 06 currency amendment, AMD-66–71 scope).
- **`CredentialRotator` is the integration-secret rotation path, distinct from event-payload shred.** Rotating a credential overwrites a secret value (the old credential is gone once the store write commits); crypto-shredding destroys a *scope key* to render an *event-log scope* unreadable. Both consume the shared key-management root; they are different operations on it.

---

## 8. Key Interfaces

### 8.1 Interfaces

| Interface | Responsibility | Module |
|---|---|---|
| `ChainHashComputer` (internal) | Compute `chain_hash` on the VT before INSERT; cache head; rollback guard | persistence |
| `ChainVerifier` (internal) | Checkpoint→head and genesis→head verification | persistence |
| `IntegrityService` | Expose verification status / chain head to observability | observability |
| `PayloadCipher` (seam) | **Consumer-defined interface in persistence**: `encrypt(scopeId, plaintext)→(ct,iv)` / `decrypt(...)`. Injected at the composition root (AMD-45 pattern); persistence gains no config dependency (m3, §3.8) | persistence (iface) |
| `ScopeKeyManager` (internal) | Derive scope KEK, wrap/unwrap DEK, own `scope_keys`, **expose an `encrypt`/`decrypt` surface adapted to `PayloadCipher` at the `app` composition root (§3.8) — does NOT implement the persistence-exported `PayloadCipher` type directly** (implementing it in `config` would force a `config → persistence` edge), (post-MVP) destroy KEK | **config (key manager); the `PayloadCipher` adapter lives in `app`** (AMD-94 currency fix — aligns §8.1 with the AMD-86-E2-folded §3.8) |
| `PackageVerifier` (internal) | Ed25519 manifest + file-hash verification at boot/update | lifecycle |
| `EventStore.getChainHead()` | Expose current chain head | persistence (existing iface, +1 method) |

### 8.2 Key types

| Type | Kind | Responsibility |
|---|---|---|
| `ChainCheckpoint` | record | `(eventPosition, chainHash, createdAt)` |
| `ScopeKey` | record | `(scopeId, keyVersion, encryptedDek, iv, createdAt, destroyedAt?)` |
| `EncryptionScope` | enum/registry | the encryption-scope category definitions (which categories are encrypted) |
| `IntegrityStatus` | record/enum | verification state for health/observability |

Phase-2 expands these to full signatures. Per the **contract-freeze-readiness gate**, no contract here is frozen until it (a) round-trips / is enforceable with a test and (b) is owned by this doc — e.g., `ScopeKeyManager` ships with an encrypt→shred→unreadable round-trip test before M6/M9 build on it (the AMD-65 lesson: do not freeze a contract that cannot be exercised).

---

## 9. Configuration

```yaml
crypto:
  chain:
    enabled: true                  # INV-PD-08; default-on, not user-disablable in v1
    checkpoint_interval_events: 10000
    startup_verification: true     # checkpoint->head at boot (mandatory)
    background_verification: true  # genesis->head in idle window
  encryption:
    at_rest_enabled: true          # INV-PD-03 for sensitive-PII scopes
    root_key_source: machine_local # MVP: machine_local | (Tier 2: passphrase)
    encrypted_scopes:              # the MVP encrypted set (tuned by the Pi-4 microbench, OQ-15-2)
      - identity
      - presence_personal
  signing:
    verify_packages: true          # INV-PD-08; mandatory, fail-closed
    public_key_path: "${config_dir}/signing-key.pub"
```

Every option has a safe default; the system runs zero-config (machine-local root, default-on chain + signing). `root_key_source: passphrase` and per-scope rotation knobs arrive Tier 2.

---

## 10. Performance Targets (Raspberry Pi 4 — the constraint floor)

| Metric | Target | Rationale |
|---|---|---|
| Chain-hash per event (Pi 4 / Pi 5) | ~5–10 µs / ~0.7–1.0 µs | <0.1% of a core at 1k ev/s; chain is effectively free |
| AES-256-GCM encrypt per sensitive event (Pi 4 / Pi 5) | ~30–60 µs / ~3–6 µs | the microbench (OQ-15-2) sets the encrypted-scope boundary; Pi 4 has no ARM crypto extensions |
| Startup verify (checkpoint→head, 10k events) | <100 ms (Pi 4) | within the Doc 12 startup budget with margin |
| Ed25519 verify (50 packages at boot) | <100 ms (Pi 5) | ~12 ms typical; negligible |
| Storage overhead (`chain_hash` 32 B/event) | 6–16% of a 200–500 B payload | within Doc 04 §3.5 budgets |
| Pi 4 sustained with encryption on sensitive scopes | ≥500 ev/s | sensitive-PII is low-volume; bulk telemetry stays plaintext at MVP |

A startup SHA-256 micro-benchmark logs whether ARM crypto intrinsics are active (diagnostic, not a gate).

---

## 11. Observability

**11.1 Metrics:** `crypto.chain.verify.duration` (histogram, label `scope=startup|background`), `crypto.chain.head.position` (gauge), `crypto.encryption.events.encrypted` / `.plaintext` (counters, label `category`), `crypto.encryption.encrypt.duration` (histogram), `crypto.signing.package.verify` (counter, label `result`).

**11.2 Structured logging:** `system_integrity_violation` (position, expected vs actual head), `system_package_rejected` (file, reason), `system_root_key_unavailable` (path, perms), intrinsics-activation status at boot.

**11.3 Health indicator:** `IntegrityService` reports GREEN (verified to head), YELLOW (background verification lagging), RED (`system_integrity_violation` or root key unavailable). Feeds the system health API and the observability UI; the user-facing integrity dashboard is a Tier-3 future item.

---

## 12. Security Considerations

This subsystem **is** the security surface for data-at-rest and log integrity. Trust boundaries: the Ed25519 private key never touches the device; the public key is in the read-only image; the MVP root key is readable only by the service user at runtime (file `0400`) — **but it sits on the same medium as the data** (see below). Input validation: package manifests are verified fail-closed; chain verification is fail-closed into degraded mode.

**Honest MVP threat-model statement (must be carried verbatim into the trust-brand claims — it is easy to overclaim and must not be):** MVP at-rest encryption protects the sensitive-PII categories against exfiltration of **data copies that exclude the root-key file** (key-excluding backups, synced/copied data directories) and against runtime reads by a **process less privileged than the service user**. It does **NOT** protect against **theft of the storage medium itself** — the root key travels with the medium (the `0400` permission is meaningless once the card/NVMe is mounted on the attacker's machine) — nor against an **on-device-root adversary**. **Media-theft resistance and INV-PD-03's "user-owned keys" property are a Tier-2 property** (passphrase-derived root, never stored; or a TPM-sealed root on TPM-equipped hardware — the Pi-4 validation floor has no TPM). MVP is therefore a **partial** INV-PD-03 satisfaction (at-rest: yes; user-owned keys: Tier-2). **The MVP claim is "encrypted at rest and designed to be cryptographically destroyable; key-excluding copies are protected" — never "safe if your device is stolen."** And because the crypto-shred *operation* is post-MVP, the erasure language must say "your most sensitive data is encrypted at rest and is *designed to be* cryptographically destroyable," not "you can erase it today," until the operation ships.

---

## 13. Testing Strategy

**13.1 Unit:** canonical-metadata serializer determinism (byte-exact across key orderings); chain hash genesis + linkage; rollback-guard on simulated tx failure; AES-256-GCM encrypt/decrypt round-trip per scope; counter-nonce monotonicity; Ed25519 verify accept/reject; HKDF scope-KEK derivation determinism.

**13.2 Integration:** write-path encryption for a sensitive scope end-to-end (publish → ciphertext + iv + dek_ref persisted → read-back decrypts); chain verification over a mixed encrypted/plaintext corpus; startup checkpoint→head; chain validity *after* a simulated scope-key destruction (the post-MVP op, tested at design time) — encrypted scope unreadable, all other scopes + chain still verify.

**13.3 Performance:** the Pi-4 AES-256-GCM write-path microbench (Lane D) that sets the encrypted-scope boundary; chain-overhead vs unchained baseline (<5% Pi 5); checkpoint→head and genesis→head verification timing (research spike criteria C6/C7/C8).

**13.4 Failure:** corrupt a persisted byte → verification flags the exact position; missing root key → fail-closed `system_root_key_unavailable`; tampered manifest → `system_package_rejected`; crash mid-write → cache re-init from DB yields a consistent head; **counter-nonce durability + restore safety (m2, AMD-94) — kill mid-encrypt then restart and assert the per-scope nonce counter never repeats (high-water mark survives the crash); and assert a restore installs an *additive* new DEK version with priors retained (pre-restore rows still decrypt under their original `dek_ref` `key_version`), the restored scope resumes only under the fresh version so no (key, nonce) pair recurs under any version (kill-mid-write then restore-from-backup → no repeat), the boot invariant refuses to encrypt after a restore until a fresh DEK version is installed (and on crash-recovery until the persisted counter is proven ≥ all priors), a stale carried high-water mark alone never permits a resume rotation would forbid (cross-check augments, never replaces), and every encrypted envelope round-trips its 1-byte `v1` discriminator** (the m2 hazard — crash-half resolved by M6.3, restore-half by AMD-94).

---

## 14. Future Considerations

**Passphrase-gated root key + Argon2id (Tier 2).** Upgrades the threat model to off-device key material; schema unchanged. **DEK rotation automation (Tier 2).** Counter/time-threshold rotation for high-volume encrypted scopes. **Crypto-shred operation (post-MVP, first cloud/institutional consumer).** KEK-destruction API + retention/deletion triggers + erasure UI — activates on the already-encrypted MVP corpus with zero migration. **Transparency-log extension (Tier 3, INV-PD-08 §16.5 phases 2–4).** Automation-execution + data-access auditing + cloud-operation verification over the already-tamper-evident log; Merkle-tree verifiable transparency (the strategy's named first-mover horizon). **Extending encryption to additional categories.** Bulk telemetry/state encryption if a future threat model or buyer requires it (cost set by the Pi-4 microbench).

---

## 15. Open Questions

1. **MVP root-key source — RESOLVED: machine-local key file** (endorsed 2026-06-06, with the corrected bar). Zero-config (INV-CE-02), matches Doc 06. **Corrected threat bar (F-A):** machine-local protects **key-excluding data copies** (backups/syncs that omit the key file) + reads by a less-privileged process; it does **NOT** protect against theft of the storage medium (the key travels with it) or on-device root. Media-theft + user-owned-key resistance is **genuinely Tier-2**, because the only zero-config way to get media-theft protection is a **TPM** (Pi-5 has one; the **Pi-4 validation floor does not**), and a passphrase breaks zero-config — a real positioning fact, not a gap. Status: **RESOLVED** for the design. Residual: the key-file generation/permission/rotation handling is an **M6 implementation detail** (not an open design question).
2. **The exact encrypted-scope set at MVP.** Identity + person-linked presence are in by default; the precise category-by-category list is tuned by the **Lane D Pi-4 AES-256-GCM write-path microbench**, with a category falling back to plaintext-at-rest only where Pi-4 perf forces it. Needed: the microbench numbers. Status: **[NON-BLOCKING]** — the framework and the default are decided; the list is a tuning of it.
3. **Tier-2 KDF — Bouncy Castle (Argon2id) vs zero-dependency (PBKDF2 ≥600k + manual HKDF).** Defer to Tier-2 start (research OPEN-02); MVP is zero-dependency regardless. Status: **[NON-BLOCKING]**.
4. **Pi-4 cipher — AES-256-GCM vs ChaCha20-Poly1305.** Defer to Tier-2 / when bulk encryption ships (research OPEN-03); benchmark on Pi-4 empirically. Status: **[NON-BLOCKING]**.
5. **`chain_hash` schema placement — RESOLVED (was research OPEN-01).** Moot: `chain_hash` is already `V001` `BLOB(32) NOT NULL DEFAULT x'00…00'` per **AMD-37**, bound to `ZERO_HASH` in `SqliteEventStore`. Doc 15 activates it (real chain computation); no new migration, no backfill. Status: **RESOLVED** (the remaining work is activation, not schema). *Side item:* Doc 01 §14/§4.2 currency fix (still says "not implemented / `log_hash` can be added").

---

## 16. Summary of Key Decisions

| Decision | Choice | Rationale | Section |
|---|---|---|---|
| Integrity mechanism | Keyless SHA-256 chain over **stored bytes** | Tamper-evidence independent of encryption + shredding; <1% overhead | §1, §3.3 |
| At-rest mechanism | **App-level per-scope payload encryption** (NOT SQLCipher whole-DB) | Per-scope is the *only* mechanism that supports per-category crypto-shred (INV-PD-07) | §1, §3.4 |
| MVP/post-MVP line (D2) | Encrypt sensitive-PII at-rest **from MVP**; defer only the **shred operation** | INV-PD-03 is a live at-rest obligation; encrypt-on-write is now-or-never on an immutable log; the shred op has no MVP consumer | §2.3 |
| MVP root-key source | **Machine-local key file** (0400); passphrase/TPM-gated = Tier 2 | Zero-config (INV-CE-02), matches Doc 06. **Partial INV-PD-03** (at-rest yes; user-owned-keys + media-theft resistance = Tier-2) — protects key-excluding copies + less-privileged reads, **not** medium theft (key travels with the medium) | §3.5, §12, OQ-15-1 |
| Chain activation (m1) | **Activate** AMD-37's reserved `chain_hash` (V001, NOT NULL, zero-hash default) | Column already exists + zero-hash default ⇒ no backfill; AMD-37 named this the activation trigger | §3.3, §4.1 |
| Key-manager seam (m3) | `PayloadCipher` **consumer-defined in persistence**, impl in config, injected at composition root (AMD-45 pattern) | Avoids a persistence↔config JPMS cycle (the AMD-52 `event↔device` lesson) | §3.8, §8.1 |
| Counter-nonce safety (m2) | Crash-half: per-scope counter **durable + monotonic across crash** (M6.3); restore-half: **rotate-DEK-on-restore** = additive new DEK version, retain priors (AMD-94 §2.1) | (key, nonce) reuse is catastrophic for AES-GCM; **RESOLVED** — crash-half M6.3, restore-half AMD-94 → OR-M6-NONCE CLOSED | §3.4, §6, §13.4 |
| Encrypted-scope boundary | Sensitive-PII categories by default; exact list tuned by **Pi-4 microbench** | Balance INV-PD-03 coverage against Pi-4 write-path cost, consciously | §3.4, OQ-15-2 |
| Key-management unification | Secret store + event-payload encryption share **one root**; secret store is a scope | Avoids two parallel key systems; M6 builds one manager | §3.1, §7.3 |
| Doc 06 / AMD-60 reconciliation | `SecretStore` gains an **atomic multi-key durable write** beneath `CredentialRotator.rotate(Map)` | AMD-60-INV-03 atomicity; a token pair can't be torn | §7.3 |
| Crypto cost placement | On the **virtual thread**, before the platform-thread INSERT | JDK-intrinsic, no JNI/carrier pinning (AMD-26/27) | §1, §3.2 |
| Package integrity | Ed25519 manifest signing, **MVP, fail-closed** | Zero deps; ~12 ms boot; INV-PD-08 / LTD-14 | §3.7 |
| Dependencies | **Zero new at MVP**; Tier-2 KDF may add Bouncy Castle | SHA/AES/Ed25519 are JDK-intrinsic | §3.8, OQ-15-3 |
| Module placement | Internal to persistence + lifecycle + config; **no new module** | Crypto is a write-path/boot concern, not a public subsystem | §3.8 |
| Restore nonce safety (AMD-94) | Rotate-DEK-on-restore = additive new DEK version, retain priors; high-water-mark = cross-check; fail-closed boot invariant (restore ⇒ install fresh DEK version; crash ⇒ resume when counter proven ≥ all priors) | Prevents cross-restore (key,nonce) reuse without re-encrypting the immutable log; closes OR-M6-NONCE restore-half | §3.4, §6 |
| Envelope agility (AMD-94) | Reserve a 1-byte version discriminator, `v1` = current envelope (encoding + version *policy* R-γ-pending) | Ciphertext outlives algorithms; the slot is now-or-never on an immutable hash-chained log; the algorithm choice stays deferred to Tier-2 | §3.4, §4.1, §5 |

> **Provenance / supersession.** This document supersedes the research artifact `research/2026-03-22_Unified_Cryptographic_Architecture_for_HomeSynapse.md` as the owner of the cryptographic architecture. The principal change from the research is the **D2 MVP/post-MVP line** (§2.3): the research deferred *all* envelope encryption to Tier 2; this doc encrypts sensitive-PII at-rest from MVP (INV-PD-03 + future-shreddability) and defers only the crypto-shred *operation*. Codified by the minimal INV-PD-07 amendment authored alongside this doc. **Status: Draft** — pending full DOCS-Project review (it narrows a constitutional privacy invariant; not the P4 lightweight track). OQ-15-1 is [BLOCKING] for the M6 key-manager implementation, [NON-BLOCKING] for locking this design.

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It is governed by the Design Document Template and will be reviewed during architecture review.*
