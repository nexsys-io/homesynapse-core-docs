/*
 * routes.mjs — the ONE route map: canon file (basename, sans .md) → site route + page metadata.
 * Consumed by astro.config.mjs (canon-link rewriting) and src/pages/[...slug].astro (routing).
 * Titles stay name-light (the layout appends the brand token).
 */
export const CANON_ROUTES = {
  'config-superiority': {
    path: '/config-superiority/',
    title: 'One configuration. One truth.',
    description: 'Why your smart-home setup can’t split-brain, silently corrupt, or get eaten by an upgrade — an architectural invariant, published and tested against.',
  },
  explainability: {
    path: '/explainability/',
    title: 'Ask your home why',
    description: 'Every automation run is explainable from a permanent, append-only record on your own hardware — not a debug buffer that evicts the evidence.',
  },
  'no-cloud-account': {
    path: '/no-cloud-account/',
    title: 'No cloud account. Really.',
    description: 'No account, no registration, no phone-home — provable by architecture, not promised by policy.',
  },
  'ledger-gap-dossier': {
    path: '/ledger-gap/',
    title: 'The ledger gap',
    description: '“Sent” is not “on.” A durable ledger tracks every command to an honest, confirmed-or-not outcome.',
  },
  developers: {
    path: '/developers/',
    title: 'Build on it',
    description: 'The adapter contract is frozen and documented. Breaking changes are a contract — versioned, migrated, never a rug-pull.',
  },
  index: { path: '/', title: '', description: '' },
};

/** basename → path map for the remark link-rewrite plugin. */
export const LINK_ROUTES = Object.fromEntries(
  Object.entries(CANON_ROUTES).map(([k, v]) => [k, v.path]),
);
