// Self-contained Verification Suite for 20x20 Survival House Architecture
import assert from 'node:assert'
import { Vec3 } from 'vec3'
import {
  generateHouse20x20Plan,
  generateHouseClearancePlan,
  verifyHousePlanIntegrity,
  calculateMaterialBill,
  AutonomousArchitectureRunner,
  ScaffoldController,
  HOUSE_DIMENSIONS
} from '../src/skills/architecture_20x20.mjs'

console.log('=== 20x20 ARCHITECTURE BLUEPRINT & KINEMATIC ENGINE TESTS ===\n')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  [PASS] ${name}`)
    passed++
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`)
    failed++
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    console.log(`  [PASS] ${name}`)
    passed++
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`)
    failed++
  }
}

// 1. Blueprint Generation & Block Count
test('Gate 1: Blueprint generation & total voxel count', () => {
  const origin = new Vec3(0, 64, 0)
  const plan = generateHouse20x20Plan(origin)

  assert.ok(Array.isArray(plan), 'Plan must be an array')
  assert.ok(plan.length > 1000, `Plan must contain over 1000 voxels (got ${plan.length})`)

  const foundation = plan.filter(b => b.tag === 'foundation')
  assert.strictEqual(foundation.length, 400, `Foundation floor must contain exactly 400 blocks (got ${foundation.length})`)
})

// 2. Coordinate Boundaries & Dimensions
test('Gate 2: Coordinate boundaries & 20x20 dimensions', () => {
  const origin = new Vec3(100, 70, -50)
  const plan = generateHouse20x20Plan(origin)
  const integrity = verifyHousePlanIntegrity(plan, 69)

  assert.ok(integrity.valid, 'Integrity check must pass with zero floating blocks')
  assert.strictEqual(integrity.floatingCount, 0, 'Zero floating blocks allowed')

  const { bounds } = integrity
  // Width spans dx: -1..20 (span 22 including eaves overhang)
  assert.strictEqual(bounds.minX, 99, 'Min X must be origin.x - 1 (eaves overhang)')
  assert.strictEqual(bounds.maxX, 120, 'Max X must be origin.x + 20 (eaves overhang)')
  assert.strictEqual(bounds.width, 22, 'Total structure width must be 22 including eaves')

  // Height spans dy: 0..10 (span 11)
  assert.strictEqual(bounds.minY, 70, 'Min Y must match foundation origin.y')
  assert.strictEqual(bounds.maxY, 80, 'Max Y must be origin.y + 10')
  assert.strictEqual(bounds.height, 11, 'Total structure height must be 11 blocks')

  // Length spans dz: -1..20 (span 22 including porch step & eaves overhang)
  assert.strictEqual(bounds.minZ, -51, 'Min Z must be origin.z - 1')
  assert.strictEqual(bounds.maxZ, -30, 'Max Z must be origin.z + 20')
})

// 3. Layer-by-Layer Reference Dependency (No Floating Blocks)
test('Gate 3: Layer-by-layer dependency assertion (0 floating blocks)', () => {
  const origin = new Vec3(0, 64, 0)
  const plan = generateHouse20x20Plan(origin)
  const report = verifyHousePlanIntegrity(plan, 63)

  assert.strictEqual(report.floatingCount, 0, `All blocks must have reference faces (found ${report.floatingCount} floating)`)
  assert.strictEqual(report.valid, true, 'Blueprint must be structurally valid for survival placement')
})

// 4. Materials Breakdown Specification
test('Gate 4: Materials breakdown validation', () => {
  const origin = new Vec3(0, 64, 0)
  const plan = generateHouse20x20Plan(origin)
  const bill = calculateMaterialBill(plan)

  assert.ok(bill.cobblestone >= 76, `Cobblestone floor trim + base trim must exist (got ${bill.cobblestone})`)
  assert.strictEqual(bill.stone, 324, `Interior floor must be 18x18 = 324 stone (got ${bill.stone})`)
  assert.ok(bill.oak_log >= 60, `Corner and edge pillars must be oak_log (got ${bill.oak_log})`)
  assert.ok(bill.glass >= 32, `Windows and skylight must use glass (got ${bill.glass})`)
  assert.ok(bill.oak_stairs > 100, `Roof field must use oak_stairs (got ${bill.oak_stairs})`)
  assert.ok(bill.cobblestone_stairs > 50, `Roof trim must use cobblestone_stairs (got ${bill.cobblestone_stairs})`)
})

// 5. Framing, Windows, and 2-Wide Doorway
test('Gate 5: Architectural features (pillars, windows, entrance doorway)', () => {
  const origin = new Vec3(0, 64, 0)
  const plan = generateHouse20x20Plan(origin)

  // Doorway opening check: front wall (dz = 0, dx in [9, 10]) at dy = 1, 2 must NOT have solid wall blocks
  const doorBlockDy1 = plan.find(b => b.pos.x === 9 && b.pos.y === 65 && b.pos.z === 0)
  const doorBlockDy2 = plan.find(b => b.pos.x === 10 && b.pos.y === 66 && b.pos.z === 0)
  assert.strictEqual(doorBlockDy1, undefined, 'Doorway bottom (dx=9, dy=1, dz=0) must remain open for bot traversal')
  assert.strictEqual(doorBlockDy2, undefined, 'Doorway top (dx=10, dy=2, dz=0) must remain open for bot traversal')

  // Window cutouts: 2-block high glass at dy = 2, 3
  const windowVoxels = plan.filter(b => b.tag === 'window')
  assert.ok(windowVoxels.length >= 24, `Expected at least 24 window voxels, got ${windowVoxels.length}`)
  for (const w of windowVoxels) {
    assert.strictEqual(w.name, 'glass', 'Window voxels must be glass')
    assert.ok(w.layer === 2 || w.layer === 3, 'Windows must be 2 blocks high at layer 2 and 3')
  }

  // Pillar corners check
  const cornerPillars = plan.filter(b => b.tag === 'pillar')
  assert.ok(cornerPillars.length >= 60, `Pillars must include 12 pillars * 5 height = 60 blocks (got ${cornerPillars.length})`)
})

// 6. Kinematic Placement Runner & Scaffolding Controller Mock Simulation
await testAsync('Gate 6: AutonomousArchitectureRunner execution simulation', async () => {
  const worldBlocks = new Map()

  // Pre-seed ground at Y = 63
  for (let x = -5; x <= 25; x++) {
    for (let z = -5; z <= 25; z++) {
      worldBlocks.set(`${x},63,${z}`, { name: 'dirt', position: new Vec3(x, 63, z) })
    }
  }

  // Mock Mineflayer bot
  const mockBot = {
    entity: {
      position: new Vec3(0, 64, -2),
      floored: () => new Vec3(0, 64, -2)
    },
    inventory: {
      items: () => [
        { name: 'cobblestone', count: 500 },
        { name: 'stone', count: 500 },
        { name: 'oak_log', count: 500 },
        { name: 'oak_planks', count: 1000 },
        { name: 'glass', count: 200 },
        { name: 'oak_stairs', count: 500 },
        { name: 'cobblestone_stairs', count: 500 },
        { name: 'dirt', count: 64 },
        { name: 'diamond_shovel', count: 1 }
      ]
    },
    world: {},
    pathfinder: {
      isMoving: () => false,
      goto: async () => {},
      stop: () => {}
    },
    blockAt: (pos) => worldBlocks.get(`${pos.x},${pos.y},${pos.z}`) || { name: 'air', position: pos },
    equip: async (item, hand) => true,
    placeBlock: async (refBlock, faceVector) => {
      const placedPos = refBlock.position.plus(faceVector)
      worldBlocks.set(`${placedPos.x},${placedPos.y},${placedPos.z}`, { name: 'placed_block', position: placedPos })
    },
    dig: async (block) => {
      worldBlocks.delete(`${block.position.x},${block.position.y},${block.position.z}`)
    },
    setControlState: (control, state) => {}
  }

  const runner = new AutonomousArchitectureRunner(mockBot)
  assert.ok(runner.scaffold instanceof ScaffoldController, 'Runner must instantiate ScaffoldController')
  assert.strictEqual(runner.scaffold.bot, mockBot, 'ScaffoldController must bind bot instance')
  const miniPlan = generateHouse20x20Plan(new Vec3(0, 64, 0)).slice(0, 50)

  let progressCalls = 0
  const result = await runner.executePlan(miniPlan, {
    onProgress: (p) => { progressCalls++ }
  })

  assert.strictEqual(result.success, true, 'Runner should succeed on valid plan and inventory')
  assert.strictEqual(result.placed, 50, 'All 50 mock voxels should be placed')
  assert.strictEqual(progressCalls, 50, 'Progress callback should be triggered for each placed voxel')
})

// 7. House Site Clearance & Sector Decomposition
test('Gate 7: House clearance plan & squad sector partitioning', () => {
  const origin = new Vec3(-240, 65, 100)
  const fullPlan = generateHouseClearancePlan(origin, { width: 20, length: 20, height: 3, sector: 'all' })
  assert.strictEqual(fullPlan.length, 20 * 20 * 4, 'Full clearance: 20x20 footprint * 4 layers (dy: 0..3) = 1600 voxels')

  // Sector partitioning
  const nwPlan = generateHouseClearancePlan(origin, { width: 20, length: 20, height: 3, sector: 'NW' })
  const nePlan = generateHouseClearancePlan(origin, { width: 20, length: 20, height: 3, sector: 'NE' })
  const swPlan = generateHouseClearancePlan(origin, { width: 20, length: 20, height: 3, sector: 'SW' })
  const sePlan = generateHouseClearancePlan(origin, { width: 20, length: 20, height: 3, sector: 'SE' })

  assert.strictEqual(nwPlan.length, 10 * 10 * 4, 'NW Sector: 10x10 * 4 = 400 voxels')
  assert.strictEqual(nePlan.length, 10 * 10 * 4, 'NE Sector: 10x10 * 4 = 400 voxels')
  assert.strictEqual(swPlan.length, 10 * 10 * 4, 'SW Sector: 10x10 * 4 = 400 voxels')
  assert.strictEqual(sePlan.length, 10 * 10 * 4, 'SE Sector: 10x10 * 4 = 400 voxels')
  assert.strictEqual(nwPlan.length + nePlan.length + swPlan.length + sePlan.length, fullPlan.length, 'Sectors sum to full footprint')

  // Top-down sort invariant
  for (let i = 1; i < nwPlan.length; i++) {
    assert.ok(nwPlan[i].y <= nwPlan[i - 1].y, 'Clearance plan must sort Y descending')
  }
})

console.log(`\nVerification complete: ${passed} passed, ${failed} failed.`)
if (failed > 0) process.exit(1)
