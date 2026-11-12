import { describe, expect, it } from 'vitest'
import { loopRange, patternLetter, repeatedMeasures, transpositionLabel } from './patterns'
import type { Pattern } from '../types'

describe('pattern helpers', () => {
  it('letters', () => {
    expect([0, 1, 25, 26, 27].map(patternLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB'])
  })

  it('transposition labels', () => {
    expect(transpositionLabel('-P5')).toBe('↓P5')
    expect(transpositionLabel('+M2')).toBe('↑M2')
    expect(transpositionLabel('P1')).toBe('')
    expect(transpositionLabel(undefined)).toBe('')
  })

  it('counts the measures that repeat something already seen', () => {
    const patterns: Pattern[] = [
      { id: 'p1', kind: 'exact', length: 6, occurrences: [1, 9] },
      { id: 'p2', kind: 'transposed', length: 2, occurrences: [5, 14] }
    ]
    expect([...repeatedMeasures(patterns)].sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 13, 14, 15])
  })

  it('turns measures into a loop range', () => {
    const ids = ['m1', 'm2', 'm3']
    const starts = [
      { measureId: 'm1', index: 1, ms: 0 },
      { measureId: 'm2', index: 2, ms: 1500 },
      { measureId: 'm3', index: 3, ms: 3000 }
    ]
    expect(loopRange(1, 2, ids, starts, 4500)).toEqual({ startMs: 0, endMs: 3000 })
    expect(loopRange(2, 2, ids, starts, 4500)).toEqual({ startMs: 1500, endMs: 4500 })
    expect(loopRange(9, 2, ids, starts, 4500)).toBeNull()
  })
})
