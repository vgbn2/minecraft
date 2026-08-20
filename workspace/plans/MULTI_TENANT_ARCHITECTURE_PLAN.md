# Multi-Tenant Minecraft Control Plane Architecture

Status: superseded by `docs/`; retained as prior planning evidence

## Objective

Evolve this single Paper server repository into a trusted-admin control plane for isolated Minecraft tenants on one Docker host. One tenant owns one container, data root, network, port lease, numeric UID, immutable server profile, operation history, and backup chain.

The first implementation produces documentation, a Code Atlas, and a compiling read-only Go scaffold. It does not provision tenants, start containers, move current worlds, or transfer backups.

## Current evidence

- The repository contains one Dockerfile and one Compose service.
- The current Compose file persists `./data` only at `/opt/minecraft/world`; authoritative Nether and End ownership has not been proved.
- Local world, player, secret, cache, log, dependency, and JAR paths are excluded from Git.
- The host has 12 CPUs and approximately 26 GiB RAM, but resource allocation remains profile-specific and host admission limits must be configured explicitly.
- The installed host Go compiler reports legacy Go 1.18; reproducible builds therefore use a pinned Go toolchain container.

## Decision questionnaire

| Question | Decision | Architectural consequence |
| --- | --- | --- |
| What is one tenant? | One isolated Paper server | No shared JVM or plugin-based tenant boundary. |
| First deployment target? | One Docker host | No scheduler, remote agents, or Kubernetes in v1. |
| Initial operator? | Trusted local administrator CLI | No public API, browser auth, or tenant accounts. |
| Control-plane language? | Go | Function-oriented packages and compiled CLI. |
| Catalog? | SQLite | Transactional leases and durable operation metadata. |
| Runtime owner? | One Compose project per tenant | Auditable generated Compose with explicit project names. |
| Lifecycle target? | Full safe lifecycle | Create through verified purge is designed, then implemented in gated batches. |
| Version/plugin policy? | Approved immutable profiles | Tenants cannot request arbitrary downloads. |
| Network default? | Explicit configured LAN address | No implicit all-interface exposure. |
| Immediate deliverable? | Plan plus compiling scaffold | Runtime mutations remain unavailable. |
| Backup authority? | Local staging plus verified off-host copy | A local archive alone is not disaster recovery. |
| Resource policy? | Profile-specific | Host cap and memory reserve are mandatory configuration, not defaults. |
| Toolchain? | Pinned Go build container | No host Go upgrade is required. |
| Backup consistency? | Server must be stopped | No unproved online snapshot behavior. |
| Off-host transport? | Rsync over SSH | Remote temporary upload, verification, then atomic promotion. |
| Purge contract? | Verified backup plus typed ID | Archive, inventory, verified off-host copy, and confirmation are required. |
| Agent context model? | Tracked Code Atlas | No nested Git repository or runtime-data mirror. |
| Atlas granularity? | Folders plus key files | High-value context without one page per generated config. |
| Atlas maintenance? | Generated inventory plus curated pages | Drift is machine-checked without overwriting explanations. |

## Deferred user questions

These do not block the scaffold or single-host v1:

- When should multi-host scheduling be introduced?
- Will tenant self-service, billing, quotas, or a web panel ever be required?
- Should a future proxy provide a shared public endpoint and authenticated forwarding?
- Which approved resource profiles and plugin bundles should be activated first?
- Which SSH host and retention policy will become the production off-host backup target?

## System boundaries

```text
mcctl CLI
  -> procedural application functions
     -> validation, policy, and admission checks
     -> SQLite catalog and atomic leases
     -> Compose rendering and command execution
     -> backup, checksum, and SSH transfer procedures
  -> Docker, tenant storage, and off-host storage
```

SQLite owns desired administrative state. Docker is queried for observed runtime state. Generated Compose is a reproducible projection, not an independent source of truth.

Administrative tenant state is `active` or `archived`. Observed runtime state is `absent`, `stopped`, `running`, `degraded`, or `unknown`; it is never trusted from a stale database field.

## Procedural Go architecture

Packages group functions by responsibility: configuration, models, validation, catalog/migrations, profiles, leases, Compose rendering, lifecycle, backup, host inspection, command execution, and atlas checking. Structs are data carriers. Interfaces exist only at external boundaries such as clock, filesystem, process runner, Docker/Compose, and SSH.

Top-level command functions follow the same order:

1. Parse explicit input.
2. Load and validate configuration/profile data.
3. Read observed host/runtime state.
4. Evaluate policy and preconditions.
5. Build a deterministic plan.
6. Return the plan for `--dry-run` or execute it only in a later authorized implementation.
7. Record a structured result without hiding partial failure.

## Public CLI contract

The designed v1 commands are:

- `mcctl config validate`, `profile validate`, `profile list`, and `doctor`
- `mcctl tenant plan-create`, `create`, `list`, and `inspect`
- `mcctl tenant start`, `stop`, and `restart`
- `mcctl backup create`, `verify`, and `restore --as <new-tenant>`
- `mcctl tenant archive` and `purge --confirm <tenant-id>`
- `mcctl atlas check` and `atlas sync`

The scaffold exposes only version/help, validation, doctor, plan-create, and atlas commands. Unsupported mutations fail honestly. Every future mutation supports `--dry-run`. JSON output uses one stable envelope containing `ok`, `command`, `data`, `warnings`, and a structured `error`.

Tenant IDs match `^[a-z][a-z0-9-]{2,31}$`. Display names are separate. Bind addresses must be concrete, non-unspecified IP addresses. Ports and UIDs come from configured ranges and are leased transactionally.

## Catalog and profile model

The catalog contains forward-only schema migrations, profiles, tenants, port leases, UID leases, append-only operations, and backups. Allocation uses immediate transactions and uniqueness constraints.

Approved profile JSON pins Paper version/build/download hash, Java version, image identity, plugin artifacts and hashes, online-mode policy, CPU limit, container memory, and JVM heap. A tenant stores the profile file digest, so editing a profile creates a new identity rather than silently changing existing tenants.

Host configuration must explicitly provide state and tenant roots, backup staging root, LAN bind address, port/UID ranges, managed-memory cap, available-memory reserve, and SSH destination. Missing safety values are validation errors.

## Tenant runtime projection

Compose project names are `mc-<tenant-id>`. Each projection includes ownership labels, profile digest, generation, isolated network, numeric non-root UID/GID, explicit LAN port binding, CPU/memory limits, no Docker socket, and no mounts outside the tenant root.

The future Paper image keeps `server.jar` in an immutable image directory and runs with `/data` as the writable server root. One tenant `/data` mount then persists Overworld, Nether, End, configs, plugins, and server metadata together. The existing world layout is not migrated until its authoritative paths are audited.

## Backup, restore, and deletion contract

A backup requires observed stopped state. It rejects symlinks, devices, sockets, path traversal, and unexpected ownership. The procedure writes a manifest, creates an atomic compressed archive, hashes it, transfers it to a remote temporary name over rsync/SSH, verifies remote size and hash, and atomically promotes it.

Restore always targets a new tenant ID and empty directory. It verifies manifest schema, profile identity, checksum, safe paths, and available leases before extraction. In-place restore is outside v1.

Archive is reversible and never deletes data. Purge requires archived state, a verified off-host backup, a generated deletion inventory, and exact typed tenant-ID confirmation. Failures retain data and an operation record.

## Security and failure policy

- Do not expose the Docker socket inside tenant containers.
- Do not accept arbitrary image, plugin, or download URLs from tenant input.
- Do not default to `0.0.0.0` or disable Minecraft authentication.
- Do not claim backup safety until off-host hash verification and a restore test pass.
- Use atomic writes, bounded external-command timeouts, structured errors, and append-only operation records.
- Refuse starts that violate configured aggregate limits or available-memory reserve.
- Treat missing Docker, SSH, profile, database, or filesystem evidence as unavailable, never healthy.

## Ranked delivery batches

1. Architecture document, questionnaire, official reference ledger, and post-research refinement.
2. Code Atlas pages plus deterministic inventory/check command.
3. Pinned Go toolchain, CLI shell, validation, SQLite migrations, deterministic planning, and Compose rendering.
4. Persistence audit and explicit current-world import plan.
5. Create/start/stop lifecycle with source and non-live integration proof.
6. Stopped-server backup, off-host verification, restore-to-new, archive, and purge.
7. Host deployment, recovery drill, and bounded soak as separate evidence layers.

## Acceptance gates

- Pinned-container `go test ./...`, `go vet ./...`, and binary build pass.
- Atlas inventory is deterministic, links resolve, key files are covered, and ignored/runtime paths are absent.
- SQLite migration, rollback, lease contention, validation, and corrupt-state tests pass.
- Compose fixtures render deterministically and pass `docker compose config --quiet` without starting containers.
- Security tests reject unspecified binds, invalid IDs, unsafe paths, missing resource caps, and unapproved artifacts.
- Repository secret scan, `git diff --check`, and clean tracked snapshot pass.

These gates are source/scaffold evidence only. They do not prove image build, tenant startup, deployment, world recovery, off-host recovery, or soak behavior.

## Revision log

- 2026-08-20 initial refinement: replaced the single-server checklist with the answered multi-tenant architecture.
- 2026-08-20 research refinement: selected Go 1.27 tooling compatible with the SQLite driver, separated Compose projection from SQLite authority, made stopped-server backups mandatory, and preserved Docker/runtime/recovery evidence boundaries.
