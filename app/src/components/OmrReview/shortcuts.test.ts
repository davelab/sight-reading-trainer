import { describe, expect, it } from 'vitest'
import { shortcutFor } from './OmrReview'

describe('review shortcuts', () => {
  it('maps MuseScore-like keys', () => {
    expect(shortcutFor({ key: '5', shiftKey: false })).toEqual({ action: 'set-duration', value: 'quarter' })
    expect(shortcutFor({ key: '3', shiftKey: false })).toEqual({ action: 'set-duration', value: '16th' })
    expect(shortcutFor({ key: 't', shiftKey: false })).toEqual({ action: 'triplet' })
    expect(shortcutFor({ key: 'T', shiftKey: true })).toEqual({ action: 'triplet-measure' })
    expect(shortcutFor({ key: 'ArrowUp', shiftKey: true })).toEqual({ action: 'octave-up' })
    expect(shortcutFor({ key: 'Backspace', shiftKey: true })).toEqual({ action: 'delete-time' })
    expect(shortcutFor({ key: 'Backspace', shiftKey: false })).toEqual({ action: 'delete' })
    expect(shortcutFor({ key: 'x', shiftKey: false })).toBeNull()
  })
})
