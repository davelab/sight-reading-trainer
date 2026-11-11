import { create } from 'zustand'
import type { MeasureStart, PlaybackEvent } from '../lib/timemap'

export interface ScoreState {
  fileName: string | null
  title: string | null
  musicxml: string | null
  events: PlaybackEvent[]
  measures: MeasureStart[]
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
  loading: false,
  error: null,
  zoom: 40,
  layout: 'scroll',
  set: (patch) => set(patch)
}))
