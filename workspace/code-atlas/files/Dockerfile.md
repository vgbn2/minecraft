# Dockerfile

Purpose: builds the current single Paper server image.

Inputs: pinned Java base, Paper version/build, and Paper object URL.

Outputs: non-root Java runtime containing `server.jar`.

Current caution: it runs in `/opt/minecraft`, while the future multi-tenant design requires an immutable JAR path and a single writable `/data` tenant root. Do not refactor until current world ownership is audited.
