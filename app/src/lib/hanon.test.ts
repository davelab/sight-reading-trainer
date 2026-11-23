import { describe, expect, it } from 'vitest'
import index from '../assets/hanon/index.json'

const files = import.meta.glob<string>('../assets/hanon/*.musicxml', { query: '?raw', import: 'default', eager: true })

describe('Hanon exercises', () => {
  it('every exercise in the index is a two-staff MusicXML score of the stated length', () => {
    expect(index.map((e) => e.number)).toEqual([1, 2, 13, 20, 43, 48, 50])
    for (const ex of index) {
      const xml = files[`../assets/hanon/${ex.file}`]
      expect(xml, ex.file).toBeTruthy()
      expect(xml).toContain('<score-partwise')
      expect(xml).toContain('<staves>2</staves>')
      expect(xml.match(/<measure /g)?.length).toBe(ex.measures)
    }
  })

  it('every bar holds the same time in both hands', () => {
    for (const ex of index) {
      const xml = files[`../assets/hanon/${ex.file}`]
      for (const bar of xml.split('<measure ').slice(1)) {
        const [rh, lh] = bar.split('<backup>')
        const total = (part: string) =>
          [...part.matchAll(/<note>(?:(?!<\/note>).)*?(<chord\/>)?(?:(?!<\/note>).)*?<duration>(\d+)<\/duration>/gs)]
            .filter((m) => !m[0].includes('<chord/>'))
            .reduce((s, m) => s + Number(m[2]), 0)
        expect(total(rh)).toBeGreaterThan(0)
        expect(total(rh), `${ex.file}`).toBe(total(lh.replace(/^<duration>\d+<\/duration><\/backup>/, '')))
      }
    }
  })
})
