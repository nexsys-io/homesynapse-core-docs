<!--
file: website/README.md
purpose: Website source root — M5-C content lane (W25 Lane 4 / M7 entry-gate row 4). Register rules, increment map, open items. CONTENT REGISTER (market-facing copy), not engineering documentation.
audience: Nick (content veto authority), PM (drafts), future site build
status: INCREMENT 1 — skeleton + config-superiority page draft (2026-06-12, M5-C Increment-1 session). Venue ruled by Nick 2026-06-12: homesynapse-core-docs/website/ (no site repo exists).
-->

# HomeSynapse Website — Content Source

Plain Markdown. **The framework/static-site-generator decision is deliberately NOT made here** — it is a logged open item for Nick. Nothing in this tree assumes a build system; pages are written to survive a clean export into whatever the site build becomes.

## Register rules (inviolate — merged disposition §2e + ruled D-1..D-7)

1. **Matter trademark fence (D-1/REC-172).** Copy says **"controls Matter devices locally"** — never the bare Matter mark in a way that implies certification. Until certification is bought, no Matter logo, no "Matter-certified", no unqualified "supports Matter".
2. **Never lead with commodity encryption (REC-181).** Encryption claims support a trust narrative; they are never a headline, never a differentiator. The OQ-15-2 measured evidence is usable as a supporting trust point only.
3. **Segment messaging rule (D-4/REC-180).** Privacy-first framing leads ONLY for prosumer/EU audiences. Mainstream-facing copy (the landing page) leads with reliability, works-together, plug-and-play. Privacy never disappears; it stops being the headline where it doesn't sell.

**Anti-requirements (bind all copy):** no claim implying engine-level retry (REC-162), no templating DSL (REC-155), no destructive forced migration (REC-151). These are *structural absences* — copy may claim the absence, never the feature.

**D-5 usage note (Nick, 2026-06-12):** Grid/Assure are validated-tailwind / hypothesized-demand — they must not appear as products in any copy until the M5-D interview evidence rules.

**Provenance discipline:** every page carries a `Provenance` appendix (review-only — strip at publish) mapping each factual claim to its source artifact (REC numbers, INV numbers, measured results). No fabricated metrics, ever.

## Page map

| Page | State | Increment | Evidence base |
|---|---|---|---|
| `index.md` (landing) | DRAFT (skeleton-grade) | 1 | Six Battlefields B1/B6 framing; D-4 mainstream lead |
| `pages/config-superiority.md` | **DRAFT — the Increment-1 deliverable, reviewer-readable** | 1 | R13 §1/§3.1 via the R13 assessment; INV-CE-01; Doc 06; OQ-15-2 disposition; REC-171/182 cross-links |
| `pages/ledger-gap-dossier.md` | STUB — flagship-class | 2 | REC-142 / R14-A §3.3 (category-of-one confirmation-of-intent) |
| `pages/no-cloud-account.md` | STUB | 2 | REC-171 (flagship claim + account-dependency matrix), REC-179 (cloud-shutdown narrative, Insteon evidence) |
| `pages/explainability.md` | STUB — flagship-class (REC-194) | 2 | REC-182 + R14-A pain citations; R16 M5-C-COPY bucket **FOLDED 2026-06-12**: REC-194 porch-light/B3 dossier (THE FLAGSHIP), REC-193 no-eviction attestation (+145), REC-195 LLM-paste property |

**Remaining §2e backlog (no page yet — assign at Increment 2+):** Data-Act/CRA alignment, dated (REC-174) · Apple-contrast (REC-175) · Matter-friction contrast, positioning register (REC-176).

**R16 fold note (2026-06-12):** the R16 assessment's merged disposition (`nexsys-hivemind/context/planning/2026-06-12_R16_output-contract_merged-disposition.md`) landed mid-Increment-1; its M5-C-COPY bucket (REC-193/194/195) is consumed above at stub/citation level per its own routing rule. Full copy drafting = Increment 2. Its read-out adds a binding copy guardrail: **"rendering, not data"** — B3/explainability copy claims the event-sourced record and current surfaces, never an unshipped plain-language-causality UI (the rendering register is M10/M13 work).

## Open items (Nick)

1. **Framework decision** — static site generator / hosting. Open, not blocking content drafting.
2. **Landing-page "works with" section** — held back deliberately: integration claims must match shipped product truth at publish time (Zigbee is the MVP adapter; any Matter line uses the fence verbatim). Decide at Increment 2 or at publish.
3. **Naming surface** — pages use "HomeSynapse" (product) and "NexSys" (company, trademark = the commercial control point per D-2). Confirm the public naming convention before publish.
