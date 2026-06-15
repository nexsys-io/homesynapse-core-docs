<!--
file: track1-interview-coaching/2026-06-15_M5-D_desk-research_erasure-and-energy_background.md
purpose: Desk-research BACKGROUND brief for the M5-D energy/erasure interviews (Track A erasure,
         Track B energy). First research return, produced 2026-06-15 from the desk-research prompt
         kit. BACKGROUND LITERACY ONLY — not a ratified assessment, not a FINDINGS return, not a decision.
owner: Nick (interview prep)
status: SAVED as personal background prep. NOT routed through the formal DOCS/PM research pipeline.
         If it should count as a hivemind research input, hand it to the PM (raw returns rehome to
         homesynapse-core-docs/research/returns/ + the PM writes the assessment).

CAVEAT-1 (decision state — READ THIS): The 2026-06-07 interview guide framed Track A as "re-open
  AMD-86 BEFORE M6 freezes the write path" and Track B as authoring the C9 energy shape. Per
  PROJECT_SNAPSHOT (2026-06-14 reconcile) + Navigation Index (2026-06-15): M6 is COMPLETE 4-of-4
  (M6.3 at-rest write-path encryption committed `1eddd9a`) and B2 C8/C9 is RATIFIED (2026-06-12).
  => The erasure interviews now gate a NARROWER, post-M6 lane (app-bootstrap + the M6.3 restore-half
  R-alpha), NOT M6/M7.1; and the energy-shape (C9) decision appears already MADE. CONFIRM the exact
  current purpose with the PM before relying on any of this for a live decision.

CAVEAT-2 (verification): Several high-value but post-2025 specifics (EDPB CEF 2026 report stats,
  NIST SP 800-88 Rev.2 date, US state-law counts, RTO Order-2222 timelines) are unverified against
  primary sources here. Spot-check load-bearing claims before quoting them in a high-stakes setting.

CAVEAT-3 (sourcing/coverage): Citations are inline by publisher/date; there is no consolidated URL
  source list. Section 3 is mostly STATUTORY / standards text — NOT real RFP / DPA /
  security-questionnaire clause language (the A3 "show me the clause" artifact). Fill that gap with
  the procurement/clause-language research angle.
-->

# Desk Research: Provable Erasure (Track A) & DER/VPP Settlement Telemetry (Track B)
### Background briefing for institutional-buyer evidence interviews — US & EU/UK — prepared 15 June 2026

> **Source-discipline note:** This brief separates *what the law/standard actually requires* from *what vendors market or what is technically possible*. Primary sources (statutes, official standards, regulator guidance, RTO tariffs) are labeled and quoted verbatim where it matters. Confidence and recency risk are flagged per finding. Where something could not be verified, it is marked "not found" — itself a useful result.

---

## 1. BOTTOM LINE

**Track A · H-A1 (provable cryptographic destruction required): FALSE as a general rule / RARE. (Confidence: High.)** No GDPR text, no EDPB or ICO/CNIL guidance, no HIPAA provision, and no US state privacy statute mandates *cryptographic* destruction of a specific data subject's data. The legal standard is functional ("erasure," "deletion," "put beyond use," or valid anonymization), is explicitly technology-neutral, and is routinely satisfied by ordinary deletion plus a documented retention/backup schedule. Crypto-erase (NIST SP 800-88) is an *accepted technique* for media sanitization, not a *mandated* one; "crypto-shredding" appears as a regulatory requirement only in vendor marketing, never in primary law.

**Track A · H-A2 (erase-but-retain-tamper-evident-log required): PARTIALLY TRUE but OCCASIONAL, and weaker than "tamper-evident." (Confidence: Medium-High.)** The accountability principle (GDPR Art. 5(2)/24), the EDPB's February 2026 enforcement report, HIPAA's six-year documentation rule, and deletion-exceptions across CCPA and the state-law wave do create a genuine "delete the data, keep the record" tension. But the requirement is for a *record/log of the request and the action* (data-minimized — log the row-ID/timestamp, not the data) — **not** a *cryptographically tamper-evident, immutable* audit log. That stronger framing is a design choice the founder can sell, not a legal mandate.

**Track B · H-B1 (settlement requires sub-minute revenue-grade telemetry): FALSE / RARE. (Confidence: High.)** Money settles on clock-aligned **interval meter data** from a **meter-of-record** — 5-minute in most US RTOs (per FERC Order 825), 15-minute in ERCOT and for inter-tie products, hourly in day-ahead — or, for behind-the-meter demand response, on **baseline/M&V estimation**. Sub-minute telemetry (2–6 second SCADA) exists for *dispatch and operational visibility* and is mandatory for some large/AGC and Rule-21 resources, but it is explicitly **not** what settles money. A simple energy shape (real power, cumulative Wh, voltage, current) at the right interval, from a revenue-accuracy meter or via approved M&V, is generally sufficient to transact.

---

## 2. KEY FINDINGS

### Track A — Right to erasure

- **GDPR Art. 17 requires "erasure without undue delay" but defines no method.** The text obliges the controller "to erase personal data without undue delay" on specified grounds, with exceptions in Art. 17(3) (legal obligation, public interest, public health, archiving/research, legal claims). *Primary (gdpr-info.eu / EUR-LEX text), in force since 25 May 2018. Confidence: High.*
- **No primary EU source mandates cryptographic destruction.** EDPB Guidelines 5/2019 (Version 2.0, adopted 7 July 2020) speak only of "actual and full erasure," "delete," "fully erase" — never a technical method, and never encryption/key-destruction. *Primary (EDPB). Confidence: High.*
- **ICO accepts "beyond use" for backups in lieu of immediate overwrite.** "The key issue is to put the backup data 'beyond use', even if it cannot be immediately overwritten." *Primary (ICO right-to-erasure guidance, dated 10 Jan 2025; under review for the Data (Use and Access) Act 2025). Confidence: High.*
- **Data protection law is explicitly technology-neutral.** ICO told *The Register* (2018) that "merely because it may be considered 'technically difficult' to comply… does not mean organisations can ignore their obligations" — but never prescribes crypto-shred. *Secondary (The Register, 31 May 2018). Confidence: Medium.*
- **The EDPB's 2025 Coordinated Enforcement Action report (adopted 10 February 2026) recommends, NON-BINDINGLY, that controllers "verify that erasure has been carried out and be able to demonstrate such erasure."** The action's reach underscores how unsettled practice still is: of 7,943 controllers contacted by 32 supervisory authorities, only 764 responded; nine DPAs opened formal investigations and 23 conducted fact-finding (per the EDPB report and a Reed Smith summary, mid-February 2026). The report also flags that weak pseudonymization/partial masking does NOT satisfy deletion. *Primary (EDPB CEF report). Confidence: High.*
- **GDPR Recital 26: anonymized data falls outside GDPR entirely** — anonymization is a lawful alternative to deletion if the subject is "no longer identifiable." (Recital 26's identifiability test may be revised under the EU "Digital Omnibus" — monitor.) *Primary. Confidence: High.*
- **Accountability (Art. 5(2)) drives logging, but the log can be minimized.** A DPA recommended a deletion log "indicate, for example, that a given row in a table has been deleted at a given time" rather than referencing the data subject. *Secondary (VeraSafe summarizing DPA guidance). Confidence: Medium.*
- **Regulators have fined firms for failing to PROVE deletion.** CNIL fined FREE €300,000 (30 Nov 2022) partly for right-of-access/erasure failures; separately fined Discord €800,000 partly for lacking a written retention/deletion policy. *Primary/secondary (CNIL; EDPB). Confidence: Medium-High.*
- **HIPAA grants NO patient right to deletion, and forces 6-year retention of compliance documentation.** 45 CFR 164.530(j)(2): "A covered entity must retain the documentation… for six years from the date of its creation or the date when it last was in effect, whichever is later." HHS chose six years because it is the civil-penalty statute of limitations. (Note: this is the *documentation*-retention rule; HIPAA imposes no federal medical-record retention period — state CMS/Medicare rules do.) *Primary (eCFR/Cornell LII). Confidence: High.*
- **HIPAA disposal rule requires PHI be "rendered unreadable" but names no crypto method.** 45 CFR 164.310(d)(2). Cited methods (shredding, degaussing, wiping) are conventional. *Primary. Confidence: High.*
- **CCPA/CPRA (Cal. Civ. Code 1798.105) right to deletion has nine exceptions** — including completing a transaction (d)(1), security (d)(2), legal compliance (d)(8). No private right of action for deletion failures; no cryptographic-destruction requirement. *Primary (FindLaw / leginfo). Confidence: High.*
- **The 2023–2026 state wave grants deletion rights with similar exceptions; NONE require cryptographic destruction. Twenty states have comprehensive privacy laws in effect in 2026 (counting Florida's narrower-scope law), with Indiana, Kentucky and Rhode Island taking effect 1 January 2026** (per MultiState, 4 Feb 2026). Texas TDPSA exempts pseudonymized data held under technical/organizational controls. *Primary statutes / secondary (IAPP, Bloomberg Law, MultiState). Confidence: High.*
- **NAIC Insurance Data Security Model Law (#668) requires "secure disposal of Nonpublic Information in any format" and audit trails — but not crypto-shred. 21 states have adopted Model #668 to date** (per NAIC's Cybersecurity topic page; one industry source, CompassMSP, puts it higher at "at least 28 jurisdictions… as of early 2026"). HIPAA-compliant entities are deemed compliant with the Model's Section 4. *Primary (NAIC MO-668). Confidence: High.*
- **NIST SP 800-88 Rev. 2 (final 26 Sep 2025) treats cryptographic erase as ONE optional Purge technique, not a mandate**, and constrains its use (only when all data was encrypted; unsuitable if keys were escrowed/backed up). Verification — not crypto specifically — is the non-negotiable element. *Primary (NIST CSRC). Confidence: High.*

### Track B — DER/VPP settlement & metering

- **FERC Order 2222 (issued 17 Sep 2020) defers metering/telemetry specifics to each RTO/ISO tariff** and requires that those rules not pose an "undue barrier" to behind-the-meter DERs. DERAs must provide "telemetry information" and "aggregate settlement data," but Order 2222 itself prescribes no interval or accuracy class. *Primary (FERC; ISO-NE compliance orders). Confidence: High.*
- **FERC Order 825 requires settlement intervals to ALIGN with dispatch intervals** — driving 5-minute settlement in most US RTOs. PJM implemented 5-minute settlements on 1 April 2018. *Primary (FERC Order 825; PJM). Confidence: High.*
- **PJM settles real-time on 5-minute "Revenue Data for Settlement"; day-ahead on hourly intervals.** *Primary (PJM Manual 11 / Manual 28). Confidence: High.*
- **CAISO operates a clean telemetry-vs-metering split: 4-second telemetry for visibility/AGC; separate revenue metering settles money.** A peer-reviewed source quoting CAISO requirements states the telemetry sampling rate is every 4 seconds and "CAISO requires the metering accuracy to be ±0.25%… the data should be directly measured from the resource instead of an aggregation" (arXiv:1409.5320). (Note: a PG&E/Olivine CAISO field study treats the per-location settlement meter as ±0.5% — i.e., ANSI Class 0.5; the ±0.25% figure applies to regulation-resource direct metering.) *Secondary (arXiv) + primary (CAISO tariff). Confidence: High for the telemetry-vs-metering distinction.*
- **ERCOT settles on 15-minute Settlement Intervals; prices via SCED every 5 minutes.** Settlement uses interval meter data — actual where available, otherwise estimated via historical or default load. *Primary (ERCOT data products). Confidence: High.*
- **CAISO demand response settles via baseline/M&V, not telemetry.** "Settlement Quality Meter Data" in kWh/MWh; baselines via 10/10 method, weather/day matching, or control groups; statistically-derived meter data permitted where interval metering is unavailable. *Primary (CAISO Tariff §10; BPM for Demand Response v3). Confidence: High.*
- **Revenue-grade = ANSI C12.20 Class 0.2 or 0.5 (±0.2% / ±0.5% at full load); IEC 62053-22 (0.2S/0.5S) is the equivalent.** ANSI C12.20's content has been folded into ANSI C12.1-2024. *Primary (NEMA/ANSI) + secondary. Confidence: High.*
- **OpenADR carries telemetry reports, but they are for visibility/M&V — not the settlement meter.** OpenADR reports are "quite minimal… rID, time, value and data quality"; the telemetry usage report = "real-time usage data (e.g. kWh or kW), usually the most recent data point available." Intervals are flexible (e.g., 5-minute then hourly). *Primary (OpenADR specs / GridFabric docs). Confidence: High.*
- **IEEE 2030.5 / CSIP (California Rule 21) mandates real-time telemetry (power, voltage, frequency) for monitoring/control of larger DERs — an operational, not settlement, channel.** CSIP aggregators forward controls within 1–5 minutes; gateways can acquire data down to 1-second sampling. *Secondary (IEEE Smart Grid; vendor implementation docs) + primary (IEEE SA). Confidence: Medium-High.*
- **Behind-the-meter DR is settled via baseline/M&V; only resources with dedicated revenue submetering settle on direct metered output.** FERC's "reconstitution" concept (subtract behind-the-meter device output from the retail-delivery-point meter) underpins ISO-NE's contested approach and exists precisely to prevent double-counting. *Primary (FERC ISO-NE orders). Confidence: High.*

---

## 3. REAL LANGUAGE / EXAMPLES (verbatim — the section the user most wants)

**GDPR Art. 17(1)** — "The data subject shall have the right to obtain from the controller the erasure of personal data concerning him or her without undue delay and the controller shall have the obligation to erase personal data without undue delay where one of the following grounds applies…" *(gdpr-info.eu / EUR-LEX)*

**GDPR Art. 17(3)** — "Paragraphs 1 and 2 shall not apply to the extent that processing is necessary… for compliance with a legal obligation… [or] for the establishment, exercise or defence of legal claims."

**EDPB Guidelines 5/2019 (adopted 7 July 2020)** — "Article 17.1 GDPR is described as a clear and unconditional mandate addressed to controllers… the controller shall 'have the obligation to delete personal data without undue delay'." And: "search engine providers… will need to carry out actual and full erasure in their indexes or caches." *(No technical method specified anywhere in the document.)*

**EDPB CEF Report 2025 (adopted 10 Feb 2026)** — Recommendation: "Verify that erasure has been carried out and be able to demonstrate such erasure." On anonymization-as-deletion: controllers who "only apply basic pseudonymisation or partial masking… would not fulfil the requirements of the GDPR regarding deletion."

**ICO right-to-erasure guidance (10 Jan 2025)** — "The key issue is to put the backup data 'beyond use', even if it cannot be immediately overwritten. You must ensure that you do not use the data within the backup for any other purpose, ie that the backup is simply held on your systems until it is replaced in line with an established schedule."

**GDPR Recital 26** — "…the principles of data protection should therefore not apply to anonymous information… or to personal data rendered anonymous in such a manner that the data subject is not or no longer identifiable."

**HIPAA 45 CFR 164.530(j)(2)** — "A covered entity must retain the documentation required by paragraph (j)(1) of this section for six years from the date of its creation or the date when it last was in effect, whichever is later."

**CCPA Cal. Civ. Code 1798.105(d)** — "A business… shall not be required to comply with a consumer's request to delete the consumer's personal information if it is reasonably necessary… to: (1) Complete the transaction for which the personal information was collected… (2) … detect security incidents, protect against malicious, deceptive, fraudulent, or illegal activity… (8) Comply with a legal obligation…"

**NAIC Model #668, Section 4** — "(k) Develop, implement, and maintain procedures for the secure disposal of Nonpublic Information in any format." And: "(i) Include audit trails within the Information Security Program designed to detect and respond to Cybersecurity Events and designed to reconstruct material financial transactions sufficient to support normal operations…"

**NIST SP 800-88 Rev. 2 (Sep 2025), on Cryptographic Erase** — "CE is only applicable when all sensitive data on the storage device has been encrypted; unencrypted (plaintext) data requires other sanitization methods." And CE "may not be suitable if encryption keys have been backed up, escrowed, or stored externally."

**PJM Manual 11** — "The balancing settlement is calculated for each Real-time Settlement Interval (five (5) minute interval) based on actual five (5) minute Revenue Data for Settlement MW quantity deviations from Day-ahead scheduled quantities resulting from the dispatch run and on the applicable Real-time prices resulting from the pricing run."

**CAISO regulation qualification (arXiv:1409.5320, summarizing CAISO requirements)** — "In CAISO, the sampling rate of telemetry is every 4 seconds… CAISO requires the metering accuracy to be ±0.25%. Moreover, the data should be directly measured from the resource instead of an aggregation."

**CAISO Tariff §10 (Metering)** — provides for "Settlement Quality Meter Data" and for "Provision of Statistically Derived Meter Data… a methodology for deriving Settlement Quality Meter Data… that consists of a statistical sampling of Energy usage data, in cases where interval metering is not available for the entire population of underlying service accounts."

**OpenADR reporting (GridFabric / Plaid docs, per OpenADR 2.0b §8)** — "History usage report: logs of historical usage data (e.g. in kWh or kW)… Telemetry usage report: real-time usage data (e.g. kWh or kW), usually the most recent data point available."

**ANSI C12.20 / C12.1-2024 (NEMA)** — establishes "0.1, 0.2, and 0.5 accuracy class electricity meters… accurate to within +/-0.1%, +/-0.2%, and +/-0.5% of true value at a full load."

**FERC Order 2222 — telemetry flexibility (per FERC ISO-NE rehearing order)** — "Order No. 2222 provides RTOs/ISOs flexibility concerning metering and telemetry requirements."

---

## 4. BASE-RATE / PREVALENCE (with strongest disconfirming evidence)

**Track A — plain deletion is the norm; provable crypto-destruction with a tamper-evident log is essentially never required.** Across GDPR/UK GDPR, HIPAA, CCPA/CPRA, the 20-state wave, and NAIC #668, the operative words are "erase," "delete," "secure disposal," "rendered unreadable," "beyond use," and "anonymize" — never "cryptographic destruction." The **strongest disconfirming evidence for the founder's hypothesis** (i.e., evidence that *some* provability is expected) is: (a) the EDPB's February 2026 enforcement push to "demonstrate such erasure"; (b) CNIL fines (FREE €300k; Discord €800k) where firms could not *prove* deletion or lacked a deletion policy; and (c) HIPAA's hard six-year documentation-retention floor colliding with deletion impulses. **But none of these escalate to "cryptographic destruction" or a "tamper-evident immutable log."** Where buyers ask for "proof of deletion," they overwhelmingly mean a deletion certificate, a log entry, or an attestation — not cryptographic verifiability. NIST SP 800-88 crypto-erase is *available* and increasingly *preferred* for SSDs, but is one option among Clear / Purge / Destroy, never mandated for a single data subject's record. **Honest verdict: H-A1 is rare/false; H-A2 is real-but-modest (a retained, accurate, minimized log — not a tamper-evident ledger).**

**Track B — sub-minute revenue-grade telemetry as the settlement basis is rare-to-nonexistent.** The dominant pattern unambiguously disconfirms H-B1: **dispatch/telemetry (seconds) ≠ settlement (clock-aligned 5-/15-min/hourly interval meter, or M&V baseline).** The **strongest evidence partially supporting a telemetry requirement** is that large/AGC and California Rule-21 DERs DO carry mandatory 2–6 second telemetry, and FERC Order 2222 requires DERAs to provide "telemetry information." However, that telemetry is for *visibility and dispatch*; settlement runs on the meter-of-record or aggregate settlement data, or on baseline/M&V for behind-the-meter DR. A smart-plug energy shape (real power, Wh, V, A) is sufficient for the *settlement* question at the relevant interval; its real limitations are (i) the **accuracy class / metrological certification** of the meter-of-record and (ii) **interval alignment**, not sub-minute sampling.

---

## 5. GAPS & UNCERTAINTY

- **EDPB comprehensive Art. 17 guidelines remain unfinished** as of mid-2026 (only the search-engine Guidelines 5/2019 are final). Dedicated anonymization guidelines are "in progress" following CJEU C-413/23 P (*EDPS v. SRB*, 4 Sep 2025). **Recency risk:** the EU "Digital Omnibus" may revise Recital 26's identifiability test — verify before relying on anonymization-as-erasure long-term.
- **"Tamper-evident" specifically:** I found accountability/logging recommendations but **NO source requiring the log itself be cryptographically tamper-evident or immutable.** This is a genuine "not found" — useful, but verify against each specific buyer RFP/DPA.
- **Some CNIL backup positions** are available only via secondary reporting, not the original CNIL publication; treat those specific quotes as second-hand.
- **ISO/RTO Order 2222 timelines are still moving:** per FERC's Order 2222 status materials, SPP's proposed implementation is Q2 2030; MISO is two-phase (Phase 1 by 1 June 2027, final Phase 2 by 1 June 2029); and PJM proposed moving its DER Aggregation Model effective date from 2 Feb 2026 to 2 Feb 2028. Confirm the exact metering interval per product per RTO against the live tariff at interview time.
- **ISO/IEC 27040 and IEEE 2883** are referenced as sanitization standards but I did not retrieve their full text; like NIST SP 800-88 they describe *techniques*, not legal mandates.
- **NAIC #668 adoption count** varies by source (NAIC: 21 states; CompassMSP: "at least 28 jurisdictions") — likely a difference between formal model adoption and substantively-similar laws. Verify per target state.

---

## 6. HOW THIS SHARPENS THE INTERVIEW

### Track A

**A1 — Past erasure + proof required.**
- *Listen for:* a concrete past incident where a buyer or regulator demanded *evidence* of deletion, and exactly which artifact satisfied them (deletion certificate? log entry? attestation? screen-share?).
- *Real signal vs hand-wave:* **Real** = names the regulation, the auditor/regulator, and the precise artifact accepted. **Hand-wave** = "GDPR requires us to prove deletion cryptographically" (it does not) or a vague "compliance reasons."
- *Sharper follow-up:* "When you last had to prove a specific person's data was deleted, what exact artifact did the auditor accept — and did anyone ever require it be *cryptographically verifiable* rather than an attestation or log entry?"

**A2 — Erase-but-retain-log.**
- *Listen for:* the genuine tension — HIPAA's six-year 164.530(j) retention, CCPA's legal-obligation exception, or Art. 5(2) accountability logging — forcing them to keep a record while deleting the payload.
- *Real signal vs hand-wave:* **Real** = cites the specific retention duty and describes how they separate the *record of the action* from the *erased data*. **Hand-wave** = conflates "audit log" with "immutable blockchain ledger" without a named driver.
- *Sharper follow-up:* "Does any contract or regulator require your erasure log to be *tamper-evident/immutable*, or just accurate and retained? Can you point me to the clause?"

**A5 — Which regulation forces it, and on what timeline.**
- *Listen for:* a named statute/clause and an actual deadline, not aspiration.
- *Real signal vs hand-wave:* **Real** = "Art. 17 + our DPA clause X, 30-day SLA," or "164.530(j), six years." **Hand-wave** = "regulators are moving toward crypto-shredding" (no primary source supports this as of mid-2026).
- *Sharper follow-up:* "Can you send the exact clause and its effective date? If it says 'deletion' or 'secure disposal' rather than 'cryptographic destruction,' would your current process already satisfy it?"

### Track B

**B1 — Granularity/accuracy.**
- *Listen for:* whether they need a *settlement* interval (5/15/60-min) or are conflating it with dispatch telemetry (seconds); and what accuracy class (C12.20 0.2/0.5) the meter-of-record must meet.
- *Real signal vs hand-wave:* **Real** = "we settle on PJM 5-minute Revenue Data" or "ERCOT 15-minute IDR." **Hand-wave** = "we need sub-second revenue-grade data" (conflates the two channels).
- *Sharper follow-up:* "Is the money settled off the utility meter-of-record / an M&V baseline, or off your real-time telemetry stream? At what interval and accuracy class?"

**B3 — Trust/certification.**
- *Listen for:* a demand for a *certified* revenue meter (ANSI C12.20 / IEC 62053) vs acceptance of M&V/statistical estimation or sub-metering.
- *Real signal vs hand-wave:* **Real** = names the accuracy class and the meter certification/audit process (e.g., CAISO metering facility audits). **Hand-wave** = "it has to be revenue-grade" with no class or standard cited.
- *Sharper follow-up:* "Will an approved M&V/baseline methodology settle the resource, or do you contractually require a certified Class 0.5/0.2 meter-of-record? Which RTO/program and which tariff section?"

**B5 — Price-signal / settlement.**
- *Listen for:* clarity that price signals (OpenADR) and settlement (meter/M&V) are separate, and which one actually moves money.
- *Real signal vs hand-wave:* **Real** = "OpenADR delivers the dispatch/price; settlement reconciles against the meter/baseline at T+Xb." **Hand-wave** = treats the live telemetry feed as the settlement basis.
- *Sharper follow-up:* "Which data set actually clears payment — the dispatch/telemetry feed, or the after-the-fact interval meter / baseline? And what's the settlement timeline (e.g., CAISO T+12B)?"

---

### Closing synthesis for the founder
A local-first, event-sourced architecture that can produce a **minimized, accurate, retained record of each erasure** (request ID, timestamp, scope, action) and, optionally, **cryptographic verifiability as a differentiator**, is well-aligned with where accountability enforcement is heading (EDPB Feb 2026) — but you should **not** position crypto-shredding or tamper-evident immutability as a *legal requirement*, because no primary source makes it one. On energy, build to **clock-aligned interval data (5-/15-min) from a meter-of-record at ANSI C12.20 Class 0.5/0.2, plus clean M&V/baseline support**, and treat sub-minute telemetry as a *dispatch/visibility* feature — not a settlement gate. In both tracks, the honest, defensible posture ("standard practice already satisfies the requirement; here is where we exceed it") is stronger in front of institutional buyers than overclaiming a mandate that the statutes and tariffs do not contain.

*Source list omitted per instruction; every claim above is attributed inline to its named primary or secondary source with date and jurisdiction.*