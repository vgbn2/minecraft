// Container Window Transaction & Inventory Slot Synchronization Engine
// Causal Element: Minecraft server windowId lifecycle (open/transaction/close)
// and player inventory slot boundaries (slots 9-44 storage, slots 5-8 armor, slot 45 offhand).
import { Vec3 } from 'vec3'
import pathfinderPkg from 'mineflayer-pathfinder'
const { goals } = pathfinderPkg || {}

export const DEFAULT_CONTAINER_CATEGORIES = {
  stone_chest: [
    'cobblestone', 'stone', 'deepslate', 'cobbled_deepslate',
    'granite', 'diorite', 'andesite', 'sandstone', 'gravel', 'sand', 'dirt'
  ],
  wood_chest: [
    'oak_log', 'birch_log', 'spruce_log', 'dark_oak_log', 'jungle_log', 'acacia_log',
    'oak_planks', 'birch_planks', 'spruce_planks', 'stick'
  ],
  ore_chest: [
    'coal', 'raw_iron', 'raw_copper', 'raw_gold', 'iron_ingot', 'gold_ingot', 'copper_ingot',
    'diamond', 'redstone', 'lapis_lazuli'
  ],
  food_chest: [
    'bread', 'cooked_beef', 'cooked_porkchop', 'apple', 'baked_potato', 'cooked_mutton',
    'golden_carrot'
  ],
  tool_chest: [
    'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe',
    'wooden_axe', 'stone_axe', 'iron_axe', 'diamond_axe',
    'wooden_shovel', 'stone_shovel', 'iron_shovel'
  ]
}

export const GATHERER_STATES = {
  IDLE: 'IDLE',
  EXTRACTION: 'EXTRACTION',   // Active harvesting: Mining (Torin) or Logging (Willow)
  DELIVERING: 'DELIVERING',   // Navigating to central depot
  DEPOSITING: 'DEPOSITING',   // Unloading raw materials into designated chests
  RESTOCKING: 'RESTOCKING',   // Replenishing food ration and tool durability
  RETURNING: 'RETURNING'      // Navigating back to quarry or forest
}

export class ContainerBus {
  constructor(waypoint, options = {}) {
    this.waypoint = {
      x: Math.floor(waypoint.x),
      y: Math.floor(waypoint.y),
      z: Math.floor(waypoint.z)
    }
    this.containers = options.containers || {}
    this.categories = options.categories || DEFAULT_CONTAINER_CATEGORIES
    this.arrivalRadius = options.arrivalRadius || 3.0
  }

  registerContainer(id, pos, categoryKey, blockType = 'chest') {
    this.containers[id] = {
      id,
      pos: {
        x: Math.floor(pos.x),
        y: Math.floor(pos.y),
        z: Math.floor(pos.z)
      },
      categoryKey,
      blockType
    }
  }

  getContainerForCategory(categoryKey) {
    return Object.values(this.containers).find(c => c.categoryKey === categoryKey) || null
  }

  getContainerForItem(itemName) {
    const raw = String(itemName || '').toLowerCase().replace(/^minecraft:/, '').trim()

    for (const [catKey, items] of Object.entries(this.categories)) {
      if (items.includes(raw)) {
        const found = this.getContainerForCategory(catKey)
        if (found) return found
      }
    }

    if (this.containers[`${raw}_chest`]) {
      return this.containers[`${raw}_chest`]
    }

    return this.containers['stone_chest'] || Object.values(this.containers)[0] || null
  }
}

export function checkInventoryCapacity(bot, options = {}) {
  const maxFilledSlots = options.maxFilledSlots ?? 28
  const targetItemThresholds = options.targetItemThresholds || {
    cobblestone: 64,
    oak_log: 64,
    stone: 64,
    dirt: 64
  }

  if (!bot?.inventory?.items) {
    return {
      filledSlots: 0,
      shouldDeliver: false,
      reason: null,
      countsByName: {},
      harvestItems: []
    }
  }

  const allItems = bot.inventory.items()
  // Slots 9-44 represent main inventory and hotbar storage; excludes armor (5-8) and offhand (45)
  const storageItems = allItems.filter(item => item.slot >= 9 && item.slot <= 44)
  const filledSlots = storageItems.length

  const countsByName = {}
  for (const item of storageItems) {
    const name = item.name.toLowerCase()
    countsByName[name] = (countsByName[name] || 0) + item.count
  }

  let shouldDeliver = false
  let reason = null

  if (filledSlots >= maxFilledSlots) {
    shouldDeliver = true
    reason = `filled_slots_threshold (${filledSlots}/${maxFilledSlots})`
  } else {
    for (const [itemName, threshold] of Object.entries(targetItemThresholds)) {
      if ((countsByName[itemName] || 0) >= threshold) {
        shouldDeliver = true
        reason = `target_item_threshold (${itemName}: ${countsByName[itemName]}/${threshold})`
        break
      }
    }
  }

  const isPreserved = (name) => {
    if (name.includes('pickaxe') || name.includes('axe') || name.includes('shovel') || name.includes('sword')) return true
    if (name.includes('helmet') || name.includes('chestplate') || name.includes('leggings') || name.includes('boots')) return true
    if (['bread', 'cooked_beef', 'cooked_porkchop', 'golden_carrot', 'torch'].includes(name)) return true
    return false
  }

  const harvestItems = storageItems.filter(item => !isPreserved(item.name.toLowerCase()))

  return {
    filledSlots,
    shouldDeliver,
    reason,
    countsByName,
    harvestItems
  }
}

export async function openContainerSafe(bot, targetPosOrBlock, safeNav) {
  if (!bot) return null

  let block = null
  let pos = null

  if (targetPosOrBlock?.position) {
    block = targetPosOrBlock
    pos = block.position
  } else if (targetPosOrBlock?.x !== undefined) {
    pos = new Vec3(targetPosOrBlock.x, targetPosOrBlock.y, targetPosOrBlock.z)
    block = bot.blockAt ? bot.blockAt(pos) : null
  }

  if (!pos) return null

  const currentPos = bot.entity?.position
  if (currentPos) {
    const dist = Math.hypot(currentPos.x - pos.x, currentPos.y - pos.y, currentPos.z - pos.z)
    if (dist > 3.5) {
      if (safeNav) {
        await safeNav.navigateTo(pos)
      } else if (bot.pathfinder && goals?.GoalNear) {
        bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 2))
      }
    }
  }

  const targetBlock = block || { position: pos, name: 'chest' }
  if (bot.openContainer) return await bot.openContainer(targetBlock)
  if (bot.openChest) return await bot.openChest(targetBlock)
  return null
}

export async function depositHarvestItems(bot, containerBlockOrPos, itemsToDeposit, safeNav) {
  const container = await openContainerSafe(bot, containerBlockOrPos, safeNav)
  if (!container) return { success: false, depositedCount: 0, reason: 'failed_to_open_container' }

  let totalDeposited = 0
  const summary = []

  try {
    for (const item of itemsToDeposit) {
      const count = item.count || 1
      const itemType = item.type !== undefined ? item.type : item.id
      try {
        await container.deposit(itemType, null, count)
        totalDeposited += count
        summary.push({ name: item.name, count })
      } catch (err) {
        console.warn(`[!] Deposit failed for ${item.name}: ${err.message}`)
      }
    }
  } finally {
    try { container.close() } catch {}
  }

  return {
    success: totalDeposited > 0 || itemsToDeposit.length === 0,
    depositedCount: totalDeposited,
    items: summary
  }
}

export async function withdrawRequiredMaterials(bot, containerBlockOrPos, requests, safeNav) {
  const container = await openContainerSafe(bot, containerBlockOrPos, safeNav)
  if (!container) return { success: false, withdrawnCount: 0, reason: 'failed_to_open_container' }

  let totalWithdrawn = 0
  const withdrawnItems = []

  try {
    const availableItems = container.containerItems ? container.containerItems() : (container.items ? container.items() : [])

    for (const req of requests) {
      const targetName = req.name.toLowerCase().replace(/^minecraft:/, '')
      let needed = req.count || 1
      const matching = availableItems.filter(i => i.name.toLowerCase().replace(/^minecraft:/, '') === targetName)

      for (const item of matching) {
        if (needed <= 0) break
        const pullCount = Math.min(item.count, needed)
        try {
          await container.withdraw(item.type, null, pullCount)
          totalWithdrawn += pullCount
          needed -= pullCount
          withdrawnItems.push({ name: targetName, count: pullCount })
        } catch (err) {
          console.warn(`[!] Withdraw failed for ${targetName}: ${err.message}`)
          break
        }
      }
    }
  } finally {
    try { container.close() } catch {}
  }

  return {
    success: totalWithdrawn > 0 || requests.length === 0,
    withdrawnCount: totalWithdrawn,
    items: withdrawnItems
  }
}

export async function directBotTransfer(bot, targetPlayerName, itemsToToss = [], safeNav) {
  if (!bot) return { success: false, reason: 'bot_missing' }

  const player = (targetPlayerName && bot.players?.[targetPlayerName]?.entity) ||
                 bot.nearestEntity?.(e => (e.type === 'player' || e.name === 'player') && e !== bot.entity)

  if (!player?.position) return { success: false, reason: 'target_player_not_found' }

  if (bot.lookAt) {
    try {
      await bot.lookAt(new Vec3(player.position.x, player.position.y + 1.6, player.position.z))
    } catch {}
  }

  let tossedCount = 0
  for (const item of itemsToToss) {
    const count = item.count || 1
    const type = item.type !== undefined ? item.type : item.id
    try {
      if (bot.toss) {
        await bot.toss(type, null, count)
        tossedCount += count
      }
    } catch {}
  }

  return { success: true, count: tossedCount }
}

export async function restockSupplies(bot, depot, options = {}) {
  const minFood = options.minFood ?? 5
  const targetFood = options.targetFood ?? 16
  const toolName = options.requiredTool || 'stone_pickaxe'

  if (!bot?.inventory?.items) return { restocked: false, foodAdded: 0, toolsAdded: 0 }

  const items = bot.inventory.items()
  let currentFood = 0
  let hasWorkingTool = false

  for (const item of items) {
    const name = item.name.toLowerCase()
    if (['bread', 'cooked_beef', 'cooked_porkchop', 'golden_carrot', 'apple'].includes(name)) {
      currentFood += item.count
    }
    if (name.includes(toolName.replace(/^minecraft:/, ''))) {
      const maxDur = item.maxDurability || 131
      const usedDur = item.durabilityUsed || 0
      if (maxDur - usedDur > 10) {
        hasWorkingTool = true
      }
    }
  }

  return {
    restocked: true,
    foodAdded: currentFood < minFood ? (targetFood - currentFood) : 0,
    toolsAdded: hasWorkingTool ? 0 : 1
  }
}

export async function architectPullRoutine(bot, requirements = [], depot, safeNav) {
  if (!bot?.inventory?.items || !depot) return { ready: false, reason: 'invalid_bot_or_depot' }

  const items = bot.inventory.items()
  const inventoryCounts = {}
  for (const item of items) {
    const name = item.name.toLowerCase().replace(/^minecraft:/, '')
    inventoryCounts[name] = (inventoryCounts[name] || 0) + item.count
  }

  const deficits = []
  for (const req of requirements) {
    const name = req.name.toLowerCase().replace(/^minecraft:/, '')
    const current = inventoryCounts[name] || 0
    if (current < req.count) {
      deficits.push({ name, count: req.count - current })
    }
  }

  if (deficits.length === 0) {
    return { ready: true, deficitCount: 0, itemsWithdrawn: [] }
  }

  const itemsWithdrawn = []
  for (const def of deficits) {
    const container = depot.getContainerForItem(def.name)
    if (!container) return { ready: false, reason: `no_container_for_${def.name}`, deficits }

    const pullRes = await withdrawRequiredMaterials(bot, container.pos, [def], safeNav)
    if (pullRes.success) {
      itemsWithdrawn.push(...pullRes.items)
    }
  }

  return {
    ready: true,
    deficitCount: deficits.reduce((acc, d) => acc + d.count, 0),
    itemsWithdrawn
  }
}

export class GathererLogisticsFSM {
  constructor(bot, config = {}) {
    this.bot = bot
    this.agentName = config.agentName || 'Gatherer'
    this.depot = config.depot
    this.extractionSite = config.extractionSite
    this.safeNav = config.safeNav || null
    this.options = config.options || {}
    this.state = GATHERER_STATES.EXTRACTION
    this.lastTransitionReason = 'initial_deployment'
  }

  transitionTo(nextState, reason = '') {
    this.state = nextState
    this.lastTransitionReason = reason
  }

  async step() {
    switch (this.state) {
      case GATHERER_STATES.EXTRACTION: {
        const check = checkInventoryCapacity(this.bot, this.options)
        if (check.shouldDeliver) {
          this.transitionTo(GATHERER_STATES.DELIVERING, check.reason)
          return { state: this.state, action: 'start_delivery', reason: check.reason }
        }
        return { state: this.state, action: 'continue_extraction', filledSlots: check.filledSlots }
      }

      case GATHERER_STATES.DELIVERING: {
        const cur = this.bot.entity?.position
        const depotPos = this.depot ? this.depot.waypoint : null
        const dist = (cur && depotPos) ? Math.hypot(cur.x - depotPos.x, cur.y - depotPos.y, cur.z - depotPos.z) : 999

        if (this.depot && dist <= this.depot.arrivalRadius) {
          this.transitionTo(GATHERER_STATES.DEPOSITING, 'arrived_at_depot')
          return { state: this.state, action: 'begin_deposit' }
        }

        if (depotPos) {
          if (this.safeNav) {
            await this.safeNav.navigateTo(depotPos)
          } else if (this.bot.pathfinder && goals?.GoalNear) {
            this.bot.pathfinder.setGoal(new goals.GoalNear(depotPos.x, depotPos.y, depotPos.z, 2))
          }
        }

        return { state: this.state, action: 'navigating_to_depot', distance: dist }
      }

      case GATHERER_STATES.DEPOSITING: {
        this.transitionTo(GATHERER_STATES.RESTOCKING, 'deposit_completed')
        return { state: this.state, action: 'deposit_completed' }
      }

      case GATHERER_STATES.RESTOCKING: {
        this.transitionTo(GATHERER_STATES.RETURNING, 'restock_evaluation_complete')
        return { state: this.state, action: 'restock_done' }
      }

      case GATHERER_STATES.RETURNING: {
        const cur = this.bot.entity?.position
        const site = this.extractionSite
        const dist = (cur && site) ? Math.hypot(cur.x - site.x, cur.y - site.y, cur.z - site.z) : 999

        if (dist <= 2.5) {
          this.transitionTo(GATHERER_STATES.EXTRACTION, 'returned_to_extraction_site')
          return { state: this.state, action: 'resume_extraction' }
        }

        if (site) {
          if (this.safeNav) {
            await this.safeNav.navigateTo(site)
          } else if (this.bot.pathfinder && goals?.GoalNear) {
            this.bot.pathfinder.setGoal(new goals.GoalNear(site.x, site.y, site.z, 2))
          }
        }

        return { state: this.state, action: 'navigating_to_extraction_site', distance: dist }
      }

      default:
        return { state: this.state, action: 'idle' }
    }
  }
}

// Backward compatibility alias
export const CentralDepot = ContainerBus
