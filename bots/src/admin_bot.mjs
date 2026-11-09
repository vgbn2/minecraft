// Admin & Operator Bot Interface with Interactive REPL and Targeted IPC Command Routing
import mineflayer from 'mineflayer'
import readline from 'readline'
import fs from 'fs'
import path from 'path'
import { IpcManager } from './core/ipc.mjs'

// ANSI terminal color styling
export const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[1;31m',
  green: '\x1b[1;32m',
  yellow: '\x1b[1;33m',
  blue: '\x1b[1;34m',
  magenta: '\x1b[1;35m',
  cyan: '\x1b[1;36m',
  white: '\x1b[1;37m',
  gray: '\x1b[90m'
}

export const SQUAD_ROSTER = ['Jotaro', 'Joseph', 'Polnareff', 'Avdol', 'Kakyoin', 'Iggy']

/**
 * Parses user input lines into structured operator intents and quick macros.
 * ponytail: string split/regex parser; add grammar tree only if multi-stage conditional pipelines are required.
 */
export function parseOperatorLine(line, myPos = null) {
  if (!line || typeof line !== 'string') return null
  const trimmed = line.trim()
  if (!trimmed) return null

  if (trimmed === 'exit' || trimmed === 'quit') {
    return { type: 'EXIT' }
  }

  if (trimmed === 'help' || trimmed === '?') {
    return { type: 'HELP' }
  }

  if (trimmed === '!status' || trimmed === 'status') {
    return { type: 'BROADCAST', command: '!status', description: 'Request status from all squad agents' }
  }

  if (trimmed === '!squad' || trimmed === 'squad') {
    return { type: 'BROADCAST', command: '!squad', description: 'Request squad Stand matrix' }
  }

  if (trimmed === '!stop' || trimmed === 'stop') {
    return { type: 'BROADCAST', command: '!stop', description: 'Emergency halt for all squad kinematics & loops' }
  }

  if (trimmed === '!recall' || trimmed === 'recall') {
    if (myPos && Number.isFinite(myPos.x)) {
      const x = Math.floor(myPos.x)
      const y = Math.floor(myPos.y)
      const z = Math.floor(myPos.z)
      return {
        type: 'BROADCAST',
        command: `!goto ${x} ${y} ${z}`,
        description: `Recall squad to operator location (${x}, ${y}, ${z})`
      }
    }
    return { type: 'BROADCAST', command: '!come', description: 'Recall squad to operator' }
  }

  if (trimmed.startsWith('!goto ')) {
    return { type: 'BROADCAST', command: trimmed, description: `Broadcast spatial navigation: ${trimmed}` }
  }

  const parts = trimmed.split(/\s+/)
  const first = parts[0]
  const rest = parts.slice(1).join(' ')

  if (first.toLowerCase() === 'all' && rest) {
    return { type: 'BROADCAST', command: rest, description: `Broadcast order: ${rest}` }
  }

  const matchedBot = SQUAD_ROSTER.find(b => b.toLowerCase() === first.toLowerCase())
  if (matchedBot && rest) {
    return { type: 'DIRECT', target: matchedBot, command: rest, description: `Direct order to ${matchedBot}: ${rest}` }
  }

  if (trimmed.startsWith('/')) {
    return { type: 'SLASH', command: trimmed, description: `Server command: ${trimmed}` }
  }

  return { type: 'CHAT', message: trimmed, description: `Public chat message: ${trimmed}` }
}

/**
 * Creates and boots an Admin/Operator bot instance.
 */
export function createAdminBot(options = {}) {
  const host = options.host || process.env.MC_HOST || '127.0.0.1'
  const port = parseInt(options.port || process.env.MC_PORT || '25565', 10)
  const username = options.username || process.env.MC_ADMIN_NAME || 'Operator'
  const isInteractive = options.interactive !== false && Boolean(process.stdin.isTTY)

  console.log(`${C.bold}${C.cyan}[*] Initializing Admin Operator Bot '${username}' on ${host}:${port}...${C.reset}`)

  const bot = mineflayer.createBot({
    host,
    port,
    username,
    version: options.version || false,
    auth: 'offline',
    checkTimeoutInterval: 30000
  })

  let rl = null

  function printBanner() {
    console.log(`\n${C.bold}${C.magenta}================================================================================${C.reset}`)
    console.log(`${C.bold}          ✦ JOJO STAND SQUAD OPERATOR CONSOLE & IN-GAME REPL ✦${C.reset}`)
    console.log(`${C.bold}${C.magenta}================================================================================${C.reset}`)
    console.log(` ${C.cyan}Target Server:${C.reset} ${host}:${port} | ${C.green}Operator:${C.reset} ${username}`)
    console.log(` ${C.yellow}Macros:${C.reset} !status | !squad | !recall | !goto <x y z> | !stop | all <cmd> | <bot> <cmd>`)
    console.log(` ${C.gray}Type 'help' for full command list, 'exit' to quit.${C.reset}`)
    console.log(`${C.bold}${C.magenta}--------------------------------------------------------------------------------${C.reset}\n`)
  }

  function printHelp() {
    console.log(`\n${C.bold}Operator Console Quick Reference:${C.reset}`)
    console.log(`  ${C.yellow}!status${C.reset}              Query health, food, position, inventory across all squad bots`)
    console.log(`  ${C.yellow}!squad${C.reset}               Display JoJo Stand stat matrix for the 5 agents`)
    console.log(`  ${C.yellow}!recall${C.reset}              Order all bots to navigate to Operator coordinates`)
    console.log(`  ${C.yellow}!goto <x> <y> <z>${C.reset}    Direct all bots to navigate to target coordinates`)
    console.log(`  ${C.yellow}!stop${C.reset}                Emergency halt for all bot movements and tasks`)
    console.log(`  ${C.cyan}<bot> <cmd>${C.reset}          Send direct command to named bot (e.g. 'Joseph !build', 'Polnareff !mine')`)
    console.log(`  ${C.cyan}all <cmd>${C.reset}            Broadcast command to all active squad members`)
    console.log(`  ${C.green}/<cmd>${C.reset}               Send raw Minecraft server slash command (e.g. '/time set day')`)
    console.log(`  ${C.gray}clear${C.reset}                Clear terminal screen`)
    console.log(`  ${C.gray}exit / quit${C.reset}          Cleanly disconnect Operator and exit\n`)
  }

  bot.on('login', () => {
    console.log(`${C.green}[+] Operator successfully logged into server.${C.reset}`)
  })

  bot.on('spawn', () => {
    const p = bot.entity.position.floored()
    console.log(`${C.bold}${C.green}[+] Operator spawned at (${p.x}, ${p.y}, ${p.z}).${C.reset}`)
    if (isInteractive && !rl) {
      printBanner()
      startRepl()
    }
  })

  bot.on('chat', (sender, message) => {
    if (sender === username) return
    const isSquad = SQUAD_ROSTER.includes(sender)
    const tagColor = isSquad ? C.cyan : C.green
    console.log(`${tagColor}[CHAT] <${sender}>:${C.reset} ${message}`)
    if (rl) rl.prompt(true)
  })

  bot.on('whisper', (sender, message) => {
    if (sender === username) return
    console.log(`${C.magenta}[WHISPER] <${sender}> ➔ <${username}>:${C.reset} ${message}`)
    if (rl) rl.prompt(true)
  })

  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString().trim()
    if (!text) return
    // Filter noise
    if (text.startsWith('<') || text.includes(' whispers to you: ')) return
    console.log(`${C.gray}[SYS] ${text}${C.reset}`)
    if (rl) rl.prompt(true)
  })

  bot.on('kicked', (reason) => {
    console.log(`${C.red}[!] Operator bot was kicked: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}${C.reset}`)
    cleanup()
  })

  bot.on('error', (err) => {
    console.error(`${C.red}[!] Operator bot socket error: ${err.message}${C.reset}`)
  })

  bot.on('end', () => {
    console.log(`${C.yellow}[-] Operator disconnected from server.${C.reset}`)
    cleanup()
  })

  function cleanup() {
    if (rl) {
      rl.close()
      rl = null
    }
  }

  function startRepl() {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `${C.bold}${C.cyan}✦ operator ❯ ${C.reset}`
    })

    rl.prompt()

    rl.on('line', (line) => {
      const intent = parseOperatorLine(line, bot.entity?.position)
      if (!intent) {
        rl.prompt()
        return
      }

      switch (intent.type) {
        case 'EXIT':
          console.log(`${C.yellow}[*] Disconnecting Operator bot...${C.reset}`)
          bot.quit()
          cleanup()
          process.exit(0)
          break

        case 'HELP':
          printHelp()
          break

        case 'BROADCAST':
          console.log(`${C.yellow}[BROADCAST] ${intent.description}${C.reset}`)
          bot.chat(intent.command)
          IpcManager.dispatchCommand('all', intent.command)
          break

        case 'DIRECT':
          console.log(`${C.green}[DIRECT ➔ ${intent.target}] ${intent.description}${C.reset}`)
          bot.whisper(intent.target, intent.command)
          IpcManager.dispatchCommand(intent.target, intent.command)
          break

        case 'SLASH':
          console.log(`${C.cyan}[SLASH] Dispatching: ${intent.command}${C.reset}`)
          bot.chat(intent.command)
          break

        case 'CHAT':
          bot.chat(intent.message)
          break
      }

      rl.prompt()
    })

    rl.on('close', () => {
      console.log(`${C.gray}[*] Console stream closed.${C.reset}`)
    })
  }

  return { bot, parseOperatorLine }
}

// Direct execution entrypoint
if (process.argv[1] && process.argv[1].endsWith('admin_bot.mjs')) {
  createAdminBot()
}
