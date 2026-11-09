// ponytail: native zero-dependency player vs bot entity classifier; eliminates friendly-fire & circular squad chase
import { IpcManager } from './ipc.mjs'

export const SQUAD_BOT_NAMES = new Set([
  'jotaro',
  'joseph',
  'polnareff',
  'avdol',
  'avodl',
  'kakyoin',
  'iggy',
  'jotaro_kujo',
  'joseph_joestar',
  'jean_polnareff',
  'mohammed_avdol',
  'noriaki_kakyoin',
  'iggy_the_fool'
])

export const CITIZEN_BOT_REGEX = /^(miner|farmer|lumberjack|builder|guard|smith|hauler|citizen|foreman)_[0-9]+$/i

export function isSquadBot(entityOrName, selfName = null) {
  if (!entityOrName) return false
  const rawName = (typeof entityOrName === 'string'
    ? entityOrName
    : (entityOrName.username || entityOrName.name || '')
  ).trim()
  const name = rawName.toLowerCase()

  if (!name) return false
  if (selfName && name === selfName.toLowerCase().trim()) return true
  if (SQUAD_BOT_NAMES.has(name)) return true
  if (CITIZEN_BOT_REGEX.test(name)) return true
  return IpcManager.isRegisteredBot(rawName)
}

export function isHumanPlayer(entityOrName, selfName = null) {
  if (!entityOrName) return false
  if (typeof entityOrName === 'string') {
    return !isSquadBot(entityOrName, selfName)
  }
  const isPlayerType = entityOrName.type === 'player' || entityOrName.name === 'player'
  if (!isPlayerType) return false
  return !isSquadBot(entityOrName, selfName)
}

export function resolveEntityPlayer(entity, bot = null) {
  if (!entity) return null
  if (entity.username) {
    return { username: entity.username, isPlayer: true }
  }
  if (entity.uuid && bot?.players) {
    for (const [uname, pinfo] of Object.entries(bot.players)) {
      if (pinfo && pinfo.uuid === entity.uuid) {
        return { username: uname, isPlayer: true }
      }
    }
  }
  if (entity.type === 'player' || entity.name === 'player') {
    return { username: entity.username || entity.displayName || null, isPlayer: true }
  }
  return null
}

export function getNearbyHumans(bot, maxDistance = 32) {
  if (!bot || !bot.entity || !bot.entities) return []
  const selfName = bot.username || ''
  const pos = bot.entity.position
  const humans = []

  for (const entity of Object.values(bot.entities)) {
    if (!entity || !entity.position || entity === bot.entity) continue
    const resolved = resolveEntityPlayer(entity, bot)
    if (!resolved || !resolved.isPlayer || !resolved.username) continue
    if (resolved.username.toLowerCase() === selfName.toLowerCase()) continue
    if (isSquadBot(resolved.username, selfName)) continue

    const dist = pos.distanceTo(entity.position)
    if (dist <= maxDistance) {
      humans.push({ entity, username: resolved.username, distance: dist })
    }
  }

  humans.sort((a, b) => a.distance - b.distance)
  return humans
}

export function getNearestHuman(bot, maxDistance = 64) {
  const humans = getNearbyHumans(bot, maxDistance)
  if (humans.length === 0) return null
  const best = humans[0]
  if (!best.entity.username) best.entity.username = best.username
  return best.entity
}

export function getNearbySquadMates(bot, maxDistance = 32) {
  if (!bot || !bot.entity || !bot.entities) return []
  const selfName = bot.username || ''
  const pos = bot.entity.position
  const mates = []

  for (const entity of Object.values(bot.entities)) {
    if (!entity || !entity.position || entity === bot.entity) continue
    const resolved = resolveEntityPlayer(entity, bot)
    if (!resolved || !resolved.isPlayer || !resolved.username) continue
    if (resolved.username.toLowerCase() === selfName.toLowerCase()) continue
    if (!isSquadBot(resolved.username, selfName)) continue

    const dist = pos.distanceTo(entity.position)
    if (dist <= maxDistance) {
      mates.push({ entity, username: resolved.username, distance: dist })
    }
  }

  mates.sort((a, b) => a.distance - b.distance)
  return mates
}

export function formatEntitySurvey(bot, maxDistance = 30) {
  const result = { humans: [], squad: [], mobs: [] }
  if (!bot || !bot.entity || !bot.entities) return result

  const selfName = bot.username || ''
  const pos = bot.entity.position

  for (const entity of Object.values(bot.entities)) {
    if (!entity || !entity.position || entity === bot.entity) continue
    const dist = Math.round(pos.distanceTo(entity.position))
    if (dist > maxDistance) continue

    const resolved = resolveEntityPlayer(entity, bot)
    if (resolved && resolved.isPlayer) {
      const uname = resolved.username
      if (!uname || uname.toLowerCase() === selfName.toLowerCase()) continue
      if (isSquadBot(uname, selfName)) {
        result.squad.push(`${uname}(${dist}m)`)
      } else {
        result.humans.push(`${uname}(${dist}m)`)
      }
    } else if (entity.type === 'mob' || entity.type === 'hostile' || entity.type === 'animal') {
      const mname = entity.name || entity.displayName || 'mob'
      result.mobs.push(`${mname}(${dist}m)`)
    }
  }

  return result
}
