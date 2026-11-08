#!/usr/bin/env bash
# mc-bot: Lifecycle manager, resource governor, and AI config for Minecraft companion bots.
# ponytail: connects via TCP socket as offline player; zero server mods required.

set -euo pipefail

DATA_DIR="${HOME}/.local/share/mc-bot"
CONFIG_FILE="${DATA_DIR}/config.json"
PIDS_DIR="${DATA_DIR}/pids"
LOGS_DIR="/dev/shm/mc-bot"
SCRIPT_ENTRY="$(readlink -f -- "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "${SCRIPT_ENTRY}")" && pwd)"
if [[ -d "${SCRIPT_DIR}/mc-bot" ]]; then
    SOURCE_BOT_DIR="${SCRIPT_DIR}/mc-bot"
else
    SOURCE_BOT_DIR="${SCRIPT_DIR}"
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

    # ponytail: stdlib python patch for 26.3 protocol compatibility; zero extra packages
    python3 -B - "${node_mods}" << 'PYEOF' >/dev/null 2>&1 || true
import json, os, sys
base = sys.argv[1]

# 1. prismarine-chunk
pchunk = os.path.join(base, 'prismarine-chunk/src/index.js')
if os.path.exists(pchunk):
    with open(pchunk, 'r') as f: c = f.read()
    if "'26.3'" not in c and "26.3:" not in c:
        c = c.replace("26.1: require('./pc/1.18/chunk')", "26.1: require('./pc/1.18/chunk'),\n    '26.3': require('./pc/1.18/chunk')")
        with open(pchunk, 'w') as f: f.write(c)

# 2. mineflayer testedVersions
mf = os.path.join(base, 'mineflayer/lib/version.js')
if os.path.exists(mf):
    with open(mf, 'r') as f: v = f.read()
    if "'26.3'" not in v:
        v = v.replace("'26.1']", "'26.1', '26.3']")
        with open(mf, 'w') as f: f.write(v)

# 3. prismarine-physics features
pphys = os.path.join(base, 'prismarine-physics/lib/features.json')
if os.path.exists(pphys):
    try:
        with open(pphys, 'r') as f: data = json.load(f)
        for feat in data:
            if '26.1' in feat.get('versions', []) and '26.3' not in feat['versions']:
                feat['versions'].append('26.3')
        with open(pphys, 'w') as f: json.dump(data, f, indent=2)
    except Exception:
        pass

# 4. protodef serializer resilient frame handling (drop unhandled packet deserialization errors & cap buffer dumps)
pser = os.path.join(base, 'protodef/src/serializer.js')
if os.path.exists(pser):
    with open(pser, 'r') as f: s = f.read()
    if 'return cb(e)' in s and '[protodef] Dropped' not in s:
        s = s.replace('return cb(e)', '// ponytail: protect TCP stream framing\n        if (!this.noErrorLogging) console.warn("[protodef] Dropped unparseable packet:", e.message)\n        return cb()')
    if "chunk.toString('hex')" in s and "slice(0, 64)" not in s:
        s = s.replace("chunk.toString('hex')", "chunk.toString('hex').slice(0, 64) + '...'")
    if "console.log('Chunk size is '" in s and "process.env.DEBUG" not in s:
        s = s.replace("console.log('Chunk size is ' + chunk.length + ' but only ' + packet.metadata.size + ' was read ; partial packet : ' +\n          JSON.stringify(packet.data) + '; buffer :' + chunk.toString('hex').slice(0, 64) + '...')",
                      "// ponytail: suppress cosmetic packet size mismatch dumps\n        if (process.env.DEBUG) console.log('[protodef] Packet size mismatch:', packet.data?.name || 'packet')")
    with open(pser, 'w') as f: f.write(s)
PYEOF
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
    cp "${SOURCE_BOT_DIR}"/*.mjs "${DATA_DIR}/"
    cp "${SOURCE_BOT_DIR}/package.json" "${DATA_DIR}/package.json"

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

# ponytail: Server List Ping (SLP) & UDP 4445 multicast scanner via Python stdlib; zero pip bloat
discover_minecraft_games() {
    local output_mode="${1:-tsv}" # tsv | table | json
    python3 -B - "${output_mode}" "${REMOTE_HOST}" << 'PYEOF'
import socket, struct, json, re, time, subprocess, sys

def slp_ping(host, port, timeout=0.8):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        s.connect((host, port))
        def pack_varint(val):
            out = bytearray()
            while True:
                b = val & 0x7F
                val >>= 7
                if val: out.append(b | 0x80)
                else: out.append(b); break
            return bytes(out)
        def read_varint(sock):
            val, shift = 0, 0
            while True:
                b = sock.recv(1)
                if not b: return None
                val |= (b[0] & 0x7F) << shift
                if not (b[0] & 0x80): break
                shift += 7
            return val
        h_bytes = host.encode("utf-8")
        hs = pack_varint(0) + pack_varint(765) + pack_varint(len(h_bytes)) + h_bytes + port.to_bytes(2, "big") + pack_varint(1)
        s.sendall(pack_varint(len(hs)) + hs)
        req = pack_varint(0)
        s.sendall(pack_varint(len(req)) + req)
        read_varint(s); read_varint(s); slen = read_varint(s)
        data = b""
        while len(data) < slen:
            chunk = s.recv(min(4096, slen - len(data)))
            if not chunk: break
            data += chunk
        s.close()
        res = json.loads(data.decode("utf-8", "replace"))
        desc = res.get("description", "")
        if isinstance(desc, dict):
            motd = desc.get("text", "")
            if "extra" in desc and isinstance(desc["extra"], list):
                motd += "".join(x.get("text", "") if isinstance(x, dict) else str(x) for x in desc["extra"])
        else:
            motd = str(desc)
        ver = res.get("version", {}).get("name", "unknown")
        proto = res.get("version", {}).get("protocol", 0)
        players = res.get("players", {})
        online = players.get("online", 0)
        max_p = players.get("max", 0)
        sample = [p.get("name", "") for p in players.get("sample", []) if isinstance(p, dict)]
        return {"motd": motd.strip(), "version": ver, "protocol": proto, "online": online, "max": max_p, "sample": sample}
    except Exception:
        return None

def discover_all(remote_ip, listen_sec=1.0):
    candidates = []
    # 1. UDP Multicast (Minecraft LAN discovery on 224.0.2.60:4445)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("", 4445))
        mreq = struct.pack("4sl", socket.inet_aton("224.0.2.60"), socket.INADDR_ANY)
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
        sock.settimeout(listen_sec)
        t_end = time.time() + listen_sec
        while time.time() < t_end:
            try:
                data, addr = sock.recvfrom(1024)
                text = data.decode("utf-8", "replace")
                m_motd = re.search(r"\[MOTD\](.*?)\[/MOTD\]", text)
                m_port = re.search(r"\[AD\](\d+)\[/AD\]", text)
                if m_port:
                    p = int(m_port.group(1))
                    m = m_motd.group(1) if m_motd else ""
                    candidates.append((addr[0], p, "LAN Broadcast", m))
            except socket.timeout:
                break
    except Exception:
        pass
    finally:
        sock.close()

    # 2. Local TCP listeners via ss (Singleplayer LAN / local server)
    try:
        out = subprocess.check_output(["ss", "-tlpn"], stderr=subprocess.DEVNULL).decode("utf-8")
        for line in out.splitlines():
            if "java" in line or "pumpkin" in line:
                parts = line.split()
                if len(parts) >= 4:
                    addr_part = parts[3]
                    p_str = addr_part.rsplit(":", 1)[-1]
                    if p_str.isdigit():
                        candidates.append(("127.0.0.1", int(p_str), "Local Listener", ""))
    except Exception:
        pass

    # 3. Known cluster nodes on Proxmox CT 116
    candidates.append((remote_ip, 25565, "CT 116 Paper", ""))
    candidates.append((remote_ip, 25566, "CT 116 Pumpkin", ""))

    seen_ports = set()
    results = []
    for host, port, src, extra_motd in candidates:
        is_local_host = host in ("0.0.0.0", "*", "localhost") or host.startswith("127.")
        probe_host = "127.0.0.1" if is_local_host else host
        dedup_key = ("LOCAL" if probe_host == "127.0.0.1" else probe_host, port)
        if dedup_key in seen_ports:
            continue
        seen_ports.add(dedup_key)

        info = slp_ping(probe_host, port)
        if info:
            motd = info["motd"] or extra_motd
            world = motd
            user = ""
            if " - " in motd:
                world, user = motd.split(" - ", 1)
            results.append({
                "host": probe_host,
                "port": port,
                "source": src,
                "version": info["version"],
                "protocol": info["protocol"],
                "online": info["online"],
                "max": info["max"],
                "world": world.strip(),
                "user": user.strip(),
                "motd": motd.strip(),
                "players": ",".join(info["sample"])
            })

    def sort_key(r):
        if "LAN" in r["source"] or r["host"] == "127.0.0.1":
            return (0, r["port"])
        return (1, r["port"])
    results.sort(key=sort_key)
    return results

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "tsv"
    remote_ip = sys.argv[2] if len(sys.argv) > 2 else "192.168.4.117"
    res = discover_all(remote_ip, 1.0)
    if mode == "json":
        print(json.dumps(res, indent=2))
    elif mode == "table":
        if not res:
            print("No active Minecraft servers or LAN games discovered.")
            sys.exit(0)
        print(f"{'#':<3} {'WORLD / MOTD':<28} {'ENDPOINT':<22} {'VERSION':<15} {'PLAYERS':<9} {'SOURCE'}")
        print("-" * 92)
        for i, r in enumerate(res, 1):
            world_disp = r['world']
            if r['user']:
                world_disp = f"{r['world']} ({r['user']})"
            if len(world_disp) > 26:
                world_disp = world_disp[:23] + "..."
            ep = f"{r['host']}:{r['port']}"
            ver = f"{r['version']}"
            p = f"{r['online']}/{r['max']}"
            print(f"[{i}] {world_disp:<28} {ep:<22} {ver:<15} {p:<9} {r['source']}")
    else: # tsv
        for i, r in enumerate(res, 1):
            print(f"{i}\t{r['host']}\t{r['port']}\t{r['source']}\t{r['version']}\t{r['protocol']}\t{r['online']}\t{r['max']}\t{r['world']}\t{r['user']}\t{r['motd']}\t{r['players']}")
PYEOF
}

# Resolve target endpoint from argument or interactive/auto discovery
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
        echo "127.0.0.1:25565"
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
        # If port wasn't in discovered list, return host:port as requested
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

# --- Remote CT 116 Lifecycle Commands ---

remote_ssh() {
    local auth_sock="${SSH_AUTH_SOCK:-}"
    if [[ -z "${auth_sock}" || ! -S "${auth_sock}" ]] || ! ssh-add -l >/dev/null 2>&1; then
        if [[ -S "/run/user/$(id -u)/gcr/ssh" ]]; then
            auth_sock="/run/user/$(id -u)/gcr/ssh"
        fi
    fi
    SSH_AUTH_SOCK="${auth_sock}" ssh -o BatchMode=yes -o ConnectTimeout=3 "${REMOTE_USER}@${REMOTE_HOST}" "$@"
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
    SSH_AUTH_SOCK="${auth_sock}" scp -rq \
        "${SOURCE_BOT_DIR}/src" \
        "${SOURCE_BOT_DIR}/config" \
        "${SOURCE_BOT_DIR}/tests" \
        "${SOURCE_BOT_DIR}"/*.mjs \
        "${SOURCE_BOT_DIR}/mc-bot.sh" \
        "${SOURCE_BOT_DIR}/package.json" \
        "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"
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
        target_port="${target_endpoint:-25565}"
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
        nohup nice -n 10 node --max-old-space-size=256 companion.mjs >> '${REMOTE_LOG}' 2>&1 &
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
        # Clean up any orphaned companion.mjs processes
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
    local target_endpoint="${1:-127.0.0.1:25566}"
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

remote_log_squad() {
    local bname="${1:-Jotaro}"
    remote_ssh "${REMOTE_DIR}/mc-bot.sh log ${bname}"
}

remote_monitor() {
    if ! remote_is_reachable; then
        echo "Error: Cannot reach Proxmox CT 116 at ${REMOTE_HOST} over SSH." >&2
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
        ss -tulpn | grep -E ':25565|:25566' | awk '{print \" • [\" \$1 \"] Listener: \" \$5 \" (PID: \" \$7 \")\"}' || echo 'No active listeners'
        echo ''
        echo '--- JoJo Squad Status ---'
        ${REMOTE_DIR}/mc-bot.sh squad status
        echo ''
        echo '--- Recent Squad Chat & Activity (Last 10 Events) ---'
        tail -n 2 /dev/shm/mc-bot/*.log 2>/dev/null | grep -E '\[CHAT IN\]|\[CHAT OUT\]|\[AI EXEC\]|\[ORCHESTRATOR\]|\[IPC CMD\]' | tail -n 10 || echo 'No recent chat events.'
        echo '================================================================================'
    "
}

# --- Local Host Lifecycle Commands ---

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
        target_port="${target_arg:-25565}"
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
        nice -n 10 node --max-old-space-size=256 companion.mjs >> "${log_file}" 2>&1 &
        echo $! > "${pid_file}"
    )

    sleep 1
    if bot_is_running "${bot_name}"; then
        local pid
        pid=$(cat "${pid_file}")
        echo "[+] AI Bot '${bot_name}' (${personality}) started successfully in background (PID: ${pid})."
        echo "[*] Target: ${target_host}:${target_port} | Personality: ${personality}"
        echo "[*] Swap Log: ${log_file} (1GB auto-flush limit)"
        echo "[*] Low-resource mode: max 256MB RAM, view-distance=5, nice=10"
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

# -----------------------------------------------------------------------------
# JoJo Stand Squad Lifecycle & Orchestration
# -----------------------------------------------------------------------------

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

cmd_squad() {
    local cmd_text="$*"
    if [[ -z "${cmd_text}" ]]; then
        echo "Error: Command required, e.g. mc-bot squad cmd 'Build a defensive base and gather stone'" >&2
        exit 1
    fi
    echo "[*] Transmitting mission to Mastermind 'Jotaro' (Star Platinum)..."
    printf '%s\n' "${cmd_text}" >> "/dev/shm/mc-bot-Jotaro.cmd"
    echo "[+] Order dispatched to Jotaro for squad orchestration: ${cmd_text}"
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
  builder      Master architect (Bob) - Crazy Diamond [A/A/D/B/A/C]: shelter & wall construction
  miner        Dwarven caver (Torin) - Silver Chariot [B/A/C/B/A/C]: underground mining & quarrying
  guard        Knight sentinel (Arthur) - The World [A/B/B/A/B/B]: perimeter defense & mob attack
  farmer       Peaceful gatherer (Willow) - Gold Experience [C/A/A/C/A/B]: crop foraging & scouting
  scout        Field scout (Willow) - Gold Experience [C/A/A/C/A/B]: exploration & supply drops
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

# Parse top-level --remote flag or subcommands
IS_REMOTE=0
ARGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --remote)
            IS_REMOTE=1
            shift
            ;;
        --local)
            IS_REMOTE=0
            shift
            ;;
        remote)
            IS_REMOTE=1
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

# Check if --remote was passed as option after command
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
            ensure_dependencies
            echo "[+] Synced local bot modules to ${DATA_DIR}."
        fi
        ;;
    squad)
        squad_action="${1:-status}"
        shift || true
        if [[ "${IS_REMOTE}" -eq 1 ]]; then
            case "${squad_action}" in
                start)
                    remote_start_squad "$@"
                    ;;
                stop)
                    remote_stop_squad "$@"
                    ;;
                status)
                    remote_status_squad "$@"
                    ;;
                cmd)
                    remote_cmd_squad "$@"
                    ;;
                log|logs)
                    remote_log_squad "$@"
                    ;;
                *)
                    echo "Usage: mc-bot --remote squad [start|stop|status|cmd|log] [args...]" >&2
                    exit 1
                    ;;
            esac
        else
            case "${squad_action}" in
                start)
                    start_squad "$@"
                    ;;
                stop)
                    stop_squad "$@"
                    ;;
                status)
                    status_squad "$@"
                    ;;
                cmd)
                    cmd_squad "$@"
                    ;;
                *)
                    echo "Usage: mc-bot squad [start|stop|status|cmd] [args...]" >&2
                    exit 1
                    ;;
            esac
        fi
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
        target_bot=""
        if [[ $# -ge 2 && -f "${PIDS_DIR}/$1.pid" ]]; then
            target_bot="$1"
            shift
        fi
        command_string="$*"
        if [[ -z "${command_string}" ]]; then
            echo "Error: Command text required, e.g. mc-bot cmd '!status' or mc-bot cmd Rusty '!status'" >&2
            exit 1
        fi
        # ponytail: stream stdin to cat >> to avoid shell expansion vulnerabilities & command loss
        cmd_dest="/dev/shm/mc-bot.cmd"
        [[ -n "${target_bot}" ]] && cmd_dest="/dev/shm/mc-bot-${target_bot}.cmd"
        if [[ "${IS_REMOTE}" -eq 1 ]]; then
            printf '%s\n' "${command_string}" | remote_ssh "cat >> ${cmd_dest}"
            echo "[+] Dispatched command to remote bot on CT 116: ${command_string}"
        else
            printf '%s\n' "${command_string}" >> "${cmd_dest}"
            echo "[+] Dispatched command to local bot ${target_bot:-all}: ${command_string}"
        fi
        ;;
    probe|discover)
        pmode="table"
        if [[ "${1:-}" == "--json" || "${1:-}" == "-j" ]]; then
            pmode="json"
        elif [[ "${1:-}" == "--tsv" || "${1:-}" == "-t" ]]; then
            pmode="tsv"
        fi
        discover_minecraft_games "${pmode}"
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
