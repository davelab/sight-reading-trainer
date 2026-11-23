import { describe, expect, it } from 'vitest'
import { keyLabel, splitRoman } from './analysisOverlay'

describe('splitRoman', () => {
  it.each([
    ['I', { numeral: 'I', upper: '', lower: '', applied: '', altered: '' }],
    ['V6', { numeral: 'V', upper: '6', lower: '', applied: '', altered: '' }],
    ['ii65', { numeral: 'ii', upper: '6', lower: '5', applied: '', altered: '' }],
    ['viiø43', { numeral: 'viiø', upper: '4', lower: '3', applied: '', altered: '' }],
    ['viio7', { numeral: 'viio', upper: '7', lower: '', applied: '', altered: '' }],
    ['V7/IV', { numeral: 'V', upper: '7', lower: '', applied: '/IV', altered: '' }],
    ['V65/V', { numeral: 'V', upper: '6', lower: '5', applied: '/V', altered: '' }],
    ['bVI', { numeral: 'bVI', upper: '', lower: '', applied: '', altered: '' }],
    ['ii#642', { numeral: 'ii', upper: '4', lower: '2', applied: '', altered: '♯6' }]
  ])('%s', (figure, parts) => {
    expect(splitRoman(figure)).toEqual(parts)
  })

  it('keeps unusual figures whole', () => {
    expect(splitRoman('V9753').numeral).toBe('V9753')
  })
})

describe('keyLabel', () => {
  it('uses upper case for major and lower case for minor', () => {
    expect(keyLabel({ tonic: 'G', mode: 'major', fromMeasure: 1, toMeasure: 2, confidence: 1 })).toBe('G:')
    expect(keyLabel({ tonic: 'F#', mode: 'minor', fromMeasure: 1, toMeasure: 2, confidence: 1 })).toBe('f#:')
  })
})
