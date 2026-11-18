import { useEffect } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { AUDIO_EXTENSIONS, openScorePath } from '../../lib/loadScore'
import {
  cancelSeparation,
  chooseModel,
  chooseSong,
  fileName,
  overallProgress,
  startSeparation,
  useSeparate,
  type SeparationModelId
} from '../../stores/separate'
import '../TranscribeSetup/TranscribeSetup.css'
import './SeparateDialog.css'

/** What each model costs, measured on a 4-core test machine (CPU only). */
const SPEED: Record<SeparationModelId, string> = {
  fast: 'circa un terzo della durata del brano',
  quality: 'circa 4 volte la durata del brano'
}

const STAGE = {
  download: 'Scarico il modello (solo la prima volta)…',
  load: 'Leggo il brano…',
  separate: 'Separo il pianoforte…',
  write: 'Salvo i file…'
} as const

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`
}

/** Isolate the piano of a song: piano.wav and the song without the piano. */
export function SeparateDialog() {
  const s = useSeparate()
  const running = s.jobId !== null

  useEffect(() => {
    if (!s.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useSeparate.setState({ open: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s.open])

  if (!s.open) return null
  const hide = () => useSeparate.setState({ open: false })

  const pickSong = async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: 'Brani (MP3, WAV, M4A, FLAC…)', extensions: AUDIO_EXTENSIONS }]
    })
    if (typeof path === 'string') chooseSong(path)
  }

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, multiple: false, defaultPath: s.outDir ?? undefined })
    if (typeof dir === 'string') useSeparate.setState({ outDir: dir })
  }

  const transcribe = async () => {
    if (!s.result) return
    hide()
    await openScorePath(s.result.pianoPath)
  }

  const fraction = overallProgress(s.progress)

  return (
    <div className="tx-backdrop">
      <div className="tx-setup sep-dialog" role="dialog" aria-labelledby="sep-title">
        <h2 id="sep-title">Isola il pianoforte</h2>
        <p className="tx-help">
          Da una canzone separa il pianoforte dal resto, in locale sul tuo Mac: niente servizi esterni né costi. Ottieni
          due file WAV: il piano da solo e il brano senza piano (una base per suonarci sopra).
        </p>

        <div className="sep-models" role="radiogroup" aria-label="Modello">
          {s.models.map((m) => (
            <label key={m.id} className={`sep-model ${s.model === m.id ? 'chosen' : ''}`}>
              <input
                type="radio"
                name="sep-model"
                checked={s.model === m.id}
                disabled={running}
                onChange={() => chooseModel(m.id)}
              />
              <span className="sep-model-text">
                <strong>{m.name}</strong>
                <small>
                  Tempo: {SPEED[m.id]}.{' '}
                  {m.installed ? 'Modello già scaricato.' : `Da scaricare la prima volta: ${megabytes(m.sizeBytes)}.`}
                </small>
                <small>{m.licence}</small>
              </span>
            </label>
          ))}
        </div>

        <div className="sep-field">
          <span>Brano</span>
          <span className="sep-file">
            <span className="sep-path" title={s.path ?? ''}>
              {s.path ? fileName(s.path) : 'Nessun brano scelto'}
            </span>
            <button disabled={running} onClick={() => void pickSong()}>
              Scegli…
            </button>
          </span>
        </div>
        <div className="sep-field">
          <span>Salva in</span>
          <span className="sep-file">
            <span className="sep-path" title={s.outDir ?? ''}>
              {s.outDir ?? '—'}
            </span>
            <button disabled={running || !s.path} onClick={() => void pickFolder()}>
              Cambia…
            </button>
          </span>
        </div>

        {running && (
          <div className="sep-progress">
            <span>{s.progress ? STAGE[s.progress.stage] : 'Avvio…'}</span>
            <progress value={fraction} max={1} />
            <small>
              {Math.round(fraction * 100)}% · puoi nascondere questa finestra e continuare a usare l’app: il lavoro va
              avanti.
            </small>
          </div>
        )}

        {s.result && (
          <div className="sep-result">
            <strong>Fatto.</strong>
            <small title={s.result.pianoPath}>🎹 {fileName(s.result.pianoPath)}</small>
            <small title={s.result.restPath}>🎸 {fileName(s.result.restPath)}</small>
            <small>Nella cartella {s.outDir}</small>
          </div>
        )}

        {s.error && <small className="omr-error">{s.error}</small>}

        <div className="tx-actions">
          {running ? (
            <>
              <button onClick={() => void cancelSeparation()}>Annulla separazione</button>
              <button className="primary" onClick={hide}>
                Nascondi
              </button>
            </>
          ) : s.result ? (
            <>
              <button onClick={hide}>Chiudi</button>
              <button className="primary" onClick={() => void transcribe()}>
                Trascrivi il piano…
              </button>
            </>
          ) : (
            <>
              <button onClick={hide}>Annulla</button>
              <button
                className="primary"
                disabled={!s.path || !s.outDir || !s.models.length}
                onClick={() => void startSeparation()}
              >
                Separa
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
