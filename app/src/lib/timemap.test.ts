import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import createVerovioModule from 'verovio/wasm'
import { VerovioToolkit } from 'verovio/esm'
import type { TimeMapEntry } from 'verovio'
import {
  assignMeasures,
  buildPlaybackEvents,
  measureIdsFromMei,
  measureLabelsFromMei,
  measureOnsets,
  measureStarts,
  scoreDurationMs,
  staffMapFromMei
} from './timemap'

const FIXTURE = fileURLToPath(new URL('../../../engine/tests/fixtures/minuet-in-g.musicxml', import.meta.url))

describe('buildPlaybackEvents', () => {
  const timemap: TimeMapEntry[] = [
    { tstamp: 0, qstamp: 0, on: ['a', 'b'], measureOn: 'm1' },
    { tstamp: 500, qstamp: 1, on: ['c', 'tied'], off: ['a'] },
    { tstamp: 1000, qstamp: 2, on: ['a'], off: ['b', 'c'] }
  ]
  const info = {
    a: { pitch: 74, durMs: 500, staff: 1 },
    b: { pitch: 55, durMs: 1000, staff: 2 },
    c: { pitch: 67, durMs: 500, staff: 1 },
    tied: { pitch: 67, durMs: 0, staff: 1 }
  } as const

  it('emits one event per sounding note, sorted by onset', () => {
    const events = buildPlaybackEvents(timemap, (id) => info[id as keyof typeof info] ?? null)
    expect(events.map((e) => [e.noteId, e.onsetMs, e.staff])).toEqual([
      ['b', 0, 2],
      ['a', 0, 1],
      ['c', 500, 1]
    ])
    expect(scoreDurationMs(events)).toBe(1000)
  })

  it('collects measure starts', () => {
    expect(measureStarts(timemap)).toEqual([{ measureId: 'm1', index: 1, ms: 0 }])
  })
})

describe('assignMeasures', () => {
  it('puts every note in the last measure that starts at or before it', () => {
    const measures = [
      { measureId: 'm1', index: 1, ms: 0 },
      { measureId: 'm2', index: 2, ms: 1500 }
    ]
    const ev = (onsetMs: number) => ({ noteId: String(onsetMs), pitch: 60, onsetMs, durMs: 1, velocity: 80, staff: 1, measure: 0 })
    expect(assignMeasures([ev(0), ev(1498), ev(1499.5), ev(3000)], measures).map((e) => e.measure)).toEqual([1, 1, 2, 2])
  })
})

describe('measureOnsets', () => {
  it('groups onsets per measure relative to the downbeat, first pass only', () => {
    const tm: TimeMapEntry[] = [
      { tstamp: 0, qstamp: 0, measureOn: 'm1', on: ['a'] },
      { tstamp: 500, qstamp: 1, on: ['b', 'c'] },
      { tstamp: 1500, qstamp: 3, measureOn: 'm2', on: ['d'] },
      { tstamp: 2000, qstamp: 4, off: ['d'] },
      { tstamp: 3000, qstamp: 6, measureOn: 'm1', on: ['a'] } // repeat
    ]
    const m = measureOnsets(tm)
    expect(m.get('m1')).toEqual([
      { q: 0, noteIds: ['a'] },
      { q: 1, noteIds: ['b', 'c'] }
    ])
    expect(m.get('m2')).toEqual([{ q: 0, noteIds: ['d'] }])
  })
})

describe('measureLabelsFromMei', () => {
  it('reads printed numbers in document order', () => {
    const mei = '<section><measure xml:id="a" n="0"/><measure n="7" xml:id="b"><staff n="1"/></measure><measure xml:id="c"/></section>'
    expect(measureLabelsFromMei(mei)).toEqual(['0', '7', '3'])
    expect(measureIdsFromMei(mei)).toEqual(['a', 'b', 'c'])
  })
})

describe('staffMapFromMei', () => {
  it('assigns notes to the enclosing staff, chords included', () => {
    const mei = `<measure><staff xml:id="s1" n="1"><layer><note xml:id="n1"/><chord><note xml:id="n2"></note></chord></layer></staff>
      <staff n="2"><layer><note xml:id="n3" pname="g"/></layer></staff></measure>`
    expect([...staffMapFromMei(mei)]).toEqual([['n1', 1], ['n2', 1], ['n3', 2]])
  })
})

describe('Minuet in G fixture through Verovio', () => {
  it('produces playback events for both hands at 120 bpm', async () => {
    const tk = new VerovioToolkit(await createVerovioModule())
    expect(tk.loadData(readFileSync(FIXTURE, 'utf8'))).toBeTruthy()
    tk.renderToMIDI()
    const timemap = tk.renderToTimemap({ includeMeasures: true })
    const staffs = staffMapFromMei(tk.getMEI())
    const events = buildPlaybackEvents(timemap, (id) => {
      const midi = tk.getMIDIValuesForElement(id)
      return { pitch: midi.pitch, durMs: midi.duration, staff: staffs.get(id) ?? 0 }
    })
    // First beat: D5 in the right hand and G3 in the left hand.
    expect(events.filter((e) => e.onsetMs === 0).map((e) => [e.pitch, e.staff])).toEqual([
      [55, 2],
      [74, 1]
    ])
    expect(events.every((e) => e.staff === 1 || e.staff === 2)).toBe(true)
    expect(measureStarts(timemap)).toHaveLength(32)
    assignMeasures(events, measureStarts(timemap))
    // Measure 3 starts at 3 s: E5 (right) and C4 (left).
    expect(events.filter((e) => e.measure === 3 && e.onsetMs === 3000).map((e) => e.pitch)).toEqual([60, 76])
    expect(events.at(-1)?.measure).toBe(32)
    // 32 bars of 3/4 at ♩ = 120 → 48 s.
    expect(scoreDurationMs(events)).toBe(48_000)
  }, 30_000)
})
