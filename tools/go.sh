#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tool_image='golang:1.27.0-bookworm@sha256:484ef6066fa69acb059fdfeda7ba2b8f7391f2ef6abc6f9b8411e669ebd56466'

mkdir -p "$repo_root/.cache/go-build" "$repo_root/.cache/go-mod" "$repo_root/dist"

exec docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env GOCACHE=/workspace/.cache/go-build \
  --env GOMODCACHE=/workspace/.cache/go-mod \
  --volume "$repo_root:/workspace" \
  --workdir /workspace \
  "$tool_image" "$@"
