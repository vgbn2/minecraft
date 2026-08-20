# Project State

Status: Crafty source control plane implemented; world adoption is NO-GO pending dimension recovery

## Tracked scope

- Docker image and Compose definitions
- Safe configuration templates and non-secret Paper configuration
- Canonical Crafty architecture, operations, profile, security, and source documentation
- Pinned Crafty OpenAPI required-operation contract and Paper/Fabric profiles
- Tracked agent Code Atlas with deterministic inventory checking
- Crafty API client, profile/runtime verification, admission gate, monitor/alerts, corruption recovery, and ownership audit
- Reviewed native Crafty/monitor systemd templates; not deployed

## Untracked operational scope

- World and player data
- Local `server.properties` and generated secrets
- Downloaded Paper/JVM dependencies and plugin binaries
- Logs, caches, and generated plugin state

No deployment, recovery, backup restore, or live-server qualification has been completed by this repository bootstrap.

The current `mcctl` surface is a Crafty v2 client, immutable-profile validator, fail-closed `gate exec` wrapper, Linux/Crafty sampler, WAL monitoring/alert store, ownership audit, and Code Atlas checker. Crafty is the sole server catalog/lifecycle owner. The obsolete tenant catalog, Compose renderer, and lifecycle state machine were removed.

## Open operational blocker

On `steamlinux`, no Minecraft container or image remains. `data/` is a later active Overworld, while the local `world*` sibling set is proven by logs to come from an earlier fresh run. Matching Nether/End and server-root metadata must be recovered from the original host/container/export/backup before any Crafty import or start.
