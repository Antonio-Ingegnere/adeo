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
for arch in x64 arm64; do
  src="python/linux-$arch"
  if [[ ! -d "$src" ]]; then
    echo "Skipping linux-$arch build: $src not found (see README.md for bundling steps)"
    continue
  fi
  stage_python "$src"
  npx electron-builder --linux --"$arch"
  built_any=1
done

rm -rf python/staged

if [[ "$built_any" -eq 0 ]]; then
  echo "No Linux Python bundles found under python/linux-x64 or python/linux-arm64 — see README.md." >&2
  exit 1
fi
