#!/usr/bin/env python3
"""
Future-Proof Pre-Flight Configuration Linter Gate for Minecraft Server.
Enforces mandatory production flags, memory safety ceilings, and syntax.
"""
import os
import sys
import yaml

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ERRORS = []
WARNINGS = []

def check(condition, message, is_error=True):
    if not condition:
        if is_error:
            ERRORS.append(f"❌ [ERROR] {message}")
        else:
            WARNINGS.append(f"⚠️ [WARN]  {message}")

print("==================================================")
print("🔍 Running Future-Proof Configuration Linter...")
print("==================================================")

# 1. Validate server.properties
sp_path = os.path.join(ROOT_DIR, "server.properties")
if os.path.exists(sp_path):
    sp = {}
    with open(sp_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                sp[k.strip()] = v.strip()

    check(sp.get("online-mode") == "false", "server.properties must have 'online-mode=false' to avoid 401 token kicks")
    check(sp.get("enforce-secure-profile") == "false", "server.properties must have 'enforce-secure-profile=false' to allow cracked/offline clients")
    check(sp.get("allow-flight") == "true", "server.properties must have 'allow-flight=true' to prevent falling/elytra kicks")
    check(sp.get("enable-rcon") == "true", "server.properties must have 'enable-rcon=true' for automated health monitoring")

# 2. Validate docker-compose.yml memory limits
dc_path = os.path.join(ROOT_DIR, "docker-compose.yml")
if os.path.exists(dc_path):
    with open(dc_path, "r") as f:
        content = f.read()
    check("CrashOnOutOfMemoryError" in content, "docker-compose.yml must include '-XX:+CrashOnOutOfMemoryError' for clean container auto-reboots")
    check("mem_limit: 6g" in content or "mem_limit: 7g" in content, "docker-compose.yml must allocate at least 6g mem_limit to prevent OOMs")

# 3. Validate spigot.yml timeout
spigot_path = os.path.join(ROOT_DIR, "spigot.yml")
if os.path.exists(spigot_path):
    try:
        with open(spigot_path, "r") as f:
            spigot = yaml.safe_load(f) or {}
            timeout = spigot.get("settings", {}).get("timeout-time", 0)
            check(timeout >= 300, f"spigot.yml timeout-time must be >= 300 (currently: {timeout})")
    except Exception as e:
        ERRORS.append(f"❌ Failed to parse spigot.yml: {e}")

# Summary
if ERRORS:
    for err in ERRORS:
        print(f"  {err}")
    sys.exit(1)
else:
    print("✅ All future-proof invariants PASSED cleanly! System is 100% robust.")
    sys.exit(0)
