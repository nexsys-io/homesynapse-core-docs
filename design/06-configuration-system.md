# HomeSynapse Core — Configuration System

**Document type:** Subsystem design
**Status:** Locked
**Subsystem:** Configuration System
**Dependencies:** Event Model & Event Bus (§4.3 `config_changed` event type, §8.3 EventPublisher, §9 YAML schema convention), Integration Runtime (§3.8 ConfigurationAccess interface contract, §9 override precedence for integration health parameters, IntegrationDescriptor schema declaration), Glossary v1 (§6.1 Configuration concept), LTD-09 (YAML 1.2, SnakeYAML Engine, JSON Schema, `/etc/homesynapse/`), Architecture Invariants v1 (§8 INV-CE-01 through INV-CE-06, §10 INV-SE-03)
**Dependents:** Automation Engine (§3.2 schema registration, §3.5 well-known file path for automation definitions), Zigbee Adapter (§3.2 integration schema via IntegrationDescriptor), REST API (§8.1 ConfigurationService for config read/write/reload endpoints), Startup, Lifecycle & Shutdown (Doc 12 — Phase 1 config loading, §3.9 shutdown step 9)
**Author:** HomeSynapse Core Architecture
**Date:** 2026-03-06

---

## 0. Purpose

The Configuration System translates human intent expressed in YAML files into validated, typed runtime state that governs every other subsystem. It is the single authority for reading, validating, reloading, and persisting the canonical configuration. Without it, each subsystem would parse its own configuration independently, secrets would scatter across ad hoc mechanisms, schema validation would be inconsistent, and changes would require restarts for everything or nothing.

This subsystem exists to solve a specific failure mode observed in Home Assistant: the dual-storage split formalized by ADR-0010, where UI-managed configuration lives in opaque JSON files under `.storage/` while YAML remains the power-user interface. That split created two incompatible configuration paradigms within one system, fractured the user base, and made Git-based configuration management unreliable for any UI-configured entity. HomeSynapse eliminates this split at the architectural level. The YAML file on disk is the sole source of truth; the UI, the CLI, and the REST API all read from and write to that same file (INV-CE-01).

A second failure mode this subsystem addresses is YAML 1.1 type coercion, where country codes like `NO` silently become `false` and device states `on`/`off` become booleans. LTD-09 locks the parser to SnakeYAML Engine (YAML 1.2), which eliminates this class of bugs entirely. The Configuration System owns the parser integration, secret resolution, and the schema validation pipeline that transforms raw YAML into a safe, typed in-memory model before any subsystem consumes it.

---

## 1. Design Principles

**P1: Single canonical representation.** One YAML file on disk is the source of truth for all configuration. The UI, REST API, CLI, and text editor all operate on the same file. There is no secondary storage, no shadow database, and no format that a user cannot read, diff, or version-control. This is the subsystem-level expression of INV-CE-01.

**P2: Schema is the contract.** Every configuration option is defined in a JSON Schema with type, default, valid range, and behavioral description. The schema is the published API between HomeSynapse and its users. IDE auto-completion, CLI validation, and runtime enforcement all derive from the same schema source (INV-CE-03).

**P3: Secrets are never plaintext at rest.** Configuration files reference secrets by name; the actual values are stored encrypted. A user can safely commit `config.yaml` to Git without exposing API keys, passwords, or tokens. The secrets store is a separate concern from the configuration file (INV-SE-03).

**P4: Validation is comprehensive, not fatal.** A typo in a retention threshold should not prevent lights from turning on. The validation pipeline collects all issues and classifies them by severity. Fatal errors (corrupt YAML, broken secret references) prevent startup. Non-fatal errors (invalid value for one key) cause that key to revert to its schema-defined default while the rest of the system starts normally (INV-RF-06, INV-HO-04).

**P5: Reload classification lives in the schema, not in code.** Whether a configuration change takes effect immediately, requires an integration restart, or requires a process restart is declared as a schema annotation on the property definition. The Configuration System reads this metadata to orchestrate reloads. No subsystem implements ad hoc reload logic.

**P6: Zero configuration is a valid configuration.** HomeSynapse starts and operates correctly with an absent or empty configuration file. Every option has a schema-defined default. The first-run experience requires no YAML editing (INV-CE-02).

---

## 2. Scope and Boundaries

### 2.1 This Subsystem Owns

- Loading and parsing YAML configuration from `/etc/homesynapse/config.yaml` (LTD-09).
- Resolving `!secret` and `!env` YAML tags during parsing.
- Managing the encrypted secrets store (`/etc/homesynapse/secrets.enc`).
- Composing the unified JSON Schema from static core schemas and dynamic integration schemas.
- Validating parsed configuration against the composed schema.
- Maintaining the typed in-memory configuration model.
- Orchestrating reload: re-parsing, diffing, classifying changes, applying hot changes, producing `config_changed` events and `config_error` diagnostic events.
- The UI/API write path: mutating the in-memory model and atomically flushing to disk with optimistic concurrency control.
- Publishing the composed JSON Schema to a well-known path for VS Code auto-completion.
- Implementing the `ConfigurationAccess` interface defined in **Integration Runtime** §3.8.
- The `homesynapse validate-config` CLI command (LTD-09).
- The `homesynapse secrets` CLI subcommand for secret lifecycle management.
- The `homesynapse migrate-config` CLI command for major-version schema migration (INV-CE-06).
- Writing the composed schema file to disk for external tooling.

### 2.2 This Subsystem Does Not Own

- Individual subsystem schema content (the `event_bus:`, `device_model:`, `state_store:`, `persistence:`, and `integration_runtime:` sections) — schema content is defined by **Docs 01–05** §9 respectively. This subsystem validates and manages those schemas; it does not define the key semantics.
- Automation definition semantics — owned by **Automation Engine** (Doc 07). This subsystem manages the file path and schema registration; Doc 07 defines what automations mean.
- Integration-specific configuration schemas — declared by adapters via `IntegrationDescriptor` at registration time. This subsystem validates them; adapters define them.
- System startup sequencing — owned by **Startup, Lifecycle & Shutdown** (Doc 12). This subsystem exposes a load interface; Doc 12 determines when to call it.
- REST API endpoints for configuration — owned by **REST API** (Doc 09). This subsystem provides the `ConfigurationService` interface; Doc 09 exposes it over HTTP.
- Override precedence resolution for integration health parameters — the four-layer merge order (`health_defaults → IntegrationDescriptor → overrides.{type} → user YAML`) is defined in **Integration Runtime** §9. This subsystem implements the merge; the Integration Runtime defines the semantics.

---

## 3. Architecture

### 3.1 Configuration Loading Pipeline

Configuration loading proceeds through six stages. Each stage's output is the next stage's input. Failure at any stage is classified and handled per the validation error model (§3.6).

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  File System  │────▶│  YAML Parse  │────▶│  Tag Resolve │
│  /etc/home-   │     │  SnakeYAML   │     │  !secret     │
│  synapse/     │     │  Engine      │     │  !env        │
│  config.yaml  │     │  (YAML 1.2)  │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
                                                  │
                                                  ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Config      │◀────│  Schema      │◀────│  Default     │
│  Model       │     │  Validation  │     │  Merge       │
│  (typed,     │     │  (JSON       │     │  (schema     │
│   immutable) │     │   Schema)    │     │   defaults)  │
└──────────────┘     └──────────────┘     └──────────────┘
```

**Stage 1: File read.** Read `/etc/homesynapse/config.yaml`. If the file is absent or empty, proceed with an empty map. Record the file's last-modified timestamp for optimistic concurrency (§3.5).

**Stage 2: YAML parse.** Parse via SnakeYAML Engine (LTD-09). The parser returns `Map<String, Object>` and `List<Object>` structures. YAML 1.2 rules apply: `NO` is a string, `on` is a string, `true` is only boolean when unquoted and exactly `true` or `false`.

**Stage 3: Tag resolution.** Two custom YAML tag constructors are registered with SnakeYAML Engine:

- `!secret <key>` — Resolved against the encrypted secrets store (§3.4). If the key does not exist, a FATAL validation issue is recorded and loading aborts.
- `!env <VAR_NAME>` — Resolved against the process environment. If the variable is unset, a FATAL validation issue is recorded and loading aborts. An optional `!env VAR_NAME:default_value` form permits fallback to a default when the variable is absent, which avoids a FATAL error.

Tag resolution produces a fully materialized map with no unresolved references. Resolved secret values exist only in memory; they are never written back to the YAML file or included in log output (INV-SE-03).

**Stage 4: Default merge.** The composed JSON Schema (§3.2) declares a `default` value for every property. The merge walks the schema tree and inserts defaults for any key absent from the parsed map. This is how INV-CE-02 is satisfied: an empty file produces a complete configuration using only schema defaults.

**Integration health override merge.** The four-layer integration override precedence defined in **Integration Runtime** §9 (`health_defaults → IntegrationDescriptor → overrides.{type} → user YAML`) is resolved during this stage. For each registered integration type, the merge proceeds in precedence order: code-level health defaults from the integration runtime are applied first, then IntegrationDescriptor-declared values overlay those defaults, then per-type overrides from the `overrides.{type}:` section of the YAML are applied, and finally any user-specified values under the integration's section take highest precedence. This merge occurs after the general schema default merge and before schema validation, so the composed result passes through validation as a unified map. The Integration Runtime defines the semantics of each layer; this subsystem implements the mechanical merge.

**Stage 5: Schema validation.** The merged map is validated against the composed JSON Schema using `networknt:json-schema-validator` (LTD-09). Validation runs with `allErrors` mode to collect every issue in a single pass. Each issue is classified per §3.6 (FATAL, ERROR, or WARNING). If any FATAL issues exist, loading aborts. ERROR issues cause the affected key to revert to its schema default; a `ConfigIssue` record is retained for reporting. WARNING issues are recorded but do not alter values.

**Stage 6: Model construction.** The validated, defaulted map is projected into a typed, immutable `ConfigModel` (§4.1). The model is the sole runtime representation of configuration. All subsystem access goes through this model; no subsystem re-reads the YAML file.

### 3.2 Schema Composition

The Configuration System manages two categories of schema:

**Core schemas** are static JSON Schema files bundled in the HomeSynapse distribution. One file per subsystem: `event-bus.schema.json`, `device-model.schema.json`, `state-store.schema.json`, `persistence.schema.json`, `integration-runtime.schema.json`, `config-system.schema.json`. Each corresponds to a top-level YAML key defined in Docs 01–05 §9 and this document's §9 respectively. A shared `definitions.schema.json` holds reusable types (durations, byte sizes, log levels). These files carry a `$schema` draft and a `version` property that tracks the config schema version (INV-CE-03).

**Integration schemas** are contributed at runtime. Each `IntegrationDescriptor` (see **Integration Runtime** §3.8) may declare a JSON Schema fragment for the `integrations.{type}:` section. The `SchemaRegistry` accepts these fragments during integration registration and stores them keyed by integration type.

**Composition at startup:**

1. Load all core schemas from the distribution classpath.
2. Collect integration schemas from registered `IntegrationDescriptor` instances.
3. Build a root schema: top-level properties for each core subsystem section (`$ref` to the core schema file), plus an `integrations` property whose sub-properties are keyed by integration type (`$ref` to the integration schema fragment). The root schema includes a `schema_version` property and a `version` enum constrained to the current major version (INV-CS-03).
4. Write the composed schema to `/etc/homesynapse/schema/config.schema.json`. This path is stable and documented for the Red Hat YAML VS Code extension.
5. The composed schema is also the input for `homesynapse validate-config` (LTD-09).

Schema composition occurs once during startup, after integration registration and before configuration validation. If a new integration is registered at runtime (future consideration, not MVP), the schema must be recomposed.

### 3.3 Reload Mechanism

Configuration reload is triggered explicitly. There is no filesystem watching in MVP. Three triggers are supported:

- API: `POST /api/config/reload` (authenticated, Doc 09).
- CLI: `homesynapse reload-config` (sends SIGHUP to the running process).
- Signal: `SIGHUP` received by the process.

**Reload pipeline:**

1. **Re-parse.** Run stages 1–6 of the loading pipeline (§3.1) against the current file on disk. This produces a candidate `ConfigModel`.
2. **Diff.** Compare the candidate model against the current active model, section by section, key by key. Produce a `ConfigChangeSet` (§4.3) listing every changed key with its old value, new value, and the `x-reload` classification from the schema.
3. **Classify.** Partition the change set into three buckets: `hot` (apply immediately), `integration-restart` (requires restarting the affected integration), and `process-restart` (requires full process restart).
4. **Validate atomicity.** If any key in the candidate model has a FATAL or ERROR validation issue, the entire reload is rejected. A partially valid configuration is never applied. The active model remains unchanged.
5. **Swap.** Replace the active `ConfigModel` atomically (volatile reference swap). The old model becomes eligible for garbage collection.
6. **Notify.** For each changed section, produce a `config_changed` event via `EventPublisher.publishRoot()` with `EventOrigin.SYSTEM` and NORMAL priority (see **Event Model & Event Bus** §4.3). The event payload carries the section path and a summary of what changed.
7. **Report.** If any changes are classified as `integration-restart` or `process-restart`, the reload response includes the list of affected keys and the required action. The UI/API surfaces this to the user. The Configuration System does not itself restart integrations or the process; it reports what is needed, and the caller or operator acts.

**The `x-reload` schema annotation.** Each property in the JSON Schema may carry a custom extension:

```json
{
  "retention_days": {
    "type": "integer",
    "default": 30,
    "x-reload": "hot"
  }
}
```

Three values are defined: `hot` (takes effect on next access to the ConfigModel), `integration-restart` (requires restarting the integration that owns this section), `process-restart` (requires full process restart). The default for any property without an `x-reload` annotation is `process-restart`, which is the safe fallback.

### 3.4 Secret Store

The secret store manages encrypted credential storage, separated from the configuration file.

**Storage format.** Secrets are stored in `/etc/homesynapse/secrets.enc` as a JSON object encrypted with AES-256-GCM. The encryption key is a 256-bit key stored at `/etc/homesynapse/.secret-key` with POSIX permissions `0400` (owner-read only). The key file is generated on first use of the `homesynapse secrets set` command.

**Lifecycle:**

- On first run with no secrets needed, neither file exists. INV-CE-02 is satisfied: the system starts without a secrets store.
- On first `homesynapse secrets set <key> <value>`, the CLI generates a random 256-bit key, writes `.secret-key` with `0400` permissions, encrypts the secret, and writes `secrets.enc`.
- Subsequent `set` operations decrypt the store, update the map, and re-encrypt.
- `homesynapse secrets list` shows key names only, never values.
- `homesynapse secrets get <key>` outputs the decrypted value to stdout (for scripting).
- `homesynapse secrets remove <key>` removes a key from the store.

**Resolution during parse.** When the YAML parser encounters `!secret hue_api_key`, the tag constructor:

1. Opens and decrypts `secrets.enc` using `.secret-key`.
2. Looks up `hue_api_key` in the decrypted map.
3. Returns the plaintext value into the in-memory parse tree.
4. If the key is not found, records a FATAL validation issue.

The decrypted secret store is held in memory only for the duration of tag resolution, then discarded. Resolved values exist in the `ConfigModel` only in the fields that reference them. Log redaction rules (LTD-15) ensure these values are never emitted in structured log output.

**Per-operation backup (AMD-16).** Before every `set` or `remove` operation that modifies `secrets.enc`, the CLI creates a backup copy at `secrets.enc.bak.{N}` (where `{N}` is a monotonically increasing integer, 1-indexed). A maximum of 5 backup files are retained; when a 6th backup would be created, the oldest backup is deleted. This 5-rotation backup policy ensures that corruption or accidental deletion of secrets can be recovered from the most recent pre-operation state without unbounded disk growth.

**Recovery CLI.** The command `homesynapse secrets restore [--backup N]` restores from the specified backup (or the most recent if `--backup` is omitted). The restore operation:

1. Decrypts the backup file using the current `.secret-key` to verify integrity (AES-GCM authentication pass).
2. If decryption succeeds, atomically replaces `secrets.enc` with the backup contents (write-to-temp-then-rename, same mechanism as §3.5).
3. Produces a `secrets_restored` event (severity: NORMAL) recording the backup number and the count of keys restored.
4. If decryption fails (key mismatch or corruption), reports the failure and does not modify `secrets.enc`.

The `homesynapse secrets list-backups` command shows available backups with timestamps and key counts (decrypted to count keys, not to display values).

**`!env` resolution.** The `!env` tag reads from the process environment via `System.getenv()`. This mechanism is intended for container deployments where secrets are injected as environment variables by the orchestrator. The optional default form `!env MQTT_PASSWORD:guest` prevents a FATAL error when the variable is absent.

### 3.5 UI/API Write Path

The write path satisfies INV-CE-01: the UI and API modify the same YAML file that a user edits by hand.

**Write protocol:**

1. **Read current model.** The caller obtains the active `ConfigModel` and the file's `fileModifiedAt` timestamp (the concurrency token recorded at load time).
2. **Compute mutation.** The caller specifies the changes as a `List<ConfigMutation>` — a set of (sectionPath, key, newValue) tuples.
3. **Acquire write lock.** A single `ReentrantLock` serializes all write operations. Only one writer at a time.
4. **Concurrency check.** Before writing, stat the config file. If the current last-modified timestamp differs from the `fileModifiedAt` concurrency token, reject the write with a `ConcurrentModificationException`. This detects external edits (text editor, `scp`, Git pull) that occurred between the read and the write.
5. **Apply and validate.** Apply the mutations to a copy of the current in-memory map. Run schema validation on the mutated copy. If validation produces FATAL or ERROR issues, reject the write.
6. **Atomic flush.** Serialize the mutated map to YAML using SnakeYAML Engine's emitter. Write to a temporary file in the same directory (`config.yaml.tmp`). Call `fsync()`. Rename to `config.yaml` (atomic on POSIX). Update the recorded `fileModifiedAt` timestamp.
7. **Reload.** Trigger the reload pipeline (§3.3) to activate the new configuration.
8. **Release write lock.**

**Known limitation: comment loss.** SnakeYAML Engine does not preserve YAML comments during round-trip serialization. A write through the UI/API strips all comments from the file. This is a significant tradeoff for power users who annotate their configuration. The design doc records this as a known limitation. Comment-preserving YAML round-tripping (via line-level patching or a comment-aware parser) is a future improvement candidate for post-MVP.

**Mitigation.** Before the first UI/API write, the system logs a WARNING and creates a timestamped backup of the original file (preserving comments). The backup path follows the pattern `config.yaml.bak.{ISO8601}`. This ensures the user can recover their commented configuration if the UI write was unintended.

### 3.6 Validation Error Model

Validation produces a list of `ConfigIssue` records (§4.5), each classified into one of three severities:

**FATAL.** The configuration cannot be loaded at all. Examples: YAML syntax error (malformed file), unresolvable `!secret` reference (key not in secrets store), unresolvable `!env` reference (variable not set, no default), `schema_version` incompatible with the running HomeSynapse version. On startup, FATAL issues cause the process to exit with code 2. On reload, FATAL issues cause the reload to be rejected; the active configuration remains unchanged.

**ERROR.** A specific configuration value is invalid, but the rest of the configuration is usable. Examples: negative integer where a positive integer is required, string value where an enum is expected, value outside the declared `minimum`/`maximum` range. The affected key reverts to its JSON Schema default value. A `ConfigIssue` record is retained. A `config_error` diagnostic event is produced for each ERROR-severity issue (see **Event Model & Event Bus** §4.3 — `config_error` is a System lifecycle event with DIAGNOSTIC priority and SYSTEM origin, using the well-known system subject reference). The dashboard displays a persistent notification identifying the key, the invalid value, and the applied default. On startup, ERROR issues allow the process to start (exit code 0, but with warnings logged). On reload, ERROR issues cause the reload to be rejected entirely; a partially corrected configuration is never applied.

**WARNING.** The configuration is valid but contains something worth noting. Examples: deprecated key (still functional, scheduled for removal per INV-CS-06), unknown key (possible typo — detected because JSON Schema uses `additionalProperties: false` on known sections), value near the boundary of its valid range. No value is changed. The issue is logged and surfaced in the dashboard.

**On reload, the atomicity rule applies: if the candidate configuration contains any FATAL or ERROR issues, the entire reload is rejected.** The active model is not modified. This ensures that a reload never degrades a running system. At startup, the system is more permissive because there is no prior good state to preserve — ERROR keys revert to defaults, and the system starts in a degraded-but-functional state.

**CLI behavior.** `homesynapse validate-config` loads and validates the configuration without starting the system. It reports all issues grouped by severity, with file path, YAML line number (where determinable from SnakeYAML Engine's marks), JSON Schema validation path, and a human-readable explanation. Exit codes: 0 (no issues or only warnings), 1 (errors present — system would start but with defaults applied), 2 (fatal issues — system would refuse to start).

### 3.7 Configuration Migration Framework (AMD-13)

When HomeSynapse upgrades introduce configuration schema changes (new keys, renamed keys, removed keys, restructured sections), the Configuration Migration Framework ensures that existing user configurations are automatically migrated to the new schema without data loss and without requiring manual editing.

**Migration identity.** Each migration is identified by a `(from_version, to_version)` pair corresponding to `schema_version` integers. Migrations form a linear chain: version 1 → 2, 2 → 3, etc. The framework applies migrations sequentially from the file's declared `schema_version` to the runtime's expected version. Skipping versions is not supported — if a user upgrades from version 1 to version 4, migrations 1→2, 2→3, and 3→4 execute in sequence.

**ConfigMigrator interface.**

```java
public interface ConfigMigrator {
    int fromVersion();
    int toVersion();
    MigrationResult migrate(Map<String, Object> rawConfig);
}
```

Each `ConfigMigrator` implementation operates on the raw YAML map (parsed but not yet validated). The migration produces a `MigrationResult` containing the transformed map and a list of `ConfigChange` records documenting each modification:

```java
public record MigrationResult(
    Map<String, Object> migratedConfig,
    List<ConfigChange> changes
) {}

public record ConfigChange(
    ChangeType type,
    String path,
    Object oldValue,
    Object newValue,
    String reason
) {}

public enum ChangeType {
    KEY_RENAMED, KEY_ADDED, KEY_REMOVED, VALUE_TRANSFORMED, SECTION_RESTRUCTURED
}
```

**Migration execution flow.** Migration runs during the loading pipeline (§3.1) between the YAML parse stage and the schema validation stage:

1. Parse the YAML file into a raw map.
2. Read `schema_version` from the map.
3. If `schema_version` < runtime expected version, locate the migration chain from file version to runtime version.
4. Execute each migration in sequence. Each migration receives the output of the previous migration.
5. Update `schema_version` in the map to the runtime expected version.
6. Proceed to schema composition and validation as normal.
7. If all stages succeed, write the migrated configuration back to disk (using the same atomic write-to-temp-then-rename mechanism from §3.5). This persists the migration so it runs only once.

**Migration preview.** Before applying migrations, the framework can produce a `MigrationPreview` — a dry-run report showing what changes would be made without modifying the file:

```java
public record MigrationPreview(
    int fromVersion,
    int toVersion,
    List<ConfigChange> plannedChanges,
    boolean requiresUserReview
) {}
```

The CLI command `homesynapse migrate-config --preview` generates this preview. Migrations that remove keys or transform values in lossy ways set `requiresUserReview: true`, which the CLI reports as a warning prompting the user to review before upgrading.

**Migration testing contract.** Every `ConfigMigrator` implementation must include a round-trip test: given a representative configuration at the `fromVersion`, apply the migration, validate the result against the `toVersion` schema, and verify that all user-specified values survive the migration (no silent data loss). This is a Phase 3 testing requirement enforced by code review.

**Backup before migration.** Before applying any migration to disk, the framework creates a backup of the original configuration file at `{config_path}.pre-migration-v{from_version}`. This backup is never automatically deleted, providing a manual recovery path if a migration produces unexpected results.

**Invariant citation.** Configuration migration preserves INV-CE-02 (zero-config first run) by ensuring that default values for new keys are applied automatically. It preserves INV-CS-06 (deprecation policy) by providing the mechanism through which deprecated keys are renamed or removed across versions.

**Relationship to §14 Future Considerations.** This section supersedes the ConfigMigrator entry that was previously listed in §14 as a future consideration. The migration framework is promoted to a core design element because schema evolution is inevitable once HomeSynapse ships its first release, and retrofitting migration support after users have configuration files in the wild is significantly harder than building it in from the start.

---

## 4. Data Model

### 4.1 ConfigModel

The in-memory representation of a validated, complete configuration. The `ConfigModel` is immutable after construction. Subsystems hold a reference to the active model; a reload swaps the reference atomically.

```java
public record ConfigModel(
    int schemaVersion,
    Instant loadedAt,
    Instant fileModifiedAt,           // file mtime at read time; concurrency token for write path (§3.5)
    EventBusConfig eventBus,
    DeviceModelConfig deviceModel,
    StateStoreConfig stateStore,
    PersistenceConfig persistence,
    IntegrationRuntimeConfig integrationRuntime,
    ConfigSystemConfig configSystem,
    Map<String, IntegrationConfig> integrations,
    Map<String, Object> rawMap        // full parsed map for ConfigurationAccess
) {}
```

Each subsystem-specific record (`EventBusConfig`, `DeviceModelConfig`, `ConfigSystemConfig`, etc.) is a typed Java record mirroring the JSON Schema for that section, with field types enforced at construction. Integration-specific configs are stored as `Map<String, IntegrationConfig>` keyed by integration type, where `IntegrationConfig` is a thin wrapper over the validated subtree (satisfying the `ConfigurationAccess` contract from **Integration Runtime** §3.8).

The `fileModifiedAt` field records the file's last-modified timestamp at the time of the file read (§3.1 stage 1). This serves as the optimistic concurrency token for the UI/API write path (§3.5). It is distinct from `loadedAt`, which records the wall-clock time when the `ConfigModel` was constructed.

### 4.2 ConfigSection

A section is identified by a dotted path from the root of the configuration tree.

```java
public record ConfigSection(
    String path,                      // e.g., "persistence.retention"
    Map<String, Object> values,       // current values in this section
    Map<String, Object> defaults      // schema-defined defaults for this section
) {}
```

### 4.3 ConfigChangeSet

Produced by the diff stage of the reload pipeline (§3.3).

```java
public record ConfigChangeSet(
    Instant timestamp,
    List<ConfigChange> changes
) {
    public List<ConfigChange> hot()               { /* filter x-reload == hot */ }
    public List<ConfigChange> integrationRestart() { /* filter x-reload == integration-restart */ }
    public List<ConfigChange> processRestart()     { /* filter x-reload == process-restart */ }
}

public record ConfigChange(
    String sectionPath,               // e.g., "persistence.retention"
    String key,                       // e.g., "normal_days"
    Object oldValue,
    Object newValue,
    ReloadClassification reload       // from x-reload annotation
) {}

public enum ReloadClassification {
    HOT,
    INTEGRATION_RESTART,
    PROCESS_RESTART
}
```

### 4.4 config_changed Event Payload

The `config_changed` event is defined in **Event Model & Event Bus** §4.3 as a system lifecycle event with subject type System, producer Core Runtime, and NORMAL priority. The Configuration System produces one event per changed section during a reload. All `config_changed` events use the well-known system subject reference — the same singleton system ULID used by `system_started` and `system_stopped` events (see **Event Model & Event Bus** §4.2).

```json
{
  "event_type": "config_changed",
  "subject_ref": "<well-known-system-subject-ulid>",
  "subject_type": "system",
  "priority": "NORMAL",
  "origin": "SYSTEM",
  "payload": {
    "section_path": "persistence.retention",
    "reload_classification": "hot",
    "changed_keys": ["normal_days", "diagnostic_days"],
    "trigger": "api"
  }
}
```

The `trigger` field records how the reload was initiated: `api`, `cli`, `signal`, or `startup` (initial load). The `reload_classification` field carries the most restrictive classification among the changed keys in the section (if one key is `hot` and another is `process-restart`, the section-level classification is `process-restart`).

### 4.5 config_error Event Payload

The `config_error` event is a System lifecycle event with DIAGNOSTIC priority, SYSTEM origin, and the well-known system subject reference. The Configuration System produces one event per ERROR-severity validation issue at startup. This event type is distinct from `config_changed` to avoid overloading the semantics of normal configuration changes with error reporting.

```json
{
  "event_type": "config_error",
  "subject_ref": "<well-known-system-subject-ulid>",
  "subject_type": "system",
  "priority": "DIAGNOSTIC",
  "origin": "SYSTEM",
  "payload": {
    "path": "/persistence/retention/normal_days",
    "severity": "ERROR",
    "message": "Value -5 is less than minimum 1",
    "applied_default": 90,
    "trigger": "startup"
  }
}
```

The `config_error` type is registered in the **Event Model & Event Bus** §4.3 taxonomy via Round 5 upstream amendment A-01-R5-1.

### 4.6 ConfigIssue

A single validation finding.

```java
public record ConfigIssue(
    Severity severity,                // FATAL, ERROR, WARNING
    String path,                      // JSON Schema path, e.g., "/persistence/retention/normal_days"
    String message,                   // human-readable explanation
    @Nullable Object invalidValue,    // the value that failed validation (null for missing-key issues)
    @Nullable Object appliedDefault,  // the default that was applied (null for FATAL/WARNING)
    @Nullable Integer yamlLine        // line number in the YAML file, if determinable
) {}

public enum Severity { FATAL, ERROR, WARNING }
```

### 4.7 ConfigMutation

A single key-level mutation for the UI/API write path (§3.5). Used by `ConfigurationService.write()` (§8.3).

```java
public record ConfigMutation(
    String sectionPath,               // e.g., "persistence.retention"
    String key,                       // e.g., "normal_days"
    Object newValue                   // the new value; null to remove the key (revert to default)
) {}
```

### 4.8 SecretEntry

Internal representation within the decrypted secrets store.

```java
public record SecretEntry(
    String key,
    String value,
    Instant createdAt,
    Instant updatedAt
) {}
```

The serialized form is a JSON object `{ "entries": [...], "version": 1 }`, encrypted as a single AES-256-GCM ciphertext in `secrets.enc`. The `version` field supports future format evolution of the secrets store itself.

---

## 5. Contracts and Invariants

**C1: The configuration file is the sole source of truth.** The active `ConfigModel` is always a direct derivation of the YAML file on disk, with defaults applied from the schema and secrets resolved from the encrypted store. No runtime state modifies configuration outside of the write path defined in §3.5. If the process crashes and restarts, the configuration is identical because it is re-derived from the same file (INV-CE-01).

**C2: The system starts with an empty or absent configuration file.** Every configuration key has a schema-defined default. An empty file produces a `ConfigModel` populated entirely from defaults. No user action is required before first startup (INV-CE-02).

**C3: Secrets are encrypted at rest and redacted in logs.** The secrets store uses AES-256-GCM encryption with a machine-local key. Resolved secret values exist in memory only within the `ConfigModel` fields that reference them. Structured log output (LTD-15) redacts any field whose schema path is annotated `x-sensitive: true` (INV-SE-03).

**C4: Schema validates before any configuration takes effect.** No subsystem reads a `ConfigModel` that has not passed full JSON Schema validation. The loading pipeline (§3.1) enforces this at startup. The reload pipeline (§3.3) enforces it before swapping the active model. There is no path to an unvalidated runtime configuration.

**C5: Reload never applies a partially valid configuration.** If the candidate configuration contains any FATAL or ERROR issues during reload, the entire reload is rejected. The active model remains unchanged. This is the atomicity guarantee for reload. At startup, ERROR issues are handled by reverting individual keys to defaults, because there is no prior good state to preserve.

**C6: `config_changed` events are persisted before subscribers are notified.** Config change events are produced via `EventPublisher.publishRoot()`, which guarantees WAL commit before the method returns (INV-ES-04). Subscribers process these events through the normal event bus delivery path, ensuring that config changes are durable facts in the event log before any subsystem reacts to them.

**C7: The composed schema is always consistent with the active configuration.** The schema written to disk at startup includes all registered core and integration schemas. The `validate-config` CLI uses the same composed schema. If a schema and a configuration disagree, the schema is authoritative and the configuration value is rejected.

**Invariant alignment:**

| Contract | Invariants Served |
|---|---|
| C1 | INV-CE-01 (canonical representation), INV-TO-03 (no hidden state) |
| C2 | INV-CE-02 (zero-configuration first run) |
| C3 | INV-SE-03 (secrets encrypted at rest), INV-PD-03 (encrypted storage) |
| C4 | INV-CE-03 (schema documented and versioned) |
| C5 | INV-RF-06 (graceful degradation — at startup; strict atomicity — on reload) |
| C6 | INV-ES-04 (write-ahead persistence) |
| C7 | INV-CE-03 (schema is the contract) |

---

## 6. Failure Modes and Recovery

### 6.1 Corrupt or Unparseable YAML

**Trigger:** The YAML file contains syntax errors that prevent parsing (unclosed quotes, invalid indentation, tab characters where spaces are expected).

**Impact:** At startup, the system refuses to start (FATAL). On reload, the reload is rejected; the active configuration remains unchanged.

**Recovery:** The `validate-config` CLI reports the parse error with the line number and character position from SnakeYAML Engine's error marks. The user fixes the file and retries. The system produces a structured log entry with `config.parse_failed` and the error detail.

### 6.2 Missing Secrets File

**Trigger:** The configuration references `!secret` tags, but `/etc/homesynapse/secrets.enc` does not exist.

**Impact:** FATAL validation issue. Every `!secret` reference is unresolvable.

**Recovery:** The `validate-config` CLI reports the missing secrets file and lists the unresolved keys. The user creates secrets via `homesynapse secrets set <key> <value>`, which generates both the key file and the encrypted store. The system logs `config.secrets_file_missing`.

### 6.3 Missing Secret Key File

**Trigger:** `secrets.enc` exists but `.secret-key` does not, or `.secret-key` is unreadable (wrong permissions, corrupted).

**Impact:** FATAL. The secrets store cannot be decrypted.

**Recovery:** The system logs `config.secret_key_missing` or `config.secret_key_unreadable` with the file path and permission details (INV-HO-04). If the key is lost, the secrets store is irrecoverable; the user must recreate secrets via the CLI, which generates a new key and a new store. The old `secrets.enc` is renamed to `secrets.enc.orphaned.{ISO8601}` rather than deleted.

### 6.4 Unresolvable Secret or Environment Variable

**Trigger:** A `!secret key_name` references a key not present in the decrypted store, or a `!env VAR_NAME` references an unset environment variable with no default.

**Impact:** FATAL validation issue for the specific reference. At startup, prevents start. On reload, rejects the reload.

**Recovery:** The validation report identifies the exact YAML location and the missing key or variable name. The user adds the missing secret or sets the environment variable.

### 6.5 Schema Validation Failure at Startup

**Trigger:** One or more configuration values fail JSON Schema validation after default merge.

**Impact:** FATAL issues prevent startup. ERROR issues cause the affected keys to revert to schema defaults; the system starts with those defaults applied. WARNING issues are logged.

**Recovery:** Each `ConfigIssue` carries the JSON Schema path, the invalid value, the human-readable explanation, and (for ERROR) the default that was applied. A `config_error` diagnostic event is produced for each ERROR-severity issue. The dashboard shows persistent notifications.

### 6.6 Schema Validation Failure on Reload

**Trigger:** A user modifies the config file and triggers a reload, but the new file contains validation issues.

**Impact:** The entire reload is rejected. The active configuration remains unchanged. No partial application.

**Recovery:** The reload response (API, CLI, or log) lists all issues. The user corrects the file and retries.

### 6.7 Concurrent File Modification Detected

**Trigger:** A UI/API write is attempted, but the file's last-modified timestamp does not match the `fileModifiedAt` concurrency token recorded at read time. This means an external editor modified the file between the UI read and the UI write.

**Impact:** The write is rejected with a `ConcurrentModificationException`. No data is lost.

**Recovery:** The caller must reload the current configuration (re-reading the externally modified file), then re-apply the intended changes. The UI surfaces this as "Configuration was modified externally. Please reload before making changes."

### 6.8 Disk Full During Atomic Write

**Trigger:** Writing `config.yaml.tmp` fails due to insufficient disk space, or `fsync()` fails.

**Impact:** The temporary file is incomplete. The rename step is not reached. The original `config.yaml` is untouched.

**Recovery:** The write path catches the `IOException`, deletes the incomplete temp file, releases the write lock, and returns a failure response identifying the disk space condition. The system logs `config.write_failed` with the `IOException` detail. The active configuration is unchanged.

### 6.9 Secrets Store Corruption

**Trigger:** `secrets.enc` is modified outside the CLI (manual edit, partial write, file system corruption), and AES-256-GCM authentication fails during decryption.

**Impact:** FATAL. All `!secret` references are unresolvable because the store cannot be decrypted.

**Recovery:** The system logs `config.secrets_store_corrupt` with the authentication failure detail. The user can restore from the per-operation backups using `homesynapse secrets restore` (§3.4, AMD-16). The CLI lists available backups via `homesynapse secrets list-backups`. If no backups are available (e.g., corruption occurred before any set/remove operation created backups), the user must recreate the secrets store via `homesynapse secrets set`.

---

## 7. Interaction with Other Subsystems

| Subsystem | Direction | Mechanism | Data | Constraints |
|---|---|---|---|---|
| Event Model & Event Bus | Produces events via | `EventPublisher.publishRoot()` | `config_changed` events (NORMAL priority, SYSTEM origin, well-known system subject) per changed section after reload; `config_error` events (DIAGNOSTIC priority, SYSTEM origin, well-known system subject) per ERROR-severity validation issue at startup | Events are persisted before subscribers are notified (C6, INV-ES-04). One `config_changed` per changed section, not per changed key. `config_error` events produced only at startup when ERROR issues cause default reversion. |
| Event Model & Event Bus (Doc 01 §9) | Manages schema for | Schema composition (§3.2) | `event_bus:` section schema | Core schema, static, bundled in distribution. |
| Device Model (Doc 02 §9) | Manages schema for | Schema composition (§3.2) | `device_model:` section schema | Core schema, static, bundled in distribution. |
| State Store (Doc 03 §9) | Manages schema for | Schema composition (§3.2) | `state_store:` section schema | Core schema, static, bundled in distribution. |
| Persistence Layer (Doc 04 §9) | Manages schema for | Schema composition (§3.2) | `persistence:` section schema | Core schema, static, bundled in distribution. |
| Integration Runtime (Doc 05 §9) | Manages schema for | Schema composition (§3.2) | `integration_runtime:` section schema | Core schema, static, bundled in distribution. |
| Integration Runtime (Doc 05 §3.8) | Implements interface | `ConfigurationAccess` | Integration-scoped configuration subtree under `integrations.{type}:` | Read-only. Returns validated subtree only for the requesting integration's type. Cannot access global or other-integration configuration. |
| Integration Runtime | Receives schemas from | `SchemaRegistry.registerIntegrationSchema()` at adapter registration | Per-integration JSON Schema fragments declared in `IntegrationDescriptor` | Registration occurs during startup, before config validation. |
| Automation Engine (Doc 07) | Manages file path for | Well-known file path registration | `automations.yaml` as a secondary config file path (when Doc 07 registers it) | Doc 07 defines automation semantics; this subsystem manages the file loading and schema validation. |
| REST API (Doc 09) | Called by | `ConfigurationService` interface (§8.1) | Config read, section query, reload trigger, validation results | Doc 09 exposes these operations over HTTP. Authentication and authorization are Doc 09's concern. |
| Startup, Lifecycle & Shutdown (Doc 12) | Called by | `ConfigurationService.load()` during startup | Full configuration model | Configuration loading is the first subsystem initialization step. All other subsystems receive their configuration from the loaded model. Doc 12 determines the exact sequencing. |
| Observability & Debugging (Doc 11) | Exposes | JFR events, structured logs, health indicator | Config load duration, validation issue counts, reload success/failure, active schema version | All metrics exposed via JFR (LTD-15). Health state accessible via REST API. |

---

## 8. Key Interfaces

### 8.1 Interfaces

| Interface | Responsibility | Primary Consumers |
|---|---|---|
| `ConfigurationService` | Load, reload, query, and write configuration. Central coordination point. | Startup sequence (Doc 12), REST API (Doc 09), CLI commands |
| `ConfigurationAccess` | Read-only, integration-scoped access to validated configuration subtree. Contract defined in **Integration Runtime** §3.8; implemented here. | Integration adapters via `IntegrationContext` |
| `SecretStore` | Resolve, set, remove, and list secrets in the encrypted store. | Configuration loading pipeline (§3.1), CLI `homesynapse secrets` subcommand |
| `ConfigValidator` | Validate a parsed configuration map against the composed JSON Schema. | Loading pipeline (§3.1), reload pipeline (§3.3), `validate-config` CLI |
| `ConfigMigrator` | Preview, apply, and rollback major-version configuration migrations. | CLI `homesynapse migrate-config` command |
| `SchemaRegistry` | Register integration schemas, compose the unified schema, write composed schema to disk. | Integration registration during startup, `validate-config` CLI |

### 8.2 Key Types

| Type | Kind | Responsibility |
|---|---|---|
| `ConfigModel` | Record | Immutable, typed, validated in-memory configuration. The runtime representation. Includes `fileModifiedAt` concurrency token. |
| `ConfigSection` | Record | A subtree of the configuration identified by dotted path. |
| `ConfigChangeSet` | Record | The diff between two ConfigModels, with per-key reload classification. |
| `ConfigChange` | Record | A single key change with old/new values and reload classification. |
| `ConfigMutation` | Record | A single key-level mutation for the write path: sectionPath, key, newValue. |
| `ReloadClassification` | Enum | `HOT`, `INTEGRATION_RESTART`, `PROCESS_RESTART`. |
| `ConfigIssue` | Record | A validation finding with severity, path, message, and applied default. |
| `Severity` | Enum | `FATAL`, `ERROR`, `WARNING`. |
| `SecretEntry` | Record | A key-value pair in the encrypted secrets store with creation/update timestamps. |

### 8.3 ConfigurationService Method Summary

`load()` — Execute the full loading pipeline (§3.1). Called once during startup by the lifecycle manager (Doc 12). Returns the initial `ConfigModel` or throws `ConfigurationLoadException` on FATAL issues.

`reload()` — Execute the reload pipeline (§3.3). Returns a `ReloadResult` containing the new `ConfigModel`, the `ConfigChangeSet`, and any `ConfigIssue` records. Throws `ConfigurationReloadException` if the candidate configuration is invalid.

`getCurrentModel()` — Return the active `ConfigModel`. Non-blocking. The returned reference is immutable.

`getSection(String path)` — Return a `ConfigSection` for the given dotted path (e.g., `"persistence.retention"`). Returns `Optional.empty()` if the path does not exist.

`write(List<ConfigMutation> mutations, Instant fileModifiedAt)` — Apply mutations through the write path (§3.5). The `fileModifiedAt` parameter is the `fileModifiedAt` timestamp from the `ConfigModel` the caller read — the file's last-modified time at the point the model was loaded. This serves as the optimistic concurrency token. Throws `ConcurrentModificationException` if the file was modified externally since the model was loaded. Throws `ConfigurationValidationException` if the mutated configuration fails validation.

### 8.4 ConfigurationAccess Method Summary

This interface is defined by **Integration Runtime** §3.8. The Configuration System provides the implementation.

`getConfig()` — Return the validated configuration subtree for this integration type as an immutable `Map<String, Object>`. The returned map contains only the keys under `integrations.{type}:` in the YAML configuration. All `!secret` and `!env` values are resolved. The map is typed according to the integration's registered JSON Schema.

`getString(String key)` — Convenience accessor returning `Optional<String>`.

`getInt(String key)` — Convenience accessor returning `Optional<Integer>`.

`getBoolean(String key)` — Convenience accessor returning `Optional<Boolean>`.

The implementation is constructed by the Configuration System at integration registration time, scoped to the integration's type. The Integration Runtime injects it into the `IntegrationContext`. The adapter cannot obtain a differently-scoped `ConfigurationAccess` instance.

### 8.5 SecretStore Method Summary

`resolve(String key)` — Return the decrypted value for the given key, or throw `SecretNotFoundException`. Used internally during tag resolution (§3.1, stage 3).

`set(String key, String value)` — Store or update a secret. Creates the key file and secrets store on first use.

`remove(String key)` — Remove a secret by key. Throws `SecretNotFoundException` if the key does not exist.

`list()` — Return the set of key names in the store. Never returns values.

### 8.6 SchemaRegistry Method Summary

`registerCoreSchema(String sectionName, JsonSchema schema)` — Register a static core subsystem schema. Called during startup for each of Docs 01–05 §9 sections and the `config_system:` section defined in this document's §9.

`registerIntegrationSchema(String integrationType, JsonSchema schema)` — Register an integration's schema fragment. Called during integration registration.

`getComposedSchema()` — Return the fully composed JSON Schema covering all registered core and integration schemas.

`writeComposedSchema(Path outputPath)` — Serialize the composed schema to the given path. Called during startup to produce the file for VS Code.

---

## 9. Configuration

The Configuration System is itself configurable. All settings below govern the behavior of the config loader, secrets store, reload mechanism, and validation tooling. They live under the `config_system:` top-level key in `config.yaml`. Every key has a sensible default (INV-CE-02). This section does not repeat the subsystem schemas defined in Docs 01–05 §9; those schemas are managed by this subsystem but defined in their respective documents.

```yaml
config_system:
  # File paths
  config_path: "/etc/homesynapse/config.yaml"    # Primary config file path
  secrets_path: "/etc/homesynapse/secrets.enc"    # Encrypted secrets store
  secret_key_path: "/etc/homesynapse/.secret-key" # AES-256-GCM key file
  schema_output_path: "/etc/homesynapse/schema/config.schema.json"
                                                  # Where the composed schema is written

  # Secrets store backup (AMD-16)
  secrets_backup:
    max_backups: 5                                # Maximum number of per-operation backups retained.
                                                  # Oldest backup is deleted when this limit is exceeded.
                                                  # Range: 1-20.

  # Reload behavior
  reload_signal: "SIGHUP"                         # POSIX signal that triggers reload
  reload_timeout_seconds: 10                      # Max time for reload pipeline before abort

  # Write path
  comment_backup_enabled: true                    # Create timestamped backup before first
                                                  # UI/API write (preserves comments)
  max_comment_backups: 5                          # Retain at most N comment-preserving backups;
                                                  # oldest deleted when exceeded

  # Validation CLI
  cli_strict_warnings: false                      # If true, validate-config exits 1 on warnings
                                                  # (useful for CI pipelines)

  # Schema versioning
  schema_version: 1                               # Current config schema version; gates
                                                  # migration applicability (INV-CE-03)

  # Migration framework (AMD-13)
  migration:
    auto_migrate: true                            # Automatically apply migrations on startup
                                                  # when schema_version < runtime version.
                                                  # If false, startup fails with a message
                                                  # directing the user to run migrate-config CLI.
    backup_retention: unlimited                   # How long to keep pre-migration backups.
                                                  # "unlimited" = never auto-delete.
                                                  # Duration string (e.g., "90d") = delete after N days.
```

**Key rationale:**

`config_path` exists for non-standard deployments (containerized environments that mount configuration at a different path). The default satisfies LTD-09.

`comment_backup_enabled` defaults to `true` because comment loss on UI/API writes (§3.5) is a known limitation. The backup provides a recovery path. `max_comment_backups` bounds disk usage from accumulating backups.

`cli_strict_warnings` defaults to `false` for interactive use (warnings are informational) but can be set to `true` in CI/CD pipelines to enforce clean configuration.

`reload_timeout_seconds` bounds the reload pipeline. If YAML parsing, secret resolution, validation, and diff exceed this duration, the reload is aborted and the active model is unchanged. Ten seconds is generous for a file that should parse in under 100ms; the timeout guards against pathological schema composition or a blocked secret store read.

---

## 10. Performance Targets

All targets are specified for the primary deployment target: Raspberry Pi 5, 4 GB RAM, NVMe SSD storage, running the JVM configuration in LTD-01.

| Metric | Target (Raspberry Pi 5, 4 GB RAM) | Rationale | Test Method |
|---|---|---|---|
| Config load + validate latency at startup (including schema composition) | < 200 ms (p99) | Configuration loading is on the critical startup path. Doc 12 (Startup, Lifecycle & Shutdown) budgets total startup time; config loading must not consume a significant fraction. 200 ms allows parsing, secret decryption, default merge, schema composition with 7 schemas, and validation. | Benchmark: load a representative config file (6 core sections + 2 integration sections, ~150 keys) 100 times, measure p99. |
| Reload latency (re-parse + validate + diff + event production) | < 150 ms (p99) | Reload skips schema composition (schema is cached). The user waiting for a reload response expects near-instant feedback. | Benchmark: reload with 10 changed keys across 3 sections, measure p99 over 100 iterations. |
| Schema composition duration | < 100 ms | Composing 6 core schemas + 2 integration schemas into a single JSON Schema. Dominated by JSON Schema `$ref` resolution and merging. Runs once at startup. | Benchmark: compose 8 schemas of representative size (50–100 properties each), measure wall-clock time. |
| Secret store decrypt latency | < 10 ms | AES-256-GCM decryption of a secrets file with 20 entries (~2 KB ciphertext). The Java `javax.crypto` implementation on ARMv8 uses hardware AES instructions on Pi 5. | Benchmark: decrypt a 20-entry secrets store 1,000 times, measure p99. |
| `validate-config` CLI execution time (cold JVM start to exit) | < 3 seconds | The CLI must start, load config, compose schemas, validate, and report. Dominated by JVM startup and class loading via jlink runtime (LTD-13). The actual validation is a fraction of the total. Users run this interactively; more than 3 seconds feels sluggish. | End-to-end: time `homesynapse validate-config` from shell invocation to exit on a representative config. |
| ConfigModel memory footprint (6 core schemas + 2 integration schemas, ~150 keys) | < 500 KB | The ConfigModel is a tree of Java records. At 150 keys with string/integer/boolean values, the object graph is small. The raw map is retained for ConfigurationAccess; this roughly doubles the typed-record cost. | JFR allocation profiling: measure retained heap of ConfigModel after a representative load. |
| Composed schema file size | < 200 KB | The composed schema for 6 core + 2 integration schemas with descriptions, defaults, and x-reload annotations. Must be small enough for the Red Hat YAML extension to load without perceptible delay. | Measurement: serialize the composed schema, check file size. |

---

## 11. Observability

### 11.1 Metrics

All metrics are exposed via JFR custom events (LTD-15). No external metrics library is required.

| Metric | Type | Labels | Description |
|---|---|---|---|
| `config.load_duration_ms` | Gauge | — | Wall-clock time of the most recent full config load (startup). |
| `config.reload_count` | Counter | `result` (success, rejected) | Cumulative count of reload attempts, partitioned by outcome. |
| `config.validation_issues` | Gauge | `severity` (fatal, error, warning) | Count of validation issues from the most recent load or reload attempt. |
| `config.active_schema_version` | Gauge | — | The `schema_version` value from the active ConfigModel. |
| `config.secret_count` | Gauge | — | Number of keys in the secrets store. Updated after secret operations. |
| `config.composed_schema_size_bytes` | Gauge | — | Size of the composed schema file written to disk. |
| `config.write_count` | Counter | `result` (success, rejected, concurrency_conflict) | Cumulative count of UI/API write attempts, partitioned by outcome. |

### 11.2 Structured Logging

All log events use JSON format with correlation IDs per LTD-15.

| Log Event | Level | Key Fields | Produced When |
|---|---|---|---|
| `config.loaded` | INFO | `schema_version`, `load_duration_ms`, `total_keys`, `issues_warning`, `issues_error` | Startup load completes successfully. |
| `config.reloaded` | INFO | `changed_sections`, `changed_key_count`, `reload_classification_summary`, `reload_duration_ms` | Reload completes successfully. |
| `config.reload_rejected` | WARN | `reason`, `issue_count`, `issues` (array of path + severity + message) | Reload rejected due to validation failure. |
| `config.parse_failed` | ERROR | `file_path`, `line`, `column`, `error_message` | YAML parsing failed. |
| `config.write_failed` | ERROR | `reason`, `file_path`, `io_error` | Atomic file write failed (disk full, permission denied). |
| `config.write_concurrency_conflict` | WARN | `expected_mtime`, `actual_mtime`, `file_path` | UI/API write rejected due to external modification. |
| `config.secrets_store_corrupt` | ERROR | `file_path`, `error_detail` | AES-GCM authentication failed during secrets decryption. |
| `config.secret_key_missing` | ERROR | `expected_path`, `permissions` | Secret key file absent or unreadable. |
| `config.validation_issue` | WARN/ERROR | `severity`, `path`, `message`, `invalid_value` (redacted if `x-sensitive`), `applied_default` | One log entry per validation issue. Level matches severity. |
| `config.comment_backup_created` | INFO | `backup_path`, `original_path` | Comment-preserving backup created before UI/API write. |

### 11.3 Health Indicator

The Configuration System reports a health status consumed by the Observability subsystem (Doc 11) and the REST API health endpoint (Doc 09).

| State | Condition |
|---|---|
| HEALTHY | Configuration loaded successfully with no ERROR-severity issues. All secrets resolved. |
| DEGRADED | Configuration loaded, but one or more keys reverted to schema defaults due to ERROR-severity validation issues. The system is functional but not operating with the user's intended configuration. |
| UNHEALTHY | Configuration load failed entirely (FATAL issue). This state is reachable only if a future startup mode allows forced operation past FATAL errors, or if the secrets store becomes corrupt after initial load. For MVP, a FATAL load failure prevents startup, so this state is theoretical at startup. It becomes reachable if a post-startup secrets store corruption is detected during a reload attempt. |

This subsystem implements the `HealthContributor` interface (Doc 11 §8.1, §8.2) to report health state transitions to the HealthAggregator. The Configuration System is classified as CORE_SERVICES tier (Doc 11 §7.1) with a 10-second startup grace period. Health state changes are reported via `HealthContributor.reportHealth(status, reason)` when the conditions in the table above transition, including transitions caused by configuration reload (§3.3) or secrets store corruption detection.

---

## 12. Security Considerations

This section is included because the Configuration System handles secrets, manages encryption keys, and controls access to sensitive credential values.

### 12.1 Secret Store Encryption Model

The secrets store uses AES-256-GCM authenticated encryption. The 256-bit encryption key is generated via `java.security.SecureRandom` on first use of the `homesynapse secrets set` command. The key is stored at the path specified by `config_system.secret_key_path` (default `/etc/homesynapse/.secret-key`).

AES-256-GCM provides both confidentiality and integrity. A tampered `secrets.enc` file fails GCM authentication, producing a clear error (§6.9) rather than silent data corruption. Each encryption operation uses a fresh 96-bit nonce generated via `SecureRandom`, prepended to the ciphertext.

**Key rotation** is a post-MVP concern. The MVP encryption model uses a single static key for the lifetime of the installation. A future key rotation mechanism would decrypt the store with the old key, re-encrypt with a new key, and atomically replace both files. The `SecretEntry.version` field in the store format (§4.8) accommodates this by allowing the store format to evolve without breaking existing installations.

### 12.2 File Permissions

| File | Owner | Permissions | Rationale |
|---|---|---|---|
| `config.yaml` | `homesynapse` service user | `0644` | Readable by the service and by administrators. Writable by the service (for UI/API write path) and by root. |
| `.secret-key` | `homesynapse` service user | `0400` | Owner-read only. No other user or process should read the encryption key. |
| `secrets.enc` | `homesynapse` service user | `0600` | Owner-read-write. The service needs write access to update secrets; no other user should read the ciphertext. |
| `schema/config.schema.json` | `homesynapse` service user | `0644` | Readable by VS Code and other tooling. Writable by the service at startup. |
| `config.yaml.bak.*` | `homesynapse` service user | `0644` | Comment-preserving backups. Same permissions as the config file. |

### 12.3 Log Redaction

Configuration values for keys annotated with `x-sensitive: true` in the JSON Schema are redacted in all structured log output. Redaction replaces the value with `"[REDACTED]"` in log entries. This applies to `config.validation_issue` log events (where `invalid_value` might contain a partial secret), `config.reloaded` summaries, and any diagnostic output that includes configuration values.

Integration schemas should annotate credential fields (`api_key`, `password`, `token`, `network_key`) with `x-sensitive: true`. The Configuration System enforces redaction; integration developers declare which fields are sensitive.

### 12.4 Event Payload Safety

`config_changed` event payloads (§4.4) carry `section_path`, `reload_classification`, `changed_keys` (key names only), and `trigger`. They never carry configuration values — old or new. Similarly, `config_error` event payloads (§4.5) carry the JSON Schema path, severity, message, and applied default, but never the invalid value if the path is annotated `x-sensitive`. This ensures that sensitive configuration data does not enter the event log, where it would be retained per the event retention policy and visible to any event log consumer.

### 12.5 Composed Schema Safety

The composed schema file written to disk (`config.schema.json`) contains property definitions, types, defaults, and descriptions. It never contains resolved secret values. Default values for `x-sensitive` fields are not included in the schema; the `default` keyword is omitted for sensitive properties. This prevents accidental credential exposure through the schema file, which is readable by tooling and potentially shared.

### 12.6 Authentication on Write Path

The UI/API write path (§3.5) modifies the canonical configuration file. Authentication and authorization for write operations are the responsibility of the **REST API** (Doc 09), which gates access to `ConfigurationService.write()` and `ConfigurationService.reload()`. The Configuration System itself does not enforce authentication; it trusts that its callers are authorized. This follows the same pattern as other core interfaces (EventPublisher, StateQueryService) where the API layer owns the trust boundary.

---

## 13. Testing Strategy

### 13.1 Unit Tests

**YAML tag constructor: `!secret`.** Register a mock secret store with known keys. Parse YAML containing `!secret known_key`. Verify the resolved value matches. Parse YAML containing `!secret unknown_key`. Verify a FATAL `ConfigIssue` is produced.

**YAML tag constructor: `!env`.** Set an environment variable, parse YAML containing `!env VAR_NAME`. Verify resolution. Parse with an unset variable and no default. Verify FATAL. Parse `!env VAR_NAME:fallback` with an unset variable. Verify the fallback value is used.

**Schema composition with mock integration schemas.** Register 6 core schemas and 2 integration schemas with overlapping definition names. Verify the composed schema is valid JSON Schema, contains all sections (including `config_system:`), resolves `$ref` correctly, and `additionalProperties: false` is set on known sections.

**Default merge completeness.** Define a schema with 20 properties, all with defaults. Parse an empty YAML map. Verify every property is present in the merged output with its schema-defined default value. Verify that user-provided values override defaults and are not clobbered.

**Validation error classification.** Construct a map with: one FATAL-level issue (invalid YAML type at root), one ERROR-level issue (negative integer for a positive-only field), one WARNING-level issue (deprecated key). Validate against a test schema. Verify each issue is classified correctly. Verify the ERROR key reverts to its default. Verify the WARNING key retains its value.

**Reload diff correctness.** Construct two ConfigModels differing in 3 keys across 2 sections. Compute the diff. Verify the `ConfigChangeSet` contains exactly 3 `ConfigChange` records, each with correct old/new values, correct section paths, and `x-reload` classifications matching the schema.

**Optimistic concurrency rejection.** Set the recorded `fileModifiedAt` timestamp to T1. Modify the file externally (updating its timestamp to T2). Attempt a write with `fileModifiedAt` T1. Verify `ConcurrentModificationException` is thrown. Verify the file content is unchanged.

**Atomic write behavior.** Write a valid config through the write path. Verify `config.yaml.tmp` does not exist after completion (renamed to `config.yaml`). Simulate a write failure (mock `fsync()` throwing `IOException`). Verify the temp file is deleted and the original file is unchanged.

**ConfigMutation application.** Construct a `ConfigMutation` with sectionPath, key, and newValue. Apply it to a copy of the in-memory map. Verify the specified key is updated. Construct a `ConfigMutation` with null newValue. Apply it. Verify the key is removed (reverts to schema default on next merge).

### 13.2 Integration Tests

**Full load pipeline.** Write a config file with 6 core sections, 2 integration sections, 3 `!secret` references, and 1 `!env` reference. Provision the secrets store and environment variable. Load via `ConfigurationService.load()`. Verify the resulting `ConfigModel` has correct typed values for all sections (including `configSystem`), resolved secrets, and resolved environment variable.

**Reload with `config_changed` event verification.** Load a config. Modify 2 keys in the `persistence.retention` section on disk. Trigger reload. Verify a `config_changed` event was produced via EventPublisher with `section_path: "persistence.retention"`, `changed_keys` listing the 2 keys, correct `reload_classification`, and the well-known system subject reference.

**Startup with ERROR-severity issues produces `config_error` events.** Write a config file with one ERROR-severity issue (e.g., negative integer for a positive-only field). Load via `ConfigurationService.load()`. Verify the system starts with the key reverted to its default. Verify a `config_error` event was produced via EventPublisher with the correct path, severity, message, and applied default in the payload.

**Secrets CLI round-trip.** Run `homesynapse secrets set test_key test_value`. Run `homesynapse secrets list`. Verify `test_key` appears. Run `homesynapse secrets get test_key`. Verify output is `test_value`. Run `homesynapse secrets remove test_key`. Run `homesynapse secrets list`. Verify `test_key` is absent.

**`validate-config` CLI exit codes.** Write a valid config: verify exit code 0. Write a config with a WARNING (deprecated key): verify exit code 0 (default) and exit code 1 (with `cli_strict_warnings: true`). Write a config with an ERROR (invalid value): verify exit code 1. Write a config with corrupt YAML: verify exit code 2.

**Concurrent file modification detection.** Load config via API. Modify the file externally via direct write. Attempt a UI/API write. Verify the write is rejected with concurrency conflict. Reload. Retry the write. Verify success.

### 13.3 Performance Tests

**Startup load latency.** Construct a config with 6 core sections, 2 integration sections (~150 keys), 5 secrets. Measure p99 load time over 100 iterations on Pi 5. Target: < 200 ms.

**Reload latency under load.** While the event bus is processing 100 events/second (simulated), trigger a reload with 10 changed keys. Measure p99 reload duration. Target: < 150 ms. Verify event production does not stall during reload.

**Schema composition with 20 integration schemas.** Register 6 core schemas and 20 integration schemas (simulating a mature installation). Measure composition time. This validates that the design scales beyond MVP without architectural change. Target: < 500 ms (relaxed from the MVP target of < 100 ms for 8 schemas).

### 13.4 Failure Tests

**Corrupt YAML.** Write a file with unclosed quotes. Attempt load. Verify FATAL issue with line number. Verify the system does not start (exit code 2 from CLI).

**Missing secrets file.** Reference `!secret key` in config but do not create `secrets.enc`. Attempt load. Verify FATAL issue identifying the missing file.

**Missing secret key file.** Create `secrets.enc` but delete `.secret-key`. Attempt load. Verify FATAL issue with `config.secret_key_missing` log entry.

**Validation failure on reload.** Load a valid config. Modify the file to introduce an ERROR-severity issue. Trigger reload. Verify the reload is rejected. Verify the active `ConfigModel` is unchanged (compare object reference). Verify no `config_changed` event was produced for the rejected reload.

**Disk full during write.** Mount a tmpfs with 1 KB capacity. Attempt a UI/API write. Verify `IOException` is caught, temp file is cleaned up, and the original config is untouched.

**Secrets store corruption (GCM auth failure).** Modify a byte in `secrets.enc` after valid creation. Attempt load with `!secret` reference. Verify FATAL issue with `config.secrets_store_corrupt` log entry. Verify AES-GCM authentication failure is reported, not a generic decryption error.

---

## 14. Future Considerations

**Comment-preserving YAML round-tripping.** The current design accepts comment loss on UI/API writes (§3.5). A future improvement could use line-level patching (modifying only the YAML lines that changed, preserving surrounding comments) or adopt a comment-aware YAML parser if one matures in the Java ecosystem. The write path's atomic flush mechanism (write-to-temp-then-rename) is compatible with either approach. The comment backup mechanism provides a recovery path until this is resolved.

**Filesystem watching for automatic reload.** MVP requires explicit reload triggers (API, CLI, SIGHUP). A future version could use `java.nio.file.WatchService` to detect file changes and trigger reload automatically. The reload pipeline (§3.3) is designed to be trigger-agnostic; adding a filesystem trigger requires no changes to the reload logic itself. The primary concern is inotify reliability on network-mounted volumes and within Docker containers, where OpenHAB's experience shows this to be a recurring source of issues.

**`conf.d/` directory splitting.** If config files routinely exceed 500 lines at Tier 2 scale (100+ devices, 10+ integrations), a `conf.d/` directory model can be added. The loading pipeline (§3.1) would scan the directory, parse each file, and merge the results in lexicographic order before validation. The single-file model remains the zero-config default. The schema composition and validation pipeline require no changes; only the file-read stage expands.

**Secret key rotation.** The MVP uses a single static encryption key. A rotation mechanism would generate a new key, re-encrypt the secrets store, and atomically swap both files. The store format's `version` field (§4.8) supports this evolution.

**OS keyring integration.** On systems with a D-Bus-accessible keyring (GNOME Keyring, KDE Wallet), the encryption key could be stored in the keyring rather than a file. This eliminates the `.secret-key` file and its permission-based security model in favor of session-level access control. The `SecretStore` interface (§8.5) is designed so the key retrieval mechanism can be swapped without affecting consumers.

**Remote configuration sync.** For multi-instance deployments, configuration changes on one instance could be propagated to others. The event-sourced architecture supports this naturally: `config_changed` events, combined with the YAML file as the canonical format, enable CRDT-based or leader-follower sync models (INV-LF-05). The `schema_version` field gates compatibility.

**Configuration profiles.** Development, staging, and production profiles that overlay environment-specific values onto a base configuration. The schema composition model supports this through a `profiles:` section with per-environment overrides merged at load time.

**Automation definition file management.** When Doc 07 registers `automations.yaml` as a well-known file path (§2.1, §7), the loading pipeline expands to support multiple well-known paths. Each path maps to a specific schema. The schema composition, validation, and reload mechanisms extend naturally. The design of a single `ConfigModel` with a `rawMap` field (§4.1) accommodates this: automation definitions would populate a separate key in the model, validated against the automation schema, without architectural change to the config loading pipeline.

---

## 15. Open Questions

1. **OQ-1: Exact `ConfigurationAccess` convenience method set.** The current design (§8.4) defines `getConfig()`, `getString()`, `getInt()`, and `getBoolean()` as convenience accessors. Real integration configuration needs — discovered during Doc 08 (Zigbee Adapter) implementation — may reveal the need for additional accessors: `getStringList()`, `getDuration()`, `getNestedConfig()`, or typed record mapping. The `getConfig()` method returning `Map<String, Object>` is always sufficient as a fallback, so the convenience methods are ergonomic sugar, not functional requirements.
   Status: **[NON-BLOCKING]** — the `getConfig()` method satisfies all access patterns; convenience methods can be added without breaking existing adapters.

2. **OQ-2: Whether `config_changed` event payloads should carry old/new values.** The current design (§4.4) carries only key names, not values, to avoid leaking sensitive data into the event log. An alternative would carry values with `x-sensitive` redaction applied. Values aid debugging ("why did retention change from 30 to 7?") and enable automation triggers on configuration state. The tradeoff is that redaction must be airtight — a single missed annotation exposes credentials permanently in the append-only event log (INV-ES-01).
   Status: **[NON-BLOCKING]** — key-names-only is the safe default. Adding values later is additive and backward-compatible (new payload fields with INV-ES-07 schema evolution).

3. **OQ-3: Whether the reload pipeline should accept ERRORs as non-blocking.** The current design (§3.3, §3.6) rejects the entire reload if any ERROR-severity issue exists. An alternative would apply the same startup behavior (revert to defaults) during reload. The strict approach prevents a user from accidentally degrading a running system through a typo; the permissive approach avoids the situation where fixing one key requires fixing all keys simultaneously. Startup uses the permissive model because there is no prior good state.
   Status: **[NON-BLOCKING]** — the strict-reload model is conservative and can be relaxed in a minor version without breaking compatibility (INV-CS-03). User feedback during Tier 1 operation will determine whether relaxation is needed.

---

## 16. Summary of Key Decisions

| ID | Decision | Choice | Rationale | Alternatives Considered | Section |
|---|---|---|---|---|---|
| D1 | File topology | Single primary file (`config.yaml`) with fixed well-known path set | Maximally canonical and Git-friendly. Simplest model for zero-config. Doc 07 can register `automations.yaml` without architectural change. | Multi-file with `!include` directives (HA model — rejected: five include variants, custom tag burden, unnecessary at Tier 1 scale); `conf.d/` directory scan (deferred to Tier 2 as future consideration). | §3.1 |
| D2 | Schema composition | Modular core schemas + runtime integration schema registration; composed schema written to disk | Core schemas are static and bundled; integration schemas are dynamic and contributed via `IntegrationDescriptor`. Composed schema enables VS Code auto-completion and CLI validation from the same source (P2). | Monolithic compile-time schema (rejected: integration schemas are runtime-registered); per-section validation with no unified schema (rejected: no publishable schema for tooling). | §3.2 |
| D3 | Secret management | Encrypted secrets store (AES-256-GCM) with `!secret` and `!env` YAML tags | INV-SE-03 requires encryption at rest. `!secret` is familiar to HA users. `!env` supports container deployments. Machine-local key avoids external key management dependencies. | Plaintext `secrets.yaml` (rejected: violates INV-SE-03); OS keyring integration (rejected: platform-dependent, violates INV-CE-02 zero-config); environment variables only (rejected: no persistence, poor UX for non-container deployments). | §3.4 |
| D4 | Reload classification | Schema-annotated per-key `x-reload` with three levels (hot, integration-restart, process-restart) | Classification lives in the schema, not in code (P5). The UI can show users what a change requires before they commit it. Default is `process-restart` (safe fallback). | All changes require restart (rejected: poor UX for threshold tuning); per-section classification (rejected: too coarse — some sections mix hot and restart-required keys). | §3.3 |
| D5 | Change event granularity | Per-section `config_changed` events with section path, reload classification, and changed key names | Fine enough for targeted subscriber filtering (Integration Runtime subscribes to `integration_runtime.**`), coarse enough to avoid event storms on multi-key changes. | Per-file events (rejected: single file means every change fires the same event, subscribers cannot filter); per-key events (rejected: excessive for a system that reloads infrequently). | §3.3, §4.4 |
| D6 | UI/API write path | File-authoritative with optimistic concurrency, single-writer lock, explicit reload for external edits | INV-CE-01 mandates one representation. Optimistic concurrency prevents silent data loss from concurrent edits. No filesystem watching in MVP avoids inotify reliability issues. | UI writes to separate store (HA ADR-0010 model — rejected: violates INV-CE-01); no conflict detection (Z2M model — rejected: external edits silently lost). | §3.5 |
| D7 | Validation error model | Three-severity fail-complete (FATAL/ERROR/WARNING) with permissive startup and strict reload | A retention threshold typo should not prevent lights from working (startup leniency). A reload should not degrade a running system (reload strictness). Fail-complete collects all issues in one pass. | Fail-fast (rejected: hides cascading issues, poor UX); fail-complete refuse-to-start on any error (Z2M model — rejected: one typo kills the entire system). | §3.6 |
| D8 | Configuration migration | Schema evolution within major versions; CLI `migrate-config` at major boundaries | INV-CS-03 guarantees backward compatibility within major versions, eliminating within-major migration need. INV-CE-06 requires idempotent, reversible, preview-able tooling at major boundaries. | Automatic migration on startup (Z2M model — rejected: silent mutation surprises users, no dry-run); manual migration only (rejected: friction on every major upgrade). | §3.1 (schema_version), §8.1 (ConfigMigrator) |
| D9 | Comment loss acceptance | Accept comment stripping on UI/API writes; mitigate with automatic backup | SnakeYAML Engine does not support comment-preserving round-tripping. Accepting this tradeoff with a backup mitigation avoids complex line-level patching for MVP. | Comment-preserving library (none mature in Java ecosystem); line-level diff-and-patch (rejected for MVP: complex, error-prone, deferred to future). | §3.5 |
| D10 | Error event type | Separate `config_error` event type (DIAGNOSTIC priority) for validation errors, distinct from `config_changed` | Validation errors and successful configuration changes are semantically different concerns. Overloading `config_changed` with error payloads would complicate subscriber filtering and conflate normal operations with degraded-state reporting. | Fold into `config_changed` with a payload `status` field (rejected: overloads semantics, subscribers filtering for config changes would also receive error reports). | §3.6, §4.5 |

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It is governed by the Design Document Template and will be reviewed during architecture review.*