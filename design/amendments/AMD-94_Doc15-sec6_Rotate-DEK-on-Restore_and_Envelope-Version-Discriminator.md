<!--
file: design/amendments/AMD-94_Doc15-sec6_Rotate-DEK-on-Restore_and_Envelope-Version-Discriminator.md
purpose: AMD-94 — Doc 15 (Cryptographic Architecture) currency/forward-compat amendment implementing decision A4 (RULED 2026-06-18): (1) bind rotate-DEK-on-restore as the restore contract (additive new DEK version, retain priors; high-water-mark demoted to a defense-in-depth cross-check; the refuse-to-encrypt-until-safe boot invariant) — closing the OR-M6-NONCE restore-half; (2) reserve a 1-byte algorithm/version discriminator in the at-rest AEAD envelope (v1 = the current envelope) before the first encrypted write at app-bootstrap AB-4. NOT a redesign. Doc 15 is LOCKED — this AMD is the sanctioned re-open -> DOCS review -> ratify vehicle; no silent edit. Authored PROPOSED; Nick ratifies after the full independent DOCS-Project review.
audience: Nick (ratify), PM, independent DOCS-Project reviewer, the app-bootstrap AB-2/AB-4 coding sessions, the future backup/restore WU
status: PROPOSED 2026-06-19 — authored by the Cowork PM (nexsys-project-manager). Full independent DOCS-Project review pending (persisted shape + crypto behavioral contract + new invariants -> full per-AMD track, NOT a shared block; constraint-enforcement §6). NOT ratified; the §2.4 staged Doc-15 edits are NOT folded into the Locked doc until ratification; watermark stays AMD-93 until then.
source: decision A4 (context/decisions/2026-06-18_app-bootstrap-and-superiority-scope_decisions.md) + its binding process caveat (Doc 15 is Locked -> formal AMD pipeline, watermark bump at ratification, no silent edit). Technical pins: Track-3 red-team reversibility audit (context/audits/2026-06-15_redteam_reversibility-audit.md — F1 envelope discriminator, F6 rotate=additive-new-DEK-version-retain-priors) + R-alpha PM assessment (context/assessments/2026-06-15_Research_R-alpha_PM_Assessment.md — Problem 1 restore-half; REC-216..223 rotate-binding; REC-235 boot invariant). Owner doc: Doc 15 §3.4/§4.1/§5/§6/§13.4/§16.
baseline: homesynapse-core HEAD `60d50ce` (AB-3 landed GREEN, M6 COMPLETE 4-of-4, M7.1 DONE; the crypto write path is built but INERT — main()/cipher activate at AB-4) ; docs `32afb3f` ; Doc 15 LOCKED (2026-06-07, AMD-86/87) ; on-disk amendment watermark AMD-93 (invariants 163/47).
amd-number-rationale: assigned at authoring per P2. Watermark is AMD-93 (AMD-88..93 = the M7 automation block, RATIFIED 2026-06-12). The reserved ranges (AMD-66..71 = M6 config, ratified; AMD-72..85 = Research 7 REST/WS M10/M11) sit below the watermark; AMD-94 is the next clean, collision-free number above it. Does not reuse a reserved slot (INV-GA-02).
-->

# AMD-94: Doc 15 §6 Currency Amendment — Rotate-DEK-on-Restore Binding + 1-Byte Envelope Version Discriminator

**Track:** FULL per-AMD (independent DOCS-Project review). This amendment touches a **persisted shape** (the at-rest envelope gains a version byte), a **crypto behavioral contract** (the restore key-management contract), and mints **new invariants** — so it does NOT ride a shared block (constraint-enforcement §6; P4).

**Scope discipline:** This is a **currency / forward-compatibility** amendment to a Locked doc, **NOT a redesign**. It binds one decision already RULED by Nick (A4), pins two cheap-now / irreversible-later one-way doors before they lock at the first encrypted write, and changes no algorithm, no module graph, and no shipped code. The companion one-way-door items that share AB-4's lock-time but are NOT A4 — F3 (bind one nonce-construction per scope) and F13 (write-path fatal dir-fsync) — are sibling app-bootstrap envelope-finalization deliverables, **out of scope here** (§6).

---

## 1. Problem Statement

Two cheap-now / irreversible-later cells in Doc 15's at-rest encryption envelope lock **permanently** at the first encrypted row write — which happens at app-bootstrap **AB-4**, when `payloadCipher` activates on the immutable, (soon-)hash-chained event log. Both must be settled **in the Locked doc, before that write**, and Doc 15 is LOCKED — so the vehicle is the formal re-open -> DOCS review -> ratify pipeline (A4's binding process caveat), never a silent edit.

**(1) The restore-half of the counter-nonce hazard is still open (OR-M6-NONCE restore-half).** Doc 15 §6's `[BLOCKING-for-M6-impl]` "Counter-nonce reuse across crash/restore" row currently offers two mitigations as **equal options**: "rotate the DEK on restore, **or** carry the high-water mark in the backup." The crash-half is discharged (M6.3's durable, fsync-ahead-of-return counter + re-init-from-persisted-max). The restore-half is not: **carrying the high-water mark alone is unsafe** — the R-alpha survey names the exact failure (backup at counter N -> live writes advance to N+k -> restore to N -> the scope reuses nonces N+1…N+k under the *same* DEK). A repeated (key, nonce) pair breaks AES-256-GCM **confidentiality and authentication** for that scope (NIST SP 800-38D §8). This is the open corollary on AMD-86-INV-01 (§35).

**(2) The envelope has no algorithm/version discriminator.** The stored envelope is `payload` (ciphertext+tag) + `payload_iv` (96-bit GCM nonce) + `dek_ref` (`scope_id:key_version`). **`dek_ref`'s `key_version` is a *key* version, never an *algorithm* version** — AES-256-GCM is implicit and hardcoded. Deferring the *algorithm* (GCM-SIV / committing-AEAD -> Tier-2) is correct and evidence-backed (RFC 8452 is Informational, two-pass, not FIPS-validatable). But the agility *mechanism* — a version tag — is **orthogonal** to the algorithm *choice*, and shipping with no mechanism is the one-way door: once the chain is live and the corpus written, re-encrypting to change the AEAD is **impossible** (it mutates `stored_payload_bytes` and breaks `chain_hash[n]` + every successor, §5). The landscape is provably unsettled (NIST issued a second pre-draft of SP 800-38D Rev.1 in June 2026 proposing `wGCM`/Rijndael-256 + nonce-derivation modes, comments open through 31 Jul 2026). The slot costs ~1 byte/row on an empty corpus now; retrofitting it onto a live, immutable, hash-chained log later is the worst-conditions migration. **The slot must exist before the first write.**

A4 (RULED 2026-06-18) settles both: **bind rotate-DEK-on-restore now** and **reserve the 1-byte version discriminator now (v1 = the current envelope)**. R-gamma (in flight) later refines the version *policy* — not whether the slot exists.

## 2. Specification

### 2.1 Rotate-DEK-on-restore = the restore contract (A4 decision 1)

On restore of an encrypted scope from backup, the engine **rotates the scope DEK**, where "rotate" is pinned (Track-3 F6) to exactly one meaning:

- **Install an ADDITIVE new DEK version.** Mint a fresh per-scope DEK, wrap it under the scope KEK, and write a **new `scope_keys` row** (`key_version` = prior max + 1). **Retain all prior versions** — pre-restore rows stay decryptable under their original `dek_ref` `key_version`.
- **Do NOT re-encrypt existing payloads.** Re-encryption would mutate `stored_payload_bytes` and break `chain_hash` (§5). Rotate touches only the `scope_keys` table (which is **not** chain-covered) and *future* writes — so it is **chain-safe**.
- **Do NOT replace or overwrite any prior DEK version.** Replacing a scope's DEK in place would render every pre-restore encrypted row permanently unreadable — silent data loss dressed as a key rotation. (This pin closes the *opposite* mis-implementation from the chain-break one; both are foreclosed at zero cost while the feature is on paper.)
- **Why this is the contract, not an option.** The restored scope resumes counter-nonce counting **from zero under the fresh DEK version**. A never-before-used DEK version has an untouched nonce space, so a (key, nonce) pair already used under a prior version **can never recur**. This is structural, not disciplinary — it is why rotate-on-restore *binds* and carry-high-water-mark does not.
- **Demote carry-high-water-mark to a defense-in-depth cross-check.** Carrying the pre-restore counter high-water mark in the backup is retained only as a **cross-check** — assert the resumed counter ≥ any carried max — **never the sole guarantee**. (Alone, it is the unsafe option named in §1.)
- **Boot invariant (R-alpha REC-235).** The engine **refuses to encrypt in a scope** until either (a) a fresh DEK version is installed for that scope, **or** (b) the persisted counter is proven ≥ all prior nonces issued under the active DEK version. Fail-closed; no silent resume.

This closes **OR-M6-NONCE restore-half** (R-alpha Problem 1) on ratification. It changes **no shipped code** — the backup/restore feature is unbuilt (foundation-readiness F3); this is the design contract that feature is built against, plus the boot invariant the app-bootstrap read/write path carries.

### 2.2 Reserve the 1-byte envelope version discriminator (A4 decision 2)

Add a **1-byte algorithm/version discriminator** to the at-rest AEAD envelope:

- **`v1` = the current envelope** exactly as Doc 15 §3.4 specifies — AES-256-GCM, 96-bit per-scope counter nonce, per-scope DEK. No algorithm changes; `v1` *is* today's design.
- **Distinct from `dek_ref`.** `dek_ref`'s `key_version` selects which *key* decrypts a row (and is what §2.1 increments on restore). The new discriminator identifies the *envelope/algorithm* version, so the AEAD can evolve **without re-encrypting** the immutable corpus. The two version axes are orthogonal and both are now explicit.
- **Reserve the slot before the first encrypted write (AB-4).** After the first write the envelope shape is irreversible on the immutable, soon-hash-chained log; the corpus is empty today, so reserving costs nothing.
- **Version POLICY is R-gamma-pending — slot EXISTENCE is not.** This amendment reserves the slot and pins `v1`. It does **not** define the multi-version policy: the version->algorithm registry, downgrade-protection rules, and whether the tag is bound as GCM Additional Authenticated Data (AAD) are **R-gamma's** refinement (R-gamma is in flight; do not block on it — record it as pending). R-gamma refines the *policy*, not whether the slot exists.
- **Recorded safe-default so AB-4 is never blocked by R-gamma's timing (R-gamma may refine, not a decision gate):** emit the discriminator as the **first byte of the stored AEAD envelope** (so it is chain-covered -> tamper-evident once the chain is live) and **bind it as GCM AAD** (so the authentication tag covers the version -> downgrade-resistant). This is the recommended encoding; if R-gamma returns a stronger policy before AB-4 it supersedes this default. The alternative encoding (a separate additive `envelope_version` column, backfill-free per LTD-07/AMD-37 but **not** chain-covered today) is recorded in §2.4-§4.1 for the reviewer; the prefix-in-envelope default is preferred precisely because it is chain-covered.

### 2.3 Chain-liveness cross-reference (F4 — non-blocking)

The version byte's "chain-covered tamper-evidence" property (the recommended encoding, §2.2) becomes *real* only once `chain_hash` computation + mandatory startup verification are live — which they are **not** at HEAD (`SqliteEventStore` binds `ZERO_HASH`; Doc 15 §4.1 reads present-tense ahead of the code — Track-3 F4). This does **not** block reserving the slot or pinning `v1` (the byte's *existence* is independent of chain liveness). It is recorded so AB-4 does not over-claim tamper-evidence before the chain is activated, and so the reviewer sees the dependency. (Chain activation is itself an app-bootstrap/crypto-shred ordering item, not this AMD's scope.)

### 2.4 Doc 15 edit specifications — STAGED, NOT FOLDED until ratification

The following edits are **specified but NOT applied** to Locked Doc 15. On ratification, Nick (or the PM at his direction) folds them; until then Doc 15 is inviolate and the watermark stays AMD-93. The brief's "§5 envelope/format" maps, in the actual Locked doc, to **§5 Contracts + §4.1 Schema** (Doc 15 §5 is "Contracts and Invariants"; the physical envelope/schema is §4.1) — stated explicitly so the fold is mechanical.

**EDIT A — §3.4 (At-rest envelope encryption).** (i) After the sentence "DEK rotation (counter/time threshold) is the post-MVP automation; at MVP a scope uses one DEK with counter nonces.", append the rotate-on-restore paragraph from §2.1 (additive new DEK version; retain priors; no re-encrypt; no replace; resume-counter-from-zero-under-fresh-version; high-water-mark = cross-check; the refuse-to-encrypt-until-safe boot invariant). (ii) In the envelope definition ("An encrypted event has `payload` = ciphertext, `payload_iv` = the 96-bit GCM nonce, `dek_ref` = `scope_id:key_version`."), add: the stored envelope carries a **1-byte algorithm/version discriminator (`v1` = this envelope)**, distinct from `dek_ref`'s `key_version`; version policy R-gamma-pending (§2.2).

**EDIT B — §6 (Failure Modes), the "Counter-nonce reuse across crash/restore — [BLOCKING-for-M6-impl]" row, Recovery cell.** Replace the clause "(rotate the DEK on restore, **or** carry the high-water mark in the backup)" with: "**rotate the DEK on restore — install an additive new DEK version and retain priors (the binding restore contract, AMD-94 §2.1)** — so a restored scope never resumes under a DEK version whose nonce space was already used; carrying the high-water mark in the backup is a defense-in-depth **cross-check** only (assert resumed counter ≥ carried max), never the sole guarantee. The **boot invariant** (refuse to encrypt until a fresh DEK is installed or the counter is proven ≥ all prior nonces) makes the guarantee enforceable at startup." On ratification, the row's `[BLOCKING-for-M6-impl]` marker is resolved (the contract is now bound) and OR-M6-NONCE restore-half flips CLOSED.

**EDIT C — §5 (Contracts and Invariants).** Add two contract paragraphs:
- *"**Rotate-on-restore prevents cross-restore nonce reuse (AMD-94).** A scope resumes encryption after restore only under a freshly-installed additive DEK version; priors are retained and never replaced, payloads are never re-encrypted. A restored scope therefore never resumes counting under an already-used DEK version, so (key, nonce) reuse is structurally impossible across restore."*
- *"**Every encrypted envelope carries a 1-byte version discriminator (AMD-94).** `v1` = the §3.4 envelope (AES-256-GCM, counter nonce, per-scope DEK), distinct from `dek_ref`'s key version. The slot exists from the first encrypted write so the AEAD can evolve without rewriting the immutable, chain-covered corpus; the version policy is R-gamma-pending."*

**EDIT D — §4.1 (Event-store schema).** Record the physical reservation of the discriminator: either (a) a **1-byte prefix on the stored `payload` envelope** (chain-covered — the recommended encoding), or (b) a new additive `envelope_version` column (`INTEGER`/`BLOB(1)`, `ALTER TABLE ADD COLUMN`, backfill-free per LTD-07 and the AMD-37 additive-no-backfill precedent, **not** chain-covered today). Final placement R-gamma-pending; AMD-94 reserves the slot with `v1` = current. No migration ships with this AMD — the corpus is empty until AB-4, which emits `v1` on the first encrypted write.

**EDIT E — §13.4 (Testing — Failure).** Extend the existing `[BLOCKING-for-M6-impl]` restore assertion to require: a restore installs an **additive** new DEK version with priors retained (pre-restore rows still decrypt); the restored scope's resumed counter never repeats a (key, nonce) pair under any DEK version; the boot invariant refuses to encrypt until a fresh DEK is installed or the counter is proven ≥ all priors; and every encrypted envelope round-trips its 1-byte `v1` discriminator.

**EDIT F — §16 (Summary of Key Decisions).** Add two rows:
- *"| Restore nonce safety (AMD-94) | Rotate-DEK-on-restore = additive new DEK version, retain priors; high-water-mark = cross-check; refuse-to-encrypt boot invariant | Prevents cross-restore (key,nonce) reuse without re-encrypting the immutable log; closes OR-M6-NONCE restore-half | §3.4, §6 |"*
- *"| Envelope agility (AMD-94) | Reserve a 1-byte version discriminator, v1 = current envelope (policy R-gamma-pending) | Ciphertext outlives algorithms; the slot is now-or-never on an immutable hash-chained log; the algorithm choice stays deferred to Tier-2 | §3.4, §5 |"*

**EDIT G — OPTIONAL currency rider (STRIKEABLE — see §2.5).** §8.1 `ScopeKeyManager`-row correction.

### 2.5 Optional currency rider — §8.1 `ScopeKeyManager` row (STRIKEABLE)

This rider is **optional and clearly fenced** — the DOCS reviewer or Nick may strike it to keep AMD-94 minimal, at no cost to the two A4 decisions. It is included because the PROJECT_SNAPSHOT Open flags record that this nit "rides the **next** Doc-15-touching amendment," and AMD-94 is exactly that, and is itself a §3.8/seam-adjacent amendment (rotate-on-restore and the version byte both operate through the `PayloadCipher` seam the §8.1 row describes).

**The nit:** Doc 15 §8.1's `ScopeKeyManager` row reads "...own `scope_keys`, **implement `PayloadCipher`**, (post-MVP) destroy KEK | config (impl of the persistence seam)" — stale against the E2-folded §3.8, which states `ScopeKeyManager` **exposes its own `encrypt`/`decrypt` surface but does NOT implement the persistence-exported `PayloadCipher` type directly** (implementing it in `config` would force a `config -> persistence` edge); instead **`app` wraps it in a thin `PayloadCipher` adapter** at the composition root.

**Staged fix (if not struck):** change the §8.1 `ScopeKeyManager` row to "...own `scope_keys`, **expose an `encrypt`/`decrypt` surface adapted to `PayloadCipher` at the `app` composition root (§3.8) — does NOT implement the persistence-exported `PayloadCipher` type directly**, (post-MVP) destroy KEK | **config (key manager); the `PayloadCipher` adapter lives in `app`**." Pure currency correction; no new decision.

## 3. Downstream Impact

- **App-bootstrap AB-4** (`payloadCipher` activation + the envelope-finalization gate): the §6 amendment **moves PROPOSED**; on ratification, AB-4's F1 row is satisfied (the slot is reserved, `v1` pinned) and AB-4 emits `v1` on the first encrypted write. The rotate-on-restore **boot invariant** is carried by **AB-2** (the read/write path — it already lists "carry the rotate-DEK-on-restore boot invariant"). No change to AB-1/AB-3.
- **The future backup/restore WU** (unbuilt; foundation-readiness F3): builds the rotate-on-restore mechanics in §2.1 as its design contract.
- **R-gamma** (in flight, DOCS): on return, refines the version *policy* (registry, downgrade rules, AAD binding) and folds as a **separate, later** input — non-blocking for AMD-94 and for AB-4 (the safe-default in §2.2 unblocks AB-4 if R-gamma is late).
- **Crypto-shred WU** (post-MVP): unaffected here. The cause-discriminated read contract (R-alpha Problem 2 / NEW-1) is a **separate** decision path (A3 -> AB-2 fail-closed + crypto-shred degrade), NOT this AMD. Note for that WU (carried, not bound here): the shred tombstone + read-side decision rule key on `(scope, key_version)`, consistent with §2.1's additive versioning.
- **Schema / migrations:** additive only. If EDIT D takes the column encoding, it is an additive `ALTER TABLE ADD COLUMN` (backfill-free, LTD-07 forward-only); the prefix-in-envelope encoding needs no DDL. Either way **no migration ships with this AMD** — AB-4 owns the first write.
- **Code shipped with this AMD:** none (governance only). M6.3 (durable crash-half counter) is unaffected and remains correct.

## 4. Implementation Notes

- **Rotate-on-restore is design-only** at this AMD — the backup/restore feature is unbuilt. The amendment binds the contract so the feature, when built, cannot be mis-implemented into a chain break (re-encrypt) or silent data loss (replace).
- **The version byte lands at AB-4** (the F1 envelope-finalization gate), not before — it must be present at the first encrypted write and never after.
- **Sibling envelope-finalization items are NOT this AMD.** F3 (bind one nonce-construction per scope, NIST SP 800-38D §8.3) and F13 (treat the nonce dir-fsync `IOException` as FATAL) share AB-4's lock-time but are app-bootstrap implementation deliverables, not A4 decisions — kept out per scope discipline (§6).
- **Chain-liveness (F4)** is a recorded non-blocking dependency for the *tamper-evidence* property of the recommended encoding (§2.3), not for slot reservation.

## 5. Tests (assertions the contract must satisfy; most are design-time / future-WU)

| Test | Assertion |
|---|---|
| `RestoreRotatesDekAdditively` | restore installs a new `scope_keys` row at `key_version`+1, retains all priors; a pre-restore row still decrypts under its original `dek_ref` `key_version`; no `stored_payload_bytes` are mutated (chain unaffected) |
| `RestoreNeverReusesNonce` | after restore the scope encrypts only under the fresh DEK version (counter from 0); kill-mid-write then restore-from-backup -> assert no (key, nonce) pair recurs under any version (extends the §13.4 `[BLOCKING-for-M6-impl]` hazard test) |
| `RefuseToEncryptUntilSafe` (boot invariant) | a scope refuses to encrypt at boot until a fresh DEK is installed OR the persisted counter is proven ≥ all prior nonces under the active version; fail-closed, no silent resume |
| `EnvelopeCarriesV1Discriminator` | every encrypted envelope round-trips its 1-byte discriminator; `v1` decodes as the §3.4 envelope (AES-256-GCM, counter nonce, per-scope DEK); the discriminator is independent of `dek_ref`'s `key_version` |
| `HighWaterMarkIsCrossCheckOnly` | with rotate-on-restore active, a (deliberately) stale carried high-water mark does not by itself permit a resume that rotate would forbid — the cross-check augments, never replaces, the fresh-version guarantee |

## 6. Scope Fences / Deferred (non-goals)

- **NO algorithm change.** AES-256-GCM stays; GCM-SIV / committing-AEAD / `wGCM` remain **Tier-2**. `v1` = today's envelope.
- **NO version POLICY.** The registry, downgrade rules, and AAD-binding mechanics are **R-gamma's** (this AMD reserves the slot + pins `v1` only).
- **NO re-encryption and NO destructive migration.** The additive DEK version and the additive version tag are explicitly the **non-destructive** path; the immutable log is never rewritten.
- **NO cause-discriminated read contract.** R-alpha Problem 2 / NEW-1 (CASE-a degrade + shred tombstone / CASE-b fail-closed) is a separate decision path (A3 -> AB-2 + crypto-shred WU), not folded here.
- **NO F3 / F13.** Sibling AB-4 envelope-finalization items (one-nonce-construction-per-scope; write-path fatal dir-fsync) are app-bootstrap deliverables, not A4 — out of scope.
- **NO new module, NO JPMS/Gradle change, NO `projectionVersion` change.** Module-info UNCHANGED.
- **Anti-requirements (bind):** never lead with commodity encryption (this is correctness/forward-compat, not a marketing claim); local-first inviolate (keys stay machine-local); no destructive forced migration (the version byte + additive DEK versioning are the non-destructive path).

## 7. Invariants and Citations

- **AMD-94-INV-01 (candidate) — Rotate-on-restore prevents cross-restore nonce reuse.** On restore, a scope resumes encryption only under a freshly-installed **additive** DEK version (priors retained, never replaced; payloads never re-encrypted); carry-high-water-mark is a defense-in-depth cross-check, never the sole guarantee; the boot invariant refuses encryption until a fresh DEK is installed or the counter is proven ≥ all priors. A restored scope therefore never resumes counting under an already-used DEK version -> (key, nonce) reuse is structurally impossible across restore. **Discharges the AMD-86-INV-01 (§35) `[BLOCKING-for-M6-impl]` restore-half corollary.**
- **AMD-94-INV-02 (candidate) — Encrypted at-rest envelopes are self-describing.** Every encrypted at-rest envelope carries a 1-byte algorithm/version discriminator; `v1` = the Doc 15 §3.4 envelope (AES-256-GCM, 96-bit counter nonce, per-scope DEK), distinct from `dek_ref`'s `key_version`. The slot exists from the first encrypted write so the AEAD may evolve without rewriting the immutable, chain-covered corpus. (Version *policy* R-gamma-pending; slot *existence* is this invariant.)
- **Identifier handling (INV-GA-02).** `AMD-94-INV-01/02` are **candidates**; exact final identifiers are **assigned at ratification** and are permanent/non-reusable thereafter. They register into `Architecture_Invariants_v1.md` (a new `§` section in the `AMD-NN-INV` family, plus the **§17 Invariant Index** and **§18 Traceability Matrix** rows) **at ratification, NOT now** — together with the watermark bump **AMD-93 -> AMD-94**.
- **Cites:** Doc 15 §3.4 / §4.1 / §5 / §6 / §13.4 / §16 (owner doc, Locked); **AMD-86-INV-01 (§35)** — the nonce corollary this closes; **AMD-37** — `chain_hash` `NOT NULL` zero-default, the additive-no-backfill precedent; **INV-PD-03** (at-rest posture), **INV-PD-07** (crypto-shred seam — design only), **INV-PD-08** (tamper-evident chain — the version byte's chain-coverage rationale); **R-alpha PM Assessment** (Problem 1; REC-216..223 rotate-binding, REC-235 boot invariant); **Track-3 reversibility audit** (F1 discriminator, F6 rotate=additive-retain-priors, F4 chain-liveness); **decision record A4** (2026-06-18) + its binding process caveat; NIST SP 800-38D §8 (the (key,nonce) prohibition). **Module-info UNCHANGED.**

## 8. Implementing WU

- **App-bootstrap AB-4** — emits the `v1` discriminator on the first encrypted write (the envelope-finalization gate); **AB-2** — carries the rotate-DEK-on-restore **boot invariant** in the read/write path.
- **The future backup/restore WU** — implements the rotate-on-restore mechanics (§2.1).
- **No production code ships with this amendment** (governance only).

## 9. Ratification Checklist

- [ ] **FULL independent DOCS-Project review** (NOT the lightweight block-track — touches a persisted shape + a crypto behavioral contract + mints invariants; constraint-enforcement §6 / P4). Review prompt authored + dispatch-ready: `nexsys-hivemind/context/handoff/2026-06-19_AMD-94_DOCS-Project_review_prompt.md`.
- [ ] Nick ratification (co-sign; the PM does not self-ratify).
- [ ] On ratification: fold the §2.4 staged edits (A–F; G if not struck) into Locked Doc 15 §3.4 / §4.1 / §5 / §6 / §13.4 / §16 / (§8.1 if G); resolve the §6 `[BLOCKING-for-M6-impl]` marker; flip **OR-M6-NONCE restore-half -> CLOSED**.
- [ ] On ratification: register `AMD-94-INV-01/02` (final identifiers, INV-GA-02) into `Architecture_Invariants_v1.md` (new `AMD-94-INV` section + §17 index + §18 matrix rows); raise the on-disk watermark **AMD-93 -> AMD-94**; add the navigation-index row.
- [ ] R-gamma return folds the version **policy** (registry / downgrade / AAD binding) — separate, later, non-blocking.

## 10. Review Disposition

**PROPOSED 2026-06-19** — authored by the Cowork PM. Awaiting the full independent DOCS-Project review (prompt dispatch-ready, §9). **NOT ratified; NOT folded into Locked Doc 15; watermark stays AMD-93** until Nick ratifies after the review. This amendment is the sanctioned re-open -> review -> ratify vehicle for the A4 ruling; Doc 15 remains inviolate in the interim.
