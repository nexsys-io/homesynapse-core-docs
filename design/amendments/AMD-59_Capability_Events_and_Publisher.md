<!--
file: design/amendments/AMD-59_Capability_Events_and_Publisher.md
purpose: AMD-59 — CapabilityAdded/CapabilityRemoved events + CapabilityPublisher contract + DiscoveryServices aggregator (REC-47 per ratified NQ-3/NQ-4).
audience: Nick (ratify), PM, Coder
status: RATIFIED 2026-06-05 — DOCS-Project review (RATIFY-WITH-EDITS; E8 folded) + R6 co-sign formalized + Nick E8 ruling; review return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md` · **implemented at core `5b0e20c` (IR-67, 2026-10-01; DOCS-1)** — the boot-time capability reconcile, the runtime's publisher, the projection's consumer; `capability.removed` typed, never published (removal=none, D-v88-19)
source: Research 6 REC-47 MODIFY + NQ-3 (RESOLVED: sealed Capability permit class + existing CapabilityInstance as identity — no new CapabilityId wrapper) + NQ-4 (RESOLVED: no new SQLite table — project into Entity.capabilities) + F6 (CapabilityId does not exist, source-verified)
baseline: homesynapse-core HEAD `e76b925` — Capability sealed (16 permits: 15 standard + CustomCapability); CapabilityInstance 7 components incl. String capabilityId; Entity 12 components incl. List<CapabilityInstance> capabilities (the post-B-S2 shape Workstream C freezes against)
-->

# AMD-59: Capability Events, `CapabilityPublisher`, and `DiscoveryServices`

## 1. Problem Statement

Devices gain and lose capabilities after adoption (firmware updates adding features, endpoint reconfiguration, quirk-profile corrections). Today `Entity.capabilities` (`List<CapabilityInstance>`, source-verified on the 12-component post-B-S2 `Entity`) is set at adoption and has **no mutation vocabulary** — no event says "this entity gained Occupancy." Without events, capability changes are invisible to the log, replay cannot reconstruct the entity's capability history, and M8 automations cannot react to capability availability.

## 2. Specification

### 2.1 Identity model (ratified NQ-3, refined against shipped source)

- **Type identity** = the sealed `Capability` permit class (in-JVM, for pattern matching and typed APIs) **and** its existing `String capabilityId` (e.g., `"on_off"`, `"brightness"` — source-verified on every permit record and on `CapabilityInstance`). The string is the **persisted** form.
- **Instance identity** = the existing `CapabilityInstance` record (7 components, source-verified).
- **No new `CapabilityId` wrapper type is introduced** (F6 + NQ-3: nothing else in the system uses one; the string + the permit class are the established vocabulary).

> **[REVIEW-FLAG R6 — RESOLVED (review verified + co-sign formalized 2026-06-05) — serialization-driven refinement of the NQ-3 sketch.]** The NQ-3 lean sketched `CapabilityAdded(integration, device, capability: Class<? extends Capability>, instance, ts)`. Authoring against the shipped serde surface (AMD-52's codec discipline) found two corrections: (a) a `Class<?>` component in a **persisted** event payload is a reflection/serde liability (Class→FQN string→`Class.forName` on decode) and is redundant — `CapabilityInstance.capabilityId` already carries the type identity in its persisted form; (b) the `ts` field duplicates the envelope's `eventTime` (house rule — no payload timestamps); (c) an `EntityId` component is required — capabilities live on **Entity**, and the projection cannot deterministically target an entity from `DeviceId` alone (multi-endpoint devices map one device → many entities). The records below therefore carry `entityId` + the string/instance identities, and `Class<? extends Capability>` remains the **API-level** typed identity (§2.3 publisher). This honors NQ-3's substance (no new wrapper; permit-class + instance as identity) while keeping the payload codec-clean. **CONFIRMED — the review verified all three R6 counts sound (serde argument; no research contradiction of entity-targeting — the return itself classifies these events "state-changing (updates entity registry)"; replay self-sufficiency); co-sign formalized at ratification 2026-06-05.**

### 2.2 Event records (new, `com.homesynapse.integration`)

```java
public sealed interface CapabilityEvent extends DomainEvent
        permits CapabilityAdded, CapabilityRemoved {
    IntegrationId integrationId();
    DeviceId deviceId();
    EntityId entityId();
    String capabilityId();
}

@EventType(EventTypes.CAPABILITY_ADDED)      // "capability.added"
public record CapabilityAdded(
        IntegrationId integrationId,
        DeviceId deviceId,
        EntityId entityId,
        CapabilityInstance instance          // complete instance — replay self-sufficiency
) implements CapabilityEvent {
    // capabilityId() derives from instance.capabilityId()
}

@EventType(EventTypes.CAPABILITY_REMOVED)    // "capability.removed"
public record CapabilityRemoved(
        IntegrationId integrationId,
        DeviceId deviceId,
        EntityId entityId,
        String capabilityId,                 // the removal identity
        CapabilityRemovalReason reason       // why — descriptive, never behavioral
) implements CapabilityEvent { }

/** Why a capability was removed (review E8 → Nick ruling 2026-06-05 — restored
 *  from the research's REC-47 shape). Descriptive metadata for diagnostics,
 *  audit, and consumer policy — it never routes supervisor, projection, or
 *  registry behavior (orphan detection is unchanged). TRANSIENT_LOSS exists so
 *  consumers (M8 automations, UI) can treat a transient mesh drop differently
 *  from a deliberate unregistration: Research 12's field evidence (Aqara
 *  devices dropping off mesh without LeaveRequest) makes the distinction
 *  load-bearing — stripping user automations on a transient drop is the
 *  documented HA failure mode this prevents. */
public enum CapabilityRemovalReason {
    FIRMWARE_DOWNGRADE, DEVICE_REPLACED, TRANSIENT_LOSS, UNREGISTERED
}
```

Placement follows the AMD-33 precedent (subsystem event hierarchies live in their subsystem module; `DomainEvent` is permanently non-sealed for exactly this). integration-api already `requires transitive com.homesynapse.device` and `com.homesynapse.event` — **no JPMS change**.

### 2.3 `CapabilityPublisher` (new interface, `com.homesynapse.integration`)

```java
public interface CapabilityPublisher {
    /** Publish capability.added for an entity owned by this integration. */
    void publishAdded(EntityId entityId, CapabilityInstance instance);

    /** Typed-identity convenience honoring NQ-3's permit-class identity:
     *  resolves the standard instance for the permit class, then publishes. */
    void publishAdded(EntityId entityId, Class<? extends Capability> capability);

    /** Publish capability.removed for an entity owned by this integration. */
    void publishRemoved(EntityId entityId, String capabilityId, CapabilityRemovalReason reason);
}
```

The M9 implementation injects the adapter's `IntegrationId`/`DeviceId` scoping (LTD-17 runtime enforcement — an adapter can only publish capability changes for entities it owns, mirroring the filtered `EntityRegistry`) and routes through the standard `EventPublisher`.

### 2.4 `DiscoveryServices` aggregator + `IntegrationContext` growth (ratified NQ-1 doctrine)

```java
public record DiscoveryServices(CapabilityPublisher capabilityPublisher) { }
```

`IntegrationContext` grows 10 → 12 across this block: `SecurityServices security` (AMD-60, component 11) and `DiscoveryServices discovery` (this AMD, component 12), both appended, both **nullable**, both gated by new `RequiredService` values — `RequiredService.DISCOVERY` added here (3 → 5 values across AMD-59/60). This is the NQ-1 doctrine applied: context grows by **service-family aggregator**, never per-service. A 10-arg convenience constructor preserves every existing caller (`StubIntegrationContext` + tests).

### 2.5 Storage model (ratified NQ-4 — frozen contract, M9+ implementation)

Capability events are **state-changing, entity-registry projection**: the registry's projection handler applies `CapabilityAdded` by appending `instance` to the target entity's `capabilities` list (replacing any same-`capabilityId` instance — re-add is upgrade) and `CapabilityRemoved` by removing the matching `capabilityId`. **No new SQLite table** (Research 8 REC-23/REC-26: capabilities live on `Entity`; `EntityState` carries no structural metadata). `EntityId` is stable across capability changes (the AMD-44 reclassification doctrine extended).

## 3. Downstream Impact

- **persistence serde:** `CapabilityAdded` embeds the full `CapabilityInstance` subtree (`AttributeSchema`/`CommandDefinition`/`ConfirmationPolicy` maps). The codec must round-trip it — annotation-free generic record serialization in `EventPayloadCodec` (Jackson-isolation HARD RULE: no annotations on device-model types; `NO_JACKSON_IN_DOMAIN_MODEL` ArchUnit rule is live, source-verified). **M4.C must add the round-trip test; if generic serialization fails on any nested type, that is a STOP-and-report, not a silent mixin.**
- **Registration:** new `IntegrationEvents.CAPABILITY_EVENT_CLASSES` manifest list (the lifecycle list is semantically wrong for these); composition-root aggregation gains the second list; `EventTypes` gains `CAPABILITY_ADDED`/`CAPABILITY_REMOVED` constants (event-model string constants only).
- **device-model:** untouched. `Entity`/`CapabilityInstance`/`Capability` shapes are consumed, not modified.
- **M8 automations:** capability-availability triggers become possible (consumer, not M4 scope).

## 4. Tests (M4.C scope)

| Test | Assertion |
|---|---|
| `CapabilityEventTypeAnnotationTest` (new) | 2 permits, annotated, dot-namespaced `capability.` strings, match EventTypes constants, no core-namespace collision |
| `EventPayloadCodecTest` (extended) | `CapabilityAdded` with a fully-populated `StandardCapabilities.onOff()`-derived instance round-trips losslessly; `CapabilityRemoved` round-trips |
| `CapabilityEventTest` (new) | accessor contract incl. `CapabilityAdded.capabilityId() == instance.capabilityId()`; compact-ctor null guards (incl. `reason`) |
| `CapabilityRemovalReasonTest` (new) | exactly 4 values, declaration order `FIRMWARE_DOWNGRADE, DEVICE_REPLACED, TRANSIENT_LOSS, UNREGISTERED` pinned |
| `StubIntegrationContextTest` (extended) | `discovery` defaults null; builder override works |

## 5. Scope Fences / Deferred

**Implementation note (2026-10-01, DOCS-1).** The fence as ratified (M4.C) read, verbatim: NO publisher implementation, NO registry projection handler, NO `DispatchingProjectionAdvancer` registration (the registry projection is an entity-registry concern — its implementing milestone owns the handler), NO automation triggers. M4.C ships records + interfaces + registration + serde tests only. The fence closed at IR-67 (core `5b0e20c`): of the first sentence's four fences, the publisher and registry-handler fences no longer describe the code, the `DispatchingProjectionAdvancer` fence holds literally (the consumer is a bus subscriber; no such registration exists for either capability type) and the automation fence holds; the second sentence stays true of M4.C — IR-67 is the later unit that shipped the path. **The boot-time reconcile.** `ZigbeeAdoptionSlice.reconcileCapabilities(Collection<ZigbeeDeviceRecord>, CapabilityPublisher)` :646–:647 (its Javadoc :614–:645) re-classifies, for every cached record, each endpoint bound to a registry entity and diffs the capability ids against the entity's by `capabilityId` — never by instance equality (AMD-59-INV-03); each missing id is published through the publisher handed in (:728) and then applied write-ahead through the projection (:729), ONE INFO `zigbee.capability_added` per addition (:731); a shrink is ONE WARN `zigbee.capability_reconcile_shrink` (:741) with no event and no registry write; an IAS-family swap is ONE WARN and a re-learn (:715). It runs from `ZigbeeIntegrationAdapter` :503, immediately before `zigbee.initialized` (:504), through the private `reconcileCapabilities()` :1387–:1398 — a context without discovery services is the skip WARN `zigbee.capability_reconcile_skipped: reason=no_discovery_services` and no pass (:1388–:1390); otherwise the slice's pass runs over `cache.all()` (:1392–:1393) and ONE INFO `zigbee.capability_reconcile:` summarises the launch (:1394–:1397). **The runtime's publisher.** `SupervisorCapabilityPublisher` :51 (`final class … implements CapabilityPublisher`; its Javadoc's first paragraph :32–:39) is the DISCOVERY family's publisher: `publishAdded(EntityId, CapabilityInstance)` :72 resolves the entity and its `DeviceId` from the shared registry (an unknown entity or a null `deviceId` is an `IllegalArgumentException`, :75–:81) and publishes ONE `capability.added` root draft on the ENTITY subject, origin INTEGRATION, priority NORMAL (:83–:88); a `SequenceConflictException` is ONE WARN `integration.capability_event_conflict` (:89–:92). `StandardIntegrationSupervisor.buildContext` :1092–:1097 provisions it — `new DiscoveryServices(new SupervisorCapabilityPublisher(runtime.id, publisher, entityRegistry, clock))` at :1095–:1096 — only when the descriptor declares `RequiredService.DISCOVERY` (:1094), else `null` (:1097); the zigbee descriptor declares it (`ZigbeeIntegrationFactory` :138). **The projection's consumer.** `RegistryProjection.applyCapabilityAdded(EntityId, CapabilityInstance)` :144–:171 is REG-INV-1's fourth apply beside `applyDeviceRegistered` :86, `applyEntityRegistered` :113 and `applyDeviceRemoved` :185: `false` when the registry has no such entity (:150–:152); an id the entity already carries is `true` with no write (:154–:158); otherwise the entity is re-written with the instance appended (:159–:167). Its bus consumer is `RegistryProjectionSubscriber` — the four-type filter :75–:81 (`CAPABILITY_ADDED` :80) and `case CapabilityAdded` :92–:102 (the projection's `false` is ONE WARN `registry.capability_added_orphan`, :98–:100) — subscribed by the composition root as a bus subscriber. No automation consumer exists: beyond the api's records and the composition root's aggregation of the manifest `IntegrationEvents.CAPABILITY_EVENT_CLASSES` for serde, the `capability.added` type is reached in main only by the publisher (`SupervisorCapabilityPublisher` :84), the subscriber (`RegistryProjectionSubscriber` :80) and the persistence category mapping (`EventCategoryMapping` :201); no automation module names either capability type. **`capability.removed` typed, never published.** The type is declared (`EventTypes` :320); the record `CapabilityRemoved` (`@EventType(EventTypes.CAPABILITY_REMOVED)` :39) sits in the manifest `IntegrationEvents.CAPABILITY_EVENT_CLASSES` :78–:81 and in the category mapping (`EventCategoryMapping` :203); the interface still declares `publishRemoved` (`CapabilityPublisher` :59) — but `SupervisorCapabilityPublisher.publishRemoved` :112–:116 throws `UnsupportedOperationException("capability.removed is not published before its own unit (IR-67: additive only — removal=none)")`, and `new CapabilityRemoved(` occurs in no main source (tests only): D-v88-19's `removal=none` fork — additive only; a shrink is one WARN, never `capability.removed` (`context/planning/2026-09-30_v88_decision-record.md` :53). Sources of record: the v90 b1 audit §5, `context/audits/2026-10-01_v90-b1_boot-intake-and-IR67-Phase-2_audit.md` :54 (Phase 2's spot-checks at source — the filter's four types, the runtime's provisioning at :1095, the slice's `zigbee.capability_reconcile` tokens, `new CapabilityRemoved(` in main = 0 and `publishRemoved` :112 throwing) and :58 (IR-67's register row → RETIRED v90 b1 at `5b0e20c`; the row at `context/planning/improvement-register.md` :79); the IR-67 return §1, `context/audits/2026-09-30_IR67_return.md` :49–:56 (the per-file spans at the branch's first commit); the v89 b3 intake audit, `context/audits/2026-10-01_v89-b3_IR67_intake_audit.md` :12 (ACCEPT-WITH-NOTES; CI on the landing sha as the gate of record) and :24 (the production diff read whole).

## 6. Invariants and Citations

- **AMD-59-INV-01:** capability events are the only post-adoption mutation path for `Entity.capabilities`; no API or registry method mutates the list outside the event-sourced path. No capability SQLite table exists.
- **AMD-59-INV-02:** `CapabilityAdded` carries the complete `CapabilityInstance` — replay reconstructs `Entity.capabilities` from the log alone (replay self-sufficiency).
- **AMD-59-INV-03:** no `CapabilityId` wrapper type exists; capability type identity is the permit class (in-JVM) and `String capabilityId` (persisted).
- **AMD-59-INV-04:** `EntityId` is stable across capability add/remove (no identity churn).
- **AMD-59-INV-05:** `CapabilityPublisher` is integration-scoped (LTD-17): publishes only for entities owned by the calling adapter's integration.
- **AMD-59-INV-06:** `CapabilityRemovalReason` is descriptive diagnostics only — no supervisor, projection, or registry behavior branches on it (orphan detection unchanged). Consumers (M8 automations, UI) may branch on it; the core never does.
- Cites: NQ-3/NQ-4 (RESOLVED 2026-06-04); Research 8 REC-23/26/28; Research 12 (Aqara transient-loss field evidence); AMD-33; AMD-44 (EntityId stability doctrine); LTD-17; DECIDE-04 (manifest registration).

Module-info: unchanged — see AMD-54 §7 verbatim embed.

## 7. Implementing WU

**M4.C** (records, interfaces, registration, serde tests). Publisher impl + registry projection = M9/registry milestone.

## 8. Ratification Checklist

- [x] DOCS-Project review (R6 verified sound on all three counts — see §2.1) — 2026-06-05
- [x] Nick ratification — R6 co-sign FORMALIZED 2026-06-05
- [x] Invariants registered (`Architecture_Invariants_v1.md` §29)

## 9. Review Disposition

**DOCS-Project review (2026-06-05): RATIFY-WITH-EDITS — E8 folded; R6 co-sign formalized.** Return: nexsys-hivemind `context/audits/2026-06-05_AMD-54-64_DOCS_Review_Return.md`.

- **R6 (G2 soundness):** verified sound on all three counts — (a) the serde argument holds under the AMD-52 codec discipline (`Class<?>` in a persisted payload is a reflective-typing liability and redundant with `capabilityId`); (b) nothing in the inline return contradicts entity-targeted events (the return itself classifies them "state-changing (updates entity registry)"; multi-endpoint devices force `EntityId` for deterministic projection); (c) replay self-sufficiency (AMD-59-INV-02) holds. Co-sign formalized.
- **E8 → Nick ruling (2026-06-05):** `CapabilityRemovalReason` (FIRMWARE_DOWNGRADE | DEVICE_REPLACED | TRANSIENT_LOSS | UNREGISTERED) restored from the research's REC-47 shape onto `CapabilityRemoved` + `publishRemoved(...)` — persisted records freeze at M4.C (retrofitting costs a schema-versioned amendment + upcaster; adding now costs one enum), and Research 12's Aqara field evidence makes TRANSIENT_LOSS-vs-UNREGISTERED load-bearing for consumers. Descriptive-only doctrine frozen as AMD-59-INV-06.
- Namespace deviation recorded: the return's `integration.capability_added/_removed` → `capability.added/.removed` under the separate `CapabilityEvent` hierarchy (the lifecycle parent's 5-accessor contract does not fit capability changes) — verified coherent with the project-wide dot-namespace direction.

Ratified by Nick 2026-06-05.
