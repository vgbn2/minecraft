# Next Session Goal

Execute Batch 1 of the Simple Web Product Reassessment (`workspace/plans/SIMPLE_WEB_PRODUCT_REASSESSMENT.md`):

1. **Magic Number Extraction & Configuration Consolidation**:
   - Extract hardcoded operational policy limits (Category 3: memory headroom, CPU/load thresholds, storage minima) and cadence/retention parameters (Category 4: sample intervals, hysteresis, reminder throttles) from `internal/` into `internal/config/`.
   - Update `examples/mcctl.config.json` with documented defaults and constraints.
   - Update config validator (`mcctl config validate`) and test fixtures.
2. **Preflight & Verification**:
   - Run `make verify` and test suites through the Go toolchain container.
   - Verify zero regression in fail-closed admission and monitor logic.

Strict safety boundaries remain active:
- Zero container start, zero public port exposure.
- Zero mutation or import of world data (`data/`, `world*`); world adoption remains **NO-GO**.
- Source/test changes only; no deployment to HP Desk or Dell OptiPlex without explicit user authorization.
