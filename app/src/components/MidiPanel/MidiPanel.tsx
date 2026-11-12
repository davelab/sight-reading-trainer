import { useCallback, useEffect } from 'react'
import { inTauri, ipc } from '../../lib/ipc'
import { followSummary, useMidi } from '../../stores/midi'
import { startTimed, stopTimed } from '../../stores/practice'
import { useScore } from '../../stores/score'
import './MidiPanel.css'

const POLL_MS = 3000

/** MIDI input selection and the follow-mode switch with its running score. */
export function MidiPanel() {
  const { devices, selected, error, following, results, timed, countingIn, timedResults, set } = useMidi()
  const hasScore = useScore((s) => s.events.length > 0)

  const refresh = useCallback(async () => {
    if (!inTauri) return
    try {
      const { devices, selected } = await ipc.midiListDevices()
      useMidi.getState().set({ devices, selected, error: null })
    } catch (e) {
      useMidi.getState().set({ devices: [], selected: null, error: String(e) })
    }
  }, [])

  // midir has no hot-plug notifications: poll while the window is visible.
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => document.visibilityState === 'visible' && void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const select = async (name: string) => {
    try {
      await ipc.midiSelect(name || null)
      set({ selected: name || null, error: null })
    } catch (e) {
      set({ error: String(e) })
      void refresh()
    }
  }

  const toggleFollow = async () => {
    if (!following) set({ results: {}, heldPitches: [], wrongPitches: [] })
    const active = await ipc.setFollowMode(!following)
    set({ following: active })
  }

  const summary = followSummary(results)
  const live = Object.values(timedResults).reduce(
    (a, r) => ({ ok: a.ok + r.correct, off: a.off + r.early + r.late, bad: a.bad + r.wrong + r.missed }),
    { ok: 0, off: 0, bad: 0 }
  )

  return (
    <div className="midi-panel">
      <select
        value={selected ?? ''}
        disabled={!inTauri || (devices.length === 0 && !selected)}
        onChange={(e) => void select(e.target.value)}
        title={error ?? 'Ingresso MIDI'}
      >
        <option value="">{devices.length ? 'Nessun piano MIDI' : 'Nessun dispositivo MIDI'}</option>
        {devices.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <button
        className={following ? 'follow on' : 'follow'}
        disabled={!inTauri || !hasScore}
        onClick={() => void toggleFollow()}
        title="Il cursore avanza solo quando suoni le note giuste"
      >
        Segui
      </button>
      <button
        className={timed ? 'follow on' : 'follow'}
        disabled={!inTauri || !hasScore}
        onClick={() => void (timed ? stopTimed() : startTimed())}
        title="La musica va avanti al tempo scelto anche se sbagli, come leggendo a prima vista: ogni nota è giudicata giusta, in anticipo, in ritardo o mancata. La mano che non suoni la suona l'app."
      >
        {timed ? 'Ferma' : 'A tempo'}
      </button>
      {timed && (
        <span className="follow-summary">
          {countingIn ? 'Conto…' : `${live.ok} a tempo · ${live.off} fuori tempo · ${live.bad} errori`}
        </span>
      )}
      {!timed && summary.accuracy !== null && (
        <span className="follow-summary" title={`${summary.measures} battute`}>
          {summary.correct} giuste · {summary.wrong} sbagliate · {Math.round(summary.accuracy * 100)}%
        </span>
      )}
    </div>
  )
}
