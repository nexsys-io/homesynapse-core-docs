# HomeSynapse Core — Design Document Template

**Document type:** Governance
**Status:** Canonical — all subsystem design documents must follow this template
**Effective date:** 2026-02-19
**Owner:** nick@nexsys.io

---

## 0. About This Template

This template defines the standard structure for HomeSynapse Core subsystem design documents. Every design document produced during Phase 1 (System Design Documentation) must conform to this template. The template enforces consistent depth, traceability, and reviewability across all subsystems.

### 0.1 How to Use This Template

Copy the document skeleton in §2 for each new subsystem design. Sections marked **[MANDATORY]** must appear in every design document. Sections marked **[CONDITIONAL]** are included only when relevant to the subsystem — the conditions for inclusion are noted. Sections marked **[OPTIONAL]** may be included at the author's discretion when they add clarity.

Authoring guidance appears in `{curly braces}` throughout the skeleton. Remove all guidance text when writing the actual document — the final document should contain only the design content, not the template instructions.

### 0.2 Relationship to Other Artifacts

| Artifact | Relationship |
|---|---|
| Master Architecture Document | Synthesizes all subsystem designs into a coherent whole. Written last. |
| Phase 2 Interface Specs | Expand the "Key Interfaces" section (§2.12) into full method signatures and JavaDoc contracts. |
| Phase 3 Tests and Code | Implement against the interfaces and contracts defined in Phase 2. |
| DAS v1 Specification | Governs how these design docs are eventually published as explanation pages on homesynapse.com. |

### 0.3 Document Lifecycle

Every design document passes through four states:

| Status | Meaning | Who can change it |
|---|---|---|
| **Draft** | Under active design discussion. Content may change substantially. | Author during design sessions. |
| **Review** | Design is believed complete. Open for architecture review. | Author moves to Review when all sections are filled and open questions are either resolved or explicitly deferred. |
| **Locked** | Design decisions in this document are finalized. Changes require a formal revision with justification. | Locked after architecture review is complete and all blocking open questions are resolved. |
| **Superseded** | A newer version of this document exists. This version is retained for historical reference. | When a locked document requires substantial revision, the new version supersedes the old one. |

---

## 1. Template Rules

### 1.1 Mandatory Metadata

Every design document begins with a metadata header. All fields are required.

```
# HomeSynapse Core — {Subsystem Name}

**Document type:** Subsystem design
**Status:** {Draft | Review | Locked | Superseded}
**Subsystem:** {Name of the subsystem}
**Dependencies:** {List of subsystem designs this document depends on, or "None" if foundational}
**Dependents:** {List of subsystem designs that depend on this document, or "None yet" if unknown}
**Author:** HomeSynapse Core Architecture
**Date:** {ISO 8601 date of last substantive revision}
```

### 1.2 Dependency Rules

The **Dependencies** field lists every other design document whose decisions this document assumes or builds upon. If a dependency document changes a decision that this document relies on, this document must be reviewed for impact.

The **Dependents** field lists design documents that reference this one. This field is updated as new documents are written — it enables impact analysis when a design changes.

Example:
```
**Dependencies:** Event Model & Event Bus (§2 envelope, §3 type taxonomy, §5 subscription model)
**Dependents:** Automation Engine (trigger model), REST API (event history endpoints)
```

Dependencies should cite the specific sections they depend on. This makes impact analysis precise rather than requiring a full re-read.

### 1.3 Cross-Reference Format

When referencing another design document, use this format:

> See **Event Model & Event Bus** §5.3 (Subscription Model) for the filter specification.

When referencing a decision within the same document:

> This follows from the isolation requirement established in §3.2.

### 1.4 Decision Recording

Every significant design decision must appear in the **Summary of Key Decisions** table (§2.16). A "significant decision" is one where:

- A reasonable alternative existed
- The choice constrains downstream designs
- Changing the decision later would require non-trivial rework

Each decision records the choice made and the reasoning. This table is the first thing a reviewer reads to understand the document's stance.

### 1.5 Open Questions

Unresolved design questions are captured explicitly in the **Open Questions** section (§2.15). An open question must include:

- A clear statement of the question
- The options under consideration (if known)
- What information or experience is needed to resolve it
- Whether it blocks the document from moving to Locked status

A document can move to Locked status with open questions, but only if those questions are explicitly marked as **non-blocking** — meaning the document's locked decisions remain valid regardless of how the open question is resolved.

---

## 2. Document Skeleton

Everything below this line is the skeleton to copy for each new design document. Authoring guidance is in `{curly braces}`.

---

```markdown
# HomeSynapse Core — {Subsystem Name}

**Document type:** Subsystem design
**Status:** Draft
**Subsystem:** {Subsystem name}
**Dependencies:** {List with specific section references, or "None"}
**Dependents:** {List, or "None yet"}
**Author:** HomeSynapse Core Architecture
**Date:** {YYYY-MM-DD}

---

## 0. Purpose

{MANDATORY. One to three paragraphs.

State what this subsystem is, what role it plays in HomeSynapse Core,
and why it exists as a distinct subsystem. Identify the specific
problem this subsystem solves.

Do not motivate HomeSynapse itself here — that context exists in the
project prompt and the About document. Focus on why this specific
subsystem is necessary and what would go wrong if it did not exist
or were designed poorly.}

---

## 1. Design Principles

{MANDATORY. Three to six principles.

State the principles that govern design decisions within this
subsystem. These should be specific to this subsystem, not
repetitions of HomeSynapse's top-level principles. Each principle
should directly inform at least one decision later in the document.

Format: Bold principle name, followed by a one-to-three sentence
explanation. If a principle derives from a top-level HomeSynapse
principle, state the connection briefly.

Example:
**Derived state is always rebuildable.** If the state store is
lost, replaying the event log from the last checkpoint reconstructs
it completely. This is the subsystem-level expression of HomeSynapse's
"events first, state second" principle.}

---

## 2. Scope and Boundaries

{MANDATORY. Define what this subsystem is responsible for AND what
it is explicitly not responsible for.

This section prevents scope creep and clarifies ownership boundaries
between subsystems. Use two subsections:

### 2.1 This Subsystem Owns
- {Bulleted list of responsibilities}

### 2.2 This Subsystem Does Not Own
- {Bulleted list of things that might seem like they belong here but
  are owned by another subsystem. Name the owning subsystem.}

Example:
### 2.1 This Subsystem Owns
- Materialized view of current device states
- Checkpoint creation and management
- State query API for other subsystems

### 2.2 This Subsystem Does Not Own
- Durable event storage — owned by the Persistence Layer
- Event subscription and delivery — owned by the Event Bus
- Device capability definitions — owned by the Device Model}

---

## 3. Architecture

{MANDATORY. The core of the design.

This section describes how the subsystem works. Structure it as
needed for the subsystem — there is no fixed internal format. Use
subsections liberally.

Typical content includes:
- An architectural diagram showing the subsystem's components and
  their relationships (ASCII art is fine — clarity over aesthetics)
- The subsystem's position within the larger HomeSynapse architecture
  (what it receives from, what it sends to)
- Internal component breakdown
- Data flow through the subsystem
- Key algorithms or processing models
- Concurrency and threading model (if applicable)

Every claim about behavior should be specific enough to be testable.
"The state store handles events efficiently" is not a design
statement. "The state store processes events sequentially per entity,
using a single virtual thread per entity stream" is.}

---

## 4. Data Model

{CONDITIONAL. Include when the subsystem defines, owns, or transforms
data structures that other subsystems consume.

Define the schemas, record types, or data shapes that this subsystem
introduces. Use JSON examples for serialized formats and Java
type signatures for in-memory representations.

If this subsystem consumes data structures defined elsewhere, reference
them — do not redefine them.

Example content:
- State record schema
- Checkpoint format
- Index structures
- Query result shapes}

---

## 5. Contracts and Invariants

{MANDATORY. The most important section for downstream consumers.

List every invariant that this subsystem guarantees. An invariant is
a property that is always true during correct operation. Invariants
are the basis for downstream designs and for test cases.

Also list the contracts this subsystem offers to its consumers — the
promises it makes about behavior, ordering, durability, latency, etc.

Format each as a bold statement followed by a brief explanation.

Example:
**State is always consistent with the event log up to the last
processed sequence number.** If the state store reports that a
device's brightness is 80%, there exists an event in the log with
that value, and no subsequent event for that entity has changed it.

**Checkpoint creation never blocks event processing.** Checkpoints
are created asynchronously. The state store continues processing
new events while a checkpoint is being written.}

---

## 6. Failure Modes and Recovery

{MANDATORY. Enumerate the ways this subsystem can fail and how it
recovers (or how the system degrades gracefully).

For each failure mode, describe:
- What triggers it
- What the user-visible impact is
- How the subsystem recovers (or how manual intervention works)
- What events are produced to record the failure

This section is directly tied to HomeSynapse's "reliability over
cleverness" principle. If a failure mode is not documented here,
it is not designed for.

Common failure modes to consider:
- Process crash / unexpected restart
- Corrupt or missing data
- Resource exhaustion (memory, disk, CPU)
- Dependency failure (a subsystem this one depends on is unavailable)
- Slow or stalled operations
- Invalid input from another subsystem or integration}

---

## 7. Interaction with Other Subsystems

{MANDATORY. Define how this subsystem communicates with every other
subsystem it touches.

For each interaction, specify:
- Direction (this subsystem calls X, or X calls this subsystem)
- Mechanism (method call, event subscription, shared interface)
- What data flows across the boundary
- Any ordering or timing constraints

Use a table or diagram if the interaction count is high.

Example:

| Subsystem | Direction | Mechanism | Data |
|---|---|---|---|
| Event Bus | Receives from | Event subscription | All device.* and automation.* events |
| REST API | Called by | State query interface | Current device states, entity registry |
| Persistence | Calls | Checkpoint write | Serialized state snapshot |}

---

## 8. Key Interfaces

{MANDATORY. Define the public interfaces that this subsystem exposes.

For Phase 1, this is interface-level: interface names, their
responsibilities, and the subsystem boundary they serve. Full method
signatures are deferred to Phase 2.

Use a table listing each interface and its responsibility, followed
by brief notes on the most important interface methods (name and
purpose, not full signatures).

Also list the key types (records, enums, sealed interfaces) that
this subsystem introduces.

### 8.1 Interfaces

| Interface | Responsibility |
|---|---|
| `StateStore` | Query current state, process events, create checkpoints |
| `StateQuery` | Read-only view for API and UI consumers |

### 8.2 Key Types

| Type | Kind | Responsibility |
|---|---|---|
| `DeviceState` | Record | Current state of a single device entity |
| `StateCheckpoint` | Record | Snapshot metadata for a checkpoint |}

---

## 9. Configuration

{MANDATORY. Define all configuration knobs for this subsystem.

Provide the YAML configuration block with all options, their types,
defaults, and valid ranges. Every option must have a sensible default
— HomeSynapse must run correctly with zero configuration for this
subsystem.

Include a brief rationale for each option explaining when and why
a user would change it from the default.

Example:

```yaml
state_store:
  checkpoint_interval_minutes: 15   # How often to snapshot state
  max_entities_in_memory: 10000     # Evict least-recently-accessed beyond this
  rebuild_on_startup: false         # Force full replay on next start
```}

---

## 10. Performance Targets

{MANDATORY. Quantitative targets for this subsystem's performance on
the primary deployment target (Raspberry Pi 4, 4GB RAM).

Every target must be:
- Measurable (a number, not "fast" or "efficient")
- Justified (why this number, and what breaks if it is not met)
- Testable (a benchmark or test can verify it)

Use a table:

| Metric | Target | Rationale |
|---|---|---|
| Event processing latency (p99) | < 5ms | Automation triggers must react within ... |}

---

## 11. Observability

{MANDATORY. Define how this subsystem makes its behavior visible.

Three categories:

### 11.1 Metrics
List every metric this subsystem exposes, with name, type (counter,
gauge, histogram), and labels.

### 11.2 Structured Logging
Describe the key log events this subsystem produces and what fields
they include.

### 11.3 Health Indicator
Define the health states this subsystem reports and the conditions
that trigger each state. This feeds into the system health API and
the observability UI.}

---

## 12. Security Considerations

{CONDITIONAL. Include when the subsystem handles sensitive data,
exposes an external interface, or makes trust decisions.

Address:
- What data this subsystem accesses and whether any of it is sensitive
- Trust boundaries (who can call this subsystem's interfaces)
- Input validation requirements
- Any authentication or authorization concerns

For subsystems with no meaningful security surface (e.g., an internal
state store with no external interface), this section may be replaced
with a one-sentence statement: "This subsystem has no direct external
interface. Access control is enforced by the subsystems that consume
it (see §7)."}

---

## 13. Testing Strategy

{MANDATORY. Define how this subsystem will be tested.

Categories:

### 13.1 Unit Tests
What can be tested in isolation, without other subsystems running.
Identify the key test scenarios.

### 13.2 Integration Tests
What requires multiple subsystems to be present. Identify the
integration boundaries being tested.

### 13.3 Performance Tests
What benchmarks will verify the performance targets in §10.

### 13.4 Failure Tests
What tests will verify the failure modes and recovery behaviors
described in §6. These are among the most important tests in
the system.}

---

## 14. Future Considerations

{OPTIONAL. Design decisions that are intentionally deferred past MVP
but should be kept in mind to avoid painting ourselves into a corner.

This section is for "we are not building this now, but the design
must not prevent us from building it later." Each item should state
what the future capability is, why it is deferred, and what aspect
of the current design accommodates it.

Example:
**Distributed state replication.** MVP runs as a single instance.
Future versions may support active-passive replication for high
availability. The state store's checkpoint format is designed to be
transferable — a checkpoint can be shipped to another instance and
used as a starting point for replay. This is not implemented in MVP,
but the checkpoint schema deliberately avoids instance-specific
references.}

---

## 15. Open Questions

{MANDATORY. Every unresolved design question is captured here.

Format each as a numbered item with:
- The question
- Options under consideration (if known)
- What information is needed to resolve it
- Blocking status: [BLOCKING] or [NON-BLOCKING]

A [BLOCKING] question must be resolved before the document moves to
Locked status. A [NON-BLOCKING] question can remain open — the
document's locked decisions are valid regardless of how it is resolved.

Example:
1. **Should the state store support pluggable storage backends?**
   Options: (a) Yes, abstract behind an interface from the start;
   (b) No, hard-code the in-memory implementation and abstract later
   if a second backend is needed.
   Needed: Clarity on whether any MVP deployment scenario requires
   non-memory state storage.
   Status: [NON-BLOCKING] — the in-memory implementation ships
   regardless; the question is whether to add the abstraction now.}

---

## 16. Summary of Key Decisions

{MANDATORY. A table summarizing every significant design decision in
this document.

This table is the executive summary of the design. A reviewer should
be able to read this table and understand the document's stance
without reading the full text. Each decision references the section
where it is discussed in detail.

| Decision | Choice | Rationale | Section |
|---|---|---|---|
| Ordering model | Per-entity sequences | Avoids global bottleneck on constrained hardware | §3.2 |
| ... | ... | ... | ... |}

---

*This document is part of the HomeSynapse Core Phase 1 design
documentation. It is governed by the Design Document Template and will
be reviewed during architecture review.*
```

---

## 3. Section Reference

Quick reference for which sections are mandatory, conditional, or optional:

| # | Section | Status | Condition for Inclusion |
|---|---|---|---|
| 0 | Purpose | MANDATORY | — |
| 1 | Design Principles | MANDATORY | — |
| 2 | Scope and Boundaries | MANDATORY | — |
| 3 | Architecture | MANDATORY | — |
| 4 | Data Model | CONDITIONAL | Subsystem defines, owns, or transforms data structures |
| 5 | Contracts and Invariants | MANDATORY | — |
| 6 | Failure Modes and Recovery | MANDATORY | — |
| 7 | Interaction with Other Subsystems | MANDATORY | — |
| 8 | Key Interfaces | MANDATORY | — |
| 9 | Configuration | MANDATORY | — |
| 10 | Performance Targets | MANDATORY | — |
| 11 | Observability | MANDATORY | — |
| 12 | Security Considerations | CONDITIONAL | Subsystem handles sensitive data, exposes external interface, or makes trust decisions |
| 13 | Testing Strategy | MANDATORY | — |
| 14 | Future Considerations | OPTIONAL | — |
| 15 | Open Questions | MANDATORY | — |
| 16 | Summary of Key Decisions | MANDATORY | — |

---

## 4. Quality Checklist

Before moving a design document from Draft to Review, verify:

**Completeness:**
- [ ] All MANDATORY sections are present and substantive (not placeholder text)
- [ ] All CONDITIONAL sections are either included (with content) or explicitly excluded (the condition is not met)
- [ ] Dependencies list specific section references, not just document names
- [ ] Every principle in §1 is referenced by at least one decision in §16
- [ ] Every interface in §8 is referenced by at least one interaction in §7

**Precision:**
- [ ] Every behavioral claim is specific enough to write a test against
- [ ] Performance targets are quantitative with units and deployment context
- [ ] Configuration options have types, defaults, and valid ranges
- [ ] Failure modes describe trigger, impact, recovery, and event production

**Traceability:**
- [ ] Every decision in §16 has a rationale that references a principle or constraint
- [ ] Cross-references to other design documents cite specific sections
- [ ] Open questions state what information is needed to resolve them
- [ ] Blocking vs. non-blocking status is assigned to every open question

**Consistency:**
- [ ] Terminology matches the vocabulary in VoiceAndToneGuidelines.md §4.1
- [ ] Event types referenced match the taxonomy in Event Model & Event Bus §3
- [ ] Interface names follow HomeSynapse naming conventions
- [ ] Configuration YAML follows HomeSynapse configuration patterns

---

## 5. Naming Conventions

### 5.1 Document Files

Design documents are numbered in the order they are produced:

```
docs/design/
├── DESIGN_DOC_TEMPLATE.md              # This file
├── 01-event-model-and-event-bus.md
├── 02-device-model-and-capabilities.md
├── 03-state-store.md
├── 04-persistence-layer.md
├── ...
└── 14-master-architecture.md
```

The number prefix reflects authoring order, not importance or dependency rank. The dependency graph (captured in each document's metadata) defines the actual relationships.

### 5.2 Section Numbering

Sections use flat numbering starting at 0 (Purpose). Subsections use dot notation (§3.1, §3.2). Do not nest deeper than two levels (§3.1.1 is not allowed — restructure the content instead).

### 5.3 Diagram Style

Diagrams use ASCII art for portability and version-control friendliness. Use box-drawing characters for structure and arrows for data flow:

```
┌──────────┐       ┌──────────┐
│ Producer │──────▶│ Consumer │
└──────────┘       └──────────┘
```

Diagrams should be readable in a monospaced font at 80 characters width. If a diagram requires more width, split it into multiple diagrams.

---

## 6. Review Process

### 6.1 Architecture Review

When a document moves to Review status:

1. All MANDATORY sections are complete
2. All [BLOCKING] open questions are resolved
3. The quality checklist (§4) is satisfied
4. The document is self-consistent and consistent with all dependency documents

### 6.2 Locking a Document

A document moves to Locked when:

1. Architecture review is complete
2. All feedback is addressed
3. No unresolved [BLOCKING] open questions remain
4. The **Dependents** field is updated with any documents written during review

### 6.3 Revising a Locked Document

If a locked design decision must change:

1. Create a new version of the document (do not edit the locked version in place)
2. State which decisions are changing and why
3. Perform impact analysis using the **Dependents** field — identify all downstream documents affected
4. Update downstream documents or flag them for review
5. The old version's status changes to Superseded

---

*This template is the canonical standard for all HomeSynapse Core subsystem design documents. It will be included in the HomeSynapse Core Claude project as a project file.*