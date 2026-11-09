// Test Suite for Issue #24: 500-Bot Swarm Worker Multiplexer, RefCountedColumnStore & 2 Hz Physics Decimation
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { RefCountedColumnStore } from '../src/core/ref_counted_world.mjs'
import { SwarmWorkerMultiplexer, MAX_BOTS_PER_WORKER } from '../src/core/swarm_worker.mjs'
import { CombatEvasionController } from '../src/kinematics/combat_evasion.mjs'
import { IpcManager } from '../src/core/ipc.mjs'

console.log('=== TEST: 500-Bot Swarm Worker Multiplexer & Shared Column Store (#24) ===')

// -----------------------------------------------------------------------------
// Gate 1: RefCountedColumnStore 50x Chunk Deduplication & Safe Unload Retention
// -----------------------------------------------------------------------------
let firstLoadEvents = 0
const store = new RefCountedColumnStore({
  onFirstLoad: () => { firstLoadEvents++ }
})
// Simulate 50 co-located bots loading a 5x5 chunk grid (25 columns around spawn)
for (let b = 1; b <= 50; b++) {
  const agentId = `Miner_${b}`
  for (let cx = -2; cx <= 2; cx++) {
    for (let cz = -2; cz <= 2; cz++) {
      store.setColumn(agentId, cx, cz, { cx, cz, sections: 24 })
    }
  }
}

assert.equal(store.columnCount, 25, '50 co-located bots across a 5x5 grid must store only 25 unique ChunkColumns (not 1,250)')
assert.equal(firstLoadEvents, 25, 'onFirstLoad (0 -> 1 refCount transition) must fire exactly 25 times, eliminating 50x duplicate forwarding')
assert.equal(store.totalReferences, 50 * 25, 'Total references must track all 1,250 agent-column bindings')

// Unloading chunk (0, 0) on 49 bots must retain the column for the 50th bot
for (let b = 1; b <= 49; b++) {
  const evicted = store.unloadColumn(`Miner_${b}`, 0, 0)
  assert.equal(evicted, false, `Unloading (0,0) on Miner_${b} must NOT evict while Miner_50 still references it`)
}
assert.ok(store.getColumn(0, 0), 'Column (0,0) must still be present for Miner_50')

// Unloading on the 50th bot evicts the column
const finalEvict = store.unloadColumn('Miner_50', 0, 0)
assert.equal(finalEvict, true, 'Unloading last reference must evict column (0,0)')
assert.equal(store.getColumn(0, 0), undefined)
assert.equal(store.columnCount, 24)
console.log('  [PASS] Gate 1: RefCountedColumnStore 50x chunk deduplication & reference-safe eviction verified')

// -----------------------------------------------------------------------------
// Gate 2: SwarmWorkerMultiplexer (50 Citizen Bots / Worker Instance Isolation)
// -----------------------------------------------------------------------------
const testIpcDir = `/dev/shm/mc-swarm-test-${process.pid}`
const mux = new SwarmWorkerMultiplexer({
  workerId: 0,
  maxBots: MAX_BOTS_PER_WORKER,
  ipcBaseDir: testIpcDir,
  staggerDelayMs: 0,
  createBotFn: (opts) => {
    const bot = new EventEmitter()
    bot.username = opts.username
    bot.entity = { position: { x: 0, y: 64, z: 0 } }
    bot.isAlive = true
    bot.health = 20
    bot.chats = []
    bot.chat = (m) => bot.chats.push(m)
    bot.whisper = (t, m) => bot.chats.push(`@${t}:${m}`)
    bot.quit = () => { bot.isAlive = false }
    return bot
  }
})

try {
  const specs = Array.from({ length: 50 }, (_, idx) => ({
    username: `Miner_${idx + 1}`,
    role: 'miner',
    enableIpc: true,
    startIpc: false,
    onFastCommand: async (sender, cmd, args) => {
      if (cmd === 'status') return true
      return false
    }
  }))

  const instances = await mux.spawnBatch(specs)
  assert.equal(instances.length, 50, 'Worker must multiplex 50 isolated bot instances')

  // Verify capacity ceiling (51st bot in same worker throws RangeError)
  await assert.rejects(
    () => mux.spawnBatch([{ username: 'Miner_51', role: 'miner' }]),
    RangeError,
    'Exceeding 50 bots per worker must throw RangeError'
  )

  // Verify dynamic roster registration in /dev/shm
  const roster = IpcManager.getActiveRoster(testIpcDir)
  assert.equal(roster.length, 50, 'All 50 multiplexed citizen bots must be registered in active IPC roster')

  // Save a shared chunk through Miner_1's adapter and read it through Miner_50's adapter
  await instances[0].storageAdapter.save(10, -5, { chunkId: '10,-5' })
  const sharedChunk = await instances[49].storageAdapter.load(10, -5)
  assert.deepEqual(sharedChunk, { chunkId: '10,-5' }, 'Miner_50 must read shared chunk loaded by Miner_1')

  // Remove Miner_1 and verify its references are cleaned up without breaking Miner_2..50
  assert.equal(mux.removeAgent('Miner_1'), true)
  assert.equal(mux.agents.size, 49)
  console.log('  [PASS] Gate 2: SwarmWorkerMultiplexer 50-bot isolation, shared storage & roster verified')
} finally {
  mux.stopAll()
  try { fs.rmSync(testIpcDir, { recursive: true, force: true }) } catch {}
}

// -----------------------------------------------------------------------------
// Gate 3: 2 Hz Non-Combat Physics Tick Decimation (20 Hz -> 2 Hz idle scan)
// -----------------------------------------------------------------------------
const mockBot = new EventEmitter()
mockBot.entity = { position: { x: 0, y: 64, z: 0 }, onGround: true }
mockBot.setControlState = () => {}
mockBot.clearControlStates = () => {}
mockBot.lookAt = () => {}
mockBot.attack = () => {}

const evasion = new CombatEvasionController(mockBot, { idleTickStride: 10 })

// Emit 20 physics ticks while inactive (non-combat)
for (let i = 0; i < 20; i++) {
  mockBot.emit('physicsTick')
}
assert.equal(evasion.passiveScanCount, 2, '20 ticks at 20 Hz with stride=10 must run exactly 2 passive scans (2 Hz)')
assert.equal(evasion.activeTickCount, 0)

// Activate combat and emit 20 ticks -> all 20 ticks must run at full 20 Hz
evasion.start({ isValid: true, name: 'zombie', position: { x: 0, y: 64, z: 2.8, offset: () => ({ x: 0, y: 65.4, z: 2.8 }) } })
for (let i = 0; i < 20; i++) {
  mockBot.emit('physicsTick')
}
assert.equal(evasion.activeTickCount, 20, 'Active combat must run at full 20 Hz (20/20 ticks)')
console.log('  [PASS] Gate 3: 2 Hz non-combat physicsTick decimation & 20 Hz active combat verified')

console.log('\nPASS: test_swarm_multiplexer.mjs completed successfully with 0 errors.')
