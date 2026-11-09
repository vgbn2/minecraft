// AI Reasoning & LLM Tool Dispatch Engine
import fs from 'fs'
import { Vec3 } from 'vec3'
import { executeStructureBuild } from '../skills/building.mjs'
import { executeDeconstruction } from '../skills/deconstruction.mjs'
import { breakBlockAt, inspectTargetBlock, activateNearestBlock, giveItemsToPlayer } from '../skills/interaction.mjs'
import { bootstrapTools, establishHydratedFarm, harvestAndReplant, craftBreadFromWheat } from '../skills/agriculture_tech.mjs'
import { IpcManager } from '../core/ipc.mjs'
import { TOOLS_SCHEMA } from './tools_schema.mjs'
import { isSquadBot, isHumanPlayer, getNearestHuman, formatEntitySurvey } from '../core/player_registry.mjs'

const ROLE_TOOL_ALLOWLIST = {
  miner: new Set(['mine_resource', 'break_block', 'goto_coordinates', 'come_to_player', 'stay', 'give_to_player', 'bootstrap_tools']),
  farmer: new Set(['manage_farm', 'goto_coordinates', 'come_to_player', 'stay', 'give_to_player']),
  builder: new Set(['build_structure', 'deconstruct_area', 'goto_coordinates', 'come_to_player', 'stay', 'inspect_block']),
  guard: new Set(['attack_nearest', 'goto_coordinates', 'come_to_player', 'follow_player', 'stay']),
  scout: new Set(['goto_coordinates', 'come_to_player', 'follow_player', 'stay', 'inspect_block'])
}

export function getToolsForRole(role) {
  const key = String(role || '').toLowerCase()
  const allow = ROLE_TOOL_ALLOWLIST[key]
  if (!allow) return TOOLS_SCHEMA
  return TOOLS_SCHEMA.filter(t => allow.has(t.function?.name))
}

export class LeakyBucketLimiter {
  constructor(maxConcurrent = 2, maxQueue = 32) {
    this.maxConcurrent = maxConcurrent
    this.maxQueue = maxQueue
    this.active = 0
    this.queue = []
  }

  async run(fn) {
    if (this.active >= this.maxConcurrent) {
      if (this.queue.length >= this.maxQueue) {
        throw new Error('llm_rate_limit_queue_full')
      }
      await new Promise((resolve, reject) => this.queue.push({ resolve, reject }))
    }
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      const next = this.queue.shift()
      if (next) next.resolve()
    }
  }
}

export const defaultLlmLimiter = new LeakyBucketLimiter(2, 32)

export class AIAgent {
  constructor(bot, config, personality, options = {}) {
    this.bot = bot
    this.config = config
    this.personality = personality
    this.safeNav = options.safeNav
    this.supervisor = options.supervisor
    this.sendResponse = options.sendResponse
    this.watchdog = options.watchdog
    this.limiter = options.limiter || defaultLlmLimiter
    this.tokenTotals = { prompt: 0, completion: 0, total: 0, calls: 0, lastLatency: 0 }
  }

  getEnvironmentContext(sender) {
    const isHumanSender = sender && !isSquadBot(sender)
    const player = isHumanSender ? this.bot.players[sender]?.entity : getNearestHuman(this.bot)
    const items = this.bot.inventory.items().map(i => `${i.name}x${i.count}`).join(', ') || 'empty'
    const supervisorContext = this.supervisor?.formatSupervisorContext ? this.supervisor.formatSupervisorContext(sender) : (this.supervisor?.getContextSummary ? this.supervisor.getContextSummary(sender) : 'No spatial landmarks.')

    const survey = formatEntitySurvey(this.bot, 24)
    const humansStr = survey.humans.length ? `Humans: [${survey.humans.join(', ')}]` : 'No humans nearby'
    const squadStr = survey.squad.length ? `Teammates: [${survey.squad.join(', ')}]` : 'Teammates: none'
    const mobsStr = survey.mobs.length ? `Mobs: [${survey.mobs.slice(0, 5).join(', ')}]` : 'Mobs: none'

    return `${supervisorContext}. Inventory: [${items}]. ${humansStr}. ${squadStr}. ${mobsStr}. Direct caller: '${sender}' (distance: ${player ? Math.round(player.position.distanceTo(this.bot.entity.position)) + 'm' : 'unseen'}).`
  }

  async executeToolCall(toolCall, sender, isWhisper) {
    const name = toolCall.function.name
    let args = {}
    try {
      args = JSON.parse(toolCall.function.arguments)
    } catch {
      args = {}
    }

    console.log(`[AI EXEC] ${name}(${JSON.stringify(args)})`)

    if (this.watchdog) {
      if (name === 'stay' || name === 'stop') {
        this.watchdog.setMode('STANDBY', 'Commanded stop/stay')
      } else if (name !== 'reply_chat') {
        this.watchdog.setMode('TASK_ACTIVE', `${name}:${JSON.stringify(args)}`)
      }
    }

    switch (name) {
      case 'reply_chat': {
        this.sendResponse(sender, args.message, isWhisper)
        break
      }
      case 'follow_player': {
        const targetName = args.player_name || sender
        const isHumanTarget = targetName && !isSquadBot(targetName)
        const p = (isHumanTarget && this.bot.players[targetName]?.entity) ||
                  getNearestHuman(this.bot)
        if (p && this.safeNav) {
          this.sendResponse(sender, `Following ${p.username || targetName}...`, isWhisper)
          this.safeNav.navigateTo(p.position.floored())
        } else {
          this.sendResponse(sender, `No player in sight to follow.`, isWhisper)
        }
        break
      }
      case 'goto_coordinates': {
        const pos = { x: args.x, y: args.y, z: args.z }
        this.sendResponse(sender, `Moving to (${pos.x}, ${pos.y}, ${pos.z})...`, isWhisper)
        if (this.safeNav) this.safeNav.navigateTo(pos)
        break
      }
      case 'stay':
      case 'stop': {
        if (this.safeNav) this.safeNav.stop()
        if (this.bot.pathfinder) this.bot.pathfinder.setGoal(null)
        this.sendResponse(sender, 'Stopped.', isWhisper)
        break
      }
      case 'attack_mob': {
        const mobName = (args.mob_name || '').toLowerCase()
        const entity = this.bot.nearestEntity(e =>
          e !== this.bot.entity &&
          (e.name?.toLowerCase().includes(mobName) || e.type?.toLowerCase().includes(mobName))
        )
        if (entity && this.bot.pvp) {
          this.sendResponse(sender, `Attacking ${entity.name || mobName}!`, isWhisper)
          this.bot.pvp.attack(entity)
          const onStop = () => {
            this.bot.removeListener('stoppedAttacking', onStop)
            this.watchdog?.setMode('IDLE')
            this.sendResponse(sender, `Finished combat with ${entity.name || mobName}.`, isWhisper)
          }
          this.bot.once('stoppedAttacking', onStop)
          setTimeout(() => {
            if (this.bot.pvp?.target === entity) {
              this.bot.pvp.stop()
              this.watchdog?.setMode('IDLE')
            }
          }, 30000)
        } else {
          this.sendResponse(sender, `No ${mobName} found nearby.`, isWhisper)
          this.watchdog?.setMode('IDLE')
        }
        break
      }
      case 'collect_blocks': {
        const rawName = (args.block_name || 'coal_ore').toLowerCase().replace(/^(minecraft:)/, '')
        const targetCount = Math.min(Math.max(args.count || 1, 1), 10)
        const blockType = this.bot.registry?.blocksByName?.[rawName]
        if (!blockType) {
          this.sendResponse(sender, `Unknown block type: ${rawName}`, isWhisper)
          this.watchdog?.setMode('IDLE')
          return
        }
        // Cap maxDistance to 16 to avoid loading millions of blocks (OOM crash)
        const searchDist = 16
        const targets = this.bot.findBlocks({
          matching: blockType.id,
          maxDistance: searchDist,
          count: targetCount
        })
        if (!targets || targets.length === 0) {
          this.sendResponse(sender, `No ${rawName} found within ${searchDist} blocks.`, isWhisper)
          this.watchdog?.setMode('IDLE')
          return
        }
        this.sendResponse(sender, `Found ${targets.length} ${rawName}(s). Mining...`, isWhisper)
        try {
          const blocks = targets.map(p => this.bot.blockAt(p)).filter(Boolean)
          await this.bot.collectBlock.collect(blocks)
          this.sendResponse(sender, `Finished collecting ${rawName}!`, isWhisper)
        } catch (err) {
          this.sendResponse(sender, `Failed collecting ${rawName}: ${err.message}`, isWhisper)
        } finally {
          this.watchdog?.setMode('IDLE')
        }
        break
      }
      case 'deconstruct_area': {
        const radius = Math.min(Math.max(args.radius || 3, 1), 5)
        const height = Math.min(Math.max(args.height || 2, 1), 5)
        const origin = this.bot.entity.position.floored()
        const plan = []
        for (let dy = height - 1; dy >= 0; dy--) {
          for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
              plan.push(origin.offset(dx, dy, dz))
            }
          }
        }
        this.sendResponse(sender, `Quarrying ${plan.length} blocks around (${origin.x}, ${origin.y}, ${origin.z})...`, isWhisper)
        await executeDeconstruction(this.bot, plan, sender, isWhisper, this.sendResponse, this.supervisor)
        break
      }
      case 'build_structure': {
        const type = (args.structure_type || 'wall').toLowerCase()
        const mat = (args.material || 'dirt').toLowerCase()
        const size = args.size || 3
        await executeStructureBuild(this.bot, type, mat, size, sender, isWhisper, this.sendResponse)
        break
      }
      case 'break_block': {
        const x = parseFloat(args.x)
        const y = parseFloat(args.y)
        const z = parseFloat(args.z)
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          const ok = await breakBlockAt(this.bot, new Vec3(x, y, z), this.safeNav)
          this.sendResponse(sender, ok ? `Broke block at (${x}, ${y}, ${z})!` : `Could not break block at (${x}, ${y}, ${z}).`, isWhisper)
        }
        break
      }
      case 'inspect_block': {
        const b = inspectTargetBlock(this.bot, 5)
        if (b) {
          this.sendResponse(sender, `Looking at ${b.name} at (${b.position.x}, ${b.position.y}, ${b.position.z}).`, isWhisper)
        } else {
          this.sendResponse(sender, 'Not looking directly at any block within 5m.', isWhisper)
        }
        break
      }
      case 'activate_block': {
        const pos = (args.x !== undefined && args.y !== undefined && args.z !== undefined)
          ? new Vec3(parseFloat(args.x), parseFloat(args.y), parseFloat(args.z))
          : null
        const ok = await activateNearestBlock(this.bot, args.block_name, pos, this.safeNav)
        this.sendResponse(sender, ok ? `Activated ${args.block_name || 'block'}!` : `Could not activate ${args.block_name || 'block'}.`, isWhisper)
        break
      }
      case 'give_to_player': {
        const target = args.player_name || sender
        const res = await giveItemsToPlayer(this.bot, args.item_name, args.count || 1, target, this.safeNav)
        this.sendResponse(sender, res.success ? `Gave ${res.count} item(s) to ${target}!` : `Could not give items: ${res.reason}`, isWhisper)
        break
      }
      case 'delegate_task': {
        const targetAgent = args.target_agent
        const cmd = args.command
        const brief = args.tactical_brief || 'Tactical order'
        console.log(`[ORCHESTRATOR] ${this.personality.name || this.bot.username} delegating to ${targetAgent}: "${cmd}" (${brief})`)
        this.sendResponse(sender, `[Order] @${targetAgent} ${cmd} (${brief})`, isWhisper)
        if (!IpcManager.dispatchCommand(targetAgent, cmd)) {
          console.error(`[!] Failed to route delegated task to ${targetAgent}`)
        }
        break
      }
      case 'bootstrap_tools': {
        this.sendResponse(sender, 'Bootstrapping tool tech tree...', isWhisper)
        bootstrapTools(this.bot, { log: m => console.log(m) })
          .then(res => this.sendResponse(sender, res.message || 'Tools bootstrapped!', isWhisper))
          .catch(err => this.sendResponse(sender, `Bootstrap error: ${err.message}`, isWhisper))
        break
      }
      case 'manage_farm': {
        const action = (args.action || 'harvest').toLowerCase()
        if (action === 'establish') {
          this.sendResponse(sender, 'Establishing 9x9 hydrated farm...', isWhisper)
          establishHydratedFarm(this.bot, null, { log: m => console.log(m) })
            .then(res => this.sendResponse(sender, `Farm established! Tilled: ${res.tilled}, Planted: ${res.planted}`, isWhisper))
            .catch(err => this.sendResponse(sender, `Farm error: ${err.message}`, isWhisper))
        } else if (action === 'bake') {
          craftBreadFromWheat(this.bot)
            .then(count => this.sendResponse(sender, `Baked ${count} bread loaf/loaves!`, isWhisper))
            .catch(err => this.sendResponse(sender, `Bake error: ${err.message}`, isWhisper))
        } else {
          this.sendResponse(sender, 'Harvesting and replanting mature crops...', isWhisper)
          harvestAndReplant(this.bot, { log: m => console.log(m) })
            .then(res => this.sendResponse(sender, `Harvest complete! Reaped: ${res.harvested}, Replanted: ${res.replanted}, Bread: ${res.bakedBread}`, isWhisper))
            .catch(err => this.sendResponse(sender, `Harvest error: ${err.message}`, isWhisper))
        }
        break
      }
    }
  }

  async query(sender, userMessage, isWhisper) {
    if (!this.config.ai_enabled || !this.config.api_base) return

    const envContext = this.getEnvironmentContext(sender)
    console.log(`[AI PROMPT] Querying model '${this.config.model}'...`)
    const t0 = Date.now()

    try {
      const roleTools = getToolsForRole(this.personality?.roleKey)
      const res = await this.limiter.run(() => fetch(`${this.config.api_base.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.api_key ? { Authorization: `Bearer ${this.config.api_key}` } : {})
        },
        body: JSON.stringify({
          model: this.config.model,
          stream: false,
          messages: [
            {
              role: 'system',
              content: `${this.personality.role.replace(/\$\{sender\}/g, sender)} Environment: ${envContext}`
            },
            {
              role: 'user',
              content: userMessage
            }
          ],
          tools: roleTools,
          tool_choice: 'auto',
          max_tokens: 1000,
          temperature: 0.3
        })
      }))

      const latency = Date.now() - t0

      if (!res.ok) {
        const errText = await res.text()
        console.error(`[!] LLM API HTTP ${res.status}:`, errText)
        this.sendResponse(sender, `[AI Error ${res.status}] Check console log.`, isWhisper)
        return
      }

      const rawText = await res.text()
      let data
      try {
        data = JSON.parse(rawText)
      } catch {
        const dataLine = rawText.split('\n').find(l => l.startsWith('data:') && !l.includes('[DONE]'))
        if (dataLine) {
          data = JSON.parse(dataLine.replace(/^data:\s*/, ''))
        } else {
          throw new Error(`Invalid JSON: ${rawText.slice(0, 80)}`)
        }
      }
      IpcManager.recordTokens(this.personality.name || this.bot.username, data.usage, latency, this.tokenTotals)
      const choice = data.choices?.[0]?.message
      if (!choice) return

      if (choice.tool_calls && choice.tool_calls.length > 0) {
        for (const tc of choice.tool_calls) {
          await this.executeToolCall(tc, sender, isWhisper)
        }
      } else if (choice.content) {
        this.sendResponse(sender, choice.content.slice(0, 100), isWhisper)
      }
    } catch (err) {
      console.error(`[!] Failed to query AI model:`, err.message)
      this.sendResponse(sender, `Couldn't reach AI brain (${err.message}).`, isWhisper)
    }
  }
}
