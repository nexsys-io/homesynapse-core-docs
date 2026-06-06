# Research 5: Configuration System Patterns for Constrained IoT Runtimes

*Target: HomeSynapse Core M6 (Configuration System), with M4-amendment-window coupling. Date: 2026-05-22.*

## 1. Executive Summary [M]

- **SnakeYAML Engine 3.0.1 should be adopted directly as the YAML 1.2 parser, not Jackson YAML or classic SnakeYAML**, because it is the only primary-source YAML 1.2 implementation, it is safe-by-default (no global tags, no JavaBean instantiation), and it lets us avoid pulling Jackson's `tools.jackson.dataformat:jackson-dataformat-yaml` into the config module's compile classpath — preserving the option to use Jackson 3.x (`tools.jackson.*`) versus Jackson 2.x (`com.fasterxml.jackson.*`) independently for LTD-19 serialization.
- **`com.networknt:json-schema-validator` 3.0.2 should be adopted**, because it is Apache-2.0 licensed, declares an explicit JPMS module name `com.networknt.schema` via moditect, supports Draft 2020-12, and treats Jackson YAML / ethlo time as `requires static` (JPMS-optional) — but the Maven-scope `com.ethlo.time:itu` dependency is *not* `<optional>true</optional>`, so it ships by default and must be excluded if we standardize on `java.time.OffsetDateTime` for date-time validation.
- **The single highest-impact finding is the config-as-event vs config-as-file tension.** The file must remain the source of truth and `config_changed` must be a pure observability event; treating events as source-of-truth here recreates Home Assistant's `.storage/` opacity, breaks `git diff` review of operator changes, and would force HomeSynapse to invent a reducer for a problem (apply-edits) that file mtime + atomic rename already solves correctly.
- **A typed-per-subsystem `ConfigurationChangeListener<S extends ConfigSection>` should be adopted, not a generic `Consumer<ConfigChangeSet>`**, because typed dispatch is what OpenHAB's `handleConfigurationUpdate(Configuration)` and Eclipse Kura's `@Modified` already validate as correct ergonomics for IoT runtimes, and it lets each subsystem return a `ReloadClassification` (HOT / INTEGRATION_RESTART / PROCESS_RESTART) instead of guessing globally.
- **A two-tier secret threat model should be adopted (defense-in-depth + backup-exfil), explicitly *not* on-device root attacker**, because TPM2 is not present on Pi 4, is optional on Pi 5, and committing to TPM-backed protection would block Pi 4 support — which is half of the target hardware.
- **Argon2id should be the KDF for passphrase-derived AES-256-GCM secret encryption with parameters t=3, p=4, m=2^16 (64 MiB)**, the parameter set RFC 9106 §4 explicitly labels the **SECOND RECOMMENDED option** for memory-constrained environments ("If much less memory is available, a uniformly safe option is Argon2id with t=3 iterations, p=4 lanes, m=2^(16) (64 MiB of RAM), 128-bit salt, and 256-bit tag size. This is the SECOND RECOMMENDED option."). A single derivation at startup keeps cost amortized.
- **The `ConfigMigrator` interface should be changed to use a `(major, minor)` pair to align with Research 6 REC-41**, because Home Assistant's production-validated `entry.version` / `entry.minor_version` split is the only pattern in the surveyed platforms that solves the downgrade-safety problem; keeping a single `int` would force Research 6 to invent a parallel scheme.
- **`config.validation_completed` should be added as a dot-namespaced observability-only event registered with `DispatchingProjectionAdvancer` per Research 8 REC-28**, because Home Assistant's Repairs panel and OpenHAB's `ConfigStatusInfoEvent` both validate that a structured, persistent issue stream — not just log lines — is what operators actually need.

## 2. Platform / Literature Deep Dives [M]

### 2.1 Home Assistant (Python, PyYAML, voluptuous, `async_migrate_entry`, Repairs)

(a) **How HA solves the problem.** HA treats `configuration.yaml` as the operator-edited root, with `!include`, `!include_dir_merge_named`, `!include_dir_list`, and `!secret` directives resolved by a custom PyYAML loader. Validation is performed per-integration with `voluptuous` schemas at startup. UI-configured integrations bypass YAML entirely and persist to `.storage/core.config_entries` (JSON, opaque). Migration is per-integration via `async_migrate_entry(hass, config_entry)`, and *every config entry has a two-part version*: `entry.version` (major) and `entry.minor_version` (minor), with minor bumps documented as forwards/backwards safe.

(b) **Direct quotation** (developers.home-assistant docs, config entries & migration):
> "If minor versions differ but major versions are the same, integration setup will be allowed to continue even if the integration does not implement `async_migrate_entry`. … This means a minor version bump is backwards compatible unlike a major version bump which causes the integration to fail setup if the user downgrades Home Assistant Core without restoring their configuration from backup."
— <https://github.com/home-assistant/developers.home-assistant/blob/master/docs/config_entries_config_flow_handler.md>

On Repairs:
> "Home Assistant keeps track of issues which should be brought to the user's attention. These issues can be created by integrations or by Home Assistant itself. Issues can either be fixable via a RepairsFlow or by linking to a website with information on how the user can solve it themselves."
— <https://developers.home-assistant.io/docs/core/platform/repairs/>

On `secrets.yaml`:
> "Secrets will be resolved in this order: A `secrets.yaml` located in the same folder as the YAML file; next, parent folders will be searched for a `secrets.yaml` file with the secret, stopping at the folder with the main `configuration.yaml`."
— <https://www.home-assistant.io/docs/configuration/secrets/>

(c) **Pain points / failure modes.**
- `secrets.yaml` is **plaintext** on disk; the community treats it strictly as a redaction-for-sharing tool, not as protection: "the secrets.yaml file is not encrypted. Using a secrets file doesn't increase or improve the security of Home Assistant." (<https://smarthomepursuits.com/how-to-store-secrets-in-home-assistant>).
- `check_config` can hang indefinitely on event-loop contention (issue #40821).
- The `.storage/` directory is opaque to operators — issue #119654 documents a persistent repairs entry that survived addon uninstall because the registry is event-sourced, not file-sourced; the user "deleted the .storage/repairs.issue_registry but repair comes back."

(d) **Lesson for HomeSynapse.** Adopt the (major, minor) version split verbatim into `ConfigMigrator`. Do *not* copy `secrets.yaml`-as-plaintext; HomeSynapse promises AES-256-GCM and must deliver it. Do publish a structured issue stream like Repairs (we will model this as `config.validation_completed`).

### 2.2 OpenHAB (Karaf, OSGi ConfigAdmin, `.things`/`.items`/`.rules`, `thing-types-update.xml`)

(a) **How OpenHAB solves the problem.** Per-domain text files in `/conf/things/`, `/conf/items/`, `/conf/rules/`. Each binding ships an XSD-validated `OH-INF/thing/*.xml` thing-type description and `OH-INF/config/*.xml` ConfigDescription. The OSGi ConfigAdmin propagates property maps to `ThingHandler.handleConfigurationUpdate(Configuration)`. Schema migration is declarative via `OH-INF/update/*.xml` instructions added in PR #3330. Secrets land in a JKS/PKCS12 keystore under `$OPENHAB_CONF/keystore`.

(b) **Direct quotation** (OpenHAB developer docs, thing-types-update):
> "When bindings evolve, thing-types need to be modified. Since managed things store their structure in a database at the time they are created, only updating the XML is not sufficient. Developers can add instructions for the framework to update these things during initialization. The instructions are provided as XML in the OH-INF/update folder."
— <https://www.openhab.org/docs/developer/bindings/thing-xml.html>

PR #3330 (J-N-K) on why config-parameter changes don't need update instructions:
> "It is unnecessary because that depends on the config description and config descriptions are always build when the bundle loads/reloads, so they are automatically updated. The database only stores the config values, so the worst thing that could happen is a value that is no longer used."
— <https://github.com/openhab/openhab-core/pull/3330>

(c) **Pain points.**
- The XSD route forces XML on binding authors. A reviewer comment on PR #3330 captures the tax: "Much more boilerplate, but that's what comes with XML. I like the fact that we can easily check it against XSDs. I agree that parsing with XStream is no fun, I'll have a look at your Jakarta implementation." (<https://github.com/openhab/openhab-core/pull/3330>).
- Karaf keystore management is documented as half-implemented in the community ("I don't know and it may be the case that the jetty config is only half implemented at this point.", <https://community.openhab.org/t/need-to-change-keystore-password-in-openhab2/21153/6>).
- Manual recreation of Things was historically required when ThingType definitions changed (Issue #1924, only fixed in OH4 via PR #3330).

(d) **Lesson for HomeSynapse.** The split-by-domain directory layout is sound, but XSD validation creates a binding-author tax we should not pay; JSON Schema (text/JSON strings, per the verified inventory of `SchemaRegistry`) is the better contract. The keystore lesson is *negative*: don't make secret storage operator-administered with `keytool`; make `SecretStore` programmatic and never expose a primitive `keytool`-equivalent to operators.

### 2.3 Eclipse Kura (OSGi MetaType, ConfigurationService, snapshot/rollback, @Modified)

(a) **How Kura solves the problem.** `ConfigurationService` persists per-component property maps validated against OSGi MetaType `ObjectClassDefinition`. Every successful update creates a snapshot (`$kura.snapshots/snapshot_epoch.xml`) and rollback is first-class. Component callbacks use OSGi DS `@Modified` for in-place reconfiguration; absent that annotation, the framework deactivates+reactivates.

(b) **Direct quotation** (Eclipse Kura ConfigurationService Javadoc):
> "Before updating the component, the specified properties are validated against the ObjectClassDefinition associated to the Component. The Configuration Service is fully compliant with the OSGi MetaType Information and the validation happens through the OSGi MetaType Service."
— <https://download.eclipse.org/kura/docs/api/4.1.0/apidocs/org/eclipse/kura/configuration/ConfigurationService.html>

On snapshot/rollback:
> "The Configuration Service has the ability to create a snapshot for the current configuration of all the tracked components. The snapshot is saved in the form of an XML file stored under `$kura.snapshots/snapshot_epoch.xml` … The Configuration Service also has the ability to rollback the configuration of tracked components taking them back to a previous stored snapshot."
— ibid.

On `@Modified` semantics (Liferay maintainer commentary):
> "When you have an @Modified annotation, you can update your local cache value and then you won't require a restart when the data changes. … If you do not specify a modified life cycle method, the Component Configuration is deactivated and afterwards activated again with the new configuration object."
— <https://liferay.dev/blogs/-/blogs/revisiting-osgi-ds-annotations>

(c) **Pain points.** Kura tightly couples configuration to OSGi DS and ConfigAdmin; a non-OSGi runtime cannot adopt the MetaType validation primitive. The "MetaType XML must be named after the DS component name" restriction creates fragile filename coupling.

(d) **Lesson for HomeSynapse.** Adopt the snapshot/rollback semantics *conceptually*: every successful reload should leave a previous-`ConfigModel` recoverable (Phase-2 simplification: keep last-N in-memory, persist on disk in a follow-up). Adopt the "no callback → restart" default: if a subsystem does not register a `ConfigurationChangeListener`, classify a section change as `INTEGRATION_RESTART`.

### 2.4 Spring Boot / Spring Cloud (`@ConfigurationProperties`, `@RefreshScope`)

(a) **How Spring solves the problem.** Spring Boot binds external properties into `@ConfigurationProperties` POJOs at bean instantiation; `@RefreshScope` (from Spring Cloud) wraps beans in a proxy that recreates the underlying instance on `RefreshEvent`. `/actuator/refresh` triggers a re-read of `PropertySource`s, an `EnvironmentChangeEvent`, and reinitialization of `@RefreshScope`-annotated beans.

(b) **Direct quotation** (Substack mirror of dsyer's pattern):
> "Normally beans are created once and live until shutdown. `@RefreshScope` changes that pattern by telling Spring to discard the bean when a refresh event occurs and build a new one with updated values from the environment."
— <https://alexanderobregon.substack.com/p/dynamic-property-reload-in-spring>

(c) **Pain points.**
- Issue **#846 "@ConfigurationProperties and @RefreshScope don't work together as documented"**, opening report verbatim: "a bean created by scanning for ConfigurationProperties classes or via @EnableConfigurationProperties is never put into the RefreshScope correctly." (<https://github.com/spring-cloud/spring-cloud-commons/issues/846>).
- Constructor-bound and **record-based** `@ConfigurationProperties` cannot be refreshed at all — fatal for a Java-21-records-first codebase like HomeSynapse.

(d) **Lesson for HomeSynapse.** The Spring proxy approach is incompatible with our record-based section types. Pull the *invalidation event* concept but *not* the proxy machinery — listeners receive a typed snapshot, not a magic recreated bean.

### 2.5 Micronaut (`@ConfigurationProperties` at compile time, `@Refreshable`, AOT)

(a) **How Micronaut solves the problem.** Micronaut binds `@ConfigurationProperties` at **compile time** via annotation processing, producing zero-reflection bean factories — relevant for a constrained-runtime comparison. `@Refreshable` is the equivalent of Spring's `@RefreshScope`. The Micronaut AOT toolkit (introduced in the Micronaut 4 era and carried into Micronaut 5, which went GA on 2026-05-20) adds build-time YAML→Java conversion that eliminates YAML parsing from native-image startup entirely.

(b) **Direct quotation** (Micronaut docs):
> "Micronaut 5 can generate JSON Schema documents from @ConfigurationProperties, making it easier to drive IDE completion, validation, and external tooling from the same configuration model used by the framework."
— <https://docs.micronaut.io/latest/guide/>

On AOT YAML elimination (a Micronaut-4-era feature per the GraalVM blog post):
> "convert YAML configuration to Java configuration to make apps startup faster, while reducing the final binary size because YAML parsing is no longer necessary"
— <https://medium.com/graalvm/introducing-micronaut-aot-build-time-optimizations-for-your-micronaut-applications-68b8f1302c5>

(c) **Pain points.** Micronaut AOT requires a regenerate-on-config-change build step that an operator cannot perform; this is incompatible with HomeSynapse's "operator edits YAML on Pi" model.

(d) **Lesson for HomeSynapse.** The "JSON Schema generated from the config class" direction is the right precedent for `SchemaRegistry` composition — but we keep schemas hand-authored (LTD-19 simplification) rather than generated, because we don't have an AOT pass.

### 2.6 Hubitat (operator-visible patterns)

(a) **How Hubitat solves the problem.** Closed-source platform; the operator-visible model is "hub database + automatic daily backups" with no text-file config. Backups are opaque `.LZF` archives; restore is whole-database. Z-Wave/Zigbee mesh state is in the backup; Matter configuration is included as of recent firmware.

(b) **Direct quotation** (Hubitat docs, Backup and Restore):
> "Local backup includes the hub database only (settings, apps, device list, etc.). … Local backups do include Matter configuration. You may backup and restore files from a local backup any time, but manual and automatic backup to the Hubitat cloud, including restore from cloud backup and Zigbee and Z-Wave radio migration, requires a Hub Protect or Cloud Backup subscription."
— <https://docs2.hubitat.com/en/user-interface/settings/backup-and-restore>

(c) **Pain points.** No diffable config; operators cannot review changes between versions; community thread <https://community.hubitat.com/t/backup-file-format/72105> documents zero public knowledge of the file format ("Has anyone been able to confirm/determine what file format the archive is for the backup — the extension is .LZF which isn't anything I can figure out").

(d) **Lesson for HomeSynapse.** Negative example: the absence of a diffable text artifact *is* the operator complaint. HomeSynapse's commitment to YAML-as-source-of-truth is directly validated by Hubitat's UX deficit.

### 2.7 networknt/json-schema-validator (JVM JSON Schema, Apache 2.0)

(a) **How it solves the problem.** Pure-Java Draft V4–2020-12 implementation, used by the light-4j framework for OpenAPI request/response validation. Composition is via `SchemaRegistry` with `schemaIdResolvers` that map `$id` prefixes to retrieval URIs — a natural fit for the HomeSynapse `SchemaRegistry.register(coreSchemaJson, integrationSchemaJson...)` composition model.

(b) **Direct quotation** (project README):
> "A fast Java JSON schema validator that supports draft V4, V6, V7, V2019-09 and V2020-12 … As it is a key component in our light-4j microservices framework to validate request/response against OpenAPI specification … at runtime, performance is the most important aspect in the design."
— <https://github.com/networknt/json-schema-validator>

JPMS module name (verified verbatim from `pom.xml` on master, moditect block):
> `<moduleInfo><name>com.networknt.schema</name>`
— <https://github.com/networknt/json-schema-validator/blob/master/pom.xml>

Latest 3.x release (GitHub Releases, verbatim):
> "3.0.2 - 2026-04-14 … Upgrade Jackson from 3.1.0 to 3.1.1 to fix CWE-770"
— <https://github.com/networknt/json-schema-validator/releases>

(c) **Pain points.**
- README warns: "This library can contain breaking changes in minor version releases that may require code changes." We pin to a single 3.x version, not a range.
- v3.x adopted Jackson 3.x `tools.jackson.*` groupIds; v2.x is the last line on `com.fasterxml.jackson.*` — if HomeSynapse's LTD-19 Jackson is still 2.x, this is a coordination hazard.
- `com.ethlo.time:itu` is a required (non-`<optional>`) Maven dependency for accurate `date-time` format validation; documented in the README as excludable when `java.time.OffsetDateTime` accuracy is sufficient.

(d) **Lesson for HomeSynapse.** Adopt version 3.0.2 if and only if LTD-19 Jackson is on the 3.x line, else stay on the latest 2.x of networknt (currently 1.5.x family) until Jackson migration. Exclude `ethlo:itu` to keep dependency surface minimal. Use `requires com.networknt.schema;` in `module-info.java`.

### 2.8 SnakeYAML 2.x and SnakeYAML Engine 3.x

(a) **How they solve the problem.** Classic SnakeYAML supports YAML **1.1** only; SnakeYAML Engine supports YAML **1.2**. Doc 06 specifies YAML 1.2, which uniquely selects SnakeYAML Engine. Engine 3.0.1 is multi-release JAR, Java 11+, `<packaging>bundle</packaging>` with module name `org.snakeyaml.engine`.

(b) **Direct quotation** (SnakeYAML Engine README):
> "Since the custom instances are not supported, parsing any YAML document is safe — the YAML input stream is not able to instruct the Engine to call arbitrary Java constructors (unless it is explicitly enabled) — a complete YAML 1.2 processor."
— <https://github.com/snakeyaml/snakeyaml-engine>

On classic SnakeYAML 2.0 post-CVE-2022-1471 (HeroDevs reference):
> "With SnakeYAML 2.0 and later, global tags are disabled by default. Attempting to load a YAML document that contains global tags as shown in the example above will cause a runtime error. SnakeYAML 2.0 is 'secure by default'."
— <https://docs.herodevs.com/snakeyaml/cve-2022-1471>

On Jackson 3.0 pivot away from classic SnakeYAML:
> "#106: Upgrade to snakeyaml-engine (from classic snakeyaml) … YAML module uses snakeyaml-engine over 'classic' snakeyaml"
— <https://github.com/FasterXML/jackson/wiki/Jackson-Release-3.0>

(c) **Pain points.**
- Classic SnakeYAML's `Automatic-Module-Name: org.yaml.snakeyaml` is filename-derived/automatic; no real `module-info.java`. Confirmed: classic SnakeYAML's pom uses `<maven.compiler.source>8</maven.compiler.source>`, so it cannot ship a real module descriptor in its primary jar.
- CVE-2022-1471 affected all classic SnakeYAML <2.0; while 2.0+ is "secure by default", the attack surface analysis still matters because Jackson 2.x YAML transitively pulls classic SnakeYAML (this is what made the CVE so widespread).
- SnakeYAML Engine has **no published Raspberry Pi or ARM benchmark**; the only published JMH micro-benchmark in the README states throughput without specifying CPU/JVM, so Pi 4 performance must be measured locally.

(d) **Lesson for HomeSynapse.** Use SnakeYAML Engine 3.0.1 directly. Do not use Jackson 2.x YAML (transitively pulls classic SnakeYAML 1.x/2.x); if we adopt Jackson 3.x for LTD-19, Jackson 3.x YAML is acceptable since it already moved to snakeyaml-engine, but direct use of Engine is cleaner. A Pi 4 spike is required to validate the 500-line / <500 ms budget — *we have no third-party number to cite*.

## 3. Cross-Cutting Analysis [M]

### 3.1 Concept Mapping Table

| HomeSynapse concept | Home Assistant | OpenHAB | Eclipse Kura | Spring Boot | Micronaut | Hubitat |
|---|---|---|---|---|---|---|
| **Source-of-truth artifact** | `configuration.yaml` + `.storage/*.json` | `*.things/*.items/*.rules` + JSONDB | OSGi snapshot XML | `application.yaml` | `application.yml` | opaque hub DB |
| **Schema language** | `voluptuous` Python | XSD (config-description) | OSGi MetaType XML | bean validation / JSON Schema | `@ConfigurationProperties` + JSON Schema (M5) | none exposed |
| **Reload primitive** | `async_reload` | `handleConfigurationUpdate(Configuration)` | `@Modified` callback | `RefreshEvent` + `@RefreshScope` proxy | `@Refreshable` | reboot only |
| **Secret store** | `secrets.yaml` (plaintext) | JKS keystore (`$OPENHAB_CONF/keystore`) | DS Crypto Service | property-source encryption (Cloud Config) | environment KMS | hub-only |
| **Schema migration** | `async_migrate_entry(major, minor)` | `OH-INF/update/*.xml` instructions | snapshot rollback (no migrate) | manual (no framework support) | manual | restore-to-version |
| **Issue surface** | Repairs registry (`issue_registry`) | `ConfigStatusInfoEvent` | `KuraException` log | `/actuator/health` indicators | health indicators | hub UI banner |
| **Composition unit** | per-integration domain | per-binding bundle | per-OSGi-component PID | per-`@ConfigurationProperties` prefix | per-`@ConfigurationProperties` prefix | per-app driver |
| **!include** | `!include`, `!include_dir_*`, `!secret` | per-domain dir, no include | n/a (component-scoped) | `spring.config.import` | profile imports | n/a |
| **Hot vs restart** | per-integration declared | `ThingHandler` decides | `@Modified` present → hot; else recycle | proxy invalidates → next call hot | proxy invalidates | reboot only |

### 3.2 Gap Analysis (ranked by impact)

1. **Persistent operator-visible issue stream (high impact, present in HA + OpenHAB).** HomeSynapse has the `ConfigIssue` record but no event-sourced delivery; without `config.validation_completed`, operators see issues only in logs. **GAP RANK 1.**
2. **Snapshot/rollback of last known good config (high impact, present in Kura + Hubitat).** No surveyed pure-text platform has this; HomeSynapse should at least keep the previous `ConfigModel` in memory. **GAP RANK 2.**
3. **Schema-update instructions analogous to `OH-INF/update/*.xml` (medium impact, present in OpenHAB).** `ConfigMigrator` covers file-level schema; per-integration adapter migration is Research 6 REC-41's domain. **GAP RANK 3.**
4. **Sub-system-typed reload callbacks (medium impact, OpenHAB + Kura).** `ConfigurationChangeListener` does not yet exist; absence forces every reload to be an `INTEGRATION_RESTART`. **GAP RANK 4.**
5. **`!secret`-style indirection (medium impact, HA).** HomeSynapse has `SecretStore` but does not yet specify the YAML-level indirection syntax (`!secret api_key` vs `${secret:api_key}`). **GAP RANK 5.**

### 3.3 Over-Abstraction Analysis

- **`MigrationPreview` (4 fields) — DEFENSE.** Not over-abstracted. HA's experience (PR #46078: "Don't step version in migrate_entry to support rollbacking") shows dry-run migration is a real operator requirement.
- **`ConfigChangeSet` (2 fields) + `ConfigChange` (5 fields) — DEFENSE.** Required to deliver actionable info to listeners; Spring's `EnvironmentChangeEvent` carries only key names and is reportedly insufficient (Spring Cloud Commons #846 thread).
- **`ChangeType.SECTION_RESTRUCTURED` enum value — RETRACTION CANDIDATE.** No surveyed platform expresses structural changes via a discriminated enum; HA and OpenHAB treat structural change as "version bump + migrator", not as a per-change classification. *Recommendation: keep the enum value but document its scope narrowly* (used only by `ConfigMigrator` output, not by `ConfigurationChangeListener`). No code change.
- **`MigrationChange` with 5 fields alongside `ConfigChange` with 5 fields — DEFENSE.** They are distinct: `MigrationChange` represents an irreversible schema-level transform; `ConfigChange` represents a value-level edit. Conflating them would force migration logic to leak into listener dispatch.
- **`Severity` 3-value enum (FATAL/ERROR/WARNING) — DEFENSE, narrower than HA's 4-level.** HA's Repairs has `critical/error/warning/info`; we deliberately drop `INFO` per the constraint "do not propose a 4th". Defensible because `INFO`-level config notifications belong in regular telemetry, not the validation issue stream.

### 3.4 Competitive Assessment

HomeSynapse is genuinely differentiated on these axes, with qualifying language that survives scrutiny:

- **"Local-first event-sourced runtime with text-file configuration as the source of truth."** Survives: HA is event-sourced for state but file-based for legacy YAML config and *opaque-JSON-based* for UI flows; OpenHAB is text-config-based but not event-sourced for state; Hubitat is opaque. No surveyed system combines event-sourced state with text-file config-as-source-of-truth.
- **"JPMS-modular Java 21 runtime with explicit module-info for every public boundary."** Survives: OpenHAB is OSGi (different module system); HA is Python; Kura is OSGi. No surveyed Java automation platform uses JPMS.
- **"Three-tier reload classification (HOT/INTEGRATION_RESTART/PROCESS_RESTART) baked into the change event."** Survives narrowly: OpenHAB's `handleConfigurationUpdate` is binary (hot or recycle), Kura's `@Modified` is binary, HA's `async_reload` is per-domain ad-hoc. None expose a three-tier explicit signal.

Claims that do *not* survive:
- ~~"First Java smart-home runtime with JSON Schema validation"~~ — OpenHAB has XSD-based ConfigDescription validation since 2014; Kura has OSGi MetaType validation; the differentiation is *JSON Schema specifically*, not "schema validation".
- ~~"Only platform with secrets encryption"~~ — OpenHAB has Karaf JCEKS, Matter has DAC PKI; HomeSynapse's claim must be "AES-256-GCM with operator-passphrase-derived KDF" specifically.

## 4. Amendment Recommendations [M]

Numbering: RECs continue Research 6's sequence and start at **REC-53**. AMDs continue from **AMD-64** (AMD-47 and AMD-61 withdrawn per task constraints).

---

### REC-53 — Adopt SnakeYAML Engine 3.0.1 as the YAML 1.2 parser
- **Gap citation:** §3.1 row "Source-of-truth artifact"; Doc 06 requires YAML 1.2; classic SnakeYAML supports only YAML 1.1.
- **Lesson source:** §2.8; <https://github.com/snakeyaml/snakeyaml> ("SnakeYAML is a YAML 1.1 processor … For YAML 1.2 you may have a look at SnakeYAML Engine").
- **Change:** Add Maven dependency `org.snakeyaml:snakeyaml-engine:3.0.1` (Apache-2.0). In `com.homesynapse.config`, implement `YamlLoader` as a package-private utility using `org.snakeyaml.engine.v2.api.Load` with `LoadSettings.builder().setAllowDuplicateKeys(false).setAllowRecursiveKeys(false).build()`. Do not expose Engine types in the public API of `com.homesynapse.config`.
- **AMD requirement:** **AMD-64** (new dependency).
- **Backward compat:** No public API surface change.
- **Effort:** **~250 LOC** (loader + tests covering YAML 1.2 boolean coercion, anchors, merge keys disallowed for security).

### REC-54 — Adopt `com.networknt:json-schema-validator` 3.0.2 as the JSON Schema engine
- **Gap citation:** §3.1 row "Schema language"; existing `SchemaRegistry` accepts JSON-text Strings with no validation engine bound.
- **Lesson source:** §2.7; <https://github.com/networknt/json-schema-validator/blob/master/pom.xml> (verified module name `com.networknt.schema`).
- **Change:** Add `com.networknt:json-schema-validator:3.0.2` (Apache-2.0). Exclude `com.ethlo.time:itu` to keep dependency surface minimal — accept `java.time.OffsetDateTime`-precision `date-time` validation. Implement `JsonSchemaCompositeValidator` (package-private) bridging `SchemaRegistry.register(String coreJson, String... integrationJsons)` to `com.networknt.schema.SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12, builder -> …)`.
- **AMD requirement:** **AMD-65** (new dependency).
- **Backward compat:** None broken; `SchemaRegistry` interface unchanged.
- **Effort:** **~400 LOC** (validator + composition + error-to-`ConfigIssue` mapping + integration-schema-on-install hook).

### REC-55 — Introduce `ConfigurationChangeListener` as a typed-per-section sealed interface
- **Gap citation:** §3.2 GAP RANK 4; type does not exist.
- **Lesson source:** §2.2 (OpenHAB `ThingHandler.handleConfigurationUpdate(Configuration)`), §2.3 (Kura `@Modified`).
- **Change:** New public sealed interface in `com.homesynapse.config` with permits `Hot`, `RequiresRestart`. Method `onChange(ConfigChangeSet, S newSection, S oldSection) → ReloadClassification`. Synchronous dispatch before `config_changed` event publish.
- **AMD requirement:** **AMD-66**.
- **Backward compat:** Additive; no existing listener impls.
- **Effort:** **~120 LOC** (interface + dispatcher in `ConfigurationService` impl + 3 unit tests).

### REC-56 — Change `ConfigMigrator` to `(major, minor)` pairs to align with REC-41
- **Gap citation:** §3.1 row "Schema migration"; current `fromVersion()→int` cannot express HA-style minor-version-safe downgrade.
- **Lesson source:** <https://github.com/home-assistant/developers.home-assistant/blob/master/docs/config_entries_config_flow_handler.md> (verbatim quote in §2.1).
- **Change:** Replace the existing `ConfigMigrator` methods with `fromMajor() / fromMinor() / toMajor() / toMinor() / migrate(Map<String,Object>)`. Add `configSchemaMajor` and `configSchemaMinor` fields to `ConfigModel` (5 → 6 fields), replacing the single `schemaVersion`.
- **AMD requirement:** **AMD-67**.
- **Backward compat:** Breaks internal call sites that construct `ConfigModel`; **not a public-API break** because `ConfigModel` is consumed only inside `com.homesynapse.config`. Single-int call sites map `schemaVersion → (schemaVersion, 0)`.
- **Effort:** **~180 LOC** (interface change + ConfigModel field + 4 call sites + migration of in-repo impls + tests).

### REC-57 — Introduce `SecureCredentialBundle` as a layered record over `SecretStore`
- **Gap citation:** §3.2 GAP RANK 5; type does not exist; coordinates with Research 6 REC-45.
- **Lesson source:** §2.1 (HA's `!secret` indirection); §2.4 (Matter's NOC/DAC separation).
- **Change:** New public record `SecureCredentialBundle(String integrationId, Map<String,SecretEntry> entries, Instant createdAt, Instant updatedAt)`. **Composition with `SecretStore`, not replacement.** Returned by `ConfigurationAccess#credentialsFor(String integrationId)`. Per-integration scoping by key prefix (`integration.<id>.*`).
- **AMD requirement:** **AMD-68**.
- **Backward compat:** Additive.
- **Effort:** **~150 LOC** (record + accessor on `ConfigurationAccess` + namespace scoping logic + tests).

### REC-58 — Adopt Argon2id KDF for passphrase-derived AES-256-GCM secret encryption
- **Gap citation:** Doc 06 specifies AES-256-GCM but not key source.
- **Lesson source:** RFC 9106 §4; <https://cryptography.io/en/latest/hazmat/primitives/key-derivation-functions/>.
- **Change:** Implement `Argon2idKeyDerivation` in `com.homesynapse.config.internal` (no public type exposed). The recommended JCE-provider backing is BouncyCastle (`org.bouncycastle:bcprov-jdk18on`, **Bouncy Castle Licence — an MIT-style license per bouncycastle.org/licence.html: "Please note the Bouncy Castle License should be read in the same way as the MIT license."**). Parameters: memory = 2^16 = 64 MiB, iterations = 3, parallelism (lanes) = 4, salt = 16 bytes from `SecureRandom`, tag = 256 bits. This is the **SECOND RECOMMENDED option** from RFC 9106 §4 (the FIRST RECOMMENDED option is t=1, p=4, m=2 GiB — not feasible on a 4 GB Pi 4). Derivation runs once at startup from the operator passphrase (`HOMESYNAPSE_SECRETS_PASSPHRASE` env var or interactive prompt); the derived 32-byte key encrypts each secret with a fresh 12-byte GCM nonce.
- **AMD requirement:** **AMD-69** (BouncyCastle dependency).
- **Backward compat:** New code path; existing in-memory `SecretStore` users unaffected.
- **Effort:** **~300 LOC** (KDF + persistence format + ciphertext envelope record + tests + threat model doc).

### REC-59 — Add `config.validation_completed` event and register a `ProjectionEventHandler`
- **Gap citation:** §3.2 GAP RANK 1.
- **Lesson source:** §2.1 (HA Repairs); <https://developers.home-assistant.io/docs/core/platform/repairs/>; coordinates with Research 8 REC-28's `DispatchingProjectionAdvancer`.
- **Change:** Add `@EventType("config.validation_completed")` with payload `{schemaMajor:int, schemaMinor:int, issues:List<ConfigIssue>, severityCounts:Map<Severity,Integer>}`. **Observability-only** (not state-changing). Register a `ProjectionEventHandler` projecting to in-memory `ValidationIssueProjection` keyed by `(sectionPath, issueId)`. Also add `config.section_reloaded` as an additional observability event after successful hot reload of a single section.
- **AMD requirement:** **AMD-70**.
- **Backward compat:** Legacy `config_changed`, `secret_added`, `secret_removed` remain unchanged (snake_case grandfathered).
- **Effort:** **~220 LOC** (event records + handler + projection + serialization + tests).

### REC-60 — Adopt hybrid directory layout: single root + per-integration `integrations/` subdir
- **Gap citation:** §3.2 GAP RANK 5; Doc 06 silent.
- **Lesson source:** §2.1 HA's `!include` and §2.2 OpenHAB's per-domain dirs.
- **Change:** Layout:
  ```
  /etc/homesynapse/
    homesynapse.yaml          # root: core sections + integration enable-list
    secrets.yaml.enc          # encrypted bundle (AES-256-GCM, REC-58)
    integrations/
      hue.yaml                # per-integration; integrationId == file stem
      mqtt.yaml
    schemas/                  # composed/cached at runtime (REC-54)
      core.json
      integration.hue.json
  ```
  HA-style `!include integrations/*.yaml` (one level deep only). `SchemaRegistry` composes one schema per file before validating.
- **AMD requirement:** **AMD-71**.
- **Backward compat:** New layout; single-file config remains a valid degenerate case.
- **Effort:** **~200 LOC** (loader extension + path traversal protection + schema composition wiring + 6 tests).

### REC-61 — Surface `ReloadResult` classification breakdown via `config.section_reloaded`
- **Gap citation:** Existing `ReloadResult` (3 fields) does not break down by classification at event level.
- **Lesson source:** §2.3 Kura snapshot rollback + §2.4 Spring `EnvironmentChangeEvent`.
- **Change:** Expose `ReloadResult`'s 3 fields via the new event payload so the UI can show "8 sections hot-reloaded, 2 require integration restart, 0 require process restart". **Does not modify `ReloadResult` shape** — additive consumption only.
- **AMD requirement:** None (covered by AMD-70).
- **Backward compat:** Pure addition.
- **Effort:** **~60 LOC**.

---

## 5. Caveats and Open Questions [M]

### 5.1 Source reliability notes
- Hubitat is closed-source; all §2.6 claims are derived from public docs and community forums, not source code.
- The `snakeyaml-engine` 3.0.1 module name `org.snakeyaml.engine` is inferred from Eclipse OSGi metadata and javadoc.io; I could not verbatim-verify a MANIFEST.MF `Automatic-Module-Name` line in the packaged JAR. Fall back to OSGi `Bundle-SymbolicName`-derived module name if needed.
- The networknt v3.0.2 release note ("Upgrade Jackson from 3.1.0 to 3.1.1") confirms v3.x is on Jackson 3.x's `tools.jackson.*` groupId. If LTD-19 standardizes HomeSynapse on Jackson 2.x (`com.fasterxml.jackson.*`), we must use networknt v2.x or v1.5.x instead. **Verify Jackson version before committing to REC-54's specific version.**

### 5.2 Unresolved tensions between platforms
- **File vs database as source of truth.** HA dual-models (`configuration.yaml` + `.storage/*.json`) creates the operator complaint chain that produced the Repairs panel. OpenHAB tried both and as of OH4 actively encourages migration *away* from text files toward the UI/JSONDB. HomeSynapse's decision to remain text-first is contrarian; we should document explicitly that this is a deliberate trade against UI ergonomics in favor of git-diffability.
- **Migration version pair: hierarchical or flat?** HA uses `(version, minor_version)` where minor is forwards-compat. OpenHAB's `OH-INF/update/*.xml` is monotonic-only. We chose HA's model in REC-56; if Research 6 REC-41 later requires monotonic-only, this is a forced inconsistency we flag now.
- **Synchronous vs async listener dispatch.** Doc 06 specifies synchronous dispatch before `config_changed`. Spring is async. Synchronous is strictly safer for the three-tier classification but requires a 50 ms-per-listener budget we have not validated.

### 5.3 Questions requiring empirical validation (spike/prototype)
- **Spike Q1: SnakeYAML Engine 3.0.1 throughput on Pi 4 (4 GB)** for a 500-line YAML config with ~80 anchors/aliases. No published Pi 4 / ARM benchmark exists. Target: <500 ms cold (first parse), <50 ms warm (after JIT). **Required before merge of REC-53.**
- **Spike Q2: Argon2id (64 MiB / 3 iter / 4 lanes) wall-clock on Pi 4 Cortex-A72.** Public benchmarks for Argon2id on this class of CPU estimate 250–700 ms per derivation; our cost model assumes "derive once at startup". Need empirical confirmation. **Required before merge of REC-58.**
- **Spike Q3: networknt validator memory residency** for a composed schema of (core + 10 integration schemas) on a 256 MiB-heap process. Memory residency for Draft 2020-12 schemas was raised by maintainers as "highly dependent on workload". **Required before merge of REC-54.**
- **Open question:** Whether `ConfigModel.rawMap` should remain `Map<String,Object>` after typed `ConfigSection`s ship. Phase-2 simplification (per verified inventory) says yes; long-term pressure is to drop it. Defer to Phase 3.

### 5.4 Conflicts between Doc 06 and the verified MODULE_CONTEXT inventory
Per the task's authority rule (MODULE_CONTEXT is authoritative for type-level facts; Doc 06 for behavioral contracts):
- **Conflict 1: `ConfigurationValidationException` package location.** The verified inventory states this exception is in `com.homesynapse.event`, NOT `com.homesynapse.config`. If Doc 06 implies otherwise, the inventory wins — exception stays in `com.homesynapse.event`. RECs in this document do *not* move it.
- **Conflict 2: `schemaVersion` field count.** The verified inventory states `ConfigModel` has 5 fields with `schemaVersion` as a single int. REC-56 proposes 6 fields with `(major, minor)`. This is a *proposed* change subject to AMD-67, not a contradiction in existing state — flagged so reviewers can either approve AMD-67 or reject REC-56 and require Research 6 REC-41 to reconcile to single int.
- **No other conflicts identified.**

## 6. Appendix: Sources [M]

### Home Assistant
- <https://developers.home-assistant.io/blog/2023/12/18/config-entry-minor-version/>
- <https://github.com/home-assistant/developers.home-assistant/blob/master/docs/config_entries_config_flow_handler.md>
- <https://github.com/home-assistant/core/blob/dev/homeassistant/config_entries.py>
- <https://github.com/home-assistant/core/pull/20888/files>
- <https://github.com/home-assistant/core/pull/46078>
- <https://developers.home-assistant.io/docs/core/platform/repairs/>
- <https://www.home-assistant.io/integrations/repairs/>
- <https://www.home-assistant.io/docs/configuration/secrets/>
- <https://www.home-assistant.io/docs/configuration/troubleshooting/>
- <https://github.com/home-assistant/core/issues/40821>
- <https://github.com/home-assistant/core/issues/119654>
- <https://smarthomepursuits.com/how-to-store-secrets-in-home-assistant>

### OpenHAB
- <https://www.openhab.org/docs/developer/bindings/thing-xml.html>
- <https://www.openhab.org/docs/administration/console.html>
- <https://v30.openhab.org/docs/developer/bindings/config-xml.html>
- <https://github.com/openhab/openhab-core/issues/1924>
- <https://github.com/openhab/openhab-core/pull/3330>
- <https://community.openhab.org/t/renewing-configuration-secrets-in-openhab-3/125134>
- <https://community.openhab.org/t/need-to-change-keystore-password-in-openhab2/21153>

### Eclipse Kura
- <https://download.eclipse.org/kura/docs/api/4.1.0/apidocs/org/eclipse/kura/configuration/ConfigurationService.html>
- <https://github.com/eclipse-kura/kura/blob/develop/kura/org.eclipse.kura.api/src/main/java/org/eclipse/kura/configuration/ConfigurationService.java>
- <https://liferay.dev/blogs/-/blogs/revisiting-osgi-ds-annotations>
- <https://vogella.com/blog/configuring-osgi-declarative-services-2024/>

### Spring Boot / Spring Cloud
- <https://www.baeldung.com/spring-reloading-properties>
- <https://alexanderobregon.substack.com/p/dynamic-property-reload-in-spring>
- <https://github.com/spring-cloud/spring-cloud-commons/issues/846>

### Micronaut
- <https://docs.micronaut.io/latest/guide/>
- <https://medium.com/graalvm/introducing-micronaut-aot-build-time-optimizations-for-your-micronaut-applications-68b8f1302c5>
- <https://micronaut-projects.github.io/micronaut-aot/snapshot/guide/index.html>

### Hubitat
- <https://docs2.hubitat.com/en/user-interface/settings/backup-and-restore>
- <https://community.hubitat.com/t/backup-file-format/72105>

### networknt/json-schema-validator
- <https://github.com/networknt/json-schema-validator>
- <https://github.com/networknt/json-schema-validator/blob/master/pom.xml>
- <https://github.com/networknt/json-schema-validator/releases>
- <https://central.sonatype.com/artifact/com.networknt/json-schema-validator>

### SnakeYAML / SnakeYAML Engine / Jackson YAML
- <https://github.com/snakeyaml/snakeyaml>
- <https://github.com/snakeyaml/snakeyaml-engine>
- <https://central.sonatype.com/artifact/org.snakeyaml/snakeyaml-engine>
- <https://docs.herodevs.com/snakeyaml/cve-2022-1471>
- <https://nvd.nist.gov/vuln/detail/cve-2022-1471>
- <https://snyk.io/blog/snakeyaml-unsafe-deserialization-vulnerability/>
- <https://bitbucket.org/snakeyaml/snakeyaml/issues/429/provide-automatic-module-name-entry-in>
- <https://github.com/FasterXML/jackson/wiki/Jackson-Release-2.15>
- <https://github.com/FasterXML/jackson/wiki/Jackson-Release-3.0>

### Crypto / Matter / TPM
- <https://www.rfc-editor.org/rfc/rfc9106.html>
- <https://cryptography.io/en/latest/hazmat/primitives/key-derivation-functions/>
- <https://www.bouncycastle.org/licence.html>
- <https://docs.silabs.com/matter/latest/matter-fundamentals-security/>
- <https://handbook.buildwithmatter.com/how-it-works/commisioning/>
- <https://developer.espressif.com/blog/matter-security-model/>

## 7. HomeSynapse Code-Level Implications [M]

### 7.1 `ConfigurationChangeListener` interface — exact shape

Public sealed interface in `com.homesynapse.config` (REC-55). Subsystem-typed, not generic. Thread-safety: dispatcher invokes synchronously on the *config-thread* before publishing `config_changed`; listeners must not block longer than 50 ms and must not throw. Ordering: stable insertion order, deterministic across reboots; listeners keyed by `sectionPath()`. `null` contract per HomeSynapse Javadoc-only convention: `sectionPath()` is never `null`; `newSection` is never `null`; `oldSection` is `{@code null}` if the section did not previously exist.

```java
package com.homesynapse.config;

public sealed interface ConfigurationChangeListener<S extends ConfigSection>
    permits ConfigurationChangeListener.Hot,
            ConfigurationChangeListener.RequiresRestart {

    /** {@return the dotted section path this listener observes; never {@code null}} */
    String sectionPath();

    /**
     * Fired synchronously before the legacy {@code config_changed} event is published.
     *
     * @param changes    the change set for this section; never {@code null}
     * @param newSection the new section view; never {@code null}
     * @param oldSection the previous section view, or {@code null} if section is new
     * @return the reload classification this listener resolved
     */
    ReloadClassification onChange(
        ConfigChangeSet changes, S newSection, S oldSection);

    non-sealed interface Hot<S extends ConfigSection>
        extends ConfigurationChangeListener<S> {}

    non-sealed interface RequiresRestart<S extends ConfigSection>
        extends ConfigurationChangeListener<S> {}
}
```

**AMD requirement:** AMD-66. Public in `com.homesynapse.config` (exports unchanged in `module-info.java`).

### 7.2 `SecureCredentialBundle` — record, not interface

Public record in `com.homesynapse.config` (REC-57). **Composition with `SecretStore`, not replacement.** `SecretStore` remains the global keyed store; `SecureCredentialBundle` is a per-integration *view* returned by `ConfigurationAccess#credentialsFor(String integrationId)`. Scoping by `integrationId` string match against secret-entry keys (secret keys prefixed `integration.hue.*` are visible only to integration "hue"). All collections defensive-copied via `Map.copyOf`.

```java
package com.homesynapse.config;

public record SecureCredentialBundle(
    String integrationId,
    Map<String, SecretEntry> entries,
    Instant createdAt,
    Instant updatedAt) {

    public SecureCredentialBundle {
        Objects.requireNonNull(integrationId);
        Objects.requireNonNull(createdAt);
        Objects.requireNonNull(updatedAt);
        entries = Map.copyOf(entries);
    }

    /** {@return the secret value for {@code key}, or {@code null} if absent} */
    public String value(String key) {
        SecretEntry e = entries.get(key);
        return e == null ? null : e.value();
    }
}
```

**AMD requirement:** AMD-68. Layered on existing `SecretStore`; coordinates with Research 6 REC-45.

### 7.3 `ConfigMigrator` (major, minor) reconciliation — option (b) chosen

Three options considered:
- (a) **Keep single int — rejected.** Cannot express HA-style backwards-compatible minor bumps.
- (b) **Change both to `(major, minor)` — chosen.** Aligns directly with HA's production-validated pattern and with Research 6 REC-41's `(int fromMajor, int fromMinor, int toMajor, int toMinor)` adapter shape.
- (c) **Different shapes for file-schema vs adapter-schema — rejected.** Introduces conceptual asymmetry between `ConfigMigrator` (file) and Research 6 REC-41's adapter migrate(). Maintenance burden exceeds the marginal benefit.

Resulting interface (REC-56, AMD-67):
```java
public interface ConfigMigrator {
    int fromMajor();
    int fromMinor();
    int toMajor();
    int toMinor();
    MigrationResult migrate(Map<String, Object> rawMap);
}
```

`ConfigModel` gains `configSchemaMajor` and `configSchemaMinor` (replacing the single `schemaVersion`), changing field count from 5 to 6.

### 7.4 YAML library + JSON Schema validator dependency choices

| Library | Version | License | JPMS module | Effort | Pi 4 performance budget |
|---|---|---|---|---|---|
| `org.snakeyaml:snakeyaml-engine` | 3.0.1 | Apache-2.0 | `org.snakeyaml.engine` (Multi-Release, Java 11+) | ~250 LOC | <500 ms cold for 500-line config (UNVERIFIED — spike Q1) |
| `com.networknt:json-schema-validator` | 3.0.2 | Apache-2.0 | `com.networknt.schema` (moditect-injected) | ~400 LOC | <100 ms for core + 10 integration schemas (UNVERIFIED — spike Q3) |
| `org.bouncycastle:bcprov-jdk18on` (REC-58) | latest 1.80+ | Bouncy Castle Licence (MIT-style) | `org.bouncycastle.provider` (Automatic-Module-Name) | ~50 LOC of the REC-58 ~300 LOC | Argon2id derivation 250–700 ms (UNVERIFIED — spike Q2) |
| **Excluded transitive:** `com.ethlo.time:itu` | — | — | — | — | Accept `OffsetDateTime`-precision date-time validation |

Both validator and parser are kept as *implementation-only* dependencies of `com.homesynapse.config` — they do not appear in the public API. Therefore `module-info.java` uses non-transitive `requires com.networknt.schema;` and `requires org.snakeyaml.engine;`. **If LTD-19 has standardized on Jackson 2.x, downgrade REC-54 to networknt 1.5.x or 2.x latest** — verify before merge.

### 7.5 `ConfigSection` and multi-file organization — hybrid layout

Hybrid: single root `homesynapse.yaml` for core sections, `integrations/*.yaml` for per-integration sections, `secrets.yaml.enc` for AES-256-GCM-encrypted secrets. `!include` is supported one level deep only (no chained includes — a deliberate simplification against HA's chained-include footguns). `SchemaRegistry.compose()` runs after the YAML merge: it concatenates the core schema with each integration schema registered at runtime, validates the composite once, and emits per-section `ConfigIssue`s mapped back to file:line via the YAML parser's source-position info.

### 7.6 New event types

| `@EventType` string | Payload | Classification | Handler registration |
|---|---|---|---|
| `config.validation_completed` | `{schemaMajor:int, schemaMinor:int, issues:List<ConfigIssue>, severityCounts:Map<Severity,Integer>}` | Observability-only | `DispatchingProjectionAdvancer` per R8 REC-28 |
| `config.section_reloaded` | `{sectionPath:String, classification:ReloadClassification, durationMs:long}` | Observability-only | `DispatchingProjectionAdvancer` per R8 REC-28 |
| `config_changed` (legacy) | unchanged | State-changing | unchanged |
| `secret_added` (legacy) | unchanged | State-changing | unchanged |
| `secret_removed` (legacy) | unchanged | State-changing | unchanged |

Dot-namespacing is used for all new events per the verified naming guidance; legacy snake_case events are grandfathered.

### 7.7 `module-info.java` impact for `com.homesynapse.config`

```java
module com.homesynapse.config {
    requires transitive com.homesynapse.event;

    // REC-53, REC-54: implementation-only (NOT transitive)
    requires com.networknt.schema;
    requires org.snakeyaml.engine;
    // REC-58: BouncyCastle for Argon2id
    requires org.bouncycastle.provider;

    exports com.homesynapse.config;
    // implementation packages not exported:
    // com.homesynapse.config.internal (parser, validator, kdf)
}
```

YAML library and schema validator types **must not leak** into the public exports of `com.homesynapse.config`. Concretely: `ConfigurationService.load(Path)` returns a `ConfigModel`, never an `org.snakeyaml.engine.v2.nodes.Node`. `SchemaRegistry.register(String, String...)` takes only JSON-text strings; no `com.networknt.schema.JsonSchema` is exposed. This is what allows non-transitive `requires` and keeps the public API testable without the parser on the classpath.

### 7.8 Migration considerations

- **`ConfigModel` 5 → 6 fields (AMD-67).** Internal-only consumers; all updates land in a single PR. No event-replay impact because legacy `config_changed` payloads carry the *new* `ConfigModel` snapshot, not the schema version triple.
- **`ConfigMigrator` interface change (AMD-67).** No production implementations exist yet per the verified inventory; only the interface signature changes.
- **Secrets format (AMD-69).** Pre-encryption secrets format is in-memory only; first-write produces `secrets.yaml.enc` in the v1 envelope format `{kdfId:"argon2id", kdfParams:{m:65536,t:3,p:4}, salt:Base64, ciphertext:Base64, nonce:Base64, version:1}`. Format `version` field permits future KDF migration.
- **JPMS migration.** Adding `requires com.networknt.schema` and `requires org.snakeyaml.engine` requires both libraries on the module path, not unnamed-module classpath, to avoid the "Required filename-based automodules" warning. Use Gradle's `java.modularity.inferModulePath = true` or Maven's equivalent.

### 7.9 Threat-model documentation deliverable

The secrets layer (REC-57, REC-58) implements protection against this explicit threat model:

> **In scope (defended against):**
> - **T1 — Backup/exfil disclosure.** An attacker who obtains a copy of `secrets.yaml.enc` (e.g. via stolen SD card image, leaked backup, accidental git commit) cannot recover plaintext secrets without the operator passphrase. **Defense:** Argon2id with RFC 9106 §4 "SECOND RECOMMENDED" parameters (m = 64 MiB, t = 3, p = 4) with 16-byte random salt; AES-256-GCM with fresh 12-byte nonce per secret.
> - **T2 — Defense-in-depth against cross-integration read.** A misbehaving integration adapter cannot enumerate secrets belonging to other integrations. **Defense:** `SecureCredentialBundle` scoping by `integrationId`; `ConfigurationAccess#credentialsFor(id)` returns only the matching subset.
>
> **Explicitly out of scope (not defended against):**
> - **T3 — On-device root attacker with live process memory access.** Once the passphrase has been entered and the master key derived, it lives in the JVM heap. An attacker with root and the ability to attach a debugger or read `/proc/<pid>/mem` can extract the master key and all decrypted secrets. **Mitigation requires TPM2-sealed keys; TPM2 is not present on Pi 4 and is optional on Pi 5, therefore this threat is explicitly out of scope for HomeSynapse v1.**
> - **T4 — Cold-boot / DRAM-remanence attacks.** Out of scope; physical-attack threat model.
> - **T5 — Compromised operator passphrase.** If the operator types the passphrase into a keylogged terminal, the encryption provides no defense. Out of scope by definition.
>
> **Trust assumptions:**
> - The operator can keep the passphrase confidential.
> - The HomeSynapse Java process and its JVM are trusted.
> - File-system permissions on `/etc/homesynapse/` restrict read access to the HomeSynapse OS user.
>
> **Defended primitives:**
> - KDF: Argon2id with RFC 9106 §4 second-recommended parameters.
> - Cipher: AES-256-GCM with random 12-byte nonce per record.
> - Envelope: versioned (`v1` today; future Argon2 parameter bumps will increment).
> - Key lifetime: derived once at startup, held for process lifetime, never persisted in derived form.

This threat-model statement is the canonical answer to Doc 06's "what does the secrets layer protect against" question and should be checked into the repository as `doc/secrets-threat-model.md`.