import { create } from 'zustand'
import type { MeasureResult } from '../lib/ipc'

/** MIDI input and follow-mode state, mirrored from the Rust core. */
export interface MidiState {
  devices: string[]
  selected: string | null
  error: string | null
  /** Keys held down right now (MIDI piano or on-screen keyboard). */
  heldPitches: number[]
  /** Held keys that were not expected when pressed (follow mode). */
  wrongPitches: number[]
  following: boolean
  expectedPitches: number[]
  /** Latest result per measure index. */
  results: Record<number, MeasureResult>
  set: (patch: Partial<Omit<MidiState, 'set'>>) => void
}

export const useMidi = create<MidiState>((set) => ({
  devices: [],
  selected: null,
  error: null,
  heldPitches: [],
  wrongPitches: [],
  following: false,
  expectedPitches: [],
  results: {},
  set: (patch) => set(patch)
}))

export function followSummary(results: Record<number, MeasureResult>) {
  let correct = 0
  let wrong = 0
  for (const r of Object.values(results)) {
    correct += r.correct
    wrong += r.wrong
  }
  const total = correct + wrong
  return { correct, wrong, measures: Object.keys(results).length, accuracy: total ? correct / total : null }
}
