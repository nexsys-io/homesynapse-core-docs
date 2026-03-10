# HomeSynapse Core — REST API

**Document type:** Subsystem design
**Status:** Locked
**Subsystem:** REST API
**Dependencies:** Event Model & Event Bus (§4.1 event envelope, §4.3 event type taxonomy, §3.2 causal chain semantics, §8.1 EventStore query interface, §8.2 EventEnvelope type, §8.3 EventPublisher), Device Model & Capability System (§3.1 structural overview, §8.1 DeviceRegistry/EntityRegistry/CapabilityRegistry read interfaces, §8.2 Device/Entity/Capability/AttributeValue types, §3.8 command model), State Store & State Projection (§8.1 StateQueryService interface, §4.1 EntityState record, §4.2 StateSnapshot, §5 viewPosition contract), Automation Engine (§8.1 AutomationRegistry/RunManager/PendingCommandLedger interfaces, §8.2 AutomationDefinition/PendingCommand types, §4.1 Run record, §4.2 run trace assembly), Integration Runtime (§8.1 IntegrationSupervisor health interface), Configuration System (§8.1 ConfigurationProvider read interface), Persistence Layer (§8.5 telemetry query interface), Identity and Addressing Model (§2 three-layer identity, §3 slug rules), Glossary v1 (§2 Device Model vocabulary, §4 TCA vocabulary)
**Dependents:** WebSocket API (§3.3 request lifecycle authentication model for first-message auth per Doc 10 §3.5, §3.8 RFC 9457 error_type vocabulary for WebSocket error messages per Doc 10 §3.3, §3.9 shared Javalin HTTP server instance for WebSocket upgrade handler per Doc 10 §3.1, §12.1 API key store and AuthMiddleware for WebSocket key validation per Doc 10 §3.5, §3.5 cursor-based pagination via global_position as REST-to-WebSocket handoff per Doc 10 §3.4), Web UI (primary data source for dashboard rendering), Observability & Debugging (API metrics as observability input), Startup, Lifecycle & Shutdown (HTTP server lifecycle)
**Author:** HomeSynapse Core Architecture
**Date:** 2026-03-09

---

## 0. Purpose

The REST API subsystem exposes HomeSynapse's event-sourced internals through standard HTTP semantics. It is a translation layer — not the primary interface. The event bus, the state projections, and the command pipeline are the platform's real interfaces. The REST API makes those internal surfaces accessible to any HTTP client: the Web UI, the future Companion App, third-party integrations, and the eventual NexSys cloud relay.

Without this subsystem, the only path to HomeSynapse's data and control surfaces is in-process Java method calls. The Web UI cannot render a dashboard. External tools cannot query device state. Users cannot issue commands without protocol-specific knowledge. The REST API bridges the gap between HomeSynapse's internal event-sourced architecture and the widely-understood HTTP request-response model.

The design challenge is that event sourcing and REST occupy different consistency models. Event sourcing is append-only, asynchronous, and eventually consistent by nature. REST clients expect synchronous responses and often assume that a successful write is immediately readable. This subsystem resolves that tension by making the consistency model explicit: every state query response includes a projection version that clients can use to detect staleness, command responses include a trackable identifier for the full four-phase command lifecycle, and event history endpoints expose the append-only log with HTTP caching semantics that match immutability guarantees.

Cross-platform research across SmartThings, Google Home, Home Assistant, Alexa, Matter, and HomeKit reveals a consistent pattern: every major platform has independently converged on typed commands, capability-based device modeling, and subscription-based state sync. No platform, however, exposes all four phases of the command lifecycle (accepted, dispatched, acknowledged, confirmed) through its API. HomeSynapse's event-sourced architecture produces events for each phase naturally. Exposing them through REST is a genuine competitive differentiator.

---

## 1. Design Principles

**The REST API is a translation layer, not a domain model.** The API serializes data shapes from internal interfaces — it does not define its own domain objects or maintain its own state. If the API process crashes and restarts, it has zero state to rebuild. Every response is assembled from queries against StateQueryService, EntityRegistry, EventStore, AutomationRegistry, and PendingCommandLedger. This principle keeps the API stateless and prevents the accumulation of a shadow domain model that drifts from the event-sourced truth.

**Consistency is explicit, never hidden.** Every response that returns projection-derived data includes the projection version (State Store `viewPosition`) as an ETag and a response header. Clients that issue a command and then query state can compare the returned version against the command response's reported version to determine whether the projection has caught up. The API never silently returns stale data — staleness is always detectable. This is the API-level expression of the State Store's principle "staleness is visible, not hidden" (State Store §1) and INV-TO-03 (no hidden state).

**Commands are typed invocations, not state mutations.** The API models commands as `POST /api/v1/entities/{id}/commands` with a typed capability-command payload, not as `PUT /api/v1/entities/{id}/state`. This reflects the actual command lifecycle: a command is an intent that passes through acceptance, dispatch, protocol acknowledgment, and state confirmation. The API exposes this full lifecycle through a trackable `command_id`. Every major smart home platform has converged on typed command invocation; HomeSynapse follows this pattern and extends it with full lifecycle visibility.

**Immutable data is aggressively cacheable.** Event history responses carry `Cache-Control: max-age=31536000, immutable` because persisted events never change (INV-ES-01). Projection-derived responses carry `Cache-Control: no-cache` with ETag validation, requiring clients to revalidate on every request but avoiding re-transfer when the version has not advanced. No existing smart home platform uses HTTP caching headers for device state APIs — HomeSynapse is the first.

**Errors are structured, typed, and actionable.** Every error response follows RFC 9457 (Problem Details for HTTP APIs). Error responses include a machine-readable `type` URI, a human-readable `title`, the HTTP `status` code, a `detail` string describing the specific failure, and an optional `instance` URI identifying the request. This replaces the generic JSON error objects that most smart home APIs return with a standardized, typed error model that clients can handle programmatically.

**Zero-dependency API access.** Any HTTP client — curl, a browser, a Python script, a mobile app — can consume the API without a proprietary SDK, a special authentication handshake, or a platform-specific library. The API uses standard HTTP methods, standard headers, standard status codes, and JSON payloads. This is the API-level expression of INV-CE-02 (zero-configuration first run): the API works with any tool the user already has.

---

## 2. Scope and Boundaries

### 2.1 This Subsystem Owns

- The HTTP server lifecycle: binding, listening, TLS termination (Tier 2), and graceful shutdown.
- The URL namespace under `/api/v1/` and its endpoint taxonomy.
- Request routing, parameter validation, and content negotiation.
- Response serialization: mapping internal types to JSON API shapes via Jackson (LTD-08).
- HTTP caching semantics: ETag generation from projection versions and event sequence numbers, `Cache-Control` header policies, conditional request handling (`If-None-Match`, `If-Match`).
- Cursor-based pagination: cursor encoding/decoding, page size defaults and limits.
- The error response model: mapping internal exceptions and validation failures to RFC 9457 Problem Details.
- Authentication middleware: validating API keys on every request (INV-SE-02).
- Rate limiting: per-client request throttling to protect constrained hardware.
- CORS policy for browser-based clients.
- The composite query logic that joins State Store data with Entity Registry structural data for filtered endpoint responses (e.g., "all entities in area X that are on").
- The command acceptance endpoint that validates command requests against capability schemas before publishing `command_issued` events.
- The command status endpoint that assembles four-phase lifecycle status from Event Store queries.
- OpenAPI 3.1 specification as the source of truth for the API contract (LTD-16).

### 2.2 This Subsystem Does Not Own

- Real-time event streaming — owned by the **WebSocket API** (Doc 10). The REST API serves request-response queries; it does not maintain persistent connections for push notifications.
- Event persistence, append-only guarantees, or event delivery — owned by the **Event Model & Event Bus** (Doc 01) and the **Persistence Layer** (Doc 04). The REST API reads from the EventStore interface.
- Current state computation and projection maintenance — owned by the **State Store & State Projection** (Doc 03). The REST API queries the StateQueryService; it does not process events.
- Device and entity registry management — owned by the **Device Model & Capability System** (Doc 02). The REST API reads from registry interfaces; device adoption, entity lifecycle, and capability registration are not API operations in Tier 1.
- Automation definition parsing and validation — owned by the **Automation Engine** (Doc 07) and **Configuration System** (Doc 06). Tier 1 automations are defined in `automations.yaml`, not through the API. The REST API provides read access to loaded automation definitions and run traces.
- Command dispatch and protocol-level delivery — owned by the **Automation Engine** (Doc 07) Command Dispatch Service and **Integration Runtime** (Doc 05). The REST API publishes `command_issued` events; downstream dispatch is not its concern.
- Webhook subscription management and outbound event delivery — designed for (§14) but not implemented in Tier 1. The WebSocket API (Doc 10) is the Tier 1 real-time channel.

---

## 3. Architecture

### 3.1 Subsystem Position

The REST API sits at the outer edge of the system, accepting HTTP requests from external clients and translating them into queries against internal interfaces. It has no write relationship with any data store — command issuance flows through the EventPublisher, which persists the `command_issued` event to the event log. The REST API never writes directly to SQLite.

```
                    ┌───────────────────────────────────────┐
                    │           HTTP Clients                 │
                    │  Web UI · Companion App · curl · NexSys│
                    └──────────────────┬────────────────────┘
                                       │ HTTP/1.1
                                       ▼
┌──────────────────────────────────────────────────────────────┐
│                     REST API Subsystem                        │
│                                                               │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────────┐   │
│  │ Auth       │─▶│ Rate       │─▶│ Request Router       │   │
│  │ Middleware │  │ Limiter    │  │ /api/v1/{resource}   │   │
│  └────────────┘  └────────────┘  └──────────┬───────────┘   │
│                                              │               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │               Endpoint Handlers                        │   │
│  │                                                        │   │
│  │  Entity      Command     Event      Automation  System │   │
│  │  Handlers    Handlers    Handlers   Handlers    Handlers│   │
│  └──────────────────────────┬─────────────────────────────┘   │
│                             │                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  ETag Provider · Pagination · Error Mapper · Serializer  │ │
│  └──────────────────────────┬───────────────────────────────┘ │
└─────────────────────────────┼────────────────────────────────┘
                              │ Internal Java Interfaces
            ┌─────────────────┼─────────────────────┐
            ▼                 ▼                      ▼
┌─────────────────┐ ┌──────────────────┐ ┌────────────────────┐
│ StateQueryService│ │ DeviceRegistry   │ │ EventStore         │
│ (Doc 03 §8.1)   │ │ EntityRegistry   │ │ EventPublisher     │
│                  │ │ CapabilityRegistry│ │ AutomationRegistry │
│                  │ │ (Doc 02 §8.1)   │ │ PendingCommandLedger│
│                  │ │                  │ │ (Docs 01, 07)      │
└─────────────────┘ └──────────────────┘ └────────────────────┘
```

### 3.2 Endpoint Taxonomy

Endpoints are organized into five operational planes with distinct consistency contracts. This separation is informed by competitive analysis: Google Home, Home Assistant, and Alexa each implicitly separate their APIs along similar lines, though none documents the distinction explicitly.

**Plane 1 — State Query.** Current device and entity state. Eventually consistent (projection-derived). Responses carry `ETag` from `viewPosition` and `Cache-Control: no-cache`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/entities` | List entities with filtering and pagination |
| GET | `/api/v1/entities/{entity_id}` | Single entity with current state |
| GET | `/api/v1/entities/{entity_id}/state` | Current attribute state only |
| GET | `/api/v1/devices` | List devices with pagination |
| GET | `/api/v1/devices/{device_id}` | Single device with its entities |
| GET | `/api/v1/state` | Bulk state snapshot (all entities) |

**Plane 2 — Command.** Command issuance and lifecycle tracking. Accepted ≠ confirmed. Responses carry `command_id` for lifecycle tracking. `Cache-Control: no-store`.

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/entities/{entity_id}/commands` | Issue a typed command |
| GET | `/api/v1/commands/{command_id}` | Four-phase command lifecycle status |

**Plane 3 — Event History.** Immutable event log queries. Strongly consistent (event store). Historical event pages carry `Cache-Control: max-age=31536000, immutable`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/events` | Query events with filtering and cursor pagination |
| GET | `/api/v1/events/{event_id}` | Single event by ID |
| GET | `/api/v1/events/trace/{correlation_id}` | Causal chain trace |

**Plane 4 — Automation.** Automation definitions and execution history. Automation definition CRUD is deferred to Tier 2 — Tier 1 definitions are managed in `automations.yaml` via the Configuration System (Doc 06). Enable/disable endpoints and read access are Tier 1 scope. Configuration-consistent responses carry `ETag` from automation definition hash.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/automations` | List automation definitions |
| GET | `/api/v1/automations/{automation_id}` | Single automation definition |
| POST | `/api/v1/automations/{automation_id}/enable` | Enable an automation |
| POST | `/api/v1/automations/{automation_id}/disable` | Disable an automation |
| GET | `/api/v1/automations/{automation_id}/runs` | Run history for an automation |
| GET | `/api/v1/automations/{automation_id}/runs/{run_id}` | Single run trace |

**Plane 5 — System Administration.** System health, integration status, configuration reads. Mixed consistency depending on source.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/system/health` | Aggregated system health |
| GET | `/api/v1/system/integrations` | Integration status list |
| GET | `/api/v1/system/integrations/{integration_id}` | Single integration health detail |
| GET | `/api/v1/system/info` | System version, uptime, device counts |
| GET | `/api/v1/capabilities` | List all registered capabilities |
| GET | `/api/v1/capabilities/{capability_id}` | Single capability schema |
| GET | `/api/v1/areas` | List areas (structural query from entity registry) |

### 3.3 Request Lifecycle

Every request passes through a fixed pipeline:

1. **TLS termination** (Tier 2; Tier 1 serves HTTP on LAN per §12).
2. **Authentication.** The auth middleware extracts the API key from the `Authorization: Bearer {key}` header and validates it against the local key store. Unauthenticated requests receive `401 Unauthorized` with a `WWW-Authenticate: Bearer` challenge. Invalid keys receive `403 Forbidden`. This satisfies INV-SE-02 (authentication required for all external interfaces).
3. **Rate limiting.** Per-key token bucket. Requests exceeding the limit receive `429 Too Many Requests` with a `Retry-After` header.
4. **Routing.** The request URL and method are matched against the endpoint registry. Unmatched routes receive `404 Not Found`. Unsupported methods on matched routes receive `405 Method Not Allowed` with an `Allow` header listing supported methods.
5. **Parameter validation.** Path parameters, query parameters, and request bodies are validated against their schemas. Validation failures return `400 Bad Request` with a Problem Details body identifying the invalid fields.
6. **Handler execution.** The matched endpoint handler queries internal interfaces and assembles the response. Handlers run on virtual threads — each request gets its own virtual thread, providing natural concurrency without thread pool sizing (LTD-01).
7. **ETag evaluation.** For GET requests, the handler computes the response ETag. If the request carries `If-None-Match` and the ETag matches, the handler short-circuits to `304 Not Modified` without serializing the response body.
8. **Response serialization.** The handler result is serialized to JSON via the shared Jackson ObjectMapper (LTD-08, `SNAKE_CASE` naming strategy). Response headers include `Content-Type: application/json`, the appropriate `Cache-Control` directive, and the `ETag` if applicable.
9. **Structured logging.** The request is logged with correlation metadata: `method`, `path`, `status`, `duration_ms`, `api_key_id` (never the key value), and `correlation_id` if propagated from the client via the `X-Correlation-ID` request header.

### 3.4 Command Issuance and Four-Phase Lifecycle

The `POST /api/v1/entities/{entity_id}/commands` endpoint is the primary write path through the REST API. It accepts a typed command request, validates it, and publishes a `command_issued` event to the event log.

**Request validation sequence:**

1. Resolve `entity_id` to an entity record via `EntityRegistry`. Return `404` if not found.
2. Verify the entity is enabled. Return `409 Conflict` (Problem type: `entity-disabled`) if disabled.
3. Verify the entity's integration is healthy. Return `503 Service Unavailable` (Problem type: `integration-unhealthy`) if the owning integration is unhealthy.
4. Validate the `capability` and `command` fields against the entity's declared capabilities via `CommandValidator` (Doc 02 §8.1). Return `422 Unprocessable Content` (Problem type: `invalid-command`) if validation fails, with `detail` describing the specific schema violation.
5. Resolve expected outcomes via `ExpectationFactory` (Doc 02 §8.1) to populate the `expected_outcome` field on the event payload.
6. Publish a `command_issued` event via `EventPublisher.publishRoot()` with origin `USER_COMMAND` and `actor_ref` set to the authenticated API key's identity. The `correlation_id` is set to the event's own `event_id` by `publishRoot()` per Doc 01 §8.3. If the client provided an `X-Correlation-ID` header, it is logged alongside the event's `correlation_id` for request-level tracing (§3.11) but is not injected into the event envelope.
7. Return `202 Accepted` with the `command_id` (the event's `event_id`), the `correlation_id`, and the `view_position` at which the command was persisted.

The `202 Accepted` response means the command has been validated and persisted to the event log. It does not mean the command has reached the device. Clients track the full lifecycle via `GET /api/v1/commands/{command_id}`.

**Idempotency keys (AMD-08).** The command endpoint accepts an optional `Idempotency-Key` request header (string, max 128 characters, client-generated). When present, the API ensures at-most-once command issuance for the given key:

1. Before validation, the API checks the in-memory idempotency cache for the key.
2. If the key exists and the cached entry's response is available, the API returns the cached `202 Accepted` response (same `command_id`, `correlation_id`, `view_position`) without publishing a new event. This is a replay, not a new command.
3. If the key does not exist, the API proceeds with normal validation and event publication, then caches the key→response mapping.

The idempotency cache is an in-memory LRU map with a maximum size of 10,000 entries and a per-entry TTL of 24 hours. Entries are evicted on LRU overflow or TTL expiration. The cache is not persisted — it is lost on process restart. This is acceptable because the 24-hour TTL window covers the vast majority of retry scenarios (network timeout, client crash-and-restart), and post-restart retries with a stale key simply issue a new command (the device handles duplicate commands gracefully via the four-phase lifecycle).

```java
public record IdempotencyEntry(
    String idempotencyKey,
    String commandId,
    String correlationId,
    long viewPosition,
    Instant createdAt
) {}
```

When an idempotency key is provided, the `command_issued` event payload includes the `idempotency_key` field. This allows event consumers and the trace query service to identify commands that were issued with idempotency guarantees and to detect replayed responses in the event log (a replayed response does not produce a new event — only the original command's event exists).

**Idempotency key conflicts.** If the same `Idempotency-Key` is used with a different request body (different entity, command, or parameters), the API returns `409 Conflict` with Problem type `idempotency-key-conflict`. This prevents accidental key reuse from silently returning a stale response for a different command.

**Four-phase command status:**

The `GET /api/v1/commands/{command_id}` endpoint assembles the current lifecycle status by querying events with the command's `correlation_id`:

| Phase | Event Type | What It Means |
|---|---|---|
| `accepted` | `command_issued` exists | Command validated and persisted |
| `dispatched` | `command_dispatched` exists | Integration adapter accepted for protocol delivery |
| `acknowledged` | `command_result` exists | Protocol-level outcome received |
| `confirmed` | `state_confirmed` exists | Device state matches expected outcome |

If `command_confirmation_timed_out` exists instead of `state_confirmed`, the status reports `confirmation_timed_out` as the terminal phase. If `command_result` has status `rejected` or `timed_out`, the lifecycle terminates at the `acknowledged` phase with a failure reason.

The response body includes the current phase, timestamps for each completed phase, the full causal chain of event IDs, and — if the command has reached the `acknowledged` or later phase — the protocol-level result details. This four-phase visibility is a capability no existing smart home platform API exposes.

### 3.5 Pagination Model

All list endpoints use cursor-based pagination. Offset-based pagination is unsuitable for an append-only event log because inserts between requests shift page boundaries.

**Cursor structure.** The cursor is an opaque, URL-safe Base64-encoded string containing the sort key value of the last item on the previous page. For event list endpoints, the sort key is `global_position`. For entity and device list endpoints, the sort key is `entity_id` or `device_id` (ULIDs, which are lexicographically sortable).

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `cursor` | String (opaque) | — | Position cursor from a previous response's `next_cursor` |
| `limit` | Integer | 50 | Page size. Minimum 1, maximum 200. |

**Response envelope:**

```json
{
  "data": [ ... ],
  "pagination": {
    "next_cursor": "eyJncCI6MTAwMH0",
    "has_more": true,
    "limit": 50
  },
  "meta": {
    "view_position": 42850,
    "timestamp": "2026-03-07T14:30:00.000Z"
  }
}
```

The `meta.view_position` field is included on all responses derived from projection data (State Query plane). It is absent from Event History plane responses, which are served directly from the event store and are already strongly consistent.

For the event list endpoint, an additional `position_range` object reports the `global_position` of the first and last events in the page, enabling clients to construct resume tokens for WebSocket subscription handoff.

### 3.6 Filtering and Sorting

**Entity list filtering.** Query parameters on `GET /api/v1/entities`:

| Parameter | Type | Description |
|---|---|---|
| `area_id` | ULID | Filter by area |
| `device_id` | ULID | Filter by parent device |
| `entity_type` | String | Filter by entity type (e.g., `light`, `sensor`, `switch`) |
| `capability` | String | Filter by entities that have a specific capability |
| `label` | String | Filter by label (exact match; repeatable for AND semantics) |
| `availability` | Enum | `online`, `offline`, `unknown` |
| `enabled` | Boolean | Filter by enabled/disabled status |

Filtering logic joins the EntityRegistry (for structural predicates like area, type, label, capability) with the StateQueryService (for availability). This composite query is assembled in the API handler, not pushed down to either subsystem — consistent with State Store §8.1's design that the API Layer performs this join.

**Event list filtering.** Query parameters on `GET /api/v1/events`:

| Parameter | Type | Description |
|---|---|---|
| `subject_ref` | ULID | Events for a specific subject |
| `event_type` | String | Filter by event type (repeatable for OR semantics) |
| `priority` | Enum | `CRITICAL`, `NORMAL`, `DIAGNOSTIC` |
| `after_position` | Integer | Events after this global_position (exclusive) |
| `before_position` | Integer | Events before this global_position (exclusive) |
| `after_time` | ISO 8601 | Events with `event_time` after this timestamp |
| `before_time` | ISO 8601 | Events with `event_time` before this timestamp |
| `correlation_id` | ULID | Events in a specific causal chain |

**Sorting.** Entity and device lists default to `entity_id` ascending (ULID order, which is time-ordered). Event lists default to `global_position` descending (newest first). A `sort` query parameter accepts `asc` or `desc` to override the default direction. No arbitrary sort keys — the sort dimension is fixed per endpoint to enable efficient cursor pagination.

**Degraded event handling.** When the EventStore returns a `DegradedEvent` instance (Doc 01 §8.2) — an event whose payload could not be upcasted to the current schema version in lenient mode — the API serializes it with the raw JSON payload preserved and a `degraded` flag set to `true`. The response includes the `degraded_reason` field describing the upcasting failure. This maintains the "never hide data" principle (INV-ES-06): degraded events are evidence in the log and must be visible through the API. Clients that cannot handle degraded events should filter on `degraded: false` in their presentation logic.

### 3.7 ETag and Caching Strategy

The caching strategy leverages event sourcing's natural distinction between immutable history and mutable projections. This follows the pattern established by EventStoreDB's HTTP API, adapted for smart home semantics.

**State Query plane.** Responses carry:
- `ETag: W/"{viewPosition}"` — weak ETag from the State Store's current view position.
- `Cache-Control: no-cache` — clients must revalidate on every request.
- `X-View-Position: {viewPosition}` — explicit header for clients that need the position as a number (e.g., for read-after-write comparison).

A `GET` request with `If-None-Match: W/"42850"` returns `304 Not Modified` if the State Store's view position has not advanced past 42850. This avoids re-serializing and re-transferring unchanged state.

**Event History plane — individual events.** Single-event responses carry:
- `ETag: "{event_id}"` — strong ETag; the event is immutable.
- `Cache-Control: max-age=31536000, immutable` — cache forever.

**Event History plane — paginated lists.** Page responses carry:
- `Cache-Control: no-cache` — the page boundaries may shift as new events are appended.
- No ETag — paginated event lists are not versioned.

**Automation plane.** Responses carry:
- `ETag: W/"{definition_hash}"` — weak ETag from the automation definition's content hash, which changes on hot-reload.
- `Cache-Control: private, max-age=60` — short-lived cache with revalidation.

**System plane.** Health and integration status responses carry:
- `Cache-Control: no-cache, no-store` — always fresh.

**Optimistic concurrency for future write endpoints.** The `If-Match` header with an ETag enables optimistic concurrency for write operations. In Tier 1, the only write endpoint is command issuance, which does not use optimistic concurrency (commands are always appended, never conditional on current state). Tier 2 automation CRUD endpoints will use `If-Match` with the automation definition hash to prevent lost-update conflicts.

### 3.8 Error Response Model

All error responses follow RFC 9457 (Problem Details for HTTP APIs), serialized as `application/problem+json`.

**Standard error shape:**

```json
{
  "type": "https://homesynapse.local/problems/invalid-command",
  "title": "Command validation failed",
  "status": 422,
  "detail": "Entity 01HV... does not support command 'set_color' — capability 'on_off' does not define this command.",
  "instance": "/api/v1/entities/01HV.../commands",
  "correlation_id": "01HV..."
}
```

**Problem type registry.** Each error condition maps to a stable `type` URI under `https://homesynapse.local/problems/`. The URI is documentation — not a network resource — and serves as a machine-readable error identifier that clients can switch on.

| Problem Type | Status | Condition |
|---|---|---|
| `not-found` | 404 | Resource does not exist |
| `entity-disabled` | 409 | Command issued to a disabled entity |
| `integration-unhealthy` | 503 | Owning integration is not healthy |
| `invalid-command` | 422 | Command fails capability validation |
| `invalid-parameters` | 400 | Request parameters fail schema validation |
| `authentication-required` | 401 | No API key provided |
| `forbidden` | 403 | API key is invalid or lacks permission |
| `rate-limited` | 429 | Request rate exceeded |
| `command-not-found` | 404 | Command ID does not correspond to a `command_issued` event |
| `state-store-replaying` | 503 | State Store is rebuilding; stale data available with `Retry-After` |
| `internal-error` | 500 | Unhandled exception (logged with correlation_id for diagnosis) |
| `idempotency-key-conflict` | 409 | Idempotency-Key reused with different request body (AMD-08) |
| `device-orphaned` | 503 | Command issued to an entity whose device is orphaned (AMD-17) |

For validation errors (status 400 and 422), the response includes an `errors` extension array with per-field details:

```json
{
  "type": "https://homesynapse.local/problems/invalid-parameters",
  "title": "Request validation failed",
  "status": 400,
  "detail": "2 validation errors in request body.",
  "correlation_id": "01HV...",
  "errors": [
    { "field": "capability", "message": "Required field is missing." },
    { "field": "parameters.level", "message": "Value 150 exceeds maximum 100." }
  ]
}
```

**Correlation ID in all responses (AMD-15).** Every API response — both success and error — includes a `correlation_id` for request-level tracing:

- **Success responses:** The `X-Correlation-ID` response header carries the request's correlation ID (§3.11). For command issuance, the response body also includes the event-assigned `correlation_id`.
- **Error responses:** The `correlation_id` field is included in the RFC 9457 Problem Details body as an extension member. This is the same value as the `X-Correlation-ID` response header. Including it in the body ensures that clients parsing the error response have the correlation ID without needing to inspect headers.
- **Origin of the ID:** If the client provided an `X-Correlation-ID` request header, that value is used as the response correlation ID. If the client did not provide one, the API generates a request-scoped ULID (per LTD-04) and uses it for both the response header and the error body field.
- **Logging linkage:** The correlation ID links the API response to structured log entries (§3.3 step 9), enabling operators to trace a specific error from the client's error display to the server logs without timestamp-based searching.

### 3.9 HTTP Server Selection Criteria

The REST API requires an embedded HTTP server that meets the following constraints:

1. **Virtual-thread compatible.** The server must dispatch request handlers on virtual threads or accept a virtual-thread executor. Blocking in a handler must not consume a platform thread (LTD-01).
2. **Minimal footprint.** The server library, including transitive dependencies, must not exceed 5 MB of JAR weight. The total dependency budget (LTD cross-cutting risks §12) leaves room for this but not for a full application server.
3. **No framework control inversion.** The server provides routing and request/response plumbing. Handler registration, lifecycle, and error mapping are owned by HomeSynapse code (MVP §10: "use libraries, not frameworks; own the control flow").
4. **HTTP/1.1 sufficient.** HTTP/2 is a Tier 2 consideration. The server must support HTTP/1.1 with keep-alive.

**Evaluated options:**

| Option | JAR Size | Virtual Thread Support | Trade-off |
|---|---|---|---|
| `com.sun.net.httpserver` (JDK built-in) | 0 MB | Yes (custom executor) | Zero dependency; minimal routing; would require ~300–500 lines of routing framework code |
| Javalin 6.x (Jetty-based) | ~3–4 MB | Native (since 6.0) | Thin routing layer over Jetty; no reflection magic; handler-first API; closest to "library, not framework" |
| Eclipse Jetty 12 (standalone) | ~3 MB | Native | Lower-level than Javalin; more configuration surface; no routing DSL |

The choice between these options is a Phase 2 implementation decision. The design is compatible with any of them — the `RestApiServer` interface (§8.1) abstracts the HTTP server lifecycle, and endpoint handlers are plain Java methods that receive parsed request data and return response objects. The routing layer maps URL patterns to handler methods. No handler depends on server-specific types.

For planning purposes, Javalin represents the expected implementation path: it provides routing, parameter parsing, and virtual-thread dispatch with minimal dependency weight, and its API is compatible with the handler model defined in §8.1.

### 3.10 Request and Response Content Type

Tier 1 serves and accepts `application/json` exclusively. Requests with an unsupported `Content-Type` or `Accept` header receive `415 Unsupported Media Type` or `406 Not Acceptable`, respectively.

All JSON serialization uses the shared Jackson ObjectMapper (LTD-08) with `SNAKE_CASE` property naming. Field names in API responses match the Glossary's API token column (e.g., `entity_id`, `subject_ref`, `global_position`). Java `camelCase` field names are mapped automatically by Jackson's naming strategy — no per-field `@JsonProperty` annotations needed for standard mappings.

Timestamps are serialized as ISO 8601 strings with millisecond precision (via `JavaTimeModule`). ULIDs are serialized as 26-character Crockford Base32 strings at the API boundary (LTD-04). Enum values are serialized as lowercase `SNAKE_CASE` strings (e.g., `"critical"`, `"user_command"`).

### 3.11 Correlation ID Propagation

The REST API supports client-provided request tracing via the `X-Correlation-ID` header. This header provides end-to-end tracing from the client's perspective — a mobile app can tag a request with its own identifier and use it to find related log entries and events.

**Request-level tracing vs. event causal chains.** These are distinct mechanisms. The event envelope's `correlation_id` field is always set by `EventPublisher.publishRoot()` to the event's own `event_id` for root events (Doc 01 §8.3). This invariant is essential for causal chain reconstruction — the event correlation chain must form a self-consistent graph rooted at the originating event. Client-provided correlation IDs are not injected into the event envelope.

**How tracing works end-to-end:** When a client issues a command with `X-Correlation-ID: {client_id}`, the REST API: (1) logs the request with `client_correlation_id = {client_id}` in structured log entries (§3.3 step 9), (2) publishes the `command_issued` event via `publishRoot()` which assigns `correlation_id = event_id`, and (3) returns both the `client_correlation_id` and the event's `correlation_id` in the response. The client can trace the command lifecycle by querying `GET /api/v1/commands/{command_id}` or `GET /api/v1/events/trace/{correlation_id}` using the event's correlation ID from the response.

The response includes the event-assigned `correlation_id` in the `X-Correlation-ID` response header. If the client provided a `X-Correlation-ID` on the request, it is returned in a separate `X-Client-Correlation-ID` response header for the client's own bookkeeping.

---

## 4. Data Model

This section defines the JSON response shapes that the REST API introduces. These are serialization formats — not domain types. The underlying domain types are defined in their owning subsystem documents and referenced here.

### 4.1 Entity Response

```json
{
  "entity_id": "01HV...",
  "entity_slug": "living-room-lamp",
  "entity_type": "light",
  "display_name": "Living Room Lamp",
  "device_id": "01HV...",
  "area_id": "01HV...",
  "enabled": true,
  "availability": "online",
  "labels": ["downstairs", "evening-lights"],
  "capabilities": [
    {
      "capability_id": "on_off",
      "version": 1,
      "feature_map": {}
    },
    {
      "capability_id": "level_control",
      "version": 1,
      "feature_map": { "supports_transition": true }
    }
  ],
  "state": {
    "on_off": { "value": true, "last_updated": "2026-03-07T14:25:00.000Z" },
    "level": { "value": 75, "unit": "%", "last_updated": "2026-03-07T14:25:00.000Z" }
  },
  "last_reported": "2026-03-07T14:29:55.000Z"
}
```

The `state` object is present only when the entity has received at least one state report. Entities that have been adopted but never reported state have `"state": null`. The `capabilities` array is derived from the EntityRegistry; the `state` object is derived from the StateQueryService. The handler joins these two sources.

### 4.2 Device Response

```json
{
  "device_id": "01HV...",
  "device_slug": "ikea-tradfri-bulb-e27",
  "display_name": "IKEA TRÅDFRI Bulb E27",
  "manufacturer": "IKEA",
  "model": "LED2003G10",
  "firmware_version": "2.4.30",
  "integration_id": "zigbee",
  "area_id": "01HV...",
  "labels": ["zigbee"],
  "entities": [
    { "entity_id": "01HV...", "entity_type": "light", "entity_slug": "living-room-lamp" }
  ]
}
```

The `entities` array contains summary records, not full entity responses. Clients that need entity details follow the `entity_id` link.

### 4.3 Command Request

```json
{
  "capability": "level_control",
  "command": "set_level",
  "parameters": {
    "level": 75,
    "transition_ms": 500
  }
}
```

All three fields are required. The `capability` and `command` fields are validated against the entity's declared capabilities via `CommandValidator`. The `parameters` object is validated against the command's parameter schema from the `CommandDefinition`.

### 4.4 Command Accepted Response

```json
{
  "command_id": "01HV...",
  "correlation_id": "01HV...",
  "entity_id": "01HV...",
  "status": "accepted",
  "accepted_at": "2026-03-07T14:30:00.123Z",
  "view_position": 42851
}
```

### 4.5 Command Status Response

```json
{
  "command_id": "01HV...",
  "correlation_id": "01HV...",
  "entity_id": "01HV...",
  "capability": "level_control",
  "command": "set_level",
  "lifecycle": {
    "accepted": { "at": "2026-03-07T14:30:00.123Z", "event_id": "01HV..." },
    "dispatched": { "at": "2026-03-07T14:30:00.135Z", "event_id": "01HV...", "integration_id": "zigbee" },
    "acknowledged": { "at": "2026-03-07T14:30:00.210Z", "event_id": "01HV...", "result": "acknowledged" },
    "confirmed": { "at": "2026-03-07T14:30:00.890Z", "event_id": "01HV...", "match_type": "within_tolerance" }
  },
  "current_phase": "confirmed",
  "terminal": true
}
```

Phases that have not yet occurred are absent from the `lifecycle` object. The `current_phase` field reflects the latest completed phase. The `terminal` field is `true` when the lifecycle is complete (either `confirmed`, `confirmation_timed_out`, or a rejected/timed-out `acknowledged` phase).

### 4.6 Event Response

```json
{
  "event_id": "01HV...",
  "event_type": "state_changed",
  "schema_version": 1,
  "ingest_time": "2026-03-07T14:30:00.123Z",
  "event_time": "2026-03-07T14:29:59.900Z",
  "subject_ref": "01HV...",
  "subject_sequence": 47,
  "global_position": 42850,
  "priority": "normal",
  "origin": "physical",
  "correlation_id": "01HV...",
  "causation_id": "01HV...",
  "payload": {
    "attribute_key": "level",
    "old_value": 50,
    "new_value": 75,
    "triggered_by": "01HV..."
  }
}
```

The payload is passed through as-is from the event store — the REST API does not interpret or transform payload content. Unknown fields in the payload are preserved (per LTD-08 `FAIL_ON_UNKNOWN_PROPERTIES=false`).

### 4.7 Automation Definition Response

```json
{
  "automation_id": "01HV...",
  "name": "Evening Lights",
  "description": "Turn on living room lights at sunset",
  "enabled": true,
  "mode": "single",
  "priority": 100,
  "triggers": [ ... ],
  "conditions": [ ... ],
  "actions": [ ... ],
  "definition_hash": "a1b2c3d4"
}
```

Trigger, condition, and action arrays are serialized from the `AutomationDefinition` record (Doc 07 §8.2). The `definition_hash` is the content hash used for ETag computation and hot-reload detection.

### 4.8 Run Trace Response

```json
{
  "run_id": "01HV...",
  "automation_id": "01HV...",
  "automation_name": "Evening Lights",
  "status": "completed",
  "started_at": "2026-03-07T18:30:00.000Z",
  "completed_at": "2026-03-07T18:30:00.250Z",
  "duration_ms": 250,
  "triggering_event_id": "01HV...",
  "events": [
    { "event_id": "01HV...", "event_type": "automation_triggered", "at": "..." },
    { "event_id": "01HV...", "event_type": "automation_condition_evaluated", "at": "..." },
    { "event_id": "01HV...", "event_type": "automation_action_started", "at": "..." },
    { "event_id": "01HV...", "event_type": "command_issued", "at": "..." },
    { "event_id": "01HV...", "event_type": "automation_action_completed", "at": "..." },
    { "event_id": "01HV...", "event_type": "automation_completed", "at": "..." }
  ]
}
```

The `events` array is assembled by querying the EventStore by `correlation_id` — the same causal chain projection mechanism described in Automation Engine §4.2. The REST API does not materialize this as a separate data structure; it is assembled on-demand per request.

### 4.9 System Health Response

```json
{
  "status": "healthy",
  "uptime_seconds": 86400,
  "version": "1.0.0",
  "subsystems": {
    "event_bus": { "status": "healthy" },
    "state_store": { "status": "healthy", "view_position": 42850, "replaying": false },
    "automation_engine": { "status": "healthy", "active_runs": 0 },
    "persistence": { "status": "healthy", "database_size_mb": 245 }
  },
  "integrations": {
    "zigbee": { "status": "healthy", "device_count": 23, "restart_count": 0 }
  },
  "device_count": 23,
  "entity_count": 47
}
```

The aggregate `status` follows a simple reduction: if any subsystem is `unhealthy`, the aggregate is `unhealthy`. If any subsystem is `degraded` and none is `unhealthy`, the aggregate is `degraded`. Otherwise, `healthy`.

---

## 5. Contracts and Invariants

**Every response is derived from queryable internal interfaces; the API holds zero persistent state.** If the API process is killed and restarted, the next request returns data consistent with the current state of the underlying subsystems. No API-layer caching, session state, or accumulated data exists. This follows from the principle that the REST API is a translation layer.

**State query responses always carry `viewPosition`.** Consumers can detect staleness by comparing the returned `viewPosition` against a known position (e.g., the position returned from a prior command acceptance). The API never returns state data without this position indicator. This satisfies INV-TO-03 (no hidden state) at the API boundary.

**Command acceptance does not imply command execution.** A `202 Accepted` response means the `command_issued` event is durably persisted (INV-ES-04). It carries no guarantee that the device has received, acknowledged, or executed the command. Clients that need execution confirmation must poll the command status endpoint or subscribe via WebSocket. This matches the actual semantics of the system and avoids the false-promise patterns observed in SmartThings (where `204 No Content` hides all downstream failures) and Google Home (where `SUCCESS` in EXECUTE responses is claimed, not confirmed).

**Event history responses are immutable after retrieval.** An event returned by `GET /api/v1/events/{event_id}` will produce byte-identical JSON on every subsequent request for the lifetime of that event in the store (subject to retention policy removal). This follows from INV-ES-01 (events are immutable facts) and justifies the `Cache-Control: immutable` directive.

**The OpenAPI 3.1 specification is the API contract.** The specification is generated from endpoint handler metadata and validated in CI. Any divergence between the specification and the implementation is a bug. Breaking changes as defined in LTD-16 are detected by `oasdiff` and block merge. This satisfies INV-CS-01 (semantic versioning enforced) at the API surface.

**Authentication is mandatory on every request.** No endpoint is accessible without a valid API key. There is no "local trust" exception for LAN clients. An unauthenticated request to any endpoint returns `401`. This satisfies INV-SE-02.

---

## 6. Failure Modes and Recovery

### 6.1 State Store Replaying

**Trigger:** The State Store is rebuilding from the event log after startup or checkpoint corruption.

**Impact:** State query endpoints return stale data (from the loaded checkpoint) or empty data (if no checkpoint exists). The `meta.view_position` in responses reflects the checkpoint position, which may lag significantly behind the current event log head.

**Recovery:** The API detects the replaying state via `StateQueryService.isReady()`. During replay, state query responses include a `Warning: 199 - "State projection is rebuilding; data may be stale"` header and the `replaying: true` flag in the response metadata. The `GET /api/v1/system/health` endpoint reports the State Store as `degraded` with `replaying: true`. Clients can retry with exponential backoff. No manual intervention required — replay completes automatically.

**Events produced:** None by the API. The State Store produces `system_registry_rebuilt` upon completion.

### 6.2 Event Store Read Failure

**Trigger:** SQLite read error during an event history query (disk I/O error, database corruption).

**Impact:** Event history endpoints return `500 Internal Server Error` with Problem type `internal-error`. The `correlation_id` in the error response links to structured log entries for diagnosis.

**Recovery:** The API retries the SQLite read once. If the retry fails, the error is returned to the client. The Persistence Layer's integrity checks (Doc 04) handle database-level recovery. If the database is corrupt, the persistence subsystem's crash recovery restores from the most recent backup.

**Events produced:** The API logs the failure as a structured `api.event_store_read_error` entry with `entity_id`, `query_parameters`, and the SQLite error code.

### 6.3 Authentication Subsystem Failure

**Trigger:** The API key store is unavailable or corrupted.

**Impact:** All requests receive `500 Internal Server Error`. The system is effectively inaccessible via the API.

**Recovery:** The API logs the failure. Because all API endpoints require authentication (INV-SE-02), the health endpoint is also unavailable when the auth store is corrupted. External system monitoring is provided by the systemd watchdog via `sd_notify` (LTD-13), which does not traverse the HTTP stack and remains functional regardless of auth store state. Manual recovery requires restarting the service or restoring the key store from backup.

**Events produced:** `system_error` event with `subsystem: "api"`, `reason: "auth_store_unavailable"`.

### 6.4 Downstream Subsystem Unavailable

**Trigger:** A dependency interface (StateQueryService, EntityRegistry, EventStore) throws an exception or times out.

**Impact:** The affected endpoint returns `503 Service Unavailable` with a `Retry-After: 5` header. Endpoints that do not depend on the failed subsystem continue functioning. For example, if the State Store is unavailable, event history queries still work.

**Recovery:** The API does not attempt complex retry logic. It returns the error immediately with sufficient diagnostic context for the client and the log. The subsystem's own recovery mechanisms (checkpoint rebuild, database reconnection) handle restoration.

**Events produced:** Structured log entries with the failing interface, the exception type, and the request context.

### 6.5 Rate Limit Exhaustion

**Trigger:** A client exceeds its configured request rate.

**Impact:** Subsequent requests return `429 Too Many Requests` with a `Retry-After` header indicating when the rate limit resets. The response body is a Problem Details object with type `rate-limited`.

**Recovery:** Automatic. The token bucket refills over time. No state corruption or lasting impact.

**Events produced:** Structured log entry on first rate-limited request per client per minute (not per request, to avoid log flooding).

### 6.6 Malformed or Oversized Request

**Trigger:** A request body exceeds the maximum size (configurable, default 64 KB) or contains unparseable JSON.

**Impact:** `400 Bad Request` with a Problem Details body. Oversized requests are rejected before full body read to prevent memory pressure on constrained hardware.

**Recovery:** Client corrects the request. No system impact.

**Events produced:** Structured log entry at DEBUG level.

---

## 7. Interaction with Other Subsystems

| Subsystem | Direction | Mechanism | Data | Constraints |
|---|---|---|---|---|
| State Store & State Projection | Reads from | `StateQueryService` (Doc 03 §8.1) | Entity state, view position, replay status | Read-only. Lock-free `ConcurrentHashMap` reads. |
| Device Model & Capability System | Reads from | `EntityRegistry`, `DeviceRegistry`, `CapabilityRegistry`, `CommandValidator` (Doc 02 §8.1) | Entity records, device records, capability schemas, command validation | Read-only. Used for entity/device listings and command validation. |
| Event Model & Event Bus | Reads from | `EventStore` (Doc 01 §8.1) | Event history, single event lookup, correlation-based trace queries | Read-only for queries. |
| Event Model & Event Bus | Writes via | `EventPublisher.publishRoot()` (Doc 01 §8.3) | `command_issued` events | Only write path. The event is persisted to SQLite and the method returns synchronously. |
| Automation Engine | Reads from | `AutomationRegistry`, `RunManager`, `PendingCommandLedger` (Doc 07 §8.1) | Automation definitions, run history, pending command status | Read-only. Used for automation list, run trace, and command lifecycle endpoints. |
| Integration Runtime | Reads from | `IntegrationSupervisor` health interface (Doc 05 §8.1) | Integration health status, restart counts, device counts | Read-only. Used for system health and integration status endpoints. |
| Configuration System | Reads from | `ConfigurationProvider` (Doc 06 §8.1) | Configuration values for API-level settings | Read-only. Configuration changes are applied via file reload, not API mutation. |
| Persistence Layer | Reads from | Telemetry query interface (Doc 04 §8.5) | Historical telemetry data for entity history charts | Read-only. Tier 1 exposes raw event history; telemetry query is a Tier 2 enhancement. |
| WebSocket API | Shares with | Authentication model, API version namespace | API keys, version prefix `/ws/v1` aligns with `/api/v1` | Both subsystems validate against the same key store. |
| Startup, Lifecycle & Shutdown | Called by | `RestApiLifecycle.start()`, `RestApiLifecycle.stop()` | Lifecycle signals | Start binds the HTTP server; stop performs graceful drain. |
| Observability & Debugging | Exposes | JFR events, metrics, structured logs | Request metrics, error rates, latency histograms | All metrics exposed via JFR (LTD-15). |

---

## 8. Key Interfaces

### 8.1 Interfaces

| Interface | Responsibility |
|---|---|
| `RestApiLifecycle` | Start (bind HTTP server, register routes) and stop (graceful shutdown with connection drain) |
| `RestApiServer` | Abstract HTTP server operations: route registration, request dispatch, server binding. Isolates the HTTP server implementation choice. |
| `EndpointHandler` | Functional interface for request handling: receives a typed `ApiRequest`, returns an `ApiResponse`. Each endpoint registers one handler. |
| `AuthMiddleware` | Extracts and validates API keys from request headers. Returns the authenticated identity or rejects the request. |
| `RateLimiter` | Per-key token bucket. Checks whether a request should proceed or be throttled. |
| `ETagProvider` | Computes ETags from source data: `viewPosition` for state queries, `event_id` for single events, `definition_hash` for automations. |
| `PaginationCodec` | Encodes and decodes cursor tokens. Cursor content is opaque to clients but contains the sort key for efficient keyset pagination. |
| `ProblemDetailMapper` | Maps internal exceptions (validation errors, not-found conditions, subsystem failures) to RFC 9457 Problem Details responses. |

### 8.2 Key Types

| Type | Kind | Responsibility |
|---|---|---|
| `ApiRequest` | Record | Parsed request: method, path, path parameters, query parameters, body (as `JsonNode`), authenticated identity, correlation ID |
| `ApiResponse` | Record | Response to serialize: status code, headers (including `ETag`, `Cache-Control`), body object |
| `PagedResponse<T>` | Record | Paginated response envelope: data list, pagination metadata (`next_cursor`, `has_more`, `limit`), response metadata (`view_position`) |
| `CommandRequest` | Record | Typed command input: `capability`, `command`, `parameters` |
| `CommandAcceptedResponse` | Record | Command acceptance: `command_id`, `correlation_id`, `entity_id`, `status`, `accepted_at`, `view_position` |
| `CommandStatusResponse` | Record | Four-phase lifecycle: `command_id`, `lifecycle` map (phase → event details), `current_phase`, `terminal` |
| `ProblemDetail` | Record | RFC 9457: `type`, `title`, `status`, `detail`, `instance`, optional `errors` array |
| `ApiKeyIdentity` | Record | Authenticated caller: `key_id`, `display_name`, `created_at`. Never contains the raw key value. |
| `CursorToken` | Record | Decoded cursor: sort dimension, sort value, direction. Encoded as URL-safe Base64 for wire transport. |

---

## 9. Configuration

All configuration follows YAML 1.2 (LTD-09) with JSON Schema validation. The REST API runs correctly with zero configuration — all values have sensible defaults.

```yaml
api:
  host: "0.0.0.0"                    # Bind address. Default listens on all interfaces.
  port: 8080                          # HTTP port. 0 for system-assigned.
  base_path: "/api/v1"                # URL prefix. Matches LTD-16.

  # Request limits
  max_request_body_bytes: 65536       # 64 KB. Rejects before full read.
  default_page_size: 50               # Default pagination limit.
  max_page_size: 200                  # Maximum pagination limit.

  # Rate limiting
  rate_limit:
    enabled: true
    requests_per_minute: 300          # Per API key. Sufficient for dashboard polling
                                      # without overwhelming constrained hardware.
    burst_size: 50                    # Token bucket burst allowance.

  # Connection management
  idle_timeout_seconds: 60            # Close idle keep-alive connections after this.
  shutdown_drain_seconds: 10          # Grace period for in-flight requests during shutdown.

  # CORS (for browser-based Web UI)
  cors:
    allowed_origins:                  # Default: same-origin only.
      - "http://homesynapse.local"
      - "https://homesynapse.local"
    allowed_methods: ["GET", "POST", "OPTIONS"]
    allowed_headers: ["Authorization", "Content-Type", "X-Correlation-ID", "If-None-Match"]
    max_age_seconds: 3600

  # Idempotency (AMD-08)
  idempotency:
    max_cache_size: 10000             # Maximum entries in the in-memory LRU cache.
    ttl_hours: 24                     # Per-entry time-to-live. Entries older than this
                                      # are evicted regardless of cache size.
    max_key_length: 128               # Maximum Idempotency-Key header value length.

  # Logging
  request_log_level: "INFO"           # Log level for request completion entries.
  log_request_bodies: false           # Never enable in production — may contain sensitive data.
```

**Configuration rationale:**

- `rate_limit.requests_per_minute: 300` — at 50 entities, a dashboard polling every 5 seconds generates ~12 requests per cycle (~144/minute). 300 provides headroom for concurrent clients and burst activity without allowing a runaway client to saturate the Pi's CPU.
- `max_request_body_bytes: 65536` — command payloads are typically < 1 KB. The 64 KB limit prevents accidental or malicious oversized requests from consuming memory while leaving room for future batch endpoints.
- `idle_timeout_seconds: 60` — keep-alive connections conserve TCP handshake overhead for polling dashboards. Sixty seconds is long enough for typical poll intervals but short enough to reclaim file descriptors from abandoned connections.

---

## 10. Performance Targets

All targets are measured on the Raspberry Pi 4 (4 GB RAM) validation floor (LTD-02) with 50 devices and ~150 entities. The load condition of ~100 events/sec represents the constitutional event throughput ceiling (Doc 01 §6, INV-PR-02) — this is a worst-case stress scenario, not a typical load. Typical 50-device Zigbee event rates are ~0.6 events/sec (Doc 08 research estimate). Targets should be comfortably exceeded on the recommended RPi 5 hardware.

| Metric | Target | Rationale |
|---|---|---|
| REST API response latency (p99) | < 50 ms | Constitutional target (INV-PR-02). Dashboard interactions must feel instantaneous. Includes auth, routing, handler execution, serialization. |
| REST API response latency (p50) | < 10 ms | Median requests should complete well within the constitutional ceiling. Most handler logic is ConcurrentHashMap lookups and Jackson serialization. |
| Single entity state query | < 5 ms | Lock-free `ConcurrentHashMap.get()` + Jackson serialization of ~500 bytes. |
| Entity list (50 entities, no filtering) | < 25 ms | Registry iteration + state join + pagination + serialization. |
| Event history page (50 events) | < 30 ms | SQLite indexed query + Jackson serialization of ~25 KB. |
| Command issuance (acceptance) | < 15 ms | Validation + SQLite WAL append + response serialization. The WAL commit is the dominant cost (~2–5 ms on NVMe, ~10 ms on slower storage). |
| Command status query | < 20 ms | EventStore query by correlation_id + lifecycle assembly. Bounded by the number of events in the causal chain (typically 4–6). |
| Causal chain trace | < 30 ms | EventStore query by correlation_id. Chain length typically < 20 events. Deeper chains (up to the 50-event warning threshold) may approach the p99 budget. |
| Concurrent request throughput | > 200 req/sec sustained | Virtual threads handle concurrency. The bottleneck is SQLite read contention (WAL mode allows unlimited concurrent readers) and Jackson serialization CPU. 200 req/sec at 500 bytes average is ~100 KB/sec — trivial for network I/O. |
| Memory contribution (steady state) | < 20 MB | The API holds no persistent state. Memory usage is dominated by the HTTP server's connection buffers, Jackson's ObjectReader/ObjectWriter instances (pre-built, reused), and the thread-local allocations for in-flight requests. |
| Startup time (server bind to first request served) | < 1 second | Route registration, auth store load, HTTP server bind. Must not contribute meaningfully to the 10-second system startup target (INV-PR-02). |

---

## 11. Observability

### 11.1 Metrics

All metrics are exposed via JFR custom events (LTD-15). No Prometheus or OpenTelemetry in Tier 1.

| Metric | Type | Labels | Description |
|---|---|---|---|
| `hs.api.request.duration` | Histogram (JFR) | `method`, `path_template`, `status` | Request duration in milliseconds. `path_template` uses the route pattern (e.g., `/api/v1/entities/{entity_id}`), not the resolved path, to prevent high-cardinality explosion. |
| `hs.api.request.count` | Counter (JFR) | `method`, `path_template`, `status` | Total request count. |
| `hs.api.error.count` | Counter (JFR) | `problem_type`, `status` | Error count by Problem type. |
| `hs.api.command.issued` | Counter (JFR) | `capability`, `command` | Commands issued through the API. |
| `hs.api.rate_limit.hit` | Counter (JFR) | `api_key_id` | Rate limit rejections per key. |
| `hs.api.active_connections` | Gauge (JFR) | — | Current open HTTP connections. |
| `hs.api.auth.failure` | Counter (JFR) | `reason` (`missing`, `invalid`, `expired`) | Authentication failures by reason. |

### 11.2 Structured Logging

| Log Event | Level | Key Fields | Description |
|---|---|---|---|
| `api.request.completed` | INFO | `method`, `path`, `status`, `duration_ms`, `api_key_id`, `correlation_id` | Every completed request. At INFO level, not DEBUG, because API request patterns are essential diagnostic data. |
| `api.request.failed` | WARN | `method`, `path`, `status`, `problem_type`, `detail`, `correlation_id` | Requests that produced 4xx or 5xx responses. |
| `api.command.issued` | INFO | `entity_id`, `capability`, `command`, `command_id`, `correlation_id`, `api_key_id` | Command issuance through the API. Links to the command lifecycle trace. |
| `api.auth.failure` | WARN | `reason`, `remote_address` | Authentication failures. Logged at WARN to support intrusion detection without flooding. |
| `api.rate_limit.engaged` | WARN | `api_key_id`, `requests_in_window` | First rate-limited request per key per minute. |
| `api.startup` | INFO | `host`, `port`, `route_count` | Server binding complete. |
| `api.shutdown` | INFO | `drain_duration_ms`, `connections_drained` | Graceful shutdown complete. |

### 11.3 Health Indicator

| State | Condition |
|---|---|
| **HEALTHY** | HTTP server is bound and accepting requests, all dependency interfaces are responsive, authentication store is loaded. |
| **DEGRADED** | HTTP server is accepting requests but one or more dependency interfaces are slow (> 100 ms p99 over the last 60 seconds) or the State Store is replaying. |
| **UNHEALTHY** | HTTP server is not accepting requests, or the authentication store is unavailable, or a critical dependency interface (EventStore, EntityRegistry) is consistently failing. |

The REST API's health indicator is reported to the system health aggregation. It is also exposed at `GET /api/v1/system/health`, which requires authentication like all other endpoints (INV-SE-02). A completely unhealthy API — or one whose auth store is unavailable — cannot serve its own health endpoint. External process liveness monitoring is provided by the systemd watchdog via `sd_notify` (LTD-13), which operates outside the HTTP stack and remains functional regardless of API health state.

> **HealthContributor upstream note (Doc 11).** The REST API implements `HealthContributor` (Doc 11 §8.1, §8.2) and is classified as **INTERFACE_SERVICES** tier (Doc 11 §7.1). Startup grace period: 10 seconds. The `reportHealth()` callback returns the three-state indicator from the table above. Because the REST API is the subsystem that exposes `/api/v1/system/health`, its own health state is both a contributor to and a consumer of the HealthAggregator — it reports its own state, then serves the aggregated result. If the REST API itself is UNHEALTHY, the health endpoint is unreachable; the systemd watchdog (LTD-13) provides the external liveness fallback.

---

## 12. Security Considerations

This section is mandatory: the REST API is an external network interface and the primary trust boundary between HomeSynapse and the outside world.

### 12.1 Authentication Model

**Tier 1: API key authentication.** Every API request must include a valid API key in the `Authorization: Bearer {key}` header. API keys are generated during first-run setup and stored encrypted at rest (INV-SE-03) in the configuration directory. Multiple keys are supported to distinguish clients (Web UI, Companion App, external tools) and enable per-key rate limiting and revocation.

Keys are generated as 256-bit random values, encoded as URL-safe Base64 (43 characters). The stored representation is a bcrypt hash — the raw key is shown once at creation time and never stored. Key metadata (ID, display name, creation date, last-used timestamp) is stored alongside the hash.

API key management is performed via the `homesynapse` CLI tool in Tier 1:

```
homesynapse api-key create --name "Web UI"
homesynapse api-key list
homesynapse api-key revoke --id {key_id}
```

A future Tier 2 enhancement adds API key management through the REST API itself, protected by a key with elevated permissions.

**Tier 2 path: Bearer token authentication.** For remote access scenarios, API key authentication is insufficient (keys are long-lived and lack session semantics). Tier 2 introduces short-lived bearer tokens issued by a local authentication server, supporting refresh-token rotation and per-session scoping. The `Authorization: Bearer` header format is identical — the middleware distinguishes API keys from bearer tokens by format and validates accordingly. This path is designed for but not implemented in Tier 1.

### 12.2 Transport Security

**Tier 1: HTTP on LAN.** The MVP serves plain HTTP on the local network. This is a pragmatic concession: TLS certificate management on a headless Raspberry Pi is a significant usability burden, and LAN traffic on a home network is typically not encrypted at the application layer by any smart home platform (Home Assistant serves HTTP by default, with optional TLS via add-on reverse proxies). The LAN is not trusted (INV-SE-02 still requires authentication), but TLS is not mandated for Tier 1.

**Tier 2: TLS required for non-LAN access.** Any access path that traverses a non-local network (remote access relay, VPN, WireGuard tunnel) must be end-to-end encrypted (INV-SE-05). The REST API server will support direct TLS termination with user-provided certificates or ACME (Let's Encrypt) auto-provisioning for users with a domain name. For most users, a reverse proxy (Caddy, nginx) provides TLS termination without burdening the application server.

### 12.3 Input Validation

All input passes through validation before reaching any handler logic:

- **Path parameters** (`entity_id`, `device_id`, `command_id`) are validated as syntactically valid ULIDs. Invalid ULIDs are rejected with `400` before any database lookup.
- **Query parameters** are validated against their declared types, ranges, and allowed values. Unknown query parameters are silently ignored (forward-compatible per LTD-16).
- **Request bodies** are parsed as JSON with a size limit enforced before parsing. Parsing errors return `400`. Parsed bodies are validated against the endpoint's expected schema. Validation errors return `400` or `422` with per-field details.

Jackson deserialization is configured with `FAIL_ON_UNKNOWN_PROPERTIES=false` (per LTD-08) for forward compatibility, but validated fields are strictly checked. This means: clients may send extra fields (ignored), but required fields must be present and correctly typed.

### 12.4 Secret Protection

- API key values never appear in log output. Log entries reference keys by `api_key_id` only.
- The `correlation_id` in error responses does not reveal internal state — it is an opaque identifier the client can cite in a support request and that operators can use to find the corresponding log entries.
- Stack traces are never included in API error responses. Internal error details are logged server-side with the `correlation_id`; the client receives only the Problem Details error with a generic `detail` for 500 errors.

### 12.5 Rate Limiting and Abuse Prevention

Rate limiting protects constrained hardware from accidental or malicious overload. The token-bucket algorithm allows short bursts (e.g., initial dashboard load fetching multiple resources) while enforcing a sustained rate ceiling.

Per-key rate limits are enforced in-memory using a `ConcurrentHashMap` of token buckets. The buckets are lightweight (one long for token count, one long for last-refill timestamp per key) and bounded by the number of active API keys (typically < 10).

A client that consistently exceeds rate limits has its key flagged in the structured log. Tier 2 may introduce automatic key suspension after sustained abuse, with notification to the system administrator.

---

## 13. Testing Strategy

### 13.1 Unit Tests

- **Request routing:** Verify that URL patterns match correctly, including path parameters, optional query parameters, and edge cases (trailing slashes, percent-encoded ULIDs).
- **Parameter validation:** For each endpoint, test valid and invalid values for every path parameter, query parameter, and body field. Verify that validation errors produce correct Problem Details responses with per-field error details.
- **ETag computation:** Verify that ETags are computed correctly from `viewPosition`, `event_id`, and `definition_hash`. Verify that `If-None-Match` produces `304` when matching and a full response when not.
- **Pagination encoding/decoding:** Verify cursor round-trip: encode a position, decode the cursor, verify the position matches. Test edge cases: first page (no cursor), last page (`has_more: false`), maximum page size.
- **Error mapping:** Verify that each internal exception type maps to the correct Problem type, HTTP status, and detail message. Verify that 500 errors do not leak stack traces.
- **Rate limiting:** Verify that the token bucket correctly allows bursts up to `burst_size`, enforces the sustained rate, and resets over time.
- **Command validation:** Verify that valid commands are accepted, invalid capabilities are rejected, invalid parameters are rejected with per-field errors, and disabled entities produce `409`.
- **Command status assembly:** Given mock EventStore returns for a command's correlation chain, verify correct lifecycle phase assembly for each possible state (pending, dispatched, acknowledged, confirmed, timed out, rejected).

### 13.2 Integration Tests

- **Full command lifecycle:** Issue a command via the REST API. Verify `202 Accepted`. Simulate the downstream event chain (`command_dispatched`, `command_result`, `state_reported`, `state_confirmed`). Query the command status endpoint at each phase and verify correct lifecycle assembly.
- **State query consistency:** Issue a command, note the returned `view_position`. Query the entity state endpoint. If the State Store has caught up (position ≥ command position), verify the state reflects the command outcome. If not, verify the response carries a lower position and the `Warning` header.
- **ETag caching flow:** Query an entity. Note the ETag. Query again with `If-None-Match`. Verify `304 Not Modified`. Simulate a state change. Query again with the same `If-None-Match`. Verify full response with a new ETag.
- **Event history pagination:** Insert 500 events. Paginate through them with `limit=50`. Verify all 500 events are returned exactly once, in correct order, with correct cursor continuity.
- **Authentication enforcement:** Attempt every endpoint without authentication. Verify `401` on each. Attempt with an invalid key. Verify `403`. Attempt with a valid key. Verify success.
- **Graceful shutdown:** Start the server, initiate a long-running request (e.g., large event history query), trigger shutdown, verify the in-flight request completes, verify new requests are rejected with `503`.

### 13.3 Performance Tests

- **Latency benchmark:** 50 entities, 100 events/sec sustained, concurrent dashboard simulation (5 clients polling every 2 seconds). Measure p50 and p99 for each endpoint category. Verify constitutional target (p99 < 50 ms).
- **Throughput benchmark:** Ramp concurrent requests from 10 to 500 req/sec. Identify the saturation point where p99 exceeds 50 ms. Verify it exceeds 200 req/sec.
- **Command issuance throughput:** Issue 50 commands/sec sustained for 60 seconds. Verify no request exceeds the 50 ms p99 target and no events are lost.
- **Memory under load:** Sustained 200 req/sec for 30 minutes. Verify heap usage does not grow unboundedly (no memory leak in connection buffers, Jackson allocations, or rate limiter state).

### 13.4 Failure Tests

- **State Store unavailability:** Stop the State Store projection. Verify that state query endpoints return `503` with `Retry-After`. Verify that event history endpoints continue functioning.
- **EventStore read failure:** Inject a SQLite read error. Verify that event history endpoints return `500` with a Problem Details body and that the correlation_id in the response matches the server-side log entry.
- **Authentication store corruption:** Replace the key store with invalid data. Verify that all requests receive `500` and that the health endpoint (if accessible) reports `unhealthy`.
- **Rate limit under burst:** Issue `burst_size + 10` requests in rapid succession. Verify that the first `burst_size` succeed and the remaining receive `429` with appropriate `Retry-After`.
- **Oversized request body:** Send a 1 MB request body to the command endpoint. Verify that it is rejected with `400` before the full body is read (verify via timing — the rejection should be near-instant, not after reading 1 MB).

---

## 14. Future Considerations

**Tier 2: Automation CRUD via REST API.** Tier 1 automations are defined in `automations.yaml` and read-only through the API. Tier 2 adds `POST /api/v1/automations`, `PUT /api/v1/automations/{id}`, and `DELETE /api/v1/automations/{id}` endpoints. These endpoints use `If-Match` with the `definition_hash` ETag for optimistic concurrency. Writes go through the Configuration System's validation pipeline and produce `config_changed` events. The YAML file remains the canonical store — API writes update the file and trigger a reload. The design of read endpoints and the automation response shape (§4.7) already accommodates write operations without breaking changes.

**Tier 2: Webhook subscription management.** REST endpoints for registering external webhook subscriptions (`POST /api/v1/subscriptions`, `GET /api/v1/subscriptions`, `DELETE /api/v1/subscriptions/{id}`). Webhook delivery uses the Stripe-style HMAC-SHA256 signature pattern: `X-HomeSynapse-Signature: t={unix_ts},v1={hmac_hex}`, signing `{timestamp}.{raw_body}` with a per-subscription secret. The subscription model includes: subscriber-specified event type filters, `stateChangeOnly` filtering, challenge-response endpoint verification at registration time, and configurable retry with exponential backoff. This design is informed by SmartThings' subscription API (the most complete REST subscription surface in the smart home space) and Stripe's webhook signing (the gold standard for webhook security). The event types, filtering model, and delivery semantics are already defined by the Event Model (Doc 01) and the WebSocket API (Doc 10) — the REST subscription surface is a different delivery channel for the same event stream.

**Tier 2: TLS termination and certificate management.** Direct TLS support with ACME auto-provisioning (Let's Encrypt) for users with a domain name, and self-signed certificate generation for LAN-only users who want encrypted local traffic. The API server's TLS configuration is a YAML section under `api.tls` that the current configuration schema reserves but does not populate.

**Tier 2: Content negotiation.** Support for `Accept: application/cbor` (RFC 8949) as a binary alternative to JSON. CBOR reduces payload size by 20–40% and parse time proportionally — meaningful for bandwidth-constrained mobile clients. The Jackson CBOR module (`jackson-dataformat-cbor`) uses the same ObjectMapper configuration, making the addition a serialization-layer change with no impact on handler logic.

**Tier 2: Batch command endpoint.** `POST /api/v1/commands/batch` accepting an array of command requests targeting multiple entities. Returns a `207 Multi-Status` response with per-command acceptance results. Modeled after HomeKit's batch characteristic write semantics. The internal implementation issues individual `command_issued` events sharing a single `correlation_id`.

**Tier 2: Read-your-writes consistency option.** A `X-Min-Version: {position}` request header that causes the handler to wait (with a short timeout, default 500 ms) for the State Store's `viewPosition` to reach the requested minimum before serving the response. This eliminates the poll-after-command pattern for clients that need synchronous read-after-write semantics. The State Store already publishes `viewPosition` as a volatile field — the wait is a simple spin-poll with Thread.sleep() intervals.

**Tier 3: GraphQL as an alternative surface.** If GraphQL adoption in the smart home ecosystem grows (currently low), evaluate a GraphQL endpoint at `/api/v1/graphql` that reuses the same handler logic and internal interfaces. The handler architecture (typed request in, typed response out) is compatible with GraphQL resolvers. This is speculative and not on the current roadmap.

**Event category filtering (depends on A-01-DR-1).** When the pending `event_category` field is added to the event envelope (Doc 01 A-01-DR-1), the REST API should: (a) include `event_category` in all event serialization responses (§4), and (b) add `event_category` as a repeatable filter parameter on `GET /api/v1/events` with OR semantics (matching events in any of the specified categories). This supports the Data Sovereignty API pattern (INV-PD-07) where third-party clients receive scoped access by event category. The filter parameter is an additive API change and does not require an endpoint version bump.

---

## 15. Open Questions

1. ~~**Should the health endpoint be accessible without authentication for external monitoring?**~~
   **[Resolved]:** The health endpoint requires authentication, consistent with INV-SE-02. The systemd watchdog uses `sd_notify` (LTD-13), not the HTTP health endpoint, for process liveness monitoring. This means the system remains externally monitored even when the auth store is unavailable. No unauthenticated endpoint is needed.

2. **Should the API serve the OpenAPI specification at a well-known endpoint?**
   Options: (a) Serve the OpenAPI 3.1 JSON at `GET /api/v1/openapi.json`; (b) Serve only as a static file bundled with the documentation; (c) Both.
   Needed: Clarity on whether the Web UI or developer tooling benefits from runtime OpenAPI access.
   Status: **[NON-BLOCKING]** — adding the endpoint later is an additive change. The specification is generated regardless.

3. **Should the `GET /api/v1/state` bulk endpoint support field projection?**
   Options: (a) Always return full entity state; (b) Accept a `fields` query parameter to select specific attributes (e.g., `?fields=on_off,level`) to reduce payload size for bandwidth-constrained polling clients.
   Needed: Performance profiling of the bulk endpoint on RPi4 at 150+ entities to determine whether payload size is a practical concern.
   Status: **[NON-BLOCKING]** — field projection is an additive feature. The full response shape is the baseline.

---

## 16. Summary of Key Decisions

| Decision | Choice | Rationale | Section |
|---|---|---|---|
| API as translation layer | No persistent API state; all responses assembled from internal queries | Keeps the API stateless, prevents shadow domain model drift, enables zero-state crash recovery. Principle: "translation layer, not domain model." | §1, §5 |
| Typed command invocation | `POST .../commands` with capability/command payload, not `PUT .../state` | Matches the actual async command lifecycle; converges with Matter, HomeKit, Alexa, SmartThings patterns; enables four-phase tracking. Principle: "commands are typed invocations." | §1, §3.4 |
| Four-phase command lifecycle | `accepted` → `dispatched` → `acknowledged` → `confirmed`, exposed via `/commands/{id}` | No existing platform exposes all four phases. Event-sourced architecture produces these events naturally. Strongest competitive differentiator for the API surface. | §3.4, §4.5 |
| Cursor-based pagination | Opaque Base64 cursor over sort key, not offset-based | Offset breaks with concurrent appends in an append-only log. Cursors are stable across inserts. | §3.5 |
| ETag from projection version | `W/"{viewPosition}"` for state, `"{event_id}"` for events, `W/"{hash}"` for automations | Event sourcing provides natural version numbers. No smart home platform uses HTTP caching headers — this is a differentiator. | §3.7 |
| RFC 9457 Problem Details | All errors as typed `application/problem+json` | Standardized, machine-readable error model. Replaces ad-hoc JSON error objects common across smart home APIs. | §3.8 |
| Five operational planes | State Query / Command / Event History / Automation / System Admin | Different consistency contracts per plane. Informed by Google Home, HA, SmartThings surface separation patterns. | §3.2 |
| API key authentication (Tier 1) | `Authorization: Bearer {key}`, bcrypt-hashed storage, CLI management | Satisfies INV-SE-02 (auth required on all external interfaces). Simple enough for hobbyist users; bearer token path reserved for Tier 2. | §12.1 |
| HTTP on LAN (Tier 1) | Plain HTTP; TLS deferred to Tier 2 | Pragmatic: TLS cert management is a UX burden on headless Pi. No smart home platform mandates LAN TLS. Auth still required (INV-SE-02). | §12.2 |
| Composite queries in API handler | Entity list filtering joins EntityRegistry + StateQueryService at the handler level | Follows State Store §8.1 design: State Store stays free of secondary indexes; structural filtering lives in the registry; the API performs the join. | §3.6 |
| Virtual thread per request | Each HTTP request dispatched on its own virtual thread | Natural concurrency model for Java 21 (LTD-01). No thread pool sizing. Blocking in handlers (SQLite reads) does not exhaust carrier threads. | §3.3 |
| HTTP server abstracted behind `RestApiServer` | Implementation choice (JDK HttpServer, Javalin, Jetty) deferred to Phase 2 | Design is implementation-agnostic. Handler model is plain Java methods. Route registration is declarative. Keeps the door open for the lightest viable server. | §3.9 |
| YAML-only automation management (Tier 1) | Automation endpoints are read-only; CRUD deferred to Tier 2 | Tier 1 scope per MVP. YAML is the canonical configuration store (LTD-09, INV-CE-01). Read endpoints and response shapes are designed to accommodate future write endpoints as additive changes. | §2.2, §14 |
| Correlation ID tracing | Client-provided `X-Correlation-ID` logged as request metadata; event `correlation_id` always set by `publishRoot()` per Doc 01 §8.3 | End-to-end tracing via structured logs + event correlation chain. Preserves Doc 01 causal chain invariant. | §3.11 |

---

*This document is part of the HomeSynapse Core Phase 1 design documentation. It is governed by the Design Document Template and will be reviewed during architecture review.*