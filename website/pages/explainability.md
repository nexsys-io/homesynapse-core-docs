<!-- SHORT HONEST VERSION (2026-07-03 website lane) — the flagship dossier (REC-194) is still Increment-2 work; this page says less, truthfully, until then. "Rendering, not data" guardrail holds: copy claims the record and the shipped surfaces, never a showcase of the UI (D-FE-6 gates showing the hero until it is demo-ready on real device data). Name-light tokens per W-11. -->

# Ask your home why

**Because {{productName}} is event-sourced, "why did that happen?" always has an answer.** Every trigger, every condition check, every command, and every confirmation is a record in an append-only log on your own hardware. An explanation isn't a debugging feature bolted onto the side — it's a straight read of what your home actually did.

What that means in practice:

- **The answer is still there next week.** Explanations are rebuilt from the permanent record, not from a trace buffer with a cap. There is no eviction to outrun and no restart that takes the evidence with it.
- **"It didn't happen" gets an answer too.** When an automation didn't fire, the same record supports the question — what was expected, what was observed, and which gate didn't open — instead of a shrug.
- **"Sent" is not "done."** Every command is tracked to an honest outcome — confirmed against the device's own reported state, or plainly marked unconfirmed. Never assumed, never displayed as a success it didn't earn. *(The full story: [The ledger gap](ledger-gap-dossier.md).)*

The full dossier — the porch-light story every platform forum knows, the eviction contrast with receipts, and what an always-answerable home changes — is being written. What's on this page today is the shipped substrate, nothing more.

*Related: [One configuration. One truth.](config-superiority.md) §"You can always see why".*

<!--
Provenance (review-only — strip at publish; the site build strips automatically):
- Event-sourced record + append-only log: Doc 01 / INV-SA-03 class (explanation = pure projection of the immutable log); shipped truth — explanation reads live since M7.5a/b.
- "No eviction / no cap": structural-absence claim (REC-145/REC-193 direction). Competitor specifics (HA stored_traces default 5; no-trace-on-never-match) DELIBERATELY not on this short page — they carry receipt obligations (corrected baselines: HA persists traces to disk, cap ≠ in-memory) and belong to the Increment-2 dossier with citations.
- Non-firing answer: shipped truth — the non-firing read (M7.5b) + four-verdict NonFiringExplanation; copy stays within ratified AMD-91/Doc-16 ground; no engine-retry implication (REC-162).
- Honest outcome / never-false-confirmed: AMD-97 + AMD-97-INV-01; ledger cross-link.
- "Being written" honesty: the R16 fold (REC-194 flagship) is Increment-2; a stub page that says less truthfully beats a padded page (2026-07-03 brief §2.2).

ORIGINAL INCREMENT-2 PLANNING STUB (preserved verbatim for the dossier author):
# Ask Your Home Why (stub — Increment 2; flagship-class per REC-194)
The claim (REC-182 + REC-194): because HomeSynapse is event-sourced, "why did that happen?" always has an answer — a complete causal record from trigger to action, kept durably, not in a buffer that evicts the evidence before you look.
Planned spine — THE B3 plain-language-causality dossier (REC-194, R16-A §3.3): Home Assistant's own maintainer-run "Month of WTH" porch-light thread (community thread 219488, verified exact) — the canonical "what turned on my light?" that the category cannot answer → "rendering, not data" → Homey's missing attribution → the eviction contrast. Supporting pain (R14-A RQ2 dossier, REC-182): HA trace eviction #117133 ("no traces = didn't trigger"), Hubitat provenance complaints, Homey timeline-as-debugger. Against Six Battlefields B3 ground: "no major platform provides causal chain visualization."
Structural-absence claims:
- No trace ring buffer / no eviction (REC-145 + REC-193): "the trace is still there next week" — vs HA's last-5 stored_traces default and Hubitat's ~1 MB purge (both verified at official docs per the R16-A assessment). History isn't a debugging feature with a memory cap; it's the substrate.
- Logs survive an LLM paste (REC-195): TTY-stripped tags + stable labeled verdict lines mean a user can paste HomeSynapse output into any assistant and get a correct diagnosis — output engineered for the tools people actually debug with. (Wording carries a register check at draft time: Register B voice, DAS bans apply — per the R16-A assessment's disagreement register, final wording is this lane's call.)
Copy guardrails (binding at draft):
- "Rendering, not data" (the R16 read-out's honest negative): the event-sourced data claim is fully cashed today; the plain-language rendering register is M10/M13 work (A-191). Copy claims the record and the current surfaces — it never promises an unshipped friendly-causality UI. B3 must not be "a data claim wearing a UX claim's clothes." [2026-07-03 note: the causality UI is now BUILT and live-integrated (FE-1b) — but showing it as a receipt stays gated on real-device data per D-FE-6.]
- REC-162 — explainability copy never implies the engine retries or self-heals; it explains. Causal-chain claims stay within ratified AMD-91 ground.
-->
