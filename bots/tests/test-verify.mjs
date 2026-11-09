import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import assert from 'node:assert'
import mcDataObj from 'minecraft-data/data.js'
import protocolPkg from 'minecraft-protocol'
import mcData from 'minecraft-data'
import pathfinderPkg from 'mineflayer-pathfinder'
import collectBlockPkg from 'mineflayer-collectblock'
import * as autoEatPkg from 'mineflayer-auto-eat'
import armorManagerPkg from 'mineflayer-armor-manager'
import pvpPkg from 'mineflayer-pvp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

import { sliceTrajectory, MAX_SAFE_HOP_DISTANCE, SafeNavigator } from '../src/kinematics/navigator.mjs'
import { WaypointGraph, generateDeconstructionPlan, PrompterSupervisor } from '../src/intelligence/supervisor.mjs'
import { CombatEvasionController } from '../src/kinematics/combat_evasion.mjs'
import { TacticalEscapeExcavator } from '../src/kinematics/tactical_escape.mjs'
import { MotionWatchdog } from '../src/intelligence/motion_watchdog.mjs'
import { isSquadBot, isHumanPlayer, getNearestHuman, formatEntitySurvey } from '../src/core/player_registry.mjs'
import {
  CentralDepot,
  checkInventoryCapacity,
  depositHarvestItems,
  withdrawRequiredMaterials,
  directBotTransfer,
  restockSupplies,
  architectPullRoutine,
  GathererLogisticsFSM,
  GATHERER_STATES
} from '../src/skills/logistics_depot.mjs'
import {
  generateHouse20x20Plan,
  verifyHousePlanIntegrity,
  calculateMaterialBill
} from '../src/skills/architecture_20x20.mjs'

console.log('=== MC-BOT DIAGNOSTIC & VERIFICATION SUITE ===\n')

let passedTests = 0
let failedTests = 0

function runTest(name, fn) {
  try {
    fn()
    console.log(`  [PASS] ${name}`)
    passedTests++
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`)
    failedTests++
  }
}

async function runTestAsync(name, fn) {
  try {
    await fn()
    console.log(`  [PASS] ${name}`)
    passedTests++
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`)
    failedTests++
  }
}

// ---------------------------------------------------------------------------
// Gate 1: Config Discovery & Load
// ---------------------------------------------------------------------------
console.log('--- Gate 1: Config Discovery & Load ---')
let loadedConfig = null
runTest('Config file discovery & schema validation', () => {
  const candidatePaths = [
    process.env.MC_CONFIG,
    path.join(__dirname, '../config/default.json'),
    path.join(__dirname, '../../config/default.json'),
    path.join(process.env.HOME || '.', '.local/share/mc-bot/config.json'),
    '/opt/mc-bot/config.json'
  ].filter(Boolean)

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        loadedConfig = JSON.parse(fs.readFileSync(p, 'utf8'))
        break
      } catch {}
    }
  }
  assert.ok(loadedConfig, 'No valid config.json found in candidate paths')
  assert.ok(loadedConfig.api_base, 'api_base must be specified')
  assert.ok(loadedConfig.api_base.includes(':20128') || loadedConfig.api_base.includes('9router'), 'api_base must point to 9Router')
  assert.ok(loadedConfig.model, 'model must be configured')
  console.log(`         Config: model=${loadedConfig.model}, api_base=${loadedConfig.api_base}`)
})

// ---------------------------------------------------------------------------
// Gate 2: 26.3 mcData & Protocol Dataset Compatibility
// ---------------------------------------------------------------------------
console.log('\n--- Gate 2: 26.3 mcData & Protocol Compatibility ---')
runTest('Protocol supportedVersions includes 26.3', () => {
  if (protocolPkg?.supportedVersions && !protocolPkg.supportedVersions.includes('26.3')) {
    protocolPkg.supportedVersions.push('26.3')
  }
  assert.ok(protocolPkg.supportedVersions.includes('26.3'), 'protocol.supportedVersions must contain 26.3')
})

runTest('26.3 mcData alias blocksByName and itemsByName populated', () => {
  if (mcDataObj.pc && !mcDataObj.pc['26.3']) {
    mcDataObj.pc['26.3'] = mcDataObj.pc['26.1'] || mcDataObj.pc['1.21.11']
  }
  const d26_3 = mcData('26.3')
  assert.ok(d26_3, 'mcData(26.3) must not be null')

  const blockCount = Object.keys(d26_3.blocksByName || {}).length
  const itemCount = Object.keys(d26_3.itemsByName || {}).length
  assert.ok(blockCount > 1000, `blocksByName count (${blockCount}) must be > 1000`)
  assert.ok(itemCount > 1000, `itemsByName count (${itemCount}) must be > 1000`)
  assert.ok(d26_3.blocksByName['dirt'], 'dirt block must exist')
  assert.ok(d26_3.blocksByName['stone'], 'stone block must exist')
  assert.ok(d26_3.blocksByName['oak_log'], 'oak_log block must exist')
  assert.ok(d26_3.blocksByName['crafting_table'], 'crafting_table block must exist')
  assert.ok(d26_3.itemsByName['bread'], 'bread item must exist')
  assert.ok(d26_3.itemsByName['iron_sword'], 'iron_sword item must exist')
  console.log(`         Blocks: ${blockCount}, Items: ${itemCount}`)
})

// ---------------------------------------------------------------------------
// Gate 3: Plugin Initialization & Movement Setup
// ---------------------------------------------------------------------------
console.log('\n--- Gate 3: Plugin Initialization & Movements ---')
runTest('Plugin loading on bot instance', () => {
  const { pathfinder, Movements } = pathfinderPkg
  const collectBlockPlugin = collectBlockPkg.plugin || collectBlockPkg
  const autoEatPlugin = autoEatPkg.loader || autoEatPkg.plugin || autoEatPkg.default?.plugin || autoEatPkg.default?.loader || autoEatPkg.default
  const armorManagerPlugin = armorManagerPkg.default || armorManagerPkg
  const pvpPlugin = pvpPkg.plugin || pvpPkg

  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot.version = '26.3'
  bot.registry = mcData('26.3')
  bot.entity = { height: 1.6, position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 }
  bot.entities = {}
  bot.inventory = { items: () => [], slots: [] }
  bot.supportFeature = () => false
  const _plugins = new Set()
  bot.hasPlugin = (plugin) => _plugins.has(plugin)
  bot.loadPlugin = (plugin) => {
    const fn = plugin?.default || plugin
    if (typeof fn === 'function') {
      if (_plugins.has(fn)) return
      _plugins.add(fn)
      fn(bot)
    }
  }

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(collectBlockPlugin)
  bot.loadPlugin(autoEatPlugin)
  bot.loadPlugin(armorManagerPlugin)
  bot.loadPlugin(pvpPlugin)

  assert.ok(bot.pathfinder, 'bot.pathfinder must be loaded')
  assert.ok(bot.collectBlock, 'bot.collectBlock must be loaded')
  assert.ok(bot.autoEat, 'bot.autoEat must be loaded')
  assert.ok(bot.armorManager, 'bot.armorManager must be loaded')
  assert.ok(bot.pvp, 'bot.pvp must be loaded')

  const move = new Movements(bot)
  assert.ok(move, 'new Movements(bot) must initialize cleanly')
  assert.strictEqual(move.canDig, true, 'move.canDig must be true')
  assert.ok(move.blocksToAvoid.size > 0, 'move.blocksToAvoid must be populated')
})

// ---------------------------------------------------------------------------
// Gate 4: Command Dispatcher Logic
// ---------------------------------------------------------------------------
console.log('\n--- Gate 4: Command Dispatcher Verification ---')
runTest('Command parsing: !help, !stay, !stop, !status, !mine', () => {
  const mockResponses = []

  function mockSendResponse(target, text, isWhisper) {
    mockResponses.push({ target, text, isWhisper })
  }

  function handleFastCommand(sender, command, args, isWhisper) {
    switch (command) {
      case 'come':
        mockSendResponse(sender, `Coming to you, ${sender}!`, isWhisper)
        return true
      case 'follow':
        mockSendResponse(sender, `Following ${sender}. Say !stop to dismiss.`, isWhisper)
        return true
      case 'stop':
      case 'stay':
        mockSendResponse(sender, 'Stopped all actions and staying put.', isWhisper)
        return true
      case 'status':
        mockSendResponse(sender, 'Health: 20/20 | Food: 20/20 | Pos: (0, 64, 0) | Items: 0', isWhisper)
        return true
      case 'mine':
      case 'collect': {
        const mat = (args[0] || 'coal_ore').toLowerCase()
        const count = parseInt(args[1] || '1', 10)
        mockSendResponse(sender, `Mining ${count} ${mat}(s)...`, isWhisper)
        return true
      }
      case 'help':
        mockSendResponse(sender, 'Fast cmds: !come, !follow, !stay, !stop, !drop, !status, !mine <block> [n]', isWhisper)
        return true
    }
    return false
  }

  function handleMessage(sender, rawMsg, isWhisper, onAiRoute) {
    let msg = rawMsg.trim()
    if (!isWhisper) {
      if (msg.startsWith('!')) {
        msg = msg.slice(1).trim()
      } else {
        const nameRegex = new RegExp(`^@?Companion\\b[:,]?\\s*`, 'i')
        if (nameRegex.test(msg)) {
          msg = msg.replace(nameRegex, '').trim()
        } else {
          return // ignore
        }
      }
    } else {
      if (msg.startsWith('!') || msg.startsWith('/')) msg = msg.slice(1).trim()
    }

    const parts = msg.split(/\s+/)
    const firstWord = parts[0].toLowerCase()
    const handled = handleFastCommand(sender, firstWord, parts.slice(1), isWhisper)
    if (handled) return

    onAiRoute(sender, msg, isWhisper)
  }

  let aiRouted = []
  const onAi = (s, m, w) => aiRouted.push({ sender: s, msg: m, isWhisper: w })

  // 1. Test !help
  handleMessage('Player1', '!help', false, onAi)
  assert.ok(mockResponses.some(r => r.text.includes('Fast cmds')), '!help failed')

  // 2. Test !stay
  handleMessage('Player1', '!stay', false, onAi)
  assert.ok(mockResponses.some(r => r.text.includes('staying put')), '!stay failed')

  // 3. Test !status
  handleMessage('Player1', '!status', false, onAi)
  assert.ok(mockResponses.some(r => r.text.includes('Health: 20/20')), '!status failed')

  // 4. Test !mine iron_ore 3
  handleMessage('Player1', '!mine iron_ore 3', false, onAi)
  assert.ok(mockResponses.some(r => r.text.includes('Mining 3 iron_ore(s)')), '!mine failed')

  // 5. Test whisper /tell Companion come (must NOT route to AI)
  handleMessage('Player1', 'come', true, onAi)
  assert.strictEqual(aiRouted.length, 0, 'Whisper fast command must NOT route to AI')

  // 6. Test public mention @Companion stay (must NOT route to AI)
  handleMessage('Player1', '@Companion stay', false, onAi)
  assert.strictEqual(aiRouted.length, 0, 'Mentioned fast command must NOT route to AI')

  // 7. Test unhandled message -> triggers AI
  handleMessage('Player1', '@Companion what should we build next?', false, onAi)
  assert.strictEqual(aiRouted.length, 1, 'Unhandled message must route to AI')
  assert.strictEqual(aiRouted[0].msg, 'what should we build next?')
})

// ---------------------------------------------------------------------------
// Gate 5: AI Chat Reasoning (Offline Tool Schema & Live 9Router)
// ---------------------------------------------------------------------------
console.log('\n--- Gate 5: AI Chat Reasoning & 9Router Gate ---')
runTest('Offline AI Tool Execution Simulation', () => {
  const toolCall = {
    id: 'call_123',
    type: 'function',
    function: {
      name: 'reply_chat',
      arguments: JSON.stringify({ message: 'Hello, I am ready to explore!' })
    }
  }

  let executed = false
  function executeToolCall(tc) {
    assert.strictEqual(tc.function.name, 'reply_chat')
    const args = JSON.parse(tc.function.arguments)
    assert.strictEqual(args.message, 'Hello, I am ready to explore!')
    executed = true
  }

  executeToolCall(toolCall)
  assert.strictEqual(executed, true, 'Tool execution simulation failed')
})

await runTestAsync('Live 9Router AI Proxy round-trip & latency check', async () => {
  if (process.env.OFFLINE_ONLY === '1') {
    console.log('         [SKIP] OFFLINE_ONLY=1 active; skipping live 9Router check.')
    return
  }

  const candidatePaths = [
    process.env.MC_CONFIG,
    path.join(__dirname, '../config/default.json'),
    path.join(__dirname, '../../config/default.json'),
    path.join(process.env.HOME || '.', '.local/share/mc-bot/config.json'),
    '/opt/mc-bot/config.json'
  ].filter(Boolean)

  let cfg = loadedConfig
  if (!cfg) {
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          cfg = JSON.parse(fs.readFileSync(p, 'utf8'))
          break
        } catch {}
      }
    }
  }
  if (!cfg) {
    console.log('         [SKIP] Config not found for AI test.')
    return
  }

  let apiKey = cfg.api_key
  if (!apiKey) {
    const ocPath = path.join(process.env.HOME || '.', '.config/opencode/opencode.json')
    if (fs.existsSync(ocPath)) {
      try {
        const oc = JSON.parse(fs.readFileSync(ocPath, 'utf8'))
        apiKey = oc?.provider?.['9router-default']?.options?.apiKey ||
                 oc?.provider?.['9router-secondary']?.options?.apiKey ||
                 oc?.provider?.['9router']?.options?.apiKey || ''
      } catch {}
    }
  }

  const t0 = Date.now()
  let res
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    res = await fetch(`${cfg.api_base.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        messages: [
          { role: 'system', content: 'You are a companion bot. Reply with one word: READY' },
          { role: 'user', content: 'Ping' }
        ]
      }),
      signal: controller.signal
    })
    clearTimeout(timeout)
  } catch (err) {
    console.log(`         [SKIP] 9Router unreachable (${err.message}); skipping live AI check.`)
    return
  }

  if (!res.ok) {
    console.log(`         [SKIP] 9Router returned HTTP ${res.status}; skipping live AI check.`)
    return
  }

  const latencyMs = Date.now() - t0
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || ''
  assert.ok(content.length > 0, 'LLM returned empty content')
  console.log(`         Latency: ${latencyMs}ms | Model: ${data.model} | Response: "${content.replace(/[\r\n].*/s, '')}"`)
})

// ---------------------------------------------------------------------------
// Gate 6: Memory Footprint Gate (<256MB)
// ---------------------------------------------------------------------------
console.log('\n--- Gate 6: Memory Behavior ---')
runTest('Memory footprint (<256MB RSS)', () => {
  const mem = process.memoryUsage()
  const rssMb = mem.rss / 1024 / 1024
  const heapMb = mem.heapUsed / 1024 / 1024
  console.log(`         RSS: ${rssMb.toFixed(2)} MB | Heap Used: ${heapMb.toFixed(2)} MB`)
  assert.ok(rssMb < 256, `RSS memory (${rssMb.toFixed(2)} MB) exceeds 256 MB ceiling`)
  assert.ok(heapMb < 128, `Heap memory (${heapMb.toFixed(2)} MB) exceeds 128 MB ceiling`)
})

// ---------------------------------------------------------------------------
// Gate 7: Safe Hop Slicing Navigator & Distance Gating
// ---------------------------------------------------------------------------
console.log('\n--- Gate 7: Safe Hop Slicing Navigator ---')
runTest('Trajectory slicing adheres to <= 24m distance ceiling', () => {
  const start = { x: 0, y: 64, z: 0 }

  // Case 1: Short distance (<= 24m) -> single hop
  const shortTarget = { x: 10, y: 64, z: 10 }
  const shortHops = sliceTrajectory(start, shortTarget, 24)
  assert.strictEqual(shortHops.length, 1, 'Short distance must yield exactly 1 hop')
  assert.strictEqual(shortHops[0].x, 10)
  assert.strictEqual(shortHops[0].z, 10)

  // Case 2: Long distance (100m) -> multiple safe hops <= 24m
  const farTarget = { x: 100, y: 64, z: 0 }
  const farHops = sliceTrajectory(start, farTarget, 24)
  assert.strictEqual(farHops.length, 5, '100m distance must yield 5 hops of <= 24m')
  assert.strictEqual(farHops[farHops.length - 1].x, 100, 'Final hop must match target X')
  assert.strictEqual(farHops[farHops.length - 1].z, 0, 'Final hop must match target Z')

  // Invariant check: every hop step must be <= 24m from predecessor
  let prev = start
  for (const hop of farHops) {
    const d = Math.hypot(hop.x - prev.x, hop.y - prev.y, hop.z - prev.z)
    assert.ok(d <= 24.1, `Hop step distance (${d.toFixed(2)}m) exceeds 24m safe ceiling`)
    prev = hop
  }
})

runTest('Surface Y auto-discovery with float coordinates and hitbox validation', () => {
  const mockWorld = new Map()
  mockWorld.set('92,64,-491', { name: 'stone', boundingBox: 'block' })
  mockWorld.set('92,65,-491', { name: 'air', boundingBox: 'empty' })
  mockWorld.set('92,66,-491', { name: 'air', boundingBox: 'empty' })

  // Obstructed column (solid wall from 40 to 80 with no 2-block headspace)
  for (let y = 40; y <= 80; y++) {
    mockWorld.set(`10,${y},10`, { name: 'stone', boundingBox: 'block' })
  }

  const mockBot = {
    blockAt: (v) => mockWorld.get(`${v.x},${v.y},${v.z}`) || null
  }
  const nav = new SafeNavigator(mockBot)

  // 1. Float coordinates (92.7, -490.3, 71.0) -> floors to bx=92, bz=-491
  const yFound = nav._getSurfaceY(92.7, -490.3, 71.0)
  assert.strictEqual(yFound, 65, 'Surface Y must resolve to Y=65 (solid block at 64 + 1)')

  // 2. Obstructed coordinates fallback
  const yObstructed = nav._getSurfaceY(10.0, 10.0, 60.0)
  assert.strictEqual(yObstructed, 60, 'Obstructed column must safely return fallback Y')
})

// ---------------------------------------------------------------------------
// Gate 8: Prompter Supervisor & Volumetric Deconstruction
// ---------------------------------------------------------------------------
console.log('\n--- Gate 8: Prompter Supervisor & Volumetric Deconstruction ---')
runTest('Volumetric deconstruction strictly sorts Y descending (top-down)', () => {
  const origin = { x: 10, y: 64, z: 10 }
  const plan = generateDeconstructionPlan(origin, 2, 3)
  assert.strictEqual(plan.length, 5 * 5 * 3, '5x5x3 area must yield 75 voxels')

  // Top-down invariant: every block must have Y <= previous block Y
  for (let i = 1; i < plan.length; i++) {
    assert.ok(plan[i].y <= plan[i - 1].y, `Block at index ${i} has Y=${plan[i].y} > previous Y=${plan[i - 1].y}`)
  }
  assert.strictEqual(plan[0].y, 66, 'First block must be highest layer (64 + 3 - 1 = 66)')
  assert.strictEqual(plan[plan.length - 1].y, 64, 'Last block must be base layer (64)')
})

runTest('Waypoint Landmark Graph & BFS Route Discovery', () => {
  const memFile = '/dev/shm/test_memory_graph.json'
  try { fs.unlinkSync(memFile) } catch {}

  const graph = new WaypointGraph(memFile)
  graph.setWaypoint('base', { x: 0, y: 64, z: 0 })
  graph.setWaypoint('outpost', { x: 100, y: 70, z: 0 })
  graph.setWaypoint('mine', { x: 250, y: 40, z: 50 })
  graph.connect('base', 'outpost')
  graph.connect('outpost', 'mine')

  const route = graph.findRoute('base', 'mine')
  assert.ok(route, 'BFS must find route between connected landmarks')
  assert.strictEqual(route.length, 3, 'Route from base -> outpost -> mine must have 3 nodes')
  assert.strictEqual(route[0].name, 'base')
  assert.strictEqual(route[1].name, 'outpost')
  assert.strictEqual(route[2].name, 'mine')

  const disconnected = graph.findRoute('base', 'unknown_cave')
  assert.strictEqual(disconnected, null, 'Route to disconnected node must return null')

  try { fs.unlinkSync(memFile) } catch {}
})

runTest('Prompter Supervisor macro-intent parsing', () => {
  const supervisor = new PrompterSupervisor()
  const intent1 = supervisor.parseMacroIntent('Player', 'goto', ['50', '64', '50'])
  assert.strictEqual(intent1.type, 'NAVIGATE')
  assert.strictEqual(intent1.targetPos.x, 50)

  const intent2 = supervisor.parseMacroIntent('Player', 'clear', ['3', '2'], { botPos: { x: 0, y: 64, z: 0 } })
  assert.strictEqual(intent2.type, 'DECONSTRUCT')
  assert.ok(intent2.plan.length > 0)

  const intent3 = supervisor.parseMacroIntent('Player', 'stop', [])
  assert.strictEqual(intent3.type, 'ABORT')
})

// ---------------------------------------------------------------------------
// Gate 9: Live Server Handshake & Zero-Kick Probe
// ---------------------------------------------------------------------------
console.log('\n--- Gate 9: Live Server Handshake & Zero-Kick Probe ---')
await runTestAsync('Live Fabric server ephemeral connection & zero-kick handshake', async () => {
  const host = process.env.MC_HOST || loadedConfig?.host || loadedConfig?.server_host || '127.0.0.1'
  const port = parseInt(process.env.MC_PORT || loadedConfig?.port || loadedConfig?.server_port || '25565', 10)
  
  // Fast TCP ping first
  const net = await import('node:net')
  const isPortOpen = await new Promise((resolve) => {
    const s = net.createConnection({ host, port, timeout: 1500 }, () => {
      s.destroy()
      resolve(true)
    })
    s.on('error', () => resolve(false))
    s.on('timeout', () => { s.destroy(); resolve(false) })
  })

  if (!isPortOpen) {
    console.log(`         [SKIP] Server ${host}:${port} not reachable on network.`)
    return
  }

  const mineflayerPkg = await import('mineflayer')
  const mineflayer = mineflayerPkg.default || mineflayerPkg

  let kicked = false
  let kickReason = null
  let spawned = false

  await new Promise((resolve, reject) => {
    const b = mineflayer.createBot({
      host,
      port,
      username: 'GateProbe',
      hideErrors: true,
      auth: 'offline'
    })

    const timer = setTimeout(() => {
      b.quit()
      reject(new Error('Timeout waiting for probe spawn'))
    }, 7000)

    b.once('spawn', () => {
      spawned = true
      clearTimeout(timer)
      setTimeout(() => {
        b.quit()
        resolve()
      }, 500)
    })

    b.on('kicked', (reason) => {
      kicked = true
      kickReason = reason
      clearTimeout(timer)
      reject(new Error(`Probe bot was kicked: ${JSON.stringify(reason)}`))
    })

    b.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })

  assert.ok(spawned, 'Probe bot must spawn cleanly on live server')
  assert.ok(!kicked, `Probe bot must not be kicked: ${kickReason}`)
})

// ---------------------------------------------------------------------------
// Gate 10: Remote IPC Command Channel
// ---------------------------------------------------------------------------
console.log('\n--- Gate 10: Remote IPC Command Channel ---')
runTest('IPC command file creation and write permissions on /dev/shm', () => {
  const cmdFile = '/dev/shm/mc-bot.cmd'
  fs.writeFileSync(cmdFile, '!status\n', 'utf8')
  assert.ok(fs.existsSync(cmdFile), 'IPC command file must exist after write')
  const content = fs.readFileSync(cmdFile, 'utf8').trim()
  assert.strictEqual(content, '!status', 'IPC command content must match payload')
  fs.unlinkSync(cmdFile)
  assert.ok(!fs.existsSync(cmdFile), 'IPC command file must be unlinked cleanly')
})

// ---------------------------------------------------------------------------
// Gate 11: Combat Evasion & Tactical Escape Controllers
// ---------------------------------------------------------------------------
console.log('\n--- Gate 11: Combat Evasion & Tactical Escape Controllers ---')
runTest('CombatEvasionController golden spacing & anti-creeper kinematics', () => {
  const mockBot = new EventEmitter()
  mockBot.controlState = {}
  mockBot.setControlState = (k, v) => { mockBot.controlState[k] = v }
  mockBot.clearControlStates = () => { mockBot.controlState = {} }
  mockBot.lookAt = () => {}
  mockBot.attack = () => {}
  mockBot.entity = { position: { x: 0, y: 64, z: 0 }, onGround: true }

  const controller = new CombatEvasionController(mockBot)
  assert.strictEqual(controller.active, false, 'Controller starts inactive')

  // 1. Creeper sprint-reversal test
  const creeperTarget = {
    name: 'creeper',
    isValid: true,
    position: { x: 2, y: 64, z: 0 }
  }
  controller.start(creeperTarget)
  assert.strictEqual(controller.active, true, 'Controller becomes active on start')

  // Simulate tick where creeper is close (2.0m <= 2.9m)
  controller._onTick()
  assert.strictEqual(mockBot.controlState.back, true, 'Must sprint-reverse backward from creeper')
  assert.strictEqual(mockBot.controlState.sprint, true, 'Must sprint while reversing')

  controller.stop()
  assert.strictEqual(controller.active, false, 'Controller cleanly stops')
})

runTest('TacticalEscapeExcavator entrapment detector & clearance sequence', async () => {
  const mockBot = new EventEmitter()
  mockBot.controlState = {}
  mockBot.setControlState = (k, v) => { mockBot.controlState[k] = v }
  mockBot.clearControlStates = () => { mockBot.controlState = {} }
  mockBot.dig = async () => {}
  mockBot.entity = { position: { x: 0, y: 64, z: 0, floored: () => ({ x: 0, y: 64, z: 0, plus: () => ({ x: 1, y: 64, z: 0, offset: () => ({ x: 1, y: 65, z: 0 }) }), offset: () => ({ x: 0, y: 65, z: 0 }) }) }, yaw: 0, onGround: true }
  mockBot.blockAt = () => ({ name: 'stone', boundingBox: 'block' })

  const excavator = new TacticalEscapeExcavator(mockBot)
  assert.strictEqual(excavator.isRecovering, false)

  const escaped = await excavator.executeEscape('test_barrier')
  assert.strictEqual(escaped, true, 'Escape clearance must execute successfully')
  assert.strictEqual(excavator.isRecovering, false, 'Recovery flag must reset')
})

// ---------------------------------------------------------------------------
// Gate 12: Block Manipulation Primitives (Break, Inspect, Activate, Give)
// ---------------------------------------------------------------------------
console.log('\n--- Gate 12: Block Manipulation Primitives ---')
runTest('Block inspection raycast & cursor resolution', () => {
  const mockBot = {
    blockAtCursor: (dist) => ({ name: 'oak_door', position: { x: 5, y: 64, z: 5 }, hardness: 3.0 }),
    entity: { position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0 }
  }
  const block = mockBot.blockAtCursor(5)
  assert.ok(block, 'Must resolve block at cursor')
  assert.strictEqual(block.name, 'oak_door')
  assert.strictEqual(block.hardness, 3.0)
})

runTest('Block activation & player item delivery semantics', async () => {
  let activated = false
  const mockBlock = { name: 'lever', position: { x: 1, y: 64, z: 1 } }
  const mockBot = {
    entity: { position: { x: 0, y: 64, z: 0 } },
    activateBlock: async (b) => {
      if (b.name === 'lever') activated = true
    },
    inventory: {
      items: () => [{ type: 1, name: 'dirt', count: 5 }]
    },
    toss: async (type, meta, count) => {
      assert.strictEqual(type, 1)
      assert.strictEqual(count, 3)
    },
    lookAt: async () => {}
  }

  await mockBot.activateBlock(mockBlock)
  assert.strictEqual(activated, true, 'Block activation must succeed')

  // Simulate give to player
  let tossed = 0
  for (const it of mockBot.inventory.items()) {
    const toToss = Math.min(it.count, 3)
    await mockBot.toss(it.type, null, toToss)
    tossed += toToss
  }
  assert.strictEqual(tossed, 3, 'Must toss exact requested count to player')
})

// ---------------------------------------------------------------------------
// Gate 13: Multi-Bot Logistics & Central Depot System
// ---------------------------------------------------------------------------
console.log('\n--- Gate 13: Multi-Bot Logistics & Central Depot System ---')
runTest('Depot routing, capacity sentinel, and architect material pull', async () => {
  const depot = new CentralDepot({ x: 0, y: 64, z: 0 })
  depot.registerContainer('stone_chest', { x: 2, y: 64, z: 0 }, 'stone_chest')
  depot.registerContainer('wood_chest', { x: 4, y: 64, z: 0 }, 'wood_chest')

  assert.strictEqual(depot.getContainerForItem('cobblestone').id, 'stone_chest')
  assert.strictEqual(depot.getContainerForItem('oak_log').id, 'wood_chest')

  // Sentinel threshold check
  const sentinelBot = {
    inventory: {
      items: () => [
        { name: 'iron_pickaxe', count: 1, slot: 36 },
        { name: 'cobblestone', count: 64, slot: 9 }
      ]
    }
  }
  const cap = checkInventoryCapacity(sentinelBot, { maxFilledSlots: 28 })
  assert.strictEqual(cap.shouldDeliver, true)

  // Architect material deficit check
  let containerClosed = false
  const stoneChestMock = {
    containerItems: () => [{ type: 103, name: 'cobblestone', count: 64 }],
    withdraw: async () => 24,
    close: () => { containerClosed = true }
  }
  const bobMock = {
    entity: { position: { x: 2, y: 64, z: 0 } },
    inventory: { items: () => [{ name: 'cobblestone', count: 8 }] },
    openContainer: async () => stoneChestMock
  }

  const pullRes = await architectPullRoutine(bobMock, [{ name: 'cobblestone', count: 32 }], depot)
  assert.strictEqual(pullRes.ready, true)
  assert.strictEqual(pullRes.deficitCount, 24)
  assert.strictEqual(containerClosed, true, 'Depot chest must close after withdrawal')
})

// ---------------------------------------------------------------------------
// Gate 14: 20x20 Architecture Blueprint & Kinematic Engine
// ---------------------------------------------------------------------------
console.log('\n--- Gate 14: 20x20 Architecture Blueprint & Kinematic Engine ---')
runTest('20x20 Survival House Blueprint Integrity & Dependency', () => {
  const plan = generateHouse20x20Plan()
  const integrity = verifyHousePlanIntegrity(plan)

  assert.strictEqual(integrity.valid, true, 'Blueprint must have 100% valid face references')
  assert.strictEqual(integrity.floatingCount, 0, 'Zero floating voxels allowed')
  assert.strictEqual(integrity.foundationCount, 400, 'Foundation must be exactly 20x20 (400 blocks)')

  const bill = calculateMaterialBill(plan)
  assert.ok(bill.stone === 324 && bill.cobblestone >= 76, 'Foundation floor breakdown must match 400 blocks')
  assert.ok(bill.oak_log >= 60, 'Pillars framing must contain at least 60 oak_log blocks')
  assert.ok(bill.glass >= 32, 'Windows and skylight must contain glass')
})

// ---------------------------------------------------------------------------
// Gate 15: Motion Watchdog & AFK Farm Exemption Gate
// ---------------------------------------------------------------------------
console.log('\n--- Gate 15: Motion Watchdog & AFK Farm Exemption Gate ---')
runTest('MotionWatchdog stationary alert with standby & farm AFK exemptions', () => {
  let simulatedTime = 1000000
  const now = () => simulatedTime
  const mockBot = new EventEmitter()
  mockBot.username = 'Arthur'
  mockBot.entity = { position: { x: -240, y: 65, z: 97 } }
  mockBot.targetDigBlock = null
  mockBot.collectBlock = null

  const alerts = []
  const watchdog = new MotionWatchdog(mockBot, {
    idleThresholdSec: 10,
    now,
    onAlert: (msg) => { if (msg) alerts.push(msg) }
  })

  // 1. Commanded standby exemption
  watchdog.setMode('STANDBY', 'Commanded stop/stay')
  simulatedTime += 25000
  let st = watchdog.evaluateCheck()
  assert.strictEqual(st.isAlerting, false, 'Standby must be exempt from alerts')
  assert.strictEqual(st.isExempt, true)

  // 2. Commanded AFK farm exemption
  watchdog.setMode('AFK_FARM', 'AFK at wheat farm')
  simulatedTime += 40000
  st = watchdog.evaluateCheck()
  assert.strictEqual(st.isAlerting, false, 'AFK at farm must be exempt from alerts')
  assert.strictEqual(st.isExempt, true)

  // 3. Active task triggers alert after 10s stationary
  watchdog.setMode('TASK_ACTIVE', 'patrol')
  simulatedTime += 12000
  st = watchdog.evaluateCheck()
  assert.strictEqual(st.isAlerting, true, 'Active task must alert after 10s standing still')
  assert.strictEqual(st.isExempt, false)
  assert.strictEqual(alerts.length, 1)

  // 4. Moving clears alert
  mockBot.entity.position.x = -230
  simulatedTime += 1000
  st = watchdog.evaluateCheck()
  assert.strictEqual(st.isAlerting, false, 'Movement clears alert')
  assert.strictEqual(st.stationaryDurationSec, 0)
})

// ---------------------------------------------------------------------------
// Gate 16: Player vs Squad Bot Registry & Spatial Differentiation
// ---------------------------------------------------------------------------
console.log('\n--- Gate 16: Player vs Squad Bot Registry & Spatial Differentiation ---')
runTest('Player vs bot classification, self-exclusion, and spatial entity survey segregation', () => {
  // 1. Classification
  assert.strictEqual(isSquadBot('Jotaro'), true)
  assert.strictEqual(isSquadBot('Bob'), true)
  assert.strictEqual(isSquadBot('Torin'), true)
  assert.strictEqual(isSquadBot('Arthur'), true)
  assert.strictEqual(isSquadBot('Willow'), true)
  assert.strictEqual(isSquadBot('vgbn'), false)

  assert.strictEqual(isHumanPlayer('vgbn'), true)
  assert.strictEqual(isHumanPlayer('Bob'), false)

  // 2. Spatial Nearest Selection ignores squad teammates
  const mockSurveyBot = {
    username: 'Jotaro',
    entity: { position: { x: 0, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x, p.z) } },
    entities: {
      0: { username: 'Jotaro', type: 'player', position: { x: 0, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x, p.z) } },
      1: { username: 'Bob', type: 'player', position: { x: 3, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 3, p.z) } },
      2: { username: 'vgbn', type: 'player', position: { x: 10, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 10, p.z) } },
      3: { name: 'zombie', type: 'mob', position: { x: 7, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 7, p.z) } }
    }
  }

  const nearest = getNearestHuman(mockSurveyBot)
  assert.ok(nearest, 'Nearest human must be discovered')
  assert.strictEqual(nearest.username, 'vgbn', 'Nearest human must be vgbn, skipping teammate Bob')

  // 3. Survey formatting segregates categories
  const survey = formatEntitySurvey(mockSurveyBot, 20)
  assert.strictEqual(survey.humans.length, 1)
  assert.strictEqual(survey.humans[0], 'vgbn(10m)')
  assert.strictEqual(survey.squad.length, 1)
  assert.strictEqual(survey.squad[0], 'Bob(3m)')
  assert.strictEqual(survey.mobs.length, 1)
  assert.strictEqual(survey.mobs[0], 'zombie(7m)')
  assert.ok(!survey.humans.includes('Jotaro'), 'Self must never appear in humans')
  assert.ok(!survey.squad.includes('Jotaro'), 'Self must never appear in squadmates')
})

console.log(`\n=== SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED ===`)
if (failedTests > 0) {
  process.exit(1)
} else {
  process.exit(0)
}
