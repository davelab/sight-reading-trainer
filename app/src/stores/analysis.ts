import { create } from 'zustand'
import type { Analysis } from '../types'

/** Filled by the engine's `analyze` method from milestone M3. */
export const useAnalysis = create<{ analysis: Analysis | null }>(() => ({ analysis: null }))
