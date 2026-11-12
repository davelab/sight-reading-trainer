import { create } from 'zustand'

/**
 * How the score is shown and heard, remembered between sessions
 * (localStorage, per this computer only).
 */
export interface ViewSettings {
  mode: 'score' | 'falling' | 'both'
  showChords: boolean
  showNoteNames: boolean
  showKeyNames: boolean
  showNoteLines: boolean
  rightColor: string
  leftColor: string
  showRight: boolean
  showLeft: boolean
  /** 0–1. */
  volume: number
  /** 0–1. */
  reverb: number
  /** Falling-notes zoom: pixels per second of music. */
  pixelsPerSecond: number
  /** Semitones, -12..12. */
  transpose: number
  /** Metronome clicks while the music plays (any mode). */
  metronome: boolean
  /** "A tempo" mode: one measure of clicks before the music. */
  countIn: boolean
  /** "A tempo" mode: how far from its time a note still counts as on time. */
  tolerance: 'strict' | 'normal' | 'loose'
  /** Cover the measure being played (and the next) to make the eyes read ahead. */
  lookahead: 'off' | 'current' | 'next'
  /** Reading aids on the score, to switch off one by one. */
  aidNoteNames: boolean
  aidIntervals: boolean
  aidChordShapes: boolean
}

export const TOLERANCE_MS = { strict: 80, normal: 130, loose: 200 } as const

export const DEFAULT_VIEW: ViewSettings = {
  mode: 'score',
  showChords: true,
  showNoteNames: false,
  showKeyNames: false,
  showNoteLines: true,
  rightColor: '#e0a800',
  leftColor: '#8e5bd6',
  showRight: true,
  showLeft: true,
  volume: 0.5,
  reverb: 0.3,
  pixelsPerSecond: 160,
  transpose: 0,
  metronome: false,
  countIn: true,
  tolerance: 'normal',
  lookahead: 'off',
  aidNoteNames: false,
  aidIntervals: false,
  aidChordShapes: false
}

const STORAGE_KEY = 'view-settings'

function load(): ViewSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return { ...DEFAULT_VIEW, ...(typeof saved === 'object' && saved ? saved : {}) }
  } catch {
    return { ...DEFAULT_VIEW }
  }
}

export const useView = create<ViewSettings & { set: (patch: Partial<ViewSettings>) => void }>((set) => ({
  ...load(),
  set: (patch) =>
    set((s) => {
      const next = { ...s, ...patch }
      try {
        const { set: _omit, ...data } = next
        void _omit
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      } catch {
        // storage unavailable: settings last for this session only
      }
      return next
    })
}))
