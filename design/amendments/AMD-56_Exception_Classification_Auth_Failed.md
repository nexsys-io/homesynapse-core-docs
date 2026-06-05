<!--
file: design/amendments/AMD-56_Exception_Classification_Auth_Failed.md
purpose: AMD-56 — add AUTH_FAILED to the integration-runtime ExceptionClassification enum (REC-43).
audience: Nick (ratify), PM, Coder
status: RATIFIED 2026-06-05 — DOCS-Project review (RATIFY-WITH-EDITS; E4 folded) + Nick arbitration A4; review return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`
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
 * implement re-auth ({@code ReauthOutcome.UNSUPPORTED} — the AMD-55 default),
 * the supervisor degrades to the standard suspension policy with the failure
 * reason preserved.
 */
AUTH_FAILED
```

Position: after `PERMANENT`, before `SHUTDOWN_SIGNAL`? **No — append last** (after `SHUTDOWN_SIGNAL`). Enum ordinal stability for any persisted/serialized ordinal is not a current concern (classification is in-memory), but appending is the zero-risk convention (the AMD-44 EntityType source-order lesson: declaration order is load-bearing for `values()` iteration and test pinning).

**Classification trigger (M9 contract, frozen here):** a new exception type is NOT added by this AMD. To make the code-based route implementable (review E4: at `e76b925` `PermanentIntegrationException` hard-codes `errorCode() = "integration.permanent_failure"` and has no code-bearing constructor), this AMD adds a **code-bearing constructor pair** to the existing `PermanentIntegrationException` (integration-api; no JPMS change):

```java
public PermanentIntegrationException(String errorCode, String message)
public PermanentIntegrationException(String errorCode, String message, Throwable cause)
```

The existing two constructors are preserved unchanged and continue to yield the default code `integration.permanent_failure` — append-only, back-compatible, zero caller breakage. Guard: `errorCode` must be a non-blank, dotted, lowercase Register C code (`IllegalArgumentException` otherwise). M9's classifier maps to `AUTH_FAILED` from (a) a `PermanentIntegrationException` whose `errorCode()` is **`integration.auth_failed`** (Register C, new well-known code documented here), or (b) future typed auth exceptions if M9 finds the code-based route insufficient — that choice is deliberately left to M9.

**[REVIEW-FLAG R3 — RESOLVED (review 2026-06-05 + Nick arbitration A4).]** REC-43 *did* propose a dedicated type — verbatim from the inline return: *"Also add `IntegrationAuthException extends RuntimeException` to `integration-api` as the canonical signal type."* **Declined by arbitration:** the code-bearing surface on the existing type suffices, and the researcher's `RuntimeException` base contradicts the shipped checked `HomeSynapseException` hierarchy (source-verified `abstract class HomeSynapseException extends Exception`). No new type; the no-new-type stance survives.

## 3. Downstream Impact

- **Exhaustive-switch audit:** any `switch` over `ExceptionClassification` must be located and extended — at `e76b925` the supervisor is Phase-2 skeleton (`IntegrationSupervisor`, `SlidingWindow`, `IntegrationHealthRecord` only), so the expected production blast radius is zero; the M4.C survey gate confirms by grep. Downstream Phase 3 code (M9 supervisor, automation subscribers) must use no-`default` exhaustive switches so this addition surfaces at compile time (house rule, AMD-47/51/52 precedent).
- **AMD-55/58 coupling:** `AUTH_FAILED` → `onReauthRequired()` (→ `ReauthOutcome`) → `integration.reauth.required`/`integration.reauth.completed` is the complete reauth loop.
- **`PermanentIntegrationException` constructor pair (§2):** append-only — existing construction sites compile and behave unchanged (M4.C survey gate greps construction sites; expected blast radius: testFixtures + adapter tests only).
- **No JPMS change** (`com.homesynapse.integration.runtime` already exported; the exception lives in `com.homesynapse.integration`, also already exported).

## 4. Tests (M4.C scope)

| Test | Assertion |
|---|---|
| `ExceptionClassificationTest.hasFourValues` | exactly 4 values, declaration order `TRANSIENT, PERMANENT, SHUTDOWN_SIGNAL, AUTH_FAILED` |
| `PermanentIntegrationExceptionTest.codeBearingCtor` (new) | `errorCode()` returns the supplied code; no-code ctors return `integration.permanent_failure`; blank/malformed code → `IllegalArgumentException` |
| Javadoc/code audit (gate, not test) | no `switch` over the enum gains a silent `default` arm |

## 5. Scope Fences / Deferred

NO classifier implementation, NO new exception types, NO routing code (all M9).

## 6. Invariants and Citations

- **AMD-56-INV-01:** `AUTH_FAILED` never routes to transient backoff retry; its remediation path is reauth-or-suspend. (M9 behavioral test; contract frozen here.)
- **AMD-56-INV-02:** the enum is append-only; existing declaration order frozen.
- **AMD-56-INV-03:** `PermanentIntegrationException` constructors are append-only; the no-code constructors permanently yield `integration.permanent_failure`; well-known codes (`integration.auth_failed`) are documented here before use.
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

- [x] DOCS-Project review (R3 resolved — see §2) — 2026-06-05
- [x] Nick ratification — 2026-06-05
- [x] Invariants registered (`Architecture_Invariants_v1.md` §26)

## 9. Review Disposition

**DOCS-Project review (2026-06-05): RATIFY-WITH-EDITS — E4 folded.** Return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`.

- **R3 (G1 fidelity):** REC-43 proposed BOTH the enum value and a dedicated `IntegrationAuthException extends RuntimeException` (quoted verbatim in §2). Type declined by Nick arbitration A4 — see §2.
- **E4 → Nick arbitration A4 (2026-06-05):** the original route-(a) trigger was unimplementable (shipped `errorCode()` hard-coded; no code-bearing constructor — producing `integration.auth_failed` would have required a subclass, i.e. the new type this AMD declines). Fixed via the append-only code-bearing constructor pair on the existing type (§2); frozen as AMD-56-INV-03.
- Append-last enum position (vs. the research's third-position `AUTH_FAILED`) verified as a sound, documented deviation (AMD-44 declaration-order lesson).

Ratified by Nick 2026-06-05.
