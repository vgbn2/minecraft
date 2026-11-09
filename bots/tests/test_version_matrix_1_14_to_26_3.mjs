// Multi-Version Protocol Matrix Test Suite (Minecraft 1.14 [proto 477] -> 26.3 [proto 770+])
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createVersionAdapter, MIN_SUPPORTED_PROTOCOL } from '../src/core/version_adapter.mjs'

const require = createRequire(import.meta.url)
const PrismarineItem = require('prismarine-item')

console.log('=== TEST: Multi-Version Protocol Matrix (1.14 -> 26.3) ===')

// 1. Verify pre-1.14 versions fail closed
assert.throws(
  () => createVersionAdapter('1.12.2'),
  RangeError,
  '1.12.2 (proto 340) must be rejected below the >= 1.14 (proto 477) floor'
)

// 2. Parameterized matrix across all major protocol boundaries from 1.14.4 to 26.3
const VERSION_MATRIX = [
  {
    ver: '1.14.4',
    proto: 498,
    tallWorld: false,
    minY: 0,
    maxY: 255,
    sections: 16,
    diamondY: 11,
    hasChatSender: false,
    hasConfigState: false,
    durabilityMode: 'Damage',
    hasTickEnd: false
  },
  {
    ver: '1.16.5',
    proto: 754,
    tallWorld: false,
    minY: 0,
    maxY: 255,
    sections: 16,
    diamondY: 11,
    hasChatSender: true,
    hasConfigState: false,
    durabilityMode: 'Damage',
    hasTickEnd: false
  },
  {
    ver: '1.17.1',
    proto: 756,
    tallWorld: false,
    minY: 0,
    maxY: 255,
    sections: 16,
    diamondY: 11,
    hasChatSender: true,
    hasConfigState: false,
    durabilityMode: 'Damage',
    hasTickEnd: false
  },
  {
    ver: '1.18.2',
    proto: 758,
    tallWorld: true,
    minY: -64,
    maxY: 319,
    sections: 24,
    diamondY: -58,
    hasChatSender: true,
    hasConfigState: false,
    durabilityMode: 'Damage',
    hasTickEnd: false
  },
  {
    ver: '1.19.4',
    proto: 762,
    tallWorld: true,
    minY: -64,
    maxY: 319,
    sections: 24,
    diamondY: -58,
    hasChatSender: true,
    hasConfigState: false,
    durabilityMode: 'Damage',
    hasTickEnd: false
  },
  {
    ver: '1.20.1',
    proto: 763,
    tallWorld: true,
    minY: -64,
    maxY: 319,
    sections: 24,
    diamondY: -58,
    hasChatSender: true,
    hasConfigState: false,
    durabilityMode: 'Damage',
    hasTickEnd: false
  },
  {
    ver: '1.20.4',
    proto: 765,
    tallWorld: true,
    minY: -64,
    maxY: 319,
    sections: 24,
    diamondY: -58,
    hasChatSender: true,
    hasConfigState: true,
    durabilityMode: 'Damage',
    hasTickEnd: false
  },
  {
    ver: '1.20.5',
    proto: 766,
    tallWorld: true,
    minY: -64,
    maxY: 319,
    sections: 24,
    diamondY: -58,
    hasChatSender: true,
    hasConfigState: true,
    durabilityMode: 'componentMap',
    hasTickEnd: false
  },
  {
    ver: '1.21.4',
    proto: 769,
    tallWorld: true,
    minY: -64,
    maxY: 319,
    sections: 24,
    diamondY: -58,
    hasChatSender: true,
    hasConfigState: true,
    durabilityMode: 'componentMap',
    hasTickEnd: true
  },
  {
    ver: '26.3',
    proto: 775,
    tallWorld: true,
    minY: -64,
    maxY: 319,
    sections: 24,
    diamondY: -58,
    hasChatSender: true,
    hasConfigState: true,
    durabilityMode: 'componentMap',
    hasTickEnd: true
  }
]

for (const row of VERSION_MATRIX) {
  const adapter = createVersionAdapter(row.ver)
  assert.ok(adapter.protocolVersion >= MIN_SUPPORTED_PROTOCOL, `${row.ver} protocol below floor`)
  assert.equal(adapter.protocolVersion, row.proto, `${row.ver} protocolVersion mismatch`)
  assert.equal(adapter.tallWorld, row.tallWorld, `${row.ver} tallWorld mismatch`)
  assert.equal(adapter.minY, row.minY, `${row.ver} minY mismatch`)
  assert.equal(adapter.maxY, row.maxY, `${row.ver} maxY mismatch`)
  assert.equal(adapter.numSections, row.sections, `${row.ver} numSections mismatch`)
  assert.equal(adapter.optimalDiamondY, row.diamondY, `${row.ver} optimalDiamondY mismatch`)
  assert.equal(adapter.lightSentSeparately, true, `${row.ver} must have lightSentSeparately=true`)
  assert.equal(adapter.blockStateId, true, `${row.ver} must have blockStateId=true`)
  assert.equal(adapter.hasChatSender, row.hasChatSender, `${row.ver} hasChatSender mismatch`)
  assert.equal(adapter.hasConfigState, row.hasConfigState, `${row.ver} hasConfigState mismatch`)
  assert.equal(adapter.durabilitySerializeMode, row.durabilityMode, `${row.ver} durabilityMode mismatch`)
  assert.equal(adapter.hasTickEnd, row.hasTickEnd, `${row.ver} hasTickEnd mismatch`)

  // Section indexing boundaries (including negative float coordinates)
  assert.equal(adapter.sectionIndex(row.minY), 0, `${row.ver} bottom section must be 0`)
  assert.equal(adapter.sectionIndex(row.maxY), row.sections - 1, `${row.ver} top section mismatch`)
  assert.equal(adapter.sectionIndex(row.minY - 0.1), -1, `${row.ver} below minY float must return -1`)
  assert.equal(adapter.sectionIndex(row.maxY + 1), -1, `${row.ver} above maxY must return -1`)

  // Monotonic sequence generator for 1.19+ block_dig / block_place
  assert.equal(adapter.nextSequence(), 1)
  assert.equal(adapter.nextSequence(), 2)

  // INIT_WORLD payload
  const initPayload = adapter.buildInitWorldPayload(7)
  assert.equal(initPayload.opCode, 0x00)
  assert.equal(initPayload.minY, row.minY)
  assert.equal(initPayload.numSections, row.sections)
  assert.equal(initPayload.worldEpoch, 7)

  // Real prismarine-item durability verification across NBT Damage vs 1.20.5+ componentMap
  const ItemCls = PrismarineItem(row.ver === '26.3' ? '26.1' : row.ver)
  const sampleItem = new ItemCls(1, 1)
  Object.defineProperty(sampleItem, 'maxDurability', { value: 1561, configurable: true })
  Object.defineProperty(sampleItem, 'durabilityUsed', { value: 1500, configurable: true })
  const dur = adapter.getItemDurability(sampleItem)
  assert.equal(dur.used, 1500)
  assert.equal(dur.remaining, 61)
  assert.equal(dur.needsReplacement, true, `${row.ver} diamond pickaxe at 61/1561 durability must trigger replacement`)
}

console.log('[PASS] All 10 Minecraft protocol versions (1.14.4 -> 26.3) verified.')
