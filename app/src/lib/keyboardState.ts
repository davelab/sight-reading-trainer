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

export function keyLights(
  noteIds: readonly string[],
  eventsById: ReadonlyMap<string, PlaybackEvent>,
  onlyPitches?: readonly number[]
): Map<number, KeyLight> {
  const lights = new Map<number, KeyLight & { onset: number }>()
  for (const id of noteIds) {
    const e = eventsById.get(id)
    if (!e || (onlyPitches && !onlyPitches.includes(e.pitch))) continue
    const prev = lights.get(e.pitch)
    // Two notes on one key (two voices): the latest attack wins.
    if (!prev || e.onsetMs > prev.onset) {
      lights.set(e.pitch, { hand: handOf(e.staff), strikeId: id, onset: e.onsetMs })
    }
  }
  return new Map([...lights].map(([p, { hand, strikeId }]) => [p, { hand, strikeId }]))
}
