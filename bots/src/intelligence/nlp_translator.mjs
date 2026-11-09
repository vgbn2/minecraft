// Intermediate NLP Translation Compiler: Human Speech -> Crusader Agent Prompts
// Bilingual (EN/VN) lemma parser with deterministic spatial extraction and persona routing.

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

// Vietnamese and English item dictionary normalization
export const ITEM_ALIAS_MAP = {
  // Ores & Rocks
  'sắt': 'iron_ore',
  'iron': 'iron_ore',
  'than': 'coal_ore',
  'coal': 'coal_ore',
  'vàng': 'gold_ore',
  'gold': 'gold_ore',
  'kim cương': 'diamond',
  'diamond': 'diamond',
  'đá': 'stone',
  'stone': 'stone',
  'đá cuội': 'cobblestone',
  'cobble': 'cobblestone',
  'cobblestone': 'cobblestone',
  'đất': 'dirt',
  'dirt': 'dirt',
  'cát': 'sand',
  'sand': 'sand',
  'gỗ': 'oak_log',
  'wood': 'oak_log',
  'log': 'oak_log',
  'lúa': 'wheat',
  'wheat': 'wheat',
  'bánh mì': 'bread',
  'bread': 'bread'
}

export class NlpTranslationLayer {
  constructor(options = {}) {
    this.landmarks = options.landmarks || {}
    this.apiBase = options.apiBase || 'http://127.0.0.1:20128/v1'
    this.model = options.model || 'ag/gemini-3.8-flash'
  }

  /**
   * Translates unstructured speech (English or Vietnamese) into structured Crusader orders.
   * Cap input length at 256 characters (Netty frame ceiling) and strip control characters.
   */
  translate(speaker, rawText, context = {}) {
    if (!rawText || typeof rawText !== 'string') return []
    const cleanText = rawText
      .replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ')
      .trim()
      .slice(0, 256)

    if (!cleanText) return []

    // 1. Multi-clause splitter ("and", "then", ";", "và", "rồi", ", sau đó", "after that")
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
    // Split on multi-goal delimiters: "and", "then", ";", "và", "rồi", "sau đó", etc.
    const splitRegex = /\s*(?:;\s*|(?<=^|\s)(?:and|then|va|và|rồi|sau đó|after that|next)(?=$|\s))\s*/giu
    return text.split(splitRegex).map(c => c.trim()).filter(Boolean)
  }

  _parseClause(speaker, clause, context = {}) {
    const lower = clause.toLowerCase()

    // 1. Target Crusader resolution
    let target = this._resolveTargetAgent(lower)

    // 2. Spatial resolution (coordinates or named landmark)
    const coords = this._extractCoordinates(clause)
    const landmark = this._extractLandmark(lower)
    const targetPos = coords || (landmark ? this.landmarks[landmark] : null)

    // 3. Lemma Intent Classification
    let intent = 'UNKNOWN'
    let command = ''
    let tacticalBrief = ''

    if (/(?:^|[^\p{L}\p{N}])(?:mine|dig|quarry|excavate|đào|khai thác)(?=$|[^\p{L}\p{N}])/iu.test(lower)) {
      intent = 'MINE'
      if (!target) target = 'Polnareff'
      const { item, count } = this._extractItemAndCount(lower, 'stone', 10)
      command = `!mine ${item} ${count}`
      tacticalBrief = `[Stand Order: Silver Chariot] ${target}, excavate ${count} ${item}.`
    } else if (/(?:^|[^\p{L}\p{N}])(?:build|place|construct|xây|dựng|làm nhà|đặt)(?=$|[^\p{L}\p{N}])/iu.test(lower)) {
      intent = 'BUILD'
      if (!target) target = 'Joseph'
      const structure = /(?:^|[^\p{L}\p{N}])(?:shelter|house|tường|nhà|căn cứ|base)(?=$|[^\p{L}\p{N}])/iu.test(lower) && !/(?:^|[^\p{L}\p{N}])(?:wall|tường)(?=$|[^\p{L}\p{N}])/iu.test(lower) ? 'shelter' : 'wall'
      const material = /(?:^|[^\p{L}\p{N}])(?:dirt|đất)(?=$|[^\p{L}\p{N}])/iu.test(lower) ? 'dirt' : (/(?:^|[^\p{L}\p{N}])(?:stone|đá)(?=$|[^\p{L}\p{N}])/iu.test(lower) && !lower.includes('đá cuội') && !lower.includes('cobble') ? 'stone' : 'cobblestone')
      command = `!build ${structure} ${material}`
      tacticalBrief = `[Stand Order: Hermit Purple] ${target}, construct ${structure} using ${material}.`
    } else if (/(?:^|[^\p{L}\p{N}])(?:guard|defend|protect|sentry|patrol|kill|attack|bảo vệ|canh gác|tuần tra|đánh|tiêu diệt)(?=$|[^\p{L}\p{N}])/iu.test(lower)) {
      intent = 'GUARD'
      if (!target) target = 'Avdol'
      command = '!patrol'
      tacticalBrief = `[Stand Order: Magician's Red] ${target}, secure defensive perimeter and neutralize threats.`
    } else if (/(?:^|[^\p{L}\p{N}])(?:harvest|farm|crop|feed|gather|log|wood|thu hoạch|trồng|chăn nuôi|chặt gỗ)(?=$|[^\p{L}\p{N}])/iu.test(lower)) {
      intent = 'HARVEST'
      if (!target) target = 'Kakyoin'
      command = '!harvest'
      tacticalBrief = `[Stand Order: Hierophant Green] ${target}, harvest crops and timber reserves.`
    } else if (/(?:^|[^\p{L}\p{N}])(?:scout|explore|recon|thám hiểm|do thám|trinh sát)(?=$|[^\p{L}\p{N}])/iu.test(lower)) {
      intent = 'SCOUT'
      if (!target) target = 'Iggy'
      command = '!survey'
      tacticalBrief = `[Stand Order: The Fool] ${target}, scout terrain and alert squad of hazards.`
    } else if (/(?:^|[^\p{L}\p{N}])(?:come|here|lại đây|tới đây|ở đây|theo|follow)(?=$|[^\p{L}\p{N}])/iu.test(lower)) {
      intent = 'NAVIGATE'
      if (!target) target = 'Jotaro'
      command = '!come'
      tacticalBrief = `${target}, assemble near ${speaker}.`
    } else if (/(?:^|[^\p{L}\p{N}])(?:goto|go to|walk to|move to|đi tới|đi đến)(?=$|[^\p{L}\p{N}])/iu.test(lower) && targetPos) {
      intent = 'NAVIGATE'
      if (!target) target = 'Jotaro'
      command = `!goto ${targetPos.x} ${targetPos.y} ${targetPos.z}`
      tacticalBrief = `${target}, navigate to (${targetPos.x}, ${targetPos.y}, ${targetPos.z}).`
    } else if (/(?:^|[^\p{L}\p{N}])(?:stop|stay|halt|dừng|đứng yên)(?=$|[^\p{L}\p{N}])/iu.test(lower)) {
      intent = 'STOP'
      if (!target) target = 'all'
      command = '!stop'
      tacticalBrief = 'Emergency halt all active tasks.'
    } else if (/(?:^|[^\p{L}\p{N}])(?:status|report|tình trạng|báo cáo)(?=$|[^\p{L}\p{N}])/iu.test(lower)) {
      intent = 'STATUS'
      if (!target) target = 'all'
      command = '!status'
      tacticalBrief = 'Query vitals and squad status.'
    } else {
      // Default fallback routing to Commander Jotaro
      if (!target) target = 'Jotaro'
      command = `!chat ${clause}`
      tacticalBrief = `Jotaro: Analyze order '${clause}'.`
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
    // Check explicit Crusader names
    for (const name of CRUSADER_NAMES) {
      const re = new RegExp(`\\b${name.toLowerCase()}\\b`, 'i')
      if (re.test(lower)) return name
    }
    // Avdol typo alias
    if (/\bavodl\b/i.test(lower)) return 'Avdol'

    // Check roles
    for (const [role, agent] of Object.entries(ROLE_AGENT_MAP)) {
      const re = new RegExp(`\\b${role}\\b`, 'i')
      if (re.test(lower)) return agent
    }
    return null
  }

  _extractCoordinates(text) {
    // Matches: 100 64 -200 or at 100, 64, -200 or x=100 y=64 z=-200
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
    const landmarks = ['base', 'farm', 'mine', 'depot', 'quarry', 'home', 'house', 'căn cứ', 'nhà']
    for (const lm of landmarks) {
      if (lower.includes(lm)) {
        if (lm === 'căn cứ' || lm === 'nhà' || lm === 'home') return 'base'
        return lm
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
    for (const [alias, canonical] of Object.entries(ITEM_ALIAS_MAP)) {
      const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${alias}(?=$|[^\\p{L}\\p{N}])`, 'iu')
      if (re.test(lower)) {
        item = canonical
        break
      }
    }

    return { item, count }
  }
}
