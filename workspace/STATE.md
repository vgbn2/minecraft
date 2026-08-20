# Project State

Status: Crafty control-plane beta qualification committed and pushed; world adoption remains NO-GO

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

The qualification source at `96dd06a56de312dc57de083acaba26398cd0f093` adds a testable startgate owner, matching-PID failed-exec cleanup, snapshot v2 redacted issue codes with v1 readers, metric rollups/checkpointing, structured redacted diagnostics, durable alert hysteresis/deduplication/reminder-attempt state, notifier mocks, and bounded disposable load evidence. It is pushed to `origin/main`; it is not deployment or runtime qualification.

## Open operational blocker

On `steamlinux`, no Minecraft container or image remains. `data/` is a later active Overworld, while the local `world*` sibling set is proven by logs to come from an earlier fresh run. Matching Nether/End and server-root metadata must be recovered from the original host/container/export/backup before any Crafty import or start.
