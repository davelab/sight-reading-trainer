import { create } from 'zustand'
import { inTauri, ipc } from '../lib/ipc'
import type { ChordLabelStyle } from '../lib/chordLabels'
import type { Analysis } from '../types'

/** How the analysis is shown; remembered between sessions (localStorage). */
export interface AnalysisDisplay {
  /** The row of chord labels under each system. */
  chords: boolean
  labelStyle: ChordLabelStyle
  /** Colour chord labels by harmonic function. */
  functions: boolean
  /** Tint repeated phrases, one colour per pattern. */
  patterns: boolean
}

export interface AnalysisState {
  analysis: Analysis | null
  status: 'idle' | 'running' | 'done' | 'error'
  error: string | null
  display: AnalysisDisplay
  /** Pattern highlighted in the score (its id), if any. */
  selectedPattern: string | null
  setDisplay: (patch: Partial<AnalysisDisplay>) => void
}

export const DEFAULT_DISPLAY: AnalysisDisplay = {
  chords: true,
  labelStyle: 'name-degree',
  functions: true,
  patterns: true
}
const STORAGE_KEY = 'analysis-display'

function loadDisplay(): AnalysisDisplay {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    const merged = { ...DEFAULT_DISPLAY, ...(typeof saved === 'object' && saved ? saved : {}) }
    return Object.fromEntries(
      Object.keys(DEFAULT_DISPLAY).map((k) => [k, merged[k as keyof AnalysisDisplay]])
    ) as unknown as AnalysisDisplay
  } catch {
    return { ...DEFAULT_DISPLAY }
  }
}

export const useAnalysis = create<AnalysisState>((set) => ({
  analysis: null,
  status: 'idle',
  error: null,
  display: loadDisplay(),
  selectedPattern: null,
  setDisplay: (patch) =>
    set((s) => {
      const display = { ...s.display, ...patch }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(display))
      } catch {
        // storage unavailable: the choice lasts for this session only
      }
      return { display }
    })
}))

let request = 0

/** Ask the engine for the analysis of the loaded score; stale answers are dropped. */
export async function runAnalysis(musicxml: string): Promise<void> {
  const mine = ++request
  if (!inTauri) {
    useAnalysis.setState({ analysis: null, status: 'error', error: "L'analisi richiede l'app desktop" })
    return
  }
  useAnalysis.setState({ analysis: null, status: 'running', error: null, selectedPattern: null })
  try {
    const analysis = await ipc.analyze(musicxml)
    if (mine === request) useAnalysis.setState({ analysis, status: 'done' })
  } catch (e) {
    if (mine === request) useAnalysis.setState({ status: 'error', error: String(e) })
  }
}
