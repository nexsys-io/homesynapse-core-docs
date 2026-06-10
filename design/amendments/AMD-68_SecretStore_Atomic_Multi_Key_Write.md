<!--
file: design/amendments/AMD-68_SecretStore_Atomic_Multi_Key_Write.md
purpose: AMD-68 — SecretStore.setAll(Map) atomic, durable, all-or-nothing multi-key write beneath AMD-60 CredentialRotator. Reconciles Doc 06 §8.5 with Doc 15 §7.3. (Doc 06 currency amendment.)
audience: Nick (ratify), PM, Coder
status: RATIFIED 2026-06-09 (Nick) — DOCS review RATIFY-WITH-EDITS, edit E68-1 folded `aedff55` ([AMD-68-A] bundle/credentialsFor retirement VERIFIED — no orphaned consumer); return: nexsys-hivemind `context/audits/2026-06-09_AMD-66-71_DOCS_Review_Return.md`
source: Doc 15 §7.3 (the SecretStore currency requirement) + AMD-60-INV-03 (CredentialRotator atomic+durable) + Research 5 REC-57 (bundle/read half RETIRED by ratified AMD-60 — see §1.2)
baseline: homesynapse-core HEAD `6c6dd33` (2026-06-08) — SecretStore (4 methods) source-verified at this commit
-->

# AMD-68: `SecretStore` Atomic Multi-Key Durable Write (`setAll(Map)`)

**Block context:** Third of the six-amendment M6 configuration block (AMD-66..71). **This is the Doc 06 currency amendment** the W24 charter names — it reconciles the Locked Doc 06 `SecretStore` (§8.5) with the requirement the Locked Doc 15 §7.3 places on it beneath the ratified AMD-60 `CredentialRotator`. Scoped "AMD-66–71" by Doc 15 §7.3 itself.

## 1. Problem Statement

### 1.1 The atomic-multi-key gap (Doc 15 §7.3, verbatim requirement)

`SecretStore` (source-verified at `6c6dd33`: 4 methods — `String resolve(String)`, `void set(String, String)`, `void remove(String)`, `Set<String> list()`) exposes **only single-key `set(key, value)`**. But the ratified **AMD-60** `CredentialRotator.rotate(Map<String,String>)` is contractually **atomic-across-entries and durable-before-return** — **AMD-60-INV-03**: "atomic across all entries of a single call (all-or-nothing — a token+refresh-token pair can never be torn), and durable-before-return." A loop of single-key `set()` calls **cannot** satisfy this: a crash between two `set()` calls tears an OAuth access+refresh-token pair, leaving a credential in a half-rotated, unusable state. **Doc 15 §7.3 places the requirement on Doc 06/M6 explicitly:** "M6 must add an all-or-nothing multi-key write (e.g., `setAll(Map)` / a transactional store write) beneath the rotator; the M9 `CredentialRotator` impl calls it. This doc [15] owns the requirement; Doc 06/M6 owns the store API change (a Doc 06 currency amendment, AMD-66–71 scope)." This AMD is that change.

### 1.2 Research 5 REC-57's bundle/read half is RETIRED by ratified AMD-60 (cross-amendment coherence)

Research 5 v2 planned AMD-68 as "`SecureCredentialBundle` record + `SecretStore.credentialsFor(String)`." **Both are superseded by AMD-60, which ratified later (2026-06-05) than the Research 5 assessment (2026-05-22):** AMD-60's R7/A5 arbitration **rejected the `SecureCredentialBundle` carrier** ("the config module already has `SecretEntry(key,value,createdAt,updatedAt)` for the secret-read vocabulary; introducing a second bundle type duplicates it — the REC-49 lesson") and kept the **credential read path on `ConfigurationAccess`** (resolved `!secret` values), with per-integration scoping handled by the rotator impl's `integration.<id>.*` key prefix (LTD-17). So the bundle is dropped, no `credentialsFor` read accessor is added, and AMD-68 reduces precisely to the **atomic write surface** Doc 15 §7.3 requires. This collapse is why the M6 config block is exactly the six reserved numbers AMD-66..71 with no seventh amendment. **PM flag for the DOCS review:** `[REVIEW-FLAG AMD-68-A]` — confirm the bundle/`credentialsFor` retirement against ratified AMD-60, and confirm no other consumer depends on them (none found — Research 5 is an assessment, not a frozen contract).

## 2. Specification

### 2.1 New method on `SecretStore` (`com.homesynapse.config`)

```java
/**
 * Atomically stores or updates all given secrets in a single
 * all-or-nothing, durable-before-return write. Either every entry is
 * persisted and the call returns, or none is persisted and the call
 * throws with the store unchanged — a multi-secret credential set
 * (e.g., an OAuth access+refresh-token pair) can never be torn.
 *
 * Creates the secret store file on first use.
 *
 * @param secrets key→plaintext-value entries to encrypt and persist
 *                atomically; never {@code null}, never empty
 * @throws IllegalArgumentException if {@code secrets} is empty
 */
void setAll(Map<String, String> secrets);
```

`SecretStore` grows 4 → 5 methods. The existing single-key `set(key, value)` is retained (it is the `!secret`-resolution write path and the natural single-entry convenience); `setAll` is the all-or-nothing multi-entry path. Implementations should make `set(k, v)` delegate to `setAll(Map.of(k, v))` so atomicity/durability are uniform.

### 2.2 Atomicity + durability contract (M6 implementation obligation)

The implementation persists the encrypted secrets file via the **write-temp-then-atomic-rename** pattern (the same fsync-before-rename discipline the config write path uses for the YAML file): encrypt all entries, write the complete updated `secrets.enc` to a temp file, `fsync`, atomically `rename` over the live file, `fsync` the directory. (E68-1: `secrets.enc` — the name both Locked docs use, Doc 06 §3.4/§4.8 + Doc 15 §3.8; the content is encrypted JSON, not YAML.) A crash before the rename leaves the prior file intact (all-or-nothing); after the rename, all entries are durable (durable-before-return). This satisfies AMD-60-INV-03 at the store layer so the M9 `CredentialRotator` impl inherits it by calling `setAll`.

## 3. Downstream Impact

- **AMD-60 `CredentialRotator` (integration-api, M9 impl):** the M9 rotator implementation writes through `SecretStore.setAll(Map)` — this is the "implementation-time coupling" AMD-60 §3 anticipated ("the M9 rotator implementation writes through the config system's secret store … M6"). No change to AMD-60's interface; this AMD supplies the store method it relies on.
- **`ConfigurationAccess` / `SecretEntry`:** **unchanged** (§1.2 — the credential read path stays here per AMD-60; no bundle type).
- **Shared root (Doc 15 §7.3):** the secret store becomes one scope (`scope_id = "config_secrets"`) under the shared machine-local root at MVP — but that key-hierarchy unification is M6.2 / Doc-15 work; **AMD-68 is only the `setAll` API addition** (it does not, by itself, re-root the secret store — that is the M6.2 `ScopeKeyManager` integration, gated on the crypto side).
- **No JPMS change.** `setAll` references only `java.util.Map` (`java.base`) and same-module types. The §7 verbatim `module-info.java` is unchanged.

## 4. Implementation Notes

`setAll` is the **transactional** write; `remove`/`set` keep their semantics. The encrypted file is rewritten in full on every mutation (the secret set is small — integration credentials — so full-file rewrite under atomic-rename is correct and simplest; no partial in-place edits). Thread-safety: writes serialize internally (the existing `SecretStore` contract — "Write operations … are serialized internally"). The Doc 15 §7.3 shared-root reconciliation (secret store as a key-hierarchy scope) is **M6.2**, not this AMD.

## 5. Tests (M6 scope)

| Test | Assertion |
|---|---|
| `SecretStoreTest.setAllPersistsAllEntries` | every entry in the map is `resolve`-able after `setAll` returns |
| `…setAllIsAllOrNothingOnFailure` | a simulated write failure mid-`setAll` leaves the store exactly as before (no partial apply) — the torn-pair guard |
| `…setAllDurableBeforeReturn` | after `setAll` returns, a fresh `SecretStore` over the same file reads all entries (survives "restart") |
| `…setAllRejectsEmpty` | empty map → `IllegalArgumentException` |
| `…setDelegatesToSetAll` | single-key `set` shares the atomic/durable path |

## 6. Scope Fences / Deferred

NO `SecureCredentialBundle` type (retired, §1.2). NO `credentialsFor` read accessor (retired, §1.2). NO `CredentialRotator` implementation (M9). NO shared-root re-rooting of the secret store (M6.2 / Doc 15 §7.3). NO Argon2id (AMD-69).

## 7. Invariants and Citations

- **AMD-68-INV-01:** `SecretStore.setAll(Map)` is all-or-nothing and durable-before-return — it is the store-layer guarantee beneath AMD-60-INV-03; a multi-secret set can never be torn by a crash.
- Cites: Doc 15 §7.3 (the requirement, verbatim); AMD-60 §2.1/§9 R7/A5 + AMD-60-INV-03 (the consumer + the retired bundle); Doc 06 §3.4/§8.5 (`SecretStore`); LTD-17 (integration-scoped rotation).

**Verbatim `module-info.java` (`com.homesynapse.config`, at `6c6dd33`) — unchanged by this AMD:**

```java
module com.homesynapse.config {
    requires transitive com.homesynapse.event;

    exports com.homesynapse.config;
}
```

## 8. Implementing WU

**M6.2** (secret store + per-scope key-management infrastructure) — `setAll`'s atomic-durable file write lands with the secret-store implementation. The interface addition can be frozen at M6.1 if convenient; the durable implementation is M6.2.

## 9. Ratification Checklist

- [x] DOCS-Project review returned; deltas folded — 2026-06-09 (E68-1 folded, commit `aedff55`; `[AMD-68-A]` retirement VERIFIED)
- [x] Nick ratification — 2026-06-09
- [x] AMD-68-INV-01 registered in `Architecture_Invariants_v1.md` (§39) — 2026-06-09
- [x] Navigation-index amendments row added (watermark unchanged — 68 < 87) — 2026-06-09

## 10. Review Disposition

**DOCS-Project review (2026-06-09): RATIFY-WITH-EDITS — E68-1 (`secrets.yaml.enc` → `secrets.enc`, the name both Locked docs use), folded by the PM 2026-06-09 and committed at docs `aedff55`.** Return: nexsys-hivemind `context/audits/2026-06-09_AMD-66-71_DOCS_Review_Return.md` (block verdict RATIFY-WITH-EDITS; source baseline re-derived independently at `6c6dd33`). `[AMD-68-A]` **VERIFIED, stands:** ratified AMD-60 §2.1/§9 (R7/A5) rejected the `SecureCredentialBundle` carrier and kept reads on `ConfigurationAccess`; `SecureCredentialBundle`/`credentialsFor` have zero references in core source — no orphaned consumer. The review confirmed `setAll(Map)` is the correct and sufficient store-layer discharge of AMD-60-INV-03 (the write-temp → fsync → atomic-rename → fsync-dir mechanism in §2.2). The §7 verbatim `module-info.java` embed source-verified at `6c6dd33`. Ratified by Nick 2026-06-09 at the M6 config-block ratification (watermark unchanged at AMD-87). Implementing WU M6.2's gate is now half-satisfied (AMD-68 ratified; still gated on M6.1 landing).
