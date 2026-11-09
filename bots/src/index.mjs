// Autonomous Minecraft AI Bot Platform - Entrypoint
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Vec3 } from 'vec3'
import { createBotInstance } from './core/client.mjs'
import { IpcManager } from './core/ipc.mjs'
import { ChatMessageRouter } from './core/chat_router.mjs'
import { AIAgent } from './intelligence/ai_agent.mjs'
import { PrompterSupervisor } from './intelligence/supervisor.mjs'
import { SafeHopNavigator } from './kinematics/navigator.mjs'
import { CombatEvasionController } from './kinematics/combat_evasion.mjs'
import { TacticalEscapeExcavator } from './kinematics/tactical_escape.mjs'
import { formatJojoCard, formatJojoChatLine, formatSquadMatrix } from './squad/jojo_stands.mjs'
import { MotionWatchdog } from './intelligence/motion_watchdog.mjs'
import { isSquadBot, isHumanPlayer, getNearestHuman, formatEntitySurvey } from './core/player_registry.mjs'
import { breakBlockAt, inspectTargetBlock, activateNearestBlock, giveItemsToPlayer } from './skills/interaction.mjs'
import { executeDeconstruction } from './skills/deconstruction.mjs'
import { generateHouse20x20Plan, generateHouseClearancePlan, AutonomousArchitectureRunner } from './skills/voxel_schematic.mjs'
import { executeStructureBuild } from './skills/voxel_placement.mjs'
import { bootstrapTools, establishHydratedFarm, harvestAndReplant, craftBreadFromWheat, SquadNutritionDepot } from './skills/agriculture_tech.mjs'
import { AutonomousIncentiveEngine } from './intelligence/autonomous_routine.mjs'

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
  language: process.env.MC_LANGUAGE || 'auto',
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
if (process.env.MC_LANGUAGE) config.language = process.env.MC_LANGUAGE

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

// ponytail: O_APPEND-safe same-inode tail rewind; caps log at 4MB while preserving latest 256KB crash tail
const LOG_FILE = process.env.MC_LOG_FILE || `/dev/shm/mc-bot/${username}.log`
export const MAX_LOG_BYTES = 4 * 1024 * 1024 // 4MB
export const KEEP_LOG_TAIL_BYTES = 256 * 1024 // 256KB

export function rewindLogFileInPlace(logFile = LOG_FILE, maxBytes = MAX_LOG_BYTES, keepBytes = KEEP_LOG_TAIL_BYTES) {
  if (!logFile || !fs.existsSync(logFile)) return false
  const stats = fs.statSync(logFile)
  if (stats.size < maxBytes) return false
  const actualKeep = Math.min(keepBytes, stats.size)
  const fd = fs.openSync(logFile, 'r+')
  try {
    const buf = Buffer.allocUnsafe(actualKeep)
    const bytesRead = fs.readSync(fd, buf, 0, actualKeep, stats.size - actualKeep)
    fs.writeSync(fd, buf, 0, bytesRead, 0)
    fs.ftruncateSync(fd, bytesRead)
    return true
  } finally {
    fs.closeSync(fd)
  }
}

setInterval(() => {
  try {
    if (rewindLogFileInPlace(LOG_FILE, MAX_LOG_BYTES, KEEP_LOG_TAIL_BYTES)) {
      console.log(`[!] Log reached 4MB ceiling; rewound in-place to latest 256KB in /dev/shm/mc-bot/`)
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
export const escapeExcavator = new TacticalEscapeExcavator(bot)
export const safeNav = new SafeHopNavigator(bot, { maxHopDistance: 24, excavator: escapeExcavator })
export const combatEvasion = new CombatEvasionController(bot)
export const supervisor = new PrompterSupervisor({ bot, language: config.language || 'auto' })
export const watchdog = new MotionWatchdog(bot, {
  idleThresholdSec: 12,
  onAlert: (msg, status) => {
    try {
      fs.writeFileSync(`/dev/shm/mc-bot/${bot.username || 'bot'}.alert`, JSON.stringify(status, null, 2))
    } catch {}
  }
})

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
  sendResponse,
  watchdog
})

export const incentiveEngine = new AutonomousIncentiveEngine(bot, safeNav, watchdog, personality.role)
let activePatrolInterval = null

export function startPatrolLoop(radius = 12, customCenter = null) {
  if (activePatrolInterval) {
    clearInterval(activePatrolInterval)
    activePatrolInterval = null
  }
  incentiveEngine.start(5000)
}

// 6. Fast-path command dispatcher
export async function handleFastCommand(sender, command, args, isWhisper) {
  const player = (sender && !isSquadBot(sender) && bot.players[sender]?.entity) ||
                 getNearestHuman(bot)
  const context = {
    playerPos: player?.position?.floored(),
    botPos: bot.entity?.position?.floored()
  }

  const intent = supervisor.parseMacroIntent(sender, command, args, context)
  if (intent) {
    switch (intent.type) {
      case 'NAVIGATE': {
        watchdog.setMode('TASK_ACTIVE', intent.description || 'navigating')
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
        if (activePatrolInterval) {
          clearInterval(activePatrolInterval)
          activePatrolInterval = null
        }
        watchdog.setMode('TASK_ACTIVE', 'deconstruct')
        executeDeconstruction(bot, intent.plan, sender, isWhisper, sendResponse, supervisor, safeNav)
          .then(() => watchdog.setMode('IDLE'))
          .catch(err => {
            console.error('[!] Deconstruction error:', err)
            watchdog.setMode('IDLE')
          })
        return true
      }
      case 'WAYPOINT_SET':
      case 'WAYPOINT_CONNECT':
      case 'INFO':
      case 'ERROR':
      case 'USAGE': {
        sendResponse(sender, intent.message, isWhisper)
        return true
      }
      case 'ABORT': {
        watchdog.setMode('STANDBY', 'Commanded standby')
        safeNav.stop()
        if (bot.pathfinder) bot.pathfinder.setGoal(null)
        sendResponse(sender, intent.message, isWhisper)
        return true
      }
    }
  }

  switch (command) {
    case 'come':
    case 'follow': {
      if (activePatrolInterval) {
        clearInterval(activePatrolInterval)
        activePatrolInterval = null
      }
      const targetEntity = (args[0] && bot.players[args[0]]?.entity) || player
      if (!targetEntity) {
        sendResponse(sender, "I can't see you or any human player right now!", isWhisper)
        return true
      }
      const targetName = targetEntity.username || sender
      watchdog.setMode('TASK_ACTIVE', `follow ${targetName}`)
      sendResponse(sender, `Following ${targetName}!`, isWhisper)
      if (bot.pathfinder && pathfinderPkg?.goals?.GoalFollow) {
        safeNav.stop()
        bot.pathfinder.setGoal(new pathfinderPkg.goals.GoalFollow(targetEntity, 2), true)
      } else {
        safeNav.navigateTo(targetEntity.position.floored()).then(() => watchdog.setMode('IDLE'))
      }
      return true
    }
    case 'goto': {
      if (activePatrolInterval) {
        clearInterval(activePatrolInterval)
        activePatrolInterval = null
      }
      if (args.length < 3) {
        sendResponse(sender, 'Usage: !goto <x> <y> <z>', isWhisper)
        return true
      }
      const targetPos = { x: parseFloat(args[0]), y: parseFloat(args[1]), z: parseFloat(args[2]) }
      watchdog.setMode('TASK_ACTIVE', `goto ${targetPos.x} ${targetPos.y} ${targetPos.z}`)
      sendResponse(sender, `Navigating to (${targetPos.x}, ${targetPos.y}, ${targetPos.z})...`, isWhisper)
      safeNav.navigateTo(targetPos).then((res) => {
        if (res?.success) {
          sendResponse(sender, `Arrived at (${targetPos.x}, ${targetPos.y}, ${targetPos.z})!`, isWhisper)
        }
        watchdog.setMode('IDLE')
      }).catch(() => watchdog.setMode('IDLE'))
      return true
    }
    case 'patrol':
    case 'wander':
    case 'roam': {
      const radius = Math.min(Math.max(parseFloat(args[0]) || 12, 4), 30)
      startPatrolLoop(radius)
      const center = bot.entity ? bot.entity.position.floored() : { x: 0, y: 64, z: 0 }
      sendResponse(sender, `Patrolling perimeter (radius: ${radius}m around ${center.x}, ${center.y}, ${center.z})...`, isWhisper)
      return true
    }
    case 'mine':
    case 'quarry': {
      const rawName = (args[0] || 'stone').toLowerCase().replace(/^(minecraft:)/, '')
      const targetCount = Math.min(Math.max(parseInt(args[1], 10) || 1, 1), 10)
      const blockType = bot.registry?.blocksByName?.[rawName]
      if (!blockType) {
        sendResponse(sender, `Unknown block type: ${rawName}`, isWhisper)
        return true
      }
      const searchDist = 16
      const targets = bot.findBlocks({
        matching: blockType.id,
        maxDistance: searchDist,
        count: targetCount
      })
      if (!targets || targets.length === 0) {
        sendResponse(sender, `No ${rawName} found within ${searchDist}m.`, isWhisper)
        return true
      }
      watchdog.setMode('TASK_ACTIVE', `mine ${rawName} x${targets.length}`)
      sendResponse(sender, `Found ${targets.length} ${rawName}(s). Mining...`, isWhisper)
      ;(async () => {
        try {
          const blocks = targets.map(p => bot.blockAt(p)).filter(Boolean)
          await bot.collectBlock.collect(blocks)
          sendResponse(sender, `Finished mining ${rawName}!`, isWhisper)
        } catch (err) {
          sendResponse(sender, `Mining failed: ${err.message}`, isWhisper)
        } finally {
          watchdog.setMode('IDLE')
        }
      })()
      return true
    }
    case 'clear':
    case 'excavate': {
      if (activePatrolInterval) {
        clearInterval(activePatrolInterval)
        activePatrolInterval = null
      }
      const target = (args[0] || '').toLowerCase()
      if (target === 'house') {
        const origin = new Vec3(-240, 65, 100)
        const sector = args[1] || bot.username || 'all'
        const plan = generateHouseClearancePlan(origin, { bot, sector, height: 4, includeFloor: true })
        watchdog.setMode('TASK_ACTIVE', `house clear ${sector}`)
        sendResponse(sender, `Excavating 20x20 house footprint [sector: ${sector}] (${plan.length} blocks to clear)...`, isWhisper)
        executeDeconstruction(bot, plan, sender, isWhisper, sendResponse, supervisor, safeNav)
          .then(() => watchdog.setMode('IDLE'))
          .catch(() => watchdog.setMode('IDLE'))
        return true
      }
      const r = Math.min(Math.max(parseInt(args[0], 10) || 3, 1), 10)
      const h = Math.min(Math.max(parseInt(args[1], 10) || 3, 1), 5)
      const curPos = bot.entity?.position?.floored() || new Vec3(-240, 65, 100)
      const plan = []
      for (let dy = h; dy >= -1; dy--) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            const p = curPos.offset(dx, dy, dz)
            const blk = bot.blockAt(p)
            if (blk && blk.name !== 'air' && blk.name !== 'cave_air' && blk.name !== 'water' && blk.name !== 'lava') {
              plan.push(p)
            }
          }
        }
      }
      watchdog.setMode('TASK_ACTIVE', `clear r=${r}`)
      sendResponse(sender, `Clearing radius ${r} (${plan.length} solid blocks)...`, isWhisper)
      executeDeconstruction(bot, plan, sender, isWhisper, sendResponse, supervisor, safeNav)
        .then(() => watchdog.setMode('IDLE'))
        .catch(() => watchdog.setMode('IDLE'))
      return true
    }
    case 'house': {
      if (activePatrolInterval) {
        clearInterval(activePatrolInterval)
        activePatrolInterval = null
      }
      const sub = (args[0] || 'status').toLowerCase()
      const origin = new Vec3(-240, 65, 100)
      if (sub === 'clear' || sub === 'excavate') {
        const sector = args[1] || bot.username || 'all'
        const plan = generateHouseClearancePlan(origin, { bot, sector, height: 4, includeFloor: true })
        watchdog.setMode('TASK_ACTIVE', `house clear ${sector}`)
        sendResponse(sender, `Excavating 20x20 house footprint [sector: ${sector}] at (${origin.x}, ${origin.y}, ${origin.z}) [${plan.length} blocks]...`, isWhisper)
        executeDeconstruction(bot, plan, sender, isWhisper, sendResponse, supervisor, safeNav)
          .then((cleared) => {
            sendResponse(sender, `Cleared ${cleared} blocks! Resuming house perimeter patrol.`, isWhisper)
            startPatrolLoop(12, origin)
          })
          .catch(() => startPatrolLoop(12, origin))
        return true
      } else if (sub === 'build') {
        const fullPlan = generateHouse20x20Plan(origin)
        const foundationPlan = fullPlan.filter(v => v.layer <= 1)
        watchdog.setMode('TASK_ACTIVE', 'house build')
        sendResponse(sender, `Constructing 20x20 house at (${origin.x}, ${origin.y}, ${origin.z}) (${foundationPlan.length} foundation blocks)...`, isWhisper)
        const runner = new AutonomousArchitectureRunner(bot, { safeNav })
        let lastReport = 0
        runner.executePlan(foundationPlan, {
          onProgress: p => {
            if (p.placed > lastReport && p.placed % 10 === 0) {
              lastReport = p.placed
              sendResponse(sender, `House build progress: ${p.placed}/${foundationPlan.length} blocks`, isWhisper)
            }
          }
        }).then(res => {
          sendResponse(sender, `House build: Placed ${res.placed} blocks. Resuming perimeter patrol.`, isWhisper)
          startPatrolLoop(12, origin)
        }).catch(err => {
          sendResponse(sender, `House build error: ${err.message}`, isWhisper)
          startPatrolLoop(12, origin)
        })
        return true
      } else if (sub === 'plan') {
        const fullPlan = generateHouse20x20Plan(origin)
        sendResponse(sender, `20x20 Survival House Plan: Origin (${origin.x}, ${origin.y}, ${origin.z}), 22x22 footprint, 11 height, ${fullPlan.length} total voxels (400 foundation).`, isWhisper)
        return true
      } else {
        const pending = generateHouseClearancePlan(origin, { bot, height: 4, includeFloor: true })
        sendResponse(sender, `House site at (${origin.x}, ${origin.y}, ${origin.z}): ${pending.length} blocks remaining to clear before foundation. Use '!house clear' or '!house build'.`, isWhisper)
        return true
      }
    }
    case 'build': {
      if (activePatrolInterval) {
        clearInterval(activePatrolInterval)
        activePatrolInterval = null
      }
      const type = (args[0] || 'wall').toLowerCase()
      if (type === 'house') {
        const origin = new Vec3(-240, 65, 100)
        const fullPlan = generateHouse20x20Plan(origin)
        const foundationPlan = fullPlan.filter(v => v.layer <= 1)
        watchdog.setMode('TASK_ACTIVE', 'build house')
        sendResponse(sender, `Building 20x20 house at (${origin.x}, ${origin.y}, ${origin.z}) (${foundationPlan.length} blocks)...`, isWhisper)
        const runner = new AutonomousArchitectureRunner(bot, { safeNav })
        runner.executePlan(foundationPlan).then(res => {
          sendResponse(sender, `Built ${res.placed} blocks of house.`, isWhisper)
          watchdog.setMode('IDLE')
        }).catch(err => {
          sendResponse(sender, `Build error: ${err.message}`, isWhisper)
          watchdog.setMode('IDLE')
        })
        return true
      }
      const mat = (args[1] || 'dirt').toLowerCase()
      const size = parseInt(args[2], 10) || 3
      watchdog.setMode('TASK_ACTIVE', `build ${type} ${mat}`)
      sendResponse(sender, `Building ${type} of ${mat} (size: ${size})...`, isWhisper)
      executeStructureBuild(bot, type, mat, size, sender, isWhisper, sendResponse)
        .then(() => watchdog.setMode('IDLE'))
        .catch(() => watchdog.setMode('IDLE'))
      return true
    }
    case 'standby':
    case 'stay':
    case 'stop': {
      if (activePatrolInterval) {
        clearInterval(activePatrolInterval)
        activePatrolInterval = null
      }
      incentiveEngine.stop()
      safeNav.stop()
      supervisor.abort()
      if (bot.pathfinder) bot.pathfinder.setGoal(null)
      watchdog.setMode('STANDBY', 'Commanded standby')
      sendResponse(sender, 'Standing by.', isWhisper)
      return true
    }
    case 'afk': {
      const target = args[0] || 'farm'
      incentiveEngine.stop()
      safeNav.stop()
      supervisor.abort()
      if (bot.pathfinder) bot.pathfinder.setGoal(null)
      watchdog.setMode('AFK_FARM', `AFK at ${target}`)
      sendResponse(sender, `AFK mode active (${target}). Standing still intentionally.`, isWhisper)
      return true
    }
    case 'watchdog':
    case 'alert':
    case 'alerts':
    case 'idle': {
      const st = watchdog.queryStatus()
      try {
        fs.writeFileSync(`/dev/shm/mc-bot/${bot.username || 'bot'}.alert`, JSON.stringify(st, null, 2))
      } catch {}
      const tag = st.isAlerting ? '⚠️ [ALERTING]' : '✓ [OK]'
      const exemptTag = st.isExempt ? ` (EXEMPT: ${st.mode})` : ''
      sendResponse(sender, `${tag} Mode: ${st.mode}${exemptTag} | Still: ${st.stationaryDurationSec}s | Task: ${st.activeTask || 'none'}`, isWhisper)
      return true
    }
    case 'status': {
      const health = Math.round(bot.health !== undefined ? bot.health : incentiveEngine.simulatedHealth)
      const food = Math.round(bot.food !== undefined ? bot.food : incentiveEngine.simulatedFood)
      const pos = bot.entity ? bot.entity.position.floored() : 'unknown'
      const invList = bot.inventory.items().map(i => `${i.name}x${i.count}`).join(', ') || 'empty'
      const chunkCount = bot.world?.getColumns ? bot.world.getColumns().length : 0
      sendResponse(sender, `Health: ${health}/20 | Food: ${food}/20 | Pos: ${pos} | Credits: ${incentiveEngine.laborCredits} | Slack: ${Math.round(incentiveEngine.slackingSeconds)}s | Inv: [${invList}] | Chunks: ${chunkCount} | AI: ${aiAgent.tokenTotals.total}t (${aiAgent.tokenTotals.calls}c)`, isWhisper)
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
    case 'lang':
    case 'language': {
      const targetLang = (args[0] || '').toLowerCase()
      if (!targetLang || targetLang === 'status') {
        const available = supervisor.nlpTranslator.localeLoader.getAvailableLanguages().join(', ')
        sendResponse(sender, `Current NLP language: '${supervisor.nlpTranslator.language}'. Available locales: [auto, ${available}]`, isWhisper)
        return true
      }
      supervisor.setLanguage(targetLang)
      sendResponse(sender, `Switched NLP language pack to '${targetLang}'`, isWhisper)
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
      const survey = formatEntitySurvey(bot, 24)
      const humansStr = survey.humans.length ? `Humans: [${survey.humans.join(', ')}]` : 'Humans: none'
      const squadStr = survey.squad.length ? `Squad: [${survey.squad.join(', ')}]` : 'Squad: none'
      const mobsStr = survey.mobs.length ? `Mobs: [${survey.mobs.slice(0, 4).join(', ')}]` : 'Mobs: none'
      sendResponse(sender, `At (${bPos.x}, ${bPos.y}, ${bPos.z}) [${standingOn}]. ${humansStr} | ${squadStr} | ${mobsStr}`, isWhisper)
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
      watchdog.setMode('TASK_ACTIVE', 'bootstrap')
      sendResponse(sender, 'Starting tool tech tree progression...', isWhisper)
      bootstrapTools(bot, { log: m => console.log(m) })
        .then(res => sendResponse(sender, res.message || 'Tools bootstrapped!', isWhisper))
        .catch(err => sendResponse(sender, `Bootstrap error: ${err.message}`, isWhisper))
      return true
    }
    case 'farm': {
      watchdog.setMode('TASK_ACTIVE', 'farm')
      sendResponse(sender, 'Tilling and planting 9x9 hydrated farm...', isWhisper)
      establishHydratedFarm(bot, null, { log: m => console.log(m) })
        .then(res => sendResponse(sender, `Farm established! Tilled: ${res.tilled}, Planted: ${res.planted}`, isWhisper))
        .catch(err => sendResponse(sender, `Farm error: ${err.message}`, isWhisper))
      return true
    }
    case 'harvest': {
      watchdog.setMode('TASK_ACTIVE', 'harvest')
      sendResponse(sender, 'Harvesting and replanting mature crops...', isWhisper)
      harvestAndReplant(bot, { log: m => console.log(m) })
        .then(res => sendResponse(sender, `Harvest complete! Reaped: ${res.harvested}, Replanted: ${res.replanted}, Bread: ${res.bakedBread}`, isWhisper))
        .catch(err => sendResponse(sender, `Harvest error: ${err.message}`, isWhisper))
      return true
    }
    case 'feed': {
      watchdog.setMode('TASK_ACTIVE', `feed ${args[0] || sender}`)
      const target = args[0] || sender
      const depot = new SquadNutritionDepot(bot)
      depot.distributeRations(target, 8, safeNav)
        .then(res => sendResponse(sender, res.success ? `Gave ${res.count} bread to ${target}!` : `Could not feed: ${res.reason}`, isWhisper))
        .catch(err => sendResponse(sender, `Feed error: ${err.message}`, isWhisper))
      return true
    }
    case 'help': {
      sendResponse(sender, `Fast cmds: !jojo, !squad, !come, !goto <x y z>, !survey, !swing, !break, !inspect, !interact <type>, !give <item>, !clear <r>, !setmark <n>, !gotomark <n>, !marks, !mine, !build, !bootstrap, !farm, !harvest, !feed, !afk <target>, !watchdog, !stop.`, isWhisper)
      return true
    }
  }
  return false
}

// 7. Inbound Chat Router (delegated to ChatMessageRouter for ambient commander gate & DI testing)
export const chatRouter = new ChatMessageRouter({
  botName: username || bot.username || 'Companion',
  isMastermind: Boolean(personality?.smartest || personality?.role === 'commander'),
  getIsAlive: () => Boolean(bot.entity && bot.isAlive && (bot.health === undefined || bot.health > 0)),
  isSquadBot: (sender, selfName) => isSquadBot(sender, selfName),
  sendResponse,
  onSlashCommand: (slashCmd) => {
    console.log(`[SLASH CMD] Dispatching in-game slash command: ${slashCmd}`)
    bot.chat(slashCmd)
  },
  onFastCommand: (sender, cmd, args, isWhisper) => handleFastCommand(sender, cmd, args, isWhisper),
  onTranslate: (sender, msg) => supervisor.translateNaturalLanguage(sender, msg),
  onDispatchIpc: (targetAgent, cmd) => IpcManager.dispatchCommand(targetAgent, cmd),
  onAiQuery: (sender, msg, isWhisper) => aiAgent.query(sender, msg, isWhisper)
})

export function handleMessage(sender, rawMessage, isWhisper, isIpc = false) {
  if (!bot.entity && !isIpc) return
  chatRouter.botName = username || bot.username || 'Companion'
  console.log(`[CHAT IN] [${isWhisper ? 'WHISPER' : 'PUBLIC'}] <${sender}>: ${String(rawMessage || '').trim()}`)
  return chatRouter.route(sender, rawMessage, isWhisper, isIpc).catch(err => {
    console.error('[!] Error in chatRouter:', err)
  })
}

export function createBotAgentInstance(opts = {}) {
  const instName = opts.username || 'Citizen_1'
  const instRole = (opts.personalityKey || opts.role || 'companion').toLowerCase()
  const instPersonality = PERSONALITIES[instRole] || PERSONALITIES.companion || personality
  const createFn = opts.createBotFn || createBotInstance
  const instBot = createFn({
    host: opts.host || host,
    port: opts.port || port,
    username: instName,
    version: opts.version ?? version,
    viewDistance: opts.viewDistance || 2,
    lightweight: opts.lightweight ?? true,
    storageBuilder: opts.storageBuilder || null
  })
  const instSupervisor = new PrompterSupervisor({ bot: instBot, language: config.language || 'auto' })
  const instRouter = new ChatMessageRouter({
    botName: instName,
    isMastermind: Boolean(instPersonality?.smartest || instPersonality?.role === 'commander'),
    getIsAlive: () => Boolean(instBot.entity && instBot.isAlive !== false && (instBot.health === undefined || instBot.health > 0)),
    isSquadBot: (s, self) => isSquadBot(s, self),
    sendResponse: (target, message, isW) => {
      if (!message) return
      const clean = String(message).replace(/[\n\r]+/g, ' ').slice(0, 100)
      try { isW && target ? instBot.whisper(target, clean) : instBot.chat(clean) } catch {}
    },
    onSlashCommand: (c) => { try { instBot.chat(c) } catch {} },
    onFastCommand: opts.onFastCommand || (async () => false),
    onTranslate: (s, m) => instSupervisor.translateNaturalLanguage(s, m),
    onDispatchIpc: (t, c) => IpcManager.dispatchCommand(t, c, opts.ipcBaseDir),
    onAiQuery: opts.onAiQuery || (() => {})
  })
  const instIpc = opts.enableIpc !== false
    ? new IpcManager(instName, (s, m, w, ipcFlag) => instRouter.route(s, m, w, ipcFlag), { baseDir: opts.ipcBaseDir })
    : null
  if (instIpc && opts.startIpc) instIpc.start()

  return {
    username: instName,
    personality: instPersonality,
    bot: instBot,
    supervisor: instSupervisor,
    chatRouter: instRouter,
    ipc: instIpc,
    stop() {
      if (instIpc) instIpc.stop()
      try { instBot.quit?.() } catch {}
    }
  }
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

  // Auto-engage autonomous incentive engine on spawn if idle
  setTimeout(() => {
    if (watchdog.mode === 'IDLE') {
      incentiveEngine.start(5000)
    }
  }, 3000)
})

bot.on('death', () => {
  incentiveEngine.stop()
  console.log(`[!] Bot '${username}' died in world. Incentive engine halted pending respawn.`)
})

bot.on('respawn', () => {
  setTimeout(() => {
    incentiveEngine.start(5000)
  }, 3000)
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
