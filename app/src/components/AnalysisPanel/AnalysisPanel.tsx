import { runAnalysis, useAnalysis } from '../../stores/analysis'
import { useScore } from '../../stores/score'
import './AnalysisPanel.css'

const MODE = { major: 'maggiore', minor: 'minore' } as const

/** Key regions, analysis status and display switches, in a bar above the score. */
export function AnalysisPanel() {
  const { analysis, status, error, display, setDisplay } = useAnalysis()
  const musicxml = useScore((s) => s.musicxml)
  const labels = useScore((s) => s.measureLabels)
  if (!musicxml) return null

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
        {display.roman && display.functions && (
          <span className="fn-legend">
            <i className="fn-tonic">T</i>
            <i className="fn-predominant">P</i>
            <i className="fn-dominant">D</i>
          </span>
        )}
      </span>
    </div>
  )
}
