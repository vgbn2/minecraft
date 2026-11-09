// Unit Test Suite for Intermediate NLP Translation Layer
import assert from 'node:assert'
import { NlpTranslationLayer, ROLE_AGENT_MAP, CRUSADER_NAMES } from '../src/intelligence/nlp_translator.mjs'

console.log('[*] Testing NLP Translation Layer (Human Speech -> Crusader Prompts)...')

const translator = new NlpTranslationLayer({
  landmarks: {
    base: { x: -240, y: 65, z: 97 },
    farm: { x: -240, y: 65, z: 117 }
  }
})

// -----------------------------------------------------------------------------
// Gate 1: Role & Persona Agent Mapping
// -----------------------------------------------------------------------------
console.log('  • Gate 1: Testing Role & Agent Mapping...')
assert.strictEqual(ROLE_AGENT_MAP.architect, 'Joseph')
assert.strictEqual(ROLE_AGENT_MAP.builder, 'Joseph')
assert.strictEqual(ROLE_AGENT_MAP.miner, 'Polnareff')
assert.strictEqual(ROLE_AGENT_MAP.sentinel, 'Avdol')
assert.strictEqual(ROLE_AGENT_MAP.guard, 'Avdol')
assert.strictEqual(ROLE_AGENT_MAP.harvester, 'Kakyoin')
assert.strictEqual(ROLE_AGENT_MAP.farmer, 'Kakyoin')
assert.strictEqual(ROLE_AGENT_MAP.scout, 'Iggy')
assert.strictEqual(ROLE_AGENT_MAP.commander, 'Jotaro')
console.log('  [PASS] Gate 1: Canonical Crusader roles verified.')

// -----------------------------------------------------------------------------
// Gate 2: Explicit Targeting & English Action Translation
// -----------------------------------------------------------------------------
console.log('  • Gate 2: Testing Explicit English Commands...')
const res1 = translator.translate('vgbn', 'Polnareff mine 15 iron_ore')
assert.strictEqual(res1.length, 1)
assert.strictEqual(res1[0].targetAgent, 'Polnareff')
assert.strictEqual(res1[0].intent, 'MINE')
assert.strictEqual(res1[0].command, '!mine iron_ore 15')
assert.ok(res1[0].tacticalBrief.includes('Silver Chariot'))

const res2 = translator.translate('vgbn', 'Joseph build a shelter with dirt')
assert.strictEqual(res2.length, 1)
assert.strictEqual(res2[0].targetAgent, 'Joseph')
assert.strictEqual(res2[0].intent, 'BUILD')
assert.strictEqual(res2[0].command, '!build shelter dirt')
assert.ok(res2[0].tacticalBrief.includes('Hermit Purple'))

console.log('  [PASS] Gate 2: Explicit English targeting verified.')

// -----------------------------------------------------------------------------
// Gate 3: Bilingual Vietnamese Translation & Domain Routing
// -----------------------------------------------------------------------------
console.log('  • Gate 3: Testing Vietnamese Translation & Implicit Domain Routing...')
// Implicit mining routes to Polnareff
const resVN1 = translator.translate('vgbn', 'đào 20 sắt')
assert.strictEqual(resVN1.length, 1)
assert.strictEqual(resVN1[0].targetAgent, 'Polnareff')
assert.strictEqual(resVN1[0].intent, 'MINE')
assert.strictEqual(resVN1[0].command, '!mine iron_ore 20')

// Implicit guard routes to Avdol
const resVN2 = translator.translate('vgbn', 'bảo vệ căn cứ')
assert.strictEqual(resVN2.length, 1)
assert.strictEqual(resVN2[0].targetAgent, 'Avdol')
assert.strictEqual(resVN2[0].intent, 'GUARD')
assert.strictEqual(resVN2[0].command, '!patrol')

// Implicit harvest routes to Kakyoin
const resVN3 = translator.translate('vgbn', 'thu hoạch lúa')
assert.strictEqual(resVN3.length, 1)
assert.strictEqual(resVN3[0].targetAgent, 'Kakyoin')
assert.strictEqual(resVN3[0].intent, 'HARVEST')

console.log('  [PASS] Gate 3: Vietnamese translation and domain routing verified.')

// -----------------------------------------------------------------------------
// Gate 4: Multi-Clause Splitting & Chained Goals
// -----------------------------------------------------------------------------
console.log('  • Gate 4: Testing Multi-Clause Splitting...')
const multiEN = translator.translate('vgbn', 'Polnareff mine 10 stone and Joseph build wall then Avdol guard')
assert.strictEqual(multiEN.length, 3, 'Must split into 3 distinct Crusader actions')
assert.strictEqual(multiEN[0].targetAgent, 'Polnareff')
assert.strictEqual(multiEN[0].intent, 'MINE')
assert.strictEqual(multiEN[1].targetAgent, 'Joseph')
assert.strictEqual(multiEN[1].intent, 'BUILD')
assert.strictEqual(multiEN[2].targetAgent, 'Avdol')
assert.strictEqual(multiEN[2].intent, 'GUARD')

const multiVN = translator.translate('vgbn', 'Kakyoin thu hoạch lúa và Iggy do thám rồi dừng lại')
assert.strictEqual(multiVN.length, 3, 'Must split Vietnamese multi-clause into 3 actions')
assert.strictEqual(multiVN[0].targetAgent, 'Kakyoin')
assert.strictEqual(multiVN[1].targetAgent, 'Iggy')
assert.strictEqual(multiVN[1].intent, 'SCOUT')
assert.strictEqual(multiVN[2].intent, 'STOP')

console.log('  [PASS] Gate 4: Multi-clause splitting verified across English and Vietnamese.')

// -----------------------------------------------------------------------------
// Gate 5: Spatial Extraction & Typo Tolerance
// -----------------------------------------------------------------------------
console.log('  • Gate 5: Testing Spatial Extraction & Typo Tolerance...')
const resCoords = translator.translate('vgbn', 'walk to 120 64 -350')
assert.strictEqual(resCoords[0].intent, 'NAVIGATE')
assert.deepStrictEqual(resCoords[0].targetPos, { x: 120, y: 64, z: -350 })
assert.strictEqual(resCoords[0].command, '!goto 120 64 -350')

// Typo: avodl -> Avdol
const resTypo = translator.translate('vgbn', 'avodl guard perimeter')
assert.strictEqual(resTypo[0].targetAgent, 'Avdol')
assert.strictEqual(resTypo[0].intent, 'GUARD')

// Sanitization: control characters and 256-char cap
const longMsg = 'mine stone '.repeat(50)
const resSanitized = translator.translate('vgbn', longMsg)
assert.ok(resSanitized.length > 0)
assert.ok(resSanitized[0].rawClause.length <= 256)

console.log('  [PASS] Gate 5: Spatial extraction and typo tolerance verified.')

console.log('\nPASS: test_nlp_translator.mjs completed successfully with 0 errors.')
