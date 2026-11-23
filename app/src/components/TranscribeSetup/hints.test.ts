import { describe, expect, it } from 'vitest'
import { EMPTY_FORM, KEY_OPTIONS, tapTempo, toHints } from './hints'

describe('transcription hints', () => {
  it('sends only what was filled in', () => {
    expect(toHints(EMPTY_FORM)).toEqual({})
    expect(toHints({ tempo: '96,5', meter: '3', key: 'Bb minor', pickup: '1' })).toEqual({
      tempo: 97,
      beatsPerMeasure: 3,
      key: 'Bb minor',
      pickupBeats: 1
    })
    expect(toHints({ ...EMPTY_FORM, tempo: 'abc' })).toEqual({})
    expect(toHints({ ...EMPTY_FORM, pickup: '0' })).toEqual({ pickupBeats: 0 })
  })

  it('lists keys in the engine format', () => {
    expect(KEY_OPTIONS).toContainEqual({ value: 'G major', label: 'Sol maggiore' })
    expect(KEY_OPTIONS).toContainEqual({ value: 'F# minor', label: 'Fa♯ minore' })
    expect(KEY_OPTIONS.every((k) => /^[A-G](#|b)? (major|minor)$/.test(k.value))).toBe(true)
  })

  it('computes tempo from taps', () => {
    expect(tapTempo([0, 500])).toBeNull()
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120)
    expect(tapTempo([0, 600, 1210, 1800, 2400])).toBe(100)
  })
})
