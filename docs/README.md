# Minecraft Control Plane Documentation

This directory provides canonical engineering documentation for the Crafty-managed Minecraft control plane. Crafty Controller is the primary server catalog and lifecycle authority. `mcctl` serves as the fail-closed start admission gate, immutable profile validator, read-only resource monitor, and alert evaluator.

---

## Navigation

### Architecture & Product Model
- [System architecture](architecture/system.md) — Host layout, control flows, and fail-closed admission
- [Runtime ownership](architecture/runtime-ownership.md) — Multi-tenant hierarchy: User -> Tenant -> Server -> World Set -> Profile
- [Monitoring and admission](architecture/monitoring-and-admission.md) — Polling metrics, rollups, WAL storage, and start admission gate
- [Data and backup](architecture/data-and-backup.md) — World preservation, split-brain protection, and snapshot isolation
- [Network and security](architecture/network-and-security.md) — Port boundaries, tunnel ingress (Playit), and Tailscale admin mesh

### Operations & Runbooks
- [Operational troubleshooting & known failure modes](operations/troubleshooting.md) — Auth session errors, Playit LOD flow control, and anti-cheat movement kicks
- [HP Desk adoption](operations/hpdesk-adoption.md) — Production host adoption procedure and baseline verification
- [HP Desk management-code release sync](operations/hpdesk-adoption.md#management-code-release-sync) — Immutable rsync sync procedure
- [Backup and restore](operations/backup-and-restore.md) — Backup procedures and restore qualification drill
- [Incident response](operations/incident-response.md) — Recovery runbooks, failure classification, and alert handling
- [Upgrade and rollback](operations/upgrade-and-rollback.md) — Version migration and profile rollbacks

### Profiles & References
- [Compatibility matrix](profiles/compatibility-matrix.md) — Supported Paper and Fabric versions, Java baselines, and flags
- [Profile lifecycle](profiles/profile-lifecycle.md) — Authoring, hashing, validating, and activating immutable profiles
- [Official sources](references/official-sources.md) — Upstream source ledger, pinned releases, and API specifications

---

## Workspace Evidence & Reassessment

`workspace/` contains operational state, evidence, audit logs, and forward-looking plans:
- `workspace/STATE.md` — Current project and operational status
- `workspace/NEXT_SESSION_GOAL.md` — Active session goals and safety boundaries
- `workspace/plans/SIMPLE_WEB_PRODUCT_REASSESSMENT.md` — Simple web UI product plan, magic-number review, and custom code rationalization
- `workspace/code-atlas/` — Deterministic inventory and drift-detection records
