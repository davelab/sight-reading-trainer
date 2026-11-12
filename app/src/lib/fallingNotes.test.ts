import { describe, expect, it } from 'vitest'
import { chordTimes, lighten, visibleEvents } from './fallingNotes'
import type { PlaybackEvent } from './timemap'

const ev = (noteId: string, onsetMs: number, durMs: number): PlaybackEvent => ({
  noteId,
  pitch: 60,
  onsetMs,
  durMs,
  velocity: 80,
  staff: 1,
  measure: 1
})

describe('visibleEvents', () => {
  const events = [ev('long', 0, 4000), ev('a', 1000, 500), ev('b', 3000, 500), ev('c', 9000, 500)]

  it('includes notes still sounding and those about to fall', () => {
    expect(visibleEvents(events, 2000, 5000, 4000).map((e) => e.noteId)).toEqual(['long', 'b'])
  })

  it('stops at the end of the window', () => {
    expect(visibleEvents(events, 0, 1200, 4000).map((e) => e.noteId)).toEqual(['long', 'a'])
  })
})

describe('chordTimes', () => {
  const measures = [
    { measureId: 'm1', index: 1, ms: 0 },
    { measureId: 'm2', index: 2, ms: 2000 }
  ]
  const onsets = new Map([
    [
      'm1',
      [
        { q: 0, noteIds: ['a'] },
        { q: 2, noteIds: ['b'] }
      ]
    ],
    ['m2', [{ q: 0, noteIds: ['c'] }]]
  ])
  const events = [ev('a', 0, 500), ev('b', 1000, 500), ev('c', 2000, 500)]

  it('uses the onset of the notes at the chord position, or interpolates', () => {
    const chords = [
      { measure: 1, beat: 1, offset: 0, symbol: 'C', roman: 'I', function: 'tonic' as const },
      { measure: 1, beat: 2, offset: 1, symbol: 'G', roman: 'V', function: 'dominant' as const },
      { measure: 2, beat: 1, offset: 0, symbol: 'F', roman: 'IV', function: 'predominant' as const }
    ]
    expect(chordTimes(chords, ['m1', 'm2'], measures, onsets, events)).toEqual([
      { ms: 0, label: 'C' },
      { ms: 500, label: 'G' },
      { ms: 2000, label: 'F' }
    ])
  })
})

describe('lighten', () => {
  it('mixes towards white', () => {
    expect(lighten('#000000', 0.5)).toBe('#808080')
    expect(lighten('#e0a800', 0)).toBe('#e0a800')
  })
})
