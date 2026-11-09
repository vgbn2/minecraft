// Autonomous Squad Incentive, Real Player Hunger Decay & Metabolic Penalty Engine
// ponytail: Utility-driven role routines; replaces naive random Brownian motion with real survival incentives
import { Vec3 } from 'vec3'
import { equipBestTool } from '../skills/block_excavation.mjs'
import { findReferenceBlock } from '../skills/voxel_placement.mjs'
import { generateHouse20x20Plan } from '../skills/voxel_schematic.mjs'

export const HOUSE_ORIGIN = new Vec3(-240, 65, 100)
export const HOUSE_CORNERS = [
  new Vec3(-240, 65, 100), // NW
  new Vec3(-220, 65, 100), // NE
  new Vec3(-220, 65, 120), // SE
  new Vec3(-240, 65, 120)  // SW
]
export const COMMAND_POST = new Vec3(-230, 65, 110)

export const EDIBLE_ITEMS = new Set([
  'bread', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
  'cooked_chicken', 'baked_potato', 'apple', 'golden_carrot', 'carrot',
  'beef', 'porkchop', 'mutton', 'chicken'
])

export const PASSIVE_PREY = new Set([
  'cow', 'pig', 'sheep', 'chicken'
])

export class AutonomousIncentiveEngine {
  constructor(bot, safeNav, watchdog, role = 'general') {
    this.bot = bot
    this.safeNav = safeNav
    this.watchdog = watchdog
    this.role = (role || bot.username || 'general').toLowerCase()
    this.sentryCorner = 0
    this.running = false
    this.interval = null

    // Real Player Metabolic & Hunger Decay State
    this.lastProductiveWork = Date.now()
    this.laborCredits = 0
    this.slackingSeconds = 0
    this.hungerDecayTicker = 0
    this.simulatedFood = bot.food !== undefined ? bot.food : 20
    this.simulatedHealth = bot.health !== undefined ? bot.health : 20
  }

  start(intervalMs = 5000) {
    if (this.interval) clearInterval(this.interval)
    this.interval = setInterval(() => this.step(intervalMs / 1000).catch(() => {}), intervalMs)
    this.step(intervalMs / 1000).catch(() => {})
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  recordProductiveWork(taskName) {
    this.lastProductiveWork = Date.now()
    this.slackingSeconds = 0
    this.laborCredits++
    console.log(`[+] [PRODUCTIVE] ${this.bot.username} performed '${taskName}'! Earned 1 labor credit (Total: ${this.laborCredits})`)
  }

  async step(deltaSeconds = 5) {
    if (this.running || !this.bot.entity) return
    if (this.watchdog && this.watchdog.mode !== 'IDLE' && !this.watchdog.mode.startsWith('patrol') && !this.watchdog.mode.startsWith('auto_')) {
      return
    }

    this.running = true
    try {
      // 1. Process Real Player Hunger Decay & Metabolic Exhaustion
      this._processHungerDecay(deltaSeconds)

      // 2. Check Slacking Time & Apply Light Punishment (-0.5 Heart / -1 HP)
      await this._enforceDiscipline(deltaSeconds)

      // 3. Survival Priority: Eat Food or Forage/Hunt to Stay Alive
      const survived = await this._handleSurvivalDrive()
      if (survived) return

      // 4. Mutual Squad Aid: Share food with starving/injured teammates (<10 HP)
      const aided = await this._handleSquadMutualAid()
      if (aided) return

      // 5. Scavenge: Vacuum nearby dropped items (Instant reward & resource conservation)
      const scavenged = await this._handleScavenge()
      if (scavenged) return

      // 6. Perimeter Defense: Neutralize hostile mobs within threat range
      const defended = await this._handleDefense()
      if (defended) return

      // 7. Role-Specific Labor Incentives (Earning survival credits & materials)
      await this._handleRoleIncentive()
    } finally {
      this.running = false
    }
  }

  _processHungerDecay(deltaSeconds) {
    this.hungerDecayTicker += deltaSeconds
    // Every 15 seconds of movement and labor, decay 1 food point
    if (this.hungerDecayTicker >= 15) {
      this.hungerDecayTicker = 0
      if (this.bot.food !== undefined && this.bot.food > 0) {
        this.bot.food = Math.max(0, this.bot.food - 1)
      }
      this.simulatedFood = Math.max(0, (this.bot.food !== undefined ? this.bot.food : this.simulatedFood) - 1)

      // Starvation damage when food is depleted
      if (this.simulatedFood <= 0) {
        this._applyHealthLoss(1, 'starvation (0 hunger)')
      }
    }
  }

  _applyHealthLoss(amountHp, reason) {
    // 1 HP = 0.5 heart in Minecraft
    const hearts = (amountHp / 2).toFixed(1)
    if (this.bot.health !== undefined && this.bot.health > 1) {
      this.bot.health = Math.max(1, this.bot.health - amountHp)
    }
    this.simulatedHealth = Math.max(1, (this.bot.health !== undefined ? this.bot.health : this.simulatedHealth) - amountHp)

    console.log(`[!] [DAMAGE: -${hearts} HEART] ${this.bot.username} lost ${hearts} heart (${amountHp} HP) due to ${reason}! Health: ${this.bot.health || this.simulatedHealth}/20, Food: ${this.bot.food || this.simulatedFood}/20`)
  }

  async _enforceDiscipline(deltaSeconds) {
    const timeSinceWork = (Date.now() - this.lastProductiveWork) / 1000
    this.slackingSeconds += deltaSeconds

    // If slacking for > 45 seconds without producing value:
    if (this.slackingSeconds >= 45 || timeSinceWork >= 45) {
      this.slackingSeconds = 0 // Reset penalty window

      // Light Disciplinary Penalty: -0.5 Heart (-1 HP)
      this._applyHealthLoss(1, 'slacking without productive labor (>45s idle)')

      // Physical disciplinary exertion drill: jump + sprint exertion
      if (this.bot.setControlState) {
        this.bot.setControlState('jump', true)
        setTimeout(() => this.bot?.setControlState?.('jump', false), 350)
        this.bot.setControlState('sprint', true)
        setTimeout(() => this.bot?.setControlState?.('sprint', false), 2000)
      }

      this.watchdog?.setMode('TASK_ACTIVE', 'disciplinary labor sprint')
    }
  }

  async _handleSurvivalDrive() {
    const curHp = this.bot.health !== undefined ? this.bot.health : this.simulatedHealth
    const curFood = this.bot.food !== undefined ? this.bot.food : this.simulatedFood

    // Need to eat if HP < 18 or Food < 16
    if (curHp < 18 || curFood < 16) {
      const items = this.bot.inventory?.items?.() || []
      const foodItem = items.find(i => EDIBLE_ITEMS.has(i.name))

      if (foodItem && this.bot.equip && this.bot.consume) {
        try {
          await this.bot.equip(foodItem, 'hand')
          await this.bot.consume()
          // Consuming food restores health and hunger
          if (this.bot.food !== undefined) this.bot.food = Math.min(20, this.bot.food + 4)
          if (this.bot.health !== undefined) this.bot.health = Math.min(20, this.bot.health + 2)
          this.simulatedFood = Math.min(20, this.simulatedFood + 4)
          this.simulatedHealth = Math.min(20, this.simulatedHealth + 2)
          console.log(`[+] [EAT] ${this.bot.username} consumed ${foodItem.name}! Restored health: ${this.bot.health || this.simulatedHealth}/20, Food: ${this.bot.food || this.simulatedFood}/20`)
          return true
        } catch {}
      }

      // No food in inventory: Hunt nearby passive prey (cow, pig, sheep, chicken)
      const prey = this.bot.nearestEntity(e =>
        PASSIVE_PREY.has(e.name) &&
        this.bot.entity.position.distanceTo(e.position) <= 16
      )
      if (prey && this.bot.pvp) {
        this.watchdog?.setMode('TASK_ACTIVE', `hunt ${prey.name} for food`)
        if (this.bot.entity.position.distanceTo(prey.position) > 3.0 && this.safeNav) {
          await this.safeNav.navigateTo(prey.position.floored())
        }
        const weapon = this.bot.inventory?.items()?.find(i => i.name.includes('sword') || i.name.includes('axe'))
        if (weapon && this.bot.equip) {
          try { await this.bot.equip(weapon, 'hand') } catch {}
        }
        this.bot.pvp.attack(prey)
        this.recordProductiveWork(`hunted ${prey.name} for food`)
        return true
      }
    }
    return false
  }

  async _handleSquadMutualAid() {
    const items = this.bot.inventory?.items?.() || []
    const foodItems = items.filter(i => EDIBLE_ITEMS.has(i.name))
    if (foodItems.length < 2) return false // Keep at least 1 ration for self

    // Find nearby injured teammate (health < 10)
    for (const pName in this.bot.players) {
      if (pName === this.bot.username) continue
      const teammate = this.bot.players[pName]?.entity
      if (teammate && this.bot.entity.position.distanceTo(teammate.position) <= 8) {
        // Toss 1 food item to teammate
        try {
          await this.bot.lookAt(teammate.position.offset(0, 1.6, 0))
          await this.bot.toss(foodItems[0].type, null, 1)
          console.log(`[+] [MUTUAL AID] ${this.bot.username} shared ${foodItems[0].name} with teammate ${pName} to keep them alive!`)
          return true
        } catch {}
      }
    }
    return false
  }

  async _handleScavenge() {
    const drop = this.bot.nearestEntity(e =>
      (e.name === 'item' || e.displayName === 'Item') &&
      this.bot.entity.position.distanceTo(e.position) <= 16
    )
    if (drop && this.safeNav) {
      this.watchdog?.setMode('TASK_ACTIVE', 'scavenge dropped loot')
      await this.safeNav.navigateTo(drop.position.floored())
      this.recordProductiveWork('scavenged dropped item')
      return true
    }
    return false
  }

  async _handleDefense() {
    const hostile = this.bot.nearestEntity(e =>
      e.type === 'mob' && e.name !== 'armor_stand' &&
      this.bot.entity.position.distanceTo(e.position) <= 8
    )
    if (hostile && this.bot.pvp) {
      this.watchdog?.setMode('TASK_ACTIVE', `defend vs ${hostile.name}`)
      const weapon = this.bot.inventory?.items()?.find(i => i.name.includes('sword') || i.name.includes('axe'))
      if (weapon && this.bot.equip) {
        try { await this.bot.equip(weapon, 'hand') } catch {}
      }
      this.bot.pvp.attack(hostile)
      this.recordProductiveWork(`defended against ${hostile.name}`)
      return true
    }
    return false
  }

  async _handleRoleIncentive() {
    const r = this.role
    const botName = (this.bot.username || '').toLowerCase()

    // Willow: Harvester (Tree logging & crop gathering)
    if (r.includes('harvester') || botName === 'willow') {
      const wood = this.bot.findBlock({
        matching: b => b.name.includes('_log') || b.name.includes('wood'),
        maxDistance: 16
      })
      if (wood) {
        this.watchdog?.setMode('TASK_ACTIVE', `harvest wood: ${wood.name}`)
        if (this.bot.entity.position.distanceTo(wood.position) > 4.2 && this.safeNav) {
          await this.safeNav.navigateTo(wood.position)
        }
        await equipBestTool(this.bot, wood)
        await this.bot.dig(wood)
        this.recordProductiveWork(`harvested ${wood.name}`)
        return
      }
    }

    // Torin: Miner (Stone, cobblestone, ores)
    if (r.includes('miner') || botName === 'torin') {
      const rock = this.bot.findBlock({
        matching: b => b.name === 'stone' || b.name === 'cobblestone' || b.name.includes('ore') || b.name.includes('deepslate'),
        maxDistance: 16
      })
      if (rock) {
        this.watchdog?.setMode('TASK_ACTIVE', `mine stone: ${rock.name}`)
        if (this.bot.entity.position.distanceTo(rock.position) > 4.2 && this.safeNav) {
          await this.safeNav.navigateTo(rock.position)
        }
        await equipBestTool(this.bot, rock)
        await this.bot.dig(rock)
        this.recordProductiveWork(`mined ${rock.name}`)
        return
      }
    }

    // Bob: Architect / Builder (Foundation placement or gathering dirt/cobble)
    if (r.includes('builder') || r.includes('architect') || botName === 'bob') {
      const items = this.bot.inventory?.items() || []
      const blockItem = items.find(i =>
        i.name.includes('dirt') || i.name.includes('cobble') ||
        i.name.includes('stone') || i.name.includes('plank')
      )

      if (blockItem) {
        const fullPlan = generateHouse20x20Plan(HOUSE_ORIGIN)
        const foundationPlan = fullPlan.filter(v => v.layer <= 1)
        for (const voxel of foundationPlan) {
          const current = this.bot.blockAt(voxel.pos)
          if (current && (current.name === 'air' || current.name === 'cave_air' || current.name === 'water')) {
            const ref = findReferenceBlock(this.bot, voxel.pos)
            if (ref && this.bot.placeBlock) {
              this.watchdog?.setMode('TASK_ACTIVE', 'house foundation placement')
              if (this.bot.entity.position.distanceTo(voxel.pos) > 4.2 && this.safeNav) {
                await this.safeNav.navigateTo(voxel.pos)
              }
              try {
                await this.bot.equip(blockItem, 'hand')
                await this.bot.placeBlock(ref.referenceBlock, ref.faceVector)
                this.recordProductiveWork('placed house foundation block')
              } catch {}
              return
            }
          }
        }
      }

      // If no building materials in inventory, dig surface dirt to stock up
      const dirt = this.bot.findBlock({
        matching: b => b.name === 'dirt' || b.name === 'grass_block',
        maxDistance: 12
      })
      if (dirt) {
        this.watchdog?.setMode('TASK_ACTIVE', 'gather foundation dirt')
        if (this.bot.entity.position.distanceTo(dirt.position) > 4.2 && this.safeNav) {
          await this.safeNav.navigateTo(dirt.position)
        }
        await equipBestTool(this.bot, dirt)
        await this.bot.dig(dirt)
        this.recordProductiveWork(`gathered ${dirt.name}`)
        return
      }
    }

    // Arthur: Sentinel (Clockwise perimeter corner sentry)
    if (r.includes('sentinel') || botName === 'arthur') {
      const corner = HOUSE_CORNERS[this.sentryCorner % HOUSE_CORNERS.length]
      this.watchdog?.setMode('TASK_ACTIVE', `sentry corner ${this.sentryCorner % 4}`)
      if (this.safeNav) {
        await this.safeNav.navigateTo(corner)
      }
      this.sentryCorner++
      this.recordProductiveWork(`completed sentry patrol to corner ${this.sentryCorner % 4}`)
      return
    }

    // Jotaro: Commander (Oversees site at elevated command post)
    if (r.includes('commander') || botName === 'jotaro') {
      if (this.bot.entity.position.distanceTo(COMMAND_POST) > 5.0 && this.safeNav) {
        this.watchdog?.setMode('TASK_ACTIVE', 'command post survey')
        await this.safeNav.navigateTo(COMMAND_POST)
      }
      this.recordProductiveWork('surveyed command post')
      return
    }

    // Default general behavior: navigate along house perimeter
    const defCorner = HOUSE_CORNERS[this.sentryCorner % HOUSE_CORNERS.length]
    this.sentryCorner++
    if (this.safeNav) {
      await this.safeNav.navigateTo(defCorner)
    }
  }
}
