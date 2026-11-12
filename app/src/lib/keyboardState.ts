/**
 * What each key of the on-screen keyboard shows, derived from the notes
 * sounding (playback) or expected (follow mode).
 */
import type { PlaybackEvent } from './timemap'

export type Hand = 'right' | 'left'

export interface KeyLight {
  hand: Hand
  /**
   * ID of the note that struck the key last. A repeated note keeps the key lit
   * (the two notes touch), so the UI replays a "strike" animation whenever this
   * ID changes.
   */
  strikeId: string
}

/** Staff 1 is the right hand on a piano grand staff, staff 2 and below the left. */
export function handOf(staff: number): Hand {
  return staff >= 2 ? 'left' : 'right'
}

/**
 * Keys to light, keyed by the key actually played: `transpose` semitones from
 * the written pitch. `onlyPitches` (follow mode) are keys, already transposed.
 */
export function keyLights(
  noteIds: readonly string[],
  eventsById: ReadonlyMap<string, PlaybackEvent>,
  onlyPitches?: readonly number[],
  transpose = 0
): Map<number, KeyLight> {
  const lights = new Map<number, KeyLight & { onset: number }>()
  for (const id of noteIds) {
    const e = eventsById.get(id)
    if (!e) continue
    const key = e.pitch + transpose
    if (onlyPitches && !onlyPitches.includes(key)) continue
    const prev = lights.get(key)
    // Two notes on one key (two voices): the latest attack wins.
    if (!prev || e.onsetMs > prev.onset) {
      lights.set(key, { hand: handOf(e.staff), strikeId: id, onset: e.onsetMs })
    }
  }
  return new Map([...lights].map(([p, { hand, strikeId }]) => [p, { hand, strikeId }]))
}
