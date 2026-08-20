# Official Source Ledger

Refreshed 2026-08-20.

| Source | Pinned fact or decision |
| --- | --- |
| [Crafty releases](https://gitlab.com/crafty-controller/crafty-4/-/releases) | 4.10.8 is the current reviewed release candidate; it contains a security upload-handler fix. Recheck at deployment. |
| [Crafty Linux install](https://docs.craftycontrol.com/pages/getting-started/installation/linux/) | Native unprivileged install layout and service account baseline. Review rather than blindly run the installer. |
| [Crafty API v2](https://docs.craftycontrol.com/pages/developer-guide/api-reference/v2/) | OpenAPI 3.0.4 document, API version 2.0.1, SHA-256 `bfadb88c...18dfb3b`; servers, stats, and action endpoints. |
| [Crafty OpenMetrics](https://docs.craftycontrol.com/pages/user-guide/open-metrics/) | `/metrics`, `/metrics/host`, and UUID-based `/metrics/servers/{serverID}` require protected bearer access. |
| [Paper downloads](https://docs.papermc.io/misc/downloads-service/) | Use stable builds and a descriptive User-Agent; no unattended production auto-updates. |
| [Paper spark](https://docs.papermc.io/paper/profiling/) | Use bounded administrator-approved profiling, not continuous spark captures. |
| [Fabric metadata](https://meta.fabricmc.net/) | Stable 1.21.11 loader 0.19.3 and installer 1.1.2 candidates; exact launcher hash recorded in the profile. |
| [AuthMe releases](https://github.com/AuthMe/AuthMeReloaded/releases/tag/6.0.0) | Paper 1.21+ specific AuthMe 6.0.0 and Java 21; PacketEvents 2.x is required for selected protections. |
| [PacketEvents releases](https://github.com/retrooper/packetevents/releases/tag/v2.13.0) | Pinned Spigot/Paper dependency asset and SHA-256. |
| [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) | Later outbound-only administration path behind Access. |

The complete upstream Crafty YAML was inspected during implementation. The repository stores a small required-endpoint contract rather than an unreviewed generated client.
