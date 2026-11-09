// Mineflayer Connection, BungeeCord Skin Injection & Protocol 1.14..26.3 Patch Hooks
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import mineflayer from 'mineflayer'
import armorManager from 'mineflayer-armor-manager'
import * as autoEatPkg from 'mineflayer-auto-eat'
import collectBlockPkg from 'mineflayer-collectblock'
import pathfinderPkg from 'mineflayer-pathfinder'
import pvpPkg from 'mineflayer-pvp'
import mcDataObj from 'minecraft-data/data.js'
import protocolPkg from 'minecraft-protocol'
import { createVersionAdapter } from './version_adapter.mjs'
import { isSquadBot } from './player_registry.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SKINS_CONFIG_PATH = path.join(__dirname, '../../config/crusader_skins.json')

let _cachedSkinsManifest = null
export function loadSkinsManifest() {
  if (_cachedSkinsManifest) return _cachedSkinsManifest
  try {
    _cachedSkinsManifest = JSON.parse(fs.readFileSync(SKINS_CONFIG_PATH, 'utf8'))
  } catch {
    _cachedSkinsManifest = { crusaders: {} }
  }
  return _cachedSkinsManifest
}

export function resolveBotSkinProfile(username) {
  if (!username) return null
  const manifest = loadSkinsManifest()
  const crusaders = manifest?.crusaders || {}
  const lower = String(username).toLowerCase()
  for (const [key, profile] of Object.entries(crusaders)) {
    if (key.toLowerCase() === lower || lower.startsWith(key.toLowerCase())) {
      return profile
    }
  }
  return null
}

// ponytail: BungeeCord IpForwarding handshake requires single \x00 NUL delimiters in set_protocol.serverHost
export function buildBungeeFakeHost(host, username, env = process.env) {
  if (!env || env.MC_PROXY_BUNGEE !== 'true') return null
  const profile = resolveBotSkinProfile(username)
  if (!profile || !profile.uuid || !profile.textures_value || !profile.textures_signature) {
    return null
  }
  const localIp = env.MC_LOCAL_IP || '127.0.0.1'
  const cleanUuid = String(profile.uuid).replace(/-/g, '')
  const propsJson = JSON.stringify([
    {
      name: 'textures',
      value: profile.textures_value,
      signature: profile.textures_signature
    }
  ])
  return `${host}\x00${localIp}\x00${cleanUuid}\x00${propsJson}`
}

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

const autoEat = autoEatPkg.loader || autoEatPkg.plugin || autoEatPkg.default?.plugin || autoEatPkg.default?.loader || autoEatPkg.default
const collectBlock = collectBlockPkg.plugin || collectBlockPkg.default || collectBlockPkg
const pathfinder = pathfinderPkg.pathfinder || pathfinderPkg
const pvp = pvpPkg.plugin || pvpPkg
const armor = armorManager.default || armorManager

export function createBotInstance(options) {
  const {
    host,
    port,
    username,
    version,
    viewDistance,
    lightweight = false,
    storageBuilder = null,
    env = process.env
  } = options

  const fakeHost = buildBungeeFakeHost(host, username, env)

  const bot = mineflayer.createBot({
    host,
    port,
    username,
    auth: 'offline',
    viewDistance: viewDistance || (lightweight ? 2 : 6),
    hideErrors: true,
    checkTimeoutInterval: 60000,
    ...(fakeHost ? { fakeHost } : {}),
    ...(storageBuilder ? { storageBuilder } : {}),
    ...(version ? { version } : {})
  })

  try {
    bot.versionAdapter = createVersionAdapter(version || bot.version || '1.21.4')
  } catch {
    bot.versionAdapter = createVersionAdapter('1.21.4')
  }

  bot.once('login', () => {
    try {
      bot.versionAdapter = createVersionAdapter(bot.version || version || '1.21.4')
    } catch {}
  })

  // Suppress duplicate/unwanted packets on 26.3 protocol
  const origWrite = bot._client.write.bind(bot._client)
  bot._client.write = (name, packet = {}) => {
    if (!bot._client || bot._client.state !== 'play') return origWrite(name, packet)

    // Suppress movement packets when bot entity is missing or dead
    if (['position', 'position_look', 'look', 'flying'].includes(name)) {
      if (!bot.entity || !bot.isAlive) return
    }

    // 2. Fence tick_end: avoid duplicate unacknowledged frames on custom/Paper servers
    if (name === 'tick_end') {
      if (!bot._client || bot._client.state !== 'play') return
    }

    return origWrite(name, packet)
  }

  // Optional cosmetic packet filter for 500-agent swarm workers:
  // Preserves rel_entity_move / entity_teleport while dropping cosmetic head/animation updates >12m away
  if (lightweight && bot._client && typeof bot._client.emit === 'function') {
    const origEmit = bot._client.emit.bind(bot._client)
    const COSMETIC_PACKETS = new Set(['entity_head_rotation', 'entity_look', 'animation'])
    bot._client.emit = function (event, data, ...rest) {
      if (COSMETIC_PACKETS.has(event) && data && data.entityId != null && bot.entity?.position) {
        const ent = bot.entities?.[data.entityId]
        if (ent && ent.position && isSquadBot(ent, username)) {
          const dx = ent.position.x - bot.entity.position.x
          const dz = ent.position.z - bot.entity.position.z
          if ((dx * dx + dz * dz) > 144) return false
        }
      }
      return origEmit(event, data, ...rest)
    }
  }

  if (!lightweight) {
    bot.loadPlugin(pathfinder)
    bot.loadPlugin(pvp)
    bot.loadPlugin(collectBlock)
    bot.loadPlugin(autoEat)
    bot.loadPlugin(armor)
  }

  return bot
}
