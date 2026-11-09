// Block Hardness, Tool Tier Matching & Excavation Engine
// Causal Element: Mining yield physics (stone requires wooden/stone pickaxe; shovel for gravel/sand)
// and gravity block cascades (sand/gravel above target).
import { Vec3 } from 'vec3'

export async function equipBestTool(bot, block) {
  if (!bot.equip || !block) return
  const items = bot.inventory.items()
  const bName = (block.name || '').toLowerCase()

  const validTools = items.filter(i => !i.maxDurability || (i.maxDurability - (i.durabilityUsed || 0) > 3))
  let bestTool = null

  if (bName.includes('stone') || bName.includes('ore') || bName.includes('cobble') || bName.includes('deepslate')) {
    bestTool = validTools.find(i => i.name.includes('pickaxe'))
  } else if (bName.includes('dirt') || bName.includes('sand') || bName.includes('gravel') || bName.includes('clay')) {
    bestTool = validTools.find(i => i.name.includes('shovel'))
  } else if (bName.includes('wood') || bName.includes('log') || bName.includes('plank')) {
    bestTool = validTools.find(i => i.name.includes('axe') && !i.name.includes('pickaxe'))
  }

  if (bestTool) {
    try {
      await bot.equip(bestTool, 'hand')
    } catch {}
  }
}

export async function executeDeconstruction(bot, plan, sender, isWhisper, sendResponse, supervisor, safeNav) {
  if (bot.inventory.emptySlotCount() === 0) {
    sendResponse(sender, 'Inventory full! Drop items before clearing.', isWhisper)
    return 0
  }
  bot.autoEat?.disable?.() || bot.autoEat?.disableAuto?.()
  let clearedCount = 0

  try {
    for (const rawVec of plan) {
      if (supervisor?.status === 'ABORTED') break

      const targetVec = rawVec instanceof Vec3 ? rawVec : new Vec3(rawVec.x, rawVec.y, rawVec.z)
      const block = bot.blockAt(targetVec)
      if (!block || block.name === 'air' || block.name === 'cave_air' || block.name === 'water' || block.name === 'lava') {
        continue
      }

      // Check distance; navigate if too far away (> 4.2m)
      if (bot.entity && bot.entity.position.distanceTo(targetVec) > 4.2) {
        if (safeNav) {
          await safeNav.navigateTo(targetVec)
          if (bot.entity.position.distanceTo(targetVec) > 4.8) {
            continue
          }
        }
      }

      // Check for gravity hazard above
      const above = bot.blockAt(targetVec.offset(0, 1, 0))
      if (above && (above.name === 'sand' || above.name === 'gravel')) {
        try { await bot.dig(above) } catch {}
      }

      if (!bot.entity.onGround) {
        await new Promise(r => setTimeout(r, 100))
      }

      try {
        await equipBestTool(bot, block)
        if (bot.canDigBlock ? bot.canDigBlock(block) : true) {
          await bot.dig(block)
          clearedCount++
          if (clearedCount % 5 === 0) {
            sendResponse(sender, `Cleared ${clearedCount} block(s)...`, isWhisper)
          }
          await new Promise(r => setTimeout(r, 80))
        }
      } catch (err) {
        console.log(`[!] Dig error at ${targetVec}: ${err.message}`)
      }
    }
  } finally {
    bot.autoEat?.enable?.() || bot.autoEat?.enableAuto?.()
  }

  sendResponse(sender, `Excavation complete! Cleared ${clearedCount} block(s).`, isWhisper)
  return clearedCount
}

// Backward compatibility alias
export const executeBlockExcavation = executeDeconstruction
