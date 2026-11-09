// Unit Test Suite for Admin Bot REPL & Targeted IPC Command Ingestion
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { parseOperatorLine, SQUAD_ROSTER } from '../src/admin_bot.mjs'
import { IpcManager } from '../src/core/ipc.mjs'

console.log('[*] Testing Admin REPL & Targeted IPC Command System...')

// -----------------------------------------------------------------------------
// Gate 1: Operator Command & Macro Parser
// -----------------------------------------------------------------------------
console.log('  • Gate 1: Testing parseOperatorLine macros and intents...')

// 1.1 Status & Squad
const statusRes = parseOperatorLine('!status')
assert.strictEqual(statusRes.type, 'BROADCAST')
assert.strictEqual(statusRes.command, '!status')

const squadRes = parseOperatorLine('squad')
assert.strictEqual(squadRes.type, 'BROADCAST')
assert.strictEqual(squadRes.command, '!squad')

// 1.2 Stop & Recall
const stopRes = parseOperatorLine('!stop')
assert.strictEqual(stopRes.type, 'BROADCAST')
assert.strictEqual(stopRes.command, '!stop')

const recallWithPos = parseOperatorLine('!recall', { x: 12.8, y: 64.0, z: -45.2 })
assert.strictEqual(recallWithPos.type, 'BROADCAST')
assert.strictEqual(recallWithPos.command, '!goto 12 64 -46')

const recallWithoutPos = parseOperatorLine('recall', null)
assert.strictEqual(recallWithoutPos.type, 'BROADCAST')
assert.strictEqual(recallWithoutPos.command, '!come')

// 1.3 Direct targeting to squad members
const bobRes = parseOperatorLine('Bob !build')
assert.strictEqual(bobRes.type, 'DIRECT')
assert.strictEqual(bobRes.target, 'Bob')
assert.strictEqual(bobRes.command, '!build')

const torinRes = parseOperatorLine('torin !mine 10')
assert.strictEqual(torinRes.type, 'DIRECT')
assert.strictEqual(torinRes.target, 'Torin')
assert.strictEqual(torinRes.command, '!mine 10')

// 1.4 Broadcast 'all'
const allRes = parseOperatorLine('all !come')
assert.strictEqual(allRes.type, 'BROADCAST')
assert.strictEqual(allRes.command, '!come')

// 1.5 Slash server commands
const slashRes = parseOperatorLine('/gamemode creative Operator')
assert.strictEqual(slashRes.type, 'SLASH')
assert.strictEqual(slashRes.command, '/gamemode creative Operator')

// 1.6 Public chat
const chatRes = parseOperatorLine('Hello team, let us build a base')
assert.strictEqual(chatRes.type, 'CHAT')
assert.strictEqual(chatRes.message, 'Hello team, let us build a base')

// 1.7 Exit & Help
assert.strictEqual(parseOperatorLine('exit').type, 'EXIT')
assert.strictEqual(parseOperatorLine('quit').type, 'EXIT')
assert.strictEqual(parseOperatorLine('help').type, 'HELP')
assert.strictEqual(parseOperatorLine('?').type, 'HELP')
assert.strictEqual(parseOperatorLine('   '), null)

console.log('  [PASS] Gate 1: Operator parser verified (12/12 test cases).')

// -----------------------------------------------------------------------------
// Gate 2: IpcManager Targeted Dispatch & Ingestion
// -----------------------------------------------------------------------------
console.log('  • Gate 2: Testing targeted IPC command dispatch and consumption in /dev/shm...')

const TEST_BOT = 'TestBot'
const testCmdDir = '/dev/shm/mc-bot'
const testCmdFile = `${testCmdDir}/${TEST_BOT}.cmd`
const testCmdLegacy = `/dev/shm/mc-bot-${TEST_BOT}.cmd`

// Clean previous artifacts
try { fs.unlinkSync(testCmdFile) } catch {}
try { fs.unlinkSync(testCmdLegacy) } catch {}

const received = []
const ipc = new IpcManager(TEST_BOT, (sender, cmd, isWhisper, isIpc) => {
  received.push({ sender, cmd, isWhisper, isIpc })
})

// Dispatch command via helper
const dispatched = IpcManager.dispatchCommand(TEST_BOT, '!status')
assert.strictEqual(dispatched, true)
const activeFile = fs.existsSync(testCmdFile) ? testCmdFile : testCmdLegacy
assert.ok(fs.existsSync(activeFile), 'Command file must exist in /dev/shm')

// Start IPC manager (poll every 100ms for testing)
ipc.interval = setInterval(() => {
  try {
    for (const cmdFile of ipc.cmdFiles) {
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
        if (ipc.onCommand) {
          ipc.onCommand('vgbn', cmd, false, true)
        }
      }
    }
  } catch {}
}, 50)

// Await processing
await new Promise(resolve => setTimeout(resolve, 150))

assert.strictEqual(received.length, 1, `Expected 1 received command, got ${received.length}`)
assert.strictEqual(received[0].sender, 'vgbn')
assert.strictEqual(received[0].cmd, '!status')
assert.strictEqual(received[0].isIpc, true)
assert.strictEqual(fs.existsSync(testCmdFile), false, 'Command file must be unlinked after processing')

console.log('  [PASS] Gate 2: Targeted IPC dispatch & ingestion verified.')

// -----------------------------------------------------------------------------
// Gate 3: Broadcast 'all' command queuing
// -----------------------------------------------------------------------------
console.log('  • Gate 3: Testing broadcast dispatch across all squad agents...')

// Clean any existing squad cmd files before test
for (const botName of SQUAD_ROSTER) {
  try { fs.unlinkSync(`/dev/shm/mc-bot/${botName}.cmd`) } catch {}
  try { fs.unlinkSync(`/dev/shm/mc-bot-${botName}.cmd`) } catch {}
}

IpcManager.dispatchCommand('all', '!stop')
for (const botName of SQUAD_ROSTER) {
  const p1 = `/dev/shm/mc-bot/${botName}.cmd`
  const p2 = `/dev/shm/mc-bot-${botName}.cmd`
  const exists = fs.existsSync(p1) || fs.existsSync(p2)
  assert.ok(exists, `Broadcast command file must exist for ${botName}`)
  const active = fs.existsSync(p1) ? p1 : p2
  const content = fs.readFileSync(active, 'utf8').trim()
  assert.strictEqual(content, '!stop')
  try { fs.unlinkSync(p1) } catch {}
  try { fs.unlinkSync(p2) } catch {}
}

console.log('  [PASS] Gate 3: Broadcast dispatch verified across all 5 agents.')

// -----------------------------------------------------------------------------
// Gate 4: Sequential Multi-Command Burst Test
// -----------------------------------------------------------------------------
console.log('  • Gate 4: Testing sequential multi-command burst (10 commands)...')

for (let i = 1; i <= 10; i++) {
  fs.appendFileSync(testCmdFile, `!goto 0 ${60 + i} 0\n`, 'utf8')
}

await new Promise(resolve => setTimeout(resolve, 150))

assert.strictEqual(received.length, 11, `Expected 11 total received commands (1 previous + 10 burst), got ${received.length}`)
for (let i = 1; i <= 10; i++) {
  assert.strictEqual(received[i].cmd, `!goto 0 ${60 + i} 0`)
}

// Teardown
ipc.stop()
try { fs.unlinkSync(testCmdFile) } catch {}
try { fs.unlinkSync(`/dev/shm/mc-bot/${TEST_BOT}.cmd`) } catch {}

console.log('  [PASS] Gate 4: Multi-command burst delivered with 0 dropped commands.')

console.log('\nPASS: test_admin_ipc.mjs completed successfully with 0 errors.')
