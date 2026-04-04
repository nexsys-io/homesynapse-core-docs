# AMD-31: Command Execution Order Guarantees

**Amendment ID:** AMD-31
**Tier:** REQUIRED (Automation Engine Critical Review)
**Status:** APPLIED
**Date applied:** 2026-04-04
**Target document:** Doc 07 (Automation Engine)
**Target sections:** §3.9 (Action Execution), §3.11.1 (Command Dispatch Service)
**Source:** AUTOMATION_ENGINE_CRITICAL_REVIEW.md Issues 3.1 (Race Condition Between Action Execution and Command Dispatch) and 3.2 (No Ordering Guarantee Across Multiple Entities)

## Problem

Doc 07 §3.9 states that "actions execute sequentially within a Run's virtual thread" but does not specify:

1. **Cross-action ordering:** Whether commands issued by action N are guaranteed to be dispatched before action N+1's commands. The automation_engine subscriber and command_dispatch_service subscriber are independent — without an explicit guarantee, a reader cannot determine whether dispatch order matches issue order.

2. **Multi-target ordering within an action:** When a single action targets multiple entities (via area/label/type selectors), the design says "each entity in the resolved set receives the command" but does not specify the order in which `command_issued` events are produced. Non-deterministic ordering would violate Design Principle P4 (deterministic execution order) and could cause safety-critical sequencing issues (e.g., exhaust fan before gas valve).

These gaps violate INV-TO-02 (automation determinism) because identical configurations and event streams could produce differently-ordered command sequences depending on iterator order or scheduler timing.

## Changes Applied

### §3.9 Action Execution — INSERT after "Command action target resolution" paragraph

Added "Execution order guarantees" subsection establishing three ordering invariants:

1. **Within a Run:** Actions execute sequentially. The `command_issued` event for action N is appended to the event log before action N+1 begins execution. Because `EventPublisher.publish()` is synchronous and durable-before-return (Doc 01 §8.3, INV-ES-04), the command is persisted in the log before the next action runs.

2. **Within a multi-target action:** Target entities are processed in deterministic order — by entity ULID ascending (Crockford Base32 lexicographic order, which corresponds to creation/registration chronological order). The `command_issued` events are appended in this order. This provides a stable, repeatable ordering for safety-critical sequences.

3. **Across subscribers:** The `command_dispatch_service` subscriber processes events in log order (global_position ascending). Since all `command_issued` events from a Run are appended in action-then-target order, and the dispatch subscriber processes in log order, commands are dispatched in the order they were issued.

### §3.11.1 Command Dispatch Service — INSERT after subscription filter

Added explicit statement that the dispatch service processes commands in event log order, preserving the issue-order guarantees established in §3.9.

## Invariant Alignment

- **INV-TO-02 (Automation Determinism):** Identical configurations and event streams now produce identically-ordered command sequences.
- **INV-ES-04 (Write-ahead persistence):** EventPublisher.publish() durability guarantees underpin the cross-action ordering.
- **Design Principle P4 (Deterministic execution order):** Multi-target ULID ordering provides explicit, repeatable dispatch order.

## Downstream Dependencies

None. This amendment adds specification text only — no new types, no interface changes, no field additions. Phase 3 implementation must respect the ordering guarantees.
