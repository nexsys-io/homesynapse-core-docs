# AMD-32: Persistence Module Internal Types (WriteCoordinator + WritePriority)

**Affected docs:** Doc 04 — Persistence Layer
**Section(s):** §8 (Interface Specifications) — new subsection §8.7
**Classification:** CONTRACT-LEVEL
**Date:** 2026-04-09
**Status:** APPLIED

## Problem

The persistence module's Phase 2 specification (Doc 04) defines public interfaces for external consumers (TelemetryWriter, PersistenceLifecycle, MaintenanceService, etc.) but does not specify the internal write serialization mechanism. The single-writer model mandated by AMD-06 (single-writer contention) and AMD-27 (platform thread executor design) requires an internal interface for routing all SQLite write operations through a bounded priority queue on a dedicated platform thread.

Without a formal specification, the write serialization contract exists only in implementation code, making it invisible to the design document traceability chain.

## Specification

Add to Doc 04 §8.7 (Internal Interfaces — Package-Private):

### WriteCoordinator (package-private interface)

Serializes all write operations against the persistence layer's SQLite databases. All sqlite-jdbc JNI calls on the write path route through this interface because JNI pins carrier threads on all Java versions including Java 25+ (AMD-26).

```java
interface WriteCoordinator {
    <T> T submit(WritePriority priority, Callable<T> operation);
    void shutdown();
}
```

- `submit()` blocks the calling thread until the operation completes on the write thread and the result is available.
- Checked exceptions from the operation are wrapped in `RuntimeException`. Unchecked exceptions propagate directly.
- After `shutdown()`, subsequent `submit()` calls throw `IllegalStateException`.

### WritePriority (package-private enum)

Priority ordering for write operations. Lower rank = higher priority. When multiple writes are queued, the coordinator services them in priority order to ensure event publishing is never starved by maintenance operations.

```java
enum WritePriority {
    EVENT_PUBLISH(1),
    STATE_PROJECTION(2),
    WAL_CHECKPOINT(3),
    RETENTION(4),
    BACKUP(5);
}
```

## Implementation Status

- M1.8 created `WriteCoordinator` and `WritePriority` as package-private types in `core/persistence/src/main/java/com/homesynapse/persistence/`.
- M1.8 created `WriteCoordinatorContractTest` (11 methods, 4 @Nested tiers) and `InMemoryWriteCoordinator` in `core/persistence/src/testFixtures/`.
- `InMemoryWriteCoordinatorTest` passes all 11 contract methods.
- Production `PlatformThreadWriteCoordinator` planned for M2.3.

## Invariant Alignment

- **INV-ES-04 (Write-Ahead Persistence):** WriteCoordinator ensures all event writes complete durably before the method returns.
- **LTD-11 (No synchronized):** InMemoryWriteCoordinator uses ReentrantLock. Production executor uses platform threads to avoid virtual thread pinning.
- **AMD-26 / AMD-27:** WriteCoordinator is the abstraction over the single platform write thread mandated by these amendments.

## Future Extension

A symmetric `ReadExecutor` interface (package-private) will be added in M2.3 to route read-path sqlite-jdbc calls through a small pool of 2–3 platform read threads. This amendment will be updated or a new AMD filed at that time.
