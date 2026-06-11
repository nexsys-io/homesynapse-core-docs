# Research 13: Config System Market Superiority — UX Failure Modes + Runtime Robustness
*Target: HomeSynapse Core M6.2/M6.4 + future config AMDs + M10/M11/Doc 13. Date: 2026-06-11.*

## 0. Quote-back gate

**(a) §0.2 module-info embed, verbatim:**
```java
module com.homesynapse.config {
    requires transitive com.homesynapse.event;
    requires org.snakeyaml.engine.v2;
    requires com.networknt.schema;
    requires com.fasterxml.jackson.core;
    requires com.fasterxml.jackson.databind;
    requires org.slf4j;
    exports com.homesynapse.config;
}
```
(Header: "Configuration System — YAML loading, schema validation, secrets management, hot reload, and integration-scoped configuration access (Doc 06)." Nick ruling 2026-06-10: third-party `requires` are non-transitive, consumed only by package-private M6.1a pipeline classes; [AMD-71-A] zero-new-edge property holds.)

**(b) §0.3 four-piece charter table rows, verbatim:**
- M6.1 — config pipeline: YAML 1.2 load (snakeyaml-engine, explicit CoreSchema), JSON-Schema validation (networknt, allErrors), AMD-67 migration chain, ConfigurationAccess/ConfigurationService impls, AMD-71 layout + canonicalization traversal guard, AMD-66 listener defined + registered, config.validation_completed published — DONE b7bc65c + 9035110.
- M6.2 — secret store + per-scope key-management infra: ScopeKeyManager (KEK/DEK, scope_keys), PayloadCipher seam (composition-root bridge at com.homesynapse.app — zero new module edge), machine-local-root secret store, SecretStore.setAll(Map) atomic durable write (AMD-68), !secret/!env stage-3 tag resolution — PLANNED, instruction pending.
- M6.3 — at-rest write-path encryption: sensitive-PII categories encrypted-on-write — TRIPLE-GATED, OUT OF SCOPE here.
- M6.4 — hot-reload atomic swap: atomic ConfigModel swap (no torn read), AMD-66 listener invocation + classification-driven per-section apply, config.section_reloaded (AMD-70), ConfigChangeSet diffing, reload/write ReentrantLock, atomic file writes, §3.7 step-7 migration write-back + pre-migration backup — PLANNED, instruction pending.

**(c) The three pinned M6.4 instruction obligations, verbatim:**
1. R1: Doc 06 §3.6 per-ERROR config_error startup publication (the publish site lands at M6.4).
2. The P2 consumer/pin survey re-run for config.section_reloaded (event-manifest fan-out).
3. The reload re-parse must carry the explicit CoreSchema (LoadSettings lockstep — the M6.1a gate-fix lesson).

Gate satisfied. Proceeding to findings.

## 1. Executive Summary

- **The single highest-impact finding: HomeSynapse's INV-CE-01 (one YAML file is the sole source of truth; UI/CLI/REST all read/write it) structurally eliminates the most-cited, most-painful failure class in the entire surveyed market — Home Assistant's `.storage`-vs-`configuration.yaml` split-brain.** Years of HA architecture debate (Issues #143, #283) and a documented data-loss bug (#103256, config truncated to 0 bytes) all stem from the dual-storage split HA chose in ADR-0010 (accepted 2020-04-14). HomeSynapse should treat this as its flagship superiority claim, not a feature to revisit.
- **The dual-audience claim (one file serves both laymen and power users) is supported by evidence but threatened on one axis: write-back ergonomics.** openHAB's multi-year "single source of truth" war (Issue #64682) proves users will tolerate either a file-truth model or a DB-truth model — but NOT ambiguity about which wins. HomeSynapse's INV-CE-01 resolves the ambiguity correctly; the residual risk is M6.4's write-back preserving comments/ordering/anchors, which power users explicitly demand.
- **The "restart-to-apply" tax is real across platforms, and AMD-66's HOT/INTEGRATION_RESTART/PROCESS_RESTART classification is the correct architectural answer — but it is currently defined, not exercised.** This is the largest concentration of M6.4 instruction-obligation work, and the prior art (Kubernetes ConfigMap reload, nginx test-then-reload) validates the design.
- **Validation timing is a genuine partial gap.** HA's `check_config` catches schema/syntax errors but NOT template errors, unavailable-entity-at-trigger-time, or cross-reference breakage (Issue #31461; docs admit YAML-edited entity names "fail silently"). HomeSynapse's three-tier validation + JSON Schema closes the *typo'd-key-silently-ignored* class structurally, but runtime-only reference validity (an automation pointing at a deleted entity) is a real residual that maps to AMD-17 and is an M6.4/future-AMD item.
- **Local-first config is a survival feature, not a luxury — the evidence is a graveyard.** Insteon's cloud went dark April 14 2022 and bricked hubs that needed cloud SSL validation to even initialize (≈100,000 hub users affected); SmartThings' Groovy retirement killed webCoRE; cloud routine outages recur. HomeSynapse's fully-local config plane is correctly positioned; the only now-or-never item is provenance/multi-writer schema semantics, and the 2026-06-10 regret-proof assessment is **confirmed** by this evidence.
- **The rename-cascade problem (display name == identity) is a top-3 user pain on HA, HomeKit, and SmartThings — and HomeSynapse's typed-ULID identity (LTD-04) closes it structurally.** HA's own docs concede renaming an entity_id breaks every automation referencing it (WTH thread, Issue #115334). This is a CLOSED win to advertise, with the caveat that the UI must surface the name/identity split.
- **Over-engineering check flags exactly one candidate for scrutiny, not rejection:** AMD-67's full `(major,minor)` migration machinery with `MigrationPreview`/`requiresUserReview` is heavier than any surveyed consumer platform offers — but the mid-flight migration-failure evidence (HA Issue #157984; DB migration #759122; downgrade #142639) justifies it. Keep it; the evidence supports fail-closed migration over silent best-effort.

## 2. Platform / Literature Deep Dives

### 2.1 Home Assistant (RQ1 — deepest treatment)

HA is the closest architectural analog to HomeSynapse and the richest failure-evidence source.

**(a) Breaking changes across upgrades.** HA ships monthly with a dedicated "Breaking changes" section every release. After years of pain, HA adopted **ADR-0021**, mandating a minimum 6-month (6-release) deprecation window for YAML config options. Verbatim: *"the deprecation period for YAML configuration options is set to at least 6 months (being 6 release cycles at the time of writing)"* (github.com/home-assistant/architecture/blob/master/adr/0021-YAML-integration-configuration-deprecation-policy.md). Crucially, the same policy makes migration mandatory and failure-visible: *"If a migration … is possible, it becomes required to add a migration. If migration has failed, this must be reflected by raising a repair issue."* Even so, every monthly changelog carries multiple `(breaking-change)` YAML-removal entries — the HA 2026.6 changelog confirms *"Remove YAML import from Duck DNS integration (#169769) (breaking-change)"* and *"Remove deprecated reboot service for Velux gateway (#169796) (breaking-change)"*, and the full set of legacy template entities (alarm_control_panel, binary_sensor, cover, fan, light, lock, sensor, switch, vacuum, weather) was removed in 2026.6 after a 2025.12 deprecation. **Blast radius:** a user who skips reading release notes finds integrations silently dropped or reverted. **Gap-relative verdict:** relative to AMD-67 (forward-only, idempotent, major-triggered migration; chain-gap/newer-major = FATAL fail-closed) and §3.6 three-tier validation. HomeSynapse's migration chain is structurally stronger than HA's per-integration ad-hoc deprecations because it is centralized and fail-closed. ALREADY-COVERED, but the *cadence/communication* discipline (a changelog of schema-major bumps + HA's "raise a repair issue on migration failure" rule) is an instruction-level ergonomic worth mirroring in REC-135.

**(b) YAML-to-config-flow forced migration.** HA's **ADR-0010 "Integration configuration"** (accepted 2020-04-14) is the canonical decision. Verbatim rationale: *"we've introduced config entries (a centralized config object) and config flows… Config entries allow for migrations during upgrades, limiting the breaking changes we have to induce on our users."* The decision rule: *"Integrations that communicate with devices and/or services are only configured via the UI. In rare cases, we can make an exception."* (github.com/home-assistant/architecture/blob/master/adr/0010-integration-configuration.md). The cost landed on power users. A representative complaint (architecture Issue #143): *"Having configuration as a file means you can use a bunch of tools - rsync, git versioning, diff, grep, sed, bulk rename, etc - that you simply cannot if it is stored in a database that's only meant to be accessed through the UI."* **Gap-relative verdict:** relative to INV-CE-01. HomeSynapse's file-is-truth + UI-writes-the-same-file is the explicit antidote to ADR-0010's cost. ALREADY-COVERED and the core superiority claim.

**(c) `.storage` vs `configuration.yaml` split-brain.** HA's deepest structural wound. Architecture Issue #283 admits *"the .storage folder has the same flaw… since it contains both user configuration (stored from UI) as data (e.g., tokens)."* Issue #143 documents the user confusion: *"it's not clear to me as a user whether that hidden directory should be backed up or committed to source control."* Concrete data-loss: core Issue #103256 — after a low-disk upgrade, *"the configuration.yaml was truncated to 0 bytes"*, with the user proposing exactly the write-temp-then-rename + backup discipline HomeSynapse already ratifies. **Gap-relative verdict:** relative to INV-CE-01 (no split-brain by construction), the Doc 06 §3.5 write path (atomic write-to-temp-then-rename, `fileModifiedAt` optimistic-concurrency token), and M6.4's §3.7 pre-migration backup. ALREADY-COVERED — and this is the flagship win.

**(d) Include sprawl.** HA offers `!include`, `!include_dir_list`, `!include_dir_merge_named`, `!include_dir_merge_list`, and packages. Real order-sensitivity and structural confusion result: `!include_dir_merge_named` view-ordering is non-deterministic (community thread 29868), and core Issue #130537 laments *"config in configuration.yaml vs a child config.yaml file that's imported is literally structured differently so I can't hack it right in the root config then move it."* Counter-evidence (the *value* of files): the `sed`/git anecdotes in Issue #143. **Gap-relative verdict:** relative to AMD-71 (root + `integrations/` ONE-LEVEL includes only; nested include = unknown-tag FATAL per AMD-71-INV-02). HomeSynapse deliberately caps include depth at one level — directly avoiding HA's recursive-merge sprawl. ALREADY-COVERED; the cap is a defensible anti-feature (§3.4).

**(e) Restart-to-apply culture.** HA grew per-integration reload over years but full restart is still required for many config domains; the cost is automations offline and (for Zigbee/Z-Wave) network re-init. Reload-vs-restart confusion is pervasive. **Gap-relative verdict:** relative to AMD-66 (per-section HOT/INTEGRATION_RESTART/PROCESS_RESTART classification, unannotated default = PROCESS_RESTART fail-safe) and M6.4 atomic swap. Architecturally HomeSynapse is ahead; the classification is *defined* but *unexercised* — M6.4 INSTRUCTION OBLIGATION.

**(f) Validation timing.** HA's `check_config` catches schema/syntax errors but the docs explicitly warn that a YAML-edited entity name *"may not generate an error… attempts to use that entity will generate errors (or possibly fail silently)."* core Issue #31461 documents that template errors in automations pass some checks and explode only at runtime: *"If I make the same mistake in a value_template of a template sensor, both Check config and hassio ha check report no issues."* **Gap-relative verdict:** relative to §3.6 three-tier validation (FATAL/ERROR/WARNING) and INV-CE-03 (JSON Schema as contract). The *static* class (types, ranges, unknown keys) is CLOSED. The *runtime-reference* class (a behavioral template that only fails at trigger time, or a reference to an entity that exists but is unavailable) is NOT closed by schema validation — a real residual mapping to AMD-17 orphan detection. Partial gap → M6.4/FUTURE-AMD.

**(g) Silent defaults / typo'd keys.** HA's permissiveness historically let unknown keys pass silently; community Issue 439040 reports *"Syntax errors in configuration.yaml and other YAML files not detected, files apparently 'ignored'."* HA has tightened (packages now deep-merge-error on duplicate entity IDs) but the permissive legacy remains. **Gap-relative verdict:** relative to INV-CE-03 (JSON Schema contract, allErrors validation) and LTD-09 (explicit CoreSchema). HomeSynapse rejects unknown keys via schema. ALREADY-COVERED — but whether the schema is `additionalProperties:false` (hard-reject typos) vs permissive is an instruction-level decision worth pinning (REC-134).

**(h) Secrets at rest.** HA's `secrets.yaml` is plaintext. The community has asked for encryption for years (feature requests 444225, 467569, 250203, 269485; the WTH-2022 thread: *"Having so critical information in plain text is a no-go from a security point of view. Once I have access to a HA instance the first thing I'd always look at is this secrets.yaml file."*). HA's own check tool can print them (`hass --script check_config --secrets`). **Gap-relative verdict:** relative to Doc 06 §3.4 + Doc 15 fences: secrets encrypted at rest (`secrets.enc`, AES-256-GCM), referenced by `!secret` name, MVP machine-local root key. HomeSynapse's posture is already ahead of HA's plaintext model. ALREADY-COVERED (M6.2 ships `setAll`/AMD-68). Passphrase-root KDF = AMD-69 deferred, do not re-open.

### 2.2 SmartThings (RQ2/RQ5 — the calibration case)

The **Groovy IDE retirement** is the canonical "platform-managed config breaks user investment" exodus. Timeline: Samsung announced Lua Edge Drivers replacing Groovy DTHs; **"The End of Groovy Has Arrived"** (SmartThings Community #246280, 2022-08-17) stated verbatim *"Beginning September 30, 2022, at 00:00 (PST) we will start migrations of Groovy device DTHs as well as SmartLighting and SevereWeather SmartApps, two of our most popular Smartapps built on Groovy"*, with IDE features (new DTH/SmartApp creation, debugging) removed October 15 2022. The blast radius hit **webCoRE**, the dominant community automation engine: the webCoRE forum thread **"Groovy deprecation (end of webCoRE) on ST plaform - December 31, 2022"** (2022-08-11) pins the user-facing death date. webCoRE developer ipaterson confirmed pistons were unrecoverable: *"A backup file is the only way to keep your pistons after the Groovy platform is shut down."* SmartThings expert JDRoberts (verbatim, #246280/831): *"All custom groovy smartapps, including Webcore and Advanced Button Controller, will stop working when the groovy cloud is shut down."* **Measurable churn signal:** no official aggregate count exists, but the exodus to Hubitat (which still runs Groovy webCoRE locally) is documented user-by-user — markplewis migrated 49 pistons, Shenanigans 55, an39511 ~100. Samsung itself built its Rules API GUI from *"an extensive metadata analysis of active WebCore pistons."* SmartThings also has a recurring cloud-outage record (status history shows rules/scenes disruptions May 2 2023, device-control issues April 11 2023, Matter control Aug 22 2023; community "Devices Stopped Responding (26 March 2024)").

**Gap-relative verdict:** relative to INV-CE-01 (local file truth) + local config plane + AMD-67 (user-owned migration). HomeSynapse cannot have a Groovy-style platform retirement because there is no cloud-resident automation runtime to retire and no proprietary IDE-stored config. ALREADY-COVERED; this is the strategic anti-pattern HomeSynapse is built against.

### 2.3 Apple HomeKit (RQ2 — zero-config layman archetype)

HomeKit is the "never-see-a-config-file" extreme: no config file, no schema, iCloud-synced opaque state. What it buys (laymen): plug-and-play — *"Once you set it up and sign in with your Apple ID, it automatically becomes a home hub with no extra configuration needed."* What it gives up (power users): debuggability and control. Apple Community threads document automations silently failing after iOS 16/17/18 updates with no diagnostic surface; one user: *"This is especially frustrating due to Apple's approach… which prefers to hide or obscure detailed configuration settings."* Another flags a hard limit: *"an automation in homekit is limited to only 4 hours!"* A power user's lament: *"We need to be able to clear caches, force HomeKit data synchronization, trace accessory communications, view log files… that sort of thing."* **Gap-relative verdict:** relative to the dual-audience INV-CE-01 + INV-CE-02 (zero-config is valid; every key has a schema default; unconfigured integrations get an empty section). HomeSynapse aims to give the layman HomeKit's zero-config start (INV-CE-02) WITHOUT surrendering the power user's file/diff/log access. Evidence SUPPORTS the dual-audience thesis: HomeKit proves zero-config alone is insufficient for power users. ALREADY-COVERED.

### 2.4 Hubitat (RQ2/RQ3 — local hub with explicit rollback)

Hubitat is local-first and notable for a first-class **rollback** model that HA lacks: *"if your hub is having problems immediately following an update, please rollback to previous version from the Diagnostic Tool."* Hubitat explicitly distinguishes **Rollback** (platform/firmware) from **Restore** (database backup): *"Backups are copies of hub's data (database)… they do NOT contain the Platform."* Critical limitation in their docs: *"Local backup includes the device list but not the contents of the Z-Wave radio or Zigbee pairings. These devices will need to be re-paired if the backup is restored to a different hub."* Cloud radio backup/restore is paywalled behind Hub Protect. Community shows restore failures: *"All my restore attempts end in a corrupt DB error"* (backup-restore thread 145785). **Gap-relative verdict:** relative to M6.4's pre-migration backup (§3.7 step-7) and §3.3 reject-and-keep-prior-good-state. HomeSynapse's reject-and-keep-prior-good gives *automatic* rollback-on-bad-reload that Hubitat achieves only manually; Hubitat's explicit user-facing snapshot/restore UX is a POST-MVP UI lesson. Mixed: core mechanism ALREADY-COVERED; user-facing snapshot UX = POST-MVP UI input.

### 2.5 openHAB (RQ2 — the dual-truth cautionary tale)

openHAB ran the exact architectural debate HomeSynapse has settled. Its config split (text files in `$OPENHAB_CONF` vs JSONDB in `$OPENHAB_USERDATA/jsondb`) produced a famously long architecture thread (Issue #64682) whose distilled requirements were openly *contradictory*: *"there shall to be one source of truth in the configs / the internal JSONDB shall be the one source of truth / the external file configs shall be the one source of truth."* Migration docs warn: *"if you create an Item in PaperUI, you will not find that new Item in any of the .items files. Instead they get saved to a JSONDB file… you will ultimately end up with a mix of database and text based configuration."* A key requirement users surfaced: *"text configs shall preserve order so small changes do not result in large diffs when using source control."* **Gap-relative verdict:** relative to INV-CE-01. openHAB is the strongest evidence that ambiguous dual-truth is the disease and a single declared source of truth is the cure — HomeSynapse chose correctly. The *order/comment-preservation* requirement is a direct M6.4 write-back instruction obligation (REC-131). ALREADY-COVERED on truth-model; write-back fidelity = M6.4 instruction obligation.

### 2.6 Homey (RQ2 — flow-UX layman model)

Homey is GUI-flow-only ("Flow cards are the building blocks of your automations"). It serves laymen well but offers no textual config, no diff, no version control — the same power-user ceiling as HomeKit, plus reports of runtime throttling: *"i can only do that 4 times before everything freezes for a minute"* (flows thread 56146). **Gap-relative verdict:** relative to dual-audience INV-CE-01. Homey confirms the GUI-only ceiling; HomeSynapse's escape hatch (the file) is the differentiator. ALREADY-COVERED.

### 2.7 Alexa / Google routines (RQ5 — cloud-managed config fragility)

Both are cloud-resident routine stores. Outage evidence: a Google Assistant Community thread "Basic routines stopped working 26/12/2023"; recurring Alexa routine failures tied to cloud/account state. The structural point: routines live in the vendor cloud, so a WAN/cloud outage makes them unconfigurable AND non-executing. **Gap-relative verdict:** relative to HomeSynapse's fully-local config plane. ALREADY-COVERED as the cloud-dependence anti-pattern.

### 2.8 Insteon (RQ5 — the cloud-shutdown graveyard case)

The canonical "cloud death bricks the home" case. Insteon's parent Smartlabs assigned its assets for sale (deal closed March 22 2022) and the cloud went dark April 14 2022 without notice. Local switches kept working, but cloud-dependent app control, scheduling, and — critically — hub *initialization* did not. Hackaday (2022-04-25) confirms the SSL-init dependency verbatim: *"it turned out to be imperative that users don't factory reset their Insteon hubs, since those have to communicate with the currently Inste-Gone servers as part of initial configuration, diligently verifying the SSL certificates."* The scale: ≈100,000 hub users, per Universal Devices CEO Michel Kohanim quoted in The Register (2022-04-22): *"Insteon, he said, has about 100,000 hub users."* **Gap-relative verdict:** relative to HomeSynapse's fully-local config plane and local-resident secrets. A HomeSynapse home never depends on a remote server to initialize or read its own config. ALREADY-COVERED as the headline anti-pattern.

### 2.9 Infrastructure prior art (RQ3 — reload semantics)

The canonical references validate AMD-66/M6.4. **Kubernetes ConfigMap:** *"pods do not automatically restart or reload ConfigMap changes after the initial deployment"* — env-var mounts are frozen at exec; volume mounts update via atomic symlink swap but apps must watch for it. The CNCF internals guide (2026-03-17) notes the swap *"generates IN_CREATE on ..data — NOT IN_MODIFY… This is why nginx does not auto-reload."* This is precisely the per-consumer reload-classification problem AMD-66 solves with explicit HOT/RESTART annotations rather than implicit file-watching. **nginx** uses test-then-reload (`nginx -t` then `-s reload`) — the validate-before-apply pattern that maps to §3.3 reject-and-keep-prior-good. **Gap-relative verdict:** the prior art confirms HomeSynapse's design is correct and that the *atomic swap* (no torn read) is the hard part to test. ALREADY-COVERED on design; M6.4 test obligation on atomic-swap + classification.

## 3. Cross-Cutting Analysis

### 3.1 Concept-mapping table

| Failure class / pattern | HA | SmartThings | HomeKit | Hubitat | openHAB | Homey | HomeSynapse (ratified mechanism) |
|---|---|---|---|---|---|---|---|
| Source-of-truth split-brain | **Yes** (.storage vs YAML, ADR-0010) | Cloud-only | Opaque iCloud | DB + manual file | **Yes** (JSONDB vs text) | GUI-only | **None** — INV-CE-01 single file |
| Plaintext secrets at rest | **Yes** (secrets.yaml) | Cloud | Cloud | Hub DB | Yes | Cloud | secrets.enc AES-256-GCM (Doc 06 §3.4) |
| Restart-to-apply tax | Partial reload | Cloud-push | Opaque | Partial | Partial | GUI-push | AMD-66 HOT/RESTART classification |
| Rename breaks references | **Yes** (entity_id=identity) | Yes | Yes | Partial | Partial | GUI | **None** — typed-ULID (LTD-04) |
| Mid-flight migration failure | **Yes** (#157984, DB migrations) | N/A cloud | N/A | DB-corrupt restores | Migration mix | N/A | AMD-67 forward-only, fail-closed |
| Reject-and-keep-prior-good reload | No (restart) | N/A | N/A | Manual rollback | No | N/A | §3.3 + §3.6 (ratified) |
| Validation before apply | check_config (partial) | Cloud | None | Limited | Limited | None | §3.6 three-tier + JSON Schema |
| Local-only config plane | Yes (core strength) | **No** | **No** | Yes | Yes | Pro: yes / Cloud: no | **Yes** (baseline) |
| Cloud-retirement / shutdown risk | Low | **High** (Groovy) | Med (iCloud) | Low | Low | Med | **None** by construction |

### 3.2 The RQ3 gap table

| Runtime failure class | Ratified mechanism | Status |
|---|---|---|
| Torn / partial config application | M6.4 atomic ConfigModel swap (in-flight readers see wholly-old or wholly-new) | **CLOSED-UNTESTED** → M6.4 test obligation |
| Device/entity renames breaking automations | Typed-ULID identity (LTD-04); names are display metadata | **CLOSED** (structural) |
| ID stability on re-pair / re-setup / restore | Typed ULID + DeviceReplacementService (INV-CS-02); immutable event log | **CLOSED** (structural; UI surfacing untested) |
| Mid-flight migration failure | AMD-67 forward-only/idempotent; chain-gap/newer-major = FATAL fail-closed; in-memory per-load today, disk write-back + pre-migration backup at M6.4 (R2) | **CLOSED-UNTESTED** → M6.4 test obligation (crash between backup and rename) |
| Rollback after bad reload | §3.3 reject-and-keep-prior-good-state; prior good ConfigModel stays active | **CLOSED** (auto); user-facing snapshot UX OPEN → POST-MVP |
| Runtime reference validity (automation → deleted entity) | AMD-17 orphan interaction; AMD-44 registry guards | **OPEN** (not closed by schema validation) → FUTURE-AMD / M6.4 |
| External-edit race during write | `fileModifiedAt` optimistic-concurrency token; single ReentrantLock | **CLOSED-UNTESTED** → M6.4 test obligation |
| Torn read of secrets during multi-key write | SecretStore.setAll(Map) atomic durable write (AMD-68) | **CLOSED-UNTESTED** → M6.2 test obligation |

### 3.3 Dual-audience assessment

The evidence is strongly **supportive** of HomeSynapse's one-file-two-audiences claim, with one qualified threat:
- **Supportive:** HomeKit/Homey prove zero-config-GUI alone hits a hard power-user ceiling (no diff, no git, opaque debugging). HA/openHAB prove the dual-storage *escape hatch* is what power users fight for. HomeSynapse's INV-CE-01 + INV-CE-02 gives the layman the empty-section zero-config start AND the power user the single editable file — without the split-brain both HA and openHAB suffer.
- **Threat:** the one place the claim can fail is **write-back fidelity**. openHAB users explicitly demanded *order preservation so small diffs don't become large diffs*; HA power users demanded comment/anchor preservation. If M6.4's UI-writes-the-same-file path reorders keys, strips comments, or expands anchors, the power-user value of INV-CE-01 erodes. This is the sharpest M6.4 instruction obligation in the dual-audience lane (REC-131).

### 3.4 Over-engineering check (REJECT candidates)

- **AMD-71 one-level include cap** — could be seen as under-powered vs HA's recursive includes/packages. Evidence DEFENDS it: HA's recursive merge is a documented sprawl/order-sensitivity source (#130537, thread 29868). Keep. Not a REJECT.
- **AMD-67 full (major,minor) + MigrationPreview/requiresUserReview** — heavier than any consumer platform. Evidence DEFENDS it: mid-flight migration failures (HA #157984; DB migration #759122) and downgrade breakage (#142639) show silent best-effort migration is worse. Keep.
- **The genuine scrutiny target:** AMD-70 `config.section_reloaded` event fan-out richness. No surveyed platform exposes per-section reload as an observable event to other subsystems; this is infra-grade. It is justified by HomeSynapse's event-sourced architecture (cheap given the event bus already exists) but should NOT grow speculative payload fields beyond the flattened AMD-70 contract. Keep, but resist scope growth — noted, not rejected.
- **No bucket is empty by laziness here:** the honest conclusion is that the ratified machinery is well-matched to evidenced pain; there is no ratified mechanism that NO surveyed user needs.

## 4. Findings + Recommendations

### 4a. REC-numbered findings

**REC-130 — Advertise and test the no-split-brain property as the flagship superiority claim.**
*Failure class:* §2.1(c) HA `.storage` split-brain (Issues #143, #283, #103256). *Gap-relative:* INV-CE-01, Doc 06 §3.5 write path. *Recommendation:* Add an M6.4 integration test proving UI-write → file → re-read round-trips with the `fileModifiedAt` token rejecting a stale external edit. *Effort:* S.

**REC-131 — M6.4 write-back must preserve comments, key ordering, and anchors.**
*Pattern:* §3.3 power-user "options without footguns"; openHAB order-preservation requirement (#64682); HA #143 sed/git anecdotes. *Gap-relative:* INV-CE-01 + M6.4 atomic file writes. *Recommendation:* The M6.4 instruction must specify a comment/order-preserving emitter (or document the deviation as a known limitation); a reordering round-trip silently degrades the dual-audience value. *Effort:* M.

**REC-132 — Exercise AMD-66 reload classification under atomic swap with a per-class test matrix.**
*Failure class:* §2.1(e) restart-to-apply; K8s/nginx prior art. *Gap-relative:* AMD-66 (defined, not exercised), M6.4 swap. *Recommendation:* M6.4 tests must cover HOT (applied in place), INTEGRATION_RESTART (single integration recycled), PROCESS_RESTART (deferred to next start), and the unannotated→PROCESS_RESTART fail-safe default. *Effort:* M.

**REC-133 — Add a torn-read concurrency test for the atomic ConfigModel swap.**
*Failure class:* §3.2 torn/partial application; K8s frozen-env-var prior art. *Gap-relative:* M6.4 atomic swap done-when. *Recommendation:* Concurrent-reader test asserting every reader sees wholly-old or wholly-new model during swap. *Effort:* M.

**REC-134 — Pin schema `additionalProperties:false` (or explicit decision) to close the silent-typo'd-key class.**
*Failure class:* §2.1(g) silent ignored keys (HA 439040; docs "fail silently"). *Gap-relative:* INV-CE-03 JSON Schema contract. *Recommendation:* The M6.x instruction should pin whether unknown keys hard-reject (recommended, ERROR-tier) vs warn; HA's permissiveness is a documented anti-pattern. *Effort:* S.

**REC-135 — Crash-safety test for mid-flight migration write-back (M6.4 §3.7 step-7), and adopt HA's migration-failure-surfacing discipline.**
*Failure class:* §3.2 mid-flight migration failure (HA #157984; DB migration #759122; downgrade #142639); ADR-0021's *"If migration has failed, this must be reflected by raising a repair issue."* *Gap-relative:* AMD-67 + M6.4 pre-migration backup + atomic write. *Recommendation:* Test crash between pre-migration backup and atomic rename; assert recoverable to prior-good; ensure a failed migration emits an observable diagnostic (AMD-70 lane), mirroring HA's repair-issue rule. *Effort:* M.

**REC-136 — Close (or consciously defer) the runtime-reference-validity gap.**
*Failure class:* §2.1(f) template/unavailable-entity runtime errors (HA #31461; docs); §3.2 automation→deleted-entity. *Gap-relative:* schema validation does NOT cover it; AMD-17 orphan interaction + AMD-44 registry guards do, partially. *Recommendation:* Confirm whether config-load validation cross-checks references (automation → entity/area ID) against the registries at load time; if not, this is a FUTURE-AMD (a reference-integrity validation pass) or an M6.4 reload-candidate check. *Effort:* M (decision) / L (if new validation pass).

**REC-137 — Surface the name-vs-identity split in the eventual UI; advertise rename-safety now.**
*Failure class:* §2.1, §2.3 rename-cascade (HA WTH thread, #115334; HomeKit). *Gap-relative:* typed-ULID (LTD-04) — CLOSED structurally. *Recommendation:* Post-MVP UI must show that renaming changes display metadata only, never identity; no runtime work needed now. *Effort:* S (POST-MVP UI input).

**REC-138 — Provenance/multi-writer schema semantics: confirm now-or-never status.**
*Failure class:* RQ5 hybrid sync-conflict; SmartThings cloud-edit, HA Cloud scope. *Gap-relative:* `fileModifiedAt` token (single-writer optimistic concurrency); immutable event log; flattened observability events. *Recommendation:* The 2026-06-10 regret-proof assessment is **confirmed by evidence** — the only now-or-never item is whether config-mutation events need a `source`/provenance field in their *persisted* shape. If a future cloud/companion writer is plausible, evaluate reserving a provenance field in the event-resident payload NOW (schema-irreversible) vs deferring (UI/sync engine = deferrable). *Effort:* M (decision); flag as the one now-or-never item.

**REC-139 — Provide automatic reject-and-keep-prior-good as the rollback story; defer user-facing snapshots.**
*Failure class:* §2.4 Hubitat manual rollback / restore-corruption; RQ3 rollback semantics. *Gap-relative:* §3.3 reject-and-keep-prior-good (ratified, auto). *Recommendation:* No core work — the auto-rollback-on-bad-reload already beats Hubitat's manual model; user-facing snapshot/restore UX is POST-MVP. *Effort:* S (POST-MVP UI input).

**REC-140 — Secrets-at-rest posture is a marketable win; add atomic multi-key durability test.**
*Failure class:* §2.1(h) plaintext secrets.yaml (HA feature requests). *Gap-relative:* Doc 06 §3.4 secrets.enc + AMD-68 setAll. *Recommendation:* M6.2 test for setAll atomic durability (all-or-nothing across keys, crash-safe). Do NOT re-open AMD-69 passphrase root. *Effort:* S.

### 4b. THE DISPOSITION TABLE

| REC | Disposition | Specific placement |
|---|---|---|
| REC-130 | **M6.4 INSTRUCTION OBLIGATION** | M6.4: round-trip + `fileModifiedAt` stale-edit-rejection test (relative to INV-CE-01, Doc 06 §3.5) |
| REC-131 | **M6.4 INSTRUCTION OBLIGATION** | M6.4: comment/order/anchor-preserving write-back emitter, or documented deviation (INV-CE-01 + atomic writes) |
| REC-132 | **M6.4 INSTRUCTION OBLIGATION** | M6.4: AMD-66 HOT/INTEGRATION_RESTART/PROCESS_RESTART + unannotated-default test matrix |
| REC-133 | **M6.4 INSTRUCTION OBLIGATION** | M6.4: concurrent-reader torn-read test on atomic ConfigModel swap |
| REC-134 | **M6.2-or-M6.4 INSTRUCTION OBLIGATION** | Pin `additionalProperties` behavior in the schema contract (INV-CE-03); ERROR-tier reject recommended |
| REC-135 | **M6.4 INSTRUCTION OBLIGATION** | M6.4: crash-between-backup-and-rename migration write-back test + migration-failure diagnostic (AMD-67 + §3.7 step-7 + AMD-70 lane) |
| REC-136 | **FUTURE AMD** | Reference-integrity validation pass (automation→entity/area ID) at load/reload; contract delta sketch only — relative to AMD-17/AMD-44, NOT closed by INV-CE-03 |
| REC-137 | **POST-MVP UI-or-cloud DESIGN INPUT** | M10/M11/Doc 13: surface name≠identity (LTD-04 already closes runtime) |
| REC-138 | **FUTURE AMD** | Provenance field in persisted config-mutation event payload — the single now-or-never item; formal-pipeline decision before event shapes freeze |
| REC-139 | **POST-MVP UI-or-cloud DESIGN INPUT** | M10/M11/Doc 13: user-facing snapshot/restore UX (core auto-rollback already covered by §3.3) |
| REC-140 | **M6.2 INSTRUCTION OBLIGATION** | M6.2: setAll(Map) atomic-durability crash-safe test (AMD-68) |

*Bucket coverage check:* **ALREADY-COVERED** is represented throughout the §2 verdicts (split-brain, rename, restart-classification, secrets posture, cloud-shutdown immunity) rather than as standalone RECs because, per the brief, re-proposing ratified machinery scores as ALREADY-COVERED not as a recommendation — those verdicts are the coverage attestation the PM folds in. **INSTRUCTION-OBLIGATION:** REC-130/131/132/133/134/135/140. **FUTURE-AMD:** REC-136, REC-138. **POST-MVP UI/CLOUD:** REC-137, REC-139. **REJECT bucket: genuinely empty** — no surveyed-platform evidence supports an anti-requirement against ratified machinery; the closest candidate (AMD-71 include cap) is affirmatively defended by HA's sprawl evidence (§3.4), so it is not a REJECT. No REC appears in two buckets.

## 5. Caveats and Open Questions

- **Source reliability:** RQ1/RQ2/RQ5 evidence is strong (primary: HA ADRs/GitHub issues/official docs/blogs; SmartThings + webCoRE community announcements; The Register/Ars/Hackaday for Insteon). Several RQ-secondary items (Alexa/Google routine outages, Homey throttling) rest partly on troubleshooting blogs and single community threads rather than vendor postmortems — treated as directional, not load-bearing. Vendor cloud-outage status pages aggregate but rarely give root-cause.
- **No aggregate churn number for webCoRE** exists in primary sources; the exodus is documented per-user (49–100 pistons migrated to Hubitat) plus Samsung's "active WebCore pistons" analysis statement. Sufficient as a qualitative calibration case but not a quantified market-share figure. The Insteon ≈100,000-hub figure is the CEO's estimate via The Register, not an audited number.
- **HomeSynapse facts not embedded and not read:** I did not have direct access to the full text of Doc 06 §3.1–§3.7, AMD-66..71, or Doc 15 beyond the §0.3 condensation. All gap-relative verdicts are relative to the §0.3 register as embedded. If any verdict (especially REC-136's claim that runtime reference-validity is NOT closed, and REC-138's persisted-event-shape claim) conflicts with the actual Doc 06 §3.6 validation scope or the AMD-70 payload schema, the document text governs — these two should be source-verified against Doc 06 / AMD-70 before instruction drafting.
- **Spike candidates:** (1) the comment/order-preserving YAML emitter (REC-131) — does snakeyaml-engine's emitter round-trip comments, or is a custom layer needed? (2) the crash-safety window in migration write-back (REC-135).
- **Unresolved cross-platform tension:** the dual-audience claim's residual risk (write-back fidelity) cannot be fully validated without a real power-user round-trip test; recommend empirical validation at M6.4.

## 6. Appendix: Sources

**Home Assistant (architecture/ADR):** github.com/home-assistant/architecture/blob/master/adr/0010-integration-configuration.md; .../0021-YAML-integration-configuration-deprecation-policy.md; github.com/home-assistant/architecture/issues/143; /issues/283; github.com/home-assistant/architecture/discussions/845.
**Home Assistant (core issues):** github.com/home-assistant/core/issues/103256 (config truncated to 0 bytes); /issues/31461 (check_config template inconsistency); /issues/115334 (rename script entity_id); /issues/157984 (GoodWe migration error); /issues/142639 (downgrade DB invalid); /issues/20738 (no line number in validation error); /pull/134040 (Mastodon YAML removal).
**Home Assistant (docs/blog/community/changelog):** home-assistant.io/blog/2020/04/14/the-future-of-yaml/; /docs/configuration/troubleshooting/; /docs/templating/errors/; /docs/configuration/secrets/; /docs/configuration/packages/; /docs/configuration/splitting_configuration/; /changelogs/core-2026.6; developers.home-assistant.io/docs/core/integration/config_flow/; community.home-assistant.io threads 471669, 815676, 444225, 467569, 250203, 269485, 439040, 29868, 400231.
**SmartThings / webCoRE:** community.smartthings.com/t/the-end-of-groovy-has-arrived/246280 (and /831); community.webcore.co/t/groovy-deprecation-end-of-webcore-on-st-plaform-december-31-2022/20815; community.webcore.co/t/addressing-the-end-of-webcore/19433; thedigitalmediazone.com (Groovy retirement); status.smartthings.com/history; outlogger.com/status/smartthings; community.smartthings.com/t/devices-stopped-responding-26-march-2024/280222.
**Insteon:** theregister.com/2022/04/19/insteon_cloud_shutdown/; theregister.com/2022/04/22/insteon_shutdown_explained/ (≈100,000 hub users); hackaday.com/2022/04/25/ (SSL-init brick); arstechnica (Insteon shutdown); tinkertry.com/insteon-turns-off-cloud-but-local-controls-still-work.
**HomeKit:** discussions.apple.com threads 254199872, 254548087, 255155940, 255888242, 253411910; chrisvanpatten.com/fixing-location-based-homekit-automations/; linkdhome.com/articles/homekit-automation-guide; smarthomematrix.com (HomeKit hub guide).
**Hubitat:** community.hubitat.com/t/you-can-rollback/81831; /rollback-vs-restore/81608; /backup-restore-not-working/145785; docs2.hubitat.com/en/user-interface/settings/backup-and-restore.
**openHAB:** community.openhab.org/t/configuration-of-openhab/64682; /textual-vs-ui-driven-configuration/124198; openhab.org/docs/configuration/; v2.openhab.org/docs/configuration/migration/.
**Homey:** community.homey.app/t/limited-number-of-flows-to-start-in-a-row/56146; homey.app/en-us/features/flow/.
**Alexa/Google:** support.google.com/assistant/thread/251571682.
**Infra prior art:** cncf.io/blog/2026/03/17/when-kubernetes-restarts-your-pod-and-when-it-doesnt/; baeldung.com/ops/kubernetes-restart-configmap-updates; github.com/rosskukulinski/nginx-kubernetes-reload.

## 7. HomeSynapse Code-Level Implications [LIGHT — observations only, routed through §4b]

- The reload re-parse path inside the `com.homesynapse.config` module must reuse the explicit `CoreSchema` LoadSettings (the M6.1a gate-fix lesson, already a pinned M6.4 obligation) — REC-130/132 tests exercise code reached through `ConfigurationAccess`/`ConfigurationService`, not new types.
- The atomic-swap torn-read test (REC-133) observes `ConfigModel` visibility only; no new public surface on `com.homesynapse.config` is implied. The `[AMD-71-A]` zero-new-edge property and the §0.2 `requires`/`exports` set are unchanged by any finding here.
- `SecretStore.setAll(Map)` (AMD-68) durability test (REC-140) is an M6.2 concern within the existing seam; the `PayloadCipher`/`ScopeKeyManager` bridge lives at the `com.homesynapse.app` composition root (zero new module edge) per §0.3.
- The provenance-field question (REC-138) touches AMD-70 event-resident payload shapes and config-mutation event persistence — a contract matter for the FUTURE-AMD pipeline, NOT a module-info or new-type proposal here.
- No module-info changes proposed. No new types proposed. No contract text drafted.