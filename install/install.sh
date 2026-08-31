#!/bin/bash
#
# Makes the clipper helper start automatically when you log in.
#
# It writes a macOS "LaunchAgent" — a small file that tells macOS to keep a
# program running for you — and then starts it. Run it once:
#
#   bash install/install.sh
#
# To undo:  bash install/uninstall.sh

set -euo pipefail

LABEL="com.liraz.wiki-clipper"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$PROJECT_DIR/logs"

# --- checks -----------------------------------------------------------------

if [ ! -f "$PROJECT_DIR/config.json" ]; then
  echo "No config.json yet."
  echo "Copy config.example.json to config.json and set your vault path first."
  exit 1
fi

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Node.js is not installed (or not on the PATH). Install it, then run this again."
  exit 1
fi

echo "Node:    $NODE_BIN"
echo "Project: $PROJECT_DIR"

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

# --- write the LaunchAgent --------------------------------------------------

cat > "$PLIST" <<PLIST_END
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$PROJECT_DIR/server/server.js</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$LOG_DIR/clipper.log</string>

    <key>StandardErrorPath</key>
    <string>$LOG_DIR/clipper.error.log</string>
</dict>
</plist>
PLIST_END

# --- (re)start it -----------------------------------------------------------

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"

sleep 1

PORT="$(node -e "console.log(require('$PROJECT_DIR/config.json').port || 4141)")"

if curl -fsS "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
  echo
  echo "Done — the clipper helper is running and will start again at login."
  echo "Logs: $LOG_DIR/clipper.log"
else
  echo
  echo "The helper did not answer on port $PORT. Check the log:"
  echo "  $LOG_DIR/clipper.error.log"
  exit 1
fi
