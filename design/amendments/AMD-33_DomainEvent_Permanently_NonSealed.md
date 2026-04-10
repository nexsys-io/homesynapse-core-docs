# AMD-33: DomainEvent Permanently Non-Sealed — EventTypeRegistry Uses Explicit Registration

**Amendment ID:** AMD-33
**Tier:** REQUIRED (JPMS hard constraint)
**Status:** APPLIED
**Date applied:** 2026-04-10
**Target document:** Doc 01 (Event Model & Event Bus), LTD-19 (Locked Decision)
**Target sections:** Doc 01 §8.2 (Key Types), LTD-19/DECIDE-M2-01 (Type Resolution)
**Source:** M2 implementation analysis — JPMS cross-module sealed interface constraint

## Problem

Doc 01 §8.2 specifies `DomainEvent` as a "Sealed interface." LTD-19 (DECIDE-M2-01) specifies that `EventTypeRegistry` uses `DomainEvent.class.getPermittedSubclasses()` to auto-discover all event types at startup.

Neither specification can be implemented because `DomainEvent` has a subtype in a different JPMS module:

- `DomainEvent` is in named module `com.homesynapse.event` (event-model)
- `IntegrationLifecycleEvent extends DomainEvent` is in named module `com.homesynapse.integration` (integration-api)
- `IntegrationLifecycleEvent` is itself a sealed interface with 5 permitted subtypes: `IntegrationStarted`, `IntegrationStopped`, `IntegrationHealthChanged`, `IntegrationRestarted`, `IntegrationResourceExceeded`

JEP 409 (Sealed Classes) requires: "The permitted subclass must be in the same module as the sealed class if the sealed class is in a named module." Sealing `DomainEvent` and listing `IntegrationLifecycleEvent` in the `permits` clause is a Java language violation — it will not compile.

This is a hard constraint of the Java language, not a design tradeoff.

## Changes Applied

### Doc 01 §8.2 — ANNOTATE (do not edit locked text)

The table entry `DomainEvent | Sealed interface` is architecturally superseded. `DomainEvent` is permanently non-sealed due to the cross-module JPMS constraint. This amendment serves as the authoritative record of the divergence. The actual codebase implementation (non-sealed marker interface) is correct.

### LTD-19 / DECIDE-M2-01 — AMEND discovery mechanism

**Before:** "At startup, `EventTypeRegistry` uses `DomainEvent.class.getPermittedSubclasses()` to auto-discover all permitted subtypes, reads their `@EventType` annotation, and builds an immutable bidirectional map."

**After:** "At startup, `EventTypeRegistry` receives explicit class lists from each module that defines `DomainEvent` subtypes (event-model provides core event classes, integration-api provides lifecycle event classes). The registry reads each class's `@EventType` annotation and builds an immutable bidirectional map (`eventType string ↔ Class<? extends DomainEvent>`). The registry fails fast if any registered class is missing the `@EventType` annotation, if duplicate event type strings exist, or if the total count mismatches an expected total."

The `@EventType` annotation design, Jackson integration, DegradedEvent fallback, pre-warming, and all other DECIDE-M2-* decisions are unaffected.

### LTD-19 — AMEND reversal criteria

**Before:** "If `getPermittedSubclasses()` proves unreliable under JPMS (silent class loading failures), switch to explicit static registration."

**After:** Remove this clause entirely — explicit registration is now the primary mechanism, not a fallback.

### LTD-19 — AMEND choice summary

**Before:** "Registry-based type resolution using a custom `@EventType` annotation with `getPermittedSubclasses()` auto-discovery"

**After:** "Registry-based type resolution using a custom `@EventType` annotation with explicit module-level registration"

### LTD-19 — AMEND summary table

**Before (column 4):** "reversal on `IntValue`/`FloatValue` round-trip failure or `getPermittedSubclasses()` JPMS failure"

**After (column 4):** "reversal on `IntValue`/`FloatValue` round-trip failure"

## Invariant Alignment

- **INV-ES-07 (Schema evolution):** Unaffected. DegradedEvent fallback and FAIL_ON_UNKNOWN_PROPERTIES remain.
- **INV-RF-01 (Integration isolation):** Strengthened. Integration modules can define their own DomainEvent subtypes without requiring changes to the event-model module's permits clause.

## Downstream Dependencies

- **M2.1 (@EventType annotation):** Unblocked. The annotation is applied to event records regardless of sealing status.
- **M2.4 (EventTypeRegistry):** Implementation uses explicit registration instead of getPermittedSubclasses(). The registry API shape changes from zero-arg construction to builder/factory pattern accepting class lists.
- **event-model MODULE_CONTEXT.md:** Three references to potential sealing must be updated to state permanent non-sealed status.
- **DomainEvent.java Javadoc:** Must be updated to remove "will become sealed" language.
- **DomainEventTest.java:** The `isNotSealed` test becomes a permanent invariant test, not a temporary Phase 2 assertion. Its `@DisplayName` should be updated.
- **Handoff documents:** block-b and block-d reference "becomes sealed in Phase 3" — must be updated.
