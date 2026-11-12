import { describe, expect, it } from 'vitest'
import { keyLabel, splitRoman } from './analysisOverlay'

describe('splitRoman', () => {
  it.each([
    ['I', { numeral: 'I', upper: '', lower: '', applied: '' }],
    ['V6', { numeral: 'V', upper: '6', lower: '', applied: '' }],
    ['ii65', { numeral: 'ii', upper: '6', lower: '5', applied: '' }],
    ['viiø43', { numeral: 'viiø', upper: '4', lower: '3', applied: '' }],
    ['viio7', { numeral: 'viio', upper: '7', lower: '', applied: '' }],
    ['V7/IV', { numeral: 'V', upper: '7', lower: '', applied: '/IV' }],
    ['V65/V', { numeral: 'V', upper: '6', lower: '5', applied: '/V' }],
    ['bVI', { numeral: 'bVI', upper: '', lower: '', applied: '' }]
  ])('%s', (figure, parts) => {
    expect(splitRoman(figure)).toEqual(parts)
  })

  it('keeps unusual figures whole', () => {
    expect(splitRoman('IVb753').numeral).toBe('IVb753')
  })
})

describe('keyLabel', () => {
  it('uses upper case for major and lower case for minor', () => {
    expect(keyLabel({ tonic: 'G', mode: 'major', fromMeasure: 1, toMeasure: 2, confidence: 1 })).toBe('G:')
    expect(keyLabel({ tonic: 'F#', mode: 'minor', fromMeasure: 1, toMeasure: 2, confidence: 1 })).toBe('f#:')
  })
})
