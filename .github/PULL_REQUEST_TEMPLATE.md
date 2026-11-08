## Summary

Describe the problem, the change, and why this scope is necessary.

## Related Issues

<!-- Link relevant issues: Closes #123, Fixes #456, Relates to #789 -->
- Closes #
- Relates to #

## Affected Areas

- [ ] Rust core / kinematics / A* pathfinding (`bots/mc_path_core`)
- [ ] Go control plane / admission gates / Crafty client (`cmd/mcctl`, `internal/`)
- [ ] Node.js bot squad / behavioral state machines (`bots/src/`)
- [ ] Causal game mechanics (hydration, container bus, voxels, excavation)
- [ ] Server configuration / PaperMC / Pumpkin (`config/`, root YAMLs)
- [ ] Infrastructure / Docker Compose / LXC hardening (`deploy/`)
- [ ] CI / Security / Governance (`.github/`, policies)
- [ ] Other: <!-- describe -->

## Evidence

List commands actually run and their outcomes. State what was not run and why.

```text
command:
outcome:
evidence scope:
```

### Canonical Protocols Executed
- [ ] Polyglot Triad: Rust (kinematics) / Go (control plane) / JS (tactical AI) separation preserved.
- [ ] Zero-Key Development: All tests execute keyless and offline (`OFFLINE_ONLY=1`).
- [ ] Causal Elements: Mechanics designed around underlying game engine physics rather than symptoms.
- [ ] Diagnostic Gates: All 21 verification gates passed (`node test-verify.mjs`).
- [ ] Go Admission & Contracts: Go package test suite passed (`go test ./...`).
- [ ] Server Hardening: Loopback binding (`127.0.0.1`) and volatile tmpfs IPC (`/dev/shm`) enforced.

### Test Verification
- [ ] Behavior changes include an appropriate unit or integration test.
- [ ] Integration evidence shows relevant input, transforms, counts, and invariants where applicable.
- [ ] No test was weakened, skipped, suppressed, or replaced merely to create a passing result.

## Safety and Operations

- [ ] This PR does not alter network exposure, authentication, secrets, or host filesystem boundaries.
- [ ] This PR alters one of those boundaries and identifies the named maintainer who approved it: <!-- name -->
- [ ] Not applicable: explain why the changed area cannot affect those boundaries. <!-- explanation -->

## Breaking Changes & Migration

- [ ] **No Breaking Changes**: 100% backward-compatible with preceding commit.
- [ ] **Breaking Change**: Protocol or configuration schema bump required; migration instructions provided: <!-- details -->

## Rollback Plan

<!-- Describe steps to cleanly roll back this PR if unexpected defects arise -->
- [ ] Git revert is clean and leaves no orphaned state: `git revert -m 1 <merge_commit_sha>`
- [ ] Bot processes can be recalled immediately: `./bots/mc-bot.sh --remote squad stop`
- [ ] Server can be rolled back via existing immutable profile.

## Contribution Attestation

- [ ] I have authority to submit this contribution and permit it to be used under this repository's [MIT License](../LICENSE).
