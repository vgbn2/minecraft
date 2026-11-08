# Session Memory

## Durable facts

- This is a Docker-based Paper Minecraft server project.
- Paper is currently pinned in `Dockerfile`; upgrades require release-note review and copied-world validation.
- World/player/runtime data and local secrets are not Git-managed and need an independent backup and recovery process.
- The local generated `server.properties` has historically used `online-mode=false`; the committed example defaults to the safer `online-mode=true`.
- The canonical Git remote is the private repository `git@github.com:vgbn2/minecraft.git`, branch `main`.
- The old multi-tenant/Compose design is superseded planning evidence. `docs/` defines the Crafty-owned architecture.
- The Go control plane builds through the digest-pinned Go 1.27.0 container because the host gccgo reports Go 1.18. `gate exec` can replace itself with an approved Java process, so never exercise it against runtime data without an authorized, qualified profile.
- The tracked `workspace/code-atlas` maps folders and key entrypoints; `mcctl atlas check` is the drift gate.
- `graphify extract . --code-only --no-cluster` can return exit 0 after sandbox `EPERM` while writing an empty graph. Reject `0 nodes / 0 edges`, remove only the generated invalid artifact, and use the Code Atlas plus direct reads unless a host-capable extraction passes.
- Canonical engineering documentation now lives under `docs/`; `workspace/code-atlas` and old multi-tenant plans are historical/navigation evidence only.
- Crafty is the sole server catalog/lifecycle authority. `mcctl` owns only API access, immutable profiles, start admission/locking, monitoring/alerts, and read-only audits.
- On 2026-08-20 `steamlinux` had no Minecraft container or image. `data/` is later than the local `world*` siblings; logs prove the siblings came from an earlier clean run. Never pair them for migration without independent matching evidence.
- First Crafty control-plane beta source commit `f5938563cbf34bb4828e22910d42ad43ea833506` was pushed to `origin/main` on 2026-08-20. Next work is non-live testing, load/logging analysis, and concurrency stress; deployment authority does not carry forward.
- On 2026-08-20 beta qualification source commit `96dd06a56de312dc57de083acaba26398cd0f093` was pushed to `origin/main`. It adds fake-Crafty, concurrency, failed-exec recovery, snapshot-v2 diagnostics, rollups, durable alert-attempt throttling, notifier mocks, redaction, and disposable load evidence. The final load gate measured 0.0149% projected CPU, 35.19 MiB peak RSS, and 100.61 ms average Linux-probe latency. This is not Crafty/Minecraft host, deployment, recovery, or soak proof.
- On 2026-08-20 the user redirected the next session to documentation-only product/code reassessment. The target is a simple web experience with tenant-owned servers/world sets and server-pinned version profiles; the current Go code must be reviewed for excessive magic numbers and unnecessary custom ownership before implementation resumes.
- On 2026-08-20, commit `3542d50b90aa5b3f99ceb3b4b6c85e2a0a4c3938` was pushed and its 110 tracked source files were checksum-verified in the isolated HP Desk release path `/home/vgbn-server/Documents/codeptit/minecraft/releases/3542d50b90aa/`. The legacy `/opt/minecraft` Paper container remained running and unchanged; source sync is not deployment or runtime qualification.

## Evidence boundaries

- A clean source diff or successful Compose parse does not prove image build, server startup, deployment, world recovery, or live health.
- Never commit generated management secrets, player identifiers, world files, logs, downloaded server JARs, or plugin caches.
- Do not describe static Compose parsing, temporary monitor databases, or green Go tests as Crafty installation, server runtime, deployment, backup recovery, or soak proof.

## Operational Failure Modes & Troubleshooting (2026-08-22)

- **Authentication & Secure Profile:** In Minecraft 1.19+/1.21.11, setting `online-mode=false` must be paired with `enforce-secure-profile=false`. Otherwise, clients with expired Microsoft tokens (Mojang Authlib 401 error) will fail keypair negotiation and get dropped silently.
- **Playit Tunnel LOD Flow Control:** `LodServerSupport` default streaming rate (25 MB/s) saturates Playit public tunnels. Pacing limits (`mbPerSecondLimitPerPlayer: 2.0`, `sendQueueLimitPerPlayer: 256`, `enablePingBackstop: true`) and `timeout-time: 300` in `spigot.yml` are required to prevent keepalive timeout disconnects.
- **Aggressive Anti-Cheat Flags:** Set `allow-flight=true` in `server.properties`, `moved-too-quickly-multiplier: 100.0` in `spigot.yml`, and `packet-limiter action: DROP` in `paper-global.yml` to prevent falling/elytra kicks.
- **Plugin Java Target Scanning:** Always scan plugin JAR bytecode with struct unpack before deployment (`major - 44`) to guarantee class version <= 65.0 (Java 21).
- **Fleet Topology (2026-09-16):** HP Desk (`100.122.7.7` via Tailscale) is the primary production host with higher RAM/CPU headroom. Dell OptiPlex is the secondary/staging host for auxiliary workloads. Steamlinux is the local disposable qualification workstation.
- **Simple Web Product Reassessment (2026-09-16):** Canonical hierarchy is `User Membership` -> `Tenant` -> `Server` -> `World Set` -> `Immutable Profile`. Versions belong to servers, not users; artifacts downloaded on demand. Crafty owns server catalog and web UI; `mcctl` retains fail-closed start admission (`gate exec`), profile verification, and WAL monitoring.
- **PR-Imposed Changes Gate in mass-implement (2026-09-16):** Mandatory intake, line-by-line before/after diffs, and individual verified closure for all reviewer-imposed changes.
