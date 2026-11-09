// Autonomous Minecraft AI Bot Platform - Entrypoint
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Vec3 } from 'vec3'
import { createBotInstance } from './core/client.mjs'
import { IpcManager } from './core/ipc.mjs'
import { AIAgent } from './intelligence/ai_agent.mjs'
import { PrompterSupervisor } from './intelligence/supervisor.mjs'
import { SafeHopNavigator } from './kinematics/navigator.mjs'
import { CombatEvasionController } from './kinematics/combat_evasion.mjs'
import { TacticalEscapeExcavator } from './kinematics/tactical_escape.mjs'
import { formatJojoCard, formatJojoChatLine, formatSquadMatrix } from './squad/jojo_stands.mjs'
import { breakBlockAt, inspectTargetBlock, activateNearestBlock, giveItemsToPlayer } from './skills/interaction.mjs'
import { executeDeconstruction } from './skills/deconstruction.mjs'
import { bootstrapTools, establishHydratedFarm, harvestAndReplant, craftBreadFromWheat, SquadNutritionDepot } from './skills/agriculture_tech.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 1. Load configuration and JoJo Stand personalities
function loadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    }
  } catch {}
  return null
}

const personalitiesPath = path.join(__dirname, '../config/personalities.json')
export const PERSONALITIES = loadJson(personalitiesPath) || {}

const defaults = {
  bot_name: 'Companion',
  ai_enabled: true,
  api_base: process.env.MC_API_BASE || 'http://127.0.0.1:20128/v1',
  api_key: process.env.MC_API_KEY || '',
  model: 'ag/gemini-3.8-flash',
  max_distance: 96,
  view_distance: 6
}

const defaultConfig = loadJson(path.join(__dirname, '../config/default.json')) || {}
const dataConfig = loadJson(path.join(process.env.HOME || '.', '.local/share/mc-bot/config.json')) ||
                   loadJson(path.join(__dirname, '../../config.json')) ||
                   loadJson(path.join(process.cwd(), 'config.json')) || {}

export const config = { ...defaults, ...defaultConfig, ...dataConfig }
if (process.env.MC_API_BASE) config.api_base = process.env.MC_API_BASE
if (process.env.MC_API_KEY) config.api_key = process.env.MC_API_KEY

if (!config.api_key) {
  config.api_key = process.env.OPENAI_API_KEY || ''
  if (!config.api_key) {
    const ocPath = path.join(process.env.HOME || '.', '.config/opencode/opencode.json')
    const oc = loadJson(ocPath)
    if (oc) {
      config.api_key = oc?.provider?.['9router-default']?.options?.apiKey ||
                       oc?.provider?.['9router-secondary']?.options?.apiKey ||
                       oc?.provider?.['9router']?.options?.apiKey || ''
    }
  }
}

const host = process.env.MC_HOST || '127.0.0.1'
const port = parseInt(process.env.MC_PORT || '25565', 10)
const username = process.env.MC_BOT_NAME || config.bot_name
const version = process.env.MC_VERSION || false
const personalityKey = (process.env.MC_BOT_PERSONALITY || config.personality || 'companion').toLowerCase()
export const personality = PERSONALITIES[personalityKey] || PERSONALITIES.companion

// ponytail: swap-backed logging monitor; auto-truncates to 0 if log reaches 1GB ceiling
const LOG_FILE = process.env.MC_LOG_FILE || `/dev/shm/mc-bot/${username}.log`
const MAX_LOG_BYTES = 1024 * 1024 * 1024 // 1GB
setInterval(() => {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE)
      if (stats.size >= MAX_LOG_BYTES) {
        fs.truncateSync(LOG_FILE, 0)
        console.log(`[!] Log reached 1GB ceiling; automatically flushed in /dev/shm/mc-bot/`)
      }
    }
  } catch {}
}, 30000).unref()

console.log(`[*] Connecting AI bot '${username}' [${personality.title}] (Stand: ${personality.stand}) to ${host}:${port}...`)
console.log(`[*] AI Model: ${config.model} @ ${config.api_base} (viewDistance: ${config.view_distance})`)

// 2. Initialize Mineflayer client
export const bot = createBotInstance({
  host,
  port,
  username,
  version,
  viewDistance: config.view_distance
})

// 3. Initialize Kinematics & Spatial Systems
export const safeNav = new SafeHopNavigator(bot, { maxHopDistance: 24 })
export const combatEvasion = new CombatEvasionController(bot)
export const escapeExcavator = new TacticalEscapeExcavator(bot)
export const supervisor = new PrompterSupervisor(bot)

// 4. Chat Response Helper
export function sendResponse(target, message, isWhisper = false) {
  if (!message) return
  const clean = message.replace(/[\n\r]+/g, ' ').slice(0, 100)
  try {
    if (isWhisper && target) {
      console.log(`[CHAT OUT] [WHISPER] -> <${target}>: ${clean}`)
      bot.whisper(target, clean)
    } else {
      console.log(`[CHAT OUT] [PUBLIC] -> <${target}>: ${clean}`)
      bot.chat(clean)
    }
  } catch (err) {
    console.error(`[!] Failed to send chat message:`, err.message)
  }
}

// 5. Initialize AIAgent
export const aiAgent = new AIAgent(bot, config, personality, {
  safeNav,
  supervisor,
  sendResponse
})

// 6. Fast-path command dispatcher
export async function handleFastCommand(sender, command, args, isWhisper) {
  const player = bot.players[sender]?.entity ||
                 bot.nearestEntity(e => (e.type === 'player' || e.name === 'player') && e !== bot.entity)
  const context = {
    playerPos: player?.position?.floored(),
    botPos: bot.entity?.position?.floored()
  }

  const intent = supervisor.parseMacroIntent(sender, command, args, context)
  if (intent) {
    switch (intent.type) {
      case 'NAVIGATE': {
        aiAgent.executeToolCall({ function: { name: 'stop', arguments: '{}' } }, sender, isWhisper)
        sendResponse(sender, `${intent.description}...`, isWhisper)
        if (intent.route && intent.route.length > 0) {
          (async () => {
            for (const wp of intent.route) {
              if (supervisor.status === 'ABORTED') break
              await safeNav.navigateTo({ x: wp.x, y: wp.y, z: wp.z })
            }
          })().catch(err => console.error('[!] Route navigation error:', err))
        } else {
          safeNav.navigateTo(intent.targetPos).catch(err => console.error('[!] Navigation error:', err))
        }
        return true
      }
      case 'DECONSTRUCT': {
        executeDeconstruction(bot, intent.plan, sender, isWhisper, sendResponse, supervisor)
        return true
      }
      case 'WAYPOINT_SET':
      case 'WAYPOINT_CONNECT':
      case 'INFO':
      case 'ERROR':
      case 'USAGE':
      case 'ABORT': {
        sendResponse(sender, intent.message, isWhisper)
        return true
      }
    }
  }

  switch (command) {
    case 'come':
    case 'follow': {
      if (!player) {
        sendResponse(sender, "I can't see you right now!", isWhisper)
        return true
      }
      sendResponse(sender, `Coming to you, ${sender}!`, isWhisper)
      safeNav.navigateTo(player.position.floored())
      return true
    }
    case 'goto': {
      if (args.length < 3) {
        sendResponse(sender, 'Usage: !goto <x> <y> <z>', isWhisper)
        return true
      }
      const targetPos = { x: parseFloat(args[0]), y: parseFloat(args[1]), z: parseFloat(args[2]) }
      sendResponse(sender, `Navigating to (${targetPos.x}, ${targetPos.y}, ${targetPos.z})...`, isWhisper)
      safeNav.navigateTo(targetPos)
      return true
    }
    case 'stay':
    case 'stop': {
      safeNav.stop()
      supervisor.abort()
      if (bot.pathfinder) bot.pathfinder.setGoal(null)
      sendResponse(sender, 'Standing by.', isWhisper)
      return true
    }
    case 'status': {
      const health = Math.round(bot.health || 20)
      const food = Math.round(bot.food || 20)
      const pos = bot.entity ? bot.entity.position.floored() : 'unknown'
      const invList = bot.inventory.items().map(i => `${i.name}x${i.count}`).join(', ') || 'empty'
      const chunkCount = bot.world?.getColumns ? bot.world.getColumns().length : 0
      sendResponse(sender, `Health: ${health}/20 | Food: ${food}/20 | Pos: ${pos} | Inv: [${invList}] | Chunks: ${chunkCount} | AI: ${aiAgent.tokenTotals.total}t (${aiAgent.tokenTotals.calls}c)`, isWhisper)
      return true
    }
    case 'jojo':
    case 'stand': {
      sendResponse(sender, formatJojoChatLine(personality), isWhisper)
      console.log(`\n=== JOJO STAND PARAMETERS ===\n${formatJojoCard(personality)}\n=============================\n`)
      return true
    }
    case 'squad': {
      sendResponse(sender, `SQUAD: ${formatSquadMatrix(PERSONALITIES)}`, isWhisper)
      return true
    }
    case 'inspect': {
      if (!bot.entity) return true
      const targetBlock = inspectTargetBlock(bot, 5)
      if (targetBlock && args[0] !== 'area') {
        sendResponse(sender, `Looking at ${targetBlock.name} at (${targetBlock.position.x}, ${targetBlock.position.y}, ${targetBlock.position.z}) [hardness: ${targetBlock.hardness}]`, isWhisper)
        return true
      }
      const cur = bot.entity.position
      const bx = Math.floor(cur.x)
      const by = Math.floor(cur.y)
      const bz = Math.floor(cur.z)
      const lines = []
      for (let dy = -1; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const b = bot.blockAt(new Vec3(bx + dx, by + dy, bz + dz))
            if (b && b.name !== 'air') lines.push(`(${dx>=0?'+'+dx:dx},${dy>=0?'+'+dy:dy},${dz>=0?'+'+dz:dz}):${b.name}`)
          }
        }
      }
      sendResponse(sender, `Blocks (${lines.length}): ${lines.slice(0, 8).join(', ')}`, isWhisper)
      return true
    }
    case 'survey': {
      if (!bot.entity) return true
      const bPos = bot.entity.position.floored()
      const standingOn = bot.blockAt(bPos.offset(0, -1, 0))?.name || 'air'
      const nearby = Object.values(bot.entities)
        .filter(e => e !== bot.entity && e.position && e.position.distanceTo(bot.entity.position) < 24)
        .map(e => `${e.name || e.type}(${Math.round(e.position.distanceTo(bot.entity.position))}m)`)
        .slice(0, 4)
        .join(', ') || 'none'
      sendResponse(sender, `At (${bPos.x}, ${bPos.y}, ${bPos.z}) on ${standingOn}. Nearby: ${nearby}`, isWhisper)
      return true
    }
    case 'break':
    case 'dig': {
      let targetVec = null
      if (args.length >= 3) {
        const bx = parseFloat(args[0]), by = parseFloat(args[1]), bz = parseFloat(args[2])
        if (!isNaN(bx) && !isNaN(by) && !isNaN(bz)) targetVec = new Vec3(bx, by, bz)
      } else {
        const cursorBlock = inspectTargetBlock(bot, 5)
        if (cursorBlock) targetVec = cursorBlock.position
        else if (bot.entity) targetVec = bot.entity.position.offset(0, -1, 0).floored()
      }
      if (!targetVec) {
        sendResponse(sender, 'No target block to break specified or in sight.', isWhisper)
        return true
      }
      sendResponse(sender, `Breaking block at (${targetVec.x}, ${targetVec.y}, ${targetVec.z})...`, isWhisper)
      breakBlockAt(bot, targetVec, safeNav).then(ok => {
        sendResponse(sender, ok ? `Broke block at (${targetVec.x}, ${targetVec.y}, ${targetVec.z})!` : `Could not break block at (${targetVec.x}, ${targetVec.y}, ${targetVec.z}).`, isWhisper)
      }).catch(err => sendResponse(sender, `Break error: ${err.message}`, isWhisper))
      return true
    }
    case 'interact':
    case 'activate':
    case 'use': {
      const typeOrName = args[0] || 'door'
      sendResponse(sender, `Interacting with ${typeOrName}...`, isWhisper)
      activateNearestBlock(bot, typeOrName, null, safeNav).then(ok => {
        sendResponse(sender, ok ? `Activated ${typeOrName}!` : `No ${typeOrName} found to activate.`, isWhisper)
      }).catch(err => sendResponse(sender, `Interact error: ${err.message}`, isWhisper))
      return true
    }
    case 'give':
    case 'toss': {
      const itemName = args[0] || 'all'
      const count = parseInt(args[1] || '1', 10)
      sendResponse(sender, `Giving ${itemName} to ${sender}...`, isWhisper)
      giveItemsToPlayer(bot, itemName, count, sender, safeNav).then(res => {
        sendResponse(sender, res.success ? `Gave ${res.count} item(s) to ${sender}!` : `Could not give items: ${res.reason}`, isWhisper)
      }).catch(err => sendResponse(sender, `Give error: ${err.message}`, isWhisper))
      return true
    }
    case 'swing': {
      bot.swingArm('right')
      sendResponse(sender, 'Swung arm!', isWhisper)
      return true
    }
    case 'bootstrap': {
      sendResponse(sender, 'Starting tool tech tree progression...', isWhisper)
      bootstrapTools(bot, { log: m => console.log(m) })
        .then(res => sendResponse(sender, res.message || 'Tools bootstrapped!', isWhisper))
        .catch(err => sendResponse(sender, `Bootstrap error: ${err.message}`, isWhisper))
      return true
    }
    case 'farm': {
      sendResponse(sender, 'Tilling and planting 9x9 hydrated farm...', isWhisper)
      establishHydratedFarm(bot, null, { log: m => console.log(m) })
        .then(res => sendResponse(sender, `Farm established! Tilled: ${res.tilled}, Planted: ${res.planted}`, isWhisper))
        .catch(err => sendResponse(sender, `Farm error: ${err.message}`, isWhisper))
      return true
    }
    case 'harvest': {
      sendResponse(sender, 'Harvesting and replanting mature crops...', isWhisper)
      harvestAndReplant(bot, { log: m => console.log(m) })
        .then(res => sendResponse(sender, `Harvest complete! Reaped: ${res.harvested}, Replanted: ${res.replanted}, Bread: ${res.bakedBread}`, isWhisper))
        .catch(err => sendResponse(sender, `Harvest error: ${err.message}`, isWhisper))
      return true
    }
    case 'feed': {
      const target = args[0] || sender
      const depot = new SquadNutritionDepot(bot)
      depot.distributeRations(target, 8, safeNav)
        .then(res => sendResponse(sender, res.success ? `Gave ${res.count} bread to ${target}!` : `Could not feed: ${res.reason}`, isWhisper))
        .catch(err => sendResponse(sender, `Feed error: ${err.message}`, isWhisper))
      return true
    }
    case 'help': {
      sendResponse(sender, `Fast cmds: !jojo, !squad, !come, !goto <x y z>, !survey, !swing, !break, !inspect, !interact <type>, !give <item>, !clear <r>, !setmark <n>, !gotomark <n>, !marks, !mine, !build, !bootstrap, !farm, !harvest, !feed, !stop.`, isWhisper)
      return true
    }
  }
  return false
}

// 7. Inbound Chat Router
export function handleMessage(sender, rawMessage, isWhisper, isIpc = false) {
  const botName = username || bot.username || 'Companion'
  if (sender === botName || !bot.entity) return
  if (!bot.isAlive || (bot.health !== undefined && bot.health <= 0)) {
    sendResponse(sender, "I'm currently respawning, please wait a moment!", isWhisper)
    return
  }
  let msg = rawMessage.trim()
  console.log(`[CHAT IN] [${isWhisper ? 'WHISPER' : 'PUBLIC'}] <${sender}>: ${msg}`)

  let isPrefixed = false
  if (!isWhisper && !isIpc) {
    if (msg.startsWith('!')) {
      isPrefixed = true
      msg = msg.slice(1).trim()
    } else {
      const nameRegex = new RegExp(`^@?${botName}\\b[:,]?\\s*`, 'i')
      if (nameRegex.test(msg)) {
        msg = msg.replace(nameRegex, '').trim()
      } else {
        return
      }
    }
  } else {
    if (rawMessage.trim().startsWith('/')) {
      console.log(`[SLASH CMD] Dispatching in-game slash command: ${rawMessage.trim()}`)
      bot.chat(rawMessage.trim())
      return
    }
    if (msg.startsWith('!') || msg.startsWith('/')) {
      msg = msg.slice(1).trim()
    }
  }

  const parts = msg.split(/\s+/)
  const firstWord = parts[0].toLowerCase()

  handleFastCommand(sender, firstWord, parts.slice(1), isWhisper).then(handled => {
    if (handled) return
    aiAgent.query(sender, msg, isWhisper)
  }).catch(err => {
    console.error('[!] Error in handleFastCommand:', err)
  })
}

// 8. Bot Lifecycle Events
bot.on('chat', (sender, message) => handleMessage(sender, message, false))
bot.on('whisper', (sender, message) => handleMessage(sender, message, true))

bot.once('spawn', () => {
  const p = bot.entity.position.floored()
  console.log(`[+] Bot '${username}' [${personality.title}] (Stand: ${personality.stand}) successfully spawned in world at (${p.x}, ${p.y}, ${p.z})`)
  console.log(`\n=== JOJO STAND PARAMETERS ===\n${formatJojoCard(personality)}\n=============================\n`)
  try {
    if (bot.autoEat) {
      const opts = bot.autoEat.opts || bot.autoEat.options || {}
      opts.priority = 'foodPoints'
      opts.bannedFood = ['rotten_flesh', 'poisonous_potato', 'pufferfish', 'spider_eye']
      if (typeof bot.autoEat.setOpts === 'function') {
        bot.autoEat.setOpts({ priority: 'foodPoints', bannedFood: opts.bannedFood })
      }
    }
  } catch {}
})

// 9. Start IPC Manager
export const ipc = new IpcManager(username, handleMessage)
ipc.start()

bot.on('end', () => {
  console.log(`[-] Bot '${username}' disconnected from server.`)
  ipc.stop()
  process.exit(0)
})

bot.on('kicked', reason => console.log(`[!] Bot was kicked:`, reason))
bot.on('error', err => console.error(`[!] Socket/Protocol error:`, err.stack || err.message))
