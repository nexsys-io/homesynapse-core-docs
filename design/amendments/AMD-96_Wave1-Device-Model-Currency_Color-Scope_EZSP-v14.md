<!--
file: design/amendments/AMD-96_Wave1-Device-Model-Currency_Color-Scope_EZSP-v14.md
purpose: AMD-96 — the Wave-1 bench device-model currency amendment. Reconciles Doc 02 (§3.6/§3.10 color scope + the canonical color-temp unit) and Doc 08 (§3.3 EZSP version band + named coordinator) to bench-verified silicon reality. Direction co-signed by Nick (§3 decisions B4/B5); the precise Locked-body edits apply at ratification after a source-verifying currency review.
audience: Nick (ratify), PM, the independent currency reviewer, the M9 lane (the v14 test item), the Web-UI/bench lanes (the occupancy binding lives in the decision record, not here)
status: RATIFIED 2026-07-01 (Nick co-signed at the v13 hub's consolidated governance pass; folded same-day, host-side). CONSOLIDATION AT RATIFY — this amendment ABSORBED: (a) the AMD-CAND-2/3 staged verbatim diffs (nexsys-hivemind context/instructions/2026-06-28_AMD-CAND-2-3_doc02-08-color-currency_staged-fold.md) as its §2.A/§2.B edit text — the same fixes independently re-staged by the Stream-B arc, now measured-backed (bench E3); (b) the bench first-light §3.3 currency set — E1 (measured baseline EmberZNet 7.4.5.0/EZSP v13, within the ratified D-OPEN-1 band "v13+/7.4+"; v14/ASH = batch contingency + reflash-re-anchor), E2 (port identification on VID:PID `10c4:ea60` + the probe sequence, never USB descriptor strings — measured SONOFF-branded, not Silicon_Labs_CP2102N), E6 (stack version read at initialization, never an external registry — measured sw_version=null); (c) a Doc 08 §3.7 OccupancySensing default-reporting row (the hero-trigger cluster, absent pre-bench). Source verification: the v13 hub's independent re-verification (fixtures↔corpus↔raw-diagnostics traceability; all BEFORE anchors confirmed verbatim at docs 75d0345). Watermark advanced AMD-95 → AMD-96. Applied: Doc 08 §3.3 (band + MG24 + baseline + port-id) / §3.5 (Kelvin-at-ingestion + 0x010D note) / §3.7 (row); Doc 02 §3.6 (non-precluding note) / §3.10 (light row). PRIOR STATUS: PROPOSED 2026-06-26 (v7 hub); direction RATIFIED via the §3 consolidated decision pass (B4 White/CT; B5 EZSP-v14).
source: project-knowledge/device-corpus/2026-06-23_wave1-benchup-report.md (ESC-W1-HUE-01, ESC-W1-COORD-01) + context/decisions/2026-06-26_wave1-device-model-reconciliation_decision-record.md (the rulings).
baseline: docs HEAD f54d0e0 (Doc 02 + Doc 08 Locked) / core b296e76. The exact §3.6/§3.10/§3.3/§3.5 line text is to be source-verified at the currency review before the Locked bodies are edited.
-->

# AMD-96: Wave-1 Device-Model Currency — Color Scope + Canonical Unit + EZSP-v14 Coordinator

**Context.** The Wave-1 bench validated Doc 02/08 against real silicon (the hero set: MG24/EZSP, Hue White-and-Color A19, SNZB-03P) and surfaced three escalations. The occupancy-binding one (ESC-W1-SNZB03P-01) needs no doc change (propagation only — see the decision record). The other two are genuine Doc-vs-reality currency drifts this amendment reconciles. It changes **no source, no event type, no module-info, no invariant** — it is a Locked-doc currency reconciliation, the AMD-95 class.

## 1. Problem Statement (bench-verified)

1. **Full color is unrepresentable in the MVP model, and Doc 02 contradicts itself.** The Wave-1 light is an Extended Color Light (full hue/sat + xy). Doc 08 §3.5 has **no `ColorControl(full) → color_hs`/`color_xy` row** (only color-temperature); Doc 02 §3.6 marks `color_hs`/`color_xy` as **post-MVP reserved** — yet Doc 02 §3.10 **lists them as valid `light` options**. That §3.6↔§3.10 inconsistency is the drift.
2. **Color-temperature canonical-unit drift.** Doc 08 §3.5 stores **mireds** and converts to Kelvin at query; Doc 02 §3.6/§3.7 declares the canonical ingestion unit as **Kelvin**. Two canonical units for one attribute.
3. **EZSP version-band currency.** Wave-1 silicon ships **EmberZNet 8.0.2 = EZSP v14**. Doc 08 §3.3 describes its supported generation as "EZSP v13 / EmberZNet 7.4+" and names only **MG21** dongles — it does not mention EZSP v14 / EmberZNet 8.x or the MG24 dongle. `≥ v13` nominally covers v14, but v14 is above the band the doc was written against, and EZSP version mismatch is a hard-failure class.

## 2. Specification — the reconciliation (precise edits for the currency review to source-verify)

### 2.A Doc 02 — color scope (B4 Option A: White/CT for V1; full color post-MVP)
- **§3.10:** stop advertising `color_hs`/`color_xy` as MVP-valid `light` capability options; mark them **post-MVP reserved**, consistent with §3.6. The V1 `light` MVP surface is `on_off` + `brightness` + `color_temperature`.
- **§3.6:** affirm `color_hs`/`color_xy` as reserved post-MVP (no change to the reservation; only the §3.10 inconsistency is fixed). Add a one-line note that full color is a **non-precluding** post-MVP promotion (no migration needed; the sealed model expands additively).

### 2.B Doc 02 / Doc 08 — canonical color-temperature unit = **Kelvin**
- **Pick Kelvin-canonical** (Doc 02's declared ingestion unit). **Doc 08 §3.5:** the Zigbee adapter converts mireds→Kelvin **at the adapter boundary** (ingestion), so the canonical stored/ingested unit is Kelvin; remove the "stores mireds, converts at query" framing. Doc 02 §3.6/§3.7 stand as the canonical-Kelvin authority.

### 2.C Doc 08 — §3.3 EZSP version band + named coordinator (B5)
- **§3.3:** acknowledge **EZSP v14 / EmberZNet 8.x** as a supported generation (the band becomes "EZSP v13–v14 / EmberZNet 7.4–8.x"); name the **MG24 dongle** (SONOFF Dongle Plus MG24, EFR32MG24) as a recommended target alongside the MG21 dongles. Note the ASH-timeout watch-item (z2m #30891) as a known characteristic on this silicon.

## 3. Downstream Impact
- **Doc 02 edits:** §3.6 (note), §3.10 (color de-advertised). **Doc 08 edits:** §3.3 (version band + MG24 + ASH note), §3.5 (Kelvin-canonical at the adapter). **No other doc.**
- **M9 test item (not a doc edit — tracked in the decision record + the M9 scope):** validate EZSP v14 negotiation (cmd `0x0000`) + ASH framing against v14; ASH-timeout watch.
- **Source:** ZERO. **No event type, no module-info, no invariant, no source change.** This is a Locked-doc currency reconciliation.
- **Glossary/JPMS:** no new type names.

## 4. Invariants and Citations
- **No new invariant.** Cites Doc 02 §3.6/§3.7/§3.10 (capability/attribute model), Doc 08 §3.3/§3.5 (Zigbee adapter version + cluster map), INV-CE-04 (coordinator auto-detect — the MG24/EZSP fingerprint), the §1 D5 converter-DB direction (the `exposes`→capability mapping the bench validated), and the Wave-1 bench report.

## 5. Implementing WU
**Doc-only at ratification** (the §2 edits). The M9 lane carries the EZSP-v14 negotiation/ASH test item; the bench carries the physical capture. No code WU and no deferred build gate from this amendment.

## 6. Scope Fences / Deferred
- **Full color (`color_hs`/`color_xy`) is post-MVP** — reserved, non-precluding; not promoted by this amendment.
- **The occupancy binding (ESC-W1-SNZB03P-01) is NOT here** — it is a propagation (hero rule + M9 + frontend bind to `occupancy.occupied`), captured in the decision record; no model gap, no doc edit.
- **Tuya/Xiaomi codec quirks** stay out of the first validation (D5 curated-subset fallback).

## 7. Ratification Checklist
- [ ] Source-verifying currency review (confirm the exact Doc 02 §3.6/§3.10 + Doc 08 §3.3/§3.5 current text before editing the Locked bodies — the AMD-95 pattern)
- [ ] Nick ratification (co-sign — direction already co-signed at §3 B4/B5; this confirms the precise edits)
- [ ] Doc 02 §3.6/§3.10 + Doc 08 §3.3/§3.5 currency edits applied
- [ ] Nav-index row + watermark AMD-95 → AMD-96
- [ ] Spine flip (snapshot watermark; M9-scope note references AMD-96 + the v14 test item)
