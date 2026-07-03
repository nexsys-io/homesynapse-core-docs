// Astro config — ruled 2026-07-03 (Nick): Astro, built in the docs repo alongside the content
// canon it renders. Astro ^5.18 pinned DELIBERATELY: it runs Vite 6, the dashboard's exact build
// tool (the master plan §1.3 toolchain-sameness rationale); the Astro 6/7 majors ride Vite 7/8
// and are a future coordinated bump alongside the dashboard.
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import remarkBrand from './plugins/remark-brand.mjs';
import remarkStripComments from './plugins/remark-strip-comments.mjs';
import remarkCanonLinks from './plugins/remark-canon-links.mjs';
import { BRAND } from './src/lib/brand.mjs';
import { LINK_ROUTES } from './src/lib/routes.mjs';

// The dashboard is the design-token/font source of truth (sibling checkout, preflight-checked).
const dashboard = fileURLToPath(
  new URL('../../../homesynapse-core/web-ui/dashboard', import.meta.url),
);

export default defineConfig({
  markdown: {
    remarkPlugins: [
      [remarkBrand, { brand: BRAND }],
      remarkStripComments,
      [remarkCanonLinks, { routes: LINK_ROUTES }],
    ],
  },
  vite: {
    resolve: { alias: { '@dash': dashboard } },
    // Dev-server file access for the cross-repo token/font imports (build needs no allowance).
    server: { fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), dashboard] } },
  },
});
