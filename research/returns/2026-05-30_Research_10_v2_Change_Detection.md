# Research 10: Typed Attribute Change-Detection Semantics for State Derivation — Per-Type Equality, Value-Based Deadbands, and Replay-Safe Comparison
*Target: HomeSynapse Core M4 (M4.0b-2 / M4.B3). Date: 2026-05-30.*

## 1. Executive Summary [M]

- **The MVP-correct policy is per-type structural equality with a float epsilon, with deadbands deferred — not a global tolerance.** The single highest-impact finding: exact-equality-with-float-epsilon (plus unit-normalized `QuantityValue` comparison) is sufficient for M4; configurable per-attribute deadbands are a real feature with real prior art (Zigbee, Z-Wave, Home Assistant, OSIsoft PI), but they are an optimization, not a correctness requirement, and should be deferred to a later WU.
- **Stringified comparison is a latent correctness bug and must be replaced by typed comparison.** Today's `Objects.equals(oldString, newString)` after `rawValue().toString()` conflates `21.0` with `21.00`, loses type identity, and is locale/format-fragile; comparison must run on typed `AttributeValue`s.
- **Float comparison needs a deliberate, documented epsilon — exact `==` is wrong, and NaN / `-0.0` must be handled explicitly.** IEEE-754 makes `0.1+0.2 != 0.3`; `Float.equals` treats `-0.0 != 0.0` and `NaN == NaN`, the opposite of `==`. The change function must pick one rule and apply it everywhere.
- **`QuantityValue` requires canonical-unit normalization before comparison or it will both miss real changes and fire false ones.** `21.0°C` and `294.15 K` are equal; comparing magnitude-only or raw strings is wrong. This is the one place a units library (JSR-385/Indriya) is tempting — but it is a version-catalog (LTD-10) dependency decision, not free.
- **All change detection must be a pure function of (prior canonical value, inbound value); every time-based technique is disqualified.** Min/max reporting intervals, "report at most every N seconds," rate-of-change windows, and time-based deadbands (PI's `ExcMax`, Z-Wave's 30-second rule, Matter's min-interval floor) all violate INV-PROJ-01 replay determinism. Only value-based deadbands survive.
- **`StateChangedEvent` should carry typed values, and the materialized store should preserve typed values — the all-`StringValue` materialization is a second latent bug.** M7 conditions/triggers will need typed comparisons (numeric `>`, unit-aware); persisting everything as `StringValue` forces every downstream consumer to re-parse and re-guess types.
- **Keep three concepts permanently distinct: comparison epsilon (is it a change?), stored precision (what we materialize), display rounding (not our concern).** Conflating them is the classic source of "phantom change" event storms and missed real changes — and the explicit reason historians like PI separate exception deadband from compression deadband from display.

## 2. Platform / Literature Deep Dives [M]

### Home Assistant — `significant_change` (the closest direct analog)
HA computes per-device-class significance with explicit absolute and percentage tolerances. The developer documentation states the design intent directly: *"Not all of these services are interested in every change. To help these services filter insignificant changes, your entity integration can add significant change support... Here are some examples of insignificant changes: A battery that loses 0.1 % charge; A temperature sensor that changes 0.1 Celsius; A light that changes 2 brightness."* (developers.home-assistant.io).

The actual source (`homeassistant/components/sensor/significant_change.py`, dev branch) hard-codes per-device-class thresholds. For temperature, verbatim: `if new_attrs.get(ATTR_UNIT_OF_MEASUREMENT) == UnitOfTemperature.FAHRENHEIT: absolute_change = 1.0  else: absolute_change = 0.5` (for `SensorDeviceClass.TEMPERATURE`/`TEMPERATURE_DELTA`). Battery and humidity use `absolute_change = 1.0`. For air-quality classes (AQI, CO, CO2, PM25, PM10, VOLATILE_ORGANIC_COMPOUNDS) the source sets `absolute_change = 1.0` **and** `percentage_change = 2.0`, combined via AND logic in `_absolute_and_relative_change` (`check_absolute_change(...) and check_percentage_change(...)`). Crucially, the function `async_check_significant_change(hass, old_state, old_attrs, new_state, new_attrs)` is *"passed a state that was previously considered significant and the new state. It is not just passing the last 2 known states in"* — the reference value is the last *reported* (significant) value, not merely the immediately prior sample. The function returns `bool | None`, where `None` means "I don't know": the source opens with `if (device_class := new_attrs.get(ATTR_DEVICE_CLASS)) is None: return None`, and falls through to `return None` when no `absolute_change` is configured (i.e., unknown device classes get no filtering).

- **Significant/reportable change def:** per-device-class absolute (and optionally relative) tolerance vs. the last significant value.
- **Pain point:** because the unit affects the threshold (1.0°F vs 0.5°C), unit handling and threshold are coupled; the `None`/unknown-device-class path means many entities get no filtering at all. HA's `generic_thermostat` separately uses `cold_tolerance`/`hot_tolerance` as control *hysteresis* (heater stops when sensor ≥ target + tolerance), distinct from `significant_change` — a clean illustration that *deadband for storage/reporting* and *hysteresis for control* are different mechanisms.
- **HomeSynapse lesson:** the comparison reference must be the last *materialized canonical* value (which `EchoStateRule` already uses), not a sliding window; per-attribute tolerance belongs in schema metadata keyed by something like device class; a tri-state ("changed / unchanged / unknown") is a useful pattern but adds complexity — for MVP a boolean from a total function is enough.

### Matter — Reportable Quality and Quieter Reporting (Q quality)
Matter's data model defines two relevant per-attribute qualities. **Section 7.7.7 "Reportable Quality"** designates which attributes may emit subscription reports; **Section 7.7.8 "Quieter Reporting Quality"** (introduced in Matter 1.4, expanded in 1.4.2) controls *when* a changing value should actually be reported. (Section numbers confirmed from the Matter 1.4 Core Specification table of contents; the verbatim normative SHALL/SHOULD/MAY sentences are in the CSA PDF p. ~432 and the connectedhomeip-spec AsciiDoc source, both of which block automated fetch — flagged as a sourcing limitation.) The CSA describes the intent: Quieter Reporting is *"a data model optimization that defines when and how often devices should report attribute changes... By avoiding unnecessary updates, such as repeatedly reporting time remaining on a timer or intermediate values during a long transition, devices can reduce network utilization and extend battery life."* (csa-iot.org). A common illustration: *"lamps dimming or blinds moving will send fewer intermediate values (1%, 2%, 3% …)."* (matter-smarthome.de).

Reporting is additionally bounded at the subscription layer by a **Min Interval Floor** (*"the minimum interval between reports"*) and a **Max Interval Ceiling** (*"the maximum interval between reports"*) (handbook.buildwithmatter.com; docs.silabs.com/matter). HA's python-matter-server had to set a subscription floor of 1 second to prevent report flooding from devices emitting ~100 `CurrentLevel` reports in 2 seconds during transitions (SmartThings Matter reporting thread).

- **Significant/reportable change def:** a Q-quality "changed enough" predicate plus min/max interval bounds; explicitly suppresses intermediate transition values.
- **Pain point:** event storms during transitions (the dimming/moving case) are the canonical failure; the min-interval floor is a *time-based* mitigation.
- **HomeSynapse lesson:** the "suppress intermediate values during a transition" goal is real, but Matter achieves it with *time* (min interval) — which HomeSynapse cannot use in a replay-safe projection. HomeSynapse must achieve the same goal with a *value-based* deadband only.

### Zigbee Cluster Library (ZCL) — Configure Reporting / `reportableChange`
ZCL's `Configure Reporting` command carries three parameters. Per the ZCL specification language reproduced across vendor docs: *"The reportable change field shall contain the minimum change to the attribute that will result in a report being issued. This field is of variable length. For attributes with 'analog' data type the field has the same data type as the attribute. The sign (if any) of the reportable change field is ignored. For attributes of 'discrete' data type this field is omitted."* (Tizen Native API docs, reproducing ZCL). The ESP Zigbee SDK restates: *"The reportable change field specifies the minimum change to the attribute value that will trigger a report. The attributes with data types of array, structure, set or bag cannot be reported."*

The three-parameter model (Digi): *"minimum interval: reports may not be generated more often than this, regardless of value change; maximum interval: reports must be generated at least this often, regardless of value change; reportable change: if between minimum and maximum interval and the value has changed by at least this much since the last report, generate a report."* The reference is the *last reported* value (Atmel/Microchip AT08550: *"if the difference in attribute value exceeds the reportable change parameter received, an additional report is sent out after the minimum report interval period"*).

- **Significant/reportable change def:** for *analog* types, a per-attribute absolute delta of the same data type; for *discrete* types (booleans, enums), no reportable change — any change reports (the field is omitted).
- **Pain point:** mis-set reporting + transitions cause flooding and battery drain on sleepy devices (widely documented Zigbee battery-drain reports); the analog/discrete split means the deadband concept simply does not apply to enums/booleans.
- **HomeSynapse lesson:** this validates a *typed* split — numeric types (`IntValue`, `FloatValue`, `QuantityValue`) can carry a same-typed deadband; `BooleanValue`/`EnumValue`/`StringValue` are "discrete" and use pure equality with no deadband. The deadband datatype should match the attribute datatype.

### Z-Wave — multilevel sensor reporting thresholds
Z-Wave sensors expose per-quantity reporting thresholds via the Configuration command class. The Eurotronic Spirit Z-Wave Plus manual, Parameter 5 ("Measured temperature report"): the device reports if the temperature changed by a delta configurable from `0.1°C … 5.0°C`, default `0x05` (report on delta T = 0.5°C), Size 1 byte, with the reporting delta expressed in tenths of a degree Celsius. The Zooz ZSE44 documents (verbatim, Zooz Support KB 853): *"Parameter 3: Set the reporting threshold for your temperature sensor. The device will report any changes in temperature once the reading exceeds the value from this setting compared to the last report. Values: 10 – 100 (degrees Fahrenheit, where value 10 equals 1 degree). Default: 20 (2 degrees). Size: 1 byte dec."* Z-Wave Plus also imposes a *time*-based rule: *"values from Sensor Multilevel channels... will not be sent unsolicitedly to Life Line more often than every 30 seconds"* (z-wave.me forum).

- **Significant/reportable change def:** per-parameter absolute threshold vs. last report, in device-native units (deci-degrees or scaled °F), plus the 30-second floor.
- **Pain point:** thresholds expressed in device-native scaled integers (value 10 = 1°F) and Celsius/Fahrenheit selection parameters create unit-drift and rounding ambiguity (e.g., the Visonic MCT-340 rounds to whole °C then converts to °F, producing coarse °F resolution).
- **HomeSynapse lesson:** confirms the absolute-delta-vs-last-reported pattern and the unit-drift hazard. The 30-second rule is again a *time* mechanism HomeSynapse must reject.

### Time-series historians — OSIsoft PI swinging-door, exception + compression deadband
PI uses two stacked deadbands. **Exception reporting** (the deadband nearest the source): *"The interface sends the new value to the PI Server only if it is different from the previous value by an amount larger than the value in the ExcDev attribute. Exception reporting uses a simple deadband algorithm."* **Compression** uses the swinging-door algorithm: *"If the absolute difference between the current snapshot and the last archive value is greater than CompDev then the snapshot is sent to the archive."* The swinging-door reconstruction guarantee: *"The reconstruction error is guaranteed to be no more than the compression deviation (tuneable)"* (emrumo/swingingdoor). PI's recommended tuning: *"Set CompDev <= Instrument precision; Set ExcDev = ½ CompDev"* (AVEVA UC23 presentation), with the stated goal *"to filter out instrument and process noise and still record significant process changes."* For digital/string points, *"the values of CompDev, CompDevPercent, ExcDev and ExcDevPercent are not applicable"* and return 0 — the same analog/discrete split seen in ZCL.

Critically, PI's deadbands are paired with *time* bounds (`ExcMax` default 600s; `CompMax`), and the swinging-door algorithm is *stateful* (it carries a snapshot and a narrowing cone across samples) — both determinism hazards.

- **Significant change def:** value-deadband (exception) + slope/deviation-deadband (swinging-door compression), both vs. a retained reference, both with time backstops.
- **Pain point:** blind application of swinging-door distorts signal content — a PMU study found *"blind application of the SDA compression alters frequency content in the measurements and introduces false harmonics and aliasing"* (OSTI 1851743). Deadbands are lossy; set too wide, they erase real events.
- **HomeSynapse lesson:** the simple exception-style value deadband is exactly the replay-safe primitive HomeSynapse could adopt later; the swinging-door's carried state and time backstops are *not* replay-safe unless the full filter state is persisted in the event log. Start with the simple value deadband, never the stateful slope filter.

### Prometheus / InfluxDB — delta and change semantics
Time-series query engines compute change at *query* time, not ingest time, sidestepping ingest-determinism entirely. Prometheus `changes()` counts value changes in a window; `rate()`/`irate()` compute per-second deltas and *"breaks in monotonicity (such as counter resets...) are automatically adjusted for."* InfluxDB stores raw and uses `derivative()`/`difference()` at read time. The lesson: HomeSynapse is the opposite case — it must decide "is this a change?" at *derivation* time and persist the decision, so it cannot defer to a query-time engine and must be deterministic at write time.

### Kafka / Debezium — change-data-capture dedup
Debezium emits a structured envelope with `before`/`after` and an `op` code; its `ExtractChangedRecordState` SMT *"examines the before and after event state structures to identify the fields that are altered by an operation, and those that remain unchanged"* and adds headers listing changed/unchanged fields. Debezium does *not* suppress unchanged-row updates by default — it captures every committed row operation; dedup is a downstream concern. Tombstones (null-value records keyed to a deleted row) enable Kafka log compaction. Lesson: a typed before/after diff is the industry-standard change payload, and "what changed" is computed by structural comparison of typed fields — supporting HomeSynapse carrying typed `oldValue`/`newValue`.

### Units library prior art — JSR-385 / Indriya
JSR-385 (`javax.measure`) with the Indriya reference implementation provides `Quantity`, `Unit`, conversion, and comparison. Indriya distinguishes strict equality from equivalence: `equals` does *"strict equality (same unit and same amount),"* and explicitly notes that *"`Quantities.getQuantity(3.0, KILOGRAM)`, `Quantities.getQuantity(3, KILOGRAM)`... might not be considered equals because of possible differences in their implementations,"* recommending `compareTo` or `isEquivalentTo` for cross-unit / cross-representation comparison. The dependency: the current release is `tech.units:indriya` 2.2.3 (per Maven Central / unitsofmeasurement.github.io/indriya: `<groupId>tech.units</groupId> <artifactId>indriya</artifactId> <version>2.2.3</version>`); its POM transitively pulls `javax.measure:unit-api` and `tech.uom.lib:uom-lib-common`. Lesson: a units library solves `QuantityValue` normalization correctly but adds three JARs — a real LTD-10 decision.

## 3. Cross-Cutting Analysis [M]

### Concept-mapping table

| HomeSynapse `AttributeValue` | HA device-class tolerance | Matter (Q / reportable) | ZCL reportable change | Time-series deadband |
|---|---|---|---|---|
| `BooleanValue` | exact (binary_sensor) | discrete; reports on change | discrete → omitted (any change) | digital point: deadband N/A |
| `EnumValue` | exact | discrete | discrete → omitted | digital/string: deadband N/A |
| `StringValue` | exact | discrete | discrete → omitted | string: ExcDev/CompDev = 0 |
| `IntValue` | absolute (e.g., battery 1.0) | analog; reportable increment | analog, same int type | ExcDev/CompDev in eng. units |
| `FloatValue` | absolute (temp 0.5°C) + optional % | analog; "changed enough" | analog, same float type | ExcDev ≈ ½ instrument precision |
| `QuantityValue` | absolute, unit-coupled (1.0°F vs 0.5°C) | analog + unit | analog, native-unit delta | CompDev in engineering units |
| `ArrayValue` (full-replacement) | n/a | array → not reportable | array → cannot be reported | n/a |
| `DegradedAttributeValue` | n/a (≈ unknown → `None`) | n/a | n/a | n/a (bad value) |

The striking cross-platform agreement: **discrete types (boolean/enum/string) use pure equality and never carry a deadband; analog types (int/float/quantity) can carry a same-typed absolute deadband; collections/arrays are not deadband-able and use full-replacement structural comparison.** This maps cleanly onto HomeSynapse's sealed permits.

### Gap analysis
The current `EchoStateRule` has three gaps vs. this prior art: (1) it stringifies before comparing, losing type identity and precision (`21.0` vs `21.00`); (2) it has no float epsilon, so it either over-fires on raw float jitter or, post-stringification, mis-compares; (3) it has no unit awareness for the forthcoming `QuantityValue`. None of these require a deadband to fix — they require *typed structural comparison*.

### Over-abstraction analysis: is a per-attribute deadband worth it for MVP?
**No, not for M4.** The evidence: every platform that ships deadbands (HA, ZCL, Z-Wave, PI) does so to save *network/battery/storage* on *sleepy or bandwidth-constrained* links. HomeSynapse's change detection runs *inside the runtime* on already-received events; the cost it controls is `stateVersion` inflation and `StateChangedEvent` noise, not radio traffic. That cost is real but second-order. Exact-equality-with-float-epsilon (and unit-normalized quantity comparison) eliminates the *spurious* changes (re-reports of identical values, `21.0` vs `21.00`); a deadband would additionally suppress *small real* changes — a policy decision with missed-change risk (the OSTI/PMU distortion case and HA generic-thermostat "missed trigger" reports) that should not be made implicitly in MVP. Build the typed comparator now; design the schema so a deadband field *can* be added later without a breaking change; defer the deadband itself.

### Competitive assessment
HomeSynapse's event-sourced, replay-deterministic constraint is *stricter* than any surveyed platform: HA, Matter, ZCL, Z-Wave, and PI all freely use wall-clock and carried filter state. HomeSynapse cannot copy their mechanisms wholesale — it can only adopt the *value-based* subset. The closest philosophical match is Debezium (typed before/after diff, structural change detection, no time dependence in the core diff), which is also the model that best fits M7 conditions/triggers.

## 4. Amendment Recommendations [M]

**REC-90 — Replace stringified comparison with a typed, total `hasChanged(prior, inbound)` per permit.**
- *Gap:* `EchoStateRule.lookupAttribute` stringifies via `rawValue().toString()` then `Objects.equals` — loses type identity and precision.
- *Lesson source:* ZCL analog/discrete split; Debezium typed before/after diff; Indriya strict-vs-equivalent equality.
- *Change (comparison policy):* a pure function on `AttributeValue` pairs — `BooleanValue`/`IntValue`/`EnumValue` → exact `.equals`; `StringValue` → exact `.equals` (case-sensitive, whitespace-significant, documented); `FloatValue` → epsilon comparison (REC-92); `QuantityValue` → unit-normalized comparison (REC-93); `ArrayValue` → order-sensitive, size-then-element-wise deep equality; `DegradedAttributeValue` → see REC-94.
- *Backward-compat:* behavioral change to when `state_changed` fires; `21.0` vs `21.00` will newly be treated as equal. Existing replays may produce *fewer* `state_changed` events and lower `stateVersion` — a replay-divergence event; must be gated to a schema/version bump.
- *Effort:* M (new comparator + tests per permit). *Target WU:* M4.0b-2.

**REC-91 — Carry typed values in `StateChangedEvent` and materialize typed values in the store.**
- *Gap:* `StateChangedEvent` carries `oldValue`/`newValue` as Strings; `applyToState` writes `new StringValue(value)` regardless of source type.
- *Lesson source:* Debezium typed before/after; M7 conditions/triggers need numeric/unit-aware comparison.
- *Change (event-payload shape):* `StateChangedEvent` carries typed `AttributeValue oldValue`/`newValue` (serialized via the existing envelope serialization); `applyToState` preserves the inbound typed value rather than coercing to `StringValue`.
- *Backward-compat:* event schema change — existing persisted `StateChangedEvent`s are string-valued; needs an upcaster or schema version. **Conflict with verified inventory:** the verified `applyToState` "writes... via `newAttrs.put(key, new StringValue(value))`" is exactly what this REC changes — flagged explicitly, not silently broken.
- *Effort:* M–L. *Target WU:* M4.B3.

**REC-92 — Define a single `FloatValue` comparison epsilon policy (absolute + relative), with explicit NaN/`-0.0`.**
- *Gap:* no epsilon today; `==` and `Float.equals` both wrong (the latter splits `-0.0`/`0.0` and equates `NaN`).
- *Lesson source:* The Floating-Point Guide; HA combined absolute+relative; PI "CompDev ≤ instrument precision."
- *Change (comparison policy):* `changed` iff `|a−b| > max(absEps, relEps·max(|a|,|b|))`; treat `-0.0` and `0.0` as equal; define NaN handling explicitly (recommend: NaN→non-NaN and non-NaN→NaN count as changed; NaN→NaN counts as unchanged) and document it as the canonical rule. Keep this epsilon **distinct from stored precision and display rounding** (see Caveats). Recommended defaults — VERIFY against M4 sensor data: `absEps = 1e-9`, `relEps = 1e-9` (a *correctness* epsilon to neutralize FP noise, NOT a perceptual deadband).
- *Backward-compat:* additive to REC-90. *Effort:* S. *Target WU:* M4.0b-2.

**REC-93 — Normalize `QuantityValue` to a canonical unit before comparison; decide units-library dependency separately.**
- *Gap:* `QuantityValue` (magnitude+unit) does not yet exist with a comparison rule; raw comparison would treat `21.0°C` and `294.15 K` as different and `21.0°C` vs `21.001°C` as different.
- *Lesson source:* Indriya `isEquivalentTo`/`compareTo`; Z-Wave/Tuya unit-drift bugs; HA unit-coupled thresholds.
- *Change (comparison policy + dependency):* comparison converts both operands to a canonical unit for the physical dimension, then applies the `FloatValue` epsilon (REC-92). Two sub-options for the converter: (a) **hand-rolled** canonical-unit table for the small set of M4 quantities (temperature, %, lux, etc.) — zero new dependency; (b) **JSR-385/Indriya** (`tech.units:indriya` 2.2.3, transitively `javax.measure:unit-api` + `tech.uom.lib:uom-lib-common`) — correct and general but three new JARs, governed by **LTD-10**. Recommend (a) for M4 unless the quantity set is large; revisit (b) later.
- *Backward-compat:* new type, no existing data. *Effort:* M (option a) / M + dependency process (option b). *Target WU:* M4.B3.

**REC-94 — Make `DegradedAttributeValue` inert for change detection (with recovery emit).**
- *Gap:* fallback for un-deserializable values; undefined whether it can trigger `state_changed`.
- *Lesson source:* HA `check_valid_float` — verbatim source: `if not check_valid_float(new_state): # New state is invalid, don't report it → return False`; `if not check_valid_float(old_state): # Old state was invalid, we should report again → return True`.
- *Change (comparison policy):* inbound `DegradedAttributeValue` → never emit `state_changed` (do not overwrite a good canonical value with a degraded one); prior `DegradedAttributeValue` with a valid inbound value → *does* emit `state_changed` (recovery), mirroring HA. Two degraded values → unchanged.
- *Backward-compat:* additive. *Effort:* S. *Target WU:* M4.0b-2.

**REC-95 — Reserve (but do not implement) an optional per-attribute value-based deadband on the attributes schema.**
- *Gap:* no deadband today; prior art shows it is valuable for analog types but risky if implicit.
- *Lesson source:* ZCL `reportableChange` (same-typed analog delta), Z-Wave thresholds (Eurotronic default 0.5°C, Zooz default 2°F), PI ExcDev, HA `significant_change`.
- *Change (schema field, deferred):* design an optional `reportableChange`/`deadband` field on `CapabilityInstance`'s attributes schema, typed to match the attribute (absolute delta for int/float/quantity; **not present** for boolean/enum/string/array, per the discrete/analog split). It is a **pure value comparison** (`|new − lastCanonical| ≤ deadband` ⇒ unchanged) referenced against the last *materialized canonical* value — never wall-clock. Implement only when an M-tier need arises.
- *Backward-compat:* absent field ⇒ exact comparison (REC-90), fully back-compatible. *Effort:* L (deferred). *Target WU:* deferred to a later tier (post-M4); reserve schema shape in M4.B3.

## 5. Caveats and Open Questions [M]

**Determinism rejections (settled by the constraint, non-negotiable):**
- Time-based deadbands (PI `ExcMax`/`CompMax`, Z-Wave 30-second rule, Matter min/max interval) — rejected: depend on wall-clock.
- Rate-of-change / windowed filters (Prometheus `rate()`, swinging-door slope cone) — rejected: depend on multiple samples / carried algorithm state not in the event log.
- "Report at most every N seconds" / debounce — rejected: processing-rate dependent.
- Swinging-door compression — rejected for M4: stateful (snapshot + narrowing cone) and time-backstopped; only replay-safe if the full filter state is persisted in the event stream, which is out of scope.

**What the literature settles:**
- Discrete types use exact equality, analog types can carry a same-typed absolute delta, arrays use structural full-replacement comparison — unanimous across ZCL/HA/PI.
- Float comparison needs an epsilon; `==`/`Float.equals` are both wrong defaults.
- Quantities must be unit-normalized before comparison.
- Typed before/after is the standard change payload (Debezium).

**What needs Nick's call:**
- Whether to ship a per-attribute deadband at all in M4 (REC-95) vs. defer — recommendation is *defer*, but it's a product call about event-storm tolerance.
- The `FloatValue` epsilon defaults (REC-92) and whether a perceptual deadband (e.g., 0.5°C like HA) is ever wanted, vs. a pure FP-noise epsilon.
- The units-library dependency (REC-93 option b) under LTD-10 — adds three JARs; cannot be assumed free.
- Whether the typed `StateChangedEvent` payload (REC-91) justifies an event-schema migration in M4 or waits for M7.

**Sourcing limitation:** the exact normative SHALL/SHOULD/MAY text of Matter §7.7.7 / §7.7.8 could not be extracted (CSA PDF and connectedhomeip-spec AsciiDoc both block automated fetch); the section numbers and Q-quality behavior are confirmed, but the verbatim spec sentences should be pulled manually from the Matter 1.4 Core Spec PDF (p. ~432) before any direct quotation in downstream docs.

**Dependency (LTD-10) implications:** JSR-385/Indriya (`tech.units:indriya` 2.2.3 + `javax.measure:unit-api` + `tech.uom.lib:uom-lib-common`) is the only proposed external dependency; it is governed by the version-catalog amendment process and must not be added without it. The hand-rolled canonical-unit table (REC-93 option a) avoids LTD-10 entirely and is recommended for M4.

## 6. Appendix: Sources [M]

- Home Assistant developer docs, "Significant change": https://developers.home-assistant.io/docs/core/platform/significant_change/
- HA `sensor/significant_change.py` (source): https://github.com/home-assistant/core/blob/dev/homeassistant/components/sensor/significant_change.py
- HA Generic Thermostat (cold/hot tolerance, hysteresis): https://www.home-assistant.io/integrations/generic_thermostat/
- Matter 1.4.2 announcement (Quieter Reporting): https://csa-iot.org/newsroom/matter-1-4-2-enhancing-security-and-scalability-for-smart-homes/
- Matter 1.4 Core Specification (PDF; §7.7.7 Reportable Quality, §7.7.8 Quieter Reporting Quality): https://csa-iot.org/wp-content/uploads/2024/11/24-27349-006_Matter-1.4-Core-Specification.pdf
- Matter interaction model (Min Interval Floor / Max Interval Ceiling): https://handbook.buildwithmatter.com/how-it-works/interaction-model/ ; https://docs.silabs.com/matter/2.1.0/matter-fundamentals-interaction-model/
- Matter reporting flooding (subscription floor): https://community.smartthings.com/t/how-to-set-matter-reporting-interval-configuration/281173
- ZCL reportable change (Tizen Native API, reproducing ZCL spec): https://developer.tizen.org/dev-guide/tizen-iot-headless/latest/group__CAPI__NETWORK__ZIGBEE__ZCL__REPORTING__CONFIG__RECORD__MODULE.html
- ESP Zigbee SDK, ZCL General Report: https://docs.espressif.com/projects/esp-zigbee-sdk/en/latest/esp32/user-guide/zcl_general_report.html
- Digi reporting (min/max/reportable-change semantics): https://docs.digi.com/resources/documentation/digidocs/90001931/reporting_reference/reporting_reference.html
- Atmel/Microchip AT08550 ZigBee Attribute Reporting: https://ww1.microchip.com/downloads/en/Appnotes/Atmel-42334-ZigBee-Attribute-Reporting_ApplicationNote_AT08550.pdf
- Eurotronic Spirit Z-Wave Plus manual (Parameter 5, default 0.5°C reporting delta): https://www.manualslib.com/manual/1323467/Eurotronic-Spirit-Z-Wave-Plus.html?page=18
- Zooz ZSE44 advanced settings (Parameter 3 reporting threshold, default 2°F): https://www.support.getzooz.com/kb/article/853-zse44-temperature-humidity-xs-sensor-advanced-settings/
- Z-Wave Plus 30-second rule: https://forum.z-wave.me/viewtopic.php?t=31137
- OSIsoft PI exception/compression (ExcDev/CompDev; digital N/A): https://pisquare.osisoft.com/s/question/0D51I00004UHmJgSAL/compdev-and-other-attributes-standard
- PI exception reporting (System Management Guide): https://manualzz.com/doc/o/t3wlw/pi-data-archive-3.4.390-system-management-guide-manage-pi-points
- AVEVA UC23 "Exception, Compression and their Impacts" (CompDev ≤ precision; ExcDev = ½ CompDev): https://cdn.osisoft.com/osi/presentations/2023-AVEVA-San-Francisco/UC23NA-3PGK04-AVEVA_Bregenzer_Brent-Exception-Compression-and-their-Impacts-On-PI-System-Performance.pdf
- Swinging-door algorithm (compression deviation, reconstruction guarantee): https://github.com/emrumo/swingingdoor ; https://github.com/gfoidl/DataCompression/blob/master/api-doc/articles/SwingingDoor.md
- Swinging-door distortion (PMU): https://www.osti.gov/servlets/purl/1851743
- Prometheus query functions (rate/irate/changes): https://prometheus.io/docs/prometheus/latest/querying/functions/
- Debezium event changes SMT (changed/unchanged fields): https://debezium.io/documentation/reference/stable/transformations/event-changes.html
- Debezium new record state extraction / tombstones: https://debezium.io/documentation/reference/stable/transformations/event-flattening.html
- Indriya strict equality vs. equivalence (AbstractQuantity): https://github.com/unitsofmeasurement/indriya/blob/master/src/main/java/tech/units/indriya/AbstractQuantity.java
- JSR-385 / Indriya overview & dependency (2.2.3): https://belief-driven-design.com/java-measurement-jsr-385-210f2/ ; https://unitsofmeasurement.github.io/indriya/
- The Floating-Point Guide (epsilon comparison): https://floating-point-gui.de/errors/comparison/
- Java float `equals` / NaN / `-0.0` semantics: https://www.oreilly.com/library/view/java-cookbook/0596001703/ch05s06.html
- Tuya/SmartThings unit conversion & rounding drift: https://developer.tuya.com/en/docs/iot/Convert-Temperature-Scale-Report-Only-Celsius-or-Fahrenheit?id=Kb1ae3g8igkzq ; https://community.smartthings.com/t/conversion-from-celsius-to-fahrenheit-error-in-device-handler/147464

## 7. HomeSynapse Code-Level Implications [O]

**Verified inventory quoted verbatim (baseline — build on top of this, do not drift):**

- `AttributeValue` is a sealed interface in `core/device-model` (`com.homesynapse.device`). Source-verified real permits (5): `BooleanValue`, `IntValue`, `FloatValue`, `StringValue`, `EnumValue`. M4 adds: `QuantityValue`, `ArrayValue` (full-replacement semantics — non-negotiable), and `DegradedAttributeValue` (public, the subtype-level fallback for un-deserializable values, paralleling `DegradedEvent`).
- `DerivationRule` (`@FunctionalInterface`, `core/state-store`): `List<EventDraft> evaluate(DerivationContext context)`. The `DerivationContext` carries prior `EntityState` + inbound `EventEnvelope` + injected `Clock`. The rule MUST be deterministic (INV-PROJ-01), MUST NOT call `EventPublisher.publish` or mutate the `StateStore`, and SHOULD inherit `eventTime` from the causing envelope (never `Instant.now()`).
- Current change-detect reference (`EchoStateRule`, testFixtures): if inbound is `StateReportedEvent`, look up the prior canonical value for the attribute key, compare; if unequal, emit a `StateChangedEvent`. Today `lookupAttribute` stringifies via `(v instanceof StringValue sv) ? sv.value() : v.rawValue().toString()` and the comparison is `Objects.equals(oldString, newString)`.
- `StateChangedEvent` (`com.homesynapse.event`) currently carries `attributeKey`, `oldValue`, `newValue` (Strings), and the causing `EventId`.
- `applyToState`: writes attributes only on `state_changed`, via `newAttrs.put(key, new StringValue(value))`.
- `EntityState.stateVersion` advances on every processed event (idempotency cursor).
- Capability/attribute metadata lives on `Entity.capabilities` (`List<CapabilityInstance>`).

**Proposed comparison function per permit (layered on the above):**

```
// NEW (proposed): pure, total, clock-independent — satisfies INV-PROJ-01
boolean hasChanged(AttributeValue prior, AttributeValue inbound) {
  // DegradedAttributeValue rules (REC-94) take precedence:
  if (inbound instanceof DegradedAttributeValue) return false;          // never overwrite good w/ degraded
  if (prior   instanceof DegradedAttributeValue) return true;           // recovery emits change
  return switch (inbound) {
    case BooleanValue b -> !prior.equals(b);                            // exact
    case EnumValue e    -> !prior.equals(e);                            // exact
    case StringValue s  -> !prior.equals(s);                            // exact, case + whitespace significant
    case IntValue i     -> !prior.equals(i);                            // exact
    case FloatValue f   -> floatChanged(prior, f);                      // epsilon (REC-92), -0.0==0.0, NaN rule
    case QuantityValue q-> quantityChanged(prior, q);                   // canonical-unit normalize then epsilon (REC-93)
    case ArrayValue a   -> arrayChanged(prior, a);                      // size-then-element-wise, order-sensitive, deep
    default -> !prior.equals(inbound);
  };
}
```

- `floatChanged`: `|a−b| > max(absEps, relEps·max(|a|,|b|))`; canonicalize `-0.0`→`0.0`; NaN→NaN unchanged, NaN↔number changed (REC-92).
- `quantityChanged`: convert both to canonical unit for the dimension (hand-rolled table for M4, REC-93 option a), then `floatChanged` on magnitudes; differing **dimensions** ⇒ changed (and likely a schema violation worth surfacing).
- `arrayChanged`: different length ⇒ changed; else element-wise `hasChanged`/deep-equality in order. Full-replacement semantics mean a single differing element flips the whole array (consistent with the non-negotiable inventory note).

**`StateChangedEvent` payload shape — NEW (proposed) (REC-91):**

```
// CURRENT (verified): attributeKey:String, oldValue:String, newValue:String, causingEventId:EventId
// NEW (proposed):     attributeKey:String, oldValue:AttributeValue, newValue:AttributeValue, causingEventId:EventId
```

This is a schema change requiring an upcaster/version bump; it surfaces as a diff against the verified inventory and is flagged in REC-91. **Conflict with verified `applyToState`:** preserving typed values changes `newAttrs.put(key, new StringValue(value))` to store the inbound typed `AttributeValue` — explicitly noted, not silently broken.

**Where deadband config lives if/when adopted (REC-95):** on the attributes schema inside `CapabilityInstance` (the verified home for attribute metadata), as an optional same-typed `reportableChange` field present only for `IntValue`/`FloatValue`/`QuantityValue`. Absent ⇒ exact/epsilon comparison. Evaluated as a pure value comparison against the last materialized canonical value — never wall-clock, preserving INV-PROJ-01.

**MODULE_CONTEXT impact:** the comparator is pure logic and can live beside `AttributeValue` in `core/device-model` (no new module), keeping `core/state-store`'s `DerivationRule` free of comparison logic; the typed `StateChangedEvent` change touches `com.homesynapse.event` serialization. No new module required; one optional new dependency (Indriya 2.2.3) only if REC-93 option b is chosen, gated by LTD-10.