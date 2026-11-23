import { judgeRun } from '../../lib/practice'
import { useMidi } from '../../stores/midi'
import { retryTimed } from '../../stores/practice'
import '../OmrReview/OmrReview.css'
import '../TranscribeSetup/TranscribeSetup.css'

const pct = (x: number) => `${Math.round(x * 100)}%`

/** After an "A tempo" run: how it went, and the tempo to try next. */
export function TimedSummaryCard() {
  const summary = useMidi((s) => s.timedSummary)
  if (!summary || summary.expected + summary.wrong === 0) return null
  const v = judgeRun(summary, summary.tempoPercent)
  const close = () => useMidi.getState().set({ timedSummary: null })
  const offset = Math.round(summary.meanOffsetMs)
  return (
    <div className="omr-card" role="status">
      <strong>
        Risultato al {summary.tempoPercent}%: {pct(v.notes)} note giuste, {pct(v.onTime)} a tempo
      </strong>
      <span>
        {summary.correct} a tempo · {summary.early} in anticipo · {summary.late} in ritardo · {summary.wrong} sbagliate
        · {summary.missed} mancate, su {summary.measures} battute.
        {Math.abs(offset) >= 10 && ` In media ${Math.abs(offset)} ms ${offset > 0 ? 'in ritardo' : 'in anticipo'}.`}
      </span>
      <span>{v.advice}</span>
      <span className="tx-actions">
        <button onClick={close}>Chiudi</button>
        <button onClick={() => void retryTimed()}>Riprova</button>
        {v.nextTempo !== summary.tempoPercent && (
          <button className="primary" onClick={() => void retryTimed(v.nextTempo)}>
            Riprova al {v.nextTempo}%
          </button>
        )}
      </span>
    </div>
  )
}
