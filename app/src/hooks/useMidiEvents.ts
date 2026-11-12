import { useEffect } from 'react'
import { inTauri, onFollowResult, onMidiNote, onTimedResult, onTimedSummary } from '../lib/ipc'
import { timedRunStart, useMidi } from '../stores/midi'
import { useTransport } from '../stores/transport'

/** Mirror `midi:note` and `follow:result` into the MIDI store. */
export function useMidiEvents(): void {
  useEffect(() => {
    if (!inTauri) return
    const offNote = onMidiNote(({ pitch, on }) => {
      const s = useMidi.getState()
      const held = s.heldPitches.filter((p) => p !== pitch)
      const wrong = s.wrongPitches.filter((p) => p !== pitch)
      if (on) {
        held.push(pitch)
        // Judged against the chord expected when the key went down.
        if (s.following && !s.expectedPitches.includes(pitch)) wrong.push(pitch)
      }
      s.set({ heldPitches: held, wrongPitches: wrong })
    })
    const offResult = onFollowResult((r) => {
      const s = useMidi.getState()
      s.set({ results: { ...s.results, [r.measure]: r } })
    })
    const offTimed = onTimedResult((r) => {
      const s = useMidi.getState()
      s.set({ timedResults: { ...s.timedResults, [r.measure]: r } })
    })
    const offSummary = onTimedSummary((summary) => {
      const tempoPercent = useTransport.getState().tempoPercent
      useMidi.getState().set({ timed: false, timedSummary: { ...summary, tempoPercent, fromMs: timedRunStart.ms } })
    })
    return () => {
      for (const off of [offNote, offResult, offTimed, offSummary]) void off.then((fn) => fn())
    }
  }, [])
}
