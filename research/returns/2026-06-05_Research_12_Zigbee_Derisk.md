# Research 12 — Zigbee Adapter De-Risk: Field Evidence from Production Smart Home Platforms
**Prepared for:** HomeSynapse Core (local-first, event-sourced smart home runtime, Java 21)
**Target milestone:** M14 — Zigbee Integration (~Sep–mid-Oct 2026), 72-hour validation gate
**Status:** Doc 08 LOCKED. This is field-evidence harvest only — not a redesign. REC numbering begins at REC-120. No AMD integers assigned (assign-at-milestone).

---

## §1 Executive Summary

The dominant lesson from every production platform surveyed is that **a Zigbee stack's reliability is determined by its transport/transaction layer and its device-quirk data model — not by its ZCL correctness.** ZCL is the easy 20%. The hard 80% is (a) surviving coordinator firmware and serial-framing reality, and (b) absorbing the endless stream of spec-violating devices (Tuya, Xiaomi/Aqara) without recompiling the core.

Five firm positions for M14:

1. **The transport layer will bite you first, not ZCL.** Z2M's most-reported runtime failures are SYS-ping timeouts, ASH/EZSP framing errors, and watchdog-style disconnects — overwhelmingly USB/serial and coordinator-firmware problems, not protocol logic. HomeSynapse must build serialized per-device transaction queueing with retry/backoff *before* any device support. This is non-negotiable.

2. **Quirks are not an edge case — they are the product.** Zigbee2MQTT supports **5076 devices** (per z2m.dev's homebridge-z2m device-support page: "Currently there are 5076 supported devices… This page lists the devices currently supported by Zigbee2MQTT v2.9.2, which depends on zigbee-herdsman-converters v26.27.0"), and a very large share of converter churn is Tuya and Xiaomi/Aqara. A data-file device-profile model — not compiled-per-device — is mandatory under LTD-17.

3. **openHAB's `com.zsmartsystems.zigbee` is the cautionary tale.** It got the transport abstraction and the auto-generated ZCL layer right, but made device support require *compiled Java converter classes per device*, and that single decision is why its device catalogue is a small fraction of Z2M's. HomeSynapse must make the *application/device* layer data-driven even though LTD-17 forbids a runtime scripting engine.

4. **Sleepy end devices break interview, reporting-config, and IAS enrollment** — the three highest-severity 72-hour-gate risks. All three need "queue-until-awake" semantics.

5. **OTA can be deferred, but the data model must not be designed shut.** Adopt the Koenkk/zigbee-OTA index schema shape now as a forward-compatible posture.

---

## §2 Platform Deep Dives

### 2.1 Zigbee2MQTT / zigbee-herdsman
- **Architecture:** `zigbee-herdsman` is the transport+stack library; `zigbee-herdsman-converters` is the device database (one TypeScript file per vendor: `tuya.ts`, `xiaomi.ts`, …). Z2M is the MQTT glue.
- **Transport reality (Q1):** the issue tracker is dominated by coordinator connection failures. SLZB-06 (ethernet/TCP) crashes every few hours with `SRSP - SYS - ping after 6000ms` (issue #29116, Z2M 2.6.2, ~85 devices, channel 25); deCONZ-driver `TIMEOUT at Driver.processBusyQueue` (issue #26129); ASH software-flow-control problems on the MG24 (discussion #28697, "an issue with the SDK and CPx UART software flow control"). The fails-to-start guide enumerates the canonical first-implementation mistakes: ModemManager grabbing the serial device, cheap USB cables causing disconnects on touch, VM USB-passthrough instability, router-vs-coordinator firmware confusion, and resource exhaustion on a Pi 3.
- **Firmware baselines (2026) (Q1):** EmberZNet adapters **require EZSP protocol version 13 (EmberZNet firmware 7.4.x or 8.x.x)** — confirmed verbatim in the Z2M EmberZNet adapter docs. The `ember` driver is now recommended; the older `ezsp` driver is deprecated and kept only for pre-7.4.x firmware. The fails-to-start guide's explicit recommendation: "use coordinator firmware 8.0.2 and later from darkxst or Nerivec, and 7.4.4.5 or later from Nabu Casa." TI Z-Stack coordinators are CC2652/CC1352-class; only zStack and EmberZNet currently support `coordinator_backup.json`.
- **Backup/restore (Q1):** `ember` only supports EZSP v12+ backups; on an unsupported backup it auto-renames the file and forms anew. Migrating CC2652→MG24 (zstack→ember) requires manually re-adding pan_id, ext_pan_id, and network_key and deleting the stale backup (discussion observed ~121 devices surviving with no re-pair once done).
- **What a new implementation always gets wrong first (Q1):** treating the NCP request queue as infinitely deep (herdsman shows per-device `Request Queue … expiration timeout` management); not implementing software flow control / ASH back-pressure ("NOT READY — Signaling NCP: ember driver is temporarily overloaded"); not serializing transactions per device.
- **SED handling (Q2/Q3):** herdsman historically treated sleepy end devices the same as routers. Issue #445 documents the fix and the hard constraint verbatim: *"Sleepy End Devices (SEDs) turn off their radio, making them unable to receive messages most of the time. They instead poll their parent for messages using a MAC data request. The parent is only required to hold a single message for up to 7.68 seconds."* The `sendWhenActive` option defers sends until the device next polls. Discussion #30542 shows configure-reporting silently lost for SEDs (UI reverts, the queued config "is never sent").
- **Device count:** 5076 (homebridge-z2m mirror, zhc v26.27.0).

### 2.2 ZHA / zigpy / zha-device-handlers
- **Architecture:** `zigpy` is the stack; `bellows` (EmberZNet via EZSP), `zigpy-znp` (TI), etc. are transport libs; `zha-device-handlers` (zhaquirks) is the quirk database. ZHA is the HA integration.
- **Interview/quirk matching (Q2/Q6):** v1 = Python `CustomDevice` subclasses with **exact** signature matching ("These need to match what the device reports EXACTLY or zigpy will not match them"). v2 = declarative `QuirkBuilder` fluent API matching primarily on manufacturer+model with optional `.filter(signature_matches(...))`; v2 is explicitly recommended for new quirks because it "reduces duplicated code where a new variant appears with a slightly different signature."
- **v2 entity metadata:** v2 quirks carry HA entity metadata (entity_category, device_class) directly in the quirk — the device definition declares how the entity is surfaced. This is the model HomeSynapse should emulate (role lives in the profile).
- **Generic vs quirk-driven interview (Q2):** the interview itself (descriptors, endpoint enumeration, attribute reads) is genuinely generic; the *interpretation* of non-compliant payloads is quirk-driven. The split is roughly "transport/interview generic, application/parse quirk-driven."

### 2.3 deCONZ / Phoscon DDF
- **DDF = declarative JSON device descriptions (Q6).** Each DDF references a JSON schema (`devcap1.schema.json`), declares subdevices, items (ResourceItem suffixes merged with `generic/items/<name>.json`), and bindings with reporting config. Parse functions are **named C++ functions** (default `"fn": "zcl"`) with an optional JS `eval` expression — e.g. `{ "name":"state/bri","parse":{"fn":"zcl","ep":1,"cl":"0x0008","at":"0x0000","eval":"Item.val = Attr.val * 254 / 100"} }`.
- **Strength:** hot-reload, GUI editor, drag-and-drop; the design goal is "only small functions with max. of 200 lines of code. Adding a new device can't break another" — supporting the Innr SP-120 with power measurement + bindings + reporting "can be done in less than 3 minutes."
- **Documented weakness driving the DDF-bundle redesign:** "Global updates bound to a deCONZ release. When a new release comes out, it's all or nothing… When something breaks… there is no way back, other than downgrading of deCONZ. Distributing new DDF files is cumbersome." The bundle system (RIFF container, ASCII `DDFB` magic, first chunk `DESC` JSON with uuid/product/version_deconz/device_identifiers, SHA-256 hash over the DDFB section, signature levels official/stable/beta/user, per-device `ddf_policy`) decouples device updates from core releases. **This decoupling is the single most important idea for HomeSynapse to steal.**

### 2.4 Home Assistant core — EntityCategory (Q10)
- HA's `EntityCategory` enum: `CONFIG` ("an entity which allows changing the configuration of a device") and `DIAGNOSTIC` ("an entity exposing some configuration parameter or diagnostics of a device but does not allow changing it, for example a sensor showing RSSI or MAC-address"). Primary entities carry no category.
- **Reclassification churn:** the `str`→`EntityCategory` enum migration was deprecated in HA 2022.2 and removed in 2022.4 ("Detected code that uses str (diagnostic) for entity category… will stop working in Home Assistant 2022.4"), forcing every integration to migrate. Battery sensors repeatedly flipped to DIAGNOSTIC (Aranet #95197: "Other integrations typically use DIAGNOSTIC for batteries, since it's not part of the set of interesting measurements"; OpenMQTTGateway #2115 for Z2M-via-MQTT). ZHA added `device_temperature`, `basic_lqi`, `basic_rssi` as diagnostic entities (issue #65181). The EMS-ESP #1459 thread shows config/diagnostic flips causing user-visible dashboard breakage across releases — direct evidence that misclassification is a real maintenance cost, not a cosmetic one.

### 2.5 openHAB `com.zsmartsystems.zigbee` — the closest Java prior art
**What it got RIGHT (steal these):**
- **Single transport interface (`ZigBeeTransportTransmit`)** with one Maven module per chip: `.dongle.ember` = `ZigBeeDongleEzsp` ("Implementation of the Silabs Ember NCP… EZSP dongle"), `.dongle.cc2531` = `ZigBeeDongleTiCc2531`, `.telegesis` = `ZigBeeDongleTelegesis`, `.xbee` = `ZigBeeDongleXBee`. The core `ZigBeeNetworkManager` is constructed with whichever transport is chosen and **never depends on the chip**; chip-specific access uses thin `instanceof` escape hatches.
- **Serialized `ZigBeeTransactionManager`** with per-node `ZigBeeTransactionQueue`, a `ZigBeeTransactionProfile [maxOutstandingTransactions=1, interTransactionDelay=50, maxRetries=2]`, response correlation via `ZigBeeTransactionMatcher`, and timeouts (`TRANSACTION_TIMER_1 = 10000` ms send→ack, `TIMER_2 = 8000` ms transmitted→response).
- **Auto-generated ZCL library from XML.** Maintainer Chris Jackson (PR #936): "if I have 1 parameter in a command, this generates at least 5 pieces of code… the parameter definition, a getter and setter, and a serialise/deserialize method. If we make a mistake in the XML, then it gets fixed in all 5 places with 1 change… everything is consistent." Generated classes carry `@Generated(... "com.zsmartsystems.zigbee.autocode.ZigBeeCodeGenerator")` dated as recently as 2024-05-18.

**What it got WRONG (the lessons HomeSynapse must not repeat):**
- **Compiled-Java-converter-per-device.** Each capability is a `ZigBeeConverterXxx extends ZigBeeBaseChannelConverter` class (e.g. `ZigBeeConverterSwitchOnoff`, `ZigBeeConverterBatteryAlarm`, `ZigBeeConverterMeteringSummationDelivered`) registered via a hard-coded `channelMap.put(...)` in `ZigBeeChannelConverterFactory`. Adding a device feature means writing a `.class` and recompiling the bundle. Community users explicitly asked for a data-driven path ("Just like z2m, we could support individual devices… as a third party repository / database"); maintainer reply: even the XML thing-definition workaround "only allows adding channels connected to ZCL attributes… If a device doesn't follow the ZCL standards at all, then it will not be possible to add support without code changes." **This is the documented root cause of openHAB's small device catalogue and is the central anti-pattern HomeSynapse must avoid.**
- **Standards-only philosophy** → Xiaomi/Aqara are second-class. Official docs: they "are not fully ZigBee compliant, and are known to suffer from multiple problems. Pairing may require multiple attempts… unusually long, and non-standard, sleep time."
- **Type-safety runtime bug:** issue #873 — `java.lang.ClassCastException: class java.lang.Integer cannot be cast to class java.lang.Long` at `DefaultSerializer.appendZigBeeType(...:224)` during configure-reporting on metering plugs (binding 4.3.0 M4, Nov 2024); plugs failed to come back online and channels were not created. A stronger typed/generated serialization layer prevents this entire bug class.
- **ASH/EZSP framing fragility:** issue #440 / library #663, "ASH: ERROR received (code 81). Disconnecting." Also CC2531 `ZToolParseException: Packet checksum failed` (2.5 M4 regression).
- **One coordinator per bridge** — each `ZigBeeNetworkManager`↔transport binding is 1:1; multiple coordinators are independent networks with no aggregation. **No dual-coordinator precedent exists here** (see §5).

---

## §3 Cross-Cutting Analysis

| Concern | Z2M | ZHA/zigpy | deCONZ DDF | openHAB ZSS | HomeSynapse implication |
|---|---|---|---|---|---|
| Device defn form | JS/TS per-device | Python class (v1) / builder (v2) | JSON DDF | **compiled Java** | Data file (LTD-17) |
| Match key | modelID + manufacturerName fingerprint | exact signature (v1) / mfg+model (v2) | manufacturername+modelid | exact ZCL | mfg+model primary, signature fallback |
| Non-compliant device support | excellent (Tuya/Xiaomi layers) | excellent (quirks) | good | **poor** | must be first-class |
| Update decoupling | per-release npm + external converters | per-release / custom quirks | **DDF bundles (fully decoupled)** | recompile | data files shippable out-of-band |
| Transport abstraction | adapter layer | radio libs | native | **excellent (interface)** | steal the interface model |
| Transaction serialization | herdsman queues | zigpy | native | **excellent (per-node queue)** | steal it |

**Q6 verdict — what the device-profile schema should steal:**
- From **Z2M:** the `fingerprint {modelID, manufacturerName}` concept; modular per-vendor file layout; the Tuya datapoint table shape `[dp, property, converter]`.
- From **ZHA v2:** match primarily on manufacturer+model with an optional signature filter; carry entity role/category metadata *in the profile itself*.
- From **deCONZ DDF:** declarative JSON; **named parse functions referenced by string** (not inline code — respects LTD-17); update decoupling via versioned bundles with hashes/signatures; explicit schema versioning.
- From **openHAB:** the transport *interface* and the serialized transaction manager (architecture, not device data) — plus the negative lesson that the ZCL layer being data-driven is not enough; the *application* layer must be too.

Properties that predict low review burden + high community contribution: **(1) declarative data, not code; (2) match on mfg+model not full signature; (3) reuse of generic building blocks; (4) ability to ship/test a profile without recompiling or waiting for a core release.** Z2M and deCONZ score high on all four; openHAB scores low on (1) and (4) and pays for it in device coverage.

---

## §4 Amendment Candidates for the M14 Briefing
*(Each: effort-in-LOC, severity = how badly ignoring it bites during the 72-hour validation gate.)*

**REC-120 — Serialized per-device transaction queue with retry/backoff.**
Build a per-IEEE command queue with `maxOutstandingTransactions=1`, configurable inter-transaction delay (openHAB uses 50 ms), bounded retries (openHAB uses 2), and response correlation by transaction sequence number. Use `ReentrantLock` + virtual threads (LTD-11), not `synchronized`. **Effort:** ~400–600 LOC. **Severity: CRITICAL.** Without this, burst traffic during the 72h soak produces the exact SYS-ping/ASH timeout cascades in Z2M #29116. Single highest-leverage amendment.

**REC-121 — Sleepy End Device "queue-until-awake" semantics.**
Implement `sendWhenActive`-style deferral keyed on MAC data-request / Poll-Control check-in, for three flows: interview, configure-reporting, IAS enrollment. Hold pending writes and replay on next poll rather than failing and discarding. Account for the 7.68 s parent-hold limit (herdsman #445). **Effort:** ~300–450 LOC. **Severity: CRITICAL.** Z2M #445 and #30542 show config silently lost for SEDs; battery devices fail the gate intermittently and non-reproducibly.

**REC-122 — Data-file device-profile schema (no compiled-per-device).**
JSON/TOML device-profile schema consumed by a single compiled Java adapter: fingerprint (modelID + manufacturerName), endpoint→cluster map, attribute→entity mapping with EntityRole, reporting overrides, Tuya datapoint table. Named parse-transform handlers referenced by string key, resolved to compiled Java (respects LTD-17 — no scripting engine). **Effort:** ~700–1000 LOC (schema + loader + registry). **Severity: HIGH.** Ignoring this reproduces openHAB's fatal limitation; you cannot add the long tail of test devices during M14 without recompiling.

**REC-123 — Coordinator firmware version gate + NVRAM backup/restore.**
On startup, read and log coordinator type + firmware; refuse to start with an actionable error on EZSP mismatch — the exact upstream string is `NCP EZSP protocol version of XX does not match Host version 13: ember currently requires a firmware with EZSP v13 (EmberZNet firmware 7.4.x)`. Persist a coordinator backup (network key, PAN ID, ext PAN ID, channel, device table) in a portable JSON shape (Z2M `coordinator_backup.json` model) so a coordinator swap doesn't force re-pairing. **Effort:** ~250–400 LOC. **Severity: HIGH.** A firmware mismatch or lost backup mid-gate means re-pairing the entire test network.

**REC-124 — Tuya datapoint codec as data, with seq/checksum + time-sync + magic-packet hooks.**
Encode Tuya DP mappings as `[dp, property, converter]` data rows; provide compiled converter primitives (raw, divideBy10, enum, bitmap). Implement `onEventSetTime` (devices demand time-sync), `configureMagicPacket` init, and a `respondToMcuVersionResponse=false` toggle (battery-drain mitigation, zhc #10130: "Device battery drained too fast due to continuous McuVersionResponse messages"). Track the Tuya `seq` field to detect reordered/duplicate DP frames (energy_flow inversion bug documented inline in `tuya.ts`). **Effort:** ~500–800 LOC. **Severity: HIGH.** Tuya is the largest churn source and reuses modelID `TS0601` across unrelated products; wrong DP mapping produces "relay reports wrong state / commands don't switch" failures (zhc #11680) that look like core bugs during the gate.

**REC-125 — Xiaomi/Aqara 0xFF01/0xFF02 TLV parser + heartbeat/leave handling.**
Parse the manufacturer-specific Basic-cluster attribute 0xFF01 (XIAOMI_AQARA_ATTRIBUTE), 0xFF02 (XIAOMI_MIJA_ATTRIBUTE), and 0x00F7 (E1 series) as TLV blobs (battery, RSSI, temp, humidity). Do **not** trust the ZCL datatype — it is mis-reported as CHARACTER_STRING (openHAB #530). Treat Aqara heartbeats as keep-alive; tolerate devices that drop off without LeaveRequest (don't purge on a missing child-table entry). **Effort:** ~300–450 LOC. **Severity: MEDIUM-HIGH.** Aqara devices are ubiquitous in test kits; mis-parsing produces the "30V battery / -10000 °C" garbage in deCONZ #1708.

**REC-126 — IAS zone auto-enroll with race tolerance.**
On IAS Zone join: write CIE address, then proactively send Zone Enroll Response (auto-enroll) rather than only waiting for trip-to-pair; tolerate `zoneState` not changing immediately; allow re-enroll on reconnect without full re-pair. **Effort:** ~200–350 LOC. **Severity: HIGH.** Z2M #27671 ("zoneState didn't change" → interview fails) and #16373 (IAS devices drop off; recovery requires editing the DB to set `interviewCompleted:false`) show enroll failures abort the whole interview — high-visibility during a security-sensor soak.

**REC-127 — Mesh telemetry: route-aware, not LQI-threshold alerting.**
Capture LQI and RSSI per link but do **not** alert on raw thresholds — the Z2M FAQ is explicit: "Interpreting RSSI and LQI values is complex. Unless you are a Zigbee specialist… please ignore those values. They can be misleading." Alert instead on *delivery-failure rate* and *route churn* (parent changes / failed APS deliveries). Treat a battery device "missing from map" as informational (child-ageing), not failure. **Effort:** ~350–500 LOC. **Severity: MEDIUM.** Wrong here → alert fatigue that discredits the whole telemetry surface during the gate. Note HA #129556: ZHA reports LQI as a mere inverse of RSSI on some stacks, so they must not be treated as independent signals.

**REC-128 — OTA forward-compatible posture (no OTA execution in MVP).**
Adopt the Koenkk/zigbee-OTA `index.json` record shape now (`fileName`, `modelId`, `manufacturerName[]`, plus the four matching keys: manufacturerCode 16-bit, imageType 16-bit, fileVersion 32-bit `new > existing`, 32-byte OTA header string) as the persisted "available image" record, even though MVP does not flash. Reserve the QueryNextImage handler interface and tunables (`image_block_response_delay`, `default_maximum_data_size` 10–100 B). Note the ecosystem is consolidating: HA Core 2026.1.0 shipped a central `zigpy-ota` repo governed by the Open Home Foundation. **Effort:** ~150–250 LOC (data model + interfaces only). **Severity: LOW now / HIGH if designed shut.** Retrofitting OTA into a model that omitted imageType/manufacturerCode/header fields is expensive.

**REC-129 — Channel selection + join-security defaults baked into network formation.**
Default to channel 15, 20, or 25; document the Wi-Fi-overlap tradeoff (15 between Wi-Fi 1/6, 20 between 6/11, 25 near Wi-Fi 13 but lower TX power under FCC); warn that a channel change post-pairing forces re-pair. Support install-code joining (Zigbee 3.0 mandatory: 16-byte code + 2-byte CRC → AES-MMO-derived preconfigured link key) alongside the well-known-key fallback (`ZigBeeAlliance09` = 5A6967426565416C6C69616E63653039) for legacy devices, and require the R21 TC-link-key update on join. **Effort:** ~150–250 LOC. **Severity: MEDIUM.**

---

## §5 Caveats and Open Questions

1. **Firmware "stable baseline" is a moving target.** The EZSP v13 / firmware 7.4.x–8.x recommendation and the darkxst/Nerivec/Nabu-Casa builds are current as of late-2025/early-2026 sources; re-verify the exact recommended build at M14 start.
2. **Dual-coordinator is genuinely unsolved in prior art.** None of the surveyed platforms aggregate two coordinators into one logical network (openHAB is strictly 1:1 `NetworkManager`↔transport). Doc 08's dual-coordinator requirement has **no field precedent to copy** — highest-uncertainty area; recommend a dedicated spike rather than assuming a reference design exists.
3. **LQI/RSSI semantics vary by stack** (HA #129556: ZHA returns LQI as an inverse of RSSI on some setups). Telemetry must not assume independence.
4. **Tuya `_TZE284_`/`_TZE204_`/`_TZE200_` prefixes reuse modelID `TS0601`** across wildly different devices; fingerprinting on manufacturerName is mandatory — modelID alone is insufficient.
5. **The EntityRole legality matrix (Q10) is a HomeSynapse design constraint, not an observed HA fact.** The table in §7.4 maps HA's observed categorization onto the matrix, but the matrix itself is locked by Decision 9.
6. **External-converter security posture:** Z2M disabled external JS converters by default in 2.11.0+. HomeSynapse's data-file model (no executable code in profiles) is structurally safer, but profile loading still needs validation/signing if profiles are shippable out-of-band (deCONZ DDF-bundle signature model is the reference).

---

## §6 Sources
- Z2M coordinator crash / SYS-ping: https://github.com/Koenkk/zigbee2mqtt/issues/29116
- Z2M herdsman startup failures: https://github.com/Koenkk/zigbee2mqtt/issues/26556 ; https://github.com/Koenkk/zigbee2mqtt/issues/26129
- Z2M fails-to-start guide (firmware baselines, USB/serial pitfalls): https://www.zigbee2mqtt.io/guide/installation/20_zigbee2mqtt-fails-to-start_crashes-runtime.html
- EmberZNet adapter docs (EZSP v13, ember vs ezsp, NOT READY back-pressure): https://www.zigbee2mqtt.io/guide/adapters/emberznet.html
- zStack adapter docs (CC2652/CC1352, backup support): https://www.zigbee2mqtt.io/guide/adapters/zstack.html
- Supported adapters / chip differences: https://www.zigbee2mqtt.io/guide/adapters/
- MG24 firmware + ASH flow-control discussion: https://github.com/Koenkk/zigbee2mqtt/discussions/28697
- Improved ember (EZSP) driver discussion: https://github.com/Koenkk/zigbee2mqtt/discussions/21462
- SED request timing (7.68 s parent hold, sendWhenActive): https://github.com/Koenkk/zigbee-herdsman/issues/445
- SED reporting-config lost: https://github.com/Koenkk/zigbee2mqtt/discussions/30542
- Interview stuck "Configuring" workaround: https://community.home-assistant.io/t/solution-workaround-for-zigbee-zha-devices-stuck-in-interview-complete-configuring/777247
- Tuya support docs (datapoint discovery): https://www.zigbee2mqtt.io/advanced/support-new-devices/02_support_new_tuya_devices.html
- Tuya converter source (seq, energy_flow inversion, magic packet): https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/tuya.ts
- Tuya McuVersionResponse battery drain: https://github.com/Koenkk/zigbee-herdsman-converters/issues/10130
- Tuya DP mismapping (relay wrong state): https://github.com/Koenkk/zigbee-herdsman-converters/issues/11680
- Xiaomi zhaquirks 0xFF01/0xFF02/0x00F7: https://github.com/zigpy/zha-device-handlers/blob/dev/zhaquirks/xiaomi/__init__.py
- deCONZ Xiaomi 0xFF01 garbage readings: https://github.com/dresden-elektronik/deconz-rest-plugin/issues/1708
- openHAB Xiaomi 0xFF01 wrong ZCL datatype: https://github.com/openhab/org.openhab.binding.zigbee/issues/530
- deCONZ DDF docs (parse fn, items, bindings): https://dresden-elektronik.github.io/deconz-dev-doc/modules/ddf/
- deCONZ DDF bundle / REST (decoupling, hashes, policy): https://dresden-elektronik.github.io/deconz-rest-doc/endpoints/ddf/
- DDF bundle format (RIFF/DDFB): https://github.com/deconz-community/ddf-tools/blob/main/packages/bundler/README.md
- DDF cheat sheet: https://github.com/dresden-elektronik/deconz-rest-plugin/wiki/DDF-cheat-sheet
- zigpy quirks v2 (builder, signature filter): https://deepwiki.com/zigpy/zigpy/3.2-enhanced-quirks-(v2)
- zha-device-handlers README (exact signature match): https://github.com/zigpy/zha-device-handlers
- Tuya QuirkBuilder: https://github.com/zigpy/zha-device-handlers/blob/dev/tuya.md
- IAS not-enrolled pairing fail: https://github.com/koenkk/zigbee2mqtt/issues/27671
- IAS devices dropping off (DB edit recovery): https://github.com/Koenkk/zigbee2mqtt/issues/16373
- Channel/Wi-Fi interference (openHAB community): https://community.openhab.org/t/zigbee-channelling-considerations-when-installing-your-zigbee-network/103455
- Install codes (Silabs AN1089): https://www.silabs.com/documents/public/application-notes/an1089-using-installation-codes-with-zigbee-devices.pdf
- Zigbee 3.0 R21 join/TC-link-key (TI SWRA615A): https://www.ti.com/lit/ab/swra615a/swra615a.pdf
- LQI/RSSI "misleading" FAQ: https://www.zigbee2mqtt.io/guide/faq/
- ZHA LQI=inverse-of-RSSI bug: https://github.com/home-assistant/core/issues/129556
- OTA updates docs (index, tunables, brick warning): https://www.zigbee2mqtt.io/guide/usage/ota_updates.html
- zigbee-OTA index schema + matching keys: https://github.com/Koenkk/zigbee-OTA
- zigpy-ota central repo (HA 2026.1) discussion: https://github.com/Koenkk/zigbee2mqtt/discussions/2921
- Aqara E1 NXP OTA deep-dive (block size, server cluster): https://www.duk.io/blog/electronics-projects/aqara-e1/nxp-zigbee-ota-update/
- HA EntityCategory docs (CONFIG/DIAGNOSTIC defs): https://developers.home-assistant.io/docs/core/entity/
- EntityCategory str→enum deprecation: https://github.com/home-assistant/core/issues/65181
- Battery→DIAGNOSTIC example: https://github.com/home-assistant/core/issues/95197
- Config/diagnostic flip breakage (EMS-ESP): https://github.com/emsesp/EMS-ESP32/discussions/1459
- openHAB ZSS library: https://github.com/zsmartsystems/com.zsmartsystems.zigbee
- openHAB ZSS ClassCastException Integer→Long #873: https://github.com/openhab/org.openhab.binding.zigbee/issues/873
- openHAB ZSS ASH code 81 #440: https://github.com/openhab/org.openhab.binding.zigbee/issues/440
- openHAB ZSS code-gen rationale PR #936: https://github.com/zsmartsystems/com.zsmartsystems.zigbee/pull/936
- openHAB ZSS converter-per-device discussion (maintainer quotes): https://community.openhab.org/t/how-to-add-converter-for-unsupported-zigbee-device/149150
- openHAB binding docs (Xiaomi/Aqara non-compliance): https://www.openhab.org/addons/bindings/zigbee/
- Z2M device count (homebridge-z2m mirror, 5076 @ zhc 26.27.0): https://z2m.dev/devices/
- zigbee-herdsman-converters repo (per-vendor files): https://github.com/Koenkk/zigbee-herdsman-converters

---

## §7 Code-Level Implications (LIGHT — concept tables and schema sketches only)

### 7.1 Concept-mapping table (foreign term → HomeSynapse term)

| Foreign concept | Source platform | HomeSynapse mapping |
|---|---|---|
| `fingerprint {modelID, manufacturerName}` | Z2M | DeviceProfile match key |
| zigpy v2 `QuirkBuilder.applies_to` | ZHA | DeviceProfile alias list |
| DDF `parse.fn` named function | deCONZ | Compiled `ParseHandler` referenced by string key (LTD-17 safe) |
| `tuyaDatapoints [dp, prop, converter]` | Z2M | `datapoints` array in profile |
| DDF bundle + signature + `ddf_policy` | deCONZ | versioned, signed, out-of-band-shippable profile bundle |
| `ZigBeeTransportTransmit` | openHAB | `CoordinatorTransport` interface |
| `ZigBeeTransactionManager` / per-node queue | openHAB | per-device `TransactionQueue` (ReentrantLock + virtual threads, LTD-11) |
| `EntityCategory.DIAGNOSTIC/CONFIG` | HA | `EntityRole.DIAGNOSTIC / CONFIG` |
| `coordinator_backup.json` | Z2M | `CoordinatorBackup` record (typed ULID, LTD-04) |
| zigbee-OTA `index.json` record | Koenkk | `OtaImageDescriptor` record |
| `sendWhenActive` | herdsman | per-device `pendingWhenAwake` queue |

### 7.2 Device-profile data-file schema sketch (illustrative)

```
DeviceProfile {
  profileId: ULID            # LTD-04 typed ULID
  schemaVersion: int
  match: {
    manufacturerName: [string]   # PRIMARY key, e.g. ["_TZE200_d0yu2xgi"]
    modelID: string              # e.g. "TS0601" (insufficient alone — see §5.4)
    signature?: { endpoints: {...} }   # optional fallback, ZHA-style exact match
  }
  endpoints: {
    "<epId>": { inClusters: [int], outClusters: [int] }
  }
  attributes: [
    { cluster: int, attr: int, entity: string,
      role: PRIMARY|DIAGNOSTIC|CONFIG,
      parse: string,            # named compiled handler key (no inline code)
      reporting?: { min: int, max: int, change: number } }
  ]
  tuyaDatapoints?: [
    { dp: int, property: string, converter: string }  # converter = named key
  ]
  manufacturerTlv?: { attr: 0xFF01, layout: string }   # Xiaomi/Aqara
  quirks?: { respondToMcuVersionResponse: bool, magicPacket: bool, setTime: bool }
}
```

### 7.3 OTA image descriptor sketch (reserve-only, no flashing in MVP)

```
OtaImageDescriptor {
  imageId: ULID
  fileName: string
  modelId: string
  manufacturerName: [string]
  manufacturerCode: int        # 16-bit, match: new == old
  imageType: int               # 16-bit, match: new == old
  fileVersion: long            # 32-bit, match: new > existing
  otaHeaderString: string      # 32-byte, match: new == old
  sourceUrl: string
}
```

### 7.4 Q10 — EntityRole classification table (HomeSynapse vocabulary)

EntityRole ∈ {PRIMARY, DIAGNOSTIC, CONFIG}. Legality matrix enforced:
**LIGHT {P,D}, SWITCH {P,D,C}, PLUG {P}, SENSOR {P,D}, BINARY_SENSOR {P,D}, ENERGY_METER {P,D}.**
Coordinator-state default = DIAGNOSTIC (Decision 9). Every row respects the matrix.

| Entity kind | EntityType | EntityRole | Rationale (HA-observed → HomeSynapse) |
|---|---|---|---|
| On/off state | LIGHT | PRIMARY | The light itself |
| On/off state | SWITCH | PRIMARY | The switch itself |
| On/off state | PLUG | PRIMARY | The plug itself (PLUG is P-only) |
| Brightness/color | LIGHT | PRIMARY | Core light control |
| Battery % | SENSOR | DIAGNOSTIC | HA marks battery DIAGNOSTIC universally |
| Battery voltage | SENSOR | DIAGNOSTIC | Diagnostic-only raw value |
| LQI | SENSOR | DIAGNOSTIC | HA `basic_lqi` is diagnostic |
| RSSI | SENSOR | DIAGNOSTIC | HA docs cite RSSI as the canonical DIAGNOSTIC example |
| Identify button | SWITCH | CONFIG | Actionable config affordance (only SWITCH grants C) |
| Power-on behavior | SWITCH | CONFIG | Changes device config |
| Sensitivity setting | SWITCH | CONFIG | Config affordance |
| Timeout / occupancy-delay | SWITCH | CONFIG | Config affordance |
| Temperature reading | SENSOR | PRIMARY | The sensor's purpose |
| Occupancy / contact | BINARY_SENSOR | PRIMARY | The sensor's purpose |
| Tamper | BINARY_SENSOR | DIAGNOSTIC | Secondary diagnostic state |
| Instantaneous power (W) | ENERGY_METER | PRIMARY | Meter's purpose |
| Cumulative energy (kWh) | ENERGY_METER | PRIMARY | Meter's purpose |
| Device temperature (chip) | ENERGY_METER | DIAGNOSTIC | Internal diagnostic |
| Coordinator network state | SENSOR | DIAGNOSTIC | Decision 9 default |

**Legality enforcement note:** power-on-behavior, sensitivity, and timeout are CONFIG affordances. Because the matrix grants CONFIG **only** to SWITCH, these must be modeled as SWITCH-type CONFIG entities — never SENSOR/PLUG CONFIG. PLUG exposes its on/off as PRIMARY only; any plug-level diagnostics (energy, LQI) are surfaced through associated SENSOR/ENERGY_METER entities, not on the PLUG itself. This is the single most common reclassification trap observed in HA (battery/LQI/RSSI flipping category across releases) and the schema in §7.2 carries `role` per attribute precisely so a profile author cannot emit an illegal combination.