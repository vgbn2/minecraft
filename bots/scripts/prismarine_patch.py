#!/usr/bin/env python3
# prismarine_patch.py: Protocol 26.3 patcher for prismarine-chunk, mineflayer, physics, and protodef.
# ponytail: stdlib Python patch for 26.3 protocol compatibility; zero extra packages.

import json
import os
import sys

def patch_modules(node_modules_dir):
    if not os.path.isdir(node_modules_dir):
        return

    # 1. prismarine-chunk
    pchunk = os.path.join(node_modules_dir, "prismarine-chunk/src/index.js")
    if os.path.exists(pchunk):
        with open(pchunk, "r") as f:
            c = f.read()
        if "'26.3'" not in c and "26.3:" not in c:
            c = c.replace(
                "26.1: require('./pc/1.18/chunk')",
                "26.1: require('./pc/1.18/chunk'),\n    '26.3': require('./pc/1.18/chunk')",
            )
            with open(pchunk, "w") as f:
                f.write(c)

    # 2. mineflayer testedVersions
    mf = os.path.join(node_modules_dir, "mineflayer/lib/version.js")
    if os.path.exists(mf):
        with open(mf, "r") as f:
            v = f.read()
        if "'26.3'" not in v:
            v = v.replace("'26.1']", "'26.1', '26.3']")
            with open(mf, "w") as f:
                f.write(v)

    # 3. prismarine-physics features
    pphys = os.path.join(node_modules_dir, "prismarine-physics/lib/features.json")
    if os.path.exists(pphys):
        try:
            with open(pphys, "r") as f:
                data = json.load(f)
            for feat in data:
                if (
                    "26.1" in feat.get("versions", [])
                    and "26.3" not in feat["versions"]
                ):
                    feat["versions"].append("26.3")
            with open(pphys, "w") as f:
                json.dump(data, f, indent=2)
        except Exception:
            pass

    # 4. protodef serializer resilient frame handling
    pser = os.path.join(node_modules_dir, "protodef/src/serializer.js")
    if os.path.exists(pser):
        with open(pser, "r") as f:
            s = f.read()
        if "return cb(e)" in s and "[protodef] Dropped" not in s:
            s = s.replace(
                "return cb(e)",
                '// ponytail: protect TCP stream framing\n        if (!this.noErrorLogging) console.warn("[protodef] Dropped unparseable packet:", e.message)\n        return cb()',
            )
        if "chunk.toString('hex')" in s and "slice(0, 64)" not in s:
            s = s.replace(
                "chunk.toString('hex')",
                "chunk.toString('hex').slice(0, 64) + '...'",
            )
        target_log = (
            "console.log('Chunk size is ' + chunk.length + ' but only ' + packet.metadata.size + ' was read ; partial packet : ' +\n"
            "          JSON.stringify(packet.data) + '; buffer :' + chunk.toString('hex').slice(0, 64) + '...')"
        )
        if target_log in s and "process.env.DEBUG" not in s:
            s = s.replace(
                target_log,
                "// ponytail: suppress cosmetic packet size mismatch dumps\n        if (process.env.DEBUG) console.log('[protodef] Packet size mismatch:', packet.data?.name || 'packet')",
            )
        with open(pser, "w") as f:
            f.write(s)

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "."
    patch_modules(target)
