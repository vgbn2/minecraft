# Minecraft Enterprise Infrastructure & Autonomous Agent Ecosystem

[![CI Pipeline](https://github.com/vgbn2/minecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/vgbn2/minecraft/actions/workflows/ci.yml)
[![Security Audit](https://github.com/vgbn2/minecraft/actions/workflows/security.yml/badge.svg)](https://github.com/vgbn2/minecraft/actions/workflows/security.yml)
![Node Version](https://img.shields.io/badge/Node.js-18%20%7C%2020-brightgreen)
![Rust Version](https://img.shields.io/badge/Rust-2024%20Edition-orange)
![Go Version](https://img.shields.io/badge/Go-1.22%2B-blue)
![License](https://img.shields.io/badge/License-MIT-purple)

This repository provides an institutional, polyglot Minecraft infrastructure stack combining a **Rust-based high-throughput game core**, a **Go fail-closed control plane (`mc-control`, alias: `mcctl`)**, and an **autonomous survival bot squad** driven by local LAN AI (`9Router`) and physical game invariants.

---

## 1. The Polyglot Triad (Rust + Go + JS)

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   THE POLYGLOT TRIAD                                   │
│                                                                                        │
│   ┌───────────────────────────┐ ┌───────────────────────────┐ ┌──────────────────────┐ │
│   │        RUST CORE          │ │        GO CONTROL         │ │     NODE.JS SQUAD    │ │
│   │ (High-Throughput Physics) │ │(Infrastructure Supervisor)│ │ (Tactical Intelligence)│ │
│   ├───────────────────────────┤ ├───────────────────────────┤ ├──────────────────────┤ │
│   │ • Pumpkin Rust Server     │ │ • mc-control Daemon & CLI │ │ • Task Orchestrator  │ │
│   │   (Microsecond TPS Loop)  │ │ • Fail-Closed Admission   │ │ • 9Router AI Adapter │ │
│   │ • mc_path_core Engine     │ │ • SQLite WAL Telemetry    │ │ • Autonomous Bots    │ │
│   │   (SIMD A* 3D Pathfinder) │ │ • Crafty API Integration  │ │ • Dynamic Behavior   │ │
│   │ • Zero-GC Chunk Processor │ │ • Systemd & Backup Hooks  │ │   State Machines     │ │
│   └─────────────┬─────────────┘ └─────────────┬─────────────┘ └──────────┬───────────┘ │
│                 │                             │                          │             │
│                 ▼                             ▼                          ▼             │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │                   PROXMOX CT 116 ISOLATED SANDBOX RUNTIME                      │   │
│   │            (TCP Loopback 127.0.0.1:25566 | /dev/shm Volatile IPC)             │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

| Technology | Responsibility | Rationale | Performance & Safety Guarantee |
| :--- | :--- | :--- | :--- |
| **Rust** | **High-Throughput Engine & Voxel Kinematics** | Zero garbage collection stalls, sub-millisecond tick loops, SIMD-accelerated voxel bitmasks, and maximum chunk load capacity per agent. | Sub-millisecond tick dispatch; zero V8 heap overhead for raw chunk processing. |
| **Go** | **Control Plane & Process Supervision (`mc-control`)** | Static single-binary deployment with zero dependencies, POSIX process management, deterministic memory checks, and lightweight system telemetry. | Instant compilation; fail-closed JVM admission gate preventing host memory exhaustion. |
| **JavaScript (Node.js)** | **Tactical Intelligence & High-Level Behaviors** | Rapidly iterable event-driven state machines, native Mineflayer ecosystem primitives, and seamless OpenAI-compatible LLM streaming integration via 9Router. | Asynchronous event loop with non-blocking `/dev/shm` tmpfs IPC; fast behavior tuning without recompiling native binaries. |

---

## 2. Real-World Use Cases & Capabilities

* **Autonomous Agricultural Logistics**:
  - Automatically identifies, tills, and seeds $9 \times 9$ Chebyshev-hydrated farmland ($L_\infty \le 4$).
  - Continuously monitors crop maturity states (`age: 7`), harvests wheat, replants seeds, crafts bread rations, and stores surplus into designated food depots.
* **Topological Architectural Construction**:
  - Builds complete 20x20 survival manors from 1,600+ voxel blueprints.
  - Follows strict layer-by-layer dependency ordering ($Y$ ascending) with face-attachment verification (`findReferenceBlock`), ensuring zero floating blocks or placement rejections.
* **Deep Quarrying & Resource Supply Lines**:
  - Excavates subterranean quarries with strict tool tier hardness matching (preventing 0-yield drops).
  - Actively avoids sand/gravel gravity collapse hazards and navigates back to base to deposit raw ores and cobblestone when inventory capacity hits 85%.
* **Dynamic Golden-Spacing Perimeter Defense**:
  - Patrols estate perimeters, illuminates unlit chunks, and engages hostile mobs using 3.5m–4.0m spacing kinematics.
  - Mitigates creeper detonation fuses by executing rapid backwards jump-slicing and clears block suffocation hazards with tactical escape routines.
* **Fail-Closed Multi-Tenant Server Governance**:
  - Employs `mc-control` as a pre-execution safety gate to inspect JAR SHA-256 bytecode hashes, enforce memory limits, and validate plugin manifests before JVM startup.

---

## 3. Installation & Setup Guide

### System Prerequisites
- **Node.js**: `v18.x` or `v20.x` LTS (`npm >= 10.0.0`)
- **Go**: `1.22+` (for `mc-control` control plane)
- **Rust**: `2024 Edition` (Cargo toolchain with `clippy`)
- **Docker & Docker Compose**: (optional, for containerized server hosting)
- **Minecraft Client**: Version `1.21.11` (or protocol `777` compatible client)

### 1. Clone & Workspace Setup
```bash
# Clone the repository
git clone https://github.com/vgbn2/minecraft.git
cd minecraft

# Install bot dependencies
cd bots && npm ci --prefer-offline --no-audit && cd ..
```

### 2. Verify Local Test Suite (21 Diagnostic Gates)
```bash
# Run the complete test matrix keyless and offline
cd bots && OFFLINE_ONLY=1 node test-verify.mjs
node tests/test_squad_jojo.mjs
node tests/test_logistics_depot.mjs
node tests/test_agriculture_tech.mjs
cd ..
```

### 3. Server Deployment Options

#### Option A: Docker Compose (PaperMC Server)
```bash
# Start containerized PaperMC server on port 25565
docker compose up -d

# Check live server logs
docker compose logs -f
```

#### Option B: Standalone Rust Server (Pumpkin)
```bash
# Launch high-throughput Pumpkin Rust server on port 25566
pumpkin
```

### 4. Deploying the Autonomous Bot Squad
```bash
# Launch bot companion squad locally
./bots/mc-bot.sh start 127.0.0.1:25565

# Or launch remotely inside Proxmox CT 116 sandbox
./bots/mc-bot.sh --remote squad start 127.0.0.1:25566

# Broadcast high-level instruction to bot squad
./bots/mc-bot.sh --remote squad cmd "Prepare 20x20 site and establish 9x9 farm."
```

---

## 4. Causal Element Architecture

Instead of designing software around transient human symptoms ("bots are hungry", "need to clear land"), the codebase is strictly structured around the **underlying game engine mechanics that govern behavior**:

* **`soil_hydration.mjs`**: Farmland hydration geometry ($9 \times 9$ Chebyshev square with $L_\infty \le 4$ from water at $Y$ or $Y-1$) accelerating crop tick rates by $\approx 2.5\times$.
* **`container_bus.mjs`**: Server window transaction synchronization (`windowId` lifecycle in `finally` blocks) and storage slot boundary sentinels (slots 9–44).
* **`voxel_schematic.mjs`**: Topological layer ordering ($Y$ ascending, rafter backings) guaranteeing 100% face-attachment validity (`findReferenceBlock` never returns `null`).
* **`block_excavation.mjs`**: Tool tier hardness validation (preventing 0-yield stone mining) and gravity block cascade safety (sand/gravel above target).
* **`entity_spacing.mjs`**: Combat kinematics maintaining 3.5m–4.0m spacing to prevent creeper detonation and zombie contact damage.

---

## 5. Operational CLI Runbook

### 1. Inspection & Diagnostic Probes (Read-Only)
```bash
# Verify local bot test suite (all 20+ gates passing)
cd bots && OFFLINE_ONLY=1 node test-verify.mjs # runs kinematics, AI proxy, & supervisor checks

# Inspect live squad status across CT 116 sandbox
./bots/mc-bot.sh --remote squad status # displays RAM, PIDs, and active bot archetypes

# Probe Minecraft server ports without joining
./bots/mc-bot.sh probe 127.0.0.1:25566 # checks latency, MOTD, and player count
```

### 2. Remediation & Deployment (Mutation)
```bash
# Push newly authored local modules to CT 116 container
./bots/mc-bot.sh --remote sync

# Launch autonomous squad remotely inside Proxmox CT 116
./bots/mc-bot.sh --remote squad start 127.0.0.1:25566

# Transmit macro-mission to bot orchestrator
./bots/mc-bot.sh --remote squad cmd "Execute Phase 1: Establish 9x9 farm, quarry 64 stone, and prepare 20x20 site."
```

### 3. Verification & Live Monitoring (Proof)
```bash
# Stream live squad actions and cluster health HUD
./bots/mc-bot.sh --remote monitor # live CPU/RAM matrix and bot action telemetry
```

### 4. Rollback & Emergency Exit (Safety)
```bash
# Instantly stop all bot processes and recall squad
./bots/mc-bot.sh --remote squad stop
```

---

## 6. Security & Server Hardening

* **Loopback-Only Ingress**: Server ports (`25565` Paper, `25566` Pumpkin) bind strictly to `127.0.0.1`.
* **Zero WAN Exposure**: Remote connections are routed exclusively via encrypted Tailscale mesh routes or SSH tunnels.
* **Proxmox LXC Sandbox**: CT 116 runs as an unprivileged container (`unprivileged: 1`) with isolated user namespaces.
* **Tmpfs IPC Security**: Bot IPC files reside in volatile RAM (`/dev/shm/mc-bot/`) with `0600`/`0644` permissions, eliminating SSD wear and persisting zero traces on reboot.
* **Secret Sanitization**: Verified by GitHub Actions `security.yml` to ensure zero API keys or `.env` files are tracked in Git.

Detailed architecture specifications:
- [Causal Element Modeling](docs/architecture/causal-elements.md)
- [Server Hardening & Security](docs/security/server-hardening.md)
- [STRIDE Threat Model](docs/security/threat-model.md)
- [Rust Migration Roadmap](docs/architecture/rust-migration-roadmap.md)
- [Control Plane Specification](docs/architecture/system.md)

---

## 7. Credits & Acknowledgements

This ecosystem builds upon the groundbreaking work of several open-source communities and systems:

* **[PrismarineJS / Mineflayer](https://github.com/PrismarineJS/mineflayer)**: The bedrock JavaScript Minecraft protocol engine, entity physics loop, and bot framework created by Andrew Kelley, Romain Beaumont, and the PrismarineJS team.
* **[Pumpkin Server](https://github.com/Pumpkin-MC/Pumpkin)**: High-performance, async Minecraft server core authored entirely in Rust by the Pumpkin-MC contributors, delivering microsecond TPS loops and zero GC pauses.
* **[PaperMC](https://papermc.io)**: High-performance Java Minecraft server implementation with optimized world ticking, async chunk loading, and Aikar's tuned JVM GC profiling.
* **[Crafty Controller](https://craftycontrol.com)**: Enterprise Minecraft server management platform and OpenAPI REST v2 control plane developed by Arcadia Technology LLC.
* **[9Router](https://github.com/vgbn2/9router)**: Local high-throughput multi-provider AI proxy and token routing gateway facilitating offline and zero-cost companion bot reasoning.
* **[Modernc.org / SQLite](https://gitlab.com/cznic/sqlite)**: Pure Go memory-safe SQLite engine powering `mc-control` state validation and telemetry with zero CGO dependencies.
* **Open-Source Homelab Community**: Testers, infrastructure maintainers, and contributors across Proxmox LXC sandboxes.

---

## 8. License

This project is licensed under the [MIT License](LICENSE) &copy; 2026 vgbn2 (Tran Duc Anh).
All rights reserved.
