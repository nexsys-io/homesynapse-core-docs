<!--
file: design/amendments/AMD-59_Capability_Events_and_Publisher.md
purpose: AMD-59 — CapabilityAdded/CapabilityRemoved events + CapabilityPublisher contract + DiscoveryServices aggregator (REC-47 per ratified NQ-3/NQ-4).
audience: Nick (ratify), PM, Coder
status: PROPOSED — pending DOCS-Project review + Nick ratification (Workstream C block, AMD-54..64)
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

> **[REVIEW-FLAG R6 — serialization-driven refinement of the NQ-3 sketch.]** The NQ-3 lean sketched `CapabilityAdded(integration, device, capability: Class<? extends Capability>, instance, ts)`. Authoring against the shipped serde surface (AMD-52's codec discipline) found two corrections: (a) a `Class<?>` component in a **persisted** event payload is a reflection/serde liability (Class→FQN string→`Class.forName` on decode) and is redundant — `CapabilityInstance.capabilityId` already carries the type identity in its persisted form; (b) the `ts` field duplicates the envelope's `eventTime` (house rule — no payload timestamps); (c) an `EntityId` component is required — capabilities live on **Entity**, and the projection cannot deterministically target an entity from `DeviceId` alone (multi-endpoint devices map one device → many entities). The records below therefore carry `entityId` + the string/instance identities, and `Class<? extends Capability>` remains the **API-level** typed identity (§2.3 publisher). This honors NQ-3's substance (no new wrapper; permit-class + instance as identity) while keeping the payload codec-clean. Nick + review to confirm.

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
        String capabilityId                  // removal needs only the identity
) implements CapabilityEvent { }
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
    void publishRemoved(EntityId entityId, String capabilityId);
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
| `CapabilityEventTest` (new) | accessor contract incl. `CapabilityAdded.capabilityId() == instance.capabilityId()`; compact-ctor null guards |
| `StubIntegrationContextTest` (extended) | `discovery` defaults null; builder override works |

## 5. Scope Fences / Deferred

NO publisher implementation, NO registry projection handler, NO `DispatchingProjectionAdvancer` registration (the registry projection is an entity-registry concern — its implementing milestone owns the handler), NO automation triggers. M4.C ships records + interfaces + registration + serde tests only.

## 6. Invariants and Citations

- **AMD-59-INV-01:** capability events are the only post-adoption mutation path for `Entity.capabilities`; no API or registry method mutates the list outside the event-sourced path. No capability SQLite table exists.
- **AMD-59-INV-02:** `CapabilityAdded` carries the complete `CapabilityInstance` — replay reconstructs `Entity.capabilities` from the log alone (replay self-sufficiency).
- **AMD-59-INV-03:** no `CapabilityId` wrapper type exists; capability type identity is the permit class (in-JVM) and `String capabilityId` (persisted).
- **AMD-59-INV-04:** `EntityId` is stable across capability add/remove (no identity churn).
- **AMD-59-INV-05:** `CapabilityPublisher` is integration-scoped (LTD-17): publishes only for entities owned by the calling adapter's integration.
- Cites: NQ-3/NQ-4 (RESOLVED 2026-06-04); Research 8 REC-23/26/28; AMD-33; AMD-44 (EntityId stability doctrine); LTD-17; DECIDE-04 (manifest registration).

Module-info: unchanged — see AMD-54 §7 verbatim embed.

## 7. Implementing WU

**M4.C** (records, interfaces, registration, serde tests). Publisher impl + registry projection = M9/registry milestone.

## 8. Ratification Checklist

- [ ] DOCS-Project review (**R6: the payload-shape refinement vs the NQ-3 sketch — soundness verification; PRE-CO-SIGNED by Nick 2026-06-05** [rationale endorsed: persisted events are pure data — `Class<?>` is a replay/serde liability; payload timestamps violate envelope-owns-time; `EntityId` forced by the NQ-4 projection target]. Formal co-sign at ratification.)
- [ ] Nick ratification (formalizes the R6 pre-co-sign)
- [ ] Invariants registered

## 9. Review Disposition

*(populated at ratification)*
