#!/usr/bin/env bash
# config_prepare.sh: Paths, config defaults, runtime synchronization, and dependency preparation.
# ponytail: handles local directory state and config mutations; zero npm bloat.

DATA_DIR="${HOME}/.local/share/mc-bot"
CONFIG_FILE="${DATA_DIR}/config.json"
PIDS_DIR="${DATA_DIR}/pids"
LOGS_DIR="/dev/shm/mc-bot"

# Identify bot source directory
if [[ -z "${SOURCE_BOT_DIR:-}" ]]; then
    SCRIPT_ENTRY="$(readlink -f -- "${BASH_SOURCE[0]}")"
    SCRIPT_DIR="$(cd "$(dirname "${SCRIPT_ENTRY}")/.." && pwd)"
    if [[ -d "${SCRIPT_DIR}/mc-bot" ]]; then
        SOURCE_BOT_DIR="${SCRIPT_DIR}/mc-bot"
    else
        SOURCE_BOT_DIR="${SCRIPT_DIR}"
    fi
fi

# Remote CT 116 container configuration
REMOTE_HOST="${MC_REMOTE_HOST:-192.168.4.117}"
REMOTE_USER="${MC_REMOTE_USER:-root}"
REMOTE_DIR="${MC_REMOTE_DIR:-/opt/mc-bot}"
REMOTE_LOG="/dev/shm/mc-bot.log"
REMOTE_PID="/dev/shm/mc-bot.pid"
LOCAL_IP="${MC_LOCAL_IP:-$(ip route get "${REMOTE_HOST}" 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' || hostname -I 2>/dev/null | awk '{print $1}')}"

mkdir -p "${DATA_DIR}" "${PIDS_DIR}" "${LOGS_DIR}"

ensure_config() {
    if [[ ! -f "${CONFIG_FILE}" ]]; then
        cat << 'EOF' > "${CONFIG_FILE}"
{
  "bot_name": "Companion",
  "ai_enabled": true,
  "api_base": "http://127.0.0.1:20128/v1",
  "api_key": "",
  "model": "ag/gemini-3.8-flash",
  "max_distance": 64,
  "view_distance": 5
}
EOF
    fi
}

patch_node_modules_26_3() {
    local target_dir="${1:-${DATA_DIR}}"
    local node_mods="${target_dir}/node_modules"
    [[ -d "${node_mods}" ]] || return 0

    local patch_bin="${BOT_SCRIPTS_DIR:-${SOURCE_BOT_DIR}/scripts}/prismarine_patch.py"
    if [[ -f "${patch_bin}" ]]; then
        python3 -B "${patch_bin}" "${node_mods}" >/dev/null 2>&1 || true
    fi
}

ensure_dependencies() {
    if ! command -v node >/dev/null 2>&1; then
        echo "Error: Node.js is required but not installed." >&2
        return 1
    fi

    ensure_config

    # Sync modular bot directories and entrypoints to runtime directory
    if [[ -d "${SOURCE_BOT_DIR}/src" ]]; then
        cp -r "${SOURCE_BOT_DIR}/src" "${DATA_DIR}/"
    fi
    if [[ -d "${SOURCE_BOT_DIR}/config" ]]; then
        cp -r "${SOURCE_BOT_DIR}/config" "${DATA_DIR}/"
    fi
    cp "${SOURCE_BOT_DIR}"/*.mjs "${DATA_DIR}/" 2>/dev/null || true
    if [[ -f "${SOURCE_BOT_DIR}/package.json" ]]; then
        cp "${SOURCE_BOT_DIR}/package.json" "${DATA_DIR}/package.json"
    fi

    if [[ ! -d "${DATA_DIR}/node_modules" && -d "${SOURCE_BOT_DIR}/node_modules" ]]; then
        ln -sfn "${SOURCE_BOT_DIR}/node_modules" "${DATA_DIR}/node_modules"
    fi

    if [[ ! -d "${DATA_DIR}/node_modules/mineflayer" || ! -d "${DATA_DIR}/node_modules/mineflayer-collectblock" ]]; then
        echo "[*] Initializing companion bot dependencies in ${DATA_DIR}..."
        (cd "${DATA_DIR}" && npm install --silent --no-audit --no-fund)
        echo "[+] Dependencies installed successfully."
    fi

    patch_node_modules_26_3 "${DATA_DIR}"
}

sync_local_bot() {
    ensure_dependencies
    echo "[+] Synced local bot modules to ${DATA_DIR}."
}

configure_bot() {
    ensure_config

    if [[ $# -eq 0 || "${1:-}" == "show" ]]; then
        echo "=== Current mc-bot Configuration ==="
        cat "${CONFIG_FILE}"
        return 0
    fi

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --api-key)
                shift
                local key="$1"
                sed -i -E "s/\"api_key\":\s*\"[^\"]*\"/\"api_key\": \"${key}\"/" "${CONFIG_FILE}"
                echo "[+] Updated API key in ${CONFIG_FILE}"
                ;;
            --api-base)
                shift
                local base="$1"
                sed -i -E "s|\"api_base\":\s*\"[^\"]*\"|\"api_base\": \"${base}\"|" "${CONFIG_FILE}"
                echo "[+] Updated API base URL to ${base}"
                ;;
            --model)
                shift
                local mod="$1"
                sed -i -E "s/\"model\":\s*\"[^\"]*\"/\"model\": \"${mod}\"/" "${CONFIG_FILE}"
                echo "[+] Updated AI model to ${mod}"
                ;;
            --9router)
                sed -i -E 's|"api_base":\s*"[^"]*"|"api_base": "http://127.0.0.1:20128/v1"|' "${CONFIG_FILE}"
                sed -i -E 's/"model":\s*"[^"]*"/"model": "ag\/gemini-3.8-flash"/' "${CONFIG_FILE}"
                echo "[+] Switched provider to local 9Router (ag/gemini-3.8-flash)"
                ;;
            --ollama)
                sed -i -E 's|"api_base":\s*"[^"]*"|"api_base": "http://127.0.0.1:11434/v1"|' "${CONFIG_FILE}"
                sed -i -E 's/"model":\s*"[^"]*"/"model": "qwen2.5-coder:7b"/' "${CONFIG_FILE}"
                sed -i -E 's/"api_key":\s*"[^"]*"/"api_key": "ollama"/' "${CONFIG_FILE}"
                echo "[+] Switched provider to local Ollama (qwen2.5-coder:7b)"
                ;;
            --openai)
                shift
                local okey="$1"
                sed -i -E 's|"api_base":\s*"[^"]*"|"api_base": "https://api.openai.com/v1"|' "${CONFIG_FILE}"
                sed -i -E 's/"model":\s*"[^"]*"/"model": "gpt-4o-mini"/' "${CONFIG_FILE}"
                sed -i -E "s/\"api_key\":\s*\"[^\"]*\"/\"api_key\": \"${okey}\"/" "${CONFIG_FILE}"
                echo "[+] Switched provider to official OpenAI (gpt-4o-mini)"
                ;;
            *)
                echo "Unknown config flag: $1" >&2
                return 1
                ;;
        esac
        shift
    done
}

show_help() {
    cat << 'EOF'
Usage: mc-bot [options] <command> [args...]

Low-resource AI-powered Minecraft companion agent with LAN discovery and cluster delegation.

Discovery & Probing:
  probe [--json|--table]                    Discover LAN games (UDP 4445) and SLP server listeners
  detect                                    Alias for 'probe --table' (endpoint detection)
  discover                                  Alias for 'probe --table'

Local Lifecycle (Host steamlinux):
  start [port|world] [name] [role] [host]   Start local companion bot instance
  stop [name|all]                           Stop specific local bot or all bots
  status                                    List local & remote bots and active games
  squad [start|stop|status|cmd] [target]    Summon & orchestrate 5-agent JoJo Stand squad
  log [name]                                Tail live bot console output from /dev/shm
  flush [name|all]                          Flush/truncate swap-backed logs to 0 bytes
  sync                                      Synchronize bot modules to local runtime directory
  cmd "<command>"                           Send in-game command (e.g. '!status', '!goto 80 74 -459')

Remote Lifecycle (Proxmox CT 116):
  --remote start [port|world] [name] [role] Launch bot remotely on CT 116 (nice=10, 256MB)
  --remote stop                             Cleanly stop remote companion bot on CT 116
  --remote status                           Inspect PID, RAM, CPU, and log status on CT 116
  --remote log (or logs)                    Stream live /dev/shm/mc-bot.log from CT 116 via SSH
  --remote flush                            Truncate /dev/shm/mc-bot.log on CT 116
  --remote sync                             Synchronize modules to CT 116 via scp
  --remote cmd "<command>"                  Send command to remote bot on CT 116 via IPC

AI Configuration:
  config show                               Display active configuration
  config --api-key <key>                    Set custom API key
  config --api-base <url>                   Set custom OpenAI-compatible endpoint
  config --model <model>                    Set model (e.g. ag/gemini-3.8-flash)
  config --9router                          Switch to local 9Router (ag/gemini-3.8-flash)
  config --ollama                           Switch to local Ollama (qwen2.5-coder:7b)
  config --openai <key>                     Switch to official OpenAI (gpt-4o-mini)

Personalities: (JoJo Stand Archetypes)
  commander    Squad Mastermind (Jotaro) - Star Platinum [A/A/C/A/A/A]: tactical orchestrator
  builder      Master architect (Joseph) - Hermit Purple [D/C/A/A/D/E]: defensive & architectural construction
  miner        Swordsman & miner (Polnareff) - Silver Chariot [B/A/C/B/A/C]: underground excavation & quarrying
  guard        Pyro-sentinel (Avdol) - Magician's Red [B/B/C/B/C/D]: perimeter defense & mob neutralization
  farmer       Emerald harvester (Kakyoin) - Hierophant Green [C/B/A/B/C/D]: crop foraging & agricultural supply
  scout        Desert vanguard (Iggy) - The Fool [B/C/D/C/D/C]: perimeter reconnaissance & terrain scouting
  companion    Balanced loyal companion (default) - Echoes ACT 3 [B/B/B/B/B/B]

Examples:
  mc-bot squad start 192.168.4.117:25566    Deploy 5 JoJo agents to Pumpkin Rust server
  mc-bot squad status                       Inspect JoJo Stand stats and RAM for all 5 bots
  mc-bot squad cmd 'Build a forward base'   Orchestrate squad via Mastermind Jotaro
  mc-bot squad stop                         Recall all 5 squad bots cleanly
  mc-bot probe                              Discover all LAN games and servers
  mc-bot start                              Auto-detect game & start local Companion
EOF
}
