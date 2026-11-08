# System Architecture & Control Flow

## Control Plane Architecture

```text
Players ───────► Playit.gg Tunnel ───────► Server Port (25565/25566)
                                                   │
Administrators ──► Tailscale / Localhost ──► Crafty Web UI (Port 8443)
                                                   │
                                            Crafty Controller
                                            (Lifecycle / API)
                                                   │
                                                   ▼
                                         /usr/local/bin/mcctl
                                              gate exec
                                                   │
               ┌───────────────────────────────────┴───────────────────────────────────┐
               ▼                                                                       ▼
    [Fail-Closed Checks]                                                     [Success: Execve]
  - JAR SHA-256 Checksum                                                        Java JVM Process
  - Projected RAM >= 3 GiB Available                                            (Paper / Fabric)
  - Combined Xmx <= 6656 MiB
  - Host CPU < 90%, Load < 6
  - Non-blocking flock reservation
```

---

## The Polyglot Triad (Rust + Go + JS)

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

## Control Plane Architecture

| Environment | Role | Configuration & Constraints |
| --- | --- | --- |
| **HP Desk (`100.122.7.7` via Tailscale)** | **Primary Production Host** | - Higher compute/RAM headroom. Runs native Crafty 4.10.8 under unprivileged `crafty` user.<br>- Systemd cgroup constraints: `MemoryHigh=8G`, `MemoryMax=9G`.<br>- Management releases in `/home/vgbn-server/Documents/codeptit/minecraft/releases/<commit>/`.<br>- Live runtime in `/opt/minecraft` untouched by Git/rsync. |
| **Dell OptiPlex** | **Secondary / Staging Host** | - Auxiliary node for secondary server instances, staging, or failover workloads.<br>- Less RAM headroom than HP Desk; independent resource limits apply. |
| **Steamlinux** | **Disposable Local Dev & Qualification** | - Local workstation for non-live tests, mock servers, unit/integration suites, and static analysis.<br>- Zero production world or secret data. |

---

## Resource Budget & Memory Policies

1. **Heap Allocation Bounds**:
   - Paper 1.21.11: Max Heap (`-Xmx4G`), Initial Heap (`-Xms4G`).
   - Fabric 1.21.11: Max Heap (`-Xmx2560M`), Initial Heap (`-Xms2560M`).
   - **Combined Maximum Heap**: $4096\,\text{MiB} + 2560\,\text{MiB} = 6656\,\text{MiB} \le 6.5\,\text{GiB}$.
2. **Admission Buffer**:
   - Startgate verifies projected `MemAvailable` $\ge 3\,\text{GiB}$ remaining after adding $(Xms + 512\,\text{MiB})$ overhead.
3. **No Automatic Killing**:
   - Running servers are **never killed automatically** for resource pressure.
   - Resource pressure triggers alerts and blocks subsequent server starts.

---

## Network Topology & Security Boundaries

- **Zero Public Port Exposure**: Minecraft server ports (25565, 25566) and Crafty Web UI (8443) are never bound to public interfaces.
- **Player Ingress**: Routed securely through Playit.gg encrypted tunnels. Tunnel streaming parameters are paced to prevent LOD buffer saturation.
- **Admin Ingress**: Crafty Web UI is accessible exclusively over localhost or private Tailscale mesh network.

---

## Telemetry & Alerting Engine

- **Polling Cadence**: `mcctl monitor sample` executes every 30 seconds via systemd timer.
- **Storage Engine**: SQLite in WAL mode with `FULL` sync. Passive checkpointing maintains minimal WAL size.
- **Atomic Promotion**: Current state exported atomically to `/var/lib/mcctl/snapshot.json`.
- **Retention Schedule**:
  - Raw 30-second samples: 48 hours.
  - 5-minute rollups: 30 days.
  - Daily rollups: 180 days.
- **Alert Hysteresis**:
  - Warnings trigger on 2 consecutive anomalous samples.
  - Recovery requires 2 consecutive normal samples.
  - Active reminders throttled to at most once per 30 minutes.
