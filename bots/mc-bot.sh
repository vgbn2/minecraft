#!/usr/bin/env bash
# mc-bot.sh: Minecraft multi-agent companion launcher & cluster orchestrator.
# ponytail: modular CLI router (<180 LOC); delegates to lib/*.sh and scripts/*.py.

set -euo pipefail

ENTRY_DIR="$(cd "$(dirname "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd)"
export SOURCE_BOT_DIR="${ENTRY_DIR}"
export BOT_LIB_DIR="${ENTRY_DIR}/lib"
export BOT_SCRIPTS_DIR="${ENTRY_DIR}/scripts"

# Source modular libraries
source "${BOT_LIB_DIR}/config_prepare.sh"
source "${BOT_LIB_DIR}/endpoint_detect.sh"
source "${BOT_LIB_DIR}/bot_supervise.sh"
source "${BOT_LIB_DIR}/remote_orchestrate.sh"
source "${BOT_LIB_DIR}/squad_orchestrate.sh"

# Parse top-level --remote flag or subcommands
IS_REMOTE=0
ARGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --remote|remote)
            IS_REMOTE=1
            shift
            ;;
        --local)
            IS_REMOTE=0
            shift
            ;;
        *)
            ARGS+=("$1")
            shift
            ;;
    esac
done

set -- "${ARGS[@]:-}"
cmd="${1:-status}"
shift || true

# Check if --remote was passed as an option after command
REMAINING_ARGS=()
for arg in "$@"; do
    if [[ "${arg}" == "--remote" ]]; then
        IS_REMOTE=1
    elif [[ "${arg}" == "--local" ]]; then
        IS_REMOTE=0
    else
        REMAINING_ARGS+=("${arg}")
    fi
done
set -- "${REMAINING_ARGS[@]:-}"

case "${cmd}" in
    start)
        if [[ "${IS_REMOTE}" -eq 1 ]]; then
            remote_start_bot "$@"
        else
            start_bot "$@"
        fi
        ;;
    stop)
        if [[ "${IS_REMOTE}" -eq 1 ]]; then
            remote_stop_bot "$@"
        else
            stop_bot "$@"
        fi
        ;;
    status)
        if [[ "${IS_REMOTE}" -eq 1 ]]; then
            remote_status_bot
        else
            status_bot
        fi
        ;;
    log|logs)
        if [[ "${IS_REMOTE}" -eq 1 ]]; then
            remote_log_bot
        else
            log_bot "$@"
        fi
        ;;
    flush)
        if [[ "${IS_REMOTE}" -eq 1 ]]; then
            remote_flush_logs
        else
            flush_logs "$@"
        fi
        ;;
    sync)
        if [[ "${IS_REMOTE}" -eq 1 ]]; then
            remote_sync_bot
        else
            sync_local_bot
        fi
        ;;
    squad)
        dispatch_squad_command "${IS_REMOTE}" "$@"
        ;;
    watchdog|alert|alerts)
        dispatch_squad_command "${IS_REMOTE}" "watchdog" "$@"
        ;;
    repl)
        if [[ "${IS_REMOTE}" -eq 1 ]]; then
            remote_squad_repl
        else
            squad_repl
        fi
        ;;
    admin|operator)
        target_endpoint="${1:-}"
        resolved=$(resolve_endpoint "${target_endpoint}" 0)
        host="${resolved%%:*}"
        port="${resolved##*:}"
        echo "[*] Launching Admin/Operator in-game REPL connecting to ${host}:${port}..."
        node "${SOURCE_BOT_DIR}/src/admin_bot.mjs" "${host}" "${port}" "${2:-Operator}"
        ;;
    monitor)
        if [[ "${IS_REMOTE}" -eq 1 ]]; then
            remote_monitor
        else
            echo "Local Squad Status:"
            status_squad
        fi
        ;;
    cmd)
        send_bot_cmd "${IS_REMOTE}" "$@"
        ;;
    probe|detect|discover)
        dispatch_endpoint_detect "$@"
        ;;
    config)
        configure_bot "$@"
        ;;
    help|-h|--help)
        show_help
        ;;
    *)
        echo "Unknown command: ${cmd}" >&2
        show_help >&2
        exit 1
        ;;
esac
