/*
 * check-shared-sources — the loud sibling-checkout preflight. The site consumes the dashboard's
 * GENERATED design tokens + self-hosted font (rank-1 truth; never copied, per the master plan
 * §4.2 pointer-not-copy rule). If the sibling repo isn't checked out, fail with a clear message
 * instead of a cryptic import error.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dash = (p) =>
  fileURLToPath(new URL(`../../../../homesynapse-core/web-ui/dashboard/${p}`, import.meta.url));

const required = [
  'src/styles/tokens.css',
  'src/styles/fonts.css',
  'src/styles/fonts/inter-variable-subset.woff2',
];

const missing = required.filter((p) => !existsSync(dash(p)));
if (missing.length > 0) {
  console.error(
    '\n[site] Shared design sources not found. This build consumes the dashboard design tokens\n' +
      '[site] directly (one source of truth, zero drift) and requires the core repo checked out\n' +
      '[site] as a SIBLING of this docs repo:\n' +
      '[site]   <parent>/homesynapse-core\n' +
      '[site]   <parent>/homesynapse-core-docs   (this repo)\n\n' +
      missing.map((m) => `[site]   missing: homesynapse-core/web-ui/dashboard/${m}`).join('\n') +
      '\n',
  );
  process.exit(1);
}
console.log('[site] shared design sources OK (dashboard tokens + font found)');
