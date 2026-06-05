<!--
file: design/amendments/AMD-54_Integration_Descriptor_Config_Schema_Versioning.md
purpose: AMD-54 — split descriptor forward-compat versioning from config-document schema versioning on IntegrationDescriptor (REC-41 schema half, NQ-2).
audience: Nick (ratify), PM, Coder
status: RATIFIED 2026-06-05 — DOCS-Project review (RATIFY-AS-IS) + Nick ratification; review return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`
source: Research 6 REC-41 (schema half) + NQ-2 (RESOLVED 2026-06-04: keep both, rename existing) + P2 AMD Renumbering Decision §4/§8
baseline: homesynapse-core HEAD `e76b925` (2026-06-05) — every shape below source-verified at this commit
-->

# AMD-54: IntegrationDescriptor Config-Schema Versioning (rename `schemaVersion` → `descriptorSchemaVersion`; add `configSchemaMajor`/`configSchemaMinor`)

**Block context:** First of the eleven-amendment Workstream C integration block (AMD-54..64), the integration-api interface freeze. Assigned contiguously from the live watermark (AMD-53) per the P2 assign-at-milestone rule. The REC-41 hooks-vs-schema split is resolved as **two full integers** (this AMD + AMD-55) per P2 §8.1 — the config-schema version model is independently ratifiable and AMD-55's `migrate(...)` consumes it.

## 1. Problem Statement

`IntegrationDescriptor` (source-verified at `e76b925`: 8 components — `integrationType, displayName, ioType, requiredServices, dataPaths, healthParameters, dependsOn, schemaVersion`) carries a single `int schemaVersion` (component 8, declared at `IntegrationDescriptor.java:80`). Two distinct concerns are conflated in that one integer:

1. **Descriptor forward-compatibility** — "what version of the descriptor contract does this adapter speak" (the supervisor's parsing contract).
2. **Config-document schema** — "what version of the adapter's *configuration* schema does this adapter expect" — which is what AMD-55's `migrate(...)` hook operates on when a user upgrades an adapter whose config layout changed.

Home Assistant separates these (config entry `version`/`minor_version` vs the integration manifest contract) and its documented migration flow operates on the config pair. Without the split, a config-layout change would force a descriptor-contract version bump and vice versa — two unrelated compatibility surfaces coupled to one integer.

## 2. Specification

### 2.1 Rename

`IntegrationDescriptor.schemaVersion` → **`descriptorSchemaVersion`** (`int`, same position, same semantics: the descriptor contract version, currently 1). Javadoc updated to state explicitly that this is the *descriptor* forward-compat contract, NOT the config schema.

### 2.2 New components

Append after `descriptorSchemaVersion`:

```java
int configSchemaMajor,   // config-document schema major version; >= 1
int configSchemaMinor    // config-document schema minor version; >= 0
```

- **Major** increments on breaking config-layout changes (key removed/renamed/retyped). A persisted config with a lower major than the adapter declares triggers AMD-55's `migrate(fromMajor, fromMinor)`.
- **Minor** increments on additive, backward-compatible changes (new optional key). Minor resets to 0 on a major bump. A minor-only mismatch never triggers migration — the adapter must tolerate older minors within the same major.

### 2.3 Construction compatibility

`IntegrationDescriptor` grows 8 → (ultimately 14 across this block — see AMD-61/62/63/64). Per the M4.B-S2 convenience-constructor precedent: the canonical constructor takes all components; an **8-arg convenience constructor** preserving today's exact signature defaults `configSchemaMajor = 1`, `configSchemaMinor = 0` (and the AMD-61..64 components to their documented defaults). Zero existing-caller breakage. Compact-ctor guards: `descriptorSchemaVersion >= 1`, `configSchemaMajor >= 1`, `configSchemaMinor >= 0`.

## 3. Downstream Impact

- **AMD-55** (`migrate`) consumes `(configSchemaMajor, configSchemaMinor)` — the from/to pair in its signature is defined by this AMD.
- **integration-runtime** (M9 supervisor): persists the config schema pair alongside stored adapter config; compares at startup; invokes migration on major mismatch. No M4 runtime code.
- **Configuration module:** none — the config module's own `ConfigMigrator`/`MigrationResult` (global YAML pipeline, source-verified present at `e76b925`) is a *different* surface: it migrates the system config document; this pair versions a single adapter's config section. The Javadoc must cross-reference to prevent conflation.
- **No JPMS change.** All edits inside `com.homesynapse.integration` (already exported). No new `requires`.

## 4. Implementation Notes

Rename is mechanical (one component + accessor + Javadoc); grep blast-radius for `.schemaVersion()` callers across the repo is part of the M4.C survey gate (expected: descriptor tests + `StubIntegrationContext` neighborhood only — supervisor impl is M9).

## 5. Tests (M4.C scope)

| Test | Assertion |
|---|---|
| `IntegrationDescriptorTest.renamedAccessor` | `descriptorSchemaVersion()` exists; no `schemaVersion()` accessor remains |
| `IntegrationDescriptorTest.convenienceCtorDefaults` | 8-arg ctor yields `configSchemaMajor()==1`, `configSchemaMinor()==0` |
| `IntegrationDescriptorTest.guards` | major `<1` / minor `<0` / descriptorSchemaVersion `<1` → `IllegalArgumentException` |

## 6. Scope Fences / Deferred

- NO migration *execution* machinery (M9). NO persistence of config schema versions (M9). NO config-module changes.

## 7. Invariants and Citations

- **AMD-54-INV-01:** `descriptorSchemaVersion` (descriptor contract) and `(configSchemaMajor, configSchemaMinor)` (config-document schema) are distinct compatibility surfaces; no code path may derive one from the other.
- **AMD-54-INV-02:** minor-only config mismatch never triggers migration; major mismatch always does (enforced at M9, contract frozen here).
- Cites: Doc 05 §4.1 (descriptor); NQ-2 (RESOLVED — keep both, rename existing); P2 §8.1 (two full integers).

**Verbatim `module-info.java` (integration-api, at `e76b925`) — unchanged by this AMD:**

```java
module com.homesynapse.integration {
    requires transitive com.homesynapse.platform;
    requires transitive com.homesynapse.event;
    requires transitive com.homesynapse.device;
    requires transitive com.homesynapse.state;
    requires transitive com.homesynapse.persistence;
    requires transitive com.homesynapse.config;
    requires transitive java.net.http;

    exports com.homesynapse.integration;
}
```

## 8. Implementing WU

**M4.C** (single freeze milestone for AMD-54..64). Supervisor behavior = M9.

## 9. Ratification Checklist

- [x] DOCS-Project review returned; deltas folded — 2026-06-05
- [x] Nick ratification — 2026-06-05
- [x] Invariants registered in `Architecture_Invariants_v1.md` (§24)
- [x] Watermark raised at block ratification (AMD-53 → AMD-64) — 2026-06-05

## 10. Review Disposition

**DOCS-Project review (2026-06-05): RATIFY-AS-IS — no edits.** Return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`. All source-shape claims independently re-derived at `e76b925` (8 components, `schemaVersion` last at line 80; module-info character-for-character); NQ-2 rendering verified; the 8→14 convenience-ctor default story verified complete and consistent across AMD-54/61/62/63/64 (G4). Block-level note adopted at ratification: the final 14-component declaration order is append-in-AMD-number-order — `integrationType, displayName, ioType, requiredServices, dataPaths, healthParameters, dependsOn, descriptorSchemaVersion, configSchemaMajor, configSchemaMinor, softDependencies, backoffParameters, isolationLevel, plannedRestartTimeout`. Ratified by Nick 2026-06-05.
