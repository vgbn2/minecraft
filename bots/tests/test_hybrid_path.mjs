// Test Suite for Hybrid Kinematics Kernel (mc_path_core Rust + Node.js Navigator)
import assert from 'assert'
import { sliceTrajectory, getNativePathFinder } from '../src/kinematics/navigator.mjs'

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

console.log('PASS: test_hybrid_path.mjs completed successfully with 0 errors.')
