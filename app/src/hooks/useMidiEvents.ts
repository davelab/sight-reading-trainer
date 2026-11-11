import { useEffect } from 'react'
import { inTauri, onFollowResult, onMidiNote } from '../lib/ipc'
import { useMidi } from '../stores/midi'

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
    return () => {
      void offNote.then((fn) => fn())
      void offResult.then((fn) => fn())
    }
  }, [])
}
