import { useEffect, useRef } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { AnalysisPanel } from './components/AnalysisPanel'
import { ClaudeKeyDialog } from './components/ClaudeKey'
import { ComposeView } from './components/Compose'
import { DrillView } from './components/Drills'
import { PdfExportDialog, usePdfDialog } from './components/PdfExport'
import { Menu, type MenuEntry } from './components/Menu'
import { TimedSummaryCard } from './components/Practice'
import { FallingNotes } from './components/FallingNotes'
import { Keyboard } from './components/Keyboard'
import { MidiPanel } from './components/MidiPanel'
import { OmrPages, OmrProgress, OmrReviewBar } from './components/OmrReview'
import { ScoreView } from './components/ScoreView'
import { TranscribeSetup } from './components/TranscribeSetup'
import { Transport } from './components/Transport'
import { useFileDrop } from './hooks/useFileDrop'
import { useMidiEvents } from './hooks/useMidiEvents'
import { useOmrEvents } from './hooks/useOmrEvents'
import { usePlaybackPosition } from './hooks/usePlaybackPosition'
import { useViewSync } from './hooks/useViewSync'
import { inTauri, ipc } from './lib/ipc'
import { isTyping } from './lib/keys'
import { saveScore } from './lib/saveScore'
import { ask } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AUDIO_EXTENSIONS, MIDI_EXTENSIONS, SCORE_EXTENSIONS, openScoreFile, openScorePath } from './lib/loadScore'
import { useMidi } from './stores/midi'
import { useOmr } from './stores/omr'
import { useScore } from './stores/score'
import { useTransport } from './stores/transport'
import { useView } from './stores/view'

const ZOOM_MIN = 20
const ZOOM_MAX = 80
let initialFileRequested = false

export default function App() {
  usePlaybackPosition()
  useMidiEvents()
  useOmrEvents()
  useViewSync()
  const mode = useView((s) => s.mode)
  const section = useView((s) => s.section)
  const setView = useView((s) => s.set)
  const reviewing = useOmr((s) => s.phase === 'review')
  const dropping = useFileDrop()
  const fileInput = useRef<HTMLInputElement>(null)
  const { title, loading, error, zoom, layout, set } = useScore()
  const hasScore = useScore((s) => s.events.length > 0)
  const unsaved = useScore((s) => s.unsaved)
  const openRef = useRef<() => void>(() => {})

  // ⌘S / Ctrl+S saves the open score as MusicXML.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveScore()
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p' && useScore.getState().musicxml) {
        e.preventDefault()
        usePdfDialog.setState({ open: true })
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        openRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Closing the window with a corrected score not saved: ask first.
  useEffect(() => {
    if (!inTauri) return
    const off = getCurrentWindow().onCloseRequested(async (event) => {
      if (!useScore.getState().unsaved) return
      const quit = await ask('Lo spartito corretto non è stato salvato. Chiudere comunque?', {
        title: 'Modifiche non salvate',
        kind: 'warning',
        okLabel: 'Chiudi senza salvare',
        cancelLabel: 'Annulla'
      })
      if (!quit) event.preventDefault()
    })
    return () => void off.then((fn) => fn())
  }, [])

  // Open a score passed on the command line (once, even under StrictMode).
  useEffect(() => {
    if (!inTauri || initialFileRequested) return
    initialFileRequested = true
    void ipc.initialFile().then((path) => {
      if (path) void openScorePath(path)
    })
  }, [])

  // Space bar toggles playback (except while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !inTauri || !useScore.getState().events.length) return
      if (isTyping(e.target) || e.target instanceof HTMLButtonElement) return
      if (e.target instanceof HTMLSelectElement || useMidi.getState().following) return
      e.preventDefault()
      void (useTransport.getState().playing ? ipc.pause() : ipc.play())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openDialog = async () => {
    if (!inTauri) {
      fileInput.current?.click()
      return
    }
    const path = await open({
      multiple: false,
      filters: [
        { name: 'Spartiti (MusicXML, PDF o MIDI)', extensions: [...SCORE_EXTENSIONS, ...MIDI_EXTENSIONS] },
        { name: 'MusicXML', extensions: SCORE_EXTENSIONS.filter((e) => e !== 'pdf') },
        { name: 'PDF', extensions: ['pdf'] }
      ]
    })
    if (typeof path === 'string') await openScorePath(path)
  }

  openRef.current = () => void openDialog()

  const pdfDialog = async () => {
    const path = await open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (typeof path === 'string') await openScorePath(path)
  }

  const fileMenu: MenuEntry[] = [
    { label: 'Apri…', shortcut: '⌘O', hint: 'MusicXML, MXL, PDF o MIDI', onSelect: () => void openDialog() },
    {
      label: 'Importa da PDF…',
      hint: 'Riconoscimento della partitura stampata (OMR), poi correzione',
      disabled: !inTauri,
      onSelect: () => void pdfDialog()
    },
    {
      label: 'Trascrivi audio o MIDI…',
      hint: 'Da una registrazione di pianoforte (MP3, WAV, M4A…) o da un file MIDI a partitura',
      disabled: !inTauri,
      onSelect: () => void transcribeDialog()
    },
    null,
    {
      label: 'Salva come MusicXML…',
      shortcut: '⌘S',
      hint: unsaved ? 'Modifiche non salvate' : undefined,
      highlight: unsaved,
      disabled: !hasScore,
      onSelect: () => void saveScore()
    },
    {
      label: 'Esporta PDF…',
      shortcut: '⌘P',
      hint: 'Lo spartito in PDF, con o senza accordi e aiuti alla lettura',
      disabled: !hasScore,
      onSelect: () => usePdfDialog.setState({ open: true })
    },
    null,
    {
      label: 'Chiave API di Claude…',
      hint: 'Per «Migliora con Claude» nella correzione dei PDF: inserisci, cambia o rimuovi la chiave',
      disabled: !inTauri,
      onSelect: () => useOmr.setState({ keyDialog: true })
    }
  ]

  const transcribeDialog = async () => {
    const path = await open({
      multiple: false,
      filters: [
        { name: 'Registrazioni di pianoforte o MIDI', extensions: [...AUDIO_EXTENSIONS, ...MIDI_EXTENSIONS] },
        { name: 'MIDI', extensions: MIDI_EXTENSIONS }
      ]
    })
    if (typeof path === 'string') await openScorePath(path)
  }

  return (
    <div className="app">
      <header className="toolbar">
        <Menu label="File" items={fileMenu} badge={unsaved} />
        <input
          ref={fileInput}
          type="file"
          accept=".musicxml,.xml"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void openScoreFile(file)
            e.target.value = ''
          }}
        />
        <div className="toolbar-group segmented sections" role="tablist" aria-label="Sezione">
          {(
            [
              ['study', 'Studia', 'Leggi, ascolta e suona uno spartito; importa PDF e registrazioni'],
              ['drills', 'Esercizi', 'Esercizi brevi di lettura: note, intervalli e accordi, ritmo'],
              ['compose', 'Componi', 'Registra un\u2019idea dal piano, vedila scritta e sviluppala con Claude']
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              role="tab"
              aria-selected={section === value}
              className={section === value ? 'selected' : ''}
              title={hint}
              onClick={() => setView({ section: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <MidiPanel practice={section === 'study'} />
        {section === 'study' && (
          <div className="toolbar-group segmented" role="group" aria-label="Vista">
            {(
              [
                ['score', 'Partitura'],
                ['falling', 'Note cadenti'],
                ['both', 'Entrambe']
              ] as const
            ).map(([value, label]) => (
              <button key={value} className={mode === value ? 'selected' : ''} onClick={() => setView({ mode: value })}>
                {label}
              </button>
            ))}
          </div>
        )}
        <h1 className="title">{loading ? 'Caricamento…' : (title ?? 'Score Studio')}</h1>
        <div className="toolbar-group" hidden={section === 'drills'}>
          <button disabled={!hasScore || zoom <= ZOOM_MIN} onClick={() => set({ zoom: zoom - 5 })} title="Riduci">
            −
          </button>
          <span className="zoom">{Math.round((zoom / 40) * 100)}%</span>
          <button disabled={!hasScore || zoom >= ZOOM_MAX} onClick={() => set({ zoom: zoom + 5 })} title="Ingrandisci">
            +
          </button>
          <button disabled={!hasScore} onClick={() => set({ layout: layout === 'scroll' ? 'pages' : 'scroll' })}>
            {layout === 'scroll' ? 'Vista a pagine' : 'Scroll continuo'}
          </button>
        </div>
      </header>
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => set({ error: null })}>✕</button>
        </div>
      )}
      {reviewing ? <OmrReviewBar /> : section === 'study' && <AnalysisPanel />}
      {!reviewing && section === 'drills' ? (
        <DrillView />
      ) : !reviewing && section === 'compose' ? (
        <ComposeView />
      ) : (
        <main className={`main view-${reviewing ? 'score' : mode}`}>
          {reviewing && <OmrPages />}
          {(reviewing || mode !== 'falling') && <ScoreView />}
          {!reviewing && mode !== 'score' && (
            <div className="falling-pane">
              <FallingNotes />
            </div>
          )}
        </main>
      )}
      <OmrProgress />
      {section === 'study' && <TimedSummaryCard />}
      <TranscribeSetup />
      <ClaudeKeyDialog />
      <PdfExportDialog />
      <Keyboard />
      <Transport />
      {dropping && <div className="drop-overlay">Rilascia per aprire</div>}
    </div>
  )
}
