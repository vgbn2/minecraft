# System Architecture

```text
administrators -> Crafty UI/API -> Crafty server record -> mcctl gate exec -> Java
                         ^                 |
mcctl API client -------+                 +-> immutable profile
mcctl monitor -> Crafty API/OpenMetrics + Linux host -> SQLite WAL + atomic snapshot
atomic snapshot + reservations -> admission -> allow or deterministic rejection
```

Crafty 4.10.8 is the reviewed source candidate as of 2026-08-20. Deployment must pin its tag/commit, source-archive checksum, Python lock/dependencies, Java 21 path, and native systemd unit. The repository does not install or start it.

The HP Desk is the production target; Steamlinux is only a disposable local qualification environment. Hardware observations must be recorded per host and never copied between them. Minecraft starts with 4 GiB Paper plus 2.5 GiB Fabric maximum heap, inside a 6.5 GiB aggregate policy and Crafty cgroup `MemoryHigh=8G`, `MemoryMax=9G`.

Running servers are never killed automatically for pressure. Pressure blocks new starts and raises alerts.
