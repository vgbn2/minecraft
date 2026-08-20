# Crafty-Managed Minecraft Servers

This repository defines a Crafty-based control plane for an existing Paper 1.21.11 world and a separately qualified Fabric 1.21.11 server. Crafty is the sole catalog and lifecycle authority. `mcctl` supplies immutable profiles, Crafty API access, a fail-closed JVM admission wrapper, lightweight monitoring, alerts, and audits.

Start with [the canonical documentation](docs/README.md). The legacy Docker files are retained only as current-server rollback and migration evidence; `mcctl` no longer renders or owns Compose projects.

## Source verification

```bash
make verify
./tools/go.sh go run ./cmd/mcctl config validate --file examples/mcctl.config.json
./tools/go.sh go run ./cmd/mcctl profile validate --file examples/profiles/paper-1.21.11-standard.json
./tools/go.sh go run ./cmd/mcctl profile validate --file examples/profiles/fabric-1.21.11-standard.json
```

These checks do not install Crafty, start Java, touch worlds, perform backups, deploy to the HP Desk, qualify recovery, or prove a soak.
