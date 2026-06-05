<!--
file: design/amendments/AMD-55_Integration_Adapter_Lifecycle_Hooks.md
purpose: AMD-55 — four post-setup lifecycle hooks on IntegrationAdapter (onConfigUpdated, onOptionsUpdated, onReauthRequired, migrate) + outcome enums (REC-41 hooks half).
audience: Nick (ratify), PM, Coder
status: PROPOSED — pending DOCS-Project review + Nick ratification (Workstream C block, AMD-54..64)
source: Research 6 REC-41 ACCEPT(MODIFY) + NQ-2 (consumes AMD-54's version pair) + Research 6 §1 Verdict 2 (retroactive-amendment-tax argument)
baseline: homesynapse-core HEAD `e76b925` — IntegrationAdapter source-verified: exactly 4 declared methods (initialize, run, close, commandHandler)
-->

# AMD-55: IntegrationAdapter Post-Setup Lifecycle Hooks

## 1. Problem Statement

`IntegrationAdapter` (source-verified at `e76b925`: `initialize() throws PermanentIntegrationException`, `run() throws Exception`, `close()`, `CommandHandler commandHandler()`) has no post-setup lifecycle surface. Home Assistant's ConfigEntry flow demonstrates four flows real adapters need that today force a full stop/start cycle (losing in-flight commands and radio state): config reload, runtime options tuning, re-authentication, and config schema migration. Adding these hooks **before** the M4 freeze avoids the retroactive-amendment tax Research 6 §1 Verdict 2 documents — every adapter written against a hookless interface would need rework when M9's supervisor ships these flows.

## 2. Specification

### 2.1 Two outcome enums (new, `com.homesynapse.integration`)

```java
public enum ConfigUpdateOutcome { APPLIED, RESTART_REQUIRED }
public enum MigrationOutcome { MIGRATED, NOT_REQUIRED }
```

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

/** Supervisor detected AUTH_FAILED (AMD-56). The adapter initiates re-auth
 *  asynchronously and signals completion via the integration.reauth.completed
 *  lifecycle event (AMD-58). Default: no-op — supervisor falls back to the
 *  standard restart/suspension policy. */
default void onReauthRequired() { }

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

### 2.4 Backward compatibility (the load-bearing design choice)

All four hooks are `default` methods → every existing `IntegrationAdapter` implementation (including the `TestAdapter` testFixture) compiles and behaves unchanged. The conservative `RESTART_REQUIRED` defaults mean an adapter that ignores the hooks keeps today's restart-to-apply semantics — defaults never silently claim a capability the adapter does not have.

## 3. Downstream Impact

- **AMD-56:** `AUTH_FAILED` classification is the trigger for `onReauthRequired`.
- **AMD-58:** the five new lifecycle events are emitted by the supervisor around these hook flows.
- **TestAdapter / StubIntegrationContext (testFixtures):** compile unchanged (defaults); `TestAdapter.Builder` MAY gain hook-override hooks in M4.C tests (Coder HOW-freedom).
- **No JPMS / Gradle / module-info change.**

## 4. Implementation Notes

The interface-evolution checklist applies: grep for shape tests asserting `getDeclaredMethods().length` on `IntegrationAdapter` before landing (M4.C STOP gate); 4 → 10 declared members (4 existing + 4 default hooks; the 2 enums are separate files).

## 5. Tests (M4.C scope)

| Test | Assertion |
|---|---|
| `IntegrationAdapterDefaultsTest.configDefaultIsRestartRequired` | anonymous impl returns `RESTART_REQUIRED` from both update hooks |
| `IntegrationAdapterDefaultsTest.migrateDefaultIsNotRequired` | default `migrate` → `NOT_REQUIRED`, no exception |
| `IntegrationAdapterDefaultsTest.reauthDefaultIsNoOp` | default `onReauthRequired` returns normally |
| Existing `TestAdapter` suites | unchanged — proves binary/source compatibility |

## 6. Scope Fences / Deferred

- NO supervisor invocation machinery (M9: `ConfigUpdateApplier`, `ReauthDispatcher`, `AdapterMigrationRunner` — note the REC-52 rename, the persistence `MigrationRunner` collision is real, source-verified).
- NO options-vs-config schema partition mechanics (M6/M9 define which keys are "options"; the hook *shape* freezes now). **[REVIEW-FLAG R1]** The options/config boundary semantics are deliberately deferred — review should confirm the research's intent matched.

## 7. Invariants and Citations

- **AMD-55-INV-01:** all four hooks are `default`; a pre-AMD-55 adapter remains source- and binary-compatible, with behavior identical to today.
- **AMD-55-INV-02:** hooks execute sequentially on the adapter's thread; the supervisor never invokes a hook concurrently with another lifecycle method.
- **AMD-55-INV-03:** `migrate` runs before `initialize` on schema mismatch; `PermanentIntegrationException` from `migrate` → FAILED without retry (Doc 05 §3.7 extension).
- Cites: Doc 05 §8.1/§8.4 (lifecycle), §3.7 (classification); INV-RF-03 (hooks must not block on device connectivity — same rule as `initialize`); AMD-54 (version pair); LTD-17 (hooks receive only context-mediated services).

Module-info: unchanged — see AMD-54 §7 verbatim embed.

## 8. Implementing WU

**M4.C.** Supervisor flows = M9.

## 9. Ratification Checklist

- [ ] DOCS-Project review (verify hook signatures against the Research 6 return — **the exact researcher-proposed signatures are not on disk; §2.2 is PM-specified from the assessment + brief**) **[REVIEW-FLAG R2]**
- [ ] Nick ratification
- [ ] Invariants registered

## 10. Review Disposition

*(populated at ratification)*
