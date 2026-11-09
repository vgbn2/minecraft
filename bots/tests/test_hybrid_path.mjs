// Test Suite for Hybrid Kinematics Kernel (mc_path_core Rust + Node.js Navigator)
import assert from 'assert'
import { sliceTrajectory, getNativePathFinder, PathDaemonClient } from '../src/kinematics/navigator.mjs'

console.log('[*] Testing Hybrid Kinematics (Rust mc_path_core & Node Navigator)...')

// Gate 1: Native binary discovery
const nativeBin = getNativePathFinder()
console.log(`  • Detected native binary: ${nativeBin || 'None (using JS fallback)'}`)
assert.ok(nativeBin, 'Native Rust pathfinder binary (mc-path-fast) must be detected')

// Gate 2: Basic trajectory slicing via Rust
const t0 = performance.now()
const hops = sliceTrajectory({ x: 0, y: 64, z: 0 }, { x: 64, y: 64, z: 64 }, 16)
const durationMs = performance.now() - t0

console.log(`  • Sliced 64m 3D diagonal into ${hops.length} hops in ${durationMs.toFixed(3)}ms`)
assert.ok(hops.length >= 4, `Expected at least 4 hops for ~90m diagonal vector, got ${hops.length}`)
assert.strictEqual(hops[0].hopIndex, 1, 'First hop must have hopIndex 1')
assert.strictEqual(hops[hops.length - 1].hopIndex, hops.length, 'Last hopIndex must equal totalHops')
assert.strictEqual(hops[hops.length - 1].x, 64, 'Final hop X must reach target')
assert.strictEqual(hops[hops.length - 1].y, 64, 'Final hop Y must reach target')
assert.strictEqual(hops[hops.length - 1].z, 64, 'Final hop Z must reach target')
console.log('  [PASS] Gate 1 & 2: Native binary discovery & diagonal trajectory slicing')

// Gate 3: Short hop boundary (< maxHop)
const shortHops = sliceTrajectory({ x: 10, y: 64, z: 10 }, { x: 15, y: 64, z: 12 }, 16)
assert.strictEqual(shortHops.length, 1, 'Distance <= maxHop must return exactly 1 hop')
assert.strictEqual(shortHops[0].x, 15)
assert.strictEqual(shortHops[0].z, 12)
console.log('  [PASS] Gate 3: Short hop boundary (<= maxHop)')

// Gate 4: Negative Cartesian coordinates & coordinate stability
const negHops = sliceTrajectory({ x: -100, y: 40, z: -100 }, { x: -20, y: 70, z: -20 }, 20)
assert.ok(negHops.length >= 5, 'Negative coordinate traversal must slice correctly')
for (const h of negHops) {
  assert.ok(Number.isInteger(h.x), 'Hop X must be integer')
  assert.ok(Number.isInteger(h.y), 'Hop Y must be integer')
  assert.ok(Number.isInteger(h.z), 'Hop Z must be integer')
}
const finalNeg = negHops[negHops.length - 1]
assert.strictEqual(finalNeg.x, -20)
assert.strictEqual(finalNeg.y, 70)
assert.strictEqual(finalNeg.z, -20)
console.log('  [PASS] Gate 4: Negative coordinate floor stability')

// Gate 5: Parity stress test across 20 randomized vectors
let parityPasses = 0
for (let i = 0; i < 20; i++) {
  const start = {
    x: Math.floor(Math.random() * 200 - 100),
    y: Math.floor(Math.random() * 50 + 40),
    z: Math.floor(Math.random() * 200 - 100)
  }
  const target = {
    x: Math.floor(Math.random() * 200 - 100),
    y: Math.floor(Math.random() * 50 + 40),
    z: Math.floor(Math.random() * 200 - 100)
  }
  const res = sliceTrajectory(start, target, 16)
  assert.ok(res.length > 0)
  const last = res[res.length - 1]
  assert.strictEqual(last.x, target.x)
  assert.strictEqual(last.y, target.y)
  assert.strictEqual(last.z, target.z)
  parityPasses++
}
console.log(`  [PASS] Gate 5: 20/20 randomized 3D vectors verified`)

// Gate 6: Persistent Unix Socket Daemon (INIT_WORLD, f32 slab/fence A*, and 16-byte SeqLock Spatial Leases) (#27)
const testSockPath = `/dev/shm/mc-path-test-${process.pid}.sock`
const daemonClient = new PathDaemonClient({ socketPath: testSockPath })
try {
  const initLegacy = await daemonClient.initWorld({ minY: 0, numSections: 16, protocolVersion: 754, worldEpoch: 1 })
  assert.strictEqual(initLegacy.ok, true)
  assert.strictEqual(initLegacy.minY, 0)
  assert.strictEqual(initLegacy.numSections, 16)

  const initModern = await daemonClient.initWorld({ minY: -64, numSections: 24, protocolVersion: 769, worldEpoch: 2 })
  assert.strictEqual(initModern.ok, true)
  assert.strictEqual(initModern.minY, -64)
  assert.strictEqual(initModern.numSections, 24)
  assert.strictEqual(initModern.worldEpoch, 2)

  // Build a 6x6 floor at y=63, with a bottom slab (nibble 0x3) at (2, 63, 2)
  for (let x = 0; x < 6; x++) {
    for (let z = 0; z < 6; z++) {
      await daemonClient.setClass(x, 63, z, 0x2) // SOLID_CUBE
    }
  }
  await daemonClient.setClass(2, 63, 2, 0x3) // SLAB_BOTTOM

  const f32Res = await daemonClient.findPathF32({ x: 1.2, y: 64.0, z: 2.8 }, { x: 3.7, y: 64.0, z: 2.1 })
  assert.strictEqual(f32Res.ok, true, 'Daemon ASTAR_F32 must succeed across slab floor')
  assert.strictEqual(f32Res.path[0].x, 1.5, 'Waypoint X must be block-centered (+0.5)')
  assert.strictEqual(f32Res.path[0].z, 2.5, 'Waypoint Z must be block-centered (+0.5)')
  assert.strictEqual(f32Res.path[1].x, 2.5)
  assert.strictEqual(f32Res.path[1].y, 64.5, 'Slab waypoint Y must include +0.5 sub-block elevation')

  // Spatial lease mutual exclusion & release over Unix socket
  const l1 = await daemonClient.acquireLease(100, -58, 200, 11, 30)
  assert.strictEqual(l1.ok, true, 'Agent 11 must acquire spatial lease')
  const l2 = await daemonClient.acquireLease(100, -58, 200, 22, 30)
  assert.strictEqual(l2.ok, false, 'Agent 22 must be blocked from active spatial lease')
  const rel = await daemonClient.releaseLease(100, -58, 200, 11)
  assert.strictEqual(rel.ok, true, 'Agent 11 must release spatial lease (writes TOMBSTONE)')
  const l3 = await daemonClient.acquireLease(100, -58, 200, 22, 30)
  assert.strictEqual(l3.ok, true, 'Agent 22 must acquire reclaimed TOMBSTONE lease slot')
  console.log('  [PASS] Gate 6: Persistent Unix socket daemon, f32 slab/block-centered waypoints & SeqLock leases verified')
} finally {
  daemonClient.close()
}

console.log('PASS: test_hybrid_path.mjs completed successfully with 0 errors.')
