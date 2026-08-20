# cmd/mcctl/main.go

Purpose: process entrypoint only. It passes arguments and standard streams to `internal/app` and returns the documented exit code.

Do not place policy, Docker, database, filesystem, or SSH behavior here.
