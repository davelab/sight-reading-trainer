import { create } from 'zustand'
import { inTauri, ipc } from '../lib/ipc'
import type { Analysis } from '../types'

export interface AnalysisDisplay {
  roman: boolean
  symbols: boolean
  /** Colour roman numerals by harmonic function. */
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

export const useAnalysis = create<AnalysisState>((set) => ({
  analysis: null,
  status: 'idle',
  error: null,
  display: { roman: true, symbols: false, functions: true, patterns: true },
  selectedPattern: null,
  setDisplay: (patch) => set((s) => ({ display: { ...s.display, ...patch } }))
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
