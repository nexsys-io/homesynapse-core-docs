# Critical Design Review — Complete Session Synopsis

**Date:** 2026-03-09
**Scope:** Parts 1–4 of the Critical Design Review amendment application cycle
**Session span:** Two Claude sessions (Session 1: Parts 1–2, Session 2: Parts 3–4)
**Documents modified:** 8 of 11 design documents + PROJECT_STATUS.md + 3 new artifacts created

---

## Background

After all 11 HomeSynapse Core subsystem design documents (Docs 01–11) reached Locked status, a fresh-perspective adversarial architecture review was conducted. The review treated each document as a specification that would be handed to an independent engineering team and asked: "If I implement exactly what this document says, what breaks?"

The review produced 24 specification-level amendments (AMD-01 through AMD-24). Nick reviewed the findings and reclassified them:

| Tier | Count | Disposition |
|---|---|---|
| BLOCKING | 4 | AMD-02, AMD-03, AMD-04, AMD-10 — must apply immediately |
| REQUIRED | 9 | AMD-05, AMD-07, AMD-08, AMD-09-RL, AMD-11, AMD-13, AMD-14, AMD-15, AMD-16, AMD-17 — must apply before Phase 2 |
| RECOMMENDED | 9 | AMD-12, AMD-18, AMD-19, AMD-20, AMD-21, AMD-22, AMD-23, AMD-24 — apply opportunistically |
| Rejected | 2 | AMD-01 (durability contract — already specified in Doc 01 §8.3), AMD-06 (single-writer contention — no real gap) |

The amendment application was executed in four parts across two sessions.

---

## Part 1 — Session 1, Round 8–9 Pre-Lock Work

**Context:** This was the tail end of the Doc 10/11 drafting and locking cycle, not the formal review application. It established the baseline that Parts 2–4 built upon.

**Changes made (in order):**

1. **AMD-09 applied to Doc 10** (pre-lock). Reconnection admission control and rate limiting table added to the WebSocket API document before it was locked.

2. **HealthContributor upstream notes applied to Docs 01–10.** After Doc 11 defined the HealthContributor interface (§8.1, §8.2) and the three-state health model (HEALTHY/DEGRADED/UNHEALTHY), every preceding document received an upstream note in its §11.3 Health Indicator section acknowledging the interface and how it integrates.

3. **6 upstream Dependents field updates applied:**
   - U-01-R8, U-02-R8, U-05-R8 (Doc 10 dependencies → Docs 01, 02, 05)
   - U-01-R9, U-03-R9, U-04-R9 (Doc 11 dependencies → Docs 01, 03, 04)

4. **Docs 10 and 11 locked** (2026-03-09).

5. **PROJECT_STATUS.md updated** with Round 8–9 cross-audit history entry.

---

## Part 2 — Session 1, Round 10: 4 BLOCKING Amendments

**Target documents:** Doc 01, Doc 03, Doc 07

**Changes made (in order):**

### 1. AMD-02 — REPLAY→LIVE Reconciliation Pass → Doc 03

**Problem:** When the State Store replays from a checkpoint after a crash, `state_reported` events that arrived during the crash window have corresponding `state_changed` events that were never emitted (because the projection wasn't running). Downstream subscribers (especially the Automation Engine) miss state transitions.

**Changes to Doc 03:**
- **New §3.2.1** added after §3.2: Defines the reconciliation pass that runs once after replay completes and before the state store transitions to LIVE. For each entity, the reconciliation pass compares the replayed state against the last `state_reported` event. If they diverge, it emits a synthetic `state_changed` event with `triggered_by` pointing to the original `state_reported` event.
- Bounded by the replay window (only processes events since the last checkpoint).
- Emits `system.reconciliation_completed` event when finished.
- Cross-reference to Doc 01 §8.3 EventPublisher durability semantics.

### 2. AMD-10 — Projection Versioning → Doc 03

**Problem:** If the state projection logic changes between releases (e.g., a new attribute is derived, or derivation logic is corrected), the existing checkpoint contains state computed by the old logic. Loading it produces incorrect state silently.

**Changes to Doc 03:**
- New `projection_version` field added to the checkpoint schema and `CheckpointRecord`.
- `CURRENT_PROJECTION_VERSION` compile-time constant defined.
- On startup, if the checkpoint's `projection_version` doesn't match the current version, the state store triggers a full replay from position 0 (ignoring the checkpoint).
- This is a safety net, not an optimization — full replays are expensive but correct.

### 3. AMD-04 — Cascade Depth Limiting → Doc 07 + Doc 01

**Problem:** An automation that turns on a light could trigger another automation that turns on a fan, which triggers another automation... The event-sourced causal chain has no depth limit. A misconfigured automation set could create an infinite cascade.

**Changes to Doc 07:**
- **New §3.7.1** added: `cascade_depth` counter tracked on each `AutomationRun`. Incremented when a new automation is triggered by an event that was itself produced by an automation.
- Maximum depth: 8 (configurable).
- Duplicate suppression per `correlation_id` prevents the same automation from firing twice in the same causal chain.
- Natural termination via Doc 03 §3.2 change detection (if a "turn on light" command produces a `state_changed` event identical to the current state, no event is emitted, and the cascade terminates naturally).
- Health reports DEGRADED when repeated cascade depth limit hits are detected.

**Changes to Doc 01:**
- §4.4 (causal chain projection): `cascade_depth` added as a derived field. The causal chain projection now tracks the depth of each chain for forensic analysis and cascade detection.

### 4. AMD-03 — Snapshot Usage Pattern → Doc 07

**Problem:** When an automation's condition evaluates state from multiple entities (e.g., "if temperature > 72 AND window is open"), each state query could return state from a different point in time. A `state_changed` event could arrive between the two queries, causing the condition to evaluate against an inconsistent state view.

**Changes to Doc 07:**
- **§3.8 updated:** Condition evaluation now captures a `StateSnapshot` via `getSnapshot()` at trigger time. All entity state queries during condition evaluation use this snapshot, providing a consistent cross-entity state view. The snapshot is a lightweight read (Doc 03's in-memory state is immutable per version).

### 5. PROJECT_STATUS.md — Round 10 Entry

- Added Round 10 cross-audit history entry documenting all 4 BLOCKING amendments and their exact application locations.

---

## Part 3 — Session 2, Round 11: 11 REQUIRED Amendments (10 Applied, 1 Pre-Applied)

**Target documents:** Doc 02, Doc 03, Doc 05, Doc 06, Doc 08, Doc 09, Doc 11

This was the largest single round of amendments. Each amendment was applied in dependency order — amendments that other amendments reference were applied first.

**Changes made (in order):**

### 1. AMD-11 — State TTL (Staleness Model) → Doc 03

**Problem:** If a device stops reporting (battery dies, loses network), its last-known state sits in the State Store indefinitely with no indication that it's stale. The API serves this stale value as if it were current. Users and automations can't distinguish fresh state from hours-old state.

**Changes to Doc 03:**
- **EntityState record modified** — two new fields added:
  - `staleAfter` (Instant, nullable) — when this state becomes stale, computed from the device's capability-declared reporting interval plus a configurable buffer
  - `stale` (boolean) — whether the state is currently stale
- **New §3.8 Staleness Model** added after §3.7:
  - Capability-based threshold resolution: each capability type declares an expected reporting interval; the staleness threshold is derived from this plus a configurable multiplier (default: 3x)
  - Passive 30-second scan: a background scan evaluates staleness every 30 seconds (not per-query, to avoid CPU spikes)
  - `state_stale` event emitted when state transitions to stale; `state_stale_cleared` when fresh data arrives
  - Lazy read-time evaluation: the `stale` boolean is also checked at read time for immediate accuracy between scan intervals
  - Interactions documented: disabled entities are excluded from staleness scanning; availability UNAVAILABLE entities skip staleness (already known unreachable)
- **§5 Contracts and Invariants** — added API contract note: `stale` boolean is present in all REST and WebSocket state responses
- **§9 Configuration** — added staleness config block: `staleness.default_staleness_threshold`, `scan_interval_seconds`, `staleness_overrides` (per-capability-type overrides)

**Why applied first:** AMD-17 (device orphan lifecycle) references the staleness model to set `stale:true` on orphaned devices.

### 2. AMD-17 — Device Orphan Lifecycle → Doc 02

**Problem:** When an integration fails permanently or is removed, the devices it manages become orphans. The system has no defined behavior for these devices — they sit in the registry with their last-known state, their capabilities are still advertised, and commands to them fail silently.

**Changes to Doc 02:**
- **New §3.15** added after §3.14:
  - **Transition trigger:** Device enters ORPHANED state when its owning integration transitions to FAILED or is removed from configuration.
  - **Frozen state:** Orphaned devices have `stale:true` set via the Doc 03 §3.8 staleness model and `availability` set to UNAVAILABLE. Attributes are preserved (not cleared) to maintain last-known state for display.
  - **Hardware identifiers claimed:** Orphaned devices retain their hardware identity claim (e.g., Zigbee IEEE address). This prevents a re-discovered device from creating a duplicate — re-adoption matches against orphaned devices first.
  - **Command rejection:** Commands to orphaned devices return a `device_orphaned` RFC 9457 error.
  - **Automation behavior:** Automations referencing orphaned devices evaluate using last-known values with a `stale_input` warning flag on the AutomationRun. This allows automations to continue operating in degraded mode rather than failing entirely.
  - **Re-adoption matching:** When an integration comes back online and discovers a device whose hardware identifier matches an orphaned device, the existing device_id is reused. No data loss.
  - **Explicit removal:** Orphaned devices can be removed via REST API. After `auto_remove_after_days` (default: 30), orphaned devices are automatically removed.
  - **Health contribution:** Orphaned devices cause the Device Model subsystem to report DEGRADED health when the count exceeds `health_degraded_threshold` (default: 5).
- **§9 Configuration** — added orphan config: `orphan.auto_remove_after_days`, `health_degraded_threshold`

### 3. AMD-14 — Adapter Dependency Ordering → Doc 05

**Problem:** The Integration Runtime starts all adapters in ServiceLoader discovery order (effectively arbitrary). Some adapters have dependencies on others — for example, a Matter-over-Thread integration might depend on the Thread border router integration being initialized first. Without explicit dependency ordering, startup is non-deterministic and dependency-sensitive integrations may fail.

**Changes to Doc 05:**
- **IntegrationDescriptor modified** — new `dependsOn` field added (Set<String>). The Zigbee adapter example was updated to show `Set.of()` (no dependencies).
- **New §3.13** added:
  - **Topological sort via Kahn's algorithm:** At startup, the supervisor sorts all discovered integrations by their `dependsOn` declarations using Kahn's algorithm to produce a valid initialization order.
  - **Cycle detection:** If the dependency graph contains a cycle, all integrations in the cycle transition to FAILED with a `dependency_cycle` error. Non-cyclic integrations proceed normally.
  - **Dependency failure propagation:** If integration B depends on A and A fails to start, B transitions to SUSPENDED with `dependency_failed` reason. B does not attempt initialization.
  - **Shutdown ordering:** Shutdown proceeds in reverse topological order — dependents stop before their dependencies.
  - **Validation at load time:** Missing dependencies (declared but not discovered via ServiceLoader) generate a WARNING and are treated per configuration (`treat_missing_dependency_as`: default WARNING, can be set to FAIL).
- **§9 Configuration** — added dependency config: `dependency.startup_timeout_seconds` (default: 120), `treat_missing_dependency_as` (WARNING or FAIL)

### 4. AMD-13 — Configuration Migration Framework → Doc 06

**Problem:** Doc 06 §14 (Future Considerations) mentioned configuration migration as a deferred concern. But the configuration system will be the first thing users encounter on upgrade. If the YAML schema changes between versions and there's no migration path, users face cryptic schema validation errors.

**Changes to Doc 06:**
- **New §3.7** added (between parse and schema validation in the config loading pipeline):
  - **ConfigMigrator interface:** Takes a config map and source version, returns a `MigrationResult` containing the transformed config and a list of `ConfigChange` records.
  - **MigrationResult/ConfigChange/ChangeType records:** `ChangeType` is an enum: RENAMED, REMOVED, ADDED, VALUE_CHANGED, TYPE_CHANGED. Each `ConfigChange` records the old path, new path, old value, new value, and a human-readable reason.
  - **Migration execution flow:** Migrations are sequential (v1→v2→v3...), applied between YAML parse and schema validation. The migrated config is then validated against the current schema.
  - **MigrationPreview:** A CLI command (`homesynapse config migrate --preview`) shows what changes would be applied without executing them.
  - **Backup before migration:** The config file is backed up before any migration runs.
  - **Testing contract:** Every ConfigMigrator implementation must have a round-trip test: apply migration, validate against target schema.
  - **Supersedes §14 entry:** The §14 future consideration is explicitly noted as superseded by this section.
- **§9 Configuration** — added migration config: `migration.auto_migrate` (default: true), `backup_retention` (default: 5)

### 5. AMD-16 — Secrets Store Backup → Doc 06

**Problem:** The secrets store (§3.4) uses an encrypted file (`secrets.enc`). If this file is corrupted or accidentally deleted, all secrets (integration API keys, credentials) are permanently lost. There's no recovery path.

**Changes to Doc 06:**
- **§3.4 updated** — per-operation backup text added:
  - Before every `set` or `delete` operation, the secrets store creates a backup copy: `secrets.enc.bak.{N}` with 5-rotation (keeps the last 5 backups, rotates oldest out).
- **Recovery CLI added:**
  - `homesynapse secrets list-backups` — shows available backup files with timestamps and sizes
  - `homesynapse secrets restore --backup N` — restores from backup N after validation (decryption check before overwrite)
- **§6.9 (Recovery)** updated to reference the backup rotation as the recovery mechanism for secrets corruption.
- **§9 Configuration** — added secrets_backup config: `secrets_backup.max_backups` (default: 5)

### 6. AMD-07 — Route Health Monitoring → Doc 08

**Problem:** Zigbee mesh routing is invisible. When a device's route degrades (parent node moves, interference increases), commands start failing but the system has no mechanism to detect, diagnose, or recover from routing problems. The user sees "device not responding" with no explanation.

**Changes to Doc 08:**
- **New §3.15** added:
  - **RouteHealth record:** Tracks per-device route status with `RouteStatus` enum: HEALTHY, DEGRADED, UNREACHABLE.
  - **Command-failure-triggered recovery:** After 3 consecutive command failures to a device, the route is marked DEGRADED, a `route_degraded` event is emitted, and the adapter initiates a `NWK_addr_req` to discover a new route.
  - **Device unreachable:** After 10 consecutive failures, the device is marked UNREACHABLE, a `device_unreachable` event is emitted, and the device's availability is set to UNAVAILABLE.
  - **Weak-link analysis:** On periodic topology scans, the adapter identifies "weak links" — relay nodes that appear in a disproportionate number of routes (above configurable threshold). These are flagged in health reports to help users optimize their mesh.
  - **Coordinator exclusion:** The Zigbee coordinator is excluded from route health tracking (it's always directly connected).
- **§9 Configuration** — added route_health config (both inline in §3.15 and in the YAML block): `failure_threshold` (3), `max_failures_before_offline` (10), `weak_link_threshold_pct` (40), `health_degraded_device_count` (3)

### 7. AMD-08 — Idempotency Keys → Doc 09

**Problem:** The REST API's command endpoint (POST /devices/{id}/commands) has no idempotency protection. If a client's request times out and the client retries, the command may execute twice. For "turn on light" this is harmless, but for "toggle light" or "set brightness to X" with rate-limited devices, double execution causes incorrect behavior.

**Changes to Doc 09:**
- **§3.4 updated** — idempotency key support added to command endpoint:
  - **Optional `Idempotency-Key` header:** Clients may include this header on POST /devices/{id}/commands. If present, the server checks an in-memory LRU cache before executing.
  - **LRU cache:** 10,000 entries, 24-hour TTL. Stored as `IdempotencyEntry` records (key, response status, response body hash, timestamp).
  - **Conflict detection:** If a request arrives with an `Idempotency-Key` that matches an in-progress request with different parameters, the server returns 409 Conflict with problem type `idempotency-key-conflict`.
  - **`idempotency_key` on command_issued event:** When an idempotency key is provided, it's recorded on the event for forensic tracing.
- **Problem type table updated** — added two new entries:
  - `idempotency-key-conflict` — 409, "A different request with this idempotency key is already in progress"
  - `device-orphaned` — 422, "Device is orphaned (owning integration removed)" (cross-reference to AMD-17)
- **§9 Configuration** — added idempotency config: `idempotency.max_cache_size` (10000), `ttl_hours` (24), `max_key_length` (256)

### 8. AMD-15 — Correlation ID in Error Responses → Doc 09

**Problem:** Error responses don't include a correlation ID. When a user reports "I got a 500 error," there's no way to trace the error back through the event log, JFR recordings, or structured logs without the correlation ID that links all related operations.

**Changes to Doc 09:**
- **Error JSON examples updated** — `correlation_id` field added to both error response examples in §3.8.
- **AMD-15 specification text** added after error examples:
  - `correlation_id` is an extension member present in ALL RFC 9457 error response bodies.
  - `X-Correlation-ID` response header is present on ALL responses (success and error).
  - Auto-generated ULID when the client doesn't provide an `X-Correlation-ID` request header.
  - This ensures every API interaction is traceable through the event bus, JFR, and structured logs.

### 9. AMD-09-RL — Rate Limiting Table → Doc 10

**Status:** Confirmed pre-applied during Part 1 (Round 8–9, before Doc 10 was locked). **Skipped** — no changes needed.

### 10. AMD-05 — daily_bytes_written Metric → Doc 11

**Problem:** The observability system monitors CPU, memory, and event throughput, but not disk write volume. On an NVMe SSD with a fixed TBW (Total Bytes Written) endurance rating, sustained high write rates reduce the drive's lifespan. An anomalous write amplification bug or misconfigured retention policy could wear out the SSD years earlier than expected, and the operator would have no warning.

**Changes to Doc 11:**
- **§3.5 metric table updated** — `daily_bytes_written` added to the Persistence row.
- **Detailed description** added after the §3.5 table:
  - Collection method: reads `/proc/diskstats` hourly (specifically the write_sectors counter for the data partition), computes delta since last sample.
  - Daily reset: at midnight local time, emits a JFR `DailyWriteTotal` event with the cumulative value, then resets the counter.
  - **Health threshold:** If `daily_bytes_written` exceeds 10 GB/day (configurable), the Persistence subsystem reports DEGRADED health. At 10 GB/day, a 150 TBW NVMe SSD lasts 40+ years — the threshold is conservative but catches anomalous write amplification.
- **§9 Configuration** — added storage monitoring config: `storage.daily_write_warn_bytes` (default: 10737418240), `collection_interval_minutes` (default: 60)

### 11. PROJECT_STATUS.md — Round 11 Entry

- Updated document status rows for Docs 02, 03, 05, 06, 08, 09, 11 with Round 11 amendment application notes.
- Added comprehensive Round 11 cross-audit history entry detailing all 10 applied amendments + 1 pre-applied confirmation.
- Verified cross-document consistency: AMD-11 staleness model (Doc 03 §3.8) and AMD-17 orphan lifecycle (Doc 02 §3.15) both reference the same stale:true mechanism. AMD-17's `device_orphaned` error was confirmed present in Doc 09's problem type table.

---

## Part 4 — Session 2: Archive, Status Update, Doc 12 Prompt

### 4a — Critical Design Review Archive

**Created:** `research/Critical_Design_Review_Docs_01_11_v1.md` (11.5 KB)

A permanent decision record with 7 sections:

1. **Review Methodology** — How the review was conducted (fresh-perspective adversarial analysis), what it was cross-referenced against (Invariants, LTDs, MVP, Portability Architecture), and the core question ("If I implement exactly what this document says, what breaks?").

2. **Findings Summary by Tier** — Original reviewer classification (6 BLOCKING, 10 REQUIRED, 8 RECOMMENDED) vs. Nick's reclassification (4 BLOCKING, 9 REQUIRED, 9 RECOMMENDED, 2 rejected). Three systemic themes identified:
   - **Theme 1 — Boundary Contracts:** Gaps at subsystem interfaces where two documents each assumed the other specified the contract.
   - **Theme 2 — Production Resilience:** Missing failure modes, recovery paths, and operational safety nets.
   - **Theme 3 — API Stability:** Client-facing contracts that would break backward compatibility if changed after Phase 3.

3. **Final Amendment Disposition** — Full table of all 24 amendments with their original classification, final classification, and target documents.

4. **Amendment Application Record** — Session-by-session accounting of when and where each amendment was applied:
   - Session 1, Parts 1–2: Rounds 8–10 (pre-lock work + 4 BLOCKING)
   - Session 2, Parts 3–4: Round 11 (11 REQUIRED, 10 applied + 1 pre-applied)

5. **Cross-Document Consistency Verification** — Confirmation that amendments touching multiple documents were consistent (AMD-11/AMD-17 stale mechanism, AMD-04 cascade depth in Doc 01 + Doc 07, AMD-08/AMD-15 in Doc 09).

6. **Impact Assessment** — 8 of 11 documents modified. Docs 01, 03, 07 received the most changes. Docs 04 and 10 were unchanged (Doc 04 had no identified gaps; Doc 10's amendment was pre-applied).

7. **RECOMMENDED Amendments Integration Opportunities** — AMD-22 (HealthChangeListener) and AMD-18 (causal chain timeout extension) identified as natural candidates for integration during Doc 12 drafting.

### 4b — PROJECT_STATUS.md Comprehensive Update

**Multiple edits applied (in order):**

1. **Header updated** — Active documents now states "Doc 12 — Startup, Lifecycle & Shutdown (next to draft)." Critical design review noted as complete with all BLOCKING + REQUIRED amendments applied.

2. **Phase 1 Completion Plan rewritten:**
   - Progress summary: 11 of 14 documents locked.
   - Remaining work table: 4–5 sessions to Phase 1 completion.
     - Session 1: Apply U-01 through U-07, lock Docs 08/09 (~30 min mechanical)
     - Session 2: Draft Doc 12 (1 session, synthesis, no research)
     - Session 3: Cross-audit + lock Doc 12, begin Doc 13 research
     - Session 4: Draft Doc 13
     - Session 5: Draft Doc 14, cross-audit, Phase 2 transition
   - Critical path: Lock Docs 08/09 → Doc 12 → Doc 13 → Doc 14 → Phase 2 transition.

3. **Per-Document Workflow updated** — Doc 12, 13, 14 notes added with specific requirements (Doc 12: synthesis, HealthReporter + PlatformPaths interfaces; Doc 13: framework selection research needed; Doc 14: synthesis, master architecture).

4. **Pending Amendments section restructured** into three categories:
   - **Active (must apply before Doc 12 drafting):** U-01 through U-07 — upstream Dependents field updates for Docs 01–07 with section-level references from Docs 08/09. Table listing each amendment, target doc, and new dependents.
   - **Deferred (apply opportunistically):** A-01-DR-1 (event_category envelope field) + 9 RECOMMENDED review amendments. AMD-22 and AMD-18 flagged as Doc 12 integration candidates.
   - **Outside Phase 1:** Explicitly noted as not tracked here.

5. **Round 10–11 Summary** added to Cross-Audit History — A single narrative paragraph summarizing the entire critical design review cycle (24 amendments, Nick's reclassification, 3 themes, 13 applied in Rounds 10–11 across 8 documents, 9 RECOMMENDED deferred).

6. **Research Strategy updated:**
   - Header status note: "Doc 10 and Doc 11 research and drafting are COMPLETE."
   - Doc 11 priority section marked: `~~Priority 1 — Doc 11: Observability & Debugging~~ COMPLETE — Locked 2026-03-09`
   - Doc 10 priority section marked: `~~Priority 2 — Doc 10: WebSocket API~~ COMPLETE — Locked 2026-03-09`
   - Research Sequencing Plan table: Doc 10 and Doc 11 rows struck through with COMPLETE markers.

7. **Known Design Gaps checked** — no changes needed; all identified gaps were addressed by the review amendments or explicitly deferred.

### 4c — Doc 12 Drafting Prompt

**Created:** `prompts/doc-12-drafting-prompt.md` (18.8 KB)

A self-contained prompt designed to be loaded into a fresh session with no prior context. Contains 10 sections:

1. **Document Identity** — Number, title, type (synthesis), nature (orchestrates when, not what).

2. **Dependencies** — All 11 locked design documents with specific dependency surfaces for Doc 12 (e.g., Doc 01 §3.4 subscription model, Doc 03 §3.1 replay-from-checkpoint, Doc 05 §3.3 supervisor lifecycle with 8-state machine, Doc 04 §3.1 first-run initialization).

3. **External Dependencies — Portability Architecture:**
   - HealthReporter interface (§7.1): 4 methods (reportReady, reportWatchdog, reportStopping, reportStatus), 3 implementations (SystemdHealthReporter, HttpHealthReporter, NoOpHealthReporter), tier mapping.
   - PlatformPaths interface (§7.2): 6 methods (binaryDir, configDir, dataDir, logDir, backupDir, tempDir), Tier 1 implementation (LinuxSystemPaths with FHS paths per LTD-13).
   - AdaptivePragmaConfig (§7.3): acknowledged, owned by Doc 04/Doc 14.

4. **Key Locked Technical Decision — LTD-13 (systemd):** Full systemd service unit specification (Type=exec, WatchdogSec=60, Restart=on-failure, MemoryMax=2G, ProtectSystem=strict). Doc 12 must define the application-side behavior satisfying these contracts.

5. **7 Key Design Questions:**
   - Q1: Initialization order (concrete phased sequence with ready gates)
   - Q2: HealthReporter integration (when to call reportReady, watchdog frequency, reportStopping trigger)
   - Q3: PlatformPaths bootstrap (implementation selection, permission errors, temp dir cleanup)
   - Q4: Startup readiness definition (per-subsystem criteria gating the next phase)
   - Q5: Graceful shutdown sequence (drain period, reverse dependency order, final checkpoint, WAL flush)
   - Q6: Crash recovery (post-crash state, crash detection, reconciliation pass from AMD-02)
   - Q7: AMD-14 coordination (integration dependency ordering at startup, failure propagation)

6. **RECOMMENDED Amendment Candidates:**
   - AMD-22 (HealthChangeListener): Natural fit — Doc 12 owns lifecycle that determines when health changes propagate.
   - AMD-18 (Causal chain timeout extension): Natural fit — Doc 12 coordinates Automation Engine and causal chain projection.
   - Decision flagged: integrate if they fit scope, otherwise note in §15 Open Questions.

7. **Architecture Invariants** — 7 key INV-* citations relevant to Doc 12 (INV-CE-02 zero-config, INV-RF-04 crash safety, INV-PR-03 bounded resources, INV-ES-02 state from events, INV-TO-01 observable behavior, INV-TO-04 non-persistent debug, INV-ES-06 explainability).

8. **Scope Boundaries** — Explicit IN/OUT lists. IN: main() entry, initialization ordering, HealthReporter, PlatformPaths, readiness gates, graceful shutdown, crash recovery, watchdog thread, startup events, configuration. OUT: individual subsystem internal initialization, AdaptivePragmaConfig details, update/upgrade process, multi-instance coordination, container orchestration.

9. **Drafting Instructions** — 7 specific instructions including template compliance, synthesis-not-invention principle, §3 Architecture as the core section, §7 Interaction table being the largest, §8 Key Interfaces (4 interfaces), §10 Performance targets (cold start, warm start, drain time, heartbeat interval), and RECOMMENDED amendment evaluation guidance.

10. **Files to Load** — Complete list of every file the drafter needs (governance files, all 11 design docs, Portability Architecture research).

---

## Summary Statistics

| Metric | Value |
|---|---|
| Total amendments applied | 13 (4 BLOCKING + 9 REQUIRED) + 1 confirmed pre-applied |
| Design documents modified | 8 of 11 (Docs 01, 02, 03, 05, 06, 07, 08, 09, 11) |
| Documents unchanged | 3 (Doc 04, Doc 10, Doc 12–14 not yet started) |
| New architecture sections added | 11 (§3.2.1 in Doc 03, §3.7.1 in Doc 07, §3.8 in Doc 03, §3.13 in Doc 05, §3.7 in Doc 06, §3.15 in Doc 02, §3.15 in Doc 08, plus specification text in Docs 09 and 11) |
| New configuration blocks added | 10 (one per amendment that added runtime-configurable behavior) |
| New records/types introduced | RouteHealth, RouteStatus, ConfigMigrator, MigrationResult, ConfigChange, ChangeType, IdempotencyEntry, MigrationPreview |
| New events introduced | state_stale, state_stale_cleared, route_degraded, device_unreachable, system.reconciliation_completed, DailyWriteTotal (JFR) |
| New problem types added | idempotency-key-conflict (409), device-orphaned (422) |
| New artifacts created | 3 (archive, Doc 12 prompt, prompts/ directory) |
| PROJECT_STATUS.md edits | ~15 distinct edits across both sessions |
| Errors encountered | 1 no-op edit (identical old/new text), caught and corrected |
| Amendments rejected | 2 (AMD-01, AMD-06) |
| Amendments deferred | 9 RECOMMENDED + 1 deferred (A-01-DR-1) |

---

## What Happens Next

1. **Next session:** Apply U-01 through U-07 (upstream Dependents field updates to Docs 01–07). Lock Docs 08 and 09. ~30 minutes mechanical work.
2. **Following session:** Draft Doc 12 using the generated prompt (`prompts/doc-12-drafting-prompt.md`). Pure synthesis, no research needed. Evaluate AMD-22 and AMD-18 for integration.
3. **Then:** Doc 13 (framework selection research needed), Doc 14 (synthesis), Phase 2 transition.

---

*This synopsis was generated at the conclusion of the critical design review amendment application cycle. It serves as a permanent record of what was changed, in what order, and why.*
