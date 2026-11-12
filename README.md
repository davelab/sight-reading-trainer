# Score Studio

App desktop per macOS che trasforma uno spartito (MusicXML, e in seguito PDF)
in una partitura interattiva da studiare al pianoforte digitale: playback
sincronizzato, modalità "segui" via MIDI, analisi armonica e pattern ripetuti.

- Specifica completa: [`docs/SPEC.md`](docs/SPEC.md)
- Istruzioni per Claude Code: [`CLAUDE.md`](CLAUDE.md)

## Stato: milestone M5 — import da PDF (OMR)

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
| Tastiera a schermo: note da suonare per mano (destra ambra, sinistra viola, anche in partitura) con un lampo a ogni nuovo attacco (note e accordi ripetuti), tasti suonati (blu), giuste/sbagliate (verde/rosso); altezza regolabile trascinando il bordo superiore | `components/Keyboard`, `lib/keyboardState.ts` |
| Tastiera cliccabile: suona col synth e alimenta la modalità segui come un piano MIDI | comando `virtual_note` |

Estensioni al contratto IPC della specifica: `playback:position` porta anche
`following` ed `expectedPitches`; nuovo comando `virtual_note {pitch, on}`;
`set_follow_mode {enabled}` restituisce se la modalità è attiva;
`midi_list_devices` restituisce `{devices, selected}`; ogni evento di playback
porta il numero di `measure`. Le note del piano MIDI non passano dal synth (il
piano suona già da sé).

### M3 — analisi armonica

| Fatto | Dove |
|---|---|
| Sidecar Python avviato da Rust (uv in sviluppo, binario nell'app), JSON-RPC con timeout e riavvio | `src-tauri/src/engine.rs` |
| Tonalità globale (Krumhansl-Schmuckler) e regioni di modulazione (finestre di 4 battute, conferma su 2) | `engine/score_engine/analysis/key.py` |
| Un accordo per tempo: modelli pesati per durata, sigla, numero romano nella tonalità locale, dominanti secondarie, funzione | `analysis/harmony.py` |
| Analisi automatica all'apertura, in background | `stores/analysis.ts`, comando `analyze` |
| Numeri romani sotto il sistema (colori T/P/D), sigle sopra, tonalità a inizio regione, ancorati a (battuta, posizione) | `lib/analysisOverlay.ts` |
| Barra con tonalità e regioni (numeri di battuta stampati) e interruttori | `components/AnalysisPanel` |

**Criterio di uscita** («corale di Bach: accordi confrontati con un'analisi di
riferimento»): `engine/tests/test_harmony.py` confronta, tempo per tempo, il
corale BWV 269 con l'analisi umana di *When in Rome* (Andrew Jones, rivista da
D. Tymoczko e H. Robb). Su 63 tempi: **90,5 %** stessa fondamentale e qualità,
**88,9 %** anche stesso basso, **82,5 %** stessa tonalità locale.

Su 9 corali di controllo mai usati per tarare l'algoritmo (Riemenschneider 2–10,
523 tempi): **87,4 %** fondamentale e qualità, **85,1 %** con il basso,
**67 %** tonalità locale. La tonalità è la parte più debole: gli analisti
chiamano «tonalità» anche tonicizzazioni di 1–2 battute, mentre la finestra di
4 battute le ignora o le sposta. Le impostazioni della specifica (4 battute,
conferma su 2) sono risultate le migliori tra finestre 3–8 e conferme 1–3.

Estensioni al contratto: `Chord.offset` (posizione in semiminime dall'inizio
della battuta, per collocare l'annotazione con precisione); `measure` è
l'ordinale della battuta nello spartito scritto (levare = 1, «7» e «7a»
contano due), non il numero stampato.

### M4 — pattern ripetuti

| Fatto | Dove |
|---|---|
| Impronta di ogni battuta per due mani insieme e per ciascuna mano: esatta (altezze + ritmo) e trasposta (passi diatonici + ritmo) | `engine/score_engine/analysis/patterns.py` |
| Ripetizioni più lunghe possibili sulle diagonali di auto-somiglianza, senza sovrapposizioni; almeno 2 battute e 4 note; niente pattern dentro uno più lungo | `patterns.py` |
| Un colore per pattern sulle battute (solo sul pentagramma della mano interessata), etichetta «A», «B↓m2» | `lib/patterns.ts` |
| Elenco nella barra con riepilogo «N battute su M ripetono una frase già vista»; clic su un numero di battuta = loop di quella ricorrenza | `components/AnalysisPanel` |

**Criterio di uscita** («Minuetto: tutte le frasi ripetute trovate, nessun
falso positivo»): `engine/tests/test_patterns.py` richiede esattamente le tre
frasi ripetute del Minuetto, verificate nota per nota: mano destra 1–6 = 9–14;
5–6 ripresa un grado sotto a 14–15; 21–22 ripresa una quinta sotto a 29–30.

Rispetto alla specifica: le lunghezze non sono solo finestre di 2/4/8 battute
ma la ripetizione più lunga trovata (la frase di 6 battute è un pattern solo,
non tre finestre sovrapposte); il pattern può riguardare una sola mano
(`Pattern.hands`) e ogni ricorrenza trasposta ha il suo intervallo
(`Pattern.transpositions`); le varianti «quasi uguali» (fase 2) non ci sono
ancora. Tempi: 0,25 s per le 313 battute di un quartetto di Beethoven.

### M5 — import da PDF (OMR)

| Fatto | Dove |
|---|---|
| Motore OMR deciso: **homr**, incluso nell'app (vedi «Licenze») | `engine/score_engine/omr/homr_backend.py` |
| PDF rasterizzato a 300 DPI, riconoscimento in background pagina per pagina con avanzamento e «Annulla» | `omr/jobs.py`, `omr/render.py`, `components/OmrReview` |
| Secondo sidecar `omr` (homr, onnxruntime, OpenCV) separato dall'analisi; modelli (151 MB) scaricati una volta nella cartella dati dell'app | `scripts/build-engine.sh`, `src-tauri/src/engine.rs` |
| Schermata di correzione: PDF originale a fianco, battute che non tornano evidenziate, clic su una nota → ↑ ↓ ♯ ♭ ♮ Elimina Annulla (anche da tastiera), «Salva MusicXML…» per MuseScore | `stores/omr.ts`, `io/correct.py` |
| A fine correzione la partitura riconosciuta si analizza come le altre | `finishReview` |
| Correzioni del ritmo: durata (7 6 5 4 3 2), punto, terzina sul gruppo (T) o su tutta la battuta (⇧T), inserisci nota (I), separa/unisci accordo (C), ottava (⇧↑/⇧↓), elimina togliendo il tempo (⇧⌫); le altre voci restano al loro posto | `io/rhythm.py`, `components/OmrReview` |

**Criterio di uscita** («licenza OMR decisa; un PDF pulito diventa MusicXML
correggibile»): licenza decisa (homr, AGPL-3.0). `engine/tests/test_omr.py`
riconosce con homr vero il PDF pulito del Minuetto (`tests/fixtures/minuet-in-g.pdf`,
generato da Verovio): in 11,6 s su CPU, **186 note su 191 (97,4 %)** identiche
per battuta, pentagramma, posizione, altezza e durata; le altre 5 sono do♯
letti come do (battute 20–23) e 5 correzioni «♯» riportano l'originale. Il
test si salta se i modelli non sono scaricati.

Le note da correggere sono individuate per posizione (battuta, pentagramma,
tempo, altezza), mai per ID. Il controllo automatico segnala solo le battute
la cui durata non torna con il tempo in chiave: le altezze sbagliate (come i
diesis persi) vanno viste confrontando con il PDF.

### Note cadenti (dopo l'MVP, su richiesta)

| Fatto | Dove |
|---|---|
| Vista Partitura / Note cadenti / Entrambe (barra degli strumenti) | `App.tsx`, `components/FallingNotes` |
| Note che cadono sui tasti, colorate per mano, più chiare e con alone mentre suonano; animazione fluida tra gli aggiornamenti di posizione di Rust | `FallingNotes.tsx`, `lib/fallingNotes.ts` |
| Accordi dell'analisi a sinistra, linee di battuta e guide sui do, nomi delle note sulle barre e dei tasti sulla tastiera | idem, `components/Keyboard` |
| Impostazioni (⚙︎): colori delle mani, mani visibili, volume, riverbero, zoom; ricordate tra le sessioni | `components/ViewSettings`, `stores/view.ts` |
| Trasposizione −/+ in semitoni: suono, tastiera, note cadenti e modalità «Segui» | `playback.rs`, `follow.rs`, `Transport` |
| Barra di avanzamento trascinabile | `Transport` |

Il pedale arriverà con la trascrizione da audio (l'unica fonte che lo conosce).
La M6 (firma, notarizzazione, beta) è sospesa: l'app è per uso personale.

## Requisiti

- macOS 10.15 Catalina o successivo (Apple Silicon o Intel), Xcode Command Line Tools
- Rust stabile (`rustup`), Node 20+ con pnpm, [uv](https://docs.astral.sh/uv/) (Python 3.12)

## Installazione su Mac (compilando dai sorgenti)

Non c'è ancora un pacchetto firmato (arriva con M6): l'app si compila sul Mac
stesso, e un'app compilata in locale si apre senza blocchi di Gatekeeper.

1. Strumenti, nel Terminale (una volta sola; chiudi e riapri il Terminale dopo):

   ```sh
   xcode-select --install
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

   Node: installer «LTS» da nodejs.org (Node 22 su macOS 11+, Node 20 su
   Catalina), poi `corepack enable pnpm`.

2. Codice e SoundFont:

   ```sh
   git clone https://github.com/davelab/sight-reading-trainer.git
   cd sight-reading-trainer
   scripts/fetch-soundfont.sh
   ```

3. Compilazione (la prima volta 10–25 minuti; su Intel produce un'app x86_64):

   ```sh
   cd app
   pnpm install
   pnpm bundle --bundles app
   ```

4. L'app è in `app/src-tauri/target/release/bundle/macos/Score Studio.app`:
   trascinala in Applicazioni. Se macOS dice che non può aprirla, clic destro →
   Apri → Apri.

Per aggiornare: `git pull`, poi ripeti il passo 3.

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
| Build app con sidecar | `cd app && pnpm bundle` |

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

## Test end-to-end manuale (criterio di uscita M3)

1. `cd engine && uv sync` (installa music21), poi
   `uv run python -c "from music21 import corpus; corpus.parse('bach/bwv269').write('musicxml', fp='bwv269.musicxml')"`.
2. `cd app && pnpm tauri dev` e apri `engine/bwv269.musicxml`.
3. Per un paio di secondi la barra sotto gli strumenti dice «Analisi armonica
   in corso…», poi mostra le tonalità con i numeri di battuta stampati.
4. Sotto ogni sistema compaiono i numeri romani, con «G:» all'inizio, colorati
   per funzione (blu tonica, verde predominante, arancio dominante), allineati
   alle note. Battuta 6: I⁶ – ii⁶₅ – V; battuta 13, tempo 3: V⁷/IV.
5. «Sigle» aggiunge G, D/F#… sopra i sistemi; ridimensionando la finestra le
   annotazioni seguono la nuova impaginazione.
6. Togli `uv` dal PATH (o rinomina `engine/`) e riapri: la barra dice
   «Analisi non disponibile», con il motivo nel tooltip e «Riprova»; partitura
   e playback funzionano lo stesso.

Il passo 4 è stato verificato su Linux (Xvfb) con l'app vera e il sidecar via uv.

## Test end-to-end manuale (criterio di uscita M4)

1. Apri `engine/tests/fixtures/minuet-in-g.musicxml`.
2. Dopo l'analisi la barra mostra «9 battute su 32 ripetono una frase già
   vista» e tre pattern: A (6 battute, 1 e 9), B (2 battute, 5 e 14 ↓m2),
   C (2 battute, 21 e 29 ↓P5), tutti della mano destra.
3. In partitura le battute sono colorate per pattern, solo sul pentagramma
   superiore, con «A», «B↓m2», «C↓P5» all'inizio delle ricorrenze. Passando
   col mouse su un pattern nella barra, le sue battute si accendono e le
   altre si attenuano.
4. Clic su «9» di A: il trasporto mostra «Loop 0:12–0:21», ▶ suona le battute
   9–14 a ripetizione. ✕ toglie il loop.
5. «Pattern» spento: i colori spariscono.

I passi 2–4 sono stati verificati su Linux (Xvfb) con l'app vera.

## Test end-to-end manuale (criterio di uscita M5)

1. `pnpm bundle --bundles app` (ora compila anche il sidecar `omr`) e apri l'app.
2. Trascina `engine/tests/fixtures/minuet-in-g.pdf` nella finestra (o «Apri…»
   → PDF). In basso a destra compare «Import di "minuet-in-g.pdf"»; la prima
   volta «Preparazione del riconoscimento» scarica i modelli (~150 MB), poi
   «Riconoscimento pagina 1 di 1». «Annulla» interrompe.
3. Si apre la correzione: PDF a sinistra, partitura riconosciuta a destra,
   suonabile con ▶. Battute 20–23: i do♯ sono do naturali.
4. Clic sul primo do della battuta 20 → «Do5 · batt. 20»; premi D (o ♯) →
   «Do♯5», il diesis compare. ⌘Z annulla. ↑/↓ spostano di un grado secondo
   l'armatura, ⌫ trasforma la nota in pausa.
5. «Salva MusicXML…» salva il file corretto; «Fine correzione» apre la
   partitura con analisi armonica e pattern.
6. Prova un PDF tuo, pulito (esportato da un programma di notazione): le
   battute che non tornano compaiono in arancione con il motivo.

I passi 2–5 sono stati verificati su Linux (Xvfb) con l'app vera e homr.

## Licenze

Il codice di Score Studio è MIT. L'import da PDF usa
[homr](https://github.com/liebharc/homr), con licenza **AGPL-3.0**, incluso
nel sidecar `omr` dell'app (decisione presa per la M5). Chi distribuisce l'app
impacchettata con homr deve offrire ai destinatari il sorgente completo
corrispondente sotto AGPL-3.0. Prima di vendere l'app serve un parere legale
(vedi `docs/SPEC.md`, «Rischi e decisioni aperte»).

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
