import assert from 'node:assert'
import {
  getHydrationBoundary,
  isCropMature,
  MATURE_CROP_AGES,
  TILLABLE_BLOCKS
} from '../src/skills/agriculture_tech.mjs'
import { Vec3 } from 'vec3'

console.log('[*] Testing Agriculture & Tech Tree Engine...')

// Gate 1: Hydration Boundary Count (9x9 Chebyshev square minus center water block = 80 plots)
const waterPos = new Vec3(100, 64, 100)
const flatPlots = getHydrationBoundary(waterPos, false)
assert.strictEqual(flatPlots.length, 80, 'Flat hydration boundary must contain exactly 80 farmland plots')

const multiLevelPlots = getHydrationBoundary(waterPos, true)
// 80 on Y level + 81 on Y-1 level = 161 plots
assert.strictEqual(multiLevelPlots.length, 161, 'Multi-level hydration boundary must contain exactly 161 plots')
console.log('  [PASS] 9x9 Chebyshev hydration geometry (80 plots flat, 161 multi-level)')

// Gate 2: Crop Maturity Predicate
const immatureWheat = { name: 'wheat', metadata: 4 }
assert.strictEqual(isCropMature(immatureWheat), false, 'Wheat metadata 4 is immature')

const matureWheat = { name: 'wheat', metadata: 7 }
assert.strictEqual(isCropMature(matureWheat), true, 'Wheat metadata 7 is mature')

const propertyWheat = { name: 'wheat', _properties: { age: '7' } }
assert.strictEqual(isCropMature(propertyWheat), true, 'Wheat age property 7 is mature')
console.log('  [PASS] Crop maturity state detection')

// Gate 3: Tillable blocks lookup
assert.ok(TILLABLE_BLOCKS.has('grass_block'))
assert.ok(TILLABLE_BLOCKS.has('dirt'))
assert.ok(!TILLABLE_BLOCKS.has('stone'))
console.log('  [PASS] Tillable block classification')

console.log('PASS: test_agriculture_tech.mjs completed successfully with 0 errors.')
