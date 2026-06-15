<!-- DRAFT — the M5-C Increment-1 deliverable (2026-06-12). Prosumer/technical audience (segment rule D-4 satisfied: lead is correctness/reliability, not privacy). Matter: not mentioned (fence trivially satisfied). Encryption: supporting trust point only, §"The quiet parts" (guardrail REC-181). Review state: APPROVED 2026-06-14 (PM quality gate, veto delegated by Nick) — entry-gate row 4 CLOSED. Increment-1 acceptance met (reviewer-readable end-to-end + all three register guardrails + anti-requirements hold; INV-CE-01 blockquote verbatim-verified; no fabricated metrics). PUBLISH gates remain and do NOT gate row 4: competitor-receipt verification (HA ADR-0010 / issue numbers / openHAB #64682) before any inline promotion; the website/README open items (framework, works-with, install story). -->

# One configuration. One truth.

**Everything your home does is defined in human-readable YAML on hardware you own — and the UI edits the same files you do. Not as a feature. As an architectural invariant we publish and test against.**

---

## The problem every platform grew into

Ask a long-time smart-home user where their configuration actually lives and you'll watch them hesitate. On the most popular platforms, the honest answer is: *two places that don't agree.* There's the config you can read — the YAML you wrote by hand — and a second, opaque store the UI writes to behind your back. Home Assistant formalized this split as policy (ADR-0010), and its issue trackers have documented the consequences for years: settings that exist in one world and not the other, hand edits silently shadowed by UI state, no single file you can back up and trust to be the whole truth. openHAB carries the same scar. Once a platform has two sources of truth, every user eventually gets to discover which one wins — usually at the worst possible moment.

This isn't a bug class you can patch away. It's an architecture. The only fix is to never build the second store.

## Our answer is structural

HomeSynapse is built against a published architectural invariant — INV-CE-01 — and it says this:

> All configuration must exist in a single canonical representation that is: human-readable (documented YAML schema), machine-parseable (validated against JSON Schema), version-controllable (diffable, mergeable, suitable for Git), and the sole source of truth. The UI reads and writes this same canonical representation. **There is no separate "UI storage" and "file storage" — there is one configuration, accessible through multiple interfaces.**

The invariant ships with its own acceptance test: create something in the UI, read the file on disk, edit the file by hand, reload, and watch the UI reflect your edit. There is no second path to drift out of sync, because there is no second path.

Split-brain configuration isn't a problem we handle well. It's a problem we made unconstructible.

## Edit anywhere. Lose nothing.

UI, REST API, CLI, or your text editor over SSH — every interface operates on the same file, through a write path designed for the failure modes other platforms shipped:

- **Concurrent edits can't silently clobber each other.** Every write carries a concurrency token; if the file changed under you, the write is rejected and you're told — instead of the platform quietly picking a winner.
- **External edits are first-class, not a threat.** Hand-edit the file, reload, done. Platforms that treat the editor as an intruder lose those edits; we treat it as one more interface to the same truth.
- **Before the UI's first-ever write, the system makes a timestamped backup of your file.** And one honest limitation, documented rather than hidden: a UI write currently strips YAML comments (a known parser-ecosystem limitation). That's exactly what the backup is for, and why it exists before anything touches your hand-written file.

## Your config can't be quietly mangled

Quiet corruption is the configuration killer, so every defense here is loud by design:

- **The "Norway problem" is extinct here.** Classic YAML 1.1 parsers turn the country code `NO` into `false` and `on`/`off` into booleans. HomeSynapse locks parsing to YAML 1.2, which eliminates that entire bug class — not mitigates, eliminates.
- **Unknown keys are detected and surfaced, never silently ignored.** A typo'd option name on other platforms simply does nothing, forever. Here the schema knows every valid key, so a stray one is flagged as a warning you can see — not swallowed.
- **Validation tells you everything at once.** One pass collects every issue with type, location, and severity — no fix-one-error-reboot-find-the-next loop.
- **Startup is forgiving; a running system is protected.** At boot, a warning-grade typo won't keep your lights from working. On reload, the bar flips to strict: a bad change is rejected wholesale and the system keeps running on the prior good configuration. A reload can never degrade a working home.

## Upgrades respect your work

Schema migrations are forward-only, idempotent, and fail-closed — before migrating, the system backs up your file; if a migration can't complete safely, it doesn't half-apply. **There is no destructive forced migration, ever.** The category has shipped migrations that broke working setups; we registered the absence of that entire move as a design rule, not a hope.

## Names are labels, not load-bearing

Every device, entity, and automation has a stable typed identity that is not its display name. Rename anything — nothing breaks, no automation loses its target, no reference dangles. Renaming things you own shouldn't be a destructive operation.

## Built for version control

One diffable file tree, suitable for Git — and safe to publish, because secrets never appear in it. Your configuration references secrets by name; the values live in a separate encrypted store. You can commit your entire configuration publicly without exposing a single API key.

## You can always see why

Configuration changes aren't silent state transitions. Every validation pass and every reload is recorded as an event in the same durable event log as everything else your home does — what changed, which sections, what it required. And deliberately: those events record *that* values changed, never the values themselves. Your event log explains your home without becoming a copy of your secrets. *(More on event-sourced explainability: [Ask your home why](explainability.md).)*

## Nothing phones home

Your configuration lives on your disk and renders from your disk. There is no cloud account between you and your settings page, no registration step, no remote service that has to be up for your own home to show you its own configuration. *(The full claim, made provable: [No cloud account. Really.](no-cloud-account.md).)*

## The quiet parts

Some things should simply be true without being sold to you. A first run needs no configuration at all — every option has a schema-defined default, and an empty file boots a working system. And sensitive personal data — identity, personal presence — is encrypted at rest by default, with no toggle to find and no performance excuse to skip it: measured on Raspberry-Pi-class hardware with hardware crypto acceleration deliberately disabled, the cost is a few microseconds per record — at most 0.12% of one core at peak rates. We mention it not as a differentiator — encryption at rest is table stakes — but because we measured it on the target hardware before promising it.

## What we deliberately left out

- **No second store.** The UI writes your file or it writes nothing.
- **No templating DSL.** Configuration stays declarative — there is no embedded template language to learn, debug, or be surprised by.
- **No destructive forced migration.** Stated above; worth its own bullet.
- **No silent ignoring.** Unknown keys, failed validations, rejected reloads — everything surfaces.

The features a platform refuses to grow are the ones that keep your Sunday afternoons free.

---

*HomeSynapse is built by NexSys. The configuration system described here is Locked, ratified design — not roadmap.*

<!--
Provenance (review-only — strip at publish). Authority order per the Increment-1 brief.

LEAD/STRUCTURAL CLAIM
- Split-brain dossier: R13 §1/§3.1 via 2026-06-10_Research_13_PM_Assessment.md §B/§D — HA ADR-0010 (dual-config policy), HA issues #143/#283/#103256, openHAB #64682 (issue numbers cited per the assessment; inline copy kept general to avoid per-issue mischaracterization — reviewer may promote specific receipts inline at Increment 2 from the archived return).
- "Permanent rift" framing: INV-CE-01 "Addressed failure mode" text (Architecture_Invariants_v1.md §8).
- INV-CE-01 blockquote: VERBATIM from Architecture_Invariants_v1.md §8 (bold added). Acceptance-test description: paraphrase of the same section's Test text (paraphrased, not quoted, because the test's "lossless" wording would need the D9 comment-loss caveat inline; the caveat is disclosed in §"Edit anywhere" instead).

EDIT ANYWHERE
- Concurrency token / reject-and-tell: Doc 06 §3.5 (fileModifiedAt optimistic concurrency); shipped M6.4 (62a81e6).
- External-edits contrast: Doc 06 D6 (Z2M model rejected — "external edits silently lost").
- First-write timestamped backup + WARNING: Doc 06 §3.5 / R13 REC-131 (narrowed); shipped M6.4. Filename pattern deliberately not stated in copy (root doc is homesynapse.yaml; pattern basic-ISO).
- Comment-loss honesty: Doc 06 §3.5 + D9 (documented known limitation; SnakeYAML Engine).

CAN'T BE MANGLED
- Norway problem / YAML 1.2: Doc 06 §0 + LTD-09 ("eliminates this class of bugs entirely").
- Unknown keys → WARNING, dashboard-surfaced: Doc 06 §3.6 (additionalProperties:false), R13 REC-134 re-bucket (ALREADY-COVERED; shipped 9035110). HA failure class = silent ignoring (same row).
- Fail-complete validation: Doc 06 §3.6 / D7.
- Permissive startup / strict reload / reject-and-keep-prior-good: Doc 06 D7 + C5 + §3.3; reload path shipped M6.4.

UPGRADES
- Forward-only idempotent fail-closed migration + pre-migration backup: AMD-67 + Doc 06 §3.7 step 7; R13 REC-135 (narrowed); shipped M6.4. Anti-requirement REC-151 (no destructive forced migration) claimed as structural absence. "Major platforms have lost years of user configuration": R13 assessment §D migration issues (#157984/#142639) — kept unnamed inline.

RENAMES
- LTD-04 typed ULID identity; name≠identity: R13 §1/§3.1 rename-safety material + REC-137 row (LTD-04 closes the runtime concern; UI surfacing parked M10/M11 — copy claims the runtime property only).

GIT/SECRETS
- INV-CE-01 version-controllable text; secrets-by-name: Doc 06 P3/C3 (INV-SE-03), `!secret` resolution shipped M6.2 (7c73c91). "Commit publicly without exposing an API key": Doc 06 P3 ("can safely commit config.yaml to Git").

SEE WHY
- config.validation_completed / config.section_reloaded events: AMD-70 (RATIFIED), shipped M6.1/M6.4. Values-never-in-payloads: Doc 06 §12.4 + AMD-70 payload design (names/counts/classification only).

PHONES HOME
- REC-171 premise (file 1 B2 + file 2 "no mandatory cloud" — locked strategy ground); full dossier deferred to the stub page (Increment 2).

QUIET PARTS
- Zero-config first run: INV-CE-02 / Doc 06 C2.
- Encryption trust point (guardrail REC-181 compliance: non-headline, late placement, explicitly framed as table stakes): OQ-15-2 disposition (2026-06-12) — encrypted_scopes default CONFIRMED [identity, presence_personal]; p50 2.82–4.46 µs / p99 3.28–4.61 µs at real payload sizes (44/82 B) → "a few microseconds per record"; tax ≤0.12% of one core quoted exactly; Pi 5 with intrinsics forced OFF → "hardware crypto acceleration deliberately disabled" (the conservative case, honestly stated). No other metrics cited anywhere on this page.
- **PUBLISH GATE (tense-truth) — CLEARED 2026-06-14:** at-rest payload encryption shipped in M6.3 (`1eddd9a`, GREEN — at-rest event-payload encryption for sensitive-PII scopes [identity, personal presence]), so the §"quiet parts" sentence is now shipped-true, not design-only. Secrets encryption shipped M6.2 (`7c73c91`). The OQ-15-2 figures remain the published metrics. (Pre-M6.3 this sentence was gated to design-commitment framing; that condition is now satisfied.)

LEFT OUT
- No templating DSL: anti-requirement REC-155. No silent ignoring: §3.6 ground as above. No second store: INV-CE-01.

GUARDRAIL AUDIT (the three, ruled 2026-06-12)
- (a) Matter fence: Matter not mentioned on this page — trivially satisfied.
- (b) Commodity encryption never leads: encryption appears only in §"The quiet parts" (second-to-last section) and §"Built for version control" (secrets hygiene, not a claim of differentiation); headline/standfirst/lede clean.
- (c) Segment rule: prosumer/technical page — lead is correctness/reliability; privacy framing appears mid-page and is segment-appropriate here.

ANTI-REQUIREMENTS AUDIT: no claim implies engine retry (page is config-scoped); no templating DSL claimed as absence (correct direction); no destructive migration claimed as absence (correct direction). Grid/Assure absent (D-5 usage note).
-->
