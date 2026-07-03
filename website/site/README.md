<!--
file: website/site/README.md
purpose: The site build — what it is, how to run it, the ruling record, and the defaults taken.
audience: Nick, PM hub, future website lanes
state-type: reference
status: CURRENT — scaffolded 2026-07-03 (website lane; SSG ruling on record same day).
-->

# Site build (Astro)

This directory builds the public site from the content canon one level up (`website/index.md` +
`website/pages/*.md`). The canon markdown stays the copy authority and veto surface; this build
renders it in place — no second content tree.

## Ruling record (2026-07-03, Nick — the §1 veto-or-default gate)

- **SSG = Astro** (the master plan §1.3 researched default; ruled, not defaulted).
- **Location = this docs repo** (`website/site/`, alongside the content it builds — the ruled
  2026-06-12 content venue; zero tree-sharing with the core-repo lanes).
- Astro pinned to **^5.18** deliberately: the 5.x line runs **Vite 6 — the dashboard's exact
  build tool** (the toolchain-sameness rationale). Astro 6/7 ride Vite 7/8; bump coordinated
  with the dashboard, not silently.

## Build

```bash
npm ci        # first time
npm run build # one command, green = the local gate (prebuild checks shared sources,
              # postbuild enforces the zero-JS posture)
npm run dev   # local preview at :4321
```

**Sibling-checkout requirement (loud, preflight-checked):** the build consumes the dashboard's
GENERATED design tokens and self-hosted Inter subset directly from
`../../../homesynapse-core/web-ui/dashboard/` — one source of truth, zero drift (master plan
§4.2). If the core repo isn't checked out as a sibling, the build fails with a clear message.
Never copy `tokens.css` into this tree; never hand-edit it (it is generated from the DTCG
source — dashboard MODULE_CONTEXT gotcha).

## What the build adds on top of the canon markdown

- **Name-light rendering (W-11 / D-FE-9 mirror):** content uses `{{productName}}` /
  `{{companyName}}` placeholders; `plugins/remark-brand.mjs` substitutes them from
  `src/lib/brand.mjs` at build time. The rename flips two values in one file.
- **Provenance stripping:** the canon's review-only HTML comment appendices never reach the
  built HTML (`plugins/remark-strip-comments.mjs`) — the "strip at publish" rule, automated.
- **Canon link rewriting:** relative `.md` links become clean routes via the one route map
  (`src/lib/routes.mjs`).
- **Zero-JS-by-default, enforced:** `scripts/check-zero-js.mjs` fails the build if any script
  bundle is emitted. The only JS is the inline theme boot + toggle (no framework on the wire).
  `@astrojs/preact` (the dashboard-component/live-hero-embed seam) is deliberately NOT installed
  yet — it lands with the first real island (D-FE-6 gates the hero embed on
  real-data demo-readiness).

## Defaults taken this lane (recorded, revisable — canon-silent points)

1. **Site theme default = light-leaning** (stored choice > OS preference > light), dark
   first-class via the shared tokens — the master plan §4.1 recommendation ("different
   defaults, same tokens"; the dashboard records dark).
2. **Typography:** shared tokens for color/space/radius/motion/fonts; the site's reading scale
   is `typography-reference.md` §3–§4 (Major Third, 65ch, 1.6) as site-scoped `--site-*`
   derivations — an extension of the one system, not a second system.
3. **No analytics, none** (the master plan's option (a): the purest posture and itself a proof
   point — the footer says so). Hosting is the hub's decision; nothing here assumes a host.
4. **No textures / brand moments / illustrated hero:** W-8/W-9/W-10 await the sample-round
   veto. The skeleton stays calm-neutral everywhere.
5. **`<meta name="robots" content="noindex">`** ships until the W-5 publish gate passes
   (build-hidden, W-2). Remove at publish.
6. **Non-sticky header** (nothing can obscure focus, 2.4.11); revisit at design-system v0.

## Publish gates this build does NOT clear (the hub's / Nick's)

W-5 (four dossiers reviewer-grade + wordmark + design-system v0) · the W-11 name ratification
(public wordmark/domain) · hosting/deploy · the license-file flip to the ruled Apache-2.0 at
public release · removal of `noindex`. Gate 4 closure is the hub's call, not this lane's.
