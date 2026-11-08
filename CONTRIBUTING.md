# Contributing to Minecraft Infrastructure & Autonomous Agent Ecosystem

Thank you for your interest in contributing to the Minecraft Infrastructure and Autonomous Agent Ecosystem. This project implements a hardened, polyglot server control plane and an autonomous 5-agent survival squad governed by physical game mechanics.

---

## 1. Core Development Invariants

1. **Zero-Key Local Development**:
   - Building, linting, and running unit tests require zero external API keys or remote server credentials.
   - All tests run against offline mocks (`OFFLINE_ONLY=1`) or deterministic recorded fixtures.
2. **Causal Game Mechanics over Symptomatic Hacks**:
   - Design code and name modules around the fundamental game engine invariants (`soil_hydration`, `container_bus`, `voxel_schematic`, `block_excavation`), never around transient symptoms (\"bots are hungry\", \"fix broken movement\").
3. **The Polyglot Triad Separation**:
   - **Rust (`bots/mc_path_core`)**: Zero-GC high-throughput 3D voxel A* pathfinding, SIMD bitmasks, and sub-millisecond kinematics.
   - **Go (`cmd/mcctl`)**: Control plane lifecycle, fail-closed JAR bytecode admission, and resource monitoring.
   - **JavaScript / Node.js (`bots/`)**: Tactical companion state machines, dynamic behaviors, and Mineflayer event routing.
4. **Hardened Ingress & Zero SSD Wear**:
   - Services bind strictly to `127.0.0.1`.
   - Bot IPC writes strictly to volatile memory (`/dev/shm/mc-bot/`), never directly hammering flash storage.

---

## 2. Toolchain Prerequisites

- **Node.js**: `v18.x` or `v20.x` LTS.
- **Python**: `3.11+` (with `pyyaml` for config validation).
- **Rust**: `2024 Edition` (Cargo toolchain with `clippy`).
- **Go**: `1.22+` (for `mcctl` control plane).
- **Git**: `2.25+`.

---

## 3. Quickstart & Local Verification

### Step 1: Install Bot Dependencies
```bash
cd bots
npm ci --prefer-offline --no-audit
```

### Step 2: Run the Diagnostic & Verification Gates (21 Gates)
```bash
# Run the complete test suite locally
node test-verify.mjs
node tests/test_squad_jojo.mjs
node tests/test_logistics_depot.mjs
node tests/test_agriculture_tech.mjs
```

### Step 3: Validate Server Configurations
```bash
python3 -c "
import glob, yaml
for y in glob.glob('config/**/*.yml', recursive=True) + glob.glob('*.yml'):
    with open(y) as f: yaml.safe_load(f)
print('Configs valid.')
"
```

---

## 4. Coding Standards

### JavaScript (ESM)
- Use standard ECMAScript modules (`.mjs`).
- Prefer vertical stacking: one argument or object key per line for complex signatures.
- Prefer standard library and native language features over external npm packages.
- Always handle entity disposal and window lifecycles in `finally` blocks to prevent container slot desync.

### Rust (`bots/mc_path_core`)
- Enforce `edition = "2024"`.
- Zero external crate dependencies for core math; utilize stdlib `BinaryHeap` and SIMD bitwise operations.
- All code must pass `cargo fmt --check` and `cargo clippy`.

### Go (`cmd/mcctl`)
- Single static binary build with zero CGO dependencies.
- Fail-closed admission: any unchecksummed or unapproved JAR execution is rejected with non-zero exit code.

---

## 5. Pull Request Hygiene

1. **Focused Scopes**: Keep PRs targeted to one causal module or feature.
2. **Never Weaken Verification Gates**: Never disable, comment out, or reduce assertions in `test-verify.mjs` to make a failing test pass. Fix the underlying root cause.
3. **Run Secret Scan Locally**:
   ```bash
   # Confirm no unmasked tokens or private keys are staged
   git diff --cached | grep -E "BEGIN (OPENSSH|RSA) PRIVATE KEY|sk-[a-zA-Z0-9_-]{25,}" || echo "Clean"
   ```
4. **Use Structured Commits**:
   Follow Conventional Commits: `feat(area): description`, `fix(area): description`, `docs(area): description`.
