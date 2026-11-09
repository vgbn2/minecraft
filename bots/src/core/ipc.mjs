// Atomic IPC Ingestion, Directory-as-Registry & Self-Healing Dead-PID GC
import fs from 'fs'
import path from 'path'

export const DEFAULT_SQUAD_NAMES = ['Jotaro', 'Joseph', 'Polnareff', 'Avdol', 'Kakyoin', 'Iggy']

export class IpcManager {
  constructor(botUsername, onCommand, options = {}) {
    this.username = botUsername
    this.onCommand = onCommand
    this.baseDir = options.baseDir || process.env.MC_IPC_DIR || '/dev/shm/mc-bot'
    this.rosterDir = path.join(this.baseDir, 'roster')
    this.cmdFiles = [
      `/dev/shm/mc-bot-${this.username}.cmd`,
      path.join(this.baseDir, `${this.username}.cmd`)
    ]
    if (process.env.MC_CMD_FILE) {
      this.cmdFiles.push(process.env.MC_CMD_FILE)
    }
    this.interval = null
    this.registerSelf()
  }

  registerSelf(pid = process.pid) {
    if (!this.username) return
    try {
      fs.mkdirSync(this.rosterDir, { recursive: true })
      const rosterFile = path.join(this.rosterDir, `${this.username}.json`)
      const tmpFile = `${rosterFile}.${pid}.tmp`
      fs.writeFileSync(tmpFile, JSON.stringify({
        pid,
        name: this.username,
        ts: Date.now()
      }), 'utf8')
      fs.renameSync(tmpFile, rosterFile)
    } catch {}
  }

  unregisterSelf() {
    if (!this.username) return
    try {
      fs.unlinkSync(path.join(this.rosterDir, `${this.username}.json`))
    } catch {}
  }

  static isPidAlive(pid) {
    const num = Number(pid)
    if (!Number.isInteger(num) || num <= 0) return false
    try {
      process.kill(num, 0)
      return true
    } catch (err) {
      return err && err.code === 'EPERM'
    }
  }

  static getActiveRoster(baseDir = process.env.MC_IPC_DIR || '/dev/shm/mc-bot') {
    const rosterDir = path.join(baseDir, 'roster')
    const activeNames = []
    try {
      if (!fs.existsSync(rosterDir)) return activeNames
      const entries = fs.readdirSync(rosterDir)
      for (const file of entries) {
        if (!file.endsWith('.json')) continue
        const fullPath = path.join(rosterDir, file)
        try {
          const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
          const botName = data?.name || file.slice(0, -5)
          if (IpcManager.isPidAlive(data?.pid)) {
            activeNames.push(botName)
          } else {
            // Self-healing GC: reap stale roster entry and orphaned .cmd file after SIGKILL / OOM
            try { fs.unlinkSync(fullPath) } catch {}
            try { fs.unlinkSync(path.join(baseDir, `${botName}.cmd`)) } catch {}
          }
        } catch {
          try { fs.unlinkSync(fullPath) } catch {}
        }
      }
    } catch {}
    return activeNames
  }

  static isRegisteredBot(name, baseDir = process.env.MC_IPC_DIR || '/dev/shm/mc-bot') {
    if (!name) return false
    const clean = String(name).trim()
    if (!clean) return false
    const rosterDir = path.join(baseDir, 'roster')
    try {
      if (!fs.existsSync(rosterDir)) return false
      const directFile = path.join(rosterDir, `${clean}.json`)
      if (fs.existsSync(directFile)) {
        const data = JSON.parse(fs.readFileSync(directFile, 'utf8'))
        if (IpcManager.isPidAlive(data?.pid)) return true
        try { fs.unlinkSync(directFile) } catch {}
        return false
      }
      const lower = clean.toLowerCase()
      for (const active of IpcManager.getActiveRoster(baseDir)) {
        if (active.toLowerCase() === lower) return true
      }
    } catch {}
    return false
  }

  static dispatchCommand(targetBot, command, baseDir = process.env.MC_IPC_DIR || '/dev/shm/mc-bot') {
    if (!targetBot || !command) return false
    let targets
    if (targetBot.toLowerCase() === 'all') {
      const merged = new Map()
      for (const b of DEFAULT_SQUAD_NAMES) merged.set(b.toLowerCase(), b)
      for (const b of IpcManager.getActiveRoster(baseDir)) merged.set(b.toLowerCase(), b)
      targets = Array.from(merged.values())
    } else {
      targets = [targetBot]
    }

    for (const b of targets) {
      let cmdPath = path.join(baseDir, `${b}.cmd`)
      try {
        if (!fs.existsSync(baseDir)) {
          fs.mkdirSync(baseDir, { recursive: true })
        }
      } catch {
        cmdPath = `/dev/shm/mc-bot-${b}.cmd`
      }
      try {
        fs.appendFileSync(cmdPath, `${command.trim()}\n`, 'utf8')
      } catch {
        try { fs.appendFileSync(`/dev/shm/mc-bot-${b}.cmd`, `${command.trim()}\n`, 'utf8') } catch {}
      }
    }
    return true
  }

  pollOnce() {
    try {
      for (const cmdFile of this.cmdFiles) {
        if (!fs.existsSync(cmdFile)) continue
        const procFile = `${cmdFile}.${process.pid}.proc`
        try {
          fs.renameSync(cmdFile, procFile)
        } catch {
          continue
        }
        const content = fs.readFileSync(procFile, 'utf8')
        try { fs.unlinkSync(procFile) } catch { fs.truncateSync(procFile, 0) }

        const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
        for (const cmd of lines) {
          console.log(`[IPC CMD] Executing command for '${this.username}': "${cmd}"`)
          if (this.onCommand) {
            this.onCommand('vgbn', cmd, false, true)
          }
        }
      }
    } catch {}
  }

  start() {
    this.registerSelf()
    this.interval = setInterval(() => this.pollOnce(), 500)
    this.interval.unref()
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.unregisterSelf()
  }

  static recordTokens(botUsername, usage = {}, latency = 0, currentTotals, baseDir = process.env.MC_IPC_DIR || '/dev/shm/mc-bot') {
    const p = usage.prompt_tokens || 0
    const c = usage.completion_tokens || 0
    const t = usage.total_tokens || (p + c)
    currentTotals.prompt += p
    currentTotals.completion += c
    currentTotals.total += t
    currentTotals.calls++
    currentTotals.lastLatency = latency

    console.log(`[TOKEN USAGE] In: ${p} | Out: ${c} | Total: ${t} | Session: ${currentTotals.total} tokens (${currentTotals.calls} calls, ${latency}ms)`)

    try {
      fs.mkdirSync(baseDir, { recursive: true })
      const tokensFile = path.join(baseDir, `${botUsername}.tokens`)
      fs.writeFileSync(tokensFile, JSON.stringify({
        total: currentTotals.total,
        prompt: currentTotals.prompt,
        completion: currentTotals.completion,
        calls: currentTotals.calls,
        lastLatencyMs: latency,
        lastCallTokens: t
      }))
    } catch {}
  }
}
