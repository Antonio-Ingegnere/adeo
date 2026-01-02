#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="python3"
if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
  PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
fi

API_HOST="127.0.0.1"
API_PORT="8000"
NOTIFY_PORT="${ADEO_NOTIFY_PORT:-48623}"
DB_PATH="${ADEO_DB_PATH:-$HOME/Library/Application Support/Adeo/tasks.db}"

start_api() {
  ADEO_API_HOST="$API_HOST" \
  ADEO_API_PORT="$API_PORT" \
  ADEO_DB_PATH="$DB_PATH" \
  ADEO_NOTIFY_PORT="$NOTIFY_PORT" \
  "$PYTHON_BIN" "$ROOT_DIR/server/app.py" &
  API_PID=$!
}

stop_api() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
  fi
}

stop_agent() {
  if [[ -n "${AGENT_PID:-}" ]]; then
    kill "$AGENT_PID" 2>/dev/null || true
  fi
}

setup_notify_agent() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    return
  fi
  local agent_dir="$ROOT_DIR/macos/notify-agent"
  local build_bin="$agent_dir/.build/release/AdeoNotifyAgent"
  local agent_app="$HOME/Applications/AdeoNotifyAgent.app"
  local plist_path="$HOME/Library/LaunchAgents/com.yourcompany.adeo.notify.plist"
  local log_path="$HOME/Library/Logs/AdeoNotifyAgent.log"

  if [[ ! -x "$build_bin" ]]; then
    (cd "$agent_dir" && swift build -c release)
  fi

  mkdir -p "$agent_app/Contents/MacOS"
  cp "$build_bin" "$agent_app/Contents/MacOS/AdeoNotifyAgent"
  cp "$agent_dir/Info.plist" "$agent_app/Contents/Info.plist"
  xattr -dr com.apple.quarantine "$agent_app" >/dev/null 2>&1 || true
  codesign --force --deep --sign - "$agent_app" >/dev/null 2>&1 || true

  cat > "$plist_path" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.yourcompany.adeo.notify</string>
    <key>ProgramArguments</key>
    <array>
      <string>__AGENT_BIN__</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>__LOG_PATH__</string>
    <key>StandardErrorPath</key>
    <string>__LOG_PATH__</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>ADEO_NOTIFY_PORT</key>
      <string>__NOTIFY_PORT__</string>
      <key>ADEO_NOTIFY_LOG</key>
      <string>__LOG_PATH__</string>
    </dict>
  </dict>
</plist>
PLIST

  sed -i '' \
    -e "s|__AGENT_BIN__|$agent_app/Contents/MacOS/AdeoNotifyAgent|" \
    -e "s|__LOG_PATH__|$log_path|" \
    -e "s|__NOTIFY_PORT__|$NOTIFY_PORT|" \
    "$plist_path"

  echo "$(date '+%Y-%m-%d %H:%M:%S') dev-start: preparing notify agent" >>"$log_path"

  if [[ ! -x "$agent_app/Contents/MacOS/AdeoNotifyAgent" ]]; then
    echo "Notification agent binary missing at $agent_app/Contents/MacOS/AdeoNotifyAgent" | tee -a "$log_path" >&2
    return
  fi

  ADEO_NOTIFY_PORT="$NOTIFY_PORT" \
  ADEO_NOTIFY_LOG="$log_path" \
  "$agent_app/Contents/MacOS/AdeoNotifyAgent" >>"$log_path" 2>&1 &
  AGENT_PID=$!
  echo "$(date '+%Y-%m-%d %H:%M:%S') dev-start: notify agent pid=$AGENT_PID" >>"$log_path"

  sleep 0.5
  if ! kill -0 "$AGENT_PID" >/dev/null 2>&1; then
    wait "$AGENT_PID" || true
    echo "$(date '+%Y-%m-%d %H:%M:%S') dev-start: notify agent exited early" >>"$log_path"
    return
  fi

  for _ in {1..10}; do
    if nc -z 127.0.0.1 "$NOTIFY_PORT" >/dev/null 2>&1; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') dev-start: notify agent listening on $NOTIFY_PORT" >>"$log_path"
      return
    fi
    sleep 0.3
  done
  echo "$(date '+%Y-%m-%d %H:%M:%S') dev-start: trying open -a for notify agent" >>"$log_path"
  open -a "$agent_app" >/dev/null 2>&1 || true
  for _ in {1..10}; do
    if nc -z 127.0.0.1 "$NOTIFY_PORT" >/dev/null 2>&1; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') dev-start: notify agent listening after open -a" >>"$log_path"
      return
    fi
    sleep 0.3
  done
  echo "Notification agent failed to listen on 127.0.0.1:$NOTIFY_PORT" | tee -a "$log_path" >&2
}

trap 'stop_agent; stop_api' EXIT

setup_notify_agent
start_api

ADEO_API_URL="http://$API_HOST:$API_PORT" electron "$ROOT_DIR"
