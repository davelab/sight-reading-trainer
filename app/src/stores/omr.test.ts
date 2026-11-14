import { describe, expect, it } from 'vitest'
import { listMeasures, refineSummary } from './omr'

describe("Claude's second reading", () => {
  it('lists measures in Italian', () => {
    expect(listMeasures([6])).toBe('6')
    expect(listMeasures([6, 8])).toBe('6 e 8')
    expect(listMeasures([6, 7, 8])).toBe('6, 7 e 8')
  })

  it('summarises what changed and what stayed', () => {
    expect(
      refineSummary({
        musicxml: '',
        warnings: [],
        changed: [6, 8],
        kept: [{ measure: 7, reason: 'Claude non è sicuro' }]
      })
    ).toBe("Claude ha riscritto le battute 6 e 8. Rimasta com'era: 7 (Claude non è sicuro).")
    expect(refineSummary({ musicxml: '', warnings: [], changed: [], kept: [] })).toMatch(/Nessuna battuta sospetta/)
  })
})
