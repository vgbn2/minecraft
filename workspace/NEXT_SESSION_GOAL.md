# Next Session Goal

Qualify the beta control plane through non-live testing, load/logging analysis, and concurrency stress before any Crafty or Minecraft deployment.

1. Build API, gate, monitor, alert, corruption, and ownership integration fixtures around a fake Crafty HTTPS server and disposable filesystem/state roots.
2. Stress simultaneous UI/API/CLI-equivalent starts: prove one reservation wins, rejection reasons remain deterministic, SQLite stays consistent, and locks recover after failures.
3. Exercise stale snapshots, missing metrics, corrupt databases, reservation expiry, duplicate profiles, artifact/auth-mode drift, and monitor restart behavior.
4. Run bounded monitor load tests and record CPU/RSS, SQLite growth, WAL/checkpoint behavior, 30-second sampling latency, pruning, and log volume. Target less than 50 MiB RSS and less than 1% average CPU without weakening failures.
5. Add structured/redacted logging tests for API errors, admission rejection, alert transitions, notification failures, and unmanaged Java detection. No token, webhook, SMTP secret, player identifier, or filesystem-sensitive value may leak.
6. Add notification mock tests plus temporal hysteresis, deduplication, and 30-minute reminder coverage. Keep real Brevo/Discord delivery disabled.
7. Produce a beta qualification report that separates unit, race, integration, load, logging, and concurrency evidence from deployment/runtime evidence.

World recovery remains an independent NO-GO gate: do not install/start Crafty, start Minecraft, synthesize dimensions, deploy services, alter tunnels, or expose administration. The matching Nether/End and complete server root still must be recovered before disposable migration testing.
