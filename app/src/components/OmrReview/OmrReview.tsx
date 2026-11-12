import { useEffect } from 'react'
import { pitchName } from '../../lib/noteRefs'
import { revealMeasure } from '../../lib/overlay'
import {
  cancelPdfImport,
  correct,
  finishReview,
  saveRecognised,
  selectNote,
  undoCorrection,
  useOmr
} from '../../stores/omr'
import { useScore } from '../../stores/score'
import './OmrReview.css'

const STAGE: Record<string, string> = {
  render: 'Preparazione delle pagine',
  download: 'Preparazione del riconoscimento (al primo uso scarica i modelli, circa 150 MB)',
  recognize: 'Riconoscimento',
  merge: 'Unione delle pagine'
}

/** Import progress, as a card over the score, with «Annulla». */
export function OmrProgress() {
  const { phase, fileName, progress, error } = useOmr()
  if (phase !== 'running' && phase !== 'error') return null
  const stage = progress?.stage ?? 'render'
  const fraction = progress && progress.total ? (stage === 'merge' ? 1 : (progress.page - 0.5) / progress.total) : 0
  return (
    <div className="omr-card" role="status">
      <strong>Import di «{fileName ?? 'PDF'}»</strong>
      {phase === 'running' ? (
        <>
          <span>
            {STAGE[stage]}
            {stage === 'recognize' && progress ? ` pagina ${progress.page} di ${progress.total}` : '…'}
          </span>
          <progress value={stage === 'recognize' ? Math.max(0.02, fraction) : undefined} max={1} />
          <button onClick={() => void cancelPdfImport()}>Annulla</button>
        </>
      ) : (
        <>
          <span className="omr-error">{error}</span>
          <button onClick={() => useOmr.setState({ phase: 'idle', error: null })}>Chiudi</button>
        </>
      )}
    </div>
  )
}

/** Correction toolbar and warnings, above the score while reviewing a recognised PDF. */
export function OmrReviewBar() {
  const { fileName, warnings, selected, history, busy, error } = useOmr()
  const labels = useScore((s) => s.measureLabels)
  const measureIds = useScore((s) => s.measureIds)

  // Keyboard: ↑/↓ step, d diesis, b bemolle, n bequadro, ⌫ elimina, ⌘Z annulla, Esc deseleziona.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        void undoCorrection()
        return
      }
      const action = (
        {
          ArrowUp: 'step-up',
          ArrowDown: 'step-down',
          d: 'sharp',
          b: 'flat',
          n: 'natural',
          Backspace: 'delete',
          Delete: 'delete'
        } as const
      )[e.key as 'ArrowUp']
      if (e.key === 'Escape') selectNote(null)
      else if (action && useOmr.getState().selected) {
        e.preventDefault()
        void correct(action)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const reveal = (measure: number) => {
    const view = document.querySelector('.score-view')
    if (view) revealMeasure(view, measureIds, measure)
  }

  return (
    <div className="omr-review-bar">
      <div className="omr-row">
        <strong>Correzione di «{fileName}»</strong>
        <span className="omr-hint">
          Confronta con il PDF a sinistra; clic su una nota per correggerla. Per correzioni più ampie salva il
          MusicXML e aprilo in MuseScore.
        </span>
        <span className="omr-actions">
          <button onClick={() => void saveRecognised()}>Salva MusicXML…</button>
          <button className="primary" onClick={finishReview}>
            Fine correzione
          </button>
        </span>
      </div>
      <div className="omr-row">
        <span className="omr-selected">
          {selected
            ? `${pitchName(selected.pitch)} · batt. ${labels[selected.measure - 1] ?? selected.measure}`
            : 'Nessuna nota selezionata'}
        </span>
        <span className="omr-tools" aria-label="Correzioni">
          <button disabled={!selected || busy} onClick={() => void correct('step-up')} title="Su di un grado (↑)">
            ↑
          </button>
          <button disabled={!selected || busy} onClick={() => void correct('step-down')} title="Giù di un grado (↓)">
            ↓
          </button>
          <button disabled={!selected || busy} onClick={() => void correct('sharp')} title="Diesis (D)">
            ♯
          </button>
          <button disabled={!selected || busy} onClick={() => void correct('flat')} title="Bemolle (B)">
            ♭
          </button>
          <button disabled={!selected || busy} onClick={() => void correct('natural')} title="Bequadro (N)">
            ♮
          </button>
          <button disabled={!selected || busy} onClick={() => void correct('delete')} title="Elimina (⌫)">
            Elimina
          </button>
          <button disabled={!history.length || busy} onClick={() => void undoCorrection()} title="Annulla (⌘Z)">
            Annulla
          </button>
        </span>
        {error && <span className="omr-error">{error}</span>}
      </div>
      <div className="omr-row omr-warnings">
        {warnings.length === 0 ? (
          <span className="omr-ok">Nessuna battuta sospetta: controlla comunque note e alterazioni.</span>
        ) : (
          <>
            <span>
              {warnings.length} {warnings.length === 1 ? 'battuta sospetta' : 'battute sospette'}:
            </span>
            {warnings.map((w, i) => (
              <button key={i} className="warning-chip" onClick={() => reveal(w.measure)}>
                {w.message}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/** The PDF pages as recognised, beside the score. */
export function OmrPages() {
  const previews = useOmr((s) => s.previews)
  return (
    <aside className="omr-pages" aria-label="PDF originale">
      {previews.map((src, i) => (
        <img key={i} src={src} alt={`Pagina ${i + 1}`} />
      ))}
    </aside>
  )
}
