# Next Session Goal

Review and improve the repository documentation and READMEs before any further implementation.

1. Audit the root `README.md`, `docs/README.md`, canonical `docs/`, and workspace navigation for stale, conflicting, superseded, or implementation-first explanations.
2. Make the root README clearly describe the intended simple web experience, present status, what works now, what is not deployed, safe setup/test entrypoints, and the next development boundary.
3. Define the ownership hierarchy in canonical docs: user membership -> tenant -> server -> world set -> immutable profile revision. Versions belong to servers, not users; approved artifacts are cataloged and downloaded on demand rather than preinstalled.
4. Document a source-backed magic-number review. Classify hard-coded values as protocol invariants, compatibility/version pins, operational policy, resource thresholds, cadence/retention values, test fixtures, or unexplained literals, then state which should become constants, configuration, profiles, or fixed documented contracts.
5. Challenge the amount of custom code in documentation. State what Crafty owns, what `mcctl` must retain for safety, and what can be simplified, removed, or deferred.
6. Write `workspace/plans/SIMPLE_WEB_PRODUCT_REASSESSMENT.md` with evidence, proposed architecture, documentation map, keep/remove/defer decisions, ranked future batches, acceptance criteria, migration risks, and a realistic effort estimate.

Documentation/README edits and read-only source inspection only. Do not edit production code, download or install Crafty, start containers or services, create servers, poll remote hosts, expose ports, move worlds, or perform recovery. World adoption remains independently NO-GO.
