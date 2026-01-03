#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="$ROOT_DIR/macos/notify-agent"
AGENT_APP="$HOME/Applications/AdeoNotifyAgent.app"
LABEL="com.yourcompany.adeo.notify2"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Notification prompt is macOS-only."
  exit 1
fi

(cd "$AGENT_DIR" && swift build -c release)

mkdir -p "$AGENT_APP/Contents/MacOS"
cp "$AGENT_DIR/.build/release/AdeoNotifyAgent" "$AGENT_APP/Contents/MacOS/AdeoNotifyAgent"
cp "$AGENT_DIR/Info.plist" "$AGENT_APP/Contents/Info.plist"
mkdir -p "$AGENT_APP/Contents/Resources"
if [[ -f "$ROOT_DIR/assets/icon.png" && -x "$(command -v sips)" && -x "$(command -v iconutil)" ]]; then
  iconset_dir="$(mktemp -d)/AdeoNotifyAgent.iconset"
  mkdir -p "$iconset_dir"
  sips -z 16 16 "$ROOT_DIR/assets/icon.png" --out "$iconset_dir/icon_16x16.png" >/dev/null
  sips -z 32 32 "$ROOT_DIR/assets/icon.png" --out "$iconset_dir/icon_16x16@2x.png" >/dev/null
  sips -z 32 32 "$ROOT_DIR/assets/icon.png" --out "$iconset_dir/icon_32x32.png" >/dev/null
  sips -z 64 64 "$ROOT_DIR/assets/icon.png" --out "$iconset_dir/icon_32x32@2x.png" >/dev/null
  sips -z 128 128 "$ROOT_DIR/assets/icon.png" --out "$iconset_dir/icon_128x128.png" >/dev/null
  sips -z 256 256 "$ROOT_DIR/assets/icon.png" --out "$iconset_dir/icon_128x128@2x.png" >/dev/null
  sips -z 256 256 "$ROOT_DIR/assets/icon.png" --out "$iconset_dir/icon_256x256.png" >/dev/null
  sips -z 512 512 "$ROOT_DIR/assets/icon.png" --out "$iconset_dir/icon_256x256@2x.png" >/dev/null
  sips -z 512 512 "$ROOT_DIR/assets/icon.png" --out "$iconset_dir/icon_512x512.png" >/dev/null
  sips -z 1024 1024 "$ROOT_DIR/assets/icon.png" --out "$iconset_dir/icon_512x512@2x.png" >/dev/null
  iconutil -c icns "$iconset_dir" -o "$AGENT_APP/Contents/Resources/AdeoNotifyAgent.icns"
  rm -rf "$(dirname "$iconset_dir")"
fi
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
