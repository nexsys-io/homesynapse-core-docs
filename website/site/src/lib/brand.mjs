/*
 * Brand tokens (name-light, rename-ready — W-11 / the 2026-06-27 executive decision, mirroring
 * the dashboard's src/lib/i18n.ts BRAND pattern).
 *
 * The rename is unratified, so the values stay HomeSynapse/NexSys — but every rendered surface
 * references these tokens: components/layouts import BRAND directly, and markdown content uses
 * the placeholders {{productName}} / {{companyName}}, substituted at build time by
 * plugins/remark-brand.mjs. The eventual rename flips these two values; nothing else changes.
 *
 * Plain .mjs (not .ts) so astro.config.mjs and Astro components share ONE source of truth.
 */
export const BRAND = {
  /** The product name. The unratified rename (W-11) flips this one value. */
  productName: 'HomeSynapse',
  /** The company name (W-7: appears in footer/legal only — "a <company> product"). */
  companyName: 'NexSys',
};
