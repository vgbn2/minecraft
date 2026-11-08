# Runtime Ownership & Multi-Tenant Hierarchy

## Canonical Ownership Hierarchy

The management model establishes strict hierarchical ownership to ensure multi-tenant isolation, clean boundaries, and deterministic lifecycles:

```text
User Membership (Roles & Permissions)
       │
       ▼
     Tenant (Isolated Namespace / Quota Domain)
       │
       ▼
     Server (Instance Managed by Crafty)
       │
       ▼
    World Set (Dimensions: Overworld, Nether, End + Seed)
       │
       ▼
Immutable Profile Revision (Approved Version, Java, JAR Hash, Flags)
```

1. **User Membership**: Users belong to tenants with assigned roles (Admin, Operator, Viewer). Users do not own servers or versions directly.
2. **Tenant**: Provides organizational boundary, resource quota allocation, and server grouping.
3. **Server**: An execution entity managed within Crafty Controller. **Versions belong to servers, not users**.
4. **World Set**: An isolated directory set containing the three dimensions (Overworld, Nether, End) and `level.dat`. A server binds to exactly one world set. Worlds are never shared across tenants or servers.
5. **Immutable Profile Revision**: Cryptographically pinned specification of Minecraft version, loader (Paper/Fabric), Java runtime, exact server JAR SHA-256 hash, and JVM memory/flag parameters.
6. **On-Demand Artifacts**: Server binaries, loaders, and plugins are cataloged in approved profile manifests and downloaded on demand into server instances, rather than being baked into container images.

---

## Component Responsibilities

| Concern | Canonical Owner | Boundary & Guarantee |
| --- | --- | --- |
| Server instances, process supervision, web console, user auth | **Crafty Controller** | Crafty is the sole catalog and lifecycle authority. No duplicate catalog in `mcctl`. |
| Approved version/Java/JVM/JAR profiles | **Immutable Profile JSON** | Pinned SHA-256 hashes, heap boundaries, and JVM flags. |
| Start admission & host protection | **`mcctl gate exec`** | Fail-closed pre-start gate. Replaces itself with Java; does not supervise. |
| Host metrics, rollups, WAL storage | **`mcctl monitor`** | Read-only metrics sampling, SQLite WAL with full-sync, atomic JSON snapshots. |
| Alert evaluation & notification | **`mcctl monitor alert`** | Hysteresis (2-sample trigger/recovery), deduplication, 30-min reminder throttle. |

---

## Edge Case & Safety Perimeter

- **Split-Brain World Protection**: Prevents pairing mismatched world folders (e.g. `data/` vs `world*`). Seed, level timestamps, and dimension IDs must match.
- **Fail-Closed Execution**: If SHA-256 hash does not match profile, or available memory is insufficient (< 3 GiB `MemAvailable` projected), `gate exec` aborts with exit code 2.
- **Startgate Flock Locking**: Non-blocking `flock` ensures atomic evaluation of admissions and prevents race conditions across concurrent server starts.
- **Process Cleanup**: Unexpired admissions reserve memory for 5 minutes. If Java fails to launch, the reservation matching the PID and server ID is purged immediately.

---

## Subsystem Disposition Ledger

| Subsystem | Classification | Disposition |
| --- | --- | --- |
| CLI JSON envelope, config/profile loading | Reusable | Migrated to Crafty schema v2. |
| Code Atlas checker | Reusable | Retained as a workspace drift aid (`mcctl atlas check`). |
| Safe archive-path and stopped-state policy | Reusable | Retained for backup/restore safety checks. |
| SQLite tenant/profile/lease catalog | Conflicting | Removed. Crafty is the sole catalog. SQLite stores only metrics, reservations, and alerts. |
| Compose renderer and container lifecycle | Conflicting | Removed from `mcctl`; legacy Compose retained for rollback evidence only. |
| Tenant archive/purge state machine | Obsolete | Removed; does not apply to Crafty server ownership. |
| Generic command-runner interface | Canonical seam | Retained for notification and verification adapters. |
