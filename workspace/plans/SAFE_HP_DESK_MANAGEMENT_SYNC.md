# Safe HP Desk Management Sync

Status: proposed documentation-only procedure; not yet applied on HP Desk.

## Objective

Allow repeatable procedural transfer of this repository's tracked management
code under `/home/vgbn-server/Documents/codeptit/minecraft` without modifying
the running Paper 1.21.11 server's world or its writable configuration paths.

## Current evidence

On 2026-08-20, the `minecraft` container on HP Desk was running from Compose
working directory `/opt/minecraft`. Its writable bind mounts were:

| Host path | Container path | Safety classification |
| --- | --- | --- |
| `/opt/minecraft/data` | `/opt/minecraft/world` | Live Overworld; never sync management code here |
| `/opt/minecraft/config` | `/opt/minecraft/config` | Live server configuration; do not update while running |
| `/opt/minecraft/plugins` | `/opt/minecraft/plugins` | Live plugin state/binaries; do not update while running |
| `/opt/minecraft/server.properties` | `/opt/minecraft/server.properties` | Live server configuration; never overwrite |

The container had been running for roughly 35 hours and was listening on TCP
25565. This is host observation, not recovery or deployment qualification.

## Proposed ownership layout

```text
/home/vgbn-server/Documents/codeptit/minecraft/
└── releases/
    └── <commit>/               # immutable tracked-source copy; management-owned

/opt/minecraft/
├── data/                       # existing live world mount; runtime-owned
├── config/                     # existing live configuration mount; runtime-owned
├── plugins/                    # existing live plugin mount; runtime-owned
├── server.properties           # existing live configuration; runtime-owned
└── docker-compose.yml          # current legacy Compose root; do not sync over it
```

`/home/vgbn-server/Documents/codeptit/minecraft/releases/<commit>` is the only
allowed rsync destination. A release sync may create that new directory but
must never update, delete, move, or read world/player data. There is no
automatic `current` symlink, service rewire, container recreation, or removal
of old releases.

## Procedural contract

Inputs: a local Git commit, its `git ls-files` manifest, and an unused release
directory name.

Outputs: one new remote immutable management-source directory, or a nonzero
failure with no release content copied.

Guards, in order:

1. The destination root is the literal
   `/home/vgbn-server/Documents/codeptit/minecraft/releases`, not an
   interpolated runtime path.
2. The local checkout has no modified, staged, or untracked files; its release
   name therefore identifies the exact copied content.
3. The release name comes from a validated commit hash and the destination must
   not already exist.
4. `git ls-files` supplies the transfer manifest, excluding ignored runtime
   state by construction.
5. `rsync -n` supplies a human-reviewed preview before the write run.
6. No command uses `--delete`.
7. Promotion needs separately authorized maintenance-window work and must prove
   a rollback target before touching the legacy Compose/service configuration.

## Acceptance criteria

- A dry run shows files only beneath
  `/home/vgbn-server/Documents/codeptit/minecraft/releases/<commit>/`.
- A dirty checkout fails before opening an rsync session; the copied file set
  can always be reconstructed from its release commit.
- The source manifest contains no ignored runtime data or local secrets.
- The existing container remains running with the same mounts and port during
  both preview and copy.
- The procedure has no command that targets `/opt/minecraft/` as a sync
  destination, invokes Docker Compose, stops Java, or changes a service.
- A failed preflight or transfer leaves the existing Paper runtime untouched.

## Deferred work

- Creating an application user, permission model, or Crafty users.
- Promoting a release to a service, changing Compose, or recreating a
  container.
- Importing/recovering world data, backups, tunnels, external exposure, or a
  restart/rollback/soak qualification.
- Retention and deletion policy for old management releases.
