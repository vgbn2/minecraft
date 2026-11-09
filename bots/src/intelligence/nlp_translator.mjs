// Intermediate NLP Translation Compiler: Human Speech -> Crusader Agent Prompts
// Data-driven modular locale parser with deterministic spatial extraction and persona routing.
import { getDefaultLocaleLanguageLoader } from '../core/locale_language_loader.mjs'

export const ROLE_AGENT_MAP = {
  mastermind: 'Jotaro',
  commander: 'Jotaro',
  architect: 'Joseph',
  builder: 'Joseph',
  miner: 'Polnareff',
  swordsman: 'Polnareff',
  sentinel: 'Avdol',
  guard: 'Avdol',
  harvester: 'Kakyoin',
  farmer: 'Kakyoin',
  scout: 'Iggy',
  vanguard: 'Iggy'
}

export const CRUSADER_NAMES = ['Jotaro', 'Joseph', 'Polnareff', 'Avdol', 'Kakyoin', 'Iggy']

// Dynamic item alias map proxy for backwards compatibility
export const ITEM_ALIAS_MAP = new Proxy({}, {
  get(_, prop) {
    const bundle = getDefaultLocaleLanguageLoader().getActiveBundle()
    return bundle.items[prop]
  },
  has(_, prop) {
    const bundle = getDefaultLocaleLanguageLoader().getActiveBundle()
    return prop in bundle.items
  },
  ownKeys() {
    const bundle = getDefaultLocaleLanguageLoader().getActiveBundle()
    return Object.keys(bundle.items)
  },
  getOwnPropertyDescriptor(_, prop) {
    const bundle = getDefaultLocaleLanguageLoader().getActiveBundle()
    if (prop in bundle.items) {
      return { configurable: true, enumerable: true, value: bundle.items[prop] }
    }
    return undefined
  }
})

function renderTemplate(template, vars = {}) {
  if (!template) return ''
  return template.replace(/\{(\w+)\}/g, (match, key) => (vars[key] !== undefined ? vars[key] : match))
}

export class NlpTranslationLayer {
  constructor(options = {}) {
    this.landmarks = options.landmarks || {}
    this.apiBase = options.apiBase || 'http://127.0.0.1:20128/v1'
    this.model = options.model || 'ag/gemini-3.8-flash'
    this.localeLoader = options.localeLoader || getDefaultLocaleLanguageLoader()
    this.language = options.language || 'auto'
    this.setLanguage(this.language)
  }

  setLanguage(lang = 'auto') {
    this.language = lang
    this.bundle = this.localeLoader.setLanguage(lang)
    return this.bundle
  }

  /**
   * Translates unstructured speech (any configured locale) into structured Crusader orders.
   * Cap input length at 256 characters (Netty frame ceiling) and strip control characters.
   */
  translate(speaker, rawText, context = {}) {
    if (!rawText || typeof rawText !== 'string') return []
    const cleanText = rawText
      .replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ')
      .trim()
      .slice(0, 256)

    if (!cleanText) return []

    // 1. Multi-clause splitter using data-driven delimiters
    const clauses = this._splitClauses(cleanText)
    const actions = []

    for (const clause of clauses) {
      const parsed = this._parseClause(speaker, clause, context)
      if (parsed) {
        actions.push(parsed)
      }
    }

    return actions
  }

  _splitClauses(text) {
    const splitRegex = this.bundle.splitRegex
    return text.split(splitRegex).map(c => c.trim()).filter(Boolean)
  }

  _parseClause(speaker, clause, context = {}) {
    const lower = clause.toLowerCase()
    const { intentRegexes, structureRegexes, materialRegexes, templates } = this.bundle

    // 1. Target Crusader resolution
    let target = this._resolveTargetAgent(lower)

    // 2. Spatial resolution (coordinates or named landmark)
    const coords = this._extractCoordinates(clause)
    const landmark = this._extractLandmark(lower)
    const targetPos = coords || (landmark ? (this.landmarks[landmark] || this.bundle.landmarks[landmark]) : null)

    // 3. Lemma Intent Classification
    let intent = 'UNKNOWN'
    let command = ''
    let tacticalBrief = ''

    if (intentRegexes.MINE && intentRegexes.MINE.test(lower)) {
      intent = 'MINE'
      if (!target) target = 'Polnareff'
      const { item, count } = this._extractItemAndCount(lower, 'stone', 10)
      command = `!mine ${item} ${count}`
      tacticalBrief = renderTemplate(templates.MINE, { target, item, count })
    } else if (intentRegexes.BUILD && intentRegexes.BUILD.test(lower)) {
      intent = 'BUILD'
      if (!target) target = 'Joseph'
      const isShelter = structureRegexes.shelter && structureRegexes.shelter.test(lower) &&
        (!structureRegexes.wall || !structureRegexes.wall.test(lower))
      const structure = isShelter ? 'shelter' : 'wall'

      let material = 'cobblestone'
      if (materialRegexes.dirt && materialRegexes.dirt.test(lower)) {
        material = 'dirt'
      } else if (materialRegexes.stone && materialRegexes.stone.test(lower) && !lower.includes('cobble') && !lower.includes('đá cuội')) {
        material = 'stone'
      }
      command = `!build ${structure} ${material}`
      tacticalBrief = renderTemplate(templates.BUILD, { target, structure, material })
    } else if (intentRegexes.GUARD && intentRegexes.GUARD.test(lower)) {
      intent = 'GUARD'
      if (!target) target = 'Avdol'
      command = '!patrol'
      tacticalBrief = renderTemplate(templates.GUARD, { target })
    } else if (intentRegexes.HARVEST && intentRegexes.HARVEST.test(lower)) {
      intent = 'HARVEST'
      if (!target) target = 'Kakyoin'
      command = '!harvest'
      tacticalBrief = renderTemplate(templates.HARVEST, { target })
    } else if (intentRegexes.FEED && intentRegexes.FEED.test(lower)) {
      intent = 'FEED'
      if (!target) target = 'Kakyoin'
      command = `!feed ${speaker}`
      tacticalBrief = renderTemplate(templates.FEED, { target, speaker })
    } else if (intentRegexes.SCOUT && intentRegexes.SCOUT.test(lower)) {
      intent = 'SCOUT'
      if (!target) target = 'Iggy'
      command = '!survey'
      tacticalBrief = renderTemplate(templates.SCOUT, { target })
    } else if (intentRegexes.COME && intentRegexes.COME.test(lower)) {
      intent = 'NAVIGATE'
      if (!target) target = 'Jotaro'
      command = '!come'
      tacticalBrief = renderTemplate(templates.COME, { target, speaker })
    } else if (intentRegexes.GOTO && intentRegexes.GOTO.test(lower) && targetPos) {
      intent = 'NAVIGATE'
      if (!target) target = 'Jotaro'
      command = `!goto ${targetPos.x} ${targetPos.y} ${targetPos.z}`
      tacticalBrief = renderTemplate(templates.GOTO, { target, x: targetPos.x, y: targetPos.y, z: targetPos.z })
    } else if (intentRegexes.STOP && intentRegexes.STOP.test(lower)) {
      intent = 'STOP'
      if (!target) target = 'all'
      command = '!stop'
      tacticalBrief = renderTemplate(templates.STOP, { target })
    } else if (intentRegexes.STATUS && intentRegexes.STATUS.test(lower)) {
      intent = 'STATUS'
      if (!target) target = 'all'
      command = '!status'
      tacticalBrief = renderTemplate(templates.STATUS, { target })
    } else {
      // Default fallback routing to Commander Jotaro
      if (!target) target = 'Jotaro'
      command = `!chat ${clause}`
      tacticalBrief = renderTemplate(templates.CHAT, { target, clause })
    }

    return {
      speaker,
      rawClause: clause,
      targetAgent: target,
      intent,
      command,
      targetPos,
      tacticalBrief
    }
  }

  _resolveTargetAgent(lower) {
    for (const name of CRUSADER_NAMES) {
      const re = new RegExp(`\\b${name.toLowerCase()}\\b`, 'i')
      if (re.test(lower)) return name
    }
    if (/\bavodl\b/i.test(lower)) return 'Avdol'

    for (const [role, agent] of Object.entries(ROLE_AGENT_MAP)) {
      const re = new RegExp(`\\b${role}\\b`, 'i')
      if (re.test(lower)) return agent
    }
    return null
  }

  _extractCoordinates(text) {
    const m = text.match(/(?:at\s+|pos\s+)?(-?\d+)[,\s]+(\d+)[,\s]+(-?\d+)/)
    if (m) {
      const x = parseInt(m[1], 10)
      const y = parseInt(m[2], 10)
      const z = parseInt(m[3], 10)
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        return { x, y, z }
      }
    }
    return null
  }

  _extractLandmark(lower) {
    const landmarks = this.bundle.landmarks
    for (const [alias, canonical] of Object.entries(landmarks)) {
      if (lower.includes(alias)) {
        return canonical
      }
    }
    return null
  }

  _extractItemAndCount(lower, defaultItem = 'stone', defaultCount = 10) {
    let count = defaultCount
    const countMatch = lower.match(/\b(\d+)\b/)
    if (countMatch) {
      count = parseInt(countMatch[1], 10)
    }

    let item = defaultItem
    const items = this.bundle.items
    for (const [alias, canonical] of Object.entries(items)) {
      const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${alias}(?=$|[^\\p{L}\\p{N}])`, 'iu')
      if (re.test(lower)) {
        item = canonical
        break
      }
    }

    return { item, count }
  }
}
