# HomeSynapse Core — Phase 2 Transition Guide

**Document type:** Governance
**Status:** Locked
**Effective date:** 2026-03-10
**Owner:** nick@nexsys.io

---

## 0. Purpose

This document records the decisions and configurations required before Phase 2 (Interface-Level Specification) begins. It resolves Phase 2 Prerequisites #2–5 from PROJECT_STATUS.md and establishes the toolchain baseline for all Phase 2 and Phase 3 work.

---

## 1. JDK Distribution Pin

**Decision:** Amazon Corretto 21.0.10.7.1 (OpenJDK 21.0.10+7, released 2026-01-20).

**Rationale:** Corretto is Amazon's no-cost, LTS distribution of OpenJDK. It provides quarterly security patches, supports aarch64 Linux natively (required for Raspberry Pi deployment per LTD-02), and includes the jlink tool required by LTD-13. Corretto 21 is supported through October 2030, exceeding the project's five-year horizon.

**Version catalog entry (Gradle):**

```toml
[versions]
corretto = "21.0.10.7.1"
java-language = "21"

[plugins]
# The Corretto JDK is the build-time and runtime JDK.
# jlink bundles only the required modules into the distribution (LTD-13).
# No JDK is required on the target device.
```

JVM configuration is specified in LTD-01 and is not duplicated here. The canonical JVM flags are in the Locked Decisions Register.

**Update policy:** Pin to the latest Corretto 21 LTS patch at the start of each development quarter. Security patches that address CVEs rated HIGH or CRITICAL are applied within one week of release. Version changes are recorded in this document and in the version catalog commit message.

**Phase 3 validation:** Confirm that the jlink image built with this Corretto version starts correctly on Raspberry Pi 5 (Debian Bookworm, aarch64) and Raspberry Pi 4 (validation floor per LTD-02). This is part of the first Phase 3 integration test, not a separate gate.

---

## 2. sqlite-jdbc Version Pin

**Decision:** xerial sqlite-jdbc 3.51.2.0 (bundles SQLite 3.51.2, released 2026-02-10).

**Rationale:** This is the latest stable release at time of Phase 2 entry. The xerial driver bundles precompiled native libraries for linux-aarch64, eliminating the need for on-device compilation. SQLite 3.51.2 includes all WAL mode improvements through the SQLite 3.51 release line.

**Version catalog entry (Gradle):**

```toml
[versions]
sqlite-jdbc = "3.51.2.0"

[libraries]
sqlite-jdbc = { module = "org.xerial:sqlite-jdbc", version.ref = "sqlite-jdbc" }
```

**WAL validation gate (Phase 3 prerequisite):** Before any production data touches SQLite, a validation spike must confirm:

1. WAL mode activates correctly on aarch64 Linux with the ext4 filesystem (RPi 5 NVMe, per LTD-02).
2. `PRAGMA journal_mode=WAL` persists across connection close/reopen.
3. `PRAGMA synchronous=NORMAL` (LTD-03) does not produce corruption under simulated power-loss (kill -9 during sustained writes).
4. Page cache memory usage (`PRAGMA cache_size`) behaves as expected under the 128 MB allocation (LTD-03).
5. The native library extracts correctly from the jlink image (no `java.io.tmpdir` conflicts with systemd `PrivateTmp=true` per LTD-13).

This spike is the first Phase 3 task. Results are recorded in `research/sqlite-wal-validation-spike.md`. If the spike reveals problems, the sqlite-jdbc version is revised before any further Phase 3 work proceeds.

**Update policy:** Track xerial releases quarterly. Prefer staying on the latest SQLite minor version for security patches. Major SQLite version upgrades (e.g., 3.51 → 3.52) require re-running the WAL validation spike.

---

## 3. Licensing Model

**Decision:** Proprietary. All rights reserved by NexSys Technologies.

**Rationale:** The project is not ready for public release. Open-source licensing is a one-way door — once granted, it cannot be revoked for existing code. The proprietary default preserves optionality. If and when the project reaches a public release milestone, the licensing decision will be revisited with full analysis of strategic implications (community building vs. IP protection, license compatibility with dependencies, contributor agreements).

**Dependency license compatibility:** All current dependencies (Corretto/OpenJDK, sqlite-jdbc, Jackson, SnakeYAML Engine, SLF4J, Logback, Javalin, Preact) are licensed under Apache 2.0, MIT, BSD, or EPL — all compatible with proprietary distribution. No GPL-licensed dependencies are permitted without explicit review.

**License file:** A `LICENSE` file will be placed in the repository root with the text:

```
Copyright (c) 2025-2026 NexSys Technologies. All rights reserved.

This software is proprietary and confidential. Unauthorized copying,
distribution, or use of this software, via any medium, is strictly
prohibited without the express written permission of NexSys Technologies.
```

**Revisit trigger:** Before any of the following: public repository visibility, external contributor access, conference presentation of source code, or distribution to beta testers outside NexSys.

---

## 4. Copyright Header Template

**Decision:** All Java source files, configuration schemas, and build scripts carry the following header.

**Java source files (`.java`):**

```java
/*
 * Copyright (c) 2025-2026 NexSys Technologies. All rights reserved.
 *
 * This software is proprietary and confidential. Unauthorized copying,
 * distribution, or use of this software, via any medium, is strictly
 * prohibited without the express written permission of NexSys Technologies.
 *
 * SPDX-License-Identifier: LicenseRef-NexSys-Proprietary
 */
```

**Build scripts (`build.gradle.kts`, `settings.gradle.kts`):**

```kotlin
/*
 * Copyright (c) 2025-2026 NexSys Technologies. All rights reserved.
 * SPDX-License-Identifier: LicenseRef-NexSys-Proprietary
 */
```

**YAML configuration schemas and JSON Schemas:**

```yaml
# Copyright (c) 2025-2026 NexSys Technologies. All rights reserved.
# SPDX-License-Identifier: LicenseRef-NexSys-Proprietary
```

**Year range policy:** The start year (2025) marks the project's inception. The end year is updated to the current calendar year when a file is modified. Automated tooling (Spotless Gradle plugin) enforces header presence during builds. Manual year updates are acceptable; automated year-range updating is a nice-to-have, not a gate.

**Enforcement:** The Gradle build includes a Spotless check that fails the build if any `.java` file lacks the copyright header. This check is configured during Phase 2 project scaffold setup.

---

## 5. Gradle Version Catalog Baseline

The following `gradle/libs.versions.toml` entries establish the Phase 2 starting point. Additional entries will be added as interface specifications identify exact dependency versions.

```toml
[versions]
java-language = "21"
corretto = "21.0.10.7.1"
sqlite-jdbc = "3.51.2.0"
jackson = "2.18.6"
snakeyaml-engine = "2.9"
slf4j = "2.0.17"
logback = "1.5.32"
javalin = "6.7.0"
preact = "10.25.4"
junit = "5.14.3"
assertj = "3.27.7"

[libraries]
sqlite-jdbc = { module = "org.xerial:sqlite-jdbc", version.ref = "sqlite-jdbc" }
jackson-core = { module = "com.fasterxml.jackson.core:jackson-core", version.ref = "jackson" }
jackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind", version.ref = "jackson" }
jackson-annotations = { module = "com.fasterxml.jackson.core:jackson-annotations", version.ref = "jackson" }
jackson-datatype-jsr310 = { module = "com.fasterxml.jackson.datatype:jackson-datatype-jsr310", version.ref = "jackson" }
jackson-module-blackbird = { module = "com.fasterxml.jackson.module:jackson-module-blackbird", version.ref = "jackson" }
snakeyaml-engine = { module = "org.snakeyaml:snakeyaml-engine", version.ref = "snakeyaml-engine" }
slf4j-api = { module = "org.slf4j:slf4j-api", version.ref = "slf4j" }
logback-classic = { module = "ch.qos.logback:logback-classic", version.ref = "logback" }
logback-core = { module = "ch.qos.logback:logback-core", version.ref = "logback" }
javalin = { module = "io.javalin:javalin", version.ref = "javalin" }
junit-jupiter = { module = "org.junit.jupiter:junit-jupiter", version.ref = "junit" }
junit-platform-launcher = { module = "org.junit.platform:junit-platform-launcher" }
assertj-core = { module = "org.assertj:assertj-core", version.ref = "assertj" }
apiguardian-api = { module = "org.apiguardian:apiguardian-api", version = "1.1.2" }
archunit-junit5 = { module = "com.tngtech.archunit:archunit-junit5", version = "1.4.0" }
```

Note: These versions are the latest stable releases as of 2026-03-10. The version catalog is a living artifact — versions are updated as part of quarterly dependency review. The versions listed here are starting points, not locked decisions. Only the JDK (LTD-01) and SQLite (LTD-03) have architectural significance; all other dependency versions are implementation details that may be updated without governance review.

**Versions not yet pinned (Phase 2 will resolve):**

- JSON Schema validation library (everit-org or networknt — decision during Doc 06 interface spec)
- OpenAPI specification tooling (if code-first or spec-first — decision during Doc 09 interface spec)
- AsyncAPI specification tooling (decision during Doc 10 interface spec)
- Vite build tool version (decision during Doc 13 interface spec)
- Spotless plugin version (decision during project scaffold setup)

---

## 6. Phase 2 Scope and Entry Criteria

### 6.1 Entry Criteria (all satisfied)

| Criterion | Status |
|---|---|
| All 14 Phase 1 design documents locked | Complete (2026-03-10) |
| A-01-DR-1 event_category amendment applied | Complete (2026-03-10) |
| JDK distribution pinned | Complete (this document, §1) |
| sqlite-jdbc version pinned | Complete (this document, §2) |
| Copyright header defined | Complete (this document, §4) |
| Licensing model decided | Complete (this document, §3) |

### 6.2 Phase 2 Definition

Phase 2 produces, for each subsystem:

1. **Java package structure** — module-info.java where applicable, package hierarchy.
2. **Public interfaces** — all public interfaces with full method signatures, generic type parameters, checked exceptions, and Javadoc contracts.
3. **Public types** — all records, enums, sealed interfaces, and exception types referenced by interfaces.
4. **Configuration schemas** — JSON Schema for each subsystem's YAML configuration namespace (Doc 06 §3).
5. **API specifications** — OpenAPI 3.1 for REST endpoints (Doc 09), AsyncAPI 3.0 for WebSocket protocol (Doc 10).
6. **Package-level READMEs** — brief description of each package's responsibility and key types.

Phase 2 does NOT produce implementation code, test code, or build automation beyond the project scaffold.

### 6.3 Phase 2 Production Order

Interface specifications follow the same dependency order as Phase 1 design documents (MVP §9.3). The first subsystem to specify is Doc 01 (Event Model & Event Bus) — it has no upstream dependencies and every other subsystem depends on it.

### 6.4 Phase 2 Document Template

Each Phase 2 interface specification is a compilable Java source tree, not a prose document. The "document" is the code itself — interfaces, types, and Javadoc. Quality criteria:

- Every public method has a Javadoc contract specifying preconditions, postconditions, and exception semantics.
- Every interface is traceable to a specific section in the corresponding Phase 1 design document.
- Every type name matches the Glossary exactly.
- Every ID type uses the typed ULID wrapper pattern (LTD-04).
- No implementation code — method bodies throw `UnsupportedOperationException` or are abstract.
- Compiles cleanly with `javac` at source level 21 with `-Xlint:all -Werror`.

---

## 7. RECOMMENDED Review Amendments Status

Nine RECOMMENDED amendments from the Critical Design Review (AMD-12, AMD-18–24) remain deferred. These are applied opportunistically during Phase 2 as interface specification work touches the relevant subsystems:

| AMD | Summary | Natural Integration Point |
|---|---|---|
| AMD-12 | Structured error taxonomy for config validation | Doc 06 interface spec |
| AMD-18 | Causal chain timeout extension | Doc 01 or Doc 07 interface spec |
| AMD-19 | Subscriber backpressure signal | Doc 01 interface spec |
| AMD-20 | Integration restart jitter | Doc 05 interface spec |
| AMD-21 | Automation conflict resolution strategy | Doc 07 interface spec |
| AMD-22 | HealthChangeListener interface | Doc 11 interface spec |
| AMD-23 | Telemetry store compaction trigger | Doc 04 interface spec |
| AMD-24 | API key rotation without downtime | Doc 09 interface spec |

These amendments do not block Phase 2 entry. They are tracked here and in PROJECT_STATUS.md.

---

## 8. Project Scaffold Setup (First Phase 2 Task)

Before the first interface specification, establish the `homesynapse-core` repository scaffold:

1. `settings.gradle.kts` with root project name and Gradle module declarations (empty modules initially).
2. `gradle/libs.versions.toml` with the version catalog from §5.
3. `buildSrc/` or convention plugin with Java 21 toolchain configuration, Spotless copyright header check, and common compiler flags (`-Xlint:all -Werror`).
4. Root `LICENSE` file per §3.
5. `.gitignore` for Gradle, IntelliJ, and macOS artifacts.
6. CI configuration (GitHub Actions) with `./gradlew check` on push.
7. `README.md` with project name, license notice, and build instructions.

The Gradle module map follows Doc 14 §3.6. Initial modules are empty directories with `build.gradle.kts` files — they compile to empty JARs. Phase 2 populates them with interfaces and types.

---

This document is part of HomeSynapse Core project governance. It bridges Phase 1 (System Design Documentation) and Phase 2 (Interface-Level Specification).
