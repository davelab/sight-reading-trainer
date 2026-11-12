import { create } from 'zustand'
import type { MeasureResult, TimedResult, TimedSummary } from '../lib/ipc'

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
  /** "A tempo" mode is on, and counting in. */
  timed: boolean
  countingIn: boolean
  /** "A tempo" results per measure index, and the totals of the last run with its tempo. */
  timedResults: Record<number, TimedResult>
  timedSummary: (TimedSummary & { tempoPercent: number; fromMs: number }) | null
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
  timed: false,
  countingIn: false,
  timedResults: {},
  timedSummary: null,
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

/** Where the current "A tempo" run started (score ms), for «Riprova». */
export const timedRunStart = { ms: 0 }
