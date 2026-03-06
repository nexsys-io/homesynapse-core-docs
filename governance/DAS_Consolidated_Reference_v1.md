# HomeSynapse — Documentation & Writing Standards (Consolidated Reference)

**Document type:** Consolidated governance reference for LLM context
**Sources:** VoiceAndToneGuidelines.md (v1), CONTENT_TYPES.md, STYLE_GUIDE.md, DAS_v1_Specification.md (v1)
**Status:** Canonical — all four source documents remain authoritative in the repository. This consolidation extracts the rules that govern writing output. For CI pipelines, Docusaurus configuration, repository layout, deployment, and tooling implementation, consult the source documents in the repo.
**Effective date:** 2026-02-22

---

## 1. Voice Identity

HomeSynapse speaks with **infrastructure-grade clarity delivered with quiet human respect.** Voice is how a system communicates its nature through natural language. It reflects: precision, respect for the reader's time, calm confidence without self-promotion, technical seriousness that never becomes intimidating, warmth that never becomes casual.

### 1.1 Three Registers

**Register A — Senior Engineer.** *A senior engineer explaining their architecture to a respected peer.* Declarative, direct, assumes technical competence, explains why not just how, values precision over friendliness. Used for: technical docs, architecture docs, API references, configuration guides, changelogs, troubleshooting guides, integration development docs.

**Register B — Calm Neighbor.** *A calm, knowledgeable neighbor who happens to be a systems architect.* Confident, unhurried, explains context before detail, warm without casual, inviting without eager. Used for: homepage, about/vision, getting started, installation, blog posts, announcements.

**Register C — Direct Neutral (UI).** *The system communicating state, action, resolution.* No self-reference (neither "HomeSynapse" nor "we"), minimal words, maximum clarity, never blames, never apologizes, never celebrates. Used for: error messages, status indicators, dialogs, tooltips, empty states, notifications.

### 1.2 Register Boundary Map

| Content Type | Register |
|---|---|
| Homepage, About/Vision, Getting Started, Blog, Announcements | B |
| Installation Guide | B → A transition (invisible to reader) |
| Architecture, Config Reference, API Reference, Integration Dev, Troubleshooting, Changelog | A |
| Error Messages, Status, Dialogs, Tooltips, Empty States, Notifications | C |

### 1.3 Self-Reference Rules

**Default:** "HomeSynapse" or neutral declarative in docs and website. **"We" only** when explicitly referencing the company/team (NexSys, roadmap commitments, acknowledgments of responsibility). **Neither** in UI microcopy.

**The "We" test:** Is the subject a human decision made by the team, or a behavior of the software? Human decision → "we" acceptable. Software behavior → "HomeSynapse" or neutral form.

- ✓ "HomeSynapse processes events locally before deriving state."
- ✓ "We chose an event-sourced architecture because reliability matters more than convenience."
- ✗ "We process your events locally."

### 1.4 Philosophy Integration

State each principle once, clearly, in the appropriate context. Then let the architecture demonstrate it. Principles belong in the About/Vision page, architecture overview, and Getting Started guide. They do not belong repeated on every configuration page, error message, or API reference. Repeating "HomeSynapse is local-first" on every page signals insecurity.

---

## 2. Vocabulary Standards

### 2.1 Preferred Terms

| Concept | Use | Do Not Use |
|---|---|---|
| The software platform | HomeSynapse | the app, the program, our platform, the product |
| The company | NexSys | we (as default), the team, the company |
| Where it runs | locally, on your network | on-premise, on-prem, at the edge |
| Internet dependency | optional, not required | cloud-free, anti-cloud, no-cloud |
| Smart home devices | devices | gadgets, smart things, IoT devices (unless technically precise) |
| Automations | automations | routines, scenes, recipes, rules |
| Configuration files | configuration | config files, configs, YAML files (unless format-specific) |
| Something went wrong | [describe what happened] | error, oops, uh-oh, something went wrong |
| Event-sourced data | events, event log | data stream, event stream (unless technically precise) |
| User's home network | your network, your home | your environment, your deployment |

### 2.2 Banned Patterns

**Never use:**
- "Simply" / "just" / "easily" — minimizes user effort
- "Please note" / "note that" / "it should be noted" — filler; state directly
- "Obviously" / "of course" / "naturally" — condescending
- "Exciting" / "powerful" / "game-changing" / "revolutionary" — marketing
- "Oops" / "uh-oh" / "whoops" — infantilizing
- "Smart" as brand adjective
- "Leverage" / "utilize" / "facilitate" — use "use" (exception: "leverage" when describing strategic exploitation of a capability where "use" loses technical meaning; "facilitate" is never acceptable)
- "Seamless" / "frictionless" / "effortless" — describe the specific benefit
- "Stay tuned" / "watch this space" — give a concrete commitment or say nothing
- Exclamation marks in documentation or UI

**Never use (AI-associated vocabulary):**

*Ornamental nouns:* "tapestry" / "realm" / "landscape" / "beacon" / "symphony" / "testament" / "cornerstone"

*Vague intensifiers:* "delve" / "pivotal" / "crucial" / "vital" / "paramount" (unless describing a documented dependency) / "meticulous" / "intricate" / "nuanced" (describe the specific complexity) / "vibrant" / "innovative" / "cutting-edge" / "game-changing" / "robust" / "comprehensive" (see §2.3 for narrow exception)

*Formal verb substitutions:* "embark" → start/begin. "foster" → encourage/support. "harness" → use. "underscore" → emphasize (or state fact directly). "showcase" → show/demonstrate. "illuminate" → explain/clarify. "navigate" (metaphorical) → work through/handle.

*Mechanical transitions:* "Moreover" / "Furthermore" / "Additionally" — if the connection is real, it is self-evident. "It's worth noting that" / "It should be noted" — state directly. "In today's [noun]" / "In the ever-evolving [noun]" — throat-clearing. "This is where [product] comes in" — sales framing.

*Formulaic closers:* "In conclusion" / "To summarize" / "All in all" / "At the end of the day"

**Use sparingly:** Contractions — acceptable in Register B and C, avoid in Register A unless unnaturally stiff without one. Questions as headings — acceptable in Register B FAQ-style, never in Register A. Humor — only if it arises naturally, never forced, never in error states.

### 2.3 The Specificity Principle

> Every claim must be accompanied by or directly adjacent to the specific evidence, detail, or mechanism that makes it true.

If you write an adjective describing a quality (reliable, fast, secure, flexible), the same paragraph must contain the specific mechanism, measurement, or behavior that justifies it. If it does not, remove the adjective and describe the mechanism instead.

- ✗ "HomeSynapse offers a robust automation engine."
- ✓ "The automation engine processes events in strict order. If an automation fails, the event log preserves the failure context for replay and debugging."

**"Robust" and "comprehensive" exception:** Acceptable only in precise technical senses immediately followed by scope. ✓ "Robust to network partitions." ✓ "Comprehensive test coverage of the event replay path." ✗ "A robust and comprehensive platform."

### 2.4 Structural Variety

Vary sentence length deliberately. Mix short declarative statements with longer compound sentences. Do not follow the same paragraph structure repeatedly. Avoid the pattern: topic sentence → elaboration → restatement.

Parallel structure (tricolon, antithesis, anaphora) — use sparingly. If three consecutive paragraphs use the same rhetorical device, restructure at least one.

The em dash — use when it genuinely serves the sentence, not as a general-purpose connector. It is overrepresented in AI-generated text.

### 2.5 Technical Terminology

First occurrence of a domain-specific term in any document includes a brief, inline clarification. Subsequent uses need no clarification. Do not define the same term on every page it appears.

---

## 3. Anti-Patterns

**Startup voice:** ✗ "We're on a mission to revolutionize..." / "Join us on this journey!" / "We're thrilled to announce..."

**Corporate SaaS voice:** ✗ "Leverage our platform to optimize..." / "HomeSynapse empowers users..."

**Hacker/tinkerer voice:** ✗ "Hack your smart home!" / "Under the hood, there's some cool stuff..." / "TL;DR"

**Surveillance-anxiety voice:** ✗ "Tired of Big Tech spying on your home?" / "Take back control!"

**Over-friendly voice:** ✗ "Oops! Looks like something went wrong." / "You're all set! 🎉"

---

## 4. Content Types (Diátaxis)

All documentation falls into one of four types plus catalog. A page must not contain content belonging to a different type — link instead.

| Type | Reader Mode | Purpose | Register |
|---|---|---|---|
| **Tutorial** | Learning | Guided experience with concrete outcome | B → A |
| **How-to** | Working | Task-oriented procedure for specific goal | A |
| **Reference** | Looking up | Complete, precise technical description | A |
| **Explanation** | Studying | Discursive treatment of background and reasoning | A or B |
| **Catalog** | Evaluating | Structured device/integration/plugin page | A |

### 4.1 Content Type Rules

**Tutorials:** Must produce a concrete, visible outcome. Must be completable by following steps in order. Must use second person ("you"). Prerequisites declared in frontmatter.

**How-to guides:** Must state specific problem or goal in opening sentence. Steps are numbered and actionable. May assume HomeSynapse is installed. End with verification step. Never explain *why* at length — link to explanation page.

**Reference:** Must be complete for declared scope. Organized for lookup, not reading. Generated reference (API, config schema) never hand-edited — fix the spec.

**Explanation:** Must illuminate *why*, not *how*. Never contains numbered procedural steps. Only place where extended design philosophy discussion is appropriate.

**Catalog entries:** Mandatory sections in order: Overview → Requirements → Installation → Configuration → Entities/Capabilities → Troubleshooting → Changelog. Quality tiers: official, community, experimental.

### 4.2 Audience Routing

| Reader Need | Content Type |
|---|---|
| "Teach me from scratch" | Tutorial |
| "How do I do X?" | How-to |
| "X is broken, help" | How-to (Troubleshooting) |
| "What are all the options?" | Reference |
| "What does integration X support?" | Catalog |
| "Why does X work this way?" | Explanation |

---

## 5. Formatting Rules

### 5.1 Headings

H1 reserved for page title (generated from frontmatter `title`). H2 for major sections. H3 for subsections. H4 deepest allowed — if H5 needed, restructure. Sentence case. No terminal punctuation, inline code, links, or emoji. Never skip levels.

### 5.2 Prose

One idea per paragraph. 3–5 sentences in Register A. Semantic line breaks in source (one sentence per line). **Bold** for short emphasis (word/phrase, never full sentence). *Italics* for introducing new terms, titles, gentle emphasis. No ALL CAPS, no underlines.

### 5.3 Lists

Bullet lists for unordered items, numbered for sequential/ranked. List items requiring 2+ sentences of explanation → convert to paragraph or subsection. Parallel grammar. One level of nesting maximum.

### 5.4 Code Blocks

Always specify language identifier. Code blocks represent real, functional code. Every YAML must be valid YAML, every Python valid Python. Use titled code blocks for specific files: `` ```yaml title="automations/morning-lights.yaml" ``. Inline code for: file paths, config keys, CLI commands, function names, error codes. Not for: product names, general concepts, emphasis.

### 5.5 Admonitions

Five types only: `:::note`, `:::tip`, `:::caution`, `:::danger`, `:::info`. No `:::warning`, `:::success`, `:::important`. Max one per H2 section. Keep to 1–3 sentences. Never stack consecutively.

### 5.6 Links

Internal: relative paths with `.md` extension. Link text must be descriptive in isolation (not "click here" or "learn more"). Cross-references connect content types — never duplicate content that belongs elsewhere.

### 5.7 Images

Descriptive alt text (not "screenshot"). SVG for diagrams, PNG for screenshots (no JPEG). Max width 1200px full-width, 800px inline. Every image must communicate information text alone does not.

### 5.8 Procedures

Each step must change system state or produce observable result. Imperative mood, second person. End every procedure with a verification step. Prerequisites declared in frontmatter and restated at page top.

### 5.9 Page Structure

Every page opens with one sentence stating what it covers. Section index pages at L1 and L2 directories. Reference and explanation pages end with "See also" section.

---

## 6. Frontmatter Contract

### 6.1 Required Fields (All Pages)

```yaml
---
title: "Page Title"                    # Sentence case. No content type in title.
description: "One-sentence summary."   # Used in search, meta tags, section indexes.
content_type: tutorial                 # Enum: tutorial | how-to | reference | explanation | catalog
audience:                              # Enum values: users | developers | administrators
  - users
status: stable                        # Enum: stable | draft | beta | deprecated | removed
date: 2026-02-19                      # Last meaningful content update (ISO 8601).
sidebar_position: 1                   # Optional.
---
```

### 6.2 Catalog Extended Fields

```yaml
component_type: integration            # Enum: device | integration | plugin | protocol
slug: philips-hue
protocols: [zigbee]                    # Enum: zigbee | zwave | matter | mqtt | wifi | bluetooth | thread | http | local_api | custom
quality_tier: official                 # Enum: official | community | experimental
works_offline: true
requires_cloud: false
maintained_by: homesynapse             # Enum: homesynapse | community | vendor
supported_since: "1.0"
last_verified_version: "1.2"
categories: [lighting, sensors]        # Controlled vocabulary, max 3
brands: [Philips, Signify]
tags: [color, dimming, motion]
```

---

## 7. DAS Locked Decisions (Summary)

These decisions are not revisitable without formal revision to DAS_v1_Specification.md:

1. **Docusaurus v3** — static site generator
2. **Diátaxis content architecture** — four types enforced by directory, frontmatter, Vale
3. **Local search day one** — `@easyops-cn/docusaurus-search-local`
4. **llms.txt + AGENTS.md** — generated at build time
5. **Task-based navigation** — 3-level sidebar max
6. **Strict catalog frontmatter** — CI-enforced JSON Schema
7. **Generated API reference** — OpenAPI/AsyncAPI → Docusaurus plugins; never hand-edited
8. **Offline docs in releases** — bundled with HomeSynapse, served at `homesynapse.local/docs/`
9. **Documentation culture gates** — PR template, CODEOWNERS dual ownership, Definition of Done includes docs
10. **Cloudflare Web Analytics** — no cookies, no fingerprinting
11. **English only, i18n-ready** — glossary and terminology linting from day one

---

## 8. Writing Checklist

**Voice:** Same entity across all pages? Correct register? Self-reference rules followed?

**Precision:** Every sentence communicates fact, action, or state? No filler sentences? Technical terms introduced on first use?

**Respect:** Assumes intelligent reader? No "simply/just/easily"? No anxiety or urgency?

**Philosophy:** Principles stated once, demonstrated through structure? No competitor comparisons? Describes what HomeSynapse *is*, not what it *isn't*?

**Specificity:** Every quality-adjective backed by mechanism, measurement, or behavior in same paragraph?

**Structure:** Sentence length varied? No repeated paragraph pattern? Parallel structure not overused?

---

## 9. Terminology Stability

Do not rename established features casually. If a term must change: single coordinated PR touching all occurrences across docs, UI, config schema, and API. Old term documented as deprecated alias in glossary. Vale rules updated in same PR.

---

*This consolidated reference extracts writing-quality rules from four DAS governance documents. For CI pipeline configuration, Docusaurus setup, repository layout, deployment workflows, search configuration, versioning strategy, analytics setup, and i18n posture, consult the source documents in the HomeSynapse repository.*
