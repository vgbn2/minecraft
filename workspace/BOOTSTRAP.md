# Session Bootstrap

1. Confirm `pwd` is the repository root.
2. Read `workspace/HANDOFF.md` and the current dated handoff.
3. Read the tail of `workspace/SESSION_MEMORY.md`, then `workspace/STATE.md` and `workspace/NEXT_SESSION_GOAL.md`.
4. Inspect `git status --short`, the current branch, and `HEAD` before editing.
5. Preserve world data, credentials, generated runtime files, and unrelated user changes.
6. Treat source checks, container checks, deployment checks, world recovery, and live-server health as separate evidence layers.

For configuration-only work, the minimum non-live checks are:

```bash
docker compose config
git diff --check
```

Do not start or restart the server unless the user explicitly authorizes runtime operations.
