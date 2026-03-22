# HomeSynapse — Locked Technical Decisions Register (v1)

**Document type:** Governance — locked implementation choices
**Status:** Locked
**Scope:** Constrains all implementation decisions across subsystem designs, interface specs, and code
**Applies to:** MVP v1; amendments require the process defined in §18
**Effective date:** 2026-02-22
**Owner:** nick@nexsys.io

---

## 0. Purpose and Authority

This register is the single authoritative source for implementation technology choices. The Architecture Invariants document defines *what properties the system must exhibit*. This register defines *what tools, technologies, and implementation patterns are used to achieve those properties*.

Every subsystem design document references this register by decision number (e.g., "per LTD-06, per-entity sequences with global position"). No subsystem design may contradict a locked decision. If a design requires violating a locked decision, the amendment process in §18 must be followed before the design can proceed.

### 0.1 Decision Structure

Each decision records:

| Field | Purpose |
|---|---|
| **Choice** | The locked decision, stated concisely |
| **Specification** | Concrete, actionable details that constrain implementation |
| **Rationale** | Why this choice, grounded in evidence and project constraints |
| **Invariant alignment** | Which architectural invariants this decision serves |
| **Reversal criteria** | Observable conditions that would indicate this decision was wrong |
| **Confidence** | High, Medium, or Low — signaling how aggressively to monitor the reversal criteria |

### 0.2 Relationship to Other Artifacts

| Artifact | Relationship |
|---|---|
| Architecture Invariants (v1) | Invariants constrain *properties*; this register constrains *implementation*. Both must be satisfied. A decision that serves no invariant is a candidate for removal. |
| Subsystem Design Documents | Designs reference decisions by identifier (LTD-NN) and must demonstrate compliance. |
| Project MVP Document | The MVP §5 table is superseded by this register. This register is authoritative. |
| Research Artifacts | Detailed research backing each decision exists in companion documents. This register contains conclusions, not full analysis. |

---

## 1. Language, Runtime, and Platform

### LTD-01: Java 21 LTS

**Choice:** Java 21 LTS is the implementation language and runtime platform.

**Specification:**

The project uses Java 21 language features: virtual threads (JEP 444), record types (JEP 395), sealed interfaces (JEP 409), pattern matching for switch (JEP 441), and sequenced collections (JEP 431). Source level and target level are both 21. No preview features permitted in production code.

JVM configuration for Constrained tier (Raspberry Pi 5, 4 GB RAM):

```
-Xms512m -Xmx1536m
-XX:+UseG1GC -XX:MaxGCPauseMillis=100
-Xss512k
-XX:CICompilerCount=2
-XX:+UseStringDeduplication
-XX:MetaspaceSize=64m -XX:MaxMetaspaceSize=128m
```

G1GC is the mandated collector. ZGC's colored-pointer overhead (5–15% of heap) is prohibitive at this scale. Shenandoah is an acceptable alternative if G1 pause times prove insufficient, but G1's 50–100 ms pauses are within tolerance for home automation latency budgets.

Thread stack size reduction from ARM64's 2 MB default to 512 KB is mandatory. JIT compiler threads limited to 2 on 4-core hardware. AppCDS (Application Class Data Sharing) should be enabled for startup optimization (40–50% reduction documented).

**Rationale:** Virtual threads are the decisive advantage — each consumes ~1 KB vs platform threads' 2 MB, enabling 500 concurrent device connections for ~500 KB rather than ~1 GB. Java 21's ARM64 JIT is mature (AArch64 leverages 31 general-purpose registers; crypto intrinsics deliver 3.5–5× speedups for TLS). Records, sealed interfaces, and pattern matching enable algebraic data types for protocol modeling. The JVM's steady-state JIT optimization outweighs Go's lower idle memory (~20–50 MB vs Java's ~300–800 MB) on a 4 GB system running for years. Java's IoT library ecosystem (Zigbee, Z-Wave, MQTT bindings) is substantially more mature than alternatives.

**Invariant alignment:** INV-PR-01 (constrained hardware as primary target), INV-PR-02 (quantitative performance targets — G1GC pauses within latency budgets), INV-PR-03 (bounded and predictable resource usage via -Xmx).

**Reversal criteria:** If steady-state RSS consistently exceeds 2.5 GB (leaving <1.5 GB for OS + peripherals), or if GC pauses exceed 500 ms under normal load. If steady-state carrier thread utilization exceeds 75% due to JNI pinning from third-party libraries (primarily sqlite-jdbc) despite the platform thread executor mitigation pattern, indicating that the virtual thread model provides insufficient benefit to justify its complexity. Note: JEP 491 (Java 25 LTS) eliminates `synchronized`-monitor pinning but does NOT eliminate JNI pinning. sqlite-jdbc's `synchronized native` methods cause carrier pinning via both mechanisms on Java 21, and via JNI alone on Java 25+. The platform thread executor pattern (see LTD-03, LTD-11) is required on ALL Java versions.

**Confidence:** High.

---

### LTD-02: Raspberry Pi 5 Recommended, Pi 4 as Validation Floor

**Choice:** Raspberry Pi 5 (4–8 GB) is the recommended deployment target. Raspberry Pi 4 (4 GB) is the validation floor. NVMe storage via M.2 HAT is a production requirement.

**Specification:**

All subsystem designs must be benchmarked and tested against Pi 4 class hardware. Performance that is acceptable on x86 but degraded on Pi 4 is a bug, not a deployment recommendation.

Recommended deployment configuration:
- Raspberry Pi 5 (4 GB minimum, 8 GB recommended)
- NVMe SSD via M.2 HAT+ ($12) or Pimoroni NVMe Base ($14, preserves GPIO)
- Active cooling (mandatory — without it, Pi 5 throttles to Pi 4 speeds within 3 minutes under sustained JVM load)
- Official 27W USB-C PSU

SD card storage is not supported for production. SD cards deliver ~800–900 random write IOPS vs NVMe's ~29,000 — the event store and SQLite persistence require NVMe-class I/O. SD card endurance under continuous database writes will degrade within months.

Intel N100 mini-PCs ($120–160, 8–16 GB RAM, native NVMe) are documented as an alternative platform offering 2–3× better JVM throughput, at the cost of no GPIO (USB dongles required for all radios) and 3–5× higher power consumption.

**Rationale:** Pi 5 delivers 2.2–2.4× single-core gains over Pi 4 (Cortex-A76 vs A72), with 5–7× memory bandwidth improvement (30,000 MB/s vs 4,000–6,000 MB/s) — the most impactful factor for JVM workloads since GC performance is directly tied to memory throughput. NVMe transforms SQLite performance by ~100× over SD cards. The Pi 5 + NVMe + active cooler + PSU costs ~$130 total.

**Invariant alignment:** INV-PR-01 (constrained hardware is the primary design target), INV-CS-07 (no forced hardware obsolescence — Pi 4 remains the floor).

**Reversal criteria:** If Pi 5 8 GB exceeds $180 and stays there for 6+ months, formally add Intel N100 as a co-recommended platform. If Pi 4 support becomes a persistent engineering burden (requiring special code paths or degraded features), evaluate raising the floor to Pi 5 only.

**Confidence:** Medium (hardware pricing volatile due to LPDDR4 memory crisis; Pi 5 4 GB currently $85, up from $60 MSRP).

---

## 2. Persistence and Data

### LTD-03: SQLite as Default Persistence Engine

**Choice:** SQLite in WAL mode is the default persistence engine for the event store, state store, and all system metadata. The storage backend is pluggable via an `EventStore` interface.

**Specification:**

SQLite PRAGMA configuration for production:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -128000;         -- 128 MB page cache
PRAGMA mmap_size = 1073741824;       -- 1 GB mmap
PRAGMA temp_store = MEMORY;
PRAGMA journal_size_limit = 6144000; -- cap WAL at 6 MB
PRAGMA busy_timeout = 5000;
```

WAL mode enables single-writer + unlimited-reader concurrency — architecturally ideal for event sourcing. `synchronous=NORMAL` in WAL mode avoids fsync per commit while maintaining crash safety (data loss window limited to the last WAL page, not the entire transaction).

The JDBC driver is `org.xerial:sqlite-jdbc` (bundles native libraries for ARM64 and x86_64).

**Virtual thread constraint.** Every method in xerial sqlite-jdbc's `NativeDB.java` is declared `synchronized native`. This is a worst-case double-pinning pattern for Java 21 virtual threads: the virtual thread is pinned by both the monitor entry and the JNI native call. With 4 carrier threads on RPi 5, as few as 4 concurrent sqlite-jdbc operations can exhaust the carrier pool. JEP 491 (Java 25) eliminates the `synchronized` pinning but JNI pinning persists across all Java versions — it is inherent to how native methods interact with the virtual thread scheduler.

**Mandatory mitigation.** All sqlite-jdbc operations — reads and writes — must be submitted to a bounded platform thread executor (`Executors.newFixedThreadPool(N)`), not executed directly on virtual threads. Virtual threads submit database work via `CompletableFuture.supplyAsync(dbCall, dbExecutor)` and await the result. This confines all carrier pinning to dedicated platform threads, keeping the virtual thread carrier pool free. Executor sizing: 1 thread for the write connection (single-writer model), 2–3 threads for read connections (matching WAL concurrent reader capacity under load). The executor is owned by the Persistence Layer and exposed to other subsystems through the `EventStore` and `StateStore` interfaces — callers never interact with sqlite-jdbc directly.

This pattern mirrors the platform thread isolation already designed for jSerialComm in Integration Runtime §3.2. The principle is the same: JNI native calls pin carrier threads; dedicated platform threads prevent starvation.

Performance baseline on Pi 5 with NVMe: 10,000–50,000 inserts/sec — orders of magnitude beyond HomeSynapse's requirements (~100 events/sec sustained).

**Rationale:** Zero-configuration, single-file database. ~1 MB library footprint. Widely deployed on embedded systems. The single-writer model is not a limitation for a single-process event-sourced system — it is a simplification. The `EventStore` interface abstraction allows H2 or PostgreSQL for advanced users or future Enhanced-tier deployments without changing application code.

**Invariant alignment:** INV-RF-04 (crash safety via WAL), INV-RF-05 (bounded storage via retention policies), INV-PR-01 (minimal resource footprint), INV-CE-02 (zero-configuration first run — no database server to install).

**Reversal criteria:** If write latency exceeds 10 ms p99 under normal load, or if WAL checkpoint spikes exceed 1 second and cannot be tuned away. If database exceeds 50 GB and query performance degrades despite indexing, evaluate archival strategies or PostgreSQL migration.

**Confidence:** High.

---

### LTD-04: ULID for Event and Entity Identity

**Choice:** ULID (Universally Unique Lexicographically Sortable Identifier) with monotonic generation for all event and entity identifiers.

**Specification:**

Library: Hand-rolled `UlidFactory` in `platform-api` — `UlidFactory.monotonic()` for event IDs (preserves ordering within millisecond), `UlidFactory.generate()` for entity IDs where monotonicity is unnecessary. The implementation uses `ReentrantLock` (not `synchronized`) for virtual thread safety per LTD-01/LTD-11. **Amendment (2026-03-20, DECIDE-02):** Originally specified `com.github.f4b6a3:ulid-creator`. Replaced with hand-rolled implementation because `ulid-creator` uses `synchronized` internally, which pins carrier threads under Java 21 virtual thread scheduling. The hand-rolled `UlidFactory` is functionally equivalent (monotonic generation, `SecureRandom`-backed randomness) and VT-safe by construction.

Storage: BLOB(16) in SQLite. Convert to 26-character Crockford Base32 string representation only at API boundaries and in log output. SQLite indexes on BLOB(16) use the same byte-comparison as textual ULID ordering, preserving sort efficiency.

Java representation: a shared `Ulid` value type wraps the 128-bit value and handles Crockford Base32 encoding/decoding, `Comparable` ordering, and `toBytes()` / `fromBytes()` conversion. Typed wrappers per addressable-object kind — `EntityId`, `DeviceId`, `AreaId`, `AutomationId`, `PersonId`, `HomeId`, `EventId` — wrap `Ulid` and provide compile-time discrimination. This prevents the most common identifier bug class: passing a ULID of the wrong object kind (e.g., a `DeviceId` where an `EntityId` is expected) where both are valid 128-bit values indistinguishable at the byte level. The `_id` / `_ref` suffix distinction (see Identity and Addressing Model §2.1) is a wire-format naming convention, not a type distinction; both `entity_id` and `entity_ref` map to `EntityId` in Java. Concrete type definitions are specified in Phase 2 interface documents.

UUIDv7 (RFC 9562, ratified May 2024) is documented as an equally valid alternative. The binary representations are the same size (128 bits). If the team encounters friction from ULID's non-IETF status or needs native UUID ecosystem compatibility (e.g., PostgreSQL migration), UUIDv7 migration is straightforward — both are time-ordered 128-bit identifiers stored as BLOB(16).

**Rationale:** Compact 26-character encoding aids debugging and log readability (vs UUID's 36 characters). ULID's 80 random bits provide marginally better collision resistance than UUIDv7's 74. The ULID spec defines an explicit monotonic mode essential for event sourcing; RFC 9562 makes monotonicity optional and implementation-dependent. The hand-rolled `UlidFactory` eliminates a third-party dependency and provides virtual-thread-safe generation by design.

**Invariant alignment:** INV-CS-02 (entity identifiers are stable — ULIDs are generated once and never change), INV-ES-03 (per-entity ordering — monotonic ULIDs within entity streams maintain sort order).

**Reversal criteria:** If Java's standard library adds UUIDv7 support (expected JDK 26+) and the third-party ULID library feels like unnecessary dependency weight. If integration with UUID-native systems becomes a recurring friction point.

**Confidence:** Medium (UUIDv7's IETF standardization gives it a long-term edge; the choice is defensible either way).

---

### LTD-05: Per-Entity Sequences with Global Position

**Choice:** Per-entity sequence numbers for optimistic concurrency, plus SQLite's auto-incrementing rowid as a global position for cross-entity subscriptions.

**Specification:**

Every event carries two ordering fields:

| Field | Type | Purpose |
|---|---|---|
| `subject_sequence` | Monotonically increasing integer per subject | Optimistic concurrency: `(subject_ref, subject_sequence)` is a unique constraint. A write with a sequence number that already exists is a conflict. Subjects include entities, devices, automations, persons, and system components (see Identity and Addressing Model §9, Event Model §4.2). Originally named `entitySequence`; renamed to reflect the broader subject scope. |
| `global_position` | SQLite `INTEGER PRIMARY KEY` (rowid) | Cross-subject ordering: subscribers checkpoint against this value. "Give me all events after position X" is efficient and unambiguous. |

Every event also carries Correlation ID and Causation ID fields (Greg Young's pattern):

| Field | Purpose |
|---|---|
| `correlationId` | Traces the entire causal conversation (e.g., a user pressing a button through all downstream effects) |
| `causationId` | The immediate cause — the event ID of the event that triggered this one |

The `global_position` is a serialization point, but since HomeSynapse uses a single-writer model (LTD-03), this is not a contention issue. Subscribers must tolerate gaps in the `global_position` sequence (caused by rolled-back transactions).

**Rationale:** Per-entity sequences are the universal standard for aggregate consistency in event-sourced systems (EventStoreDB, Axon Framework, Marten all use them). Pure per-entity sequences without global ordering create a real limitation: cross-entity projections (e.g., "show me all events after position X") require either a global sequence or timestamp-based approximation. SQLite's rowid provides a zero-overhead global position that matches Marten's proven dual-sequence architecture.

**Invariant alignment:** INV-ES-03 (per-entity ordering with causal consistency), INV-ES-06 (every state change is explainable — correlation/causation IDs enable full causal tracing), INV-TO-04 (structured, queryable logs — correlation IDs link events to log entries).

**Reversal criteria:** If the system requires horizontal write scaling across multiple processes, the single-writer global sequence becomes a bottleneck. At that point, transition to per-partition ordering (e.g., Kafka partitioned by entity ID).

**Confidence:** High.

**Naming note.** The field is named `subject_sequence` (not `entity_sequence`) because the per-subject ordering mechanism applies to all addressable object types — Entities, Devices, Automations, Persons, and System components — not exclusively to Entities. The decision title retains "per-entity" as a shorthand for the dominant use case. All design documents, schemas, and implementations use `subject_sequence` as the canonical field name. See Identity and Addressing Model §9 for uniqueness scope semantics.

---

### LTD-06: Write-Ahead Persistence with At-Least-Once Delivery

**Choice:** Events are persisted to SQLite before delivery to any subscriber. Subscribers process events at-least-once and must be idempotent. The event store IS the outbox.

**Specification:**

Write path: command handler validates → event created → event persisted to SQLite → event dispatched to in-process subscribers. The persist step is durable (WAL + `synchronous=NORMAL`) before any subscriber sees the event.

Each subscriber maintains a `last_processed_position` checkpoint (the global position from LTD-05). On restart, subscribers replay from their checkpoint. The checkpoint is stored in the same SQLite database as the event store.

Idempotency strategy:
- Single-entity projections: store `last_processed_version` per entity; check `event.subject_sequence > stored_version` before processing
- Cross-entity projections: use global position checkpoints
- External integrations: event-ID deduplication table with TTL-based pruning
- Same-database projections: wrap projection update + checkpoint update in a single SQLite transaction for exactly-once semantics

**Rationale:** The architectural insight (validated by Eventuous, EventStoreDB, Axon) is that in an event-sourced system, events are already durably persisted before dispatch — there is no two-phase commit problem. Subscribing directly to the event store eliminates dual-write consistency issues and provides natural replay capability. At-least-once is simpler than exactly-once and safe because the event log is the recovery mechanism.

**Invariant alignment:** INV-ES-04 (write-ahead persistence), INV-ES-05 (at-least-once delivery with subscriber idempotency), INV-RF-04 (crash safety — checkpoint replay on restart).

**Reversal criteria:** If at-least-once semantics prove insufficient (e.g., external integrations cannot tolerate duplicate processing and idempotency is too complex), evaluate adding a lightweight transactional outbox relay or an embedded NATS server.

**Confidence:** High.

---

### LTD-07: Forward-Only SQL Migrations with Mandatory Backup

**Choice:** Hand-rolled, forward-only SQL migrations with mandatory pre-migration database backup. No Flyway or Liquibase in MVP.

**Specification:**

Migration file naming convention (Flyway-compatible for potential future adoption):

```
src/main/resources/db/migration/
  V001__initial_event_store_schema.sql
  V002__add_device_capabilities.sql
  V003__add_subscriber_checkpoints.sql
```

Schema version tracking table:

```sql
CREATE TABLE hs_schema_version (
    version     INTEGER PRIMARY KEY,
    checksum    TEXT NOT NULL,        -- SHA-256 of migration SQL file
    description TEXT NOT NULL,
    applied_at  TEXT NOT NULL,        -- ISO 8601
    success     INTEGER NOT NULL DEFAULT 1
);
```

Migration runner behavior:
1. Read current schema version from `hs_schema_version`
2. Identify pending migrations (version > current)
3. For each pending migration: compute SHA-256 checksum, compare against stored checksum if previously attempted, execute SQL statements, record version + checksum + timestamp
4. If any migration fails: log the error, record the failure, halt. Recovery is via the pre-upgrade snapshot (LTD-12)

The migration runner refuses to execute unless invoked through the upgrade workflow (LTD-12), which guarantees a database backup exists. This is enforced via a runtime flag, not convention.

Migration design rules:
- One logical change per migration file
- Idempotent where possible (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)
- Destructive operations require a preceding migration that verifies data migration
- Data migrations are separate files from schema migrations
- Every migration is tested against a database at the prior version with representative data

**Rationale:** SQLite does not support transactional DDL rollback. A migration that fails partway through leaves the database in an indeterminate state. Flyway's response to this is to mark the migration "failed" and halt, requiring manual intervention. Our backup-before-migrate strategy handles recovery at the system level (restore the snapshot), making migration-level undo unnecessary and unreliable. The hand-rolled runner is ~150 lines of code, fully understood, and enforces the mandatory-backup invariant as a first-class feature rather than a callback hook. Flyway Community Edition solves problems we do not have (multi-database support, team coordination on migration ordering) without solving the one we do have (safe recovery from partially-applied DDL on SQLite).

The Flyway-compatible naming convention preserves the option to adopt Flyway later if the project scales beyond what the hand-rolled runner comfortably handles (the threshold is ~200 lines of migration runner code).

**Invariant alignment:** INV-CE-06 (migration tooling accompanies schema evolution), INV-CS-05 (update safety — backup-before-migrate is mandatory), INV-RF-04 (crash safety — snapshot provides recovery if power is lost mid-migration).

**Reversal criteria:** If the hand-rolled runner exceeds 200 lines of code, or if HomeSynapse adds a second persistence backend (e.g., PostgreSQL) where Flyway's multi-database support has genuine value. If migration failures in production require more sophisticated recovery than snapshot restore.

**Confidence:** Medium (hand-rolled is defensible but unconventional; the Flyway-compatible naming is deliberate insurance).

---

## 3. Serialization and Configuration

### LTD-08: Jackson JSON for All Serialization

**Choice:** Jackson (2.18.x–2.20.x line) with the Blackbird performance module for all serialization: event persistence, API request/response, WebSocket messages, and configuration internal representation.

**Specification:**

Singleton `ObjectMapper` (mandatory — per-request instances cause massive GC pressure):
```java
public static final ObjectMapper MAPPER = JsonMapper.builder()
    .addModule(new BlackbirdModule())
    .addModule(new JavaTimeModule())
    .propertyNamingStrategy(PropertyNamingStrategy.SNAKE_CASE)
    .disable(SerializationFeature.INDENT_OUTPUT)
    .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
    .build();
```

**Startup warm-up (mandatory).** Before virtual threads begin processing events, warm up the ObjectMapper by pre-serializing and pre-deserializing every registered event type and API response type. This populates the SerializerCache and DeserializerCache, ensuring the `synchronized` cache-miss write path is never entered under concurrent virtual thread load. The warm-up step is part of the startup sequence (Doc 12, Phase 3 — Core Services Init or Phase 4 — Event Processing Init). After warm-up, Jackson's hot read path uses unsynchronized snapshots and is fully virtual-thread-safe.

The `SNAKE_CASE` naming strategy bridges Java naming conventions to the wire format globally. Java domain types use standard `camelCase` field names (`entityRef`, `homeId`, `globalPosition`); Jackson maps them to the `snake_case` API tokens defined in the Glossary (`entity_ref`, `home_id`, `global_position`) without per-field annotation. Explicit `@JsonProperty` annotations are reserved for edge cases where automatic mapping is insufficient. This same `camelCase`-in-Java, `snake_case`-on-wire convention applies to YAML configuration deserialization: when SnakeYAML Engine maps are converted to domain objects, the mapping code uses `camelCase` Java field names regardless of the `snake_case` YAML keys.

Pre-build `ObjectReader`/`ObjectWriter` for hot-path types (event envelopes, device state). Use `byte[]` or stream-based I/O, not `String` — Jackson is optimized for byte-level processing.

The `EventSerializer` abstraction boundary isolates the serialization format choice. All event persistence goes through this interface, enabling a future binary format (Protobuf, Avro, MessagePack) without changing any consumer code.

Jackson 3.0 (shipped October 2025, JDK 17+ baseline) offers native sealed-class subtype auto-detection but is not designated LTS. The 2.x line is the stable choice for production. Evaluate Jackson 3.x when it receives LTS designation.

**Rationale:** Jackson's sealed-interface support (2.18+) and record support enable type-safe event serialization without annotation boilerplate. Blackbird module provides 10–20% throughput improvement via `LambdaMetafactory` (no byte-code generation). For ~500-byte event envelopes, Jackson + Blackbird delivers an estimated 50,000–150,000 ops/sec on Pi 5. Human-readable JSON events support the transparency principle (INV-TO-01) and are debuggable with standard tools (jq, any text editor). The `EventSerializer` abstraction keeps the door open for binary formats without paying their complexity cost today.

**Invariant alignment:** INV-ES-07 (event schema evolution — Jackson's `FAIL_ON_UNKNOWN_PROPERTIES=false` enables forward-compatible deserialization), INV-TO-01 (observable — human-readable event format), INV-PR-01 (constrained hardware — Blackbird avoids reflection overhead).

**Reversal criteria:** If serialization becomes a measurable bottleneck (>5% of CPU under normal load), evaluate DSL-JSON for the event envelope hot path while keeping Jackson for everything else. If GC pressure from Jackson dominates pause-time budgets, profile allocation sources with JFR.

**Confidence:** High.

---

### LTD-09: YAML 1.2 for User-Facing Configuration

**Choice:** YAML 1.2 (strictly enforced) for all user-facing configuration files. JSON Schema for validation. SnakeYAML Engine for parsing.

**Specification:**

Parser: `org.snakeyaml:snakeyaml-engine:2.9+` (YAML 1.2 compliant, Java 11+, secure by default). This is not the standard `jackson-dataformat-yaml` module, which uses SnakeYAML (YAML 1.1) and does NOT solve the Norway problem (`NO` silently becomes `false`).

SnakeYAML Engine returns Maps/Lists (not JavaBeans), requiring explicit mapping code to domain objects. This is the correct tradeoff — it avoids YAML 1.1's implicit type coercion while maintaining full parsing control.

Validation: `networknt:json-schema-validator` validates parsed YAML against published JSON Schema definitions. Every configuration file has a corresponding JSON Schema. A `homesynapse validate-config` CLI command validates configuration before the system starts.

Published JSON Schema files enable VS Code auto-completion via the Red Hat YAML extension — a significant developer-experience improvement.

Configuration files live in `/etc/homesynapse/` (per LTD-13). All configuration is human-readable, version-controllable (diffable, mergeable, suitable for Git), and the sole source of truth (INV-CE-01).

**Rationale:** Smart home configuration is deeply hierarchical (rooms → devices → settings → automations), which suits YAML's nesting model. Comments are essential for user-facing config (ruling out JSON). YAML is familiar to smart home enthusiasts from Home Assistant exposure. TOML's flat `[section.subsection]` syntax is unwieldy at the nesting depth smart home configs require. The YAML 1.2 mandate is a direct lesson from Home Assistant's well-documented pain: device states like "on"/"off", country codes like "NO", and boolean-like strings silently converting to `true`/`false` under YAML 1.1.

**Invariant alignment:** INV-CE-01 (canonical, human-readable configuration), INV-CE-03 (configuration schema is documented and versioned), INV-CS-03 (configuration schema stability — JSON Schema provides the contract).

**Reversal criteria:** If user support tickets about configuration errors exceed 30% of total support volume, prioritize a UI-based configuration editor and relegate YAML to import/export/advanced mode. If SnakeYAML Engine's lower-level API proves too burdensome, evaluate writing a thin jackson-dataformat-yaml adapter backed by SnakeYAML Engine.

**Confidence:** Medium (YAML 1.2 enforcement is essential; the SnakeYAML Engine integration has some ecosystem friction).

---

## 4. Build and Project Structure

### LTD-10: Gradle with Kotlin DSL, Multi-Module Project

**Choice:** Gradle with Kotlin DSL, version catalogs, and convention plugins in an included build.

**Specification:**

Project structure uses convention plugins in `build-logic/` (included build, not buildSrc — changes to build logic only invalidate affected projects, not the entire build cache).

Dependency management via version catalogs (`gradle/libs.versions.toml`), with the `java-platform` plugin for strict version enforcement.

Module dependency enforcement via `modules-graph-assert` Gradle plugin — enforces regex-based rules on allowed/forbidden dependency directions as a CI check. ArchUnit provides code-level architecture tests (e.g., integration modules cannot import core-internal packages).

Builds run on development machines, not on Pi hardware. Gradle's daemon requires 512 MB–2 GB heap; the Kotlin compiler daemon spawns a separate JVM. On a 4 GB Pi, this leaves no room for the OS. Deploy JARs (or the jlink distribution) to Pi via `installDist` or the distribution packaging task.

**Rationale:** Gradle delivers 2–3× faster clean builds and 7–85× faster incremental builds vs Maven. Kotlin DSL is the Gradle default since 8.0 and provides IDE auto-completion, type checking, and refactoring support. Convention plugins extract shared build logic (Java version, test configuration, dependency constraints) into reusable units. Version catalogs centralize dependency versions without enforcing them — the `java-platform` plugin alongside catalogs provides strict enforcement.

**Invariant alignment:** INV-RF-01 (integration isolation — Gradle module boundaries enforce the integration/core separation at build time), INV-CS-04 (integration API stability — the `integration-api` module's public surface is the API contract).

**Reversal criteria:** If the team consistently struggles with Gradle's complexity and build-logic debugging overhead exceeds development productivity gains. This is a team-skill risk, not a technical one.

**Confidence:** High.

---

## 5. Event Bus and Protocol Architecture

### LTD-11: No External Message Broker

**Choice:** In-process event bus using Java 21 virtual threads. No Kafka, RabbitMQ, NATS, or any external broker dependency.

**Specification:**

The event bus is a thin dispatch layer: a `ConcurrentHashMap` of subscriber lists, dispatched via virtual thread executors. This is ~50 lines of code with zero external dependencies.

Each subscriber runs in its own virtual thread. Subscribers that perform SQLite operations (EventStore reads, EventPublisher writes, checkpoint writes) route those operations through the Persistence Layer's platform thread executor (LTD-03). The subscriber's virtual thread parks while the platform thread executes the JNI call, then resumes when the result is available. This prevents database-writing subscribers from pinning carrier threads. A slow subscriber does not block the event store or other subscribers because: (a) the platform thread executor serializes database access without consuming carrier threads, and (b) each subscriber pulls events independently from its own checkpoint. If a subscriber falls behind, it catches up by reading directly from the event store (the Axon `EmbeddedEventStore` pattern).

The `EventPublisher` interface in the domain layer abstracts the dispatch mechanism. The MVP implements `InProcessEventPublisher`. When multi-process scaling is needed (post-MVP), implement `NatsEventPublisher` or equivalent behind the same interface, keeping in-process dispatch for same-JVM projections.

Per-subscriber bounded queues (`ArrayBlockingQueue(1000)`) provide ~10 seconds of buffer at 100 events/sec if backpressure is needed.

**Rationale:** Authoritative sources (Eventuous, CodeOpinion, Axon documentation) argue that using an external broker for internal event dispatch in event-sourced systems is an anti-pattern. The event store is the durable log; subscribers read from it directly. At 100 events/sec with 20 subscribers (2,000 handler invocations/sec), in-process dispatch is three orders of magnitude below the threshold where it becomes a concern. An external broker adds operational complexity (configuration, monitoring, failure modes, memory overhead) with no benefit at this scale.

**Invariant alignment:** INV-PR-01 (constrained hardware — no additional process or memory overhead), INV-CE-02 (zero-configuration first run — no broker to install or configure), INV-RF-06 (graceful degradation — fewer moving parts means fewer failure modes).

**Reversal criteria:** If HomeSynapse needs to support multiple JVM processes on different devices (multi-instance deployment), or if external services need real-time event feeds that cannot be served via WebSocket API. First step: embedded NATS (~20 MB RAM, single binary), not Kafka or RabbitMQ.

**Confidence:** High.

---

### LTD-12: Zigbee as First Protocol

**Choice:** Zigbee is the sole protocol adapter in MVP. No Z-Wave, Matter, Wi-Fi, or Bluetooth adapters in initial release.

**Specification:**

The Zigbee adapter exercises the full integration runtime: device discovery, pairing, state reporting, command dispatch, mesh health monitoring. The adapter communicates via USB dongle (supporting common coordinators: Texas Instruments CC2652, Silicon Labs EFR32).

The device model, capability system, and integration runtime are designed for multiple simultaneous protocol adapters from day one (INV-CE-04), but only Zigbee ships in MVP. Entity identity is protocol-agnostic — a device's `entityId` does not embed the protocol. The protocol is metadata, not identity.

**Rationale:** Zigbee is the most widely deployed local mesh protocol, covering lights, switches, sensors, locks, and energy monitors. A single protocol exercises the integration runtime thoroughly while keeping scope manageable. Z-Wave is the natural second adapter (different radio, different mesh topology, different security model) and will validate the protocol-agnostic device model.

**Invariant alignment:** INV-CE-04 (protocol agnosticism — the device model is protocol-independent from day one), INV-CE-05 (extension model — the Zigbee adapter is built against the same Integration API that community adapters will use).

**Reversal criteria:** If Zigbee coordinator hardware availability becomes a problem, or if Matter adoption reaches a point where Zigbee-first is a market positioning liability.

**Confidence:** High.

---

## 6. Deployment and Operations

### LTD-13: Self-Contained Distribution via jlink, Managed by systemd

**Choice:** HomeSynapse ships as a self-contained directory produced by `jlink` containing a custom Java runtime, application JARs, and launcher script. The process is managed by a systemd service unit.

**Specification:**

**jlink custom runtime.** The distribution bundles only the JDK modules HomeSynapse requires: `java.base`, `java.sql`, `java.net.http`, `java.logging`, `jdk.httpserver`, `jdk.jfr`, `jdk.crypto.ec`, `java.management`, and any modules required by dependencies. Expected size: 70–90 MB (vs ~313 MB for a full JDK). The result is a `/opt/homesynapse/` directory containing `bin/homesynapse` (launcher script), `lib/` (JDK modules + application JARs), and `conf/` (default configuration templates).

If jlink module resolution proves intractable during early development (non-modular dependencies causing build failures), a bundled JRE tarball (Adoptium) is an acceptable interim approach providing the same self-containment guarantee. The distribution must never require the user to install a JRE separately.

**Directory layout (FHS-compliant):**

| Path | Purpose | Owner | Mode |
|---|---|---|---|
| `/opt/homesynapse/` | Runtime image (read-only) | root:homesynapse | 755 |
| `/etc/homesynapse/` | Configuration files (YAML) | homesynapse:homesynapse | 750 |
| `/var/lib/homesynapse/` | Persistent data (SQLite DBs, event log) | homesynapse:homesynapse | 750 |
| `/var/lib/homesynapse/backups/` | Pre-update snapshots | homesynapse:homesynapse | 750 |
| `/var/log/homesynapse/` | Log files, JFR recordings | homesynapse:homesynapse | 750 |

**Dedicated service user:** `homesynapse` (system user, no login shell, no home directory). The service never runs as root.

**systemd service unit:**

```ini
[Unit]
Description=HomeSynapse Smart Home Platform
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
User=homesynapse
Group=homesynapse
WorkingDirectory=/var/lib/homesynapse
ExecStart=/opt/homesynapse/bin/homesynapse
Restart=on-failure
RestartSec=10
WatchdogSec=60

MemoryMax=2G
MemoryHigh=1536M
CPUWeight=80

ProtectSystem=strict
ReadWritePaths=/var/lib/homesynapse /var/log/homesynapse /etc/homesynapse
PrivateTmp=true
NoNewPrivileges=true
ProtectHome=true

DeviceAllow=/dev/ttyUSB0 rw
DeviceAllow=/dev/ttyACM0 rw

[Install]
WantedBy=multi-user.target
```

Key properties: `WatchdogSec=60` triggers restart if the process stops sending heartbeats (HomeSynapse must call `sd_notify(WATCHDOG=1)` periodically). `ProtectSystem=strict` makes the filesystem read-only except for explicitly listed paths. `MemoryMax=2G` provides a hard ceiling complementing JVM `-Xmx`. `Restart=on-failure` with `RestartSec=10` provides automatic crash recovery.

**Rationale:** A self-contained distribution eliminates the "which Java version?" support question entirely. Every user runs the exact same JVM. jlink reduces the distribution size by ~75% vs a full JDK bundle, improves startup time (less to load), and reduces attack surface. systemd is native to Raspberry Pi OS (Debian-based) and provides process supervision, resource limits, filesystem isolation, and watchdog monitoring without additional dependencies.

**Invariant alignment:** INV-RF-04 (crash safety — systemd `Restart=on-failure` provides automatic recovery), INV-PR-01 (constrained hardware — jlink eliminates ~200 MB of unused JDK modules; `MemoryMax` prevents OS destabilization), INV-PR-03 (bounded resource usage — systemd cgroups enforce limits), INV-PD-08 (tamper-evident integrity — `/opt/homesynapse/` is read-only at filesystem level), INV-SE-01 (no default credentials — dedicated unprivileged service user).

**Reversal criteria:** If jlink module resolution is a persistent maintenance burden (>2 hours per release), fall back to bundled JRE. If the target audience shifts toward container-based deployment (Docker on NAS hardware), evaluate container image distribution alongside systemd.

**Confidence:** High.

---

### LTD-14: CLI-Driven Upgrade with Mandatory Pre-Upgrade Snapshot

**Choice:** Updates are user-initiated via CLI. Every upgrade creates a mandatory pre-upgrade snapshot. Rollback restores the snapshot. No automatic updates.

**Specification:**

**No auto-update.** HomeSynapse never modifies itself without explicit user action. This is a privacy and trust decision (INV-PD-01, INV-LF-01) as much as a technical one.

**Upgrade sequence:**

1. `homesynapse upgrade --package <path-to-distribution.tar.gz>`
2. Verify package cryptographic signature (INV-PD-08)
3. Extract to temporary directory
4. Execute `homesynapse migrate --dry-run` against a **copy** of the database using the new version's migration scripts
5. If dry-run fails: report errors, abort, system untouched
6. If dry-run succeeds: create snapshot in `/var/lib/homesynapse/backups/<timestamp>/`
7. Stop service
8. Replace runtime files in `/opt/homesynapse/`
9. Execute database migration against production database
10. Start service
11. Execute post-start health check (event bus responsive, state store loaded, API accepting requests)
12. If health check fails: automatic rollback to snapshot

**Snapshot contents:**

| Component | Method | Restore |
|-----------|--------|---------|
| SQLite databases | `VACUUM INTO` (consistent copy without stopping service) | File replace |
| Configuration files | File copy of `/etc/homesynapse/` | File restore |
| Runtime version marker | Version string in snapshot metadata | Selects correct binary on rollback |
| Event log position | Global position recorded in snapshot metadata | Events ingested after snapshot are lost on rollback |

**Rollback = restore the pre-update state.** Events ingested between upgrade and rollback are lost. This is acceptable: the window is typically seconds to minutes, device state re-syncs from physical devices, and the alternative (maintaining backward-compatible event readers across schema versions) is unbounded complexity.

**Snapshot retention:** Last 3 snapshots retained. Older snapshots pruned automatically. Users can create manual snapshots via `homesynapse snapshot create`.

**Rationale:** Home Assistant's community forums consistently identify update-related breakage as the largest source of user frustration. Database migration failures, integration incompatibilities, and the difficulty of rolling back are recurring complaints. The mandatory snapshot + dry-run validation + automated rollback-on-failure directly addresses every aspect of this pain. SQLite makes snapshots cheap — `VACUUM INTO` copies a 500 MB database in under a second on NVMe.

**Invariant alignment:** INV-CS-05 (update safety — pre-update snapshot, documented rollback, dry-run validation), INV-RF-04 (crash safety — if power is lost during upgrade, the snapshot enables recovery), INV-PD-08 (tamper-evident integrity — package signature verification before modification).

**Reversal criteria:** If user research shows CLI-based upgrades are a significant adoption barrier (>20% of target users cannot complete the process), invest in a web UI upgrade flow wrapping the same CLI commands. If the smart home market shifts toward managed-OS deployment (like HAOS), evaluate A/B partition schemes.

**Confidence:** High.

---

## 7. Logging and Observability

### LTD-15: Structured JSON Logging via SLF4J + Logback + JFR Continuous Recording

**Choice:** SLF4J 2.x facade, Logback 1.5.x implementation, logstash-logback-encoder for structured JSON output to file. JDK Flight Recorder (JFR) in continuous recording mode as the primary metrics and profiling source. No Prometheus, no OpenTelemetry in MVP.

**Specification:**

**Logging stack:** SLF4J → Logback → logstash-logback-encoder → JSON lines to `/var/log/homesynapse/homesynapse.log`. Console output in plain text pattern format (human-readable, captured by systemd journal).

**Mandatory structured fields on every log entry:**

| Field | Source | Purpose |
|---|---|---|
| `@timestamp` | Logback | ISO 8601 with milliseconds |
| `level` | SLF4J | Standard log levels |
| `logger_name` | SLF4J | Fully qualified class name |
| `thread_name` | Logback | Essential for virtual thread debugging |
| `message` | Application | Human-readable description |
| `correlation_id` | MDC | Links to event correlation chain (LTD-05) |
| `entity_id` | MDC | Which device/automation this concerns |
| `integration_id` | MDC | Which integration produced this |

**Log rotation:** Logback `SizeAndTimeBasedRollingPolicy`. Daily rotation, 50 MB max per file, 7 days retention default, 500 MB total size cap. At typical event rates (~100 events/sec), JSON logs produce ~20–50 MB per day. Seven days retention keeps total log storage well within the cap.

**Default log levels:**

| Logger | Default |
|--------|---------|
| `com.homesynapse.core` | INFO |
| `com.homesynapse.event` | INFO |
| `com.homesynapse.persistence` | WARN |
| `com.homesynapse.integration` | INFO |
| `com.homesynapse.automation` | INFO |
| `com.homesynapse.api` | INFO |
| Root | WARN |

**JFR continuous recording** enabled via launcher JVM flags:

```
-XX:StartFlightRecording=disk=true,maxsize=100m,maxage=6h,dumponexit=true,filename=/var/log/homesynapse/flight.jfr
```

This maintains a rolling 6-hour window of JVM telemetry in ~100 MB: GC behavior, memory usage, thread states, CPU profiling, I/O activity. On crash or degradation, the JFR recording provides root-cause data without requiring prior instrumentation setup.

**Custom JFR events** for application-level metrics:

```java
@Label("Event Processed")
@Category({"HomeSynapse", "EventBus"})
class EventProcessedEvent extends jdk.jfr.Event {
    @Label("Entity ID") String entityId;
    @Label("Event Type") String eventType;
    @Label("Subscriber Count") int subscriberCount;
}
```

The JFR Event Streaming API (Java 14+) enables real-time consumption of JFR events for the observability web UI (subsystem 13) without file I/O — no intermediate metrics store needed.

**No Prometheus in MVP.** Prometheus requires an HTTP scrape endpoint, a metrics registry, and someone running a Prometheus server. The target MVP audience does not have Prometheus infrastructure. **No OpenTelemetry in MVP.** OTEL adds ~5+ MB of dependency weight and complexity for tracing/metrics/logs unification that has no consumer in a single-process local-first system.

**Post-MVP path:** Add a Micrometer facade with JFR and Prometheus backends. The structured logs and JFR events already contain all the data — it is a formatting and export concern, not a data collection concern.

**Rationale:** JFR is built into the JVM with <1% overhead (default profile), captures everything needed for production diagnostics, and requires zero additional dependencies. Combined with structured JSON logs carrying correlation IDs, this provides end-to-end traceability from physical device event through automation execution to API response. The logstash-logback-encoder uses Jackson internally (already a dependency), adding negligible footprint.

**Invariant alignment:** INV-TO-01 (system behavior is observable — JFR continuous recording + structured logs), INV-TO-04 (structured, queryable logs — JSON with entity_id, correlation_id, integration_id), INV-PR-01 (constrained hardware — JFR <1% overhead, no heavyweight metrics infrastructure), INV-ES-06 (every state change is explainable — correlation IDs in logs link to event IDs in the event store).

**Reversal criteria:** If the web UI team finds JFR Event Streaming API has insufficient granularity for real-time dashboards, evaluate Micrometer with an in-memory registry (no Prometheus). If log volume exceeds 100 MB/day under normal operation, review structured fields for excessive verbosity. If Logback memory overhead becomes measurable, evaluate Penna (lightweight SLF4J-native JSON logger) when it reaches 1.0 with per-logger configuration.

**Confidence:** High.

---

## 8. API and Compatibility

### LTD-16: Semantic Versioning with URL-Versioned REST API

**Choice:** Semantic Versioning 2.0.0 for the HomeSynapse product. Major-version-only URL prefix for REST API. Additive-only changes within a major version. Minimum one-major-version deprecation window.

**Specification:**

**REST API URL format:** `/api/v1/devices`, `/api/v1/events`. The `v1` corresponds to the API contract major version, not the product version. HomeSynapse 1.0 through 1.x all serve API v1.

**WebSocket API path:** `ws://host:port/ws/v1`. Protocol version established at connection time.

**Event schema versioned independently:** Event types carry a `schemaVersion` field. Consumers negotiate by schema version, not API version.

**Additive-only compatibility within a major version:**

| Change | Allowed within v1? |
|--------|-------------------|
| Add a new endpoint | Yes |
| Add an optional response field | Yes |
| Add an optional query parameter | Yes |
| Add a new WebSocket event type | Yes |
| Remove an endpoint | No |
| Remove a response field | No |
| Change a field's type | No |
| Rename a field | No (add new, deprecate old) |
| Make an optional field required | No |

**Deprecation protocol (implements INV-CS-06):**
1. Announce deprecation in release notes at least one major version before removal
2. Add `Deprecated: true` + `Sunset: <date>` response headers (RFC 8594) to affected endpoints
3. Log structured deprecation warnings when deprecated features are used
4. Provide migration guide with code examples
5. Provide automated migration tooling where feasible
6. **Minimum deprecation window:** one major version. If 1.x deprecates a feature, it cannot be removed until 3.0 (must persist through all of 2.x)

**Integration API versioned independently** (INV-CS-04). An integration compiled against Integration API 1.y must function on any core version supporting Integration API 1.z (z ≥ y).

**API contract enforcement:** OpenAPI 3.1 specification is the source of truth for REST API. AsyncAPI for WebSocket API. OpenAPI diff tooling (e.g., `oasdiff`) in CI detects breaking changes and blocks merge.

**Rationale:** URL-based versioning is visible in browser address bars, curl commands, and log files. It is trivially cacheable and requires no special client configuration. The additive-only model within a major version is the same approach used by Stripe and Twilio — APIs known for stability. This directly addresses Home Assistant's monthly breaking changes, the most common user complaint.

**Invariant alignment:** INV-CS-01 (semantic versioning enforced), INV-CS-04 (integration API stability), INV-CS-06 (deprecation discipline — full protocol specified), INV-CS-03 (configuration schema follows the same additive-only model), INV-ES-07 (event schema evolution — independent versioning).

**Reversal criteria:** If maintaining simultaneous v1 and v2 becomes a significant code maintenance burden, evaluate an API gateway layer. If GraphQL adoption in the smart home space makes REST versioning less relevant, evaluate GraphQL as an alternative surface.

**Confidence:** High.

---

## 9. Integration Architecture

### LTD-17: In-Process Compiled Integrations with Enforced API Boundary

**Choice:** All MVP integrations are compiled-in Java modules running in-process. No dynamic JAR loading, no classloader isolation, no external process management. The Integration API boundary is enforced at build time.

**Specification:**

**Gradle module structure:**

```
homesynapse-core/
  integration-api/          # Public interfaces + DTOs only
  core-internal/            # Event bus, state store, persistence
  integration-zigbee/       # Depends on integration-api, NOT on core-internal
  integration-runtime/      # Loads and supervises integrations
```

The build system enforces that `integration-zigbee` (and all future integration modules) can depend on `integration-api` but cannot depend on `core-internal`. This is verified by:
1. **Gradle module dependencies** — the `implementation` configuration enforces directed dependency
2. **`modules-graph-assert` plugin** — CI check rejecting forbidden dependency directions
3. **ArchUnit tests** — class-level verification that integration code does not import `core-internal` packages
4. **JPMS `module-info.java`** — compile-time enforcement if full modularization is achieved

Integrations communicate with the core exclusively through defined Integration API interfaces: `EventPublisher`, `DeviceRegistry`, `StateQuery`, `ConfigurationAccess`. Never through shared mutable state, direct field access, or core-internal classes.

Each integration runs in its own virtual thread group with:
- Named threads (e.g., `hs-zigbee-*`) for log correlation
- Uncaught exception handlers that isolate failures
- JFR custom events tracking resource consumption per integration
- Memory monitoring via JFR allocation profiling

**What this decision commits to:**
- All MVP integrations are part of the HomeSynapse distribution
- The Integration API must not expose the isolation mechanism — no direct method calls on core objects, no shared mutable state, no classloader references
- The API boundary is the investment; the loading mechanism is swappable

**What this decision does NOT commit to:**
- Dynamic JAR loading may be added when community integrations become a real requirement
- Out-of-process isolation may be added for Enhanced-tier deployments where IPC overhead is negligible
- The choice between classloader isolation and process isolation is deliberately deferred

**The INV-RF-01 compatibility test applies:** Deploy the same integration binary against both in-process and (simulated) out-of-process hosts. Verify identical behavior. This test is the contract; as long as it passes, the isolation mechanism can change freely.

**Rationale:** Building a plugin system for a single plugin (Zigbee) is premature abstraction by definition. Classloader isolation on a 4 GB Pi is risky — each isolated classloader duplicates shared library classes (Jackson ~3 MB, SLF4J, Integration API), adding 5–10 MB per integration. No dynamic code loading eliminates an entire class of security concerns (arbitrary JAR execution). The Integration API boundary — not the loading mechanism — is what enables future evolution to classloader isolation or process isolation without breaking integrations.

**Invariant alignment:** INV-RF-01 (integration isolation — virtual thread supervision + API boundary; mechanism is swappable), INV-RF-02 (resource quotas — virtual thread groups + JFR monitoring), INV-RF-03 (startup independence — integrations initialize asynchronously), INV-CS-04 (integration API stability — API module versioned independently, build-time dependency enforcement).

**Reversal criteria:** If a second protocol adapter is added before the Integration API is clean (the adapter directly accesses core internals despite the module boundary), fix the boundary before adding dynamic loading. If community demand for custom integrations arises before classloader isolation is ready, support a "sidecar" pattern where community integrations run as separate processes communicating via the REST/WebSocket API. If memory analysis shows in-process integrations consume >50% of available RAM, process isolation becomes necessary earlier than planned.

**Confidence:** High.

---

### LTD-18: Web UI Technology — Preact SPA for Observability, HTMX Reserved for Tier 2+ Configuration

**Choice:** The Observability MVP dashboard (Doc 13) is built as a Preact single-page application served as pre-built static files from Javalin. HTMX with server-rendered templates (JTE) is reserved for future Tier 2+ configuration and management UI. Both coexist on the same Javalin HTTP server at distinct URL paths.

**Specification:**

*Observability Dashboard (Tier 1 MVP):*
- Framework: Preact (~4 KB gzipped core) with preact/compat (~2 KB) for React ecosystem access.
- Architecture: Pure client-side SPA. Zero server CPU consumed for UI rendering. All rendering happens in the browser.
- Build: Vite at development/release time. Output is `index.html`, `app.[hash].js`, `style.[hash].css`. No runtime Node.js dependency on the RPi.
- Distribution: Static files ship inside the jlink distribution (LTD-13) at a classpath resource path. Served by Javalin's static file handler at `/dashboard/`.
- Bundle budget: 100 KB gzipped total (framework + charting + application logic + styles).
- Data: Consumes Doc 09 REST API (JSON) and Doc 10 WebSocket API (JSON) exclusively. No new server endpoints.
- Charting: uPlot (~35 KB gzipped) for time-series visualization, selected for performance on large datasets and purpose-built time-series API. Chartist (~10 KB) is the documented fallback if uPlot proves unsuitable during Phase 2.
- No CDN, no external resources — fully self-contained on LAN (INV-LF-01).

*Configuration and Management UI (Tier 2+, not implemented in MVP):*
- Framework: HTMX + JTE (Java Template Engine) for form-driven CRUD pages.
- Use cases: Configuration editing, integration management, user administration, automation editing.
- Architecture: Server-rendered HTML fragments pushed via HTMX. Appropriate for form-heavy interactions where server rendering cost is proportional to user-initiated actions (not continuous streaming).
- URL path: `/config/` (coexists with `/dashboard/` and `/api/v1/` on the same Javalin server).

**Rationale:** Framework research (research/Web_UI_Framework_Research_v1.md) evaluated six candidates against HomeSynapse-specific constraints. The Observability MVP requires real-time WebSocket event streaming, interactive time-series charts, virtual-scrolling event logs, and causal chain trace visualization — all inherently client-side rendering problems. Server-rendered HTML (HTMX) is unsuitable for this use case for three reasons: (1) every UI update would require RPi CPU for template rendering, competing with event processing on 4-core Cortex-A76 (LTD-02); (2) the WebSocket API (Doc 10) publishes JSON events, requiring either a duplicate HTML-fragment endpoint or client-side JavaScript escape hatches that defeat HTMX's purpose; (3) virtual scrolling and interactive charts cannot be built with HTML fragment swaps. Preact was selected over Svelte 5 (smaller bundles but smaller ecosystem) and Solid.js (finest-grained reactivity but smaller community) because its React-compatible API provides the largest support ecosystem, the safest 5-year maintainability for a solo developer, and mechanical migration to React if Preact ever stalls. HTMX remains the intended technology for Tier 2+ configuration UI, where form-driven CRUD pages align with its server-rendered model and where user-initiated actions (not continuous streaming) drive rendering cost.

**Invariant alignment:** INV-LF-01 (dashboard fully functional on LAN with no internet — all assets self-contained in jlink distribution), INV-PR-01 (constrained hardware — zero server CPU for dashboard rendering, entire rendering budget offloaded to client browser), INV-PR-02 (performance targets — 100 KB bundle budget, <200ms first paint on LAN), INV-TO-01 (observable behavior — the dashboard is the primary observability surface for Tier 1), INV-CE-02 (zero-configuration — dashboard served automatically, no user build step).

**Reversal criteria:** If the Preact ecosystem shows signs of abandonment (no release for 12 months, maintainer departure without succession) before Phase 3 implementation, evaluate Svelte 5 as the primary alternative — migration cost is a full rewrite of the component layer but not the WebSocket/REST integration logic. If the 100 KB bundle budget proves insufficient for the required dashboard functionality during Phase 2 interface specification, evaluate whether code splitting (lazy-loaded routes) resolves the issue before increasing the budget. If uPlot proves unsuitable for the required chart types during Phase 2, switch to Chartist; if both are insufficient, evaluate Chart.js (~65 KB) with an increased bundle budget (150 KB maximum).

**Confidence:** High for the SPA architecture and Preact selection. Medium for the specific charting library (uPlot vs. Chartist is resolvable during Phase 2 without architectural impact).

---

## 10. Decision Dependency Graph

These 18 decisions form an interdependent system. The dependency graph shows which decisions constrain which others:

```
LTD-01 (Java 21) ──────────────────────────────────────────────────────┐
    │                                                                   │
    ├── LTD-11 (No Broker) ── uses virtual threads from LTD-01         │
    │                                                                   │
    ├── LTD-17 (Integration) ── virtual thread groups from LTD-01      │
    │       │                                                           │
    │       └── LTD-10 (Gradle) ── enforces module boundaries          │
    │                                                                   │
    ├── LTD-15 (Logging) ── JFR built into JDK from LTD-01            │
    │                                                                   │
    └── LTD-13 (Packaging) ── jlink from JDK 21                       │
            │                                                           │
            └── LTD-14 (Update) ── depends on directory layout         │
                    │                                                   │
                    └── LTD-07 (Migration) ── backup-before-migrate    │
                                                                        │
LTD-03 (SQLite) ───────────────────────────────────────────────────────┤
    │                                                                   │
    ├── LTD-05 (Sequences) ── rowid as global position                 │
    │       │                                                           │
    │       └── LTD-06 (Delivery) ── checkpoint against global pos     │
    │                                                                   │
    ├── LTD-04 (ULID) ── stored as BLOB(16) in SQLite                 │
    │                                                                   │
    └── LTD-07 (Migration) ── SQLite's DDL limitations drive design    │
                                                                        │
LTD-02 (Pi 5/Pi 4) ── hardware constraints apply to all decisions ─────┘

LTD-08 (Jackson) ── serialization for LTD-06, LTD-15, LTD-16
LTD-09 (YAML) ── user-facing config; validated by JSON Schema
LTD-12 (Zigbee) ── exercises LTD-17 (Integration Runtime)
LTD-16 (API) ── governs LTD-17 (Integration API versioning)
LTD-18 (Web UI) ── consumes LTD-13 (jlink distribution for static files)
                 ── serves via LTD-11 (Javalin HTTP server, no external broker)
```

---

## 11. Consolidated Decision Matrix

| # | Decision | Choice | Confidence | Primary Constraint |
|---|----------|--------|------------|-------------------|
| **LTD-01** | Language & Runtime | Java 21 LTS, G1GC, virtual threads | High | -Xmx1536m on 4 GB Pi; -Xss512k mandatory |
| **LTD-02** | Hardware Target | Pi 5 recommended, Pi 4 floor, NVMe required | Medium | Pricing volatile; N100 documented as alternative |
| **LTD-03** | Persistence Engine | SQLite, WAL mode, `synchronous=NORMAL` | High | Single-writer model; 128 MB page cache |
| **LTD-04** | Identity | ULID monotonic; BLOB(16) storage | Medium | UUIDv7 documented as equally valid alternative |
| **LTD-05** | Ordering | Per-entity sequences + global position (rowid) | High | Correlation/causation IDs on every event |
| **LTD-06** | Delivery | Write-ahead persistence, at-least-once, idempotent subscribers | High | Event store IS the outbox |
| **LTD-07** | Schema Migration | Hand-rolled forward-only SQL; mandatory backup-before-migrate | Medium | Flyway-compatible naming; ≤200 LOC threshold |
| **LTD-08** | Serialization | Jackson 2.18+ with Blackbird; `EventSerializer` abstraction | High | Singleton ObjectMapper; byte[] I/O |
| **LTD-09** | Configuration | YAML 1.2 via SnakeYAML Engine; JSON Schema validation | Medium | Not jackson-dataformat-yaml (YAML 1.1) |
| **LTD-10** | Build System | Gradle Kotlin DSL, convention plugins, version catalogs | High | No on-device builds |
| **LTD-11** | Event Dispatch | In-process virtual-thread bus; no external broker | High | `EventPublisher` interface for future migration |
| **LTD-12** | First Protocol | Zigbee only in MVP | High | Protocol-agnostic device model from day one |
| **LTD-13** | Deployment | jlink distribution + systemd; dedicated service user | High | `/opt/homesynapse/` read-only; `ProtectSystem=strict` |
| **LTD-14** | Update Strategy | CLI-driven upgrade; mandatory snapshot; dry-run + rollback | High | No auto-update; last 3 snapshots retained |
| **LTD-15** | Observability | SLF4J + Logback JSON + JFR continuous recording | High | No Prometheus/OTEL in MVP; JFR is primary metrics |
| **LTD-16** | API Compatibility | Semver; URL-versioned REST; additive-only within major | High | 1 major version minimum deprecation window |
| **LTD-17** | Integration Model | In-process compiled modules; API boundary enforced at build | High | No dynamic loading; mechanism is swappable |
| **LTD-18** | Web UI Technology | Preact SPA for observability; HTMX reserved for Tier 2+ config | High/Medium | SPA architecture High; charting library Medium |

---

## 12. Cross-Cutting Risks

Three systemic risks span multiple decisions and require active monitoring:

**Memory pressure.** Java's ~300–800 MB base footprint plus SQLite's 128 MB page cache plus OS overhead on 4 GB RAM leaves thin margins. Monitor with JFR (LTD-15) from day one. The `MemoryMax=2G` systemd limit (LTD-13) prevents the JVM from destabilizing the OS, but leaves only ~2 GB for everything else. If steady-state RSS exceeds 2 GB under normal workload, something is wrong.

**SD card storage.** Despite LTD-02 requiring NVMe, some users will attempt SD card deployment. The system must detect and warn about SD card storage at startup. Event store write patterns (~200 MB/day at 100 events/minute) will degrade consumer SD cards within months. This is documented but not prevented — preventing it would violate INV-CE-02 (zero-configuration first run).

**Dependency supply chain.** Every decision adds at least one library dependency. The total dependency footprint must be monitored: each dependency is a liability on constrained hardware (memory, startup time, security surface). The current required dependencies are: Jackson (+ Blackbird, JavaTimeModule), SnakeYAML Engine, sqlite-jdbc, SLF4J, Logback, logstash-logback-encoder, json-schema-validator. (Note: `ulid-creator` removed — replaced by hand-rolled `UlidFactory` per DECIDE-02 amendment, 2026-03-20.) This is ~15–20 MB of JARs. If this total exceeds 50 MB, conduct a dependency audit.

---

## 13. Invariant Coverage Matrix

Every architectural invariant must be served by at least one locked decision. This matrix confirms coverage for the invariants most relevant to implementation choices:

| Invariant | Served By |
|-----------|-----------|
| INV-LF-01 (Core without internet) | LTD-03 (local SQLite), LTD-11 (no external broker), LTD-14 (no auto-update) |
| INV-ES-01 (Immutable events) | LTD-03 (append-only SQLite), LTD-06 (write-ahead) |
| INV-ES-03 (Per-entity ordering) | LTD-05 (per-entity sequences + global position) |
| INV-ES-04 (Write-ahead persistence) | LTD-06 (events durable before delivery) |
| INV-ES-05 (At-least-once delivery) | LTD-06 (subscriber idempotency) |
| INV-ES-06 (Explainable state changes) | LTD-05 (correlation/causation IDs), LTD-15 (structured logs) |
| INV-ES-07 (Schema evolution) | LTD-08 (Jackson FAIL_ON_UNKNOWN=false), LTD-16 (independent event schema version) |
| INV-RF-01 (Integration isolation) | LTD-17 (API boundary + virtual thread groups) |
| INV-RF-04 (Crash safety) | LTD-03 (WAL), LTD-06 (checkpoint replay), LTD-13 (systemd restart), LTD-14 (snapshot) |
| INV-RF-05 (Bounded storage) | LTD-15 (log rotation), LTD-07 (migration, not unbounded schema drift) |
| INV-CS-01 (Semantic versioning) | LTD-16 (semver product + API versioning) |
| INV-CS-04 (Integration API stability) | LTD-16 (independent API versioning), LTD-17 (build-enforced boundary) |
| INV-CS-05 (Update safety) | LTD-14 (mandatory snapshot, dry-run, rollback) |
| INV-CS-06 (Deprecation discipline) | LTD-16 (one major version deprecation window) |
| INV-CE-01 (Human-readable config) | LTD-09 (YAML 1.2) |
| INV-CE-02 (Zero-config first run) | LTD-03 (no DB server), LTD-11 (no broker), LTD-13 (self-contained) |
| INV-CE-04 (Protocol agnosticism) | LTD-12 (protocol-agnostic device model from day one) |
| INV-CE-06 (Migration tooling) | LTD-07 (forward-only SQL migrations) |
| INV-PR-01 (Constrained hardware) | LTD-01 (JVM tuning), LTD-02 (Pi 4 floor), LTD-03 (SQLite), LTD-13 (jlink) |
| INV-PR-02 (Performance targets) | LTD-01 (G1GC within latency budgets), LTD-03 (SQLite IOPS) |
| INV-PR-03 (Bounded resources) | LTD-01 (-Xmx), LTD-13 (systemd MemoryMax), LTD-15 (log rotation) |
| INV-TO-01 (Observable) | LTD-15 (JFR + structured logs) |
| INV-TO-04 (Structured logs) | LTD-15 (JSON with correlation, entity, integration IDs) |
| INV-PD-01 (Zero telemetry) | LTD-14 (no auto-update phoning home), LTD-15 (no remote log shipping) |
| INV-PD-08 (Tamper-evident) | LTD-13 (read-only runtime), LTD-14 (package signature verification) |
| INV-LF-01 (Core without internet) | LTD-18 (self-contained static files in jlink, no CDN) |
| INV-TO-01 (Observable) | LTD-18 (Preact dashboard is primary observability surface) |
| INV-PR-01 (Constrained hardware) | LTD-18 (zero server CPU for rendering, client-side only) |

---

## 14. Amendment Process

A locked decision may only be changed through the following process:

1. **Identify the reversal criterion that has been triggered.** If no reversal criterion applies, the proposed change must justify why the original analysis was incomplete.
2. **Draft an amendment** documenting: the triggered reversal criterion (with evidence), the proposed new decision, impact analysis on all dependent decisions and subsystem designs, and updated invariant alignment.
3. **Review the amendment** against the full dependency graph (§10). Every downstream artifact that references the changed decision must be identified.
4. **Apply the amendment.** The old decision text is retained with `[SUPERSEDED by amendment YYYY-MM-DD]` annotation. The new decision text is added with full provenance.

Amendments are expected to be rare. The reversal criteria exist precisely to prevent premature changes — they define observable thresholds, not theoretical concerns.

---

*This document is the authoritative locked technical decisions register for HomeSynapse Core. It supersedes the decision table in Project MVP §5. It is governed by the amendment process defined in §14 and referenced by all Phase 1 subsystem design documents.*
