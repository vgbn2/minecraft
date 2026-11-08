// ponytail: native zero-dependency combat evasion controller; pure vector math, zero npm bloat
import { Vec3 } from 'vec3'

export class CombatEvasionController {
  constructor(bot) {
    this.bot = bot
    this.active = false
    this.target = null
    this.strafeDir = 1
    this.lastStrafeSwitch = Date.now()
    this.lastAttackTime = 0
    this.shieldActive = false
    this._bindEvents()
  }

  _bindEvents() {
    if (!this.bot?.on) return
    this.bot.on('physicsTick', () => this._onTick())
    this.bot.on('entitySpawn', (e) => this._onEntitySpawn(e))
  }

  start(target) {
    this.target = target
    this.active = true
    if (this.bot.pathfinder) {
      try { this.bot.pathfinder.setGoal(null) } catch {}
    }
  }

  stop() {
    this.active = false
    this.target = null
    this._lowerShield()
    this.bot.clearControlStates?.()
  }

  _onTick() {
    if (!this.active || !this.target || !this.target.isValid) {
      if (this.active) this.stop()
      return
    }

    const bPos = this.bot.entity?.position
    const tPos = this.target.position
    if (!bPos || !tPos) return

    const distXZ = Math.hypot(bPos.x - tPos.x, bPos.z - tPos.z)
    const isCreeper = this.target.name === 'creeper'

    // Look at target head/chest
    try {
      this.bot.lookAt(tPos.offset(0, this.target.height ? this.target.height * 0.8 : 1.4, 0), true)
    } catch {}

    if (isCreeper) {
      this._handleCreeper(distXZ)
      return
    }

    // Golden spacing margin: 2.6m to 2.95m
    if (distXZ < 2.6) {
      this.bot.setControlState('forward', false)
      this.bot.setControlState('back', true)
      this.bot.setControlState('sprint', true)
      this.bot.setControlState('jump', distXZ < 2.0 && Boolean(this.bot.entity.onGround))
    } else if (distXZ > 2.95) {
      this.bot.setControlState('back', false)
      this.bot.setControlState('forward', true)
      this.bot.setControlState('sprint', true)
      this.bot.setControlState('jump', false)
    } else {
      this.bot.setControlState('forward', false)
      this.bot.setControlState('back', false)
      this.bot.setControlState('jump', false)
    }

    // Tangential circle-strafing to evade arrows
    if (Date.now() - this.lastStrafeSwitch > 2500) {
      this.strafeDir *= -1
      this.lastStrafeSwitch = Date.now()
    }
    this.bot.setControlState('left', this.strafeDir === 1)
    this.bot.setControlState('right', this.strafeDir === -1)

    this._attemptMelee(distXZ)
  }

  _handleCreeper(distXZ) {
    if (distXZ <= 2.9) {
      this._attemptMelee(distXZ)
      this.bot.setControlState('forward', false)
      this.bot.setControlState('back', true)
      this.bot.setControlState('sprint', true)
      this.bot.setControlState('jump', Boolean(this.bot.entity?.onGround))
    } else if (distXZ >= 7.0) {
      this.bot.setControlState('back', false)
      this.bot.setControlState('forward', true)
      this.bot.setControlState('sprint', true)
    }
  }

  _attemptMelee(distXZ) {
    const now = Date.now()
    if (now - this.lastAttackTime >= 625 && distXZ <= 3.0) {
      try {
        this.bot.attack(this.target)
        this.lastAttackTime = now
      } catch {}
    }
  }

  _onEntitySpawn(entity) {
    if (!this.active || !entity?.name?.includes('arrow')) return
    const bPos = this.bot.entity?.position
    if (!bPos) return
    const aPos = entity.position
    const dist = bPos.distanceTo(aPos)
    const arrowVel = entity.velocity || new Vec3(0, 0, 0)
    const toBot = bPos.minus(aPos).normalize()
    if (arrowVel.normalize().dot(toBot) > 0.7 && dist < 25) {
      this._raiseShield()
      setTimeout(() => this._lowerShield(), 600)
    }
  }

  async _raiseShield() {
    if (this.shieldActive) return
    const shield = this.bot.inventory?.items()?.find(i => i.name.includes('shield'))
    if (!shield) return
    try {
      if (this.bot.inventory.slots[45]?.name !== shield.name) {
        await this.bot.equip(shield, 'off-hand')
      }
      this.bot.activateItem(true)
      this.shieldActive = true
    } catch {}
  }

  _lowerShield() {
    if (!this.shieldActive) return
    try { this.bot.deactivateItem?.() } catch {}
    this.shieldActive = false
  }
}
