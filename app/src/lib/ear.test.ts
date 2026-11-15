import { describe, expect, it } from 'vitest'
import {
  CHORDS,
  earEvents,
  INTERVALS,
  INTERVAL_SETS,
  NO_STATS,
  nextChord,
  nextInterval,
  record,
  topConfusions,
  voice
} from './ear'

function seeded(seed: number) {
  let x = seed
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296
    return x / 4294967296
  }
}

describe('intervals', () => {
  it('sound the interval asked, in the direction asked', () => {
    const rnd = seeded(1)
    const all = INTERVAL_SETS.find((s) => s.id === 'all')!.ids
    for (const direction of ['up', 'down', 'harmonic'] as const) {
      for (let i = 0; i < 60; i++) {
        const q = nextInterval(all, direction, null, rnd)
        const def = INTERVALS.find((d) => d.id === q.answer)!
        const pitches = q.sound.flat()
        expect(Math.abs(pitches[pitches.length - 1] - pitches[0])).toBe(def.semitones)
        if (direction === 'harmonic') expect(q.sound).toHaveLength(1)
        if (direction === 'up') expect(q.sound[1][0]).toBeGreaterThanOrEqual(q.sound[0][0])
        if (direction === 'down') expect(q.sound[1][0]).toBeLessThanOrEqual(q.sound[0][0])
        expect(Math.min(...pitches)).toBeGreaterThanOrEqual(48)
        expect(Math.max(...pitches)).toBeLessThanOrEqual(84)
      }
    }
  })

  it('keep to the chosen set', () => {
    const rnd = seeded(2)
    for (let i = 0; i < 40; i++) expect(['M3', 'P5']).toContain(nextInterval(['M3', 'P5'], 'mixed', null, rnd).answer)
  })
})

describe('chords', () => {
  it('are what their names say, in any inversion', () => {
    const rnd = seeded(3)
    for (let i = 0; i < 200; i++) {
      const q = nextChord(
        'quality',
        { groups: ['triads', 'sevenths', 'extended'], inversions: true, arpeggiate: false },
        null,
        rnd
      )
      const chord = CHORDS.find((c) => c.id === q.answer)!
      const notes = q.sound[0]
      expect(notes).toHaveLength(chord.intervals.length)
      const pcs = new Set(notes.map((n) => n % 12))
      // Some rotation of the chord's pitch classes matches.
      const want = new Set(chord.intervals.map((x) => x % 12))
      const matches = [...Array(12).keys()].some((r) => [...pcs].every((p) => want.has((p - r + 12) % 12)))
      expect(matches).toBe(true)
    }
  })

  it('name the exact chord with its root and play a reference Do first', () => {
    const q = nextChord('exact', { groups: ['triads'], inversions: false, arpeggiate: true }, null, seeded(9))
    expect(q.answer).toMatch(/^\d+:/)
    expect(q.reference).toBe(60)
    const [root] = q.answer.split(':').map(Number)
    expect(q.sound[0][0] % 12).toBe(root)
    expect(q.sound[q.sound.length - 1].length).toBeGreaterThan(1) // arpeggio, then the block
    const events = earEvents(q)
    expect(events[0]).toMatchObject({ pitch: 60, onsetMs: 0 })
    expect(events[1].onsetMs).toBeGreaterThan(1000)
  })

  it('invert by moving the lowest notes up an octave', () => {
    const dom7 = CHORDS.find((c) => c.id === 'dom7')!
    expect(voice(43, dom7, 0)).toEqual([43, 47, 50, 53])
    expect(voice(43, dom7, 2)).toEqual([50, 53, 55, 59])
  })
})

describe('statistics', () => {
  it('count right answers, streaks and the usual mix-ups', () => {
    let s = NO_STATS
    for (const [given, correct] of [
      ['m3', 'm3'],
      ['M3', 'm3'],
      ['M3', 'm3'],
      ['P5', 'P5'],
      ['P5', 'P5']
    ]) {
      s = record(s, given, correct)
    }
    expect(s).toMatchObject({ asked: 5, right: 3, streak: 2, best: 2 })
    expect(topConfusions(s, 'intervals')).toEqual(['3ª minore scambiata per 3ª maggiore: 2 volte'])
  })
})
