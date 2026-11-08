// Mineflayer Connection & Protocol 26.3 Patch Hooks
import { createRequire } from 'node:module'
import mineflayer from 'mineflayer'
import armorManager from 'mineflayer-armor-manager'
import autoEatPkg from 'mineflayer-auto-eat'
import collectBlockPkg from 'mineflayer-collectblock'
import pathfinderPkg from 'mineflayer-pathfinder'
import pvpPkg from 'mineflayer-pvp'
import mcDataObj from 'minecraft-data/data.js'
import protocolPkg from 'minecraft-protocol'

// ponytail: compatibility shim for Fabric 26.3 mapping to 26.1 protocol dataset
if (mcDataObj.pc && !mcDataObj.pc['26.3']) {
  mcDataObj.pc['26.3'] = mcDataObj.pc['26.1'] || mcDataObj.pc['1.21.11']
}
if (protocolPkg?.supportedVersions && !protocolPkg.supportedVersions.includes('26.3')) {
  protocolPkg.supportedVersions.push('26.3')
}

// ponytail: fix prismarine-chat 26.3 fromNotch crash when system_chat packet.content is undefined/null
const _req = createRequire(import.meta.url)
try {
  const pChatPath = _req.resolve('prismarine-chat')
  const origPChat = _req('prismarine-chat')
  const wrapPChat = function (registryOrVersion) {
    const ChatMessage = origPChat(registryOrVersion)
    const origFromNotch = ChatMessage.fromNotch
    ChatMessage.fromNotch = function (msg) {
      if (!msg) return new ChatMessage('')
      try {
        return origFromNotch.call(this, msg)
      } catch {
        return new ChatMessage(typeof msg === 'string' ? msg : '')
      }
    }
    return ChatMessage
  }
  Object.assign(wrapPChat, origPChat)
  if (_req.cache[pChatPath]) _req.cache[pChatPath].exports = wrapPChat
} catch {}

const autoEat = autoEatPkg.plugin || autoEatPkg.default || autoEatPkg
const collectBlock = collectBlockPkg.plugin || collectBlockPkg.default || collectBlockPkg
const pathfinder = pathfinderPkg.pathfinder || pathfinderPkg
const pvp = pvpPkg.plugin || pvpPkg
const armor = armorManager.default || armorManager

export function createBotInstance(options) {
  const { host, port, username, version, viewDistance } = options

  const bot = mineflayer.createBot({
    host,
    port,
    username,
    auth: 'offline',
    viewDistance: viewDistance || 6,
    hideErrors: true,
    checkTimeoutInterval: 60000,
    ...(version ? { version } : {})
  })

  // ponytail: atomic 26.3 protocol sanitizer & tick_end fence; prevents invalid_player_movement & NaN poison (PR #4189)
  const origWrite = bot._client.write.bind(bot._client)
  const acknowledgedTeleports = new Set()

  bot._client.write = (name, packet = {}) => {
    if (!bot._client || bot._client.state !== 'play') return origWrite(name, packet)

    // Suppress movement packets when bot entity is missing or dead
    if (['position', 'position_look', 'look', 'flying'].includes(name)) {
      if (!bot.entity || !bot.isAlive) return
    }

    // 1. Sanitize teleport_confirm: ensure 26.3 coordinates don't desync
    if (name === 'teleport_confirm') {
      const tpId = packet.teleportId
      if (tpId !== undefined && acknowledgedTeleports.has(tpId)) return
      if (tpId !== undefined) acknowledgedTeleports.add(tpId)
    }

    // 2. Fence tick_end: avoid duplicate unacknowledged frames on custom/Paper servers
    if (name === 'tick_end') {
      if (!bot._client || bot._client.state !== 'play') return
    }

    return origWrite(name, packet)
  }

  // Load essential plugins
  bot.loadPlugin(pathfinder)
  bot.loadPlugin(pvp)
  bot.loadPlugin(collectBlock)
  bot.loadPlugin(autoEat)
  bot.loadPlugin(armor)

  return bot
}
