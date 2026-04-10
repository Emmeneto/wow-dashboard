#!/bin/bash
# ============================================
#  WoW Dashboard - Auto-Sync Setup (Mac/Linux)
# ============================================

cd "$(dirname "$0")"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed! Download from https://nodejs.org/"
    exit 1
fi

# Install dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Initial upload
echo ""
echo "Running initial sync..."
node upload.js
echo ""

# Create launchd plist for auto-start on Mac
if [[ "$OSTYPE" == "darwin"* ]]; then
    PLIST_PATH="$HOME/Library/LaunchAgents/com.wowdashboard.sync.plist"
    SCRIPT_DIR="$(pwd)"

    cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.wowdashboard.sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>${SCRIPT_DIR}/sync.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${SCRIPT_DIR}/sync.log</string>
    <key>StandardErrorPath</key>
    <string>${SCRIPT_DIR}/sync-error.log</string>
</dict>
</plist>
EOF

    launchctl load "$PLIST_PATH" 2>/dev/null
    echo "============================================"
    echo "  Setup complete! (Mac)"
    echo "============================================"
    echo ""
    echo "Auto-sync is now running in the background."
    echo "It will start automatically on login."
    echo ""
    echo "To stop: launchctl unload $PLIST_PATH"
    echo "============================================"
else
    echo "============================================"
    echo "  Setup complete! (Linux)"
    echo "============================================"
    echo ""
    echo "Run ./sync.sh to start syncing."
    echo "Add to your crontab or systemd for auto-start."
    echo "============================================"
fi
