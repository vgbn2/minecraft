# Crafty Control-Plane Beta Qualification — 2026-08-20

Evidence class: current-checkout source, pinned-toolchain tests, and disposable local state only. This report is not Crafty installation, Minecraft runtime, HP Desk deployment, world recovery, notification delivery, restart/rollback, or soak evidence.

## Qualification matrix

| Layer | Evidence | Result |
| --- | --- | --- |
| Readability | `internal/app/app.go` split from 584 lines into cohesive command and runtime coordinators; function/process map added | Passed focused characterization and race tests |
| Unit and compatibility | Snapshot v1/v2, admission, runtime artifacts/auth mode, rollups, alert timing, corruption quarantine, duplicate profiles, redaction | Passed |
| API integration | Fake Crafty HTTPS list/stats/action and sanitized HTTP failure body | Passed; no external Crafty request |
| Concurrency | 24 simultaneous start authorizations with a shared lock and SQLite database | Exactly one reservation winner; other attempts failed closed |
| Failure recovery | Matching-PID reservation release, wrong-PID rejection, expiry, lock reuse, monitor reopen | Passed |
| Notifications | Mock notifier success/failure, hysteresis, deduplication, recovery, durable failed-attempt throttling, restart persistence, and 30-minute reminders | Passed; no real adapter exists or delivered |
| Load | 720 synthetic 30-second samples in disposable SQLite | 3.6613 s wall; 3.2266 CPU seconds; projected duty 0.0149%; peak RSS 35.19 MiB |
| Persistence | Load-gate database/WAL and rollups | DB 843,776 bytes; checkpointed WAL 552,112 bytes; 72 five-minute rollups; one daily rollup |
| Probe latency | 20 bounded Linux probe samples with fake empty Crafty API | 100.61 ms average, below the 30-second cadence |
| Structured-log volume | 1,000 healthy synthetic events | 53,000 bytes total; 53 bytes/event; exactly one JSON line/event |

## Safety and limitations

- Real Brevo and Discord delivery remain absent and disabled.
- The fake Crafty fixture does not qualify the reviewed Crafty build, its deployment, or its process lifecycle.
- No Minecraft/Crafty process, container, systemd unit, tunnel, backup, world, player data, or credential was started, changed, copied, or exposed.
- World adoption remains NO-GO until the matching Nether, End, and complete server-root evidence are recovered.
