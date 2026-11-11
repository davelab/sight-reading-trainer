# Score Studio

App desktop per macOS che trasforma uno spartito (MusicXML, e in seguito PDF)
in una partitura interattiva da studiare al pianoforte digitale: playback
sincronizzato, modalità "segui" via MIDI, analisi armonica e pattern ripetuti.

- Specifica completa: [`docs/SPEC.md`](docs/SPEC.md)
- Istruzioni per Claude Code: [`CLAUDE.md`](CLAUDE.md)

## Stato: milestone M2 — MIDI e modalità segui

### M1 — partitura e playback

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

### M2 — MIDI e modalità segui

| Fatto | Dove |
|---|---|
| Ingresso MIDI con midir: elenco dispositivi (aggiornato ogni 3 s), selezione, note on/off | `src-tauri/src/midi.rs`, `components/MidiPanel` |
| Modalità «Segui»: il cursore aspetta ogni accordo finché tutte le sue note sono suonate | `src-tauri/src/follow.rs` |
| Rispetta mani (solo destra/sinistra) e loop A–B; ▶ esce dalla modalità e riparte da lì | `follow.rs`, `commands.rs` |
| Esito per battuta (`follow:result {measure, correct, wrong}`): battute verdi o rosse, riepilogo in alto | `lib/overlay.ts`, `stores/midi.ts` |
| Tastiera a schermo: note attese (giallo), suonate (blu), giuste/sbagliate (verde/rosso) | `components/Keyboard` |
| Tastiera cliccabile: suona col synth e alimenta la modalità segui come un piano MIDI | comando `virtual_note` |

Estensioni al contratto IPC della specifica: `playback:position` porta anche
`following` ed `expectedPitches`; nuovo comando `virtual_note {pitch, on}`;
`set_follow_mode {enabled}` restituisce se la modalità è attiva;
`midi_list_devices` restituisce `{devices, selected}`; ogni evento di playback
porta il numero di `measure`. Le note del piano MIDI non passano dal synth (il
piano suona già da sé).

Prossime: M3 (analisi armonica), M4 (pattern), M5 (OMR), M6 (packaging).
Vedi la roadmap in `docs/SPEC.md`.

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

## Test end-to-end manuale (criterio di uscita M2)

«Col piano collegato il cursore avanza solo sulle note corrette.»

1. Collega il piano digitale via USB o Bluetooth MIDI (per il Bluetooth:
   Configurazione MIDI Audio → Finestra MIDI Studio → Bluetooth) e avvia l'app.
2. Entro 3 s il piano compare nel menu accanto ad «Apri…»: selezionalo.
   Suonando, i tasti premuti si colorano di blu sulla tastiera a schermo.
3. Apri il Minuetto e premi «Segui». Il cursore si ferma su re⁵ + sol³.
4. Suona solo re⁵: il cursore non si muove (manca sol³). Aggiungi sol³: passa a sol⁴.
5. Suona una nota sbagliata: il tasto diventa rosso, il cursore resta fermo.
6. Completa la battuta 1: la battuta si colora di rosso (c'era un errore);
   suona la battuta 2 senza errori: si colora di verde. In alto compare
   «giuste · sbagliate · %».
7. «Destra»: il cursore aspetta solo la mano destra. Con un loop A–B attivo,
   alla fine del loop il cursore torna ad A.
8. ▶ esce dalla modalità segui e suona dal punto raggiunto.
9. Scollega il piano: entro 3 s sparisce dal menu.

Senza piano, i passi 3–8 si provano cliccando la tastiera a schermo. Questa
variante è stata eseguita in automatico su Linux (Xvfb + xdotool): battuta 1
rossa con 1 errore, battuta 2 verde, cursore fermo su mi⁵ + do⁴ della battuta
3, «11 giuste · 1 sbagliate · 92%». Il percorso midir con un piano vero va
verificato sul Mac (nel container non c'è un sequencer MIDI).

## Note di architettura

- Il tempo reale vive solo in Rust. Lo scheduler gira dentro la callback
  audio in sotto-blocchi di 64 frame (≈ 1,5 ms): il look-ahead è il buffer di
  uscita stesso, senza thread temporizzati né jitter. Senza dispositivo audio
  un clock a 5 ms fa avanzare comunque trasporto e cursore.
- Le posizioni sono in millisecondi di partitura (tempo al 100 %); il tempo
  scala solo l'avanzamento, quindi cambiarlo non richiede di rinviare gli eventi.
- Le annotazioni future si agganciano a (battuta, tempo), mai agli ID delle note.
- La modalità segui è una macchina a stati pura (`follow.rs`): gli accordi sono
  le note con onset entro 15 ms; una nota già suonata nell'accordo e ripetuta
  non conta né giusta né sbagliata. Mentre segue, il clock è fermo e il
  trasporto viene spostato sull'accordo atteso, così cursore e ▶ restano coerenti.
