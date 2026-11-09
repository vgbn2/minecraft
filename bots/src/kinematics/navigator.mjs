import { Vec3 } from 'vec3'
import { TacticalEscapeExcavator } from './tactical_escape.mjs'
import { execFileSync, spawn } from 'child_process'
import net from 'net'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// ponytail: linear Euclidean hop slicing capped at 16m to stay strictly within loaded chunks; upgrade to navmesh if obstacles exceed 16m
export const MAX_SAFE_HOP_DISTANCE = 16

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CANDIDATE_BINS = [
  process.env.MC_PATH_BIN,
  path.join(__dirname, '../../mc_path_core/target/release/mc-path-fast'),
  '/opt/mc-bot/bin/mc-path-fast',
  '/tmp/mc-path-fast'
].filter(Boolean)

export function getNativePathFinder() {
  for (const p of CANDIDATE_BINS) {
    try {
      if (fs.existsSync(p)) return p
    } catch {}
  }
  return null
}

/**
 * Calculates a sequence of safe waypoints from startPos to targetPos.
 * If distance <= maxHop, returns [targetPos].
 * If distance > maxHop, slices the vector into intermediate hops <= maxHop.
 *
 * @param {{x: number, y: number, z: number}} startPos
 * @param {{x: number, y: number, z: number}} targetPos
 * @param {number} maxHop
 * @returns {Array<{x: number, y: number, z: number, hopIndex: number, totalHops: number, distance: number}>}
 */
export function sliceTrajectory(startPos, targetPos, maxHop = MAX_SAFE_HOP_DISTANCE) {
  if (!startPos || !targetPos) return []
  if (!Number.isFinite(startPos.x) || !Number.isFinite(startPos.y) || !Number.isFinite(startPos.z)) return []
  if (!Number.isFinite(targetPos.x) || !Number.isFinite(targetPos.y) || !Number.isFinite(targetPos.z)) return []

  const safeHop = Math.min(Math.max(1, maxHop), 50)
  const dx = targetPos.x - startPos.x
  const dy = targetPos.y - startPos.y
  const dz = targetPos.z - startPos.z
  const totalDistance = Math.hypot(dx, dy, dz)

  // ponytail: inline <8m short-hop fast path avoids fork/exec syscall overhead
  if (totalDistance <= Math.min(8, safeHop)) {
    return [{
      x: Math.floor(targetPos.x),
      y: Math.floor(targetPos.y),
      z: Math.floor(targetPos.z),
      hopIndex: 1,
      totalHops: 1,
      distance: totalDistance
    }]
  }

  // Fast-path: invoke native Rust kernel (mc_path_core) if compiled binary exists
  const nativeBin = getNativePathFinder()
  if (nativeBin) {
    try {
      const stdout = execFileSync(nativeBin, [
        'slice-json',
        Math.floor(startPos.x), Math.floor(startPos.y), Math.floor(startPos.z),
        Math.floor(targetPos.x), Math.floor(targetPos.y), Math.floor(targetPos.z),
        safeHop
      ], { timeout: 100, encoding: 'utf8' })
      const parsed = JSON.parse(stdout.trim())
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    } catch {}
  }

  if (totalDistance <= safeHop) {
    return [{
      x: Math.floor(targetPos.x),
      y: Math.floor(targetPos.y),
      z: Math.floor(targetPos.z),
      hopIndex: 1,
      totalHops: 1,
      distance: totalDistance
    }]
  }

  const numHops = Math.ceil(totalDistance / safeHop)
  const hops = []

  for (let i = 1; i <= numHops; i++) {
    const fraction = i / numHops
    const isLast = (i === numHops)

    hops.push({
      x: isLast ? Math.floor(targetPos.x) : Math.floor(startPos.x + fraction * dx),
      y: isLast ? Math.floor(targetPos.y) : Math.floor(startPos.y + fraction * dy),
      z: isLast ? Math.floor(targetPos.z) : Math.floor(startPos.z + fraction * dz),
      hopIndex: i,
      totalHops: numHops,
      distance: Math.hypot(
        (isLast ? targetPos.x : startPos.x + fraction * dx) - startPos.x,
        (isLast ? targetPos.y : startPos.y + fraction * dy) - startPos.y,
        (isLast ? targetPos.z : startPos.z + fraction * dz) - startPos.z
      )
    })
  }

  return hops
}

/**
 * SafeNavigator: coordinates Mineflayer pathfinder with hop slicing,
 * closed-loop arrival verification, and timeout aborts.
 */
export class SafeNavigator {
  constructor(bot, options = {}) {
    this.bot = bot
    this.maxHop = options.maxHop || options.maxHopDistance || MAX_SAFE_HOP_DISTANCE
    this.hopTimeoutMs = options.hopTimeoutMs || 25000
    this.arrivalTolerance = options.arrivalTolerance || 1.5
    this.isNavigating = false
    this.currentAbortController = null
    this.excavator = options.excavator || new TacticalEscapeExcavator(this.bot)
  }

  stop() {
    this.isNavigating = false
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
    if (this.bot?.pathfinder) {
      if (this.bot.pathfinder.isMoving()) {
        this.bot.pathfinder.stop()
      } else {
        this.bot.pathfinder.setGoal(null)
      }
    }
  }

  /**
   * Executes safe hop-sliced navigation towards targetPos using closed-loop dynamic re-slicing
   * and async goal gate checks.
   * @param {{x: number, y: number, z: number}} targetPos
   * @param {object} callbacks - { onHopStart, onHopComplete, onProgress }
   * @returns {Promise<{ success: boolean, hopsCompleted: number, totalHops: number, reason?: string }>}
   */
  async navigateTo(targetPos, callbacks = {}) {
    if (!this.bot?.entity?.position) {
      return { success: false, hopsCompleted: 0, totalHops: 0, reason: 'bot_entity_missing' }
    }

    if (this.isNavigating) {
      this.stop()
    }
    this.isNavigating = true
    this.currentAbortController = new AbortController()
    const signal = this.currentAbortController.signal

    let hopsCompleted = 0
    const startPos = this.bot.entity.position
    const initialDist = Math.hypot(targetPos.x - startPos.x, targetPos.z - startPos.z)
    const estTotalHops = Math.max(1, Math.ceil(initialDist / this.maxHop))

    try {
      while (this.isNavigating && !signal.aborted) {
        const cur = this.bot.entity?.position
        if (!cur) return { success: false, hopsCompleted, totalHops: estTotalHops, reason: 'bot_entity_missing' }

        const distXZ = Math.hypot(targetPos.x - cur.x, targetPos.z - cur.z)
        const distY = Math.abs(targetPos.y - cur.y)

        // Target reached gate
        if (distXZ <= this.arrivalTolerance && distY <= 3.0) {
          return { success: true, hopsCompleted, totalHops: Math.max(hopsCompleted, 1) }
        }

        const isFinalHop = (distXZ <= this.maxHop)
        const hopDist = Math.min(this.maxHop, distXZ)
        const angle = Math.atan2(targetPos.z - cur.z, targetPos.x - cur.x)

        const hopX = isFinalHop ? Math.floor(targetPos.x) : Math.floor(cur.x + Math.cos(angle) * hopDist)
        const hopZ = isFinalHop ? Math.floor(targetPos.z) : Math.floor(cur.z + Math.sin(angle) * hopDist)
        const hopY = isFinalHop ? Math.floor(targetPos.y) : Math.floor(cur.y)

        const remainingHops = Math.ceil(distXZ / this.maxHop)
        const totalHops = Math.max(hopsCompleted + remainingHops, estTotalHops)

        const hop = {
          x: hopX,
          y: hopY,
          z: hopZ,
          hopIndex: hopsCompleted + 1,
          totalHops
        }

        if (callbacks.onHopStart) {
          callbacks.onHopStart(hop, hop.hopIndex, totalHops)
        }

        const hopSuccess = await this._executeSingleHop(hop, signal, isFinalHop)
        hopsCompleted++

        if (callbacks.onHopComplete) {
          callbacks.onHopComplete(hop, hopsCompleted, totalHops)
        }

        if (isFinalHop) {
          const finalCur = this.bot.entity?.position
          if (finalCur && Math.hypot(targetPos.x - finalCur.x, targetPos.z - finalCur.z) <= this.arrivalTolerance + 2.0) {
            return { success: true, hopsCompleted, totalHops }
          }
          if (!hopSuccess) {
            return { success: false, hopsCompleted, totalHops, reason: 'final_hop_failed' }
          }
        }

        // Safety ceiling to prevent infinite wandering
        if (hopsCompleted >= estTotalHops * 3 + 15) {
          return { success: false, hopsCompleted, totalHops, reason: 'max_hops_exceeded' }
        }
      }

      return { success: !signal.aborted, hopsCompleted, totalHops: estTotalHops, reason: signal.aborted ? 'aborted' : 'stopped' }
    } finally {
      this.isNavigating = false
      this.currentAbortController = null
    }
  }

  _getSurfaceY(x, z, fallbackY) {
    if (!this.bot?.blockAt) return Math.floor(Number(fallbackY) || 64)
    const bx = Math.floor(Number(x))
    const bz = Math.floor(Number(z))
    const by = Math.floor(Number(fallbackY))

    // ponytail: check if in subterranean cave to avoid sky-snapping, while allowing deep mountain descents outdoors
    let isUnderground = false
    for (let dy = 3; dy <= 8; dy++) {
      const ceil = this.bot.blockAt(new Vec3(bx, by + dy, bz))
      if (ceil && ceil.boundingBox === 'block' && !ceil.name.includes('leaves')) {
        isUnderground = true
        break
      }
    }

    const startY = isUnderground ? Math.min(319, by + 4) : Math.min(319, by + 12)
    const minY = isUnderground ? Math.max(-64, by - 12) : Math.max(-64, by - 35)

    const isPassable = blk => !blk || blk.boundingBox !== 'block' || blk.name === 'air' || blk.name === 'cave_air' || blk.name === 'ladder' || blk.name === 'vine'
    const isSolidGround = blk => blk && (blk.boundingBox === 'block' || blk.name === 'ladder') && !blk.name.includes('leaves')

    for (let y = startY; y >= minY; y--) {
      const b = this.bot.blockAt(new Vec3(bx, y, bz))
      if (isSolidGround(b)) {
        const above1 = this.bot.blockAt(new Vec3(bx, y + 1, bz))
        const above2 = this.bot.blockAt(new Vec3(bx, y + 2, bz))
        if (isPassable(above1) && isPassable(above2)) {
          return y + 1
        }
      }
    }
    return by
  }

  async _executeSingleHop(hop, signal, isFinalHop = false) {
    if (!this.bot?.pathfinder) return false

    if (!this.bot.pathfinder.movements) {
      const { Movements } = await import('mineflayer-pathfinder')
      const move = new Movements(this.bot)
      move.canDig = false // ponytail: disable digging during cross-country travel to prevent recursive block_updated resets
      move.allow1by1towers = false
      move.maxDropDown = 4 // ponytail: natural 4-block descent allows navigating slopes/hills without damage
      move.allowParkour = true
      move.allowSprinting = true
      move.canSwim = true
      move.liquidCost = 15 // ponytail: penalize water to prevent drowning
      move.dontMineUnderFallingBlock = true
      // ponytail: penalize tree leaves to neutralize the Tree Canopy Trap
      if (this.bot.registry?.blocks) {
        for (const blk of Object.values(this.bot.registry.blocks)) {
          if (blk?.name && blk.name.includes('leaves')) {
            move.blocksToAvoid.add(blk.id)
          }
        }
      }
      if (this.bot.registry?.blocksByName?.ladder) move.climbables.add(this.bot.registry.blocksByName.ladder.id)
      if (this.bot.registry?.blocksByName?.vine) move.climbables.add(this.bot.registry.blocksByName.vine.id)
      if (this.bot.registry?.blocksByName?.scaffolding) move.climbables.add(this.bot.registry.blocksByName.scaffolding.id)
      if (this.bot.registry?.blocksByName?.lava) move.blocksToAvoid.add(this.bot.registry.blocksByName.lava.id)
      if (this.bot.registry?.blocksByName?.fire) move.blocksToAvoid.add(this.bot.registry.blocksByName.fire.id)
      if (this.bot.registry?.blocksByName?.sweet_berry_bush) move.blocksToAvoid.add(this.bot.registry.blocksByName.sweet_berry_bush.id)
      if (this.bot.registry?.blocksByName?.powder_snow) move.blocksToAvoid.add(this.bot.registry.blocksByName.powder_snow.id)
      if (this.bot.registry?.blocksByName?.cactus) move.blocksToAvoid.add(this.bot.registry.blocksByName.cactus.id)
      this.bot.pathfinder.setMovements(move)
    }

    let goals = this.bot.pathfinder.goals
    if (!goals) {
      const pathfinderPkg = await import('mineflayer-pathfinder')
      goals = pathfinderPkg.goals || pathfinderPkg.default?.goals
    }

    let goal
    if (isFinalHop) {
      const surfaceY = this._getSurfaceY(hop.x, hop.z, hop.y)
      const targetY = Math.abs(surfaceY - hop.y) <= 3 ? hop.y : surfaceY
      goal = new goals.GoalNear(hop.x, targetY, hop.z, this.arrivalTolerance)
      console.log(`[NAV] Hop ${hop.hopIndex}/${hop.totalHops}: Final approach to (${hop.x}, ${targetY}, ${hop.z})...`)
    } else {
      // Intermediate hops use GoalNearXZ to naturally follow ground elevation without tree canopy traps
      goal = new goals.GoalNearXZ(hop.x, hop.z, this.arrivalTolerance + 1.5)
      console.log(`[NAV] Hop ${hop.hopIndex}/${hop.totalHops}: Heading to (${hop.x}, ~, ${hop.z})...`)
    }

    // Buoyancy monitor prevents sinking/drowning while in water
    const swimTimer = setInterval(() => {
      if (this.bot.entity?.isInWater) {
        this.bot.setControlState('jump', true)
      } else {
        this.bot.setControlState('jump', false)
      }
    }, 150)

    try {
      const success = await this._gotoWithGate(goal, hop, signal, isFinalHop)
      if (success) {
        console.log(`[NAV] Reached hop ${hop.hopIndex}/${hop.totalHops}!`)
      } else {
        console.log(`[NAV] Hop ${hop.hopIndex}/${hop.totalHops} ended (progress gate)`)
      }
      return success
    } catch (err) {
      console.log(`[NAV] Hop ${hop.hopIndex}/${hop.totalHops} ended (${err.message})`)
      return false
    } finally {
      clearInterval(swimTimer)
      this.bot.setControlState('jump', false)
      this.bot.setControlState('forward', false)
      if (this.bot.pathfinder.isMoving()) {
        try { this.bot.pathfinder.stop() } catch {}
      } else {
        try { this.bot.pathfinder.setGoal(null) } catch {}
      }
      this.bot.clearControlStates?.()
      await new Promise(r => setTimeout(r, 50))
    }
  }

  /**
   * Async polling loop with gate checks as goals instead of relying on open-loop pathfinder events.
   */
  async _gotoWithGate(goal, hop, signal, isFinalHop) {
    let pathStatus = 'pending'
    const onPathUpdate = (res) => {
      pathStatus = res.status
      const cur = this.bot.entity?.position
      const p0 = res.path?.[0]
      console.log(`[NAV-DEBUG] path_update: status=${res.status}, len=${res.path?.length}, bot=(${cur?.x?.toFixed(2)},${cur?.y?.toFixed(2)},${cur?.z?.toFixed(2)}), p0=(${p0?.x},${p0?.y},${p0?.z})`)
      if (res.status === 'success' && res.path?.length > 0) {
        console.log(`[NAV-DEBUG] path_nodes: ${res.path.map(n => `(${n.x},${n.y},${n.z})`).join(' -> ')}`)
      }
    }
    const onGoalReached = () => {
      console.log(`[NAV-DEBUG] goal_reached event`)
    }
    const onPathReset = async (reason) => {
      console.log(`[NAV-DEBUG] path_reset: reason=${reason}`)
      if (reason === 'stuck' && this.excavator && !this.excavator.isRecovering) {
        await this.excavator.executeEscape('path_reset_stuck')
      }
    }

    this.bot.on('path_update', onPathUpdate)
    this.bot.on('goal_reached', onGoalReached)
    this.bot.on('path_reset', onPathReset)

    this.bot.pathfinder.setGoal(goal)

    const startTime = Date.now()
    const timeout = isFinalHop ? this.hopTimeoutMs : Math.min(this.hopTimeoutMs, 14000)
    let lastPos = this.bot.entity?.position ? this.bot.entity.position.clone() : null
    let lastProgressTime = Date.now()
    const initialDistXZ = lastPos ? Math.hypot(lastPos.x - hop.x, lastPos.z - hop.z) : 999

    try {
      while (this.isNavigating && !signal.aborted) {
        await new Promise(r => setTimeout(r, 100))
        if (signal.aborted || !this.isNavigating) throw new Error('aborted')

        const cur = this.bot.entity?.position
        if (!cur) throw new Error('bot_entity_missing')

        const distXZ = Math.hypot(cur.x - hop.x, cur.z - hop.z)
        const distY = Math.abs(cur.y - hop.y)

        // GATE 1: Goal Arrival Gate
        if (isFinalHop) {
          if (distXZ <= this.arrivalTolerance && distY <= 2.5) {
            return true
          }
        } else {
          if (distXZ <= this.arrivalTolerance + 1.5) {
            return true
          }
        }

        // GATE 2: Progress & Displacement Tracker
        const stepDisplacement = lastPos ? Math.hypot(cur.x - lastPos.x, cur.z - lastPos.z) : 0
        if (stepDisplacement >= 0.4) {
          lastPos = cur.clone()
          lastProgressTime = Date.now()
        }

        const stallDuration = Date.now() - lastProgressTime
        const elapsed = Date.now() - startTime

        // GATE 3: Stall Detection Gate (Stationary >= 2.5s)
        if (stallDuration >= 2500) {
          if (distXZ <= this.arrivalTolerance + 3.5) {
            return true
          }
          // Jump / unstick impulse & emergency clearance
          if (stallDuration >= 2800 && this.excavator && !this.excavator.isRecovering) {
            this.excavator.executeEscape('stall_gate')
          }
          if (stallDuration < 3800) {
            this.bot.setControlState('jump', true)
          } else {
            this.bot.setControlState('jump', false)
          }
          // If still stalled past 4.0s, bail out so dynamic re-slicing immediately calculates next hop
          if (stallDuration >= 4000) {
            console.log(`[NAV] Stall gate passed after ${Math.round(stallDuration / 1000)}s - distXZ: ${distXZ.toFixed(1)}m`)
            return (distXZ <= initialDistXZ * 0.75) // Passed if closed >=25% of distance
          }
        }

        // GATE 4: Hop Timeout Gate
        if (elapsed >= timeout) {
          console.log(`[NAV] Hop timeout after ${Math.round(elapsed / 1000)}s`)
          return (distXZ <= this.arrivalTolerance + 3.5)
        }
      }
      return false
    } finally {
      this.bot.removeListener('path_update', onPathUpdate)
      this.bot.removeListener('goal_reached', onGoalReached)
      this.bot.removeListener('path_reset', onPathReset)
    }
  }
}

export { SafeNavigator as SafeHopNavigator }

// ponytail: persistent Unix socket client for mc-path-fast --daemon; 0 fork/exec overhead
export class PathDaemonClient {
  constructor(options = {}) {
    this.socketPath = options.socketPath || process.env.MC_PATH_SOCK || `/dev/shm/mc-path-${process.getuid?.() ?? 0}.sock`
    this.socket = null
    this.daemonProc = null
    this.pending = []
    this.buffer = ''
  }

  async connect(spawnIfMissing = true) {
    if (this.socket && !this.socket.destroyed) return true
    const tryConnect = () => new Promise((resolve, reject) => {
      const sock = net.createConnection(this.socketPath)
      const onError = (err) => {
        sock.destroy()
        reject(err)
      }
      sock.once('error', onError)
      sock.once('connect', () => {
        sock.removeListener('error', onError)
        this._attachSocket(sock)
        resolve(true)
      })
    })

    try {
      return await tryConnect()
    } catch (err) {
      if (!spawnIfMissing) throw err
      const bin = getNativePathFinder()
      if (!bin) throw new Error('mc-path-fast binary not found')
      await new Promise((resolve, reject) => {
        const proc = spawn(bin, ['--daemon', this.socketPath], { stdio: ['ignore', 'pipe', 'pipe'] })
        this.daemonProc = proc
        proc.unref()
        const timer = setTimeout(() => reject(new Error('mc-path-fast daemon startup timeout')), 2000)
        proc.stdout.once('data', () => {
          clearTimeout(timer)
          resolve()
        })
        proc.once('error', (e) => {
          clearTimeout(timer)
          reject(e)
        })
      })
      return await tryConnect()
    }
  }

  _attachSocket(sock) {
    this.socket = sock
    this.buffer = ''
    sock.setEncoding('utf8')
    sock.on('data', (chunk) => {
      this.buffer += chunk
      let idx
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx).trim()
        this.buffer = this.buffer.slice(idx + 1)
        const waiter = this.pending.shift()
        if (waiter) {
          try {
            waiter.resolve(JSON.parse(line))
          } catch (e) {
            waiter.reject(e)
          }
        }
      }
    })
    sock.on('close', () => {
      this.socket = null
      while (this.pending.length > 0) {
        this.pending.shift().reject(new Error('socket_closed'))
      }
    })
  }

  async sendCommand(cmdLine) {
    await this.connect(true)
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject })
      this.socket.write(`${cmdLine.trim()}\n`)
    })
  }

  async initWorld({ minY = -64, numSections = 24, protocolVersion = 769, worldEpoch = 1 } = {}) {
    return this.sendCommand(`INIT_WORLD ${minY} ${numSections} ${protocolVersion} ${worldEpoch}`)
  }

  async setClass(x, y, z, nibble) {
    return this.sendCommand(`SET_CLASS ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)} ${nibble & 0x0f}`)
  }

  async sliceAsync(start, target, maxHop = MAX_SAFE_HOP_DISTANCE) {
    return this.sendCommand(
      `SLICE ${Math.floor(start.x)} ${Math.floor(start.y)} ${Math.floor(start.z)} ${Math.floor(target.x)} ${Math.floor(target.y)} ${Math.floor(target.z)} ${maxHop}`
    )
  }

  async findPathF32(start, goal, maxEval = 10000) {
    return this.sendCommand(
      `ASTAR_F32 ${Number(start.x)} ${Number(start.y)} ${Number(start.z)} ${Number(goal.x)} ${Number(goal.y)} ${Number(goal.z)} ${maxEval}`
    )
  }

  async acquireLease(x, y, z, agentId, ttlSec = 30) {
    return this.sendCommand(`LEASE_ACQUIRE ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)} ${agentId} ${ttlSec}`)
  }

  async releaseLease(x, y, z, agentId) {
    return this.sendCommand(`LEASE_RELEASE ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)} ${agentId}`)
  }

  close() {
    if (this.socket) {
      try { this.socket.destroy() } catch {}
      this.socket = null
    }
    if (this.daemonProc) {
      try { this.daemonProc.kill('SIGTERM') } catch {}
      this.daemonProc = null
    }
    try {
      if (fs.existsSync(this.socketPath)) fs.unlinkSync(this.socketPath)
    } catch {}
  }
}
