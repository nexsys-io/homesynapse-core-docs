<!--
file: website/design-system/documentation-style-guide.md
purpose: Formatting and structural authoring rules for product documentation under /docs/ (DAS v1 pack).
audience: docs contributors, PM
state-type: reference
status: DRAFT (reconciliation pending) -- imported 2026-06-12 from the Feb 2026 Website & Documentation (ChatGPT) project. Self-declared Locked/Canonical status SUSPENDED until reconciled with the ruled register rules (D-1..D-7, website/README.md), the R13-R16 copy guardrails, and current project state. Tracker: ./README.md
origin: authored Feb-Mar 2026; renamed from doc01.md at import (canonical name per research/2026-03-08_das-design-system-dependency-map.md)
-->

# HomeSynapse Documentation Style Guide



**Document type:** Governance

**Status:** Canonical — governs all content authored under `/docs/`

**Parent specification:** DAS v1 Specification

**Effective date:** 2026-02-19

**Owner:** nick@nexsys.io



---



## 0. Purpose and Scope



This document defines the formatting rules, structural conventions, and authoring standards for HomeSynapse documentation. It is the practical bridge between the foundational design references and the act of writing a documentation page.



This guide tells contributors *how to format and structure* their writing. It does not tell them *what to write* (that is governed by `CONTENT_TYPES.md`) or *how to sound* (that is governed by `VoiceAndToneGuidelines.md`). It does not define the type stack or reading geometry (that is governed by `TypographyAndContentDesignReference.md`).



### 0.1 Relationship to Other Documents



| Document | What it governs | This guide's relationship |

|---|---|---|

| DAS v1 Specification | Structure, process, tooling | This guide implements the spec's content model rules |

| CONTENT_TYPES.md | Content types, format patterns, audience routing | This guide assumes the author has chosen the correct content type |

| VoiceAndToneGuidelines.md | Word-level decisions, register selection, vocabulary | This guide defers to it for all tone and terminology questions |

| TypographyAndContentDesignReference.md | Type stack, scale, reading geometry | This guide defers to it for all typographic specifications |

| VisualDesignReference.md | Color palette, accent usage, semantic colors | This guide references it for admonition and code block styling |



If any conflict exists between this guide and a higher-precedence document, the higher-precedence document governs.



### 0.2 Audience



This guide is written for anyone contributing documentation to HomeSynapse — whether writing a new page, reviewing a pull request, or editing an existing document.



---



## 1. File and Naming Conventions



### 1.1 File Names



- All lowercase

- Words separated by hyphens (`-`), never underscores or spaces

- Descriptive and concise: `event-sourcing.md`, not `es-overview-v2-final.md`

- Index pages are named `index.md` (or `index.mdx` if JSX is required)

- Catalog entries use the `slug` frontmatter value as the filename: `philips-hue.md`



### 1.2 File Format



- Prefer `.md` unless the page requires JSX components (React imports, interactive elements)

- Use `.mdx` only when `.md` is insufficient — every `.mdx` file adds a build dependency

- All files use UTF-8 encoding with LF line endings



### 1.3 Directory Placement



Every page must live in the directory that matches its `content_type` frontmatter value. The mapping is defined in CONTENT_TYPES.md §6.2. A tutorial in the `how-to/` directory fails CI validation.



---



## 2. Frontmatter



### 2.1 Required Fields



Every page must include the base frontmatter fields defined in DAS v1 Specification §5.2. Catalog entries must additionally include the extended fields from §5.3.



The minimum valid frontmatter for a non-catalog page:



```yaml

---

title: "Page Title"

description: "One-sentence summary used in search results and section indexes."

content_type: tutorial

audience:

  - users

status: stable

date: 2026-02-19

---

```



### 2.2 Frontmatter Rules



- `title` is a human-readable string. Use sentence case. Do not include the content type in the title ("Tutorial: First Automation" is wrong; "First automation" is correct).

- `description` is a single sentence. It appears in search results, meta tags, and section index pages. Write it to be useful in those contexts.

- `date` reflects the last meaningful content update, not the file creation date. Typo fixes do not update this field. Substantive revisions do.

- `status` values: `stable`, `draft`, `beta`, `deprecated`, `removed`. Pages with `status: draft` are excluded from the production build. Pages with `status: removed` are excluded from the build but preserved in git.

- `sidebar_position` is optional. When present, it controls ordering within a sidebar category. When absent, the page appears in the order defined in `sidebars.ts`.



### 2.3 Validation



Frontmatter is validated in CI against `frontmatter-schema.json` on every pull request. Invalid frontmatter fails the build. The schema is the authoritative definition of allowed fields, types, and enum values.



---



## 3. Headings



### 3.1 Heading Levels



- **H1** (`#`) is reserved for the page title. Every page has exactly one H1, and it is generated from the `title` frontmatter field. Do not write an H1 in the markdown body.

- **H2** (`##`) defines major sections of the page.

- **H3** (`###`) defines subsections within an H2 section.

- **H4** (`####`) is the deepest allowed heading level. If content requires H5 or deeper, the page should be restructured or split.



### 3.2 Heading Style



- Use sentence case: "Configuration reference" not "Configuration Reference"

- No terminal punctuation (no periods, colons, or question marks — except in Register B FAQ-style content where questions as headings are acceptable per VoiceAndToneGuidelines.md §4.2)

- No inline code in headings

- No links in headings

- No emoji in headings



### 3.3 Heading Hierarchy



Headings must not skip levels. An H3 must follow an H2, never an H1. An H4 must follow an H3.



The right-side table of contents displays H2 and H3 headings. H4 headings do not appear in the TOC. Structure content accordingly — the TOC should provide a useful page outline using only H2 and H3.



---



## 4. Prose Formatting



### 4.1 Paragraphs



- One idea per paragraph.

- Separate paragraphs with a blank line.

- Keep paragraphs to 3–5 sentences in Register A (technical docs). Register B (website, onboarding) may use shorter paragraphs.

- No first-line indentation.



### 4.2 Emphasis



- Use **bold** for short emphasis: a word or brief phrase, never a full sentence. Bold draws the scanning eye — use it to mark terms the reader needs to find quickly.

- Use *italics* for introducing a new term on its first appearance, for titles of documents or publications, and for gentle emphasis where bold would be too strong.

- Do not combine bold and italics (`***text***`).

- Do not use ALL CAPS for emphasis.

- Do not use underlines (they are visually indistinguishable from links).



### 4.3 Lists



- Use lists to summarize, enumerate, or present discrete items.

- If a list item requires more than two sentences of explanation, convert it into a paragraph or its own subsection.

- Bullet lists (`-`) are for unordered items. Numbered lists (`1.`) are for sequential steps or ranked items.

- All list items in a single list should be grammatically parallel.

- List items that are complete sentences end with a period. Fragment list items (e.g., items in a feature list) do not.

- Nested lists are allowed to one level of depth. If deeper nesting is needed, restructure the content.



### 4.4 Line Breaks in Source



Markdown source files use **semantic line breaks**: one sentence per line. Do not hard-wrap at 80 or 120 characters. Do not write entire paragraphs as single unwrapped lines.



Semantic line breaks produce clean diffs (a one-sentence edit touches one line), simplify review, and give editorial tools — including AI-assisted editing — precise control over individual sentences.



```markdown

HomeSynapse processes events locally before deriving state.

Each event is immutable once written.

State is derived by replaying the event log from a known checkpoint.

```



Blank lines between groups of sentences indicate paragraph breaks, as usual.



---



## 5. Links and Cross-References



### 5.1 Internal Links



- Use relative paths for all internal links: `[event sourcing](../explanation/event-sourcing.md)`

- Always include the `.md` extension in the link target — Docusaurus resolves these to the correct URL at build time

- Link to the specific page, not to a section index, when the target content is known

- Anchor links to specific headings use the auto-generated slug: `[root causes](../how-to/devices/zigbee-pairing.md#root-causes)`



### 5.2 External Links



- External links open in the same tab by default (standard web behavior)

- Do not append `{:target="_blank"}` or equivalent attributes unless there is a specific UX reason (e.g., linking from a multi-step procedure where losing context would disrupt the workflow)

- Always use the full URL including the protocol: `https://example.com`, not `example.com`



### 5.3 Cross-Reference Discipline



- A page should never contain content that belongs to a different content type. Link to it instead (CONTENT_TYPES.md §1.1).

- When a tutorial references a configuration option, link to the configuration reference page. Do not reproduce the reference table.

- When a how-to guide needs to explain a design decision, link to the relevant explanation page. Do not embed a rationale section.

- Reference pages should include a "See also" section at the bottom linking to related how-to guides and explanation pages.



### 5.4 Link Text



- Link text must be descriptive. Avoid "click here," "this page," or "learn more."

- The link text should make sense out of context (screen readers read link text in isolation).

- Acceptable: "See the [event sourcing explanation](../explanation/event-sourcing.md) for background on this design."

- Not acceptable: "For background on this design, see [here](../explanation/event-sourcing.md)."



---



## 6. Code Blocks and Inline Code



### 6.1 Inline Code



- Use inline code (`` ` ``) for: file paths, configuration keys, CLI commands, function names, variable names, error codes, and short code fragments (1–3 tokens).

- Do not use inline code for: product names (HomeSynapse), general technical concepts (event sourcing), or emphasis.

- Inline code should be brief. If the code fragment exceeds one short line, use a code block.



### 6.2 Code Blocks



- Always specify a language identifier for syntax highlighting: `` ```yaml ``, `` ```python ``, `` ```bash ``, `` ```typescript ``, `` ```json ``

- Use `` ```text `` for output that should not be syntax-highlighted (logs, plain text examples)

- Code blocks represent real, functional code or configuration. Do not include placeholder comments like `// your code here` unless the placeholder is the point of the example.

- Every YAML example must be valid YAML. Every Python example must be valid Python. Code examples are validated in CI (DAS v1 Specification §7.5).



### 6.3 Code Block Titles



Docusaurus supports titled code blocks. Use titles when the code block represents a specific file:



````markdown

```yaml title="automations/morning-lights.yaml"

trigger:

  event: sun.rise

action:

  - device: living_room.overhead

    command: turn_on

```

````



Do not use titles for code blocks that represent CLI output, general examples, or fragments.



### 6.4 Code Example Files



Tested code examples live in `/docs/examples/` as standalone files, referenced from documentation via Docusaurus code imports:



```markdown

import MorningLights from '@site/examples/yaml/morning-lights.yaml';



<CodeBlock language="yaml" title="automations/morning-lights.yaml">

{MorningLights}

</CodeBlock>

```



This approach ensures code examples are validated in CI. Prefer imported examples over inline code blocks for any example that represents a complete, runnable artifact.



### 6.5 Syntax Highlighting



Syntax highlighting themes are defined in the Docusaurus configuration and follow the VisualDesignReference.md guidelines: muted, low-contrast, functional. Color aids comprehension without attracting attention. The theme works in both light and dark modes.



---



## 7. Admonitions



HomeSynapse documentation uses exactly five admonition types. No other types are permitted.



### 7.1 Allowed Types



| Type | Syntax | Purpose | When to use |

|---|---|---|---|

| **Note** | `:::note` | Neutral clarification or additional context | The reader benefits from knowing this, but it is not critical to the task at hand |

| **Tip** | `:::tip` | Optional optimization or best practice | An improvement the reader can choose to adopt; skipping it does not cause problems |

| **Caution** | `:::caution` | Footgun, data-loss risk, or "stop and think" | The reader should pause and understand the implications before proceeding |

| **Danger** | `:::danger` | Security impact, irreversible action, or high risk | Proceeding without understanding this could cause significant harm |

| **Info** | `:::info` | Pointer to related material or meta-context | "FYI" — directs the reader elsewhere for additional depth |



### 7.2 Admonition Syntax



```markdown

:::note

HomeSynapse stores events as immutable records. Deleting an event is not supported by design.

:::

```



Custom titles are allowed when they add clarity:



```markdown

:::caution[Backup before proceeding]

This operation modifies the event log schema. Create a backup before continuing.

:::

```



### 7.3 Admonition Rules



- Do not use admonition types not listed above. `:::warning`, `:::success`, `:::important`, `:::secondary`, and any custom types with emoji are not permitted.

- Admonitions are placed between paragraphs, never mid-paragraph.

- Keep admonition text concise — one to three sentences. If an admonition requires a paragraph of explanation, the content likely belongs in the body text.

- Do not stack multiple admonitions consecutively. If two admonitions appear back-to-back, the content should be restructured.

- **Density limit:** A page should contain no more than one admonition per major section (H2). If a section needs multiple callouts, the content is likely under-explained in the body text — strengthen the prose instead of adding boxes. Admonitions that appear every few paragraphs create visual noise and train readers to skip them, which defeats their purpose.

- Admonitions should support reading, not interrupt it (VoiceAndToneGuidelines.md §5, TypographyAndContentDesignReference.md §6.3).



---



## 8. Images and Media



### 8.1 File Organization (Hybrid Model)



HomeSynapse documentation uses a hybrid image organization:



- **Page-specific images** are co-located next to their markdown file. Place the image in the same directory as the `.md` file that references it.

- **Shared images** (logos, diagrams used across multiple pages, architectural visuals) live in `docs/static/img/` with subdirectories mirroring the docs structure where helpful.



The Docusaurus project lives at `/docs/` in the repository root. All content paths below are relative to that project root.



```

docs/

├── how-to/

│   ├── devices/

│   │   ├── zigbee-pairing.md

│   │   └── zigbee-network-diagram.png    # Page-specific: co-located

│   └── ...

static/

├── img/

│   ├── architecture/

│   │   └── event-flow-overview.svg       # Shared across pages

│   └── brand/

│       └── homesynapse-logo.svg          # Brand asset

```



### 8.2 Image References



- Co-located images: `![Zigbee network diagram](./zigbee-network-diagram.png)`

- Shared images: `![Event flow overview](/img/architecture/event-flow-overview.svg)`



### 8.3 Image Rules



- Every image must have descriptive alt text. The alt text should describe what the image communicates, not what it looks like.

- Prefer SVG for diagrams, architecture visuals, and anything with text. SVGs remain crisp at all sizes and work in both light and dark mode.

- Use PNG for screenshots and raster graphics. Use lossy compression (tools like `pngquant` or `oxipng`) to keep file sizes reasonable.

- Do not use JPEG for screenshots — compression artifacts around text reduce legibility.

- Maximum recommended image width: 1200px for full-width content images, 800px for inline illustrations.

- Do not embed images that serve as decoration. Every image must communicate information that the text alone does not.



### 8.4 Diagrams



- Prefer Mermaid diagrams (rendered at build time by Docusaurus) for flowcharts, sequence diagrams, and entity relationships. Mermaid diagrams are version-controlled, diffable, and automatically theme-aware.

- For complex architectural diagrams where Mermaid is insufficient, use SVG files authored in a dedicated tool and committed to the repository.

- All diagrams must be legible without color alone (accessibility requirement).



---



## 9. Tables



### 9.1 When to Use Tables



Tables are for structured data with consistent columns. Use tables for: feature comparisons, configuration option listings, status matrices, and lookup data.



Do not use tables for: narrative content, step-by-step instructions, or lists that happen to have two columns.



### 9.2 Table Formatting



- Always include a header row.

- Align columns for readability in the markdown source (optional but encouraged).

- Keep cell content brief — if a cell requires a paragraph, the content is better suited to a different format.

- Use inline code for technical values in cells (configuration keys, CLI flags, enum values).



### 9.3 Large Tables



For tables with more than 7–8 rows, consider whether the content would be better served by a dedicated reference page or a filterable component. Very long tables are difficult to scan and maintain.



---



## 10. Metadata and Dates



### 10.1 Dates



- All dates in frontmatter use ISO 8601 format: `YYYY-MM-DD`

- All dates in prose use the format: "February 19, 2026" (month name, unpadded day, four-digit year)

- Do not use relative dates in documentation ("last week," "recently"). Documentation persists; relative dates rot.



### 10.2 Version References



- When referring to a HomeSynapse version, use the format: "HomeSynapse 1.2" or "version 1.2"

- When referencing a version in frontmatter or configuration, use the semver string: `"1.2"` or `"1.2.0"`

- Do not use "v" prefix in prose ("version 1.2" not "v1.2") unless it is part of a CLI command, URL, or filename where the prefix is literal



---



## 11. Procedures and Steps



### 11.1 Numbered Steps



- Procedural steps in how-to guides and tutorials use numbered lists (`1.`, `2.`, `3.`).

- Each step must change system state or produce an observable result. "Understand the architecture" is not a step; "Create the configuration file" is.

- Steps are written in imperative mood, second person: "Open the configuration file," "Add the following block," "Save and restart."

- Substeps within a step use lettered or nested numbered lists. Avoid more than one level of nesting within a procedure.



### 11.2 Verification Steps



Every procedure (tutorial or how-to) ends with a verification step that confirms the procedure succeeded. The verification must be concrete and observable: "Run `homesynapse status` and confirm the output includes `zigbee: connected`."



### 11.3 Prerequisites



- Prerequisites are declared in frontmatter (`prerequisites` field for tutorials) and, when present, restated briefly at the top of the page body.

- Prerequisites describe what must be true before starting, not what the reader should know in general.

- Link to the prerequisite resource: "Complete the [installation tutorial](../getting-started/installation.md) before proceeding."



---



## 12. Terminology and Vocabulary



### 12.1 Canonical Terms



Use the vocabulary defined in VoiceAndToneGuidelines.md §4.1. The preferred-terms table is enforced by Vale's `Terminology.yml` rule. Key entries:



| Concept | Use | Do not use |

|---|---|---|

| The software platform | HomeSynapse | the app, the program, our platform |

| Where it runs | locally, on your network | on-premise, at the edge |

| Internet dependency | optional, not required | cloud-free, anti-cloud |

| Smart home devices | devices | gadgets, smart things |

| Automations | automations | routines, scenes, recipes, rules |

| Configuration files | configuration | configs, YAML files (unless format-specific) |



### 12.2 Technical Term Introduction



The first occurrence of a domain-specific term in any document should include a brief, inline clarification. Subsequent uses need no clarification. See VoiceAndToneGuidelines.md §4.3 for examples and the full rule.



### 12.3 Terminology Stability



Do not rename established features casually. Terminology changes fragment documentation, confuse search indexes, break external links, and erode the trust that consistent naming builds over time.



If a term must change, update all references in a single coordinated change — a dedicated pull request that touches every occurrence across documentation, UI copy, configuration schema, and API surface. The old term should be documented in the glossary as a deprecated alias pointing to the new term. Vale terminology rules must be updated in the same PR.



### 12.4 Banned Patterns



The following patterns are banned in all documentation. They are enforced by Vale's `BannedPatterns.yml` rule. See VoiceAndToneGuidelines.md §4.2 for the complete list and rationale.



Abbreviated reference:



- "Simply" / "just" / "easily" — minimizes user effort

- "Please note" / "note that" — filler; state the information directly

- "Obviously" / "of course" — condescending

- "Exciting" / "powerful" / "game-changing" — marketing language

- "Oops" / "uh-oh" — infantilizing

- Exclamation marks in documentation



---



## 13. Page Structure Conventions



### 13.1 Opening Sentence



Every documentation page opens with a single sentence stating what the page covers. This sentence appears immediately after the frontmatter, before any heading.



- Tutorial: "This tutorial walks through [concrete outcome] using [specific tools or features]."

- How-to: "This guide explains how to [specific task]."

- Reference: "This page documents [scope of the reference]."

- Explanation: "This page explains [concept or design decision]."

- Catalog entry: The overview section serves this purpose.



### 13.2 Section Index Pages



Every L1 and L2 directory in the navigation structure has an `index.md` section index page. Section index pages:



- Orient the reader: what is in this section and why it exists

- Link to all child pages with brief descriptions

- Do not duplicate content from child pages

- Use a consistent format within each content type's section



### 13.3 "See Also" Sections



Reference pages and explanation pages should end with a "See also" section that links to related content in other content types. This section uses H2 (`## See also`) and contains a brief unordered list of links with one-line descriptions.



```markdown

## See also



- [How to configure Zigbee devices](../how-to/devices/zigbee-configuration.md) — step-by-step setup procedure

- [Zigbee network architecture](../explanation/zigbee-architecture.md) — design decisions and topology

```



---



## 14. Accessibility



### 14.1 Alt Text



Every image must have alt text that describes the information the image conveys. "Screenshot" is not acceptable alt text. "HomeSynapse dashboard showing three connected Zigbee devices with online status" is.



### 14.2 Color Independence



Do not rely on color alone to convey meaning. Diagrams, status indicators, and tables must be understandable without color — use labels, patterns, or shapes as additional cues.



### 14.3 Heading Structure



Headings define document structure for screen readers. The heading hierarchy (§3) is not a suggestion — it is an accessibility requirement. Skipping heading levels breaks the document outline for assistive technology.



### 14.4 Link Accessibility



Link text must be meaningful in isolation (§5.4). Screen readers can present a list of all links on a page — "click here" repeated five times is unusable.



---



## 15. Content Lifecycle



### 15.1 Drafts



Pages with `status: draft` in frontmatter are excluded from the production build. Use drafts for work-in-progress content that is committed to the repo but not ready for publication.



### 15.2 Beta Content



Pages with `status: beta` are published but display a visible disclaimer banner. The first paragraph of a beta page must state what is provisional and link to a tracking issue or roadmap entry where the reader can follow progress. Beta pages are reviewed on each release cycle — they either graduate to `stable` or are removed.



### 15.3 Deprecation



When content is deprecated, update the frontmatter to `status: deprecated`. Docusaurus renders a visible banner at the top of the page. Deprecated pages must include a migration or replacement link in the first paragraph — a deprecation banner without guidance creates a dead end. See DAS v1 Specification §16 for the full deprecation and removal policy.



### 15.4 Removal



Pages with `status: removed` are excluded from the build but preserved in git history. Before a page transitions from `deprecated` to `removed`, verify that all internal links pointing to it have been updated or redirected (DAS v1 Specification §16.3).



### 15.3 Date Maintenance



Update the `date` frontmatter field when making substantive content changes. Do not update it for typo corrections, formatting fixes, or link repairs.



---



## 16. Pull Request and Review Standards



### 16.1 Self-Review Checklist



Before submitting a documentation pull request, verify:



- Frontmatter is complete and valid for the content type

- The page lives in the correct directory for its `content_type`

- Headings follow the hierarchy rules (§3)

- All links resolve (internal links use relative paths with `.md` extensions)

- Code blocks specify a language identifier

- Images have descriptive alt text

- Admonitions use only the five allowed types (§7)

- No banned vocabulary patterns (§12.3)

- The opening sentence states what the page covers (§13.1)

- Procedures end with a verification step (§11.2)



### 16.2 Review Focus



Reviewers check for content-type adherence (CONTENT_TYPES.md §6.4), voice register consistency (VoiceAndToneGuidelines.md §6), cross-reference discipline (§5.3 above), and structural compliance with the relevant template.



CI checks handle mechanical validation (frontmatter, linting, links, code examples). Human review focuses on accuracy, clarity, completeness, and adherence to the content model.



---



## 17. What This Guide Does Not Cover



- **What to write** — see `CONTENT_TYPES.md` for content types, format patterns, and audience routing

- **How to sound** — see `VoiceAndToneGuidelines.md` for voice, tone, registers, vocabulary, and anti-patterns

- **Typographic specifications** — see `TypographyAndContentDesignReference.md` for the type stack, scale, and reading geometry

- **Visual design** — see `VisualDesignReference.md` for the color palette, accent usage, and semantic colors

- **Tooling and CI** — see `DAS v1 Specification` for the complete toolchain, pipeline, and governance mechanisms

- **Template structure** — see the individual template files in `/templates/` for section-by-section authoring guidance



---



*This document is part of the HomeSynapse DAS v1 artifact pack. It is governed by the DAS v1 Specification and will be revised in concert with that specification.*
