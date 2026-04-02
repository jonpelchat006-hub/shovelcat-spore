#!/bin/bash
# Shovelcat Spore Node — Universal Installer
# Works on: Termux (Android), Raspberry Pi, Ubuntu, Debian, any Linux with Node.js

set -e

echo "╔═══════════════════════════════════════╗"
echo "║   Shovelcat Spore Node  Installer     ║"
echo "╚═══════════════════════════════════════╝"

# ─── Check Node.js ────────────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
    echo "Node.js not found. Attempting to install..."

    if command -v pkg &> /dev/null; then
        echo "Detected Termux — installing via pkg..."
        pkg update -y
        pkg install -y nodejs

    elif command -v apt-get &> /dev/null; then
        echo "Detected apt — installing Node.js 20.x..."
        if command -v curl &> /dev/null; then
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        else
            apt-get install -y curl
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        fi
        apt-get install -y nodejs

    elif command -v dnf &> /dev/null; then
        echo "Detected dnf — installing Node.js..."
        dnf install -y nodejs

    elif command -v pacman &> /dev/null; then
        echo "Detected pacman — installing Node.js..."
        pacman -Sy --noconfirm nodejs npm

    else
        echo ""
        echo "ERROR: Cannot auto-install Node.js on this system."
        echo "Please install Node.js 18+ manually: https://nodejs.org"
        echo ""
        echo "Or use nvm: https://github.com/nvm-sh/nvm"
        echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
        echo "  nvm install 20"
        exit 1
    fi
fi

NODE_VERSION=$(node --version)
echo "Node.js: $NODE_VERSION"

# Check minimum version (18+)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1 | tr -d 'v')
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "ERROR: Node.js 18+ required. Found: $NODE_VERSION"
    echo "Please upgrade: https://nodejs.org"
    exit 1
fi

# ─── Install dependencies and build ──────────────────────────────────────────
echo ""
echo "Installing dev dependencies (TypeScript)..."
npm install

echo ""
echo "Compiling TypeScript..."
npm run build

# ─── Create required directories ─────────────────────────────────────────────
mkdir -p geo-cache
echo "Created geo-cache/ directory"

# ─── Check for existing identity ─────────────────────────────────────────────
if [ -f "spore-identity.json" ]; then
    NODE_ID=$(node -e "try{const i=require('./spore-identity.json');console.log(i.nodeId.slice(0,16)+'...')}catch(e){console.log('(unknown)')}")
    echo "Existing node identity: $NODE_ID"
else
    echo "Node identity will be generated on first run"
fi

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║        Installation Complete!         ║"
echo "╚═══════════════════════════════════════╝"
echo ""
echo "Start the spore node:"
echo "  node dist/index.js"
echo ""
echo "Or with environment variables:"
echo "  BRAIN_URL=http://5.78.193.141:41739 node dist/index.js"
echo "  MESH_PORT=41740 GEO_DIR=./geo-cache node dist/index.js"
echo ""
echo "To add known peers on startup:"
echo "  PEERS=192.168.1.100:41740,192.168.1.101:41740 node dist/index.js"
echo ""
echo "To run in background (Linux/Termux):"
echo "  nohup node dist/index.js > spore.log 2>&1 &"
echo "  echo \$! > spore.pid"
echo ""
echo "To stop:"
echo "  kill \$(cat spore.pid)"
