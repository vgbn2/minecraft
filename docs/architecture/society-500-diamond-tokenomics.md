# 500-Agent Autonomous Minecraft Civilization: Technical Systems Architecture & Hard-Money Diamond Standard (`$DIA`) (`Confirmed Final Spec`)

**Master Epic Issue**: [vgbn2/minecraft#22](https://github.com/vgbn2/minecraft/issues/22)  
**Decomposed Technical Sub-Issues (100% Critique-Verified on GitHub)**:
- **Squad Stabilization, Bungee Skin Properties & Non-ASCII NFD Telex Routing**: [#21](https://github.com/vgbn2/minecraft/issues/21)
- **Blast-Through IPC Directory Registry, `O_APPEND` Log Rewind & `/proc` Supervision**: [#23](https://github.com/vgbn2/minecraft/issues/23)
- **Multiplexed V8 Worker Runtime, `RefCountedColumnStore` & App-Tick Decimation (`85 GB → 2.9 GB`)**: [#24](https://github.com/vgbn2/minecraft/issues/24)
- **Multi-Version Protocol Compatibility Proof (`>= 1.14 [proto 477] → 26.3 [proto 770+]`)**: [#25](https://github.com/vgbn2/minecraft/issues/25)
- **Unix Socket Nexus Bus, 3-Layer GOAP Loop & 2-Phase Custody `$DIA` SQLite WAL Ledger**: [#26](https://github.com/vgbn2/minecraft/issues/26)
- **Native Rust Shared-Memory 4-Bit Voxel Mmap, `f32` Waypoints & `2×AtomicU64` SeqLock Daemon**: [#27](https://github.com/vgbn2/minecraft/issues/27)
- **CI/CD Hermetic `ubuntu-latest` Matrix (14 Node + 9 Rust + 18 Go Suites)**: [#11](https://github.com/vgbn2/minecraft/issues/11)

---

## 1. End-to-End Technical Systems Architecture ($N = 500$ Agents across 10 Spatial Colonies)

```
+=========================================================================================+
|                        PROXMOX CT 116 / HOST MEMORY & IPC TOPOLOGY                      |
+=========================================================================================+
|                                                                                         |
|  [10 x Node.js Worker Pools (`swarm_worker.mjs` — 50 Bots / Isolate = 500 Bots)]        |
|  • Prerequisite 24.0: `createBotAgentInstance(opts)` factory (0 module-level globals)   |
|  • 1 Shared `minecraft-data` Singleton + `RefCountedColumnStore` (`blocks.js:544`)      |
|  • Native 20 Hz Mineflayer physics + 2 Hz decimated app scans (`combat_evasion.mjs:18`) |
|  • `VersionAdapter` (`>= 1.14 .. 26.3`): `INIT_WORLD` barrier, `item.durabilityUsed`    |
|  • `PROT_READ` mapping of `/dev/shm/mc-bot-${UID}/mc-world.mmap`                        |
|         │                                                     │                         |
|         │ Binary Frame (`f32[3]` start/goal & waypoints)      │ Length-Prefixed NDJSON  |
|         ▼                                                     ▼                         |
|  [/dev/shm/mc-bot-${UID}/mc-path.sock]                 [/dev/shm/mc-bot-${UID}/nexus.sock]|
|  +----------------------------------------+            +------------------------------+ |
|  | Rust Spatial Daemon (`mc-path-fast`)   |            | Nexus Broker & GOAP Bank     | |
|  | • Sole writer to `mc-world.mmap` (64MB)|            | • Unicast / Guild / Proximity| |
|  | • 4-Bit Voxel Nibble (`0x0=UNLOADED`)  |            | • Native `node:sqlite` WAL   | |
|  | • `2×AtomicU64` (16B) SeqLock +        |            |   + 15m disk `.backup` snap  | |
|  |   `TOMBSTONE` Voxel & Chest Leases     |            | • 2-Phase Treasury Custody   | |
|  | • `f32` Block-Centered 3D A* (<0.05ms) |            | • Leaky-Bucket LLM (max 2)   | |
|  +----------------------------------------+            +------------------------------+ |
+=========================================================================================+
```

---

## 2. Subsystem 1: Multiplexed V8 Runtime & `RefCountedColumnStore` ([#24](https://github.com/vgbn2/minecraft/issues/24))

- **Prerequisite 24.0 (`bots/src/index.mjs:36-155`)**: Extract module-scoped singletons (`bot`, `config`, `safeNav`, `supervisor`, `aiAgent`, `activePatrolInterval`) into `createBotAgentInstance(opts)`.
- **Reference-Counted Chunk Deduplication (`blocks.js:242-244, 544`)**: Inject `RefCountedColumnStore` via Mineflayer's `storageBuilder` hook so unloading a chunk on Bot A decrements `refCount(chunkX, chunkZ)` without deleting Bot B's floor, and only forwards `CHUNK_UPDATE` to the Rust daemon when `refCount` transitions `0 -> 1`.
- **Application-Layer Tick Decimation (`combat_evasion.mjs:18`)**: Preserve Mineflayer's `50ms` (`20 Hz`) physics step for gravity/knockback integration while decimating application-layer `physicsTick` entity scans to `2 Hz` (`500ms`) outside combat.
- **Spatial Colony Partitioning**: Partition 500 agents into 10 districts ($\le 50$ agents per 128m radius) with `view_distance = 3` in CT 116 `pumpkin.toml` (reducing server-side $O(N^2)$ entity packet broadcast volume by $99\%$).

---

## 3. Subsystem 2: Multi-Version Protocol Compatibility Proof (`>= 1.14` to `26.3`) ([#25](https://github.com/vgbn2/minecraft/issues/25))

- **Canonical Floor (`1.14`, `proto 477`)**: `lightSentSeparately` (`features.json:700`) and `blockStateId` (`features.json:131`).
- **Verified Wire Transitions (`VersionAdapter`)**:
  - `1.14–1.15.2` (`477..578`) vs `1.16+` (`735+`): `clientboundChatHasSender` (`features.json:192`) and NBT `dimensionCodec`.
  - `1.18+` (`757+`): `tallWorld` (`features.json:1147`, `min_y = -64, num_sections = 24`) and `deepslate_diamond_ore`.
  - `1.19+` (`759+`): Monotonic `nextSequence()` (`sequence: varint` on `block_dig`, `block_place`, `use_item`) and `hasBundlePacket` (`1.19.4`).
  - `1.20+` (`763+`): `isFrontText: bool` on `update_sign` (`blocks.js:504`) and 3-slot Smithing Table template (`netherite_upgrade_smithing_template`).
  - `1.20.2+` (`764+`): `hasConfigurationState` (`features.json:580`, state fence at `client.mjs:65`).
  - `1.20.5+` (`766+`): Native `item.durabilityUsed` (`prismarine-item/index.js:369-385`, reading `item.componentMap.get('damage').data`).
  - `1.21.4–26.3` (`769..1073742168`): `sendsClientTickEndPacket` (`packet_tick_end`), `sendsPlayerLoadedPacket` (`packet_player_loaded`), `recipe_book_add`, and `26.3 -> 26.1` registry alias.

---

## 4. Subsystem 3: Nexus Socket Bus, 3-Layer GOAP & 2-Phase Custody `$DIA` Ledger ([#26](https://github.com/vgbn2/minecraft/issues/26))

- **2-Phase Physical Diamond Custody (`node:sqlite` `DatabaseSync` on Node `v24.19.0`)**:
  - **Phase A (`provenance_claims`)**: Natural world-gen subterranean `diamond_ore` / `deepslate_diamond_ore` break creates a provenance claim (`remaining_cap = 4` for Fortune III; 0 `$CRED` minted in the field).
  - **Phase B (`reserve_vault` + `ledger_entries`)**: `100 $CRED × diamond_count` is minted strictly when physical `minecraft:diamond` items (never Silk Touch ore blocks) are verified deposited into a Central Treasury Chest.
- **Unit-Integral AMM Bonding Curve**: Prices batch sales by integrating unit-by-unit along inventory $S$ and caps payouts by the depot's actual accumulated `$CRED` balance.
- **Chest Lease Fencing**: Monotonic `fencing_token` + `4,200ms` client auto-close timer on `5,000ms` `depot_chests` leases, plus 15-minute `.backup` snapshots from `/dev/shm` to `~/.local/share/mc-bot/economy.snap.db`.

---

## 5. Subsystem 4: Shared-Memory Rust 4-Bit Voxel Mmap, `f32` Waypoints & SeqLock Daemon ([#27](https://github.com/vgbn2/minecraft/issues/27))

- **Single-Writer Mmap (`/dev/shm/mc-bot-${UID}/mc-world.mmap`)**: Rust daemon is the sole writer; workers map `PROT_READ`. Initialized via 2-stage `INIT_WORLD` (`op_code = 0x00`) with negotiated `(min_y: i16, num_sections: u8)`.
- **4-Bit Movement Class Nibble (`2,048 Bytes/section`)**: `0x0 = UNLOADED_UNKNOWN` (fail-closed in A*), `0x1 = AIR`, `0x2 = SOLID_CUBE`, `0x3 = FENCE_WALL_1_5M`, `0x4 = SLAB_HALF` (`+0.5f32` Y), `0x5 = DOOR_OPEN`, `0x6 = DOOR_CLOSED`, `0x7 = WATER`, `0x8 = CLIMBABLE`, `0x9 = LEAF_CANOPY` (`+120` cost), `0xA = SLOW_SOULSAND`, `0xB = COBWEB`, `0xC = HAZARD_LAVA_FIRE`.
- **`f32` Floating-Point Coordinates (`/dev/shm/mc-bot-${UID}/mc-path.sock`)**: Matches Minecraft's float coordinate system and `FVec3` (`lib.rs:306`), returning block-centered (`floor(x) + 0.5, y + slab_offset, floor(z) + 0.5`) `[f32; 3]` waypoints.
- **16-Byte (`2 × AtomicU64`) SeqLock + `TOMBSTONE` Leases**: Eliminates 32-byte struct torn reads and preserves open-addressing probe chains on deletion.
