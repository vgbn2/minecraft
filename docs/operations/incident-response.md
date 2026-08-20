# Incident Response

- Stale/corrupt monitor state: leave running servers alone, block starts, preserve the last alert sidecar, quarantine the database, rebuild, and require fresh samples.
- OOM, crash loop, unexpected restart: block new starts, preserve kernel/Crafty/server logs and profile identity, do not auto-kill or auto-restart repeatedly.
- Disk/inode exhaustion: block starts/backups, preserve `.partial` evidence, and require an administrator retention decision.
- Unmanaged Java: alert with PID/UID and a redacted executable class; keep command lines and filesystem roots out of diagnostics; never kill automatically.
- playit failure: report external reachability degraded while retaining local server health.
- AuthMe/Brevo/Discord failure: existing authenticated sessions continue; recovery/notification is degraded and recorded.
- Clock drift: block starts and scheduled security/backup work until NTP is healthy.
- Plugin/mod failure: reproduce in a disposable copy and return to the previous immutable profile.
