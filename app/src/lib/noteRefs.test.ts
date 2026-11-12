import { describe, expect, it } from 'vitest'
import { buildNoteRefs, findNote, pitchName } from './noteRefs'
import type { PlaybackEvent } from './timemap'

const ev = (noteId: string, pitch: number, staff: number): PlaybackEvent => ({
  noteId,
  pitch,
  staff,
  onsetMs: 0,
  durMs: 500,
  velocity: 80,
  measure: 1
})

describe('note refs', () => {
  const onsets = new Map([
    ['m1', [{ q: 0, noteIds: ['a', 'b'] }, { q: 1.5, noteIds: ['c'] }]],
    ['m2', [{ q: 0, noteIds: ['d'] }]]
  ])
  const refs = buildNoteRefs(onsets, ['m1', 'm2'], [ev('a', 74, 1), ev('b', 55, 2), ev('c', 69, 1), ev('d', 71, 1)])

  it('gives every note its measure ordinal, staff, onset and pitch', () => {
    expect(refs.get('b')).toEqual({ measure: 1, staff: 2, offset: 0, pitch: 55 })
    expect(refs.get('c')).toEqual({ measure: 1, staff: 1, offset: 1.5, pitch: 69 })
    expect(refs.get('d')?.measure).toBe(2)
  })

  it('finds a note again after its pitch changed', () => {
    expect(findNote(refs, { measure: 1, staff: 1, offset: 0, pitch: 73 })).toBe('a')
    expect(findNote(refs, { measure: 2, staff: 2, offset: 0, pitch: 71 })).toBeNull()
  })

  it('names pitches', () => {
    expect(pitchName(60)).toBe('Do4')
    expect(pitchName(73)).toBe('Do♯5')
  })
})
