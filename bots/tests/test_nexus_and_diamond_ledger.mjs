// Test Suite for Issue #26: Nexus Socket Broker, Hard-Money Diamond Standard ($DIA) Ledger & Unit-Integral AMM
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { NexusBrokerServer, NexusClient, encodeFrame, FrameDecoder } from '../src/core/nexus_broker.mjs'
import { DiamondStandardLedger, CRED_PER_DIAMOND, CRED_PER_ANCIENT_DEBRIS } from '../src/intelligence/diamond_ledger.mjs'
import { LeakyBucketLimiter, getToolsForRole } from '../src/intelligence/ai_agent.mjs'

console.log('=== TEST: Nexus Socket Broker & Hard-Money Diamond Standard ($DIA) Ledger (#26) ===')

// -----------------------------------------------------------------------------
// Gate 1: Length-Prefixed FrameDecoder Coalesced & Fragmented Stream Integrity
// -----------------------------------------------------------------------------
const decoded = []
const decoder = new FrameDecoder(m => decoded.push(m))
const f1 = encodeFrame({ seq: 1, cmd: '!mine diamond_ore 4' })
const f2 = encodeFrame({ seq: 2, cmd: '!harvest' })
const combined = Buffer.concat([f1, f2])
// Push fragmented chunks (first 3 bytes, next 7 bytes, remainder)
decoder.push(combined.subarray(0, 3))
assert.equal(decoded.length, 0)
decoder.push(combined.subarray(3, 10))
decoder.push(combined.subarray(10))
assert.equal(decoded.length, 2)
assert.equal(decoded[0].seq, 1)
assert.equal(decoded[1].seq, 2)
console.log('  [PASS] Gate 1: 4-byte u32 BE length-prefixed FrameDecoder verified under stream fragmentation')

// -----------------------------------------------------------------------------
// Gate 2: Nexus Unix Domain Socket Broker (0700/0600 perms, target & broadcast)
// -----------------------------------------------------------------------------
const testDir = `/dev/shm/mc-bot-nexus-test-${process.pid}`
const sockPath = path.join(testDir, 'nexus.sock')
const broker = new NexusBrokerServer({ baseDir: testDir, socketPath: sockPath })
await broker.listen()

try {
  const dirMode = fs.statSync(testDir).mode & 0o777
  const sockMode = fs.statSync(sockPath).mode & 0o777
  assert.equal(dirMode, 0o700, 'Nexus directory must enforce 0700 permissions')
  assert.equal(sockMode, 0o600, 'Nexus socket must enforce 0600 permissions')

  const jotaro = new NexusClient('Jotaro', { socketPath: sockPath })
  const polnareff = new NexusClient('Polnareff', { socketPath: sockPath })
  const kakyoin = new NexusClient('Kakyoin', { socketPath: sockPath })
  await Promise.all([jotaro.connect(), polnareff.connect(), kakyoin.connect()])

  const roster = await jotaro.getRoster()
  assert.deepEqual(roster.sort(), ['Jotaro', 'Kakyoin', 'Polnareff'])

  const polInbox = []
  const kakInbox = []
  polnareff.on('message', m => polInbox.push(m))
  kakyoin.on('message', m => kakInbox.push(m))

  const ackDirect = await jotaro.sendTo('Polnareff', { cmd: '!mine deepslate_diamond_ore 2' })
  assert.equal(ackDirect.delivered, 1)
  await new Promise(r => setTimeout(r, 30))
  assert.equal(polInbox.length, 1)
  assert.equal(polInbox[0].cmd, '!mine deepslate_diamond_ore 2')
  assert.equal(kakInbox.length, 0)

  await jotaro.sendTo('all', { cmd: '!stop' })
  await new Promise(r => setTimeout(r, 30))
  assert.equal(polInbox.length, 2)
  assert.equal(kakInbox.length, 1)
  assert.equal(kakInbox[0].cmd, '!stop')

  jotaro.close()
  polnareff.close()
  kakyoin.close()
  console.log('  [PASS] Gate 2: Nexus Unix socket broker (0700/0600 perms, direct & broadcast routing) verified')
} finally {
  await broker.close()
  try { fs.rmSync(testDir, { recursive: true, force: true }) } catch {}
}

// -----------------------------------------------------------------------------
// Gate 3: Hard-Money Diamond Standard ($DIA) 2-Phase Custody & Anti-Farming Gate
// -----------------------------------------------------------------------------
const dbPath = `/dev/shm/mc-diamond-ledger-${process.pid}.sqlite`
const ledger = new DiamondStandardLedger(dbPath)
try {
  // 3.1 Strictly reject farmable/renewable items (Iron, Emerald, Gold)
  for (const farmable of ['iron_ore', 'emerald_ore', 'gold_ingot', 'wheat', 'coal_ore']) {
    assert.throws(
      () => ledger.submitProvenanceClaim({ minerId: 'Miner_1', blockType: farmable, x: 10, y: -58, z: 20 }),
      /non-farmable/,
      `Farmable item ${farmable} must be rejected as base money reserve`
    )
  }

  // 3.2 Phase 1: Valid deepslate_diamond_ore claim
  const claim1 = ledger.submitProvenanceClaim({
    minerId: 'Polnareff',
    blockType: 'deepslate_diamond_ore',
    x: 120,
    y: -58,
    z: -340,
    worldEpoch: 1
  })
  assert.equal(claim1.status, 'PENDING_CUSTODY')
  assert.equal(ledger.getBalance('Polnareff'), 0, 'Phase 1 PENDING_CUSTODY must NOT mint $CRED before chest deposit')

  // Duplicate coordinate in same world_epoch must fail UNIQUE constraint (prevents silk-touch place/break loop)
  assert.throws(
    () => ledger.submitProvenanceClaim({
      minerId: 'Polnareff',
      blockType: 'deepslate_diamond_ore',
      x: 120,
      y: -58,
      z: -340,
      worldEpoch: 1
    }),
    /UNIQUE constraint failed/,
    'Re-mining identical (world_epoch, x, y, z) coordinate must be rejected'
  )

  // 3.3 Monotonic fencing_token chest lock & Phase 2 physical verification
  const lock1 = ledger.acquireChestLock('TREASURY_CHEST_1', 'Polnareff', 1000, 5000)
  assert.equal(lock1.ok, true)
  assert.equal(lock1.fencingToken, 1)

  // Another agent cannot steal active chest lock before expiry
  const stealAttempt = ledger.acquireChestLock('TREASURY_CHEST_1', 'Miner_2', 2000, 5000)
  assert.equal(stealAttempt.ok, false)

  // After lock expires at t=7000, Miner_2 acquires token=2; Polnareff's stale token=1 must be rejected!
  const lock2 = ledger.acquireChestLock('TREASURY_CHEST_1', 'Miner_2', 7000, 5000)
  assert.equal(lock2.ok, true)
  assert.equal(lock2.fencingToken, 2)

  assert.throws(
    () => ledger.verifyTreasuryDeposit({
      claimId: claim1.claimId,
      chestId: 'TREASURY_CHEST_1',
      observedDelta: 1,
      fencingToken: lock1.fencingToken,
      nowMs: 7500
    }),
    /Stale or invalid fencing_token/,
    'Stale fencing_token must be rejected'
  )

  // Polnareff re-acquires lock at t=13000 (token=3) and completes physical chest deposit
  const lock3 = ledger.acquireChestLock('TREASURY_CHEST_1', 'Polnareff', 13000, 5000)
  assert.equal(lock3.fencingToken, 3)

  const mintRes = ledger.verifyTreasuryDeposit({
    claimId: claim1.claimId,
    chestId: 'TREASURY_CHEST_1',
    observedDelta: 1,
    fencingToken: lock3.fencingToken,
    nowMs: 13500
  })
  assert.equal(mintRes.ok, true)
  assert.equal(mintRes.mintedCred, CRED_PER_DIAMOND)
  assert.equal(ledger.getBalance('Polnareff'), 100)

  // Sovereign Ancient Debris reserve mints 1000 $CRED
  const debrisClaim = ledger.submitProvenanceClaim({
    minerId: 'Polnareff',
    blockType: 'ancient_debris',
    x: 50,
    y: 15,
    z: 50,
    worldEpoch: 1
  })
  ledger.verifyTreasuryDeposit({
    claimId: debrisClaim.claimId,
    chestId: 'TREASURY_CHEST_1',
    observedDelta: 1,
    fencingToken: lock3.fencingToken,
    nowMs: 14000
  })
  assert.equal(ledger.getBalance('Polnareff'), 100 + CRED_PER_ANCIENT_DEBRIS)
  const reserves = ledger.getReserveState()
  assert.equal(reserves.diamond.physicalUnits, 1)
  assert.equal(reserves.diamond.mintedCred, 100)
  assert.equal(reserves.ancient_debris.physicalUnits, 1)
  assert.equal(reserves.ancient_debris.mintedCred, 1000)
  console.log('  [PASS] Gate 3: 2-Phase Treasury Chest Custody, fencing_token lock & non-farmable $DIA minting verified')

  // ---------------------------------------------------------------------------
  // Gate 4: Unit-Integral AMM Bonding Curve (Zero Path-Dependence Arbitrage)
  // ---------------------------------------------------------------------------
  ledger.ensureAccount('TREASURY_VAULT', 'sovereign', 5000)
  ledger.registerCommodity('bread', 25, 0.05, 10)

  // Compare 5-unit batch sell quote vs 5 sequential 1-unit sells
  const batchSellQuote = ledger.quoteSellToMarket('bread', 5)
  let seqSellSum = 0
  for (let i = 0; i < 5; i++) {
    const res = ledger.sellToMarket('Kakyoin', 'bread', 1)
    seqSellSum += res.payoutCred
  }
  assert.equal(batchSellQuote, seqSellSum, 'Batch sell quote must equal exact sum of sequential 1-unit sales')

  // Buying those 5 units back in one batch must cost the exact same integer $CRED paid out!
  const buyBackQuote = ledger.quoteBuyFromMarket('bread', 5)
  assert.equal(buyBackQuote, seqSellSum, 'Buying N units back from S+N->S must equal selling N units from S->S+N (zero arbitrage)')
  const buyRes = ledger.buyFromMarket('Kakyoin', 'bread', 5)
  assert.equal(buyRes.costCred, seqSellSum)
  assert.equal(buyRes.newBalanceCred, 0, 'Round-trip sell(5) + buy(5) must leave 0 arbitrage profit')
  console.log('  [PASS] Gate 4: Unit-integral AMM bonding curve verified with 0 path-dependence arbitrage')
} finally {
  ledger.close()
  try { fs.rmSync(dbPath, { force: true }) } catch {}
  try { fs.rmSync(`${dbPath}-wal`, { force: true }) } catch {}
  try { fs.rmSync(`${dbPath}-shm`, { force: true }) } catch {}
}

// -----------------------------------------------------------------------------
// Gate 5: Leaky-Bucket LLM Rate Limiter & Role Tool Schema Pruning
// -----------------------------------------------------------------------------
const limiter = new LeakyBucketLimiter(2, 10)
let peakActive = 0
let currentActive = 0
await Promise.all(
  Array.from({ length: 6 }, () =>
    limiter.run(async () => {
      currentActive++
      if (currentActive > peakActive) peakActive = currentActive
      await new Promise(r => setTimeout(r, 15))
      currentActive--
    })
  )
)
assert.equal(peakActive, 2, 'LeakyBucketLimiter(2) must cap concurrent execution at <= 2')
assert.ok(getToolsForRole('miner').length < getToolsForRole('commander').length, 'Specialist miner role must receive pruned tool schema')
console.log('  [PASS] Gate 5: Leaky-bucket concurrency limiter (maxConcurrent=2) & role schema pruning verified')

console.log('\nPASS: test_nexus_and_diamond_ledger.mjs completed successfully with 0 errors.')
