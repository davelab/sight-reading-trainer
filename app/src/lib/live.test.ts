import { describe, expect, it } from 'vitest'
import { chordOf, KeyTracker, keyOf, tempoOf } from './live'

describe('live chord', () => {
  it('names chords and inversions', () => {
    expect(chordOf([60, 64, 67])?.name).toBe('Do')
    expect(chordOf([62, 65, 69, 72])?.name).toBe('Rem7')
    expect(chordOf([52, 60, 67])?.name).toBe('Do/Mi')
    expect(chordOf([43, 59, 62, 65])?.name).toBe('Sol7') // fifth in the bass, no D? D is there
    expect(chordOf([57, 60, 64])?.name).toBe('Lam')
    expect(chordOf([60, 64, 70])?.name).toBe('Do7') // no fifth
    expect(chordOf([46, 62, 65], true)?.name).toBe('Si♭')
  })

  it('stays silent for single notes and clusters', () => {
    expect(chordOf([60])).toBeNull()
    expect(chordOf([60, 61, 62, 63])).toBeNull()
  })
})

describe('live key', () => {
  it('finds the key of a scale', () => {
    const h = new Array(12).fill(0)
    for (const pc of [7, 9, 11, 0, 2, 4, 6, 7, 2, 7]) h[pc] += 1 // G major, tonic stressed
    expect(keyOf(h)?.name).toBe('Sol maggiore')
    const m = new Array(12).fill(0)
    for (const pc of [2, 4, 5, 7, 9, 10, 1, 2, 9, 2, 5]) m[pc] += 1 // D harmonic minor
    expect(keyOf(m)?.name).toBe('Re minore')
  })

  it('forgets old bars', () => {
    const k = new KeyTracker(1000)
    for (const p of [60, 64, 67, 72, 65, 69]) k.add(p, 500, 0) // C major
    for (let t = 1; t <= 20; t++) for (const p of [62, 64, 66, 67, 69, 71, 73, 62, 69, 62]) k.add(p, 500, t * 1000) // D major
    expect(k.key()?.name).toBe('Re maggiore')
  })
})

describe('live tempo', () => {
  it('reads the beat of steady eighths and of chords', () => {
    expect(tempoOf(Array.from({ length: 16 }, (_, i) => i * 300))).toBe(100)
    const chords = Array.from({ length: 8 }, (_, i) => [i * 750, i * 750 + 15, i * 750 + 30]).flat()
    expect(tempoOf(chords)).toBe(80)
    expect(tempoOf([0, 500, 1000])).toBeNull()
  })
})
