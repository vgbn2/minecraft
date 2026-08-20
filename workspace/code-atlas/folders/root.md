# Repository Root

Purpose: source-controlled infrastructure, safe configuration, Go control plane, examples, tools, and workspace continuity.

Key entrypoints:

- `Dockerfile`: current single-server Paper image.
- `docker-compose.yml`: current single-server Compose definition.
- `server.properties.example`: safe, secret-free server baseline.
- `go.mod`: control-plane module and pinned dependency contract.

Generated Paper dependencies, active server properties, worlds, logs, caches, and player state are intentionally ignored.
