# Data and Backup Context

Source paths: `docs/architecture/data-and-backup.md`, `internal/monitor`, `internal/backup`, `workspace/STATE.md`

Crafty owns server and backup-job state. Monitor SQLite owns samples, reservations, and alerts only. Runtime data remains outside Git; backup execution and restore qualification are pending operational batches.
