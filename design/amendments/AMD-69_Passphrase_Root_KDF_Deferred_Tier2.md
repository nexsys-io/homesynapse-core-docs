<!--
file: design/amendments/AMD-69_Passphrase_Root_KDF_Deferred_Tier2.md
purpose: AMD-69 — RECONCILE Research 5 REC-58 (Argon2id + BouncyCastle) against Locked Doc 15: the passphrase-root KDF is Tier-2/post-MVP and its provider is open (OQ-15-3). DEFERRED, not an active M6 contract.
audience: Nick (ratify/confirm-deferral), PM, Coder
status: DEFERRED — Nick confirmed Option (a) at the 2026-06-09 block ratification; reserved for the Tier-2/OQ-15-3 passphrase-root-KDF amendment. (DOCS review 2026-06-09 ruling CONFIRM-DEFERRAL — all 3 Doc-15 conflicts re-verified verbatim; do NOT re-open OQ-15-3; return: nexsys-hivemind `context/audits/2026-06-09_AMD-66-71_DOCS_Review_Return.md`)
source: Research 5 REC-58 (PM Assessment v2: ACTIVE) — SUPERSEDED for MVP by Locked Doc 15 §2.3/§3.5/§3.8 + OQ-15-3 (this AMD records the reconciliation)
baseline: homesynapse-core HEAD `6c6dd33`; Doc 15 LOCKED (watermark AMD-87)
-->

# AMD-69: Passphrase-Root KDF (Argon2id / BouncyCastle) — DEFERRED to Tier-2 (Doc 15 OQ-15-3)

**Block context:** Fourth slot of the reserved M6 config block (AMD-66..71). **Authored as DEFERRED.** This AMD does not freeze an M6 contract; it records — for governance completeness and the audit trail — that Research 5 REC-58's planned content is reclassified by the Locked Doc 15 to Tier-2/post-MVP with an open provider question, and reserves the number for the amendment that will eventually resolve it. **Escalation item for Nick** (§4).

## 1. Problem Statement — a Research-5 / Locked-Doc-15 conflict

Research 5 **REC-58** (PM Assessment v2: ACTIVE) proposed committing the M6 secret store to an **Argon2id KDF (RFC 9106 §4 second-recommended: t=3, p=4, m=2¹⁶) backed by the BouncyCastle provider** (`org.bouncycastle:bcprov-jdk18on`), with a `docs/secrets-threat-model.md`. That assessment was finalized **2026-05-22**. The **Cryptographic Architecture (Doc 15) was authored and LOCKED later (watermark AMD-87, 2026-06-07)** and **governs the encryption domain** — and it draws the line differently. Three direct conflicts with the Locked doc make REC-58-as-written non-ratifiable for M6:

1. **Argon2id/passphrase root is post-MVP (Doc 15 §2.3).** The D2 line table places "Passphrase-gated root key (Argon2id) … → **post-MVP**." A passphrase breaks zero-config (INV-CE-02) and arrives with off-device/cloud flows.
2. **The MVP secret store roots on the shared machine-local key, not a passphrase-derived key (Doc 15 §3.5, §7.3).** Doc 15 §7.3 unifies the secret store under the **one machine-local root** (the secret store becomes the `config_secrets` scope). So at MVP the secret store has **no Argon2id-derived key of its own** — REC-58's premise (a passphrase-derived secret-store key) is dissolved by the shared-root reconciliation.
3. **The MVP path adds zero new dependencies, and the provider choice is OPEN (Doc 15 §3.8, OQ-15-3).** Doc 15 §3.8: "The MVP path adds **zero new dependencies** … the Tier-2 passphrase KDF **may** add Bouncy Castle for Argon2id, **or** take the zero-dependency PBKDF2 path (**OQ-15-3**)." Committing to BouncyCastle now would (a) add an MVP dependency the Locked doc says is unnecessary and (b) pre-empt an explicitly open Doc 15 question.

**Per the W24 guardrail ("Keep Locked Doc 15 inviolate; if authoring surfaces a Doc 15 design gap, STOP and escalate"), the PM does not author REC-58 as an active M6 dependency commitment.** Doc 15 (Locked, later, the owning doc for the encryption domain) governs.

## 2. Disposition — DEFERRED to Tier-2, owned by Doc 15 OQ-15-3

- The **MVP secret store (M6.2) roots on the shared machine-local key** already specified by Locked Doc 15 §3.5/§7.3 — **no Argon2id, no BouncyCastle, no passphrase, no new dependency** at MVP. (No amendment needed for this; Doc 15 already states it.)
- The **passphrase-derived root + its KDF** are **Tier-2/post-MVP**. The **provider/algorithm choice — BouncyCastle Argon2id vs zero-dependency PBKDF2 (≥600k) — is OQ-15-3, OPEN, and owned by Doc 15**, to be resolved with the Tier-2 passphrase-root work (entangled with the GraalVM native-image / closed-world decision per the language-replatform assessment and the M5-D sd_notify matrix's "no JNR/JNA-class bindings under closed-world" finding).
- **AMD-69 the number is RESERVED** for the Tier-2 passphrase-root-KDF amendment that resolves OQ-15-3 (authored post-MVP, with its threat-model doc). It is **not** part of the M6 entry-gate's active config-contract freeze.

**Net effect on the M6 config block:** the active contract-freezing M6 amendments are **AMD-66, 67, 68, 70, 71**; **AMD-69 is held (deferred)**. The reserved range AMD-66..71 is preserved.

## 3. What is NOT deferred (stays in M6, elsewhere)

- The **at-rest envelope encryption of sensitive-PII categories** (AES-256-GCM, JDK-intrinsic, machine-local root) is **MVP** and is **M6.3** — governed by Doc 15 §3.4/§4, not by this AMD. It adds **no** new dependency (JDK-intrinsic).
- The **`SecretStore.setAll(Map)` atomic durable write** is **AMD-68** (active) — unaffected by this deferral.

## 4. Escalation to Nick

```
ESCALATION TO NICK
Task: M6 config block — AMD-69 (Research 5 REC-58: Argon2id + BouncyCastle).
Issue: REC-58 (assessed 2026-05-22) conflicts with the later-Locked Doc 15 on three
       points — Argon2id/passphrase root is Tier-2/post-MVP (§2.3), the MVP secret store
       roots on the shared machine-local key (§3.5/§7.3), and the provider choice is the
       OPEN OQ-15-3 with "MVP adds zero new deps" (§3.8).
Options:
  (a) DEFER AMD-69 to Tier-2 / OQ-15-3; M6 block = AMD-66,67,68,70,71 active (this AMD's recommendation).
  (b) Author AMD-69 now as a BouncyCastle commitment — REJECTED: violates Locked Doc 15 on 3 counts.
  (c) Re-open Doc 15 OQ-15-3 now to settle the provider early — possible but premature (Tier-2 has no MVP consumer; the GraalVM closed-world input is not yet in).
PM Recommendation: (a). Keep Locked Doc 15 inviolate; reserve AMD-69 for the OQ-15-3 resolution.
Blocking: NO — M6.1/M6.2/M6.3 do not depend on the passphrase root; the MVP machine-local root is fully specified by Doc 15.
```

## 5. Invariants and Citations

- No new invariant (deferral record). Cites: Doc 15 §2.3 (D2 line), §3.5 (root-key source), §3.8 (zero-dep MVP), §7.3 (shared root), §15 OQ-15-3 (open provider); Research 5 v2 REC-58 (superseded-for-MVP); D2.

**`module-info.java`:** no change (no dependency added — that is the whole point).

## 6. Implementing WU

**None at M6** (deferred). The Tier-2 passphrase-root-KDF amendment (resolving OQ-15-3) is authored post-MVP when the first off-device/cloud flow or a user-owned-key requirement arrives.

## 7. Ratification Checklist

- [x] Nick **confirms the deferral** (Option (a)) — this is the ratification act for a deferred amendment — 2026-06-09
- [x] DOCS-Project review notes the Research-5/Doc-15 reconciliation (no contract frozen) — 2026-06-09 (ruling CONFIRM-DEFERRAL)
- [x] Navigation-index records AMD-69 as RESERVED/DEFERRED (Tier-2, OQ-15-3); watermark unchanged — 2026-06-09

## 8. Review Disposition

**CLOSED — DOCS-Project review (2026-06-09): CONFIRM-DEFERRAL; Nick confirmed Option (a) at the 2026-06-09 block ratification.** Return: nexsys-hivemind `context/audits/2026-06-09_AMD-66-71_DOCS_Review_Return.md`. The review independently re-verified all three Doc 15 conflicts verbatim (§2.3 passphrase root post-MVP; §3.5/§7.3 machine-local MVP root; §3.8 zero-MVP-deps + open OQ-15-3) and ruled that committing `bcprov-jdk18on` at M6 would be a 3-count Locked-doc violation; it further ruled **do NOT re-open OQ-15-3 now** (Tier-2 has no MVP consumer; the GraalVM closed-world input is not yet in). The §4 escalation is RESOLVED. **The number AMD-69 stays reserved** for the eventual Tier-2 passphrase-root-KDF amendment that resolves OQ-15-3; OQ-15-3 stays closed-as-open-question, owned by Doc 15. The active M6 config block is AMD-66/67/68/70/71 (all RATIFIED 2026-06-09); no invariant registers from this AMD (deferral record); watermark unchanged at AMD-87.
