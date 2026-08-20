# Session Memory

## Durable facts

- This is a Docker-based Paper Minecraft server project.
- Paper is currently pinned in `Dockerfile`; upgrades require release-note review and copied-world validation.
- World/player/runtime data and local secrets are not Git-managed and need an independent backup and recovery process.
- The local generated `server.properties` has historically used `online-mode=false`; the committed example defaults to the safer `online-mode=true`.

## Evidence boundaries

- A clean source diff or successful Compose parse does not prove image build, server startup, deployment, world recovery, or live health.
- Never commit generated management secrets, player identifiers, world files, logs, downloaded server JARs, or plugin caches.
