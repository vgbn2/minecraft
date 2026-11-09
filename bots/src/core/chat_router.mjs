// Extracted Inbound Chat Router with Commander Ambient Gate & Fast-Command Protection
import { isSquadBot as defaultIsSquadBot } from './player_registry.mjs'

export const AMBIENT_ALLOWED_INTENTS = new Set([
  'FEED',
  'MINE',
  'BUILD',
  'GUARD',
  'HARVEST',
  'SCOUT',
  'COME',
  'GOTO',
  'NAVIGATE',
  'STOP',
  'STATUS'
])

export class ChatMessageRouter {
  constructor(options = {}) {
    this.botName = options.botName || 'Companion'
    this.isMastermind = Boolean(options.isMastermind)
    this.getIsAlive = options.getIsAlive || (() => true)
    this.isSquadBot = options.isSquadBot || defaultIsSquadBot
    this.sendResponse = options.sendResponse || (() => {})
    this.onSlashCommand = options.onSlashCommand || (() => {})
    this.onFastCommand = options.onFastCommand || (async () => false)
    this.onTranslate = options.onTranslate || (() => [])
    this.onDispatchIpc = options.onDispatchIpc || (() => {})
    this.onAiQuery = options.onAiQuery || (() => {})
  }

  async route(sender, rawMessage, isWhisper = false, isIpc = false) {
    if (!rawMessage || typeof rawMessage !== 'string') return false
    const botName = this.botName || 'Companion'
    if (sender === botName) return false

    // Prevent echo loops: squad bots ignore each other's public chat unless via whisper or IPC
    if (!isWhisper && !isIpc && this.isSquadBot(sender, botName)) return false

    if (!this.getIsAlive()) {
      this.sendResponse(sender, "I'm currently respawning, please wait a moment!", isWhisper)
      return false
    }

    let msg = rawMessage.trim()
    if (!msg) return false

    let isCommanderAmbient = false
    if (!isWhisper && !isIpc) {
      if (msg.startsWith('!')) {
        msg = msg.slice(1).trim()
      } else {
        const nameRegex = new RegExp(`^@?${botName}\\b[:,]?\\s*`, 'i')
        if (nameRegex.test(msg)) {
          msg = msg.replace(nameRegex, '').trim()
        } else if (this.isMastermind) {
          // Only Mastermind Jotaro inspects un-prefixed ambient human chat
          isCommanderAmbient = true
        } else {
          return false
        }
      }
    } else {
      if (msg.startsWith('/')) {
        this.onSlashCommand(msg)
        return true
      }
      if (msg.startsWith('!') || msg.startsWith('/')) {
        msg = msg.slice(1).trim()
      }
    }

    if (!msg) return false
    const parts = msg.split(/\s+/)
    const firstWord = parts[0].toLowerCase()

    // Gate fast commands on !isCommanderAmbient so unprefixed ambient chat ("come here") does not bypass NLP
    if (!isCommanderAmbient) {
      const handled = await this.onFastCommand(sender, firstWord, parts.slice(1), isWhisper)
      if (handled) return true
    }

    const translated = (this.onTranslate(sender, msg) || []).slice(0, 3)
    const validActions = translated.filter(a =>
      a && a.intent && a.intent !== 'UNKNOWN' &&
      (!isCommanderAmbient || AMBIENT_ALLOWED_INTENTS.has(a.intent))
    )

    if (validActions.length > 0) {
      for (const action of validActions) {
        const targetLower = String(action.targetAgent || botName).toLowerCase()
        if (targetLower === botName.toLowerCase() || targetLower === 'all') {
          const cleanCmd = String(action.command || '').replace(/^[!/]/, '').trim()
          if (cleanCmd) {
            const cmdParts = cleanCmd.split(/\s+/)
            await this.onFastCommand(sender, cmdParts[0].toLowerCase(), cmdParts.slice(1), isWhisper)
          }
        }
        if (targetLower !== botName.toLowerCase()) {
          this.onDispatchIpc(action.targetAgent, action.command)
          if (action.tacticalBrief) {
            this.sendResponse(sender, action.tacticalBrief, isWhisper)
          }
        }
      }
      return true
    }

    // Never fall through to expensive LLM queries on unprefixed ambient chat
    if (isCommanderAmbient) return false

    this.onAiQuery(sender, msg, isWhisper)
    return true
  }
}
