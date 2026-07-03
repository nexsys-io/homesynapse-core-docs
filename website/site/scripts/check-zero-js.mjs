/*
 * check-zero-js — enforces the ruled "zero-JS-by-default" posture as a build gate, not a hope.
 * The skeleton ships NO JavaScript bundles: the only scripts are the tiny inline theme
 * boot/toggle (a few hundred bytes, no framework). If a future page adds an island, this check
 * is loosened DELIBERATELY (edit the allowlist + record it in the lane return), never silently.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: .pathname yields "/C:/…" on Windows, which
// fs cannot open — the gate then fails closed with a misleading "dist/ not
// found" (observed on the 2026-07-03 host run; the in-lane Linux run masked it).
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const offenders = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') || p.endsWith('.mjs')) offenders.push(p);
  }
};
try {
  walk(dist);
} catch {
  console.error('[site] dist/ not found — run the build first');
  process.exit(1);
}
if (offenders.length > 0) {
  console.error('[site] zero-JS gate FAILED — emitted script files:\n' + offenders.join('\n'));
  process.exit(1);
}
console.log('[site] zero-JS gate OK (no script bundles emitted)');
