# DAS Full Design System — Dependency Map for Core Project

**Type:** Cross-project dependency documentation
**Status:** Reference — identifies assets in the Website & Documentation project that the Core project depends on
**Purpose:** When Doc 13 (Web UI) gets designed, and when any external-facing content is produced, the Core project needs to know which assets from the full design system are load-bearing constraints, not just style preferences.

---

## The Problem

The Core project contains `DAS_Consolidated_Reference_v1.md` — a compressed digest of the full documentation and design system. For governance purposes (vocabulary rules, voice registers, content types), the digest is sufficient. But it cannot substitute for the originals when:

1. **Designing Doc 13 (Web UI)** — The visual design reference, typography system, and website design vision become load-bearing constraints for any UI that carries the HomeSynapse brand
2. **Producing website documentation pages** — The full content type specifications, template structures, and frontmatter contracts govern how documentation is built and published
3. **Building the docs CI pipeline** — The DAS v1 artifact pack implementation files define the exact contract the Core's spec files must satisfy

---

## The Seven Canonical Documents (Website & Documentation Project)

These live in the Website & Documentation ChatGPT project's knowledge base. They represent months of research-backed design work.

| Document | What It Governs | When Core Needs It |
|---|---|---|
| **AboutHomeSynapse** | Product positioning, value propositions, audience definitions | Any external-facing content, marketing pages |
| **VisualDesignReference** | Color system, spacing, component patterns, layout grids | Doc 13 Web UI design, any branded interface |
| **WebsiteDesignVision** | Information architecture, page structure, navigation patterns, interaction models | Doc 13 Web UI design, documentation site structure |
| **TypographyAndContentDesignReference** | Font stacks, type scale, reading rhythm, content hierarchy | Doc 13 Web UI, all rendered documentation |
| **VoiceAndToneGuidelines** | Three voice registers, vocabulary rules, the four AI-slop amendments, tone calibration by context | All external-facing content (digested in DAS Consolidated Reference) |
| **CONTENT_TYPES** | Diataxis content type specifications, template structures per type | Documentation authoring, docs build pipeline |
| **STYLE_GUIDE** | Sentence-level writing rules, formatting conventions, code block standards | All written content |
| **DAS_v1_Specification** | The complete documentation architecture system specification | Docs CI pipeline, content validation |

---

## The DAS v1 Artifact Pack (15 Implementation Files)

These are the concrete implementation outputs produced during the DAS v1 build. They define the contract that Core's spec files must satisfy.

| File | Purpose | Core Project Impact |
|---|---|---|
| **docusaurus.config.ts** | Docusaurus site configuration | Defines where spec files go, how they're built, plugin configuration |
| **Frontmatter schema** | YAML frontmatter validation schema | Every spec file, design doc, and API reference must include valid frontmatter |
| **Content templates** (multiple) | Per-content-type Markdown templates | Guides, references, tutorials, API docs all have specific structures |
| **Vale rules** (YAML configs) | Prose linting rules for CI | Enforces vocabulary standards, catches AI slop patterns, validates voice register |
| **CI workflows** | GitHub Actions for docs build + validation | Automated quality gate for all documentation PRs |
| **PR template** | Pull request template for docs contributions | Standardizes review process |
| **CODEOWNERS** | File ownership for docs review | Ensures correct reviewers for content changes |

---

## When These Become Active Dependencies

### Phase 1 (Current) — Low dependency
The Core project produces design documents that are internal engineering artifacts. The DAS Consolidated Reference is sufficient for vocabulary and voice governance.

### Phase 2 (Interface Specs) — Medium dependency
Interface specifications start defining the API surface that will be documented. The frontmatter schema and content type templates become relevant for ensuring specs are docs-pipeline-ready.

### Doc 13 (Web UI Design) — HIGH dependency
This is the trigger point. When Doc 13 is designed, the full visual design reference, typography system, and website design vision are mandatory context. The Web UI IS the brand surface. It must comply with:
- Visual design reference (colors, spacing, components)
- Typography reference (font stacks, type scale, reading rhythm)
- Website design vision (information architecture, interaction patterns)
- Voice and tone guidelines (UI copy in the "Direct Neutral" register)

### Docs Build Pipeline — HIGH dependency
When the documentation site is built, every DAS v1 artifact pack file becomes a hard dependency. The Core project produces content; the DAS pipeline consumes it.

---

## Action Required

1. **Before Doc 13 design begins:** Extract the seven canonical documents from the Website & Documentation project and make them available to the Core project context (either as files in `context/` or as explicit loads in the Doc 13 task brief)
2. **Before docs pipeline integration:** Extract the 15 DAS v1 artifact pack files and place them in the appropriate repo location
3. **The DAS Consolidated Reference is NOT sufficient for Doc 13.** The task brief for Doc 13 must explicitly require loading the full design system documents.
