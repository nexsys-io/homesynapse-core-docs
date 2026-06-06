# Research 10: Typed Attribute Change-Detection Semantics for State Derivation — Per-Type Equality, Replay-Safe Comparison, and the Deadband Question
*Target: HomeSynapse Core M4 (M4.0b-2 / M4.B3). Date: 2026-05-29.*

## 1. Executive Summary [M]

- **Change-detection must compare TYPED AttributeValues, not stringified values — this is the single highest-impact finding.** The current `rawValue().toString()` + `Objects.equals` path is lossy and noisy (21.0 vs 21.00, unit drift, float jitter), and every spurious `state_changed` inflates `stateVersion` and — once M7 automation lands — wakes triggers incorrectly; typed comparison is the correct fix and belongs in M4.0b-2.
- **Per-type equality is the right MVP policy; per-attribute deadbands should be DEFERRED past M4.** Boolean/Enum/String/Int use exact equality; Float and Quantity use a fixed comparison epsilon; Array uses order-sensitive element-wise equality; Degraded is inert. A configurable significant-change deadband is real engineering (Home Assistant, ZCL, Z-Wave all do it) but is a separable feature that does not block M4.
- **Every mature platform that defines "significant change" does so per-type/per-domain, never globally.** Home Assistant's `async_check_significant_change` switches on device class (0.5 °C for temperature, 1.0 for battery/humidity); ZCL Configure Reporting carries a per-attribute `reportable change`; Z-Wave uses per-device threshold config parameters. This validates a per-type comparison policy as the floor.
- **The replay-safety constraint (AMD-41 §3.2.2) categorically rules out the most common deadband techniques.** Time-based deadbands, "report at most every N seconds," rate-of-change windows, and swinging-door compression all depend on wall-clock or processing rate and MUST be rejected; only a *value-magnitude* deadband (|new − prior| ≥ threshold) is pure and replay-safe.
- **QuantityValue requires unit normalization before comparison, which implies a units decision.** Comparing 21.0 °C to 294.15 K must yield "unchanged." A minimal hand-rolled canonical-unit normalizer avoids a dependency; adopting `javax.measure`/Indriya is cleaner but triggers the LTD-10 version-catalog amendment process — flagged as a Nick call.
- **Keep comparison epsilon, stored precision, and display rounding strictly separate.** Comparison epsilon answers "is it a change?"; stored precision is what we materialize in the attribute store; display rounding is a UI concern and explicitly NOT ours. Conflating them is the classic source of "121.45 rounds to 121.5 but didn't trigger" bugs.

## 2. Platform / Literature Deep Dives [M]

### Home Assistant — `significant_change` (closest direct analog)
HA exports state to downstream services and filters insignificant changes through a per-platform `significant_change.py` defining `async_check_significant_change(hass, old_state: str, old_attrs: dict, new_state: str, new_attrs: dict, **kwargs) -> bool | None`. The developer docs (last updated May 23, 2024) state the function "should return a boolean if it is significant or not, or `None` if the function doesn't know," and give examples of *insignificant* changes, verbatim: "A battery that loses 0.1 % charge / A temperature sensor that changes 0.1 Celsius / A light that changes 2 brightness." (developers.home-assistant.io/docs/core/platform/significant_change/)

The sensor implementation switches on device class with hard-coded absolute (and sometimes relative) tolerances. Verbatim from `homeassistant/components/sensor/significant_change.py` (dev branch):
- Temperature: `absolute_change = 1.0` if Fahrenheit else `0.5`
- Battery/Humidity: `absolute_change = 1.0`
- AQI/CO/CO2/PM25/PM10/VOC: `absolute_change = 1.0` and `percentage_change = 2.0` (both must hold via `_absolute_and_relative_change`)
- Invalid new float → return `False` (don't report); invalid old float → return `True` (report again); no device class → return `None`.

**Pain points:** HA's logic is per-domain and centralized in core; community threads show users wanting significant-change filtering at the device/ESPHome level and not finding per-entity config. The model also depends on `device_class` being present — absent it, the function abstains (`None`).
**HomeSynapse lesson:** The per-type tolerance table is exactly the shape of our per-permit comparison policy. The `None` ("don't know") tri-state is a useful design idea, but our rule must be *total* (deterministic) — we cannot abstain; we default to exact/epsilon equality. The 0.5 °C default is a sane reference for a future temperature deadband.

### Matter — Reportable / Quieter Reporting Quality
Matter attributes carry a "Reportable" quality and (from Matter 1.3/1.4) a "Quieter Reporting" quality. Section numbering (confirmed against CSA primary-source PDF tables of contents): in the Matter 1.4 Core Spec, **§7.7.7 Reportable Quality** and **§7.7.8 Quieter Reporting Quality** (both p. 432); in Matter 1.3, both at p. 389. (Earlier 1.1/1.2 used §7.7.5 Reportable Quality + §7.7.6 Changes Omitted Quality — VERIFY the exact section number against the spec version you cite.) The full verbatim definitional text of §7.7.7/§7.7.8 could not be extracted from the gated CSA PDFs in this research (the 1.4 PDF disallows automated access via robots.txt; the 1.3 PDF exceeds the fetch size limit and returns only front matter). The definitions below are from official CSA secondary sources and should be VERIFIED against the spec body, ideally via the open-source AsciiDoc at github.com/CHIP-Specifications/connectedhomeip-spec (`src/data_model/`).

CSA's official description (csa-iot.org/newsroom/matter-1-4-2): "Matter 1.4.2 extends 'Quieter Reporting,' a data model optimization that defines when and how often devices should report attribute changes... By avoiding unnecessary updates, such as repeatedly reporting time remaining on a timer or intermediate values during a long transition, devices can reduce network utilization and extend battery life." Subscriptions carry a min interval floor and max interval ceiling (Matter Handbook, Interaction Model): "Min Interval Floor: the minimum interval between reports. Max Interval Ceiling: the maximum interval between reports."

**Pain points:** Report flooding is real — intermediate dimming values (1%, 2%, 3%…) are the canonical noise source Quieter Reporting suppresses (matter-smarthome.de: "lamps dimming or blinds moving will send fewer intermediate values (1%, 2%, 3% …)"). Community reports describe Matter hubs being made "sluggish" by ~100 CurrentLevel reports in 2 seconds during transitions. (A widely-repeated claim that HA's python-matter-server set the subscription floor to 1 second in "PR #891" while SmartThings used 0 could **not** be confirmed against a primary source in this research — **VERIFY before citing**.)
**HomeSynapse lesson:** Matter separates *interval* gating (time-based — forbidden for us) from *value-significance* gating (Quieter Reporting suppressing predictable/intermediate values). We can adopt the value-significance idea but NOT the interval mechanism. The "intermediate value during a transition" insight maps onto our concern that a noisy sensor floods `state_changed`.

### Zigbee Cluster Library (ZCL) — Configure Reporting
ZCL's Configure Reporting command carries, per attribute: minimum reporting interval, maximum reporting interval, and a **reportable change** field. From the Atmel/Microchip application note AT08550: "An attribute can be configured to be reported by the stack when the difference between its current value and previously reported one exceeds a certain threshold – so called reportable change parameter... For example a thermostat might request a remote temperature sensor to send attribute reports when room temperature changes (in any direction) more than by 0.5 degree." Critically (ESP-Zigbee SDK / ZCL spec): "The reportable change field specifies the minimum change to the attribute value that will trigger a report. **The attributes with data types of array, structure, set or bag cannot be reported.**" The reportable change field "has the same data type as the attribute value data type."

**Pain points:** Many devices don't support Configure Reporting (e.g., some Xiaomi WSDCGQ11LM sensors); reporting config is not persisted across reboots on some stacks; chatty sensors (Tuya motion) stress Raspberry-Pi-class hubs.
**HomeSynapse lesson:** Two durable principles: (1) the reportable-change threshold is *typed* — same type as the attribute, i.e., a per-type concept, validating our per-permit approach; (2) **ZCL forbids change-reporting on arrays/structures/sets entirely** — strong prior art that ArrayValue should use whole-value replacement semantics (REC-27), not element-wise deadband. Threshold "in any direction" = absolute magnitude deadband, which is replay-safe.

### Z-Wave — reporting threshold configuration parameters
Z-Wave devices expose per-sensor threshold config. Zooz ZSE44 (Parameter 3), verbatim from Zooz Support KB article 853: "Set the reporting threshold for your temperature sensor. The device will report any changes in temperature once the reading exceeds the value from this setting compared to the last report. Values: 10 – 100 (degrees Fahrenheit, where value 10 equals 1 degree). Default: 20 (2 degrees). Size: 1 byte dec." (The newer ZSE44 800LR manual lists Default: 10 = 1 degree — version-dependent.) Aeotec aërQ: "This value defines the minimum change of temperature to cause an unsolicited report... If the value is set to 0, there will be no reports sent... Temperature is checked once every 15 minutes." Eurotronic Spirit: "Per default the reporting threshold is ±0.5°C." The Aeotec MultiSensor 6 (OpenZWave config) encodes threshold AND unit in one parameter: "BB contains the temperature threshold with one decimal point... CC contains the unit: 01 for Celsius, 02 for Fahrenheit."

**Pain points:** Unit drift and conversion error — a Qubino manual warns: "Fahrenheit values will be converted to Celsius degrees. Due to conversion algorithm please be advised that configuration value could drift when converting values back and forth." A Z-Wave JS bug (home-assistant/core #106807) shows a temperature threshold that only accepts integers, blocking 0.5/0.1 °C precision.
**HomeSynapse lesson:** Per-attribute thresholds are normal in the field, and they bundle threshold + unit — reinforcing that QuantityValue comparison must be unit-aware. The "drift when converting back and forth" warning is a direct caution for our unit-normalization step: normalize to one canonical unit, don't round-trip.

### Time-series historians — OSIsoft/AVEVA PI swinging-door, exception & compression
PI uses two deadbands. Exception (ExcDev): "The interface sends the new value to the PI Server only if it is different from the previous value by an amount larger than the value in the ExcDev attribute. Exception reporting uses a simple deadband algorithm." Compression (CompDev) uses the swinging-door algorithm whose goal is "to filter out instrument and process noise and still record significant process changes." Guidance: "Set ExcDev = ½ CompDev"; "OSIsoft recommends setting exception deviation to a value slightly less than the precision of the instrument." For non-analog types: "For digital, string and Blob tags, ExcDev and ExcDevPercent are set to zero and ignored."

**Pain points:** PI's own user community documents the rounding-vs-threshold trap: a value going 121.44 → 121.45 (which rounds to 121.5, crossing a spec limit) may NOT trigger exception/compression because the *raw* delta is below deadband — the canonical illustration that comparison epsilon and display rounding are different things. Swinging-door is inherently stateful and time-aware.
**HomeSynapse lesson:** PI is the mature theory of "is this a meaningful change," and it confirms (a) deadbands are typed (off for digital/string), (b) exception (simple value deadband) is replay-safe in principle but compression (swinging-door) is NOT — it depends on time and a moving corridor. We may borrow the *simple exception deadband* concept later; we must reject swinging-door outright.

### Units libraries — javax.measure (JSR-385) / Indriya (optional, dependency-gated)
Indriya is the JSR-385 reference implementation. (JSR-385, the Units of Measurement API 2.0, released version 2.1 in February 2022 and version 2.2 in May 2024, per the Belief Driven Design JSR-385 overview; the current Indriya RI is `tech.units:indriya:2.2.3` per the official Indriya site.) Its `AbstractQuantity` documents the critical equality subtlety: "Similarly to the `BigDecimal#equals` method which considers 2.0 and 2.00 as different objects because of different internal scales, quantities such as `Quantities.getQuantity(3.0, KILOGRAM)` ... and `Quantities.getQuantity("3 kg")` might not be considered equals." It directs callers to `compareTo`/`isEquivalentTo` for cross-unit comparison: `compareTo` converts `that.to(this.getUnit())` before comparing. `ComparableQuantity.isEquivalentTo` "Compares... doing the conversion of unit if necessary."

**HomeSynapse lesson:** This is exactly our QuantityValue problem in a library: strict `equals` is scale/unit-sensitive (so 21.0 ≠ 21.00, °C ≠ K) and you must convert-then-compare. We can either depend on Indriya (LTD-10 amendment) or hand-roll a tiny canonical-unit normalizer for the handful of physical quantities M4 actually needs. NaN/Infinity: Indriya rejects `Double.POSITIVE_INFINITY`/`NaN` at construction (`IllegalArgumentException`), a useful precedent for our FloatValue/QuantityValue validation.

### CDC / Debezium (dedup prior art)
Debezium delivers at-least-once and explicitly pushes deduplication to consumers: "Debezium guarantees every single change will be delivered... in case of failures, restarts or DB connection drops, the same event can be delivered more than once." **HomeSynapse lesson:** Our `stateVersion` idempotency cursor already plays the dedup role; the lesson is that a no-op "update" (before == after) should ideally not produce a downstream event at all — which is precisely what typed change-detection achieves at the source rather than downstream.

## 3. Cross-Cutting Analysis [M]

### Concept-mapping table
| HomeSynapse AttributeValue | HA device-class tolerance | Matter reportable change | ZCL reportable change | Time-series (PI) deadband |
|---|---|---|---|---|
| BooleanValue | n/a (state string exact) | On/Off reported on change | Boolean: no reportable-change, on-change only | Digital: ExcDev/CompDev = 0, ignored |
| EnumValue | exact (state string) | enum on-change | enum not deadbanded | String/digital: deadband ignored |
| StringValue | exact | string on-change | string not reportable-by-change | String: deadband ignored |
| IntValue | absolute_change (e.g. battery 1) | analog reportable change | reportable change, same type | ExcDev in engineering units |
| FloatValue | absolute (temp 0.5/1.0) + sometimes % | analog, quantized | reportable change, same type | ExcDev ≈ < instrument precision |
| QuantityValue | tolerance + unit (HA tracks unit_of_measurement) | analog + units | threshold encodes value+unit (Z-Wave) | ExcDev in eng. units (unit-fixed) |
| ArrayValue | n/a | n/a | **forbidden** (array/struct/set not reportable) | n/a |
| DegradedAttributeValue | maps to unknown/unavailable handling | n/a | n/a | n/a |

### Gap analysis
The existing EchoStateRule does string equality, which collapses all eight (current and planned) permits onto one lossy comparison. Gaps: (1) no typed comparison → 21.0/21.00 false positives; (2) no unit awareness → °C/K false negatives or positives; (3) no float epsilon → IEEE-754 jitter false positives; (4) no array semantics → arrays compared by `toString` ordering accidentally; (5) materialized store coerces everything to `StringValue`, destroying type on write so the *next* comparison is string-on-string regardless.

### Over-abstraction analysis: is a per-attribute deadband worth it for MVP?
**No, not for M4.** The platforms prove deadbands are valuable, but they are a *separable* concern from correct equality. The minimum correct behavior is: typed equality with a fixed float/quantity epsilon to absorb representation jitter. That alone eliminates the 21.0-vs-21.00 and float-jitter false positives — the bulk of the noise — without any schema work. A *configurable* deadband (per-attribute threshold like ZCL/Z-Wave) addresses a different problem: a genuinely-changing-but-insignificant sensor (21.0 → 21.1 → 21.0). That problem only bites once M7 triggers exist and only for continuously-reporting analog sensors. Building deadband config into CapabilityInstance now is speculative generality before there's a consumer. Ship exact-equality-with-epsilon in M4; revisit deadband as a dedicated tier when M7 is briefed.

### Competitive assessment
HomeSynapse's event-sourced, replay-safe constraint is *stricter* than any surveyed platform: HA, Matter, ZCL, Z-Wave and PI all freely use wall-clock and rate gating because they are live pipelines, not deterministic replays. This means HomeSynapse can adopt their *value-magnitude* logic but must discard their *temporal* logic. The good news: the value-magnitude core (typed equality + absolute deadband) is the part that's both portable and replay-safe.

## 4. Amendment Recommendations [M]

### REC-90 — Typed per-permit comparison policy (replace string comparison)
- **Gap:** EchoStateRule stringifies via `rawValue().toString()` and compares with `Objects.equals`, which is lossy/noisy across the expanding sealed hierarchy.
- **Lesson source:** HA per-device-class tolerance table; ZCL typed reportable-change; Indriya scale-sensitive `equals`.
- **Change:** Introduce a total `AttributeValue.changedFrom(prior)` (or a static `AttributeComparator`) defining, per permit:
  - **BooleanValue, IntValue, EnumValue:** exact equality on the typed payload. Enum compared by canonical token (case-sensitive — enums are closed sets; do NOT case-fold).
  - **StringValue:** exact equality, no trimming/case-folding by default (whitespace and case ARE semantically meaningful for opaque strings); null/empty handled explicitly.
  - **FloatValue:** equality within a fixed comparison epsilon (see REC-94); `NaN`→`NaN` treated as unchanged (both NaN = equal); `-0.0` and `0.0` treated as equal; transition to/from NaN counts as a change.
  - **QuantityValue:** normalize both operands to the canonical unit (REC-93), then compare magnitudes within epsilon. Different physical dimensions ⇒ changed (and log; this signals adapter error).
  - **ArrayValue:** order-sensitive, size-then-element-wise deep equality on element AttributeValues; any element/length/order difference = changed (full-replacement semantics per REC-27).
  - **DegradedAttributeValue:** inert — a transition *into* Degraded does NOT emit `state_changed` (it is a deserialization fallback, not a semantic value change), and Degraded-to-Degraded is unchanged; a transition *out of* Degraded to a real value is evaluated normally. (VERIFY DegradedAttributeValue accessor shape against source.)
- **Backward-compat:** EchoStateRule is a testFixture; the production DerivationRule adopting typed comparison changes *which* `state_changed` events are emitted (fewer). Replay over historical logs will produce fewer `state_changed` and lower `stateVersion` growth — this is a semantic change to projection output and MUST be gated behind the M4 projection version (re-derivation, not silent in-place).
- **Effort:** M (one comparator with 8 branches + tests).
- **Target WU:** M4.0b-2 (Workstream A).

### REC-91 — StateChangedEvent carries typed old/new values; materialized store preserves type
- **Gap:** `StateChangedEvent` carries `oldValue`/`newValue` as Strings; `applyToState` writes `new StringValue(value)` regardless of source type, so type is destroyed on materialization and every subsequent comparison degrades to string-on-string.
- **Lesson source:** Debezium before/after typed payloads; Indriya (string round-tripping loses scale/unit).
- **Change:** Change `StateChangedEvent.oldValue/newValue` from `String` to `AttributeValue` (serialized via the existing AttributeValue codec / AttributeValueUpcaster SPI, REC-29). Change `applyToState` to store the inbound typed `AttributeValue` rather than coercing to `StringValue`. Downstream M7 conditions/triggers then receive typed values.
- **Backward-compat:** BREAKING to the `StateChangedEvent` schema and to the materialized attribute store. Requires an event upcaster (old String → typed; best-effort parse, fall back to `StringValue` or `DegradedAttributeValue`). Storage cost rises modestly (typed envelope vs bare string) — acceptable on Pi-class hardware. This is the highest-risk REC; sequence it with REC-29's upcaster.
- **Effort:** L (schema change + upcaster + store migration + serialization round-trip tests).
- **Target WU:** M4.B3 (Workstream B), co-sequenced with AttributeValue expansion.

### REC-92 — Defer configurable per-attribute deadband to a post-M4 tier
- **Gap:** Continuously-reporting analog sensors (temperature every N seconds) will emit genuine-but-insignificant `state_changed` (21.0→21.1→21.0), inflating `stateVersion` and (in M7) waking triggers.
- **Lesson source:** HA significant_change (0.5 °C), ZCL reportable change, Z-Wave threshold params, PI ExcDev.
- **Change:** Do NOT add deadband config to CapabilityInstance in M4. Record the design intent: a future per-attribute `reportableChange` (absolute magnitude, typed, replay-safe) declared on the attribute schema, defaulting to "exact/epsilon" (no deadband). Revisit when M7 automation is briefed and there is a concrete trigger consumer.
- **Backward-compat:** None now (deferral). Future addition is additive (defaulting to current behavior).
- **Effort:** S now (documentation only); M later.
- **Target WU:** Deferred (note in M4.B3 design doc; not implemented in M4).

### REC-93 — Canonical-unit normalization for QuantityValue (hand-rolled minimal; units lib gated by LTD-10)
- **Gap:** QuantityValue comparison must treat 21.0 °C and 294.15 K as equal and must not false-positive on unit-only differences; there is no normalization step today.
- **Lesson source:** Indriya `compareTo`/`isEquivalentTo` (convert-then-compare); Z-Wave threshold+unit encoding; Z-Wave "drift when converting back and forth" warning.
- **Change:** Define a canonical unit per physical dimension that M4 actually uses (VERIFY which dimensions QuantityValue supports against source — do not invent). Normalize both operands to canonical unit once, compare magnitudes with epsilon (REC-94). Prefer a small internal normalizer (linear scale+offset table) over a dependency for the limited M4 unit set; do NOT round-trip conversions. **Dependency flag (LTD-10):** adopting `tech.units:indriya` (current RI `2.2.3`, JSR-385) is the cleaner long-term path but is a version-catalog amendment governed by LTD-10 and is Nick's call; it adds a transitive dependency surface for a Pi runtime. Recommendation: hand-roll for M4, table the Indriya decision for a later research/amendment.
- **Backward-compat:** New behavior for a new type (QuantityValue is added in M4); no existing behavior changes.
- **Effort:** M (normalizer + unit table + tests) hand-rolled; L if Indriya integration + LTD-10 process.
- **Target WU:** M4.B3.

### REC-94 — Single coherent floating-point policy: distinct comparison epsilon, stored precision, display rounding
- **Gap:** Float/Quantity comparison risks conflating "is it a change?" with "what do we store?" and "what do we show?", reproducing the PI 121.44→121.45 trap.
- **Lesson source:** PI ExcDev-vs-rounding bug; Java float-comparison literature (`Math.abs(a-b) <= epsilon`; `Double.compare` equal only when bit-identical); Indriya scale-sensitivity.
- **Change:** Adopt three explicitly separate policies:
  1. **Comparison epsilon (is it a change?):** a small fixed epsilon applied ONLY inside the comparator. Recommend a *hybrid absolute-or-relative* test (`|a−b| ≤ max(absEps, relEps·max(|a|,|b|))`) so it behaves for both near-zero and large magnitudes; the exact constants are Nick's call (VERIFY chosen values). Pure, deterministic. This is the only float tolerance in change-detection in M4 (no configurable deadband — REC-92).
  2. **Stored precision (what we materialize):** store the inbound value verbatim (no rounding) as the typed AttributeValue; do not quantize on write. The comparator's epsilon does not alter what is stored.
  3. **Display rounding (NOT our concern):** explicitly out of scope — formatting for UI/logs happens at the presentation layer and must never feed back into comparison or storage. Stated here only to prevent conflation.
- **Backward-compat:** Defines previously-undefined behavior; no existing typed path to break.
- **Effort:** S (constants + doc + tests).
- **Target WU:** M4.0b-2 (the epsilon ships with REC-90's comparator).

## 5. Caveats and Open Questions [M]

### Determinism rejections (hard constraint, AMD-41 §3.2.2)
The comparison re-executes on every replay and must be a pure function of (prior canonical value, inbound reported value). The following techniques are **explicitly REJECTED** because they depend on wall-clock, processing rate, or external state:
- **Time-based deadbands / "report at most every N seconds" / min-report-interval gating** (ZCL min/max interval, Matter min-interval floor, Z-Wave periodic reporting) — depend on wall-clock; non-replayable.
- **Rate-of-change windows / moving averages / debounce** — depend on event arrival timing.
- **Swinging-door / PI compression (CompDev)** — stateful, time-aware corridor; not a pure function of two values.
- **"Report at most every N events" counters that persist outside EntityState** — external mutable state.
- **`Instant.now()` or injected `Clock` reads inside the comparator** — even though DerivationContext carries a Clock, the comparator MUST NOT read it; eventTime is inherited from the causing envelope.
Only a **value-magnitude comparison** (exact, or `|new − prior| ≥ threshold` on normalized typed values) is permitted, because it is a pure function of the two values and is identical on every replay.

### What needs Nick's call vs. what the literature settles
- **Literature settles:** per-type comparison is correct (HA, ZCL, Z-Wave all per-type); arrays should not be deadbanded (ZCL forbids change-reporting on array/struct/set); deadbands are typed and off for boolean/string (PI, ZCL); convert-then-compare for units (Indriya, Z-Wave).
- **Needs Nick's call:** (1) whether to adopt a units library (Indriya) vs hand-roll — **LTD-10 dependency decision**; (2) the exact comparison epsilon constants and whether absolute, relative, hybrid, or ULP-based; (3) whether REC-91's typed-payload break is sequenced into M4.B3 or split into its own WU; (4) the eventual per-attribute deadband schema home (CapabilityInstance attributes schema — VERIFY exact shape before adding a field) and its default; (5) the precise Degraded-transition semantics (does *entering* Degraded ever warrant a signal for observability, even if not a "value change"?).

### Conflicts with the verified inventory
No direct conflict. All RECs operate over the source-verified 5 existing permits (BooleanValue, IntValue, FloatValue, StringValue, EnumValue) plus the three M4 additions (QuantityValue, ArrayValue, DegradedAttributeValue). I have NOT assumed any phantom types (no LongValue/DoubleValue/InstantValue/JsonValue). Accessor/field names on QuantityValue (magnitude/unit), ArrayValue (elements), and DegradedAttributeValue, and the exact CapabilityInstance attributes-schema shape, are flagged **VERIFY against source** wherever a concrete field is proposed.

### Dependency (LTD-10) implications
Adopting `javax.measure`/Indriya (current RI `tech.units:indriya:2.2.3`) for unit normalization is the only place this research touches a new dependency. It is **gated by LTD-10** (version-catalog amendment). Recommendation: hand-roll a minimal normalizer for M4 to avoid the amendment on the M4 critical path; raise Indriya as a separate amendment if the unit set grows.

### Unverified primary-source items (for Claude Cowork)
- Matter §7.7.7/§7.7.8 verbatim definitional text was not extracted (gated CSA PDFs); section numbers/pages confirmed from the ToC; definitions paraphrased from CSA newsroom — **VERIFY body text against the spec or the connectedhomeip-spec AsciiDoc.**
- The "python-matter-server subscription floor = 1s, PR #891 / SmartThings = 0" anecdote is **unconfirmed** — VERIFY or drop.
- The chosen comparison-epsilon constant(s) in REC-94 are placeholders pending Nick's call.

## 6. Appendix: Sources [M]
- Home Assistant significant_change developer docs — developers.home-assistant.io/docs/core/platform/significant_change/
- Home Assistant sensor significant_change.py (dev) — github.com/home-assistant/core/blob/dev/homeassistant/components/sensor/significant_change.py
- Matter 1.4 / 1.3 Core Specification (CSA) — csa-iot.org/wp-content/uploads/2024/11/24-27349-006_Matter-1.4-Core-Specification.pdf ; csa-iot.org/wp-content/uploads/2024/05/matter-1-3-core-specification.pdf (§7.7.7 Reportable Quality, §7.7.8 Quieter Reporting Quality); spec source: github.com/CHIP-Specifications/connectedhomeip-spec
- Matter 1.4.2 newsroom (Quieter Reporting) — csa-iot.org/newsroom/matter-1-4-2-enhancing-security-and-scalability-for-smart-homes/
- Matter Handbook Interaction Model — handbook.buildwithmatter.com/how-it-works/interaction-model/ ; matter-smarthome.de/en/development/matter-1-4-2-update-improves-security-convenience/
- ZCL Configure Reporting (Atmel AT08550) — ww1.microchip.com/downloads/en/Appnotes/Atmel-42334-ZigBee-Attribute-Reporting_ApplicationNote_AT08550.pdf ; ESP-Zigbee SDK ZCL General Report — docs.espressif.com/projects/esp-zigbee-sdk
- Zigbee2MQTT reportable_change docs — zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html
- Zooz ZSE44 / ZSE40 advanced settings — support.getzooz.com/kb/article/853 ; support.getzooz.com/kb/article/1005
- Aeotec aërQ user guide — aeotec.freshdesk.com/support/solutions/articles/6000227918
- Eurotronic Spirit Z-Wave manual — manualslib.com/manual/1323467
- OpenZWave Aeotec zw100 config — github.com/OpenZWave/open-zwave/blob/master/config/aeotec/zw100.xml
- OSIsoft/AVEVA PI Exception & Compression — cdn.osisoft.com/osi/presentations/2023-AVEVA-San-Francisco/UC23NA-3PGK04-AVEVA_Bregenzer_Brent-Exception-Compression-and-their-Impacts-On-PI-System-Performance.pdf ; PI Data Archive System Management Guide (manualzz) ; patterndiscovery.com/news/ensuring-precision-with-excdev-and-compdev
- Indriya / JSR-385 — github.com/unitsofmeasurement/indriya (AbstractQuantity.java, ComparableQuantity.java) ; unitsofmeasurement.github.io/indriya (RI 2.2.3) ; belief-driven-design.com/java-measurement-jsr-385-210f2/ ; baeldung.com/javax-measure
- Java float comparison — howtodoinjava.com/java-examples/correctly-compare-float-double/ ; oreilly.com/library/view/java-cookbook/0596001703/ch05s06.html
- Debezium delivery/dedup — debezium.io/tag/deduplication/

## 7. HomeSynapse Code-Level Implications [O]

### Per-permit comparison function (pseudocode; VERIFY accessor names against source)
```
boolean changed(AttributeValue prior, AttributeValue next) {
  if (prior == null) return next != null;            // first observation
  if (!prior.getClass().equals(next.getClass())) {
    if (next instanceof DegradedAttributeValue) return false;  // entering Degraded is inert
    return true;                                     // genuine type change otherwise
  }
  return switch (next) {
    case BooleanValue b -> b.value() != ((BooleanValue) prior).value();
    case IntValue i     -> i.value() != ((IntValue) prior).value();
    case EnumValue e    -> !e.token().equals(((EnumValue) prior).token());   // case-sensitive
    case StringValue s  -> !s.value().equals(((StringValue) prior).value()); // no trim/fold
    case FloatValue f   -> floatChanged(((FloatValue) prior).value(), f.value());
    case QuantityValue q-> quantityChanged((QuantityValue) prior, q);        // normalize then epsilon
    case ArrayValue a   -> arrayChanged((ArrayValue) prior, a);              // size-then-elementwise
    case DegradedAttributeValue d -> false;          // Degraded→Degraded inert
  };
}
boolean floatChanged(double a, double b) {
  if (Double.isNaN(a) && Double.isNaN(b)) return false;
  if (Double.isNaN(a) != Double.isNaN(b)) return true;
  return Math.abs(a - b) > Math.max(ABS_EPS, REL_EPS * Math.max(Math.abs(a), Math.abs(b)));
}                                                    // ABS_EPS / REL_EPS: fixed constants, VERIFY values
```
- **floatChanged** handles NaN==NaN (unchanged) and -0.0/0.0 (`Math.abs` difference is 0 → unchanged) cleanly, and the hybrid abs-or-rel epsilon behaves across magnitudes.
- **quantityChanged**: convert both to canonical unit via internal table, then `floatChanged` on magnitudes; mismatched dimension ⇒ changed + warn.
- **arrayChanged**: length mismatch ⇒ changed; else element-wise `changed(...)` recursion, order-sensitive.

### StateChangedEvent payload shape (REC-91)
Change `oldValue`/`newValue` from `String` to `AttributeValue`; serialize via the AttributeValue codec; provide an event upcaster mapping legacy String payloads → typed (best-effort parse → else StringValue/DegradedAttributeValue). Keep `attributeKey` and causing `EventId`.

### Where deadband config lives if/when recommended (REC-92, deferred)
NOT in M4. If adopted later: a typed `reportableChange` field on the attribute schema within `Entity.capabilities` → `CapabilityInstance` attributes schema (VERIFY exact CapabilityInstance shape before proposing the field), defaulting to absent (exact/epsilon). It MUST be an absolute magnitude threshold (replay-safe), never a time/rate.

### MODULE_CONTEXT impact
- `core/device-model` (`com.homesynapse.device`): add the comparator (or `AttributeValue.changedFrom`) and the canonical-unit normalizer; touches the sealed hierarchy's API surface.
- `core/state-store`: DerivationRule/production rule swaps string compare for typed comparator; `applyToState` stores typed values (REC-91).
- `core/event` (`com.homesynapse.event`): `StateChangedEvent` field type change + upcaster (REC-91, co-sequenced with REC-29 AttributeValueUpcaster SPI).
- Invariant INV-PROJ-01 preserved: comparator is pure, clock-free, performs no publish/mutate.