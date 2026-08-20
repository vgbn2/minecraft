# Control Plane

Source paths: `cmd/mcctl`, `internal`, `examples`, `contracts`, `deploy`

- `internal/crafty`: pinned API v2 client.
- `internal/admission`, `internal/gate`, `internal/lock`: fail-closed start policy and execution lock.
- `internal/monitor`, `internal/alerts`: WAL history, atomic state, retention, and alerts.
- `internal/profile`, `internal/validate`: immutable profile/config contracts.
- `internal/audit`: Crafty ownership and unmanaged-Java checks.
- `internal/backup`: non-executing safety policy retained for the future backup batch.

Crafty owns lifecycle and server catalog. There is no Compose renderer or tenant catalog in `mcctl`.
