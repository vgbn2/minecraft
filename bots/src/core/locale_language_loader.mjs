// ponytail: modular zero-dependency locale loader and regex compiler for companion NLP
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOCALES_DIR = path.resolve(__dirname, '../../locales')

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export class LocaleLanguageLoader {
  constructor(localesDir = LOCALES_DIR) {
    this.localesDir = localesDir
    this.rawLocales = new Map()
    this.compiledLocales = new Map()
    this.activeLang = 'auto'
    this.activeBundle = null
    this.reloadAll()
  }

  reloadAll() {
    this.rawLocales.clear()
    this.compiledLocales.clear()
    if (!fs.existsSync(this.localesDir)) return

    const files = fs.readdirSync(this.localesDir).filter(f => f.endsWith('.json'))
    for (const file of files) {
      const code = path.basename(file, '.json')
      try {
        const content = fs.readFileSync(path.join(this.localesDir, file), 'utf8')
        const parsed = JSON.parse(content)
        this.rawLocales.set(code, parsed)
      } catch (err) {
        console.error(`[LocaleLoader] Failed to parse locale file ${file}:`, err.message)
      }
    }
    this.setLanguage(this.activeLang)
  }

  getAvailableLanguages() {
    return Array.from(this.rawLocales.keys())
  }

  setLanguage(lang = 'auto') {
    this.activeLang = lang
    if (this.compiledLocales.has(lang)) {
      this.activeBundle = this.compiledLocales.get(lang)
      return this.activeBundle
    }

    const bundle = this._compileBundle(lang)
    this.compiledLocales.set(lang, bundle)
    this.activeBundle = bundle
    return bundle
  }

  _compileBundle(lang) {
    let targetLocales = []
    if (lang === 'auto') {
      targetLocales = Array.from(this.rawLocales.values())
    } else if (Array.isArray(lang)) {
      targetLocales = lang.map(code => this.rawLocales.get(code)).filter(Boolean)
    } else {
      const single = this.rawLocales.get(lang)
      targetLocales = single ? [single] : Array.from(this.rawLocales.values())
    }

    if (targetLocales.length === 0) {
      targetLocales = [
        {
          meta: { code: 'en', name: 'English' },
          clauseDelimiters: ['and', 'then'],
          intents: {},
          structures: {},
          materials: {},
          items: {},
          landmarks: {},
          templates: {}
        }
      ]
    }

    const mergedDelimiters = new Set([';', 'next', 'then'])
    const mergedIntents = {}
    const mergedStructures = { shelter: new Set(), wall: new Set() }
    const mergedMaterials = { dirt: new Set(), stone: new Set(), cobblestone: new Set() }
    const mergedItems = {}
    const mergedLandmarks = {}
    const mergedTemplates = {}

    for (const loc of targetLocales) {
      if (Array.isArray(loc.clauseDelimiters)) {
        for (const d of loc.clauseDelimiters) mergedDelimiters.add(d)
      }
      if (loc.intents) {
        for (const [intentKey, words] of Object.entries(loc.intents)) {
          if (!mergedIntents[intentKey]) mergedIntents[intentKey] = new Set()
          for (const w of words) mergedIntents[intentKey].add(w)
        }
      }
      if (loc.structures) {
        for (const [st, words] of Object.entries(loc.structures)) {
          if (!mergedStructures[st]) mergedStructures[st] = new Set()
          for (const w of words) mergedStructures[st].add(w)
        }
      }
      if (loc.materials) {
        for (const [mat, words] of Object.entries(loc.materials)) {
          if (!mergedMaterials[mat]) mergedMaterials[mat] = new Set()
          for (const w of words) mergedMaterials[mat].add(w)
        }
      }
      if (loc.items) {
        Object.assign(mergedItems, loc.items)
      }
      if (loc.landmarks) {
        Object.assign(mergedLandmarks, loc.landmarks)
      }
      if (loc.templates) {
        Object.assign(mergedTemplates, loc.templates)
      }
    }

    // Compile regexes
    const delims = Array.from(mergedDelimiters).filter(d => d !== ';').sort((a, b) => b.length - a.length)
    const delimPattern = delims.map(escapeRegex).join('|')
    const splitRegex = new RegExp(`\\s*(?:;\\s*|(?<=^|\\s)(?:${delimPattern})(?=$|\\s))\\s*`, 'giu')

    const intentRegexes = {}
    for (const [key, wordSet] of Object.entries(mergedIntents)) {
      const words = Array.from(wordSet).sort((a, b) => b.length - a.length)
      if (words.length > 0) {
        const pattern = words.map(escapeRegex).join('|')
        intentRegexes[key] = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${pattern})(?=$|[^\\p{L}\\p{N}])`, 'iu')
      }
    }

    const structureRegexes = {}
    for (const [key, wordSet] of Object.entries(mergedStructures)) {
      const words = Array.from(wordSet).sort((a, b) => b.length - a.length)
      if (words.length > 0) {
        const pattern = words.map(escapeRegex).join('|')
        structureRegexes[key] = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${pattern})(?=$|[^\\p{L}\\p{N}])`, 'iu')
      }
    }

    const materialRegexes = {}
    for (const [key, wordSet] of Object.entries(mergedMaterials)) {
      const words = Array.from(wordSet).sort((a, b) => b.length - a.length)
      if (words.length > 0) {
        const pattern = words.map(escapeRegex).join('|')
        materialRegexes[key] = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${pattern})(?=$|[^\\p{L}\\p{N}])`, 'iu')
      }
    }

    return {
      lang,
      splitRegex,
      intentRegexes,
      structureRegexes,
      materialRegexes,
      items: mergedItems,
      landmarks: mergedLandmarks,
      templates: mergedTemplates
    }
  }

  getActiveBundle() {
    if (!this.activeBundle) {
      this.setLanguage(this.activeLang)
    }
    return this.activeBundle
  }
}

export const LocaleLoader = LocaleLanguageLoader

let defaultLoaderInstance = null
export function getDefaultLocaleLanguageLoader() {
  if (!defaultLoaderInstance) {
    defaultLoaderInstance = new LocaleLanguageLoader()
  }
  return defaultLoaderInstance
}
export const getDefaultLocaleLoader = getDefaultLocaleLanguageLoader
