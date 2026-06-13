<!--
file: website/design-system/research/RESEARCH_PROMPTS_2026-06-12.md
purpose: Two ready-to-run deep-research prompts (spelling decision; brand direction synthesis) authored 2026-06-12 from the brand deliberation session. Paste into a new Cowork conversation or a Claude Project. Each is self-contained.
audience: Nick (operator), future research sessions
state-type: reference / launch prompts
status: READY
-->

# Brand Research Prompts — Authored 2026-06-12

Two prompts. Run them in **separate** conversations. Both are written to stand alone (a fresh chat has none of this session's context), but if you run them inside Cowork with folder access, they reference persisted decision files for extra grounding:
- `nexsys-hivemind/context/decisions/2026-06-12_website-brand-deliberation_draft-rulings.md` (rulings W-1..W-11)
- `homesynapse-core-docs/website/design-system/README.md` (conflict register C1..C11)
- `homesynapse-core-docs/website/design-system/*.md` (the Feb design canon)

**Recommended engine:** invoke the `deep-research` skill (type `/deep-research` or ask for deep research) so the session fans out across sources and adversarially verifies before concluding. Paste the prompt body as the research question.

Both prompts assume an unresolved fact: the company/product is mid-rename. Write findings name-agnostically where the name isn't the subject.

---

## PROMPT 1 — Spelling & Name-Form Decision ("asymptote" coinage)

> **Context.** I'm naming a technology company/brand. The chosen concept is a *coined word derived from "asymptote"* — the mathematical curve that approaches a limit forever without touching it (brand story: perpetual approach to perfection; against infinity, perpetual approach IS the win condition). The model is Google/Googol and Sonos: a coined, fanciful, ownable word. The company starts as a local-first smart-home platform (free, open-core; developer- and prosumer-facing) and is intended to mature over years into cloud services, IoT software, smart hardware, and eventually B2B — so the name must age from "indie infrastructure people trust" into "institution people trust" without a rebrand.
>
> **Working candidates (not final, open set):** `asimtote`, `asymtot`, `asymptote` (the real word). You may and should propose additional coined spellings if they score better.
>
> **The question.** Which spelling should I adopt? Produce a ranked recommendation with a clear winner and runner-up.
>
> **Decision criteria, in priority order:**
> 1. **Global / linguistic resonance (highest weight).** How does each spelling read and pronounce across major languages (English, Spanish, German, French, Portuguese, Hindi, Mandarin pinyin, Arabic transliteration, Japanese romaji)? Note that real foreign spellings of "asymptote" exist (e.g. Swedish *asymtot*, Indonesian/Turkish *asimtot*) — does borrowing one help ("global feel," like Oracle's deliberate worldliness) or hurt (dilutes fanciful/ownable status, collides with a real dictionary word abroad)? Flag any unfortunate meanings, slurs, or comic readings in any language.
> 2. **Phonetic / radio test (high weight).** If a person hears the name once, can they (a) understand it and (b) spell it correctly with no visual? Map the realistic mis-spellings each candidate invites. How many distinct pronunciations does each spelling admit, and do they converge? Which candidate best survives being said aloud in a podcast ad or a conference hallway?
> 3. **Digital availability (tiebreaker).** For the top candidates, check practical availability signals: exact-match `.com`, GitHub org, PyPI + npm package namespaces, and major social handles (X, Instagram, LinkedIn, YouTube). Note: a near-dormant Cambridge University network tool already uses the PyPI/GitHub name `asimtote` — verify and weigh this for a developer-facing brand where package-namespace collisions cause real friction.
> 4. **Legal defensibility (tiebreaker, NON-LEGAL scan only).** Rank each on fanciful-mark strength and apparent distance from existing entities in *technology/software/consumer-electronics* classes specifically (a thermal-power firm "ASIMPTOTE" and a software shop "Asymm" exist but in unrelated or distinct space). Be explicit that this is a surface scan, not clearance, and state what a trademark attorney must still verify (USPTO/EUIPO classes 9/35/42).
>
> **Method requirements.**
> - For every existing-entity or availability claim, cite the source and date-stamp it. Distinguish "registered trademark" (the real obstacle) from "a website/package/company uses this string" (weaker, common-law signal).
> - Run an explicit linguistic pass per language listed — do not generalize "it's fine internationally."
> - Treat the real-foreign-spelling tension as a first-class question with a recommendation, not a footnote.
> - Do not attempt legal clearance or assert a name is "safe to use" — that's the attorney's job.
>
> **Output contract (exactly what I want to walk away with):**
> 1. A ranked table: each candidate scored 1–5 on the four criteria, with the priority weighting applied, and a one-line verdict.
> 2. A clear **#1 recommendation + runner-up**, each with a 2–3 sentence rationale grounded in criteria 1 and 2.
> 3. A **mis-spelling / mis-pronunciation map** for the winner (what people will get wrong, and how bad it is).
> 4. A **styling note:** all-lowercase vs. capitalized, and whether the form is search-distinct.
> 5. A short **"attorney must verify" checklist** — the exact searches a clearance lawyer should run before I commit code-namespace and domain spend.
> 6. Any **superior coined spelling** the research surfaced that beats all three candidates, if one exists — with the same scoring.

---

## PROMPT 2 — Brand Direction Synthesis (validate & refine the thesis)

> **Context.** I'm defining the brand and website for a local-first smart-home platform (free, open-core at launch; developer- and prosumer-facing; matures over years toward cloud/paid/hardware/B2B without a rebrand). Launch audience is **prosumers and Home Assistant / Hubitat refugees** — technical-ish people who read evidence and distrust marketing. The product's substance is reliability, an append-only event log, full local operation with no required cloud account, and explainability ("ask your home why"). Mid-rename, so treat the name as a placeholder.
>
> **The brand thesis I've already chosen — your job is to VALIDATE and SHARPEN it, not replace it:**
> > *Documents like Stripe (docs craft, typographic restraint, accent discipline). Feels like Apple (calm, economy of words, confidence). Carries the institutional warmth/gravitas of Oracle's Redwood era ~2019–2025 (warm illustrated textures, mature lettering, deliberate "global feel"). With Framework's ownership/transparency ethos as the counterweight, so the prosumer audience reads "built for me, forever," not "enterprise, not for me."*
> >
> > North-star posture (fixed): **"infrastructure-grade software presented with consumer-grade calm."**
>
> **What I specifically learned from Oracle that I want carried forward (validate these are right and show me HOW to execute them):**
> - **Warmth through illustrated texture** — organic line-work (topographic/contour swirls, grain) layered over the palette, in the spirit of Oracle Redwood's backgrounds. I've ruled the motif families as **topographic/organic + mesh/constellation** (blends allowed; a hybrid that resolves contour lines into faint network nodes is of interest).
> - **A warm illustration-only palette** (clay/ochre/sage-teal class) used ONLY in illustration/texture — never UI, text, or actions. The interaction accent stays a single cool blue.
> - **"Brand moments"** — rare saturated full-bleed illustrated hero fields, allowed ONLY on the homepage hero and About/Vision; docs/downloads/account stay calm-neutral.
> - **Brand-system governance** — Oracle's "O"-tag usage law (never standalone, fixed placement, "never treat as a graphic novelty") as the model for how any future symbol is governed. The launch identity is **wordmark-only**; a symbol comes later, shipping WITH its usage law.
> - **The maturation arc** — nothing in the brand may encode "hobbyist" or anti-cloud identity, so cloud/paid/B2B surfaces can grow inside the same brand.
>
> **The question.** Convert all of the above into a single, decision-grade **Brand Direction document** I can ratify and hand to a designer and to copy/site work — with the thesis validated against evidence and the execution made concrete.
>
> **Method — comparative teardown corpus (do this first, it's the evidence base):** Study these sites and extract what transfers. Priority order:
> 1. **Ubiquiti / UniFi** — closest business analog: prosumer infrastructure sold with premium-consumer presentation. Highest-signal for my audience.
> 2. **Framework** (laptops) — ownership/transparency/community without clutter; my warmth counterweight.
> 3. **Stripe** — docs craft, typography in practice, restrained accent.
> 4. **Apple** (product pages) — economy of words, confidence pacing.
> 5. **Oracle Redwood era (~2019–2025)** — via Wayback Machine snapshots; study the brand *system* (illustration/texture language, the "O"-tag governance, warm-palette mechanics, any public Redwood design-system docs), not just the homepage.
> 6. **Anti-models / competitive claims audit:** Home Assistant, Hubitat, Homey, SmartThings, Aqara — as design anti-patterns AND as a claims audit (what they promise, where they're weak → ammunition for evidence-based "dossier" pages).
>
> For each site, decompose into six layers: **message hierarchy** (what leads, what's buried) → **information architecture / page map** → **typography/color/layout** (real measurements where observable, not vibes) → **motion inventory** → **trust-signal inventory** (receipts, proof, docs prominence, social proof) → **CTA architecture**. Then extract findings as **STEAL / AVOID / TEST**, each a numbered, sourced recommendation.
>
> **Validation passes (the "refine" part):**
> - Stress-test the single riskiest bet: **does Oracle-style warmth dilute prosumer trust?** Find evidence both ways (does warmth read as "approachable infrastructure" or as "marketing fluff" to a technical buyer?) and give a verdict with a confidence level.
> - Check the four references don't pull in conflicting directions; where they tension (e.g., Apple's hide-complexity vs. my respect-depth ethos), state the resolution.
> - Verify the warm-palette + cool-accent split is achievable at **WCAG AA contrast** (the current cool blue already fails AA as text on the light background — flag any warm tone that would repeat that mistake).
>
> **Constraints (bind all recommendations):**
> - Evidence over assertion: every "do this" cites a teardown finding or a named source.
> - Stay name-agnostic; don't bake a brand name into examples.
> - Honor the fixed posture and the rulings above — refine execution, don't relitigate the north star.
> - Distinguish LAUNCH-NECESSARY from LATER (maturation-phase) recommendations.
>
> **Output contract (the Brand Direction document):**
> 1. **Executive direction** — 1 page: the validated thesis in my own product's terms, with the warmth-vs-trust verdict stated plainly.
> 2. **Teardown appendix** — the six-layer analysis per site, with STEAL/AVOID/TEST numbered recommendations.
> 3. **Visual-system direction** — concrete recommendation on: motif (topo vs mesh vs the hybrid, with rationale), the warm illustration palette (proposed swatches + where each is allowed + AA notes), brand-moment rules (which pages, how saturated), and the wordmark direction (weight, case, feel) pending the name.
> 4. **Trust-architecture recommendation** — how an evidence-first ("show the receipts") prosumer site should be structured, drawn from the claims audit.
> 5. **Governance starter** — a first draft of the symbol/wordmark usage law, modeled on Oracle's "O"-tag discipline.
> 6. **Launch-vs-later split** — what's needed to publish, what waits for the maturation phase.
> 7. **Open questions** for me to rule on before this is ratified.
>
> If run in Cowork with folder access: read `nexsys-hivemind/context/decisions/2026-06-12_website-brand-deliberation_draft-rulings.md`, `homesynapse-core-docs/website/design-system/README.md` (conflict register), and the `design-system/*.md` canon first, and align findings to the existing W-rulings and C-conflicts by number.

---

## How to use these

1. **Run Prompt 1 first** — it's smaller and unblocks the wordmark + domain + namespace decisions that Prompt 2's visual-system section depends on.
2. Land each result as a dated return in this `research/` folder; the PM (`nexsys-project-manager`) assesses it like any research return and folds accepted recommendations into the conflict register / rulings.
3. Neither result is self-ratifying — they produce decision-grade material; you still rule, then the specs get amended.
