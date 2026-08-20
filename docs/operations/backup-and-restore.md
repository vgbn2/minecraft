# Backup and Restore Runbook

Schedule Minecraft recovery points before, never during, the existing 04:00/16:00 HDD job. Acquire the global lock; reject on low capacity/inodes or unsynchronized time; notify players; save; stop; prove process exit; archive dimensions and server state; generate manifest/checksum; and rename `.partial` to `.ready`. Restart through admission only when the server was previously running.

If shutdown hangs, keep logs and mark the recovery point failed. Do not force-kill automatically. If archive/checksum/copy fails, never publish or restart blindly. Do not automatically delete older recovery points under pressure.

Restore into a disposable empty root, verify safe paths and checksums before extraction, then check all dimensions, boot logs, and representative player data. Record the exact archive, profile digest, operator, timestamps, and result.
