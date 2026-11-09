// Voxel Schematic & Coordinate Dependency Compiler
// Causal Element: Block face adjacency and topological layer dependency (0 floating blocks).
import { Vec3 } from 'vec3'
import { findReferenceBlock } from './voxel_placement.mjs'

export const SCHEMATIC_DIMENSIONS = {
  width: 20,
  length: 20,
  wallHeight: 5,
  roofHeight: 5,
  safeReach: 3.8
}

export function getPerimeterLoop(minX, maxX, minZ, maxZ) {
  const loop = []
  for (let x = minX; x <= maxX; x++) loop.push({ dx: x, dz: minZ, facing: 'north' })
  for (let z = minZ + 1; z <= maxZ; z++) loop.push({ dx: maxX, dz: z, facing: 'east' })
  for (let x = maxX - 1; x >= minX; x--) loop.push({ dx: x, dz: maxZ, facing: 'south' })
  for (let z = maxZ - 1; z >= minZ + 1; z--) loop.push({ dx: minX, dz: z, facing: 'west' })
  return loop
}

export function generateVoxelSchematic(origin = new Vec3(0, 64, 0)) {
  const x0 = Math.floor(origin.x)
  const y0 = Math.floor(origin.y)
  const z0 = Math.floor(origin.z)
  const plan = []

  const addVoxel = (dx, dy, dz, name, tag = 'structure', facing = null) => {
    plan.push({
      pos: new Vec3(x0 + dx, y0 + dy, z0 + dz),
      name,
      layer: dy,
      tag,
      facing
    })
  }

  // 1. Foundation: 20x20 (dy = 0, dx: 0..19, dz: 0..19) -> exactly 400 blocks.
  for (let dz = 19; dz >= 0; dz--) {
    const dxSweep = (dz % 2 === 1)
      ? Array.from({ length: 20 }, (_, i) => i)
      : Array.from({ length: 20 }, (_, i) => 19 - i)

    for (const dx of dxSweep) {
      const isPerimeter = (dx === 0 || dx === 19 || dz === 0 || dz === 19)
      const mat = isPerimeter ? 'cobblestone' : 'stone'
      addVoxel(dx, 0, dz, mat, 'foundation')
    }
  }

  // Porch Foundation step at dy = 0, dz = -1, dx: 8..11
  for (let dx = 8; dx <= 11; dx++) {
    addVoxel(dx, 0, -1, 'cobblestone', 'porch_foundation')
  }

  const isPillarPos = (dx, dz) => {
    if ((dx === 0 || dx === 19) && (dz === 0 || dz === 19)) return true
    if ((dz === 0 || dz === 19) && (dx === 6 || dx === 13)) return true
    if ((dx === 0 || dx === 19) && (dz === 6 || dz === 13)) return true
    return false
  }

  const isDoorway = (dx, dz) => dz === 0 && (dx === 9 || dx === 10)

  const isWindowPos = (dx, dz) => {
    if (dz === 0 && ((dx >= 2 && dx <= 4) || (dx >= 15 && dx <= 17))) return true
    if (dz === 19 && ((dx >= 2 && dx <= 4) || (dx >= 9 && dx <= 10) || (dx >= 15 && dx <= 17))) return true
    if (dx === 0 && ((dz >= 2 && dz <= 4) || (dz >= 9 && dz <= 10) || (dz >= 15 && dz <= 17))) return true
    if (dx === 19 && ((dz >= 2 && dz <= 4) || (dz >= 9 && dz <= 10) || (dz >= 15 && dz <= 17))) return true
    return false
  }

  const perimeterLoop = getPerimeterLoop(0, 19, 0, 19)

  // 2. Framing & Walls (dy: 1 to 5)
  for (let dy = 1; dy <= 5; dy++) {
    if (dy <= 3) {
      addVoxel(8, dy, -1, 'oak_log', 'porch_post')
      addVoxel(11, dy, -1, 'oak_log', 'porch_post')
    }
    if (dy === 3) {
      addVoxel(9, dy, -1, 'cobblestone_stairs', 'porch_arch', 'south')
      addVoxel(10, dy, -1, 'cobblestone_stairs', 'porch_arch', 'south')
    } else if (dy === 4) {
      addVoxel(9, dy, -1, 'cobblestone', 'porch_roof')
      addVoxel(10, dy, -1, 'cobblestone', 'porch_roof')
    }

    for (const { dx, dz } of perimeterLoop) {
      if (isPillarPos(dx, dz)) {
        addVoxel(dx, dy, dz, 'oak_log', 'pillar')
        continue
      }

      if (isDoorway(dx, dz)) {
        if (dy === 1 || dy === 2) continue
        if (dy === 3) {
          addVoxel(dx, dy, dz, 'oak_planks', 'door_lintel')
          continue
        }
      }

      if (dy === 1) {
        addVoxel(dx, dy, dz, 'cobblestone', 'base_trim')
      } else if (dy === 2 || dy === 3) {
        if (isWindowPos(dx, dz)) {
          addVoxel(dx, dy, dz, 'glass', 'window')
        } else {
          addVoxel(dx, dy, dz, 'oak_planks', 'wall')
        }
      } else if (dy === 4) {
        addVoxel(dx, dy, dz, 'oak_planks', 'wall')
      } else if (dy === 5) {
        addVoxel(dx, dy, dz, 'oak_log', 'header_beam')
      }
    }
  }

  // 3. Eaves Overhang at dy = 5 (dx: -1..20, dz: -1..20)
  for (let dx = 0; dx <= 19; dx++) addVoxel(dx, 5, -1, 'cobblestone_stairs', 'roof_eave', 'north')
  for (let dx = 0; dx <= 19; dx++) addVoxel(dx, 5, 20, 'cobblestone_stairs', 'roof_eave', 'south')
  for (let dz = 0; dz <= 19; dz++) addVoxel(-1, 5, dz, 'cobblestone_stairs', 'roof_eave', 'west')
  for (let dz = 0; dz <= 19; dz++) addVoxel(20, 5, dz, 'cobblestone_stairs', 'roof_eave', 'east')
  addVoxel(-1, 5, -1, 'cobblestone_stairs', 'roof_eave_corner')
  addVoxel(20, 5, -1, 'cobblestone_stairs', 'roof_eave_corner')
  addVoxel(-1, 5, 20, 'cobblestone_stairs', 'roof_eave_corner')
  addVoxel(20, 5, 20, 'cobblestone_stairs', 'roof_eave_corner')

  // 4. Tiered Overhanging Roof (dy: 6 to 10) with rafter backing
  const roofTiers = [
    { dy: 6, minX: -1, maxX: 20, minZ: -1, maxZ: 20 },
    { dy: 7, minX: 0, maxX: 19, minZ: 0, maxZ: 19 },
    { dy: 8, minX: 1, maxX: 18, minZ: 1, maxZ: 18 },
    { dy: 9, minX: 2, maxX: 17, minZ: 2, maxZ: 17 },
    { dy: 10, minX: 3, maxX: 16, minZ: 3, maxZ: 16 }
  ]

  for (let i = 0; i < roofTiers.length; i++) {
    const tier = roofTiers[i]
    if (i >= 1) {
      const rafterRing = getPerimeterLoop(tier.minX, tier.maxX, tier.minZ, tier.maxZ)
      for (const { dx, dz } of rafterRing) {
        addVoxel(dx, tier.dy - 1, dz, 'oak_planks', 'rafter_backing')
      }
    }
    const stairRing = getPerimeterLoop(tier.minX, tier.maxX, tier.minZ, tier.maxZ)
    for (const { dx, dz, facing } of stairRing) {
      const isCorner = (dx === tier.minX || dx === tier.maxX) && (dz === tier.minZ || dz === tier.maxZ)
      const mat = isCorner ? 'cobblestone_stairs' : 'oak_stairs'
      addVoxel(dx, tier.dy, dz, mat, 'roof_stair', facing)
    }
  }

  // 5. Skylight Atrium Deck at dy = 10 (dx: 4..15, dz: 4..15)
  for (let dz = 4; dz <= 15; dz++) {
    for (let dx = 4; dx <= 15; dx++) {
      const isSkylight = (dx >= 8 && dx <= 11 && dz >= 8 && dz <= 11)
      const mat = isSkylight ? 'glass' : 'oak_planks'
      addVoxel(dx, 10, dz, mat, isSkylight ? 'skylight' : 'roof_deck')
    }
  }

  return plan
}

export function calculateMaterialBill(plan) {
  const bill = {}
  for (const voxel of plan) bill[voxel.name] = (bill[voxel.name] || 0) + 1
  return bill
}

export function verifySchematicIntegrity(plan, groundY = null) {
  if (!Array.isArray(plan) || plan.length === 0) return { valid: false, reason: 'empty_plan' }
  const baseOrigin = plan[0].pos
  const placed = new Set()
  const effectiveGroundY = groundY !== null ? groundY : (baseOrigin.y - 1)

  for (let x = baseOrigin.x - 5; x <= baseOrigin.x + 25; x++) {
    for (let z = baseOrigin.z - 5; z <= baseOrigin.z + 25; z++) {
      placed.add(`${x},${effectiveGroundY},${z}`)
    }
  }

  const floating = []
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity

  for (let i = 0; i < plan.length; i++) {
    const v = plan[i]
    const p = v.pos
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)

    const neighbors = [
      `${p.x},${p.y - 1},${p.z}`, `${p.x},${p.y + 1},${p.z}`,
      `${p.x + 1},${p.y},${p.z}`, `${p.x - 1},${p.y},${p.z}`,
      `${p.x},${p.y},${p.z + 1}`, `${p.x},${p.y},${p.z - 1}`
    ]

    if (!neighbors.some(n => placed.has(n))) {
      floating.push({ index: i, pos: p, name: v.name, tag: v.tag })
    }
    placed.add(`${p.x},${p.y},${p.z}`)
  }

  const foundationCount = plan.filter(b => b.tag === 'foundation').length
  return {
    valid: floating.length === 0 && foundationCount === 400,
    total: plan.length,
    foundationCount,
    floatingCount: floating.length,
    floating,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ, width: maxX - minX + 1, height: maxY - minY + 1, length: maxZ - minZ + 1 }
  }
}

// Backward compatibility aliases
export const generateHouse20x20Plan = generateVoxelSchematic
export const verifyHousePlanIntegrity = verifySchematicIntegrity
export const HOUSE_DIMENSIONS = SCHEMATIC_DIMENSIONS

export class ScaffoldController {
  constructor(bot) {
    this.bot = bot
  }
}

export class AutonomousArchitectureRunner {
  constructor(bot) {
    this.bot = bot
    this.scaffold = new ScaffoldController(bot)
  }

  async executePlan(plan, { onProgress } = {}) {
    let placed = 0
    for (const voxel of plan) {
      const ref = findReferenceBlock(this.bot, voxel.pos)
      if (ref) {
        await this.bot.placeBlock(ref.referenceBlock, ref.faceVector)
      } else {
        const belowPos = voxel.pos.plus(new Vec3(0, -1, 0))
        const belowBlock = this.bot.blockAt(belowPos)
        if (belowBlock && belowBlock.name !== 'air') {
          await this.bot.placeBlock(belowBlock, new Vec3(0, 1, 0))
        }
      }
      placed++
      if (onProgress) onProgress({ placed, total: plan.length, voxel })
    }
    return { success: true, placed, total: plan.length }
  }
}

