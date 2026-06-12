<!-- STUB — Increment 2. R16 M5-C-COPY bucket FOLDED 2026-06-12 (the assessment's merged disposition landed mid-Increment-1; citations below are now authoritative). -->

# Ask Your Home Why *(stub — Increment 2; flagship-class per REC-194)*

**The claim (REC-182 + REC-194):** because HomeSynapse is event-sourced, "why did that happen?" always has an answer — a complete causal record from trigger to action, kept durably, not in a buffer that evicts the evidence before you look.

**Planned spine — THE B3 plain-language-causality dossier (REC-194, R16-A §3.3):** Home Assistant's own maintainer-run "Month of WTH" porch-light thread (community thread 219488, verified exact) — the canonical "what turned on my light?" that the category cannot answer → "rendering, not data" → Homey's missing attribution → the eviction contrast. Supporting pain (R14-A RQ2 dossier, REC-182): HA trace eviction #117133 ("no traces = didn't trigger"), Hubitat provenance complaints, Homey timeline-as-debugger. Against Six Battlefields B3 ground: "no major platform provides causal chain visualization."

**Structural-absence claims:**

- **No trace ring buffer / no eviction (REC-145 + REC-193):** "the trace is still there next week" — vs HA's last-5 `stored_traces` default and Hubitat's ~1 MB purge (both verified at official docs per the R16-A assessment). History isn't a debugging feature with a memory cap; it's the substrate.
- **Logs survive an LLM paste (REC-195):** TTY-stripped tags + stable labeled verdict lines mean a user can paste HomeSynapse output into any assistant and get a correct diagnosis — output engineered for the tools people actually debug with. *(Wording carries a register check at draft time: Register B voice, DAS bans apply — per the R16-A assessment's disagreement register, final wording is this lane's call.)*

**Copy guardrails (binding at draft):**

- **"Rendering, not data" (the R16 read-out's honest negative):** the event-sourced *data* claim is fully cashed today; the plain-language *rendering* register is M10/M13 work (A-191). Copy claims the record and the current surfaces — it never promises an unshipped friendly-causality UI. B3 must not be "a data claim wearing a UX claim's clothes."
- REC-162 — explainability copy never implies the engine retries or self-heals; it explains. Causal-chain claims stay within ratified AMD-91 ground.

**Cross-links:** [ledger-gap dossier](ledger-gap-dossier.md) (the sibling dossier: intent, not causality) · [config-superiority](config-superiority.md) §"You can always see why".
