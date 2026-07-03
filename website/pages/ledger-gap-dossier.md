<!-- SHORT HONEST VERSION (2026-07-03 website lane) — the flagship dossier (REC-142) is still Increment-2 work; this page says less, truthfully, until then. Superlative kept in the counsel-safe "to our knowledge" form (honest-claim discipline). Name-light tokens per W-11. -->

# The ledger gap

**When your hub says "sent," did the light actually turn on?** On most platforms, nobody knows — the command leaves, nothing checks whether it arrived, and nothing remembers it was ever issued. The gap between "we asked" and "it happened" is simply not recorded anywhere.

{{productName}} keeps a durable ledger of intent. Every command your home is asked to execute is recorded and tracked until it is **confirmed against the device's own reported state**, **failed**, or **expired — visibly**. Confirmation here means the device reported the result. A hub saying "sent" is not a light saying "on," and this system refuses to conflate the two.

- **Honest by construction.** A command that was never confirmed is never displayed as a success. "Sent, not confirmed" is a real, calm, first-class state — not an error, and not a lie.
- **It survives restarts.** Pending commands don't become zombies after a reboot; they expire in plain sight, in the record.
- **Measured, not promised.** Confirmation behavior is ratified design measured on real hardware on our bench — per capability class, against devices' actual reporting — before it's described to you here.
- **To our knowledge, no other platform in the category maintains this record.** That claim is researched, and the receipts belong to the full dossier.

One deliberate absence, stated plainly: the engine does not quietly retry on your behalf. It records and explains. Remediation you didn't ask for is how other platforms turn one surprise into two.

The full dossier — the fire-and-forget category survey, with sources — is being written.

*Related: [Ask your home why](explainability.md) (the sibling dossier: causality, not intent) · [One configuration. One truth.](config-superiority.md).*

<!--
Provenance (review-only — strip at publish; the site build strips automatically):
- Durable ledger of intent, confirmed-against-reported-state / failed / expired: Doc 07 §3.11.2 (Pending Command Ledger, Locked); SHIPPED at M7.3 (tense-truth: "keeps" is present-true).
- Never-false-confirmed: AMD-97-INV-01 (invariants register §51) + the AMD-97 ratified confirmation semantics (Doc 08 §3.6) — "a command that was never confirmed is never displayed as a success."
- "Sent, not confirmed" as calm first-class state: the ratified honest-outcome model (AMD-97; the dashboard renders it per FRONTEND_DOCTRINE §2).
- Restart honesty / visible expiry: Doc 07 §3.11.2 expiry semantics (shipped M7.3).
- "Measured on real hardware": nexsys-bench Wave-1 corpus (MG24/EZSP + Hue RGBW + SNZB-03P) + AMD-97's measured worked example — values deliberately NOT quoted here (they live in the corpus; pointer-not-copy).
- "To our knowledge" superlative form: honest-claim discipline (counsel-gated "only"); basis = R14-A §3.3 category survey (REC-142).
- No-engine-retry as deliberate absence: anti-requirement REC-162 claimed in the absence direction only. Confirmation-driven re-issue is M8 territory — NOT marketed (per the stub guardrail).

ORIGINAL INCREMENT-2 PLANNING STUB (preserved verbatim for the dossier author):
# The Ledger Gap (stub — Increment 2, flagship-class)
The claim (REC-142 / R14-A §3.3 — the category-of-one dossier): HomeSynapse is the only platform in its category that maintains a durable, crash-surviving record of intent — every command your home was asked to execute is ledgered until it is confirmed against reported state, failed, or expired. Everyone else fires and forgets: the command leaves, nothing checks it arrived, and nothing remembers it existed.
Planned spine: the fire-and-forget category survey (no competitor ledgers confirmation-of-intent — the R14-A §3.3 evidence base) → confirmation means reported state, not a transport ack (a hub saying "sent" is not a light saying "on") → restart honesty: pending commands expire visibly instead of becoming zombies → what this makes possible: a home that can tell you what it was asked, what actually happened, and where the two diverge.
Evidence base (fold at Increment 2): REC-142 / R14-A §3.3 (already Locked design ground: Doc 07 §3.11.2 — Pending Command Ledger; ships at M7.3).
Guardrails:
- Anti-requirement REC-162 — copy must never imply the engine retries on its own. The ledger records and explains; remediation claims wait for the M8.2 ground (confirmation-driven re-issue is M8, unbuilt — do not market it).
- Shipping honesty: the ledger is ratified, Locked design implemented at M7.3 — at publish time, copy tense must match shipped truth. [2026-07-03 note: M7.3 is DONE; present tense cleared.]
-->
