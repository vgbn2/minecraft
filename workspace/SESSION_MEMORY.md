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

## Evidence boundaries

- A clean source diff or successful Compose parse does not prove image build, server startup, deployment, world recovery, or live health.
- Never commit generated management secrets, player identifiers, world files, logs, downloaded server JARs, or plugin caches.
- Do not describe static Compose parsing, temporary monitor databases, or green Go tests as Crafty installation, server runtime, deployment, backup recovery, or soak proof.
