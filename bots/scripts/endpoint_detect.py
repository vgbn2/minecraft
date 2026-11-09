#!/usr/bin/env python3
# endpoint_detect.py: Dynamic Minecraft Server List Ping (SLP) & UDP multicast LAN discovery.
# ponytail: Python stdlib only; zero hardcoded ports; zero third-party dependencies.

import json
import os
import re
import socket
import struct
import subprocess
import sys
import time

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
                if val:
                    out.append(b | 0x80)
                else:
                    out.append(b)
                    break
            return bytes(out)

        def read_varint(sock):
            val, shift = 0, 0
            while True:
                b = sock.recv(1)
                if not b:
                    return None
                val |= (b[0] & 0x7F) << shift
                if not (b[0] & 0x80):
                    break
                shift += 7
            return val

        h_bytes = host.encode("utf-8")
        hs = (
            pack_varint(0)
            + pack_varint(765)
            + pack_varint(len(h_bytes))
            + h_bytes
            + port.to_bytes(2, "big")
            + pack_varint(1)
        )
        s.sendall(pack_varint(len(hs)) + hs)
        req = pack_varint(0)
        s.sendall(pack_varint(len(req)) + req)

        read_varint(s)
        read_varint(s)
        slen = read_varint(s)
        if slen is None:
            s.close()
            return None

        data = b""
        while len(data) < slen:
            chunk = s.recv(min(4096, slen - len(data)))
            if not chunk:
                break
            data += chunk
        s.close()

        res = json.loads(data.decode("utf-8", "replace"))
        desc = res.get("description", "")
        if isinstance(desc, dict):
            motd = desc.get("text", "")
            if "extra" in desc and isinstance(desc["extra"], list):
                motd += "".join(
                    x.get("text", "") if isinstance(x, dict) else str(x)
                    for x in desc["extra"]
                )
        else:
            motd = str(desc)

        ver = res.get("version", {}).get("name", "unknown")
        proto = res.get("version", {}).get("protocol", 0)
        players = res.get("players", {})
        online = players.get("online", 0)
        max_p = players.get("max", 0)
        sample = [
            p.get("name", "")
            for p in players.get("sample", [])
            if isinstance(p, dict)
        ]
        return {
            "motd": motd.strip(),
            "version": ver,
            "protocol": proto,
            "online": online,
            "max": max_p,
            "sample": sample,
        }
    except Exception:
        return None

def parse_ss_listeners(output, host_label):
    candidates = []
    for line in output.splitlines():
        lower = line.lower()
        if any(k in lower for k in ("java", "pumpkin", "bedrock", "minecraft")):
            parts = line.split()
            if len(parts) >= 4:
                addr_part = parts[3]
                p_str = addr_part.rsplit(":", 1)[-1]
                if p_str.isdigit():
                    proc_name = "MC Server"
                    for k in ("pumpkin", "java", "bedrock"):
                        if k in lower:
                            proc_name = k.capitalize()
                            break
                    candidates.append((int(p_str), f"{host_label} {proc_name}"))
    return candidates

def discover_all(remote_ip, listen_sec=0.5):
    candidates = []

    # 1. UDP Multicast (Minecraft LAN discovery on 224.0.2.60:4445)
    # Dynamically reads whatever port the LAN game broadcasted in [AD]<port>[/AD]
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

    # 2. Local TCP listeners via ss (Singleplayer LAN / local server) - dynamic port detection
    try:
        out = subprocess.check_output(
            ["ss", "-tlpn"], stderr=subprocess.DEVNULL
        ).decode("utf-8")
        for port, src in parse_ss_listeners(out, "Local"):
            candidates.append(("127.0.0.1", port, src, ""))
    except Exception:
        pass

    # 3. Dynamic Remote Listeners & Probes (if remote_ip provided and not loopback)
    # Never hardcode ports: inspect active listeners dynamically on remote host
    remote_results = []
    if remote_ip and remote_ip not in ("127.0.0.1", "localhost", "0.0.0.0"):
        remote_cmd = (
            "python3 -B - << 'PYEOF'\n"
            "import subprocess, json\n"
            "try:\n"
            "    out = subprocess.check_output(['ss', '-tlpn'], stderr=subprocess.DEVNULL).decode('utf-8')\n"
            "    ports = []\n"
            "    for line in out.splitlines():\n"
            "        lower = line.lower()\n"
            "        if any(k in lower for k in ('java', 'pumpkin', 'bedrock', 'minecraft')):\n"
            "            parts = line.split()\n"
            "            if len(parts) >= 4:\n"
            "                p_str = parts[3].rsplit(':', 1)[-1]\n"
            "                if p_str.isdigit():\n"
            "                    proc = 'MC'\n"
            "                    for k in ('pumpkin', 'java', 'bedrock'):\n"
            "                        if k in lower:\n"
            "                            proc = k.capitalize(); break\n"
            "                    ports.append((int(p_str), proc))\n"
            "    print(json.dumps(ports))\n"
            "except Exception:\n"
            "    print('[]')\n"
            "PYEOF\n"
        )
        remote_out = None
        # Try direct SSH first
        try:
            p = subprocess.run(
                ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=1", f"root@{remote_ip}", remote_cmd],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=1.5,
            )
            if p.returncode == 0 and p.stdout.strip():
                remote_out = p.stdout.decode("utf-8", "replace")
        except Exception:
            pass

        # Try via cluster gateway if direct SSH failed
        if not remote_out:
            gateway = os.environ.get("MC_GATEWAY", "100.120.66.1")
            try:
                p = subprocess.run(
                    ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=2", f"root@{gateway}",
                     f"ssh -o BatchMode=yes -o ConnectTimeout=2 root@{remote_ip} \"{remote_cmd}\""],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    timeout=3.0,
                )
                if p.returncode == 0 and p.stdout.strip():
                    remote_out = p.stdout.decode("utf-8", "replace")
            except Exception:
                pass

        if remote_out:
            try:
                match = re.search(r"\[.*\]", remote_out, re.DOTALL)
                if match:
                    detected_ports = json.loads(match.group(0))
                    for port, proc in detected_ports:
                        candidates.append((remote_ip, port, f"Remote {proc}", ""))
            except Exception:
                pass

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
        # If remote probe host could not be contacted directly over TCP, try probing via SSH bridge
        if not info and probe_host == remote_ip and remote_ip:
            slp_remote_py = (
                "import socket, struct, json, sys\n"
                "p = int(sys.argv[1])\n"
                "def ping(port):\n"
                "    try:\n"
                "        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.settimeout(0.8)\n"
                "        s.connect(('127.0.0.1', port))\n"
                "        def pv(v):\n"
                "            o = bytearray()\n"
                "            while True:\n"
                "                b = v & 0x7F; v >>= 7\n"
                "                if v: o.append(b | 0x80)\n"
                "                else: o.append(b); break\n"
                "            return bytes(o)\n"
                "        def rv(sk):\n"
                "            v, sh = 0, 0\n"
                "            while True:\n"
                "                b = sk.recv(1)\n"
                "                if not b: return None\n"
                "                v |= (b[0] & 0x7F) << sh\n"
                "                if not (b[0] & 0x80): break\n"
                "                sh += 7\n"
                "            return v\n"
                "        hs = pv(0) + pv(765) + pv(9) + b'127.0.0.1' + port.to_bytes(2, 'big') + pv(1)\n"
                "        s.sendall(pv(len(hs)) + hs)\n"
                "        s.sendall(pv(1) + pv(0))\n"
                "        rv(s); rv(s)\n"
                "        l = rv(s)\n"
                "        if l is None: return None\n"
                "        d = b''\n"
                "        while len(d) < l:\n"
                "            c = s.recv(min(4096, l - len(d)))\n"
                "            if not c: break\n"
                "            d += c\n"
                "        s.close()\n"
                "        return json.loads(d.decode('utf-8', 'replace'))\n"
                "    except Exception: return None\n"
                "res = ping(p)\n"
                "if res:\n"
                "    desc = res.get('description', '')\n"
                "    motd = desc.get('text', '') if isinstance(desc, dict) else str(desc)\n"
                "    ver = res.get('version', dict()).get('name', 'unknown')\n"
                "    proto = res.get('version', dict()).get('protocol', 0)\n"
                "    pl = res.get('players', dict())\n"
                "    print(json.dumps({'motd': motd, 'version': ver, 'protocol': proto, 'online': pl.get('online',0), 'max': pl.get('max',0), 'sample': [x.get('name','') for x in pl.get('sample',[]) if isinstance(x, dict)]}))\n"
            )
            try:
                gateway = os.environ.get("MC_GATEWAY", "100.120.66.1")
                p = subprocess.run(
                    ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=2", f"root@{gateway}",
                     f"ssh -o BatchMode=yes -o ConnectTimeout=2 root@{remote_ip} \"python3 -B - {port}\""],
                    input=slp_remote_py.encode("utf-8"),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    timeout=3.0,
                )
                if p.returncode == 0 and p.stdout.strip():
                    m = re.search(r"\{.*\}", p.stdout.decode("utf-8", "replace"))
                    if m:
                        info = json.loads(m.group(0))
            except Exception:
                pass

        if info:
            motd = info.get("motd", "") or extra_motd
            world = motd
            user = ""
            if " - " in motd:
                world, user = motd.split(" - ", 1)
            results.append({
                "host": probe_host,
                "port": port,
                "source": src,
                "version": info.get("version", "unknown"),
                "protocol": info.get("protocol", 0),
                "online": info.get("online", 0),
                "max": info.get("max", 0),
                "world": world.strip(),
                "user": user.strip(),
                "motd": motd.strip(),
                "players": ",".join(info.get("sample", [])),
            })

    def sort_key(r):
        if "LAN" in r["source"] or r["host"] == "127.0.0.1":
            return (0, r["port"])
        return (1, r["port"])

    results.sort(key=sort_key)
    return results

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "tsv"
    remote_target = sys.argv[2] if len(sys.argv) > 2 else "192.168.4.117"
    res = discover_all(remote_target, 0.5)

    if mode == "json":
        print(json.dumps(res, indent=2))
    elif mode == "table":
        if not res:
            print("No active Minecraft servers or LAN games discovered.")
            sys.exit(0)
        hdr_hash = "#"
        print(
            f"{hdr_hash:<3} {'WORLD / MOTD':<28} {'ENDPOINT':<22} {'VERSION':<15} {'PLAYERS':<9} {'SOURCE'}"
        )
        print("-" * 92)
        for i, r in enumerate(res, 1):
            world_disp = r["world"]
            if r["user"]:
                world_disp = f"{r['world']} ({r['user']})"
            if len(world_disp) > 26:
                world_disp = world_disp[:23] + "..."
            ep = f"{r['host']}:{r['port']}"
            ver = f"{r['version']}"
            p = f"{r['online']}/{r['max']}"
            print(f"[{i}] {world_disp:<28} {ep:<22} {ver:<15} {p:<9} {r['source']}")
    else:  # tsv
        for i, r in enumerate(res, 1):
            print(
                f"{i}\t{r['host']}\t{r['port']}\t{r['source']}\t{r['version']}\t{r['protocol']}\t{r['online']}\t{r['max']}\t{r['world']}\t{r['user']}\t{r['motd']}\t{r['players']}"
            )
