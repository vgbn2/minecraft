# Monitoring and Admission

`mcctl monitor sample` reads Linux host memory, load, CPU counters, PSI, storage/inodes, NTP state, Crafty server inventory, and per-server stats. It writes SQLite in WAL/FULL-sync mode, updates UTC five-minute and daily metric rollups, performs a passive checkpoint, and promotes the current JSON snapshot atomically. The systemd timer runs every 30 seconds. Raw samples retain 48 hours; five-minute rollups retain 30 days; daily rollups retain 180 days.

Snapshot schema v2 adds redacted `{code, component}` collection issues. Readers accept historical schema v1 snapshots, which have no issue list. Probe, API, admission, alert, notification, and diagnostic-state logs use stable structured event codes and exclude raw response bodies, credentials, player identifiers, command lines, and filesystem paths.

Every Crafty execution command must be exactly:

```text
/usr/local/bin/mcctl gate exec --config /etc/mcctl/config.json --profile /etc/mcctl/profiles/<profile>.json -- /usr/bin/java <approved JVM arguments>
```

The gate verifies the caller UID, profile, server root, JAR SHA-256, JVM heap flags, snapshot age/health, Crafty/NTP state, maintenance/operation state, storage, PSI, swap-out, CPU/load, current heaps, and unexpired reservations under one nonblocking `flock`. It then records a five-minute reservation, releases the lock, and replaces itself with Java. It does not supervise Java.

Admission rejects stale/unavailable evidence; projected `MemAvailable` below 3 GiB after Xms plus 512 MiB; combined Xmx above 6656 MiB; critical PSI; swap-out above 10 MiB/min for three samples; load above 6; CPU above 90% for five minutes; storage below configured minima; an operation/start already in progress; or an already-running target. Existing Java processes continue.

Critical findings activate immediately. Warnings require two consecutive samples, and recovery requires two consecutive clear samples. Durable attempt state suppresses duplicate transitions and limits active reminder eligibility to once every 30 minutes even when no notifier is configured or delivery fails; successful-delivery time remains separate. The source exposes an internal notifier interface with mock-tested success/failure recording; no Brevo or Discord adapter or delivery is active.

If Java lookup or process replacement fails after reservation, the gate removes only the reservation matching that server and PID. The five-minute TTL remains the crash-recovery boundary for a process that disappears before cleanup.
