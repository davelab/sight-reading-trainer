import { create } from 'zustand'
import { inTauri, ipc, type Hands, type Loop, type PlaybackInfo } from '../lib/ipc'

export interface TransportState {
  playing: boolean
  positionMs: number
  currentNoteIds: string[]
  tempoPercent: number
  loop: Loop | null
  /** Loop start chosen with "A" while waiting for "B". */
  pendingLoopStart: number | null
  hands: Hands
  info: PlaybackInfo | null
  set: (patch: Partial<Omit<TransportState, 'set'>>) => void
}

export const useTransport = create<TransportState>((set) => ({
  playing: false,
  positionMs: 0,
  currentNoteIds: [],
  tempoPercent: 100,
  loop: null,
  pendingLoopStart: null,
  hands: 'both',
  info: null,
  set: (patch) => set(patch)
}))

/** Set (or clear) the A–B loop and jump to its start. */
export async function loopOn(loop: Loop | null): Promise<void> {
  useTransport.getState().set({ loop, pendingLoopStart: null })
  if (!inTauri) return
  await ipc.setLoop(loop)
  if (loop) await ipc.seek(loop.startMs)
}
