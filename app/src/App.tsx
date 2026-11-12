import { useEffect, useRef } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { AnalysisPanel } from './components/AnalysisPanel'
import { ClaudeKeyDialog } from './components/ClaudeKey'
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
import { AUDIO_EXTENSIONS, SCORE_EXTENSIONS, openScoreFile, openScorePath } from './lib/loadScore'
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
  const setView = useView((s) => s.set)
  const reviewing = useOmr((s) => s.phase === 'review')
  const dropping = useFileDrop()
  const fileInput = useRef<HTMLInputElement>(null)
  const { title, loading, error, zoom, layout, set } = useScore()
  const hasScore = useScore((s) => s.events.length > 0)

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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return
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
        { name: 'Spartiti (MusicXML o PDF)', extensions: SCORE_EXTENSIONS },
        { name: 'MusicXML', extensions: SCORE_EXTENSIONS.filter((e) => e !== 'pdf') },
        { name: 'PDF', extensions: ['pdf'] }
      ]
    })
    if (typeof path === 'string') await openScorePath(path)
  }

  const transcribeDialog = async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: 'Registrazioni di pianoforte', extensions: AUDIO_EXTENSIONS }]
    })
    if (typeof path === 'string') await openScorePath(path)
  }

  return (
    <div className="app">
      <header className="toolbar">
        <button onClick={() => void openDialog()}>Apri…</button>
        {inTauri && (
          <button
            onClick={() => void transcribeDialog()}
            title="Da una registrazione di pianoforte (MP3, WAV, M4A…) a partitura e MIDI"
          >
            Trascrivi audio…
          </button>
        )}
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
        <MidiPanel />
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
        <h1 className="title">{loading ? 'Caricamento…' : (title ?? 'Score Studio')}</h1>
        <div className="toolbar-group">
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
      {reviewing ? <OmrReviewBar /> : <AnalysisPanel />}
      <main className={`main view-${reviewing ? 'score' : mode}`}>
        {reviewing && <OmrPages />}
        {(reviewing || mode !== 'falling') && <ScoreView />}
        {!reviewing && mode !== 'score' && (
          <div className="falling-pane">
            <FallingNotes />
          </div>
        )}
      </main>
      <OmrProgress />
      <TranscribeSetup />
      <ClaudeKeyDialog />
      <Keyboard />
      <Transport />
      {dropping && <div className="drop-overlay">Rilascia per aprire</div>}
    </div>
  )
}
