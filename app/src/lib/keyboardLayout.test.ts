import { describe, expect, it } from 'vitest'
import { KEYS, keyAt, noteLabel } from './keyboardLayout'

describe('keyboard layout', () => {
  it('has 88 keys, 52 white, spanning the full width', () => {
    expect(KEYS).toHaveLength(88)
    expect(KEYS.filter((k) => k.white)).toHaveLength(52)
    const last = keyAt(108)!
    expect(last.left + last.width).toBeCloseTo(1)
  })

  it('puts black keys between their white neighbours', () => {
    const c4 = keyAt(60)!
    const cs4 = keyAt(61)!
    const d4 = keyAt(62)!
    expect(cs4.white).toBe(false)
    expect(cs4.left).toBeGreaterThan(c4.left)
    expect(cs4.left + cs4.width).toBeLessThan(d4.left + d4.width)
  })

  it('labels notes in Italian', () => {
    expect(noteLabel(60, true)).toBe('Do4')
    expect(noteLabel(66)).toBe('Fa♯')
  })
})
