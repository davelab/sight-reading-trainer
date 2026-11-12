/**
 * Pure helpers of the falling-notes view: which notes are on screen, and
 * when the analysis' chords happen (they are anchored to measure + offset).
 */
import type { Chord } from '../types'
import type { MeasureOnset, MeasureStart, PlaybackEvent } from './timemap'

/** Events whose bar overlaps [fromMs, toMs]. `events` sorted by onset; `maxDurMs` the longest. */
export function visibleEvents(
  events: readonly PlaybackEvent[],
  fromMs: number,
  toMs: number,
  maxDurMs: number
): PlaybackEvent[] {
  // First event that could still be sounding at fromMs.
  let lo = 0
  let hi = events.length
  const earliest = fromMs - maxDurMs
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].onsetMs < earliest) lo = mid + 1
    else hi = mid
  }
  const out: PlaybackEvent[] = []
  for (let i = lo; i < events.length && events[i].onsetMs <= toMs; i++) {
    const e = events[i]
    if (e.onsetMs + e.durMs >= fromMs) out.push(e)
  }
  return out
}

export interface TimedLabel {
  ms: number
  label: string
  fn: Chord['function']
}

/**
 * Score time of each chord: the onset of the notes that start at its
 * (measure, offset), else interpolated between the measure's known onsets.
 */
export function chordTimes(
  chords: readonly Chord[],
  measureIds: readonly string[],
  measures: readonly MeasureStart[],
  onsets: ReadonlyMap<string, MeasureOnset[]>,
  events: readonly PlaybackEvent[],
  label: (c: Chord) => string = (c) => c.symbol
): TimedLabel[] {
  const onsetMs = new Map(events.map((e) => [e.noteId, e.onsetMs]))
  const startOf = new Map<string, number>()
  for (const m of measures) if (!startOf.has(m.measureId)) startOf.set(m.measureId, m.ms)
  const out: TimedLabel[] = []
  for (const c of chords) {
    const id = measureIds[c.measure - 1]
    const start = id !== undefined ? startOf.get(id) : undefined
    if (start === undefined) continue
    // Known (quarters, ms) points of this measure.
    const points: [number, number][] = [[0, start]]
    for (const o of onsets.get(id) ?? []) {
      const ms = o.noteIds.map((n) => onsetMs.get(n)).find((v) => v !== undefined)
      if (ms !== undefined) points.push([o.q, ms])
    }
    points.sort((a, b) => a[0] - b[0])
    const q = c.offset ?? 0
    let ms: number
    const exact = points.find((p) => Math.abs(p[0] - q) < 1e-3)
    if (exact) ms = exact[1]
    else {
      const after = points.findIndex((p) => p[0] > q)
      const a = points[after > 0 ? after - 1 : points.length - 2] ?? points[0]
      const b = points[after > 0 ? after : points.length - 1] ?? points[0]
      const slope = b[0] !== a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 500
      ms = a[1] + (q - a[0]) * slope
    }
    out.push({ ms, label: label(c), fn: c.function })
  }
  return out
}

/** Lighter shade of a #rrggbb colour (for the notes sounding now). */
export function lighten(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const mix = (c: number) => Math.round(c + (255 - c) * amount)
  const r = mix((n >> 16) & 255)
  const g = mix((n >> 8) & 255)
  const b = mix(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}
