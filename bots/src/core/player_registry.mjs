// ponytail: native zero-dependency player vs bot entity classifier; eliminates friendly-fire & circular squad chase
export const SQUAD_BOT_NAMES = new Set(['jotaro', 'joseph', 'polnareff', 'avdol', 'avodl', 'kakyoin', 'iggy'])

export function isSquadBot(entityOrName, selfName = null) {
  if (!entityOrName) return false
  const name = (typeof entityOrName === 'string'
    ? entityOrName
    : (entityOrName.username || entityOrName.name || '')
  ).toLowerCase().trim()

  if (!name) return false
  if (selfName && name === selfName.toLowerCase().trim()) return true
  return SQUAD_BOT_NAMES.has(name)
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
  if (typeof entity === 'string') {
    return { username: entity, isPlayer: true }
  }
  if (entity.username) {
    return { username: entity.username, isPlayer: true }
  }
  if (bot?.players) {
    for (const [pname, pinfo] of Object.entries(bot.players)) {
      if (!pinfo) continue
      if (pinfo.entity === entity || (entity.uuid && pinfo.uuid && pinfo.uuid === entity.uuid)) {
        return { username: pname, isPlayer: true }
      }
    }
  }
  if (entity.type === 'player' || entity.name === 'player') {
    return { username: entity.username || entity.name || 'player', isPlayer: true }
  }
  return null
}

function isSelfEntity(entity, bot) {
  if (!entity || !bot) return false
  if (entity === bot.entity) return true
  const resolved = resolveEntityPlayer(entity, bot)
  if (resolved && bot.username && resolved.username.toLowerCase() === bot.username.toLowerCase()) {
    return true
  }
  return false
}

export function getNearestHuman(bot, maxDistance = Infinity) {
  if (!bot?.entities) return null
  let nearest = null
  let minDist = maxDistance
  const selfPos = bot.entity?.position

  for (const entity of Object.values(bot.entities)) {
    if (isSelfEntity(entity, bot) || !entity.position) continue
    const p = resolveEntityPlayer(entity, bot)
    if (!p || isSquadBot(p.username, bot.username)) continue
    const dist = selfPos ? selfPos.distanceTo(entity.position) : 0
    if (dist < minDist) {
      minDist = dist
      nearest = entity
    }
  }
  return nearest
}

export function getNearbyHumans(bot, maxDistance = 32) {
  if (!bot?.entities) return []
  const selfPos = bot.entity?.position
  return Object.values(bot.entities)
    .filter(e => !isSelfEntity(e, bot) && e.position)
    .filter(e => {
      const p = resolveEntityPlayer(e, bot)
      return p && !isSquadBot(p.username, bot.username)
    })
    .filter(e => !selfPos || selfPos.distanceTo(e.position) <= maxDistance)
}

export function getNearbySquadMates(bot, maxDistance = 32) {
  if (!bot?.entities) return []
  const selfPos = bot.entity?.position
  return Object.values(bot.entities)
    .filter(e => !isSelfEntity(e, bot) && e.position)
    .filter(e => {
      const p = resolveEntityPlayer(e, bot)
      return p && isSquadBot(p.username, bot.username)
    })
    .filter(e => !selfPos || selfPos.distanceTo(e.position) <= maxDistance)
}

export function formatEntitySurvey(bot, maxDistance = 32) {
  if (!bot?.entities) return { humans: [], squad: [], mobs: [] }
  const selfPos = bot.entity?.position
  const humans = []
  const squad = []
  const mobs = []

  for (const e of Object.values(bot.entities)) {
    if (isSelfEntity(e, bot) || !e.position) continue
    const dist = selfPos ? Math.round(selfPos.distanceTo(e.position)) : 0
    if (dist > maxDistance) continue

    const playerMatch = resolveEntityPlayer(e, bot)
    if (playerMatch) {
      const label = playerMatch.username
      if (isSquadBot(label, bot.username)) {
        squad.push(`${label}(${dist}m)`)
      } else {
        humans.push(`${label}(${dist}m)`)
      }
    } else {
      const label = e.name || e.type || 'unknown'
      mobs.push(`${label}(${dist}m)`)
    }
  }

  return { humans, squad, mobs }
}
