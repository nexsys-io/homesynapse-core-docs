<!--
file: design/amendments/AMD-98_M9.4a-Consolidated_EZSP-Band-Correction_Confirmation-Pipeline-Realization.md
purpose: The M9.4a consolidated Mode-2 amendment — one substantive correction of ratified AMD-96 text (the EZSP v14 acceptance band) + the formal record of the four confirmation-pipeline realizations of already-ratified text. Rulings source: pm-handoff v18 beat-2 (Nick, 2026-07-04, verbatim record).
audience: Governance; PM; Coder.
status: RATIFIED 2026-07-04 — every constituent decision ruled by Nick in the v18 beat-2 batch; ratification lands with his docs commit (the beat-65 Lock-pass precedent: rulings on record precede the mechanical ratification commit).
watermark-note: advances the on-disk amendment watermark AMD-97 → AMD-98. Mints ZERO invariants (counts stay 174/52 — the register regeneration line is the canonical record).
-->

# AMD-98 — M9.4a Consolidated: EZSP Acceptance-Band Correction + Confirmation-Pipeline Realization

## §1 The substantive amendment: the EZSP acceptance band narrows to ==13 at the upper edge (supersedes AMD-96/E1's v14-acceptance in part)

AMD-96/E1 accepted a negotiated EZSP version up to 14 with the v14 STATUS-width dialect synthetic-tested (D-M92-4). The M9-arc adversarial review (F-1, 2026-07-04, layer-2 confirmed byte-for-byte against live-fetched bellows v13/v14 `commands.py`) established that v14 also changes the two hot wire frames the adapter implements v13-only: `sendUnicast` 0x0034 (`message_tag` u8 → u16) and `incomingMessageHandler` 0x0045 (+`timestamp` u32 with nwk/eui64 reorder — the length byte moves [18] → [30]). On v14 silicon the radio would negotiate cleanly and then drop every inbound frame — silently deaf, no PIE, no restart signal.

**Ruling (Nick, v18 beat-2, verbatim):** *"Half-right v14 support is worse than none: partially deaf is a three-hour sniffer session, PIE is a one-line diagnosis… A deaf radio that looks paired is a lying system — never-false-CONFIRMED's spirit extends to never-false-ALIVE."*

**Amended contract:** `MAX_SUPPORTED_PROTOCOL_VERSION = 13` (MIN stays 8; the 8–12 legacy-WARN band is unchanged). A negotiated version above 13 raises `PermanentIntegrationException` carrying the negotiated version, the supported band, and the AMD-96 reflash contingency (Register C voice). The `decodeStatus` v14 width seam stays in place (correct, synthetic-tested) — only ACCEPTANCE narrows. **Un-narrow condition:** the Wave-2 v14-batch unit characterizes the 0x0034/0x0045 dialect on owned silicon; the v14 codecs then land behind the same seam class as `decodeStatus`, bench-verified, and the band re-widens by amendment.

## §2 Realizations of already-ratified text (no semantic change; the M9.4a code is the enforcement arrival)

1. **Doc 08 §3.6 engine caveat 3 → ledger supersession-expiry.** A newer command on the same (entity, target attribute) expires older in-flight expectations with a recorded `command_result(outcome="superseded")` disposition — never false-fail, never false-confirm. Semantics: **issuance supersedes, not tracking success** (the caveat binds "a newer command"; an untracked newer command still moves the device); the target attribute resolves via declared outcome → derived outcome → the capability's first authoritative attribute; unresolvable expires nothing. Acceptance: the Hue fixture triple in the capability (Kelvin) domain — 6211/4630/4525 K vs the 4525 K report (the false-FAIL direction) — plus a synthetic within-tolerance pair (the false-CONFIRM direction).
2. **Doc 02 §3.8 per-device confirmability (AMD-97 paragraph) → adoption-installed overrides.** The adapter maps the matched profile's `confirmation[]` to a per-entity tuned `ConfirmationPolicy` (and per-command `CommandDefinition.defaultTimeout`) once, at adoption AND at re-link (re-derived from the cached `matchedProfileId`); the executor precedence and ledger read-path are unchanged. UNCONFIRMABLE maps to `DISABLED` (never-tracked ⇒ never-CONFIRMED, structural — AMD-97-INV-01, now loop-level-tested) with the ADAPTER rendering the immediate honest `command_result(outcome="unconfirmed")`, reason from the characterization — the "with the reason recorded" clause realized adapter-side (INV-CE-04: the reason is protocol knowledge).
3. **Doc 02 §3.8 / Doc 07 §3.11.2 parameterized expectations → ledger-side derivation.** When a command declares no `ExpectedOutcome`, the ledger derives one from the command's single required parameter + the capability's `ConfirmationPolicy` (TOLERANCE → `WithinTolerance(value, defaultTolerance)`; single-boolean EXACT_MATCH → `ExactMatch`), decoding `command_issued.parameters` via the injected persistence decoder. Derivation that cannot ground DECLINES (optimistic-in-effect, the pre-existing semantics — never a guess). `CommandIssuedEvent` stays frozen at 5 components (AMD-95 §2.B/§2.C).
4. **Doc 05 §3.7 UOE row → classifier arms.** `UnsupportedOperationException` now classifies PERMANENT (bare instanceof), and a `PermanentIntegrationException` anywhere in a cause chain classifies PERMANENT (the PIE-only cause-walk, hop-capped; wrapped anything-else stays TRANSIENT — the HA-guard preserved). Three pinned tests enforce all three directions.

**Also under this amendment's currency:** Doc 07 §3.11.2 crash-recovery scope clarified in code — a `command_issued` DURING the post-restart catch-up window (deadline still in the future) is a live command, re-indexed for normal confirmation, never classified as crash residue (`expired_on_restart` is reserved for genuinely pre-crash in-flight commands); and the ledger ignores its own disposition results (`superseded`/`expired_on_restart`/`unconfirmed`) on the terminal-match path.

## §3 Invariants

None minted. AMD-97-INV-01 (§51) gains its first loop-level enforcing test (`HeroLoopHardwareFreeIT`: a `DISABLED`/`UNCONFIRMABLE` command dispatches, renders the immediate honest verdict, and NEVER renders `state_confirmed`). Counts stay 174/52.

## §4 Traceability

Rulings: pm-handoff v18 beat-2 (canonical verbatim). Evidence: `nexsys-hivemind/context/audits/2026-07-04_M9-arc_adversarial-review_return.md` (F-1/F-2/F-3/F-5/F-10 + the hub's F-2 units annotation) · `context/pre-verifications/WU-M9.4.md` · the M9.4a instruction. Realizing commit: the M9.4a core commit (this amendment rides the same docs pass).
