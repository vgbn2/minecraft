# Rust Agent Core & Chunk Throughput Roadmap

## 1. The Performance Ceiling of V8 / Node.js Agents

While Node.js and Mineflayer provide rapid prototyping for bot behavior, they encounter a hard physical ceiling in production:
1. **Garbage Collection (GC) Stalls on Chunks**:
   - Each chunk in Minecraft contains 16 sub-chunks of $16 \times 16 \times 16 = 4,096$ block states, biome palettes, light arrays, and block entity NBT.
   - Parsing these incoming network packets into JavaScript objects allocates tens of thousands of short-lived V8 heap objects per chunk load.
   - When 5 bots explore or run with a view distance of $\ge 8$ chunks, V8 spends 15–25% of CPU time performing scavenge/mark-sweep garbage collection, causing kinematic stuttering and missed physics ticks.
2. **Memory Footprint**:
   - Each Node.js bot instance consumes **150MB–200MB RSS**.
   - A squad of 5 bots requires ~1GB RAM; scaling to 20 or 50 autonomous agents would exhaust container memory on CT 116.
3. **Single-Threaded Pathfinding Bottleneck**:
   - V8 executes JavaScript single-threaded. Calculating 3D A* paths through large voxel grids blocks the event loop, delaying entity position updates and triggering server kick-for-flying or desynchronization.

---

## 2. The Rust Native Target Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        RUST AGENT DAEMON (mc-bot-rs)                   │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                 Tokio Asynchronous Multi-Bot Reactor           │   │
│   │   ┌───────────────┐ ┌───────────────┐     ┌────────────────┐   │   │
│   │   │ Agent: Jotaro │ │  Agent: Bob   │ ... │  Agent: Willow │   │   │
│   │   │  (Tokio Task) │ │  (Tokio Task) │     │  (Tokio Task)  │   │   │
│   │   └───────┬───────┘ └───────┬───────┘     └────────┬───────┘   │   │
│   │           │                 │                      │           │   │
│   │           ▼                 ▼                      ▼           │   │
│   │   ┌────────────────────────────────────────────────────────┐   │   │
│   │   │        Native Voxel Bitmask Cache & Compact Palettes   │   │   │
│   │   │         (SIMD Bit-Parallel Block State Evaluation)     │   │   │
│   │   └─────────────────────────┬──────────────────────────────┘   │   │
│   │                             │                                  │   │
│   │                             ▼                                  │   │
│   │   ┌────────────────────────────────────────────────────────┐   │   │
│   │   │      Native A* Pathfinder & Kinematics (mc_path_core)  │   │   │
│   │   │      • BinaryHeap priority queue with sub-ms routing   │   │   │
│   │   │      • SIMD raycasting for collision bounding boxes    │   │   │
│   │   └────────────────────────────────────────────────────────┘   │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Advantages
1. **Zero-Copy Protocol Deserialization**:
   - Using crates like `valence_protocol` or `azalea`, chunk packets are decoded using zero-copy byte slices without allocating heap objects for each block.
2. **Zero-GC Determinism**:
   - Rust's ownership and RAII model eliminates garbage collection entirely. Physics ticks and packet processing run with deterministic microsecond latency.
3. **10x Memory Reduction**:
   - A compiled Rust bot actor consumes **< 15MB RSS** (compared to 180MB in Node.js).
   - CT 116 (6GB RAM) can easily host **100+ concurrent autonomous agents**.
4. **Massive Chunk Render Distance**:
   - Agents can hold **16 to 32 chunks in memory** simultaneously without performance degradation, allowing broad geographical scouting, wide-area perimeter defense, and seamless long-distance logistics routes.
5. **Pre-Existing Native Foundation**:
   - `bots/mc_path_core` is already authored in Rust (edition 2024) with release LTO optimization (`Cargo.toml`), providing the native 3D voxel A* pathfinder and kinematics engine that will power the full Rust agent rewrite.

---

## 3. Migration Roadmap & Milestones

1. **Phase 1 (Current - Dual-State Hybrid)**:
   - Node.js drives high-level state machines and LLM orchestration.
   - `mc_path_core` provides native path calculation when compiled as a cdylib.
2. **Phase 2 (Protocol Reactor in Rust)**:
   - Implement Rust connection handler using Tokio and `valence_protocol` for zero-copy chunk ingestion.
   - Maintain shared memory or IPC bridge with Mastermind AI planner.
3. **Phase 3 (Full Standalone Binary)**:
   - Single static binary (`mc-bot-rs`) hosting the entire squad with zero Node.js dependency.
