<!--
file: design/amendments/AMD-71_Hybrid_Config_Directory_Layout.md
purpose: AMD-71 — hybrid config directory layout (root + integrations/ + secrets.enc + schemas/) on PlatformPaths.configDir(), one-level !include, path-traversal protection (REC-60).
audience: Nick (ratify), PM, Coder
status: RATIFY-WITH-EDITS (DOCS review RETURNED 2026-06-09; E71-1 secrets.enc + E71-2 [AMD-71-A]→Path-injection resolution FOLDED 2026-06-09) — AWAITS NICK RATIFICATION
source: Research 5 REC-60 (PM Assessment v2: ACCEPTED IN PRINCIPLE — AMD deferred to M6 planning, which is now) + Doc 06 §3.1 + Doc 15 §9 (${config_dir})
baseline: homesynapse-core HEAD `6c6dd33`; PlatformPaths.configDir() shipped M5-A (LinuxSystemPaths/LocalPaths)
-->

# AMD-71: Hybrid Configuration Directory Layout

**Block context:** Sixth and last of the M6 configuration block (AMD-66..71). Loading/layout contract; no persisted-event-store change, no public-type change (it constrains the loader's filesystem behavior).

## 1. Problem Statement

Doc 06 §3.1 specifies a single-file loading pipeline but does not fix the on-disk **layout** — where the root document, per-integration config, encrypted secrets, and the JSON-Schema cache live, nor the include semantics. Without a fixed layout the loader has no defined directory contract, and an unconstrained `!include` invites the Home-Assistant chained-include footgun (deeply nested includes that are hard to reason about and a path-traversal risk). Research 5 REC-60 fixes a hybrid layout. Research 5 v2 accepted it in principle and **deferred the AMD to "M6 planning" — which is now** (the M6 entry-gate).

## 2. Specification

### 2.1 Layout (rooted at `PlatformPaths.configDir()`)

All paths resolve under `PlatformPaths.configDir()` (shipped in M5-A — `LinuxSystemPaths` FHS `/etc/homesynapse`, `LocalPaths` dev-rooted; this is the `${config_dir}` Doc 15 §9 references):

```
${config_dir}/
  homesynapse.yaml          # root document (system config)
  integrations/             # one file per integration instance
    <integration>.yaml
  secrets.enc               # AES-256-GCM encrypted secret store, encrypted JSON (SecretStore; AMD-68 setAll). E71-1: the name both Locked docs use — Doc 06 §3.4/§4.8 + Doc 15 §3.8
  schemas/                  # composed JSON-Schema cache (regenerated; not authoritative)
  signing-key.pub           # Ed25519 package-signing public key (Doc 15 §9)
```

### 2.2 Include semantics — one level deep only

`homesynapse.yaml` may `!include integrations/<name>.yaml`; an included file **may not itself `!include`** (one-level-deep restriction — the hedge against HA's chained-include footguns). The loader rejects a nested include with a `ConfigIssue` (FATAL — it is a structural error).

### 2.3 Path-traversal protection (the detail Research 6 missed)

Every `!include` target is resolved and then **verified to be contained within `${config_dir}/integrations/`** after canonicalization (`toRealPath`/normalize): a target that escapes the integrations directory (`../`, absolute paths, symlink escape) is **rejected fail-closed** with a FATAL `ConfigIssue` naming the offending path. No file outside the config directory tree is ever read by the include mechanism.

### 2.4 Schema-composition timing — compose-after-merge

The `SchemaRegistry` composes the full JSON Schema **after** the included files are merged into the candidate document, so validation runs against the merged whole (matching the existing JSON-text-`String` parameter contract on `ConfigValidator.validate(parsed, composedSchemaJson)` — no library-type leakage; source-verified signature). The `schemas/` directory is a **regenerable cache**, never the authoritative schema source.

## 3. Downstream Impact

- **`ConfigurationService.load()` / the loading pipeline (M6.1):** implements the layout, the one-level include, the traversal guard, and compose-after-merge.
- **`SecretStore` (AMD-68):** its file is `${config_dir}/secrets.enc` — the layout names the path; AMD-68 owns the atomic write to it.
- **No JPMS change**, no public-type change. **`[AMD-71-A] RESOLVED (E71-2) — composition-root `Path` injection (Option b):** the resolved config-dir `Path` is **injected into `StandardConfigurationService` from the composition root** (`com.homesynapse.app`, which `requires` both `config` and `platform` — module-info-verified); `com.homesynapse.config` takes **NO** `requires com.homesynapse.platform`, so the §7 verbatim `module-info.java` stays true permanently and the **zero-new-edge property the Doc 15 §3.8 E2 bridge / M6.2 CARRY 1 treat as load-bearing is preserved.** (A direct `config → platform` edge would be acyclic — `platform` requires nothing — but Option (a) would either lean on implied readability for a direct dependency, poor JPMS hygiene, or add an explicit edge that falsifies every embedded module-info; rejected.) **This is the M6.1 instruction's DP-3, now ratified into the AMD.** `PlatformPaths.configDir()` (platform-api, M5-A) is the composition-root's source for the `Path`.

## 4. Implementation Notes

The traversal guard (§2.3) is the load-bearing security detail — implement it with `Path.toRealPath()` containment checks, not string prefix matching (symlink-safe). The one-level include is enforced structurally (the included parser is invoked without the `!include` tag handler registered, so a nested include is an unknown-tag error). The `schemas/` cache is invalidated on any schema-source change and recomposed on load.

## 5. Tests (M6 scope)

| Test | Assertion |
|---|---|
| `ConfigLayoutTest.rootLoadsIntegrationIncludes` | `homesynapse.yaml` + `integrations/*.yaml` merge into one model |
| `…nestedIncludeRejected` | an included file with its own `!include` → FATAL `ConfigIssue` |
| `…pathTraversalRejected` | `!include ../../etc/passwd` / symlink-escape → fail-closed FATAL, path named |
| `…composeAfterMerge` | the composed schema validates the merged whole, not per-file |
| `…schemasCacheRegenerable` | deleting `schemas/` and reloading reproduces identical composed schema |

## 6. Scope Fences / Deferred

NO multi-level include. NO config outside `${config_dir}`. NO change to `ConfigValidator`'s `String`-schema contract. NO auto-generated config reference doc (M10/M11).

## 7. Invariants and Citations

- **AMD-71-INV-01:** the configuration loader reads only files contained within `PlatformPaths.configDir()` after canonicalization; an `!include` escaping the config tree is rejected fail-closed (no path-traversal read).
- **AMD-71-INV-02:** `!include` is one level deep; a nested include is a structural FATAL error.
- Cites: Doc 06 §3.1 (loading pipeline); Doc 15 §9 (`${config_dir}`, `signing-key.pub`); `PlatformPaths.configDir()` (M5-A); `ConfigValidator` `String`-schema contract (source-verified); REC-60.

**Verbatim `module-info.java` (`com.homesynapse.config`, at `6c6dd33`) — unchanged by this AMD, permanently** (`[AMD-71-A]` RESOLVED per E71-2, §3: composition-root `Path` injection; NO `requires com.homesynapse.platform` is added for the config-dir):

```java
module com.homesynapse.config {
    requires transitive com.homesynapse.event;

    exports com.homesynapse.config;
}
```

## 8. Implementing WU

**M6.1** (config pipeline) — the layout + include + traversal guard are the loader. No crypto gate.

## 9. Ratification Checklist

- [ ] DOCS-Project review returned; deltas folded (esp. `[REVIEW-FLAG AMD-71-A]` — config→platform JPMS edge vs path injection)
- [ ] Nick ratification
- [ ] AMD-71-INV-01/02 registered in `Architecture_Invariants_v1.md`
- [ ] Navigation-index amendments row added (watermark unchanged — 71 < 87)

## 10. Review Disposition

_Pending DOCS-Project review (M6 config block AMD-66..71)._ Review note: the §2.3 path-traversal guard is the security-load-bearing item; `[REVIEW-FLAG AMD-71-A]` (the config-dir resolution: `requires com.homesynapse.platform` vs composition-root `Path` injection).
