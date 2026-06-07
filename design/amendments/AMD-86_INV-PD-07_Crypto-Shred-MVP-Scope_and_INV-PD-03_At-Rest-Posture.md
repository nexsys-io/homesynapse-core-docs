<!--
file: design/amendments/AMD-86_INV-PD-07_Crypto-Shred-MVP-Scope_and_INV-PD-03_At-Rest-Posture.md
purpose: AMD-86 — narrow INV-PD-07's MVP mandate (operational crypto-shredding → post-MVP) and state the INV-PD-03 at-rest posture, reconciling both privacy invariants with Doc 15 (Cryptographic Architecture) in one pass. Codifies decision D2.
audience: Nick (ratify), PM, DOCS-Project review
status: **RATIFIED 2026-06-07** — FULL DOCS-Project review **RATIFY-WITH-EDITS**; **AMD-86 itself reviewed clean** (the two required edits, E1 schema naming + E2 §3.8 wiring, are **Doc 15** edits — see J2/J6). J1/F-A at-rest threat model PASS ("most honestly stated… no overstated security claim"), J3 D2 line PASS, J4 minimality + AMD-86-INV-01 PASS, J5 Doc 06/AMD-60 shared-root PASS, m1 PASS, m2 `[BLOCKING-for-M6-impl]`. Co-ratified with AMD-87 + Doc 15 Lock; on-disk watermark → AMD-87. Review: `nexsys-hivemind/context/audits/2026-06-06_Doc15_AMD-86_DOCS_Review_Return.md`.
source: decision D2 (nexsys-hivemind/context/decisions/2026-06-06_post-M4_M5-window_decisions.md); Doc 15 §2.3/§3.4/§3.5/§3.6 (the owner-doc this amendment codifies); foundation-readiness assessment §2.1/§2.2/§5 (INV-PD-07 MVP-mandate unmet); the 2026-03-22 crypto research (superseded by Doc 15)
baseline: homesynapse-core HEAD `8ef9e9f`; Architecture_Invariants_v1.md §6 INV-PD-03 (`:389`) / INV-PD-07 (`:405-427`, MVP-scope clause at `:427`)
amd-number-rationale: assigned at authoring per P2. AMD-65 = Expectation codec (M5-A); AMD-66–71 reserved = M6 config amendments (Research 5); AMD-72–85 reserved = Research 7 (REST/WS, M10/M11). AMD-86 is the next clean, collision-free number.
-->

# AMD-86: INV-PD-07 Crypto-Shred MVP-Scope Narrowing + INV-PD-03 At-Rest Posture

## 1. Problem Statement

Two ratified privacy invariants are in contradiction with the de-facto and now-decided crypto delivery scope, and nobody has reconciled them:

- **INV-PD-07 (`Architecture_Invariants_v1.md:427`)** mandates, at MVP: *"The MVP must implement the per-scope key management infrastructure and define the encryption scope categories. Crypto-shredding must be operational for at least one data category (identity/presence data is the recommended first implementation)."* The **operational crypto-shredding** clause is unmet and, per decision **D2**, deliberately deferred — it has **no MVP consumer** (a local, single-home, zero-telemetry MVP serves "delete my data" by whole-installation reset; the immutability-vs-erasure conflict crypto-shredding resolves only bites once there is a reason to *retain* the log after erasure (institutional audit) or data leaves the device (cloud) — both post-MVP).
- The 2026-03-22 crypto research (now superseded by **Doc 15**) scoped **all** envelope encryption *and* crypto-shredding as "Tier 2 / post-MVP." That is also wrong in the other direction: **INV-PD-03** (`:389`, encrypted storage for sensitive PII under user-owned keys) is a **live at-rest obligation at MVP** — plaintext PII on a removable SD card is an exfiltration hole independent of crypto-shredding.

The reconciliation must (a) move the operational-shred clause to post-MVP **without** weakening the design or the schema seam, and (b) **state the INV-PD-03 at-rest posture** so both invariants are settled in one pass rather than leaving the at-rest obligation implicit. The governing constraint is irreversibility: the event log is immutable, so a category can only ever be crypto-shredded if it was **written encrypted under a per-scope key in the first place** — making the encrypt-on-write decision now-or-never even though the shred operation is deferrable.

## 2. Specification

### 2.1 INV-PD-07 text change (minimal — strike one clause)

In INV-PD-07's "MVP scope" paragraph (`:427`), **preserve** the first sentence and the design intent (`:425`, deletion via key-destruction, events remain in the log), and **replace** the operational-shred sentence:

> ~~"Crypto-shredding must be operational for at least one data category (identity/presence data is the recommended first implementation). Extension to additional categories is incremental."~~

with:

> "At MVP, the sensitive-PII categories (identity, person-linked presence) are **written encrypted-at-rest under per-scope keys** (INV-PD-03), which preserves their crypto-shreddability on the immutable log. **Operational crypto-shredding — the key-destruction API and the data-erasure triggers that consume those keys — lands with the first cloud or institutional data-sharing product** (its first real consumer); a local single-home installation's data-deletion recourse at MVP is whole-installation reset. The per-scope key-management infrastructure, the encryption-scope categories, and the `scope_keys` schema seat the operation as a clean later-add over the already-encrypted historical corpus, with no migration. Extension to additional categories is incremental."

The first sentence of the MVP-scope paragraph — *"The MVP must implement the per-scope key management infrastructure and define the encryption scope categories"* — **stands unchanged**.

### 2.2 INV-PD-03 at-rest posture (the one-line widen)

Append to INV-PD-03 (`:389`) a posture note reconciling it with Doc 15 §3.4/§3.5. **The threat-model claim is stated precisely — it is easy to overclaim, and this text becomes the ratified invariant note:**

> "At MVP, the sensitive-PII categories are encrypted at rest under **per-scope DEKs** (application-level, per-category — never whole-database, so per-category crypto-shredding remains possible), rooted on a **machine-local key** (zero-config, INV-CE-02). **MVP is a *partial* satisfaction of this invariant:** at-rest encryption — yes; the **'user-owned keys'** property — not yet. Because the machine-local key sits on the **same medium** as the data, MVP encryption protects **data copies that exclude the key file** (key-excluding backups, synced/copied data directories) and runtime reads by a **less-privileged process**; it does **NOT** protect against **theft of the storage medium itself** (the key travels with it) or an **on-device-root adversary**. The full form — *irrecoverable without the user's key material*, and media-theft resistance — is a **Tier-2** property, delivered by a **passphrase-derived root** (never stored) **or a TPM-sealed root** on TPM-equipped hardware (the Pi-4 validation floor has none; a passphrase breaks zero-config — so this is genuinely Tier-2, not an MVP omission). The exact set of categories encrypted-on-write at MVP is the sensitive-PII set by default, tuned against the Raspberry-Pi-4 AES-256-GCM write-path benchmark, with a category falling back to plaintext-at-rest only where Pi-4 performance genuinely forces it, documented consciously."

### 2.3 Owner-doc

The detailed design these clauses point to is **Doc 15 — Cryptographic Architecture** (`design/15-cryptographic-architecture.md`), which this amendment is authored alongside. Doc 15 supersedes the 2026-03-22 research artifact as the owner of the cryptographic architecture.

## 3. Downstream Impact

- **M6 (Configuration):** builds the per-scope key-management infrastructure + the secret store to Doc 15; **writes the sensitive-PII categories encrypted-at-rest from MVP** (INV-PD-03). M6 is sized DOWN by this amendment (config pipeline + at-rest secret encryption + key-management infrastructure/seams) — **not** a full operational crypto-shred subsystem.
- **Doc 06 (Configuration System):** a companion currency amendment (AMD-66–71 scope) adds the **atomic multi-key durable write** beneath AMD-60's `CredentialRotator.rotate(Map)` and unifies the secret store onto the shared key-management root (Doc 15 §7.3).
- **The crypto-shred operation:** post-MVP; activates on the already-encrypted MVP corpus at the first cloud/institutional data-sharing product. The M5-D energy/institutional interviews carry the **verifiable-erasure question** as the re-scope-up trigger — if a launch-window buyer requires it, this amendment is revisited *before* M6 freezes the write path.
- **Schema:** `chain_hash` is **not new** — it already exists in `V001` (`BLOB(32) NOT NULL`, zero-hash default) per **AMD-37**; Doc 15 **activates** it (real chain computation), no migration/backfill. The new MVP additions are `payload_iv` / `dek_ref` + the `scope_keys` table (populated for encrypted sensitive-PII scopes from launch — not reserved-but-empty), per Doc 15 §4.1.

## 4. Acceptance

This is a governance/invariant amendment; its acceptance is the **contract-freeze-readiness** evidence in Doc 15 §8/§13 — specifically the `ScopeKeyManager` encrypt → (destroy-key) → unreadable round-trip test, which proves the per-scope shred contract is exercisable before M6/M9 build on it (the AMD-65 lesson: do not freeze a contract that cannot round-trip). No production code ships with this amendment.

## 5. Scope Fences / Deferred

- **NO** operational crypto-shred at MVP (no key-destruction API, no erasure triggers/UI).
- **YES, MVP:** sensitive-PII at-rest encryption (per-scope DEKs), the key-management infrastructure, the scope-category definitions, the `scope_keys` schema.
- **NO** code in this amendment (governance only).
- **NO** weakening of INV-PD-08 (hash chain + Ed25519 signing remain MVP, default-on) or of the design intent of INV-PD-07 (deletion via key-destruction, events remain in the log).
- **Tier 2 / post-MVP:** passphrase-gated root key, DEK rotation automation, the shred operation, extending encryption beyond the sensitive-PII set.

## 6. Invariants and Citations

- **INV-PD-07 (amended):** MVP = per-scope key-management infrastructure + scope-category definitions + sensitive-PII written encrypted-at-rest under per-scope keys (preserving shreddability); operational crypto-shredding = post-MVP (first cloud/institutional consumer). Design intent (deletion via key-destruction, immutable log) unchanged.
- **INV-PD-03 (posture stated — PARTIAL at MVP):** sensitive-PII encrypted at rest under per-scope DEKs at MVP, machine-local root (zero-config) → **at-rest: satisfied; "user-owned keys" + media-theft resistance: NOT yet** (machine-local key shares the medium; protects key-excluding copies + less-privileged reads, not medium theft). Full form = Tier-2 (passphrase-derived or TPM-sealed root).
- **New (proposed) — AMD-86-INV-01:** *Encrypt-on-write is irreversible; the shred operation is deferrable.* A category is crypto-shreddable only if written encrypted-per-scope; therefore the encrypt-on-write decision for the sensitive-PII categories is made at MVP and the operation that consumes those keys may land later.
- Cites: INV-PD-03 (`:389`), INV-PD-07 (`:405-427`), INV-PD-08, INV-CE-02 (zero-config), INV-ES-01 (immutable log), LTD-03/07; Doc 15; decision D2.

## 7. Implementing WU

**M5-B / B1** authors this amendment + Doc 15 (design). **M6** implements the MVP at-rest encryption + key-management infrastructure. **The crypto-shred operation = post-MVP** (first cloud/institutional product).

## 8. Ratification Checklist

- [x] **FULL DOCS-Project review** (NOT the P4 lightweight block-track — narrows a constitutional privacy invariant) — RETURNED **RATIFY-WITH-EDITS** 2026-06-06 (`context/audits/2026-06-06_Doc15_AMD-86_DOCS_Review_Return.md`); AMD-86 itself clean.
- [x] Nick ratification — **2026-06-07** (co-ratified with AMD-87 + Doc 15 Lock).
- [x] On ratification (2026-06-07): applied the §2.1 text change to `Architecture_Invariants_v1.md` INV-PD-07 and the §2.2 posture note to INV-PD-03; registered AMD-86-INV-01; raised the on-disk amendment watermark to **87** (co-ratified with AMD-87, the higher number); added the nav-index row; Doc 15 **Locked**.

## 9. Review Disposition

**RATIFIED 2026-06-07** — FULL DOCS-Project review RATIFY-WITH-EDITS (the two required edits are Doc 15's E1/E2; AMD-86 clean). Co-ratified with AMD-87 + Doc 15 Lock.
