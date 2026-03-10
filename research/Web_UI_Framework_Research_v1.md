# HomeSynapse Core — Web UI Framework Research

**Document type:** Research artifact
**Purpose:** Framework selection and dashboard architecture research for Doc 13
**Date:** 2026-03-10
**Status:** Complete
**Requested by:** Hivemind (Prompt 05)
**Informs:** Doc 13 (Web UI — Observability MVP)
**Relevant LTD:** LTD-12 (Server-rendered HTML + HTMX, Medium confidence)

---

## 1. Framework Comparison (RQ-11)

### 1.1 Evaluation Criteria

Each candidate is evaluated against HomeSynapse-specific constraints: bundle must ship inside the jlink distribution on NVMe alongside the application (LTD-13 scope), served from RPi 5 over LAN with zero CDN dependencies (INV-TO-01), zero configuration for the end user (no npm install, no build step at runtime), and WebSocket-first architecture for real-time event streaming (Doc 10).

### 1.2 Comparison Table

| Criterion | Preact | Solid.js | Svelte 5 | Lit | Vanilla + Alpine.js | HTMX + SSR |
|---|---|---|---|---|---|---|
| **Core size (min+gz)** | ~4 KB | ~7 KB | ~3 KB runtime | ~5 KB | ~7 KB (Alpine) / ~6 KB (Petite-Vue) | ~14 KB |
| **Real-world app bundle** | ~14 KB | ~10 KB | ~7 KB | ~16 KB+ | 8-15 KB est. | ~14 KB + template engine |
| **WebSocket support** | Native JS; manual | Native JS; reactive primitives integrate cleanly | Native JS; stores integrate directly | Native JS; manual wiring | Native JS; Alpine reactivity limited | Extension (htmx-ext-ws); declarative but HTML-fragment oriented |
| **Charting ecosystem** | Full React ecosystem (Chart.js, uPlot, Recharts via preact/compat) | Growing; chart.js wrappers, solid-chartjs | svelte-chartjs, lightweight-charts wrapper, LayerChart, Chartist (~10 KB) | Limited; generic Web Component wrappers | Manual; Chart.js via script tag | Server-rendered charts only; no client-side interactivity |
| **Developer experience (solo)** | Excellent; React knowledge transfers directly | Good; React-like but different mental model (signals) | Excellent; minimal boilerplate, compiler handles optimization | Moderate; Web Components have boilerplate, state management gaps | Low-moderate; imperative wiring, limited component model | Good for forms/CRUD; poor for real-time dashboards |
| **5-year stability** | High; backed by community, React-compatible API is stable | Medium; smaller community, 2.0 recently released | High; Svelte 5 with runes is a major maturity milestone, strong community | High; Google-backed, Web Components are a standard | Alpine: Medium; Petite-Vue: Low (experimental) | High; HTMX 2.0 stable, concept is durable |
| **Build toolchain** | Vite (standard) | Vite + solid-js plugin | Vite + svelte plugin | Vite or Rollup (minimal config) | None required (can use vanilla script tags) | None for HTMX; Java template engine required server-side |
| **SSR capability** | Yes (preact-render-to-string) | Yes (solid-js/web) | Yes (SvelteKit) | Yes (Lit SSR, experimental) | N/A | Inherently SSR |

### 1.3 Per-Candidate Analysis

#### 1. Preact (~4 KB gzipped core)

**Strengths:** The React-compatible API means the largest JavaScript ecosystem is available at ~4 KB instead of ~42 KB. preact/compat enables direct use of React charting libraries (Chart.js wrappers, Recharts, uPlot wrappers) without modification. Virtual DOM diffing is well-understood and predictable. Preact has been in production since 2015 and is maintained actively.

**Weaknesses:** Virtual DOM overhead exists even if small. Real-world app bundles (~14 KB for a representative app) are larger than Svelte's compiled output. preact/compat adds ~2 KB for full React API compatibility. React ecosystem libraries may pull in unexpected dependencies.

**HomeSynapse fit:** Strong. WebSocket messages can update Preact state; the virtual DOM will efficiently diff the changed health indicators and event stream. Charting is trivially solved via the React ecosystem. A solo developer with React experience can maintain this indefinitely.

#### 2. Solid.js (~7 KB gzipped core)

**Strengths:** Fine-grained reactivity eliminates virtual DOM overhead entirely. Signals-based updates mean a WebSocket message updating a single health indicator re-renders only that DOM node, not the entire component tree. Consistently tops js-framework-benchmark for raw DOM update speed. Real-world app bundles are ~10 KB — impressively small.

**Weaknesses:** Smaller community than React/Preact/Svelte. The mental model (signals, createEffect, createMemo) requires learning even for React developers. Charting ecosystem is smaller; chart.js wrappers exist but fewer options. Solid 2.0 was recently released, meaning API churn risk over the 5-year horizon. Debugging tools are less mature.

**HomeSynapse fit:** Strong on performance, moderate on ecosystem risk. The fine-grained reactivity is theoretically ideal for a dashboard with many independently-updating health indicators. The smaller community is a risk factor for a solo developer who may need help.

#### 3. Svelte 5 (~3 KB gzipped runtime)

**Strengths:** Compiler-based approach means near-zero runtime. Svelte 5's "runes" system ($state, $derived, $effect) provides a clean reactivity model. Real-world app bundles measured at ~7 KB — the smallest of all framework candidates. Excellent developer experience with minimal boilerplate. Strong and growing community. svelte-chartjs wraps Chart.js cleanly; lightweight-charts has a Svelte 5 wrapper for time-series. Native WebSocket integration is straightforward via Svelte stores.

**Weaknesses:** Compiled output scales with component count — at sufficient complexity, total bundle may approach or exceed Preact. However, for a dashboard of HomeSynapse's scope (health display, event stream, trace viewer), this crossover point is unlikely to be reached. The compiler adds a build step (Vite + svelte plugin), but this is a development-time concern, not a runtime concern.

**HomeSynapse fit:** Very strong. The smallest production bundles for the expected application complexity. Svelte stores integrate naturally with WebSocket connections — a store can be backed by a WebSocket subscription, and any component reading that store auto-updates on new messages. Charting is well-served. Svelte 5 is a maturity milestone that signals long-term stability.

#### 4. Lit (~5 KB gzipped core, ~16 KB with Material)

**Strengths:** Web Components are a browser standard; components work anywhere HTML works. This is what Home Assistant chose (via Polymer, now Lit). Google actively maintains Lit. No build step strictly required (can use ES modules directly). Components are inherently encapsulated.

**Weaknesses:** The ~5 KB core is misleading — real applications with Material Web Components quickly balloon to 16 KB+. Lit does not handle application state — there's no built-in equivalent of React Context, Svelte stores, or Solid signals. State management for a dashboard (health indicators, event streams, trace state) requires either a manual solution or an additional library. Home Assistant's own experience demonstrates that Lit/Web Components scale poorly for complex UIs (see RQ-13). Developer experience involves more boilerplate than Preact or Svelte.

**HomeSynapse fit:** Weak. The lack of built-in state management is a serious gap for a real-time dashboard. HA's performance complaints with Lit are a cautionary signal. The Web Components standard-compliance argument (HA's original rationale) is less compelling for an internal observability dashboard that doesn't need framework-agnostic component reuse.

#### 5. Vanilla JS + Alpine.js (~7 KB) / Petite-Vue (~6 KB)

**Strengths:** No framework overhead for simple cases. Alpine.js provides reactive data binding via HTML attributes with no build step. Petite-Vue is 30% faster and 41% smaller than Alpine in benchmarks. Both can be loaded via a single script tag — zero toolchain.

**Weaknesses:** Neither provides a component model suitable for a multi-view dashboard. No virtual DOM or fine-grained reactivity — updates to large lists (event streams) require manual DOM management or accept poor performance. Charting requires manual Chart.js integration. WebSocket integration is manual. Alpine.js is designed for sprinkling interactivity on server-rendered pages, not for building SPAs. Petite-Vue is explicitly experimental and maintained by a single person (Evan You's side project).

**HomeSynapse fit:** Weak for the primary dashboard. Potentially useful as a progressive enhancement layer if combined with HTMX for simpler pages (e.g., configuration views), but inadequate for the event stream display, trace visualization, and real-time health indicators that are the dashboard's core purpose.

#### 6. HTMX + Server-Rendered HTML (~14 KB + template engine)

**Strengths:** The simplest mental model — server returns HTML fragments, HTMX swaps them into the DOM. No client-side state management. No JavaScript framework to learn. Javalin + JTE (Java Template Engine) is a proven, documented combination. The HTMX core is ~14 KB gzipped. Aligns with LTD-12. Excellent for form-heavy CRUD interfaces, configuration pages, and static content.

**Weaknesses — critical for HomeSynapse:**

1. **Server CPU cost.** Every UI update requires the RPi to render an HTML template. For a health dashboard receiving WebSocket events at potentially dozens per second, this means the RPi must template-render HTML fragments for every state change and push them to the client. This directly competes with event processing CPU on a 4-core Cortex-A76 (LTD-02).

2. **WebSocket model mismatch.** HTMX's WebSocket extension (htmx-ext-ws) is designed for server-push of HTML fragments. The HomeSynapse WebSocket API (Doc 10) publishes JSON events. Using HTMX would require either: (a) a separate WebSocket endpoint that renders HTML server-side before pushing, duplicating the API surface, or (b) client-side JavaScript that receives JSON events and constructs DOM updates, which defeats the purpose of HTMX.

3. **Real-time event stream display.** An infinite/virtual-scrolling event log with filtering, live append, and click-to-expand trace chains cannot be built with HTML fragment swaps. This is inherently a client-side rendering problem. HTMX would require a JavaScript escape hatch for this core feature, resulting in a hybrid that gets the worst of both worlds (template engine CPU cost + client JS complexity).

4. **Charting.** Time-series charts for metrics (event throughput, command latency, RSSI trends) require client-side JavaScript regardless. HTMX cannot render or update charts. Server-side chart rendering (generating SVG/PNG on the RPi) is computationally expensive and produces static images that can't be interactive.

5. **Total payload.** HTMX core (14 KB) + WebSocket extension (~3 KB) + any client-side JS for charts and event streams likely exceeds 20 KB before application logic — larger than a Svelte or Preact application that handles everything client-side.

**HomeSynapse fit:** Poor for the Observability MVP dashboard. HTMX is excellent for the *wrong* kind of UI. The Observability MVP is a real-time, WebSocket-driven, chart-heavy, event-stream-displaying dashboard — the exact use case where HTMX's server-rendered model breaks down. However, HTMX remains a strong candidate for future Tier 2 configuration/management pages that are form-heavy and CRUD-oriented.

### 1.4 Framework Recommendation

**Primary recommendation: Preact** for the Observability MVP dashboard.

**Rationale:**
- ~4 KB core with full React ecosystem access for charting (uPlot at ~35 KB or Chartist at ~10 KB for lightweight charts)
- Predictable virtual DOM model for a solo developer
- Largest support ecosystem and longest track record (since 2015) among lightweight frameworks
- WebSocket integration is straightforward — standard JavaScript WebSocket feeding Preact state
- The React-compatible API is the safest 5-year bet: if Preact ever stalls, migration to React is mechanical
- No exotic mental model — standard function components, hooks, JSX

**Strong alternative: Svelte 5** if the priority is absolute minimum bundle size. Svelte produces smaller compiled output for this scale of application. The trade-off is a smaller (though growing) ecosystem and a compiler-based model that is more opaque during debugging.

**Not recommended for the Observability MVP:** HTMX, Lit, Alpine.js/Petite-Vue.

---

## 2. Rendering Architecture Assessment (RQ-12)

### 2.1 Architecture Options

#### Option A: SPA (Client-Side Only)

The RPi serves pre-built static files (HTML, JS, CSS) via Javalin's static file handler. All rendering happens in the browser. The RPi's CPU is dedicated entirely to event processing, persistence, and integration management.

**CPU cost on RPi 5:** Zero rendering cost. Javalin serves files from the NVMe with negligible overhead. Static file serving on Javalin is a solved problem — a single handler, no template compilation, no per-request processing.

**First paint latency on LAN:** Network latency is <1ms on a LAN. File transfer for a ~50 KB total payload (framework + app + charts) takes <10ms on gigabit or ~50ms on 100Mbit. Total first paint: <100ms including browser parse/render. This is faster than any SSR approach because there's no server processing time.

**JavaScript payload:** The full application ships to the client. For Preact + charting + application logic, estimated 50-80 KB gzipped total. For Svelte, estimated 40-60 KB gzipped total.

**WebSocket compatibility:** Native. The SPA opens a WebSocket connection to the existing Doc 10 API (JSON events) and updates its own state. No additional server-side work required.

**Build complexity:** Vite produces the static bundle at development/release time. The built output (HTML + JS + CSS files) is placed in the jlink distribution's resource directory. No build step at runtime on the RPi.

#### Option B: SSR (Server-Side Rendering)

The RPi renders HTML on every page load and navigation using a Java template engine (JTE, Thymeleaf, or Freemarker) integrated with Javalin.

**CPU cost on RPi 5:** Every page render consumes CPU cycles. For the Observability dashboard with its health indicators, event stream, and metrics, a full page render is non-trivial. Under load (multiple browser clients refreshing), this competes with event processing on the same 4 cores.

**Compatibility constraint (critical):** Javalin is a Java server (LTD-11). SSR options are:
- **(a) Java template engine (JTE/Thymeleaf):** Viable. JTE is pre-compiled and fast. But templates can only produce HTML — they cannot produce reactive, WebSocket-driven live updates without client-side JavaScript. This means SSR for initial render + client JS for live updates = hybrid complexity.
- **(b) Node.js sidecar:** Violates the single-process architecture. Rejected.
- **(c) GraalJS for in-process JS execution:** Adds GraalJS to the distribution (~40+ MB). Adds JVM warm-up cost. Violates the principle of minimal distribution size. Rejected.

**WebSocket compatibility:** Poor. The WebSocket API (Doc 10) publishes JSON. SSR would require the server to re-render HTML fragments for every WebSocket event — burning CPU on the RPi and requiring a separate server-push mechanism (SSE or WebSocket with HTML payloads).

**Build complexity:** Template files ship with the application. No development-time build step for templates. But the dual-model complexity (templates for initial render, JS for live updates) increases maintenance burden.

#### Option C: Islands Architecture (Astro-Style)

Static HTML with interactive "islands" — self-contained JavaScript components that hydrate independently. The page shell is static; only the health indicators, event stream, and charts are interactive islands.

**CPU cost on RPi 5:** Zero for the static shell. Each island hydrates client-side. However, islands architecture requires a meta-framework (Astro) or custom implementation. Astro requires a Node.js build step and produces output for Node.js-based servers — incompatible with the Javalin/Java stack.

**Custom islands on Javalin:** Technically possible — serve a static HTML page with `<script>` tags that mount Preact/Svelte components into designated DOM nodes. This is effectively what a well-structured SPA does anyway, without the overhead of an islands meta-framework.

**Build complexity:** Without Astro, the "islands" pattern is just a SPA with lazy-loaded components — which modern bundlers (Vite) handle natively via code splitting.

**Verdict:** Islands architecture is conceptually appealing but practically equivalent to a code-split SPA when running on a Java server. The meta-framework overhead (Astro, etc.) is unjustified.

#### Option D: Hybrid (Initial SSR + Client-Side Updates)

Server renders the initial page via JTE, then client-side JavaScript takes over for WebSocket-driven updates.

**CPU cost on RPi 5:** One SSR render per page load (acceptable). Zero subsequent rendering cost — the client handles live updates.

**Advantage:** Fastest possible first paint — the browser receives fully-rendered HTML before JavaScript loads.

**Disadvantage:** The dual-model complexity is severe. The initial render template (JTE) and the client-side update logic (Preact/Svelte) must produce identical HTML structure. Any divergence creates visual glitches during hydration. This is exactly the problem that SSR frameworks like Next.js and SvelteKit exist to solve — but those require Node.js servers, not Javalin.

**Verdict:** Adds complexity for marginal first-paint improvement. On a LAN with <1ms latency, the first-paint advantage of SSR over SPA is negligible (the server processing time may actually make it slower).

### 2.2 Architecture Recommendation

**SPA (Option A) is the clear winner** for HomeSynapse's Observability MVP.

**Decisive factors:**
1. **Zero server CPU for rendering** — the RPi's 4 cores are fully available for event processing, persistence, and integration management.
2. **WebSocket-native** — the SPA consumes the existing Doc 10 JSON WebSocket API directly. No translation layer, no server-side HTML rendering.
3. **Simplest architecture** — one model (client-side rendering), one data format (JSON from REST and WebSocket APIs), one build output (static files).
4. **LAN latency eliminates the SSR first-paint argument** — when network RTT is <1ms, the ~50ms to transfer and parse a small JS bundle is faster than waiting for server-side template rendering.
5. **Javalin compatibility** — static file serving is a one-line configuration in Javalin. No template engine dependency, no rendering plugin.

---

## 3. Home Assistant Frontend Analysis (RQ-13)

### 3.1 HA's Technology Stack

Home Assistant's frontend evolved from Polymer (2016) → Polymer 3 → LitElement → Lit 2/3. The decision was made in 2016 with the explicit rationale that Web Components are a browser standard and would outlast any framework. The frontend uses Material Design Web Components for UI elements, a custom Lovelace dashboard system for user-configurable layouts, and WebSocket as its primary communication protocol with the Python backend.

The build system uses Yarn, Gulp, and Webpack/Rollup to compile TypeScript, bundle JavaScript, process translations, and package the distribution.

### 3.2 What HA Gets Right

**WebSocket as primary protocol.** HA uses WebSocket for all real-time communication — entity state updates, event subscriptions, service calls. This is architecturally sound and HomeSynapse's Doc 10 follows the same principle. HA's WebSocket protocol supports subscription-based messaging with automatic reconnection.

**Component encapsulation.** Web Components provide genuine encapsulation — each card, panel, and dialog is self-contained. This makes the Lovelace ecosystem of community-created cards possible. Third-party cards are just custom HTML elements.

**Framework longevity bet paid off.** The 2016 bet on Web Components being part of the HTML standard proved correct. HA has not needed a full frontend rewrite in 10 years. Incremental migration from Polymer to Lit was possible precisely because both target the same Web Components standard.

### 3.3 What HA Gets Wrong

**Performance at scale — the central failure.** Community forums and GitHub issues document persistent, recurring performance complaints across multiple years:

- Dashboard rendering slows dramatically with hundreds of entities. Users report 1+ minute load times and multi-second delays for clicks to register.
- The Lovelace architecture re-renders entire dashboards when switching tabs, rather than preserving DOM state.
- WebSocket message storms: every entity state change pushes a WebSocket message. With hundreds of entities, the browser receives hundreds of updates per second, each triggering re-renders of subscribed components. There is no efficient batching, debouncing, or virtual rendering at the protocol level.
- A 2025 community investigation found that every WebSocket event triggers DOM updates even when the dashboard tab displaying the affected entity is not visible — wasted rendering cycles.

**State management gap.** Lit provides no application-level state management. HA builds its own state handling through mixins (SubscribeMixin) and a custom connection library (home-assistant-js-websocket). This ad-hoc state architecture is a recurring source of bugs and performance issues. Re-rendering decisions are made per-component without global coordination.

**Bundle growth unchecked.** While Lit itself is ~5 KB, the HA frontend with Material Web Components, translations, dashboard editor, and integration-specific panels grows well beyond what a focused dashboard requires. The lack of aggressive code splitting means users load code for features they aren't viewing.

**Breaking changes cascade.** The 2025.5 release changed theme variable naming, breaking community components (Kiosk mode, custom-sidebar, tabbed-card, card-mod). Web Components' encapsulation means community components often depend on internal CSS custom properties, creating a fragile ecosystem.

**Template engine lock-in.** Lit's template system (html tagged template literals) is Lit-specific. Unlike JSX (which compiles to standard function calls and can target any renderer), Lit templates cannot be used with other frameworks. If HA ever needs to migrate away from Lit, every component must be rewritten.

### 3.4 Key Lesson for HomeSynapse

**The single most important lesson: a real-time dashboard's performance is determined by its WebSocket subscription model and update batching strategy, not by its framework choice.**

HA's frontend performance problems are not caused by Lit being slow — Lit's rendering is fast. They're caused by:
1. Every entity state change producing a separate WebSocket message with no batching
2. Every subscribed component independently processing every message with no coordination
3. No virtual scrolling or windowed rendering for large entity lists
4. No visibility-aware rendering (updating hidden tabs/cards)

HomeSynapse must design the Doc 10 WebSocket API (already locked) and the Doc 13 dashboard to handle high-frequency updates efficiently:
- **Client-side update batching:** Collect WebSocket events over a short window (16-50ms) and apply all state changes in a single render cycle.
- **Visibility-aware rendering:** Only update DOM for components currently visible in the viewport.
- **Virtual scrolling for event streams:** The event log must use windowed/virtual rendering — never append unbounded DOM nodes.
- **Subscription filtering:** Subscribe only to events relevant to the current view, using Doc 10's entity/capability/area filtering. Don't receive and discard.

### 3.5 What HomeSynapse Should Emulate

- WebSocket as primary real-time protocol (already designed in Doc 10)
- Component-based architecture with clear encapsulation
- HA's concept of "cards" as composable dashboard elements (but not user-customizable in MVP — that's Tier 2+)

### 3.6 What HomeSynapse Must Avoid

- Global state changes triggering uncoordinated per-component re-renders
- Unbounded DOM growth from event streams or entity lists
- Breaking community/ecosystem contracts through internal CSS/API changes (less relevant for MVP but important architecture hygiene)
- A framework without built-in state management (this eliminates Lit)
- Server-side rendering overhead competing with core event processing (this eliminates HTMX-for-everything)

---

## 4. Dashboard UX Patterns (RQ-14)

### 4.1 Event Trace Visualization

**The "Why Did This Happen?" interaction pattern** is the dashboard's primary differentiator. Given any device state change, the user must be able to navigate to the root cause.

**Pattern: Causal Chain Assembly**

HomeSynapse's event model (Doc 01) includes correlation_id and causation_id in every event envelope. This enables a causal chain display:

1. **Entry point:** User sees a state change (e.g., "Porch Light turned on at 3:07 AM").
2. **Click to expand:** The dashboard queries events by correlation_id, assembling the full causal chain.
3. **Chain display:** A vertical timeline showing each event in causal order:
   - `automation_triggered` (motion detected) → `run_started` → `run_condition_evaluated` (is_dark = true) → `command_issued` (porch_light.turn_on) → `command_dispatched` → `state_reported` (porch_light: on) → `state_changed` (porch_light: on) → `command_confirmed`
4. **Each event node** shows: timestamp, event type, actor (who caused it), and expandable payload.

**Implementation:** This is a read-heavy, query-driven pattern. The REST API (Doc 09) provides event queries by correlation_id. The UI issues one REST call and renders the chain client-side. No real-time streaming needed — trace chains are historical.

**Visual pattern:** Vertical timeline with left-aligned event nodes, similar to Git log visualization or distributed tracing tools (Jaeger, Zipkin). Color-coding by event domain (device=blue, automation=green, system=gray). Expandable nodes for payload inspection.

### 4.2 Health Dashboard Patterns

**Pattern: Three-Tier Status Display** (from Doc 11)

Tier 1 — Critical Infrastructure: Event Store, State Store, Persistence
Tier 2 — Core Services: Integration Runtime, Automation Engine, Configuration
Tier 3 — Interface Services: REST API, WebSocket API, Web UI

**Visual pattern:** Top-to-bottom or left-to-right flow showing dependency hierarchy. Each tier as a horizontal band with service cards. Each card shows:
- Service name
- Status indicator (healthy/degraded/failed — traffic light colors)
- Key metric (e.g., events/sec for Event Store, connected devices for Integration Runtime)
- Last status change timestamp

**Design principle from observability UX research:** "One page should answer one decision." The health overview answers: "Is the system healthy right now?" If anything is degraded, the user clicks through to the relevant tier for details.

**Pattern: Drill-Down Health Detail**

Clicking a service card expands or navigates to a detail view showing:
- Health history (time-series chart of health score over last hour/day)
- Recent health events (state transitions)
- Component metrics (per Doc 11's JFR-derived metrics)
- For integrations: per-device health (RSSI/LQI, availability, command success rate)

### 4.3 Real-Time Event Stream Display

**Pattern: Windowed Virtual Scroll with Live Append**

The event stream display shows events as they occur in real time. Key implementation requirements:

1. **Virtual scrolling:** Only render events visible in the viewport. For a viewport showing ~20 events, only 20-30 DOM nodes exist regardless of total event count. This is critical — HomeSynapse targets >500 events/sec sustained throughput. Even with filtering, the stream may receive dozens of events per second.

2. **Live append at top:** New events insert at the top of the list. If the user is scrolled to the top (auto-follow mode), new events smoothly appear. If the user has scrolled down (inspection mode), new events append silently and a "N new events" indicator appears at the top.

3. **Client-side filtering:** Filter by entity, event type, capability, area — matching Doc 10's subscription filter parameters. Filtering should be instant (client-side) with the option to modify the WebSocket subscription for server-side filtering of high-volume streams.

4. **Click-to-trace:** Each event in the stream has a "trace" action that assembles the causal chain (§4.1).

**Pattern: Pause/Resume**

Critical for debugging. The user must be able to pause the live stream to inspect events without new events pushing their viewport. Resume returns to auto-follow mode with a catch-up indicator.

### 4.4 Metrics Visualization

**Pattern: Time-Series Sparklines + Detail Panels**

The health overview shows compact sparkline charts (no axes, just the trend shape) for key metrics:
- Event throughput (events/sec)
- Command latency (p50, p99)
- Integration health scores
- Per-device RSSI/availability

Clicking a sparkline opens a full time-series chart with axes, zoom, and time-range selection.

**Chart library consideration:** uPlot (~35 KB gzipped) is purpose-built for time-series with excellent performance on large datasets. Chart.js (~65 KB gzipped) is more versatile but heavier. Chartist (~10 KB gzipped) is lightweight but less capable. For HomeSynapse's constrained bundle budget, uPlot or Chartist are preferable to Chart.js.

### 4.5 Information Density Guidelines

**Pattern: Progressive Disclosure**

- **Level 0 (Glance):** System health traffic light. Green = all healthy, yellow = degraded, red = failed. Visible in browser tab title.
- **Level 1 (Overview):** Three-tier health display + event stream + key metric sparklines. This is the default dashboard view. Answers: "Is everything OK? What just happened?"
- **Level 2 (Investigation):** Expanded service health, per-device metrics, filtered event streams. Answers: "What's wrong with this specific thing?"
- **Level 3 (Root Cause):** Causal chain trace, raw event payloads, JFR metric drill-down. Answers: "Why did this happen?"

Non-technical users should be able to operate at Levels 0-1. Level 2 is for informed homeowners. Level 3 is for developers/advanced users.

---

## 5. Recommendation

### 5.1 Framework: Preact

**Preact** is recommended as the framework for the Observability MVP dashboard.

- 4 KB core enables a total application bundle well under 100 KB gzipped (framework + app logic + charting)
- Full React ecosystem for charting, WebSocket integration, and component patterns
- The most maintainable choice for a solo developer over a 5-year horizon
- If the ecosystem ever becomes a concern, migration to React is mechanical (change the import)
- Strong alternative: Svelte 5 produces smaller bundles but has a smaller support ecosystem

### 5.2 Rendering Architecture: SPA (Client-Side Only)

**Pure SPA** with static file serving from Javalin.

- Zero server CPU cost for rendering — all 4 RPi cores available for event processing
- Consumes existing REST (Doc 09) and WebSocket (Doc 10) APIs directly as JSON
- Static files ship inside the jlink distribution on NVMe
- First paint on LAN: <100ms for a ~50 KB payload

### 5.3 LTD-12 Implications

This research finds that **LTD-12 (Server-rendered HTML + HTMX) is unsuitable for the Observability MVP dashboard** but remains appropriate for future Tier 2 configuration/management UI.

**The case for revising LTD-12:**
- HTMX's server-rendering model competes for RPi CPU that should be dedicated to event processing
- The WebSocket API (Doc 10) publishes JSON events; HTMX expects HTML fragments — fundamental model mismatch
- The dashboard's core features (real-time event stream, interactive charts, trace visualization) require client-side JavaScript regardless
- HTMX's total payload (core + extensions + escape-hatch JS) likely exceeds a purpose-built SPA framework

**Recommended revision:** Narrow LTD-12 to "HTMX for configuration and management UI (Tier 2+)" and add a new decision: "Preact SPA for the Observability MVP dashboard, served as static files from Javalin." This preserves HTMX for where it excels (form-driven CRUD) while using the right tool for the real-time observability use case.

The two approaches are not mutually exclusive. Javalin can serve both static SPA files (for the dashboard at `/dashboard/*`) and server-rendered HTMX pages (for configuration at `/config/*`) from the same HTTP server.

---

## 6. Implications for Doc 13

### 6.1 What the Framework Choice Enables

- **Component-based dashboard architecture.** Preact components map cleanly to dashboard elements: HealthOverview, EventStream, TraceViewer, MetricChart, ServiceCard. Each component manages its own subscription lifecycle.
- **WebSocket integration via hooks.** A `useWebSocket` hook can manage connection lifecycle, subscription management, and reconnection with resume-from-checkpoint (per Doc 10). Components subscribe to specific event filters and receive updates through Preact state.
- **Charting via React ecosystem.** uPlot or Chartist for time-series metrics. No custom charting code needed.
- **Virtual scrolling for event streams.** React-compatible virtual scroll libraries (react-window, react-virtualized) work with Preact via preact/compat.

### 6.2 What the Framework Choice Constrains

- **Build toolchain required.** Vite + Preact plugin produces the static bundle. This is a development-time dependency only — the built output ships as static files. The build step must be documented and reproducible.
- **Bundle budget.** Doc 13 should specify a hard bundle budget. Recommended: **100 KB gzipped total** (framework + application + charting + styles). This is generous for Preact (~4 KB) + uPlot (~35 KB) + application logic.
- **No server-side rendering for the dashboard.** The dashboard is pure client-side. Javalin serves the static files and the REST/WebSocket APIs. No JTE or template engine dependency for the dashboard path.
- **Development-time Node.js dependency.** The Vite build requires Node.js at development time (not at runtime on the RPi). This is acceptable — it's a developer tool, not a deployment dependency.

### 6.3 Architecture Sketch for Doc 13

```
Browser (LAN client)
├── /dashboard/ → Static SPA files (Preact)
│   ├── index.html (shell)
│   ├── app.[hash].js (Preact app, ~50-80 KB gz)
│   └── style.[hash].css (~5-10 KB gz)
│
├── /api/v1/* → REST API (Doc 09)
│   └── JSON responses
│
└── /api/v1/ws → WebSocket API (Doc 10)
    └── JSON event subscriptions

Javalin HTTP Server
├── Static file handler → serves /dashboard/ from classpath resources
├── REST routes → serves /api/v1/*
└── WebSocket handler → serves /api/v1/ws
```

### 6.4 Open Questions for Doc 13

1. **Charting library selection:** uPlot (~35 KB, time-series focused, high performance) vs. Chartist (~10 KB, general purpose, lighter). This is a Doc 13 design decision, not a framework decision.
2. **CSS strategy:** Inline styles, CSS modules, or a minimal utility framework? Preact is agnostic. The choice affects bundle size and maintainability.
3. **Accessibility requirements:** The dashboard should be keyboard-navigable and screen-reader-compatible. Preact's React compatibility means standard ARIA patterns apply.
4. **Mobile/tablet layout:** The dashboard will be accessed from browsers on the same LAN. Should it be responsive for tablet access, or desktop-only for MVP? Recommend desktop-first with basic tablet support (responsive grid, no mobile-specific views).
5. **Browser support floor:** Modern evergreen browsers only (Chrome, Firefox, Safari, Edge — last 2 versions). No IE11, no legacy support. This enables modern CSS (Grid, Custom Properties) and ES2020+ JavaScript.

---

## Appendix A: Bundle Size Reference Table

All values are min+gzip for framework core only (not including application code).

| Framework | Core Size | Real-World App (benchmark) | Notes |
|---|---|---|---|
| Preact | ~4 KB | ~14 KB | +2 KB for preact/compat |
| Svelte 5 | ~3 KB | ~7 KB | Scales with component count |
| Solid.js | ~7 KB | ~10 KB | Finest-grained reactivity |
| Lit | ~5 KB | ~16 KB+ | +Material Web Components |
| Alpine.js | ~7 KB | N/A (not SPA) | Progressive enhancement |
| Petite-Vue | ~6 KB | N/A (experimental) | Vue-compatible, single maintainer |
| HTMX | ~14 KB | ~14 KB + server cost | +3 KB for WS extension |

## Appendix B: Charting Library Size Reference

| Library | Size (min+gz) | Type | Svelte/Preact Support |
|---|---|---|---|
| uPlot | ~35 KB | Time-series focused | Framework-agnostic (DOM-based) |
| Chartist | ~10 KB | General purpose | Framework-agnostic |
| Chart.js | ~65 KB | Full-featured | Wrappers for both |
| Lightweight Charts | ~45 KB | Financial/time-series | Svelte 5 wrapper available |

## Appendix C: Sources

### Framework Benchmarks and Bundle Sizes
- js-framework-benchmark official results: https://krausest.github.io/js-framework-benchmark/current.html
- FrontendTools 2025 comparison: https://www.frontendtools.tech/blog/best-frontend-frameworks-2025-comparison
- JS Framework Size Comparison (GitHub): https://github.com/MarioVieilledent/js-framework-comparison
- Which JS Framework is the Smallest: https://dev.to/pazu/which-js-framework-is-the-smallest-161p

### HTMX
- HTMX Documentation: https://htmx.org/docs/
- HTMX WebSocket Extension: https://htmx.org/extensions/ws/
- Javalin + HTMX Example: https://github.com/AussieGuy0/java-htmx-todo
- Javalin + HTMX Full Stack: https://anthonybruno.dev/2023/06/11/full-stack-development-in-a-single-java-file/
- HTMX vs React 2026: https://www.pkgpulse.com/blog/htmx-vs-react-2026

### Home Assistant Frontend
- HA Frontend Architecture Docs: https://developers.home-assistant.io/docs/frontend/architecture/
- HA Frontend DeepWiki: https://deepwiki.com/home-assistant/frontend
- HA Why Polymer (2016): https://www.home-assistant.io/blog/2016/05/18/why-we-use-polymer/
- HA Performance Issues: https://community.home-assistant.io/t/very-slow-performance-from-lovelace-dashboard/551612
- HA WebSocket Performance: https://community.home-assistant.io/t/lovelace-performance-keeps-getting-worse-websocket-pending/378934
- HA Frontend Slow UI Issue: https://github.com/home-assistant/frontend/issues/17885

### Dashboard UX and Observability
- Observability Dashboards (OpenObserve): https://openobserve.ai/blog/observability-dashboards/
- Top 10 Mistakes in Observability Dashboards: https://logz.io/blog/top-10-mistakes-building-observability-dashboards/
- From Dashboard Soup to Observability Lasagna: https://www.infoq.com/presentations/observability-layers/
- Grafana Dashboard Best Practices: https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/

### Charting Libraries
- Svelte Charting Libraries: https://dev.to/dev_michael/the-hunt-for-the-perfect-svelte-charting-library-a-happy-ending-o0p
- Svelte Lightweight Charts Wrapper: https://github.com/HuakunShen/lightweight-charts-svelte

### Rendering Architecture
- Javalin Rendering/JTE: https://javalin.io/plugins/rendering/
- JTE Template Engine: https://jte.gg/
- Java UI in 2026 Guide: https://robintegg.com/2026/02/08/java-ui-in-2026-the-complete-guide.html
- Alpine.js vs Petite-Vue: https://markaicode.com/alpine-js-vs-petite-vue-performance-comparison/
