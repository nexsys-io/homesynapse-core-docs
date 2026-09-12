<!--
file: design/amendments/AMD-100_Glossary_UI-term_the-hub.md
purpose: AMD-100 — a UI-term amendment to the Glossary §1.1 (Home): the dashboard's word for the running HomeSynapse Core instance as a thing in the house is "the hub". A UI-term change travels the amendment path (Glossary §0: a rationale and a DAS consistency check); the concept term and every API token are untouched.
audience: Nick (ratify) · the hub (executes the Glossary edit at ratification) · the HERO-1b frontend lane (uses the term now, on the ruling)
status: PROPOSED — authored by the hub at v70 beat 5 (Fri 2026-09-11; instrument 2026-09-11T23:24:13Z) on Nick's ruling HERO1 Q7 (a), Fri 2026-09-11 ~17:1x CT. Ratifies on the word `AMD100: ratify`; the Glossary edit in §3 executes then, by Nick's card.
source: HERO-1's SPEC.md §3 and §7 (core 1e26912, web-ui/dashboard/design/hero-v1/) — the copy says "this hub's registry" for a dangling ref on a complete census; the hub's HERO-1 intake audit (nexsys-hivemind context/audits/2026-09-11_HERO-1_intake_two-layer-audit_v69-b3.md) raised the term as Q7; Nick ruled (a).
baseline: homesynapse-core-docs 876a395 — Glossary §1.1 Home reads "UI term. Home"; no entry uses "hub" as a term (grep -n -i '\bhub\b' foundations/HomeSynapse_Core_v1_Glossary.md returns one line, §1.2's prose about placement, not a term).
-->

# AMD-100: the UI term "the hub" for the running Core instance (Glossary §1.1)

**Document type:** UI-TERM AMENDMENT (Glossary §0: "UI term changes require a pull request with rationale and a DAS consistency check"). **Concept term unchanged:** Home. **API tokens unchanged:** `home_id`, `home_slug`.

## §1 Rationale
The dashboard's explainability hero speaks to a person in the house about a device in the house. When a sentence must name the running Core instance as a thing — the box that holds the registry, the log and the automations — "Home" reads as the place, not the device: "entity 01M… (not in this Home's registry)" sends the reader to the house, "not in this hub's registry" sends them to the device on the shelf. The SPEC's copy table (HERO-1, §7) uses "the hub" in exactly that role and nowhere else; the product name is never used for it (the name is in a trademark search and the copy is name-light by rule: `{{NAME}}` is the token where a name would appear, and "the hub" is what a sentence says when it means the instance and not the brand).

## §2 The DAS consistency check
- One UI term maps to one concept term: "the hub" → Home, in the sense "the running HomeSynapse process and its data boundary" (§1.1's own second sentence). It does not name a Device (§2), an Integration or a Coordinator (the Zigbee dongle is never "the hub").
- The register: a plain noun, lower case, with the article — "the hub", "this hub". Never capitalised as a product word; never "Hub" as a proper noun.
- Where "Home" already appears in UI copy as the installation (settings, users, the database), it stays. "The hub" is used only where a sentence needs the instance as a physical or logical actor in the house: "this hub's registry", "the hub restarted", "the hub hasn't seen this device since…".
- Localization: the term is a key in `i18n.ts` (`common.hub`), so a locale may render it as its own word.

## §3 The Glossary edit (executes at ratification)
In `foundations/HomeSynapse_Core_v1_Glossary.md` §1.1 Home, the line `**UI term.** Home` becomes:

`**UI term.** Home — and **the hub** when a dashboard sentence names the running Core instance as a thing in the house (the device that holds the registry, the event log and the automations): "this hub's registry", "the hub restarted". "The hub" maps to this concept term and no other; it is a plain noun with the article, never a product name (AMD-100).`

No other line changes. The watermark advances AMD-99 → AMD-100.

## §4 Ratification checklist
- [ ] Nick's word `AMD100: ratify` (or `AMD100: <edit>`).
- [ ] The §3 edit applied by the hub's guarded write; the docs card (`git add -A design/amendments foundations` → 1 M + 1 A) in Nick's hands.
- [ ] HERO-1b's B2 lands `common.hub` as the key (already in its charter on the ruling).
