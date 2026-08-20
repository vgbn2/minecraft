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

## 2026-08-20 visible CLI demonstration

Evidence class: local tool-runtime only. No Crafty connection, Minecraft process, world path, service, container, or remote host was accessed.

| Surface | Entrypoint and mode | Expected evidence | Observed result | Status | Residual limitation |
| --- | --- | --- | --- | --- | --- |
| CLI identity | `./dist/mcctl --json version` | Successful JSON envelope with CLI and Crafty contract versions | `ok: true`; mcctl `0.2.0-crafty`; Crafty OpenAPI `2.0.1` | Pass | Does not prove Crafty is installed or reachable |
| User-visible controls | `./dist/mcctl help` | Current supported command list | Printed config/profile, Crafty, monitor, health, alerts, audit, gate, and Atlas controls | Pass | CLI only; no web dashboard exists in this repository |
| Approved Paper profile | `./dist/mcctl --json profile validate --file examples/profiles/paper-1.21.11-standard.json` | Approved immutable profile parses and hashes | `ok: true`; Paper profile `paper-1-21-11-authme`; 2048/4096 MiB heap; digest `3d0ca2fb13d55935daeb161ccf97c0855e43eb6048560abaf8bf887b33c568d6` | Pass | No artifact, plugin, server root, or runtime was exercised |
| Repository map | `./dist/mcctl atlas check --root .` | Tracked inventory and links match current source | `atlas inventory and links are current` | Pass | Source-navigation evidence only |

## 2026-08-20 web version-picker preflight

Evidence class: source inspection only. No image was pulled and no container, Crafty service, Minecraft server, port, world path, or public endpoint was created or started.

| Surface | Entrypoint and mode | Prerequisites | Expected evidence | Observed result | Status | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| Crafty web server builder | Disposable loopback-only Crafty dashboard | Explicit authorization to download/start Crafty; isolated empty config/server/backup roots | Browser can sign in, open Create Server, and select a supported version without touching canonical worlds | Repository has no installed/running Crafty dashboard or disposable dashboard manifest; installation remains deferred by current state | Blocked | With explicit authorization, create a pinned throwaway Crafty instance bound to loopback and exercise only empty server creation |
