#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

npm run build

stage_python() {
  rm -rf python/staged
  if [[ -d "$1" ]]; then
    cp -R "$1" python/staged
  fi
}

built_any=0
for arch in arm64 x64; do
  src="python/mac-$arch"
  if [[ ! -d "$src" ]]; then
    echo "Skipping mac-$arch build: $src not found (see README.md for bundling steps)"
    continue
  fi
  stage_python "$src"
  npx electron-builder --mac --"$arch"
  built_any=1
done

rm -rf python/staged

if [[ "$built_any" -eq 0 ]]; then
  echo "No macOS Python bundles found under python/mac-arm64 or python/mac-x64 — see README.md." >&2
  exit 1
fi
