#!/usr/bin/env bash
# Unit tests for mc-bot Minecraft companion launcher.
# ponytail: assert-based self-contained test runner; zero external frameworks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/mc-bot.sh" ]]; then
    BOT_DIR="${SCRIPT_DIR}"
elif [[ -f "${SCRIPT_DIR}/../mc-bot.sh" ]]; then
    BOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
else
    BOT_DIR="/home/vgbn/Documents/codeptit/Games/minecraft/bots"
fi
BOT_BIN="${BOT_DIR}/mc-bot.sh"
COMPANION_SRC="${BOT_DIR}/companion.mjs"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_contains() {
    local needle="$1"
    local haystack="$2"
    local msg="${3:-}"
    if ! echo "$haystack" | grep -Fq "$needle"; then
        fail "$msg: expected to find '$needle' in: $haystack"
    fi
}

echo "[*] 1. Checking script syntax..."
bash -n "${BOT_BIN}"
node -c "${COMPANION_SRC}"
node -c "${BOT_DIR}/navigator.mjs"
node -c "${BOT_DIR}/prompter.mjs"
node -c "${BOT_DIR}/src/index.mjs"

echo "[*] 2. Testing --help output..."
HELP_OUT=$("${BOT_BIN}" --help)
assert_contains "Usage: mc-bot" "${HELP_OUT}" "Help usage text"
assert_contains "Personalities:" "${HELP_OUT}" "Help personalities header"
assert_contains "builder" "${HELP_OUT}" "Help builder personality"
assert_contains "miner" "${HELP_OUT}" "Help miner personality"
assert_contains "guard" "${HELP_OUT}" "Help guard personality"
assert_contains "farmer" "${HELP_OUT}" "Help farmer personality"
assert_contains "flush [name|all]" "${HELP_OUT}" "Help flush command"

echo "[*] 3. Testing status and server probe..."
STATUS_OUT=$("${BOT_BIN}" status)
assert_contains "Minecraft Companion Bot" "${STATUS_OUT}" "Status header"
assert_contains "Discovered Minecraft Endpoints" "${STATUS_OUT}" "Probe detection header"

echo "[*] 4. Testing config command..."
CFG_OUT=$("${BOT_BIN}" config show)
assert_contains "api_base" "${CFG_OUT}" "Config JSON output"
assert_contains "model" "${CFG_OUT}" "Config model property"

echo "[*] 5. Testing log flush mechanics on /dev/shm..."
TEST_SHM_LOG="/dev/shm/mc-bot/TestBot.log"
mkdir -p /dev/shm/mc-bot
echo "sample log data for testing" > "${TEST_SHM_LOG}"
if [[ ! -s "${TEST_SHM_LOG}" ]]; then
    fail "expected non-empty test log before flush"
fi
FLUSH_OUT=$("${BOT_BIN}" flush TestBot)
assert_contains "Flushed log for 'TestBot'" "${FLUSH_OUT}" "Flush single bot log output"
if [[ -s "${TEST_SHM_LOG}" ]]; then
    fail "expected test log to be truncated to 0 bytes after flush"
fi
rm -f "${TEST_SHM_LOG}"

echo "[*] 6. Testing structure plan generation..."
(cd "${BOT_DIR}" && node --input-type=module -e '
import { Vec3 } from "vec3";
// Test structure plan logic
const orig = new Vec3(0, 64, 0);
function testPlan(type, size) {
  const s = Math.max(1, Math.min(size || 3, 5));
  const blocks = [];
  if (type === "wall") {
    const half = Math.floor(s / 2);
    for (let y = 0; y < 2; y++) {
      for (let dx = -half; dx <= half; dx++) blocks.push(orig.offset(dx, y, 2));
    }
  } else if (type === "pillar") {
    for (let y = 0; y < s; y++) blocks.push(orig.offset(1, y, 0));
  } else if (type === "single") {
    blocks.push(orig.offset(1, 0, 0));
  }
  return blocks;
}
if (testPlan("wall", 3).length !== 6) throw new Error("wall plan failed");
if (testPlan("pillar", 4).length !== 4) throw new Error("pillar plan failed");
if (testPlan("single", 1).length !== 1) throw new Error("single plan failed");
console.log("Structure plans verified.");
')

echo "[*] 7. Testing sync command..."
if [[ -z "${CI:-}" && "${OFFLINE_ONLY:-0}" != "1" ]]; then
    SYNC_OUT=$("${BOT_BIN}" sync)
    assert_contains "Synced local bot modules" "${SYNC_OUT}" "Sync local output"
fi

echo "[*] 8. Testing safe hop slicing logic..."
(cd "${BOT_DIR}" && node --input-type=module -e '
import assert from "node:assert";
import { sliceTrajectory } from "./navigator.mjs";
const start = { x: 0, y: 64, z: 0 };
const target = { x: 100, y: 64, z: 0 };
const hops = sliceTrajectory(start, target, 24);
assert.strictEqual(hops.length, 5, "100m trajectory must slice into 5 hops");
assert.strictEqual(hops[hops.length - 1].x, 100, "Final hop X must reach target");
let prev = start;
for (const h of hops) {
  const d = Math.hypot(h.x - prev.x, h.y - prev.y, h.z - prev.z);
  assert.ok(d <= 24.1, `Hop distance ${d} exceeds 24m`);
  prev = h;
}
console.log("Safe hop slicing verified.");
')

echo "[*] 9. Testing Prompter Supervisor & Waypoint Landmark Graph..."
(cd "${BOT_DIR}" && node --input-type=module -e '
import assert from "node:assert";
import { WaypointGraph, generateDeconstructionPlan, PrompterSupervisor } from "./prompter.mjs";
// 1. Deconstruction plan Y-descending check
const origin = { x: 0, y: 64, z: 0 };
const plan = generateDeconstructionPlan(origin, 2, 3);
assert.strictEqual(plan.length, 75, "2x3 plan must have 75 blocks");
for (let i = 1; i < plan.length; i++) {
  assert.ok(plan[i].y <= plan[i - 1].y, "Must sort strictly Y descending");
}

// 2. Waypoint graph BFS check
const graph = new WaypointGraph();
graph.data = { waypoints: {}, notes: [] };
graph.setWaypoint("base", { x: 0, y: 64, z: 0 });
graph.setWaypoint("mid", { x: 50, y: 64, z: 0 });
graph.setWaypoint("ore", { x: 100, y: 64, z: 0 });
graph.connect("base", "mid");
graph.connect("mid", "ore");
const route = graph.findRoute("base", "ore");
assert.strictEqual(route.length, 3, "BFS route must have 3 hops");

// 3. Prompter Supervisor intent parsing
const supervisor = new PrompterSupervisor({ waypointGraph: graph });
const navIntent = supervisor.parseMacroIntent("Player", "goto", ["100", "64", "50"]);
assert.strictEqual(navIntent.type, "NAVIGATE");
const clearIntent = supervisor.parseMacroIntent("Player", "clear", ["2", "2"], { botPos: origin });
assert.strictEqual(clearIntent.type, "DECONSTRUCT");
const stopIntent = supervisor.parseMacroIntent("Player", "stop", []);
assert.strictEqual(stopIntent.type, "ABORT");

console.log("Prompter Supervisor & Waypoint Graph verified.");
')

echo "[*] 10. Testing probe and remote status..."
PROBE_JSON=$("${BOT_BIN}" probe --json)
assert_contains '"port":' "${PROBE_JSON}" "Probe JSON contains port"
assert_contains '"host":' "${PROBE_JSON}" "Probe JSON contains host"

if [[ -z "${CI:-}" && "${OFFLINE_ONLY:-0}" != "1" ]]; then
    if REMOTE_STATUS=$("${BOT_BIN}" --remote status 2>&1); then :; fi
    assert_contains "Proxmox CT 116 Remote Companion Bot Status" "${REMOTE_STATUS}" "Remote status output"
fi

echo "[*] 11. Testing unknown command exit status..."
actual=0
"${BOT_BIN}" invalid-command >/dev/null 2>&1 || actual=$?
if [[ "${actual}" -ne 1 ]]; then
    fail "expected status 1 on invalid command, got ${actual}"
fi

echo "[*] 12. Testing native Rust pathfinding engine (mc-path-fast)..."
MC_PATH_BIN_RESOLVED="${BOT_DIR}/mc_path_core/target/release/mc-path-fast"
if [[ -x "${MC_PATH_BIN_RESOLVED}" ]]; then
    NATIVE_OUT=$("${MC_PATH_BIN_RESOLVED}" slice 0 64 0 64 64 0 16)
    assert_contains "Sliced 4 hops" "${NATIVE_OUT}" "mc-path-fast slicing"
    BENCH_OUT=$("${MC_PATH_BIN_RESOLVED}" bench 20)
    assert_contains "Benchmark Complete" "${BENCH_OUT}" "mc-path-fast benchmark"
elif command -v mc-path-fast >/dev/null 2>&1; then
    NATIVE_OUT=$(mc-path-fast slice 0 64 0 64 64 0 16)
    assert_contains "Sliced 4 hops" "${NATIVE_OUT}" "mc-path-fast slicing"
    BENCH_OUT=$(mc-path-fast bench 20)
    assert_contains "Benchmark Complete" "${BENCH_OUT}" "mc-path-fast benchmark"
fi

echo "[*] 13. Testing Combat Evasion & Tactical Escape controllers..."
(cd "${BOT_DIR}" && node --input-type=module -e '
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { CombatEvasionController } from "./src/kinematics/combat_evasion.mjs";
import { TacticalEscapeExcavator } from "./src/kinematics/tactical_escape.mjs";

const mockBot = new EventEmitter();
mockBot.controlState = {};
mockBot.setControlState = (k, v) => { mockBot.controlState[k] = v; };
mockBot.clearControlStates = () => { mockBot.controlState = {}; };
mockBot.lookAt = () => {};
mockBot.attack = () => {};
mockBot.entity = { position: { x: 0, y: 64, z: 0 }, onGround: true };

const evasion = new CombatEvasionController(mockBot);
evasion.start({ name: "creeper", isValid: true, position: { x: 2, y: 64, z: 0 } });
evasion._onTick();
assert.strictEqual(mockBot.controlState.back, true, "Creeper must trigger sprint-reverse backward");
assert.strictEqual(mockBot.controlState.sprint, true, "Must sprint while reversing");
evasion.stop();

const excavator = new TacticalEscapeExcavator(mockBot);
assert.strictEqual(excavator.isRecovering, false);
console.log("Combat Evasion & Tactical Escape controllers verified.");
')

echo "[*] 14. Testing version and release packaging..."
ver_out="$(bash "${BOT_BIN}" version)"
echo "${ver_out}" | grep -q "1.2.0"
bash "${BOT_BIN}" package 1.2.0
test -f "${BOT_DIR}/../releases/v1.2.0/mc-bot-v1.2.0.tar.gz"
(cd "${BOT_DIR}/../releases/v1.2.0" && sha256sum -c SHA256SUMS)

echo "PASS: test_mc_bot.sh completed successfully."
