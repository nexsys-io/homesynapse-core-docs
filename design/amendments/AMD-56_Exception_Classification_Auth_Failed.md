<!--
file: design/amendments/AMD-56_Exception_Classification_Auth_Failed.md
purpose: AMD-56 — add AUTH_FAILED to the integration-runtime ExceptionClassification enum (REC-43).
audience: Nick (ratify), PM, Coder
status: PROPOSED — pending DOCS-Project review + Nick ratification (Workstream C block, AMD-54..64)
source: Research 6 REC-43 ACCEPT (wording fix F8: the type is the enum ExceptionClassification — no ExceptionClassifier service exists)
baseline: homesynapse-core HEAD `e76b925` — ExceptionClassification source-verified: 3 values (TRANSIENT, PERMANENT, SHUTDOWN_SIGNAL), com.homesynapse.integration.runtime
-->

# AMD-56: `AUTH_FAILED` on `ExceptionClassification`

## 1. Problem Statement

The supervisor's exception taxonomy (`com.homesynapse.integration.runtime.ExceptionClassification`, source-verified 3 values: `TRANSIENT`, `PERMANENT`, `SHUTDOWN_SIGNAL`) cannot distinguish an authentication failure from a generic permanent failure. Auth failures have a distinct, recoverable remediation path — re-authentication (AMD-55 `onReauthRequired`) — that neither transient backoff (pointless: retrying with a dead token) nor permanent failure (wrong: the user can fix it) models. Every surveyed platform (HA `ConfigEntryAuthFailed`, openHAB `CONFIGURATION_ERROR`/auth distinction) separates this class.

## 2. Specification

Add a fourth value:

```java
/**
 * Authentication or authorization failure against the external system —
 * expired token, revoked credentials, rejected API key. Retry with backoff
 * cannot succeed; the remediation path is re-authentication: the supervisor
 * invokes {@code IntegrationAdapter.onReauthRequired()} and emits
 * {@code integration.reauth.required} (AMD-58). If the adapter does not
 * implement re-auth (default no-op hook), the supervisor degrades to the
 * standard suspension policy with the failure reason preserved.
 */
AUTH_FAILED
```

Position: after `PERMANENT`, before `SHUTDOWN_SIGNAL`? **No — append last** (after `SHUTDOWN_SIGNAL`). Enum ordinal stability for any persisted/serialized ordinal is not a current concern (classification is in-memory), but appending is the zero-risk convention (the AMD-44 EntityType source-order lesson: declaration order is load-bearing for `values()` iteration and test pinning).

**Classification trigger (M9 contract, frozen here):** a new exception type is NOT added by this AMD. M9's classifier maps to `AUTH_FAILED` from (a) a `PermanentIntegrationException` whose error code is `integration.auth_failed` (Register C, new well-known code documented here), or (b) future typed auth exceptions if M9 finds the code-based route insufficient — that choice is deliberately left to M9. **[REVIEW-FLAG R3]** — confirm against the Research 6 return whether REC-43 proposed a dedicated exception type; the assessment records only the enum addition.

## 3. Downstream Impact

- **Exhaustive-switch audit:** any `switch` over `ExceptionClassification` must be located and extended — at `e76b925` the supervisor is Phase-2 skeleton (`IntegrationSupervisor`, `SlidingWindow`, `IntegrationHealthRecord` only), so the expected production blast radius is zero; the M4.C survey gate confirms by grep. Downstream Phase 3 code (M9 supervisor, automation subscribers) must use no-`default` exhaustive switches so this addition surfaces at compile time (house rule, AMD-47/51/52 precedent).
- **AMD-55/58 coupling:** `AUTH_FAILED` → `onReauthRequired()` → `integration.reauth.required`/`integration.reauth.completed` is the complete reauth loop.
- **No JPMS change** (`com.homesynapse.integration.runtime` already exported).

## 4. Tests (M4.C scope)

| Test | Assertion |
|---|---|
| `ExceptionClassificationTest.hasFourValues` | exactly 4 values, declaration order `TRANSIENT, PERMANENT, SHUTDOWN_SIGNAL, AUTH_FAILED` |
| Javadoc/code audit (gate, not test) | no `switch` over the enum gains a silent `default` arm |

## 5. Scope Fences / Deferred

NO classifier implementation, NO new exception types, NO routing code (all M9).

## 6. Invariants and Citations

- **AMD-56-INV-01:** `AUTH_FAILED` never routes to transient backoff retry; its remediation path is reauth-or-suspend. (M9 behavioral test; contract frozen here.)
- **AMD-56-INV-02:** the enum is append-only; existing declaration order frozen.
- Cites: Doc 05 §3.7 (exception classification); F8 (no `ExceptionClassifier` service — the enum is the surface); INV-HO-04 (failure reasons in Register C voice).

Module-info (integration-runtime, verbatim at `e76b925`) — unchanged:

```java
module com.homesynapse.integration.runtime {
    requires transitive com.homesynapse.integration;

    exports com.homesynapse.integration.runtime;
}
```

## 7. Implementing WU

**M4.C.**

## 8. Ratification Checklist

- [ ] DOCS-Project review (R3 resolved)
- [ ] Nick ratification
- [ ] Invariants registered

## 9. Review Disposition

*(populated at ratification)*
