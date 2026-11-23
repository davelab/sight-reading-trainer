import { describe, expect, it } from 'vitest'
import {
  chordShape,
  countInAt,
  diatonicInterval,
  intervalLabel,
  judgeRun,
  metersFromMei,
  metronomeClicks,
  noteName,
  spellingsFromMei
} from './practice'

const sp = (name: string) => ({ step: 'cdefgab'.indexOf(name[0]), octave: Number(name.slice(1)) })

describe('metronome', () => {
  const mei =
    '<scoreDef meter.count="3" meter.unit="4"><staffDef n="1"/></scoreDef>' +
    '<measure xml:id="m0" n="0"/><measure xml:id="m1" n="1"/><scoreDef meter.count="6" meter.unit="8"/><measure xml:id="m2" n="2"/>'

  it('reads the meter of every measure', () => {
    expect(metersFromMei(mei)).toEqual([
      { count: 3, unit: 4 },
      { count: 3, unit: 4 },
      { count: 6, unit: 8 }
    ])
    expect(metersFromMei('<meterSig count="2" unit="2"/><measure/>')).toEqual([{ count: 2, unit: 2 }])
  })

  it('beats full measures, counts a pickup back from its end', () => {
    // Pickup of one beat (500 ms), a 3/4 measure, a 6/8 measure (two dotted-quarter beats).
    const measures = [
      { measureId: 'm0', index: 1, ms: 0 },
      { measureId: 'm1', index: 2, ms: 500 },
      { measureId: 'm2', index: 3, ms: 2000 }
    ]
    const clicks = metronomeClicks(measures, ['m0', 'm1', 'm2'], metersFromMei(mei), 3500)
    expect(clicks).toEqual([
      { ms: 0, accent: false },
      { ms: 500, accent: true },
      { ms: 1000, accent: false },
      { ms: 1500, accent: false },
      { ms: 2000, accent: true },
      { ms: 2750, accent: false }
    ])
    expect(countInAt(clicks, 500)).toEqual({ beats: 3, beatMs: 500 })
    expect(countInAt(clicks, 2000)).toEqual({ beats: 2, beatMs: 750 })
  })
})

describe('spelling', () => {
  it('reads notes from the MEI and names them', () => {
    const map = spellingsFromMei('<note xml:id="n1" dur="4" oct="4" pname="f"/><note pname="b" oct="3" xml:id="n2">')
    expect(map.get('n1')).toEqual({ step: 3, octave: 4 })
    expect(noteName(map.get('n1')!, 66)).toBe('Fa♯')
    expect(noteName(map.get('n2')!, 58)).toBe('Si♭')
    expect(noteName(sp('e4'), 64)).toBe('Mi')
  })

  it('measures intervals as written', () => {
    expect(intervalLabel(diatonicInterval(sp('c4'), sp('e4')))).toBe('3↑')
    expect(intervalLabel(diatonicInterval(sp('g4'), sp('c4')))).toBe('5↓')
    expect(intervalLabel(diatonicInterval(sp('c4'), sp('c5')))).toBe('8↑')
    expect(intervalLabel(diatonicInterval(sp('a3'), sp('a3')))).toBe('=')
  })

  it('recognises chord shapes', () => {
    expect(chordShape([sp('c4'), sp('e4'), sp('g4')])).toBe('fond.')
    expect(chordShape([sp('e4'), sp('g4'), sp('c5')])).toBe('1° riv.')
    expect(chordShape([sp('g3'), sp('c4'), sp('e4')])).toBe('2° riv.')
    expect(chordShape([sp('g3'), sp('b3'), sp('d4'), sp('f4')])).toBe('7ª')
    expect(chordShape([sp('c4'), sp('d4'), sp('e4')])).toBeNull()
    expect(chordShape([sp('c3'), sp('c4')])).toBeNull()
  })
})

describe('judging a run', () => {
  const base = { correct: 0, early: 0, late: 0, wrong: 0, missed: 0, expected: 0, meanOffsetMs: 0, measures: 4 }

  it('suggests a faster tempo after a clean run', () => {
    const v = judgeRun({ ...base, correct: 45, late: 3, missed: 2, expected: 50 }, 80)
    expect(v.nextTempo).toBe(90)
    expect(v.notes).toBeCloseTo(0.96)
  })

  it('suggests slowing down after many misses', () => {
    expect(judgeRun({ ...base, correct: 20, missed: 25, wrong: 5, expected: 45 }, 60).nextTempo).toBe(50)
  })

  it('keeps the tempo and names a timing tendency', () => {
    const v = judgeRun({ ...base, correct: 30, late: 12, missed: 3, expected: 45, meanOffsetMs: 70 }, 100)
    expect(v.nextTempo).toBe(100)
    expect(v.advice).toMatch(/ritardo/)
  })
})
