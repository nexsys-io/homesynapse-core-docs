<!--
file: website/design-system/research/2026-06-12_brand-direction_teardown-and-validation.md
purpose: Decision-grade Brand Direction document. Validates and sharpens the W-3/W-3a brand thesis against a six-site teardown corpus; converts the Oracle-Redwood warmth rulings (W-8/W-9/W-10) into executable visual-system direction; resolves the WCAG AA accent question (C6); proposes a governance starter modeled on Oracle's O-Tag law; splits launch-necessary from maturation-phase work.
audience: Nick (ratify), future design-exploration session, copy/site work, the eventual designer.
state-type: research return + proposed direction (PENDING Nick ratification)
status: DRAFT — aligns to W-1..W-11 / C1..C11; recommendations are doc-local (ST-/AV-/TS-/BD-namespaced) to avoid colliding with the global REC namespace. Fold accepted items into the specs at the C11 reconciliation pass.
naming: name-agnostic. The product is written as ⟨Product⟩ and the parent as ⟨Parent⟩ per the W-11 rename directive (HomeSynapse/NexSys are placeholders, C&D-exposed, renaming within ~1 month).
-->

# Brand Direction — Validation & Execution (2026-06-12)

**What this is.** A single ratifiable document that (1) validates the W-3/W-3a brand thesis against a six-site teardown, (2) makes the Oracle-Redwood warmth rulings executable, (3) resolves the AA accent question with computed contrast, (4) drafts the symbol-governance law, and (5) tells you what must ship at launch versus what waits for maturation. Every "do this" cites a teardown finding (ST-/AV-/TS-n) or a named source, and aligns to the existing W-rulings and C-conflicts by number.

**Method.** Research-grade synthesis. Reference sites were fetched and read; structure, typography practice, trust signals and CTA architecture were extracted from observed markup and corroborating analyses; all WCAG values were computed locally (script archived alongside this doc, results inline in §3 and §C). Where a measurement is characteristic rather than first-hand-pixel-measured, it is marked *(characteristic)*. A later live-browser audit can promote those to first-hand if desired — flagged in §6.

---

## 1) Executive Direction (1 page)

**The thesis survives. Sharpen it, don't replace it.** The reference class ruled in W-3 — *documents like Stripe, feels like Apple, carries Oracle-era institutional weight, counterweighted by Framework's ownership ethos* — holds up against the corpus. The four references do pull in different directions on two axes (density and warmth), but the tensions resolve cleanly (§1b). The fixed posture is unchanged: **infrastructure-grade software presented with consumer-grade calm.**

Restated in the product's own terms: ⟨Product⟩ is local-first home infrastructure whose substance is *reliability, an append-only event log, full local operation with no required cloud account, and explainability* ("ask your home why"). The brand's job is to make a skeptical, evidence-reading audience (W-1: prosumers, HA/Hubitat refugees) feel that this is *serious software built to outlive trends, and built for them to own* — without a single hype move. The dossier pages are the conversion engine (W-1); the brand system is the calm, credible frame those receipts sit inside.

**The one-line filter for every page, asset, and sentence:** *Would a technical buyer who distrusts marketing read this as evidence, or as decoration?* If decoration, cut it.

### 1a) The riskiest bet, stated plainly — warmth vs. trust

**Verdict: Oracle-style warmth does NOT dilute prosumer trust *as long as warmth is confined to texture/illustration and never enters the claim layer, the type, or the UI*. Confidence: HIGH for the confinement rule; MEDIUM-HIGH that warmth is net-positive for this specific audience.**

The evidence both ways (full reasoning in §4):

- **Warmth reads as fluff when it substitutes for substance** — illustrated heroes that decorate empty claims, mascots, playful copy carrying load-bearing promises. The W-1 audience punishes this; it is exactly the "hype SaaS" anti-model W-3 already rules out.
- **Warmth reads as "approachable infrastructure" when it frames substance** — Framework is the proof case: it pairs warm, human, even playful surface treatment (pixel-art mascots, "Let's fix Consumer Electronics," a "monthly-ish" newsletter) with the most ownership-credible hardware brand in the prosumer market, and its audience (repair-minded, anti-throwaway, technical) is a near-twin of W-1. Framework demonstrates warmth and technical credibility coexisting *because the warmth never touches the spec sheet* — battery claims carry a footnoted test methodology right on the homepage. That is the model.

The resolution is structural, and it is already latent in the rulings: W-9 forbids warm palette in UI/text/actions; W-10 confines saturated illustrated "brand moments" to the homepage hero and About/Vision; the rest of the site (docs, downloads, account, dossiers) stays calm-neutral. **Warmth is allowed to be felt and never allowed to make a claim.** Hold that line and the bet is safe.

### 1b) Reference tension resolutions (the four don't conflict if scoped)

| Tension | Resolution | Anchor |
|---|---|---|
| **Apple hides complexity** vs. **⟨Product⟩ respects depth** | Adopt Apple's *pacing and economy* (one idea per viewport, confidence through restraint), reject Apple's *concealment*. The site reveals depth on demand the way Stripe does: calm surface, "go deeper" always one click away. Design-vision §2.1 already ruled this ("Here is a carefully designed default. If you want to go deeper, we will respect you"). | TS-Apple-1, design-vision §2.1 |
| **Oracle gravitas / global-institutional** vs. **W-1 warmth / "built for me"** | Framework is the explicit counterweight (W-3). Take Oracle's *texture and type maturity*; take Framework's *ownership voice and transparency receipts*. Test every hero against "would an HA refugee feel invited?" (standing tension #1). | §3 Oracle/Framework, standing tension #1 |
| **Stripe density** (many products, dense docs) vs. **Apple sparseness** | Page-intent governs density (design-vision §11): marketing/hero pages run Apple-sparse; docs and dossiers run Stripe-dense-but-disciplined. One system, two density registers — not a compromise, a mapping. | §3 Stripe/Apple, design-vision §11 |
| **Oracle's enterprise coldness markers** vs. **calm consumer warmth** | Oracle is studied as a *system* (texture, palette mechanics, governance), explicitly NOT as homepage tone. Enterprise coldness (stock "global business" photography, buzzword stacks, sales-led IA) is in the AVOID column. | AV-Oracle-1/2 |

---

## 2) Teardown Appendix — six-layer analysis per site

Layers per site: **(M)** message hierarchy → **(IA)** information architecture / page map → **(T)** typography / color / layout → **(Mo)** motion → **(Tr)** trust signals → **(C)** CTA architecture. Recommendations are numbered and tagged STEAL / AVOID / TEST, each sourced.

### 2.1 Ubiquiti / UniFi — closest business analog (highest signal for W-1)

*Prosumer/SMB network infrastructure sold with premium-consumer presentation. The exact thing ⟨Product⟩ is trying to do, one product category over.*

- **(M)** Leads with the product object rendered beautifully and a terse capability line ("Rethinking IT"); specs and the management-software screenshots carry the weight. Hardware-as-hero, software-as-proof. Message order: *what it is → see the system → the breadth*.
- **(IA)** Product-family-first, with the UniFi management UI and the "Design Center" (in-browser network planner / digital twin) as the credibility centerpiece. The site is a catalog wrapped around one unifying software story ("everything unified in an incredible software interface" — their own meta description).
- **(T)** Near-black/white architectural neutrals, single cool accent historically (`#0193d7`-class blue in their metadata), photography-led, generous whitespace, large type. Reads premium because it is *restrained and object-focused*, not because it is decorated. *(characteristic)*
- **(Mo)** Sparse, functional: product reveals, smooth scroll transitions, UI walkthroughs. Motion serves "see how the system works," not spectacle. *(characteristic)*
- **(Tr)** Trust is carried by *the software screenshots themselves* — dense, real, competent management dashboards — plus scale signals. The product UI is the proof.
- **(C)** Quiet, catalog-style ("Learn more" / configure), low-pressure. No hard conversion theatre.

**ST-UniFi-1 (STEAL):** Make the management/product UI the hero proof, not abstract illustration. ⟨Product⟩'s analog is a *real event-log / "ask why" screenshot* shown calmly (design-vision §10.1 slot 4 already reserves "one calm UI screenshot or diagram"). Source: UniFi software-as-hero pattern; design-vision §10.1.
**ST-UniFi-2 (STEAL):** Premium reads from object focus + restraint + whitespace, not ornament — this validates the Calm Canvas model (visual-design §1.2) for the highest-signal analog. Source: UniFi typography/layout.
**ST-UniFi-3 (STEAL):** A single cool accent across an infrastructure catalog is proven at scale by the closest analog — direct support for the one-accent-per-screen rule (visual-design §1.1.3) and the cool-blue interaction monopoly (W-9). Source: UniFi accent discipline.
**AV-UniFi-1 (AVOID — and weaponize):** UniFi's **unnecessary cloud-account creep** is the cautionary twin. Local-only use is "obscured through multiple layers of indirection," SSO must be *up* for SSO-linked users to log in, and they mandated MFA on cloud accounts in a way that broke local integrations (Den Delimarsky, "UniFi, Or The Story Of Unnecessary Cloud Accounts"; UniFi community threads "Why do we need a cloud login if we only want to use locally?"). This is precisely the failure ⟨Product⟩'s "No cloud account. Really." flagship (REC-171) is built against. **Do not let the brand drift there as it matures** (the maturation arc, W-3a.3): cloud convenience must never become a login dependency for local control. Source: den.dev/blog/unnecessary-cloud-stuff; community.ui.com.
**TS-UniFi-1 (TEST):** An in-browser interactive ("see your home's event log answer a question") echoing UniFi's Design Center could be the single highest-credibility asset — but it is LATER (post-launch), not launch-necessary. Source: UniFi Design Center.

### 2.2 Framework — the warmth counterweight (W-3's explicit control)

*Ownership, transparency, repair-it-forever ethos, community-forward without clutter. The audience is a near-twin of W-1.*

- **(M)** Ownership leads as identity: *"Framework Laptop 13 isn't our computer. It's yours."* / "Configure once. Upgrade whenever." The mission ("The Consumer Electronics industry is broken. We're here to fix it.") is stated as a stance, not a slogan. Message order: *it's yours → upgrade/repair forever → the mission*.
- **(IA)** Product family → Marketplace (parts/modules — the repairability proof) → Downloads & guides / Repair Guides / Community Forum → About/Sustainability. The *parts catalog and repair guides are first-class nav*, which is itself the ownership argument made structural.
- **(T)** Architectural neutrals (`#1F1F1F` tile, white-class theme in metadata) with warm, human accent moments (orange pixel-art mascots, hand-drawn "wiggle" marks). Type is clean and modern; warmth comes from *illustration and voice*, not from coloring the interface. **This is the W-9 split already working in the wild.**
- **(Mo)** Restrained product videos and scroll reveals; a marquee announcement strip. Playful in *illustration* (animated mascot gifs), calm in *layout*.
- **(Tr)** Best-in-class transparency receipts: a **footnoted battery-life test methodology printed on the homepage** (date, exact config, brightness/refresh settings, test method), open-source/GitHub presence in the footer, public blog, repair guides, sustainability page. Proof is specific, dated, and falsifiable — the prosumer's love language.
- **(C)** "Configure now" / "Learn more" pairs per product; a low-key "monthly-ish" newsletter ("Keep track of what we're working on"). The newsletter framing matches W-2's *follow-the-build* CTA almost verbatim.

**ST-Framework-1 (STEAL — flagship of the whole doc):** **The footnoted-claim pattern.** Every load-bearing number gets an inline, dated, reproducible methodology note. ⟨Product⟩ already does this in the config dossier (the encryption "µs per record, Pi-class hardware, intrinsics disabled" note). Make it a *system-wide brand signature*, not a one-off. This is how warmth and rigor coexist — and the direct answer to the warmth-vs-trust bet (§1a, §4). Source: frame.work homepage battery footnote.
**ST-Framework-2 (STEAL):** Warmth lives in *illustration + voice*, the interface stays neutral — Framework is the existence proof for W-9. Adopt its discipline: mascot/texture warmth is allowed; the buy button and the spec line are not warm. Source: frame.work visual system.
**ST-Framework-3 (STEAL):** Make ownership the *identity* line, not a feature bullet. "It's yours" is structural to ⟨Product⟩ (runs on hardware you own, works when the internet doesn't). The index.md "Yours." pillar already gestures at this — promote its confidence. Source: frame.work hero copy; index.md.
**ST-Framework-4 (STEAL):** Put the *proof surfaces in the nav* — make "receipts" (architecture invariants, event-log, the dossiers) first-class navigation the way Framework makes repair guides and the parts marketplace first-class. Source: frame.work IA.
**TS-Framework-1 (TEST):** Framework's voice runs warmer/more emoji-forward than ⟨Product⟩'s ruled voice (V&T canon, no-hype). Borrow the *warmth mechanism* (illustration, "follow the build") but calibrate the verbal register cooler — test one or two hero lines against the V&T guardrails before adopting. Source: frame.work copy vs. voice-and-tone canon.
**AV-Framework-1 (AVOID):** Framework's homepage is a fairly busy product-grid merchandising page. ⟨Product⟩ is not selling SKUs at launch (W-2: follow-the-build); resist the product-grid density. Keep the homepage to ≤6 sections (design-vision §10.1).

### 2.3 Stripe — docs craft, typography in practice, restrained accent

- **(M)** A single confident infrastructure claim — *"Financial infrastructure to grow your revenue"* — then immediately *proof at scale* (logo wall of Amazon/OpenAI/Ford; "$1.9T processed in 2025"; "99.999% uptime" linking to the live status page). Message order: *one claim → who trusts it → hard numbers → how to build*.
- **(IA)** Products / Solutions / Developers / Resources / Pricing. The **Developers/Docs path is peer-level in the primary nav**, not buried — docs are a first-class destination, signaling "for people who build."
- **(T)** Off-white/near-black neutrals, a disciplined accent (Stripe's indigo/blurple) used for links and key actions only, famously crisp typography with tight vertical rhythm and generous reading measure. Numbers are set as confident display figures (the "$1.9T / 99.999%" stat band). Body kept to a comfortable measure; docs use a stable reading column — exactly typography-ref §4.1's 65ch principle. *(characteristic)*
- **(Mo)** Signature subtle animated gradient ("wave") behind the hero, slow and ambient; otherwise minimal. Motion is mood, never demand-for-attention — matches visual-design §1.3.
- **(Tr)** The strongest trust stack in the corpus: named-customer logo wall, dated quantitative stats, a *linked live status page* (99.999% is clickable to status.stripe.com), public API docs/changelog/status, customer stories with specific metrics. Proof is layered and verifiable.
- **(C)** Dual primary CTA ("Start now" / "Contact sales") plus a persistent developer path ("View docs"). Low-pressure but always-present; "get started in 10 minutes" reduces perceived risk.

**ST-Stripe-1 (STEAL):** **Docs as a primary-nav peer.** For a "respect-depth" brand selling to builders, the documentation/architecture path belongs in the top nav, not a footer. Source: stripe.com nav.
**ST-Stripe-2 (STEAL):** **The verifiable stat band.** Replace adjectives with linked, dated figures. ⟨Product⟩'s honest analog is *architectural*, not market-scale: e.g. "every config change recorded — provable by acceptance test," linking to the invariant. Crucially, ⟨Product⟩ must *not* fake scale numbers it doesn't have (tense-truth gate, W-4); use architecture receipts as the stat band instead. Source: stripe.com stat band; W-4.
**ST-Stripe-3 (STEAL):** **One restrained accent for links/actions, confident display numerals elsewhere** — direct support for the cool-accent monopoly (W-9) and typography-ref §6.2 tabular-figure discipline. Source: stripe.com type/color.
**ST-Stripe-4 (STEAL):** **Calm surface, depth one click away** — the resolution to the Apple-vs-depth tension (§1b). Source: stripe.com progressive disclosure.
**TS-Stripe-1 (TEST):** Stripe's single ambient hero gradient is a tasteful precedent for one brand-moment motion. Test it against the W-8 motif (topo/mesh) as the homepage hero's *only* motion — but honor the strict rule: if noticed, too strong (visual-design §1.2). Source: stripe.com hero wave.
**AV-Stripe-1 (AVOID):** Stripe's homepage is *long and product-dense* (8+ "what's happening" cards, many solution tracks). That density suits a multi-product platform; ⟨Product⟩ at launch is one product with four dossiers. Take Stripe's craft, not its length. Source: stripe.com page length.

### 2.4 Apple (product pages) — economy of words, confidence pacing

- **(M)** One idea per viewport. Headline + one supporting line + one image, then scroll to the next idea. Confidence is communicated by *how little is said* and how much space surrounds it.
- **(IA)** Linear scroll narrative: hero → a sequence of single-claim full-bleed sections → tech-specs deep page for those who want it. Depth exists but is *segregated* into the specs page (the concealment ⟨Product⟩ rejects — see §1b).
- **(T)** San Francisco (self-designed; "less is more, simplicity doesn't distract from content"), with *size-specific optical outlines and dynamic tracking* and a smooth large-title→compact transition on scroll. Huge display headings, generous leading, tight tracking on display sizes. This is precisely the discipline typography-ref already encodes: optical-size axis (Inter's opsz), negative tracking on H1–H2 (§3.5), decreasing weight with size (§3.2). *(characteristic)*
- **(Mo)** Scroll-driven reveals and pinned/parallax product moments, always in service of "look at this one thing now." Sophisticated but never decorative-for-its-own-sake.
- **(Tr)** Trust is *aesthetic authority* — the polish itself is the proof. (This is the weakest transferable trust model for W-1, who want receipts, not vibes — see AV.)
- **(C)** Minimal, late, confident: "Buy" / "Learn more." Never urgent.

**ST-Apple-1 (STEAL):** **One idea per viewport; pace by whitespace.** Apply to the homepage and About/Vision: each of the ≤6 sections (design-vision §10.1) is one claim, fully breathing. Source: Apple product-page pacing.
**ST-Apple-2 (STEAL):** **Optical sizing + tracking discipline** — validates typography-ref §3.2/§3.5 from the canonical practitioner. Keep Inter's opsz axis on, negative tracking on display only. Source: Apple SF optical sizing (developer.apple.com/fonts; WWDC20 "details of UI typography").
**ST-Apple-3 (STEAL):** **CTAs late and quiet.** Resist conversion theatre; let the evidence do the work, then offer the calm next step (matches W-2 follow-the-build). Source: Apple CTA placement.
**AV-Apple-1 (AVOID):** **Concealment-as-aesthetic.** Apple hides the spec sheet behind a separate page and lets polish stand in for proof. ⟨Product⟩'s audience reads evidence and distrusts polish-as-argument (W-1). Reveal depth in-line and on demand (Stripe model), don't segregate-and-hide it. Source: Apple specs-page segregation; §1b.
**AV-Apple-2 (AVOID):** **Authoritarian "trust us" tone.** Design-vision §2.1 already rejects this explicitly. Apple's "we decided what good looks like" is the wrong posture for an ownership brand. Source: design-vision §2.1.

### 2.5 Oracle Redwood (~2019–2025) — study the *system*, not the homepage tone (W-3a)

*Via the Redwood Brand Style Guide (Oct 2024) and Redwood design-system material. Primary input to W-8/W-9/W-10 execution.*

- **(M / system level)** Brand attributes applied as a filter: **human, sophisticated, aspirational, intelligent** (Redwood guide). The intent is "put people at the center of one, undeniably Oracle story" — institutional warmth at global scale.
- **(Texture / illustration language — the core transferable asset)** Redwood illustration is built from four foundational elements: **(1) shapes and lines with visible brush strokes and rough edges; (2) data and overlay textures that selectively add visual interest; (3) abstract shapes with integrated data textures for focus/clarity; (4) design-system colors that add a rich, warm, inviting tone.** Palette "inspired by the beauty and resilience of nature" — rich, earthy, hand-drawn textures. **This is the literal source spec for W-8's "organic line-work + texture" and the W-8 hybrid (contour lines resolving into faint network/data nodes = Redwood's "abstract shapes with integrated data textures").** Source: Oracle Redwood Brand Style Guide (Oct 2024); kovaion/suzasprea Redwood writeups.
- **(Palette mechanics — source for W-9)** Earthy/warm illustration tones are a *brand-warmth layer*; the core brand color (Oracle Red) and structure stay disciplined. The warm tones do the inviting; they are not the interface. Direct precedent for the W-9 split (warm = illustration only; cool accent keeps the interaction monopoly).
- **(Governance — source for the §5 starter)** The **O-Tag / logotype is permission-governed**: "You must have Oracle's written authorization to use the Oracle logo or O Tag." Redwood also *liberated the logotype from the red rectangle* — default usage became white text reversed out of a field of color — explicitly "to reduce visual noise and up-level the overall tone." Two transferable lessons: (a) a symbol can be governed by hard usage law, and (b) *removing* a constraining container can mature a mark. Source: oracle.com/legal/trademarks; Redwood guide pp. ~7.
- **(Mo / Tr / C)** Not the transferable layers here — Oracle's enterprise homepage tone (stock global-business imagery, sales-led IA, buzzword density) is the AVOID, per W-3a's "what to AVOID (enterprise coldness markers)."

**ST-Oracle-1 (STEAL):** **Adopt Redwood's four-element illustration grammar as ⟨Product⟩'s texture spec** — brush-edged organic line-work + selective data/overlay texture + abstract shapes carrying faint data nodes + warm palette for tone. This *is* the W-8 hybrid, with a named, mature precedent. Execution detail in §3. Source: Redwood guide four-element illustration system.
**ST-Oracle-2 (STEAL):** **Warm-as-tone, never warm-as-interface** — Redwood validates W-9. Source: Redwood palette mechanics.
**ST-Oracle-3 (STEAL):** **Permission-governed symbol with a written usage law shipped day one** — the model for the §5 governance starter and W-3a.2. Source: oracle.com/legal/trademarks O-Tag authorization.
**TS-Oracle-1 (TEST):** **"Liberate the mark from its container."** When the symbol eventually joins the wordmark (post-launch), consider the Redwood move: default to the mark reversed out of a color field rather than boxed, to up-level tone. Test at symbol-design time. Source: Redwood red-rectangle liberation.
**AV-Oracle-1 (AVOID):** **Enterprise coldness markers** — stock "global business handshake/skyline" photography, buzzword stacks, sales-led IA. These are the W-1-repelling signals; Oracle is mined for its *system*, not its homepage. Source: W-3a Oracle AVOID note.
**AV-Oracle-2 (AVOID):** **Borrowed-language risk on pure topo.** W-8's own PM note: pure topographic texture is generic and "means nothing specific about ⟨Product⟩." Redwood's differentiator is the *data-texture integration* (element 3), not the contours. ⟨Product⟩'s differentiation must come from the *mesh/node* resolution (the synapse/event-graph reading), not from contour lines alone. Source: W-8 PM note; Redwood element 3.

### 2.6 Anti-models + competitive claims audit (HA, Hubitat, Homey, SmartThings, Aqara)

*Dual purpose: design anti-patterns AND a claims audit that arms the dossier pages.*

**Design anti-patterns (what to AVOID):**

**AV-Anti-1:** **Home Assistant's visual/community clutter** (already the named anti-model, W-3) — dense dashboards, screenshot-heavy community aesthetic, "hacker panel" density. ⟨Product⟩'s Calm Canvas is the deliberate opposite (design-vision §15). Source: W-3 anti-models.
**AV-Anti-2:** **Consumer "smart device dashboard" gloss** (SmartThings/Aqara app marketing) — bright saturated tiles, lifestyle photography, app-store sparkle. Violates "no bright saturated colors for large surfaces" (visual-design §7.2) and the no-hype posture. Source: design-vision §15.
**AV-Anti-3:** **Spec-by-logo-soup** — competitor sites stack protocol/ecosystem badges (Matter/Thread/Zigbee/Alexa/Google) as a wall. ⟨Product⟩'s integration claims are embargoed to shipped truth (D-1 fence, W-4); do not build a badge wall the product can't honor. Source: index.md TODO (open item 2); W-4.

**Claims audit — competitor weak points → dossier ammunition.** (Feeds the four flagship dossiers; each row pairs a competitor vulnerability with the ⟨Product⟩ dossier that exploits it. Keep every claim dated, named, and provable per the dossier guardrails.)

| Competitor | Documented weak point | Source | Dossier it arms |
|---|---|---|---|
| SmartThings | "Cloud First" architecture; only a small subset of devices/automations run locally; loses control of many devices when internet is down; users say local control "fell short of original promises." | SmartThings architecture docs; homealarmreport; community.smartthings "Cloud vs Local in 2023" | **No cloud account. Really.** (REC-171) — the account-dependency matrix |
| Home Assistant + Nabu Casa | Local-first, *but* remote access routes through a Nabu Casa cloud account; large auth-surface history (full auth-bypass CVE, Mar 2023); weak password/2FA enforcement noted by critics. Also the ADR-0010 dual-config split and trace-eviction (already in the config + explainability dossiers). | nabucasa.com/config; HA security commentary; HA ADR-0010; HA trace-eviction #117133 | **Config superiority** (split-brain), **Ask your home why** (eviction), **No cloud account** (remote-access dependency) |
| Hubitat | Strong local story, *but* ~1 MB log/event purge (history has a memory cap); provenance/attribution complaints. | Hubitat docs (per R16-A); explainability stub | **Ask your home why** (REC-145/193 — no eviction) |
| Homey Pro | Local processing, *but* missing per-event attribution / "timeline-as-debugger" limits; optional cloud backup as paid add-on. | homey.app docs; R14-A/R16-A | **Ask your home why** (attribution); **Ledger gap** (fire-and-forget) |
| Aqara | Matter enables local device control, *but* the Aqara app requires cloud auth for setup/management, and push-notifications/geofencing/weather/sunrise automations still require cloud. | us.aqara.com hub FAQs; matteralpha "local control via app" | **No cloud account** (the "local-ish, but the account is mandatory" pattern) |
| (Category) Insteon | 2022 overnight cloud shutdown degraded users' homes; ≈100k affected *(CEO estimate — keep attributed)*. | REC-179 evidence package; no-cloud stub | **No cloud account** (the "what if we disappear?" narrative) |

**The through-line for the trust architecture (§4):** every competitor's weakness is a *cloud-or-memory dependency they can't make provable*. ⟨Product⟩'s entire trust play is **provable-by-architecture** absence of those dependencies. The dossiers don't argue "we're nicer" — they show "this class of failure is unconstructible here," with receipts. That is the design brief for §4.

---

## 3) Visual-System Direction (concrete, ratifiable)

### 3.1 Motif — recommendation: **the W-8 hybrid (organic contour → faint data/synapse nodes), with Redwood's data-texture grammar as the execution method**

**Decision: build the hybrid, not pure topo and not pure mesh.** Rationale, sourced:

- Pure topographic texture is **borrowed and non-specific** (W-8 PM note; AV-Oracle-2). It buys warmth but says nothing about ⟨Product⟩.
- Pure mesh/constellation risks the **generic "tech network" cliché** and tips cooler/colder than the warmth brief wants.
- The **hybrid is the differentiator**: organic contour line-work (warmth, the Redwood "brush-edged shapes and lines," ST-Oracle-1 element 1) that *resolves, occasionally, into faint connected nodes* (the synapse/event-graph reading — Redwood element 3, "abstract shapes with integrated data textures"). This is the one motif that means something specific about an event-sourced, locally-connected home: **lines of cause and effect, settling into a graph.** It is warm *and* on-concept.

Execution rules (fold into visual-design §8.1 / website-design-vision §8.1 at C11):

1. **Contour-dominant, node-sparse.** Lines carry the field; nodes/connections are rare punctuation (a few per composition), never a dense network. Honors "if a user notices the background, it is too strong" (visual-design §1.2, the control rule W-8 preserves).
2. **Texture, not illustration-of-things.** No literal houses, devices, or icons in the field — abstract organic data-texture only (Redwood elements 2–3).
3. **Warm palette lives *here* and only here** (§3.2 / W-9). The field is where warmth is allowed to exist at saturation — and only on the W-10 brand-moment pages.
4. **Behind the canvas, never inside it** (visual-design §1.2; design-vision §8.3). Docs/downloads/account: field OFF (W-10).
5. **One motion at most**, slow (tens of seconds), ambient, reduced-motion-respecting (design-vision §7.1). The Stripe ambient-hero precedent (TS-Stripe-1) is the calibration ceiling.

**Next step is unchanged (W-3a):** this direction defines the lane; the 3–5 sample compositions (motif × warm palette over the neutrals) are what Nick vetoes before anything folds into the specs.

### 3.2 Warm illustration palette — proposed swatches, allowance, and AA notes

**All values below are computed (WCAG 2.x), not eyeballed.** Contrast is reported against the two canon surfaces: Mineral Ash `#ECEFF3` (light) and Obsidian Graphite `#0B0F14` (dark). **Per W-9 these tones are ILLUSTRATION/TEXTURE ONLY — never text, never UI, never actions.** The AA column therefore exists to enforce one rule: *if a tone is ever placed near text or used as a label/icon-control, it must not repeat the C6 mistake.* Most warm tones intentionally FAIL text contrast — which is fine, because they are forbidden from text use; the failure is the guardrail's teeth.

| Swatch | Hex | vs Light | vs Dark | Where allowed | AA note |
|---|---|---|---|---|---|
| Clay / Terracotta | `#B0654A` | 3.79 | 4.40 | Hero field, primary warm anchor | Illustration only. Passes 3:1 (graphical) on both; still **never** text. |
| Burnt Sienna (deep clay) | `#A65A3C` | 4.39 | 3.80 | Field accent, contour ink (warm) | Illustration only. Closest-to-text-safe on light but **do not** promote to text — keep the absolute rule. |
| Ochre | `#C28A33` | 2.61 | 6.39 | Field warm mid, grain | Illustration only. Fails text on light by design. |
| Muted Gold | `#B7831F` | 2.90 | 5.75 | Node/data-texture warm | Illustration only. |
| Sage-Teal | `#5E8B7E` | 3.33 | 5.01 | The bridge tone (warm↔cool), field | Illustration only. Note: this is the *only* warm-family tone adjacent to the cool accent's hue — keep it out of UI to avoid being mistaken for an interactive color (one-accent rule, W-9). |
| Deep Sage | `#46756A` | 4.54 | 3.67 | Field depth, contour ink (cool-warm) | Illustration only. |
| Warm Sand (grain) | `#D9C4A9` | 1.47 | 11.37 | Faint paper/grain texture | Illustration only; far too light for text by design. |
| Dune (faintest texture) | `#E2D3BC` | 1.28 | 13.07 | Sub-perceptual grain on light | Illustration only. |
| Warm Node | `#C9A36B` | 2.04 | 8.18 | The "synapse" node fill in the hybrid | Illustration only. |

**Palette governance (proposed, amends visual-design §5/§7 per C11):**

- **Curated and closed.** 6–9 tones max, drawn from the clay/ochre/sage-teal class (W-9). No tone added "for variety" (visual-design §7.2).
- **Saturation budget by page (W-10).** Full saturation only on homepage hero + About/Vision. Everywhere else: either OFF, or the faintest grain tones (Sand/Dune) at sub-perceptual opacity.
- **Hard firewall to UI.** No warm tone may color a link, button, focus ring, active state, label, caption, icon-as-control, or body/heading text. That space belongs exclusively to the cool accent (§3.3) and the neutrals. This firewall is the literal mechanism that makes the §1a warmth bet safe.

### 3.3 The cool interaction accent — resolving C6 (the AA blocker) with a two-tier system

**The problem, confirmed by computation:** the canon HomeSynapse Blue `#3FA6C9` gives **2.42:1 on Mineral Ash** — it fails AA text (needs 4.5:1) *and* fails the 3:1 non-text/UI-component threshold (WCAG 1.4.11) on the light surface. So it cannot legally be a link color, a label color, *or even a focus-ring color* on light. It does pass on dark (6.87:1). The Warning amber `#C7A14A` (2.11:1) and Success `#6FAE9A` (2.22:1) fail on light too. This is C6, verified.

**The resolution (C6's "two-tier accent system," now with values):** separate the *brand hue* (recognition, dark-mode, large graphical use) from the *text/UI-grade variant* (links, focus, semantic text) — and accept that **light and dark modes need different link values**, because no single blue clears 4.5:1 on both `#ECEFF3` and `#0B0F14`.

Proposed (amends visual-design §3 / typography-ref §7.2 at C11; all computed):

| Role | Light mode | vs `#ECEFF3` | Dark mode | vs `#0B0F14` |
|---|---|---|---|---|
| **Brand hue** (logo accent, large graphics, marketing diagrams) | `#3FA6C9` | 2.42 *(graphical use ≥24px / decorative only)* | `#3FA6C9` | 6.87 ✓ |
| **Link / interactive text** | `#176B85` (derived deep cyan-blue) | **5.23 ✓** | `#3FA6C9` | **6.87 ✓** |
| **Focus ring / active UI indicator** (needs ≥3:1) | `#176B85` or darker | 5.23 ✓ | `#3FA6C9` | 6.87 ✓ |
| **Warning text** (if ever set as text) | `#7E6315` (derived, computed 4.94 ✓; note `#8A6D1F` = 4.25 falls just short) | 4.94 ✓ | `#C7A14A` | 7.89 ✓ |

Notes:

- `#176B85` is a **derived text-grade sibling of the brand hue** — same cyan-blue family, dropped in luminance until it clears AA on light (5.23:1). It reads as "the same blue, darker," preserving recognition while passing. (Alternatives computed: `#236C86` = 5.11, `#1F6379` = 5.84 if more headroom is wanted.)
- **The brand hue `#3FA6C9` is not retired** — it keeps the logo/large-graphic role and is the dark-mode link color (where it passes comfortably). This satisfies "do not rely on accent color alone for recognition" (visual-design §6.3) while fixing the text path.
- **One-accent-per-screen survives** (visual-design §1.1.3, W-9): brand hue and its text-grade sibling are *the same accent*, not two competing accents.
- **Action for PM:** ratify `#176B85` (or chosen sibling) as the canonical light link/focus token; derive and verify the Warning-text sibling; both are pure derivations, no new brand color introduced.

### 3.4 Wordmark direction (W-6: wordmark-only at launch; name is a placeholder per W-11)

The name itself is blocked (W-11), so this specifies *form*, ready to apply to whatever string clears clearance.

- **Typeface:** Inter (the system voice; typography-ref §1, W-6). The wordmark is set in the same family as the product, reinforcing "designed by people who read."
- **Weight:** 600 (SemiBold) as the wordmark weight — confident but below the 700 ceiling (typography-ref §3.2 weight discipline; ultra-bold disallowed). Mature, not loud — the Oracle/Apple lesson (ST-Apple-2, ST-Oracle-1: maturity in type, not shouting).
- **Case:** lowercase or sentence-case wordmark, not all-caps. All-caps reads "enterprise/aggressive"; lowercase reads "calm, modern, owned" — aligns with the Framework/Stripe register and away from AV-Oracle-1 enterprise coldness. *(Confirm against the chosen name's letterforms at design time — a coined math-word like the W-11 candidates may favor lowercase to soften the neologism.)*
- **Tracking:** slight negative at display size (−0.01 to −0.02em, per typography-ref §3.5), default at small sizes.
- **Color:** monochrome-survivable (visual-design §6.3, W-6) — near-black on light, soft off-white on dark. Accent applied only as a *controlled secondary element* (a single dot, underline, or one-letter stroke in the brand hue `#3FA6C9`), never as the whole mark's legibility crutch.
- **Clearspace & lockup:** define clearspace = cap-height on all sides; one horizontal lockup at launch (no stacked variant until needed). A future symbol must *not require reflowing the wordmark* (W-6) — design the wordmark to stand alone permanently.
- **Feel target:** "a serious system that respects you," sitting between Stripe's typographic crispness and Framework's owned-and-human warmth — the W-3 reference class made literal in the one asset that ships at launch.

---

## 4) Trust-Architecture Recommendation — the "show the receipts" site

**Principle (from the claims audit §2.6):** ⟨Product⟩'s trust is not "we're nicer" — it is **provable-by-architecture absence of the failure classes competitors can't escape.** The site is structured so that for the W-1 reader, *the proof is always one calm click from the claim, and the proof is specific, dated, and falsifiable* (the Framework footnote pattern, ST-Framework-1; the Stripe verifiable-stat pattern, ST-Stripe-1).

**Recommended structure:**

1. **Claim → receipt pairing, everywhere (BD-Trust-1).** Every homepage pillar and every dossier headline links to its evidence: an architecture invariant, an acceptance test, a dated competitor citation, or a measured number with methodology. No load-bearing claim stands without a reachable receipt. (Pattern: ST-Framework-1, ST-Stripe-2. Already practiced in config-superiority.md — make it universal.)

2. **The four dossiers are the conversion engine (BD-Trust-2, = W-1).** Promote them to first-class navigation (ST-Stripe-1, ST-Framework-4), not a homepage afterthought. The index.md "Built different, provably" block is the seed — give the dossiers top-nav presence ("Why it's built different" / "The receipts").

3. **An "architecture commitments" surface (BD-Trust-3).** A page that publishes the invariants ⟨Product⟩ builds against (INV-CE-01, etc.) *with their acceptance tests* — the deepest receipt. This is ⟨Product⟩'s analog to Stripe's status page: the thing a skeptic can verify. Calm-neutral, docs-grade (no brand-moment).

4. **Footnoted-claim discipline (BD-Trust-4).** Adopt Framework's inline dated methodology note as a house style for every number (the encryption-µs note is the template). Where a number isn't yet shipped truth, tense-truth gate applies (W-4): frame as design commitment, not present-tense fact, until it ships.

5. **Receipt types, ranked by W-1 credibility (BD-Trust-5):** (a) acceptance test you can run > (b) published architecture invariant > (c) dated, named competitor citation > (d) measured number with methodology > (e) named-user/social proof. ⟨Product⟩ is strong on (a)–(d) and *deliberately thin on (e) at launch* (W-2: pre-following). Lean on (a)–(d); don't fake (e). This inverts Apple's "polish is proof" (AV-Apple-1), which is exactly wrong for this audience.

6. **CTA architecture (BD-Trust-6):** primary CTA = *follow the build* (email list + GitHub), per W-2 — quiet, late, Apple/Stripe-placed (ST-Apple-3). No conversion theatre (AV-Anti-2, design-vision §10.1). The dossiers' own CTA is "read the next dossier," keeping the skeptic moving through evidence.

7. **The honesty surfaces (BD-Trust-7):** ⟨Product⟩'s credibility multiplier is *documenting its own limitations* (the YAML-comment-stripping caveat, the "encryption is table stakes, not a differentiator" framing in config-superiority.md). Keep these. To the W-1 reader, an honestly-stated limitation is a stronger trust signal than any claim — and it is the single hardest thing for the hype-SaaS anti-model to copy.

---

## 5) Governance Starter — symbol/wordmark usage law (draft, modeled on Oracle's O-Tag)

*Per W-3a.2 and W-6: launch identity is wordmark-only; when a symbol eventually joins it, the symbol ships WITH this law on day one. This is a first draft for Nick to ratify the* shape *of; the symbol's specifics fill in at symbol-design time. Modeled on the Oracle O-Tag discipline (ST-Oracle-3) — "never a graphic novelty," fixed placement, permission-governed.*

**§G1 — The mark is never a decorative element.** The symbol (when it exists) and the wordmark are identity, not ornament. They never appear as a background texture, a bullet, a loading spinner, a section divider, or a "fun" graphic. (Oracle: "never treat as a graphic novelty.") The warm motif (§3.1) is the decorative system; the mark is not part of it.

**§G2 — The symbol never stands alone at launch-tier surfaces.** Until explicitly ruled otherwise, the symbol appears only in lockup with the wordmark, or in sanctioned standalone contexts defined by a future clause (favicon, app icon, social avatar) — each enumerated, none improvised. (Oracle: O-Tag has fixed, authorized placements.)

**§G3 — Fixed placement and clearspace.** The mark has defined positions (top-left nav, footer) and a clearspace = cap-height (wordmark) / defined unit (symbol). It is not repositioned per-page for visual interest.

**§G4 — Monochrome-first; accent is controlled and secondary.** The mark must survive in near-black and near-white (visual-design §6.3, W-6). The brand hue appears on the mark only as one controlled element, never as the mark's sole means of recognition.

**§G5 — The wordmark is never reflowed for a symbol.** Per W-6, the wordmark is designed to stand permanently alone; introducing a symbol must not alter the wordmark's letterforms, weight, or spacing.

**§G6 — Permission/authority clause.** Internal and third-party usage of the mark requires conformance to this law; external/partner usage requires explicit authorization (the Oracle written-authorization model, ST-Oracle-3). When a B2B/partner surface eventually exists (maturation arc), this clause is where partner-logo rules attach — pre-wired so the brand matures without a rebrand (W-3a.3).

**§G7 — Maturation-safe by construction.** No mark asset may encode "hobbyist," "anti-cloud," or identity-by-negation (W-3a.3, C5). The mark must sit equally well above a free local download page and a future paid/cloud/B2B surface.

**§G8 — Container discipline (the Redwood lesson).** If the mark is ever boxed/contained, that container is governed here and is removable; default toward the un-boxed, reversed-out-of-color treatment that "up-levels tone" (TS-Oracle-1) rather than a permanent rectangle.

---

## 6) Launch-vs-Later Split

**LAUNCH-NECESSARY** (gates W-2 publish; ties to W-5 PG rows):

- **Wordmark, fully specified** (§3.4) — satisfies PG-2; blocked only on the W-11 name.
- **Two-tier cool accent ratified** (§3.3) — `#176B85`-class light link/focus token + brand hue retained. Required for any AA-clean page; feeds PG-0 (design-system v0 / color tokens). *This is the one item with a hard correctness blocker (C6) — do it first.*
- **Neutral base + type system** (already canon: typography-ref, visual-design §2) — implement tokens (PG-0).
- **Calm-neutral page system for docs/downloads/dossiers** (no brand-moment) — the four dossiers at reviewer grade (PG-1) sit here.
- **Trust architecture §4 items 1, 2, 4, 5, 7** — claim→receipt pairing, dossiers in nav, footnote discipline, receipt ranking, honesty surfaces. These are copy/IA, not visual R&D; mostly already seeded in index.md / config-superiority.md.
- **One homepage hero brand-moment** — *one* sample composition from the W-3a veto round, not the full motif system.

**LATER (maturation-phase):**

- **Full warm-motif system at production fidelity** (§3.1) — beyond the single hero; the 3–5 sample veto round (W-3a) precedes any fold to specs (C11). Brand-moment on About/Vision can follow the homepage.
- **The symbol + its governance law activation** (§5) — W-6 defers the symbol post-launch; §5 ships *with* it when it lands.
- **Interactive proof asset** (TS-UniFi-1) — the "watch the event log answer a question" Design-Center analog.
- **B2B/partner mark clauses** (§G6) — wire-able now, activated when a B2B surface exists (W-7 defers ⟨Parent⟩ surfaces; W-3a.3 maturation arc).
- **Reading-mode serif, density modes, customization Levels 1–2** (typography-ref §9.4; design-vision §9) — post-launch polish.
- **Live-browser measurement audit** — promote the §2 *(characteristic)* typography/layout values to first-hand pixel/ratio measurements if Nick wants the teardown appendix hardened.

---

## 7) Open Questions for Nick (rule before ratification)

1. **Two-tier accent token (C6 closer).** Ratify `#176B85` as the canonical light-mode link/focus token (5.23:1), or prefer more headroom (`#1F6379`, 5.84:1)? And confirm the principle that *link color is mode-specific* (derived-dark on light, brand-hue `#3FA6C9` on dark). This unblocks PG-0. **(Recommend: `#176B85`, accept mode-specific links.)**

2. **Motif decision.** Ratify the **hybrid** (contour→node, §3.1) as the lane for the sample round — or do you still want pure-topo and pure-mesh explored as separate samples too (W-8 allows all three)? **(Recommend: hybrid-led, with one pure-topo control sample for comparison.)**

3. **Wordmark case.** Lowercase/sentence-case (§3.4) vs. a different treatment — partly contingent on the W-11 name's letterforms. Hold until the name clears, or set the *intent* now? **(Recommend: set intent = lowercase, mature, ≤600 weight; confirm against the name.)**

4. **Warm-tone count.** Lock the palette at how many tones — 6 (tightest), 9 (proposed range), or a specific subset of §3.2? Fewer = more disciplined, more maturation-safe.

5. **Stat-band honesty (ST-Stripe-2 / W-4).** Confirm that the homepage uses *architecture receipts* (acceptance tests, invariants) in the "verifiable number" slot rather than any market/scale figures — i.e. ⟨Product⟩ never imports Stripe's "$1.9T" move because it has no honest equivalent pre-launch.

6. **Docs-in-nav (ST-Stripe-1).** Ratify documentation/architecture as a *primary-nav peer* at launch, even though docs may be thin pre-1.0 — or keep docs secondary until the platform framework decision (C4) lands?

7. **Brand-moment scope at launch.** Just the homepage hero (tightest, recommended), or homepage hero *and* About/Vision both at launch (W-10 permits both, but doubles the visual-R&D surface before publish)?

8. **Where the §5 governance law lives.** Fold into `visual-design-reference.md` as a new section at C11, or stand it up as its own `brand-governance.md` canon file (cleaner for the future `nexsys-brand` skill reference)? **(Recommend: own file — it's the seed of the brand skill.)**

---

### Sources

Reference sites (fetched/observed 2026-06-12): [ui.com](https://ui.com/) · [frame.work](https://frame.work/) · [stripe.com](https://stripe.com/) · Apple typography via [developer.apple.com/fonts](https://developer.apple.com/fonts/) and [WWDC20 "The details of UI typography"](https://developer.apple.com/videos/play/wwdc2020/10175/).
Oracle Redwood: [Redwood Brand Style Guide (Oct 2024)](https://www.scribd.com/document/928424179/Oracle-Redwood-Brand-Style-Guide-Oct2024-Small-1) · [Redwood design-system overview (Kovaion)](https://www.kovaion.com/blog/all-you-need-to-know-about-oracle-redwood/) · [Brand strategy writeup (Suzanne Asprea)](https://suzasprea.com/brand-strategy-oracle-redwood-design-system) · [Oracle trademark/O-Tag authorization](https://www.oracle.com/legal/trademarks/).
UniFi cloud-account anti-pattern: [Den Delimarsky, "UniFi, Or The Story Of Unnecessary Cloud Accounts"](https://den.dev/blog/unnecessary-cloud-stuff/) · [community.ui.com "Why do we need a cloud login if we only want to use locally?"](https://community.ui.com/questions/Why-do-we-need-a-cloud-login-if-we-only-want-to-use-locally/f1df3b97-8e5a-4baf-bbf0-7a8b4eafa2a5).
Claims audit: [SmartThings cloud-first architecture](https://stdavedemo.readthedocs.io/en/latest/introduction/smartthings-architecture.html) · [SmartThings local-control limits (community)](https://community.smartthings.com/t/cloud-vs-local-in-2023/253841) · [Nabu Casa remote access](https://www.nabucasa.com/config/remote/) · [Homey Pro vs Hubitat](https://homey.app/en-us/wiki/homey-pro-vs-hubitat/) · [Aqara local-control explainer (Matter Alpha)](https://www.matteralpha.com/explainer/aqara-introduced-local-control-via-app-does-it-matter).
Internal canon: draft rulings W-1..W-11/W-3a/W-8/W-9/W-10 (`nexsys-hivemind/context/decisions/2026-06-12_website-brand-deliberation_draft-rulings.md`); conflict register C1..C11 (`website/design-system/README.md`); `visual-design-reference.md`; `typography-reference.md`; `website-design-vision.md`; dossier pages (`index.md`, `config-superiority.md`, `ledger-gap-dossier.md`, `no-cloud-account.md`, `explainability.md`).
WCAG values computed locally 2026-06-12 (script archived with this return; results inline in §3.2/§3.3 and verified against C6).
