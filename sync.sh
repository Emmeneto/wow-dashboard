#!/bin/bash
# ============================================
#  WoW Dashboard - Auto-Sync (Mac/Linux)
# ============================================

cd "$(dirname "$0")"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed! Download from https://nodejs.org/"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

echo "Starting auto-sync..."
node sync.js
