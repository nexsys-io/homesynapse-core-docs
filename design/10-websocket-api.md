# HomeSynapse Core — WebSocket API

**Document type:** Subsystem design
**Status:** Locked (2026-03-09)
**Subsystem:** WebSocket API
**Dependencies:** Event Model & Event Bus (§3.4 subscription model, §4.1 event envelope, §4.3 event type taxonomy, §3.2 state event lifecycle, §3.6 backpressure and coalescing, §8.1 EventStore query interface, §8.2 EventEnvelope/SubscriptionFilter types, §8.3 EventPublisher), Device Model & Capability System (§8.1 EntityRegistry interface, CapabilityRegistry interface — used for subscription filter resolution), REST API (§3.3 request lifecycle authentication model, §3.8 RFC 9457 error response model, §12.1 API key authentication, §3.7 ETag/viewPosition consistency model, §3.5 cursor-based pagination via global_position), State Store & State Projection (§8.1 StateQueryService interface, §4.1 EntityState record, §5 viewPosition contract), Identity and Addressing Model (§2 three-layer identity, §4 entity selectors, §7 label resolution), Glossary v1 (§2 Device Model vocabulary, §3 Event-Sourced Model vocabulary)
**Dependents:** Web UI (Doc 13 — §3.5 WebSocket integration layer with connection lifecycle and update batching, §8.2 consumed message protocol, §3.5 reconnection with from_global_position resume and replay_queued handling, §3.7 event stream subscription management, §3.8 health subscription for real-time updates), Master Architecture Document (API surface consolidation, streaming contract specification), Observability & Debugging (live event trace streaming, subscriber health metrics), Startup, Lifecycle & Shutdown (Doc 12 — Phase 5 WebSocket handler registration, §3.9 shutdown step 3)
**Author:** HomeSynapse Core Architecture
**Date:** 2026-03-08

---

## 0. Purpose

The WebSocket API subsystem provides persistent, bidirectional streaming connections for real-time event delivery, live state updates, and subscription-based monitoring. It is the streaming complement to the REST API (Doc 09): where the REST API serves synchronous request-response interactions — state queries, command dispatch, event history retrieval — the WebSocket API delivers events to connected clients as they occur, with sub-second latency from persistence to client frame.

This subsystem exists because polling the REST API for state updates is wasteful on constrained hardware and introduces latency that undermines the explainability battlefield. When a user asks "why did the porch light turn on?", the answer must appear in the event trace viewer as the causal chain unfolds — not seconds later on the next poll cycle. The WebSocket API makes the event bus's internal notification model available to external clients, bridging the gap between the in-process subscriber architecture (Doc 01 §3.4) and browser-based dashboards, companion apps, and developer tools.

Cross-platform research across Home Assistant, openHAB, SmartThings, Alexa, Google Home, Matter, Zigbee, HomeKit, Domoticz, and Node-RED reveals a consistent pattern: every platform with a real-time API uses WebSocket for interactive clients. Home Assistant's WebSocket API is the most direct precedent — it provides authentication handshake, event subscription, and command dispatch over a single connection. openHAB documents explicit keepalive and idle timeout semantics. SmartThings offers the most granular filtering model (per-device, per-capability, per-attribute, with `stateChangeOnly`). Matter negotiates min/max reporting intervals per subscription. No platform, however, combines durable resume-from-checkpoint semantics with live tailing — clients that disconnect and reconnect must either accept gaps or fall back to polling REST history endpoints. HomeSynapse's event-sourced architecture provides checkpoint-based resume as a natural property: a client subscribes with `from_global_position` and receives a gapless stream from that point forward, whether the events are historical catch-up or live.

---

## 1. Design Principles

**The WebSocket API is an external subscriber, not a separate event system.** The WebSocket server registers as a subscriber of the in-process Event Bus (LTD-11: no external message broker). It receives events through the same checkpoint-based pull mechanism that the State Projection, Automation Engine, and Causal Chain Projection use. The WebSocket layer adds connection management, client-side filtering, and wire-format serialization — it does not introduce a second delivery path or a second consistency model.

**Resume-from-checkpoint is the default, not a special mode.** Every subscription accepts an optional `from_global_position` parameter. If provided, the server replays persisted events from that position before switching to live tailing. If omitted, the subscription starts at the current log head (live-only). This erases the distinction between "catch up after a disconnect" and "start a new subscription" — both are the same operation with different starting positions. This is the WebSocket-level expression of Doc 01 §3.4's subscriber checkpoint model.

**Client-side filtering reduces wire traffic, not server-side event processing.** The WebSocket server maintains a single Event Bus subscription (or a small number of subscriptions grouped by filter profile). Per-client filters are evaluated after the server receives events from the bus, before serializing and sending frames to each client. This avoids registering hundreds of Event Bus subscribers — one per WebSocket client — which would amplify notification overhead on constrained hardware.

**Backpressure is visible and graduated, not silent.** When a client falls behind the live event stream, the server does not silently drop events. It transitions through defined backpressure stages — batched delivery, then coalesced delivery with explicit notification — and informs the client of each transition. The client always knows whether it is receiving the full stream or a degraded view.

**The WebSocket API serves JSON for programmatic clients. HTML fragment delivery is the Web UI's concern.** The WebSocket API defined in this document delivers JSON-serialized event envelopes to any client that speaks the protocol. The Web UI (Doc 13) may require HTML fragment delivery for HTMX-based DOM updates — that is a rendering concern owned by the Web UI subsystem, not a wire protocol concern for the programmatic API.

---

## 2. Scope and Boundaries

### 2.1 This Subsystem Owns

- The WebSocket server lifecycle: upgrade handling, connection acceptance, frame processing, and graceful disconnection.
- The WebSocket message protocol: client-to-server and server-to-client message types, framing, and correlation.
- The subscription model for external clients: filter specification, subscription lifecycle, multiple subscriptions per connection, and resume semantics.
- Client authentication over WebSocket (compatible with Doc 09 §12.1 API key model, adapted for the WebSocket transport constraint).
- Per-client backpressure management: buffer monitoring, delivery mode transitions, and client notification.
- Connection resource management: concurrent connection limits, per-connection memory budgets, keepalive, and idle timeout.
- The AsyncAPI 3.0 specification as the source of truth for the WebSocket protocol contract (complementing Doc 09's OpenAPI 3.1 for REST).

### 2.2 This Subsystem Does Not Own

- Event persistence, ordering, or delivery guarantees — owned by the **Event Model & Event Bus** (Doc 01). The WebSocket API is a consumer of the Event Bus, not a parallel delivery system.
- Event query by position or subject — owned by the **EventStore** interface (Doc 01 §8.1). The WebSocket API reads from EventStore for replay; it does not maintain its own event index.
- Command dispatch — owned by the **REST API** (Doc 09 §3.4). Commands flow through `POST /api/v1/entities/{id}/commands`, not through WebSocket messages. This keeps the command lifecycle — validation, EventPublisher.publishRoot(), four-phase tracking — in a single code path.
- Current state computation — owned by the **State Store & State Projection** (Doc 03). The WebSocket API may query StateQueryService for initial state snapshots but does not derive state.
- HTML fragment rendering for the Web UI — owned by the **Web UI** (Doc 13). The WebSocket API delivers JSON; any server-side rendering of HTML fragments from events is the Web UI's responsibility.
- API key creation, storage, and revocation — owned by the **REST API** authentication model (Doc 09 §12.1). The WebSocket API validates keys against the same key store.
- Domain event production — the WebSocket API does not produce domain events. It is a consumer of the Event Bus, not a producer. Connection lifecycle, subscription management, and relay health are captured through structured logging (§11.2) and JFR metrics (§11.1), not through the event log. The Event Relay's checkpoint is the only persistent state this subsystem creates, managed through the Event Bus's checkpoint table (Doc 01 §3.4).

---

## 3. Architecture

### 3.1 Subsystem Position

The WebSocket API sits alongside the REST API at the outer edge of the system. Both subsystems share the same HTTP server instance (Javalin or equivalent, per Doc 09 §3.9) — the WebSocket endpoint is registered as an upgrade handler on the same port. This avoids a second listener, a second TLS termination point (Tier 2), and a second CORS configuration.

```
          ┌─────────────────────────────────┐
          │       External Clients          │
          │  Web UI · App · Dev Tools       │
          └──────────────┬──────────────────┘
                         │ HTTP Upgrade → WS
                         ▼
┌────────────────────────────────────────────────┐
│        Shared HTTP Server (Javalin)            │
│                                                │
│  ┌──────────────────┐  ┌───────────────────┐  │
│  │ REST API (Doc 09) │  │ WS Upgrade /ws/v1 │  │
│  └──────────────────┘  └─────────┬─────────┘  │
│                                  │             │
└──────────────────────────────────┼─────────────┘
                                   │
          ┌────────────────────────┼─────────┐
          │  WebSocket API Subsystem         │
          │                                  │
          │  ┌────────────────────────────┐  │
          │  │ Connection Manager         │  │
          │  │  auth, subscriptions,      │  │
          │  │  send buffer, backpressure │  │
          │  └─────────────┬──────────────┘  │
          │                │                 │
          │  ┌─────────────┼──────────────┐  │
          │  │ Event Relay                │  │
          │  │  Single bus subscriber     │  │
          │  │  Per-client filter eval    │  │
          │  └─────────────┬──────────────┘  │
          │                │                 │
          └────────────────┼─────────────────┘
                           │ Java Interfaces
              ┌────────────┼────────────┐
              ▼            ▼            ▼
     ┌────────────┐ ┌──────────┐ ┌───────────┐
     │ EventStore │ │ EventBus │ │ StateQuery│
     │ (01 §8.1)  │ │ (01 §3.4)│ │ (03 §8.1) │
     └────────────┘ └──────────┘ └───────────┘
```

### 3.2 Transport Decision: WebSocket Only

The WebSocket API defines WebSocket as the sole streaming transport. Server-Sent Events (SSE) was considered and rejected for the programmatic API.

**Alternatives evaluated:**

| Option | Strengths | Weaknesses |
|---|---|---|
| WebSocket only | Bidirectional (subscribe, unsubscribe, ping within the connection); well-supported by Javalin; single connection for all subscription management | Requires HTTP upgrade; some corporate proxies interfere; browser API cannot set custom headers |
| SSE only | HTTP-native (no upgrade); auto-reconnect built into EventSource API; works through all proxies; natural fit for HTMX | Server-to-client only — subscribe/unsubscribe/ping require separate REST calls; no standard binary frame support; reconnection loses subscription state |
| Both | Maximum client flexibility | Two transport implementations to maintain, test, and document; doubles the attack surface; increases code complexity for marginal gain |

**Decision: WebSocket only for the programmatic API.** The bidirectional channel eliminates the need for separate REST calls to manage subscriptions, which would increase request count on constrained hardware. The browser header limitation is addressed through first-message authentication (§3.5). SSE may be used by the Web UI (Doc 13) for HTMX fragment delivery, but that is a UI-layer concern outside this document's scope.

### 3.3 Message Protocol

All WebSocket communication uses JSON text frames (LTD-08: Jackson for all serialization). Binary frames are not used in Tier 1.

**Message structure.** Every message — client-to-server and server-to-client — follows a common envelope:

```json
{
  "id": 1,
  "type": "subscribe",
  ...
}
```

The `id` field is a client-assigned integer that correlates requests with responses. The server echoes the `id` in its response to a client request. Server-initiated messages (event delivery, keepalive) carry `id: null`.

**Client-to-server message types:**

| Type | Purpose | Fields |
|---|---|---|
| `authenticate` | Authenticate the connection (must be first message) | `api_key` |
| `subscribe` | Create a new subscription | `filter`, `from_global_position` (optional), `include_initial_state` (optional) |
| `unsubscribe` | Remove a subscription | `subscription_id` |
| `ping` | Client-initiated keepalive | — |

**Server-to-client message types:**

| Type | Purpose | Fields |
|---|---|---|
| `auth_result` | Authentication outcome | `success`, `error` (if failed), `connection_id`, `server_time` |
| `subscription_confirmed` | Subscription created | `subscription_id`, `filter` (echoed), `replay_from` (if resuming) |
| `subscription_error` | Subscription creation failed | `error_type`, `detail` |
| `events` | Event delivery (one or more events) | `subscription_id`, `events[]`, `delivery_mode` |
| `state_snapshot` | Initial state snapshot for subscription | `subscription_id`, `view_position`, `entities[]` |
| `delivery_mode_changed` | Backpressure transition notification | `subscription_id`, `old_mode`, `new_mode`, `reason` |
| `error` | Protocol-level error | `error_type`, `detail`, `fatal` (boolean) |
| `pong` | Response to client ping | `server_time` |
| `subscription_ended` | Server-initiated subscription termination | `subscription_id`, `reason` |
| `replay_queued` | Replay request queued during post-restart admission control (§3.9) | `position_in_queue`, `estimated_wait_ms`, `last_seen_position` |

**Error types follow Doc 09's RFC 9457 pattern**, using the same `error_type` identifiers (e.g., `authentication-required`, `forbidden`, `rate-limited`, `invalid-parameters`) for consistency across the API surface.

### 3.4 Subscription Model

Each WebSocket connection may maintain multiple concurrent subscriptions, each with independent filters and delivery state. This enables a dashboard to maintain one subscription for entity state changes and a separate subscription for automation run events without multiplexing at the application level.

**Filter specification:**

```json
{
  "event_types": ["state_changed", "availability_changed"],
  "subject_refs": ["01HV...entity_id_1", "01HV...entity_id_2"],
  "area_refs": ["01HV...area_id"],
  "label_refs": ["01HV...label_id"],
  "entity_types": ["light", "sensor"],
  "capabilities": ["on_off", "temperature_measurement"],
  "min_priority": "NORMAL",
  "state_change_only": true,
  "min_interval_ms": 100,
  "max_interval_ms": 5000
}
```

All filter fields are optional. An empty filter receives all events — equivalent to subscribing to the full Event Bus stream. Filters combine with AND semantics across fields and OR semantics within array fields. That is: an event must match at least one entry in every specified array field to pass the filter.

**Filter field semantics:**

- `event_types`: Match events whose `event_type` is in this set. Empty or absent means all types.
- `subject_refs`: Match events whose `subject_ref` is in this set. These are ULID entity, device, automation, or system references.
- `area_refs`: Match events whose subject is assigned to any of the specified areas. Resolution is performed against the EntityRegistry at subscription creation time. Per Glossary §1.5 (label resolution determinism), area membership is resolved once at subscription creation — entities moved to a different area after subscription creation are not included or excluded until the subscription is recreated.
- `label_refs`: Match events whose subject carries any of the specified labels. Resolution follows the same once-at-subscription-creation semantics as `area_refs`.
- `entity_types`: Match events whose subject is an entity of the specified type(s). Resolution performed against the EntityRegistry.
- `capabilities`: Match events whose subject exposes any of the specified capabilities. Resolution performed against the CapabilityRegistry.
- `min_priority`: Minimum event priority to deliver. Default: `DIAGNOSTIC` (all events). Set to `NORMAL` to exclude raw observations and diagnostics.
- `state_change_only`: When `true`, deliver only events where the payload indicates an actual state transition. Applies to `state_changed` events (always transitions by definition) and suppresses `state_reported` events where the value equals the current canonical state. Inspired by SmartThings' `stateChangeOnly` subscription option.
- `min_interval_ms` / `max_interval_ms`: Server-side coalescing window for high-frequency entities. When both are set, the server may hold events for up to `min_interval_ms` and must deliver within `max_interval_ms`, coalescing intermediate values. This mirrors Matter's negotiated subscription interval model (Matter Interaction Model §8.5) and prevents a noisy sensor from flooding the WebSocket with redundant frames.

**Resolution cost control.** Filters that reference `area_refs`, `label_refs`, `entity_types`, or `capabilities` require EntityRegistry lookups to resolve the set of matching `subject_ref` values. This resolution is performed once at subscription creation time and cached as a materialized set of `subject_ref` ULIDs on the subscription object. If the resolved set exceeds 500 subject refs, the server rejects the subscription with a `subscription_error` (type: `filter-too-broad`) and a `detail` field suggesting more specific filters. This prevents a single subscription from requiring per-event lookups against the registry.

**Resume semantics.** When `from_global_position` is present, the server reads events from the EventStore starting at the specified position and delivers them to the client as a replay batch before switching to live tailing. The `events` message includes a `delivery_mode` field indicating `replay` or `live`. The transition from replay to live happens when the replay cursor reaches within 10 events of the log head (matching Doc 01 §9 `processing.replay_to_live_threshold`). The client can use the `global_position` of the last event it received from a previous session (or from a REST API event query response per Doc 09 §3.5) as the `from_global_position` to resume without gaps. If the replay would exceed `max_replay_events` (§9), the server terminates the subscription with a `subscription_ended` message (reason: `replay_limit_exceeded`) including the `global_position` where replay stopped. The client should use the REST API event history endpoints (Doc 09 §3.2 Plane 3) with pagination to catch up to a more recent position, then resubscribe with a closer `from_global_position`.

**Initial state snapshot.** When `include_initial_state` is `true`, the server queries the StateQueryService for the current state of all entities matching the subscription filter and delivers it as a `state_snapshot` events message before event streaming begins. This allows a client to populate its initial view without a separate REST API call.

**Subscription limits.** Each connection may maintain at most 10 concurrent subscriptions. Attempting to create an 11th returns a `subscription_error` (type: `subscription-limit-exceeded`).

### 3.5 Authentication

WebSocket authentication uses the same API key model as the REST API (Doc 09 §12.1) but adapts for the WebSocket transport constraint: the browser WebSocket API does not support custom headers, so the `Authorization: Bearer` pattern used by REST cannot be used directly.

**Authentication mechanism: first-message authentication.** The client must send an `authenticate` message as the first message after the WebSocket connection is established. The server rejects any non-`authenticate` message on an unauthenticated connection with a fatal `error` message and closes the connection.

```json
{
  "id": 1,
  "type": "authenticate",
  "api_key": "dGhpcyBpcyBhIHRlc3Qga2V5..."
}
```

The server validates the API key against the same key store used by the REST API's AuthMiddleware (Doc 09 §8.1). On success:

```json
{
  "id": 1,
  "type": "auth_result",
  "success": true,
  "connection_id": "ws_01HV...",
  "server_time": "2026-03-08T14:30:00.000Z"
}
```

On failure, the server sends an error response and closes the connection with WebSocket close code 4403 (custom code in the 4000–4999 range reserved for applications, aligned with HTTP 403 semantics per Doc 09 §3.3 which maps invalid API keys to `forbidden` / 403):

```json
{
  "id": 1,
  "type": "auth_result",
  "success": false,
  "error": {
    "error_type": "forbidden",
    "detail": "Invalid API key."
  }
}
```

**Authentication timeout.** If no `authenticate` message arrives within 5 seconds of connection establishment, the server closes the connection with close code 4408 (authentication timeout). This prevents unauthenticated connections from consuming resources.

**Why not query parameter or subprotocol authentication?** Passing the API key as a URL query parameter (`/ws/v1?api_key=...`) risks key leakage in server access logs, proxy logs, and browser history. The `Sec-WebSocket-Protocol` subprotocol header is a viable alternative (used by openHAB) but conflates authentication with protocol negotiation. First-message authentication keeps the key out of URLs and HTTP headers while using the same validation path as REST.

**Per-event authorization.** The authenticated API key's identity determines which events the client may receive. In Tier 1, the permission model is binary: a valid API key grants access to all events. The subscription filter infrastructure is designed to support per-entity, per-area, or per-event-category authorization scoping when the permission model (Glossary §5.5) is extended in Tier 2. The filtering layer (§3.4) already resolves subject refs at subscription time — adding a permission check at this resolution point is an additive change.

### 3.6 Event Relay Architecture

The Event Relay is the internal component that bridges the Event Bus and connected WebSocket clients. It operates as a single Event Bus subscriber with a broad filter (all event types, all priorities), maintaining its own checkpoint in the Event Bus's checkpoint table.

```
┌────────────────────────────────────────────────┐
│              Event Relay                       │
│                                                │
│  ┌──────────────┐  ┌───────────────────────┐  │
│  │Bus Subscriber │─▶│ Client Distributor    │  │
│  │(single)       │  │                       │  │
│  │checkpoint:    │  │ ┌───────┐ ┌───────┐  │  │
│  │  global_pos   │  │ │Cli. 1 │ │Cli. 2 │  │  │
│  └──────────────┘  │ │filter+│ │filter+│  │  │
│                     │ │buffer │ │buffer │  │  │
│                     │ └───────┘ └───────┘  │  │
│                     └───────────────────────┘  │
└────────────────────────────────────────────────┘
```

**Processing flow:**

1. The Event Relay's bus subscriber polls events from the EventStore in batches (batch size: 100, matching Doc 01 §9 `bus.subscriber_batch_size`).
2. For each event in the batch, the relay evaluates it against every active client subscription's materialized filter.
3. Matching events are serialized to JSON once per unique filter match (events matching multiple clients with identical filters share the serialized frame).
4. Serialized frames are enqueued in each matching client's send buffer.
5. If a client's send buffer exceeds the backpressure threshold, the relay transitions that client's delivery mode (§3.7).
6. The relay advances its Event Bus checkpoint after all matched events have been enqueued (not after clients have consumed them — the relay's checkpoint is independent of client consumption).

**Why a single subscriber?** Registering one Event Bus subscriber per WebSocket connection would scale poorly. With 10 concurrent connections and 100 events/sec, 10 subscribers would each poll the EventStore for the same events — 1,000 redundant reads/sec. A single subscriber reads each event once and distributes in-memory. The per-subscriber memory overhead is < 5 MB (Doc 01 §10), but the read amplification of N subscribers is the real cost on SQLite.

**Replay handling.** When a client subscribes with `from_global_position` behind the relay's current checkpoint, the relay reads historical events directly from the EventStore (not from the bus subscription) and delivers them as replay. The replay runs on the client's virtual thread, concurrent with live delivery to other clients. When the replay cursor reaches the relay's current position, the client transitions to receiving events from the relay's live distribution path.

**Threading constraint.** The Event Relay's EventStore reads and client replay reads (catch-up on reconnection) route through the Persistence Layer's platform thread read executor (LTD-03, Doc 04). The WebSocket handler's virtual thread parks during each read and resumes when the platform thread completes the JNI call. This prevents carrier thread pinning during client catch-up, which can involve sequential reads of hundreds of events.

### 3.7 Backpressure and Delivery Modes

The server manages per-client backpressure using a three-stage model. Per INV-ES-04, events are delivered only after durable persistence — the WebSocket API never delivers an event before the EventStore has confirmed the write. Backpressure management applies to the client-facing delivery buffer, not to event persistence.

**Stage 1: Normal delivery.** Events are delivered individually as they arrive. The client's send buffer is below the threshold. The `delivery_mode` field in `events` messages is `"normal"`.

**Stage 2: Batched delivery.** When the client's unconsumed send buffer exceeds 32 KB, the server switches to batched delivery: events are accumulated for up to 100 ms and delivered in a single `events` message containing multiple events. This reduces per-message framing overhead and gives slow clients time to drain. The server sends a `delivery_mode_changed` message (old: `normal`, new: `batched`) before the transition.

**Stage 3: Coalesced delivery.** When the client's unconsumed send buffer exceeds 64 KB, the server switches to coalesced delivery. Coalescing applies exclusively to the three coalescable DIAGNOSTIC event types defined in Doc 01 §3.6: `state_reported`, `presence_signal`, and `telemetry_summary`. For these types, if multiple events exist in the client's send buffer for the same `(subject_ref, attribute_key)` tuple, only the most recent is retained — intermediate values are dropped from the buffer (they remain in the Event Log for historical query). All CRITICAL and NORMAL events are delivered individually regardless of buffer pressure. All non-coalescable DIAGNOSTIC events (`command_dispatched`, `subscriber_falling_behind`, `causality_depth_warning`, etc.) are also delivered individually. The server sends a `delivery_mode_changed` message (old: `batched`, new: `coalesced`, reason: `client_buffer_exceeded`). The `events` message includes a `coalesced: true` flag on each event that replaced earlier events for the same `(subject_ref, attribute_key)` tuple.

**Recovery.** When the client's send buffer drains below the recovery threshold (default: 16 KB, see `recovery_threshold_kb` in §9), the server transitions back to normal delivery and sends a `delivery_mode_changed` message.

**Buffer accounting.** The send buffer size is tracked as the sum of serialized JSON byte lengths of unsent messages. The buffer is implemented as a bounded queue per connection. When the buffer would exceed 128 KB (the hard ceiling), the server closes the connection with close code 4429 (client too slow) and a final `error` message. This prevents a single slow client from consuming unbounded memory.

### 3.8 Connection Lifecycle and Keepalive

**Connection establishment.** The client initiates an HTTP upgrade to WebSocket at `/ws/v1`. The server accepts the upgrade and starts the authentication timeout (5 seconds). The client must authenticate before any subscription or ping messages are accepted.

**Keepalive.** The server sends a WebSocket ping frame every 30 seconds. If no pong is received within 10 seconds, the server considers the connection dead and closes it. Clients may also send `ping` messages (application-level), which the server answers with `pong` messages including the current `server_time`. This dual-layer keepalive — WebSocket protocol-level ping/pong for connection liveness, application-level ping/pong for clock synchronization — follows openHAB's explicit keepalive guidance.

**Idle timeout.** A connection with no active subscriptions is closed after 60 seconds of inactivity (no client messages received). Connections with active subscriptions remain open indefinitely as long as the WebSocket ping/pong heartbeat succeeds.

**Graceful shutdown.** During system shutdown (coordinated by Startup, Lifecycle & Shutdown, Doc 12), the WebSocket API sends a `subscription_ended` message to each active subscription with reason `server_shutting_down`, then closes all connections with close code 1001 (Going Away). The shutdown drain period is 5 seconds — matching the REST API's `shutdown_drain_seconds` (Doc 09 §9) is a reasonable starting point, though WebSocket connections may need less time since there are no in-flight request-response cycles to complete.

**Reconnection guidance.** Clients are expected to implement reconnection with exponential backoff (initial delay: 1 second, maximum delay: 30 seconds, jitter: ±500 ms). On reconnection, clients should authenticate and resubscribe with the `global_position` of the last event they processed. The server does not persist client subscription state across connections — subscriptions are ephemeral. This matches HomeKit's HAP event model, where notification registrations do not persist across sessions.

### 3.9 Reconnection Admission Control

After a server restart, all connected clients detect the connection drop (via keepalive failure or transport close) and reconnect simultaneously. Each client authenticates and resubscribes with `from_global_position` to replay missed events. Without admission control, N clients requesting concurrent replays produce N parallel EventStore read streams competing with the State Store's own startup replay for SQLite reader throughput and CPU — a thundering herd that degrades startup performance on constrained hardware.

**Admission model.** The server separates connection acceptance from replay serving:

1. All reconnections are accepted immediately. Authentication is processed normally. Clients are not held in a disconnected state longer than necessary.
2. Subscriptions that request `from_global_position` replay are queued in a bounded replay queue. The queue is FIFO (first authenticated, first served).
3. Replay requests are served sequentially — at most `max_concurrent_replays` (default: 1, configurable range: 1–4, see §9) replay streams are active at any time. Each client's replay is fully served before the next client's replay begins.
4. While a client's replay is queued, the server sends a `replay_queued` message:

```json
{
  "id": null,
  "type": "replay_queued",
  "subscription_id": "sub_01HV...",
  "position_in_queue": 3,
  "estimated_wait_ms": 1500,
  "last_seen_position": 84200
}
```

The `last_seen_position` echoes the client's requested `from_global_position`, confirming the server registered the replay starting point. `estimated_wait_ms` is a best-effort estimate based on the average replay throughput of previously completed replays in this restart cycle (or the performance target from §10 if no replays have completed yet).

5. While queued, the client receives LIVE events normally — the subscription is active for new events even before replay fills the gap. The client is responsible for deduplicating events that arrive via both the live stream and the subsequent replay (events carry `global_position`; the client ignores live events whose position is below the replay cursor).
6. When the client's replay turn arrives, the server delivers replay events in `global_position` order. When the replay cursor reaches the relay's current live position, the gap is filled and the client transitions to live-only delivery.

**Queue overflow.** The replay queue is bounded at `max_connections` entries (matching the connection limit). If the queue is full — which should not happen under normal operation since each connection can only have one pending replay — additional replay requests are rejected with a `subscription_error` (error_type: `replay-queue-full`, detail: "Too many concurrent replay requests. Retry in 5 seconds.").

**Rationale.** Sequential replay serving on constrained hardware is the right tradeoff. With `max_concurrent_replays: 1`, a single replay stream at > 5,000 events/sec (§10) completes a 50,000-event gap in ~10 seconds. With 10 reconnecting clients, the last client waits ~100 seconds — acceptable for a server restart scenario that occurs infrequently. Increasing `max_concurrent_replays` to 2–4 on higher-tier hardware halves or quarters the wait time, but on a Pi 5, concurrent EventStore reads compete for the single NVMe I/O queue and produce diminishing throughput returns.

### 3.10 Client Rate Limiting

Each WebSocket connection is subject to per-message-type rate limits. Rate limiting prevents a misbehaving client (buggy automation tool, runaway integration script, or intentionally abusive client on the local network) from consuming disproportionate server resources.

**Rate limit enforcement is per-connection**, not per-IP and not per-API-key. A single API key may have multiple legitimate connections (e.g., three open dashboard tabs); each connection is independently rate-limited. Per-IP limiting is inappropriate for a local-network smart home system where all clients share the same subnet — a misbehaving tablet should not affect the phone.

**Rate limit table:**

| Message type | Limit | Window | Exceeded behavior |
|---|---|---|---|
| `subscribe` | 20 messages | 10 seconds | `error` frame with `error_type: rate-limited`, 5-second cooldown per connection |
| `unsubscribe` | 20 messages | 10 seconds | `error` frame with `error_type: rate-limited`, 5-second cooldown per connection |
| `ping` | 2 messages | 1 second | Silently dropped (no error frame — avoids amplification) |
| Any message (aggregate) | 100 messages | 1 second | Connection terminated with close code 4429 (client too slow) |

During a cooldown period, messages of the rate-limited type are silently dropped. Messages of other types continue to be processed normally.

**Repeated violation escalation.** If a connection triggers the aggregate rate limit (100 messages/sec) 3 times within 60 seconds, the connection is closed with close code 4429. The `api_key_id` is logged but not banned — the user may have a legitimate client with a bug. A structured `ws.rate_limit.violation` log event (WARN level) is emitted with `connection_id`, `api_key_id`, `message_type`, `rate`, and `violation_count`.

**Implementation.** Rate limiting uses a sliding-window counter per connection per message type. The counters are stored in the `WsClientState` record (§8.2) and consume negligible memory (one long per message type per connection: ~32 bytes total).

---

## 4. Data Model

### 4.1 Event Delivery Message

The `events` message delivers one or more events to a subscription:

```json
{
  "id": null,
  "type": "events",
  "subscription_id": "sub_01HV...",
  "delivery_mode": "normal",
  "events": [
    {
      "event_id": "01HV...",
      "event_type": "state_changed",
      "event_time": "2026-03-08T14:30:00.123Z",
      "ingest_time": "2026-03-08T14:30:00.125Z",
      "subject_ref": "01HV...entity_id",
      "subject_sequence": 42,
      "global_position": 120395,
      "priority": "NORMAL",
      "origin": "PHYSICAL",
      "correlation_id": "01HV...root_event_id",
      "causation_id": "01HV...cause_event_id",
      "actor_ref": null,
      "schema_version": 1,
      "payload": {
        "attribute_key": "brightness",
        "old_value": 50,
        "new_value": 74,
        "triggered_by": "01HV..."
      },
      "coalesced": false
    }
  ]
}
```

The event payload is the full event envelope as defined in Doc 01 §4.1, serialized per LTD-08 (Jackson, SNAKE_CASE naming). Field names match the Glossary §3.9 API tokens exactly. Timestamps are ISO 8601 strings. ULIDs are 26-character Crockford Base32 strings (LTD-04).

The `coalesced` flag is `false` during normal and batched delivery. During coalesced delivery (§3.7 Stage 3), it is `true` for coalescable DIAGNOSTIC events (`state_reported`, `presence_signal`, `telemetry_summary`) that replaced earlier events for the same `(subject_ref, attribute_key)` tuple, indicating that intermediate values were not delivered to this client (they remain in the Event Log for historical query via the REST API).

### 4.2 State Snapshot Message

When `include_initial_state: true` is set on a subscription, the server delivers a state snapshot before event streaming begins:

```json
{
  "id": null,
  "type": "state_snapshot",
  "subscription_id": "sub_01HV...",
  "view_position": 120390,
  "entities": [
    {
      "entity_id": "01HV...",
      "entity_type": "light",
      "display_name": "Kitchen Light",
      "availability": "online",
      "state": {
        "on": true,
        "brightness": 74
      },
      "last_changed": "2026-03-08T14:29:55.000Z"
    }
  ]
}
```

The `view_position` indicates the State Store projection version at the time of the snapshot. Event delivery begins from this position (or from `from_global_position` if specified and earlier), ensuring no state transitions are missed between the snapshot and the event stream.

### 4.3 Subscription Filter Record

Internal type representing a resolved subscription filter:

| Field | Type | Description |
|---|---|---|
| `subscription_id` | String | Server-assigned identifier (`sub_` prefix + ULID) |
| `connection_id` | String | Owning connection identifier |
| `resolved_subject_refs` | Set<ULID> | Materialized set of matching subject refs (null if unfiltered) |
| `event_types` | Set<String> | Matching event types (null if unfiltered) |
| `min_priority` | EventPriority | Minimum priority threshold |
| `state_change_only` | boolean | Suppress redundant state reports |
| `min_interval_ms` | Integer | Coalescing floor (nullable) |
| `max_interval_ms` | Integer | Coalescing ceiling (nullable) |
| `created_at` | Instant | Subscription creation timestamp |

---

## 5. Contracts and Invariants

**Events are delivered only after durable persistence.** Per INV-ES-04, the WebSocket API never delivers an event to a client before the EventStore has confirmed the write. The Event Relay receives events from the Event Bus, which notifies subscribers only after the WAL commit (Doc 01 §3.4). This means WebSocket event delivery has a minimum latency floor equal to the persistence write latency plus bus notification latency.

**Per-entity ordering is preserved within each subscription.** Events for a single `subject_ref` are delivered in `subject_sequence` order within a subscription. Cross-entity ordering follows `global_position` order — events are delivered in the order they were persisted. The relay does not reorder events.

**Coalescing never drops CRITICAL or NORMAL events.** INV-ES-05 guarantees at-least-once delivery for all persisted events unconditionally. Doc 01 §3.6 (decision D10) permits coalescing as a subscriber-level optimization for three specific DIAGNOSTIC event types (`state_reported`, `presence_signal`, `telemetry_summary`) under backpressure — the WebSocket API's Stage 3 coalescing (§3.7) implements this same relaxation at the `(subject_ref, attribute_key)` granularity. A slow client may miss intermediate coalescable DIAGNOSTIC values, but every CRITICAL event, every NORMAL event, and every non-coalescable DIAGNOSTIC event is delivered individually.

**Subscription filters are evaluated at subscription creation time.** Filters referencing areas, labels, entity types, or capabilities are resolved to a set of `subject_ref` ULIDs at creation time. The materialized set does not update dynamically — entities added to an area or label after subscription creation are not included. This is consistent with the label resolution determinism rule in Glossary §1.5 and prevents mid-stream filter changes from causing confusing delivery gaps or duplicates.

**Authentication is required before any subscription.** Per INV-SE-02, no event data is delivered to an unauthenticated connection. The authentication timeout (5 seconds) and the rejection of non-authenticate first messages enforce this boundary.

**Connection closure is explicit and coded.** Every connection termination includes a WebSocket close code and, where possible, a preceding application-level message explaining the reason. Close codes in the 4000–4999 range carry HomeSynapse-specific semantics (§3.5, §3.7). The client never encounters a silent disconnection without diagnostic information.

**The Event Relay handles duplicate delivery idempotently.** Per INV-ES-05, duplicate event delivery is expected during crash recovery. When the Event Relay restarts, it resumes from its last persisted checkpoint and may re-receive events already distributed to clients in the previous session. Since client connections do not survive relay restart, this is benign — reconnecting clients resubscribe with their own `from_global_position` and handle their own deduplication. WebSocket clients that require exactly-once processing semantics at the application layer should use `event_id` for deduplication.

---

## 6. Failure Modes and Recovery

### 6.1 Client Disconnection (Network Failure)

**Trigger:** The network path between client and server drops. The WebSocket ping/pong heartbeat fails (no pong within 10 seconds of server ping).

**Impact:** The client stops receiving events. The server detects the dead connection and releases its resources (subscription state, send buffer memory). No impact on other clients or on the Event Relay's bus subscription.

**Recovery:** The client reconnects, authenticates, and resubscribes with the `global_position` of the last event it processed. The server replays missed events from the EventStore and transitions to live delivery. No events are lost — they remain in the Event Log.

**Events produced:** `ws.connection.closed` structured log entry (WARN level) with `reason: ping_timeout`, `connection_id`, `api_key_id`.

### 6.2 Client Falls Behind (Slow Consumer)

**Trigger:** The client processes events slower than they are produced. Common during event storms (mesh recovery, bulk import) or when the client's network is congested.

**Impact:** The server's per-client send buffer grows. Backpressure stages activate (§3.7): batched delivery at 32 KB, coalesced delivery at 64 KB, connection closure at 128 KB.

**Recovery:** If the client catches up (buffer drains below 16 KB), delivery mode returns to normal. If the connection is closed at the hard ceiling, the client must reconnect with resume.

**Events produced:** `ws.client.backpressure` structured log entry (WARN level) with `delivery_mode`, `buffer_bytes`, `connection_id`, `api_key_id`.

### 6.3 Event Bus Unavailability

**Trigger:** The Event Bus is unable to deliver events — the EventStore is inaccessible (disk failure, database corruption) or the bus notification mechanism is stalled.

**Impact:** The Event Relay stops receiving events. Connected clients stop receiving live updates. Existing subscription state is maintained — clients remain connected.

**Recovery:** When the Event Bus resumes, the Event Relay catches up from its checkpoint. Clients receive the backlog of events that accumulated during the outage. If the relay's checkpoint has been expired by retention (unlikely in a short outage), the relay enters DEGRADED health state and the WebSocket subsystem reports UNHEALTHY.

**Events produced:** Health indicator transitions to DEGRADED. Structured log entry (ERROR level) `ws.relay.bus_unavailable`.

### 6.4 Authentication Store Unavailability

**Trigger:** The API key store (shared with the REST API) is corrupted or inaccessible.

**Impact:** New WebSocket connections cannot authenticate. Existing authenticated connections remain functional — authentication is validated at connection time, not on every message.

**Recovery:** Restore the key store from backup or restart the service. Existing connections continue until they disconnect for other reasons. New connections fail with a fatal error message.

**Events produced:** `ws.auth.store_unavailable` structured log entry (ERROR level).

### 6.5 Connection Resource Exhaustion

**Trigger:** The number of concurrent WebSocket connections exceeds the configured maximum (default: 50).

**Impact:** New connection attempts are rejected with HTTP 503 (Service Unavailable) during the upgrade handshake, with a `Retry-After: 5` header.

**Recovery:** Automatic. As existing connections close, new connections are accepted. The connection limit is a hard ceiling to protect the Pi's memory budget.

**Events produced:** `ws.connection.limit_reached` structured log entry (WARN level) with `current_count`, `max_count`.

### 6.6 Malformed Client Message

**Trigger:** The client sends a message that is not valid JSON, or valid JSON that does not conform to any recognized message type.

**Impact:** The server sends an `error` message with `error_type: invalid-parameters`, `fatal: false`, and a `detail` field describing the parse or validation failure. The connection remains open. Three consecutive malformed messages trigger a fatal error and connection closure (close code 4400).

**Recovery:** The client corrects its message format. No server-side state is affected.

**Events produced:** `ws.message.malformed` structured log entry (WARN level) with `connection_id`, `raw_length`, `error_detail`.

---

## 7. Interaction with Other Subsystems

| Subsystem | Direction | Mechanism | Data | Constraints |
|---|---|---|---|---|
| Event Bus | Subscribes to | Event Bus subscription (Doc 01 §3.4) | All events at all priorities via single relay subscriber | Relay checkpoint stored in bus checkpoint table. Relay operates in LIVE mode only (no REPLAY side-effect suppression needed — it does not produce derived events). |
| EventStore | Reads from | EventStore query interface (Doc 01 §8.1) | Historical events for replay delivery (`readFrom(position, batchSize, filter)`) | Read-only. Used during client subscription with `from_global_position` behind relay checkpoint. |
| StateQueryService | Reads from | StateQueryService interface (Doc 03 §8.1) | Current entity state for `include_initial_state` snapshot delivery | Read-only. Query includes `viewPosition` for consistency tracking. |
| EntityRegistry | Reads from | EntityRegistry interface (Doc 02 §8.1) | Entity area/label/type/capability membership for filter resolution | Read-only. Resolved once per subscription creation. Cached as materialized subject ref set. |
| REST API | Shares with | Shared HTTP server instance, shared API key store | HTTP server, authentication middleware, API version namespace | Both subsystems validate against the same key store. WebSocket endpoint is `/ws/v1`, aligning with REST's `/api/v1` per LTD-16. |
| Web UI | Consumed by | WebSocket connection from browser | Real-time event stream for dashboard rendering | Web UI is a WebSocket client. HTML fragment rendering (if needed for HTMX) is the Web UI's concern, not the WebSocket API's. |
| Startup, Lifecycle & Shutdown | Coordinated by | Lifecycle hooks | Startup: register relay subscriber, bind WebSocket handler. Shutdown: drain connections, close relay subscriber. | WebSocket startup depends on Event Bus and HTTP server being ready. Shutdown sends `subscription_ended` to all clients. |
| Observability & Debugging | Reports to | Metrics and health indicators | Connection count, relay lag, backpressure activations | Feeds into system health aggregation via the health indicator (§11.3). |

---

## 8. Key Interfaces

### 8.1 Interfaces

| Interface | Responsibility |
|---|---|
| `WebSocketLifecycle` | Start (register WebSocket upgrade handler and Event Relay subscriber) and stop (drain connections, close relay) |
| `WebSocketHandler` | Handle individual WebSocket connection events: onConnect, onMessage, onClose, onError. Runs on a virtual thread per connection (LTD-01). If the HTTP server's WebSocket implementation dispatches on platform threads, the handler body is submitted to a virtual thread executor on upgrade completion. |
| `EventRelay` | Single Event Bus subscriber that distributes events to connected clients. Manages the relay checkpoint and per-client filter evaluation. |
| `ClientConnection` | Per-connection state: authentication status, active subscriptions, send buffer, backpressure state, keepalive timer. Subsystem-internal — not referenced in §7 cross-subsystem interactions. |
| `SubscriptionManager` | Create, modify, and remove subscriptions on a connection. Resolves filters, enforces subscription limits, manages replay state. Subsystem-internal — not referenced in §7 cross-subsystem interactions. |
| `MessageCodec` | Serialize and deserialize WebSocket messages (JSON text frames) using the shared Jackson ObjectMapper (LTD-08). Subsystem-internal — not referenced in §7 cross-subsystem interactions. |

### 8.2 Key Types

| Type | Kind | Responsibility |
|---|---|---|
| `WsMessage` | Sealed interface | Root of the WebSocket message type hierarchy. Subtypes: `AuthenticateMsg`, `SubscribeMsg`, `UnsubscribeMsg`, `PingMsg` (client-to-server); `AuthResultMsg`, `SubscriptionConfirmedMsg`, `EventsMsg`, `StateSnapshotMsg`, `DeliveryModeChangedMsg`, `ErrorMsg`, `PongMsg`, `SubscriptionEndedMsg`, `ReplayQueuedMsg` (server-to-client). |
| `WsSubscription` | Record | Active subscription state: `subscriptionId`, `connectionId`, resolved filter, delivery mode, replay cursor (nullable), coalescing state. |
| `WsClientState` | Record | Per-connection state: `connectionId`, `apiKeyIdentity`, authentication timestamp, active subscription map, send buffer metrics, per-message-type rate limit counters (§3.10). |
| `DeliveryMode` | Enum | `NORMAL`, `BATCHED`, `COALESCED` |
| `WsCloseCode` | Enum | Application-specific close codes: `AUTH_FAILED(4403)`, `AUTH_TIMEOUT(4408)`, `CLIENT_TOO_SLOW(4429)`, `SUBSCRIPTION_LIMIT(4409)`, `MALFORMED_MESSAGES(4400)` |

**Identifier conventions.** The `connection_id` format is `"ws_" + ULID` (e.g., `ws_01HV...`). The `subscription_id` format is `"sub_" + ULID` (e.g., `sub_01HV...`). These are subsystem-internal operational identifiers for connection and subscription tracking — they are not persisted in the domain event log and are not registered in the Identity and Addressing Model. The prefixes provide human-readable disambiguation in log entries and debug output.

---

## 9. Configuration

All configuration follows YAML 1.2 (LTD-09) with JSON Schema validation. The WebSocket API runs correctly with zero configuration — all values have sensible defaults (INV-CE-02).

```yaml
websocket:
  # Endpoint
  path: "/ws/v1"                        # WebSocket upgrade path. Matches LTD-16 versioning.
  enabled: true                         # Set false to disable WebSocket entirely.

  # Connection limits
  max_connections: 50                   # Maximum concurrent WebSocket connections.
                                        # Range: 1–200. Default 50 supports 10 dashboards
                                        # with headroom for developer tools. Each connection
                                        # consumes ~256 KB peak (send buffer ceiling + overhead).
                                        # At max: 50 × 256 KB = ~12.5 MB. Within Pi 4 budget.

  max_subscriptions_per_connection: 10  # Range: 1–50. Default 10.

  # Authentication
  auth_timeout_seconds: 5               # Close connection if no authenticate message within this.
                                        # Range: 1–30.

  # Keepalive
  ping_interval_seconds: 30             # Server-initiated WebSocket ping frequency.
                                        # Range: 5–120.
  pong_timeout_seconds: 10              # Close connection if no pong within this after ping.
                                        # Range: 1–60. Must be < ping_interval_seconds.

  # Idle timeout
  idle_timeout_seconds: 60              # Close connection with no active subscriptions after this.
                                        # Range: 10–600.

  # Backpressure thresholds
  backpressure:
    batched_threshold_kb: 32            # Switch to batched delivery above this buffer size.
                                        # Range: 8–128.
    coalesced_threshold_kb: 64          # Switch to coalesced delivery above this buffer size.
                                        # Range: 16–256. Must be > batched_threshold_kb.
    hard_ceiling_kb: 128                # Close connection above this buffer size.
                                        # Range: 32–512. Must be > coalesced_threshold_kb.
    batch_window_ms: 100                # Maximum time to accumulate events in batched mode.
                                        # Range: 10–1000.
    recovery_threshold_kb: 16           # Return to normal delivery when buffer drains below this.
                                        # Range: 4–64. Must be < batched_threshold_kb.
                                        # Default is half of batched_threshold_kb.

  # Replay
  max_replay_events: 100000            # Maximum events to replay per subscription before
                                        # aborting and advising the client to use REST history.
                                        # Range: 1000–1000000.

  # Filter limits
  max_resolved_subjects: 500            # Maximum resolved subject_refs per subscription filter.
                                        # Range: 10–5000.

  # Malformed message tolerance
  max_consecutive_errors: 3             # Close connection after this many consecutive bad messages.
                                        # Range: 1–10.

  # Shutdown
  shutdown_drain_seconds: 5             # Grace period for connection drain during shutdown.
                                        # Range: 1–30.

  # Reconnection admission control (§3.9)
  max_concurrent_replays: 1             # Maximum concurrent replay streams after server restart.
                                        # Range: 1–4. Default 1. Higher values reduce reconnection
                                        # wait time at the cost of increased concurrent SQLite reads.
                                        # On Pi 5, diminishing returns above 2 due to single NVMe
                                        # I/O queue contention.

  # Client rate limiting (§3.10)
  rate_limit:
    subscribe_limit: 20                 # Max subscribe messages per window. Range: 5–100.
    subscribe_window_seconds: 10        # Window for subscribe rate limit. Range: 5–60.
    unsubscribe_limit: 20              # Max unsubscribe messages per window. Range: 5–100.
    unsubscribe_window_seconds: 10     # Window for unsubscribe rate limit. Range: 5–60.
    ping_limit: 2                       # Max client ping messages per second. Range: 1–10.
    aggregate_limit: 100                # Max total messages per second per connection. Range: 10–500.
    cooldown_seconds: 5                 # Cooldown period after per-type rate limit hit. Range: 1–30.
    violation_threshold: 3              # Aggregate violations within violation_window before disconnect.
                                        # Range: 1–10.
    violation_window_seconds: 60        # Window for violation counting. Range: 10–300.
```

**Configuration rationale:**

- `max_connections: 50` — a household with 3 open dashboard tabs, 2 phones running a companion app, and 5 developer tool connections uses 10 connections. 50 provides 5× headroom. Memory ceiling at 50 connections × 256 KB = 12.5 MB, which is within the 512 MB idle memory budget (MVP §8.2).
- `backpressure.hard_ceiling_kb: 128` — at 500 bytes per average event, 128 KB represents ~260 events buffered. A client that is 260 events behind on a 50-device system (producing ~4 events/sec during normal operation) is approximately 65 seconds behind — beyond the threshold for real-time utility.
- `max_replay_events: 100000` — at 10,000 events/sec replay throughput (Doc 01 §10), 100K events takes ~10 seconds. This is long enough to cover a brief disconnection during an event storm, but not so long that replay dominates server resources. For larger gaps, the client should use REST event history endpoints (Doc 09 §3.2 Plane 3) with pagination, then handoff to WebSocket at the last retrieved position.

---

## 10. Performance Targets

All targets are stated for the Raspberry Pi 5 (4 GB RAM) recommended platform per LTD-02, and must also be met on the Raspberry Pi 4 (4 GB RAM) validation floor. Test configurations: 50 devices, ~150 entities, and the typical event rate of ~4 domain events/sec (0.6 events/sec from Zigbee + derived state_changed + automation events). Stress targets use ~100 events/sec (constitutional ceiling from Doc 01 §6, INV-PR-02). Performance on Pi 5 is expected to be 2–3× better than stated targets due to Cortex-A76 single-core gains and 5–7× memory bandwidth improvement (LTD-02).

| Metric | Target | Rationale | Test Method |
|---|---|---|---|
| Event delivery latency (p99, persistence to client frame) | < 10 ms | Combines Doc 01's < 5 ms subscriber notification latency with serialization and frame send overhead. Must feel instantaneous in the dashboard. | Benchmark: inject events via EventPublisher, measure time to WebSocket frame receipt on LAN client. |
| WebSocket connection establishment (upgrade + auth) | < 100 ms | Connection setup is infrequent but must not contribute perceptible delay to dashboard load. | Benchmark: measure time from HTTP upgrade request to `auth_result` message receipt. |
| Replay throughput | > 5,000 events/sec per client | Half of the EventStore's replay throughput (> 10,000 events/sec per Doc 01 §10), because replay includes JSON serialization and WebSocket frame send in addition to EventStore read. | Benchmark: subscribe with `from_global_position` 50,000 events behind, measure events/sec delivered. |
| Concurrent connections without throughput degradation | 20 | 2× the expected maximum for a typical household. At 20 connections with 100 events/sec, the relay distributes ~2,000 filter evaluations/sec — negligible CPU. | Benchmark: 20 connected clients, 100 events/sec sustained, verify all clients receive events within the 10 ms p99 target. |
| Memory per connection (steady state, no backpressure) | < 50 KB | Connection state (auth, subscriptions, filter) + minimal send buffer. 50 connections × 50 KB = 2.5 MB. | Profile: measure per-connection RSS contribution. |
| Memory per connection (backpressure ceiling) | < 256 KB | Send buffer at hard ceiling (128 KB) + connection overhead. This is the worst case. | Profile: measure with buffer at ceiling. |
| Relay subscriber lag (p99) | < 5 ms | The relay must keep pace with the Event Bus. Lag above 5 ms means events are queueing in the bus, not in client buffers. | Benchmark: measure relay's checkpoint distance from log head under sustained 100 events/sec. |

---

## 11. Observability

### 11.1 Metrics

All metrics are exposed via JFR custom events (LTD-15). No Prometheus or OpenTelemetry in Tier 1.

| Metric | Type | Labels | Description |
|---|---|---|---|
| `hs.ws.connections.active` | Gauge | — | Current number of authenticated WebSocket connections. |
| `hs.ws.connections.total` | Counter | — | Total WebSocket connections accepted since startup. |
| `hs.ws.connections.rejected` | Counter | `reason` (`auth_failed`, `auth_timeout`, `limit_reached`, `client_too_slow`) | Connection rejections by reason. |
| `hs.ws.subscriptions.active` | Gauge | — | Current number of active subscriptions across all connections. |
| `hs.ws.events.delivered` | Counter | `delivery_mode` (`normal`, `batched`, `coalesced`) | Events delivered to clients by mode. |
| `hs.ws.events.coalesced` | Counter | — | Events dropped during coalesced delivery (intermediate values replaced). |
| `hs.ws.relay.lag` | Gauge | — | Global positions between the relay checkpoint and the log head. |
| `hs.ws.relay.batch_process_ms` | Histogram | — | Time to process one relay batch (filter evaluation + serialization + enqueue). |
| `hs.ws.client.buffer_bytes` | Histogram | — | Per-client send buffer size distribution. |
| `hs.ws.backpressure.activations` | Counter | `stage` (`batched`, `coalesced`, `closed`) | Backpressure stage transitions. |
| `hs.ws.replay.events_delivered` | Counter | — | Events delivered during replay (catch-up). |
| `hs.ws.messages.received` | Counter | `type` (`authenticate`, `subscribe`, `unsubscribe`, `ping`) | Client messages received by type. |
| `hs.ws.messages.malformed` | Counter | — | Malformed messages received. |
| `hs.ws.replay.queue_depth` | Gauge | — | Current number of replay requests queued during post-restart admission control (§3.9). |
| `hs.ws.replay.queue_wait_ms` | Histogram | — | Time each client waited in the replay queue before replay began. |
| `hs.ws.rate_limit.violations` | Counter | `message_type` (`subscribe`, `unsubscribe`, `ping`, `aggregate`) | Rate limit violations by message type (§3.10). |

### 11.2 Structured Logging

| Log Event | Level | Key Fields | Description |
|---|---|---|---|
| `ws.connection.opened` | INFO | `connection_id`, `remote_address`, `api_key_id` | Connection established and authenticated. |
| `ws.connection.closed` | INFO | `connection_id`, `close_code`, `reason`, `duration_ms`, `events_delivered` | Connection closed (any reason). |
| `ws.subscription.created` | INFO | `connection_id`, `subscription_id`, `filter_summary`, `resolved_subject_count`, `replay_from` | New subscription with filter summary. |
| `ws.subscription.removed` | DEBUG | `connection_id`, `subscription_id` | Subscription removed by client or server. |
| `ws.relay.started` | INFO | `initial_checkpoint` | Event Relay subscriber registered with the Event Bus. |
| `ws.relay.falling_behind` | WARN | `lag`, `threshold` | Relay checkpoint is falling behind the log head. |
| `ws.client.backpressure` | WARN | `connection_id`, `api_key_id`, `delivery_mode`, `buffer_bytes` | Backpressure stage transition for a client. |
| `ws.client.disconnected_slow` | WARN | `connection_id`, `api_key_id`, `buffer_bytes`, `events_dropped` | Connection closed because client exceeded buffer ceiling. |
| `ws.auth.failure` | WARN | `remote_address`, `reason` | Authentication failure (invalid key, timeout). |
| `ws.message.malformed` | WARN | `connection_id`, `raw_length`, `error_detail` | Unparseable or invalid client message. |
| `ws.replay.queued` | INFO | `connection_id`, `subscription_id`, `position_in_queue`, `from_global_position` | Replay request queued during admission control (§3.9). |
| `ws.replay.started` | INFO | `connection_id`, `subscription_id`, `from_global_position`, `queue_wait_ms` | Replay stream began after queue wait. |
| `ws.rate_limit.violation` | WARN | `connection_id`, `api_key_id`, `message_type`, `rate`, `violation_count` | Rate limit exceeded (§3.10). |

### 11.3 Health Indicator

| State | Condition |
|---|---|
| **HEALTHY** | WebSocket handler is registered and accepting connections, Event Relay subscriber is within 1,000 positions of the log head, authentication store is accessible. |
| **DEGRADED** | Event Relay subscriber is more than 1,000 positions behind the log head (clients are receiving stale data). OR more than 50% of connected clients are in backpressure (batched or coalesced) mode. |
| **UNHEALTHY** | Event Relay subscriber checkpoint has expired (retention purged events before relay processed them). OR WebSocket handler is not accepting connections. OR the authentication store is unavailable. |

> **HealthContributor upstream note (Doc 11).** The WebSocket API implements `HealthContributor` (Doc 11 §8.1, §8.2) and is classified as **INTERFACE_SERVICES** tier (Doc 11 §7.1). Startup grace period: 10 seconds. The `reportHealth()` callback returns the three-state indicator from the table above. The WebSocket API also streams system health changes to subscribed clients in real time — it is both a health contributor and a health distribution channel.

---

## 12. Security Considerations

This section is mandatory: the WebSocket API is an external network interface with persistent connections that deliver event data containing occupancy patterns, access events, and behavioral information.

### 12.1 Authentication Handshake

The first-message authentication model (§3.5) ensures that no event data is transmitted before the client proves its identity. The API key is transmitted over the WebSocket connection after the upgrade — in Tier 1 (plain HTTP on LAN, per Doc 09 §12.2), this means the key travels unencrypted on the local network. This is the same exposure as the REST API's `Authorization: Bearer` header. Tier 2 adds TLS, which encrypts the entire WebSocket connection including the authentication message.

The authentication timeout (5 seconds) prevents unauthenticated connections from occupying server resources. Combined with the connection limit (50), this bounds the damage from a connection-flooding attack to 50 TCP sockets held for 5 seconds each.

### 12.2 Per-Event Authorization

In Tier 1, any authenticated API key grants read access to all events. The subscription filter infrastructure is designed for finer-grained authorization: the `resolved_subject_refs` set (§3.4) is the natural injection point for permission-based filtering. When the permission model (Glossary §5.5) is extended, the subscription creation flow adds a permission check: the intersection of "entities the filter matches" and "entities the API key is authorized to observe" becomes the resolved set. Events for unauthorized subjects are never enqueued in the client's send buffer.

### 12.3 Transport Security

Tier 1 serves WebSocket over plain HTTP (ws://) on the local network, matching Doc 09 §12.2's transport security posture. Tier 2 requires WSS (WebSocket over TLS) for any non-LAN access path, using the same certificate infrastructure as the REST API's HTTPS.

### 12.4 Input Validation

All client messages are validated before processing:

- JSON parsing failures are handled without crashing the connection handler (Jackson's streaming parser with size limits).
- The `type` field must match a recognized message type. Unknown types are rejected with `error_type: invalid-parameters`.
- Field values are validated against expected types and ranges (e.g., `from_global_position` must be a non-negative integer).
- The `api_key` field in `authenticate` messages is validated against the key store. Invalid keys are rejected. The raw key value is never logged — log entries reference keys by `api_key_id`.

### 12.5 Audit Trail

Every WebSocket connection and subscription creation is logged with the authenticated `api_key_id`. Event delivery to WebSocket clients is not individually logged (this would overwhelm the log at event rates), but aggregate metrics (events delivered per connection, backpressure activations) provide forensic visibility. The Event Relay's checkpoint position is persisted, providing a bound on what events have been distributed to WebSocket clients.

### 12.6 Event Category Classification (Forward Reference)

With the `event_category` envelope field now defined in the Event Model (Doc 01 §4.1, §4.4 — amendment A-01-DR-1 applied), the WebSocket API subsystem's events declare their categories. The WebSocket API does not produce domain events (§2.2) — connection lifecycle and subscription management are captured through structured logging (§11.2) and metrics (§11.1). However, the WebSocket API delivers domain events to clients, and those events will carry the `event_category` field in their serialized envelopes. The subscription filter (§3.4) should support `event_categories` as a repeatable filter field with OR semantics, enabling clients to subscribe by functional domain (e.g., `["device_state"]`, `["automation"]`, `["energy"]`). This filter field is an additive protocol change and does not require a wire protocol version bump. The `event_categories` filter aligns with Doc 09's planned REST API category filtering and the consent-scope categories defined in the Data-Readiness Specification for future access-control scope alignment (INV-PD-07).

---

## 13. Testing Strategy

### 13.1 Unit Tests

- **Message codec round-trip.** For each client-to-server and server-to-client message type, serialize to JSON and deserialize. Verify all fields survive the round-trip, including nullable fields, timestamps, and ULIDs.
- **Subscription filter matching.** Create events with various `event_type`, `subject_ref`, and `priority` combinations. Apply filters with different field combinations. Verify correct inclusion/exclusion with AND/OR semantics.
- **Backpressure state machine.** Drive a `ClientConnection` through buffer size transitions. Verify delivery mode changes at each threshold (32 KB → batched, 64 KB → coalesced, 128 KB → close, drain below `recovery_threshold_kb` → normal). Verify CRITICAL and NORMAL events are delivered individually during coalesced mode. Verify only coalescable DIAGNOSTIC types (`state_reported`, `presence_signal`, `telemetry_summary`) are coalesced at the `(subject_ref, attribute_key)` level.
- **Authentication timeout.** Create a connection. Do not send `authenticate`. Verify the connection is closed after 5 seconds with close code 4408.
- **Malformed message handling.** Send invalid JSON, valid JSON with unknown `type`, valid JSON with missing required fields. Verify non-fatal error responses. Verify connection closure after 3 consecutive malformed messages.
- **Subscription limit enforcement.** Create 10 subscriptions on a connection. Attempt an 11th. Verify `subscription_error` response.
- **Filter resolution limit.** Create a filter that resolves to > 500 subject refs. Verify `subscription_error` with type `filter-too-broad`.
- **Coalescing interval logic.** Configure `min_interval_ms: 100` and `max_interval_ms: 500`. Send 10 events for the same subject within 50 ms. Verify delivery is held until `min_interval_ms` and coalesced to the latest value.
- **Coalescing type restrictions.** During Stage 3, publish a mix of `state_reported` (DIAGNOSTIC, coalescable), `state_changed` (NORMAL), and `availability_changed` (CRITICAL) events for the same entity. Verify that only `state_reported` events are coalesced at the `(subject_ref, attribute_key)` level; `state_changed` and `availability_changed` are delivered individually.
- **Keepalive — server ping/pong.** Establish a connection with `ping_interval_seconds: 2` and `pong_timeout_seconds: 1`. Verify the server sends a WebSocket ping frame every 2 seconds. Respond with pong. Verify the connection remains open.
- **Keepalive — dead connection detection.** Establish a connection. Suppress pong responses. Verify the connection is closed within `ping_interval_seconds + pong_timeout_seconds` (default: 40 seconds).
- **Application-level ping/pong.** Send a `ping` client message. Verify the server responds with a `pong` message including `server_time`.
- **Idle timeout.** Establish and authenticate a connection. Do not create subscriptions. Verify the connection is closed after `idle_timeout_seconds` (default: 60 seconds). Repeat with an active subscription; verify the connection remains open indefinitely.
- **Replay limit exceeded.** Subscribe with `from_global_position` that would require replaying more than `max_replay_events`. Verify the server sends `subscription_ended` with reason `replay_limit_exceeded` and includes the stopping `global_position`.

### 13.2 Integration Tests

- **Full subscription lifecycle.** Connect, authenticate, subscribe, receive events from EventPublisher-published test events, unsubscribe, verify no further events delivered, disconnect.
- **Resume from checkpoint.** Connect, subscribe, receive events, record `global_position`, disconnect. Publish 100 more events. Reconnect, subscribe with `from_global_position`. Verify all 100 events are delivered in order before switching to live mode.
- **REST-to-WebSocket handoff.** Query `GET /api/v1/events?limit=50`. Extract `global_position` from the last event. Subscribe to WebSocket with that position. Verify the next event delivered is the one immediately after the REST response's last event. No gaps, no duplicates.
- **Multiple subscriptions per connection.** Create two subscriptions with different filters. Publish events matching each. Verify events are routed to the correct subscription. Unsubscribe one. Verify the other continues receiving.
- **Initial state snapshot.** Subscribe with `include_initial_state: true` and a filter matching 10 entities. Verify the `state_snapshot` message contains all 10 entities' current state. Verify event delivery begins after the snapshot.
- **Concurrent connections.** Open 20 connections, each with one subscription. Publish 1,000 events. Verify all 20 connections receive all matching events.
- **Graceful shutdown.** Open connections with active subscriptions. Trigger shutdown. Verify each connection receives `subscription_ended` with reason `server_shutting_down`. Verify connections close with code 1001.

### 13.3 Performance Tests

- **Delivery latency.** 50 devices, typical event rate (~4 events/sec). Measure time from `EventPublisher.publish()` return to WebSocket frame receipt on a LAN client. Verify p99 < 10 ms.
- **Stress delivery latency.** 100 events/sec sustained for 60 seconds, 10 connected clients each with one subscription (all events). Verify p99 < 10 ms across all clients.
- **Replay throughput.** Subscribe with `from_global_position` 50,000 events behind. Measure events/sec delivered. Verify > 5,000 events/sec.
- **Connection churn.** Open and close 100 connections in rapid succession (simulate reconnection storms). Verify no memory leaks, no relay lag increase, no impact on existing connections.
- **Memory under sustained load.** 20 connections, 100 events/sec, 30 minutes. Verify heap usage attributable to WebSocket subsystem does not grow unboundedly.

### 13.4 Failure Tests

- **Event Bus unavailability.** Stop the EventStore (simulate disk failure). Verify existing WebSocket connections remain open, no events delivered, health reports DEGRADED. Restore the EventStore. Verify relay catches up and clients receive backlogged events.
- **Connection limit enforcement.** Open 50 connections. Attempt a 51st. Verify HTTP 503 on upgrade. Close one connection. Verify the next attempt succeeds.
- **Slow client escalation.** Connect a client that reads frames slowly (100 ms per frame). Publish events at 100/sec. Verify backpressure transitions: normal → batched → coalesced → connection closed. Verify the slow client does not affect delivery to other clients.
- **Authentication store failure.** Corrupt the key store. Verify new connections receive `auth_result` with `success: false` and are closed. Verify existing authenticated connections continue receiving events.
- **Reconnection thundering herd.** Establish 10 connected clients. Restart the server. Verify all 10 reconnect, authenticate, and receive `replay_queued` messages with sequential `position_in_queue` values. Verify replays are served sequentially (only one replay active at a time with default `max_concurrent_replays: 1`). Verify all clients receive live events during replay queue wait. Verify no EventStore contention failures.
- **Rate limit enforcement.** Send 25 `subscribe` messages within 10 seconds. Verify that after the 20th, the server responds with `error_type: rate-limited` and subsequent subscribe messages are dropped for 5 seconds. Verify unsubscribe and ping messages continue to be processed during the cooldown. Send 150 messages in 1 second. Verify connection closure with close code 4429.

---

## 14. Future Considerations

**Tier 2: Binary frame support (CBOR).** For bandwidth-constrained mobile clients, the WebSocket API can support CBOR-encoded frames (RFC 8949) as an alternative to JSON text frames. The `authenticate` message would include a `preferred_encoding: "cbor"` field, and the server would switch to binary frames for event delivery. Jackson's CBOR module uses the same ObjectMapper, making this a serialization-layer change. This mirrors the REST API's planned CBOR content negotiation (Doc 09 §14).

**Tier 2: Per-entity and per-area authorization.** When the permission model extends beyond binary API key validation, the subscription filter resolution (§3.4) adds a permission intersection step. Events for unauthorized entities are never delivered. This requires no wire protocol changes — only the server-side filter resolution logic changes.

**Tier 2: Server-initiated command completion notifications.** After a client issues a command via the REST API, the WebSocket API can deliver command lifecycle events (command_dispatched, command_result, state_confirmed) as they occur, without the client polling `GET /api/v1/commands/{id}`. The client subscribes with `event_types: ["command_dispatched", "command_result", "state_confirmed"]` and `correlation_id` filtering (a future filter field). This combines the REST API's command issuance with the WebSocket API's live tailing.

**Tier 3: WebSocket-based command dispatch.** If usage patterns show that the REST roundtrip for command issuance adds unacceptable latency for interactive control (e.g., a slider controlling brightness in real time), a `command` client-to-server message type can be added. The handler would reuse the REST API's command validation and EventPublisher integration (Doc 09 §3.4), keeping the command lifecycle in a single code path. This is deferred because the REST API's command path is already < 15 ms (Doc 09 §10), which is below perceptual threshold for discrete commands.

**Tier 3: Subscription persistence.** Clients that reconnect frequently (mobile apps moving between Wi-Fi and cellular) would benefit from server-side subscription persistence — the server remembers the subscription filter and checkpoint across disconnections. This requires a lightweight subscription registry (likely a SQLite table) and raises complexity around subscription expiration, stale checkpoints, and resource management for abandoned subscriptions. Deferred because the stateless reconnect model (§3.8) is sufficient for LAN-based MVP use.

---

## 15. Open Questions

1. **Should the WebSocket endpoint share the REST API's rate limiter, or have its own?**
   The REST API enforces per-key rate limiting via token bucket (Doc 09 §12.5). WebSocket connections are persistent and do not generate per-request overhead in the same way. Rate limiting at the WebSocket layer is better expressed as connection limits (§9) and subscription limits rather than message-per-minute ceilings.
   Options: (a) Share the rate limiter — each WebSocket message counts against the key's REST rate limit. (b) Separate limits — WebSocket has connection and subscription limits only; the REST rate limiter does not apply. (c) Hybrid — WebSocket `subscribe` and `unsubscribe` messages count against the rate limit; event delivery does not.
   Needed: Usage pattern analysis from the Web UI prototype (Doc 13) to determine message frequency.
   Status: **[NON-BLOCKING]** — connection limits and subscription limits provide sufficient resource protection for Tier 1. Rate limit integration is an additive change.

2. **Should the WebSocket API support `correlation_id` filtering on subscriptions?**
   Enabling a client to subscribe to all events in a specific causal chain would make the trace viewer's real-time mode trivial: subscribe with `correlation_id: X` and watch the chain unfold. This requires adding `correlation_id` as a filter field and evaluating it per-event (low cost — it is an indexed field in the EventStore).
   Options: (a) Add `correlation_id` filter in Tier 1. (b) Defer to Tier 2 — the client can filter client-side from a broader subscription.
   Needed: Confirmation from the Web UI design (Doc 13) on whether real-time trace following is a Tier 1 UI feature.
   Status: **[NON-BLOCKING]** — adding a filter field is an additive protocol change. Client-side filtering works in the interim.

---

## 16. Summary of Key Decisions

| Decision | Choice | Rationale | Section |
|---|---|---|---|
| Transport protocol | WebSocket only (no SSE for programmatic API) | Bidirectional channel eliminates REST calls for subscription management. SSE may be used by Web UI (Doc 13) separately. Principle: "serves JSON for programmatic clients." | §1, §3.2 |
| Authentication mechanism | First-message API key | Browser WebSocket API cannot set custom headers. URL query parameter risks key leakage. First-message auth keeps keys out of URLs/logs. Uses same key store as REST API (Doc 09 §12.1). INV-SE-02. | §3.5 |
| Command dispatch path | REST-only (commands not accepted over WebSocket) | Single code path for command validation, EventPublisher integration, and four-phase lifecycle tracking. Avoids duplicating Doc 09 §3.4 logic. REST command latency (< 15 ms) is below perceptual threshold. | §2.2, §14 |
| Event Relay architecture | Single Event Bus subscriber distributing to clients | Avoids N subscriber registrations (one per client), which would cause N redundant EventStore reads. Single subscriber reads once, distributes in-memory. LTD-11 (no external broker). INV-PR-01 (constrained hardware). Principle: "external subscriber, not separate event system." | §3.6 |
| Subscription state | Ephemeral (not persisted across disconnections) | Matches HomeKit's HAP model. Stateless reconnect via `from_global_position` provides gapless resume without server-side subscription persistence. Simplifies connection lifecycle and resource management. INV-ES-04 guarantees events remain in the log for replay. | §3.8, §14 |
| Resume semantics | Checkpoint-based via `from_global_position` | Natural property of event-sourced architecture (INV-ES-04, Doc 01 §3.4). Client provides last-seen position; server replays from EventStore. No gap between REST history and WebSocket live tailing. Principle: "resume is the default, not a special mode." | §3.4 |
| Backpressure model | Three-stage (normal → batched → coalesced → close) with explicit notification | Graduated response prevents silent data loss. Client is always informed of delivery mode. Coalescing restricted to three DIAGNOSTIC types per Doc 01 §3.6 D10; CRITICAL/NORMAL events always delivered individually. Hard ceiling protects server memory. Principle: "backpressure is visible and graduated." | §3.7 |
| JSON-only wire format (Tier 1) | All messages as JSON text frames per LTD-08 | Consistency with REST API. Jackson serialization reuse. Human-readable for debugging. CBOR binary frames deferred to Tier 2. | §3.3 |
| Per-client filtering | Server-side, evaluated after relay receives events | Single relay subscriber with per-client filter evaluation is more efficient than per-client bus subscriptions. Resolved-subject-ref materialization prevents per-event registry lookups. INV-PR-01 (constrained hardware efficiency). | §3.4, §3.6 |
| HTML fragment delivery | Not in scope (Web UI's responsibility) | WebSocket API is a programmatic JSON interface. HTMX/HTML concerns belong to Doc 13. Principle: "JSON for programmatic clients, HTML is the Web UI's concern." | §1, §2.2 |
| API versioning | `/ws/v1` path prefix aligned with REST's `/api/v1` | Same versioning scheme per LTD-16. URL-versioned API. | §3.1 |
| Filter resolution | Once at subscription creation, cached as materialized subject set | Consistent with Glossary §1.5 label resolution determinism. Prevents per-event registry lookups. Hard limit (500 subjects) prevents unbounded resolution cost. | §3.4, §5 |

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It is governed by the Design Document Template and will be reviewed during architecture review.*
