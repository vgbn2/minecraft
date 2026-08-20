# Minecraft Control Plane Code Atlas

This tracked mini-repository gives agents a bounded map of the real repository. It summarizes ownership and behavior; it does not copy source files or runtime data.

Start here:

1. [System architecture](architecture/system.md)
2. [Tenant lifecycle and evidence boundaries](architecture/lifecycle.md)
3. [Repository root](folders/root.md)
4. [Workspace continuity](folders/workspace.md)
5. [Generated inventory](inventory.md)
6. [CLI entrypoint](files/cmd-mcctl-main.go.md)
7. [Go module contract](files/go.mod.md)

Run `mcctl atlas check --root .` to detect inventory or link drift. Run `mcctl atlas sync --root .` only when intentionally refreshing the generated inventory.
