# Simple Web Product Reassessment & Architecture Plan

**Status**: PROPOSED REASSESSMENT  
**Date**: 2026-09-16  
**Context**: HP Desk management release sync (`3542d50`) and Crafty beta qualification (`96dd06a`) completed. This document synthesizes the product vision for a simple Crafty-backed web management experience, conducts a comprehensive magic-number inventory across the Go control plane, challenges custom code surfaces, and specifies operational foundations.

---

## 1. Product Vision & Simple Web Architecture

The target product provides an intuitive, reliable web management interface for Minecraft servers across isolated tenants, avoiding bespoke web UI rewrites by leveraging **Crafty Controller v4.10.8** as the primary management engine.

### A. Ownership Hierarchy
$$\text{User Membership} \longrightarrow \text{Tenant} \longrightarrow \text{Server} \longrightarrow \text{World Set} \longrightarrow \text{Immutable Profile Revision}$$

1. **User Membership**: Users belong to one or more tenants with assigned roles (Admin, Operator, Viewer). Users do not own servers directly.
2. **Tenant**: Provides organizational isolation, access boundary, and resource quota allocation.
3. **Server**: An execution entity managed within Crafty. **Versions belong to servers, not users**.
4. **World Set**: An isolated directory set containing the three dimensions (Overworld, Nether, The End) and `level.dat`. A server binds to exactly one world set. Worlds are never shared or cross-mounted.
5. **Immutable Profile Revision**: Cryptographically pinned specification of Minecraft version, loader (Paper/Fabric), Java runtime path, exact server JAR SHA-256 hash, and JVM memory/flag parameters.
6. **On-Demand Artifacts**: Server binaries, loaders, and approved plugins are cataloged in profile manifests and downloaded on demand into server instances rather than being baked into monolithic container images.

---

## 2. Magic Number & Hardcoded Literal Inventory

A comprehensive scan of `internal/` reveals the following literals, categorized by domain and recommended treatment:

### Category 1: Protocol & Format Invariants (Keep as Constants)
*These represent fixed upstream protocol definitions or external standards.*
- `ContractVersion = "2.0.1"` (`internal/crafty/client.go:19`): Fixed Crafty OpenAPI version contract.
- Standard Minecraft Ports: `25565` (Paper), `25566` (Fabric).
- Crafty Default HTTPS Port: `8443`.
- SQLite `WAL` and `FULL` sync mode pragmas.

### Category 2: Version & Compatibility Pins (Keep in Profile Manifests)
*These define verified runtime environments and must remain immutable per profile revision.*
- Paper Version: `1.21.11` (Build pinned with SHA-256).
- Fabric Version: `1.21.11` (Loader `0.19.3`, Installer `1.1.2`).
- Java Target Bytecode: `major - 44 <= 65` (Java 21 bytecode verification).
- Build Container: Go `1.27.0` digest-pinned.

### Category 3: Operational Policy & Resource Limits (Move to `mcctl.config.json`)
*These govern host safety and admission gates. They are currently hardcoded in Go logic and should be extracted to configuration.*
- `MaxCombinedHeap = 6656 MiB` (6.5 GiB ceiling across all active servers).
- `PaperMaxHeap = 4096 MiB` (4 GiB).
- `FabricMaxHeap = 2560 MiB` (2.5 GiB).
- `MinMemAvailable = 3072 MiB` (3 GiB minimum headroom after JVM allocation).
- `JVMOverheadAllowance = 512 MiB` (non-heap memory buffer per process).
- `MaxHostCPU = 90.0%` (sustained 5-minute CPU threshold for rejection).
- `MaxLoadAverage = 6.0` (1-minute load average threshold).
- `MaxSwapRate = 10.0 MiB/min` (sustained over 3 samples).
- `MinFreeStorageBytes = 5 * 1024 * 1024 * 1024` (5 GiB storage minimum).

### Category 4: Cadence & Retention Parameters (Configurable Defaults)
*These govern metric collection, alert evaluation, and rollup schedules.*
- `SampleInterval = 30 * time.Second` (monitor timer).
- `ReservationTTL = 5 * time.Minute` (startgate admission hold).
- `AlertHysteresisSamples = 2` (consecutive samples to trigger warning or recovery).
- `AlertReminderThrottle = 30 * time.Minute` (minimum interval between repeated notifications).
- `RawSampleRetention = 48 * time.Hour`.
- `FiveMinuteRollupRetention = 30 * 24 * time.Hour` (30 days).
- `DailyRollupRetention = 180 * 24 * time.Hour` (180 days).

### Category 5: Test Fixtures & Mocks (Isolated in `*_test.go`)
- Mock CPU/memory/disk readings in `internal/monitor/` and `internal/gate/` tests.
- Synthetic timestamps and fake Crafty HTTP responses.

---

## 3. Custom Code Surface Challenge & Rationalization

To eliminate code bloat and avoid 3am maintenance emergencies, we enforce the Ponytail ladder and challenge all custom Go code in `mcctl`:

### A. What Crafty Natively Owns (Do NOT Build in Custom Code)
- **Web UI & User Dashboard**: Crafty supplies a full web UI, server status cards, interactive terminal console, file manager, and backup scheduler.
- **Server Catalog & Lifecycle State**: Crafty manages server definitions, auto-start flags, and process start/stop commands.
- **Role-Based Access Control**: Crafty handles user accounts, API tokens, and permissions.
- *Decision*: Strip any remaining tenant management, container rendering, or custom web UI from `mcctl`. Crafty is the single catalog and lifecycle authority.

### B. What `mcctl` MUST Retain (Essential Host Safety)
- **Fail-Closed Startgate (`gate exec`)**:
  - Validates immutable profile SHA-256 hash before execution.
  - Verifies host memory headroom, CPU, load, and swap before Java starts.
  - Replaces itself with Java via `execve` (zero lingering runtime overhead).
- **Read-Only Monitor & WAL Store (`monitor sample`)**:
  - Periodic 30s sampling of Linux host metrics and Crafty stats.
  - Rollups (5m, daily) in SQLite WAL mode.
  - Atomic `/var/lib/mcctl/snapshot.json` promotion.
- **Alert Evaluator with Hysteresis (`monitor alert`)**:
  - 2-sample confirmation to eliminate transient alerting noise.
  - 30-minute reminder throttling.
- **Code Atlas & Drift Detection (`atlas check`)**:
  - Deterministic tracking of repository files and packages.

### C. What to Simplify, Remove, or Defer
1. **Remove**: Unused tenant archive/purge state machines.
2. **Remove**: Legacy Compose multi-tenant container generation code.
3. **Simplify**: Centralize all magic numbers from Category 3 and 4 into `internal/config/config.go` with schema validation.
4. **Defer**: Custom notification adapters (Brevo, Discord, Webhooks) until live production deployment is approved.

---

## 4. Operational Foundations

### A. Edge Cases
- **World Split-Brain / Desync**: Mismatched `data/` and `world*` folders must never be co-mounted. Require matching level seed and timestamp validation before any Crafty import.
- **Profile Artifact Corruption**: Server JARs must match profile SHA-256 exactly. Checksum mismatch fails closed with exit code 2.
- **Concurrent Startgate Race Conditions**: Managed via non-blocking SQLite/filesystem `flock`. Simultaneous start requests fail fast rather than oversubscribing host RAM.
- **Crafty API Token Expiry**: Client returns structured `unauthorized` errors without leaking bearer tokens to logs.
- **Rapid Crashlooping**: If Java terminates within 30 seconds of launch, record crash event and reject automatic restart loops.
- **Authentication & Secure Profile Desync**: For `online-mode=false`, `enforce-secure-profile=false` is enforced to prevent client 401 Authlib drops.
- **Plugin Bytecode Verification**: Plugins are scanned before deployment to guarantee Java class version $\le 65.0$ (Java 21).

### B. Runtime Issues
- **Playit Tunnel & LOD Flow Control**: LOD streaming (`LodServerSupport`) saturates public tunnels (2–5 MB/s). Apply rate limits (`mbPerSecondLimitPerPlayer: 2.0`, `sendQueueLimitPerPlayer: 256`, `enablePingBackstop: true`), `timeout-time: 300` in `spigot.yml`, and `player-max-chunk-send-rate: 35.0` in `paper-global.yml`.
- **Anti-Cheat False Positives**: `allow-flight=true`, `moved-too-quickly-multiplier: 100.0`, and packet-limiter `action: DROP` prevent false movement kicks.
- **Memory Ceiling**: Combined server heaps strictly limited to 6.5 GiB within systemd cgroup limits (`MemoryHigh=8G`, `MemoryMax=9G`).
- **SQLite WAL Recovery**: WAL mode with `FULL` sync ensures crash resilience. Startup performs passive checkpoints and transaction log playback.
- **PID Reservation Cleanup**: Failed execution reservations matching PID are pruned immediately; unclaimed reservations expire after 5 minutes.

### C. Hosting Architecture
- **HP Desk (`100.122.7.7` via Tailscale)**: **Primary Production Host** (higher RAM/compute headroom). Runs native Crafty 4.10.8 under an unprivileged `crafty` user. Releases synchronized to `/home/vgbn-server/Documents/codeptit/minecraft/releases/<commit>/`. Live runtime in `/opt/minecraft` remains untouched.
- **Dell OptiPlex**: **Secondary / Staging Host** (lower spec than HP Desk). Designated for secondary server instances, staging workloads, or auxiliary failover.
- **Steamlinux**: Disposable local workstation for non-live development, unit testing, and static analysis. Never hosts production world data.
- **Zero Public Port Exposure**: Game traffic routes via Playit tunnels; Crafty Web UI is restricted to localhost/Tailscale.

### D. Load & Stress Parameters
- **Non-Live Benchmark Baseline**: Measured probe footprint: 0.0149% CPU, 35.19 MiB peak RSS, 100.61 ms probe latency.
- **Admission Thresholds**: Reject start if `MemAvailable` < 3 GiB, host CPU > 90% for 5 min, load average > 6, or swap-out > 10 MiB/min.
- **Alert Hysteresis**: 2 consecutive high samples to trigger warning; 2 consecutive clean samples to recover; 30-minute reminder throttle.

---

## 5. Ranked Implementation Batches

| Batch | Scope & Objectives | Key Deliverables | Effort | Risk |
| --- | --- | --- | --- | --- |
| **Batch 1** | **Magic Number Extraction & Configuration Consolidation** | Extract hardcoded Category 3 & 4 policy limits into `internal/config/`; update examples and validators. | 1.5 days | Low |
| **Batch 2** | **Startgate Hardening & Flow Control Alignment** | Enforce profile SHA-256 caching, non-blocking flock concurrency tests, and fast crashloop detection. | 2.0 days | Medium |
| **Batch 3** | **Playit & LOD Runtime Configuration Profiles** | Codify runtime network configs (`lss-server-config.json`, `spigot.yml`, `paper-global.yml`) into reproducible profiles. | 1.0 day | Low |
| **Batch 4** | **Disposable Pre-Production Qualification on Steamlinux** | Run loopback Crafty 4.10.8 test instance; verify `gate exec` integration and monitor metric rollups. | 2.5 days | Medium |
| **Batch 5** | **HP Desk Production Adoption & World Recovery Drill** | Reconcile authoritative world archives, install native Crafty systemd unit, and complete 24h soak. | 3.0 days | High (Gated on World Auth) |

---

## 6. Acceptance Criteria
1. Root `README.md` and canonical `docs/` reflect the multi-tenant ownership model and simple web vision.
2. All magic numbers in `internal/` are cataloged with clear configuration paths.
3. `mass-implement` skill enforces mandatory PR-imposed review checklists and line-by-line diffs.
4. `make verify` passes cleanly with zero lint or atlas drift errors.
5. World adoption and live production deployment remain strictly blocked (**NO-GO**) until Batch 5 qualification.
