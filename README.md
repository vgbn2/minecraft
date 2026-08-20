# Minecraft Paper Server

Docker-based Paper server configuration for Minecraft 1.21.11.

## Requirements

- Docker Engine with Docker Compose v2
- At least 5 GB of memory available to the container

## First-time setup

1. Copy the safe configuration template:

   ```bash
   cp server.properties.example server.properties
   ```

2. Review `server.properties`. Keep `online-mode=true` for an Internet-facing server unless a trusted proxy performs authentication.
3. Build and start the server:

   ```bash
   docker compose up -d --build
   ```

4. Inspect startup output:

   ```bash
   docker compose logs -f minecraft
   ```

## Repository boundaries

Git tracks the Docker definition, safe server configuration templates, Paper configuration, and maintenance documentation. It intentionally excludes downloaded JARs, generated libraries, logs, plugin caches, player lists, credentials, and world data.

World data requires a separate backup process. A successful Git push is not a world backup or proof that the server is deployable, recoverable, or healthy.

## Routine maintenance

- Review Paper release notes before changing the pinned version/build in `Dockerfile`.
- Back up world data before Paper, Minecraft, plugin, or configuration upgrades.
- Run `docker compose config` before deployment.
- Validate upgrades on a copied world before using them on the active server.
- Update the files under `workspace/` when project direction or operational evidence changes.
