# Security Policy

## Supported Versions

Only the latest commit on `main` receives security fixes.

| Version | Supported |
| :--- | :--- |
| `main` (latest) | ✅ |
| older commits / tags | ❌ |

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

To report a vulnerability:
1. Submit a confidential report via [GitHub Private Vulnerability Reporting](https://github.com/vgbn2/minecraft/security/advisories/new).
2. Alternatively, email the maintainer directly at `ducanhbin05@gmail.com` with the subject tag `[SECURITY: MINECRAFT]`.

Include in your report:
- A clear description of the vulnerability and its potential exploit impact.
- Step-by-step reproduction instructions or a minimal proof-of-concept (PoC).
- Affected subsystem (e.g. Pumpkin/Paper server config, `mcctl` admission gate, bot IPC bus, Crafty API controller).

### Response Timeline

| Stage | Target Timeline |
| :--- | :--- |
| **Acknowledgement** | Within 3 business days |
| **Triage & Severity Assessment** | Within 14 business days |
| **Patch Release or Mitigation** | Dependent on CVSS severity (typically ≤ 30 days) |

---

## Scope

### In Scope for Security Review
- **Loopback & Ingress Enforcement**: Unauthorized WAN binding or bypass of `127.0.0.1` restriction on ports `25565`, `25566`, and `25575`.
- **RCON & Control Plane Security**: Command injection or authentication bypass via `tools/rcon.py` or `mcctl`.
- **IPC Bus & Filesystem Boundaries**: Privilege escalation, race conditions (TOCTOU), or permission tampering across volatile IPC channels (`/dev/shm/mc-bot/`).
- **Secret Isolation**: Exposure of Playit.gg credentials, Tailscale auth keys, or AI proxy (`9Router`) bearer tokens.
- **Fail-Closed Admission**: Flaws in SHA-256 bytecode validation in `mcctl` that could allow unapproved executable JAR execution.

### Out of Scope
- Vanilla Minecraft game glitches and client-side rendering anomalies.
- Denial of service via deliberate exhaustion of local sandbox memory on test workstations.
- Development-only fixtures (`bots/tests/fixtures/`).
- Offline AI tool mocks running with `OFFLINE_ONLY=1`.

---

## Security Architecture Principles

1. **Defense in Depth**: The server runs inside an unprivileged Proxmox LXC container (`CT 116`) with separated Linux user namespaces.
2. **Strict Loopback Binding**: Game sockets and management APIs never bind to `0.0.0.0`. Remote traffic passes exclusively through encrypted Tailscale mesh interfaces or authenticated Playit tunnels.
3. **Volatile In-Memory IPC**: Autonomous bot communication operates entirely in RAM (`/dev/shm`), preventing persistent file tampering and zeroing disk write amplification.
4. **Zero-Key CI Testing**: The entire 21-gate bot verification test suite executes keyless against recorded mocks and local proxies.
