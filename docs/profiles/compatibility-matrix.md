# Compatibility Matrix

| Profile | Source pin | Auth | JVM | Port | Status |
| --- | --- | --- | --- | --- | --- |
| Paper 1.21.11 | stable build 132, SHA-256 pinned; AuthMe 6.0.0 Paper + PacketEvents 2.13.0 | Offline/AuthMe | 2 GiB / 4 GiB | 25565 | Source profile valid; disposable migration/auth/load/restore and HP Desk soak pending. |
| Fabric 1.21.11 | loader 0.19.3, installer 1.1.2 launcher SHA-256 pinned | Mojang online | 1 GiB / 2.5 GiB | 25566 | Source profile valid; isolated server and two-server qualification pending. |

## Paper 1.21.11

The upstream artifacts claim compatible platform support. That is not local compatibility evidence. Approval for production remains gated on the Batch C tests, including every pre-auth restriction and copied-world integrity.

## Fabric 1.21.11

Fabric metadata marks Minecraft 1.21.11, loader 0.19.3, and installer 1.1.2 stable. Production remains gated on an isolated boot and the Batch E soak.

Vanilla, Forge, NeoForge, other versions, and bundles are absent until an immutable profile and disposable qualification exist. “All versions” means provider-supported versions may be added on demand.
