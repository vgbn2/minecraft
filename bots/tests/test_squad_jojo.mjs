// ponytail: assert-based JoJo Stand squad unit tests; zero external frameworks
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatJojoCard, formatJojoChatLine, formatSquadMatrix } from '../src/squad/jojo_stands.mjs'
import { TOOLS_SCHEMA } from '../src/intelligence/tools_schema.mjs'
import { IpcManager } from '../src/core/ipc.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const personalitiesPath = path.join(__dirname, '../config/personalities.json')
const personalities = JSON.parse(fs.readFileSync(personalitiesPath, 'utf8'))

console.log('[*] Testing JoJo Stand Squad Roster & Archetypes...')

// 1. Roster completeness
const requiredRoster = ['commander', 'builder', 'miner', 'guard', 'farmer', 'scout']
for (const role of requiredRoster) {
  assert.ok(personalities[role], `Missing required role: ${role}`)
  const p = personalities[role]
  assert.ok(p.name, `${role} must have a name`)
  assert.ok(p.stand, `${role} must have a Stand name`)
  assert.ok(p.stats, `${role} must have Stand stats`)
  for (const stat of ['pwr', 'spd', 'rng', 'dur', 'prc', 'dev']) {
    assert.ok(['A', 'B', 'C', 'D', 'E'].includes(p.stats[stat]), `Invalid stat ${stat} on ${p.name}: ${p.stats[stat]}`)
  }
}

// 2. Jotaro Mastermind
assert.strictEqual(personalities.commander.name, 'Jotaro')
assert.strictEqual(personalities.commander.stand, 'Star Platinum')
assert.strictEqual(personalities.commander.smartest, true, 'Jotaro must have smartest: true')
assert.strictEqual(personalities.commander.stats.dev, 'A', 'Jotaro Potential must be A')

// 3. ASCII Radar Card Rendering
const card = formatJojoCard(personalities.commander)
assert.ok(card.includes('Star Platinum'), 'Card must contain Stand name')
assert.ok(card.includes('POWER:       [A] ■■■■■'), 'Card must format Power A bar')
assert.ok(card.includes('POTENTIAL:   [A] ■■■■■'), 'Card must format Potential A bar')

const chatLine = formatJojoChatLine(personalities.builder)
assert.ok(chatLine.includes('Crazy Diamond'), 'Chat line must contain Stand name')
assert.ok(chatLine.includes('Bob'), 'Chat line must contain User name')

const matrix = formatSquadMatrix(personalities)
assert.ok(matrix.includes('Jotaro [Star Platinum]'), 'Matrix must list Jotaro')
assert.ok(matrix.includes('Bob [Crazy Diamond]'), 'Matrix must list Bob')
assert.ok(matrix.includes('Torin [Silver Chariot]'), 'Matrix must list Torin')
assert.ok(matrix.includes('Arthur [The World]'), 'Matrix must list Arthur')
assert.ok(matrix.includes('Willow [Gold Experience]'), 'Matrix must list Willow')

// 4. Delegation Tool Schema
const delegateTool = TOOLS_SCHEMA.find(t => t.function?.name === 'delegate_task')
assert.ok(delegateTool, 'TOOLS_SCHEMA must include delegate_task')
assert.ok(delegateTool.function.parameters.properties.target_agent, 'delegate_task must define target_agent')
assert.ok(delegateTool.function.parameters.properties.command, 'delegate_task must define command')
assert.deepStrictEqual(
  delegateTool.function.parameters.required,
  ['target_agent', 'command'],
  'delegate_task requires target_agent and command'
)

// 5. IPC Delegation Queue Test
const testAgent = 'Torin'
const testIpcFile = `/dev/shm/mc-bot-${testAgent}.cmd`
try { fs.unlinkSync(testIpcFile) } catch {}

const dispatchedCmd = '!mine iron_ore 5'
fs.appendFileSync(testIpcFile, `${dispatchedCmd}\n`)

let receivedCmd = null
const ipc = new IpcManager(testAgent, (sender, cmd) => {
  receivedCmd = cmd
})

// Trigger tick
for (const cmdFile of ipc.cmdFiles) {
  if (fs.existsSync(cmdFile)) {
    const procFile = `${cmdFile}.${process.pid}.proc`
    fs.renameSync(cmdFile, procFile)
    const content = fs.readFileSync(procFile, 'utf8')
    fs.unlinkSync(procFile)
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
    for (const c of lines) {
      ipc.onCommand('vgbn', c, false, true)
    }
  }
}

assert.strictEqual(receivedCmd, dispatchedCmd, 'IPC manager must dispatch received command')
console.log('PASS: test_squad_jojo.mjs completed successfully.')
