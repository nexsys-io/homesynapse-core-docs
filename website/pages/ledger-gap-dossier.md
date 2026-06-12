<!-- STUB — Increment 2. Corrected at the R16 fold (2026-06-12): the porch-light/B3 dossier routes to the EXPLAINABILITY page (REC-194); this page's spine is the REC-142 confirmation-of-intent dossier. -->

# The Ledger Gap *(stub — Increment 2, flagship-class)*

**The claim (REC-142 / R14-A §3.3 — the category-of-one dossier):** HomeSynapse is the only platform in its category that maintains a durable, crash-surviving record of *intent* — every command your home was asked to execute is ledgered until it is confirmed against reported state, failed, or expired. Everyone else fires and forgets: the command leaves, nothing checks it arrived, and nothing remembers it existed.

**Planned spine:** the fire-and-forget category survey (no competitor ledgers confirmation-of-intent — the R14-A §3.3 evidence base) → confirmation means *reported state*, not a transport ack (a hub saying "sent" is not a light saying "on") → restart honesty: pending commands expire visibly instead of becoming zombies → what this makes possible: a home that can tell you what it was asked, what actually happened, and where the two diverge.

**Evidence base (fold at Increment 2):** REC-142 / R14-A §3.3 (already Locked design ground: Doc 07 §3.11.2 — Pending Command Ledger; ships at M7.3).

**Guardrails:**

- Anti-requirement REC-162 — copy must never imply the engine retries on its own. The ledger *records and explains*; remediation claims wait for the M8.2 ground (confirmation-driven re-issue is M8, unbuilt — do not market it).
- **Shipping honesty:** the ledger is ratified, Locked design implemented at M7.3 — at publish time, copy tense must match shipped truth.

**Cross-links:** [explainability](explainability.md) (the sibling dossier: causality, not intent — the porch-light/B3 story lives there) · [config-superiority](config-superiority.md) (the same single-truth philosophy applied to configuration).
