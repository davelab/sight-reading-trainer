#!/usr/bin/env bash
# Download a free General MIDI SoundFont (GeneralUser GS, ~32 MB) into
# app/src-tauri/resources/ for local development. Piano is program 0.
# Licence: "use without restriction, private or commercial" — see
# https://github.com/mrbumpy409/GeneralUser-GS/blob/main/documentation/LICENSE.txt
# Which SoundFont ships with the app is still an open decision (docs/SPEC.md).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/app/src-tauri/resources/GeneralUser-GS.sf2"
URL="https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2"

if [[ -f "$DEST" ]]; then
  echo "already present: $DEST" >&2
  exit 0
fi
curl -fL --retry 3 -o "$DEST.part" "$URL"
mv "$DEST.part" "$DEST"
echo "saved $DEST" >&2
