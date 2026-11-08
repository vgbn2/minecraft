// Structure Generation & Voxel Placement Engine
// Causal Element: Neighbor face adjacency vectors and raycast reach boundaries.
import { Vec3 } from 'vec3'

export const NEIGHBOR_OFFSETS = [
  new Vec3(0, -1, 0), // below
  new Vec3(0, 1, 0),  // above
  new Vec3(0, 0, 1),  // south
  new Vec3(0, 0, -1), // north
  new Vec3(1, 0, 0),  // east
  new Vec3(-1, 0, 0)  // west
]

export function findReferenceBlock(bot, targetPos) {
  for (const offset of NEIGHBOR_OFFSETS) {
    const neighborPos = targetPos.plus(offset)
    const neighbor = bot.blockAt(neighborPos)
    if (neighbor && neighbor.name !== 'air' && neighbor.name !== 'cave_air' && neighbor.name !== 'water' && neighbor.name !== 'lava') {
      const faceVector = offset.scaled(-1)
      return { referenceBlock: neighbor, faceVector }
    }
  }
  return null
}

export function generateStructurePlan(type, origin, size = 3) {
  const blocks = []
  const s = Math.max(1, Math.min(size || 3, 5))

  switch (type) {
    case 'wall': {
      const half = Math.floor(s / 2)
      for (let y = 0; y < 2; y++) {
        for (let dx = -half; dx <= half; dx++) {
          blocks.push(origin.offset(dx, y, 2))
        }
      }
      break
    }
    case 'pillar': {
      for (let y = 0; y < s; y++) {
        blocks.push(origin.offset(1, y, 0))
      }
      break
    }
    case 'floor': {
      const half = Math.floor(s / 2)
      for (let dx = -half; dx <= half; dx++) {
        for (let dz = -half; dz <= half; dz++) {
          blocks.push(origin.offset(dx, 0, dz))
        }
      }
      break
    }
    case 'single':
    default: {
      blocks.push(origin.offset(1, 0, 0))
      break
    }
  }

  return blocks
}

export async function executeStructureBuild(bot, structureType, materialName, size, sender, isWhisper, sendResponse) {
  const targetMat = (materialName || 'dirt').toLowerCase().replace(/^(minecraft:)/, '')
  const item = bot.inventory.items().find(i => i.name.toLowerCase().includes(targetMat))

  if (!item) {
    sendResponse(sender, `I don't have any ${targetMat} in my inventory to build with!`, isWhisper)
    return false
  }

  const origin = bot.entity.position.floored()
  const plan = generateStructurePlan(structureType, origin, size)
  sendResponse(sender, `Building ${structureType} using ${item.name} (${plan.length} blocks)...`, isWhisper)

  let placed = 0
  for (const pos of plan) {
    const existing = bot.blockAt(pos)
    if (existing && existing.name !== 'air' && existing.name !== 'cave_air' && existing.name !== 'water') {
      continue
    }

    const currentItem = bot.inventory.items().find(i => i.name.toLowerCase().includes(targetMat))
    if (!currentItem) {
      sendResponse(sender, `Ran out of ${targetMat}! Placed ${placed} blocks.`, isWhisper)
      return false
    }

    try {
      await bot.equip(currentItem, 'hand')
      const ref = findReferenceBlock(bot, pos)
      if (ref) {
        await bot.placeBlock(ref.referenceBlock, ref.faceVector)
        placed++
        await new Promise(r => setTimeout(r, 100))
      }
    } catch (err) {
      console.log(`[!] Place error at ${pos}: ${err.message}`)
    }
  }

  sendResponse(sender, `Finished building ${structureType}. Placed ${placed} blocks.`, isWhisper)
  return true
}
