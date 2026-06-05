<!--
file: design/amendments/AMD-60_Security_Services_Aggregator.md
purpose: AMD-60 — SecurityServices aggregator on IntegrationContext + CredentialRotator service (REC-45 per ratified NQ-1).
audience: Nick (ratify), PM, Coder
status: PROPOSED — pending DOCS-Project review + Nick ratification (Workstream C block, AMD-54..64)
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
     * Atomically replace the secret stored under {@code secretKey} for this
     * integration's config section. The write is durable before return.
     * Scoped: an adapter can rotate only its own integration's secrets (LTD-17).
     *
     * @throws IllegalArgumentException if secretKey is unknown to this
     *         integration's declared config schema
     */
    void rotate(String secretKey, String newSecretValue);
}
```

> **[REVIEW-FLAG R7 — PM narrowing.]** The research proposed a `SecureCredentialBundle` carrier in `com.homesynapse.config`. Source verification at `e76b925` found the config module already has `SecretEntry(String key, String value, Instant createdAt, Instant updatedAt)` for the secret-read vocabulary. Introducing a second bundle type duplicates it (the REC-49 lesson: check existing fields before adding). PM narrows to a string-based `rotate` — the rotator is a write-only seam; timestamps are the store's concern. If the review finds the research's bundle carried load-bearing extra fields (e.g., multi-secret atomic rotation for token+refresh-token pairs), widen to `void rotate(Map<String, String> secrets)` — flagged for Nick.

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
| `StubIntegrationContextTest` (extended) | defaults null; builder overrides apply |

## 5. Scope Fences / Deferred

NO rotator implementation (M9). NO secret-store changes (M6). NO reauth orchestration (M9).

## 6. Invariants and Citations

- **AMD-60-INV-01:** `IntegrationContext` grows only by service-family aggregator fields; individual services join their family's aggregator record. (The NQ-1 doctrine, frozen.)
- **AMD-60-INV-02:** `SecurityServices` is nullable on the context, gated by `RequiredService.SECURITY`; inside the aggregator, declared services are non-null.
- **AMD-60-INV-03:** `CredentialRotator.rotate` is integration-scoped (LTD-17) and durable-before-return.
- Cites: NQ-1 (RESOLVED); LTD-17; INV-CE-02 (configAccess always provided — unchanged); F4 (module naming).

Module-info: unchanged — see AMD-54 §7 verbatim embed.

## 7. Implementing WU

**M4.C.**

## 8. Ratification Checklist

- [ ] DOCS-Project review (**R7: SecretEntry-reuse narrowing vs the research's SecureCredentialBundle — soundness verification; PRE-CO-SIGNED by Nick 2026-06-05** [the reuse-existing-types lesson applied]. The widen-to-`rotate(Map<String,String>)` fallback in §2.1 remains live only if the review surfaces load-bearing bundle fields. Formal co-sign at ratification.)
- [ ] Nick ratification (formalizes the R7 pre-co-sign)
- [ ] Invariants registered

## 9. Review Disposition

*(populated at ratification)*
