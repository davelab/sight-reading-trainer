/**
 * Verovio timemap → playback events for the Rust scheduler.
 *
 * Pure functions, no Verovio import: the toolkit is injected through
 * `NoteLookup`, so this module is testable in Node.
 */
import type { TimeMapEntry } from 'verovio'

/** One note to play. Times are in score milliseconds (at 100% tempo). */
export interface PlaybackEvent {
  noteId: string
  pitch: number
  onsetMs: number
  durMs: number
  velocity: number
  /** 1-based staff number: 1 = right hand, 2 = left hand on a piano grand staff. */
  staff: number
  /** 1-based measure index in performance order (0 if unknown). */
  measure: number
}

export interface NoteInfo {
  pitch: number
  durMs: number
  staff: number
}

export type NoteLookup = (noteId: string) => NoteInfo | null

export const DEFAULT_VELOCITY = 80

export function buildPlaybackEvents(
  timemap: TimeMapEntry[],
  lookup: NoteLookup,
  velocity = DEFAULT_VELOCITY
): PlaybackEvent[] {
  const events: PlaybackEvent[] = []
  const seen = new Set<string>()
  for (const entry of timemap) {
    for (const noteId of entry.on ?? []) {
      if (seen.has(noteId)) continue
      seen.add(noteId)
      const info = lookup(noteId)
      // Tied continuations and grace notes without MIDI duration are not re-triggered.
      if (!info || info.durMs <= 0 || info.pitch < 0 || info.pitch > 127) continue
      events.push({ noteId, pitch: info.pitch, onsetMs: entry.tstamp, durMs: info.durMs, velocity, staff: info.staff, measure: 0 })
    }
  }
  events.sort((a, b) => a.onsetMs - b.onsetMs || a.pitch - b.pitch)
  return events
}

/**
 * Map every note xml:id to its staff number by scanning Verovio's MEI output.
 * MEI <staff> elements never nest, so a flat tag scan is enough and avoids a DOM.
 */
export function staffMapFromMei(mei: string): Map<string, number> {
  const map = new Map<string, number>()
  const tag = /<(\/?)(staff|note)\b([^>]*)>/g
  let staff = 0
  for (let m = tag.exec(mei); m; m = tag.exec(mei)) {
    const [, closing, name, attrs] = m
    if (name === 'staff') {
      staff = closing ? 0 : Number(/\bn="(\d+)"/.exec(attrs)?.[1] ?? 0)
    } else if (!closing && staff > 0) {
      const id = /\bxml:id="([^"]+)"/.exec(attrs)?.[1]
      if (id) map.set(id, staff)
    }
  }
  return map
}

/** Printed number of every measure ("7", "7a"...) in document order, from Verovio's MEI. */
export function measureLabelsFromMei(mei: string): string[] {
  return [...mei.matchAll(/<measure\b([^>]*)>/g)].map((m, i) => /\bn="([^"]+)"/.exec(m[1])?.[1] ?? String(i + 1))
}

export interface MeasureStart {
  measureId: string
  /** 1-based index in performance order. */
  index: number
  ms: number
}

export function measureStarts(timemap: TimeMapEntry[]): MeasureStart[] {
  const out: MeasureStart[] = []
  for (const entry of timemap) {
    if (entry.measureOn) out.push({ measureId: entry.measureOn, index: out.length + 1, ms: entry.tstamp })
  }
  return out
}

/** Fill `measure` on every event from the measure start times (in place). */
export function assignMeasures(events: PlaybackEvent[], measures: MeasureStart[]): PlaybackEvent[] {
  for (const e of events) {
    // Last measure starting at or before the onset (1 ms slack for float rounding).
    let lo = 0
    let hi = measures.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (measures[mid].ms <= e.onsetMs + 1) lo = mid + 1
      else hi = mid
    }
    e.measure = lo > 0 ? measures[lo - 1].index : 0
  }
  return events
}

/** Note onsets inside one measure: `q` in quarter notes from the downbeat. */
export interface MeasureOnset {
  q: number
  noteIds: string[]
}

/**
 * Group the timemap's note onsets by measure, positions relative to the
 * measure start. Used to place annotations anchored to (measure, offset).
 * With repeats only the first pass of each measure is kept.
 */
export function measureOnsets(timemap: TimeMapEntry[]): Map<string, MeasureOnset[]> {
  const out = new Map<string, MeasureOnset[]>()
  let current: { id: string; start: number; list: MeasureOnset[] } | null = null
  for (const entry of timemap) {
    const q = entry.qstamp ?? (entry.qfrac ? entry.qfrac[0] / entry.qfrac[1] : 0)
    if (entry.measureOn) {
      const seen = out.has(entry.measureOn)
      current = seen ? null : { id: entry.measureOn, start: q, list: [] }
      if (current) out.set(current.id, current.list)
    }
    if (current && entry.on?.length) current.list.push({ q: q - current.start, noteIds: [...entry.on] })
  }
  return out
}

export function scoreDurationMs(events: PlaybackEvent[]): number {
  return events.reduce((max, e) => Math.max(max, e.onsetMs + e.durMs), 0)
}
