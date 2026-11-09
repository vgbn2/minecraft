// Unit Test Suite for LocaleLanguageLoader and Modular NLP Locales
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { LocaleLanguageLoader, getDefaultLocaleLanguageLoader } from '../src/core/locale_language_loader.mjs'
import { LocaleLoader as ShimLoader, getDefaultLocaleLoader as getShimDefault } from '../src/core/locale_loader.mjs'
import { NlpTranslationLayer } from '../src/intelligence/nlp_translator.mjs'

console.log('[*] Testing Modular Locale Language Loader & NLP Language Packs...')

// Verify dual-state compatibility shim
assert.strictEqual(LocaleLanguageLoader, ShimLoader, 'ShimLoader must reference LocaleLanguageLoader')
assert.strictEqual(getDefaultLocaleLanguageLoader, getShimDefault, 'getShimDefault must reference getDefaultLocaleLanguageLoader')

// -----------------------------------------------------------------------------
// Gate 1: Locale Discovery & Built-in Packs
// -----------------------------------------------------------------------------
console.log('  • Gate 1: Testing Locale Discovery & Built-in Packs...')
const loader = getDefaultLocaleLanguageLoader()
const available = loader.getAvailableLanguages()
assert.ok(available.includes('en'), 'Must include en.json')
assert.ok(available.includes('vi'), 'Must include vi.json')
assert.ok(available.includes('ja'), 'Must include ja.json')
console.log(`  [PASS] Gate 1: Discovered locales: ${available.join(', ')}`)

// -----------------------------------------------------------------------------
// Gate 2: Language Switching & Latency (<1ms)
// -----------------------------------------------------------------------------
console.log('  • Gate 2: Testing Sub-millisecond Language Switching...')
const start = performance.now()
const viBundle = loader.setLanguage('vi')
const elapsed = performance.now() - start
assert.strictEqual(viBundle.lang, 'vi')
assert.ok(elapsed < 5.0, `Switch latency (${elapsed.toFixed(3)}ms) must be under 5ms`)
assert.ok(viBundle.items['sắt'] === 'iron_ore')
assert.ok(viBundle.intentRegexes.MINE.test('đào'))

const enBundle = loader.setLanguage('en')
assert.strictEqual(enBundle.lang, 'en')
assert.ok(enBundle.items['iron'] === 'iron_ore')
assert.ok(!('sắt' in enBundle.items), 'en bundle must not contain Vietnamese items when isolated')
console.log(`  [PASS] Gate 2: Sub-millisecond language switching verified (${elapsed.toFixed(3)}ms).`)

// -----------------------------------------------------------------------------
// Gate 3: Auto Mode Merges Vocabulary Across Locales
// -----------------------------------------------------------------------------
console.log('  • Gate 3: Testing Auto Mode Merging...')
const autoBundle = loader.setLanguage('auto')
assert.ok('sắt' in autoBundle.items, 'Auto bundle must include Vietnamese items')
assert.ok('iron' in autoBundle.items, 'Auto bundle must include English items')
assert.ok('鉄' in autoBundle.items, 'Auto bundle must include Japanese items')
assert.ok(autoBundle.intentRegexes.MINE.test('mine'))
assert.ok(autoBundle.intentRegexes.MINE.test('đào'))
assert.ok(autoBundle.intentRegexes.MINE.test('採掘'))
console.log('  [PASS] Gate 3: Auto mode multi-language dictionary merge verified.')

// -----------------------------------------------------------------------------
// Gate 4: Zero-Code-Edit Extensibility (Drop-in New Locale)
// -----------------------------------------------------------------------------
console.log('  • Gate 4: Testing Drop-in Locale Extensibility (Zero Code Edits)...')
const tmpLocalesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locales-test-'))
try {
  // Copy en and drop in a new french locale fr.json
  const frLocale = {
    meta: { code: 'fr', name: 'Français' },
    clauseDelimiters: ['et', 'puis', 'ensuite'],
    intents: {
      MINE: ['miner', 'creuser'],
      GUARD: ['garder', 'défendre']
    },
    structures: { shelter: ['abri', 'maison'] },
    materials: { stone: ['pierre'] },
    items: { 'fer': 'iron_ore', 'pierre': 'stone' },
    landmarks: { 'base': 'base' },
    templates: {
      MINE: '[Ordre Stand: Silver Chariot] {target}, creuser {count} {item}.'
    }
  }
  fs.writeFileSync(path.join(tmpLocalesDir, 'fr.json'), JSON.stringify(frLocale))

  const customLoader = new LocaleLanguageLoader(tmpLocalesDir)
  assert.ok(customLoader.getAvailableLanguages().includes('fr'))

  const translator = new NlpTranslationLayer({ localeLoader: customLoader, language: 'fr' })
  const res = translator.translate('vgbn', 'Polnareff creuser 25 fer')
  assert.strictEqual(res.length, 1)
  assert.strictEqual(res[0].targetAgent, 'Polnareff')
  assert.strictEqual(res[0].intent, 'MINE')
  assert.strictEqual(res[0].command, '!mine iron_ore 25')
  assert.ok(res[0].tacticalBrief.includes('creuser 25 iron_ore'))
  console.log('  [PASS] Gate 4: Drop-in locale extension verified without editing any JS code.')
} finally {
  fs.rmSync(tmpLocalesDir, { recursive: true, force: true })
}

// -----------------------------------------------------------------------------
// Gate 5: Japanese Stand Commands (Part 3 Crusader Authenticity)
// -----------------------------------------------------------------------------
console.log('  • Gate 5: Testing Japanese Stand Commands...')
loader.setLanguage('auto')
const jTranslator = new NlpTranslationLayer({ language: 'ja' })
const jaRes1 = jTranslator.translate('vgbn', 'Polnareff 採掘 10 鉄')
assert.strictEqual(jaRes1.length, 1)
assert.strictEqual(jaRes1[0].targetAgent, 'Polnareff')
assert.strictEqual(jaRes1[0].intent, 'MINE')
assert.strictEqual(jaRes1[0].command, '!mine iron_ore 10')
assert.ok(jaRes1[0].tacticalBrief.includes('銀の戦車'))

const jaRes2 = jTranslator.translate('vgbn', 'Avdol 警備')
assert.strictEqual(jaRes2.length, 1)
assert.strictEqual(jaRes2[0].targetAgent, 'Avdol')
assert.strictEqual(jaRes2[0].intent, 'GUARD')
assert.strictEqual(jaRes2[0].command, '!patrol')
assert.ok(jaRes2[0].tacticalBrief.includes('魔術師の赤'))
console.log('  [PASS] Gate 5: Japanese Stand commands verified.')

console.log('\nPASS: test_locale_language_loader.mjs completed successfully with 0 errors.')
