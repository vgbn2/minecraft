# Function and Process Map

## Active commands

| Domain | Canonical owner | Trigger and contract | Side effects and recovery | Direct verification | Decision |
| --- | --- | --- | --- | --- | --- |
| CLI envelope and dispatch | `internal/app.Run` and `dispatch` | One `mcctl` invocation; stable human or JSON response and exit code | Writes only through the selected command; cancellation follows the caller context | `internal/app/app_test.go` | Keep the small public coordinator; command families live in sibling files. |
| Crafty API | `internal/crafty.Client` | CLI, monitor, or audit request with bearer token loaded per request | Loopback/Tailscale HTTPS only; bounded response decode; caller receives sanitized failures | `internal/crafty/client_test.go` | Keep as the only Crafty HTTP adapter. |
| Start admission | `internal/admission.Evaluate` | Immutable profile, current snapshot, and reservations | Pure fail-closed decision with sorted reasons | `internal/admission/admission_test.go` | Keep as the single policy owner. |
| Start execution | `internal/startgate.Authorize` plus `app.gateCommand` | `gate check` or Crafty-owned `gate exec` | Global file lock, SQLite reservation, runtime artifact checks, then process replacement; matching failed execs release immediately and TTL recovers abandoned reservations | gate, lock, monitor, startgate, and app integration tests | Keep `startgate` as the cycle-safe orchestration owner and `internal/gate` as runtime-verification owner. |
| Monitor recovery | `monitor.Quarantine` through `monitor recover` | Explicit confirmation while holding the operation lock | Renames database, WAL, SHM, and snapshot; starts remain blocked until a fresh sample | `internal/monitor/store_test.go` | Keep explicit and non-automatic. |

## Background processes

| Process | Owner and lifecycle | Inputs and outputs | Concurrency, pacing, and degraded behavior | Verification |
| --- | --- | --- | --- | --- |
| Monitor sample | `mcctl monitor sample`, invoked by `mcctl-monitor.timer` | Linux/Crafty probes to SQLite WAL, metric rollups, alert state, structured diagnostics, and atomic snapshot v2 | One systemd oneshot every 30 seconds; SQLite serializes writes; durable attempt state limits reminders to one per 30 minutes even without successful delivery; redacted probe issues mark the snapshot unhealthy and block starts | monitor integration, restart, retention, load, and redaction tests |
| Crafty server lifecycle | Crafty Controller | Crafty catalog and approved execution command to `mcctl gate exec` | Crafty owns start/stop; `mcctl` never supervises or automatically kills Java | fake Crafty contract tests only until deployment is separately authorized |

The generic command runner and backup policy remain honest unavailable seams for later notification and backup execution batches. They are not alternate lifecycle owners.
