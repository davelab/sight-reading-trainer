import { create } from 'zustand'
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
  /** Verovio note id -> musical position (for corrections). */
  noteRefs: Map<string, NoteRef>
  loading: boolean
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
  noteRefs: new Map(),
  loading: false,
  error: null,
  zoom: 40,
  layout: 'scroll',
  set: (patch) => set(patch)
}))
