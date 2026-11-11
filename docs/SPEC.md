# Score Studio — Specifica di progetto

_Versione del 2026-11-11, esportata dal documento di specifica._

## Visione e obiettivi

Score Studio è un'app desktop per macOS che trasforma uno spartito (PDF o MusicXML) in una partitura interattiva da studiare al pianoforte digitale, con analisi armonica e pattern ripetuti evidenziati automaticamente.

**Per chi:** pianisti amatori e studenti intermedi che studiano repertorio proprio, non da una libreria chiusa, con un piano digitale collegato via USB o Bluetooth MIDI.

**Obiettivi del prodotto:**

1. Importare un brano da PDF o MusicXML e vederlo come partitura incisa, non come immagine.
2. Ascoltarlo con playback sincronizzato (cursore sulla nota, tempo regolabile, loop A–B).
3. Suonarlo sul piano digitale con modalità "segui": il cursore avanza solo sulle note corrette.
4. Capirlo: tonalità, modulazioni, accordi e numeri romani annotati sulla partitura.
5. Leggerlo più in fretta: battute e frasi ripetute colorate per gruppo, così si studia una volta ciò che ritorna.

**Differenziazione:** nessun prodotto esaminato unisce import PDF, studio MIDI e analisi automatica; l'evidenziazione dei pattern ripetuti non compare in nessuno. Il punto 5 è il tratto distintivo.

## Analisi di mercato

Il mercato è diviso in tre nicchie che non si parlano: app di studio con MIDI, scanner OMR e strumenti di analisi armonica. Lo spazio libero è la loro unione su Mac desktop.

| Prodotto | PDF/OMR | MIDI dal piano | Analisi armonica | Pattern ripetuti | Piattaforma |
|---|---|---|---|---|---|
| [AnyScore](https://anyscore-landing-page.pages.dev/) | Sì | Sì | No | No | iPad/iPhone |
| [midipiano.app](https://alternativeto.net/software/midipiano-app/about/) | No (MusicXML/MEI) | Sì | No | No | Web, usa Verovio |
| [Soundslice](https://soundslice.com/sheet-music-scanner) | Sì, a pagamento | Solo inserimento note | No | No | Web |
| [PlayScore 2](https://www.scoringnotes.com/reviews/a-review-of-optical-music-recognition-software/) | Sì | No | No | No | iOS, Android, Windows |
| [Second Ear](https://second-ear-landing.pages.dev/tools/roman-numeral-analysis) | No (MusicXML) | No | Sì, con music21 | No | Web |
| [Ivory](https://bedroomproducersblog.com/2026/03/25/ivory-piano-app/) | No (da audio) | No | Accordi | No | Web |

**Lezioni da copiare:**

- AnyScore: individuazione automatica dei punti deboli e loop guidati sulle battute sbagliate.
- Second Ear: numeri romani sotto ogni tempo, note colorate per funzione, parentesi per regioni tonica/predominante/dominante.
- Soundslice: modalità che sovrappone il cursore all'immagine originale del PDF, per chi non ama la re-impaginazione.
- midipiano.app: dimostra che Verovio + MIDI + feedback per mano funziona; codice di riferimento simile in [ftrain/sightreading](https://github.com/ftrain/sightreading) (LGPL-3.0).

## Funzionalità

L'MVP parte da MusicXML e lascia l'import PDF per ultimo, perché l'OMR è il pezzo più incerto e non deve bloccare il resto.

| Area | MVP (v0.1) | Dopo l'MVP |
|---|---|---|
| Import | MusicXML e .mxl (drag-and-drop) | PDF con OMR e schermata di correzione; MIDI |
| Partitura | Render Verovio, zoom, scroll continuo o a pagine | Overlay sull'immagine PDF originale |
| Playback | Synth interno con SoundFont di piano, tempo 25–200%, loop A–B, mano destra/sinistra separate | Uscita MIDI verso il piano digitale; metronomo con count-in |
| MIDI in | Selezione device, tastiera a schermo che mostra le note suonate | Modalità "segui" (wait mode), punteggio per battuta, punti deboli |
| Analisi | Tonalità globale, accordi e numeri romani per tempo | Modulazioni, cadenze, sezioni A/B, regioni funzionali colorate |
| Pattern | Battute identiche e trasposte colorate per gruppo | Frasi ripetute di 2–8 battute, varianti quasi uguali |
| Libreria | Lista brani locale con ultimo tempo e loop salvati | Statistiche di studio, sync iCloud |

**Fuori scope per ora:** editing della notazione oltre alla correzione OMR, input da microfono per piani acustici, strumenti diversi dal pianoforte.

## Architettura

Tre processi con responsabilità separate: il core Rust è l'unico a toccare il tempo reale (MIDI, audio, clock), il sidecar Python fa solo calcoli, il frontend React disegna e interagisce.

```text
Rust tiene il tempo reale, Python fa i calcoli, React mostra

 Frontend · React + TS        Core · Rust (Tauri 2)         Engine · Python
 ┌──────────────────────┐  IPC  ┌──────────────────────┐ stdio ┌──────────────────────┐
 │ Verovio WASM         │ ────▶ │ Playback             │ ────▶ │ Analisi              │
 │  MusicXML → SVG      │ ◀──── │  scheduler e clock   │ ◀──── │  music21: tonalità,  │
 │  timemap note/tempi  │       │  look-ahead 50–100ms │       │  accordi, n. romani  │
 │ Overlay              │       │ Synth                │       │ Pattern              │
 │  accordi e tonalità  │       │  rustysynth + cpal   │       │  impronte di battuta │
 │  pattern colorati    │       │  SoundFont → audio   │       │  esatti e trasposti  │
 │ Interfaccia          │       │ MIDI                 │       │ OMR                  │
 │  trasporto, loop A–B │       │  midir su CoreMIDI   │       │  PDF → MusicXML      │
 │  tastiera a schermo  │       │  input, modalità segui│      │  homr o Audiveris    │
 └──────────▲───────────┘       └──────────▲───────────┘       └──────────────────────┘
            │ drag-and-drop                 │ USB / Bluetooth MIDI
     MusicXML o PDF                   Piano digitale
```

Il frontend costruisce la lista di eventi dal timemap di Verovio e la passa a Rust una volta per brano; Rust suona, legge il piano e rimanda la posizione corrente per il cursore. Il motore Python riceve MusicXML o PDF e restituisce MusicXML o un JSON di analisi, senza sapere nulla di audio o interfaccia.

## Stack tecnologico e licenze

Tutto lo stack del core è permissivo (MIT/BSD/LGPL); gli unici due motori OMR open source maturi sono AGPL-3.0 e vanno tenuti isolati o sostituiti prima di vendere l'app.

| Livello | Libreria | Ruolo | Licenza |
|---|---|---|---|
| Shell desktop | [Tauri 2](https://v2.tauri.app/develop/sidecar) | Finestra, IPC, bundling del sidecar | MIT / Apache-2.0 |
| UI | React + TypeScript + Vite, zustand | Interfaccia e stato | MIT |
| Rendering | Verovio (toolkit WASM) | MusicXML → SVG, timemap, MIDI | LGPL-3.0 |
| MIDI | midir (Rust) | Input/output CoreMIDI | MIT |
| Audio | [rustysynth](https://github.com/sinshu/rustysynth) + cpal | Synth SoundFont in tempo reale | MIT |
| Analisi | music21 (Python) | Tonalità, accordi, numeri romani | BSD-3 |
| Schema dati | pydantic v2 → JSON Schema → TS | Contratto unico Python/TS | MIT |
| OMR (opzione A) | [homr](https://github.com/liebharc/homr) | Immagine → MusicXML, transformer | AGPL-3.0 |
| OMR (opzione B) | [Audiveris](https://en.wikipedia.org/wiki/Audiveris) 5.10 | PDF → MusicXML, con UI di correzione | AGPL-3.0, richiede Java |
| OMR (opzione C) | [oemer](https://pypi.org/project/oemer/) | Immagine → MusicXML, ONNX | da verificare |
| Packaging Python | PyInstaller (arm64) + uv | Binario sidecar | GPL con eccezione bootloader |

Note pratiche:

- **Web MIDI non esiste in WKWebView** (il webview di Tauri su macOS): tutto il MIDI passa da Rust, mai dal frontend.
- **homr** lavora su immagini: il PDF va prima rasterizzato pagina per pagina (300 DPI) con pdfium o pypdfium2. Si concentra su altezze e ritmo, ignorando dinamiche e articolazioni.
- **oemer** impiega 3–5 minuti a pagina anche con GPU: accettabile come job in background con barra di avanzamento, non come import istantaneo.
- **Sidecar Tauri:** il binario va in `src-tauri/binaries/` con il suffisso del target, `engine-aarch64-apple-darwin`, e va autorizzato in `capabilities/default.json`.

## Struttura del repository

Un monorepo con tre radici: `app/` (Tauri, Rust + React), `engine/` (Python) e `shared/schema/` come unica fonte del contratto dati.

```text
score-studio/
├── CLAUDE.md                     # istruzioni per Claude Code
├── app/
│   ├── src/                      # React + TypeScript
│   │   ├── components/
│   │   │   ├── ScoreView/        # render Verovio + overlay annotazioni
│   │   │   ├── Transport/        # play/pausa, tempo, loop A–B, mani
│   │   │   ├── AnalysisPanel/    # tonalità, accordi, pattern, sezioni
│   │   │   ├── Keyboard/         # tastiera a schermo (note attese/suonate)
│   │   │   └── OmrReview/        # correzione dopo import PDF
│   │   ├── lib/
│   │   │   ├── verovio.ts        # wrapper toolkit WASM (load, render, timemap)
│   │   │   ├── timemap.ts        # timemap → eventi di playback
│   │   │   ├── overlay.ts        # annotazioni → elementi SVG (per battuta/tempo)
│   │   │   └── ipc.ts            # invoke/listen tipizzati
│   │   ├── stores/               # zustand: score, analysis, transport, midi
│   │   └── types/                # GENERATI da shared/schema — non editare
│   └── src-tauri/
│       ├── src/
│       │   ├── main.rs
│       │   ├── commands.rs       # comandi esposti al frontend
│       │   ├── midi.rs           # midir: device, input, output
│       │   ├── playback.rs       # scheduler, clock, posizione corrente
│       │   ├── synth.rs          # rustysynth + cpal
│       │   ├── follow.rs         # modalità segui: confronto atteso/suonato
│       │   └── engine.rs         # avvio sidecar, JSON-RPC su stdio
│       ├── binaries/             # engine-aarch64-apple-darwin
│       ├── resources/            # SoundFont di pianoforte
│       ├── capabilities/default.json
│       └── tauri.conf.json
├── engine/
│   ├── pyproject.toml            # uv
│   ├── score_engine/
│   │   ├── __main__.py           # loop JSON-RPC stdin/stdout
│   │   ├── models.py             # pydantic: fonte dello schema
│   │   ├── io/musicxml.py        # parsing, normalizzazione, numerazione battute
│   │   ├── analysis/{key,harmony,patterns,form}.py
│   │   └── omr/{base,homr_backend,audiveris_backend}.py
│   └── tests/fixtures/           # MusicXML di prova (pubblico dominio)
├── shared/schema/                # JSON Schema esportati da pydantic
└── scripts/
    ├── build-engine.sh           # PyInstaller → app/src-tauri/binaries
    └── gen-types.sh              # schema → app/src/types
```

## Contratti dati e IPC

Le annotazioni si agganciano alla posizione musicale (battuta + tempo), mai agli ID delle note: music21 e Verovio assegnano ID diversi, la posizione invece è la stessa.

**Rust ↔ Python: JSON-RPC 2.0, una riga per messaggio su stdin/stdout.** I log del motore vanno su stderr, mai su stdout.

| Metodo | Parametri | Risultato |
|---|---|---|
| `ping` | — | `{version}` |
| `score.normalize` | `{path}` | `{musicxml, measures, parts}` |
| `analyze` | `{musicxml, options}` | `Analysis` (sotto) |
| `omr.run` | `{pdfPath, pages?, backend}` | job id; avanzamento come notifiche `omr.progress`, esito `{musicxml, warnings}` |

**Schema ****`Analysis`**** (fonte: ****`engine/score_engine/models.py`****):**

```json
{
  "schemaVersion": 1,
  "key": [{ "fromMeasure": 1, "toMeasure": 16, "tonic": "G", "mode": "major", "confidence": 0.91 }],
  "chords": [{ "measure": 3, "beat": 1.0, "symbol": "D7", "roman": "V7", "function": "dominant" }],
  "patterns": [
    { "id": "p1", "kind": "exact", "length": 2, "occurrences": [1, 9, 25] },
    { "id": "p2", "kind": "transposed", "interval": "P4", "length": 4, "occurrences": [5, 13] }
  ],
  "sections": [{ "label": "A", "fromMeasure": 1, "toMeasure": 8 }]
}
```

**Frontend ↔ Rust: comandi e eventi Tauri.**

- Comandi: `load_score`, `analyze`, `import_pdf`, `midi_list_devices`, `midi_select`, `playback_load(events)`, `play`, `pause`, `seek`, `set_tempo`, `set_loop`, `set_follow_mode`.
- Eventi emessi da Rust: `playback:position {noteIds, ms}`, `midi:note {pitch, velocity, on}`, `follow:result {measure, correct, wrong}`, `omr:progress {page, total}`.
- `playback_load` riceve dal frontend la lista `[{noteId, pitch, onsetMs, durMs, velocity, staff}]` costruita dal timemap di Verovio, una volta per brano e per cambio di tempo.

**Regola:** i tipi TypeScript in `app/src/types/` sono generati da `shared/schema/` con `scripts/gen-types.sh`; una modifica al contratto parte sempre da `models.py`.

## Algoritmi: analisi armonica e pattern

L'analisi usa music21 per tonalità e accordi; i pattern sono un algoritmo nostro basato su impronte delle battute, semplice e deterministico.

**Tonalità e modulazioni (****`analysis/key.py`****)**

1. Tonalità globale con `score.analyze('key')` (Krumhansl-Schmuckler), con il suo coefficiente come `confidence`.
2. Modulazioni: stessa analisi su finestre scorrevoli di 4–8 battute; si apre una nuova regione solo se la nuova tonalità vince per almeno 2 finestre consecutive (evita salti su una singola dominante secondaria).

**Accordi e numeri romani (****`analysis/harmony.py`****)**

1. `score.chordify()` riduce le due mani a una sequenza verticale.
2. Raggruppa per tempo (o mezza battuta nei tempi lenti); scarta le note di passaggio brevi pesando le durate.
3. Per ogni gruppo: `harmony.chordSymbolFromChord` per la sigla e `roman.romanNumeralFromChord(chord, keyRegion)` per il numero romano nella tonalità locale.
4. Funzione armonica derivata dal grado: I/vi → tonica, ii/IV → predominante, V/vii° → dominante.

**Pattern ripetuti (****`analysis/patterns.py`****)**

1. Impronta di ogni battuta, per ciascuna mano: sequenza di (intervallo dalla nota precedente, durata relativa, posizione nel tempo). Gli intervalli rendono l'impronta invariante alla trasposizione.
2. Due chiavi per battuta: `exact` (altezze assolute + ritmo) e `transposed` (intervalli + ritmo).
3. Raggruppa battute con chiave uguale; poi estende i gruppi a finestre di 2, 4 e 8 battute consecutive e tiene le finestre più lunghe che si ripetono almeno 2 volte.
4. Quasi-uguali (fase 2): distanza di edit tra impronte ≤ 1 nota, marcate `kind: "variant"`.
5. Esclusioni: battute vuote o di sole pause, e ripetizioni già scritte con ritornelli (`:||`), che vanno espanse prima.

**Test di riferimento:** Bach, *Minuetto in sol* BWV Anh. 114, oggi attribuito a Petzold (frasi ripetute evidenti), un corale di Bach (accordi a 4 voci), un notturno di Chopin (modulazioni). Tutti in pubblico dominio, in `engine/tests/fixtures/`.

## Roadmap

Si parte da M1 (partitura e playback da MusicXML); l'OMR arriva solo in M5, quando il resto funziona già.

Sei milestone, ognuna chiusa da un criterio verificabile:

| Milestone | Cosa si costruisce | Criterio di uscita |
|---|---|---|
| **M1 · Partitura e playback** | Scaffolding, render Verovio, synth in Rust, eventi dal timemap, cursore sulle note | Il Minuetto si apre e suona a tempo, cursore allineato al suono |
| **M2 · MIDI e modalità segui** | midir, tastiera a schermo, wait mode, esito note corrette e sbagliate per battuta | Col piano collegato il cursore avanza solo sulle note corrette |
| **M3 · Analisi armonica** | Sidecar Python, JSON-RPC, tonalità, accordi e numeri romani sulla partitura | Corale di Bach: accordi confrontati con un'analisi di riferimento |
| **M4 · Pattern ripetuti** | Impronte di battuta, gruppi esatti e trasposti, un colore per gruppo, loop su una frase | Minuetto: tutte le frasi ripetute trovate, nessun falso positivo |
| **M5 · Import PDF (OMR)** | Rasterizzazione, motore OMR in background, schermata di correzione | Licenza OMR decisa; un PDF pulito diventa MusicXML correggibile |
| **M6 · Packaging e beta** | Firma, notarizzazione, sidecar arm64, beta con un gruppo di pianisti | App notarizzata che si installa e funziona su un Mac pulito |

Ogni milestone si chiude solo quando il suo criterio passa: è la frase da dare a Claude Code come definizione di "fatto". M3 e M4 possono procedere in parallelo a M2, perché toccano solo l'engine Python.

## Rischi e decisioni aperte

Il rischio più alto è l'OMR su musica per pianoforte: accuratezza imperfetta e licenze AGPL. Per questo l'MVP non ne dipende.

| Rischio | Impatto | Mitigazione |
|---|---|---|
| OMR sbaglia note su partiture a due pentagrammi | Alto: l'analisi eredita gli errori | Schermata di correzione obbligatoria; accettare MusicXML da MuseScore come via principale |
| Licenze AGPL di homr e Audiveris | Alto se l'app è a pagamento | Valutare con un legale; alternative: OMR come servizio separato, API commerciale, o solo MusicXML nella versione a pagamento |
| Dimensione del sidecar Python (music21 + modelli OMR) | Medio: app da centinaia di MB | Due sidecar: `engine` leggero (analisi) e `omr` scaricabile on demand |
| Latenza MIDI e jitter del playback | Medio | Scheduler in Rust con look-ahead di 50–100 ms; mai temporizzare l'audio dal frontend |
| Firma e notarizzazione del binario PyInstaller | Medio | Firmare il sidecar con lo stesso Developer ID e testare la notarizzazione già alla milestone 1 |
| Accordi ambigui (note di passaggio, arpeggi) | Basso | Mostrare `confidence`; permettere di nascondere o correggere un accordo |

**Decisioni aperte:**

- Nome definitivo dell'app (Score Studio è provvisorio)
- Modello di business: gratuita, una tantum o abbonamento (decide la questione AGPL)
- Motore OMR: homr, Audiveris o servizio esterno
- SoundFont di pianoforte da includere e relativa licenza
- Solo Apple Silicon o anche Intel

## Come iniziare con Claude Code

Crea una cartella vuota, salva questo documento come `docs/SPEC.md`, aggiungi il `CLAUDE.md` qui sotto nella radice e avvia Claude Code con il prompt della milestone 1.

**`CLAUDE.md`**** (radice del repo):**

```markdown
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
- Licenze: niente dipendenze GPL/AGPL nel core senza chiedere.
- Commit piccoli, messaggi in inglese, codice e commenti in inglese.
```

**Prompt di avvio (milestone 1):**

```text
Leggi CLAUDE.md e docs/SPEC.md. Implementa la milestone M1:
1. Scaffolding del monorepo come in "Struttura del repository".
2. Tauri 2 + React/TS: apri un file MusicXML (drag-and-drop), rendilo con
   Verovio WASM a larghezza finestra.
3. Costruisci gli eventi di playback dal timemap di Verovio e inviali a Rust.
4. In Rust: synth con rustysynth + cpal e SoundFont di piano in resources/,
   scheduler con look-ahead, play/pausa/seek, tempo 25–200%.
5. Emetti playback:position e evidenzia in giallo le note correnti nell'SVG.
6. Aggiungi un fixture (Minuetto in sol) e un test end-to-end manuale nel README.
Prima di scrivere codice, proponi un piano breve e le dipendenze esatte.
```

**Prompt successivi:** uno per milestone, con lo stesso schema: "Leggi CLAUDE.md e SPEC.md, implementa Mn, rispetta i criteri di accettazione, proponi prima il piano". Per l'engine Python conviene una sessione dedicata che parta dai test sui fixture.

## Fonti

- [Tauri 2 — Embedding external binaries (sidecar)](https://v2.tauri.app/develop/sidecar)
- [Esempio Tauri v2 con sidecar Python](https://github.com/dieharders/example-tauri-v2-python-server-sidecar)
- [homr (GitHub)](https://github.com/liebharc/homr) · [licenza AGPL-3.0](https://www.goodfirstissue.org/liebharc/homr)
- [oemer (PyPI)](https://pypi.org/project/oemer/)
- [Audiveris (Wikipedia)](https://en.wikipedia.org/wiki/Audiveris)
- [rustysynth (GitHub)](https://github.com/sinshu/rustysynth)
- [ftrain/sightreading (GitHub)](https://github.com/ftrain/sightreading)
- [AnyScore](https://anyscore-landing-page.pages.dev/) · [midipiano.app](https://alternativeto.net/software/midipiano-app/about/) · [Soundslice scanner](https://soundslice.com/sheet-music-scanner) · [Second Ear](https://second-ear-landing.pages.dev/tools/roman-numeral-analysis)
- [Review OMR, incluso PlayScore 2 (Scoring Notes)](https://www.scoringnotes.com/reviews/a-review-of-optical-music-recognition-software/)
- [Ivory (Bedroom Producers Blog)](https://bedroomproducersblog.com/2026/03/25/ivory-piano-app/)

