# Official Reference Ledger (Superseded)

The current ledger is [`../../docs/references/official-sources.md`](../../docs/references/official-sources.md). This file is retained as prior research evidence.

Accessed: 2026-08-20

| Source | Decision supported | Applicability and caution |
| --- | --- | --- |
| [Go 1.27 release notes](https://go.dev/doc/go1.27) | Build the scaffold with Go 1.27. | The host compiler is older; use the pinned container instead of claiming host compatibility. |
| [Official Go image](https://hub.docker.com/_/golang) | Use the official Bookworm toolchain image. | Pin the image digest; an image pull is dependency acquisition, not a source test result. |
| [modernc SQLite v1.57.0 module](https://proxy.golang.org/modernc.org/sqlite/@v/v1.57.0.mod) | Use a non-CGO SQLite driver requiring Go 1.25 or newer. | Pin v1.57.0 and verify its license/dependency graph during implementation. |
| [Compose project names](https://docs.docker.com/compose/how-tos/project-name/) | Give each tenant an explicit isolated project name. | Project naming scopes Compose resources but is not a security boundary by itself. |
| [Compose service reference](https://docs.docker.com/reference/compose-file/services/) | Render explicit CPU, memory, user, mounts, health, and security settings. | `docker compose config` proves parsing only, not runtime enforcement. |
| [SQLite WAL](https://www.sqlite.org/wal.html) | Keep the catalog local and define checkpoint behavior. | Do not place the WAL catalog on an unsupported remote filesystem. |
| [SQLite backup API](https://www.sqlite.org/backup.html) | Use a consistent database-copy mechanism. | Copying a live database file directly is not accepted as backup proof. |
| [Paper getting started](https://docs.papermc.io/paper/getting-started/) | Keep Java/Paper compatibility explicit in approved profiles. | Version guidance changes; refresh before upgrades. |
| [rsync manual](https://download.samba.org/pub/rsync/rsync.1) | Use partial upload, verification, and delayed promotion deliberately. | Transfer success alone does not prove remote recoverability. |

## Research method

Prefer official specifications, vendor documentation, upstream release notes, and package metadata. Record access date and the exact architectural statement each source supports. Do not paste large documentation excerpts into the repository.
