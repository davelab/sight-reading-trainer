#!/usr/bin/env bash
# Build the Python engine as a single-file sidecar binary for Tauri:
#   app/src-tauri/binaries/engine-<target-triple>   (e.g. engine-aarch64-apple-darwin)
# PyInstaller is GPL with the bootloader exception: fine for the bundled binary.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# rustup puts Rust on the PATH only for shells opened after installing it.
if ! command -v rustc >/dev/null 2>&1 && [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi
for tool in rustc uv; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: '$tool' not found. Install it (see README, 'Installazione su Mac')," >&2
    echo "       then open a new Terminal window and try again." >&2
    exit 1
  fi
done
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
