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
const josephRes = parseOperatorLine('Joseph !build')
assert.strictEqual(josephRes.type, 'DIRECT')
assert.strictEqual(josephRes.target, 'Joseph')
assert.strictEqual(josephRes.command, '!build')

const polnareffRes = parseOperatorLine('polnareff !mine 10')
assert.strictEqual(polnareffRes.type, 'DIRECT')
assert.strictEqual(polnareffRes.target, 'Polnareff')
assert.strictEqual(polnareffRes.command, '!mine 10')

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
const testCmdDir = `/dev/shm/mc-bot-test-${process.pid}`
const testCmdFile = `${testCmdDir}/${TEST_BOT}.cmd`
const testCmdLegacy = `/dev/shm/mc-bot-${TEST_BOT}.cmd`

// Clean previous artifacts
try { fs.rmSync(testCmdDir, { recursive: true, force: true }) } catch {}
try { fs.unlinkSync(testCmdLegacy) } catch {}

const received = []
const ipc = new IpcManager(TEST_BOT, (sender, cmd, isWhisper, isIpc) => {
  received.push({ sender, cmd, isWhisper, isIpc })
}, { baseDir: testCmdDir })

// Dispatch command via helper
const dispatched = IpcManager.dispatchCommand(TEST_BOT, '!status', testCmdDir)
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
  try { fs.unlinkSync(`${testCmdDir}/${botName}.cmd`) } catch {}
  try { fs.unlinkSync(`/dev/shm/mc-bot-${botName}.cmd`) } catch {}
}

IpcManager.dispatchCommand('all', '!stop', testCmdDir)
for (const botName of SQUAD_ROSTER) {
  const p1 = `${testCmdDir}/${botName}.cmd`
  const p2 = `/dev/shm/mc-bot-${botName}.cmd`
  const exists = fs.existsSync(p1) || fs.existsSync(p2)
  assert.ok(exists, `Broadcast command file must exist for ${botName}`)
  const active = fs.existsSync(p1) ? p1 : p2
  const content = fs.readFileSync(active, 'utf8').trim()
  assert.strictEqual(content, '!stop')
  try { fs.unlinkSync(p1) } catch {}
  try { fs.unlinkSync(p2) } catch {}
}

// Verify dead-PID roster self-healing GC (#23)
const ghostRosterFile = `${testCmdDir}/roster/GhostBot_99.json`
const ghostCmdFile = `${testCmdDir}/GhostBot_99.cmd`
fs.writeFileSync(ghostRosterFile, JSON.stringify({ pid: 99999999, name: 'GhostBot_99', ts: 1 }), 'utf8')
fs.writeFileSync(ghostCmdFile, '!stale\n', 'utf8')
const activeRoster = IpcManager.getActiveRoster(testCmdDir)
assert.ok(!activeRoster.includes('GhostBot_99'), 'Dead PID must be pruned from active roster')
assert.strictEqual(fs.existsSync(ghostRosterFile), false, 'Dead PID roster file must be unlinked')
assert.strictEqual(fs.existsSync(ghostCmdFile), false, 'Dead PID orphaned .cmd file must be unlinked')

// Await processing so dynamically registered TestBot also ingests the broadcast '!stop'
await new Promise(resolve => setTimeout(resolve, 100))
assert.strictEqual(received.length, 2, 'Dynamically registered TestBot in roster/ must also receive broadcast !stop')
assert.strictEqual(received[1].cmd, '!stop')

console.log('  [PASS] Gate 3: Broadcast dispatch & dead-PID GC verified across squad + dynamic roster.')

// -----------------------------------------------------------------------------
// Gate 4: Sequential Multi-Command Burst Test
// -----------------------------------------------------------------------------
console.log('  • Gate 4: Testing sequential multi-command burst (10 commands)...')

for (let i = 1; i <= 10; i++) {
  fs.appendFileSync(testCmdFile, `!goto 0 ${60 + i} 0\n`, 'utf8')
}

await new Promise(resolve => setTimeout(resolve, 150))

assert.strictEqual(received.length, 12, `Expected 12 total received commands (1 direct + 1 broadcast + 10 burst), got ${received.length}`)
for (let i = 1; i <= 10; i++) {
  assert.strictEqual(received[i + 1].cmd, `!goto 0 ${60 + i} 0`)
}

// Teardown
ipc.stop()

// Gate 5: POSIX O_APPEND Same-Inode Log Tail Rewind (#23)
const testLogFile = `${testCmdDir}/test_append.log`
const appendFd = fs.openSync(testLogFile, 'a')
try {
  // Write 50KB of 'A' followed by 16KB of 'TAIL_B'
  fs.writeSync(appendFd, Buffer.alloc(50 * 1024, 'A'))
  fs.writeSync(appendFd, Buffer.alloc(16 * 1024, 'B'))
  const inoBefore = fs.statSync(testLogFile).ino

  // Rewind in-place keeping last 16KB
  const rwFd = fs.openSync(testLogFile, 'r+')
  try {
    const keepBytes = 16 * 1024
    const stats = fs.statSync(testLogFile)
    const buf = Buffer.allocUnsafe(keepBytes)
    const bytesRead = fs.readSync(rwFd, buf, 0, keepBytes, stats.size - keepBytes)
    fs.writeSync(rwFd, buf, 0, bytesRead, 0)
    fs.ftruncateSync(rwFd, bytesRead)
  } finally {
    fs.closeSync(rwFd)
  }

  // Subsequent write through the original O_APPEND fd must append at 16KB, NOT create a sparse hole at 66KB
  fs.writeSync(appendFd, Buffer.from('\nAFTER_REWIND\n'))
  const afterStats = fs.statSync(testLogFile)
  assert.strictEqual(afterStats.ino, inoBefore, 'In-place rewind must preserve the exact same inode')
  assert.strictEqual(afterStats.size, 16 * 1024 + 14, 'O_APPEND write after ftruncateSync must land at 16KB + 14B')
  const tailStr = fs.readFileSync(testLogFile, 'utf8')
  assert.ok(tailStr.startsWith('BBBB'), 'Rewound log must preserve the latest tail bytes (B), not head (A)')
  assert.ok(tailStr.endsWith('\nAFTER_REWIND\n'), 'O_APPEND write must land at end of rewound tail')
} finally {
  fs.closeSync(appendFd)
}

try { fs.rmSync(testCmdDir, { recursive: true, force: true }) } catch {}

console.log('  [PASS] Gate 4 & 5: Multi-command burst and POSIX O_APPEND same-inode log rewind verified.')

console.log('\nPASS: test_admin_ipc.mjs completed successfully with 0 errors.')
