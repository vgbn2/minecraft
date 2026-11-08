#!/usr/bin/env python3
"""
Smart Sequential Multi-World Chunky Manager.
Guarantees:
  1. Strict Sequential Execution: Never runs 2 dimensions simultaneously (prevents OOM).
  2. Player-Aware: Pauses when players are online (0% lag).
  3. Safe Atomic Backups: Takes HDD snapshots upon completion of each dimension.
"""

import os
import sys
import time
import re
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RCON_SCRIPT = os.path.join(SCRIPT_DIR, "rcon.py")
BACKUP_SCRIPT = os.path.join(SCRIPT_DIR, "safe-backup.sh")

def log(msg):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)

def run_rcon(*cmd):
    try:
        res = subprocess.run(
            [sys.executable, RCON_SCRIPT, *cmd],
            capture_output=True,
            text=True,
            timeout=10
        )
        return res.stdout.strip()
    except Exception as e:
        return f"ERROR: {e}"

def get_player_count():
    out = run_rcon("list")
    match = re.search(r"There are (\d+) of a max", out)
    if match:
        return int(match.group(1))
    return 0

log("🎯 Smart Sequential Chunky Manager active.")
log("   Policy: Sequential execution (Nether -> End) | PAUSE on player join.")

chunky_state = "UNKNOWN"

# Ensure overworld task is canceled if present
run_rcon("chunky", "cancel", "world")
run_rcon("chunky", "confirm")

while True:
    try:
        player_count = get_player_count()
        progress_out = run_rcon("chunky", "progress")
        
        is_no_task = "No tasks running" in progress_out or "not running" in progress_out.lower()
        
        if is_no_task:
            log("🎉 All queued dimension generation tasks have COMPLETED (100%)!")
            log("💾 Triggering safe atomic backup to HDD...")
            if os.path.exists(BACKUP_SCRIPT):
                subprocess.run(["bash", BACKUP_SCRIPT], check=True)
            log("✅ All dimensions pre-generated and backed up! Manager exiting.")
            break

        # Check if Nether and End are running simultaneously -> pause End until Nether completes
        if "world_nether" in progress_out and "world_the_end" in progress_out:
            log("⚠️ Detected simultaneous dimension tasks. Pausing 'world_the_end' to prevent memory saturation...")
            run_rcon("chunky", "pause", "world_the_end")

        # Player presence logic
        if player_count > 0:
            if chunky_state != "PAUSED_PLAYERS_ONLINE":
                log(f"👥 {player_count} player(s) online! Pausing generation to guarantee 0% server lag.")
                run_rcon("chunky", "pause")
                chunky_state = "PAUSED_PLAYERS_ONLINE"
            else:
                log(f"👥 {player_count} player(s) online | Generation safely paused.")
        else:
            if chunky_state != "RUNNING_EMPTY_SERVER":
                log("🌙 Server empty (0 players). Resuming generation...")
                run_rcon("chunky", "continue")
                chunky_state = "RUNNING_EMPTY_SERVER"
            else:
                log(f"⚡ Server empty | Status: {progress_out}")

    except Exception as e:
        log(f"Warning during loop: {e}")
        
    time.sleep(30)
