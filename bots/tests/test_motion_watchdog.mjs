// ponytail: assert-based stationary watchdog tests; zero external frameworks
import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import { MotionWatchdog } from '../src/intelligence/motion_watchdog.mjs'

console.log('[*] Running MotionWatchdog Stationary & AFK Exemption Test Suite...\n')

function createMockBot(initialPos = { x: 100, y: 64, z: 200 }) {
  const bot = new EventEmitter()
  bot.username = 'Bob'
  bot.entity = {
    position: { ...initialPos }
  }
  bot.targetDigBlock = null
  bot.collectBlock = null
  return bot
}

let simulatedTime = 1000000
const now = () => simulatedTime
const advanceSec = (s) => { simulatedTime += s * 1000 }

// Gate 1: Commanded Standby Exemption (!stop / !stay)
{
  const bot = createMockBot()
  const alerts = []
  const watchdog = new MotionWatchdog(bot, {
    idleThresholdSec: 10,
    now,
    onAlert: (msg) => { if (msg) alerts.push(msg) }
  })

  // Command bot to stand still
  watchdog.setMode('STANDBY', 'Commanded stop/stay')

  // Advance 30 seconds while remaining stationary
  advanceSec(30)
  const st = watchdog.evaluateCheck()

  assert.strictEqual(st.isAlerting, false, 'Commanded standby must NOT alert when standing still')
  assert.strictEqual(st.isExempt, true, 'STANDBY mode must be marked exempt')
  assert.strictEqual(st.mode, 'STANDBY')
  assert.strictEqual(alerts.length, 0, 'No alerts should be emitted for commanded standby')
  console.log('  [PASS] Gate 1: Commanded Standby (!stop / !stay) is exempt from stationary alerts')
}

// Gate 2: Commanded AFK Farm Exemption (!afk farm)
{
  const bot = createMockBot({ x: -228, y: 62, z: 97 })
  const alerts = []
  const watchdog = new MotionWatchdog(bot, {
    idleThresholdSec: 10,
    now,
    onAlert: (msg) => { if (msg) alerts.push(msg) }
  })

  // Command bot to AFK at farm
  watchdog.setMode('AFK_FARM', 'AFK at wheat farm')

  // Advance 120 seconds while remaining stationary at farm
  advanceSec(120)
  const st = watchdog.evaluateCheck()

  assert.strictEqual(st.isAlerting, false, 'AFK at farm must NOT alert when standing still')
  assert.strictEqual(st.isExempt, true, 'AFK_FARM mode must be marked exempt')
  assert.strictEqual(st.mode, 'AFK_FARM')
  assert.strictEqual(alerts.length, 0, 'No alerts should be emitted for farm AFK')
  console.log('  [PASS] Gate 2: Commanded AFK at farm (!afk farm) is exempt from stationary alerts')
}

// Gate 3: Active Task Stationary Alert (!mine / !build / !goto)
{
  const bot = createMockBot({ x: 50, y: 65, z: 120 })
  const alerts = []
  const watchdog = new MotionWatchdog(bot, {
    idleThresholdSec: 10,
    now,
    onAlert: (msg) => { if (msg) alerts.push(msg) }
  })

  // Command active task
  watchdog.setMode('TASK_ACTIVE', 'mine:iron_ore')

  // 5 seconds: still within threshold
  advanceSec(5)
  let st = watchdog.evaluateCheck()
  assert.strictEqual(st.isAlerting, false, 'Under threshold must not alert yet')

  // 12 seconds: exceeded 10s threshold while standing still
  advanceSec(7)
  st = watchdog.evaluateCheck()
  assert.strictEqual(st.isAlerting, true, 'Stationary during active task must alert after 10s')
  assert.strictEqual(st.isExempt, false, 'Active task is not exempt')
  assert.strictEqual(alerts.length, 1, 'Alert callback must be triggered')
  assert.ok(alerts[0].includes('Bob is standing still unexpectedly for 12s'), 'Alert message must specify agent and duration')
  assert.ok(alerts[0].includes('mine:iron_ore'), 'Alert message must cite active task')
  console.log('  [PASS] Gate 3: Unexpected stillness during active task triggers alert with task context')
}

// Gate 4: Legitimate Stationary Digging Exemption
{
  const bot = createMockBot({ x: 10, y: 20, z: 30 })
  const alerts = []
  const watchdog = new MotionWatchdog(bot, {
    idleThresholdSec: 10,
    now,
    onAlert: (msg) => { if (msg) alerts.push(msg) }
  })

  watchdog.setMode('TASK_ACTIVE', 'mine:obsidian')

  // Bot is actively digging a hard block
  bot.targetDigBlock = { name: 'obsidian', position: { x: 10, y: 19, z: 30 } }

  // Advance 25 seconds while mining obsidian
  advanceSec(25)
  const st = watchdog.evaluateCheck()

  assert.strictEqual(st.isAlerting, false, 'Actively digging block must NOT trigger stationary alert')
  assert.strictEqual(st.isDigging, true, 'Watchdog must identify active dig operation')
  assert.strictEqual(alerts.length, 0, 'No alert fired during legitimate digging')
  console.log('  [PASS] Gate 4: Legitimate block digging is exempt from stationary alert')
}

// Gate 5: Movement Resets Stationary Timer & Clears Alert
{
  const bot = createMockBot({ x: 0, y: 64, z: 0 })
  const alerts = []
  const watchdog = new MotionWatchdog(bot, {
    idleThresholdSec: 10,
    now,
    onAlert: (msg) => { if (msg) alerts.push(msg) }
  })

  watchdog.setMode('TASK_ACTIVE', 'patrol')

  // Trigger alert at 15s
  advanceSec(15)
  let st = watchdog.evaluateCheck()
  assert.strictEqual(st.isAlerting, true)

  // Bot moves to (5, 64, 0)
  bot.entity.position.x = 5
  advanceSec(1)
  st = watchdog.evaluateCheck()

  assert.strictEqual(st.isAlerting, false, 'Movement must clear alert state')
  assert.strictEqual(st.stationaryDurationSec, 0, 'Movement must reset stationary timer')
  console.log('  [PASS] Gate 5: Movement clears alert and resets stationary counter')
}

// Gate 6: Query Status Structured Payload
{
  const bot = createMockBot({ x: -240, y: 65, z: 97 })
  const watchdog = new MotionWatchdog(bot, {
    idleThresholdSec: 10,
    now
  })
  watchdog.setMode('TASK_ACTIVE', 'build:shelter')
  advanceSec(14)
  watchdog.evaluateCheck()

  const q = watchdog.queryStatus()
  assert.strictEqual(q.username, 'Bob')
  assert.strictEqual(q.mode, 'TASK_ACTIVE')
  assert.strictEqual(q.activeTask, 'build:shelter')
  assert.deepStrictEqual(q.position, { x: -240, y: 65, z: 97 })
  assert.strictEqual(q.isAlerting, true)
  assert.ok(q.alertReason.includes('Stationary for 14s'), 'Query status includes detailed alert reason')
  console.log('  [PASS] Gate 6: queryStatus() exposes structured telemetry for CLI and test queries')
}

console.log('\n[✓] All 6 MotionWatchdog gates PASSED.')
