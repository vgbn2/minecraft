#!/usr/bin/env python3
"""
Declarative Minecraft Plugin Sync & Bytecode Guard
Reads plugins.yaml, verifies Java 21 bytecode compatibility (Class <= 65.0),
and syncs enabled plugins into plugins/.
"""

import os
import sys
import urllib.request
import re
import zipfile
import struct

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
MANIFEST_PATH = os.path.join(ROOT_DIR, "config", "plugins.yaml")
if not os.path.exists(MANIFEST_PATH):
    MANIFEST_PATH = os.path.join(ROOT_DIR, "plugins.yaml")
PLUGINS_DIR = os.path.join(ROOT_DIR, "plugins")
MAX_ALLOWED_CLASS_VERSION = 65  # Java 21

def parse_simple_yaml(path):
    """Simple parser for plugins.yaml without external dependencies."""
    plugins = []
    current_category = "General"
    
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()
        
    current_plugin = {}
    in_plugin = False
    
    for line in lines:
        raw = line.rstrip()
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
            
        if not raw.startswith(" ") and not raw.startswith("\t"):
            continue
            
        # Category header
        cat_match = re.match(r"^\s{2}([a-zA-Z0-9_]+):", raw)
        if cat_match and not raw.strip().startswith("-"):
            current_category = cat_match.group(1)
            continue
            
        # Plugin item start
        if stripped.startswith("- name:"):
            if current_plugin and current_plugin.get("url"):
                plugins.append(current_plugin)
            name = stripped.split(":", 1)[1].strip().strip('"\'')
            current_plugin = {"name": name, "category": current_category, "enabled": True}
            in_plugin = True
            continue
            
        if in_plugin:
            if ":" in stripped:
                k, v = stripped.split(":", 1)
                k = k.strip().strip("- ")
                v = v.strip().strip('"\'')
                if k == "enabled":
                    current_plugin[k] = (v.lower() == "true")
                else:
                    current_plugin[k] = v
                    
    if current_plugin and current_plugin.get("url"):
        plugins.append(current_plugin)
        
    return plugins

def verify_bytecode(jar_path):
    """Checks the Java bytecode class version of a JAR file."""
    try:
        with zipfile.ZipFile(jar_path, "r") as z:
            classes = [n for n in z.namelist() if n.endswith(".class") and not n.startswith("META-INF")]
            if not classes:
                return True, "No classes found (resource-only)"
            with z.open(classes[0]) as c:
                magic, minor, major = struct.unpack(">IHH", c.read(8))
                if magic != 0xCAFEBABE:
                    return False, "Invalid Java class magic number"
                java_ver = major - 44
                if major > MAX_ALLOWED_CLASS_VERSION:
                    return False, f"Requires Java {java_ver} (Class {major}), but server runtime is Java 21 (Class 65)"
                return True, f"Java {java_ver} (Class {major}) - Compatible"
    except Exception as e:
        return False, f"Bytecode scan error: {e}"

def download_file(url, target_path, name):
    print(f"  ⬇️  Downloading {name} from {url}...")
    headers = {"User-Agent": "Mozilla/5.0 (Minecraft Server Plugin Syncer)"}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp, open(target_path, "wb") as out:
        out.write(resp.read())
    
    # Verify bytecode immediately after download
    valid, msg = verify_bytecode(target_path)
    if not valid:
        os.remove(target_path)
        raise RuntimeError(f"Bytecode guard rejected {name}: {msg}")
        
    size_mb = os.path.getsize(target_path) / (1024 * 1024)
    print(f"  ✅ Installed & Verified: {os.path.basename(target_path)} ({size_mb:.2f} MB) -> {msg}")

def main():
    verify_only = "--verify-only" in sys.argv
    if not os.path.exists(MANIFEST_PATH):
        print(f"Error: Manifest not found at {MANIFEST_PATH}", file=sys.stderr)
        sys.exit(1)
        
    os.makedirs(PLUGINS_DIR, exist_ok=True)
    plugins = parse_simple_yaml(MANIFEST_PATH)
    
    print(f"📦 Found {len(plugins)} declared plugins in plugins.yaml")
    categories = {}
    for p in plugins:
        cat = p.get("category", "General")
        categories.setdefault(cat, []).append(p)
        
    errors = 0
    for cat_name, cat_plugins in categories.items():
        print(f"\n📁 Category: [{cat_name}]")
        for p in cat_plugins:
            if not p.get("enabled", True):
                print(f"  ⏭️  Skipping disabled: {p['name']}")
                continue
                
            filename = p.get("filename") or f"{p['name']}.jar"
            target_path = os.path.join(PLUGINS_DIR, filename)
            
            if os.path.exists(target_path):
                valid, msg = verify_bytecode(target_path)
                size_mb = os.path.getsize(target_path) / (1024 * 1024)
                if valid:
                    print(f"  ✨ {p['name']}: {filename} ({size_mb:.2f} MB) [{msg}]")
                else:
                    print(f"  ❌ {p['name']}: INCOMPATIBLE [{msg}]", file=sys.stderr)
                    errors += 1
            elif not verify_only:
                try:
                    download_file(p["url"], target_path, p["name"])
                except Exception as e:
                    print(f"  ❌ Failed to download {p['name']}: {e}", file=sys.stderr)
                    errors += 1

    if errors > 0:
        print(f"\n❌ Plugin synchronization encountered {errors} error(s).", file=sys.stderr)
        sys.exit(1)
    else:
        print("\n✅ All plugins verified compatible and ready for production!")
        sys.exit(0)

if __name__ == "__main__":
    main()
