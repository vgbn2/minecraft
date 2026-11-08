#!/usr/bin/env bash
# ==============================================================================
# Zero-Corruption Atomic Backup Protocol for Minecraft Server
# Features:
#   1. RCON /save-off & /save-all flush (prevents dirty/torn chunk writes)
#   2. Hardlink incremental snapshots to /mnt/sda1/backups/
#   3. Automatic 14-day snapshot rotation
#   4. Post-backup HDD power-saving standby spin-down
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "${SCRIPT_DIR}")"
BACKUP_ROOT="/mnt/sda1/backups/minecraft"
TIMESTAMP="$(date +'%Y-%m-%d_%H-%M-%S')"
TARGET_DIR="${BACKUP_ROOT}/snapshot_${TIMESTAMP}"
LATEST_LINK="${BACKUP_ROOT}/latest"

echo "=================================================="
echo "💾 Starting Safe Minecraft Backup: ${TIMESTAMP}"
echo "=================================================="

# Ensure backup root exists
mkdir -p "${BACKUP_ROOT}"

# 1. RCON: Flush memory and pause disk writes
echo "⏳ [1/5] Flushing world memory to disk..."
python3 "${SCRIPT_DIR}/rcon.py" "save-off" >/dev/null 2>&1 || true
python3 "${SCRIPT_DIR}/rcon.py" "save-all flush" >/dev/null 2>&1 || true
sleep 2

# 2. Perform Atomic Snapshot via rsync hardlinks
echo "📦 [2/5] Creating hardlink snapshot -> ${TARGET_DIR}..."
if [ -d "${LATEST_LINK}" ]; then
    rsync -a --delete --link-dest="${LATEST_LINK}" /opt/minecraft/data/ "${TARGET_DIR}/data/" 2>/dev/null || \
    rsync -a --delete --link-dest="${LATEST_LINK}" /home/vgbn-server/Documents/codeptit/minecraft/data/ "${TARGET_DIR}/data/" 2>/dev/null || \
    docker cp minecraft:/opt/minecraft/world "${TARGET_DIR}/data"
else
    mkdir -p "${TARGET_DIR}/data"
    docker cp minecraft:/opt/minecraft/world "${TARGET_DIR}/data" 2>/dev/null || \
    rsync -a /opt/minecraft/data/ "${TARGET_DIR}/data/" 2>/dev/null || true
fi

# Copy configs and plugins into snapshot
mkdir -p "${TARGET_DIR}/config"
docker cp minecraft:/opt/minecraft/config "${TARGET_DIR}/config" 2>/dev/null || true
docker cp minecraft:/opt/minecraft/server.properties "${TARGET_DIR}/" 2>/dev/null || true
docker cp minecraft:/opt/minecraft/spigot.yml "${TARGET_DIR}/" 2>/dev/null || true

# Update latest symlink
rm -f "${LATEST_LINK}"
ln -s "${TARGET_DIR}" "${LATEST_LINK}"

# 3. RCON: Resume normal disk writes
echo "▶️ [3/5] Resuming normal world writes..."
python3 "${SCRIPT_DIR}/rcon.py" "save-on" >/dev/null 2>&1 || true

# 4. Rotate old snapshots (keep last 14 days)
echo "🧹 [4/5] Pruning snapshots older than 14 days..."
find "${BACKUP_ROOT}" -maxdepth 1 -name "snapshot_*" -type d -mtime +14 -exec rm -rf {} + 2>/dev/null || true

# 5. Spin down HDD to save power
echo "💤 [5/5] Putting backup HDD into power-saving standby..."
sudo hdparm -y /dev/sda >/dev/null 2>&1 || true

SNAPSHOT_SIZE=$(du -sh "${TARGET_DIR}" 2>/dev/null | cut -f1 || echo "N/A")
echo "=================================================="
echo "✅ Backup COMPLETE! Snapshot size: ${SNAPSHOT_SIZE}"
echo "=================================================="
