// Block Interaction, Raycast Inspection, & Item Transfer
import { Vec3 } from 'vec3'
import pathfinderPkg from 'mineflayer-pathfinder'
const { goals } = pathfinderPkg
import { equipBestTool } from './deconstruction.mjs'
import { getNearestHuman } from '../core/player_registry.mjs'

export const UNBREAKABLE_BLOCKS = new Set([
  'bedrock', 'barrier', 'command_block', 'structure_block', 'end_portal_frame'
])

export async function breakBlockAt(bot, targetVec, safeNav) {
  if (!bot.blockAt || !targetVec) return false
  const vec = new Vec3(targetVec.x, targetVec.y, targetVec.z)
  const block = bot.blockAt(vec)
  if (!block || block.name === 'air' || block.name === 'cave_air' || block.name === 'water' || block.name === 'lava' || UNBREAKABLE_BLOCKS.has(block.name)) {
    return false
  }
  if (bot.entity.position.distanceTo(vec) > 4.5) {
    if (safeNav) {
      const res = await safeNav.navigateTo(vec)
      if (!res.success && bot.entity.position.distanceTo(vec) > 4.8) return false
    } else if (bot.pathfinder) {
      bot.pathfinder.setGoal(new goals.GoalNear(vec.x, vec.y, vec.z, 3))
    }
  }
  await equipBestTool(bot, block)
  await bot.dig(block)
  return true
}

export function inspectTargetBlock(bot, maxDistance = 5) {
  if (bot.blockAtCursor) {
    const cursorBlock = bot.blockAtCursor(maxDistance)
    if (cursorBlock && cursorBlock.name !== 'air') return cursorBlock
  }
  if (bot.entity) {
    const yaw = bot.entity.yaw || 0
    const pitch = bot.entity.pitch || 0
    const dir = new Vec3(
      -Math.sin(yaw) * Math.cos(pitch),
      -Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    )
    for (let d = 1; d <= maxDistance; d++) {
      const checkPos = bot.entity.position.offset(0, bot.entity.height || 1.6, 0).plus(dir.scaled(d)).floored()
      const b = bot.blockAt(checkPos)
      if (b && b.name !== 'air' && b.name !== 'cave_air') return b
    }
  }
  return null
}

export async function activateNearestBlock(bot, typeOrName, targetVec, safeNav) {
  let block = null
  if (targetVec) {
    block = bot.blockAt(new Vec3(targetVec.x, targetVec.y, targetVec.z))
  } else if (typeOrName) {
    const rawType = (typeOrName || '').toLowerCase().replace(/^(minecraft:)/, '')
    const id = bot.registry?.blocksByName?.[rawType]?.id
    block = id ? bot.findBlock({ matching: id, maxDistance: 16 }) : null
  }
  if (!block || block.name === 'air') return false
  if (bot.entity.position.distanceTo(block.position) > 4.0) {
    if (safeNav) {
      const res = await safeNav.navigateTo(block.position)
      if (!res.success && bot.entity.position.distanceTo(block.position) > 4.5) return false
    } else if (bot.pathfinder) {
      bot.pathfinder.setGoal(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2))
    }
  }
  await bot.activateBlock(block)
  return true
}

export async function giveItemsToPlayer(bot, itemName, count = 1, targetPlayerName, safeNav) {
  const pName = targetPlayerName
  const player = (pName && bot.players[pName]?.entity) ||
                 getNearestHuman(bot)
  if (!player) return { success: false, reason: 'Player not found nearby' }

  if (bot.entity.position.distanceTo(player.position) > 3.0) {
    if (safeNav) {
      await safeNav.navigateTo(player.position.floored())
    } else if (bot.pathfinder) {
      bot.pathfinder.setGoal(new goals.GoalNear(player.position.x, player.position.y, player.position.z, 2))
    }
  }

  await bot.lookAt(player.position.offset(0, player.height || 1.6, 0))
  const rawItem = (itemName || '').toLowerCase().replace(/^(minecraft:)/, '')
  const items = bot.inventory.items().filter(i => !rawItem || rawItem === 'all' || i.name.toLowerCase().includes(rawItem))

  if (items.length === 0) return { success: false, reason: `No matching items found for '${itemName}'` }

  let givenCount = 0
  const maxToGive = (rawItem === 'all') ? Infinity : (count || 1)

  for (const item of items) {
    if (givenCount >= maxToGive) break
    const toToss = (rawItem === 'all') ? item.count : Math.min(item.count, maxToGive - givenCount)
    try {
      await bot.toss(item.type, null, toToss)
      givenCount += toToss
    } catch (err) {
      console.warn(`[!] Toss error: ${err.message}`)
      break
    }
  }
  return { success: givenCount > 0, count: givenCount }
}
