// ponytail: native zero-dependency obstacle & entrapment excavator
import { Vec3 } from 'vec3'

export class TacticalEscapeExcavator {
  constructor(bot) {
    this.bot = bot
    this.isRecovering = false
    this.lastPosition = null
    this.stationaryTicks = 0
    this._bindMonitor()
  }

  _bindMonitor() {
    if (!this.bot?.on) return
    this.bot.on('physicsTick', () => {
      if (this.isRecovering || !this.bot.entity) return
      const curPos = this.bot.entity.position
      if (!this.lastPosition) {
        this.lastPosition = curPos.clone()
        return
      }

      const isMoving = this.bot.pathfinder?.isMoving?.() ||
                       Boolean(this.bot.controlState?.forward) ||
                       Boolean(this.bot.controlState?.back)

      const delta = Math.hypot(curPos.x - this.lastPosition.x, curPos.z - this.lastPosition.z)

      if (isMoving && delta < 0.10 && Boolean(this.bot.entity.onGround)) {
        this.stationaryTicks++
      } else {
        this.stationaryTicks = 0
      }

      this.lastPosition = curPos.clone()

      if (this.stationaryTicks >= 20) {
        this.stationaryTicks = 0
        this.executeEscape('kinematic_stall_20t')
      }
    })
  }

  async executeEscape(reason = 'manual') {
    if (this.isRecovering || !this.bot.entity) return false
    this.isRecovering = true
    console.log(`[!] TacticalEscape: Entrapment detected (reason: ${reason}). Initiating clearance...`)

    if (this.bot.pathfinder) {
      try { this.bot.pathfinder.setGoal(null) } catch {}
    }
    this.bot.clearControlStates?.()

    try {
      const bPos = this.bot.entity.position.floored()

      // 1. Check for immediate Suffocation (Head in solid block)
      const headPos = bPos.offset(0, 1, 0)
      const headBlock = this.bot.blockAt(headPos)
      if (headBlock && headBlock.boundingBox === 'block' && headBlock.name !== 'air') {
        console.log(`[!] TacticalEscape: Suffocation hazard (${headBlock.name})! Mining head block...`)
        await this._equipBestTool(headBlock)
        try { await this.bot.dig(headBlock) } catch {}
      }

      // 2. Identify forward direction vector from yaw
      const yaw = this.bot.entity.yaw
      const forwardX = -Math.sin(yaw)
      const forwardZ = -Math.cos(yaw)
      const stepDir = new Vec3(Math.round(forwardX), 0, Math.round(forwardZ))

      // 3. Check 2-block barrier directly ahead
      const wallFoot = bPos.plus(stepDir)
      const wallHead = wallFoot.offset(0, 1, 0)

      for (const targetPos of [wallHead, wallFoot]) {
        const b = this.bot.blockAt(targetPos)
        if (b && b.boundingBox === 'block' && b.name !== 'air' && !b.name.includes('bedrock')) {
          console.log(`[!] TacticalEscape: Mining barrier block ${b.name} at ${targetPos}...`)
          await this._equipBestTool(b)
          try { await this.bot.dig(b) } catch {}
        }
      }

      // 4. Brief forward step impulse to clear threshold
      this.bot.setControlState('forward', true)
      if (Boolean(this.bot.entity.onGround)) {
        this.bot.setControlState('jump', true)
      }
      await new Promise(r => setTimeout(r, 450))
      this.bot.clearControlStates?.()
      return true
    } catch (err) {
      console.log(`[!] TacticalEscape error: ${err.message}`)
      return false
    } finally {
      this.isRecovering = false
      console.log('[+] TacticalEscape: Clearance routine complete.')
    }
  }

  async _equipBestTool(block) {
    if (!this.bot.equip) return
    const items = this.bot.inventory?.items() || []
    const name = (block.name || '').toLowerCase()

    let tool = null
    if (name.includes('stone') || name.includes('ore') || name.includes('deepslate') || name.includes('cobblestone')) {
      tool = items.find(i => i.name.includes('pickaxe'))
    } else if (name.includes('dirt') || name.includes('gravel') || name.includes('sand') || name.includes('grass')) {
      tool = items.find(i => i.name.includes('shovel'))
    } else if (name.includes('wood') || name.includes('log') || name.includes('planks')) {
      tool = items.find(i => i.name.includes('axe') && !i.name.includes('pickaxe'))
    }

    if (tool) {
      try { await this.bot.equip(tool, 'hand') } catch {}
    }
  }
}
