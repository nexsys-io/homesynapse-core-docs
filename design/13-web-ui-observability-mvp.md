# HomeSynapse Core — Web UI (Observability MVP)

**Document type:** Subsystem design
**Status:** Draft
**Subsystem:** Web UI (Observability MVP)
**Dependencies:** REST API (Doc 09 — §3.2 endpoint taxonomy, §3.4 command lifecycle, §3.9 Javalin HTTP server, §8 health/event/device/config endpoints, §9 CORS configuration),
  WebSocket API (Doc 10 — §3.3 message protocol, §3.4 subscription model and filter specification, §3.5 first-message authentication, §3.6 Event Relay architecture, §3.7 backpressure and delivery modes, §3.9 reconnection admission control),
  Observability & Debugging (Doc 11 — §3.3 HealthAggregator and three-tier health model, §3.4 TraceQueryService and five query patterns, §3.5 per-subsystem metric surface, §4.1 SystemHealth/SubsystemHealth/TierHealth records, §4.2 TraceChain/TraceEvent records, §8.1–§8.2 HealthContributor),
  Startup, Lifecycle & Shutdown (Doc 12 — §3.1 lifecycle phase model Phase 5 static file serving, §3.7 Phase 5 external interfaces, §8.1 SystemLifecycleManager)
**Dependents:** Master Architecture Document (Doc 14)
**Author:** HomeSynapse Core Architecture
**Date:** 2026-03-10

---

## 0. Purpose

The Web UI is the primary observability interface for HomeSynapse Core at Tier 1. It answers three questions for the homeowner and the developer alike: Is the system healthy right now? What just happened? Why did this happen? The dashboard displays real-time system health across all subsystems, streams live events as they occur, and assembles causal chain traces that connect a device state change to its root cause — whether that root cause is a sensor reading, an automation trigger, a user command, or a system event.

This subsystem exists because HomeSynapse's event-sourced internals are invisible without a rendering surface. The REST API (Doc 09) and WebSocket API (Doc 10) expose the data — health snapshots, event histories, trace chains, metric streams — but raw JSON endpoints are not an observability tool. A user who sees their porch light turn on at 3 AM needs a single click to see the causal chain: motion detected → automation evaluated → condition passed → command issued → device confirmed. Without this subsystem, that investigation requires curl commands against the REST API and manual correlation_id lookups.

The Web UI is an Observability MVP. It is not a full device control dashboard, not a Lovelace-style customizable layout system, not a mobile application, and not a configuration editor. It ships as pre-built static files inside the jlink distribution (LTD-13, LTD-18) and is served from the Raspberry Pi to browsers on the local network. The server's contribution to the dashboard is serving files and JSON — zero CPU is consumed for rendering.

---

## 1. Design Principles

**Client-side rendering, server-side data.** The Raspberry Pi serves static files and JSON APIs. All rendering happens in the browser. The RPi's four Cortex-A76 cores (LTD-02) are fully available for event processing, persistence, and integration management. This is the subsystem-level expression of LTD-18's SPA architecture decision and INV-PR-01 (constrained hardware is the primary design target).

**WebSocket-first for live data.** Real-time state changes, health updates, and event streams arrive via WebSocket subscriptions (Doc 10). REST is for queries, commands, and historical data. The dashboard opens a persistent WebSocket connection on load and maintains it for the duration of the session. This follows the same pattern as every major smart home platform's real-time interface (Doc 10 §0 competitive research).

**Update batching prevents per-event re-renders.** WebSocket events are collected over a 16ms window (one animation frame) and applied in a single render cycle. This prevents the Home Assistant failure mode identified in the framework research (research/Web_UI_Framework_Research_v1.md §3.3): per-event independent re-renders that degrade performance under high event volume. The batch window aligns with the browser's `requestAnimationFrame` cadence.

**Virtual rendering for unbounded data.** Event streams and entity lists use virtual scrolling — only elements visible in the viewport are rendered as DOM nodes. Unbounded DOM growth is prohibited. At 50 events per second, rendering every event as a persistent DOM node would create 180,000 nodes per hour. Virtual scrolling caps the DOM at ~30 nodes regardless of stream volume.

**Progressive disclosure across four information density levels.** Not every user needs the same depth. The dashboard provides four levels: Glance (browser tab title shows system health), Overview (health + live stream), Investigation (per-service or per-device detail), and Root Cause (causal chain trace with payload inspection). Non-technical users operate at Levels 0–1. Developers operate at Levels 2–3.

**Bundle budget is a hard constraint.** The total gzipped payload — framework, charting library, application logic, and styles — must fit within 100 KB (LTD-18). This budget is enforced at build time. Exceeding it is a build failure, not a warning.

---

## 2. Scope and Boundaries

### 2.1 This Subsystem Owns

- The Preact SPA application: component tree, view routing, client-side state management, and build configuration.
- The WebSocket integration layer: connection lifecycle, subscription management, reconnection with resume, and client-side update batching.
- The dashboard views: System Overview, Service Detail, Event Trace, and Device Detail.
- The event stream display: virtual scrolling, live append, auto-follow/inspection modes, and client-side filtering.
- The trace visualization: causal chain assembly from REST query results, vertical timeline rendering, and payload inspection.
- The health dashboard: three-tier health display, service cards, and drill-down navigation.
- The charting components: time-series sparklines on overview, full charts on detail views.
- The static file build pipeline: Vite configuration, bundle budget enforcement, asset hashing, and output packaging for the jlink distribution.
- Client-side error handling and loading states for all data-fetching operations.

### 2.2 This Subsystem Does Not Own

- The REST API endpoints that supply data — owned by **REST API** (Doc 09). The dashboard consumes these endpoints; it does not define them.
- The WebSocket protocol, subscription semantics, or backpressure management — owned by **WebSocket API** (Doc 10). The dashboard is a WebSocket client, not a protocol designer.
- Health aggregation logic, tier classification, or flapping prevention — owned by **Observability & Debugging** (Doc 11). The dashboard displays the `SystemHealth` record; it does not compute it.
- Causal chain assembly logic — owned by **TraceQueryService** (Doc 11 §3.4). The dashboard calls `GET /api/v1/events/trace/{correlation_id}` and renders the result.
- The Javalin HTTP server lifecycle — owned by **Startup, Lifecycle & Shutdown** (Doc 12 §3.7 Phase 5). This subsystem provides the static files; Doc 12 owns serving them.
- API authentication and key management — owned by **REST API** (Doc 09 §12.1). The dashboard stores and transmits the API key; it does not manage the key lifecycle.
- Device command dispatch — owned by **REST API** (Doc 09 §3.4). The Observability MVP is read-only; device control is a Tier 2 feature.
- Configuration editing — deferred to Tier 2 HTMX-based configuration UI per LTD-18.

---

## 3. Architecture

### 3.1 Technology Stack

| Component | Technology | Size (gzipped) | Rationale |
|---|---|---|---|
| UI Framework | Preact 10.x + preact/compat | ~6 KB | React-compatible API at 1/7th the size; largest ecosystem access for solo developer (LTD-18) |
| Build Toolchain | Vite 6.x + @preact/preset-vite | Development-time only | Standard, fast HMR for development; tree-shaking and minification for production |
| Charting | uPlot 1.x | ~35 KB | Purpose-built for time-series; handles 100K+ datapoints without jank; minimal API surface |
| CSS | CSS Modules (via Vite) | ~5–8 KB est. | Scoped class names prevent conflicts; no runtime CSS-in-JS cost; tree-shakeable |
| Virtual Scrolling | Custom implementation | ~2 KB est. | Purpose-built for the event stream's append-at-top pattern; React-compatible virtual scroll libraries assume append-at-bottom |

**Estimated bundle budget allocation:**

| Component | Estimated Size (gzipped) |
|---|---|
| Preact + preact/compat | ~6 KB |
| uPlot | ~35 KB |
| Application components + hooks + routing | ~30–40 KB |
| CSS (all views) | ~5–8 KB |
| **Total** | **~76–89 KB** |
| **Budget** | **100 KB** |
| **Headroom** | **~11–24 KB** |

### 3.2 Build and Distribution

The dashboard is built at development and release time, not at runtime on the RPi. The build produces a small set of static files that ship inside the jlink distribution.

**Build pipeline:**

1. Vite reads the Preact source from the `web-ui/` directory in the repository.
2. `@preact/preset-vite` handles JSX transformation, aliasing `react` to `preact/compat`.
3. Vite's production build performs tree-shaking, minification (esbuild), and CSS module extraction.
4. Output files are content-hashed: `app.[hash].js`, `style.[hash].css`, `index.html`.
5. A build-time script verifies the total gzipped size of all output files against the 100 KB budget. If the budget is exceeded, the build fails with a diagnostic listing per-file sizes.
6. Built files are copied to the Gradle module's `src/main/resources/dashboard/` directory.
7. The Gradle build includes these resources in the jlink image under the classpath.

**Runtime serving:**

Javalin's `staticFiles.add("/dashboard", Location.CLASSPATH)` serves the built files. The `index.html` is served for all `/dashboard/*` paths that do not match a static asset (SPA fallback routing). Static assets carry `Cache-Control: max-age=31536000, immutable` because content hashing guarantees that changed content gets a new URL. `index.html` carries `Cache-Control: no-cache` so the browser always checks for a new version on navigation.

### 3.3 URL Structure

```
/dashboard/                → SPA index.html (Preact app)
/dashboard/assets/*        → JS, CSS (content-hashed, immutable cache)
/api/v1/*                  → REST API (Doc 09)
/api/v1/ws                 → WebSocket API (Doc 10)
```

The dashboard and API share the same Javalin HTTP server instance and the same port (Doc 09 §3.9, Doc 10 §3.1). No additional server, no additional port, no additional TLS termination point.

### 3.4 Application Architecture

The SPA uses a component-based architecture with centralized state management through Preact hooks and context.

```
┌─────────────────────────────────────────────────────┐
│                    Browser                           │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │              Preact App Shell                  │  │
│  │  ┌─────────────┐  ┌────────────────────────┐  │  │
│  │  │ Router      │  │ WebSocket Provider     │  │  │
│  │  │ (hash-based)│  │  connection lifecycle  │  │  │
│  │  └──────┬──────┘  │  subscription mgmt     │  │  │
│  │         │         │  reconnection + resume  │  │  │
│  │         │         │  update batching        │  │  │
│  │         │         └─────────┬──────────────┘  │  │
│  │         │                   │                  │  │
│  │  ┌──────┴───────────────────┴──────────────┐  │  │
│  │  │              Views                       │  │  │
│  │  │                                          │  │  │
│  │  │  ┌────────────┐  ┌──────────────────┐   │  │  │
│  │  │  │ System     │  │ Service Detail   │   │  │  │
│  │  │  │ Overview   │  │ (per-subsystem)  │   │  │  │
│  │  │  └────────────┘  └──────────────────┘   │  │  │
│  │  │  ┌────────────┐  ┌──────────────────┐   │  │  │
│  │  │  │ Event      │  │ Device Detail    │   │  │  │
│  │  │  │ Trace      │  │ (per-device)     │   │  │  │
│  │  │  └────────────┘  └──────────────────┘   │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │                                                │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │          Shared Components               │  │  │
│  │  │  EventStream · HealthCard · SparkChart  │  │  │
│  │  │  TraceTimeline · VirtualScroller        │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
│         │                        │                   │
│    REST API (JSON)         WebSocket (JSON)          │
│    GET /api/v1/*           /api/v1/ws                │
└─────────────────────────────────────────────────────┘
```

**Routing.** Hash-based routing (`/#/overview`, `/#/service/{id}`, `/#/trace/{correlation_id}`, `/#/device/{id}`) avoids server-side route configuration. The Javalin SPA fallback handles direct navigation to any `/dashboard/` path by serving `index.html`; the hash fragment is processed client-side.

**State management.** Application state is held in Preact context providers, not in a separate state library. Two primary providers:

1. **WebSocketProvider** — manages the WebSocket connection, exposes subscription creation/destruction, and distributes batched events to subscribers. Components subscribe to specific event patterns through a `useSubscription(filter)` hook.
2. **HealthProvider** — maintains the current `SystemHealth` snapshot, updated via WebSocket subscription to `system_health_changed` events and initial REST query to `GET /api/v1/system/health`.

View-specific state (selected filters, scroll position, expanded trace nodes) is local to each view component via `useState` and `useReducer`.

### 3.5 WebSocket Integration

The WebSocket integration layer is the most architecturally significant component. It bridges the Doc 10 WebSocket API and the Preact rendering lifecycle.

**`useWebSocket` hook — connection lifecycle:**

1. On app mount, opens a WebSocket connection to `/api/v1/ws`.
2. Sends `authenticate` message with the stored API key (§12 for key storage).
3. On `auth_result` success, transitions to `CONNECTED` state. On failure, displays an authentication error with guidance to configure an API key.
4. Registers subscriptions for each active view's required event filters.
5. On connection loss, transitions to `RECONNECTING` state, displays a reconnecting indicator, and begins exponential backoff reconnection (initial: 1s, max: 30s, jitter: ±25%).
6. On reconnection, re-authenticates and re-subscribes with `from_global_position` set to the `global_position` of the last received event. This triggers Doc 10's replay mechanism (§3.4) to deliver any events missed during disconnection.
7. On tab visibility change (Page Visibility API), pauses non-essential subscriptions when the tab is hidden and resumes when visible. The health subscription remains active (for tab title updates).

**Update batching:**

WebSocket `events` messages are not immediately applied to Preact state. Instead, incoming events are accumulated in a buffer. On each `requestAnimationFrame` callback (~16ms), the buffer is drained and all accumulated events are applied to state in a single batch. This produces one Preact render cycle per frame regardless of event arrival rate.

```
WebSocket events ──▶ Buffer ──▶ requestAnimationFrame ──▶ State update ──▶ Render
                     (accumulate)     (drain every ~16ms)    (single batch)   (once)
```

**Subscription management:**

Views declare their event filter requirements. When a view mounts, the WebSocket layer creates a subscription matching the view's filter. When the view unmounts, the subscription is destroyed. This ensures the server only delivers events relevant to the current view — preventing the wasted rendering cycles identified in the HA frontend analysis (research §3.3).

| View | Subscription Filter |
|---|---|
| System Overview | `event_types: [system_health_changed, state_changed, command_issued]`, `min_priority: NORMAL` |
| Service Detail | `subject_refs: [specific_subsystem_entity_ref]` |
| Event Stream (global) | `min_priority: NORMAL` (or user-selected filter) |
| Device Detail | `subject_refs: [device_entity_refs]` |

### 3.6 Dashboard Views

#### 3.6.1 System Overview (Progressive Disclosure Level 1)

The default landing page. Answers: "Is everything OK? What just happened?"

**Layout (top to bottom):**

1. **Health Banner.** Single-line system status: green/yellow/red indicator + status text + lifecycle state + uptime. Data source: `SystemHealth.status` from HealthProvider. Updates via WebSocket.
2. **Three-Tier Health Grid.** Three horizontal bands (Tier 1: Critical Infrastructure, Tier 2: Core Services, Tier 3: Interface Services) matching Doc 11 §3.3 tier classification. Each band contains service cards. Data source: `SystemHealth.tiers` and `SystemHealth.subsystems`.
3. **Key Metric Sparklines.** Compact time-series charts (no axes, just trend shape) for: event throughput (events/sec), command latency (p99), active WebSocket connections, storage pressure level. Data source: REST query `GET /api/v1/system/info` for historical, WebSocket for live append.
4. **Live Event Stream.** Virtual-scrolling event list showing the most recent events. Auto-follow mode by default. Data source: WebSocket subscription.

**Service card anatomy:**

```
┌──────────────────────────────┐
│ ● Event Bus            HEALTHY │
│   47 events/sec    2m ago     │
│   ▁▂▃▄▅▆▇█▇▆▅▄▃▂▁          │
└──────────────────────────────┘
```

Each card shows: status indicator (colored dot), subsystem name, key metric value, time since last status change, and a sparkline. Click navigates to Service Detail.

#### 3.6.2 Service Detail (Progressive Disclosure Level 2)

Expanded health for a specific subsystem. Answers: "What's wrong with this specific service?"

**Layout:**

1. **Service header.** Name, tier, current health status, status reason, health duration.
2. **Health history chart.** Full time-series chart (with axes, zoom, time-range selection) showing health score over selected period (1h, 6h, 24h, 7d). Data source: REST query `GET /api/v1/system/integrations/{id}` (for integrations) or metric history.
3. **Recent health events.** List of health state transitions for this subsystem. Data source: REST event query filtered by subsystem entity.
4. **Component metrics.** Subsystem-specific metrics from the per-subsystem metric surface (Doc 11 §3.5). Displayed as labeled values with sparklines.
5. **For integration subsystems:** Per-device health table showing RSSI/LQI, availability percentage, command success rate, and last-seen timestamp.

#### 3.6.3 Event Trace (Progressive Disclosure Level 3)

Causal chain visualization. Answers: "Why did this happen?"

**Entry points:** Click any event in the stream (any view), click any state change in Device Detail, or direct URL `/#/trace/{correlation_id}`.

**Layout:**

1. **Trace header.** Correlation ID, trace start/end timestamps, completeness indicator (Complete, In Progress, Possibly Incomplete per Doc 11 §3.4).
2. **Vertical timeline.** Each event in the causal chain rendered as a node on a vertical line, ordered by timestamp. Nodes are connected by causation links (causation_id → parent event). Color-coded by domain:
   - Blue: device events (state_changed, state_reported, availability_changed)
   - Green: automation events (automation_triggered, run_started, run_condition_evaluated, run_completed)
   - Orange: command events (command_issued, command_dispatched, command_acknowledged, command_confirmed, command_failed)
   - Gray: system events (all others)
3. **Event node anatomy:**
   ```
   ┌─ ● 14:30:00.123  automation_triggered ─────────────┐
   │  Actor: motion_sensor_porch (state_changed)         │
   │  Automation: "Porch Light on Motion"                │
   │  ▸ Expand payload                                   │
   └─────────────────────────────────────────────────────┘
   ```
   Each node shows: timestamp, event type, actor/subject, summary line, and an expandable payload section.
4. **In-progress indicator.** For incomplete traces, an auto-refresh mechanism re-queries the correlation_id every 2 seconds until the chain reaches a terminal event (Doc 11 §3.4 completeness detection).

**Data flow:** Single REST call `GET /api/v1/events/trace/{correlation_id}` returns the full causal chain. The UI assembles the tree structure client-side from the `causation_id` relationships. No WebSocket streaming for trace data — traces are historical queries.

#### 3.6.4 Device Detail (Progressive Disclosure Level 2/3)

Per-device metrics and event history. Answers: "What's happening with this specific device?"

**Layout:**

1. **Device header.** Device name, integration, last-seen timestamp, overall availability.
2. **Entity list.** All entities belonging to this device, with current state values. Data source: REST query `GET /api/v1/devices/{device_id}`.
3. **Metrics panel.** Per-device metrics: RSSI/LQI trend (for wireless devices), availability percentage over time, command success rate, event frequency. Full time-series charts.
4. **Event history.** Filtered event stream showing only events for this device's entities. Virtual scrolling, click-to-trace.

### 3.7 Event Stream Component

The event stream is the most technically demanding UI component. It must handle sustained high-frequency event delivery with smooth scrolling and zero DOM bloat.

**Virtual scrolling implementation:**

The event stream renders only events visible in the viewport plus a small overscan buffer (5 items above and below). Each event row has a fixed height (48px for compact, 72px for expanded). The scroller maintains a total height placeholder based on `eventCount × rowHeight`, positions a rendering window within it, and translates visible items to their correct vertical positions via CSS `transform: translateY()`.

Only 30–40 DOM nodes exist at any time, regardless of whether the stream contains 100 or 100,000 events.

**Live append behavior:**

New events arrive at the top of the stream (most recent first). Two modes:

1. **Auto-follow mode (default).** The viewport stays pinned to the top. New events slide in at the top, pushing older events down. If events arrive faster than the 16ms render cycle, they appear as a batch on the next frame.
2. **Inspection mode.** Activated when the user scrolls down. New events continue to arrive (buffered in state) but the viewport does not move. A floating indicator at the top shows "N new events ↑". Clicking the indicator scrolls to the top and re-enters auto-follow mode.

**Client-side filtering:**

The event stream header includes filter controls for: entity type, event type, capability, and area. Filtering is applied in two stages:

1. **Server-side:** When the user sets a filter, the WebSocket subscription is updated (unsubscribe + resubscribe with new filter). This reduces wire traffic from the server.
2. **Client-side:** For rapid filter toggles during exploration, an additional client-side filter is applied to the local event buffer. This provides instant visual feedback while the subscription update propagates.

### 3.8 Health Dashboard

The three-tier health display mirrors the HealthAggregator's composition model (Doc 11 §3.3).

**Tier layout:**

```
┌─────────────────────────────────────────────────────┐
│ TIER 1 — Critical Infrastructure                     │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│ │Event Bus │ │State     │ │Persistence│             │
│ │  ●       │ │Store ●   │ │  ●       │             │
│ └──────────┘ └──────────┘ └──────────┘             │
├─────────────────────────────────────────────────────┤
│ TIER 2 — Core Services                               │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐│
│ │Automation│ │Integration│ │Config    │ │Device   ││
│ │Engine ●  │ │Runtime ●  │ │System ●  │ │Model ●  ││
│ └──────────┘ └──────────┘ └──────────┘ └─────────┘│
├─────────────────────────────────────────────────────┤
│ TIER 3 — Interface Services                          │
│ ┌──────────┐ ┌──────────┐                           │
│ │REST API  │ │WebSocket │                           │
│ │  ●       │ │API ●     │                           │
│ └──────────┘ └──────────┘                           │
└─────────────────────────────────────────────────────┘
```

**Health state data flow:**

1. On page load, REST query `GET /api/v1/system/health` populates the initial `SystemHealth` snapshot.
2. WebSocket subscription to `system_health_changed` events provides real-time updates.
3. Each `SubsystemHealth` change triggers a targeted re-render of only the affected service card (Preact's virtual DOM diffing handles this efficiently).

**Status indicators:** Green circle = HEALTHY, yellow circle = DEGRADED, red circle = UNHEALTHY. Color choices follow conventional traffic-light semantics with sufficient contrast for color-blind users (green: #22c55e, yellow: #eab308, red: #ef4444 — WCAG AA contrast on white background).

### 3.9 Charting

**Sparklines (overview).** Compact, axis-free trend indicators rendered by uPlot with axes, grid, and legend disabled. Fixed height (32px), responsive width. Data: last 60 data points (one per second for the last minute, or one per minute for the last hour depending on the metric). uPlot's GPU-accelerated canvas rendering handles this with sub-millisecond paint times.

**Full charts (detail views).** Time-series charts with axes, grid, legend, and interactive features:
- Time range selection: 1h, 6h, 24h, 7d buttons.
- Zoom: Click-drag to select a time range. Double-click to reset.
- Tooltip: Hover shows exact timestamp and value.
- Live append: When viewing the most recent time range, new data points from WebSocket arrive and the chart scrolls forward.

**Data source:** Historical data from REST API (`GET /api/v1/events` with time range and metric type filtering). Live data from WebSocket subscription. The chart component merges historical and live data, deduplicating by timestamp.

---

## 4. Data Model

The Web UI does not define persistent data structures. All data is consumed from existing APIs. This section documents the client-side state model.

### 4.1 Client-Side State

```
AppState
├── connection: ConnectionState
│   ├── status: CONNECTING | CONNECTED | RECONNECTING | FAILED
│   ├── lastEventPosition: number (global_position of last received event)
│   ├── reconnectAttempt: number
│   └── subscriptions: Map<subscriptionId, SubscriptionState>
│
├── health: HealthState
│   ├── system: SystemHealth (from Doc 11 §4.1)
│   ├── lastUpdated: Instant
│   └── history: HealthTransition[] (last 100 transitions, for sparklines)
│
├── eventStream: EventStreamState
│   ├── events: EventEnvelope[] (ring buffer, max 10,000 events)
│   ├── pendingCount: number (events arrived while in inspection mode)
│   ├── mode: AUTO_FOLLOW | INSPECTION
│   ├── filters: EventFilter
│   └── scrollPosition: number
│
├── currentView: ViewState
│   ├── route: OVERVIEW | SERVICE_DETAIL | EVENT_TRACE | DEVICE_DETAIL
│   ├── params: Map<string, string>
│   └── viewData: view-specific state
│
└── metrics: MetricsState
    ├── snapshots: Map<metricName, TimeSeriesData>
    └── timeRange: 1H | 6H | 24H | 7D
```

### 4.2 Event Buffer Management

The event stream maintains a ring buffer of the most recent 10,000 events. When the buffer is full, the oldest events are evicted. This bounds client-side memory usage to approximately 10,000 × ~500 bytes = ~5 MB for event data. The buffer is indexed by `global_position` for deduplication during WebSocket reconnection replays.

---

## 5. Contracts and Invariants

**C13-01: The dashboard loads and renders within the 100 KB gzipped bundle budget (LTD-18).** The build pipeline enforces this as a hard failure. If the total gzipped output exceeds 100 KB, the build fails. This prevents gradual bundle bloat.

**C13-02: Zero server CPU is consumed for dashboard rendering (LTD-18, INV-PR-01).** The server serves static files and JSON APIs. No template engine, no server-side rendering, no HTML fragment generation for the dashboard. The only server cost is file I/O for static assets (negligible on NVMe) and JSON serialization for API responses (already accounted for in Docs 09 and 10).

**C13-03: WebSocket events are batched before rendering.** Incoming events are accumulated in a buffer and applied to Preact state in a single update per animation frame (~16ms). No WebSocket message directly triggers a Preact render cycle. This is verified by a performance test that delivers 50 events/sec and confirms render cycle count stays at ~60/sec (matching requestAnimationFrame rate), not 50/sec (matching event rate).

**C13-04: The event stream uses virtual scrolling with bounded DOM node count.** At any scroll position, the number of event stream DOM nodes is capped at `visibleCount + 2 × overscanCount` (approximately 30–40 nodes). This is verified by a test that loads 10,000 events and asserts DOM node count is below 50.

**C13-05: All data is consumed from existing REST and WebSocket APIs — no new server endpoints (LTD-18).** The dashboard does not require any server-side changes beyond the static file serving configuration. Every data query uses endpoints defined in Doc 09. Every real-time subscription uses the protocol defined in Doc 10.

**C13-06: The dashboard is fully functional on LAN with no internet connection (INV-LF-01).** All JavaScript, CSS, fonts, and icons are bundled in the static assets. No CDN requests, no external font loading, no analytics scripts, no third-party resources. The dashboard works identically whether the RPi has internet access or not.

**C13-07: Visibility-aware subscriptions reduce wasted work.** When the browser tab is hidden (Page Visibility API `document.hidden === true`), non-essential WebSocket subscriptions are paused. The health subscription remains active to update the tab title. This prevents the HA failure mode of rendering updates for invisible tabs.

---

## 6. Failure Modes and Recovery

**WebSocket disconnection.** Trigger: network interruption, server restart, or idle timeout. Impact: live data stops updating. Recovery: the WebSocket layer enters `RECONNECTING` state, displays a reconnecting indicator (yellow banner below the health banner), and begins exponential backoff reconnection. On reconnection, re-authenticates and resumes from `lastEventPosition` via Doc 10's `from_global_position` parameter. Events missed during disconnection are delivered as a replay batch. The user sees a brief gap in live data followed by a catch-up burst. Event: `ws.reconnection` structured log (client-side console).

**REST API unavailable.** Trigger: server overloaded, server restarting, or network issue. Impact: initial data load fails or refreshes fail. Recovery: each REST query has a retry policy (3 attempts, exponential backoff starting at 500ms). Failed queries display an inline error state in the affected component with a "Retry" button. The rest of the dashboard remains functional — a failed trace query does not affect the health display.

**Authentication failure.** Trigger: invalid or expired API key. Impact: WebSocket connection rejected, REST queries return 401/403. Recovery: the dashboard displays a full-screen authentication error with instructions to configure a valid API key. No partial rendering of unauthenticated data.

**Large event volume overwhelming the UI.** Trigger: >100 events/sec sustained. Impact: potential frame drops during rendering. Mitigation: update batching (C13-03) collects all events per frame; virtual scrolling (C13-04) bounds DOM cost. If the WebSocket server enters batched or coalesced delivery mode (Doc 10 §3.7), the dashboard displays a `delivery_mode_changed` indicator and continues rendering. The user sees coalesced data (most recent value per entity) rather than every intermediate value.

**Browser memory exhaustion.** Trigger: extended session (hours) with high event volume. Mitigation: the event ring buffer is capped at 10,000 events (~5 MB). Chart data is bounded by the selected time range. No unbounded data structures exist in the client-side state model.

**Browser compatibility issues.** Mitigation: the dashboard targets evergreen browsers only — last 2 versions of Chrome, Firefox, Safari, and Edge. No IE11 support. This enables modern CSS (Grid, Custom Properties, container queries) and ES2020+ JavaScript (optional chaining, nullish coalescing, dynamic import). The build pipeline's browserslist configuration enforces this target.

---

## 7. Interaction with Other Subsystems

| Subsystem | Direction | Mechanism | Data |
|---|---|---|---|
| REST API (Doc 09) | Consumes | HTTP GET requests | Entity state, event history, trace chains, system health, device details, automation status, capability schemas |
| WebSocket API (Doc 10) | Consumes | WebSocket subscription | Real-time events (state changes, health changes, commands), delivery mode notifications |
| Observability (Doc 11) | Consumes (via REST/WS) | Indirect through Docs 09 and 10 | SystemHealth snapshots, metric snapshots, trace query results |
| Startup & Lifecycle (Doc 12) | Served by | Static file serving in Phase 5 | Javalin serves `/dashboard/` from classpath resources after Phase 5 initialization |
| Configuration (Doc 06) | Consumes (via REST) | `GET /api/v1/system/info` | Dashboard configuration values (if exposed), system version |

The Web UI has no direct Java interface dependency on any subsystem. It communicates exclusively through the HTTP and WebSocket protocols defined in Docs 09 and 10. This is by design — the dashboard is a static artifact that could theoretically be served by any HTTP server, not just Javalin.

---

## 8. Key Interfaces

This subsystem is a consumer, not a producer of Java interfaces. It exposes no Java API.

### 8.1 Consumed REST Endpoints (from Doc 09 §3.2)

| Endpoint | Purpose in Dashboard |
|---|---|
| `GET /api/v1/system/health` | Initial health snapshot for System Overview |
| `GET /api/v1/system/info` | System version, uptime, device counts for header |
| `GET /api/v1/system/integrations` | Integration list for Service Detail |
| `GET /api/v1/system/integrations/{id}` | Per-integration health detail |
| `GET /api/v1/entities` | Entity listing with state for Device Detail |
| `GET /api/v1/devices/{device_id}` | Device with entities for Device Detail |
| `GET /api/v1/events` | Event history with filtering for Event Stream |
| `GET /api/v1/events/trace/{correlation_id}` | Causal chain for Event Trace view |
| `GET /api/v1/capabilities` | Capability listing for filter dropdowns |

### 8.2 Consumed WebSocket Protocol (from Doc 10 §3.3)

| Message Type | Direction | Purpose in Dashboard |
|---|---|---|
| `authenticate` | Client → Server | First-message authentication on connection open |
| `subscribe` | Client → Server | Create event subscription for current view |
| `unsubscribe` | Client → Server | Remove subscription on view change |
| `ping` | Client → Server | Keepalive (every 30 seconds) |
| `events` | Server → Client | Real-time event delivery (batched client-side before render) |
| `state_snapshot` | Server → Client | Initial state on subscription with `include_initial_state` |
| `delivery_mode_changed` | Server → Client | Backpressure notification (display indicator) |
| `error` | Server → Client | Protocol error handling |
| `subscription_ended` | Server → Client | Replay limit or server-initiated termination |

### 8.3 Exposed Client-Side Interfaces (Preact Hooks)

These are the internal component interfaces that structure the application. They are not public Java APIs but are documented for architectural clarity and future extensibility.

| Hook / Component | Responsibility |
|---|---|
| `useWebSocket()` | Connection lifecycle, authentication, reconnection with resume |
| `useSubscription(filter)` | Manage a WebSocket subscription tied to a component's lifecycle |
| `useHealth()` | Access current SystemHealth from HealthProvider context |
| `useEventStream(filter)` | Access filtered, batched event stream with virtual scroll state |
| `useTraceChain(correlationId)` | Fetch and cache a causal chain via REST |
| `useTimeSeriesData(metric, range)` | Fetch historical + subscribe to live metric data |
| `<VirtualScroller>` | Virtual scrolling container with configurable row height and overscan |
| `<TraceTimeline>` | Vertical causal chain visualization |
| `<SparkChart>` | Compact, axis-free uPlot time-series chart |
| `<FullChart>` | Full uPlot chart with axes, zoom, and time-range selection |

---

## 9. Configuration

All dashboard configuration lives under the `dashboard` key in the HomeSynapse configuration file. Every option has a sensible default — the dashboard runs correctly with zero configuration (INV-CE-02).

```yaml
dashboard:
  enabled: true                      # boolean, default: true
                                     # Enable serving the dashboard at /dashboard/.
                                     # Set to false to disable the web UI entirely.

  path: "/dashboard"                 # string, default: "/dashboard"
                                     # URL path prefix for the SPA. Must not
                                     # conflict with /api/v1/ or other paths.

  event_stream:
    buffer_size: 10000               # int, range: 1000–50000, default: 10000
                                     # Maximum events held in the client-side
                                     # ring buffer. Higher values use more
                                     # browser memory (~500 bytes per event).

    default_filters:                 # Default event stream filter applied on
      min_priority: "NORMAL"         # dashboard load. Users can override in
                                     # the UI. NORMAL excludes DIAGNOSTIC
                                     # events (raw observations, telemetry).

  charts:
    default_time_range: "1h"         # enum: 1h, 6h, 24h, 7d. Default: 1h
                                     # Default time range for detail view charts.
                                     # Users can switch in the UI.

    sparkline_points: 60             # int, range: 30–120, default: 60
                                     # Number of data points in overview sparklines.
                                     # Higher values show more history but
                                     # increase render cost marginally.

  health:
    refresh_interval_seconds: 5      # int, range: 1–60, default: 5
                                     # Fallback polling interval for health data
                                     # if the WebSocket connection is unavailable.
                                     # When WebSocket is connected, health updates
                                     # arrive via subscription (no polling).

  websocket:
    reconnect_initial_ms: 1000       # int, range: 500–5000, default: 1000
                                     # Initial reconnection delay after disconnect.

    reconnect_max_ms: 30000          # int, range: 5000–60000, default: 30000
                                     # Maximum reconnection delay (exponential
                                     # backoff cap).

    batch_interval_ms: 16            # int, range: 8–100, default: 16
                                     # Client-side event batching interval.
                                     # 16ms = one animation frame at 60fps.
                                     # Increase on underpowered client devices.
```

**Configuration delivery:** Dashboard configuration values are read by the Preact application from `GET /api/v1/system/info` (which includes a `dashboard` section in its response). The server reads the YAML configuration at startup and exposes the dashboard-relevant subset through the existing REST API. No separate configuration endpoint is needed.

---

## 10. Performance Targets

All targets are measured with the dashboard served from a Raspberry Pi 5 (LTD-02) to a modern browser on the same LAN (gigabit Ethernet or 802.11ac WiFi).

| Metric | Target | Rationale |
|---|---|---|
| First paint (LAN, cold cache) | < 200 ms | Network transfer of ~80 KB gzipped over gigabit takes ~1 ms. Browser parse + Preact mount + initial REST query dominate. 200 ms feels instantaneous. |
| First paint (LAN, warm cache) | < 100 ms | Content-hashed assets served from browser cache. Only `index.html` revalidated (304 Not Modified). |
| Bundle size (gzipped) | < 100 KB | Hard budget (LTD-18, C13-01). Enforced at build time. |
| Event stream rendering at 50 events/sec | Smooth (no dropped frames) | With 16ms batching and virtual scrolling, 50 events/sec produces ~3 new items per frame. Virtual scroller updates 3 DOM nodes per frame — trivial for modern browsers. |
| Health dashboard update latency | < 16 ms render time | A single service card re-render after a health state change must complete within one animation frame. Preact's virtual DOM diff for a single card change is sub-millisecond. |
| Trace chain rendering (20 events) | < 50 ms | Single REST query (~30 ms per Doc 09 §10) + client-side tree build (~1 ms) + DOM render (~10 ms). |
| Client memory (1 hour session, 50 events/sec) | < 50 MB | Event buffer: ~5 MB (10K events × 500 bytes). Chart data: ~2 MB. Preact component tree: ~5 MB. Browser baseline: ~20 MB. Total: ~32 MB with headroom. |
| WebSocket reconnection (resume) | < 2 seconds | Reconnect + authenticate + replay catch-up. Replay of a 30-second gap at 50 events/sec = 1,500 events, delivered in one batch. |

---

## 11. Observability

The Web UI itself is observable through browser-native mechanisms. No server-side observability is added — the dashboard is a static client.

### 11.1 Client-Side Metrics

The dashboard uses the browser Performance API (`performance.mark()`, `performance.measure()`) to record key interaction timings. These are visible in the browser's DevTools Performance panel.

| Mark | When |
|---|---|
| `hs.dashboard.load.start` | SPA JavaScript begins execution |
| `hs.dashboard.load.first_paint` | First meaningful content rendered (health banner visible) |
| `hs.dashboard.load.data_ready` | Initial REST queries complete, full overview rendered |
| `hs.dashboard.ws.connected` | WebSocket authenticated and first subscription confirmed |
| `hs.dashboard.trace.query_start` | Trace chain REST query initiated |
| `hs.dashboard.trace.rendered` | Trace timeline DOM rendered |

### 11.2 Structured Console Logging

The dashboard logs structured JSON to the browser console for debugging. Logs include a timestamp, level, component, and message.

| Log Event | Level | When |
|---|---|---|
| `ws.connecting` | INFO | WebSocket connection attempt |
| `ws.connected` | INFO | Authentication successful |
| `ws.disconnected` | WARN | Connection lost |
| `ws.reconnecting` | INFO | Reconnection attempt with attempt number |
| `ws.events.batch` | DEBUG | Event batch applied (event count, render time) |
| `ws.delivery_mode` | WARN | Server backpressure mode change |
| `rest.error` | ERROR | REST API query failure with status and endpoint |
| `render.slow_frame` | WARN | Render cycle exceeded 32ms (twice the budget) |

### 11.3 Health Indicator

The Web UI subsystem reports health through the HealthContributor interface (Doc 11 §8.1–§8.2). Because the Web UI is a static file serving concern, its health is effectively the health of Javalin's static file handler. The health indicator is simple:

| State | Condition |
|---|---|
| **HEALTHY** | Static files are being served successfully at `/dashboard/`. |
| **DEGRADED** | Static files exist but Javalin reports errors serving them (e.g., file read failures). |
| **UNHEALTHY** | Static files are missing from the classpath or the `/dashboard/` path is not registered. |

The Web UI is classified as **INTERFACE_SERVICES** tier (Tier 3) in the HealthAggregator (Doc 11 §3.3). A missing or broken dashboard does not affect system health at Tier 1 or Tier 2 — the system continues processing events and running automations regardless of UI availability.

---

## 12. Security Considerations

**Authentication.** The dashboard requires a valid API key to function. On first load, if no API key is stored in the browser, the dashboard displays an API key entry screen. The key is stored in a JavaScript variable for the session duration — not in `localStorage` or cookies (avoiding persistence of credentials across sessions). The key is transmitted in every REST request via the `Authorization: Bearer` header and in the WebSocket `authenticate` message. All authentication validation is performed by the existing REST API (Doc 09 §3.3) and WebSocket API (Doc 10 §3.5) auth layers.

**No credential persistence.** The API key is held in memory only. Closing the browser tab clears it. This is a deliberate Tier 1 choice — the single-user LAN deployment (INV-SE-01) does not justify persistent credential storage with its associated risks (XSS extraction from localStorage, cookie theft).

**Content Security Policy.** Javalin serves the following CSP header for `/dashboard/` responses:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  connect-src 'self' ws://homesynapse.local:* wss://homesynapse.local:*;
  img-src 'self' data:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'none'
```

The `'unsafe-inline'` for styles is required for CSS Modules' runtime injection. All other sources are restricted to same-origin. WebSocket connections are restricted to the HomeSynapse host. No external resources are loaded (INV-LF-01).

**No user input reaches the server except defined API calls.** The Observability MVP is read-only. No forms, no text input fields, no file uploads. The only data flowing from dashboard to server is: API key (authentication), subscription filters (WebSocket messages), and query parameters (REST requests) — all defined in Docs 09 and 10 with their own validation.

**LAN-only in Tier 1.** The dashboard is served over HTTP (not HTTPS) on the local network per the Tier 1 security model. TLS termination is a Tier 2 feature. This is acceptable because Tier 1 is single-user, LAN-only, and the RPi is on a trusted home network (INV-SE-01 scope).

---

## 13. Testing Strategy

### 13.1 Unit Tests

Preact component tests using Preact Testing Library (compatible with React Testing Library API via preact/compat).

**Key test scenarios:**

- Health card renders correct status indicator and metric for each HealthStatus value.
- Event stream virtual scroller renders correct number of DOM nodes regardless of total event count.
- Update batching: mock WebSocket delivers 50 events in 16ms; assert single render cycle.
- Trace timeline assembles tree structure correctly from flat event list with causation_id links.
- Filter controls update subscription parameters correctly.
- Reconnection logic: simulate disconnect, verify exponential backoff timing and `from_global_position` resume.

### 13.2 Integration Tests

End-to-end tests against a mock Javalin server serving the static dashboard and mock REST/WebSocket endpoints.

**Key test scenarios:**

- Full page load: verify first paint within 200ms on a local server.
- WebSocket subscription lifecycle: connect, authenticate, subscribe, receive events, unsubscribe, disconnect.
- Trace query: click an event in the stream, verify REST query to `/api/v1/events/trace/{correlation_id}`, verify timeline renders.
- Health update: mock a `system_health_changed` WebSocket event, verify the affected service card updates.
- Reconnection: kill the WebSocket connection, verify reconnecting indicator appears, restore connection, verify resume with `from_global_position`.

### 13.3 Performance Tests

**Build-time:**
- Bundle size assertion: total gzipped output < 100 KB.
- Tree-shaking verification: no unused Preact APIs or uPlot features in the production bundle.

**Runtime benchmarks:**
- First paint: measure from navigation to first meaningful content on RPi 5 serving to Chrome on LAN. Target: < 200 ms.
- Event stream at 50 events/sec: run for 60 seconds, assert no dropped frames (measured via `requestAnimationFrame` callback timing).
- Virtual scroller DOM node count: load 10,000 events, scroll to various positions, assert DOM node count < 50 at every position.
- Memory after 1 hour at 50 events/sec: assert browser memory < 50 MB.

### 13.4 Failure Tests

- WebSocket disconnect during event delivery: verify no data corruption in event buffer, verify reconnection and resume.
- REST API returning 500: verify error state displayed in affected component, verify retry button works.
- Invalid API key: verify full-screen auth error, no partial dashboard rendering.
- Server sending `delivery_mode_changed` (backpressure): verify indicator appears, verify coalesced events render correctly.
- Tab hidden for 60 seconds during active event stream: verify subscriptions paused, verify resume on tab focus with no event gaps.

### 13.5 Accessibility Tests

- Keyboard navigation: all interactive elements (service cards, event rows, filter controls, trace nodes) reachable via Tab/Enter/Escape.
- Screen reader: ARIA labels on status indicators (not just color), live regions for health state changes, semantic heading hierarchy.
- Color contrast: all text and interactive elements meet WCAG AA contrast ratios.
- Reduced motion: respect `prefers-reduced-motion` media query — disable sparkline animations and smooth scrolling.

---

## 14. Future Considerations

**HTMX configuration UI (Tier 2+, LTD-18).** The `/config/` URL path is reserved for server-rendered configuration and management pages built with HTMX + JTE. These pages coexist on the same Javalin server. The observability dashboard and the configuration UI share the same authentication model but are architecturally independent — the SPA and the HTMX pages do not share components or state.

**Customizable dashboards (Tier 2+).** A Lovelace-style user-configurable layout system where users can arrange cards, add custom panels, and save dashboard configurations. The current fixed-layout design does not prevent this — the component architecture is card-based, and adding a layout engine is an additive change. The decision to defer this is scope discipline: customizable layouts are a feature for users with many devices and complex automations, not for the Tier 1 MVP observability use case.

**Mobile and tablet optimization (Companion tier).** The current design targets desktop browsers on a LAN. Responsive breakpoints for tablet access (portrait mode) are a Phase 2 consideration — the grid layout can be reorganized with CSS media queries without component changes. True mobile optimization (offline support, push notifications, native navigation patterns) belongs to the Companion App tier.

**Dark mode and theming.** CSS custom properties structure the color system for easy theme switching. The MVP ships with a single light theme. Dark mode is a post-MVP enhancement requiring a theme toggle and a second set of CSS custom property values.

**Internationalization.** All user-visible strings are extracted into a locale file structure from the start (even if only `en` is provided in MVP). This prevents the string-extraction retrofit that has caused significant churn in every smart home platform that added i18n later.

---

## 15. Open Questions

1. **Exact charting library: uPlot vs. Chartist.**
   Options: (a) uPlot (~35 KB, purpose-built for time-series, high performance on large datasets, canvas-based); (b) Chartist (~10 KB, general purpose, SVG-based, simpler API but less performant at scale).
   Needed: Hands-on evaluation with representative HomeSynapse metric data during Phase 2 interface specification. The architectural decision (external charting library, loaded as a dependency) is the same regardless.
   Status: **[NON-BLOCKING]** — LTD-18 specifies uPlot as the primary choice with Chartist as the documented fallback. The component interface (`<SparkChart>`, `<FullChart>`) is library-agnostic; swapping the implementation is a localized change.

2. **CSS strategy: CSS Modules vs. utility classes.**
   Options: (a) CSS Modules (scoped class names, Vite-native support, no runtime cost); (b) Utility-first (Tailwind-like, but adding Tailwind increases build complexity and bundle size); (c) Inline styles (simplest, but poor for pseudo-classes and media queries).
   Needed: Phase 2 UI component prototyping will reveal which approach produces the cleanest, most maintainable code for a solo developer.
   Status: **[NON-BLOCKING]** — the architectural design is independent of the CSS strategy. CSS Modules are the current recommendation based on Vite's built-in support and zero runtime overhead.

3. **Mobile breakpoint support level.**
   Options: (a) Desktop-only (viewport < 768px shows a "use a desktop browser" message); (b) Basic responsive (grid reorganizes for tablet portrait, no mobile-specific views); (c) Full responsive (all views adapt to mobile widths).
   Needed: Clarity on Companion App timeline — if a native mobile app is planned for Tier 2, investing in mobile web responsiveness is wasted effort.
   Status: **[NON-BLOCKING]** — the desktop-first layout uses CSS Grid, which naturally supports responsive reorganization via media queries. Adding breakpoints later is an additive CSS change, not an architectural one.

---

## 16. Summary of Key Decisions

| Decision | Choice | Rationale | Section |
|---|---|---|---|
| UI framework | Preact SPA (~6 KB with compat) | React-compatible API, largest ecosystem, safest 5-year solo-developer bet (LTD-18) | §3.1 |
| Rendering architecture | Pure client-side SPA, zero server rendering | Zero RPi CPU for UI rendering (INV-PR-01, LTD-18); WebSocket API delivers JSON, not HTML fragments | §3.2 |
| Bundle budget | 100 KB gzipped hard limit | Build-time enforced; prevents bundle bloat on constrained LAN delivery (LTD-18) | §3.1, §5 C13-01 |
| Charting library | uPlot (~35 KB) with Chartist fallback | Purpose-built for time-series; handles 100K+ datapoints; fits budget (LTD-18) | §3.1, §3.9 |
| Build toolchain | Vite (development-time only) | Fast HMR, tree-shaking, content hashing; no runtime dependency on RPi | §3.2 |
| WebSocket integration pattern | Single connection, per-view subscriptions, 16ms update batching | Prevents HA failure mode of per-event re-renders; aligns with Doc 10 subscription model | §3.5 |
| Virtual scrolling | Custom implementation, ~30 DOM nodes regardless of event count | Prevents unbounded DOM growth at 50+ events/sec (C13-04) | §3.7 |
| Update batching interval | 16ms (requestAnimationFrame cadence) | One render per frame regardless of event rate (C13-03) | §3.5 |
| Progressive disclosure | Four levels: Glance → Overview → Investigation → Root Cause | Non-technical users at Levels 0–1, developers at Levels 2–3; research-informed (§4.5 research) | §3.6 |
| Routing | Hash-based (`/#/view`) | No server-side routing config; SPA fallback serves index.html for all /dashboard/ paths | §3.4 |
| Event stream buffer | Ring buffer, 10,000 events max | Bounds client memory at ~5 MB; sufficient for 3+ minutes at 50 events/sec | §4.2 |
| API key storage | JavaScript variable (session-only, no persistence) | No localStorage/cookie credential exposure; single-user LAN model (INV-SE-01) | §12 |
| Health tier display | Three horizontal bands matching Doc 11 §3.3 | Direct visual mapping of HealthAggregator's tier composition model | §3.8 |
| Trace visualization | Vertical timeline with color-coded domain nodes | Familiar Git-log/Jaeger pattern; expandable payloads for root cause analysis | §3.6.3 |
| Visibility-aware subscriptions | Pause non-essential subscriptions when tab hidden | Prevents wasted rendering and network traffic for invisible content (C13-07) | §3.5 |
| Self-contained assets | All resources bundled, no CDN, no external requests | INV-LF-01 (core without internet); fully functional on isolated LAN | §3.2, §5 C13-06 |

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It is governed by the Design Document Template and will be reviewed during architecture review.*
