import { describe, expect, it } from 'vitest'
import { keyLights } from './keyboardState'
import type { PlaybackEvent } from './timemap'

const ev = (noteId: string, pitch: number, onsetMs: number, staff: number): PlaybackEvent => ({
  noteId,
  pitch,
  onsetMs,
  durMs: 500,
  velocity: 80,
  staff,
  measure: 1
})

const events = new Map(
  [ev('g4a', 67, 0, 1), ev('g4b', 67, 500, 1), ev('g3', 55, 0, 2), ev('d5', 74, 0, 1)].map((e) => [e.noteId, e])
)

describe('keyLights', () => {
  it('colours keys by hand', () => {
    const lights = keyLights(['g3', 'd5'], events)
    expect(lights.get(55)?.hand).toBe('left')
    expect(lights.get(74)?.hand).toBe('right')
  })

  it('gives a repeated note a new strike id so the key flashes again', () => {
    const first = keyLights(['g4a'], events).get(67)
    const again = keyLights(['g4b'], events).get(67)
    expect(first?.strikeId).toBe('g4a')
    expect(again?.strikeId).toBe('g4b')
  })

  it('keeps the latest attack when two voices share a key', () => {
    expect(keyLights(['g4a', 'g4b'], events).get(67)?.strikeId).toBe('g4b')
  })

  it('can be limited to the pitches still expected (follow mode)', () => {
    expect([...keyLights(['g3', 'd5'], events, [74]).keys()]).toEqual([74])
  })
})
