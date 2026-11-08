# Causal Element Modeling & Architecture Standard

## 1. Core Engineering Principle: Elements Over Problems

In autonomous robotics and agentic systems, software often falls into the trap of **problem-centric naming and design**:
* *Anti-Pattern (Problem/Task Naming)*: `fix_hunger.mjs`, `logistics_depot.mjs`, `deconstruction.mjs`, `build_house_20x20.mjs`, `jojo_stands.mjs`.
* *Sovereign Standard (Causal Element Naming)*: `soil_hydration.mjs`, `container_bus.mjs`, `block_excavation.mjs`, `voxel_schematic.mjs`, `agent_archetypes.mjs`.

### Why Problem-Centric Design Fails
When code is named and structured around a transient human symptom ("the bots are hungry" or "we need to build a 20x20 house"):
1. The code becomes rigid, ad-hoc, and tightly coupled to the single problem scenario.
2. The real underlying physical invariants are obscured behind narrative business logic.
3. When edge cases occur (e.g. 0 cobblestone yield from mining stone bare-handed, or Mineflayer window transaction desync), problem-centric code patches symptoms rather than respecting engine invariants.

### Why Causal Element Modeling Succeeds
The engine does not care about our high-level goals. The engine only evaluates **physical state machines and protocol constraints**. By naming and organizing code around the **element causing the behavior**, the codebase remains transparent, modular, and debuggable without AI assistance.

---

## 2. Inventory of Causal Elements in the Minecraft Universe

| Subsystem | Symptom / Task ("The Problem") | Underlying Causal Element ("The Governor") | Physical & Protocol Invariant | Canonical Module |
| :--- | :--- | :--- | :--- | :--- |
| **Agriculture** | Bots are starving; food depletes during mining. | **`soil_hydration`** | Water blocks hydrate farmland in a Chebyshev square ($L_\infty \le 4$, $Y$ to $Y-1$). Farmland with moisture state 7 accelerates crop tick cycles by $\approx 2.5\times$. | `src/skills/soil_hydration.mjs` |
| **Logistics** | Inventory gets full; items cannot be transferred. | **`container_bus`** | Server-side window transactions (`windowId`). If a container window is not closed in a strict `finally` block before moving, subsequent transactions reject. Storage slots are strictly 9–44. | `src/skills/container_bus.mjs` |
| **Voxel Construction** | Bot cannot place blocks in mid-air; gets trapped. | **`voxel_schematic`** & **`voxel_placement`** | `bot.placeBlock()` requires an adjacent non-air reference block face within 4.5m raycast reach. Layer order must be topological ($Y$ ascending, rafter backings) to eliminate floating dependencies. | `src/skills/voxel_schematic.mjs`, `src/skills/voxel_placement.mjs` |
| **Mining & Quarrying** | Mining stone takes 15s and yields 0 cobblestone. | **`block_excavation`** | Hardness matrix and tool tier requirement. Stone requires a wooden/stone pickaxe; gravity blocks (`sand`, `gravel`) fall when support voxels are broken. | `src/skills/block_excavation.mjs` |
| **Squad Organization** | 5 bots doing conflicting or unspecialized tasks. | **`agent_archetypes`** | 6-axis stat vector (`P/S/R/D/P/P`: Power, Speed, Range, Durability, Precision, Potential) determining task affinity, movement velocity, and engagement range without supernatural gimmicks. | `src/squad/agent_archetypes.mjs` |
| **Combat Kinematics** | Bots get blown up by creepers or swarmed by zombies. | **`entity_spacing`** | Entity bounding box distance and creeper fuse radius ($r \le 3.0\text{m}$). Bot must maintain 3.5m–4.0m "golden spacing" using backward velocity ticks. | `src/kinematics/combat_evasion.mjs` |
| **Entrapment** | Bot gets stuck in a 1x1 hole or suffocates in gravel. | **`suffocation_clearance`** | Player AABB collision with solid blocks at head elevation ($Y+1$). Excavator immediately digs out head-level voxel to abort damage ticks. | `src/kinematics/tactical_escape.mjs` |

---

## 3. Dual-State Migration Shims

To maintain 100% backward compatibility for all existing scripts, test suites, and remote operations on Proxmox CT 116, legacy module paths are preserved as lightweight re-export shims:
```javascript
// Dual-state backward compatibility shim
// Points to the canonical causal element module: ./soil_hydration.mjs
export * from './soil_hydration.mjs'
```
This guarantees that zero commands, tests, or callers fail during or after the architectural convergence.
