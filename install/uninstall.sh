#!/bin/bash
#
# Stops the clipper helper and removes it from login startup.
#
#   bash install/uninstall.sh

set -euo pipefail

LABEL="com.liraz.wiki-clipper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
rm -f "$PLIST"

echo "Stopped, and it will no longer start at login."
echo "Nothing in your vault was touched."
