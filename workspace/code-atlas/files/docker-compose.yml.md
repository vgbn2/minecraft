# docker-compose.yml

Purpose: defines the current single Minecraft service.

Current mounts: `data` to the Overworld path, plugins, Paper config, and local server properties.

Failure risk: Nether and End persistence is not proven for container recreation. This file is not the future multi-tenant template and must not be used as migration evidence.
