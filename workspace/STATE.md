# Project State

Status: initialized and published to private GitHub repository

## Tracked scope

- Docker image and Compose definitions
- Safe configuration templates and non-secret Paper configuration
- Project and continuity documentation

## Untracked operational scope

- World and player data
- Local `server.properties` and generated secrets
- Downloaded Paper/JVM dependencies and plugin binaries
- Logs, caches, and generated plugin state

No deployment, recovery, backup restore, or live-server qualification has been completed by this repository bootstrap.

## Open operational question

The current Compose file persists `./data` as `/opt/minecraft/world`. Nether and End persistence paths must be verified against the intended active dataset before changing mounts or recreating the container.
