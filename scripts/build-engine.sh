#!/usr/bin/env bash
# Build the Python engine as a single-file sidecar binary for Tauri:
#   app/src-tauri/binaries/engine-<target-triple>   (e.g. engine-aarch64-apple-darwin)
# PyInstaller is GPL with the bootloader exception: fine for the bundled binary.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRIPLE="${TARGET_TRIPLE:-$(rustc -vV | sed -n 's/^host: //p')}"
OUT="$ROOT/app/src-tauri/binaries"
WORK="$ROOT/engine/build"

cd "$ROOT/engine"
uv run --quiet --with 'pyinstaller>=6' pyinstaller \
  --onefile --noconfirm --clean \
  --name "engine-$TRIPLE" \
  --distpath "$OUT" --workpath "$WORK" --specpath "$WORK" \
  pyinstaller_entry.py
echo "built $OUT/engine-$TRIPLE" >&2

# Smoke test: the binary must answer ping on stdout.
echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | "$OUT/engine-$TRIPLE" 2>/dev/null | grep -q '"version"' \
  && echo "ping OK" >&2
