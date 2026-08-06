#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="python3"
if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
  PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
fi

API_HOST="127.0.0.1"
API_PORT="8000"
DB_PATH="${ADEO_DB_PATH:-$HOME/Library/Application Support/Adeo/tasks.db}"

start_api() {
  ADEO_API_HOST="$API_HOST" \
  ADEO_API_PORT="$API_PORT" \
  ADEO_DB_PATH="$DB_PATH" \
  "$PYTHON_BIN" "$ROOT_DIR/server/app.py" &
  API_PID=$!
}

stop_api() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
  fi
}

trap 'stop_api' EXIT

start_api

ADEO_API_URL="http://$API_HOST:$API_PORT" electron "$ROOT_DIR"
