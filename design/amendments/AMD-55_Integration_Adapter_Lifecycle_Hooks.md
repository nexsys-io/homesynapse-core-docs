<!--
file: design/amendments/AMD-55_Integration_Adapter_Lifecycle_Hooks.md
purpose: AMD-55 — four post-setup lifecycle hooks on IntegrationAdapter (onConfigUpdated, onOptionsUpdated, onReauthRequired, migrate) + outcome enums (REC-41 hooks half).
audience: Nick (ratify), PM, Coder
status: RATIFIED 2026-06-05 — DOCS-Project review (RATIFY-WITH-EDITS; E1/E2/E3 folded) + Nick arbitration A3 + E3 ruling; review return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`
source: Research 6 REC-41 ACCEPT(MODIFY) + NQ-2 (consumes AMD-54's version pair) + Research 6 §1 Verdict 2 (retroactive-amendment-tax argument)
baseline: homesynapse-core HEAD `e76b925` — IntegrationAdapter source-verified: exactly 4 declared methods (initialize, run, close, commandHandler)
-->

# AMD-55: IntegrationAdapter Post-Setup Lifecycle Hooks

## 1. Problem Statement

`IntegrationAdapter` (source-verified at `e76b925`: `initialize() throws PermanentIntegrationException`, `run() throws Exception`, `close()`, `CommandHandler commandHandler()`) has no post-setup lifecycle surface. Home Assistant's ConfigEntry flow demonstrates four flows real adapters need that today force a full stop/start cycle (losing in-flight commands and radio state): config reload, runtime options tuning, re-authentication, and config schema migration. Adding these hooks **before** the M4 freeze avoids the retroactive-amendment tax Research 6 §1 Verdict 2 documents — every adapter written against a hookless interface would need rework when M9's supervisor ships these flows.

## 2. Specification

### 2.1 Three outcome enums (new, `com.homesynapse.integration`)

```java
public enum ConfigUpdateOutcome { APPLIED, RESTART_REQUIRED, REJECTED }
public enum MigrationOutcome { MIGRATED, NOT_REQUIRED }
public enum ReauthOutcome { INITIATED, UNSUPPORTED }
```

**`REJECTED` (ratification edit E3, Nick ruling 2026-06-05):** the adapter could not apply the new config in place and the new config must not take effect. Defined, safe recovery: the supervisor restores the prior config section — which remains the valid running config — via a planned restart (M9 behavior; contract frozen here). The outcome-enum channel, not exception-typing, is the established hook-result pattern: `PermanentIntegrationException` drives FAILED + no-retry semantics, far too heavy for a bad config edit.

**`ReauthOutcome` (ratification edit E2 → arbitration A3, 2026-06-05):** the supervisor must distinguish "adapter has initiated async reauth" (`INITIATED` — await `integration.reauth.completed`, AMD-58) from "adapter does not implement reauth" (`UNSUPPORTED` — proceed directly to the standard suspension policy, AMD-56). Fidelity-checked against the inline Research 6 return: REC-41 names only `UNSUPPORTED`; no `FAILED` member exists in REC-41/§7.2, so none was added.

### 2.2 Four hooks — ALL `default` methods on `IntegrationAdapter`

```java
/** Config changed at runtime. Default: conservative — request restart-to-apply. */
default ConfigUpdateOutcome onConfigUpdated(ConfigChangeSet changes) {
    return ConfigUpdateOutcome.RESTART_REQUIRED;
}

/** Runtime-tunable options changed (the additive/minor subset of config —
 *  polling intervals, rate limits, log verbosity). Default: conservative. */
default ConfigUpdateOutcome onOptionsUpdated(ConfigChangeSet changes) {
    return ConfigUpdateOutcome.RESTART_REQUIRED;
}

/** Supervisor detected AUTH_FAILED (AMD-56). INITIATED: the adapter has begun
 *  asynchronous re-auth and signals completion via the
 *  integration.reauth.completed lifecycle event (AMD-58). UNSUPPORTED: the
 *  adapter does not implement re-auth — the supervisor falls back to the
 *  standard restart/suspension policy. Default: UNSUPPORTED. */
default ReauthOutcome onReauthRequired() {
    return ReauthOutcome.UNSUPPORTED;
}

/** Stored config schema (AMD-54 pair) is older than the adapter declares.
 *  Invoked BEFORE initialize(). The adapter migrates its config section via
 *  the injected ConfigurationAccess. Default: nothing to migrate. */
default MigrationOutcome migrate(int fromMajor, int fromMinor)
        throws PermanentIntegrationException {
    return MigrationOutcome.NOT_REQUIRED;
}
```

`ConfigChangeSet` is the existing `com.homesynapse.config` record (`Instant timestamp, List<ConfigChange> changes` — source-verified at `e76b925`); integration-api already `requires transitive com.homesynapse.config`, so **no JPMS change**.

### 2.3 Sequencing contract

- All hooks run on the adapter's allocated thread, **sequentially** with the lifecycle methods — never concurrent with `run()`'s processing of the same shared state without the adapter's own coordination (the adapter is single-threaded by contract; the supervisor delivers hook invocations through the same serialization discipline as command dispatch).
- `migrate(...)` ordering: detected mismatch → `migrate` → `initialize` → `run`. A `PermanentIntegrationException` from `migrate` → `FAILED` (no retry), mirroring `initialize`.
- `onConfigUpdated`/`onOptionsUpdated` returning `RESTART_REQUIRED` → supervisor schedules a **planned restart** (interacts with AMD-64's `plannedRestartTimeout`; emits `integration.config.updated` with outcome — AMD-58).
- `onConfigUpdated`/`onOptionsUpdated` returning `REJECTED` → the new config does **not** take effect; the supervisor restores the prior config section and schedules a planned restart on it (the prior config remains the valid running config). Emits `integration.config.updated`/`integration.options.updated` with outcome `REJECTED` (AMD-58).
- `onReauthRequired` returning `UNSUPPORTED` → supervisor proceeds directly to the standard suspension policy (AMD-56); `INITIATED` → supervisor awaits `integration.reauth.completed` (the await/timeout mechanics are M9's).

### 2.4 Backward compatibility (the load-bearing design choice)

All four hooks are `default` methods → every existing `IntegrationAdapter` implementation (including the `TestAdapter` testFixture) compiles and behaves unchanged. The conservative `RESTART_REQUIRED` defaults mean an adapter that ignores the hooks keeps today's restart-to-apply semantics — defaults never silently claim a capability the adapter does not have (and the `UNSUPPORTED` reauth default tells the supervisor, truthfully, that no reauth path exists).

## 3. Downstream Impact

- **AMD-56:** `AUTH_FAILED` classification is the trigger for `onReauthRequired`.
- **AMD-58:** the five new lifecycle events are emitted by the supervisor around these hook flows.
- **TestAdapter / StubIntegrationContext (testFixtures):** compile unchanged (defaults); `TestAdapter.Builder` MAY gain hook-override hooks in M4.C tests (Coder HOW-freedom).
- **No JPMS / Gradle / module-info change.**

## 4. Implementation Notes

The interface-evolution checklist applies: grep for shape tests asserting `getDeclaredMethods().length` on `IntegrationAdapter` before landing (M4.C STOP gate); 4 → 8 declared methods (4 existing + 4 default hooks; the 3 outcome enums are separate files) — count corrected per review edit E1.

## 5. Tests (M4.C scope)

| Test | Assertion |
|---|---|
| `IntegrationAdapterDefaultsTest.configDefaultIsRestartRequired` | anonymous impl returns `RESTART_REQUIRED` from both update hooks |
| `IntegrationAdapterDefaultsTest.migrateDefaultIsNotRequired` | default `migrate` → `NOT_REQUIRED`, no exception |
| `IntegrationAdapterDefaultsTest.reauthDefaultIsUnsupported` | default `onReauthRequired` → `ReauthOutcome.UNSUPPORTED` |
| `OutcomeEnumsTest` (new) | `ConfigUpdateOutcome` = 3 values, `MigrationOutcome` = 2, `ReauthOutcome` = 2; declaration order pinned |
| Existing `TestAdapter` suites | unchanged — proves binary/source compatibility |

## 6. Scope Fences / Deferred

- NO supervisor invocation machinery (M9: `ConfigUpdateApplier`, `ReauthDispatcher`, `AdapterMigrationRunner` — note the REC-52 rename, the persistence `MigrationRunner` collision is real, source-verified).
- NO options-vs-config schema partition mechanics (M6/M9 define which keys are "options"; the hook *shape* freezes now). **[REVIEW-FLAG R1 — RESOLVED (review 2026-06-05): CONFIRMED.]** The inline Research 6 return never defines the options/config partition; only the hook shape is M4-blocking (return §1 Verdict 2). Deferral matches the research's intent.

## 7. Invariants and Citations

- **AMD-55-INV-01:** all four hooks are `default`; a pre-AMD-55 adapter remains source- and binary-compatible, with behavior identical to today.
- **AMD-55-INV-02:** hooks execute sequentially on the adapter's thread; the supervisor never invokes a hook concurrently with another lifecycle method.
- **AMD-55-INV-03:** `migrate` runs before `initialize` on schema mismatch; `PermanentIntegrationException` from `migrate` → FAILED without retry (Doc 05 §3.7 extension).
- **AMD-55-INV-04:** a `REJECTED` config/options apply never leaves the rejected config active — the supervisor restores the prior config section (planned restart on it); the prior config remains the valid running config. (M9 behavioral test; contract frozen here per the E3 ruling.)
- Cites: Doc 05 §8.1/§8.4 (lifecycle), §3.7 (classification); INV-RF-03 (hooks must not block on device connectivity — same rule as `initialize`); AMD-54 (version pair); LTD-17 (hooks receive only context-mediated services).

Module-info: unchanged — see AMD-54 §7 verbatim embed.

## 8. Implementing WU

**M4.C.** Supervisor flows = M9.

## 9. Ratification Checklist

- [x] DOCS-Project review (R2 run against the inline return — diffs in the return §2.R2) — 2026-06-05
- [x] Nick ratification — 2026-06-05
- [x] Invariants registered (`Architecture_Invariants_v1.md` §25)

## 10. Review Disposition

**DOCS-Project review (2026-06-05): RATIFY-WITH-EDITS — all edits folded.** Return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`.

- **R2 (G1 fidelity, run against the inline Research 6 return):** hook signatures diffed against §REC-41 verbatim (return §2.R2). `ConfigChangeSet` substitution VERIFIED SOUND — the research's `IntegrationConfig`/`IntegrationOptions`/`ReauthContext`/`IntegrationConfigException` types do not exist at `e76b925`, and `ConfigChange(sectionPath, key, oldValue, newValue, reload)` preserves the research's load-bearing old/new-diff requirement at finer grain. `migrate` narrowing VERIFIED SOUND (to-pair = the adapter's own AMD-54 declaration; old config via `ConfigurationAccess`; `MigrationOutcome` clearer than the researcher's overloaded boolean).
- **E1 (mechanical):** §4 declared-member count corrected 10 → 8.
- **E2 → Nick arbitration A3 (2026-06-05):** `onReauthRequired` now returns `ReauthOutcome { INITIATED, UNSUPPORTED }`, default `UNSUPPORTED` — the supervisor must distinguish "reauth initiated" from "not implemented"; the researcher's `UNSUPPORTED` member existed precisely for this. Fidelity check: the return names no `FAILED` member, so none was added.
- **E3 → Nick ruling (2026-06-05):** `REJECTED` added to `ConfigUpdateOutcome` — outcome-enum channel over exception-typing; `PermanentIntegrationException` drives FAILED semantics, too heavy for a bad config edit; `REJECTED` has a defined safe recovery (prior config remains valid; supervisor restarts on it). Frozen as AMD-55-INV-04.
- **R1 (G2):** options-vs-config deferral CONFIRMED against the return — no partition freeze required at M4.

Ratified by Nick 2026-06-05.
