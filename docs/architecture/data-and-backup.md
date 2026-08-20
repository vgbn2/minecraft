# Data and Backup Architecture

Each Crafty server root contains every dimension and server-owned state. Recovery points are published only as `.ready` after graceful stop, process-exit proof, complete archive creation, manifest and SHA-256 generation, and atomic promotion. `.partial` and failed evidence stay outside the published set.

The same global operation lock excludes start, backup, restore, migration, and HDD copy/unmount activity. Crafty must not write to `/mnt/sda1` directly. Completed recovery points are staged beneath the path copied by the existing 04:00 and 16:00 job. Same-host HDD copies are not disaster recovery; encrypted off-host replication remains a separate gate.

A backup becomes restore-verified only after extraction into a disposable root, checksum and all-dimension checks, boot, clean-log review, and sample player-data verification.
