# Minecraft Control Plane Documentation

This directory is the canonical engineering documentation. Crafty Controller is the only server catalog and lifecycle authority. `mcctl` is a thin Crafty API client, immutable-profile validator, start admission wrapper, read-only monitor, alert evaluator, and audit CLI.

- [System architecture](architecture/system.md)
- [Runtime ownership](architecture/runtime-ownership.md)
- [Monitoring and admission](architecture/monitoring-and-admission.md)
- [Data and backup](architecture/data-and-backup.md)
- [Network and security](architecture/network-and-security.md)
- [HP Desk adoption](operations/hpdesk-adoption.md)
- [HP Desk management-code release sync](operations/hpdesk-adoption.md#management-code-release-sync)
- [Backup and restore](operations/backup-and-restore.md)
- [Incident response](operations/incident-response.md)
- [Upgrade and rollback](operations/upgrade-and-rollback.md)
- [Compatibility matrix](profiles/compatibility-matrix.md)
- [Profile lifecycle](profiles/profile-lifecycle.md)
- [Official sources](references/official-sources.md)

`workspace/` holds current state, evidence, reports, plans, and handoffs. Its Code Atlas is retained as historical implementation evidence and must not override this documentation.
