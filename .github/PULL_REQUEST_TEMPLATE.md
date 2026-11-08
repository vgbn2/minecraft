## Description

<!-- Provide a concise summary of the change and its underlying causal motivation. -->

## Subsystem & Polyglot Layer

- [ ] **Rust Core (`mc_path_core`)**: Kinematics, A* pathfinding, SIMD voxel bitmasks.
- [ ] **Go Control Plane (`cmd/mcctl`)**: Admission gate, resource monitor, Crafty supervisor.
- [ ] **Node.js Squad (`bots/`)**: Causal skills, state machines, Mineflayer bindings.
- [ ] **Server Configuration & Infrastructure**: Paper/Pumpkin configs, Docker/LXC hardening.
- [ ] **CI / Security / Governance**: Workflows, policies, documentation.

## Causal Element & Physical Invariant

<!-- Which underlying game mechanic or system invariant does this change preserve or model? -->
<!-- E.g., Chebyshev hydration (9x9), window slot state machine, topological Y-ascending placement -->

## Verification Evidence

<!-- Paste terminal output proving all verification gates pass locally. -->

```bash
cd bots && node test-verify.mjs
# Paste result: (e.g. SUMMARY: 21 PASSED, 0 FAILED)
```

## Checklist

- [ ] I have read and adhered to [CONTRIBUTING.md](../CONTRIBUTING.md) and [SECURITY.md](../SECURITY.md).
- [ ] No private keys, `.env` files, or unmasked API secrets are included in this changeset.
- [ ] All 21 diagnostic verification gates pass with zero skips or failures.
- [ ] Backward compatibility with existing shims is preserved.
- [ ] Code follows vertical stacking formatting conventions.
