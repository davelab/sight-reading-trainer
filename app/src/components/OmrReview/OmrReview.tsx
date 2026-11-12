import { useEffect, useState } from 'react'
import type { EditAction, NoteValue } from '../../lib/ipc'
import { pitchName } from '../../lib/noteRefs'
import { revealMeasure } from '../../lib/overlay'
import {
  cancelImport,
  correct,
  finishReview,
  refineWithClaude,
  savePerformanceMidi,
  saveRecognised,
  selectNote,
  undoCorrection,
  useOmr
} from '../../stores/omr'
import { useScore } from '../../stores/score'
import './OmrReview.css'

const VALUES: { value: NoteValue; key: string; label: string; name: string }[] = [
  { value: 'whole', key: '7', label: '𝅝', name: 'Semibreve' },
  { value: 'half', key: '6', label: '𝅗𝅥', name: 'Minima' },
  { value: 'quarter', key: '5', label: '♩', name: 'Semiminima' },
  { value: 'eighth', key: '4', label: '♪', name: 'Croma' },
  { value: '16th', key: '3', label: '𝅘𝅥𝅯', name: 'Semicroma' },
  { value: '32nd', key: '2', label: '𝅘𝅥𝅰', name: 'Biscroma' }
]

export function shortcutFor(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey'>
): { action: EditAction; value?: NoteValue } | null {
  const value = VALUES.find((v) => v.key === e.key)
  if (value) return { action: 'set-duration', value: value.value }
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (e.shiftKey) {
    return (
      (
        {
          ArrowUp: { action: 'octave-up' },
          ArrowDown: { action: 'octave-down' },
          t: { action: 'triplet-measure' },
          Backspace: { action: 'delete-time' },
          Delete: { action: 'delete-time' }
        } as const
      )[key as 'ArrowUp'] ?? null
    )
  }
  return (
    (
      {
        ArrowUp: { action: 'step-up' },
        ArrowDown: { action: 'step-down' },
        d: { action: 'sharp' },
        b: { action: 'flat' },
        n: { action: 'natural' },
        '.': { action: 'toggle-dot' },
        t: { action: 'triplet' },
        i: { action: 'insert-after' },
        c: { action: 'toggle-chord' },
        Backspace: { action: 'delete' },
        Delete: { action: 'delete' }
      } as const
    )[key as 'ArrowUp'] ?? null
  )
}

/** Warnings shown before «+N altre». */
const VISIBLE_WARNINGS = 12

const STAGE: Record<string, string> = {
  render: 'Preparazione delle pagine',
  download: 'Preparazione del riconoscimento (al primo uso scarica i modelli, circa 150 MB)',
  recognize: 'Riconoscimento',
  merge: 'Unione delle pagine'
}

const TRANSCRIBE_STAGE: Record<string, string> = {
  load: 'Lettura della registrazione',
  model: 'Ascolto delle note (rete neurale)',
  notation: 'Scrittura della partitura: tempo, battute, mani'
}

/** Import progress, as a card over the score, with «Annulla». */
export function OmrProgress() {
  const { phase, source, fileName, progress, transcribeProgress, error } = useOmr()
  if (phase !== 'running' && phase !== 'error') return null
  if (source === 'audio') {
    const stage = transcribeProgress?.stage ?? 'load'
    return (
      <div className="omr-card" role="status">
        <strong>Trascrizione di «{fileName ?? 'audio'}»</strong>
        {phase === 'running' ? (
          <>
            <span>
              {TRANSCRIBE_STAGE[stage]}
              {stage === 'model' && transcribeProgress ? ` ${Math.round(transcribeProgress.fraction * 100)}%` : '…'}
            </span>
            <progress
              value={stage === 'model' ? Math.max(0.02, transcribeProgress?.fraction ?? 0) : undefined}
              max={1}
            />
            <button onClick={() => void cancelImport()}>Annulla</button>
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
          <button onClick={() => void cancelImport()}>Annulla</button>
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
  const { source, fileName, facts, midi, warnings, selected, history, busy, error, pdfPath, refining, refineReport } =
    useOmr()
  const labels = useScore((s) => s.measureLabels)
  const measureIds = useScore((s) => s.measureIds)
  const [showAll, setShowAll] = useState(false)

  // One chip per measure: both hands' messages go in its tooltip.
  const byMeasure = new Map<number, string[]>()
  for (const w of warnings) byMeasure.set(w.measure, [...(byMeasure.get(w.measure) ?? []), w.message])
  const measures = [...byMeasure.entries()].sort((a, b) => a[0] - b[0])
  const shown = showAll ? measures : measures.slice(0, VISIBLE_WARNINGS)

  // Keyboard (as in MuseScore where possible): ↑/↓ step, ⇧↑/⇧↓ octave, D/B/N accidentals,
  // 7 6 5 4 3 2 durations, . dot, T triplet, ⇧T triplets in the measure, I insert,
  // C chord, ⌫ to rest, ⇧⌫ remove with its time, ⌘Z undo, Esc deselect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        void undoCorrection()
        return
      }
      if (e.key === 'Escape') {
        selectNote(null)
        return
      }
      if (!useOmr.getState().selected || e.metaKey || e.ctrlKey) return
      const shortcut = shortcutFor(e)
      if (shortcut) {
        e.preventDefault()
        void correct(shortcut.action, shortcut.value)
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
        <strong>
          {source === 'audio' ? 'Trascrizione di' : 'Correzione di'} «{fileName}»
        </strong>
        {source === 'audio' && facts ? (
          <span className="omr-hint">
            {facts.beatsPerMeasure}/4 · ♩ = {facts.tempo} · {keyName(facts.key)}
            {facts.pickupBeats > 0 ? ` · anacrusi di ${facts.pickupBeats}` : ''}. Ascoltala con ▶ e clic su una nota per
            correggerla; il MIDI conserva l'esecuzione com'era, con rubato e pedale.
          </span>
        ) : (
          <span className="omr-hint">
            Confronta con il PDF a sinistra; clic su una nota per correggerla. Per correzioni più ampie salva il
            MusicXML e aprilo in MuseScore.
          </span>
        )}
        <span className="omr-actions">
          {source === 'pdf' && pdfPath && (
            <button
              disabled={busy || refining}
              onClick={() => void refineWithClaude()}
              title="Claude rilegge dal PDF le battute sospette e quella della nota selezionata. Richiede una chiave API (a pagamento) e invia ad Anthropic le immagini delle pagine."
            >
              {refining ? 'Claude sta rileggendo…' : 'Migliora con Claude'}
            </button>
          )}
          {midi && <button onClick={() => void savePerformanceMidi()}>Salva MIDI…</button>}
          <button onClick={() => void saveRecognised()}>Salva MusicXML…</button>
          <button className="primary" onClick={finishReview}>
            Fine correzione
          </button>
        </span>
      </div>
      {(refining || refineReport) && (
        <div className="omr-row omr-claude" role="status">
          {refining ? 'Claude sta rileggendo le battute sospette dal PDF: può volerci qualche minuto.' : refineReport}
          {!refining && <button onClick={() => useOmr.setState({ refineReport: null })}>✕</button>}
        </div>
      )}
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
          <button disabled={!selected || busy} onClick={() => void correct('delete')} title="Trasforma in pausa (⌫)">
            In pausa
          </button>
          <button disabled={!history.length || busy} onClick={() => void undoCorrection()} title="Annulla (⌘Z)">
            Annulla
          </button>
        </span>
        {error && <span className="omr-error">{error}</span>}
      </div>
      <div className="omr-row">
        <span className="omr-label">Ritmo</span>
        <span className="omr-tools" aria-label="Correzioni del ritmo">
          {VALUES.map((v) => (
            <button
              key={v.value}
              className="note-value"
              disabled={!selected || busy}
              onClick={() => void correct('set-duration', v.value)}
              title={`${v.name} (${v.key})`}
            >
              {v.label}
            </button>
          ))}
          <button disabled={!selected || busy} onClick={() => void correct('toggle-dot')} title="Punto sì/no (.)">
            ·
          </button>
          <button
            disabled={!selected || busy}
            onClick={() => void correct('triplet')}
            title="Terzina: questa nota e le due seguenti (T)"
          >
            3
          </button>
          <button
            disabled={!selected || busy}
            onClick={() => void correct('triplet-measure')}
            title="Terzine in tutta la battuta, per le note di questo valore in questa voce (⇧T)"
          >
            3 batt.
          </button>
        </span>
        <span className="omr-label">Note</span>
        <span className="omr-tools" aria-label="Correzioni delle note">
          <button
            disabled={!selected || busy}
            onClick={() => void correct('insert-after')}
            title="Inserisci una nota uguale dopo (I)"
          >
            + nota
          </button>
          <button
            disabled={!selected || busy}
            onClick={() => void correct('toggle-chord')}
            title="Separa dall'accordo / unisci all'accordo precedente (C)"
          >
            Accordo
          </button>
          <button disabled={!selected || busy} onClick={() => void correct('octave-up')} title="Ottava su (⇧↑)">
            8va↑
          </button>
          <button disabled={!selected || busy} onClick={() => void correct('octave-down')} title="Ottava giù (⇧↓)">
            8va↓
          </button>
          <button
            disabled={!selected || busy}
            onClick={() => void correct('delete-time')}
            title="Elimina togliendo anche il tempo (⇧⌫)"
          >
            Elimina tempo
          </button>
        </span>
      </div>
      <div className="omr-row omr-warnings">
        {measures.length === 0 ? (
          <span className="omr-ok">Nessuna battuta sospetta: controlla comunque note e alterazioni.</span>
        ) : (
          <>
            <span title="Battute la cui durata non torna con il tempo in chiave (arancioni in partitura)">
              {measures.length} {measures.length === 1 ? 'battuta sospetta' : 'battute sospette'}:
            </span>
            {shown.map(([measure, messages]) => (
              <button
                key={measure}
                className="warning-chip"
                title={messages.join('\n')}
                onClick={() => reveal(measure)}
              >
                Batt. {labels[measure - 1] ?? measure}
              </button>
            ))}
            {measures.length > VISIBLE_WARNINGS && (
              <button className="link" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Mostra meno' : `+${measures.length - VISIBLE_WARNINGS} altre`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** The PDF pages as recognised, beside the score. */
/** "G major" -> "Sol maggiore". */
export function keyName(key: string): string {
  const [tonic, mode] = key.split(' ')
  const names: Record<string, string> = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' }
  const accidental = tonic.slice(1).replace(/#/g, '♯').replace(/b/g, '♭')
  const base = names[tonic[0]] ?? tonic[0]
  return `${base}${accidental} ${mode === 'minor' ? 'minore' : 'maggiore'}`
}

export function OmrPages() {
  const previews = useOmr((s) => s.previews)
  if (!previews.length) return null
  return (
    <aside className="omr-pages" aria-label="PDF originale">
      {previews.map((src, i) => (
        <img key={i} src={src} alt={`Pagina ${i + 1}`} />
      ))}
    </aside>
  )
}
