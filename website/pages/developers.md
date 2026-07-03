<!-- NEW (2026-07-03 website lane) — the R-3 developer/integrations surface (assessment §3 watchlist item 2), in the truthful posture: "SDK maturing — the adapter contract is frozen and documented." Voice: Register A (senior engineer). Spine: L-12 — breaking changes are a contract. Every factual claim carries a provenance row below; integration/device claims match shipped truth at authoring (re-verify at publish). Name-light tokens per W-11. -->

# Build on {{productName}}

**The honest version first: the SDK is maturing. What's frozen — and documented — is the thing that matters: the adapter contract.** If you build an integration against it, you're building against a surface we treat the way we treat the event log: append-only, versioned, never quietly rewritten.

## What exists today

- **A deliberately small integration contract.** Two interfaces — a factory and an adapter — plus an optional command handler. The adapter surface is four required methods and four optional lifecycle hooks. That's the whole contract, and it's frozen: changes since the freeze have been additive, by rule.
- **One dependency.** An integration depends on one module — the integration API. It cannot reach into the engine's internals, and the engine never depends on any integration. Core boots and passes CI with the integration set empty; extensions are guests, never load-bearing.
- **Test fixtures ship with the contract.** A stub context and a reference test adapter exist so an integration can be built and tested without hardware, against the same harness we use.
- **The command spine is live.** Commands flow from the event log through routing to adapters and back as honest results in the current tree — proven end-to-end against a registered test adapter, with replay safety pinned by CI.
- **An honest actuation model.** Adapters report what devices actually said; the platform tracks every command to a confirmed, failed, or expired outcome and never renders unconfirmed as success. Your integration inherits that honesty — you don't have to build it.
- **The first radio integration is being brought up now.** Zigbee, on real hardware, on our bench. We publish integration claims when they ship, not before.

## What we deliberately do not claim

- **No device-count marketing.** You will not find a "works with 2,000 devices" banner here — device support is listed when it ships and is tested.
- **No dynamic plugin loading — yet.** Today an integration compiles into the application; runtime plugin loading is a formally reserved seam, not a shipped feature. We'd rather tell you that plainly than let you discover it.
- **No sandbox claims before the rung exists.** Extension isolation is a designed ladder we climb in the open; we claim only the rung that is built and enforced.

## Breaking changes are a contract

The graveyard of smart-home ecosystems has a repeating signature: a kill date announced before the replacement reached parity, "seamless migration" promises, and tooling removed mid-transition. Developers who bet years on those platforms watched the ground disappear on a schedule they didn't set.

Our position is the opposite, stated as policy: **a breaking change is a contract between us and everyone who built on the old behavior.** Released artifacts are versioned; compatibility ranges are declared; migrations are forward-only and non-destructive; deprecations come with a named floor, not a surprise. The reserved extension seams exist precisely so that when the SDK and distribution story mature, they activate additively — never as a re-architecture, and never as a forced migration for people who built against the frozen contract.

And one principle already settled ahead of any marketplace: **community-contributed integrations will never sit behind a paywall.** If we ever charge for anything around the ecosystem, it will be for convenience and services — not for access to what the community built.

## What's coming (staged honestly, no dates)

- A formally reserved extension architecture — the governance document that names every seam (operation registry, event-manifest layering, the isolation ladder, namespace and identity rules) is in authoring now.
- A curated first-party integration wave, quality-gated, before any open distribution channel.
- A marketplace only when it can meet a real trust floor: a registry of record, per-version automated checks, revocation that reaches installs, and a labeled core/community split.

## License and following along

{{productName}} Core is Apache-2.0 licensed — chosen deliberately so community and commercial integrations can coexist, with patent protection MIT doesn't carry. The repository, the interface documentation, and the integration guide accompany the public release.

*If you've built for platforms that pulled the rug, read [One configuration. One truth.](config-superiority.md) — the same refusal to break working setups, applied to configuration. It's the house style.*

<!--
Provenance (review-only — strip at publish; the site build strips automatically):

POSTURE
- "SDK maturing — the adapter contract is frozen and documented": the sanctioned truthful posture verbatim (2026-07-02 extensibility assessment §3 watchlist item 2 / R-3; the 2026-07-03 website-lane brief §2.3).

WHAT EXISTS TODAY
- Two interfaces + optional command handler; 4 mandatory + 4 default hooks: assessment §1 (IntegrationFactory 2 methods; IntegrationAdapter 4 mandatory + 4 default AMD-55 hooks; optional CommandHandler). Frozen at M4.C; AMD-54..64; additive-only per AMD-55-INV-01 ("changes since the freeze have been additive, by rule").
- One module dependency ("requires com.homesynapse.integration" — literal kept OUT of copy for name-light): assessment §1. Engine-never-depends-on-integrations + boots-with-empty-set: EXT-INV-1 candidate ground (charter §2) + M9.1's empty-factories Phase-6 skip (composition root boots with zero integrations — shipped truth, core ec2e3b4).
- Test fixtures (StubIntegrationContext / TestAdapter): assessment §1 ("testFixtures shipped").
- Command spine live: M9.1 landed core ec2e3b4 (command_issued → command_dispatched → CommandRoutingSubscriber → CommandHandler on per-adapter executors; fake-adapter E2E T18–T20; INV-ES-09 replay purity pinned in CI). "honest results": failure-only command_results published by the router (M9.1 note); the ledger consumes them.
- Honest actuation model: Doc 07 §3.11.2 Pending Command Ledger (shipped M7.3) + AMD-97 ratified confirmation semantics + AMD-97-INV-01 never-false-CONFIRMED (§51).
- Zigbee on real hardware IN PROGRESS: M9.2 authored issue-ready 2026-07-03 (EZSP-first per DP-C; bench Wave-1 hardware received 2026-06-23). "publish claims when they ship": the brief's shipped-truth rule + README open item 2.

WHAT WE DO NOT CLAIM
- No device-count marketing: brief §2.3 ("No 'works with 2,000 devices'").
- Static composition today / dynamic loading reserved: assessment §2 (dynamic loading triple-banned: DECIDE-04 + LTD-16/17 + ArchUnit NO_SERVICE_LOADER; amendable-by-written-intent seam in the IntegrationFactory javadoc); charter §3 seam 1.
- No sandbox claims before the rung exists: DP-18-B RULED (beat-57) — the honesty rule as doc text; charter §3 seam 4 (the four-rung ladder; RESERVED_SUBPROCESS in the IsolationLevel enum, designed-deferred).

BREAKING CHANGES ARE A CONTRACT
- The ecosystem-killing signature (kill date before parity, "seamless" promises, tooling removed mid-transition): dossier L-12 [SmartThings Groovy ST-1/2/3/6; Chrome MV3 CR-1/2/7] — receipts-backed, platforms kept general-but-recognizable in copy; C2 dossier-register amendment direction (dated, specific comparisons allowed; anxiety framing avoided — the framing here is our policy, not fear).
- Versioned artifacts + declared compat range + forward-only non-destructive migration + named deprecation floor: DP-18-A RATIFIED (beat-57, PROJECT_SNAPSHOT masthead 2026-07-03) — the ruled direction stated as policy; the floor's N is deliberately unquantified (unpinned until Doc 18 Locks).
- "Additive activation of reserved seams — never a re-architecture, never a forced migration": charter §1 done-if criterion (L-12, L-13).
- Community content never paywalled: DP-18-C RULED (a) (beat-57) — "community content never paywalled — monetize trust/convenience/cloud, not access" ruled as the standing principle; phrased as forward commitment ("will never").

WHAT'S COMING
- Doc 18 in authoring (seam reservation; operation registry / event-manifest layering / trust ladder / namespace governance): charter §1–§3 (final, returned 2026-07-02); "in authoring now" true at beat-57 ("Doc 18 authoring FULLY UNBLOCKED — the hub's immediate next work product").
- Curated wave-1 before open distribution: DP-18-B ruling (wave-1 curated IN_JVM behind the quality gate).
- Marketplace trust floor (registry of record, per-version checks, revocation/kill-switch, labeled two-tier split): charter §3 seam 7 (the Q7 synthesis floor).
- NO DATES anywhere: the brief's rule ("no dates you can't source") — the strategy's 0–12/12–24-month lines are deliberately not repeated here.

LICENSE — ⚠ PUBLISH GATE (config-superiority precedent)
- "Apache-2.0 licensed": the LOCKED licensing decision (Revenue_Model_and_Licensing_Strategy.md — "HomeSynapse Core is licensed under Apache 2.0"; patent-protection rationale ibid.). The repo LICENSE file at authoring (2026-07-03) is still the pre-release proprietary placeholder — VERIFY the LICENSE flip has landed before this page publishes. "accompany the public release" phrasing keeps repo/docs availability tense-honest pre-publish.

GUARDRAIL AUDIT
- Matter fence: Matter not mentioned — trivially satisfied. Encryption: not mentioned (never-lead rule trivially satisfied). Segment rule (D-4): developer surface — reliability-of-contract lead, correct register. Grid/Assure: absent (D-5). Anti-requirements: no engine-retry implication; no templating DSL; no destructive migration — the page claims the absence direction only. Install story: not mentioned (W-4 embargo untouched). No superlatives ("only/unique/patented") used on this page.
-->
