interface AccuracyDisplayProps {
  totalNotes: number
  correctPitch: number
  correctRhythm: number
}

export function AccuracyDisplay({ totalNotes, correctPitch, correctRhythm }: AccuracyDisplayProps) {
  if (totalNotes === 0) return null

  const pitchPct = Math.round((correctPitch / totalNotes) * 100)
  const rhythmPct = Math.round((correctRhythm / totalNotes) * 100)

  function barColor(pct: number): string {
    if (pct >= 80) return 'var(--success)'
    if (pct >= 50) return 'var(--warning)'
    return 'var(--error)'
  }

  return (
    <div className="accuracy-display">
      <div className="accuracy-row">
        <span className="accuracy-label">Pitch</span>
        <div className="accuracy-bar-track">
          <div
            className="accuracy-bar-fill"
            style={{ width: `${pitchPct}%`, background: barColor(pitchPct) }}
          />
        </div>
        <span className="accuracy-value">{pitchPct}%</span>
      </div>
      <div className="accuracy-row">
        <span className="accuracy-label">Rhythm</span>
        <div className="accuracy-bar-track">
          <div
            className="accuracy-bar-fill"
            style={{ width: `${rhythmPct}%`, background: barColor(rhythmPct) }}
          />
        </div>
        <span className="accuracy-value">{rhythmPct}%</span>
      </div>
    </div>
  )
}
