#!/usr/bin/env bash
# Install the phd-tracker daemon as a per-user launchd agent (auto-start at login).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-$(command -v python3)}"
LABEL="com.phdtracker.daemon"
PLIST_SRC="$REPO_DIR/launchd/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ -z "$PYTHON" ]]; then
    echo "python3 not found on PATH; set PYTHON=/path/to/python3 and retry" >&2
    exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s|__PYTHON__|$PYTHON|g" -e "s|__WORKDIR__|$REPO_DIR|g" \
    "$PLIST_SRC" > "$PLIST_DST"

# Reload if already installed.
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

echo "Installed and loaded $PLIST_DST"
echo "Python:  $PYTHON"
echo "Workdir: $REPO_DIR"
echo
echo "Tail logs with: tail -f \"$REPO_DIR/daemon.log\" \"$REPO_DIR/daemon.err.log\""
echo "Uninstall with: launchctl unload \"$PLIST_DST\" && rm \"$PLIST_DST\""
