# Server Hardening & Security Architecture

## 1. Physical & Network Boundary Isolation

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PROXMOX HOST (hpdesk / 100.79.196.24)           │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │            CT 116 (Unprivileged Sandbox Container)            │   │
│   │                                                                │   │
│   │   ┌───────────────────────┐         ┌──────────────────────┐   │   │
│   │   │  Pumpkin Rust Server  │         │   Paper Java Server  │   │   │
│   │   │    127.0.0.1:25566    │         │   127.0.0.1:25565    │   │   │
│   │   │   (Loopback Only)     │         │   (Loopback Only)    │   │   │
│   │   └───────────▲───────────┘         └──────────▲───────────┘   │   │
│   │               │                                │               │   │
│   │               └────────────────┬───────────────┘               │   │
│   │                                │ TCP Loopback                  │   │
│   │                   ┌────────────┴───────────┐                   │   │
│   │                   │  5 Autonomous Agents   │                   │   │
│   │                   │  (Node.js v18.20.4)    │                   │   │
│   │                   └────────────┬───────────┘                   │   │
│   │                                │ LAN HTTP Only                 │   │
│   └────────────────────────────────┼───────────────────────────────┘   │
│                                    ▼                                   │
│              ┌───────────────────────────────────────────┐             │
│              │       9Router LAN AI Proxy (CT 123)       │             │
│              │        http://192.168.4.103:20128/v1      │             │
│              └───────────────────────────────────────────┘             │
└────────────────────────────────────────────────────────────────────────┘
```

### Directives
1. **Strict Loopback Binding**:
   - Both Minecraft server listeners (`pumpkin` on port 25566 and `paper` on port 25565) bind strictly to `127.0.0.1`.
   - External WAN traffic cannot reach the game ports directly. Access is mediated strictly through encrypted Tailscale mesh routes or SSH port forwarding.
2. **Proxmox LXC Sandbox Boundaries**:
   - CT 116 runs as an **unprivileged container** (`unprivileged: 1`). Root inside the container maps to unprivileged UID `100000` on the host kernel.
   - Root filesystem mounts prevent arbitrary host device access.
3. **RAM Tmpfs IPC Security**:
   - Bot inter-process communication occurs in `/dev/shm/mc-bot/` (Linux shared memory tmpfs).
   - Permissions are restricted to `0600`/`0644`. Tmpfs writes do not touch physical NVMe storage, eliminating SSD write amplification and ensuring volatile clearance on container reboot.
4. **Secret Sanitization & Zero Credential Tracking**:
   - `.env` files are strictly barred from Git tracking via `.gitignore` and enforced by `.github/workflows/security.yml`.
   - AI proxy tokens (`sk-...`) are injected via environment variables or isolated configuration files on the local machine and CT 116.
5. **Fail-Closed Permission Model**:
   - `default_op_level = 0`: Normal players joining have zero operator privileges.
   - Operator credentials are bound strictly by player UUID inside `/root/pumpkin/data/ops.json`.
   - In-game slash commands (`/give`, `/gamemode`) are accessible only when executed by explicit operator-authorized entities.

---

## 2. 4-Tier Operational Hardening Runbook

### 1. Inspection & Diagnostic Probes (Read-Only)
```bash
# Verify server processes are bound strictly to 127.0.0.1 (not 0.0.0.0)
export SSH_AUTH_SOCK="/run/user/$(id -u)/gcr/ssh"
ssh root@192.168.4.117 "ss -tulpn | grep -E '25565|25566'" # inspect listening sockets
```
*Expected Healthy Signature:* `127.0.0.1:25566` and/or `127.0.0.1:25565` (no `0.0.0.0` or `*`).

### 2. Remediation & Action (Mutation)
```bash
# Rotate / enforce operator permissions on CT 116
ssh root@192.168.4.117 "cat << 'EOF' > /root/pumpkin/data/ops.json
[
  {
    \"uuid\": \"374805f0-32a4-36d9-d736-661e22cc55ca\",
    \"name\": \"vgbn\",
    \"level\": 4,
    \"bypassesPlayerLimit\": false
  }
]
EOF"
```

### 3. Verification & Oracle Gate (Proof)
```bash
# Verify ops.json parses valid JSON and has 0600 permissions
ssh root@192.168.4.117 "chmod 0600 /root/pumpkin/data/ops.json && jq . /root/pumpkin/data/ops.json >/dev/null && echo 'OPS CONFIG VALID'"
```

### 4. Rollback & Emergency Exit (Safety)
```bash
# Flush operator access if compromised
ssh root@192.168.4.117 "echo '[]' > /root/pumpkin/data/ops.json"
```
