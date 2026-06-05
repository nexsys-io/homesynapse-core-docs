<!--
file: design/amendments/AMD-60_Security_Services_Aggregator.md
purpose: AMD-60 — SecurityServices aggregator on IntegrationContext + CredentialRotator service (REC-45 per ratified NQ-1).
audience: Nick (ratify), PM, Coder
status: RATIFIED 2026-06-05 — DOCS-Project review (RATIFY-WITH-EDITS; E9 folded per arbitration A5) + R7 co-sign formalized; review return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`
source: Research 6 REC-45 ACCEPT(MODIFY) + NQ-1 (RESOLVED: aggregator, not field-per-service) + F4 (module is com.homesynapse.config, not .configuration)
baseline: homesynapse-core HEAD `e76b925` — IntegrationContext source-verified: 10 components; config module SecretEntry(key, value, createdAt, updatedAt) source-verified
-->

# AMD-60: `SecurityServices` Aggregator and `CredentialRotator`

## 1. Problem Statement

The AMD-55/56 reauth flow ends with the adapter holding fresh credentials (new OAuth token, rotated API key) and **no sanctioned write path** to store them: `ConfigurationAccess` on `IntegrationContext` (10 components, source-verified) is the read surface, and adapters must not write config files directly (LTD-17). Cloud-connected adapters need credential rotation as a first-class, supervised service. Per ratified NQ-1, this and future security services arrive as **one aggregator field**, not field-per-service growth.

## 2. Specification

### 2.1 `CredentialRotator` (new interface, `com.homesynapse.integration`)

```java
public interface CredentialRotator {
    /**
     * Atomically replace the secrets stored under the given keys for this
     * integration's config section — all entries land in one durable,
     * all-or-nothing write (an OAuth access+refresh token pair can never be
     * torn). Durable before return.
     * Scoped: an adapter can rotate only its own integration's secrets (LTD-17).
     *
     * @throws IllegalArgumentException if {@code secrets} is empty or any key
     *         is unknown to this integration's declared config schema
     */
    void rotate(Map<String, String> secrets);

    /** Single-secret convenience; delegates to {@link #rotate(Map)}. */
    default void rotate(String secretKey, String newSecretValue) {
        rotate(Map.of(secretKey, newSecretValue));
    }
}
```

> **[REVIEW-FLAG R7 — RESOLVED (review 2026-06-05 + Nick arbitration A5).]** The research proposed a `SecureCredentialBundle` carrier in `com.homesynapse.config`. Source verification at `e76b925` found the config module already has `SecretEntry(String key, String value, Instant createdAt, Instant updatedAt)` for the secret-read vocabulary; introducing a second bundle type duplicates it (the REC-49 lesson). **Review finding:** the inline return never enumerates bundle fields (the strict widen-trigger was not met — `rotate(IntegrationId id, SecureCredentialBundle bundle)` / `current(IntegrationId id)` are its only appearances), but the bundle's *atomicity* is load-bearing for the OAuth adapters the return names (§1 Verdict 5): single-key rotate with per-call durability can tear an access+refresh token pair. **Arbitration A5: widened to `rotate(Map<String,String>)` as the primary signature** with a `default` single-key convenience delegating to it. The SecretEntry-reuse narrowing itself stands as pre-co-signed: no bundle type; the `current(...)` read path stays on `ConfigurationAccess`; timestamps are the store's concern. (`Map` is `java.base` — no JPMS impact.)

### 2.2 `SecurityServices` aggregator (new record, `com.homesynapse.integration`)

```java
public record SecurityServices(CredentialRotator credentialRotator) {
    public SecurityServices {
        Objects.requireNonNull(credentialRotator, "credentialRotator must not be null");
    }
}
```

Future security services (e.g., certificate provisioning) become components of this record — `IntegrationContext` never grows for them (AMD-60-INV-01).

### 2.3 `IntegrationContext` change

`SecurityServices security` appended as component 11 (with AMD-59's `DiscoveryServices discovery` as 12). **Nullable**, gated by new `RequiredService.SECURITY` — exactly the established optional-service pattern (source-verified gotcha: "null is the expected value when not requested; do not add null checks that throw"). 10-arg convenience constructor preserves all existing callers. `RequiredService` grows 3 → 5 across AMD-59/60 (`DISCOVERY`, `SECURITY` appended after `TELEMETRY_WRITER`).

## 3. Downstream Impact

- **StubIntegrationContext (testFixtures):** `defaults()` leaves both new fields null; `Builder` gains overrides. `StubIntegrationContextTest` (39 methods, source-verified count) extends.
- **config module:** untouched in M4. The M9 rotator implementation writes through the config system's secret store (AES-256-GCM surface, M6) — implementation-time coupling, not contract coupling.
- **No JPMS change** (config types referenced are already `requires transitive`).

## 4. Tests (M4.C scope)

| Test | Assertion |
|---|---|
| `IntegrationContextTest` (extended) | 12 components; `security`/`discovery` nullable; convenience ctor defaults both null |
| `SecurityServicesTest` (new) | null `credentialRotator` → NPE at construction |
| `RequiredServiceTest` (extended) | 5 values, declaration order pinned (append-only) |
| `CredentialRotatorDefaultTest` (new) | single-key `rotate` delegates to `rotate(Map.of(k, v))` (recording stub) |
| `StubIntegrationContextTest` (extended) | defaults null; builder overrides apply |

## 5. Scope Fences / Deferred

NO rotator implementation (M9). NO secret-store changes (M6). NO reauth orchestration (M9).

## 6. Invariants and Citations

- **AMD-60-INV-01:** `IntegrationContext` grows only by service-family aggregator fields; individual services join their family's aggregator record. (The NQ-1 doctrine, frozen.)
- **AMD-60-INV-02:** `SecurityServices` is nullable on the context, gated by `RequiredService.SECURITY`; inside the aggregator, declared services are non-null.
- **AMD-60-INV-03:** `CredentialRotator.rotate` is integration-scoped (LTD-17), atomic across all entries of a single call (all-or-nothing — a token+refresh-token pair can never be torn), and durable-before-return.
- Cites: NQ-1 (RESOLVED); LTD-17; INV-CE-02 (configAccess always provided — unchanged); F4 (module naming).

Module-info: unchanged — see AMD-54 §7 verbatim embed.

## 7. Implementing WU

**M4.C.**

## 8. Ratification Checklist

- [x] DOCS-Project review (R7 verified; widen adopted per arbitration A5 — see §2.1) — 2026-06-05
- [x] Nick ratification — R7 co-sign FORMALIZED 2026-06-05
- [x] Invariants registered (`Architecture_Invariants_v1.md` §30)

## 9. Review Disposition

**DOCS-Project review (2026-06-05): RATIFY-WITH-EDITS — E9 folded per arbitration A5; R7 co-sign formalized.** Return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`.

- **R7 (G2 soundness):** the inline return never enumerates `SecureCredentialBundle` fields — the strict widen-trigger was not met — but the review surfaced the bundle's implied atomicity as load-bearing for the return's named OAuth use cases (token+refresh-token pairs; torn-write risk under per-call durability). **Arbitration A5: `rotate(Map<String,String>)` adopted as primary** with a `default` single-key convenience. SecretEntry-reuse narrowing (no bundle type; read path on `ConfigurationAccess`) stands as pre-co-signed. AMD-60-INV-03 strengthened to atomic-across-entries.
- Deviation recorded: the return's `CompletableFuture<Void>` async rotate → synchronous durable-before-return (sound under the one-virtual-thread-per-adapter model).

Ratified by Nick 2026-06-05.
