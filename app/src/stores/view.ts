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
}

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
  transpose: 0
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
