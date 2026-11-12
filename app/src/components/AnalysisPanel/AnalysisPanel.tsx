import { loopRange, patternColor, patternLetter, repeatedMeasures, transpositionLabel } from '../../lib/patterns'
import { scoreDurationMs } from '../../lib/timemap'
import { runAnalysis, useAnalysis } from '../../stores/analysis'
import { useScore } from '../../stores/score'
import { loopOn, useTransport } from '../../stores/transport'
import './AnalysisPanel.css'

const MODE = { major: 'maggiore', minor: 'minore' } as const

/** Key regions, analysis status and display switches, in a bar above the score. */
export function AnalysisPanel() {
  const { analysis, status, error, display, setDisplay, selectedPattern } = useAnalysis()
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

  return (
    <div className="analysis-panel">
      {status === 'running' && <span className="analysis-status">Analisi armonica in corso…</span>}
      {status === 'error' && (
        <span className="analysis-status error" title={error ?? ''}>
          Analisi non disponibile
          <button onClick={() => void runAnalysis(musicxml)}>Riprova</button>
        </span>
      )}
      {status === 'done' && (
        <span className="analysis-keys">
          {keys.map((k, i) => (
            <span key={`${k.fromMeasure}-${k.tonic}-${k.mode}`} className="key-chip" title={`Affidabilità ${Math.round(k.confidence * 100)}%`}>
              <strong>
                {k.tonic} {MODE[k.mode]}
              </strong>
              {keys.length > 1 && (
                <span className="range">
                  {' '}
                  batt. {label(k.fromMeasure)}–{label(k.toMeasure)}
                </span>
              )}
              {i === 0 && keys.length === 1 && <span className="range"> (tutto il brano)</span>}
            </span>
          ))}
        </span>
      )}
      <span className="analysis-switches">
        <label>
          <input type="checkbox" checked={display.roman} onChange={(e) => setDisplay({ roman: e.target.checked })} />
          Numeri romani
        </label>
        <label>
          <input type="checkbox" checked={display.symbols} onChange={(e) => setDisplay({ symbols: e.target.checked })} />
          Sigle
        </label>
        <label>
          <input
            type="checkbox"
            checked={display.functions}
            disabled={!display.roman}
            onChange={(e) => setDisplay({ functions: e.target.checked })}
          />
          Funzioni
        </label>
        <label>
          <input type="checkbox" checked={display.patterns} onChange={(e) => setDisplay({ patterns: e.target.checked })} />
          Pattern
        </label>
        {display.roman && display.functions && (
          <span className="fn-legend">
            <i className="fn-tonic">T</i>
            <i className="fn-predominant">P</i>
            <i className="fn-dominant">D</i>
          </span>
        )}
      </span>
      {status === 'done' && display.patterns && patterns.length > 0 && (
        <div className="pattern-list">
          <span className="pattern-summary">
            {repeated} battute su {labels.length} ripetono una frase già vista
          </span>
          {patterns.map((p, i) => (
            <span
              key={p.id}
              className={`pattern-chip${selectedPattern === p.id ? ' selected' : ''}`}
              style={{ ['--pattern' as string]: patternColor(i) }}
              onMouseEnter={() => useAnalysis.setState({ selectedPattern: p.id })}
              onMouseLeave={() => useAnalysis.setState({ selectedPattern: null })}
              title={`${p.kind === 'exact' ? 'Identica' : 'Trasposta'}, ${p.length} battute. Clic su un numero: loop di quella ricorrenza`}
            >
              <i className="swatch" />
              <strong>{patternLetter(i)}</strong>
              <span className="pattern-meta">
                {p.length} batt.{p.kind === 'transposed' ? ' · trasposta' : ''}
                {handName[p.hands ?? 'both']}
              </span>
              {p.occurrences.map((start, occ) => (
                <button
                  key={start}
                  className={isLooped(start, p.length) ? 'looped' : ''}
                  onClick={() => loopOccurrence(start, p.length)}
                >
                  {labels[start - 1] ?? start}
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
