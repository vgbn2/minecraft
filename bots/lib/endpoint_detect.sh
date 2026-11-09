#!/usr/bin/env bash
# endpoint_detect.sh: Minecraft server list ping, LAN multicast discovery & endpoint resolution.
# ponytail: wraps stdlib Python endpoint_detect.py; zero third-party dependencies.

discover_minecraft_games() {
    local output_mode="${1:-tsv}" # tsv | table | json
    local script_bin="${BOT_SCRIPTS_DIR}/endpoint_detect.py"
    if [[ ! -f "${script_bin}" ]]; then
        script_bin="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)/endpoint_detect.py"
    fi
    python3 -B "${script_bin}" "${output_mode}" "${REMOTE_HOST:-192.168.4.117}"
}

resolve_endpoint() {
    local target_arg="${1:-}"
    local is_remote="${2:-0}"

    # 0. Direct host:port parameter passed explicitly
    if [[ -n "${target_arg}" && "${target_arg}" =~ : ]]; then
        echo "${target_arg}"
        return 0
    fi

    local discovered
    discovered=$(discover_minecraft_games tsv)

    if [[ -z "${discovered}" ]]; then
        if [[ -n "${target_arg}" && "${target_arg}" =~ ^[0-9]+$ ]]; then
            echo "127.0.0.1:${target_arg}"
            return 0
        fi
        local def_port="${MC_DEFAULT_PORT:-${MC_PORT:-25565}}"
        echo "127.0.0.1:${def_port}"
        return 0
    fi

    # 1. Match by exact port number
    if [[ -n "${target_arg}" && "${target_arg}" =~ ^[0-9]+$ ]]; then
        while IFS=$'\t' read -r idx host port src ver proto onl max world user motd players; do
            if [[ "${port}" == "${target_arg}" ]]; then
                local final_host="${host}"
                if [[ "${is_remote}" -eq 1 && "${host}" == "127.0.0.1" ]]; then
                    final_host="${LOCAL_IP}"
                fi
                echo "${final_host}:${port}"
                return 0
            fi
        done <<< "${discovered}"
        local rhost="127.0.0.1"
        [[ "${is_remote}" -eq 1 ]] && rhost="${LOCAL_IP}"
        echo "${rhost}:${target_arg}"
        return 0
    fi

    # 2. Match by world name or MOTD substring
    if [[ -n "${target_arg}" ]]; then
        local lower_target
        lower_target=$(echo "${target_arg}" | tr '[:upper:]' '[:lower:]')
        while IFS=$'\t' read -r idx host port src ver proto onl max world user motd players; do
            local lower_world
            lower_world=$(echo "${world}" | tr '[:upper:]' '[:lower:]')
            local lower_motd
            lower_motd=$(echo "${motd}" | tr '[:upper:]' '[:lower:]')
            if [[ "${lower_world}" == *"${lower_target}"* || "${lower_motd}" == *"${lower_target}"* ]]; then
                local final_host="${host}"
                if [[ "${is_remote}" -eq 1 && "${host}" == "127.0.0.1" ]]; then
                    final_host="${LOCAL_IP}"
                fi
                echo "${final_host}:${port}"
                return 0
            fi
        done <<< "${discovered}"
        echo "[!] No discovered game matched '${target_arg}'. Defaulting to first active game." >&2
    fi

    # 3. Multiple games active: Prompt if interactive terminal, else pick first
    local game_count
    game_count=$(printf '%s\n' "${discovered}" | grep -c . || echo 0)

    local selected_line
    if [[ "${game_count}" -gt 1 && -t 0 ]]; then
        echo "" >&2
        echo "=== Multiple Minecraft Games Discovered ===" >&2
        discover_minecraft_games table >&2
        echo "" >&2
        read -r -p "Select Minecraft game [1-${game_count}] (default 1): " choice </dev/tty || choice=""
        if [[ -z "${choice}" || ! "${choice}" =~ ^[0-9]+$ || "${choice}" -lt 1 || "${choice}" -gt "${game_count}" ]]; then
            choice=1
        fi
        selected_line=$(printf '%s\n' "${discovered}" | sed -n "${choice}p")
    else
        selected_line=$(printf '%s\n' "${discovered}" | head -n 1)
    fi

    local s_host s_port
    s_host=$(printf '%s' "${selected_line}" | cut -f2)
    s_port=$(printf '%s' "${selected_line}" | cut -f3)

    if [[ "${is_remote}" -eq 1 && "${s_host}" == "127.0.0.1" ]]; then
        s_host="${LOCAL_IP}"
    fi

    echo "${s_host}:${s_port}"
}

dispatch_endpoint_detect() {
    local pmode="table"
    if [[ "${1:-}" == "--json" || "${1:-}" == "-j" ]]; then
        pmode="json"
    elif [[ "${1:-}" == "--tsv" || "${1:-}" == "-t" ]]; then
        pmode="tsv"
    fi
    discover_minecraft_games "${pmode}"
}
