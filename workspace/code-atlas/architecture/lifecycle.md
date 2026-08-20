# Lifecycle Context

Source paths: `docs/architecture/runtime-ownership.md`, `internal/admission`, `internal/gate`, `internal/crafty`

Crafty actions are the only lifecycle surface. Every Crafty JVM execution command passes through the admission wrapper. Running processes are not stopped automatically by `mcctl`.
