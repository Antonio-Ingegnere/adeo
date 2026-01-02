#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="$ROOT_DIR/macos/notify-agent"
AGENT_APP="$HOME/Applications/AdeoNotifyAgent.app"
LABEL="com.yourcompany.adeo.notify"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Notification prompt is macOS-only."
  exit 1
fi

(cd "$AGENT_DIR" && swift build -c release)

mkdir -p "$AGENT_APP/Contents/MacOS"
cp "$AGENT_DIR/.build/release/AdeoNotifyAgent" "$AGENT_APP/Contents/MacOS/AdeoNotifyAgent"
cp "$AGENT_DIR/Info.plist" "$AGENT_APP/Contents/Info.plist"
xattr -dr com.apple.quarantine "$AGENT_APP" >/dev/null 2>&1 || true
codesign --force --deep --sign - "$AGENT_APP" >/dev/null 2>&1 || true

launchctl stop "gui/$UID/$LABEL" >/dev/null 2>&1 || true

ADEO_NOTIFY_PROMPT=1 \
ADEO_NOTIFY_LOG="$HOME/Library/Logs/AdeoNotifyAgent.log" \
"$AGENT_APP/Contents/MacOS/AdeoNotifyAgent" &
PROMPT_PID=$!

sleep 5
if kill -0 "$PROMPT_PID" >/dev/null 2>&1; then
  kill "$PROMPT_PID" >/dev/null 2>&1 || true
fi

launchctl kickstart -k "gui/$UID/$LABEL" >/dev/null 2>&1 || true
