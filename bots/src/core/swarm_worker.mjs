// 50-Bot / Worker Swarm Multiplexer with Shared RefCountedColumnStore (#24)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RefCountedColumnStore } from './ref_counted_world.mjs'
import { createBotInstance } from './client.mjs'
import { ChatMessageRouter } from './chat_router.mjs'
import { IpcManager } from './ipc.mjs'
import { isSquadBot } from './player_registry.mjs'
import { PrompterSupervisor } from '../intelligence/supervisor.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PERSONALITIES_PATH = path.join(__dirname, '../../config/personalities.json')

let _cachedPersonalities = null
function loadPersonalities() {
  if (_cachedPersonalities) return _cachedPersonalities
  try {
    _cachedPersonalities = JSON.parse(fs.readFileSync(PERSONALITIES_PATH, 'utf8'))
  } catch {
    _cachedPersonalities = {}
  }
  return _cachedPersonalities
}

export const MAX_BOTS_PER_WORKER = 50

export function createBotAgentInstance(opts = {}) {
  const personalities = loadPersonalities()
  const instName = opts.username || 'Citizen_1'
  const instRole = (opts.personalityKey || opts.role || 'companion').toLowerCase()
  const instPersonality = personalities[instRole] || personalities.companion || { role: 'citizen', title: 'Citizen' }
  const createFn = opts.createBotFn || createBotInstance
  const instBot = createFn({
    host: opts.host || '127.0.0.1',
    port: opts.port || 25565,
    username: instName,
    version: opts.version || '1.21.4',
    viewDistance: opts.viewDistance || 2,
    lightweight: opts.lightweight ?? true,
    storageBuilder: opts.storageBuilder || null
  })
  const instSupervisor = new PrompterSupervisor({ bot: instBot, language: opts.language || 'auto' })
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

export class SwarmWorkerMultiplexer {
  constructor(options = {}) {
    this.workerId = options.workerId ?? 0
    this.maxBots = options.maxBots || MAX_BOTS_PER_WORKER
    this.columnStore = options.columnStore || new RefCountedColumnStore()
    this.createBotFn = options.createBotFn || null
    this.ipcBaseDir = options.ipcBaseDir || process.env.MC_IPC_DIR || '/dev/shm/mc-bot'
    this.staggerDelayMs = options.staggerDelayMs ?? 50
    this.agents = new Map() // username -> BotAgentInstance
  }

  async spawnBatch(agentSpecs = []) {
    if (this.agents.size + agentSpecs.length > this.maxBots) {
      throw new RangeError(
        `Worker ${this.workerId} capacity exceeded: ${this.agents.size} + ${agentSpecs.length} > ${this.maxBots}`
      )
    }

    const spawned = []
    for (let i = 0; i < agentSpecs.length; i++) {
      const spec = agentSpecs[i]
      const username = spec.username || `Citizen_${this.workerId * this.maxBots + i + 1}`
      const role = spec.role || 'miner'
      const storageAdapter = this.columnStore.createAgentAdapter(username)

      const inst = createBotAgentInstance({
        username,
        role,
        host: spec.host,
        port: spec.port,
        version: spec.version || '1.21.4',
        viewDistance: spec.viewDistance || 2,
        lightweight: true,
        storageBuilder: () => storageAdapter,
        createBotFn: this.createBotFn,
        ipcBaseDir: this.ipcBaseDir,
        enableIpc: spec.enableIpc !== false,
        startIpc: Boolean(spec.startIpc),
        onFastCommand: spec.onFastCommand
      })
      inst.storageAdapter = storageAdapter
      this.agents.set(username, inst)
      spawned.push(inst)

      if (this.staggerDelayMs > 0 && i + 1 < agentSpecs.length) {
        await new Promise(r => setTimeout(r, this.staggerDelayMs))
      }
    }
    return spawned
  }

  removeAgent(username) {
    const inst = this.agents.get(username)
    if (!inst) return false
    inst.stop()
    this.columnStore.removeAgent(username)
    this.agents.delete(username)
    return true
  }

  stopAll() {
    for (const [username, inst] of this.agents.entries()) {
      inst.stop()
      this.columnStore.removeAgent(username)
    }
    this.agents.clear()
  }
}
