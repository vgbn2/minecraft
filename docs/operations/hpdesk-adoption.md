# HP Desk Adoption Runbook

This is a maintenance-window procedure, not authorization to run it.

## Management-code release sync

The currently running Paper 1.21.11 container uses `/opt/minecraft` as its
Compose working directory. Its host `data/`, `config/`, `plugins/`, and
`server.properties` paths are writable mounts. A repository sync must therefore
never target `/opt/minecraft/` itself and must never use `--delete` there.

Management code belongs in isolated, immutable release directories below
`/home/vgbn-server/Documents/codeptit/minecraft/releases/<commit>/`. This
keeps the repository with the host's other code while leaving `/opt/minecraft`
runtime-only. The current Paper container does not consume this source path.
No application user or server account is created by this procedure.

The procedure is deliberately linear:

1. Derive a release identifier from the checked-out commit.
2. Refuse to proceed unless the checkout is clean: a release directory named
   for a commit must contain exactly that commit's tracked content.
3. Refuse to proceed unless the destination is below the dedicated release
   root, never `data`, `config`, `plugins`, `server.properties`, or the Compose
   root.
4. Preview only tracked repository files; ignored runtime state is absent by
   construction.
5. Copy into the new, commit-named release directory. Do not overwrite a prior
   release and do not promote anything automatically.
6. Treat promotion, service configuration, container recreation, and cleanup
   of old releases as separate maintenance-window operations.

First preview the transfer from the repository root:

```bash
release_id="$(git rev-parse --verify --short=12 HEAD)"
release_root="/home/vgbn-server/Documents/codeptit/minecraft/releases"
remote="vgbn-server@100.122.7.7"

git diff --quiet && git diff --cached --quiet && \
  test -z "$(git ls-files --others --exclude-standard)" || {
    echo 'refusing sync: commit or remove all untracked and modified files first' >&2
    exit 1
  }

ssh -F /dev/null -o BatchMode=yes -o ConnectTimeout=15 "$remote" \
  "test \"$release_root\" = /home/vgbn-server/Documents/codeptit/minecraft/releases && \
   test \"$release_id\" != . && test \"$release_id\" != .. && \
   test ! -e \"$release_root/$release_id\" && \
   install -d -m 0750 \"$release_root\""

git ls-files -z | rsync -aHn --from0 --files-from=- --itemize-changes --stats --partial \
  -e 'ssh -F /dev/null -o BatchMode=yes -o ConnectTimeout=15' \
  ./ "$remote:$release_root/$release_id/"
```

The first command creates only the dedicated release root; it does not create a
server, user, world, or service. Inspect the itemized output and confirm its
destination is exactly
`/home/vgbn-server/Documents/codeptit/minecraft/releases/<commit>/`. Only then remove the `n`
from `-aHn` to copy. `git ls-files` transfers tracked management source only,
so ignored worlds, server properties, plugins, logs, secrets, JARs, and local
databases cannot be selected. Keep `--delete` absent. This is a source-code
release copy, not promotion, deployment, installation, runtime validation,
backup, or recovery evidence.

The clean-tree guard intentionally refuses the current checkout while it has
uncommitted documentation or plan work. Commit the approved release first;
then its directory name and copied contents are reproducible.

1. Record host CPU/RAM/storage/PSI/load, Crafty/playit/Tailscale/time state, active Java/container processes, mounts, UIDs, ports, and rollback owner.
2. Prove the authoritative Overworld, `world_nether`, and `world_the_end` paths. Stop the legacy Paper container cleanly and prove exit.
3. Create an immutable archive containing all dimensions, properties/config, plugins and data, image digest, exact Java command, logs, ownership, timestamps, and checksums. Never infer container writable-layer state.
4. Install the reviewed pinned Crafty release as an unprivileged account and apply the reviewed service unit. Keep the UI loopback/Tailscale-only.
5. Import a disposable copy first. Verify seed, UUIDs, inventories, advancements, operators, bans, whitelist, AuthMe, port 25565, and all dimensions.
6. Configure the Crafty execution command through `mcctl gate exec`; audit that no direct Java start path remains. Disable Crafty auto-start until the reboot sequence is qualified.
7. Cut over Paper, verify local status and the actual playit hostname, complete a disposable restore drill, then begin the 24-hour soak.
8. Preserve the stopped legacy container and archive until two restore drills and the adoption soak pass.

Fabric on 25566 is a later batch: qualify its immutable copy, independent playit tunnel, pressure rejection, staggered reboot start, simultaneous workload, and 48-hour soak.
