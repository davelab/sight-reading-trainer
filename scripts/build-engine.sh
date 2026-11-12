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

# Two sidecars from the same package (docs/SPEC.md, risks: sidecar size):
#   engine  analysis only, light, starts fast;
#   omr     PDF import with homr (AGPL-3.0), onnxruntime and OpenCV, and
#           audio transcription (same onnxruntime, plus libsndfile and scipy),
#           and the second reading of measures by Claude (anthropic SDK).
# Pass "engine" or "omr" to build only one.
WHAT="${1:-all}"

# PyInstaller's binary cache, kept inside the project instead of the user's
# Library: an interrupted build can corrupt it ("bincache may be corrupted").
export PYINSTALLER_CONFIG_DIR="$WORK/pyinstaller-cache"

pyinstaller() {
  local name="$1"; shift
  (cd "$ROOT/engine" && uv run --quiet --with 'pyinstaller>=6' pyinstaller \
    --onefile --noconfirm --clean --log-level WARN \
    --name "$name-$TRIPLE" \
    --distpath "$OUT" --workpath "$WORK/$name" --specpath "$WORK" \
    "$@" pyinstaller_entry.py)
}

build() {
  local name="$1"; shift
  if ! pyinstaller "$name" "$@"; then
    echo "build of $name failed: clearing the PyInstaller cache and retrying once" >&2
    rm -rf "$PYINSTALLER_CONFIG_DIR" "$WORK/$name"
    pyinstaller "$name" "$@"
  fi
  echo "built $OUT/$name-$TRIPLE" >&2
  # Smoke test: the binary must answer ping on stdout.
  echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | "$OUT/$name-$TRIPLE" 2>/dev/null | grep -q '"version"' \
    && echo "$name: ping OK" >&2
}

if [[ "$WHAT" == all || "$WHAT" == engine ]]; then
  build engine \
    --exclude-module homr --exclude-module onnxruntime --exclude-module cv2 \
    --exclude-module rapidocr --exclude-module pypdfium2 \
    --exclude-module soundfile --exclude-module scipy --exclude-module anthropic
fi
if [[ "$WHAT" == all || "$WHAT" == omr ]]; then
  build omr \
    --collect-data homr --collect-all rapidocr --collect-all pypdfium2 \
    --collect-binaries onnxruntime --collect-all _soundfile_data
fi
