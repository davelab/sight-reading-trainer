import { useEffect, useRef } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { AnalysisPanel } from './components/AnalysisPanel'
import { Keyboard } from './components/Keyboard'
import { ScoreView } from './components/ScoreView'
import { Transport } from './components/Transport'
import { useFileDrop } from './hooks/useFileDrop'
import { usePlaybackPosition } from './hooks/usePlaybackPosition'
import { inTauri, ipc } from './lib/ipc'
import { SCORE_EXTENSIONS, openScoreFile, openScorePath } from './lib/loadScore'
import { useScore } from './stores/score'
import { useTransport } from './stores/transport'

const ZOOM_MIN = 20
const ZOOM_MAX = 80
let initialFileRequested = false

export default function App() {
  usePlaybackPosition()
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
    const path = await open({ multiple: false, filters: [{ name: 'MusicXML', extensions: SCORE_EXTENSIONS }] })
    if (typeof path === 'string') await openScorePath(path)
  }

  return (
    <div className="app">
      <header className="toolbar">
        <button onClick={() => void openDialog()}>Apri…</button>
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
      <main className="main">
        <ScoreView />
        <AnalysisPanel />
      </main>
      <Keyboard />
      <Transport />
      {dropping && <div className="drop-overlay">Rilascia per aprire</div>}
    </div>
  )
}
