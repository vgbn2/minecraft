# Operational Troubleshooting & Known Failure Modes

This runbook documents common connectivity, authentication, LOD streaming, and plugin compatibility issues along with their root causes and permanent fixes.

---

## 1. 🔑 "Invalid Session" / Failed to Retrieve Profile Key Pair

### Symptoms:
* Player cannot join the server; client immediately displays:
  `Invalid session (Try restarting your game and the launcher)`
* Client logs (`~/.minecraft/logs/latest.log`) show:
  `[Download-1/ERROR]: Failed to retrieve profile key pair`
  `com.mojang.authlib.exceptions.MinecraftClientHttpException: Status: 401`

### Root Cause:
* Mojang session token expired on the client, or the client is using an offline/cracked launcher profile.
* Minecraft 1.19+ enforces Cryptographic Chat Signing (`enforce-secure-profile: true`), requiring valid Mojang public keypairs. If the server has `enforce-secure-profile=true` or `online-mode=true`, connections without valid Mojang signatures are dropped.

### Permanent Fix:
In `server.properties`:
```properties
online-mode=false
enforce-secure-profile=false
```
*Reload server:*
```bash
python3 tools/rcon.py reload
```

---

## 2. ⏳ "Kicked due to keepalive timeout!" over Public Tunnels (Playit.gg)

### Symptoms:
* Players connect successfully, but after moving, exploring, or falling, they are kicked with:
  `vgbn was kicked due to keepalive timeout!`

### Root Cause:
* **LOD Tunnel Saturation:** The `LodServerSupport` plugin attempts to stream high-bandwidth LOD data (default 25 MB/s) across the Playit tunnel (which has a bandwidth ceiling of ~2–5 MB/s). This clogs the TCP queue and delays keepalive ping packets beyond Paper's 30s threshold.

### Permanent Fix:
1. In `plugins/LodServerSupport/lss-server-config.json`:
   ```json
   {
     "mbPerSecondLimitPerPlayer": 2.0,
     "mbPerSecondLimitGlobal": 10.0,
     "sendQueueLimitPerPlayer": 256,
     "enablePingBackstop": true,
     "enableSendPacing": true,
     "lodYieldsToVanillaTransport": true
   }
   ```
2. In `spigot.yml`:
   ```yaml
   settings:
     timeout-time: 300
   ```
3. In `config/paper-global.yml`:
   ```yaml
   chunk-loading-basic:
     player-max-chunk-send-rate: 35.0
   ```

---

## 3. 🏃 "Moved too quickly!" / Flying Kicks During Lag or Falling

### Symptoms:
* Server kicks players who fall from cliffs, use fast elytra, or experience brief latency rubberbanding.

### Root Cause:
* Vanilla and Spigot movement verification flags interpret falling or high-speed movement as illegal flight or speed-hacking.

### Permanent Fix:
1. In `server.properties`:
   ```properties
   allow-flight=true
   ```
2. In `spigot.yml`:
   ```yaml
   settings:
     moved-wrongly-threshold: 100.0
     moved-too-quickly-multiplier: 100.0
   ```
3. In `config/paper-global.yml`:
   ```yaml
   packet-limiter:
     all-packets:
       action: DROP
       max-packet-rate: 2000.0
   ```

---

## 4. ☕ `UnsupportedClassVersionError` (Class 69.0 / Java 25) on Plugin Boot

### Symptoms:
* A newly downloaded plugin crashes on server start with:
  `java.lang.UnsupportedClassVersionError: ... compiled by a more recent version of Java (class 69.0), only recognizes up to 65.0`

### Root Cause:
* The `.jar` was compiled for Java 25, while the Paper 1.21.11 container runs **Java 21 (Class 65.0)**.

### Permanent Fix:
* Verify bytecode class version using Python before deployment:
  ```bash
  python3 -c '
  import zipfile, struct
  with zipfile.ZipFile("plugin.jar", "r") as z:
      classes = [n for n in z.namelist() if n.endswith(".class") and not n.startswith("META-INF")]
      with z.open(classes[0]) as c:
          _, _, major = struct.unpack(">IHH", c.read(8))
          print(f"Target Java: {major - 44} (Class {major})")
  '
  ```
* Pin verified Java 21 / 17 builds in `plugins.yaml`.
