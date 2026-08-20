# World Persistence Audit — 2026-08-20

Scope: read-only inspection on host `steamlinux`, Docker context `default`. No container, server, copy, move, archive, or world mutation was performed.

## Findings

- `docker compose ps --all` returned no project containers; `docker inspect minecraft` returned `no such object`.
- A host-wide stopped/running container list contained no Minecraft container, and the local image list contained no Minecraft/Paper image.
- Compose maps `./data` to `/opt/minecraft/world` only. Nether and End would have remained at `/opt/minecraft/world_nether` and `/opt/minecraft/world_the_end` in the container writable layer.
- `data/` is 16 MiB and changed through 11:29. It contains four Overworld region files and one player-associated advancement/stat record. No player identifier is recorded here.
- Host siblings `world/`, `world_nether/`, and `world_the_end/` are approximately 2.2–2.3 MiB and stopped changing at 11:06.
- Local logs prove the sibling set came from a fresh local run: `No existing world data, creating new world` at 10:59, clean starts, and a clean save/stop at 11:06. The server initialized zero plugins.
- The ignored `server.properties` currently records `level-name=world`, `online-mode=false`, port 25565, and RCON disabled.
- No `level.dat` file was found in any of the four inspected trees. This must be explained by the exact Paper storage layout or recovered server-root metadata before import.

## Decision

**NO-GO for Paper migration or Crafty startup.** The local sibling Nether/End trees are not proven to belong to the later `data/` Overworld. The original container writable layer, a pre-removal export, an HP Desk copy, or another verified backup is required. Treating the sibling trees as authoritative would risk silently pairing dimensions from different server runs.

## First safe next action

Locate the actual host/container or backup that produced `data/` and recover its complete server root, especially `world_nether`, `world_the_end`, root metadata, logs, plugin data, and image/command identity. Compare timestamps, world identifiers, region inventories, and checksums before making an immutable archive. If no matching dimensions exist, stop and obtain an explicit loss/reconstruction decision; do not generate replacements automatically.
