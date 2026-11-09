import fs from 'node:fs'
import path from 'node:path'
import { Vec3 } from 'vec3'

// ponytail: immutable unbreakable blocks set; prevents infinite dig loops on survival-immune blocks
export const UNBREAKABLE_BLOCKS = new Set([
  'bedrock', 'barrier', 'command_block', 'chain_command_block',
  'repeating_command_block', 'structure_block', 'jigsaw', 'light',
  'end_portal_frame', 'end_portal', 'nether_portal', 'reinforced_deepslate'
])

// ponytail: stdlib JSON graph for waypoints & landmarks; zero graph DB dependencies
export class WaypointGraph {
  constructor(storagePath) {
    this.storagePath = storagePath
    this.data = this._load()
  }

  _load() {
    try {
      if (this.storagePath && fs.existsSync(this.storagePath)) {
        const raw = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'))
        return {
          waypoints: raw.waypoints || {},
          notes: raw.notes || []
        }
      }
    } catch {}
    return { waypoints: {}, notes: [] }
  }

  save() {
    try {
      if (this.storagePath) {
        fs.mkdirSync(path.dirname(this.storagePath), { recursive: true })
        fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2))
      }
    } catch (err) {
      console.error('[!] Failed to persist waypoint graph:', err.message)
    }
  }

  setWaypoint(name, coords, metadata = {}) {
    const key = String(name).toLowerCase().trim()
    this.data.waypoints[key] = {
      x: Math.floor(coords.x),
      y: Math.floor(coords.y),
      z: Math.floor(coords.z),
      connections: metadata.connections || this.data.waypoints[key]?.connections || [],
      description: metadata.description || '',
      setBy: metadata.setBy || 'bot',
      updatedAt: new Date().toISOString()
    }
    this.save()
    return this.data.waypoints[key]
  }

  connect(fromName, toName) {
    const from = String(fromName).toLowerCase().trim()
    const to = String(toName).toLowerCase().trim()
    if (this.data.waypoints[from] && this.data.waypoints[to]) {
      if (!this.data.waypoints[from].connections.includes(to)) {
        this.data.waypoints[from].connections.push(to)
      }
      if (!this.data.waypoints[to].connections.includes(from)) {
        this.data.waypoints[to].connections.push(from)
      }
      this.save()
      return true
    }
    return false
  }

  getWaypoint(name) {
    return this.data.waypoints[String(name).toLowerCase().trim()] || null
  }

  listWaypoints() {
    return this.data.waypoints
  }

  deleteWaypoint(name) {
    const key = String(name).toLowerCase().trim()
    if (this.data.waypoints[key]) {
      delete this.data.waypoints[key]
      for (const wp of Object.values(this.data.waypoints)) {
        wp.connections = (wp.connections || []).filter(c => c !== key)
      }
      this.save()
      return true
    }
    return false
  }

  /**
   * Finds shortest landmark route between two waypoints via BFS graph traversal.
   * ponytail: BFS on in-memory graph; upgrade to Dijkstra/A* if edge costs/weights needed
   * @param {string} startName
   * @param {string} targetName
   * @returns {Array<{name: string, x: number, y: number, z: number}>|null}
   */
  findRoute(startName, targetName) {
    const start = String(startName).toLowerCase().trim()
    const target = String(targetName).toLowerCase().trim()
    if (!this.data.waypoints[start] || !this.data.waypoints[target]) return null
    if (start === target) return [{ name: start, ...this.data.waypoints[start] }]

    const queue = [[start]]
    const visited = new Set([start])

    while (queue.length > 0) {
      const currentPath = queue.shift()
      const current = currentPath[currentPath.length - 1]

      if (current === target) {
        return currentPath.map(k => ({ name: k, ...this.data.waypoints[k] }))
      }

      const neighbors = this.data.waypoints[current]?.connections || []
      for (const n of neighbors) {
        if (!visited.has(n) && this.data.waypoints[n]) {
          visited.add(n)
          queue.push([...currentPath, n])
        }
      }
    }

    return null
  }
}

/**
 * Generates a top-down volumetric deconstruction block list.
 * Invariant: Sorted Y descending (highest to lowest) to prevent gravel/sand fall
 * and maintain safe foot placement while clearing.
 *
 * @param {{x: number, y: number, z: number}} origin
 * @param {number} radius
 * @param {number} height
 * @returns {Array<{x: number, y: number, z: number, distSq: number}>}
 */
export function generateDeconstructionPlan(origin, radius = 3, height = 3, depth = 0) {
  const r = Math.max(1, Math.min(radius || 3, 10))
  const h = Math.max(1, Math.min(height || 3, 10))
  const d = Math.max(0, Math.min(depth !== undefined ? depth : 0, 5))
  const blocks = []

  const ox = Math.floor(origin.x)
  const oy = Math.floor(origin.y)
  const oz = Math.floor(origin.z)

  for (let y = oy + h - 1; y >= oy - d; y--) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const x = ox + dx
        const z = oz + dz
        const vec = new Vec3(x, y, z)
        vec.distSq = dx * dx + dz * dz
        blocks.push(vec)
      }
    }
  }

  // Sort strictly Y descending first, then closest to center column
  return blocks.sort((a, b) => b.y - a.y || a.distSq - b.distSq)
}

/**
 * PrompterSupervisor: Decouples macro-intents from atomic worker executions.
 * Manages supervisor state, task queues, and macro-intent decomposition.
 */
export class PrompterSupervisor {
  constructor(options = {}) {
    this.memoryPath = options.memoryPath || '/opt/mc-bot/memory.json'
    this.waypointGraph = options.waypointGraph || new WaypointGraph(this.memoryPath)
    this.status = 'IDLE' // IDLE | PLANNING | EXECUTING | ABORTED
    this.activeTask = null
    this.taskQueue = []
  }

  parseMacroIntent(sender, command, args, context = {}) {
    const cmd = command.toLowerCase().trim()

    switch (cmd) {
      case 'come': {
        // If coords provided in args: !come 80 74 -459
        let target = null
        if (args.length >= 3) {
          const x = parseFloat(args[0]), y = parseFloat(args[1]), z = parseFloat(args[2])
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            target = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }
          }
        } else if (context.playerPos && Number.isFinite(context.playerPos.x)) {
          target = context.playerPos
        }
        if (!target) {
          return { type: 'ERROR', message: `I can't see you, ${sender}! Tell me your coords: !goto <x y z> (check F3)` }
        }
        return {
          type: 'NAVIGATE',
          intent: 'come_to_player',
          sender,
          targetPos: target,
          description: `Walking to (${target.x}, ${target.y}, ${target.z})`
        }
      }
      case 'go':
      case 'goto':
      case 'moveto':
      case 'travel':
      case 'walk': {
        const cleanArgs = (args[0] === 'to') ? args.slice(1) : args
        const x = parseFloat(cleanArgs[0])
        const y = parseFloat(cleanArgs[1])
        const z = parseFloat(cleanArgs[2])
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) ||
            Math.abs(x) > 30000000 || Math.abs(z) > 30000000) {
          return { type: 'USAGE', message: 'Usage: !goto <x> <y> <z> (finite world coordinates)' }
        }
        return {
          type: 'NAVIGATE',
          intent: 'goto_coordinates',
          sender,
          targetPos: { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) },
          description: `Navigating to (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})`
        }
      }
      case 'setmark':
      case 'mark': {
        const name = (args[0] || 'mark').toLowerCase()
        let x = parseFloat(args[1])
        let y = parseFloat(args[2])
        let z = parseFloat(args[3])
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
          const pos = context.playerPos || context.botPos
          if (!pos) return { type: 'ERROR', message: 'No position available to mark.' }
          x = pos.x
          y = pos.y
          z = pos.z
        }
        const wp = this.waypointGraph.setWaypoint(name, { x, y, z }, { setBy: sender })
        return {
          type: 'WAYPOINT_SET',
          intent: 'save_waypoint',
          sender,
          name,
          waypoint: wp,
          message: `Saved waypoint '${name}' at (${wp.x}, ${wp.y}, ${wp.z}).`
        }
      }
      case 'gotomark': {
        const name = (args[0] || '').toLowerCase()
        const wp = this.waypointGraph.getWaypoint(name)
        if (!wp) {
          const available = Object.keys(this.waypointGraph.listWaypoints()).join(', ') || 'none'
          return { type: 'ERROR', message: `Unknown mark '${name}'. Saved marks: [${available}]` }
        }

        // Check if there is a connected route from closest waypoint to target
        let route = null
        if (context.botPos) {
          const closest = this._findClosestWaypoint(context.botPos)
          if (closest && closest.name !== name) {
            route = this.waypointGraph.findRoute(closest.name, name)
          }
        }

        return {
          type: 'NAVIGATE',
          intent: 'goto_waypoint',
          sender,
          name,
          route,
          targetPos: { x: wp.x, y: wp.y, z: wp.z },
          description: `Heading to waypoint '${name}' at (${wp.x}, ${wp.y}, ${wp.z})`
        }
      }
      case 'connectmarks': {
        const from = (args[0] || '').toLowerCase()
        const to = (args[1] || '').toLowerCase()
        const ok = this.waypointGraph.connect(from, to)
        if (ok) {
          return { type: 'WAYPOINT_CONNECT', message: `Connected waypoint graph: '${from}' <-> '${to}'.` }
        }
        return { type: 'ERROR', message: `Failed to connect marks '${from}' and '${to}'. Ensure both exist.` }
      }
      case 'marks': {
        const wps = this.waypointGraph.listWaypoints()
        const keys = Object.keys(wps)
        if (keys.length === 0) {
          return { type: 'INFO', message: 'No saved waypoints. Use !setmark <name> to save one.' }
        }
        const list = keys.map(k => `${k}: (${wps[k].x}, ${wps[k].y}, ${wps[k].z})${wps[k].connections?.length ? ' -> [' + wps[k].connections.join(',') + ']' : ''}`).join(' | ')
        return { type: 'INFO', message: `Marks: ${list}` }
      }
      case 'delmark': {
        const name = (args[0] || '').toLowerCase()
        const ok = this.waypointGraph.deleteWaypoint(name)
        if (ok) return { type: 'INFO', message: `Deleted waypoint '${name}'.` }
        return { type: 'ERROR', message: `Mark '${name}' not found.` }
      }
      case 'clear':
      case 'quarry': {
        const r = parseInt(args[0] || '3', 10)
        const h = parseInt(args[1] || '2', 10)
        const origin = context.playerPos || context.botPos
        if (!origin) return { type: 'ERROR', message: 'No position available to clear.' }
        const plan = generateDeconstructionPlan(origin, r, h)
        return {
          type: 'DECONSTRUCT',
          intent: 'clear_area',
          sender,
          radius: r,
          height: h,
          plan,
          description: `Clearing ${r}x${r} area (${h} high, ${plan.length} blocks) top-down`
        }
      }
      case 'stop':
      case 'stay': {
        this.abort()
        return { type: 'ABORT', message: 'Stopped all actions and staying put.' }
      }
      default:
        return null
    }
  }

  _findClosestWaypoint(pos) {
    const wps = this.waypointGraph.listWaypoints()
    let closest = null
    let minDist = Infinity
    for (const [name, wp] of Object.entries(wps)) {
      const dist = Math.hypot(wp.x - pos.x, wp.y - pos.y, wp.z - pos.z)
      if (dist < minDist) {
        minDist = dist
        closest = { name, ...wp, dist }
      }
    }
    return closest
  }

  abort() {
    this.status = 'IDLE'
    this.activeTask = null
    this.taskQueue = []
  }

  getContextSummary(sender = 'player') {
    return this.formatSupervisorContext(sender)
  }

  formatSupervisorContext(sender, context = {}) {
    const wps = this.waypointGraph.listWaypoints()
    const wpList = Object.keys(wps).map(k => `${k}: (${wps[k].x}, ${wps[k].y}, ${wps[k].z})`).join(', ') || 'none'
    const status = context.status || 'Healthy'
    const queueInfo = this.taskQueue.length > 0 ? `Active task queue: ${this.taskQueue.length} items.` : 'Queue empty.'

    return `Supervisor Telemetry: [Status: ${status}] [${queueInfo}] [Waypoints: ${wpList}] [Interacting Player: '${sender}']`
  }
}
