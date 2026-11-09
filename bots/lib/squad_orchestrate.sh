#!/usr/bin/env bash
# squad_orchestrate.sh: JoJo Stand Squad multi-agent coordination, lifecycle, and IPC routing.
# ponytail: bash IPC orchestration over /dev/shm pipes; zero extra dependencies.

start_squad() {
    local target_arg="${1:-}"
    local resolved
    resolved=$(resolve_endpoint "${target_arg}" 0)

    echo "================================================================================"
    echo "       ✦ JOJO STAND SQUAD: 5 AUTONOMOUS COLLABORATIVE AGENTS ✦"
    echo "       Target Server: ${resolved}"
    echo "================================================================================"

    local squad_roster=(
        "Jotaro:commander:Star Platinum (A/A/C/A/A/A - Mastermind/Smartest)"
        "Bob:builder:Crazy Diamond (A/A/D/B/A/C - Architect)"
        "Torin:miner:Silver Chariot (B/A/C/B/A/C - Miner)"
        "Arthur:guard:The World (A/B/B/A/B/B - Sentinel)"
        "Willow:farmer:Gold Experience (C/A/A/C/A/B - Harvester)"
    )

    for entry in "${squad_roster[@]}"; do
        IFS=":" read -r bname bpers bstand <<< "${entry}"
        echo " ► Summoning Stand User '${bname}' [${bpers}] (Stand: ${bstand})..."
        start_bot "${resolved}" "${bname}" "${bpers}"
        sleep 1
    done

    echo ""
    echo "[+] JoJo Squad fully deployed on ${resolved}!"
    echo "[*] Orchestrator: 'Jotaro' [Star Platinum] (Smartest, Rank A Potential & Precision)"
    echo "[*] Command the squad via: mc-bot squad cmd '<objective>' or mc-bot cmd Jotaro '<goal>'"
}

stop_squad() {
    echo "[*] Recalling all JoJo Stand squad users..."
    local squad_members=("Jotaro" "Bob" "Torin" "Arthur" "Willow")
    for bname in "${squad_members[@]}"; do
        stop_bot "${bname}"
    done
    echo "[+] Squad recall complete."
}

status_squad() {
    echo "================================================================================"
    echo "                      ✦ JOJO STAND SQUAD STATUS MATRIX ✦"
    echo "================================================================================"
    printf "%-8s %-16s %-11s %-16s %-20s\n" "AGENT" "STAND" "ROLE" "STATS(P/S/R/D/P/D)" "STATUS"
    echo "--------------------------------------------------------------------------------"
    local squad_defs=(
        "Jotaro:Star Platinum:Mastermind:A/A/C/A/A/A:commander"
        "Bob:Crazy Diamond:Architect:A/A/D/B/A/C:builder"
        "Torin:Silver Chariot:Miner:B/A/C/B/A/C:miner"
        "Arthur:The World:Sentinel:A/B/B/A/B/B:guard"
        "Willow:Gold Experience:Harvester:C/A/A/C/A/B:farmer"
    )
    for entry in "${squad_defs[@]}"; do
        IFS=":" read -r bname bstand brole bstats bpers <<< "${entry}"
        local pstatus="OFFLINE"
        local pid_file="${PIDS_DIR}/${bname}.pid"
        if bot_is_running "${bname}"; then
            local pid
            pid=$(cat "${pid_file}" 2>/dev/null || echo "?")
            local mem
            mem=$(ps -o rss= -p "${pid}" 2>/dev/null | awk '{printf "%.0fMB", $1/1024}' || echo "N/A")
            pstatus="RUNNING (PID:${pid}, ${mem})"
        fi
        printf "%-8s %-16s %-11s %-16s %-20s\n" "${bname}" "${bstand}" "${brole}" "${bstats}" "${pstatus}"
    done
    echo "================================================================================"
}

squad_repl() {
    local repl_bin="${BOT_SCRIPTS_DIR}/squad_repl.py"
    if [[ ! -f "${repl_bin}" ]]; then
        repl_bin="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)/squad_repl.py"
    fi
    python3 -B "${repl_bin}"
}

cmd_squad() {
    local target_bot="Jotaro"
    if [[ $# -ge 2 ]]; then
        if [[ -f "${PIDS_DIR}/$1.pid" || "$1" =~ ^(Jotaro|Bob|Torin|Arthur|Willow|all)$ ]]; then
            target_bot="$1"
            shift
        fi
    fi
    local cmd_text="$*"
    if [[ -z "${cmd_text}" ]]; then
        echo "Error: Command required, e.g. mc-bot squad cmd 'Build a defensive base and gather stone'" >&2
        return 1
    fi
    if [[ "${target_bot}" == "all" ]]; then
        for b in Jotaro Bob Torin Arthur Willow; do
            if [[ -d "/dev/shm/mc-bot" ]]; then
                printf '%s\n' "${cmd_text}" >> "/dev/shm/mc-bot/${b}.cmd"
            else
                printf '%s\n' "${cmd_text}" >> "/dev/shm/mc-bot-${b}.cmd"
            fi
        done
        echo "[+] Dispatched broadcast to all squad agents: ${cmd_text}"
    else
        if [[ -d "/dev/shm/mc-bot" ]]; then
            printf '%s\n' "${cmd_text}" >> "/dev/shm/mc-bot/${target_bot}.cmd"
        else
            printf '%s\n' "${cmd_text}" >> "/dev/shm/mc-bot-${target_bot}.cmd"
        fi
        echo "[+] Dispatched order to ${target_bot}: ${cmd_text}"
    fi
}

watchdog_squad() {
    # Request fresh watchdog snapshot from all active squad members
    for b in Jotaro Bob Torin Arthur Willow; do
        if [[ -d "/dev/shm/mc-bot" ]]; then
            printf '%s\n' "!watchdog" >> "/dev/shm/mc-bot/${b}.cmd" 2>/dev/null || true
        else
            printf '%s\n' "!watchdog" >> "/dev/shm/mc-bot-${b}.cmd" 2>/dev/null || true
        fi
    done
    sleep 0.6

    echo "================================================================================"
    echo "                     ✦ MOTION WATCHDOG SQUAD MONITOR ✦"
    echo "================================================================================"
    printf "%-10s %-14s %-8s %-12s %-30s\n" "AGENT" "WATCHDOG" "STILL" "MODE" "TASK / REASON"
    echo "--------------------------------------------------------------------------------"
    local found_any=0
    for b in Jotaro Bob Torin Arthur Willow; do
        local alert_file="/dev/shm/mc-bot/${b}.alert"
        [[ ! -f "${alert_file}" ]] && alert_file="/dev/shm/mc-bot-${b}.alert"
        if [[ -f "${alert_file}" ]]; then
            local alert_json
            alert_json=$(cat "${alert_file}" 2>/dev/null || true)
            if [[ -n "${alert_json}" ]]; then
                local alerting still mode task
                alerting=$(printf '%s' "${alert_json}" | grep -o '"isAlerting": *[^,]*' | cut -d: -f2 | tr -d ' "')
                still=$(printf '%s' "${alert_json}" | grep -o '"stationaryDurationSec": *[^,]*' | cut -d: -f2 | tr -d ' "')
                mode=$(printf '%s' "${alert_json}" | grep -o '"mode": *"[^"]*"' | cut -d: -f2 | tr -d ' "')
                task=$(printf '%s' "${alert_json}" | grep -o '"activeTask": *"[^"]*"' | cut -d: -f2 | tr -d ' "' || echo "none")
                local status_str="✓ OK"
                [[ "${alerting}" == "true" ]] && status_str="⚠️ ALERTING"
                local still_fmt="${still:-0}s"
                printf "%-10s %-14s %-8s %-12s %-30s\n" "${b}" "${status_str}" "${still_fmt}" "${mode:-IDLE}" "${task:-none}"
                found_any=1
                continue
            fi
        fi
        if [[ -f "${PIDS_DIR}/${b}.pid" ]]; then
            printf "%-10s %-14s %-8s %-12s %-30s\n" "${b}" "✓ INITIALIZING" "0s" "IDLE" "starting up"
            found_any=1
        fi
    done
    if [[ "${found_any}" -eq 0 ]]; then
        echo "No squad bots currently active or monitored."
    fi
    echo "================================================================================"
}

dispatch_squad_command() {
    local is_remote="${1:-0}"
    shift || true
    local squad_action="${1:-status}"
    shift || true

    if [[ "${is_remote}" -eq 1 ]]; then
        case "${squad_action}" in
            start) remote_start_squad "$@" ;;
            stop) remote_stop_squad "$@" ;;
            status) remote_status_squad "$@" ;;
            cmd) remote_cmd_squad "$@" ;;
            watchdog|alert|alerts|idle) remote_watchdog_squad "$@" ;;
            repl) remote_squad_repl ;;
            log|logs) remote_log_squad "$@" ;;
            *)
                echo "Usage: mc-bot --remote squad [start|stop|status|cmd|watchdog|repl|log] [args...]" >&2
                return 1
                ;;
        esac
    else
        case "${squad_action}" in
            start) start_squad "$@" ;;
            stop) stop_squad "$@" ;;
            status) status_squad "$@" ;;
            cmd) cmd_squad "$@" ;;
            watchdog|alert|alerts|idle) watchdog_squad "$@" ;;
            repl) squad_repl ;;
            *)
                echo "Usage: mc-bot squad [start|stop|status|cmd|watchdog|repl] [args...]" >&2
                return 1
                ;;
        esac
    fi
}
