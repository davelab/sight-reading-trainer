import { create } from 'zustand'

/** MIDI input state, wired to Rust (midir) in milestone M2. */
export interface MidiState {
  devices: string[]
  selected: string | null
  heldPitches: number[]
}

export const useMidi = create<MidiState>(() => ({ devices: [], selected: null, heldPitches: [] }))
