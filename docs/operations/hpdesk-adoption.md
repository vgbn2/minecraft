# HP Desk Adoption Runbook

This is a maintenance-window procedure, not authorization to run it.

1. Record host CPU/RAM/storage/PSI/load, Crafty/playit/Tailscale/time state, active Java/container processes, mounts, UIDs, ports, and rollback owner.
2. Prove the authoritative Overworld, `world_nether`, and `world_the_end` paths. Stop the legacy Paper container cleanly and prove exit.
3. Create an immutable archive containing all dimensions, properties/config, plugins and data, image digest, exact Java command, logs, ownership, timestamps, and checksums. Never infer container writable-layer state.
4. Install the reviewed pinned Crafty release as an unprivileged account and apply the reviewed service unit. Keep the UI loopback/Tailscale-only.
5. Import a disposable copy first. Verify seed, UUIDs, inventories, advancements, operators, bans, whitelist, AuthMe, port 25565, and all dimensions.
6. Configure the Crafty execution command through `mcctl gate exec`; audit that no direct Java start path remains. Disable Crafty auto-start until the reboot sequence is qualified.
7. Cut over Paper, verify local status and the actual playit hostname, complete a disposable restore drill, then begin the 24-hour soak.
8. Preserve the stopped legacy container and archive until two restore drills and the adoption soak pass.

Fabric on 25566 is a later batch: qualify its immutable copy, independent playit tunnel, pressure rejection, staggered reboot start, simultaneous workload, and 48-hour soak.
