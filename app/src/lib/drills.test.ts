import { describe, expect, it } from 'vitest'
import {
  answer,
  beamsFor,
  midiOf,
  nextArpeggio,
  nextNote,
  nextRhythm,
  nextShape,
  noteLabel,
  positions,
  questionXml,
  rhythmEvents,
  rhythmXml,
  sequenceStep,
  sessionStats
} from './drills'

/** Deterministic random numbers. */
function seeded(seed: number) {
  let x = seed
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296
    return x / 4294967296
  }
}

describe('note drill', () => {
  it('places notes in the chosen zone', () => {
    const staff = positions('treble', 'staff')
    expect(staff[0]).toBe(4 * 7 + 2) // E4
    expect(staff[staff.length - 1]).toBe(5 * 7 + 3) // F5
    const ledger = positions('bass', 'ledger')
    expect(ledger).toContain(4 * 7 + 0) // C4 above the bass staff
    expect(ledger).not.toContain(3 * 7 + 0) // C3 is on the staff
  })

  it('never repeats a note and keeps to white keys when asked', () => {
    const rnd = seeded(1)
    let q = null
    for (let i = 0; i < 200; i++) {
      const next = nextNote({ clef: 'both', zone: 'all', accidentals: false }, q, rnd)
      expect(next.notes[0].alter).toBe(0)
      if (q) expect(midiOf(next.notes[0])).not.toBe(midiOf(q.notes[0]))
      q = next
    }
  })

  it('names and checks notes', () => {
    const q = { clef: 'treble' as const, notes: [{ step: 3, alter: 1, octave: 4 }], label: '' }
    expect(noteLabel(q.notes[0])).toBe('Fa♯4')
    expect(answer([66], q)).toBe('right')
    expect(answer([78], q)).toBe('wrong')
    expect(answer([78], q, true)).toBe('right')
    expect(questionXml(q)).toContain('<alter>1</alter><octave>4</octave>')
  })
})

describe('intervals and triads', () => {
  it('builds triads that are what they say', () => {
    const rnd = seeded(7)
    for (let i = 0; i < 100; i++) {
      const q = nextShape({ clef: 'treble', kind: 'triads', accidentals: true }, null, rnd)
      expect(q.notes).toHaveLength(3)
      const pcs = q.notes.map((n) => midiOf(n) % 12)
      const root = q.label.includes('stato fondamentale') ? pcs[0] : q.label.includes('1°') ? pcs[2] : pcs[1]
      const third = (pcs.find((p) => [3, 4].includes((p - root + 12) % 12))! - root + 12) % 12
      expect(q.label.includes('maggiore') ? 4 : 3).toBe(third)
    }
  })

  it('labels intervals by number and quality', () => {
    const rnd = seeded(3)
    for (let i = 0; i < 100; i++) {
      const q = nextShape({ clef: 'bass', kind: 'intervals', accidentals: false }, null, rnd)
      expect(q.notes).toHaveLength(2)
      expect(q.label).toMatch(/^[2-8]ª (maggiore|minore|giusta|eccedente|diminuita)$/)
      expect(q.notes.every((n) => n.alter === 0)).toBe(true)
    }
  })

  it('wants every note, together', () => {
    const q = {
      clef: 'treble' as const,
      notes: [
        { step: 0, alter: 0, octave: 4 },
        { step: 2, alter: 0, octave: 4 }
      ],
      label: ''
    }
    expect(answer([60], q)).toBe('partial')
    expect(answer([60, 64], q)).toBe('right')
    expect(answer([60, 65], q)).toBe('wrong')
  })
})

describe('session statistics', () => {
  it('counts speed and first-try accuracy', () => {
    const s = sessionStats(
      [
        { label: 'Do4', ms: 800, clean: true },
        { label: 'Fa5', ms: 2400, clean: false },
        { label: 'La3', ms: 1000, clean: true }
      ],
      30000
    )
    expect(s.perMinute).toBe(6)
    expect(s.meanMs).toBeCloseTo(1400)
    expect(s.firstTry).toBeCloseTo(2 / 3)
    expect(s.slowest[0].label).toBe('Fa5')
  })
})

describe('rhythm drill', () => {
  it('fills exactly two measures at every level', () => {
    for (let level = 0; level < 5; level++) {
      const rnd = seeded(level + 10)
      for (let i = 0; i < 50; i++) {
        const r = nextRhythm(level, rnd)
        const total = r.reduce((s, n) => s + n.length, 0)
        expect(total).toBeCloseTo(8)
        expect(r[0].rest).toBe(false)
        if (level === 0) expect(r.every((n) => n.length >= 1)).toBe(true)
        // No note crosses a bar line.
        expect(r.every((n) => Math.floor(n.start / 4 + 1e-9) === Math.floor((n.start + n.length - 1e-6) / 4))).toBe(
          true
        )
      }
    }
  })

  it('becomes events at the chosen tempo, rests left out', () => {
    const r = [
      { start: 0, length: 1, rest: false, triplet: false },
      { start: 1, length: 1, rest: true, triplet: false },
      { start: 2, length: 2, rest: false, triplet: false }
    ]
    expect(rhythmEvents(r, 60).map((e) => e.onsetMs)).toEqual([0, 2000])
    const xml = rhythmXml([...r, { start: 4, length: 4, rest: false, triplet: false }])
    expect(xml).toContain('<rest/>')
    expect(xml.match(/<measure /g)).toHaveLength(2)
  })

  it('beams eighths and sixteenths within the beat', () => {
    const n = (start: number, length: number) => ({ start, length, rest: false, triplet: false })
    expect(beamsFor([n(0, 0.5), n(0.5, 0.25), n(0.75, 0.25)])).toEqual([
      '<beam number="1">begin</beam>',
      '<beam number="1">continue</beam><beam number="2">begin</beam>',
      '<beam number="1">end</beam><beam number="2">end</beam>'
    ])
    expect(beamsFor([n(0, 1)])).toEqual([''])
  })
})

describe('arpeggios', () => {
  it('break a real chord in the order the pattern says', () => {
    const rnd = seeded(21)
    for (let i = 0; i < 150; i++) {
      const q = nextArpeggio({ clef: i % 2 ? 'bass' : 'treble', kind: 'arpeggios', accidentals: true }, null, rnd)
      expect(q.sequence).toBe(true)
      const pitches = q.notes.map(midiOf)
      const pcs = new Set(pitches.map((p) => p % 12))
      const seventh = q.label.includes('settima')
      expect(pcs.size).toBe(seventh ? 4 : 3)
      if (q.label.includes('ascendente')) expect([...pitches].sort((a, b) => a - b)).toEqual(pitches)
      if (q.label.includes('discendente')) expect([...pitches].sort((a, b) => b - a)).toEqual(pitches)
      if (q.label.includes('albertino')) {
        expect(pitches[1]).toBe(pitches[3]) // 1-5-3-5
        expect(pitches[0]).toBeLessThan(pitches[2])
      }
      if (seventh) {
        const root = pitches[q.label.includes('discendente') ? pitches.length - 1 : 0]
        expect([...pcs].map((p) => (p - root + 120) % 12).sort((a, b) => a - b)).toEqual([0, 4, 7, 10])
      }
    }
  })

  it('stay on white keys without accidentals', () => {
    const rnd = seeded(4)
    for (let i = 0; i < 80; i++) {
      const q = nextArpeggio({ clef: 'treble', kind: 'arpeggios', accidentals: false }, null, rnd)
      expect(q.notes.every((n) => n.alter === 0)).toBe(true)
      expect(q.label).not.toContain('settima')
    }
  })

  it('are played one note after the other', () => {
    const q = {
      clef: 'treble' as const,
      notes: [
        { step: 0, alter: 0, octave: 4 },
        { step: 2, alter: 0, octave: 4 },
        { step: 4, alter: 0, octave: 4 }
      ],
      label: '',
      sequence: true
    }
    expect(sequenceStep(60, q, 0)).toBe('next')
    expect(sequenceStep(67, q, 1)).toBe('wrong')
    expect(sequenceStep(64, q, 1)).toBe('next')
    expect(sequenceStep(67, q, 2)).toBe('done')
    const xml = questionXml(q)
    expect(xml).toContain('<type>eighth</type>')
    expect(xml).not.toContain('<chord/>')
    expect(xml).toContain('<beam number="1">begin</beam>')
  })

  it('mix with intervals and triads in «Tutto»', () => {
    const rnd = seeded(9)
    const kinds = new Set<string>()
    for (let i = 0; i < 60; i++) {
      const q = nextShape({ clef: 'treble', kind: 'all', accidentals: false }, null, rnd)
      kinds.add(q.sequence ? 'arpeggio' : q.notes.length === 2 ? 'interval' : 'triad')
    }
    expect(kinds).toEqual(new Set(['arpeggio', 'interval', 'triad']))
  })
})
