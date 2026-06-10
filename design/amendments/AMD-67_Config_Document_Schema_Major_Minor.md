<!--
file: design/amendments/AMD-67_Config_Document_Schema_Major_Minor.md
purpose: AMD-67 — config-document schema versioning as (major, minor) on ConfigModel + ConfigMigrator (REC-56). REC-41 blocker cleared by AMD-54.
audience: Nick (ratify), PM, Coder
status: RATIFIED 2026-06-09 (Nick) — DOCS review RATIFY-WITH-EDITS, edits E67-1/E67-2 folded `aedff55`; return: nexsys-hivemind `context/audits/2026-06-09_AMD-66-71_DOCS_Review_Return.md`
source: Research 5 REC-56 (PM Assessment v2: DEFERRED on Research 6 REC-41 — now CLEARED, see §1.1) + Doc 06 §3.7/§4.1
baseline: homesynapse-core HEAD `6c6dd33` (2026-06-08) — ConfigModel (5 components) + ConfigMigrator (3 methods) source-verified at this commit
-->

# AMD-67: Config-Document Schema Versioning — `(major, minor)`

**Block context:** Second of the six-amendment M6 configuration block (AMD-66..71). Internal-to-config contract change with zero downstream blast radius (no production `ConfigMigrator` implementation exists yet — source-verified). **This is the schema-version-shape amendment; everything in the M6 config pipeline that versions the system config document depends on it.**

## 1. Problem Statement

`ConfigModel` (source-verified at `6c6dd33`: 5 components — `int schemaVersion, Instant loadedAt, Instant fileModifiedAt, Map<String,ConfigSection> sections, Map<String,Object> rawMap`) versions the system configuration document with a **single `int schemaVersion`**, and `ConfigMigrator` (source-verified: 3 methods — `int fromVersion()`, `int toVersion()`, `MigrationResult migrate(Map<String,Object>)`) migrates on that single int. A single integer conflates breaking and additive schema evolution: there is no way to say "this change is additive and backward-compatible" versus "this change is breaking and requires migration." Research 5 REC-56 splits it into `(major, minor)`, the same idiom the integration-api already froze for adapter configs.

### 1.1 REC-41 blocker — CLEARED (confirm-at-authoring per the W24 charter)

Research 5 v2 **deferred** REC-56 pending Nick's decision on Research 6 REC-41 (the *adapter-config* `(major, minor)` shape). **That blocker is now cleared, source-verified:** REC-41 became **AMD-54** ("IntegrationDescriptor Config-Schema Versioning"), **RATIFIED 2026-06-05** (DOCS-Project review RATIFY-AS-IS), which renamed `IntegrationDescriptor.schemaVersion` → `descriptorSchemaVersion` and added `configSchemaMajor`/`configSchemaMinor` (`int`, `>=1` / `>=0`), with **AMD-54-INV-02** ("minor-only config mismatch never triggers migration; major mismatch always does"). The `(major, minor)` schema-versioning pattern AMD-67 waited on now exists and is locked. AMD-67 adopts the **same idiom** for the **distinct** system-config-document surface.

**Distinct-surface guard (cross-reference AMD-54 §3, verbatim intent):** AMD-54 governs a *single adapter's* config-section schema (`IntegrationDescriptor.configSchemaMajor/Minor`, consumed by the M9 supervisor). AMD-67 governs the *whole system config document* (`ConfigModel`/`ConfigMigrator`, the global YAML pipeline). These are **two distinct compatibility surfaces sharing one idiom**; no code path may derive one from the other (mirrors AMD-54-INV-01). Both Javadocs must cross-reference to prevent the conflation AMD-54 §3 already warned of.

## 2. Specification

### 2.1 `ConfigModel` — `schemaVersion: int` → `configSchemaMajor: int` + `configSchemaMinor: int` (5 → 6 components)

```java
public record ConfigModel(
        int configSchemaMajor,   // >= 1; breaking config-layout version
        int configSchemaMinor,   // >= 0; additive, backward-compatible version; resets to 0 on a major bump
        Instant loadedAt,
        Instant fileModifiedAt,
        Map<String, ConfigSection> sections,
        Map<String, Object> rawMap
) { … }
```

`ConfigModel` is consumed only inside `com.homesynapse.config` (source-verified — it is constructed by the loading pipeline and read via `ConfigurationService`); the field replacement is internal. Compact-ctor guards: `configSchemaMajor >= 1`, `configSchemaMinor >= 0`.

### 2.2 `ConfigMigrator` — `(fromVersion, toVersion)` → `(fromMajor, fromMinor, toMajor, toMinor)` (3 → 5 methods)

```java
public interface ConfigMigrator {
    int fromMajor();
    int fromMinor();
    int toMajor();
    int toMinor();
    MigrationResult migrate(Map<String, Object> rawConfig);   // unchanged signature
}
```

A migrator triggers only on a **major** mismatch (a lower persisted major than the loader declares); a minor-only mismatch never migrates (the loader must tolerate older minors within the same major — AMD-54-INV-02, adopted here as AMD-67-INV-02). The migrator chain orders by `(major, minor)`.

### 2.3 `MigrationPreview` carries the pair (E67-1 — `MigrationResult` has no version field)

`MigrationPreview` (config-internal, source-verified `(int fromVersion, int toVersion, List<MigrationChange> plannedChanges, boolean requiresUserReview)` at `6c6dd33`) gains `fromMajor/fromMinor/toMajor/toMinor` in place of its `fromVersion`/`toVersion`. **`MigrationResult` carries no version field at `6c6dd33`** (source-verified: `(Map migratedConfig, List<MigrationChange> changes)`) — so there is no version field to migrate there; **if M6.1 adds applied-version reporting to `MigrationResult`, it carries the `(major, minor)` pair.** The Coder verifies the exact `MigrationPreview`/`MigrationResult`/`MigrationChange` shapes against source at M6.1 implementation (config-internal types — the contract is the pair; the edit is mechanical).

## 3. Downstream Impact

- **`config.validation_completed` / `config.section_reloaded` events (AMD-70)** carry `(configSchemaMajor, configSchemaMinor)` in their payload (AMD-70 §2 is written against this pair; reverts to single `schemaVersion` only if AMD-67 is rejected).
- **integration-api (AMD-54):** none — distinct surface (§1.1). The cross-reference Javadoc is the only doc-level touch.
- **No JPMS change.** All edits inside `com.homesynapse.config` (already exported). The §7 verbatim `module-info.java` is unchanged.
- **No persisted-event-store change.** `ConfigModel` is the in-memory model; the on-disk artifact is the YAML file, whose top-level schema-version key becomes a `major.minor` (or `major`+`minor`) pair — a config-file-format note for M6.1, not an event-store migration.

## 4. Implementation Notes

Zero **production/cross-module** blast radius: no production `ConfigMigrator` implementation exists at `6c6dd33` (source-verified — the interface and `MigrationResult`/`MigrationChange`/`MigrationPreview` types exist; no concrete migrator). **`ConfigModel` constructor callers at `6c6dd33` (E67-2):** testFixtures `TestConfigFactory` (5 construction sites) + `InMemoryConfigAccessTest` (1 `schemaVersion()` accessor) — **mechanical in-module test-fixture updates at M6.1; no production or cross-module callers** (`ConfigModel` is consumed only inside `com.homesynapse.config`). The YAML config file's schema-version representation (single `schema_version: 2` → `schema_version: { major: 2, minor: 0 }`, or a `2.0` string parsed to the pair) is an M6.1 file-format decision; specify it in the M6.1 instruction.

## 5. Tests (M6 scope)

| Test | Assertion |
|---|---|
| `ConfigModelTest.majorMinorGuards` | `configSchemaMajor < 1` or `configSchemaMinor < 0` → `IllegalArgumentException` |
| `ConfigMigratorChainTest.majorMismatchMigrates` | a lower persisted major triggers migration |
| `…minorOnlyMismatchDoesNotMigrate` | same major, lower minor → no migration (AMD-67-INV-02) |
| `…chainOrdersByMajorMinor` | multi-step migration applies in `(major, minor)` order |

## 6. Scope Fences / Deferred

NO migration *execution* beyond the chain contract (the actual migrators are authored per-schema-bump as they arise). NO change to the adapter-config surface (AMD-54 owns it). NO event-store migration.

## 7. Invariants and Citations

- **AMD-67-INV-01:** the system config-document schema `(configSchemaMajor, configSchemaMinor)` and the adapter-config schema `(IntegrationDescriptor.configSchemaMajor, …Minor)` are **distinct compatibility surfaces**; no code path derives one from the other.
- **AMD-67-INV-02:** a minor-only config-document mismatch never triggers migration; a major mismatch always does (adopted from AMD-54-INV-02 for the system-config surface).
- Cites: Doc 06 §3.7/§4.1; AMD-54 (REC-41 schema half, RATIFIED — the cleared blocker) §2/§3/INV-01/INV-02; Research 5 v2 (REC-56 deferred-then-cleared); P2 §8.1 (two integers).

**Ruling correction (2026-06-10, Nick — M6.1a module-info escalation):** "unchanged" is scoped to the **HomeSynapse-module edge set** (`requires transitive com.homesynapse.event` only). M6.1a adds the five **third-party, non-transitive** `requires` directives ruled physically necessary (full text in the AMD-66 §7 ruling-correction note); the embed below remains the M6.1b-era baseline (`6c6dd33`).

**Verbatim `module-info.java` (`com.homesynapse.config`, at `6c6dd33`) — unchanged by this AMD:**

```java
module com.homesynapse.config {
    requires transitive com.homesynapse.event;

    exports com.homesynapse.config;
}
```

## 8. Implementing WU

**M6.1** (config pipeline) — the loader/migrator are part of the pipeline. No crypto gate.

## 9. Ratification Checklist

- [x] DOCS-Project review returned; deltas folded — 2026-06-09 (E67-1/E67-2 folded, commit `aedff55`)
- [x] Nick ratification — 2026-06-09
- [x] AMD-67-INV-01/02 registered in `Architecture_Invariants_v1.md` (§38) — 2026-06-09
- [x] Navigation-index amendments row added (watermark unchanged — 67 < 87) — 2026-06-09
- [ ] AMD-54 / AMD-67 cross-reference Javadocs confirmed at M6.1 implementation

## 10. Review Disposition

**DOCS-Project review (2026-06-09): RATIFY-WITH-EDITS — E67-1 + E67-2, both prose-vs-source accuracy, non-structural, folded by the PM 2026-06-09 and committed at docs `aedff55`.** Return: nexsys-hivemind `context/audits/2026-06-09_AMD-66-71_DOCS_Review_Return.md` (block verdict RATIFY-WITH-EDITS; source baseline re-derived independently at `6c6dd33`). The review **VERIFIED the REC-41 clearance** (AMD-54 RATIFIED 2026-06-05; the distinct-surface guard correct — INV-01 mirrors AMD-54-INV-01, the INV-02 transplant correct) and confirmed zero blast radius (no production migrator; no cross-module `ConfigModel` consumers — `TestConfigFactory` ×5 + `InMemoryConfigAccessTest` ×1 only). E67-1: `MigrationResult` carries no version field — only `MigrationPreview` carries the pair. E67-2: the ctor-caller inventory above. The §7 verbatim `module-info.java` embed source-verified at `6c6dd33`. Ratified by Nick 2026-06-09 at the M6 config-block ratification (watermark unchanged at AMD-87).
