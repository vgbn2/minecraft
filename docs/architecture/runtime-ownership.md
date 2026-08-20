# Runtime Ownership

## Canonical owners

| Concern | Owner |
| --- | --- |
| Servers, process lifecycle, schedules, users, console, logs, backup jobs | Crafty |
| Approved type/version/Java/artifact/JVM/security bundle | Immutable profile JSON |
| Start authorization and global operation exclusion | `mcctl gate exec` |
| Host/server history, current snapshot, alert state | `mcctl monitor` SQLite |
| Notification delivery | monitor notifier adapters; delivery failure is recorded only |

## Preflight classification of the staged Go scaffold

| Existing subsystem | Classification | Disposition |
| --- | --- | --- |
| CLI JSON envelope, config/profile loading, validation | Reusable | Migrated to Crafty schema v2. |
| Code Atlas checker | Reusable | Retained as a workspace drift aid. |
| Safe archive-path and stopped-state policy | Reusable, incomplete | Retained; execution awaits the backup batch. |
| SQLite tenant/profile/lease catalog | Conflicting | Removed. Crafty is the catalog. SQLite now stores monitoring, reservations, and alerts only. |
| Compose renderer and per-tenant container lifecycle | Conflicting | Removed from `mcctl`; legacy Compose remains rollback material only. |
| Tenant archive/purge state machine | Obsolete | Removed; it does not apply to Crafty server ownership. |
| Generic command-runner interface | Canonical seam | Retained for later notification/backup adapters. |
| `workspace/code-atlas` architecture | Superseded | Kept as historical evidence; this tree is canonical. |

Preflight decision: **GO WITH FIXES**. No competing lifecycle or catalog command remains in the CLI.
