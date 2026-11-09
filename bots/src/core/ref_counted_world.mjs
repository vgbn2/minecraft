// Reference-Counted Shared Chunk Column Store for 50-Bot Swarm Worker Multiplexing
// ponytail: deduplicates identical ChunkColumns across co-located bots in the same worker thread
export class RefCountedColumnStore {
  constructor(options = {}) {
    this.columns = new Map() // "x,z" -> { column, refs: Set<agentId>, updatedAt }
    this.onFirstLoad = options.onFirstLoad || null
  }

  static key(x, z) {
    return `${Math.floor(Number(x))},${Math.floor(Number(z))}`
  }

  get columnCount() {
    return this.columns.size
  }

  get totalReferences() {
    let sum = 0
    for (const entry of this.columns.values()) {
      sum += entry.refs.size
    }
    return sum
  }

  setColumn(agentId, x, z, column) {
    const k = RefCountedColumnStore.key(x, z)
    let entry = this.columns.get(k)
    const isFirst = !entry
    if (!entry) {
      entry = { column, refs: new Set(), updatedAt: Date.now() }
      this.columns.set(k, entry)
    } else if (column !== undefined) {
      entry.column = column
      entry.updatedAt = Date.now()
    }
    if (agentId) entry.refs.add(String(agentId))
    if (isFirst && this.onFirstLoad) {
      this.onFirstLoad(Math.floor(Number(x)), Math.floor(Number(z)), column, agentId)
    }
    return entry.column
  }

  getColumn(x, z) {
    const entry = this.columns.get(RefCountedColumnStore.key(x, z))
    return entry ? entry.column : undefined
  }

  unloadColumn(agentId, x, z) {
    const k = RefCountedColumnStore.key(x, z)
    const entry = this.columns.get(k)
    if (!entry) return false
    if (agentId) {
      entry.refs.delete(String(agentId))
    }
    if (entry.refs.size === 0) {
      this.columns.delete(k)
      return true // Evicted from memory
    }
    return false // Retained for remaining co-located agents
  }

  removeAgent(agentId) {
    const id = String(agentId)
    let evicted = 0
    for (const [k, entry] of this.columns.entries()) {
      if (entry.refs.delete(id) && entry.refs.size === 0) {
        this.columns.delete(k)
        evicted++
      }
    }
    return evicted
  }

  // Adapter compatible with prismarine-world custom storage provider
  createAgentAdapter(agentId) {
    const store = this
    const id = String(agentId)
    return {
      async load(x, z) {
        return store.getColumn(x, z) || null
      },
      async save(x, z, column) {
        store.setColumn(id, x, z, column)
      },
      async unload(x, z) {
        store.unloadColumn(id, x, z)
      }
    }
  }
}
