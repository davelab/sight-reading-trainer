import { FUNCTION_NAMES, LABEL_STYLES, italianName, type ChordLabelStyle } from '../../lib/chordLabels'
import { inTauri, ipc } from '../../lib/ipc'
import { revealMeasure } from '../../lib/overlay'
import { useView } from '../../stores/view'
import { loopRange, patternColor, patternLetter, repeatedMeasures, transpositionLabel } from '../../lib/patterns'
import { scoreDurationMs } from '../../lib/timemap'
import { runAnalysis, useAnalysis } from '../../stores/analysis'
import { useScore } from '../../stores/score'
import { loopOn, useTransport } from '../../stores/transport'
import './AnalysisPanel.css'

const MODE = { major: 'maggiore', minor: 'minore' } as const
const KIND = { exact: 'identica', transposed: 'trasposta', variant: 'variata' } as const

/** Key regions, analysis status and display switches, in a bar above the score. */
export function AnalysisPanel() {
  const { analysis, status, error, display, setDisplay, selectedPattern } = useAnalysis()
  const keysCollapsed = useView((s) => s.keysCollapsed)
  const patternsCollapsed = useView((s) => s.patternsCollapsed)
  const setView = useView((s) => s.set)
  // Measure (ordinal) under the cursor: re-renders only when it changes.
  const atMeasure = useTransport((t) => {
    const { measures, measureIds } = useScore.getState()
    const current = [...measures].reverse().find((m) => m.ms <= t.positionMs + 1)
    return Math.max(1, current ? measureIds.indexOf(current.measureId) + 1 : 1)
  })
  const musicxml = useScore((s) => s.musicxml)
  const labels = useScore((s) => s.measureLabels)
  const measureIds = useScore((s) => s.measureIds)
  const measureStarts = useScore((s) => s.measures)
  const events = useScore((s) => s.events)
  const loop = useTransport((s) => s.loop)
  if (!musicxml) return null

  const patterns = analysis?.patterns ?? []
  const repeated = repeatedMeasures(patterns).size
  const loopOccurrence = (start: number, length: number) => {
    const range = loopRange(start, length, measureIds, measureStarts, scoreDurationMs(events))
    if (range) void loopOn(range)
  }
  const isLooped = (start: number, length: number) => {
    const range = loopRange(start, length, measureIds, measureStarts, scoreDurationMs(events))
    return !!range && !!loop && Math.abs(loop.startMs - range.startMs) < 1 && Math.abs(loop.endMs - range.endMs) < 1
  }
  const handName = { both: '', right: ' · m. destra', left: ' · m. sinistra' } as const

  const label = (ordinal: number) => labels[ordinal - 1] ?? String(ordinal)
  const keys = analysis?.key ?? []
  const currentKey = keys.find((k) => k.fromMeasure <= atMeasure && atMeasure <= k.toMeasure) ?? keys[0]
  const goToMeasure = (ordinal: number) => {
    const start = measureStarts.find((m) => m.measureId === measureIds[ordinal - 1])
    if (start && inTauri) void ipc.seek(start.ms)
    const view = document.querySelector('.score-view')
    if (view) revealMeasure(view, measureIds, ordinal)
  }

  return (
    <div className="analysis-panel">
      {status === 'running' && <span className="analysis-status">Analisi armonica in corso…</span>}
      {status === 'error' && (
        <span className="analysis-status error" title={error ?? ''}>
          Analisi non disponibile
          <button onClick={() => void runAnalysis(musicxml)}>Riprova</button>
        </span>
      )}
      {status === 'done' && keys.length > 0 && (
        <span className={`analysis-keys${keysCollapsed ? ' collapsed' : ''}`}>
          {keys.length > 1 && (
            <button
              className="collapse-toggle"
              aria-expanded={!keysCollapsed}
              onClick={() => setView({ keysCollapsed: !keysCollapsed })}
              title={keysCollapsed ? 'Mostra tutte le zone tonali' : 'Riduci: solo la tonalità del punto in cui sei'}
            >
              {keysCollapsed ? '▸' : '▾'}
            </button>
          )}
          <span className="analysis-label">Tonalità</span>
          {(keysCollapsed && keys.length > 1 ? keys.filter((k) => k === currentKey) : keys).map((k) => (
            <button
              key={`${k.fromMeasure}-${k.tonic}-${k.mode}`}
              className={`key-chip${k === currentKey && keys.length > 1 ? ' current' : ''}`}
              title={`Affidabilità ${Math.round(k.confidence * 100)}% · clic: vai a battuta ${label(k.fromMeasure)}`}
              onClick={() => goToMeasure(k.fromMeasure)}
            >
              <strong>
                {italianName(k.tonic)} {MODE[k.mode]}
              </strong>
              <span className="range">
                {keys.length > 1 ? ` batt. ${label(k.fromMeasure)}–${label(k.toMeasure)}` : ' (tutto il brano)'}
              </span>
            </button>
          ))}
          {keysCollapsed && keys.length > 1 && (
            <span className="analysis-more">{keys.length} zone tonali (modulazioni) · ▸ per vederle tutte</span>
          )}
        </span>
      )}
      <span className="analysis-switches">
        <label>
          <input type="checkbox" checked={display.chords} onChange={(e) => setDisplay({ chords: e.target.checked })} />
          Accordi
        </label>
        <select
          aria-label="Come scrivere gli accordi"
          value={display.labelStyle}
          disabled={!display.chords}
          title={LABEL_STYLES.find((s) => s.value === display.labelStyle)?.hint}
          onChange={(e) => setDisplay({ labelStyle: e.target.value as ChordLabelStyle })}
        >
          {LABEL_STYLES.map((s) => (
            <option key={s.value} value={s.value} title={s.hint}>
              {s.label}
            </option>
          ))}
        </select>
        <label title="Colora gli accordi secondo la funzione: tonica, sottodominante, dominante">
          <input
            type="checkbox"
            checked={display.functions}
            disabled={!display.chords}
            onChange={(e) => setDisplay({ functions: e.target.checked })}
          />
          Colori
        </label>
        <label>
          <input
            type="checkbox"
            checked={display.patterns}
            onChange={(e) => setDisplay({ patterns: e.target.checked })}
          />
          Pattern
        </label>
        {display.chords && (display.functions || display.labelStyle === 'functions') && (
          <span
            className="fn-legend"
            title="Tonica: riposo. Sottodominante: si allontana e prepara. Dominante: tensione che chiede di tornare alla tonica. Grigio: accordi senza una di queste funzioni."
          >
            <i className="fn-tonic">T {FUNCTION_NAMES.tonic}</i>
            <i className="fn-predominant">S {FUNCTION_NAMES.predominant}</i>
            <i className="fn-dominant">D {FUNCTION_NAMES.dominant}</i>
          </span>
        )}
      </span>
      {status === 'done' && display.patterns && patterns.length > 0 && (
        <div className={`pattern-list${patternsCollapsed ? ' collapsed' : ''}`}>
          <button
            className="collapse-toggle"
            aria-expanded={!patternsCollapsed}
            onClick={() => setView({ patternsCollapsed: !patternsCollapsed })}
            title={patternsCollapsed ? 'Mostra le frasi ripetute' : 'Riduci a una riga'}
          >
            {patternsCollapsed ? '▸' : '▾'}
          </button>
          <span className="analysis-label">Frasi ripetute</span>
          <span className="pattern-summary">
            {patterns.length} {patterns.length === 1 ? 'frase' : 'frasi'} che tornano: {repeated} battute su{' '}
            {labels.length} sono già viste altrove
            {patternsCollapsed
              ? ''
              : ' — passa sopra una frase per colorarla in partitura, clic su un numero per ripeterla in loop'}
          </span>
          {!patternsCollapsed &&
            patterns.map((p, i) => (
              <span
                key={p.id}
                className={`pattern-chip${selectedPattern === p.id ? ' selected' : ''}`}
                style={{ ['--pattern' as string]: patternColor(i) }}
                onMouseEnter={() => useAnalysis.setState({ selectedPattern: p.id })}
                onMouseLeave={() => useAnalysis.setState({ selectedPattern: null })}
              >
                <i className="swatch" />
                <strong>{patternLetter(i)}</strong>
                <span className="pattern-meta">
                  {p.length} {p.length === 1 ? 'battuta' : 'battute'} · {KIND[p.kind]}
                  {handName[p.hands ?? 'both']} · alle battute
                </span>
                {p.occurrences.map((start, occ) => (
                  <button
                    key={start}
                    className={isLooped(start, p.length) ? 'looped' : ''}
                    onClick={() => loopOccurrence(start, p.length)}
                    title={`Loop delle battute ${label(start)}–${label(start + p.length - 1)}`}
                  >
                    {label(start)}
                    {occ > 0 && transpositionLabel(p.transpositions?.[occ]) && (
                      <small> {transpositionLabel(p.transpositions?.[occ])}</small>
                    )}
                  </button>
                ))}
              </span>
            ))}
        </div>
      )}
    </div>
  )
}
