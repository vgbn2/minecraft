#!/usr/bin/env bash
# remote_orchestrate.sh: Proxmox CT 116 remote bot & squad lifecycle supervision via SSH.
# ponytail: SSH/tar transport with dual-hop Tailscale bridge fallback; zero extra dependencies.

remote_ssh() {
    local auth_sock="${SSH_AUTH_SOCK:-}"
    if [[ -z "${auth_sock}" || ! -S "${auth_sock}" ]] || ! ssh-add -l >/dev/null 2>&1; then
        if [[ -S "/run/user/$(id -u)/gcr/ssh" ]]; then
            auth_sock="/run/user/$(id -u)/gcr/ssh"
        fi
    fi
    if SSH_AUTH_SOCK="${auth_sock}" ssh -o BatchMode=yes -o ConnectTimeout=1 "${REMOTE_USER}@${REMOTE_HOST}" true >/dev/null 2>&1; then
        SSH_AUTH_SOCK="${auth_sock}" ssh -o BatchMode=yes -o ConnectTimeout=5 "${REMOTE_USER}@${REMOTE_HOST}" "$@"
    else
        SSH_AUTH_SOCK="${auth_sock}" ssh -o BatchMode=yes -o ConnectTimeout=5 root@100.120.66.1 "ssh -o BatchMode=yes ${REMOTE_USER}@${REMOTE_HOST} \"\$*\""
    fi
}

remote_is_reachable() {
    remote_ssh "true" >/dev/null 2>&1
}

remote_sync_bot() {
    if ! remote_is_reachable; then
        echo "Error: Cannot reach Proxmox CT 116 at ${REMOTE_HOST} over SSH." >&2
        return 1
    fi
    echo "[*] Synchronizing mc-bot modules to Proxmox CT 116 (${REMOTE_HOST}:${REMOTE_DIR})..."
    local auth_sock="${SSH_AUTH_SOCK:-}"
    [[ -S "/run/user/$(id -u)/gcr/ssh" ]] && auth_sock="/run/user/$(id -u)/gcr/ssh"
    if SSH_AUTH_SOCK="${auth_sock}" ssh -o BatchMode=yes -o ConnectTimeout=1 "${REMOTE_USER}@${REMOTE_HOST}" true >/dev/null 2>&1; then
        SSH_AUTH_SOCK="${auth_sock}" scp -rq \
            "${SOURCE_BOT_DIR}/src" \
            "${SOURCE_BOT_DIR}/config" \
            "${SOURCE_BOT_DIR}/tests" \
            "${SOURCE_BOT_DIR}/lib" \
            "${SOURCE_BOT_DIR}/scripts" \
            "${SOURCE_BOT_DIR}"/*.mjs \
            "${SOURCE_BOT_DIR}/mc-bot.sh" \
            "${SOURCE_BOT_DIR}/package.json" \
            "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/" 2>/dev/null || true
    else
        (cd "${SOURCE_BOT_DIR}" && tar -czf - bin src config tests lib scripts mc_path_core/src mc_path_core/Cargo.toml *.mjs mc-bot.sh package.json 2>/dev/null) | \
            ssh -o BatchMode=yes root@100.120.66.1 "ssh -o BatchMode=yes root@${REMOTE_HOST} 'tar -xzf - -C ${REMOTE_DIR}/'"
    fi
    echo "[+] Synced modular bot packages to CT 116."
}

remote_start_bot() {
    local target_endpoint="${1:-}"
    local bot_name="${2:-Companion}"
    local personality="${3:-companion}"
    local explicit_host="${4:-}"

    if ! remote_is_reachable; then
        echo "Error: Cannot reach Proxmox CT 116 at ${REMOTE_HOST} over SSH." >&2
        return 1
    fi

    # Automatically synchronize code modules to CT 116 before launch
    remote_sync_bot

    # Check if remote bot is already running
    local check_status
    check_status=$(remote_ssh "
        if [[ -f ${REMOTE_PID} ]]; then
            pid=\$(cat ${REMOTE_PID})
            if kill -0 \$pid 2>/dev/null; then
                echo \"RUNNING:\$pid\"
                exit 0
            fi
        fi
        echo \"STOPPED\"
    ")

    if [[ "${check_status}" == RUNNING:* ]]; then
        local existing_pid="${check_status#RUNNING:}"
        echo "Remote bot on CT 116 is already running (PID: ${existing_pid})."
        echo "Use 'mc-bot --remote stop' first."
        return 0
    fi

    local target_host=""
    local target_port=""

    if [[ -n "${explicit_host}" ]]; then
        target_host="${explicit_host}"
        target_port="${target_endpoint:-${MC_DEFAULT_PORT:-${MC_PORT:-25565}}}"
    elif [[ -n "${target_endpoint}" && "${target_endpoint}" =~ : ]]; then
        target_host="${target_endpoint%%:*}"
        target_port="${target_endpoint##*:}"
    else
        local resolved
        resolved=$(resolve_endpoint "${target_endpoint}" 1)
        target_host="${resolved%%:*}"
        target_port="${resolved##*:}"
    fi

    echo "[*] Launching '${bot_name}' (${personality}) remotely on CT 116 (${REMOTE_HOST})..."
    echo "[*] Target endpoint: ${target_host}:${target_port} | Resource limit: 256MB RAM | nice=10"

    # Launch daemonized in /dev/shm tmpfs with resource constraints
    local remote_pid
    remote_pid=$(remote_ssh "
        mkdir -p /root/.local/share/mc-bot /dev/shm
        [[ -f /opt/mc-bot/config.json && ! -f /root/.local/share/mc-bot/config.json ]] && cp /opt/mc-bot/config.json /root/.local/share/mc-bot/config.json
        cd ${REMOTE_DIR}
        MC_HOST='${target_host}' \
        MC_PORT='${target_port}' \
        MC_BOT_NAME='${bot_name}' \
        MC_BOT_PERSONALITY='${personality}' \
        MC_LOG_FILE='${REMOTE_LOG}' \
        nohup nice -n 10 node --max-old-space-size=512 companion.mjs >> '${REMOTE_LOG}' 2>&1 &
        echo \$! > '${REMOTE_PID}'
        sleep 1
        cat '${REMOTE_PID}'
    ")

    if remote_ssh "kill -0 ${remote_pid} 2>/dev/null"; then
        echo "[+] AI Bot '${bot_name}' (${personality}) started successfully on CT 116 (PID: ${remote_pid})."
        echo "[*] Remote Log: ${REMOTE_LOG} (tmpfs on CT 116)"
        echo "[*] View live output: mc-bot --remote log"
    else
        echo "[-] Failed to start bot on CT 116. Checking recent log output:" >&2
        remote_ssh "tail -n 15 ${REMOTE_LOG} 2>/dev/null || true" >&2
        return 1
    fi
}

remote_status_bot() {
    echo "=== Proxmox CT 116 Remote Companion Bot Status (${REMOTE_HOST}) ==="
    if ! remote_is_reachable; then
        echo "Status: UNREACHABLE (SSH connection failed)"
        return 1
    fi

    remote_ssh "
        if [[ -f ${REMOTE_PID} ]]; then
            pid=\$(cat ${REMOTE_PID})
            if kill -0 \$pid 2>/dev/null; then
                stats=\$(ps -o pid=,ni=,rss=,%cpu=,cmd= -p \$pid 2>/dev/null || true)
                if [[ -n \"\$stats\" ]]; then
                    rss=\$(echo \"\$stats\" | awk '{print \$3}')
                    rss_mb=\"\$((rss / 1024))MB\"
                    cpu=\$(echo \"\$stats\" | awk '{print \$4}')
                    ni=\$(echo \"\$stats\" | awk '{print \$2}')
                    log_size=\"0B\"
                    [[ -f ${REMOTE_LOG} ]] && log_size=\$(du -h ${REMOTE_LOG} | awk '{print \$1}')
                    echo \" • Remote Bot: RUNNING (PID: \$pid, Nice: \$ni, RAM: \${rss_mb}/256MB, CPU: \${cpu}%, Log: ${REMOTE_LOG} [\${log_size}])\"
                    if [[ -f ${REMOTE_LOG} ]]; then
                        echo \"   Recent: \$(tail -n 1 ${REMOTE_LOG} 2>/dev/null || echo '(empty)')\"
                    fi
                    exit 0
                fi
            else
                rm -f ${REMOTE_PID}
            fi
        fi
        echo \"Status: No active bot running on CT 116.\"
    "
}

remote_stop_bot() {
    echo "[*] Stopping remote bot processes on Proxmox CT 116 (${REMOTE_HOST})..."
    if ! remote_is_reachable; then
        echo "Error: Cannot reach CT 116 over SSH." >&2
        return 1
    fi

    remote_ssh "
        stopped=0
        if [[ -f ${REMOTE_PID} ]]; then
            pid=\$(cat ${REMOTE_PID})
            if kill -0 \$pid 2>/dev/null; then
                kill \$pid 2>/dev/null || true
                sleep 0.5
                if kill -0 \$pid 2>/dev/null; then
                    kill -9 \$pid 2>/dev/null || true
                fi
                echo \"[+] Stopped remote bot (PID: \$pid) on CT 116.\"
                stopped=1
            fi
            rm -f ${REMOTE_PID}
        fi
        pids=\$(pgrep -f 'node.*companion\.mjs' 2>/dev/null || true)
        if [[ -n \"\$pids\" ]]; then
            kill \$pids 2>/dev/null || true
            sleep 0.5
            pkill -9 -f 'node.*companion\.mjs' 2>/dev/null || true
            echo \"[+] Cleaned up orphan bot process(es): \$pids\"
            stopped=1
        fi
        if [[ \$stopped -eq 0 ]]; then
            echo \"No active bot processes found on CT 116.\"
        fi
    "
}

remote_log_bot() {
    if ! remote_is_reachable; then
        echo "Error: Cannot reach CT 116 over SSH." >&2
        return 1
    fi
    echo "[*] Streaming live log from CT 116 (${REMOTE_LOG})... (Ctrl+C to exit)"
    remote_ssh "if [[ -f ${REMOTE_LOG} ]]; then tail -n 50 -f ${REMOTE_LOG}; else echo 'No log file found at ${REMOTE_LOG}'; fi"
}

remote_flush_logs() {
    if ! remote_is_reachable; then
        echo "Error: Cannot reach CT 116 over SSH." >&2
        return 1
    fi
    remote_ssh "cat /dev/null > ${REMOTE_LOG} 2>/dev/null && echo '[+] Truncated CT 116 log (${REMOTE_LOG}) to 0 bytes.'"
}

remote_start_squad() {
    local target_endpoint="${1:-}"
    if [[ -z "${target_endpoint}" ]]; then
        target_endpoint=$(resolve_endpoint "" 1)
    fi
    remote_sync_bot
    echo "[*] Launching JoJo Stand Squad remotely on CT 116 (${REMOTE_HOST})..."
    remote_ssh "${REMOTE_DIR}/mc-bot.sh squad start ${target_endpoint}"
}

remote_stop_squad() {
    echo "[*] Recalling JoJo Stand Squad on CT 116 (${REMOTE_HOST})..."
    remote_ssh "${REMOTE_DIR}/mc-bot.sh squad stop"
}

remote_status_squad() {
    remote_ssh "${REMOTE_DIR}/mc-bot.sh squad status"
}

remote_cmd_squad() {
    remote_ssh "${REMOTE_DIR}/mc-bot.sh squad cmd \"$*\""
}

remote_watchdog_squad() {
    remote_ssh "${REMOTE_DIR}/mc-bot.sh squad watchdog"
}

remote_squad_repl() {
    if ! remote_is_reachable; then
        echo "Error: Cannot reach CT 116 over SSH." >&2
        return 1
    fi
    echo "[*] Connecting to remote interactive squad REPL on CT 116..."
    ssh -t root@100.120.66.1 "ssh -t root@${REMOTE_HOST} '${REMOTE_DIR}/mc-bot.sh squad repl'"
}

remote_log_squad() {
    local bname="${1:-Jotaro}"
    remote_ssh "${REMOTE_DIR}/mc-bot.sh log ${bname}"
}

remote_monitor() {
    if ! remote_is_reachable; then
        echo "Error: Cannot reach CT 116 over SSH." >&2
        return 1
    fi
    remote_ssh "
        echo '================================================================================'
        echo '          ✦ PROXMOX CT 116 MINECRAFT & JOJO SQUAD LIVE MONITOR ✦'
        echo '================================================================================'
        echo '--- Host Telemetry ---'
        uptime | sed 's/^ *//'
        free -h | grep -E 'Mem:|Swap:'
        echo ''
        echo '--- Minecraft Server Listeners on CT 116 ---'
        ss -tulpn | grep -Ei 'java|pumpkin|minecraft|bedrock' | awk '{print \" • [\" \$1 \"] Listener: \" \$5 \" (PID: \" \$7 \")\"}' || echo 'No active listeners'
        echo ''
        echo '--- JoJo Squad Status ---'
        ${REMOTE_DIR}/mc-bot.sh squad status
        echo ''
        echo '--- Recent Squad Chat & Activity (Last 10 Events) ---'
        tail -n 2 /dev/shm/mc-bot/*.log 2>/dev/null | grep -E '\[CHAT IN\]|\[CHAT OUT\]|\[AI EXEC\]|\[ORCHESTRATOR\]|\[IPC CMD\]' | tail -n 10 || echo 'No recent chat events.'
        echo '================================================================================'
    "
}
