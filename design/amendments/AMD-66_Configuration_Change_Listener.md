<!--
file: design/amendments/AMD-66_Configuration_Change_Listener.md
purpose: AMD-66 — public ConfigurationChangeListener interface for per-section reload reaction (REC-55, corrected shape).
audience: Nick (ratify), PM, Coder
status: PROPOSED 2026-06-08 — M6 config block (AMD-66..71); awaits DOCS-Project review + Nick ratification
source: Research 5 REC-55 (PM Assessment v2 FINAL: ACCEPTED IN PRINCIPLE — shape corrected, F7) + Doc 06 §3.3/§4.3
baseline: homesynapse-core HEAD `6c6dd33` (2026-06-08) — every config shape below source-verified at this commit
-->

# AMD-66: `ConfigurationChangeListener` — Per-Section Reload Reaction Interface

**Block context:** First of the six-amendment M6 configuration block (AMD-66..71), reserved per the navigation-index allocation ("AMD-66–71 reserved for the M6 config block"). Public-API addition; no persisted-shape or build change. Numbers claimed at authoring per the P2 assign-at-milestone rule.

## 1. Problem Statement

Doc 06 §3.3 (reload pipeline) and §4.3 specify that a configuration reload classifies each change as `HOT` / `INTEGRATION_RESTART` / `PROCESS_RESTART` (`ReloadClassification`, source-verified enum, 3 values) and applies it. But there is **no public seam by which a subsystem registers its intent for its own configuration section** — the reload pipeline today has the `ConfigChangeSet` (the diff) and the per-property `x-reload` JSON-Schema annotation, but no consumer-facing listener through which a subsystem (event-bus, persistence, an integration) declares *how* a change to its section should be applied at runtime. Research 5 REC-55 supplies that seam.

## 2. Specification

### 2.1 New interface (`com.homesynapse.config`)

```java
public interface ConfigurationChangeListener {

    /**
     * Returns the dotted section path this listener reacts to
     * (matches ConfigSection.path()).
     */
    String sectionPath();

    /**
     * Invoked synchronously by the reload pipeline, BEFORE any
     * config_changed observability event is published (Doc 06 §3.3),
     * when the listener's section changed between the active and the
     * candidate ConfigModel. Returns the aggregated runtime-impact
     * classification for this section's change.
     *
     * Implementations must be side-effect-free with respect to the
     * ConfigModel (INV-CE-01 — the file is the sole source of truth);
     * they classify, they do not mutate configuration.
     */
    ReloadClassification onSectionChanged(ConfigSection previous, ConfigSection candidate);
}
```

### 2.2 Corrected shape (F7 — the v1 sealed-generic design was unsound)

Research 5 REC-55 originally proposed `sealed interface ConfigurationChangeListener<S extends ConfigSection> permits Hot, RequiresRestart`. **That shape does not compile** (PM Assessment v2 F7): `ConfigSection` is a `record` and records are implicitly `final`, so the bound `<S extends ConfigSection>` is unsatisfiable, and the `Hot<S>`/`RequiresRestart<S>` markers inherit the broken bound. The corrected shape is a **plain, non-generic, non-sealed interface** that receives `ConfigSection` directly and conveys the Hot-vs-restart distinction through its **`ReloadClassification` return value** — the type-system enforcement the markers attempted is redundant with the return enum.

### 2.3 No-listener fallback (PM decision — diverges from REC-55's suggested default)

When **no** `ConfigurationChangeListener` is registered for a changed section, the reload pipeline falls back to the **existing per-property `x-reload` classification**, whose locked default for unannotated properties is **`PROCESS_RESTART`** (`ReloadClassification` Javadoc, source-verified). This **overrides** Research 5 v2's suggested `INTEGRATION_RESTART` listener-absent default: `PROCESS_RESTART` is the safe-by-default choice (it guarantees the change takes effect and is the disruptive-but-correct option for unclassified core config), and it preserves consistency with the already-locked `ReloadClassification` contract rather than introducing a second, conflicting default. Flagged for the DOCS review as a conscious correction (`[REVIEW-FLAG AMD-66-A]`).

### 2.4 Registration

Listeners are registered with `ConfigurationService` at composition time (constructor-injected map keyed by `sectionPath()`, no `ServiceLoader` — consistent with the DEC-M3-16 / REC-28 no-`ServiceLoader` discipline). At most one listener per section path; a duplicate registration is a construction-time error.

## 3. Downstream Impact

- **`ConfigurationService`** gains the registration surface and invokes registered listeners inside `reload()` (Doc 06 §3.3), synchronously, before publishing the reload observability event (AMD-70). No change to `load()`.
- **No persisted-shape change.** `ConfigurationChangeListener` is a runtime interface; nothing serializes.
- **No JPMS change.** The interface lives in the already-exported `com.homesynapse.config`; it references only `ConfigSection` and `ReloadClassification`, both same-module. The verbatim `module-info.java` (§7) is unchanged.

## 4. Implementation Notes

The synchronous-before-publish contract (§2.1) matches Doc 06 §3.3's ordering: classification must complete before observers see the change so the published reload event carries the resolved per-section classifications. Listener exceptions must not corrupt the active model — a throwing listener fails the reload candidate (the active `ConfigModel` is preserved, the §3.3 reject-and-keep-prior-good-state semantics), and is surfaced as a reload issue.

## 5. Tests (M6 scope)

| Test | Assertion |
|---|---|
| `ConfigurationChangeListenerTest.returnsClassification` | a registered listener's `onSectionChanged` return drives the section's applied classification |
| `…noListenerFallsBackToPropertyDefault` | unregistered changed section → per-property `x-reload`; unannotated → `PROCESS_RESTART` (§2.3) |
| `…syncBeforePublish` | listener invoked before the reload event is published (ordering, Doc 06 §3.3) |
| `…throwingListenerRejectsCandidate` | a throwing listener preserves the active model (no partial apply) |
| `…duplicateRegistrationRejected` | two listeners for one section path → construction-time `IllegalArgumentException` |

## 6. Scope Fences / Deferred

NO change to `ReloadClassification` (the 3 values are locked). NO hot-swap *mechanism* (that is M6.4 atomic-swap implementation, not this contract). NO generics, NO sealed hierarchy (F7).

## 7. Invariants and Citations

- **AMD-66-INV-01:** a `ConfigurationChangeListener` classifies a section change and is forbidden from mutating the `ConfigModel` (INV-CE-01 — the YAML file is the sole source of truth).
- **AMD-66-INV-02:** classification is synchronous and completes before the reload observability event is published (Doc 06 §3.3 ordering).
- Cites: Doc 06 §3.3/§4.3; `ReloadClassification` (locked, 3 values); INV-CE-01; PM Assessment v2 F7 (corrected shape); DEC-M3-16 (no `ServiceLoader`).

**Verbatim `module-info.java` (`com.homesynapse.config`, at `6c6dd33`) — unchanged by this AMD:**

```java
module com.homesynapse.config {
    requires transitive com.homesynapse.event;

    exports com.homesynapse.config;
}
```

## 8. Implementing WU

**M6.1** (config pipeline) defines and registers the interface; M6.4 (hot-reload atomic swap) exercises it under the swap. No crypto gate.

## 9. Ratification Checklist

- [ ] DOCS-Project review returned; deltas folded
- [ ] Nick ratification
- [ ] AMD-66-INV-01/02 registered in `Architecture_Invariants_v1.md`
- [ ] Navigation-index amendments row added (watermark unchanged — 66 < 87)

## 10. Review Disposition

_Pending DOCS-Project review (M6 config block AMD-66..71)._ Open flag for review: `[REVIEW-FLAG AMD-66-A]` — the §2.3 no-listener default (`PROCESS_RESTART`, not REC-55's `INTEGRATION_RESTART`).
