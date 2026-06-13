<!--
file: website/design-system/content-types-reference.md
purpose: Diataxis content types, format patterns, catalog entry type, audience routing for product documentation.
audience: docs contributors, PM
state-type: reference
status: DRAFT (reconciliation pending) -- imported 2026-06-12 from the Feb 2026 Website & Documentation (ChatGPT) project. Self-declared Locked/Canonical status SUSPENDED until reconciled with the ruled register rules (D-1..D-7, website/README.md), the R13-R16 copy guardrails, and current project state. Tracker: ./README.md
origin: authored Feb-Mar 2026; renamed from doc03.md at import (canonical name per research/2026-03-08_das-design-system-dependency-map.md)
-->

# HomeSynapse Content Types Reference



**Document type:** Governance

**Status:** Canonical — governs all content authored under `/docs/`

**Parent specification:** DAS v1 Specification, §3

**Effective date:** 2026-02-19

**Owner:** nick@nexsys.io



---



## 0. Purpose



This document defines the content types, format patterns, and routing rules that govern HomeSynapse documentation. Every page authored under `/docs/` must belong to exactly one content type and follow the structural expectations of a recognized format pattern within that type.



This document prevents two failure modes:



1. **Type drift** — content that blurs the line between tutorial and how-to, or between reference and explanation, making navigation unreliable.

2. **Format invention** — authors creating unnamed structural patterns ("guide," "overview," "getting started page," "FAQ") that do not fit the architecture and accumulate inconsistently.



If a piece of content does not fit a recognized format pattern, the content needs restructuring — not a new type.



---



## 1. The Four Content Types



HomeSynapse documentation uses the Diátaxis framework. All content falls into one of four types, distinguished by the reader's mode and the content's purpose.



| Type | Reader mode | Content purpose | Core question answered |

|---|---|---|---|

| **Tutorial** | Learning | Guided experience with a concrete outcome | "Can you teach me?" |

| **How-to** | Working | Task-oriented procedure for a specific goal | "How do I ___?" |

| **Reference** | Looking up | Complete, precise technical description | "What are the details of ___?" |

| **Explanation** | Studying | Discursive treatment of background and reasoning | "Why does ___ work this way?" |



A fifth structural type exists for the device/integration/plugin **catalog** (§3).



These types are enforced through directory structure, frontmatter (`content_type` field), templates, and Vale linting rules. The DAS v1 Specification §3 defines the enforcement mechanisms; this document defines the content rules.



### 1.1 The Boundary Rule



A page must not contain content that belongs to a different content type. If a tutorial needs to reference a configuration option, it links to the reference page — it does not reproduce the reference table. If a how-to guide needs to explain *why* a design decision was made, it links to the explanation page — it does not embed a rationale section.



Cross-references connect the types. Duplication blurs them.



---



## 2. Format Patterns



Each content type supports a set of named format patterns. A format pattern defines the expected structure, section order, and authoring constraints for a specific shape of documentation within its type.



Format patterns are not rigid templates — they are structural expectations. Authors adapt them to the content at hand. But every page should be recognizably an instance of one of these patterns.



### 2.1 Tutorial Formats (Learning-Oriented)



Tutorials exist to give the reader a successful learning experience. Every tutorial produces a concrete, visible outcome. The reader follows along and builds something real.



**Voice register:** B (Calm Neighbor), transitioning toward A (Senior Engineer) as complexity increases.



| Format | Purpose | When to use |

|---|---|---|

| **Quickstart** | First success with HomeSynapse | The reader has just installed HomeSynapse and needs to see it work. One short tutorial, one satisfying result. |

| **Guided build** | Build a specific thing step by step | "Build an automation," "Add a device," "Write your first plugin." Focused on a single deliverable. |

| **Learning path** | Sequenced series, each with a concrete outcome | Multi-tutorial progression. Each installment stands alone (produces its own outcome) and builds on the prior one. |



**Rules for all tutorials:**



- Must produce a concrete, visible outcome the reader can verify

- Must be completable by following the steps in order

- Must not assume prior knowledge beyond stated prerequisites

- Must use second person ("you") — the reader is doing the work

- Prerequisites are declared in frontmatter, not implied by sidebar order



**Additional rule for learning paths:**



- Each tutorial in the series must be independently completable — it produces a concrete outcome even if the reader has not completed earlier installments

- The prerequisite chain is declared explicitly in frontmatter (`prerequisites: [tutorials/lighting/first-light]`)

- A learning path index page lists the full sequence with descriptions and expected outcomes



### 2.2 How-To Formats (Task-Oriented)



How-to guides exist to help the reader accomplish a specific task. The reader arrives with a goal and leaves with the goal completed. How-to guides assume baseline competence — the reader knows what HomeSynapse is and has it running.



**Voice register:** A (Senior Engineer), with brief contextual framing at the top.



| Format | Purpose | When to use |

|---|---|---|

| **Task how-to** | General-purpose procedure | Any task that does not fit a more specific format below. Problem statement → prerequisites → numbered steps → verification. |

| **Troubleshooting how-to** | Diagnose and fix a specific problem | The reader observes a symptom and needs to identify the cause and resolve it. First-class format with a dedicated template (§2.2.1). |

| **Migration how-to** | Move from old to new | Version upgrades, breaking changes, deprecated features. Old state → new state, with compatibility notes and rollback. |

| **Operations how-to** | Runbook-style system procedure | Backup/restore, key rotation, log management, upgrades, health checks. Procedural, repeatable, safe to hand to someone unfamiliar. |

| **Security how-to** | Hardening and protective procedures | Firewall configuration, least-privilege setup, secrets management, TLS configuration. Steps are ordered by impact. |

| **Integration how-to** | Cross-cutting device/protocol tasks | Tasks that span multiple catalog entries or protocols. "Set up Zigbee for a multi-room deployment," "Configure MQTT bridging." Distinct from catalog entries, which are reference for a single integration. |



**Rules for all how-to guides:**



- Must state the specific problem or goal in the opening sentence

- Steps are numbered and actionable (each step changes system state)

- May assume the reader has HomeSynapse installed and running

- End with a verification step ("how to confirm it worked")

- Never explain *why* at length — link to the relevant explanation page



#### 2.2.1 Troubleshooting How-To (First-Class Format)



Troubleshooting pages are among the highest-traffic documentation pages. They follow a strict, standardized structure to ensure consistency and fast resolution.



**Required sections, in order:**



1. **Symptoms** — What the user observes. Error messages (exact text), unexpected behavior, UI state. Written from the user's perspective: "The device appears as 'unavailable' in the dashboard."



2. **Quick checks** — Fast eliminations before deeper diagnosis. These are yes/no checks that rule out the most common causes in under a minute. Presented as a short checklist.



3. **Root causes** — Ordered by likelihood (most common first). Each root cause is a named subsection with:

   - A brief description of *what* is wrong

   - **Fix steps** — numbered procedure specific to this root cause

   - The reader identifies their root cause and follows only that fix — they should not need to read all root causes sequentially



4. **Verification** — How to confirm the problem is resolved. A single procedure that works regardless of which root cause was the issue.



5. **Known limitations** — Edge cases, firmware constraints, version incompatibilities, or conditions where the fix does not apply. This section prevents duplicate issue filings and gives authors a place to document "this fix does not work if you are running firmware below 2.3."



6. **Escalation** — What to do if none of the above resolves the issue. Specifies exactly what logs, configuration, and environment details to gather before filing an issue. Includes a link to the issue template.



**Structural rule:** Fix steps are nested under their root cause, not presented as a single flat list. The user flow is: observe symptom → identify root cause → follow that specific fix → verify.



### 2.3 Reference Formats (Lookup-Oriented)



Reference documentation exists to be looked up, not read sequentially. It is complete, precise, and organized for fast retrieval. Reference pages are the source of truth for "what does this do?" and "what are the options?"



**Voice register:** A (Senior Engineer). Maximum precision.



| Format | Purpose | When to use |

|---|---|---|

| **Configuration reference** | Exhaustive schema documentation | Every configuration option, its type, default, constraints, and behavior. Generated from JSON Schema where possible. |

| **CLI reference** | Commands, flags, exit codes | Every CLI command with its subcommands, flags, argument types, and exit codes. One page per command group or one comprehensive page — decided by scope. |

| **API reference** | REST and WebSocket endpoint documentation | Generated from OpenAPI and AsyncAPI specs. Never handwritten. |

| **Error code reference** | Stable identifiers with causes and remediations | Every error code HomeSynapse can produce, organized by subsystem. Each entry: code, human-readable message, probable causes, remediation steps, related troubleshooting page. |

| **Glossary** | Canonical term definitions | Single page. Every domain-specific term used in HomeSynapse documentation, defined once. The seed of future translation memory. |



**Rules for all reference:**



- Must be complete for its declared scope — partial reference is worse than no reference

- Organized for lookup (alphabetical, by subsystem, by category) — never narrative

- Generated reference (API, config schema) is never hand-edited; fix the spec

- Handwritten reference pages are maintained by the subsystem owner and reviewed by the docs team

- Every reference page links to related how-to guides in a "See also" section



**Additional rule for generated reference:**



- Generated directories contain a `_GENERATED.md` sentinel file (see DAS v1 Specification §7.4)

- Handwritten content may link to generated pages but never duplicates or paraphrases their content

- If a concept needs narrative explanation, it belongs in an explanation page that cross-references the generated reference



### 2.4 Explanation Formats (Understanding-Oriented)



Explanation documentation exists to deepen understanding. It answers "why?" and "how does this fit together?" Explanations are discursive — they discuss, contextualize, and illuminate. They never contain procedures.



**Voice register:** A (Senior Engineer) or B (Calm Neighbor), depending on audience. Architecture and threat model explanations use Register A. Concept and rationale pages aimed at a broader audience may use Register B.



| Format | Purpose | When to use |

|---|---|---|

| **Concept / Mental model** | How HomeSynapse thinks about a domain | Introduces a conceptual framework: what events are, what "local-first" means in practice, how automations relate to the event log. The reader should leave with a mental model they can apply. |

| **Architecture** | Components, boundaries, invariants | System architecture, component relationships, data flow, isolation boundaries. Aimed at developers and advanced users who need to understand the structure. |

| **Rationale / Tradeoffs** | Why a specific design decision was made | "Why event sourcing?" "Why local-first?" "Why not cloud-native?" Presents the decision, the alternatives considered, and the tradeoffs accepted. This is the sanctioned home for "why we chose X over Y." |

| **Threat model / Security posture** | High-level security architecture | Attack surface, trust boundaries, threat categories, mitigations. Not procedural (procedures live in security how-to guides). This is the "how we think about security" document. |



**Rules for all explanations:**



- Must illuminate *why*, not *how*

- Must never contain numbered procedural steps — link to the relevant how-to

- May cross-reference any other content type

- Principles and rationale are stated once, clearly, in the appropriate explanation page — then other pages link to that explanation rather than restating the principle (Voice & Tone Guidelines §3)

- Explanation pages are the only place where extended discussion of design philosophy is appropriate



---



## 3. Catalog Entry Type



The catalog is a fifth structural type, distinct from the four Diátaxis types. Catalog entries are **structured data first, documentation second** — every entry is both a human-readable page and a machine-queryable record.



### 3.1 What Catalog Entries Are



Each catalog entry documents a single device, integration, plugin, or protocol adapter. It follows a mandatory section structure and a strict frontmatter schema (DAS v1 Specification §5.3 and §6).



### 3.2 What Catalog Entries Are Not



Catalog entries are not how-to guides. A catalog entry for "Philips Hue" documents *what* the integration does, how to install and configure it, and what entities it exposes. A how-to guide might document "How to set up Hue across three rooms with motion-activated scenes" — a cross-cutting task that uses the Hue integration alongside automations and motion sensors.



If content is specific to one integration and fits within the catalog structure, it belongs in the catalog entry. If it spans integrations, involves a workflow, or solves a problem, it is a how-to guide that links to the relevant catalog entries.



### 3.3 Mandatory Sections



Every catalog entry includes these sections in order:



1. **Overview** — what this integration does (one paragraph)

2. **Requirements** — hardware, firmware versions, network requirements

3. **Installation** — how to add it to HomeSynapse

4. **Configuration** — YAML configuration reference with examples

5. **Entities and capabilities** — what devices/entities are exposed, with types and attributes

6. **Troubleshooting** — common issues and resolutions (follows the troubleshooting structure from §2.2.1, abbreviated as needed)

7. **Changelog** — integration-specific change history



Sections without applicable content state "No additional requirements" or equivalent — the heading is never omitted.



### 3.4 Quality Tiers



Catalog entries carry a `quality_tier` frontmatter field that drives visible badging and review gates. See DAS v1 Specification §6.4 for tier definitions and enforcement.



---



## 4. Audience Routing Rules



HomeSynapse documentation serves four audience segments:



| Audience | Frontmatter value | Typical goals |

|---|---|---|

| **Home users** | `users` | Install, configure devices, create automations, troubleshoot |

| **Power users** | `users` | Advanced automations, performance tuning, network architecture |

| **Plugin authors / developers** | `developers` | Write integrations, use APIs, extend the platform |

| **Administrators / integrators** | `administrators` | Deploy, maintain, secure, backup, upgrade, monitor |



The first two share the `users` audience value because the distinction is one of depth, not type — a home user and a power user read the same how-to guide, but the power user may continue into the reference page.



### 4.1 The Routing Table



When an author asks "where does this content go?", the answer depends on what the reader is doing — not who the reader is.



| Reader need | Content type | Likely format |

|---|---|---|

| "Teach me from scratch" | Tutorial | Quickstart, Guided build, or Learning path |

| "How do I do X?" | How-to | Task, Integration, Operations, Security, or Migration |

| "X is broken, help" | How-to | Troubleshooting |

| "What are all the options for X?" | Reference | Config, CLI, API, or Error code reference |

| "What does integration X support?" | Catalog | Catalog entry |

| "Why does X work this way?" | Explanation | Concept, Architecture, Rationale, or Threat model |

| "What changed in vX.Y?" | Reference (changelog) + How-to (migration) | — |



### 4.2 Operations and Administration Routing



Administrators and integrators will create pressure for "runbooks," "deployment guides," and "SRE-style" documentation. These are valid content needs, but they do not require a new content type. The routing is:



| Operations content | Content type | Format | Rationale |

|---|---|---|---|

| Backup and restore procedure | How-to | Operations how-to | It is a repeatable task with numbered steps |

| Key rotation procedure | How-to | Security how-to | It is a security-sensitive task with numbered steps |

| Log management and retention | How-to | Operations how-to | It is a repeatable administrative task |

| Upgrade procedure | How-to | Operations how-to (or Migration how-to if breaking) | It is a task; if it involves breaking changes, migration format applies |

| Deployment architecture overview | Explanation | Architecture | It explains structure and boundaries, not procedures |

| Backup retention policy rationale | Explanation | Rationale / Tradeoffs | It explains *why* the policy exists |

| CLI flags for backup command | Reference | CLI reference | It is a lookup table of options |

| Health check endpoint spec | Reference | API reference (generated) | It is an API contract |



**The rule is simple:** if it has numbered steps the reader follows, it is a how-to. If it explains *why* something works a certain way, it is an explanation. If it is a lookup table of options, it is reference. There are no exceptions for audience segment.



### 4.3 Developer Content Routing



Plugin authors and developers have the same routing:



| Developer content | Content type | Format |

|---|---|---|

| "Build your first integration" | Tutorial | Guided build |

| "How to publish a community integration" | How-to | Task how-to |

| "How to test integration against HomeSynapse" | How-to | Task how-to |

| "Integration API endpoints" | Reference | API reference (generated) |

| "Plugin isolation architecture" | Explanation | Architecture |

| "Why integrations are sandboxed" | Explanation | Rationale / Tradeoffs |



---



## 5. Format Pattern Quick Reference



This table maps every recognized format pattern to its content type, template file, and the section of this document that defines it.



| Format pattern | Content type | Template file | Defined in |

|---|---|---|---|

| Quickstart tutorial | Tutorial | `templates/tutorial.md` | §2.1 |

| Guided build tutorial | Tutorial | `templates/tutorial.md` | §2.1 |

| Learning path tutorial | Tutorial | `templates/tutorial.md` | §2.1 |

| Task how-to | How-to | `templates/how-to.md` | §2.2 |

| Troubleshooting how-to | How-to | `templates/troubleshooting.md` | §2.2.1 |

| Migration how-to | How-to | `templates/how-to.md` | §2.2 |

| Operations how-to | How-to | `templates/how-to.md` | §2.2 |

| Security how-to | How-to | `templates/how-to.md` | §2.2 |

| Integration how-to | How-to | `templates/how-to.md` | §2.2 |

| Configuration reference | Reference | `templates/reference.md` | §2.3 |

| CLI reference | Reference | `templates/reference.md` | §2.3 |

| API reference | Reference | (generated — no template) | §2.3 |

| Error code reference | Reference | `templates/reference.md` | §2.3 |

| Glossary | Reference | `templates/reference.md` | §2.3 |

| Concept / Mental model | Explanation | `templates/explanation.md` | §2.4 |

| Architecture | Explanation | `templates/explanation.md` | §2.4 |

| Rationale / Tradeoffs | Explanation | `templates/explanation.md` | §2.4 |

| Threat model / Security posture | Explanation | `templates/explanation.md` | §2.4 |

| Catalog entry | Catalog | `templates/catalog-entry.md` | §3 |



**Note:** Most how-to formats share the base how-to template with format-specific structural guidance from this document. The troubleshooting how-to has its own dedicated template due to its distinct required sections.



---



## 6. Content Type Enforcement



### 6.1 Frontmatter



Every page declares its content type in frontmatter:



```yaml

content_type: tutorial    # Enum: tutorial | how-to | reference | explanation | catalog

```



This field is validated in CI against the frontmatter JSON Schema. Pages with missing or invalid `content_type` fail the build.



### 6.2 Directory Structure



Content types map to directories:



| Content type | Directory |

|---|---|

| Tutorial | `docs/getting-started/` and `docs/tutorials/` |

| How-to | `docs/how-to/` and `docs/migration/` |

| Reference | `docs/reference/` |

| Explanation | `docs/explanation/` |

| Catalog | `docs/catalog/` |



A page's `content_type` frontmatter must be consistent with the directory it lives in. A tutorial in the `how-to/` directory fails CI validation.



**Exception:** `docs/getting-started/` contains a mix of tutorials and explanations (the "what is HomeSynapse" and "core concepts" pages are explanations; the "installation" and "first automation" pages are tutorials). These pages declare their content type accurately in frontmatter. The directory structure accommodates this because Getting Started is a navigational grouping, not a content-type grouping.



### 6.3 Vale Rules



Vale enforces content-type-specific prose rules:



- **Tutorials** must use second person ("you"). Third-person procedural text ("the user should...") is flagged.

- **All types** are checked against the terminology vocabulary (Voice & Tone Guidelines §4).

- **All types** are checked against the banned patterns list (Voice & Tone Guidelines §4.2).



### 6.4 Review



Content type adherence is checked during PR review. If a reviewer determines that a page's content does not match its declared type or follows no recognized format pattern, the PR is sent back for restructuring.



---



## 7. When Content Does Not Fit



If a piece of content does not fit any recognized format pattern:



1. **Check the routing table (§4.1).** The reader's need almost always maps to one of the four types.

2. **Check if the content should be split.** A page that mixes "how to do X" with "why X works this way" should be two pages: a how-to and an explanation.

3. **Check if the content belongs in an existing page.** A small addition to an error code reference is not a new page.

4. **If none of the above resolve it**, raise it with the docs team before authoring. The answer is almost always "restructure the content," not "create a new type or format."



New format patterns may be proposed through a PR to this document. They must:



- Belong to an existing content type (no fifth type)

- Define the structural expectations (required sections, ordering)

- Include a rationale for why existing formats are insufficient

- Be approved by the docs team



---



## 8. Templates Index



The following template files implement the format patterns defined in this document. Each template includes the required frontmatter, section structure, and inline authoring guidance.



| Template file | Implements |

|---|---|

| `templates/tutorial.md` | Quickstart, Guided build, Learning path tutorials |

| `templates/how-to.md` | Task, Migration, Operations, Security, and Integration how-to guides |

| `templates/troubleshooting.md` | Troubleshooting how-to (dedicated template) |

| `templates/reference.md` | Configuration, CLI, Error code reference, and Glossary |

| `templates/explanation.md` | Concept, Architecture, Rationale, and Threat model explanations |

| `templates/catalog-entry.md` | Device/integration/plugin catalog entries |



Generated reference pages (API, AsyncAPI, config schema) do not use templates — they are produced by spec-to-docs generators (DAS v1 Specification §7).



---



*This document is part of the HomeSynapse DAS v1 artifact pack. It is governed by the DAS v1 Specification and will be revised in concert with that specification.*
