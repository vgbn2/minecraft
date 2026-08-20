# Profile Lifecycle

1. Select an official stable source and record retrieval time, version/build, URL, checksum, Java requirement, and security notes.
2. Pin every plugin/mod/dependency. Marketplace auto-install and unattended upgrades are forbidden.
3. Validate the JSON profile and artifact checksum.
4. Import a disposable server copy and test boot, exact client compatibility, authentication, data, logs, backup/restore, load, and rollback.
5. Record evidence in the compatibility matrix, review, and only then copy the immutable profile into `/etc/mcctl/profiles`.
6. Changing any field creates a new profile identity/evidence set. Never edit an active profile silently.

Crafty server UUID and root are deployment-specific. Example UUIDs in this repository must be replaced with observed values before deployment.
