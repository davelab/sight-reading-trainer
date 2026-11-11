import { useEffect } from 'react'
import { inTauri, onPlaybackPosition } from '../lib/ipc'
import { useMidi } from '../stores/midi'
import { useTransport } from '../stores/transport'

/** Mirror the Rust `playback:position` event into the transport store. */
export function usePlaybackPosition(): void {
  useEffect(() => {
    if (!inTauri) return
    const unlisten = onPlaybackPosition(({ noteIds, ms, playing, following, expectedPitches }) => {
      useTransport.getState().set({ currentNoteIds: noteIds, positionMs: ms, playing })
      useMidi.getState().set({ following, expectedPitches })
    })
    return () => {
      void unlisten.then((fn) => fn())
    }
  }, [])
}
