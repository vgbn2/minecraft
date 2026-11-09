// Atomic IPC Ingestion & Swap-backed Telemetry
import fs from 'fs'

export class IpcManager {
  constructor(botUsername, onCommand) {
    this.username = botUsername
    this.onCommand = onCommand
    this.cmdFiles = [
      `/dev/shm/mc-bot-${this.username}.cmd`,
      `/dev/shm/mc-bot/${this.username}.cmd`,
      `/dev/shm/mc-bot/all.cmd`,
      process.env.MC_CMD_FILE || `/dev/shm/mc-bot.cmd`
    ]
    this.interval = null
  }

  static dispatchCommand(targetBot, command) {
    if (!targetBot || !command) return false
    const targets = targetBot.toLowerCase() === 'all'
      ? ['Jotaro', 'Bob', 'Torin', 'Arthur', 'Willow']
      : [targetBot]

    for (const b of targets) {
      let cmdPath = `/dev/shm/mc-bot/${b}.cmd`
      try {
        if (!fs.existsSync('/dev/shm/mc-bot')) {
          fs.mkdirSync('/dev/shm/mc-bot', { recursive: true })
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

  start() {
    this.interval = setInterval(() => {
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
    }, 500)
    this.interval.unref()
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  static recordTokens(botUsername, usage = {}, latency = 0, currentTotals) {
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
      const tokensFile = `/dev/shm/mc-bot/${botUsername}.tokens`
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
