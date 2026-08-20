# Feature Test Matrix

## 2026-08-20 Crafty beta source qualification

Evidence class: source and local tool-runtime only. No Crafty installation, Minecraft start, deployment, world mutation, backup/restore, notification delivery, or soak occurred.

| Surface | Evidence | Result | Remaining qualification |
| --- | --- | --- | --- |
| Go packages | `go test ./...` in pinned toolchain | Pass | Broader integration fixtures next session |
| Concurrency safety | `go test -race ./...`; flock and reservation tests | Pass | High-contention/multiprocess stress next session |
| Static correctness | `go vet ./...`; release build | Pass | Runtime profiling next session |
| Crafty contract | Downloaded OpenAPI 2.0.1 checksum and required endpoints | Pass | Fake-server error/rate/timeout matrix next session |
| Immutable profiles | Paper/AuthMe/PacketEvents and Fabric profile validation | Pass | Artifact deployment and disposable boot pending |
| Admission | Stale state, heap cap, reservations, inactive swap, command/hash/auth-mode tests | Pass | Pressure/load duration and start-storm integration pending |
| Monitor state | WAL initialization, reservations, atomic snapshot, corruption quarantine | Pass | Rollup/load/WAL growth and restart tests pending |
| Repository | Atlas/link check, legacy Compose parse, staged/unstaged diff checks, secret scan | Pass | Clean committed-archive check after commit |

The removed tenant-plan/Compose scaffold exercise is historical evidence in the dated handoff, not a current feature.
