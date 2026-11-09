import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import { Vec3 } from 'vec3'
import { AutonomousIncentiveEngine, HOUSE_CORNERS } from '../src/intelligence/autonomous_routine.mjs'

console.log('=== TEST SUITE: SQUAD INCENTIVE ENGINE & HUNGER DECAY ===\n')

function createMockBot(username, role = 'general') {
  const bot = new EventEmitter()
  bot.username = username
  bot.health = 20
  bot.food = 20
  bot.entity = {
    position: new Vec3(-240, 65, 100),
    height: 1.6
  }
  bot.inventory = {
    items: () => []
  }
  bot.controlStates = {}
  bot.setControlState = (action, state) => {
    bot.controlStates[action] = state
  }
  bot.players = {}
  bot.nearestEntity = () => null
  bot.findBlock = () => null
  bot.blockAt = () => ({ name: 'air' })
  return bot
}

const mockSafeNav = {
  navigateTo: async () => ({ success: true })
}
const mockWatchdog = {
  mode: 'IDLE',
  setMode: (mode) => { mockWatchdog.mode = mode }
}

// Gate 1: Initialization
const bot = createMockBot('Torin', 'miner')
const engine = new AutonomousIncentiveEngine(bot, mockSafeNav, mockWatchdog, 'miner')
assert.strictEqual(engine.laborCredits, 0, 'Labor credits must start at 0')
assert.strictEqual(engine.slackingSeconds, 0, 'Slacking timer must start at 0')
console.log('  [PASS] Gate 1: Engine initialization and baseline state')

// Gate 2: Hunger Decay over time
engine._processHungerDecay(15)
assert.strictEqual(bot.food, 19, 'Hunger must decay by 1 food point after 15s delta')
engine._processHungerDecay(15)
assert.strictEqual(bot.food, 18, 'Hunger must decay by 2 food points after 30s delta')
console.log('  [PASS] Gate 2: Real player metabolic hunger decay')

// Gate 3: Disciplinary penalty (-0.5 heart / -1 HP) on >45s slacking
bot.health = 20
assert.strictEqual(bot.health, 20)
// Simulate 46 seconds of slacking without work
await engine._enforceDiscipline(46)
assert.strictEqual(bot.health, 19, 'Bot must lose exactly 1 HP (-0.5 heart) when slacking > 45s')
assert.strictEqual(engine.slackingSeconds, 0, 'Slacking seconds must reset after penalty')
console.log('  [PASS] Gate 3: Disciplinary penalty (-0.5 heart / -1 HP) enforced on slacking')

// Gate 4: Productive work records credit & resets slacking timer
engine.slackingSeconds = 30
engine.recordProductiveWork('mined stone')
assert.strictEqual(engine.laborCredits, 1, 'Labor credits must increment on productive work')
assert.strictEqual(engine.slackingSeconds, 0, 'Slacking timer must reset to 0 after productive work')
console.log('  [PASS] Gate 4: Productivity rewards & labor credit accrual')

// Gate 5: Survival eating drive restores HP & food when rations exist
bot.food = 10
bot.health = 14
let consumed = false
bot.inventory.items = () => [{ name: 'bread', type: 297, count: 3 }]
bot.equip = async () => {}
bot.consume = async () => { consumed = true }
const survived = await engine._handleSurvivalDrive()
assert.ok(survived, 'Survival drive must trigger when hungry')
assert.ok(consumed, 'Bot must consume food item')
assert.strictEqual(bot.food, 14, 'Consuming food must restore food points')
assert.strictEqual(bot.health, 16, 'Consuming food must restore health')
console.log('  [PASS] Gate 5: Survival eating drive replenishes vitals to keep agent alive')

// Gate 6: Mutual squad aid (sharing food with injured teammate)
const arthurBot = createMockBot('Arthur', 'sentinel')
arthurBot.health = 8 // Injured teammate
bot.players['Arthur'] = { entity: { position: new Vec3(-238, 65, 100) } }
let tossed = false
bot.inventory.items = () => [
  { name: 'bread', type: 297, count: 2 },
  { name: 'apple', type: 260, count: 1 }
]
bot.lookAt = async () => {}
bot.toss = async (type, metadata, count) => {
  assert.strictEqual(count, 1)
  tossed = true
}
const aided = await engine._handleSquadMutualAid()
assert.ok(aided, 'Squad mutual aid must trigger for injured ally')
assert.ok(tossed, 'Food item must be tossed to teammate')
console.log('  [PASS] Gate 6: Squad mutual aid and food sharing')

// Gate 7: Role specialization routing
const sentryBot = createMockBot('Arthur', 'sentinel')
const sentryEngine = new AutonomousIncentiveEngine(sentryBot, mockSafeNav, mockWatchdog, 'sentinel')
let targetCornerReached = false
sentryEngine.safeNav = {
  navigateTo: async (pos) => {
    assert.deepStrictEqual(pos, HOUSE_CORNERS[0])
    targetCornerReached = true
    return { success: true }
  }
}
await sentryEngine._handleRoleIncentive()
assert.ok(targetCornerReached, 'Sentinel must navigate to perimeter corner')
assert.strictEqual(sentryEngine.sentryCorner, 1, 'Corner counter must advance')
console.log('  [PASS] Gate 7: Role specialization routes sentinel to perimeter corners')

console.log('\n=== ALL 7 INCENTIVE & SURVIVAL GATES PASSED! ===')
