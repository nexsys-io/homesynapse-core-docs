<!-- Landing page — DRAFT (built out from the Increment-1 skeleton by the 2026-07-03 website lane). MAINSTREAM-FACING: leads reliability/works-together per the ruled segment rule (D-4/REC-180); the W-4 install-story embargo holds (no plug-and-play claim). Privacy present, never the headline. ≤6 sections per design-vision §10.1. Name-light (W-11): {{productName}}/{{companyName}} tokens, substituted by the site build. -->

# {{productName}}

## A smart home that works. Every time. For years.

Your home shouldn't have good days and bad days. {{productName}} is a home automation platform built like infrastructure — the unglamorous kind of software that just runs, season after season, update after update.

**Reliable by design.** Everything your home does is recorded in an append-only event log on your own hardware. When something happens, you can see exactly what and exactly why — and when nothing happens, you can see why too. No mystery states, no "try turning it off and on again."

**Works together.** One platform, one model of your home. Devices from different ecosystems behave like one system, not a federation of apps that barely tolerate each other.

**Yours.** It runs on hardware you own, in your house. It works when your internet doesn't. There is no cloud account between you and your light switch — and nothing about your home leaves your home unless you send it.

---

### Built different, provably

We publish the architectural commitments we build against — and the receipts. Start here:

- **[One configuration. One truth.](pages/config-superiority.md)** — why your setup can't split-brain, silently corrupt, or get eaten by an upgrade.
- **[The ledger gap](pages/ledger-gap-dossier.md)** — what every other platform loses track of the moment your network hiccups. *(dossier in progress)*
- **[No cloud account. Really.](pages/no-cloud-account.md)** — provable by architecture, not promised by policy. *(dossier in progress)*
- **[Ask your home why](pages/explainability.md)** — every automation run is explainable, forever, not until a buffer fills up. *(dossier in progress)*

<!-- TODO (Nick, open item 2): "works with" section held back — integration claims must match shipped truth at publish. Any Matter line reads "controls Matter devices locally" verbatim (D-1 fence). -->

### Who it's for

- **Homeowners who want it to just work.** Set it up, then stop thinking about it. The system's job is to be boring — in the way bridges are boring.
- **Power users and Home Assistant refugees.** You read receipts, not slogans. The dossiers above are written for you: specific claims, published invariants, and honest limitations stated in plain sight.
- **Developers.** The integration contract is deliberately small, frozen, and documented — and breaking changes are treated as a contract, not an event. *[Build on {{productName}}](pages/developers.md).*

### Follow the build

{{productName}} is under active development. The dossiers above are published as they reach review grade — receipts included. If what you've read holds up, the best time to look closer is before we ask you to trust it.

<!-- TODO (hub/Nick): follow-the-build CTA mechanics (W-2 — email list + GitHub link) are name/publish-blocked: the GitHub org and any list provider land with the W-11 ratification + hosting decision. No third-party form endpoints regardless (no-tracking rule). -->

<!--
Provenance (review-only — strip at publish; the site build strips automatically):
- Reliability/works-together lead for mainstream audience: ruled D-4 (REC-180, ACCEPTED 2026-06-12). "Plug-and-play" deliberately absent: W-4 install-story embargo (tense-truth gate).
- Event-log/explainability framing: Six Battlefields B1/B3; REC-182 (re-bucketed M5-C, R15 assessment Step D). Shipped truth: append-only event store + explanation reads live (M7.5a/b, core cf3733e-era).
- "No cloud account between you and your light switch": REC-171 (premised on file 1 B2 + file 2 "no mandatory cloud").
- Local-first / works-when-internet-doesn't: file 1 B2 (locked strategy ground); INV-LF-01 class.
- No privacy headline on this page: segment rule compliance (D-4).
- §Who it's for = the D-4 segment fork (segments diverge AFTER the shared truthful landing, per the 2026-07-03 website-lane brief §2.4): mainstream → reliability; prosumer → dossiers; developers → pages/developers.md (R-3).
- §Follow the build: W-2 publish model (follow-the-build CTA); mechanics TODO-gated above.
- Name tokens {{productName}}/{{companyName}}: W-11 rename-readiness + the 2026-06-27 name-light executive decision (dashboard D-FE-9 mirror).
- 5 major sections: design-vision §10.1 cap (≤6).
-->
