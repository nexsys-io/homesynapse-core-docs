<!--
file: website/design-system/visual-design-reference.md
purpose: Color palette (neutrals, brand accents, semantic colors) and application rules for both brands.
audience: site build, Doc 13 Web UI
state-type: reference
status: DRAFT (reconciliation pending) -- imported 2026-06-12 from the Feb 2026 Website & Documentation (ChatGPT) project. Self-declared Locked/Canonical status SUSPENDED until reconciled with the ruled register rules (D-1..D-7, website/README.md), the R13-R16 copy guardrails, and current project state. Tracker: ./README.md
origin: authored Feb-Mar 2026; renamed from doc06.md at import (canonical name per research/2026-03-08_das-design-system-dependency-map.md)
-->

# NexSys + HomeSynapse Visual Design Reference (v1)

**Scope of this document:** Color palette decisions + how we apply them across **nexsys.io** and **homesynapse.com**  

**Status:** Locked (v1) — use as canonical reference unless explicitly revised.



---



## 0) North Star: What These Brands Must Feel Like



Both websites must communicate the same core posture:



> **Infrastructure-grade software presented with consumer-grade calm.**  

> High-tech, trustworthy, architectural, long-lived — never flashy.



This is not "marketing design" and sales pitch. 

This is **trust design**.



**Emotional contract (what users should feel):**

- "This respects my intelligence."

- "This respects my home and privacy."

- "This will not randomly break."

- "This is serious software, but it's pleasant to use."



HomeSynapse should be **slightly warmer** than NexSys because:

- users will spend longer reading documentation,

- newcomers need approachability without losing authority,

- it must remain inviting and readable in extended sessions.



NexSys stays slightly cooler/more infrastructural as the parent brand.



---



## 1) Shared Structural Design Rules (Both Sites)



### 1.1 Color discipline rules

**Non-negotiables:**

1. **No pure white** (`#FFFFFF`) anywhere.

2. **No pure black** (`#000000`) anywhere.

3. **One accent per screen** (brand accent OR semantic color, not both competing).

4. **Accent color is for meaning and action**, not decoration.

5. **No rainbow UI** and no multi-accent confusion.

6. **No gradients in logos** (gradients may be used *only* as subtle backgrounds behind content canvas if needed).

7. **High contrast without harshness**: favor near-blacks and warm off-whites.



### 1.2 "Calm Canvas" layout model

All pages are structured as:

1. **Ambient background layer** (very subtle; often off on docs pages)

2. **Content canvas** (stable reading surface)

3. **Meaningful content** (typography + hierarchy lead)



**Strict rule:**  

If the background is noticeable, it is too strong.



### 1.3 Motion rules

Motion exists only to communicate:

- state change

- hierarchy change

- continuity

- confirmation



**Allowed:** opacity fades, subtle scale (1–2%), gentle short slides  

**Disallowed:** bouncy/elastic easing, flashy transitions, constant movement near reading content



---



## 2) The Shared Neutral Base (Canonical)



These neutrals define the "architectural substrate" and are used on **both** sites:



### 2.1 Core neutrals (global)

- **Obsidian Graphite (Primary Dark Anchor):** `#0B0F14`  

  Use for: dark mode background anchors, top-level nav bars, deep hero sections, brand gravity.



- **Carbon Slate (Secondary Dark Surface):** `#151B23`  

  Use for: panels, navigation chrome, secondary surfaces in dark mode.



- **Mineral Ash (Primary Light Background):** `#ECEFF3`  

  Use for: light mode backgrounds, reading pages, general whitespace.



### 2.2 Why these neutrals are locked

They deliver:

- long-session comfort (reduced glare vs pure white)

- premium seriousness (reduced harshness vs pure black)

- architectural "infrastructure" tone

- consistent contrast behavior in both light and dark mode



---



## 3) Brand Accents (Locked)



We intentionally keep the brands related:

- same neutral base

- same minimalism

- same contrast discipline



…but with different accent roles.



### 3.1 HomeSynapse Accent (Primary)

- **HomeSynapse Blue (Brand Accent):** `#3FA6C9`



**What this color must communicate:**

- high-tech clarity

- trust / security

- premium restraint (not neon, not playful)

- legible and brandable in both light and dark modes



**Use cases (HomeSynapse Blue):**

- primary links

- buttons / primary actions (sparingly)

- focus outlines

- active navigation state

- selected states

- subtle key dividers (rare)

- diagrams/illustrations on marketing pages



**Do NOT use HomeSynapse Blue for:**

- body text

- large filled surfaces

- heavy backgrounds behind reading content



> Blue is for action and emphasis, not reading.



### 3.2 NexSys Accent (Primary)

- **NexSys Architectural/Synaptic Blue (Brand Accent):** `#2F6FA3`



NexSys remains slightly cooler, heavier, and more infrastructural than HomeSynapse.



**Use cases (NexSys Blue):**

- logo accent

- links / focus states

- minimal call-to-action emphasis

- diagrams and system/architecture visuals



**Behavior rule:**  

NexSys accent should appear **less frequently** than HomeSynapse accent.  

NexSys should feel like the *source* — present, but not loud.



---



## 4) HomeSynapse Warmth Layer (How It Differs From NexSys)



Both sites share the same structural base, but HomeSynapse is warmer where it matters most: long-form reading.



### 4.1 HomeSynapse reading surfaces

On **homesynapse.com**, reading zones (docs, architecture, learn pages) should use slightly warmer surfaces than NexSys:

- warm-tinted canvas backgrounds (still subtle)

- warm charcoal text tones

- reduced contrast harshness in dark mode



This warmth is applied primarily through:

- background tints in content canvas

- text color tuning (avoid pure black/white)

- spacing/typography rhythm



### 4.2 HomeSynapse page-intent mapping

- **Homepage / About / Vision:** subtle ambient allowed (tasteful)

- **Documentation pages:** background expression off by default

- **Downloads / Account settings:** minimal backgrounds, clarity-first



---



## 5) Semantic Colors (Shared, Secondary)



Semantic colors exist only for meaning; they are not "brand colors."



- **Warning (Amber):** `#C7A14A`

- **Error (Muted Red):** `#B85E5E`

- **Success (Restrained):** `#6FAE9A`



**Rules:**

- never compete with brand accent

- never used decoratively

- only appears in context (alerts, validation, status indicators)



---



## 6) Light/Dark Mode Requirements (Both Sites)



### 6.1 Theme behavior

Theme switching must feel:

- immediate

- deliberate (not auto-inverted)

- calm (no dramatic flashes)



### 6.2 Dark mode principles

- dark mode is **warm-charcoal**, not pure black

- whites are **soft off-white**, not pure white

- preserve readability without eye strain



### 6.3 Logo survivability requirement

Logos must look excellent in both modes:

- primary mark should work in monochrome (near-black / near-white)

- accent is applied as a controlled secondary element (underline, stroke, dot, etc.)

- do not rely on the accent color alone for recognition



---



## 7) Practical Application Rules (Do/Don't)



### 7.1 Do

- Use neutrals for most surfaces.

- Keep emphasis rare and meaningful.

- Use accent color primarily for interactive states.

- Maintain a stable reading column and calm canvas for docs.

- Keep borders/dividers subtle (almost invisible).



### 7.2 Don't

- Don't introduce additional accent colors "for variety."

- Don't flood sections with the accent as a fill.

- Don't use bright saturated colors for large surfaces.

- Don't allow backgrounds to compete with text.

- Don't use gradients in logos or icons.



---



## 8) Summary: What's Locked



### Shared base (both brands)

- `#0B0F14` Obsidian Graphite

- `#151B23` Carbon Slate

- `#ECEFF3` Mineral Ash



### HomeSynapse accent

- `#3FA6C9` HomeSynapse Blue



### NexSys accent

- `#2F6FA3` NexSys Architectural/Synaptic Blue



### Shared semantic colors

- `#C7A14A` Warning

- `#B85E5E` Error

- `#6FAE9A` Success



### Shared philosophy

- Calm, architectural, trustworthy

- One accent per screen

- No pure white/black

- Backgrounds are subtle or off

- Reading surfaces prioritize comfort and focus



---



## References (Project Context)

> **Import note (2026-06-12):** the original References entries were `:contentReference[oaicite:N]` tokens -- citation artifacts from the ChatGPT export pointing at chat-session files that did not survive the export. Probable targets: *AboutHomeSynapse* (positioning -- not yet extracted to this repo), the internal strategy layer, and `website-design-vision.md`. Re-cite properly at reconciliation.
