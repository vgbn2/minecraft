# Minecraft Enterprise Infrastructure & Autonomous Agent Ecosystem

[![CI Pipeline](https://github.com/vgbn2/minecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/vgbn2/minecraft/actions/workflows/ci.yml)
[![Security Audit](https://github.com/vgbn2/minecraft/actions/workflows/security.yml/badge.svg)](https://github.com/vgbn2/minecraft/actions/workflows/security.yml)
![Node Version](https://img.shields.io/badge/Node.js-18%20%7C%2020-brightgreen)
![Rust Version](https://img.shields.io/badge/Rust-2024%20Edition-orange)
![Go Version](https://img.shields.io/badge/Go-1.22%2B-blue)
![License](https://img.shields.io/badge/License-MIT-purple)

This repository provides an institutional, polyglot Minecraft infrastructure stack combining a **Rust-based high-throughput game core**, a **Go fail-closed control plane (`mcctl`)**, and a **5-agent autonomous survival bot squad** driven by local LAN AI (`9Router`) and physical game invariants.

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
│   │ • Pumpkin Rust Server     │ │ • mcctl Daemon & CLI      │ │ • Mastermind Jotaro  │ │
│   │   (Microsecond TPS Loop)  │ │ • Fail-Closed Admission   │ │ • 9Router AI Adapter │ │
│   │ • mc_path_core Engine     │ │ • SQLite WAL Telemetry    │ │ • 5 Autonomous Bots  │ │
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
| **Go** | **Control Plane & Process Supervision (`mcctl`)** | Static single-binary deployment with zero dependencies, POSIX process management, deterministic memory checks, and lightweight system telemetry. | Instant compilation; fail-closed JVM admission gate preventing host memory exhaustion. |
| **JavaScript (Node.js)** | **Tactical Intelligence & High-Level Behaviors** | Rapidly iterable event-driven state machines, native Mineflayer ecosystem primitives, and seamless OpenAI-compatible LLM streaming integration via 9Router. | Asynchronous event loop with non-blocking `/dev/shm` tmpfs IPC; fast behavior tuning without recompiling native binaries. |

---

## 2. Autonomous Agent Squad Matrix

The bot squad operates as a coordinated survival team using 6-axis stat vectors (**P/S/R/D/P/P**: Power, Speed, Range, Durability, Precision, Potential) to specialize competencies without supernatural gimmicks:

| Agent Name | Archetype | Primary Role | Stats (P/S/R/D/P/P) | Causal Specialization & Behavioral Invariant |
| :--- | :--- | :--- | :--- | :--- |
| **Jotaro** | **Commander** | Mastermind / Orchestration | `A / A / C / A / A / A` | Strategic task decomposition via local LAN AI (9Router); broadcasts milestones in public chat; coordinates group sleep. |
| **Bob** | **Architect** | Precision Voxel Assembly | `A / A / D / B / A / C` | Topological bottom-up construction; resolves reference block faces; builds 20x20 manors with zero floating blocks. |
| **Torin** | **Excavator** | Mining & Tool Progression | `B / A / C / B / A / C` | Tool tier matching (wooden $\to$ stone $\to$ iron); deep quarrying; carries bed into mines for squad sleep synchronization. |
| **Arthur** | **Sentinel** | Perimeter Security & Guard | `A / B / B / A / B / B` | 3.5m–4.0m golden spacing combat kinematics; anti-creeper fuse clearance; perimeter torch grid defense. |
| **Willow** | **Harvester** | Agrarian Food Chain & Scout| `C / A / A / C / A / B` | 9x9 Chebyshev hydrated farming ($L_\infty \le 4$); mature crop harvesting; bread crafting; squad nutrition distribution. |

---

## 3. Causal Element Architecture

Instead of designing software around transient human symptoms ("bots are hungry", "need to clear land"), the codebase is strictly structured around the **underlying game engine mechanics that govern behavior**:

* **`soil_hydration.mjs`**: Farmland hydration geometry ($9 \times 9$ Chebyshev square with $L_\infty \le 4$ from water at $Y$ or $Y-1$) accelerating crop tick rates by $\approx 2.5\times$.
* **`container_bus.mjs`**: Server window transaction synchronization (`windowId` lifecycle in `finally` blocks) and storage slot boundary sentinels (slots 9–44).
* **`voxel_schematic.mjs`**: Topological layer ordering ($Y$ ascending, rafter backings) guaranteeing 100% face-attachment validity (`findReferenceBlock` never returns `null`).
* **`block_excavation.mjs`**: Tool tier hardness validation (preventing 0-yield stone mining) and gravity block cascade safety (sand/gravel above target).
* **`entity_spacing.mjs`**: Combat kinematics maintaining 3.5m–4.0m spacing to prevent creeper detonation and zombie contact damage.

---

## 4. Operational CLI Runbook

### 1. Inspection & Diagnostic Probes (Read-Only)
```bash
# Verify local bot test suite (all 20+ gates passing)
cd bots && node test-verify.mjs # runs core kinematics, AI proxy, & supervisor checks

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

# Transmit macro-mission to Mastermind (Jotaro)
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

## 5. Security & Server Hardening

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
