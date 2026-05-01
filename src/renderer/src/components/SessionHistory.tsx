import type { PracticeSession } from '../types'

interface SessionHistoryProps {
  sessions: PracticeSession[]
  onClear: () => void
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function AccuracyBadge({ pct }: { pct: number }) {
  const cls =
    pct >= 80 ? 'badge badge--good' : pct >= 50 ? 'badge badge--ok' : 'badge badge--poor'
  return <span className={cls}>{pct}%</span>
}

export function SessionHistory({ sessions, onClear }: SessionHistoryProps) {
  if (sessions.length === 0) {
    return (
      <div className="history-empty">
        <div className="history-empty-icon">📋</div>
        <p>No practice sessions yet.</p>
        <p className="text-muted">Complete a practice session to see your history here.</p>
      </div>
    )
  }

  const sorted = [...sessions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )

  const avgPitch = Math.round(
    sessions.reduce((s, n) => s + n.pitchAccuracy, 0) / sessions.length
  )
  const avgRhythm = Math.round(
    sessions.reduce((s, n) => s + n.rhythmAccuracy, 0) / sessions.length
  )

  return (
    <div className="history">
      <div className="history-summary">
        <div className="summary-card">
          <span className="summary-value">{sessions.length}</span>
          <span className="summary-label">Sessions</span>
        </div>
        <div className="summary-card">
          <span className="summary-value">{avgPitch}%</span>
          <span className="summary-label">Avg Pitch</span>
        </div>
        <div className="summary-card">
          <span className="summary-value">{avgRhythm}%</span>
          <span className="summary-label">Avg Rhythm</span>
        </div>
      </div>

      <div className="history-table-wrapper">
        <table className="history-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Clef</th>
              <th>BPM</th>
              <th>Measures</th>
              <th>Notes</th>
              <th>Pitch</th>
              <th>Rhythm</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(session => (
              <tr key={session.id}>
                <td className="date-cell">{formatDate(session.date)}</td>
                <td className="clef-cell">{session.clef.charAt(0).toUpperCase() + session.clef.slice(1)}</td>
                <td>{session.bpm}</td>
                <td>{session.numMeasures}</td>
                <td>{session.totalNotes}</td>
                <td><AccuracyBadge pct={session.pitchAccuracy} /></td>
                <td><AccuracyBadge pct={session.rhythmAccuracy} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="history-actions">
        <button className="btn btn-ghost btn-sm" onClick={onClear}>
          Clear history
        </button>
      </div>
    </div>
  )
}
