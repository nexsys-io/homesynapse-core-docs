# AMD-27: Persistence Layer Platform Thread Executor Design

**Amendment ID:** AMD-27
**Tier:** CRITICAL (Virtual Thread Risk Audit)
**Status:** APPLIED
**Date applied:** 2026-03-21
**Target document:** Doc 04 (Persistence Layer)
**Target sections:** §1.1, §3.4, §3.7, §3.12, §10, §14, §15
**Source:** Virtual Thread Risk Audit Report, Step 7 — Remediations
**Depends on:** AMD-26 (LTD-01, LTD-03, LTD-11 — applied)
**Finding addressed:** C-08 (entire persistence layer assumes VT isolation via separate threads)

## Problem

Doc 04 assumed that running maintenance operations on "separate virtual threads" provided isolation from the write path. Every sqlite-jdbc operation pins its carrier thread via JNI, meaning 3 concurrent database operations (retention DELETE + aggregation query + EventPublisher append) consume 3 of 4 carrier threads on RPi 5.

## Changes Applied

1. **§1.1** — Design principle rewritten: maintenance coordinated by VTs, SQLite ops routed through platform thread executor
2. **§3.4** — Retention threading: VT coordinates, platform thread executes DELETEs
3. **§3.7** — Aggregation engine: same VT→executor pattern
4. **§3.12** — View checkpoint: full transaction submitted as single executor unit
5. **§10** — Performance target note: 0.1–0.5ms executor overhead included
6. **§14** — Decision table: retention isolation rationale corrected
7. **§15** — New rationale entry: executor is internal, hidden behind EventStore/StateStore interfaces

## Downstream

AMD-28 (Doc 01), AMD-29 (Doc 03), and downstream doc amendments for Docs 07/09/10/11/12/14 reference the executor pattern established here.
