import { describe, expect, it } from 'vitest'
import { barsOf } from './drills'
import { bounds, makeKey, midiOf, nextPhrase, phraseEvents, phraseXml, signatureAlter, SOLFEGE_LEVELS } from './solfege'

function seeded(seed: number) {
  let x = seed
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296
    return x / 4294967296
  }
}

describe('keys', () => {
  it('names keys and reads signatures', () => {
    expect(makeKey(0, 'major').name).toBe('Do maggiore')
    expect(makeKey(-2, 'major').name).toBe('Si♭ maggiore')
    expect(makeKey(1, 'minor').name).toBe('Mi minore')
    expect(signatureAlter(2, 0)).toBe(1) // C# in D major
    expect(signatureAlter(-3, 5)).toBe(-1) // Ab in Eb major
    expect(signatureAlter(-1, 5)).toBe(0)
  })
})

describe('phrases', () => {
  it('fill every measure exactly and end on the tonic, at every level', () => {
    SOLFEGE_LEVELS.forEach((level, index) => {
      const rnd = seeded(index * 31 + 7)
      for (let i = 0; i < 60; i++) {
        const p = nextPhrase(index, rnd, i % 2 ? 'always' : 'never')
        const total = p.notes.reduce((s, n) => s + n.length, 0)
        expect(total).toBeCloseTo(level.measures * p.meter)
        // No note crosses a bar line.
        const bars = barsOf(total, p.meter, p.pickup)
        for (const n of p.notes) {
          const bar = bars.find(([a, b]) => n.start >= a - 1e-9 && n.start < b - 1e-9)!
          expect(n.start + n.length).toBeLessThanOrEqual(bar[1] + 1e-9)
        }
        const sounding = p.notes.filter((n) => !n.rest)
        expect(sounding[sounding.length - 1].degree).toBe(p.key.tonic)
        expect(p.notes[0].rest).toBe(false)
        const [lo, hi] = bounds(level, p.key)
        for (const n of sounding.slice(0, -2)) {
          // The leading tone may lead into the tonic from just below the range (Si -> Do).
          expect(n.degree).toBeGreaterThanOrEqual(lo - (n.start < p.pickup ? 1 : 0))
          expect(n.degree).toBeLessThanOrEqual(hi)
        }
      }
    })
  })

  it('keep the first level to steps and quarter or half notes in C major', () => {
    const rnd = seeded(5)
    for (let i = 0; i < 40; i++) {
      const p = nextPhrase(0, rnd)
      expect(p.key.fifths).toBe(0)
      expect(p.notes.every((n) => n.length === 1 || n.length === 2)).toBe(true)
      const s = p.notes.filter((n) => !n.rest)
      for (let k = 1; k < s.length - 2; k++) expect(Math.abs(s[k].degree - s[k - 1].degree)).toBeLessThanOrEqual(1)
    }
  })

  it('compensates leaps with a step the other way', () => {
    const rnd = seeded(11)
    for (let i = 0; i < 40; i++) {
      const s = nextPhrase(5, rnd).notes.filter((n) => !n.rest)
      for (let k = 2; k < s.length - 2; k++) {
        const leap = s[k - 1].degree - s[k - 2].degree
        if (Math.abs(leap) >= 3) expect(Math.sign(s[k].degree - s[k - 1].degree)).toBe(-Math.sign(leap))
      }
    }
  })

  it('raises the leading tone in minor', () => {
    const rnd = seeded(2)
    let checked = 0
    for (let i = 0; i < 80 && checked < 5; i++) {
      const p = nextPhrase(2, rnd)
      if (p.key.mode !== 'minor') continue
      for (const n of p.notes.filter((x) => !x.rest)) {
        if ((((n.degree - p.key.tonic) % 7) + 7) % 7 === 6) {
          expect(midiOf(n.degree, n.alter) % 12).toBe((midiOf(p.key.tonic, 0) + 11) % 12)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('writes MusicXML with key, meter, lyrics and accidentals', () => {
    const p = nextPhrase(2, seeded(3))
    const xml = phraseXml(p, 'syllables')
    expect(xml).toContain(`<fifths>${p.key.fifths}</fifths>`)
    expect(xml).toContain(`<beats>${p.meter}</beats>`)
    expect(xml).toContain('<lyric')
    expect(xml.match(/<measure /g)).toHaveLength(SOLFEGE_LEVELS[2].measures)
    expect(phraseXml(p, 'none')).not.toContain('<lyric')
    const events = phraseEvents(p, 60)
    expect(events[0].onsetMs).toBe(0)
    expect(events.length).toBe(p.notes.filter((n) => !n.rest).length)
  })
})

describe('phrases in levare', () => {
  it('lead to the tonic on the first downbeat, the last measure shortened', () => {
    const rnd = seeded(77)
    for (let i = 0; i < 80; i++) {
      const p = nextPhrase(i % 6, rnd, 'always')
      expect([1, 2]).toContain(p.pickup)
      const total = p.notes.reduce((x, n) => x + n.length, 0)
      const bars = barsOf(total, p.meter, p.pickup)
      expect(bars[0]).toEqual([0, p.pickup])
      expect(bars[bars.length - 1][1] - bars[bars.length - 1][0]).toBeCloseTo(p.meter - p.pickup)
      // The pickup moves by step into the downbeat's approach note.
      const pick = p.notes.filter((n) => n.start < p.pickup - 1e-9 && !n.rest)
      for (let k = 1; k < pick.length; k++) expect(Math.abs(pick[k].degree - pick[k - 1].degree)).toBe(1)
      const downbeat = p.notes.find((n) => n.start >= p.pickup - 1e-9)!
      expect(downbeat.rest).toBe(false)
      expect(downbeat.degree).toBe(p.key.tonic)
      const xml = phraseXml(p)
      expect(xml).toContain('<measure number="0" implicit="yes">')
      // After the count-in, the pickup's first note falls on its beat of the bar.
      expect(phraseEvents(p, 60)[0].onsetMs).toBe((p.meter - p.pickup) * 1000)
    }
  })

  it('never happen when not asked', () => {
    const rnd = seeded(3)
    for (let i = 0; i < 30; i++) expect(nextPhrase(3, rnd, 'never').pickup).toBe(0)
  })
})
