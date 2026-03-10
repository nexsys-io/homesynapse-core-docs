# HomeSynapse Core — Context Architecture for LLM-Driven Development

**Document type:** Proposal (not locked — for Nick's review)
**Date:** 2026-03-10
**Author:** Hivemind
**Status:** Draft

---

## 0. The Problem This Solves

HomeSynapse Core has 14 locked design documents totaling ~15,000+ lines. Add governance artifacts, the Glossary, Locked Decisions Register, Architecture Invariants, and the MVP doc, and the total context corpus exceeds what any LLM agent can hold in a single session. Worse, this corpus will grow — Phase 2 adds interface specifications, Phase 3 adds test and implementation code.

The naive approach — "read everything relevant before working" — fails at scale. An agent writing the `StateProjection` implementation doesn't need the Zigbee coordinator transport protocol, but it absolutely needs the event envelope schema, the State Store design doc's §3.2 projection pipeline, and the LTD-03 SQLite PRAGMA configuration. Getting this scoping wrong causes two failure modes:

1. **Context starvation:** Agent doesn't have enough context → makes decisions that contradict locked architecture → produces code that needs to be rewritten.
2. **Context rot:** Agent reads stale or irrelevant documentation → wastes context window capacity → either hallucinates connections that don't exist or fails to complete the task within context limits.

The documentation strategy must solve: *what does each agent need to read, and when, to do correct work at minimum context cost?*

---

## 1. The Context Hierarchy

Every file in both repositories serves one of five context functions. The function determines where the file lives, how long it is, who reads it, and how often it changes.

### Level 0: Constitutional Context (read by every agent, every session)

**What:** The non-negotiable rules that apply to ALL work regardless of subsystem.

**Files:**
- `governance/HomeSynapse_Core_Locked_Decisions.md` — but NOT the full document. A **condensed reference** that lists each LTD number, its one-line decision, and the reversal criteria. The full rationale is only read when an agent needs to understand *why* a decision was made (rare during implementation).
- `governance/Architecture_Invariants_v1.md` — same treatment. A condensed index.
- `governance/phase-2-transition-guide.md` — version pins, copyright headers, licensing.
- The Glossary — but only the relevant section for the subsystem being worked on.

**Principle:** Constitutional context must fit in ~2,000 tokens. If it doesn't, it's too verbose. This is the context that prevents an agent from accidentally violating a locked decision. It needs to be scannable, not readable.

**Implementation:**

Create a `CONTEXT.md` file in the `homesynapse-core` repo root. This is the *single entry point* that every agent reads first. It is not a README (that's for humans). It is a machine-readable context primer:

```markdown
# HomeSynapse Core — Agent Context Primer

## Locked Technical Decisions (cite by LTD-NN)
- LTD-01: Java 21 LTS (Corretto 21.0.10.7.1). G1GC. -Xms512m -Xmx1536m.
- LTD-02: RPi 5 target, RPi 4 validation floor. NVMe required.
- LTD-03: SQLite WAL. synchronous=NORMAL. 128MB page cache. 1GB mmap.
- LTD-04: Typed ULID wrappers for all entity identifiers.
- LTD-05: Event sourcing. Events immutable. State derived.
- LTD-06: Per-entity sequences with global position.
- LTD-07: Jackson for JSON. SnakeYAML Engine for YAML.
- LTD-08: Publish-subscribe via in-process EventBus.
- LTD-09: Checkpoint-based recovery. WAL replay from checkpoint.
- LTD-10: Gradle with version catalogs. modules-graph-assert.
- LTD-11: Virtual threads for all I/O. Platform threads only for serial.
- LTD-12: Zigbee only in Tier 1. Via USB coordinator.
- LTD-13: jlink distribution. systemd lifecycle. MemoryMax=2G.
- LTD-14: Javalin for HTTP/WebSocket. Single embedded server.
- LTD-15: JFR for telemetry. Custom application events.
- LTD-16: SLF4J + Logback. Structured JSON logs.
- LTD-17: Integration adapters depend on integration-api only, never core/.
- LTD-18: Preact SPA for Web UI. Vite build. <150KB gzipped.

## Architecture Invariants (quick reference)
- INV-ES-*: Events are append-only, immutable, causally linked.
- INV-LF-*: Local-first. Internet enhances, never controls.
- INV-PD-*: Privacy by architecture. Data stays local by default.
- INV-RF-*: Crash isolation. Integration failure cannot crash core.
- INV-PR-*: Constrained hardware primary target. <512MB live heap.
- INV-CE-*: No forced upgrades. Graceful degradation.
- INV-EI-*: Energy intelligence built into core model.
- INV-SE-*: Auth required for all API access.
- INV-TO-*: Observable behavior. Every significant action traceable.

## Module Dependency Rules
- integration-zigbee → integration-api ONLY (never core/)
- core/ modules may depend on other core/ modules (no cycles)
- platform-api has zero HomeSynapse dependencies
- homesynapse-app depends on everything (assembly module)
- Enforced by modules-graph-assert + ArchUnit + JPMS

## Code Rules
- Java 21. No preview features. Records, sealed interfaces, pattern matching.
- Virtual threads for all I/O except serial (platform thread).
- Javadoc on every public method: preconditions, postconditions, exceptions.
- @see link to design doc section for every public interface.
- Copyright header on every file (Spotless enforced).
- -Xlint:all -Werror. No warnings.
```

This fits in ~800 tokens. Every agent reads it. It prevents the most common errors.

### Level 1: Module Context (read by agent working on a specific module)

**What:** The specific contracts, types, and constraints for the module being worked on.

**Implementation:** Each Gradle module gets a `MODULE_CONTEXT.md` in its root:

```
core/event-model/MODULE_CONTEXT.md
core/device-model/MODULE_CONTEXT.md
integration/integration-api/MODULE_CONTEXT.md
...
```

This file contains:

1. **Design document reference:** Which design doc this module implements, which sections matter most.
2. **Upstream dependencies:** What this module depends on, and specifically which interfaces/types from upstream it consumes.
3. **Downstream consumers:** Who depends on this module, and what they expect from it.
4. **Key constraints:** The subset of LTDs and INVs that apply specifically to this module.
5. **Open questions / gotchas:** Anything that's been tricky or has a non-obvious constraint.

Example for `core/state-store/MODULE_CONTEXT.md`:

```markdown
# state-store — Module Context

## Design Document
Doc 03: State Store & State Projection (design/03-state-store-and-state-projection.md)
Key sections: §3.2 (projection pipeline), §3.3 (checkpoint schema), §3.8 (staleness model), §5 (external interfaces), §8 (key interfaces)

## Dependencies (upstream)
- event-model: EventEnvelope, DomainEvent, EventBus (subscriber), EventPriority
- device-model: EntityId, EntityType, AttributeValue, CapabilityInstance

## Consumers (downstream)
- rest-api: StateQueryService.getEntityState(), StateQueryService.queryEntities()
- websocket-api: StateQueryService (for snapshot on subscription)
- automation: StateQueryService.getSnapshot() for condition evaluation (AMD-03)
- observability: StateProjection health via HealthContributor

## Applicable Constraints
- LTD-05: State is derived from events, never independently persisted
- LTD-06: Per-entity sequences. StateProjection tracks per-entity position.
- LTD-09: Checkpoint-based recovery. StateProjection replays from checkpoint on startup.
- INV-ES-02: Same events → same state (deterministic projection)
- INV-PR-02: State queries < 5ms p99

## Gotchas
- Self-delivery skip: StateProjection produces state_changed events that must not re-enter its own projection. Mechanism: filter by event origin or subscriber ID. Phase 2 must define this.
- AMD-11 staleness: EntityState has staleAfter/stale fields. Staleness evaluation is lazy (on read) with passive 30-second scan. Don't over-engineer eager evaluation.
- AMD-02 reconciliation: REPLAY→LIVE transition includes reconciliation pass for in-flight state_reported events. See Doc 03 §3.2.1.
```

This is ~300 tokens per module. An agent working on state-store reads Level 0 (~800 tokens) + this module context (~300 tokens) + the actual source files it needs. Total overhead: ~1,100 tokens of context before it touches code. That's sustainable.

### Level 2: Interface Context (already exists as Javadoc)

**What:** The contract for a specific interface or type.

**Implementation:** This is the Javadoc on each public interface and type. It doesn't need a separate file — it lives in the code itself. The key is that Javadoc must be *complete enough to implement against without reading the design doc*.

A good test: can a Coder agent read the Javadoc for `EventPublisher` and write a correct implementation without opening the design doc? If yes, the Javadoc is sufficient. If no, the Javadoc is missing information.

The design doc is the *authority*. The Javadoc is the *working interface*. They must say the same thing, but the Javadoc is in the agent's immediate context (it's in the file being edited), while the design doc requires a separate read.

### Level 3: Task Context (ephemeral, per-session)

**What:** The specific task brief, coding instructions, or review criteria for this session's work.

**Implementation:** This is the task brief from the Hivemind → PM → Coder chain. It lives in the queue system (`context/queue/`). It is consumed and then archived. It never accumulates.

Critical properties:
- Task briefs cite specific sections of specific documents, not "read the design doc."
- Task briefs include the relevant excerpt from the design doc (the specific interface definition, the specific behavioral contract), so the Coder doesn't need to read the full document.
- Task briefs are self-contained: an agent should be able to do its work from Level 0 context + the task brief alone, with the MODULE_CONTEXT.md as backup for cross-module questions.

### Level 4: Historical Context (rarely read, exists for auditability)

**What:** Full design documents, research artifacts, cross-audit histories, amendment records.

**Implementation:** These are the existing files in `homesynapse-core-docs`. They are the source of truth but are NOT routine reading for any agent. An agent reads them when:
- It encounters a contradiction it can't resolve from Levels 0–3
- It needs to understand *why* a decision was made (not just what it is)
- A design doc amendment is being considered
- The Hivemind is doing strategic analysis

---

## 2. Context Freshness: Preventing Rot

Context rot happens when documentation says one thing but the code says another. The longer the project runs, the worse this gets. Here's the anti-rot strategy:

### 2.1 Single Source of Truth Principle

Every fact has exactly one canonical location. Other references point to it; they don't duplicate it.

| Fact | Canonical Location | References Point From |
|---|---|---|
| LTD decisions | `governance/HomeSynapse_Core_Locked_Decisions.md` | `CONTEXT.md` (condensed), MODULE_CONTEXT.md (subset) |
| Interface contracts | Javadoc on the interface (code repo) | Design doc §8 is the *authority*, Javadoc is the *working copy* |
| Configuration defaults | `gradle/libs.versions.toml` (versions), design doc §9 (semantics) | MODULE_CONTEXT.md references, JSON Schema validates |
| Type names | Glossary (canonical) | Code must match exactly |
| Module dependencies | `settings.gradle.kts` + `build.gradle.kts` (code-level truth) | MODULE_CONTEXT.md describes, modules-graph-assert enforces |

The key insight: **code is a source of truth too.** Once Phase 2 interfaces exist, the Javadoc on those interfaces becomes the working authority for implementation. The design doc remains the *architectural* authority, but if a Coder needs to know "what parameters does this method take," the answer is in the code, not the design doc.

### 2.2 Staleness Detection

| Mechanism | What It Detects | Frequency |
|---|---|---|
| Javadoc `@see` links | If a design doc section changes, which interfaces might be stale | On any design doc amendment |
| JSON Schema validation tests | If config defaults in code drift from schema | Every build |
| Glossary grep | If code uses non-canonical names | Weekly automated check |
| MODULE_CONTEXT.md review | If upstream/downstream relationships changed | At the start of each subsystem's Phase 3 work |
| `CONTEXT.md` version check | If LTDs or INVs were amended | On any governance artifact change |

### 2.3 What Gets Updated and When

| Event | What Updates |
|---|---|
| LTD amended | `CONTEXT.md` condensed line. Affected MODULE_CONTEXT.md files. |
| Design doc amended | Javadoc on affected interfaces (grep `@see`). MODULE_CONTEXT.md if contracts changed. |
| New module added | New MODULE_CONTEXT.md. Update CONTEXT.md module rules if needed. settings.gradle.kts. |
| Interface signature changed | Javadoc. Traceability matrix. Downstream MODULE_CONTEXT.md "Dependencies" section. |
| Configuration schema changed | JSON Schema file. Design doc §9 (canonical). MODULE_CONTEXT.md gotchas if behavior changes. |

### 2.4 What Explicitly Does NOT Get Updated

This is as important as what does. These are intentionally "set and forget":

- **Research artifacts** (`research/*.md`): These are historical records. They informed decisions but don't need maintenance. If someone reads them, they understand they reflect the state at time of writing.
- **Cross-audit histories** (in PROJECT_STATUS.md): Historical record. Never edited after the fact.
- **Phase 1 design docs** (once Phase 2 interfaces exist): The interfaces become the working authority. Design docs are amended only if the architecture changes — not for typos or clarifications that the Javadoc already handles.

---

## 3. Conciseness Rules

Every documentation file follows these constraints to prevent bloat:

### 3.1 CONTEXT.md (repo root)
- Maximum 100 lines.
- No prose explanations. Bullet points with identifiers.
- If a rule needs explanation, link to the source document.
- Updated only when LTDs, INVs, or module rules change.

### 3.2 MODULE_CONTEXT.md (per module)
- Maximum 50 lines.
- Five sections only: Design Doc Reference, Dependencies, Consumers, Constraints, Gotchas.
- Dependencies and Consumers list specific types/interfaces, not vague descriptions.
- Gotchas section: maximum 3 items. If there are more, the most dangerous ones win.
- Updated when the module's interfaces or dependencies change. Not updated for implementation details.

### 3.3 package-info.java (per package)
- Maximum 10 lines of Javadoc.
- One sentence: what this package is responsible for.
- Key types listed (3–5 maximum).
- One `@see` link to the MODULE_CONTEXT.md or design doc section.

### 3.4 Interface Javadoc
- Every public method documented. No exceptions.
- Preconditions, postconditions, exception semantics.
- Thread safety stated explicitly.
- `@see` to design doc section.
- NO implementation hints. The Javadoc describes the contract, not how to fulfill it.

### 3.5 Test class Javadoc
- One sentence: what behavioral contract this test class covers.
- `@see` to the interface being tested.
- Individual test methods use descriptive names (no Javadoc needed on test methods if the name is clear).

---

## 4. Agent Workflow: What Gets Read When

Here's the concrete workflow for each agent role, showing exactly what context they load:

### 4.1 Hivemind (strategic sessions with Nick)

```
Always read:
  - CONTEXT.md (Level 0, ~800 tokens)
  - governance/PROJECT_STATUS.md (current state, ~2000 tokens relevant sections)
  - Skill references (phase-guide.md, decision-framework.md, etc.)

Read on demand:
  - Specific design docs when analyzing cross-subsystem impact
  - Research artifacts when assessing new information
  - Revenue/strategy docs when evaluating product direction
```

### 4.2 PM (producing interface specs or coding instructions)

```
Always read:
  - CONTEXT.md (Level 0)
  - The task brief from Hivemind (Level 3)
  - MODULE_CONTEXT.md for the target module (Level 1)
  - The design doc sections cited in the task brief (Level 4, partial)

Read on demand:
  - MODULE_CONTEXT.md for upstream/downstream modules (when resolving cross-boundary types)
  - Glossary sections relevant to the subsystem
  - Traceability matrix for the subsystem
```

### 4.3 Coder (writing tests or implementation)

```
Always read:
  - CONTEXT.md (Level 0)
  - The coding instructions from PM (Level 3)
  - MODULE_CONTEXT.md for the target module (Level 1)
  - The interface source files being implemented (Level 2 — Javadoc IS the spec)

Read on demand:
  - Upstream module source files (when consuming their types/interfaces)
  - Test-support module (when writing tests)
  - build.gradle.kts (when adding dependencies)

Almost never read:
  - Full design documents (the coding instructions + Javadoc should suffice)
  - Research artifacts
  - Governance artifacts beyond CONTEXT.md
```

### 4.4 The Key Insight

The context loading for a Coder session implementing `StateProjection`:

| What | Tokens (approx) | Purpose |
|---|---|---|
| CONTEXT.md | ~800 | Don't violate LTDs or INVs |
| Coding instructions | ~500 | What to build, what tests to pass |
| MODULE_CONTEXT.md (state-store) | ~300 | Dependencies, constraints, gotchas |
| StateProjection.java (interface + Javadoc) | ~400 | The contract to implement |
| StateQueryService.java (interface) | ~200 | The query interface to satisfy |
| EntityState.java (record) | ~100 | The type being stored |
| EventEnvelope.java (from event-model) | ~200 | The input type |
| Existing test files | ~800 | The tests that must pass |
| **Total context overhead** | **~3,300** | |

That leaves the vast majority of the context window for the actual code being written. This is the target: **<4,000 tokens of documentation context per coding session.**

---

## 5. What This Means for the Scaffold

When we set up the `homesynapse-core` scaffold, we create:

1. `CONTEXT.md` — the agent context primer (Level 0).
2. Empty `MODULE_CONTEXT.md` in each Gradle module — populated during Phase 2 as interfaces are specified.
3. Convention plugin enforcing: copyright headers, compiler flags, Spotless.
4. The rest per transition guide §8.

The MODULE_CONTEXT.md files are the *Phase 2 deliverable that isn't code*. When the PM specifies interfaces for a module, they also write that module's context file. This ensures the Coder has everything they need before Phase 3 begins.

---

## 6. Long-Term Scalability

As the project grows (Tier 2 protocols, NexSys Energy, Companion app), the context architecture scales because:

- **CONTEXT.md grows slowly.** New LTDs add one line each. New module rules are rare.
- **MODULE_CONTEXT.md files are additive.** New modules get new files. Existing files only update when their contracts change.
- **Javadoc travels with the code.** No separate document to maintain.
- **Design docs become historical.** Once Phase 2 interfaces exist, the design docs are consulted for architectural questions, not daily implementation. Their staleness risk drops.
- **Task briefs are ephemeral.** They don't accumulate. Each session gets a fresh, scoped brief.

The danger zone is if someone starts putting implementation context into MODULE_CONTEXT.md (making it grow beyond 50 lines) or adding "helpful notes" to CONTEXT.md (making it grow beyond 100 lines). The line limits are governance constraints, not suggestions.

---

## 7. Decision Requested

Same as the main proposal — this context architecture is a subsection of the overall approach. The key decisions:

**F. CONTEXT.md format.** I proposed a condensed bullet-point format. Alternative: structured YAML that agents parse programmatically. My recommendation: markdown bullets, because agents handle markdown well and it's human-readable too.

**G. MODULE_CONTEXT.md ownership.** I proposed the PM writes these during Phase 2. Alternative: the Hivemind writes them as part of the task brief. My recommendation: PM, because the PM is the one who understands the interface contracts at the level of detail needed.

**H. Javadoc-as-authority vs. design-doc-as-authority.** This is a philosophical question. I proposed: design doc is the architectural authority, Javadoc is the working authority. If they conflict, the design doc wins — but the Javadoc should be updated to match. The alternative: design doc is always the sole authority, Javadoc is just a convenience. My recommendation: the dual-authority model, because in practice, once Phase 3 begins, agents will read Javadoc 100x more often than design docs. Making Javadoc authoritative for implementation questions reduces context loading and error rates.
