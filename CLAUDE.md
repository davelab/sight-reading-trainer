# Score Studio

App desktop macOS per studiare pianoforte: MusicXML/PDF → partitura interattiva,
playback, input MIDI dal piano digitale, analisi armonica e pattern ripetuti.
Specifica completa: docs/SPEC.md — leggila prima di iniziare una milestone.

## Architettura (non negoziabile)
- app/src: React + TypeScript + Vite. UI, rendering Verovio (WASM), overlay.
- app/src-tauri: Rust (Tauri 2). Unico responsabile di MIDI (midir), audio
  (rustysynth + cpal) e clock del playback. Il frontend non temporizza mai l'audio.
- engine/: Python 3.12 con uv. Sidecar JSON-RPC 2.0 su stdin/stdout, una riga
  per messaggio; log solo su stderr. Non sa nulla di audio o UI.
- Web MIDI NON è disponibile in WKWebView: tutto il MIDI passa da Rust.
- Le annotazioni si agganciano a (battuta, tempo), mai agli ID delle note.

## Contratto dati
- Fonte unica: engine/score_engine/models.py (pydantic v2).
- Rigenera schema e tipi TS con scripts/gen-types.sh dopo ogni modifica.
- Non modificare a mano app/src/types/.

## Comandi
- Dev app: cd app && pnpm tauri dev
- Test engine: cd engine && uv run pytest
- Test Rust: cd app/src-tauri && cargo test
- Lint: pnpm lint, uv run ruff check, cargo clippy
- Build sidecar: scripts/build-engine.sh

## Regole di lavoro
- Una milestone alla volta; chiudila solo quando i criteri di accettazione
  in docs/SPEC.md passano.
- Ogni funzione di analisi ha un test su un file in engine/tests/fixtures/.
- Licenze: niente dipendenze GPL/AGPL nel core senza chiedere. Eccezione
  approvata: homr (AGPL-3.0) per l'OMR, solo nel sidecar `omr` (vedi README,
  «Licenze»).
- Commit piccoli, messaggi in inglese, codice e commenti in inglese.
