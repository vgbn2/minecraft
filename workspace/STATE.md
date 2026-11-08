# Project State

Status: Documentation & Simple Web Product Reassessment completed; magic number inventory and custom code rationalization defined; world adoption remains NO-GO

## Tracked scope

- Docker image and Compose definitions
- Safe configuration templates and non-secret Paper configuration
- Canonical Crafty architecture, operations, profile, security, and source documentation
- Pinned Crafty OpenAPI required-operation contract and Paper/Fabric profiles
- Tracked agent Code Atlas with deterministic inventory checking
- Crafty API client, profile/runtime verification, admission gate, monitor/alerts, corruption recovery, and ownership audit
- Simple Web Product Reassessment document (`workspace/plans/SIMPLE_WEB_PRODUCT_REASSESSMENT.md`)
- Reviewed native Crafty/monitor systemd templates; not deployed

## Untracked operational scope

- World and player data
- Local `server.properties` and generated secrets
- Downloaded Paper/JVM dependencies and plugin binaries
- Logs, caches, and generated plugin state

No deployment, recovery, backup restore, or live-server qualification has been completed by this repository bootstrap.

## Fleet Topology & Isolation

- **HP Desk (`100.122.7.7` via Tailscale)**: Primary production host (higher RAM/compute). Runs native Crafty 4.10.8 under an unprivileged `crafty` service account. Management source mirrored at `/home/vgbn-server/Documents/codeptit/minecraft/releases/<commit>/`, isolated from the runtime `/opt/minecraft` tree.
- **Dell OptiPlex**: Secondary / Staging host (lower spec than HP Desk). Designated for auxiliary server instances, staging workloads, or secondary failover.
- **Steamlinux**: Disposable local workstation for non-live development, unit tests, and static linting. Never hosts production world data.

## Product & Architecture Reassessment Status

The product architecture is codified around a simple Crafty-backed web management experience:
$$\text{User Membership} \longrightarrow \text{Tenant} \longrightarrow \text{Server} \longrightarrow \text{World Set} \longrightarrow \text{Immutable Profile Revision}$$

- Crafty is the single authority for server catalog, lifecycle, web dashboard, and user authentication.
- `mcctl` retains only fail-closed start admission (`gate exec`), SHA-256 profile verification, read-only WAL metric sampling/alerting, and Code Atlas drift checking.
- Magic numbers in `internal/` have been cataloged with clear separation between fixed invariants (protocols/pins) and policy parameters to be extracted into `internal/config/`.
- `mass-implement` skill has been updated with a mandatory PR-Imposed Changes & Review Enforcement Gate.

## Open operational blocker

On `steamlinux`, no Minecraft container or image remains. `data/` is a later active Overworld, while the local `world*` sibling set is proven by logs to come from an earlier fresh run. Matching Nether/End and server-root metadata must be recovered from the original host/container/export/backup before any Crafty import or start.
