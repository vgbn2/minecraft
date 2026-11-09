// ponytail: native zero-dependency stationary & stall watchdog; alerts on unexpected stillness unless commanded standby/afk
export class MotionWatchdog {
  constructor(bot, options = {}) {
    this.bot = bot
    this.idleThresholdSec = options.idleThresholdSec || 10
    this.mode = options.initialMode || 'IDLE' // 'STANDBY' | 'AFK_FARM' | 'TASK_ACTIVE' | 'IDLE'
    this.activeTask = options.initialTask || null
    this.lastPosition = null
    this.stationaryStartMs = options.now ? options.now() : Date.now()
    this.lastMoveMs = this.stationaryStartMs
    this.isAlerting = false
    this.lastAlertMs = 0
    this.alertCooldownMs = options.alertCooldownMs || 15000
    this.onAlert = options.onAlert || null
    this.nowFn = options.now || (() => Date.now())

    this._bindEvents()
  }

  setMode(mode, taskDescription = null) {
    this.mode = mode
    this.activeTask = taskDescription
    const now = this.nowFn()
    this.stationaryStartMs = now
    const wasAlerting = this.isAlerting
    this.isAlerting = false
    if (typeof this.onAlert === 'function') {
      this.onAlert(null, this.queryStatus(now))
    }
  }

  _bindEvents() {
    if (!this.bot?.on) return
    this.bot.on('physicsTick', () => this.evaluateCheck())
  }

  evaluateCheck(timestamp = null) {
    const now = timestamp || this.nowFn()
    if (!this.bot?.entity?.position) return null

    const pos = this.bot.entity.position
    if (!this.lastPosition) {
      this.lastPosition = { x: pos.x, y: pos.y, z: pos.z }
      this.lastMoveMs = now
      if (!this.stationaryStartMs) this.stationaryStartMs = now
    }

    const dist = Math.hypot(pos.x - this.lastPosition.x, pos.z - this.lastPosition.z)
    if (dist >= 0.15) {
      const wasAlerting = this.isAlerting
      this.lastPosition = { x: pos.x, y: pos.y, z: pos.z }
      this.lastMoveMs = now
      this.stationaryStartMs = now
      this.isAlerting = false
      if (wasAlerting && typeof this.onAlert === 'function') {
        this.onAlert(null, this.queryStatus(now))
      }
      return this.queryStatus(now)
    }

    const stationaryDurationSec = Math.floor((now - this.stationaryStartMs) / 1000)

    // Exemption 1: Explicitly commanded to stand still (STANDBY) or AFK at a farm (AFK_FARM)
    if (this.mode === 'STANDBY' || this.mode === 'AFK_FARM') {
      this.isAlerting = false
      return this.queryStatus(now)
    }

    // Exemption 2: Legitimate stationary action (actively digging or collecting blocks)
    const isDigging = Boolean(this.bot.targetDigBlock)
    const isCollecting = Boolean(this.bot.collectBlock && !this.bot.collectBlock.targets?.empty)
    if (isDigging || isCollecting) {
      this.isAlerting = false
      return this.queryStatus(now)
    }

    // Alert condition: Stationary for >= idleThresholdSec without explicit exemption
    if (stationaryDurationSec >= this.idleThresholdSec) {
      this.isAlerting = true
      if (now - this.lastAlertMs >= this.alertCooldownMs) {
        this.lastAlertMs = now
        const msg = `[ALERT] Agent ${this.bot.username || 'Bot'} is standing still unexpectedly for ${stationaryDurationSec}s! Mode: ${this.mode}${this.activeTask ? ` | Task: ${this.activeTask}` : ''} at (${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`
        console.warn(msg)
        if (typeof this.onAlert === 'function') {
          this.onAlert(msg, this.queryStatus(now))
        }
      }
    }

    return this.queryStatus(now)
  }

  queryStatus(timestamp = null) {
    const now = timestamp || this.nowFn()
    const pos = this.bot?.entity?.position || this.lastPosition || { x: 0, y: 0, z: 0 }
    const stationaryDurationSec = Math.max(0, Math.floor((now - this.stationaryStartMs) / 1000))
    const isExempt = (this.mode === 'STANDBY' || this.mode === 'AFK_FARM')
    const isDigging = Boolean(this.bot?.targetDigBlock)
    const isCollecting = Boolean(this.bot?.collectBlock && !this.bot.collectBlock.targets?.empty)

    return {
      username: this.bot?.username || 'unknown',
      mode: this.mode,
      activeTask: this.activeTask,
      position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
      isStationary: stationaryDurationSec > 0,
      stationaryDurationSec,
      isExempt,
      isDigging,
      isCollecting,
      isAlerting: this.isAlerting,
      alertReason: this.isAlerting
        ? `Stationary for ${stationaryDurationSec}s (threshold: ${this.idleThresholdSec}s) without standby/afk exemption`
        : null
    }
  }
}
