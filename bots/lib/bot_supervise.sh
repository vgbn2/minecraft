#!/usr/bin/env bash
# bot_supervise.sh: Local companion bot process supervision, PID tracking, and log management.
# ponytail: local process tracking via POSIX PID files and /dev/shm logs; zero overhead.

bot_is_running() {
    local target_name="${1:-}"
    if [[ -n "${target_name}" ]]; then
        local pid_file="${PIDS_DIR}/${target_name}.pid"
        if [[ -f "${pid_file}" ]]; then
            local pid
            pid=$(cat "${pid_file}")
            if kill -0 "${pid}" 2>/dev/null; then
                return 0
            fi
        fi
        return 1
    fi
    for pid_file in "${PIDS_DIR}"/*.pid; do
        [[ -f "${pid_file}" ]] || continue
        local pid
        pid=$(cat "${pid_file}")
        if kill -0 "${pid}" 2>/dev/null; then
            return 0
        fi
    done
    if [[ -f "${DATA_DIR}/bot.pid" ]]; then
        local pid
        pid=$(cat "${DATA_DIR}/bot.pid")
        if kill -0 "${pid}" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

start_bot() {
    local target_arg="${1:-}"
    local bot_name="${2:-Companion}"
    local personality="${3:-companion}"
    local explicit_host="${4:-}"

    if bot_is_running "${bot_name}"; then
        local pid_file="${PIDS_DIR}/${bot_name}.pid"
        local pid="unknown"
        [[ -f "${pid_file}" ]] && pid=$(cat "${pid_file}")
        echo "Bot '${bot_name}' is already running locally (PID: ${pid}). Use 'mc-bot stop ${bot_name}' first."
        return 0
    fi

    ensure_dependencies

    local target_host=""
    local target_port=""

    if [[ -n "${explicit_host}" ]]; then
        target_host="${explicit_host}"
        target_port="${target_arg:-${MC_DEFAULT_PORT:-${MC_PORT:-25565}}}"
    elif [[ -n "${target_arg}" && "${target_arg}" =~ : ]]; then
        target_host="${target_arg%%:*}"
        target_port="${target_arg##*:}"
    else
        local resolved
        resolved=$(resolve_endpoint "${target_arg}" 0)
        target_host="${resolved%%:*}"
        target_port="${resolved##*:}"
    fi

    local pid_file="${PIDS_DIR}/${bot_name}.pid"
    local log_file="${LOGS_DIR}/${bot_name}.log"

    echo "[*] Launching '${bot_name}' (${personality}) connecting to ${target_host}:${target_port}..."
    local api_base
    api_base=$(grep -o '"api_base": *"[^"]*"' "${CONFIG_FILE}" 2>/dev/null | head -n1 | cut -d'"' -f4 || echo "")
    local api_key
    api_key=$(grep -o '"api_key": *"[^"]*"' "${CONFIG_FILE}" 2>/dev/null | head -n1 | cut -d'"' -f4 || echo "")

    (
        cd "${DATA_DIR}"
        MC_HOST="${target_host}" \
        MC_PORT="${target_port}" \
        MC_BOT_NAME="${bot_name}" \
        MC_BOT_PERSONALITY="${personality}" \
        MC_LOG_FILE="${log_file}" \
        MC_API_BASE="${api_base}" \
        MC_API_KEY="${api_key}" \
        nice -n 10 node --max-old-space-size=512 companion.mjs >> "${log_file}" 2>&1 &
        echo $! > "${pid_file}"
    )

    sleep 1
    if bot_is_running "${bot_name}"; then
        local pid
        pid=$(cat "${pid_file}")
        echo "[+] AI Bot '${bot_name}' (${personality}) started successfully in background (PID: ${pid})."
        echo "[*] Target: ${target_host}:${target_port} | Personality: ${personality}"
        echo "[*] Swap Log: ${log_file} (1GB auto-flush limit)"
        echo "[*] Low-resource mode: max 512MB RAM, view-distance=5, nice=10"
        echo "[*] View live output: mc-bot log ${bot_name}"
    else
        echo "[-] Failed to start bot '${bot_name}'. Check log for details:" >&2
        tail -n 10 "${log_file}" >&2
        return 1
    fi
}

stop_bot() {
    local target_name="${1:-}"
    if [[ -z "${target_name}" || "${target_name}" == "all" ]]; then
        local stopped=0
        for pid_file in "${PIDS_DIR}"/*.pid; do
            [[ -f "${pid_file}" ]] || continue
            local bname
            bname="$(basename "${pid_file}" .pid)"
            local pid
            pid=$(cat "${pid_file}")
            if kill -0 "${pid}" 2>/dev/null; then
                echo "[*] Stopping bot '${bname}' (PID: ${pid})..."
                kill "${pid}" 2>/dev/null || true
                sleep 0.5
                if kill -0 "${pid}" 2>/dev/null; then
                    kill -9 "${pid}" 2>/dev/null || true
                fi
                echo "[+] Bot '${bname}' stopped."
                stopped=$((stopped + 1))
            fi
            rm -f "${pid_file}"
        done
        if [[ -f "${DATA_DIR}/bot.pid" ]]; then
            local lpid
            lpid=$(cat "${DATA_DIR}/bot.pid")
            kill "${lpid}" 2>/dev/null || true
            rm -f "${DATA_DIR}/bot.pid"
            stopped=$((stopped + 1))
        fi
        if [[ "${stopped}" -eq 0 ]]; then
            echo "No active local bots found."
        fi
    else
        local pid_file="${PIDS_DIR}/${target_name}.pid"
        if [[ -f "${pid_file}" ]]; then
            local pid
            pid=$(cat "${pid_file}")
            if kill -0 "${pid}" 2>/dev/null; then
                echo "[*] Stopping bot '${target_name}' (PID: ${pid})..."
                kill "${pid}" 2>/dev/null || true
                sleep 0.5
                if kill -0 "${pid}" 2>/dev/null; then
                    kill -9 "${pid}" 2>/dev/null || true
                fi
                echo "[+] Bot '${target_name}' stopped."
            else
                echo "[*] Bot process ${pid} already exited."
            fi
            rm -f "${pid_file}"
        else
            echo "Bot '${target_name}' is not running (no PID file found)."
        fi
    fi
}

status_bot() {
    echo "=== Local Minecraft Companion Bots (steamlinux) ==="
    local active_count=0
    for pid_file in "${PIDS_DIR}"/*.pid; do
        [[ -f "${pid_file}" ]] || continue
        local bname
        bname="$(basename "${pid_file}" .pid)"
        local pid
        pid=$(cat "${pid_file}")
        if kill -0 "${pid}" 2>/dev/null; then
            active_count=$((active_count + 1))
            local rss
            rss=$(ps -o rss= -p "${pid}" 2>/dev/null | tr -d ' ' || echo "N/A")
            local rss_mb="N/A"
            if [[ "${rss}" =~ ^[0-9]+$ ]]; then
                rss_mb="$((rss / 1024))MB"
            fi
            local log_path="${LOGS_DIR}/${bname}.log"
            local log_size="0B"
            if [[ -f "${log_path}" ]]; then
                log_size=$(du -h "${log_path}" 2>/dev/null | awk '{print $1}')
            fi
            local token_path="${LOGS_DIR}/${bname}.tokens"
            local token_info=""
            if [[ -f "${token_path}" ]]; then
                token_info=$(python3 -B -c "import json; d=json.load(open('${token_path}')); print(f\"{d.get('total',0)} tokens (in: {d.get('prompt',0)}, out: {d.get('completion',0)}, calls: {d.get('calls',0)}, last: {d.get('lastLatencyMs',0)}ms)\")" 2>/dev/null || true)
            fi
            echo " • Bot '${bname}': RUNNING (PID: ${pid}, RAM: ${rss_mb}, Log: ${log_path} [${log_size}])"
            if [[ -n "${token_info}" ]]; then
                echo "   AI Tokens: ${token_info}"
            fi
            if [[ -f "${log_path}" ]]; then
                echo "   Recent: $(tail -n 1 "${log_path}" 2>/dev/null || echo "(empty)")"
            fi
        else
            rm -f "${pid_file}"
        fi
    done
    if [[ "${active_count}" -eq 0 ]]; then
        echo "Status: No active local bots running."
    fi

    echo ""
    remote_status_bot || true

    echo ""
    echo "=== Discovered Minecraft Endpoints & LAN Games ==="
    discover_minecraft_games table
}

flush_logs() {
    local target_name="${1:-all}"
    if [[ "${target_name}" == "all" ]]; then
        local count=0
        if [[ -d "${LOGS_DIR}" ]]; then
            for log_file in "${LOGS_DIR}"/*.log; do
                [[ -f "${log_file}" ]] || continue
                cat /dev/null > "${log_file}"
                echo "[+] Flushed log: ${log_file}"
                count=$((count + 1))
            done
        fi
        echo "[+] Total ${count} /dev/shm bot log(s) flushed to 0 bytes."
    else
        local log_file="${LOGS_DIR}/${target_name}.log"
        if [[ -f "${log_file}" ]]; then
            cat /dev/null > "${log_file}"
            echo "[+] Flushed log for '${target_name}' (${log_file})."
        else
            echo "No log file found for '${target_name}' at ${log_file}"
        fi
    fi
}

log_bot() {
    local target_name="${1:-}"
    local log_file=""
    if [[ -n "${target_name}" ]]; then
        log_file="${LOGS_DIR}/${target_name}.log"
    else
        for pid_file in "${PIDS_DIR}"/*.pid; do
            [[ -f "${pid_file}" ]] || continue
            local bname
            bname="$(basename "${pid_file}" .pid)"
            if [[ -f "${LOGS_DIR}/${bname}.log" ]]; then
                log_file="${LOGS_DIR}/${bname}.log"
                break
            fi
        done
        if [[ -z "${log_file}" ]]; then
            log_file="${LOGS_DIR}/Companion.log"
        fi
    fi

    if [[ -f "${log_file}" ]]; then
        echo "[*] Tailing log: ${log_file}"
        tail -f "${log_file}"
    else
        echo "No log file found at ${log_file}"
    fi
}

send_bot_cmd() {
    local is_remote="$1"
    shift
    local target_bot=""
    if [[ $# -ge 2 ]]; then
        if [[ -f "${PIDS_DIR}/$1.pid" || "$1" =~ ^(Jotaro|Bob|Torin|Arthur|Willow|all)$ || ( ! "$1" =~ ^[!/] && "$1" =~ ^[A-Za-z0-9_]+$ ) ]]; then
            target_bot="$1"
            shift
        fi
    fi
    local command_string="$*"
    if [[ -z "${command_string}" ]]; then
        echo "Error: Command text required, e.g. mc-bot cmd '!status' or mc-bot cmd Bob '!build'" >&2
        return 1
    fi
    if [[ "${is_remote}" -eq 1 ]]; then
        local safe_bot="${target_bot:-all}"
        if [[ ! "${safe_bot}" =~ ^[A-Za-z0-9_-]+$ ]]; then
            echo "Error: Invalid target bot '${safe_bot}'" >&2
            return 1
        fi
        local escaped_cmd
        printf -v escaped_cmd '%q' "${command_string}"
        remote_ssh "${REMOTE_DIR}/mc-bot.sh cmd ${safe_bot} ${escaped_cmd}"
        echo "[+] Dispatched command to remote bot on CT 116: ${command_string}"
    else
        if [[ -z "${target_bot}" || "${target_bot}" == "all" ]]; then
            for b in Jotaro Bob Torin Arthur Willow; do
                if [[ -d "/dev/shm/mc-bot" ]]; then
                    printf '%s\n' "${command_string}" >> "/dev/shm/mc-bot/${b}.cmd"
                else
                    printf '%s\n' "${command_string}" >> "/dev/shm/mc-bot-${b}.cmd"
                fi
            done
            printf '%s\n' "${command_string}" >> "/dev/shm/mc-bot.cmd"
            echo "[+] Dispatched broadcast command to local bots: ${command_string}"
        else
            if [[ -d "/dev/shm/mc-bot" ]]; then
                printf '%s\n' "${command_string}" >> "/dev/shm/mc-bot/${target_bot}.cmd"
            else
                printf '%s\n' "${command_string}" >> "/dev/shm/mc-bot-${target_bot}.cmd"
            fi
            echo "[+] Dispatched command to local bot '${target_bot}': ${command_string}"
        fi
    fi
}
