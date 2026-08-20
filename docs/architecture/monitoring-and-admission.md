# Monitoring and Admission

`mcctl monitor sample` reads Linux host memory, load, CPU counters, PSI, storage/inodes, NTP state, Crafty server inventory, and per-server stats. It writes SQLite in WAL/FULL-sync mode and promotes the current JSON snapshot atomically. The systemd timer runs every 30 seconds. Raw samples retain 48 hours; five-minute rollups retain 30 days; daily rollups retain 180 days.

Every Crafty execution command must be exactly:

```text
/usr/local/bin/mcctl gate exec --config /etc/mcctl/config.json --profile /etc/mcctl/profiles/<profile>.json -- /usr/bin/java <approved JVM arguments>
```

The gate verifies the caller UID, profile, server root, JAR SHA-256, JVM heap flags, snapshot age/health, Crafty/NTP state, maintenance/operation state, storage, PSI, swap-out, CPU/load, current heaps, and unexpired reservations under one nonblocking `flock`. It then records a five-minute reservation, releases the lock, and replaces itself with Java. It does not supervise Java.

Admission rejects stale/unavailable evidence; projected `MemAvailable` below 3 GiB after Xms plus 512 MiB; combined Xmx above 6656 MiB; critical PSI; swap-out above 10 MiB/min for three samples; load above 6; CPU above 90% for five minutes; storage below configured minima; an operation/start already in progress; or an already-running target. Existing Java processes continue.

Warnings and critical findings use the thresholds in the approved plan. Delivery adapters must apply hysteresis, deduplication, and 30-minute reminders. The current source implements threshold evaluation and durable alert tables; Brevo/Discord delivery is not activated until mock and secret-redaction tests pass.
