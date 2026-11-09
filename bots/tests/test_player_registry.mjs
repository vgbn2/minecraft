// ponytail: assert-based player vs bot differentiation unit tests; zero external frameworks
import assert from 'node:assert'
import {
  isSquadBot,
  isHumanPlayer,
  getNearestHuman,
  getNearbyHumans,
  getNearbySquadMates,
  formatEntitySurvey
} from '../src/core/player_registry.mjs'

console.log('[*] Testing Player vs Squad Bot Registry & Spatial Differentiation...')

// 1. Classification of Strings & Entities
assert.strictEqual(isSquadBot('Jotaro'), true)
assert.strictEqual(isSquadBot('joseph'), true)
assert.strictEqual(isSquadBot('POLNAREFF'), true)
assert.strictEqual(isSquadBot('Avdol'), true)
assert.strictEqual(isSquadBot('avodl'), true)
assert.strictEqual(isSquadBot('Kakyoin'), true)
assert.strictEqual(isSquadBot('Iggy'), true)
assert.strictEqual(isSquadBot('Miner_42'), true, 'Citizen miner bot must be recognized as squad/citizen bot')
assert.strictEqual(isSquadBot('Farmer_108'), true, 'Citizen farmer bot must be recognized as squad/citizen bot')
assert.strictEqual(isSquadBot('Hauler_499'), true, 'Citizen hauler bot must be recognized as squad/citizen bot')
assert.strictEqual(isSquadBot('vgbn'), false)
assert.strictEqual(isSquadBot('Steve'), false)

assert.strictEqual(isHumanPlayer('vgbn'), true)
assert.strictEqual(isHumanPlayer('Steve'), true)
assert.strictEqual(isHumanPlayer('Jotaro'), false)
assert.strictEqual(isHumanPlayer('Joseph'), false)

const botEntity = { username: 'Joseph', type: 'player', position: { x: 10, y: 64, z: 10 } }
const humanEntity = { username: 'vgbn', type: 'player', position: { x: 15, y: 64, z: 10 } }
const zombieEntity = { name: 'zombie', type: 'mob', position: { x: 20, y: 64, z: 10 } }

assert.strictEqual(isSquadBot(botEntity), true)
assert.strictEqual(isHumanPlayer(botEntity), false)
assert.strictEqual(isHumanPlayer(humanEntity), true)
assert.strictEqual(isHumanPlayer(zombieEntity), false)
console.log('  [PASS] Gate 1: String and Entity classification of bots vs humans')

// 2. Spatial Selection: getNearestHuman ignores squad bots
const mockBot = {
  username: 'Jotaro',
  entity: { position: { x: 0, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x, p.z) } },
  entities: {
    1: { username: 'Joseph', type: 'player', position: { x: 2, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 2, p.z) } },
    2: { username: 'Polnareff', type: 'player', position: { x: 4, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 4, p.z) } },
    3: { username: 'vgbn', type: 'player', position: { x: 12, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 12, p.z) } },
    4: { name: 'skeleton', type: 'mob', position: { x: 8, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 8, p.z) } }
  }
}

const nearestHuman = getNearestHuman(mockBot)
assert.ok(nearestHuman, 'Must find nearest human')
assert.strictEqual(nearestHuman.username, 'vgbn', 'Nearest human must be vgbn, NOT Joseph or Polnareff')
console.log('  [PASS] Gate 2: getNearestHuman ignores nearby squad teammates (Joseph, Polnareff)')

// 3. Entity Survey Partitioning & Negative Bounds
const mockBotWithSelf = {
  username: 'Jotaro',
  entity: { position: { x: 0, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x, p.z) } },
  entities: {
    // 0: self entity should be excluded from squad & humans
    0: { username: 'Jotaro', type: 'player', position: { x: 0, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x, p.z) } },
    1: { username: 'jOsEph', type: 'player', position: { x: 2, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 2, p.z) } },
    2: { username: 'POLNAREFF', type: 'player', position: { x: 4, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 4, p.z) } },
    3: { username: 'vgbn', type: 'player', position: { x: 12, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 12, p.z) } },
    4: { name: 'skeleton', type: 'mob', position: { x: 8, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 8, p.z) } },
    // 5: entity beyond maxDistance (30m) must be filtered out
    5: { username: 'far_player', type: 'player', position: { x: 50, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 50, p.z) } }
  }
}

const survey = formatEntitySurvey(mockBotWithSelf, 30)

// Strict positive assertions
assert.strictEqual(survey.humans.length, 1, 'Exactly 1 human within 30m')
assert.strictEqual(survey.humans[0], 'vgbn(12m)', 'Human must format with exact username and distance')
assert.strictEqual(survey.squad.length, 2, 'Exactly 2 squad mates (jOsEph, POLNAREFF), self excluded')
assert.ok(survey.squad.includes('jOsEph(2m)'), 'Squad includes case-variant jOsEph(2m)')
assert.ok(survey.squad.includes('POLNAREFF(4m)'), 'Squad includes case-variant POLNAREFF(4m)')
assert.strictEqual(survey.mobs.length, 1, 'Exactly 1 mob')
assert.strictEqual(survey.mobs[0], 'skeleton(8m)', 'Mob formatted with distance')

// Strict negative assertions (anti-cheat)
assert.ok(!survey.humans.some(h => h.includes('Jotaro')), 'Self entity must NOT appear in humans')
assert.ok(!survey.squad.some(s => s.includes('Jotaro')), 'Self entity must NOT appear in squadmates')
assert.ok(!survey.humans.some(h => h.includes('far_player')), 'Out-of-range entity (50m > 30m) must be excluded')
assert.ok(!survey.humans.some(h => h.includes('jOsEph') || h.includes('POLNAREFF')), 'Squad bots must NEVER leak into humans array')

console.log('  [PASS] Gate 3: formatEntitySurvey segregates humans, squad mates, and mobs cleanly')

// 4. Pumpkin Rust Server UUID matching (when entity lacks username and type is 'other')
const mockPumpkinBot = {
  username: 'Jotaro',
  entity: { position: { x: 0, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x, p.z) } },
  players: {
    Joseph: { uuid: 'uuid-joseph-111', entity: null },
    vgbn: { uuid: 'uuid-vgbn-222', entity: null }
  },
  entities: {
    10: { uuid: 'uuid-joseph-111', type: 'other', name: 'unknown', position: { x: 3, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 3, p.z) } },
    11: { uuid: 'uuid-vgbn-222', type: 'other', name: 'unknown', position: { x: 9, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 9, p.z) } },
    12: { name: 'cow', type: 'mob', position: { x: 5, y: 64, z: 0, distanceTo: (p) => Math.hypot(p.x - 5, p.z) } }
  }
}

const pumpkinSurvey = formatEntitySurvey(mockPumpkinBot, 30)
assert.strictEqual(pumpkinSurvey.squad.length, 1, 'Joseph resolved via UUID must be in squad')
assert.strictEqual(pumpkinSurvey.squad[0], 'Joseph(3m)')
assert.strictEqual(pumpkinSurvey.humans.length, 1, 'vgbn resolved via UUID must be in humans')
assert.strictEqual(pumpkinSurvey.humans[0], 'vgbn(9m)')
assert.strictEqual(pumpkinSurvey.mobs.length, 1)
assert.strictEqual(pumpkinSurvey.mobs[0], 'cow(5m)')
console.log('  [PASS] Gate 4: UUID-based player/bot resolution for Pumpkin Rust server')

console.log('\n[✓] All Player vs Bot tests PASSED.')
