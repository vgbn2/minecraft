# Upgrade and Rollback

Before Crafty, Paper, Fabric, Java, plugin, or mod changes: refresh official release/security notes; pin versions and checksums; create a verified recovery point; test a copied server; verify the Crafty OpenAPI checksum and required endpoints; re-run gate command-contract tests; and preserve the prior artifact/profile/service unit.

Crafty upgrades remain disabled if the server execution command no longer passes through `mcctl gate exec`. Rollback stops the candidate cleanly, restores the pinned service/artifact and copied data if needed, then starts through admission. A green source test is not upgrade, rollback, restore, or live evidence.
