# Threat Model & Vulnerability Analysis (STRIDE)

This document provides a systematic STRIDE security analysis across the 4 physical trust boundaries of the Minecraft server and autonomous agent deployment:
1. **Public/External Players** (Untrusted)
2. **Pumpkin Rust & Paper Server Listeners** (Boundary Gatekeeper)
3. **Autonomous Agent Squad Runtime** (Privileged Client)
4. **Proxmox CT 116 & Host System** (Infrastructure Core)

---

## 1. STRIDE Threat Matrix

| Threat Category | Physical Attack Vector | Impact / Severity | Mitigation Invariant | Verification Probe |
| :--- | :--- | :--- | :--- | :--- |
| **Spoofing** | Attacker impersonates a bot or admin player name on offline-mode server. | High: Unauthorized access to bot inventory or admin ops. | UUID-pinned authentication in `ops.json`; server listener bound strictly to loopback (`127.0.0.1`), blocking direct external TCP handshakes. | `ss -tulpn | grep 25566` confirms loopback-only binding. |
| **Tampering** | Command injection via in-game chat messages (`!eval`, shell injection via prompter). | Critical: Remote code execution inside the bot process. | Bot chat dispatcher strictly avoids `eval()`, `child_process.exec()`, or raw shell interpolation. All actions route to deterministic Mineflayer API primitives. | `node tests/test-verify.mjs` Gate 4 command parser test. |
| **Repudiation** | Rogue agent or player griefs construction without audit trail. | Medium: Unaccounted block destruction or material theft. | Public chat broadcasting of all task milestones and macro-goals; centralized logging in `/dev/shm/mc-bot/*.log`. | `mc-bot.sh squad log <name>` inspects historical actions. |
| **Information Disclosure** | Leakage of AI proxy tokens (`sk-...`) or host credentials. | High: Unauthorized usage of private LLM quotas or server SSH keys. | No credentials in repository; `.env` strictly ignored by git and validated by GitHub Actions `security.yml`; tmpfs IPC files kept in volatile RAM. | GitHub Actions `security-audit.yml` gate. |
| **Denial of Service** | Packet flooding, entity spawn exhaustion, or circular navigation path loops. | Medium: Server tick rate (TPS) drops below 20; bot process crash. | Pumpkin Rust asynchronous reactor; safe hop slicing navigator with 24m trajectory limits; 2-retry circuit breaker on stuck pathfinding. | `mc-bot.sh probe` confirms 0-kick low-latency ping. |
| **Elevation of Privilege** | Normal player issues `/op` or executes privileged bot commands. | Critical: Server compromise. | `default_op_level = 0`; command dispatcher enforces sender allowlist (`vgbn` or Mastermind `Jotaro`). | In-game command authorization checks in `src/index.mjs`. |

---

## 2. In-Game Chat Protocol Invariants

1. **Zero Shell Execution**: The bots never pass chat strings into a shell.
2. **Operator Command Pass-Through**: In-game slash commands (e.g. `/give`, `/gamemode`) are routed via `bot.chat()` only when the sender is an authorized operator.
3. **Deterministic State Guards**: Worker bots (Bob, Torin, Willow, Arthur) execute verified JavaScript state machines. AI query tokens are used exclusively by the Mastermind (`Jotaro`) for strategic task planning, eliminating non-deterministic hallucinations in low-level voxel placement.
