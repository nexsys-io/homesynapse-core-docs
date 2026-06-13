<!--
file: website/design-system/typography-reference.md
purpose: Type stack (Inter / Source Serif 4 opt-in / JetBrains Mono NL), Major Third scale, reading geometry. Covers homesynapse.com + nexsys.io.
audience: site build, Doc 13 Web UI
state-type: reference
status: DRAFT (reconciliation pending) -- imported 2026-06-12 from the Feb 2026 Website & Documentation (ChatGPT) project. Self-declared Locked/Canonical status SUSPENDED until reconciled with the ruled register rules (D-1..D-7, website/README.md), the R13-R16 copy guardrails, and current project state. Tracker: ./README.md
origin: authored Feb-Mar 2026; renamed from doc04.md at import (canonical name per research/2026-03-08_das-design-system-dependency-map.md)
-->

# NexSys + HomeSynapse Typography & Content Design Reference (v2)

**Scope:** Typography system, reading ergonomics, content hierarchy, and subtle execution details  

**Applies to:**  

- homesynapse.com (marketing, docs)  

- nexsys.io (company site, vision, technical positioning)  

**Status:** Locked (v2) — treat as canonical unless explicitly revised.



**Revision history:**  

- v1 → v2: Serif/sans split replaced with all-sans default. Source Serif 4 moved to optional reading mode. Type scale formalized (Major Third 1.25). Heading weights updated (H1 → 700). JetBrains Mono NL adopted. Reading geometry values made precise. MkDocs-specific section removed (platform decision deferred).



---



## 0) Typography as Infrastructure (North Star)



Typography is not decoration.  

Typography is **interface, trust signal, and cognitive load management**.



For NexSys and HomeSynapse, typography must:



- support **long, focused reading sessions**

- communicate **technical seriousness without intimidation**

- remain calm, neutral, and legible over time

- scale from casual discovery → deep technical immersion

- age well (no trend-driven decisions)



> If a user spends 45 minutes reading our docs,  

> the typography has succeeded.



---



## 1) The Core Typographic Contract



This single rule governs all typography decisions:



> **Inter is the voice of the system.**  

> **One font family for reading. One for code. Clarity everywhere.**



Inter handles both structural elements (navigation, headings, labels) and body text (documentation, explanations, guides). The distinction between scanning and reading is achieved through **size, weight, and spacing** — not through font switching.



Source Serif 4 exists as an optional reading mode enhancement for users who prefer serif typography during long reading sessions. It is never the default.



This approach is grounded in competitive analysis (Home Assistant, Apple HomeKit, and Google Home all use sans-serif exclusively) and reading research (font size, line height, and line length drive comprehension far more than the serif/sans distinction).



---



## 2) The Canonical Typeface Stack



### 2.1 Primary Typeface (All Text)

**Inter** (variable font, wght + opsz axes)



**Used for:**

- navigation (top + side)

- page titles and headings

- all body text (documentation, guides, explanations, philosophy)

- buttons and labels

- tables

- metadata and captions

- callouts

- UI controls

- summaries and "at a glance" sections



**Why Inter:**

- designed specifically for screen legibility

- optical size axis (14–32) automatically optimizes letterforms for small UI text versus display headings

- 30+ OpenType features including tabular figures (`tnum`), slashed zero (`zero`), and contextual alternates — directly useful for device IDs, sensor readings, and configuration values

- x-height of ~55% of UPM ensures legibility at 12–14px

- full 100–900 weight range as a single variable font file

- neutral, modern, non-distracting

- works equally well in light and dark mode

- future-proof and widely supported



Inter is the voice of the system — from the first heading to the last paragraph.



---



### 2.2 Optional Serif (Reading Mode Only)

**Source Serif 4** (variable font)



**Role:** An opt-in reading mode enhancement, not a default.



**When available:**

- long-form tutorials and architecture deep dives

- philosophy and design rationale pages

- any context where a user explicitly activates a reading mode toggle



**Why Source Serif 4:**

- five optical sizes ensure clean rendering from caption to display

- transitional design avoids excessive personality

- calm contrast and rhythm for sustained reading

- pairs cleanly with Inter when both appear on the same page



**Rules for reading mode:**

- reading mode replaces body text font only — headings, navigation, labels, callouts, and all structural elements remain Inter

- reading mode is always user-initiated, never automatic

- reading mode must be easily reversible



---



### 2.3 Monospace (Code & Technical Artifacts)

**JetBrains Mono NL** (No Ligatures variant)



**Used for:**

- code blocks

- configuration examples (YAML, JSON, TOML)

- logs and CLI output

- isolated identifiers and file paths



**Why the NL (No Ligatures) variant:**

HomeSynapse's primary code context is YAML configuration. Ligatures that transform `->` or `!=` into single glyphs obscure the literal characters users need to type. The NL variant preserves character-level clarity.



**Why JetBrains Mono:**

- increased lowercase letter height improves readability at 13–15px without consuming more horizontal space

- rectangular oval shapes create clear text patterns ideal for scanning indentation-heavy YAML

- strong glyph distinction (1/l/I, 0/O) reduces misreading in configuration contexts



**Rules:**

- inline code should be brief (1–3 tokens)

- code blocks use subtle background contrast only

- avoid loud syntax coloring — favor muted, low-contrast themes



Code should feel precise, not flashy.



---



## 3) Type Scale & Hierarchy



Typography hierarchy guides attention through **size and weight progression**, not decoration.



### 3.1 Scale System: Major Third (1.25 ratio)



The Major Third ratio provides clear hierarchy without the dramatic size jumps that waste vertical space in content-heavy layouts.



**Heading Scale:**



| Level | Size | Weight | Line Height | Margin Above | Margin Below |

|---|---|---|---|---|---|

| H1 | 2.441rem (~39px) | 700 (Bold) | 1.1 | 0 | 1.5rem |

| H2 | 1.953rem (~31px) | 600 (SemiBold) | 1.2 | 3rem | 1rem |

| H3 | 1.563rem (~25px) | 600 (SemiBold) | 1.25 | 2rem | 0.5rem |

| H4 | 1.25rem (20px) | 500 (Medium) | 1.3 | 1.5rem | 0.5rem |



**Text Scale:**



| Role | Size | Weight | Line Height |

|---|---|---|---|

| Body | 1rem (16px) | 400 (Regular) | 1.6 |

| Small / metadata | 0.875rem (14px) | 400 (Regular) | 1.5 |

| Code (block) | 0.875rem (14px) | 400 (Regular) | 1.5 |

| Code (inline) | 0.875em (relative) | 400 (Regular) | inherit |



### 3.2 Weight Discipline



The heading scale uses **decreasing weights alongside decreasing sizes** to create visual deceleration — the reader's eye naturally slows as it moves from page title into content.



**Hard rule:**  

Never use weights above 700. Ultra-bold (800–900) creates marketing energy and visual noise — both are explicitly disallowed.



### 3.3 Heading Margins



Asymmetric margins (more space above than below) visually associate each heading with the content that follows, not the content above. This is a critical detail that all three major competitors (Apple, Google, Home Assistant) implement.



### 3.4 Body Text Weight

- Inter Regular (400) for all body text

- Avoid bold in body text except for:

  - short emphasis (a word or brief phrase, never a full sentence)

  - inline definitions

  - critical warnings (rare)



If everything is emphasized, nothing is.



### 3.5 Letter Spacing

- **Display headings (H1–H2):** slight negative tracking (-0.02em)

- **Body text:** default tracking (no adjustment)

- **Small text / metadata:** slight positive tracking (+0.01em)

- **JetBrains Mono NL:** no adjustment (built-in spacing is already optimized)



---



## 4) Reading Geometry (Critical for Focus)



Font choice alone does not create readability — **geometry does**. These three values matter more than any font selection:



### 4.1 Line Length

- Target: **65 characters per line** (use `max-width: 65ch`)

- Acceptable range: 60–75 characters

- Mobile: 35–50 characters

- Documentation must **never** span full viewport width

- Use a stable, centered or left-aligned reading column



The `ch` unit adapts to whichever font is active, maintaining consistent character count regardless of font metrics.



Long lines destroy comprehension and increase fatigue.



### 4.2 Line Height

- **Body text:** 1.6

- **Headings:** see scale table (1.1–1.3, decreasing with size)

- **Code blocks:** 1.5

- **Mobile body text:** 1.65–1.7 (slightly increased for smaller viewports)



This spacing allows the eye to move comfortably without losing place.



### 4.3 Paragraph Rhythm

- Space between paragraphs: 1.25em

- No first-line indentation — use vertical space only

- Avoid dense text walls

- Encourage visual breathing



A page should *invite continuation*, not resistance.



### 4.4 Base Font Size

- Minimum body text size: **16px** (1rem)

- Never go below 16px for any reading content

- 14px is acceptable only for metadata, captions, and code



---



## 5) Code Block Styling



### 5.1 Block Code

- Font: JetBrains Mono NL at 0.875rem (14px)

- Line height: 1.5

- Padding: 1.25rem

- Border radius: 0.5rem

- Background: subtle tint (not high-contrast)

- Light mode: warm light gray

- Dark mode: slightly lighter than page background

- Copy button: allowed, but unobtrusive

- No animated highlighting



### 5.2 Inline Code

- Font: JetBrains Mono NL at 0.875em (relative to surrounding text)

- Padding: 0.125em vertical, 0.3em horizontal

- Background: same tint family as block code, lighter

- Brief only: 1–3 tokens maximum

- Never mix inline code with emphasis (no bold code, no italic code)



### 5.3 Syntax Highlighting

- Favor muted, low-contrast themes

- Color should aid comprehension, not attract attention

- Ensure sufficient contrast for accessibility (WCAG AA minimum)

- Theme must work in both light and dark modes



---



## 6) Lists, Tables, and Callouts



### 6.1 Lists

- Use lists to summarize or enumerate

- All lists use Inter (same as body text)

- If a list item requires more than two sentences of explanation, convert it into a paragraph

- Bullet items should be at least one complete thought



Lists are for scanning, not teaching.



### 6.2 Tables

- Always Inter

- High contrast borders are discouraged — use subtle separators and spacing

- Tabular figures (`tnum` OpenType feature) for numeric columns

- Header row: weight 600



Tables communicate structure, not narrative.



### 6.3 Callouts (Notes, Warnings, Tips)

- Inter only

- Accent color used sparingly (semantic colors from Visual Design Reference)

- Never interrupt reading flow — place between paragraphs, not mid-paragraph

- Keep text concise



Callouts should *support* reading, not hijack it.



---



## 7) Color + Typography Interaction Rules



### 7.1 Body Text

- Never colored

- Always neutral: near-black in light mode, soft off-white in dark mode

- Avoid pure black (#000000) and pure white (#FFFFFF) — see Visual Design Reference

- Color reduces reading comfort



### 7.2 Links

- Use brand accent color

- No underlines by default (unless accessibility requires)

- Hover state may underline or subtly brighten



Accent color is for interaction, not narrative.



### 7.3 Headings

- Same color as body text (neutral)

- Never colored for decoration

- Never use accent color on headings



---



## 8) Light & Dark Mode Typography Behavior



### 8.1 Light Mode

- Background: Mineral Ash (per Visual Design Reference)

- Body text: warm charcoal (not pure black)

- Reading feels clean and calm



### 8.2 Dark Mode

- Background: Obsidian / Carbon Slate (per Visual Design Reference)

- Body text: soft off-white (not pure white)

- Slightly reduced contrast to prevent glare



### 8.3 Font Rendering

- Use `-webkit-font-smoothing: antialiased` and `-moz-osx-font-smoothing: grayscale` for consistent rendering

- Inter's variable font axes handle optical sizing automatically — do not override



**Rule:**  

Dark mode is for *extended sessions*, not drama.



---



## 9) Documentation Defaults



These rules define the default state for any documentation page, regardless of which platform is eventually chosen.



### 9.1 Default State

Documentation pages default to:

- Inter for all text (body and headings)

- no decorative backgrounds

- minimal motion

- stable reading column (65ch max-width)

- comfortable density



### 9.2 Navigation & Sidebar

- Always Inter

- Clear hierarchy through size and weight

- Avoid deep nesting without visual cues



### 9.3 Page Density

- Default density: comfortable (generous spacing per the scale table)

- Compact mode may be offered as an option, never as default



### 9.4 Reading Mode (Optional)

- When offered, a reading mode toggle switches body text from Inter to Source Serif 4

- All structural elements (headings, nav, labels, callouts) remain Inter

- Reading mode preference may be persisted per user

- Reading mode is always off by default



---



## 10) Typography as a Trust Signal (Why This Matters)



This typography system communicates:



- **Respect:** we value the reader's attention

- **Competence:** content is meant to be understood, not skimmed

- **Confidence:** no need to shout

- **Longevity:** decisions made for years, not trends

- **Restraint:** luxury is knowing what to leave out



Investors, engineers, and serious users all subconsciously read these signals.



---



## 11) Canonical Summary



### Typeface Stack

- **All text (default):** Inter (variable, wght + opsz)

- **Reading mode (optional):** Source Serif 4 (variable, body text only)

- **Code / Config:** JetBrains Mono NL



### Scale

- Major Third ratio (1.25)

- Base size: 16px (1rem)

- H1: 2.441rem / 700 → H2: 1.953rem / 600 → H3: 1.563rem / 600 → H4: 1.25rem / 500



### Geometry

- Line length: 65ch

- Body line height: 1.6

- Paragraph spacing: 1.25em



### Non-Negotiables

- No weights above 700 (ultra-bold is disallowed)

- No full-width text

- No colored body text or headings

- No decorative typography

- No trend-driven display fonts

- No font below 16px for reading content

- No ligatures in monospace



---



## 12) Final Note



Typography is one of the few design decisions that **compounds** over time.



This system is intentionally:

- conservative

- disciplined

- reader-first

- infrastructure-aligned

- empirically grounded



It will make HomeSynapse documentation feel *readable, serious, and trustworthy* —  

and make NexSys feel like a company that understands how real systems are built.



---



**Document version:** v2  

**Supersedes:** v1  

**Status:** Canonical reference for all future design discussions
