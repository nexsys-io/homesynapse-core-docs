# Research 16-A: Logging & Observability UX — Market and Human Factors
*Target: HomeSynapse Script Output Standard + M12 evidence base + M10/M13 inputs + Doc 11 currency + M5-C copy. Date: 2026-06-12.*

## 0. Quote-back gate

### (a) §0.2 script-idiom block (all three sub-blocks, verbatim)

(i) Severity-tag output helpers:
```bash
info()   { printf "${BLUE}[INFO]${NC}  %s\n" "$1"; }
ok()     { printf "${GREEN}[OK]${NC}    %s\n" "$1"; }
warn()   { printf "${YELLOW}[WARN]${NC}  %s\n" "$1"; }
fail()   { printf "${RED}[FAIL]${NC}  %s\n" "$1"; }
header() { printf "\n${BOLD}=== %s ===${NC}\n" "$1"; }
```
Color is TTY-gated — when stdout is not a terminal, every color variable is set to the empty string (`if [ -t 1 ]; then … else RED='' GREEN='' YELLOW='' BLUE='' BOLD='' NC=''; fi`), so piped/pasted output carries the `[OK]`/`[WARN]`/`[FAIL]` tags with no ANSI noise.

(ii) Labeled `KEY:value` remote-data lines:
```bash
echo "HOSTNAME:$(hostname)"
echo "MEM_AVAIL:$MEM_AVAIL"
echo "THROTTLED:${THROTTLED#throttled=}"
```
parsed by `get_val() { echo "$REMOTE_DATA" | grep "^$1:" | head -1 | cut -d: -f2-; }`.

(iii) The machine-parseable summary line:
```bash
# Machine-parseable summary (agents parse pasted output on this line):
echo "READINESS:PASS"
```
on the all-checks-passed path (exit 0), and `echo "READINESS:FAIL:${FAILURES}"` on the failure path (exit 1). `pi4-validation.sh` adds the rest of the idiom: `--dry-run` (print the plan, do nothing), env-var configuration (`PI_HOST`, `PI_PROJECT_DIR`), `-h|--help` banners, and exit-code propagation from the remote run.

### (b) §0.3 Doc 07 §11.2 log-event names (14, in order, with levels)

`automation.run.started` (INFO) · `automation.run.completed` (INFO) · `automation.run.failed` (WARN) · `automation.run.skipped` (DEBUG) · `automation.command.dispatched` (DEBUG) · `automation.command.confirmed` (DEBUG) · `automation.command.timed_out` (WARN) · `automation.reload` (INFO) · `automation.conflict` (WARN) · `automation.disabled` (WARN) · `automation.trigger.duration.started` (DEBUG) · `automation.trigger.duration.expired` (DEBUG) · `automation.trigger.duration.cancelled` (DEBUG) · `automation.trigger.duration.limit_exceeded` (WARN)

### (c) §0.4 Register-C paragraph (verbatim)

> **Register C — Direct Neutral (UI).** *The system communicating state, action, resolution.* No self-reference (neither "HomeSynapse" nor "we"), minimal words, maximum clarity, never blames, never apologizes, never celebrates. Used for: error messages, status indicators, dialogs, tooltips, empty states, notifications.

## 1. Executive Summary

- **The single highest-impact finding: log-diving is the de-facto smart-home debugging method across all four platforms, and it is precisely the failure mode INV-TO-04 names — HomeSynapse's queryable-trace ground is therefore aimed at a real, mass, documented pain, not a hypothetical one.** Across Home Assistant, Hubitat, SmartThings, and Homey, the primary debug instruction is some variant of "check the logs," and users report giving up or resorting to SSH-and-grep, push-notification breadcrumbs, and camera footage. Verdict: build the M12 evidence base on this; it validates the Locked direction.

- **The strongest B3-differentiator evidence item: Home Assistant's own maintainers ran a "Month of 'What the heck?!'" campaign in which "What the heck turned my light on?" was a flagship entry — the exact 3am-porch-light question, raised by the platform's own community, still imperfectly answered years later.** This is gold-grade demand evidence for the Explainability differentiator and belongs in M5-C copy. Verdict: this is the dossier's spine.

- HA automation traces are genuinely good machinery but fail at the prose register: users say "most of the trace information are useless" and How-To Geek warns "Don't expect them to give you a clear and simple reason for your automation failing in plain English." HomeSynapse's delta is not more trace data — it is plain-language rendering of the same events. Verdict: M5-C + M10/M13-INPUT.

- The accessibility floor is non-negotiable and the shipped `pi-health.sh` idiom already half-satisfies it: it gates color on TTY and carries `[OK]`/`[WARN]`/`[FAIL]` text tags so semantics survive when color is stripped — exactly what WCAG SC 1.4.1 requires. Verdict: codify this in the SCRIPT-STANDARD so the floor is explicit, not incidental.

- Emoji-as-semantics in logs is a documented production-crash class and a parse hazard; the disciplined market consensus is text-tag-plus-optional-symbol, never symbol-alone. HomeSynapse's existing `[OK]`/`[FAIL]` bracket-tag idiom is already on the right side of this line. Verdict: REJECT emoji-as-semantics; codify the bracket-tag convention.

- Log-level inflation (everything-is-WARN/ERROR) is the dominant noise complaint, and HA users install recorder excludes and logger filters to cope. Doc 07 §11.2's disciplined level assignment (most events DEBUG, WARN reserved for genuine anomalies) is the correct posture; the market evidence says guard it with a documented noise budget. Verdict: M12-INPUT.

- "Friendly" error messages that hide the real error are an anti-pattern the market punishes; Register C's "never blames, never apologizes" floor plus a Rust/Elm-grade what-happened + why + what-to-do-next structure is the right synthesis. Verdict: the `config_error` payload is the existing exemplar to hold the line on; route copy guidance to M12-INPUT.

- Users pasting logs into ChatGPT/Claude is a real, documentable behavior class; the failure mode is silent truncation and loss of structure. HomeSynapse's TTY-gated plain-text fallback and stable `READINESS:` summary line are exactly the dual-channel posture that survives a paste. Verdict: M5-C + SCRIPT-STANDARD.

## 2. Deep Dives

### 2.1 Home Assistant — automation traces, Logbook, and the log-dive (deepest)

**(a) Mechanism.** HA ships three distinct surfaces: automation **Traces** (a step-by-step interactive graph of a single automation run), the **Logbook** (a reverse-chronological, plain-ish activity feed of entity state changes), and the raw **System Log** / `home-assistant.log`. Per HA's official YAML docs (home-assistant.io/docs/automation/yaml/), trace retention defaults to the last 5 runs: "Set stored_traces to the number of traces you wish to store for the particular automation. If not specified the default value of 5 will be used." The official troubleshooting doc positions the trace as the primary tool: "Every time an automation runs, Home Assistant records a step-by-step timeline of what was triggered, which conditions were checked, and what each action did" (home-assistant.io/docs/automation/troubleshooting/).

**(b) Primary-source failure quotes.**
- "I find it really hard to understand what's happening in an automation and why it stopped working… most of the trace information are useless" (community.home-assistant.io/t/why-are-automation-traces-so-hard-to-read-or-even-not-readable/767431).
- "Don't expect them to give you a clear and simple reason for your automation failing in plain English. Traces require some interpretation" (howtogeek.com/how-i-debug-my-home-assistant-automations/).
- The "Chosen trace is no longer available" eviction error: traces are capped at the last 5 runs by default, so for frequently-firing automations the relevant run is already gone by the time the user looks (community.home-assistant.io/t/automation-and-script-debugging/361630).
- The negative-trace gap, stated by the official docs themselves: "if the automation was never triggered in the first place, it will not show up in the Traces history" — so "why DIDN'T it fire?" is structurally unanswerable from traces (michaelsleen.com/troubleshooting-home-automations/; corroborated by howtogeek.com: "If there are no trace entries for that automation, the automation may not have triggered at all").
- A GitHub discussion requests color-coding trace entries by outcome because "Currently all trace entries look the same, making debugging extremely slow" (github.com/orgs/home-assistant/discussions/2027).

**(c) What users DID (Mom-Test, installed workarounds outrank complaints).**
- Installed recorder `exclude`/`include` filters in YAML to stop logbook spam (community.home-assistant.io/t/logbook-spam-where-to-configure-filters/428022).
- Ran `journalctl … | grep "kodi not ready" | wc -l` → 9553 lines, then commented out whole integrations to stop the spam (github.com/home-assistant/core/issues/44128).
- Added push notifications to phones as ad-hoc trace breadcrumbs; reviewed UniFi camera footage to reconstruct what physically happened (michaelsleen.com).
- The maintainers themselves ran a "Month of 'What the heck?!'" feature-request campaign; "What the heck turned my light on?" and "WTH Can I not find out what automation or action just turned on my light?" were entries (community.home-assistant.io/t/what-the-heck-turned-my-light-on/219488; /t/wth-can-i-not-find-out-what-automation-or-action-just-turned-on-my-light/814755).

**(d) Gap-relative lesson.** HA validates §0.5 Row 5 (INV-TO-04: "without grep") as a real unmet bar and §0.5 Row 2 (B3 explainability). HomeSynapse's no-ring-buffer attestation (traces are log events assembled by `correlation_id`, so the "Chosen trace is no longer available" eviction class is structurally absent) is a direct, citable superiority claim. The negative-trace evidence routes to M12-INPUT under Doc 11 §15 OQ1 (evidence only; resolution out of scope).

### 2.2 Hubitat — Live Logs vs Past Logs, the ~1 MB buffer, and debug-logging toil

**(a) Mechanism.** Hubitat's Logs page has a **Live logs** default tab (starts blank, fills as events arrive) and a **Past logs** tab (does not update live; size-limited buffer that purges oldest). Log types are info/debug/trace/warn/error. Debug logging on devices is auto-enabled for 30 minutes then auto-disabled (docs2.hubitat.com/en/user-interface/advanced-features/logs; /en/how-to/troubleshoot-apps-or-devices). Per the same official docs, the buffer is size-bounded: "The hub has a size-based limit on past logs, around 1 MB… Old logs will be periodically cleaned based on this size limit, with the oldest logs being removed first."

**(b) Primary-source quotes.** "You may also obtain log data from the 'Past Logs' tab… however, these are stored in a limited buffer that will purge the oldest logs when full, so you may no longer have the information you need here if the problem was not recent enough" (docs2.hubitat.com/en/how-to/collect-information-for-support). "Logs are only captured in the main log window when it is open, therefore it is necessary [to] keep it open in another tab or browser window to capture current logs" (docs.hubitat.com/index.php?title=How_to_collect_information_for_support).

**(c) What users DID.** Keep a browser tab open permanently to catch live logs; install full-page screenshot browser plugins to capture logs for support; toggle per-driver debug logging on, reproduce, then read. One user asked to "subscribe to the log stream" to auto-remediate a recurring driver error — a shipped-hack-shaped request (community.hubitat.com/t/solved-release-how-to-catch-errors-in-log/105353).

**(d) Gap-relative lesson.** The "keep a tab open or lose it" + ~1 MB purge is the same eviction failure HA has. HomeSynapse's always-on (never opt-in) diagnostics (§0.5 Row 3) and the no-ring-buffer attestation directly answer it. The 30-minute auto-disable of debug logging is the inverse of HomeSynapse's per-package dynamic levels (Doc 11 §3.6) — note as M5-C contrast.

### 2.3 SmartThings — the cautionary tale: live logging that randomly dropped, then was deleted

**(a) Mechanism / failure.** The legacy Groovy IDE provided a "Live Logging" view as the only debug surface ("SmartThings does not currently support a line-by-line, step-through debugger tool; instead, we use logging to debug our custom code" — docs.smartthings.com/en/latest/tools-and-ide/logging.html). It was unreliable, then deprecated. Per the SmartThings Support Platform Transition FAQ (support.smartthings.com/hc/en-us/articles/9339624925204), device/SmartApp migration began "October 15, 2022, at 00:00 (PST)" and "All other SmartThings and 3rd party created Groovy SmartApps will no longer be supported starting on December 31, 2022, at 00:00 (PST)."

**(b) Primary-source quotes.** "The IDE Live logging is missing log events! The SmartApp is sending debug messages but not all of them show up… This is a serious issue" (community.smartthings.com/t/ide-live-logger-broken/21051?page=2). "the same code executed twice gives different lists of log entries… more like 1 out of 4" (community.smartthings.com/t/too-many-missing-entries-in-the-ide-log/84944). Post-IDE, the only log access is the SmartThings CLI, and as one outlet noted, "a command line interface (CLI) can be overwhelming for non-developers" (thedigitalmediazone.com, 2022).

**(c) What users DID.** Re-ran functions repeatedly hoping a log line would appear; migrated to third-party tools (SharpTools); filed repeated tickets that "get closed… with nothing getting done."

**(d) Gap-relative lesson.** Two anti-requirements crystallize: (1) a log surface that silently drops entries destroys trust (reliability is a UX property); (2) deleting the human log surface and leaving only a CLI strands non-technical users. HomeSynapse's structured-log + always-on posture and the dual human/agent output contract (§0.5 Row 1) are the antidote. The reliability point is engineering-register — noted in §5.

### 2.4 Homey — the "is there a user-friendly log?" gap and timeline-as-breadcrumb

**(a) Mechanism / failure.** Homey's built-in logging is thin; the app has a "More → Logs" view filterable by device/app/flow, and an Insights tab, but users repeatedly report it does not tell them which flow changed a device's state. "the timeline says that device plugin turned it on or off instead of actual flow that did it, or [does] not state who changed device state at all" (community.homey.app/t/new-device-timeline/48299).

**(b) Primary-source quotes.** "I'm hoping there is a more user friendly log somewhere that tells me which flows/devices were activated and when?" — and the maintainer-adjacent answer was to install a third-party log app or push messages to your phone (forum.athom.com/discussion/3912). "I really like the advanced flows but it's quite hard to figure out problems… really hard to backtrace and debug" (community.homey.app/t/advanced-flows-debugging/73120).

**(c) What users DID.** Added "push a notification to my phone" log cards into flows as manual breadcrumbs, then removed them once working (to avoid clutter) — then could not debug when the problem recurred. Installed third-party logging apps (Homey logger, simple log, Papertrail).

**(d) Gap-relative lesson.** Homey shows what happens when causality attribution is missing: the user can see a state changed but not *why/by what*. This is the precise capability INV-TO-04 mandates (correlation IDs from trigger → evaluation → command) and HomeSynapse's `triggering_event_id`/`run_id` fields (§0.3) already encode. Note as M5-C contrast + M12-INPUT (the causal-attribution rendering rule).

### 2.5 Rust & Elm compilers — the error-message grammar school

**(a) Mechanism.** Rust's diagnostic structure: a level + an error code (`E0499`), a one-line message, a source span with primary/secondary labels, and `= help:`/`= note:` lines, plus `rustc --explain E0499` for the long form. The rustc dev-guide codifies the writing rules: "Write in plain simple English… Error messages should be succinct… The word 'illegal' is illegal. Prefer 'invalid'" and errors should carry a span (rustc-dev-guide.rust-lang.org/diagnostics.html). RFC 1644 set the what + why design: point "the user to both 'what' the error is and 'why' the error is occurring by using color-coded labels."

**(b) Primary-source quotes.** Rust: "cannot borrow `sausage` as mutable, as it is not declared as mutable… We should consider changing the parameter to be mutable" (ferrous-systems.com/blog/the-compiler-is-your-friend/). Elm: the compiler "presents to you in plain, simple English the exact mistake… along with suggestions for fixing it. The language designer wanted the compiler errors to act as a user guide" (jamalambda.com/posts/2021-06-13-elm-errors.html). Elm's first-person dialogue register: "I see an error" — discussed at calebmer.com/2019/07/01/writing-good-compiler-error-messages.html.

**(c) What the market DID.** Rust's error UX is cited as a top adoption driver; Elm users "try Elm just to see how great error messages can be" (se-education.org). The transferable mechanism: error-code + lookup (`--explain`) lets the short message stay terse while depth is one command away.

**(d) Gap-relative lesson.** This is the grammar for `config_error` (§0.5 Row 6: `path`, `severity`, `message`, `applied_default`, `yamlLine`). The payload already has the span (`yamlLine`) and the what (`message`); the market lesson is to add the *why* and the *what-to-do-next* in the message register — but note Elm's first-person "I" register **conflicts** with Register C's "no self-reference" rule (§0.4). HomeSynapse must take Rust's impersonal what+why+fix structure, NOT Elm's personified voice. Verdict routes to M12-INPUT (message-register rule) + DOC-11-CURRENCY note.

### 2.6 The CLI excellence class — clig.dev, `gh`, Heroku, Vagrant

**(a) Mechanism.** The consensus standard (clig.dev): "Human-readable output is paramount. Humans come first, machines second," with TTY-detection deciding format and a `--json`/`--plain` flag for machine consumers. Errors and logs go to stderr: "Send messaging to stderr. Log messages, errors, and so on should all be sent to stderr. This means that when commands are piped together, these messages are displayed to the user and not fed into the next command" (clig.dev). Discoverability: "Discoverable CLIs have comprehensive help texts, provide lots of examples, suggest what command to run next, suggest what to do when there is an error."

**(b) Primary-source quotes.** GitHub `gh`: "Some commands support passing the --json flag, which converts the output to JSON format" (cli.github.com/manual/gh_help_formatting), and `gh` auto-switches format when piped — "when gh detects that its output is piped to a script… fields are tab-delimited; we no longer truncate any text; and, there are no escape sequences for color in the output" (github.blog/engineering/engineering-principles/scripting-with-github-cli/). Heroku: "Human-readable output should be grep-parseable, but not necessarily awk-parseable… commands should offer a --json and/or a --terse flag" (devcenter.heroku.com/articles/cli-style-guide). Atlassian Forge team: error messages should be "human-readable" and "include suggestions for how to fix it" (atlassian.com/blog).

**(c) Transfer.** The shipped `pi-health.sh` idiom is *already* a textbook implementation of this class: TTY-gated color, `[OK]`/`[WARN]`/`[FAIL]` tags that survive stripping, `KEY:value` labeled lines for machine extraction, and a stable `READINESS:PASS`/`READINESS:FAIL:${FAILURES}` summary line — the human-pretty + machine-stable dual channel that `gh` formalizes. The gap is that this idiom is undocumented and unenforced; promoting it to `scripts/dev/OUTPUT_CONVENTIONS.md` (with pi-health as reference implementation) is the SCRIPT-STANDARD win.

**(d) Gap-relative lesson.** The one transferable addition HomeSynapse's scripts do NOT yet have: an explicit `NO_COLOR` honor (the de-facto standard at no-color.org: "NO_COLOR is a hint to the software… to suppress addition of color") alongside the existing TTY gate, and an explicit `--json`/structured fallback documented for agent consumers. Routes to SCRIPT-STANDARD.

### 2.7 Color, accessibility, and the NO_COLOR/TTY conventions

**(a) Mechanism.** Two independent standards govern: (1) WCAG SC 1.4.1, "Color is not used as the only visual means of conveying information, indicating an action, prompting a response, or distinguishing a visual element" (w3.org/TR/WCAG21/#use-of-color); (2) the `NO_COLOR` environment-variable convention (no-color.org) and the TTY check `[ -t 1 ]`.

**(b) What good tools DO.** The disciplined pattern: text tag carries semantics, color is decoration. The shipped HomeSynapse scripts already do this (the `[OK]`/`[WARN]`/`[FAIL]` tags persist when `NC=''`). Doc 13's Locked traffic-light health explicitly chose WCAG-AA contrast (§0.5 Row 4) — confirming the UI surface already internalized this.

**(c) Gap-relative lesson.** SCRIPT-STANDARD should state the rule verbatim: never color-only; honor `NO_COLOR`; gate on TTY. This is a codification, not a discovery.

## 3. Cross-Cutting Analysis

### 3.1 Pain-class concept map

| Pain class | HA | Hubitat | SmartThings | Homey | Best-in-class answer (RQ2) | HomeSynapse ground (§0.5 anchor) |
|---|---|---|---|---|---|---|
| "Check the logs" is the only debug path | log-dive + traces | keep tab open, read live logs | Live Logging (now deleted) | thin logs, push-msg breadcrumbs | clig.dev human-first + queryable UI | INV-TO-04 "without grep" (Row 5); Doc 11 reverse lookup (Row 3) |
| Trace/history eviction | last-5 traces (default); "no longer available" | ~1 MB Past Logs purge | n/a (logs dropped live) | timeline gaps | append-only event log | no-ring-buffer attestation; traces = events by `correlation_id` (Row 2) |
| Causality attribution ("what turned it on?") | Logbook partial; "WTH" campaign | device events vs logs split | n/a | "doesn't state who changed state" | event with cause field | `triggering_event_id`/`run_id` (Row 5/§0.3) |
| Log noise / level inflation | recorder excludes, logger filters | debug auto-off after 30 min | n/a | clutter avoidance | log-level discipline (INFO/ERROR) | Doc 07 §11.2 disciplined levels (Row 3) |
| "Why didn't it fire?" (negative) | unanswerable from traces | unanswerable | unanswerable | unanswerable | structured negative reasoning | Doc 11 §15 OQ1 (evidence → M12) |
| Color-only / accessibility | UI-dependent | UI-dependent | n/a | n/a | WCAG 1.4.1 + NO_COLOR | pi-health TTY gate + tags; Doc 13 WCAG-AA (Row 4) |
| Plain-language for non-devs | traces "useless," need interpretation | raw syslog register | raw | "user-friendly log?" | Elm/Rust plain English | B3 + Register C (Row 2/§0.4) |
| Friendly error hides real error | — | — | — | — | Rust what+why+fix, no euphemism | `config_error` payload (Row 6) |

### 3.2 THE PER-AUDIENCE NEEDS MATRIX (RQ4)

| Output surface | END-USER needs (evidence) | OPERATOR/CONTRIBUTOR needs (evidence) | LLM AGENT (market evidence only) | One surface or dual-channel? Verdict (§0.5 anchor) |
|---|---|---|---|---|
| **Live log stream** | Rarely the right surface; non-devs told "check the logs" give up (HA, Homey). Wants a readable activity feed, not a stream. | Tailable, filterable, per-package level control; grep-parseable (HA logger filters, Hubitat live tab) | Pasted into ChatGPT; breaks on truncation/lost structure | **Dual-channel**: operator gets raw structured stream; end-user gets the Logbook-class feed. Doc 11 §3.6 levels (Row 3) |
| **Named log events** (§0.3) | Indirect — surfaced only via rendered feed/UI | Stable names, snake_case fields, correlation IDs for reverse lookup | Stable event names = reliable parse anchors | **One well-designed surface** serves operator+agent; end-user via rendering. AMD-92 frozen vocab (guardrail) |
| **Error / validation messages** | what+why+what-to-do, no jargon, no blame (Rust/Elm; Register C) | path + line + severity + applied default (`config_error`) | needs the stable `path`/`severity` keys | **One surface, layered**: terse message + structured payload. `config_error` (Row 6) + Register C (§0.4) |
| **Trace / causality views** | "why did the porch light turn on at 3am?" in plain language (HA WTH campaign) | full step graph, variable states, timing | assembled-by-correlation_id JSON | **Dual-channel**: pretty timeline (Doc 13, Row 4) vs raw event set. B3 (Row 2) |
| **Health status** | traffic-light + reason string ("why is it red?") | tiered compositional health, reason strings | structured health JSON | **One surface, progressive**: Doc 13 traffic-light + Doc 11 reason strings (Rows 3/4) |
| **Script / CLI output** | mostly N/A (operator surface) | `[OK]`/`[WARN]`/`[FAIL]`, TTY color, `--dry-run`, `--help` | `READINESS:PASS` / `KEY:value` stable lines | **One surface, dual-encoded**: pi-health idiom already does both. SCRIPT-STANDARD (Row 1) |

**Matrix verdict:** The cycle's one-contract/three-consumer thesis (Row 1) holds, but the evidence demands *two genuinely dual-channel rows* — the live log stream and the trace/causality view — where the end-user rendering and the operator/agent raw form cannot be the same artifact. Everywhere else, one well-layered surface (terse human line + structured payload/keys) serves all three. The pi-health script is the proof-of-concept that dual-encoding in a single artifact is achievable for the CLI row.

### 3.3 The explainability-brand dossier (M5-C-grade)

The assembled evidence that plain-language causality is an unserved need:

1. **The exact question is the platform's own headline pain.** HA's maintainer-run "Month of 'What the heck?!'" surfaced "What the heck turned my light on?" — the porch-light-at-3am question, verbatim in spirit, raised by the community and curated by maintainers (community.home-assistant.io/t/what-the-heck-turned-my-light-on/219488). A later follow-up, "WTH Can I not find out what automation or action just turned on my light?", shows it remains imperfectly solved (/t/wth-can-i-not-find-out…/814755).

2. **The data exists but the prose register is missing.** HA traces hold the causal data, yet users call the output "useless" and How-To Geek warns it won't give "a clear and simple reason… in plain English." The gap is rendering, not data. HomeSynapse already holds the data: `triggering_event_id` → `run_id` → `automation.command.dispatched` chain (§0.3), assembled by `correlation_id` with no eviction.

3. **Competitors literally lack the attribution.** Homey users report the timeline "[does] not state who changed device state at all." HomeSynapse's INV-TO-04 correlation chain is a structural advantage, not a feature.

4. **The no-ring-buffer attestation is a clean superiority claim.** HA's "Chosen trace is no longer available" (last-5 default cap) and Hubitat's ~1 MB purge are eviction failures absent by construction in HomeSynapse (traces are durable log events).

**Dossier verdict:** This is M5-C flagship material and joins the ledger-gap dossier and no-ring-buffer attestation on the superiority backlog. The single sentence for the website: *"Ask why the porch light turned on at 3am, and get the answer in plain language — from a trace that is still there next week."* (This copy satisfies Register C: no self-reference, no blame, no exclamation, no "simply.")

### 3.4 Over-engineering check (honesty section / REJECT-candidates)

- **Always-on JFR + always-on diagnostics (Doc 11).** The human evidence strongly *supports* always-on (every platform's "keep a tab open or lose it" pain argues for it). DEFEND. No REJECT.
- **Per-package dynamic log levels (§3.6).** Operator evidence supports it (HA logger filters, Hubitat per-driver debug). DEFEND — but the human evidence says the *default* level assignment matters more than the dynamism; most users never touch levels. Flag: ensure sane defaults (a noise budget) so the feature isn't the only thing standing between the user and silence.
- **Three-level progressive disclosure (Doc 13).** Supported — clig.dev and Atlassian both stress progressive verbosity; users skim. DEFEND.
- **Negative traces ("why didn't it fire?", §15 OQ1).** The evidence says the *need* is real and universal (unanswerable on all four platforms). This is NOT over-engineering — but it is the one place where building too much (a full counterfactual engine) could bury the answer. Flag as M12-INPUT evidence; resolution out of scope.
- **Honest finding AGAINST the design:** none of the Locked machinery appears unwanted. The risk is the opposite — that the *rendering layer* (the plain-language prose register that the B3 claim depends on) is under-specified relative to the rich data machinery. The over-engineering risk is data-without-register, not machinery-nobody-needs.

## 4. Findings + Recommendations

### 4a. REC-numbered findings (ranked by (impact × confidence)/cost)

**REC-186 — Promote the pi-health output idiom to `scripts/dev/OUTPUT_CONVENTIONS.md`.** *(SCRIPT-STANDARD)* Evidence: the shipped idiom (§0.2) already implements the clig.dev human-first + machine-stable dual channel; clig.dev "Humans come first, machines second." Gap: it is undocumented and unenforced, so new scripts may drift. Recommendation: codify TTY-gated color, `[OK]`/`[WARN]`/`[FAIL]` text tags, `KEY:value` lines, and the `READINESS:` summary line as the standard, with pi-health as reference implementation. Effort: S.

**REC-187 — Codify the accessibility floor: never color-only; honor `NO_COLOR`; gate on TTY.** *(SCRIPT-STANDARD)* Evidence: WCAG 1.4.1 ("Color is not used as the only visual means of conveying information…", w3.org/TR/WCAG21/#use-of-color); no-color.org. Gap: scripts gate on TTY but do not honor `NO_COLOR`, and the rule is implicit. Recommendation: add `NO_COLOR` honoring and state the never-color-only rule explicitly. Effort: S.

**REC-188 — Build the M12 evidence base around the log-dive failure as INV-TO-04's named target.** *(M12-INPUT)* Evidence: "check the logs" is the de-facto debug path on all four platforms; HA `grep … | wc -l` → 9553 (github.com/home-assistant/core/issues/44128). Gap: confirms the bar, not a delta. Recommendation: file this corpus as the M12 milestone's motivating evidence. Effort: S.

**REC-189 — Establish a documented noise budget / level-discipline test for the §0.3 named events.** *(M12-INPUT)* Evidence: log-level inflation is the dominant noise complaint; HA users install recorder excludes/logger filters; Nicole Tietz-Sokolskaya (ntietz.com, 2024-04-22): "In practice, I tend to find that you only really want two log levels: ERROR and INFO. That's because we really do only care if something should alert us or not." Gap: Doc 07 §11.2 already assigns disciplined levels (most DEBUG, WARN reserved); evidence says guard it. Recommendation: an M12 test asserting routine-path events stay ≤ DEBUG and WARN is reserved for genuine anomalies. Effort: M.

**REC-190 — Adopt the Rust/Elm what+why+what-to-do error grammar for `config_error`, in Register C voice.** *(M12-INPUT)* Evidence: rustc-dev-guide writing rules ("plain simple English… 'illegal' is illegal"); Elm "user guide" errors; Atlassian "include suggestions for how to fix it." Gap: `config_error` (§0.5 Row 6) has `path`/`yamlLine`/`message` (the what + where) but no codified why/fix register. Recommendation: a message-register rule — state what failed, why, and the corrective action, impersonally (NOT Elm's first-person "I", which violates Register C). Effort: M.

**REC-191 — Specify the plain-language causality rendering rule for the end-user trace view.** *(M10-M13-INPUT)* Evidence: HA "WTH turned my light on?" campaign; traces "useless"/"not in plain English"; Homey "doesn't state who changed state." Gap: Doc 13 Locked the trace timeline UI; the prose register that B3 depends on is under-specified. Recommendation: park a rule that the end-user rendering reads as "X happened because Y" using friendly names, sourced from the same `correlation_id`-linked events the operator sees raw. Effort: M.

**REC-192 — Resolve the entity-ID-vs-friendly-name vocabulary split for user-facing surfaces.** *(M10-M13-INPUT)* Evidence: HA's multi-year friendly-name confusion and the architecture push to retire `friendly_name` (github.com/home-assistant/architecture/discussions/1185); "Change words in Logbook" requests (community.home-assistant.io/t/change-words-in-logbook/71070). Gap: the same event must show a technical ID to the operator and a friendly name to the end-user. Recommendation: park a vocabulary rule — user-facing surfaces render friendly names; operator/agent surfaces retain stable IDs. Effort: M.

**REC-193 — File the no-ring-buffer / no-eviction attestation as M5-C superiority copy.** *(M5-C-COPY)* Evidence: HA "Chosen trace is no longer available" (last-5 default cap); Hubitat ~1 MB Past Logs purge. Gap: HomeSynapse traces are durable events assembled by `correlation_id` (Row 2). Recommendation: a superiority note — "the trace is still there next week." Effort: S.

**REC-194 — File the plain-language-causality story as the B3 brand surface (the dossier).** *(M5-C-COPY)* Evidence: §3.3 dossier. Recommendation: ship the "why did the porch light turn on at 3am?" narrative as flagship B3 copy. Effort: S.

**REC-195 — File the "logs survive a paste into an LLM" property as M5-C + verify in SCRIPT-STANDARD.** *(M5-C-COPY)* Evidence: users paste logs into ChatGPT; silent truncation/structure loss is documented (dev.to truncation report). HomeSynapse's TTY-stripped plain text + stable `READINESS:` line survive a paste. Recommendation: a superiority note that structured output pastes cleanly; verify the property is preserved by the SCRIPT-STANDARD. Effort: S.

**REC-196 — Add a Doc-11 currency note distinguishing the impersonal Register-C error voice from Elm's first-person model.** *(DOC-11-CURRENCY)* Evidence: Elm's celebrated "I see an error" register (calebmer.com) directly conflicts with Register C "no self-reference" (§0.4). Gap: a future contributor reading "adopt Elm-grade errors" could import the wrong voice. Recommendation: a currency note on the next Doc-11-touching amendment clarifying that HomeSynapse takes Rust's impersonal what+why+fix, not Elm's personified voice. Effort: S.

**REC-197 — Capture the negative-trace ("why didn't it fire?") need as M12 evidence under §15 OQ1.** *(M12-INPUT)* Evidence: unanswerable on all four platforms; HA docs admit non-triggered automations "will not show up in the Traces history." Gap: HomeSynapse §15 OQ1 is open; this is evidence for the need, not a resolution. Recommendation: file the corpus to the OQ1 evidence base. Effort: S.

**REC-198 — REJECT emoji-as-semantics in logs and script output.** *(REJECT)* Evidence: documented Windows production crash from emoji in logging (medium.com/@vincent.mico, 2026); "Don't print emoji to logs… logs should be machine-readable (grep-readable)" (funnelfiasco.com); HN "no emojis please, ever… breaking grep" (news.ycombinator.com/item?id=25311114); Claude CLI bug where emoji in code "breaks parsing" (github.com/anthropics/claude-code/issues/5058). Even pro-emoji advocates concede text status words must remain (thelinuxcode.com: "Do not rely only on emoji color/shape for status. Keep plain text status words too."). Gap: HomeSynapse's `[OK]`/`[FAIL]` bracket tags are already the correct, parse-safe convention. Recommendation: REJECT emoji-as-semantics; the bracket-tag idiom stands. Effort: S.

**REC-199 — REJECT silently-lossy or opt-in-only log surfaces (the SmartThings failure).** *(REJECT)* Evidence: SmartThings Live Logging dropped ~1-in-4 messages ("the same code executed twice gives different lists"); maintainers closed tickets; the surface was ultimately deleted (Dec 31 2022). Gap: HomeSynapse's always-on, durable, structured posture is the opposite. Recommendation: REJECT any future proposal for a best-effort/lossy or developer-only-toggle primary log surface; reliability is a UX property. Effort: S.

**REC-200 — REJECT "friendly" error copy that euphemizes away the actual fault.** *(REJECT)* Evidence: Register C "never blames, never apologizes" plus the market lesson that euphemistic errors hide the real error; clig.dev/Atlassian demand actionable specifics. Gap: a naive reading of "be friendly" risks the anti-Register-C failure. Recommendation: REJECT vague/euphemistic error copy; require the literal `path`/`message`/fix. The DAS bans ("oops", exclamation marks, "simply/just/easily") already enforce this — REJECT is a guardrail restatement, not new ground. Effort: S.

### 4b. THE DISPOSITION TABLE

| REC | One-line finding | Disposition (exactly one) |
|---|---|---|
| REC-186 | Promote pi-health idiom to OUTPUT_CONVENTIONS.md | **SCRIPT-STANDARD** |
| REC-187 | Never color-only; honor NO_COLOR; TTY gate | **SCRIPT-STANDARD** |
| REC-188 | Log-dive corpus = INV-TO-04's named target | **M12-INPUT** |
| REC-189 | Noise-budget / level-discipline test for §0.3 events | **M12-INPUT** |
| REC-190 | Rust/Elm what+why+fix grammar for config_error, Register-C voice | **M12-INPUT** |
| REC-191 | Plain-language causality rendering rule (end-user trace) | **M10-M13-INPUT** |
| REC-192 | Friendly-name vs entity-ID vocabulary split | **M10-M13-INPUT** |
| REC-193 | No-ring-buffer / no-eviction attestation | **M5-C-COPY** |
| REC-194 | Plain-language-causality B3 dossier | **M5-C-COPY** |
| REC-195 | "Logs survive an LLM paste" property | **M5-C-COPY** |
| REC-196 | Currency note: impersonal Register-C voice ≠ Elm "I" | **DOC-11-CURRENCY** |
| REC-197 | Negative-trace need as §15 OQ1 evidence | **M12-INPUT** |
| REC-198 | Emoji-as-semantics | **REJECT** |
| REC-199 | Silently-lossy / opt-in-only primary log surface | **REJECT** |
| REC-200 | Euphemistic "friendly" error copy | **REJECT** |

No REC appears in two buckets. **FUTURE** is intentionally empty: every finding lands inside an existing surface, milestone, or guardrail — none requires a post-MVP contract delta or new feature, because the register fence forbids minting one and the Locked machinery already spans the design space. This is a genuine emptiness, not laziness.

## 5. Caveats and Open Questions

**Connector-blindness declaration.** I had no reachable connection to the homesynapse-core-docs knowledge base during this pass; all HomeSynapse identifiers used (the §0.2 script idiom, the 14 §0.3 event names, `config_error`/`ConfigIssue`/`yamlLine`, INV-TO-04, projectionVersion 5, Doc 07/11/13 references, AMD-92, §15 OQ1) are quoted **verbatim from the embeds in this brief**. I reconstructed nothing and invented no type, event, or doc-section names. Any HomeSynapse fact not in the embeds is flagged below as a gap rather than asserted.

**Source-reliability grading.**
- **Gold (primary, maintainer/official):** WCAG spec (w3.org), no-color.org, rustc-dev-guide, Rust RFC 1644, clig.dev, Heroku/Atlassian CLI guides, HA official troubleshooting + YAML docs, Hubitat official docs, SmartThings official docs + shutdown announcements, HA maintainer "WTH" campaign threads, HA architecture discussion #1185, the `gh` manual + GitHub engineering blog.
- **Silver (community, 2+ independent or corroborated):** HA/Hubitat/SmartThings/Homey forum threads (multiple independent reports each), HA core GitHub issues.
- **Bronze (secondary/aggregator, used only for framing, labeled):** How-To Geek, newerest.space, michaelsleen.com, vcloudinfo.com, alert-fatigue vendor blogs (level.io, Sensu, PagerDuty, IBM, Splunk), emoji-in-logs opinion posts (baker.is, dev.to, thelinuxcode), terminal-color explainers. These are quarantined to corroboration/illustration; no load-bearing verdict rests on a bronze source alone.

**Freshness horizons.**
- SmartThings Groovy IDE shutdown: dated and final — per the Platform Transition FAQ, unsupported "starting on December 31, 2022, at 00:00 (PST)"; stable historical fact.
- HA traces/Logbook behavior, last-5 default cap, recorder filters: verified against 2024–2025 docs and threads; HA ships monthly, so the *mechanism* is current but specific UI labels may drift — re-verify any UI-label-dependent finding before M10/M13 drafting.
- Hubitat ~1 MB Past Logs buffer: from current docs2.hubitat.com; stable but worth a spot-check at implementation time.
- HA friendly-name → entity-name migration (architecture #1185, core 2026.4): in-flight as of early 2026; the *direction* (retire `friendly_name`) is maintainer-stated, but the rollout is ongoing — flagged as evolving.
- WCAG 1.4.1: WCAG 2.1 Recommendation, edited 2025-05-06; normative and stable.

**Findings AGAINST the design / honest negatives.**
- None of the Locked observability machinery is contradicted by the human evidence; the honest risk is the *opposite* — the plain-language rendering register that the B3 claim depends on is thinner in the Locked record than the data machinery is (see §3.4). If that register is never specified, B3 is a data claim wearing a UX claim's clothes.
- I could not close the question of whether HomeSynapse's end-user surfaces will actually default to friendly names (the embeds don't say) — REC-192 is therefore an input/park, not a confirmation.

**INCOMPLETE-EVIDENCE declaration.** My web_search budget was exhausted at 18 calls before I could run three planned queries: (1) a primary `cargo`/`tailscale` changelog quote on status verbs, (2) the WCAG SC 1.4.1 verbatim normative text, and (3) "vendor dashboards nobody reads." Items (1) and (2) were recovered via the targeted subagent (WCAG and `gh` quotes are now primary-sourced; a `cargo`/`tailscale` changelog quote remains unobtained — the CLI-class verdict instead rests on clig.dev + `gh` + Heroku, which is sufficient). Item (3) — the "vendor dashboards nobody reads" anti-pattern — is **PARTIALLY INCOMPLETE**: I have strong adjacent evidence (alert fatigue: per IDC's 2021 report, cited by Sensu, companies with 500–1,499 employees "ignored or failed to investigate 27% of all alerts," rising to 30% for 1,500–4,999 and 23% for 5,000+; plus the SmartThings dashboard-people-stopped-trusting pattern) but no single primary source specifically on unused vendor logging dashboards. The REJECT/anti-requirements bucket would be strengthened by closing this; it does not undermine any REC currently filed.

**Out-of-register engineering observations (one line each).**
- Reliability of the log surface is itself a UX property (SmartThings dropped-message failure) — engineering register; routes to the sibling.
- Structured-format selection (JSON Lines vs logfmt) for the agent channel surfaced repeatedly but is the sibling's call.
- Correlation-ID propagation internals (trigger → evaluation → command) are assumed by INV-TO-04 but their mechanics are engineering-register.

## 6. Appendix: Sources (URL families by platform/exemplar)

**Home Assistant (official):** home-assistant.io/docs/automation/troubleshooting/ · home-assistant.io/docs/automation/yaml/ · home-assistant.io/dashboards/logbook/ · home-assistant.io/docs/configuration/customizing-devices/ · github.com/home-assistant/core/issues/44128 · github.com/orgs/home-assistant/discussions/2027 · github.com/home-assistant/architecture/discussions/1185
**Home Assistant (community):** community.home-assistant.io threads — 767431 (traces hard to read), 361630 (trace no longer available), 428022 (logbook spam), 590165 (single-mode spam), 350334 (filter "already running"), 219488 (WTH turned my light on), 814755 (WTH which automation), 71070 (change words in Logbook), 656911 (what/who turned on light), 358822 / 563321 / 958803 (no-trace cases)
**Hubitat (official):** docs2.hubitat.com/en/user-interface/advanced-features/logs · /en/how-to/troubleshoot-apps-or-devices · /en/how-to/collect-information-for-support · docs.hubitat.com (How_to_collect_information_for_support) · community.hubitat.com/t/solved-release-how-to-catch-errors-in-log/105353
**SmartThings:** docs.smartthings.com/en/latest/tools-and-ide/logging.html · community.smartthings.com — 21051 (IDE logger broken), 84944 (missing entries), 144720 (live logging reliability), 246280 (end of Groovy) · support.smartthings.com/hc/en-us/articles/9339624925204 (Platform Transition FAQ) · thedigitalmediazone.com (Groovy retirement, 2022)
**Homey:** community.homey.app — 41883 (how to debug flows), 73120 (advanced flows debugging), 48299 (new device timeline), 73487 (timeline issue) · forum.athom.com/discussion/3912 (user-friendly log?)
**Rust / Elm:** rustc-dev-guide.rust-lang.org/diagnostics.html · rust-lang.github.io/rfcs/1644-default-and-expanded-rustc-errors.html · ferrous-systems.com/blog/the-compiler-is-your-friend/ · jvns.ca/blog/2022/12/02/a-couple-of-rust-error-messages/ · kobzol.github.io/rust/rustc/2025/05/16/evolution-of-rustc-errors.html · jamalambda.com/posts/2021-06-13-elm-errors.html · calebmer.com/2019/07/01/writing-good-compiler-error-messages.html · se-education.org/learningresources/contents/elm/Elm.html
**CLI excellence:** clig.dev · cli.github.com/manual/gh_help_formatting · github.blog/engineering/engineering-principles/scripting-with-github-cli/ · devcenter.heroku.com/articles/cli-style-guide · developer.hashicorp.com/vagrant/docs/cli/machine-readable · atlassian.com/blog/it-teams/10-design-principles-for-delightful-clis · thoughtworks.com/insights/blog/engineering-effectiveness/elevate-developer-experiences-cli-design-guidelines
**Color / accessibility / NO_COLOR:** w3.org/TR/WCAG21/#use-of-color · no-color.org · man7.org/linux/man-pages/man5/terminal-colors.d.5.html · github.com/termstandard/colors
**Log levels / noise:** ntietz.com/blog/the-only-two-log-levels-you-need-are-info-and-error/ · betterstack.com/community/guides/logging/log-levels-explained/ · sematext.com/blog/logging-levels/
**Emoji-in-logs (anti-requirement):** medium.com/@vincent.mico (Windows emoji crash) · funnelfiasco.com/blog/2019/04/18/emoji-in-console-output/ · news.ycombinator.com/item?id=25311114 · github.com/anthropics/claude-code/issues/5058 · thelinuxcode.com (emoji guide, ASCII-fallback advice)
**Alert fatigue:** pagerduty.com/resources/digital-operations/learn/alert-fatigue/ · sensu.io/blog/alert-fatigue-in-sre-and-devops (IDC 27% / 30% / 23%) · ibm.com/think/topics/alert-fatigue · splunk.com (Target breach) · logicmonitor.com/blog/network-monitoring-avoid-alert-fatigue
**LLM paste / truncation:** dev.to/totalvaluegroup (truncation) · gist.github.com/rikhoffbauer (truncation workaround)
**Timestamps:** dev.to/nithish_rodrigo (log timeframes) · reviews.freebsd.org/D14918 (syslog ISO-8601 -Z) · ibm.com/docs (UTC/ISO-8601 logging)

## 7. HomeSynapse Code-Level Implications [LIGHT — observations only, routed via §4b]

- The shipped `info()`/`ok()`/`warn()`/`fail()`/`header()` helpers and the `[ -t 1 ]` color gate (§0.2(i)) are the de-facto output standard; OUTPUT_CONVENTIONS.md should reference them by name (REC-186). No new identifiers.
- The `READINESS:PASS` / `READINESS:FAIL:${FAILURES}` summary line and `KEY:value` + `get_val()` pattern (§0.2(ii)/(iii)) are the existing machine channel; they survive an LLM paste because color is TTY-stripped (REC-195). No change proposed.
- `config_error` with `path`, `severity`, `message`, `applied_default`, `trigger` and `ConfigIssue.yamlLine` (§0.5 Row 6) is the existing error-payload exemplar; the what+why+fix register guidance (REC-190) attaches to the `message` field's *content*, not its schema. No schema change.
- The §0.3 event names (`automation.run.*`, `automation.command.*`, `automation.trigger.duration.*`) and fields (`run_id`, `automation_id`, `triggering_event_id`, `duration_ms`) are the correlation chain INV-TO-04 and the B3 dossier rely on. AMD-92 freezes this vocabulary; nothing here proposes a change (REC-189/194 measure against it).
- Doc 11 §15 OQ1 (negative traces) receives evidence only (REC-197); no resolution proposed.