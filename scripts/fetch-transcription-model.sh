#!/usr/bin/env bash
# Download the ByteDance piano transcription model (Kong et al. 2021, MIT licence,
# Zenodo record 4034264, ~165 MB) and convert it once to ONNX:
#   app/src-tauri/resources/piano-transcription.onnx  (bundled with the app)
# The conversion runs in a throwaway uv environment with PyTorch; the app itself
# only needs onnxruntime. Re-running does nothing once the .onnx exists.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/app/src-tauri/resources/piano-transcription.onnx"
CACHE="$ROOT/engine/build/transcription"
CKPT="$CACHE/CRNN_note_F1=0.9677_pedal_F1=0.9186.pth"
URL="https://zenodo.org/record/4034264/files/CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth?download=1"
SHA256="c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141"

if [[ -f "$DEST" ]]; then
  echo "already present: $DEST" >&2
  exit 0
fi
command -v uv >/dev/null || { echo "uv is required (https://docs.astral.sh/uv/)" >&2; exit 1; }
mkdir -p "$CACHE"
if [[ ! -f "$CKPT" ]]; then
  echo "downloading the checkpoint (~165 MB) from zenodo.org…" >&2
  curl -fL --retry 3 -o "$CKPT.part" "$URL"
  mv "$CKPT.part" "$CKPT"
fi
if command -v shasum >/dev/null; then got="$(shasum -a 256 "$CKPT" | cut -d' ' -f1)"
else got="$(sha256sum "$CKPT" | cut -d' ' -f1)"; fi
if [[ "$got" != "$SHA256" ]]; then
  echo "checksum mismatch for $CKPT (got $got): delete it and retry" >&2
  exit 1
fi

# PyTorch: the newest wheels that exist for this machine. Intel Macs stop at
# torch 2.2.2, which needs numpy < 2.
WITH=(--with "piano_transcription_inference==0.0.6" --with onnx --with onnxruntime)
if [[ "$(uname -s)-$(uname -m)" == Darwin-x86_64 ]]; then
  WITH+=(--with "torch==2.2.2" --with "numpy<2" --with "onnxruntime<1.24")
else
  WITH+=(--with torch)
fi
echo "converting to ONNX (a few minutes the first time: uv installs PyTorch in a temporary environment)…" >&2
uv run --no-project --python 3.12 "${WITH[@]}" \
  python "$ROOT/scripts/transcription/export_onnx.py" "$CKPT" "$DEST.part"
mv "$DEST.part" "$DEST"
echo "saved $DEST" >&2
