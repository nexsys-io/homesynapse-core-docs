<!--
file: website/design-system/README.md
purpose: Inventory + reconciliation tracker for the Feb 2026 design-system canon imported 2026-06-12. Source of truth for what is reconciled vs. pending against the ruled register rules.
audience: Nick, PM
state-type: current
status: ACTIVE tracker
-->

# Design System — Imported Canon & Reconciliation Tracker

Six of the seven canonical Website & Documentation documents (per `../../research/2026-03-08_das-design-system-dependency-map.md`) were imported 2026-06-12 from the Feb 2026 ChatGPT project. All carry `status: DRAFT (reconciliation pending)` — their self-declared "Locked/Canonical" statuses are suspended because they predate the ruled register rules (D-1..D-7) and the R13–R16 copy guardrails, and conflict with them in specific places (see Conflict Register).

**Authority order until reconciliation completes:** ruled decisions (D-1..D-7) + `../README.md` register rules + merged-disposition guardrails → strategy layer → these documents.

## Inventory

| File | Origin (Feb name) | Self-declared status | Status now | Reconciliation |
|---|---|---|---|---|
| `voice-and-tone-guidelines.md` | VoiceAndToneGuidelines (doc02) | Locked v1 | DRAFT | C1, C2, C3 |
| `documentation-style-guide.md` | STYLE_GUIDE (doc01) | Canonical | DRAFT | C4, C9 |
| `content-types-reference.md` | CONTENT_TYPES (doc03) | Canonical | DRAFT | C4, C9 |
| `typography-reference.md` | TypographyAndContentDesignReference (doc04) | Locked v2 | DRAFT | C6 (minor) |
| `visual-design-reference.md` | VisualDesignReference (doc06) | Locked v1 | DRAFT | C6, broken refs (fixed-noted) |
| `website-design-vision.md` | WebsiteDesignVision (doc05) | — | DRAFT | C5, C7, customization scope |

**Missing from the canon (still in the ChatGPT project — extraction required, HIGH dependency for Doc 13 + docs CI):**
1. **AboutHomeSynapse** — positioning, value props, audience definitions
2. **DAS v1 Specification** — the parent spec both doc01 and doc03 cite as their authority
3. **The 15-file DAS v1 artifact pack** — docusaurus.config.ts, frontmatter-schema.json, templates/, Vale rules, CI workflows, PR template, CODEOWNERS

## Conflict Register (C1–C10)

| # | Conflict | Resolution direction | Owner |
|---|---|---|---|
| C1 | V&T §4.1 bans "no-cloud" vocabulary; flagship page is "No cloud account. Really." (REC-171) | Amend the ban: prohibited as *identity adjectives* ("cloud-free platform"), permitted as *specific factual absence claims* with provenance | Nick veto |
| C2 | V&T §5.2/§8 ban competitor comparisons; ruled §2e backlog is built on contrast dossiers (REC-142/175/176/179) | Author a "dossier register" amendment: receipts-backed, dated, specific comparisons allowed; anxiety framing stays banned (the §7.4 anti-pattern still binds REC-179 execution) | PM draft → Nick |
| C3 | V&T §4.4 example copy violates D-1 fence + tense-truth gate ("supports … Matter 1.3", Z-Wave, MQTT; Zigbee is the MVP adapter) | Rebuild all in-doc examples from shipped truth; Matter mentions use the fence verbatim | PM |
| C4 | Style guide + content types hard-code Docusaurus; framework decision is open item #1 in `../README.md`; typography v2 explicitly deferred the platform | Either rule the framework or mark every Docusaurus-specific clause provisional. Note: docs CI work is blocked until ruled | Nick |
| C5 | Design vision §3 calls the site an "account management portal / optional cloud extension" vs. no-cloud-account flagship | Layered messaging: the durable claim is "core never requires an account" (architecture, INV-grade); Connect/Cloud Pro ($7.99/$14.99 strategy layers) are additive convenience. Draft flagship copy Connect-proof NOW | Nick + PM |
| C6 | WCAG AA failures: HomeSynapse Blue #3FA6C9 on Mineral Ash #ECEFF3 ≈ 2.4:1; Warning #C7A14A ≈ 2.1:1 as text (AA requires 4.5:1; typography ref §5.3 mandates AA). NexSys Blue ≈ 4.6:1 passes | Two-tier accent system: brand hues for non-text accents; derive darker text-grade variants for links/semantic text | PM draft |
| C7 | Design vision §10.1 homepage slot 2 leads local-first stance vs. ruled segment rule (D-4: mainstream leads reliability) | `../index.md` already complies; patch §10.1 to match | PM |
| C8 | Missing parent artifacts (see above) | Extract from the ChatGPT project before Doc 13 design begins | Nick |
| C9 | Mechanical defects: style guide has two §15.3s and §16.1 cites §12.3 (banned patterns are §12.4); doc01/doc03 carry a double-blank-line paste artifact (violating their own semantic-line-break rule; left untouched — collapsing risks altering code fences) | Fix at each doc's reconciliation pass | PM |
| C10 | "Locked" status inflation — never ratified through governance | DONE at import: all downgraded to DRAFT in headers | — |
| C11 | Warmth-layer rulings W-8/W-9/W-10 (motif families, warm illustration palette, scoped brand-moments exception) amend `visual-design-reference.md` §5/§7 and `website-design-vision.md` §8.1/§11 | Fold at reconciliation AFTER the sample-composition veto round; source: `nexsys-hivemind/context/decisions/2026-06-12_website-brand-deliberation_draft-rulings.md` §W-3a | PM draft → Nick veto |

## Skill-ification target (Nick, 2026-06-12)

As these documents are refined and ratified, they become the reference layer for future Claude Skills (working names: `nexsys-web` for web development/design, `nexsys-brand` for voice/copy/marketing) operating alongside `nexsys-hivemind/{coder,project-manager}`. Discipline:

- **Canonical source lives here.** Skill `references/` files are derived mirrors — same dual-location sync model as the hivemind skills (writable source → read-only skill mirror, `diff -rq` checked).
- **Interop contract:** the PM skill cites register rules and conflict-register state in any website/brand task brief; copy-producing lanes route through the brand skill the way Core code routes through the Coder skill.
- **Precondition:** a document graduates into a skill reference only after its conflict-register rows are closed and Nick ratifies it. Skills built on unreconciled drafts would propagate the Feb→June drift this tracker exists to kill.
