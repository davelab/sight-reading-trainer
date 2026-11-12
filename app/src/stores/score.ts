import { create } from 'zustand'
import type { Meter, Spelling } from '../lib/practice'
import type { MeasureOnset, MeasureStart, PlaybackEvent } from '../lib/timemap'
import type { NoteRef } from '../types'

export interface ScoreState {
  fileName: string | null
  title: string | null
  musicxml: string | null
  events: PlaybackEvent[]
  measures: MeasureStart[]
  /** Note onsets per measure id, for annotations anchored to (measure, offset). */
  onsets: Map<string, MeasureOnset[]>
  /** Printed measure number by ordinal - 1 (annotations use ordinals). */
  measureLabels: string[]
  /** Measure xml:id by ordinal - 1. */
  measureIds: string[]
  /** Time signature by ordinal - 1 (metronome). */
  meters: Meter[]
  /** Written step and octave of every note id (note names, intervals). */
  spellings: Map<string, Spelling>
  /** Verovio note id -> musical position (for corrections). */
  noteRefs: Map<string, NoteRef>
  loading: boolean
  /** The open score has changes not saved to a file (a corrected import). */
  unsaved: boolean
  error: string | null
  /** Verovio scale in percent. */
  zoom: number
  layout: 'scroll' | 'pages'
  set: (patch: Partial<Omit<ScoreState, 'set'>>) => void
}

export const useScore = create<ScoreState>((set) => ({
  fileName: null,
  title: null,
  musicxml: null,
  events: [],
  measures: [],
  onsets: new Map(),
  measureLabels: [],
  measureIds: [],
  meters: [],
  spellings: new Map(),
  noteRefs: new Map(),
  loading: false,
  unsaved: false,
  error: null,
  zoom: 40,
  layout: 'scroll',
  set: (patch) => set(patch)
}))
