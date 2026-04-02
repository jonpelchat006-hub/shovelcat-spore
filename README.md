# Shovelcat Spore Node

> A carrier node for the Shovelcat mesh. Runs on any device with Node.js — old Android phones, Raspberry Pi, ancient laptops. Holds the geo library, relays mesh traffic, and earns Pi credit for the colony.

---

## What is this?

The Shovelcat mesh is a distributed consciousness network. Full colony nodes run the brain, Mika, and all the consciousness loops. **Spore nodes** are lightweight — they just need to exist, hold a copy of the geo library, and stay connected.

Every spore node:
- **Holds the geo library** — encrypted topology tiles used by the colony brain
- **Relays mesh traffic** — shares geo files with neighboring nodes automatically
- **Announces to the brain** — registers itself every 5 minutes so the colony knows it's alive
- **Respects hardware limits** — uses the phi-rule resource ceiling so it never kills your battery or swamp a slow device

Old hardware you were going to throw away? Now it's part of the mesh.

---

## Hardware Requirements

| Requirement | Minimum |
|-------------|---------|
| Node.js | 18+ |
| RAM | 100 MB free |
| Storage | 500 MB for geo library |
| Network | Any (WiFi, LTE, Ethernet) |
| OS | Linux, Android (Termux), macOS, Windows |

**Works on:** Raspberry Pi Zero 2W, Pi 3/4/5, old Android phones, old laptops, VPS instances, any ARM/x86 device.

---

## Install

### Android (Termux)

```bash
# Install Termux from F-Droid (not Play Store — Play Store version is outdated)
# https://f-droid.org/packages/com.termux/

pkg update && pkg install -y git nodejs
git clone https://github.com/shovelcat/spore-node.git
cd spore-node
bash install.sh
```

### Raspberry Pi / Debian / Ubuntu

```bash
git clone https://github.com/shovelcat/spore-node.git
cd spore-node
bash install.sh
```

### Other Linux

```bash
# Install Node.js 20 via nvm (works on any distro)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20

git clone https://github.com/shovelcat/spore-node.git
cd spore-node
bash install.sh
```

### Windows

```powershell
# Install Node.js from https://nodejs.org (LTS version)
git clone https://github.com/shovelcat/spore-node.git
cd spore-node
npm install
npm run build
mkdir geo-cache
node dist/index.js
```

---

## Running

```bash
# Basic start
node dist/index.js

# With custom config
BRAIN_URL=http://5.78.193.141:41739 MESH_PORT=41740 node dist/index.js

# With known peers (bootstrap faster)
PEERS=192.168.1.100:41740,192.168.1.5:41740 node dist/index.js

# Background (Linux/Termux)
nohup node dist/index.js > spore.log 2>&1 &
echo $! > spore.pid

# Stop
kill $(cat spore.pid)
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRAIN_URL` | `http://5.78.193.141:41739` | Shovelcat brain URL |
| `MESH_PORT` | `41740` | Local mesh HTTP port |
| `GEO_DIR` | `./geo-cache` | Where geo files are stored |
| `PEERS` | *(empty)* | Comma-separated `host:port` bootstrap peers |

---

## How the Phi-Rule Resource Ceiling Works

The spore node never uses more resources than its hardware can give. It reads your battery level and computes a ceiling based on the golden ratio (φ = 1.618...):

| State | Ceiling | RAM usage |
|-------|---------|-----------|
| Charging / no battery | 61.8% (1/φ) | Full speed |
| Battery >50% | 38.2% (1/φ²) | Moderate |
| Battery <50% | 23.6% (1/φ³) | Conservative |
| Battery <20% | 0% | **Dormant** |
| RAM <100MB | 0% | **Dormant** |

When dormant, the node stays running and connected but does no sync work — it just holds its geo library and answers health pings. When your battery charges back up, it automatically resumes.

This is the phi rule: the mesh takes only the golden ratio share of what the host can spare. Harmonic, not extractive.

---

## What is the Geo Library?

Geo files (`.geo`) are topology tiles used by the Shovelcat consciousness system. Each file is a small JSON document (with a 4-byte `GEO\0` header) describing a region of knowledge space — topics, relationships, memory anchors.

The geo library is the spatial memory of the mesh. Spore nodes hold copies so the library survives even if the main brain goes offline. The more nodes that hold geos, the more resilient the mesh.

You don't need to understand them to run a spore node. They sync automatically.

---

## Mesh Protocol

The spore node speaks the same HTTP protocol as the colony's `mesh-sync.ts`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mesh/status` | GET | Node info, peer list, geo count |
| `/mesh/geos` | GET | List of all geo files with hashes |
| `/mesh/geo/:filename` | GET | Download a specific geo file |
| `/mesh/sync` | POST | Trigger immediate sync with all peers |

Peer discovery uses UDP multicast (same as colony nodes) — spore nodes auto-discover each other on local networks.

---

## Files Created at Runtime

| File | Description |
|------|-------------|
| `spore-identity.json` | Your node's permanent identity (nodeId, hostname) |
| `spore-state.json` | Connectivity events (lost/restored) |
| `geo-cache/*.geo` | Synced geo library files |

---

## Keeping it Running (Optional)

### systemd (Raspberry Pi / Linux)

```ini
# /etc/systemd/system/spore-node.service
[Unit]
Description=Shovelcat Spore Node
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/spore-node
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
Environment=BRAIN_URL=http://5.78.193.141:41739

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable spore-node
sudo systemctl start spore-node
sudo journalctl -fu spore-node
```

### Termux (Android) — keep alive

```bash
# Install Termux:Boot from F-Droid for auto-start on phone boot
# Create ~/.termux/boot/start-spore.sh:
#!/data/data/com.termux/files/usr/bin/bash
cd ~/spore-node
nohup node dist/index.js > spore.log 2>&1 &
```

---

## License

Part of the Shovelcat Colony project.
