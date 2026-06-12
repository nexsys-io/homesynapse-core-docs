# Research 16-B: LLM-Legible Output Engineering — Structured Logging and Agent-Parseable Tooling
*Target: HomeSynapse Script Output Standard + M12 evidence base + Doc 11 currency. Date: 2026-06-12.*

## 0. Quote-back gate [M — FIRST]

**§0.2(i) — Severity-tag output helpers (both scripts):**
```bash
info()   { printf "${BLUE}[INFO]${NC}  %s\n" "$1"; }
ok()     { printf "${GREEN}[OK]${NC}    %s\n" "$1"; }
warn()   { printf "${YELLOW}[WARN]${NC}  %s\n" "$1"; }
fail()   { printf "${RED}[FAIL]${NC}  %s\n" "$1"; }
header() { printf "\n${BOLD}=== %s ===${NC}\n" "$1"; }
```
Color is TTY-gated — when stdout is not a terminal, every color variable is the empty string (`if [ -t 1 ]; then … else RED='' GREEN='' YELLOW='' BLUE='' BOLD='' NC=''; fi`): piped/pasted output carries the `[OK]`/`[WARN]`/`[FAIL]` tags with no ANSI escapes.

**§0.2(ii) — Labeled `KEY:value` remote-data lines:**
```bash
echo "HOSTNAME:$(hostname)"
echo "MEM_AVAIL:$MEM_AVAIL"
echo "THROTTLED:${THROTTLED#throttled=}"
```
parsed by `get_val() { echo "$REMOTE_DATA" | grep "^$1:" | head -1 | cut -d: -f2-; }`.

**§0.2(iii) — The machine-parseable summary line:**
```bash
# Machine-parseable summary (agents parse pasted output on this line):
echo "READINESS:PASS"
```
on the all-checks-passed path (exit 0), and `echo "READINESS:FAIL:${FAILURES}"` on the failure path (exit 1). `pi4-validation.sh` adds: `--dry-run`, env-var configuration (`PI_HOST`, `PI_PROJECT_DIR`), `-h|--help` banners, timestamped local results directories, and remote exit-code propagation (`exit "${GRADLE_EXIT_CODE}"`).

**§0.3 — Doc 07 §11.2 log-event names (14, in order):**
`automation.run.started` (INFO) · `automation.run.completed` (INFO) · `automation.run.failed` (WARN) · `automation.run.skipped` (DEBUG) · `automation.command.dispatched` (DEBUG) · `automation.command.confirmed` (DEBUG) · `automation.command.timed_out` (WARN) · `automation.reload` (INFO) · `automation.conflict` (WARN) · `automation.disabled` (WARN) · `automation.trigger.duration.started` (DEBUG) · `automation.trigger.duration.expired` (DEBUG) · `automation.trigger.duration.cancelled` (DEBUG) · `automation.trigger.duration.limit_exceeded` (WARN)

**§0.4 — `CausalContext` record + module-info:**
```java
public record CausalContext(
        Ulid correlationId,
        Ulid causationId
) {
```
`correlationId` = "the root event's event ID, propagated unchanged through all downstream events in the chain; never null"; `causationId` = "the immediately preceding event's event ID; null for root events only".
```java
/**
 * Event model — types, envelope, publisher, store, and bus interfaces.
 */
module com.homesynapse.event {
    requires transitive com.homesynapse.value;
    requires transitive com.homesynapse.platform;

    exports com.homesynapse.event;
}
```

**§0.5 — Register-C paragraph:**
> **Register C — Direct Neutral (UI).** *The system communicating state, action, resolution.* No self-reference (neither "HomeSynapse" nor "we"), minimal words, maximum clarity, never blames, never apologizes, never celebrates. Used for: error messages, status indicators, dialogs, tooltips, empty states, notifications.

## 1. Executive Summary [M]

1. **The shipped `READINESS:PASS` / `READINESS:FAIL:${FAILURES}` idiom is already best-in-class and should be promoted verbatim to a project-wide convention** — it is the exact pattern `git status --porcelain` (stability-guaranteed) and TAP (`ok`/`not ok` + plan line) codify, so the highest-leverage move is not invention but codification into `scripts/dev/OUTPUT_CONVENTIONS.md`. This is the single highest-impact finding: it is gate-free and shippable today.

2. **The single rule the shipped idiom most needs to fix: error/status messaging is written to stdout, not stderr.** The pi-health `info/ok/warn/fail` helpers all `printf` to stdout; both the Google Shell Style Guide and clig.dev mandate that diagnostics go to stderr so the machine-readable summary on stdout stays clean for piping. This is a genuine defect, not a stylistic preference, and is a SCRIPT-STANDARD fix.

3. **OpenTelemetry log/trace semantic conventions should be borrowed as a *vocabulary* (snake_case field keys, `trace_id`/`span_id`-style correlation) but the collector/exporter must stay rejected** — LTD-15 already locks no OTel/Prometheus export in MVP, and putting a collector on a Pi 4 is a §0.6-row-6 violation. Partial adoption (field names only) is cheap and aligns with `correlation_id`/`entity_id`/`integration_id` already in MDC.

4. **JSON Lines (one JSON object per line) is the correct structured-log *format* and is already implied by LTD-15's "structured JSON encoder"; logfmt is the right *human-glance* dev format but should not be the production wire format.** JSON Lines preserves the one-object-per-line invariant that line-based agent pagination depends on — the same token-economics law that governs HomeSynapse's multi-thousand-token-line prohibition.

5. **MDC on virtual threads is a real, under-appreciated correctness hazard that M12 must pin with a test.** `ThreadLocal`-backed MDC is not inherited across `StructuredTaskScope.fork()` and leaks across pooled-thread reuse; since HomeSynapse runs work on virtual threads, the M12 logging implementation must pin "every log line emitted while handling an event carries that event's `correlation_id`" with an explicit propagation mechanism (TaskDecorator-style copy, or JDK 25 Scoped Values — JEP 506 was finalized as a permanent feature in JDK 25, the September 2025 LTS release, after five preview/incubation rounds in JDKs 20–24, with one API change versus the previews: `ScopedValue.orElse` no longer accepts `null` as its argument), validated by a spike.

6. **A project-wide dotted log-event naming convention is already 95% satisfied by the §0.3/§11.2 tables; the only currency gap is the non-uniform metric prefixes** (`hs_events_*`, `hs.device.*`, `config.*`) flagged in §0.3 — that is a DOC-11-CURRENCY note, never an amendment.

7. **`NO_COLOR` / TTY-gating is already done correctly in the shipped scripts and should simply be written down as a rule** — pi-health's `[ -t 1 ]` gate already produces clean non-TTY output; adding explicit `NO_COLOR` support is a small, standards-aligned enhancement.

8. **The agent-consumer contract (§3.2) is the cycle's load-bearing deliverable and is fully derivable from existing UNIX prior art plus Anthropic's published tool-design guidance** — there is credible primary LLM-agent engineering evidence for bounded output: Anthropic's engineering post "Writing effective tools for AI agents" (Sep 11 2025) states, "For Claude Code, we restrict tool responses to 25,000 tokens by default. We expect the effective context length of agents to grow over time, but the need for context-efficient tools to remain." So the agent rules are sourced, not speculative.

## 2. Prior-Art Deep Dives [M]

### 2.1 OpenTelemetry log/trace semantic conventions (RQ1, RQ3, RQ4)
**Mechanism.** OTel semantic conventions are versioned and move fast: as of mid-2026 the OTel docs site shows Semantic Conventions **v1.41.0**, with the latest GitHub release at **v1.41.1** (a Kubernetes codegen fix only, no semantic changes); the naming rules sit in the "stable" tier. The Logs Data Model defines top-level `TraceId` and `SpanId` fields: "Can be set for logs that are part of request processing and have an assigned trace ID… If SpanId is present TraceId SHOULD be also present." The W3C Trace Context `traceparent` carries `version-traceid-parentid-traceflags`, e.g. `00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01`, with `trace-id` a 16-byte globally-unique identifier ("All bytes as zero … is considered an invalid value").

**Quotation (primary).** OTel naming spec: "All names that are part of OpenTelemetry semantic conventions SHOULD be part of a namespace… Semantic Conventions tooling limits names to lowercase Latin alphabet, Numeric, Underscore, Dot (as namespace delimiter). Names must start with a letter, end with an alphanumeric character, and must not contain two or more consecutive delimiters." (https://opentelemetry.io/docs/specs/semconv/general/naming/) On governance: "Attributes, metrics, and events SHOULD NOT be removed from semantic conventions regardless of their maturity level. When the convention is renamed or no longer recommended, it SHOULD be deprecated."

**Failure modes.** The Logs SDK does not exist for log *creation* — OTel logs are a bridge over existing frameworks, and the log semantic conventions are explicitly "still evolving." Adopting the data model wholesale implies a collector. High-cardinality attributes on metrics are an explicit anti-pattern. Dots-vs-underscores instability: backends (Uptrace, Prometheus) rewrite `.` to `_`, so a dotted key is not stable across the toolchain.

**Gap-relative lesson.** Borrow the *vocabulary and namespacing discipline* (§0.6 row 2: adoption is pattern-level, never stack-level). HomeSynapse's `correlation_id` MDC key (§0.4) is the OTel `trace_id`-in-logs pattern already. REJECT the collector (§0.6 row 6). The OTel deprecation-not-deletion rule is directly applicable to the §0.3 log-event names as a stable-name-as-API governance model (RQ4).

### 2.2 JSON Lines vs logfmt (RQ1)
**Mechanism.** JSON Lines (jsonlines.org, maintained by Ian Ward): three rules — UTF-8 (no BOM), each line a valid JSON value, `\n` separator (`\r\n` tolerated). logfmt (first documented by Brandur Leach at Heroku; reference Go impl by Blake Mizerany & Keith Rarick, never formally standardized): flat `key=value otherkey="value with spaces"` pairs, one level only.

**Quotation (primary).** JSON Lines spec: "JSON Lines enables applications to read objects line-by-line, with each line fully describing a JSON object… allows applications to split files on newline boundaries for parallel loading, and eliminates any ambiguity if fields are omitted or re-ordered." (https://jsonlines.org/) logfmt (Brandur): "it's pretty easy for a human being to read logfmt… Building a machine parser for the format is also pretty approachable. Logfmt therefore achieves pretty good readability for both human and computer, even while not being optimal for either." (https://brandur.org/logfmt)

**Failure modes.** logfmt has no standard, treats dotted keys as flat strings (no nesting), and quoting ambiguity around spaces. JSON Lines is verbose (clutter for human glance) and a single malformed line breaks only that line (a resilience *benefit*). Brandur later switched Stripe-style canonical lines to full JSON because the aggregator parses it anyway.

**Gap-relative lesson.** LTD-15 already specifies a "structured JSON encoder" (§0.6 row 2), so the production format is JSON-per-line = JSON Lines; this is LOCKED, not an open question. The one-object-per-line invariant is what makes the in-house token-economics law enforceable (bounded line length; line-based pagination). logfmt is at most a dev-console nicety, not the wire format.

### 2.3 systemd journal fields (RQ1, RQ3, RQ4)
**Mechanism.** HomeSynapse runs under systemd, so journal field conventions are directly relevant. User fields are UPPERCASE (`MESSAGE`, `PRIORITY`, `MESSAGE_ID`); trusted (kernel-stamped) fields are underscore-prefixed (`_PID`, `_SYSTEMD_UNIT`, `_BOOT_ID`); serialization-internal fields are double-underscore (`__CURSOR`, `__REALTIME_TIMESTAMP`). `MESSAGE_ID` is a 128-bit hex UUID for "recognizing certain message types," generated via `systemd-id128 new`. `PRIORITY` is the syslog 0–7 scale (0 emerg … 7 debug).

**Quotation (primary).** "MESSAGE_ID= A 128-bit message identifier ID for recognizing certain message types, if this is desirable. This should contain a 128-bit ID formatted as a lower-case hexadecimal string… recommended to be a UUID-compatible ID." "PRIORITY= A priority value between 0 ("emerg") and 7 ("debug") formatted as a decimal string. This field is compatible with syslog's priority concept." (https://www.freedesktop.org/software/systemd/man/latest/systemd.journal-fields.html)

**Failure modes.** Uppercase + underscore convention collides with snake_case/dotted styles if logs are dual-emitted to the journal and a JSON file. The `MESSAGE_ID` catalog (message-as-stable-ID) is a maintenance burden few projects keep current.

**Gap-relative lesson.** The `MESSAGE_ID` concept is the journal analogue of the §0.3 named-log-event taxonomy — a stable identifier per message type. HomeSynapse's dotted event names (`automation.run.started`) already serve this role and are more legible than 128-bit hex. The journal `PRIORITY` 0–7 scale maps cleanly onto the §0.3 INFO/DEBUG/WARN level assignments. No daemon adoption needed beyond what systemd already provides.

### 2.4 SLF4J / Logback MDC + virtual threads (RQ1, RQ3)
**Mechanism.** MDC is a per-thread `ThreadLocal`-backed map; Logback layouts interpolate MDC keys into each line. HomeSynapse runs work on virtual threads — the engineering hazard.

**Quotation (primary).** Logback manual: "a child thread does not automatically inherit a copy of the mapped diagnostic context of its parent… MDC operations such as put() and get() affect only the MDC of the current thread, and the children of the current thread." (https://logback.qos.ch/manual/mdc.html) On virtual threads (JEP 444 series, per Java Code Geeks, May 2026): "Virtual threads do support ThreadLocal for backward compatibility — but when you use Structured Concurrency's StructuredTaskScope.fork()… InheritableThreadLocal inheritance does not happen… your MDC trace ID, your security context, your tenant identifier — all silently absent in the forked virtual thread."

**Failure modes.** Two distinct: (a) **missing context** across `fork()`/async boundaries (trace ID absent on child lines); (b) **leaked/wrong context** on pooled-thread reuse when a `finally`/`MDC.clear()` is missed — "subtly wrong data… A field that should belong to user A's request quietly appears in log lines for user B's." The long-term fix is JDK 25 Scoped Values (JEP 506), finalized as a permanent feature in the September 2025 LTS release after five preview/incubation rounds in JDKs 20–24 (the one API change versus the previews: `ScopedValue.orElse` no longer accepts `null`). Diagnostic flag: `-Djdk.traceVirtualThreadLocals=true`.

**Gap-relative lesson.** §0.4 makes `correlation_id` the join key between a log line and its causal chain; if MDC propagation silently drops it across a virtual-thread boundary, the "one causal story" breaks exactly where diagnosis matters most. This is an M12-INPUT obligation (pin + test) inside the LOCKED LTD-15 contract, plus a spike candidate.

### 2.5 clig.dev — Command Line Interface Guidelines (RQ2, RQ5)
**Mechanism.** Modern CLI design manifesto (Aanand Prasad, Ben Firshman, Carl Tashian, Eva Parish). Core rules: machine-readable output to stdout, messaging to stderr; isatty detection; `--plain` and `--json` for machine consumers; respect `NO_COLOR`.

**Quotation (primary).** "The primary output for your command should go to stdout. Anything that is machine readable should also go to stdout… Log messages, errors, and so on should all be sent to stderr." "The most simple and straightforward heuristic for whether a particular output stream… is being read by a human is whether or not it's a TTY." "Display output as formatted JSON if --json is passed." "Check general-purpose environment variables… NO_COLOR, to disable color." (https://clig.dev/)

**Failure modes.** Human-first vs machine-readable tension is "the central challenge of CLI design" (CLIG authors, InfoQ). Auto-detection (isatty) can guess wrong in pipelines; explicit flags are more robust.

**Gap-relative lesson.** pi-health already gets isatty-gating right (§0.2(i)) but violates the stdout/stderr split (all helpers go to stdout). The `READINESS:` line is exactly the "machine-readable to stdout" rule. SCRIPT-STANDARD: codify dual-channel (human pretty on stderr, summary line on stdout) and a `--json`/`--kv` candidate.

### 2.6 git `--porcelain` stability guarantee (RQ2, RQ5)
**Mechanism.** `git status --porcelain[=v1]` emits a stable, config-independent, color-free format explicitly contracted for scripts.

**Quotation (primary).** "Version 1 porcelain format is similar to the short format, but is guaranteed not to change in a backwards-incompatible way between Git versions or based on user configuration. This makes it ideal for parsing by scripts… The user's color.status configuration is not respected; color will always be off." (https://git-scm.com/docs/git-status)

**Failure modes.** A second format version (v2) was needed when more data was required — versioning the machine format is the discipline that lets it evolve without breaking parsers.

**Gap-relative lesson.** This is the gold standard for the §0.2(iii) `READINESS:`/`KEY:value` lines: once an agent greps a line, that line's grammar is an API. SCRIPT-STANDARD must declare the summary-line grammar stable and color-free (pi-health already strips color in non-TTY — §0.2(i)).

### 2.7 TAP — Test Anything Protocol (RQ2, RQ4)
**Mechanism.** Line-based test result protocol: a version line (`TAP version 14`), a plan (`1..N`), and test lines (`ok`/`not ok` + number + description). Bail-out (`Bail out!`) halts everything.

**Quotation (primary).** "This tells whether the test point passed or failed. It must be at the beginning of the line. /^not ok/ indicates a failed test point. /^ok/ is a successful test point. This is the only mandatory part of the line." "The plan tells how many tests will be run… It's a check that the test file hasn't stopped prematurely." (https://testanything.org/tap-specification.html) Harness rule: "A harness must only read TAP output from standard output and not from standard error."

**Failure modes.** Unknown lines are deliberately tolerated (forward-compat) — a parser must not treat unknown lines as errors. Without a plan line, premature death is undetectable.

**Gap-relative lesson.** TAP's plan line is the "how many checks were expected" guarantee pi-health lacks; the `1..N` + line-anchored `ok`/`not ok` is the direct ancestor of `READINESS:PASS` and the `[OK]`/`[FAIL]` tags. The "verdict must be line-anchored at start of line" rule validates the `READINESS:`/`grep "^$1:"` anchoring (§0.2(ii)).

### 2.8 NO_COLOR / CLICOLOR (RQ2, RQ5)
**Quotation (primary).** "Command-line software which adds ANSI color to its output by default should check for a NO_COLOR environment variable that, when present and not an empty string (regardless of its value), prevents the addition of ANSI color." (https://no-color.org/) bixense CLICOLOR adds `CLICOLOR_FORCE` and `--color=auto|always|never`.

**Gap-relative lesson.** pi-health's `[ -t 1 ]` gate satisfies the spirit; adding an explicit `NO_COLOR` check is a cheap standards alignment (SCRIPT-STANDARD).

### 2.9 GNU/POSIX exit codes + sysexits.h (RQ2, RQ5)
**Mechanism.** Conventional taxonomy: 0 success, 1 general failure, 2 usage/error class. grep: "the exit status is 0 if a line is selected, 1 if no lines were selected, and 2 if an error occurred." BSD `sysexits.h`: `EX_USAGE 64`, `EX_DATAERR 65`, etc. clig.dev: "For usage errors, exit with code 2… Use 1 for other general errors. When types of errors need to be distinguished, use codes in the range 3–125."

**Quotation (primary).** grep(1): "Normally the exit status is 0 if a line is selected, 1 if no lines were selected, and 2 if an error occurred." (https://www.gnu.org/software/grep/manual/html_node/Exit-Status.html)

**Failure modes.** sysexits is "discouraged" by some modern engineers (consensus: 0/1 + stderr message). An agent parsing a *paste* cannot see the exit code — hence the summary line carries what the exit code cannot.

**Gap-relative lesson.** pi-health already does the right two-tier thing: `READINESS:PASS` (exit 0) / `READINESS:FAIL:${FAILURES}` (exit 1) AND propagates remote exit codes (`exit "${GRADLE_EXIT_CODE}"`). The deep lesson for the agent contract: **a pasted agent cannot see `$?`, so the verdict MUST be in the text** — this is the entire rationale for the `READINESS:` line and is the most important RQ2 finding.

### 2.10 Google Shell Style Guide (RQ5)
**Quotation (primary).** "All error messages should go to STDERR. This makes it easier to separate normal status from actual issues. A function to print out error messages along with other status information is recommended. `err() { echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')]: $*" >&2 }`." Also: "Prefer printf over echo as echo has a number of issues when run in scripts (especially portability)." (https://google.github.io/styleguide/shellguide.html)

**Gap-relative lesson.** pi-health uses `printf` (good, matches the guide) but routes `warn`/`fail` to stdout (bad). The Google `err()`-to-stderr pattern is the exact fix. SCRIPT-STANDARD.

### 2.11 Anthropic agent-tool design (RQ2) — primary LLM-agent evidence
**Mechanism.** Anthropic's engineering guidance for tools consumed by LLM agents, the closest credible primary source to HomeSynapse's agent-paste workflow.

**Quotation (primary).** "We suggest implementing some combination of pagination, range selection, filtering, and/or truncation with sensible default parameter values for any tool responses that could use up lots of context. For Claude Code, we restrict tool responses to 25,000 tokens by default." "If you choose to truncate responses, be sure to steer agents with helpful instructions… if a tool call raises an error… you can prompt-engineer your error responses to clearly communicate specific and actionable improvements, rather than opaque error codes or tracebacks." "They should prioritize contextual relevance over flexibility, and eschew low-level technical identifiers (for example: `uuid`, `256px_image_url`, `mime_type`)." (https://www.anthropic.com/engineering/writing-tools-for-agents, Sep 11 2025) Context-engineering principle: "finding the smallest possible set of high-signal tokens that maximize the likelihood of some desired outcome." (https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents, Sep 29 2025) The scale of the problem is concrete in Anthropic's own figures: in "Introducing advanced tool use" Anthropic reports that "we've seen tool definitions consume 134K tokens before optimization," and its Tool Search Tool yielded "an 85% reduction in token usage" (with Opus 4.5 MCP-eval accuracy improving from 79.5% to 88.1%).

**Failure modes.** This is vendor engineering guidance (high-quality, but a single vendor); ULID/UUID-as-string at API boundaries (HomeSynapse coder-convention) sits in tension with "eschew low-level technical identifiers" — but HomeSynapse's dotted event names and labeled keys already favor semantic legibility.

**Gap-relative lesson.** Directly validates the in-house token-economics law (bounded output volume; multi-thousand-token lines defeat pagination) with named external evidence. The "verdict in the last 3 lines of a 400-line paste" and "tail-carries-the-verdict" rules are the script-layer expression of "smallest set of high-signal tokens." Confirms the §0.2(iii) summary-line design is correct by an LLM-specific source.

## 3. Cross-Cutting Analysis [M]

### 3.1 Convention concept map
| Concern | Surveyed answers | HomeSynapse ground (anchor) |
|---|---|---|
| Format | JSON Lines (jsonlines.org); logfmt (Brandur); journal export JSON | LTD-15 "structured JSON encoder" → JSON-per-line (§0.6 row 2) |
| Naming | OTel dotted+namespaced; snake_case keys; journal UPPERCASE | snake_case keys (`run_id`, `entity_id`); dotted event names (§0.3) |
| Correlation | W3C `traceparent`; OTel `trace_id`/`span_id` in logs; MDC | `CausalContext.correlationId` propagated unchanged; `correlation_id` MDC join key (§0.4) |
| Dual-channel | clig.dev `--json`/`--plain`; git `--porcelain`; terraform `-json` | TTY-gated color (§0.2(i)); `READINESS:` line (§0.2(iii)) |
| Summary-line | TAP `ok`/`not ok`+plan; git porcelain; `READINESS:` | `READINESS:PASS` / `READINESS:FAIL:${FAILURES}` (§0.2(iii)) |
| Exit codes | grep 0/1/2; sysexits.h; clig.dev 2=usage,1=general | exit 0/1 + remote `exit "${GRADLE_EXIT_CODE}"` (§0.2(iii)) |
| Bounded output | Anthropic 25k-token default; tail-with-verdict | in-house token-economics law (no multi-thousand-token lines) |

### 3.2 THE AGENT-CONSUMER CONTRACT TABLE (RQ2) — draft skeleton of the Script Output Standard
| # | Rule | Prior-art source | Shipped-idiom status | Disposition |
|---|---|---|---|---|
| A1 | Verdict on a single line-anchored, greppable key (`READINESS:PASS`) — agent reading a paste cannot see `$?` | grep exit-status (the verdict must be in text); TAP `^ok` | SATISFIES (§0.2(iii)) | SCRIPT-STANDARD (REC-201) |
| A2 | Summary line last + position-stable | TAP plan-line; canonical log line (Brandur/Stripe) | SATISFIES (last on exit path) | SCRIPT-STANDARD (REC-201) |
| A3 | Stable, color-free, config-independent machine format = an API | git `--porcelain` stability guarantee | SATISFIES (color stripped non-TTY) | SCRIPT-STANDARD (REC-202) |
| A4 | Labeled `KEY:value` lines, one datum per line, `^KEY:` anchored | git porcelain; logfmt; JSON Lines one-object-per-line | SATISFIES (§0.2(ii)) | SCRIPT-STANDARD (REC-203) |
| A5 | Diagnostics→stderr, machine output→stdout | clig.dev; Google Shell Style Guide | VIOLATES (helpers all → stdout) | SCRIPT-STANDARD (REC-204) |
| A6 | No ANSI/spinners/CR tricks in non-TTY; honor `NO_COLOR` | no-color.org; clig.dev; isatty | SATISFIES isatty; SILENT on `NO_COLOR` | SCRIPT-STANDARD (REC-205) |
| A7 | Bounded output volume; tail carries the verdict | Anthropic (25k default, smallest high-signal set) | SATISFIES (compact, verdict-last) | SCRIPT-STANDARD (REC-206) |
| A8 | Two-tier exit codes (0 pass / 1 fail) + propagate remote codes | grep 0/1/2; clig.dev; sysexits | SATISFIES (§0.2(iii)) | SCRIPT-STANDARD (REC-207) |
| A9 | No interactive prompts in non-TTY; `--dry-run`/`-h` floors | clig.dev; pi4-validation precedent | SATISFIES (pi4-validation) | SCRIPT-STANDARD (REC-208) |
| A10 | Optional `--json`/`--kv` explicit machine stream | clig.dev `--json`; terraform `-json`; kubectl `-o json` | SILENT | SCRIPT-STANDARD (REC-209) |

### 3.3 The correlation narration map (RQ3)
| Output surface | How the one causal story appears | Join key | M12 pin / FUTURE |
|---|---|---|---|
| Structured JSON log line (Core) | MDC `correlation_id` on every line emitted while handling an event | `correlation_id` = root event ID (§0.4) | M12-INPUT: pin "every log line during event handling carries that event's correlation_id" (REC-210) |
| Event store / causal chain | `CausalContext.correlationId` propagated unchanged; `causationId` = preceding event | `correlation_id` SQL query + O(n) tree (Doc 11 §3.4) | LOCKED baseline |
| Virtual-thread async boundary | MDC must be copied across `fork()`/executor hops or `correlation_id` drops | propagation mechanism (TaskDecorator / Scoped Values) | M12-INPUT + spike (REC-211) |
| Script output (pi-health etc.) | `KEY:value` lines reference host/system state; carry relevant id when available | n/a (no correlation_id in scripts today) | FUTURE: optional id echo when a script acts on a correlated operation (REC-215) |

### 3.4 Over-engineering check (REJECT-candidates)
- **OTel/OTLP collector or log-shipping daemon on the Pi** — REJECT (§0.6 row 6; LTD-15 locks no exporter in MVP). Single host, single writer, no fleet: a collector is pure overhead.
- **128-bit `MESSAGE_ID` hex catalog (systemd-style)** — REJECT in favor of the existing dotted event names, which are human-legible and already serve the stable-type-ID role.
- **logfmt as production wire format** — REJECT: LTD-15 already locks JSON; maintaining two formats doubles parser surface for no fleet-scale benefit.
- **Full W3C `traceparent` header machinery** — REJECT for MVP: it solves cross-service propagation HomeSynapse (single host) does not have; `CausalContext` already covers in-process causality. (Re-examine only if a post-MVP cloud lane appears → FUTURE-adjacent.)
- **Per-message severity-number normalization (OTel SeverityNumber 1–24)** — REJECT: the §0.3 INFO/DEBUG/WARN + journal 0–7 mapping is sufficient at single-host scale.

## 4. Findings + Recommendations [M]

### 4a. REC-numbered findings (201–215)
- **REC-201 — Codify the line-anchored verdict line.** Concern: summary-line/agent contract. Evidence: grep exit-status (verdict-in-text rationale); TAP `^ok`; git porcelain. Gap-relative: §0.2(iii) already ships it; generalize `READINESS:` to a `RESULT:`/`SUMMARY:` family with a documented grammar. Recommendation: `OUTPUT_CONVENTIONS.md` §"Summary line" — `<VERDICT_KEY>:PASS` / `<VERDICT_KEY>:FAIL:<reason>`, last line, color-free, `^`-anchored. Effort: S.
- **REC-202 — Declare the machine format stable and color-free (porcelain-grade).** Evidence: git `--porcelain` guarantee. Gap-relative: pi-health strips color non-TTY (§0.2(i)) but the stability contract is unwritten. Recommendation: document "once a key is greppable it is an API; changes are versioned, not silent." Effort: S.
- **REC-203 — Standardize labeled `KEY:value` data lines.** Evidence: git porcelain; JSON Lines one-object-per-line; logfmt. Gap-relative: §0.2(ii) shipped; specify charset (no `:` in keys; UPPERCASE_SNAKE keys), one datum/line, `cut -d: -f2-` multi-value-safe parsing. Effort: S.
- **REC-204 — Route diagnostics to stderr, machine output to stdout.** Evidence: Google Shell Style Guide; clig.dev. Gap-relative: VIOLATION — `info/ok/warn/fail` all `printf` to stdout. Recommendation: send `warn`/`fail`/`header` to stderr; keep `KEY:value` + summary on stdout. Effort: S.
- **REC-205 — Honor `NO_COLOR` explicitly in addition to isatty.** Evidence: no-color.org; clig.dev. Gap-relative: isatty SATISFIES, `NO_COLOR` SILENT. Recommendation: add `[ -n "${NO_COLOR}" ]` to the color-disable branch. Effort: S.
- **REC-206 — Write the bounded-output / tail-carries-verdict rule.** Evidence: Anthropic ("For Claude Code, we restrict tool responses to 25,000 tokens by default"; "smallest possible set of high-signal tokens"); in-house token-economics law. Gap-relative: idiom SATISFIES; rule unwritten. Recommendation: cap per-line length, prohibit dumping unbounded remote blobs, mandate verdict in final lines. Effort: S.
- **REC-207 — Document the two-tier exit-code + remote propagation taxonomy.** Evidence: grep 0/1/2; clig.dev; sysexits. Gap-relative: SATISFIES (§0.2(iii) + `exit "${GRADLE_EXIT_CODE}"`). Recommendation: 0=pass, 1=fail, 2=usage; propagate remote codes. Effort: S.
- **REC-208 — Codify CLI ergonomics floor (`-h|--help`, `--dry-run`, env-var precedence, no interactive prompts in non-TTY).** Evidence: clig.dev; pi4-validation precedent. Gap-relative: pi4-validation SATISFIES; pi-health partial. Recommendation: every script gets `-h`, env-var config block, no `read` prompts when `! [ -t 0 ]`. Effort: M.
- **REC-209 — Add optional explicit `--json`/`--kv` machine stream.** Evidence: clig.dev `--json`; terraform `-json` ("This text stream is not a stable interface for integrations… use the -json flag"); kubectl `-o json`. Gap-relative: SILENT. Recommendation: offer `--kv` (already the native idiom) and consider `--json` for richer payloads; auto-emit machine form when stdout is not a TTY. Effort: M.
- **REC-210 — M12 pin: every log line emitted while handling an event carries that event's `correlation_id`.** Evidence: OTel trace_id-in-logs; §0.4 join-key role. Gap-relative: inside LOCKED LTD-15/Doc 11 §3.4. Recommendation: instruction obligation + test asserting `correlation_id` present on all event-handling log lines. Effort: M.
- **REC-211 — M12 pin + spike: MDC propagation across virtual-thread boundaries.** Evidence: Logback MDC manual (no child inheritance); JEP 444/506 (fork() drops InheritableThreadLocal). Gap-relative: real correctness hazard against §0.4's "one causal story." Recommendation: choose propagation mechanism (TaskDecorator copy vs JDK 25 Scoped Values), test with `-Djdk.traceVirtualThreadLocals=true`; assert no cross-event leakage. Effort: L.
- **REC-212 — Project-wide dotted log-event naming convention (CONVENTION candidate).** Evidence: OTel naming spec (namespacing, lowercase+dot, start-with-letter, no double-delimiter); deprecation-not-deletion governance. Gap-relative: §0.3/§11.2 already satisfy; codify depth discipline, started/completed pairing, level-keyed-to-who-acts. Recommendation: write `subsystem.noun.verb[.state]` + level table (INFO=normal milestone, DEBUG=internal step, WARN=needs-attention) as a convention candidate. Effort: M.
- **REC-213 — Stable-log-name-as-API deprecation discipline.** Evidence: OTel "SHOULD NOT be removed… SHOULD be deprecated"; git porcelain versioning. Gap-relative: §0.3 names are grep targets = contracts. Recommendation: log-event names are deprecated, never silently renamed; currency note in the doc that defines them. Effort: S.
- **REC-214 — DOC-11-CURRENCY: non-uniform metric prefixes.** Evidence: §0.3 PM-observed seed (`hs_events_*`, `hs.device.*`, `config.*` coexist); OTel dots-vs-underscores backend rewriting. Gap-relative: a currency note, never an amendment. Recommendation: note the inconsistency on Doc 11 §3.5; flag that dotted metric names get `_`-rewritten by Prometheus-style backends (relevant only if the post-MVP Micrometer facade lands). Effort: S.
- **REC-215 — FUTURE: optional correlation-id echo in script output.** Evidence: correlation-id-in-CLI-output support practice; §0.4. Gap-relative: scripts carry no `correlation_id` today. Recommendation (sketch only): when a script acts on a correlated runtime operation, echo the relevant id on a labeled line so a paste joins to the chain. Effort: M (FUTURE, do not draft).

### 4b. THE DISPOSITION TABLE [M — load-bearing]
| REC | One-line | Bucket |
|---|---|---|
| REC-201 | Line-anchored verdict line (`RESULT:`/`READINESS:` family) | SCRIPT-STANDARD |
| REC-202 | Machine format stable + color-free (porcelain-grade) | SCRIPT-STANDARD |
| REC-203 | Labeled `KEY:value` data-line spec | SCRIPT-STANDARD |
| REC-204 | Diagnostics→stderr, machine→stdout (FIX a real defect) | SCRIPT-STANDARD |
| REC-205 | Honor `NO_COLOR` + isatty | SCRIPT-STANDARD |
| REC-206 | Bounded output / tail-carries-verdict rule | SCRIPT-STANDARD |
| REC-207 | Two-tier exit-code + remote propagation taxonomy | SCRIPT-STANDARD |
| REC-208 | CLI ergonomics floor (`-h`/`--dry-run`/env/no-prompt) | SCRIPT-STANDARD |
| REC-209 | Optional `--json`/`--kv` machine stream | SCRIPT-STANDARD |
| REC-210 | Pin: correlation_id on every event-handling log line | M12-INPUT |
| REC-211 | MDC-on-virtual-threads propagation pin + spike | M12-INPUT |
| REC-212 | Project-wide dotted log-event naming convention | M12-INPUT |
| REC-213 | Stable-log-name deprecation discipline | M12-INPUT |
| REC-214 | Non-uniform metric prefixes currency note | DOC-11-CURRENCY |
| REC-215 | Optional correlation-id echo in script output | FUTURE |

**Bucket coverage note.** No REC lands in **M10-M13-INPUT** (UI lane), **M5-C-COPY** (positioning), or **REJECT** as a numbered REC — this is deliberate. The REJECT findings are first-class but are anti-requirements captured in §3.4 (collector creep, MESSAGE_ID catalog, logfmt-as-wire-format, full W3C traceparent, OTel SeverityNumber) rather than minted as RECs, because each is "do NOT build" guidance against the LOCKED ground, not a new deliverable. M10-M13-INPUT is empty because this is an engineering-register brief; UI-surface dual-channel human rendering is the sibling's register (noted §5). M5-C-COPY is empty because no finding here is positioning-grade — register fences forbid minting positioning claims.

## 5. Caveats and Open Questions [M]
- **Connector-blind declaration.** The HomeSynapse project knowledge base (`homesynapse-core-docs`) was **not consulted via a live connector during this run** — no project-KB tool was available in this environment. Per the connector-blind protocol I worked strictly from the verbatim embeds (§0.1–§0.6) and did NOT reconstruct any HomeSynapse fact from memory. Items needing KB verification: (a) the exact Doc 11 §3.5 metric-prefix text behind REC-214; (b) the precise wording of Doc 11 §11.2 `observability.*` event names; (c) confirmation that AMD-93 / projectionVersion 5 / manifest pins (55/24/36) are current. These are flagged, not assumed.
- **Source reliability grading.** GOLD: jsonlines.org, no-color.org, clig.dev, git-scm, testanything.org, systemd freedesktop man pages, OTel semconv spec, Logback manual, Google Shell Style Guide, GNU grep manual, Anthropic engineering (primary, but single-vendor). SILVER: Java Code Geeks (virtual-thread MDC synthesis — corroborated by primary Logback/JEP docs); Greptime blog (OTel semconv version line — a secondary source, but consistent with the OTel docs site showing v1.41.0). The JEP 444/506 claims are reported via a secondary synthesis; the underlying behavior is corroborated by the primary Logback manual statement that child threads do not inherit MDC, and JEP 506's finalization in JDK 25 (Sep 2025 LTS) is a matter of public OpenJDK record.
- **Spike candidates.** (1) MDC-on-virtual-threads behavior under `StructuredTaskScope.fork()` and pooled reuse (REC-211) — must be empirically validated on the actual runtime, not assumed. (2) Token-cost measurement of `--json` vs `--kv` output volume for a real agent paste (REC-209/206).
- **INCOMPLETE-EVIDENCE.** None at the format/spec level — web reach was deep for all RQ1–RQ5 external standards. The only genuine gaps are KB-internal (above).
- **Out-of-register notes (one line each).** (a) Register-C human-channel wording for status/error UI (§0.5) is a sibling UX-register concern — noted, not pursued. (b) The "logfmt is more human-readable, colorize keys in dev" community guidance is a human-factors finding belonging to the sibling register. (c) End-user notification phrasing for failed automations is UI-register.

## 6. Appendix: Sources [M]
- **JSON Lines / logfmt:** jsonlines.org; brandur.org/logfmt, /canonical-log-lines, /nanoglyphs/025-logs; pkg.go.dev/github.com/go-logfmt/logfmt; betterstack.com logfmt guide.
- **OpenTelemetry / W3C:** opentelemetry.io/docs/specs/semconv/ (docs line v1.41.0; GitHub release v1.41.1), /general/naming/, /specs/otel/logs/data-model/, /general/events/; github.com/w3c/trace-context.
- **systemd:** freedesktop.org systemd.journal-fields; man7.org systemd.journal-fields.7; freedesktop python-systemd journal.
- **MDC / virtual threads:** logback.qos.ch/manual/mdc.html; javacodegeeks.com (May/Mar 2026, JEP 444/506 synthesis); github.com/micrometer-metrics/context-propagation #191; OpenJDK JEP 506 (Scoped Values, final in JDK 25).
- **CLI guidelines / shell:** clig.dev; google.github.io/styleguide/shellguide.html; no-color.org; bixense.com/clicolors; git-scm.com/docs/git-status; gnu.org grep Exit-Status; manpages.ubuntu sysexits.h.
- **TAP:** testanything.org tap-specification, tap-version-14-specification.
- **Dual-channel JSON:** developer.hashicorp.com/terraform/internals/machine-readable-ui, /json-format; github.com/kubernetes.
- **LLM-agent tooling:** anthropic.com/engineering/writing-tools-for-agents (Sep 11 2025); anthropic.com/engineering/effective-context-engineering-for-ai-agents (Sep 29 2025); anthropic.com "Introducing advanced tool use" (token-scale figures).

## 7. HomeSynapse Code-Level Implications [LIGHT]
Observations only; all routed through §4b. No module-info proposals, no new types, no contract drafts, no event-vocabulary changes.
- The `correlation_id` MDC key (LTD-15) is the join between a structured-log line and the `CausalContext.correlationId` chain (§0.4) — REC-210 pins that every log line emitted while handling an event carries it. Observation only; `CausalContext`, `com.homesynapse.event`, and the §0.3 event names are quoted from the embeds and unchanged.
- Because work runs on virtual threads, MDC carrying `correlation_id` may silently drop across `StructuredTaskScope.fork()` / executor hops (REC-211) — an M12 implementation+test concern inside the LOCKED contract, not a contract change.
- The §0.3 dotted event names (`automation.run.started` … `automation.trigger.duration.limit_exceeded`) already satisfy the project-wide naming convention (REC-212) and the stable-name-as-API deprecation discipline (REC-213); AMD-92's event vocabulary is frozen ground and untouched.
- The shipped `READINESS:`/`KEY:value` idiom in `scripts/dev/pi-health.sh` and `scripts/pi4-validation.sh` at `01841ba` is the reference implementation the SCRIPT-STANDARD RECs (201–209) codify; the one defect to retrofit is stdout/stderr separation (REC-204).