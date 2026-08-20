# Network and Security

Crafty binds to loopback or Tailscale only. The backend port, API, OpenMetrics, SQLite, RCON, SSH, SMTP secrets, Discord webhook, and tokens are never public. Before a stable domain, administration is Tailscale-only with named users, TOTP, and recovery codes. Cloudflare Tunnel/Access is a later outbound-only gate; a Tailscale recovery path remains.

Public status is allowlisted to server name, type/version, online state, MOTD, and player count. It excludes usernames, addresses, host metrics, paths, logs, alerts, and identities.

## Paper offline authentication

Only the Paper profile may set `online-mode=false`. It pins the Paper-specific AuthMe 6.0.0 JAR and PacketEvents 2.13.0 dependency. Deployment must verify registration/login blocks movement, chat, commands, inventory, damage, and world access. AuthMe account storage is per server. Brevo recovery uses generic responses, rate limits, TLS identity verification, and a secret file. A cracked username never grants operator or Crafty authority. Fabric, Vanilla, Forge, and NeoForge stay online-mode.

Secrets are service/root-readable `0600` files and excluded from diagnostics, backups reports, and version control.
