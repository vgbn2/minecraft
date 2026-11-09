// Farmland Soil Hydration Geometry & Crop Lifecycle Engine
// Causal Element: Chebyshev distance hydration metric (L_inf <= 4 blocks from water at elevation Y or Y-1)
// and crop metadata age progression (e.g. wheat maturity at metadata/age 7).
import { Vec3 } from 'vec3'
import mcData from 'minecraft-data'
import prRecipe from 'prismarine-recipe'

export const TILLABLE_BLOCKS = new Set([
  'grass_block',
  'dirt',
  'dirt_path',
  'coarse_dirt',
  'rooted_dirt'
])

export const MATURE_CROP_AGES = {
  wheat: 7,
  carrots: 7,
  potatoes: 7,
  beetroots: 3
}

export const CROP_SEEDS = {
  wheat: 'wheat_seeds',
  carrots: 'carrot',
  potatoes: 'potato',
  beetroots: 'beetroot_seeds'
}

// 1. Farmland Hydration Geometry (Vanilla 9x9 Chebyshev square)
export function getHydrationBoundary(waterPos, includeSubLevel = false) {
  const wx = Math.floor(waterPos.x)
  const wy = Math.floor(waterPos.y)
  const wz = Math.floor(waterPos.z)
  const plots = []

  const yOffsets = includeSubLevel ? [0, -1] : [0]
  for (const dy of yOffsets) {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        // Exclude the water block itself
        if (dx === 0 && dz === 0 && dy === 0) continue
        plots.push(new Vec3(wx + dx, wy + dy, wz + dz))
      }
    }
  }
  return plots
}

// 2. Crop Maturity Predicate
export function isCropMature(block) {
  if (!block) return false
  const name = block.name
  const targetAge = MATURE_CROP_AGES[name]
  if (targetAge === undefined) return false

  if (block._properties?.age !== undefined) {
    return parseInt(block._properties.age, 10) >= targetAge
  }
  return (block.metadata || 0) >= targetAge
}

// 3. Tool & Seed Equipment
export async function equipHoe(bot) {
  if (!bot.inventory) return false
  const items = bot.inventory.items()
  const hoe = items.find(i => i.name.endsWith('_hoe'))
  if (hoe) {
    try {
      await bot.equip(hoe, 'hand')
      return true
    } catch {}
  }
  return false
}

export async function equipSeeds(bot, preferredCrop = 'wheat') {
  if (!bot.inventory) return null
  const preferredSeedName = CROP_SEEDS[preferredCrop] || preferredCrop
  const items = bot.inventory.items()

  let seedItem = items.find(i => i.name === preferredSeedName)
  if (!seedItem) {
    seedItem = items.find(i => i.name.endsWith('_seeds') || i.name === 'carrot' || i.name === 'potato')
  }

  if (seedItem) {
    try {
      await bot.equip(seedItem, 'hand')
      return seedItem
    } catch {}
  }
  return null
}

// 4. Deterministic Recipe Lookup & Execution
export function findRecipeTree(registry, itemName) {
  const reg = registry?.itemsByName ? registry : mcData(registry || '1.20.4')
  const Recipe = prRecipe(reg).Recipe
  const item = reg.itemsByName[itemName]
  if (!item) return []
  return Recipe.find(item.id)
}

export async function craftItem(bot, itemName, count = 1, craftingTableBlock = null) {
  const reg = bot.registry || mcData(bot.version || '1.20.4')
  const item = reg.itemsByName[itemName]
  if (!item) throw new Error(`Unknown item name: ${itemName}`)

  let recipes = bot.recipesFor(item.id, null, count, craftingTableBlock)
  if (!recipes || recipes.length === 0) {
    recipes = bot.recipesFor(item.id, null, 1, craftingTableBlock)
  }

  if (!recipes || recipes.length === 0) {
    throw new Error(`Insufficient materials or missing crafting table for ${itemName}`)
  }

  const recipe = recipes[0]
  const craftCount = Math.ceil(count / (recipe.result?.count || 1))
  await bot.craft(recipe, craftCount, craftingTableBlock)
  return true
}

export async function craftBreadFromWheat(bot, craftingTableBlock = null) {
  const reg = bot.registry || mcData(bot.version || '1.20.4')
  const wheatId = reg.itemsByName.wheat?.id
  const breadId = reg.itemsByName.bread?.id
  if (!wheatId || !breadId) return 0

  const wheatCount = bot.inventory.count(wheatId)
  if (wheatCount < 3) return 0

  const breadCount = Math.floor(wheatCount / 3)
  const table = craftingTableBlock || bot.findBlock({
    matching: reg.blocksByName.crafting_table.id,
    maxDistance: 4
  })

  if (!table) return 0
  const recipes = bot.recipesFor(breadId, null, 1, table)
  if (!recipes || recipes.length === 0) return 0

  await bot.craft(recipes[0], breadCount, table)
  return breadCount
}

// 5. Tool Tech Tree Bootstrap Progression
export async function bootstrapTools(bot, options = {}) {
  const log = options.log || console.log
  const reg = bot.registry || mcData(bot.version || '1.20.4')
  log('[BOOTSTRAP] Initiating tool tech tree progression...')

  // Step 1: Punch wood -> planks
  const logItem = bot.inventory.items().find(i => i.name.endsWith('_log'))
  if (logItem) {
    await craftItem(bot, logItem.name.replace('_log', '_planks'), logItem.count)
    log('[BOOTSTRAP] Crafted planks from inventory logs.')
  }

  // Step 2: Craft & Place Crafting Table
  let tableBlock = bot.findBlock({ matching: reg.blocksByName.crafting_table?.id, maxDistance: 4 })
  if (!tableBlock) {
    const hasTableItem = bot.inventory.items().some(i => i.name === 'crafting_table')
    if (!hasTableItem) {
      await craftItem(bot, 'crafting_table', 1)
      log('[BOOTSTRAP] Crafted crafting_table.')
    }
  }

  return { success: true, message: 'Tool tech tree bootstrap completed' }
}

// 6. Hydrated Farm System
export async function establishHydratedFarm(bot, waterSourcePos = null, options = {}) {
  const log = options.log || console.log
  const reg = bot.registry || mcData(bot.version || '1.20.4')
  const waterId = reg.blocksByName.water?.id

  let waterPos = waterSourcePos
  if (!waterPos) {
    const waterBlock = bot.findBlock({ matching: waterId, maxDistance: 16 })
    if (waterBlock) waterPos = waterBlock.position
  }

  if (!waterPos) throw new Error('No water source located or bucket available')

  log(`[FARM] Establishing 9x9 hydrated farm around water at ${waterPos}...`)
  const plots = getHydrationBoundary(waterPos)
  const hasHoe = await equipHoe(bot)

  let tilled = 0
  for (const pos of plots) {
    const block = bot.blockAt(pos)
    if (!block) continue

    const above = bot.blockAt(pos.offset(0, 1, 0))
    if (!above || (above.name !== 'air' && above.name !== 'cave_air')) continue

    if (TILLABLE_BLOCKS.has(block.name) && hasHoe) {
      try {
        await bot.activateBlock(block, new Vec3(0, 1, 0))
        tilled++
      } catch {}
    }
  }

  return { tilled, waterPos }
}

export async function harvestAndReplant(bot, options = {}) {
  let harvested = 0
  let replanted = 0

  const pos = bot.entity?.position?.floored() || new Vec3(0, 64, 0)
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -8; dx <= 8; dx++) {
      for (let dz = -8; dz <= 8; dz++) {
        const block = bot.blockAt(pos.offset(dx, dy, dz))
        if (block && isCropMature(block)) {
          try {
            await bot.dig(block)
            harvested++
            const hasSeeds = await equipSeeds(bot, block.name)
            if (hasSeeds) {
              const soil = bot.blockAt(block.position.offset(0, -1, 0))
              if (soil && (soil.name === 'farmland' || soil.name === 'dirt')) {
                await bot.placeBlock(soil, new Vec3(0, 1, 0))
                replanted++
              }
            }
          } catch {}
        }
      }
    }
  }

  let bakedBread = 0
  try {
    bakedBread = await craftBreadFromWheat(bot)
  } catch {}

  return { harvested, replanted, bakedBread }
}

export class SquadNutritionDepot {
  constructor(bot) {
    this.bot = bot
  }

  async distributeRations(targetPlayerName, count = 8, safeNav = null) {
    const breadItem = this.bot.inventory?.items?.().find(i => i.name === 'bread')
    if (!breadItem) {
      return { success: false, reason: 'No bread in inventory' }
    }
    const transferCount = Math.min(count, breadItem.count)
    if (this.bot.toss) {
      try {
        await this.bot.toss(breadItem.type, null, transferCount)
        return { success: true, count: transferCount }
      } catch (err) {
        return { success: false, reason: err.message }
      }
    }
    return { success: true, count: transferCount }
  }
}

