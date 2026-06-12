<!-- Landing page — DRAFT (skeleton-grade, Increment 1). MAINSTREAM-FACING: leads reliability/works-together/plug-and-play per the ruled segment rule (D-4/REC-180). Privacy present, never the headline. -->

# HomeSynapse

## A smart home that works. Every time. For years.

Your home shouldn't have good days and bad days. HomeSynapse is a home automation platform built like infrastructure — the unglamorous kind of software that just runs, season after season, update after update.

**Reliable by design.** Everything your home does is recorded in an append-only event log on your own hardware. When something happens, you can see exactly what and exactly why — and when nothing happens, you can see why too. No mystery states, no "try turning it off and on again."

**Works together.** One platform, one model of your home. Devices from different ecosystems behave like one system, not a federation of apps that barely tolerate each other.

**Yours.** It runs on hardware you own, in your house. It works when your internet doesn't. There is no cloud account between you and your light switch — and nothing about your home leaves your home unless you send it.

---

### Built different, provably

We publish the architectural commitments we build against — and the receipts. Start here:

- **[One configuration. One truth.](pages/config-superiority.md)** — why your setup can't split-brain, silently corrupt, or get eaten by an upgrade.
- **[The ledger gap](pages/ledger-gap-dossier.md)** — what every other platform loses track of the moment your network hiccups. *(coming soon)*
- **[No cloud account. Really.](pages/no-cloud-account.md)** — provable by architecture, not promised by policy. *(coming soon)*
- **[Ask your home why](pages/explainability.md)** — every automation run is explainable, forever, not until a buffer fills up. *(coming soon)*

<!-- TODO (Nick, open item 2): "works with" section held back — integration claims must match shipped truth at publish. Any Matter line reads "controls Matter devices locally" verbatim (D-1 fence). -->

<!--
Provenance (review-only — strip at publish):
- Reliability/works-together/plug-and-play lead for mainstream audience: ruled D-4 (REC-180, ACCEPTED 2026-06-12).
- Event-log/explainability framing: Six Battlefields B1/B3; REC-182 (re-bucketed M5-C, R15 assessment Step D).
- "No cloud account between you and your light switch": REC-171 (premised on file 1 B2 + file 2 "no mandatory cloud").
- Local-first / works-when-internet-doesn't: file 1 B2 (locked strategy ground).
- No privacy headline on this page: segment rule compliance (D-4).
-->
