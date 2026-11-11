# Score Studio

App desktop per macOS che trasforma uno spartito (MusicXML, e in seguito PDF)
in una partitura interattiva da studiare al pianoforte digitale: playback
sincronizzato, modalità "segui" via MIDI, analisi armonica e pattern ripetuti.

- Specifica completa: [`docs/SPEC.md`](docs/SPEC.md)
- Istruzioni per Claude Code: [`CLAUDE.md`](CLAUDE.md)

## Stato: milestone M1 — partitura e playback

| Fatto | Dove |
|---|---|
| Monorepo `app/` (Tauri 2 + React/TS), `engine/` (Python), `shared/schema/` | — |
| Apertura MusicXML / `.mxl` da «Apri…», drag-and-drop o riga di comando | `app/src/lib/loadScore.ts`, `src-tauri/src/score.rs` |
| Render Verovio WASM a larghezza finestra, zoom, scroll continuo o a pagine | `app/src/lib/verovio.ts`, `components/ScoreView` |
| Eventi di playback dal timemap di Verovio, inviati a Rust una volta per brano | `app/src/lib/timemap.ts` → `playback_load` |
| Scheduler in Rust: play/pausa/seek, tempo 25–200 %, loop A–B, mani separate | `src-tauri/src/playback.rs` |
| Synth rustysynth + cpal con SoundFont in `resources/` (synth di riserva se manca) | `src-tauri/src/synth.rs` |
| `playback:position` a ~60 Hz, note correnti evidenziate in giallo + tastiera | `src-tauri/src/lib.rs`, `lib/overlay.ts`, `components/Keyboard` |
| Sidecar JSON-RPC: `ping`, `score.normalize`; schema pydantic → JSON Schema → TS | `engine/`, `scripts/gen-types.sh` |

Prossime: M2 (MIDI e modalità segui), M3 (analisi armonica), M4 (pattern),
M5 (OMR), M6 (packaging). Vedi la roadmap in `docs/SPEC.md`.

## Requisiti

- macOS 11+ (Apple Silicon o Intel), Xcode Command Line Tools
- Rust stabile (`rustup`), Node 20+ con pnpm, [uv](https://docs.astral.sh/uv/) (Python 3.12)

## Avvio

```sh
scripts/fetch-soundfont.sh        # facoltativo: SoundFont GeneralUser GS (~32 MB) in resources/
cd app && pnpm install
pnpm tauri dev                    # app desktop
```

Senza SoundFont l'app usa un synth di riserva più semplice; la barra in basso
indica quale è attivo. `SCORE_STUDIO_SOUNDFONT=/percorso/file.sf2` ne forza uno.

`pnpm dev` da solo apre l'interfaccia nel browser: rendering e cursore
funzionano, il playback no (serve il core Rust).

## Comandi

| | |
|---|---|
| Test engine | `cd engine && uv run pytest` |
| Test frontend | `cd app && pnpm test` |
| Test Rust | `cd app/src-tauri && cargo test` (con SoundFont: `cargo test -- --ignored`) |
| Lint | `pnpm lint`, `uv run ruff check`, `cargo clippy` |
| Tipi dal contratto | `scripts/gen-types.sh` (dopo ogni modifica a `engine/score_engine/models.py`) |
| Sidecar | `scripts/build-engine.sh` → `app/src-tauri/binaries/engine-<target>` |
| Build app | `cd app && pnpm tauri build` |

## Test end-to-end manuale (criterio di uscita M1)

Fixture: `engine/tests/fixtures/minuet-in-g.musicxml` — Minuetto in sol,
BWV Anh. 114 (Petzold), arrangiamento semplificato a due pentagrammi, 32
battute in 3/4, ♩ = 120, pubblico dominio.

1. `scripts/fetch-soundfont.sh`, poi `cd app && pnpm tauri dev`.
2. Trascina il fixture nella finestra (oppure «Apri…»). La partitura appare
   incisa a larghezza finestra; la barra in basso mostra `0:00 / 0:48` e
   `SoundFont: GeneralUser-GS.sf2`. Le prime note (re⁵ e sol³) sono gialle.
3. Premi ▶ (o spazio): si sente il pianoforte. Il cursore giallo segue le note
   in entrambe le mani e la tastiera mostra gli stessi tasti. Dopo 3 s esatti
   il cursore è sul primo tempo della battuta 3 (1,5 s per battuta).
4. Ridimensiona la finestra durante il playback: la partitura si re-impagina e
   il cursore resta sulle note giuste.
5. Tempo al 50 %: la battuta 3 arriva dopo 6 s; al 200 % dopo 1,5 s.
6. Clicca una nota: il playback salta lì. «A» su una nota, «B» più avanti:
   il passaggio si ripete in loop finché non premi ✕.
7. «Destra» / «Sinistra»: suona solo quella mano, il cursore resta su entrambe.
8. Il brano finisce a `0:48` e il pulsante torna ▶; premendolo riparte da capo.
9. Apri lo stesso brano compresso (`.mxl`, es. esportato da MuseScore): si
   comporta allo stesso modo.

Il passo 3 è stato verificato anche in automatico su Linux (Xvfb, senza audio):
dopo 3 s di playback le note evidenziate sono mi⁵ e do⁴, inizio battuta 3.

## Note di architettura

- Il tempo reale vive solo in Rust. Lo scheduler gira dentro la callback
  audio in sotto-blocchi di 64 frame (≈ 1,5 ms): il look-ahead è il buffer di
  uscita stesso, senza thread temporizzati né jitter. Senza dispositivo audio
  un clock a 5 ms fa avanzare comunque trasporto e cursore.
- Le posizioni sono in millisecondi di partitura (tempo al 100 %); il tempo
  scala solo l'avanzamento, quindi cambiarlo non richiede di rinviare gli eventi.
- Le annotazioni future si agganciano a (battuta, tempo), mai agli ID delle note.
