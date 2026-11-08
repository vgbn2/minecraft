// Agent Archetype Matrix & 6-Axis Stat Radar (P/S/R/D/P/D)
// Evaluates agent capabilities based on physical attributes rather than literal fantasy constructs.

export const STAT_BARS = {
  A: '■■■■■',
  B: '■■■■□',
  C: '■■■□□',
  D: '■■□□□',
  E: '■□□□□'
}

export function formatJojoCard(personality) {
  if (!personality) return ''
  const name = personality.name || 'Agent'
  const stand = personality.stand || personality.archetypeTitle || 'Companion'
  const stats = personality.stats || {}
  const specialty = personality.specialty || personality.role || 'General'

  const pwr = stats.pwr || stats.power || 'C'
  const spd = stats.spd || stats.speed || 'C'
  const rng = stats.rng || stats.range || 'C'
  const dur = stats.dur || stats.durability || 'C'
  const prc = stats.prc || stats.precision || 'C'
  const dev = stats.dev || stats.potential || 'C'

  return [
    `=== JOJO STAND PARAMETERS ===`,
    `STAND NAME: [ ${stand} ]   USER: ${name} (${personality.title || personality.role || 'Companion'})`,
    `┌──────────────────────────────────────────────┐`,
    `│ POWER:       [${pwr}] ${STAT_BARS[pwr] || '■■■□□'} (Destructive Force)   │`,
    `│ SPEED:       [${spd}] ${STAT_BARS[spd] || '■■■□□'} (Agility & Reflexes)  │`,
    `│ RANGE:       [${rng}] ${STAT_BARS[rng] || '■■■□□'} (Effective Proximity) │`,
    `│ DURABILITY:  [${dur}] ${STAT_BARS[dur] || '■■■□□'} (Sustained Operation) │`,
    `│ PRECISION:   [${prc}] ${STAT_BARS[prc] || '■■■□□'} (Spatial Accuracy)    │`,
    `│ POTENTIAL:   [${dev}] ${STAT_BARS[dev] || '■■■□□'} (Tactical Intellect)  │`,
    `└──────────────────────────────────────────────┘`,
    `SPECIALTY: ${specialty}`,
    `=============================`
  ].join('\n')
}

export function formatJojoChatLine(personality) {
  if (!personality) return ''
  const name = personality.name || 'Agent'
  const stand = personality.stand || personality.archetypeTitle || 'Companion'
  return `[Stand: ${stand}] ${name} active.`
}

export function formatSquadMatrix(personalities) {
  const pList = personalities ? Object.values(personalities) : []
  const header = [
    `================================================================================`,
    `                      ✦ JOJO STAND SQUAD STATUS MATRIX ✦`,
    `================================================================================`,
    `AGENT    STAND            ROLE        STATS(P/S/R/D/P/D) STATUS              `,
    `--------------------------------------------------------------------------------`
  ]
  const rows = pList.map(p => {
    const s = `${p.stats?.pwr || 'C'}/${p.stats?.spd || 'C'}/${p.stats?.rng || 'C'}/${p.stats?.dur || 'C'}/${p.stats?.prc || 'C'}/${p.stats?.dev || 'C'}`
    const label = `${p.name} [${p.stand}]`
    return `${label.padEnd(24)} ${(p.title || p.role || '').slice(0, 11).padEnd(12)} ${s.padEnd(18)} ACTIVE`
  })
  const footer = [
    `================================================================================`
  ]
  return [...header, ...rows, ...footer].join('\n')
}

// Canonical Aliases
export const formatAgentCard = formatJojoCard
export const formatAgentChatLine = formatJojoChatLine
export const STAT_TIERS = STAT_BARS
