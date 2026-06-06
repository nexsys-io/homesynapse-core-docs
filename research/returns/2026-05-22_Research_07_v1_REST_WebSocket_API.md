# Research 7: REST and WebSocket API Design for Event-Sourced Smart Home Systems

## TL;DR

- **HomeSynapse Core's M10 surface should adopt EventStoreDB-style server-side prefix/regex event-type filtering, RFC-5005 `Link:` headers + JSON:API-shaped envelopes for paged event reads, JSON-RPC-2.0-shaped WebSocket framing with explicit catch-up→live transition, RFC 9457 Problem Details for all 4xx/5xx, and Bearer API keys with bcrypt-at-rest + SHA-256-keyed in-memory cache; reject mTLS, OAuth2 Authorization Code flow, IP-whitelist trust bypass, query-string tokens, and per-request bcrypt verification.**
- **The existing 13-subtype `WsMessage` hierarchy is structurally correct against production validators (Home Assistant, EventStoreDB, Marten) but is missing three frames: `PingMsg`/`PongMsg`, `CaughtUpMsg`, and `ServerHelloMsg`; the three-stage `DeliveryMode` (NORMAL → BATCHED → COALESCED) with `CLIENT_TOO_SLOW (4429)` is a genuine differentiation vs every peer (Home Assistant disconnects at `MAX_PENDING_MSG=4096` with no close code) and should be retained and codified at thresholds 256/1024/4096 frames or 2s/5s/30s lag.**
- **The stated authentication target of "<50ms p99 bcrypt at cost 10–12 on Cortex-A72" is not physically achievable: the patrickfav/bcrypt JMH benchmark measures `BcryptBenchmark.benchmarkBcBcryptLog 12 avgt 3 200,578 ± 25,269 ms/op` on JDK 1.8.0_172 desktop x86, and Pi 4's A72 at 1.5–1.8 GHz runs Blowfish key-schedule materially slower, putting cost-12 in the ~600–700 ms range; recommendation is cost-10 at rest plus a 5-minute SHA-256-keyed identity cache, yielding ~50 µs steady-state validation while preserving cost-12-grade offline resistance.**

## Key Findings

1. **MVP endpoint set covers <40% of the real surface.** The closest production peers all expose history/persistence, command/service invocation, schema discovery, and outbound webhook endpoints — none of which exist in the MVP. The five highest-impact gaps are time-range event history, command invocation, schema discovery, projection rebuild/replay, and signed-URL downloads.

2. **HomeSynapse's `WsSubscriptionFilter` is correctly more expressive than every peer**, but is missing event-type prefix and regex matching that EventStoreDB has shipped since v23 (`SubscriptionFilter{Type: StreamFilterType, Regex: "^user|^company"}`), and missing time-range fields for replay scenarios. The fix is purely additive.

3. **Home Assistant disconnects slow WebSocket clients silently.** Verbatim from `homeassistant/components/websocket_api/http.py` (dev branch): `MAX_PENDING_MSG=4096` (raised from 512 in PR #89611), `PENDING_MSG_PEAK=2048`, `PENDING_MSG_PEAK_TIME=5`; on overflow the server calls `self._cancel()` then `await wsock.close()` with no explicit WebSocket close code or reason. HomeSynapse's graduated `NORMAL → BATCHED → COALESCED → close(4429)` strategy is a strict improvement.

4. **Bcrypt per-request is over-engineered.** No surveyed platform does it — Home Assistant compares opaque tokens with constant-time equality; SmartThings does the same. The cybersierra analysis quantifies the API performance penalty at "650 ms of CPU time per second" for 10 RPS at cost-10. Replacement is the standard "expensive hash at rest + cheap fingerprint in memory" two-tier pattern.

5. **The genuine differentiation is the three-stage backpressure model.** No peer offers graceful degradation: Home Assistant silently kills the connection; Marten parks subscriptions server-side; EventStoreDB persistent subscriptions buffer-then-drop; SmartThings cloud rate-limits with 429. HomeSynapse's per-entity last-write-wins coalescing + global drop-oldest fallback is a strict differentiator and should be specified in the protocol documentation, not left implicit.

6. **The schema/discovery endpoint must be built-time-generated, not reflection-based.** Pi 4's Cortex-A72 has a weak indirect-branch predictor (chipsandcheese.com analysis) and Java reflection startup is materially slower than on x86. An annotation-processor approach emitting `META-INF/homesynapse/schema.json` at compile time keeps cold-start identical and schema-response latency below 5 ms.

7. **INV-SE-02 compliance is non-negotiable** and forces rejection of three otherwise-tempting peer patterns: OpenHAB's "by default anyone in the LAN will have user access rights" (verbatim from openhab.org/docs/configuration/restdocs.html); Home Assistant's `trusted_networks` auth-bypass option; and OAuth2 Authorization Code flow's redirect-URI requirement which is hostile to local-network-only deployment.

## Details

### Platform Deep Dives

**Home Assistant — REST + WebSocket.** Flat REST surface at `/api/*` (states, services, events, history, logbook, calendars). Single persistent WebSocket at `/api/websocket` using JSON-RPC-shaped frames with client-assigned integer `id` correlation. Per developers.home-assistant.io/docs/api/websocket/: *"The command subscribe_events will subscribe your client to the event bus. You can either listen to all events or to a specific event type. If you want to listen to multiple event types, you will have to send multiple subscribe_events commands."* No entity-level filter parameter exists, and multiple community feature requests for entity filtering are documented (community forum topics 234191, 272447, 288004). No pagination on `/api/states` (community thread "How can I filter the Home Assistant REST API response to exclude attributes and diagnostic entities?" documents the symptom). Slow-client disconnect occurs at `MAX_PENDING_MSG=4096` with no WebSocket close code; the internal rationale comment in `http.py` reads: *"As back-pressure builds, the queue will back up and use more memory until we disconnect the client when the queue size reaches MAX_PENDING_MSG. … 1 MiB is the maximum expected size of the serialized entity registry, which is the largest message we usually send."* Long-lived access tokens are individually unrevokable without also revoking the originating refresh token (community thread "Long Lived access tokens revocation"). Lesson: keep the JSON-RPC-shaped envelope; reject the silent disconnect; keep the more-expressive filter; add the `CaughtUpMsg` transition that HA conflates.

**OpenHAB — REST + SSE.** Surfaces `/rest/items`, `/rest/things`, `/rest/persistence/{service}/{item}` with `starttime`/`endtime`, and SSE at `/rest/events` with a topic-string filter. Per openhab.org/docs/configuration/restdocs.html: *"Starting with version 3, openHAB supports password protection. Only admins are able to access and change sensitive parts of the API. … By default anyone in the LAN will have user access rights."* That LAN-trust default is the documented anti-pattern HomeSynapse rejects per INV-SE-02. The SSE filter limitation is acknowledged upstream — github.com/openhab/openhab-core/issues/1363: *"/rest/events only offers a topic filter which is not flexible enough to retrieve state updates for a specific set of items only; SSE connections are initiated by a GET request so parameters are limited to URL query strings, which limits large sets of items to track and advanced querying."* Lesson: adopt time-range query params on history; reject LAN-trust.

**EventStoreDB — HTTP API + Subscriptions.** Streams as Atom feeds with RFC 5005 link relations; three subscription types (volatile, catch-up, persistent). Server-side filtering supports prefix and regex on event-type or stream-id, with periodic checkpoint callbacks. Per developers.eventstore.com/clients/grpc/subscribing-to-streams/filtering.html: *"This number will be called every n * 32 events"* — default multiplier n=1 yields a checkpoint every 32 events for filtered `$all` subscriptions. Per docs-next.eventstore.com/clients/java/catch-up-subscriptions/: *"EventStoreDB allows you to filter the events whilst you subscribe to the $all stream so that you only receive the events that you care about. You can filter by event type or stream name using either a regular expression or a prefix. Server-side filtering is currently only available on the $all stream."* AtomPub is disabled-by-default in v20+ (not formally deprecated); the legacy TCP client *"was deprecated in version 20.2 and removed in version 24.2,"* with gRPC as the replacement protocol. Lesson: adopt RFC 5005 `Link:` headers + envelope cursor; adopt server-side prefix/regex; emit periodic checkpoint frames during catch-up.

**Marten — Async Daemon Subscriptions.** Hosted background process walking a PostgreSQL event log via a per-projection "high water mark" cursor with advisory-lock leader election. Per martendb.io/events/projections/async-daemon: *"High Water Mark -- the furthest known event sequence that the daemon 'knows' that all events with that sequence or lower can be safely processed in order by projections."* Subscriptions declare allow-lists (`IncludeType<T>`); poison events go to `mt_doc_deadletterevent`. Lesson: high-water-mark concept maps onto HomeSynapse's `fromGlobalPosition`; add explicit `CaughtUpMsg` boundary marker; `/internal/dlq` already implements the Marten DLQ pattern — add `POST /internal/dlq/{id}/retry`.

**Matter 1.4 — Interaction Model.** Four distinct interactions: Read, Write, Invoke (optionally timed), Subscribe (with negotiated `MinIntervalFloor`/`MaxIntervalCeiling`). Per handbook.buildwithmatter.com/how-it-works/interaction-model/: *"If the Subscriber does not receive a Report Data Action within the maximum negotiated interval between Actions, the subscription will be terminated. As a consequence of the previous rule, the Publisher may terminate a Subscription Interaction by simply stopping sending periodic Report Data Actions."* Lesson: adopt the four-verb separation (GET read, PUT/POST write, POST `/invoke` command, WebSocket subscribe); reject publisher-can-terminate-by-silence (battery optimization not applicable on AC-powered Pi); model the "primed first batch" as explicit `SnapshotMsg`.

**Hubitat Maker API.** Per docs2.hubitat.com/en/apps/maker-api: *"NOTE: Your access token is an authorization token, similar to a username and password. Anyone with this token can access these endpoints. To reset your access token, use the Create New Access Token option the app … Doing so will require reconfiguration (by replacing the old access token with the new one) on the external system/application/etc."* Tokens live in `?access_token=…` query strings — documented anti-pattern (proxy/access-log leakage). No native subscription protocol; events delivered via outbound webhook POSTs. Lesson: reject query-string tokens; adopt per-key device/entity allow-list scoping; offer webhook-push as a fallback for clients that cannot hold a WebSocket.

**SmartThings.** OAuth2 Authorization Code flow + Personal Access Tokens valid for 50 years. Per developer.smartthings.com/docs/getting-started/rate-limits, the documented limits include 60 requests/minute for the Apps API, 100 GET/min and 20 update/hr for the Locations API, 20 requests/min per Installed App for Execution Lifecycles, and a guardrail of 40 subscription-creation requests per 15 minutes with a hard cap of 40 subscriptions per Installed App. Per the same docs: *"When a client application exceeds the rate limits for a given SmartThings API, the SmartThings API responds with the standard HTTP 429 (Too Many Requests) error code. … When a client application exceeds the guardrail limits for a given SmartThings API, the SmartThings API responds with the standard HTTP 422 (Unprocessable Entity) error code."* And: *"All SmartThings resources are protected with OAuth 2.0 Bearer Tokens sent on the request as an Authorization: Bearer <TOKEN> header, and operations require specific OAuth scopes that specify the exact permissions authorized by the user."* Lesson: reject OAuth2 Authorization Code flow for local API (redirect URI is hostile to LAN-only); adopt 429 vs 422 distinction; adopt explicit per-key scope/capability model.

**Protocol references.** RFC 9457 Problem Details (type/title/status/detail/instance, media type `application/problem+json`) — HomeSynapse's existing `ProblemDetail` record is conformant; adopt as universal error envelope including WebSocket errors. RFC 6455 §7.4.2: *"4000-4999 Status codes in the range 4000-4999 are reserved for private use and thus can't be registered."* — `CLIENT_TOO_SLOW (4429)` is well-formed. RFC 5005 link relations `first`/`last`/`previous`/`next` apply directly to the event-history endpoint. JSON:API v1.1: *"JSON API is agnostic about the pagination strategy used by a server, but the page query parameter family can be used regardless of the strategy employed"* — adopt `data + meta + links` shape, reject the `included` compound-document mechanism. HAL rejected as primary envelope (no standard cursor convention). JSON-RPC 2.0 envelope matches the existing `WsMessage` shape — formally document JSON-RPC compatibility.

### Cross-Cutting Analysis

**Concept mapping (selected rows).** Entity ↔ HA entity / OpenHAB Item / EventStoreDB stream / Marten aggregate / Matter Endpoint+Cluster / Hubitat Device / SmartThings Device. Subscribe ↔ HA subscribe_events / OpenHAB /rest/events SSE / EventStoreDB volatile / Marten (server-only) / Matter Subscribe Interaction / Hubitat (webhook only) / SmartThings subscription. Catch-up ↔ unique to EventStoreDB and Marten among peers. Global position ↔ unique to EventStoreDB; HomeSynapse uniquely surfaces it among smart-home peers. DLQ ↔ Marten and EventStoreDB persistent subscriptions only.

**Gaps ranked by impact:** (1) time-range event-history endpoint — present in HA `/api/history/period/...`, OpenHAB `/rest/persistence`, EventStoreDB stream read by position; (2) command/service invocation — present in HA `/api/services/{domain}/{service}`, OpenHAB `/rest/items/{name}` POST, Hubitat `/devices/{id}/{cmd}`, Matter Invoke; (3) schema/capability discovery — present in OpenHAB API Explorer, EventStoreDB streamdesc, SmartThings OpenAPI; (4) server-side event-type prefix filter — present in EventStoreDB, Marten; (5) outbound webhook delivery — present in Hubitat, SmartThings, HA REST notify; (6) explicit catch-up→live transition frame — present in EventStoreDB v23.10+ `caughtUp` event, Marten high-water mark; (7) signed-URL download — present in HA signed_path; (8) per-key capability scopes — present in SmartThings OAuth scopes, Hubitat per-app device list.

**Over-abstraction defense.** Ten-field `WsSubscriptionFilter` is defended — all ten fields have peer-equivalent justification. Three-stage `DeliveryMode` is defended — zero peers have this; it is the genuine differentiation. `CLIENT_TOO_SLOW (4429)` is defended — RFC 6455 §7.4.2 permits 4000–4999 codes; 4429 echoes HTTP 429. `/internal/*` namespace separation is defended — good hygiene matching Marten's DeadLetterEvent surface. `ApiKeyIdentity` record is defended — explicit identity binding is cleaner than implicit. **Retract: bcrypt-per-request** — no peer does this; replace with bcrypt-at-rest + SHA-256-keyed in-memory cache.

**Competitive assessment.** Genuinely differentiated: (1) graduated backpressure with `CLIENT_TOO_SLOW (4429)` — no peer offers graceful degradation; (2) local-first auth with no cloud broker — SmartThings cloud-only, HA/OpenHAB/EventStoreDB/Marten lack first-class API-key-with-scopes; (3) event-sourced reads with `globalPosition` cursor surfaced to API — unique among smart-home peers. At parity: Bearer authentication, JSON response shape, persistent WebSocket. Behind: command invocation, history endpoint, schema discovery, outbound webhook — closed by REC-62 through REC-67.

### Amendment Recommendations (impact × confidence ÷ cost)

- **REC-62 — Time-range event-history endpoint.** Add `GET /api/v1/events?from&to&entityId&eventType&eventTypePrefix&limit&cursor` returning `PagedResponse<EventEnvelope>` with `meta.cursor.next` and `Link: <…>; rel="next"` headers per RFC 5005. Backing: `EventQueryService.query(EventQuery) → Page<EventEnvelope>`. Pure addition. **~280 LOC.**

- **REC-63 — Command/invoke endpoint.** Add `POST /api/v1/entities/{id}/invoke` body `{"command":"set_brightness","args":{…},"timedInteractionMs":2000}` returning 202 + `meta.commandId` + Location to `/api/v1/commands/{id}`. Backing: `CommandDispatcher.dispatch(EntityId, InvokeRequest) → CommandReceipt`. Errors as `application/problem+json` with `type=urn:homesynapse:problem:command-rejected`. Pure addition. **~340 LOC.**

- **REC-64 — Schema/capability discovery.** Add `GET /api/v1/schema` and `GET /api/v1/openapi.json` served from `META-INF/homesynapse/schema.json` emitted by a compile-time annotation processor scanning `@RestEndpoint`, `@EventType`, `@Capability`, `@WsCommand`. Reject runtime reflection on Pi 4. Pure addition. **~420 LOC** (processor 200, runtime serializer 120, OpenAPI assembler 100).

- **REC-65 — Server-side prefix/regex filter on `WsSubscriptionFilter`.** Add `List<String> eventTypePrefixes`, `List<String> entityIdPrefixes`, `String eventTypeRegex` (mutually exclusive with prefixes — validate at subscribe time, reject with 4400 PROTOCOL_ERROR if both present). Cap 16 prefix entries per list. Use RE2/J not `java.util.regex`. Pure addition. **~120 LOC.**

- **REC-66 — Per-API-key capability scopes.** Extend `ApiKeyIdentity` to `(keyId, principal, createdAt, scopes: Set<Capability>, entityIdAllowList: List<String>)` with `Capability { READ_ENTITIES, READ_STATES, INVOKE_COMMANDS, READ_EVENTS, SUBSCRIBE_EVENTS, READ_DLQ, ADMIN_PROJECTION, ADMIN_KEYS }`. Centralize check in `AuthorizationFilter`. Breaking change to record signature — provide `ApiKeyIdentity.legacy(...)` deprecated factory for one release. CLI: `homesynapse-cli key create --name=dashboard --scopes=read:entities,subscribe:events --entity-prefix=light.*`. **~310 LOC.**

- **REC-67 — Outbound webhook delivery.** Add `POST/GET/DELETE /api/v1/webhooks`. Deliver as POST `application/json` with HMAC-SHA-256 signature in `X-HomeSynapse-Signature`. Exponential backoff (1s/2s/4s/8s/16s), 5 attempts, then dead-letter to `/internal/dlq` with reason `WEBHOOK_DELIVERY_FAILED`. Reject unsigned webhooks even on loopback. **~480 LOC.**

- **REC-68 — RFC 9457 Problem Details everywhere.** Set `Content-Type: application/problem+json` for all 4xx/5xx; register URI scheme `urn:homesynapse:problem:<slug>` documented at `https://homesynapse.dev/problems/<slug>`. Apply identical envelope inside `WsErrorMsg`. Breaking for any 4xx/5xx-handling client — ship behind `Accept`-negotiation initially, switch default in v2. **~140 LOC.**

- **REC-69 — `CaughtUpMsg` transition frame.** Add `CaughtUpMsg(String subscriptionId, long globalPosition, Instant serverTime)` sent exactly once per subscription between historical and live frames. Subscriptions started with `fromGlobalPosition=LATEST` receive it immediately on confirmation. Pure addition. **~80 LOC.**

- **REC-70 — `PingMsg`/`PongMsg` heartbeat.** Server sends application-layer Ping every 30 s if no traffic; closes with 4408 PING_TIMEOUT if no Pong within 10 s. RFC-6455 control-frame pings are insufficient because intermediaries like HAProxy enforce 30 s tunnel timeouts (github.com/home-assistant/frontend/issues/17454). **~110 LOC.**

- **REC-71 — Bcrypt-then-cache (replace per-request bcrypt).** Store `bcrypt(token, cost=10)` at rest; per request compute `SHA-256(presented_token)` and look up in `ConcurrentHashMap<byte[32], CachedIdentity>` with 5-minute TTL. Cost 10 is chosen because cost 12 measures `200.578 ± 25.269 ms/op` on JDK 1.8.0_172 desktop x86 per the patrickfav/bcrypt JMH benchmark (`BcryptBenchmark.benchmarkBcBcryptLog 12 avgt 3 200,578 ± 25,269 ms/op`) and Pi 4's Cortex-A72 runs Blowfish key-schedule several times slower, putting cost 12 in the ~600–700 ms range — incompatible with first-request latency targets. Steady-state validation drops from ~150 ms p99 to ~50 µs p99. Internal; no API change. **~180 LOC.**

- **REC-72 — Codify COALESCED-stage policy.** Transitions: NORMAL → BATCHED at 256 queued frames OR 2 s lag; BATCHED → COALESCED at 1024 frames OR 5 s; COALESCED → close(4429) at 4096 frames OR 30 s. COALESCED semantics: per-entity last-write-wins for `EntityStateChanged` keyed by `entityId`; global drop-oldest for other event types. Memory ceiling: 4096 × ~512 bytes × 20 clients ≈ 40 MiB, well under Pi 4's 4 GB. Internal tuning; client-observable via additional `meta.coalescedCount` field. **~220 LOC.**

- **REC-73 — Signed-URL command via WebSocket.** `{"type":"create_signed_url","path":"/api/v1/entities/cam.front/snapshot","ttlSec":300}` returns a single-use HMAC-signed URL usable without `Authorization` header. **~140 LOC.**

- **REC-74 — CLI-only first-key bootstrap.** `homesynapse-cli bootstrap --owner=email@example.com` emits a one-shot 24 h `ADMIN_KEYS` token printed to stdout (never logged). Token is consumed by a single `POST /api/v1/keys` call. Reject a first-run HTTP wizard per INV-SE-02. **~150 LOC.**

- **REC-75 — Reject mTLS, IP-whitelist trust bypass, wildcard CORS.** Document explicitly that no IP-based trust exemption exists. mTLS rejected for M10 (certificate provisioning impossible for non-expert households, hostile browser UX, equivalent security from Bearer-over-TLS given INV-SE-02). Default CORS allowlist: `[http://localhost:*, http://homesynapse.local:*]`, `allow-credentials=false`. Reject `*`. **~40 LOC.**

**Ranked priority:** REC-63 (read-only API is non-viable) > REC-62 > REC-71 > REC-72 > REC-65 > REC-68 > REC-69 > REC-66 > REC-70 > REC-74 > REC-75 > REC-64 > REC-67 > REC-73.

### Caveats and Open Questions

**Pagination strategy.** Keyset (cursor) pagination is categorically correct for `/api/v1/events` and `/internal/dlq` because the log is append-only with a monotonic global position and clients want sequential scans. Offset+limit is acceptable for `/api/v1/entities` (small, stable collection of typically 50–500 entities). Both shapes use the same `PagedResponse<T>` envelope.

**Framing.** Current JSON text frames are correct. Binary length-prefix framing rejected (WebSocket already frames; ArrayBuffer decode is hostile to browser JS). JSON-Lines rejected (WebSocket text frames are already discrete messages). Optional `permessage-deflate` (RFC 7692) only if Pi 4 benchmarks show CPU headroom — for ~200-byte typical state payloads it is likely a CPU-for-bytes loss.

**Schema endpoint generation.** Build-time annotation processing strongly preferred over runtime reflection. Cortex-A72's 3-way decoder and weak indirect-branch predictor (chipsandcheese.com analysis) make reflection-heavy startup measurably slower than x86. Static asset serving keeps p99 schema-response latency below 5 ms.

### Section 5.4 — MANDATORY Conflict-with-Inventory Disclosure

- **INV-SE-02 (no local trust exception on external interfaces):** REC-66, REC-67, REC-74, REC-75 designed in compliance. REC-74 uses host-OS CLI which is outside the network surface and therefore not in scope of INV-SE-02 — explicitly disclosed as a non-network bootstrap path. No other conflict identified.
- **Existing `PagedResponse<T>`, `ResponseMeta`, `ProblemDetail` records:** REC-62, REC-67, REC-68 reuse these exactly as-specified. No conflict.
- **Existing `WsMessage` sealed hierarchy:** REC-69, REC-70, REC-73 add new permits. Sealed-hierarchy extension requires every existing pattern-match site to handle the new types — counted in effort estimates.
- **`DeliveryMode` enum:** REC-72 changes semantics of `COALESCED` but does not change enum members. Behavioral compat only.
- **`ApiKeyIdentity` record:** REC-66 changes the record signature. **Breaking change for any code that constructs `ApiKeyIdentity` directly** — counted in effort; mitigated by deprecated factory `ApiKeyIdentity.legacy(...)` for one release cycle.
- **Per-key token-bucket rate limit:** REC-66 capability scopes are orthogonal — both apply. No conflict.
- **`fromGlobalPosition` field on `SubscribeMsg`:** REC-69 adds `CaughtUpMsg` boundary marker. Existing field semantics unchanged. No conflict.

### Open Questions for M11

- Should HomeSynapse expose its event store via the EventStoreDB gRPC protocol for tooling compat? Defer until M10 user-research feedback.
- Should the WebSocket negotiate `Sec-WebSocket-Protocol: homesynapse.v1`? Yes — cheap now, painful to retrofit.
- GraphQL alternative read surface? Tentatively no — parsing/planning layer has material Pi 4 CPU cost; minimal benefit over REST + explicit filter params.

### Appendix Sources

- developers.home-assistant.io/docs/api/websocket/
- developers.home-assistant.io/docs/api/rest/
- developers.home-assistant.io/docs/auth_api/
- github.com/home-assistant/core/blob/dev/homeassistant/components/websocket_api/http.py (constants in `const.py`: `MAX_PENDING_MSG=4096`, `PENDING_MSG_PEAK=2048`, `PENDING_MSG_PEAK_TIME=5`; raised from 512 in PR #89611)
- openhab.org/docs/configuration/restdocs.html
- github.com/openhab/openhab-core/issues/1363
- docs-next.eventstore.com/clients/java/catch-up-subscriptions/
- developers.eventstore.com/clients/grpc/subscribing-to-streams/filtering.html
- docs.kurrent.io/http-api/v24.10/introduction
- martendb.io/events/projections/async-daemon
- martendb.io/events/subscriptions
- handbook.buildwithmatter.com/how-it-works/interaction-model/
- developers.home.google.com/matter/primer/interaction-model-reading
- docs2.hubitat.com/en/apps/maker-api
- developer.smartthings.com/docs/getting-started/rate-limits
- developer-preview.smartthings.com/docs/advanced/authorization-and-permissions/
- rfc-editor.org/rfc/rfc9457.html
- datatracker.ietf.org/doc/html/rfc6455
- datatracker.ietf.org/doc/html/rfc5005
- jsonapi.org/format/
- jsonrpc.org/specification
- github.com/patrickfav/bcrypt/wiki/Benchmark
- websockets.readthedocs.io/en/13.0/topics/broadcast.html

## Code-Level Implications

### 7.1 Additional REST endpoints

| Method | Path | Query params | Response | Backing service |
|---|---|---|---|---|
| GET | `/api/v1/events` | `from`, `to`, `entityId`, `eventType`, `eventTypePrefix`, `limit` (def 100, max 1000), `cursor` | `PagedResponse<EventEnvelope>` + `Link:` headers | `EventQueryService.query(EventQuery)` |
| GET | `/api/v1/events/{globalPosition}` | none | `EventEnvelope` or 404 ProblemDetail | `EventQueryService.byPosition(long)` |
| POST | `/api/v1/entities/{id}/invoke` | none | 202 + `meta.commandId` + Location | `CommandDispatcher.dispatch(...)` |
| GET | `/api/v1/commands/{id}` | none | `CommandReceipt` (PENDING/ACCEPTED/COMPLETED/REJECTED/TIMEOUT) | `CommandDispatcher.status(CommandId)` |
| GET | `/api/v1/schema` | `format`=json/openapi | static asset | `SchemaService` (file serving) |
| GET | `/api/v1/openapi.json` | none | OpenAPI 3.1 | `SchemaService` |
| GET/POST/DELETE | `/api/v1/keys[/{id}]` | none | `PagedResponse<ApiKeyDescriptor>` / `ApiKeyCreatedResponse` / 204 | `ApiKeyService` |
| GET/POST/DELETE | `/api/v1/webhooks[/{id}]` | none | `PagedResponse<WebhookDescriptor>` / `WebhookDescriptor` / 204 | `WebhookService` |
| POST | `/internal/projection/{name}/rebuild` | none | 202 + Location | `ProjectionService.rebuild(name)` |
| POST | `/internal/dlq/{id}/retry` | none | 202 | `DlqService.retry(EventId)` |

All non-2xx responses use `application/problem+json`.

### 7.2 `WsSubscriptionFilter` extensions

```java
public record WsSubscriptionFilter(
    List<String> entityIds,            // existing
    List<String> entityIdPrefixes,     // NEW (REC-65)
    List<String> eventTypes,           // existing
    List<String> eventTypePrefixes,    // NEW (REC-65)
    String eventTypeRegex,             // NEW (REC-65) — mutually exclusive with prefixes
    List<String> areaIds,              // existing
    List<String> deviceClasses,        // existing
    Instant fromTimestamp,             // NEW — replay
    Instant toTimestamp,               // NEW
    Long fromGlobalPosition,           // existing
    Long toGlobalPosition,             // NEW
    Set<String> excludeEventTypes,     // NEW
    Integer maxFrameRate               // NEW — per-subscription rate cap
) { }
```

Validation: max 16 entries per list; `eventTypeRegex` mutually exclusive with `eventTypePrefixes`; regex compiled and cached at subscribe time via RE2/J (not `java.util.regex`) — critical to prevent ReDoS on Pi 4.

### 7.3 WebSocket protocol extensions

New `WsMessage` permits: `PingMsg`, `PongMsg`, `CaughtUpMsg`, `ServerHelloMsg` (sent on connect with server version + capabilities), `SignedUrlRequestMsg`, `SignedUrlResultMsg`, `InvokeMsg`, `InvokeResultMsg`.

New `WsCloseCode` values (RFC 6455 §7.4.2 private range): `PROTOCOL_ERROR(4400)`, `AUTH_FAILED(4401)`, `INSUFFICIENT_SCOPE(4403)`, `PING_TIMEOUT(4408)`, `SUBSCRIPTION_CONFLICT(4409)`, `FRAME_TOO_LARGE(4413)`, `CLIENT_TOO_SLOW(4429)` (existing), `SERVER_SHUTDOWN(4503)`.

`DeliveryMode` semantics (REC-72): NORMAL <256 frames; BATCHED 256–1023 (coalesce into 100 ms batches, send as `EventBatchMsg`); COALESCED 1024–4095 (per-entity last-write-wins for `EntityStateChanged`, drop-oldest otherwise); close(4429) at ≥4096 or ≥30 s lag.

### 7.4 Authentication implementation

```sql
CREATE TABLE api_key (
    key_id           TEXT PRIMARY KEY,        -- ULID, "key_01HXYZ..."
    name             TEXT NOT NULL,
    principal        TEXT NOT NULL,
    bcrypt_hash      TEXT NOT NULL,           -- $2a$10$... (cost 10 per REC-71)
    scopes           TEXT NOT NULL,           -- comma-separated capability enum names
    entity_allowlist TEXT,                    -- comma-separated entity-id prefixes; NULL=all
    created_at       INTEGER NOT NULL,
    last_used_at     INTEGER,
    expires_at       INTEGER,                 -- NULL = never (home-server threat model)
    revoked_at       INTEGER                  -- NULL = active
);
```

CLI: `homesynapse-cli bootstrap --owner=email`, `key create --name=NAME --scopes=SCOPES [--entity-prefix=PREFIX]...`, `key list`, `key revoke KEY_ID`, `key rotate KEY_ID`. Long-lived tokens by default (no expiry); cached-hash TTL = 300 seconds. Reject short-lived-with-refresh — no security benefit in home-server threat model.

### 7.5 Rate-limiting and CORS

Token-bucket defaults (per API key): REST 600 req/min burst 60; WebSocket 120 commands/min burst 20; WebSocket inbound 1000 frames/min (DoS protection); subscription creation 30/min (echoing SmartThings guardrail of 40/15min); max 50 concurrent subscriptions per connection, 200 per key. On REST limit: 429 + `Retry-After` + ProblemDetail. On WebSocket limit: `ErrorMsg` with `type=urn:homesynapse:problem:rate-limited`, **do not close** the connection.

CORS defaults: `origins=http://localhost:*,http://homesynapse.local:*`; `allowed-methods=GET,POST,PUT,DELETE,PATCH`; `allowed-headers=Authorization,Content-Type,Accept,If-Match`; `expose-headers=Link,X-Request-Id,X-RateLimit-Remaining`; `max-age=3600`; `allow-credentials=false` (Bearer in `Authorization` header, not cookies).

### 7.6 New event types

Observability-only (dot-namespaced): `homesynapse.api.request.completed`, `homesynapse.api.websocket.connected`, `homesynapse.api.websocket.disconnected`, `homesynapse.api.websocket.delivery_mode_changed`, `homesynapse.api.webhook.delivered`, `homesynapse.api.webhook.failed`.

State-changing: `homesynapse.security.key.created`, `homesynapse.security.key.revoked`, `homesynapse.security.key.rotated`, `homesynapse.api.webhook.registered`, `homesynapse.api.webhook.deleted`.

### 7.7 `module-info.java` impact

```
module homesynapse.api {
    requires homesynapse.core;
    requires homesynapse.events;
    requires homesynapse.security;
    requires java.net.http;
    requires jakarta.servlet;
    requires org.eclipse.jetty.server;
    requires org.eclipse.jetty.websocket.server;
    requires com.fasterxml.jackson.databind;
    requires com.fasterxml.jackson.datatype.jsr310;
    // NEW for Phase 3:
    requires com.google.re2j;          // REC-65: safe regex engine
    requires at.favre.lib.bcrypt;      // REC-71: explicit bcrypt module
    requires io.swagger.v3.core;       // REC-64: OpenAPI generation
    exports homesynapse.api.v1;
    exports homesynapse.api.ws;
    exports homesynapse.api.problem;
}
```

### 7.8 OpenAPI / schema-endpoint deliverable

Build-time annotation processor (`homesynapse-schema-processor`, dev-time only, not on runtime classpath, ~600 LOC) scans `@RestEndpoint(method, path)`, `@EventType(name)`, `@Capability(name)`, `@WsCommand(type)`, and emits `META-INF/homesynapse/schema.json` and `META-INF/homesynapse/openapi.json` at compile time. Runtime serves these as static resources — zero reflection cost, Pi 4 cold start unchanged, p99 schema-response latency < 5 ms. Distribution: also published to `docs.homesynapse.dev/v1/schema.json` for offline SDK generation.

---

**Total amendment LOC budget (REC-62 through REC-75):** approximately **2,910 lines** across handlers, services, DTOs, CLI, migration, annotation processor, and tests. Distribution roughly 65% production code / 35% test code. At 3–5 SLOC/engineer-hour for production smart-home code with comprehensive tests, **~700–1,000 engineer-hours**, i.e. one engineer for 4–6 months or two engineers for ~3 months — consistent with M10 phase scope.