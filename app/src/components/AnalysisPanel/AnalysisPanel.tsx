import { useAnalysis } from '../../stores/analysis'

/** Key, chords, patterns and sections. Filled from milestone M3. */
export function AnalysisPanel() {
  const analysis = useAnalysis((s) => s.analysis)
  if (!analysis) return null
  return (
    <aside className="analysis-panel">
      {analysis.key?.map((k) => (
        <p key={`${k.fromMeasure}-${k.tonic}`}>
          {k.tonic} {k.mode === 'major' ? 'maggiore' : 'minore'} (batt. {k.fromMeasure}–{k.toMeasure})
        </p>
      ))}
    </aside>
  )
}
